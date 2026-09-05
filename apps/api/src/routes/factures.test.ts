/**
 * Tests d'intégration HTTP des routes `/api/factures` (fiche 14).
 *
 * Serveur minimal, sans passer par `construireServeur` (`apps/api/src/serveur.ts`
 * n'est pas modifié par cette fiche — la route y sera câblée séparément) :
 * même gestionnaire d'erreurs, même préfixe `/api`, pour un comportement
 * identique à celui qu'aura la vraie API une fois câblée.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  annulerReception,
  creerBase,
  enregistrerReception,
  migrer,
  seed,
  seedDemonstration,
  schema,
  type BaseBatte,
} from '@batte/db';
import type { FactureDetail, ListeFactures } from '@batte/core';
import { eq } from 'drizzle-orm';
import { enregistrerGestionnaireErreurs } from '../plugins/erreurs.js';
import { routesFactures } from './factures.js';

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

const JOUR = '2026-07-27';

describe('routes /api/factures', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idFarine: string;
  let idMeunier: string;
  let idFournisseurSysteme: string;
  let receptionId: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    idFarine = base
      .select({ id: schema.ingredient.id })
      .from(schema.ingredient)
      .where(eq(schema.ingredient.nom, 'Farine de froment T55'))
      .get()!.id;
    idMeunier = base
      .select({ id: schema.conditionnement.fournisseurId })
      .from(schema.conditionnement)
      .where(eq(schema.conditionnement.ingredientId, idFarine))
      .get()!.id;
    // Trouvé PAR SON TYPE, jamais par son libellé recopié à la main : c'est
    // exactement ce qui distingue ce fournisseur de tous les autres, et c'est
    // sur ce type que la garde de `enregistrerFacture` s'appuie.
    idFournisseurSysteme = base
      .select({ id: schema.fournisseur.id })
      .from(schema.fournisseur)
      .where(eq(schema.fournisseur.type, 'systeme'))
      .get()!.id;

    const resultatReception = enregistrerReception(base, {
      fournisseurId: idMeunier,
      dateReception: JOUR,
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 1000,
          prixLigneCents: 1000,
          numeroLotFournisseur: 'LOT-HTTP-001',
        },
      ],
    });
    receptionId = resultatReception.receptionId;

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(routesFactures(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rend 404 sur une facture inexistante', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/factures/introuvable' });
    expect(reponse.statusCode).toBe(404);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('introuvable');
  });

  it('refuse une facture sans ligne, avec un message 422', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: 'FA-HTTP-000',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [],
      },
    });
    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.champs).toHaveProperty('lignes');
  });

  /**
   * Garde-fou fournisseur système (31/07/2026). `enregistrerFacture`
   * (`services/factures.ts`) ne vérifiait que l'EXISTENCE du fournisseur,
   * jamais son type — contrairement aux trois autres points d'écriture qui
   * reçoivent un `fournisseurId` choisi par l'utilisateur
   * (`depots/referentiel.ts`, `depots/economies.ts`,
   * `depots/referentiel-ecriture.ts`). Un `POST /api/factures` portant
   * l'identifiant du fournisseur système passait donc toujours, alors que ce
   * n'est pas un fournisseur : c'est la contrepartie interne qui porte le
   * stock déclaré avant l'installation de l'application
   * (`seed/fournisseurs-systeme.ts`). Aucun fournisseur réel ne lui envoie de
   * facture.
   */
  it('refuse 422 une facture au nom du fournisseur SYSTÈME (« Inventaire d’ouverture »)', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: 'FA-HTTP-SYS-001',
        fournisseurId: idFournisseurSysteme,
        dateFacture: JOUR,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      },
    });
    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('fournisseur_systeme');
    expect(corps.erreur.champs).toHaveProperty('fournisseurId');
  });

  it(
    'une facture au nom d’un fournisseur COMMERCIAL passe toujours : la garde ne ferme ' +
      'que le fournisseur système, rien d’autre',
    async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/factures',
        payload: {
          numeroFournisseur: 'FA-HTTP-SYS-002',
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
        },
      });
      expect(reponse.statusCode).toBe(201);
      expect(reponse.json<FactureDetail>().fournisseurId).toBe(idMeunier);
    },
  );

  it('liste les réceptions éligibles au rapprochement pour ce fournisseur', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: `/api/factures/receptions-eligibles/${idMeunier}`,
    });
    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<{ data: { receptionId: string; prixLigneCents: number }[] }>();
    expect(corps.data.some((l) => l.receptionId === receptionId && l.prixLigneCents === 1000)).toBe(
      true,
    );
  });

  it('enregistre une facture DIVERGENTE : le détail rend un écart visible', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: 'FA-HTTP-001',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [
          {
            libelle: 'Farine T55',
            montantCents: 1200,
            receptionId,
            ingredientId: idFarine,
          },
        ],
      },
    });

    expect(reponse.statusCode).toBe(201);
    const detail = reponse.json<FactureDetail>();
    expect(detail.ecartTotalCents).toBe(200);
    expect(detail.lignes[0]!.ecartPrixCents).toBe(200);
    expect(detail.lignes[0]!.ecartResiduelCents).toBe(200);
    expect(detail.statut).toBe('a_rapprocher');

    // Elle apparaît dans la liste, avec le même écart.
    const listeReponse = await app.inject({ method: 'GET', url: '/api/factures' });
    const liste = listeReponse.json<ListeFactures>();
    const resume = liste.data.find((f) => f.id === detail.id)!;
    expect(resume.ecartTotalCents).toBe(200);

    // La correction explicite du coût du lot fonctionne via la route dédiée.
    const ligneId = detail.lignes[0]!.id;
    const correctionReponse = await app.inject({
      method: 'POST',
      url: `/api/factures/lignes/${ligneId}/corriger-lot`,
    });
    expect(correctionReponse.statusCode).toBe(201);
    const correction = correctionReponse.json<{ prixAvantCents: number; prixApresCents: number }>();
    expect(correction.prixAvantCents).toBe(1000);
    expect(correction.prixApresCents).toBe(1200);

    // Une seconde application est refusée : le prix est déjà à jour.
    const secondeReponse = await app.inject({
      method: 'POST',
      url: `/api/factures/lignes/${ligneId}/corriger-lot`,
    });
    expect(secondeReponse.statusCode).toBe(422);
    expect(secondeReponse.json<ReponseErreur>().erreur.code).toBe('deja_a_jour');
  });

  it('change le statut puis annule une facture par contre-écriture', async () => {
    const creation = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: 'FA-HTTP-002',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      },
    });
    const factureId = creation.json<FactureDetail>().id;

    const statutReponse = await app.inject({
      method: 'PATCH',
      url: `/api/factures/${factureId}/statut`,
      payload: { statut: 'rapprochee' },
    });
    expect(statutReponse.statusCode).toBe(200);
    expect(statutReponse.json<FactureDetail>().statut).toBe('rapprochee');

    const annulationReponse = await app.inject({
      method: 'POST',
      url: `/api/factures/${factureId}/annuler`,
      payload: { motif: 'Montant erroné' },
    });
    expect(annulationReponse.statusCode).toBe(201);
    const contreEcriture = annulationReponse.json<FactureDetail>();
    expect(contreEcriture.montantTotalCents).toBe(-500);
    expect(contreEcriture.estAnnulation).toBe(true);

    // La facture d'origine est toujours lisible, marquée annulée.
    const origineReponse = await app.inject({ method: 'GET', url: `/api/factures/${factureId}` });
    expect(origineReponse.json<FactureDetail>().estAnnulee).toBe(true);

    // Refuse une seconde annulation.
    const secondeAnnulation = await app.inject({
      method: 'POST',
      url: `/api/factures/${factureId}/annuler`,
      payload: { motif: 'Nouvelle tentative' },
    });
    expect(secondeAnnulation.statusCode).toBe(422);
    expect(secondeAnnulation.json<ReponseErreur>().erreur.code).toBe('deja_annule');
  });

  /**
   * Mission « trois chemins de pièce jointe jamais utilisés » (30/07/2026).
   *
   * `fichierScanPath` n'existe pas dans `schemaCreationFacture` /
   * `schemaFactureDetail` (`@batte/core`, hors périmètre d'écriture de cette
   * mission) : ces tests lisent donc le JSON BRUT de la réponse
   * (`Record<string, unknown>`), pas le type `FactureDetail` importé
   * ci-dessus — exactement ce que fait `extraireFichierScanPath`
   * (`apps/web/src/pages/Factures.tsx`) côté client.
   */
  it('accepte et relit une pièce jointe (Data URI) sur une facture', async () => {
    const pieceJointe =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const creation = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: 'FA-HTTP-PJ-001',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        fichierScanPath: pieceJointe,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      },
    });
    expect(creation.statusCode).toBe(201);
    const corpsCreation = creation.json<Record<string, unknown>>();
    expect(corpsCreation['fichierScanPath']).toBe(pieceJointe);

    const factureId = creation.json<FactureDetail>().id;
    const lecture = await app.inject({ method: 'GET', url: `/api/factures/${factureId}` });
    expect(lecture.json<Record<string, unknown>>()['fichierScanPath']).toBe(pieceJointe);
  });

  it('refuse une pièce jointe qui n’est pas une Data URI reconnue', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: 'FA-HTTP-PJ-002',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        fichierScanPath: 'C:\\Users\\porteur\\Documents\\facture.pdf',
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      },
    });
    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('piece_jointe_format_invalide');
  });

  it('rend `fichierScanPath` à `null` quand aucune pièce n’est jointe', async () => {
    const creation = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: 'FA-HTTP-PJ-003',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      },
    });
    expect(creation.statusCode).toBe(201);
    expect(creation.json<Record<string, unknown>>()['fichierScanPath']).toBeNull();
  });

  /**
   * Mission « deux restes de la chaîne d'achat » (31/07/2026) : le
   * rattachement d'une ligne de facture à une réception ANNULÉE est ACCEPTÉ
   * (jamais refusé, CLAUDE.md §7), mais averti — bout en bout jusqu'à la
   * réponse HTTP, pas seulement dans `packages/db/src/services/factures.ts`.
   * Sans type de retour explicite sur `lireFactureDetail`, ce champ aurait pu
   * violer `schemaFactureDetail` sans que `tsc` ne le voie, l'erreur ne
   * sortant qu'en 422 au premier appel — ce test l'exclut concrètement.
   */
  it('AVERTIT (sans bloquer) quand une facture est rattachée à une réception annulée', async () => {
    const resultatReception = enregistrerReception(base, {
      fournisseurId: idMeunier,
      dateReception: JOUR,
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 500,
          prixLigneCents: 500,
          numeroLotFournisseur: 'LOT-HTTP-ANN-001',
        },
      ],
    });
    annulerReception(base, resultatReception.receptionId, 'ERREUR_SAISIE');

    const reponse = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: 'FA-HTTP-004',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [
          {
            libelle: 'Farine T55',
            montantCents: 500,
            receptionId: resultatReception.receptionId,
            ingredientId: idFarine,
          },
        ],
      },
    });

    expect(reponse.statusCode).toBe(201);
    const detail = reponse.json<FactureDetail>();
    expect(detail.avertissements).toHaveLength(1);
    expect(detail.avertissements[0]).toContain(resultatReception.numero);
    expect(detail.lignes[0]!.receptionAnnulee).toBe(true);

    // Une relecture ultérieure porte le MÊME avertissement : il n'est pas
    // qu'un instantané de la réponse de création.
    const lecture = await app.inject({ method: 'GET', url: `/api/factures/${detail.id}` });
    expect(lecture.json<FactureDetail>().avertissements).toHaveLength(1);
  });

  it("N'AVERTIT PAS sur une réception ACTIVE : le silence est prouvé bout en bout", async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: 'FA-HTTP-005',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [
          { libelle: 'Farine T55', montantCents: 1000, receptionId, ingredientId: idFarine },
        ],
      },
    });

    expect(reponse.statusCode).toBe(201);
    const detail = reponse.json<FactureDetail>();
    expect(detail.avertissements).toEqual([]);
    expect(detail.lignes[0]!.receptionAnnulee).toBe(false);
  });

  it('refuse une annulation sans motif', async () => {
    const creation = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: 'FA-HTTP-003',
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      },
    });
    const factureId = creation.json<FactureDetail>().id;

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/factures/${factureId}/annuler`,
      payload: { motif: '' },
    });
    expect(reponse.statusCode).toBe(422);
  });
});
