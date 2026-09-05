/**
 * `npm run backtest` — docs/17 fiche 8.
 *
 * Rejoue TOUT l'historique clôturé et rend les six indicateurs de qualité de
 * docs/03 « Mesure de la qualité du modèle », dont trois manquaient avant ce
 * lot (MAPE glissante, taux de rupture, taux d'invendu — voir `tauxEcoulement`
 * dans `packages/db/src/depots/previsions.ts`, désormais partagé par
 * `qualiteModele()` ET ce script).
 *
 * C'est ce script qui ARBITRE docs/17 fiches 2, 3, 4 et 5 : « sans mesure,
 * aucune des suites n'est arbitrable » (docs/15 §7). Changer un paramètre
 * météo/saison/tendance dans Paramètres puis relancer `npm run backtest`
 * montre l'effet chiffré sur l'erreur — sans ça, tout réglage de ces
 * paramètres est une opinion.
 *
 * ## Le piège à éviter, et comment ce script l'évite
 *
 * Un backtest qui s'évalue sur les mêmes points que ceux qui ont servi à le
 * calibrer ment — le modèle « prédit » alors ce qu'il a déjà vu. Ce script
 * évalue en VALIDATION CROISÉE LEAVE-ONE-OUT : chaque session close est retirée
 * tour à tour de son propre historique, ré-estimée à partir de TOUTES LES
 * AUTRES sessions closes du même lieu (jamais la session cible elle-même),
 * puis comparée au réalisé. Voir `ResultatBacktest.methode`, qui rend cette
 * phrase EXPLICITE dans la sortie — pas seulement dans ce commentaire.
 *
 * ## Pourquoi réutiliser `validerParLeaveOneOut`, et ne pas écrire un second juge
 *
 * `packages/core/src/prevision/validation-croisee.ts` REFUSE déjà un
 * prédicteur qui n'améliore pas le MAPE d'un modèle qui l'ignore — pas
 * seulement il le mesure (`admis`, `raisonRefus`). C'est exactement le
 * verdict que ce script doit rendre sur le modèle COMPLET (météo + événement +
 * saison + tendance, docs/17 fiches 2/3/4) comparé à une baseline NAÏVE (la
 * seule baseline bayésienne, sans aucun facteur) : la même fonction, le même
 * garde-fou anti-sur-apprentissage, appliqué au modèle entier plutôt qu'à un
 * seul prédicteur. Biais, couverture de l'intervalle, MAPE glissante et taux
 * de rupture/invendu sont des statistiques COMPLÉMENTAIRES que
 * `validerParLeaveOneOut` ne rend pas (il ne connaît pas les intervalles
 * P10/P90) — elles ne concurrencent pas son verdict, elles le complètent.
 *
 * ## Lecture SEULE, connexion SÉPARÉE
 *
 * Ce script ne modifie JAMAIS la base : il ne fait qu'agréger des lectures
 * déjà exposées par `packages/db/src/depots/previsions.ts`. L'entrée en ligne
 * de commande ouvre sa PROPRE connexion `better-sqlite3` en
 * `{ readonly: true }`, séparée de `creerBase()` — même en cas d'erreur dans
 * ce fichier, aucune écriture n'est possible sur les données réelles du
 * porteur.
 *
 * ## Ce qui n'est PAS fait ici, assumé
 *
 * `qualiteModele()` (l'écran « Qualité du modèle ») ne lit que les prévisions
 * EXPLICITEMENT archivées (`POST /prevision/archiver`) : la plupart des
 * sessions historiques n'en ont probablement aucune, et ce script ne les
 * « rattrape » pas en écrivant des prévisions rétrospectives dans la table
 * `prevision` — mélanger une décision RÉELLEMENT prise avec une reconstitution
 * a posteriori dans la même table d'audit serait trompeur (CLAUDE.md règle 7).
 * Ce script fournit les MÊMES six indicateurs de façon INDÉPENDANTE, par rejeu
 * complet, sans avoir besoin d'un seul archivage manuel — voir le rapport de
 * livraison pour la discussion complète.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import {
  BASE_POINTS,
  calculerBaseline,
  prevoir,
  ratioEnPointsDeBase,
  saisonBp,
  tendanceBp,
  validerParLeaveOneOut,
  type CleParametre,
  type ConfigSaison,
  type ConfigTendance,
  type Estimateur,
  type ObservationSession,
  type Parametres,
  type ResultatValidationCroisee,
} from '@batte/core';
import { config } from '../config.js';
import type { BaseBatte } from '../client.js';
import { estModulePrincipal } from '../module-principal.js';
import * as schema from '../schema.js';
import { lieuMarche, sessionMarche } from '../schema.js';
import {
  coutsNewsvendor,
  observationsCompletesDuLieu,
  observationsDuLieu,
  tauxEcoulement,
} from '../depots/previsions.js';
import { lireParametres } from '../depots/parametres.js';

/** Phrase FIXE, reprise telle quelle dans la sortie : dit sur quoi ce script s'évalue. */
export const METHODE_EVALUATION =
  'Validation croisée leave-one-out : chaque session close est retirée tour à tour de son ' +
  'propre historique, ré-estimée à partir de TOUTES LES AUTRES sessions closes du même lieu ' +
  '(jamais la session cible elle-même), puis comparée au nombre de crêpes réellement vendu. ' +
  'Aucun point n’est évalué sur des données qui ont servi à le calibrer.';

