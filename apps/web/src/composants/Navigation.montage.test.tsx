/**
 * `Navigation` MONTÉE — toutes les destinations atteignables au clavier.
 *
 * ═══ Ce que ce fichier ajoute à `Navigation.test.tsx` ═══
 *
 * `Navigation.test.tsx`, à côté, reste valable et n'est pas touché : il compte
 * les entrées, vérifie l'unicité des routes et la position du lien
 * d'évitement dans le balisage. Son propre en-tête énumère ce qu'il ne peut
 * pas faire — « `renderToStaticMarkup` n'exécute aucun effet (le
 * `useLayoutEffect` qui fait le `scrollIntoView` ne tourne jamais ici) : ce
 * test ne prouve PAS que le défilement a lieu ».
 *
 * Ce fichier prend exactement ces deux manques :
 *  1. le lien d'évitement, dont le `onClick` n'avait jamais été exécuté par
 *     aucun test (lignes 104-108, non couvertes avant ce jour) ;
 *  2. le recentrage automatique, c'est-à-dire l'effet lui-même.
 *
 * Et il ajoute la question que ni l'un ni l'autre ne posait : est-ce que les
 * 29 destinations sont RÉELLEMENT dans l'ordre de tabulation ? Un seul
 * `tabindex="-1"` glissé dans la liste rendrait un écran inatteignable sans
 * souris, et le comptage de balisage ne le verrait pas.
 *
 * ═══ Le piège d'environnement, à connaître avant d'écrire une page montée ═══
 *
 * **jsdom n'implémente pas `Element.prototype.scrollIntoView`** : la propriété
 * vaut `undefined`, et le `useLayoutEffect` de `Navigation.tsx` la lève donc en
 * `TypeError` au montage. Ce n'est pas un défaut de production (tous les
 * navigateurs la fournissent), mais toute page qui monte `<Navigation />` doit
 * la poser comme ci-dessous, sans quoi le test échoue pour une raison qui n'a
 * rien à voir avec ce qu'il teste.
 *
 * Bénéfice de côté : une fois posée en `vi.fn()`, elle devient l'instrument qui
 * PROUVE le recentrage — la moitié que le fichier voisin déclarait vérifiée à
 * la main seulement.
 *
 * ═══ Ce que ce fichier ne prouve toujours pas ═══
 *
 * Que le défilement soit visuellement suffisant : jsdom ne calcule aucune
 * disposition, `scrollTop` y reste à 0 et aucune hauteur n'est réelle. Il
 * prouve que le bon élément reçoit la bonne demande, pas le nombre de pixels.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Navigation } from './Navigation';

let scrollIntoViewSimule: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollIntoViewSimule = vi.fn();
  // Absente de jsdom : on la POSE, on ne la remplace pas.
  (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = scrollIntoViewSimule;
});

afterEach(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
});

/** La nav est montée avec un `<main>`, cible réelle du lien d'évitement. */
function monter(chemin = '/') {
  return render(
    <MemoryRouter initialEntries={[chemin]}>
      <Navigation />
      <main>
        <button type="button">Premier contrôle du contenu</button>
      </main>
    </MemoryRouter>,
  );
}

describe('Navigation montée — aucune destination inatteignable au clavier', () => {
  it('les 29 entrées sont toutes dans l’ordre de tabulation, dans l’ordre du menu', async () => {
    const utilisateur = userEvent.setup();
    monter();

    const attendus = screen.getAllByRole('link').map((lien) => lien.getAttribute('href'));
    expect(attendus).toHaveLength(29);

    // Première tabulation : le lien d'évitement, qui précède tout (WCAG 2.4.1).
    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aller au contenu' }));

    // Puis les 29 destinations, une par tabulation et dans l'ordre affiché.
    const parcourus: (string | null)[] = [];
    for (let i = 0; i < attendus.length; i += 1) {
      await utilisateur.tab();
      parcourus.push(document.activeElement?.getAttribute('href') ?? null);
    }

    // L'égalité stricte des deux listes prouve d'un coup : aucune entrée
    // sautée, aucun ordre inversé, aucun `tabindex="-1"` glissé dans la liste.
    expect(parcourus).toEqual(attendus);
  });

  it('aucun lien n’est retiré de l’ordre de tabulation par un `tabindex` négatif', () => {
    monter();
    for (const lien of screen.getAllByRole('link')) {
      expect(lien.getAttribute('tabindex')).not.toBe('-1');
    }
  });

  it('la tabulation SORT de la navigation et atteint le contenu', async () => {
    // Sans cela, la nav serait un piège à focus de 29 crans de profondeur.
    const utilisateur = userEvent.setup();
    monter();

    const liens = screen.getAllByRole('link');
    liens[liens.length - 1]?.focus();
    await utilisateur.tab();

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Premier contrôle du contenu' }),
    );
  });
});

