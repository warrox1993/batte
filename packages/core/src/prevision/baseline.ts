/**
 * Baseline de frequentation — le « demarrage a froid » de docs/03.
 *
 * La question a laquelle ce module repond : « combien vend-on lors d'une session
 * NEUTRE, meteo et evenements neutralises ? » Toute la prevision se construit
 * ensuite en multipliant cette baseline par des facteurs.
 *
 * Deterministe et pur : aucune lecture de base, aucun acces reseau.
 */

import { BASE_POINTS, type PointsDeBase } from '../argent.js';
import type { Parametres } from '../parametres.js';
import { ecartType } from './statistiques.js';

/** Une session close, telle que le moteur a besoin de la voir. */
export type ObservationSession = {
  readonly dateSession: string;
  readonly crepesVendues: number;
  /** Facteurs qui s'appliquaient CE jour-la, pour pouvoir les retirer. */
  readonly meteoBp: PointsDeBase;
  readonly evenementBp: PointsDeBase;
  readonly saisonBp: PointsDeBase;
};

export type ResultatBaseline = {
  readonly baselineCrepes: number;
  readonly nbSessionsRetenues: number;
  /** Ecart-type des residus log, ou `null` si l'historique est trop court. */
  readonly sigmaObserve: number | null;
  /** Part du prior dans le resultat, en points de base. Decroit avec n. */
  readonly poidsPriorBp: PointsDeBase;
  readonly explication: string;
};

/**
 * Note sur `prevision_residus_minimum` (lu au catalogue) : c'est un seuil dur,
 * mais pas de la meme famille que celui qui a ete retire de la ponderation. Il
 * ne fait pas varier un resultat de facon non monotone, il REFUSE DE REPONDRE.
 * En dessous, `sigmaObserve` vaut `null` — un contrat explicite — et le moteur
 * bascule sur le coefficient de variation prior puis applique
 * `prevision_plancher_sigma_bp`, qui amortit la marche. Le raccord reste
 * imparfait ; il se corrigerait dans `moteur.ts` (melange progressif
 * prior/mesure), pas ici.
 */

/**
 * Age en jours de `dateSession` par rapport a `jourReference`. Negatif (ou
 * nul) si `dateSession` tombe apres `jourReference` ; `NaN` si l'une des deux
 * dates est illisible. Facteur commun a `calculerBaseline` (exclusion des
 * sessions futures) et `poidsTemporel` (decroissance par recence) : une seule
 * formule d'age, jamais deux qui pourraient diverger.
 *
 * EXPORTEE : `saison.ts` partage cette meme formule d'age (voir son en-tete
 * de module) — c'etait auparavant une seconde implementation qui ne filtrait
 * pas les sessions futures, meme defaut que celui corrige ici pour
 * `calculerBaseline` (docs/05-DECISIONS.md D-089).
 */
export function ageEnJours(dateSession: string, jourReference: string): number {
  return (
    (Date.parse(`${jourReference}T12:00:00Z`) - Date.parse(`${dateSession}T12:00:00Z`)) / 86_400_000
  );
}

/**
 * Poids RELATIF d'une observation PASSEE, dans ]0 ; 1].
 *
 * Une session d'il y a deux ans en dit moins qu'une session du mois dernier,
 * mais elle en dit encore quelque chose : la decroissance est exponentielle,
 * jamais un couperet. Elle s'applique des la premiere session — voir la note de
 * `calculerBaseline` sur ce qui est conserve et ecarte de docs/03.
 *
 * Ne recoit jamais un age futur (<= 0 et fini) : `calculerBaseline` (et,
 * depuis la meme correction, `saisonBp`) exclut ces sessions AVANT d'appeler
 * cette fonction (voir plus bas, correction de la contamination
 * leave-one-out). Seul un age NaN (date illisible) atteint encore le test
 * ci-dessous.
 *
 * EXPORTEE : partagee avec `saison.ts`, qui portait sa propre copie
 * (`poidsRecence`) — meme formule, meme demi-vie de catalogue
 * (`prevision_demi_vie_ponderation_jours`), meme traitement du NaN. Seule la
 * VALEUR de demi-vie reste parametrable independamment par appelant (chacun
 * recoit son `demiVieJours` en argument) : partager le CALCUL ne force pas a
 * partager le PARAMETRE, si un jour la saison a besoin d'une demi-vie propre.
 */
export function poidsTemporel(ageJours: number, demiVieJours: number): number {
  // Date illisible : poids neutre. Une seule date aberrante ne doit pas
  // empoisonner (NaN) l'estimation entiere ; comme seuls les poids RELATIFS
  // comptent ici, 1 remet simplement cette observation au niveau de la plus
  // recente.
  if (!Number.isFinite(ageJours)) return 1;

  return 0.5 ** (ageJours / demiVieJours);
}

