/**
 * Coût de déplacement et arbitrage entre lieux (docs/demandes/13-COUT-COMPLET-
 * ET-ARBITRAGE-ENTRE-LIEUX.md).
 *
 * Ce fichier porte plus que son nom ne le suggère : c'est le SEUL fichier de
 * `packages/core` accordé à cet agent pour cette fiche (zone d'écriture
 * exclusive du ticket, plusieurs autres agents travaillant en parallèle sur
 * `core/prevision/`, `core/recettes.ts`, etc.). Il regroupe donc TOUTE la
 * logique pure nécessaire à l'écran de comparaison : le coût kilométrique,
 * le coût d'emplacement, la fiabilité d'une baseline, et la composition
 * finale en marge nette attendue — CLAUDE.md §3 règle 1 exige que ce calcul
 * vive ici, jamais dans un composant React ou un handler Fastify.
 *
 * ## Le point central de la fiche : DEUX chiffres, pas un
 *
 * « Combien je gagne vraiment » (hors périmètre ici, docs/demandes/13 §2.1)
 * inclut TOUTES les charges, fixes comprises (assurance, cotisations,
 * amortissements). « Quel marché faire » (ce que ce fichier calcule) n'inclut
 * QUE ce qui varie selon le lieu choisi : matière, emplacement, déplacement,
 * gaz. Un écran qui mélangerait les deux écraserait l'écart entre lieux sous
 * des charges fixes identiques partout — voir `calculerMargeAttendueLieu`.
 *
 * ## NULL veut dire inconnu, jamais zéro
 *
 * Même principe que `mode_cloture` (D-057) et que le coût inconnu d'un
 * ingrédient : une distance ou un tarif d'emplacement non renseigné rend la
 * marge nette attendue INCALCULABLE pour ce lieu, pas nulle. Chaque fonction
 * ci-dessous propage `null` plutôt que de deviner un zéro qui classerait à
 * tort ce lieu premier de la comparaison.
 */

import type { ModeTarification } from './contrats/referentiel.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Coût de déplacement
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Coût de déplacement ALLER-RETOUR d'une session, en centimes d'euro.
 *
 * Un seul coût kilométrique tout compris (carburant, pneus, entretien) —
 * décision du porteur, aucune valorisation du temps de trajet
 * (`cout_kilometrique_cents_par_km`, docs/demandes/13 §3). Le trajet compte
 * TOUJOURS 2× la distance aller simple : on suppose un aller-retour
 * systématique — **hypothèse du porteur**, sauf enchaînement de deux marchés
 * le même jour, qui reste **[À TRANCHER]** (docs/demandes/13 §5.3) et n'est
 * donc pas modélisé ici.
 *
 * `null` si la distance n'est pas renseignée : `lieu_marche.distance_km` est
 * NULLABLE et `NULL` veut dire « inconnue », jamais « zéro ». Un coût de
 * déplacement inconnu ne doit jamais s'afficher comme 0 €, ce qui laisserait
 * croire à un déplacement gratuit et classerait ce lieu à tort en tête de la
 * comparaison.
 */
