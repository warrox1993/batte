/**
 * Tests d'integration du Lot 10 — comptabilite.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq, ne } from 'drizzle-orm';
import { ErreurMetier, jourCivilBelge, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import {
  echeance,
  fournisseur,
  ingredient,
  periode,
  production,
  recette,
  sessionMarche,
  sessionVente,
} from '../schema.js';
import { annulerReception, enregistrerReception } from '../services/reception.js';
import { enregistrerFacture } from '../services/factures.js';
import { cloturerSession, creerSession } from '../services/sessions.js';
import { listerJournalAudit } from './audit.js';
import { corrigerParametre, listerParametres } from './parametres.js';
import { listerLieux, listerProduitsVendables } from './sessions.js';
import {
  annulerDepense,
  calculerImpactVerrouillagePeriode,
  cloturerPeriode,
  enregistrerDepense,
  enregistrerImmobilisation,
  listerDepenses,
  listerEcheances,
  listerImmobilisations,
  listerPeriodes,
  marquerEcheanceFaite,
  mesureCarburant,
  rouvrirPeriode,
  seedEcheances,
  syntheseExercice,
  totalAchatsMarchandisesCents,
  totalFraisReceptionCents,
  ventesParCreneauBrutes,
  verifierPeriodeNonVerrouillee,
  verrouillerPeriode,
} from './comptabilite.js';

/**
 * Verrouille DIRECTEMENT une periode annee/mois par ecriture brute en base,
 * en court-circuitant l'enchainement impose ('ouverte' -> 'cloturee' ->
 * 'verrouillee') et le decompte d'impact — utile ici pour tester la GARDE de
 * lecture (`verifierPeriodeNonVerrouillee`, `rouvrirPeriode`) en isolation,
 * sans dependre du geste complet.
 *
 * NE PAS CONFONDRE avec `verrouillerPeriode` importee de `./comptabilite.js`
 * plus bas (le VRAI geste de production, ajoute par cette mission) : ce nom
 * etait auparavant juste — jusqu'au 01/08/2026, AUCUNE fonction de
 * production ne posait ce statut (voir l'ancien commentaire de
 * `verifierPeriodeNonVerrouillee`, docs/34-VERROU-COMPTABLE.md §1). Ce n'est
 * plus le cas : cette fonction locale reste un raccourci de test DELIBERE,
 * jamais une description de ce que l'application sait faire.
 */
