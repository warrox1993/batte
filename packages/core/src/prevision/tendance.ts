/**
 * Facteur 5 de docs/03 : tendance — croissance ou érosion de la clientèle
 * indépendamment du reste (notoriété qui s'installe, clients réguliers,
 * arrivée d'un concurrent).
 *
 * docs/17 fiche 3 : `tendanceBp` n'est jamais fourni par l'appelant et
 * retombe sur le neutre `BASE_POINTS` — un « facteur muet », affiché comme
 * s'il avait été évalué et jugé neutre alors qu'il n'a jamais été calculé.
 * Même défaut de fond que la saison ci-dessus, même correctif : mesurer, puis
 * ne laisser le résultat entrer dans le calcul qu'après validation croisée
 * leave-one-out (`apps/api/src/routes/previsions.ts`, `validerParLeaveOneOut`).
 *
 * docs/03, Facteur 5 : « Régression linéaire sur les 12 dernières sessions
 * normalisées, exprimée en variation mensuelle. Bornée à ±30 % pour éviter
 * qu'une série chanceuse produise une extrapolation absurde. Neutre (1,00)
 * tant que n < 10. » Ces trois chiffres (12, ±30 %, n < 10) sont ceux du
 * document, pas des valeurs inventées — voir `prevision_tendance_fenetre_
 * sessions`, `prevision_tendance_borne_bp` et `prevision_tendance_sessions_
 * minimum` au catalogue.
 */

import type { PointsDeBase } from '../argent.js';
import { BASE_POINTS } from '../argent.js';
import { ageJours } from './calendrier.js';
import { normaliserObservation, type ObservationSession } from './baseline.js';

/** Jours moyens d'un mois (365,25 / 12) — seule unité de temps dans laquelle docs/03 exprime la pente. */
const JOURS_PAR_MOIS = 30.436_875;

export type ConfigTendance = {
  /** docs/03 : « Neutre (1,00) tant que n < 10 ». */
  readonly sessionsMinimum: number;
  /** docs/03 : « régression … sur les 12 dernières sessions ». */
  readonly fenetreSessions: number;
  /** docs/03 : « Bornée à ±30 % ». */
  readonly borneBp: PointsDeBase;
};

export type ResultatTendance = {
  readonly actif: boolean;
  /** Neutre (10000) tant que `actif` est faux : jamais de valeur inventée. */
  readonly facteurBp: PointsDeBase;
  /** Variation mensuelle estimée (10000 = stable, 10500 = +5 %/mois…), avant plafonnement. */
  readonly penteMensuelleBp: PointsDeBase;
  readonly nbSessionsRegression: number;
  /** `null` tant que `actif` est faux : rien à afficher dans la décomposition. */
  readonly explication: string | null;
};

/**
 * Facteur multiplicatif « tendance », extrapolé au temps de `dateCible` à
 * partir d'une régression linéaire sur `log(ventes normalisées)` en fonction
 * du temps, calculée sur la fenêtre des `fenetreSessions` sessions les plus
 * RÉCENTES strictement ANTÉRIEURES à `dateCible`.
 *
 * Le filtre « strictement antérieures » n'est pas un détail : en validation
 * croisée leave-one-out, l'historique transmis exclut la session ciblée mais
 * peut encore contenir des sessions POSTÉRIEURES à elle (le trou laissé par
 * le retrait tombe au milieu d'une série chronologique). Une tendance qui
 * regarderait le futur pour « prédire » le passé ne mesurerait rien de
 * réel — c'est le même principe que la fenêtre prédictive de
 * `point-commande-predictif.ts`, appliqué ici au temps plutôt qu'au stock.
 */
export function tendanceBp(
  observations: readonly ObservationSession[],
  dateCible: string,
  config: ConfigTendance,
): ResultatTendance {
  const inactif = (nbSessions: number): ResultatTendance => ({
    actif: false,
    facteurBp: BASE_POINTS,
    penteMensuelleBp: BASE_POINTS,
    nbSessionsRegression: nbSessions,
    explication: null,
  });

  const anterieures = observations
    .filter((o) => o.dateSession < dateCible)
    .sort((a, b) => (a.dateSession < b.dateSession ? -1 : 1));

  if (anterieures.length < config.sessionsMinimum) return inactif(anterieures.length);

  const fenetre =
    config.fenetreSessions > 0 ? anterieures.slice(-config.fenetreSessions) : anterieures;

  const points = fenetre
    .map((o) => {
      const valeur = normaliserObservation(o);
      // Une session à zéro crêpe (ou un facteur neutralisé nul) n'a pas de
      // logarithme : elle sort de la régression plutôt que de la fausser,
      // même choix que `calculerBaseline` pour ses résidus.
      if (valeur <= 0) return null;
      const t = -ageJours(dateCible, o.dateSession) / JOURS_PAR_MOIS;
      if (!Number.isFinite(t)) return null;
      return { t, y: Math.log(valeur) };
    })
    .filter((p): p is { t: number; y: number } => p !== null);

  if (points.length < config.sessionsMinimum) return inactif(points.length);

  const meanT = points.reduce((s, p) => s + p.t, 0) / points.length;
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
  const varT = points.reduce((s, p) => s + (p.t - meanT) ** 2, 0);

  // Toutes les sessions retenues datent du même jour (fenêtre dégénérée) :
  // aucune pente n'est calculable, ni utile — bien plus rare que le cas
  // symétrique de `jourSemaineBp`, mais la même prudence s'impose.
  if (varT <= 0) return inactif(points.length);

  const covTY = points.reduce((s, p) => s + (p.t - meanT) * (p.y - meanY), 0);
  const pente = covTY / varT; // variation de log(ventes normalisées) par mois

  // Valeur prédite au temps 0 (dateCible), relative à la moyenne de la
  // fenêtre : exp(a − meanY) où a = meanY − pente·meanT est l'ordonnée à
  // l'origine de la régression. `meanT` est négatif (moyenne de dates
  // passées) : une pente positive extrapolée jusqu'à `dateCible` donne donc
  // un facteur > 1, et réciproquement.
  const facteurBrut = Math.exp(-pente * meanT);

  const borne = config.borneBp / BASE_POINTS;
  const facteurBorne = Math.min(1 + borne, Math.max(1 - borne, facteurBrut));
  const facteurBp = Math.round(facteurBorne * BASE_POINTS);
  const penteMensuelleBp = Math.round(Math.exp(pente) * BASE_POINTS);

  const pentePourcent = ((Math.exp(pente) - 1) * 100).toFixed(1).replace('.', ',');
  const direction = pente > 0 ? 'croissance' : pente < 0 ? 'érosion' : 'stable';
  const bornePourcent = Math.round(config.borneBp / 100);

  return {
    actif: true,
    facteurBp,
    penteMensuelleBp,
    nbSessionsRegression: points.length,
    explication:
      `Tendance (${points.length} dernières sessions, ${direction} ≈ ${pentePourcent} %/mois, ` +
      `plafonnée à ±${bornePourcent} %) : × ${(facteurBp / BASE_POINTS).toFixed(2).replace('.', ',')}.`,
  };
}
