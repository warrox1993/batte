/**
 * Cout de revient d'un produit vendu : part de pate + garnitures.
 *
 * Le defaut corrige ici : `produit_garniture` etait declaree au schema et
 * n'entrait dans AUCUN calcul. Le cout de revient valait la seule pate, donc la
 * marge etait surevaluee et deux produits de prix differents affichaient le meme
 * cout. Ces tests verrouillent les trois pieges du calcul :
 *   1. la pate ne doit pas etre comptee deux fois ;
 *   2. l'absence de garniture est un cas NORMAL, pas une erreur ;
 *   3. un cout partiel ne doit jamais s'afficher comme un cout complet.
 */

import { describe, expect, it } from 'vitest';
import { coutProduitVendu, cumulerGarnituresVendues, type GarnitureCalcul } from './recettes.js';

const VERGEOISE: GarnitureCalcul = {
  ingredientId: 'ing-vergeoise',
  nomIngredient: 'Vergeoise blonde',
  unite: 'g',
  quantiteParUnite: 20,
  cumpCentsParUnite: 0.32,
  allergenes: [],
};

const BEURRE: GarnitureCalcul = {
  ingredientId: 'ing-beurre',
  nomIngredient: 'Beurre',
  unite: 'g',
  quantiteParUnite: 5,
  cumpCentsParUnite: 0.9,
  allergenes: ['lait'],
};

/** Un transforme d'une crepe, dont la pate coute 26 c la crepe. */
function crepe(garnitures: readonly GarnitureCalcul[], nbCrepesParUnite = 1) {
  return {
    coutParCrepeCents: 26,
    nbCrepesParUnite,
    coutAchatUniteCents: null,
    estRevendu: false,
    garnitures,
    allergenesPate: ['gluten', 'lait', 'oeufs'],
  };
}

describe('coutProduitVendu', () => {
  it('additionne la part de pate et les garnitures', () => {
    const cout = coutProduitVendu(crepe([VERGEOISE]));

    // 20 g × 0,32 c/g = 6,4 c, arrondi a 6 : c'est la quantite reellement
    // etalee qui sera sortie du stock, donc c'est elle qu'on chiffre.
    expect(cout.coutGarnituresCents).toBe(6);
    expect(cout.coutPateCents).toBe(26);
    expect(cout.coutMatiereCents).toBe(32);
  });

  it('ne compte PAS la pate deux fois : elle est multipliee, jamais re-sommee', () => {
    const uneCrepe = coutProduitVendu(crepe([VERGEOISE], 1));
    const deuxCrepes = coutProduitVendu(crepe([VERGEOISE], 2));

    // La part de pate double avec le nombre de crepes...
    expect(deuxCrepes.coutPateCents).toBe(uneCrepe.coutPateCents * 2);
    // ...mais la garniture declaree l'est PAR UNITE VENDUE, pas par crepe.
    expect(deuxCrepes.coutGarnituresCents).toBe(uneCrepe.coutGarnituresCents);
  });

  it('la garniture est FACULTATIVE : une crepe nature garde son seul cout de pate', () => {
    const nature = coutProduitVendu(crepe([]));

    expect(nature.coutGarnituresCents).toBe(0);
    expect(nature.garnitures).toEqual([]);
    // Surtout : pas de `null`. Une absence de garniture n'est pas une donnee
    // manquante, c'est une crepe nature — elle a un cout parfaitement connu.
    expect(nature.coutMatiereCents).toBe(26);
  });

  it('rend `null` plutot qu un total ampute quand la pate est inconnue', () => {
    const cout = coutProduitVendu({
      coutParCrepeCents: null,
      nbCrepesParUnite: 1,
      coutAchatUniteCents: null,
      estRevendu: false,
      garnitures: [VERGEOISE],
      allergenesPate: [],
    });

    // La garniture, elle, est connue : on la rend quand meme, pour que l'ecran
    // puisse dire OU manque l'information.
    expect(cout.coutGarnituresCents).toBe(6);
    expect(cout.coutMatiereCents).toBeNull();
  });

  it('un produit REVENDU est chiffre a son prix d achat, pas a une pate', () => {
    const cout = coutProduitVendu({
      coutParCrepeCents: null,
      nbCrepesParUnite: 0,
      coutAchatUniteCents: 480,
      estRevendu: true,
      garnitures: [],
      allergenesPate: [],
    });

    expect(cout.coutPateCents).toBe(0);
    expect(cout.coutAchatCents).toBe(480);
    expect(cout.coutMatiereCents).toBe(480);
  });

  it('un revendu sans prix d achat connu ne vaut pas zero euro', () => {
    const cout = coutProduitVendu({
      coutParCrepeCents: null,
      nbCrepesParUnite: 0,
      coutAchatUniteCents: null,
      estRevendu: true,
      garnitures: [],
      allergenesPate: [],
    });

    expect(cout.coutMatiereCents).toBeNull();
  });

  it('agrege les allergenes de la pate ET des garnitures pour l affichette', () => {
    const cout = coutProduitVendu({
      ...crepe([BEURRE]),
      allergenesPate: ['gluten'],
    });

    expect(cout.allergenes).toEqual(['gluten', 'lait']);
  });

  it('deux produits de garnitures differentes n ont plus le meme cout', () => {
    // C'est exactement le symptome que l'audit avait releve sur la
    // demonstration : deux crepes vendues 3,00 € et 3,50 €, meme cout matiere.
    const cassonade = coutProduitVendu(crepe([VERGEOISE]));
    const beurre = coutProduitVendu(crepe([BEURRE]));

    expect(cassonade.coutMatiereCents).not.toBe(beurre.coutMatiereCents);
  });

  it('tous les montants restent des entiers de centimes', () => {
    const cout = coutProduitVendu(crepe([VERGEOISE, BEURRE]));

    expect(Number.isInteger(cout.coutPateCents)).toBe(true);
    expect(Number.isInteger(cout.coutGarnituresCents)).toBe(true);
    expect(Number.isInteger(cout.coutMatiereCents)).toBe(true);
    for (const ligne of cout.garnitures) expect(Number.isInteger(ligne.coutCents)).toBe(true);
  });
});

