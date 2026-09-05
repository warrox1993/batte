/**
 * Tests d'integration du Lot 8 — tracabilite bidirectionnelle.
 *
 * Critere de fin de docs/04-ROADMAP-LOTS.md : « Je pars d'une date de vente et
 * je remonte a tous les lots fournisseurs concernes en un clic », et
 * symetriquement, d'un lot fournisseur vers toutes les sessions impactees.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurIntrouvable, ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import {
  fournisseur,
  ingredient,
  lieuMarche,
  produitVente,
  recette,
  sessionMarche,
} from '../schema.js';
import { lotsDeLIngredient } from './stock.js';
import { annulerReception, enregistrerReception } from '../services/reception.js';
import { changerStatutLot, enregistrerSortie } from '../services/mouvements.js';
import { lancerProduction } from '../services/production.js';
import { cloturerSession, creerSession } from '../services/sessions.js';
import { tracabiliteAmontSession, tracabiliteAvalLot } from './tracabilite.js';

const JOUR = '2026-07-27';

describe('Lot 8 — tracabilite bidirectionnelle', () => {
  let base: BaseBatte;
  let idR1: string;
  let idFournisseur: string;
  let idLieu: string;

  /** Approvisionne genereusement tous les ingredients de R1, comme au Lot 3. */
  function approvisionner() {
    const ingredients = base.select().from(ingredient).all();
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: ingredients.map((ing) => ({
        ingredientId: ing.id,
        quantite: 100_000,
        prixLigneCents: 1000,
        numeroLotFournisseur: 'LOT-TEST',
      })),
    });
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!.id;
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
  });

  it('critere de fin : remonte d une session a tous les lots fournisseurs consommes', () => {
    approvisionner();
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    const production = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
      sessionId: session.id,
    });

    const resultat = tracabiliteAmontSession(base, session.id);

    expect(resultat.sessionId).toBe(session.id);
    expect(resultat.numero).toBe(session.numero);
    expect(resultat.productions).toHaveLength(1);

    const prod = resultat.productions[0]!;
    expect(prod.productionId).toBe(production.productionId);
    expect(prod.numeroLotPate).toBe(production.numeroLotPate);
    expect(prod.recetteCode).toBe('R1');
    // Une ligne par lot consomme, comme au Lot 3.
    expect(prod.consommations.length).toBeGreaterThanOrEqual(8);
    for (const c of prod.consommations) {
      expect(c.fournisseurNom).toBeTruthy();
      expect(c.receptionNumero).toBeTruthy();
      expect(c.ingredientNom).toBeTruthy();
    }
  });

  it('une session sans aucune production rend une liste vide, jamais une erreur', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    const resultat = tracabiliteAmontSession(base, session.id);
    expect(resultat.productions).toEqual([]);
  });

  it('leve ErreurIntrouvable sur une session inconnue', () => {
    expect(() => tracabiliteAmontSession(base, 'session-inexistante')).toThrow(ErreurIntrouvable);
  });

  it('critere de fin : remonte d un lot fournisseur a la session impactee', () => {
    approvisionner();
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
      sessionId: session.id,
    });

    const farine = base
      .select()
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get();
    const lots = lotsDeLIngredient(base, farine!.id);
    // Une seule reception dans ce test : un seul lot de farine.
    const lotConsomme = lots[0]!;

    const resultat = tracabiliteAvalLot(base, lotConsomme.id);

    expect(resultat.ingredientNom).toBe('Farine de froment T55');
    expect(resultat.productions).toHaveLength(1);
    expect(resultat.productions[0]!.session).not.toBeNull();
    expect(resultat.productions[0]!.session?.numero).toBe(session.numero);
  });

  /* ═══════════════════════════════════════════════════════════════════════
     Le geste réel d'un rappel fournisseur : depuis un lot d'ingrédient
     réceptionné, retrouver le NUMÉRO DE LOT DE PÂTE des fournées qui l'ont
     consommé. `schema.ts` (table `production`, champ `numero_lot_pate`)
     désigne ce numéro comme « le lien qui rend la traçabilité
     bidirectionnelle possible » — avant ce correctif, `TracabiliteAvalProduction`
     l'omettait, et seule la fonction morte `productionsDuLot`
     (`depots/productions.ts`, zéro appelant) le portait côté aval.
     ═══════════════════════════════════════════════════════════════════════ */
  it(
    "chaine complete d'un rappel : reception d'un lot d'ingredient -> production qui " +
      'le consomme -> le numero de lot de pate se retrouve depuis ce lot',
    () => {
      approvisionner();
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      const production = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
        sessionId: session.id,
      });

      const farine = base
        .select()
        .from(ingredient)
        .where(eq(ingredient.nom, 'Farine de froment T55'))
        .get();
      const lots = lotsDeLIngredient(base, farine!.id);
      // Une seule reception dans ce test : un seul lot de farine, celui que le
      // meunier rappellerait.
      const lotRappele = lots[0]!;

      const resultat = tracabiliteAvalLot(base, lotRappele.id);

      expect(resultat.productions).toHaveLength(1);
      // Le geste du rappel : ce numero de lot de pate est ce qui doit etre
      // retire/controle, exactement celui qu'a produit `lancerProduction`.
      expect(resultat.productions[0]!.numeroLotPate).toBe(production.numeroLotPate);
      expect(resultat.productions[0]!.numeroLotPate).toMatch(/^PATE-/);
    },
  );

  it('une production sans session destinee rend session: null, jamais une erreur', () => {
    approvisionner();
    lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
      // Pas de sessionId : la pate n'est pas encore affectee a un marche.
    });

    const farine = base
      .select()
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get();
    const lots = lotsDeLIngredient(base, farine!.id);
    const lotConsomme = lots[0]!;

    const resultat = tracabiliteAvalLot(base, lotConsomme.id);

    expect(resultat.productions).toHaveLength(1);
    expect(resultat.productions[0]!.session).toBeNull();
  });

  it('leve ErreurIntrouvable sur un lot inconnu', () => {
    expect(() => tracabiliteAvalLot(base, 'lot-inexistant')).toThrow(ErreurIntrouvable);
  });

  /* ═══════════════════════════════════════════════════════════════════════
     `reception.statut` exposé dans la traçabilité (audit du 30/07/2026) —
     un lot issu d'une réception ANNULÉE ne doit pas être présenté comme une
     marchandise normalement reçue, sans pour autant disparaître du registre
     (CLAUDE.md §7 : « rien ne s'efface »).
     ═══════════════════════════════════════════════════════════════════════ */

  it(
    'expose receptionStatut = "active" sur chaque consommation amont d’une ' +
      'réception non annulée',
    () => {
      approvisionner();
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
        sessionId: session.id,
      });

      const resultat = tracabiliteAmontSession(base, session.id);
      const prod = resultat.productions[0]!;
      expect(prod.consommations.length).toBeGreaterThan(0);
      for (const c of prod.consommations) {
        expect(c.receptionStatut).toBe('active');
      }
    },
  );

  it(
    'expose receptionStatut = "annulee" sur l’entête aval d’un lot dont la ' +
      'réception a été annulée, SANS le faire disparaître du registre',
    () => {
      const uneLigne = base.select().from(ingredient).limit(1).all()[0]!;
      const resultatReception = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: uneLigne.id,
            quantite: 1000,
            prixLigneCents: 500,
            numeroLotFournisseur: 'TRACABILITE-RECEPTION-ANNULEE',
          },
        ],
      });
      const lotId = resultatReception.lotsCrees[0]!.lotId;

      // Ce lot n'a JAMAIS servi : l'annulation de sa réception doit réussir.
      annulerReception(base, resultatReception.receptionId, 'ERREUR_SAISIE');

      const resultat = tracabiliteAvalLot(base, lotId);
      // Le lot reste pleinement lisible : seul son statut de réception change.
      expect(resultat.lotId).toBe(lotId);
      expect(resultat.receptionStatut).toBe('annulee');
    },
  );

  it(
    'un lot déjà consommé empêche l’annulation de sa réception : le second cas ' +
      '(lot consommé PUIS réception annulée) ne peut donc pas se produire en pratique',
    () => {
      const uneLigne = base.select().from(ingredient).limit(1).all()[0]!;
      const resultatReception = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: uneLigne.id,
            quantite: 1000,
            prixLigneCents: 500,
            numeroLotFournisseur: 'TRACABILITE-RECEPTION-CONSOMMEE',
          },
        ],
      });

      // La matière a RÉELLEMENT servi avant toute tentative d'annulation.
      enregistrerSortie(base, {
        ingredientId: uneLigne.id,
        quantite: 100,
        type: 'sortie_production',
        motifCode: 'SURDOSAGE',
        dateMouvement: JOUR,
      });

      expect(() => annulerReception(base, resultatReception.receptionId, 'ERREUR_SAISIE')).toThrow(
        ErreurMetier,
      );
    },
  );

  /* ═══════════════════════════════════════════════════════════════════════
     Mesure de charge du 30/07/2026 : `sessionResume` (privée à ce fichier)
     était appelée une fois par ligne de CONSOMMATION et une fois par ligne
     de VENTE, sans cache — 49,7 ms à 150 sessions, 136,6 ms à 396, une
     croissance quasi parfaitement linéaire, la signature d'une requête
     répétée. Corrigée par un cache LOCAL À L'APPEL (`sessionsParId`), même
     patron que `garniesParSession`, trois lignes plus haut dans le même
     fichier.

     Preuve d'équivalence : chaque `session` renvoyée par `tracabiliteAvalLot`
     est comparée, CHAMP PAR CHAMP, à une lecture INDÉPENDANTE — la même
     jointure `session_marche` × `lieu_marche` que `sessionResume` exécute,
     réécrite ici à la main puisque `sessionResume` n'est pas exportée — sur
     un jeu de données qui touche les DEUX points d'appel mémoïsés
     (consommations de production ET ventes directes), sur PLUSIEURS
     sessions et PLUSIEURS lieux.
     ═══════════════════════════════════════════════════════════════════════ */
  describe('tracabiliteAvalLot — cache de sessionResume, équivalence multi-sessions/multi-lieux', () => {
    /** Lecture INDÉPENDANTE d'un résumé de session — même jointure que `sessionResume` (privée). */
    function sessionResumeIndependant(sessionId: string) {
      return base
        .select({
          id: sessionMarche.id,
          numero: sessionMarche.numero,
          dateSession: sessionMarche.dateSession,
          lieuNom: lieuMarche.nom,
        })
        .from(sessionMarche)
        .innerJoin(lieuMarche, eq(sessionMarche.lieuId, lieuMarche.id))
        .where(eq(sessionMarche.id, sessionId))
        .get();
    }

    /** Un second lieu, minimal, propre à ce bloc de test. */
    function insererLieu(nom: string): string {
      const id = nouvelIdentifiant();
      const maintenant = maintenantUtc();
      base
        .insert(lieuMarche)
        .values({
          id,
          nom,
          latitude: 50.6,
          longitude: 5.57,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      return id;
    }

    it('productions : la session de chaque ligne de consommation est identique, champ par champ, à une lecture indépendante — un même lot, trois sessions, deux lieux', () => {
      const idLieu2 = insererLieu('Marché voisin (cache productions)');
      approvisionner();

      // Trois productions consommant la MÊME fournée de farine (une seule
      // réception dans `approvisionner()`), rattachées à trois sessions
      // distinctes sur DEUX lieux différents.
      const session1 = creerSession(base, { lieuId: idLieu, dateSession: '2026-07-27' });
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: '2026-07-27',
        sessionId: session1.id,
      });
      const session2 = creerSession(base, { lieuId: idLieu2, dateSession: '2026-08-03' });
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: '2026-08-03',
        sessionId: session2.id,
      });
      const session3 = creerSession(base, { lieuId: idLieu, dateSession: '2026-08-10' });
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: '2026-08-10',
        sessionId: session3.id,
      });

      const farine = base
        .select()
        .from(ingredient)
        .where(eq(ingredient.nom, 'Farine de froment T55'))
        .get()!;
      const lotFarine = lotsDeLIngredient(base, farine.id)[0]!;

      const resultat = tracabiliteAvalLot(base, lotFarine.id);
      expect(resultat.productions.length).toBeGreaterThanOrEqual(3);

      for (const prod of resultat.productions) {
        if (prod.session === null) continue;
        const attendu = sessionResumeIndependant(prod.session.id);
        expect(attendu).toBeDefined();
        expect(prod.session).toEqual(attendu);
      }

      // Les trois sessions précises, sur les deux lieux, sont bien représentées.
      const numeros = resultat.productions.map((p) => p.session?.numero);
      expect(numeros).toEqual(
        expect.arrayContaining([session1.numero, session2.numero, session3.numero]),
      );
      const lieux = new Set(resultat.productions.map((p) => p.session?.lieuNom));
      expect(lieux.size).toBeGreaterThanOrEqual(2);
    });

    it('ventes directes (revendu) : la session de chaque sortie est identique, champ par champ, à une lecture indépendante — un même lot, trois sessions, deux lieux', () => {
      const idLieu2 = insererLieu('Marché voisin (cache ventes)');

      const produitRevendu = base
        .select({
          id: produitVente.id,
          prixCents: produitVente.prixCents,
          ingredientId: produitVente.ingredientId,
        })
        .from(produitVente)
        .where(eq(produitVente.nature, 'revendu'))
        .get();
      if (produitRevendu === undefined || produitRevendu.ingredientId === null) {
        throw new Error('La graine de démonstration ne fournit aucun produit revendu.');
      }

      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: '2026-07-20',
        lignes: [
          {
            ingredientId: produitRevendu.ingredientId,
            quantite: 100,
            prixLigneCents: 5000,
            numeroLotFournisseur: 'LOT-REVENDU-CACHE-TEST',
            dateDlc: '2027-01-01',
          },
        ],
      });

      function vendre(lieu: string, dateSession: string): { id: string; numero: string } {
        const session = creerSession(base, { lieuId: lieu, dateSession });
        cloturerSession(base, session.id, {
          ventes: [
            {
              produitVenteId: produitRevendu!.id,
              quantite: 1,
              prixUnitaireCents: produitRevendu!.prixCents,
            },
          ],
          frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
          fondsCaisseInitialCents: 0,
          especesCompteesCents: produitRevendu!.prixCents,
          caCarteCents: 0,
          // Un revendu ne consomme aucune crêpe : rien à produire pour cette vente.
          crepesProduites: 0,
          crepesInvendues: 0,
          crepesCassees: 0,
        });
        return session;
      }

      const session1 = vendre(idLieu, '2026-07-27');
      const session2 = vendre(idLieu2, '2026-08-03');
      const session3 = vendre(idLieu, '2026-08-10');

      const lot = lotsDeLIngredient(base, produitRevendu.ingredientId).find(
        (l) => l.numeroLotFournisseur === 'LOT-REVENDU-CACHE-TEST',
      );
      if (lot === undefined) throw new Error('Lot de test introuvable.');

      const resultat = tracabiliteAvalLot(base, lot.id);
      // Un produit revendu tombe dans `ventes` (jamais `garnitures`, aucune
      // garniture n'est en jeu ici) — voir `tracabilite-menu-garniture.test.ts`.
      expect(resultat.garnitures).toEqual([]);
      expect(resultat.ventes.length).toBeGreaterThanOrEqual(3);

      for (const vente of resultat.ventes) {
        const attendu = sessionResumeIndependant(vente.session.id);
        expect(attendu).toBeDefined();
        expect(vente.session).toEqual(attendu);
      }

      const idsSessions = new Set(resultat.ventes.map((v) => v.session.id));
      expect(idsSessions).toEqual(new Set([session1.id, session2.id, session3.id]));
      const lieux = new Set(resultat.ventes.map((v) => v.session.lieuNom));
      expect(lieux.size).toBeGreaterThanOrEqual(2);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     Audit du 30/07/2026 (`audit-colonnes-orphelines.test.ts`) : `lot.motif_statut_id`
     et `lot.date_changement_statut` sont écrites à CHAQUE changement de statut
     d'un lot (`changerStatutLot`, `services/mouvements.ts`) — la trace exacte
     qu'un contrôle AFSCA vient chercher, « pourquoi ce lot a-t-il été bloqué,
     et quand » — mais n'étaient exposées nulle part, y compris dans la
     traçabilité aval qui est précisément l'écran d'un rappel.
     ═══════════════════════════════════════════════════════════════════════ */
  describe('tracabiliteAvalLot — statut, motif et date du dernier changement de statut', () => {
    function receptionnerUnLot(numeroLotFournisseur: string): string {
      const uneLigne = base.select().from(ingredient).limit(1).all()[0]!;
      const resultatReception = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: uneLigne.id,
            quantite: 1000,
            prixLigneCents: 500,
            numeroLotFournisseur,
          },
        ],
      });
      return resultatReception.lotsCrees[0]!.lotId;
    }

    it(
      "rend statut = 'disponible' et motifStatutLibelle/dateChangementStatut à " +
        "`null` sur un lot qui n'a jamais changé de statut depuis sa réception",
      () => {
        const lotId = receptionnerUnLot('TRACABILITE-STATUT-JAMAIS-CHANGE');

        const resultat = tracabiliteAvalLot(base, lotId);

        expect(resultat.statut).toBe('disponible');
        expect(resultat.motifStatutLibelle).toBeNull();
        expect(resultat.dateChangementStatut).toBeNull();
      },
    );

    it('expose le motif et la date du dernier changement de statut après une mise en quarantaine', () => {
      const lotId = receptionnerUnLot('TRACABILITE-STATUT-QUARANTAINE');

      changerStatutLot(base, lotId, 'quarantaine', 'QUARANTAINE_DOUTE', JOUR);

      const resultat = tracabiliteAvalLot(base, lotId);

      expect(resultat.statut).toBe('quarantaine');
      expect(resultat.motifStatutLibelle).toBe('Mise en quarantaine — conformité à vérifier');
      expect(resultat.dateChangementStatut).not.toBeNull();
    });

    it(
      'après une levée de quarantaine, le motif affiché est celui du RELÂCHEMENT, ' +
        'pas de la mise en quarantaine — ces deux colonnes ne portent que le DERNIER changement',
      () => {
        const lotId = receptionnerUnLot('TRACABILITE-STATUT-LEVEE');

        changerStatutLot(base, lotId, 'quarantaine', 'QUARANTAINE_DOUTE', JOUR);
        changerStatutLot(base, lotId, 'disponible', 'LEVEE_QUARANTAINE', JOUR);

        const resultat = tracabiliteAvalLot(base, lotId);

        expect(resultat.statut).toBe('disponible');
        expect(resultat.motifStatutLibelle).toBe('Levée de quarantaine après vérification');
      },
    );

    it('expose statut = "bloque" et le motif de rappel fournisseur après un blocage', () => {
      const lotId = receptionnerUnLot('TRACABILITE-STATUT-RAPPEL');

      changerStatutLot(base, lotId, 'bloque', 'RAPPEL_FOURNISSEUR', JOUR);

      const resultat = tracabiliteAvalLot(base, lotId);

      expect(resultat.statut).toBe('bloque');
      expect(resultat.motifStatutLibelle).toBe('Bloqué suite à un rappel fournisseur');
      expect(resultat.dateChangementStatut).not.toBeNull();
    });
  });
});
