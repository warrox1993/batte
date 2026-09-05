/**
 * Sortie de stock des composants de la NOMENCLATURE DE VENTE, a la cloture
 * d'une session (fiche 15).
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * La categorie d'ingredient `consommable` existe au schema depuis le Lot 1 :
 * serviettes, assiettes et gobelets peuvent entrer en stock des aujourd'hui,
 * avec fournisseur, lot et point de commande. Mais rien ne les fait SORTIR —
 * exactement le defaut des garnitures corrige par D-053. Le meme mecanisme
 * resout aussi le cafe (transforme A LA DEMANDE, sans lot de production) et
 * les toppings vendus a la piece.
 *
 * Le mecanisme est exactement celui des GARNITURES (`services/garnitures.ts`,
 * D-053) et des produits REVENDUS (`services/sessions.ts`, D-037) : un
 * mouvement `sortie_vente` par lot, reparti en FEFO, date du jour de marche.
 * C'est volontaire — la tracabilite amont et aval interroge ce type de
 * mouvement, donc les composants y deviennent visibles sans qu'aucune requete
 * de `depots/tracabilite.ts` n'ait a changer.
 *
 * REGLE LA PLUS IMPORTANTE
 * ------------------------
 * **Un stock insuffisant ne bloque JAMAIS la cloture.** La vente a eu lieu ;
 * refuser de l'enregistrer serait minorer un chiffre d'affaires (CLAUDE.md
 * §7). On sort ce qui est tracable et on remonte l'ecart. Inventer un lot
 * pour couvrir le manquant fabriquerait une tracabilite fausse — ce que
 * l'AFSCA interdit.
 *
 * LE PIEGE DE LA PETITE QUANTITE, RESOLU EN AMONT
 * ------------------------------------------------
 * La quantite consommee par un composant est parfois fractionnaire par vente
 * (une pincee de cannelle « pour 100 cafes : 20 g »). `cumulerComposantsVendus`
 * de `@batte/core` cumule TOUS les flottants du meme ingredient sur TOUTE la
 * session et n'arrondit qu'UNE SEULE FOIS, sur le total — jamais vente par
 * vente. C'est cette fonction, et elle seule, qui protege la cannelle : ce
 * fichier ne fait qu'appeler la FEFO sur son resultat DEJA entier.
 */

import {
  cumulerComposantsVendus,
  nouvelIdentifiant,
  repartirFefo,
  type LigneVenteComposants,
} from '@batte/core';
import { eq } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { ingredient, mouvementStock } from '../schema.js';
import { composantsActifsDesProduits } from '../depots/nomenclature-vente.js';
import { lotsDeLIngredient } from '../depots/stock.js';

/**
 * Ecart constate entre le composant CONSOMME et ce que le stock contenait.
 *
 * Structurellement identique a `EcartStockVente` de `services/sessions.ts` et
 * `EcartStockGarniture` de `services/garnitures.ts`, et volontairement
 * redeclare : importer l'un depuis l'autre creerait une dependance croisee
 * entre services pour un type que le typage structurel de TypeScript rend de
 * toute facon concatenable sans conversion.
 */
export type EcartStockComposant = {
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly quantiteManquante: number;
};

export type ResultatSortieComposants = {
  readonly ecarts: EcartStockComposant[];
  /** Cout d'achat REEL des composants sortis, valorise au lot consomme. */
  readonly coutComposantsCents: number;
};

export type VenteAvecModeDeConsommation = {
  readonly produitVenteId: string;
  readonly quantite: number;
  /** Mode de consommation REEL de cette ligne (celui du produit vendu, §4.3 fiche 15). */
  readonly consommationSurPlace: boolean;
};

export type ContexteSortieComposants = {
  readonly sessionId: string;
  /** Jour civil belge du marche : date du mouvement ET reference de la FEFO. */
  readonly dateSession: string;
  readonly ventes: readonly VenteAvecModeDeConsommation[];
  readonly maintenant: string;
  readonly creePar: string | null;
};

