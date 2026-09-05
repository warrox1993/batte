/**
 * Mise a l'echelle des recettes et cout matiere.
 *
 * Regle d'architecture n°1 (CLAUDE.md §3) : fonctions pures, aucun acces base.
 * Les quantites arrivent deja resolues par l'appelant (depot Drizzle), ce module
 * ne fait que calculer.
 *
 * Trois sens de mise a l'echelle exiges par docs/01-SPEC module 1 :
 *   - depuis un nombre de crepes cible
 *   - depuis un volume de pate cible
 *   - depuis une quantite d'ingredient limitante (« il me reste 4 kg de farine »)
 */

import { BASE_POINTS, type Centimes, type PointsDeBase } from './argent.js';
import { ErreurMetier } from './erreurs.js';
import type { Unite } from './unites.js';

/** Une ligne de recette, enrichie du cout courant de son ingredient. */
export type LigneRecetteCalcul = {
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly unite: Unite;
  /** Quantite pour le rendement de reference de la recette. */
  readonly quantiteReference: number;
  /**
   * CUMP courant de l'ingredient, en centimes par unite de reference.
   *
   * `null` quand l'ingredient n'a AUCUN conditionnement actif : son prix n'est
   * pas encore connu. C'est un cas atteignable par le parcours principal — la
   * creation rapide d'ingredient depuis l'ecran Recettes assigne l'ingredient
   * a la ligne avant tout conditionnement (fiche 09) — donc `null` n'est jamais
   * `0` ici : un prix INCONNU n'est pas un ingredient GRATUIT (audit 29/07/2026,
   * meme famille que `calculerCump`, D-018 : « un ingredient epuise n'a pas un
   * cout de zero, il n'a pas de cout »).
   */
  readonly cumpCentsParUnite: number | null;
  /** Sous-ensemble de la liste reglementaire des 14 allergenes. */
  readonly allergenes: readonly string[];
  /**
   * Vrai si CET ingredient a ete humainement verifie pour ses allergenes
   * (`ingredient.allergenesVerifies`, packages/db/src/schema.ts).
   *
   * Optionnel, et c'est deliberer : les appelants qui n'ont pas cette
   * information (moteur de prevision, service de production — hors du
   * perimetre de cette correction) omettent simplement le champ plutot que
   * de fabriquer une valeur. Mais une absence ne vaut JAMAIS « verifie » —
   * voir `tousAllergenesVerifies` ci-dessous, qui traite `undefined`
   * exactement comme `false`. C'est la piece qui manquait pour distinguer
   * « jamais verifie » de « verifie, aucun allergene » a l'ecran : sans elle,
   * les deux panneaux de calcul en direct de Recettes.tsx affichaient le
   * meme tiret pour les deux cas (audit allergenes du 31/07/2026,
   * docs/30-AUDIT-ALLERGENES.md §2.2) — un tiret qui se lit comme une
   * absence, sur une information de securite alimentaire.
   */
  readonly allergenesVerifies?: boolean;
};

export type RecetteCalcul = {
  readonly id: string;
  readonly code: string;
  readonly rendementReferenceMl: number;
  readonly rendementReferenceCrepes: number;
  /**
   * Part de pate perdue a la cuisson (croute, fond de louche, ratees de debut
   * de service). En points de base.
   */
  readonly perteCuissonBp: PointsDeBase;
  /** Part de crepes cuites mais invendables (dechirees, brulees). */
  readonly tauxCasseBp: PointsDeBase;
  readonly lignes: readonly LigneRecetteCalcul[];
};

/**
 * Ce que l'utilisateur demande.
 *
 * `crepes` designe des crepes **vendables**, pas des crepes theoriques : c'est
 * le seul chiffre qui a un sens commercial (« il m'en faut 200 a vendre »).
 * La perte de cuisson et le taux de casse sont donc compenses a la hausse.
 */
export type CibleMiseAEchelle =
  | { readonly type: 'crepes'; readonly crepesVendables: number }
  | { readonly type: 'volume'; readonly volumeMl: number }
  | {
      readonly type: 'ingredient';
      readonly ingredientId: string;
      readonly quantiteDisponible: number;
    };

export type LigneMiseAEchelle = LigneRecetteCalcul & {
  /** Quantite a mettre en oeuvre, arrondie a l'entier de l'unite de reference. */
  readonly quantite: number;
  /**
   * `null` quand `cumpCentsParUnite` est `null` : la quantite PESEE ne
   * disparait jamais (elle reste affichee), mais son cout ne peut pas se
   * chiffrer sans prix connu — jamais `0`, qui compterait l'ingredient comme
   * gratuit (audit 29/07/2026, defaut n°1).
   */
  readonly coutCents: Centimes | null;
};

