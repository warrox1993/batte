/**
 * Facteur météo MESURÉ par catégorie (docs/17 fiches 2/4, décision D-059),
 * DÉPLACÉ depuis `apps/api/src/routes/previsions.ts` (`docs/26-AUDIT-DIX-
 * REGLES.md`, règle 1 : ce calcul vivait dans un handler HTTP, jamais testé
 * unitairement).
 *
 * DÉPLACEMENT SEUL : aucune formule n'a changé. `ensoleille_tiede` et
 * `ensoleille_frais` referment les deux trous de la grille de priors
 * (docs/15 §1.2) avec un prior explicitement NEUTRE (`meteo.ts`) ; ce module
 * est la BOUCLE qui les rend mesurables : une fois qu'une catégorie a
 * accumulé assez de dimanches clos, un facteur MESURÉ est calculé et ne
 * remplace le prior qu'après avoir prouvé, par validation croisée
 * leave-one-out (même garde-fou que les cinq prédicteurs de
 * `predicteurs-precision.ts`), qu'il améliore le MAPE du modèle qui l'ignore.
 * Jamais l'inverse : « on ne remplace pas un prior neutre par du bruit »
 * (D-059).
 *
 * PUR : aucun accès base ici (CLAUDE.md §3 règle 1). `ObservationMeteoBrute`
 * ci-dessous est un MIROIR STRUCTUREL du type de même nom dans
 * `packages/db/src/depots/previsions.ts` — jamais importé de `@batte/db`
 * (interdit dans `packages/core`) : les deux types coïncident par
 * construction, la vérification est structurelle (TypeScript), pas nominale.
 *
 * CONTAMINATION LEAVE-ONE-OUT (docs/05-DECISIONS.md D-089, complément du
 * 01/08/2026) : `mesureFacteurMeteoCategorie` ne filtrait PAS son historique
 * par date. `calculerFacteurMeteoMesure` appelle `estimerAvecMeteoMesuree` À
 * L'INTÉRIEUR de la validation croisée leave-one-out (`validerParLeaveOneOut`),
 * avec un historique qui exclut la session ciblée PAR INDEX, donc qui peut
 * encore contenir des sessions POSTÉRIEURES à elle — et ces sessions futures
 * entraient dans la moyenne de la catégorie exactement comme une session
 * passée. DÉFAUT ACTIF ET MESURÉ : sur une série non plate (voir
 * `meteo-mesuree.test.ts`, describe « contamination leave-one-out »),
 * `estimerAvecMeteoMesuree` rend 413 crêpes avec l'historique contaminé,
 * contre 145 crêpes une fois filtré par date.
 *
 * DIFFÉRENCE ASSUMÉE avec `saison.ts`/`jour-semaine.ts`/`vacances-scolaires.ts`/
 * `session-consecutive.ts` (même défaut de fond, déjà corrigé en réutilisant
 * `ageEnJours`/`poidsTemporel` de `baseline.ts`) : ce module ne pondère PAS
 * par récence — `mesureFacteurMeteoCategorie` calcule une simple MOYENNE des
 * résidus de la catégorie, documentée comme telle depuis D-059. Le défaut
 * n'était donc pas « une session future reçoit le poids maximal » (il n'y a
 * pas de poids du tout ici) mais plus simplement : une session future entrait
 * dans la moyenne avec EXACTEMENT le même poids qu'une session passée. Le
 * correctif se limite à EXCLURE les sessions futures avant de moyenner — seul
 * `ageEnJours` (le FILTRE) est réutilisé de `baseline.ts`, jamais
 * `poidsTemporel` : lui donner un rôle qu'il n'a jamais eu serait une décision
 * de modèle distincte de la fermeture de cette fuite, hors périmètre de cette
 * correction.
 */

import { BASE_POINTS, type PointsDeBase } from '../argent.js';
import type { Parametres } from '../parametres.js';
import { ageEnJours, calculerBaseline, type ObservationSession } from './baseline.js';
import { facteurMeteo, type CategorieMeteo, type ConditionsMeteo } from './meteo.js';
import { demandeSansNouveauPredicteur } from './predicteurs-precision.js';
import { validerParLeaveOneOut } from './validation-croisee.js';

/**
 * Une session close et sa météo brute, telle qu'archivée. Miroir structurel
 * de `ObservationMeteoBrute` (`packages/db/src/depots/previsions.ts`) — voir
 * l'en-tête du module pour pourquoi ce n'est pas un import direct.
 */
