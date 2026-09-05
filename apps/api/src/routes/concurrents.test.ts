/**
 * Tests HTTP des routes `/api/concurrents` (fiche
 * `docs/demandes/08-FICHES-CONCURRENTS.md`).
 *
 * Fichier DÉDIÉ plutôt qu'ajouté à `integration.test.ts` : ce dernier est
 * verrouillé pour cet agent (D-045, balayage anti-fuite dérivé de la table de
 * routage réelle) — l'orchestrateur y ajoutera les routes listées dans le
 * rapport de livraison. Ce fichier construit donc sa PROPRE instance Fastify
 * minimale, ne montant que `routesConcurrents` (même geste que
 * `previsions.test.ts`, en plus restreint), avec le MÊME gestionnaire
 * d'erreurs que le vrai serveur (`plugins/erreurs.ts`) pour que les erreurs
 * métier ressortent avec le bon statut et la bonne forme JSON.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, migrer, lieuMarche, produitVente, type BaseBatte } from '@batte/db';
import { enregistrerGestionnaireErreurs, envoyerReponse404 } from '../plugins/erreurs.js';
import { routesConcurrents } from './concurrents.js';
// Import relatif temporaire — voir l'en-tête de `concurrents.ts` (même fichier,
// même raison : contrat hors barrel `@batte/core` tant que l'orchestrateur ne
// l'a pas câblé).
import {
  schemaConcurrent,
  schemaConcurrentDetail,
  schemaListeConcurrents,
  schemaMouvementsPrixConcurrents,
} from '@batte/core';

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

describe('routes /api/concurrents', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idLieu: string;

  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    base
      .insert(produitVente)
      .values({
        id: nouvelIdentifiant(),
        nom: 'Froment / cassonade',
        nature: 'transforme',
        recetteId: null,
        ingredientId: null,
        prixCents: 300,
        nbCrepes: 1,
        categorie: null,
        consommationSurPlace: false,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app, envoyerReponse404);
    await app.register(routesConcurrents(base), { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  function corpsConcurrent(surcharges: Record<string, unknown> = {}) {
    return {
      nom: 'Crêperie du Quai',
      lieuId: idLieu,
      typeOffre: 'crepes',
      positionnement: 'standard',
      emplacementObserve: null,
      qualitePercue: 3,
      notesGenerales: null,
      ...surcharges,
    };
  }

  describe('création et lecture', () => {
    it('POST /api/concurrents crée une fiche conforme au contrat', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent(),
      });

      expect(reponse.statusCode).toBe(201);
      const corps = schemaConcurrent.parse(reponse.json());
      expect(corps.nom).toBe('Crêperie du Quai');
      expect(corps.lieuNom).toBe('La Batte');
      expect(corps.actif).toBe(true);
    });

    it('POST /api/concurrents rend 422 en désignant « qualitePercue » hors bornes', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent({ qualitePercue: 6 }),
      });

      expect(reponse.statusCode).toBe(422);
      const corps = reponse.json<ReponseErreur>();
      expect(corps.erreur.code).toBe('validation');
      expect(corps.erreur.champs).toHaveProperty('qualitePercue');
    });

    it('POST /api/concurrents refuse un lieu inexistant, en désignant le champ', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent({ lieuId: 'lieu-fantome' }),
      });

      expect(reponse.statusCode).toBe(422);
      const corps = reponse.json<ReponseErreur>();
      expect(corps.erreur.code).toBe('lieu_introuvable');
      expect(corps.erreur.champs).toHaveProperty('lieuId');
    });

    it('GET /api/concurrents liste la fiche créée', async () => {
      await app.inject({ method: 'POST', url: '/api/concurrents', payload: corpsConcurrent() });

      const reponse = await app.inject({ method: 'GET', url: '/api/concurrents' });
      expect(reponse.statusCode).toBe(200);
      const corps = schemaListeConcurrents.parse(reponse.json());
      expect(corps.meta.total).toBe(1);
      expect(corps.data[0]!.nom).toBe('Crêperie du Quai');
    });

    it('GET /api/concurrents/:id rend une fiche complète, historique vide au départ', async () => {
      const creation = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent(),
      });
      const id = schemaConcurrent.parse(creation.json()).id;

      const reponse = await app.inject({ method: 'GET', url: `/api/concurrents/${id}` });
      expect(reponse.statusCode).toBe(200);
      const detail = schemaConcurrentDetail.parse(reponse.json());
      expect(detail.produits).toEqual([]);
      expect(detail.observations).toEqual([]);
      expect(detail.dernierPrixParProduit).toEqual([]);
    });

    it('GET /api/concurrents/:id inconnu rend 404 avec un message français', async () => {
      const reponse = await app.inject({
        method: 'GET',
        url: '/api/concurrents/concurrent-fantome',
      });

      expect(reponse.statusCode).toBe(404);
      const corps = reponse.json<ReponseErreur>();
      expect(corps.erreur.code).toBe('introuvable');
      expect(corps.erreur.message.trim().length).toBeGreaterThan(10);
    });
  });

  describe('modification et activité', () => {
    it('PATCH /api/concurrents/:id met à jour la fiche', async () => {
      const creation = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent(),
      });
      const id = schemaConcurrent.parse(creation.json()).id;

      const reponse = await app.inject({
        method: 'PATCH',
        url: `/api/concurrents/${id}`,
        payload: corpsConcurrent({ positionnement: 'premium', qualitePercue: 5 }),
      });

      expect(reponse.statusCode).toBe(200);
      const corps = schemaConcurrent.parse(reponse.json());
      expect(corps.positionnement).toBe('premium');
      expect(corps.qualitePercue).toBe(5);
    });

    it('PATCH /api/concurrents/:id/activite désactive sans supprimer la fiche', async () => {
      const creation = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent(),
      });
      const id = schemaConcurrent.parse(creation.json()).id;

      const reponse = await app.inject({
        method: 'PATCH',
        url: `/api/concurrents/${id}/activite`,
        payload: { actif: false },
      });
      expect(reponse.statusCode).toBe(200);
      expect(schemaConcurrent.parse(reponse.json()).actif).toBe(false);

      // Toujours présente dans la liste — désactivée, jamais supprimée
      // (CLAUDE.md §3 règle 7).
      const liste = await app.inject({ method: 'GET', url: '/api/concurrents' });
      const corps = schemaListeConcurrents.parse(liste.json());
      expect(corps.data.some((c) => c.id === id)).toBe(true);
    });
  });

  describe('saisie rapide après une visite', () => {
    it('POST /api/concurrents/:id/produits historise deux relevés distincts', async () => {
      const creation = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent(),
      });
      const id = schemaConcurrent.parse(creation.json()).id;

      const premier = await app.inject({
        method: 'POST',
        url: `/api/concurrents/${id}/produits`,
        payload: {
          nomProduit: 'Crêpe sucre',
          prixCents: 280,
          description: null,
          dateObservation: '2026-07-01',
        },
      });
      expect(premier.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: `/api/concurrents/${id}/produits`,
        payload: {
          nomProduit: 'Crêpe sucre',
          prixCents: 300,
          description: 'Beurre + sucre',
          dateObservation: '2026-07-20',
        },
      });
      expect(second.statusCode).toBe(201);

      const detail = schemaConcurrentDetail.parse(
        (await app.inject({ method: 'GET', url: `/api/concurrents/${id}` })).json(),
      );
      expect(detail.produits).toHaveLength(2);
      expect(detail.dernierPrixParProduit).toHaveLength(1);
      expect(detail.dernierPrixParProduit[0]!.prixCents).toBe(300);
      expect(detail.dateDerniereObservation).toBe('2026-07-20');
    });

    it('POST /api/concurrents/:id/produits rend 422 en désignant « nomProduit » vide', async () => {
      const creation = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent(),
      });
      const id = schemaConcurrent.parse(creation.json()).id;

      const reponse = await app.inject({
        method: 'POST',
        url: `/api/concurrents/${id}/produits`,
        payload: {
          nomProduit: '  ',
          prixCents: 300,
          description: null,
          dateObservation: '2026-07-01',
        },
      });
      expect(reponse.statusCode).toBe(422);
      expect(reponse.json<ReponseErreur>().erreur.champs).toHaveProperty('nomProduit');
    });

    it('POST /api/concurrents/:id/produits sur un concurrent inconnu rend 404', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/concurrents/concurrent-fantome/produits',
        payload: {
          nomProduit: 'Crêpe sucre',
          prixCents: 300,
          description: null,
          dateObservation: '2026-07-01',
        },
      });
      expect(reponse.statusCode).toBe(404);
    });

    it('POST /api/concurrents/:id/observations exige des notes non vides', async () => {
      const creation = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent(),
      });
      const id = schemaConcurrent.parse(creation.json()).id;

      const sansNotes = await app.inject({
        method: 'POST',
        url: `/api/concurrents/${id}/observations`,
        payload: {
          dateObservation: '2026-07-20',
          affluenceEstimee: 'forte',
          fileAttente: true,
          notes: '',
        },
      });
      expect(sansNotes.statusCode).toBe(422);
      expect(sansNotes.json<ReponseErreur>().erreur.champs).toHaveProperty('notes');

      const avecNotes = await app.inject({
        method: 'POST',
        url: `/api/concurrents/${id}/observations`,
        payload: {
          dateObservation: '2026-07-20',
          affluenceEstimee: 'forte',
          fileAttente: true,
          notes: "File d'attente de 6 personnes à 10 h.",
        },
      });
      expect(avecNotes.statusCode).toBe(201);

      const detail = schemaConcurrentDetail.parse(
        (await app.inject({ method: 'GET', url: `/api/concurrents/${id}` })).json(),
      );
      expect(detail.observations).toHaveLength(1);
    });
  });

  describe('comparateur — le seul écran du module qui change une décision', () => {
    it('compare notre carte aux derniers prix des concurrents équivalents', async () => {
      const creation = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent(),
      });
      const id = schemaConcurrent.parse(creation.json()).id;
      await app.inject({
        method: 'POST',
        url: `/api/concurrents/${id}/produits`,
        payload: {
          nomProduit: 'Crêpe sucre',
          prixCents: 350,
          description: null,
          dateObservation: '2026-07-20',
        },
      });

      const reponse = await app.inject({ method: 'GET', url: '/api/concurrents/comparateur' });
      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json<{
        notreCarte: { prixCents: number }[];
        dernierPrixConcurrents: { prixCents: number }[];
        moyenne: {
          notrePrixMoyenCrepeCents: number | null;
          concurrentsPrixMoyenCents: number | null;
          ecartBp: number | null;
          nbConcurrentsEquivalents: number;
        };
      }>();

      expect(corps.notreCarte.map((p) => p.prixCents)).toEqual([300]);
      expect(corps.dernierPrixConcurrents).toHaveLength(1);
      expect(corps.moyenne.notrePrixMoyenCrepeCents).toBe(300);
      expect(corps.moyenne.concurrentsPrixMoyenCents).toBe(350);
      expect(corps.moyenne.nbConcurrentsEquivalents).toBe(1);
      // Concurrent plus cher que nous : écart positif.
      expect(corps.moyenne.ecartBp).toBeGreaterThan(0);
    });

    it('rend des moyennes à `null` (jamais 0 ni NaN) sans concurrent équivalent', async () => {
      const reponse = await app.inject({ method: 'GET', url: '/api/concurrents/comparateur' });
      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json<{
        moyenne: { concurrentsPrixMoyenCents: number | null; ecartBp: number | null };
      }>();
      expect(corps.moyenne.concurrentsPrixMoyenCents).toBeNull();
      expect(corps.moyenne.ecartBp).toBeNull();
    });
  });

  describe('mouvements de prix — « qu’est-ce qui a bougé depuis mon avant-dernier relevé ? »', () => {
    it('GET /api/concurrents/mouvements rend `nouveau` sur un seul relevé, tout le reste à `null`', async () => {
      const creation = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent(),
      });
      const id = schemaConcurrent.parse(creation.json()).id;
      await app.inject({
        method: 'POST',
        url: `/api/concurrents/${id}/produits`,
        payload: {
          nomProduit: 'Crêpe sucre',
          prixCents: 280,
          description: null,
          dateObservation: '2026-07-01',
        },
      });

      const reponse = await app.inject({ method: 'GET', url: '/api/concurrents/mouvements' });
      expect(reponse.statusCode).toBe(200);
      const corps = schemaMouvementsPrixConcurrents.parse(reponse.json());
      expect(corps.meta.total).toBe(1);
      const m = corps.data[0]!;
      expect(m.statut).toBe('nouveau');
      expect(m.prixCents).toBe(280);
      expect(m.prixPrecedentCents).toBeNull();
      expect(m.ecartCents).toBeNull();
      expect(m.ecartBp).toBeNull();
      expect(m.dateObservationPrecedente).toBeNull();
    });

    it('GET /api/concurrents/mouvements rend `stable` avec un écart à 0 quand le prix n’a pas bougé', async () => {
      const creation = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent(),
      });
      const id = schemaConcurrent.parse(creation.json()).id;
      for (const date of ['2026-07-01', '2026-07-20']) {
        await app.inject({
          method: 'POST',
          url: `/api/concurrents/${id}/produits`,
          payload: {
            nomProduit: 'Crêpe sucre',
            prixCents: 280,
            description: null,
            dateObservation: date,
          },
        });
      }

      const reponse = await app.inject({ method: 'GET', url: '/api/concurrents/mouvements' });
      const corps = schemaMouvementsPrixConcurrents.parse(reponse.json());
      const m = corps.data[0]!;
      expect(m.statut).toBe('stable');
      expect(m.ecartCents).toBe(0);
      expect(m.ecartBp).toBe(0);
      expect(m.dateObservation).toBe('2026-07-20');
      expect(m.dateObservationPrecedente).toBe('2026-07-01');
    });

    it('GET /api/concurrents/mouvements rend `hausse` avec les deux dates comparées', async () => {
      const creation = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent(),
      });
      const id = schemaConcurrent.parse(creation.json()).id;
      await app.inject({
        method: 'POST',
        url: `/api/concurrents/${id}/produits`,
        payload: {
          nomProduit: 'Crêpe sucre',
          prixCents: 280,
          description: null,
          dateObservation: '2026-07-01',
        },
      });
      await app.inject({
        method: 'POST',
        url: `/api/concurrents/${id}/produits`,
        payload: {
          nomProduit: 'Crêpe sucre',
          prixCents: 350,
          description: null,
          dateObservation: '2026-07-20',
        },
      });

      const reponse = await app.inject({ method: 'GET', url: '/api/concurrents/mouvements' });
      const corps = schemaMouvementsPrixConcurrents.parse(reponse.json());
      const m = corps.data[0]!;
      expect(m.statut).toBe('hausse');
      expect(m.ecartCents).toBe(70);
      expect(m.prixPrecedentCents).toBe(280);
      expect(m.dateObservation).toBe('2026-07-20');
      expect(m.dateObservationPrecedente).toBe('2026-07-01');
    });

    it('GET /api/concurrents/mouvements exclut un concurrent désactivé', async () => {
      const creation = await app.inject({
        method: 'POST',
        url: '/api/concurrents',
        payload: corpsConcurrent(),
      });
      const id = schemaConcurrent.parse(creation.json()).id;
      await app.inject({
        method: 'POST',
        url: `/api/concurrents/${id}/produits`,
        payload: {
          nomProduit: 'Crêpe sucre',
          prixCents: 280,
          description: null,
          dateObservation: '2026-07-01',
        },
      });
      await app.inject({
        method: 'PATCH',
        url: `/api/concurrents/${id}/activite`,
        payload: { actif: false },
      });

      const reponse = await app.inject({ method: 'GET', url: '/api/concurrents/mouvements' });
      const corps = schemaMouvementsPrixConcurrents.parse(reponse.json());
      expect(corps.data).toEqual([]);
      expect(corps.meta.total).toBe(0);
    });

    it('GET /api/concurrents/mouvements rend un tableau vide sans aucun concurrent', async () => {
      const reponse = await app.inject({ method: 'GET', url: '/api/concurrents/mouvements' });
      expect(reponse.statusCode).toBe(200);
      const corps = schemaMouvementsPrixConcurrents.parse(reponse.json());
      expect(corps.data).toEqual([]);
      expect(corps.meta.total).toBe(0);
    });
  });
});
