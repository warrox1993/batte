/**
 * Moteur de prevision — etapes 1 a 4 de l'ordre d'implementation de docs/03.
 *
 *   1. Squelette multiplicatif a facteurs
 *   2. Facteur meteo (priors)
 *   3. Intervalle d'incertitude et calcul newsvendor  ← l'essentiel du gain
 *   4. Contraintes dures et ecretage
 *
 * DÉTERMINISTE et sans reseau : meme entree, meme sortie. C'est la condition du
 * backtesting, et c'est aussi ce qui distingue ce module d'un appel a un LLM —
 * « un LLM ne fait pas les statistiques » (docs/03, avertissement).
 */

import { BASE_POINTS, type Centimes, type PointsDeBase } from '../argent.js';
import { ErreurMetier } from '../erreurs.js';
import type { Parametres } from '../parametres.js';
import { type ConditionsMeteo, facteurMeteo } from './meteo.js';
import {
  repartitionProduction,
  type ConfigRepartitionProduction,
  type LigneRepartitionProduction,
  type RecetteRepartition,
} from './repartition-production.js';
import {
  medianeDepuisEsperance,
  quantileLogNormal,
  ratioCritique,
  sigmaDepuisCoefficientVariation,
  ventesEsperees,
} from './statistiques.js';

/*
 * Re-exports de trois modules NEUFS (docs/17 fiches 3 et 5), le temps que
 * `packages/core/src/prevision/index.ts` soit mis a jour — ce barril est
 * `INTERDIT toujours` a l'ecriture pour cet agent (risque de collision : un
 * fichier partage par TOUTE prevision qui touche `packages/core`). `moteur.ts`
 * est deja re-exporte par ce barril (`export * from './moteur.js'`) : ces
 * trois lignes suffisent a rendre `saisonBp`, `tendanceBp` et
 * `repartitionProduction` accessibles via `@batte/core` sans y toucher. A
 * deplacer directement dans `index.ts` si un futur lot prefere la forme
 * habituelle — aucune consequence fonctionnelle a le faire ou non.
 */
export * from './saison.js';
export * from './tendance.js';
export * from './repartition-production.js';

export type FacteursPrevision = {
  readonly meteoBp: PointsDeBase;
  readonly evenementBp: PointsDeBase;
  readonly saisonBp: PointsDeBase;
  readonly tendanceBp: PointsDeBase;
  /**
   * Quatre predicteurs de docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-
   * PRECISION.md §2, TOUJOURS presents dans la sortie (comme les quatre
   * facteurs ci-dessus) mais neutres (10000) tant que l'appelant ne fournit
   * rien — c'est-a-dire tant que le predicteur correspondant est en
   * demarrage a froid (`packages/core/src/prevision/comparable-calendaire.ts`,
   * `jour-semaine.ts`, `vacances-scolaires.ts`, `session-consecutive.ts`) ou
   * n'a pas ete admis par la validation croisee (`validation-croisee.ts`).
   * Le moteur ne les CALCULE pas : il les COMPOSE, comme il le fait deja pour
   * `evenementBp`/`saisonBp`/`tendanceBp`.
   */
  readonly comparableCalendaireBp: PointsDeBase;
  readonly jourSemaineBp: PointsDeBase;
  readonly vacancesScolairesBp: PointsDeBase;
  readonly sessionConsecutiveBp: PointsDeBase;
};

export type ContrainteProduction = {
  readonly libelle: string;
  readonly plafondCrepes: number;
};

