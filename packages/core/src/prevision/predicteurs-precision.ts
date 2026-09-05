/**
 * Prédicteurs de précision (docs/demandes/07 §2), DÉPLACÉS depuis
 * `apps/api/src/routes/previsions.ts` (`docs/26-AUDIT-DIX-REGLES.md`, règle 1 :
 * la validation croisée leave-one-out qui décide si un prédicteur peut
 * influencer la prévision vivait dans un handler HTTP — testée uniquement par
 * intégration, jamais unitairement, et absente du calcul de couverture de
 * `packages/core`).
 *
 * DÉPLACEMENT SEUL : aucune formule n'a changé. Ce module compose les cinq
 * prédicteurs déjà purs de `docs/demandes/07 §2` (`comparable-calendaire.ts`,
 * `jour-semaine.ts`, `vacances-scolaires.ts`, `session-consecutive.ts`,
 * `ecart-meteo-prevue-realisee.ts`) et ne les laisse influencer le calcul
 * qu'après avoir prouvé, par validation croisée leave-one-out
 * (`validation-croisee.ts`), qu'ils améliorent STRICTEMENT le MAPE du modèle
 * qui les ignore : « un prédicteur qui n'améliore pas le MAPE en leave-one-out
 * ne doit pas entrer dans le calcul, même s'il paraît sensé » (docs/03).
 *
 * PUR : aucun accès base, aucune horloge lue ici (CLAUDE.md §3 règle 1) —
 * chaque date et chaque observation arrivent en paramètre. `Parametres` est
 * une classe pure (aucun accès base, voir `packages/core/src/parametres.ts`) :
 * la recevoir ici ne viole pas la règle, exactement comme `calculerBaseline`
 * la reçoit déjà.
 */

import { BASE_POINTS, type PointsDeBase } from '../argent.js';
import type { Parametres } from '../parametres.js';
import { calculerBaseline, type ObservationSession } from './baseline.js';
import {
  comparableCalendaireBp,
  type ConfigComparableCalendaire,
} from './comparable-calendaire.js';
import {
  ecartMeteoPrevueRealisee,
  type ConfigEcartMeteo,
  type PaireMeteo,
} from './ecart-meteo-prevue-realisee.js';
import { jourSemaineBp, type ConfigJourSemaine } from './jour-semaine.js';
import {
  sessionConsecutiveBp,
  type ConfigSessionConsecutive,
  type ObservationEcoulement,
} from './session-consecutive.js';
import {
  facteurVacancesScolairesBp,
  type ConfigVacancesScolaires,
  type PeriodeVacances,
} from './vacances-scolaires.js';
import { validerParLeaveOneOut, type Estimateur } from './validation-croisee.js';

/**
 * Un prédicteur une fois passé par la validation croisée : `admis` décide
 * seul si `facteurBp` doit influencer le calcul ET s'afficher.
 *
 * `admis: false` recouvre DEUX cas que l'appelant n'a PAS à distinguer :
 * démarrage à froid (pas assez d'historique) et rejet par validation croisée
 * (historique suffisant, mais le prédicteur n'améliore rien). Dans les deux
 * cas la conséquence est identique — `null` archivé, rien affiché — c'est
 * exactement la distinction que `packages/db/src/schema.ts` documente sur les
 * colonnes `facteur_..._bp` : `NULL` veut dire « n'a pas influencé cette
 * prévision », jamais « neutre ».
 */
export type PredicteurRetenu = {
  readonly admis: boolean;
  readonly facteurBp: PointsDeBase;
  readonly explication: string | null;
};

export const PREDICTEUR_NON_ADMIS: PredicteurRetenu = {
  admis: false,
  facteurBp: BASE_POINTS,
  explication: null,
};

/**
 * Demande estimée pour une session par le modèle DE RÉFÉRENCE — météo,
 * événement et saison de CETTE session, sans aucun des cinq nouveaux
 * prédicteurs. C'est le modèle « sans ce paramètre » que docs/03 demande de
 * battre en validation croisée (comme déjà fait pour météo/saison).
 *
 * `null` si la baseline n'est pas calculable sur cet historique réduit
 * (leave-one-out) : exclut proprement ce point de la comparaison plutôt que
 * de la fausser — même principe que `validerParLeaveOneOut` applique déjà
 * aux points où un estimateur ne se prononce pas.
 */
export function demandeSansNouveauPredicteur(
  historique: readonly ObservationSession[],
  cible: ObservationSession,
  parametres: Parametres,
): number | null {
  const baseline = calculerBaseline(historique, cible.dateSession, parametres).baselineCrepes;
  if (!Number.isFinite(baseline) || baseline <= 0) return null;
  return (
    baseline *
    (cible.meteoBp / BASE_POINTS) *
    (cible.evenementBp / BASE_POINTS) *
    (cible.saisonBp / BASE_POINTS)
  );
}

