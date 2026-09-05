/**
 * Le rythme de sessions qui sert a PROJETER les seuils legaux vient de la table
 * `parametre`, jamais d'un litteral.
 *
 * Pourquoi ce fichier existe : `apps/api/src/routes/sessions.ts` portait
 * `const SESSIONS_PAR_AN = 52`, sous un commentaire qui affirmait exactement
 * l'inverse (« deduit du rythme reel du lieu et non code en dur a 52 »). Le
 * commentaire mentait, et une valeur metier vivait dans un handler HTTP —
 * double faute au regard de CLAUDE.md §7 et de la regle d'architecture n°1.
 *
 * L'enjeu n'est pas cosmetique. La projection decide de l'ALERTE de sortie de
 * franchise TVA. 52 est l'hypothese haute (un marche par semaine, sans un seul
 * congé) : elle alerte trop tot, ce qui est le sens prudent de l'erreur. Mais
 * l'utilisateur doit pouvoir la corriger quand il connait son vrai rythme, et
 * c'est impossible tant que le nombre est compile dans le serveur.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, type BaseBatte } from './client.js';
import { migrer } from './migrer.js';
import { seed } from './seed/index.js';
import { seedDemonstration } from './seed/demonstration.js';
import { seedDemonstrationActivite } from './seed/activite.js';
import { lieuMarche, parametre, produitVente } from './schema.js';
import { tableauSeuils } from './depots/sessions.js';
import { listerEcheances, syntheseExercice } from './depots/comptabilite.js';
import { cloturerSession, creerSession } from './services/sessions.js';

const ANNEE = 2026;
const CLE_RYTHME = 'seuils_sessions_prevues_par_an';

describe('projection des seuils legaux — le rythme est un parametre', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idCrepe: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idCrepe = base.select({ id: produitVente.id }).from(produitVente).get()!.id;
  });

  /** Deux sessions closes : en dessous, `projeterSeuil` refuse de projeter. */
  function deuxSessionsCloses(): void {
    for (const jour of [`${ANNEE}-08-02`, `${ANNEE}-08-09`]) {
      const session = creerSession(base, { lieuId: idLieu, dateSession: jour });
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idCrepe, quantite: 24, prixUnitaireCents: 300 }],
        frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
        fondsCaisseInitialCents: 6000,
        especesCompteesCents: 6000 + 7200,
        caCarteCents: 0,
        crepesProduites: 30,
        crepesInvendues: 5,
        crepesCassees: 1,
        heureDebutReelle: '08:00',
        heureFinReelle: '14:30',
      });
    }
  }

  /**
   * Ecrit la valeur du parametre a la date ou `tableauSeuils` le lit.
   *
   * Ecriture directe et non versionnee : ce test ne teste pas le versionnage,
   * il teste que la lecture a lieu. Le rendre dependant du mecanisme de
   * versionnage le ferait echouer pour une raison sans rapport.
   */
  function fixerRythme(valeur: number): void {
    base
      .update(parametre)
      .set({ valeur: String(valeur), modifieLe: maintenantUtc() })
      .where(eq(parametre.cle, CLE_RYTHME))
      .run();
  }

  it('la cle existe au catalogue et est peuplee par la graine', () => {
    const ligne = base.select().from(parametre).where(eq(parametre.cle, CLE_RYTHME)).get();
    expect(ligne).toBeDefined();
    expect(Number.parseInt(ligne!.valeur, 10)).toBeGreaterThan(0);
  });

  it('la projection suit le parametre, elle ne suit pas un 52 compile', () => {
    deuxSessionsCloses();

    fixerRythme(52);
    const a = tableauSeuils(base, ANNEE);
    const franchiseA = a.data.find((c) => c.cle === 'seuil_franchise_tva_cents')!;

    fixerRythme(26);
    const b = tableauSeuils(base, ANNEE);
    const franchiseB = b.data.find((c) => c.cle === 'seuil_franchise_tva_cents')!;

    // Le realise ne bouge pas : seule l'HYPOTHESE de fin d'annee change.
    expect(franchiseB.realiseCents).toBe(franchiseA.realiseCents);

    // C'est LE test : avec un 52 code en dur, les deux projections seraient
    // identiques et cette assertion tomberait.
    expect(franchiseA.projectionFinAnneeCents).not.toBeNull();
    expect(franchiseB.projectionFinAnneeCents).toBe(
      Math.round(franchiseA.projectionFinAnneeCents! / 2),
    );
  });

  it('la projection vaut le rythme moyen constate multiplie par le rythme attendu', () => {
    deuxSessionsCloses();
    fixerRythme(40);

    const seuils = tableauSeuils(base, ANNEE);
    const franchise = seuils.data.find((c) => c.cle === 'seuil_franchise_tva_cents')!;

    // Formule derivee de la source de verite lue, jamais un nombre fige : la
    // graine peut deplacer le CA de demonstration sans invalider la regle.
    expect(franchise.projectionFinAnneeCents).toBe(
      Math.round((franchise.realiseCents / seuils.meta.sessionsTenues) * 40),
    );
  });

  it('une seule session ne projette rien, quel que soit le rythme parametre', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: `${ANNEE}-08-02` });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idCrepe, quantite: 24, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
      fondsCaisseInitialCents: 6000,
      especesCompteesCents: 6000 + 7200,
      caCarteCents: 0,
      crepesProduites: 30,
      crepesInvendues: 5,
      crepesCassees: 1,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
    });

    fixerRythme(52);
    const seuils = tableauSeuils(base, ANNEE);
    expect(seuils.meta.sessionsTenues).toBe(1);
    // Un point ne fait pas un rythme. Extrapoler dessus fabriquerait une alerte
    // legale sur une seule journee de marche.
    for (const compteur of seuils.data) {
      expect(compteur.projectionFinAnneeCents).toBeNull();
    }
  });
});

