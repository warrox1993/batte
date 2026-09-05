/**
 * Conventions d'affichage transverses (docs/07-DOCTRINE-ERP-ET-DESIGN.md §4.5).
 *
 * Un seul endroit pour les regles typographiques du produit, sinon elles
 * divergent d'un ecran a l'autre — et un tableau ou les decimales ne sont pas
 * constantes est un tableau ou rien ne s'aligne, quelle que soit la police.
 *
 * Les caracteres typographiques speciaux sont ecrits en sequences d'echappement
 * et non en litteral : un caractere invisible dans une source est impossible a
 * relire et a deja produit une erreur de lint sur ce projet.
 */

import { formaterEuros, formaterMontant, type Centimes, type PointsDeBase } from './argent.js';
import type { CategorieIngredient } from './contrats/referentiel.js';

/** Tiret cadratin U+2014 : valeur ABSENTE, a ne jamais confondre avec zero. */
export const TIRET_ABSENT = '\u2014';

/** Signe moins typographique U+2212. Le trait d'union est trop court et trop haut. */
const MOINS = '\u2212';

/** Espace insecable etroit U+202F, separateur avant « % » en typographie francaise. */
const ESPACE_FINE = '\u202F';

/**
 * Affiche une valeur, ou le tiret d'absence si elle est nulle.
 *
 * `0,00` est une valeur ; une valeur absente s'ecrit `—`. Un stock a zero et un
 * stock jamais inventorie ne sont pas la meme information — pour l'AFSCA, c'est
 * meme une distinction qui compte.
 */
export function ouTiret<T>(valeur: T | null | undefined, formater: (v: T) => string): string {
  return valeur === null || valeur === undefined ? TIRET_ABSENT : formater(valeur);
}

/**
 * Ecart en points de base, signe systematique.
 *
 * Le signe est toujours affiche, y compris le plus : sans lui, l'oeil doit
 * chercher lesquelles des lignes sont en hausse.
 */
export function formaterEcartPourcent(taux: PointsDeBase, decimales = 1): string {
  const valeur = (Math.abs(taux) / 100).toFixed(decimales).replace('.', ',');
  const signe = taux < 0 ? MOINS : '+';
  return `${signe}${valeur}${ESPACE_FINE}%`;
}

/** Ecart monetaire, signe systematique, sans symbole (l'unite va dans l'en-tete). */
export function formaterEcartMontant(centimes: Centimes): string {
  const signe = centimes < 0 ? MOINS : '+';
  return `${signe}${formaterMontant(Math.abs(centimes))}`;
}

/**
 * Marge de puissance electrique, signee systematiquement, unite comprise.
 *
 * `diagnosticPuissanceLieu` (`packages/core/src/energie.ts`) rend `margeW`
 * POSITIF ou NEGATIF selon que la puissance disponible d'un lieu couvre ou non
 * les equipements en service — mais l'avertissement serveur ne narre QUE le
 * cas negatif (« X W de trop »), jamais la marge positive de securite
 * (docs/21-CHAMPS-NON-LUS.md §2.1). Cette fonction couvre les deux signes pour
 * que l'ecran cesse de se taire sur le cas sans risque.
 */
export function formaterEcartWatts(watts: number): string {
  const signe = watts < 0 ? MOINS : '+';
  return `${signe}${Math.abs(watts)} W`;
}

/**
 * Pourcentage simple, sans decimale par defaut.
 *
 * docs/07 : « 0 decimale, sauf si la decision en depend ». Un taux d'ecoulement
 * a 89,53 % ne se decide pas differemment de 90 %.
 */
export function formaterPourcent(taux: PointsDeBase, decimales = 0): string {
  const valeur = (taux / 100).toFixed(decimales).replace('.', ',');
  return `${valeur}${ESPACE_FINE}%`;
}