export type ResultatBacktestLieu = {
  readonly lieuId: string;
  readonly lieuNom: string;
  readonly nbSessionsCloses: number;
  /**
   * Verdict rendu par `validerParLeaveOneOut` sur le modèle COMPLET (baseline
   * × météo × événement × saison × tendance) comparé à la baseline NAÏVE
   * (aucun facteur) — `admis: true` veut dire que le modèle complet bat la
   * baseline naïve en MAPE hors échantillon.
   */
  readonly validation: ResultatValidationCroisee;
  readonly erreurAbsolueMoyenneBp: number | null;
  readonly biaisMoyenCrepes: number | null;
  readonly tauxCouvertureBp: number | null;
  readonly mapeGlissanteBp: number | null;
  readonly nbSessionsMapeGlissante: number;
  readonly tauxRuptureBp: number | null;
  readonly tauxInvenduBp: number | null;
  readonly nbSessionsEcoulement: number;
};

export type ResultatBacktest = {
  readonly methode: string;
  readonly parLieu: readonly ResultatBacktestLieu[];
};

/**
 * Six clés de méthode (pas des valeurs métier devinées) reprises telles
 * quelles de docs/03, avec repli tant qu'elles ne sont pas encore au
 * catalogue officiel (`packages/core/src/parametres.ts`, hors zone d'écriture
 * de cet agent) — même précaution que `entierAvecRepli` dans
 * `apps/api/src/routes/previsions.ts`.
 */
function entierAvecRepli(parametres: Parametres, cle: string, repli: number): number {
  return parametres.possede(cle) ? parametres.entier(cle as unknown as CleParametre) : repli;
}

function configSaisonDepuisParametres(parametres: Parametres): ConfigSaison {
  return {
    observationsMinimum: entierAvecRepli(parametres, 'prevision_saison_observations_minimum', 3),
    moisDistinctsMinimum: entierAvecRepli(parametres, 'prevision_saison_mois_distincts_minimum', 4),
    demiVieJours: parametres.entier('prevision_demi_vie_ponderation_jours'),
  };
}

function configTendanceDepuisParametres(parametres: Parametres): ConfigTendance {
  return {
    sessionsMinimum: entierAvecRepli(parametres, 'prevision_tendance_sessions_minimum', 10),
    fenetreSessions: entierAvecRepli(parametres, 'prevision_tendance_fenetre_sessions', 12),
    borneBp: entierAvecRepli(parametres, 'prevision_tendance_borne_bp', 3000),
  };
}

/** Modèle NAÏF : la seule baseline bayésienne, aucun facteur. C'est le « sans » du verdict. */
function demandeSansFacteurs(
  historique: readonly ObservationSession[],
  cible: ObservationSession,
  parametres: Parametres,
): number | null {
  const baseline = calculerBaseline(historique, cible.dateSession, parametres).baselineCrepes;
  return Number.isFinite(baseline) && baseline > 0 ? baseline : null;
}