/**
 * Ventes qu'aurait donnees cette session si la meteo, l'evenement et la saison
 * avaient ete neutres. C'est ce qui rend deux sessions comparables.
 *
 * EXPORTEE (et non plus privee a ce module) : les nouveaux predicteurs de
 * `docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md` (comparable
 * calendaire, jour de semaine, session consecutive) ont besoin de la MEME
 * normalisation pour rester comparables a la baseline — une seconde
 * implementation aurait pu diverger de celle-ci sans qu'aucun test ne le voie.
 */
export function normaliserObservation(observation: ObservationSession): number {
  const facteur =
    (observation.meteoBp / BASE_POINTS) *
    (observation.evenementBp / BASE_POINTS) *
    (observation.saisonBp / BASE_POINTS);
  // Un facteur nul ou negatif n'a pas de sens et ferait exploser la division.
  return facteur > 0 ? observation.crepesVendues / facteur : observation.crepesVendues;
}

/**
 * Estimation bayesienne progressive de la baseline.
 *
 *     baseline = (k × prior + n × moyenne_des_observations_ponderee_par_recence)
 *                / (k + n)
 *
 * Le prior pese comme `k` sessions et s'efface tout seul : apres 12 sessions il
 * ne represente plus qu'un cinquieme du resultat. C'est ce qui permet a
 * l'application de donner un chiffre defendable DES le premier marche, sans
 * jamais pretendre qu'il vaut une mesure.
 *
 * ## Ce que cette forme corrige, et pourquoi
 *
 * docs/03 demande deux choses : une moyenne bayesienne de denominateur `k + n`,
 * et une ponderation temporelle exponentielle (demi-vie 26 semaines) activee
 * « au-dela de 30 sessions ». Appliquees litteralement, les deux se
 * contredisent. En cumulant des poids inferieurs a 1, la ponderation fait
 * tomber la somme des poids de 30 a ≈ 21,3 pour des sessions hebdomadaires : a
 * la 31e session close, le poids du prior REMONTAIT de 9,1 % a 12,3 %. Ajouter
 * une donnee redonnait de l'importance a l'estimation de depart — l'inverse
 * exact de la promesse de docs/03, « il s'efface naturellement a mesure que les
 * donnees arrivent », et de ce qu'annonce le commentaire de `poidsTemporel`.
 *
 * CONSERVE de docs/03 :
 * - le denominateur `k + n`, donc la promesse verifiable « apres 12 sessions le
 *   prior ne pese plus que 20 % » (k = 3, 3/15) ;
 * - la forme exponentielle et la demi-vie de 26 semaines ;
 * - l'effet recherche : une vieille session compte moins qu'une recente.
 *
 * ECARTE de docs/03 :
 * - le seuil des 30 sessions. La ponderation s'applique des la premiere
 *   session, donc sans marche d'escalier. Elle ne changeait de toute facon
 *   presque rien sous ce seuil (sur un an de marches hebdomadaires, la plus
 *   ancienne pese encore 0,87 fois la plus recente), ce qui rend le seuil sans
 *   objet une fois la discontinuite retiree.
 * - la lecture « une vieille session apporte MOINS d'information au total ».
 *   Ici la recence redistribue le poids ENTRE les observations sans toucher a
 *   la masse totale, qui reste exactement n. Raison de fond : le prior est la
 *   donnee la PLUS ancienne du modele — un chiffre pose avant le premier marche
 *   et jamais remesure. Une regle de vieillissement qui lui rendrait de
 *   l'influence se retourne contre son propre principe.
 *
 * Consequence, et invariant teste : `poidsPriorBp` vaut exactement k / (k + n),
 * strictement decroissant. Une session de plus ne peut jamais rehausser le
 * prior, quelles que soient les dates de l'historique.
 */
