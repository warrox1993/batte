/**
 * Le client d'itinéraire, éprouvé SANS jamais appeler OpenRouteService.
 *
 * INTERDIT ABSOLU de la mission (D-064) : « n'appelle JAMAIS le service réel
 * dans un test. » Deux mécanismes le garantissent ici :
 *
 *  1. **Racines de service INJECTÉES** (`OptionsCalculDistance`) : chaque test
 *     pointe `racineGeocodage` / `racineItineraire` vers un serveur
 *     `node:http` local, ou vers un port mort (panne réseau reproductible),
 *     jamais vers `api.openrouteservice.org`. Même recette que
 *     `apps/api/src/ia/client.test.ts` (`ANTHROPIC_BASE_URL`), adaptée en
 *     paramètre plutôt qu'en variable d'environnement puisque ce module
 *     n'utilise pas un SDK qui sait déjà lire une telle variable.
 *  2. **Balayage anti-fuite** : une clé sentinelle circule dans tous les
 *     scénarios d'échec, et aucune assertion ne doit jamais la voir ressortir
 *     — ni dans la raison affichée, ni dans le texte qu'un test lirait en cas
 *     d'échec de l'assertion elle-même.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coutDeplacementSessionCents } from '@batte/core';
import {
  ATTRIBUTION_OPENSTREETMAP,
  calculerDistanceRoutiere,
  itineraireConfigure,
} from './client.js';

/** Valeur témoin : sa seule présence dans une sortie est une preuve de fuite. */
const SENTINELLE_CLE = 'sk-or-SENTINELLE0ITINERAIRE0NE0DOIT0JAMAIS0SORTIR';

/** Un port local qui n'écoute pas : connexion refusée immédiatement, hors réseau. */
const RACINE_MORTE = 'http://127.0.0.1:1';

/** Motifs qu'aucune raison ne doit jamais porter. */
const MOTIFS_INTERDITS: readonly RegExp[] = [
  /SENTINELLE0/,
  /api_key=/i,
  /Bearer\s|Authorization/i,
  /127\.0\.0\.1/,
];

function attendreAucuneFuite(texte: string, contexte: string): void {
  for (const motif of MOTIFS_INTERDITS) {
    expect(texte, `${contexte} : ${String(motif)}`).not.toMatch(motif);
  }
}

/**
 * Serveur HTTP local qui rend TOUJOURS le même statut et le même corps, quel
 * que soit le chemin ou la méthode — jamais l'API OpenRouteService réelle.
 */
function demarrerServeur(
  statut: number,
  corps: unknown,
): Promise<{ url: string; fermer: () => Promise<void> }> {
  return new Promise((resolve) => {
    const serveur: Server = createServer((requete, reponse) => {
      requete.on('data', () => {});
      requete.on('end', () => {
        // `Connection: close` : sans lui, `fetch` (undici) garde le socket en
        // vie (keep-alive), et `serveur.close()` n'appelle son callback qu'une
        // fois TOUTES les connexions closes — le test attend alors jusqu'au
        // `keepAliveTimeout` du serveur HTTP (5 s par défaut) et dépasse le
        // délai de test par défaut de Vitest.
        reponse.writeHead(statut, { 'content-type': 'application/json', Connection: 'close' });
        reponse.end(JSON.stringify(corps));
      });
    });
    serveur.listen(0, '127.0.0.1', () => {
      const adresse = serveur.address();
      const port = typeof adresse === 'object' && adresse !== null ? adresse.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        fermer: () =>
          new Promise((resoudre) => {
            serveur.close(() => resoudre());
            // Ceinture et bretelles : force la fermeture des sockets encore
            // ouverts (keep-alive) au lieu d'attendre leur expiration naturelle.
            serveur.closeAllConnections();
          }),
      });
    });
  });
}

/** Réponse de géocodage OpenRouteService avec une coordonnée trouvée. */
function corpsGeocodageTrouve(longitude: number, latitude: number): unknown {
  return { features: [{ geometry: { coordinates: [longitude, latitude] } }] };
}

/** Réponse de géocodage sans résultat — l'adresse n'a rien retourné. */
const CORPS_GEOCODAGE_VIDE = { features: [] };

/** Réponse d'itinéraire avec une distance en MÈTRES. */
function corpsItineraire(distanceMetres: number): unknown {
  return { routes: [{ summary: { distance: distanceMetres } }] };
}

