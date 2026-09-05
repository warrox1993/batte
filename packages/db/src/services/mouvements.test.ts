/**
 * Tests du verrou de période appliqué aux mouvements de stock
 * (`enregistrerSortie`, `annulerMouvement`/`contrepasserMouvement`,
 * `changerStatutLot`).
 *
 * Défaut d'intégrité comptable (audit documentaire) : `periode.statut =
 * 'verrouillee'` existait en base sans qu'aucun code ne l'applique — on
 * pouvait sortir du stock, contrepasser un mouvement ou changer le statut
 * d'un lot à une date tombant dans un exercice verrouillé, exactement comme
 * si la période était ouverte. `verifierPeriodeNonVerrouillee`
 * (`../depots/comptabilite.ts`) corrige ce point ; ce fichier le prouve pour
 * chacun des trois points d'écriture datés de ce fichier.
 *
 * Arbitrage documenté sur `contrepasserMouvement` (voir le commentaire de
 * `verifierPeriodeNonVerrouillee`) : la contrepassation porte la MÊME date
 * que l'original (déjà le cas avant ce lot, pour que les cumuls d'une
 * période close ne bougent pas), donc si cette date tombe DEPUIS dans une
 * période verrouillée, la contrepassation est refusée elle aussi — un
 * mouvement de stock verrouillé ne se corrige plus DU TOUT dans
 * l'application, ce qui est exactement le sens de « irréversible même pour
 * un administrateur » (docs/07 §1.6). C'est l'inverse du choix retenu pour
 * `annulerDepense` (contre-écriture datée du jour, restant corrigible) : les
 * deux mécanismes préexistaient à ce lot, chacun garde sa propre convention
 * de date.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { fournisseur, ingredient, lot, mouvementStock, periode } from '../schema.js';
import { enregistrerReception } from './reception.js';
import { annulerMouvement, changerStatutLot, enregistrerSortie } from './mouvements.js';

/** Voir le même utilitaire dans `depots/comptabilite.test.ts`. */
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

describe('mouvements de stock — verrou de periode', () => {
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

    // Stock disponible, receptionne dans un mois qui restera OUVERT (janvier).
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-01-05',
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 10_000,
          prixLigneCents: 1000,
          numeroLotFournisseur: 'LOT-MVT-VERROU',
        },
      ],
    });
  });

  describe('enregistrerSortie', () => {
    it('refuse une sortie datee dans une periode verrouillee, sans rien ecrire', () => {
      verrouillerPeriode(base, 2026, 4);
      const avant = base.select().from(mouvementStock).all().length;

      expect(() =>
        enregistrerSortie(base, {
          ingredientId: idFarine,
          quantite: 100,
          type: 'perte',
          motifCode: 'CASSE_TRANSPORT',
          dateMouvement: '2026-04-10',
        }),
      ).toThrow(ErreurMetier);

      expect(base.select().from(mouvementStock).all()).toHaveLength(avant);
    });

    it('reste possible dans une periode ouverte, meme quand un AUTRE mois est verrouille — zero regression', () => {
      verrouillerPeriode(base, 2026, 4);

      const resultat = enregistrerSortie(base, {
        ingredientId: idFarine,
        quantite: 100,
        type: 'perte',
        motifCode: 'CASSE_TRANSPORT',
        dateMouvement: '2026-01-10',
      });

      expect(resultat.mouvements.length).toBeGreaterThan(0);
    });
  });

  describe('annulerMouvement (contrepassation)', () => {
    it("refuse de contrepasser un mouvement dont la date d'origine est DEPUIS tombee dans une periode verrouillee", () => {
      const mouvement = base
        .select({ id: mouvementStock.id })
        .from(mouvementStock)
        .where(eq(mouvementStock.ingredientId, idFarine))
        .get()!;

      // La reception d'origine est datee du 05/01/2026 : ce mois est
      // verrouille APRES coup.
      verrouillerPeriode(base, 2026, 1);

      expect(() => annulerMouvement(base, mouvement.id, 'ERREUR_SAISIE')).toThrow(ErreurMetier);

      const apres = base
        .select({ isAnnule: mouvementStock.isAnnule })
        .from(mouvementStock)
        .where(eq(mouvementStock.id, mouvement.id))
        .get()!;
      expect(apres.isAnnule).toBe(false);
    });

    it('reste possible quand la periode d origine du mouvement est encore ouverte', () => {
      const mouvement = base
        .select({ id: mouvementStock.id })
        .from(mouvementStock)
        .where(eq(mouvementStock.ingredientId, idFarine))
        .get()!;

      annulerMouvement(base, mouvement.id, 'ERREUR_SAISIE');

      const apres = base
        .select({ isAnnule: mouvementStock.isAnnule })
        .from(mouvementStock)
        .where(eq(mouvementStock.id, mouvement.id))
        .get()!;
      expect(apres.isAnnule).toBe(true);
    });
  });

  describe('changerStatutLot', () => {
    it('refuse un changement de statut date dans une periode verrouillee', () => {
      const unLot = base
        .select({ id: lot.id })
        .from(lot)
        .where(eq(lot.ingredientId, idFarine))
        .get()!;
      verrouillerPeriode(base, 2026, 4);

      expect(() =>
        changerStatutLot(base, unLot.id, 'quarantaine', 'QUARANTAINE_DOUTE', '2026-04-15'),
      ).toThrow(ErreurMetier);

      const apres = base
        .select({ statut: lot.statut })
        .from(lot)
        .where(eq(lot.id, unLot.id))
        .get()!;
      expect(apres.statut).toBe('disponible');
    });

    it('reste possible dans une periode ouverte — zero regression', () => {
      const unLot = base
        .select({ id: lot.id })
        .from(lot)
        .where(eq(lot.ingredientId, idFarine))
        .get()!;

      changerStatutLot(base, unLot.id, 'quarantaine', 'QUARANTAINE_DOUTE', '2026-01-15');

      const apres = base
        .select({ statut: lot.statut })
        .from(lot)
        .where(eq(lot.id, unLot.id))
        .get()!;
      expect(apres.statut).toBe('quarantaine');
    });
  });
});
