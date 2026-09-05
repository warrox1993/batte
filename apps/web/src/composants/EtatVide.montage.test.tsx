/**
 * `EtatVide` — le premier écran que voit quelqu'un qui démarre.
 *
 * ═══ Pourquoi ce fichier est le plus utile de la mission ═══
 *
 * Mesure du 01/08/2026 avant écriture : `EtatVide.tsx` était couvert à
 * **2,32 %**. Aucun test ne le rendait, nulle part — pas une variante sur
 * quatre. Un composant qu'aucun test ne rend n'est pas « peu couvert » : il
 * est absent de la suite, et sa suppression pure et simple n'aurait fait
 * rougir aucun fichier de ce dépôt.
 *
 * C'est d'autant plus coûteux que c'est le composant du DÉMARRAGE À FROID :
 * base neuve, aucune recette, aucun lot, aucune session. docs/07 §4.7 exige
 * quatre cas distincts précisément parce qu'un écran vide SANS PHRASE ne dit
 * pas s'il est vide, cassé, ou en train de charger — et que la personne qui
 * le voit est celle qui a le moins de repères.
 *
 * ═══ Le piège que ce fichier évite ═══
 *
 * Vérifier « il y a du texte » passerait avec un gabarit générique unique,
 * c'est-à-dire exactement ce que docs/07 §4.7 interdit. Les tests ci-dessous
 * comparent donc les variantes ENTRE ELLES : c'est la seule façon de prouver
 * qu'elles sont réellement distinctes et pas quatre alias du même écran.
 *
 * ═══ Ce que ce fichier ne prouve pas ═══
 *
 * Le liseré `alerte` de `lot-a-venir` est une classe Tailwind : jsdom ne
 * calcule aucun style, donc sa PRÉSENCE est vérifiée, pas sa couleur.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EtatVide } from './EtatVide';

describe('EtatVide — aucune variante n’est muette', () => {
  it('« premier-lancement » dit un titre ET une phrase de contexte', () => {
    render(
      <EtatVide
        variante="premier-lancement"
        titre="Aucune recette pour l’instant"
        explication="Créez votre première fiche technique pour calculer un coût matière."
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Aucune recette pour l’instant' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Créez votre première fiche technique pour calculer un coût matière.'),
    ).toBeInTheDocument();
  });

  it('« filtre » NOMME le filtre en cause, et ne réutilise pas le texte du premier lancement', () => {
    render(
      <EtatVide
        variante="filtre"
        explicationFiltre="Le filtre « à commander » masque les 14 autres ingrédients."
        onReinitialiser={() => {}}
      />,
    );

    expect(
      screen.getByText('Le filtre « à commander » masque les 14 autres ingrédients.'),
    ).toBeInTheDocument();
    // Un état de filtre n'est PAS un démarrage à froid : il ne doit jamais
    // laisser croire que la base est vide.
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('« normal » reste une ligne discrète : ni titre, ni bouton', () => {
    // docs/07 §4.7 : « Aucune alerte. » est une bonne nouvelle. La présenter
    // en carte avec titre et action lui donnerait le poids d'un problème.
    render(<EtatVide variante="normal" texte="Aucune alerte." />);

    expect(screen.getByText('Aucune alerte.')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('« lot-a-venir » se distingue à l’œil : un liseré `alerte` qu’aucune autre variante ne porte', () => {
    const { container } = render(
      <EtatVide
        variante="lot-a-venir"
        titre="Écran à venir"
        explication="Ce module arrive au lot 12 (docs/04-ROADMAP-LOTS.md)."
      />,
    );

    expect(screen.getByRole('heading', { name: 'Écran à venir' })).toBeInTheDocument();
    // Le liseré existe pour qu'on ne livre JAMAIS un écran incomplet en le
    // croyant terminé : sans lui, un placeholder ressemble à un état vide sain.
    expect(container.querySelector('.border-l-alerte')).not.toBeNull();
  });
});

describe('EtatVide — quatre cas RÉELLEMENT distincts, pas quatre alias', () => {
  /**
   * Le test qui interdit la dérive vers un gabarit unique. On rend les quatre
   * variantes avec des données comparables et on vérifie que leurs sorties
   * diffèrent deux à deux. Un futur refactor qui les ramènerait à un seul
   * rendu générique ferait rougir ici, et seulement ici.
   */
  it('les quatre variantes produisent quatre rendus différents', () => {
    const rendus = [
      render(<EtatVide variante="premier-lancement" titre="T" explication="E" />).container
        .innerHTML,
      render(<EtatVide variante="filtre" explicationFiltre="E" onReinitialiser={() => {}} />)
        .container.innerHTML,
      render(<EtatVide variante="normal" texte="E" />).container.innerHTML,
      render(<EtatVide variante="lot-a-venir" titre="T" explication="E" />).container.innerHTML,
    ];

    expect(new Set(rendus).size).toBe(4);
  });

  it('« premier-lancement » et « lot-a-venir » ne se confondent pas malgré la même forme', () => {
    // Ce sont les deux variantes les plus proches (titre + explication) : si
    // une seule paire devait se confondre un jour, ce serait celle-là.
    const premier = render(
      <EtatVide variante="premier-lancement" titre="Même titre" explication="Même phrase." />,
    ).container.innerHTML;
    const aVenir = render(
      <EtatVide variante="lot-a-venir" titre="Même titre" explication="Même phrase." />,
    ).container.innerHTML;

    expect(premier).not.toBe(aVenir);
    expect(premier).not.toContain('border-l-alerte');
    expect(aVenir).toContain('border-l-alerte');
  });
});

