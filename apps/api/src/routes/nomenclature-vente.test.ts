/**
 * Tests des routes de la nomenclature de vente (fiche 15).
 *
 * Le serveur est construit A LA MAIN plutot que par `construireServeur`, pour
 * n'enregistrer QUE les plugins dont ce fichier a besoin (referentiel de
 * lecture/ecriture + nomenclature de vente) — pas parce que le cablage dans
 * `serveur.ts` manquerait : il est fait (`routesNomenclatureVente` y est
 * enregistre). Meme convention allegee que `routes/referentiel-ecriture.test.ts`.
 *
 * Aucune valeur metier n'est figee en dur : ingredients et produit sont CREES
 * par le test, jamais empruntes a une graine.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { creerBase, migrer, seed, type BaseBatte } from '@batte/db';
import type { ComposantVente, IngredientComplet, ListeComposantsVente, Produit } from '@batte/core';
import { enregistrerGestionnaireErreurs } from '../plugins/erreurs.js';
import { routesReferentiel } from './referentiel.js';
import { routesReferentielEcriture } from './referentiel-ecriture.js';
import { routesNomenclatureVente } from './nomenclature-vente.js';

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

describe('routes de la nomenclature de vente', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idFournisseur: string;
  let idCannelle: string;
  let idGobelet: string;
  let idProduit: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(
      async (api) => {
        await api.register(routesReferentiel(base));
        await api.register(routesReferentielEcriture(base));
        await api.register(routesNomenclatureVente(base));
      },
      { prefix: '/api' },
    );
    await app.ready();

    const fournisseur = await app.inject({
      method: 'POST',
      url: '/api/fournisseurs',
      payload: {
        nom: 'Épicerie de gros',
        type: 'grossiste',
        email: null,
        telephone: null,
        adresse: null,
        delaiLivraisonJours: 2,
        francoDePortCents: null,
        commandeMinimumCents: null,
        notes: null,
      },
    });
    idFournisseur = fournisseur.json<{ id: string }>().id;

    const cannelle = await app.inject({
      method: 'POST',
      url: '/api/ingredients',
      payload: {
        nom: 'Cannelle',
        categorie: 'sucre',
        uniteReference: 'g',
        densiteGParMl: null,
        allergenes: [],
        stockSecurite: 0,
        delaiLivraisonJours: null,
        dureeConservationJours: null,
        notes: null,
      },
    });
    idCannelle = cannelle.json<IngredientComplet>().id;

    // Prix RÉEL pour la cannelle (01/08/2026). Sans conditionnement actif, son
    // coût indicatif vaut désormais `null` — « jamais acheté », et non plus un
    // `0` commode : c'est exactement le défaut « inconnu = gratuit » corrigé ce
    // jour-là. L'assertion ci-dessous exigeait `>= 0`, donc elle passait
    // TRIVIALEMENT sur ce zéro et ne démontrait aucun prix. Lui donner un vrai
    // conditionnement rend le test capable de prouver ce qu'il annonce.
    await app.inject({
      method: 'POST',
      url: '/api/conditionnements',
      payload: {
        ingredientId: idCannelle,
        fournisseurId: idFournisseur,
        libelle: 'Boîte 500 g',
        quantiteUniteRef: 500,
        prixCents: 960,
        referenceFournisseur: null,
        datePrix: '2026-01-15',
      },
    });

    const gobelet = await app.inject({
      method: 'POST',
      url: '/api/ingredients',
      payload: {
        nom: 'Gobelet carton',
        categorie: 'consommable',
        uniteReference: 'piece',
        densiteGParMl: null,
        allergenes: [],
        stockSecurite: 0,
        delaiLivraisonJours: null,
        dureeConservationJours: null,
        notes: null,
      },
    });
    idGobelet = gobelet.json<IngredientComplet>().id;

    const produit = await app.inject({
      method: 'POST',
      url: '/api/produits',
      payload: {
        nom: 'Café à emporter',
        nature: 'revendu',
        recetteId: null,
        ingredientId: idGobelet,
        prixCents: 250,
        nbCrepes: null,
        categorie: 'boisson',
        consommationSurPlace: false,
      },
    });
    idProduit = produit.json<Produit>().id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rend une liste vide pour un produit sans aucun composant declare', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: `/api/produits/${idProduit}/composants`,
    });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json<ListeComposantsVente>()).toEqual({ data: [], meta: { total: 0 } });
  });

  it('déclare un composant à petite quantité (« pour 100 cafés : 20 g de cannelle »)', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/produits/${idProduit}/composants`,
      payload: {
        ingredientId: idCannelle,
        quantiteUniteRef: 20,
        quantiteReferenceUnites: 100,
        consommationSurPlace: null,
      },
    });

    expect(reponse.statusCode).toBe(201);
    const composant = reponse.json<ComposantVente>();
    expect(composant.quantiteUniteRef).toBe(20);
    expect(composant.quantiteReferenceUnites).toBe(100);
    expect(composant.consommationSurPlace).toBeNull();
    expect(composant.actif).toBe(true);
    // Par defaut, un composant est TOUJOURS applique (pas une option).
    expect(composant.optionnel).toBe(false);
    // Cout indicatif jamais arrondi a zero, meme pour une tres petite quantite :
    // c'est le premier signal visuel qui apprend la regle du lot de reference.
    // `toBeGreaterThanOrEqual(0)` ne prouvait rien tant qu'un prix inconnu
    // valait `0` — il passait sur l'absence de prix aussi bien que sur un vrai.
    expect(composant.coutIndicatifCentsParUnite).not.toBeNull();
    expect(composant.coutIndicatifCentsParUnite).toBeGreaterThan(0);
  });

  it('le lot de référence par défaut vaut 1 (un gobelet par café)', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/produits/${idProduit}/composants`,
      payload: { ingredientId: idGobelet, quantiteUniteRef: 1, consommationSurPlace: null },
    });

    expect(reponse.statusCode).toBe(201);
    expect(reponse.json<ComposantVente>().quantiteReferenceUnites).toBe(1);
  });

  it('liste ensuite les deux composants déclarés, triés par nom d’ingrédient', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: `/api/produits/${idProduit}/composants`,
    });

    const corps = reponse.json<ListeComposantsVente>();
    expect(corps.meta.total).toBe(2);
    expect(corps.data.map((c) => c.nomIngredient)).toEqual(['Cannelle', 'Gobelet carton']);
  });

  // À partir d'ici, les tests suivants ajoutent librement des composants au
  // même produit : plus aucun test en aval ne vérifie un TOTAL exact (D-035,
  // même convention que le reste de ce fichier).
  it('déclare une OPTION (la crème, servie seulement sur demande) via `optionnel: true`', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/produits/${idProduit}/composants`,
      payload: {
        ingredientId: idGobelet,
        quantiteUniteRef: 1,
        consommationSurPlace: null,
        optionnel: true,
      },
    });

    expect(reponse.statusCode).toBe(201);
    const composant = reponse.json<ComposantVente>();
    expect(composant.optionnel).toBe(true);

    // Une correction (PATCH) doit pouvoir revenir sur la déclaration d'option.
    const modifie = await app.inject({
      method: 'PATCH',
      url: `/api/composants/${composant.id}`,
      payload: {
        ingredientId: idGobelet,
        quantiteUniteRef: 1,
        consommationSurPlace: null,
        optionnel: false,
      },
    });
    expect(modifie.json<ComposantVente>().optionnel).toBe(false);
  });

  it("404 : le produit adressé dans l'URL n'existe pas", async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/produits/produit-inexistant/composants',
      payload: { ingredientId: idCannelle, quantiteUniteRef: 1, consommationSurPlace: null },
    });

    expect(reponse.statusCode).toBe(404);
  });

  it("422 avec champs : l'ingrédient saisi n'existe pas", async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/produits/${idProduit}/composants`,
      payload: {
        ingredientId: 'ingredient-inexistant',
        quantiteUniteRef: 1,
        consommationSurPlace: null,
      },
    });

    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.champs).toHaveProperty('ingredientId');
  });

  it('422 : une quantité négative ou nulle est refusée avant toute écriture', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/produits/${idProduit}/composants`,
      payload: { ingredientId: idCannelle, quantiteUniteRef: 0, consommationSurPlace: null },
    });

    expect(reponse.statusCode).toBe(422);
  });

  it('corrige un composant existant (PATCH)', async () => {
    const cree = await app.inject({
      method: 'POST',
      url: `/api/produits/${idProduit}/composants`,
      payload: {
        ingredientId: idCannelle,
        quantiteUniteRef: 10,
        quantiteReferenceUnites: 50,
        consommationSurPlace: null,
      },
    });
    const id = cree.json<ComposantVente>().id;

    const modifie = await app.inject({
      method: 'PATCH',
      url: `/api/composants/${id}`,
      payload: {
        ingredientId: idCannelle,
        quantiteUniteRef: 25,
        quantiteReferenceUnites: 100,
        consommationSurPlace: null,
      },
    });

    expect(modifie.statusCode).toBe(200);
    const corps = modifie.json<ComposantVente>();
    expect(corps.quantiteUniteRef).toBe(25);
    expect(corps.quantiteReferenceUnites).toBe(100);
  });

  it('désactive puis réactive un composant — jamais de suppression', async () => {
    const cree = await app.inject({
      method: 'POST',
      url: `/api/produits/${idProduit}/composants`,
      payload: { ingredientId: idGobelet, quantiteUniteRef: 1, consommationSurPlace: false },
    });
    const id = cree.json<ComposantVente>().id;

    const desactive = await app.inject({
      method: 'PATCH',
      url: `/api/composants/${id}/activite`,
      payload: { actif: false },
    });
    expect(desactive.statusCode).toBe(200);
    expect(desactive.json<ComposantVente>().actif).toBe(false);

    // Toujours présent dans la liste : on désactive, on ne supprime jamais.
    const liste = await app.inject({ method: 'GET', url: `/api/produits/${idProduit}/composants` });
    expect(liste.json<ListeComposantsVente>().data.some((c) => c.id === id)).toBe(true);

    const reactive = await app.inject({
      method: 'PATCH',
      url: `/api/composants/${id}/activite`,
      payload: { actif: true },
    });
    expect(reactive.json<ComposantVente>().actif).toBe(true);
  });

  it('consommationSurPlace : true et false sont conservés distinctement de null', async () => {
    const surPlace = await app.inject({
      method: 'POST',
      url: `/api/produits/${idProduit}/composants`,
      payload: { ingredientId: idGobelet, quantiteUniteRef: 1, consommationSurPlace: true },
    });
    expect(surPlace.json<ComposantVente>().consommationSurPlace).toBe(true);

    const emporte = await app.inject({
      method: 'POST',
      url: `/api/produits/${idProduit}/composants`,
      payload: { ingredientId: idGobelet, quantiteUniteRef: 1, consommationSurPlace: false },
    });
    expect(emporte.json<ComposantVente>().consommationSurPlace).toBe(false);
  });
});