export type ResultatMiseAEchelle = {
  readonly facteur: number;
  readonly volumeMl: number;
  readonly crepesTheoriques: number;
  /** Apres perte de cuisson et casse : ce qui sera reellement vendable. */
  readonly crepesVendables: number;
  readonly lignes: readonly LigneMiseAEchelle[];
  /**
   * `null` des qu'UNE SEULE ligne a un cout inconnu (`cumpCentsParUnite: null`).
   *
   * Un total dont une ligne est inconnue est lui-meme inconnu : ce n'est pas
   * une somme partielle qu'on peut presenter comme complete (audit 29/07/2026,
   * defaut n°1 ; meme raisonnement que `coutProduitVendu`, qui distingue deja
   * « base manquante » de « base a zero »). Le total ne se calcule par ailleurs
   * JAMAIS en sommant des couts de ligne deja arrondis (defaut n°2) : voir le
   * commentaire de `mettreAEchelle` ci-dessous et celui de `repartir()` dans
   * `argent.ts` pour la doctrine « totaliser d'abord, arrondir a la fin ».
   */
  readonly coutMatiereCents: Centimes | null;
  /**
   * Cout matiere ramene a une crepe vendable — l'indicateur de CLAUDE.md §6.
   *
   * `null`, jamais `0`, quand aucune crepe n'est vendable (`crepesVendables`
   * a zero) OU quand `coutMatiereCents` est lui-meme inconnu : le cout matiere
   * existe (la pate a ete achetee), mais aucune crepe ne le porte, ou son
   * montant meme n'est pas etabli — dans les deux cas le ratio n'a pas de
   * valeur, pas une valeur nulle. Meme famille que `calculerCump` (D-018,
   * « un ingredient epuise n'a pas un cout de zero, il n'a pas de cout ») et
   * que `calculerCump` (`stock.ts`). Un `0` ici passerait le filtre `c !== null` de
   * `depots/previsions.ts` et tirerait le cout matiere moyen (`Co` du
   * newsvendor) vers le bas — donc ferait monter le quantile cible, donc
   * ferait SURPRODUIRE (docs/17 fiche 7).
   */
  readonly coutParCrepeCents: Centimes | null;
  readonly allergenes: readonly string[];
  /**
   * Vrai seulement si TOUTES les lignes contributrices ont
   * `allergenesVerifies === true` — voir `tousAllergenesVerifies` ci-dessous.
   * Tant que c'est faux, `allergenes` ci-dessus ne dit rien de sur : une
   * liste vide NE VEUT PAS DIRE « aucun allergene », elle veut dire « pas
   * encore verifie » (meme regle que les trois documents imprimes,
   * `tousLesIngredientsVerifies`, `apps/api/src/documents/donnees.ts`).
   */
  readonly allergenesVerifies: boolean;
};

/**
 * Rendement net : part des crepes theoriques qui finit vendable.
 * Les deux pertes s'appliquent en cascade, pas en somme — une crepe perdue a la
 * cuisson ne peut pas etre cassee ensuite.
 */
export function rendementNetBp(recette: {
  perteCuissonBp: PointsDeBase;
  tauxCasseBp: PointsDeBase;
}): PointsDeBase {
  const apresCuisson = BASE_POINTS - recette.perteCuissonBp;
  const apresCasse = (apresCuisson * (BASE_POINTS - recette.tauxCasseBp)) / BASE_POINTS;
  return Math.round(apresCasse);
}

function verifierRecette(recette: RecetteCalcul): void {
  if (recette.rendementReferenceCrepes <= 0 || recette.rendementReferenceMl <= 0) {
    throw new ErreurMetier(
      'rendement_invalide',
      `La recette ${recette.code} n'a pas de rendement de référence exploitable. ` +
        'Renseignez le volume et le nombre de crêpes obtenus pour une fournée.',
    );
  }
  if (recette.lignes.length === 0) {
    throw new ErreurMetier(
      'recette_vide',
      `La recette ${recette.code} ne contient aucun ingrédient.`,
    );
  }
  const net = rendementNetBp(recette);
  if (net <= 0) {
    throw new ErreurMetier(
      'rendement_net_nul',
      `La perte de cuisson et le taux de casse de ${recette.code} annulent toute la production. ` +
        'Vérifiez ces deux valeurs.',
    );
  }
}

