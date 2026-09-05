import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import {
  choisirRangeeDeRepli,
  interpreterToucheGrille,
  resoudreIndexActif,
} from './navigationGrille';

/**
 * Alignement d'une colonne (docs/07-DOCTRINE-ERP-ET-DESIGN.md §4.5) :
 *  - `nombre` couvre les grandeurs quantitatives (montants, quantites,
 *    pourcentages) — alignees a droite, sans exception ;
 *  - `texte` couvre le texte ET les identifiants qualitatifs (dates, numeros
 *    de lot) : ce sont des identifiants, pas des grandeurs, ils restent a
 *    gauche.
 */
export type AlignementColonne = 'texte' | 'nombre';

/**
 * Que fait la colonne quand la valeur depasse la largeur allouee.
 *
 * - `ellipse` (defaut) : coupe par la fin avec « … ». Le rythme de rangee reste
 *   strictement uniforme a 32 px. Reservee aux colonnes dont la FIN n'est pas
 *   distinctive : un libelle courant, une categorie, une date.
 * - `repli` : la valeur n'est jamais coupee, elle passe a la ligne. La rangee
 *   grandit — mais seulement celles qui debordent reellement.
 *
 * Le choix se fait colonne par colonne parce que la question n'est pas
 * esthetique mais metier : couper `Crêpe froment (revente)` apres `Crêpe from…`
 * detruit la seule chose qui distingue un produit transforme de son homonyme
 * revendu, et cette confusion fausse les compteurs de seuils legaux (marge 90 %
 * contre 30 %, docs/07 §6.7). Couper un numero de lot AFSCA detruit le champ
 * qui sert a rappeler une marchandise.
 *
 * `title` ne peut pas servir de recours a ces cas : l'infobulle native n'est
 * pas exposee au clavier, et CLAUDE.md §3 regle 10 impose que chaque ecran soit
 * utilisable au clavier. Un recours qui n'existe qu'a la souris n'en est pas un.
 */
export type TroncatureColonne = 'ellipse' | 'repli';

export type ColonneTableau<Ligne> = {
  /** Cle stable : sert de cle React et de cle du <colgroup>. */
  cle: string;
  libelle: string;
  /**
   * Libelle LONG affiche en infobulle sur l'EN-TETE de la colonne — jamais
   * a la place de `libelle`, qui reste seul affiche dans le `<th>`.
   *
   * Facultatif, absent par defaut : sans lui, l'infobulle de l'en-tete
   * reprend `libelle` tel quel, exactement comme avant l'introduction de ce
   * champ. Il n'a d'utilite que si `libelle` est une ABREVIATION CHOISIE
   * (docs/07-DOCTRINE-ERP-ET-DESIGN.md §4.5 : une abreviation choisie bat
   * une troncature CSS qui depend de la largeur du navigateur) : l'en-tete
   * affiche alors le mot court, l'infobulle nomme le mot entier — sans quoi
   * survoler un en-tete abrege ne faisait que reafficher sa propre
   * abreviation, et le mot entier ne remontait plus nulle part.
   *
   * Ne remplace pas `titre` ci-dessous (l'infobulle PAR CELLULE, qui dit la
   * VALEUR entiere) : les deux informations sont distinctes — l'en-tete dit
   * ce que CONTIENT la colonne, la cellule dit la VALEUR — et les deux
   * infobulles coexistent.
   */
  libelleLong?: string;
  /**
   * Largeur EXPLICITE (px ou %), jamais `auto`. Avec `table-layout: fixed`,
   * un <colgroup> sans largeur chiffree laisse les colonnes se deplacer au
   * moindre changement de contenu — fatal a une saisie au clavier, ou la
   * cible bouge sous les doigts (docs/07 §4.5).
   */
  largeur: string;
  alignement: AlignementColonne;
  rendu: (ligne: Ligne) => ReactNode;
  /**
   * Facultatif, defaut `ellipse` — voir `TroncatureColonne`. Facultatif par
   * necessite : ce composant a 24 instances vivantes, l'API ne peut evoluer que
   * par ajout.
   */
  troncature?: TroncatureColonne;
  /**
   * Texte complet, affiche en infobulle native.
   *
   * Confort a la souris UNIQUEMENT. Ce n'est pas ce qui rend une valeur
   * accessible : pour cela, c'est `troncature: 'repli'` qu'il faut poser.
   * L'infobulle doit toujours COMMENCER par le texte reellement rendu dans la
   * cellule — une infobulle qui repond a cote est pire que pas d'infobulle.
   */
  titre?: (ligne: Ligne) => string;
};

