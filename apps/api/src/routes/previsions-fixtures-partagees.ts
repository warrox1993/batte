/**
 * Paramètres PARTAGÉS des fixtures d'admission du moteur de prévision.
 *
 * POURQUOI CE FICHIER EXISTE — D-045 appliqué à une garde
 * (`docs/39-DOCTRINE-DES-AGENTS.md` §2).
 *
 * `previsions-fixtures-validation-croisee.test.ts` se présente comme une garde
 * structurelle : elle prétend rejouer la vraie validation croisée « sur les
 * fixtures corrigées » de `previsions.test.ts` pour confirmer qu'elles
 * franchissent honnêtement le seuil de plis évaluables.
 *
 * Elle n'en gardait pas les fixtures : elle en gardait une COPIE, retapée à la
 * main. Deux divergences mesurées le 01/08/2026 :
 *
 *  1. la garde utilisait un jeu de conditions météo CONSTANT là où la vraie
 *     fixture fait varier température, couverture nuageuse et vent d'une
 *     semaine à l'autre (tout en restant dans la même catégorie) ;
 *  2. le nombre de dimanches était écrit des deux côtés, indépendamment.
 *
 * Conséquence vérifiée PAR MUTATION : ramener le nombre de dimanches de 20 à 9
 * dans la vraie fixture — c'est-à-dire y rouvrir exactement le défaut que
 * D-089 a fermé — laissait la garde **verte**, ses cinq tests passant, pendant
 * que le vrai test rougissait. Une garde qui ne bouge pas quand la chose
 * gardée casse ne garde rien.
 *
 * Une garde qui prétend surveiller une fixture doit donc la **dériver**, pas la
 * recopier. Les deux fichiers importent désormais les valeurs ci-dessous, et
 * toute dérive de l'une se voit immédiatement dans l'autre.
 *
 * Ce module ne contient QUE des données de fixture et aucune logique métier :
 * il n'est importé que par des tests.
 */

import type { PeriodeVacances } from '@batte/core';

/**
 * Relevé météo d'une fixture. Type NOMMÉ plutôt qu'un `as const` : les
 * variantes saisonnières ci-dessous font varier chaque champ, et des types
 * littéraux (`24`, `5`, `1000`) les rendraient inassignables.
 */
export type ConditionsMeteoFixture = {
  readonly temperatureC: number;
  readonly precipitationsMm: number;
  readonly ventKmh: number;
  readonly couvertureNuageuseBp: number;
};

/** 24 °C, ciel dégagé : classé `ensoleille_tiede`, le trou de grille refermé par la fiche 2. */
export const METEO_TIEDE: ConditionsMeteoFixture = {
  temperatureC: 24,
  precipitationsMm: 0,
  ventKmh: 5,
  couvertureNuageuseBp: 1000,
};

/**
 * Nombre de dimanches de la fixture « signal fort ».
 *
 * N'EST PAS ARBITRAIRE. `estimerAvecMeteoMesuree` ne retient, dans chaque pli
 * du leave-one-out, que les sessions de la MÊME catégorie datées STRICTEMENT
 * AVANT la session évaluée (exclusion par DATE, pas par index — c'est ce que
 * D-089 a fermé). Sur N dimanches de même catégorie, le k-ième ne dispose que
 * de (k-1) prédécesseurs : il n'est évaluable que si (k-1) ≥ 8, donc k ≥ 9.
 * Le nombre de plis vaut donc (N-8), et il faut N ≥ 16 pour atteindre le
 * minimum de 8. N=9 (fixture d'origine, fautive) → 1 seul pli ; N=20 → 12.
 */
export const NB_DIMANCHES_SIGNAL_FORT = 20;

/** Nombre de plis honnêtement évaluables attendu pour `NB_DIMANCHES_SIGNAL_FORT`. */
export const PLIS_ATTENDUS_SIGNAL_FORT = NB_DIMANCHES_SIGNAL_FORT - 8;

/**
 * Ventes des dimanches « signal fort » : moyenne ~300, jamais une valeur
 * unique répétée. Un cycle COURT et DÉTERMINISTE plutôt qu'un tirage
 * aléatoire, pour rester reproductible sans être plat — moyenner n'importe
 * quel sous-ensemble de valeurs IDENTIQUES donne toujours le même résultat,
 * ce qui rendrait la mesure indiscernable d'un artefact d'échantillonnage.
 */
