/**
 * Contrat HTTP du palmarès (`GET /api/palmares/produits`,
 * `GET /api/palmares/fournisseurs`) — voir `packages/core/src/palmares.ts`
 * pour la logique et sa justification complète.
 */

import { z } from 'zod';

export const schemaCritereProduit = z.enum([
  'marge_totale',
  'marge_unitaire',
  'volume_vendu',
  'marge_par_minute_cuisson',
]);
export type CritereProduitContrat = z.infer<typeof schemaCritereProduit>;

export const schemaCritereFournisseur = z.enum([
  'economie_generee',
  'fiabilite_facturation',
  'prix_comparable',
  'delai_livraison',
  'qualite_produit',
]);
export type CritereFournisseurContrat = z.infer<typeof schemaCritereFournisseur>;

export const schemaPeriodePalmares = z.object({
  debut: z.string(),
  fin: z.string(),
  jours: z.int(),
});
export type PeriodePalmaresContrat = z.infer<typeof schemaPeriodePalmares>;

/* ═══════════════════════════════════════════════════════════════════════════
   Produits
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaLigneClassementProduit = z.object({
  produitVenteId: z.string(),
  nom: z.string(),
  nature: z.enum(['transforme', 'revendu']),
  volumeVendu: z.int(),
  caGenereCents: z.int(),
  margeTotaleGenereeCents: z.int().nullable(),
  margeUnitaireMoyenneCents: z.int().nullable(),
  margeParMinuteCuissonCents: z.null(),
  raisonMargeParMinuteCuissonIndisponible: z.string(),
});
export type LigneClassementProduitContrat = z.infer<typeof schemaLigneClassementProduit>;

export const schemaDivergenceClassementProduits = z.object({
  nature: z.enum(['transforme', 'revendu']),
  nomPlusVendu: z.string(),
  nomPlusRentable: z.string(),
});
export type DivergenceClassementProduitsContrat = z.infer<
  typeof schemaDivergenceClassementProduits
>;

export const schemaGroupePalmaresProduits = z.object({
  nature: z.enum(['transforme', 'revendu']),
  lignes: z.array(schemaLigneClassementProduit),
  echantillonSuffisant: z.boolean(),
  raisonEchantillonInsuffisant: z.string().nullable(),
  divergenceVenteRentabilite: schemaDivergenceClassementProduits.nullable(),
});
export type GroupePalmaresProduitsContrat = z.infer<typeof schemaGroupePalmaresProduits>;

export const schemaPalmaresProduits = z.object({
  periode: schemaPeriodePalmares,
  seuilMinimumEchantillon: z.int(),
  nbSessionsClosesPeriode: z.int(),
  groupes: z.array(schemaGroupePalmaresProduits),
});
export type PalmaresProduitsContrat = z.infer<typeof schemaPalmaresProduits>;

/* ═══════════════════════════════════════════════════════════════════════════
   Fournisseurs
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaLigneClassementFournisseur = z.object({
  fournisseurId: z.string(),
  nom: z.string(),
  economieGenereeCents: z.int(),
  fiabiliteFacturationBp: z.int().nullable(),
  nbFacturesConsiderees: z.int(),
  prixComparableEcartBp: z.int().nullable(),
  nbIngredientsComparables: z.int(),
  delaiLivraisonJours: z.null(),
  qualiteProduitScore: z.null(),
});
export type LigneClassementFournisseurContrat = z.infer<typeof schemaLigneClassementFournisseur>;

export const schemaPalmaresFournisseurs = z.object({
  periode: schemaPeriodePalmares,
  seuilMinimumEchantillon: z.int(),
  nbFacturesConsiderees: z.int(),
  nbLignesEconomiesConsiderees: z.int(),
  echantillonSuffisant: z.boolean(),
  raisonEchantillonInsuffisant: z.string().nullable(),
  raisonDelaiLivraisonIndisponible: z.string(),
  raisonQualiteProduitIndisponible: z.string(),
  lignes: z.array(schemaLigneClassementFournisseur),
});
export type PalmaresFournisseursContrat = z.infer<typeof schemaPalmaresFournisseurs>;
