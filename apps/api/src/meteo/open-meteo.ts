/**
 * Client Open-Meteo — la seule partie du moteur de prevision qui touche au reseau.
 *
 * Il vit ici et pas dans `packages/core` parce que `core` est deterministe par
 * contrat : meme entree, meme sortie, sans quoi le backtesting ne veut rien dire.
 * Ce module TRADUIT une reponse HTTP en `ConditionsMeteo`, rien de plus — aucune
 * regle metier, aucun facteur.
 *
 * Mode degrade obligatoire : si Open-Meteo ne repond pas, l'application continue
 * de fonctionner et le dit. Une prevision sans meteo reste une prevision.
 *
 * ## Quatre variables COLLECTEES, pas (encore) UTILISEES
 *
 * `docs/03-MOTEUR-PREVISION.md` §« Variables retenues » liste depuis l'origine
 * six variables, alors que ce module et `packages/core/src/prevision/meteo.ts`
 * (`ConditionsMeteo`) n'en exploitent que quatre : temperature moyenne,
 * precipitations cumulees, vent moyen, couverture nuageuse. Les deux variables
 * manquantes de `ConditionsMeteo` — temperature ressentie et probabilite de
 * pluie — ainsi que le code meteo OMM et la reponse brute correspondent aux
 * quatre colonnes de `meteo_observation` qu'un audit a trouvees structurellement
 * inremplissables : ce module ne demandait jamais les champs Open-Meteo
 * correspondants.
 *
 * Voie retenue ICI : **collecter maintenant, utiliser plus tard**, pas
 * « collecter et utiliser ». Raisons :
 *
 *  1. `classerMeteo` (`packages/core/src/prevision/meteo.ts`) est un calcul que
 *     CLAUDE.md protege explicitement contre toute modification non prouvee par
 *     une non-regression ; il vient de refermer deux trous silencieux (les huit
 *     categories, `verifierCoherenceTemperatures`) et sa suite de tests verifie
 *     une couverture EXHAUSTIVE de l'axe des temperatures par recherche
 *     exhaustive. Y ajouter une neuvieme dimension (la probabilite de pluie, qui
 *     mesure une INFORMATION ANNONCEE, pas un CUMUL REALISE — les deux ne
 *     disent pas la meme chose un dimanche a 80 % de risque qui reste sec) est
 *     un changement de modele, pas un branchement de donnee, et cette tache n'a
 *     ni le mandat ni les moyens de prouver la non-regression d'un calcul dont
 *     un autre agent modifie par ailleurs `packages/db/src/depots/previsions.ts`
 *     en parallele (backtesting, validation croisee).
 *  2. Une nouvelle categorie exigerait une cle de coefficient au catalogue
 *     (`packages/core/src/parametres.ts`, hors zone de ce lot) avec un defaut
 *     NEUTRE (D-059 : « les facteurs ne se devinent pas, ils s'apprennent ») —
 *     rien ici ne doit inventer un coefficient plausible.
 *  3. L'historique, lui, ne se rattrape jamais : chaque dimanche non collecte
 *     est un dimanche perdu pour la mesure future. Constituer l'historique DES
 *     MAINTENANT est donc la partie non differable de ce lot ; brancher la
 *     classification est un travail sequent, avec sa propre preuve de
 *     non-regression, mene par qui detient `packages/core/src/prevision/**`.
 *
 * `ConditionsMeteo` (le type consomme par le moteur) n'est donc PAS etendu ici.
 * Les quatre champs supplementaires voyagent a cote, dans `ReleveMeteo`.
 */

import type { ConditionsMeteo } from '@batte/core';

/** API publique, sans cle (CLAUDE.md §2). */
const RACINE = 'https://api.open-meteo.com/v1/forecast';

/** Au-dela, on preferera afficher « météo indisponible » plutot que faire attendre. */
const DELAI_MAX_MS = 8000;

export type FenetreMarche = {
  readonly latitude: number;
  readonly longitude: number;
  /** Jour civil belge, `AAAA-MM-JJ`. */
  readonly date: string;
  /** Heures locales `HH:MM`, bornes de la fenetre de vente. */
  readonly heureDebut: string;
  readonly heureFin: string;
};

/**
 * Tranche BRUTE de la reponse Open-Meteo, restreinte aux heures de la fenetre
 * de marche — jamais la journee entiere, qui ne sert jamais (cf. commentaire
 * de `indicesDeLaFenetre`).
 *
 * Pourquoi la conserver : une reponse Open-Meteo de type `prevision` (J-7,
 * J-3, J-1) n'est PAS reproductible plus tard — Open-Meteo n'archive que la
 * meteo REALISEE (API distincte), pas les previsions passees qu'il a emises.
 * Sans cette tranche, une revision de calcul (ex. changer l'agregation
 * retenue pour la probabilite de pluie) ne pourrait plus jamais rejouer
 * l'historique des previsions deja recues. Le volume reste faible : quelques
 * heures par releve, pas la reponse HTTP complete (24 h, hors fenetre).
 */
