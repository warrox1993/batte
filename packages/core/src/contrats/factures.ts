/**
 * Contrat HTTP des routes `/api/factures` (fiche 14,
 * docs/17-VINGT-AMELIORATIONS.md § 14 : « Trois tables de facture mortes, CUMP
 * figé au bon de livraison »).
 *
 * Trois idees portees par ce contrat :
 *
 *  1. Saisir une facture RAPPROCHE ses lignes des receptions correspondantes
 *     et VENTILE immediatement les frais de reception (transport, palette) —
 *     ce sont des couts additionnels non ambigus, jamais une remise en cause
 *     d'un prix deja constate.
 *  2. L'ecart de PRIX (facture vs bon de livraison), lui, ne corrige RIEN
 *     automatiquement : il est calcule et affiche, et c'est un geste EXPLICITE
 *     (`POST /factures/lignes/:id/corriger-lot`) qui applique la correction au
 *     lot. « Il doit se voir — et il doit POUVOIR corriger » (rapport de la
 *     fiche 14), pas « il corrige en silence ».
 *  3. La correction ne s'applique JAMAIS retroactivement aux couts deja
 *     consommes (`mouvement_stock.cout_cents`, fige a la production) : elle ne
 *     touche que `lot.prix_ligne_cents`, donc seulement la valorisation FUTURE
 *     du restant du lot. Une marge de session close ne bouge jamais en
 *     silence — voir `packages/db/src/services/factures.ts` pour le detail.
 */

import { z } from 'zod';

export const schemaStatutFacture = z.enum(['a_rapprocher', 'rapprochee', 'payee', 'litige']);

/**
 * Une ligne de facture SAISIE.
 *
 * `receptionId` + `ingredientId` renseignes ensemble : la ligne se rapproche
 * d'UN lot precis (ecart de prix calcule). `receptionId` seul, `ingredientId`
 * absent : la ligne est un FRAIS DE RECEPTION (transport, palette…), ventile
 * sur tous les lots de cette reception. Ni l'un ni l'autre : une ligne de
 * facture sans impact sur le stock (ex. une prestation de service).
 */
export const schemaLigneFactureEntree = z.object({
  libelle: z.string().min(1, 'Indiquez un libellé pour cette ligne.'),
  /**
   * Montant de la ligne, en centimes ENTIERS (regle n°3). Peut etre NEGATIF :
   * une remise de fin de trimestre (docs/17 fiche 14) est une ligne de
   * facture comme une autre, elle diminue simplement le total. Jamais nul :
   * une ligne a zero ne dit rien.
   */
  montantCents: z.int().refine((v) => v !== 0, { message: 'Le montant ne peut pas être nul.' }),
  receptionId: z.string().min(1).nullable().optional(),
  ingredientId: z.string().min(1).nullable().optional(),
  quantiteUniteRef: z.int().positive().nullable().optional(),
  /**
   * Methode de repartition d'un frais de reception sur les lots de la
   * livraison. Ignoree si la ligne n'est pas un frais (c'est-a-dire si
   * `ingredientId` est renseigne). Defaut : `valeur`.
   */
  methodeRepartitionFrais: z.enum(['valeur', 'quantite']).optional(),
});

export const schemaCreationFacture = z.object({
  /** Numero de facture DU FOURNISSEUR, celui qui figure sur la piece papier. */
  numeroFournisseur: z.string().min(1, 'Indiquez le numéro de facture du fournisseur.'),
  fournisseurId: z.string().min(1, 'Choisissez un fournisseur.'),
  dateFacture: z.string().min(1, 'Indiquez la date de la facture.'),
  dateEcheance: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  lignes: z.array(schemaLigneFactureEntree).min(1, 'Une facture doit contenir au moins une ligne.'),
});

/**
 * Une ligne de facture, telle qu'affichee dans le detail.
 *
 * `ecartPrixCents` est l'ecart CONSTATE A LA SAISIE (facture − bon de
 * livraison), fige pour toujours : c'est le fait historique. `ecartResiduelCents`
 * est recalcule A LA LECTURE contre le prix ACTUEL du lot ; il vaut `0` des
 * qu'une correction a ete appliquee (`corrigerCoutLot`) — c'est ce que l'ecran
 * utilise pour savoir si le bouton « Corriger » a encore un sens.
 */
