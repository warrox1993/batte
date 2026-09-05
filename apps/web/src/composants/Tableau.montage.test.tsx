/**
 * `Tableau` MONTÉ — la règle n°10 de CLAUDE.md, prouvée pour les trente écrans.
 *
 * ═══ Ce que ce fichier ajoute, et pourquoi il en fallait un ═══
 *
 * `Tableau.test.tsx`, à côté, reste valable et n'est pas touché : il prouve le
 * BALISAGE (combien de `tabindex="0"`, quelles classes, quel `title`) par
 * `renderToStaticMarkup`, et la DÉCISION (« quelle touche mène où ») par les
 * fonctions pures de `navigationGrille.ts`. Les deux moitiés étaient justes.
 *
 * Ce qu'aucune des deux ne pouvait voir, et que son propre en-tête admettait
 * (« ce que ce dispositif ne peut PAS prouver : que le focus se déplace
 * réellement ») : **le fil entre les deux**. Rien ne prouvait que
 * `interpreterToucheGrille` était seulement APPELÉE par le composant, ni que
 * son verdict était suivi d'un `element.focus()` qui aboutit. Un `onKeyDown`
 * supprimé par mégarde laissait les deux fichiers entièrement verts.
 *
 * C'est pour ça que ce fichier interroge `document.activeElement` et jamais
 * une chaîne de balisage : le focus RÉEL est la seule chose qui décide si la
 * saisie du dimanche soir se fait à la main ou à la souris.
 *
 * ═══ Pourquoi douze lignes, et pas trois ═══
 *
 * Une fixture d'une seule ligne ne prouve rien sur une navigation par flèches :
 * tout y est à la fois le premier, le dernier et le courant, donc `Home`, `End`,
 * `ArrowUp` et `ArrowDown` y sont indiscernables — et un composant qui
 * sélectionnerait toujours la ligne 0 passerait. Douze lignes séparent les
 * quatre, et surtout rendent `PageDown` (pas de 10) discriminant : depuis la
 * ligne 0, il doit atterrir sur la 10 — ni sur la 11 (dernière, ce que ferait
 * un `End` déguisé), ni sur la 1 (ce que ferait un `ArrowDown` déguisé).
 *
 * ═══ Ce que ce fichier ne prouve toujours pas ═══
 *
 * Que l'anneau de focus est VISIBLE : jsdom n'applique aucune feuille de style,
 * donc `:focus-visible` n'y a pas d'existence. Un focus qui se déplace sans
 * qu'on le voie resterait inutilisable, et cela se vérifie au navigateur.
 */

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tableau, type ColonneTableau } from './Tableau';

type LigneTest = { id: string; nom: string };

/**
 * Douze lignes nommées par leur RANG, pas par un libellé métier : l'assertion
 * qui compte est « quelle ligne a le focus », et un nom qui dit son rang rend
 * un échec lisible sans avoir à recompter la fixture.
 */
const LIGNES: readonly LigneTest[] = Array.from({ length: 12 }, (_, rang) => ({
  id: `l${rang}`,
  nom: `Ligne ${rang}`,
}));

const COLONNES: ReadonlyArray<ColonneTableau<LigneTest>> = [
  { cle: 'nom', libelle: 'Produit', largeur: '100%', alignement: 'texte', rendu: (l) => l.nom },
];

/**
 * Le tableau est encadré de DEUX boutons, et c'est le cœur du dispositif.
 *
 * Sans un élément focalisable AVANT et APRÈS, on ne peut pas distinguer
 * « `Tab` sort du tableau » de « `Tab` ne fait rien » : dans les deux cas le
 * tableau n'a plus le focus. Le bouton « après » est le seul témoin qui prouve
 * que le focus est allé QUELQUE PART, donc qu'aucun piège ne le retient.
 */
function Harnais({
  lignes = LIGNES,
  onSelectionner,
  selectionnee,
  selectionnable = true,
}: {
  lignes?: readonly LigneTest[];
  onSelectionner?: (ligne: LigneTest) => void;
  selectionnee?: string;
  selectionnable?: boolean;
}) {
  return (
    <>
      <button type="button">avant</button>
      <Tableau
        colonnes={COLONNES}
        lignes={lignes}
        cleLigne={(l) => l.id}
        etatVide={<p>Aucune ligne pour l’instant.</p>}
        {...(selectionnee === undefined ? {} : { ligneSelectionneeCle: selectionnee })}
        {...(selectionnable ? { onSelectionnerLigne: onSelectionner ?? (() => {}) } : {})}
      />
      <button type="button">après</button>
    </>
  );
}

