/**
 * Besoin en ingrédients projeté sur l'horizon calendaire (docs/demandes/06
 * §2) : « crêpes prévues × grammage recette », en réutilisant TEL QUEL le
 * calcul de mise à l'échelle d'une recette (`recettes.ts`, `mettreAEchelle`)
 * — rien n'est recalculé à la main ici, ce module ne fait que répartir une
 * cible de crêpes entre recettes actives et sommer par ingrédient.
 *
 * Fonction pure, aucun accès base (CLAUDE.md §3 règle 1) : la répartition
 * entre recettes (`PartRecette.partBp`) est résolue par l'appelant
 * (`packages/db/src/depots/previsions.ts`, `partsRecettesActives`), à partir
 * de l'historique RÉEL de production — jamais une répartition égale devinée
 * quand plusieurs recettes actives coexistent sans historique pour les
 * départager (même principe que D-059 : on ne fabrique pas une mesure).
 */

import { BASE_POINTS, type PointsDeBase } from '../argent.js';
import { mettreAEchelle, rendementNetBp, type RecetteCalcul } from '../recettes.js';
import type { Unite } from '../unites.js';

export type PartRecette = {
  readonly recette: RecetteCalcul;
  /** Part des crêpes cible imputée à cette recette, en points de base. */
  readonly partBp: PointsDeBase;
};

export type BesoinIngredientProjete = {
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly unite: Unite;
  /** Dans l'unité de référence de l'ingrédient. Peut être fractionnaire : ce
   * n'est pas une quantité qui sera persistée (règle n°4, argent/masses
   * entiers), c'est une PROJECTION affichée. */
  readonly quantite: number;
};

/**
 * Besoin en ingrédients pour produire `crepesCible` crêpes VENDABLES,
 * réparties entre les recettes actives selon `partBp`.
 *
 * Une recette dont le rendement est inexploitable, sans ligne, ou dont la
 * perte de cuisson/casse annule toute la production est IGNORÉE plutôt que
 * de faire échouer tout le calcul — même choix que `plafondStockCrepes`
 * (apps/api/src/routes/previsions.ts) : une fiche mal renseignée ne doit pas
 * faire disparaître la projection des AUTRES ingrédients.
 */
export function besoinsIngredients(
  recettesActives: readonly PartRecette[],
  crepesCible: number,
): readonly BesoinIngredientProjete[] {
  if (!Number.isFinite(crepesCible) || crepesCible <= 0) return [];

  const cumulParIngredient = new Map<string, BesoinIngredientProjete>();

  for (const { recette, partBp } of recettesActives) {
    if (partBp <= 0) continue;
    if (recette.rendementReferenceMl <= 0 || recette.rendementReferenceCrepes <= 0) continue;
    if (recette.lignes.length === 0) continue;
    if (rendementNetBp(recette) <= 0) continue;

    const crepesRecette = (crepesCible * partBp) / BASE_POINTS;
    if (crepesRecette <= 0) continue;

    const echelle = mettreAEchelle(recette, { type: 'crepes', crepesVendables: crepesRecette });
    for (const ligne of echelle.lignes) {
      const existant = cumulParIngredient.get(ligne.ingredientId);
      cumulParIngredient.set(ligne.ingredientId, {
        ingredientId: ligne.ingredientId,
        nomIngredient: ligne.nomIngredient,
        unite: ligne.unite,
        quantite: (existant?.quantite ?? 0) + ligne.quantite,
      });
    }
  }

  return [...cumulParIngredient.values()].sort((a, b) =>
    a.nomIngredient.localeCompare(b.nomIngredient, 'fr'),
  );
}
