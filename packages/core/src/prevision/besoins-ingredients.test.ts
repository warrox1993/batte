import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import type { RecetteCalcul } from '../recettes.js';
import { besoinsIngredients, type PartRecette } from './besoins-ingredients.js';

/** Recette R1 simplifiée (CLAUDE.md §6) : pour 6 crêpes, 145 g farine, 240 ml lait. */
const RECETTE_R1: RecetteCalcul = {
  id: 'recette-r1',
  code: 'R1',
  rendementReferenceMl: 1000,
  rendementReferenceCrepes: 6,
  perteCuissonBp: 0,
  tauxCasseBp: 0,
  lignes: [
    {
      ingredientId: 'farine',
      nomIngredient: 'Farine T55',
      unite: 'g',
      quantiteReference: 145,
      cumpCentsParUnite: 1,
      allergenes: ['gluten'],
    },
    {
      ingredientId: 'lait',
      nomIngredient: 'Lait entier',
      unite: 'ml',
      quantiteReference: 240,
      cumpCentsParUnite: 1,
      allergenes: ['lait'],
    },
  ],
};

/** Recette R2 (sarrasin), partage le lait avec R1 mais pas la farine. */
const RECETTE_R2: RecetteCalcul = {
  id: 'recette-r2',
  code: 'R2',
  rendementReferenceMl: 1000,
  rendementReferenceCrepes: 6,
  perteCuissonBp: 0,
  tauxCasseBp: 0,
  lignes: [
    {
      ingredientId: 'sarrasin',
      nomIngredient: 'Farine de sarrasin',
      unite: 'g',
      quantiteReference: 200,
      cumpCentsParUnite: 1,
      allergenes: [],
    },
    {
      ingredientId: 'lait',
      nomIngredient: 'Lait entier',
      unite: 'ml',
      quantiteReference: 240,
      cumpCentsParUnite: 1,
      allergenes: ['lait'],
    },
  ],
};

describe('besoinsIngredients', () => {
  it('calcule le besoin d’une seule recette active à 100 %', () => {
    const parts: PartRecette[] = [{ recette: RECETTE_R1, partBp: BASE_POINTS }];
    const besoins = besoinsIngredients(parts, 60);

    // 60 crêpes vendables / 6 par fournée = facteur 10 -> 1450 g farine, 2400 ml lait.
    const farine = besoins.find((b) => b.ingredientId === 'farine');
    const lait = besoins.find((b) => b.ingredientId === 'lait');
    expect(farine?.quantite).toBe(1450);
    expect(lait?.quantite).toBe(2400);
  });

  it('somme un ingrédient PARTAGÉ entre deux recettes réparties', () => {
    const parts: PartRecette[] = [
      { recette: RECETTE_R1, partBp: 7000 }, // 70 %
      { recette: RECETTE_R2, partBp: 3000 }, // 30 %
    ];
    const besoins = besoinsIngredients(parts, 100);

    // R1 : 70 crêpes -> lait 240 * (70/6) = 2800 ml. R2 : 30 crêpes -> lait 240 * (30/6) = 1200 ml.
    const lait = besoins.find((b) => b.ingredientId === 'lait');
    expect(lait?.quantite).toBe(4000);

    // La farine (R1 seule) et le sarrasin (R2 seule) ne se mélangent jamais.
    // R1 : 70 crêpes -> facteur 70/6 -> farine 145 * 70/6 ≈ 1691,67 -> arrondi 1692.
    expect(besoins.find((b) => b.ingredientId === 'farine')?.quantite).toBe(
      Math.round(145 * (70 / 6)),
    );
    // R2 : 30 crêpes -> facteur 30/6 = 5 -> sarrasin 200 * 5 = 1000, exact.
    expect(besoins.find((b) => b.ingredientId === 'sarrasin')?.quantite).toBe(1000);
  });

  it('ignore une recette dont la part est nulle', () => {
    const parts: PartRecette[] = [
      { recette: RECETTE_R1, partBp: BASE_POINTS },
      { recette: RECETTE_R2, partBp: 0 },
    ];
    const besoins = besoinsIngredients(parts, 60);
    expect(besoins.find((b) => b.ingredientId === 'sarrasin')).toBeUndefined();
  });

  it('ignore une recette sans rendement exploitable plutôt que de faire échouer tout le calcul', () => {
    const recetteCassee: RecetteCalcul = { ...RECETTE_R1, rendementReferenceCrepes: 0 };
    const parts: PartRecette[] = [
      { recette: recetteCassee, partBp: 5000 },
      { recette: RECETTE_R2, partBp: 5000 },
    ];
    const besoins = besoinsIngredients(parts, 60);
    expect(besoins.find((b) => b.ingredientId === 'farine')).toBeUndefined();
    expect(besoins.find((b) => b.ingredientId === 'sarrasin')).toBeDefined();
  });

  it('ignore une recette sans ligne', () => {
    const recetteVide: RecetteCalcul = { ...RECETTE_R1, lignes: [] };
    const besoins = besoinsIngredients([{ recette: recetteVide, partBp: BASE_POINTS }], 60);
    expect(besoins).toEqual([]);
  });

  it('ignore une recette dont pertes de cuisson et casse annulent toute la production', () => {
    const recetteAnnulee: RecetteCalcul = { ...RECETTE_R1, perteCuissonBp: 10_000 };
    const besoins = besoinsIngredients([{ recette: recetteAnnulee, partBp: BASE_POINTS }], 60);
    expect(besoins).toEqual([]);
  });

  it('rend un tableau vide sur une cible de crêpes nulle, négative ou non finie', () => {
    const parts: PartRecette[] = [{ recette: RECETTE_R1, partBp: BASE_POINTS }];
    expect(besoinsIngredients(parts, 0)).toEqual([]);
    expect(besoinsIngredients(parts, -10)).toEqual([]);
    expect(besoinsIngredients(parts, Number.NaN)).toEqual([]);
  });

  it('trie le résultat par nom d’ingrédient', () => {
    const parts: PartRecette[] = [{ recette: RECETTE_R1, partBp: BASE_POINTS }];
    const besoins = besoinsIngredients(parts, 60);
    const noms = besoins.map((b) => b.nomIngredient);
    expect(noms).toEqual([...noms].sort((a, b) => a.localeCompare(b, 'fr')));
  });
});