export type EntreePrevision = {
  /** Ventes d'une session « normale ». Vient du prior tant que n est faible. */
  readonly baselineCrepes: number;
  readonly nbSessionsObservees: number;
  /**
   * Ecart-type des residus log MESURE sur l'historique, quand il existe.
   *
   * `null` tant que l'historique est trop court : `sigmaRetenu` se rabat alors
   * sur le coefficient de variation prior. Ce champ etait ABSENT et le moteur
   * passait `null` en dur — le sigma mesure par `calculerBaseline` n'atteignait
   * donc jamais le calcul, et l'intervalle restait large a vie. Sur la session
   * type, cela representait une quarantaine de crepes produites en trop a
   * chaque marche.
   */
  readonly sigmaObserve?: number | null;
  readonly meteo: ConditionsMeteo | null;
  /**
   * Facteur meteo MESURE (docs/17 fiches 2/4, D-059), prime sur le prior
   * calcule par `facteurMeteo(entree.meteo, parametres)` quand il est fourni.
   *
   * L'appelant (`apps/api/src/routes/previsions.ts`) ne le transmet QUE si la
   * categorie du jour a assez d'observations ET que la mesure bat le prior
   * en validation croisee leave-one-out (`validerParLeaveOneOut`) — le meme
   * garde-fou anti-sur-apprentissage que les cinq predicteurs de la fiche 07.
   * `undefined` laisse le comportement IDENTIQUE a avant l'introduction de ce
   * mecanisme : c'est la garantie de non-regression deja appliquee aux
   * facteurs evenement/saison/tendance ci-dessous.
   */
  readonly meteoFacteurBp?: PointsDeBase;
  /** Phrase associee a `meteoFacteurBp`. Remplace celle du prior quand fournie. */
  readonly meteoExplication?: string;
  /** Facteurs deja calcules ailleurs. Neutres (10000) tant qu'ils ne le sont pas. */
  readonly evenementBp?: PointsDeBase;
  readonly saisonBp?: PointsDeBase;
  readonly tendanceBp?: PointsDeBase;
  /**
   * Predicteurs de docs/demandes/07 §2, deja calcules et VALIDES en croisement
   * (`validerParLeaveOneOut`) par l'appelant. Neutres (10000) par defaut : un
   * predicteur absent d'ici se comporte exactement comme avant son
   * introduction, ce qui est la garantie de non-regression exigee par la
   * fiche (« vérifier que les prévisions existantes ne changent pas quand les
   * nouveaux prédicteurs sont inactifs faute d'historique »).
   */
  readonly comparableCalendaireBp?: PointsDeBase;
  readonly jourSemaineBp?: PointsDeBase;
  readonly vacancesScolairesBp?: PointsDeBase;
  readonly sessionConsecutiveBp?: PointsDeBase;
  /**
   * Inflation multiplicative de `sigma`, calibree sur l'ecart historique
   * meteo prevue/realisee (`ecart-meteo-prevue-realisee.ts`). Neutre (10000 =
   * aucune inflation) par defaut. Ne s'applique JAMAIS en dessous de 10000 :
   * ce predicteur ELARGIT l'incertitude, il ne la resserre jamais — resserrer
   * sur la seule foi d'un historique meteo favorable serait un exces de
   * confiance que rien ne justifie statistiquement.
   */
  readonly inflationSigmaMeteoBp?: PointsDeBase;
  /**
   * Inflation multiplicative de `sigma` liee a la seule DISTANCE CALENDAIRE
   * de la session prevue (`horizon.ts`, `inflationHorizonBp`) —
   * docs/demandes/06, le piege central : « une prevision a 365 jours n'a pas
   * la meme valeur qu'une prevision a 7 jours ». Neutre (10000) par defaut :
   * sans elle, `sigma` retrouve EXACTEMENT `sigmaMesure * inflationSigmaMeteoBp`,
   * donc aucun changement pour l'appelant existant (`previsionCourante`, la
   * prochaine session) qui ne fournit pas ce champ. Se COMPOSE avec
   * `inflationSigmaMeteoBp` ci-dessus (les deux elargissent, jamais l'un au
   * lieu de l'autre) : l'un mesure une fiabilite meteo passee, l'autre assume
   * une fragilite structurelle croissante (meteo inconnue au-dela d'une
   * dizaine de jours, evenements lointains non recenses, tendance
   * extrapolee) — les deux sources de doute coexistent.
   */
  readonly inflationSigmaHorizonBp?: PointsDeBase;
  /** Marge perdue si l'on tombe en rupture, par crepe. */
  readonly coutRuptureCents: Centimes;
  /** Cout d'une crepe produite et non vendue. */
  readonly coutInvenduCents: Centimes;
  /** Contraintes dures, appliquees APRES le calcul economique. */
  readonly contraintes: readonly ContrainteProduction[];
  /**
   * Repartition en plan de production (docs/17 fiche 5) : quelle recette
   * produire, en quels volumes. `undefined` quand l'appelant n'a aucune
   * recette active exploitable a transmettre (ou n'a pas encore cable cette
   * fonctionnalite, comme la prevision calendaire — hors perimetre de cette
   * fiche) : `resultat.repartition` vaut alors `[]`, jamais une repartition
   * inventee sur des recettes inconnues.
   */
  readonly planProduction?: {
    readonly recettes: readonly RecetteRepartition[];
    readonly config: ConfigRepartitionProduction;
  };
};

