/**
 * Audit ciblé « rien ne s'efface » (30/07/2026) — suite systématique de la
 * mission qui a corrigé cette nuit `annulerProduction` (n'existait pas) et la
 * contrepassation de stock d'`annulerSession` (existait mais ne touchait
 * jamais au stock). Ce fichier couvre ce que ces deux corrections n'avaient
 * pas encore de test pour prouver, plus deux défauts supplémentaires trouvés
 * en reprenant systématiquement chaque annulation existante.
 *
 * DÉFAUT 1 — CORRIGÉ ICI : `annulerSession` ne vérifiait PAS le verrou de
 * période (`verifierPeriodeNonVerrouillee`, docs/07 §1.6), alors que
 * `cloturerSession` le fait déjà sur la MÊME date (`session.dateSession`).
 * Une session datée dans un exercice déjà transmis au comptable pouvait donc
 * être annulée après coup — statut, contrepassation de stock et exclusion du
 * modèle de prévision compris.
 *
 * DÉFAUT 2 — CORRIGÉ ICI : `contrepasserMouvement` (`services/mouvements.ts`,
 * cœur commun de `annulerMouvement`, `annulerProduction` et de la boucle
 * inline d'`annulerSession`) contrepassait une écriture `entree` SANS
 * vérifier que la matière n'avait pas déjà été consommée par un mouvement
 * postérieur (production, vente, destruction). Une entrée contrepassée après
 * consommation partielle fabriquait un `quantite_restante` NÉGATIF sur le
 * lot — une impossibilité physique que `verifierInvariantLots`
 * (`depots/stock.ts`) sait nommer mais qu'aucun point d'écriture ne refusait
 * encore. C'est exactement le piège le plus dangereux : une annulation qui a
 * l'air de fonctionner (elle écrit, elle journalise) tout en corrompant
 * silencieusement le grand livre de stock.
 *
 * DÉFAUT 3 — CORRIGÉ ICI : aucune fonction n'annulait une RÉCEPTION.
 * `annulerProduction`, `annulerSession`, `annulerCommande` et `annulerFacture`
 * couvrent chacun leur propre fait ; la réception — pourtant nommément listée
 * par CLAUDE.md §3 règle 6 (traçabilité par lot obligatoire) — n'avait aucun
 * chemin retour. `annulerReception` (`services/reception.ts`) réutilise
 * `contrepasserMouvement` lot par lot, dans une seule transaction.
 *
 * LIMITE LEVÉE LE 30/07/2026 — cet en-tête annonçait une limite qui n'existe
 * plus, et le corriger fait partie du travail : une note qui décrit un état
 * révolu envoie le lecteur suivant refaire ce qui est déjà fait.
 *
 * `annulerReception` n'était alors ni exportée par le baril
 * `packages/db/src/index.ts`, ni appelée par aucune route — les deux hors de la
 * zone d'écriture de la mission qui l'avait créée. Le fait était encodé en
 * `it.fails` plutôt que passé sous silence. **Le câblage a été fait** : la
 * fonction est exportée par le baril et exposée par
 * `POST /api/receptions/:id/annuler` (`apps/api/src/routes/stock.ts`), ce qui a
 * fait ÉCHOUER l'`it.fails` et forcé sa conversion en test de non-régression
 * ordinaire — exactement le but de cette convention. Il ne reste plus aucun
 * `it.fails` dans le dépôt.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from './client.js';
import { migrer } from './migrer.js';
import { seed } from './seed/index.js';
import { seedDemonstration } from './seed/demonstration.js';
import {
  fournisseur,
  ingredient,
  lieuMarche,
  mouvementStock,
  periode,
  produitVente,
  recette,
  recetteLigne,
  reception,
  sessionMarche,
} from './schema.js';
import { listerJournalAudit } from './depots/audit.js';
import { lotsDeLIngredient } from './depots/stock.js';
import { annulerMouvement, enregistrerSortie } from './services/mouvements.js';
import { annulerProduction, lancerProduction, saisirRealise } from './services/production.js';
import { annulerReception, enregistrerReception } from './services/reception.js';
import { annulerSession, cloturerSession, creerSession } from './services/sessions.js';

const JOUR = '2026-08-02';

function baseNeuve(): BaseBatte {
  const base = creerBase(':memory:');
  migrer(base);
  seed(base);
  seedDemonstration(base);
  return base;
}

/** Même utilitaire que `services/sessions.test.ts` et `services/mouvements.test.ts`. */
function verrouillerPeriode(base: BaseBatte, annee: number, mois: number): void {
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

/* ═══════════════════════════════════════════════════════════════════════════
   DÉFAUT 1 — annulerSession ignorait le verrou de période
   ═══════════════════════════════════════════════════════════════════════════ */

describe('annulerSession — verrou de période (docs/07 §1.6), DÉFAUT CORRIGÉ', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idCrepe: string;

  beforeEach(() => {
    base = baseNeuve();
    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte — audit verrou annulation',
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

  function cloturerAvec(sessionId: string) {
    return cloturerSession(base, sessionId, {
      ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 3000,
      caCarteCents: 0,
      crepesProduites: 10,
      crepesInvendues: 0,
      crepesCassees: 0,
    });
  }

  it(
    "DÉFAUT CORRIGÉ : refuse d'annuler une session dont la période est DEPUIS tombée " +
      'verrouillée — avant la correction, ce verrou n’était vérifié nulle part ici',
    () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: '2026-04-10' });
      cloturerAvec(session.id);

      // Le comptable verrouille le mois APRÈS la clôture, comme dans la vraie vie.
      verrouillerPeriode(base, 2026, 4);

      expect(() => annulerSession(base, session.id, 'Erreur découverte tardivement')).toThrow(
        ErreurMetier,
      );

      // Rien n'a bougé : ni le statut, ni le stock déjà sorti à la clôture.
      const relue = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(relue.statut).toBe('cloturee');
    },
  );

  it(
    'reste possible quand la période de la session est encore OUVERTE, même si un AUTRE ' +
      'mois est verrouillé — zéro régression',
    () => {
      verrouillerPeriode(base, 2026, 4);
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      cloturerAvec(session.id);

      annulerSession(base, session.id, 'Panne de gaz, fermeture après une heure');

      const relue = base
        .select()
        .from(sessionMarche)
        .where(eq(sessionMarche.id, session.id))
        .get()!;
      expect(relue.statut).toBe('annulee');
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   annulerSession — contrepassation LOT PAR LOT (pas seulement en total)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('annulerSession — la contrepassation revient EXACTEMENT lot par lot', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idFournisseur: string;
  let idIngredientSirop: string;
  let idProduitSirop: string;

  beforeEach(() => {
    base = baseNeuve();
    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte — audit lot par lot',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;

    // Ingrédient revendu NEUF, dédié à ce test : aucun stock préexistant ne
    // doit interférer avec le calcul FEFO, contrairement à un article de la
    // démonstration dont on ne contrôle pas l'historique.
    idIngredientSirop = nouvelIdentifiant();
    base
      .insert(ingredient)
      .values({
        id: idIngredientSirop,
        nom: 'Sirop de Liège — audit lot par lot',
        categorie: 'garniture',
        uniteReference: 'piece',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idProduitSirop = nouvelIdentifiant();
    base
      .insert(produitVente)
      .values({
        id: idProduitSirop,
        nom: 'Pot de sirop — audit lot par lot',
        nature: 'revendu',
        ingredientId: idIngredientSirop,
        prixCents: 600,
        nbCrepes: null,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  });

  it(
    'DÉFAUT DE COUVERTURE COMBLÉ : une vente qui puise dans DEUX lots revient, à ' +
      "l'annulation, à la quantité EXACTE de CHAQUE lot — pas seulement à la somme totale",
    () => {
      // Lot A : DLC la plus proche, servi EN PREMIER par la FEFO.
      const receptionA = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2026-07-20',
        lignes: [
          {
            ingredientId: idIngredientSirop,
            quantite: 5,
            prixLigneCents: 5 * 270,
            dateDlc: '2026-08-10',
            numeroLotFournisseur: 'SIROP-LOT-A',
          },
        ],
      });
      // Lot B : DLC plus lointaine, servi EN SECOND, seulement pour le reliquat.
      const receptionB = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2026-07-21',
        lignes: [
          {
            ingredientId: idIngredientSirop,
            quantite: 5,
            prixLigneCents: 5 * 270,
            dateDlc: '2026-09-10',
            numeroLotFournisseur: 'SIROP-LOT-B',
          },
        ],
      });
      const lotAId = receptionA.lotsCrees[0]!.lotId;
      const lotBId = receptionB.lotsCrees[0]!.lotId;

      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      // 7 unités vendues : la FEFO doit vider le lot A (5) puis puiser 2 dans le lot B.
      cloturerSession(base, session.id, {
        ventes: [{ produitVenteId: idProduitSirop, quantite: 7, prixUnitaireCents: 600 }],
        frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
        fondsCaisseInitialCents: 0,
        especesCompteesCents: 4200,
        caCarteCents: 0,
        crepesProduites: 0,
        crepesInvendues: 0,
        crepesCassees: 0,
      });

      const lotsApresVente = lotsDeLIngredient(base, idIngredientSirop);
      const lotAApresVente = lotsApresVente.find((l) => l.id === lotAId)!;
      const lotBApresVente = lotsApresVente.find((l) => l.id === lotBId)!;
      // Point de comparaison AVANT l'annulation : la FEFO a bien vidé le lot A
      // en premier, et n'a puisé que le reliquat dans le lot B.
      expect(lotAApresVente.quantiteRestante).toBe(0);
      expect(lotBApresVente.quantiteRestante).toBe(3);

      annulerSession(base, session.id, 'Session enregistrée par erreur');

      const lotsApresAnnulation = lotsDeLIngredient(base, idIngredientSirop);
      const lotAApresAnnulation = lotsApresAnnulation.find((l) => l.id === lotAId)!;
      const lotBApresAnnulation = lotsApresAnnulation.find((l) => l.id === lotBId)!;

      // LE CŒUR DU TEST : chaque lot revient à SA PROPRE quantité initiale,
      // pas seulement la somme des deux (5 + 3 = 8 aurait pu, par erreur,
      // revenir en un seul mouvement de 8 sur un seul lot et laisser
      // l'autre à zéro — le total aurait été juste, la répartition fausse).
      expect(lotAApresAnnulation.quantiteRestante).toBe(5);
      expect(lotBApresAnnulation.quantiteRestante).toBe(5);
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   DÉFAUT 2 — contrepasserMouvement pouvait fabriquer un restant négatif
   ═══════════════════════════════════════════════════════════════════════════ */

describe(
  'contrepasserMouvement — refuse de « désrecevoir » une entrée déjà consommée, ' +
    'DÉFAUT CORRIGÉ',
  () => {
    let base: BaseBatte;
    let idFarine: string;
    let idFournisseur: string;

    beforeEach(() => {
      base = baseNeuve();
      idFarine = base
        .select({ id: ingredient.id })
        .from(ingredient)
        .where(eq(ingredient.nom, 'Farine de froment T55'))
        .get()!.id;
      idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
    });

    it(
      'DÉFAUT CORRIGÉ : refuse de contrepasser une entrée quand le lot a déjà été ' +
        'partiellement consommé — sans le garde-fou, le restant du lot passait à -30',
      () => {
        const reception = enregistrerReception(base, {
          fournisseurId: idFournisseur,
          dateReception: JOUR,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 100,
              prixLigneCents: 100,
              numeroLotFournisseur: 'FARINE-AUDIT-NEGATIF',
            },
          ],
        });
        const lotId = reception.lotsCrees[0]!.lotId;

        // Une production consomme 30 unités de CE lot précis : la matière a
        // RÉELLEMENT été utilisée, elle ne peut plus être « désreçue ».
        enregistrerSortie(base, {
          ingredientId: idFarine,
          quantite: 30,
          type: 'sortie_production',
          motifCode: 'SURDOSAGE',
          dateMouvement: JOUR,
        });

        const mouvementEntree = base
          .select()
          .from(mouvementStock)
          .where(eq(mouvementStock.lotId, lotId))
          .all()
          .find((m) => m.type === 'entree')!;

        try {
          annulerMouvement(base, mouvementEntree.id, 'ERREUR_SAISIE');
          expect.unreachable('la contrepassation aurait dû être refusée');
        } catch (erreur) {
          expect(erreur).toBeInstanceOf(ErreurMetier);
          expect((erreur as ErreurMetier).code).toBe('entree_deja_consommee');
        }

        // Rien n'a bougé : le lot reste à son restant réel (70), jamais négatif.
        const lots = lotsDeLIngredient(base, idFarine);
        const lot = lots.find((l) => l.id === lotId)!;
        expect(lot.quantiteRestante).toBe(70);
        expect(lot.quantiteRestante).toBeGreaterThanOrEqual(0);
      },
    );

    it(
      'ZÉRO RÉGRESSION : reste possible de contrepasser une entrée dont le lot n’a ' +
        'JAMAIS été consommé',
      () => {
        const reception = enregistrerReception(base, {
          fournisseurId: idFournisseur,
          dateReception: JOUR,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 50,
              prixLigneCents: 100,
              numeroLotFournisseur: 'FARINE-AUDIT-INTACT',
            },
          ],
        });
        const lotId = reception.lotsCrees[0]!.lotId;
        const mouvementEntree = base
          .select()
          .from(mouvementStock)
          .where(eq(mouvementStock.lotId, lotId))
          .all()
          .find((m) => m.type === 'entree')!;

        annulerMouvement(base, mouvementEntree.id, 'ERREUR_SAISIE');

        const lots = lotsDeLIngredient(base, idFarine);
        const lot = lots.find((l) => l.id === lotId)!;
        expect(lot.quantiteRestante).toBe(0);
      },
    );
  },
);

/* ═══════════════════════════════════════════════════════════════════════════
   DÉFAUT 3 — aucune fonction n'annulait une réception
   ═══════════════════════════════════════════════════════════════════════════ */

describe("annulerReception — n'existait pas, DÉFAUT CORRIGÉ", () => {
  let base: BaseBatte;
  let idFarine: string;
  let idLevure: string;
  let idFournisseur: string;

  beforeEach(() => {
    base = baseNeuve();
    idFarine = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!.id;
    // Un second ingrédient de la recette, pour une réception à DEUX lignes
    // (donc deux lots) — la seule façon de vérifier que l'annulation reste
    // atomique lot par lot plutôt que testée sur une réception à une ligne.
    idLevure = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Sel fin'))
      .get()!.id;
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
  });

  it('contrepasse chaque lot de la réception, lot par lot, et journalise la décision', () => {
    const resultat = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 500,
          numeroLotFournisseur: 'RECEPTION-AUDIT-A',
        },
        {
          ingredientId: idLevure,
          quantite: 200,
          prixLigneCents: 100,
          numeroLotFournisseur: 'RECEPTION-AUDIT-B',
        },
      ],
    });

    expect(listerJournalAudit(base, { table: 'reception' })).toHaveLength(0);

    const annulation = annulerReception(base, resultat.receptionId, 'ERREUR_SAISIE', 'Porteur');
    expect(annulation.nbMouvementsContrepasses).toBe(2);

    const lotsFarine = lotsDeLIngredient(base, idFarine);
    const lotFarine = lotsFarine.find((l) => l.id === resultat.lotsCrees[0]!.lotId)!;
    expect(lotFarine.quantiteRestante).toBe(0);

    const lotsLevure = lotsDeLIngredient(base, idLevure);
    const lotLevure = lotsLevure.find((l) => l.id === resultat.lotsCrees[1]!.lotId)!;
    expect(lotLevure.quantiteRestante).toBe(0);

    // Rien n'est supprimé : les lots et leurs mouvements d'origine restent lisibles.
    const mouvementsFarine = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.lotId, resultat.lotsCrees[0]!.lotId))
      .all();
    expect(mouvementsFarine).toHaveLength(2);
    expect(mouvementsFarine.find((m) => m.type === 'entree')!.isAnnule).toBe(true);

    const traces = listerJournalAudit(base, {
      table: 'reception',
      enregistrementId: resultat.receptionId,
    });
    expect(traces).toHaveLength(1);
    expect(traces[0]?.action).toBe('annulation');
    expect(traces[0]?.parQui).toBe('Porteur');
  });

  it('refuse une seconde annulation de la même réception', () => {
    const resultat = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 500,
          numeroLotFournisseur: 'RECEPTION-AUDIT-DOUBLE',
        },
      ],
    });

    annulerReception(base, resultat.receptionId, 'ERREUR_SAISIE');

    expect(() => annulerReception(base, resultat.receptionId, 'ERREUR_SAISIE')).toThrow(
      ErreurMetier,
    );
  });

  /* ═════════════════════════════════════════════════════════════════════════
     `reception.statut` (colonne ajoutée le 30/07/2026) — fait vivre la
     colonne : ÉCRITE par `annulerReception`, et sa garde de double annulation
     s'appuie maintenant DESSUS plutôt que sur la déduction indirecte
     ci-dessus (absence de mouvement `entree` non annulé).
     ═════════════════════════════════════════════════════════════════════════ */

  it("écrit statut = 'annulee' sur la réception elle-même, dans la même transaction que la contrepassation, et le journalise", () => {
    const resultat = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 500,
          numeroLotFournisseur: 'RECEPTION-AUDIT-STATUT-ECRIT',
        },
      ],
    });

    const avant = base
      .select()
      .from(reception)
      .where(eq(reception.id, resultat.receptionId))
      .get()!;
    expect(avant.statut).toBe('active');

    annulerReception(base, resultat.receptionId, 'ERREUR_SAISIE', 'Porteur');

    const apres = base
      .select()
      .from(reception)
      .where(eq(reception.id, resultat.receptionId))
      .get()!;
    expect(apres.statut).toBe('annulee');

    // La décision est aussi journalisée AVEC le nouveau statut (valeurApres),
    // pas seulement en base : le journal doit pouvoir répondre lui aussi.
    const traces = listerJournalAudit(base, {
      table: 'reception',
      enregistrementId: resultat.receptionId,
    });
    expect(traces).toHaveLength(1);
    expect(traces[0]?.valeurApres?.statut).toBe('annulee');
  });

  it(
    'la garde de double annulation lit désormais le STATUT directement, pas une déduction : ' +
      'une réception dont le seul mouvement d’entrée a été contrepassé INDIVIDUELLEMENT ' +
      '(sans jamais passer par `annulerReception`) reste « active », et s’annule normalement ' +
      'au lieu d’être refusée à tort',
    () => {
      const resultat = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 500,
            numeroLotFournisseur: 'RECEPTION-AUDIT-STATUT-INDIVIDUEL',
          },
        ],
      });

      const lotId = resultat.lotsCrees[0]!.lotId;
      const mouvementEntree = base
        .select()
        .from(mouvementStock)
        .where(eq(mouvementStock.lotId, lotId))
        .all()
        .find((m) => m.type === 'entree')!;

      // Contrepassation INDIVIDUELLE du mouvement d'entrée, via la route
      // générique de correction de mouvement — SANS jamais appeler
      // `annulerReception`. L'ancienne déduction (« aucun mouvement d'entrée
      // encore ouvert ») aurait conclu, À TORT, que la RÉCEPTION elle-même
      // était déjà annulée.
      annulerMouvement(base, mouvementEntree.id, 'ERREUR_SAISIE');

      const avant = base
        .select()
        .from(reception)
        .where(eq(reception.id, resultat.receptionId))
        .get()!;
      expect(avant.statut).toBe('active');

      // La réception n'a jamais été formellement annulée : elle DOIT pouvoir
      // l'être maintenant, avec zéro mouvement encore à contrepasser.
      const annulation = annulerReception(base, resultat.receptionId, 'ERREUR_SAISIE');
      expect(annulation.nbMouvementsContrepasses).toBe(0);

      const apres = base
        .select()
        .from(reception)
        .where(eq(reception.id, resultat.receptionId))
        .get()!;
      expect(apres.statut).toBe('annulee');
    },
  );

  it(
    'ATOMICITÉ : refuse d’annuler une réception dont AU MOINS UN lot a déjà été ' +
      'consommé, et ne contrepasse alors AUCUN de ses lots — pas même les autres',
    () => {
      const resultat = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 500,
            numeroLotFournisseur: 'RECEPTION-AUDIT-PARTIELLE-A',
          },
          {
            ingredientId: idLevure,
            quantite: 200,
            prixLigneCents: 100,
            numeroLotFournisseur: 'RECEPTION-AUDIT-PARTIELLE-B',
          },
        ],
      });

      // Seul le lot de farine est consommé : le lot de sel reste intact.
      enregistrerSortie(base, {
        ingredientId: idFarine,
        quantite: 100,
        type: 'sortie_production',
        motifCode: 'SURDOSAGE',
        dateMouvement: JOUR,
      });

      expect(() => annulerReception(base, resultat.receptionId, 'ERREUR_SAISIE')).toThrow(
        ErreurMetier,
      );

      // AUCUN des deux lots n'a bougé : ni celui qui a échoué, ni celui qui
      // aurait pu être traité avant lui dans la boucle — la transaction
      // entière doit revenir en arrière, pas seulement le lot fautif.
      const mouvementsFarine = base
        .select()
        .from(mouvementStock)
        .where(eq(mouvementStock.lotId, resultat.lotsCrees[0]!.lotId))
        .all();
      expect(mouvementsFarine.find((m) => m.type === 'entree')!.isAnnule).toBe(false);

      const mouvementsLevure = base
        .select()
        .from(mouvementStock)
        .where(eq(mouvementStock.lotId, resultat.lotsCrees[1]!.lotId))
        .all();
      expect(mouvementsLevure.find((m) => m.type === 'entree')!.isAnnule).toBe(false);
    },
  );

  it("refuse d'annuler une réception datée dans une période DEPUIS verrouillée", () => {
    const resultat = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-04-10',
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 500,
          numeroLotFournisseur: 'RECEPTION-AUDIT-VERROU',
        },
      ],
    });

    verrouillerPeriode(base, 2026, 4);

    expect(() => annulerReception(base, resultat.receptionId, 'ERREUR_SAISIE')).toThrow(
      ErreurMetier,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   `annulerReception` est joignable depuis une route — dette fermée le 30/07/2026
   ═══════════════════════════════════════════════════════════════════════════ */

/** Racine du dépôt : ce fichier vit dans `packages/db/src`. */
const RACINE = resolve(__dirname, '..', '..', '..');

describe('Audit réception — annulation joignable de bout en bout', () => {
  /**
   * Ce test était un `it.fails` : `annulerReception` était écrite et testée en
   * profondeur ci-dessus, mais aucun appelant ne pouvait l'atteindre — ni le
   * baril `packages/db/src/index.ts`, ni la route HTTP, tous deux hors de la
   * zone d'écriture de l'agent qui l'avait créée.
   *
   * **Le câblage a été fait le 30/07/2026**, ce qui a fait ÉCHOUER l'`it.fails`
   * et forcé sa conversion en test de non-régression ordinaire — exactement le
   * but de cette convention. La fonction est désormais exportée par le baril et
   * exposée par `POST /api/receptions/:id/annuler`
   * (`apps/api/src/routes/stock.ts`), avec ses contrats
   * `schemaAnnulationReception` / `schemaAnnulationReceptionCreee`
   * (`packages/core/src/contrats/stock.ts`).
   *
   * Ce qu'il protège maintenant : le retour de l'écart. Une fonction
   * d'annulation qu'aucune route n'expose est indiscernable, pour le porteur,
   * d'une fonction qui n'existe pas — c'est le défaut « du code que rien
   * n'appelle », rencontré trois fois cette nuit.
   */
  it('est exportée par le baril ET exposée par une route HTTP', () => {
    const baril = readFileSync(resolve(RACINE, 'packages/db/src/index.ts'), 'utf8');
    expect(baril).toContain('annulerReception');

    const routesStock = readFileSync(resolve(RACINE, 'apps/api/src/routes/stock.ts'), 'utf8');
    expect(routesStock).toContain('annulerReception');
    // La route elle-meme, et non le seul import : un import inutilise passerait
    // les deux assertions precedentes sans exposer quoi que ce soit.
    expect(routesStock).toContain("'/receptions/:id/annuler'");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   DÉFAUT CORRIGÉ (31/07/2026) — annulerReception contrepassait aussi des
   entrées qui n'étaient PAS l'entrée d'origine de la réception.

   Contrepasser une SORTIE (production ou vente) écrit elle-même une écriture
   de type `entree` (`contrepasserMouvement`, `services/mouvements.ts` ; même
   copie locale dans `annulerSession`, `services/sessions.ts`). Après avoir
   annulé une production qui avait consommé un lot, ce lot portait donc DEUX
   `entree` non annulées : l'originale et la contrepassation de la sortie.
   `mouvementsEntreeOuverts` (`services/reception.ts`) les contrepassait
   toutes les deux — la première avec succès, ramenant le restant à zéro,
   puis la seconde échouait avec un message absurde : « il ne reste que 0 g,
   pour une entrée de 145 g », comme si la matière rendue avait déjà été
   reconsommée. L'annulation, pourtant légitime, échouait DÉFINITIVEMENT.

   Voir le commentaire de `mouvementsEntreeOuverts` pour le raisonnement
   complet du discriminant retenu (`ajustement = false` ET
   `production_id IS NULL`) et pourquoi ni l'un ni l'autre seul ne suffit.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('annulerReception — le bon discriminant sur les entrées à contrepasser, DÉFAUT CORRIGÉ', () => {
  let base: BaseBatte;
  let idR1: string;
  let idFournisseur: string;

  beforeEach(() => {
    base = baseNeuve();
    idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!.id;
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
  });

  /** Approvisionne TOUS les ingrédients actifs, sous UNE SEULE réception (une pièce). */
  function approvisionnerTout() {
    const ingredients = base.select().from(ingredient).all();
    return enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: ingredients.map((ing) => ({
        ingredientId: ing.id,
        quantite: 100_000,
        prixLigneCents: 1_000,
        numeroLotFournisseur: `LOT-DISCRIMINANT-${ing.id}`,
      })),
    });
  }

  it(
    'RÉUSSIT (rouge avant le correctif) : réception → production → annulation de la ' +
      'PRODUCTION → annulation de la réception — chaque lot de la réception, rendu entier ' +
      "par l'annulation de la production, se contrepasse normalement",
    () => {
      const resultatReception = approvisionnerTout();

      const prod = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });

      annulerProduction(base, prod.productionId, 'ERREUR_SAISIE');

      // AVANT LE CORRECTIF : cet appel levait `entree_deja_consommee` sur le
      // premier ingrédient de R1 dont le lot portait encore la
      // contrepassation-entrée de sa sortie_production, une fois l'entrée
      // d'origine déjà contrepassée par la même boucle.
      const resultat = annulerReception(base, resultatReception.receptionId, 'ERREUR_SAISIE');

      // Un mouvement contrepassé par lot : AUCUN lot de la réception n'est
      // sauté, ni compté deux fois.
      expect(resultat.nbMouvementsContrepasses).toBe(resultatReception.lotsCrees.length);

      for (const { lotId, ingredientId } of resultatReception.lotsCrees) {
        const lot = lotsDeLIngredient(base, ingredientId).find((l) => l.id === lotId)!;
        expect(lot.quantiteRestante).toBe(0);
      }
    },
  );

  it(
    "ÉCHOUE TOUJOURS (le garde-fou n'est PAS désarmé) : réception → production → " +
      'annulation de la réception SANS annuler la production — la matière a réellement ' +
      'servi, elle ne peut pas être « désreçue »',
    () => {
      const resultatReception = approvisionnerTout();

      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });

      try {
        annulerReception(base, resultatReception.receptionId, 'ERREUR_SAISIE');
        expect.unreachable(
          "l'annulation aurait dû être refusée : la production consomme encore cette matière " +
            '(elle n’a pas été annulée)',
        );
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('entree_deja_consommee');
      }

      // Rien n'a bougé : la réception reste active, aucun de ses lots n'a
      // été touché — même discipline que le test d'ATOMICITÉ ci-dessus.
      const relue = base
        .select()
        .from(reception)
        .where(eq(reception.id, resultatReception.receptionId))
        .get()!;
      expect(relue.statut).toBe('active');
    },
  );

  /**
   * TROISIÈME SCÉNARIO, INDÉPENDANT DU PREMIER — celui qui prouve que
   * `ajustement = false` SEUL n'aurait pas suffi (le piège que la mission a
   * demandé de vérifier plutôt que de supposer). La RESTITUTION d'un écart
   * réel de production (sous-consommation, `services/production.ts`, fiche
   * 9 de docs/17) écrit elle aussi un `entree`, `ajustement: false` COMME
   * l'entrée d'origine — mais avec `production_id` renseigné. Une
   * production `terminee` (jamais annulée) laisse cette ligne ouverte
   * indéfiniment : SEUL le filtre sur `production_id IS NULL` l'exclut.
   *
   * Isolé sur SA PROPRE réception à une ligne (farine seule) : les autres
   * ingrédients de R1 viennent d'une SECONDE réception, jamais annulée, dont
   * le sort n'importe pas ici — sans cette séparation, leurs lots resteraient
   * réellement consommés (aucun écart déclaré dessus) et feraient échouer
   * `annulerReception` pour une tout autre raison, masquant le point du test.
   */
  it(
    'RÉUSSIT AUSSI : une restitution d’écart réel de production (elle aussi un `entree`, ' +
      '`ajustement: false`) reste OUVERTE et n’empêche PAS d’annuler la réception quand le ' +
      'lot est, au net, redevenu entier',
    () => {
      const idFarine = base
        .select({ id: ingredient.id })
        .from(ingredient)
        .where(eq(ingredient.nom, 'Farine de froment T55'))
        .get()!.id;

      const resultatReceptionFarine = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 100_000,
            prixLigneCents: 1_000,
            numeroLotFournisseur: 'LOT-FARINE-DISCRIMINANT',
          },
        ],
      });

      // Les AUTRES ingrédients de R1, sous une réception SÉPARÉE qu'on
      // n'annule jamais dans ce test.
      const autresIngredientsR1 = base
        .select({ ingredientId: recetteLigne.ingredientId })
        .from(recetteLigne)
        .where(eq(recetteLigne.recetteId, idR1))
        .all()
        .map((l) => l.ingredientId)
        .filter((id) => id !== idFarine);

      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: autresIngredientsR1.map((ingredientId) => ({
          ingredientId,
          quantite: 100_000,
          prixLigneCents: 1_000,
          numeroLotFournisseur: `LOT-AUTRE-${ingredientId}`,
        })),
      });

      const prod = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });

      // Écart réel : la farine déclarée réellement consommée est ZÉRO —
      // toute la quantité théorique (1593 g à 5 L, voir Lot 3) est donc
      // RESTITUÉE au lot de farine, en un `entree` distinct de l'originale.
      saisirRealise(base, prod.productionId, {
        volumeReelMl: prod.volumeTheoriqueMl,
        crepesReelles: prod.crepesTheoriques,
        consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: 0 }],
      });

      const lotFarine = lotsDeLIngredient(base, idFarine).find(
        (l) => l.id === resultatReceptionFarine.lotsCrees[0]!.lotId,
      )!;
      // Le lot est redevenu ENTIER, au net : la sortie théorique et sa
      // restitution intégrale s'annulent exactement.
      expect(lotFarine.quantiteRestante).toBe(100_000);

      // AVANT LE CORRECTIF (avec seulement `ajustement = false`, sans le
      // filtre sur `production_id`) : cette restitution aurait été reprise
      // par la boucle et aurait échoué, ou aurait été contrepassée à tort —
      // selon l'ordre de la boucle, voir le commentaire de
      // `mouvementsEntreeOuverts`.
      const resultat = annulerReception(base, resultatReceptionFarine.receptionId, 'ERREUR_SAISIE');
      expect(resultat.nbMouvementsContrepasses).toBe(1);

      const lotFarineApres = lotsDeLIngredient(base, idFarine).find((l) => l.id === lotFarine.id)!;
      expect(lotFarineApres.quantiteRestante).toBe(0);

      // LA PREUVE QUE LE FILTRE A BIEN EXCLU LA RESTITUTION, PAS QU'ELLE A
      // DISPARU PAR HASARD : elle reste lisible, non annulée — l'annulation
      // de la réception ne l'a pas touchée, comme il se doit (elle relève de
      // la production, pas de la réception).
      const mouvementsFarine = base
        .select()
        .from(mouvementStock)
        .where(eq(mouvementStock.lotId, lotFarine.id))
        .all();
      const restitution = mouvementsFarine.find(
        (m) => m.productionId === prod.productionId && m.type === 'entree',
      );
      expect(restitution).toBeDefined();
      expect(restitution!.isAnnule).toBe(false);
      expect(restitution!.ajustement).toBe(false);
    },
  );
});
