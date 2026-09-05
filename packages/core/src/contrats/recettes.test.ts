import { describe, expect, it } from 'vitest';
import { coutsComposantsVente, type ComposantVenteEntree } from './recettes.js';

/**
 * `coutsComposantsVente` est ce qui manquait a `coutRevientProduit`
 * (`packages/db/src/depots/recettes.ts`) pour chiffrer le cout de revient
 * d'un produit dont la composition vient ENTIEREMENT de la nomenclature de
 * vente (fiche 15) — le cafe fait a la tasse, `consommationUnite:
 * 'nomenclature'` (D-085). Avant ce correctif, ces composants n'entraient
 * que dans les allergenes : un tiret honnete, mais sur toute une famille de
 * produits, jamais un vrai chiffre meme quand tout etait connu.
 */

function composant(partiel: Partial<ComposantVenteEntree>): ComposantVenteEntree {
  return {
    ingredientId: 'ing-1',
    nomIngredient: 'Café moulu',
    unite: 'g',
    quantiteUniteRef: 7,
    quantiteReferenceUnites: 1,
    cumpCentsParUnite: 1.4,
    allergenes: [],
    optionnel: false,
    consommationSurPlace: null,
    ...partiel,
  };
}

describe('coutsComposantsVente — cas de base', () => {
  it('rend un total nul et un tableau vide sans aucun composant', () => {
    const resultat = coutsComposantsVente([], false);
    expect(resultat.coutComposantsCents).toBe(0);
    expect(resultat.composants).toEqual([]);
  });

  it('additionne plusieurs composants TOUJOURS appliqués, prix connus', () => {
    const resultat = coutsComposantsVente(
      [
        composant({ ingredientId: 'cafe', quantiteUniteRef: 7, cumpCentsParUnite: 1.4 }), // 9,8 c
        composant({ ingredientId: 'gobelet', quantiteUniteRef: 1, cumpCentsParUnite: 13 }), // 13 c
      ],
      false,
    );
    // 9,8 + 13 = 22,8 → arrondi UNE fois, à la fin, sur le total : 23.
    expect(resultat.coutComposantsCents).toBe(23);
    expect(resultat.composants.every((c) => c.inclusDansLeCout)).toBe(true);
  });
});

describe('coutsComposantsVente — arrondi une seule fois, sur le total (la cannelle)', () => {
  it('ne perd pas une contribution fractionnaire qui arrondirait seule à zéro', () => {
    // 20 g pour 100 cafés à 1,92 c/g = 0,384 c PAR CAFÉ : arrondie ligne à
    // ligne, elle disparaîtrait (0,384 → 0). Sommée avec un composant plus
    // gros puis arrondie une seule fois, elle doit rester présente dans le
    // total (exactement le piège documenté par `packages/core/src/
    // nomenclature-vente.ts` sur `coutIndicatifComposantCents`).
    const resultat = coutsComposantsVente(
      [
        composant({
          ingredientId: 'cannelle',
          quantiteUniteRef: 20,
          quantiteReferenceUnites: 100,
          cumpCentsParUnite: 1.92,
        }),
        composant({ ingredientId: 'gobelet', quantiteUniteRef: 1, cumpCentsParUnite: 13 }),
      ],
      false,
    );
    // 0,384 + 13 = 13,384 → 13, PAS 13 obtenu en arrondissant 0,384 à 0 puis
    // 13 à 13 (ce qui donnerait le même total ici par coïncidence : le test
    // qui suit lève la coïncidence en isolant la ligne).
    expect(resultat.coutComposantsCents).toBe(13);

    const ligneCannelle = resultat.composants.find((c) => c.ingredientId === 'cannelle');
    // La ligne INDIVIDUELLE, elle, peut arrondir à 0 pour l'affichage — c'est
    // le TOTAL qui ne doit jamais la perdre.
    expect(ligneCannelle?.coutCents).toBe(0);
  });

  it('démontre la perte si on arrondissait ligne à ligne au lieu du total', () => {
    // Quatre-vingts contributions de 2 g pour un lot de référence de 100, à
    // 1 c/g (0,02 c chacune, donc 0 arrondie individuellement) doivent
    // sommer à 1,6 c → 2 une fois arrondies ENSEMBLE, jamais 0.
    const composants = Array.from({ length: 80 }, (_, i) =>
      composant({
        ingredientId: `poivre-${i}`,
        quantiteUniteRef: 2,
        quantiteReferenceUnites: 100,
        cumpCentsParUnite: 1,
      }),
    );
    const resultat = coutsComposantsVente(composants, false);
    expect(resultat.coutComposantsCents).toBe(2);
  });
});