export type DonneesBrutesFenetre = {
  /** Horodatages Open-Meteo (`AAAA-MM-JJTHH:MM`), un par heure retenue. */
  readonly heures: readonly string[];
  /** Valeurs BRUTES par variable Open-Meteo (nom de champ d'origine, snake_case). */
  readonly valeurs: Readonly<Record<string, readonly (number | null)[]>>;
  /** Unites annoncees par Open-Meteo pour chaque variable (`hourly_units`). */
  readonly unites: Readonly<Record<string, string>>;
};

export type ReleveMeteo = {
  readonly conditions: ConditionsMeteo;
  /** Horodatage de la recuperation : une prevision meteo se perime. */
  readonly recupereLe: string;
  /**
   * Temperature ressentie moyenne sur la fenetre (`apparent_temperature`).
   * COLLECTEE, pas encore lue par `classerMeteo` (voir l'en-tete du module).
   *
   * OPTIONNEL, et non `number | null` simplement : `apps/api/src/routes/previsions.ts`
   * (`obtenirMeteo`, hors zone de ce lot) reconstruit un `ReleveMeteo` a partir
   * d'un releve deja CONSERVE en base sans relire ces quatre champs — la
   * lecture (`packages/db/src/depots/previsions.ts`, `lireMeteo`) ne les
   * projette pas non plus. Rendre ces champs obligatoires aurait casse cette
   * reconstruction sans toucher un fichier hors zone. Absent = « non
   * recalcule pour ce releve conserve », distinct de `null` = « interroge,
   * et Open-Meteo n'a rien rendu ».
   */
  readonly temperatureRessentieC?: number | null;
  /**
   * Probabilite de pluie retenue pour la fenetre, en points de base
   * (10000 = 100 %). Agregation : le MAXIMUM horaire sur la fenetre, pas la
   * moyenne — la question posee est « un risque de pluie existe-t-il a un
   * moment du marche », pas « quelle est la probabilite moyenne sur 6 h 30 » ;
   * une moyenne dilue une averse ponctuelle a forte probabilite au milieu
   * d'heures seches et sous-estimerait le risque percu par un client qui
   * decide de sortir ou non. Meme logique que `cumul` (et non `moyenne`) deja
   * retenue pour les precipitations. `null` si Open-Meteo ne rend aucune
   * valeur sur la fenetre — jamais 0, qui signifierait « pluie exclue ».
   * Optionnel pour la meme raison que `temperatureRessentieC` ci-dessus.
   */
  readonly probabilitePluieBp?: number | null;
  /**
   * Code meteo OMM (`weather_code`) DOMINANT sur la fenetre : le code le plus
   * frequent parmi les heures retenues ; en cas d'egalite, celui des deux
   * codes a egalite qui atteint ce compte en premier (ordre chronologique).
   * Choix delibere : les codes OMM ne sont pas ordonnes
   * par « gravite » (45 = brouillard, 51-67 = bruine/pluie, 95-99 = orage —
   * aucun ordre numerique coherent), inventer un classement de gravite serait
   * une regle metier non demandee. Le mode est la seule statistique qui ne
   * suppose aucun ordre. Optionnel pour la meme raison que
   * `temperatureRessentieC` ci-dessus.
   */
  readonly codeMeteo?: number | null;
  /**
   * Tranche brute de la reponse Open-Meteo — voir `DonneesBrutesFenetre`.
   * Optionnelle pour la meme raison que les trois champs ci-dessus.
   */
  readonly donneesBrutes?: DonneesBrutesFenetre;
};

export type ResultatReleve =
  | { readonly disponible: true; readonly releve: ReleveMeteo }
  | { readonly disponible: false; readonly raison: string };

/** Champs horaires demandes a Open-Meteo, dans l'ordre ou ils sont conserves. */
const CHAMPS_HORAIRES = [
  'temperature_2m',
  'precipitation',
  'wind_speed_10m',
  'cloud_cover',
  'apparent_temperature',
  'precipitation_probability',
  'weather_code',
] as const;

type ChampHoraire = (typeof CHAMPS_HORAIRES)[number];

type ReponseOpenMeteo = {
  hourly?: {
    [K in ChampHoraire | 'time']?: unknown;
  };
  /** Unites par variable, ex. `{ temperature_2m: "°C" }`. Verifie le 30/07/2026
   *  par appel direct a `https://api.open-meteo.com/v1/forecast` (voir rapport
   *  de ce lot) : le champ existe reellement dans la reponse. */
  hourly_units?: Readonly<Record<string, unknown>>;
};

