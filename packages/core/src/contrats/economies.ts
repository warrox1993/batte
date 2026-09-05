/**
 * Contrat HTTP des routes `/api/economies` (fiche 12 — suivi des économies
 * d'achat). Même convention que les autres fichiers de `contrats/` : un seul
 * schéma valide la sortie côté serveur ET dérive le type côté client.
 *
 * `economieCents` est un champ de SORTIE uniquement — il n'apparaît dans
 * AUCUN schéma de saisie ci-dessous. C'est la traduction, au niveau du
 * contrat, de la décision prise dans `packages/core/src/economies.ts` et
 * `packages/db/src/schema.ts` : l'économie se calcule, elle ne se saisit
 * jamais. Un formulaire qui accepterait `economieCents` en entrée ouvrirait
 * exactement la brèche que ce module a été construit pour fermer.
 */

import { z } from 'zod';
import { estJourCivilValide } from '../horodatage.js';
import { TYPES_ACTION_ECONOMIE } from '../economies.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Champs communs (mêmes conventions que contrats/referentiel.ts)
   ═══════════════════════════════════════════════════════════════════════════ */

const champJourCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ, par exemple 2026-07-28.')
  // La FORME ne suffit pas : `2026-02-30` la respecte et n'existe pas.
  .refine(estJourCivilValide, 'Cette date n’existe pas au calendrier.');

/** Champ texte facultatif : `''` et `undefined` deviennent tous deux `null`. */
const champTexteFacultatif = z
  .string()
  .nullish()
  .transform((valeur) => {
    if (valeur === undefined || valeur === null) return null;
    const nettoye = valeur.trim();
    return nettoye === '' ? null : nettoye;
  });

/** Identifiant facultatif (conditionnement, commande) : `''` devient `null`. */
const champIdFacultatif = champTexteFacultatif;

export const schemaTypeActionEconomie = z.enum(TYPES_ACTION_ECONOMIE);

/* ═══════════════════════════════════════════════════════════════════════════
   Ligne d'économie — lecture
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaEconomieLigne = z.object({
  id: z.string(),
  dateAction: z.string(),
  ingredientId: z.string(),
  ingredientNom: z.string(),
  fournisseurId: z.string(),
  fournisseurNom: z.string(),
  conditionnementId: z.string().nullable(),
  conditionnementLibelle: z.string().nullable(),
  typeAction: schemaTypeActionEconomie,
  description: z.string(),
  prixUnitaireAvantCents: z.int(),
  prixUnitaireApresCents: z.int(),
  quantiteConcernee: z.int(),
  /** Toujours DÉRIVÉ par le serveur — voir l'en-tête de ce fichier. */
  economieCents: z.int(),
  commandeId: z.string().nullable(),
  commandeNumero: z.string().nullable(),
  saisiPar: z.string().nullable(),
  creeLe: z.string(),
});

export const schemaListeEconomies = z.object({
  data: z.array(schemaEconomieLigne),
  meta: z.object({ total: z.int(), economieTotaleCents: z.int() }),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Saisie libre — formulaire d'économie constatée hors réception (le
   troisième type Mithra : remplacement par du stock immobilisé) et,
   plus généralement, toute économie qui n'accompagne pas une renégociation
   de tarif de conditionnement.
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaCreationEconomie = z.object({
  dateAction: champJourCivil,
  ingredientId: z.string().min(1, "Choisissez l'ingrédient concerné."),
  fournisseurId: z.string().min(1, 'Choisissez le fournisseur concerné.'),
  conditionnementId: champIdFacultatif,
  typeAction: schemaTypeActionEconomie,
  description: z
    .string()
    .trim()
    .min(
      1,
      'Décrivez l’action menée : c’est la justification de l’économie, comme au classeur source.',
    ),
  prixUnitaireAvantCents: z
    .int('Le prix "avant" doit être un nombre entier de centimes.')
    .nonnegative('Le prix "avant" ne peut pas être négatif.'),
  prixUnitaireApresCents: z
    .int('Le prix "après" doit être un nombre entier de centimes.')
    .nonnegative('Le prix "après" ne peut pas être négatif.'),
  quantiteConcernee: z
    .int('La quantité concernée doit être un nombre entier.')
    .positive('La quantité concernée doit être strictement positive.'),
  commandeId: champIdFacultatif,
  saisiPar: champTexteFacultatif,
});

export type CreationEconomie = z.infer<typeof schemaCreationEconomie>;

/* ═══════════════════════════════════════════════════════════════════════════
   Renégociation de tarif — LE point d'accroche de la fiche : au moment
   d'enregistrer un nouveau prix de conditionnement, si le prix baisse,
   l'économie est enregistrée automatiquement, dans le même appel.
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaRenegociationTarif = z.object({
  conditionnementId: z.string().min(1, 'Choisissez le conditionnement dont le tarif change.'),
  prixCents: z
    .int('Le nouveau prix doit être un nombre entier de centimes.')
    .nonnegative('Le prix ne peut pas être négatif.'),
  datePrix: champJourCivil,
  referenceFournisseur: champTexteFacultatif,
  /**
   * Le volume concerné par la négociation — « sur un volume donné », dans les
   * termes du critère de fin de la fiche — exprimé dans la MÊME unité de
   * négociation que `prixCents` (voir `packages/db/src/schema.ts`, colonne
   * `prix_unitaire_*_cents` : le kg, le carton, le conditionnement lui-même…).
   * Distinct de `conditionnement.quantite_unite_ref` (la contenance d'UN
   * conditionnement) : une négociation porte souvent sur plusieurs
   * livraisons à venir, pas sur un seul sac.
   */
  quantiteConcernee: z
    .int('La quantité concernée doit être un nombre entier.')
    .positive('La quantité concernée doit être strictement positive.'),
  /** Description personnalisée ; à défaut, une description par défaut est composée côté dépôt. */
  description: champTexteFacultatif,
  saisiPar: champTexteFacultatif,
});