/**
 * Libelle abrege de la colonne « taux d'ecoulement » (vendu / produit),
 * commun a `Sessions.tsx` et `TableauDeBord.tsx` (docs/07 §4.5 : une
 * abreviation CHOISIE bat une troncature CSS qui depend de la largeur du
 * navigateur, et coupe ou elle veut). Vivait ecrit mot pour mot dans les
 * deux fichiers avant cette mission, faute de module commun dans le
 * perimetre d'ecriture de la mission precedente — consolide ici.
 */
export const LIBELLE_ECOULEMENT = 'Écoul.';

/**
 * Mot entier derriere `LIBELLE_ECOULEMENT`. Partage par deux emplacements
 * qui doivent dire EXACTEMENT la meme chose : le libelle long de l'en-tete
 * (`libelleLong` d'une `ColonneTableau`, `composants/Tableau.tsx`) et
 * l'infobulle de chaque cellule (`titreEcoulement` ci-dessous). Ce sont
 * deux informations differentes — l'en-tete dit ce que contient la
 * colonne, la cellule dit la valeur entiere — mais le mot qui les nomme
 * doit rester unique.
 */
export const LIBELLE_ECOULEMENT_LONG = "Taux d'écoulement (vendu / produit)";

/**
 * Infobulle de la colonne ecoulement : commence par le texte reellement
 * rendu dans la cellule (`ouTiret(..., formaterPourcent)`), comme l'exige
 * `composants/Tableau.tsx` sur `titre`, puis nomme le mot entier.
 */
export function titreEcoulement(tauxEcoulementBp: number | null): string {
  return `${ouTiret(tauxEcoulementBp, formaterPourcent)} — ${LIBELLE_ECOULEMENT_LONG}`;
}

/**
 * Statut visuel d'une valeur par rapport a un seuil.
 *
 * Les trois etats sont ceux de docs/06 et sont les SEULS usages legitimes de la
 * couleur. Le glyphe est le canal redondant qui rend le signal lisible en
 * daltonisme et a l'impression noir et blanc — les tableaux de cette application
 * partent en PDF chez le comptable et a l'AFSCA.
 */
export type Statut = 'conforme' | 'alerte' | 'depassement';

export const GLYPHE_STATUT: Readonly<Record<Statut, string>> = {
  conforme: '●', // ● rond plein
  alerte: '▲', // ▲ triangle
  depassement: '■', // ■ carre plein
};

/**
 * Statut d'une valeur qui MONTE vers un plafond a ne pas franchir.
 *
 * C'est le cas des seuils legaux : un chiffre d'affaires qui s'approche de la
 * franchise TVA. Le palier d'alerte vient du parametre `seuil_alerte_bp`
 * (8000 = 80 %), jamais d'un litteral.
 *
 * Ne PAS utiliser pour le stock, qui obeit a la logique inverse — voir
 * `statutStock`. Inverser les arguments « fonctionne » mais rend le code
 * illisible et se casse sur le cas de la rupture totale.
 */
export function statutParPlafond(
  valeur: number,
  plafond: number,
  seuilAlerteBp: PointsDeBase,
): Statut {
  if (plafond <= 0) return 'conforme';
  if (valeur >= plafond) return 'depassement';
  return valeur * 10_000 >= plafond * seuilAlerteBp ? 'alerte' : 'conforme';
}

/**
 * Statut d'un stock, qui DESCEND vers un plancher.
 *
 * Trois etats, et pas de parametre de palier : le stock de securite EST deja
 * le palier d'alerte, il est defini par ingredient. Ajouter un pourcentage
 * par-dessus serait un seuil sur un seuil — de la suringenierie.
 *
 * La rupture est distinguee du simple passage sous le seuil : « il ne m'en
 * reste plus » et « il faut recommander » ne demandent pas la meme reaction, et
 * la maquette de docs/06 montre bien deux niveaux (« ▲ COMMANDER » contre OK).
 */
