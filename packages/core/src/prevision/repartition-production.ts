/**
 * docs/17 fiche 5 : la sortie du moteur de prévision est un nombre de crêpes,
 * pas un plan de production. `docs/15 §1.9` : « part_R2, le lissage
 * exponentiel, le plancher de sécurité sans gluten, la conversion en litres
 * arrondie au demi-litre : rien n'existe ». Ce module ferme ce trou.
 *
 * docs/03, section « Répartition entre recettes » :
 *
 *     part_R2 = moyenne lissée de la part R2 des N dernières sessions
 *
 * avec un plancher de sécurité (l'offre sans gluten est un argument de
 * différenciation ; en être en rupture coûte plus que la matière) et un
 * lissage exponentiel, puis conversion en litres via le rendement de chaque
 * recette, arrondie au demi-litre.
 *
 * DIVERGENCE ASSUMÉE, documentée dans le rapport de livraison (même famille
 * que `manqueAGagnerEcretage` dans `moteur.ts`) : la part de chaque recette
 * n'est pas recalculée ici par un lissage exponentiel SESSION PAR SESSION —
 * elle est reçue de l'appelant, déjà MESURÉE sur l'historique complet de
 * production par `partsRecettesActives` (`packages/db/src/depots/
 * previsions.ts`), le mécanisme déjà bâti et documenté pour « ne jamais
 * inventer une répartition égale devinée » (même principe que D-059). Ce
 * module se limite à ce que docs/17 fiche 5 identifie comme le CŒUR manquant :
 * le plancher de sécurité et la conversion en litres arrondie — le chaînage
 * et l'affichage, pas un second estimateur de la part R2.
 *
 * Généralisé à N recettes actives (pas seulement « R1 »/« R2 ») : le plancher
 * de sécurité s'applique à TOUTE recette marquée `sansGluten`, qu'il y en ait
 * une ou plusieurs.
 */

import { BASE_POINTS, repartir, type PointsDeBase } from '../argent.js';

/** Ce qu'il faut savoir d'une recette ACTIVE pour la répartir et la convertir en volume. */
export type RecetteRepartition = {
  readonly recetteId: string;
  readonly code: string;
  readonly sansGluten: boolean;
  readonly rendementReferenceMl: number;
  readonly rendementReferenceCrepes: number;
  /** Part MESURÉE sur l'historique de production (`partsRecettesActives`), en points de base. */
  readonly partMesureeBp: PointsDeBase;
};

export type ConfigRepartitionProduction = {
  /**
   * Plancher de sécurité pour le total des recettes `sansGluten`, en points
   * de base. `0` désactive le plancher (comportement par défaut tant que le
   * porteur n'a pas fixé cette valeur — docs/03 demande un plancher, mais ne
   * chiffre aucun pourcentage : en inventer un serait exactement le défaut
   * que « aucun prior non neutre » interdit).
   */
  readonly plancherSansGlutenBp: PointsDeBase;
  /** docs/03 : « conversion en litres arrondie au demi-litre » → 500. */
  readonly arrondiVolumeMl: number;
};

export type LigneRepartitionProduction = {
  readonly recetteId: string;
  readonly code: string;
  readonly sansGluten: boolean;
  /** Part APRÈS application éventuelle du plancher, en points de base. */
  readonly partBp: PointsDeBase;
  readonly crepes: number;
  /** Volume de pâte à produire, arrondi à `config.arrondiVolumeMl`. */
  readonly volumeMl: number;
};

export type ResultatRepartitionProduction = {
  readonly lignes: readonly LigneRepartitionProduction[];
  /** Vrai si le plancher sans gluten a dû relever une part mesurée trop basse. */
  readonly plancherApplique: boolean;
};

const AUCUNE_REPARTITION: ResultatRepartitionProduction = { lignes: [], plancherApplique: false };

/**
 * Relève le groupe de recettes `sansGluten` au plancher quand leur part
 * mesurée combinée tombe en dessous, en réduisant les autres recettes au
 * prorata — jamais l'inverse : le plancher est une SÉCURITÉ, il ne doit
 * jamais faire baisser une part déjà supérieure au plancher.
 */
