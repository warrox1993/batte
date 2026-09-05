/**
 * Saison et tendance MESURÉES (docs/17 fiche 3, docs/03 facteurs 4 et 5),
 * DÉPLACÉES depuis `apps/api/src/routes/previsions.ts` (`docs/26-AUDIT-DIX-
 * REGLES.md`, règle 1 : ce calcul vivait dans un handler HTTP, jamais testé
 * unitairement).
 *
 * DÉPLACEMENT SEUL : aucune formule n'a changé, à une exception de FORME
 * (pas de fond) près — voir la note sur `config` ci-dessous.
 *
 * Même défaut de fond que la météo (`meteo-mesuree.ts`, D-059) :
 * `saisonBp`/`tendanceBp` valaient `BASE_POINTS` en dur avant correction
 * (`packages/db/src/depots/previsions.ts`), et l'écran affichait « × 1,00 » —
 * indiscernable d'une mesure. Ce module mesure, puis ne laisse le résultat
 * entrer dans le calcul qu'après validation croisée leave-one-out, EXACTEMENT
 * comme la météo : trois états distincts, jamais confondus — « non modélisée »
 * (démarrage à froid), « mesurée » (admise), « rejetée par validation
 * croisée » (mesurée mais pas admise). C'est pourquoi ces deux facteurs ne
 * suivent PAS le patron plus simple des quatre prédicteurs de précision
 * (`predicteurs-precision.ts`, `PredicteurRetenu`, admis/non-admis sans
 * distinguer la raison) : docs/17 fiche 3 exige explicitement que l'écran
 * puisse dire LAQUELLE des trois raisons s'applique.
 *
 * SUR `config` : la route construisait auparavant `ConfigSaison`/
 * `ConfigTendance` EN INTERNE, à partir de six clés de catalogue pas encore
 * officialisées (`entierAvecRepli`, un contournement temporaire tant que
 * `packages/core/src/parametres.ts` — hors zone d'écriture de cette mission —
 * ne les porte pas). Pour ne PAS dupliquer ce contournement ici ni
 * dépendre d'un accès catalogue à moitié officiel, ces deux fonctions
 * reçoivent maintenant `config` déjà assemblée par l'appelant — sémantiquement
 * IDENTIQUE (même valeurs, même repli), seule la RESPONSABILITÉ de
 * l'assemblage change de côté. Voir le rapport de livraison.
 *
 * PUR : aucun accès base ici (CLAUDE.md §3 règle 1).
 */

import type { Parametres } from '../parametres.js';
import { BASE_POINTS, type PointsDeBase } from '../argent.js';
import { type ObservationSession } from './baseline.js';
import { demandeSansNouveauPredicteur } from './predicteurs-precision.js';
import { saisonBp, type ConfigSaison } from './saison.js';
import { tendanceBp, type ConfigTendance } from './tendance.js';
import { validerParLeaveOneOut, type Estimateur } from './validation-croisee.js';

/** Facteur de base (saison OU tendance) retenu, avec les trois états distincts exigés par la fiche. */
export type FacteurBaseRetenu = {
  readonly enUsage: boolean;
  readonly facteurBp: PointsDeBase;
  /** Phrase TOUJOURS présente, y compris quand `enUsage` est faux — jamais un « × 1,00 » muet. */
  readonly origine: string;
};

/**
 * Mesure et valide le facteur saison pour la session dont on prévoit les
 * ventes. Trois issues, jamais confondues :
 *   1. « non modélisée » — démarrage à froid (`saisonBp(...).actif === false`) ;
 *   2. « rejetée par validation croisée » — mesurée, mais n'améliore pas le
 *      MAPE du modèle qui l'ignore ;
 *   3. « mesurée » — admise, entre dans le calcul.
 */
export function calculerSaisonRetenue(
  observations: readonly ObservationSession[],
  dateCible: string,
  minPointsEvalues: number,
  config: ConfigSaison,
  parametres: Parametres,
): FacteurBaseRetenu {
  const live = saisonBp(observations, dateCible, config);

  if (!live.actif) {
    const origine =
      live.nbMoisDistinctsObserves < config.moisDistinctsMinimum
        ? `non modélisée — historique trop court (${live.nbMoisDistinctsObserves}/` +
          `${config.moisDistinctsMinimum} mois distincts observés)`
        : `non modélisée — encore ${live.nbObservationsMoisCible}/${config.observationsMinimum} ` +
          `session${live.nbObservationsMoisCible > 1 ? 's' : ''} pour ce mois`;
    return { enUsage: false, facteurBp: BASE_POINTS, origine };
  }

  const estimerAvecSaison: Estimateur<ObservationSession> = (historique, cible) => {
    const sans = demandeSansNouveauPredicteur(historique, cible, parametres);
    if (sans === null) return null;
    const resultat = saisonBp(historique, cible.dateSession, config);
    if (!resultat.actif) return null;
    return sans * (resultat.facteurBp / BASE_POINTS);
  };

  const validation = validerParLeaveOneOut(
    observations,
    (o) => o.crepesVendues,
    (historique, cible) => demandeSansNouveauPredicteur(historique, cible, parametres),
    estimerAvecSaison,
    minPointsEvalues,
  );

  if (!validation.admis) {
    return {
      enUsage: false,
      facteurBp: BASE_POINTS,
      origine:
        `non modélisée — mesurée (${live.explication ?? ''}) mais rejetée par validation ` +
        'croisée : elle n’améliore pas le MAPE',
    };
  }

  return { enUsage: true, facteurBp: live.facteurBp, origine: live.explication ?? 'mesurée' };
}

/** Même mécanisme que `calculerSaisonRetenue`, pour la tendance (docs/03 facteur 5). */
export function calculerTendanceRetenue(
  observations: readonly ObservationSession[],
  dateCible: string,
  minPointsEvalues: number,
  config: ConfigTendance,
  parametres: Parametres,
): FacteurBaseRetenu {
  const live = tendanceBp(observations, dateCible, config);

  if (!live.actif) {
    return {
      enUsage: false,
      facteurBp: BASE_POINTS,
      origine:
        `non modélisée — encore ${live.nbSessionsRegression}/${config.sessionsMinimum} sessions ` +
        'antérieures exploitables',
    };
  }

  const estimerAvecTendance: Estimateur<ObservationSession> = (historique, cible) => {
    const sans = demandeSansNouveauPredicteur(historique, cible, parametres);
    if (sans === null) return null;
    const resultat = tendanceBp(historique, cible.dateSession, config);
    if (!resultat.actif) return null;
    return sans * (resultat.facteurBp / BASE_POINTS);
  };

  const validation = validerParLeaveOneOut(
    observations,
    (o) => o.crepesVendues,
    (historique, cible) => demandeSansNouveauPredicteur(historique, cible, parametres),
    estimerAvecTendance,
    minPointsEvalues,
  );

  if (!validation.admis) {
    return {
      enUsage: false,
      facteurBp: BASE_POINTS,
      origine:
        `non modélisée — mesurée (${live.explication ?? ''}) mais rejetée par validation ` +
        'croisée : elle n’améliore pas le MAPE',
    };
  }

  return { enUsage: true, facteurBp: live.facteurBp, origine: live.explication ?? 'mesurée' };
}
