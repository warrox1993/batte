/**
 * Tests du dépôt des menus (fiche 16 §2).
 *
 * Aucune valeur métier n'est empruntée à une graine : fournisseur, ingrédient,
 * conditionnement, recette et produits sont tous CRÉÉS par le test, pour que
 * le coût de revient calculé soit un vrai chiffre reproductible, pas une
 * coïncidence du jeu de démonstration.
 */

import {
  ErreurIntrouvable,
  ErreurMetier,
  formaterEuros,
  maintenantUtc,
  nouvelIdentifiant,
} from '@batte/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { conditionnement, fournisseur, ingredient, recette, recetteLigne } from '../schema.js';
import { listerJournalAudit } from './audit.js';
import { coutRevientProduit } from './recettes.js';
import { creerProduit, modifierProduit } from './referentiel.js';
import {
  calculerVentilationMenu,
  changerActiviteCompositionMenu,
  creerCompositionMenu,
  lireCompositionMenu,
  listerCompositionMenu,
  listerMenus,
  modifierCompositionMenu,
} from './menus.js';

/**
 * Vérifie le CODE machine d'une `ErreurMetier`, jamais un extrait du message —
 * le message est en français et destiné à un humain (CLAUDE.md §4).
 */
function attendCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`devait lever une ErreurMetier de code « ${code} »`);
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect((erreur as ErreurMetier).code).toBe(code);
  }
}

function insererFournisseur(base: BaseBatte, nom: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(fournisseur)
    .values({ id, nom, type: 'grossiste', creeLe: maintenant, modifieLe: maintenant })
    .run();
  return id;
}

type CategorieIngredient = typeof ingredient.$inferInsert.categorie;

