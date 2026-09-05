import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tableau, type ColonneTableau } from './Tableau';
import {
  PAS_PAGE_GRILLE,
  choisirRangeeDeRepli,
  interpreterToucheGrille,
  resoudreIndexActif,
} from './navigationGrille';

/**
 * Ce fichier ne MONTE pas le composant. Il teste par deux moyens qui se
 * passent de DOM :
 *
 *  - `renderToStaticMarkup` (deja fourni par `react-dom`, fonctionne en Node pur)
 *    pour tout ce qui est STRUCTUREL : ordre de tabulation, classes, attributs ;
 *  - les fonctions pures de `navigationGrille.ts` pour tout ce qui est
 *    COMPORTEMENTAL : quelle touche mene ou.
 *
 * Ce que ce dispositif ne peut PAS prouver : que le focus se deplace reellement
 * (`element.focus()`), ni quoi que ce soit qui demande un second rendu —
 * `renderToStaticMarkup` rend UNE fois, dans l'etat initial. C'est le role de
 * `Tableau.montage.test.tsx`, a cote de ce fichier, qui monte pour de vrai.
 * Le VISUEL (anneau de focus, contraste) reste hors de portee des deux : jsdom
 * n'applique aucune feuille de style, il se verifie au navigateur.
 */

type LigneTest = { id: string; nom: string; lot: string };

const LIGNES: readonly LigneTest[] = [
  { id: 'a', nom: 'Crêpe froment', lot: 'LOT-2026-0731-A' },
  { id: 'b', nom: 'Crêpe froment (revente)', lot: 'LOT-2026-0731-B' },
  { id: 'c', nom: 'Sirop de Liège', lot: 'LOT-2026-0731-C' },
];

const COLONNES: ReadonlyArray<ColonneTableau<LigneTest>> = [
  { cle: 'nom', libelle: 'Produit', largeur: '60%', alignement: 'texte', rendu: (l) => l.nom },
  {
    cle: 'lot',
    libelle: 'N° lot fournisseur',
    largeur: '40%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) => l.lot,
  },
];

function rendre(proprietes: { selectionnable: boolean; selectionnee?: string }): string {
  return renderToStaticMarkup(
    <Tableau
      colonnes={COLONNES}
      lignes={LIGNES}
      cleLigne={(l) => l.id}
      etatVide={<p>Aucune ligne.</p>}
      {...(proprietes.selectionnee === undefined
        ? {}
        : { ligneSelectionneeCle: proprietes.selectionnee })}
      {...(proprietes.selectionnable ? { onSelectionnerLigne: () => {} } : {})}
    />,
  );
}

/** Compte les occurrences d'un motif dans le balisage rendu. */
function compter(balisage: string, motif: RegExp): number {
  return balisage.match(motif)?.length ?? 0;
}

describe('Tableau — ordre de tabulation (roving tabindex)', () => {
  it('ne place qu une seule rangee dans l ordre de tabulation', () => {
    // Le defaut corrige : chaque <tr> portait tabIndex=0, donc atteindre ce qui
    // suit un tableau de 40 lignes demandait 40 tabulations.
    const balisage = rendre({ selectionnable: true });
    expect(compter(balisage, /tabindex="0"/g)).toBe(1);
    expect(compter(balisage, /tabindex="-1"/g)).toBe(LIGNES.length - 1);
  });

  it('place le point d entree sur la rangee selectionnee, pas sur la premiere', () => {
    const balisage = rendre({ selectionnable: true, selectionnee: 'c' });
    const rangees = balisage.split('<tr');
    // rangees[0] = avant le <thead>, [1] = en-tete, [2..4] = les trois lignes.
    expect(rangees[2]).toContain('tabindex="-1"');
    expect(rangees[4]).toContain('tabindex="0"');
    expect(rangees[4]).toContain('aria-selected="true"');
  });

  it('n ajoute aucun tabindex ni role=grid sur un tableau de consultation', () => {
    // Regression a surveiller : `Parametres` et les journaux ne doivent pas
    // devenir accidentellement focalisables.
    const balisage = rendre({ selectionnable: false });
    expect(balisage).not.toContain('tabindex');
    expect(balisage).not.toContain('role="grid"');
  });
});