/** Facteur multiplicatif a appliquer au rendement de reference. */
function calculerFacteur(recette: RecetteCalcul, cible: CibleMiseAEchelle): number {
  switch (cible.type) {
    case 'volume':
      return cible.volumeMl / recette.rendementReferenceMl;

    case 'crepes': {
      // On remonte des crepes vendables aux crepes theoriques a produire.
      const net = rendementNetBp(recette);
      const theoriques = (cible.crepesVendables * BASE_POINTS) / net;
      return theoriques / recette.rendementReferenceCrepes;
    }

    case 'ingredient': {
      const ligne = recette.lignes.find((l) => l.ingredientId === cible.ingredientId);
      if (ligne === undefined) {
        throw new ErreurMetier(
          'ingredient_hors_recette',
          `Cet ingrédient n'entre pas dans la recette ${recette.code}.`,
        );
      }
      if (ligne.quantiteReference <= 0) {
        throw new ErreurMetier(
          'quantite_reference_nulle',
          `La quantité de référence de « ${ligne.nomIngredient} » est nulle : ` +
            "impossible de mettre la recette à l'échelle depuis cet ingrédient.",
        );
      }
      return cible.quantiteDisponible / ligne.quantiteReference;
    }
  }
}

/**
 * Met la recette a l'echelle et chiffre le cout matiere.
 *
 * Les arrondis se font ligne par ligne sur la quantite, puis le cout de CHAQUE
 * LIGNE est calcule sur la quantite ARRONDIE : c'est ce qui sera reellement pese
 * et sorti du stock, donc c'est ce qui doit etre facture au cout de revient.
 * Chiffrer sur la quantite theorique creerait un ecart permanent avec les
 * mouvements de stock.
 *
 * Le TOTAL, en revanche, ne se calcule JAMAIS en sommant ces couts de ligne deja
 * arrondis (audit 29/07/2026, defaut n°2 — corrige ici). `coutCents` par ligne
 * reste un arrondi individuel, informatif ; le total accumule les produits
 * EXACTS (non arrondis) et n'arrondit qu'UNE fois, a la toute fin — la doctrine
 * de `repartir()` dans `argent.ts` (« totaliser d'abord, arrondir a la fin »).
 * Sans cela, une ligne a tres petit cout (2 g de sel a 0,09 c/g = 0,18 c)
 * s'arrondirait a zero et disparaitrait du total sans le moindre signal :
 * verifie a la main sur R1 (154,02 c exact vs 155 c en sommant les lignes
 * arrondies), voir `audit-referentiel.test.ts`.
 *
 * Un ingredient sans prix connu (`cumpCentsParUnite: null`, defaut n°1) rend sa
 * ligne INCONNUE : `coutCents: null` pour cette ligne, et `coutMatiereCents`
 * lui-meme `null` des qu'une seule ligne l'est — un total partiellement inconnu
 * n'est pas une somme partielle presentable comme complete.
 */
export function mettreAEchelle(
  recette: RecetteCalcul,
  cible: CibleMiseAEchelle,
): ResultatMiseAEchelle {
  verifierRecette(recette);

  const facteur = calculerFacteur(recette, cible);
  if (!Number.isFinite(facteur) || facteur <= 0) {
    throw new ErreurMetier(
      'cible_invalide',
      'La quantité demandée doit être strictement positive.',
    );
  }

  let coutMatiereExactCents = 0;
  let prixInconnu = false;

  const lignes: LigneMiseAEchelle[] = recette.lignes.map((ligne) => {
    const quantite = Math.round(ligne.quantiteReference * facteur);

    if (ligne.cumpCentsParUnite === null) {
      prixInconnu = true;
      return { ...ligne, quantite, coutCents: null };
    }

    coutMatiereExactCents += quantite * ligne.cumpCentsParUnite;
    return {
      ...ligne,
      quantite,
      coutCents: Math.round(quantite * ligne.cumpCentsParUnite),
    };
  });

  const coutMatiereCents = prixInconnu ? null : Math.round(coutMatiereExactCents);
  const crepesTheoriques = Math.round(recette.rendementReferenceCrepes * facteur);
  const crepesVendables = Math.floor((crepesTheoriques * rendementNetBp(recette)) / BASE_POINTS);

  return {
    facteur,
    volumeMl: Math.round(recette.rendementReferenceMl * facteur),
    crepesTheoriques,
    crepesVendables,
    lignes,
    coutMatiereCents,
    // Sur les crepes VENDABLES : le cout des crepes ratees est bien supporte par
    // celles qu'on vend, sinon la marge affichee serait flatteuse. `null` et
    // non `0` quand `crepesVendables` tombe a zero (cible trop petite pour la
    // recette) OU quand `coutMatiereCents` est lui-meme inconnu : dans les deux
    // cas ce n'est pas un cout nul, c'est un cout INCONNU par crepe (docs/17
    // fiche 7 ; audit 29/07/2026 defaut n°1).
    coutParCrepeCents:
      coutMatiereCents !== null && crepesVendables > 0
        ? Math.round(coutMatiereCents / crepesVendables)
        : null,
    allergenes: agregerAllergenes(recette.lignes),
    allergenesVerifies: tousAllergenesVerifies(recette.lignes),
  };
}