type TableauProps<Ligne> = {
  colonnes: ReadonlyArray<ColonneTableau<Ligne>>;
  lignes: readonly Ligne[];
  cleLigne: (ligne: Ligne) => string;
  /**
   * Total non filtre. A fournir seulement quand un filtre reduit `lignes`
   * en dessous de ce total : affiche alors « 12 sur 34 » (docs/07 §4.5,
   * « toujours afficher le compte »). Omis quand l'ecran ne filtre rien —
   * le compte brut a alors sa place dans le titre du `Panneau` englobant.
   */
  total?: number;
  /** Nom pluriel affiche apres le compte, ex. « ingrédients ». */
  libelleEntite?: string;
  /**
   * Contenu affiche a la place des rangees quand `lignes` est vide.
   * Toujours a la charge de l'appelant : docs/07 §4.7 impose trois etats
   * vides distincts (et un quatrieme, `lot-a-venir`), jamais un texte
   * generique unique — voir `EtatVide`.
   */
  etatVide: ReactNode;
  /**
   * Cle de la ligne courante, quand le tableau sert a EN CHOISIR une (ex. la
   * liste des recettes de l'ecran Recettes). Pilote `aria-selected`, deja
   * stylee par `index.css` (`tbody tr[aria-selected='true']`).
   */
  ligneSelectionneeCle?: string;
  /**
   * Rend chaque rangee selectionnable au clic ET au clavier, sans exiger la
   * souris (CLAUDE.md §3 regle 10). Absent par defaut : un tableau de simple
   * consultation (ex. `Parametres`) reste non interactif tel quel.
   */
  onSelectionnerLigne?: (ligne: Ligne) => void;
};

/**
 * Tableau generique dont derivent tous les ecrans de liste (docs/07 §4.5,
 * « tableaux — le coeur de l'ERP »). Volontairement sans tri ni filtre : on
 * les ajoutera quand un ecran en aura reellement besoin, pas avant.
 *
 * L'en-tete collant est deja gere par la couche `base` de `index.css`
 * (`thead th { position: sticky }` avec `border-collapse: separate`) : ne
 * pas la reimplementer ici.
 */