export type ResultatPrevision = {
  readonly baseline: number;
  readonly facteurs: FacteursPrevision;
  /**
   * Produit `baseline × facteurs`, arrondi — la « demande attendue » de docs/03,
   * c'est-a-dire l'ESPERANCE des ventes.
   *
   * Distincte de `p50` : pour une loi log-normale asymetrique, l'esperance est
   * superieure a la mediane de exp(sigma²/2). C'est la ligne de decomposition
   * que l'utilisateur lit (« Base 118 × météo 1,15 × … = 168 crêpes attendues ») ;
   * c'est `p50` qui sert de mediane au calcul de production.
   */
  readonly demandeAttendue: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  /** Ratio critique retenu, en points de base. */
  readonly quantileCibleBp: PointsDeBase;
  readonly crepesRecommandees: number;
  readonly crepesRetenues: number;
  readonly contrainteLimitante: string | null;
  /** Manque a gagner estime quand une contrainte mord. `null` sinon. */
  readonly manqueAGagnerCents: Centimes | null;
  /** 0 a 10000. Fondee sur le nombre de sessions observees. */
  readonly confianceBp: PointsDeBase;
  readonly nbSessionsComparables: number;
  /** Phrases pretes a afficher : l'utilisateur doit pouvoir contester chaque facteur. */
  readonly explication: readonly string[];
  /**
   * Plan de production (docs/17 fiche 5) : crepes et volume de pate par
   * recette active, calcules sur `crepesRetenues` (ce qui sera REELLEMENT
   * produit, apres ecretage par les contraintes dures) — jamais sur
   * `crepesRecommandees`, qui peut depasser ce que l'atelier permet. Tableau
   * VIDE, jamais invente, quand `entree.planProduction` n'a pas ete fourni.
   */
  readonly repartition: readonly LigneRepartitionProduction[];
  /** Vrai si le plancher de securite sans gluten a du relever une part mesuree trop basse. */
  readonly plancherSansGlutenApplique: boolean;
};

/**
 * Ecart-type log a retenir selon la maturite de l'historique.
 *
 * Sous le premier palier, on ne mesure rien : on assume un coefficient de
 * variation large. C'est un choix d'HONNETETE — « un modèle qui affiche 168
 * crêpes sans intervalle au bout de trois sessions ment ».
 *
 * Les deux paliers sont lus au catalogue et non compiles : ce sont des seuils
 * de METHODE, de la meme famille que `prevision_poids_prior_k` et
 * `prevision_residus_minimum`, qui y sont deja. Les laisser en dur ici rendait
 * la maturite du modele impossible a regler sans recompiler.
 */
export function sigmaRetenu(
  nbSessions: number,
  sigmaObserve: number | null,
  parametres: Parametres,
): number {
  const sessionsAvantMesure = parametres.entier('prevision_sessions_avant_sigma_mesure');
  // CONVERSION, pas simple lecture. Le parametre est un coefficient de
  // VARIATION (docs/03 : « coefficient de variation prior 0,35 ») ; la
  // log-normale se parametre par un ecart-type LOG. CV = √(exp(σ²) − 1), donc
  // 0,35 de CV vaut σ = 0,3400. Injecter 0,35 tel quel dans l'exponentielle
  // elargissait l'intervalle de 1,5 % sans qu'aucun document ne le demande.
  const sigmaPrior = sigmaDepuisCoefficientVariation(
    parametres.pointsDeBase('prevision_cv_prior_bp') / BASE_POINTS,
  );

  // `Number.isFinite` en plus de `null` : un sigma `NaN` — venu d'un historique
  // corrompu ou d'un appelant negligent — traversait tout le moteur sans lever
  // et ressortait en « NaN crêpes ». On prefere l'aveu d'ignorance : le prior.
  if (nbSessions < sessionsAvantMesure || sigmaObserve === null) return sigmaPrior;
  if (!Number.isFinite(sigmaObserve) || sigmaObserve < 0) return sigmaPrior;

  const sessionsFiable = parametres.entier('prevision_sessions_sigma_fiable');
  // Le plancher, lui, est deja exprime en ecart-type log par docs/03
  // (« σ estimé sur les résidus log, plancher à 0,20 ») : aucune conversion.
  const plancher = parametres.pointsDeBase('prevision_plancher_sigma_bp') / BASE_POINTS;
  // Sous le second palier, l'ecart-type mesure est RELEVE au plancher : un
  // historique court n'a pas encore rencontre la mauvaise journee, il
  // sous-estime donc toujours la variabilite.
  return nbSessions < sessionsFiable ? Math.max(sigmaObserve, plancher) : sigmaObserve;
}

/**
 * Niveau de confiance affiche, fonde sur le nombre de sessions comparables.
 *
 * Croit vers 100 % de facon asymptotique : on n'atteint jamais la certitude,
 * ce qui est la verite d'un modele statistique.
 *
 * `demiConfianceSessions` est le nombre de sessions auquel la courbe atteint
 * 50 %. Il vient du catalogue (`prevision_demi_confiance_sessions`) et n'a
 * volontairement PAS de valeur par defaut ici : un defaut dans la signature est
 * exactement la façon dont une valeur metier codee en dur survit a un audit
 * (CLAUDE.md §7). Avec 10 — la valeur du catalogue, qui reproduit l'ancien
 * comportement — 20 sessions donnent ~67 %, 30 ~75 %, 50 ~83 %, et le palier
 * de qualite utile annonce par docs/03 est de 20 a 30 sessions.
 */
