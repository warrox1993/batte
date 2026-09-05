/**
 * Sortie de stock des composants de nomenclature de vente, a la cloture
 * (fiche 15) — meme defaut que les garnitures (D-053), transpose au cafe et
 * aux consommables.
 *
 * Ce fichier teste directement `sortirLesComposantsVente`, SANS passer par
 * `cloturerSession` : `packages/db/src/services/sessions.ts` est la zone
 * d'ecriture d'un autre agent au moment de ce lot, et cette fonction est
 * concue pour etre appelable seule, exactement comme `sortirLesGarnitures`
 * l'est. Le branchement dans la transaction de cloture est laisse a
 * l'integrateur (voir le rapport de livraison pour la ligne exacte).
 *
 * Regle de redaction reprise de `garnitures-cloture.test.ts` : chaque attendu
 * est DERIVE des donnees inserees par le test, jamais une valeur absolue
 * figee qui casserait au moindre changement sans rapport.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { and, eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import {
  fournisseur,
  ingredient,
  mouvementStock,
  produitVente,
  produitVenteComposant,
} from '../schema.js';
import { enregistrerReception } from './reception.js';
import { creerComposantVente } from '../depots/nomenclature-vente.js';
import { sortirLesComposantsVente } from './nomenclature-vente.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixture : un « café à emporter » qui consomme cannelle (petite quantite,
   pour un lot de reference de 100) et gobelet (1 pour 1, a l'emporte
   seulement).
   ═══════════════════════════════════════════════════════════════════════════ */

