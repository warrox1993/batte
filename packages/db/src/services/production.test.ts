/**
 * Tests d'integration du Lot 3.
 *
 * Critere de fin de docs/04-ROADMAP-LOTS.md : « Je lance une production de 5 L
 * de R1, le stock se decremente automatiquement en respectant la FEFO, un lot
 * de pate est cree, et je peux tracer chaque ingredient consomme jusqu'a son
 * lot fournisseur. »
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import {
  fournisseur,
  ingredient,
  lieuMarche,
  mouvementStock,
  periode,
  prevision,
  produitVente,
  production,
  productionConsommation,
  recette,
  sessionMarche,
} from '../schema.js';
import { tracabiliteAvalLot } from '../depots/tracabilite.js';
import { lireProductionDetail } from '../depots/productions.js';
import { etatDuStock, lotsDeLIngredient } from '../depots/stock.js';
import { listerJournalAudit } from '../depots/audit.js';
import { enregistrerReception } from './reception.js';
import { cloturerSession, creerSession } from './sessions.js';
import {
  annulerProduction,
  lancerProduction,
  rattacherSession,
  saisirRealise,
  sessionsDesProductions,
  verifierFaisabilite,
} from './production.js';

const JOUR = '2026-07-27';

describe('Lot 3 — production', () => {
  let base: BaseBatte;
  let idR1: string;
  let idFournisseur: string;

  /**
   * Approvisionne genereusement tous les ingredients de R1.
   *
   * `numeroLotFournisseur` fixe (docs/17 fiche 16) : un lot doit etre
   * identifiable par un numero OU par une DLC precise, jamais ni l'un ni
   * l'autre. La plupart des ingredients de demonstration n'ont pas de duree de
   * conservation declaree (pas de DLC deduite) : sans numero, `reception.ts`
   * refuserait desormais ces lignes.
   */
  function approvisionner(facteur = 1) {
    const ingredients = base.select().from(ingredient).all();
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: ingredients.map((ing) => ({
        ingredientId: ing.id,
        quantite: 100_000 * facteur,
        prixLigneCents: 1000 * facteur,
        numeroLotFournisseur: 'LOT-TEST-APPRO',
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
  });

  it('critere de fin : 5 L de R1 produits, stock decremente, lot de pate cree', () => {
    approvisionner();
    const avant = etatDuStock(base, JOUR);

    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    expect(resultat.numero).toBe('PR-2026-0001');
    expect(resultat.numeroLotPate).toBe('PATE-PR-2026-0001');
    expect(resultat.volumeTheoriqueMl).toBe(5000);
    // 5 L a ~76 ml/crepe -> ~66 crepes (decision D-014).
    expect(resultat.crepesTheoriques).toBe(66);

    const apres = etatDuStock(base, JOUR);
    const farineAvant = avant.find((l) => l.nom.includes('Farine'))!.quantiteDisponible;
    const farineApres = apres.find((l) => l.nom.includes('Farine'))!.quantiteDisponible;
    // 145 g x (5000/455) = 1593 g consommes.
    expect(farineAvant - farineApres).toBe(1593);
  });

  it('la DLC de la pate vient du parametre, pas d un 24 h code en dur', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    // `duree_conservation_pate_heures` vaut 24 dans le catalogue.
    expect(resultat.dateDlcPate).toBe('2026-07-28T00:00:00.000Z');
  });

  it('trace chaque ingredient jusqu a son lot fournisseur', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    const consommations = base
      .select()
      .from(productionConsommation)
      .where(eq(productionConsommation.productionId, resultat.productionId))
      .all();

    // Une ligne par LOT consomme : c'est ce qui rend la tracabilite possible.
    expect(consommations.length).toBeGreaterThanOrEqual(8);
    for (const c of consommations) {
      expect(c.lotId).toBeTruthy();
      expect(c.quantiteTheorique).toBeGreaterThan(0);
    }
  });

  it('consomme plusieurs lots quand un seul ne suffit pas, en FEFO', () => {
    // Deux petits lots de farine : le plus proche de la DLC doit partir d'abord.
    const ingredients = base.select().from(ingredient).all();
    const farine = ingredients.find((i) => i.nom.includes('Farine'))!;
    const autres = ingredients.filter((i) => i.id !== farine.id);

    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: [
        ...autres.map((i) => ({
          ingredientId: i.id,
          quantite: 100_000,
          prixLigneCents: 1000,
          numeroLotFournisseur: 'LOT-TEST-APPRO',
        })),
        { ingredientId: farine.id, quantite: 1000, prixLigneCents: 100, dateDlc: '2026-12-31' },
      ],
    });
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: [
        { ingredientId: farine.id, quantite: 1000, prixLigneCents: 100, dateDlc: '2026-08-05' },
      ],
    });

    lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    const lots = lotsDeLIngredient(base, farine.id);
    const tot = lots.find((l) => l.dateDlc === '2026-08-05')!;
    const tard = lots.find((l) => l.dateDlc === '2026-12-31')!;

    // 1593 g requis : le lot le plus proche de la DLC est vide en premier.
    expect(tot.quantiteRestante).toBe(0);
    expect(tard.quantiteRestante).toBe(407);
  });

  it('refuse une production infaisable en nommant l ingredient limitant', () => {
    // Rien en stock du tout.
    try {
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });
      expect.unreachable('la production aurait du echouer');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      const metier = erreur as ErreurMetier;
      expect(metier.code).toBe('production_infaisable');
      expect(metier.message).toContain('il manque');
    }
  });

  it("n'ecrit RIEN quand la production echoue", () => {
    // Atomicite : un stock consomme sans lot de pate rendrait la tracabilite
    // fausse. On verifie qu'aucune trace ne subsiste.
    try {
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });
    } catch {
      // echec attendu
    }

    expect(base.select().from(production).all()).toHaveLength(0);
    expect(base.select().from(productionConsommation).all()).toHaveLength(0);
  });

  it('refuse de produire une recette qui n est pas active', () => {
    approvisionner();
    const idR2 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R2')).get()!
      .id;

    expect(() =>
      lancerProduction(base, {
        recetteId: idR2,
        cible: { type: 'volume', volumeMl: 1000 },
        dateProduction: JOUR,
      }),
    ).toThrow(ErreurMetier);
  });

  it('numerote les productions sans trou', () => {
    approvisionner(10);
    const a = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 1000 },
      dateProduction: JOUR,
    });
    const b = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 1000 },
      dateProduction: JOUR,
    });

    expect(a.numero).toBe('PR-2026-0001');
    expect(b.numero).toBe('PR-2026-0002');
  });

  it('verifie la faisabilite SANS rien ecrire', () => {
    approvisionner();
    const avant = base.select().from(production).all().length;

    const controle = verifierFaisabilite(base, idR1, { type: 'volume', volumeMl: 5000 }, JOUR);

    expect(controle.faisabilite.faisable).toBe(true);
    expect(controle.crepes).toBe(66);
    expect(base.select().from(production).all().length).toBe(avant);
  });

  it('annonce le volume maximal produisible quand le stock ne suffit pas', () => {
    const ingredients = base.select().from(ingredient).all();
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: ingredients.map((i) => ({
        ingredientId: i.id,
        quantite: i.nom.includes('Farine') ? 1450 : 100_000,
        prixLigneCents: 1000,
        numeroLotFournisseur: 'LOT-TEST-APPRO',
      })),
    });

    const controle = verifierFaisabilite(base, idR1, { type: 'volume', volumeMl: 5000 }, JOUR);

    expect(controle.faisabilite.faisable).toBe(false);
    // 1450 g de farine = 10 fournees de 455 ml = 4550 ml.
    expect(controle.faisabilite.volumeMaximalMl).toBe(4550);
  });

  it('saisit le realise sans jamais modifier le theorique', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    saisirRealise(base, resultat.productionId, {
      volumeReelMl: 4800,
      crepesReelles: 61,
      ecartMotif: 'Fond de bassine plus important que prévu',
    });

    const apres = base
      .select()
      .from(production)
      .where(eq(production.id, resultat.productionId))
      .get()!;

    // Le realise est enregistre…
    expect(apres.volumeReelMl).toBe(4800);
    expect(apres.crepesReelles).toBe(61);
    expect(apres.statut).toBe('terminee');
    // …et le theorique est intact : c'est de leur ecart que nait l'analyse.
    expect(apres.volumeTheoriqueMl).toBe(5000);
    expect(apres.crepesTheoriques).toBe(66);
  });

  it('refuse un realise negatif', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    expect(() =>
      saisirRealise(base, resultat.productionId, { volumeReelMl: -1, crepesReelles: 10 }),
    ).toThrow(ErreurMetier);
  });

  /**
   * Fiche 9 (docs/17) : la consommation reelle par ingredient devient un vrai
   * mouvement rattache a la production, jamais une valeur devinee. Critere de
   * fin explicite : `decomposerEcart` produit l'ecart, et la colonne
   * `quantite_reelle` cesse d'afficher un tiret — au moins quand elle est
   * attribuable sans ambiguite.
   */
  describe('fiche 9 — consommation reelle par ingredient', () => {
    let idFarine: string;

    beforeEach(() => {
      idFarine = base
        .select({ id: ingredient.id })
        .from(ingredient)
        .where(eq(ingredient.nom, 'Farine de froment T55'))
        .get()!.id;
    });

    function consommationFarine(productionId: string) {
      return base
        .select()
        .from(productionConsommation)
        .where(eq(productionConsommation.productionId, productionId))
        .all()
        .find((c) => c.ingredientId === idFarine)!;
    }

    it('sur-consommation (reel > theorique) : ecrit un mouvement de sortie_production SUPPLEMENTAIRE', () => {
      approvisionner();
      const resultat = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });
      const theorique = consommationFarine(resultat.productionId).quantiteTheorique;
      const reel = theorique + 50;

      saisirRealise(base, resultat.productionId, {
        volumeReelMl: 4800,
        crepesReelles: 61,
        consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: reel }],
      });

      const mouvements = base
        .select()
        .from(mouvementStock)
        .where(eq(mouvementStock.productionId, resultat.productionId))
        .all()
        .filter((m) => m.ingredientId === idFarine);

      // La sortie THEORIQUE d'origine, PLUS une sortie d'ecart pour les 50 g
      // reellement consommes en plus.
      expect(mouvements).toHaveLength(2);
      const sortiesProduction = mouvements.filter((m) => m.type === 'sortie_production');
      expect(sortiesProduction).toHaveLength(2);
      expect(sortiesProduction.reduce((total, m) => total + m.quantite, 0)).toBe(theorique + 50);

      // Un seul lot consomme pour cet ingredient : la valeur declaree est
      // attribuable sans ambiguite, la colonne cesse d'afficher un tiret.
      const ligne = consommationFarine(resultat.productionId);
      expect(ligne.quantiteReelle).toBe(reel);

      const apres = base
        .select()
        .from(production)
        .where(eq(production.id, resultat.productionId))
        .get()!;
      expect(apres.coutMatiereReelCents!).toBeGreaterThan(apres.coutMatiereTheoriqueCents);
    });

    it('sous-consommation (reel < theorique) : restitue la difference au MEME lot, en entree', () => {
      approvisionner();
      const resultat = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });
      const consommation = consommationFarine(resultat.productionId);
      const theorique = consommation.quantiteTheorique;
      // 100 g et non 30 : au prix de demonstration (0,01 c/g), 30 g arrondirait
      // a 0 centime credite et le test ne prouverait rien sur le cout reel.
      const reel = theorique - 100;

      saisirRealise(base, resultat.productionId, {
        volumeReelMl: 4800,
        crepesReelles: 61,
        consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: reel }],
      });

      const mouvements = base
        .select()
        .from(mouvementStock)
        .where(eq(mouvementStock.productionId, resultat.productionId))
        .all()
        .filter((m) => m.ingredientId === idFarine);

      const retour = mouvements.find((m) => m.type === 'entree');
      expect(retour).toBeDefined();
      expect(retour!.quantite).toBe(100);
      // Restitue au MEME lot que celui consomme par cette production.
      expect(retour!.lotId).toBe(consommation.lotId);

      expect(consommationFarine(resultat.productionId).quantiteReelle).toBe(reel);

      const apres = base
        .select()
        .from(production)
        .where(eq(production.id, resultat.productionId))
        .get()!;
      expect(apres.coutMatiereReelCents!).toBeLessThan(apres.coutMatiereTheoriqueCents);
    });

    it('ecart nul : fige quantite_reelle SANS ecrire de mouvement supplementaire', () => {
      approvisionner();
      const resultat = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });
      const theorique = consommationFarine(resultat.productionId).quantiteTheorique;

      saisirRealise(base, resultat.productionId, {
        volumeReelMl: 5000,
        crepesReelles: 66,
        consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: theorique }],
      });

      const mouvements = base
        .select()
        .from(mouvementStock)
        .where(eq(mouvementStock.productionId, resultat.productionId))
        .all()
        .filter((m) => m.ingredientId === idFarine);
      // Toujours UNE seule ecriture : la sortie theorique d'origine.
      expect(mouvements).toHaveLength(1);

      expect(consommationFarine(resultat.productionId).quantiteReelle).toBe(theorique);
    });

    it('plusieurs lots consommes pour le meme ingredient : le mouvement est ecrit, quantite_reelle reste null (attribution ambigue)', () => {
      // Deux petits lots de farine, comme le test FEFO ci-dessus : la
      // production doit puiser dans les DEUX pour couvrir son besoin.
      const ingredients = base.select().from(ingredient).all();
      const farine = ingredients.find((i) => i.id === idFarine)!;
      const autres = ingredients.filter((i) => i.id !== farine.id);

      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          ...autres.map((i) => ({
            ingredientId: i.id,
            quantite: 100_000,
            prixLigneCents: 1000,
            numeroLotFournisseur: 'LOT-TEST-APPRO',
          })),
          { ingredientId: farine.id, quantite: 1000, prixLigneCents: 100, dateDlc: '2026-12-31' },
        ],
      });
      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          { ingredientId: farine.id, quantite: 1000, prixLigneCents: 100, dateDlc: '2026-08-05' },
        ],
      });

      const resultat = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });

      const lignesFarine = base
        .select()
        .from(productionConsommation)
        .where(eq(productionConsommation.productionId, resultat.productionId))
        .all()
        .filter((c) => c.ingredientId === idFarine);
      expect(lignesFarine.length).toBeGreaterThan(1); // FEFO a bien puise sur deux lots.

      const theorique = lignesFarine.reduce((total, l) => total + l.quantiteTheorique, 0);

      saisirRealise(base, resultat.productionId, {
        volumeReelMl: 4800,
        crepesReelles: 61,
        consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: theorique - 20 }],
      });

      // Le mouvement d'ecart EST ecrit : l'information vit la, pas dans une
      // colonne qui devine.
      const retour = base
        .select()
        .from(mouvementStock)
        .where(eq(mouvementStock.productionId, resultat.productionId))
        .all()
        .find((m) => m.ingredientId === idFarine && m.type === 'entree');
      expect(retour).toBeDefined();
      expect(retour!.quantite).toBe(20);

      // Mais AUCUNE ligne de production_consommation n'est figee : attribuer
      // 20 g a UN lot plutot qu'a l'autre serait inventer une mesure.
      const apresLignes = base
        .select()
        .from(productionConsommation)
        .where(eq(productionConsommation.productionId, resultat.productionId))
        .all()
        .filter((c) => c.ingredientId === idFarine);
      expect(apresLignes.every((l) => l.quantiteReelle === null)).toBe(true);
    });

    it('refuse une seconde saisie de consommationsReelles : ne double pas la correction', () => {
      approvisionner();
      const resultat = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });
      const theorique = consommationFarine(resultat.productionId).quantiteTheorique;

      saisirRealise(base, resultat.productionId, {
        volumeReelMl: 4800,
        crepesReelles: 61,
        consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: theorique + 10 }],
      });

      try {
        saisirRealise(base, resultat.productionId, {
          volumeReelMl: 4800,
          crepesReelles: 61,
          consommationsReelles: [{ ingredientId: idFarine, quantiteReelle: theorique + 20 }],
        });
        expect.unreachable('la seconde saisie aurait du etre refusee');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('consommation_reelle_deja_saisie');
      }
    });

    it('refuse une consommation reelle sur un ingredient que cette production n a pas consomme', () => {
      approvisionner();
      const resultat = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });

      expect(() =>
        saisirRealise(base, resultat.productionId, {
          volumeReelMl: 4800,
          crepesReelles: 61,
          consommationsReelles: [
            { ingredientId: 'ingredient-jamais-consomme', quantiteReelle: 10 },
          ],
        }),
      ).toThrow(ErreurMetier);
    });

    it('sans consommationsReelles (comportement inchange) : aucun mouvement supplementaire, quantite_reelle reste null', () => {
      approvisionner();
      const resultat = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });

      saisirRealise(base, resultat.productionId, { volumeReelMl: 4800, crepesReelles: 61 });

      expect(consommationFarine(resultat.productionId).quantiteReelle).toBeNull();
      const mouvements = base
        .select()
        .from(mouvementStock)
        .where(eq(mouvementStock.productionId, resultat.productionId))
        .all()
        .filter((m) => m.ingredientId === idFarine);
      expect(mouvements).toHaveLength(1);
    });
  });
});

