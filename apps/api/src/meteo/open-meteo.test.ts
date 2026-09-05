/**
 * Client Open-Meteo, eprouve SANS jamais appeler le vrai service.
 *
 * Un audit a trouve quatre colonnes de `meteo_observation` structurellement
 * inremplissables (`temperature_ressentie_c`, `probabilite_pluie_bp`,
 * `code_meteo`, `donnees_brutes`) : ce module ne demandait jamais les
 * variables Open-Meteo correspondantes. Ce fichier prouve que les quatre
 * champs sont desormais extraits correctement de la reponse HTTP — mais
 * jamais en interrogeant `https://api.open-meteo.com` : un serveur `node:http`
 * LOCAL imite la forme exacte de sa reponse (meme recette que
 * `apps/api/src/ia/client.test.ts`), et `releverMeteo` accepte un `racineUrl`
 * injectable exactement pour cette raison (CLAUDE.md — un test qui depend du
 * reseau n'est pas un test).
 *
 * Noms de variables et unites verifies le 30/07/2026 par un appel direct
 * (hors test) a `https://api.open-meteo.com/v1/forecast` — voir le rapport de
 * ce lot pour la reponse brute observee.
 */

import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { releverMeteo, type FenetreMarche } from './open-meteo.js';

/** Sert un corps JSON fixe, quelle que soit la requete recue — jamais le vrai service. */
function demarrerServeurJson(
  corps: unknown,
): Promise<{ url: string; fermer: () => Promise<void> }> {
  return new Promise((resolve) => {
    const serveur: Server = createServer((requete, reponse) => {
      requete.on('data', () => {});
      requete.on('end', () => {
        reponse.writeHead(200, { 'content-type': 'application/json' });
        reponse.end(JSON.stringify(corps));
      });
    });
    serveur.listen(0, '127.0.0.1', () => {
      const adresse = serveur.address();
      const port = typeof adresse === 'object' && adresse !== null ? adresse.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        fermer: () => new Promise((resoudre) => serveur.close(() => resoudre())),
      });
    });
  });
}

const DATE = '2026-08-02';
const HEURES = Array.from({ length: 24 }, (_, h) => `${DATE}T${String(h).padStart(2, '0')}:00`);

/** Fenetre 09:00-14:00 → indices horaires 9 a 14 inclus (6 heures). */
const FENETRE: FenetreMarche = {
  latitude: 50.6447,
  longitude: 5.5822,
  date: DATE,
  heureDebut: '09:00',
  heureFin: '14:00',
};

/** Sentinelle absurde placee HORS fenetre : sa fuite dans un resultat serait immediatement visible. */
const HORS_FENETRE = 999;

/** Remplit les 24 heures avec la sentinelle, puis les 6 heures de la fenetre (indices 9-14) avec `dansLaFenetre`. */
function serieHoraire(dansLaFenetre: readonly (number | null)[]): (number | null)[] {
  const serie = new Array<number | null>(24).fill(HORS_FENETRE);
  dansLaFenetre.forEach((v, i) => {
    serie[9 + i] = v;
  });
  return serie;
}

const UNITES_REELLES = {
  time: 'iso8601',
  temperature_2m: '°C',
  apparent_temperature: '°C',
  precipitation: 'mm',
  precipitation_probability: '%',
  wind_speed_10m: 'km/h',
  cloud_cover: '%',
  weather_code: 'wmo code',
};

/**
 * Reponse Open-Meteo complete. Les quatre variables CONSOMMEES par le moteur
 * (temperature, precipitations, vent, couverture) restent fixes d'un test a
 * l'autre — seules les trois variables nouvellement collectees varient par
 * scenario, pour isoler ce qu'on teste.
 */
