/**
 * Contrat HTTP des routes `/api/ia/*` (Lot 9).
 *
 * Le mode degrade est dans le CONTRAT, pas en marge : `disponible: false` est
 * une reponse NORMALE avec un code HTTP 200. Une assistance non configuree
 * n'est pas une erreur du serveur — c'est un etat du produit.
 */

import { z } from 'zod';

export const schemaCommentaireIa = z.discriminatedUnion('disponible', [
  z.object({
    disponible: z.literal(true),
    texte: z.string(),
    coutCents: z.int(),
  }),
  z.object({
    disponible: z.literal(false),
    raison: z.string(),
  }),
]);

export const schemaAppelIa = z.object({
  id: z.string(),
  dateAppel: z.string(),
  usage: z.enum(['prevision', 'analyse_ecart', 'extraction', 'synthese', 'evenements']),
  modele: z.string(),
  tokensEntree: z.int(),
  tokensSortie: z.int(),
  coutCents: z.int(),
  dureeMs: z.int().nullable(),
  valideeParHumain: z.boolean().nullable(),
  erreur: z.string().nullable(),
});

/**
 * Etat de l'assistance, affiche en clair a l'utilisateur.
 *
 * `configuree` dit seulement si une cle EXISTE. La cle elle-meme ne franchit
 * jamais cette frontiere (CLAUDE.md §2).
 */
export const schemaEtatIa = z.object({
  configuree: z.boolean(),
  plafondMensuelCents: z.int(),
  depenseDuMoisCents: z.int(),
  resteCents: z.int(),
  nbAppelsDuMois: z.int(),
});

export const schemaJournalIa = z.object({
  data: z.array(schemaAppelIa),
  meta: z.object({ total: z.int() }),
});

export type CommentaireIa = z.infer<typeof schemaCommentaireIa>;
export type EtatIa = z.infer<typeof schemaEtatIa>;
export type AppelIa = z.infer<typeof schemaAppelIa>;
