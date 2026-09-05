/**
 * Navigation clavier d'une grille ARIA (`role="grid"`), en logique PURE.
 *
 * Pourquoi un module separe de `Tableau.tsx` : le composant est instancie dans
 * la quasi-totalite des ecrans (mesure du 01/08/2026 : 72 instanciations dans
 * 29 fichiers de production), et une regression de navigation y est invisible
 * jusqu'a l'usage. Isoler la decision « quelle touche mene ou » dans des
 * fonctions sans DOM la rend prouvable SANS rendre quoi que ce soit : ni
 * montage, ni balisage, juste une entree et une sortie. C'est ce qui permet de
 * couvrir toutes les touches et tous les bords a cout nul.
 *
 * Le motif implemente est celui du patron `grid` de l'APG :
 * <https://www.w3.org/WAI/ARIA/apg/patterns/grid/>
 */

/**
 * Nombre de rangees parcourues par `PageSuivante` / `PagePrecedente`.
 *
 * 10 et non « une hauteur d'ecran » : le viewport cible fait 720 px, soit
 * ~16 rangees de 32 px moins le chrome (docs/07 §4.4). Un saut de 10 laisse
 * toujours quelques rangees communes entre l'avant et l'apres, donc l'utilisateur
 * garde un repere visuel. Un saut exactement egal a la page en fait perdre un.
 */
export const PAS_PAGE_GRILLE = 10;

/** Ce que la grille doit faire en reponse a une touche. `null` = ne rien faire. */
export type ActionGrille =
  { readonly type: 'selectionner' } | { readonly type: 'deplacer'; readonly index: number };

/**
 * Index vise par une touche de deplacement, AVANT bornage. `null` si la touche
 * n'est pas une touche de deplacement.
 */
function indexVise(touche: string, indexCourant: number, dernierIndex: number): number | null {
  switch (touche) {
    case 'ArrowDown':
      return indexCourant + 1;
    case 'ArrowUp':
      return indexCourant - 1;
    case 'PageDown':
      return indexCourant + PAS_PAGE_GRILLE;
    case 'PageUp':
      return indexCourant - PAS_PAGE_GRILLE;
    case 'Home':
      return 0;
    case 'End':
      return dernierIndex;
    default:
      return null;
  }
}

/**
 * Traduit une frappe en action de grille.
 *
 * Deux decisions de comportement, assumees :
 *
 * 1. **Pas de bouclage.** Fleche Bas sur la derniere rangee ne revient PAS a la
 *    premiere. Sur un registre AFSCA de 40 lignes, un bouclage silencieux
 *    telepor­terait l'utilisateur en haut de liste sans qu'aucun signal ne le
 *    dise — exactement le sentiment « perdu » que docs/07 §0 interdit. C'est
 *    aussi le comportement d'Excel, que l'utilisateur cible connait (docs/07 §4.6).
 * 2. **Une frappe qui ne deplace rien retourne `null`**, donc l'appelant ne fait
 *    pas `preventDefault()` : le defilement natif de la page reprend la main.
 *    Buter en bas de grille fait donc defiler la page — le retour est physique,
 *    pas silencieux.
 */
export function interpreterToucheGrille(
  touche: string,
  indexCourant: number,
  nombreLignes: number,
): ActionGrille | null {
  if (nombreLignes <= 0) return null;

  // `Entree` et `Espace` restent la selection : c'est le geste deja appris par
  // l'utilisateur, il ne doit pas changer parce qu'on ajoute les fleches.
  if (touche === 'Enter' || touche === ' ') return { type: 'selectionner' };

  const dernierIndex = nombreLignes - 1;
  const vise = indexVise(touche, indexCourant, dernierIndex);
  if (vise === null) return null;

  const borne = Math.min(Math.max(vise, 0), dernierIndex);
  return borne === indexCourant ? null : { type: 'deplacer', index: borne };
}

