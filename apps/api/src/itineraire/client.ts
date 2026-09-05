/**
 * Client d'itinéraire — OpenRouteService (D-064, séance du 30/07/2026).
 *
 * Le porteur est revenu en séance sur la saisie manuelle pure décrite au point
 * 2 de D-064 : « l'application doit pouvoir calculer automatiquement les km
 * sans mon intervention ; je dois être là pour vérifier, mais le modèle est
 * d'avoir le plus de choses automatiques ». Service retenu : OpenRouteService,
 * avec sa propre clé gratuite (2 500 requêtes/jour, 40 000/mois — géocodage et
 * itinéraires compris), largement suffisant pour une trentaine de lieux
 * calculés UNE FOIS chacun.
 *
 * Mêmes trois règles que `apps/api/src/ia/client.ts`, dont ce module reprend
 * la forme :
 *
 *  1. **La clé ne quitte jamais le serveur** (CLAUDE.md §2/§7). Elle est lue
 *     depuis `.env`, n'est jamais renvoyée dans une réponse HTTP ni écrite
 *     dans un message d'erreur ou un journal — y compris en cas de panne
 *     réseau ou de clé invalide, où le corps de la réponse du fournisseur
 *     pourrait, lui, la recopier.
 *  2. **Mode dégradé complet** (CLAUDE.md §5, étendu ici par le porteur au
 *     calcul de distance) : sans clé, avec une clé invalide, sans réseau, hors
 *     quota, ou sur une adresse introuvable, `calculerDistanceRoutiere` rend
 *     un refus MOTIVÉ — jamais une exception, jamais 0 km (CLAUDE.md §3 : une
 *     valeur inconnue vaut `null`, pas zéro — un 0 km ferait croire à un lieu
 *     sans déplacement, donc gratuit en carburant). L'application reste
 *     pleinement utilisable sans ce service : la saisie manuelle de la
 *     distance reste toujours possible.
 *  3. **UN SEUL appel par lieu, jamais à la lecture.** Ce module n'est appelé
 *     que par les routes d'écriture du référentiel
 *     (`apps/api/src/routes/referentiel-ecriture.ts`), à la création ou à la
 *     modification d'un lieu — jamais par une route `GET`, jamais en boucle,
 *     jamais au rendu d'un écran.
 *
 * ATTRIBUTION OBLIGATOIRE. Les résultats d'OpenRouteService (géocodage et
 * itinéraires) sont dérivés de données OpenStreetMap sous licence CC-BY 4.0 :
 * `ATTRIBUTION_OPENSTREETMAP` doit accompagner toute distance calculée par ce
 * module, partout où elle est affichée. Ce n'est pas décoratif, c'est une
 * condition de la licence.
 */

/** Mention à afficher partout où une distance calculée par ce module apparaît. */
export const ATTRIBUTION_OPENSTREETMAP = '© contributeurs OpenStreetMap';

const RACINE_GEOCODAGE = 'https://api.openrouteservice.org/geocode/search';
const RACINE_ITINERAIRE = 'https://api.openrouteservice.org/v2/directions/driving-car';

/** Au-delà, on préfère refuser plutôt que de faire attendre l'écriture d'un lieu. */
const DELAI_MAX_MS = 8000;

const METRES_PAR_KM = 1000;

/**
 * Diviseur retenu pour arrondir la distance au DIXIÈME de kilomètre (100 m),
 * ni au mètre (D-074, complément du 30/07/2026 : « garder tous les chiffres
 * serait absurde, une distance routière n'est pas exacte au mètre — trafic,
 * imprécision de la géométrie du réseau »), ni au kilomètre entier (le défaut
 * historique de ce module, qui jetait une précision obtenue gratuitement dès
 * que la distance a cessé d'être saisie à la main pour être calculée).
 *
 * Le dixième est choisi, pas un autre cran, pour deux raisons qui pointent
 * toutes deux vers la même valeur :
 *  1. c'est la précision à laquelle `session_marche.distance_reelle_km` —
 *     l'autre distance du modèle, saisie à la main sur un GPS ou un compteur —
 *     est déjà AFFICHÉE (`formaterKm`, `apps/web/src/pages/Sessions.tsx`,
 *     `maximumFractionDigits: 1`) : la même grandeur ne doit pas porter deux
 *     précisions différentes selon qu'elle est calculée ou tapée ;
 *  2. c'est la précision qu'un compteur kilométrique ou une carte routière
 *     rendent couramment à la lecture (« 12,4 km ») — exactement ce que le
 *     porteur a tenté de taper à la main avant de découvrir que le champ le
 *     refusait (D-074, constat initial).
 */
