/**
 * Tests du DEMARRAGE et de la PARITE developpement / production.
 *
 * Pourquoi ce fichier existe : jusqu'au 28/07/2026, aucun test ne construisait
 * le serveur avec `NODE_ENV=production`. Le mode production etait donc mort au
 * demarrage — `setNotFoundHandler` etait appele deux fois sur la meme instance
 * et Fastify levait avant meme d'ouvrir le port — sans qu'aucune porte de
 * sortie ne le voie (899 tests verts). Voir docs/12-AUDIT-DEMARRAGE.md.
 *
 * Ces tests couvrent ce que `serveur.test.ts` ne peut pas couvrir : le
 * chemin que suit reellement l'operateur qui lance `npm start`, et l'etat
 * d'une base fraiche que personne n'a encore ensemencee.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { config, creerBase, migrer, seed, type BaseBatte } from '@batte/db';
import { construireServeur } from './serveur.js';

const DOSSIER_WEB = resolve(config.racine, 'apps', 'web', 'dist');
const PAGE_APPLICATION = resolve(DOSSIER_WEB, 'index.html');

/**
 * Le mode production sert `apps/web/dist`, qui n'existe qu'apres
 * `npm run build`. Sur un depot fraichement clone, ce bloc est donc SAUTE et
 * vitest l'annonce — plutot que d'echouer sur une absence qui n'est pas un
 * defaut du code.
 */
describe.skipIf(!existsSync(PAGE_APPLICATION))(
  'mode production — Fastify sert le bundle React (necessite `npm run build`)',
  () => {
    let base: BaseBatte;
    let app: FastifyInstance;

    beforeAll(async () => {
      // `construireServeur` lit NODE_ENV a l'appel : on le force ici plutot
      // que de dependre de l'environnement du lanceur de tests.
      vi.stubEnv('NODE_ENV', 'production');
      base = creerBase(':memory:');
      migrer(base);
      seed(base);
      app = construireServeur(base, { journaliser: false });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      vi.unstubAllEnvs();
    });

    it('GET / rend la page de l application, pas un 404 JSON', async () => {
      const reponse = await app.inject({ method: 'GET', url: '/' });

      expect(reponse.statusCode).toBe(200);
      expect(reponse.headers['content-type']).toContain('text/html');
      expect(reponse.body).toContain('<div id="root">');
    });

    it('une route du routeur CLIENT rend aussi la page : c est le repli SPA', async () => {
      // `/sessions` n'existe pas cote serveur : c'est react-router qui la
      // connait. Sans repli, un rechargement de page (F5) sur cet ecran
      // rendrait un 404 — le defaut classique des SPA servies en statique.
      const reponse = await app.inject({ method: 'GET', url: '/sessions' });

      expect(reponse.statusCode).toBe(200);
      expect(reponse.body).toContain('<div id="root">');
    });

    it('GET /api/sante reste servie par l API, pas avalee par le statique', async () => {
      const reponse = await app.inject({ method: 'GET', url: '/api/sante' });

      expect(reponse.statusCode).toBe(200);
      expect(reponse.headers['content-type']).toContain('application/json');
    });

    it('une route /api inconnue rend un 404 JSON, jamais la page HTML', async () => {
      const reponse = await app.inject({ method: 'GET', url: '/api/route-inconnue' });

      expect(reponse.statusCode).toBe(404);
      expect(reponse.headers['content-type']).toContain('application/json');
      expect(reponse.json<{ erreur: { code: string } }>().erreur.code).toBe('route_introuvable');
    });

    it('les actifs construits par Vite sont servis avec leur type MIME', async () => {
      const page = await app.inject({ method: 'GET', url: '/' });
      const chemin = /src="(\/assets\/[^"]+\.js)"/.exec(page.body)?.[1];
      expect(chemin, 'la page ne reference aucun script /assets : build incomplet').toBeDefined();

      const reponse = await app.inject({ method: 'GET', url: chemin as string });
      expect(reponse.statusCode).toBe(200);
      expect(reponse.headers['content-type']).toContain('javascript');
    });

    /**
     * NON-REGRESSION (ex-`it.fails`, corrige par D-052).
     *
     * Le repli SPA attrapait TOUT, y compris un actif manquant : `/assets/x.js`
     * absent rendait `index.html` en 200 `text/html`. Le navigateur refusait
     * alors le module (« Expected a JavaScript module script but the server
     * responded with a MIME type of text/html ») et l'ecran restait blanc,
     * sans rien dans le journal serveur — le pire diagnostic possible. Cas
     * reel : page HTML gardee en cache apres un `npm run build` qui a renomme
     * les actifs.
     */
    it('un actif /assets inexistant rend 404, pas la page HTML', async () => {
      const reponse = await app.inject({ method: 'GET', url: '/assets/inexistant.js' });

      expect(reponse.statusCode).toBe(404);
      // Le TYPE compte autant que le code : c'est lui qui distingue « ce
      // fichier n'existe pas » de « voici une page a la place ».
      expect(reponse.headers['content-type']).toContain('application/json');
    });

    it('une extension de fichier suffit a exclure le repli, hors /assets', async () => {
      // Un `.js`, `.css` ou `.map` demande a la racine attend un FICHIER, pas
      // une page — meme raisonnement, chemin different.
      for (const url of ['/manifest.json', '/vieux-script.js', '/style.css']) {
        const reponse = await app.inject({ method: 'GET', url });
        expect(reponse.statusCode, url).toBe(404);
      }
    });

    it('une route du routeur client rend toujours la page', async () => {
      // Le garde-fou ne doit pas manger le repli SPA lui-meme : sans extension
      // ni prefixe d'actif, c'est une route react-router.
      const reponse = await app.inject({ method: 'GET', url: '/sessions' });
      expect(reponse.statusCode).toBe(200);
      expect(reponse.headers['content-type']).toContain('text/html');
    });
  },
);

