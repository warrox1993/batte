/**
 * Tests HTTP de `routes/documents.ts` — garde-fou de statut sur l'étiquette
 * de bac (audit chaîne documentaire du 30/07/2026).
 *
 * Une étiquette collée sur un bac dont la production a été ANNULÉE désigne un
 * lot qui n'aurait jamais dû exister : c'est une erreur de traçabilité par
 * lot, obligation réglementaire (CLAUDE.md §3 règle 6). Ce fichier vérifie que
 * la route refuse ce cas, ET que le cas normal (production active) continue
 * de fonctionner — un garde-fou qui casserait le chemin nominal serait pire
 * que l'absence de garde-fou.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import {
  annulerProduction,
  creerBase,
  creerSession,
  enregistrerReception,
  fournisseur,
  ingredient,
  lancerProduction,
  lieuMarche,
  migrer,
  recette,
  schema,
  seed,
  seedDemonstration,
  type BaseBatte,
} from '@batte/db';
import { enregistrerGestionnaireErreurs } from '../plugins/erreurs.js';
import { routesDocuments } from './documents.js';
import { fermerNavigateur, versionsDocument } from '../documents/rendu.js';

// Voir le commentaire de `documents/rendu.test.ts` : le démarrage ET l'arrêt de
// Chromium (déclenchés ici par le chemin nominal, qui rend un vrai PDF, et par
// le nouvel `afterAll` ci-dessous) ne sont pas des opérations à durée fixe —
// le défaut Vitest (5 s test / 10 s hook) a déjà été mesuré trop court sous la
// contention d'une suite complète. Ce `vi.setConfig` doit rester ICI, au
// niveau du module (jamais dans un `beforeEach`/`beforeAll`) : Vitest fige le
// timeout de chaque test/hook au moment de son enregistrement, pendant la
// collecte — un `vi.setConfig` posé dans le corps d'un hook s'exécute trop
// tard pour le premier test ou hook du fichier (voir `rendu.test.ts` pour le
// défaut correspondant, corrigé le 31/07/2026).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type ReponseErreur = { erreur: { code: string; message: string } };

const JOUR = '2034-01-05';

describe('GET /api/documents/etiquette-bac/:id', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idRecette: string;

  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    // Recette minimale avec un seul ingrédient, approvisionné en quantité
    // large pour que `lancerProduction` ne bute jamais sur la faisabilité —
    // ce test porte sur le GARDE-FOU DE STATUT, pas sur le calcul de stock.
    const maintenant = maintenantUtc();
    const idIngredient = nouvelIdentifiant();
    base
      .insert(schema.ingredient)
      .values({
        id: idIngredient,
        nom: 'Farine (test étiquette)',
        categorie: 'farine',
        uniteReference: 'g',
        allergenes: ['gluten'],
        stockSecurite: 0,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const idFournisseur = nouvelIdentifiant();
    base
      .insert(schema.fournisseur)
      .values({
        id: idFournisseur,
        nom: 'Fournisseur (test étiquette)',
        type: 'grossiste',
        delaiLivraisonJours: 2,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idRecette = nouvelIdentifiant();
    base
      .insert(schema.recette)
      .values({
        id: idRecette,
        code: 'RTEST-ETIQUETTE',
        nom: 'Recette de test étiquette',
        version: 1,
        statut: 'active',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 5000,
        rendementReferenceCrepes: 66,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: 0,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    base
      .insert(schema.recetteLigne)
      .values({
        id: nouvelIdentifiant(),
        recetteId: idRecette,
        ingredientId: idIngredient,
        quantiteUniteRef: 145,
        ordre: 0,
        noteTechnique: null,
      })
      .run();

    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR,
      lignes: [
        {
          ingredientId: idIngredient,
          quantite: 100_000,
          prixLigneCents: 10_000,
          numeroLotFournisseur: 'LOT-TEST-ETIQUETTE',
        },
      ],
    });

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(routesDocuments(base), { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // DEFAUT CORRIGÉ (diagnostic du 31/07/2026, voir `smoke-routes-lecture.test.ts`
  // et `documents/rendu.test.ts`) : le chemin nominal ci-dessous rend un vrai
  // PDF (étiquette de bac) et lance donc Chromium (`obtenirNavigateur`, dans
  // `documents/rendu.ts`) — mais jusqu'ici, RIEN dans ce fichier ne le
  // refermait, contrairement à tous les autres fichiers qui produisent un PDF.
  // Sous `pool: forks`, un worker Vitest traite plusieurs fichiers de suite
  // dans le MÊME processus : une instance Chromium ainsi jamais fermée reste
  // un processus natif vivant pour tout le reste de la vie de ce worker,
  // s'ajoutant à la contention subie par les fichiers suivants qui, eux,
  // lancent et ferment la leur.
  afterAll(async () => {
    await fermerNavigateur();
  });

  it('édite l’étiquette d’une production ACTIVE (chemin nominal)', async () => {
    const resultat = lancerProduction(base, {
      recetteId: idRecette,
      cible: { type: 'volume', volumeMl: 5000 },
      dateProduction: JOUR,
    });

    const reponse = await app.inject({
      method: 'GET',
      url: `/api/documents/etiquette-bac/${resultat.productionId}`,
    });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.headers['content-type']).toBe('application/pdf');
  });

  it(
    'refuse en 422 l’étiquette d’une production ANNULÉE : ce bac désignerait un lot qui ' +
      'n’aurait jamais dû exister (CLAUDE.md §3 règle 6)',
    async () => {
      const resultat = lancerProduction(base, {
        recetteId: idRecette,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR,
      });
      annulerProduction(base, resultat.productionId, 'ERREUR_SAISIE');

      const reponse = await app.inject({
        method: 'GET',
        url: `/api/documents/etiquette-bac/${resultat.productionId}`,
      });

      expect(reponse.statusCode).toBe(422);
      const corps = reponse.json<ReponseErreur>();
      expect(corps.erreur.code).toBe('production_annulee');
      // Le message doit dire POURQUOI, en français directement affichable
      // (docs/06) — pas seulement « refusé ».
      expect(corps.erreur.message).toContain('jamais dû exister');
    },
  );

  it('rend 404 pour une production inexistante — l’URL adresse une ressource absente, pas un statut invalide', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/documents/etiquette-bac/production-fantome',
    });

    expect(reponse.statusCode).toBe(404);
  });
});

/**
 * `GET /api/documents/fiche-rappel/:lot` (mission du 01/08/2026).
 *
 * Le contenu du DOCUMENT (le tableau de traçabilité, l'échappement, la
 * pagination réelle) est déjà prouvé, ligne par ligne, dans
 * `documents/fiche-rappel.test.ts` — sur la chaîne complète
 * `tracabiliteAvalLot -> donneesFicheRappelLot -> ficheRappelLot`. Ce fichier
 * ne re-teste donc PAS ce contenu : il vérifie le CÂBLAGE propre à cette
 * route — celui qu'aucun de ces trois niveaux ne peut prouver seul :
 *   - la résolution par NUMÉRO FOURNISSEUR à travers le VRAI serveur HTTP ;
 *   - D-035 (404 sur un lot inconnu, ressource adressée dans l'URL) ;
 *   - qu'un lot sans aucune production n'est PAS une erreur (200) ;
 *   - et surtout la décision propre à cette route : `objetId` d'archivage =
 *     l'identifiant TECHNIQUE résolu, jamais la chaîne brute de l'URL — sans
 *     quoi consulter le même lot une fois par son numéro fournisseur puis une
 *     fois par son identifiant technique ouvrirait deux historiques de
 *     version distincts au lieu d'une v1 puis d'une v2 continues (D-026).
 */
