/**
 * Contrat HTTP des routes `/api/recettes` (docs/06 — conventions d'API).
 *
 * Le meme schema valide la sortie cote serveur et derive le type cote client :
 * les deux cotes ne peuvent pas diverger en silence.
 */

import { z } from 'zod';

export const schemaUnite = z.enum(['g', 'ml', 'piece']);
export const schemaStatutRecette = z.enum(['brouillon', 'active', 'archivee']);

/** Ligne d'ingredient d'une recette, enrichie de ce qu'il faut pour calculer. */
export const schemaLigneRecette = z.object({
  ingredientId: z.string(),
  nomIngredient: z.string(),
  unite: schemaUnite,
  quantiteReference: z.int(),
  /**
   * Cout unitaire courant, en centimes par unite de reference. `null` quand
   * l'ingredient n'a aucun conditionnement actif : un prix INCONNU, jamais un
   * prix GRATUIT (audit 29/07/2026, defaut n°1 ; D-018).
   */
  cumpCentsParUnite: z.number().nullable(),
  allergenes: z.array(z.string()),
  ordre: z.int(),
  /**
   * Note du GESTE pour cette ligne (« beurre noisette, ne pas dépasser la
   * coloration »), saisie sur `recette_ligne.note_technique`. CE N'EST PAS UN
   * ALLERGÈNE (CLAUDE.md §7) : les deux informations ont des exigences
   * différentes, et cette note ne complète ni ne remplace jamais une
   * déclaration d'allergènes — un allergène inconnu doit rester inconnu.
   * `null` = aucune note saisie pour cette ligne.
   *
   * Optionnel (`.optional()`) : `POST /recettes/:id/calculer`
   * (`apps/api/src/routes/recettes.ts`) construit ses lignes directement
   * depuis `mettreAEchelle` (`@batte/core`, fonction pure de mise à
   * l'échelle), qui ne connaît pas cette note — ce n'est pas une donnée
   * calculée, juste un texte attaché à l'ingrédient. Cette route reste donc
   * valide sans ce champ ; `lireRecetteDetail` (`@batte/db`), lui, le fournit
   * toujours.
   */
  noteTechnique: z.string().nullable().optional(),
});

/** Vue de liste : ce qui suffit a choisir une recette. */
export const schemaRecetteResume = z.object({
  id: z.string(),
  code: z.string(),
  nom: z.string(),
  version: z.int(),
  statut: schemaStatutRecette,
  sansGluten: z.boolean(),
  rendementReferenceMl: z.int(),
  rendementReferenceCrepes: z.int(),
  nbLignes: z.int(),
  /**
   * `null` quand la recette n'a pas encore de ligne : on n'affiche pas « 0,00 € »
   * pour une recette vide, ce serait un chiffre faux presente comme une donnee.
   */
  coutParCrepeCents: z.number().nullable(),
});

export const schemaRecetteDetail = schemaRecetteResume.extend({
  typePate: z.string(),
  perteCuissonBp: z.int(),
  tauxCasseBp: z.int(),
  perteFixeMl: z.int(),
  procede: z.string().nullable(),
  notes: z.string().nullable(),
  dateActivation: z.string().nullable(),
  lignes: z.array(schemaLigneRecette),
});

export const schemaListeRecettes = z.object({
  data: z.array(schemaRecetteResume),
  meta: z.object({ total: z.int() }),
});

/**
 * Cible de mise a l'echelle. `crepes` designe des crepes VENDABLES : la perte
 * de cuisson et la casse sont compensees a la hausse, parce que c'est le seul
 * chiffre qui ait un sens commercial (« il m'en faut 200 a vendre »).
 */
export const schemaCibleCalcul = z.discriminatedUnion('cible', [
  z.object({ cible: z.literal('crepes'), valeur: z.int().positive() }),
  z.object({ cible: z.literal('volume'), valeur: z.int().positive() }),
  z.object({
    cible: z.literal('ingredient'),
    valeur: z.int().positive(),
    ingredientId: z.string().min(1),
  }),
]);

export const schemaLigneCalculee = schemaLigneRecette.extend({
  quantite: z.int(),
  /** `null` quand `cumpCentsParUnite` est `null` : cout INCONNU, pas gratuit. */
  coutCents: z.int().nullable(),
});