/**
 * TROU 5 (audit du 30/07/2026) : sur la vraie base, `journal_audit` est à ZÉRO
 * ligne. Vérifié en lecture seule sur `donnees/batte.sqlite` : aucun lot n'a
 * jamais été mis en quarantaine, aucun mouvement contrepassé, aucune
 * production ni commande annulée — zéro ligne est donc le résultat ATTENDU
 * (rien de correctif ne s'est encore produit), pas un mécanisme cassé.
 *
 * Ce bloc écrit le test que le trou réclame : la preuve qu'une action
 * corrective écrit bien au journal, sur le chemin déjà câblé et déjà testé
 * plus haut (statut, stock, contrepassation) — jamais réouvert ici, seule la
 * trace d'audit est vérifiée, ce que ces tests ne couvraient pas encore.
 */
describe('Audit — annulerProduction écrit bien au journal (Trou 5)', () => {
  let base: BaseBatte;
  let idR1: string;
  let idFournisseur: string;

  function approvisionner() {
    const ingredients = base.select().from(ingredient).all();
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: ingredients.map((ing) => ({
        ingredientId: ing.id,
        quantite: 100_000,
        prixLigneCents: 1000,
        numeroLotFournisseur: 'LOT-TEST-APPRO',
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
  });

  it('journalise la DÉCISION d’annuler, avec le statut avant/après et le motif', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });
    expect(listerJournalAudit(base, { table: 'production' })).toHaveLength(0);

    annulerProduction(base, resultat.productionId, 'ERREUR_SAISIE', 'Porteur');

    const traces = listerJournalAudit(base, {
      table: 'production',
      enregistrementId: resultat.productionId,
    });
    expect(traces).toHaveLength(1);
    expect(traces[0]?.action).toBe('annulation');
    expect(traces[0]?.valeurAvant?.statut).toBe('lancee');
    expect(traces[0]?.valeurApres?.statut).toBe('annulee');
    expect(traces[0]?.parQui).toBe('Porteur');
  });

  it('n’écrit rien au journal quand l’annulation échoue (déjà annulée)', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });
    annulerProduction(base, resultat.productionId, 'ERREUR_SAISIE');

    expect(() => annulerProduction(base, resultat.productionId, 'ERREUR_SAISIE')).toThrow(
      ErreurMetier,
    );

    // Une seule entrée : celle de la PREMIÈRE annulation, la seconde tentative
    // refusée n'en ajoute pas une deuxième.
    expect(
      listerJournalAudit(base, { table: 'production', enregistrementId: resultat.productionId }),
    ).toHaveLength(1);
  });
});

