/**
 * Tests HTTP de `POST /api/commandes/:id/annuler` (audit chaîne d'achat du
 * 29/07/2026).
 *
 * Le reste de `routes/commandes.ts` (génération, validation, envoi) est déjà
 * couvert par `apps/api/src/routes/integration.test.ts` (hors zone
 * d'écriture) : ce fichier se concentre sur ce que cet audit a ajouté — la
 * route qui manquait pour atteindre le statut `annulee`, déjà déclaré dans
 * `schemaStatutCommande` et déjà affiché par `Achats.tsx`, mais jamais
 * accessible.
 *
 * L'historique de consommation est CONSTRUIT par le test (même geste que
 * `packages/db/src/services/commandes.test.ts`), pas emprunté à la graine de
 * démonstration : un besoin sous le point de commande à une date précise
 * n'est pas une garantie de la graine, et un test qui s'y fierait casserait
 * au premier ajustement légitime du jeu de démonstration.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ajouterJours } from '@batte/core';
import type { CommandeDetail, CommandeResume, ResultatGeneration } from '@batte/core';
import {
  ajouterVersionParametre,
  creerBase,
  enregistrerReception,
  enregistrerSortie,
  migrer,
  seed,
  seedDemonstration,
  type BaseBatte,
} from '@batte/db';
import { eq } from 'drizzle-orm';
import { schema } from '@batte/db';
import { enregistrerGestionnaireErreurs } from '../plugins/erreurs.js';
import { routesCommandes } from './commandes.js';

type ReponseErreur = { erreur: { code: string; message: string } };

const JOUR = '2026-07-27';

describe('POST /api/commandes/:id/annuler', () => {
  let base: BaseBatte;
  let app: FastifyInstance;

  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    // Fenêtre d'historique réduite, comme dans les tests de service : lisible
    // et indépendante de la valeur par défaut (90 jours).
    ajouterVersionParametre(base, {
      cle: 'reappro_fenetre_historique_jours',
      valeur: '14',
      typeValeur: 'entier',
      dateDebutValidite: '2026-07-01',
      source: 'test',
      description: 'Fenêtre réduite pour les tests.',
    });

    const farine = base
      .select({ id: schema.ingredient.id })
      .from(schema.ingredient)
      .where(eq(schema.ingredient.nom, 'Farine de froment T55'))
      .get()!;
    const fournisseurId = base
      .select({ id: schema.conditionnement.fournisseurId })
      .from(schema.conditionnement)
      .where(eq(schema.conditionnement.ingredientId, farine.id))
      .get()!.id;

    // Reçu 16 000 g, consommé 1000 g/j sur 14 jours -> 2000 g restants, sous
    // le point de commande (3000 g, délai 3 j × 1000 g/j) : un brouillon émerge.
    enregistrerReception(base, {
      fournisseurId,
      dateReception: '2026-06-01',
      lignes: [
        {
          ingredientId: farine.id,
          quantite: 16_000,
          prixLigneCents: 100,
          numeroLotFournisseur: 'LOT-TEST',
        },
      ],
    });
    for (let i = 0; i < 14; i++) {
      enregistrerSortie(base, {
        ingredientId: farine.id,
        quantite: 1000,
        type: 'sortie_production',
        motifCode: 'SURDOSAGE',
        dateMouvement: ajouterJours(ajouterJours(JOUR, -13), i),
      });
    }

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(routesCommandes(base), { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  /** Génère le brouillon de farine que `beforeEach` a préparé. */
  async function genererCommande(): Promise<CommandeResume> {
    const resultat = (
      await app.inject({
        method: 'POST',
        url: '/api/commandes/generer',
        payload: { jourReference: JOUR },
      })
    ).json<ResultatGeneration>();
    const commande = resultat.data[0];
    if (commande === undefined) {
      throw new Error(
        `Aucun brouillon généré au ${JOUR} : l'historique construit est insuffisant.`,
      );
    }
    return commande;
  }

  it('annule un BROUILLON, avec un motif conservé dans les notes', async () => {
    const commande = await genererCommande();

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/commandes/${commande.id}/annuler`,
      payload: { motif: 'Test HTTP — abandon volontaire.' },
    });

    expect(reponse.statusCode).toBe(200);
    const detail = reponse.json<CommandeDetail>();
    expect(detail.statut).toBe('annulee');
    expect(detail.notes).toBe('Test HTTP — abandon volontaire.');
  });

  it('accepte l’annulation SANS motif', async () => {
    const commande = await genererCommande();

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/commandes/${commande.id}/annuler`,
      payload: {},
    });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json<CommandeDetail>().statut).toBe('annulee');
  });

  it('refuse d’annuler une commande déjà ENVOYÉE, en 422', async () => {
    const commande = await genererCommande();
    await app.inject({ method: 'POST', url: `/api/commandes/${commande.id}/valider` });
    await app.inject({
      method: 'POST',
      url: `/api/commandes/${commande.id}/envoyer`,
      payload: { email: 'meunier@example.test' },
    });

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/commandes/${commande.id}/annuler`,
      payload: {},
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('commande_non_annulable');
  });

  it('rend 404 pour une commande inexistante', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/commandes/commande-fantome/annuler',
      payload: {},
    });

    expect(reponse.statusCode).toBe(404);
  });

  it('refuse un motif de plus de 500 caractères, en 422', async () => {
    const commande = await genererCommande();

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/commandes/${commande.id}/annuler`,
      payload: { motif: 'x'.repeat(501) },
    });

    expect(reponse.statusCode).toBe(422);
  });

  it(
    'LE TEST QUI COMPTE, à travers HTTP : une commande annulée ne bloque plus ' +
      'le réapprovisionnement suivant',
    async () => {
      const commande = await genererCommande();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/commandes/generer',
            payload: { jourReference: JOUR },
          })
        ).json<ResultatGeneration>().data,
      ).toHaveLength(0);

      await app.inject({
        method: 'POST',
        url: `/api/commandes/${commande.id}/annuler`,
        payload: {},
      });

      const second = (
        await app.inject({
          method: 'POST',
          url: '/api/commandes/generer',
          payload: { jourReference: JOUR },
        })
      ).json<ResultatGeneration>();
      expect(second.data).toHaveLength(1);
    },
  );
});