/** Rangée qui porte réellement le focus, désignée par son texte. */
function rangeeFocalisee(): string | null {
  const actif = document.activeElement;
  return actif === null || actif.tagName !== 'TR' ? null : actif.textContent;
}

function rangee(nom: string): HTMLElement {
  return screen.getByText(nom).closest('tr') as HTMLElement;
}

describe('Tableau monté — `Tab` entre dans la grille et en ressort (aucun piège à focus)', () => {
  it('une seule tabulation traverse les douze lignes : le point d’entrée puis la sortie', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais />);

    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'avant' }));

    // Le « roving tabindex » : la grille entière ne coûte QU'UNE tabulation.
    await utilisateur.tab();
    expect(rangeeFocalisee()).toBe('Ligne 0');

    // Et la suivante en ressort. C'est ce qui distingue une grille d'un piège :
    // douze lignes, une tabulation pour entrer, une pour sortir.
    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'après' }));
  });

  it('depuis le MILIEU de la grille, `Tab` sort aussi — il ne repart pas parcourir les lignes', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais />);

    rangee('Ligne 0').focus();
    await utilisateur.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(rangeeFocalisee()).toBe('Ligne 3');

    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'après' }));
  });

  it('`Shift+Tab` depuis la grille revient au contrôle précédent', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais />);

    // On DESCEND par les flèches plutôt que d'appeler `.focus()` directement :
    // seule la navigation clavier déplace le `tabindex="0"`. Un `.focus()` nu
    // laisserait la ligne 0 seule tabulable, et `Shift+Tab` remonterait vers
    // elle — un vert qui ne dirait rien de la sortie de grille.
    rangee('Ligne 0').focus();
    await utilisateur.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(rangeeFocalisee()).toBe('Ligne 4');

    await utilisateur.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'avant' }));
  });

  it('un tableau de CONSULTATION n’intercepte pas la tabulation du tout', async () => {
    // Régression à surveiller (`Parametres`, les journaux) : un tableau non
    // sélectionnable ne doit coûter aucune tabulation, pas même une.
    const utilisateur = userEvent.setup();
    render(<Harnais selectionnable={false} />);

    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'avant' }));
    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'après' }));
  });
});

describe('Tableau monté — les flèches déplacent le focus RÉEL, pas seulement un attribut', () => {
  it('`ArrowDown` et `ArrowUp` avancent et reculent d’une ligne', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais />);

    rangee('Ligne 0').focus();
    await utilisateur.keyboard('{ArrowDown}');
    expect(rangeeFocalisee()).toBe('Ligne 1');
    await utilisateur.keyboard('{ArrowDown}');
    expect(rangeeFocalisee()).toBe('Ligne 2');
    await utilisateur.keyboard('{ArrowUp}');
    expect(rangeeFocalisee()).toBe('Ligne 1');
  });

  it('le point d’entrée de tabulation SUIT le focus (sinon la grille se rejoue depuis le haut)', async () => {
    // Le défaut que ce test attrape : déplacer le focus sans déplacer le
    // `tabindex="0"`. Tout aurait l'air juste à l'écran, mais ressortir puis
    // revenir par `Tab` ramènerait l'utilisateur ligne 0 à chaque fois.
    const utilisateur = userEvent.setup();
    render(<Harnais />);

    rangee('Ligne 0').focus();
    await utilisateur.keyboard('{ArrowDown}{ArrowDown}');

    expect(rangee('Ligne 2')).toHaveAttribute('tabindex', '0');
    expect(rangee('Ligne 0')).toHaveAttribute('tabindex', '-1');
    // Une seule rangée dans l'ordre de tabulation, toujours — mesuré sur le DOM
    // vivant et non sur le balisage initial.
    expect(document.querySelectorAll('tbody tr[tabindex="0"]')).toHaveLength(1);

    // Preuve par l'usage : sortir puis revenir rend le focus à la ligne 2.
    await utilisateur.tab();
    await utilisateur.tab({ shift: true });
    expect(rangeeFocalisee()).toBe('Ligne 2');
  });

  it('`Home` et `End` sautent aux extrémités, `PageDown` d’exactement dix lignes', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais />);

    rangee('Ligne 0').focus();
    // Douze lignes : 0 + 10 = 10, ni la 11 (ce que ferait un `End` déguisé),
    // ni la 1 (ce que ferait un `ArrowDown` déguisé).
    await utilisateur.keyboard('{PageDown}');
    expect(rangeeFocalisee()).toBe('Ligne 10');
    await utilisateur.keyboard('{End}');
    expect(rangeeFocalisee()).toBe('Ligne 11');
    await utilisateur.keyboard('{PageUp}');
    expect(rangeeFocalisee()).toBe('Ligne 1');
    await utilisateur.keyboard('{Home}');
    expect(rangeeFocalisee()).toBe('Ligne 0');
  });

  it('buter en bas ne boucle pas, et rend la main au défilement natif de la page', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais />);

    rangee('Ligne 11').focus();
    await utilisateur.keyboard('{ArrowDown}');
    expect(rangeeFocalisee()).toBe('Ligne 11');

    // Le second volet de la décision documentée : sans action, PAS de
    // `preventDefault`, donc la page défile et la butée se SENT. `fireEvent`
    // rend `false` quand l'évènement a été annulé.
    const nonAnnule = fireEvent.keyDown(rangee('Ligne 11'), { key: 'ArrowDown' });
    expect(nonAnnule).toBe(true);
  });
});