export function coutDeplacementSessionCents(
  distanceKmAllerSimple: number | null,
  coutKilometriqueCentsParKm: number,
): number | null {
  if (distanceKmAllerSimple === null) return null;
  return Math.round(distanceKmAllerSimple * 2 * coutKilometriqueCentsParKm);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Imputation d'une TOURNÉE réelle (D-064, point 4)
   ═══════════════════════════════════════════════════════════════════════════

   `coutDeplacementSessionCents` ci-dessus répond à « avant d'y aller, qu'est-ce
   que CE lieu coûterait, seul ? » — l'ESTIMATION théorique qui sert à
   l'arbitrage entre lieux (docs/demandes/13). Ce qui suit répond à une
   question différente, posée APRÈS coup : la tournée réellement roulée
   (`session_marche.distance_reelle_km`) a pu dépasser ce que CETTE session,
   seule, aurait coûté — domicile → marché → parfois un autre marché → parfois
   un fournisseur → retour (D-064). À qui appartient le dépassement ?

   La règle tranchée par le porteur : la session porte ce qu'elle aurait coûté
   SEULE — 2 × la distance de référence du lieu — et les kilomètres AU-DELÀ
   sont attribués aux achats. Ce n'est pas une clé de répartition arbitraire :
   ces kilomètres en trop sont RÉELLEMENT CAUSÉS par le détour. Sans cette
   règle, un passage chez le meunier dégraderait la marge du marché et
   pourrait inverser l'arbitrage entre deux lieux — précisément ce que la
   fiche 13 existe pour éviter. */

export type ImputationTourneeDeplacement = {
  /**
   * Part du coût réel imputée à LA SESSION : ce qu'elle aurait coûté seule,
   * plafonnée à ce qui a été réellement roulé (jamais plus que la mesure
   * réelle — cas des marchés enchaînés). `null` uniquement quand le coût réel
   * est inconnu ou non séparable — jamais un défaut silencieux à 0.
   */
  readonly coutSessionCents: number | null;
  /**
   * Part du coût réel imputée AUX ACHATS : les kilomètres au-delà de ce que la
   * session aurait coûté seule. Toujours >= 0 — un détour ne peut jamais être
   * négatif, quelle que soit la tournée réellement roulée.
   */
  readonly coutDetourAchatsCents: number | null;
  /**
   * Coût réel total de la tournée, AVANT séparation entre les deux parts
   * ci-dessus. Connu dès que la distance réelle est saisie, même quand le
   * lieu n'a pas encore de distance de référence (cas 2 ci-dessous) : c'est
   * la SÉPARATION qui devient alors impossible, pas la mesure du total.
   */
  readonly coutTotalReelCents: number | null;
};

/**
 * Impute le coût réel d'une TOURNÉE entre la session de marché et les achats,
 * selon la règle du porteur (D-064, point 4) : la session porte ce qu'elle
 * aurait coûté SEULE, le détour au-delà va aux achats.
 *
 * Quatre cas, aucun deviné :
 *
 * 1. **Distance réelle non saisie** (`distanceReelleKm === null`) — le coût
 *    réel est INCONNU, jamais un repli silencieux sur l'estimation théorique
 *    de `coutDeplacementSessionCents`. Présenter une estimation comme une
 *    mesure serait exactement la faute que ce fichier interdit partout
 *    ailleurs (voir l'en-tête). Les trois champs sont `null`.
 *
 * 2. **Distance de référence du lieu inconnue**
 *    (`distanceReferenceKmAllerSimple === null`) — on ne peut pas savoir ce
 *    que la session aurait coûté SEULE, donc pas séparer sa part de celle du
 *    détour : imputer un chiffre précis à l'un ou l'autre serait une clé de
 *    répartition arbitraire, exactement ce que `coutEmplacementSessionCents`
 *    refuse déjà pour un tarif au mètre linéaire. Les deux parts restent
 *    `null`. Le coût TOTAL, lui, reste connu — il ne dépend que de la mesure
 *    réelle et du tarif kilométrique, aucune séparation requise — et le
 *    rendre `null` aussi cacherait une information qu'on a réellement.
 *
 * 3. **Distance réelle < 2 × la référence** (deux marchés enchaînés, par
 *    exemple : la seconde session ne coûte presque rien de plus) — le détour
 *    est plafonné à ce qui a été réellement roulé AU-DELÀ de la référence, et
 *    ne descend jamais sous zéro : la session ne porte jamais plus que ce qui
 *    a été réellement parcouru.
 *
 * 4. **Distance réelle == 2 × la référence** — aucun détour : la part achats
 *    est 0 (une vraie valeur mesurée, pas une inconnue) et la session porte
 *    tout le coût réel.
 *
 * Centimes entiers : on arrondit le coût TOTAL une seule fois, puis la part
 * détour une seule fois à partir des kilomètres de détour non arrondis ; la
 * part session est ENSUITE dérivée par SOUSTRACTION (`total - détour`),
 * jamais arrondie séparément. C'est ce qui garantit
 * `coutSessionCents + coutDetourAchatsCents === coutTotalReelCents` au
 * centime près, y compris sur des kilomètres qui ne tombent pas rond —
 * arrondir les deux parts indépendamment avant de sommer aurait pu perdre ou
 * créer un centime entre elles.
 */
export function imputationTourneeDeplacement(entrees: {
  readonly distanceReelleKm: number | null;
  readonly distanceReferenceKmAllerSimple: number | null;
  readonly coutKilometriqueCentsParKm: number;
}): ImputationTourneeDeplacement {
  // Cas 1 : rien n'a encore été relevé sur le terrain pour cette session.
  if (entrees.distanceReelleKm === null) {
    return { coutSessionCents: null, coutDetourAchatsCents: null, coutTotalReelCents: null };
  }

  const coutTotalReelCents = Math.round(
    entrees.distanceReelleKm * entrees.coutKilometriqueCentsParKm,
  );

  // Cas 2 : le total réel est mesurable, mais la référence du lieu manque
  // pour en isoler la part détour — on ne la devine pas.
  if (entrees.distanceReferenceKmAllerSimple === null) {
    return { coutSessionCents: null, coutDetourAchatsCents: null, coutTotalReelCents };
  }

  // Ce que la session aurait coûté SEULE (D-064) : l'aller-retour sur la
  // distance de référence. Le détour ne descend jamais sous zéro (cas 4,
  // aucun dépassement) et ne dépasse jamais ce qui a été réellement roulé
  // (cas 3, la session est alors plafonnée à la mesure réelle).
  const distanceSessionSeuleKm = entrees.distanceReferenceKmAllerSimple * 2;
  const distanceDetourKm = Math.max(0, entrees.distanceReelleKm - distanceSessionSeuleKm);

  const coutDetourAchatsCents = Math.round(distanceDetourKm * entrees.coutKilometriqueCentsParKm);
  const coutSessionCents = coutTotalReelCents - coutDetourAchatsCents;

  return { coutSessionCents, coutDetourAchatsCents, coutTotalReelCents };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Coût d'emplacement
   ═══════════════════════════════════════════════════════════════════════════ */

export type ResultatCoutEmplacement = {
  readonly cents: number | null;
  /** Explique un `cents` à `null` — jamais un silence sur pourquoi c'est inconnu. */
  readonly raisonIndisponible: string | null;
};

/**
 * Coût d'emplacement d'UNE session, déduit du tarif et du mode de
 * tarification du lieu (`lieu_marche.tarif_emplacement_cents` /
 * `mode_tarification`).
 *
 * Deux modes se traduisent directement en coût par session :
 * - `jour` : le tarif EST le coût de la session ;
 * - `forfait` : idem, un forfait par visite.
 *
 * Le troisième, `metre_lineaire_mois`, est un tarif MENSUEL — pas par
 * session. Le convertir exigerait une hypothèse sur le nombre de sessions
 * que ce lieu draine par mois, une convention de répartition tout aussi
 * arbitraire que celle que docs/demandes/13 §5.4 laisse explicitement
 * **[À TRANCHER]** au porteur pour les charges fixes annuelles. On ne la
 * devine pas ici : `cents` reste `null`, avec la raison.
 */
export function coutEmplacementSessionCents(lieu: {
  readonly tarifEmplacementCents: number | null;
  readonly modeTarification: ModeTarification | null;
}): ResultatCoutEmplacement {
  if (lieu.tarifEmplacementCents === null || lieu.modeTarification === null) {
    return {
      cents: null,
      raisonIndisponible: 'Tarif ou mode de tarification non renseigné pour ce lieu.',
    };
  }

  if (lieu.modeTarification === 'jour' || lieu.modeTarification === 'forfait') {
    return { cents: lieu.tarifEmplacementCents, raisonIndisponible: null };
  }

  return {
    cents: null,
    raisonIndisponible:
      'Tarif mensuel au mètre linéaire : la répartition par session n’est pas encore définie ' +
      '(docs/demandes/13 §5.4, laissé au porteur).',
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Fiabilité d'une baseline de lieu
   ═══════════════════════════════════════════════════════════════════════════ */

export type FiabiliteLieu = 'aucune_donnee' | 'peu_fiable' | 'fiable' | 'tres_fiable';

/**
 * Fiabilité d'une prévision de baseline pour un lieu, à partir du nombre de
 * sessions closes retenues (`calculerBaseline`, `prevision/baseline.ts`).
 *
 * « Une prévision pour un lieu où l'on n'est jamais allé ne vaut pas une
 * prévision pour La Batte » (docs/demandes/13, point 4) : les afficher au
 * même niveau tromperait la décision, donc l'écran de comparaison doit
 * pouvoir les distinguer.
 *
 * Les deux seuils sont PASSÉS PAR L'APPELANT plutôt que codés en dur ou
 * dupliqués au catalogue : ce sont EXACTEMENT `prevision_sessions_avant_
 * sigma_mesure` (8) et `prevision_sessions_sigma_fiable` (25), déjà au
 * catalogue de `packages/core/src/parametres.ts` pour la même notion
 * (« à partir de combien de sessions une mesure sur ce lieu tient-elle
 * debout ? »). Une seule notion, pas deux — même principe que le moteur de
 * prévision réutilise sa demi-vie de pondération partout ailleurs.
 */
export function fiabiliteLieu(
  nbSessionsRetenues: number,
  seuilPeuFiable: number,
  seuilFiable: number,
): FiabiliteLieu {
  if (nbSessionsRetenues <= 0) return 'aucune_donnee';
  if (nbSessionsRetenues < seuilPeuFiable) return 'peu_fiable';
  if (nbSessionsRetenues < seuilFiable) return 'fiable';
  return 'tres_fiable';
}

/* ═══════════════════════════════════════════════════════════════════════════
   Marge nette attendue par lieu — la composition complète
   ═══════════════════════════════════════════════════════════════════════════ */

export type EntreesMargeAttendueLieu = {
  /** Baseline de fréquentation neutre (météo/événement neutralisés), jamais négative. */
  readonly crepesPrevues: number;
  /** `null` : prix moyen non mesurable (aucune vente ni tarif affiché nulle part). */
  readonly prixMoyenCrepeCents: number | null;
  /** `null` : coût matière non mesurable. */
  readonly coutMatiereCrepeCents: number | null;
  /** `null` : coût gaz non mesuré (aucune session close nulle part encore). */
  readonly coutGazCrepeCents: number | null;
  /** `null` : voir `coutEmplacementSessionCents` — tarif absent ou mode non convertible. */
  readonly coutEmplacementSessionCents: number | null;
  /** `null` : voir `coutDeplacementSessionCents` — distance non renseignée. */
  readonly coutDeplacementSessionCents: number | null;
};

export type ResultatMargeAttendueLieu = {
  readonly caAttenduCents: number | null;
  readonly coutMatiereAttenduCents: number | null;
  readonly coutGazAttenduCents: number | null;
  readonly coutEmplacementCents: number | null;
  readonly coutDeplacementCents: number | null;
  /** `null` dès qu'UN SEUL des cinq composants est inconnu — jamais une marge partielle silencieuse. */
  readonly margeNetteAttendueCents: number | null;
};

/** `null` si `coutParCrepeCents` est `null`, sinon le produit arrondi au centime. */
function multiplierParCrepes(crepes: number, coutParCrepeCents: number | null): number | null {
  return coutParCrepeCents === null ? null : Math.round(crepes * coutParCrepeCents);
}

/**
 * Marge nette ATTENDUE d'un lieu : crêpes prévues → CA attendu → moins la
 * matière → moins l'emplacement → moins le déplacement → moins le gaz
 * (docs/demandes/13 « le nœud du sujet »).
 *
 * Volontairement RESTREINTE aux coûts DIFFÉRENTIELS entre lieux (docs/demandes/
 * 13 §2.2) : aucune charge fixe (assurance, cotisations INASTI, amortissements)
 * n'entre ici — ce sont elles qui écraseraient l'écart de quelques dizaines
 * d'euros entre deux lieux sous des centaines d'euros de charges identiques
 * partout. Le chiffre « combien je gagne vraiment », lui, les inclut TOUTES,
 * mais répond à une question différente (docs/demandes/13 §2.1) et vit
 * ailleurs (comptabilité générale et analytique).
 */
export function calculerMargeAttendueLieu(
  entrees: EntreesMargeAttendueLieu,
): ResultatMargeAttendueLieu {
  const caAttenduCents = multiplierParCrepes(entrees.crepesPrevues, entrees.prixMoyenCrepeCents);
  const coutMatiereAttenduCents = multiplierParCrepes(
    entrees.crepesPrevues,
    entrees.coutMatiereCrepeCents,
  );
  const coutGazAttenduCents = multiplierParCrepes(entrees.crepesPrevues, entrees.coutGazCrepeCents);

  const margeNetteAttendueCents =
    caAttenduCents !== null &&
    coutMatiereAttenduCents !== null &&
    coutGazAttenduCents !== null &&
    entrees.coutEmplacementSessionCents !== null &&
    entrees.coutDeplacementSessionCents !== null
      ? caAttenduCents -
        coutMatiereAttenduCents -
        entrees.coutEmplacementSessionCents -
        entrees.coutDeplacementSessionCents -
        coutGazAttenduCents
      : null;

  return {
    caAttenduCents,
    coutMatiereAttenduCents,
    coutGazAttenduCents,
    coutEmplacementCents: entrees.coutEmplacementSessionCents,
    coutDeplacementCents: entrees.coutDeplacementSessionCents,
    margeNetteAttendueCents,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Distance : SAISIE et CALCULÉE (docs/demandes/13 §5.2, option double n°2)
   ═══════════════════════════════════════════════════════════════════════════

   La fiche hésitait entre saisir la distance à la main ou la calculer depuis
   les coordonnées. Ce ne sont PAS deux choix concurrents : elles se
   complètent, avec une préséance stricte — « la calculée PRÉ-REMPLIT, la
   saisie FAIT FOI ». `lieu_marche.distance_km` (saisie, D-060) reste l'unique
   valeur qui entre jamais dans un coût ; ce qui suit ne fait QUE calculer une
   SUGGESTION, jamais un coût.

   Le piège que la fiche signale explicitement : une distance à vol d'oiseau
   n'est pas une distance routière (écart courant 20 à 40 %). Elle ne doit
   donc JAMAIS se substituer silencieusement à la distance confirmée — d'où
   les TROIS états ci-dessous, et non deux. */

const RAYON_TERRE_KM = 6371;

/**
 * Distance à VOL D'OISEAU entre deux coordonnées WGS84 (formule de
 * haversine), en kilomètres, non arrondie.
 *
 * CE N'EST PAS UNE DISTANCE ROUTIÈRE (docs/demandes/13 §5.2) : l'écart
 * courant est de 20 à 40 % sur le réseau réel. Cette fonction ne sert donc
 * QU'À CALCULER UNE SUGGESTION affichée sur l'écran « Lieux de marché » pour
 * pré-remplir `distance_km` — jamais à produire un coût. Aucune fonction de
 * coût de ce fichier ne l'appelle : `coutDeplacementSessionCents` ne lit que
 * la distance CONFIRMÉE (`lieu_marche.distance_km`), seule à faire foi.
 *
 * Ne décide PAS d'un point de départ (domicile unique ou par session,
 * docs/demandes/13 §5.1) : les deux coordonnées sont fournies par l'appelant,
 * quelles qu'elles soient. Cette question reste au porteur.
 */
export function distanceVolDoiseauKm(
  origine: { readonly latitude: number; readonly longitude: number },
  destination: { readonly latitude: number; readonly longitude: number },
): number {
  const versRadians = (degres: number): number => (degres * Math.PI) / 180;

  const deltaLatitude = versRadians(destination.latitude - origine.latitude);
  const deltaLongitude = versRadians(destination.longitude - origine.longitude);
  const latitudeOrigine = versRadians(origine.latitude);
  const latitudeDestination = versRadians(destination.latitude);

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitudeOrigine) * Math.cos(latitudeDestination) * Math.sin(deltaLongitude / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return RAYON_TERRE_KM * c;
}

export type EtatDistanceLieu = 'confirmee' | 'suggeree' | 'inconnue';

/**
 * Nomme lequel des TROIS états s'applique à la distance d'un lieu — jamais
 * deux (docs/demandes/13 §5.2, « le piège »).
 *
 * Ne calcule rien : elle ne fait que trancher entre les deux entrées déjà
 * calculées ailleurs, exactement comme `fiabiliteLieu` nomme un niveau de
 * confiance sans recalculer la baseline elle-même.
 *
 *  - `confirmee` : `distanceKmConfirmee` (`lieu_marche.distance_km`) est
 *    renseignée. C'est la SEULE valeur qui entre jamais dans un coût
 *    (`coutDeplacementSessionCents`) — la présence d'une suggestion ne change
 *    rien à ce cas, elle est simplement ignorée.
 *  - `suggeree` : aucune distance confirmée, mais une distance à vol d'oiseau
 *    a pu être calculée (`distanceVolDoiseauKm`). C'est un CHIFFRE À
 *    CORRIGER, présenté comme tel — jamais un coût affiché comme certain.
 *  - `inconnue` : ni l'une ni l'autre. Ce lieu ne peut pas encore être
 *    comparé aux autres sur la marge nette attendue.
 */
export function etatDistanceLieu(entrees: {
  readonly distanceKmConfirmee: number | null;
  readonly distanceSuggereeKm: number | null;
}): EtatDistanceLieu {
  if (entrees.distanceKmConfirmee !== null) return 'confirmee';
  if (entrees.distanceSuggereeKm !== null) return 'suggeree';
  return 'inconnue';
}

/* ═══════════════════════════════════════════════════════════════════════════
   Coût kilométrique : FORFAIT et MESURÉ (docs/demandes/13 §3.1, option
   double n°1)
   ═══════════════════════════════════════════════════════════════════════════

   Même patron que D-059 (« les facteurs ne se demandent pas, ils
   s'apprennent ») : le MESURÉ prime sur le FORFAIT, mais seulement quand il
   repose sur assez de données pour valoir quelque chose. En dessous, on
   reste sur le forfait — et l'écran dit TOUJOURS lequel des deux
   s'applique, jamais un chiffre sans provenance. */

export type MesureCoutVehicule = {
  /** Somme des dépenses `categorie = 'carburant'`, NETTE des contre-écritures d'annulation. */
  readonly totalDepensesCarburantCents: number;
  /** Nombre de pleins RÉELS (montants strictement positifs uniquement, voir le dépôt). */
  readonly nbPleins: number;
  /** Kilomètres ALLER-RETOUR parcourus, déduits des sessions closes à distance connue. */
  readonly totalKmParcourus: number;
};

export type OrigineCoutKilometrique = 'forfait' | 'mesure';

export type CoutKilometriqueRetenu = {
  readonly centsParKm: number;
  readonly origine: OrigineCoutKilometrique;
  /** Phrase affichable telle quelle à l'écran — jamais reconstruite côté React. */
  readonly libelle: string;
};

/**
 * Précision à 4 décimales de centime (2 décimales d'euro par km) : le forfait
 * officiel est publié au dix-millième d'euro près (0,4761 €/km, D-060), et
 * `formaterMontant` (`argent.ts`), fixé à 2 décimales de CENTIME, ferait
 * disparaître cette précision sur une valeur qui n'est pas un montant mais un
 * TAUX.
 */
function formaterCoutParKm(centsParKm: number): string {
  return new Intl.NumberFormat('fr-BE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(centsParKm / 100);
}

/**
 * Décide entre le coût kilométrique FORFAITAIRE (catalogue,
 * `cout_kilometrique_cents_par_km`) et le coût MESURÉ (frais réels de
 * carburant divisés par les kilomètres parcourus, fiche 13 §3.1 voie B).
 *
 * Le mesuré ne prime que sous TROIS conditions cumulatives, jamais devinées :
 *  1. assez de pleins enregistrés (`nbPleins >= pleinsMinimum`) — sinon un ou
 *     deux pleins isolés (prix ponctuellement haut ou bas à la pompe) donnent
 *     un coût au km qui ne veut rien dire, exactement le défaut que D-059
 *     corrige pour les facteurs météo ;
 *  2. des kilomètres RÉELLEMENT parcourus (`totalKmParcourus > 0`) — sans
 *     quoi la division n'a pas de sens (jamais 0/0, jamais une division par
 *     zéro silencieuse) ;
 *  3. un coût mesuré strictement positif — un total nul ou négatif (toutes
 *     les dépenses annulées, par exemple) ne décrit rien de crédible.
 *
 * En dessous, le forfait s'applique — l'application reste TOUJOURS
 * fonctionnelle, jamais bloquée en attendant assez de pleins (CLAUDE.md §5,
 * même doctrine que le mode dégradé de l'IA). Le `libelle` rendu dit
 * TOUJOURS lequel des deux s'applique, avec sa valeur : jamais un coût
 * kilométrique affiché sans dire d'où il vient.
 */
export function coutKilometriqueRetenu(entrees: {
  readonly forfaitCentsParKm: number;
  readonly mesure: MesureCoutVehicule;
  readonly pleinsMinimum: number;
}): CoutKilometriqueRetenu {
  const centsParKmMesure =
    entrees.mesure.totalKmParcourus > 0
      ? entrees.mesure.totalDepensesCarburantCents / entrees.mesure.totalKmParcourus
      : null;

  const mesureFiable =
    centsParKmMesure !== null &&
    centsParKmMesure > 0 &&
    entrees.mesure.nbPleins >= entrees.pleinsMinimum;

  if (mesureFiable) {
    // `mesureFiable` vient d'être vérifié : `centsParKmMesure` n'est pas `null` ici.
    const valeur = centsParKmMesure as number;
    return {
      centsParKm: valeur,
      origine: 'mesure',
      libelle:
        `Mesuré sur vos frais réels : ${formaterCoutParKm(valeur)} €/km, ` +
        `sur ${entrees.mesure.nbPleins} pleins.`,
    };
  }

  return {
    centsParKm: entrees.forfaitCentsParKm,
    origine: 'forfait',
    libelle: `Forfait officiel : ${formaterCoutParKm(entrees.forfaitCentsParKm)} €/km.`,
  };
}