/**
 * Rangee sur laquelle REPOSER le focus quand celle qui le portait vient de
 * quitter la liste (filtre saisi, ligne traitee qui sort de « a commander »,
 * rechargement de fond). `null` = il ne reste aucune rangee.
 *
 * ═══ Pourquoi ce n'est pas une question cosmetique ═══
 *
 * Le patron `grid` de l'APG l'impose : si l'element focalise est retire, le
 * focus doit etre replace dans la grille. Sans cela le navigateur le rend au
 * `<body>`, d'ou les fleches ne font plus rien et ou la tabulation suivante
 * repart du TOUT DEBUT du document — les treize tabulations que le lien
 * d'evitement de `Navigation.tsx` existe pour eviter. C'est l'instant precis ou
 * l'utilisateur reprend la souris, ce que CLAUDE.md §3 regle 10 interdit.
 *
 * ═══ La regle choisie : la SURVIVANTE LA PLUS PROCHE, l'aval d'abord ═══
 *
 * On balaie l'ancienne liste en s'ecartant de la position disparue, d'un cran
 * a la fois, en regardant l'AVAL avant l'AMONT. Trois raisons, dans cet ordre :
 *
 *  1. c'est la seule regle qui serve les DEUX gestes reels. Quand une ligne
 *     sort de la liste parce qu'on vient de la traiter, l'aval immediat est la
 *     ligne SUIVANTE a traiter : la file d'attente avance toute seule, sans
 *     souris. Quand un filtre ampute la liste au milieu, la survivante la plus
 *     proche est celle que l'oeil cherchait deja ;
 *  2. elle est stable sous reordonnancement : elle raisonne sur des CLES et non
 *     sur des index — un tri qui change l'ordre ne teleporte pas le focus
 *     (meme raison que `resoudreIndexActif` ci-dessous) ;
 *  3. elle prolonge D-079, qui a deja tranche ce cas pour deux ecrans : « le
 *     focus va sur l'echeance suivante encore actionnable » et « sur la ligne
 *     qui prend visuellement sa place ».
 *
 * ═══ Ce qu'on a ECARTE, et ce que ca aurait coute ═══
 *
 *  - **La premiere rangee.** C'est le repli deja tenu par `resoudreIndexActif`
 *    pour le `tabIndex`, et il aurait ete tentant de s'aligner dessus. Mais un
 *    `tabIndex` mal place ne se paie qu'a la tabulation SUIVANTE, alors qu'un
 *    focus mal place se paie tout de suite : apres avoir traite la 30e ligne
 *    d'une liste de 40, on se retrouve en haut. Sur une saisie repetitive,
 *    c'est le meme abandon que le `<body>`, en moins visible.
 *  - **La meme POSITION dans la nouvelle liste** (index conserve, borne a la
 *    fin). Correct pour une suppression, absurde pour un filtre : l'index 5 de
 *    la liste filtree designe une ligne sans aucun rapport avec celle qu'on
 *    regardait. On aurait deplace le focus vers un endroit arbitraire — pire
 *    que de ne rien faire pour qui ne voit pas l'ecran, puisque le lecteur
 *    annonce alors une ligne dont rien n'explique la venue.
 *  - **Le conteneur du tableau** (un `<div tabindex="-1">`). C'est le choix le
 *    plus prudent : il ne PRETEND pas choisir une ligne a la place de
 *    l'utilisateur, et un lecteur d'ecran annonce le tableau plutot qu'une
 *    rangee jamais demandee. On l'a ecarte parce qu'il ne repare qu'a moitie :
 *    le gestionnaire de touches vit sur les rangees, donc depuis le conteneur
 *    les fleches restent inertes et il faut retabuler pour rentrer. Il aurait
 *    sauve la tabulation, pas la navigation.
 *
 * ═══ Ce que la regle retenue coute, et a qui ═══
 *
 * A quelqu'un qui ne voit pas l'ecran, le focus se deplace vers une rangee
 * qu'il n'a pas demandee, et son lecteur d'ecran l'annonce sans dire pourquoi.
 * C'est le prix assume : le patron `grid` de l'APG prescrit ce deplacement
 * parce que l'alternative — le `<body>` — est muette ET immobile. Un focus qui
 * bouge est au moins annonce.
 */
export function choisirRangeeDeRepli(
  clesAvant: readonly string[],
  clesApres: readonly string[],
  cleDisparue: string,
): string | null {
  if (clesApres.length === 0) return null;

  const survivantes = new Set(clesApres);
  const depart = clesAvant.indexOf(cleDisparue);
  // Position inconnue (premier rendu, remplacement integral de la liste) : on
  // n'a aucun voisinage a exploiter, la premiere rangee est alors le seul repli
  // qui ne soit pas arbitraire.
  if (depart === -1) return clesApres[0] ?? null;

  for (let ecart = 1; ecart <= clesAvant.length; ecart++) {
    const aval = clesAvant[depart + ecart];
    if (aval !== undefined && survivantes.has(aval)) return aval;
    const amont = clesAvant[depart - ecart];
    if (amont !== undefined && survivantes.has(amont)) return amont;
  }

  // Aucune ancienne cle ne survit : la liste a ete entierement remplacee.
  return clesApres[0] ?? null;
}

/**
 * Index de la rangee qui porte `tabIndex={0}` — la seule de la grille a etre
 * dans l'ordre de tabulation (« roving tabindex »).
 *
 * On memorise la CLE de la rangee active et non son index : un filtre ou un tri
 * reordonne `lignes`, et un index memorise designerait alors une autre ligne.
 * Ordre de repli : rangee active memorisee -> rangee selectionnee par l'ecran
 * -> premiere rangee.
 */
export function resoudreIndexActif(
  clesLignes: readonly string[],
  cleActive: string | null,
  cleSelectionnee: string | undefined,
): number {
  if (cleActive !== null) {
    const index = clesLignes.indexOf(cleActive);
    if (index !== -1) return index;
  }
  if (cleSelectionnee !== undefined) {
    const index = clesLignes.indexOf(cleSelectionnee);
    if (index !== -1) return index;
  }
  return 0;
}
