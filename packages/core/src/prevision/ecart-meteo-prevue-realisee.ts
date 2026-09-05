/**
 * Predicteur 4 de docs/demandes/07 §2 : ecart entre la meteo prevue et la
 * meteo realisee, pour calibrer l'intervalle P10/P90.
 *
 * « Mesurer l'écart entre la météo prévue à J-7 et la météo réellement
 * observée, pour calibrer la confiance à accorder à une prévision météo
 * lointaine dans le calcul de l'intervalle P10/P90. » Ce predicteur ne
 * produit PAS un facteur multiplicatif sur la demande (il ne sait rien dire
 * sur le NIVEAU des ventes) : il produit une INFLATION de `sigma`, appliquee
 * par `moteur.ts` a l'ecart-type log deja retenu — plus l'horizon est
 * lointain et plus l'historique montre que la meteo a J-7 se trompe, plus
 * l'intervalle doit s'elargir.
 *
 * PHASE 1 assumee, dans l'esprit de docs/03 pour les priors meteo : la
 * formule ci-dessous est une heuristique simple et documentee comme telle,
 * pas une estimation empirique de l'incertitude meteo. Elle vit ici plutot
 * que codee en dur dans `moteur.ts` precisement pour pouvoir etre remplacee
 * plus tard sans toucher au moteur.
 */

import type { PointsDeBase } from '../argent.js';
import { BASE_POINTS } from '../argent.js';
import type { ConditionsMeteo } from './meteo.js';
import { ecartType } from './statistiques.js';

/** Un couple (prevision, realise) pour la MEME date et le MEME lieu. */
export type PaireMeteo = {
  readonly prevue: ConditionsMeteo;
  readonly reelle: ConditionsMeteo;
};

export type ConfigEcartMeteo = {
  /** Nombre minimal de couples (prévu, réel) pour mesurer un écart significatif. */
  readonly pairesMinimum: number;
  /** Écart de température (°C) auquel l'échelle d'inflation est calibrée. */
  readonly echelleTemperatureC: number;
  /** Horizon de référence (jours) auquel `echelleTemperatureC` s'applique — docs/03 : J-7. */
  readonly horizonReferenceJours: number;
  /** Plafond de l'inflation, en points de base (10000 = ×1, pas d'inflation). */
  readonly inflationMaxBp: number;
};

export type ResultatEcartMeteo = {
  readonly actif: boolean;
  /** Neutre (10000) tant que `actif` est faux : `sigmaRetenu` n'est alors pas modifié. */
  readonly inflationSigmaBp: PointsDeBase;
  readonly ecartTypeTemperatureC: number | null;
  readonly nbPairesRetenues: number;
  readonly explication: string | null;
};

/**
 * Inflation de `sigma` à appliquer pour une prévision météo faite
 * `horizonJours` à l'avance, calibrée sur l'écart historique prévu/réalisé.
 *
 * `horizonJours` vient de l'APPELANT (le dépôt sait quand le relevé « prévu »
 * a été récupéré) : ce module ne devine jamais un horizon, il le reçoit.
 */
export function ecartMeteoPrevueRealisee(
  paires: readonly PaireMeteo[],
  horizonJours: number,
  config: ConfigEcartMeteo,
): ResultatEcartMeteo {
  const ecarts = paires
    .map((p) => p.reelle.temperatureC - p.prevue.temperatureC)
    .filter((e) => Number.isFinite(e));

  if (ecarts.length < config.pairesMinimum) {
    return {
      actif: false,
      inflationSigmaBp: BASE_POINTS,
      ecartTypeTemperatureC: null,
      nbPairesRetenues: ecarts.length,
      explication: null,
    };
  }

  const sigmaTemperature = ecartType(ecarts);
  if (!Number.isFinite(horizonJours) || horizonJours <= 0 || config.echelleTemperatureC <= 0) {
    return {
      actif: false,
      inflationSigmaBp: BASE_POINTS,
      ecartTypeTemperatureC: sigmaTemperature,
      nbPairesRetenues: ecarts.length,
      explication: null,
    };
  }

  // Heuristique PHASE 1 (voir l'en-tete du module) : l'inflation croit avec
  // l'ecart-type mesure ET avec l'horizon, rapporte a l'horizon de reference
  // documente par docs/03 (J-7). A horizon de reference et ecart-type egal a
  // l'echelle de calibration, l'inflation vaut exactement +100 % (×2),
  // ensuite plafonnee.
  const ratioHorizon = horizonJours / config.horizonReferenceJours;
  const inflationBrute =
    BASE_POINTS + (sigmaTemperature / config.echelleTemperatureC) * ratioHorizon * BASE_POINTS;
  const inflationSigmaBp = Math.round(Math.min(inflationBrute, config.inflationMaxBp));

  return {
    actif: true,
    inflationSigmaBp,
    ecartTypeTemperatureC: sigmaTemperature,
    nbPairesRetenues: ecarts.length,
    explication:
      `Fiabilité météo à J-${Math.round(horizonJours)} (écart-type mesuré ` +
      `${sigmaTemperature.toFixed(1)} °C) : intervalle élargi ×${(inflationSigmaBp / BASE_POINTS).toFixed(2).replace('.', ',')}.`,
  };
}