function verrouillerPeriodeDirectement(base: BaseBatte, annee: number, mois: number): void {
  const maintenant = maintenantUtc();
  base
    .insert(periode)
    .values({
      id: nouvelIdentifiant(),
      annee,
      mois,
      statut: 'verrouillee',
      dateCloture: maintenant,
      clotureePar: null,
      dateReouverture: null,
      motifReouverture: null,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
}

describe('Lot 10 — comptabilite', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
  });

  describe('depenses', () => {
    it('enregistre une depense et la retrouve dans la liste', () => {
      const { id } = enregistrerDepense(base, {
        dateDepense: '2026-03-10',
        libelle: 'Bouteille de gaz',
        categorie: 'carburant',
        montantCents: 4500,
      });

      const lignes = listerDepenses(base);
      const ligne = lignes.find((l) => l.id === id);
      expect(ligne).toBeDefined();
      expect(ligne?.montantCents).toBe(4500);
      // Deductible a 100 % par defaut.
      expect(ligne?.montantDeductibleCents).toBe(4500);
      expect(ligne?.estAnnulation).toBe(false);
      expect(ligne?.estAnnulee).toBe(false);
    });

    it('applique la part deductible saisie a une depense mixte', () => {
      const { id } = enregistrerDepense(base, {
        dateDepense: '2026-03-10',
        libelle: 'Carburant véhicule mixte',
        categorie: 'carburant',
        montantCents: 10_000,
        deductibleBp: 6_000,
      });

      const ligne = listerDepenses(base).find((l) => l.id === id);
      expect(ligne?.montantDeductibleCents).toBe(6_000);
    });

    it('refuse un montant negatif ou nul a la saisie', () => {
      expect(() =>
        enregistrerDepense(base, {
          dateDepense: '2026-03-10',
          libelle: 'Erreur de saisie',
          categorie: 'autre',
          montantCents: 0,
        }),
      ).toThrow(ErreurMetier);
    });

    it("annule une depense par contre-ecriture, sans jamais l'effacer", () => {
      const { id } = enregistrerDepense(base, {
        dateDepense: '2026-03-10',
        libelle: 'Assurance RC',
        categorie: 'assurance',
        montantCents: 12_000,
      });

      const contreEcriture = annulerDepense(base, id, 'Doublon avec la ligne du 08/03');

      const lignes = listerDepenses(base);
      const origine = lignes.find((l) => l.id === id);
      const correction = lignes.find((l) => l.id === contreEcriture.id);

      // La ligne d'origine reste intacte : rien ne s'efface.
      expect(origine).toBeDefined();
      expect(origine?.montantCents).toBe(12_000);
      expect(origine?.estAnnulee).toBe(true);

      expect(correction).toBeDefined();
      expect(correction?.montantCents).toBe(-12_000);
      expect(correction?.estAnnulation).toBe(true);
      expect(correction?.depenseAnnuleeId).toBe(id);
    });

    it('refuse une seconde annulation de la meme depense', () => {
      const { id } = enregistrerDepense(base, {
        dateDepense: '2026-03-10',
        libelle: 'Formation HACCP',
        categorie: 'formation',
        montantCents: 8_000,
      });
      annulerDepense(base, id, 'Premier motif');

      expect(() => annulerDepense(base, id, 'Second motif')).toThrow(ErreurMetier);
    });

    it('exige un motif pour annuler', () => {
      const { id } = enregistrerDepense(base, {
        dateDepense: '2026-03-10',
        libelle: 'Petit matériel',
        categorie: 'materiel',
        montantCents: 2_000,
      });
      expect(() => annulerDepense(base, id, '   ')).toThrow(ErreurMetier);
    });

    it('filtre les depenses par annee civile', () => {
      enregistrerDepense(base, {
        dateDepense: '2025-06-01',
        libelle: 'Dépense 2025',
        categorie: 'autre',
        montantCents: 1_000,
      });
      enregistrerDepense(base, {
        dateDepense: '2026-06-01',
        libelle: 'Dépense 2026',
        categorie: 'autre',
        montantCents: 2_000,
      });

      const lignes2026 = listerDepenses(base, { annee: 2026 });
      expect(lignes2026.every((l) => l.dateDepense.startsWith('2026'))).toBe(true);
      expect(lignes2026.some((l) => l.libelle === 'Dépense 2026')).toBe(true);
      expect(lignes2026.some((l) => l.libelle === 'Dépense 2025')).toBe(false);
    });

    /**
     * TROU COMBLÉ (audit du 31/07/2026, garde-fous fournisseur système).
     *
     * `enregistrerDepense` ne vérifiait que l'EXISTENCE du `fournisseurId` —
     * jamais son type — alors que trois autres points d'écriture
     * (`depots/referentiel-ecriture.ts`, `depots/economies.ts`,
     * `services/factures.ts`) refusaient déjà explicitement le fournisseur
     * SYSTÈME (« Inventaire d'ouverture »). Rien ne justifie d'attribuer une
     * dépense réelle à une contrepartie qui n'a jamais engagé la moindre
     * charge (`seed/fournisseurs-systeme.ts`) : elle ne sert qu'à porter les
     * lots de l'inventaire d'ouverture. La garde vit désormais dans
     * `depots/fournisseur-systeme.ts`, foyer unique des quatre points
     * d'écriture ci-dessus.
     */
    describe('le fournisseur système ne reçoit jamais de dépense', () => {
      it('refuse `enregistrerDepense` au nom du fournisseur système, avec un code dédié', () => {
        const idFournisseurSysteme = base
          .select({ id: fournisseur.id })
          .from(fournisseur)
          .where(eq(fournisseur.type, 'systeme'))
          .get()!.id;

        expect(() =>
          enregistrerDepense(base, {
            dateDepense: '2026-03-10',
            libelle: 'Frais divers',
            categorie: 'autre',
            montantCents: 1_000,
            fournisseurId: idFournisseurSysteme,
          }),
        ).toThrow(ErreurMetier);

        try {
          enregistrerDepense(base, {
            dateDepense: '2026-03-10',
            libelle: 'Frais divers',
            categorie: 'autre',
            montantCents: 1_000,
            fournisseurId: idFournisseurSysteme,
          });
          expect.unreachable('devrait avoir levé une ErreurMetier');
        } catch (erreur) {
          const metier = erreur as ErreurMetier;
          expect(metier.code).toBe('fournisseur_systeme');
          expect(metier.statut).toBe(422);
        }

        // RIEN N'EST ÉCRIT : ni la dépense refusée, ni aucune ligne partielle.
        expect(listerDepenses(base).some((d) => d.fournisseurId === idFournisseurSysteme)).toBe(
          false,
        );
      });

      // Sans ce second test, un refus qui bloquerait TOUT `fournisseurId` —
      // y compris un fournisseur commercial légitime — passerait inaperçu :
      // la garde doit fermer une seule porte, pas le mur entier.
      it('accepte une dépense rattachée à un fournisseur COMMERCIAL', () => {
        const idFournisseurCommercial = base
          .select({ id: fournisseur.id })
          .from(fournisseur)
          .where(ne(fournisseur.type, 'systeme'))
          .get()!.id;

        const { id } = enregistrerDepense(base, {
          dateDepense: '2026-03-10',
          libelle: 'Achat de dépannage chez le meunier',
          categorie: 'matiere',
          montantCents: 4_200,
          fournisseurId: idFournisseurCommercial,
        });

        const ligne = listerDepenses(base).find((l) => l.id === id);
        expect(ligne).toBeDefined();
        expect(ligne?.fournisseurId).toBe(idFournisseurCommercial);
      });
    });
  });

  describe('mesureCarburant — matière première du coût kilométrique mesuré (fiche 13)', () => {
    it('renvoie un total et un nombre de pleins nuls sans aucune dépense carburant', () => {
      const resultat = mesureCarburant(base);
      expect(resultat.totalCents).toBe(0);
      expect(resultat.nbPleins).toBe(0);
    });

    it('cumule les dépenses carburant et compte un plein par ligne positive', () => {
      enregistrerDepense(base, {
        dateDepense: '2026-03-01',
        libelle: 'Plein n°1',
        categorie: 'carburant',
        montantCents: 6_000,
      });
      enregistrerDepense(base, {
        dateDepense: '2026-03-15',
        libelle: 'Plein n°2',
        categorie: 'carburant',
        montantCents: 5_500,
      });
      // Une autre catégorie ne doit jamais entrer dans ce total : ni pneus ni
      // entretien n'ont de catégorie dédiée (voir le commentaire de fonction).
      enregistrerDepense(base, {
        dateDepense: '2026-03-20',
        libelle: 'Entretien annuel',
        categorie: 'materiel',
        montantCents: 15_000,
      });

      const resultat = mesureCarburant(base);
      expect(resultat.totalCents).toBe(11_500);
      expect(resultat.nbPleins).toBe(2);
    });

    it('une annulation ne compte jamais comme un plein de plus, mais réduit bien le total net', () => {
      const { id } = enregistrerDepense(base, {
        dateDepense: '2026-03-01',
        libelle: 'Plein saisi par erreur',
        categorie: 'carburant',
        montantCents: 6_000,
      });
      annulerDepense(base, id, 'Doublon de saisie');

      const resultat = mesureCarburant(base);
      // La contre-écriture (-6000) annule le plein d'origine (+6000) : net à
      // zéro, et un seul plein RÉEL au sens métier (l'annulation n'en est pas
      // un second).
      expect(resultat.totalCents).toBe(0);
      expect(resultat.nbPleins).toBe(1);
    });
  });

  describe('immobilisations', () => {
    it('persiste le plan d amortissement complet a la creation', () => {
      const { id, annuites } = enregistrerImmobilisation(base, {
        libelle: 'Remorque de marché',
        dateAcquisition: '2026-01-15',
        montantCents: 350_000,
        dureeAmortissementAnnees: 5,
      });

      expect(annuites).toHaveLength(5);
      // Lineaire par defaut : 350 000 / 5 = 70 000 par an.
      expect(annuites[0]?.montantCents).toBe(70_000);
      expect(annuites.reduce((s, a) => s + a.montantCents, 0)).toBe(350_000);

      const lignes = listerImmobilisations(base, 2026);
      const ligne = lignes.find((l) => l.id === id);
      expect(ligne).toBeDefined();
      expect(ligne?.annuites).toHaveLength(5);
      expect(ligne?.valeurNetteActuelleCents).toBe(280_000);
    });

    it('refuse une immobilisation sans duree d amortissement', () => {
      expect(() =>
        enregistrerImmobilisation(base, {
          libelle: 'Matériel sans durée',
          dateAcquisition: '2026-01-15',
          montantCents: 100_000,
          dureeAmortissementAnnees: 0,
        }),
      ).toThrow(ErreurMetier);

      // Rien n'a ete ecrit : la transaction a echoue avant toute insertion.
      expect(listerImmobilisations(base)).toHaveLength(0);
    });
  });

  describe('echeancier reglementaire', () => {
    it('peuple le catalogue une seule fois, meme rappele plusieurs fois', () => {
      // On compare des TOTAUX et non le nombre d'insertions : `seed()` appelle
      // deja `seedEcheances`, donc le premier appel ici n'insere plus rien.
      seedEcheances(base, '2026-02-01');
      const apresPremier = listerEcheances(base, '2026-02-01');

      const second = seedEcheances(base, '2026-02-01');

      expect(second.inserees).toBe(0);
      expect(apresPremier.length).toBeGreaterThan(0);
      expect(listerEcheances(base, '2026-02-01').length).toBe(apresPremier.length);
      // Idempotence PAR LIBELLE : aucun doublon.
      const libelles = apresPremier.map((l) => l.libelle);
      expect(new Set(libelles).size).toBe(libelles.length);
    });

    /**
     * ROUGE AVANT VERT (mission du 01/08/2026, docs/29 §3 et §6 point 1) :
     * l'ancienne version de `seedEcheances` faisait `if (existante !== undefined)
     * continue;` — une ligne deja semee n'etait JAMAIS corrigee, meme si le
     * catalogue avait change entre-temps. Ce test simule un catalogue qui a
     * change SANS toucher au vrai catalogue (hors zone d'ecriture de cet
     * agent) : on ecrit directement en base une valeur perimee, exactement ce
     * qu'une base deja installee contient le jour ou `sourceLegale` ou une
     * date reglementaire change dans `packages/core`.
     */
    it('corrige une echeance DEJA semee quand elle diverge du catalogue, tant qu elle n a jamais ete honoree', () => {
      seedEcheances(base, '2026-02-01');
      const avant = listerEcheances(base, '2026-02-01').find(
        (l) => l.libelle === 'Listing clients TVA',
      )!;
      expect(avant.dateRealisation).toBeNull();

      base
        .update(echeance)
        .set({
          sourceLegale: 'ANCIENNE SOURCE PÉRIMÉE — à corriger par une resemence',
          prochaineDate: '2099-01-01',
        })
        .where(eq(echeance.id, avant.id))
        .run();

      const resultat = seedEcheances(base, '2026-02-01');

      const apres = listerEcheances(base, '2026-02-01').find((l) => l.id === avant.id)!;
      expect(apres.sourceLegale).toBe(avant.sourceLegale);
      expect(apres.prochaineDate).toBe(avant.prochaineDate);
      expect(resultat.misesAJour).toContain('Listing clients TVA');
    });

    /**
     * TEST SYMÉTRIQUE, qui compte au moins autant que le précédent : une
     * échéance marquée FAITE ne doit JAMAIS revenir en arrière au fil d'une
     * resemence, sous peine de remplacer un défaut (la date qui ne bouge
     * jamais) par un pire (une saisie humaine effacée en silence — CLAUDE.md
     * §3 règle 7).
     */
    it('une echeance MARQUEE FAITE survit intacte a une resemence : rien ne revient en arriere', () => {
      seedEcheances(base, '2026-02-01');
      const listing = listerEcheances(base, '2026-02-01').find(
        (l) => l.libelle === 'Listing clients TVA',
      )!;

      // Annee DERIVEE de l'echeance REELLE en base, comme le test voisin
      // « fait rebondir... » ci-dessus : la graine peut avoir tourne une
      // premiere fois via `seed()` (beforeEach) a la date REELLE du jour,
      // qui n'est pas celle de ce test.
      const anneeDue = Number.parseInt(listing.prochaineDate.slice(0, 4), 10);
      const depotAnticipe = `${anneeDue}-03-20`;
      const prochaineDateApresRebond = `${anneeDue + 1}-03-31`;

      marquerEcheanceFaite(base, listing.id, depotAnticipe);
      const apresMarquage = listerEcheances(base, `${anneeDue}-03-21`).find(
        (l) => l.id === listing.id,
      )!;
      expect(apresMarquage.dateRealisation).toBe(depotAnticipe);
      expect(apresMarquage.prochaineDate).toBe(prochaineDateApresRebond);

      // Resemence, comme si le porteur relancait `npm run db:seed` apres une
      // correction du catalogue — sur un catalogue INCHANGE ici, rien ne doit
      // bouger ET rien ne doit meme etre signale comme mis a jour.
      const resultat = seedEcheances(base, `${anneeDue}-03-21`);
      expect(resultat.misesAJour).not.toContain('Listing clients TVA');

      const apresResemence = listerEcheances(base, `${anneeDue}-03-21`).find(
        (l) => l.id === listing.id,
      )!;
      expect(apresResemence.dateRealisation).toBe(depotAnticipe);
      expect(apresResemence.prochaineDate).toBe(prochaineDateApresRebond);
      expect(apresResemence.statut).toBe('a_venir');
    });

    it('resynchronise la documentation d une echeance DEJA marquee faite sans jamais toucher a sa date ni a sa realisation', () => {
      seedEcheances(base, '2026-02-01');
      const listing = listerEcheances(base, '2026-02-01').find(
        (l) => l.libelle === 'Listing clients TVA',
      )!;
      const anneeDue = Number.parseInt(listing.prochaineDate.slice(0, 4), 10);
      const depotAnticipe = `${anneeDue}-03-20`;

      marquerEcheanceFaite(base, listing.id, depotAnticipe);
      const apresMarquage = listerEcheances(base, `${anneeDue}-03-21`).find(
        (l) => l.id === listing.id,
      )!;
      const dateRealisationAttendue = apresMarquage.dateRealisation;

      // Simule un changement de documentation apres coup, ET une tentative de
      // faire revenir la date en arriere (ce qui arriverait si le recalcul de
      // `prochaineDate` n'etait pas protege par `dateRealisation === null`) :
      // on la fait regresser vers la date PRE-rebond (forcement differente de
      // la date post-rebond, donc un bon temoin de non-mouvement).
      base
        .update(echeance)
        .set({
          sourceLegale: 'ANCIENNE SOURCE PÉRIMÉE',
          prochaineDate: listing.prochaineDate,
        })
        .where(eq(echeance.id, listing.id))
        .run();

      seedEcheances(base, `${anneeDue}-03-21`);

      const apres = listerEcheances(base, `${anneeDue}-03-21`).find((l) => l.id === listing.id)!;
      // La documentation EST corrigee...
      expect(apres.sourceLegale).not.toBe('ANCIENNE SOURCE PÉRIMÉE');
      // ...mais le calendrier deja honore ne bouge JAMAIS, dans AUCUN sens :
      // il reste exactement a la valeur (meme corrompue) qu'il avait avant
      // l'appel, la preuve que la graine ne le touche plus du tout.
      expect(apres.prochaineDate).toBe(listing.prochaineDate);
      expect(apres.dateRealisation).toBe(dateRealisationAttendue);
    });

    /**
     * LE TEST QUI COMPTE (mission du 01/08/2026, docs/29 §6 point 1 « le
     * paramètre existe, il se modifie, il ne fait rien ») : jusqu'ici,
     * `seedEcheances` important `CATALOGUE_ECHEANCES` comme une CONSTANTE de
     * compilation, résolue une fois pour toutes depuis les valeurs PAR DÉFAUT
     * du catalogue de `packages/core/src/parametres.ts` — jamais depuis la
     * table `parametre` réellement en base. `corrigerParametre` est la MÊME
     * fonction que la route HTTP de l'écran Paramètres appelle : ce test ne
     * simule pas une dérive du catalogue (comme les tests voisins, qui
     * corrompent directement `echeance` en base), il modifie un PARAMÈTRE
     * réel, exactement comme le porteur le ferait à l'écran.
     */
    it('modifie REELLEMENT la prochaine date quand le PARAMETRE `echeance_listing_tva_jours` change en base', () => {
      seedEcheances(base, '2026-02-01');
      const avant = listerEcheances(base, '2026-02-01').find(
        (l) => l.libelle === 'Listing clients TVA',
      )!;
      expect(avant.prochaineDate).toBe('2026-03-31');
      expect(avant.dateRealisation).toBeNull();

      const ligneParametre = listerParametres(base).find(
        (l) => l.cle === 'echeance_listing_tva_jours',
      );
      expect(ligneParametre).toBeDefined();
      corrigerParametre(base, ligneParametre!.id, '06-15');

      const resultat = seedEcheances(base, '2026-02-01');

      const apres = listerEcheances(base, '2026-02-01').find((l) => l.id === avant.id)!;
      expect(apres.prochaineDate).toBe('2026-06-15');
      expect(resultat.misesAJour).toContain('Listing clients TVA');
    });

    /**
     * LE TEST QUI COMPTE, VARIANTE QUINQUENNALE (mission du 01/08/2026) :
     * `echeance_pas_quinquennal_annees` avait été ajoutée au catalogue avec
     * les 22 autres, mais n'avait AUCUN effet — `construireCatalogueEcheances`
     * relisait déjà `echeance_*_jours`/`_source_legale`/`_url_source` depuis
     * un `Parametres` réellement chargé en base (voir le test ci-dessus), mais
     * le PAS quinquennal, lui, restait lu depuis `PAS_ANNEES.quinquennale` —
     * une constante PRIVÉE de module dans `packages/core/src/comptabilite.ts`,
     * calculée UNE SEULE FOIS depuis les valeurs PAR DÉFAUT du catalogue.
     * Modifier cette clé précise depuis l'écran Paramètres restait donc SANS
     * EFFET sur la prochaine occurrence calculée ici, alors même que la clé
     * était déjà éditable et déjà semée en base — exactement le défaut que ce
     * fichier corrige pour les 15 autres clés `echeance_*`, mais qui
     * persistait sur celle-ci.
     *
     * CORRIGÉ : `DefinitionEcheance` porte désormais `pasAnnees`, calculé par
     * `construireCatalogueEcheances` depuis le `Parametres` REÇU — jamais
     * depuis une constante figée. Un test sur les valeurs par défaut seules ne
     * prouverait rien (la valeur par défaut du pas est 5, exactement celle
     * qu'aurait rendue l'ancien code figé) : la preuve qui compte est de
     * changer le PARAMÈTRE réel en base et de vérifier que la date bouge.
     */
    it(
      'modifie REELLEMENT la prochaine occurrence quinquennale quand le PARAMETRE ' +
        '`echeance_pas_quinquennal_annees` change en base — défaut corrigé le 01/08/2026',
      () => {
        seedEcheances(base, '2026-02-01');
        const avant = listerEcheances(base, '2026-02-01').find(
          (l) => l.libelle === "Renouvellement de l'autorisation d'activités ambulantes",
        )!;
        // Ancrage PROVISOIRE = jour d'installation (voir le commentaire de
        // `seedEcheances` : « le jour d'installation sert d'ancrage provisoire
        // aux récurrences pluriannuelles »). Au pas PAR DÉFAUT (5 ans), la
        // première occurrence tombe cinq ans après le jour de semence.
        expect(avant.prochaineDate).toBe('2031-02-01');
        expect(avant.dateRealisation).toBeNull();

        const ligneParametre = listerParametres(base).find(
          (l) => l.cle === 'echeance_pas_quinquennal_annees',
        );
        expect(ligneParametre).toBeDefined();
        corrigerParametre(base, ligneParametre!.id, '10');

        const resultat = seedEcheances(base, '2026-02-01');

        const apres = listerEcheances(base, '2026-02-01').find((l) => l.id === avant.id)!;
        // Le pas est bien passé de 5 à 10 ans : la prochaine occurrence bouge
        // en conséquence, depuis le MÊME ancrage provisoire — avant cette
        // correction, `apres.prochaineDate` serait resté identique à `avant`.
        expect(apres.prochaineDate).toBe('2036-02-01');
        expect(resultat.misesAJour).toContain(
          "Renouvellement de l'autorisation d'activités ambulantes",
        );
      },
    );

    /**
     * TEST SYMETRIQUE, tout aussi important que le precedent : sans lui, la
     * correction ci-dessus remplacerait un defaut (le parametre qui ne fait
     * rien) par un pire (une saisie humaine — la date d'une echeance deja
     * honoree — effacee en silence des qu'un parametre change ailleurs).
     */
    it('une echeance MARQUEE FAITE ne bouge PAS meme quand le PARAMETRE qui gouverne sa date change reellement', () => {
      seedEcheances(base, '2026-02-01');
      const listing = listerEcheances(base, '2026-02-01').find(
        (l) => l.libelle === 'Listing clients TVA',
      )!;
      const anneeDue = Number.parseInt(listing.prochaineDate.slice(0, 4), 10);
      const depotAnticipe = `${anneeDue}-03-20`;

      marquerEcheanceFaite(base, listing.id, depotAnticipe);
      const apresMarquage = listerEcheances(base, `${anneeDue}-03-21`).find(
        (l) => l.id === listing.id,
      )!;
      expect(apresMarquage.dateRealisation).toBe(depotAnticipe);
      const prochaineDateAttendue = apresMarquage.prochaineDate;

      const ligneParametre = listerParametres(base).find(
        (l) => l.cle === 'echeance_listing_tva_jours',
      )!;
      corrigerParametre(base, ligneParametre.id, '06-15');

      seedEcheances(base, `${anneeDue}-03-21`);

      const apres = listerEcheances(base, `${anneeDue}-03-21`).find((l) => l.id === listing.id)!;
      expect(apres.prochaineDate).toBe(prochaineDateAttendue);
      expect(apres.dateRealisation).toBe(depotAnticipe);
    });

    it('fait rebondir une echeance recurrente honoree EN AVANCE sur l annee suivante', () => {
      // Dates deduites de l'echeance REELLE en base plutot que codees : la
      // graine s'execute avec la date du jour, qui n'est pas celle du test.
      const listing = listerEcheances(base, '2026-02-01').find(
        (l) => l.libelle === 'Listing clients TVA',
      )!;
      const [anneeDue, moisJour] = [
        Number.parseInt(listing.prochaineDate.slice(0, 4), 10),
        listing.prochaineDate.slice(5),
      ];
      expect(moisJour).toBe('03-31');

      // Deposee le 20/03, ONZE JOURS AVANT l'echeance du 31/03 : l'ancrage doit
      // rester la date butoir, pas la date de realisation, sans quoi le rebond
      // retomberait sur lui-meme au lieu de l'annee suivante.
      const depotAnticipe = `${anneeDue}-03-20`;
      marquerEcheanceFaite(base, listing.id, depotAnticipe);
      const misAJour = listerEcheances(base, `${anneeDue}-03-21`).find((l) => l.id === listing.id)!;

      expect(misAJour.statut).toBe('a_venir');
      expect(misAJour.dateRealisation).toBe(depotAnticipe);
      // Recurrente : elle rebondit sur l'annee suivante, pas de cloture definitive.
      expect(misAJour.prochaineDate).toBe(`${anneeDue + 1}-03-31`);
    });

    it('signale une echeance en retard sans jamais l ecrire en base', () => {
      seedEcheances(base, '2026-02-01');
      const lignes = listerEcheances(base, '2027-06-01');
      expect(lignes.some((l) => l.statut === 'en_retard')).toBe(true);
    });
  });

  describe('periodes', () => {
    it('cree et cloture une periode qui n existait pas encore', () => {
      const { id } = cloturerPeriode(base, 2026, 3, 'Le porteur du projet');
      const ligne = listerPeriodes(base).find((l) => l.id === id);
      expect(ligne?.statut).toBe('cloturee');
      expect(ligne?.clotureePar).toBe('Le porteur du projet');
    });

    it('refuse de cloturer deux fois la meme periode', () => {
      cloturerPeriode(base, 2026, 4);
      expect(() => cloturerPeriode(base, 2026, 4)).toThrow(ErreurMetier);
    });

    it('rouvre une periode cloturee avec un motif trace', () => {
      const { id } = cloturerPeriode(base, 2026, 5);
      rouvrirPeriode(base, id, 'Facture de gaz arrivée en retard');

      const ligne = listerPeriodes(base).find((l) => l.id === id);
      expect(ligne?.statut).toBe('ouverte');
      expect(ligne?.motifReouverture).toContain('gaz');
    });

    it('exige un motif pour rouvrir', () => {
      const { id } = cloturerPeriode(base, 2026, 6);
      expect(() => rouvrirPeriode(base, id, '')).toThrow(ErreurMetier);
    });

    /**
     * TROISIÈME ARBITRAGE (rapport de mission) : rouvrir un exercice clôturé
     * doit se voir. `rouvrirPeriode` écrivait déjà au journal AVANT ce lot —
     * ce test fige la preuve, plutôt que de la supposer.
     */
    it('rouvrir une periode ecrit une trace de MODIFICATION au journal d audit', () => {
      const { id } = cloturerPeriode(base, 2026, 7, 'Le porteur du projet');
      expect(listerJournalAudit(base, { table: 'periode', enregistrementId: id })).toHaveLength(1);

      rouvrirPeriode(base, id, 'Facture de gaz arrivée en retard');

      const traces = listerJournalAudit(base, { table: 'periode', enregistrementId: id });
      expect(traces).toHaveLength(2);
      const reouverture = traces.find((t) => t.valeurApres?.statut === 'ouverte');
      expect(reouverture).toBeDefined();
      expect(reouverture?.action).toBe('modification');
      expect(reouverture?.valeurAvant?.statut).toBe('cloturee');
      expect(reouverture?.valeurApres?.motifReouverture).toContain('gaz');
    });

    it('refuse de rouvrir une periode VERROUILLEE : le point de non-retour ne bouge plus', () => {
      verrouillerPeriodeDirectement(base, 2026, 9);
      const id = listerPeriodes(base).find((l) => l.annee === 2026 && l.mois === 9)!.id;

      expect(() => rouvrirPeriode(base, id, 'Tentative de correction')).toThrow(ErreurMetier);
      expect(listerPeriodes(base).find((l) => l.id === id)?.statut).toBe('verrouillee');
    });
  });

  /**
   * Défaut d'intégrité comptable (audit documentaire) : `periode.statut =
   * 'verrouillee'` existait en base et `rouvrirPeriode` le LISAIT déjà pour
   * refuser une réouverture, mais RIEN n'empêchait d'écrire dans une période
   * verrouillée — le verrou était décoratif (docs/16 §6.1, docs/17 §7.3,
   * docs/20). `verifierPeriodeNonVerrouillee` corrige ce point précis.
   */
  describe('verrou de periode — refus des ecritures datees dans une periode VERROUILLEE', () => {
    it('la fonction de garde ne refuse rien sans ligne periode (etat implicite « ouverte »)', () => {
      expect(() => verifierPeriodeNonVerrouillee(base, '2026-03-10')).not.toThrow();
    });

    it('la fonction de garde ne refuse rien dans une periode OUVERTE ou CLOTUREE', () => {
      cloturerPeriode(base, 2026, 3);
      // Clôturée, pas verrouillée : docs/07 §1.6 — « la clôture marque plutôt
      // qu'elle n'interdit ». Zéro régression attendue ici.
      expect(() => verifierPeriodeNonVerrouillee(base, '2026-03-15')).not.toThrow();
    });

    it('la fonction de garde refuse une date VERROUILLEE, en nommant la periode', () => {
      verrouillerPeriodeDirectement(base, 2026, 3);

      expect(() => verifierPeriodeNonVerrouillee(base, '2026-03-15')).toThrow(ErreurMetier);
      try {
        verifierPeriodeNonVerrouillee(base, '2026-03-15');
        expect.unreachable('devait refuser');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('periode_verrouillee');
        expect((erreur as ErreurMetier).message).toContain('03/2026');
      }
    });

    /**
     * Ce refus tombe des SEMAINES apres le geste qui l'a rendu possible : le
     * verrou se pose sur un exercice transmis, le refus survient le jour ou
     * l'on essaie d'y toucher. Un « operation impossible » sec ne laisserait
     * alors AUCUNE issue au porteur — le message doit donc dire les deux
     * issues qui existent VRAIMENT dans ce fichier, et NE PAS en promettre
     * une troisieme qui n'existe pas.
     *
     * Les trois assertions ci-dessous correspondent chacune a un fait verifie
     * ailleurs dans cette meme suite :
     *  - re-dater sur un mois ouvert passe — la garde ne lit QUE `dateEcriture`
     *    (test « ne refuse rien sans ligne periode » ci-dessus) ;
     *  - `annulerDepense` verifie le verrou sur la CONTRE-ecriture du jour
     *    (test dedie plus bas dans ce meme describe) ;
     *  - mouvement / reception / production / session verifient, eux, la date
     *    D'ORIGINE : aucune issue dans l'application, d'ou le renvoi au
     *    comptable plutot qu'a un bouton qui n'existe pas.
     */
    it('le refus dit CE QUI RESTE POSSIBLE et ce qui ne l’est plus, jamais un « impossible » sec', () => {
      verrouillerPeriodeDirectement(base, 2026, 3);

      try {
        verifierPeriodeNonVerrouillee(base, '2026-03-15');
        expect.unreachable('devait refuser');
      } catch (erreur) {
        const message = (erreur as ErreurMetier).message;
        // Issue 1 — une ecriture NOUVELLE se re-date.
        expect(message).toContain('mois encore ouvert');
        // Issue 2 — une depense de ce mois reste annulable par contre-ecriture.
        // Apostrophe DROITE : c'est celle de tout le reste de ce message
        // (« C'est un point de non-retour »), et deux apostrophes visuellement
        // proches ne sont jamais egales — meme piege que l'espace insecable de
        // `formaterEuros`.
        expect(message).toContain("contre-écriture datée d'aujourd'hui");
        // Ce qui n'a PAS d'issue, nomme explicitement plutot que tu.
        expect(message).toContain(
          'mouvement de stock, une réception, une production ou une session',
        );
        expect(message).toContain('avec votre comptable');
        // Et surtout : le message ne promet JAMAIS une reouverture, qui
        // n'existe a aucun niveau pour ce statut (`rouvrirPeriode` la refuse).
        expect(message).not.toContain('rouvrir cette période');
      }
    });

    /**
     * Le pendant du test ci-dessus, cote PORTEE : le verrou ne regarde pas
     * les factures fournisseur, et le message ne doit donc pas les citer —
     * l'y ajouter serait un mensonge par exces. `services/factures.ts`
     * n'appelle jamais cette garde (zero occurrence de son nom dans ce
     * fichier) : une facture reste enregistrable et annulable, et
     * `corrigerCoutLot` y reecrit encore `lot.prix_ligne_cents`.
     */
    it('le refus ne prétend PAS figer les factures fournisseur, que ce verrou ne regarde pas', () => {
      verrouillerPeriodeDirectement(base, 2026, 3);

      try {
        verifierPeriodeNonVerrouillee(base, '2026-03-15');
        expect.unreachable('devait refuser');
      } catch (erreur) {
        expect((erreur as ErreurMetier).message.toLowerCase()).not.toContain('facture');
      }
    });

    it('enregistrerDepense refuse une date tombant dans une periode verrouillee', () => {
      verrouillerPeriodeDirectement(base, 2026, 4);

      expect(() =>
        enregistrerDepense(base, {
          dateDepense: '2026-04-05',
          libelle: 'Gaz avril',
          categorie: 'carburant',
          montantCents: 4500,
        }),
      ).toThrow(ErreurMetier);
      // Rien n'a ete ecrit.
      expect(listerDepenses(base, { annee: 2026 }).some((l) => l.libelle === 'Gaz avril')).toBe(
        false,
      );
    });

    it('enregistrerDepense reste possible dans une periode OUVERTE, meme quand un AUTRE mois est verrouille — zero regression', () => {
      verrouillerPeriodeDirectement(base, 2026, 4);

      const { id } = enregistrerDepense(base, {
        dateDepense: '2026-05-01',
        libelle: 'Gaz mai',
        categorie: 'carburant',
        montantCents: 4500,
      });

      expect(listerDepenses(base).find((l) => l.id === id)).toBeDefined();
    });

    /**
     * PREMIER ARBITRAGE (rapport de mission) : une contre-écriture EST une
     * écriture (règle n°7), mais `annulerDepense` la date du JOUR DE
     * L'ANNULATION, jamais de la dépense d'origine (voir son commentaire) —
     * le verrou se lit donc sur AUJOURD'HUI. Une erreur remontant à un
     * exercice déjà verrouillé reste corrigible tant que le mois COURANT est
     * ouvert : exactement le mécanisme d'une note de crédit comptable.
     */
    it('annulerDepense reste possible meme quand la depense d origine est dans une periode DEPUIS verrouillee (contre-ecriture datee du jour, periode courante ouverte)', () => {
      const { id } = enregistrerDepense(base, {
        dateDepense: '2026-01-10',
        libelle: 'Assurance à annuler',
        categorie: 'assurance',
        montantCents: 12_000,
      });

      // Le mois de la depense d'origine est verrouille APRES coup — le cas
      // reel decrit dans le rapport de mission.
      verrouillerPeriodeDirectement(base, 2026, 1);

      const contreEcriture = annulerDepense(base, id, 'Erreur decouverte apres verrouillage');
      expect(listerDepenses(base).find((l) => l.id === contreEcriture.id)).toBeDefined();
    });

    it('annulerDepense refuse quand la periode COURANTE (date de la contre-ecriture) est verrouillee', () => {
      const { id } = enregistrerDepense(base, {
        dateDepense: '2026-01-10',
        libelle: 'Assurance à annuler',
        categorie: 'assurance',
        montantCents: 12_000,
      });

      const aujourdHui = jourCivilBelge(new Date());
      const annee = Number.parseInt(aujourdHui.slice(0, 4), 10);
      const mois = Number.parseInt(aujourdHui.slice(5, 7), 10);
      verrouillerPeriodeDirectement(base, annee, mois);

      expect(() => annulerDepense(base, id, 'Tentative de correction')).toThrow(ErreurMetier);
    });

    it('enregistrerImmobilisation refuse une date d acquisition tombant dans une periode verrouillee', () => {
      verrouillerPeriodeDirectement(base, 2026, 2);

      expect(() =>
        enregistrerImmobilisation(base, {
          libelle: 'Matériel acquis en période verrouillée',
          dateAcquisition: '2026-02-10',
          montantCents: 100_000,
          dureeAmortissementAnnees: 5,
        }),
      ).toThrow(ErreurMetier);
      expect(listerImmobilisations(base).length).toBe(0);
    });

    it('enregistrerImmobilisation reste possible dans une periode ouverte — zero regression', () => {
      verrouillerPeriodeDirectement(base, 2026, 2);

      const { id } = enregistrerImmobilisation(base, {
        libelle: 'Matériel acquis en période ouverte',
        dateAcquisition: '2026-03-10',
        montantCents: 100_000,
        dureeAmortissementAnnees: 5,
      });

      expect(listerImmobilisations(base).find((l) => l.id === id)).toBeDefined();
    });
  });

  /**
   * Le GESTE de verrouillage lui-meme (docs/34-VERROU-COMPTABLE.md) : jusqu'au
   * 01/08/2026, `periode.statut = 'verrouillee'` n'etait ecrit par AUCUNE
   * fonction de production (voir l'ancien commentaire de
   * `verifierPeriodeNonVerrouillee` et de `verrouillerPeriodeDirectement`
   * ci-dessus) — seule la LECTURE du verrou etait testee. Ce bloc teste
   * l'ECRITURE : l'enchainement impose, l'irreversibilite etablie (pas
   * supposee), et le decompte d'impact qui doit preceder le geste.
   */
  describe('verrouillerPeriode — le geste qui pose le verrou', () => {
    it("refuse de verrouiller une periode encore OUVERTE : l'enchainement impose est ouverte -> cloturee -> verrouillee, jamais un raccourci", () => {
      const { id } = cloturerPeriode(base, 2038, 1, 'Le porteur du projet');
      rouvrirPeriode(base, id, 'Remise a l etat ouverte pour ce test');
      expect(listerPeriodes(base).find((l) => l.id === id)?.statut).toBe('ouverte');

      expect(() => verrouillerPeriode(base, id)).toThrow(ErreurMetier);
      try {
        verrouillerPeriode(base, id);
        expect.unreachable('devait refuser une periode ouverte');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('periode_non_cloturee');
      }
      // Rien n'a bouge : le refus n'a pas d'effet de bord.
      expect(listerPeriodes(base).find((l) => l.id === id)?.statut).toBe('ouverte');
    });

    it('verrouille une periode CLOTUREE, journalise le changement de statut, et refuse un second verrouillage', () => {
      const { id } = cloturerPeriode(base, 2038, 2, 'Le porteur du projet');
      expect(listerJournalAudit(base, { table: 'periode', enregistrementId: id })).toHaveLength(1);

      verrouillerPeriode(base, id, 'Le porteur du projet');

      expect(listerPeriodes(base).find((l) => l.id === id)?.statut).toBe('verrouillee');

      const traces = listerJournalAudit(base, { table: 'periode', enregistrementId: id });
      expect(traces).toHaveLength(2);
      const verrouillage = traces.find((t) => t.valeurApres?.statut === 'verrouillee');
      expect(verrouillage).toBeDefined();
      expect(verrouillage?.action).toBe('modification');
      expect(verrouillage?.valeurAvant?.statut).toBe('cloturee');
      expect(verrouillage?.parQui).toBe('Le porteur du projet');

      // Deuxieme verrouillage : refuse, jamais silencieux.
      expect(() => verrouillerPeriode(base, id)).toThrow(ErreurMetier);
      try {
        verrouillerPeriode(base, id);
        expect.unreachable('devait refuser un second verrouillage');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('periode_deja_verrouillee');
      }
    });

    it('refuse de verrouiller une periode introuvable', () => {
      expect(() => verrouillerPeriode(base, 'periode-inexistante')).toThrow(ErreurMetier);
    });

    /**
     * ÉTABLI, PAS SUPPOSÉ (mission) : `rouvrirPeriode` refuse-t-elle une
     * période verrouillée PAR LE VRAI GESTE (pas seulement par la fixture de
     * test) ? Oui — c'est exactement la même garde interne
     * (`existante.statut === 'verrouillee'`), mais ce test la déclenche via le
     * chemin réel de bout en bout : clôturer, verrouiller, tenter de rouvrir.
     */
    it('une fois verrouillee PAR LE GESTE REEL, rouvrirPeriode refuse : le verrou est un point de non-retour etabli de bout en bout', () => {
      const { id } = cloturerPeriode(base, 2038, 3, 'Le porteur du projet');
      verrouillerPeriode(base, id);

      expect(() => rouvrirPeriode(base, id, 'Tentative de correction')).toThrow(ErreurMetier);
      try {
        rouvrirPeriode(base, id, 'Tentative de correction');
        expect.unreachable('devait refuser de rouvrir une periode verrouillee');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('periode_verrouillee');
      }
      expect(listerPeriodes(base).find((l) => l.id === id)?.statut).toBe('verrouillee');
    });
  });

  /**
   * Le DÉCOMPTE affiché avant le geste (docs/34-VERROU-COMPTABLE.md §3 de la
   * mission) : chaque catégorie doit être dérivée des points d'appel RÉELS de
   * `verifierPeriodeNonVerrouillee`, jamais énumérée à la main. Ces tests
   * posent des écritures RÉELLES (réceptions via le service, ce qui écrit
   * aussi leurs mouvements d'entrée) et des lignes minimales insérées
   * directement pour `production`/`session_marche` — même convention que
   * `creerSession` du describe `ventesParCreneauBrutes` plus bas dans ce
   * fichier : seul le comptage par date/statut est testé ici, pas la
   * logique métier de production ou de clôture, déjà couverte ailleurs
   * (`services/production.test.ts`, `services/sessions.test.ts`).
   */
  describe('calculerImpactVerrouillagePeriode', () => {
    it('refuse pour une periode introuvable', () => {
      expect(() => calculerImpactVerrouillagePeriode(base, 'periode-inexistante')).toThrow(
        ErreurMetier,
      );
    });

    it('rend des comptes a ZERO reels (pas des inconnues) quand rien n est date dans le mois vise', () => {
      const { id } = cloturerPeriode(base, 2039, 1, 'Le porteur du projet');
      const impact = calculerImpactVerrouillagePeriode(base, id);

      expect(impact).toEqual({
        periodeId: id,
        annee: 2039,
        mois: 1,
        mouvementsStockNonAnnulesCount: 0,
        receptionsNonAnnuleesCount: 0,
        productionsNonAnnuleesCount: 0,
        sessionsNonAnnuleesCount: 0,
        depensesCount: 0,
        immobilisationsCount: 0,
      });
    });

    it(
      'compte les mouvements de stock, receptions, productions et sessions NON ANNULES de la ' +
        'periode visee — et les depenses/immobilisations A PART, jamais additionnees',
      () => {
        const ANNEE = 2039;
        const MOIS = 5;
        const idFournisseurTest = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
        const idFarine = base
          .select({ id: ingredient.id })
          .from(ingredient)
          .where(eq(ingredient.nom, 'Farine de froment T55'))
          .get()!.id;

        // 1. Deux receptions ACTIVES dans le mois vise (service reel : chacune
        // ecrit aussi un lot et un mouvement d'entree, CLAUDE.md §3 regle 6).
        enregistrerReception(base, {
          fournisseurId: idFournisseurTest,
          dateReception: `${ANNEE}-0${MOIS}-05`,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 5_000,
              prixLigneCents: 750,
              numeroLotFournisseur: 'TEST-IMPACT-LOT-A',
            },
          ],
        });
        enregistrerReception(base, {
          fournisseurId: idFournisseurTest,
          dateReception: `${ANNEE}-0${MOIS}-12`,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 5_000,
              prixLigneCents: 750,
              numeroLotFournisseur: 'TEST-IMPACT-LOT-B',
            },
          ],
        });

        // 2. Une troisieme reception, ANNULEE avant le verrouillage : ne doit
        // PLUS compter parmi les receptions non annulees (meme regle que
        // `totalAchatsMarchandisesCents` ci-dessus, deja testee sur ce point).
        const receptionAnnulee = enregistrerReception(base, {
          fournisseurId: idFournisseurTest,
          dateReception: `${ANNEE}-0${MOIS}-15`,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 1_000,
              prixLigneCents: 150,
              numeroLotFournisseur: 'TEST-IMPACT-LOT-C',
            },
          ],
        });
        annulerReception(base, receptionAnnulee.receptionId, 'ERREUR_SAISIE');

        // 3. Une production, inseree directement (le detail de la recette
        // n'importe pas ici : seul le comptage par date/statut est teste).
        const idRecette = base.select({ id: recette.id }).from(recette).limit(1).get()!.id;
        const maintenant = maintenantUtc();
        base
          .insert(production)
          .values({
            id: nouvelIdentifiant(),
            numero: 'TEST-PROD-IMPACT',
            recetteId: idRecette,
            dateProduction: `${ANNEE}-0${MOIS}-06`,
            statut: 'lancee',
            volumeTheoriqueMl: 5_000,
            crepesTheoriques: 66,
            coutMatiereTheoriqueCents: 2_000,
            numeroLotPate: 'TEST-LOT-PATE-IMPACT',
            dateDlcPate: `${ANNEE}-0${MOIS}-08`,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        // 4. Une session, inseree directement — meme convention que
        // `creerSession` (describe `ventesParCreneauBrutes` plus bas).
        const idLieu = listerLieux(base)[0]!.id;
        base
          .insert(sessionMarche)
          .values({
            id: nouvelIdentifiant(),
            numero: 'TEST-SESS-IMPACT',
            lieuId: idLieu,
            dateSession: `${ANNEE}-0${MOIS}-07`,
            statut: 'cloturee',
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        // 5. Une depense ET une immobilisation dans le meme mois : doivent
        // apparaitre A PART, jamais dans les quatre comptes ci-dessus
        // (asymetrie documentee dans `calculerImpactVerrouillagePeriode`).
        enregistrerDepense(base, {
          dateDepense: `${ANNEE}-0${MOIS}-10`,
          libelle: 'Gaz test impact',
          categorie: 'carburant',
          montantCents: 3_000,
        });
        enregistrerImmobilisation(base, {
          libelle: 'Materiel test impact',
          dateAcquisition: `${ANNEE}-0${MOIS}-11`,
          montantCents: 50_000,
          dureeAmortissementAnnees: 5,
        });

        const { id: periodeId } = cloturerPeriode(base, ANNEE, MOIS, 'Le porteur du projet');
        const impact = calculerImpactVerrouillagePeriode(base, periodeId);

        expect(impact.periodeId).toBe(periodeId);
        expect(impact.annee).toBe(ANNEE);
        expect(impact.mois).toBe(MOIS);
        // Au moins les 2 entrees actives (la 3e reception, annulee, ajoute en
        // realite une contrepassation non annulee elle-meme — voir le
        // commentaire de fonction : ce point de non-retour la fige aussi).
        expect(impact.mouvementsStockNonAnnulesCount).toBeGreaterThanOrEqual(2);
        expect(impact.receptionsNonAnnuleesCount).toBe(2);
        expect(impact.productionsNonAnnuleesCount).toBe(1);
        expect(impact.sessionsNonAnnuleesCount).toBe(1);
        expect(impact.depensesCount).toBe(1);
        expect(impact.immobilisationsCount).toBe(1);
      },
    );

    it('exclut une production ANNULEE et une session ANNULEE du decompte : elles ne sont deja plus corrigibles, le verrou ne leur retire rien', () => {
      const ANNEE = 2039;
      const MOIS = 6;
      const idRecette = base.select({ id: recette.id }).from(recette).limit(1).get()!.id;
      const idLieu = listerLieux(base)[0]!.id;
      const maintenant = maintenantUtc();

      base
        .insert(production)
        .values({
          id: nouvelIdentifiant(),
          numero: 'TEST-PROD-ANNULEE',
          recetteId: idRecette,
          dateProduction: `${ANNEE}-0${MOIS}-06`,
          statut: 'annulee',
          volumeTheoriqueMl: 5_000,
          crepesTheoriques: 66,
          coutMatiereTheoriqueCents: 2_000,
          numeroLotPate: 'TEST-LOT-PATE-ANNULEE',
          dateDlcPate: `${ANNEE}-0${MOIS}-08`,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      base
        .insert(sessionMarche)
        .values({
          id: nouvelIdentifiant(),
          numero: 'TEST-SESS-ANNULEE',
          lieuId: idLieu,
          dateSession: `${ANNEE}-0${MOIS}-07`,
          statut: 'annulee',
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const { id: periodeId } = cloturerPeriode(base, ANNEE, MOIS, 'Le porteur du projet');
      const impact = calculerImpactVerrouillagePeriode(base, periodeId);

      expect(impact.productionsNonAnnuleesCount).toBe(0);
      expect(impact.sessionsNonAnnuleesCount).toBe(0);
    });
  });

  describe('synthese d exercice', () => {
    it('ne recalcule rien : delegue integralement a estimerResultat de @batte/core', () => {
      enregistrerDepense(base, {
        dateDepense: '2026-05-01',
        libelle: 'Farine T55',
        categorie: 'matiere',
        montantCents: 20_000,
      });

      const synthese = syntheseExercice(base, 2026);
      expect(synthese.annee).toBe(2026);
      expect(synthese.depensesDeductiblesCents).toBeGreaterThanOrEqual(20_000);
      // beneficeBrut = recettes - depenses deductibles - amortissements.
      expect(synthese.beneficeBrutCents).toBe(
        synthese.recettesCents - synthese.depensesDeductiblesCents - synthese.amortissementsCents,
      );
    });

    /**
     * PREUVE d'un risque de double comptage NON corrigé (signalé, jamais
     * tranché seul — même doctrine que D-052 pour la matière) : le gaz existe
     * DEUX FOIS dans l'application (docs/demandes/17 « le point central »,
     * docs/demandes/15 §4.1 « piège n° 2 ») —
     *
     *  1. comme CATÉGORIE D'INGRÉDIENT (`'gaz'`), achetée en bouteilles via
     *     une `reception` (achat de marchandise, compté dans
     *     `totalAchatsMarchandisesCents`) ;
     *  2. comme FRAIS DE SESSION (`session_marche.frais_gaz_cents`), saisi à
     *     la clôture (compté dans `fraisSessionCents`).
     *
     * Si les deux représentent la MÊME bouteille achetée, `syntheseExercice`
     * la compte deux fois — exactement le défaut déjà corrigé pour la matière
     * consommée en production (`coutMatiereCents`, volontairement exclu, voir
     * le commentaire de `syntheseExercice`). Aucune clé ne relie `reception`
     * (ou `lot`) à `session_marche.frais_gaz_cents` : ce test ne « corrige »
     * donc rien — il PROUVE que rien n'empêche aujourd'hui ce double comptage,
     * pour que la décision (laquelle des deux exclure, si l'une doit l'être)
     * revienne au porteur/comptable plutôt qu'à un choix silencieux du code.
     */
    it(
      'ne protège PAS contre le double comptage du gaz : une réception de gaz ET les frais de ' +
        'gaz de session s’additionnent toutes les deux dans les dépenses déductibles',
      () => {
        const EXERCICE_GAZ = 2033;
        const maintenant = maintenantUtc();
        const idFournisseur = nouvelIdentifiant();
        base
          .insert(fournisseur)
          .values({
            id: idFournisseur,
            nom: 'Fournisseur de gaz (test double comptage)',
            type: 'grossiste',
            delaiLivraisonJours: 3,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        const idGaz = nouvelIdentifiant();
        base
          .insert(ingredient)
          .values({
            id: idGaz,
            nom: 'Bouteille de gaz (test)',
            categorie: 'gaz',
            uniteReference: 'piece',
            allergenes: [],
            stockSecurite: 0,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        const avant = syntheseExercice(base, EXERCICE_GAZ);

        // 1. Achat RÉEL d'une bouteille de gaz, via le circuit stock (comme
        // l'exige CLAUDE.md §3 règle 6 : toute entrée de marchandise crée un
        // lot traçable).
        const { montantTotalCents: achatGazCents } = enregistrerReception(base, {
          fournisseurId: idFournisseur,
          dateReception: `${EXERCICE_GAZ}-03-10`,
          lignes: [
            {
              ingredientId: idGaz,
              quantite: 1,
              prixLigneCents: 5_000,
              numeroLotFournisseur: 'BOUTEILLE-TEST',
            },
          ],
        });
        expect(achatGazCents).toBe(5_000);

        // 2. La MÊME bouteille, consommée sur une session, ressaisie comme
        // frais de session (aucun lien technique entre les deux écritures).
        const idLieu = listerLieux(base)[0]!.id;
        const produit = listerProduitsVendables(base).find((p) => p.nature === 'transforme')!;
        const session = creerSession(base, {
          lieuId: idLieu,
          dateSession: `${EXERCICE_GAZ}-03-15`,
        });
        const frais = {
          emplacementCents: 0,
          deplacementCents: 0,
          gazCents: 600,
          diversCents: 0,
        };
        cloturerSession(base, session.id, {
          ventes: [
            { produitVenteId: produit.id, quantite: 1, prixUnitaireCents: produit.prixCents },
          ],
          frais,
          fondsCaisseInitialCents: 0,
          especesCompteesCents: produit.prixCents,
          caCarteCents: 0,
          crepesProduites: 1,
          crepesInvendues: 0,
          crepesCassees: 0,
          heureDebutReelle: '08:00',
          heureFinReelle: '14:30',
        });

        const apres = syntheseExercice(base, EXERCICE_GAZ);

        // Constat : l'écart cumule l'ACHAT ET les FRAIS de session, sans
        // qu'aucune ligne ne soit exclue pour éviter le doublon — à la
        // différence du coût matière analytique, qui LUI est exclu.
        expect(apres.depensesDeductiblesCents - avant.depensesDeductiblesCents).toBe(
          achatGazCents + frais.gazCents,
        );
      },
    );

    /**
     * PREUVE + CORRECTIF (30/07/2026) : `totalAchatsMarchandisesCents` lisait
     * TOUTES les réceptions de l'exercice, `annulee` comprises. Une réception
     * annulée est une CONTREPASSATION (D-038 appliqué à la réception, même
     * raisonnement que pour `production.statut`) : son stock est revenu à
     * zéro, elle ne doit donc plus peser sur les dépenses déductibles — sinon
     * une livraison saisie deux fois puis annulée restait comptée dans le
     * résultat de l'exercice alors que la marchandise qu'elle représentait
     * avait disparu du grand livre de stock.
     */
    it(
      'une réception ANNULÉE ne compte plus dans les achats de marchandises de la synthèse, ' +
        "alors qu'une réception active du même exercice compte toujours",
      () => {
        const EXERCICE_ANNULATION = 2034;
        const idFournisseurTest = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
        const idFarine = base
          .select({ id: ingredient.id })
          .from(ingredient)
          .where(eq(ingredient.nom, 'Farine de froment T55'))
          .get()!.id;

        const avant = syntheseExercice(base, EXERCICE_ANNULATION);
        const achatsAvant = totalAchatsMarchandisesCents(base, EXERCICE_ANNULATION);

        // Une réception qui restera ACTIVE : sert de témoin — son montant
        // doit rester compté après l'annulation de l'autre.
        enregistrerReception(base, {
          fournisseurId: idFournisseurTest,
          dateReception: `${EXERCICE_ANNULATION}-02-10`,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 1000,
              prixLigneCents: 3_000,
              numeroLotFournisseur: 'LOT-SYNTHESE-ACTIVE',
            },
          ],
        });

        // Une réception ANNULÉE : ne doit plus peser sur le résultat.
        const receptionAAnnuler = enregistrerReception(base, {
          fournisseurId: idFournisseurTest,
          dateReception: `${EXERCICE_ANNULATION}-03-05`,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 500,
              prixLigneCents: 7_000,
              numeroLotFournisseur: 'LOT-SYNTHESE-ANNULEE',
            },
          ],
        });

        annulerReception(base, receptionAAnnuler.receptionId, 'ERREUR_SAISIE');

        const apres = syntheseExercice(base, EXERCICE_ANNULATION);

        // Seul le montant de la réception ACTIVE (3 000 c) doit s'ajouter :
        // celui de la réception annulée (7 000 c) ne doit PAS s'y trouver.
        expect(apres.depensesDeductiblesCents - avant.depensesDeductiblesCents).toBe(3_000);

        const achatsApres = totalAchatsMarchandisesCents(base, EXERCICE_ANNULATION);
        expect(achatsApres - achatsAvant).toBe(3_000);
      },
    );

    /**
     * Audit du 30/07/2026 : `frais_reception` (transport, palette…) était
     * écrite par `enregistrerFacture` puis ventilée sur `lot.prixLigneCents`,
     * mais jamais RELUE — ni par un dépôt, ni par une route. Ce décaissement
     * réel (facturé APRÈS la réception, donc absent de
     * `reception.montantTotalCents`, figé au bon de livraison) restait donc
     * invisible de toute charge de l'exercice.
     */
    it('totalFraisReceptionCents lit les frais de réception ventilés par une facture, sur la date de la réception', () => {
      const EXERCICE_FRAIS = 2035;
      // COMMERCIAL, jamais le fournisseur SYSTÈME : `enregistrerFacture`
      // refuse désormais explicitement une facture à son nom (mission
      // « garde-fou fournisseur système », 31/07/2026) — un `.get()` sans
      // `where` ramenait parfois « Inventaire d'ouverture », le premier
      // fournisseur seedé, et ce test n'a jamais eu besoin que ce soit LUI.
      const idFournisseurTest = base
        .select({ id: fournisseur.id })
        .from(fournisseur)
        .where(ne(fournisseur.type, 'systeme'))
        .get()!.id;
      const idFarine = base
        .select({ id: ingredient.id })
        .from(ingredient)
        .where(eq(ingredient.nom, 'Farine de froment T55'))
        .get()!.id;

      const avant = totalFraisReceptionCents(base, EXERCICE_FRAIS);

      const reception = enregistrerReception(base, {
        fournisseurId: idFournisseurTest,
        dateReception: `${EXERCICE_FRAIS}-04-10`,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 5_000,
            numeroLotFournisseur: 'LOT-FRAIS-RECEPTION',
          },
        ],
      });

      // La facture arrive APRÈS la réception, avec un frais de transport
      // (aucun `ingredientId`) en plus de la ligne de marchandise rapprochée.
      enregistrerFacture(base, {
        numeroFournisseur: 'FACT-FRAIS-TEST',
        fournisseurId: idFournisseurTest,
        dateFacture: `${EXERCICE_FRAIS}-04-15`,
        lignes: [
          {
            libelle: 'Farine de froment T55',
            montantCents: 5_000,
            receptionId: reception.receptionId,
            ingredientId: idFarine,
          },
          {
            libelle: 'Transport',
            montantCents: 800,
            receptionId: reception.receptionId,
          },
        ],
      });

      const apres = totalFraisReceptionCents(base, EXERCICE_FRAIS);
      expect(apres - avant).toBe(800);
    });

    it(
      'syntheseExercice compte le frais de réception EN PLUS des achats de marchandises, sans ' +
        'les compter deux fois',
      () => {
        const EXERCICE_FRAIS_SYNTHESE = 2036;
        // COMMERCIAL, jamais le fournisseur SYSTÈME — voir le commentaire du
        // test précédent.
        const idFournisseurTest = base
          .select({ id: fournisseur.id })
          .from(fournisseur)
          .where(ne(fournisseur.type, 'systeme'))
          .get()!.id;
        const idFarine = base
          .select({ id: ingredient.id })
          .from(ingredient)
          .where(eq(ingredient.nom, 'Farine de froment T55'))
          .get()!.id;

        const avant = syntheseExercice(base, EXERCICE_FRAIS_SYNTHESE);

        const reception = enregistrerReception(base, {
          fournisseurId: idFournisseurTest,
          dateReception: `${EXERCICE_FRAIS_SYNTHESE}-05-10`,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 1000,
              prixLigneCents: 5_000,
              numeroLotFournisseur: 'LOT-FRAIS-SYNTHESE',
            },
          ],
        });

        enregistrerFacture(base, {
          numeroFournisseur: 'FACT-FRAIS-SYNTHESE',
          fournisseurId: idFournisseurTest,
          dateFacture: `${EXERCICE_FRAIS_SYNTHESE}-05-12`,
          lignes: [
            {
              libelle: 'Transport',
              montantCents: 1_200,
              receptionId: reception.receptionId,
            },
          ],
        });

        const apres = syntheseExercice(base, EXERCICE_FRAIS_SYNTHESE);

        // L'achat de marchandise (5 000) ET le frais de réception (1 200)
        // s'additionnent, chacun une seule fois : ni double compte, ni oubli.
        expect(apres.depensesDeductiblesCents - avant.depensesDeductiblesCents).toBe(5_000 + 1_200);
      },
    );

    it('un frais de réception rattaché à une réception ANNULÉE ne compte plus dans la synthèse', () => {
      const EXERCICE_FRAIS_ANNULE = 2037;
      // COMMERCIAL, jamais le fournisseur SYSTÈME — voir le commentaire du
      // premier test de ce groupe.
      const idFournisseurTest = base
        .select({ id: fournisseur.id })
        .from(fournisseur)
        .where(ne(fournisseur.type, 'systeme'))
        .get()!.id;
      const idFarine = base
        .select({ id: ingredient.id })
        .from(ingredient)
        .where(eq(ingredient.nom, 'Farine de froment T55'))
        .get()!.id;

      const reception = enregistrerReception(base, {
        fournisseurId: idFournisseurTest,
        dateReception: `${EXERCICE_FRAIS_ANNULE}-06-10`,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 5_000,
            numeroLotFournisseur: 'LOT-FRAIS-ANNULE',
          },
        ],
      });

      enregistrerFacture(base, {
        numeroFournisseur: 'FACT-FRAIS-ANNULE',
        fournisseurId: idFournisseurTest,
        dateFacture: `${EXERCICE_FRAIS_ANNULE}-06-12`,
        lignes: [
          {
            libelle: 'Transport',
            montantCents: 900,
            receptionId: reception.receptionId,
          },
        ],
      });

      const avecFraisActif = totalFraisReceptionCents(base, EXERCICE_FRAIS_ANNULE);

      annulerReception(base, reception.receptionId, 'ERREUR_SAISIE');

      const apresAnnulation = totalFraisReceptionCents(base, EXERCICE_FRAIS_ANNULE);
      expect(apresAnnulation).toBe(avecFraisActif - 900);
    });
  });
});

