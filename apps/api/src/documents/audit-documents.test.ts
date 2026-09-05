/**
 * Audit dédié des documents générés (mission du 29/07/2026) — PDF, Excel, et
 * tout ce qui sort de l'application pour être imprimé ou envoyé.
 *
 * CLAUDE.md §7 : « ne jamais générer de document qui minore un chiffre
 * d'affaires… le registre enregistre ce qui a été saisi. » Chaque test ici
 * appelle la chaîne RÉELLE (dépôt → assemblage `donnees.ts` → gabarit →
 * `rendrePdf`/Excel), jamais un gabarit isolé sur des données inventées à la
 * main sans passer par la base : c'est la seule façon de vérifier qu'un cas
 * réel (période vide, ingrédient sans prix, lot détruit) produit vraiment un
 * fichier, et que ce fichier dit ce que la base sait — ni plus (un total
 * recalculé dans le gabarit), ni moins (un `null` ramené à zéro).
 *
 * Convention de ce fichier : les cas qui engagent la génération PDF réelle
 * (Playwright) sont regroupés au minimum nécessaire — chacun vérifie une
 * chaîne complète au moins une fois — les variantes supplémentaires du même
 * gabarit sont vérifiées au niveau du HTML produit (même fonction de rendu,
 * pas de raccourci), ce qui reste une vérification RÉELLE de ce qui serait
 * imprimé, sans payer un démarrage de Chromium par variante.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import {
  annulerReception,
  changerStatutLot,
  cloturerSession,
  creerBase,
  creerCompositionMenu,
  creerSession,
  declarerNonConformite,
  enregistrerReception,
  enregistrerReleveTemperature,
  migrer,
  schema,
  seed,
  type BaseBatte,
} from '@batte/db';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import {
  donneesAffichetteAllergenes,
  donneesExportMouvements,
  donneesExportStock,
  donneesFicheTechnique,
  donneesJournalAchats,
  donneesJournalRecettes,
  donneesRapportSession,
  donneesRegistreAfsca,
  dernierJourDuMois,
} from './donnees.js';
import { affichetteAllergenes, ficheTechnique, rapportSession } from './gabarits.js';
import { registreAfscaMensuel } from './registre-afsca.js';
import { exportJournalAchats, exportJournalRecettes, exportMouvementsStock } from './excel.js';
import { fermerNavigateur, rendrePdf } from './rendu.js';

// Voir le commentaire de `rendu.test.ts` : le démarrage de Chromium n'est pas
// une opération à durée fixe, et ce fichier en déclenche un lui aussi.
//
// `hookTimeout` AJOUTÉ le 31/07/2026 : seul `testTimeout` était relevé ici, or
// chacun des `afterAll` de ce fichier ferme Chromium (`fermerNavigateur`), une
// opération couverte par `hookTimeout` (défaut Vitest 10 s), jamais par
// `testTimeout`. Diagnostic d'un 500 intermittent sur
// `/api/documents/affichette-allergenes` (visible seulement en suite complète) :
// sur une exécution complète de ~180 fichiers dont 5 lancent Chromium, ces
// `afterAll` ont mesurément dépassé 10 s sous la contention réelle de
// plusieurs instances Chromium simultanées (« Hook timed out in 10000ms »,
// voir le rapport de livraison) — jamais reproduit fichier seul.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const TIRET_ABSENT = '—';

function creerIngredientTest(
  base: BaseBatte,
  nom: string,
  surcharges: Partial<{
    dureeConservationJours: number | null;
    allergenesVerifies: boolean;
  }> = {},
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.ingredient)
    .values({
      id,
      nom,
      categorie: 'garniture',
      uniteReference: 'g',
      allergenes: [],
      // Verifie par defaut, et ce n'est pas une commodite : les ingredients de
      // ces fixtures representent des ingredients que le porteur a reellement
      // passes en revue, ce qui est l'hypothese des assertions de ce fichier —
      // elles controlent la PROPAGATION des allergenes (recette, garniture,
      // composant, menu), pas l'avertissement d'absence d'evaluation.
      //
      // Sans ce defaut, les documents affichaient a juste titre « allergenes
      // non encore verifies » et les assertions tombaient : un defaut de
      // fixture qui ressemblait a un defaut de code. Le chemin inverse — un
      // ingredient jamais evalue — a son propre fichier,
      // `allergenes-verifies.test.ts`, ou il est couvert par 16 tests.
      allergenesVerifies: surcharges.allergenesVerifies ?? true,
      stockSecurite: 0,
      dureeConservationJours: surcharges.dureeConservationJours ?? null,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function creerFournisseurTest(base: BaseBatte, nom: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.fournisseur)
    .values({
      id,
      nom,
      type: 'grossiste',
      delaiLivraisonJours: 2,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

/** Produit de vente minimal, sans recette (le cas du café, fiche 15 §4). */
function creerProduitVenteTest(base: BaseBatte, nom: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.produitVente)
    .values({
      id,
      nom,
      nature: 'transforme',
      recetteId: null,
      ingredientId: null,
      prixCents: 250,
      nbCrepes: null,
      volumeMlParUnite: null,
      categorie: 'boisson',
      consommationSurPlace: false,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

/** Composant de nomenclature de VENTE (fiche 15) : ce qu'un produit consomme à la vente. */
function creerComposantVenteTest(
  base: BaseBatte,
  produitVenteId: string,
  ingredientId: string,
  optionnel: boolean,
): void {
  const maintenant = maintenantUtc();
  base
    .insert(schema.produitVenteComposant)
    .values({
      id: nouvelIdentifiant(),
      produitVenteId,
      ingredientId,
      quantiteUniteRef: 1,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
}

function creerConditionnementActif(
  base: BaseBatte,
  ingredientId: string,
  fournisseurId: string,
  prixCents: number,
  quantiteUniteRef: number,
): void {
  const maintenant = maintenantUtc();
  base
    .insert(schema.conditionnement)
    .values({
      id: nouvelIdentifiant(),
      ingredientId,
      fournisseurId,
      libelle: 'Conditionnement de test',
      quantiteUniteRef,
      prixCents,
      datePrix: '2026-01-01',
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
}

function creerRecetteTest(
  base: BaseBatte,
  code: string,
  lignes: readonly {
    ingredientId: string;
    quantiteUniteRef: number;
    /** Note du geste pour cette ligne. `null`/absente : aucune note (cas normal). */
    noteTechnique?: string | null;
  }[],
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.recette)
    .values({
      id,
      code,
      nom: `Recette de test ${code}`,
      version: 1,
      statut: 'active',
      typePate: 'froment',
      sansGluten: false,
      rendementReferenceMl: 5000,
      rendementReferenceCrepes: 66,
      perteCuissonBp: 0,
      tauxCasseBp: 0,
      perteFixeMl: 0,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  base
    .insert(schema.recetteLigne)
    .values(
      lignes.map((l, index) => ({
        id: nouvelIdentifiant(),
        recetteId: id,
        ingredientId: l.ingredientId,
        quantiteUniteRef: l.quantiteUniteRef,
        ordre: index,
        noteTechnique: l.noteTechnique ?? null,
      })),
    )
    .run();

  return id;
}

describe('Audit documents — Registre AFSCA sur une période sans aucune donnée', () => {
  let base: BaseBatte;
  const cheminsCrees: string[] = [];

  beforeAll(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  afterAll(async () => {
    await fermerNavigateur();
    for (const chemin of cheminsCrees) {
      if (existsSync(chemin)) rmSync(chemin, { force: true });
    }
  });

  it(
    'se génère réellement (PDF non vide) et affiche chaque section comme VIDE, ' +
      'jamais comme conforme ou à zéro',
    async () => {
      // Année choisie loin de toute donnée de graine ou d'un autre test de ce
      // fichier : c'est la seule façon d'être sûr que la période est
      // RÉELLEMENT vide, pas vide par coïncidence de filtre.
      const donnees = donneesRegistreAfsca(base, 2019, 3);

      expect(donnees.temperatures).toHaveLength(0);
      expect(donnees.nettoyages).toHaveLength(0);
      expect(donnees.nonConformites).toHaveLength(0);
      expect(donnees.exercicesTracabilite).toHaveLength(0);

      const { html } = registreAfscaMensuel(donnees);
      // Chaque section VIDE doit le DIRE, jamais rendre un tableau qui
      // suggérerait « rien à signaler » de façon indiscernable d'un tableau
      // simplement absent.
      expect(html).toContain('Aucun relevé sur la période.');
      expect(html).toContain('Aucune exécution enregistrée sur la période.');
      expect(html).toContain('Aucune non-conformité constatée sur la période.');
      expect(html).toContain('Aucun exercice réalisé sur la période.');
      // La mention réglementaire doit être présente : un registre imprimé sera
      // lu hors contexte, potentiellement par l'agent qui contrôle (CLAUDE.md §7).
      expect(html).toContain('ne remplace ni un contrôle AFSCA');

      const doc = await rendrePdf(base, {
        type: 'registre_afsca',
        objetId: '2019-03',
        numero: null,
        titre: 'Registre AFSCA — Mars 2019 (test, période vide)',
        html,
        parametresSource: donnees,
      });
      cheminsCrees.push(doc.chemin);

      expect(existsSync(doc.chemin)).toBe(true);
      expect(doc.tailleOctets).toBeGreaterThan(2000);
    },
  );

  it('alimente RÉELLEMENT les deux sections qui montrent les trous, jamais undefined', () => {
    // Le gabarit sait imprimer « sessions sans relevé » et « tâches en retard »
    // depuis l'audit AFSCA du 30/07/2026, mais `donneesRegistreAfsca` ne les
    // renseignait pas : les sections existaient sans jamais s'imprimer. C'est le
    // défaut « du code que rien n'appelle » — le même que `verifierInvariantLots`
    // resté sans appelant de production. Ce test est le seul garde-fou contre
    // son retour ; il échoue si le branchement disparaît.
    const donnees = donneesRegistreAfsca(base, 2019, 3);

    // Un TABLEAU, jamais `undefined` : la convention du gabarit réserve
    // `undefined` au cas « vérification pas faite », et ici elle EST faite.
    expect(Array.isArray(donnees.sessionsSansReleveTemperature)).toBe(true);
    expect(Array.isArray(donnees.tachesNettoyageEnRetard)).toBe(true);

    // Et le gabarit les rend : sans branchement, ces deux titres sont absents.
    const { html } = registreAfscaMensuel(donnees);
    expect(html).toContain('Sessions sans relevé de température');
    expect(html).toContain('Tâches de nettoyage en retard');
  });
});

describe('Audit documents — non-conformité rattachée à un lot (rappel fournisseur)', () => {
  let base: BaseBatte;
  const cheminsCrees: string[] = [];

  beforeAll(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  afterAll(async () => {
    await fermerNavigateur();
    for (const chemin of cheminsCrees) {
      if (existsSync(chemin)) rmSync(chemin, { force: true });
    }
  });

  it(
    'imprime le lot concerné (ingrédient + numéro de lot), pas seulement le texte ' +
      "libre saisi par l'utilisateur — le champ que la base connaît désormais",
    async () => {
      const idIngredient = creerIngredientTest(base, 'Farine de rappel (test)');
      const idFournisseur = creerFournisseurTest(base, 'Moulin suspect (test)');

      const reception = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2033-05-10',
        lignes: [
          {
            ingredientId: idIngredient,
            quantite: 10_000,
            prixLigneCents: 5000,
            numeroLotFournisseur: 'LOT-RAPPEL-2033-001',
          },
        ],
      });
      const lotId = reception.lotsCrees[0]!.lotId;

      // Changement de statut avec le motif le plus grave du catalogue :
      // `changerStatutLot` doit ouvrir AUTOMATIQUEMENT une non-conformité liée
      // à ce lot précis (services/afsca.ts, docs/17 fiche 15/18 — hors zone
      // d'écriture ici, mais c'est la fonction qui alimente mon document).
      const resultat = changerStatutLot(base, lotId, 'detruit', 'RAPPEL_FOURNISSEUR', '2033-05-15');
      expect(resultat.mouvementDestructionId).not.toBeNull();

      const donnees = donneesRegistreAfsca(base, 2033, 5);
      expect(donnees.nonConformites).toHaveLength(1);
      const nc = donnees.nonConformites[0]!;
      expect(nc.lot).not.toBeNull();
      expect(nc.lot?.ingredientNom).toBe('Farine de rappel (test)');
      expect(nc.lot?.numeroLotFournisseur).toBe('LOT-RAPPEL-2033-001');
      // Le motif et la date du DERNIER changement de statut atteignent
      // désormais le document (défaut corrigé du 30/07/2026,
      // `resoudreLotsConcernes`) — jamais transmis avant ce correctif.
      expect(nc.lot?.motifStatutLibelle).toBe('Bloqué suite à un rappel fournisseur');
      expect(nc.lot?.dateChangementStatut).not.toBeNull();
      // Le statut ACTUEL du lot, lui, est `detruit` — pas `bloque` — alors
      // que le motif du dernier changement dit « Bloqué… » : `RAPPEL_FOURNISSEUR`
      // peut mener à `bloque` COMME à `detruit`, le libellé du motif seul ne
      // permet pas de distinguer les deux. C'est exactement pourquoi le statut
      // actuel doit toujours accompagner le motif.
      expect(nc.lot?.statut).toBe('detruit');

      const { html } = registreAfscaMensuel(donnees);
      expect(html).toContain('Farine de rappel (test)');
      expect(html).toContain('LOT-RAPPEL-2033-001');
      // Colonne dédiée, pas seulement noyé dans la description libre.
      expect(html).toContain('Lot concerné');
      // DÉFAUT CORRIGÉ (audit du 31/07/2026) : le fournisseur n'apparaissait
      // JAMAIS sur le registre, alors que c'est précisément l'information
      // qu'un « rappel fournisseur » doit permettre de retrouver sans
      // ressaisie (CLAUDE.md §3 règle 6).
      expect(html).toContain('Moulin suspect (test)');
      // Le PDF réellement produit affiche le statut ACTUEL — `detruit` est un
      // état final déjà décidé, sans mise en forme d'alerte particulière.
      expect(html).toContain('Statut : Détruit');
      // ...ET le motif du dernier changement, sans jamais laisser croire que
      // « Bloqué » (le motif) décrit l'état actuel du lot.
      expect(html).toContain('Dernier changement de statut : Bloqué suite à un rappel fournisseur');

      const doc = await rendrePdf(base, {
        type: 'registre_afsca',
        objetId: '2033-05',
        numero: null,
        titre: 'Registre AFSCA — Mai 2033 (test, rappel fournisseur)',
        html,
        parametresSource: donnees,
      });
      cheminsCrees.push(doc.chemin);
      expect(existsSync(doc.chemin)).toBe(true);

      // Traçabilité complémentaire : le mouvement de perte reste visible dans
      // le journal des mouvements exporté (CLAUDE.md §3 règles 5 et 7 — rien
      // ne s'efface), avec le même lot.
      const mouvements = donneesExportMouvements(base, 2033);
      const mouvementPerte = mouvements.lignes.find((l) => l.type === 'perte');
      expect(mouvementPerte).toBeDefined();
      expect(mouvementPerte?.lot).toBe('LOT-RAPPEL-2033-001');

      // Et le lot détruit ne pèse plus dans la valorisation du stock — pas de
      // trace fantôme dans l'export destiné au comptable.
      const stock = donneesExportStock(base, '2033-05-20');
      const ligneFarine = stock.lignes.find((l) => l.ingredientNom === 'Farine de rappel (test)');
      expect(ligneFarine?.nbLots).toBe(0);
      expect(ligneFarine?.valeurCents).toBe(0);
    },
  );

  it(
    'après une mise en quarantaine SUIVIE d’une levée, le PDF réellement produit affiche le ' +
      'statut ACTUEL « Disponible », jamais seulement le motif de la levée qui, seul, ne dit pas ' +
      'si le lot est réellement sorti de quarantaine ou reparti ailleurs depuis (nuance de ' +
      'l’audit du 30/07/2026)',
    async () => {
      const idIngredient = creerIngredientTest(base, 'Beurre en doute (test nuance statut)');
      const idFournisseur = creerFournisseurTest(base, 'Crémerie (test nuance statut)');

      const reception = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2035-02-01',
        lignes: [
          {
            ingredientId: idIngredient,
            quantite: 5000,
            prixLigneCents: 4000,
            numeroLotFournisseur: 'LOT-QUARANTAINE-2035-001',
          },
        ],
      });
      const lotId = reception.lotsCrees[0]!.lotId;

      // 1) Mise en quarantaine : ouvre AUTOMATIQUEMENT la non-conformité liée
      // à ce lot (`motifOuvreNonConformite`, `services/mouvements.ts`).
      changerStatutLot(base, lotId, 'quarantaine', 'QUARANTAINE_DOUTE', '2035-02-05');
      // 2) Levée de quarantaine : `LEVEE_QUARANTAINE` N'OUVRE PAS de nouvelle
      // non-conformité (exclu de `motifsIncidentSanitaire`) — la SEULE
      // non-conformité de ce lot reste celle créée à l'étape 1, mais le lot
      // lui-même porte désormais le motif et la date de CETTE levée.
      changerStatutLot(base, lotId, 'disponible', 'LEVEE_QUARANTAINE', '2035-02-10');

      // Le mois où la non-conformité a été CONSTATÉE (celui de la mise en
      // quarantaine), pas celui de la levée : c'est le mois qui apparaîtrait
      // sur un registre édité entre les deux dates, où le lecteur ne connaît
      // pas encore la suite.
      const donnees = donneesRegistreAfsca(base, 2035, 2);
      expect(donnees.nonConformites).toHaveLength(1);
      const nc = donnees.nonConformites[0]!;
      expect(nc.lot?.numeroLotFournisseur).toBe('LOT-QUARANTAINE-2035-001');
      // Le motif du DERNIER changement est celui de la LEVÉE, jamais celui de
      // la quarantaine qui l'a précédée — ces deux colonnes ne portent que le
      // dernier changement (voir la doc de `DonneesRegistreAfscaLotConcerne`).
      expect(nc.lot?.motifStatutLibelle).toBe('Levée de quarantaine après vérification');
      // Mais le statut ACTUEL, lui, dit sans ambiguïté que le lot est
      // redevenu disponible.
      expect(nc.lot?.statut).toBe('disponible');

      const { html } = registreAfscaMensuel(donnees);
      // Le PDF réellement produit doit porter les DEUX informations,
      // distinctement : le statut actuel...
      expect(html).toContain('Statut : Disponible');
      // ...et le motif du dernier changement, à côté, jamais à sa place.
      expect(html).toContain(
        'Dernier changement de statut : Levée de quarantaine après vérification',
      );

      const doc = await rendrePdf(base, {
        type: 'registre_afsca',
        objetId: '2035-02',
        numero: null,
        titre: 'Registre AFSCA — Février 2035 (test, quarantaine puis levée)',
        html,
        parametresSource: donnees,
      });
      cheminsCrees.push(doc.chemin);
      expect(existsSync(doc.chemin)).toBe(true);
      expect(doc.tailleOctets).toBeGreaterThan(2000);
    },
  );

  it(
    "affiche l'identification par DLC quand aucun numéro de lot fournisseur " +
      "n'existe (directive 2011/91/UE, docs/17 fiche 16)",
    () => {
      // Ingrédient AVEC une durée de conservation : la réception peut alors se
      // passer d'un numéro de lot fournisseur explicite, en n'apportant que la
      // DLC — exactement le cas « lot sans numéro » que fiche 16 a rendu
      // acceptable (avertissement non bloquant).
      const idIngredient = creerIngredientTest(base, 'Crème fraîche sans numéro (test)', {
        dureeConservationJours: 10,
      });
      const idFournisseur = creerFournisseurTest(base, 'Producteur local (test)');

      const reception = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2033-06-01',
        lignes: [
          {
            ingredientId: idIngredient,
            quantite: 2000,
            prixLigneCents: 800,
            dateDlc: '2033-06-15',
          },
        ],
      });
      expect(reception.avertissements.length).toBeGreaterThan(0);
      const lotId = reception.lotsCrees[0]!.lotId;

      declarerNonConformite(base, {
        dateConstat: '2033-06-05',
        type: 'Doute qualité (test)',
        description: 'Odeur suspecte constatée à l’ouverture.',
        gravite: 'mineure',
        lotId,
      });

      const donnees = donneesRegistreAfsca(base, 2033, 6);
      const nc = donnees.nonConformites.find((n) => n.type === 'Doute qualité (test)');
      expect(nc).toBeDefined();
      expect(nc?.lot?.numeroLotFournisseur).toBeNull();
      expect(nc?.lot?.dateDlc).toBe('2033-06-15');

      const { html } = registreAfscaMensuel(donnees);
      // Identifié par la DLC, jamais par un tiret muet qui perdrait la piste.
      expect(html).toContain('DLC');
      expect(html).toContain('15/06/2033');
      expect(html).toContain('Crème fraîche sans numéro (test)');
    },
  );

  it(
    'affiche À LA FOIS le numéro de lot ET la DLC quand les deux sont connus, ainsi que le ' +
      'fournisseur — défaut corrigé du 31/07/2026 : les deux se combinaient en OU ' +
      "(`numeroLotFournisseur ?? DLC`), donc une DLC pourtant connue disparaissait dès qu'un " +
      'numéro existait déjà, et le fournisseur ne s’affichait jamais',
    () => {
      const idIngredient = creerIngredientTest(base, 'Beurre avec numéro et DLC (test)');
      const idFournisseur = creerFournisseurTest(base, 'Crémerie du Pont (test)');

      const reception = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2036-01-05',
        lignes: [
          {
            ingredientId: idIngredient,
            quantite: 2000,
            prixLigneCents: 1800,
            numeroLotFournisseur: 'LOT-DOUBLE-2036-001',
            dateDlc: '2036-03-01',
          },
        ],
      });
      const lotId = reception.lotsCrees[0]!.lotId;

      declarerNonConformite(base, {
        dateConstat: '2036-01-10',
        type: 'Contrôle croisé (test)',
        description: 'Vérification suite à un doute sur la chaîne du froid.',
        gravite: 'mineure',
        lotId,
      });

      const donnees = donneesRegistreAfsca(base, 2036, 1);
      const nc = donnees.nonConformites.find((n) => n.type === 'Contrôle croisé (test)');
      expect(nc).toBeDefined();
      // Les deux identifiants sont bien remontés par la résolution de lot...
      expect(nc?.lot?.numeroLotFournisseur).toBe('LOT-DOUBLE-2036-001');
      expect(nc?.lot?.dateDlc).toBe('2036-03-01');
      expect(nc?.lot?.fournisseurNom).toBe('Crémerie du Pont (test)');

      const { html } = registreAfscaMensuel(donnees);
      // ...ET les deux s'impriment, jamais un seul au détriment de l'autre.
      expect(html).toContain('LOT-DOUBLE-2036-001');
      expect(html).toContain('DLC');
      expect(html).toContain('01/03/2036');
      // Le fournisseur, lui, n'avait aucun mécanisme de repli avant le correctif.
      expect(html).toContain('Crémerie du Pont (test)');
    },
  );
});

describe('Audit documents — fiche technique d’une recette avec un ingrédient sans prix', () => {
  let base: BaseBatte;
  const cheminsCrees: string[] = [];

  beforeAll(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  afterAll(async () => {
    await fermerNavigateur();
    for (const chemin of cheminsCrees) {
      if (existsSync(chemin)) rmSync(chemin, { force: true });
    }
  });

  it(
    'imprime un tiret pour la ligne ET pour le total quand un ingrédient n’a ' +
      'aucun conditionnement actif — jamais « 0,00 € », qui déclarerait la ' +
      'matière gratuite (D-018)',
    async () => {
      const idFarine = creerIngredientTest(base, 'Farine connue (test)');
      const idFournisseur = creerFournisseurTest(base, 'Fournisseur connu (test)');
      creerConditionnementActif(base, idFarine, idFournisseur, 1875, 25_000);

      // Ingrédient JAMAIS pourvu de conditionnement : exactement le chemin
      // atteignable depuis l'écran Recettes (création rapide d'ingrédient,
      // fiche 09) avant le passage par l'écran Ingrédients.
      const idCannelle = creerIngredientTest(base, 'Cannelle sans prix (test)');

      const idRecette = creerRecetteTest(base, 'RTEST-COUT-INCONNU', [
        { ingredientId: idFarine, quantiteUniteRef: 145 },
        { ingredientId: idCannelle, quantiteUniteRef: 5 },
      ]);

      const donnees = donneesFicheTechnique(base, idRecette);
      expect(donnees).not.toBeNull();
      expect(donnees?.coutMatiereCents).toBeNull();
      const ligneCannelle = donnees?.lignes.find(
        (l) => l.nomIngredient === 'Cannelle sans prix (test)',
      );
      expect(ligneCannelle?.coutCents).toBeNull();
      // La farine, elle, reste chiffrée : un seul ingrédient inconnu ne doit
      // pas effacer le coût des autres lignes, seul le TOTAL en aval devient
      // inconnu.
      const ligneFarine = donnees?.lignes.find((l) => l.nomIngredient === 'Farine connue (test)');
      expect(ligneFarine?.coutCents).not.toBeNull();

      const { html } = ficheTechnique(donnees!);
      // Aucun « 0,00 » ne doit apparaître pour représenter un coût inconnu.
      const nombreDeTirets = (html.match(new RegExp(TIRET_ABSENT, 'g')) ?? []).length;
      expect(nombreDeTirets).toBeGreaterThanOrEqual(2); // ligne + total

      const doc = await rendrePdf(base, {
        type: 'fiche_technique',
        objetId: idRecette,
        numero: 'RTEST-COUT-INCONNU',
        titre: 'Fiche technique — coût inconnu (test)',
        html,
        parametresSource: donnees,
      });
      cheminsCrees.push(doc.chemin);
      expect(existsSync(doc.chemin)).toBe(true);
      expect(doc.tailleOctets).toBeGreaterThan(2000);
    },
  );
});

describe('Audit documents — note technique du geste imprimée sur la fiche technique', () => {
  let base: BaseBatte;
  const cheminsCrees: string[] = [];

  beforeAll(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  afterAll(async () => {
    await fermerNavigateur();
    for (const chemin of cheminsCrees) {
      if (existsSync(chemin)) rmSync(chemin, { force: true });
    }
  });

  it(
    'imprime la note du geste sur SA ligne, en laisse une autre sans note, et ne la ' +
      'confond JAMAIS avec un allergène (CLAUDE.md §7 : les deux informations ont des ' +
      'exigences différentes, un allergène inconnu doit rester inconnu)',
    async () => {
      const idBeurre = creerIngredientTest(base, 'Beurre noisette (test note technique)');
      base
        .update(schema.ingredient)
        .set({ allergenes: ['lait'] })
        .where(eq(schema.ingredient.id, idBeurre))
        .run();
      const idFarine = creerIngredientTest(base, 'Farine sans note (test note technique)');

      const idRecette = creerRecetteTest(base, 'RTEST-NOTE-TECHNIQUE', [
        {
          ingredientId: idBeurre,
          quantiteUniteRef: 55,
          noteTechnique: 'Beurre noisette, ne pas dépasser la coloration.',
        },
        { ingredientId: idFarine, quantiteUniteRef: 145 },
      ]);

      const donnees = donneesFicheTechnique(base, idRecette);
      expect(donnees).not.toBeNull();

      const ligneBeurre = donnees?.lignes.find(
        (l) => l.nomIngredient === 'Beurre noisette (test note technique)',
      );
      const ligneFarine = donnees?.lignes.find(
        (l) => l.nomIngredient === 'Farine sans note (test note technique)',
      );
      expect(ligneBeurre?.noteTechnique).toBe('Beurre noisette, ne pas dépasser la coloration.');
      // Une ligne sans note reste `null` — jamais une note fabriquée ni
      // recopiée depuis une autre ligne de la même recette.
      expect(ligneFarine?.noteTechnique).toBeNull();

      // GARDE-FOU : la note ne doit RIEN ajouter aux allergènes déclarés —
      // le beurre porte « lait » parce que l'ingrédient le déclare, jamais
      // parce qu'il porte une note technique.
      expect(donnees?.allergenes).toEqual(['lait']);

      const { html } = ficheTechnique(donnees!);
      expect(html).toContain('Beurre noisette, ne pas dépasser la coloration.');

      // La note apparaît dans le corps du document (table des ingrédients),
      // jamais dans la section « Allergènes » : les deux informations restent
      // séparées à l'impression, exactement comme dans la donnée assemblée.
      const sectionAllergenes = html.slice(html.indexOf('<h2>Allergènes</h2>'));
      expect(sectionAllergenes).not.toContain('coloration');

      const doc = await rendrePdf(base, {
        type: 'fiche_technique',
        objetId: idRecette,
        numero: 'RTEST-NOTE-TECHNIQUE',
        titre: 'Fiche technique — note technique (test)',
        html,
        parametresSource: donnees,
      });
      cheminsCrees.push(doc.chemin);
      expect(existsSync(doc.chemin)).toBe(true);
      expect(doc.tailleOctets).toBeGreaterThan(2000);
    },
  );
});

describe('Audit documents — rapport de session sans durée renseignée', () => {
  afterAll(async () => {
    await fermerNavigateur();
  });

  it('affiche un tiret pour la marge par heure, jamais 0,00 €/h', () => {
    const { html } = rapportSession({
      numero: 'SM-TEST-0001',
      lieuNom: 'La Batte',
      dateSession: '2026-08-02',
      ventes: [],
      caTotalCents: 0,
      caTransformeCents: 0,
      caRevenduCents: 0,
      caEspecesCents: 0,
      caCarteCents: 0,
      ecartCaisseCents: 0,
      coutMatiereCents: 0,
      commissionCarteCents: 0,
      fraisTotauxCents: 0,
      margeBruteCents: 0,
      margeNetteCents: 0,
      margeParHeureCents: null,
      crepesProduites: 0,
      crepesVendues: 0,
      crepesInvendues: 0,
      crepesCassees: 0,
      tauxEcoulementBp: 0,
      notesQualitatives: null,
    });

    expect(html).toContain(TIRET_ABSENT);
    expect(html).not.toContain('0,00 €/h');
  });
});

describe('Audit documents — exports Excel sur une période sans aucune ligne', () => {
  it('produisent un classeur valide (en-têtes seuls), sans lever', async () => {
    const donneesVides = {
      dateExport: new Date('2026-08-02T08:00:00Z'),
      periodeCouverte: 'Test',
      lignes: [],
    };

    await expect(exportJournalRecettes(donneesVides)).resolves.toBeInstanceOf(Buffer);
    await expect(exportJournalAchats(donneesVides)).resolves.toBeInstanceOf(Buffer);
    await expect(exportMouvementsStock(donneesVides)).resolves.toBeInstanceOf(Buffer);
  });
});

describe('Audit documents — bornes de date du registre AFSCA', () => {
  it('couvre le dernier jour du mois, même en année bissextile', () => {
    expect(dernierJourDuMois(2028, 2)).toBe('2028-02-29'); // bissextile
    expect(dernierJourDuMois(2026, 2)).toBe('2026-02-28'); // non bissextile
    expect(dernierJourDuMois(2026, 4)).toBe('2026-04-30');
  });

  it(
    'inclut un relevé horodaté le DERNIER jour civil du mois et exclut celui ' +
      'du premier jour du mois SUIVANT — le piège relevé par D-020/D-026 sur ' +
      'les bornes de période (Europe/Brussels, CLAUDE.md §3 règle 8)',
    () => {
      const base = creerBase(':memory:');
      migrer(base);
      seed(base);

      enregistrerReleveTemperature(base, {
        equipement: 'Glacière (test bornes)',
        temperatureC: 4,
        dateReleve: '2033-02-28', // dernier jour de février 2033 (non bissextile)
        moment: 'depart',
      });
      enregistrerReleveTemperature(base, {
        equipement: 'Glacière (test bornes)',
        temperatureC: 4,
        dateReleve: '2033-03-01', // premier jour du mois SUIVANT
        moment: 'depart',
      });

      const fevrier = donneesRegistreAfsca(base, 2033, 2);
      expect(fevrier.temperatures).toHaveLength(1);
      expect(fevrier.temperatures[0]?.dateReleve).toBe('2033-02-28');

      const mars = donneesRegistreAfsca(base, 2033, 3);
      expect(mars.temperatures).toHaveLength(1);
      expect(mars.temperatures[0]?.dateReleve).toBe('2033-03-01');
    },
  );
});

describe('Audit documents — affichette allergènes distingue les composants optionnels (fiche 15 §4.1bis)', () => {
  it(
    "n'annonce PAS l'allergène d'une option (la crème) sur la liste principale d'un café " +
      "noir, mais l'annonce séparément « sur demande »",
    () => {
      const base = creerBase(':memory:');
      migrer(base);
      seed(base);

      const idCafeMoulu = creerIngredientTest(base, 'Café moulu (test)');
      const idGobelet = creerIngredientTest(base, 'Gobelet carton (test)');
      const idCreme = creerIngredientTest(base, 'Crème (test)');
      base
        .update(schema.ingredient)
        .set({ allergenes: ['lait'] })
        .where(eq(schema.ingredient.id, idCreme))
        .run();

      const idCafe = creerProduitVenteTest(base, 'Café (test)');
      // Toujours appliqués : jamais d'allergène ici, donc rien sur la liste principale.
      creerComposantVenteTest(base, idCafe, idCafeMoulu, false);
      creerComposantVenteTest(base, idCafe, idGobelet, false);
      // Option : servie SEULEMENT sur demande.
      creerComposantVenteTest(base, idCafe, idCreme, true);

      const donnees = donneesAffichetteAllergenes(base);
      const cafe = donnees.produits.find((p) => p.nom === 'Café (test)');
      expect(cafe).toBeDefined();
      // Le café noir n'a AUCUN allergène tant que la crème n'est pas ajoutée.
      expect(cafe?.allergenes).toEqual([]);
      // Mais l'affichette doit prévenir que la crème, sur demande, en apporte un.
      expect(cafe?.allergenesSurDemande).toEqual(['lait']);

      const { html } = affichetteAllergenes(donnees);
      expect(html).toContain('Sur demande');
      // Le HTML porte le LIBELLÉ réglementaire (`libelleAllergene`), pas le code
      // `lait` : la CSS (`text-transform: uppercase` sur `.allergene`) ne fait
      // que la casse, elle ne traduit pas un identifiant en libellé — sur
      // `fruits-a-coque` elle ne rendrait qu'un `FRUITS-A-COQUE` illisible.
      expect(html).toContain('<span class="allergene">Lait (y compris lactose)</span>');
    },
  );

  it(
    "n'affiche pas deux fois le même allergène quand il est déjà présent dans la base : " +
      "l'option n'ajoute d'information que si elle est réellement supplémentaire",
    () => {
      const base = creerBase(':memory:');
      migrer(base);
      seed(base);

      const idLaitDeBase = creerIngredientTest(base, 'Lait de base (test)');
      base
        .update(schema.ingredient)
        .set({ allergenes: ['lait'] })
        .where(eq(schema.ingredient.id, idLaitDeBase))
        .run();
      const idCreme = creerIngredientTest(base, 'Crème bis (test)');
      base
        .update(schema.ingredient)
        .set({ allergenes: ['lait'] })
        .where(eq(schema.ingredient.id, idCreme))
        .run();

      const idCafeAuLait = creerProduitVenteTest(base, 'Café au lait (test)');
      creerComposantVenteTest(base, idCafeAuLait, idLaitDeBase, false); // toujours appliqué
      creerComposantVenteTest(base, idCafeAuLait, idCreme, true); // option

      const donnees = donneesAffichetteAllergenes(base);
      const produit = donnees.produits.find((p) => p.nom === 'Café au lait (test)');
      expect(produit?.allergenes).toEqual(['lait']);
      // Deja garanti par la base : la section « sur demande » n'a rien a ajouter.
      expect(produit?.allergenesSurDemande).toEqual([]);
    },
  );

  it('un composant désactivé ne compte plus, ni dans la liste principale ni « sur demande »', () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const idNoisette = creerIngredientTest(base, 'Fruits à coque (test)');
    base
      .update(schema.ingredient)
      .set({ allergenes: ['fruits à coque'] })
      .where(eq(schema.ingredient.id, idNoisette))
      .run();

    const idProduit = creerProduitVenteTest(base, 'Café praliné (test)');
    creerComposantVenteTest(base, idProduit, idNoisette, true);

    // Désactivé : ne doit plus apparaître, ni sur la liste principale, ni sur
    // « sur demande » — un composant désactivé ne sort plus du stock non plus.
    base
      .update(schema.produitVenteComposant)
      .set({ actif: false })
      .where(eq(schema.produitVenteComposant.produitVenteId, idProduit))
      .run();

    const donnees = donneesAffichetteAllergenes(base);
    const produit = donnees.produits.find((p) => p.nom === 'Café praliné (test)');
    expect(produit?.allergenes).toEqual([]);
    expect(produit?.allergenesSurDemande).toEqual([]);
  });
});

describe(
  'Audit documents — affichette allergènes et un MENU (fiche 16) : un menu n’a NI recette ' +
    'NI ingrédient propre, ses allergènes viennent de ses composants',
  () => {
    it(
      'déclare les allergènes de la CRÊPE (recette) ET du CAFÉ (composant) inclus dans le ' +
        'menu — un menu vide de recette ne doit jamais s’imprimer « aucun allergène déclaré » ' +
        'alors qu’un de ses composants en porte un (CLAUDE.md §7 : un allergène de trop vaut ' +
        'toujours mieux qu’un allergène manquant)',
      () => {
        const base = creerBase(':memory:');
        migrer(base);
        seed(base);
        const maintenant = maintenantUtc();

        // La crêpe du menu : un produit TRANSFORMÉ rattaché à une recette au
        // gluten — c'est la même recette qui alimenterait la fiche technique.
        const idFarine = creerIngredientTest(base, 'Farine du menu (test)');
        base
          .update(schema.ingredient)
          .set({ allergenes: ['gluten'] })
          .where(eq(schema.ingredient.id, idFarine))
          .run();
        const idRecetteMenu = creerRecetteTest(base, 'RTEST-MENU-CREPE', [
          { ingredientId: idFarine, quantiteUniteRef: 145 },
        ]);
        const idCrepeMenu = nouvelIdentifiant();
        base
          .insert(schema.produitVente)
          .values({
            id: idCrepeMenu,
            nom: 'Crêpe du menu (test)',
            nature: 'transforme',
            recetteId: idRecetteMenu,
            ingredientId: null,
            prixCents: 350,
            nbCrepes: 1,
            volumeMlParUnite: null,
            categorie: 'crepe',
            consommationSurPlace: false,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        // Le café du menu : nomenclature de VENTE (fiche 15), lait toujours
        // appliqué + crème SUR DEMANDE — exactement le cas déjà couvert seul
        // plus haut, à vérifier ici une fois REMONTÉ au niveau du menu.
        const idLait = creerIngredientTest(base, 'Lait du café menu (test)');
        base
          .update(schema.ingredient)
          .set({ allergenes: ['lait'] })
          .where(eq(schema.ingredient.id, idLait))
          .run();
        const idCreme = creerIngredientTest(base, 'Crème du café menu (test)');
        base
          .update(schema.ingredient)
          .set({ allergenes: ['lait'] })
          .where(eq(schema.ingredient.id, idCreme))
          .run();
        const idNoisette = creerIngredientTest(base, 'Noisette du café menu (test)');
        base
          .update(schema.ingredient)
          .set({ allergenes: ['fruits à coque'] })
          .where(eq(schema.ingredient.id, idNoisette))
          .run();

        const idCafeMenu = creerProduitVenteTest(base, 'Café du menu (test)');
        creerComposantVenteTest(base, idCafeMenu, idLait, false); // toujours appliqué
        creerComposantVenteTest(base, idCafeMenu, idNoisette, true); // sur demande

        // Le menu-conteneur lui-même : ni recette, ni ingrédient — exactement
        // la forme que `depots/referentiel.ts` documente pour `nature: 'menu'`.
        const idMenu = nouvelIdentifiant();
        base
          .insert(schema.produitVente)
          .values({
            id: idMenu,
            nom: 'Menu Crêpe + Café (test)',
            nature: 'menu',
            recetteId: null,
            ingredientId: null,
            prixCents: 500,
            nbCrepes: null,
            volumeMlParUnite: null,
            categorie: 'menu',
            consommationSurPlace: false,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();
        creerCompositionMenu(base, idMenu, { produitInclusId: idCrepeMenu, quantite: 1 });
        creerCompositionMenu(base, idMenu, { produitInclusId: idCafeMenu, quantite: 1 });

        const donnees = donneesAffichetteAllergenes(base);
        const menu = donnees.produits.find((p) => p.nom === 'Menu Crêpe + Café (test)');
        expect(menu).toBeDefined();
        // Les DEUX allergènes obligatoires des DEUX composants, jamais un
        // menu « vide » parce qu'il ne porte lui-même ni recette ni ingrédient.
        expect(menu?.allergenes).toEqual(['gluten', 'lait']);
        // La noisette, optionnelle sur le café, reste « sur demande » une
        // fois remontée au niveau du menu.
        expect(menu?.allergenesSurDemande).toEqual(['fruits à coque']);

        const { html } = affichetteAllergenes(donnees);
        expect(html).toContain('Menu Crêpe + Café (test)');
        // L'affichette imprime le LIBELLÉ réglementaire, pas le code interne :
        // `gluten` est un identifiant, « Céréales contenant du gluten » est ce
        // que la liste des 14 allergènes appelle cet allergène, et c'est ce
        // qu'un client ou un contrôleur doit lire (`libelleAllergene`).
        expect(html).toContain('<span class="allergene">Céréales contenant du gluten</span>');
        expect(html).toContain('<span class="allergene">Lait (y compris lactose)</span>');
        expect(html).toContain('Sur demande');
        // Valeur en texte libre, absente du catalogue : `libelleAllergene` la
        // rend inchangée plutôt que de la remplacer ou de la perdre.
        expect(html).toContain('<span class="allergene">fruits à coque</span>');
      },
    );

    it('ne déclare PAS deux fois un allergène déjà porté par un autre composant du même menu', () => {
      const base = creerBase(':memory:');
      migrer(base);
      seed(base);
      const maintenant = maintenantUtc();

      const idGluten1 = creerIngredientTest(base, 'Farine A (test doublon menu)');
      base
        .update(schema.ingredient)
        .set({ allergenes: ['gluten'] })
        .where(eq(schema.ingredient.id, idGluten1))
        .run();
      const idRecetteA = creerRecetteTest(base, 'RTEST-MENU-DOUBLON-A', [
        { ingredientId: idGluten1, quantiteUniteRef: 100 },
      ]);
      const idProduitA = nouvelIdentifiant();
      base
        .insert(schema.produitVente)
        .values({
          id: idProduitA,
          nom: 'Crêpe A (test doublon menu)',
          nature: 'transforme',
          recetteId: idRecetteA,
          ingredientId: null,
          prixCents: 300,
          nbCrepes: 1,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const idGluten2 = creerIngredientTest(base, 'Farine B (test doublon menu)');
      base
        .update(schema.ingredient)
        .set({ allergenes: ['gluten'] })
        .where(eq(schema.ingredient.id, idGluten2))
        .run();
      const idRecetteB = creerRecetteTest(base, 'RTEST-MENU-DOUBLON-B', [
        { ingredientId: idGluten2, quantiteUniteRef: 100 },
      ]);
      const idProduitB = nouvelIdentifiant();
      base
        .insert(schema.produitVente)
        .values({
          id: idProduitB,
          nom: 'Crêpe B (test doublon menu)',
          nature: 'transforme',
          recetteId: idRecetteB,
          ingredientId: null,
          prixCents: 300,
          nbCrepes: 1,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const idMenu = nouvelIdentifiant();
      base
        .insert(schema.produitVente)
        .values({
          id: idMenu,
          nom: 'Menu deux crêpes (test doublon)',
          nature: 'menu',
          recetteId: null,
          ingredientId: null,
          prixCents: 550,
          nbCrepes: null,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      creerCompositionMenu(base, idMenu, { produitInclusId: idProduitA, quantite: 1 });
      creerCompositionMenu(base, idMenu, { produitInclusId: idProduitB, quantite: 1 });

      const donnees = donneesAffichetteAllergenes(base);
      const menu = donnees.produits.find((p) => p.nom === 'Menu deux crêpes (test doublon)');
      // Le même allergène porté par les deux composants ne se répète pas.
      expect(menu?.allergenes).toEqual(['gluten']);
    });
  },
);

describe('Audit documents — rapport de session dont la seule vente est un MENU (fiche 16)', () => {
  let base: BaseBatte;
  const cheminsCrees: string[] = [];

  beforeAll(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  afterAll(async () => {
    await fermerNavigateur();
    for (const chemin of cheminsCrees) {
      if (existsSync(chemin)) rmSync(chemin, { force: true });
    }
  });

  it(
    'se génère réellement (PDF non vide) pour une session clôturée dont la seule ligne de ' +
      'vente est un menu, au prix EFFECTIVEMENT pratiqué ce jour-là — jamais gratuit, un menu ' +
      'n’a pas de recette propre à coûter, son prix vient de ce qui a été vendu',
    async () => {
      const maintenant = maintenantUtc();

      const idLieu = nouvelIdentifiant();
      base
        .insert(schema.lieuMarche)
        .values({
          id: idLieu,
          nom: 'La Batte (test rapport menu)',
          jourSemaine: 0,
          heureDebut: '08:00',
          heureFin: '14:30',
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const idCrepeMenu = nouvelIdentifiant();
      base
        .insert(schema.produitVente)
        .values({
          id: idCrepeMenu,
          nom: 'Crêpe du menu (test rapport)',
          nature: 'transforme',
          recetteId: null,
          ingredientId: null,
          prixCents: 350,
          nbCrepes: 1,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const idIngredientBoisson = creerIngredientTest(base, 'Boisson du menu (test rapport)');
      const idBoissonMenu = nouvelIdentifiant();
      base
        .insert(schema.produitVente)
        .values({
          id: idBoissonMenu,
          nom: 'Boisson du menu (test rapport)',
          nature: 'revendu',
          recetteId: null,
          ingredientId: idIngredientBoisson,
          prixCents: 200,
          nbCrepes: null,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      const idMenu = nouvelIdentifiant();
      base
        .insert(schema.produitVente)
        .values({
          id: idMenu,
          nom: 'Menu Crêpe + Boisson (test rapport)',
          nature: 'menu',
          recetteId: null,
          ingredientId: null,
          prixCents: 500,
          nbCrepes: null,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      creerCompositionMenu(base, idMenu, { produitInclusId: idCrepeMenu, quantite: 1 });
      creerCompositionMenu(base, idMenu, { produitInclusId: idBoissonMenu, quantite: 1 });

      const session = creerSession(base, { lieuId: idLieu, dateSession: '2034-01-07' });
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idMenu, quantite: 3, prixUnitaireCents: 500 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 1500,
        caCarteCents: 0,
        crepesProduites: 3,
        crepesInvendues: 0,
        crepesCassees: 0,
        heureDebutReelle: '08:00',
        heureFinReelle: '14:30',
      });

      const donnees = donneesRapportSession(base, session.id);
      expect(donnees).not.toBeNull();

      // La pièce comptable reste UNE ligne, au nom et au prix du MENU vendu
      // ce jour-là — jamais éclatée, jamais à zéro.
      const ligneMenu = donnees?.ventes.find(
        (v) => v.nomProduit === 'Menu Crêpe + Boisson (test rapport)',
      );
      expect(ligneMenu).toBeDefined();
      expect(ligneMenu?.prixUnitaireCents).toBe(500);
      expect(ligneMenu?.montantCents).toBe(1500);
      expect(donnees?.caTotalCents).toBe(1500);

      // La VENTILATION, elle, doit lire la donnée ÉCLATÉE par composant
      // (`sessionMarche.caTransformeCents`/`caRevenduCents`, calculées par
      // `cloturerSession` à partir des lignes explosées de `exploserLigneMenu`
      // — CLAUDE.md §6, mission du 30/07/2026 §4), jamais compter le menu en
      // bloc du mauvais côté. Prorata au poids du prix catalogue (350/550 et
      // 200/550) sur le prix RÉELLEMENT pratiqué (500 c), fois 3 menus vendus :
      // 3 × 318 c = 954 c de transformé, 3 × 182 c = 546 c de revendu — jamais
      // 1500 c entiers d'un seul côté, ce qui ferait sortir l'utilisateur de la
      // franchise TVA sans qu'il l'ait vu venir sur CE document précis.
      expect(donnees?.caTransformeCents).toBe(954);
      expect(donnees?.caRevenduCents).toBe(546);
      expect((donnees?.caTransformeCents ?? 0) + (donnees?.caRevenduCents ?? 0)).toBe(
        donnees?.caTotalCents,
      );

      const { html } = rapportSession(donnees!);
      expect(html).toContain('Menu Crêpe + Boisson (test rapport)');
      // Le CA du menu (3 × 5,00 €) s'imprime au montant EFFECTIVEMENT
      // pratiqué, jamais gratuit — « 15,00 » apparaît sur la ligne de vente
      // ET sur le total, jamais « 0,00 ».
      expect(html).toContain('15,00');
      // La ventilation imprimée (9,54 € / 5,46 €) doit elle aussi refléter le
      // partage par composant, jamais 15,00 € entiers d'un seul côté.
      expect(html).toContain('9,54');
      expect(html).toContain('5,46');

      const doc = await rendrePdf(base, {
        type: 'rapport_session',
        objetId: session.id,
        numero: donnees!.numero,
        titre: `Rapport de session ${donnees!.numero} (test, menu vendu)`,
        html,
        parametresSource: donnees,
      });
      cheminsCrees.push(doc.chemin);
      expect(existsSync(doc.chemin)).toBe(true);
      expect(doc.tailleOctets).toBeGreaterThan(2000);

      // Le journal des recettes (export Excel obligatoire sous franchise de
      // TVA, `docs/01` module 7) doit lire la MÊME donnée éclatée — jamais la
      // ligne de vente brute du menu — sans quoi le classeur remis au
      // comptable et le rapport PDF de la même session se contrediraient.
      const journal = donneesJournalRecettes(base, 2034);
      const ligneJournal = journal.lignes.find((l) => l.numero === donnees!.numero);
      expect(ligneJournal).toBeDefined();
      expect(ligneJournal?.caTotalCents).toBe(1500);
      expect(ligneJournal?.caTransformeCents).toBe(954);
      expect(ligneJournal?.caRevenduCents).toBe(546);
    },
  );
});

describe(
  'Audit documents — affichette allergènes et un MENU incluant un composant REVENDU ' +
    '(article préemballé acheté tel quel, fiche 16 §1)',
  () => {
    it(
      "déclare l'allergène porté par l'ARTICLE REVENDU inclus dans un menu, pas seulement " +
        "ceux d'un composant transformé — un menu « crêpe + sirop » doit annoncer le sulfite " +
        'du sirop autant que le gluten de la crêpe',
      () => {
        const base = creerBase(':memory:');
        migrer(base);
        seed(base);
        const maintenant = maintenantUtc();

        // La crêpe du menu : transformée, sans allergène pour isoler la
        // contribution de l'article revendu dans cette assertion.
        const idFarineSansGluten = creerIngredientTest(base, 'Farine sans gluten (test revendu)');
        const idRecetteMenu = creerRecetteTest(base, 'RTEST-MENU-REVENDU', [
          { ingredientId: idFarineSansGluten, quantiteUniteRef: 100 },
        ]);
        const idCrepeMenu = nouvelIdentifiant();
        base
          .insert(schema.produitVente)
          .values({
            id: idCrepeMenu,
            nom: 'Crêpe du menu (test revendu)',
            nature: 'transforme',
            recetteId: idRecetteMenu,
            ingredientId: null,
            prixCents: 350,
            nbCrepes: 1,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        // L'article REVENDU inclus dans le menu : préemballé, acheté tel
        // quel, PAS de recette — ses allergènes viennent directement de
        // `produit_vente.ingredient_id` (`donneesAffichetteAllergenes`,
        // branche `inclus.ingredientId !== null`).
        const idSirop = creerIngredientTest(base, 'Sirop au sulfite (test revendu)');
        base
          .update(schema.ingredient)
          .set({ allergenes: ['sulfites'] })
          .where(eq(schema.ingredient.id, idSirop))
          .run();
        const idSiropMenu = nouvelIdentifiant();
        base
          .insert(schema.produitVente)
          .values({
            id: idSiropMenu,
            nom: 'Sirop du menu (test revendu)',
            nature: 'revendu',
            recetteId: null,
            ingredientId: idSirop,
            prixCents: 250,
            nbCrepes: null,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        const idMenu = nouvelIdentifiant();
        base
          .insert(schema.produitVente)
          .values({
            id: idMenu,
            nom: 'Menu Crêpe + Sirop (test revendu)',
            nature: 'menu',
            recetteId: null,
            ingredientId: null,
            prixCents: 550,
            nbCrepes: null,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();
        creerCompositionMenu(base, idMenu, { produitInclusId: idCrepeMenu, quantite: 1 });
        creerCompositionMenu(base, idMenu, { produitInclusId: idSiropMenu, quantite: 1 });

        const donnees = donneesAffichetteAllergenes(base);
        const menu = donnees.produits.find((p) => p.nom === 'Menu Crêpe + Sirop (test revendu)');
        expect(menu).toBeDefined();
        // Le sulfite de l'article REVENDU doit apparaître : un menu ne se
        // résume pas à la partie transformée de ce qu'il contient.
        expect(menu?.allergenes).toEqual(['sulfites']);

        const { html } = affichetteAllergenes(donnees);
        expect(html).toContain('Menu Crêpe + Sirop (test revendu)');
        // Le libellé réglementaire, pas le code : « sulfites » seul ne dit pas
        // ce que la liste des 14 nomme « Anhydride sulfureux et sulfites ».
        expect(html).toContain('<span class="allergene">Anhydride sulfureux et sulfites</span>');
      },
    );
  },
);

describe(
  'Audit documents — robustesse : un menu ACTIF sans aucun composant ne fait pas planter ' +
    "l'affichette (entrée dégénérée, mission du 30/07/2026 §5)",
  () => {
    it('ne lève pas et déclare simplement « aucun allergène » pour ce menu vide', () => {
      const base = creerBase(':memory:');
      migrer(base);
      seed(base);
      const maintenant = maintenantUtc();

      const idMenuVide = nouvelIdentifiant();
      base
        .insert(schema.produitVente)
        .values({
          id: idMenuVide,
          nom: 'Menu vide (test robustesse)',
          nature: 'menu',
          recetteId: null,
          ingredientId: null,
          prixCents: 500,
          nbCrepes: null,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      // Aucune ligne `menu_composition` créée : le menu reste actif mais vide.

      expect(() => donneesAffichetteAllergenes(base)).not.toThrow();
      const donnees = donneesAffichetteAllergenes(base);
      const menu = donnees.produits.find((p) => p.nom === 'Menu vide (test robustesse)');
      expect(menu).toBeDefined();
      expect(menu?.allergenes).toEqual([]);
      expect(menu?.allergenesSurDemande).toEqual([]);

      expect(() => affichetteAllergenes(donnees)).not.toThrow();
    });
  },
);

describe(
  'Audit documents — robustesse : la fiche technique appelée avec un identifiant qui n’est ' +
    'PAS une recette (le cas d’un produit de nature « menu », qui n’a pas de `recetteId`)',
  () => {
    it('rend `null` proprement, sans planter — jamais un vide silencieux', () => {
      const base = creerBase(':memory:');
      migrer(base);
      seed(base);
      const maintenant = maintenantUtc();

      const idMenu = nouvelIdentifiant();
      base
        .insert(schema.produitVente)
        .values({
          id: idMenu,
          nom: 'Menu sans recette (test fiche technique)',
          nature: 'menu',
          recetteId: null,
          ingredientId: null,
          prixCents: 500,
          nbCrepes: null,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();

      // L'identifiant du menu n'est PAS un identifiant de recette : la
      // fonction doit rendre `null` (que la route traduit en 404 explicite),
      // jamais lever ni renvoyer un objet à moitié rempli.
      expect(() => donneesFicheTechnique(base, idMenu)).not.toThrow();
      expect(donneesFicheTechnique(base, idMenu)).toBeNull();
    });
  },
);

describe(
  'Audit documents — traçabilité AFSCA d’un lot consommé via un composant REVENDU ' +
    "d'un MENU (mission du 30/07/2026 §2 : la traçabilité par lot ne doit pas se perdre " +
    'à l’explosion de la vente du menu)',
  () => {
    it(
      'le journal des mouvements de stock exporté retrouve le numéro de lot précis ' +
        "consommé, alors que la vente n'a jamais désigné ce lot directement — seul le " +
        'menu a été vendu, jamais le sirop pris isolément',
      async () => {
        const base = creerBase(':memory:');
        migrer(base);
        seed(base);
        const maintenant = maintenantUtc();

        // Réception d'un lot de sirop, numéro de lot fournisseur précis —
        // c'est CE numéro qui doit rester retrouvable après la clôture.
        const idSirop = creerIngredientTest(base, 'Sirop traçable (test AFSCA menu)');
        const idFournisseur = creerFournisseurTest(base, 'Fournisseur sirop (test AFSCA menu)');
        const reception = enregistrerReception(base, {
          fournisseurId: idFournisseur,
          dateReception: '2034-02-01',
          lignes: [
            {
              ingredientId: idSirop,
              quantite: 5000,
              prixLigneCents: 2000,
              numeroLotFournisseur: 'LOT-SIROP-MENU-TEST',
            },
          ],
        });
        expect(reception.lotsCrees).toHaveLength(1);

        const idSiropMenu = nouvelIdentifiant();
        base
          .insert(schema.produitVente)
          .values({
            id: idSiropMenu,
            nom: 'Sirop du menu (test AFSCA)',
            nature: 'revendu',
            recetteId: null,
            ingredientId: idSirop,
            prixCents: 200,
            nbCrepes: null,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        const idCrepeMenu = nouvelIdentifiant();
        base
          .insert(schema.produitVente)
          .values({
            id: idCrepeMenu,
            nom: 'Crêpe du menu (test AFSCA)',
            nature: 'transforme',
            recetteId: null,
            ingredientId: null,
            prixCents: 350,
            nbCrepes: 1,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        const idMenu = nouvelIdentifiant();
        base
          .insert(schema.produitVente)
          .values({
            id: idMenu,
            nom: 'Menu Crêpe + Sirop (test AFSCA)',
            nature: 'menu',
            recetteId: null,
            ingredientId: null,
            prixCents: 500,
            nbCrepes: null,
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();
        creerCompositionMenu(base, idMenu, { produitInclusId: idCrepeMenu, quantite: 1 });
        creerCompositionMenu(base, idMenu, { produitInclusId: idSiropMenu, quantite: 1 });

        const idLieu = nouvelIdentifiant();
        base
          .insert(schema.lieuMarche)
          .values({
            id: idLieu,
            nom: 'La Batte (test AFSCA menu)',
            jourSemaine: 0,
            heureDebut: '08:00',
            heureFin: '14:30',
            actif: true,
            creeLe: maintenant,
            modifieLe: maintenant,
          })
          .run();

        const session = creerSession(base, { lieuId: idLieu, dateSession: '2034-02-03' });
        // La vente ne désigne QUE le menu : jamais le sirop directement — la
        // traçabilité du lot doit donc provenir de l'explosion à la clôture,
        // pas d'une ligne de vente qui pointerait déjà vers le composant.
        cloturerSession(base, session.id, {
          ventes: [{ produitVenteId: idMenu, quantite: 2, prixUnitaireCents: 500 }],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: 1000,
          caCarteCents: 0,
          crepesProduites: 2,
          crepesInvendues: 0,
          crepesCassees: 0,
          heureDebutReelle: '08:00',
          heureFinReelle: '14:30',
        });

        const mouvements = donneesExportMouvements(base, 2034);
        const mouvementSirop = mouvements.lignes.find(
          (l) =>
            l.ingredientNom === 'Sirop traçable (test AFSCA menu)' && l.type === 'sortie_vente',
        );
        // Le mouvement de sortie doit exister ET porter le numéro de lot
        // FOURNISSEUR précis, jamais un simple decompte anonyme — c'est
        // exactement ce que l'AFSCA exige pour un rappel produit.
        expect(mouvementSirop).toBeDefined();
        expect(mouvementSirop?.lot).toBe('LOT-SIROP-MENU-TEST');
        expect(mouvementSirop?.isAnnule).toBe(false);
      },
    );
  },
);

/* ═══════════════════════════════════════════════════════════════════════════
   Le journal des achats et la synthèse comptable doivent se réconcilier
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Audit documents — journal des achats et réception annulée', () => {
  it('exclut une réception ANNULÉE, comme la synthèse comptable — les deux doivent dire le même chiffre', () => {
    // Défaut trouvé le 30/07/2026 en câblant `reception.statut` :
    // `totalAchatsMarchandisesCents` (`depots/comptabilite.ts`) a été corrigé
    // pour ignorer les réceptions annulées, mais `donneesJournalAchats` lit LA
    // MÊME table sur LA MÊME fenêtre et ne filtrait pas.
    //
    // Le risque n'était pas un chiffre faux quelque part : c'était DEUX
    // documents qui annoncent des achats DIFFÉRENTS pour le même exercice, l'un
    // à l'écran, l'autre dans le classeur Excel remis au comptable. Le docblock
    // de cette fonction exige explicitement cette réconciliation.
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const idIngredient = creerIngredientTest(base, 'Farine journal achats (test)');
    const idFournisseur = creerFournisseurTest(base, 'Moulin journal achats (test)');

    const ligne = (prixLigneCents: number) => ({
      ingredientId: idIngredient,
      quantite: 10_000,
      prixLigneCents,
      dateDlc: '2031-12-31',
    });

    const gardee = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2031-03-04',
      lignes: [ligne(3000)],
    });
    const aAnnuler = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2031-03-05',
      lignes: [ligne(7000)],
    });

    // Avant annulation : les deux réceptions figurent au journal.
    const avant = donneesJournalAchats(base, 2031);
    expect(avant.lignes.map((l) => l.numero)).toContain(aAnnuler.numero);
    expect(avant.lignes.reduce((s, l) => s + (l.montantTotalCents ?? 0), 0)).toBe(10_000);

    annulerReception(base, aAnnuler.receptionId, 'ERREUR_SAISIE');

    const apres = donneesJournalAchats(base, 2031);
    expect(apres.lignes.map((l) => l.numero)).not.toContain(aAnnuler.numero);
    // La réception gardée reste au journal : le filtre porte sur le statut.
    expect(apres.lignes.map((l) => l.numero)).toContain(gardee.numero);
    expect(apres.lignes.reduce((s, l) => s + (l.montantTotalCents ?? 0), 0)).toBe(3000);
  });
});
