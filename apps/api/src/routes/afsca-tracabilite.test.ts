/**
 * Test HTTP dédié : `receptionStatut` doit arriver JUSQU'À la réponse HTTP de
 * `GET /api/afsca/tracabilite/lots/:id`, pas seulement jusqu'au dépôt
 * (`packages/db/src/depots/tracabilite.ts`).
 *
 * C'est précisément le maillon où un `.parse()` Zod peut supprimer un champ
 * calculé EN SILENCE si le schéma ne le déclare pas — une « capacité inerte »,
 * déjà rencontrée plusieurs fois dans ce projet. Fichier DÉDIÉ, même geste que
 * `routes/afsca.test.ts` (fichier séparé, sa propre instance Fastify minimale
 * ne montant que `routesAfsca`) : ne touche à aucun test déjà écrit par un
 * autre agent en parallèle.
 *
 * Un lot dont la réception a été ANNULÉE ne doit pas disparaître de la
 * réponse (CLAUDE.md §7 : « rien ne s'efface ») : on vérifie donc autant que
 * le lot reste présent que son statut de réception est correctement rendu.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  creerBase,
  migrer,
  seed,
  seedDemonstration,
  annulerReception,
  changerStatutLot,
  enregistrerReception,
  fournisseur,
  ingredient,
  type BaseBatte,
} from '@batte/db';
import { enregistrerGestionnaireErreurs, envoyerReponse404 } from '../plugins/erreurs.js';
import { routesAfsca } from './afsca.js';

const JOUR = '2026-07-29';

describe('GET /api/afsca/tracabilite/lots/:id — receptionStatut jusqu’à la réponse HTTP', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idFournisseur: string;
  let idIngredient: string;

  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
    idIngredient = base.select({ id: ingredient.id }).from(ingredient).get()!.id;

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app, envoyerReponse404);
    await app.register(routesAfsca(base), { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rend receptionStatut = "active" pour un lot d’une réception non annulée', async () => {
    const resultatReception = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: [
        {
          ingredientId: idIngredient,
          quantite: 500,
          prixLigneCents: 200,
          numeroLotFournisseur: 'HTTP-TRACABILITE-ACTIVE',
        },
      ],
    });
    const lotId = resultatReception.lotsCrees[0]!.lotId;

    const reponse = await app.inject({
      method: 'GET',
      url: `/api/afsca/tracabilite/lots/${lotId}`,
    });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json() as { lotId: string; receptionStatut?: string };
    expect(corps.lotId).toBe(lotId);
    expect(corps.receptionStatut).toBe('active');
  });

  it(
    'rend receptionStatut = "annulee" pour un lot dont la réception a été annulée ' +
      'après coup, SANS faire disparaître le lot de la réponse',
    async () => {
      const resultatReception = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idIngredient,
            quantite: 500,
            prixLigneCents: 200,
            numeroLotFournisseur: 'HTTP-TRACABILITE-ANNULEE',
          },
        ],
      });
      const lotId = resultatReception.lotsCrees[0]!.lotId;

      // Ce lot n'a JAMAIS servi : l'annulation de sa réception réussit.
      annulerReception(base, resultatReception.receptionId, 'ERREUR_SAISIE');

      const reponse = await app.inject({
        method: 'GET',
        url: `/api/afsca/tracabilite/lots/${lotId}`,
      });

      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json() as { lotId: string; receptionStatut?: string };
      // Le lot reste PRÉSENT dans le registre : seul son statut change.
      expect(corps.lotId).toBe(lotId);
      expect(corps.receptionStatut).toBe('annulee');
    },
  );

  /**
   * Audit du 30/07/2026 (`audit-colonnes-orphelines.test.ts`) : `statut`,
   * `motifStatutLibelle` et `dateChangementStatut` (`lot.motif_statut_id`,
   * `lot.date_changement_statut`) doivent arriver JUSQU'À la réponse HTTP,
   * même piège que `receptionStatut` ci-dessus — un `.parse()` Zod qui ne
   * déclare pas le champ le supprimerait EN SILENCE.
   */
  it(
    'rend statut, motifStatutLibelle et dateChangementStatut jusqu’à la réponse HTTP, ' +
      'après un blocage pour rappel fournisseur',
    async () => {
      const resultatReception = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idIngredient,
            quantite: 500,
            prixLigneCents: 200,
            numeroLotFournisseur: 'HTTP-TRACABILITE-BLOQUE',
          },
        ],
      });
      const lotId = resultatReception.lotsCrees[0]!.lotId;

      changerStatutLot(base, lotId, 'bloque', 'RAPPEL_FOURNISSEUR', JOUR);

      const reponse = await app.inject({
        method: 'GET',
        url: `/api/afsca/tracabilite/lots/${lotId}`,
      });

      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json() as {
        lotId: string;
        statut?: string;
        motifStatutLibelle?: string | null;
        dateChangementStatut?: string | null;
      };
      expect(corps.lotId).toBe(lotId);
      expect(corps.statut).toBe('bloque');
      expect(corps.motifStatutLibelle).toBe('Bloqué suite à un rappel fournisseur');
      expect(corps.dateChangementStatut).not.toBeNull();
    },
  );

  it(
    'rend motifStatutLibelle et dateChangementStatut à `null` (jamais absents) ' +
      'sur un lot qui n’a jamais changé de statut',
    async () => {
      const resultatReception = enregistrerReception(base, {
        fournisseurId: idFournisseur,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idIngredient,
            quantite: 500,
            prixLigneCents: 200,
            numeroLotFournisseur: 'HTTP-TRACABILITE-JAMAIS-CHANGE',
          },
        ],
      });
      const lotId = resultatReception.lotsCrees[0]!.lotId;

      const reponse = await app.inject({
        method: 'GET',
        url: `/api/afsca/tracabilite/lots/${lotId}`,
      });

      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json() as {
        statut?: string;
        motifStatutLibelle?: string | null;
        dateChangementStatut?: string | null;
      };
      expect(corps.statut).toBe('disponible');
      expect(corps.motifStatutLibelle).toBeNull();
      expect(corps.dateChangementStatut).toBeNull();
    },
  );
});
