/**
 * Tests HTTP de `routes/referentiel.ts` (fournisseurs, produits, ingrédients
 * en lecture).
 *
 * CE QUE CE FICHIER PROUVE : le défaut trouvé en audit du 29/07/2026 sur la
 * chaîne d'achat est bien fermé de bout en bout, à travers Fastify — pas
 * seulement au niveau du dépôt (`packages/db/src/depots/referentiel.test.ts`).
 * Avant le correctif, `PATCH /api/fournisseurs/:id` sur l'identifiant du
 * fournisseur système (« Inventaire d'ouverture ») réussissait avec un 200,
 * parce que `schemaSaisieFournisseur` force `type` à l'une des quatre valeurs
 * commerciales : la ligne système se retrouvait donc silencieusement
 * convertie en fournisseur commercial ordinaire, exploitable en un seul appel.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { creerBase, migrer, seed, type BaseBatte } from '@batte/db';
import type { ListeFournisseurs } from '@batte/core';
import { enregistrerGestionnaireErreurs } from '../plugins/erreurs.js';
import { routesReferentiel } from './referentiel.js';

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

/** Saisie de fournisseur valide, au format que produit le formulaire réel. */
function corpsFournisseur(surcharges: Record<string, unknown> = {}) {
  return {
    nom: 'Moulin de Statte',
    type: 'moulin',
    email: null,
    telephone: null,
    adresse: null,
    delaiLivraisonJours: 3,
    francoDePortCents: null,
    commandeMinimumCents: null,
    notes: null,
    ...surcharges,
  };
}

describe('routes /api/fournisseurs — le fournisseur système est protégé', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idSysteme: string;
  let idCommercial: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(
      async (api) => {
        await api.register(routesReferentiel(base));
      },
      { prefix: '/api' },
    );
    await app.ready();

    const fournisseurs = (
      await app.inject({ method: 'GET', url: '/api/fournisseurs' })
    ).json<ListeFournisseurs>();
    idSysteme = fournisseurs.data.find((f) => f.type === 'systeme')!.id;

    const cree = await app.inject({
      method: 'POST',
      url: '/api/fournisseurs',
      payload: corpsFournisseur(),
    });
    idCommercial = cree.json<{ id: string }>().id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('PATCH /api/fournisseurs/:id refuse le fournisseur système avec un 422 nommé', async () => {
    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/fournisseurs/${idSysteme}`,
      payload: corpsFournisseur(),
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('fournisseur_systeme');

    // Le cœur du défaut : le type système n'a PAS basculé vers un type commercial.
    const relu = (
      await app.inject({ method: 'GET', url: '/api/fournisseurs' })
    ).json<ListeFournisseurs>();
    expect(relu.data.find((f) => f.id === idSysteme)?.type).toBe('systeme');
  });

  it('PATCH /api/fournisseurs/:id/activite refuse de désactiver le fournisseur système', async () => {
    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/fournisseurs/${idSysteme}/activite`,
      payload: { actif: false },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('fournisseur_systeme');

    const relu = (
      await app.inject({ method: 'GET', url: '/api/fournisseurs' })
    ).json<ListeFournisseurs>();
    expect(relu.data.find((f) => f.id === idSysteme)?.actif).toBe(true);
  });

  it('un fournisseur commercial ordinaire reste modifiable et désactivable via l’API', async () => {
    const modification = await app.inject({
      method: 'PATCH',
      url: `/api/fournisseurs/${idCommercial}`,
      payload: corpsFournisseur({ nom: 'Moulin de Statte — renommé' }),
    });
    expect(modification.statusCode).toBe(200);

    const desactivation = await app.inject({
      method: 'PATCH',
      url: `/api/fournisseurs/${idCommercial}/activite`,
      payload: { actif: false },
    });
    expect(desactivation.statusCode).toBe(200);

    const relu = (
      await app.inject({ method: 'GET', url: '/api/fournisseurs' })
    ).json<ListeFournisseurs>();
    const ligne = relu.data.find((f) => f.id === idCommercial);
    expect(ligne?.nom).toBe('Moulin de Statte — renommé');
    expect(ligne?.actif).toBe(false);
  });
});