describe('Navigation montée — le lien d’évitement fait réellement son travail', () => {
  it('déplace le focus dans le `<main>` (13 tabulations économisées à chaque écran)', async () => {
    // Mesure au clavier avant correction : 13 tabulations pour traverser la
    // navigation avant d'atteindre le premier contrôle du contenu, sur CHAQUE
    // écran et à chaque chargement. Ce `onClick` n'avait jamais été exécuté
    // par aucun test.
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aller au contenu' }));

    await utilisateur.keyboard('{Enter}');

    const contenu = document.querySelector('main');
    expect(document.activeElement).toBe(contenu);
    // Un conteneur non focalisable ne peut PAS recevoir le focus : le
    // `tabIndex = -1` est posé au moment du clic, jamais en dur.
    expect(contenu).toHaveAttribute('tabindex', '-1');
  });

  it('depuis le `<main>`, la tabulation suivante atteint le premier contrôle', async () => {
    // La preuve que le saut sert à quelque chose : on repart DANS le contenu,
    // pas au début du document.
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.tab();
    await utilisateur.keyboard('{Enter}');
    await utilisateur.tab();

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Premier contrôle du contenu' }),
    );
  });

  it('sans `<main>` dans la page, il ne fait rien plutôt que de lever', async () => {
    // Le garde `if (contenu === null) return;`, jamais exercé jusqu'ici.
    const utilisateur = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Navigation />
      </MemoryRouter>,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Aller au contenu' }));
    expect(screen.getByRole('button', { name: 'Aller au contenu' })).toBeInTheDocument();
  });
});

describe('Navigation montée — l’entrée courante est annoncée et recentrée', () => {
  it('marque `aria-current="page"` sur la route active, et sur elle seule', () => {
    monter('/registre-afsca');

    const actifs = screen
      .getAllByRole('link')
      .filter((lien) => lien.getAttribute('aria-current') === 'page');
    expect(actifs).toHaveLength(1);
    expect(actifs[0]).toHaveAttribute('href', '/registre-afsca');
  });

  it('« Tableau de bord » ne reste pas actif sur les autres routes (`end` sur « / »)', () => {
    // Sans `end`, le chemin « / » correspondrait à TOUTES les routes et deux
    // entrées seraient annoncées actives en même temps.
    monter('/stock');
    const actifs = screen
      .getAllByRole('link')
      .filter((lien) => lien.getAttribute('aria-current') === 'page');
    expect(actifs).toHaveLength(1);
    expect(actifs[0]).toHaveAttribute('href', '/stock');
  });

  it('recentre l’entrée active au montage — l’effet, pas seulement sa précondition', () => {
    // 8 des 29 entrées sont sous le pli à 1280×720. Atterrir directement sur
    // l'une d'elles (lien externe, actualisation, retour arrière) laissait un
    // menu où rien n'apparaissait sélectionné.
    monter('/journal-audit');

    expect(scrollIntoViewSimule).toHaveBeenCalledTimes(1);
    // Le plus petit déplacement possible, et sans animation : docs/07 interdit
    // le rebond élastique.
    expect(scrollIntoViewSimule).toHaveBeenCalledWith({ block: 'nearest' });
    // Et c'est bien le LIEN ACTIF qu'on recentre, pas la nav ni un autre lien.
    const cible = scrollIntoViewSimule.mock.instances[0] as HTMLElement;
    expect(cible).toHaveAttribute('href', '/journal-audit');
  });

  it('recentre à nouveau quand la route change, et la route change AU CLAVIER', async () => {
    // On NAVIGUE réellement au lieu de re-rendre avec d'autres
    // `initialEntries` : `MemoryRouter` ne les lit qu'au montage, un nouveau
    // rendu ne changerait donc pas la route et le test serait vert sans rien
    // prouver. Activer le lien au clavier prouve deux choses d'un coup — que
    // « Entrée » navigue, et que le recentrage suit la navigation.
    const utilisateur = userEvent.setup();
    monter('/');
    scrollIntoViewSimule.mockClear();

    const destination = screen
      .getAllByRole('link')
      .find((lien) => lien.getAttribute('href') === '/journal-audit');
    destination?.focus();
    await utilisateur.keyboard('{Enter}');

    // La nouvelle entrée est annoncée…
    expect(destination).toHaveAttribute('aria-current', 'page');
    // …et c'est bien elle qu'on ramène dans le champ visible.
    expect(scrollIntoViewSimule).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewSimule.mock.instances[0]).toHaveAttribute('href', '/journal-audit');
  });

  it('sur une route inconnue, ne recentre rien et n’annonce aucune entrée', () => {
    monter('/route-inexistante');

    expect(
      screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page'),
    ).toHaveLength(0);
    expect(scrollIntoViewSimule).not.toHaveBeenCalled();
  });
});
