/**
 * Predicteur 2 de docs/demandes/07 §2 : effet du jour de la semaine.
 *
 * « Déjà pertinent même à un seul lieu si plusieurs jours de vente s'ajoutent
 * plus tard (foires en semaine). » Tant qu'un seul jour de semaine existe
 * dans l'historique (le cas de La Batte seule, toujours un dimanche), AUCUN
 * effet n'est mesurable : il n'y a rien a comparer. Le predicteur doit alors
 * rester silencieux, pas afficher un facteur neutre qui ferait croire a une
 * mesure.
 *
 * CONTAMINATION LEAVE-ONE-OUT (docs/05-DECISIONS.md D-089) : ce module
 * portait sa propre fonction de ponderation temporelle (`poidsRecence`),
 * dupliquee de `poidsTemporel` (baseline.ts) et — contrairement a
 * `calculerBaseline`, `tendanceBp` — jamais filtree pour exclure les sessions
 * POSTERIEURES a `dateCible`. `calculerPredicteursPrecision`
 * (predicteurs-precision.ts) appelle `jourSemaineBp` A L'INTERIEUR de la
 * validation croisee leave-one-out (`validerParLeaveOneOut`), avec un
 * historique qui exclut la session ciblee PAR INDEX, donc qui peut encore
 * contenir des sessions POSTERIEURES a elle — et `poidsRecence` leur donnait
 * alors le poids maximal (1) au lieu de les exclure. DEFAUT ACTIF ET PROUVE :
 * un signal hebdomadaire reel et fort (10 dimanches a 150 crepes contre 3
 * mercredis a 40) etait REJETE par la validation croisee avant correction —
 * voir `apps/api/src/routes/previsions.test.ts`, « le prédicteur "jour de la
 * semaine" s'active avec assez d'historique », et le rapport de livraison
 * pour la mesure complete. Corrige en partageant `ageEnJours`/`poidsTemporel`
 * de `baseline.ts` (meme formule, meme demi-vie de catalogue aujourd'hui) ET
 * en excluant les sessions futures AVANT tout calcul — y compris avant les
 * seuils d'activation (`joursDistinctsMinimum`, `observationsMinimum`), qui
 * lisaient auparavant le meme historique non filtre. La VALEUR de demi-vie
 * reste un champ propre a `ConfigJourSemaine` : seul le CALCUL est partage.
 */

import type { PointsDeBase } from '../argent.js';
import { BASE_POINTS } from '../argent.js';
import { jourDeSemaine } from './calendrier.js';
import {
  ageEnJours,
  normaliserObservation,
  poidsTemporel,
  type ObservationSession,
} from './baseline.js';

export type ConfigJourSemaine = {
  /** Nombre minimal d'observations pour LE jour de semaine cible, pour en estimer l'effet. */
  readonly observationsMinimum: number;
  /**
   * Nombre de jours de semaine DISTINCTS devant être représentés dans tout
   * l'historique pour qu'un « effet du jour » ait un sens. Avec un seul jour
   * représenté, il n'existe aucune variation inter-jours à mesurer.
   */
  readonly joursDistinctsMinimum: number;
  /** Décroissance par récence, en jours — même famille que la baseline générale. */
  readonly demiVieJours: number;
};

export type ResultatJourSemaine = {
  readonly actif: boolean;
  readonly facteurBp: PointsDeBase;
  readonly jourSemaine: number;
  readonly nbJoursDistinctsObserves: number;
  readonly nbObservationsJourCible: number;
  readonly explication: string | null;
};

const LIBELLE_JOUR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/**
 * Facteur multiplicatif « jour de semaine », relatif a la moyenne generale
 * ponderee de TOUS les jours confondus.
 */
export function jourSemaineBp(
  observations: readonly ObservationSession[],
  dateCible: string,
  config: ConfigJourSemaine,
): ResultatJourSemaine {
  const cibleJour = jourDeSemaine(dateCible);
  const inactif = (joursDistincts: number, observationsCible: number): ResultatJourSemaine => ({
    actif: false,
    facteurBp: BASE_POINTS,
    jourSemaine: cibleJour,
    nbJoursDistinctsObserves: joursDistincts,
    nbObservationsJourCible: observationsCible,
    explication: null,
  });

  // Une session datee APRES (ou le meme jour que) `dateCible` n'existe pas
  // encore pour ce calcul : meme exclusion, et pour la meme raison, que
  // `calculerBaseline` (baseline.ts) — en validation croisee leave-one-out
  // (`calculerPredicteursPrecision`, predicteurs-precision.ts), l'historique
  // transmis exclut la session ciblee mais peut encore contenir des sessions
  // POSTERIEURES a elle. Filtree AVANT tout calcul, y compris avant les
  // seuils d'activation ci-dessous.
  const observationsRetenues = observations
    .map((observation) => ({ observation, age: ageEnJours(observation.dateSession, dateCible) }))
    .filter(({ age }) => !Number.isFinite(age) || age > 0);

  const joursDistincts = new Set(
    observationsRetenues.map(({ observation }) => jourDeSemaine(observation.dateSession)),
  );
  const observationsDuJourCible = observationsRetenues.filter(
    ({ observation }) => jourDeSemaine(observation.dateSession) === cibleJour,
  );

  if (joursDistincts.size < config.joursDistinctsMinimum) {
    return inactif(joursDistincts.size, observationsDuJourCible.length);
  }
  if (observationsDuJourCible.length < config.observationsMinimum) {
    return inactif(joursDistincts.size, observationsDuJourCible.length);
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
    if (jourDeSemaine(observation.dateSession) === cibleJour) {
      sommePoidsCible += poids;
      sommePondereeCible += poids * valeur;
    }
  }

  // `sommePoidsGlobale` et `sommePoidsCible` sont strictement positifs des
  // qu'il existe au moins une observation (le poids de récence ne rend
  // jamais 0) — garanti ici par les deux gardes ci-dessus.
  const moyenneGlobale = sommePondereeGlobale / sommePoidsGlobale;
  const moyenneCible = sommePondereeCible / sommePoidsCible;

  if (moyenneGlobale <= 0) return inactif(joursDistincts.size, observationsDuJourCible.length);

  const facteurBp = Math.round((moyenneCible / moyenneGlobale) * BASE_POINTS);
  const libelle = LIBELLE_JOUR[cibleJour] ?? `jour ${cibleJour}`;

  return {
    actif: true,
    facteurBp,
    jourSemaine: cibleJour,
    nbJoursDistinctsObserves: joursDistincts.size,
    nbObservationsJourCible: observationsDuJourCible.length,
    explication: `Jour de la semaine (${libelle}) : × ${(facteurBp / BASE_POINTS).toFixed(2).replace('.', ',')}.`,
  };
}
