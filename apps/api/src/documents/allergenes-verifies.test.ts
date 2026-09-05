/**
 * Tests du drapeau `allergenesVerifies` (mission du 30/07/2026) sur les TROIS
 * documents qui affichent des allergènes.
 *
 * LE DÉFAUT CORRIGÉ : `ingredient.allergenes` valait `[]` par défaut. Un
 * ingrédient jamais évalué s'imprimait donc EXACTEMENT comme un ingrédient
 * contrôlé sans allergène — sur une affichette remise à un client, cette
 * ambiguïté se lit « aucun allergène », une affirmation qu'on n'était pas en
 * mesure de faire. `allergenesVerifies` (migration 0024) distingue les deux.
 *
 * LA RÈGLE VÉRIFIÉE ICI : tant que `allergenesVerifies` est faux pour un seul
 * ingrédient qui entre dans la composition d'un document (recette, garniture,
 * composant de nomenclature de vente NON optionnel, article revendu, ou l'une
 * de ces sources pour un produit inclus dans un menu), le document doit
 * écrire « allergènes non encore vérifiés », jamais une liste vide ni
 * « aucun allergène déclaré ». Un composant OPTIONNEL (« sur demande ») non
 * évalué, lui, ne doit PAS entacher le produit : voir le test dédié plus bas.
 *
 * Même convention que `audit-documents.test.ts` : chaque test appelle la
 * chaîne RÉELLE (dépôt ou insertion directe → assemblage `donnees.ts` →
 * gabarit), jamais un gabarit isolé sur des données inventées sans passer par
 * la base. Aucun rendu PDF réel ici (Playwright) : cette mission porte sur le
 * CONTENU des documents, déjà couvert côté rendu par `rendu.test.ts` et
 * `audit-documents.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  creerBase,
  creerCompositionMenu,
  creerIngredient,
  enregistrerReception,
  lancerProduction,
  migrer,
  modifierIngredient,
  schema,
  seed,
  type BaseBatte,
} from '@batte/db';
import { maintenantUtc, nouvelIdentifiant, type SaisieIngredient } from '@batte/core';
import {
  donneesAffichetteAllergenes,
  donneesEtiquetteBac,
  donneesFicheTechnique,
} from './donnees.js';
import { affichetteAllergenes, etiquetteBac, ficheTechnique } from './gabarits.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Aides de test — mêmes conventions que `audit-documents.test.ts` : chaque
   fichier de test redéfinit ses propres petites aides plutôt que d'en
   importer d'un autre fichier de test.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Ingrédient créé par INSERTION DIRECTE, drapeau `allergenesVerifies` au choix. */
