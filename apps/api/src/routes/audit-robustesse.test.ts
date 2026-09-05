/**
 * Audit de robustesse — entrées hostiles ou absurdes sur les routes de la
 * zone confiée à cet agent (CLAUDE.md §4 : « validation Zod à toutes les
 * frontières », « jamais de catch silencieux », « erreurs métier typées,
 * remontées en français compréhensible » ; docs/05-DECISIONS.md D-035 : une
 * erreur de saisie est un 422, jamais un 500).
 *
 * Ce fichier COMPLÈTE deux balayages existants qui ne couvrent pas cette
 * dimension :
 *  - `erreurs-500.test.ts` balaie tout le serveur contre des 500 mais ne
 *    couvre qu'une poignée de routes par famille de défaut ;
 *  - le balayage anti-fuite (D-045) vérifie que les routes de LECTURE
 *    répondent et ne fuitent pas de secret, mais n'envoie AUCUNE entrée
 *    hostile.
 *
 * Zone couverte (routes d'écriture et de lecture paramétrée) : sessions,
 * stock, afsca, referentiel, previsions, opportunites, lieux-rentabilite,
 * menus, objectifs, factures, economies, concurrents, comptabilite, ia,
 * evenements-decouverte, parametres, documents, recettes.
 *
 * Principe directeur : AUCUNE entrée envoyée ici n'est jamais valide. Le seul
 * verdict qui compte est donc « jamais 500 », et — quand le code source a été
 * lu et le chemin vérifié explicitement — le code exact attendu (404 pour un
 * identifiant adressé dans l'URL, 422 avec `champs` pour une valeur saisie).
 */

import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { creerBase, migrer, schema, seed, seedDemonstration, type BaseBatte } from '@batte/db';
import type { ListeLieux } from '@batte/core';
import { construireServeur } from '../serveur.js';

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

/** Identifiant syntaxiquement plausible (UUIDv7) mais absent de la base. */
const ID_INCONNU = '019fa000-0000-7000-8000-000000000000';

/**
 * Detournement du reseau meteo — aucun appel reel a Open-Meteo pendant cet
 * audit (CLAUDE.md — « un test qui depend du reseau n'est pas un test »).
 *
 * `seedDemonstration()` pose un lieu avec coordonnees ET une session
 * PLANIFIEE sans meteo encore en cache : c'est exactement la condition qui
 * declenche `releverMeteo` (`apps/api/src/meteo/open-meteo.ts`) vers le vrai
 * `https://api.open-meteo.com` des qu'une route de ce fichier finit par
 * exercer `previsionCourante` (`/api/prevision`, `/api/prevision/brief`,
 * `POST /api/prevision/archiver`) — aucun cas actuel de ce fichier ne
 * l'atteint (la validation Zod du corps vide de `/api/prevision/archiver`
 * refuse AVANT tout calcul), mais ce fichier monte le serveur COMPLET sans
 * jamais transmettre `racineUrlMeteo` : le risque est structurel, pas
 * seulement celui des cas exerces aujourd'hui, et reviendrait en silence des
 * qu'un cas futur toucherait l'une de ces trois routes.
 *
 * Meme detournement, memes garanties que `apps/api/src/smoke-routes-lecture.test.ts` :
 * `construireServeur` accepte `{ racineUrlMeteo }`, pointe ici vers un
 * serveur `node:http` local qui IMITE la FORME d'une reponse Open-Meteo (il
 * echoue `start_date` pour rester valable quelle que soit la date
 * rencontree). Preuve retenue : un espion pose sur `globalThis.fetch`
 * (`vi.spyOn`, qui laisse TOUJOURS partir l'appel reel — ce n'est PAS un
 * bouchon) enregistre chaque URL appelee pendant TOUT ce fichier ; la
 * dernière section ci-dessous verifie qu'AUCUNE ne contient
 * `open-meteo.com`. Un bouchon global aurait masque un vrai defaut d'appel ;
 * cet espion, lui, laisse la requete reelle partir vers le serveur local et
 * ne fait que constater sa destination.
 */
function demarrerServeurMeteoLocal(): Promise<{ url: string; fermer: () => Promise<void> }> {
  return new Promise((resolve) => {
    const serveur: Server = createServer((requete, reponse) => {
      requete.on('data', () => {});
      requete.on('end', () => {
        const url = new URL(requete.url ?? '/', 'http://127.0.0.1');
        const date = url.searchParams.get('start_date') ?? '2026-01-01';
        const heures = Array.from(
          { length: 24 },
          (_, h) => `${date}T${String(h).padStart(2, '0')}:00`,
        );
        const remplir = (valeur: number): number[] => heures.map(() => valeur);
        reponse.writeHead(200, { 'content-type': 'application/json' });
        reponse.end(
          JSON.stringify({
            hourly: {
              time: heures,
              temperature_2m: remplir(15),
              precipitation: remplir(0),
              wind_speed_10m: remplir(10),
              cloud_cover: remplir(50),
              apparent_temperature: remplir(13.5),
              precipitation_probability: remplir(42),
              weather_code: remplir(3),
            },
            hourly_units: {
              temperature_2m: '°C',
              apparent_temperature: '°C',
              precipitation: 'mm',
              precipitation_probability: '%',
              wind_speed_10m: 'km/h',
              cloud_cover: '%',
              weather_code: 'wmo code',
            },
          }),
        );
      });
    });
    serveur.listen(0, '127.0.0.1', () => {
      const adresse = serveur.address();
      const port = typeof adresse === 'object' && adresse !== null ? adresse.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        fermer: () => new Promise<void>((resoudre) => serveur.close(() => resoudre())),
      });
    });
  });
}

