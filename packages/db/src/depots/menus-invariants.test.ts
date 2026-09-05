/**
 * Deux invariants de `depots/menus.ts` que rien n'exerçait.
 *
 * 1. `composant_menu_devenu_menu` (LECTURE). Un composant de menu n'est jamais
 *    lui-même un menu — l'invariant est posé À L'ÉCRITURE
 *    (`verifierPasMenuImbrique`). Mais rien n'empêche de reclasser EN MENU un
 *    produit DÉJÀ inclus comme composant : l'invariant est alors violé APRÈS
 *    coup, et c'est la lecture qui doit s'en apercevoir. Le refus explicite est
 *    ce qui empêche `ventilerMenu` de chiffrer une composition dont un membre
 *    n'a plus de prix propre.
 *
 * 2. `composant_menu_deja_present` sur la MODIFICATION. Le même refus existe à
 *    la création et y est testé ; sur la modification, il ne l'était pas — or
 *    c'est le geste qui produit réellement la collision (rebrancher une ligne
 *    existante vers un produit déjà présent dans le même menu).
 *
 * Fixture : un menu à DEUX composants distincts. Un menu à un seul composant
 * ne pourrait pas produire de collision, et ne discriminerait donc rien.
 */

import { ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { produitVente } from '../schema.js';
import {
  creerCompositionMenu,
  lireCompositionMenu,
  listerCompositionMenu,
  modifierCompositionMenu,
} from './menus.js';

function attendCode(fn: () => unknown, code: string): ErreurMetier {
  try {
    fn();
    expect.unreachable(`devait lever une ErreurMetier de code « ${code} »`);
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect((erreur as ErreurMetier).code).toBe(code);
    return erreur as ErreurMetier;
  }
  throw new Error('inatteignable');
}

describe('depots/menus — invariants', () => {
  let base: BaseBatte;
  let idMenu: string;
  let idCrepe: string;
  let idCafe: string;
  let idLigneCrepe: string;

  /** Insère un produit de vente directement, sans passer par le contrat HTTP. */
  function insererProduit(nom: string, nature: 'transforme' | 'revendu' | 'menu'): string {
    const id = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    base
      .insert(produitVente)
      .values({
        id,
        nom,
        nature,
        recetteId: null,
        ingredientId: null,
        prixCents: nature === 'menu' ? 450 : 300,
        consommationUnite: null,
        nbCrepes: null,
        volumeMlParUnite: null,
        categorie: null,
        consommationSurPlace: true,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    return id;
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    idMenu = insererProduit('Formule crêpe + café', 'menu');
    idCrepe = insererProduit('Crêpe froment', 'transforme');
    idCafe = insererProduit('Café', 'transforme');

    idLigneCrepe = creerCompositionMenu(base, idMenu, { produitInclusId: idCrepe, quantite: 1 });
    creerCompositionMenu(base, idMenu, { produitInclusId: idCafe, quantite: 1 });
  });

  it('lit normalement une composition dont tous les membres sont des produits vendus', () => {
    // Sans ce cas, les refus ci-dessous pourraient tenir à une fixture cassée.
    const lignes = listerCompositionMenu(base, idMenu);
    expect(lignes.map((l) => l.nomProduitInclus).sort()).toEqual(['Café', 'Crêpe froment']);
  });

  it('refuse de LIRE une composition dont un composant est devenu lui-même un menu', () => {
    // L'écriture avait respecté l'invariant ; c'est le reclassement POSTÉRIEUR
    // du café en menu qui le viole. Aucun garde-fou d'écriture ne peut
    // l'attraper — seule la lecture le peut.
    base.update(produitVente).set({ nature: 'menu' }).where(eq(produitVente.id, idCafe)).run();

    const erreur = attendCode(
      () => listerCompositionMenu(base, idMenu),
      'composant_menu_devenu_menu',
    );
    expect(erreur.message).toContain('Café');
  });

  it('refuse aussi la lecture UNITAIRE de la ligne concernée', () => {
    const ligneCafe = listerCompositionMenu(base, idMenu).find(
      (l) => l.nomProduitInclus === 'Café',
    )!;
    base.update(produitVente).set({ nature: 'menu' }).where(eq(produitVente.id, idCafe)).run();

    attendCode(() => lireCompositionMenu(base, ligneCafe.id), 'composant_menu_devenu_menu');
    // Discrimine : la ligne SAINE du même menu reste lisible seule — le refus
    // vise la ligne fautive, pas la composition entière par principe.
    const crepe = lireCompositionMenu(base, idLigneCrepe);
    expect(crepe?.nomProduitInclus).toBe('Crêpe froment');
  });

  it('refuse de rebrancher une ligne vers un produit DÉJÀ présent dans le même menu', () => {
    const erreur = attendCode(
      () => modifierCompositionMenu(base, idLigneCrepe, { produitInclusId: idCafe, quantite: 1 }),
      'composant_menu_deja_present',
    );
    expect(erreur.champs).toHaveProperty('produitInclusId');

    // Rien n'a bougé : la ligne pointe toujours vers la crêpe.
    expect(lireCompositionMenu(base, idLigneCrepe)?.produitInclusId).toBe(idCrepe);
  });

  it('autorise en revanche une ligne à se modifier SUR ELLE-MÊME', () => {
    // Discrimine : une collision détectée sans exclure la ligne courante
    // interdirait de changer la quantité d'un composant, ce qui est le geste
    // le plus banal de cet écran.
    modifierCompositionMenu(base, idLigneCrepe, { produitInclusId: idCrepe, quantite: 3 });
    expect(lireCompositionMenu(base, idLigneCrepe)?.quantite).toBe(3);
  });
});