export function confianceBp(nbSessions: number, demiConfianceSessions: number): PointsDeBase {
  if (nbSessions <= 0) return 0;
  // Une demi-confiance nulle ou negative ferait rendre 100 % des la premiere
  // session, ou un pourcentage negatif : le parametre est saisissable a l'ecran,
  // donc la garde est necessaire. On retombe alors sur une confiance nulle,
  // jamais sur une certitude inventee.
  if (demiConfianceSessions <= 0) return 0;
  return Math.round((nbSessions / (nbSessions + demiConfianceSessions)) * BASE_POINTS);
}

/**
 * Quantile de repli, lu au catalogue, quand le ratio critique n'est pas calculable.
 *
 * Il est saisissable a l'ecran Parametres, donc rien n'empeche d'y mettre 0 ou
 * 10000. Les deux valeurs sont hors du domaine de `quantileNormal` et levaient
 * une `RangeError` non traduite : erreur 500 sur « Prochaine session », sans
 * indiquer quel parametre corriger. Meme famille que D-034, autre porte
 * d'entree — on refuse par une erreur METIER, qui dit quoi faire.
 */
function quantileDeRepli(parametres: Parametres): number {
  const cibleBp = parametres.pointsDeBase('quantile_cible_production_bp');
  if (cibleBp <= 0 || cibleBp >= BASE_POINTS) {
    throw new ErreurMetier(
      'quantile_cible_invalide',
      `Le quantile cible de production vaut ${cibleBp / 100} % : il doit être ` +
        'strictement compris entre 0 et 100 %. Corrigez le paramètre ' +
        '« quantile_cible_production_bp » dans Paramètres.',
    );
  }
  return cibleBp / BASE_POINTS;
}

/**
 * Manque a gagner ATTENDU quand une contrainte dure rabaisse la production.
 *
 * ## Pourquoi ce n'est pas « crepes perdues × marge »
 *
 * docs/03 illustre ce chiffre par « ramenée de 210 à 180 crêpes — manque à
 * gagner estimé : 94 € », soit 30 × 3,15 €. Cette formule suppose que les 30
 * crepes retirees se seraient TOUTES vendues. C'est faux par construction :
 * l'ecretage retire les crepes du HAUT de la distribution, precisement celles
 * qu'on ne vend que les tres bons jours. A 180 crepes on couvre deja 84 % de la
 * demande ; les 30 suivantes ne rapportent, en esperance, que 3,3 ventes.
 *
 * Et produire ces 30 crepes coute la matiere des 26,7 qui finiront a la
 * poubelle. Le vrai manque a gagner est la difference de PROFIT ESPERE :
 *
 *     ΔP = (Cu + Co)·(V(Qr) − V(Qc)) − Co·(Qr − Qc)
 *
 * ou V(Q) = E[min(D, Q)] sont les ventes esperees a production Q.
 *
 * Sur l'exemple meme de docs/03 : 3,74 € et non 94,50 €, soit 25 fois moins.
 * L'ecart importe parce que ce chiffre est presente comme celui qui
 * « justifiera un investissement futur (troisième plaque, camionnette) » :
 * surestime d'un facteur 25, il justifie un achat qui ne se rembourserait
 * jamais.
 *
 * DIVERGENCE ASSUMEE avec la lettre de docs/03, documentee dans
 * docs/15-AUDIT-MOTEUR-PREVISION.md.
 */
export function manqueAGagnerEcretage(entree: {
  crepesRecommandees: number;
  crepesRetenues: number;
  mediane: number;
  sigma: number;
  coutRuptureCents: Centimes;
  coutInvenduCents: Centimes;
}): Centimes {
  const { crepesRecommandees: recommandees, crepesRetenues: retenues } = entree;
  if (retenues >= recommandees) return 0;

  const ventesSansContrainte = ventesEsperees(recommandees, entree.mediane, entree.sigma);
  const ventesAvecContrainte = ventesEsperees(Math.max(0, retenues), entree.mediane, entree.sigma);

  const marge =
    (entree.coutRuptureCents + entree.coutInvenduCents) *
      (ventesSansContrainte - ventesAvecContrainte) -
    entree.coutInvenduCents * (recommandees - Math.max(0, retenues));

  // Ecrete a zero : quand le ratio critique n'a pas pu etre calcule, la
  // quantite recommandee ne maximise plus le profit et la difference peut
  // devenir negative. Afficher un manque a gagner negatif n'aurait aucun sens.
  return Math.max(0, Math.round(marge));
}