/**
 * Valide puis retient un des quatre prédicteurs de DEMANDE (comparable
 * calendaire, jour de semaine, vacances scolaires, session consécutive) —
 * l'écart météo prévue/réalisée suit une logique différente, voir
 * `calculerPredicteursPrecision` plus bas.
 *
 * `calculerLive` calcule le prédicteur pour la VRAIE cible, sur l'historique
 * COMPLET : si le prédicteur ne s'appliquerait de toute façon pas aujourd'hui
 * (démarrage à froid pour CETTE date), la validation croisée est sautée —
 * juger un prédicteur qui resterait de toute façon neutre aujourd'hui serait
 * du travail perdu, pas une garantie supplémentaire.
 */
export function validerPredicteurDeDemande<T extends ObservationSession>(
  historiqueComplet: readonly T[],
  dateCible: string,
  minPointsEvalues: number,
  parametres: Parametres,
  calculerLive: (
    historique: readonly T[],
    dateCible: string,
  ) => { actif: boolean; facteurBp: PointsDeBase; explication: string | null },
  estimerAvecPredicteur: Estimateur<T>,
): PredicteurRetenu {
  const live = calculerLive(historiqueComplet, dateCible);
  if (!live.actif) return PREDICTEUR_NON_ADMIS;

  const estimerSansPredicteur: Estimateur<T> = (historique, cible) =>
    demandeSansNouveauPredicteur(historique, cible, parametres);

  const validation = validerParLeaveOneOut(
    historiqueComplet,
    (o) => o.crepesVendues,
    estimerSansPredicteur,
    estimerAvecPredicteur,
    minPointsEvalues,
  );

  return validation.admis
    ? { admis: true, facteurBp: live.facteurBp, explication: live.explication }
    : PREDICTEUR_NON_ADMIS;
}

/**
 * Les cinq prédicteurs, une fois calculés et validés pour la session courante.
 *
 * Nommé `PredicteursPrecisionCalculees` (et non `PredicteursPrecision`) pour
 * ne pas entrer en collision avec `PredicteursPrecision`
 * (`packages/core/src/contrats/previsions.ts`), le type Zod-inféré du
 * CONTRAT HTTP — une forme différente (déjà formatée pour l'API, `admis`
 * absent). Les deux coexistent dans le même barril `@batte/core`.
 */
export type PredicteursPrecisionCalculees = {
  readonly comparableCalendaire: PredicteurRetenu;
  readonly jourSemaine: PredicteurRetenu;
  readonly vacancesScolaires: PredicteurRetenu;
  readonly sessionConsecutive: PredicteurRetenu;
  readonly ecartMeteo: PredicteurRetenu;
};

/**
 * Calcule et valide les cinq prédicteurs de précision pour une session.
 *
 * `baselineGenerale` est celle DÉJÀ calculée par l'appelant (même historique,
 * même date cible) : la réutiliser évite un recalcul redondant et garantit
 * que le prédicteur « comparable calendaire » travaille sur EXACTEMENT le
 * même dénominateur que la prévision affichée.
 */
