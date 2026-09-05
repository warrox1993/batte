/**
 * Logique pure du rapprochement facture fournisseur (fiche 14,
 * docs/17-VINGT-AMELIORATIONS.md § 14).
 *
 * Regle d'architecture n°1 (CLAUDE.md §3) : le calcul chiffre vit ici, en
 * fonctions pures et testees. `packages/db/src/services/factures.ts` n'assemble
 * que les donnees et les ecritures a partir de ce que ces fonctions rendent.
 */

import { ErreurMetier } from './erreurs.js';

/** Un lot d'une meme reception, avec la base sur laquelle repartir un frais. */
export type BaseVentilationLot = {
  readonly lotId: string;
  /**
   * Valeur (montant paye) ou quantite initiale du lot, selon la methode de
   * repartition choisie. Toujours positive ou nulle : une base negative
   * n'a pas de sens pour une cle de repartition.
   */
  readonly base: number;
};

export type PartFraisVentilee = {
  readonly lotId: string;
  readonly montantCents: number;
};

/**
 * Repartit un montant de frais de reception (transport, palette…) sur les
 * lots d'une meme reception, proportionnellement a `base` (valeur payee ou
 * quantite recue selon la methode choisie par l'appelant).
 *
 * Arrondit chaque part au centime, puis attribue le RESTE D'ARRONDI au
 * DERNIER lot : la somme des parts rendues est ainsi TOUJOURS exactement
 * egale a `montantCents` (CLAUDE.md §3 regle 3 — aucun centime ne doit se
 * perdre ni apparaitre par magie). C'est le meme principe que le montant
 * d'une commande, somme EXACTE de ses lignes (`services/commandes.ts`).
 *
 * Leve si aucun lot ne porte de base positive : une repartition proportion-
 * nelle a une base totale nulle diviserait par zero, et distribuer alors le
 * frais a parts egales inventerait une regle que l'utilisateur n'a pas
 * choisie.
 */
export function ventilerFrais(
  montantCents: number,
  lots: readonly BaseVentilationLot[],
): PartFraisVentilee[] {
  if (lots.length === 0) return [];

  const totalBase = lots.reduce((somme, l) => somme + l.base, 0);
  if (totalBase <= 0) {
    throw new ErreurMetier(
      'repartition_impossible',
      'Impossible de ventiler ce frais : aucun lot de cette réception ne porte de base de ' +
        'répartition positive.',
    );
  }

  let cumule = 0;
  return lots.map((l, index) => {
    const estDernier = index === lots.length - 1;
    const part = estDernier
      ? montantCents - cumule
      : Math.round((l.base / totalBase) * montantCents);
    cumule += part;
    return { lotId: l.lotId, montantCents: part };
  });
}

/**
 * Ecart de prix d'achat : ce que la facture reclame moins ce que le bon de
 * livraison annoncait, en centimes ENTIERS.
 *
 * Fonction volontairement triviale, mais NOMMEE et TESTEE (CLAUDE.md §3,
 * « toute fonction de `packages/core` est testee ») : c'est le seul endroit
 * qui fixe le sens de l'ecart (positif = la facture reclame PLUS que le bon
 * de livraison). Si ce sens devait un jour s'inverser, un seul point de
 * correction plutot qu'une recherche dans chaque appelant.
 */
export function ecartPrix(montantFactureCents: number, montantBonLivraisonCents: number): number {
  return montantFactureCents - montantBonLivraisonCents;
}
