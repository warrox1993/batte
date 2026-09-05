/**
 * Faisabilite d'une production et decomposition de l'ecart theorique/reel.
 *
 * Fonctions pures : le stock disponible est fourni par l'appelant, deja calcule
 * a partir des mouvements. Ce module ne lit rien et n'ecrit rien.
 */

import { BASE_POINTS, type Centimes, type PointsDeBase } from './argent.js';
import { ErreurMetier } from './erreurs.js';
import { rendementNetBp, type RecetteCalcul } from './recettes.js';
import { formaterQuantite, type Unite } from './unites.js';

export type BesoinIngredient = {
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly unite: Unite;
  readonly requis: number;
  readonly disponible: number;
  /** Ce qui manque, `0` si le stock suffit. */
  readonly manquant: number;
};

export type ResultatFaisabilite = {
  readonly faisable: boolean;
  readonly besoins: readonly BesoinIngredient[];
  /** Les seuls ingredients qui bloquent, tries du plus contraignant au moins. */
  readonly manquants: readonly BesoinIngredient[];
  /**
   * Ingredient qui bride la production. `null` si tout passe.
   * C'est ce que l'ecran doit nommer : « il manque 1,2 kg de farine T55 ».
   */
  readonly ingredientLimitant: BesoinIngredient | null;
  /**
   * Volume maximal reellement produisible avec le stock actuel, en ml.
   * Permet de proposer « vous pouvez produire 3,2 L au lieu de 5 L ».
   */
  readonly volumeMaximalMl: number;
};

/**
 * Volume de pate a preparer pour obtenir un volume UTILE donne.
 *
 * `Intrant = Sortie x (1 + perte%) + perte_fixe` (docs/07 §1.8). La perte fixe
 * est le fond de bassine et la premiere crepe sacrifiee : elle ne depend pas du
 * volume, et c'est justement pour ca qu'elle pese proportionnellement le plus
 * sur les petites fournees. Un modele qui ne porte que le terme proportionnel
 * sous-estime systematiquement les petites productions.
 */
export function volumeAPreparer(volumeUtileMl: number, perteFixeMl: number): number {
  return Math.round(volumeUtileMl + perteFixeMl);
}

/**
 * Confronte les besoins d'une production au stock disponible.
 *
 * Ne leve jamais : rend un diagnostic complet, y compris quand rien n'est
 * faisable. L'ecran de faisabilite doit pouvoir afficher CHAQUE manque avec son
 * chiffre, pas un refus global (docs/07 §6.3).
 */
export function controlerFaisabilite(
  recette: RecetteCalcul,
  facteur: number,
  stockParIngredient: ReadonlyMap<string, number>,
): ResultatFaisabilite {
  if (recette.lignes.length === 0) {
    throw new ErreurMetier(
      'recette_vide',
      `La recette ${recette.code} ne contient aucun ingrédient.`,
    );
  }
  if (!Number.isFinite(facteur) || facteur <= 0) {
    throw new ErreurMetier('facteur_invalide', 'La quantité à produire doit être positive.');
  }

  const besoins: BesoinIngredient[] = recette.lignes.map((ligne) => {
    const requis = Math.round(ligne.quantiteReference * facteur);
    const disponible = stockParIngredient.get(ligne.ingredientId) ?? 0;
    return {
      ingredientId: ligne.ingredientId,
      nomIngredient: ligne.nomIngredient,
      unite: ligne.unite,
      requis,
      disponible,
      manquant: Math.max(0, requis - disponible),
    };
  });

  const manquants = besoins
    .filter((b) => b.manquant > 0)
    // Le plus contraignant d'abord : celui dont le ratio disponible/requis est
    // le plus faible, et non celui dont le manque brut est le plus gros — 2 g
    // de sel manquants bloquent autant que 2 kg de farine.
    .sort((a, b) => a.disponible / a.requis - b.disponible / b.requis);

  // Facteur maximal atteignable : borne par l'ingredient le plus contraignant.
  let facteurMaximal = Number.POSITIVE_INFINITY;
  for (const ligne of recette.lignes) {
    if (ligne.quantiteReference <= 0) continue;
    const disponible = stockParIngredient.get(ligne.ingredientId) ?? 0;
    facteurMaximal = Math.min(facteurMaximal, disponible / ligne.quantiteReference);
  }
  if (!Number.isFinite(facteurMaximal)) facteurMaximal = 0;

  return {
    faisable: manquants.length === 0,
    besoins,
    manquants,
    ingredientLimitant: manquants[0] ?? null,
    volumeMaximalMl: Math.floor(recette.rendementReferenceMl * facteurMaximal),
  };
}