export function statutStock(quantiteDisponible: number, stockSecurite: number): Statut {
  // Rupture : le cas le plus grave, meme sans stock de securite declare.
  if (quantiteDisponible <= 0) return 'depassement';
  // Aucun stock de securite defini : on ne peut rien affirmer, donc rien alerter.
  if (stockSecurite <= 0) return 'conforme';
  return quantiteDisponible < stockSecurite ? 'alerte' : 'conforme';
}

/**
 * Explique pourquoi une marge ne peut pas encore etre estimee, en nommant ce
 * qui manque REELLEMENT.
 *
 * Il y a deux inconnues et elles sont independantes : le prix moyen d'une crepe
 * (il faut un produit transforme avec son prix) et son cout matiere (il faut
 * une recette, ses ingredients, et un conditionnement actif qui donne un prix).
 * L'une peut etre connue sans l'autre.
 *
 * Les confondre derriere un seul drapeau — ce que faisaient les routes
 * `lieux-rentabilite` et `opportunites` — avait deux consequences : un cout
 * matiere inconnu passait pour une matiere GRATUITE dans la marge d'un lieu, et
 * l'avertissement envoyait l'utilisateur ressaisir ce qu'il avait deja saisi.
 *
 * Rend `null` quand les deux sont connus : il n'y a alors rien a avertir, et
 * l'appelant peut en deduire que la marge est calculable.
 */
export function avertissementCoutsManquants(connu: {
  readonly prixMoyenConnu: boolean;
  readonly coutMatiereConnu: boolean;
}): string | null {
  if (connu.prixMoyenConnu && connu.coutMatiereConnu) return null;

  const manques: string[] = [];
  if (!connu.prixMoyenConnu) manques.push('un produit transforme avec son prix de vente');
  if (!connu.coutMatiereConnu) {
    manques.push('une recette avec ses ingredients et leur conditionnement');
  }

  return (
    'Le chiffre d’affaires et la marge ne peuvent pas encore être estimés : ' +
    `renseignez ${manques.join(' et ')}.`
  );
}

/**
 * Nomme ce qu'il manque pour qu'un coût de revient de PRODUIT (transformé ou
 * revendu) soit calculable.
 *
 * TROIS causes possibles, pas deux. Les deux premières restent innommées au
 * niveau de la ligne — elles vivent dans `coutRevientProduit`
 * (`packages/db/src/depots/recettes.ts` : recette vide, ingrédient sans
 * conditionnement actif, article revendu sans prix d'achat…) et ne doivent pas
 * être devinées ni recalculées à l'affichage (règle d'architecture n°1,
 * CLAUDE.md §3) — la NATURE suffit alors à orienter vers le bon écran
 * (Recettes pour un transformé, Ingrédients pour un revendu), même esprit que
 * `avertissementCoutsManquants` ci-dessus.
 *
 * La TROISIÈME cause, elle, SE NOMME : un composant de la NOMENCLATURE DE
 * VENTE (fiche 15, `produit_vente_composant` — gobelet, café en poudre…) sans
 * prix connu. `coutRevientProduit` fournit déjà `composants[].cumpCentsParUnite:
 * null` ligne par ligne (mission du 01/08/2026) — un avertissement qui se
 * contenterait de dire « un composant n'a pas de prix » enverrait chercher au
 * mauvais endroit, alors que l'information exacte est déjà là. `Produits.tsx`
 * calcule cette liste (composants INCLUS dans le coût, `inclusDansLeCout`,
 * dont `cumpCentsParUnite` est `null`) et la transmet ici ; quand elle n'est
 * pas vide, elle prime sur les deux causes génériques — nommer LE composant
 * fautif vaut toujours mieux que nommer une classe de cause.
 *
 * Un menu n'entre pas dans cette fonction : `coutRevientProduit` le rend
 * `null` sans jamais tenter de le calculer, et l'appelant (`Produits.tsx`)
 * court-circuite ce cas avant d'y arriver.
 */
