/**
 * Depot de la NOMENCLATURE DE VENTE (fiche 15) : ce qu'un produit consomme au
 * moment ou il est VENDU — serviettes, gobelets, cafe en poudre, toppings
 * vendus a la piece — par opposition a la recette, consommee a la
 * PRODUCTION.
 *
 * POURQUOI CE FICHIER EXISTE. La categorie d'ingredient `consommable` existe
 * au schema depuis le Lot 1 : serviettes, assiettes et gobelets peuvent donc
 * entrer en stock des aujourd'hui, avec fournisseur, lot et point de commande.
 * Mais rien ne les fait SORTIR — exactement le defaut des garnitures corrige
 * par D-053. `produit_vente_composant` (migration `0016_skinny_echo.sql`)
 * porte cette nomenclature ; ce depot est ce qui la rend lisible et
 * ecrivable.
 *
 * TROIS REGLES REPRISES DE `depots/referentiel-ecriture.ts`, pour la meme
 * raison :
 *  1. On DESACTIVE, on ne supprime jamais (CLAUDE.md §3 regle 7).
 *  2. La modification et sa trace d'audit sont dans la MEME transaction.
 *  3. Une reference inconnue (`ingredientId`) est un 422 avec `champs`, un
 *     produit adresse dans l'URL introuvable est un 404 (D-035).
 */

import {
  ErreurIntrouvable,
  coutIndicatifComposantCents,
  maintenantUtc,
  nouvelIdentifiant,
  type ComposantVenteCalcul,
  type SaisieComposantVente,
} from '@batte/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { conditionnement, ingredient, produitVente, produitVenteComposant } from '../schema.js';
import { journaliser } from './audit.js';
import { verifierIngredientExiste } from './referentiel-ecriture.js';

/**
 * Cout unitaire de reference, en centimes par unite (D-018).
 *
 * Repris a l'identique de `depots/recettes.ts` et `depots/referentiel-ecriture.ts` :
 * le conditionnement ACTIF le plus recent, soit `prix_cents / quantite_unite_ref`.
 * Duplique volontairement plutot que d'importer un depot depuis un autre : ce
 * sont des responsabilites distinctes, et une quinzaine de lignes ne justifie
 * pas une dependance croisee entre depots.
 */
function coutsDeReference(base: BaseBatte): Map<string, number> {
  const lignes = base
    .select({
      ingredientId: conditionnement.ingredientId,
      prixCents: conditionnement.prixCents,
      quantite: conditionnement.quantiteUniteRef,
      datePrix: conditionnement.datePrix,
    })
    .from(conditionnement)
    .where(eq(conditionnement.actif, true))
    .orderBy(asc(conditionnement.datePrix))
    .all();

  const couts = new Map<string, number>();
  for (const ligne of lignes) {
    if (ligne.quantite <= 0) continue;
    // Tri ascendant : la derniere ligne vue pour un ingredient est la plus recente.
    couts.set(ligne.ingredientId, ligne.prixCents / ligne.quantite);
  }
  return couts;
}

function verifierProduitExiste(base: BaseBatte, produitVenteId: string): void {
  const existe = base
    .select({ id: produitVente.id })
    .from(produitVente)
    .where(eq(produitVente.id, produitVenteId))
    .get();
  if (existe === undefined) throw new ErreurIntrouvable('Produit', produitVenteId);
}

// `verifierIngredientExiste` n'est PLUS définie ici (audit du 31/07/2026) :
// importée de `depots/referentiel-ecriture.ts`, qui possède le CRUD de
// `ingredient` — voir son commentaire pour pourquoi c'est le foyer naturel,
// partagé avec `depots/economies.ts`.

/** Un composant tel qu'il sort de l'API : le calcul pur, plus son identite et son statut. */
export type ComposantVenteLigne = ComposantVenteCalcul & {
  readonly id: string;
  readonly produitVenteId: string;
  /**
   * `true` = OPTION servie seulement sur demande (creme dans un cafe) ;
   * `false` = toujours applique (le gobelet). Ne joue AUCUN role dans la
   * sortie de stock (`composantsActifsDesProduits` / `cumulerComposantsVendus`
   * l'ignorent volontairement, fiche 15 §1) : son seul usage aujourd'hui est
   * l'affichette d'allergenes, qui doit annoncer separement ce qui est
   * « sur demande ».
   */
  readonly optionnel: boolean;
  readonly actif: boolean;
  /**
   * Cout indicatif a l'unite vendue, au CUMP courant. Jamais arrondi (voir
   * `@batte/core`). `null` quand `cumpCentsParUnite` est `null` : un
   * composant jamais achete a un cout INCONNU, jamais gratuit.
   */
  readonly coutIndicatifCentsParUnite: number | null;
};

