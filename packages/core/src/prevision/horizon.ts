/**
 * Honnêteté de la prévision à mesure que l'horizon s'éloigne
 * (docs/demandes/06 — « Prévision calendaire sur 365 jours et achats
 * anticipés », le piège central).
 *
 * Une prévision à 300 jours n'a pas la même valeur qu'une prévision à 7
 * jours : la météo n'est connue qu'à une dizaine de jours, les événements
 * lointains sont inconnus, la tendance extrapolée devient fragile. Ce module
 * REND CETTE DIFFÉRENCE CALCULABLE, dans le même esprit que
 * `ecart-meteo-prevue-realisee.ts` (qui inflate l'écart-type selon l'horizon
 * météo mesuré) : une inflation qui ne fait que CROÎTRE avec l'horizon,
 * jamais une contraction, et un gabarit honnête pour dire « ce chiffre n'est
 * plus assez fiable pour guider une décision » plutôt que l'afficher avec le
 * même aplomb qu'un chiffre à 7 jours.
 *
 * PHASE 1 assumée, dans l'esprit de docs/03 pour les priors météo et de
 * `ecart-meteo-prevue-realisee.ts` pour l'inflation météo : la formule
 * ci-dessous est une heuristique simple et documentée comme telle — un prior
 * NEUTRE en-deçà du seuil fiable (D-059 : on n'invente pas un prior non
 * neutre), une croissance ASSUMÉE au-delà, jamais une valeur qui prétend
 * avoir été mesurée. Elle vit ici, séparée de `ecart-meteo-prevue-realisee.ts`,
 * parce qu'elle ne modélise PAS un mécanisme météo précis : elle modélise le
 * fait, plus général, qu'un horizon lointain fragilise TOUTE la chaîne de
 * facteurs (météo inconnue, événements non recensés, tendance extrapolée),
 * y compris quand aucun couple (prévu, réalisé) météo n'existe encore pour la
 * calibrer — c'est-à-dire précisément le cas d'une installation neuve qui
 * projette déjà à un an.
 *
 * Fonctions pures, aucun accès base (CLAUDE.md §3 règle 1). Les seuils et
 * pentes sont des paramètres du catalogue, jamais codés en dur ici — voir le
 * rapport de livraison pour les clés proposées (`prevision_horizon_fiable_jours`,
 * `prevision_horizon_inflation_pente_bp_par_semaine`,
 * `prevision_horizon_inflation_max_bp`, `prevision_intervalle_inutile_ratio_bp`).
 */

import { BASE_POINTS, type PointsDeBase } from '../argent.js';

export type ConfigInflationHorizon = {
  /**
   * Horizon (en jours) en-deçà duquel AUCUNE inflation structurelle n'est
   * appliquée : la météo y est encore raisonnablement connue, les événements
   * proches sont généralement déjà recensés. Assumé, pas mesuré (D-059) —
   * même famille que `prevision_ecart_meteo_horizon_reference_jours`.
   */
  readonly horizonFiableJours: number;
  /** Croissance de l'inflation (bp) par semaine ENTAMÉE au-delà du seuil fiable. */
  readonly penteBpParSemaine: number;
  /** Plafond de l'inflation, en points de base (10000 = ×1, pas d'inflation). */
  readonly inflationMaxBp: number;
};

/**
 * Inflation STRUCTURELLE de l'écart-type liée à la seule distance calendaire,
 * indépendante de toute mesure météo (voir `ecart-meteo-prevue-realisee.ts`
 * pour l'inflation calibrée sur l'écart météo prévu/réalisé — les deux se
 * composent multiplicativement dans `prevoir()`, jamais l'une au lieu de
 * l'autre).
 *
 * Neutre (10000) à `horizonFiableJours` ou en-deçà. Croît ENSUITE
 * linéairement par semaine entamée, plafonnée à `inflationMaxBp`. Ne descend
 * JAMAIS sous 10000 : ce prédicteur ÉLARGIT l'incertitude, il ne la resserre
 * jamais — même invariant que l'inflation météo.
 *
 * `Number.NaN` ou un horizon négatif rend le neutre : une distance illisible
 * ne doit jamais se traduire par une fausse certitude NI par une inflation
 * inventée dans le mauvais sens.
 */
export function inflationHorizonBp(
  horizonJours: number,
  config: ConfigInflationHorizon,
): PointsDeBase {
  if (!Number.isFinite(horizonJours) || horizonJours <= config.horizonFiableJours) {
    return BASE_POINTS;
  }

  const semainesAuDela = (horizonJours - config.horizonFiableJours) / 7;
  const brut = BASE_POINTS + semainesAuDela * config.penteBpParSemaine;
  return Math.round(Math.min(Math.max(brut, BASE_POINTS), config.inflationMaxBp));
}

/**
 * Confiance (0 à 10000) DÉRIVÉE de l'inflation d'horizon ci-dessus — une seule
 * source de vérité pour l'incertitude liée à la distance calendaire, jamais
 * deux formules qui pourraient diverger sur le même chiffre.
 *
 * Distincte de `confianceBp` (moteur.ts, fondée sur le nombre de sessions
 * observées) : une confiance PEUT être haute sur les deux plans à la fois
 * (modèle mature, horizon proche) ou haute sur un plan et basse sur l'autre
 * (modèle mature, horizon à 300 jours). L'écran doit pouvoir afficher les
 * deux, jamais les confondre en une seule.
 */
export function confianceHorizonBp(inflationBp: PointsDeBase): PointsDeBase {
  if (!Number.isFinite(inflationBp) || inflationBp <= 0) return 0;
  return Math.round(Math.min(BASE_POINTS, (BASE_POINTS * BASE_POINTS) / inflationBp));
}

/**
 * Bande d'horizon affichable à l'écran : `fiable` en-deçà du seuil, `elargie`
 * au-delà — le même seuil que `inflationHorizonBp`, pour que le libellé et le
 * calcul ne racontent jamais deux histoires différentes.
 */
export type BandeHorizon = 'fiable' | 'elargie';

export function bandeHorizon(horizonJours: number, horizonFiableJours: number): BandeHorizon {
  return Number.isFinite(horizonJours) && horizonJours <= horizonFiableJours ? 'fiable' : 'elargie';
}

/**
 * Corollaire du piège central (docs/demandes/06) : « si l'horizon est tel que
 * le modèle n'a rien de sérieux à dire, il vaut mieux ne rien dire ». Un
 * intervalle P10–P90 dont la largeur dépasse `ratioMaxBp` fois la médiane est
 * déclaré INEXPLOITABLE — l'écran doit alors dire qu'il n'a rien de fiable à
 * annoncer plutôt que d'afficher trois nombres qui se déguisent en prévision.
 *
 * `p50 <= 0` est également inexploitable par construction (division par zéro
 * évitée, jamais un `Infinity` qui passerait pour une largeur légitime).
 */
export function intervalleExploitable(
  p10: number,
  p50: number,
  p90: number,
  ratioMaxBp: number,
): boolean {
  if (!Number.isFinite(p50) || p50 <= 0) return false;
  if (!Number.isFinite(p10) || !Number.isFinite(p90)) return false;
  const largeurRelativeBp = ((p90 - p10) / p50) * BASE_POINTS;
  return largeurRelativeBp <= ratioMaxBp;
}
