/**
 * Facteur 4 de docs/03 : effet du MOIS de l'annee, independamment de la meteo
 * du jour (tourisme, vacances scolaires, Chandeleur, habitudes de sortie).
 *
 * docs/17 fiche 3 : `packages/db/src/depots/previsions.ts` ecrit `saisonBp:
 * BASE_POINTS` EN DUR sur toutes les observations — jamais mesure. L'ecran
 * affichait alors « Saison × 1,00 », ce qui se lit « la saisonnalite a ete
 * evaluee et jugee neutre » alors qu'elle n'a jamais ete evaluee. C'est
 * exactement le defaut que D-059 a deja corrige pour la meteo (docs/15 §1.2,
 * §1.4) : ce module applique le MEME mecanisme — mesure, puis validation
 * croisee leave-one-out AVANT d'entrer dans le calcul
 * (`apps/api/src/routes/previsions.ts`, `validerParLeaveOneOut`).
 *
 * MEME PATRON que `jourSemaineBp` (predicteur 2 de docs/demandes/07 §2) :
 * facteur multiplicatif du mois cible relatif a la moyenne generale ponderee
 * de TOUS les mois confondus. Seule la clef de regroupement change — mois de
 * l'annee au lieu de jour de la semaine.
 *
 * AUCUN PRIOR NON NEUTRE. Contrairement a la meteo, docs/03 ne documente
 * aucune hypothese experte par mois pour La Batte : en inventer une (un
 * coefficient de decembre devine, par exemple) serait exactement le defaut
 * que la regle « aucun prior non neutre » interdit — « un chiffre devine est
 * indiscernable d'une mesure une fois en base ». Tant que l'historique n'a pas
 * assez d'observations POUR CE MOIS, ou pas assez de MOIS DISTINCTS pour
 * comparer, le facteur reste `BASE_POINTS` (neutre) et `actif` vaut faux —
 * l'appelant doit alors afficher « non modelisee », jamais « × 1,00 ».
 *
 * CONTAMINATION LEAVE-ONE-OUT (docs/05-DECISIONS.md D-089) : ce module portait
 * sa propre fonction de ponderation temporelle (`poidsRecence`), dupliquee de
 * `poidsTemporel` (baseline.ts) et — a la difference de celle-ci depuis
 * D-089 — jamais filtree par date. `calculerSaisonRetenue`
 * (facteurs-retenus.ts) appelle `saisonBp` DANS la validation croisee
 * leave-one-out (`validerParLeaveOneOut`), avec un historique qui exclut la
 * session ciblee PAR INDEX, donc qui peut encore contenir des sessions
 * POSTERIEURES a elle. `poidsRecence` donnait alors le poids maximal (1) a
 * ces sessions futures — meme defaut de fond que celui corrige dans
 * `calculerBaseline`, actif ici puisque `calculerSaisonRetenue` est appelee
 * pour CHAQUE prevision reelle (`apps/api/src/routes/previsions.ts`), pas
 * seulement en test. Corrige en partageant `ageEnJours`/`poidsTemporel` de
 * `baseline.ts` (meme formule, meme demi-vie de catalogue aujourd'hui) ET en
 * excluant les sessions futures AVANT tout calcul — y compris avant les
 * seuils d'activation (`moisDistinctsMinimum`, `observationsMinimum`), qui
 * lisaient auparavant le meme historique non filtre. La VALEUR de demi-vie
 * reste un champ propre a `ConfigSaison` (parametrable independamment de
 * celle de la baseline si un jour necessaire) : seul le CALCUL est partage.
 */

import type { PointsDeBase } from '../argent.js';
import { BASE_POINTS } from '../argent.js';
import {
  ageEnJours,
  normaliserObservation,
  poidsTemporel,
  type ObservationSession,
} from './baseline.js';

export type ConfigSaison = {
  /** Nombre minimal d'observations POUR LE mois cible pour en estimer l'effet propre. */
  readonly observationsMinimum: number;
  /**
   * Nombre de mois DISTINCTS devant etre representes dans tout l'historique
   * pour qu'un « effet du mois » ait un sens. Avec un ou deux mois
   * representes (les tout premiers marches), il n'existe presque aucune
   * variation inter-mois a mesurer — meme raisonnement que
   * `ConfigJourSemaine.joursDistinctsMinimum`.
   */
  readonly moisDistinctsMinimum: number;
  /** Decroissance par recence, en jours — meme famille que la baseline generale. */
  readonly demiVieJours: number;
};