describe('Tableau monté — activer la ligne COURANTE (règle n°10 : la souris n’est jamais obligatoire)', () => {
  it('`Entrée` active la ligne courante, pas la première', async () => {
    // Le piège de la fixture dégénérée : avec une seule ligne, un composant
    // qui sélectionnerait toujours `lignes[0]` passerait ce test. Ici on
    // descend jusqu'à la ligne 3, donc seule la vraie ligne courante convient.
    const utilisateur = userEvent.setup();
    const selectionner = vi.fn();
    render(<Harnais onSelectionner={selectionner} />);

    rangee('Ligne 0').focus();
    await utilisateur.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');

    expect(selectionner).toHaveBeenCalledTimes(1);
    expect(selectionner).toHaveBeenCalledWith({ id: 'l3', nom: 'Ligne 3' });
  });

  it('`Espace` active la ligne courante, et empêche le défilement de la page', async () => {
    const utilisateur = userEvent.setup();
    const selectionner = vi.fn();
    render(<Harnais onSelectionner={selectionner} />);

    rangee('Ligne 0').focus();
    await utilisateur.keyboard('{ArrowDown}{ArrowDown}');
    await utilisateur.keyboard(' ');

    expect(selectionner).toHaveBeenCalledWith({ id: 'l2', nom: 'Ligne 2' });

    // Sans `preventDefault`, `Espace` fait défiler la page d'un écran : on
    // sélectionnerait une ligne ET on perdrait la liste de vue.
    const nonAnnule = fireEvent.keyDown(rangee('Ligne 2'), { key: ' ' });
    expect(nonAnnule).toBe(false);
  });

  it('après la sélection, le focus RESTE sur la ligne — la navigation continue sans souris', async () => {
    // C'est l'assertion qui manquait le plus. Si l'activation renvoyait le
    // focus au `body` (re-rendu du parent, remplacement de la rangée…), la
    // flèche suivante ne ferait plus rien et l'utilisateur devrait retabuler
    // depuis le haut du document — sur une saisie répétitive, c'est ce qui
    // fait reprendre la souris.
    const utilisateur = userEvent.setup();
    const selectionner = vi.fn();
    render(<Harnais onSelectionner={selectionner} />);

    rangee('Ligne 0').focus();
    await utilisateur.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(rangeeFocalisee()).toBe('Ligne 2');

    // Et la navigation repart bien d'où elle s'était arrêtée.
    await utilisateur.keyboard('{ArrowDown}');
    expect(rangeeFocalisee()).toBe('Ligne 3');
  });

  it('un clic déplace AUSSI le point d’entrée clavier : `Tab` repart d’où l’œil se trouve', async () => {
    const utilisateur = userEvent.setup();
    const selectionner = vi.fn();
    render(<Harnais onSelectionner={selectionner} />);

    await utilisateur.click(rangee('Ligne 7'));
    expect(selectionner).toHaveBeenCalledWith({ id: 'l7', nom: 'Ligne 7' });
    expect(rangee('Ligne 7')).toHaveAttribute('tabindex', '0');
    expect(rangee('Ligne 0')).toHaveAttribute('tabindex', '-1');

    // Tabuler depuis le contrôle qui précède doit maintenant entrer ligne 7.
    screen.getByRole('button', { name: 'avant' }).focus();
    await utilisateur.tab();
    expect(rangeeFocalisee()).toBe('Ligne 7');
  });

  it('aucune touche ordinaire n’active la ligne (« a », `Escape`, `Tab`)', async () => {
    const utilisateur = userEvent.setup();
    const selectionner = vi.fn();
    render(<Harnais onSelectionner={selectionner} />);

    rangee('Ligne 5').focus();
    await utilisateur.keyboard('a{Escape}');
    expect(selectionner).not.toHaveBeenCalled();
    // `Tab` en particulier ne doit JAMAIS être capturé : c'est la sortie.
    expect(fireEvent.keyDown(rangee('Ligne 5'), { key: 'Tab' })).toBe(true);
  });

  it('un tableau de consultation reste inerte au clavier comme à la souris', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais selectionnable={false} />);

    const cible = rangee('Ligne 3');
    expect(cible).not.toHaveAttribute('tabindex');
    await utilisateur.click(cible);
    // Rien à assurer d'autre que l'absence de rôle interactif : le tableau ne
    // doit pas devenir accidentellement cliquable (`Parametres`).
    expect(document.querySelector('table')).not.toHaveAttribute('role', 'grid');
  });
});

