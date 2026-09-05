/**
 * Tests HTTP de la route `GET /api/afsca/temperatures/sessions-sans-releve`
 * (audit AFSCA du 30/07/2026, mission dédiée — point « les trous se voient »).
 *
 * Les autres routes `/api/afsca/*` sont déjà largement couvertes par
 * `apps/api/src/routes/audit-robustesse.test.ts` (jamais un 500 sur une
 * entrée dégénérée) — fichier partagé entre plusieurs modules, hors de la
 * zone d'écriture de cet audit. Ce fichier DÉDIÉ ne teste donc que la route
 * NOUVELLE de cette mission, avec sa propre instance Fastify minimale, même
 * geste que `routes/equipements.test.ts` et `routes/menus.test.ts`.
 *
 * La session de la fixture est clôturée directement via `@batte/db`
 * (`creerSession`/`cloturerSession`), pas via `POST /api/sessions` : seule
 * `routesAfsca` est montée ici, exactement comme `routes/equipements.test.ts`
 * insère ses fixtures directement plutôt que de monter tout le serveur.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  creerBase,
  migrer,
  seed,
  seedDemonstration,
  cloturerSession,
  creerSession,
  lieuMarche,
  produitVente,
  type BaseBatte,
} from '@batte/db';
import { enregistrerGestionnaireErreurs, envoyerReponse404 } from '../plugins/erreurs.js';
import { routesAfsca } from './afsca.js';

describe('GET /api/afsca/temperatures/sessions-sans-releve', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idLieu: string;
  let idCrepe: string;

  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
    idCrepe = base.select({ id: produitVente.id }).from(produitVente).get()!.id;

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app, envoyerReponse404);
    await app.register(routesAfsca(base), { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  /** Clôture une session minimale un jour donné, sans aucun relevé de température. */
  function cloturerSessionSansReleve(dateSession: string): string {
    const session = creerSession(base, { lieuId: idLieu, dateSession });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 3000,
      caCarteCents: 0,
      crepesProduites: 10,
      crepesInvendues: 0,
      crepesCassees: 0,
    });
    return session.id;
  }

  it('signale, sur HTTP, une session clôturée sans aucun relevé rattaché', async () => {
    const sessionId = cloturerSessionSansReleve('2026-07-27');

    const reponse = await app.inject({
      method: 'GET',
      url: '/api/afsca/temperatures/sessions-sans-releve?debut=2026-07-01&fin=2026-07-31',
    });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json() as {
      data: { sessionId: string; numero: string; lieuNom: string }[];
      meta: { total: number };
    };
    const ligne = corps.data.find((l) => l.sessionId === sessionId);
    expect(
      ligne,
      'la session clôturée sans relevé doit apparaître dans le trou signalé',
    ).toBeDefined();
    expect(ligne!.lieuNom).not.toBe('');
    expect(corps.meta.total).toBe(corps.data.length);
  });

  it('rend un tableau vide, jamais une erreur, quand aucune session n’a été clôturée sur la période', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/afsca/temperatures/sessions-sans-releve?debut=2019-01-01&fin=2019-01-31',
    });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json() as { data: unknown[]; meta: { total: number } };
    expect(corps.data).toEqual([]);
    expect(corps.meta.total).toBe(0);
  });

  it('422, jamais 500, quand la période est incomplète (paramètre manquant)', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/afsca/temperatures/sessions-sans-releve?debut=2026-07-01',
    });

    expect(reponse.statusCode).toBeLessThan(500);
    expect(reponse.statusCode).not.toBe(200);
  });

  it('ne plante jamais sur une période inversée (fin avant début) : rend simplement un tableau vide', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/afsca/temperatures/sessions-sans-releve?debut=2026-07-31&fin=2026-07-01',
    });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json() as { data: unknown[] };
    expect(corps.data).toEqual([]);
  });

  it('ne plante jamais sur une date absurde, loin dans le futur', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/afsca/temperatures/sessions-sans-releve?debut=9999-01-01&fin=9999-12-31',
    });

    expect(reponse.statusCode).toBe(200);
    expect((reponse.json() as { data: unknown[] }).data).toEqual([]);
  });
});
