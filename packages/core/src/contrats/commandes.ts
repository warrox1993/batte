/**
 * Contrat HTTP des routes `/api/commandes` (Lot 7).
 *
 * D-009 (docs/05-DECISIONS.md) : l'envoi n'est jamais automatique. Le contrat
 * reflete les TROIS etapes distinctes — generation, validation, envoi — sans
 * qu'aucune route ne permette de sauter de `brouillon` a `envoyee`.
 */

import { z } from 'zod';
import { schemaUnite } from './recettes.js';

export const schemaStatutCommande = z.enum(['brouillon', 'validee', 'envoyee', 'recue', 'annulee']);

/** Une ligne de commande, telle qu'affichee dans le detail. */
export const schemaLigneCommande = z.object({
  id: z.string(),
  ingredientId: z.string(),
  nomIngredient: z.string(),
  unite: schemaUnite,
  conditionnementLibelle: z.string().nullable(),
  quantiteConditionnements: z.int(),
  quantiteUniteRef: z.int(),
  /**
   * Montant de la ligne, en centimes ENTIERS (regle n°3). C'est la donnee
   * stockee et c'est ce que l'utilisateur relit sur son bon de commande.
   * `montantLigneCents` en est l'alias historique, conserve pour ne pas
   * renommer un champ deja affiche.
   */
  prixLigneCents: z.int().nonnegative(),
  /** Taux DERIVE (`prixLigneCents / quantiteUniteRef`) : fractionnaire, jamais persiste. */
  prixUnitaireCents: z.number(),
  montantLigneCents: z.int(),
});

export const schemaCommandeResume = z.object({
  id: z.string(),
  numero: z.string(),
  fournisseurId: z.string(),
  fournisseurNom: z.string(),
  statut: schemaStatutCommande,
  dateCreation: z.string(),
  dateEnvoi: z.string().nullable(),
  montantTotalCents: z.int(),
  nbLignes: z.int(),
  genereAutomatiquement: z.boolean(),
  /**
   * Numéro de la réception la plus récente qui référence cette commande
   * (`reception.commande_id`), `null` si aucune ne la référence encore.
   * Referme la boucle d'achat dans le sens commande -> réception (audit du
   * 30/07/2026, `packages/db/src/audit-colonnes-orphelines.test.ts`).
   */
  receptionNumero: z.string().nullable(),
  /**
   * Statut de cette même réception. Permet de repérer une commande affichée
   * `recue` dont la réception qui l'avait soldée a ensuite été annulée —
   * `annulerReception` (`packages/db/src/services/reception.ts`) ne revient
   * jamais sur le statut de la commande.
   */
  receptionStatut: z.enum(['active', 'annulee']).nullable(),
});

/**
 * Une réception qui référence cette commande (`reception.commande_id`).
 * Voir `schemaCommandeResume.receptionNumero`/`receptionStatut` ci-dessus
 * pour le résumé de liste ; ce schéma porte le détail complet affiché sur la
 * fiche commande.
 */
export const schemaReceptionLiee = z.object({
  id: z.string(),
  numero: z.string(),
  dateReception: z.string(),
  /** `null` si le montant total de cette réception n'a jamais été renseigné. */
  montantTotalCents: z.int().nullable(),
  statut: z.enum(['active', 'annulee']),
});

export const schemaCommandeDetail = schemaCommandeResume.extend({
  dateReceptionPrevue: z.string().nullable(),
  emailEnvoyeA: z.string().nullable(),
  /** Repli propose par la route d'envoi quand aucune adresse n'est saisie. */
  fournisseurEmail: z.string().nullable(),
  notes: z.string().nullable(),
  lignes: z.array(schemaLigneCommande),
  /** Toutes les réceptions référençant cette commande, la plus récente d'abord. */
  receptionsLiees: z.array(schemaReceptionLiee),
  /**
   * LE FAIT « ce mail-là est-il parti ? », PERSISTÉ (journal d'audit, voir
   * `packages/db/src/services/commandes.ts::envoiModeTestConnu` — aucune
   * colonne dédiée, hors zone d'écriture). `true` = mode test, rien envoyé au
   * fournisseur (fichier écrit) ; `false` = envoi réel ; `null` = fait
   * INCONNU (commande envoyée avant ce correctif, ou jamais envoyée).
   *
   * `null` ne doit JAMAIS être lu comme « envoi réel » (CLAUDE.md, doctrine
   * « une valeur inconnue vaut `null`, jamais `false` ») : mission « le seul
   * piège silencieux qui reste » (01/08/2026) — avant ce champ, le mode test
   * n'était connu que dans la réponse HTTP de l'envoi lui-même, jamais relu
   * après un rechargement de page. La commande se relisait alors exactement
   * comme un envoi réel, quel que soit son mode réel d'envoi.
   */
  envoiModeTest: z.boolean().nullable(),
  /** Chemin du fichier écrit en mode test. Non `null` seulement si `envoiModeTest` est `true`. */
  cheminFichierTest: z.string().nullable(),
});