export const schemaResultatCalcul = z.object({
  facteur: z.number(),
  volumeMl: z.int(),
  crepesTheoriques: z.int(),
  crepesVendables: z.int(),
  lignes: z.array(schemaLigneCalculee),
  /**
   * `null` des qu'UNE SEULE ligne a un cout inconnu (audit 29/07/2026, defaut
   * n°1) : un total dont une ligne est inconnue est lui-meme inconnu, pas une
   * somme partielle presentee comme complete.
   */
  coutMatiereCents: z.int().nullable(),
  /**
   * `null` quand la recette ne produit AUCUNE crepe vendable, OU quand
   * `coutMatiereCents` est lui-meme inconnu.
   *
   * Un `0` passait le filtre `!== null` du depot de previsions et tirait le
   * cout moyen vers le bas, donc sous-estimait le cout d'un invendu, donc
   * faisait surproduire. Meme raisonnement que D-018 sur le CUMP : « zero
   * ferait apparaitre une marge de 100 % sur la production suivante ».
   */
  coutParCrepeCents: z.int().nullable(),
  allergenes: z.array(z.string()),
});

/* ───────────────────────────────────────────────────────────────────────────
   Cout de revient d'un produit vendu (pate + garnitures + composants de vente)
   ─────────────────────────────────────────────────────────────────────────── */

/** Une garniture chiffree : ce qui s'ajoute a la crepe et ce que ca coute. */
export const schemaGarnitureChiffree = z.object({
  ingredientId: z.string(),
  nomIngredient: z.string(),
  unite: schemaUnite,
  /** Quantite par UNITE VENDUE, dans l'unite de reference de l'ingredient. */
  quantiteParUnite: z.int(),
  /** `null` quand l'ingredient n'a aucun conditionnement actif : prix INCONNU, jamais gratuit. */
  cumpCentsParUnite: z.number().nullable(),
  /** `null` quand `cumpCentsParUnite` est `null`. */
  coutCents: z.int().nullable(),
  allergenes: z.array(z.string()),
});

/**
 * Un composant de NOMENCLATURE DE VENTE chiffre (fiche 15) : ce qu'un produit
 * consomme AU MOMENT DE LA VENTE (cafe fait a la tasse, gobelet, options),
 * enrichi de son cout au CUMP courant.
 *
 * Sert le cout de revient CATALOGUE (`coutRevientProduit`,
 * `packages/db/src/depots/recettes.ts`), qui jusqu'ici n'en tirait que les
 * allergenes (mission du 01/08/2026) — un produit entierement fait de
 * composants de vente (le cafe, `consommationUnite: 'nomenclature'`, D-085)
 * n'avait donc JAMAIS de cout matiere chiffrable, meme quand tous ses
 * ingredients avaient un prix connu.
 *
 * `inclusDansLeCout` distingue ce qui COMPTE dans `coutComposantsCents` de ce
 * qui reste affiche a titre informatif : une ligne EXCLUE reste dans le
 * tableau, elle n'est jamais retiree silencieusement (voir
 * `coutsComposantsVente` ci-dessous pour les deux regles d'exclusion).
 */
export const schemaComposantVenteChiffre = z.object({
  ingredientId: z.string(),
  nomIngredient: z.string(),
  unite: schemaUnite,
  /** Quantite pour `quantiteReferenceUnites` UNITES VENDUES (lot de reference, fiche 15 §4.1). */
  quantiteUniteRef: z.int(),
  quantiteReferenceUnites: z.int(),
  /** `null` quand l'ingredient n'a aucun conditionnement actif : prix INCONNU, jamais gratuit. */
  cumpCentsParUnite: z.number().nullable(),
  /** Cout par unite vendue, arrondi pour l'affichage. `null` quand `cumpCentsParUnite` est `null`. */
  coutCents: z.int().nullable(),
  allergenes: z.array(z.string()),
  /** `true` = option servie sur demande (creme d'un cafe) : n'entre JAMAIS dans `coutComposantsCents`. */
  optionnel: z.boolean(),
  /** `null` = consomme quel que soit le mode. `true`/`false` = seulement sur place / a emporter. */
  consommationSurPlace: z.boolean().nullable(),
  /** Vrai si cette ligne compte dans `coutComposantsCents` du produit : ni optionnelle, ni hors de son mode de consommation fixe. */
  inclusDansLeCout: z.boolean(),
});