describe('EtatVide — les actions sont atteignables au CLAVIER (CLAUDE.md §3 règle 10)', () => {
  it('l’action du premier lancement s’atteint par `Tab` et s’active par `Entrée`', async () => {
    // Sur une base neuve, ce bouton est parfois la SEULE action de l'écran :
    // s'il n'était atteignable qu'à la souris, le démarrage à froid le serait
    // aussi.
    const utilisateur = userEvent.setup();
    const creer = vi.fn();
    render(
      <EtatVide
        variante="premier-lancement"
        titre="Aucun ingrédient"
        explication="Commencez par déclarer la farine."
        action={{ libelle: 'Créer un ingrédient', onClick: creer }}
      />,
    );

    await utilisateur.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Créer un ingrédient' }),
    );

    await utilisateur.keyboard('{Enter}');
    expect(creer).toHaveBeenCalledTimes(1);
  });

  it('l’action du premier lancement s’active aussi par `Espace`', async () => {
    const utilisateur = userEvent.setup();
    const creer = vi.fn();
    render(
      <EtatVide
        variante="premier-lancement"
        titre="Aucun ingrédient"
        explication="Commencez par déclarer la farine."
        action={{ libelle: 'Créer un ingrédient', onClick: creer }}
      />,
    );

    screen.getByRole('button', { name: 'Créer un ingrédient' }).focus();
    await utilisateur.keyboard(' ');
    expect(creer).toHaveBeenCalledTimes(1);
  });

  it('« Réinitialiser le filtre » s’atteint et s’active au clavier', async () => {
    // Sans cela, un filtre posé au clavier ne se retire qu'à la souris — et
    // l'écran reste vide sans recours.
    const utilisateur = userEvent.setup();
    const reinitialiser = vi.fn();
    render(
      <EtatVide
        variante="filtre"
        explicationFiltre="Le filtre « à commander » masque les 14 autres ingrédients."
        onReinitialiser={reinitialiser}
      />,
    );

    await utilisateur.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Réinitialiser le filtre' }),
    );
    await utilisateur.keyboard('{Enter}');
    expect(reinitialiser).toHaveBeenCalledTimes(1);
  });

  it('sans action déclarée, le premier lancement n’expose AUCUN bouton fantôme', () => {
    render(<EtatVide variante="premier-lancement" titre="Aucun lot" explication="Rien reçu." />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('EtatVide — niveau de titre, pour ne pas casser le plan du document', () => {
  it('par défaut `h3` : l’état vide vit DANS un `Panneau`, dont le titre est déjà un `h2`', () => {
    render(<EtatVide variante="premier-lancement" titre="Aucune recette" explication="…" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Aucune recette' })).toBeInTheDocument();
  });

  it('`h2` quand l’état vide est posé seul sous le `h1` de la page', () => {
    // Là, `h3` sauterait un niveau — un lecteur d'écran annoncerait une
    // sous-section qui n'a pas de section parente.
    render(
      <EtatVide variante="premier-lancement" titre="Produits" explication="…" niveauTitre="h2" />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Produits' })).toBeInTheDocument();
  });

  it('`lot-a-venir` respecte le même réglage de niveau', () => {
    render(
      <EtatVide variante="lot-a-venir" titre="Fournisseurs" explication="…" niveauTitre="h2" />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Fournisseurs' })).toBeInTheDocument();
  });
});