export function avertissementCoutRevientInconnu(
  nature: 'transforme' | 'revendu',
  composantsVenteSansPrix: readonly string[] = [],
): string {
  if (composantsVenteSansPrix.length > 0) {
    const noms = composantsVenteSansPrix.map((nom) => `« ${nom} »`).join(', ');
    return composantsVenteSansPrix.length === 1
      ? `Coût de revient inconnu : le composant de vente ${noms} n’a jamais été acheté (aucun conditionnement actif, donc prix inconnu).`
      : `Coût de revient inconnu : ces composants de vente n’ont jamais été achetés (aucun conditionnement actif, donc prix inconnu) : ${noms}.`;
  }

  return nature === 'transforme'
    ? 'Coût de revient inconnu : la recette rattachée est vide, ou l’un de ses ingrédients n’a aucun conditionnement actif (prix connu).'
    : 'Coût de revient inconnu : cet article n’a aucun conditionnement actif (prix d’achat connu).';
}

/**
 * Message de détection d'économie potentielle (`GET /economies/detecter`,
 * `packages/core/src/contrats/economies.ts:155-174`), pensé pour être lu
 * juste AVANT d'enregistrer un prix — jamais après (commentaire du contrat,
 * `economies.ts:150-153` : « proposer l'écart AVANT saisie »).
 *
 * NE BLOQUE JAMAIS. Un prix plus élevé peut être parfaitement justifié — un
 * dépannage, une qualité différente, un fournisseur plus proche : cette
 * fonction se contente de DIRE l'écart, jamais d'empêcher un enregistrement.
 *
 * `null` dans deux cas, tous deux « rien à comparer, donc rien à dire » :
 *  - `prixReferenceCents` (ou `economieUnitaireCents`) est `null` — aucune
 *    référence n'existe pour ce couple ingrédient/fournisseur, y compris
 *    quand plusieurs formats de tailles différentes coexistent sans
 *    contenance candidate pour trancher (`packages/db/src/depots/economies.ts`) ;
 *  - l'écart est nul — le prix saisi est EXACTEMENT le prix déjà connu, ce
 *    qui n'est ni une économie ni une alerte.
 * Jamais de bandeau « aucune économie possible » affiché à chaque saisie :
 * un message toujours présent cesse d'être lu, exactement le jour où il
 * compterait (même règle que `formaterAvertissementEcartsStock`, `Sessions.tsx`).
 *
 * `francoDePortCents` / `commandeMinimumCents` (`schemaDetectionEconomie`,
 * docs/21-CHAMPS-NON-LUS.md §1.2) restaient non lus alors même que les trois
 * champs voisins avaient déjà été câblés : une économie unitaire peut être
 * réelle sur le papier et pourtant ne rien changer au total payé si la
 * commande n'atteint jamais le minimum du fournisseur, ou si le port
 * facturé mange la différence. Facultatifs (`?:`) pour ne pas casser les
 * appels existants qui ne les fournissent pas encore.
 */
export function messageDetectionEconomie(detection: {
  readonly prixReferenceCents: number | null;
  readonly economieUnitaireCents: number | null;
  readonly economiePotentielle: boolean;
  readonly francoDePortCents?: number | null;
  readonly commandeMinimumCents?: number | null;
}): string | null {
  if (detection.prixReferenceCents === null || detection.economieUnitaireCents === null) {
    return null;
  }
  if (detection.economieUnitaireCents === 0) return null;

  const reference = formaterEuros(detection.prixReferenceCents);
  const message = detection.economiePotentielle
    ? `Économie potentielle : ${formaterEuros(detection.economieUnitaireCents)} de moins que le ` +
      `meilleur prix déjà connu pour cet article chez ce fournisseur (${reference}).`
    : `Ce prix est ${formaterEuros(Math.abs(detection.economieUnitaireCents))} plus élevé que le ` +
      `meilleur prix déjà connu pour cet article chez ce fournisseur (${reference}). Cela peut ` +
      `être justifié — l’information est donnée à titre de repère, elle n’empêche rien.`;

  const conditions: string[] = [];
  if (detection.francoDePortCents !== null && detection.francoDePortCents !== undefined) {
    conditions.push(`franco de port à partir de ${formaterEuros(detection.francoDePortCents)}`);
  }
  if (detection.commandeMinimumCents !== null && detection.commandeMinimumCents !== undefined) {
    conditions.push(`commande minimum ${formaterEuros(detection.commandeMinimumCents)}`);
  }
  if (conditions.length === 0) return message;

  return `${message} Ce fournisseur applique : ${conditions.join(', ')}.`;
}