/** Moyenne des valeurs presentes. `null` si aucune. */
function moyenne(valeurs: readonly (number | null)[]): number | null {
  const presentes = valeurs.filter((v): v is number => typeof v === 'number');
  if (presentes.length === 0) return null;
  return presentes.reduce((somme, v) => somme + v, 0) / presentes.length;
}

/** Somme des valeurs presentes. `null` si aucune. */
function cumul(valeurs: readonly (number | null)[]): number | null {
  const presentes = valeurs.filter((v): v is number => typeof v === 'number');
  if (presentes.length === 0) return null;
  return presentes.reduce((somme, v) => somme + v, 0);
}

/** Maximum des valeurs presentes. `null` si aucune. */
function maximum(valeurs: readonly (number | null)[]): number | null {
  const presentes = valeurs.filter((v): v is number => typeof v === 'number');
  if (presentes.length === 0) return null;
  return Math.max(...presentes);
}

/**
 * Valeur la plus frequente parmi les valeurs presentes ; egalites tranchees
 * par ordre chronologique (la premiere valeur a atteindre le compte maximal
 * l'emporte). `null` si aucune valeur presente.
 */
function valeurDominante(valeurs: readonly (number | null)[]): number | null {
  const presentes = valeurs.filter((v): v is number => typeof v === 'number');
  if (presentes.length === 0) return null;

  const occurrences = new Map<number, number>();
  // Initialise a `null` plutot qu'a `presentes[0]` : sous
  // `noUncheckedIndexedAccess`, l'index resterait type `number | undefined`
  // meme apres la garde `presentes.length === 0` ci-dessus. `meilleure` est de
  // toute facon ecrasee des la premiere iteration (le premier compte, 1, est
  // toujours strictement superieur a `meilleurCompte` initial, 0).
  let meilleure: number | null = null;
  let meilleurCompte = 0;
  for (const valeur of presentes) {
    const compte = (occurrences.get(valeur) ?? 0) + 1;
    occurrences.set(valeur, compte);
    if (compte > meilleurCompte) {
      meilleurCompte = compte;
      meilleure = valeur;
    }
  }
  return meilleure;
}

