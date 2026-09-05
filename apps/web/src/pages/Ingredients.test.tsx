import { describe, expect, it } from 'vitest';
import { schemaSaisieIngredient } from '@batte/core';
import {
  BROUILLON_INGREDIENT_VIDE,
  corpsSaisieIngredient,
  type BrouillonIngredient,
} from './Ingredients';

/**
 * Câblage « Allergènes vérifiés » (mission du 30/07/2026) : le back-end
 * distingue déjà « vérifié, aucun allergène » de « jamais évalué »
 * (`ingredient.allergenes_verifies`), mais rien dans `enregistrer()` ne
 * portait ce booléen jusqu'au corps envoyé au serveur — la case pouvait être
 * cochée à l'écran sans que le `PATCH` ne le dise jamais.
 *
 * `corpsSaisieIngredient` est la fonction PURE extraite du corps de
 * `enregistrer()` : elle prouve, sans monter tout l'écran (le montage vit
 * dans `Ingredients.montage.test.tsx`), que `allergenesVerifies` fait bien
 * partie du corps —
 * c'est le point exact où le fil se coupait.
 */

const BROUILLON_BASE: BrouillonIngredient = {
  nom: 'Farine de froment T55',
  categorie: 'farine',
  uniteReference: 'g',
  densite: '',
  allergenes: ['gluten'],
  allergenesVerifies: true,
  stockSecurite: '0',
  delaiLivraisonJours: '',
  dureeConservationJours: '',
  notes: '',
};

describe('corpsSaisieIngredient — le fil vers le PATCH/POST', () => {
  it('inclut allergenesVerifies quand la case est cochée', () => {
    const corps = corpsSaisieIngredient(BROUILLON_BASE);
    expect(corps).toHaveProperty('allergenesVerifies', true);
  });

  it('inclut allergenesVerifies à false quand la case est décochée — un « false » explicite, pas une absence', () => {
    const corps = corpsSaisieIngredient({ ...BROUILLON_BASE, allergenesVerifies: false });
    expect(corps).toHaveProperty('allergenesVerifies', false);
  });

  it('conserve les autres champs déjà câblés (non-régression)', () => {
    const corps = corpsSaisieIngredient(BROUILLON_BASE);
    expect(corps).toMatchObject({
      nom: 'Farine de froment T55',
      categorie: 'farine',
      uniteReference: 'g',
      densiteGParMl: null,
      allergenes: ['gluten'],
      stockSecurite: 0,
      delaiLivraisonJours: null,
      dureeConservationJours: null,
      notes: '',
    });
  });
});

/**
 * « Stock de sécurité » démarre VIDE, pas pré-rempli à 0 (mission du
 * 30/07/2026) : un ingrédient neuf affirmait « je n'en veux jamais en
 * réserve » (0) à la place de l'utilisateur, alors que « je n'y ai pas encore
 * réfléchi » (vide) est la vraie phrase — même doctrine que
 * `delaiLivraisonJours`/`dureeConservationJours`, déjà vides par défaut.
 *
 * `stockSecurite` ne peut cependant PAS voyager jusqu'à `null` : la colonne
 * (`packages/db/src/schema.ts`) est `NOT NULL DEFAULT 0` et le schéma partagé
 * (`schemaSaisieIngredientBrute.stockSecurite`) exige un entier, jamais
 * nullish — les deux hors de la zone d'écriture de cet agent. Un champ VIDE
 * doit donc se résoudre à `0` avant tout aller-retour, sous peine de faire
 * échouer la création d'un ingrédient sur un champ que l'écran présente
 * pourtant comme facultatif : exactement le défaut « déplacé » que la mission
 * demandait de vérifier avant de retirer le pré-remplissage.
 */
describe('« Stock de sécurité » vide — pré-remplissage retiré sans casser la création', () => {
  it('BROUILLON_INGREDIENT_VIDE démarre avec stockSecurite VIDE, comme ses voisins', () => {
    expect(BROUILLON_INGREDIENT_VIDE.stockSecurite).toBe('');
    expect(BROUILLON_INGREDIENT_VIDE.delaiLivraisonJours).toBe('');
    expect(BROUILLON_INGREDIENT_VIDE.dureeConservationJours).toBe('');
  });

  it('un stockSecurite vide se résout à 0, jamais à null, dans le corps envoyé', () => {
    const corps = corpsSaisieIngredient({ ...BROUILLON_BASE, stockSecurite: '' });
    expect(corps).toHaveProperty('stockSecurite', 0);
  });

  it('un ingrédient neuf jamais touché reste enregistrable — la validation partagée l’accepte', () => {
    const corps = corpsSaisieIngredient({ ...BROUILLON_INGREDIENT_VIDE, nom: 'Sucre glace' });
    const resultat = schemaSaisieIngredient.safeParse(corps);
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data.stockSecurite).toBe(0);
    }
  });

  it('une saisie illisible (non-numérique) reste refusée — le `?? 0` n’intercepte pas NaN', () => {
    const corps = corpsSaisieIngredient({ ...BROUILLON_BASE, stockSecurite: 'abc' });
    const resultat = schemaSaisieIngredient.safeParse(corps);
    expect(resultat.success).toBe(false);
  });
});
