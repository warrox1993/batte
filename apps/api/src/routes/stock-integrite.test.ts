import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  creerBase,
  migrer,
  seed,
  seedDemonstration,
  seedDemonstrationActivite,
  type BaseBatte,
} from '@batte/db';
import type { DiagnosticIntegriteStockContrat } from '@batte/core';
import { enregistrerGestionnaireErreurs } from '../plugins/erreurs.js';
import { routesStock } from './stock.js';

/**
 * Route `GET /api/stock/integrite` (dette du 29/07/2026 : le controle
 * `verifierInvariantLots` n'avait aucun appelant de production).
 *
 * Le serveur est monte ICI, comme `routes/audit.test.ts` et
 * `routes/comptabilite.test.ts`, plutot que via `construireServeur` : meme
 * gestionnaire d'erreurs, meme prefixe `/api`, sans dependre du reste du
 * cablage de `serveur.ts`.
 */
describe('route /api/stock/integrite', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    // `seedDemonstration` ne seme que le REFERENTIEL. Les receptions — donc les
    // lots — viennent de `seedDemonstrationActivite`. Sans elle, le diagnostic
    // porterait sur zero lot, ce que le test ci-dessous refuse a juste titre :
    // un « 0 lot verifie » dirait que le controle ne regarde rien.
    seedDemonstrationActivite(base);

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(routesStock(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('annonce un verdict explicite meme quand tout est coherent', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/stock/integrite' });

    expect(reponse.statusCode).toBe(200);
    const diagnostic = reponse.json<DiagnosticIntegriteStockContrat>();
    // Le jeu de demonstration seme des receptions : un « 0 lot verifie »
    // signalerait que le diagnostic ne regarde rien, pas qu'il n'y a rien a
    // signaler.
    expect(diagnostic.nbLotsVerifies).toBeGreaterThan(0);
    expect(diagnostic.coherent).toBe(true);
    expect(diagnostic.lotsFautifs).toEqual([]);
  });
});