/** Convertit `HH:MM` en minutes depuis minuit. */
function minutes(heure: string): number {
  const [h, m] = heure.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Indices des heures comprises dans la fenetre du marche.
 *
 * On ne moyenne PAS la journee entiere : une averse a 22 h n'a aucun effet sur
 * un marche qui ferme a 14 h 30.
 */
function indicesDeLaFenetre(horodatages: readonly string[], fenetre: FenetreMarche): number[] {
  const debut = minutes(fenetre.heureDebut);
  const fin = minutes(fenetre.heureFin);
  const indices: number[] = [];

  horodatages.forEach((horodatage, index) => {
    // Format Open-Meteo : « 2026-07-26T09:00 », en heure locale demandee.
    const [jour, heure] = horodatage.split('T');
    if (jour !== fenetre.date || heure === undefined) return;
    const minute = minutes(heure);
    if (minute >= debut && minute <= fin) indices.push(index);
  });

  return indices;
}

function nombresOuNull(valeur: unknown, indices: readonly number[]): (number | null)[] {
  if (!Array.isArray(valeur)) return [];
  return indices.map((i) => {
    const v: unknown = valeur[i];
    return typeof v === 'number' ? v : null;
  });
}

/**
 * Tranche brute de la reponse Open-Meteo, restreinte a la fenetre de marche.
 * Voir `DonneesBrutesFenetre` pour la justification (previsions non
 * reproductibles a posteriori).
 */
function trancheBrute(
  charge: ReponseOpenMeteo,
  horodatagesDeLaFenetre: readonly string[],
  indices: readonly number[],
): DonneesBrutesFenetre {
  const valeurs: Record<string, readonly (number | null)[]> = {};
  const unites: Record<string, string> = {};

  for (const champ of CHAMPS_HORAIRES) {
    valeurs[champ] = nombresOuNull(charge.hourly?.[champ], indices);
    const unite = charge.hourly_units?.[champ];
    if (typeof unite === 'string') unites[champ] = unite;
  }

  return { heures: horodatagesDeLaFenetre, valeurs, unites };
}

/**
 * Releve les conditions attendues sur la fenetre du marche.
 *
 * Ne leve jamais : toute panne devient un `{ disponible: false }` avec une raison
 * affichable. C'est le point du mode degrade — l'ecran doit pouvoir dire
 * « météo indisponible, facteur neutre appliqué » plutot que planter.
 *
 * `racineUrl` n'existe que pour les tests : il permet de pointer vers un
 * serveur HTTP local qui IMITE Open-Meteo, jamais d'appeler le vrai service
 * depuis une suite de tests (CLAUDE.md — un test qui depend du reseau n'est
 * pas un test).
 */
export async function releverMeteo(
  fenetre: FenetreMarche,
  maintenant: () => Date = () => new Date(),
  racineUrl: string = RACINE,
): Promise<ResultatReleve> {
  const url = new URL(racineUrl);
  url.searchParams.set('latitude', String(fenetre.latitude));
  url.searchParams.set('longitude', String(fenetre.longitude));
  // Quatre variables historiques + trois ajoutees pour remplir les colonnes
  // `temperature_ressentie_c`, `probabilite_pluie_bp` et `code_meteo` de
  // `meteo_observation` (voir l'en-tete du module). Noms verifies contre la
  // reponse reelle d'Open-Meteo le 30/07/2026 (voir rapport de ce lot).
  url.searchParams.set('hourly', CHAMPS_HORAIRES.join(','));
  url.searchParams.set('timezone', 'Europe/Brussels');
  url.searchParams.set('start_date', fenetre.date);
  url.searchParams.set('end_date', fenetre.date);

  let reponse: Response;
  try {
    reponse = await fetch(url, { signal: AbortSignal.timeout(DELAI_MAX_MS) });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { disponible: false, raison: `Open-Meteo injoignable (${detail}).` };
  }

  if (!reponse.ok) {
    return {
      disponible: false,
      raison: `Open-Meteo a répondu ${reponse.status}.`,
    };
  }

  let charge: ReponseOpenMeteo;
  try {
    charge = (await reponse.json()) as ReponseOpenMeteo;
  } catch {
    return { disponible: false, raison: 'Réponse Open-Meteo illisible.' };
  }

  const horodatages = charge.hourly?.time;
  if (!Array.isArray(horodatages)) {
    return { disponible: false, raison: 'Réponse Open-Meteo sans série horaire.' };
  }

  const horodatagesTextuels = horodatages.filter((h): h is string => typeof h === 'string');
  const indices = indicesDeLaFenetre(horodatagesTextuels, fenetre);
  if (indices.length === 0) {
    return {
      disponible: false,
      raison:
        `Aucune heure prévue entre ${fenetre.heureDebut} et ${fenetre.heureFin} ` +
        `le ${fenetre.date} — la prévision météo ne va pas si loin.`,
    };
  }

  const temperature = moyenne(nombresOuNull(charge.hourly?.temperature_2m, indices));
  const precipitations = cumul(nombresOuNull(charge.hourly?.precipitation, indices));
  const vent = moyenne(nombresOuNull(charge.hourly?.wind_speed_10m, indices));
  const couverture = moyenne(nombresOuNull(charge.hourly?.cloud_cover, indices));

  if (temperature === null || precipitations === null || vent === null || couverture === null) {
    return { disponible: false, raison: 'Relevé Open-Meteo incomplet sur la fenêtre.' };
  }

  // Les trois variables ci-dessous sont COLLECTEES en best-effort : une
  // absence (fournisseur en panne partielle sur CE champ precis) ne doit
  // jamais faire echouer tout le releve — seules les quatre variables
  // consommees par `classerMeteo` (ci-dessus) sont bloquantes. Une valeur
  // absente reste `null`, jamais 0 (CLAUDE.md : « une valeur inconnue vaut
  // null, jamais 0 » — decisif ici pour la probabilite de pluie).
  const temperatureRessentie = moyenne(nombresOuNull(charge.hourly?.apparent_temperature, indices));
  const probabilitePluiePct = maximum(
    nombresOuNull(charge.hourly?.precipitation_probability, indices),
  );
  const codeMeteo = valeurDominante(nombresOuNull(charge.hourly?.weather_code, indices));
  const heuresFenetre = indices
    .map((i) => horodatagesTextuels[i])
    .filter((h): h is string => typeof h === 'string');

  return {
    disponible: true,
    releve: {
      conditions: {
        temperatureC: Math.round(temperature * 10) / 10,
        precipitationsMm: Math.round(precipitations * 10) / 10,
        ventKmh: Math.round(vent),
        // Open-Meteo rend un pourcentage ; le domaine parle en points de base.
        couvertureNuageuseBp: Math.round(couverture * 100),
      },
      recupereLe: maintenant().toISOString(),
      temperatureRessentieC:
        temperatureRessentie === null ? null : Math.round(temperatureRessentie * 10) / 10,
      probabilitePluieBp:
        probabilitePluiePct === null ? null : Math.round(probabilitePluiePct * 100),
      codeMeteo,
      donneesBrutes: trancheBrute(charge, heuresFenetre, indices),
    },
  };
}
