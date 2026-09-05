/**
 * Opportunités — les événements qui CRÉENT une session, plutôt que d'en
 * moduler une (docs/demandes/14-EVENEMENTS-COMME-OPPORTUNITES.md).
 *
 * ## Le changement de nature, en une phrase
 *
 * `packages/core/src/evenements-decouverte.ts` traite un événement comme un
 * FACTEUR : il multiplie la fréquentation d'une session qui aurait eu lieu de
 * toute façon (« combien de crêpes en plus ? »). Ce fichier traite un
 * événement comme une OPPORTUNITÉ : un marché de Noël, un stand d'entreprise,
 * une fête médiévale sont des sessions qui n'existeraient PAS sans eux, avec
 * leur propre trajet, leur propre emplacement, leur propre marge nette
 * (« est-ce que j'y vais ? »). Les deux notions coexistent sur la MÊME table
 * `evenement` : `famille` (`grand_public` | `entreprise` | `marche_noel`) les
 * distingue, `famille = NULL` restant le cas historique (voir schema.ts,
 * migration 0018).
 *
 * ## Réutilise la fiche 13, ne la réécrit pas
 *
 * `calculerMargeAttendueLieu`, `coutDeplacementSessionCents`,
 * `coutEmplacementSessionCents` et `fiabiliteLieu` (`./deplacement.js`) portent
 * déjà TOUT le calcul « crêpes prévues → CA attendu → moins la matière, moins
 * l'emplacement, moins le déplacement, moins le gaz ». Ce fichier ne les
 * duplique pas : il les ÉTEND pour deux besoins que la fiche 13 ne couvrait
 * pas — une CAMPAGNE de plusieurs sessions (marché de Noël, §3.3) et une
 * famille dont la fréquentation ne vient PAS d'une baseline historique
 * (entreprise, §3.2).
 *
 * ## Les trois familles ne se prévoient PAS de la même façon (fiche 14 §3)
 *
 * - `grand_public` (fête médiévale, village gaulois, feu d'artifice) : la
 *   fréquentation d'un lieu jamais visité n'est PAS calculée ici — la fiche
 *   liste explicitement trois options concurrentes (affluence annoncée,
 *   session comparable, démarrage à froid de docs/03) SANS trancher laquelle
 *   retenir, et la consigne de ce lot est de NE PAS trancher à la place du
 *   porteur. Le lieu où une session a réellement eu lieu (`observationsDuLieu`
 *   non vide, mesuré au niveau de `apps/api/src/routes/opportunites.ts`) est
 *   la seule source qui n'invente rien : dans ce cas, et SEULEMENT dans ce
 *   cas, la fréquentation attendue est visible et vient du même mécanisme que
 *   la fiche 13 (`calculerBaseline`). Sans historique, la prévision reste
 *   SILENCIEUSE (`null`) — jamais un premier chiffrage inventé.
 * - `entreprise` : « le prédicteur naturel est l'effectif × un taux de prise,
 *   pas l'historique de fréquentation » (fiche 14 §3.2, décision déjà prise
 *   par le porteur, pas un [À TRANCHER]). `previsionCrepesEntreprise`
 *   implémente CETTE formule. Le taux de prise lui-même ne peut venir que de
 *   l'observation (D-059 : « les facteurs ne se demandent pas au porteur, ils
 *   s'apprennent ») : `session_marche.evenement_id` (migration 0020) relie
 *   désormais une session close à l'`evenement` entreprise qui l'a fait
 *   naître, et `tauxPriseEntrepriseObserve` (plus bas dans ce fichier) referme
 *   la boucle de mesure — voir sa documentation pour le PIÈGE qu'elle refuse
 *   explicitement : un taux mesuré chez une entreprise ne se transporte
 *   JAMAIS à une autre. Tant qu'une entreprise DONNÉE n'a pas assez
 *   d'observations à ELLE, `previsionCrepesEntreprise` reçoit un taux `null`
 *   pour elle et reste silencieuse — jamais un pourcentage deviné en guise de
 *   valeur « neutre » (contrairement à un facteur météo, il n'existe pas de
 *   taux de prise « neutre » : c'est le prédicteur ENTIER, pas un
 *   multiplicateur autour de 1).
 * - `marche_noel` : plusieurs jours consécutifs, déplacement et parfois
 *   emplacement répétés chaque jour. `nombreSessionsCampagne` retient
 *   l'HYPOTHÈSE explicite de la fiche (§3.3) — une session par jour — et non
 *   une campagne agrégée : c'est le seul des points [À TRANCHER] de la fiche
 *   qui vient avec une hypothèse de rédaction assumée, sur le même principe
 *   que l'aller-retour ×2 de la fiche 13 (D-060).
 */