function insererIngredient(base: BaseBatte, nom: string, categorie: CategorieIngredient): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(ingredient)
    .values({
      id,
      nom,
      categorie,
      uniteReference: 'g',
      allergenes: [],
      stockSecurite: 0,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function insererConditionnement(
  base: BaseBatte,
  ingredientId: string,
  fournisseurId: string,
  prixCents: number,
  quantiteUniteRef: number,
): void {
  const maintenant = maintenantUtc();
  base
    .insert(conditionnement)
    .values({
      id: nouvelIdentifiant(),
      ingredientId,
      fournisseurId,
      libelle: 'Conditionnement test',
      quantiteUniteRef,
      prixCents,
      datePrix: maintenant,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
}

/** Recette avec UNE ligne, pour obtenir un coût par crêpe réellement calculé (pas vide). */
function insererRecetteAvecCout(
  base: BaseBatte,
  code: string,
  nom: string,
  ingredientId: string,
  quantiteUniteRef: number,
  rendementReferenceCrepes: number,
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(recette)
    .values({
      id,
      code,
      nom,
      version: 1,
      statut: 'active',
      typePate: 'froment',
      sansGluten: false,
      rendementReferenceMl: 1000,
      rendementReferenceCrepes,
      perteCuissonBp: 0,
      tauxCasseBp: 0,
      perteFixeMl: 0,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  base
    .insert(recetteLigne)
    .values({ id: nouvelIdentifiant(), recetteId: id, ingredientId, quantiteUniteRef, ordre: 0 })
    .run();
  return id;
}

describe('dépôt menus', () => {
  let base: BaseBatte;
  let idCrepe: string;
  let idCafe: string;
  let idSirop: string;
  let idRecetteCrepe: string;

  /**
   * Recompose le prix du produit-conteneur (le prix DU MENU vendu, distinct de
   * son prix catalogue en vente seule), sans toucher au reste de sa fiche.
   */
  function fixerPrixMenu(prixCents: number): void {
    modifierProduit(base, idCrepe, {
      nom: 'Crêpe test',
      nature: 'transforme',
      recetteId: idRecetteCrepe,
      ingredientId: null,
      prixCents,
      consommationUnite: 'crepes',
      nbCrepes: 1,
      volumeMlParUnite: null,
      categorie: 'sucrée',
      consommationSurPlace: false,
    });
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);

    const idFournisseur = insererFournisseur(base, 'Grossiste Test');

    // Crêpe : transformée, coût réellement calculé via une recette d'une ligne.
    const idFarine = insererIngredient(base, 'Farine test', 'farine');
    insererConditionnement(base, idFarine, idFournisseur, 100, 1000); // 0,1 c/g
    idRecetteCrepe = insererRecetteAvecCout(base, 'RC', 'Crêpe test', idFarine, 1000, 10);
    idCrepe = creerProduit(base, {
      nom: 'Crêpe test',
      nature: 'transforme',
      recetteId: idRecetteCrepe,
      ingredientId: null,
      prixCents: 350,
      consommationUnite: 'crepes',
      nbCrepes: 1,
      volumeMlParUnite: null,
      categorie: 'sucrée',
      consommationSurPlace: false,
    });

    // Café : transformé « à la tasse », sans recette déclarée — coût INCONNU,
    // exactement le cas réel tant que fiche 15 n'est pas branchée ici.
    idCafe = creerProduit(base, {
      nom: 'Café test',
      nature: 'transforme',
      recetteId: null,
      ingredientId: null,
      prixCents: 200,
      consommationUnite: 'crepes',
      nbCrepes: 1,
      volumeMlParUnite: null,
      categorie: 'boisson',
      consommationSurPlace: false,
    });

    // Sirop : revendu, coût d'achat réellement calculé via un conditionnement.
    const idIngredientSirop = insererIngredient(base, 'Sirop de Liège 450 g', 'garniture');
    insererConditionnement(base, idIngredientSirop, idFournisseur, 280, 1); // 2,80 € l'unité
    idSirop = creerProduit(base, {
      nom: 'Pot sirop test',
      nature: 'revendu',
      // Pas de `consommationUnite` : un revendu ne consomme rien de la
      // production, la question ne se pose pas — la clé est OMETTABLE
      // (`.exactOptional()`), pas à renseigner par `null`.
      recetteId: null,
      ingredientId: idIngredientSirop,
      prixCents: 400,
      nbCrepes: null,
      volumeMlParUnite: null,
      categorie: 'terroir',
      consommationSurPlace: false,
    });
  });

  describe('composition — CRUD', () => {
    it('un produit sans composition ne figure pas dans `listerMenus`', () => {
      expect(listerMenus(base)).toEqual([]);
    });

    it('crée un composant et le fait apparaître dans `listerMenus` et `listerCompositionMenu`', () => {
      const id = creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });

      const menus = listerMenus(base);
      expect(menus).toHaveLength(1);
      expect(menus[0]?.id).toBe(idCrepe);
      expect(menus[0]?.nbComposantsActifs).toBe(1);

      const composition = listerCompositionMenu(base, idCrepe);
      expect(composition).toHaveLength(1);
      expect(composition[0]?.id).toBe(id);
      expect(composition[0]?.produitInclusId).toBe(idCafe);
      expect(composition[0]?.nomProduitInclus).toBe('Café test');
      expect(composition[0]?.nature).toBe('transforme');
      expect(composition[0]?.prixCatalogueCents).toBe(200);
      expect(composition[0]?.actif).toBe(true);

      const journal = listerJournalAudit(base, { table: 'menu_composition', enregistrementId: id });
      expect(journal).toHaveLength(1);
      expect(journal[0]?.action).toBe('creation');
    });

    it('un menu peut contenir un produit REVENDU (fiche 16 §2.3)', () => {
      creerCompositionMenu(base, idCrepe, { produitInclusId: idSirop, quantite: 1 });

      const composition = listerCompositionMenu(base, idCrepe);
      expect(composition[0]?.nature).toBe('revendu');
    });

    it('404 : le menu adressé dans l’URL n’existe pas', () => {
      expect(() =>
        creerCompositionMenu(base, 'menu-inexistant', { produitInclusId: idCafe, quantite: 1 }),
      ).toThrow(ErreurIntrouvable);
    });

    it('422 + champs : le produit inclus n’existe pas', () => {
      try {
        creerCompositionMenu(base, idCrepe, { produitInclusId: 'produit-inexistant', quantite: 1 });
        expect.unreachable('devait lever une ErreurMetier');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).champs).toHaveProperty('produitInclusId');
      }
    });

    it('refuse qu’un menu se contienne lui-même', () => {
      attendCode(
        () => creerCompositionMenu(base, idCrepe, { produitInclusId: idCrepe, quantite: 1 }),
        'menu_auto_reference',
      );
    });

    it('refuse un menu IMBRIQUÉ dans un autre menu', () => {
      creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 }); // idCrepe est désormais un menu
      attendCode(
        () => creerCompositionMenu(base, idSirop, { produitInclusId: idCrepe, quantite: 1 }),
        'menu_imbrique_interdit',
      );
    });

    it('refuse la nidification dans l’AUTRE sens : un composant d’un menu ne peut pas devenir lui-même un menu-conteneur', () => {
      creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 }); // idCafe est désormais un composant
      attendCode(
        () => creerCompositionMenu(base, idCafe, { produitInclusId: idSirop, quantite: 1 }),
        'menu_imbrique_interdit',
      );
    });

    it('refuse un doublon (menu, produit inclus) — le composant existe déjà', () => {
      creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });
      attendCode(
        () => creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 2 }),
        'composant_menu_deja_present',
      );
    });

    it('modifie la quantité d’un composant existant', () => {
      const id = creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });
      modifierCompositionMenu(base, id, { produitInclusId: idCafe, quantite: 2 });

      expect(lireCompositionMenu(base, id)?.quantite).toBe(2);
    });

    it('désactive puis réactive un composant — jamais de suppression', () => {
      const id = creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });

      changerActiviteCompositionMenu(base, id, false);
      expect(lireCompositionMenu(base, id)?.actif).toBe(false);
      // Toujours présent dans la liste, et `listerMenus` ne le compte plus comme actif.
      expect(listerCompositionMenu(base, idCrepe)).toHaveLength(1);
      expect(listerMenus(base)[0]?.nbComposantsActifs).toBe(0);

      changerActiviteCompositionMenu(base, id, true);
      expect(lireCompositionMenu(base, id)?.actif).toBe(true);
    });
  });

  describe('calculerVentilationMenu', () => {
    it('la somme des parts vaut exactement le prix du menu (prorata pur)', () => {
      creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });
      // Le prix du MENU vit sur le produit-conteneur : on le fixe à 500 c.
      fixerPrixMenu(500);

      const ventilation = calculerVentilationMenu(base, idCrepe);

      const somme = ventilation.composants.reduce((a, c) => a + c.partPrixCents, 0);
      expect(somme).toBe(500);
      expect(ventilation.parNatureCents.transforme + ventilation.parNatureCents.revendu).toBe(500);
    });

    it('ventile un menu MIXTE (transformé + revendu) et somme exactement au prix du menu', () => {
      creerCompositionMenu(base, idCrepe, { produitInclusId: idSirop, quantite: 1 });
      fixerPrixMenu(700);

      const ventilation = calculerVentilationMenu(base, idCrepe);

      expect(ventilation.parNatureCents.transforme + ventilation.parNatureCents.revendu).toBe(700);
      expect(ventilation.parNatureCents.revendu).toBeGreaterThan(0);
    });

    it('applique la méthode DÉSIGNÉE (« ce composant vaut ce prix ») via `prixForcesCents`', () => {
      // Deux composants : le sirop est DÉSIGNÉ à 380 c, le café (libre) absorbe
      // le reste (320 c) au prorata — avec un seul composant, tout serait
      // forcé et la somme devrait déjà correspondre exactement au prix du menu.
      creerCompositionMenu(base, idCrepe, { produitInclusId: idSirop, quantite: 1 });
      creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });
      fixerPrixMenu(700);

      const ventilation = calculerVentilationMenu(base, idCrepe, new Map([[idSirop, 380]]));

      const ligneSirop = ventilation.composants.find((c) => c.produitInclusId === idSirop);
      expect(ligneSirop?.partPrixCents).toBe(380);
      expect(ventilation.composants.reduce((a, c) => a + c.partPrixCents, 0)).toBe(700);
    });

    it('reprend le VRAI coût de revient de chaque composant (`coutRevientProduit`), jamais recalculé', () => {
      creerCompositionMenu(base, idCrepe, { produitInclusId: idSirop, quantite: 2 });
      fixerPrixMenu(900);

      const ventilation = calculerVentilationMenu(base, idCrepe);

      const coutSiropUnitaire = coutRevientProduit(base, idSirop)?.coutMatiereCents;
      expect(coutSiropUnitaire).not.toBeNull();
      const ligneSirop = ventilation.composants.find((c) => c.produitInclusId === idSirop);
      expect(ligneSirop?.coutTotalCents).toBe(2 * (coutSiropUnitaire as number));
    });

    it('un composant sans coût connu (café sans recette) rend le coût total du menu `null`, jamais un chiffre partiel', () => {
      creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });
      fixerPrixMenu(500);

      const ventilation = calculerVentilationMenu(base, idCrepe);

      expect(coutRevientProduit(base, idCafe)?.coutMatiereCents).toBeNull();
      expect(ventilation.coutTotalCents).toBeNull();
      expect(ventilation.margeMenuCents).toBeNull();
      // Le CA par nature, lui, reste calculable : les seuils légaux n'attendent aucun coût.
      expect(ventilation.parNatureCents.transforme).toBe(500);
    });

    it('404 : le menu n’existe pas', () => {
      expect(() => calculerVentilationMenu(base, 'menu-inexistant')).toThrow(ErreurIntrouvable);
    });

    it('422 : un produit sans aucun composant actif ne peut pas être ventilé', () => {
      attendCode(() => calculerVentilationMenu(base, idCrepe), 'menu_sans_composant_actif');
    });

    it('422 : un composant désactivé ne compte plus pour la ventilation', () => {
      const id = creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });
      changerActiviteCompositionMenu(base, id, false);

      attendCode(() => calculerVentilationMenu(base, idCrepe), 'menu_sans_composant_actif');
    });
  });

  /**
   * Audit du 30/07/2026 : `menu_composition.prixForceCents` n'était ni écrite
   * ni lue. `SaisieCompositionMenuAvecPrixForce` (`depots/menus.ts`) élargit
   * la saisie standard au niveau du dépôt tant que `schemaSaisieCompositionMenu`
   * (`@batte/core`, `contrats/menus.ts`) ne porte pas encore ce champ.
   */
  describe('prixForceCents — persistance (fiche 16 §2.2, audit 30/07/2026)', () => {
    it('creerCompositionMenu enregistre le prix forcé fourni', () => {
      const id = creerCompositionMenu(base, idCrepe, {
        produitInclusId: idCafe,
        quantite: 1,
        prixForceCents: 150,
      });
      expect(lireCompositionMenu(base, id)?.prixForceCents).toBe(150);
    });

    it('creerCompositionMenu sans prix forcé enregistre `null`, jamais `0`', () => {
      const id = creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });
      expect(lireCompositionMenu(base, id)?.prixForceCents).toBeNull();
    });

    it('un prix forcé à 0 (composant OFFERT) reste distinct d’une absence de réglage', () => {
      const id = creerCompositionMenu(base, idCrepe, {
        produitInclusId: idCafe,
        quantite: 1,
        prixForceCents: 0,
      });
      expect(lireCompositionMenu(base, id)?.prixForceCents).toBe(0);
    });

    it('modifierCompositionMenu SANS le champ conserve le prix forcé déjà en base', () => {
      const id = creerCompositionMenu(base, idCrepe, {
        produitInclusId: idCafe,
        quantite: 1,
        prixForceCents: 150,
      });

      modifierCompositionMenu(base, id, { produitInclusId: idCafe, quantite: 2 });

      expect(lireCompositionMenu(base, id)?.prixForceCents).toBe(150);
      expect(lireCompositionMenu(base, id)?.quantite).toBe(2);
    });

    it('modifierCompositionMenu avec `null` explicite EFFACE le prix forcé', () => {
      const id = creerCompositionMenu(base, idCrepe, {
        produitInclusId: idCafe,
        quantite: 1,
        prixForceCents: 150,
      });

      modifierCompositionMenu(base, id, {
        produitInclusId: idCafe,
        quantite: 1,
        prixForceCents: null,
      });

      expect(lireCompositionMenu(base, id)?.prixForceCents).toBeNull();
    });

    it('modifierCompositionMenu avec un montant CHANGE le prix forcé', () => {
      const id = creerCompositionMenu(base, idCrepe, {
        produitInclusId: idCafe,
        quantite: 1,
        prixForceCents: 150,
      });

      modifierCompositionMenu(base, id, {
        produitInclusId: idCafe,
        quantite: 1,
        prixForceCents: 175,
      });

      expect(lireCompositionMenu(base, id)?.prixForceCents).toBe(175);
    });

    it('refuse un prix forcé négatif (code prix_force_invalide)', () => {
      attendCode(
        () =>
          creerCompositionMenu(base, idCrepe, {
            produitInclusId: idCafe,
            quantite: 1,
            prixForceCents: -10,
          }),
        'prix_force_invalide',
      );
    });

    it('refuse un prix forcé non entier (code prix_force_invalide)', () => {
      attendCode(
        () =>
          creerCompositionMenu(base, idCrepe, {
            produitInclusId: idCafe,
            quantite: 1,
            prixForceCents: 1.5,
          }),
        'prix_force_invalide',
      );
    });

    it('calculerVentilationMenu applique AUTOMATIQUEMENT le prix forcé PERSISTÉ, sans qu’il faille le repasser à chaque appel', () => {
      creerCompositionMenu(base, idCrepe, {
        produitInclusId: idSirop,
        quantite: 1,
        prixForceCents: 380,
      });
      creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });
      fixerPrixMenu(700);

      // Aucune carte `prixForcesCents` fournie : la valeur vient SEULEMENT de la base.
      const ventilation = calculerVentilationMenu(base, idCrepe);

      const ligneSirop = ventilation.composants.find((c) => c.produitInclusId === idSirop);
      expect(ligneSirop?.partPrixCents).toBe(380);
      expect(ventilation.composants.reduce((a, c) => a + c.partPrixCents, 0)).toBe(700);
    });

    it('le paramètre éphémère (simulation) SURCLASSE le prix forcé persisté pour CET appel', () => {
      creerCompositionMenu(base, idCrepe, {
        produitInclusId: idSirop,
        quantite: 1,
        prixForceCents: 380,
      });
      creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });
      fixerPrixMenu(700);

      const ventilation = calculerVentilationMenu(base, idCrepe, new Map([[idSirop, 500]]));

      const ligneSirop = ventilation.composants.find((c) => c.produitInclusId === idSirop);
      expect(ligneSirop?.partPrixCents).toBe(500);
      expect(ventilation.composants.reduce((a, c) => a + c.partPrixCents, 0)).toBe(700);
    });

    it('la somme des parts vaut EXACTEMENT le prix du menu même avec un prix forcé PERSISTÉ et des montants qui ne tombent pas rond', () => {
      // Trois composants : sirop DÉSIGNÉ (persisté, 250 c), café et chocolat
      // LIBRES au prorata de poids 200/250 — 483 c à répartir entre les deux
      // ne se divise pas rond (483 × 200/450 = 214,666…), ce qui force
      // `repartir()` à arrondir sans jamais perdre le centime.
      const idChocolat = creerProduit(base, {
        nom: 'Chocolat chaud test',
        nature: 'transforme',
        recetteId: null,
        ingredientId: null,
        prixCents: 250,
        nbCrepes: 1,
        volumeMlParUnite: null,
        categorie: 'boisson',
        consommationSurPlace: false,
      });

      creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });
      creerCompositionMenu(base, idCrepe, { produitInclusId: idChocolat, quantite: 1 });
      creerCompositionMenu(base, idCrepe, {
        produitInclusId: idSirop,
        quantite: 1,
        prixForceCents: 250,
      });
      fixerPrixMenu(733);

      const ventilation = calculerVentilationMenu(base, idCrepe);

      const somme = ventilation.composants.reduce((a, c) => a + c.partPrixCents, 0);
      expect(somme).toBe(733);
      const ligneSirop = ventilation.composants.find((c) => c.produitInclusId === idSirop);
      expect(ligneSirop?.partPrixCents).toBe(250);
    });

    /**
     * Le message d'incohérence est construit dans `packages/core/src/menus.ts`,
     * qui ne connaît le nom du menu que si le dépôt le lui passe. Ce test existe
     * parce que le passer est une ligne facile à oublier — et son oubli ne casse
     * AUCUN calcul : la ventilation reste juste, seul le message perd le seul
     * élément qui permet au porteur de savoir quelle fiche ouvrir. Un défaut
     * invisible de tout test de montant, donc.
     */
    it('le message de refus nomme le MENU, ses composants désignés et les deux sorties', () => {
      creerCompositionMenu(base, idCrepe, {
        produitInclusId: idSirop,
        quantite: 1,
        prixForceCents: 380,
      });
      creerCompositionMenu(base, idCrepe, { produitInclusId: idCafe, quantite: 1 });
      // 380 c désignés pour le seul sirop, alors que le menu entier vaut 300 c :
      // il ne reste rien pour le café, la ventilation est impossible.
      fixerPrixMenu(300);

      let message = '';
      try {
        calculerVentilationMenu(base, idCrepe);
        throw new Error('la ventilation aurait dû être refusée');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        message = (erreur as ErreurMetier).message;
      }

      expect(message).toContain('Crêpe test'); // quel menu
      expect(message).toContain('Pot sirop test'); // quel composant désigné
      // Comparé via `formaterEuros`, jamais via un littéral : le séparateur
      // avant le « € » est une espace INSÉCABLE produite par `Intl`, et un
      // littéral tapé à la main y échoue — ce test a d'abord échoué là-dessus,
      // sur un message pourtant correct.
      expect(message).toContain(formaterEuros(380)); // en euros, jamais en centimes bruts
      expect(message).toContain(formaterEuros(300));
      expect(message).toContain('Café test'); // ce qui n'a plus rien à recevoir
      expect(message).toContain('prix pratiqué'); // sortie 1 : corriger cette vente
      expect(message).toContain('fiche du menu'); // sortie 2 : corriger le réglage
      // Le centime brut ne doit apparaître nulle part : « 380 c » était
      // exactement ce que l'ancien message affichait.
      expect(message).not.toMatch(/\d+\s*c\b/);
    });
  });
});