export function calculerPredicteursPrecision(
  observations: readonly ObservationSession[],
  historiqueEcoulement: readonly ObservationEcoulement[],
  paires: readonly PaireMeteo[],
  periodesVacances: readonly PeriodeVacances[],
  dateCible: string,
  horizonMeteoJours: number,
  baselineGenerale: number,
  parametres: Parametres,
): PredicteursPrecisionCalculees {
  const minPointsEvalues = parametres.entier('prevision_validation_croisee_points_minimum');

  const configComparableCalendaire: ConfigComparableCalendaire = {
    fenetreJours: parametres.entier('prevision_comparable_calendaire_fenetre_jours'),
    ageMinimumJours: parametres.entier('prevision_comparable_calendaire_age_minimum_jours'),
    demiVieAns: parametres.entier('prevision_comparable_calendaire_demi_vie_ans'),
    anneesMinimum: parametres.entier('prevision_comparable_calendaire_annees_minimum'),
  };
  const comparableCalendaire = validerPredicteurDeDemande(
    observations,
    dateCible,
    minPointsEvalues,
    parametres,
    (historique, cible) =>
      comparableCalendaireBp(historique, cible, baselineGenerale, configComparableCalendaire),
    (historique, cible) => {
      const baselineHist = calculerBaseline(
        historique,
        cible.dateSession,
        parametres,
      ).baselineCrepes;
      if (!Number.isFinite(baselineHist) || baselineHist <= 0) return null;
      const resultat = comparableCalendaireBp(
        historique,
        cible.dateSession,
        baselineHist,
        configComparableCalendaire,
      );
      if (!resultat.actif) return null;
      return (
        baselineHist *
        (cible.meteoBp / BASE_POINTS) *
        (cible.evenementBp / BASE_POINTS) *
        (cible.saisonBp / BASE_POINTS) *
        (resultat.facteurBp / BASE_POINTS)
      );
    },
  );

  const configJourSemaine: ConfigJourSemaine = {
    observationsMinimum: parametres.entier('prevision_jour_semaine_observations_minimum'),
    joursDistinctsMinimum: parametres.entier('prevision_jour_semaine_jours_distincts_minimum'),
    demiVieJours: parametres.entier('prevision_demi_vie_ponderation_jours'),
  };
  const jourSemaine = validerPredicteurDeDemande(
    observations,
    dateCible,
    minPointsEvalues,
    parametres,
    (historique, cible) => jourSemaineBp(historique, cible, configJourSemaine),
    (historique, cible) => {
      const sans = demandeSansNouveauPredicteur(historique, cible, parametres);
      if (sans === null) return null;
      const resultat = jourSemaineBp(historique, cible.dateSession, configJourSemaine);
      if (!resultat.actif) return null;
      return sans * (resultat.facteurBp / BASE_POINTS);
    },
  );

  const configVacances: ConfigVacancesScolaires = {
    observationsMinimum: parametres.entier('prevision_vacances_observations_minimum'),
    demiVieJours: parametres.entier('prevision_demi_vie_ponderation_jours'),
  };
  const vacancesScolaires = validerPredicteurDeDemande(
    observations,
    dateCible,
    minPointsEvalues,
    parametres,
    (historique, cible) =>
      facteurVacancesScolairesBp(historique, cible, periodesVacances, configVacances),
    (historique, cible) => {
      const sans = demandeSansNouveauPredicteur(historique, cible, parametres);
      if (sans === null) return null;
      const resultat = facteurVacancesScolairesBp(
        historique,
        cible.dateSession,
        periodesVacances,
        configVacances,
      );
      if (!resultat.actif) return null;
      return sans * (resultat.facteurBp / BASE_POINTS);
    },
  );

  const configSessionConsecutive: ConfigSessionConsecutive = {
    ecartMaxJours: parametres.entier('prevision_session_consecutive_ecart_max_jours'),
    seuilRuptureBp: parametres.entier('prevision_session_consecutive_seuil_rupture_bp'),
    seuilInvenduImportantBp: parametres.entier('prevision_session_consecutive_seuil_invendu_bp'),
    occurrencesMinimum: parametres.entier('prevision_session_consecutive_occurrences_minimum'),
    demiVieJours: parametres.entier('prevision_demi_vie_ponderation_jours'),
  };
  const sessionConsecutive = validerPredicteurDeDemande(
    historiqueEcoulement,
    dateCible,
    minPointsEvalues,
    parametres,
    (historique, cible) => sessionConsecutiveBp(historique, cible, configSessionConsecutive),
    (historique, cible) => {
      const sans = demandeSansNouveauPredicteur(historique, cible, parametres);
      if (sans === null) return null;
      const resultat = sessionConsecutiveBp(
        historique,
        cible.dateSession,
        configSessionConsecutive,
      );
      if (!resultat.actif) return null;
      return sans * (resultat.facteurBp / BASE_POINTS);
    },
  );

  // --- Écart météo prévue/réalisée : logique DIFFÉRENTE, volontairement --
  // Ce prédicteur ne produit aucune estimation de DEMANDE (il ne change que
  // la largeur de l'intervalle P10/P90) : le comparer par MAPE via
  // `validerParLeaveOneOut` n'a pas de sens — l'estimation du point médian
  // serait rigoureusement IDENTIQUE avec ou sans lui, donc son
  // « amélioration » vaudrait toujours zéro par construction, et il ne
  // serait donc jamais admis, quelle que soit la qualité réelle de sa
  // calibration. Son propre seuil d'échantillon
  // (`prevision_ecart_meteo_paires_minimum`, dans `ecartMeteoPrevueRealisee`)
  // joue ici le même rôle de garde-fou que la validation croisée pour les
  // quatre autres : refuser de répondre plutôt que de répondre sur trop peu
  // de couples (prévu, réalisé). Déviation assumée, voir le rapport de
  // livraison.
  const configEcartMeteo: ConfigEcartMeteo = {
    pairesMinimum: parametres.entier('prevision_ecart_meteo_paires_minimum'),
    echelleTemperatureC: parametres.decimal('prevision_ecart_meteo_echelle_temperature_c'),
    horizonReferenceJours: parametres.entier('prevision_ecart_meteo_horizon_reference_jours'),
    inflationMaxBp: parametres.entier('prevision_ecart_meteo_inflation_max_bp'),
  };
  const resultatEcartMeteo = ecartMeteoPrevueRealisee(paires, horizonMeteoJours, configEcartMeteo);
  const ecartMeteo: PredicteurRetenu = resultatEcartMeteo.actif
    ? {
        admis: true,
        facteurBp: resultatEcartMeteo.inflationSigmaBp,
        explication: resultatEcartMeteo.explication,
      }
    : PREDICTEUR_NON_ADMIS;

  return { comparableCalendaire, jourSemaine, vacancesScolaires, sessionConsecutive, ecartMeteo };
}