export type RenegociationTarif = z.infer<typeof schemaRenegociationTarif>;

export const schemaResultatRenegociation = z.object({
  conditionnementId: z.string(),
  ancienPrixCents: z.int(),
  nouveauPrixCents: z.int(),
  /** `null` quand le nouveau prix n'est pas inférieur à l'ancien : le tarif a
   * bien changé, mais ce n'est pas une économie — rien n'est enregistré. */
  economie: schemaEconomieLigne.nullable(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Détection — pour proposer l'écart AVANT saisie (réception, ou tout autre
   point d'entrée), sans dupliquer le calcul.
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaDetectionEconomie = z.object({
  /**
   * Prix de référence actuellement actif pour ce couple ingrédient/fournisseur,
   * `null` si aucun conditionnement actif n'existe OU si plusieurs formats
   * actifs de contenances différentes coexistent sans contenance candidate
   * fournie pour trancher (voir `packages/db/src/depots/economies.ts`,
   * audit du 29/07/2026). `number` et non `int` : ramené à l'unité de
   * référence de l'ingrédient, ce prix peut être fractionnaire — jamais
   * stocké, seulement affiché (même exception que `prixUnitaireCents`, D-044).
   */
  prixReferenceCents: z.number().nullable(),
  /** `prixReferenceCents - prixPropose`, `null` si aucune référence n'existe. */
  economieUnitaireCents: z.number().nullable(),
  /** Vraie seulement si l'écart est strictement positif : c'est elle qui pilote l'affichage de la proposition. */
  economiePotentielle: z.boolean(),
  /** Franco de port du fournisseur comparé. `null` si non renseigné ou fournisseur introuvable. */
  francoDePortCents: z.int().nullable(),
  /** Commande minimum du fournisseur comparé, mêmes remarques. */
  commandeMinimumCents: z.int().nullable(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Tableau de bord — feuille « CHART_COST REDUCTION » du fichier source
   ═══════════════════════════════════════════════════════════════════════════ */

const schemaMontantsParType = z.object({
  negociation_prix: z.int(),
  achat_alternatif: z.int(),
  remplacement_stock_immobilise: z.int(),
  autre: z.int(),
});

export const schemaVentilationMensuelle = z.object({
  mois: z.string(),
  parType: schemaMontantsParType,
  totalCents: z.int(),
});

export const schemaVentilationParType = z.object({
  typeAction: schemaTypeActionEconomie,
  totalCents: z.int(),
  nbActions: z.int(),
});

export const schemaTableauBordEconomies = z.object({
  periode: z.object({ debut: z.string(), fin: z.string() }),
  totalCents: z.int(),
  nbActions: z.int(),
  parMois: z.array(schemaVentilationMensuelle),
  parType: z.array(schemaVentilationParType),
  /**
   * Part de la marge brute de la période due aux économies, en points de
   * base. `null` quand la marge de la période n'est pas connue ou pas
   * strictement positive (voir `partMargeDueAuxEconomiesBp` dans
   * `packages/core/src/economies.ts`) — jamais un chiffre inventé.
   */
  partMargeBp: z.int().nullable(),
});

export type EconomieLigneContrat = z.infer<typeof schemaEconomieLigne>;
export type ListeEconomiesContrat = z.infer<typeof schemaListeEconomies>;
export type ResultatRenegociationContrat = z.infer<typeof schemaResultatRenegociation>;
export type DetectionEconomieContrat = z.infer<typeof schemaDetectionEconomie>;
export type TableauBordEconomiesContrat = z.infer<typeof schemaTableauBordEconomies>;
export type VentilationMensuelleContrat = z.infer<typeof schemaVentilationMensuelle>;
export type VentilationParTypeContrat = z.infer<typeof schemaVentilationParType>;
