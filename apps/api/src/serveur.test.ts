import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CATALOGUE_PARAMETRES } from '@batte/core';
import { creerBase, migrer, seed, sqliteBrut, type BaseBatte } from '@batte/db';
import { construireServeur } from './serveur.js';

type ReponseSante = { statut: string; base: string; parametresManquants: string[] };
type ReponseListeParametres = { data: unknown[]; meta: { total: number } };
type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

describe('construireServeur', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeAll(async () => {
    // Base en memoire, jamais le fichier reel du poste de travail : ces tests
    // ne doivent produire ni fichier de base, ni sauvegarde, ni port ouvert.
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/sante repond 200 et decrit la base ouverte', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/sante' });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ReponseSante>();
    expect(corps.statut).toBe('ok');
    expect(corps.base).toBe(sqliteBrut(base).name);
    // Le seed a insere les 10 parametres du catalogue : aucun ne manque.
    expect(corps.parametresManquants).toEqual([]);
  });

  it('GET /api/parametres renvoie tout le catalogue', async () => {
    // Compare au CATALOGUE et non a un nombre en dur : ce test cassait a chaque
    // ajout de parametre alors que le code etait juste. Le catalogue est la
    // source de verite (D-013), les tests doivent en deriver aussi.
    const reponse = await app.inject({ method: 'GET', url: '/api/parametres' });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ReponseListeParametres>();
    expect(corps.meta.total).toBe(CATALOGUE_PARAMETRES.length);
    expect(corps.data).toHaveLength(CATALOGUE_PARAMETRES.length);
  });

  it('une route inconnue renvoie 404 a la forme { erreur }', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/route-qui-nexiste-pas' });

    expect(reponse.statusCode).toBe(404);
    expect(reponse.json<ReponseErreur>()).toEqual({
      erreur: {
        code: 'route_introuvable',
        message: 'Route inconnue : GET /api/route-qui-nexiste-pas.',
      },
    });
  });

  it('un PATCH avec un corps invalide renvoie 422 avec les champs en erreur', async () => {
    const reponse = await app.inject({
      method: 'PATCH',
      url: '/api/parametres/inexistant',
      payload: JSON.stringify({ valeur: 1234 }),
      headers: { 'content-type': 'application/json' },
    });

    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('validation');
    expect(corps.erreur.champs).toHaveProperty('valeur');
  });
});