function reponseOpenMeteo(champs: {
  apparentTemperature?: readonly (number | null)[];
  precipitationProbability?: readonly (number | null)[];
  weatherCode?: readonly (number | null)[];
  omettreChamps?: readonly (
    'apparent_temperature' | 'precipitation_probability' | 'weather_code'
  )[];
}): unknown {
  const hourly: Record<string, unknown> = {
    time: HEURES,
    temperature_2m: serieHoraire([10, 11, 12, 13, 14, 15]),
    precipitation: serieHoraire([0, 0, 0.2, 0, 0, 0]),
    wind_speed_10m: serieHoraire([10, 12, 11, 13, 9, 11]),
    cloud_cover: serieHoraire([50, 50, 50, 50, 50, 50]),
  };

  if (!champs.omettreChamps?.includes('apparent_temperature')) {
    hourly.apparent_temperature = serieHoraire(champs.apparentTemperature ?? [8, 9, 9, 9, 9, 10]);
  }
  if (!champs.omettreChamps?.includes('precipitation_probability')) {
    hourly.precipitation_probability = serieHoraire(
      champs.precipitationProbability ?? [10, 20, 85, 15, 60, 5],
    );
  }
  if (!champs.omettreChamps?.includes('weather_code')) {
    hourly.weather_code = serieHoraire(champs.weatherCode ?? [3, 3, 61, 3, 80, 3]);
  }

  return { hourly, hourly_units: UNITES_REELLES };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Les quatre variables historiques restent correctes (non-regression)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('conditions historiques (non-regression)', () => {
  it('temperature, precipitations, vent, couverture : identiques à avant ce lot', async () => {
    const serveur = await demarrerServeurJson(reponseOpenMeteo({}));
    try {
      const resultat = await releverMeteo(
        FENETRE,
        () => new Date('2026-08-01T08:00:00Z'),
        serveur.url,
      );
      expect(resultat.disponible).toBe(true);
      if (!resultat.disponible) return;
      expect(resultat.releve.conditions).toEqual({
        temperatureC: 12.5,
        precipitationsMm: 0.2,
        ventKmh: 11,
        couvertureNuageuseBp: 5000,
      });
    } finally {
      await serveur.fermer();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Les trois nouvelles variables sont correctement extraites
   ═══════════════════════════════════════════════════════════════════════════ */

describe('temperature ressentie (apparent_temperature)', () => {
  it('moyenne sur la fenêtre, arrondie à 0,1 °C, jamais les heures hors fenêtre', async () => {
    const serveur = await demarrerServeurJson(
      reponseOpenMeteo({ apparentTemperature: [8, 9, 9, 9, 9, 10] }),
    );
    try {
      const resultat = await releverMeteo(FENETRE, () => new Date(), serveur.url);
      expect(resultat.disponible).toBe(true);
      if (!resultat.disponible) return;
      // (8+9+9+9+9+10)/6 = 9.0 exactement — si la sentinelle 999 fuitait, la
      // moyenne serait écrasée à plusieurs centaines de degrés.
      expect(resultat.releve.temperatureRessentieC).toBe(9);
    } finally {
      await serveur.fermer();
    }
  });
});

describe('probabilité de pluie (precipitation_probability)', () => {
  it('retient le MAXIMUM horaire de la fenêtre, pas la moyenne, en points de base', async () => {
    const serveur = await demarrerServeurJson(
      reponseOpenMeteo({ precipitationProbability: [10, 20, 85, 15, 60, 5] }),
    );
    try {
      const resultat = await releverMeteo(FENETRE, () => new Date(), serveur.url);
      expect(resultat.disponible).toBe(true);
      if (!resultat.disponible) return;
      // Max = 85 % → 8500 bp. Une moyenne (32,5 %) donnerait 3250 : la
      // distinction prouve que l'agrégation retenue est bien le maximum.
      expect(resultat.releve.probabilitePluieBp).toBe(8500);
    } finally {
      await serveur.fermer();
    }
  });

  it('une probabilité absente vaut null, jamais 0 (CLAUDE.md)', async () => {
    const serveur = await demarrerServeurJson(
      reponseOpenMeteo({ omettreChamps: ['precipitation_probability'] }),
    );
    try {
      const resultat = await releverMeteo(FENETRE, () => new Date(), serveur.url);
      expect(resultat.disponible).toBe(true);
      if (!resultat.disponible) return;
      expect(resultat.releve.probabilitePluieBp).toBeNull();
      expect(resultat.releve.probabilitePluieBp).not.toBe(0);
    } finally {
      await serveur.fermer();
    }
  });
});

describe('code météo dominant (weather_code)', () => {
  it('retient le code le plus fréquent sur la fenêtre', async () => {
    const serveur = await demarrerServeurJson(
      reponseOpenMeteo({ weatherCode: [3, 3, 61, 3, 80, 3] }),
    );
    try {
      const resultat = await releverMeteo(FENETRE, () => new Date(), serveur.url);
      expect(resultat.disponible).toBe(true);
      if (!resultat.disponible) return;
      // 3 apparaît 4 fois sur 6 : c'est le mode, ni 61 ni 80 (une seule fois chacun).
      expect(resultat.releve.codeMeteo).toBe(3);
    } finally {
      await serveur.fermer();
    }
  });

  it('égalité de fréquence : le code qui atteint ce compte en premier l’emporte', async () => {
    // Fenêtre réduite à 4 heures (09:00-12:00) pour un cas à deux valeurs
    // strictement à égalité (2 occurrences chacune). 5 apparaît en 1er (index 0)
    // mais 3 ATTEINT sa 2e occurrence avant que 5 n'atteigne la sienne
    // (index 2 contre index 3) : c'est 3 qui doit gagner.
    const fenetreCourte: FenetreMarche = { ...FENETRE, heureFin: '12:00' };
    const serveur = await demarrerServeurJson(reponseOpenMeteo({ weatherCode: [5, 3, 3, 5] }));
    try {
      const resultat = await releverMeteo(fenetreCourte, () => new Date(), serveur.url);
      expect(resultat.disponible).toBe(true);
      if (!resultat.disponible) return;
      expect(resultat.releve.codeMeteo).toBe(3);
    } finally {
      await serveur.fermer();
    }
  });

  it('un code absent vaut null, jamais 0', async () => {
    const serveur = await demarrerServeurJson(
      reponseOpenMeteo({ omettreChamps: ['weather_code'] }),
    );
    try {
      const resultat = await releverMeteo(FENETRE, () => new Date(), serveur.url);
      expect(resultat.disponible).toBe(true);
      if (!resultat.disponible) return;
      expect(resultat.releve.codeMeteo).toBeNull();
    } finally {
      await serveur.fermer();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Données brutes : restreintes à la fenêtre, jamais la journée entière
   ═══════════════════════════════════════════════════════════════════════════ */

describe('données brutes de la fenêtre', () => {
  it('ne conserve que les heures de la fenêtre, pas les 24 h de la journée', async () => {
    const serveur = await demarrerServeurJson(reponseOpenMeteo({}));
    try {
      const resultat = await releverMeteo(FENETRE, () => new Date(), serveur.url);
      expect(resultat.disponible).toBe(true);
      if (!resultat.disponible) return;
      const brutes = resultat.releve.donneesBrutes;
      expect(brutes).toBeDefined();
      if (brutes === undefined) return;
      expect(brutes.heures).toEqual([
        `${DATE}T09:00`,
        `${DATE}T10:00`,
        `${DATE}T11:00`,
        `${DATE}T12:00`,
        `${DATE}T13:00`,
        `${DATE}T14:00`,
      ]);
      // Chaque variable brute ne porte que les 6 valeurs de la fenêtre, jamais
      // la sentinelle 999 placée hors fenêtre.
      expect(brutes.valeurs.temperature_2m).toEqual([10, 11, 12, 13, 14, 15]);
      expect(brutes.valeurs.apparent_temperature).toEqual([8, 9, 9, 9, 9, 10]);
      expect(brutes.valeurs.precipitation_probability).toEqual([10, 20, 85, 15, 60, 5]);
      expect(brutes.valeurs.weather_code).toEqual([3, 3, 61, 3, 80, 3]);
      for (const valeurs of Object.values(brutes.valeurs)) {
        expect(valeurs).not.toContain(HORS_FENETRE);
      }
    } finally {
      await serveur.fermer();
    }
  });

  it('conserve les unités annoncées par Open-Meteo pour chaque variable', async () => {
    const serveur = await demarrerServeurJson(reponseOpenMeteo({}));
    try {
      const resultat = await releverMeteo(FENETRE, () => new Date(), serveur.url);
      expect(resultat.disponible).toBe(true);
      if (!resultat.disponible) return;
      const brutes = resultat.releve.donneesBrutes;
      expect(brutes).toBeDefined();
      if (brutes === undefined) return;
      expect(brutes.unites).toEqual({
        temperature_2m: '°C',
        apparent_temperature: '°C',
        precipitation: 'mm',
        precipitation_probability: '%',
        wind_speed_10m: 'km/h',
        cloud_cover: '%',
        weather_code: 'wmo code',
      });
    } finally {
      await serveur.fermer();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Chemins d'échec inchangés : le mode dégradé reste complet
   ═══════════════════════════════════════════════════════════════════════════ */

describe('mode dégradé (chemins d’échec, non-regression)', () => {
  it('service injoignable (port mort local, jamais le vrai Open-Meteo)', async () => {
    // Port 1 en boucle locale : jamais en écoute, panne reseau reproductible.
    const resultat = await releverMeteo(FENETRE, () => new Date(), 'http://127.0.0.1:1');
    expect(resultat.disponible).toBe(false);
    if (resultat.disponible) return;
    expect(resultat.raison).toContain('injoignable');
  });

  it('aucune heure prévue sur la fenêtre : rejet avant tout calcul des nouveaux champs', async () => {
    const serveur = await demarrerServeurJson({
      hourly: { time: [], temperature_2m: [] },
      hourly_units: UNITES_REELLES,
    });
    try {
      const resultat = await releverMeteo(FENETRE, () => new Date(), serveur.url);
      expect(resultat.disponible).toBe(false);
      if (resultat.disponible) return;
      expect(resultat.raison).toContain('ne va pas si loin');
    } finally {
      await serveur.fermer();
    }
  });

  it('une variable historique manquante rejette tout le relevé, malgré les nouvelles variables présentes', async () => {
    const corps = reponseOpenMeteo({}) as { hourly: Record<string, unknown> };
    // Le vent (variable CONSOMMÉE par le moteur) est absent : le relevé entier
    // doit rester indisponible, même si les trois nouvelles variables sont là.
    delete corps.hourly.wind_speed_10m;
    const serveur = await demarrerServeurJson(corps);
    try {
      const resultat = await releverMeteo(FENETRE, () => new Date(), serveur.url);
      expect(resultat.disponible).toBe(false);
      if (resultat.disponible) return;
      expect(resultat.raison).toContain('incomplet');
    } finally {
      await serveur.fermer();
    }
  });
});
