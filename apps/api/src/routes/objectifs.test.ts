/**
 * Tests HTTP de `/api/objectifs` — objectifs (budget), succès et niveaux
 * (fiche `docs/demandes/18-SUCCES-NIVEAUX-ET-OBJECTIFS.md`).
 *
 * Fichier DÉDIÉ plutôt qu'ajouté à `integration.test.ts` : ce dernier est
 * hors de la zone d'écriture de cet agent. `routesObjectifs` est déjà montée
 * par le vrai serveur (`apps/api/src/serveur.ts`) ; ce fichier construit sa
 * PROPRE instance Fastify minimale pour tester le plugin en isolation, avec le
 * même gestionnaire d'erreurs que le vrai serveur — même geste que
 * `apps/api/src/routes/concurrents.test.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, migrer, schema, seed, type BaseBatte } from '@batte/db';
import { enregistrerGestionnaireErreurs, envoyerReponse404 } from '../plugins/erreurs.js';
import { routesObjectifs } from './objectifs.js';

describe('routes /api/objectifs', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const maintenant = maintenantUtc();
    const lieuId = nouvelIdentifiant();
    base
      .insert(schema.lieuMarche)
      .values({
        id: lieuId,
        nom: 'La Batte',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    base
      .insert(schema.sessionMarche)
      .values({
        id: nouvelIdentifiant(),
        numero: 'SM-TEST-1',
        lieuId,
        dateSession: '2026-01-04',
        statut: 'cloturee',
        margeNetteCents: 30_000,
        caTotalCents: 60_000,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app, envoyerReponse404);
    await app.register(routesObjectifs(base), { prefix: '/api' });
    await app.ready();
  });

  it('GET /api/objectifs/succes rend les cinq axes, les deux niveaux et les seuils légaux', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/objectifs/succes' });
    expect(reponse.statusCode).toBe(200);

    const corps = reponse.json();
    expect(corps.series).toHaveLength(5);
    expect(corps.series.map((s: { cle: string }) => s.cle).sort()).toEqual([
      'afsca',
      'cout_revient',
      'gaspillage',
      'marge',
      'prevision',
    ]);
    // Jamais nu (fiche §2.1) : le niveau de CA porte TOUJOURS le contexte des seuils légaux.
    expect(corps.niveauChiffreAffaires.niveau).toBeDefined();
    expect(corps.niveauChiffreAffaires.contexteSeuilsLegaux.data.length).toBeGreaterThan(0);
    expect(corps.niveauAnciennete.valeurActuelle).toBe(1);
    expect(Array.isArray(corps.anticipationSeuils)).toBe(true);
  });

  it('GET /api/objectifs/succes?date=... accepte un jour de référence explicite', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/objectifs/succes?date=2026-12-31',
    });
    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().niveauChiffreAffaires.contexteSeuilsLegaux.meta.annee).toBe(2026);
  });

  it('rejette un jour de référence mal formé avec un 422 explicite', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/objectifs/succes?date=31-12-2026',
    });
    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json();
    expect(corps.erreur.code).toBe('date_invalide');
  });
});

describe('routes /api/objectifs — objectifs (budget, fiche §4)', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const maintenant = maintenantUtc();
    const lieuId = nouvelIdentifiant();
    base
      .insert(schema.lieuMarche)
      .values({
        id: lieuId,
        nom: 'La Batte',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    // Une session clôturée dans la période testée, pour que le réalisé de
    // l'objectif ne soit jamais `null` par accident.
    base
      .insert(schema.sessionMarche)
      .values({
        id: nouvelIdentifiant(),
        numero: 'SM-TEST-OBJECTIF',
        lieuId,
        dateSession: '2026-01-10',
        statut: 'cloturee',
        margeNetteCents: 25_000,
        caTotalCents: 70_000,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app, envoyerReponse404);
    await app.register(routesObjectifs(base), { prefix: '/api' });
    await app.ready();
  });

  it('GET /api/objectifs rend une liste vide au départ', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/objectifs' });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json();
    expect(corps.data).toEqual([]);
    expect(corps.meta.total).toBe(0);
  });

  it('POST /api/objectifs crée un objectif et rend son évaluation (201)', async () => {
    const creation = await app.inject({
      method: 'POST',
      url: '/api/objectifs',
      payload: {
        grandeur: 'chiffre_affaires',
        dateDebut: '2026-01-01',
        dateFin: '2026-01-31',
        valeurCible: 50_000,
      },
    });
    expect(creation.statusCode).toBe(201);
    const cree = creation.json();
    expect(cree.grandeur).toBe('chiffre_affaires');
    expect(cree.valeurCible).toBe(50_000);
    expect(cree.evaluation.realise).toBe(70_000);
    expect(cree.evaluation.statut).toBe('atteint');
    expect(cree.estAnnulation).toBe(false);
    expect(cree.estAnnule).toBe(false);

    const liste = await app.inject({ method: 'GET', url: '/api/objectifs' });
    expect(liste.json().meta.total).toBe(1);
  });

  it('POST /api/objectifs rejette une saisie invalide avec un 422 explicite (date de fin avant le début)', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/objectifs',
      payload: {
        grandeur: 'nombre_sessions',
        dateDebut: '2026-01-31',
        dateFin: '2026-01-01',
        valeurCible: 5,
      },
    });
    expect(reponse.statusCode).toBe(422);
  });

  it('POST /api/objectifs rejette une cible non strictement positive', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/objectifs',
      payload: {
        grandeur: 'nombre_sessions',
        dateDebut: '2026-01-01',
        dateFin: '2026-01-31',
        valeurCible: 0,
      },
    });
    expect(reponse.statusCode).toBe(422);
  });

  it('POST /api/objectifs/:id/annuler crée une contre-écriture, rien ne disparaît (CLAUDE.md §3 règle 7)', async () => {
    const creation = await app.inject({
      method: 'POST',
      url: '/api/objectifs',
      payload: {
        grandeur: 'nombre_sessions',
        dateDebut: '2026-01-01',
        dateFin: '2026-01-31',
        valeurCible: 3,
      },
    });
    const { id } = creation.json();

    const annulation = await app.inject({
      method: 'POST',
      url: `/api/objectifs/${id}/annuler`,
      payload: { motif: 'Objectif trop ambitieux, revu à la baisse' },
    });
    expect(annulation.statusCode).toBe(200);
    const contreEcriture = annulation.json();
    expect(contreEcriture.estAnnulation).toBe(true);
    expect(contreEcriture.objectifAnnuleId).toBe(id);

    const liste = await app.inject({ method: 'GET', url: '/api/objectifs' });
    const lignes = liste.json().data as Array<{ id: string; estAnnule: boolean }>;
    expect(lignes).toHaveLength(2);
    expect(lignes.find((l) => l.id === id)?.estAnnule).toBe(true);
  });

  it('POST /api/objectifs/:id/annuler exige un motif non vide (422)', async () => {
    const creation = await app.inject({
      method: 'POST',
      url: '/api/objectifs',
      payload: {
        grandeur: 'nombre_sessions',
        dateDebut: '2026-01-01',
        dateFin: '2026-01-31',
        valeurCible: 3,
      },
    });
    const { id } = creation.json();

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/objectifs/${id}/annuler`,
      payload: { motif: '' },
    });
    expect(reponse.statusCode).toBe(422);
  });

  it('POST /api/objectifs/:id/annuler sur un identifiant inconnu rend 404', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/objectifs/${nouvelIdentifiant()}/annuler`,
      payload: { motif: 'Peu importe' },
    });
    expect(reponse.statusCode).toBe(404);
  });
});