/**
 * Rattachement production <-> session (docs/14-TEST-PARCOURS-UTILISATEUR.md
 * G1 et G4). `production.session_id` existait deja au schema et
 * `cloturerSession` le lisait deja correctement — le seul maillon manquant
 * etait la SAISIE : aucune route ni aucun ecran ne permettait de le remplir,
 * ni au lancement ni apres coup. Ces tests prouvent les deux gestes, avec des
 * montants entierement controles par le test (jamais une valeur que la graine
 * de demonstration pourrait deplacer).
 */
describe('Lot G1/G4 — rattachement d une production a une session', () => {
  let base: BaseBatte;
  let idR1: string;
  let idFournisseur: string;
  let idLieu: string;
  let idProduitCrepe: string;
  let idProduitSirop: string;
  let idIngredientSirop: string;

  /**
   * Approvisionne genereusement tous les ingredients de R1.
   *
   * `numeroLotFournisseur` fixe (docs/17 fiche 16) : un lot doit etre
   * identifiable par un numero OU par une DLC precise, jamais ni l'un ni
   * l'autre.
   */
  function approvisionner() {
    const ingredients = base.select().from(ingredient).all();
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: ingredients.map((ing) => ({
        ingredientId: ing.id,
        quantite: 100_000,
        prixLigneCents: 1000,
        numeroLotFournisseur: 'LOT-TEST-APPRO',
      })),
    });
  }

  /**
   * Approvisionne le sirop revendu a un prix d'achat CONNU du test : 10 pots
   * pour 4 800 c, soit 480 c (4,80 €) le pot — le montant meme que docs/14 G1
   * cite pour le meme article, sans dependre de la graine pour autant : c'est
   * CE test qui fixe le prix, via sa propre reception.
   */
  function approvisionnerSirop() {
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: [
        {
          ingredientId: idIngredientSirop,
          quantite: 10,
          prixLigneCents: 4800,
          numeroLotFournisseur: 'LOT-TEST-SIROP',
        },
      ],
    });
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!.id;
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;

    const produitCrepe = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get()!;
    idProduitCrepe = produitCrepe.id;

    const produitSirop = base
      .select({ id: produitVente.id, ingredientId: produitVente.ingredientId })
      .from(produitVente)
      .where(eq(produitVente.nature, 'revendu'))
      .get()!;
    idProduitSirop = produitSirop.id;
    idIngredientSirop = produitSirop.ingredientId!;

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte — test rattachement',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  });

  it("lance une production DEJA rattachee a une session, et l'ecrit sur le mouvement de stock", () => {
    approvisionner();
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
      sessionId: session.id,
    });

    const ligne = base
      .select()
      .from(production)
      .where(eq(production.id, resultat.productionId))
      .get()!;
    expect(ligne.sessionId).toBe(session.id);
  });

  it('refuse au LANCEMENT une session deja cloturee — meme regle qu un rattachement apres coup', () => {
    approvisionner();
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduitCrepe, quantite: 1, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 300,
      caCarteCents: 0,
      crepesProduites: 1,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    expect(() =>
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
        sessionId: session.id,
      }),
    ).toThrow(ErreurMetier);

    try {
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 1000 },
        dateProduction: JOUR,
        sessionId: session.id,
      });
    } catch (erreur) {
      expect((erreur as ErreurMetier).code).toBe('session_cloturee');
    }
    // Rien n'a ete ecrit : meme atomicite qu'une production infaisable.
    expect(base.select().from(production).all()).toHaveLength(0);
  });

  it('rattache APRES coup une production lancee sans session — le geste qui manquait', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });
    expect(
      base.select().from(production).where(eq(production.id, resultat.productionId)).get()!
        .sessionId,
    ).toBeNull();

    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    rattacherSession(base, resultat.productionId, session.id);

    expect(
      base.select().from(production).where(eq(production.id, resultat.productionId)).get()!
        .sessionId,
    ).toBe(session.id);
  });

  it('corrige un rattachement (une session vers une autre) et sait aussi detacher', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });
    const sessionA = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    const sessionB = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

    rattacherSession(base, resultat.productionId, sessionA.id);
    rattacherSession(base, resultat.productionId, sessionB.id); // correction
    expect(
      base.select().from(production).where(eq(production.id, resultat.productionId)).get()!
        .sessionId,
    ).toBe(sessionB.id);

    rattacherSession(base, resultat.productionId, null); // detachement
    expect(
      base.select().from(production).where(eq(production.id, resultat.productionId)).get()!
        .sessionId,
    ).toBeNull();
  });

  it('refuse de rattacher a une session deja cloturee (D-024, agregats figes)', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduitCrepe, quantite: 1, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 300,
      caCarteCents: 0,
      crepesProduites: 1,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    try {
      rattacherSession(base, resultat.productionId, session.id);
      expect.unreachable('le rattachement aurait du etre refuse');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('session_cloturee');
    }
  });

  it('verrouille un rattachement existant DES QUE la session source est cloturee — dans les deux sens', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
      sessionId: creerSession(base, { lieuId: idLieu, dateSession: JOUR }).id,
    });
    const sessionRattachee = base
      .select({ sessionId: production.sessionId })
      .from(production)
      .where(eq(production.id, resultat.productionId))
      .get()!.sessionId!;

    cloturerSession(base, sessionRattachee, {
      ventes: [{ produitVenteId: idProduitCrepe, quantite: 1, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 300,
      caCarteCents: 0,
      crepesInvendues: 0,
      crepesCassees: 0,
    });

    const autreSession = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    try {
      rattacherSession(base, resultat.productionId, autreSession.id);
      expect.unreachable('le changement aurait du etre refuse : la session source est cloturee');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('session_source_cloturee');
    }

    // Le detachement (vers `null`) est verrouille de la meme facon.
    expect(() => rattacherSession(base, resultat.productionId, null)).toThrow(ErreurMetier);
  });

  it('sessionsDesProductions rend une entree NULLE pour une production non rattachee, jamais une cle absente', () => {
    approvisionner();
    const sansSession = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 1000 },
      dateProduction: JOUR,
    });
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    const avecSession = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 1000 },
      dateProduction: JOUR,
      sessionId: session.id,
    });

    const carte = sessionsDesProductions(base, [
      sansSession.productionId,
      avecSession.productionId,
    ]);

    expect(carte.get(sansSession.productionId)).toBeNull();
    expect(carte.get(avecSession.productionId)).toEqual({
      id: session.id,
      numero: session.numero,
      statut: 'planifiee',
    });
    // Requete vide : aucune erreur, carte vide.
    expect(sessionsDesProductions(base, []).size).toBe(0);
  });

  /**
   * LE COEUR DE LA PREUVE (G1) : deux clotures dans LE MEME test, ventes
   * IDENTIQUES (memes produits, memes quantites, memes prix, puisees dans le
   * MEME pool de lots), seule la presence du rattachement differe.
   *
   * ATTENTION, verifie experimentalement : « Crêpe froment / cassonade »
   * porte une GARNITURE (D-053, `sortirLesGarnitures`), qui a elle seule un
   * cout non nul et INDEPENDANT du rattachement. `coutMatiereCents` d'une
   * session n'est donc PAS reductible a « prix du sirop x quantite » — d'ou
   * l'assertion par DIFFERENCE plutot que par valeur absolue : la part
   * garniture + revendu est identique des deux cotes (meme stock, memes
   * quantites vendues), donc elle s'annule dans la soustraction et ne laisse
   * que ce que le rattachement a change. C'est exactement la garde du
   * « piège de test » de ce projet : ne jamais asserter une valeur absolue
   * qu'un mecanisme tiers (ici les garnitures) peut deplacer.
   */
  it('le rattachement fait ENTRER, au centime pres, le cout de la pate dans la marge de session (G1)', () => {
    approvisionner();
    approvisionnerSirop();

    const ventes = [
      { produitVenteId: idProduitCrepe, quantite: 32, prixUnitaireCents: 300 },
      { produitVenteId: idProduitSirop, quantite: 4, prixUnitaireCents: 750 },
    ] as const;
    const especesCompteesCents = 32 * 300 + 4 * 750;

    // --- AVANT : production lancee, jamais rattachee (l'etat actuel de
    // l'application avant ce lot — reproduit G1). ---
    const prodAvant = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });
    expect(prodAvant.coutMatiereTheoriqueCents).toBeGreaterThan(0);

    const sessionAvant = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    cloturerSession(base, sessionAvant.id, {
      ventes: [...ventes],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents,
      caCarteCents: 0,
      crepesProduites: 32, // saisi a la main : rien n'est rattache pour le deriver.
      crepesInvendues: 0,
      crepesCassees: 0,
    });
    const clotureeAvant = base
      .select()
      .from(sessionMarche)
      .where(eq(sessionMarche.id, sessionAvant.id))
      .get()!;

    // --- APRES : NOUVELLE production, rattachee APRES son lancement — le
    // geste que docs/14 G1/G4 decrit comme manquant : « on lance souvent la
    // pate avant d'avoir cree la session ». ---
    const prodApres = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });
    const sessionApres = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    rattacherSession(base, prodApres.productionId, sessionApres.id);

    cloturerSession(base, sessionApres.id, {
      ventes: [...ventes],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents,
      caCarteCents: 0,
      // AUCUN `crepesProduites` : DERIVE de la production rattachee — preuve
      // que `resoudreCrepesProduites` n'est pas casse par ce rattachement.
      crepesInvendues: 0,
      crepesCassees: 0,
    });
    const clotureeApres = base
      .select()
      .from(sessionMarche)
      .where(eq(sessionMarche.id, sessionApres.id))
      .get()!;

    expect(clotureeApres.crepesProduites).toBe(prodApres.crepesTheoriques);

    // LA PREUVE : la seule chose qui distingue les deux clotures est le cout
    // de la production APRES — jamais une valeur fixe qui dependrait de la
    // graine ou du prix de la garniture.
    expect(clotureeApres.coutMatiereCents! - clotureeAvant.coutMatiereCents!).toBe(
      prodApres.coutMatiereTheoriqueCents,
    );
    expect(clotureeAvant.margeBruteCents! - clotureeApres.margeBruteCents!).toBe(
      prodApres.coutMatiereTheoriqueCents,
    );
    expect(clotureeAvant.margeBruteCents).toBe(
      clotureeAvant.caTotalCents! - clotureeAvant.coutMatiereCents!,
    );
    expect(clotureeApres.margeBruteCents).toBe(
      clotureeApres.caTotalCents! - clotureeApres.coutMatiereCents!,
    );
  });

  it('corrige G4 : la tracabilite aval nomme la session, avant "—", apres le numero', () => {
    approvisionner();
    const resultatProduction = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    const consommationFarine = base
      .select()
      .from(productionConsommation)
      .where(eq(productionConsommation.productionId, resultatProduction.productionId))
      .all()[0]!;

    // AVANT rattachement : la tracabilite aval sait que la production a
    // consomme ce lot, mais ne sait dire vers QUELLE session — `session` vaut
    // `null`, jamais un objet invente (docs/14 G4).
    const avalAvant = tracabiliteAvalLot(base, consommationFarine.lotId);
    const productionAval1 = avalAvant.productions.find(
      (p) => p.productionId === resultatProduction.productionId,
    )!;
    expect(productionAval1.session).toBeNull();

    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    rattacherSession(base, resultatProduction.productionId, session.id);

    // APRES rattachement : le meme lot, interroge de la meme facon, NOMME
    // desormais la session — « ce lot est entre dans la production
    // PR-2026-000x, qui a ete vendue au marche du … ».
    const avalApres = tracabiliteAvalLot(base, consommationFarine.lotId);
    const productionAval2 = avalApres.productions.find(
      (p) => p.productionId === resultatProduction.productionId,
    )!;
    expect(productionAval2.session).not.toBeNull();
    expect(productionAval2.session!.numero).toBe(session.numero);
    expect(productionAval2.session!.id).toBe(session.id);
  });
});