/**
 * Sort du stock, en FEFO, les composants de nomenclature de vente consommes
 * par les ventes d'une session.
 *
 * Rend les ecarts et le cout reel. Ne leve jamais pour cause de stock
 * insuffisant : voir l'en-tete du fichier.
 *
 * Appelable seule (aucune dependance a `cloturerSession`) : elle lit elle-meme
 * les composants actifs des produits vendus, exactement comme
 * `sortirLesGarnitures` lit elle-meme ses garnitures quand l'appelant ne les a
 * pas deja resolues.
 */
export function sortirLesComposantsVente(
  base: BaseBatte,
  contexte: ContexteSortieComposants,
): ResultatSortieComposants {
  const composantsParProduit = composantsActifsDesProduits(
    base,
    contexte.ventes.map((v) => v.produitVenteId),
  );

  const lignesPourCumul: LigneVenteComposants[] = contexte.ventes.map((vente) => ({
    quantite: vente.quantite,
    consommationSurPlace: vente.consommationSurPlace,
    composants: composantsParProduit.get(vente.produitVenteId) ?? [],
  }));

  // Cumul PAR INGREDIENT et arrondi UNE SEULE FOIS, sur le TOTAL de la
  // session : c'est ici, et ici seulement, que le piege de la petite quantite
  // est protege (voir l'en-tete du fichier). Ce que cette fonction rend est
  // deja un ENTIER positif, pret pour la FEFO.
  const quantiteParIngredient = cumulerComposantsVendus(lignesPourCumul);

  const ecarts: EcartStockComposant[] = [];
  let coutComposantsCents = 0;

  // Ordre stable : deux clotures identiques doivent produire les memes
  // ecritures dans le meme ordre, sinon deux bases « identiques » ne se
  // comparent plus (meme regle que `sortirLesGarnitures`).
  for (const ingredientId of [...quantiteParIngredient.keys()].sort()) {
    const quantite = quantiteParIngredient.get(ingredientId)!;
    const lots = lotsDeLIngredient(base, ingredientId);

    // `autoriserDlcDepassee` : la vente a EU LIEU. Refuser de sortir la
    // matiere parce qu'un lot est perime ne la ferait pas revenir, ca
    // laisserait juste le stock faux — et l'ecart, lui, doit rester visible.
    const repartition = repartirFefo(lots, quantite, contexte.dateSession, {
      autoriserDlcDepassee: true,
    });

    for (const allocation of repartition.allocations) {
      coutComposantsCents += allocation.coutCents;
      base
        .insert(mouvementStock)
        .values({
          id: nouvelIdentifiant(),
          lotId: allocation.lotId,
          ingredientId,
          // Meme type que la revente et que les garnitures : c'est bien une
          // sortie causee par une vente, et c'est ce type que la tracabilite
          // interroge.
          type: 'sortie_vente',
          quantite: allocation.quantite,
          dateMouvement: contexte.dateSession,
          valuationDate: contexte.dateSession,
          ajustement: false,
          productionId: null,
          sessionId: contexte.sessionId,
          // Pas de motif : une vente n'est pas un ecart a expliquer.
          motifId: null,
          motifTexte: null,
          coutCents: allocation.coutCents,
          isAnnule: false,
          annuleParId: null,
          creePar: contexte.creePar,
          creeLe: contexte.maintenant,
        })
        .run();
    }

    if (repartition.quantiteManquante > 0) {
      const ing = base
        .select({ nom: ingredient.nom })
        .from(ingredient)
        .where(eq(ingredient.id, ingredientId))
        .get();

      ecarts.push({
        ingredientId,
        nomIngredient: ing?.nom ?? ingredientId,
        quantiteManquante: repartition.quantiteManquante,
      });
    }
  }

  return { ecarts, coutComposantsCents };
}
