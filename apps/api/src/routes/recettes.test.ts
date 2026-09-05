import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { creerBase, migrer, seed, seedDemonstration, type BaseBatte } from '@batte/db';
import type { ListeRecettes, RecetteDetail, ResultatCalcul } from '@batte/core';
import { construireServeur } from '../serveur.js';

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

describe('routes /api/recettes', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idR1: string;
  let idR2: string;

  beforeAll(async () => {
    // Base en memoire : ces tests ne touchent ni le fichier du poste de travail,
    // ni le dossier de sauvegardes.
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    app = construireServeur(base, { journaliser: false });
    await app.ready();

    const liste = (await app.inject({ method: 'GET', url: '/api/recettes' })).json<ListeRecettes>();
    idR1 = liste.data.find((r) => r.code === 'R1')!.id;
    idR2 = liste.data.find((r) => r.code === 'R2')!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('liste les recettes du jeu de demonstration', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/recettes' });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ListeRecettes>();
    // `CAFE-VIDE` depuis le 31/07/2026 : le cafe est un `transforme` dont la
    // composition vient ENTIEREMENT de la nomenclature de vente (fiche 15 §4),
    // mais `verifierCoherenceProduit` exige qu'un `transforme` porte une
    // recette. Le porteur a tranche pour une recette VIDE, jamais activee, dont
    // le seul role est de satisfaire cette regle — d'ou une troisieme recette
    // au catalogue de demonstration, sans ligne et sans production possible.
    expect(corps.meta.total).toBe(3);
    expect(corps.data.map((r) => r.code).sort()).toEqual(['CAFE-VIDE', 'R1', 'R2']);
  });

  it('rend null et non zero pour le cout d une recette vide', async () => {
    // « 0,00 € » sur une recette sans ingredient serait un chiffre faux
    // presente comme une donnee.
    const corps = (await app.inject({ method: 'GET', url: '/api/recettes' })).json<ListeRecettes>();

    const r2 = corps.data.find((r) => r.code === 'R2')!;
    expect(r2.nbLignes).toBe(0);
    expect(r2.coutParCrepeCents).toBeNull();
  });

  it('detaille R1 avec ses 8 lignes issues de CLAUDE.md §6', async () => {
    const reponse = await app.inject({ method: 'GET', url: `/api/recettes/${idR1}` });

    expect(reponse.statusCode).toBe(200);
    const detail = reponse.json<RecetteDetail>();
    expect(detail.code).toBe('R1');
    expect(detail.lignes).toHaveLength(8);
    // Rendement retenu par la decision D-014 : 455 ml pour 6 crepes.
    expect(detail.rendementReferenceMl).toBe(455);
    expect(detail.rendementReferenceCrepes).toBe(6);
  });

  it('met R1 a l echelle de 200 crepes vendables', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/recettes/${idR1}/calculer`,
      payload: { cible: 'crepes', valeur: 200 },
    });

    expect(reponse.statusCode).toBe(200);
    const resultat = reponse.json<ResultatCalcul>();
    expect(resultat.crepesVendables).toBe(200);
    expect(resultat.lignes).toHaveLength(8);
    // Sans perte declaree, 200 crepes a ~76 ml font ~15,2 L.
    expect(resultat.volumeMl).toBeGreaterThan(15_000);
    expect(resultat.volumeMl).toBeLessThan(15_400);
    expect(resultat.allergenes).toEqual(['gluten', 'lait', 'oeufs']);
  });

  it('met R1 a l echelle depuis un ingredient limitant', async () => {
    const detail = (
      await app.inject({ method: 'GET', url: `/api/recettes/${idR1}` })
    ).json<RecetteDetail>();
    const farine = detail.lignes.find((l) => l.nomIngredient.includes('Farine'))!;

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/recettes/${idR1}/calculer`,
      payload: { cible: 'ingredient', valeur: 4000, ingredientId: farine.ingredientId },
    });

    expect(reponse.statusCode).toBe(200);
    const resultat = reponse.json<ResultatCalcul>();
    // 4 kg de farine consommes exactement : c'est la question « il me reste
    // 4 kg de farine, ca me fait combien ? » de docs/01 module 1.
    const ligneFarine = resultat.lignes.find((l) => l.ingredientId === farine.ingredientId)!;
    expect(ligneFarine.quantite).toBe(4000);
  });

  it('refuse de calculer une recette vide, avec un message francais', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/recettes/${idR2}/calculer`,
      payload: { cible: 'crepes', valeur: 50 },
    });

    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('recette_vide');
    expect(corps.erreur.message).toContain('R2');
  });

  it('renvoie 404 sur une recette inexistante', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/recettes/inexistante' });

    expect(reponse.statusCode).toBe(404);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('introuvable');
  });

  it('refuse une quantite nulle ou negative', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/recettes/${idR1}/calculer`,
      payload: { cible: 'crepes', valeur: -5 },
    });

    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('validation');
    expect(corps.erreur.champs).toHaveProperty('valeur');
  });

  it('refuse une cible ingredient sans identifiant', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/recettes/${idR1}/calculer`,
      payload: { cible: 'ingredient', valeur: 4000 },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.code).toBe('validation');
  });
});