function creerFournisseurTest(base: BaseBatte): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(fournisseur)
    .values({
      id,
      nom: 'Grossiste de test',
      type: 'grossiste',
      delaiLivraisonJours: 3,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function creerIngredientTest(
  base: BaseBatte,
  nom: string,
  categorie: 'sucre' | 'consommable',
  uniteReference: 'g' | 'piece',
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(ingredient)
    .values({
      id,
      nom,
      categorie,
      uniteReference,
      allergenes: [],
      stockSecurite: 0,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function creerProduitTest(base: BaseBatte, nom: string, consommationSurPlace: boolean): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(produitVente)
    .values({
      id,
      nom,
      nature: 'transforme',
      recetteId: null,
      ingredientId: null,
      prixCents: 250,
      nbCrepes: 0,
      categorie: 'boisson',
      consommationSurPlace,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

function sortiesVente(base: BaseBatte, sessionId: string) {
  return base
    .select({
      ingredientId: mouvementStock.ingredientId,
      lotId: mouvementStock.lotId,
      quantite: mouvementStock.quantite,
      coutCents: mouvementStock.coutCents,
      dateMouvement: mouvementStock.dateMouvement,
      productionId: mouvementStock.productionId,
      motifId: mouvementStock.motifId,
      isAnnule: mouvementStock.isAnnule,
    })
    .from(mouvementStock)
    .where(and(eq(mouvementStock.sessionId, sessionId), eq(mouvementStock.type, 'sortie_vente')))
    .all();
}

describe('sortirLesComposantsVente — piège n°1 : la petite quantité ne disparaît pas', () => {
  let base: BaseBatte;
  let idCannelle: string;
  let idGobelet: string;
  let idProduit: string;
  const DATE_SESSION = '2026-08-02';

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const idFournisseur = creerFournisseurTest(base);
    idCannelle = creerIngredientTest(base, 'Cannelle', 'sucre', 'g');
    idGobelet = creerIngredientTest(base, 'Gobelet carton', 'consommable', 'piece');
    idProduit = creerProduitTest(base, 'Café à emporter', false);

    // « Pour 100 cafés : 20 g de cannelle » — 0,2 g par tasse, qui
    // s'arrondirait à 0 si on l'arrondissait vente par vente.
    creerComposantVente(base, idProduit, {
      ingredientId: idCannelle,
      quantiteUniteRef: 20,
      quantiteReferenceUnites: 100,
      consommationSurPlace: null,
      optionnel: false,
    });
    // Un gobelet par café, quel que soit le mode de consommation.
    creerComposantVente(base, idProduit, {
      ingredientId: idGobelet,
      quantiteUniteRef: 1,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: false,
    });

    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-08-01',
      numeroBonLivraison: 'BL-TEST-CANNELLE',
      lignes: [
        {
          ingredientId: idCannelle,
          quantite: 1000,
          prixLigneCents: 500,
          numeroLotFournisseur: 'LOT-CANNELLE',
          dateDlc: null,
        },
        {
          ingredientId: idGobelet,
          quantite: 500,
          prixLigneCents: 2000,
          numeroLotFournisseur: 'LOT-GOBELET',
          dateDlc: null,
        },
      ],
    });
  });

  it("quatre-vingts ventes d'UN café chacune sortent 16 g de cannelle, pas 0", () => {
    const sessionId = nouvelIdentifiant();
    const ventes = Array.from({ length: 80 }, () => ({
      produitVenteId: idProduit,
      quantite: 1,
      consommationSurPlace: false,
    }));

    const resultat = sortirLesComposantsVente(base, {
      sessionId,
      dateSession: DATE_SESSION,
      ventes,
      maintenant: maintenantUtc(),
      creePar: null,
    });

    expect(resultat.ecarts).toHaveLength(0);

    const sorties = sortiesVente(base, sessionId);
    const cannelleSortie = sorties
      .filter((m) => m.ingredientId === idCannelle)
      .reduce((total, m) => total + m.quantite, 0);
    // Le calcul naif (arrondir chaque vente avant de sommer) aurait donné 0.
    expect(cannelleSortie).toBe(16);

    const gobeletsSortis = sorties
      .filter((m) => m.ingredientId === idGobelet)
      .reduce((total, m) => total + m.quantite, 0);
    expect(gobeletsSortis).toBe(80);
  });

  it('une seule ligne de vente à quantité 80 donne le même résultat que 80 lignes de 1', () => {
    const uneLigne = nouvelIdentifiant();
    sortirLesComposantsVente(base, {
      sessionId: uneLigne,
      dateSession: DATE_SESSION,
      ventes: [{ produitVenteId: idProduit, quantite: 80, consommationSurPlace: false }],
      maintenant: maintenantUtc(),
      creePar: null,
    });

    const sortiesUneLigne = sortiesVente(base, uneLigne).filter(
      (m) => m.ingredientId === idCannelle,
    );
    expect(sortiesUneLigne.reduce((t, m) => t + m.quantite, 0)).toBe(16);
  });

  it('chaque sortie porte un lot, la session, le jour du marché — aucun motif, aucune production', () => {
    const sessionId = nouvelIdentifiant();
    sortirLesComposantsVente(base, {
      sessionId,
      dateSession: DATE_SESSION,
      ventes: [{ produitVenteId: idProduit, quantite: 80, consommationSurPlace: false }],
      maintenant: maintenantUtc(),
      creePar: null,
    });

    const sorties = sortiesVente(base, sessionId);
    expect(sorties.length).toBeGreaterThan(0);
    for (const m of sorties) {
      expect(m.lotId).not.toBe('');
      expect(m.dateMouvement).toBe(DATE_SESSION);
      expect(m.productionId).toBeNull();
      expect(m.motifId).toBeNull();
      expect(m.isAnnule).toBe(false);
    }
  });

  it('le coût réel est la somme des allocations FEFO effectivement écrites', () => {
    const sessionId = nouvelIdentifiant();
    const resultat = sortirLesComposantsVente(base, {
      sessionId,
      dateSession: DATE_SESSION,
      ventes: [{ produitVenteId: idProduit, quantite: 80, consommationSurPlace: false }],
      maintenant: maintenantUtc(),
      creePar: null,
    });

    const coutEcrit = sortiesVente(base, sessionId).reduce((t, m) => t + m.coutCents, 0);
    expect(resultat.coutComposantsCents).toBe(coutEcrit);
    expect(resultat.coutComposantsCents).toBeGreaterThan(0);
  });
});

describe('sortirLesComposantsVente — piège n°2 : le mode de consommation filtre la sortie', () => {
  let base: BaseBatte;
  let idAssiette: string;
  let idProduitSurPlace: string;
  const DATE_SESSION = '2026-08-02';

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const idFournisseur = creerFournisseurTest(base);
    idAssiette = creerIngredientTest(base, 'Assiette carton', 'consommable', 'piece');
    idProduitSurPlace = creerProduitTest(base, 'Crêpe assiette', true);

    // Assiette : seulement sur place.
    creerComposantVente(base, idProduitSurPlace, {
      ingredientId: idAssiette,
      quantiteUniteRef: 1,
      quantiteReferenceUnites: 1,
      consommationSurPlace: true,
      optionnel: false,
    });

    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-08-01',
      numeroBonLivraison: 'BL-TEST-ASSIETTE',
      lignes: [
        {
          ingredientId: idAssiette,
          quantite: 50,
          prixLigneCents: 600,
          numeroLotFournisseur: 'LOT-ASSIETTE',
          dateDlc: null,
        },
      ],
    });
  });

  it('ne sort PAS l’assiette sur une vente déclarée à emporter', () => {
    const sessionId = nouvelIdentifiant();
    const resultat = sortirLesComposantsVente(base, {
      sessionId,
      dateSession: DATE_SESSION,
      ventes: [{ produitVenteId: idProduitSurPlace, quantite: 5, consommationSurPlace: false }],
      maintenant: maintenantUtc(),
      creePar: null,
    });

    expect(resultat.ecarts).toHaveLength(0);
    expect(resultat.coutComposantsCents).toBe(0);
    expect(sortiesVente(base, sessionId)).toHaveLength(0);
  });

  it('sort bien l’assiette sur une vente consommée sur place', () => {
    const sessionId = nouvelIdentifiant();
    const resultat = sortirLesComposantsVente(base, {
      sessionId,
      dateSession: DATE_SESSION,
      ventes: [{ produitVenteId: idProduitSurPlace, quantite: 5, consommationSurPlace: true }],
      maintenant: maintenantUtc(),
      creePar: null,
    });

    expect(resultat.coutComposantsCents).toBeGreaterThan(0);
    const sortiesAssiette = sortiesVente(base, sessionId).filter(
      (m) => m.ingredientId === idAssiette,
    );
    expect(sortiesAssiette.reduce((t, m) => t + m.quantite, 0)).toBe(5);
  });
});

