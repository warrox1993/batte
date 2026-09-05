/**
 * Predicteur 1 de docs/demandes/07 §2 : comparable historique du meme jour
 * calendaire, pondere par l'anciennete.
 *
 * « Les ventes du même jour de l'année précédente (et des années antérieures
 * si disponibles), pondérées par leur ancienneté, comme point de comparaison
 * direct — utile en particulier pour les jours à forte saisonnalité
 * (Chandeleur, période estivale). »
 *
 * Distinct du facteur SAISON de docs/03 (moyenne mobile mensuelle, phase 2 a
 * `n >= 40`) : celui-ci regarde un MOIS entier, celui-la un JOUR precis,
 * repete d'ANNEE en annee. La Chandeleur (2 fevrier) peut avoir un effet que
 * la moyenne de fevrier entier dilue completement.
 *
 * PUR : aucun acces reseau ni base. Comme `calculerBaseline`, ce module ne
 * fait que composer des `ObservationSession` deja normalisees.
 *
 * AUDIT CONTAMINATION LEAVE-ONE-OUT (docs/05-DECISIONS.md D-089) : contrairement
 * a `saison.ts`, `jour-semaine.ts`, `vacances-scolaires.ts` et
 * `session-consecutive.ts` (meme defaut trouve et corrige dans les quatre —
 * voir le rapport de livraison), ce module N'A PAS besoin du meme correctif.
 * `observationsComparables` ci-dessous exclut deja toute observation dont
 * `age < config.ageMinimumJours` (catalogue : 250 jours par defaut) — et un
 * age NEGATIF (session POSTERIEURE a `dateCible`, le cas leave-one-out) est
 * TOUJOURS strictement inferieur a un seuil positif, donc TOUJOURS exclu par
 * cette meme garde, sans modification. Verifie explicitement, pas suppose.
 * Nuance assumee : cette protection depend de `ageMinimumJours` restant
 * positif au catalogue (ce qui est son sens meme : « assez ancien pour ne pas
 * doublonner la recence »), pas d'une garantie structurelle independante du
 * parametre — a la difference de `baseline.ts`/`tendance.ts` dont l'exclusion
 * ne depend d'aucune valeur de configuration.
 *
 * `poidsTemporel` (baseline.ts) n'a PAS ete reutilise ici, deliberement :
 * la demi-vie de ce module se lit en ANNEES (`config.demiVieAns`), celle de
 * la baseline en JOURS — deux echelles de temps differentes pour deux
 * besoins differents (comparer un jour calendaire d'une annee sur l'autre,
 * contre ponderer des sessions recentes). Partager la formule (`0.5 **
 * exposant`) sans partager l'unite de l'exposant n'aurait rien simplifie ;
 * les deux implementations restent volontairement distinctes.
 */

import type { PointsDeBase } from '../argent.js';
import { BASE_POINTS } from '../argent.js';
import { ageJours, anneeCivile, ecartCalendaireJours } from './calendrier.js';
import { normaliserObservation, type ObservationSession } from './baseline.js';

export type ConfigComparableCalendaire = {
  /** Tolerance, en jours, autour du jour calendaire cible (docs/demandes/07). */
  readonly fenetreJours: number;
  /**
   * Age minimal, en jours, pour qu'une observation compte comme « année
   * antérieure » plutôt que comme de la récence déjà captée par la baseline
   * bayésienne et la tendance. Sans ce plancher, prévoir un dimanche d'août
   * verrait le dimanche d'août PRÉCÉDENT (huit jours plus tôt) compter deux
   * fois : une fois ici, une fois dans la baseline pondérée par récence.
   */
  readonly ageMinimumJours: number;
  /** Décroissance par ancienneté, en ANNÉES (pas en semaines comme la baseline générale). */
  readonly demiVieAns: number;
  /** Nombre d'années civiles distinctes exigées pour que le prédicteur s'active. */
  readonly anneesMinimum: number;
};

export type ResultatComparableCalendaire = {
  readonly actif: boolean;
  /** Neutre (10000) tant que `actif` est faux : jamais de valeur inventée. */
  readonly facteurBp: PointsDeBase;
  readonly nbAnneesDistinctes: number;
  readonly nbObservationsRetenues: number;
  /** `null` tant que `actif` est faux : rien à afficher dans la décomposition. */
  readonly explication: string | null;
};

const INACTIF: Omit<ResultatComparableCalendaire, 'nbAnneesDistinctes' | 'nbObservationsRetenues'> =
  {
    actif: false,
    facteurBp: BASE_POINTS,
    explication: null,
  };

/**
 * Observations dont le jour calendaire est proche de la cible ET assez
 * anciennes pour ne pas doublonner la récence déjà captée ailleurs.
 */
function observationsComparables(
  observations: readonly ObservationSession[],
  dateCible: string,
  config: ConfigComparableCalendaire,
): { readonly observation: ObservationSession; readonly poids: number }[] {
  const retenues: { observation: ObservationSession; poids: number }[] = [];

  for (const observation of observations) {
    const ecartCalendaire = ecartCalendaireJours(dateCible, observation.dateSession);
    const age = ageJours(dateCible, observation.dateSession);
    if (!Number.isFinite(ecartCalendaire) || !Number.isFinite(age)) continue;
    if (ecartCalendaire > config.fenetreJours) continue;
    if (age < config.ageMinimumJours) continue;

    const ageAns = age / 365;
    const poids = 0.5 ** (ageAns / config.demiVieAns);
    retenues.push({ observation, poids });
  }

  return retenues;
}

/**
 * Facteur multiplicatif « comparable calendaire », relatif a la baseline
 * generale — composable dans la chaine multiplicative de `moteur.ts` au meme
 * titre que meteo/evenement/saison/tendance.
 *
 * `baselineGenerale` doit venir de `calculerBaseline` sur le MEME historique :
 * c'est le denominateur qui transforme une moyenne pondérée en facteur.
 */
export function comparableCalendaireBp(
  observations: readonly ObservationSession[],
  dateCible: string,
  baselineGenerale: number,
  config: ConfigComparableCalendaire,
): ResultatComparableCalendaire {
  if (!Number.isFinite(baselineGenerale) || baselineGenerale <= 0) {
    return { ...INACTIF, nbAnneesDistinctes: 0, nbObservationsRetenues: 0 };
  }

  const retenues = observationsComparables(observations, dateCible, config);
  const annees = new Set(retenues.map((r) => anneeCivile(r.observation.dateSession)));

  if (annees.size < config.anneesMinimum) {
    return { ...INACTIF, nbAnneesDistinctes: annees.size, nbObservationsRetenues: retenues.length };
  }

  let sommePoids = 0;
  let sommePonderee = 0;
  for (const { observation, poids } of retenues) {
    sommePoids += poids;
    sommePonderee += poids * normaliserObservation(observation);
  }
  // `annees.size >= config.anneesMinimum >= 1` garantit `retenues.length >= 1`,
  // donc `sommePoids > 0` (chaque poids est strictement positif) : la division
  // qui suit ne peut pas se faire par zéro.
  const moyenneComparable = sommePonderee / sommePoids;

  const facteurBp = Math.round((moyenneComparable / baselineGenerale) * BASE_POINTS);
  const anneesTriees = [...annees].sort((a, b) => a - b);

  return {
    actif: true,
    facteurBp,
    nbAnneesDistinctes: annees.size,
    nbObservationsRetenues: retenues.length,
    explication:
      `Comparable calendaire (${annees.size} années : ${anneesTriees.join(', ')}) : ` +
      `× ${(facteurBp / BASE_POINTS).toFixed(2).replace('.', ',')}.`,
  };
}
