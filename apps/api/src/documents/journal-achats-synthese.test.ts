/**
 * Réconciliation G2 (docs/14-TEST-PARCOURS-UTILISATEUR.md) : le « Journal des
 * achats » (Excel) et la synthèse d'exercice de l'écran Comptabilité DOIVENT
 * tomber d'accord sur le total des achats de marchandises d'une année civile.
 *
 * Le défaut mesuré : l'écran affichait « BÉNÉFICE BRUT 973,00 € » — un
 * bénéfice égal aux seules recettes — pendant que le bouton « Journal des
 * achats (Excel) » DU MÊME ÉCRAN listait 447,61 € d'achats sur l'exercice.
 * Deux exports du même module qui se contredisaient parce qu'un seul des deux
 * lisait la table `reception`.
 *
 * Ce test vaut plus que la correction elle-même (il empêche la classe entière
 * de revenir) : il appelle les DEUX FONCTIONS RÉELLES — `donneesJournalAchats`
 * (ce module) et `syntheseExercice` (`@batte/db`) — sur un exercice ISOLÉ où
 * les réceptions sont la SEULE charge présente, si bien que la moindre
 * divergence future entre leurs deux requêtes (fenêtre de dates, colonne lue,
 * gestion du `null`) le fait échouer immédiatement.
 */

import { describe, expect, it } from 'vitest';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import {
  creerBase,
  enregistrerReception,
  migrer,
  schema,
  seed,
  syntheseExercice,
  type BaseBatte,
} from '@batte/db';
import { donneesJournalAchats } from './donnees.js';

/** Exercice volontairement lointain : aucune donnée de graine ne s'y trouve. */
const EXERCICE = 2032;

function creerFournisseurTest(base: BaseBatte): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.fournisseur)
    .values({
      id,
      nom: 'Grossiste de test (G2)',
      type: 'grossiste',
      delaiLivraisonJours: 2,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function creerIngredientTest(base: BaseBatte): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.ingredient)
    .values({
      id,
      nom: 'Farine de test (G2)',
      categorie: 'farine',
      uniteReference: 'g',
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

describe('G2 — le journal des achats et la synthèse d’exercice lisent la même source', () => {
  it(
    'le total du journal des achats égale exactement les dépenses déductibles ' +
      'de la synthèse, sur un exercice sans autre charge',
    () => {
      const base = creerBase(':memory:');
      migrer(base);
      seed(base);

      const idFournisseur = creerFournisseurTest(base);
      const idIngredient = creerIngredientTest(base);

      // Trois réceptions étalées sur l'année, dont une au tout dernier jour :
      // exactement le cas qui ferait échouer une borne haute en jour civil nu
      // au lieu d'un ISO complet (`T23:59:59.999Z`) — voir `finDeJournee` et
      // le commentaire de `totalAchatsMarchandisesCents`.
      for (const jour of [`${EXERCICE}-01-15`, `${EXERCICE}-06-30`, `${EXERCICE}-12-31`]) {
        enregistrerReception(base, {
          fournisseurId: idFournisseur,
          dateReception: jour,
          lignes: [
            {
              ingredientId: idIngredient,
              quantite: 1000,
              prixLigneCents: 4761,
              numeroLotFournisseur: 'LOT-TEST',
            },
          ],
        });
      }
      // Une réception HORS exercice : ignorée par les DEUX côtés, sinon une
      // divergence par excès resterait invisible à ce test.
      enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: `${EXERCICE + 1}-01-02`,
        lignes: [
          {
            ingredientId: idIngredient,
            quantite: 1000,
            prixLigneCents: 999_999,
            numeroLotFournisseur: 'LOT-TEST',
          },
        ],
      });

      const journal = donneesJournalAchats(base, EXERCICE);
      const totalJournalCents = journal.lignes.reduce(
        (somme, l) => somme + (l.montantTotalCents ?? 0),
        0,
      );
      expect(journal.lignes).toHaveLength(3);
      expect(totalJournalCents).toBe(4761 * 3);

      const synthese = syntheseExercice(base, EXERCICE);
      // Sur cet exercice : aucune dépense manuelle, aucun frais de session,
      // aucun amortissement — les réceptions sont la SEULE charge possible.
      // Les dépenses déductibles de la synthèse doivent donc égaler
      // EXACTEMENT le total du journal des achats.
      expect(synthese.amortissementsCents).toBe(0);
      expect(synthese.depensesDeductiblesCents).toBe(totalJournalCents);
    },
  );
});