const envInitial: Record<string, string | undefined> = {};

function definir(cle: string, valeur: string | undefined): void {
  if (!(cle in envInitial)) envInitial[cle] = process.env[cle];
  if (valeur === undefined) delete process.env[cle];
  else process.env[cle] = valeur;
}

beforeEach(() => {
  definir('OPENROUTESERVICE_API_KEY', undefined);
});

afterEach(() => {
  for (const [cle, valeur] of Object.entries(envInitial)) {
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. Mode dégradé : cinq cas, cinq raisons françaises, jamais 0 km
   ═══════════════════════════════════════════════════════════════════════════ */

describe('mode dégradé', () => {
  it('sans clé : refus motivé, jamais une distance à 0', async () => {
    expect(itineraireConfigure()).toBe(false);

    const resultat = await calculerDistanceRoutiere({
      depart: { type: 'adresse', adresse: 'Rue de la Paix 1, Liège' },
      arrivee: { type: 'adresse', adresse: 'Quai de la Batte, Liège' },
    });

    expect(resultat.disponible).toBe(false);
    if (!resultat.disponible) {
      expect(resultat.raison).toContain('OPENROUTESERVICE_API_KEY');
      attendreAucuneFuite(resultat.raison, 'refus sans clé');
    }
  });

  it('une clé faite d’espaces vaut une clé absente', () => {
    definir('OPENROUTESERVICE_API_KEY', '   ');
    expect(itineraireConfigure()).toBe(false);
  });

  it('clé refusée (401) : la raison nomme OPENROUTESERVICE_API_KEY, jamais le corps du fournisseur', async () => {
    definir('OPENROUTESERVICE_API_KEY', SENTINELLE_CLE);
    const serveur = await demarrerServeur(401, {
      error: `invalid api_key: ${SENTINELLE_CLE}`,
    });

    try {
      const resultat = await calculerDistanceRoutiere(
        {
          depart: { type: 'adresse', adresse: 'Domicile' },
          arrivee: { type: 'adresse', adresse: 'Marché' },
        },
        { racineGeocodage: serveur.url, racineItineraire: serveur.url },
      );

      expect(resultat.disponible).toBe(false);
      if (!resultat.disponible) {
        expect(resultat.raison).toContain('OPENROUTESERVICE_API_KEY');
        expect(resultat.raison).not.toContain('invalid api_key');
        attendreAucuneFuite(resultat.raison, '401');
      }
    } finally {
      await serveur.fermer();
    }
  });

  it('quota dépassé (429) : la raison parle de quota, jamais de clé', async () => {
    definir('OPENROUTESERVICE_API_KEY', SENTINELLE_CLE);
    const serveur = await demarrerServeur(429, { error: 'rate limit exceeded' });

    try {
      const resultat = await calculerDistanceRoutiere(
        {
          depart: { type: 'adresse', adresse: 'Domicile' },
          arrivee: { type: 'adresse', adresse: 'Marché' },
        },
        { racineGeocodage: serveur.url, racineItineraire: serveur.url },
      );

      expect(resultat.disponible).toBe(false);
      if (!resultat.disponible) {
        expect(resultat.raison).toContain('Quota');
        expect(resultat.raison).not.toContain('OPENROUTESERVICE_API_KEY');
        attendreAucuneFuite(resultat.raison, '429');
      }
    } finally {
      await serveur.fermer();
    }
  });

  it('panne réseau (port mort) : raison « injoignable », jamais l’adresse ni ECONNREFUSED en clair', async () => {
    definir('OPENROUTESERVICE_API_KEY', SENTINELLE_CLE);

    const resultat = await calculerDistanceRoutiere(
      {
        depart: { type: 'adresse', adresse: 'Domicile' },
        arrivee: { type: 'adresse', adresse: 'Marché' },
      },
      { racineGeocodage: RACINE_MORTE, racineItineraire: RACINE_MORTE },
    );

    expect(resultat.disponible).toBe(false);
    if (!resultat.disponible) {
      expect(resultat.raison).toContain('injoignable');
      attendreAucuneFuite(resultat.raison, 'panne réseau');
    }
  });

  it('adresse introuvable : la raison nomme l’adresse en cause, jamais 0 km', async () => {
    definir('OPENROUTESERVICE_API_KEY', SENTINELLE_CLE);
    const serveur = await demarrerServeur(200, CORPS_GEOCODAGE_VIDE);

    try {
      const resultat = await calculerDistanceRoutiere(
        {
          depart: { type: 'adresse', adresse: 'Adresse totalement fantaisiste 999999' },
          arrivee: { type: 'adresse', adresse: 'Marché' },
        },
        { racineGeocodage: serveur.url, racineItineraire: serveur.url },
      );

      expect(resultat.disponible).toBe(false);
      if (!resultat.disponible) {
        expect(resultat.raison).toContain('introuvable');
        expect(resultat.raison).toContain('Adresse totalement fantaisiste 999999');
        attendreAucuneFuite(resultat.raison, 'adresse introuvable');
      }
    } finally {
      await serveur.fermer();
    }
  });

  it('ne lève jamais : une panne ne doit jamais casser l’écriture d’un lieu', async () => {
    definir('OPENROUTESERVICE_API_KEY', SENTINELLE_CLE);

    await expect(
      calculerDistanceRoutiere(
        {
          depart: { type: 'adresse', adresse: 'Domicile' },
          arrivee: { type: 'adresse', adresse: 'Marché' },
        },
        { racineGeocodage: RACINE_MORTE, racineItineraire: RACINE_MORTE },
      ),
    ).resolves.toBeDefined();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Chemin de succès : distance au DIXIÈME de km (D-074), attribution
      obligatoire
   ═══════════════════════════════════════════════════════════════════════════ */

describe('calcul réussi', () => {
  it('convertit les mètres en kilomètres au DIXIÈME près (D-074) et joint l’attribution OSM', async () => {
    definir('OPENROUTESERVICE_API_KEY', SENTINELLE_CLE);
    const geocodage = await demarrerServeur(200, corpsGeocodageTrouve(5.57, 50.62));
    const itineraireServeur = await demarrerServeur(200, corpsItineraire(42_300));

    try {
      const resultat = await calculerDistanceRoutiere(
        {
          depart: { type: 'adresse', adresse: 'Domicile' },
          arrivee: { type: 'adresse', adresse: 'Marché de La Batte' },
        },
        { racineGeocodage: geocodage.url, racineItineraire: itineraireServeur.url },
      );

      expect(resultat.disponible).toBe(true);
      if (resultat.disponible) {
        // 42 300 m → 42,3 km : AVANT D-074, l'arrondi au km entier aurait
        // rendu 42 et jeté ces 300 m sans que rien en aval ne le compense.
        expect(resultat.distanceKm).toBe(42.3);
        expect(resultat.attribution).toBe(ATTRIBUTION_OPENSTREETMAP);
        expect(resultat.attribution).toContain('OpenStreetMap');
      }
    } finally {
      await geocodage.fermer();
      await itineraireServeur.fermer();
    }
  });

  it('ne garde PAS plus qu’un dixième de km : le mètre exact serait une fausse précision (D-074)', async () => {
    definir('OPENROUTESERVICE_API_KEY', SENTINELLE_CLE);
    const geocodage = await demarrerServeur(200, corpsGeocodageTrouve(5.57, 50.62));
    // 12 437 m : ni un compte rond de km, ni un compte rond de 100 m — le cas
    // qui distingue vraiment les trois options du rapport (mètre / dixième /
    // km entier).
    const itineraireServeur = await demarrerServeur(200, corpsItineraire(12_437));

    try {
      const resultat = await calculerDistanceRoutiere(
        {
          depart: { type: 'adresse', adresse: 'Domicile' },
          arrivee: { type: 'adresse', adresse: 'Marché de La Batte' },
        },
        { racineGeocodage: geocodage.url, racineItineraire: itineraireServeur.url },
      );

      expect(resultat.disponible).toBe(true);
      if (resultat.disponible) {
        // 12 437 m → 124,37 dixièmes de km → arrondi à 124 → 12,4 km. Ni
        // 12.437 (le mètre brut, une précision que le réseau routier ne tient
        // pas), ni 12 (le kilomètre entier, le défaut d'avant D-074).
        expect(resultat.distanceKm).toBe(12.4);
      }
    } finally {
      await geocodage.fermer();
      await itineraireServeur.fermer();
    }
  });

  it('BOUT EN BOUT (D-074) — la décimale rendue par le service survit jusqu’au coût de déplacement, en centimes, sans arrondi intermédiaire', async () => {
    definir('OPENROUTESERVICE_API_KEY', SENTINELLE_CLE);
    const geocodage = await demarrerServeur(200, corpsGeocodageTrouve(5.57, 50.62));
    // Même itinéraire que le test ci-dessus (12 437 m → 12,4 km) : celui-là
    // prouve que la conversion garde la décimale ; celui-ci prouve qu'elle
    // ARRIVE JUSQU'À L'ARGENT, dans `packages/core/src/deplacement.ts`.
    const itineraireServeur = await demarrerServeur(200, corpsItineraire(12_437));

    try {
      const resultat = await calculerDistanceRoutiere(
        {
          depart: { type: 'adresse', adresse: 'Domicile' },
          arrivee: { type: 'adresse', adresse: 'Marché de La Batte' },
        },
        { racineGeocodage: geocodage.url, racineItineraire: itineraireServeur.url },
      );

      expect(resultat.disponible).toBe(true);
      if (!resultat.disponible) return;

      // Barème officiel à quatre décimales (0,4761 €/km = 47,61 c/km, D-060) :
      // un arrondi intermédiaire à deux décimales de centime en perdrait le
      // dernier chiffre, exactement l'écueil que CLAUDE.md §3 règle 3 (« argent
      // en entiers ») impose d'éviter par un arrondi UNIQUE, à la fin.
      const coutCents = coutDeplacementSessionCents(resultat.distanceKm, 47.61);

      // 12,4 km aller simple × 2 (aller-retour, D-060) × 47,61 c/km
      // = 24,8 × 47,61 = 1180,728 → arrondi UNE SEULE FOIS à 1181 centimes.
      expect(coutCents).toBe(1181);

      // La preuve que la décimale comptait réellement : AVANT D-074, la
      // distance aurait été jetée à 12 km entiers dès la source, et ce même
      // calcul aurait rendu 12 × 2 × 47,61 = 1142,64 → 1143 centimes — 38
      // centimes de moins par session, silencieusement, sur cette seule
      // distance.
      const coutCentsAvecAncienArrondi = coutDeplacementSessionCents(12, 47.61);
      expect(coutCentsAvecAncienArrondi).toBe(1143);
      expect(coutCents).not.toBe(coutCentsAvecAncienArrondi);
    } finally {
      await geocodage.fermer();
      await itineraireServeur.fermer();
    }
  });

  it('ne géocode PAS un point déjà fourni en coordonnées', async () => {
    definir('OPENROUTESERVICE_API_KEY', SENTINELLE_CLE);
    // Le géocodage pointe vers un port mort : si le code l'appelait malgré des
    // coordonnées déjà connues, ce test échouerait au lieu de réussir.
    const itineraireServeur = await demarrerServeur(200, corpsItineraire(10_000));

    try {
      const resultat = await calculerDistanceRoutiere(
        {
          depart: { type: 'coordonnees', coordonnees: { latitude: 50.6, longitude: 5.5 } },
          arrivee: { type: 'coordonnees', coordonnees: { latitude: 50.65, longitude: 5.58 } },
        },
        { racineGeocodage: RACINE_MORTE, racineItineraire: itineraireServeur.url },
      );

      expect(resultat.disponible).toBe(true);
      if (resultat.disponible) expect(resultat.distanceKm).toBe(10);
    } finally {
      await itineraireServeur.fermer();
    }
  });

  it('aucun itinéraire trouvé : refus motivé, jamais 0 km', async () => {
    definir('OPENROUTESERVICE_API_KEY', SENTINELLE_CLE);
    const geocodage = await demarrerServeur(200, corpsGeocodageTrouve(5.57, 50.62));
    const itineraireServeur = await demarrerServeur(200, { routes: [] });

    try {
      const resultat = await calculerDistanceRoutiere(
        {
          depart: { type: 'adresse', adresse: 'Domicile' },
          arrivee: { type: 'adresse', adresse: 'Marché' },
        },
        { racineGeocodage: geocodage.url, racineItineraire: itineraireServeur.url },
      );

      expect(resultat.disponible).toBe(false);
      if (!resultat.disponible) attendreAucuneFuite(resultat.raison, 'aucun itinéraire');
    } finally {
      await geocodage.fermer();
      await itineraireServeur.fermer();
    }
  });
});
