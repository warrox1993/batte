/**
 * Mission « surface d'attaque ouverte aujourd'hui » (30/07/2026) — volet HTTP.
 *
 * Complète `packages/db/src/services/factures.piece-jointe-securite.test.ts`
 * (qui prouve que `validerPieceJointe` refuse un contenu hostile) en prouvant
 * que ce refus traverse RÉELLEMENT toute la pile HTTP : `POST /api/factures`
 * rend un 422 propre — jamais un 201, jamais un 500, jamais une trace du
 * contenu hostile recopiée dans la réponse.
 *
 * Même patron de montage que `factures.test.ts` (serveur Fastify minimal,
 * sans `construireServeur`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { creerBase, migrer, seed, seedDemonstration, schema, type BaseBatte } from '@batte/db';
import { eq } from 'drizzle-orm';
import { enregistrerGestionnaireErreurs } from '../plugins/erreurs.js';
import { routesFactures } from './factures.js';

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

const JOUR = '2026-07-27';

/** Un contenu HTML/script, jamais un type MIME accepté tel quel. */
const HTML_SCRIPT = '<html><body><script>alert(document.cookie)</script></body></html>';
const HTML_SCRIPT_B64 = Buffer.from(HTML_SCRIPT, 'ascii').toString('base64');

/** Un SVG scriptable, même remarque. */
const SVG_SCRIPT = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
const SVG_SCRIPT_B64 = Buffer.from(SVG_SCRIPT, 'ascii').toString('base64');

/** PNG 1×1 minuscule, réellement valide (même fixture que `factures.test.ts`). */
const PNG_VALIDE_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('POST /api/factures — pièce jointe hostile refusée par toute la pile HTTP', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idMeunier: string;
  let compteurNumero = 0;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const idFarine = base
      .select({ id: schema.ingredient.id })
      .from(schema.ingredient)
      .where(eq(schema.ingredient.nom, 'Farine de froment T55'))
      .get()!.id;
    idMeunier = base
      .select({ id: schema.conditionnement.fournisseurId })
      .from(schema.conditionnement)
      .where(eq(schema.conditionnement.ingredientId, idFarine))
      .get()!.id;

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(routesFactures(base), { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Un numéro de facture distinct par test (contrainte d'unicité éventuelle). */
  function numeroFacture(): string {
    compteurNumero += 1;
    return `FA-SEC-HTTP-${compteurNumero.toString().padStart(3, '0')}`;
  }

  it('refuse un data:text/html;base64 avec 422, jamais 201 ni 500', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: numeroFacture(),
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        fichierScanPath: `data:text/html;base64,${HTML_SCRIPT_B64}`,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('piece_jointe_format_invalide');
    // Le script hostile ne doit apparaître NULLE PART dans la réponse.
    expect(reponse.payload).not.toContain('<script>');
    expect(reponse.payload).not.toContain(HTML_SCRIPT_B64);
  });

  it('refuse un SVG scriptable (data:image/svg+xml) avec 422', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: numeroFacture(),
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        fichierScanPath: `data:image/svg+xml;base64,${SVG_SCRIPT_B64}`,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('piece_jointe_format_invalide');
    expect(reponse.payload).not.toContain('<script>');
  });

  it(
    'refuse un contenu HTML/script étiqueté « image/png » avec 422 — le cas central : un ' +
      'fichier .png dont les octets sont du HTML reste du HTML pour le navigateur',
    async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/factures',
        payload: {
          numeroFournisseur: numeroFacture(),
          fournisseurId: idMeunier,
          dateFacture: JOUR,
          fichierScanPath: `data:image/png;base64,${HTML_SCRIPT_B64}`,
          lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
        },
      });

      expect(reponse.statusCode).toBe(422);
      expect(reponse.json<ReponseErreur>().erreur.code).toBe('piece_jointe_contenu_incoherent');
      expect(reponse.payload).not.toContain('<script>');
      expect(reponse.payload).not.toContain(HTML_SCRIPT_B64);
    },
  );

  it('refuse une casse de type MIME détournée (« IMAGE/PNG ») avec 422, jamais 201', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: numeroFacture(),
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        fichierScanPath: `data:IMAGE/PNG;base64,${PNG_VALIDE_B64}`,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('piece_jointe_format_invalide');
  });

  it('refuse un préfixe « data: » dédoublé avec 422', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: numeroFacture(),
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        fichierScanPath: `data:data:image/png;base64,${PNG_VALIDE_B64}`,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('piece_jointe_format_invalide');
  });

  it('accepte toujours un PNG réellement valide, en 201 (non-régression)', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/factures',
      payload: {
        numeroFournisseur: numeroFacture(),
        fournisseurId: idMeunier,
        dateFacture: JOUR,
        fichierScanPath: `data:image/png;base64,${PNG_VALIDE_B64}`,
        lignes: [{ libelle: 'Frais divers', montantCents: 500 }],
      },
    });

    expect(reponse.statusCode).toBe(201);
    expect(reponse.json<Record<string, unknown>>()['fichierScanPath']).toBe(
      `data:image/png;base64,${PNG_VALIDE_B64}`,
    );
  });
});
