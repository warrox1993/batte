/**
 * Petits utilitaires de calendrier partages par les predicteurs de
 * `docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md` :
 * comparable calendaire, jour de semaine, vacances scolaires et session
 * consecutive ont tous besoin de comparer deux dates `AAAA-MM-JJ`, sans jamais
 * dependre de l'horloge du poste (docs/03 : « meme entree, meme sortie »).
 *
 * Volontairement SANS dependance a `horodatage.ts` : ce module ne lit ni
 * n'affiche une date, il ne fait que comparer des chaines deja au format
 * `AAAA-MM-JJ` — le meme format que `ObservationSession.dateSession`. Ajouter
 * une dependance au fuseau belge ici serait une indirection sans objet.
 */

/** Jours cumules avant chaque mois d'une annee NON bissextile (index 0 = janvier). */
const JOURS_CUMULES_AVANT_MOIS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Nombre de jours d'une annee non bissextile utilisee comme reference circulaire. */
const JOURS_PAR_AN = 365;

type PartiesDate = { readonly annee: number; readonly mois: number; readonly jour: number };

/**
 * Decoupe `AAAA-MM-JJ` en ses trois parties entieres.
 *
 * Pas de `new Date(...)` ici : une chaine mal formee doit produire un `NaN`
 * explicite plutot qu'une date « corrigee » silencieusement par le moteur JS
 * (`new Date('2026-02-30')` glisse vers mars sans avertir).
 */
function decouper(date: string): PartiesDate {
  const [annee, mois, jour] = date.split('-').map(Number);
  return { annee: annee ?? Number.NaN, mois: mois ?? Number.NaN, jour: jour ?? Number.NaN };
}

/**
 * Position dans l'annee, 0-indexee, en ignorant les annees bissextiles.
 *
 * Approximation deliberee (docs/03 ne demande nulle part une precision au
 * jour pres sur un cycle de 4 ans) : le 29 fevrier est traite comme le
 * 1er mars, ce qui decale au plus TOUS les predicteurs calendaires d'un jour
 * un an sur quatre — sans consequence sur une fenetre de tolerance mesuree en
 * jours (dix, typiquement).
 */
function positionDansAnnee(mois: number, jour: number): number {
  const indexMois = Math.min(Math.max(Math.trunc(mois) - 1, 0), 11);
  return JOURS_CUMULES_AVANT_MOIS[indexMois]! + (jour - 1);
}

/**
 * Distance CIRCULAIRE entre deux jours calendaires, en ignorant l'annee.
 *
 * Circulaire : le 30 decembre et le 2 janvier ne sont distants que de 3 jours,
 * pas de 363. Sans ce bouclage, la Chandeleur (2 fevrier) resterait bien
 * detectee, mais le reveillon serait injustement ecarte de son propre
 * comparable calendaire.
 *
 * Rend `Number.NaN` si l'une des deux dates est illisible : c'est a
 * l'appelant de decider (les predicteurs ecartent une observation dont
 * l'ecart n'est pas fini, jamais silencieusement a zero — une date cassee ne
 * doit pas se faire passer pour « exactement le bon jour »).
 */
export function ecartCalendaireJours(dateCible: string, dateObservation: string): number {
  const cible = decouper(dateCible);
  const observation = decouper(dateObservation);
  if (!Number.isFinite(cible.mois) || !Number.isFinite(observation.mois)) return Number.NaN;

  const positionCible = positionDansAnnee(cible.mois, cible.jour);
  const positionObservation = positionDansAnnee(observation.mois, observation.jour);
  const brut = Math.abs(positionCible - positionObservation);
  return Math.min(brut, JOURS_PAR_AN - brut);
}

/**
 * Age en jours de `dateObservation` par rapport a `dateCible` : positif si
 * l'observation est ANTERIEURE a la cible (le cas normal, un historique).
 *
 * Meme convention que `poidsTemporel` de `baseline.ts` : midi UTC pour ne
 * jamais tomber sur un changement d'heure, `Number.NaN` propage plutot qu'un
 * silence si l'une des deux dates est illisible.
 */
export function ageJours(dateCible: string, dateObservation: string): number {
  const differenceMs =
    Date.parse(`${dateCible}T12:00:00Z`) - Date.parse(`${dateObservation}T12:00:00Z`);
  return differenceMs / 86_400_000;
}

/** Annee civile d'une date `AAAA-MM-JJ`, ou `Number.NaN` si illisible. */
export function anneeCivile(date: string): number {
  return decouper(date).annee;
}

/**
 * Jour de la semaine, `0` = dimanche a `6` = samedi (convention JS `getUTCDay`).
 *
 * Midi UTC : une date `AAAA-MM-JJ` interpretee a minuit UTC peut retomber sur
 * la veille dans un fuseau negatif ; ce n'est pas notre cas (Europe/Brussels
 * est toujours a l'est de UTC), mais midi ne coute rien et evite d'avoir a s'en
 * souvenir si l'appelant change un jour.
 */
export function jourDeSemaine(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/**
 * Ajoute `jours` (peut etre negatif) a une date `AAAA-MM-JJ`, en arithmetique
 * UTC pure — jamais une lecture d'horloge, jamais une dependance au fuseau.
 *
 * Duplique volontairement `ajouterJours` de `horodatage.ts` (meme calcul, sur
 * la forme a 10 caracteres uniquement) : ce module reste SANS dependance a
 * `horodatage.ts` par construction (voir l'en-tete du fichier), et le calcul
 * lui-meme ne touche ni a l'horloge ni au fuseau — seul `jourCivilBelge`
 * (calcul de « aujourd'hui ») en a un besoin reel.
 */
function ajouterJoursCalendaires(date: string, jours: number): string {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + jours);
  return instant.toISOString().slice(0, 10);
}

/**
 * Prochaines occurrences d'un jour de semaine donne, dans la fenetre
 * `[depuis, depuis + horizonJours[` — docs/demandes/06 §1.
 *
 * Sert a generer les dates CANDIDATES de la prevision calendaire pour un lieu
 * recurrent (`lieuMarche.jourSemaine`, La Batte tous les dimanches) SANS
 * dependre de l'existence prealable d'une `sessionMarche` : un marche
 * hebdomadaire a une date candidate chaque semaine, que la session ait deja
 * ete creee en base ou non.
 *
 * Rend un tableau VIDE si `horizonJours` n'est pas fini ou est negatif ou nul
 * — jamais une boucle infinie ni une date fantaisiste.
 */
export function occurrencesJourSemaine(
  jourSemaineCible: number,
  depuis: string,
  horizonJours: number,
): string[] {
  if (!Number.isFinite(horizonJours) || horizonJours <= 0) return [];
  if (!Number.isFinite(jourSemaineCible)) return [];

  // Premier jour >= `depuis` qui tombe sur `jourSemaineCible`.
  let decalage = jourSemaineCible - jourDeSemaine(depuis);
  if (decalage < 0) decalage += 7;

  const occurrences: string[] = [];
  for (let jours = decalage; jours < horizonJours; jours += 7) {
    occurrences.push(ajouterJoursCalendaires(depuis, jours));
  }
  return occurrences;
}