/**
 * Avertissements d'une réception (`POST /receptions`,
 * `packages/core/src/contrats/stock.ts:148`) À AFFICHER TELS QUELS — jamais
 * reformulés, jamais traduits, jamais complétés. Ce sont des phrases écrites
 * par le serveur (`packages/db/src/services/reception.ts`, notamment le cas
 * d'un lot identifié par sa seule DLC, sans numéro de lot fournisseur) : la
 * source doit rester unique.
 *
 * `null` sur une liste vide (le cas le plus fréquent) : jamais de bandeau
 * « traçabilité correcte » affiché à chaque réception qui n'en produit
 * aucune — un message toujours affiché cesse d'être lu, exactement le jour
 * où il compterait (même règle que `formaterAvertissementEcartsStock`,
 * `Sessions.tsx`).
 */
export function avertissementsReceptionAAfficher(
  avertissements: readonly string[],
): readonly string[] | null {
  return avertissements.length === 0 ? null : avertissements;
}

/**
 * Mention de la commande soldée par une réception (« voir laquelle » —
 * mission « boucle d'achat », 30/07/2026, `packages/core/src/contrats/stock.ts:149-158`).
 * `null` quand aucune commande n'était rattachée à la réception : elle ne
 * soldait rien, il n'y a rien à annoncer.
 */
export function mentionCommandeSoldee(commandeNumero: string | null): string | null {
  return commandeNumero === null ? null : `Commande ${commandeNumero} soldée.`;
}

/**
 * Libellé affiché de chaque catégorie d'ingrédient.
 *
 * UNE seule table, ici, et pas dans les écrans. Le 31/07/2026, l'ajout de la
 * huitième catégorie (`boisson`) a révélé qu'il en existait **trois copies**
 * — `Ingredients.tsx`, `Recettes.tsx`, `Equipements.tsx` — et deux agents les
 * ont complétées séparément, produisant **deux libellés différents pour la même
 * catégorie** visibles dans la même application. Une liste recopiée diverge
 * toujours ; celle-ci est désormais tenue par le compilateur, via
 * `Record<CategorieIngredient, string>`.
 *
 * Le registre est celui des autres : un nom simple, pas une phrase. « Boisson »
 * et non « Boisson chaude » — cette catégorie contient aussi de l'eau, qui n'est
 * pas chaude.
 *
 * `boisson` et `aromate` ont été tranchées le 31/07/2026 (fiche 15 §2.3 et
 * §4.1). Le partage : `boisson` = ce qui COMPOSE une boisson ; `aromate` = ce
 * qui parfume en petite quantité, quel que soit le support — donc la cannelle,
 * l'eau de fleur d'oranger et le sel fin, tous trois auparavant classés
 * `consommable`, catégorie pourtant réservée au NON-alimentaire.
 */
export const LIBELLE_CATEGORIE_INGREDIENT: Readonly<Record<CategorieIngredient, string>> = {
  farine: 'Farine',
  laitier: 'Laitier',
  oeuf: 'Œuf',
  sucre: 'Sucre',
  garniture: 'Garniture',
  consommable: 'Consommable',
  gaz: 'Gaz',
  boisson: 'Boisson',
  aromate: 'Aromate',
};
