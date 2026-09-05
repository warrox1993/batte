/**
 * Unites et conversions.
 *
 * CLAUDE.md §3 : « Masses en grammes, volumes en millilitres, tous deux en
 * entiers. Les conversions volume<->masse passent obligatoirement par la densite
 * declaree de l'ingredient. Aucune conversion implicite. »
 *
 * La densite est un REEL (g/ml) et non un entier : c'est un coefficient physique
 * d'entree, pas un montant stocke. L'invariant n°8 de docs/02 ne porte que sur
 * les montants, et le resultat de toute conversion est arrondi a l'entier.
 */

import { ErreurMetier } from './erreurs.js';

/** Unite de reference d'un ingredient (docs/02 : `unite_reference`). */
export type Unite = 'g' | 'ml' | 'piece';

export const UNITES: readonly Unite[] = ['g', 'ml', 'piece'] as const;

export function estUnite(valeur: string): valeur is Unite {
  return (UNITES as readonly string[]).includes(valeur);
}

/**
 * Convertit une quantite d'une unite vers une autre.
 *
 * Leve plutot que de deviner dans deux cas, tous deux voulus :
 *  - densite absente alors qu'une conversion masse<->volume est demandee ;
 *  - conversion impliquant `piece`, qui n'a pas d'equivalent continu.
 *
 * Une conversion silencieusement fausse se propagerait jusqu'au cout matiere et
 * au registre AFSCA ; mieux vaut un ecran qui refuse et explique.
 */
export function convertir(
  quantite: number,
  de: Unite,
  vers: Unite,
  densiteGParMl?: number | null,
): number {
  if (de === vers) return Math.round(quantite);

  if (de === 'piece' || vers === 'piece') {
    throw new ErreurMetier(
      'conversion_piece_impossible',
      'Une quantité en pièces ne peut pas être convertie en masse ou en volume. ' +
        "Renseignez le poids unitaire de l'ingrédient si vous en avez besoin.",
    );
  }

  // `Number.isFinite` et pas seulement `<= 0` : `NaN` et `Infinity` passaient la
  // garde precedente et ressortaient en resultat. Or le stock est la SOMME des
  // mouvements (CLAUDE.md §3 regle 5) — une seule ligne `NaN` rend `NaN` le
  // stock de l'ingredient, sa valorisation, puis tout cout matiere en aval, sans
  // qu'aucune erreur ne soit jamais levee.
  if (
    densiteGParMl === undefined ||
    densiteGParMl === null ||
    !Number.isFinite(densiteGParMl) ||
    densiteGParMl <= 0
  ) {
    throw new ErreurMetier(
      'densite_manquante',
      "Conversion impossible sans densité : renseignez la densité (g/ml) de l'ingrédient.",
    );
  }

  // g -> ml : on divise par la densite ; ml -> g : on multiplie.
  const resultat = de === 'ml' ? quantite * densiteGParMl : quantite / densiteGParMl;
  return Math.round(resultat);
}

/**
 * Affichage dans l'unite naturelle de l'ingredient (« Definition of done » de
 * docs/06). On bascule vers kg / L au-dela de 1000, parce que « 4,2 kg » se lit
 * plus vite que « 4200 g » dans un tableau de stock consulte en fin de journee.
 */
export function formaterQuantite(quantite: number, unite: Unite): string {
  const nombre = (valeur: number, decimales: number): string =>
    new Intl.NumberFormat('fr-BE', {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(valeur);

  switch (unite) {
    case 'g':
      return Math.abs(quantite) >= 1000
        ? `${nombre(quantite / 1000, 1)} kg`
        : `${nombre(quantite, 0)} g`;
    case 'ml':
      return Math.abs(quantite) >= 1000
        ? `${nombre(quantite / 1000, 1)} L`
        : `${nombre(quantite, 0)} ml`;
    case 'piece':
      // « 1 pièce » / « 17 pièces » : l'accord se fait au singulier a 0 et 1.
      return `${nombre(quantite, 0)} ${Math.abs(quantite) <= 1 ? 'pièce' : 'pièces'}`;
  }
}

/** Libelle court de l'unite, pour un en-tete de colonne. */
export function libelleUnite(unite: Unite): string {
  switch (unite) {
    case 'g':
      return 'grammes';
    case 'ml':
      return 'millilitres';
    case 'piece':
      return 'pièces';
  }
}