import { BASE_POINTS, ratioEnPointsDeBase, type Centimes, type PointsDeBase } from './argent.js';
import type {
  FiabiliteLieu,
  ResultatCoutEmplacement,
  ResultatMargeAttendueLieu,
} from './deplacement.js';
import { calculerMargeAttendueLieu } from './deplacement.js';
import { ErreurMetier } from './erreurs.js';
import { joursEntre } from './horodatage.js';
import type { ModeTarification } from './contrats/referentiel.js';

/**
 * Famille d'opportunité — mêmes valeurs que `evenement.famille` (schema.ts).
 * Redéclarée plutôt qu'importée depuis `packages/db` : `packages/core` ne doit
 * jamais dépendre du schéma de base (même convention que `PorteeEvenement`
 * dans `evenements-decouverte.ts`).
 */
export type FamilleOpportunite = 'grand_public' | 'entreprise' | 'marche_noel';

/* ═══════════════════════════════════════════════════════════════════════════
   Nombre de sessions d'une opportunité — une campagne n'est pas une session
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Nombre de sessions que couvre une opportunité, du premier au dernier jour.
 *
 * `grand_public` et `entreprise` sont des occasions UNIQUES (une fête, une
 * pause de midi) : 1, quelles que soient les dates renseignées. `marche_noel`
 * s'étend sur plusieurs jours CONSÉCUTIFS — fiche 14 §3.3, hypothèse retenue
 * « une session par jour » — d'où le +1 : du 1er au 3 décembre inclus, ce sont
 * trois jours, pas deux.
 */