const METRES_PAR_DIXIEME_KM = METRES_PAR_KM / 10;

export type Coordonnees = {
  readonly latitude: number;
  readonly longitude: number;
};

/**
 * Un point de l'itinéraire (départ ou arrivée) : soit des coordonnées déjà
 * connues (le lieu porte `latitude`/`longitude`, comme pour Open-Meteo), soit
 * une adresse à géocoder (le domicile n'a que ça, ou un lieu tout neuf n'a pas
 * encore ses coordonnées).
 */
export type PointItineraire =
  | { readonly type: 'coordonnees'; readonly coordonnees: Coordonnees }
  | { readonly type: 'adresse'; readonly adresse: string };

export type EntreeCalculDistance = {
  /** Point de départ — en pratique l'adresse de domicile en paramètre. */
  readonly depart: PointItineraire;
  /** Point d'arrivée — en pratique le lieu de marché. */
  readonly arrivee: PointItineraire;
};

/**
 * Racines de service, SURCHARGEABLES — uniquement pour les tests.
 *
 * CLAUDE.md interdit d'appeler le service réel dans un test (voir la mission
 * de ce module) : sans ce point d'injection, aucun test ne pourrait exercer
 * les échecs HTTP (401, 429…) sans soit appeler la vraie API OpenRouteService,
 * soit dupliquer `fetch` dans un mock global. Un simple PARAMÈTRE, pas une
 * variable d'environnement : `.env.example` ne documenterait alors rien qui ne
 * serve qu'aux tests (CLAUDE.md §7 — un fichier qui documente une variable non
 * lue en production fait croire à un réglage qui n'existe pas). En production,
 * l'appelant ne les fournit jamais et les deux constantes réelles s'appliquent.
 */
export type OptionsCalculDistance = {
  readonly racineGeocodage?: string;
  readonly racineItineraire?: string;
};

export type ResultatDistanceRoutiere =
  | { readonly disponible: true; readonly distanceKm: number; readonly attribution: string }
  | { readonly disponible: false; readonly raison: string };

/** Lit la clé depuis l'environnement. `''` ou absente vaut « non configurée ». */
function cleConfiguree(): string | null {
  const cle = process.env['OPENROUTESERVICE_API_KEY'];
  if (cle === undefined || cle.trim() === '') return null;
  return cle;
}

/** L'assistance est-elle configurée ? Ne révèle jamais la clé, seulement sa présence. */
export function itineraireConfigure(): boolean {
  return cleConfiguree() !== null;
}

type ReponseGeocodage = {
  readonly features?: ReadonlyArray<{
    readonly geometry?: { readonly coordinates?: unknown };
  }>;
};

type ReponseDirections = {
  readonly routes?: ReadonlyArray<{
    readonly summary?: { readonly distance?: unknown };
  }>;
};

type Cote = 'depart' | 'arrivee';

/**
 * Un nom affichable pour le point en cause dans un message d'échec — « le
 * point de départ » ou « ce lieu » — jamais un mot technique comme « depart »
 * qui ne dirait rien à un utilisateur.
 */
function libelleCote(cote: Cote): string {
  return cote === 'depart' ? 'le point de départ' : 'ce lieu';
}