/**
 * Verrou de période (défaut d'intégrité comptable, audit documentaire) :
 * `periode.statut = 'verrouillee'` existait en base sans qu'aucun code ne
 * l'applique — une production pouvait se lancer, recevoir son réalisé, ou
 * s'annuler à une date tombant dans un exercice verrouillé exactement comme
 * si la période était ouverte. `verifierPeriodeNonVerrouillee`
 * (`../depots/comptabilite.ts`) corrige ce point pour les trois écritures
 * datées de ce fichier.
 */
describe('production — verrou de periode', () => {
  let base: BaseBatte;
  let idR1: string;
  let idFournisseur: string;

  /** Voir le même utilitaire dans `depots/comptabilite.test.ts`. */
  function verrouillerPeriode(annee: number, mois: number): void {
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

  function approvisionner(dateReception: string) {
    const ingredients = base.select().from(ingredient).all();
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception,
      lignes: ingredients.map((ing) => ({
        ingredientId: ing.id,
        quantite: 100_000,
        prixLigneCents: 1000,
        numeroLotFournisseur: 'LOT-TEST-APPRO-VERROU',
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
  });

  describe('lancerProduction', () => {
    it('refuse une production datee dans une periode verrouillee, sans rien ecrire', () => {
      approvisionner('2026-01-05');
      verrouillerPeriode(2026, 4);

      expect(() =>
        lancerProduction(base, {
          recetteId: idR1,
          cible: { type: 'volume', volumeMl: 1000 },
          dateProduction: '2026-04-10',
        }),
      ).toThrow(ErreurMetier);

      expect(base.select().from(production).all()).toHaveLength(0);
    });

    it('reste possible dans une periode ouverte, meme quand un AUTRE mois est verrouille — zero regression', () => {
      approvisionner('2026-01-05');
      verrouillerPeriode(2026, 4);

      const resultat = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 1000 },
        dateProduction: '2026-01-10',
      });

      expect(resultat.productionId).toBeTruthy();
    });
  });

  describe('saisirRealise', () => {
    it('refuse la saisie du realise quand la periode de la production est DEPUIS verrouillee', () => {
      approvisionner('2026-01-05');
      const resultat = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 1000 },
        dateProduction: '2026-01-10',
      });

      // Le mois de la production est verrouille APRES le lancement — le cas
      // reel : on oublie de saisir le realise avant de clore le mois.
      verrouillerPeriode(2026, 1);

      expect(() =>
        saisirRealise(base, resultat.productionId, { volumeReelMl: 900, crepesReelles: 12 }),
      ).toThrow(ErreurMetier);

      const apres = base
        .select({ statut: production.statut })
        .from(production)
        .where(eq(production.id, resultat.productionId))
        .get()!;
      expect(apres.statut).toBe('lancee');
    });

    it('reste possible quand la periode de la production est encore ouverte', () => {
      approvisionner('2026-01-05');
      const resultat = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 1000 },
        dateProduction: '2026-01-10',
      });

      saisirRealise(base, resultat.productionId, { volumeReelMl: 900, crepesReelles: 12 });

      const apres = base
        .select({ statut: production.statut })
        .from(production)
        .where(eq(production.id, resultat.productionId))
        .get()!;
      expect(apres.statut).toBe('terminee');
    });
  });

  describe('annulerProduction', () => {
    it("refuse d'annuler une production dont la periode est DEPUIS verrouillee", () => {
      approvisionner('2026-01-05');
      const resultat = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 1000 },
        dateProduction: '2026-01-10',
      });

      verrouillerPeriode(2026, 1);

      expect(() => annulerProduction(base, resultat.productionId, 'ERREUR_SAISIE')).toThrow(
        ErreurMetier,
      );

      const apres = base
        .select({ statut: production.statut })
        .from(production)
        .where(eq(production.id, resultat.productionId))
        .get()!;
      expect(apres.statut).toBe('lancee');
    });

    it('reste possible quand la periode de la production est encore ouverte', () => {
      approvisionner('2026-01-05');
      const resultat = lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 1000 },
        dateProduction: '2026-01-10',
      });

      const annulation = annulerProduction(base, resultat.productionId, 'ERREUR_SAISIE');

      expect(annulation.nbMouvementsContrepasses).toBeGreaterThan(0);
    });
  });
});