/**
 * Calcule la prevision et la quantite a produire.
 *
 * Le point le plus important : **on ne produit JAMAIS la mediane**. Le cout
 * d'une rupture (marge complete perdue, ~3,15 €) et celui d'un invendu (matiere,
 * ~0,25 €) ne sont pas symetriques, donc le niveau optimal est le quantile de la
 * demande au ratio critique — soit environ 90 %, pas 50 %.
 */
export function prevoir(entree: EntreePrevision, parametres: Parametres): ResultatPrevision {
  // `Number.isFinite` et pas seulement `<= 0` : avec `prevision_poids_prior_k`
  // a zero — un parametre modifiable a l'ecran — et aucune session observee,
  // `calculerBaseline` rend `NaN`, que `NaN <= 0` laisse passer. L'ecran
  // affichait alors « NaN crêpes » au lieu de dire ce qui manque.
  if (!Number.isFinite(entree.baselineCrepes) || entree.baselineCrepes <= 0) {
    throw new ErreurMetier(
      'baseline_invalide',
      'La baseline de fréquentation doit être strictement positive. ' +
        'Renseignez-la dans Paramètres avant la première prévision.',
    );
  }

  const meteoPrior = entree.meteo === null ? null : facteurMeteo(entree.meteo, parametres);
  // Le facteur MESURE prime des qu'il est fourni (D-059) ; sinon, prior ;
  // sinon (pas de meteo du tout, mode degrade), neutre.
  const meteoBpRetenu = entree.meteoFacteurBp ?? meteoPrior?.facteurBp ?? BASE_POINTS;
  const meteoExplicationRetenue = entree.meteoExplication ?? meteoPrior?.explication ?? null;

  const facteurs: FacteursPrevision = {
    meteoBp: meteoBpRetenu,
    evenementBp: entree.evenementBp ?? BASE_POINTS,
    saisonBp: entree.saisonBp ?? BASE_POINTS,
    tendanceBp: entree.tendanceBp ?? BASE_POINTS,
    comparableCalendaireBp: entree.comparableCalendaireBp ?? BASE_POINTS,
    jourSemaineBp: entree.jourSemaineBp ?? BASE_POINTS,
    vacancesScolairesBp: entree.vacancesScolairesBp ?? BASE_POINTS,
    sessionConsecutiveBp: entree.sessionConsecutiveBp ?? BASE_POINTS,
  };

  // Modele multiplicatif. Forme choisie pour etre additive dans l'espace
  // logarithmique : une regression lineaire sur log(ventes) pourra remplacer les
  // priors sans changer la structure du code (docs/03).
  //
  // Volontairement NON arrondi : c'est l'entree d'une chaine multiplicative, et
  // arrondir ici propageait jusqu'a une crepe d'ecart sur la recommandation
  // finale (le facteur exp(sigma·z) vaut 1,66 aux couts reels du projet). On
  // n'arrondit qu'a la sortie.
  const demandeAttendue =
    entree.baselineCrepes *
    (facteurs.meteoBp / BASE_POINTS) *
    (facteurs.evenementBp / BASE_POINTS) *
    (facteurs.saisonBp / BASE_POINTS) *
    (facteurs.tendanceBp / BASE_POINTS) *
    (facteurs.comparableCalendaireBp / BASE_POINTS) *
    (facteurs.jourSemaineBp / BASE_POINTS) *
    (facteurs.vacancesScolairesBp / BASE_POINTS) *
    (facteurs.sessionConsecutiveBp / BASE_POINTS);

  const sigmaMesure = sigmaRetenu(
    entree.nbSessionsObservees,
    entree.sigmaObserve ?? null,
    parametres,
  );
  // Inflation de l'incertitude par l'ecart meteo prevue/realisee
  // (docs/demandes/07 §2, predicteur 4). Neutre (10000) par defaut : sans
  // elle, `sigma` retrouve exactement `sigmaMesure`, donc aucun changement
  // pour un appelant qui ne fournit pas ce champ.
  const inflationSigmaMeteoBp = entree.inflationSigmaMeteoBp ?? BASE_POINTS;
  // Inflation liee a la distance calendaire (docs/demandes/06). Neutre par
  // defaut, se compose MULTIPLICATIVEMENT avec l'inflation meteo ci-dessus :
  // aucune des deux ne resserre jamais l'intervalle, donc leur produit non
  // plus (meme invariant, verifie sur chacune separement par leur source).
  const inflationSigmaHorizonBp = entree.inflationSigmaHorizonBp ?? BASE_POINTS;
  const sigma =
    sigmaMesure * (inflationSigmaMeteoBp / BASE_POINTS) * (inflationSigmaHorizonBp / BASE_POINTS);

  // La baseline est une MOYENNE ponderee d'observations : elle estime
  // l'esperance des ventes. La log-normale, elle, se parametre par sa MEDIANE.
  // Les deux different de exp(sigma²/2) et les confondre gonflait tous les
  // quantiles du meme facteur — 6,3 % a sigma = 0,35.
  const mediane = medianeDepuisEsperance(demandeAttendue, sigma);

  const p10 = Math.round(quantileLogNormal(mediane, sigma, 0.1));
  const p50 = Math.round(quantileLogNormal(mediane, sigma, 0.5));
  const p90 = Math.round(quantileLogNormal(mediane, sigma, 0.9));

  // --- Decision economique : newsvendor -----------------------------------
  // Quand un des deux couts manque, le ratio n'est pas calculable : on se rabat
  // sur le quantile cible parametre, dont la description dit exactement cela.
  // Jamais sur la mediane — « on ne produit JAMAIS la mediane » (docs/03).
  const ratio =
    ratioCritique(entree.coutRuptureCents, entree.coutInvenduCents) ?? quantileDeRepli(parametres);

  const crepesRecommandees = Math.round(quantileLogNormal(mediane, sigma, ratio));

  // --- Contraintes dures, appliquees APRES ---------------------------------
  let crepesRetenues = crepesRecommandees;
  let contrainteLimitante: string | null = null;
  for (const contrainte of entree.contraintes) {
    if (contrainte.plafondCrepes < crepesRetenues) {
      crepesRetenues = contrainte.plafondCrepes;
      contrainteLimitante = contrainte.libelle;
    }
  }

  const manqueAGagnerCents =
    contrainteLimitante === null
      ? null
      : manqueAGagnerEcretage({
          crepesRecommandees,
          crepesRetenues,
          mediane,
          sigma,
          coutRuptureCents: entree.coutRuptureCents,
          coutInvenduCents: entree.coutInvenduCents,
        });

  /**
   * Quatrieme contrainte dure de docs/03 : lue directement au catalogue,
   * jamais via `entree.contraintes`. C'est la SEULE facon pour `prevoir` de
   * distinguer « non renseignee, donc non controlee » de « renseignee mais
   * qui ne mord pas cette fois-ci » — les deux se traduisent, cote appelant
   * (`contraintesSession`), par l'absence de la contrainte dans la liste, et
   * seul le premier cas doit etre signale a l'ecran. 0 = NON RENSEIGNE : ne
   * JAMAIS le lire comme une absence de limite (l'erreur symetrique corrigee
   * sans relache dans ce depot).
   */
  const transportRenseigne = parametres.entier('transport_volume_pate_max_ml') > 0;

  // Plan de production (docs/17 fiche 5) : calcule sur `crepesRetenues`, ce
  // qui sera REELLEMENT produit — jamais sur la recommandation avant
  // ecretage. Tableau vide, jamais invente, si l'appelant n'a transmis aucune
  // recette exploitable (`entree.planProduction` absent).
  const resultatRepartition =
    entree.planProduction === undefined
      ? { lignes: [] as readonly LigneRepartitionProduction[], plancherApplique: false }
      : repartitionProduction(
          entree.planProduction.recettes,
          crepesRetenues,
          entree.planProduction.config,
        );

  return {
    baseline: entree.baselineCrepes,
    facteurs,
    demandeAttendue: Math.round(demandeAttendue),
    p10,
    p50,
    p90,
    quantileCibleBp: Math.round(ratio * BASE_POINTS),
    crepesRecommandees,
    crepesRetenues,
    contrainteLimitante,
    manqueAGagnerCents,
    confianceBp: confianceBp(
      entree.nbSessionsObservees,
      parametres.entier('prevision_demi_confiance_sessions'),
    ),
    nbSessionsComparables: entree.nbSessionsObservees,
    explication: construireExplication({
      entree,
      facteurs,
      meteoExplication: meteoExplicationRetenue,
      inflationSigmaMeteoBp,
      inflationSigmaHorizonBp,
      demandeAttendue: Math.round(demandeAttendue),
      p50,
      p10,
      p90,
      ratio,
      crepesRecommandees,
      crepesRetenues,
      contrainteLimitante,
      manqueAGagnerCents,
      transportRenseigne,
    }),
    repartition: resultatRepartition.lignes,
    plancherSansGlutenApplique: resultatRepartition.plancherApplique,
  };
}

