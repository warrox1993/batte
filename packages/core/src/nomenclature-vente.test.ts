/**
 * Nomenclature de vente : mise a l'echelle par lot de reference, arrondi au
 * niveau du TOTAL, et filtre par mode de consommation.
 *
 * Le defaut corrige : les consommables (serviette, assiette, gobelet) et le
 * cafe entrent en stock sans jamais en sortir (fiche 15, meme classe de
 * defaut que les garnitures — D-053). Ces tests verrouillent les deux pieges
 * documentes dans `nomenclature-vente.ts` :
 *   1. une petite quantite (cannelle) ne doit JAMAIS disparaitre a l'arrondi ;
 *   2. le mode de consommation (sur place / a emporter) doit filtrer ce qui
 *      sort réellement.
 */

import { describe, expect, it } from 'vitest';
import {
  coutIndicatifComposantCents,
  cumulerComposantsVendus,
  type ComposantVenteCalcul,
} from './nomenclature-vente.js';

/** Cannelle : « pour 100 cafes, 20 g » — soit 0,2 g par tasse. */
const CANNELLE: ComposantVenteCalcul = {
  ingredientId: 'ing-cannelle',
  nomIngredient: 'Cannelle',
  unite: 'g',
  quantiteUniteRef: 20,
  quantiteReferenceUnites: 100,
  cumpCentsParUnite: 1.5,
  allergenes: [],
  consommationSurPlace: null,
};

/** Gobelet : un par cafe, quel que soit le mode de consommation. */
const GOBELET: ComposantVenteCalcul = {
  ingredientId: 'ing-gobelet',
  nomIngredient: 'Gobelet carton',
  unite: 'piece',
  quantiteUniteRef: 1,
  quantiteReferenceUnites: 1,
  cumpCentsParUnite: 4,
  allergenes: [],
  consommationSurPlace: null,
};

/** Assiette : seulement sur place. */
const ASSIETTE: ComposantVenteCalcul = {
  ingredientId: 'ing-assiette',
  nomIngredient: 'Assiette carton',
  unite: 'piece',
  quantiteUniteRef: 1,
  quantiteReferenceUnites: 1,
  cumpCentsParUnite: 6,
  allergenes: [],
  consommationSurPlace: true,
};

/** Contenant a emporter : seulement a l'emporte. */
const CONTENANT: ComposantVenteCalcul = {
  ingredientId: 'ing-contenant',
  nomIngredient: 'Bouteille 50 cl',
  unite: 'piece',
  quantiteUniteRef: 1,
  quantiteReferenceUnites: 1,
  cumpCentsParUnite: 20,
  allergenes: [],
  consommationSurPlace: false,
};

describe('cumulerComposantsVendus — piege n°1 : la petite quantite ne disparait pas', () => {
  it('quatre-vingts arrondis a zero feraient zero ; un seul arrondi sur le total fait 16 g', () => {
    // 80 ventes d'UNE tasse chacune, jamais une vente de 80 : c'est exactement
    // le cas « un cafe a la fois, toute la session » que le porteur decrit.
    const quatreVingtsVentesUnitaires = Array.from({ length: 80 }, () => ({
      quantite: 1,
      consommationSurPlace: true,
      composants: [CANNELLE],
    }));

    const cumul = cumulerComposantsVendus(quatreVingtsVentesUnitaires);

    // Le calcul naif — arrondir CHAQUE contribution avant de sommer —
    // donnerait Math.round(0.2) x 80 = 0 x 80 = 0. Le bon calcul cumule
    // 80 x 0,2 = 16,0 puis arrondit UNE fois : 16.
    expect(cumul.get('ing-cannelle')).toBe(16);
  });

  it('une seule ligne de vente a quantite=80 donne le meme resultat que 80 lignes de 1', () => {
    const uneLigne = cumulerComposantsVendus([
      { quantite: 80, consommationSurPlace: true, composants: [CANNELLE] },
    ]);
    const quatreVingtsLignes = cumulerComposantsVendus(
      Array.from({ length: 80 }, () => ({
        quantite: 1,
        consommationSurPlace: true,
        composants: [CANNELLE],
      })),
    );

    expect(uneLigne.get('ing-cannelle')).toBe(quatreVingtsLignes.get('ing-cannelle'));
  });

  it('une quantite qui arrondit a zero ne cree AUCUNE entree (pas de mouvement vide)', () => {
    // Deux cafes seulement : 2 x 0,2 = 0,4 g, arrondi a 0.
    const cumul = cumulerComposantsVendus([
      { quantite: 2, consommationSurPlace: true, composants: [CANNELLE] },
    ]);

    expect(cumul.has('ing-cannelle')).toBe(false);
  });

  it('arrondit .5 vers le haut, comme Math.round', () => {
    // 5 cafes x 0,2 g = 1,0 g exactement — cas limite verifie separement de .5.
    const cumul = cumulerComposantsVendus([
      { quantite: 5, consommationSurPlace: true, composants: [CANNELLE] },
    ]);
    expect(cumul.get('ing-cannelle')).toBe(1);
  });
});

