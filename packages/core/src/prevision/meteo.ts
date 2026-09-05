/**
 * Facteur meteo, phase 1 : priors experts.
 *
 * « Ces valeurs sont des HYPOTHÈSES DE DÉPART, pas des vérités. Elles vivent
 * dans la table `parametre` et doivent être remplacées par des coefficients
 * estimés dès que possible » (docs/03).
 *
 * Piege a garder en tete, cite par la spec : la temperature joue dans DEUX SENS
 * OPPOSES — le froid reduit la frequentation du marche mais augmente l'attrait
 * d'une crepe chaude. Le facteur net est donc empirique par nature, et c'est
 * exactement pour cette raison qu'il faut mesurer plutot que raisonner.
 */

import { BASE_POINTS, type PointsDeBase } from '../argent.js';
import { ErreurMetier } from '../erreurs.js';
import type { Parametres } from '../parametres.js';

export type ConditionsMeteo = {
  /** Temperature moyenne sur la fenetre du marche, en degres Celsius. */
  readonly temperatureC: number;
  /** Precipitations cumulees sur la fenetre, en millimetres. */
  readonly precipitationsMm: number;
  readonly ventKmh: number;
  /** Couverture nuageuse en points de base (10000 = ciel entierement couvert). */
  readonly couvertureNuageuseBp: PointsDeBase;
};

export type CategorieMeteo =
  | 'pluie_continue'
  | 'averses'
  | 'couvert_sec'
  | 'ensoleille_doux'
  | 'ensoleille_chaud'
  | 'ensoleille_tiede'
  | 'ensoleille_frais'
  | 'sec_froid';

export type ResultatMeteo = {
  readonly categorie: CategorieMeteo;
  readonly facteurBp: PointsDeBase;
  readonly ventFort: boolean;
  /** Phrase prete a afficher : l'utilisateur doit pouvoir contester le facteur. */
  readonly explication: string;
};

const LIBELLE: Readonly<Record<CategorieMeteo, string>> = {
  pluie_continue: 'pluie continue',
  averses: 'averses',
  couvert_sec: 'couvert et sec',
  ensoleille_doux: 'ensoleillé et doux',
  ensoleille_chaud: 'ensoleillé et chaud',
  ensoleille_tiede: 'ensoleillé et tiède',
  ensoleille_frais: 'ensoleillé et frais',
  sec_froid: 'sec et froid',
};

const CLE_FACTEUR: Readonly<Record<CategorieMeteo, string>> = {
  pluie_continue: 'prevision_meteo_pluie_continue_bp',
  averses: 'prevision_meteo_averses_bp',
  couvert_sec: 'prevision_meteo_couvert_sec_bp',
  ensoleille_doux: 'prevision_meteo_ensoleille_doux_bp',
  ensoleille_chaud: 'prevision_meteo_ensoleille_chaud_bp',
  // Les deux cles ci-dessous REFERMENT les trous de docs/03 (docs/15 §1.2,
  // docs/17 fiche 2) : ciel degage entre la borne haute du « doux » et le
  // seuil de chaleur, et entre le seuil de froid et la borne basse du « doux ».
  // Au catalogue (`packages/core/src/parametres.ts`) avec un prior NEUTRE
  // (10000) et marque explicitement non mesure (D-059) : le decoupage des
  // categories est le prealable qui debloque la mesure, la valeur elle-meme
  // ne se devine jamais. Une fois assez de dimanches de chaque categorie
  // observes, `apps/api/src/routes/previsions.ts` calcule un facteur MESURE
  // et le substitue au prior s'il bat celui-ci en validation croisee
  // leave-one-out (`validerParLeaveOneOut`) — jamais avant.
  ensoleille_tiede: 'prevision_meteo_ensoleille_tiede_bp',
  ensoleille_frais: 'prevision_meteo_ensoleille_frais_bp',
  sec_froid: 'prevision_meteo_sec_froid_bp',
};

// Le seuil de couverture nuageuse est lu au catalogue, comme ses cinq voisins
// immediats (pluie, vent, temperatures). Il etait le seul de la famille a etre
// compile : une incoherence, pas une simplification.

/**
 * Refuse un releve meteo dont un champ serait non fini (`NaN`, `Infinity`).
 *
 * POURQUOI CETTE GARDE. `ConditionsMeteo` n'a pas de champ optionnel : le
 * contrat est que la journee est ENTIEREMENT connue, ou que l'appelant passe
 * `entree.meteo = null` a `prevoir()` (moteur.ts), qui retombe alors
 * PROPREMENT sur le facteur neutre, sans rien afficher (voir sa
 * documentation). Sans cette garde, un `NaN` isole sur un seul champ — une
 * temperature relevee mais une couverture nuageuse perdue, par exemple — ne
 * levait AUCUNE erreur : `NaN > 26`, `NaN < 5`, `NaN >= 10` valent tous
 * `false`, si bien que `classerMeteo` retombait en silence sur une branche
 * suivante et ressortait classe dans une categorie REELLE (`ensoleille_frais`
 * notamment, la derniere branche testee avant le repli `couvert_sec`) —
 * indiscernable d'une vraie mesure. Meme famille de defaut que D5/D-034
 * (`quantileLogNormal` qui levait deja pour un sigma non fini plutot que de
 * laisser `NaN` se propager) : une temperature absente doit REFUSER de
 * repondre, jamais se deguiser en temperature mesuree.
 */