describe('interpreterToucheGrille — deplacements', () => {
  it('descend et remonte d une rangee', () => {
    expect(interpreterToucheGrille('ArrowDown', 0, 3)).toEqual({ type: 'deplacer', index: 1 });
    expect(interpreterToucheGrille('ArrowUp', 2, 3)).toEqual({ type: 'deplacer', index: 1 });
  });

  it('ne boucle pas : fleche Bas sur la derniere rangee ne fait rien', () => {
    // Comportement choisi et documente : pas de bouclage. Un retour silencieux
    // en haut d une liste de 40 lignes desoriente ; `null` laisse en plus le
    // defilement natif reprendre la main, donc l utilisateur SENT la butee.
    expect(interpreterToucheGrille('ArrowDown', 2, 3)).toBeNull();
    expect(interpreterToucheGrille('ArrowUp', 0, 3)).toBeNull();
  });

  it('va a la premiere et a la derniere rangee avec Home et End', () => {
    expect(interpreterToucheGrille('Home', 2, 3)).toEqual({ type: 'deplacer', index: 0 });
    expect(interpreterToucheGrille('End', 0, 3)).toEqual({ type: 'deplacer', index: 2 });
    // Deja a destination : aucune action, donc aucun preventDefault.
    expect(interpreterToucheGrille('Home', 0, 3)).toBeNull();
    expect(interpreterToucheGrille('End', 2, 3)).toBeNull();
  });

  it('saute de dix rangees avec PageUp / PageDown, en restant borne', () => {
    expect(interpreterToucheGrille('PageDown', 0, 40)).toEqual({
      type: 'deplacer',
      index: PAS_PAGE_GRILLE,
    });
    expect(interpreterToucheGrille('PageDown', 35, 40)).toEqual({ type: 'deplacer', index: 39 });
    expect(interpreterToucheGrille('PageUp', 4, 40)).toEqual({ type: 'deplacer', index: 0 });
  });

  it('selectionne avec Entree et Espace', () => {
    expect(interpreterToucheGrille('Enter', 1, 3)).toEqual({ type: 'selectionner' });
    expect(interpreterToucheGrille(' ', 1, 3)).toEqual({ type: 'selectionner' });
  });

  it('ignore toute autre touche et une grille vide', () => {
    expect(interpreterToucheGrille('a', 0, 3)).toBeNull();
    expect(interpreterToucheGrille('Tab', 0, 3)).toBeNull();
    expect(interpreterToucheGrille('Escape', 0, 3)).toBeNull();
    // `Tab` doit SORTIR de la grille (docs/07 §4.6) : ne jamais le capturer.
    expect(interpreterToucheGrille('ArrowDown', 0, 0)).toBeNull();
    expect(interpreterToucheGrille('Enter', 0, 0)).toBeNull();
  });

  it('ramene un index devenu hors bornes apres un filtrage', () => {
    // La liste a retreci sous les pieds de l utilisateur : on ne doit pas viser
    // une rangee qui n existe plus.
    expect(interpreterToucheGrille('ArrowDown', 12, 3)).toEqual({ type: 'deplacer', index: 2 });
  });
});

describe('resoudreIndexActif', () => {
  const cles = ['a', 'b', 'c'];

  it('suit la cle memorisee plutot que la position', () => {
    expect(resoudreIndexActif(cles, 'c', undefined)).toBe(2);
    // Apres reordonnancement, la meme cle suit sa ligne.
    expect(resoudreIndexActif(['c', 'a', 'b'], 'c', undefined)).toBe(0);
  });

  it('se replie sur la ligne selectionnee, puis sur la premiere', () => {
    expect(resoudreIndexActif(cles, null, 'b')).toBe(1);
    expect(resoudreIndexActif(cles, null, undefined)).toBe(0);
    // Cle disparue apres filtrage : on ne laisse jamais la grille sans point
    // d entree, sinon plus aucune rangee n est atteignable au clavier.
    expect(resoudreIndexActif(cles, 'zzz', undefined)).toBe(0);
    expect(resoudreIndexActif(cles, 'zzz', 'b')).toBe(1);
  });
});

describe('Tableau — troncature', () => {
  it('tronque par defaut mais jamais une colonne declaree `repli`', () => {
    const balisage = rendre({ selectionnable: true });
    // Trois lignes : la colonne « Produit » tronque, la colonne « N° lot » non.
    expect(compter(balisage, /class="truncate"/g)).toBe(LIGNES.length);
    expect(compter(balisage, /data-troncature="repli"/g)).toBe(LIGNES.length);
    // La valeur complete est bien dans le document, pas seulement en infobulle.
    expect(balisage).toContain('LOT-2026-0731-B');
    expect(balisage).toContain('Crêpe froment (revente)');
  });

  it('expose l intitule de chaque colonne en infobulle', () => {
    // `index.css` coupe desormais un en-tete trop long : il lui faut un recours.
    const balisage = rendre({ selectionnable: false });
    expect(balisage).toContain('title="N° lot fournisseur"');
  });

  it('n emet un `title` de cellule que si la colonne en fournit un', () => {
    const avecTitre: ReadonlyArray<ColonneTableau<LigneTest>> = [
      { ...COLONNES[0]!, titre: (l) => l.nom },
    ];
    const balisage = renderToStaticMarkup(
      <Tableau
        colonnes={avecTitre}
        lignes={LIGNES}
        cleLigne={(l) => l.id}
        etatVide={<p>Vide.</p>}
      />,
    );
    expect(balisage).toContain('title="Crêpe froment (revente)"');
  });
});