describe('audit de robustesse — entrées hostiles (zone agent 7)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idLieu: string;
  let serveurMeteo: { url: string; fermer: () => Promise<void> };
  let espionFetch: MockInstance<typeof fetch>;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    serveurMeteo = await demarrerServeurMeteoLocal();
    espionFetch = vi.spyOn(globalThis, 'fetch');

    app = construireServeur(base, { journaliser: false, racineUrlMeteo: serveurMeteo.url });
    await app.ready();

    idLieu = (await app.inject({ method: 'GET', url: '/api/lieux' })).json<ListeLieux>().data[0]!
      .id;
  });

  afterAll(async () => {
    await app.close();
    espionFetch.mockRestore();
    await serveurMeteo.fermer();
  });

  /** Un message d'erreur doit être lisible par le porteur, jamais par un développeur. */
  function attendreMessageUtile(reponse: { statusCode: number; payload: string }): void {
    expect(reponse.statusCode).toBeLessThan(500);
    if (reponse.statusCode < 400) return;

    const corps = JSON.parse(reponse.payload) as ReponseErreur;
    expect(corps.erreur.code).toBeTruthy();
    expect(corps.erreur.message.length).toBeGreaterThan(10);
    expect(corps.erreur.message).not.toMatch(/SQLITE|SELECT |INSERT |at \w+ \(|\.ts:\d+/i);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     1. RÉGRESSION — bugs trouvés et corrigés pendant cet audit
     ═══════════════════════════════════════════════════════════════════════ */

  describe('régression — bugs trouvés et corrigés pendant cet audit', () => {
    /**
     * `Number.parseInt` est permissif : il tronque au premier caractère non
     * numérique au lieu de refuser la chaîne entière. `analyserAnnee`
     * (comptabilite.ts, economies.ts) et le parsing de `/api/seuils`
     * (sessions.ts) validaient l'année APRÈS conversion — une année comme
     * « 2026abc » ou « 2026.9 » passait donc silencieusement en 2026, et
     * « -2026 » passait tel quel (toujours un entier au sens de
     * `Number.isInteger`). Corrigé par un contrôle de FORMAT (regex 4
     * chiffres) avant toute conversion.
     */
    it.each([
      ['/api/seuils', 'annee'],
      ['/api/depenses', 'annee'],
      ['/api/immobilisations', 'annee'],
      ['/api/synthese-exercice', 'annee'],
      ['/api/ventes-par-creneau', 'annee'],
      ['/api/economies', 'annee'],
      ['/api/economies/tableau-bord', 'annee'],
    ])('%s?annee=2026abc rend 422 (jamais 2026 silencieux)', async (chemin) => {
      const reponse = await app.inject({ method: 'GET', url: `${chemin}?annee=2026abc` });
      expect(reponse.statusCode, chemin).toBe(422);
      const corps = JSON.parse(reponse.payload) as ReponseErreur;
      expect(corps.erreur.champs?.['annee'], chemin).toBeTruthy();
    });

    it.each(['/api/seuils', '/api/depenses', '/api/synthese-exercice', '/api/economies'])(
      '%s?annee=-2026 rend 422, une année négative n’est pas une année',
      async (chemin) => {
        const reponse = await app.inject({ method: 'GET', url: `${chemin}?annee=-2026` });
        expect(reponse.statusCode, chemin).toBe(422);
      },
    );

    /**
     * `/api/prevision-calendaire?horizonJours=…` : même défaut de parsing
     * permissif, en pire — une valeur totalement illisible retombait
     * SILENCIEUSEMENT sur l'horizon par défaut au lieu de signaler la faute.
     */
    it('GET /api/prevision-calendaire?horizonJours=abc rend 422, jamais un horizon par défaut silencieux', async () => {
      const reponse = await app.inject({
        method: 'GET',
        url: '/api/prevision-calendaire?horizonJours=abc',
      });
      expect(reponse.statusCode).toBe(422);
      const corps = JSON.parse(reponse.payload) as ReponseErreur;
      expect(corps.erreur.champs?.['horizonJours']).toBeTruthy();
    });

    it('GET /api/prevision-calendaire?horizonJours=-5 rend 422 (nombre négatif où un positif est requis)', async () => {
      const reponse = await app.inject({
        method: 'GET',
        url: '/api/prevision-calendaire?horizonJours=-5',
      });
      expect(reponse.statusCode).toBe(422);
    });

    it('GET /api/prevision-calendaire?horizonJours=14x rend 422 (jamais tronqué en 14)', async () => {
      const reponse = await app.inject({
        method: 'GET',
        url: '/api/prevision-calendaire?horizonJours=14x',
      });
      expect(reponse.statusCode).toBe(422);
    });

    it('GET /api/prevision-calendaire?horizonJours=99999999 (démesuré) ne plante jamais — écrêté par le plafond du catalogue', async () => {
      const reponse = await app.inject({
        method: 'GET',
        url: '/api/prevision-calendaire?horizonJours=99999999',
      });
      attendreMessageUtile(reponse);
      expect(reponse.statusCode).toBeLessThan(300);
    });

    // Le régression test pour `POST /api/prevision/archiver` (sessionId
    // inconnu) vit dans `previsions.test.ts` : elle a besoin d'une météo déjà
    // en cache pour ne jamais déclencher un vrai appel réseau Open-Meteo
    // (même convention que le reste de ce fichier de test), ce que cette
    // suite générique ne prépare pas.

    /**
     * `POST /api/afsca/temperatures` : `productionId` n'était vérifiée nulle
     * part avant l'écriture (contrairement à `sessionId`, déjà gardée par
     * `ecrireReleveTemperature`) — même défaut de clé étrangère non gardée.
     */
    it('POST /api/afsca/temperatures avec un productionId inconnu rend 422, jamais 500', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/afsca/temperatures',
        payload: {
          productionId: ID_INCONNU,
          equipement: 'Glacière rigide',
          temperatureC: 4,
          dateReleve: '2026-08-01',
          moment: 'depart',
        },
      });
      expect(reponse.statusCode).toBe(422);
      const corps = JSON.parse(reponse.payload) as ReponseErreur;
      expect(corps.erreur.champs?.['productionId']).toBeTruthy();
    });

    /**
     * `POST /api/afsca/nettoyage/executions` : `tacheId` est vérifiée par le
     * dépôt, mais `sessionId` ne l'était pas — même défaut.
     */
    it('POST /api/afsca/nettoyage/executions avec un sessionId inconnu rend 422, jamais 500', async () => {
      const taches = await app.inject({ method: 'GET', url: '/api/afsca/nettoyage/taches' });
      const idTache = (
        taches.json<{ data: ReadonlyArray<{ id: string }> }>().data[0] ?? { id: undefined }
      ).id;
      expect(idTache, 'Aucune tâche de nettoyage semée : le test ne peut pas courir.').toBeTruthy();

      const reponse = await app.inject({
        method: 'POST',
        url: '/api/afsca/nettoyage/executions',
        payload: {
          tacheId: idTache,
          sessionId: ID_INCONNU,
          dateExecution: '2026-08-01',
        },
      });
      expect(reponse.statusCode).toBe(422);
      const corps = JSON.parse(reponse.payload) as ReponseErreur;
      expect(corps.erreur.champs?.['sessionId']).toBeTruthy();
    });

    /**
     * `POST /api/afsca/exercices-tracabilite` : `lotDepartId` n'était vérifié
     * nulle part avant l'écriture — même défaut.
     */
    it('POST /api/afsca/exercices-tracabilite avec un lotDepartId inconnu rend 422, jamais 500', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/afsca/exercices-tracabilite',
        payload: {
          dateExercice: '2026-08-01',
          lotDepartId: ID_INCONNU,
          resultat: 'concluant',
        },
      });
      expect(reponse.statusCode).toBe(422);
      const corps = JSON.parse(reponse.payload) as ReponseErreur;
      expect(corps.erreur.champs?.['lotDepartId']).toBeTruthy();
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     2. CORPS DE REQUÊTE ABSURDES — un cas par route d'écriture de la zone
     ═══════════════════════════════════════════════════════════════════════ */

  describe('corps de requête absurdes — jamais 500, toujours un message exploitable', () => {
    const CAS: ReadonlyArray<{
      readonly methode: 'POST' | 'PATCH';
      readonly url: string;
      readonly payload: Record<string, unknown>;
      readonly description: string;
    }> = [
      // sessions.ts
      {
        methode: 'POST',
        url: '/api/sessions',
        payload: { lieuId: 123, dateSession: '2026-08-01' },
        description: 'lieuId numérique au lieu de chaîne',
      },
      {
        methode: 'POST',
        url: `/api/sessions/${ID_INCONNU}/cloturer`,
        payload: { especesCompteesCents: '300' },
        description: 'especesCompteesCents en chaîne, ventes manquantes',
      },
      {
        methode: 'PATCH',
        url: `/api/sessions/${ID_INCONNU}/rattacher-evenement`,
        payload: {},
        description: 'evenementId manquant',
      },
      {
        methode: 'POST',
        url: `/api/sessions/${ID_INCONNU}/annuler`,
        payload: {},
        description: 'motif manquant',
      },
      // stock.ts
      { methode: 'POST', url: '/api/receptions', payload: {}, description: 'corps vide' },
      {
        methode: 'POST',
        url: '/api/mouvements',
        payload: {
          ingredientId: ID_INCONNU,
          quantite: 'beaucoup',
          type: 'ajustement',
          motifCode: 'x',
          dateMouvement: '2026-08-01',
        },
        description: 'quantite en chaîne au lieu de nombre',
      },
      {
        methode: 'POST',
        url: `/api/mouvements/${ID_INCONNU}/annuler`,
        payload: {},
        description: 'motifCode manquant',
      },
      {
        methode: 'PATCH',
        url: `/api/lots/${ID_INCONNU}/statut`,
        payload: { statut: 'disparu', motifCode: 'x' },
        description: 'statut hors énumération',
      },
      // afsca.ts
      {
        methode: 'POST',
        url: '/api/afsca/temperatures',
        payload: {
          equipement: 'Glacière',
          temperatureC: 'froid',
          dateReleve: '2026-08-01',
          moment: 'depart',
        },
        description: 'temperatureC en chaîne au lieu de nombre',
      },
      {
        methode: 'POST',
        url: '/api/afsca/nettoyage/executions',
        payload: {},
        description: 'tacheId manquant',
      },
      {
        methode: 'POST',
        url: '/api/afsca/non-conformites',
        payload: {},
        description: 'corps vide',
      },
      {
        methode: 'POST',
        url: `/api/afsca/non-conformites/${ID_INCONNU}/cloturer`,
        payload: {},
        description: 'dateResolution et actionCorrective manquants',
      },
      {
        methode: 'POST',
        url: '/api/afsca/exercices-tracabilite',
        payload: { dateExercice: '2026-08-01', resultat: 'peut-etre' },
        description: 'resultat hors énumération',
      },
      // referentiel.ts
      { methode: 'POST', url: '/api/fournisseurs', payload: {}, description: 'corps vide' },
      {
        methode: 'PATCH',
        url: `/api/fournisseurs/${ID_INCONNU}/activite`,
        payload: { actif: 'oui' },
        description: 'actif non booléen',
      },
      { methode: 'POST', url: '/api/produits', payload: {}, description: 'corps vide' },
      {
        methode: 'PATCH',
        url: `/api/produits/${ID_INCONNU}/activite`,
        payload: {},
        description: 'actif manquant',
      },
      // previsions.ts
      {
        methode: 'POST',
        url: '/api/prevision/archiver',
        payload: {},
        description: 'sessionId manquant (requis bien que nullable)',
      },
      {
        methode: 'POST',
        url: '/api/evenements',
        payload: { nom: 'x' },
        description: 'champs obligatoires manquants (type, dates, portée…)',
      },
      // opportunites.ts
      { methode: 'POST', url: '/api/opportunites', payload: {}, description: 'corps vide' },
      {
        methode: 'PATCH',
        url: `/api/opportunites/${ID_INCONNU}/rattacher-lieu`,
        payload: {},
        description: 'lieuId manquant',
      },
      // menus.ts
      {
        methode: 'POST',
        url: `/api/menus/${ID_INCONNU}/composition`,
        payload: {},
        description: 'produitInclusId manquant',
      },
      {
        methode: 'PATCH',
        url: `/api/composition-menu/${ID_INCONNU}`,
        payload: { quantite: -1, produitInclusId: 'x' },
        description: 'quantite négative',
      },
      {
        methode: 'PATCH',
        url: `/api/composition-menu/${ID_INCONNU}/activite`,
        payload: {},
        description: 'actif manquant',
      },
      {
        methode: 'POST',
        url: `/api/menus/${ID_INCONNU}/ventilation`,
        payload: { prixForcesCents: { x: -5 } },
        description: 'prix forcé négatif',
      },
      // factures.ts
      { methode: 'POST', url: '/api/factures', payload: {}, description: 'corps vide' },
      {
        methode: 'PATCH',
        url: `/api/factures/${ID_INCONNU}/statut`,
        payload: { statut: 'inconnue' },
        description: 'statut hors énumération',
      },
      {
        methode: 'POST',
        url: `/api/factures/${ID_INCONNU}/annuler`,
        payload: {},
        description: 'motif manquant',
      },
      // economies.ts
      { methode: 'POST', url: '/api/economies', payload: {}, description: 'corps vide' },
      {
        methode: 'POST',
        url: '/api/economies/renegociations-tarif',
        payload: { prixCents: 19.99 },
        description: 'prixCents décimal (violation invariant n°3)',
      },
      // concurrents.ts
      { methode: 'POST', url: '/api/concurrents', payload: {}, description: 'corps vide' },
      {
        methode: 'PATCH',
        url: `/api/concurrents/${ID_INCONNU}`,
        payload: { qualitePercue: 10 },
        description: 'qualitePercue hors bornes (1 à 5)',
      },
      {
        methode: 'PATCH',
        url: `/api/concurrents/${ID_INCONNU}/activite`,
        payload: {},
        description: 'actif manquant',
      },
      {
        methode: 'POST',
        url: `/api/concurrents/${ID_INCONNU}/produits`,
        payload: { prixCents: -100 },
        description: 'prixCents négatif, nomProduit manquant',
      },
      {
        methode: 'POST',
        url: `/api/concurrents/${ID_INCONNU}/observations`,
        payload: {},
        description: 'corps vide',
      },
      // comptabilite.ts
      { methode: 'POST', url: '/api/depenses', payload: {}, description: 'corps vide' },
      {
        methode: 'POST',
        url: `/api/depenses/${ID_INCONNU}/annuler`,
        payload: {},
        description: 'motif manquant',
      },
      {
        methode: 'POST',
        url: '/api/immobilisations',
        payload: { montantCents: 1.5 },
        description: 'montantCents décimal',
      },
      {
        methode: 'POST',
        url: '/api/periodes/cloturer',
        payload: { annee: 2026, mois: 13 },
        description: 'mois hors bornes (13)',
      },
      {
        methode: 'POST',
        url: `/api/periodes/${ID_INCONNU}/rouvrir`,
        payload: {},
        description: 'motif manquant',
      },
      // evenements-decouverte.ts
      {
        methode: 'PATCH',
        url: `/api/evenements-decouverte/lieux/${ID_INCONNU}/rayon-recherche`,
        payload: { rayonRechercheEvenementsKm: 7 },
        description: 'rayon hors catalogue (5|10|15|20|40|100)',
      },
      {
        methode: 'POST',
        url: '/api/evenements-decouverte/rechercher',
        payload: {},
        description: 'lieuId manquant',
      },
      // parametres.ts
      {
        methode: 'PATCH',
        url: `/api/parametres/${ID_INCONNU}`,
        payload: { valeur: '' },
        description: 'valeur vide',
      },
      {
        methode: 'POST',
        url: '/api/parametres/plafond_ia_mensuel_cents/versions',
        payload: {},
        description: 'corps vide (valeur, dateDebutValidite, source manquants)',
      },
      // recettes.ts
      {
        methode: 'POST',
        url: `/api/recettes/${ID_INCONNU}/calculer`,
        payload: { cible: 'crepes', valeur: -5 },
        description: 'valeur négative',
      },
    ];

    it.each(CAS.map((c) => [c.methode, c.url, c.payload, c.description] as const))(
      '%s %s (%s) rend 4xx avec message exploitable, jamais 500',
      async (methode, url, payload) => {
        const reponse = await app.inject({ method: methode, url, payload });
        attendreMessageUtile(reponse);
        expect(reponse.statusCode, url).toBeGreaterThanOrEqual(400);
      },
    );
  });

  /* ═══════════════════════════════════════════════════════════════════════
     3. IDENTIFIANTS INCONNUS DANS L'URL — 404, jamais 500, jamais un succès
     ═══════════════════════════════════════════════════════════════════════ */

  describe('identifiants inconnus adressés dans l’URL', () => {
    /** Vérifiés en lisant le code : un `if (x === undefined) throw new ErreurIntrouvable` explicite. */
    const ROUTES_404_CONFIRMEES: ReadonlyArray<{
      readonly methode: 'GET' | 'PATCH' | 'POST';
      readonly url: string;
      readonly payload?: Record<string, unknown>;
    }> = [
      { methode: 'GET', url: `/api/sessions/${ID_INCONNU}` },
      { methode: 'GET', url: `/api/concurrents/${ID_INCONNU}` },
      { methode: 'GET', url: `/api/factures/${ID_INCONNU}` },
      { methode: 'GET', url: `/api/recettes/${ID_INCONNU}` },
      { methode: 'GET', url: `/api/produits/${ID_INCONNU}/cout-revient` },
      { methode: 'GET', url: `/api/documents/fiche-technique/${ID_INCONNU}` },
      { methode: 'GET', url: `/api/documents/etiquette-bac/${ID_INCONNU}` },
      { methode: 'GET', url: `/api/documents/rapport-session/${ID_INCONNU}` },
      { methode: 'GET', url: `/api/lots/${ID_INCONNU}` },
      { methode: 'GET', url: `/api/lots/${ID_INCONNU}/mouvements` },
      { methode: 'PATCH', url: `/api/parametres/${ID_INCONNU}`, payload: { valeur: 'x' } },
      {
        methode: 'POST',
        url: `/api/mouvements/${ID_INCONNU}/annuler`,
        payload: { motifCode: 'x' },
      },
      {
        methode: 'PATCH',
        url: `/api/lots/${ID_INCONNU}/statut`,
        payload: { statut: 'quarantaine', motifCode: 'x' },
      },
    ];

    it.each(ROUTES_404_CONFIRMEES.map((r) => [r.methode, r.url, r.payload] as const))(
      '%s %s rend 404',
      async (methode, url, payload) => {
        const reponse = await app.inject({
          method: methode,
          url,
          ...(payload === undefined ? {} : { payload }),
        });
        expect(reponse.statusCode, url).toBe(404);
        attendreMessageUtile(reponse);
      },
    );

    /** Comportement lu dans le dépôt, moins certain à 100 % : on exige seulement <500. */
    const ROUTES_A_VERIFIER: ReadonlyArray<{
      readonly methode: 'GET' | 'PATCH' | 'POST';
      readonly url: string;
      readonly payload?: Record<string, unknown>;
    }> = [
      {
        methode: 'PATCH',
        url: `/api/fournisseurs/${ID_INCONNU}/activite`,
        payload: { actif: true },
      },
      { methode: 'PATCH', url: `/api/produits/${ID_INCONNU}/activite`, payload: { actif: true } },
      {
        methode: 'PATCH',
        url: `/api/concurrents/${ID_INCONNU}/activite`,
        payload: { actif: true },
      },
      {
        methode: 'POST',
        url: `/api/concurrents/${ID_INCONNU}/produits`,
        payload: { nomProduit: 'Test', prixCents: 100, dateObservation: '2026-08-01' },
      },
      {
        methode: 'PATCH',
        url: `/api/factures/${ID_INCONNU}/statut`,
        payload: { statut: 'rapprochee' },
      },
      { methode: 'POST', url: `/api/factures/${ID_INCONNU}/annuler`, payload: { motif: 'Test' } },
      { methode: 'POST', url: `/api/factures/lignes/${ID_INCONNU}/corriger-lot` },
      {
        methode: 'PATCH',
        url: `/api/composition-menu/${ID_INCONNU}/activite`,
        payload: { actif: true },
      },
      {
        methode: 'POST',
        url: `/api/afsca/non-conformites/${ID_INCONNU}/cloturer`,
        payload: { dateResolution: '2026-08-01', actionCorrective: 'Test' },
      },
      { methode: 'POST', url: `/api/echeances/${ID_INCONNU}/marquer-faite`, payload: {} },
      { methode: 'POST', url: `/api/periodes/${ID_INCONNU}/rouvrir`, payload: { motif: 'Test' } },
      { methode: 'POST', url: `/api/depenses/${ID_INCONNU}/annuler`, payload: { motif: 'Test' } },
      {
        methode: 'POST',
        url: '/api/parametres/une-cle-qui-n-existe-pas-du-tout/versions',
        payload: { valeur: 'x', dateDebutValidite: '2026-01-01', source: 'test' },
      },
      { methode: 'POST', url: `/api/opportunites/${ID_INCONNU}/rejeter` },
      {
        methode: 'PATCH',
        url: `/api/evenements-decouverte/lieux/${ID_INCONNU}/rayon-recherche`,
        payload: { rayonRechercheEvenementsKm: 10 },
      },
      {
        methode: 'POST',
        url: `/api/evenements-decouverte/propositions/${ID_INCONNU}/valider`,
        payload: {},
      },
      { methode: 'POST', url: `/api/evenements-decouverte/propositions/${ID_INCONNU}/rejeter` },
      {
        methode: 'PATCH',
        url: `/api/sessions/${ID_INCONNU}/rattacher-evenement`,
        payload: { evenementId: 'dummy-inconnu' },
      },
      { methode: 'POST', url: `/api/sessions/${ID_INCONNU}/annuler`, payload: { motif: 'Test' } },
      { methode: 'GET', url: `/api/afsca/tracabilite/sessions/${ID_INCONNU}` },
      { methode: 'GET', url: `/api/afsca/tracabilite/lots/${ID_INCONNU}` },
    ];

    it.each(ROUTES_A_VERIFIER.map((r) => [r.methode, r.url, r.payload] as const))(
      '%s %s ne rend jamais 500 sur un identifiant inconnu',
      async (methode, url, payload) => {
        const reponse = await app.inject({
          method: methode,
          url,
          ...(payload === undefined ? {} : { payload }),
        });
        attendreMessageUtile(reponse);
        // Un identifiant inconnu ne doit jamais se solder par un succès : ce
        // serait laisser croire qu'une ressource a été modifiée alors que rien
        // n'existe à cette adresse.
        expect(reponse.statusCode, url).toBeGreaterThanOrEqual(400);
      },
    );
  });

  /* ═══════════════════════════════════════════════════════════════════════
     4. VALEURS LIMITES — zéro, énorme, chaîne vide, 10 000 caractères, emoji
     ═══════════════════════════════════════════════════════════════════════ */

  describe('valeurs limites', () => {
    it('un libellé de dépense de 10 000 caractères ne fait pas planter la route', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/depenses',
        payload: {
          dateDepense: '2026-08-01',
          libelle: 'A'.repeat(10_000),
          categorie: 'autre',
          montantCents: 500,
        },
      });
      attendreMessageUtile(reponse);
    });

    it('un nom de concurrent avec accents et emoji est accepté tel quel', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: {
          nom: 'Crêpes de l’Été 🥞🇧🇪',
          lieuId: idLieu,
          typeOffre: 'crepes',
          positionnement: 'standard',
          qualitePercue: 3,
        },
      });
      // Ni 500, ni refus d'un texte qui n'a rien d'invalide (accents, emoji).
      expect(reponse.statusCode).toBeLessThan(300);
      expect(reponse.json<{ nom: string }>().nom).toBe('Crêpes de l’Été 🥞🇧🇪');
    });

    it('une chaîne vide sur un champ obligatoire rend 422, jamais 500', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/fournisseurs',
        payload: {
          nom: '',
          type: 'meunier',
          delaiLivraisonJours: 3,
        },
      });
      expect(reponse.statusCode).toBe(422);
    });

    it('quantiteUniteRef à zéro sur un composant de menu est refusée (positif strict)', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: `/api/menus/${ID_INCONNU}/composition`,
        payload: { produitInclusId: 'x', quantite: 0 },
      });
      expect(reponse.statusCode).toBe(422);
    });

    it('un rayon de recherche de 1 (hors du catalogue 5|10|15|20|40|100) est refusé, jamais accepté silencieusement', async () => {
      const reponse = await app.inject({
        method: 'PATCH',
        url: `/api/evenements-decouverte/lieux/${idLieu}/rayon-recherche`,
        payload: { rayonRechercheEvenementsKm: 1 },
      });
      expect(reponse.statusCode).toBe(422);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     5. MONTANTS — centimes entiers uniquement (CLAUDE.md §3 règle 3)
     ═══════════════════════════════════════════════════════════════════════ */

  describe('montants — centimes entiers uniquement', () => {
    it.each([
      ['/api/depenses', { dateDepense: '2026-08-01', libelle: 'Test', categorie: 'autre' }],
      [
        '/api/economies/renegociations-tarif',
        { conditionnementId: ID_INCONNU, datePrix: '2026-08-01' },
      ],
    ])('%s : montantCents décimal (1.5) est refusé, jamais stocké tronqué', async (url, base_) => {
      const champMontant = url.includes('renegociations') ? 'prixCents' : 'montantCents';
      const reponse = await app.inject({
        method: 'POST',
        url,
        payload: { ...(base_ as object), [champMontant]: 1.5 },
      });
      expect(reponse.statusCode, url).toBe(422);
    });

    it('POST /api/depenses avec montantCents = 1e400 (Infinity après parsing JSON) rend 422, jamais 500', async () => {
      // Corps envoyé en JSON BRUT et non en objet JS : `JSON.stringify({ x: 1e400 })`
      // produirait `"x":null` (Infinity n'est pas représentable en JSON), ce qui
      // ne testerait plus du tout ce cas. Un CLIENT hostile peut parfaitement
      // envoyer le jeton `1e400` tel quel dans le texte de la requête.
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/depenses',
        payload:
          '{"dateDepense":"2026-08-01","libelle":"Test","categorie":"autre","montantCents":1e400}',
        headers: { 'content-type': 'application/json' },
      });
      attendreMessageUtile(reponse);
      expect(reponse.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('un corps JSON portant littéralement NaN est un JSON malformé (400), jamais un 500', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/depenses',
        payload:
          '{"dateDepense":"2026-08-01","libelle":"Test","categorie":"autre","montantCents":NaN}',
        headers: { 'content-type': 'application/json' },
      });
      attendreMessageUtile(reponse);
      expect(reponse.statusCode).toBe(400);
    });

    it('POST /api/concurrents/:id/produits avec prixCents négatif rend 422', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: `/api/concurrents/${ID_INCONNU}/produits`,
        payload: {
          nomProduit: 'Test',
          prixCents: -1,
          dateObservation: '2026-08-01',
        },
      });
      expect(reponse.statusCode).toBe(422);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     6. DATES ABERRANTES
     ═══════════════════════════════════════════════════════════════════════ */

  describe('dates aberrantes', () => {
    /**
     * RÉGRESSION : `POST /api/sessions` avec un `dateSession` au format libre
     * (« pas-une-date ») rendait 500. `creerSession`
     * (`packages/db/src/services/sessions.ts`) numérote la session en
     * extrayant l'année par `dateSession.slice(0, 4)` puis
     * `Number.parseInt(...)` — une chaîne qui n'a pas ce format y produit
     * `NaN`, que `allouerNumero` insère tel quel dans une colonne entière :
     * SQLite refuse de lier `NaN` et l'exception remontait en 500 brut.
     * Corrigé par un contrôle de FORMAT dans la route, avant l'appel au
     * service.
     */
    it('POST /api/sessions avec une date au format libre rend 422, jamais 500', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { lieuId: idLieu, dateSession: 'pas-une-date' },
      });
      expect(reponse.statusCode).toBe(422);
      const corps = JSON.parse(reponse.payload) as ReponseErreur;
      expect(corps.erreur.champs?.['dateSession']).toBeTruthy();
    });

    /**
     * RÉGRESSION — même défaut, même correctif, dans `stock.ts` :
     * `enregistrerReception` (`packages/db/src/services/reception.ts`) fait
     * exactement le même `dateReception.slice(0, 4)` + `Number.parseInt` pour
     * numéroter la réception.
     */
    it('POST /api/receptions avec une date au format libre rend 422, jamais 500', async () => {
      const fournisseurs = await app.inject({ method: 'GET', url: '/api/fournisseurs' });
      const idFournisseur = fournisseurs.json<{ data: ReadonlyArray<{ id: string }> }>().data[0]!
        .id;
      const ingredients = await app.inject({ method: 'GET', url: '/api/ingredients' });
      const idIngredient = ingredients.json<{ data: ReadonlyArray<{ id: string }> }>().data[0]!.id;

      const reponse = await app.inject({
        method: 'POST',
        url: '/api/receptions',
        payload: {
          fournisseurId: idFournisseur,
          dateReception: 'pas-une-date',
          lignes: [{ ingredientId: idIngredient, quantite: 1000, prixLigneCents: 500 }],
        },
      });
      expect(reponse.statusCode).toBe(422);
      const corps = JSON.parse(reponse.payload) as ReponseErreur;
      expect(corps.erreur.champs?.['dateReception']).toBeTruthy();
    });

    /**
     * CONSTAT (hors zone d'écriture) : `schemaCreationDepense.dateDepense`
     * (`packages/core/src/contrats/comptabilite.ts`) est `z.string().min(1)`
     * SANS AUCUNE validation de format — contrairement à `champJourCivil`
     * (utilisé ailleurs), qui vérifie au moins le format par regex. Un format
     * libre (« 01/08/2026 ») est donc accepté et stocké tel quel (201), ce qui
     * ne fait pas planter la route mais fausse silencieusement un document
     * comptable/fiscal. Correctif nécessaire dans
     * `packages/core/src/contrats/comptabilite.ts` (hors zone d'écriture,
     * `tout packages/` est interdit) : CORRIGÉ le 30/07/2026 dans `packages/core` : ces tests, ex-`it.fails`, sont désormais des tests de NON-RÉGRESSION. La validation de calendrier vit dans `estJourCivilValide` (`packages/core/src/horodatage.ts`) et est appliquée par les six copies de `champJourCivil`, plus `dateDepense` qui n'avait AUCUNE validation de format. Ancienne note :
     * dépôt pour un défaut constaté mais non corrigé ici (voir
     * `packages/core/src/invariants.test.ts`,
     * `packages/db/src/audit-afsca.test.ts`). Si ce test se met à ÉCHOUER
     * (donc que le format est désormais validé), reconvertir en `it` normal.
     */
    it('POST /api/depenses avec une date au mauvais format devrait rendre 422', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/depenses',
        payload: {
          dateDepense: '01/08/2026',
          libelle: 'Test',
          categorie: 'autre',
          montantCents: 500,
        },
      });
      expect(reponse.statusCode).toBe(422);
    });

    /**
     * CONSTAT (hors zone d'écriture) : `champJourCivil`
     * (`packages/core/src/contrats/*.ts`, dupliqué dans plusieurs fichiers de
     * contrat) ne vérifie que le FORMAT par regex (`\d{4}-\d{2}-\d{2}`),
     * jamais la validité calendaire. « 2026-02-30 » (30 février, qui n'existe
     * pas) passe donc la validation Zod, aucun crash — juste une donnée
     * silencieusement fausse. Correctif nécessaire dans
     * `packages/core/src/contrats/*.ts` (hors zone d'écriture de cet agent,
     * `tout packages/` est interdit) : CORRIGÉ le 30/07/2026 dans `packages/core` : ces tests, ex-`it.fails`, sont désormais des tests de NON-RÉGRESSION. La validation de calendrier vit dans `estJourCivilValide` (`packages/core/src/horodatage.ts`) et est appliquée par les six copies de `champJourCivil`, plus `dateDepense` qui n'avait AUCUNE validation de format. Ancienne note :
     * dépôt pour un défaut constaté mais non corrigé ici. Si ce test se met à
     * ÉCHOUER (donc que la validation calendaire a été ajoutée), c'est le
     * signal qu'il faut le reconvertir en `it` normal.
     */
    it('POST /api/concurrents/:id/observations avec le 30 février devrait rendre 422', async () => {
      const concurrent = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: {
          nom: 'Test calendrier',
          lieuId: idLieu,
          typeOffre: 'crepes',
          positionnement: 'standard',
          qualitePercue: 3,
        },
      });
      const idConcurrent = concurrent.json<{ id: string }>().id;

      const reponse = await app.inject({
        method: 'POST',
        url: `/api/concurrents/${idConcurrent}/observations`,
        payload: {
          dateObservation: '2026-02-30',
          affluenceEstimee: 'moyenne',
          notes: 'Test',
        },
      });
      expect(reponse.statusCode).toBe(422);
    });

    /**
     * RÉSIDUEL (packages/core) : le correctif ci-dessus sur `dateSession` ne
     * valide que le FORMAT (nécessaire et suffisant pour éliminer le crash) —
     * la validité CALENDAIRE reste non vérifiée, même limite que
     * `champJourCivil` ci-dessus. Une session au 30 février est donc acceptée
     * silencieusement (201), jamais un 500 : la garantie D-035 tient, mais la
     * donnée est fausse. Correctif complet hors de portée sans toucher
     * `packages/core/src/contrats/sessions.ts` (hors zone d'écriture).
     */
    it('POST /api/sessions avec le 30 février devrait rendre 422', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { lieuId: idLieu, dateSession: '2026-02-30' },
      });
      expect(reponse.statusCode).toBe(422);
    });

    it('un jour de référence dans un futur lointain (3000-12-31) ne fait pas planter la lecture', async () => {
      const reponse = await app.inject({
        method: 'GET',
        url: '/api/afsca/nettoyage/taches-en-retard?dateReference=3000-12-31',
      });
      attendreMessageUtile(reponse);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     7. AUCUN CATCH SILENCIEUX — vérifié par lecture ET par exercice du chemin
     ═══════════════════════════════════════════════════════════════════════ */

  describe('aucun catch silencieux (CLAUDE.md §4)', () => {
    /**
     * `evenements-decouverte.ts` est la seule route de la zone qui contient un
     * `try/catch` autour d'un appel réseau (l'API Anthropic). Lu ligne à
     * ligne : le `catch` journalise l'échec ET renvoie un résultat TYPÉ
     * (`disponible: false, raison`), jamais un succès silencieux ni une
     * exception qui remonterait en 500 — voir `rechercherEvenementsParClaude`
     * (lignes ~260-349 du fichier). Impossible à exercer avec un VRAI appel
     * réseau (interdit — « le porteur paie », et cet environnement n'a de
     * toute façon pas de clé configurée) : ce test vérifie donc le chemin
     * réellement emprunté en l'absence de configuration, qui est le même
     * `catch`-free early-return que documente `clientAnthropicPourRecherche`
     * — AUCUN appel réseau n'est tenté, la route rend un 200 avec
     * `disponible: false`, jamais un succès qui masquerait l'absence de
     * configuration ni un 500.
     */
    it('sans ANTHROPIC_API_KEY configurée, la recherche d’événements rend une réponse typée « indisponible », jamais un succès ni un 500', async () => {
      expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();

      const reponse = await app.inject({
        method: 'POST',
        url: '/api/evenements-decouverte/rechercher',
        payload: { lieuId: idLieu },
      });

      attendreMessageUtile(reponse);
      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json<{ disponible: boolean; raison?: string }>();
      expect(corps.disponible).toBe(false);
      expect(corps.raison).toMatch(/pas configurée/i);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     8. TRANSACTION LAISSÉE À MOITIÉ — rien n'est écrit si l'écriture échoue
     ═══════════════════════════════════════════════════════════════════════ */

  describe('transaction atomique — rien ne reste écrit si une ligne est hostile', () => {
    it('une réception à deux lignes dont la seconde est invalide n’écrit RIEN (ni la première ligne, ni le lot)', async () => {
      const fournisseurs = await app.inject({ method: 'GET', url: '/api/fournisseurs' });
      const idFournisseur = fournisseurs.json<{ data: ReadonlyArray<{ id: string }> }>().data[0]!
        .id;
      const ingredients = await app.inject({ method: 'GET', url: '/api/ingredients' });
      const idIngredient = ingredients.json<{ data: ReadonlyArray<{ id: string }> }>().data[0]!.id;

      const avant = base
        .select({ n: schema.lot.id })
        .from(schema.lot)
        .where(eq(schema.lot.ingredientId, idIngredient))
        .all().length;

      const reponse = await app.inject({
        method: 'POST',
        url: '/api/receptions',
        payload: {
          fournisseurId: idFournisseur,
          dateReception: '2026-08-01',
          lignes: [
            { ingredientId: idIngredient, quantite: 1000, prixLigneCents: 500 },
            // Seconde ligne hostile : quantité négative. La validation Zod du
            // TABLEAU ENTIER échoue avant que le service ne soit appelé — la
            // première ligne, pourtant valide isolément, ne doit rien écrire.
            { ingredientId: idIngredient, quantite: -1, prixLigneCents: 500 },
          ],
        },
      });
      expect(reponse.statusCode).toBe(422);

      const apres = base
        .select({ n: schema.lot.id })
        .from(schema.lot)
        .where(eq(schema.lot.ingredientId, idIngredient))
        .all().length;
      expect(apres).toBe(avant);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     9. AUCUN APPEL RÉSEAU RÉEL VERS OPEN-METEO — preuve d'ABSENCE, pas de
     présence (voir le détournement en tête de fichier)
     ═══════════════════════════════════════════════════════════════════════ */

  describe('réseau météo — aucun appel réel à Open-Meteo pendant tout cet audit', () => {
    it('l’espion posé sur fetch n’a enregistré aucune URL visant open-meteo.com', () => {
      // Aucune assertion sur le NOMBRE d'appels (les cas actuels de ce
      // fichier n'atteignent `previsionCourante` sur aucune route — voir la
      // doc de `demarrerServeurMeteoLocal` en tête de fichier) : seule compte
      // la destination de ceux qui seraient partis, aujourd'hui ou après un
      // cas futur touchant `/api/prevision`, `/api/prevision/brief` ou
      // `POST /api/prevision/archiver`.
      for (const appel of espionFetch.mock.calls) {
        const urlAppelee = String(appel[0]);
        expect(urlAppelee).not.toContain('open-meteo.com');
      }
    });
  });
});