function verifierConditionsFinies(conditions: ConditionsMeteo): void {
  const { temperatureC, precipitationsMm, ventKmh, couvertureNuageuseBp } = conditions;
  if (
    Number.isFinite(temperatureC) &&
    Number.isFinite(precipitationsMm) &&
    Number.isFinite(ventKmh) &&
    Number.isFinite(couvertureNuageuseBp)
  ) {
    return;
  }
  throw new ErreurMetier(
    'meteo_conditions_invalides',
    'Un relevé météo comporte une valeur manquante ou non numérique ' +
      `(température ${temperatureC} °C, précipitations ${precipitationsMm} mm, ` +
      `vent ${ventKmh} km/h, couverture nuageuse ${couvertureNuageuseBp} bp). ` +
      "Si la météo du jour n'est pas connue, transmettez « null » à la place d'un " +
      'relevé partiel : le moteur affiche alors honnêtement l’absence de météo au ' +
      'lieu de classer la journée dans une catégorie qu’elle n’a jamais mesurée.',
  );
}

/** Ciel suffisamment degage pour parler de temps ensoleille. */
function cielDegage(conditions: ConditionsMeteo, parametres: Parametres): boolean {
  return (
    conditions.couvertureNuageuseBp <
    parametres.pointsDeBase('prevision_couverture_ensoleille_max_bp')
  );
}

/**
 * Refuse un jeu de seuils qui rouvrirait un trou (ou un chevauchement) dans la
 * classification.
 *
 * POURQUOI CETTE GARDE, ET PAS SEULEMENT LES DEUX CATEGORIES CI-DESSOUS. Les
 * deux trous mesures (docs/15 §1.2 : ciel degage entre 5 et 10 °C, entre 22 et
 * 26 °C) sont refermes par `ensoleille_frais` et `ensoleille_tiede` — mais ces
 * quatre seuils restent des PARAMETRES modifiables a l'ecran. Une saisie qui
 * inverse deux d'entre eux (par exemple une borne « doux max » passee sous la
 * borne « doux min ») rouvrirait un trou demain, et `classerMeteo` retomberait
 * SANS RIEN DIRE sur `couvert_sec` — exactement le defaut que ce lot corrige.
 * « Aucun repli silencieux » (CLAUDE.md §4) : mieux vaut refuser bruyamment,
 * en nommant les parametres fautifs, qu'afficher un facteur neutre invente.
 *
 * L'ordre exige `tempFroide ≤ tempDouceMin ≤ tempDouceMax ≤ tempChaude` (des
 * egalites sont tolerees : elles degenerent une plage a largeur nulle, ce qui
 * n'ouvre aucun trou). Avec cet ordre, les cinq plages qui suivent couvrent
 * TOUT l'axe des temperatures pour un ciel degage, sans jamais se toucher ni
 * se chevaucher — la propriete est verifiee par une recherche exhaustive dans
 * `moteur.test.ts` (les tests de `classerMeteo` et `facteurMeteo` vivent la,
 * pas dans un fichier `meteo.test.ts` distinct).
 */
function verifierCoherenceTemperatures(seuils: {
  readonly tempFroide: number;
  readonly tempDouceMin: number;
  readonly tempDouceMax: number;
  readonly tempChaude: number;
}): void {
  const { tempFroide, tempDouceMin, tempDouceMax, tempChaude } = seuils;
  if (tempFroide <= tempDouceMin && tempDouceMin <= tempDouceMax && tempDouceMax <= tempChaude) {
    return;
  }
  throw new ErreurMetier(
    'seuils_meteo_incoherents',
    'Les seuils de température de la classification météo ne sont plus dans ' +
      `l'ordre attendu (froid ${tempFroide} ≤ doux min ${tempDouceMin} ≤ doux max ` +
      `${tempDouceMax} ≤ chaud ${tempChaude} °C). Corrigez « prevision_temp_froide_c », ` +
      '« prevision_temp_douce_min_c », « prevision_temp_douce_max_c » et ' +
      '« prevision_temp_chaude_c » dans Paramètres : un ordre incohérent rouvrirait un ' +
      'trou silencieux dans la classification météo.',
  );
}