/** Message pret a afficher, nommant l'ingredient et le chiffre qui manque. */
export function messageFaisabilite(resultat: ResultatFaisabilite): string | null {
  const limitant = resultat.ingredientLimitant;
  if (limitant === null) return null;

  const detail = `il manque ${formaterQuantite(limitant.manquant, limitant.unite)} de ${limitant.nomIngredient}`;
  return resultat.manquants.length === 1
    ? `Production impossible : ${detail}.`
    : `Production impossible : ${detail}, et ${resultat.manquants.length - 1} autre(s) ingrédient(s) en manque.`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ecart theorique / reel
   ═══════════════════════════════════════════════════════════════════════════ */

export type EcartIngredient = {
  readonly ingredientId: string;
  readonly nomIngredient: string;
  readonly unite: Unite;
  readonly theorique: number;
  readonly reel: number;
  /** Positif = on a consomme PLUS que prevu. */
  readonly ecart: number;
  readonly ecartBp: PointsDeBase;
  readonly coutEcartCents: Centimes;
};

/**
 * Decompose l'ecart de consommation, ingredient par ingredient.
 *
 * C'est ce qui repond a « ou fuit la matiere ? » (docs/01 §7). Un ecart
 * persistant sur un seul ingredient signale une louche trop genereuse ou une
 * recette mal calibree ; un ecart general signale une casse sous-estimee.
 *
 * Repere sectoriel : en restauration, un ecart sous 2 % est bon, au-dela de 3 %
 * on enquete (docs/07 §6.8 rang 19).
 */
export function decomposerEcart(
  theoriques: readonly {
    ingredientId: string;
    nomIngredient: string;
    unite: Unite;
    quantite: number;
    cumpCentsParUnite: number;
  }[],
  reels: ReadonlyMap<string, number>,
): EcartIngredient[] {
  return theoriques.map((t) => {
    const reel = reels.get(t.ingredientId) ?? t.quantite;
    const ecart = reel - t.quantite;
    return {
      ingredientId: t.ingredientId,
      nomIngredient: t.nomIngredient,
      unite: t.unite,
      theorique: t.quantite,
      reel,
      ecart,
      // Ecart relatif au theorique. Zero si le theorique est nul, pour ne pas
      // afficher un pourcentage infini sur une ligne a zero.
      ecartBp: t.quantite === 0 ? 0 : Math.round((ecart / t.quantite) * BASE_POINTS),
      coutEcartCents: Math.round(ecart * t.cumpCentsParUnite),
    };
  });
}

/**
 * Rendement reel d'une production, en points de base.
 *
 * A comparer au rendement net theorique de la recette : c'est l'ecart entre les
 * deux qui doit alimenter `perte_cuisson_bp` et `taux_casse_bp` apres quelques
 * fournees. Ces valeurs se MESURENT, elles ne se supposent pas.
 */
export function rendementReelBp(crepesObtenues: number, crepesTheoriques: number): PointsDeBase {
  if (crepesTheoriques <= 0) return 0;
  return Math.round((crepesObtenues / crepesTheoriques) * BASE_POINTS);
}

/** Ecart entre le rendement mesure et celui que la recette annonce. */
export function ecartRendementBp(
  crepesObtenues: number,
  crepesTheoriques: number,
  recette: { perteCuissonBp: PointsDeBase; tauxCasseBp: PointsDeBase },
): PointsDeBase {
  return rendementReelBp(crepesObtenues, crepesTheoriques) - rendementNetBp(recette);
}