/**
 * Union des allergenes des ingredients, triee pour un affichage stable.
 * Sert l'affichette obligatoire du stand (docs/01 module 1).
 */
export function agregerAllergenes(
  lignes: readonly { allergenes: readonly string[] }[],
): readonly string[] {
  const ensemble = new Set<string>();
  for (const ligne of lignes) {
    for (const allergene of ligne.allergenes) ensemble.add(allergene);
  }
  return [...ensemble].sort((a, b) => a.localeCompare(b, 'fr'));
}

/**
 * Vrai seulement si CHAQUE ligne porte `allergenesVerifies === true`.
 *
 * Une ligne dont le drapeau est absent (`undefined` — appelant qui n'a pas
 * cette information) compte comme NON verifiee : l'absence d'information ne
 * vaut jamais une confirmation (CLAUDE.md §3, meme famille que le repli
 * `cumpCentsParUnite: null` plutot que `0`). Audit allergenes du 31/07/2026,
 * docs/30-AUDIT-ALLERGENES.md §2.2 : sans cette fonction, un ingredient
 * jamais verifie et un ingredient verifie sans allergene produisaient le
 * meme tiret a l'ecran.
 */
export function tousAllergenesVerifies(
  lignes: readonly { readonly allergenesVerifies?: boolean }[],
): boolean {
  return lignes.every((ligne) => ligne.allergenesVerifies === true);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Cout de revient d'un PRODUIT VENDU : la part de pate + les garnitures

   Une recette chiffre une FOURNEE. Ce qui se vend n'est pas une fournee, c'est
   une crepe garnie : du sucre, de la confiture, du sirop s'ajoutent a la pate au
   moment du service. Tant que ces garnitures n'entraient nulle part, le cout de
   revient etait amputé de sa part la plus variable — celle qui distingue une
   crepe a 3,00 € d'une crepe a 3,50 € — et la marge affichee etait flatteuse.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une garniture d'un produit vendu, enrichie du cout courant de son ingredient. */
export type GarnitureCalcul = {
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly unite: Unite;
  /**
   * Quantite consommee par UNITE VENDUE, dans l'unite de reference de
   * l'ingredient. Ni par crepe, ni par fournee : par article encaisse. Un
   * produit qui vaut deux crepes porte deux fois la pate, mais UNE fois la
   * quantite de garniture declaree ici.
   */
  readonly quantiteParUnite: number;
  /**
   * Cout unitaire courant de l'ingredient, en centimes par unite de reference.
   *
   * `null` quand l'ingredient n'a aucun conditionnement actif : un prix
   * INCONNU, jamais un prix GRATUIT — meme regle que `LigneRecetteCalcul`
   * (audit 29/07/2026, defaut n°1 ; D-018).
   */
  readonly cumpCentsParUnite: number | null;
  readonly allergenes: readonly string[];
};

export type LigneGarnitureChiffree = GarnitureCalcul & { readonly coutCents: Centimes | null };

export type CoutProduitVendu = {
  /** Part de pate d'une unite vendue. `0` pour un produit revendu. */
  readonly coutPateCents: Centimes;
  /** Prix d'achat d'une unite revendue. `0` pour un produit transforme. */
  readonly coutAchatCents: Centimes;
  /**
   * `null` des qu'UNE garniture a un prix INCONNU (`cumpCentsParUnite: null`) :
   * meme raisonnement que `coutMatiereCents` — un total partiellement inconnu
   * n'est pas une somme partielle presentable comme complete.
   */
  readonly coutGarnituresCents: Centimes | null;
  /**
   * `null` des qu'une composante est INCONNUE — recette vide, prix d'achat
   * absent. Afficher un total ampute comme s'il etait complet est exactement le
   * defaut qu'on corrige ici : mieux vaut un tiret qu'un chiffre faux.
   */
  readonly coutMatiereCents: Centimes | null;
  readonly garnitures: readonly LigneGarnitureChiffree[];
  /**
   * Allergenes de la pate, des garnitures ET des composants de nomenclature de
   * vente (options comprises, fiche 15 §4.1bis) : c'est ce qui part sur
   * l'affichette. Un cafe avec creme doit y figurer avec « lait », meme si la
   * recette de base n'en porte aucun.
   */
  readonly allergenes: readonly string[];
};

export type ProduitVenduCalcul = {
  /**
   * Cout matiere d'UNE crepe VENDABLE, tel que `mettreAEchelle` le rend.
   * `null` quand la recette est vide ou son rendement inexploitable.
   *
   * **Piege a ne pas reproduire** : ce chiffre porte DEJA tout le cout de la
   * fournee reparti sur les crepes vendables. On le MULTIPLIE par le nombre de
   * crepes de l'unite vendue — on ne re-somme jamais les lignes de recette,
   * sinon la pate serait comptee deux fois.
   */
  readonly coutParCrepeCents: number | null;
  /** Crepes consommees par unite vendue. `0` pour un produit revendu. */
  readonly nbCrepesParUnite: number;
  /** Cout d'achat courant d'une unite REVENDUE. `null` pour un transforme. */
  readonly coutAchatUniteCents: number | null;
  /**
   * Vrai seulement si ce produit est un VRAI REVENDU (D-085), qui attend un
   * prix d'achat pour exister.
   *
   * `nbCrepesParUnite === 0` NE SUFFIT PLUS a le deduire depuis que D-085 a
   * introduit deux AUTRES cas qui partagent la meme valeur sans etre des
   * revendus : un transforme A LA DEMANDE (`consommationUnite: 'nomenclature'`,
   * le cafe) et un transforme VENDU AU VOLUME (`consommationUnite:
   * 'volume_pate'`, une pate en bouteille). Avant ce drapeau, cette fonction
   * traitait TOUT `nbCrepesParUnite === 0` comme « revendu sans prix d'achat
   * connu » — vrai avant D-085, faux depuis. Le cafe avait deja ete contourne
   * au niveau du depot (`packages/db/src/depots/recettes.ts`, cas
   * `consommationUnite === 'nomenclature'`) ; la pate au volume, elle, heritait
   * encore du meme faux positif, jamais demontree faute de produit de ce type
   * dans le jeu de demonstration.
   */
  readonly estRevendu: boolean;
  /**
   * Vrai seulement si ce produit vend la PATE ELLE-MEME au volume (D-085,
   * `consommationUnite === 'volume_pate'`, fiche 15 §5.1 — une bouteille, un
   * pot). Meme famille que `estRevendu` ci-dessus : `nbCrepesParUnite === 0`
   * ne suffit pas a le distinguer d'un revendu ou d'un transforme A LA
   * DEMANDE (le cafe), qui partagent tous deux la meme valeur sans etre de la
   * pate vendue au volume.
   *
   * Optionnel, par defaut `false` : un produit qui n'est pas concerne par
   * cette question (crepe, revendu, cafe) omet simplement le champ — meme
   * convention que `composants` plus bas, jamais un `undefined` explicite
   * (`exactOptionalPropertyTypes`).
   *
   * **Defaut trouve en audit (fiche 15 §5.1, mission « la pate vendue au
   * volume n'est jamais deduite du stock »)** : avant ce champ, une pate
   * vendue au volume avait `coutParCrepeCents` renseigne (la recette a un
   * cout) MAIS `nbCrepesParUnite = 0` (elle ne consomme aucune crepe) — donc
   * `coutPateCents = coutParCrepeCents * 0 = 0`, TOUJOURS, quel que soit le
   * prix de la recette. Un cout de pate a zero produit une marge a 100 %,
   * exactement le mensonge que CLAUDE.md interdit (« la valeur inconnue vaut
   * `null`, jamais `0` ») — sauf qu'ici la valeur n'etait meme pas inconnue,
   * elle etait simplement JAMAIS MULTIPLIEE par le bon facteur (un volume,
   * pas un nombre de crepes). Voir `coutParMlCents`/`volumeMlParUnite`
   * ci-dessous, qui portent le facteur correct.
   */
  readonly estPateVendueAuVolume?: boolean;
  /**
   * Cout matiere de la recette, PAR ML — le pendant de `coutParCrepeCents`
   * pour un produit vendu au VOLUME plutot qu'a la crepe. Pertinent
   * SEULEMENT quand `estPateVendueAuVolume` est vrai.
   *
   * `null` dans les MEMES cas que `coutParCrepeCents` : recette vide ou
   * rendement inexploitable, ou au moins un ingredient sans prix connu — un
   * cout INCONNU, jamais un cout GRATUIT (meme regle que partout ailleurs
   * dans ce fichier, D-018).
   *
   * DELIBEREMENT NON ARRONDI : c'est un TAUX (centimes par ml), pas un
   * montant. `coutPateCents` ci-dessous fait l'UNIQUE arrondi, en multipliant
   * ce taux EXACT par `volumeMlParUnite` — jamais l'inverse, qui arrondirait
   * un taux minuscule a zero avant de le multiplier par un gros volume
   * (doctrine « totaliser/multiplier d'abord, arrondir a la fin »,
   * `packages/core/src/argent.ts::repartir`).
   */
  readonly coutParMlCents?: number | null;
  /**
   * Volume de pate (ml) que represente UNE unite vendue —
   * `produit_vente.volume_ml_par_unite` (D-085, fiche 15 §5.1). Pertinent
   * SEULEMENT quand `estPateVendueAuVolume` est vrai. `null`/omis sinon.
   */
  readonly volumeMlParUnite?: number | null;
  /**
   * Garnitures declarees. **Une liste vide est un cas normal, pas une erreur** :
   * la crepe nature existe, et rien n'oblige un produit a porter une garniture.
   * Rendre la garniture obligatoire interdirait de modeler la moitie d'une carte.
   */
  readonly garnitures: readonly GarnitureCalcul[];
  /** Allergenes deja agreges de la recette. Vide pour un revendu. */
  readonly allergenesPate: readonly string[];
  /**
   * Composants de la NOMENCLATURE DE VENTE (fiche 15) : ce que le produit
   * consomme AU MOMENT DE LA VENTE — gobelet, ingredients d'un cafe fait a la
   * tasse, et surtout les OPTIONS (« café avec crème »). **[ALERTE fiche 15
   * §4.1bis]** Un cafe noir ne porte aucun allergene ; un cafe avec creme, si.
   * Omettre ces composants ferait declarer un produit « sans allergene » alors
   * qu'il peut en contenir un des qu'une option est servie — une information
   * FAUSSE donnee a un client allergique, pas une simple imprecision.
   *
   * **Optionnel** (`?`, jamais `| undefined` explicite ici : simple valeur par
   * defaut a l'appel, pas un champ parse par Zod) et par defaut vide : un
   * produit sans nomenclature de vente (une crepe nature) reste un cas normal.
   */
  readonly composants?: readonly { readonly allergenes: readonly string[] }[];
};

/**
 * Cout matiere complet d'une unite vendue = part de pate + garnitures.
 *
 * Fonction pure : les couts unitaires arrivent deja resolus par le depot, ce
 * module ne fait qu'additionner (regle d'architecture n°1).
 *
 * L'arrondi se fait ligne a ligne, comme dans `mettreAEchelle` : c'est la
 * quantite reellement etalee qui sera sortie du stock, donc c'est elle qui doit
 * etre chiffree. Une garniture sans prix connu (`cumpCentsParUnite: null`)
 * rend sa ligne INCONNUE (`coutCents: null`), jamais gratuite, et fait basculer
 * `coutGarnituresCents` — puis `coutMatiereCents` — a `null` (audit 29/07/2026,
 * defaut n°1).
 */
export function coutProduitVendu(produit: ProduitVenduCalcul): CoutProduitVendu {
  let garnitureInconnue = false;
  let coutGarnituresExactCents = 0;

  const garnitures: LigneGarnitureChiffree[] = produit.garnitures.map((garniture) => {
    if (garniture.cumpCentsParUnite === null) {
      garnitureInconnue = true;
      return { ...garniture, coutCents: null };
    }
    const coutCents = Math.round(garniture.quantiteParUnite * garniture.cumpCentsParUnite);
    coutGarnituresExactCents += coutCents;
    return { ...garniture, coutCents };
  });

  const coutGarnituresCents = garnitureInconnue ? null : coutGarnituresExactCents;

  // `estPateVendueAuVolume` (D-085, defaut trouve fiche 15 §5.1) : une pate
  // vendue au volume ne consomme AUCUNE crepe (`nbCrepesParUnite` y vaut `0`,
  // comme un revendu) — `coutParCrepeCents * nbCrepesParUnite` y valait donc
  // TOUJOURS zero, quel que soit le prix de la recette. Le bon facteur pour
  // ce cas est un VOLUME, pas un nombre de crepes : `coutParMlCents *
  // volumeMlParUnite`. Les deux chemins sont MUTUELLEMENT EXCLUSIFS (D-085 :
  // un produit est crepe, revendu, cafe ou pate au volume — jamais deux a la
  // fois), donc jamais sommes entre eux.
  const estPateVendueAuVolume = produit.estPateVendueAuVolume === true;
  const coutParMlCents = produit.coutParMlCents ?? null;
  const volumeMlParUnite = produit.volumeMlParUnite ?? null;

  const coutPateCents = estPateVendueAuVolume
    ? coutParMlCents !== null && volumeMlParUnite !== null
      ? // Arrondi UNIQUE, a la toute fin : `coutParMlCents` reste un taux EXACT
        // (non arrondi) jusqu'ici, pour ne jamais faire disparaitre une pate a
        // tres faible cout au ml avant de la multiplier par un gros volume.
        Math.round(coutParMlCents * volumeMlParUnite)
      : 0
    : produit.coutParCrepeCents === null
      ? 0
      : Math.round(produit.coutParCrepeCents * produit.nbCrepesParUnite);
  const coutAchatCents =
    produit.coutAchatUniteCents === null ? 0 : Math.round(produit.coutAchatUniteCents);

  // Une part de base est INCONNUE quand le produit en attend une et qu'elle
  // manque : un transforme qui consomme des crepes sans cout de crepe connu, un
  // revendu sans prix d'achat, une pate au volume sans cout au ml connu. Les
  // garnitures, elles, ne manquent jamais quand la liste est vide : leur
  // absence signifie « aucune garniture », pas « garniture inconnue » — seule
  // une garniture PRESENTE mais sans prix (`coutGarnituresCents === null`)
  // rend le total inconnu.
  //
  // `baseAchatManquante` se decide desormais sur `estRevendu`, PAS sur
  // `nbCrepesParUnite === 0` : voir la doc de `estRevendu` ci-dessus (D-085) —
  // un transforme a la demande ou une pate vendue au volume n'attendent AUCUN
  // prix d'achat, meme si tous deux partagent `nbCrepesParUnite === 0` avec un
  // vrai revendu.
  const basePateManquante = estPateVendueAuVolume
    ? coutParMlCents === null || volumeMlParUnite === null
    : produit.nbCrepesParUnite > 0 && produit.coutParCrepeCents === null;
  const baseAchatManquante = produit.estRevendu && produit.coutAchatUniteCents === null;

  return {
    coutPateCents,
    coutAchatCents,
    coutGarnituresCents,
    coutMatiereCents:
      basePateManquante || baseAchatManquante || coutGarnituresCents === null
        ? null
        : coutPateCents + coutAchatCents + coutGarnituresCents,
    garnitures,
    // Options comprises (fiche 15 §4.1bis) : `composants` porte les OPTIONS
    // (« café avec crème ») en plus des garnitures TOUJOURS appliquées. Une
    // liste vide (produit sans nomenclature de vente) ne retire rien : c'est
    // exactement le cas normal d'une crepe nature.
    allergenes: agregerAllergenes([
      { allergenes: produit.allergenesPate },
      ...produit.garnitures.map((g) => ({ allergenes: g.allergenes })),
      ...(produit.composants ?? []),
    ]),
  };
}

/**
 * Quantite de chaque ingredient de garniture consommee par une session.
 *
 * Cumulee PAR INGREDIENT avant toute sortie de stock : deux produits differents
 * peuvent partager la meme cassonade, et repartir en FEFO produit par produit
 * ferait dependre le resultat de l'ordre des lignes de vente.
 *
 * Fonction pure, deliberement separee de l'ecriture : c'est elle qu'on teste
 * pour verifier le cumul, sans avoir besoin d'une base.
 */
export function cumulerGarnituresVendues(
  ventes: readonly {
    readonly quantite: number;
    readonly garnitures: readonly {
      readonly ingredientId: string;
      readonly quantiteParUnite: number;
    }[];
  }[],
): Map<string, number> {
  const parIngredient = new Map<string, number>();
  for (const vente of ventes) {
    for (const garniture of vente.garnitures) {
      const cumul =
        (parIngredient.get(garniture.ingredientId) ?? 0) +
        vente.quantite * garniture.quantiteParUnite;
      parIngredient.set(garniture.ingredientId, cumul);
    }
  }
  // Une quantite nulle n'a rien a sortir du stock : la laisser produirait un
  // mouvement vide et un lot « consomme » a zero dans la tracabilite.
  for (const [ingredientId, quantite] of parIngredient) {
    if (quantite <= 0) parIngredient.delete(ingredientId);
  }
  return parIngredient;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Comparaison de deux versions d'une recette (D-005, fiche 04)

   Versionner une recette n'a d'utilite que si le versionnage reste LISIBLE :
   voir ce qui a change entre deux versions sans devoir relire les deux fiches
   ligne a ligne, cote a cote. Fonction PURE : les deux compositions arrivent
   deja resolues par l'appelant (deux appels a `GET /recettes/:id`), aucun
   acces base ici (regle d'architecture n°1).
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une ligne de composition, telle qu'elle sort de `GET /recettes/:id`. */
export type LigneRecetteComparable = {
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly unite: Unite;
  readonly quantiteReference: number;
};

export type DifferenceLigneRecette =
  | { readonly evolution: 'ajoutee'; readonly ligne: LigneRecetteComparable }
  | { readonly evolution: 'retiree'; readonly ligne: LigneRecetteComparable }
  | {
      readonly evolution: 'quantite-modifiee';
      readonly ingredientId: string;
      readonly nomIngredient: string;
      readonly unite: Unite;
      readonly quantiteAvant: number;
      readonly quantiteApres: number;
    }
  | { readonly evolution: 'inchangee'; readonly ligne: LigneRecetteComparable };

/**
 * Compare la composition de deux versions d'une meme recette.
 *
 * L'appariement se fait par `ingredientId`, JAMAIS par position dans le
 * tableau : un ingredient reordonne (par exemple apres un retrait puis un
 * ajout, ou un tri different cote serveur) n'est pas un ingredient modifie.
 * Seuls trois evenements sont metier : present dans une seule des deux
 * versions (ajout/retrait), ou present dans les deux avec une quantite
 * differente.
 */
export function comparerLignesRecette(
  avant: readonly LigneRecetteComparable[],
  apres: readonly LigneRecetteComparable[],
): DifferenceLigneRecette[] {
  const parIdApres = new Map(apres.map((ligne) => [ligne.ingredientId, ligne]));
  const vusDansAvant = new Set<string>();

  const differences: DifferenceLigneRecette[] = avant.map((ligne) => {
    vusDansAvant.add(ligne.ingredientId);
    const cible = parIdApres.get(ligne.ingredientId);

    if (cible === undefined) {
      return { evolution: 'retiree', ligne };
    }
    if (cible.quantiteReference !== ligne.quantiteReference) {
      return {
        evolution: 'quantite-modifiee',
        ingredientId: ligne.ingredientId,
        nomIngredient: ligne.nomIngredient,
        unite: ligne.unite,
        quantiteAvant: ligne.quantiteReference,
        quantiteApres: cible.quantiteReference,
      };
    }
    return { evolution: 'inchangee', ligne };
  });

  for (const ligne of apres) {
    if (!vusDansAvant.has(ligne.ingredientId)) {
      differences.push({ evolution: 'ajoutee', ligne });
    }
  }

  return differences;
}

/**
 * Ingredient qui limite la production, compte tenu du stock disponible.
 * Alimente le controle de faisabilite du Lot 3 (docs/01 module 3, etape 3).
 */
export function ingredientLimitant(
  recette: RecetteCalcul,
  stockParIngredient: ReadonlyMap<string, number>,
): { ingredientId: string; nomIngredient: string; facteurMaximal: number } | null {
  verifierRecette(recette);

  let limitant: { ingredientId: string; nomIngredient: string; facteurMaximal: number } | null =
    null;

  for (const ligne of recette.lignes) {
    if (ligne.quantiteReference <= 0) continue;
    const disponible = stockParIngredient.get(ligne.ingredientId) ?? 0;
    const facteurMaximal = disponible / ligne.quantiteReference;
    if (limitant === null || facteurMaximal < limitant.facteurMaximal) {
      limitant = {
        ingredientId: ligne.ingredientId,
        nomIngredient: ligne.nomIngredient,
        facteurMaximal,
      };
    }
  }

  return limitant;
}
