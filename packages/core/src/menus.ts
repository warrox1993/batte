/**
 * MENUS (fiche 16 §2) : un produit_vente peut en contenir d'autres, avec son
 * PROPRE prix — crêpe à 3,50 € + café à 2,00 € vendus 5,00 € en menu.
 *
 * LE PIÈGE, ET C'EST TOUT LE SUJET DE CE FICHIER. Le menu a son propre prix,
 * mais les 50 centimes de remise doivent être RÉPARTIS entre ses composants.
 * Sinon le menu reste un bloc de 5,00 €, et la ventilation transformé/revendu
 * (CLAUDE.md §6) devient fausse — or c'est CETTE ventilation qui alimente les
 * compteurs de seuils légaux (franchise TVA, Airbag, cotisation réduite), qui
 * portent sur le CA et non sur la marge. Un menu non ventilé fausse donc un
 * compteur de seuil sans qu'aucun écran ne le signale.
 *
 * DEUX MÉTHODES DE RÉPARTITION, EN RÉGLAGE PAR MENU (pas un choix global) :
 *  - au PRORATA des prix catalogue — neutre, aucune saisie supplémentaire ;
 *  - PORTÉE PAR UN COMPOSANT DÉSIGNÉ — « le café est à 1,50 € dans ce menu » —
 *    en fixant `prixForceCents` sur ce composant ; les composants NON désignés
 *    se partagent le reste au prorata entre eux. Les deux méthodes sont donc
 *    UNE SEULE fonction : `prixForceCents: null` partout = prorata pur,
 *    `prixForceCents` posé sur un ou plusieurs composants = méthode désignée,
 *    le reste continuant à se répartir au prorata sur les composants restants.
 *
 * GARANTIE NON NÉGOCIABLE : quelle que soit la méthode, la somme des parts
 * rendues vaut EXACTEMENT le prix du menu. C'est `repartir()`
 * (`packages/core/src/argent.ts`) qui porte cette garantie ; ce fichier ne la
 * réimplémente jamais, il la réutilise.
 *
 * UN MENU PEUT CONTENIR UN PRODUIT REVENDU (fiche 16 §2.3, tranché ici : oui).
 * `ventilerMenu` ne suppose donc RIEN sur la nature des composants — la
 * ventilation par nature (`parNatureCents`) est calculée qu'il s'agisse d'un
 * menu 100 % transformé, 100 % revendu, ou mixte. C'est précisément le cas qui
 * rend la ventilation obligatoire dès le premier menu mixte.
 *
 * Fonctions PURES, testées : aucun accès base ici (règle d'architecture n°1).
 * Le dépôt (`packages/db/src/depots/menus.ts`) assemble les données réelles
 * (prix catalogue, coût de revient via `coutRevientProduit`) et appelle ces
 * fonctions.
 */

import { formaterEuros, repartir, type Centimes } from './argent.js';
import { ErreurMetier } from './erreurs.js';
import type { LigneVente, NatureProduit } from './sessions.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Répartition du prix du menu
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Contexte facultatif d'un appel à `repartirPrixMenu`/`ventilerMenu`, utilisé
 * UNIQUEMENT pour NOMMER le menu dans le message d'erreur (audit du
 * 01/08/2026, fiche 16 §2.2) — jamais pour changer un calcul.
 *
 * Facultatif à dessein : `nomMenu` absent, le message reste correct, il dit
 * juste « ce menu » au lieu de « Menu « Crêpes du Marché » ». C'est ce qui
 * permet d'appeler `repartirPrixMenu` depuis un contexte qui n'a pas chargé
 * le menu — un refus lisible ne doit jamais dépendre d'une jointure.
 */
export type ContexteMenu = {
  readonly nomMenu?: string;
};

/** Un composant à ventiler : son nom, son poids de répartition, et un prix imposé optionnel. */
export type PartComposantMenu = {
  /**
   * Nom AFFICHABLE du composant (« Café », « Sirop de Liège »). Sert
   * UNIQUEMENT à nommer le fautif dans le message d'erreur ci-dessous — le
   * calcul ne le lit jamais.
   */
  readonly nom: string;
  /** Poids relatif pour le prorata (typiquement `quantite × prixCatalogueCents`). */
  readonly poids: number;
  /**
   * `null` = ce composant suit le prorata. Un montant = « ce composant vaut
   * exactement CE prix dans CE menu » (méthode désignée, fiche 16 §2.2).
   */
  readonly prixForceCents: Centimes | null;
};

