/**
 * Routes `/api/productions` — les trois gestes que rien n'exerçait par HTTP.
 *
 * Le lancement et la saisie du réalisé étaient déjà couverts par les parcours.
 * Trois chemins ne l'étaient pas, et ce sont ceux qui CORRIGENT :
 *
 *  - `POST /productions/:id/annuler` : contrepasse les mouvements de stock
 *    d'une fournée lancée par erreur. Sans lui, le stock consommé restait
 *    définitivement engagé (voir le commentaire de la route). Le motif y est
 *    obligatoire et résolu contre le catalogue AVANT d'entrer en base — un
 *    motif inconnu doit ressortir en 422 de SAISIE, pas en erreur interne.
 *  - `PATCH /productions/:id/session` : rattache (ou détache) une fournée
 *    après coup. C'est ce rattachement qui décide si le coût de la pâte entre
 *    dans la marge d'une session.
 *  - la cible « volume », l'autre moitié de `versCibleMetier` : toute la suite
 *    passait par la cible « crêpes ».
 *
 * Les valeurs de la graine ne sont JAMAIS assertées en absolu : le stock est
 * construit ici par la vraie chaîne HTTP, et les assertions portent sur des
 * écarts ou des statuts.
 */

import { creerBase, migrer, seed, seedDemonstration, type BaseBatte } from '@batte/db';
import type {
  AnnulationProductionCreee,
  Faisabilite,
  ListeFournisseurs,
  ListeIngredients,
  ListeLieux,
  ListeRecettesReferentiel,
  ProductionDetail,
  SessionDetail,
} from '@batte/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { construireServeur } from '../serveur.js';

type ReponseErreur = { erreur: { code: string; message: string; champs?: Record<string, string> } };