/**
 * L'horizon d'alerte des echeances reglementaires etait ecrit EN DUR, a 30,
 * dans DEUX composants React (`TableauDeBord.tsx` et `Comptabilite.tsx`),
 * chacun renvoyant a l'autre en commentaire. Deux fautes en une : une regle
 * metier dans un composant (regle d'architecture n°1) et une duplication qui
 * ne pouvait diverger que d'un seul cote.
 */
describe("horizon d'alerte des echeances — parametre, et calcule cote serveur", () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  function fixerHorizon(jours: number): void {
    base
      .update(parametre)
      .set({ valeur: String(jours), modifieLe: maintenantUtc() })
      .where(eq(parametre.cle, 'echeance_horizon_alerte_jours'))
      .run();
  }

  it('la liste porte `alerteProche` : l ecran n a plus a decider du seuil', () => {
    const lignes = listerEcheances(base);
    expect(lignes.length).toBeGreaterThan(0);
    for (const l of lignes) {
      expect(typeof l.alerteProche).toBe('boolean');
    }
  });

  it("elargir l'horizon fait entrer des echeances en alerte, le reduire les en sort", () => {
    fixerHorizon(1);
    const etroit = listerEcheances(base).filter((l) => l.alerteProche).length;

    fixerHorizon(400);
    const large = listerEcheances(base).filter((l) => l.alerteProche).length;

    // Avec un 30 compile dans l'ecran, ces deux nombres seraient identiques.
    expect(large).toBeGreaterThan(etroit);

    // Et l'alerte reste EXACTEMENT le predicat annonce, pas une approximation.
    // Attention : toutes les echeances ne rentrent pas dans 400 jours — la
    // recurrence quinquennale de l'autorisation ambulante peut etre a cinq ans.
    // Asserter « toutes les non-faites » serait faux pour une bonne raison.
    const lignes = listerEcheances(base);
    expect(large).toBe(
      lignes.filter((l) => l.statut !== 'faite' && l.joursAvantEcheance <= 400).length,
    );
  });

  it("l'alerte suit exactement le seuil lu, borne comprise", () => {
    const reference = listerEcheances(base).find((l) => l.statut !== 'faite');
    expect(reference).toBeDefined();
    const jours = reference!.joursAvantEcheance;

    // Borne INCLUSE : a exactement `jours`, l'echeance alerte deja.
    fixerHorizon(jours);
    expect(listerEcheances(base).find((l) => l.id === reference!.id)!.alerteProche).toBe(true);

    fixerHorizon(jours - 1);
    expect(listerEcheances(base).find((l) => l.id === reference!.id)!.alerteProche).toBe(false);
  });
});

