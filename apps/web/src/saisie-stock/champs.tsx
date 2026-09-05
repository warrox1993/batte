import type { ReactNode } from 'react';
import { ErreurApi } from '../lib/api';

/**
 * RÉ-EXPORTS sous les noms historiques de la saisie de stock. `ChampSaisie`
 * EST `ChampTexte`, `ChampSelection` EST `ChampSelect` — un seul composant,
 * deux noms d'appel, zéro duplication.
 */
export {
  CLASSE_BOUTON_LIEN,
  CLASSE_BOUTON_PRIMAIRE,
  CLASSE_BOUTON_SECONDAIRE,
  ChampTexte as ChampSaisie,
  ChampSelect as ChampSelection,
} from '../composants/champs-formulaire';
export type {
  ChampTexteProps as ChampSaisieProps,
  ChampSelectProps as ChampSelectionProps,
  OptionSelection,
} from '../composants/champs-formulaire';

/**
 * Helpers de formulaire PROPRES À LA SAISIE DE STOCK.
 *
 * ═══ Ce fichier ne définit plus de champs (01/08/2026) ═══
 *
 * `ChampSaisie` et `ChampSelection` vivaient ici, en SEPTIÈME et huitième
 * variantes des mêmes composants — six autres dormaient dans autant d'écrans
 * de `pages/`. L'en-tête de ce fichier annonçait déjà, depuis sa création,
 * qu'ils avaient « vocation à REMONTER dans `apps/web/src/composants/` ».
 *
 * C'est fait : ils sont désormais dans `composants/champs-formulaire.tsx`, et
 * ce fichier ne fait plus que les RÉ-EXPORTER sous leurs noms historiques —
 * `ChampSaisie` et `ChampSelection` — pour ne pas réécrire trente sites
 * d'appel sans raison. Les deux noms désignent le même composant.
 *
 * CE QUE LA DUPLICATION AVAIT COÛTÉ, mesuré le jour de la fusion : le
 * correctif « `required` → `aria-required` » (la validation NATIVE du
 * navigateur annulait la soumission et empêchait l'écran d'afficher ses
 * propres messages) a dû être appliqué SEPT fois. Muter `Produits.tsx` ou
 * `Fournisseurs.tsx` pour y remettre le défaut laissait leurs suites
 * ENTIÈREMENT VERTES : aucun test ne le voyait.
 *
 * Ce qui reste ici est ce qui n'appartient qu'au stock : la répartition d'une
 * erreur d'API entre bandeau et champs (`repartirErreurApi`), les trois
 * bandeaux d'état, et la lecture d'une quantité entière positive.
 *
 * Règle d'architecture n°1 (CLAUDE.md §3) : aucun calcul métier ici.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   Classes partagees — un seul endroit ou change l'apparence d'un controle
   ═══════════════════════════════════════════════════════════════════════════ */

/** Jetons semantiques uniquement (docs/07 §4.9) : aucune couleur Tailwind brute. */
/** Action tertiaire en ligne (« Retirer », « Ajouter une ligne »). */
/* ═══════════════════════════════════════════════════════════════════════════
   Erreurs — repartition entre message global et messages de champ
   ═══════════════════════════════════════════════════════════════════════════ */

export type ErreursFormulaire = {
  /** Message par nom de champ, pret a etre affiche SOUS le champ (docs/07 §4.7). */
  readonly champs: Record<string, string>;
  /** Message global. Renseigne UNIQUEMENT quand `champs` est vide. */
  readonly general: string | null;
};

export const AUCUNE_ERREUR: ErreursFormulaire = { champs: {}, general: null };

/**
 * Repartit une erreur d'API entre bandeau et messages de champ (D-035 : 422 +
 * `champs` pour une valeur saisie).
 *
 * LE POINT DELICAT, ET IL PORTE UN CHIFFRE. Le serveur repartit volontairement
 * l'information sur DEUX chaines : `message` porte le chiffre MANQUANT
 * (« Stock insuffisant en Farine T55 : il manque 78,0 kg. ») et `champs.quantite`
 * porte le chiffre DISPONIBLE (« Disponible : 21,0 kg. »). Voir
 * `packages/db/src/services/mouvements.ts`.
 *
 * Les afficher a deux endroits serait le double signalement que docs/07 §4.7
 * interdit — l'utilisateur cherche l'erreur deux fois. N'en garder qu'un
 * perdrait un chiffre, or c'est exactement le chiffre qui rend le refus
 * actionnable. On les RECOLLE donc en une seule phrase, sous le champ designe.
 */
export function repartirErreurApi(erreur: unknown): ErreursFormulaire {
  if (!(erreur instanceof ErreurApi)) {
    return { champs: {}, general: 'Erreur inattendue, sans plus de détail.' };
  }

  const champs = erreur.champs;
  if (champs === undefined) return { champs: {}, general: erreur.message };

  const premier = Object.keys(champs)[0];
  if (premier === undefined) return { champs: {}, general: erreur.message };

  const fusionnes: Record<string, string> = { ...champs };
  fusionnes[premier] = `${erreur.message} ${champs[premier] ?? ''}`.trim();
  return { champs: fusionnes, general: null };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Blocs d'affichage
   ═══════════════════════════════════════════════════════════════════════════ */

/** Bandeau d'erreur persistant : une erreur qui disparait seule est un bug
 * (docs/07 §4.7). */
export function BandeauErreur({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border-l-2 border-depassement bg-depassement-bg px-3 py-2 text-sm text-depassement"
    >
      {message}
    </div>
  );
}

/** Confirmation d'ecriture, avec les chiffres rendus par le serveur. */
export function BandeauSucces({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="border-l-2 border-conforme bg-conforme-bg px-3 py-2 text-sm text-conforme"
    >
      {children}
    </div>
  );
}

/**
 * Avertissement NON BLOQUANT, niveau intermediaire entre succes et erreur
 * (meme rampe `border-alerte`/`bg-alerte-bg` que `ComparaisonLieux.tsx`,
 * `Opportunites.tsx`, `Produits.tsx`) : l'ecriture a reussi, mais un point
 * merite attention avant de passer a la suite — ici, la tracabilite d'un lot
 * identifie par sa seule DLC (CLAUDE.md §3 regle 6).
 */
export function BandeauAlerte({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="border-l-2 border-alerte bg-alerte-bg px-3 py-2 text-sm text-alerte"
    >
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Champs
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   Lecture de saisie — parsing pur, jamais un calcul metier
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Lit une quantite entiere strictement positive, dans l'unite de REFERENCE de
 * l'ingredient (g, ml, piece — CLAUDE.md §3 regle 4).
 *
 * Rend `null` plutot que de deviner un zero : un zero silencieux fabriquerait
 * une entree de stock vide. Meme discipline que `parserEuros` dans
 * `packages/core/src/argent.ts` et que `parserEntierPositif` dans
 * `Production.tsx`, ou l'utilisateur saisit deja un volume en millilitres.
 */
export function parserEntierPositif(saisie: string): number | null {
  const nettoyee = saisie.trim();
  if (!/^\d+$/.test(nettoyee)) return null;
  const valeur = Number.parseInt(nettoyee, 10);
  return valeur > 0 ? valeur : null;
}