function ajusterPourPlancherSansGluten(
  recettes: readonly RecetteRepartition[],
  plancherSansGlutenBp: PointsDeBase,
): { readonly poids: number[]; readonly plancherApplique: boolean } {
  const poidsMesures = recettes.map((r) => Math.max(0, r.partMesureeBp));
  const total = poidsMesures.reduce((s, p) => s + p, 0);

  const indicesSansGluten = recettes
    .map((r, index) => (r.sansGluten ? index : -1))
    .filter((index) => index >= 0);

  if (total <= 0 || indicesSansGluten.length === 0 || plancherSansGlutenBp <= 0) {
    return { poids: poidsMesures, plancherApplique: false };
  }

  const sommeSansGluten = indicesSansGluten.reduce((s, i) => s + poidsMesures[i]!, 0);
  if (sommeSansGluten >= plancherSansGlutenBp) {
    return { poids: poidsMesures, plancherApplique: false };
  }

  const cibleAvecGluten = Math.max(0, BASE_POINTS - plancherSansGlutenBp);
  const sommeAvecGluten = total - sommeSansGluten;

  const poids = recettes.map((r, index) => {
    if (r.sansGluten) {
      // Répartition interne au groupe sans gluten, proportionnelle à la
      // mesure existante ; si le groupe n'a ENCORE aucune mesure (recette
      // toute nouvelle), on partage le plancher à parts égales entre les
      // recettes sans gluten actives plutôt que de diviser par zéro.
      const partDuGroupe =
        sommeSansGluten > 0 ? poidsMesures[index]! / sommeSansGluten : 1 / indicesSansGluten.length;
      return partDuGroupe * plancherSansGlutenBp;
    }
    return sommeAvecGluten > 0 ? (poidsMesures[index]! / sommeAvecGluten) * cibleAvecGluten : 0;
  });

  return { poids, plancherApplique: true };
}

/**
 * Répartit `crepesCible` (les crêpes RETENUES par `prevoir()`, après
 * écrêtage — c'est ce qui sera réellement produit) entre les recettes actives
 * exploitables, applique le plancher sans gluten, puis convertit chaque part
 * en volume de pâte arrondi au demi-litre.
 *
 * Rend un tableau VIDE (jamais une répartition inventée) si aucune recette
 * n'a de rendement exploitable ou si `crepesCible` n'est pas strictement
 * positif — même choix que `besoinsIngredients` pour les mêmes raisons.
 */
export function repartitionProduction(
  recettes: readonly RecetteRepartition[],
  crepesCible: number,
  config: ConfigRepartitionProduction,
): ResultatRepartitionProduction {
  const exploitables = recettes.filter(
    (r) => r.rendementReferenceMl > 0 && r.rendementReferenceCrepes > 0,
  );
  if (exploitables.length === 0) return AUCUNE_REPARTITION;
  if (!Number.isFinite(crepesCible) || crepesCible <= 0) return AUCUNE_REPARTITION;

  const { poids, plancherApplique } = ajusterPourPlancherSansGluten(
    exploitables,
    config.plancherSansGlutenBp,
  );

  const sommePoids = poids.reduce((s, p) => s + p, 0);
  if (sommePoids <= 0) return AUCUNE_REPARTITION;

  // `repartir` garantit que la somme des crêpes par recette vaut EXACTEMENT
  // `crepesCible` (méthode du plus grand reste, `argent.ts`) : jamais un
  // écart d'arrondi qui ferait annoncer moins que ce que le moteur recommande.
  const crepesParRecette = repartir(Math.round(crepesCible), poids);

  const arrondi = config.arrondiVolumeMl > 0 ? config.arrondiVolumeMl : 1;

  const lignes: LigneRepartitionProduction[] = exploitables.map((r, index) => {
    const crepes = crepesParRecette[index] ?? 0;
    const volumeBrutMl = (crepes * r.rendementReferenceMl) / r.rendementReferenceCrepes;
    const volumeMl = Math.round(volumeBrutMl / arrondi) * arrondi;

    return {
      recetteId: r.recetteId,
      code: r.code,
      sansGluten: r.sansGluten,
      partBp: Math.round((poids[index]! / sommePoids) * BASE_POINTS),
      crepes,
      volumeMl,
    };
  });

  return { lignes, plancherApplique };
}