export type ObservationMeteoBrute = {
  readonly dateSession: string;
  readonly conditions: ConditionsMeteo;
  readonly crepesVendues: number;
  readonly evenementBp: PointsDeBase;
  readonly saisonBp: PointsDeBase;
};

/** Une session close, sa catégorie météo RÉELLEMENT observée, et le facteur prior qui s'appliquait. */
export type ObservationMeteoClassee = ObservationSession & {
  readonly categorie: CategorieMeteo;
  readonly ventFort: boolean;
};

export function classerObservationsMeteo(
  brutes: readonly ObservationMeteoBrute[],
  parametres: Parametres,
): ObservationMeteoClassee[] {
  return brutes.map((o) => {
    const meteo = facteurMeteo(o.conditions, parametres);
    return {
      dateSession: o.dateSession,
      crepesVendues: o.crepesVendues,
      // Le facteur PRIOR (catégorie + vent combinés) : c'est ce que le modèle
      // « sans mesure » utilise, exactement comme aujourd'hui.
      meteoBp: meteo.facteurBp,
      evenementBp: o.evenementBp,
      saisonBp: o.saisonBp,
      categorie: meteo.categorie,
      ventFort: meteo.ventFort,
    };
  });
}

/**
 * Moyenne des résidus météo (ventilation événement/saison/vent retirée) pour
 * UNE catégorie, sur l'historique fourni — la « mesure » elle-même.
 *
 * `null` sans observation exploitable pour cette catégorie : jamais un
 * facteur inventé sur zéro donnée.
 */
export function mesureFacteurMeteoCategorie(
  historique: readonly ObservationMeteoClassee[],
  categorie: CategorieMeteo,
  dateCible: string,
  baseline: number,
  parametres: Parametres,
): { facteurBp: PointsDeBase; nbObservations: number } | null {
  // Une session datée APRÈS (ou le même jour que) `dateCible` n'existe pas
  // encore pour ce calcul : même exclusion, et pour la même raison, que
  // `calculerBaseline` (baseline.ts) — voir l'en-tête du module sur la
  // contamination leave-one-out que ce filtre ferme. Une date ILLISIBLE reste
  // conservée (âge NaN), exactement comme dans `baseline.ts`.
  const observations = historique.filter((h) => {
    if (h.categorie !== categorie) return false;
    const age = ageEnJours(h.dateSession, dateCible);
    return !Number.isFinite(age) || age > 0;
  });
  if (observations.length === 0 || !Number.isFinite(baseline) || baseline <= 0) return null;

  const ventFactorBp = parametres.pointsDeBase('prevision_meteo_vent_fort_bp');
  const residus = observations.map((h) => {
    const facteurVent = h.ventFort ? ventFactorBp / BASE_POINTS : 1;
    const facteurAutres = (h.evenementBp / BASE_POINTS) * (h.saisonBp / BASE_POINTS) * facteurVent;
    const valeur = facteurAutres > 0 ? h.crepesVendues / facteurAutres : h.crepesVendues;
    return valeur / baseline;
  });
  const facteurBp = Math.round(
    (residus.reduce((somme, v) => somme + v, 0) / residus.length) * BASE_POINTS,
  );
  return { facteurBp, nbObservations: observations.length };
}

/**
 * Demande estimée AVEC un facteur météo mesuré, pour la validation croisée.
 *
 * `null` (démarrage à froid POUR CETTE catégorie, dans CE pli) si l'historique
 * transmis — qui exclut déjà la cible, leave-one-out oblige — ne compte pas
 * assez d'observations de la même catégorie : chaque catégorie a sa propre
 * maturité, une catégorie neuve ne doit pas emprunter celle d'une autre.
 */
export function estimerAvecMeteoMesuree(
  historique: readonly ObservationMeteoClassee[],
  cible: ObservationMeteoClassee,
  parametres: Parametres,
  minObservationsParCategorie: number,
): number | null {
  const baselineHist = calculerBaseline(historique, cible.dateSession, parametres).baselineCrepes;
  if (!Number.isFinite(baselineHist) || baselineHist <= 0) return null;

  const mesure = mesureFacteurMeteoCategorie(
    historique,
    cible.categorie,
    cible.dateSession,
    baselineHist,
    parametres,
  );
  if (mesure === null || mesure.nbObservations < minObservationsParCategorie) return null;

  const ventFactorBp = parametres.pointsDeBase('prevision_meteo_vent_fort_bp');
  const facteurVentCible = cible.ventFort ? ventFactorBp / BASE_POINTS : 1;
  return (
    baselineHist *
    (mesure.facteurBp / BASE_POINTS) *
    (cible.evenementBp / BASE_POINTS) *
    (cible.saisonBp / BASE_POINTS) *
    facteurVentCible
  );
}

