/**
 * Contrat HTTP de la NOMENCLATURE DE VENTE (fiche 15) : ce qu'un produit
 * consomme quand il est VENDU, par opposition a la recette, consommee a la
 * PRODUCTION.
 *
 * Meme convention que `contrats/recettes.ts` : le meme schema valide la
 * sortie serveur et derive le type client.
 */

import { z } from 'zod';
import { schemaUnite } from './recettes.js';

/**
 * Un composant tel qu'il sort de l'API, enrichi du cout courant de son
 * ingredient et d'un cout indicatif a l'unite vendue.
 *
 * `coutIndicatifCentsParUnite` n'est PAS un entier : c'est un chiffre
 * d'AFFICHAGE (voir `coutIndicatifComposantCents` de `@batte/core`), jamais
 * une ecriture de stock. L'arrondir ici ferait disparaitre la cannelle
 * (0,2 g x 1,5 c/g = 0,3 c, arrondi a 0) alors qu'elle pese 16 g sur cent
 * tasses vendues — exactement le piege documente en tete de
 * `nomenclature-vente.ts`.
 *
 * `cumpCentsParUnite` ET `coutIndicatifCentsParUnite` sont NULLABLES : un
 * composant jamais achete (aucun conditionnement actif sur son ingredient)
 * a un prix INCONNU, jamais gratuit. Avant ce correctif, le depot repliait
 * ce cas sur `0` (`?? 0`), ce qui affichait une marge de 100 % sur l'ecran
 * d'administration de la nomenclature — le mensonge exact que D-018 interdit
 * deja pour une recette. L'ecran doit ecrire « prix inconnu », jamais
 * « 0,00 € ».
 */
export const schemaComposantVente = z.object({
  id: z.string(),
  produitVenteId: z.string(),
  ingredientId: z.string(),
  nomIngredient: z.string(),
  unite: schemaUnite,
  /** Quantite consommee pour `quantiteReferenceUnites` UNITES VENDUES. */
  quantiteUniteRef: z.int(),
  /** Lot de reference : 1 pour un gobelet, 100 pour une pincee de cannelle. */
  quantiteReferenceUnites: z.int(),
  /** `null` = ingredient jamais achete (aucun conditionnement actif) : prix INCONNU, jamais gratuit. */
  cumpCentsParUnite: z.number().nullable(),
  allergenes: z.array(z.string()),
  /** `null` = consomme dans les deux cas ; `true`/`false` = sur place / a emporter seulement. */
  consommationSurPlace: z.boolean().nullable(),
  /**
   * `true` = OPTION servie seulement si le client la demande (creme dans un
   * cafe) ; `false` = toujours applique (le gobelet). Sert l'affichette
   * d'allergenes (`donneesAffichetteAllergenes`) : un cafe noir n'a aucun
   * allergene, le meme avec creme en a un — l'affichette doit distinguer les
   * deux, jamais les unir en silence.
   */
  optionnel: z.boolean(),
  actif: z.boolean(),
  /** `null` quand `cumpCentsParUnite` est `null` : cout INCONNU, jamais gratuit. */
  coutIndicatifCentsParUnite: z.number().nullable(),
});

export const schemaListeComposantsVente = z.object({
  data: z.array(schemaComposantVente),
  meta: z.object({ total: z.int() }),
});

/**
 * Saisie d'un composant. `quantiteReferenceUnites` par defaut a 1 (le cas
 * courant : un gobelet par tasse, une assiette par crepe servie sur place) —
 * seule une petite quantite (cannelle, sel) exige de l'augmenter pour ne pas
 * s'arrondir a zero (voir l'en-tete de `nomenclature-vente.ts`).
 */
export const schemaSaisieComposantVente = z.object({
  ingredientId: z.string().min(1, 'Choisissez l’ingrédient consommé à la vente.'),
  quantiteUniteRef: z
    .int('La quantité doit être un nombre entier, dans l’unité de l’ingrédient.')
    .positive('La quantité doit être strictement positive.'),
  quantiteReferenceUnites: z
    .int('Le lot de référence doit être un nombre entier d’unités vendues.')
    .positive('Le lot de référence doit être strictement positif.')
    .default(1),
  /**
   * `undefined` cote formulaire (case a trois etats non cochee) devient
   * `null` cote donnees : « consomme dans les deux cas ». Une saisie qui
   * omettrait ce transform laisserait passer `undefined`, que
   * `exactOptionalPropertyTypes` distingue de `null` — la colonne, elle,
   * n'admet que les deux valeurs booleennes ou `NULL`.
   */
  consommationSurPlace: z
    .boolean()
    .nullish()
    .transform((valeur) => valeur ?? null),
  /**
   * Par defaut `false` (toujours applique, comme un gobelet) : c'est le cas
   * courant. Seule une vraie OPTION (creme, sucre en plus) doit etre cochee —
   * c'est ce qui permet a l'affichette d'annoncer separement ce qui est
   * « sur demande » plutot que d'unir en silence tous les allergenes possibles.
   */
  optionnel: z.boolean().default(false),
});

export type ComposantVente = z.infer<typeof schemaComposantVente>;
export type ListeComposantsVente = z.infer<typeof schemaListeComposantsVente>;
export type SaisieComposantVente = z.infer<typeof schemaSaisieComposantVente>;