describe('coutsComposantsVente — un composant optionnel n’entre jamais dans le total', () => {
  it('exclut une option du total mais la garde visible dans le tableau', () => {
    const resultat = coutsComposantsVente(
      [
        composant({ ingredientId: 'cafe', quantiteUniteRef: 7, cumpCentsParUnite: 1.4 }), // 9,8 c
        composant({
          ingredientId: 'creme',
          optionnel: true,
          quantiteUniteRef: 15,
          cumpCentsParUnite: 0.58,
        }), // 8,7 c, mais optionnelle
      ],
      false,
    );
    // Seul le café (non optionnel) compte : 9,8 → 10.
    expect(resultat.coutComposantsCents).toBe(10);

    const ligneCreme = resultat.composants.find((c) => c.ingredientId === 'creme');
    expect(ligneCreme?.inclusDansLeCout).toBe(false);
    // La ligne reste chiffrée pour l'affichage, même exclue du total.
    expect(ligneCreme?.coutCents).toBe(9);
  });

  it('un prix INCONNU sur un composant optionnel ne rend PAS le total inconnu', () => {
    const resultat = coutsComposantsVente(
      [
        composant({ ingredientId: 'cafe', quantiteUniteRef: 7, cumpCentsParUnite: 1.4 }),
        composant({ ingredientId: 'creme', optionnel: true, cumpCentsParUnite: null }),
      ],
      false,
    );
    expect(resultat.coutComposantsCents).toBe(10);
    const ligneCreme = resultat.composants.find((c) => c.ingredientId === 'creme');
    expect(ligneCreme?.inclusDansLeCout).toBe(false);
    expect(ligneCreme?.cumpCentsParUnite).toBeNull();
    expect(ligneCreme?.coutCents).toBeNull();
  });
});

describe('coutsComposantsVente — le mode de consommation filtre le total', () => {
  it("exclut un composant réservé à l'autre mode que celui, FIXE, du produit", () => {
    const resultat = coutsComposantsVente(
      [
        composant({ ingredientId: 'cafe', quantiteUniteRef: 7, cumpCentsParUnite: 1.4 }),
        composant({
          ingredientId: 'gobelet',
          consommationSurPlace: false, // réservé à l'emporter
          quantiteUniteRef: 1,
          cumpCentsParUnite: 13,
        }),
      ],
      true, // produit consommé SUR PLACE
    );
    // Le gobelet (réservé à l'emporter) n'entre pas dans un produit sur place.
    expect(resultat.coutComposantsCents).toBe(10); // 9,8 → 10
    const ligneGobelet = resultat.composants.find((c) => c.ingredientId === 'gobelet');
    expect(ligneGobelet?.inclusDansLeCout).toBe(false);
  });

  it('un composant `consommationSurPlace: null` est TOUJOURS inclus, quel que soit le mode', () => {
    const resultat = coutsComposantsVente(
      [composant({ consommationSurPlace: null, cumpCentsParUnite: 1.4 })],
      true,
    );
    expect(resultat.coutComposantsCents).toBe(10);
    expect(resultat.composants[0]?.inclusDansLeCout).toBe(true);
  });
});

describe('coutsComposantsVente — un prix inconnu rend le total inconnu, jamais gratuit', () => {
  it('rend `null` dès qu’un composant INCLUS n’a aucun prix connu', () => {
    const resultat = coutsComposantsVente(
      [
        composant({ ingredientId: 'cafe', quantiteUniteRef: 7, cumpCentsParUnite: 1.4 }),
        composant({ ingredientId: 'chicoree', quantiteUniteRef: 2, cumpCentsParUnite: null }),
      ],
      false,
    );
    // Jamais `0` : un total partiellement inconnu n'est pas une somme
    // partielle présentable comme complète (D-018).
    expect(resultat.coutComposantsCents).toBeNull();

    // La ligne fautive reste identifiable : « inconnu à cause de tel
    // composant », jamais un mystère.
    const ligneChicoree = resultat.composants.find((c) => c.ingredientId === 'chicoree');
    expect(ligneChicoree?.cumpCentsParUnite).toBeNull();
    expect(ligneChicoree?.coutCents).toBeNull();
    expect(ligneChicoree?.inclusDansLeCout).toBe(true);

    // Le composant SAIN, lui, reste chiffré individuellement (affichage).
    const ligneCafe = resultat.composants.find((c) => c.ingredientId === 'cafe');
    expect(ligneCafe?.coutCents).toBe(10);
  });

  it('un lot de référence invalide (`quantiteReferenceUnites <= 0`) est traité comme un coût INCONNU, jamais 0', () => {
    const resultat = coutsComposantsVente(
      [composant({ quantiteReferenceUnites: 0, cumpCentsParUnite: 1.4 })],
      false,
    );
    expect(resultat.coutComposantsCents).toBeNull();
    expect(resultat.composants[0]?.coutCents).toBeNull();
  });
});