export const schemaLigneFactureDetail = z.object({
  id: z.string(),
  libelle: z.string(),
  montantCents: z.int(),
  receptionId: z.string().nullable(),
  numeroReception: z.string().nullable(),
  ingredientId: z.string().nullable(),
  nomIngredient: z.string().nullable(),
  quantiteUniteRef: z.int().nullable(),
  ecartPrixCents: z.int(),
  /** Vrai si UN SEUL lot a pu etre resolu pour cette ligne (reception + ingrédient). */
  lotResolu: z.boolean(),
  /** `null` si `lotResolu` est faux — comparer un montant a « aucun lot » n'a pas de sens. */
  ecartResiduelCents: z.int().nullable(),
  /**
   * Vrai si cette ligne est rattachée à une réception dont le statut ACTUEL
   * est `annulee` — recalculé à CHAQUE LECTURE, jamais figé à la saisie
   * (mission « deux restes de la chaîne d'achat », 31/07/2026). Le
   * rattachement est ACCEPTÉ, jamais refusé : ce champ n'est qu'un
   * AVERTISSEMENT — voir `packages/db/src/services/factures.ts`.
   */
  receptionAnnulee: z.boolean(),
});

export const schemaFactureResume = z.object({
  id: z.string(),
  numeroFournisseur: z.string(),
  fournisseurId: z.string(),
  fournisseurNom: z.string(),
  dateFacture: z.string(),
  dateEcheance: z.string().nullable(),
  montantTotalCents: z.int(),
  statut: schemaStatutFacture,
  nbLignes: z.int(),
  /** Somme des ecarts CONSTATES (`ecartPrixCents`) sur toutes les lignes de la facture. */
  ecartTotalCents: z.int(),
  /** Vrai si cette ligne EST la contre-ecriture d'annulation d'une autre facture. */
  estAnnulation: z.boolean(),
  /** Identifiant de la facture annulee par celle-ci, si `estAnnulation`. */
  factureAnnuleeId: z.string().nullable(),
  /** Vrai si une autre facture annule celle-ci. */
  estAnnulee: z.boolean(),
  creeLe: z.string(),
});

export const schemaFactureDetail = schemaFactureResume.extend({
  notes: z.string().nullable(),
  /**
   * Avertissements NON BLOQUANTS, recalculés à chaque lecture : une phrase
   * par ligne rattachée à une réception depuis annulée. Vide la plupart du
   * temps (mission « deux restes de la chaîne d'achat », 31/07/2026).
   */
  avertissements: z.array(z.string()),
  lignes: z.array(schemaLigneFactureDetail),
});

export const schemaListeFactures = z.object({
  data: z.array(schemaFactureResume),
  meta: z.object({ total: z.int() }),
});

export const schemaChangementStatutFacture = z.object({ statut: schemaStatutFacture });

/**
 * Annulation d'une facture. Le motif est OBLIGATOIRE, meme principe que
 * `annulerDepense` (`packages/db/src/depots/comptabilite.ts`) : une correction
 * sans motif ne repond pas a « pourquoi cette facture a-t-elle ete annulee ? ».
 */
export const schemaAnnulationFacture = z.object({
  motif: z.string().min(1, "Indiquez le motif de l'annulation."),
});

/** Confirmation d'une correction de coût de lot : le AVANT et le APRÈS, jamais « c'est fait ». */
export const schemaCorrectionLotAppliquee = z.object({
  factureLigneId: z.string(),
  lotId: z.string(),
  prixAvantCents: z.int(),
  prixApresCents: z.int(),
});

/**
 * Une ligne de reception ELIGIBLE au rapprochement : un lot d'une reception du
 * fournisseur choisi, avec le prix que le bon de livraison annoncait. C'est ce
 * que l'ecran de saisie propose pour rattacher une ligne de facture à sa
 * livraison d'origine.
 */
export const schemaLigneReceptionEligible = z.object({
  receptionId: z.string(),
  numeroReception: z.string(),
  dateReception: z.string(),
  ingredientId: z.string(),
  nomIngredient: z.string(),
  /** Montant payé annoncé au bon de livraison, tel qu'enregistré sur le lot. */
  prixLigneCents: z.int(),
  numeroLotFournisseur: z.string().nullable(),
});

export const schemaListeReceptionsEligibles = z.object({
  data: z.array(schemaLigneReceptionEligible),
  meta: z.object({ total: z.int() }),
});

export type StatutFacture = z.infer<typeof schemaStatutFacture>;
export type LigneFactureEntree = z.infer<typeof schemaLigneFactureEntree>;
export type CreationFacture = z.infer<typeof schemaCreationFacture>;
export type LigneFactureDetailContrat = z.infer<typeof schemaLigneFactureDetail>;
export type FactureResume = z.infer<typeof schemaFactureResume>;
export type FactureDetail = z.infer<typeof schemaFactureDetail>;
export type ListeFactures = z.infer<typeof schemaListeFactures>;
export type ChangementStatutFacture = z.infer<typeof schemaChangementStatutFacture>;
export type AnnulationFacture = z.infer<typeof schemaAnnulationFacture>;
export type CorrectionLotAppliquee = z.infer<typeof schemaCorrectionLotAppliquee>;
export type LigneReceptionEligibleContrat = z.infer<typeof schemaLigneReceptionEligible>;
export type ListeReceptionsEligibles = z.infer<typeof schemaListeReceptionsEligibles>;
