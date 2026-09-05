/**
 * NOMENCLATURE DE VENTE : ce qu'un produit consomme au moment ou il est
 * VENDU, par opposition a la recette, consommee a la PRODUCTION.
 *
 * C'est le defaut exact des garnitures (D-053), transpose au non-alimentaire
 * et au « transforme a la demande » : la categorie d'ingredient `consommable`
 * existe (serviette, assiette, gobelet), le stock d'entree fonctionne deja,
 * mais rien ne les fait SORTIR. Le meme mecanisme resout aussi le cafe — qui
 * n'a pas de lot de PRODUCTION, il se fait a la tasse — et les toppings vendus
 * a la piece (fiche 15).
 *
 * DEUX PIEGES, traites explicitement ici :
 *
 * 1. **Les petites quantites disparaissent.** La quantite en base est un
 *    ENTIER (CLAUDE.md §3 regle 4). Une pincee de cannelle a 0,2 g par tasse
 *    s'ecrit donc « pour 100 cafes : 20 g » (`quantiteUniteRef` /
 *    `quantiteReferenceUnites`), exactement comme R1 est ecrite « pour 6
 *    crepes : 145 g de farine ». La contribution d'UNE vente est alors
 *    fractionnaire (0,2 g), et il ne faut JAMAIS l'arrondir a ce niveau :
 *    quatre-vingts arrondis a zero font zero, un seul arrondi sur le total
 *    (80 x 0,2 = 16) fait 16 g. `cumulerComposantsVendus` cumule donc TOUS les
 *    flottants d'un meme ingredient, sur TOUTE la session, et n'arrondit
 *    qu'une seule fois, a la fin.
 *
 * 2. **Le mode de consommation change ce qui sort.** Une assiette ne sert que
 *    sur place, un contenant que pour l'emporte. `consommationSurPlace` sur le
 *    composant vaut `null` (les deux modes) ou doit correspondre EXACTEMENT au
 *    mode de la vente — sinon le composant ne s'applique pas.
 */

import type { Unite } from './unites.js';

/** Un composant de nomenclature de vente, enrichi du cout courant de son ingredient. */
export type ComposantVenteCalcul = {
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly unite: Unite;
  /** Quantite consommee pour `quantiteReferenceUnites` UNITES VENDUES. */
  readonly quantiteUniteRef: number;
  /** Lot de reference : 1 pour un gobelet, 100 pour une pincee de cannelle. */
  readonly quantiteReferenceUnites: number;
  /**
   * Cout unitaire courant de l'ingredient, en centimes par unite de reference.
   *
   * `null` quand l'ingredient n'a AUCUN conditionnement actif : son prix n'est
   * pas encore connu — jamais gratuit. C'est le defaut exact que ce champ
   * corrige : un composant jamais achete (le gobelet en carton commande mais
   * jamais receptionne) rendait un cout a `0`, donc une marge de 100 % sur
   * l'ecran d'administration de la nomenclature — meme famille que
   * `LigneRecetteCalcul.cumpCentsParUnite` (`recettes.ts`) et D-018.
   */
  readonly cumpCentsParUnite: number | null;
  readonly allergenes: readonly string[];
  /** `null` = consomme dans les deux cas ; `true`/`false` = seulement sur place / a emporter. */
  readonly consommationSurPlace: boolean | null;
};