/**
 * Raison affichée pour une panne RÉSEAU (aucune réponse HTTP reçue).
 *
 * Ne recopie JAMAIS le detail de la cause : sur une requête de géocodage,
 * l'URL en cause porte la clé en paramètre `api_key`, et une exception réseau
 * peut, selon l'implémentation, la recopier dans son message. On ne prend
 * aucun risque : la phrase est fixe, écrite par l'application.
 */
function raisonPanneReseau(): string {
  return (
    'Service de calcul de distance injoignable (pas de connexion réseau, ou délai dépassé). ' +
    'La distance reste utilisable en saisie manuelle.'
  );
}

/** Raison affichée pour un statut HTTP en échec, déduite du seul code — jamais du corps. */
function raisonEchecHttp(statut: number): string {
  if (statut === 401 || statut === 403) {
    return (
      'La clé OpenRouteService est refusée. Vérifiez OPENROUTESERVICE_API_KEY dans le fichier ' +
      '.env du poste, ou saisissez la distance manuellement en attendant.'
    );
  }
  if (statut === 429) {
    return (
      'Quota OpenRouteService atteint pour aujourd’hui ou ce mois-ci. Réessayez plus tard, ou ' +
      'saisissez la distance manuellement.'
    );
  }
  return (
    `Service de calcul de distance indisponible (le fournisseur a répondu ${statut}). ` +
    'La distance reste utilisable en saisie manuelle.'
  );
}

type ResultatCoordonnees =
  | { readonly ok: true; readonly coordonnees: Coordonnees }
  | { readonly ok: false; readonly raison: string };

/** Géocode une adresse en coordonnées WGS84 via le service de recherche d'OpenRouteService. */
async function geocoder(
  adresse: string,
  cle: string,
  cote: Cote,
  racine: string,
): Promise<ResultatCoordonnees> {
  const url = new URL(racine);
  url.searchParams.set('api_key', cle);
  url.searchParams.set('text', adresse);
  url.searchParams.set('size', '1');
  // Pas de restriction de pays : un fournisseur ou un marché peut se trouver
  // juste de l'autre côté d'une frontière (Maastricht, Aix-la-Chapelle) — la
  // même remarque vaut ici que pour le rayon d'événements (CLAUDE.md §6).

  let reponse: Response;
  try {
    reponse = await fetch(url, { signal: AbortSignal.timeout(DELAI_MAX_MS) });
  } catch {
    return { ok: false, raison: raisonPanneReseau() };
  }

  if (!reponse.ok) {
    return { ok: false, raison: raisonEchecHttp(reponse.status) };
  }

  let corps: ReponseGeocodage;
  try {
    corps = (await reponse.json()) as ReponseGeocodage;
  } catch {
    return { ok: false, raison: 'Réponse du service de géocodage illisible.' };
  }

  const coordonnees = corps.features?.[0]?.geometry?.coordinates;
  const longitude = Array.isArray(coordonnees) ? coordonnees[0] : undefined;
  const latitude = Array.isArray(coordonnees) ? coordonnees[1] : undefined;

  if (typeof longitude !== 'number' || typeof latitude !== 'number') {
    return {
      ok: false,
      raison:
        `Adresse introuvable pour ${libelleCote(cote)} : « ${adresse} ». ` +
        'Vérifiez son orthographe, ou saisissez la distance manuellement.',
    };
  }

  return { ok: true, coordonnees: { latitude, longitude } };
}

type ResultatDistanceMetres =
  | { readonly ok: true; readonly distanceKm: number }
  | { readonly ok: false; readonly raison: string };

/**
 * Calcule la distance ROUTIÈRE (voiture) entre deux points déjà géocodés.
 *
 * Convertit les mètres bruts rendus par le fournisseur en kilomètres au
 * DIXIÈME près (voir `METRES_PAR_DIXIEME_KM`) — jamais au kilomètre entier
 * (D-074 : cet arrondi jetait, à la source, une précision obtenue
 * gratuitement, avant même que la valeur n'atteigne la fiche du lieu).
 */