export const schemaCoutProduitVendu = z.object({
  produitVenteId: z.string(),
  nom: z.string(),
  nature: z.enum(['transforme', 'revendu']),
  prixVenteCents: z.int(),
  coutPateCents: z.int(),
  coutAchatCents: z.int(),
  /** `null` des qu'une garniture a un prix inconnu. */
  coutGarnituresCents: z.int().nullable(),
  /** `null` des qu'un composant de vente INCLUS (non optionnel, mode compatible) a un prix inconnu. */
  coutComposantsCents: z.int().nullable(),
  /** `null` des qu'une composante manque : un total ampute serait un chiffre faux. */
  coutMatiereCents: z.int().nullable(),
  /** Marge brute unitaire. `null` quand le cout ne peut pas etre etabli. */
  margeCents: z.int().nullable(),
  /** Taux de marge en points de base — jamais un flottant de pourcentage. */
  margeBp: z.int().nullable(),
  garnitures: z.array(schemaGarnitureChiffree),
  /** Composants de nomenclature de vente (fiche 15) : cafe, consommables, options. Vide pour un produit sans nomenclature declaree. */
  composants: z.array(schemaComposantVenteChiffre),
  allergenes: z.array(z.string()),
});

export const schemaListeCoutsProduits = z.object({
  data: z.array(schemaCoutProduitVendu),
  meta: z.object({ total: z.int() }),
});

export type GarnitureChiffree = z.infer<typeof schemaGarnitureChiffree>;
export type ComposantVenteChiffre = z.infer<typeof schemaComposantVenteChiffre>;
export type CoutProduitVenduContrat = z.infer<typeof schemaCoutProduitVendu>;
export type ListeCoutsProduits = z.infer<typeof schemaListeCoutsProduits>;

/**
 * Un composant de nomenclature de vente, deja resolu par le depot (prix,
 * quantites, drapeaux) : type d'ENTREE pur de `coutsComposantsVente`
 * ci-dessous, jamais valide par Zod (il ne traverse aucune frontiere HTTP,
 * seulement depot -> fonction pure — meme statut que `LigneVenteCreneauBrute`
 * de `contrats/comptabilite.ts`).
 */
export type ComposantVenteEntree = {
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly unite: z.infer<typeof schemaUnite>;
  readonly quantiteUniteRef: number;
  readonly quantiteReferenceUnites: number;
  /** `null` quand l'ingredient n'a aucun conditionnement actif : prix INCONNU, jamais gratuit (D-018). */
  readonly cumpCentsParUnite: number | null;
  readonly allergenes: readonly string[];
  /** `true` = option servie sur demande (creme d'un cafe). */
  readonly optionnel: boolean;
  /** `null` = consomme quel que soit le mode de consommation. */
  readonly consommationSurPlace: boolean | null;
};

