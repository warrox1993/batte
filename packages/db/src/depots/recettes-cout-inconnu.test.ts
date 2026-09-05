/**
 * « Un coût inconnu vaut `null`, jamais `0` » — les deux replis de
 * `depots/recettes.ts` qui portent cette doctrine, et que rien n'exerçait.
 *
 * `coutParCrepe` et `coutParMl` enveloppent tous deux `mettreAEchelle` dans un
 * `try/catch` dont le `catch` rend `null`. Aucun test ne l'atteignait : toute
 * la suite travaille sur des recettes exploitables. Or c'est précisément ce
 * repli qui décide de ce que voit l'utilisateur quand une recette a des pertes
 * absurdes — un tiret, ou « 0,00 € ».
 *
 * L'écart n'est pas cosmétique. Un coût matière à `0` produit une marge de
 * 100 % (CLAUDE.md §7 : ne jamais fabriquer un chiffre qui minore une charge).
 * Ce fichier prouve que le repli rend bien `null`, ET que la même recette
 * corrigée redonne un chiffre — sans quoi le `null` pourrait venir d'ailleurs.
 *
 * La recette fautive n'est pas dégénérée : elle a DEUX lignes, toutes deux
 * tarifées. Seules ses pertes sont impossibles (100 % de perte à la cuisson),
 * ce qui isole exactement la cause testée.
 */

import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import {
  conditionnement,
  fournisseur,
  ingredient,
  produitVente,
  recette,
  recetteLigne,
} from '../schema.js';
import { coutRevientProduit, listerRecettes, lireRecetteDetail } from './recettes.js';

const JOUR = '2026-07-28';

describe('coût de recette non chiffrable — `null`, jamais `0`', () => {
  let base: BaseBatte;
  let idRecette: string;

  /**
   * Crée une recette à deux lignes tarifées, dont les pertes sont passées en
   * argument. `perteCuissonBp: 10_000` = 100 % de perte : le rendement net
   * tombe à zéro et `mettreAEchelle` refuse de chiffrer.
   */
  function creerRecetteAvecPertes(code: string, perteCuissonBp: number): string {
    const maintenant = maintenantUtc();

    const idFournisseur = nouvelIdentifiant();
    base
      .insert(fournisseur)
      .values({
        id: idFournisseur,
        nom: `Fournisseur ${code}`,
        type: 'grossiste',
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const idRec = nouvelIdentifiant();
    base
      .insert(recette)
      .values({
        id: idRec,
        code,
        nom: `Recette ${code}`,
        version: 1,
        statut: 'active',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 455,
        rendementReferenceCrepes: 6,
        perteCuissonBp,
        tauxCasseBp: 0,
        perteFixeMl: 0,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    for (const [nom, quantite, prixCents, contenance] of [
      ['Farine', 145, 2500, 25_000],
      ['Lait', 240, 120, 1000],
    ] as const) {
      const idIng = nouvelIdentifiant();
      base
        .insert(ingredient)
        .values({
          id: idIng,
          nom: `${nom} ${code}`,
          categorie: nom === 'Farine' ? 'farine' : 'laitier',
          uniteReference: nom === 'Farine' ? 'g' : 'ml',
          allergenes: [],
          stockSecurite: 0,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      base
        .insert(conditionnement)
        .values({
          id: nouvelIdentifiant(),
          ingredientId: idIng,
          fournisseurId: idFournisseur,
          libelle: `${nom} — format`,
          quantiteUniteRef: contenance,
          prixCents,
          datePrix: JOUR,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      base
        .insert(recetteLigne)
        .values({
          id: nouvelIdentifiant(),
          recetteId: idRec,
          ingredientId: idIng,
          quantiteUniteRef: quantite,
          ordre: 0,
        })
        .run();
    }

    return idRec;
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    idRecette = creerRecetteAvecPertes('R-PERTE', 10_000);
  });

  it('lireRecetteDetail rend `null` pour le coût par crêpe, pas `0`', () => {
    const detail = lireRecetteDetail(base, idRecette);
    expect(detail).not.toBeNull();
    expect(detail!.coutParCrepeCents).toBeNull();
    // Discrimine : la recette a bien ses deux lignes, toutes deux tarifées.
    // Le `null` ne vient donc pas d'une recette vide ni d'un prix manquant.
    expect(detail!.lignes.length).toBe(2);
    for (const ligne of detail!.lignes) {
      expect(ligne.cumpCentsParUnite).not.toBeNull();
    }
  });

  it('listerRecettes rend `null` sur la même recette', () => {
    const resume = listerRecettes(base).find((r) => r.code === 'R-PERTE');
    expect(resume).toBeDefined();
    expect(resume!.nbLignes).toBe(2);
    expect(resume!.coutParCrepeCents).toBeNull();
  });

  it('la MÊME recette avec des pertes réalistes redonne un coût chiffré', () => {
    // Preuve que le `null` vient bien des pertes et de rien d'autre. 5 % de
    // perte de cuisson est une valeur ordinaire pour une pâte à crêpes.
    const idSain = creerRecetteAvecPertes('R-SAINE', 500);
    const detail = lireRecetteDetail(base, idSain);
    expect(detail!.coutParCrepeCents).not.toBeNull();
    expect(detail!.coutParCrepeCents!).toBeGreaterThan(0);
  });

  it('un produit vendu AU VOLUME sur cette recette rend un coût matière `null`, pas zéro', () => {
    // C'est le cas le plus coûteux : `coutParMl` en repli silencieux à `0`
    // donnerait une bouteille de pâte à marge 100 %.
    const maintenant = maintenantUtc();
    const idProduit = nouvelIdentifiant();
    base
      .insert(produitVente)
      .values({
        id: idProduit,
        nom: 'Bouteille de pâte 1 L',
        nature: 'transforme',
        recetteId: idRecette,
        ingredientId: null,
        prixCents: 800,
        consommationUnite: 'volume_pate',
        nbCrepes: null,
        volumeMlParUnite: 1000,
        categorie: 'emporter',
        consommationSurPlace: false,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const cout = coutRevientProduit(base, idProduit);
    expect(cout).not.toBeNull();
    expect(cout!.coutMatiereCents).toBeNull();
    // Et donc pas de marge affichée : une marge calculée sur un coût inconnu
    // serait un chiffre inventé.
    expect(cout!.margeCents).toBeNull();
  });

  it('le même produit sur la recette saine RETROUVE un coût matière chiffré', () => {
    const idSain = creerRecetteAvecPertes('R-SAINE-2', 500);
    const maintenant = maintenantUtc();
    const idProduit = nouvelIdentifiant();
    base
      .insert(produitVente)
      .values({
        id: idProduit,
        nom: 'Bouteille de pâte 1 L (saine)',
        nature: 'transforme',
        recetteId: idSain,
        ingredientId: null,
        prixCents: 800,
        consommationUnite: 'volume_pate',
        nbCrepes: null,
        volumeMlParUnite: 1000,
        categorie: 'emporter',
        consommationSurPlace: false,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const cout = coutRevientProduit(base, idProduit);
    expect(cout!.coutMatiereCents).not.toBeNull();
    expect(cout!.coutMatiereCents!).toBeGreaterThan(0);
  });
});