/**
 * Chaque seuil legal est confronte a SON assiette.
 *
 * Les trois compteurs recevaient le meme `realiseCents` — le chiffre
 * d'affaires — alors que `seuil_cotisation_reduite_cents` porte sur un REVENU
 * NET. Le champ `assiette` etait deja declare sur les trois definitions et
 * n'etait lu nulle part : l'intention etait posee, le cablage manquait.
 *
 * Le SENS de l'erreur est ce qui la rend insidieuse. Le net etant toujours
 * inferieur au CA, l'alerte ne pouvait pas arriver trop tard — elle arrivait
 * trop TOT (facteur ~2,3 au rythme de reference de CLAUDE.md §6). Un compteur
 * qui crie au loup desensibilise l'utilisateur aux deux vrais compteurs de CA,
 * ceux qui peuvent lui faire perdre la franchise TVA sans prevenir.
 */
describe('assiette des seuils legaux — CA ou revenu net, jamais confondus', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    seedDemonstrationActivite(base);
  });

  it('les deux seuils de CA portent le meme realise, le seuil de revenu net en porte un AUTRE', () => {
    const seuils = tableauSeuils(base, ANNEE);
    const parCle = new Map(seuils.data.map((c) => [c.cle, c]));

    const tva = parCle.get('seuil_franchise_tva_cents')!;
    const airbag = parCle.get('seuil_airbag_cents')!;
    const cotisation = parCle.get('seuil_cotisation_reduite_cents')!;

    // Les deux seuils de chiffre d'affaires mesurent la meme chose.
    expect(airbag.realiseCents).toBe(tva.realiseCents);

    // Celui-ci NON. C'est tout le test : avant la correction, les trois etaient
    // egaux, et cette assertion tombait.
    expect(cotisation.realiseCents).not.toBe(tva.realiseCents);
  });

  it('le realise du seuil de revenu net est INFERIEUR au chiffre d affaires', () => {
    const seuils = tableauSeuils(base, ANNEE);
    const parCle = new Map(seuils.data.map((c) => [c.cle, c]));
    const cotisation = parCle.get('seuil_cotisation_reduite_cents')!;

    // Invariant economique, pas une valeur figee : un revenu net se deduit du
    // CA en retranchant charges, amortissements, cotisations et impot. Il ne
    // peut donc jamais le depasser sur un exercice beneficiaire.
    expect(cotisation.realiseCents).toBeLessThan(
      seuils.meta.caTransformeCents + seuils.meta.caRevenduCents,
    );
    expect(cotisation.realiseCents).toBeGreaterThanOrEqual(0);
  });

  it('le realise du seuil de revenu net EGALE le net estime de la synthese', () => {
    // Derive de la source de verite, jamais recopie : si `syntheseExercice`
    // change sa formule, ce test suit au lieu de casser.
    const seuils = tableauSeuils(base, ANNEE);
    const cotisation = seuils.data.find((c) => c.cle === 'seuil_cotisation_reduite_cents')!;

    expect(cotisation.realiseCents).toBe(syntheseExercice(base, ANNEE).netEstimeCents);
  });
});