export const CYCLE_CREPES_SIGNAL_FORT = [270, 300, 330, 290, 310] as const;

/** Ventes de la fixture « aucune amélioration » : égales au prior de baseline, donc résidu neutre. */
export const CREPES_EGALES_AU_PRIOR = 120;

/**
 * Conditions météo de la semaine `indexSemaine`, variante saisonnière de
 * `METEO_TIEDE`.
 *
 * Reste dans la MÊME catégorie (`ensoleille_tiede` : ciel dégagé, température
 * entre `prevision_temp_douce_max_c` (22) et `prevision_temp_chaude_c` (26),
 * sous le seuil de vent fort de 40 km/h) mais ne répète jamais le même relevé
 * au degré près : un marché hebdomadaire étalé sur plusieurs mois ne traverse
 * pas vingt dimanches identiques.
 */
export function conditionsTiedeSaisonniere(indexSemaine: number): ConditionsMeteoFixture {
  const cycle = indexSemaine % 5;
  const temperatures = [23, 24.5, 26, 25, 22.5] as const;
  const couvertures = [500, 1500, 2500, 800, 3200] as const;
  const vents = [4, 7, 11, 6, 14] as const;
  return {
    temperatureC: temperatures[cycle]!,
    precipitationsMm: 0,
    ventKmh: vents[cycle]!,
    couvertureNuageuseBp: couvertures[cycle]!,
  };
}

/* ─── Fixture « jour de la semaine » ──────────────────────────────────────── */

/**
 * Nombre de semaines de la fixture « jour de la semaine » : douze dimanches ET
 * douze mercredis sur EXACTEMENT la même période.
 *
 * Les mercredis ne sont PAS groupés sur les dernières semaines — c'est
 * précisément ce qui rendait la fixture d'origine malhonnête après la
 * fermeture de la fuite leave-one-out (D-089) : chaque point évalué doit avoir,
 * dans son passé, un échantillon contenant honnêtement les DEUX jours.
 */
export const NB_SEMAINES_JOUR_SEMAINE = 12;

/** Ventes d'un dimanche : le jour porteur. */
export const CREPES_DIMANCHE = 150;

/** Ventes d'un mercredi : nettement plus faible, pour que « jour de semaine » ait un signal à mesurer. */
export const CREPES_MERCREDI = 40;

/**
 * Nombre de plis honnêtement évaluables attendu pour la fixture
 * « jour de la semaine » (12 + 12).
 *
 * PINNÉ À L'EXACT, et c'est le point : `plis >= minimum` et `admis === true`
 * sont deux propriétés MONOTONES DANS LE SENS DE LA FUITE — rouvrir la
 * contamination leave-one-out (transmettre à un pli des sessions POSTÉRIEURES
 * à la session évaluée) ne fait qu'AUGMENTER le nombre de plis et RENFORCER
 * l'admission. Les deux s'améliorent donc quand le défaut revient. Seule une
 * égalité exacte rougit dans les deux sens. Son homologue météo
 * (`PLIS_ATTENDUS_SIGNAL_FORT`) avait déjà cette garde ; celle-ci ne l'avait
 * pas.
 */