/**
 * Classe les conditions dans l'une des huit categories de priors.
 *
 * L'ordre des tests compte : la pluie prime sur tout le reste, parce qu'elle
 * determine a elle seule si les gens sortent.
 *
 * ## Les deux TROUS de docs/03, refermes ici
 *
 * La table des priors de docs/03 ne couvrait pas tout le domaine : elle donne
 * un facteur au temps ensoleille entre 10 et 22 °C, puis au-dela de 26 °C, et
 * rien entre les deux ; meme chose entre 5 et 10 °C. Ces conditions
 * retombaient sur `couvert_sec`, dont le facteur neutre (1,00) etait un repli
 * SILENCIEUX (docs/15 §1.2, docs/17 fiche 2) — un dimanche ensoleille et tiede
 * traite comme un dimanche gris. `ensoleille_tiede` et `ensoleille_frais`
 * couvrent desormais ces deux plages avec leur propre parametre, jamais un
 * emprunt au voisin. Voir `verifierCoherenceTemperatures` pour la garantie
 * que ce trou ne peut pas se rouvrir silencieusement si les seuils changent.
 */
export function classerMeteo(conditions: ConditionsMeteo, parametres: Parametres): CategorieMeteo {
  verifierConditionsFinies(conditions);
  const seuilPluie = parametres.decimal('prevision_seuil_pluie_continue_mm');
  const tempDouceMin = parametres.decimal('prevision_temp_douce_min_c');
  const tempDouceMax = parametres.decimal('prevision_temp_douce_max_c');
  const tempChaude = parametres.decimal('prevision_temp_chaude_c');
  const tempFroide = parametres.decimal('prevision_temp_froide_c');
  verifierCoherenceTemperatures({ tempFroide, tempDouceMin, tempDouceMax, tempChaude });

  if (conditions.precipitationsMm > seuilPluie) return 'pluie_continue';
  if (conditions.precipitationsMm > 0) return 'averses';

  const ensoleille = cielDegage(conditions, parametres);

  if (ensoleille && conditions.temperatureC > tempChaude) return 'ensoleille_chaud';
  if (
    ensoleille &&
    conditions.temperatureC >= tempDouceMin &&
    conditions.temperatureC <= tempDouceMax
  ) {
    return 'ensoleille_doux';
  }
  // Trou refermé : ciel dégagé entre la borne haute du « doux » et le seuil de
  // chaleur (22-26 °C par défaut). Avant ce lot, ces journées retombaient sur
  // `couvert_sec` sans que rien ne le signale — cas réel du 28/07/2026, 25,3 °C
  // sous 13 % de nuages, affiché « couvert et sec, facteur 1,0000 ».
  if (ensoleille && conditions.temperatureC > tempDouceMax) return 'ensoleille_tiede';
  if (conditions.temperatureC < tempFroide) return 'sec_froid';
  // Second trou refermé : ciel dégagé entre le seuil de froid et la borne
  // basse du « doux » (5-10 °C par défaut). Même repli silencieux, même
  // correction.
  if (ensoleille) return 'ensoleille_frais';
  return 'couvert_sec';
}

/**
 * Facteur meteo complet, vent compris.
 *
 * Le vent fort se COMBINE aux autres categories au lieu de les remplacer
 * (docs/03 : « × 0,75, se combine aux lignes precedentes ») : un marche
 * ensoleille mais balaye par le vent n'est pas un marche ensoleille.
 */
export function facteurMeteo(conditions: ConditionsMeteo, parametres: Parametres): ResultatMeteo {
  const categorie = classerMeteo(conditions, parametres);
  const facteurBase = parametres.pointsDeBase(CLE_FACTEUR[categorie]);

  const seuilVent = parametres.decimal('prevision_seuil_vent_fort_kmh');
  const ventFort = conditions.ventKmh > seuilVent;
  const facteurVent = ventFort
    ? parametres.pointsDeBase('prevision_meteo_vent_fort_bp')
    : BASE_POINTS;

  const facteurBp = Math.round((facteurBase * facteurVent) / BASE_POINTS);

  // Avec les deux trous refermes et `verifierCoherenceTemperatures` en garde,
  // `couvert_sec` n'est plus JAMAIS classe sous un ciel degage : l'ancien
  // correctif de libelle (« ne pas dire couvert quand le ciel est degage »)
  // est devenu du code mort, retire pour ne pas laisser une branche que plus
  // aucun cas ne peut exercer (elle aurait fait chuter la couverture a 100 %).
  const libelle = LIBELLE[categorie];

  const explication = ventFort
    ? `${libelle}, vent ${Math.round(conditions.ventKmh)} km/h`
    : `${libelle}, ${Math.round(conditions.temperatureC)} °C`;

  return { categorie, facteurBp, ventFort, explication };
}