export function nombreSessionsCampagne(
  famille: FamilleOpportunite,
  dateDebut: string,
  dateFin: string,
): number {
  if (famille !== 'marche_noel') return 1;
  return Math.max(1, joursEntre(dateDebut, dateFin) + 1);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Prédicteur « entreprise » — effectif × taux de prise, pas une baseline
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Crêpes prévues pour un stand d'entreprise : effectif captif × taux de prise.
 *
 * `null` dès que l'un des deux est `null` — jamais un zéro qui laisserait
 * croire à une session sans acheteurs. `tauxPriseBp` doit venir d'une mesure
 * réelle (D-059) : voir l'en-tête de ce fichier sur l'absence actuelle de lien
 * entre une session close et l'événement entreprise qui l'a motivée. Tant que
 * ce lien n'existe pas, l'appelant doit passer `null`, et cette fonction rend
 * alors `null` — la prévision reste silencieuse plutôt que d'inventer un taux.
 *
 * `tauxPriseBp` n'est PAS plafonné à 10 000 (100 %) : ce n'est pas un
 * multiplicateur autour d'un neutre, c'est un nombre de crêpes par personne
 * présente, qui peut dépasser 1 si plusieurs employés reprennent une crêpe.
 */
export function previsionCrepesEntreprise(
  effectifEstime: number | null,
  tauxPriseBp: PointsDeBase | null,
): number | null {
  if (effectifEstime === null || tauxPriseBp === null) return null;

  if (!Number.isFinite(effectifEstime) || effectifEstime < 0) {
    throw new ErreurMetier(
      'effectif_estime_invalide',
      `L'effectif estimé doit être un nombre positif ou nul (reçu : ${effectifEstime}).`,
    );
  }
  if (!Number.isFinite(tauxPriseBp) || tauxPriseBp < 0) {
    throw new ErreurMetier(
      'taux_prise_invalide',
      `Le taux de prise doit être positif ou nul (reçu : ${tauxPriseBp}).`,
    );
  }

  return Math.round((effectifEstime * tauxPriseBp) / BASE_POINTS);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Taux de prise « entreprise » OBSERVÉ — la boucle de mesure (D-059)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une session CLOSE rattachée à LA MÊME entreprise (même `evenement.id`). */
export type ObservationTauxPriseEntreprise = {
  readonly effectifEstime: number;
  readonly crepesVendues: number;
};

export type MesureTauxPriseEntreprise = {
  /** `null` tant que `nbObservations < seuilObservationsMinimum` — jamais un taux trop jeune. */
  readonly tauxPriseBp: PointsDeBase | null;
  /** Nombre d'observations RETENUES (effectif > 0), toujours renseigné — y compris à 0. */
  readonly nbObservations: number;
};

/**
 * Taux de prise OBSERVÉ pour UNE SEULE entreprise, à partir des sessions
 * closes qui lui ont été rattachées (`session_marche.evenement_id`).
 *
 * ## Le piège : un taux ne se transporte pas d'une entreprise à une autre
 *
 * « Une entreprise de 200 personnes avec une cantine et une entreprise de 40
 * sans rien n'ont aucune raison d'avoir le même taux » : cette fonction ne
 * moyenne donc JAMAIS des observations venant de plusieurs `evenement.id`
 * distincts. L'appelant doit lui fournir UNIQUEMENT les observations d'UNE
 * SEULE entreprise (`sessionsEntrepriseFermees`,
 * `packages/db/src/depots/opportunites.ts`, qui filtre déjà sur un seul
 * `evenement_id`). Il n'existe volontairement AUCUNE fonction qui moyenne
 * « toutes les entreprises confondues » dans ce fichier : un tel chiffre
 * n'aurait pas de sens, mieux vaut qu'il n'existe pas.
 *
 * Une entreprise s'apprend donc UNIQUEMENT sur SES PROPRES visites passées.
 * `session_marche.evenement_id` n'est pas UNIQUE (migration 0020) : plusieurs
 * sessions peuvent rattacher LE MÊME `evenement`, exactement le cas d'une
 * entreprise visitée à plusieurs reprises — c'est ce qui permet à
 * l'observation de s'accumuler POUR ELLE, jamais pour une autre. La toute
 * première visite reste, elle, un pari : aucune observation n'existe encore.
 *
 * `seuilObservationsMinimum` est le paramètre de catalogue
 * `opportunite_entreprise_observations_minimum`
 * (`packages/core/src/parametres.ts`) : en dessous, `tauxPriseBp` reste
 * `null` — démarrage à froid, même principe que
 * `prevision_sessions_avant_sigma_mesure` ailleurs dans le moteur, mais à un
 * seuil bien plus bas : une entreprise se visite rarement plus de quelques
 * fois par an.
 */
export function tauxPriseEntrepriseObserve(
  observations: readonly ObservationTauxPriseEntreprise[],
  seuilObservationsMinimum: number,
): MesureTauxPriseEntreprise {
  // Un effectif <= 0 ne peut pas servir de dénominateur : écarté plutôt que
  // de produire un taux infini ou une division par zéro silencieuse.
  const valides = observations.filter((o) => o.effectifEstime > 0);

  // Le second terme, seul, ne suffirait pas : un seuil mal réglé à 0 (ou
  // négatif) rendrait `valides.length < seuilObservationsMinimum` faux même
  // à ZÉRO observation, et la moyenne d'un tableau vide vaudrait `NaN`.
  // Zéro observation n'est JAMAIS mesurable, quel que soit le seuil.
  if (valides.length === 0 || valides.length < seuilObservationsMinimum) {
    return { tauxPriseBp: null, nbObservations: valides.length };
  }

  const tauxParVisiteBp = valides.map((o) =>
    ratioEnPointsDeBase(o.crepesVendues, o.effectifEstime),
  );
  const moyenneBp = Math.round(
    tauxParVisiteBp.reduce((somme, v) => somme + v, 0) / tauxParVisiteBp.length,
  );

  return { tauxPriseBp: moyenneBp, nbObservations: valides.length };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Coûts d'une CAMPAGNE — le trajet et l'emplacement se répètent, pas la marge
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Coût d'emplacement total d'une campagne de `nbSessions` jours.
 *
 * Réutilise le coût PAR SESSION de `coutEmplacementSessionCents`
 * (`./deplacement.js`) sans le recalculer, et l'étend selon le mode de
 * tarification :
 * - `jour` : le tarif se paie CHAQUE jour → multiplié par `nbSessions`.
 * - `forfait` : un forfait couvre TOUTE la campagne par définition (c'est le
 *   sens même du mot) → compté UNE seule fois, jamais multiplié.
 * - `metre_lineaire_mois` ou `null` : déjà `null` en amont (tarif mensuel non
 *   convertible par session, D-060 point 5) — propagé tel quel.
 */
export function coutEmplacementCampagneCents(
  parSession: ResultatCoutEmplacement,
  modeTarification: ModeTarification | null,
  nbSessions: number,
): ResultatCoutEmplacement {
  if (parSession.cents === null) return parSession;
  const cents = modeTarification === 'jour' ? parSession.cents * nbSessions : parSession.cents;
  return { cents, raisonIndisponible: null };
}

/**
 * Coût de déplacement total d'une campagne : le trajet aller-retour se répète
 * CHAQUE jour (fiche 14 §3.3 : « le coût kilométrique est multiplié par le
 * nombre de jours »), contrairement à l'emplacement qui peut être forfaitaire.
 * `null` propagé tel quel : une distance inconnue reste inconnue pour toute la
 * campagne, pas seulement pour un jour.
 */
export function coutDeplacementCampagneCents(
  coutParSessionCents: Centimes | null,
  nbSessions: number,
): Centimes | null {
  return coutParSessionCents === null ? null : coutParSessionCents * nbSessions;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Fiabilité d'une opportunité — la distance vol d'oiseau est un indice en moins
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Dégrade la fiabilité d'une baseline (`fiabiliteLieu`, `./deplacement.js`)
 * quand la distance retenue n'est qu'une estimation À VOL D'OISEAU plutôt
 * qu'une distance ROUTIÈRE déclarée sur un lieu de marché.
 *
 * Une distance à vol d'oiseau sous-estime la distance réelle de 20 à 40 %
 * (docs/demandes/13 §5.2) : une opportunité dont la SEULE mesure de distance
 * est cette estimation ne peut jamais atteindre les deux paliers les plus
 * hauts (`fiable`, `tres_fiable`) — même avec un historique de sessions
 * suffisant, le coût de déplacement affiché resterait potentiellement
 * optimiste. `aucune_donnee` et `peu_fiable` ne sont jamais aggravés : ils
 * disent déjà « ne faites pas confiance à ce chiffre », la distance n'ajoute
 * rien à ce message.
 */
export function fiabiliteOpportunite(
  fiabiliteBaseline: FiabiliteLieu,
  distanceEstimeeVolDoiseau: boolean,
): FiabiliteLieu {
  if (!distanceEstimeeVolDoiseau) return fiabiliteBaseline;
  if (fiabiliteBaseline === 'tres_fiable' || fiabiliteBaseline === 'fiable') return 'peu_fiable';
  return fiabiliteBaseline;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Marge nette attendue d'une opportunité — la composition complète
   ═══════════════════════════════════════════════════════════════════════════ */

export type EntreesOpportunite = {
  readonly nbSessions: number;
  /**
   * Crêpes prévues pour UNE SEULE session/jour de l'opportunité. `null` :
   * fréquentation inconnue (grand public jamais visité, ou entreprise sans
   * taux de prise mesuré) — la marge entière devient alors incalculable,
   * jamais un zéro.
   */
  readonly crepesPrevuesParSession: number | null;
  readonly prixMoyenCrepeCents: Centimes | null;
  /**
   * `null` = coût matière inconnu, jamais un 0 déguisé. ATTENTION À
   * L'APPELANT (`apps/api/src/routes/opportunites.ts`, audit du 30/07/2026,
   * fiche 13) : `coutsNewsvendor(base).coutInvenduCents` (`@batte/db`) vaut
   * TOUJOURS un nombre, y compris `0` quand ni production ni recette au coût
   * connu n'existe — ce zéro est un SENTINELLE, pas une mesure. Vérifier
   * `coutsNewsvendor(base).coutInvenduConnu` avant de passer
   * `coutInvenduCents` ici ; se fier uniquement à « le prix moyen est
   * disponible » (`prixMoyenCrepeCents > 0`) ne suffit PAS, la formule
   * `coutRuptureCents + coutInvenduCents = prixMoyenCrepeCents` restant vraie
   * même quand `coutInvenduCents` est ce sentinelle.
   */
  readonly coutMatiereCrepeCents: Centimes | null;
  readonly coutGazCrepeCents: Centimes | null;
  readonly coutEmplacementParSession: ResultatCoutEmplacement;
  readonly modeTarification: ModeTarification | null;
  readonly coutDeplacementParSessionCents: Centimes | null;
};

export type ResultatOpportunite = ResultatMargeAttendueLieu & {
  readonly nbSessions: number;
  /** `crepesPrevuesParSession × nbSessions`, ou `null` si la fréquentation est inconnue. */
  readonly crepesPrevuesTotal: number | null;
  readonly coutEmplacementIndisponibleRaison: string | null;
};

/**
 * Marge nette ATTENDUE d'une opportunité, CAMPAGNE comprise.
 *
 * Pour une opportunité d'un seul jour (`nbSessions = 1`), ceci se réduit
 * EXACTEMENT à `calculerMargeAttendueLieu` (fiche 13) : aucune duplication de
 * la logique « CA − matière − emplacement − déplacement − gaz », seulement
 * l'agrégation de campagne qui l'entoure.
 *
 * Quand `crepesPrevuesParSession` est `null`, cette fonction n'appelle PAS
 * `calculerMargeAttendueLieu` (qui exige un nombre) : elle rend directement
 * une marge `null`, en conservant néanmoins les coûts de déplacement et
 * d'emplacement qui, eux, ne dépendent pas de la fréquentation et peuvent
 * rester connus même quand la vente ne l'est pas.
 */
export function margeNetteAttendueOpportunite(entrees: EntreesOpportunite): ResultatOpportunite {
  const coutEmplacement = coutEmplacementCampagneCents(
    entrees.coutEmplacementParSession,
    entrees.modeTarification,
    entrees.nbSessions,
  );
  const coutDeplacementCents = coutDeplacementCampagneCents(
    entrees.coutDeplacementParSessionCents,
    entrees.nbSessions,
  );

  if (entrees.crepesPrevuesParSession === null) {
    return {
      caAttenduCents: null,
      coutMatiereAttenduCents: null,
      coutGazAttenduCents: null,
      coutEmplacementCents: coutEmplacement.cents,
      coutDeplacementCents,
      margeNetteAttendueCents: null,
      nbSessions: entrees.nbSessions,
      crepesPrevuesTotal: null,
      coutEmplacementIndisponibleRaison: coutEmplacement.raisonIndisponible,
    };
  }

  const crepesPrevuesTotal = entrees.crepesPrevuesParSession * entrees.nbSessions;

  const margeNette = calculerMargeAttendueLieu({
    crepesPrevues: crepesPrevuesTotal,
    prixMoyenCrepeCents: entrees.prixMoyenCrepeCents,
    coutMatiereCrepeCents: entrees.coutMatiereCrepeCents,
    coutGazCrepeCents: entrees.coutGazCrepeCents,
    coutEmplacementSessionCents: coutEmplacement.cents,
    coutDeplacementSessionCents: coutDeplacementCents,
  });

  return {
    ...margeNette,
    nbSessions: entrees.nbSessions,
    crepesPrevuesTotal,
    coutEmplacementIndisponibleRaison: coutEmplacement.raisonIndisponible,
  };
}
