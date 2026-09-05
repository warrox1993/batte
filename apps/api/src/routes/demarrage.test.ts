/**
 * Tests HTTP de `/api/demarrage` — état dérivé du parcours de premier
 * lancement.
 *
 * Fichier DÉDIÉ, avec sa PROPRE instance Fastify minimale (`apps/api/src/
 * serveur.ts` est hors de la zone d'écriture de cette mission — même geste
 * que `objectifs.test.ts` et `concurrents.test.ts`).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { creerBase, migrer, seed, type BaseBatte } from '@batte/db';
import { enregistrerGestionnaireErreurs, envoyerReponse404 } from '../plugins/erreurs.js';
import { routesDemarrage } from './demarrage.js';

describe('routes /api/demarrage', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app, envoyerReponse404);
    await app.register(routesDemarrage(base), { prefix: '/api' });
    await app.ready();
  });

  it('rend un objet unique, les huit signaux à faux sur une base jamais saisie', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/demarrage' });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toEqual({
      aLieu: false,
      aRecette: false,
      aProduitVendable: false,
      aSession: false,
      aIngredient: false,
      aReception: false,
      aRecetteActiveAvecLignes: false,
      aProductionRattacheeSession: false,
    });
  });

  it('reflète un lieu créé directement en base, sans passer par la route d’écriture', async () => {
    // La logique de dérivation elle-même est déjà couverte en profondeur par
    // `packages/db/src/depots/demarrage.test.ts` (huit signaux, un par un,
    // plus les cas d'annulation) : ce test-ci prouve seulement que LA ROUTE
    // relie correctement la requête HTTP au dépôt, pas la logique de dérivation.
    const { lieuMarche } = await import('@batte/db');
    const { nouvelIdentifiant, maintenantUtc } = await import('@batte/core');
    const maintenant = maintenantUtc();
    base
      .insert(lieuMarche)
      .values({
        id: nouvelIdentifiant(),
        nom: '[test] La Batte',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const reponse = await app.inject({ method: 'GET', url: '/api/demarrage' });
    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().aLieu).toBe(true);
    expect(reponse.json().aSession).toBe(false);
  });
});