describe('sortirLesComposantsVente — un stock insuffisant ne bloque JAMAIS', () => {
  let base: BaseBatte;
  let idGobelet: string;
  let idProduit: string;
  const DATE_SESSION = '2026-08-02';
  const QUANTITE_VENDUE = 10;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    idGobelet = creerIngredientTest(base, 'Gobelet carton', 'consommable', 'piece');
    idProduit = creerProduitTest(base, 'Café à emporter', false);

    creerComposantVente(base, idProduit, {
      ingredientId: idGobelet,
      quantiteUniteRef: 1,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: false,
    });
    // AUCUNE réception : le stock de gobelets est nul.
  });

  it("remonte l'écart au lieu d'inventer un lot, et n'écrit aucun mouvement", () => {
    const sessionId = nouvelIdentifiant();
    const resultat = sortirLesComposantsVente(base, {
      sessionId,
      dateSession: DATE_SESSION,
      ventes: [
        { produitVenteId: idProduit, quantite: QUANTITE_VENDUE, consommationSurPlace: false },
      ],
      maintenant: maintenantUtc(),
      creePar: null,
    });

    const ecart = resultat.ecarts.find((e) => e.ingredientId === idGobelet);
    expect(ecart).toBeDefined();
    expect(ecart!.quantiteManquante).toBe(QUANTITE_VENDUE);
    expect(ecart!.nomIngredient).toBe('Gobelet carton');
    expect(sortiesVente(base, sessionId)).toHaveLength(0);
    expect(resultat.coutComposantsCents).toBe(0);
  });

  it('sort ce qui est traçable et ne remonte QUE le reliquat', () => {
    const idFournisseur = creerFournisseurTest(base);
    const disponible = 4;
    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-08-01',
      numeroBonLivraison: 'BL-TEST-PARTIEL',
      lignes: [
        {
          ingredientId: idGobelet,
          quantite: disponible,
          prixLigneCents: 800,
          numeroLotFournisseur: 'LOT-GOBELET-PARTIEL',
          dateDlc: null,
        },
      ],
    });

    const sessionId = nouvelIdentifiant();
    const resultat = sortirLesComposantsVente(base, {
      sessionId,
      dateSession: DATE_SESSION,
      ventes: [
        { produitVenteId: idProduit, quantite: QUANTITE_VENDUE, consommationSurPlace: false },
      ],
      maintenant: maintenantUtc(),
      creePar: null,
    });

    const sorties = sortiesVente(base, sessionId);
    expect(sorties.reduce((t, m) => t + m.quantite, 0)).toBe(disponible);

    const ecart = resultat.ecarts.find((e) => e.ingredientId === idGobelet)!;
    expect(ecart.quantiteManquante).toBe(QUANTITE_VENDUE - disponible);
  });
});

describe('sortirLesComposantsVente — un composant DÉSACTIVÉ ne sort plus', () => {
  it('ignore un composant dont `actif` vaut faux', () => {
    const base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const idFournisseur = creerFournisseurTest(base);
    const idGobelet = creerIngredientTest(base, 'Gobelet carton', 'consommable', 'piece');
    const idProduit = creerProduitTest(base, 'Café à emporter', false);

    const composantId = creerComposantVente(base, idProduit, {
      ingredientId: idGobelet,
      quantiteUniteRef: 1,
      quantiteReferenceUnites: 1,
      consommationSurPlace: null,
      optionnel: false,
    });

    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-08-01',
      numeroBonLivraison: 'BL-TEST-DESACTIVE',
      lignes: [
        {
          ingredientId: idGobelet,
          quantite: 50,
          prixLigneCents: 2000,
          numeroLotFournisseur: 'LOT-GOBELET-DESACTIVE',
          dateDlc: null,
        },
      ],
    });

    base
      .update(produitVenteComposant)
      .set({ actif: false })
      .where(eq(produitVenteComposant.id, composantId))
      .run();

    const sessionId = nouvelIdentifiant();
    const resultat = sortirLesComposantsVente(base, {
      sessionId,
      dateSession: '2026-08-02',
      ventes: [{ produitVenteId: idProduit, quantite: 10, consommationSurPlace: false }],
      maintenant: maintenantUtc(),
      creePar: null,
    });

    expect(resultat.ecarts).toHaveLength(0);
    expect(resultat.coutComposantsCents).toBe(0);
    expect(sortiesVente(base, sessionId)).toHaveLength(0);
  });
});