describe('Tableau monté — la sélection est ANNONCÉE, pas seulement colorée', () => {
  it('`aria-selected` suit la ligne choisie quand l’écran la fait changer', () => {
    // `aria-selected` n'est valide que dans un `role="grid"` : posé sur un
    // tableau ordinaire, NVDA et VoiceOver l'ignorent purement et simplement,
    // et l'état n'existe alors que pour les voyants.
    const { rerender } = render(<Harnais selectionnee="l2" />);
    expect(rangee('Ligne 2')).toHaveAttribute('aria-selected', 'true');
    expect(rangee('Ligne 5')).toHaveAttribute('aria-selected', 'false');

    rerender(<Harnais selectionnee="l5" />);
    expect(rangee('Ligne 2')).toHaveAttribute('aria-selected', 'false');
    expect(rangee('Ligne 5')).toHaveAttribute('aria-selected', 'true');
  });

  it('la grille s’ouvre sur la ligne SÉLECTIONNÉE, pas sur la première', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais selectionnee="l9" />);

    await utilisateur.tab();
    await utilisateur.tab();
    expect(rangeeFocalisee()).toBe('Ligne 9');
  });
});

describe('Tableau monté — les grandeurs chiffrées sont alignées à droite', () => {
  it('marque `num` sur l’en-tête ET sur les cellules d’une colonne `nombre`, jamais sur `texte`', () => {
    // docs/07 §4.5 : les grandeurs quantitatives sont alignées à droite « sans
    // exception » — c'est ce qui permet de comparer deux montants d'un coup
    // d'œil dans une colonne. Les identifiants qualitatifs (dates, numéros de
    // lot) restent à gauche : ce ne sont pas des grandeurs.
    render(
      <Tableau
        colonnes={[
          COLONNES[0]!,
          {
            cle: 'quantite',
            libelle: 'Quantité',
            largeur: '20%',
            alignement: 'nombre',
            rendu: (l) => l.id,
          },
        ]}
        lignes={LIGNES.slice(0, 3)}
        cleLigne={(l) => l.id}
        etatVide={<p>Vide.</p>}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Quantité' })).toHaveClass('num');
    expect(screen.getByRole('columnheader', { name: 'Produit' })).not.toHaveClass('num');

    const cellulesChiffrees = document.querySelectorAll('tbody td:nth-child(2)');
    expect(cellulesChiffrees).toHaveLength(3);
    for (const cellule of cellulesChiffrees) expect(cellule).toHaveClass('num');
    for (const cellule of document.querySelectorAll('tbody td:nth-child(1)')) {
      expect(cellule).not.toHaveClass('num');
    }
  });
});

describe('Tableau monté — le compte affiché quand un filtre réduit la liste', () => {
  it('annonce « visibles sur total », avec le nom de l’entité', () => {
    // docs/07 §4.5, « toujours afficher le compte » : sans lui, une liste
    // filtrée est indistinguable d'une liste vraiment courte, et le porteur
    // croit avoir tout vu.
    render(
      <Tableau
        colonnes={COLONNES}
        lignes={LIGNES.slice(0, 5)}
        cleLigne={(l) => l.id}
        etatVide={<p>Vide.</p>}
        total={34}
        libelleEntite="ingrédients"
      />,
    );
    expect(screen.getByText(/5 sur 34 ingrédients/)).toBeInTheDocument();
  });

  it('se passe du nom d’entité quand l’écran n’en fournit pas', () => {
    render(
      <Tableau
        colonnes={COLONNES}
        lignes={LIGNES.slice(0, 2)}
        cleLigne={(l) => l.id}
        etatVide={<p>Vide.</p>}
        total={12}
      />,
    );
    // Ni libellé collé, ni espace en trop avant la fin de la phrase.
    expect(screen.getByText('2 sur 12')).toBeInTheDocument();
  });

  it('n’affiche aucun compte quand l’écran ne filtre rien', () => {
    // Le compte brut a alors sa place dans le titre du `Panneau` englobant :
    // le répéter ici ferait deux comptes pour une seule liste.
    render(
      <Tableau
        colonnes={COLONNES}
        lignes={LIGNES}
        cleLigne={(l) => l.id}
        etatVide={<p>Vide.</p>}
      />,
    );
    expect(screen.queryByText(/sur/)).toBeNull();
  });
});

describe('Tableau monté — une liste vide reste franchissable', () => {
  it('affiche l’état vide fourni et ne retient aucune tabulation', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais lignes={[]} />);

    expect(screen.getByText('Aucune ligne pour l’instant.')).toBeInTheDocument();

    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'avant' }));
    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'après' }));
  });
});

