/**
 * Point de commande PRÉDICTIF (docs/demandes/06 §3 — « l'extension la plus
 * importante »).
 *
 * Le point de commande RÉACTIF existant
 * (`packages/core/src/reapprovisionnement.ts`, `calculerPointCommande`) se
 * fonde sur une consommation moyenne journalière HISTORIQUE : il réagit à ce
 * qui est déjà consommé. Il est aveugle à un pic de demande PRÉVU au-delà de
 * sa propre fenêtre de délai de livraison.
 *
 * Ce module ajoute un second déclencheur, sans remplacer le premier :
 *
 * ```
 * alerte_anticipee = besoin_projeté_sur_fenêtre(délai .. délai + marge)
 *                    > stock_actuel + commandes_en_cours
 * ```
 *
 * « Les deux coexistent, le plus contraignant des deux déclenche l'alerte »
 * — `combinerDeclencheurs` ci-dessous fait exactement cela, sans jamais
 * supprimer le déclencheur réactif.
 *
 * Fonctions pures, aucun accès base (CLAUDE.md §3 règle 1). Le besoin projeté
 * sur la fenêtre vient de `besoins-ingredients.ts`, filtré par l'appelant aux
 * seules dates qui tombent dans la fenêtre — ce module ne fait que comparer.
 */

/** Fenêtre, en jours depuis aujourd'hui, où une commande passée AUJOURD'HUI arriverait à temps. */
export type FenetrePredictive = {
  readonly debutJours: number;
  readonly finJours: number;
};

/**
 * Fenêtre `[délai_livraison ; délai_livraison + marge_sécurité]`, en jours
 * depuis aujourd'hui.
 *
 * Un événement à forte affluence prévu DANS cette fenêtre est exactement le
 * cas que docs/demandes/06 illustre : « si un événement à forte affluence est
 * prévu dans trois semaines et que le fournisseur de farine met dix jours à
 * livrer, l'alerte doit se déclencher dès qu'on entre dans la fenêtre où
 * commander aujourd'hui serait encore assez tôt ».
 *
 * Bornes ramenées à 0 si négatives : un délai ou une marge saisis par erreur
 * en négatif ne doivent jamais produire une fenêtre qui remonte dans le passé.
 */
export function fenetrePredictive(
  delaiLivraisonJours: number,
  margeSecuriteJours: number,
): FenetrePredictive {
  const debutJours = Math.max(0, delaiLivraisonJours);
  const margeUtile = Math.max(0, margeSecuriteJours);
  return { debutJours, finJours: debutJours + margeUtile };
}

/** Vrai si une date, exprimée en jours depuis aujourd'hui, tombe dans la fenêtre. */
export function dansFenetre(horizonJoursDate: number, fenetre: FenetrePredictive): boolean {
  return horizonJoursDate >= fenetre.debutJours && horizonJoursDate <= fenetre.finJours;
}

export type AlerteCommandeAnticipee = {
  readonly alerte: boolean;
  /** Ce qu'il manquerait si rien n'était commandé d'ici la fenêtre. Jamais négatif. */
  readonly deficit: number;
};

/**
 * Compare le besoin PROJETÉ sur la fenêtre au stock projeté ACTUEL (stock
 * disponible + commandes déjà en cours, non encore reçues — même définition
 * que `stockProjete` dans `reapprovisionnement.ts`).
 *
 * `deficit` est toujours `>= 0` : un stock largement suffisant ne « rembourse »
 * rien, il ne déclenche simplement pas l'alerte — même convention que
 * `calculerBesoinBrut`.
 */
export function alerteCommandeAnticipee(entree: {
  besoinProjeteFenetre: number;
  stockProjeteActuel: number;
}): AlerteCommandeAnticipee {
  const deficit = Math.max(0, entree.besoinProjeteFenetre - entree.stockProjeteActuel);
  return { alerte: deficit > 0, deficit };
}

export type DeclencheurReappro = 'reactif' | 'predictif' | 'les_deux' | 'aucun';

/**
 * Combine le déclencheur RÉACTIF (déjà calculé par `calculerBesoinBrut` >
 * 0) et le déclencheur PRÉDICTIF ci-dessus : « les deux coexistent, le plus
 * contraignant des deux déclenche l'alerte » (docs/demandes/06 §3). Une
 * simple union — aucune priorité entre les deux, l'un n'annule jamais l'autre.
 */
export function combinerDeclencheurs(entree: {
  alerteReactive: boolean;
  alertePredictive: boolean;
}): DeclencheurReappro {
  if (entree.alerteReactive && entree.alertePredictive) return 'les_deux';
  if (entree.alerteReactive) return 'reactif';
  if (entree.alertePredictive) return 'predictif';
  return 'aucun';
}