function creerIngredientTest(
  base: BaseBatte,
  nom: string,
  options: { allergenes?: string[]; allergenesVerifies?: boolean } = {},
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.ingredient)
    .values({
      id,
      nom,
      categorie: 'garniture',
      uniteReference: 'g',
      allergenes: options.allergenes ?? [],
      allergenesVerifies: options.allergenesVerifies ?? false,
      stockSecurite: 0,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function creerFournisseurTest(base: BaseBatte, nom: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.fournisseur)
    .values({
      id,
      nom,
      type: 'grossiste',
      delaiLivraisonJours: 2,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

/** Recette ACTIVE avec ses lignes, comme `audit-documents.test.ts::creerRecetteTest`. */
function creerRecetteTest(
  base: BaseBatte,
  code: string,
  lignes: readonly { ingredientId: string; quantiteUniteRef: number }[],
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.recette)
    .values({
      id,
      code,
      nom: `Recette de test ${code}`,
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
    .values(
      lignes.map((l, index) => ({
        id: nouvelIdentifiant(),
        recetteId: id,
        ingredientId: l.ingredientId,
        quantiteUniteRef: l.quantiteUniteRef,
        ordre: index,
        noteTechnique: null,
      })),
    )
    .run();

  return id;
}

/** Produit `transforme`, rattaché à une recette — le cas « crêpe ». */
function creerProduitTransformeTest(base: BaseBatte, nom: string, recetteId: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.produitVente)
    .values({
      id,
      nom,
      nature: 'transforme',
      recetteId,
      ingredientId: null,
      prixCents: 250,
      nbCrepes: 1,
      volumeMlParUnite: null,
      categorie: null,
      consommationSurPlace: false,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

/** Produit `transforme` SANS recette ni ingrédient — le cas « café » (fiche 15 §4). */
function creerProduitVenteTest(base: BaseBatte, nom: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.produitVente)
    .values({
      id,
      nom,
      nature: 'transforme',
      recetteId: null,
      ingredientId: null,
      prixCents: 250,
      nbCrepes: null,
      volumeMlParUnite: null,
      categorie: 'boisson',
      consommationSurPlace: false,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

/** Produit `revendu`, rattaché à l'article acheté préemballé. */
function creerProduitRevenduTest(base: BaseBatte, nom: string, ingredientId: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.produitVente)
    .values({
      id,
      nom,
      nature: 'revendu',
      recetteId: null,
      ingredientId,
      prixCents: 300,
      nbCrepes: null,
      volumeMlParUnite: null,
      categorie: null,
      consommationSurPlace: false,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

/** Menu (fiche 16) : conteneur sans recette ni ingrédient propres. */
function creerMenuTest(base: BaseBatte, nom: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(schema.produitVente)
    .values({
      id,
      nom,
      nature: 'menu',
      recetteId: null,
      ingredientId: null,
      prixCents: 400,
      nbCrepes: null,
      volumeMlParUnite: null,
      categorie: null,
      consommationSurPlace: false,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function creerGarnitureTest(
  base: BaseBatte,
  produitVenteId: string,
  ingredientId: string,
  quantiteUniteRef = 10,
): void {
  base
    .insert(schema.produitGarniture)
    .values({ id: nouvelIdentifiant(), produitVenteId, ingredientId, quantiteUniteRef })
    .run();
}

/** Composant de nomenclature de VENTE (fiche 15) : ce qu'un produit consomme à la vente. */
function creerComposantVenteTest(
  base: BaseBatte,
  produitVenteId: string,
  ingredientId: string,
  optionnel: boolean,
): void {
  const maintenant = maintenantUtc();
  base
    .insert(schema.produitVenteComposant)
    .values({
      id: nouvelIdentifiant(),
      produitVenteId,
      ingredientId,
      quantiteUniteRef: 1,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
}

/** Ingrédient de saisie minimal et VALIDE, pour appeler le dépôt directement. */
function ingredientDeBase(nom: string): SaisieIngredient {
  return {
    nom,
    categorie: 'garniture',
    uniteReference: 'g',
    densiteGParMl: null,
    allergenes: [],
    stockSecurite: 0,
    delaiLivraisonJours: null,
    dureeConservationJours: null,
    notes: null,
  };
}

function baseDeTest(): BaseBatte {
  const base = creerBase(':memory:');
  migrer(base);
  seed(base);
  return base;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Fiche technique de recette
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Fiche technique — drapeau allergènes vérifiés', () => {
  it(
    'un SEUL ingrédient jamais évalué rend toute la fiche non vérifiée : ' +
      'avertissement, jamais une liste vide ni « aucun allergène »',
    () => {
      const base = baseDeTest();
      const idFarine = creerIngredientTest(base, 'Farine vérifiée (test)', {
        allergenes: ['gluten'],
        allergenesVerifies: true,
      });
      const idMystere = creerIngredientTest(base, 'Poudre mystère (test)', {
        allergenesVerifies: false, // jamais évaluée
      });
      const idRecette = creerRecetteTest(base, 'RTEST-FICHE-NONVERIF', [
        { ingredientId: idFarine, quantiteUniteRef: 145 },
        { ingredientId: idMystere, quantiteUniteRef: 5 },
      ]);

      const donnees = donneesFicheTechnique(base, idRecette);
      expect(donnees).not.toBeNull();
      expect(donnees?.allergenesVerifies).toBe(false);

      const { html } = ficheTechnique(donnees!);
      expect(html).toContain('Allergènes non encore vérifiés');
      expect(html).not.toContain('Aucun allergène déclaré parmi les 14');
    },
  );

  it(
    'tous les ingrédients vérifiés, même sans aucun allergène, affiche ' +
      '« aucun allergène déclaré » — jamais l’avertissement',
    () => {
      const base = baseDeTest();
      const idSel = creerIngredientTest(base, 'Sel vérifié sans allergène (test)', {
        allergenesVerifies: true,
      });
      const idRecette = creerRecetteTest(base, 'RTEST-FICHE-VERIF-VIDE', [
        { ingredientId: idSel, quantiteUniteRef: 2 },
      ]);

      const donnees = donneesFicheTechnique(base, idRecette);
      expect(donnees?.allergenesVerifies).toBe(true);

      const { html } = ficheTechnique(donnees!);
      expect(html).toContain('Aucun allergène déclaré parmi les 14');
      expect(html).not.toContain('non encore vérifiés');
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Affichette allergènes
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Affichette allergènes — drapeau allergènes vérifiés', () => {
  it('un produit transformé dont la recette contient un ingrédient non évalué est marqué non vérifié', () => {
    const base = baseDeTest();
    const idFarine = creerIngredientTest(base, 'Farine crêpe (test)', {
      allergenes: ['gluten'],
      allergenesVerifies: true,
    });
    const idMystere = creerIngredientTest(base, 'Ingrédient mystère crêpe (test)', {
      allergenesVerifies: false,
    });
    const idRecette = creerRecetteTest(base, 'RTEST-AFF-RECETTE', [
      { ingredientId: idFarine, quantiteUniteRef: 100 },
      { ingredientId: idMystere, quantiteUniteRef: 5 },
    ]);
    creerProduitTransformeTest(base, 'Crêpe non vérifiée (test)', idRecette);

    const donnees = donneesAffichetteAllergenes(base);
    const produit = donnees.produits.find((p) => p.nom === 'Crêpe non vérifiée (test)');
    expect(produit).toBeDefined();
    expect(produit?.allergenesVerifies).toBe(false);

    const { html } = affichetteAllergenes(donnees);
    expect(html).toContain('Allergènes non encore vérifiés');
  });

  it('une garniture non évaluée rend le produit non vérifié', () => {
    const base = baseDeTest();
    const idFarine = creerIngredientTest(base, 'Farine garniture (test)', {
      allergenes: ['gluten'],
      allergenesVerifies: true,
    });
    const idRecette = creerRecetteTest(base, 'RTEST-AFF-GARNITURE', [
      { ingredientId: idFarine, quantiteUniteRef: 100 },
    ]);
    const idNoisette = creerIngredientTest(base, 'Noisette non évaluée (test)', {
      allergenes: ['fruits-a-coque'],
      allergenesVerifies: false,
    });
    const idProduit = creerProduitTransformeTest(
      base,
      'Crêpe garniture non vérifiée (test)',
      idRecette,
    );
    creerGarnitureTest(base, idProduit, idNoisette);

    const donnees = donneesAffichetteAllergenes(base);
    const produit = donnees.produits.find((p) => p.nom === 'Crêpe garniture non vérifiée (test)');
    expect(produit?.allergenesVerifies).toBe(false);
  });

  it('un produit revendu dont l’article n’est pas évalué est marqué non vérifié', () => {
    const base = baseDeTest();
    const idConfiture = creerIngredientTest(base, 'Confiture non évaluée (test)', {
      allergenesVerifies: false,
    });
    creerProduitRevenduTest(base, 'Pot de confiture non vérifié (test)', idConfiture);

    const donnees = donneesAffichetteAllergenes(base);
    const produit = donnees.produits.find((p) => p.nom === 'Pot de confiture non vérifié (test)');
    expect(produit?.allergenesVerifies).toBe(false);

    const { html } = affichetteAllergenes(donnees);
    expect(html).toContain('Allergènes non encore vérifiés');
  });

  it('un composant de nomenclature de vente OBLIGATOIRE non évalué rend le produit non vérifié', () => {
    const base = baseDeTest();
    const idGobelet = creerIngredientTest(base, 'Gobelet vérifié (test)', {
      allergenesVerifies: true,
    });
    const idCafeMoulu = creerIngredientTest(base, 'Café moulu non évalué (test)', {
      allergenesVerifies: false,
    });
    const idProduit = creerProduitVenteTest(base, 'Café composant non vérifié (test)');
    creerComposantVenteTest(base, idProduit, idGobelet, false);
    creerComposantVenteTest(base, idProduit, idCafeMoulu, false);

    const donnees = donneesAffichetteAllergenes(base);
    const produit = donnees.produits.find((p) => p.nom === 'Café composant non vérifié (test)');
    expect(produit?.allergenesVerifies).toBe(false);
  });

  it(
    'un composant OPTIONNEL (« sur demande ») non évalué n’entache PAS le produit : ' +
      'seule la liste « sur demande » en dépend, jamais la liste principale',
    () => {
      const base = baseDeTest();
      const idCafeMoulu = creerIngredientTest(base, 'Café moulu vérifié (test)', {
        allergenesVerifies: true,
      });
      const idCreme = creerIngredientTest(base, 'Crème non évaluée en option (test)', {
        allergenes: ['lait'],
        allergenesVerifies: false, // JAMAIS évaluée, mais optionnelle
      });
      const idProduit = creerProduitVenteTest(base, 'Café option non vérifiée (test)');
      creerComposantVenteTest(base, idProduit, idCafeMoulu, false); // obligatoire, vérifié
      creerComposantVenteTest(base, idProduit, idCreme, true); // optionnel, JAMAIS évalué

      const donnees = donneesAffichetteAllergenes(base);
      const produit = donnees.produits.find((p) => p.nom === 'Café option non vérifiée (test)');
      expect(produit).toBeDefined();
      // Le produit lui-même reste VÉRIFIÉ : la crème n'est servie que sur demande.
      expect(produit?.allergenesVerifies).toBe(true);
      expect(produit?.allergenes).toEqual([]);

      const { html } = affichetteAllergenes(donnees);
      expect(html).not.toContain('non encore vérifiés');
      // La liste « sur demande » continue d'exister normalement.
      expect(html).toContain('Sur demande');
    },
  );

  it('un menu hérite du non-vérifié d’UN SEUL de ses produits inclus', () => {
    const base = baseDeTest();
    const idFarine = creerIngredientTest(base, 'Farine menu (test)', {
      allergenes: ['gluten'],
      allergenesVerifies: true,
    });
    const idRecette = creerRecetteTest(base, 'RTEST-AFF-MENU', [
      { ingredientId: idFarine, quantiteUniteRef: 100 },
    ]);
    const idCrepe = creerProduitTransformeTest(base, 'Crêpe du menu (test)', idRecette);

    const idCafeMoulu = creerIngredientTest(base, 'Café moulu menu (test)', {
      allergenesVerifies: false, // jamais évalué
    });
    const idCafe = creerProduitVenteTest(base, 'Café du menu (test)');
    creerComposantVenteTest(base, idCafe, idCafeMoulu, false);

    const idMenu = creerMenuTest(base, 'Menu crêpe + café non vérifié (test)');
    creerCompositionMenu(base, idMenu, { produitInclusId: idCrepe, quantite: 1 });
    creerCompositionMenu(base, idMenu, { produitInclusId: idCafe, quantite: 1 });

    const donnees = donneesAffichetteAllergenes(base);
    const menu = donnees.produits.find((p) => p.nom === 'Menu crêpe + café non vérifié (test)');
    expect(menu).toBeDefined();
    expect(menu?.allergenesVerifies).toBe(false);

    const { html } = affichetteAllergenes(donnees);
    expect(html).toContain('Allergènes non encore vérifiés');
  });

  it('tous les ingrédients évalués, sur un produit composé, n’affiche jamais l’avertissement', () => {
    const base = baseDeTest();
    const idFarine = creerIngredientTest(base, 'Farine ok (test)', {
      allergenes: ['gluten'],
      allergenesVerifies: true,
    });
    const idRecette = creerRecetteTest(base, 'RTEST-AFF-OK', [
      { ingredientId: idFarine, quantiteUniteRef: 100 },
    ]);
    const idNoisette = creerIngredientTest(base, 'Noisette ok (test)', {
      allergenes: ['fruits-a-coque'],
      allergenesVerifies: true,
    });
    const idProduit = creerProduitTransformeTest(
      base,
      'Crêpe entièrement vérifiée (test)',
      idRecette,
    );
    creerGarnitureTest(base, idProduit, idNoisette);

    const donnees = donneesAffichetteAllergenes(base);
    const produit = donnees.produits.find((p) => p.nom === 'Crêpe entièrement vérifiée (test)');
    expect(produit?.allergenesVerifies).toBe(true);
    expect(produit?.allergenes).toEqual(['fruits-a-coque', 'gluten']);

    const { html } = affichetteAllergenes(donnees);
    expect(html).not.toContain('non encore vérifiés');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Étiquette de bac de pâte
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Étiquette de bac — drapeau allergènes vérifiés', () => {
  it('une production dont la recette contient un ingrédient non évalué est marquée non vérifiée', () => {
    const base = baseDeTest();
    const idFournisseur = creerFournisseurTest(base, 'Fournisseur étiquette (test)');
    const idFarine = creerIngredientTest(base, 'Farine étiquette (test)', {
      allergenes: ['gluten'],
      allergenesVerifies: true,
    });
    const idMystere = creerIngredientTest(base, 'Ingrédient mystère étiquette (test)', {
      allergenesVerifies: false,
    });
    const idRecette = creerRecetteTest(base, 'RTEST-ETIQ-NONVERIF', [
      { ingredientId: idFarine, quantiteUniteRef: 100 },
      { ingredientId: idMystere, quantiteUniteRef: 5 },
    ]);

    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-01-01',
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 100_000,
          prixLigneCents: 1000,
          numeroLotFournisseur: 'LOT-TEST-FARINE',
        },
        {
          ingredientId: idMystere,
          quantite: 100_000,
          prixLigneCents: 1000,
          numeroLotFournisseur: 'LOT-TEST-MYSTERE',
        },
      ],
    });

    const production = lancerProduction(base, {
      recetteId: idRecette,
      cible: { type: 'volume', volumeMl: 1000 },
      dateProduction: '2026-01-02',
    });

    const donnees = donneesEtiquetteBac(base, production.productionId);
    expect(donnees).not.toBeNull();
    expect(donnees?.allergenesVerifies).toBe(false);

    const { html } = etiquetteBac(donnees!);
    expect(html).toContain('non encore vérifiés');
  });

  it('une production dont tous les ingrédients sont évalués affiche la liste normalement', () => {
    const base = baseDeTest();
    const idFournisseur = creerFournisseurTest(base, 'Fournisseur étiquette OK (test)');
    const idFarine = creerIngredientTest(base, 'Farine étiquette OK (test)', {
      allergenes: ['gluten'],
      allergenesVerifies: true,
    });
    const idLait = creerIngredientTest(base, 'Lait étiquette OK (test)', {
      allergenes: ['lait'],
      allergenesVerifies: true,
    });
    const idRecette = creerRecetteTest(base, 'RTEST-ETIQ-VERIF', [
      { ingredientId: idFarine, quantiteUniteRef: 100 },
      { ingredientId: idLait, quantiteUniteRef: 200 },
    ]);

    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-01-01',
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 100_000,
          prixLigneCents: 1000,
          numeroLotFournisseur: 'LOT-TEST-FARINE-OK',
        },
        {
          ingredientId: idLait,
          quantite: 100_000,
          prixLigneCents: 1000,
          numeroLotFournisseur: 'LOT-TEST-LAIT-OK',
        },
      ],
    });

    const production = lancerProduction(base, {
      recetteId: idRecette,
      cible: { type: 'volume', volumeMl: 1000 },
      dateProduction: '2026-01-02',
    });

    const donnees = donneesEtiquetteBac(base, production.productionId);
    expect(donnees?.allergenesVerifies).toBe(true);

    const { html } = etiquetteBac(donnees!);
    expect(html).not.toContain('non encore vérifiés');
    // Le LIBELLÉ réglementaire, jamais le code interne : `libelleAllergene`
    // traduit `gluten` en « Céréales contenant du gluten » et `lait` en
    // « Lait (y compris lactose) ». Cette étiquette est collée sur un bac de
    // pâte manipulé pendant le service — le mot exact y compte.
    expect(html).toContain('Céréales contenant du gluten');
    expect(html).toContain('Lait (y compris lactose)');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Dépôt ingrédient — création, et modification qui PRÉSERVE ce que le
      formulaire n'envoie pas
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Ingrédient — dépôt : le drapeau se crée à false, se préserve si absent, se change si explicite', () => {
  it('une création SANS le champ est non vérifiée par défaut (« pas encore évalué »)', () => {
    const base = baseDeTest();
    const id = creerIngredient(base, ingredientDeBase('Ingrédient sans drapeau (test)'));

    const ligne = base
      .select({ verifie: schema.ingredient.allergenesVerifies })
      .from(schema.ingredient)
      .where(eq(schema.ingredient.id, id))
      .get();
    expect(ligne?.verifie).toBe(false);
  });

  it('une création avec `allergenesVerifies: true` explicite est bien stockée vérifiée', () => {
    const base = baseDeTest();
    const id = creerIngredient(base, {
      ...ingredientDeBase('Ingrédient vérifié à la création (test)'),
      allergenesVerifies: true,
    });

    const ligne = base
      .select({ verifie: schema.ingredient.allergenesVerifies })
      .from(schema.ingredient)
      .where(eq(schema.ingredient.id, id))
      .get();
    expect(ligne?.verifie).toBe(true);
  });

  it(
    'une modification qui OMET le champ (formulaire pas encore mis à jour) CONSERVE la ' +
      'valeur déjà en base — elle ne désévalue jamais en silence un ingrédient déjà vérifié',
    () => {
      const base = baseDeTest();
      const id = creerIngredient(base, {
        ...ingredientDeBase('Ingrédient déjà vérifié (test)'),
        allergenesVerifies: true,
      });

      // Modification d'un AUTRE champ seulement : simule l'écran de saisie
      // actuel, qui ne connaît pas encore la case à cocher.
      modifierIngredient(base, id, {
        ...ingredientDeBase('Ingrédient déjà vérifié (test)'),
        stockSecurite: 500,
      });

      const ligne = base
        .select({ verifie: schema.ingredient.allergenesVerifies })
        .from(schema.ingredient)
        .where(eq(schema.ingredient.id, id))
        .get();
      expect(ligne?.verifie).toBe(true);
    },
  );

  it('une modification qui envoie explicitement `false` désévalue réellement l’ingrédient', () => {
    const base = baseDeTest();
    const id = creerIngredient(base, {
      ...ingredientDeBase('Ingrédient à désévaluer (test)'),
      allergenesVerifies: true,
    });

    modifierIngredient(base, id, {
      ...ingredientDeBase('Ingrédient à désévaluer (test)'),
      allergenesVerifies: false,
    });

    const ligne = base
      .select({ verifie: schema.ingredient.allergenesVerifies })
      .from(schema.ingredient)
      .where(eq(schema.ingredient.id, id))
      .get();
    expect(ligne?.verifie).toBe(false);
  });

  it(
    'chaîne complète : un ingrédient vérifié, utilisé dans une recette, reste vérifié ' +
      'après une modification qui omet le champ — la fiche technique ne se met pas à ' +
      'avertir à tort',
    () => {
      const base = baseDeTest();
      const id = creerIngredient(base, {
        ...ingredientDeBase('Farine du dépôt (test)'),
        allergenes: ['gluten'],
        allergenesVerifies: true,
      });
      const idRecette = creerRecetteTest(base, 'RTEST-DEPOT-CHAINE', [
        { ingredientId: id, quantiteUniteRef: 100 },
      ]);

      expect(donneesFicheTechnique(base, idRecette)?.allergenesVerifies).toBe(true);

      modifierIngredient(base, id, {
        ...ingredientDeBase('Farine du dépôt (test)'),
        allergenes: ['gluten'],
        stockSecurite: 999,
      });

      expect(donneesFicheTechnique(base, idRecette)?.allergenesVerifies).toBe(true);
    },
  );
});