/** Un composant DÉSIGNÉ, tel qu'utilisé pour composer les messages d'erreur ci-dessous. */
type ComposantDesigne = { readonly nom: string; readonly prixForceCents: Centimes };

function composantsDesignes(composants: readonly PartComposantMenu[]): ComposantDesigne[] {
  return composants
    .filter(
      (composant): composant is PartComposantMenu & { prixForceCents: Centimes } =>
        composant.prixForceCents !== null,
    )
    .map((composant) => ({ nom: composant.nom, prixForceCents: composant.prixForceCents }));
}

/**
 * « « café » (1,50 €) » ou « « café » (1,50 €), « sirop » (3,80 €) » — une
 * simple LISTE, jamais une phrase avec verbe : le nombre de composants
 * désignés varie (un ou plusieurs), et un verbe français s'accorde sur ce
 * nombre. Composer une liste plutôt qu'une proposition évite cet accord dans
 * les deux messages d'erreur ci-dessous, qui restent ainsi valables quel que
 * soit le nombre de composants en cause.
 */
function listeComposantsDesignes(designes: readonly ComposantDesigne[]): string {
  return designes
    .map((composant) => `« ${composant.nom} » (${formaterEuros(composant.prixForceCents)})`)
    .join(', ');
}

/** « Menu « Crêpes du Marché » : » quand l'appelant le sait, sinon rien — voir `ContexteMenu`. */
function prefixeMenu(contexte: ContexteMenu): string {
  return contexte.nomMenu === undefined ? '' : `Menu « ${contexte.nomMenu} » : `;
}

/**
 * Répartit `prixMenuCents` entre `composants`, dans l'ORDRE fourni.
 *
 * ALGORITHME : les composants à prix IMPOSÉ reçoivent exactement ce montant.
 * Le RESTE (`prixMenuCents` moins la somme des prix imposés) se répartit au
 * PRORATA du `poids` sur les composants restants, via `repartir()` — qui
 * garantit que la somme des parts non imposées vaut exactement ce reste, le
 * centime d'arrondi allant à la DERNIÈRE part libre (voir la doc de
 * `repartir`). Aucun composant imposé : c'est le prorata pur, appliqué à la
 * totalité du prix du menu.
 *
 * Aucun composant NON imposé : tous les prix doivent alors sommer EXACTEMENT
 * au prix du menu, sans quoi rien ne reste pour absorber un écart.
 *
 * MESSAGE D'ERREUR (audit du 01/08/2026, fiche 16 §2.2) : un porteur qui fait
 * une remise un jour de marché peut vendre un menu moins cher que la somme de
 * ses prix désignés — cas RÉEL, pas théorique (voir le rapport de livraison
 * de cette mission). Comme `cloturerSession` ventile CHAQUE menu dans LA MÊME
 * transaction que toute la clôture, cette erreur bloque la clôture ENTIÈRE
 * tant que le porteur n'a pas corrigé le prix pratiqué ou le réglage du menu
 * — un refus JUSTE (inventer une répartition fausserait la ventilation
 * transformé/revendu, CLAUDE.md §6), mais qui doit alors dire TROIS choses
 * pour rester actionnable : quel menu (`ContexteMenu.nomMenu`, quand
 * l'appelant le fournit), quels composants portent le prix désigné fautif
 * (`listeComposantsDesignes`), et les DEUX issues (corriger le prix pratiqué
 * de cette vente, ou ajuster le prix désigné dans la fiche du menu) — jamais
 * juste un écart de centimes bruts (« 1140 c ») qui ne dit ni où regarder ni
 * quoi faire. Montants systématiquement en EUROS (`formaterEuros`) : les
 * centimes sont une unité de stockage, pas une unité d'affichage.
 *
 * @throws {ErreurMetier} `menu_sans_composant` si `composants` est vide ;
 *   `menu_prix_force_incoherent` si les prix imposés dépassent le prix du menu,
 *   ou si — tous imposés — leur somme n'égale pas exactement ce prix.
 */
