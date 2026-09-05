/**
 * Le serveur DEMARRE dans ses deux modes, et sert la bonne chose dans chacun.
 *
 * Pourquoi ce fichier existe. `enregistrerGestionnaireErreurs` posait un
 * gestionnaire de route inconnue, et `serveur.ts` en posait un SECOND en
 * production pour le repli SPA. Or Fastify n'en accepte qu'un seul par prefixe
 * et **leve** au second appel. Consequence : `construireServeur` echouait avec
 * `Not found handler already set` des que `NODE_ENV=production`, donc
 * **le mode production n'a jamais pu demarrer** — alors que D-001 en fait la
 * promesse centrale du produit (« un seul processus, un seul port »).
 *
 * Aucun test ne le voyait, et c'est le point de methode a retenir : tous les
 * tests existants construisent le serveur sans toucher a `NODE_ENV`, donc dans
 * la seule branche qui fonctionnait. Un mode qui n'est jamais exerce n'est pas
 * teste, il est **suppose**.
 *
 * Trouve en cherchant tout autre chose : le porteur du projet a ouvert la
 * racine de l'API dans son navigateur et signale un 404.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '@batte/db';
import { migrer } from '@batte/db';
import { seed } from '@batte/db';
import { construireServeur } from './serveur.js';

const MODE_INITIAL = process.env['NODE_ENV'];

afterEach(() => {
  // `NODE_ENV` est un etat GLOBAL du processus : le laisser modifie ferait
  // basculer les fichiers de test suivants dans l'autre mode, avec des echecs
  // dont la cause serait introuvable.
  if (MODE_INITIAL === undefined) delete process.env['NODE_ENV'];
  else process.env['NODE_ENV'] = MODE_INITIAL;
});

function baseDeTest(): BaseBatte {
  const base = creerBase(':memory:');
  migrer(base);
  seed(base);
  return base;
}

describe('serveur — mode developpement', () => {
  it('se construit sans lever', () => {
    process.env['NODE_ENV'] = 'development';
    expect(() => construireServeur(baseDeTest(), { journaliser: false })).not.toThrow();
  });

  it("redirige vers l'interface Vite au lieu d'un 404 technique", async () => {
    process.env['NODE_ENV'] = 'development';
    const app = construireServeur(baseDeTest(), { journaliser: false });
    await app.ready();

    for (const url of ['/', '/stock', '/registre-afsca']) {
      const reponse = await app.inject({ method: 'GET', url });
      expect(reponse.statusCode, url).toBe(302);
      // Le chemin demande est CONSERVE : rediriger vers la racine ferait
      // perdre l'ecran que la personne cherchait.
      expect(reponse.headers['location'], url).toBe(`http://localhost:5173${url}`);
    }

    await app.close();
  });

  it('redirige vers `localhost` et jamais vers `127.0.0.1`', async () => {
    // Sous Windows, Vite ecoute en IPv6 : une redirection vers `127.0.0.1`
    // aboutirait a une connexion refusee. Piege deja rencontre sur ce poste.
    process.env['NODE_ENV'] = 'development';
    const app = construireServeur(baseDeTest(), { journaliser: false });
    await app.ready();

    const reponse = await app.inject({ method: 'GET', url: '/' });
    expect(String(reponse.headers['location'])).toContain('localhost');
    expect(String(reponse.headers['location'])).not.toContain('127.0.0.1');

    await app.close();
  });
});

describe('serveur — mode production', () => {
  it('SE CONSTRUIT : c est la regression qui rendait le mode inutilisable', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => construireServeur(baseDeTest(), { journaliser: false })).not.toThrow();
  });

  it('ne redirige PAS : il sert l application lui-meme', async () => {
    process.env['NODE_ENV'] = 'production';
    const app = construireServeur(baseDeTest(), { journaliser: false });
    await app.ready();

    const reponse = await app.inject({ method: 'GET', url: '/' });
    // 200 et non 302 : en production, il n'y a pas d'autre serveur ou envoyer
    // la personne — c'est tout l'interet de D-001.
    expect(reponse.statusCode).toBe(200);
    expect(reponse.headers['location']).toBeUndefined();

    await app.close();
  });
});

describe('serveur — invariant commun aux deux modes', () => {
  it('une route /api inconnue reste un 404 JSON, jamais une page ni une redirection', async () => {
    for (const mode of ['development', 'production']) {
      process.env['NODE_ENV'] = mode;
      const app = construireServeur(baseDeTest(), { journaliser: false });
      await app.ready();

      const reponse = await app.inject({ method: 'GET', url: '/api/route-inconnue' });
      expect(reponse.statusCode, mode).toBe(404);

      // Renvoyer l'HTML de l'application sur un appel d'API serait le pire des
      // deux mondes : le client recevrait 200 + du HTML la ou il attend du
      // JSON, et le defaut se manifesterait a l'analyse syntaxique, loin de sa
      // cause.
      const corps = JSON.parse(reponse.payload) as { erreur?: { code?: string } };
      expect(corps.erreur?.code, mode).toBe('route_introuvable');

      await app.close();
    }
  });

  it('les routes d API repondent identiquement dans les deux modes', async () => {
    const statuts: Record<string, number> = {};
    for (const mode of ['development', 'production']) {
      process.env['NODE_ENV'] = mode;
      const app = construireServeur(baseDeTest(), { journaliser: false });
      await app.ready();

      const reponse = await app.inject({ method: 'GET', url: '/api/sante' });
      statuts[mode] = reponse.statusCode;

      await app.close();
    }
    expect(statuts['development']).toBe(200);
    expect(statuts['production']).toBe(statuts['development']);
  });
});