/**
 * Decomposition lisible, phrase par phrase.
 *
 * « L'utilisateur doit pouvoir contester chaque facteur » (docs/01 module 5).
 * Et la recommandation contredira souvent l'intuition — d'ou l'effort
 * pedagogique sur le « pourquoi produire plus que la mediane ».
 */
function construireExplication(contexte: {
  entree: EntreePrevision;
  facteurs: FacteursPrevision;
  meteoExplication: string | null;
  inflationSigmaMeteoBp: PointsDeBase;
  inflationSigmaHorizonBp: PointsDeBase;
  demandeAttendue: number;
  p50: number;
  p10: number;
  p90: number;
  ratio: number;
  crepesRecommandees: number;
  crepesRetenues: number;
  contrainteLimitante: string | null;
  manqueAGagnerCents: Centimes | null;
  /** Quatrieme contrainte dure de docs/03 — voir le commentaire sur `prevoir`. */
  transportRenseigne: boolean;
}): string[] {
  const facteur = (bp: PointsDeBase): string => (bp / BASE_POINTS).toFixed(2).replace('.', ',');
  const lignes: string[] = [];

  lignes.push(`Base historique : ${contexte.entree.baselineCrepes} crêpes.`);
  if (contexte.meteoExplication !== null) {
    lignes.push(`Météo (${contexte.meteoExplication}) : × ${facteur(contexte.facteurs.meteoBp)}.`);
  }
  if (contexte.facteurs.evenementBp !== BASE_POINTS) {
    lignes.push(`Événement : × ${facteur(contexte.facteurs.evenementBp)}.`);
  }
  if (contexte.facteurs.saisonBp !== BASE_POINTS) {
    lignes.push(`Saison : × ${facteur(contexte.facteurs.saisonBp)}.`);
  }
  if (contexte.facteurs.tendanceBp !== BASE_POINTS) {
    lignes.push(`Tendance : × ${facteur(contexte.facteurs.tendanceBp)}.`);
  }
  // Quatre predicteurs de docs/demandes/07 §2, MEME convention que les quatre
  // facteurs ci-dessus : une ligne seulement quand le facteur s'est ecarte du
  // neutre, c'est-a-dire seulement quand le predicteur s'est reellement
  // active. Un predicteur en demarrage a froid ne laisse ainsi ABSOLUMENT
  // AUCUNE trace dans l'explication — c'est la garantie de non-regression :
  // sur l'historique d'aujourd'hui, ces quatre lignes n'apparaissent jamais.
  if (contexte.facteurs.comparableCalendaireBp !== BASE_POINTS) {
    lignes.push(`Comparable calendaire : × ${facteur(contexte.facteurs.comparableCalendaireBp)}.`);
  }
  if (contexte.facteurs.jourSemaineBp !== BASE_POINTS) {
    lignes.push(`Jour de la semaine : × ${facteur(contexte.facteurs.jourSemaineBp)}.`);
  }
  if (contexte.facteurs.vacancesScolairesBp !== BASE_POINTS) {
    lignes.push(`Vacances scolaires : × ${facteur(contexte.facteurs.vacancesScolairesBp)}.`);
  }
  if (contexte.facteurs.sessionConsecutiveBp !== BASE_POINTS) {
    lignes.push(`Session précédente : × ${facteur(contexte.facteurs.sessionConsecutiveBp)}.`);
  }
  if (contexte.inflationSigmaMeteoBp !== BASE_POINTS) {
    lignes.push(
      `Incertitude élargie par la fiabilité météo récente : × ${facteur(contexte.inflationSigmaMeteoBp)} sur l'intervalle.`,
    );
  }
  if (contexte.inflationSigmaHorizonBp !== BASE_POINTS) {
    lignes.push(
      `Incertitude élargie par l'éloignement de l'échéance : × ${facteur(contexte.inflationSigmaHorizonBp)} sur l'intervalle — plus la date est lointaine, moins la météo, les événements et la tendance sont connus.`,
    );
  }
  // Deux chiffres distincts, et c'est voulu : la demande ATTENDUE est la
  // moyenne (le produit des facteurs, ce que l'utilisateur suit du regard), la
  // MEDIANE est le point qui coupe la distribution en deux. La demande etant
  // asymetrique, la seconde est toujours un peu plus basse que la premiere.
  lignes.push(
    `Demande attendue : ${contexte.demandeAttendue} crêpes ` +
      `(médiane ${contexte.p50}, fourchette ${contexte.p10} à ${contexte.p90}).`,
  );

  // Le passage pedagogique : la recommandation paraitra trop haute.
  const pourcent = Math.round(contexte.ratio * 100);
  lignes.push(
    `Une rupture coûte ${(contexte.entree.coutRuptureCents / 100).toFixed(2).replace('.', ',')} € ` +
      `de marge, un invendu ${(contexte.entree.coutInvenduCents / 100).toFixed(2).replace('.', ',')} € ` +
      `de pâte. On produit donc au niveau qui couvre ${pourcent} % des cas, pas 50 %.`,
  );
  lignes.push(`→ ${contexte.crepesRecommandees} crêpes.`);

  // Quatrieme contrainte dure de docs/03 : une valeur non renseignee ne doit
  // JAMAIS se lire comme une capacite illimitee. Message affiche quel que
  // soit le sort des trois autres contraintes — c'est le statut de CELLE-CI
  // qui est en jeu, pas celui des autres.
  if (!contexte.transportRenseigne) {
    lignes.push(
      "Volume transportable non renseigné — cette contrainte n'est pas contrôlée " +
        "(mesurez la capacité réelle de votre véhicule dans Paramètres pour l'activer).",
    );
  }

  if (contexte.contrainteLimitante !== null && contexte.manqueAGagnerCents !== null) {
    lignes.push(
      `Recommandation ramenée de ${contexte.crepesRecommandees} à ${contexte.crepesRetenues} crêpes — ` +
        `limite : ${contexte.contrainteLimitante}. Manque à gagner estimé : ` +
        `${(contexte.manqueAGagnerCents / 100).toFixed(2).replace('.', ',')} € ` +
        `(profit attendu perdu, pas la marge pleine sur les crêpes non produites : ` +
        `celles-ci ne se seraient vendues que les très bons jours).`,
    );
  }

  return lignes;
}