/**
 * `echeance_e604b_tolerance_cents` (27 500 €, plafond de TOLERANCE du regime a
 * deux etages de la franchise TVA, docs/07-DOCTRINE-ERP-ET-DESIGN.md §6.6)
 * avait ete extraite de la PROSE de `CATALOGUE_ECHEANCES` vers une colonne
 * numerique dediee (docs/29-VALEURS-EN-DUR.md §6 point 1), mais n'etait lue
 * NULLE PART — un audit d'orphelins (`audit-colonnes-orphelines.test.ts`) l'a
 * signalee.
 *
 * CABLE le 01/08/2026 : reutilise `statutParPlafond` (le MEME mecanisme
 * d'alerte a 80 % que les trois autres seuils legaux, CLAUDE.md §6),
 * applique a ce second plafond, sur la MEME assiette (CA total) que la
 * franchise TVA elle-meme — voir `CompteurSeuilEnrichi.toleranceE604b`
 * (`depots/sessions.ts`).
 */
describe('tolerance e604B — regime a deux etages de la franchise TVA', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idCrepe: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idCrepe = base.select({ id: produitVente.id }).from(produitVente).get()!.id;
  });

  /** Une session close, CA total EXACTEMENT 7200 c (24 crêpes à 300 c). */
  function uneSessionClose(): void {
    const session = creerSession(base, { lieuId: idLieu, dateSession: `${ANNEE}-08-02` });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idCrepe, quantite: 24, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
      fondsCaisseInitialCents: 6000,
      especesCompteesCents: 6000 + 7200,
      caCarteCents: 0,
      crepesProduites: 30,
      crepesInvendues: 5,
      crepesCassees: 1,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
    });
  }

  /** Ecriture directe, comme `fixerRythme`/`fixerHorizon` ci-dessus : ce test
   * ne teste pas le versionnage des parametres, seulement que la lecture a lieu. */
  function fixerToleranceE604b(valeurCents: number): void {
    base
      .update(parametre)
      .set({ valeur: String(valeurCents), modifieLe: maintenantUtc() })
      .where(eq(parametre.cle, 'echeance_e604b_tolerance_cents'))
      .run();
  }

  it("n'existe QUE sur la franchise TVA — `null` sur les trois autres seuils", () => {
    uneSessionClose();
    const seuils = tableauSeuils(base, ANNEE);

    for (const compteur of seuils.data) {
      if (compteur.cle === 'seuil_franchise_tva_cents') {
        expect(compteur.toleranceE604b).not.toBeNull();
      } else {
        expect(compteur.toleranceE604b).toBeNull();
      }
    }
  });

  it('conforme sous 80 % du plafond de tolerance PARAMETRE', () => {
    uneSessionClose(); // CA total = 7200 c
    fixerToleranceE604b(20_000); // 80 % = 16 000 c > 7 200 c

    const seuils = tableauSeuils(base, ANNEE);
    const tva = seuils.data.find((c) => c.cle === 'seuil_franchise_tva_cents')!;

    expect(tva.toleranceE604b).toEqual({ plafondCents: 20_000, statut: 'conforme' });
  });

  it('alerte entre 80 % et 100 % du plafond de tolerance PARAMETRE', () => {
    uneSessionClose(); // CA total = 7200 c
    fixerToleranceE604b(8_000); // 80 % = 6 400 c <= 7 200 c < 8 000 c

    const seuils = tableauSeuils(base, ANNEE);
    const tva = seuils.data.find((c) => c.cle === 'seuil_franchise_tva_cents')!;

    expect(tva.toleranceE604b).toEqual({ plafondCents: 8_000, statut: 'alerte' });
  });

  it('depassement au-dela du plafond de tolerance PARAMETRE — perte immediate de la franchise', () => {
    uneSessionClose(); // CA total = 7200 c
    fixerToleranceE604b(5_000); // < 7 200 c : le CA REALISE depasse deja la tolerance

    const seuils = tableauSeuils(base, ANNEE);
    const tva = seuils.data.find((c) => c.cle === 'seuil_franchise_tva_cents')!;

    expect(tva.toleranceE604b).toEqual({ plafondCents: 5_000, statut: 'depassement' });
  });

  it('suit le PARAMETRE et non une constante figee : deux plafonds differents donnent deux statuts differents pour le MEME CA', () => {
    uneSessionClose(); // CA total = 7200 c, INCHANGE entre les deux lectures

    fixerToleranceE604b(20_000);
    const large = tableauSeuils(base, ANNEE).data.find(
      (c) => c.cle === 'seuil_franchise_tva_cents',
    )!;

    fixerToleranceE604b(5_000);
    const etroit = tableauSeuils(base, ANNEE).data.find(
      (c) => c.cle === 'seuil_franchise_tva_cents',
    )!;

    // Avant le cablage, `toleranceE604b` valait toujours `null` : cette
    // assertion a elle seule prouve que le parametre est bien LU.
    expect(large.toleranceE604b?.statut).toBe('conforme');
    expect(etroit.toleranceE604b?.statut).toBe('depassement');
  });
});