export const PLIS_ATTENDUS_JOUR_SEMAINE = 12;

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures d'ADMISSION des trois prédicteurs restés sans garde
   ═══════════════════════════════════════════════════════════════════════════

   POURQUOI ELLES EXISTENT. Cinq prédicteurs de précision sont câblés par
   `routes/previsions.ts`, chacun à trois endroits (l'appel à `prevoir`, la
   décomposition rendue, l'archivage). Deux seulement — « jour de la semaine »
   puis « écart météo » — avaient un test qui les voyait ACTIFS. Les trois
   autres (`comparableCalendaireBp`, `vacancesScolairesBp`,
   `sessionConsecutiveBp`) n'étaient jamais assertés autrement que
   `toBeUndefined()` / `toBeNull()` : leurs neuf sites de câblage pouvaient
   être SUPPRIMÉS sans qu'un seul test ne rougisse.

   POURQUOI LES CONSTRUCTEURS VIVENT ICI ET NON DANS LE TEST. Même raison que
   le reste de ce module (voir son en-tête) : la garde structurelle
   `previsions-fixtures-validation-croisee.test.ts` rejoue ces fixtures avec
   les fonctions PURES du moteur, et le test d'intégration les clôture en base.
   Deux consommateurs, une seule source — jamais une copie retapée qui reste
   verte pendant que l'original dérive.

   LE PIÈGE CENTRAL DE CES TROIS FIXTURES : LA CROSS-ACTIVATION. Si deux
   prédicteurs s'activent sur le même jeu de données, neutraliser l'un fait
   rougir le test de l'autre — et l'on croit avoir prouvé un câblage qu'on n'a
   pas prouvé. Chaque constructeur ci-dessous porte donc, en commentaire, ce
   qui garde les quatre AUTRES prédicteurs silencieux, et le test d'intégration
   l'assère explicitement. */

/**
 * Une session historique de fixture, telle qu'une clôture l'écrira en base.
 *
 * `crepesInvendues` n'est pas un champ : elle se déduit de
 * `crepesProduites − crepesVendues`, et c'est volontaire. Sans production
 * rattachée, `cloturerSession` EXIGE l'égalité exacte
 * `produites = vendues + invendues + cassées` — la porter comme champ
 * indépendant, c'était offrir un troisième chiffre à contredire.
 */
export type SessionFixture = {
  readonly dateSession: string;
  readonly crepesVendues: number;
  readonly crepesProduites: number;
};

/** Recule `n` jours à partir d'un jour civil `AAAA-MM-JJ` (midi UTC, jamais l'horloge du poste). */
function joursAvant(reference: string, n: number): string {
  const date = new Date(`${reference}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
}

/**
 * Session à écoulement NEUTRE : ni rupture, ni invendu important.
 *
 * ≈ 7,4 % d'invendu, ce qui tombe entre les deux seuils de
 * `session-consecutive.ts` (`prevision_session_consecutive_seuil_rupture_bp`
 * = 200 et `..._seuil_invendu_bp` = 1500). C'est ce qui garde le prédicteur
 * « session consécutive » silencieux partout où on ne veut pas le voir.
 */
function sessionNeutre(dateSession: string, crepesVendues: number): SessionFixture {
  return { dateSession, crepesVendues, crepesProduites: Math.ceil(crepesVendues * 1.08) };
}

/* ─── Fixture « comparable calendaire » ───────────────────────────────────── */

/**
 * Nombre d'années d'historique de la fixture « comparable calendaire ».
 *
 * N'EST PAS ARBITRAIRE. `comparableCalendaireBp` n'accepte comme comparable
 * qu'une observation âgée d'au moins
 * `prevision_comparable_calendaire_age_minimum_jours` (250) et tombant à
 * moins de `prevision_comparable_calendaire_fenetre_jours` (10) du jour
 * calendaire visé — donc au voisinage d'un ANNIVERSAIRE. Il lui en faut
 * ensuite `prevision_comparable_calendaire_annees_minimum` (2) années civiles
 * distinctes. Une cible située k années avant la session à venir ne dispose
 * que des années k+1 … N : elle n'est évaluable que si N − k ≥ 2. Avec N = 8,
 * les six années les plus récentes le sont, soit 6 × 6 = 36 plis — bien
 * au-dessus du minimum de 8 (`prevision_validation_croisee_points_minimum`).
 */
export const NB_ANNEES_COMPARABLE_CALENDAIRE = 8;

/**
 * Écart, en jours, entre deux rendez-vous d'une même année.
 *
 * HUIT SEMAINES, ET C'EST STRUCTURANT pour l'isolement : au-delà de
 * `prevision_session_consecutive_ecart_max_jours` (10), aucune session n'est
 * jamais « consécutive » à la précédente, donc le prédicteur « session
 * consécutive » ne peut PAS s'activer sur cette fixture — quelles que soient
 * les quantités produites. Un multiple de 7, pour que tous les rendez-vous
 * tombent le même jour de semaine et que « jour de la semaine » reste muet
 * lui aussi (`prevision_jour_semaine_jours_distincts_minimum` = 2).
 */
export const ECART_RENDEZ_VOUS_COMPARABLE_JOURS = 56;

/**
 * Six rendez-vous annuels, à six niveaux de fréquentation nettement séparés.
 *
 * L'indice 0 est celui de la session à venir : c'est le PIC de l'année (une
 * date à forte saisonnalité, la Chandeleur du commentaire de
 * `comparable-calendaire.ts`). C'est ce qui donne son SENS au test — le
 * facteur attendu est au-dessus du neutre — et c'est aussi ce qui rend le
 * prédicteur utile : la moyenne générale (≈ 180) ne peut pas voir ce pic,
 * seul le rendez-vous du même jour calendaire le voit.
 */
export const NIVEAUX_RENDEZ_VOUS_COMPARABLE = [300, 100, 140, 220, 120, 180] as const;

/**
 * Variation d'une année sur l'autre, en multiplicateur.
 *
 * Une fixture où huit années répéteraient les mêmes six nombres au crêpe près
 * serait « trop dégénérée pour discriminer » (docs/39 §3, troisième forme) :
 * on ne saurait pas si le prédicteur mesure un rendez-vous calendaire ou
 * recopie une constante. Cycle COURT et DÉTERMINISTE plutôt qu'un tirage
 * aléatoire, pour rester reproductible — même choix que
 * `CYCLE_CREPES_SIGNAL_FORT`.
 */
export const VARIATION_ANNUELLE_COMPARABLE = [1, 0.95, 1.05, 0.98, 1.03, 0.97, 1.02, 0.96] as const;

/**
 * Huit années × six rendez-vous, la plus ancienne d'abord.
 *
 * L'anniversaire de rang k est posé au multiple de 7 jours le plus proche de
 * 365,25 × k : un multiple de 7 pour garder le même jour de semaine (voir
 * `ECART_RENDEZ_VOUS_COMPARABLE_JOURS`), et calé sur l'année JULIENNE pour que
 * la dérive cumulée reste sous ±3,25 jours après huit ans — largement dans la
 * fenêtre de tolérance de 10 jours, y compris avec l'approximation « année non
 * bissextile » que fait `ecartCalendaireJours` (`calendrier.ts`). Un simple
 * pas de 364 jours (52 semaines) dériverait de 10 jours en huit ans et
 * sortirait de la fenêtre exactement au bord.
 */
export function sessionsComparableCalendaire(dateCible: string): SessionFixture[] {
  const sessions: SessionFixture[] = [];
  for (let annee = 1; annee <= NB_ANNEES_COMPARABLE_CALENDAIRE; annee += 1) {
    const anniversaire = joursAvant(dateCible, 7 * Math.round((365.25 * annee) / 7));
    const variation =
      VARIATION_ANNUELLE_COMPARABLE[(annee - 1) % VARIATION_ANNUELLE_COMPARABLE.length]!;
    for (let rang = 0; rang < NIVEAUX_RENDEZ_VOUS_COMPARABLE.length; rang += 1) {
      sessions.push(
        sessionNeutre(
          joursAvant(anniversaire, ECART_RENDEZ_VOUS_COMPARABLE_JOURS * rang),
          Math.round(NIVEAUX_RENDEZ_VOUS_COMPARABLE[rang]! * variation),
        ),
      );
    }
  }
  return sessions.sort((a, b) => (a.dateSession < b.dateSession ? -1 : 1));
}

/* ─── Fixture « vacances scolaires » ──────────────────────────────────────── */

/**
 * Nombre de dimanches de la fixture « vacances scolaires ».
 *
 * DEUX CONTRAINTES OPPOSÉES le fixent, et c'est pour ça qu'il est écrit ici
 * plutôt que choisi au jugé :
 *
 *  - PLANCHER — `facteurVacancesScolairesBp` exige
 *    `prevision_vacances_observations_minimum` (5) observations DANS et HORS
 *    vacances, comptées dans le passé de chaque pli. Avec le rythme ci-dessous
 *    (deux dimanches de congé toutes les neuf semaines), la cinquième
 *    observation « en vacances » n'arrive qu'au dix-neuvième dimanche : il en
 *    faut donc au moins 19 + 8 = 27 pour atteindre le minimum de plis.
 *
 *  - PLAFOND — l'historique doit rester SOUS 355 jours. Au-delà, une session
 *    vieille d'environ un an retombe à moins de dix jours calendaires de la
 *    cible tout en dépassant l'âge minimal de 250 jours : « comparable
 *    calendaire » commencerait à s'activer sur CETTE fixture, et neutraliser
 *    l'un des deux prédicteurs ferait rougir le test de l'autre. 42 dimanches
 *    couvrent 294 jours, ce qui laisse deux mois de marge.
 */
export const NB_DIMANCHES_VACANCES = 42;

/**
 * Rythme du calendrier scolaire de la fixture : deux dimanches de congé toutes
 * les neuf semaines.
 *
 * Approche le rythme réel de la Fédération Wallonie-Bruxelles depuis la
 * réforme de 2022 (environ sept semaines de cours, deux semaines de congé) —
 * mais ce n'est PAS une reprise du calendrier officiel, qui n'a pas sa place
 * dans un test : le vrai calendrier vit dans le paramètre
 * `prevision_vacances_scolaires_be_json`, à renseigner à la main depuis une
 * source officielle (CLAUDE.md §7).
 */
export const CYCLE_VACANCES_SEMAINES = 9;
export const NB_DIMANCHES_PAR_CONGE = 2;

/** Ventes d'un dimanche de congé scolaire : le groupe porteur. */
export const CREPES_EN_VACANCES = 240;
/** Ventes d'un dimanche hors congé : nettement plus faible, sinon rien à mesurer. */
export const CREPES_HORS_VACANCES = 120;

/**
 * Variation d'un dimanche à l'autre, en multiplicateur — même rôle que
 * `VARIATION_ANNUELLE_COMPARABLE` : deux groupes parfaitement constants ne
 * prouveraient pas qu'on mesure un effet plutôt qu'on recopie deux nombres.
 */
export const VARIATION_HEBDOMADAIRE_VACANCES = [1, 0.96, 1.04, 0.98, 1.02, 0.95] as const;

/**
 * Les dimanches et le calendrier scolaire qui les accompagne.
 *
 * Le calendrier est CONSTRUIT à partir de `dateCible`, jamais figé sur des
 * dates absolues : le test tourne n'importe quel jour de l'année, et une
 * fixture datée en dur y décrirait tôt ou tard un passé impossible (docs/39
 * §3, première forme).
 *
 * Les congés ne retombent PAS au même jour de l'année d'un cycle à l'autre —
 * le cycle de neuf semaines glisse volontairement dans le calendrier, comme
 * Pâques glisse dans le vrai. Sans ce glissement, « en vacances » deviendrait
 * un synonyme de « tel jour calendaire », et l'on ne saurait plus lequel des
 * deux prédicteurs mesure quoi.
 *
 * La dernière période couvre `dateCible` elle-même — c'est ce qui donne au
 * test son SENS attendu (facteur au-dessus du neutre, le groupe « en
 * vacances » étant le plus vendeur) — sans jamais atteindre le dimanche
 * précédent, qui doit rester hors congé.
 */
export function fixtureVacancesScolaires(dateCible: string): {
  readonly sessions: SessionFixture[];
  readonly periodes: PeriodeVacances[];
} {
  const sessions: SessionFixture[] = [];
  const periodes: PeriodeVacances[] = [];

  for (let index = 0; index < NB_DIMANCHES_VACANCES; index += 1) {
    const dateSession = joursAvant(dateCible, 7 * (NB_DIMANCHES_VACANCES - index));
    const rangDansCycle = index % CYCLE_VACANCES_SEMAINES;
    const enVacances = rangDansCycle < NB_DIMANCHES_PAR_CONGE;
    const niveau = enVacances ? CREPES_EN_VACANCES : CREPES_HORS_VACANCES;
    const variation =
      VARIATION_HEBDOMADAIRE_VACANCES[index % VARIATION_HEBDOMADAIRE_VACANCES.length]!;
    sessions.push(sessionNeutre(dateSession, Math.round(niveau * variation)));

    // Une période par congé, ouverte trois jours avant le premier dimanche et
    // refermée trois jours après le second : elle couvre les deux dimanches du
    // congé et ne mord jamais sur ceux qui l'encadrent (sept jours d'écart).
    if (rangDansCycle === 0 && index + NB_DIMANCHES_PAR_CONGE - 1 < NB_DIMANCHES_VACANCES) {
      periodes.push({
        nom: `Congé scolaire ${periodes.length + 1}`,
        debut: joursAvant(dateSession, 3),
        fin: joursAvant(dateSession, -(7 * (NB_DIMANCHES_PAR_CONGE - 1) + 3)),
      });
    }
  }

  periodes.push({
    nom: 'Congé scolaire en cours',
    debut: joursAvant(dateCible, 3),
    fin: joursAvant(dateCible, -10),
  });

  return { sessions, periodes };
}

/* ─── Fixture « session consécutive » ─────────────────────────────────────── */

/**
 * Nombre de dimanches de la fixture « session consécutive ».
 *
 * Le cycle de quatre ci-dessous rend DEUX plis évaluables par cycle (les deux
 * sessions qui suivent une rupture ou un invendu important) et demande trois
 * cycles d'échauffement — `prevision_session_consecutive_occurrences_minimum`
 * (3) occurrences passées avant de calibrer une ampleur. Il faut donc
 * 3 + 4 = 7 cycles pour atteindre les 8 plis minimum ; 41 dimanches en
 * fournissent 10 et demi, soit 14 plis — près du double, et 280 jours
 * d'historique, ce qui reste sous le plafond de 355 jours qui tiendrait
 * « comparable calendaire » éveillé (voir `NB_DIMANCHES_VACANCES`).
 *
 * IMPAIR ET NON MULTIPLE DE 4, délibérément : la dernière session doit être
 * une RUPTURE pour que le prédicteur s'active sur la session à venir. Avec
 * 41 sessions et un cycle de 4, l'index 40 retombe sur la phase 0.
 */
export const NB_DIMANCHES_SESSION_CONSECUTIVE = 41;

/**
 * Le cycle d'écoulement, phase par phase.
 *
 * Il décrit une oscillation qu'un commerce qui calibre encore sa production
 * connaît bien : on vend tout (rupture), donc on produit trop la fois
 * suivante (invendu important), donc on réduit, donc on vend tout à nouveau.
 *
 * LES CHIFFRES NE SONT PAS LIBRES. Le facteur rendu par
 * `sessionConsecutiveBp` est un RAPPORT DE RATIOS DE CROISSANCE (croissance
 * moyenne après l'état observé, divisée par la croissance moyenne après un
 * écoulement normal), mais le moteur l'applique multiplicativement à la
 * BASELINE, qui est un NIVEAU. Pour que la validation croisée l'admette, il
 * faut donc que `baseline × facteur` tombe près du niveau réellement atteint
 * après une rupture — ce que ces quatre valeurs réalisent (≈ 149 × 1,19 ≈ 177
 * contre 175 observés), là où un jeu de valeurs plausible mais non calibré
 * fait DÉGRADER le MAPE et se fait rejeter. Vérifié par exécution, pas
 * supposé.
 *
 * - `rupture` : tout est vendu, zéro invendu → sous
 *   `prevision_session_consecutive_seuil_rupture_bp` (200).
 * - `invendu_important` : 20 % de la production jetée → au-dessus de
 *   `prevision_session_consecutive_seuil_invendu_bp` (1500).
 * - les deux autres : ≈ 7,4 % d'invendu, donc `neutre` — ce sont elles qui
 *   fournissent la référence sans laquelle aucun rapport n'est calculable.
 */
export const CYCLE_ECOULEMENT_SESSION_CONSECUTIVE = [
  { crepesVendues: 150, crepesProduites: 150 },
  { crepesVendues: 175, crepesProduites: 189 },
  { crepesVendues: 140, crepesProduites: 175 },
  { crepesVendues: 130, crepesProduites: 141 },
] as const;

/**
 * Les dimanches de la fixture « session consécutive », la plus ancienne
 * d'abord, la plus récente (une rupture) sept jours avant `dateCible`.
 *
 * Sept jours : sous `prevision_session_consecutive_ecart_max_jours` (10),
 * sans quoi la session précédente serait jugée trop ancienne pour être
 * « consécutive » et le prédicteur resterait muet.
 */
export function sessionsSessionConsecutive(dateCible: string): SessionFixture[] {
  return Array.from({ length: NB_DIMANCHES_SESSION_CONSECUTIVE }, (_, index) => {
    const phase =
      CYCLE_ECOULEMENT_SESSION_CONSECUTIVE[index % CYCLE_ECOULEMENT_SESSION_CONSECUTIVE.length]!;
    return {
      dateSession: joursAvant(dateCible, 7 * (NB_DIMANCHES_SESSION_CONSECUTIVE - index)),
      crepesVendues: phase.crepesVendues,
      crepesProduites: phase.crepesProduites,
    };
  });
}