/**
 * ═══ Le focus rattrapé quand la ligne focalisée quitte la liste ═══
 *
 * CE BLOC ÉTAIT UN `it.fails` (défaut encodé le 01/08/2026, non corrigé alors
 * parce que la mission qui l'a trouvé n'écrivait que des tests). Il est
 * redevenu un test ORDINAIRE le jour où `Tableau` a appris à rattraper le
 * focus — c'est exactement le cycle que la convention `it.fails` promet
 * (docs/39 §8) : un `it.fails` corrigé passe au rouge de lui-même
 * (« Expect test to fail ») et réclame sa propre conversion.
 *
 * Le défaut qu'il gardait : quand la ligne qui a le focus disparaît — un filtre
 * qu'on active, une ligne qu'on vient de traiter et qui quitte « à commander » —
 * son `<tr>` est retiré du DOM et le navigateur rend le focus au `<body>`.
 * `Tableau` recalculait bien le `tabindex="0"`, mais RIEN ne rattrapait le
 * focus. Depuis le `body`, les flèches ne font plus rien et la tabulation
 * suivante repart du TOUT DÉBUT du document — les treize tabulations que le
 * lien d'évitement de `Navigation.tsx` existe précisément pour éviter.
 *
 * Le patron `grid` de l'APG le nomme : si l'élément focalisé est retiré, le
 * focus doit être replacé dans la grille.
 * <https://www.w3.org/WAI/ARIA/apg/patterns/grid/>
 */