export type ResultatSaison = {
  readonly actif: boolean;
  /** Neutre (10000) tant que `actif` est faux : jamais de valeur inventee. */
  readonly facteurBp: PointsDeBase;
  readonly mois: number; // 1 (janvier) a 12 (decembre)
  readonly nbMoisDistinctsObserves: number;
  readonly nbObservationsMoisCible: number;
  /** `null` tant que `actif` est faux : rien a afficher dans la decomposition. */
  readonly explication: string | null;
};

const LIBELLE_MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** Mois civil (1-12) d'une date `AAAA-MM-JJ`, ou `Number.NaN` si illisible. */
function moisDeAnnee(date: string): number {
  const mois = Number(date.slice(5, 7));
  return Number.isFinite(mois) && mois >= 1 && mois <= 12 ? mois : Number.NaN;
}

/**
 * Facteur multiplicatif « saison », relatif a la moyenne generale ponderee de
 * TOUS les mois confondus — meme construction que `jourSemaineBp`.
 */
export function saisonBp(
  observations: readonly ObservationSession[],
  dateCible: string,
  config: ConfigSaison,
): ResultatSaison {
  const moisCible = moisDeAnnee(dateCible);
  const inactif = (moisDistincts: number, observationsCible: number): ResultatSaison => ({
    actif: false,
    facteurBp: BASE_POINTS,
    mois: moisCible,
    nbMoisDistinctsObserves: moisDistincts,
    nbObservationsMoisCible: observationsCible,
    explication: null,
  });

  if (!Number.isFinite(moisCible)) return inactif(0, 0);

  // Une session datee APRES (ou le meme jour que) `dateCible` n'existe pas
  // encore pour ce calcul : meme exclusion, et pour la meme raison, que
  // `calculerBaseline` (baseline.ts) — en validation croisee leave-one-out
  // (`calculerSaisonRetenue`, facteurs-retenus.ts), l'historique transmis
  // exclut la session ciblee mais peut encore contenir des sessions
  // POSTERIEURES a elle. Filtree AVANT tout calcul, y compris avant les
  // seuils d'activation ci-dessous : une session future ne doit ni faire
  // basculer « actif » ni peser dans les moyennes. Une date ILLISIBLE reste
  // conservee (age NaN), au poids neutre, exactement comme dans baseline.ts.
  const observationsRetenues = observations
    .map((observation) => ({ observation, age: ageEnJours(observation.dateSession, dateCible) }))
    .filter(({ age }) => !Number.isFinite(age) || age > 0);

  const moisDistincts = new Set(
    observationsRetenues.map(({ observation }) => moisDeAnnee(observation.dateSession)),
  );
  const observationsDuMoisCible = observationsRetenues.filter(
    ({ observation }) => moisDeAnnee(observation.dateSession) === moisCible,
  );

  if (moisDistincts.size < config.moisDistinctsMinimum) {
    return inactif(moisDistincts.size, observationsDuMoisCible.length);
  }
  if (observationsDuMoisCible.length < config.observationsMinimum) {
    return inactif(moisDistincts.size, observationsDuMoisCible.length);
  }

  let sommePoidsGlobale = 0;
  let sommePondereeGlobale = 0;
  let sommePoidsCible = 0;
  let sommePondereeCible = 0;

  for (const { observation, age } of observationsRetenues) {
    const poids = poidsTemporel(age, config.demiVieJours);
    const valeur = normaliserObservation(observation);
    sommePoidsGlobale += poids;
    sommePondereeGlobale += poids * valeur;
    if (moisDeAnnee(observation.dateSession) === moisCible) {
      sommePoidsCible += poids;
      sommePondereeCible += poids * valeur;
    }
  }

  // `sommePoidsGlobale`/`sommePoidsCible` sont strictement positifs des qu'il
  // existe au moins une observation (le poids de recence ne rend jamais 0) —
  // garanti ici par les deux gardes ci-dessus.
  const moyenneGlobale = sommePondereeGlobale / sommePoidsGlobale;
  const moyenneCible = sommePondereeCible / sommePoidsCible;

  if (moyenneGlobale <= 0) {
    return inactif(moisDistincts.size, observationsDuMoisCible.length);
  }

  const facteurBp = Math.round((moyenneCible / moyenneGlobale) * BASE_POINTS);
  const libelle = LIBELLE_MOIS[moisCible - 1] ?? `mois ${moisCible}`;

  return {
    actif: true,
    facteurBp,
    mois: moisCible,
    nbMoisDistinctsObserves: moisDistincts.size,
    nbObservationsMoisCible: observationsDuMoisCible.length,
    explication: `Saison (${libelle}, ${observationsDuMoisCible.length} session${observationsDuMoisCible.length > 1 ? 's' : ''} observée${observationsDuMoisCible.length > 1 ? 's' : ''}) : × ${(facteurBp / BASE_POINTS).toFixed(2).replace('.', ',')}.`,
  };
}