async function itineraire(
  depart: Coordonnees,
  arrivee: Coordonnees,
  cle: string,
  racine: string,
): Promise<ResultatDistanceMetres> {
  let reponse: Response;
  try {
    reponse = await fetch(racine, {
      method: 'POST',
      // En-tête, pas paramètre d'URL : cette route n'expose donc pas la clé
      // dans une adresse qu'un journal d'accès pourrait consigner.
      headers: { Authorization: cle, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: [
          [depart.longitude, depart.latitude],
          [arrivee.longitude, arrivee.latitude],
        ],
      }),
      signal: AbortSignal.timeout(DELAI_MAX_MS),
    });
  } catch {
    return { ok: false, raison: raisonPanneReseau() };
  }

  if (!reponse.ok) {
    return { ok: false, raison: raisonEchecHttp(reponse.status) };
  }

  let corps: ReponseDirections;
  try {
    corps = (await reponse.json()) as ReponseDirections;
  } catch {
    return { ok: false, raison: 'Réponse du service d’itinéraire illisible.' };
  }

  const metres = corps.routes?.[0]?.summary?.distance;
  if (typeof metres !== 'number' || !Number.isFinite(metres) || metres < 0) {
    return {
      ok: false,
      raison:
        'Aucun itinéraire routier trouvé entre ces deux adresses. ' +
        'Saisissez la distance manuellement.',
    };
  }

  return { ok: true, distanceKm: Math.round(metres / METRES_PAR_DIXIEME_KM) / 10 };
}

async function resoudreCoordonnees(
  point: PointItineraire,
  cle: string,
  cote: Cote,
  racineGeocodage: string,
): Promise<ResultatCoordonnees> {
  if (point.type === 'coordonnees') return { ok: true, coordonnees: point.coordonnees };
  return geocoder(point.adresse, cle, cote, racineGeocodage);
}

/**
 * Calcule la distance ROUTIÈRE aller simple entre deux points, en kilomètres
 * au DIXIÈME près (D-074 : ni le mètre — une distance routière n'est pas
 * exacte à ce niveau —, ni le kilomètre entier — ça jetterait une précision
 * obtenue gratuitement ; voir `METRES_PAR_DIXIEME_KM` pour la justification
 * complète).
 *
 * Ne lève JAMAIS : toute panne devient un `{ disponible: false, raison }`
 * affichable tel quel, jamais un `0` (une distance inconnue n'est pas une
 * distance nulle). Appeler cette fonction déclenche RÉELLEMENT un appel
 * réseau : à réserver à l'écriture d'un lieu (création ou modification),
 * jamais à sa lecture.
 */
export async function calculerDistanceRoutiere(
  entree: EntreeCalculDistance,
  options: OptionsCalculDistance = {},
): Promise<ResultatDistanceRoutiere> {
  const racineGeocodage = options.racineGeocodage ?? RACINE_GEOCODAGE;
  const racineItineraire = options.racineItineraire ?? RACINE_ITINERAIRE;

  const cle = cleConfiguree();
  if (cle === null) {
    return {
      disponible: false,
      raison:
        "Le calcul automatique de distance n'est pas configuré. Renseignez " +
        'OPENROUTESERVICE_API_KEY dans le fichier .env du poste pour l’activer. ' +
        'La distance reste saisissable manuellement.',
    };
  }

  const depart = await resoudreCoordonnees(entree.depart, cle, 'depart', racineGeocodage);
  if (!depart.ok) return { disponible: false, raison: depart.raison };

  const arrivee = await resoudreCoordonnees(entree.arrivee, cle, 'arrivee', racineGeocodage);
  if (!arrivee.ok) return { disponible: false, raison: arrivee.raison };

  const resultat = await itineraire(depart.coordonnees, arrivee.coordonnees, cle, racineItineraire);
  if (!resultat.ok) return { disponible: false, raison: resultat.raison };

  return {
    disponible: true,
    distanceKm: resultat.distanceKm,
    attribution: ATTRIBUTION_OPENSTREETMAP,
  };
}
