/**
 * Argent en centimes d'euro, toujours en entier (CLAUDE.md §3, decision D-003).
 * Aucun flottant ne doit exister sur un chemin monetaire : le formatage vers une
 * chaine lisible est la SEULE operation autorisee a produire des decimales, et
 * elle se fait a l'affichage uniquement.
 */

import { ErreurMetier } from './erreurs.js';

/** Marqueur de lisibilite : partout ou l'on lit `Centimes`, il s'agit d'un entier. */
export type Centimes = number;

const LOCALE = 'fr-BE';

const formateurEuros = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'EUR',
});

/**
 * Arrondi au plus proche, les demis s'ecartant de zero, et jamais `-0` en sortie.
 *
 * POURQUOI PAS `Math.round` DIRECTEMENT. `Math.round` arrondit les demis vers
 * +∞ : `Math.round(0,5) === 1` mais `Math.round(-0,5) === -0`. Appliquee a de
 * l'argent, cette asymetrie fait qu'un remboursement ne rend pas exactement ce
 * que l'encaissement avait pris — la commission SumUp de 1,69 % sur un avoir
 * differe d'un centime de celle sur la vente qu'il annule, et ce centime reste
 * au journal sans contrepartie. On impose donc `f(-x) === -f(x)`.
 *
 * POURQUOI INTERDIRE `-0`. Un montant nul s'ecrit `0`. `Object.is(-0, 0)` vaut
 * `false` : un `-0` qui circule casse des egalites strictes, des cles de Map, et
 * s'affiche « -0,00 € » a l'ecran. `-0` est une limite mathematique, pas un
 * montant.
 *
 * Fonction volontairement privee : c'est un detail d'arrondi partage par les
 * fonctions de ce module, pas une primitive de plus a exposer.
 */
function arrondiSymetrique(valeur: number): number {
  const magnitude = Math.round(Math.abs(valeur));
  if (magnitude === 0) return 0;
  return valeur < 0 ? -magnitude : magnitude;
}

/** 123456 -> « 1 234,56 € ». */
export function formaterEuros(centimes: Centimes): string {
  return formateurEuros.format(centimes / 100);
}

/** 123456 -> « 1 234,56 » (sans symbole, pour les colonnes de tableau). */
export function formaterMontant(centimes: Centimes): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centimes / 100);
}

/**
 * Lit une saisie utilisateur (« 12,34 », « 12.34 », « 1 234,56 », « 12,34 € »)
 * et rend des centimes entiers. Rend `null` si la saisie n'est pas un montant :
 * c'est a l'appelant de decider quoi en faire, jamais a cette fonction de
 * deviner un zero (un zero silencieux fausse une caisse).
 */
export function parserEuros(saisie: string): Centimes | null {
  // `\s` couvre deja l'espace insecable et l'espace insecable etroit inseres par
  // Intl.NumberFormat en fr-BE : un montant copie depuis l'application est donc
  // relu correctement, sans avoir a lister ces caracteres invisibles ici.
  const nettoye = saisie.replace(/\s/g, '').replace(/€/g, '').replace(',', '.');
  if (nettoye === '' || !/^-?\d*\.?\d*$/.test(nettoye)) return null;
  const valeur = Number(nettoye);
  if (!Number.isFinite(valeur)) return null;
  // Meme arrondi que partout ailleurs : « -0,005 € » vaut -1 centime, pas -0.
  return arrondiSymetrique(valeur * 100);
}

/**
 * Points de base : 10 000 = 100 % (CLAUDE.md §3). Evite de stocker des taux en
 * flottant, pour la meme raison que l'argent.
 */
export type PointsDeBase = number;

export const BASE_POINTS = 10_000;

/**
 * Applique un taux exprime en points de base a un montant, avec arrondi entier.
 *
 * L'operation est SYMETRIQUE : `f(-x, t) === -f(x, t)`. Un avoir fournisseur se
 * deduit donc exactement de la depense d'origine, et la commission carte d'un
 * remboursement annule exactement celle de l'encaissement.
 */
export function appliquerPointsDeBase(centimes: Centimes, taux: PointsDeBase): Centimes {
  return arrondiSymetrique((centimes * taux) / BASE_POINTS);
}

