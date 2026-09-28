/**
 * Limitation de debit des routes couteuses (D-099, CodeQL
 * js/missing-rate-limiting du 28/09/2026).
 *
 * Monte le serveur COMPLET : c'est l'ordre d'inscription dans `serveur.ts`
 * (greffon AVANT les routes, sur l'instance racine) qui decide si la limite
 * s'applique. Un test qui monterait une route seule ne le verrait pas.
 *
 * Aucune generation reelle : la commande demandee n'existe pas, la route
 * repond 404 avant tout rendu, et c'est bien la requete (pas le rendu) que la
 * limite compte.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { creerBase, migrer, seed } from '@batte/db';
import { construireServeur } from '../serveur.js';
import {
  CODE_TROP_DE_DEMANDES,
  LIMITE_APPEL_EXTERNE,
  LIMITE_GENERATION_DOCUMENT,
} from './limitation-debit.js';

type ReponseErreur = { erreur: { code: string; message: string } };

/** Les routes qui DOIVENT etre limitees, et a quel niveau. */
const ROUTES_LIMITEES: Readonly<Record<string, unknown>> = {
  'GET /api/commandes/:id/pdf': LIMITE_GENERATION_DOCUMENT,
  'POST /api/commandes/:id/envoyer': LIMITE_APPEL_EXTERNE,
  'GET /api/prevision/brief': LIMITE_GENERATION_DOCUMENT,
  'POST /api/prevision/commenter': LIMITE_APPEL_EXTERNE,
  'POST /api/prevision/brief/commenter': LIMITE_APPEL_EXTERNE,
  'POST /api/ia/analyse-ecart/:id': LIMITE_APPEL_EXTERNE,
  'POST /api/evenements-decouverte/rechercher': LIMITE_APPEL_EXTERNE,
  'GET /api/documents/fiche-technique/:id': LIMITE_GENERATION_DOCUMENT,
  'GET /api/documents/affichette-allergenes': LIMITE_GENERATION_DOCUMENT,
  'GET /api/documents/etiquette-bac/:id': LIMITE_GENERATION_DOCUMENT,
  'GET /api/documents/rapport-session/:id': LIMITE_GENERATION_DOCUMENT,
  'GET /api/documents/registre-afsca': LIMITE_GENERATION_DOCUMENT,
  'GET /api/documents/fiche-rappel/:lot': LIMITE_GENERATION_DOCUMENT,
  'GET /api/exports/stock': LIMITE_GENERATION_DOCUMENT,
  'GET /api/exports/journal-recettes': LIMITE_GENERATION_DOCUMENT,
  'GET /api/exports/journal-achats': LIMITE_GENERATION_DOCUMENT,
  'GET /api/exports/mouvements': LIMITE_GENERATION_DOCUMENT,
};

describe('limitation de débit des routes coûteuses', () => {
  let app: FastifyInstance;
  let routesAvecLimite: Map<string, unknown>;

  beforeEach(async () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);
    app = construireServeur(base, { journaliser: false });
    routesAvecLimite = new Map();
    app.addHook('onRoute', (route) => {
      const limite = (route.config as { rateLimit?: unknown } | undefined)?.rateLimit;
      if (limite === undefined) return;
      const methodes = Array.isArray(route.method) ? route.method : [route.method];
      // Fastify ajoute d'office une route HEAD a chaque GET, avec la meme
      // configuration : elle est donc limitee aussi, sans qu'on la declare.
      for (const methode of methodes) {
        if (methode !== 'HEAD') routesAvecLimite.set(`${methode} ${route.url}`, limite);
      }
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('limite exactement les routes coûteuses attendues, au bon niveau', () => {
    // Liste fermee dans les deux sens : une route couteuse oubliee ou une route
    // ordinaire limitee par erreur font toutes deux echouer ce test.
    expect(Object.fromEntries(routesAvecLimite)).toEqual(ROUTES_LIMITEES);
  });

  it('répond 429 en français au-delà de la limite, puis rien ne passe', async () => {
    const url = '/api/commandes/commande-inexistante/pdf';
    for (let i = 0; i < LIMITE_GENERATION_DOCUMENT.max; i++) {
      const reponse = await app.inject({ method: 'GET', url });
      expect(reponse.statusCode, `demande ${String(i + 1)}`).toBe(404);
    }

    const refusee = await app.inject({ method: 'GET', url });
    expect(refusee.statusCode).toBe(429);
    expect(refusee.headers['retry-after']).toBeDefined();
    const corps = refusee.json<ReponseErreur>();
    expect(corps.erreur.code).toBe(CODE_TROP_DE_DEMANDES);
    expect(corps.erreur.message).toMatch(/patientez une minute/);
  });

  it('ne limite pas les routes de lecture ordinaires', async () => {
    for (let i = 0; i < 100; i++) {
      const reponse = await app.inject({ method: 'GET', url: '/api/sante' });
      expect(reponse.statusCode).toBe(200);
    }
  });
});
