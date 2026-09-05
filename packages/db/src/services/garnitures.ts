/**
 * Sortie de stock des GARNITURES a la cloture d'une session.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Un produit transforme consomme deux choses : une part de pate, sortie du
 * stock au moment de la PRODUCTION, et une garniture, etalee au moment du
 * SERVICE. La premiere sortait deja. La seconde ne sortait jamais : la table
 * `produit_garniture` etait declaree au schema et n'etait ni ecrite ni lue.
 *
 * Trois consequences, et non une seule :
 *   1. le cout de revient etait ampute de sa part la plus variable — celle qui
 *      distingue une crepe a 3,00 € d'une crepe a 3,50 € — donc la marge etait
 *      surevaluee sur le produit dont CLAUDE.md §0 fait le coeur de la
 *      comptabilite analytique ;
 *   2. le point de commande d'une garniture ne se declenchait JAMAIS, puisque
 *      sa quantite ne bougeait pas : on tombait en rupture au marche sans
 *      aucune alerte ;
 *   3. aucune tracabilite de lot. Un pot de confiture rappele etait
 *      inrattachable a une session — obligation AFSCA, pas confort.
 *
 * Le mecanisme est exactement celui des produits REVENDUS (D-049) : un
 * mouvement `sortie_vente` par lot, reparti en FEFO, date du jour de marche.
 * C'est volontaire — la tracabilite amont et aval interroge ce type de
 * mouvement, donc les garnitures y deviennent visibles sans qu'aucune requete
 * de `depots/tracabilite.ts` n'ait a changer.
 *
 * REGLE LA PLUS IMPORTANTE
 * ------------------------
 * **Un stock insuffisant ne bloque JAMAIS la cloture.** La vente a eu lieu ;
 * refuser de l'enregistrer serait minorer un chiffre d'affaires (CLAUDE.md §7).
 * On sort ce qui est tracable et on remonte l'ecart. Inventer un lot pour
 * couvrir le manquant fabriquerait une tracabilite fausse — ce que l'AFSCA
 * interdit.
 */

import {
  cumulerGarnituresVendues,
  nouvelIdentifiant,
  repartirFefo,
  type GarnitureCalcul,
} from '@batte/core';
import { eq } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { ingredient, mouvementStock } from '../schema.js';
import { garnituresDesProduits } from '../depots/recettes.js';
import { lotsDeLIngredient } from '../depots/stock.js';

/**
 * Ecart constate entre la garniture CONSOMMEE et ce que le stock contenait.
 *
 * Structurellement identique a `EcartStockVente` de `services/sessions.ts`, et
 * volontairement redeclare : importer ce type creerait un cycle entre les deux
 * services, alors que le typage structurel de TypeScript rend deja les deux
 * listes concatenables sans conversion.
 */
export type EcartStockGarniture = {
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly quantiteManquante: number;
};

export type ResultatSortieGarnitures = {
  readonly ecarts: EcartStockGarniture[];
  /** Cout d'achat REEL des garnitures sorties, valorise au lot consomme. */
  readonly coutGarnituresCents: number;
};

export type ContexteSortieGarnitures = {
  readonly sessionId: string;
  /** Jour civil belge du marche : date du mouvement ET reference de la FEFO. */
  readonly dateSession: string;
  readonly ventes: readonly { readonly produitVenteId: string; readonly quantite: number }[];
  readonly maintenant: string;
  readonly creePar: string | null;
  /**
   * Garnitures deja resolues, quand l'appelant les a lues pour autre chose.
   * Absentes, elles sont chargees ici — le service reste appelable seul.
   */
  readonly garnituresParProduit?: ReadonlyMap<string, readonly GarnitureCalcul[]>;
};

/**
 * Sort du stock, en FEFO, les garnitures consommees par les ventes d'une session.
 *
 * Rend les ecarts et le cout reel. Ne leve jamais pour cause de stock
 * insuffisant : voir l'en-tete du fichier.
 */
export function sortirLesGarnitures(
  base: BaseBatte,
  contexte: ContexteSortieGarnitures,
): ResultatSortieGarnitures {
  const garnituresParProduit =
    contexte.garnituresParProduit ??
    garnituresDesProduits(
      base,
      contexte.ventes.map((v) => v.produitVenteId),
    );

  // Le cumul PAR INGREDIENT precede toute ecriture : deux produits differents
  // peuvent partager la meme cassonade, et repartir en FEFO produit par produit
  // ferait dependre le resultat de l'ordre des lignes de vente.
  const quantiteParIngredient = cumulerGarnituresVendues(
    contexte.ventes.map((vente) => ({
      quantite: vente.quantite,
      garnitures: garnituresParProduit.get(vente.produitVenteId) ?? [],
    })),
  );

  const ecarts: EcartStockGarniture[] = [];
  let coutGarnituresCents = 0;

  // Ordre stable : deux cloture identiques doivent produire les memes ecritures
  // dans le meme ordre, sinon deux bases « identiques » ne se comparent plus.
  for (const ingredientId of [...quantiteParIngredient.keys()].sort()) {
    const quantite = quantiteParIngredient.get(ingredientId)!;
    const lots = lotsDeLIngredient(base, ingredientId);

    // `autoriserDlcDepassee` : la vente a EU LIEU. Refuser de sortir la matiere
    // parce qu'un lot est perime ne la ferait pas revenir, ca laisserait juste
    // le stock faux — et l'ecart, lui, doit rester visible.
    const repartition = repartirFefo(lots, quantite, contexte.dateSession, {
      autoriserDlcDepassee: true,
    });

    for (const allocation of repartition.allocations) {
      coutGarnituresCents += allocation.coutCents;
      base
        .insert(mouvementStock)
        .values({
          id: nouvelIdentifiant(),
          lotId: allocation.lotId,
          ingredientId,
          // Meme type que la revente : c'est bien une sortie causee par une
          // vente, et c'est ce type que la tracabilite interroge.
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

  return { ecarts, coutGarnituresCents };
}