export function calculerBaseline(
  observations: readonly ObservationSession[],
  jourReference: string,
  parametres: Parametres,
): ResultatBaseline {
  const prior = parametres.entier('prevision_prior_baseline_crepes');
  const k = parametres.entier('prevision_poids_prior_k');
  // Coefficients metier lus au catalogue, jamais codes en dur : la demi-vie de
  // recence et le minimum de residus sont des choix de modele, revisables.
  const demiVieJours = parametres.entier('prevision_demi_vie_ponderation_jours');
  const residusMinimum = parametres.entier('prevision_residus_minimum');

  // Une session datee APRES (ou le meme jour que) `jourReference` n'existe pas
  // encore pour ce calcul : en validation croisee leave-one-out
  // (`predicteurs-precision.ts`, `demandeSansNouveauPredicteur`), l'historique
  // transmis exclut la session ciblee mais peut encore contenir des sessions
  // POSTERIEURES a elle — le trou laisse par le retrait tombe au milieu d'une
  // serie chronologique, pas forcement a son extremite. Une reference
  // leave-one-out ne doit voir que ce qui PRECEDE le point retire, meme
  // principe deja applique par `tendanceBp` (voir tendance.ts). Une date
  // ILLISIBLE, elle, reste comptee au poids neutre par `poidsTemporel` plus
  // bas : comportement inchange et deja teste — seule une session FUTURE bien
  // formee est exclue ici.
  const observationsRetenues = observations
    .map((observation) => ({
      observation,
      age: ageEnJours(observation.dateSession, jourReference),
    }))
    .filter(({ age }) => !Number.isFinite(age) || age > 0);
  const nbSessions = observationsRetenues.length;

  let sommePoids = 0;
  let sommePonderee = 0;
  const normalisees: number[] = [];

  for (const { observation, age } of observationsRetenues) {
    const valeur = normaliserObservation(observation);
    const poids = poidsTemporel(age, demiVieJours);
    sommePoids += poids;
    sommePonderee += poids * valeur;
    normalisees.push(valeur);
  }

  // Division par la somme des poids : c'est une MOYENNE, pas un cumul. C'est
  // elle qui garde la masse d'information a n sessions tout en laissant les
  // recentes peser davantage. `sommePoids` est strictement positif des qu'il y
  // a une observation (`poidsTemporel` ne rend jamais 0).
  const moyenneRecence = sommePoids > 0 ? sommePonderee / sommePoids : 0;

  // n = 0 → (k × prior) / k = prior, l'application repond des l'installation.
  // k = 0 ET n = 0 → NaN assume : `prevoir` rejette une baseline non finie par
  // une erreur metier plutot que d'afficher « NaN crepes » (D-034).
  const baselineCrepes = Math.round((k * prior + nbSessions * moyenneRecence) / (k + nbSessions));

  // Residus dans l'espace logarithmique : c'est la que la demande est a peu
  // pres symetrique, et c'est l'hypothese de la loi log-normale utilisee
  // ensuite. Le filtre passe AVANT le comptage : une session a zero crepe n'a
  // pas de logarithme, et compter 8 observations pour n'en exploiter que 6
  // ferait mentir le seuil.
  const residus =
    baselineCrepes > 0
      ? normalisees.filter((v) => v > 0).map((v) => Math.log(v / baselineCrepes))
      : [];
  const sigmaObserve = residus.length >= residusMinimum ? ecartType(residus) : null;

  // Aucun poids temporel n'entre ici : la part du prior ne depend que du NOMBRE
  // de sessions closes, ce qui la rend monotone par construction.
  const poidsPriorBp = Math.round((k / (k + nbSessions)) * BASE_POINTS);

  return {
    baselineCrepes,
    nbSessionsRetenues: nbSessions,
    sigmaObserve,
    poidsPriorBp,
    explication: construireExplication(nbSessions, prior, poidsPriorBp),
  };
}

/**
 * D-082 (`docs/05-DECISIONS.md`) : seuil STRICT du démarrage à froid PAR LIEU.
 *
 * Zéro session close sur un lieu → aucune prévision n'est possible, jamais un
 * chiffre appuyé entièrement sur `prevision_prior_baseline_crepes` : « aucune
 * prévision » n'est pas « une prévision de zéro », et confondre les deux est
 * exactement le défaut que ce projet traque partout (CLAUDE.md §3 règle 2).
 *
 * Dès qu'UNE session est close, le mélange bayésien habituel de
 * `calculerBaseline` reprend intégralement, avec sa confiance déjà
 * décroissante (`poidsPriorBp` ci-dessus) — cette fonction ne touche à AUCUNE
 * formule du moteur, elle ne fait que NOMMER le seuil qui décide d'appeler
 * `calculerBaseline`/`prevoir` ou non pour un lieu donné.
 *
 * Centralisée ici plutôt que recopiée `=== 0` à chaque appelant, pour que les
 * DEUX écrans concernés appliquent EXACTEMENT le même seuil : « Prochaine
 * session » (`apps/api/src/routes/previsions.ts`, `previsionCourante`) et
 * « Où aller ? » (`apps/api/src/routes/opportunites.ts`, `previsionOpportunite`,
 * qui appliquait déjà ce seuil en dur avant que le porteur ne tranche D-082 ce
 * matin même).
 */
export function estPremierPassage(nbSessionsRetenues: number): boolean {
  return nbSessionsRetenues === 0;
}

function construireExplication(
  nbSessions: number,
  prior: number,
  poidsPriorBp: PointsDeBase,
): string {
  if (nbSessions === 0) {
    return (
      `Aucune session close : la base vient entièrement de l'estimation de départ ` +
      `(${prior} crêpes, paramètre « prevision_prior_baseline_crepes »).`
    );
  }

  const pourcentPrior = Math.round(poidsPriorBp / 100);
  const pluriel = nbSessions > 1 ? 's' : '';

  return (
    `${nbSessions} session${pluriel} close${pluriel}, météo et événements neutralisés. ` +
    `Les sessions récentes pèsent davantage que les anciennes (demi-vie 26 semaines), ` +
    `sans que le poids total de l'historique change. ` +
    `L'estimation de départ pèse encore ${pourcentPrior} %, et cette part ne remonte jamais.`
  );
}