/**
 * Prévision rattachée au LANCEMENT (mission « relier une fournée à la
 * prévision qui l'a motivée », docs/03 §« Décision de production », D-058) :
 * `production.ordre_prevision_id` n'était jamais écrit qu'à `null` en dur
 * avant ce lot (`EntreeProduction` ne portait même pas le champ).
 *
 * Une session peut porter PLUSIEURS révisions de prévision archivées (J-7,
 * J-3, J-1, le matin même) — c'est pourquoi `previsionId` est un champ
 * DISTINCT de `sessionId` : il dit LAQUELLE a motivé CE lancement précis,
 * jamais devinée après coup par le service (c'est l'écran, `Production.tsx`,
 * qui choisit la révision affichée — voir son commentaire `previsionRetenue`).
 */
describe('prevision rattachee au lancement d une production', () => {
  let base: BaseBatte;
  let idR1: string;
  let idFournisseur: string;
  let idLieu: string;

  function approvisionner() {
    const ingredients = base.select().from(ingredient).all();
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: ingredients.map((ing) => ({
        ingredientId: ing.id,
        quantite: 100_000,
        prixLigneCents: 1000,
        numeroLotFournisseur: 'LOT-TEST-APPRO',
      })),
    });
  }

  /**
   * Insère directement une ligne `prevision` minimale, sans passer par
   * `archiverPrevision` (`depots/previsions.ts`, hors zone d'écriture de
   * cette mission) : seuls `sessionId`/`p50Crepes`/`crepesRetenues`/
   * `dateCalcul` importent aux tests ci-dessous, les autres colonnes NOT NULL
   * reçoivent une valeur neutre sans signification pour ces tests.
   */
  function creerPrevisionTest(
    overrides: {
      sessionId?: string | null;
      crepesRetenues?: number;
      p50Crepes?: number;
      dateCalcul?: string;
    } = {},
  ): string {
    const id = nouvelIdentifiant();
    base
      .insert(prevision)
      .values({
        id,
        sessionId: overrides.sessionId ?? null,
        dateCalcul: overrides.dateCalcul ?? maintenantUtc(),
        versionModele: 'test',
        baselineCrepes: 100,
        facteurMeteoBp: 10_000,
        facteurEvenementBp: 10_000,
        facteurSaisonBp: 10_000,
        facteurTendanceBp: 10_000,
        p10Crepes: 80,
        p50Crepes: overrides.p50Crepes ?? 100,
        p90Crepes: 120,
        quantileCibleBp: 7_000,
        crepesRecommandees: overrides.crepesRetenues ?? 100,
        crepesRetenues: overrides.crepesRetenues ?? 100,
        confianceBp: 5_000,
        nbSessionsComparables: 0,
      })
      .run();
    return id;
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!.id;
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte — test prevision',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  });

  it('ecrit la prevision fournie sur ordrePrevisionId, jamais null en dur', () => {
    approvisionner();
    const previsionId = creerPrevisionTest();

    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
      previsionId,
    });

    const ligne = base
      .select()
      .from(production)
      .where(eq(production.id, resultat.productionId))
      .get()!;
    expect(ligne.ordrePrevisionId).toBe(previsionId);
  });

  it('reste null quand aucune prevision n est fournie — decidee sans prevision, un cas normal', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    const ligne = base
      .select()
      .from(production)
      .where(eq(production.id, resultat.productionId))
      .get()!;
    expect(ligne.ordrePrevisionId).toBeNull();
  });

  it('refuse une prevision introuvable, sans rien ecrire', () => {
    approvisionner();

    try {
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
        previsionId: 'id-inexistant',
      });
      expect.unreachable('le lancement aurait du etre refuse');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('introuvable');
    }
    expect(base.select().from(production).all()).toHaveLength(0);
  });

  it('refuse une prevision d une AUTRE session que celle choisie pour cette production', () => {
    approvisionner();
    const sessionA = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    const sessionB = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    const previsionDeA = creerPrevisionTest({ sessionId: sessionA.id });

    try {
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
        sessionId: sessionB.id,
        previsionId: previsionDeA,
      });
      expect.unreachable('le lancement aurait du etre refuse');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('prevision_session_incoherente');
    }
    // Atomicite : rien n'a ete ecrit, meme regle qu'une session cloturee.
    expect(base.select().from(production).all()).toHaveLength(0);
  });

  it('accepte une prevision SANS session (sessionId null) meme quand la production en choisit une', () => {
    approvisionner();
    const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });
    const previsionSansSession = creerPrevisionTest({ sessionId: null });

    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
      sessionId: session.id,
      previsionId: previsionSansSession,
    });

    const ligne = base
      .select()
      .from(production)
      .where(eq(production.id, resultat.productionId))
      .get()!;
    expect(ligne.ordrePrevisionId).toBe(previsionSansSession);
    expect(ligne.sessionId).toBe(session.id);
  });

  it('lireProductionDetail relit la prevision rattachee et calcule un ecart SIGNE', () => {
    approvisionner();
    const previsionId = creerPrevisionTest({
      crepesRetenues: 60,
      p50Crepes: 55,
      dateCalcul: '2026-07-26T18:00:00.000Z',
    });

    // 5 L de R1 -> exactement 66 crepes theoriques (meme volume que le
    // critere de fin du Lot 3, voir plus haut dans ce fichier).
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
      previsionId,
    });
    expect(resultat.crepesTheoriques).toBe(66);

    const detail = lireProductionDetail(base, resultat.productionId);
    expect(detail).not.toBeNull();
    expect(detail!.previsionId).toBe(previsionId);
    expect(detail!.previsionDateCalcul).toBe('2026-07-26T18:00:00.000Z');
    expect(detail!.previsionP50Crepes).toBe(55);
    expect(detail!.previsionCrepesRetenues).toBe(60);
    // (66 - 60) / 60 = 10,00 % -> +1000 points de base, produit AU-DESSUS de
    // ce que le modele retenait ce soir-la.
    expect(detail!.ecartVsPrevisionBp).toBe(1000);
  });

  it('lireProductionDetail rend previsionId et ecart a null quand aucune prevision n est rattachee', () => {
    approvisionner();
    const resultat = lancerProduction(base, {
      recetteId: idR1,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    const detail = lireProductionDetail(base, resultat.productionId);
    expect(detail).not.toBeNull();
    expect(detail!.previsionId).toBeNull();
    expect(detail!.previsionDateCalcul).toBeNull();
    expect(detail!.previsionP50Crepes).toBeNull();
    expect(detail!.previsionCrepesRetenues).toBeNull();
    expect(detail!.ecartVsPrevisionBp).toBeNull();
  });
});
