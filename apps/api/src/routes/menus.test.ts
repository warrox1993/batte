/**
 * Tests des routes des menus (fiche 16 §2).
 *
 * Le serveur est construit À LA MAIN plutôt que par `construireServeur` : ce
 * plugin n'est pas encore enregistré dans `serveur.ts` (câblage à faire, voir
 * le rapport de livraison de cet agent), et un test qui attendrait ce câblage
 * serait vert par absence — même raisonnement que
 * `routes/nomenclature-vente.test.ts` et `routes/referentiel-ecriture.test.ts`.
 *
 * Fournisseur, ingrédient, conditionnement et recette sont insérés
 * DIRECTEMENT via Drizzle (comme `depots/menus.test.ts`) : seuls les produits
 * et les menus passent par l'API, qui est ce que ce fichier teste réellement.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  conditionnement,
  creerBase,
  fournisseur,
  ingredient,
  migrer,
  recette,
  recetteLigne,
  type BaseBatte,
} from '@batte/db';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import type {
  CompositionMenu,
  ListeCompositionMenu,
  ListeMenus,
  Produit,
  VentilationMenuContrat,
} from '@batte/core';
import { enregistrerGestionnaireErreurs } from '../plugins/erreurs.js';
import { routesReferentiel } from './referentiel.js';
import { routesMenus } from './menus.js';

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

describe('routes des menus', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idCrepe: string;
  let idCafe: string;
  let idSirop: string;
  let idTopping: string;

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);

    const maintenant = maintenantUtc();
    const idFournisseur = nouvelIdentifiant();
    base
      .insert(fournisseur)
      .values({
        id: idFournisseur,
        nom: 'Grossiste test',
        type: 'grossiste',
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const idFarine = nouvelIdentifiant();
    base
      .insert(ingredient)
      .values({
        id: idFarine,
        nom: 'Farine test',
        categorie: 'farine',
        uniteReference: 'g',
        allergenes: [],
        stockSecurite: 0,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    base
      .insert(conditionnement)
      .values({
        id: nouvelIdentifiant(),
        ingredientId: idFarine,
        fournisseurId: idFournisseur,
        libelle: 'Sac test',
        quantiteUniteRef: 1000,
        prixCents: 100,
        datePrix: maintenant,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const idIngredientSirop = nouvelIdentifiant();
    base
      .insert(ingredient)
      .values({
        id: idIngredientSirop,
        nom: 'Sirop test',
        categorie: 'garniture',
        uniteReference: 'g',
        allergenes: [],
        stockSecurite: 0,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    base
      .insert(conditionnement)
      .values({
        id: nouvelIdentifiant(),
        ingredientId: idIngredientSirop,
        fournisseurId: idFournisseur,
        libelle: 'Pot test',
        quantiteUniteRef: 1,
        prixCents: 280,
        datePrix: maintenant,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const idRecette = nouvelIdentifiant();
    base
      .insert(recette)
      .values({
        id: idRecette,
        code: 'RC',
        nom: 'Crêpe test',
        version: 1,
        statut: 'active',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 1000,
        rendementReferenceCrepes: 10,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: 0,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    base
      .insert(recetteLigne)
      .values({
        id: nouvelIdentifiant(),
        recetteId: idRecette,
        ingredientId: idFarine,
        quantiteUniteRef: 1000,
        ordre: 0,
      })
      .run();

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(
      async (api) => {
        await api.register(routesReferentiel(base));
        await api.register(routesMenus(base));
      },
      { prefix: '/api' },
    );
    await app.ready();

    const crepe = await app.inject({
      method: 'POST',
      url: '/api/produits',
      payload: {
        nom: 'Crêpe test',
        nature: 'transforme',
        recetteId: idRecette,
        ingredientId: null,
        prixCents: 350,
        consommationUnite: 'crepes',
        nbCrepes: 1,
        categorie: 'sucrée',
        consommationSurPlace: false,
      },
    });
    idCrepe = crepe.json<Produit>().id;

    const cafe = await app.inject({
      method: 'POST',
      url: '/api/produits',
      payload: {
        nom: 'Café test',
        nature: 'transforme',
        // Un produit `transforme` DOIT être rattaché à une recette
        // (`verifierCoherenceProduit`, `contrats/referentiel.ts`) : on réutilise
        // celle de la crêpe plutôt que d'en créer une seconde pour ce test.
        recetteId: idRecette,
        ingredientId: null,
        prixCents: 200,
        consommationUnite: 'crepes',
        nbCrepes: 1,
        categorie: 'boisson',
        consommationSurPlace: false,
      },
    });
    idCafe = cafe.json<Produit>().id;

    const sirop = await app.inject({
      method: 'POST',
      url: '/api/produits',
      payload: {
        nom: 'Pot sirop test',
        nature: 'revendu',
        recetteId: null,
        ingredientId: idIngredientSirop,
        prixCents: 400,
        nbCrepes: null,
        categorie: 'terroir',
        consommationSurPlace: false,
      },
    });
    idSirop = sirop.json<Produit>().id;

    const topping = await app.inject({
      method: 'POST',
      url: '/api/produits',
      payload: {
        nom: 'Topping test',
        nature: 'revendu',
        recetteId: null,
        ingredientId: idIngredientSirop,
        prixCents: 150,
        nbCrepes: null,
        categorie: 'terroir',
        consommationSurPlace: false,
      },
    });
    idTopping = topping.json<Produit>().id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rend une liste de menus vide tant qu’aucun produit n’a de composition', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/menus' });
    expect(reponse.statusCode).toBe(200);
    expect(reponse.json<ListeMenus>()).toEqual({ data: [], meta: { total: 0 } });
  });

  it('déclare un composant de menu (crêpe + café)', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/menus/${idCrepe}/composition`,
      payload: { produitInclusId: idCafe, quantite: 1 },
    });

    if (reponse.statusCode !== 201) expect(reponse.statusCode).toBe(201);
    const composant = reponse.json<CompositionMenu>();
    expect(composant.produitInclusId).toBe(idCafe);
    expect(composant.nomProduitInclus).toBe('Café test');
    expect(composant.nature).toBe('transforme');
    expect(composant.actif).toBe(true);
  });

  it('le menu apparaît désormais dans `GET /menus`', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/menus' });
    const corps = reponse.json<ListeMenus>();
    expect(corps.data.some((m) => m.id === idCrepe)).toBe(true);
    expect(corps.data.find((m) => m.id === idCrepe)?.nbComposantsActifs).toBe(1);
  });

  it("404 : le menu adressé dans l'URL n'existe pas", async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/menus/menu-inexistant/composition',
      payload: { produitInclusId: idCafe, quantite: 1 },
    });
    expect(reponse.statusCode).toBe(404);
  });

  it("422 avec champs : le produit inclus saisi n'existe pas", async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/menus/${idCrepe}/composition`,
      payload: { produitInclusId: 'produit-inexistant', quantite: 1 },
    });
    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.champs).toHaveProperty('produitInclusId');
  });

  it('422 : une quantité négative ou nulle est refusée avant toute écriture', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: `/api/menus/${idCrepe}/composition`,
      payload: { produitInclusId: idSirop, quantite: 0 },
    });
    expect(reponse.statusCode).toBe(422);
  });

  it('corrige un composant existant (PATCH)', async () => {
    const cree = await app.inject({
      method: 'POST',
      url: `/api/menus/${idCrepe}/composition`,
      payload: { produitInclusId: idSirop, quantite: 1 },
    });
    const id = cree.json<CompositionMenu>().id;

    const modifie = await app.inject({
      method: 'PATCH',
      url: `/api/composition-menu/${id}`,
      payload: { produitInclusId: idSirop, quantite: 3 },
    });

    expect(modifie.statusCode).toBe(200);
    expect(modifie.json<CompositionMenu>().quantite).toBe(3);
  });

  it('désactive puis réactive un composant — jamais de suppression', async () => {
    // `idTopping` : un produit encore neuf, distinct de `idSirop` déjà utilisé
    // par le test précédent — éviter le doublon (menu, produit inclus).
    const cree = await app.inject({
      method: 'POST',
      url: `/api/menus/${idCrepe}/composition`,
      payload: { produitInclusId: idTopping, quantite: 2 },
    });
    const id = cree.json<CompositionMenu>().id;

    const desactive = await app.inject({
      method: 'PATCH',
      url: `/api/composition-menu/${id}/activite`,
      payload: { actif: false },
    });
    expect(desactive.statusCode).toBe(200);
    expect(desactive.json<CompositionMenu>().actif).toBe(false);

    const liste = await app.inject({ method: 'GET', url: `/api/menus/${idCrepe}/composition` });
    expect(liste.json<ListeCompositionMenu>().data.some((c) => c.id === id)).toBe(true);

    const reactive = await app.inject({
      method: 'PATCH',
      url: `/api/composition-menu/${id}/activite`,
      payload: { actif: true },
    });
    expect(reactive.json<CompositionMenu>().actif).toBe(true);
  });

  describe('POST /menus/:menuId/ventilation', () => {
    it('ventile au prorata et la somme des parts vaut exactement le prix du menu', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: `/api/menus/${idCrepe}/ventilation`,
        payload: {},
      });

      expect(reponse.statusCode).toBe(200);
      const ventilation = reponse.json<VentilationMenuContrat>();
      expect(ventilation.prixMenuCents).toBe(350);
      const somme = ventilation.composants.reduce((a, c) => a + c.partPrixCents, 0);
      expect(somme).toBe(ventilation.prixMenuCents);
      expect(ventilation.parNatureCents.transforme + ventilation.parNatureCents.revendu).toBe(
        ventilation.prixMenuCents,
      );
    });

    it("applique la méthode DÉSIGNÉE via prixForcesCents, sans qu'aucun corps ne soit obligatoire par défaut", async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: `/api/menus/${idCrepe}/ventilation`,
        payload: { prixForcesCents: { [idSirop]: 250 } },
      });

      expect(reponse.statusCode).toBe(200);
      const ventilation = reponse.json<VentilationMenuContrat>();
      const ligneSirop = ventilation.composants.find((c) => c.produitInclusId === idSirop);
      if (ligneSirop !== undefined) {
        expect(ligneSirop.partPrixCents).toBe(250);
      }
      const somme = ventilation.composants.reduce((a, c) => a + c.partPrixCents, 0);
      expect(somme).toBe(ventilation.prixMenuCents);
    });

    it("404 : le menu n'existe pas", async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/menus/menu-inexistant/ventilation',
        payload: {},
      });
      expect(reponse.statusCode).toBe(404);
    });

    it('422 : un produit sans aucun composant actif ne peut pas être ventilé', async () => {
      const reponse = await app.inject({
        method: 'POST',
        url: `/api/menus/${idCafe}/ventilation`,
        payload: {},
      });
      expect(reponse.statusCode).toBe(422);
    });
  });
});