/**
 * Modèle COMPLET : baseline × météo (prior classifié) × événement (réel,
 * mesuré si disponible) × saison mesurée × tendance mesurée — c'est le
 * « avec » du verdict, et c'est lui que docs/17 fiches 2/3/4 doivent
 * améliorer.
 */
function demandeAvecFacteurs(
  historique: readonly ObservationSession[],
  cible: ObservationSession,
  parametres: Parametres,
  configSaison: ConfigSaison,
  configTendance: ConfigTendance,
): number | null {
  const baseline = calculerBaseline(historique, cible.dateSession, parametres).baselineCrepes;
  if (!Number.isFinite(baseline) || baseline <= 0) return null;

  const saison = saisonBp(historique, cible.dateSession, configSaison);
  const tendance = tendanceBp(historique, cible.dateSession, configTendance);

  return (
    baseline *
    (cible.meteoBp / BASE_POINTS) *
    (cible.evenementBp / BASE_POINTS) *
    (saison.actif ? saison.facteurBp / BASE_POINTS : 1) *
    (tendance.actif ? tendance.facteurBp / BASE_POINTS : 1)
  );
}

type PointRejoue = {
  readonly dateSession: string;
  readonly reel: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  readonly erreurAbsolueBp: number | null;
};

/**
 * Rejoue p10/p50/p90 pour CHAQUE session, en leave-one-out, via `prevoir()` —
 * le VRAI moteur, pas une réimplémentation : c'est ce qui garantit que ces
 * indicateurs restent honnêtes vis-à-vis de ce que l'écran affiche réellement.
 *
 * Les coûts newsvendor et les seuils de méthode utilisés sont ceux
 * D'AUJOURD'HUI, appliqués uniformément à tout l'historique — divergence
 * ASSUMÉE (reconstituer le coût matière et le prix de vente RÉELS à chaque
 * date historique demanderait de rejouer aussi tout l'historique d'achat et
 * de vente, hors périmètre de cette fiche). Documentée dans le rapport de
 * livraison.
 */
function rejouerIntervalles(
  observations: readonly ObservationSession[],
  parametres: Parametres,
  couts: { coutRuptureCents: number; coutInvenduCents: number },
  configSaison: ConfigSaison,
  configTendance: ConfigTendance,
): PointRejoue[] {
  const points: PointRejoue[] = [];

  for (let i = 0; i < observations.length; i += 1) {
    const cible = observations[i]!;
    if (!Number.isFinite(cible.crepesVendues) || cible.crepesVendues <= 0) continue;

    const historique = observations.filter((_, index) => index !== i);
    const baselineCalcul = calculerBaseline(historique, cible.dateSession, parametres);
    if (!Number.isFinite(baselineCalcul.baselineCrepes) || baselineCalcul.baselineCrepes <= 0) {
      continue;
    }

    const saison = saisonBp(historique, cible.dateSession, configSaison);
    const tendance = tendanceBp(historique, cible.dateSession, configTendance);

    // `prevoir()` peut lever une `ErreurMetier` sur une combinaison de
    // paramètres invalide (quantile cible hors bornes, par exemple) : un seul
    // point mal calibré ne doit pas faire échouer tout le rejeu, il est
    // simplement écarté — jamais silencieusement compté comme exact.
    try {
      const resultat = prevoir(
        {
          baselineCrepes: baselineCalcul.baselineCrepes,
          nbSessionsObservees: baselineCalcul.nbSessionsRetenues,
          sigmaObserve: baselineCalcul.sigmaObserve,
          meteo: null,
          meteoFacteurBp: cible.meteoBp,
          evenementBp: cible.evenementBp,
          ...(saison.actif ? { saisonBp: saison.facteurBp } : {}),
          ...(tendance.actif ? { tendanceBp: tendance.facteurBp } : {}),
          coutRuptureCents: couts.coutRuptureCents,
          coutInvenduCents: couts.coutInvenduCents,
          contraintes: [],
        },
        parametres,
      );

      points.push({
        dateSession: cible.dateSession,
        reel: cible.crepesVendues,
        p10: resultat.p10,
        p50: resultat.p50,
        p90: resultat.p90,
        erreurAbsolueBp:
          resultat.p50 > 0
            ? ratioEnPointsDeBase(Math.abs(cible.crepesVendues - resultat.p50), resultat.p50)
            : null,
      });
    } catch {
      continue;
    }
  }

  return points;
}

