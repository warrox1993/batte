/**
 * Routes `/api/concurrents` (fiche `docs/demandes/08-FICHES-CONCURRENTS.md`).
 *
 * ═══ Imports relatifs temporaires ═══
 *
 * `packages/core/src/contrats/concurrents.ts` et
 * `packages/db/src/depots/concurrents.ts` sont des fichiers NEUFS, hors des
 * barrels `@batte/core` et `@batte/db` (câblage réservé à l'orchestrateur —
 * voir le rapport de livraison pour les lignes exactes à y ajouter). Les
 * imports ci-dessous passent donc par un chemin relatif direct, à remplacer
 * par `from '@batte/core'` / `from '@batte/db'` dès les barrels mis à jour.
 * Même convention que `apps/api/src/routes/economies.ts`.
 *
 * ═══ Ce que ce module ne fait PAS ═══
 *
 * Aucune route ici n'alimente le moteur de prévision : un concurrent influence
 * la RÉPARTITION de la clientèle entre vendeurs, jamais la demande TOTALE du
 * marché. L'écran (`apps/web/src/pages/Concurrents.tsx`) le dit explicitement.
 */

import type { FastifyPluginAsync } from 'fastify';
import { ErreurIntrouvable } from '@batte/core';
import type { BaseBatte } from '@batte/db';
import {
  schemaActiviteConcurrent,
  schemaComparateur,
  schemaConcurrent,
  schemaConcurrentDetail,
  schemaConcurrentObservationLigne,
  schemaConcurrentProduitLigne,
  schemaCreationConcurrentObservation,
  schemaCreationConcurrentProduit,
  schemaListeConcurrents,
  schemaMouvementsPrixConcurrents,
  schemaSaisieConcurrent,
} from '@batte/core';
import {
  ajouterObservationConcurrent,
  ajouterProduitConcurrent,
  changerActiviteConcurrent,
  comparateurPrix,
  creerConcurrent,
  lireConcurrentDetail,
  listerConcurrents,
  modifierConcurrent,
  mouvementsPrixConcurrents,
} from '@batte/db';

export function routesConcurrents(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /* ─── Liste, filtrable par lieu ───────────────────────────────────────── */

    app.get<{ Querystring: { lieuId?: string } }>('/concurrents', async (requete) => {
      const lignes = listerConcurrents(base, {
        ...(requete.query.lieuId === undefined ? {} : { lieuId: requete.query.lieuId }),
      });
      return schemaListeConcurrents.parse({ data: lignes, meta: { total: lignes.length } });
    });

    /* ─── Comparateur — LE point d'accroche de la fiche ───────────────────────
       Route STATIQUE déclarée avant `/concurrents/:id` : même lecture que
       `routes/commandes.ts` (le cas particulier avant le cas général), même si
       la table de routage de Fastify les distingue de toute façon. ────────── */

    app.get<{ Querystring: { lieuId?: string } }>('/concurrents/comparateur', async (requete) => {
      const resultat = comparateurPrix(base, {
        ...(requete.query.lieuId === undefined ? {} : { lieuId: requete.query.lieuId }),
      });
      return schemaComparateur.parse(resultat);
    });

    /* ─── Mouvements de prix — « qu'est-ce qui a bougé depuis mon avant-dernier
       relevé ? » (docs/demandes/08-FICHES-CONCURRENTS.md, vérification du
       01/08/2026). Route STATIQUE, même lecture que `/concurrents/comparateur`
       ci-dessus : déclarée avant `/concurrents/:id`. ─────────────────────── */

    app.get<{ Querystring: { lieuId?: string } }>('/concurrents/mouvements', async (requete) => {
      const lignes = mouvementsPrixConcurrents(base, {
        ...(requete.query.lieuId === undefined ? {} : { lieuId: requete.query.lieuId }),
      });
      return schemaMouvementsPrixConcurrents.parse({
        data: lignes,
        meta: { total: lignes.length },
      });
    });

    /* ─── Fiche complète d'un concurrent ──────────────────────────────────── */

    app.get<{ Params: { id: string } }>('/concurrents/:id', async (requete) => {
      const detail = lireConcurrentDetail(base, requete.params.id);
      if (detail === undefined) throw new ErreurIntrouvable('Concurrent', requete.params.id);
      return schemaConcurrentDetail.parse(detail);
    });

    /* ─── Création et modification de la fiche ────────────────────────────── */

    app.post('/concurrents', async (requete, reponse) => {
      const corps = schemaSaisieConcurrent.parse(requete.body);
      const cree = creerConcurrent(base, corps);
      reponse.code(201);
      return schemaConcurrent.parse(cree);
    });

    app.patch<{ Params: { id: string } }>('/concurrents/:id', async (requete) => {
      const corps = schemaSaisieConcurrent.parse(requete.body);
      const modifie = modifierConcurrent(base, requete.params.id, corps);
      return schemaConcurrent.parse(modifie);
    });

    /** On DÉSACTIVE, on ne supprime jamais — même geste que
     * `PATCH /fournisseurs/:id/activite` (CLAUDE.md §3 règle 7). */
    app.patch<{ Params: { id: string } }>('/concurrents/:id/activite', async (requete) => {
      const corps = schemaActiviteConcurrent.parse(requete.body);
      const modifie = changerActiviteConcurrent(base, requete.params.id, corps.actif);
      return schemaConcurrent.parse(modifie);
    });

    /* ─── Saisie rapide « après une visite » — produit et observation ─────── */

    app.post<{ Params: { id: string } }>('/concurrents/:id/produits', async (requete, reponse) => {
      const corps = schemaCreationConcurrentProduit.parse(requete.body);
      const cree = ajouterProduitConcurrent(base, requete.params.id, corps);
      reponse.code(201);
      return schemaConcurrentProduitLigne.parse(cree);
    });

    app.post<{ Params: { id: string } }>(
      '/concurrents/:id/observations',
      async (requete, reponse) => {
        const corps = schemaCreationConcurrentObservation.parse(requete.body);
        const cree = ajouterObservationConcurrent(base, requete.params.id, corps);
        reponse.code(201);
        return schemaConcurrentObservationLigne.parse(cree);
      },
    );
  };
}
