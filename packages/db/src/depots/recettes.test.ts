/**
 * Tests dédiés de `coutRevientProduit` pour les COMPOSANTS DE NOMENCLATURE DE
 * VENTE (fiche 15, `produit_vente_composant`) — le trou corrigé le 01/08/2026 :
 * ils n'entraient jusqu'ici que dans les allergènes, jamais dans
 * `coutMatiereCents`. Un produit ENTIÈREMENT fait de composants de vente (le
 * café, `consommationUnite: 'nomenclature'`, D-085) n'avait donc JAMAIS de
 * coût matière chiffrable, même quand tous ses ingrédients avaient un prix
 * connu.
 *
 * Aucune valeur métier n'est empruntée à une graine : fournisseur,
 * ingrédient, conditionnement, recette et produit sont tous CRÉÉS par le
 * test, pour que le coût calculé soit un vrai chiffre reproductible (même
 * convention que `depots/menus.test.ts`).
 */

import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import {
  conditionnement,
  fournisseur,
  ingredient,
  produitGarniture,
  produitVente,
  recette,
  recetteLigne,
} from '../schema.js';
import { seed } from '../seed/index.js';
import { seedDemonstration, NOM_PRODUIT_CAFE } from '../seed/demonstration.js';
import { changerActiviteComposantVente, creerComposantVente } from './nomenclature-vente.js';
import { creerProduit } from './referentiel.js';
import { coutRevientProduit, listerCoutsRevientProduits } from './recettes.js';

function insererFournisseur(base: BaseBatte, nom: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(fournisseur)
    .values({ id, nom, type: 'grossiste', creeLe: maintenant, modifieLe: maintenant })
    .run();
  return id;
}

type CategorieIngredient = typeof ingredient.$inferInsert.categorie;

