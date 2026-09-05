import { describe, expect, it } from 'vitest';
import type { ComposantVente } from '@batte/core';
import {
  coutLotReferenceCents,
  erreursSaisieComposantVente,
  type Brouillon,
} from './NomenclatureVente';

/**
 * Retour de focus après un échec d'enregistrement (recette clavier du
 * 30/07/2026, même mission que Produits.tsx, Concurrents.tsx et
 * Fournisseurs.tsx) : `corpsDepuisBrouillon` posait déjà `champsEnErreur` sur
 * un ingrédient non choisi ou une quantité illisible, mais n'appelait jamais
 * `focaliserPremierChampFautif` — le focus restait sur le bouton
 * « Enregistrer ».
 *
 * `erreursSaisieComposantVente` est la fonction PURE extraite de cette
 * validation locale : ces tests prouvent qu'elle désigne le bon champ EN
 * PREMIER — celui que `corpsDepuisBrouillon` transmet désormais à
 * `focaliserPremierChampFautif` juste après `setChampsEnErreur`.
 */
const BROUILLON_VALIDE: Brouillon = {
  ingredientId: 'ingredient-gobelet',
  quantiteUniteRef: '20',
  quantiteReferenceUnites: '100',
  mode: 'indifferent',
  optionnel: false,
};

describe('erreursSaisieComposantVente — le champ que le focus doit atteindre en premier', () => {
  it('signale un ingrédient non choisi sous `ingredientId`', () => {
    const erreurs = erreursSaisieComposantVente({ ...BROUILLON_VALIDE, ingredientId: '' });
    expect(Object.keys(erreurs)[0]).toBe('ingredientId');
  });

  it('signale une quantité consommée illisible sous `quantiteUniteRef`', () => {
    const erreurs = erreursSaisieComposantVente({ ...BROUILLON_VALIDE, quantiteUniteRef: 'abc' });
    expect(Object.keys(erreurs)[0]).toBe('quantiteUniteRef');
  });

  it('signale une quantité consommée nulle ou négative sous `quantiteUniteRef`', () => {
    const erreurs = erreursSaisieComposantVente({ ...BROUILLON_VALIDE, quantiteUniteRef: '0' });
    expect(Object.keys(erreurs)[0]).toBe('quantiteUniteRef');
  });

  it('signale un lot de référence illisible sous `quantiteReferenceUnites`', () => {
    const erreurs = erreursSaisieComposantVente({
      ...BROUILLON_VALIDE,
      quantiteReferenceUnites: 'abc',
    });
    expect(Object.keys(erreurs)[0]).toBe('quantiteReferenceUnites');
  });

  it('ne signale rien pour un brouillon valide', () => {
    expect(erreursSaisieComposantVente(BROUILLON_VALIDE)).toEqual({});
  });
});

/** Un gobelet carton, tel qu'il sort de `GET /produits/:id/composants`. */
const COMPOSANT_GOBELET: ComposantVente = {
  id: 'composant-gobelet',
  produitVenteId: 'produit-cafe',
  ingredientId: 'ingredient-gobelet',
  nomIngredient: 'Gobelet carton',
  unite: 'piece',
  quantiteUniteRef: 1,
  quantiteReferenceUnites: 1,
  cumpCentsParUnite: 13,
  allergenes: [],
  consommationSurPlace: null,
  optionnel: false,
  actif: true,
  coutIndicatifCentsParUnite: 13,
};

/**
 * Le mensonge tracé par la mission « inconnu = gratuit » : un composant sans
 * conditionnement actif (jamais acheté) devait rendre `cumpCentsParUnite: 0`
 * avant ce correctif (le dépôt repliait `?? 0`), donc un coût de lot à
 * `0,00 €` — une marge de 100 % sur l'écran d'administration de la
 * nomenclature de vente.
 */
describe('coutLotReferenceCents', () => {
  it('multiplie le coût indicatif (non arrondi) par le lot de référence', () => {
    // La cannelle : 0,2 g/café × 1,5 c/g = 0,3 c indicatif, × 100 = 30 c pour
    // le lot de référence entier.
    expect(
      coutLotReferenceCents({
        ...COMPOSANT_GOBELET,
        coutIndicatifCentsParUnite: 0.3,
        quantiteReferenceUnites: 100,
      }),
    ).toBe(30);
  });

  it('rend null, jamais 0, pour un composant jamais acheté (prix inconnu)', () => {
    expect(
      coutLotReferenceCents({
        ...COMPOSANT_GOBELET,
        cumpCentsParUnite: null,
        coutIndicatifCentsParUnite: null,
      }),
    ).toBeNull();
  });

  it('rend un montant connu quand le conditionnement est connu', () => {
    expect(coutLotReferenceCents(COMPOSANT_GOBELET)).toBe(13);
  });
});