export function repartirPrixMenu(
  prixMenuCents: Centimes,
  composants: readonly PartComposantMenu[],
  contexte: ContexteMenu = {},
): Centimes[] {
  if (composants.length === 0) {
    throw new ErreurMetier(
      'menu_sans_composant',
      "Impossible de répartir le prix d'un menu sans composant déclaré.",
    );
  }

  let sommeForceeCents = 0;
  const indicesLibres: number[] = [];
  const poidsLibres: number[] = [];
  composants.forEach((composant, indice) => {
    if (composant.prixForceCents === null) {
      indicesLibres.push(indice);
      poidsLibres.push(composant.poids);
    } else {
      sommeForceeCents += composant.prixForceCents;
    }
  });

  const resteAVentilerCents = prixMenuCents - sommeForceeCents;

  if (indicesLibres.length === 0) {
    if (resteAVentilerCents !== 0) {
      throw new ErreurMetier(
        'menu_prix_force_incoherent',
        `${prefixeMenu(contexte)}Prix désigné(s) : ${listeComposantsDesignes(composantsDesignes(composants))}, ` +
          `soit ${formaterEuros(sommeForceeCents)} au total. Cela ne correspond pas au prix ` +
          `pratiqué de ce menu (${formaterEuros(prixMenuCents)}) : l'écart est de ` +
          `${formaterEuros(Math.abs(resteAVentilerCents))}. Corrigez le prix pratiqué de cette ` +
          'vente, ou ajustez un des prix désignés dans la fiche du menu.',
      );
    }
    return composants.map((composant) => composant.prixForceCents ?? 0);
  }

  if (resteAVentilerCents < 0) {
    const nomsLibres = indicesLibres.map((indice) => `« ${composants[indice]!.nom} »`).join(' et ');
    throw new ErreurMetier(
      'menu_prix_force_incoherent',
      `${prefixeMenu(contexte)}Prix désigné(s) : ${listeComposantsDesignes(composantsDesignes(composants))}, ` +
        `soit ${formaterEuros(sommeForceeCents)} au total. Cela dépasse déjà le prix pratiqué de ` +
        `ce menu (${formaterEuros(prixMenuCents)}) de ${formaterEuros(-resteAVentilerCents)} : ` +
        `il ne reste rien pour ${nomsLibres}. Corrigez le prix pratiqué de cette vente (la ` +
        'remise est trop forte pour ce réglage), ou réduisez/retirez le prix désigné dans la ' +
        'fiche du menu.',
    );
  }

  const partsLibres = repartir(resteAVentilerCents, poidsLibres);

  const resultat = new Array<Centimes>(composants.length);
  indicesLibres.forEach((indiceOriginal, i) => {
    resultat[indiceOriginal] = partsLibres[i]!;
  });
  composants.forEach((composant, indice) => {
    if (composant.prixForceCents !== null) resultat[indice] = composant.prixForceCents;
  });
  return resultat;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ventilation complète d'un menu : prix, coût, marge
   ═══════════════════════════════════════════════════════════════════════════ */

/** Un composant d'un menu, tel que le dépôt le résout (prix catalogue, coût de revient). */
export type ComposantMenuCalcul = {
  readonly produitInclusId: string;
  readonly nom: string;
  readonly nature: NatureProduit;
  /** Nombre d'unités de ce composant par menu vendu (colonne `menu_composition.quantite`). */
  readonly quantite: number;
  /** Prix de vente du composant seul, hors menu — sert de poids au prorata. */
  readonly prixCatalogueCents: Centimes;
  /**
   * Coût de revient UNITAIRE du composant, `null` si inconnu (`coutRevientProduit`
   * ne le devine jamais). Un seul composant inconnu suffit à rendre TOUT le
   * coût du menu inconnu — jamais un coût partiel présenté comme complet.
   */
  readonly coutMatiereCents: Centimes | null;
  /** Crêpes consommées par unité de ce composant. `0` pour un revendu. */
  readonly nbCrepesParUnite: number;
  /** Réglage « composant désigné » (fiche 16 §2.2). `null` = ce composant suit le prorata. */
  readonly prixForceCents: Centimes | null;
};

export type VentilationComposantMenu = {
  readonly produitInclusId: string;
  readonly nom: string;
  readonly nature: NatureProduit;
  readonly quantite: number;
  readonly nbCrepesParUnite: number;
  /** Part du prix du menu attribuée à CE composant (toutes ses unités confondues), pour 1 menu vendu. */
  readonly partPrixCents: Centimes;
  /** Coût de revient total de ce composant (quantite × coût unitaire), pour 1 menu vendu. `null` si inconnu. */
  readonly coutTotalCents: Centimes | null;
};

export type VentilationMenu = {
  readonly composants: readonly VentilationComposantMenu[];
  /**
   * CA du menu ventilé par nature — LE chiffre qui alimente les compteurs de
   * seuils légaux (CLAUDE.md §6). Toujours calculable, MÊME quand le coût de
   * revient est inconnu : la ventilation du CA ne dépend d'aucun coût.
   */
  readonly parNatureCents: Readonly<Record<NatureProduit, Centimes>>;
  /** Somme des coûts de revient des composants. `null` si un seul est inconnu. */
  readonly coutTotalCents: Centimes | null;
  /** Marge du menu tel que vendu (prix du menu − coût total). */
  readonly margeMenuCents: Centimes | null;
  /** Somme des prix catalogue des composants — ce qu'aurait payé un client les achetant séparément. */
  readonly prixSepareTotalCents: Centimes;
  /** Marge qu'auraient rapportée les mêmes composants vendus séparément. */
  readonly margeSepareeCents: Centimes | null;
  /**
   * `margeMenuCents − margeSepareeCents` : négatif si le menu coûte de la
   * marge pour gagner du volume (le cas courant), jamais présumé — c'est la
   * comparaison que fiche 16 §2.3 demande d'afficher à côté l'une de l'autre.
   */
  readonly ecartMargeCents: Centimes | null;
};

/**
 * Poids de prorata d'un composant. Un composant OFFERT (prix catalogue nul)
 * ne peut porter aucun poids proportionnel : `repartir()` refuse une somme de
 * poids nulle si un montant reste à ventiler. On bascule alors sur la
 * QUANTITÉ comme poids, pour que la remise se répartisse quand même plutôt
 * que de faire échouer tout le calcul du menu à cause d'un seul composant
 * gratuit.
 */
function poidsProrata(composant: ComposantMenuCalcul): number {
  const poidsCatalogue = composant.quantite * composant.prixCatalogueCents;
  return poidsCatalogue > 0 ? poidsCatalogue : composant.quantite;
}

/**
 * Ventile le prix d'UN menu vendu entre ses composants : prix par nature,
 * coût de revient total, marge du menu, et marge de référence si les mêmes
 * composants avaient été vendus séparément.
 *
 * `composants[].prixForceCents` porte le réglage par menu (fiche 16 §2.2) :
 * `null` partout = prorata pur ; posé sur un ou plusieurs composants = méthode
 * désignée pour ceux-là, prorata pour le reste. Voir `repartirPrixMenu`.
 *
 * `contexte.nomMenu` (facultatif, voir `ContexteMenu`) ne sert qu'à NOMMER le
 * menu si `repartirPrixMenu` refuse la remise (`menu_prix_force_incoherent`).
 * Il traverse `ventilerMenu` sans être lu autrement : aucun calcul n'en
 * dépend, seul le message d'erreur change.
 */
export function ventilerMenu(
  prixMenuCents: Centimes,
  composants: readonly ComposantMenuCalcul[],
  contexte: ContexteMenu = {},
): VentilationMenu {
  const parts = repartirPrixMenu(
    prixMenuCents,
    composants.map((composant) => ({
      nom: composant.nom,
      poids: poidsProrata(composant),
      prixForceCents: composant.prixForceCents,
    })),
    contexte,
  );

  let coutInconnu = false;
  let coutTotalExactCents = 0;
  let prixSepareTotalCents = 0;
  const parNatureCents: Record<NatureProduit, Centimes> = { transforme: 0, revendu: 0 };

  const lignes: VentilationComposantMenu[] = composants.map((composant, indice) => {
    const partPrixCents = parts[indice]!;
    parNatureCents[composant.nature] += partPrixCents;
    prixSepareTotalCents += composant.quantite * composant.prixCatalogueCents;

    let coutTotalCents: Centimes | null;
    if (composant.coutMatiereCents === null) {
      coutInconnu = true;
      coutTotalCents = null;
    } else {
      // Deux entiers, jamais d'arrondi : la quantite et le cout unitaire sont
      // deja des entiers de centimes (CLAUDE.md §3 regles 3 et 4).
      coutTotalCents = composant.quantite * composant.coutMatiereCents;
      coutTotalExactCents += coutTotalCents;
    }

    return {
      produitInclusId: composant.produitInclusId,
      nom: composant.nom,
      nature: composant.nature,
      quantite: composant.quantite,
      nbCrepesParUnite: composant.nbCrepesParUnite,
      partPrixCents,
      coutTotalCents,
    };
  });

  const coutTotalCents = coutInconnu ? null : coutTotalExactCents;
  const margeMenuCents = coutTotalCents === null ? null : prixMenuCents - coutTotalCents;
  const margeSepareeCents = coutTotalCents === null ? null : prixSepareTotalCents - coutTotalCents;
  const ecartMargeCents =
    margeMenuCents === null || margeSepareeCents === null
      ? null
      : margeMenuCents - margeSepareeCents;

  return {
    composants: lignes,
    parNatureCents,
    coutTotalCents,
    margeMenuCents,
    prixSepareTotalCents,
    margeSepareeCents,
    ecartMargeCents,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Stock : un menu vendu sort le stock de ses composants
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une ligne de `menu_composition` : un produit inclus, en quelle quantité. */
export type LigneCompositionMenu = {
  readonly produitInclusId: string;
  readonly quantite: number;
};

/** Un menu vendu N fois sur une session, avec le mode de consommation de la vente. */
export type VenteMenuAExploser = {
  readonly menuId: string;
  readonly quantite: number;
};

/**
 * Explose des ventes de MENUS en quantités EFFECTIVES de leurs composants,
 * cumulées PAR PRODUIT sur l'ensemble des ventes fournies.
 *
 * C'est la nomenclature de vente (fiche 15) transposée au niveau produit :
 * un menu vendu ne sort rien du stock par lui-même, ce sont ses composants qui
 * en sortent. Le résultat se réinjecte tel quel dans les mécanismes EXISTANTS
 * qui savent déjà consommer un produit vendu par son id et sa quantité
 * (composants de nomenclature de vente, garnitures, stock des revendus) : un
 * menu vendu 3 fois avec 2 unités d'un composant vaut 6 ventes EFFECTIVES de
 * ce composant, ni plus ni moins.
 *
 * Cumule d'abord, jamais produit par produit : deux menus différents peuvent
 * partager le même composant (le café dans deux formules différentes), et le
 * cumul évite de dépendre de l'ordre des lignes (même discipline que
 * `cumulerComposantsVendus` de `nomenclature-vente.ts`). Toutes les quantités
 * en jeu sont des ENTIERS : aucun arrondi n'est nécessaire ici.
 */
export function exploserVentesMenusEnQuantitesComposants(
  ventes: readonly VenteMenuAExploser[],
  compositions: ReadonlyMap<string, readonly LigneCompositionMenu[]>,
): Map<string, number> {
  const total = new Map<string, number>();

  for (const vente of ventes) {
    if (vente.quantite <= 0) continue;
    const lignes = compositions.get(vente.menuId) ?? [];
    for (const ligne of lignes) {
      if (ligne.quantite <= 0) continue;
      const contribution = vente.quantite * ligne.quantite;
      total.set(ligne.produitInclusId, (total.get(ligne.produitInclusId) ?? 0) + contribution);
    }
  }

  return total;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CA : explosion d'une vente de menu en lignes de vente par composant
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une vente d'un menu précis, prête à être ventilée et explosée en CA par composant. */
export type VenteMenuAVentiler = {
  readonly menuId: string;
  /** Nombre de menus vendus, sur la session. */
  readonly quantite: number;
  /** Mode de consommation de CETTE vente — un menu se vend en un bloc, jamais mi-sur-place mi-emporté. */
  readonly consommationSurPlace: boolean;
};

/**
 * Explose UNE vente de menu en lignes de vente PAR COMPOSANT, au format
 * `LigneVente` de `sessions.ts` — pour que `totaliserVentes` (déjà existant,
 * déjà testé) ventile le CA du menu en transformé/revendu et en sur-place/
 * emporté SANS AUCUNE modification.
 *
 * PIÈGE ÉVITÉ : une ligne par composant utilise `quantite: 1` et
 * `prixUnitaireCents` = le montant DÉJÀ TOTALISÉ sur tous les menus vendus et
 * toutes les unités du composant. Une part de prix ne se divise pas forcément
 * exactement par la quantité du composant (`repartir()` garantit la SOMME, pas
 * la divisibilité) : diviser puis laisser `totaliserVentes` remultiplier
 * réintroduirait un arrondi non maîtrisé sur un chemin d'argent. `quantite: 1`
 * l'évite entièrement — CLAUDE.md §3 règle 3, argent toujours entier.
 *
 * `nbCrepesParUnite` de la ligne rendue porte, du même principe, le nombre
 * TOTAL de crêpes déjà consommées par ce composant sur cette vente (et non un
 * taux par unité) : `totaliserVentes` le multiplie par `quantite === 1`, donc
 * le total sort inchangé.
 */
export function exploserVenteMenuEnLignesVente(
  vente: VenteMenuAVentiler,
  ventilation: VentilationMenu,
): LigneVente[] {
  if (vente.quantite <= 0) return [];

  return ventilation.composants.map((composant) => ({
    produitVenteId: composant.produitInclusId,
    nature: composant.nature,
    quantite: 1,
    prixUnitaireCents: vente.quantite * composant.partPrixCents,
    nbCrepesParUnite: vente.quantite * composant.quantite * composant.nbCrepesParUnite,
    consommationSurPlace: vente.consommationSurPlace,
  }));
}
