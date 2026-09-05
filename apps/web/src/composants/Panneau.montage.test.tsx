/**
 * `Panneau` — le cadre de presque tous les blocs de l'application.
 *
 * Composant minuscule, mais aucun test ne le visait directement : il n'était
 * atteint qu'incidemment, à travers `EncartErreur`. Sa seule branche
 * (`sansRembourrage`) n'était donc jamais exercée dans les deux sens, et c'est
 * précisément celle qui a une conséquence visible : un `Tableau` posé dans un
 * panneau à rembourrage reçoit DEUX rembourrages horizontaux — celui du
 * panneau, puis celui de sa première et de sa dernière colonne —, ce qui
 * décale la première colonne de toutes les listes de l'ERP.
 *
 * Ce que ce fichier ne prouve pas : la règle « jamais un panneau dans un
 * panneau » (docs/07 §4.8), qui porte sur les APPELANTS et non sur ce
 * composant ; ni l'écart de luminance canvas/surface, qui est du style.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Panneau } from './Panneau';

describe('Panneau — titre et contenu', () => {
  it('expose son titre comme un vrai `h2` de l’arbre d’accessibilité', () => {
    render(
      <Panneau titre="Seuils légaux">
        <p>Contenu.</p>
      </Panneau>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Seuils légaux' })).toBeInTheDocument();
  });

  it('rend ses enfants À L’INTÉRIEUR de la même section que le titre', () => {
    // Ce qui garantit qu'un contenu ne peut pas se retrouver visuellement
    // rattaché au panneau voisin — le défaut constaté le 31/07/2026.
    render(
      <Panneau titre="À traiter">
        <p>Trois échéances.</p>
      </Panneau>,
    );
    const titre = screen.getByRole('heading', { level: 2, name: 'À traiter' });
    const contenu = screen.getByText('Trois échéances.');
    expect(titre.closest('section')).toBe(contenu.closest('section'));
  });
});

describe('Panneau — `sansRembourrage`, la branche qui décale toutes les listes', () => {
  it('par défaut, le corps porte le rembourrage `p-4`', () => {
    render(
      <Panneau titre="Résumé">
        <p>Texte courant.</p>
      </Panneau>,
    );
    expect(screen.getByText('Texte courant.').parentElement).toHaveClass('p-4');
  });

  it('avec `sansRembourrage`, le corps n’en porte aucun (cas du `Tableau`)', () => {
    render(
      <Panneau titre="Ingrédients" sansRembourrage>
        <p>Tableau.</p>
      </Panneau>,
    );
    expect(screen.getByText('Tableau.').parentElement).not.toHaveClass('p-4');
  });

  it('les deux réglages produisent bien deux rendus différents', () => {
    // Garde-fou contre une prop devenue inopérante : si `sansRembourrage`
    // cessait d'être lue, les deux rendus deviendraient identiques et tous
    // les tableaux de l'ERP se décaleraient sans qu'aucun test ne rougisse.
    const avec = render(
      <Panneau titre="T">
        <p>C</p>
      </Panneau>,
    ).container.innerHTML;
    const sans = render(
      <Panneau titre="T" sansRembourrage>
        <p>C</p>
      </Panneau>,
    ).container.innerHTML;
    expect(avec).not.toBe(sans);
  });
});