/** Facteur météo retenu pour LA session à venir : mesuré ou prior, avec de quoi l'expliquer. */
export type FacteurMeteoRetenu = {
  readonly enUsage: boolean;
  readonly facteurBp: PointsDeBase;
  readonly nbObservations: number;
  /** Phrase à ajouter à l'explication du prior — « mesuré sur 9 dimanches », « prior, jamais mesuré »… */
  readonly origine: string;
};

/**
 * Calcule et valide le facteur météo mesuré pour la catégorie de LA session
 * dont on prévoit les ventes.
 *
 * Reprend le patron de `validerPredicteurDeDemande` (`predicteurs-precision.ts`),
 * avec une différence : la validation croisée porte sur l'ENSEMBLE de
 * l'historique (toutes catégories confondues, comme les quatre autres
 * prédicteurs), mais le verdict d'admission est ensuite appliqué à LA
 * catégorie de la cible — un facteur mesuré n'entre en jeu que si (a) le
 * mécanisme dans son ensemble bat le prior en MAPE ET (b) cette catégorie
 * précise a, elle-même, assez d'observations. Sans (b), une catégorie neuve
 * emprunterait à tort la maturité d'une catégorie ancienne mesurée sur
 * beaucoup de dimanches.
 */
export function calculerFacteurMeteoMesure(
  observationsMeteo: readonly ObservationMeteoClassee[],
  categorieCible: CategorieMeteo,
  facteurPriorCible: PointsDeBase,
  dateCible: string,
  minPointsEvalues: number,
  minObservationsParCategorie: number,
  parametres: Parametres,
): FacteurMeteoRetenu {
  const nbObservations = observationsMeteo.filter((o) => o.categorie === categorieCible).length;

  if (nbObservations < minObservationsParCategorie) {
    return {
      enUsage: false,
      facteurBp: facteurPriorCible,
      nbObservations,
      origine:
        nbObservations === 0
          ? 'prior, jamais mesuré'
          : `prior — encore ${nbObservations}/${minObservationsParCategorie} dimanche` +
            `${nbObservations > 1 ? 's' : ''} observé${nbObservations > 1 ? 's' : ''}`,
    };
  }

  // La validation croisée leave-one-out porte sur l'historique RÉEL
  // (`observationsMeteo`), toutes catégories confondues — chaque point y est
  // tour à tour la cible, avec sa PROPRE catégorie (portée par l'observation
  // elle-même). `categorieCible`/`facteurPriorCible` ne servent qu'à décider
  // et expliquer la valeur retenue pour LA session à venir, une fois le
  // verdict global rendu ci-dessous.
  const validation = validerParLeaveOneOut(
    observationsMeteo,
    (o) => o.crepesVendues,
    (historique, cible) => demandeSansNouveauPredicteur(historique, cible, parametres),
    (historique, cible) =>
      estimerAvecMeteoMesuree(historique, cible, parametres, minObservationsParCategorie),
    minPointsEvalues,
  );

  if (!validation.admis) {
    return {
      enUsage: false,
      facteurBp: facteurPriorCible,
      nbObservations,
      origine:
        `prior — mesuré sur ${nbObservations} dimanche${nbObservations > 1 ? 's' : ''}, ` +
        'mais rejeté par validation croisée (n’améliore pas le MAPE)',
    };
  }

  // Admis : la valeur qui sert RÉELLEMENT à la prévision est recalculée sur la
  // TOTALITÉ de l'historique (plus de leave-one-out — c'était un test, pas la
  // valeur de production).
  const baselineComplete = calculerBaseline(
    observationsMeteo,
    dateCible,
    parametres,
  ).baselineCrepes;
  const mesure = mesureFacteurMeteoCategorie(
    observationsMeteo,
    categorieCible,
    dateCible,
    baselineComplete,
    parametres,
  );
  if (mesure === null) {
    return {
      enUsage: false,
      facteurBp: facteurPriorCible,
      nbObservations,
      origine: 'prior, jamais mesuré',
    };
  }

  return {
    enUsage: true,
    facteurBp: mesure.facteurBp,
    nbObservations: mesure.nbObservations,
    origine: `mesuré sur ${mesure.nbObservations} dimanche${mesure.nbObservations > 1 ? 's' : ''}`,
  };
}