function insererIngredient(base: BaseBatte, nom: string, categorie: CategorieIngredient): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(ingredient)
    .values({
      id,
      nom,
      categorie,
      uniteReference: 'g',
      allergenes: [],
      stockSecurite: 0,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function insererConditionnement(
  base: BaseBatte,
  ingredientId: string,
  fournisseurId: string,
  prixCents: number,
  quantiteUniteRef: number,
): void {
  const maintenant = maintenantUtc();
  base
    .insert(conditionnement)
    .values({
      id: nouvelIdentifiant(),
      ingredientId,
      fournisseurId,
      libelle: 'Conditionnement test',
      quantiteUniteRef,
      prixCents,
      datePrix: maintenant,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
}

/** Recette délibérément VIDE : exactement le montage du café réel (fiche 15 §4). */
function insererRecetteVide(base: BaseBatte, code: string, nom: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(recette)
    .values({
      id,
      code,
      nom,
      version: 1,
      statut: 'brouillon',
      typePate: 'froment',
      sansGluten: false,
      rendementReferenceMl: 1000,
      rendementReferenceCrepes: 1,
      perteCuissonBp: 0,
      tauxCasseBp: 0,
      perteFixeMl: 0,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

describe('coutRevientProduit — composants de nomenclature de vente (fiche 15)', () => {
  let base: BaseBatte;
  let idFournisseur: string;
  let idRecetteVide: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    idFournisseur = insererFournisseur(base, 'Grossiste test');
    idRecetteVide = insererRecetteVide(base, 'RC-VIDE', 'Recette vide test');
  });

  /** Un produit « café » minimal : transformé à la demande, recette vide, `nbCrepes: 0`. */
  function creerProduitCafe(prixCents = 200, consommationSurPlace = false): string {
    return creerProduit(base, {
      nom: 'Café test',
      nature: 'transforme',
      recetteId: idRecetteVide,
      ingredientId: null,
      prixCents,
      consommationUnite: 'nomenclature',
      nbCrepes: 0,
      volumeMlParUnite: null,
      categorie: 'boisson',
      consommationSurPlace,
    });
  }

  it('un café dont TOUS les composants ont un prix connu a un coût de revient CHIFFRÉ, jamais un tiret', () => {
    const idCafeMoulu = insererIngredient(base, 'Café moulu test', 'boisson');
    insererConditionnement(base, idCafeMoulu, idFournisseur, 1400, 1000); // 1,4 c/g
    const idGobelet = insererIngredient(base, 'Gobelet test', 'consommable');
    insererConditionnement(base, idGobelet, idFournisseur, 650, 50); // 13 c/pièce

    const idCafe = creerProduitCafe(200);
    creerComposantVente(base, idCafe, {
      ingredientId: idCafeMoulu,
      quantiteUniteRef: 7,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: false,
    });
    creerComposantVente(base, idCafe, {
      ingredientId: idGobelet,
      quantiteUniteRef: 1,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: false,
    });

    const cout = coutRevientProduit(base, idCafe);

    // 7 g × 1,4 c/g = 9,8 c ; 1 pièce × 13 c = 13 c ; total exact 22,8 c,
    // arrondi UNE fois à la fin : 23 c. Ni la pâte (recette vide, `nbCrepes:
    // 0`) ni l'achat (pas un revendu) ne sont dus : les deux valent 0, sans
    // objet — jamais la cause d'un `null` pour ce produit.
    expect(cout?.coutComposantsCents).toBe(23);
    expect(cout?.coutMatiereCents).toBe(23);
    expect(cout?.margeCents).toBe(200 - 23);
    expect(cout?.composants).toHaveLength(2);
    expect(cout?.composants.every((c) => c.inclusDansLeCout)).toBe(true);
  });

  it('un composant SANS conditionnement actif rend le coût `null`, jamais 0, et reste identifiable', () => {
    const idCafeMoulu = insererIngredient(base, 'Café moulu test', 'boisson');
    insererConditionnement(base, idCafeMoulu, idFournisseur, 1400, 1000);
    // La chicorée n'a JAMAIS été réceptionnée : aucun conditionnement actif.
    const idChicoree = insererIngredient(base, 'Chicorée test', 'boisson');

    const idCafe = creerProduitCafe(200);
    creerComposantVente(base, idCafe, {
      ingredientId: idCafeMoulu,
      quantiteUniteRef: 7,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: false,
    });
    creerComposantVente(base, idCafe, {
      ingredientId: idChicoree,
      quantiteUniteRef: 2,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: false,
    });

    const cout = coutRevientProduit(base, idCafe);

    expect(cout?.coutComposantsCents).toBeNull();
    expect(cout?.coutMatiereCents).toBeNull();
    expect(cout?.margeCents).toBeNull();
    expect(cout?.margeBp).toBeNull();

    // La ligne fautive est identifiable dans le détail rendu : « inconnu
    // parce que la chicorée n'a jamais été achetée », jamais un mystère.
    const ligneChicoree = cout?.composants.find((c) => c.nomIngredient === 'Chicorée test');
    expect(ligneChicoree?.cumpCentsParUnite).toBeNull();
    expect(ligneChicoree?.coutCents).toBeNull();
  });

  it("un composant OPTIONNEL sans prix connu n'empêche PAS le coût d'être chiffré", () => {
    const idCafeMoulu = insererIngredient(base, 'Café moulu test', 'boisson');
    insererConditionnement(base, idCafeMoulu, idFournisseur, 1400, 1000);
    // La crème est une OPTION : jamais achetée non plus, mais ça ne doit pas
    // empêcher le café nature d'avoir un coût connu.
    const idCreme = insererIngredient(base, 'Crème test', 'laitier');

    const idCafe = creerProduitCafe(200);
    creerComposantVente(base, idCafe, {
      ingredientId: idCafeMoulu,
      quantiteUniteRef: 7,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: false,
    });
    creerComposantVente(base, idCafe, {
      ingredientId: idCreme,
      quantiteUniteRef: 15,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: true,
    });

    const cout = coutRevientProduit(base, idCafe);

    expect(cout?.coutComposantsCents).toBe(10); // 7 × 1,4 c = 9,8 → 10
    expect(cout?.coutMatiereCents).toBe(10);
    const ligneCreme = cout?.composants.find((c) => c.nomIngredient === 'Crème test');
    expect(ligneCreme?.inclusDansLeCout).toBe(false);
    expect(ligneCreme?.cumpCentsParUnite).toBeNull();
  });

  it('un composant réservé à un mode de consommation différent du produit ne compte pas dans son coût', () => {
    const idCafeMoulu = insererIngredient(base, 'Café moulu test', 'boisson');
    insererConditionnement(base, idCafeMoulu, idFournisseur, 1400, 1000);
    const idGobelet = insererIngredient(base, 'Gobelet test', 'consommable');
    insererConditionnement(base, idGobelet, idFournisseur, 650, 50);

    // Ce café est déclaré consommé SUR PLACE (pas de gobelet jetable dû).
    const idCafe = creerProduitCafe(200, true);
    creerComposantVente(base, idCafe, {
      ingredientId: idCafeMoulu,
      quantiteUniteRef: 7,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: false,
    });
    creerComposantVente(base, idCafe, {
      ingredientId: idGobelet,
      quantiteUniteRef: 1,
      quantiteReferenceUnites: 1,
      consommationSurPlace: false, // réservé à l'emporter
      optionnel: false,
    });

    const cout = coutRevientProduit(base, idCafe);

    expect(cout?.coutComposantsCents).toBe(10); // seul le café compte : 9,8 → 10
    const ligneGobelet = cout?.composants.find((c) => c.nomIngredient === 'Gobelet test');
    expect(ligneGobelet?.inclusDansLeCout).toBe(false);
  });

  it('un composant DÉSACTIVÉ ne compte plus dans le coût du produit', () => {
    const idCafeMoulu = insererIngredient(base, 'Café moulu test', 'boisson');
    insererConditionnement(base, idCafeMoulu, idFournisseur, 1400, 1000);
    const idChicoree = insererIngredient(base, 'Chicorée test', 'boisson');
    // Aucun conditionnement : si ce composant comptait encore, le coût serait `null`.

    const idCafe = creerProduitCafe(200);
    creerComposantVente(base, idCafe, {
      ingredientId: idCafeMoulu,
      quantiteUniteRef: 7,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: false,
    });
    const idComposantChicoree = creerComposantVente(base, idCafe, {
      ingredientId: idChicoree,
      quantiteUniteRef: 2,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: false,
    });

    changerActiviteComposantVente(base, idComposantChicoree, false);

    const cout = coutRevientProduit(base, idCafe);

    expect(cout?.coutComposantsCents).toBe(10);
    expect(cout?.composants.some((c) => c.nomIngredient === 'Chicorée test')).toBe(false);
  });

  it('un produit sans AUCUN composant de vente déclaré rend un coût de composants nul, pas inconnu', () => {
    // Une crêpe ordinaire : aucune ligne dans `produit_vente_composant`. La
    // recette reste délibérément vide (`coutMatiereCents` global sera `null`
    // pour une autre raison, sans intérêt ici) : seul le panier « composants »
    // nous intéresse dans ce test.
    const idRecetteCrepe = insererRecetteVide(base, 'RC-CREPE', 'Crêpe test');
    const idCrepe = creerProduit(base, {
      nom: 'Crêpe test',
      nature: 'transforme',
      recetteId: idRecetteCrepe,
      ingredientId: null,
      prixCents: 350,
      consommationUnite: 'crepes',
      nbCrepes: 1,
      volumeMlParUnite: null,
      categorie: 'sucrée',
      consommationSurPlace: false,
    });

    const cout = coutRevientProduit(base, idCrepe);

    expect(cout?.composants).toEqual([]);
    // Aucun composant DU TOUT n'est un cas normal (0 c), distinct d'un
    // composant PRÉSENT mais de prix inconnu (`null`).
    expect(cout?.coutComposantsCents).toBe(0);
  });

  it('`listerCoutsRevientProduits` inclut le café avec un coût chiffré', () => {
    const idCafeMoulu = insererIngredient(base, 'Café moulu test', 'boisson');
    insererConditionnement(base, idCafeMoulu, idFournisseur, 1400, 1000);
    const idCafe = creerProduitCafe(200);
    creerComposantVente(base, idCafe, {
      ingredientId: idCafeMoulu,
      quantiteUniteRef: 7,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: false,
    });

    const couts = listerCoutsRevientProduits(base);
    const ligneCafe = couts.find((c) => c.produitVenteId === idCafe);
    expect(ligneCafe?.coutMatiereCents).toBe(10);
  });
});

/**
 * D-085 : la PÂTE VENDUE AU VOLUME (`consommationUnite: 'volume_pate'`, une
 * bouteille) hérite du MÊME faux positif « revendu sans prix d'achat » que le
 * café — reproduit et corrigé à la racine dans `coutProduitVendu`
 * (`packages/core/src/recettes.ts`, drapeau `estRevendu`). Aucun produit de
 * ce type n'existait dans le jeu de démonstration : ce bloc le reproduit
 * intégralement (recette, ingrédient, conditionnement, garniture, produit),
 * même convention que le describe ci-dessus.
 *
 * MISE À JOUR (mission « un correctif qui n'arrive pas jusqu'à l'écran ne
 * corrige rien », 01/08/2026) : `coutProduitVendu` savait déjà chiffrer la
 * part de pâte d'un `volume_pate` (`estPateVendueAuVolume` +
 * `coutParMlCents` + `volumeMlParUnite`), mais `coutRevientProduit` ne
 * fournissait aucun des trois — il retombait donc sur l'ancien chemin
 * (`coutParCrepeCents * nbCrepesParUnite`, TOUJOURS zéro pour ce type de
 * produit, `nbCrepesParUnite` valant `0`). Le test ci-dessous asserte
 * désormais la valeur CORRIGÉE, calculée depuis la recette mise à l'échelle
 * SUR LE VOLUME RÉEL DE LA BOUTEILLE (`volumeMlParUnite`, jamais le rendement
 * de référence d'une autre taille) : 100 g farine pour 1000 ml, mise à
 * l'échelle sur 500 ml → 50 g × 0,75 c/g = 37,5 c exact, arrondi UNE fois à
 * 38 c. `coutPateCents` doit donc valoir 38, plus 8 c de garniture = 46 c.
 */
describe('coutRevientProduit — D-085 : la pâte vendue au volume ne doit pas hériter du faux positif « revendu sans achat »', () => {
  it('une pâte vendue au volume, dont la recette ET la garniture sont entièrement chiffrées, a un coût de revient CONNU', () => {
    const base = creerBase(':memory:');
    migrer(base);
    const idFournisseur = insererFournisseur(base, 'Grossiste test pâte');

    // Recette de pâte ENTIÈREMENT chiffrée (un seul ingrédient, prix connu) :
    // le point du test est que ce prix connu ne doit plus jamais disparaître
    // derrière `null` sous prétexte que ce produit ne consomme aucune crêpe.
    const idFarine = insererIngredient(base, 'Farine test pâte', 'farine');
    insererConditionnement(base, idFarine, idFournisseur, 750, 1000); // 0,75 c/g
    const idRecettePate = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    base
      .insert(recette)
      .values({
        id: idRecettePate,
        code: 'RC-VOLUME',
        nom: 'Pâte test vendue au volume',
        version: 1,
        statut: 'active',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 1000,
        rendementReferenceCrepes: 10,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: 0,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    base
      .insert(recetteLigne)
      .values({
        id: nouvelIdentifiant(),
        recetteId: idRecettePate,
        ingredientId: idFarine,
        quantiteUniteRef: 100,
        ordre: 0,
      })
      .run();

    // Une garniture connue elle aussi (un bouchon) : sa cause à elle NE DOIT
    // PAS disparaître derrière le faux positif de la pâte au volume.
    const idBouchon = insererIngredient(base, 'Bouchon test', 'consommable');
    insererConditionnement(base, idBouchon, idFournisseur, 800, 100); // 8 c/pièce

    const idPate = creerProduit(base, {
      nom: 'Pâte froment 50 cl test',
      nature: 'transforme',
      recetteId: idRecettePate,
      ingredientId: null,
      prixCents: 600,
      consommationUnite: 'volume_pate',
      nbCrepes: 0,
      volumeMlParUnite: 500,
      categorie: 'pâte',
      consommationSurPlace: false,
    });
    base
      .insert(produitGarniture)
      .values({
        id: nouvelIdentifiant(),
        produitVenteId: idPate,
        ingredientId: idBouchon,
        quantiteUniteRef: 1,
      })
      .run();

    const cout = coutRevientProduit(base, idPate);

    // LE TEST QUI COMPTE : ni un revendu (aucun `ingredientId` d'achat), ni
    // une nomenclature de vente (aucun composant déclaré) — une pâte au
    // volume dont la garniture (8 c) ET la pâte elle-même (38 c, voir le
    // calcul dans le commentaire de tête de ce bloc) pèsent maintenant
    // toutes les deux dans le total. `coutPateCents` n'est plus jamais `0`
    // pour un produit dont la recette a un prix connu : c'est exactement le
    // mensonge « coût à zéro, marge à 100 % » que cette mission corrige.
    expect(cout).not.toBeNull();
    expect(cout?.coutMatiereCents).not.toBeNull();
    expect(cout?.coutPateCents).toBe(38);
    expect(cout?.coutAchatCents).toBe(0);
    expect(cout?.coutGarnituresCents).toBe(8);
    expect(cout?.coutMatiereCents).toBe(46);
    expect(cout?.margeCents).toBe(600 - 46);
  });

  it('une pâte vendue au volume SANS `volumeMlParUnite` renseigné reste `null`, jamais `0` : coût inconnu ≠ coût gratuit', () => {
    // Donnée incomplète (le porteur n'a pas encore saisi la contenance de la
    // bouteille) : le coût de la pâte ne peut pas se déduire, il ne doit donc
    // JAMAIS retomber sur 0, qui se lirait comme « gratuit ».
    const base = creerBase(':memory:');
    migrer(base);
    const idFournisseur = insererFournisseur(base, 'Grossiste test pâte 2');
    const idFarine = insererIngredient(base, 'Farine test pâte 2', 'farine');
    insererConditionnement(base, idFarine, idFournisseur, 750, 1000);
    const idRecettePate = nouvelIdentifiant();
    const maintenant = maintenantUtc();
    base
      .insert(recette)
      .values({
        id: idRecettePate,
        code: 'RC-VOLUME-2',
        nom: 'Pâte test vendue au volume 2',
        version: 1,
        statut: 'active',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 1000,
        rendementReferenceCrepes: 10,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: 0,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    base
      .insert(recetteLigne)
      .values({
        id: nouvelIdentifiant(),
        recetteId: idRecettePate,
        ingredientId: idFarine,
        quantiteUniteRef: 100,
        ordre: 0,
      })
      .run();

    const idPate = creerProduit(base, {
      nom: 'Pâte froment sans contenance test',
      nature: 'transforme',
      recetteId: idRecettePate,
      ingredientId: null,
      prixCents: 600,
      consommationUnite: 'volume_pate',
      nbCrepes: 0,
      volumeMlParUnite: null, // pas encore saisi
      categorie: 'pâte',
      consommationSurPlace: false,
    });

    const cout = coutRevientProduit(base, idPate);

    expect(cout?.coutPateCents).toBe(0); // aucune part de pâte à ajouter : sans objet
    // Mais le TOTAL, lui, doit rester `null` : la pâte est due (recette
    // rattachée) et son coût n'est pas établissable sans la contenance.
    expect(cout?.coutMatiereCents).toBeNull();
    expect(cout?.margeCents).toBeNull();
  });
});

/**
 * Preuve sur le JEU DE DÉMONSTRATION (CLAUDE.md §6, fiche 15 §4) : le café
 * réel du produit, tel qu'affiché à l'écran Produits / au palmarès, a
 * désormais un coût de revient CHIFFRÉ. La valeur attendue est DÉRIVÉE des
 * conditionnements réellement écrits par la graine (jamais recopiée en dur) :
 * un test qui recopierait la constante passerait même si la chaîne de calcul
 * était rompue (même règle de rédaction que `seed/demonstration.test.ts`).
 */
describe('coutRevientProduit — le café du jeu de démonstration', () => {
  it('a un coût de revient chiffré, calculé depuis les conditionnements de la graine', () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const produitCafe = base
      .select()
      .from(produitVente)
      .where(eq(produitVente.nom, NOM_PRODUIT_CAFE))
      .get();
    expect(produitCafe).toBeDefined();

    const cout = coutRevientProduit(base, produitCafe!.id);

    // Composants NON optionnels du café, tels que déclarés par la graine :
    // café moulu, chicorée, sucre, eau, cannelle, gobelet. Les options
    // (lait, crème, beurre) n'entrent jamais dans ce total.
    const composantsAttendus = [
      'Café moulu',
      'Chicorée',
      'Sucre en poudre',
      'Eau',
      'Cannelle',
      'Gobelet carton',
    ];
    const nonOptionnels = cout!.composants.filter((c) => !c.optionnel);
    expect(nonOptionnels.map((c) => c.nomIngredient).sort()).toEqual(
      [...composantsAttendus].sort(),
    );
    expect(nonOptionnels.every((c) => c.inclusDansLeCout)).toBe(true);

    // Le coût n'est plus un tiret : c'est un vrai entier, positif, et la
    // marge s'en déduit.
    expect(cout!.coutMatiereCents).not.toBeNull();
    expect(cout!.coutMatiereCents as number).toBeGreaterThan(0);
    expect(cout!.margeCents).toBe(cout!.prixVenteCents - (cout!.coutMatiereCents as number));

    // Les trois options (lait, crème, beurre) restent visibles mais EXCLUES
    // du total — la transparence du tableau, pas un chiffre caché.
    const optionnels = cout!.composants.filter((c) => c.optionnel);
    expect(optionnels).toHaveLength(3);
    expect(optionnels.every((c) => !c.inclusDansLeCout)).toBe(true);
  });
});