describe('GET /api/documents/fiche-rappel/:lot', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idFournisseur: string;
  let idLieu: string;
  let idR1: string;

  const JOUR_RAPPEL = '2034-02-10';

  beforeEach(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    idR1 = base.select({ id: recette.id }).from(recette).where(eq(recette.code, 'R1')).get()!.id;
    idFournisseur = base
      .select({ id: fournisseur.id })
      .from(fournisseur)
      .where(eq(fournisseur.nom, '[démo] Fournisseur générique'))
      .get()!.id;
    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(routesDocuments(base), { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // Même raison que le bloc étiquette-bac ci-dessus : le chemin nominal rend
  // un vrai PDF via Chromium, jamais refermé sans ce hook.
  afterAll(async () => {
    await fermerNavigateur();
  });

  /** Approvisionne tous les ingrédients de R1 SAUF la farine — celle-ci reçoit sa propre réception, ciblée, par test. */
  function approvisionnerSaufFarine(): void {
    const autres = base
      .select()
      .from(ingredient)
      .all()
      .filter((i) => i.nom !== 'Farine de froment T55');
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR_RAPPEL,
      lignes: autres.map((ing) => ({
        ingredientId: ing.id,
        quantite: 100_000,
        prixLigneCents: 1000,
        numeroLotFournisseur: 'LOT-AUTRES-ROUTE',
      })),
    });
  }

  function receptionnerFarine(numeroLotFournisseur: string): { lotId: string } {
    const farine = base
      .select()
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!;
    const resultat = enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: JOUR_RAPPEL,
      lignes: [
        { ingredientId: farine.id, quantite: 100_000, prixLigneCents: 1000, numeroLotFournisseur },
      ],
    });
    return { lotId: resultat.lotsCrees[0]!.lotId };
  }

  it(
    'édite la fiche en résolvant le NUMÉRO FOURNISSEUR — ce que porte un avis de rappel ' +
      'réel, jamais l’identifiant technique — et archive sous CET identifiant technique',
    async () => {
      approvisionnerSaufFarine();
      const { lotId } = receptionnerFarine('LOT-RAPPEL-ROUTE-0001');
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR_RAPPEL });
      lancerProduction(base, {
        recetteId: idR1,
        cible: { type: 'volume', volumeMl: 5000 },
        dateProduction: JOUR_RAPPEL,
        sessionId: session.id,
      });

      const reponse = await app.inject({
        method: 'GET',
        url: '/api/documents/fiche-rappel/LOT-RAPPEL-ROUTE-0001',
      });

      expect(reponse.statusCode).toBe(200);
      expect(reponse.headers['content-type']).toBe('application/pdf');

      // Archivé sous l'identifiant TECHNIQUE du lot (`lotId`), PAS sous la
      // chaîne brute reçue dans l'URL (`LOT-RAPPEL-ROUTE-0001`) — voir le
      // commentaire de la route dans `routes/documents.ts`.
      const versions = versionsDocument(base, 'fiche_rappel', lotId);
      expect(versions).toHaveLength(1);
      expect(versions[0]?.numero).toBe('LOT-RAPPEL-ROUTE-0001');
    },
  );

  it(
    'une seconde édition du MÊME lot, cette fois par son IDENTIFIANT TECHNIQUE, crée la ' +
      'VERSION 2 — jamais une v1 parallèle sous un objetId différent',
    async () => {
      const { lotId } = receptionnerFarine('LOT-RAPPEL-ROUTE-0002');

      const premiere = await app.inject({
        method: 'GET',
        url: '/api/documents/fiche-rappel/LOT-RAPPEL-ROUTE-0002',
      });
      expect(premiere.statusCode).toBe(200);

      const seconde = await app.inject({
        method: 'GET',
        url: `/api/documents/fiche-rappel/${lotId}`,
      });
      expect(seconde.statusCode).toBe(200);

      const versions = versionsDocument(base, 'fiche_rappel', lotId);
      expect(versions).toHaveLength(2);
      expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
      // La v1 reste intacte sur disque, jamais écrasée (D-026) : deux chemins
      // de fichier distincts.
      expect(versions[0]?.chemin).not.toBe(versions[1]?.chemin);
    },
  );

  it('rend 404 pour un lot inconnu — l’URL adresse une ressource absente (D-035)', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/documents/fiche-rappel/lot-fantome-rappel',
    });

    expect(reponse.statusCode).toBe(404);
  });

  it(
    'édite quand même la fiche d’un lot qui n’a alimenté AUCUNE production — ce n’est pas ' +
      'une erreur, c’est une réponse (CLAUDE.md §7)',
    async () => {
      receptionnerFarine('LOT-JAMAIS-UTILISE-ROUTE-0001');

      const reponse = await app.inject({
        method: 'GET',
        url: '/api/documents/fiche-rappel/LOT-JAMAIS-UTILISE-ROUTE-0001',
      });

      expect(reponse.statusCode).toBe(200);
      expect(reponse.headers['content-type']).toBe('application/pdf');
    },
  );
});