function moyenne(valeurs: readonly number[]): number | null {
  return valeurs.length === 0 ? null : valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
}

/**
 * Rejoue l'historique d'UN lieu et rend les six indicateurs de docs/03.
 *
 * `couts` vient de `coutsNewsvendor(base)`, GLOBAL (pas par lieu) : le modèle
 * newsvendor actuel ne distingue pas les coûts par lieu, donc ce rejeu non
 * plus — cohérent avec le reste de l'application.
 */
function rejouerLieu(
  base: BaseBatte,
  lieuId: string,
  lieuNom: string,
  parametres: Parametres,
  couts: { coutRuptureCents: number; coutInvenduCents: number },
  minPointsEvalues: number,
): ResultatBacktestLieu {
  const observations = observationsDuLieu(base, lieuId);
  const configSaison = configSaisonDepuisParametres(parametres);
  const configTendance = configTendanceDepuisParametres(parametres);

  const estimerSans: Estimateur<ObservationSession> = (historique, cible) =>
    demandeSansFacteurs(historique, cible, parametres);
  const estimerAvec: Estimateur<ObservationSession> = (historique, cible) =>
    demandeAvecFacteurs(historique, cible, parametres, configSaison, configTendance);

  const validation = validerParLeaveOneOut(
    observations,
    (o) => o.crepesVendues,
    estimerSans,
    estimerAvec,
    minPointsEvalues,
  );

  // --- Biais, couverture, MAPE glissante : nécessitent le MÊME seuil minimal
  // que la validation croisée ci-dessus — un intervalle rejoué sur trois
  // points ne prouve rien de plus qu'un MAPE sur trois points.
  const points =
    observations.length >= minPointsEvalues
      ? rejouerIntervalles(observations, parametres, couts, configSaison, configTendance)
      : [];

  const erreurs = points.map((p) => p.erreurAbsolueBp).filter((e): e is number => e !== null);
  const biais = points.map((p) => p.reel - p.p50);
  const dansIntervalle = points.filter((p) => p.reel >= p.p10 && p.reel <= p.p90).length;

  const pointsRecents = [...points].sort((a, b) => b.dateSession.localeCompare(a.dateSession));
  const fenetreGlissante = pointsRecents.slice(0, 10);
  const erreursGlissantes = fenetreGlissante
    .map((p) => p.erreurAbsolueBp)
    .filter((e): e is number => e !== null);

  const seuilRuptureBp = parametres.pointsDeBase('prevision_session_consecutive_seuil_rupture_bp');
  const ecoulement = tauxEcoulement(observationsCompletesDuLieu(base, lieuId), seuilRuptureBp);

  return {
    lieuId,
    lieuNom,
    nbSessionsCloses: observations.length,
    validation,
    erreurAbsolueMoyenneBp: erreurs.length === 0 ? null : Math.round(moyenne(erreurs)!),
    biaisMoyenCrepes: biais.length === 0 ? null : Math.round(moyenne(biais)!),
    tauxCouvertureBp:
      points.length === 0 ? null : ratioEnPointsDeBase(dansIntervalle, points.length),
    mapeGlissanteBp:
      erreursGlissantes.length === 0 ? null : Math.round(moyenne(erreursGlissantes)!),
    nbSessionsMapeGlissante: erreursGlissantes.length,
    tauxRuptureBp: ecoulement.tauxRuptureBp,
    tauxInvenduBp: ecoulement.tauxInvenduBp,
    nbSessionsEcoulement: ecoulement.nbSessions,
  };
}

