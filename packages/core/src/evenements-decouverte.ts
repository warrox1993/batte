/**
 * Découverte automatique d'événements (fiche `docs/demandes/05-EVENEMENTS-DECOUVERTE-IA-RAYON-REGLABLE.md`).
 *
 * Logique PURE et testée : aucun accès réseau, aucun accès base. L'appel à
 * Claude et la persistance vivent respectivement dans `apps/api` et
 * `packages/db` — voir le rapport de livraison pour la répartition exacte.
 *
 * Rappel de la règle la plus importante du projet (CLAUDE.md §3 règle 2) :
 * **un LLM ne calcule jamais**. Claude propose un événement (nom, date, lieu
 * approximatif, portée et intensité initiales, source) ; l'estimation de
 * rentabilité prévisionnelle ci-dessous est ENTIÈREMENT déterministe et
 * réutilise les mêmes règles que le facteur événement du moteur de prévision
 * (`docs/03-MOTEUR-PREVISION.md` §« Facteur 3 — Événements ») :
 *
 *     f_événement = 1 + portée × intensité × 0,05
 *
 * Cette formule n'existait encore nulle part sous forme de fonction pure :
 * `packages/db/src/depots/previsions.ts` stocke `impactEstimeBp` tel que
 * fourni par l'appelant (saisie manuelle libre dans `apps/web/src/pages/Evenements.tsx`,
 * en écart % ou en multiplicateur) sans jamais dériver ce chiffre de la
 * portée et de l'intensité. Ce fichier l'implémente pour la première fois.
 */

import { BASE_POINTS, type Centimes, type PointsDeBase } from './argent.js';
import { ErreurMetier } from './erreurs.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Rayon de recherche — domaine fermé (fiche 05)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Valeurs admises pour `lieu_marche.rayon_recherche_evenements_km`, défaut 20. */
export const DOMAINE_RAYON_RECHERCHE_KM = [5, 10, 15, 20, 40, 100] as const;

export type RayonRechercheKm = (typeof DOMAINE_RAYON_RECHERCHE_KM)[number];