function versLigne(
  l: {
    composant: typeof produitVenteComposant.$inferSelect;
    ingredient: typeof ingredient.$inferSelect;
  },
  couts: Map<string, number>,
): ComposantVenteLigne {
  const calcul: ComposantVenteCalcul = {
    ingredientId: l.ingredient.id,
    nomIngredient: l.ingredient.nom,
    unite: l.ingredient.uniteReference,
    quantiteUniteRef: l.composant.quantiteUniteRef,
    quantiteReferenceUnites: l.composant.quantiteReferenceUnites,
    // `?? null`, jamais `?? 0` : un ingredient sans conditionnement actif a un
    // prix INCONNU, pas gratuit (D-018, meme regle que `depots/recettes.ts`).
    // C'etait le defaut trace ici — l'ecran de nomenclature de vente rendait
    // un composant jamais achete comme gratuit, donc une marge de 100 %.
    cumpCentsParUnite: couts.get(l.ingredient.id) ?? null,
    allergenes: l.ingredient.allergenes,
    consommationSurPlace: l.composant.consommationSurPlace,
  };
  return {
    ...calcul,
    id: l.composant.id,
    produitVenteId: l.composant.produitVenteId,
    optionnel: l.composant.optionnel,
    actif: l.composant.actif,
    coutIndicatifCentsParUnite: coutIndicatifComposantCents(calcul),
  };
}

/**
 * Composants d'UN produit, ACTIFS ET INACTIFS, pour l'ecran de declaration.
 *
 * Un ecran de referentiel doit montrer ce qui est desactive (meme convention
 * que `listerIngredientsComplets`) : un composant retire reste visible, avec
 * son geste de reactivation, plutot que de disparaitre sans trace.
 */
export function listerComposantsDuProduit(
  base: BaseBatte,
  produitVenteId: string,
): ComposantVenteLigne[] {
  const couts = coutsDeReference(base);

  return base
    .select({ composant: produitVenteComposant, ingredient })
    .from(produitVenteComposant)
    .innerJoin(ingredient, eq(produitVenteComposant.ingredientId, ingredient.id))
    .where(eq(produitVenteComposant.produitVenteId, produitVenteId))
    .orderBy(asc(ingredient.nom))
    .all()
    .map((l) => versLigne(l, couts));
}

/** Un composant precis, ou `null` s'il n'existe pas (ou plus). */
export function lireComposantVente(base: BaseBatte, id: string): ComposantVenteLigne | null {
  const couts = coutsDeReference(base);

  const ligne = base
    .select({ composant: produitVenteComposant, ingredient })
    .from(produitVenteComposant)
    .innerJoin(ingredient, eq(produitVenteComposant.ingredientId, ingredient.id))
    .where(eq(produitVenteComposant.id, id))
    .get();

  return ligne === undefined ? null : versLigne(ligne, couts);
}

/**
 * Composants ACTIFS de plusieurs produits, en UNE lecture — sert la cloture
 * de session (meme forme et meme raison que `garnituresDesProduits` de
 * `depots/recettes.ts`) : elle n'a besoin que des composants des produits
 * vendus ce jour-la, pas de tout le catalogue.
 *
 * SEULS LES ACTIFS entrent : un composant desactive ne doit plus sortir du
 * stock, meme si le produit qui le porte reste en vente.
 */
