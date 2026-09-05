/**
 * `GET /api/demarrage` — état DÉRIVÉ du parcours de premier lancement
 * (docs/06-UI-ET-PARCOURS.md, section « Parcours de premier lancement »,
 * correction du 31/07/2026).
 *
 * Cette route ne calcule rien : elle délègue entièrement à
 * `etatDemarrage` (`packages/db/src/depots/demarrage.ts`, règle
 * d'architecture n°1, CLAUDE.md §3) et valide sa sortie contre
 * `schemaEtatDemarrage` (`@batte/core`) avant de la renvoyer — même
 * discipline que le reste de l'API (docs/06, « le typage du client est
 * dérivé du schéma, jamais réécrit »).
 *
 * Objet unique, comme `GET /api/sante` ou `GET /api/prevision` : ce n'est
 * pas une liste, donc pas d'enveloppe `{ data, meta }`.
 *
 * Testée en isolation par `demarrage.test.ts` (même patron que
 * `objectifs.test.ts`). Une route testée en isolation n'est PAS une route
 * servie : seule la table de routage de Fastify après `app.ready()` en fait
 * foi (D-045, `docs/39` §2). C'est ce que vérifient les tests de fumée qui
 * balaient le serveur complet — s'y fier plutôt qu'à ce commentaire.
 */

import type { FastifyPluginAsync } from 'fastify';
import { schemaEtatDemarrage } from '@batte/core';
import { etatDemarrage, type BaseBatte } from '@batte/db';

export function routesDemarrage(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    app.get('/demarrage', async () => schemaEtatDemarrage.parse(etatDemarrage(base)));
  };
}