export function estRayonRechercheValide(valeur: number): valeur is RayonRechercheKm {
  return (DOMAINE_RAYON_RECHERCHE_KM as readonly number[]).includes(valeur);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Facteur événement — docs/03 §« Facteur 3 — Événements »
   ═══════════════════════════════════════════════════════════════════════════ */

/** Portée d'un événement. Mêmes valeurs que la colonne `evenement.portee`. */
export type PorteeEvenement = 'national' | 'liege' | 'quartier';

/**
 * Coefficients de portée et pente d'intensité — RÉGLABLES via la table
 * `parametre` (CLAUDE.md §7), jamais codés en dur : `evenement_coefficient_
 * portee_{quartier,liege,national}_bp` et `evenement_pente_intensite_bp`
 * (`packages/core/src/parametres.ts`). Ce module reste une fonction PURE
 * (CLAUDE.md §3 règle 1) : il ne lit jamais la base lui-même, la résolution
 * de `Parametres` vers ce `Config*` se fait à la frontière, dans le dépôt
 * (`packages/db/src/depots/evenements-decouverte.ts`) — même motif que
 * `ConfigSessionConsecutive` (`packages/core/src/prevision/session-consecutive.ts`).
 *
 * Valeurs par défaut du catalogue = docs/03 énoncé littéralement :
 * « portée ∈ { quartier: 1,0 ; liège: 0,6 ; national: 0,3 } », soit en
 * points de base { quartier: 10000, liège: 6000, national: 3000 }.
 */
export type ConfigFacteurEvenement = {
  /** Coefficients de portée, en points de base (10000 = ×1,00). */
  readonly coefficientPorteeBp: Readonly<Record<PorteeEvenement, PointsDeBase>>;
  /** Pente de la formule « 1 + portée × intensité × pente », en points de base (500 = 0,05). */
  readonly penteIntensiteBp: PointsDeBase;
};

/**
 * Facteur événement, calculé à partir de la portée et de l'intensité —
 * littéralement `1 + portée × intensité × pente` (docs/03, pente = 0,05
 * par défaut au catalogue).
 *
 * Retourné en points de base pour rester dans la même unité que
 * `evenement.impact_estime_bp` et que `FacteursPrevision.evenementBp`
 * (`packages/core/src/prevision/moteur.ts`).
 */
export function facteurEvenementDepuisPorteeIntensite(
  portee: PorteeEvenement,
  intensiteEstimee: number,
  config: ConfigFacteurEvenement,
): PointsDeBase {
  if (!Number.isInteger(intensiteEstimee) || intensiteEstimee < 1 || intensiteEstimee > 5) {
    throw new ErreurMetier(
      'intensite_evenement_invalide',
      `L'intensité d'un événement doit être un entier de 1 à 5 (reçu : ${intensiteEstimee}).`,
    );
  }

  const coefficientPortee = config.coefficientPorteeBp[portee] / BASE_POINTS;
  const penteIntensite = config.penteIntensiteBp / BASE_POINTS;
  const facteur = 1 + coefficientPortee * intensiteEstimee * penteIntensite;
  return Math.round(facteur * BASE_POINTS);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Décote par distance — le « piège » signalé par la fiche 05
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Seuils de la décote par distance — RÉGLABLES via la table `parametre`
 * (CLAUDE.md §7) : `evenement_distance_sans_decote_km`,
 * `evenement_distance_decote_max_km`, `evenement_distance_plancher_bp`
 * (`packages/core/src/parametres.ts`). Résolu à la frontière par le dépôt,
 * jamais lu directement ici (même motif que `ConfigFacteurEvenement`
 * ci-dessus).
 *
 * Valeurs par défaut du catalogue = comportement historique de ce module :
 * en dessous de 10 km, aucune décote ; au-delà de 100 km (le rayon maximal
 * réglable, fiche 05), la décote atteint son plancher de 2 000 bp (20 %) et
 * n'empire plus — un événement lointain garde un résidu d'effet plutôt que
 * de tomber à zéro : rien ne prouve qu'il est SANS AUCUN effet, seulement
 * qu'il en a moins.
 */
export type ConfigDecoteDistanceEvenement = {
  /** En dessous de ce seuil (km), aucune décote. */
  readonly distanceSansDecoteKm: number;
  /** Au-delà de ce seuil (km), la décote atteint son plancher et n'empire plus. */
  readonly distanceDecoteMaxKm: number;
  /** Poids résiduel au-delà de `distanceDecoteMaxKm`, en points de base. */
  readonly distancePlancherBp: PointsDeBase;
};

/**
 * Décroissance de l'effet d'un événement avec la distance, en points de base
 * (10 000 = aucune décote).
 *
 * La fiche 05 est explicite : le rayon de recherche ne dit PAS « Wallonie ».
 * Un rayon de 100 km autour de Liège atteint Maastricht et Aix-la-Chapelle,
 * et docs/03 ne modélise la « portée » qu'en trois paliers qualitatifs
 * (quartier/Liège/national) qui ne distinguent pas 5 km de 90 km. Cette
 * fonction ajoute la décote EXPLICITE que la fiche anticipe comme nécessaire
 * « si l'expérience montre que la portée seule ne suffit pas ».
 *
 * Linéaire entre les deux seuils, plancher au-delà — pas un filtre régional :
 * la décote ne connaît AUCUNE frontière administrative, seulement des
 * kilomètres à vol d'oiseau.
 */
export function facteurDistanceDecayBp(
  distanceKm: number,
  config: ConfigDecoteDistanceEvenement,
): PointsDeBase {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new ErreurMetier(
      'distance_evenement_invalide',
      `La distance d'un événement doit être un nombre positif ou nul (reçu : ${distanceKm}).`,
    );
  }

  if (distanceKm <= config.distanceSansDecoteKm) return BASE_POINTS;

  const pente =
    (BASE_POINTS - config.distancePlancherBp) /
    (config.distanceDecoteMaxKm - config.distanceSansDecoteKm);
  const valeur = BASE_POINTS - pente * (distanceKm - config.distanceSansDecoteKm);
  return Math.round(Math.max(config.distancePlancherBp, valeur));
}

/* ═══════════════════════════════════════════════════════════════════════════
   Rentabilité prévisionnelle — surcroît de marge attendu
   ═══════════════════════════════════════════════════════════════════════════ */

export type EntreeRentabiliteEvenement = {
  /** Baseline de fréquentation du LIEU concerné (crêpes/session « normale »). */
  readonly baselineCrepes: number;
  /** Facteur événement AVANT décote de distance (portée × intensité). */
  readonly impactEstimeBp: PointsDeBase;
  /** Distance à vol d'oiseau entre le lieu et l'événement, en kilomètres. */
  readonly distanceKm: number;
  /** Marge unitaire moyenne par crêpe (prix moyen − coût matière), en centimes. */
  readonly margeUnitaireCents: Centimes;
};

/**
 * Surcroît de marge ATTENDU si l'événement se confirme, en centimes — signé :
 * un événement négatif (grève, travaux, alerte météo rouge) rend une valeur
 * négative, exactement comme docs/03 le prévoit pour le facteur événement
 * lui-même (« facteur < 1, saisi directement »).
 *
 * Reprend la même logique que « nombre de crêpes supplémentaires estimées ×
 * marge unitaire moyenne » (fiche 05), mais applique la décote de distance
 * seulement à l'EXCÈS par rapport à la neutralité (`f = 1`) : un lieu sans
 * aucun événement a un facteur neutre quelle que soit la distance à laquelle
 * on aurait pu chercher, donc la décote ne doit s'appliquer qu'à ce que
 * l'événement AJOUTE ou RETIRE, jamais au niveau de base.
 */
export function rentabiliteEstimeeCents(
  entree: EntreeRentabiliteEvenement,
  configDecote: ConfigDecoteDistanceEvenement,
): Centimes {
  const decoteBp = facteurDistanceDecayBp(entree.distanceKm, configDecote);
  const excesBp = entree.impactEstimeBp - BASE_POINTS;
  const excesEffectifBp = (excesBp * decoteBp) / BASE_POINTS;
  const surcroitCrepes = (entree.baselineCrepes * excesEffectifBp) / BASE_POINTS;
  return Math.round(surcroitCrepes * entree.margeUnitaireCents);
}

/** Trie une liste de propositions par rentabilité prévue DÉCROISSANTE (fiche 05). */
export function trierParRentabiliteDecroissante<T extends { rentabiliteEstimeeCents: number }>(
  propositions: readonly T[],
): T[] {
  return [...propositions].sort((a, b) => b.rentabiliteEstimeeCents - a.rentabiliteEstimeeCents);
}

/* Le lieu, la distance, la commune et le rejet d'une proposition IA vivaient
 * ici, encodés dans `evenement.notes` par un format texte fixe
 * (`encoderNotesPropositionIa` / `decoderNotesPropositionIa`) et un marqueur
 * de rejet ajouté au même champ, faute de colonnes dédiées. La migration
 * `0013_bright_millenium_guard.sql` a ajouté `evenement.lieu_id`,
 * `distance_km`, `commune_texte` et `rejete_le` : `packages/db/src/depots/
 * evenements-decouverte.ts` lit et écrit désormais ces colonnes directement,
 * et `notes` est redevenu un commentaire libre, sans aucune donnée
 * structurée. Ces fonctions d'encodage/décodage et le marqueur de rejet ont
 * été supprimés — du code mort qui décoderait un format qu'on n'écrit plus
 * serait un piège pour le prochain lecteur. */