/**
 * Contraintes dures d'une session, dans l'ordre d'application de docs/03.
 *
 * Chacune est nommee : quand une contrainte mord, l'ecran doit le DIRE, parce
 * que c'est ce chiffre qui justifiera un jour un investissement — une troisieme
 * plaque, une camionnette.
 */
export function contraintesSession(entree: {
  fenetreMinutes: number;
  volumeParCrepeMl: number;
  stockMaximalCrepes: number | null;
  parametres: Parametres;
}): ContrainteProduction[] {
  const { parametres } = entree;
  const contraintes: ContrainteProduction[] = [];

  /**
   * Aucun plafond ne peut etre negatif — ni s'ecrire `NaN`.
   *
   * Le cas se rencontre : l'heure de fin d'un lieu saisie AVANT son heure de
   * debut donne une fenetre negative (l'appelant fait une simple soustraction),
   * et le plafond de cuisson descendait alors a −1020 crepes. `prevoir` retient
   * le plus petit plafond : la recommandation devenait negative et le manque a
   * gagner, gigantesque. Un plafond a zero dit la meme chose — « on ne peut
   * rien cuire » — sans corrompre le reste du calcul.
   */
  const plafond = (valeur: number): number =>
    Number.isFinite(valeur) ? Math.max(0, Math.floor(valeur)) : 0;

  const debitParHeure = parametres.entier('capacite_cuisson_crepes_par_heure');
  const margeService = parametres.pointsDeBase('marge_securite_service_bp');
  const heuresUtiles = (entree.fenetreMinutes / 60) * (margeService / BASE_POINTS);
  contraintes.push({
    libelle: 'capacité de cuisson',
    plafondCrepes: plafond(debitParHeure * heuresUtiles),
  });

  if (entree.volumeParCrepeMl > 0) {
    const volumeGlaciere = parametres.entier('glaciere_volume_utile_ml');
    contraintes.push({
      libelle: 'capacité de la glacière',
      plafondCrepes: plafond(volumeGlaciere / entree.volumeParCrepeMl),
    });
  }

  if (entree.stockMaximalCrepes !== null) {
    contraintes.push({
      libelle: "stock d'ingrédients",
      plafondCrepes: plafond(entree.stockMaximalCrepes),
    });
  }

  /**
   * Quatrieme contrainte dure de docs/03 (« volume maximal transportable sans
   * vehicule personnel »), absente du moteur jusqu'a l'audit du 30/07/2026.
   * Meme calcul que la glaciere (volume de pate / volume par crepe), meme
   * garde sur `volumeParCrepeMl` — et une garde SUPPLEMENTAIRE, propre a
   * cette contrainte : `transport_volume_pate_max_ml` vaut 0 par defaut au
   * catalogue, ce qui signifie « non renseigne », jamais « aucune limite ».
   * Tant qu'elle vaut 0, la contrainte n'est PAS ajoutee — on n'ecrete rien
   * au nom d'un chiffre qu'on ne connait pas (c'est `prevoir`, plus bas, qui
   * porte l'avertissement correspondant dans l'explication affichee).
   */
  if (entree.volumeParCrepeMl > 0) {
    const volumeTransportable = parametres.entier('transport_volume_pate_max_ml');
    if (volumeTransportable > 0) {
      contraintes.push({
        libelle: 'volume transportable',
        plafondCrepes: plafond(volumeTransportable / entree.volumeParCrepeMl),
      });
    }
  }

  return contraintes;
}