export const schemaListeCommandes = z.object({
  data: z.array(schemaCommandeResume),
  meta: z.object({ total: z.int() }),
});

/**
 * Requete de generation. `jourReference` est optionnel : par defaut, le jour
 * civil belge du jour meme (« calcul quotidien du point de commande »,
 * docs/01 module 2). Le surcharger sert surtout aux tests et a un rattrapage
 * manuel apres plusieurs jours sans lancer l'application.
 */
export const schemaGenerationCommandesRequete = z.object({
  jourReference: z.string().min(1).optional(),
});

/** Ingredient sous le point de commande mais qu'on n'a pas pu commander automatiquement. */
export const schemaIngredientIgnore = z.object({
  ingredientId: z.string(),
  nomIngredient: z.string(),
  motif: z.string(),
});

export const schemaResultatGeneration = z.object({
  data: z.array(schemaCommandeResume),
  meta: z.object({
    total: z.int(),
    ingredientsIgnores: z.array(schemaIngredientIgnore),
  }),
});

/**
 * Requete d'envoi. `email` est optionnel : a defaut, la route retombe sur
 * l'email declare du fournisseur — mais n'invente jamais une adresse.
 */
export const schemaEnvoiCommandeRequete = z.object({
  email: z.email().optional(),
});

/**
 * Reponse de l'envoi : le detail a jour, plus la trace du mode test.
 *
 * `envoiModeTest` est ici TOUJOURS connu (jamais `null`, contrairement au
 * meme champ sur `schemaCommandeDetail`) : cette reponse est celle de
 * l'appel qui vient lui-meme de declencher l'envoi — le fait n'a pas encore
 * eu l'occasion de se perdre.
 */
export const schemaResultatEnvoiCommande = schemaCommandeDetail.extend({
  envoiModeTest: z.boolean(),
});

/**
 * Requete d'annulation. `motif` est facultatif : il reutilise la colonne
 * `notes` existante de la commande (audit du 29/07/2026 — `annulee` existait
 * dans l'enum de statut sans que rien ne l'ecrive, voir
 * `packages/db/src/services/commandes.ts::annulerCommande`).
 */
export const schemaAnnulationCommandeRequete = z.object({
  motif: z.string().trim().max(500, 'Le motif ne peut pas dépasser 500 caractères.').optional(),
});

export type StatutCommande = z.infer<typeof schemaStatutCommande>;
export type LigneCommandeContrat = z.infer<typeof schemaLigneCommande>;
export type CommandeResume = z.infer<typeof schemaCommandeResume>;
export type ReceptionLiee = z.infer<typeof schemaReceptionLiee>;
export type CommandeDetail = z.infer<typeof schemaCommandeDetail>;
export type ListeCommandes = z.infer<typeof schemaListeCommandes>;
export type GenerationCommandesRequete = z.infer<typeof schemaGenerationCommandesRequete>;
export type IngredientIgnore = z.infer<typeof schemaIngredientIgnore>;
export type ResultatGeneration = z.infer<typeof schemaResultatGeneration>;
export type EnvoiCommandeRequete = z.infer<typeof schemaEnvoiCommandeRequete>;
export type ResultatEnvoiCommande = z.infer<typeof schemaResultatEnvoiCommande>;
export type AnnulationCommandeRequete = z.infer<typeof schemaAnnulationCommandeRequete>;