/**
 * Cout INDICATIF d'un composant, ramene a UNE unite vendue, au CUMP courant.
 *
 * Volontairement NON ARRONDI : c'est un chiffre d'AFFICHAGE (l'ecran de
 * declaration des composants), jamais une ecriture de stock. La sortie REELLE
 * de stock, elle, arrondit une seule fois sur le TOTAL de la session — voir
 * `cumulerComposantsVendus`. Arrondir ici donnerait 0 pour la cannelle
 * (0,2 g x 0,1 c/g = 0,02 c) et ferait croire que ce composant ne coute rien,
 * alors qu'il pese bien 16 g sur cent tasses vendues.
 *
 * `null`, jamais `0`, dans deux cas qu'il ne faut JAMAIS confondre avec un
 * cout reellement nul :
 *  - `cumpCentsParUnite` est `null` (l'ingredient n'a aucun conditionnement
 *    actif, jamais achete) : le prix est INCONNU, pas gratuit — c'etait le
 *    defaut trace ici (un `?? 0` en amont rendait ce cas indiscernable d'un
 *    composant realmente offert) ;
 *  - `quantiteReferenceUnites <= 0` est une incoherence de donnees (la
 *    colonne est NOT NULL, defaut 1) : traitee comme un cout INCONNU, jamais
 *    comme un cout nul silencieux — meme doctrine que `coutsComposantsVente`
 *    (`contrats/recettes.ts`), qui applique deja cette regle au meme cas.
 */
export function coutIndicatifComposantCents(composant: ComposantVenteCalcul): number | null {
  if (composant.quantiteReferenceUnites <= 0 || composant.cumpCentsParUnite === null) return null;
  return (
    (composant.quantiteUniteRef / composant.quantiteReferenceUnites) * composant.cumpCentsParUnite
  );
}

/** Une ligne de vente, telle que la cloture de session la resout. */
export type LigneVenteComposants = {
  /** Nombre d'unites vendues de CE produit, sur la session. */
  readonly quantite: number;
  /** Mode de consommation REEL de cette vente (celui du produit, D-054/§4.3). */
  readonly consommationSurPlace: boolean;
  readonly composants: readonly ComposantVenteCalcul[];
};

/**
 * Quantite de chaque ingredient de nomenclature de vente consommee par une
 * session, cumulee PAR INGREDIENT et arrondie UNE SEULE FOIS, sur le TOTAL.
 *
 * C'est le coeur du piege n°1 documente en tete de fichier : on ne rend ici
 * QUE des entiers strictement positifs (une quantite qui arrondit a zero n'a
 * rien a sortir du stock, et un mouvement de zero ne se trace pas — meme
 * convention que `cumulerGarnituresVendues`).
 *
 * Le filtre du mode de consommation (piege n°2) s'applique ICI, avant tout
 * cumul : un composant `consommationSurPlace` non nul qui ne correspond pas au
 * mode de la vente ne contribue tout simplement pas.
 *
 * Fonction PURE, deliberement separee de l'ecriture (regle d'architecture
 * n°1) : c'est elle qu'on teste pour verifier le cumul et l'arrondi, sans
 * avoir besoin d'une base.
 */
export function cumulerComposantsVendus(
  ventes: readonly LigneVenteComposants[],
): Map<string, number> {
  const brut = new Map<string, number>();

  for (const vente of ventes) {
    for (const composant of vente.composants) {
      if (
        composant.consommationSurPlace !== null &&
        composant.consommationSurPlace !== vente.consommationSurPlace
      ) {
        continue;
      }
      if (composant.quantiteReferenceUnites <= 0) continue;

      // Contribution FRACTIONNAIRE, jamais arrondie a ce stade : c'est la
      // regle qui protege la cannelle. `vente.quantite` et
      // `composant.quantiteUniteRef` sont deux entiers, mais leur quotient par
      // `quantiteReferenceUnites` ne l'est pas necessairement.
      const contribution =
        (vente.quantite * composant.quantiteUniteRef) / composant.quantiteReferenceUnites;

      brut.set(composant.ingredientId, (brut.get(composant.ingredientId) ?? 0) + contribution);
    }
  }

  const arrondi = new Map<string, number>();
  for (const [ingredientId, quantite] of brut) {
    const entier = Math.round(quantite);
    // Une quantite nulle n'a rien a sortir du stock : la laisser produirait un
    // mouvement vide et un lot « consomme » a zero dans la tracabilite (meme
    // regle que `cumulerGarnituresVendues`).
    if (entier > 0) arrondi.set(ingredientId, entier);
  }
  return arrondi;
}