export function composantsActifsDesProduits(
  base: BaseBatte,
  produitVenteIds: readonly string[],
): Map<string, ComposantVenteCalcul[]> {
  const ids = [...new Set(produitVenteIds)];
  const parProduit = new Map<string, ComposantVenteCalcul[]>();
  for (const id of ids) parProduit.set(id, []);
  if (ids.length === 0) return parProduit;

  const couts = coutsDeReference(base);

  const lignes = base
    .select({ composant: produitVenteComposant, ingredient })
    .from(produitVenteComposant)
    .innerJoin(ingredient, eq(produitVenteComposant.ingredientId, ingredient.id))
    .where(
      and(
        inArray(produitVenteComposant.produitVenteId, ids),
        eq(produitVenteComposant.actif, true),
      ),
    )
    .all();

  for (const l of lignes) {
    const liste = parProduit.get(l.composant.produitVenteId) ?? [];
    liste.push({
      ingredientId: l.ingredient.id,
      nomIngredient: l.ingredient.nom,
      unite: l.ingredient.uniteReference,
      quantiteUniteRef: l.composant.quantiteUniteRef,
      quantiteReferenceUnites: l.composant.quantiteReferenceUnites,
      // `?? null`, jamais `?? 0` : meme regle que `versLigne` ci-dessus. Aucun
      // consommateur actuel de cette fonction ne lit ce champ pour de
      // l'argent (allergenes seuls dans `coutRevientProduit`, longueur seule
      // dans `construireAvertissementCoutMatiereTransforme`, quantites SEULES
      // — jamais le prix — dans `sortirLesComposantsVente`), mais rendre `0`
      // ici restait un mensonge disponible pour le prochain appelant qui
      // lirait ce champ sans le savoir.
      cumpCentsParUnite: couts.get(l.ingredient.id) ?? null,
      allergenes: l.ingredient.allergenes,
      consommationSurPlace: l.composant.consommationSurPlace,
    });
    parProduit.set(l.composant.produitVenteId, liste);
  }
  return parProduit;
}

/** Cree un composant sur un produit. 404 si le produit n'existe pas, 422 si l'ingredient n'existe pas. */
export function creerComposantVente(
  base: BaseBatte,
  produitVenteId: string,
  saisie: SaisieComposantVente,
  parQui?: string,
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    verifierProduitExiste(baseTx, produitVenteId);
    verifierIngredientExiste(baseTx, saisie.ingredientId);

    const cree = baseTx
      .insert(produitVenteComposant)
      .values({
        id,
        produitVenteId,
        ingredientId: saisie.ingredientId,
        quantiteUniteRef: saisie.quantiteUniteRef,
        quantiteReferenceUnites: saisie.quantiteReferenceUnites,
        consommationSurPlace: saisie.consommationSurPlace,
        optionnel: saisie.optionnel,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'produit_vente_composant',
      enregistrementId: id,
      action: 'creation',
      valeurApres: cree,
      parQui: parQui ?? null,
    });

    return id;
  });
}

/** Corrige un composant : la quantite ou le rattachement etait faux. */
export function modifierComposantVente(
  base: BaseBatte,
  id: string,
  saisie: SaisieComposantVente,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx
      .select()
      .from(produitVenteComposant)
      .where(eq(produitVenteComposant.id, id))
      .get();
    if (avant === undefined) throw new ErreurIntrouvable('Composant de vente', id);

    verifierIngredientExiste(baseTx, saisie.ingredientId);

    const apres = baseTx
      .update(produitVenteComposant)
      .set({
        ingredientId: saisie.ingredientId,
        quantiteUniteRef: saisie.quantiteUniteRef,
        quantiteReferenceUnites: saisie.quantiteReferenceUnites,
        consommationSurPlace: saisie.consommationSurPlace,
        optionnel: saisie.optionnel,
        modifieLe: maintenantUtc(),
      })
      .where(eq(produitVenteComposant.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'produit_vente_composant',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/** Active ou desactive un composant. Le remplacant de la suppression (CLAUDE.md §3 regle 7). */
export function changerActiviteComposantVente(
  base: BaseBatte,
  id: string,
  actif: boolean,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx
      .select()
      .from(produitVenteComposant)
      .where(eq(produitVenteComposant.id, id))
      .get();
    if (avant === undefined) throw new ErreurIntrouvable('Composant de vente', id);

    const apres = baseTx
      .update(produitVenteComposant)
      .set({ actif, modifieLe: maintenantUtc() })
      .where(eq(produitVenteComposant.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'produit_vente_composant',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}