describe('cumulerGarnituresVendues', () => {
  it('cumule le meme ingredient partage par plusieurs produits', () => {
    const cumul = cumulerGarnituresVendues([
      { quantite: 10, garnitures: [{ ingredientId: 'sucre', quantiteParUnite: 20 }] },
      { quantite: 5, garnitures: [{ ingredientId: 'sucre', quantiteParUnite: 15 }] },
    ]);

    expect(cumul.get('sucre')).toBe(10 * 20 + 5 * 15);
  });

  it('ne depend pas de l ordre des lignes de vente', () => {
    const lignes = [
      { quantite: 7, garnitures: [{ ingredientId: 'sucre', quantiteParUnite: 20 }] },
      { quantite: 3, garnitures: [{ ingredientId: 'sirop', quantiteParUnite: 25 }] },
      { quantite: 4, garnitures: [{ ingredientId: 'sucre', quantiteParUnite: 20 }] },
    ];

    const direct = cumulerGarnituresVendues(lignes);
    const inverse = cumulerGarnituresVendues([...lignes].reverse());

    expect([...direct.entries()].sort()).toEqual([...inverse.entries()].sort());
  });

  it('ignore les produits sans garniture', () => {
    const cumul = cumulerGarnituresVendues([
      { quantite: 50, garnitures: [] },
      { quantite: 2, garnitures: [{ ingredientId: 'sucre', quantiteParUnite: 20 }] },
    ]);

    expect([...cumul.keys()]).toEqual(['sucre']);
  });

  it('n emet rien pour une quantite nulle : un mouvement vide ne se trace pas', () => {
    const cumul = cumulerGarnituresVendues([
      { quantite: 0, garnitures: [{ ingredientId: 'sucre', quantiteParUnite: 20 }] },
    ]);

    expect(cumul.size).toBe(0);
  });
});