/** Lieux ayant au moins une session close — inutile de rejouer un lieu sans historique. */
function lieuxAvecHistorique(base: BaseBatte): readonly { lieuId: string; lieuNom: string }[] {
  const lignes = base
    .selectDistinct({ lieuId: sessionMarche.lieuId, lieuNom: lieuMarche.nom })
    .from(sessionMarche)
    .innerJoin(lieuMarche, eq(sessionMarche.lieuId, lieuMarche.id))
    .where(eq(sessionMarche.statut, 'cloturee'))
    .all();
  return lignes;
}

/**
 * Rejoue tout l'historique clôturé, lieu par lieu, et rend les six
 * indicateurs de docs/03. LECTURE SEULE : aucune écriture, quel que soit
 * l'appelant.
 */
export function executerBacktest(base: BaseBatte): ResultatBacktest {
  const parametres = lireParametres(base);
  const minPointsEvalues = parametres.entier('prevision_validation_croisee_points_minimum');
  const couts = coutsNewsvendor(base);

  const parLieu = lieuxAvecHistorique(base).map(({ lieuId, lieuNom }) =>
    rejouerLieu(base, lieuId, lieuNom, parametres, couts, minPointsEvalues),
  );

  return { methode: METHODE_EVALUATION, parLieu };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Entrée en ligne de commande
   ═══════════════════════════════════════════════════════════════════════════ */

function pourcent(bp: number | null): string {
  return bp === null ? '—' : `${(bp / 100).toFixed(1)} %`;
}

function afficherResultat(resultat: ResultatBacktest): void {
  console.log(resultat.methode);
  console.log('');

  if (resultat.parLieu.length === 0) {
    console.log('Aucune session close : rien à rejouer pour le moment.');
    return;
  }

  for (const lieu of resultat.parLieu) {
    console.log(`── ${lieu.lieuNom} (${lieu.nbSessionsCloses} sessions closes) ──`);

    if (lieu.validation.admis) {
      console.log(
        `Modèle complet vs baseline naïve : MAPE ${pourcent(lieu.validation.mapeAvecPredicteurBp)} ` +
          `contre ${pourcent(lieu.validation.mapeSansPredicteurBp)} — le modèle bat la baseline naïve ` +
          `(${lieu.validation.nbPointsEvalues} points évalués).`,
      );
    } else {
      console.log(`Modèle complet vs baseline naïve : ${lieu.validation.raisonRefus}`);
    }

    console.log(`Erreur absolue moyenne : ${pourcent(lieu.erreurAbsolueMoyenneBp)}`);
    console.log(
      `MAPE glissante (${lieu.nbSessionsMapeGlissante} dernières sessions) : ` +
        `${pourcent(lieu.mapeGlissanteBp)}`,
    );
    console.log(
      `Biais moyen : ${lieu.biaisMoyenCrepes === null ? '—' : `${lieu.biaisMoyenCrepes} crêpes`}`,
    );
    console.log(`Couverture de l’intervalle P10–P90 : ${pourcent(lieu.tauxCouvertureBp)}`);
    console.log(
      `Taux de rupture : ${pourcent(lieu.tauxRuptureBp)} ` +
        `(${lieu.nbSessionsEcoulement} sessions avec production connue)`,
    );
    console.log(`Taux d’invendu : ${pourcent(lieu.tauxInvenduBp)}`);
    console.log('');
  }
}

/** Ouvre la base RÉELLE en lecture seule, sur une connexion SÉPARÉE de `creerBase()`. */
function ouvrirBaseLectureSeule(cheminFichier: string): BaseBatte {
  const sqlite = new Database(cheminFichier, { readonly: true, fileMustExist: true });
  return drizzle(sqlite, { schema }) as unknown as BaseBatte;
}

// Execution directe uniquement (`npm run backtest`), jamais a l'import — même
// garde que `migrer.ts`/`seed/index.ts`.
if (estModulePrincipal(import.meta.url)) {
  try {
    const base = ouvrirBaseLectureSeule(config.cheminBase);
    afficherResultat(executerBacktest(base));
  } catch (erreur) {
    console.error(
      `Impossible de lire la base (${config.cheminBase}). A-t-elle été migrée ` +
        `(\`npm run db:migrate\`) ? Détail : ${erreur instanceof Error ? erreur.message : erreur}`,
    );
    process.exitCode = 1;
  }
}
