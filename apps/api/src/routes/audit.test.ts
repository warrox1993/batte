import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  changerActiviteFournisseur,
  corrigerParametre,
  creerBase,
  listerFournisseurs,
  listerParametres,
  migrer,
  seed,
  seedDemonstration,
  type BaseBatte,
} from '@batte/db';
import type { JournalAudit } from '@batte/core';
import { enregistrerGestionnaireErreurs } from '../plugins/erreurs.js';
import { routesAudit } from './audit.js';

/**
 * Lecture du journal d'audit.
 *
 * Le serveur est monte ICI plutot que via `construireServeur` : la route n'est
 * pas encore inscrite dans `serveur.ts` (fichier reserve a un autre chantier,
 * voir le rapport de livraison). Le montage manuel reproduit exactement ce que
 * fait `construireServeur` — meme gestionnaire d'erreurs, meme prefixe `/api` —
 * de sorte que les statuts et la forme des corps d'erreur sont ceux du vrai
 * serveur, pas ceux d'un bac a sable.
 */
type ReponseErreur = { erreur: { code: string; message: string; champs?: Record<string, string> } };

describe('route /api/audit', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    // Deux gestes traces, dans deux tables differentes : c'est ce qui rend le
    // filtre par table verifiable autrement qu'a vide.
    const parametre = listerParametres(base)[0];
    if (parametre === undefined) throw new Error('Aucun paramètre semé.');
    corrigerParametre(base, parametre.id, parametre.valeur);

    // `type !== 'systeme'` : depuis l'audit du 29/07/2026 (chaîne d'achat),
    // le fournisseur système (« Inventaire d'ouverture ») refuse toute
    // modification, y compris sa désactivation — et il est alphabétiquement
    // le premier actif de la graine (« I » < « [ »), donc `.find((f) => f.actif)`
    // le choisissait sans le vouloir. Ce test veut prouver que le journal
    // d'audit trace UN fournisseur modifié, pas tester le fournisseur système
    // lui-même (voir `packages/db/src/depots/referentiel.test.ts` pour cette
    // garantie-là).
    const fournisseurCible = listerFournisseurs(base).find((f) => f.actif && f.type !== 'systeme');
    if (fournisseurCible === undefined) throw new Error('Aucun fournisseur commercial actif semé.');
    changerActiviteFournisseur(base, fournisseurCible.id, false, 'test');

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(routesAudit(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rend les entrées, de la plus récente à la plus ancienne', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/audit' });

    expect(reponse.statusCode).toBe(200);
    const journal = reponse.json<JournalAudit>();
    expect(journal.meta.total).toBeGreaterThan(0);

    // Ordre décroissant strict sur la date : un journal dont l'ordre varie
    // d'une lecture à l'autre est inexploitable en contrôle.
    const dates = journal.data.map((l) => l.dateAction);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('annonce les tables réellement tracées, jamais une liste écrite à la main', async () => {
    const journal = (await app.inject({ method: 'GET', url: '/api/audit' })).json<JournalAudit>();

    expect(journal.meta.tables).toContain('parametre');
    expect(journal.meta.tables).toContain('fournisseur');
    // Dérivée de la base : chaque table annoncée porte au moins une entrée.
    for (const table of journal.meta.tables) {
      expect(journal.data.some((l) => l.table === table)).toBe(true);
    }
  });

  it('filtre par table, et le filtre restreint réellement', async () => {
    const tout = (await app.inject({ method: 'GET', url: '/api/audit' })).json<JournalAudit>();
    const fournisseurs = (
      await app.inject({ method: 'GET', url: '/api/audit?table=fournisseur' })
    ).json<JournalAudit>();

    expect(fournisseurs.data.every((l) => l.table === 'fournisseur')).toBe(true);
    expect(fournisseurs.meta.total).toBeLessThan(tout.meta.total);
    expect(fournisseurs.meta.total).toBeGreaterThan(0);
  });

  it('filtre par action', async () => {
    const journal = (
      await app.inject({ method: 'GET', url: '/api/audit?action=modification' })
    ).json<JournalAudit>();

    expect(journal.data.every((l) => l.action === 'modification')).toBe(true);
  });

  it('plafonne la liste SANS mentir sur le total', async () => {
    // Une troncature invisible sur un journal d'audit est une preuve d'absence
    // qui ne prouve rien : `total` doit rester le compte réel.
    const journal = (
      await app.inject({ method: 'GET', url: '/api/audit?limite=1' })
    ).json<JournalAudit>();

    expect(journal.data).toHaveLength(1);
    expect(journal.meta.limite).toBe(1);
    expect(journal.meta.total).toBeGreaterThan(1);
    expect(journal.meta.tronque).toBe(true);
  });

  it('porte l’instantané avant ET après sur une modification', async () => {
    const journal = (
      await app.inject({ method: 'GET', url: '/api/audit?table=fournisseur' })
    ).json<JournalAudit>();

    const entree = journal.data[0];
    expect(entree).toBeDefined();
    expect(entree!.valeurAvant).not.toBeNull();
    expect(entree!.valeurApres).not.toBeNull();
    // La question à laquelle le journal doit répondre : qu'est-ce qui a bougé ?
    expect(entree!.valeurAvant?.['actif']).toBe(true);
    expect(entree!.valeurApres?.['actif']).toBe(false);
    expect(entree!.parQui).toBe('test');
  });

  it('refuse une date mal formée en 422, avec le champ désigné', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/audit?depuis=le-mois-dernier' });

    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('date_invalide');
    expect(corps.erreur.champs?.['depuis']).toBeDefined();
  });

  it('refuse une période à l’envers plutôt que de rendre une liste vide', async () => {
    // Rendre zéro ligne laisserait croire qu'il ne s'est rien passé — le pire
    // mensonge possible pour un journal d'audit.
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/audit?depuis=2026-12-31&jusqua=2026-01-01',
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('periode_invalide');
  });

  it('refuse une action et une limite hors bornes', async () => {
    const action = await app.inject({ method: 'GET', url: '/api/audit?action=suppression' });
    expect(action.statusCode).toBe(422);
    expect(action.json<ReponseErreur>().erreur.code).toBe('action_invalide');

    const limite = await app.inject({ method: 'GET', url: '/api/audit?limite=100000' });
    expect(limite.statusCode).toBe(422);
    expect(limite.json<ReponseErreur>().erreur.code).toBe('limite_invalide');
  });

  it('n’expose aucun verbe d’écriture : le journal ne se remplit pas par HTTP', async () => {
    // Un journal alimentable de l'extérieur ne prouve plus rien.
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const reponse = await app.inject({ method, url: '/api/audit', payload: {} });
      expect(reponse.statusCode, `${method} /api/audit devrait être refusé`).toBe(404);
    }
  });
});