/**
 * `libelleLong` (mission du 31/07/2026, en-tête abrégé « Écoul. » qui ne
 * pouvait pas dire son mot entier — `title={colonne.libelle}` réaffichait
 * l'abréviation elle-même au survol de l'en-tête). Champ purement additif :
 * le premier test ci-dessous est celui qui prouve qu'une colonne qui ne le
 * fournit pas garde EXACTEMENT le comportement d'avant — c'est le test le
 * plus important de cette mission, il doit rester vert quels que soient les
 * changements de largeur des trois autres agents qui touchent ce fichier au
 * même moment.
 */
describe('Tableau — infobulle de l entete (`libelleLong`)', () => {
  it('sans `libelleLong` : l infobulle de l en-tete reste `libelle`, a l identique d avant ce champ', () => {
    // Meme colonne « N° lot fournisseur » que le test de troncature ci-dessus,
    // qui ne pose jamais `libelleLong` : aucune regression visuelle possible.
    const balisage = rendre({ selectionnable: false });
    expect(balisage).toContain('title="N° lot fournisseur"');
    // Et l intitule affiche ne bouge pas non plus.
    expect(balisage).toContain('>N° lot fournisseur<');
  });

  it('avec `libelleLong` : l infobulle de l en-tete nomme le mot entier, l intitule affiche ne change pas', () => {
    const colonneAbregee: ReadonlyArray<ColonneTableau<LigneTest>> = [
      { ...COLONNES[0]!, libelle: 'Écoul.', libelleLong: "Taux d'écoulement (vendu / produit)" },
      COLONNES[1]!,
    ];
    const balisage = renderToStaticMarkup(
      <Tableau
        colonnes={colonneAbregee}
        lignes={LIGNES}
        cleLigne={(l) => l.id}
        etatVide={<p>Vide.</p>}
      />,
    );
    // L en-tete AFFICHE l abreviation courte, pas le mot long.
    expect(balisage).toContain('>Écoul.<');
    expect(balisage).not.toContain('>Taux d');
    // Mais son infobulle nomme le mot entier — jamais sa propre abreviation.
    // `renderToStaticMarkup` echappe l apostrophe en entite HTML (`&#x27;`)
    // dans un attribut : ce n est pas ce que le navigateur affiche au survol
    // (il decode l entite), mais c est ce que produit REELLEMENT ce moteur de
    // rendu, donc ce que ce test peut verifier.
    expect(balisage).toContain('title="Taux d&#x27;écoulement (vendu / produit)"');
    expect(balisage).not.toContain('title="Écoul."');
  });
});

/**
 * `choisirRangeeDeRepli` — la DECISION seule, sans DOM.
 *
 * Le fil entre cette decision et le focus reel est prouve par
 * `Tableau.montage.test.tsx` (`document.activeElement` apres un `rerender`).
 * Ici on couvre les cas de bord qu'un montage rendrait couteux a exprimer :
 * liste reordonnee, remplacement integral, cle inconnue.
 */
describe('choisirRangeeDeRepli — ou reposer le focus quand la rangee focalisee disparait', () => {
  const AVANT = ['a', 'b', 'c', 'd', 'e'];

  it('prend l AVAL immediat : la ligne qu on vient de traiter cede la place a la SUIVANTE', () => {
    expect(choisirRangeeDeRepli(AVANT, ['a', 'b', 'd', 'e'], 'c')).toBe('d');
  });

  it('se rabat sur l AMONT quand tout l aval a disparu — jamais sur la premiere par defaut', () => {
    // Un repli « premiere rangee » rendrait 'a' ici ; la survivante la plus
    // proche de 'd' est 'b'. C est ce qui distingue les deux regles.
    expect(choisirRangeeDeRepli(AVANT, ['a', 'b'], 'd')).toBe('b');
  });

  it('prefere l aval a l amont a distance EGALE', () => {
    // 'b' et 'd' sont tous deux a une case de 'c' : la file d attente avance.
    expect(choisirRangeeDeRepli(AVANT, ['b', 'd'], 'c')).toBe('d');
  });

  it('raisonne sur les CLES, donc un simple reordonnancement ne teleporte rien', () => {
    // Meme jeu de lignes, trie a l envers, sans 'c'. Un repli par INDEX
    // conserve rendrait 'b' (position 2 de la nouvelle liste) ; la survivante
    // la plus proche de 'c' reste 'd'.
    expect(choisirRangeeDeRepli(AVANT, ['e', 'd', 'b', 'a'], 'c')).toBe('d');
  });

  it('rend `null` quand la liste devient vide — le seul cas ou aucune rangee ne convient', () => {
    expect(choisirRangeeDeRepli(AVANT, [], 'c')).toBeNull();
  });

  it('se replie sur la premiere quand PLUS AUCUNE ancienne cle ne survit', () => {
    expect(choisirRangeeDeRepli(AVANT, ['x', 'y'], 'c')).toBe('x');
  });

  it('se replie sur la premiere quand la cle disparue n etait meme pas dans l ancienne liste', () => {
    // Cas d un premier rendu ou d un remplacement integral : aucun voisinage
    // exploitable, donc aucun choix « proche » n aurait de sens.
    expect(choisirRangeeDeRepli(AVANT, ['a', 'b'], 'inconnue')).toBe('a');
  });
});