describe('cumulerComposantsVendus — cumul multi-produits, ordre indifferent', () => {
  it('cumule le meme ingredient partage par plusieurs produits avant d’arrondir', () => {
    const cumul = cumulerComposantsVendus([
      { quantite: 30, consommationSurPlace: true, composants: [CANNELLE] },
      { quantite: 45, consommationSurPlace: true, composants: [CANNELLE] },
    ]);
    // (30 + 45) x 20 / 100 = 15 g exactement.
    expect(cumul.get('ing-cannelle')).toBe(15);
  });

  it('ne depend pas de l’ordre des lignes de vente', () => {
    const lignes = [
      { quantite: 7, consommationSurPlace: true, composants: [CANNELLE] },
      { quantite: 13, consommationSurPlace: true, composants: [GOBELET] },
      { quantite: 4, consommationSurPlace: true, composants: [CANNELLE] },
    ];

    const direct = cumulerComposantsVendus(lignes);
    const inverse = cumulerComposantsVendus([...lignes].reverse());

    expect([...direct.entries()].sort()).toEqual([...inverse.entries()].sort());
  });

  it('ignore les produits sans composant', () => {
    const cumul = cumulerComposantsVendus([
      { quantite: 50, consommationSurPlace: true, composants: [] },
      { quantite: 2, consommationSurPlace: true, composants: [GOBELET] },
    ]);
    expect([...cumul.keys()]).toEqual(['ing-gobelet']);
  });
});

describe('cumulerComposantsVendus — piege n°2 : le mode de consommation filtre la sortie', () => {
  it('un composant `null` sort quel que soit le mode de consommation', () => {
    const surPlace = cumulerComposantsVendus([
      { quantite: 10, consommationSurPlace: true, composants: [GOBELET] },
    ]);
    const emporte = cumulerComposantsVendus([
      { quantite: 10, consommationSurPlace: false, composants: [GOBELET] },
    ]);
    expect(surPlace.get('ing-gobelet')).toBe(10);
    expect(emporte.get('ing-gobelet')).toBe(10);
  });

  it('une assiette (sur place uniquement) ne sort PAS sur une vente a emporter', () => {
    const cumul = cumulerComposantsVendus([
      { quantite: 5, consommationSurPlace: false, composants: [ASSIETTE] },
    ]);
    expect(cumul.has('ing-assiette')).toBe(false);
  });

  it('une assiette sort bien sur une vente consommee sur place', () => {
    const cumul = cumulerComposantsVendus([
      { quantite: 5, consommationSurPlace: true, composants: [ASSIETTE] },
    ]);
    expect(cumul.get('ing-assiette')).toBe(5);
  });

  it('un contenant (a emporter uniquement) ne sort PAS sur une vente sur place', () => {
    const cumul = cumulerComposantsVendus([
      { quantite: 3, consommationSurPlace: true, composants: [CONTENANT] },
    ]);
    expect(cumul.has('ing-contenant')).toBe(false);
  });

  it('une meme vente peut ne faire sortir qu’une partie de ses composants declares', () => {
    // Un cafe a emporter : le gobelet et la cannelle sortent, l'assiette non —
    // exactement le cas §4.3 de la fiche 15.
    const cumul = cumulerComposantsVendus([
      {
        quantite: 100,
        consommationSurPlace: false,
        composants: [CANNELLE, GOBELET, ASSIETTE, CONTENANT],
      },
    ]);
    expect(cumul.get('ing-cannelle')).toBe(20);
    expect(cumul.get('ing-gobelet')).toBe(100);
    expect(cumul.has('ing-assiette')).toBe(false);
    expect(cumul.get('ing-contenant')).toBe(100);
  });
});

describe('coutIndicatifComposantCents', () => {
  it('n’arrondit jamais : la cannelle indicative vaut 0,2 g x 1,5 c/g = 0,3 c', () => {
    expect(coutIndicatifComposantCents(CANNELLE)).toBeCloseTo(0.3, 10);
  });

  it('un gobelet a l’unite vaut exactement son cout unitaire', () => {
    expect(coutIndicatifComposantCents(GOBELET)).toBe(4);
  });

  it('rend null plutot que de diviser par zero sur un lot de reference invalide', () => {
    // Incoherence de donnees (colonne NOT NULL, defaut 1), jamais un cout nul
    // silencieux — meme doctrine que `coutsComposantsVente`.
    expect(coutIndicatifComposantCents({ ...CANNELLE, quantiteReferenceUnites: 0 })).toBeNull();
  });

  it('rend null, jamais 0, pour un composant jamais achete (prix inconnu)', () => {
    // C'est LE defaut trace par cette mission : un composant sans prix connu
    // devenait gratuit (`?? 0` en amont), donc une marge de 100 % a l'ecran
    // de nomenclature de vente.
    expect(coutIndicatifComposantCents({ ...GOBELET, cumpCentsParUnite: null })).toBeNull();
  });
});