export function Tableau<Ligne>({
  colonnes,
  lignes,
  cleLigne,
  total,
  libelleEntite,
  etatVide,
  ligneSelectionneeCle,
  onSelectionnerLigne,
}: TableauProps<Ligne>) {
  // « Roving tabindex » : une seule rangee est dans l'ordre de tabulation, les
  // autres sont a -1. Sans cela, un tableau de 40 lignes coute 40 tabulations
  // pour atteindre ce qui le suit — precisement le geste repetitif que la regle
  // 10 de CLAUDE.md existe pour eviter.
  const [cleActive, definirCleActive] = useState<string | null>(null);
  // Les noeuds <tr> sont indexes par cle : le motif `grid` deplace le focus
  // PROGRAMMATIQUEMENT, il faut donc pouvoir joindre une rangee sans passer par
  // le DOM global. Pas de virtualisation ici, tous les noeuds existent.
  const rangees = useRef(new Map<string, HTMLTableRowElement>());
  /** Rangee de l'etat vide — seule cible possible quand la liste se vide. */
  const rangeeEtatVide = useRef<HTMLTableRowElement | null>(null);
  /**
   * Cle de la rangee qui porte REELLEMENT le focus du navigateur, tenue par
   * `onFocus`. C'est la seule facon de savoir, apres coup, quelle rangee vient
   * d'etre arrachee sous les doigts : une fois le noeud retire du DOM, il n'y a
   * plus rien a interroger.
   */
  const cleFocalisee = useRef<string | null>(null);
  /** Cles du rendu PRECEDENT : le voisinage de la rangee disparue n'existe plus dans le rendu courant. */
  const clesPrecedentes = useRef<readonly string[]>([]);

  const clesLignes = lignes.map(cleLigne);
  const indexActif = resoudreIndexActif(clesLignes, cleActive, ligneSelectionneeCle);

  const deplacerVers = (index: number) => {
    const cible = clesLignes[index];
    if (cible === undefined) return;
    definirCleActive(cible);
    rangees.current.get(cible)?.focus();
  };

  /**
   * Rattrape le focus quand la rangee qui le portait a quitte la liste.
   *
   * Dependance `[clesLignes]` — honnete, et sans effet reducteur : la plupart
   * des ecrans recalculent `lignes` a chaque rendu, la reference change donc a
   * chaque fois et l'effet s'execute apres chaque rendu. C'est voulu : la
   * disparition d'une rangee n'est signalee par aucune autre valeur (ni
   * `cleActive`, qui ne bouge pas quand c'est le PARENT qui filtre). Les sorties
   * anticipees ci-dessous ne coutent qu'un `includes` sur un tableau de la
   * taille d'un ecran.
   *
   * Pas de boucle possible, et c'est ce que la regle `exhaustive-deps` craint
   * ici : le seul `definirCleActive` de l'effet est suivi de l'ecriture de
   * `cleFocalisee.current = cible`. Au rendu suivant, `clesLignes.includes(cible)`
   * est vrai et l'effet sort a la deuxieme ligne. Un rendu de plus, jamais deux.
   *
   * ═══ LE GARDE-FOU QUI COMPTE : ne jamais VOLER le focus ═══
   *
   * Le declencheur le plus frequent de ce cas est une frappe dans un champ de
   * recherche place au-dessus de la liste. Le focus est alors dans le CHAMP, pas
   * sur la rangee : la rangee disparait sans que personne ne perde rien, et
   * ramener le focus dans la grille arracherait l'utilisateur a sa saisie a
   * chaque lettre tapee — un defaut bien pire que celui qu'on repare.
   *
   * D'ou la condition : on ne rattrape que si le navigateur a lui-meme laisse
   * tomber le focus sur le `<body>` (ou l'element racine). Des qu'un element
   * reel le detient, on ne touche a rien.
   */
  useEffect(() => {
    const clesAvant = clesPrecedentes.current;
    clesPrecedentes.current = clesLignes;

    const disparue = cleFocalisee.current;
    if (disparue === null || clesLignes.includes(disparue)) return;

    const actif = document.activeElement;
    if (actif !== null && actif !== document.body && actif !== document.documentElement) {
      // Le focus est ailleurs, et volontairement : on oublie la rangee suivie
      // plutot que de revenir la reclamer au prochain filtrage.
      cleFocalisee.current = null;
      return;
    }

    const cible = choisirRangeeDeRepli(clesAvant, clesLignes, disparue);
    if (cible === null) {
      // Liste devenue VIDE. Il n'y a plus de rangee de donnees a viser, et
      // laisser le focus sur `<body>` serait exactement le defaut d'origine. On
      // vise donc la rangee de l'etat vide, qui n'est pas un pis-aller : c'est
      // le seul noeud de la grille qui PORTE l'explication (docs/07 §4.7 impose
      // un etat vide qui dit pourquoi la liste est vide et quoi faire ensuite).
      // Un lecteur d'ecran annonce donc la phrase utile, et la tabulation
      // suivante repart d'ici — pas du haut du document. `tabIndex={-1}` :
      // atteignable programmatiquement, jamais dans l'ordre de tabulation.
      cleFocalisee.current = null;
      rangeeEtatVide.current?.focus();
      return;
    }

    // Ecrit AVANT le `.focus()` : si la rangee visee n'etait pas dans la carte
    // des noeuds, l'effet du rendu suivant ne reessaierait pas indefiniment.
    cleFocalisee.current = cible;
    definirCleActive(cible);
    rangees.current.get(cible)?.focus();
  }, [clesLignes]);

  return (
    <div>
      {total !== undefined && (
        <p className="border-b border-line px-4 py-1 text-xs text-ink-3">
          {lignes.length} sur {total}
          {libelleEntite !== undefined ? ` ${libelleEntite}` : ''}
        </p>
      )}
      {/* `role="grid"` UNIQUEMENT quand les rangees sont selectionnables.
          `aria-selected` n'est valide que sur une rangee de `grid` ou de
          `treegrid` : pose sur un `<table>` ordinaire, il est purement et
          simplement ignore par NVDA, JAWS et VoiceOver. L'utilisateur au
          clavier voyait donc la rangee active surlignee a l'ecran sans que rien
          ne l'annonce — l'etat n'existait que pour les voyants. Un tableau de
          consultation pure reste un `table`, qui se lit mieux. */}
      <table {...(onSelectionnerLigne ? { role: 'grid' as const } : {})}>
        <colgroup>
          {colonnes.map((colonne) => (
            <col key={colonne.cle} style={{ width: colonne.largeur }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {colonnes.map((colonne) => (
              <th
                key={colonne.cle}
                scope="col"
                // `index.css` coupe un intitule trop long par une ellipse
                // (il debordait sur la colonne voisine). Sans `libelleLong`,
                // l'infobulle reprend `libelle` tel quel — c'est le seul cas
                // ou un en-tete etait coupe sans aucun recours. Quand
                // `libelle` est lui-meme une ABREVIATION CHOISIE (« Écoul. »),
                // `libelleLong` porte le mot entier : survoler l'en-tete ne
                // doit pas se contenter de reafficher l'abreviation.
                title={colonne.libelleLong ?? colonne.libelle}
                className={colonne.alignement === 'nombre' ? 'num' : undefined}
              >
                {colonne.libelle}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.length === 0 ? (
            // `tabIndex={-1}` seulement sur une grille INTERACTIVE : un tableau
            // de consultation pure (`Parametres`) n'a jamais eu de focus a
            // rattraper, et ne doit gagner aucun attribut de focalisation.
            <tr {...(onSelectionnerLigne ? { ref: rangeeEtatVide, tabIndex: -1 } : {})}>
              <td colSpan={colonnes.length}>{etatVide}</td>
            </tr>
          ) : (
            lignes.map((ligne, index) => {
              const cle = clesLignes[index] ?? cleLigne(ligne);
              // Props d'interaction ajoutees SEULEMENT si l'appelant fournit
              // `onSelectionnerLigne` : un tableau de consultation pure (ex.
              // Parametres) ne devient jamais accidentellement cliquable.
              const proprietesSelection = onSelectionnerLigne
                ? {
                    ref: (element: HTMLTableRowElement | null) => {
                      if (element === null) rangees.current.delete(cle);
                      else rangees.current.set(cle, element);
                    },
                    tabIndex: index === indexActif ? 0 : -1,
                    'aria-selected': cle === ligneSelectionneeCle,
                    // Note la rangee qui detient le focus, sans TOUCHER a
                    // `cleActive` : le point d'entree de tabulation reste pilote
                    // par la navigation (fleches, clic) et par
                    // `ligneSelectionneeCle`. Le seul role de cette `ref` est de
                    // savoir, apres la disparition du noeud, qui l'avait.
                    onFocus: () => {
                      cleFocalisee.current = cle;
                    },
                    onClick: () => {
                      // Le clic deplace aussi le point d'entree clavier : apres
                      // un clic, `Tab` doit repartir d'ou l'oeil se trouve.
                      definirCleActive(cle);
                      onSelectionnerLigne(ligne);
                    },
                    onKeyDown: (evenement: KeyboardEvent<HTMLTableRowElement>) => {
                      // L'evenement part de la rangee qui a le focus : `index`
                      // EST l'index courant, sans lecture d'etat differee.
                      const action = interpreterToucheGrille(evenement.key, index, lignes.length);
                      if (action === null) return;
                      evenement.preventDefault();
                      if (action.type === 'selectionner') onSelectionnerLigne(ligne);
                      else deplacerVers(action.index);
                    },
                    className: 'cursor-pointer',
                  }
                : {};
              return (
                <tr key={cle} {...proprietesSelection}>
                  {colonnes.map((colonne) => {
                    const repli = colonne.troncature === 'repli';
                    const titre = colonne.titre?.(ligne);
                    // `truncate` reste le DEFAUT : c'est ce qui garantit un
                    // rythme de rangee uniforme a 32 px, et la hauteur est la
                    // ressource rare (docs/07 §4.4, ~16 rangees visibles). Mais
                    // ce n'est plus une fatalite globale : une colonne dont la
                    // fin porte le sens declare `troncature: 'repli'`.
                    const classes = [
                      repli ? null : 'truncate',
                      colonne.alignement === 'nombre' ? 'num' : null,
                    ].filter((classe) => classe !== null);
                    return (
                      <td
                        key={colonne.cle}
                        className={classes.join(' ')}
                        // Le style du repli vit dans `index.css` : il lui faut
                        // `overflow-wrap: anywhere`, qu'aucun jeton n'expose.
                        {...(repli ? { 'data-troncature': 'repli' } : {})}
                        {...(titre === undefined ? {} : { title: titre })}
                      >
                        {colonne.rendu(ligne)}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