describe('Tableau monté — le focus est rattrapé quand la ligne focalisée est filtrée', () => {
  it('reste DANS la grille quand un filtre emporte la ligne focalisée', () => {
    const { rerender } = render(<Harnais />);
    rangee('Ligne 5').focus();
    expect(rangeeFocalisee()).toBe('Ligne 5');

    // Le filtre ne laisse que trois lignes, sans la 5 : exactement ce que fait
    // « à commander » sur Stock quand un réapprovisionnement vient d'être saisi.
    rerender(<Harnais lignes={LIGNES.slice(0, 3)} />);

    // L'assertion historique de l'`it.fails` — constat d'alors : `BODY`.
    expect(document.activeElement?.tagName).toBe('TR');
    // Et la survivante la plus proche de la 5 parmi {0, 1, 2} est la 2.
    expect(rangeeFocalisee()).toBe('Ligne 2');
  });

  it('atterrit sur la ligne SUIVANTE quand la ligne traitée quitte la liste', () => {
    // Le geste de la saisie post-marché : on traite une ligne, elle sort de la
    // liste, et la file d'attente doit avancer d'elle-même. Le repli « première
    // ligne » (celui de `resoudreIndexActif` pour le `tabIndex`) renverrait ici
    // en haut d'une liste de douze — donc à la souris.
    const sansLa5 = LIGNES.filter((l) => l.id !== 'l5');
    const { rerender } = render(<Harnais />);
    rangee('Ligne 5').focus();

    rerender(<Harnais lignes={sansLa5} />);

    expect(rangeeFocalisee()).toBe('Ligne 6');
  });

  it('le point d’entrée de tabulation suit le rattrapage, et les flèches repartent de là', async () => {
    // Rattraper le focus sans déplacer le `tabindex="0"` laisserait la grille
    // se rejouer depuis le haut au prochain aller-retour : le rattrapage doit
    // rendre une position UTILISABLE, pas seulement un `activeElement` non nul.
    const utilisateur = userEvent.setup();
    const sansLa5 = LIGNES.filter((l) => l.id !== 'l5');
    const { rerender } = render(<Harnais />);
    rangee('Ligne 5').focus();

    rerender(<Harnais lignes={sansLa5} />);

    expect(rangee('Ligne 6')).toHaveAttribute('tabindex', '0');
    expect(document.querySelectorAll('tbody tr[tabindex="0"]')).toHaveLength(1);

    await utilisateur.keyboard('{ArrowDown}');
    expect(rangeeFocalisee()).toBe('Ligne 7');
  });

  it('ne vole JAMAIS le focus au champ de recherche qui vient de filtrer', async () => {
    // Le cas le plus fréquent, et celui où un rattrapage naïf serait pire que
    // le défaut : l'utilisateur tape dans un champ au-dessus de la liste. Le
    // focus est dans le CHAMP — la rangée disparaît sans que personne ne perde
    // rien, et la ramener arracherait la saisie à chaque lettre.
    const utilisateur = userEvent.setup();

    function HarnaisFiltre() {
      const [filtre, definirFiltre] = useState('');
      const visibles = LIGNES.filter((l) => l.nom.includes(filtre));
      return (
        <>
          <input
            aria-label="Rechercher"
            value={filtre}
            onChange={(e) => definirFiltre(e.target.value)}
          />
          <Tableau
            colonnes={COLONNES}
            lignes={visibles}
            cleLigne={(l) => l.id}
            etatVide={<p>Aucune ligne ne correspond à ce filtre.</p>}
            onSelectionnerLigne={() => {}}
          />
        </>
      );
    }

    render(<HarnaisFiltre />);
    rangee('Ligne 5').focus();
    expect(rangeeFocalisee()).toBe('Ligne 5');

    const champ = screen.getByRole('textbox', { name: 'Rechercher' });
    await utilisateur.click(champ);
    await utilisateur.keyboard('Ligne 1');

    // La ligne 5 a bien disparu (le filtre ne laisse que 1, 10 et 11)…
    expect(screen.queryByText('Ligne 5')).toBeNull();
    // … et le focus n'a pas bougé du champ.
    expect(document.activeElement).toBe(champ);
  });

  it('quand la liste devient VIDE, le focus va sur l’état vide — qui PORTE l’explication', async () => {
    // Le cas à part : il n'existe plus aucune rangée de données à viser. Laisser
    // le focus sur `<body>` serait le défaut d'origine ; le poser sur la rangée
    // de l'état vide met l'utilisateur là où se trouve la phrase qui dit
    // pourquoi la liste est vide (docs/07 §4.7), et la tabulation repart d'ici.
    const utilisateur = userEvent.setup();
    const { rerender } = render(<Harnais />);
    rangee('Ligne 5').focus();

    rerender(<Harnais lignes={[]} />);

    expect(document.activeElement?.tagName).toBe('TR');
    expect(document.activeElement?.textContent).toBe('Aucune ligne pour l’instant.');

    // Ce qui était perdu et qui est rendu : la tabulation repart d'ICI, donc du
    // bouton qui suit le tableau — pas du tout début du document.
    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'après' }));
  });

  it('ne rattrape rien quand le focus n’était PAS dans la grille', async () => {
    // Symétrique du vol : l'utilisateur a quitté la grille par tabulation, puis
    // un rechargement de fond retire la ligne qu'il avait visitée. Rien ne doit
    // le ramener en arrière.
    const utilisateur = userEvent.setup();
    const { rerender } = render(<Harnais />);
    rangee('Ligne 5').focus();
    await utilisateur.tab();
    const boutonApres = screen.getByRole('button', { name: 'après' });
    expect(document.activeElement).toBe(boutonApres);

    rerender(<Harnais lignes={LIGNES.slice(0, 3)} />);

    expect(document.activeElement).toBe(boutonApres);
  });

  it('un tableau de CONSULTATION ne gagne aucun attribut de focalisation', () => {
    // La rangée d'état vide ne devient focalisable que sur une grille
    // interactive : `Parametres` et les journaux restent inertes.
    render(<Harnais lignes={[]} selectionnable={false} />);
    const rangeeVide = screen.getByText('Aucune ligne pour l’instant.').closest('tr');
    expect(rangeeVide).not.toHaveAttribute('tabindex');
  });
});
