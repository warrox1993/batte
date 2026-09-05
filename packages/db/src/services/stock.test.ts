/**
 * Tests d'integration du Lot 2 : reception -> lots -> mouvements -> etat de stock.
 *
 * Le critere de fin de docs/04-ROADMAP-LOTS.md est verifie ici mot pour mot :
 * « Je saisis une reception de 25 kg de farine, je fais une sortie de 4 kg, le
 * stock affiche 21 kg avec la bonne valorisation, et l'historique est complet. »
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurMetier } from '@batte/core';
import { eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { fournisseur, ingredient, mouvementStock } from '../schema.js';
import {
  etatDuStock,
  lotsAlerteDlc,
  lotsDeLIngredient,
  mouvementsDuLot,
  verifierInvariantLots,
} from '../depots/stock.js';
import { enregistrerReception } from './reception.js';
import { annulerMouvement, changerStatutLot, enregistrerSortie } from './mouvements.js';

const JOUR = '2026-07-27';

describe('Lot 2 — stock, lots et tracabilite', () => {
  let base: BaseBatte;
  let idFarine: string;
  let idFournisseur: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    idFarine = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!.id;
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
  });

  /**
   * Reception d'une seule ligne de farine, cas courant de ces tests.
   *
   * `numeroLotFournisseur` par defaut a `'LOT-TEST'` (docs/17 fiche 16) : un
   * lot doit etre identifiable par un numero OU par une DLC, jamais ni l'un ni
   * l'autre — la farine de demonstration n'a pas de duree de conservation
   * declaree, donc pas de DLC deduite. Passer `null` explicitement desactive
   * ce defaut, pour les tests qui verifient precisement ce refus.
   */
  function receptionner(
    quantite: number,
    prixCents: number,
    dlc: string | null = null,
    numeroLotFournisseur: string | null = 'LOT-TEST',
  ) {
    return enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: [
        {
          ingredientId: idFarine,
          quantite,
          prixLigneCents: prixCents,
          dateDlc: dlc,
          numeroLotFournisseur,
        },
      ],
    });
  }

  it('critere de fin : 25 kg recus, 4 kg sortis, 21 kg restants correctement valorises', () => {
    // 25 kg a 18,75 € -> 0,075 c/g
    receptionner(25_000, 1875);

    enregistrerSortie(base, {
      ingredientId: idFarine,
      quantite: 4000,
      type: 'perte',
      motifCode: 'CASSE_TRANSPORT',
      dateMouvement: JOUR,
    });

    const ligne = etatDuStock(base, JOUR).find((l) => l.ingredientId === idFarine)!;

    expect(ligne.quantiteDisponible).toBe(21_000);
    // 21 000 g x 0,075 c/g = 1 575 c = 15,75 €
    expect(ligne.valeurCents).toBe(1575);
    expect(ligne.cumpCentsParUnite).toBeCloseTo(0.075, 6);
  });

  it("l'historique du lot est complet apres la sortie", () => {
    const resultat = receptionner(25_000, 1875);
    enregistrerSortie(base, {
      ingredientId: idFarine,
      quantite: 4000,
      type: 'perte',
      motifCode: 'CASSE_TRANSPORT',
      dateMouvement: JOUR,
    });

    const lotId = resultat.lotsCrees[0]!.lotId;
    const historique = mouvementsDuLot(base, lotId);

    expect(historique).toHaveLength(2);
    expect(historique.map((m) => m.type).sort()).toEqual(['entree', 'perte']);
    // Chaque sortie porte un motif code : c'est ce qui rend l'ecart analysable.
    const sortie = historique.find((m) => m.type === 'perte')!;
    expect(sortie.motifId).not.toBeNull();
  });

  it('numerote les receptions sans trou, par annee', () => {
    const a = receptionner(1000, 100);
    const b = receptionner(1000, 100);

    expect(a.numero).toBe('RC-2026-0001');
    expect(b.numero).toBe('RC-2026-0002');
  });

  it('consomme en FEFO : le lot qui perime le plus tot part en premier', () => {
    const tard = receptionner(1000, 100, '2026-12-31');
    const tot = receptionner(1000, 100, '2026-08-05');

    enregistrerSortie(base, {
      ingredientId: idFarine,
      quantite: 600,
      type: 'sortie_production',
      motifCode: 'SURDOSAGE',
      dateMouvement: JOUR,
    });

    const lots = lotsDeLIngredient(base, idFarine);
    const lotTot = lots.find((l) => l.id === tot.lotsCrees[0]!.lotId)!;
    const lotTard = lots.find((l) => l.id === tard.lotsCrees[0]!.lotId)!;

    expect(lotTot.quantiteRestante).toBe(400);
    expect(lotTard.quantiteRestante).toBe(1000);
  });

  it('refuse une sortie superieure au stock, en donnant le chiffre manquant', () => {
    receptionner(1000, 100);

    try {
      enregistrerSortie(base, {
        ingredientId: idFarine,
        quantite: 3000,
        type: 'perte',
        motifCode: 'CASSE_TRANSPORT',
        dateMouvement: JOUR,
      });
      expect.unreachable('la sortie aurait du echouer');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      const metier = erreur as ErreurMetier;
      expect(metier.code).toBe('stock_insuffisant');
      // Le message porte le chiffre manquant, pas un « stock insuffisant » sec.
      expect(metier.message).toContain('2,0 kg');
    }
  });

  it('ne consomme pas un lot en quarantaine', () => {
    const recu = receptionner(1000, 100);
    changerStatutLot(base, recu.lotsCrees[0]!.lotId, 'quarantaine', 'QUARANTAINE_DOUTE', JOUR);

    expect(() =>
      enregistrerSortie(base, {
        ingredientId: idFarine,
        quantite: 100,
        type: 'perte',
        motifCode: 'CASSE_TRANSPORT',
        dateMouvement: JOUR,
      }),
    ).toThrow(ErreurMetier);
  });

  /**
   * Fiche 18 (docs/17) : détruire un lot ne peut PLUS se contenter de changer
   * son statut — la matière doit sortir du stock par un MOUVEMENT, comme toute
   * autre sortie (règle n°5). La preuve porte sur l'arithmétique des
   * mouvements SEULE, sans s'appuyer sur le filtre `statut !== 'detruit'` que
   * `depots/stock.ts` applique déjà par ailleurs.
   */
  it('detruit un lot : le restant devient un mouvement de perte, et le stock retombe a zero PAR LA SOMME DES MOUVEMENTS', () => {
    const recu = receptionner(1000, 100);
    const lotId = recu.lotsCrees[0]!.lotId;

    const resultat = changerStatutLot(base, lotId, 'detruit', 'RAPPEL_FOURNISSEUR', JOUR);

    expect(resultat.mouvementDestructionId).not.toBeNull();
    expect(resultat.quantiteDetruite).toBe(1000);
    expect(resultat.coutDetruitCents).toBe(100);

    // La somme signee des mouvements (entree +, tout le reste -) retombe a
    // zero : aucun recours au filtre `statut !== 'detruit'` pour l'obtenir.
    const mouvements = mouvementsDuLot(base, lotId);
    const restantParMouvements = mouvements.reduce(
      (somme, m) => somme + (m.type === 'entree' ? m.quantite : -m.quantite),
      0,
    );
    expect(restantParMouvements).toBe(0);

    // La ligne reste au journal : ni supprimee, ni masquee.
    expect(mouvements).toHaveLength(2);
    const perte = mouvements.find((m) => m.type === 'perte')!;
    expect(perte).toBeDefined();
    expect(perte.quantite).toBe(1000);
    expect(perte.isAnnule).toBe(false);
    expect(perte.motifId).not.toBeNull();

    expect(verifierInvariantLots(base)).toEqual([]);
  });

  it('detruit un lot partiellement consomme : seul le restant part en mouvement de perte, pas la quantite initiale', () => {
    const recu = receptionner(1000, 100);
    const lotId = recu.lotsCrees[0]!.lotId;

    enregistrerSortie(base, {
      ingredientId: idFarine,
      quantite: 400,
      type: 'sortie_production',
      motifCode: 'SURDOSAGE',
      dateMouvement: JOUR,
    });

    const resultat = changerStatutLot(base, lotId, 'detruit', 'RAPPEL_FOURNISSEUR', JOUR);

    expect(resultat.quantiteDetruite).toBe(600);

    const restant = lotsDeLIngredient(base, idFarine).find((l) => l.id === lotId)!.quantiteRestante;
    expect(restant).toBe(0);
    expect(verifierInvariantLots(base)).toEqual([]);
  });

  it('detruit un lot deja vide : aucun mouvement de perte, rien a sortir', () => {
    const recu = receptionner(1000, 100);
    const lotId = recu.lotsCrees[0]!.lotId;

    enregistrerSortie(base, {
      ingredientId: idFarine,
      quantite: 1000,
      type: 'sortie_production',
      motifCode: 'SURDOSAGE',
      dateMouvement: JOUR,
    });

    const resultat = changerStatutLot(base, lotId, 'detruit', 'RAPPEL_FOURNISSEUR', JOUR);

    expect(resultat.mouvementDestructionId).toBeNull();
    expect(resultat.quantiteDetruite).toBeNull();
    // L'entree ET la sortie_production qui a vide le lot — la destruction,
    // elle, n'ajoute rien : il n'y avait plus rien a sortir.
    expect(mouvementsDuLot(base, lotId)).toHaveLength(2);
  });

  it('ne consomme pas un lot perime sans autorisation explicite', () => {
    receptionner(1000, 100, '2026-07-20');

    expect(() =>
      enregistrerSortie(base, {
        ingredientId: idFarine,
        quantite: 100,
        type: 'perte',
        motifCode: 'DLC_DEPASSEE',
        dateMouvement: JOUR,
      }),
    ).toThrow(ErreurMetier);
  });

  it('trace explicitement la consommation d un lot perime autorisee', () => {
    receptionner(1000, 100, '2026-07-20');

    enregistrerSortie(base, {
      ingredientId: idFarine,
      quantite: 100,
      type: 'perte',
      motifCode: 'DLC_DEPASSEE',
      dateMouvement: JOUR,
      autoriserDlcDepassee: true,
    });

    const sortie = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.type, 'perte'))
      .get()!;
    expect(sortie.motifTexte).toContain('DLC dépassée');
  });

  it('annule un mouvement par contrepassation, jamais par suppression', () => {
    receptionner(25_000, 1875);
    const sortie = enregistrerSortie(base, {
      ingredientId: idFarine,
      quantite: 4000,
      type: 'perte',
      motifCode: 'CASSE_TRANSPORT',
      dateMouvement: JOUR,
    });

    annulerMouvement(base, sortie.mouvements[0]!.id, 'ERREUR_SAISIE');

    // La matiere est revenue…
    const ligne = etatDuStock(base, JOUR).find((l) => l.ingredientId === idFarine)!;
    expect(ligne.quantiteDisponible).toBe(25_000);

    // …et l'ecriture d'origine reste LISIBLE, marquee annulee.
    const origine = base
      .select()
      .from(mouvementStock)
      .where(eq(mouvementStock.id, sortie.mouvements[0]!.id))
      .get()!;
    expect(origine.isAnnule).toBe(true);
    expect(origine.annuleParId).not.toBeNull();
  });

  it('refuse une seconde contrepassation du meme mouvement', () => {
    receptionner(25_000, 1875);
    const sortie = enregistrerSortie(base, {
      ingredientId: idFarine,
      quantite: 1000,
      type: 'perte',
      motifCode: 'CASSE_TRANSPORT',
      dateMouvement: JOUR,
    });

    annulerMouvement(base, sortie.mouvements[0]!.id, 'ERREUR_SAISIE');
    // Sans cette regle, deux annulations successives creeraient de la matiere.
    expect(() => annulerMouvement(base, sortie.mouvements[0]!.id, 'ERREUR_SAISIE')).toThrow(
      ErreurMetier,
    );
  });

  it('respecte l invariant n°1 sur toute la base apres une serie d operations', () => {
    receptionner(25_000, 1875);
    receptionner(10_000, 800);
    enregistrerSortie(base, {
      ingredientId: idFarine,
      quantite: 30_000,
      type: 'sortie_production',
      motifCode: 'SURDOSAGE',
      dateMouvement: JOUR,
    });

    expect(verifierInvariantLots(base)).toEqual([]);
  });

  it('remonte les lots dont la DLC approche, du plus urgent au moins urgent', () => {
    receptionner(1000, 100, '2026-08-20');
    receptionner(1000, 100, '2026-07-30');

    const alertes = lotsAlerteDlc(base, JOUR, 14);

    expect(alertes).toHaveLength(1);
    expect(alertes[0]?.dateDlc).toBe('2026-07-30');
  });

  it('refuse une reception sans ligne', () => {
    expect(() =>
      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [],
      }),
    ).toThrow(ErreurMetier);
  });

  /**
   * Fiche 16 (docs/17), regle CORRIGEE : un lot doit etre IDENTIFIABLE, par
   * son numero fournisseur OU par une DLC precise au jour pres — jamais les
   * deux exiges ensemble (directive europeenne 2011/91/UE : la DLC en clair
   * fait deja office d'identifiant de lot). Le refus ne porte QUE sur le cas
   * ou ni l'un ni l'autre n'existe.
   */
  describe('fiche 16 — un lot doit etre identifiable, par numero OU par DLC', () => {
    it('refuse un lot sans numero ET sans DLC (ni saisie ni deductible)', () => {
      // La farine de demonstration n'a pas de duree de conservation declaree :
      // aucune DLC ne sera deduite. Sans numero non plus (les deux forces a
      // `null` : le defaut de `receptionner` pose un numero), ce lot ne
      // serait pas rappelable.
      try {
        receptionner(1000, 100, null, null);
        expect.unreachable('la reception aurait du etre refusee');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('lot_non_identifiable');
      }
    });

    it('accepte une DLC saisie SANS numero de lot — avec un avertissement, pas un refus', () => {
      // Le cas du samedi matin : un achat de lait ou d'oeufs porte une DLC
      // lisible et aucun numero de lot exploitable. La DLC identifie deja le
      // lot (directive 2011/91/UE) : la reception doit passer.
      const resultat = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          { ingredientId: idFarine, quantite: 1000, prixLigneCents: 100, dateDlc: '2026-12-31' },
        ],
      });
      expect(resultat.lotsCrees).toHaveLength(1);
      expect(resultat.avertissements).toHaveLength(1);
      expect(resultat.avertissements[0]).toContain('DLC');
    });

    it('accepte aussi une DLC DEDUITE de la duree de conservation, sans numero de lot, avec avertissement', () => {
      // Le sirop de Liege declare 365 jours de conservation : sa DLC est
      // deduite si elle n'est pas saisie — le controle doit porter sur cette
      // DLC DEDUITE, pas seulement sur la saisie explicite (le contrat HTTP,
      // lui, ne voit que la saisie explicite).
      const idSirop = base
        .select({ id: ingredient.id })
        .from(ingredient)
        .where(eq(ingredient.nom, 'Sirop de Liège (pot 450 g)'))
        .get()!.id;

      const resultat = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [{ ingredientId: idSirop, quantite: 10, prixLigneCents: 4800 }],
      });
      expect(resultat.lotsCrees).toHaveLength(1);
      expect(resultat.avertissements).toHaveLength(1);
    });

    it('accepte un numero de lot SANS aucune DLC (denree non perissable), sans avertissement', () => {
      const resultat = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 100,
            numeroLotFournisseur: 'LOT-TEST-02',
          },
        ],
      });
      expect(resultat.lotsCrees).toHaveLength(1);
      expect(resultat.avertissements).toHaveLength(0);
    });

    it('accepte une DLC saisie avec son numero de lot, sans aucun avertissement', () => {
      const resultat = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 100,
            numeroLotFournisseur: 'LOT-TEST-01',
            dateDlc: '2026-12-31',
          },
        ],
      });
      expect(resultat.lotsCrees).toHaveLength(1);
      expect(resultat.avertissements).toHaveLength(0);
    });
  });
});