/**
 * Cout de revient des composants de NOMENCLATURE DE VENTE d'un produit
 * (fiche 15) — ce qui manquait a `coutRevientProduit`
 * (`packages/db/src/depots/recettes.ts`), qui n'en tirait jusqu'ici que les
 * allergenes : un produit ENTIEREMENT fait de composants de vente (le cafe,
 * `consommationUnite: 'nomenclature'`, D-085) n'avait donc JAMAIS de cout
 * matiere chiffrable, meme quand tous ses ingredients avaient un prix connu.
 *
 * DEUX ARBITRAGES, tranches ici (mission du 01/08/2026) :
 *
 *  1. **Un composant OPTIONNEL n'entre jamais dans le total.** Le prix de
 *     vente catalogue ne varie pas selon l'option choisie (une tasse de cafe
 *     coute le meme prix nature ou avec creme), et une option n'est prise
 *     qu'A LA DEMANDE : la compter systematiquement surestimerait le cout de
 *     CHAQUE unite vendue nature pour ne refleter que celles vendues avec
 *     l'option. C'est le meme statut qu'une garniture NON declaree sur la
 *     fiche — `produit_garniture` (TOUJOURS appliquee) reste le bon endroit
 *     pour un ajout systematique ; un composant optionnel n'en est pas un.
 *  2. **`consommationSurPlace` doit correspondre au mode FIXE du produit**
 *     (`produitVente.consommationSurPlace`, colonne NOT NULL — un produit du
 *     catalogue a UN SEUL mode declare, pas un mode par vente comme en
 *     cloture de session). Un gobelet jetable (`consommationSurPlace: false`)
 *     n'entre pas dans le cout catalogue d'un produit consomme sur place.
 *     `null` sur le composant = consomme dans les deux cas, toujours inclus.
 *
 * Chaque ligne EXCLUE du total reste dans le tableau rendu
 * (`inclusDansLeCout: false`) : la transparence prime, un composant qui ne
 * compte pas n'est pas un composant cache.
 *
 * `coutComposantsCents` vaut `null` des qu'UN SEUL composant INCLUS n'a aucun
 * prix connu (`cumpCentsParUnite: null`) : un total partiellement inconnu
 * n'est pas une somme partielle presentable comme complete (D-018, meme
 * doctrine que les garnitures et les lignes de recette).
 *
 * ARRONDI : chaque ligne est arrondie pour l'AFFICHAGE (`coutCents`), mais le
 * TOTAL accumule les contributions EXACTES (non arrondies) et n'arrondit
 * qu'UNE FOIS, a la toute fin — sinon une pincee a tres petite quantite (la
 * cannelle, 0,2 g par tasse) disparaitrait du total avant meme d'y entrer
 * (CLAUDE.md §3 ; doctrine de `mettreAEchelle` / `repartir()` de `argent.ts`).
 *
 * Fonction PURE (regle d'architecture n°1) : les couts unitaires arrivent
 * deja resolus par le depot, ce module ne fait qu'additionner.
 */
export function coutsComposantsVente(
  composants: readonly ComposantVenteEntree[],
  consommationSurPlaceProduit: boolean,
): { readonly composants: ComposantVenteChiffre[]; readonly coutComposantsCents: number | null } {
  let coutExactCents = 0;
  let inconnu = false;

  const lignes: ComposantVenteChiffre[] = composants.map((composant) => {
    const inclus =
      !composant.optionnel &&
      (composant.consommationSurPlace === null ||
        composant.consommationSurPlace === consommationSurPlaceProduit);

    // `quantiteReferenceUnites <= 0` serait une incoherence de donnees (la
    // colonne est NOT NULL, defaut 1) : traitee comme un cout INCONNU, jamais
    // comme un cout nul silencieux (meme doctrine que le prix manquant).
    const coutExact =
      composant.cumpCentsParUnite === null || composant.quantiteReferenceUnites <= 0
        ? null
        : (composant.quantiteUniteRef / composant.quantiteReferenceUnites) *
          composant.cumpCentsParUnite;

    if (inclus) {
      if (coutExact === null) inconnu = true;
      else coutExactCents += coutExact;
    }

    return {
      ingredientId: composant.ingredientId,
      nomIngredient: composant.nomIngredient,
      unite: composant.unite,
      quantiteUniteRef: composant.quantiteUniteRef,
      quantiteReferenceUnites: composant.quantiteReferenceUnites,
      cumpCentsParUnite: composant.cumpCentsParUnite,
      coutCents: coutExact === null ? null : Math.round(coutExact),
      allergenes: [...composant.allergenes],
      optionnel: composant.optionnel,
      consommationSurPlace: composant.consommationSurPlace,
      inclusDansLeCout: inclus,
    };
  });

  return {
    composants: lignes,
    coutComposantsCents: inconnu ? null : Math.round(coutExactCents),
  };
}

export type LigneRecetteContrat = z.infer<typeof schemaLigneRecette>;
export type RecetteResume = z.infer<typeof schemaRecetteResume>;
export type RecetteDetail = z.infer<typeof schemaRecetteDetail>;
export type ListeRecettes = z.infer<typeof schemaListeRecettes>;
export type CibleCalcul = z.infer<typeof schemaCibleCalcul>;
export type ResultatCalcul = z.infer<typeof schemaResultatCalcul>;