/** 1550 -> « 15,5 % ». */
export function formaterPointsDeBase(taux: PointsDeBase): string {
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(
    (taux / BASE_POINTS) * 100,
  )} %`;
}

/** Part de `partie` dans `total`, en points de base. Rend 0 si `total` vaut 0. */
export function ratioEnPointsDeBase(partie: number, total: number): PointsDeBase {
  if (total === 0) return 0;
  return arrondiSymetrique((partie / total) * BASE_POINTS);
}

/**
 * Repartit `totalCents` en parts proportionnelles a `poids`, sans perdre un
 * centime.
 *
 * GARANTIE, et c'est la seule raison d'etre de cette fonction : la somme des
 * parts rendues egale EXACTEMENT `totalCents`, pour tout total (positif, negatif
 * ou nul) et tout jeu de poids valide. Arrondir chaque part independamment ne
 * donne pas cela : 1,00 € en trois tiers via `appliquerPointsDeBase` rend
 * 33 + 33 + 33 = 99 centimes, et le centime manquant n'est rattrape nulle part.
 * Ventiler un frais d'emplacement entre sessions, une facture entre categories
 * de depense ou une commission entre lignes de vente passe donc par ici.
 *
 * OU VA LE RELIQUAT : sur la DERNIERE part. La construction est cumulative —
 * chaque part vaut l'arrondi du cumul jusqu'a elle moins ce qui a deja ete
 * attribue — et la derniere part est ecrite comme le reste exact
 * (`totalCents − deja attribue`).
 *
 * POURQUOI CE CHOIX, plutot que « la plus grosse part absorbe » ou la methode du
 * plus fort reste :
 *  - c'est deja la convention de `planAmortissement` pour la derniere annuite,
 *    donc une seule regle a retenir dans tout le projet ;
 *  - elle est verifiable a la main sur un ecran, ce qui compte pour une
 *    comptabilite relue ligne a ligne ;
 *  - elle est STABLE : le meme appel rend toujours le meme decoupage, condition
 *    necessaire pour qu'un recalcul ne fasse pas bouger un journal deja imprime.
 *
 * Le prix a payer est borne et connu : grace au cumul, CHAQUE part — derniere
 * comprise — s'ecarte d'au plus 1 centime de sa part exacte. C'est ce que le
 * cumul apporte par rapport a « on colle tout le reliquat a la fin » : la
 * derniere part n'absorbe pas la somme des arrondis precedents.
 *
 * CONSEQUENCE POUR L'APPELANT : l'ordre de `poids` est significatif. Mettre en
 * derniere position la part qui peut porter le centime sans gener (le poste
 * « divers », la session la plus grosse), pas la plus petite ligne.
 *
 * @param totalCents Montant a ventiler, en centimes entiers. Peut etre negatif.
 * @param poids Poids relatifs, dans n'importe quelle unite (grammes, points de
 *   base, nombre de crepes). Chacun doit etre fini et >= 0.
 * @throws {ErreurMetier} `repartition_montant_invalide` si le total n'est pas un
 *   entier fini ; `repartition_poids_invalide` si la liste est vide, si un poids
 *   est negatif ou non fini, ou si tous les poids sont nuls alors que le total
 *   ne l'est pas.
 */
export function repartir(totalCents: Centimes, poids: readonly number[]): Centimes[] {
  if (!Number.isInteger(totalCents)) {
    throw new ErreurMetier(
      'repartition_montant_invalide',
      `Un montant à répartir doit être un entier de centimes (reçu : ${totalCents}).`,
    );
  }

  // Aucune part ou tout va nulle part : le montant disparaitrait silencieusement.
  // Une liste vide trahit presque toujours un filtre trop strict ou des donnees
  // pas encore chargees ; echouer bruyamment vaut mieux qu'un tableau vide.
  if (poids.length === 0) {
    throw new ErreurMetier(
      'repartition_poids_invalide',
      "Impossible de répartir un montant : aucune part n'a été fournie.",
    );
  }

  let sommePoids = 0;
  for (const p of poids) {
    if (!Number.isFinite(p) || p < 0) {
      throw new ErreurMetier(
        'repartition_poids_invalide',
        `Un poids de répartition doit être un nombre fini positif ou nul (reçu : ${p}).`,
      );
    }
    sommePoids += p;
  }

  // Un total nul se ventile en parts nulles quels que soient les poids : aucune
  // proportion n'a besoin d'etre calculee, donc pas de division par zero et pas
  // de raison de refuser des poids tous nuls dans ce cas precis.
  if (totalCents === 0) return poids.map(() => 0);

  if (sommePoids === 0) {
    throw new ErreurMetier(
      'repartition_poids_invalide',
      'Impossible de répartir un montant sur des poids tous nuls : aucune proportion ne peut en être déduite.',
    );
  }

  const parts: Centimes[] = [];
  let cumulPoids = 0;
  let cumulAttribue = 0;
  // Toutes les parts sauf la derniere. On soustrait le cumul deja attribue au
  // lieu d'arrondir chaque part isolement : c'est ce qui empeche les erreurs
  // d'arrondi de s'accumuler d'une part a l'autre.
  for (let i = 0; i < poids.length - 1; i += 1) {
    cumulPoids += poids[i]!;
    const cumulCible = arrondiSymetrique((totalCents * cumulPoids) / sommePoids);
    parts.push(cumulCible - cumulAttribue);
    cumulAttribue = cumulCible;
  }
  // La derniere part est le RESTE, pas un arrondi : la garantie de somme est donc
  // vraie par construction. La deduire d'un dernier `(total × cumul) / somme`
  // reposerait sur `(a × b) / b === a` en virgule flottante, ce qui n'est pas
  // garanti — un centime pourrait manquer sur certains jeux de poids.
  parts.push(totalCents - cumulAttribue);
  return parts;
}