describe('routes /api/productions — annulation, rattachement, cible volume', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let recetteId: string;
  let lieuId: string;

  const JOUR = '2026-03-15';

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();

    const recettes = (
      await app.inject({ method: 'GET', url: '/api/referentiel/recettes' })
    ).json<ListeRecettesReferentiel>();
    const active = recettes.data.find((r) => r.statut === 'active');
    if (active === undefined) throw new Error('Aucune recette active dans la graine.');
    recetteId = active.id;

    const lieux = (await app.inject({ method: 'GET', url: '/api/lieux' })).json<ListeLieux>();
    const premier = lieux.data[0];
    if (premier === undefined) throw new Error('Aucun lieu de marché dans la graine.');
    lieuId = premier.id;

    // Stock : une réception généreuse de CHAQUE ingrédient de la recette, par
    // le vrai chemin d'entrée. Sans cela, `lancerProduction` refuserait pour
    // stock insuffisant et l'on testerait ce refus-là, pas l'annulation.
    const fournisseurs = (
      await app.inject({ method: 'GET', url: '/api/fournisseurs' })
    ).json<ListeFournisseurs>();
    const fournisseur = fournisseurs.data.find((f) => f.type !== 'systeme');
    const ingredients = (
      await app.inject({ method: 'GET', url: '/api/ingredients' })
    ).json<ListeIngredients>();
    if (fournisseur === undefined) throw new Error('Aucun fournisseur commercial dans la graine.');

    const reception = await app.inject({
      method: 'POST',
      url: '/api/receptions',
      payload: {
        fournisseurId: fournisseur.id,
        dateReception: '2026-03-01',
        lignes: ingredients.data.map((ing, index) => ({
          ingredientId: ing.id,
          quantite: 500_000,
          prixLigneCents: 10_000,
          numeroLotFournisseur: `LOT-PROD-${index}`,
        })),
      },
    });
    expect(reception.statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Lance une fournée et rend son détail. */
  async function lancer(cible: { cible: 'crepes' | 'volume'; valeur: number }) {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/productions',
      payload: { recetteId, cible, dateProduction: JOUR },
    });
    expect(reponse.statusCode).toBe(201);
    return reponse.json<ProductionDetail>();
  }

  it('accepte une cible exprimée en VOLUME, pas seulement en crêpes', async () => {
    // `versCibleMetier` traduit la cible HTTP (plate) vers la cible métier.
    // Sa branche « volume » n'était empruntée par aucun test.
    const faisabilite = await app.inject({
      method: 'POST',
      url: '/api/productions/faisabilite',
      payload: { recetteId, cible: { cible: 'volume', valeur: 5000 }, dateProduction: JOUR },
    });
    expect(faisabilite.statusCode).toBe(200);
    const corps = faisabilite.json<Faisabilite>();
    expect(corps.volumeMl).toBe(5000);
    // Discrimine : une traduction qui aurait lu la valeur comme des crêpes
    // produirait un volume tout autre que celui demandé.
    expect(corps.crepes).toBeGreaterThan(0);
    expect(corps.faisable).toBe(true);
  });

  /**
   * LA FRONTIÈRE HTTP, dans les deux sens (docs/39 §5).
   *
   * `coutReelCents` / `quantiteMouvementee` / `coutMatiereReelNonAffecteCents`
   * sont déclarés `.optional()` au contrat Zod — non par choix, mais parce que
   * les fixtures de `apps/web` ne pouvaient pas être modifiées par la mission
   * qui les a ajoutés. Un champ optionnel que le dépôt cesserait de fournir
   * disparaîtrait donc SANS 422 : exactement la suppression silencieuse qui a
   * coûté trois fois le 01/08/2026. Ce test vérifie la PRÉSENCE de la clé dans
   * le JSON réellement servi, la seule garde qui reste une fois `.optional()`
   * posé — `toHaveProperty` et non une comparaison de valeur, parce que c'est
   * bien la disparition qu'on surveille, pas le chiffre (mesuré ailleurs).
   */
  it('sert le coût réel PAR LIGNE sur le détail, et la somme des lignes fait le total', async () => {
    const lancee = await lancer({ cible: 'crepes', valeur: 40 });

    // Avant réalisé : la clé EXISTE et vaut `null` — « pas encore mesuré »,
    // ce qui n'est pas la même chose qu'un champ absent.
    expect(lancee).toHaveProperty('coutMatiereReelNonAffecteCents', null);
    for (const ligne of lancee.consommations) {
      expect(ligne).toHaveProperty('coutReelCents', null);
      expect(ligne).toHaveProperty('quantiteMouvementee', null);
    }

    const realise = await app.inject({
      method: 'PATCH',
      url: `/api/productions/${lancee.id}/realise`,
      payload: { volumeReelMl: 2800, crepesReelles: 37 },
    });
    expect(realise.statusCode).toBe(200);

    const apres = realise.json<ProductionDetail>();
    expect(apres.coutMatiereReelCents).not.toBeNull();
    const somme = apres.consommations.reduce((total, c) => total + (c.coutReelCents ?? 0), 0);
    expect(apres.consommations.every((c) => c.coutReelCents !== null)).toBe(true);
    expect(somme + apres.coutMatiereReelNonAffecteCents!).toBe(apres.coutMatiereReelCents);
  });

  it('lance puis ANNULE une production : le statut bascule et les mouvements sont contrepassés', async () => {
    const production = await lancer({ cible: 'crepes', valeur: 60 });
    expect(production.statut).not.toBe('annulee');

    const annulation = await app.inject({
      method: 'POST',
      url: `/api/productions/${production.id}/annuler`,
      payload: { motifCode: 'ERREUR_SAISIE' },
    });
    expect(annulation.statusCode).toBe(201);
    const corps = annulation.json<AnnulationProductionCreee>();
    expect(corps.productionId).toBe(production.id);
    expect(corps.numero).toBe(production.numero);
    // Règle 5 et règle 7 : le stock revient par des CONTREPASSATIONS, pas par
    // une suppression de mouvements. Il doit donc y en avoir au moins autant
    // que d'ingrédients consommés.
    expect(corps.nbMouvementsContrepasses).toBeGreaterThan(0);

    const apres = (
      await app.inject({ method: 'GET', url: `/api/productions/${production.id}` })
    ).json<ProductionDetail>();
    expect(apres.statut).toBe('annulee');
  });

  it('refuse un motif d’annulation absent du catalogue, en 422 de SAISIE', async () => {
    const production = await lancer({ cible: 'crepes', valeur: 30 });
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/productions/${production.id}/annuler`,
      payload: { motifCode: 'MOTIF_QUI_NEXISTE_PAS' },
    });

    // 422 et non 500 : le motif vient d'une liste déroulante de formulaire.
    expect(reponse.statusCode).toBe(422);
    const erreur = reponse.json<ReponseErreur>();
    expect(erreur.erreur.code).toBe('motif_inconnu');
    expect(erreur.erreur.champs).toHaveProperty('motifCode');

    // Et surtout : la production n'a PAS été annulée au passage.
    const apres = (
      await app.inject({ method: 'GET', url: `/api/productions/${production.id}` })
    ).json<ProductionDetail>();
    expect(apres.statut).not.toBe('annulee');
  });

  it('rattache une production à une session APRÈS coup, puis l’en détache', async () => {
    const production = await lancer({ cible: 'crepes', valeur: 40 });
    // Discrimine : la production naît NON rattachée. Sans ce constat, un
    // rattachement déjà présent rendrait le test aveugle.
    expect(production.sessionId).toBeNull();
    expect(production.sessionNumero).toBeNull();

    const session = (
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { lieuId, dateSession: JOUR },
      })
    ).json<SessionDetail>();

    const rattachee = await app.inject({
      method: 'PATCH',
      url: `/api/productions/${production.id}/session`,
      payload: { sessionId: session.id },
    });
    expect(rattachee.statusCode).toBe(200);
    const corps = rattachee.json<ProductionDetail>();
    expect(corps.sessionId).toBe(session.id);
    // Le NUMÉRO lisible, jamais un UUID à l'écran.
    expect(corps.sessionNumero).toBe(session.numero);

    const detachee = await app.inject({
      method: 'PATCH',
      url: `/api/productions/${production.id}/session`,
      payload: { sessionId: null },
    });
    expect(detachee.statusCode).toBe(200);
    expect(detachee.json<ProductionDetail>().sessionId).toBeNull();
  });

  it('refuse de rattacher une production à une session inexistante', async () => {
    const production = await lancer({ cible: 'crepes', valeur: 20 });
    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/productions/${production.id}/session`,
      payload: { sessionId: 'session-qui-nexiste-pas' },
    });
    expect(reponse.statusCode).toBeGreaterThanOrEqual(400);
    expect(reponse.statusCode).toBeLessThan(500);
  });

  it('rend 404 sur l’annulation d’une production inexistante', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/productions/production-inexistante/annuler',
      payload: { motifCode: 'ERREUR_SAISIE' },
    });
    expect(reponse.statusCode).toBe(404);
  });
});