/**
 * `ventesParCreneauBrutes` (fiche 13, docs/17) — descendue depuis une requête
 * Drizzle qui vivait directement dans `apps/api/src/routes/comptabilite.ts`
 * (CLAUDE.md §3 règle 1). Les sessions sont créées par INSERTION DIRECTE dans
 * `session_marche` / `session_vente` plutôt qu'en passant par
 * `cloturerSession` : cela donne un contrôle exact sur le statut, la marge et
 * le créneau de chaque ligne, ce dont ce test a besoin. La couverture de
 * l'agrégat lui-même (`agregerVentesParCreneau`) vit déjà dans
 * `packages/core/src/contrats/comptabilite.test.ts` ; ce test-ci vérifie
 * seulement que la requête SQL filtre bien par statut et par exercice.
 */
describe('ventesParCreneauBrutes', () => {
  let base: BaseBatte;
  let lieuId: string;
  let produitVenteId: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const lieu = listerLieux(base)[0];
    const produit = listerProduitsVendables(base)[0];
    if (lieu === undefined) throw new Error('Aucun lieu semé.');
    if (produit === undefined) throw new Error('Aucun produit vendable semé.');
    lieuId = lieu.id;
    produitVenteId = produit.id;
  });

  function creerSession(id: string, statut: 'cloturee' | 'planifiee', dateSession: string): void {
    base
      .insert(sessionMarche)
      .values({
        id,
        numero: `TEST-${id}`,
        lieuId,
        dateSession,
        statut,
        margeBruteCents: 1000,
        margeNetteCents: 800,
        creeLe: maintenantUtc(),
        modifieLe: maintenantUtc(),
      })
      .run();
  }

  function creerVente(
    sessionId: string,
    creneauHoraire: string | null,
    montantCents: number,
  ): void {
    base
      .insert(sessionVente)
      .values({
        id: nouvelIdentifiant(),
        sessionId,
        produitVenteId,
        quantite: 1,
        prixUnitaireCents: montantCents,
        montantCents,
        creneauHoraire,
      })
      .run();
  }

  it('ne rend que les ventes des sessions CLOTUREES de l’exercice demandé', () => {
    creerSession('sess-cloturee-2026', 'cloturee', '2026-07-15');
    creerVente('sess-cloturee-2026', '10:00-12:00', 5000);

    creerSession('sess-planifiee-2026', 'planifiee', '2026-07-16');
    creerVente('sess-planifiee-2026', '10:00-12:00', 3000);

    creerSession('sess-cloturee-2025', 'cloturee', '2025-07-15');
    creerVente('sess-cloturee-2025', '10:00-12:00', 7000);

    const lignes = ventesParCreneauBrutes(base, 2026);

    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.sessionId).toBe('sess-cloturee-2026');
    expect(lignes[0]?.montantCents).toBe(5000);
    expect(lignes[0]?.margeBruteSessionCents).toBe(1000);
    expect(lignes[0]?.margeNetteSessionCents).toBe(800);
  });

  it('rend une liste vide sans exercice correspondant, jamais une erreur', () => {
    creerSession('sess-2025', 'cloturee', '2025-01-10');
    creerVente('sess-2025', null, 1000);

    expect(ventesParCreneauBrutes(base, 2030)).toEqual([]);
  });
});