/**
 * Les deux montants de reference de la contribution AFSCA
 * (`echeance_contribution_afsca_avec_autorisation_cents` = 102,71 €,
 * `echeance_contribution_afsca_sans_autorisation_cents` = 51,36 €) avaient ete
 * extraits de la PROSE de `CATALOGUE_ECHEANCES` vers des colonnes numeriques
 * dediees, mais n'etaient lus NULLE PART.
 *
 * CABLE le 01/08/2026, sans jamais choisir a la place du porteur (aucun
 * signal en base ne dit si CET etablissement tient une autorisation AFSCA ou
 * un simple enregistrement) : les DEUX montants sont exposes CÔTE A CÔTE sur
 * la ligne « Contribution annuelle AFSCA », `null` sur toutes les autres —
 * voir `EcheanceLigne.montantsReferenceAfscaCents` (`depots/comptabilite.ts`).
 */
describe('montants de reference AFSCA — cote a cote, jamais choisis a la place du porteur', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  function fixerMontantAfsca(cle: string, valeurCents: number): void {
    base
      .update(parametre)
      .set({ valeur: String(valeurCents), modifieLe: maintenantUtc() })
      .where(eq(parametre.cle, cle))
      .run();
  }

  it("n'existe QUE sur « Contribution annuelle AFSCA » — `null` sur toutes les autres echeances", () => {
    const lignes = listerEcheances(base);
    const afsca = lignes.find((l) => l.libelle === 'Contribution annuelle AFSCA')!;
    expect(afsca.montantsReferenceAfscaCents).not.toBeNull();

    for (const l of lignes) {
      if (l.id !== afsca.id) expect(l.montantsReferenceAfscaCents).toBeNull();
    }
  });

  it('porte les deux valeurs PAR DEFAUT du catalogue (102,71 € et 51,36 €)', () => {
    const afsca = listerEcheances(base).find((l) => l.libelle === 'Contribution annuelle AFSCA')!;
    expect(afsca.montantsReferenceAfscaCents).toEqual({
      avecAutorisationCents: 10_271,
      sansAutorisationCents: 5_136,
    });
  });

  it('suit le PARAMETRE et non une constante figee : modifier une valeur en base la change ici', () => {
    fixerMontantAfsca('echeance_contribution_afsca_avec_autorisation_cents', 11_000);
    fixerMontantAfsca('echeance_contribution_afsca_sans_autorisation_cents', 6_000);

    const afsca = listerEcheances(base).find((l) => l.libelle === 'Contribution annuelle AFSCA')!;
    // Avant le cablage, ce champ n'existait pas : cette assertion a elle
    // seule prouve que les DEUX parametres sont bien LUS, pas devines.
    expect(afsca.montantsReferenceAfscaCents).toEqual({
      avecAutorisationCents: 11_000,
      sansAutorisationCents: 6_000,
    });
  });
});