describe('premier demarrage — base migree mais jamais ensemencee', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeAll(async () => {
    // Exactement ce que fait `creerContexte()` au premier lancement :
    // `creerBase` + `migrer`, et RIEN d'autre. `seed` n'est appele par aucun
    // chemin de demarrage — c'est un geste manuel (`npm run db:seed`).
    base = creerBase(':memory:');
    migrer(base);
    app = construireServeur(base, { journaliser: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('le catalogue de parametres est vide : l application n est pas utilisable', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/sante' });
    const corps = reponse.json<{ parametresManquants: string[] }>();

    expect(reponse.statusCode).toBe(200);
    expect(corps.parametresManquants.length).toBeGreaterThan(0);
  });

  /**
   * NON-REGRESSION (ex-`it.fails`, corrige par D-052).
   *
   * `/api/sante` renvoyait `statut: 'ok'` EN DUR, quel que soit le nombre de
   * parametres manquants. Le seul point de controle du premier lancement
   * (docs/06) declarait donc « ok » une base sur laquelle quatre ecrans
   * rendaient un 500. Un indicateur de sante qui ne peut pas virer au rouge
   * n'est pas un indicateur.
   */
  it('le statut vire a « incomplet » quand des parametres manquent', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/sante' });
    const corps = reponse.json<{ statut: string; action: string | null }>();

    expect(corps.statut).toBe('incomplet');

    // Et surtout : la sonde dit le GESTE a faire, pas seulement le symptome.
    // Sans cette phrase, l'operateur constate que quelque chose manque sans
    // savoir quoi lancer.
    expect(corps.action).not.toBeNull();
    expect(corps.action).toContain('db:seed');
  });

  it('les ecrans qui dependent d un parametre rendent un 500 tant qu on n a pas ensemence', async () => {
    // Fige le cout reel du premier demarrage : sans `npm run db:seed`, ces
    // ecrans sont en erreur. `ErreurParametreManquant` choisit 500 a dessein
    // (CLAUDE.md §7 : pas de valeur de repli silencieuse) — le defaut n'est
    // pas le code HTTP, c'est que rien ne dit a l'operateur quoi faire.
    for (const url of ['/api/seuils', '/api/echeances', '/api/synthese-exercice', '/api/ia/etat']) {
      const reponse = await app.inject({ method: 'GET', url });
      expect(reponse.statusCode, url).toBe(500);
      expect(reponse.json<{ erreur: { code: string } }>().erreur.code, url).toBe(
        'parametre_manquant',
      );
    }
  });
});
