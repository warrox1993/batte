/**
 * `affichage` MONTÉ — la preuve, une seule fois, pour neuf appelants.
 *
 * `PastilleStatut` vivait en SEPT exemplaires, `LigneFiche` en deux. Muter la
 * pastille d'un écran ne faisait rougir aucun des six autres : c'est ce que la
 * consolidation referme. Ce fichier est l'endroit unique où ces deux
 * primitives peuvent désormais casser, et où on le verra.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GLYPHE_STATUT, type Statut } from '@batte/core';

import { LigneFiche, PastilleStatut } from './affichage';

describe('PastilleStatut — le glyphe est un CANAL REDONDANT, pas une décoration', () => {
  const cas: ReadonlyArray<readonly [Statut, string]> = [
    ['depassement', 'text-depassement'],
    ['alerte', 'text-alerte'],
    ['conforme', 'text-conforme'],
  ];

  it.each(cas)('le statut « %s » porte sa classe de couleur', (statut, classe) => {
    const { container } = render(<PastilleStatut statut={statut} libelle="Manque" />);
    /*
      `container.firstElementChild` et non `getByText('Manque').parentElement` :
      le texte du libellé est un enfant DIRECT de la pastille, donc `getByText`
      rend la pastille elle-même et son parent est le conteneur de rendu, qui
      ne porte aucune classe. Erreur commise puis corrigée le 01/08/2026 — le
      test échouait sur `expected '' to contain 'text-depassement'`.
    */
    expect(container.firstElementChild?.className ?? '').toContain(classe);
  });

  it.each(cas)('le statut « %s » porte AUSSI son glyphe', (statut) => {
    const { container } = render(<PastilleStatut statut={statut} libelle="Manque" />);
    expect(container.textContent).toContain(GLYPHE_STATUT[statut]);
  });

  it(
    'les trois statuts ont des glyphes DIFFÉRENTS — sans quoi le canal redondant ne redonde ' +
      'rien, et un tableau imprimé en noir et blanc redevient illisible',
    () => {
      const glyphes = new Set(
        ['depassement', 'alerte', 'conforme'].map((s) => GLYPHE_STATUT[s as Statut]),
      );
      expect(glyphes.size).toBe(3);
    },
  );

  it(
    'le glyphe est `aria-hidden` : il double la couleur pour l’œil, il n’ajoute rien à l’oreille ' +
      '— le libellé se lit seul',
    () => {
      const { container } = render(<PastilleStatut statut="alerte" libelle="À rattacher" />);
      const glyphe = container.querySelector('[aria-hidden="true"]');
      expect(glyphe).not.toBeNull();
      expect(glyphe?.textContent).toBe(GLYPHE_STATUT.alerte);
    },
  );

  it('le libellé, lui, reste du texte lisible — jamais caché', () => {
    render(<PastilleStatut statut="conforme" libelle="Réalisable avec le stock actuel" />);
    expect(screen.getByText('Réalisable avec le stock actuel')).toBeInTheDocument();
  });

  it('aucun fond de rangée coloré : la couleur porte l’état de la VALEUR, pas de la ligne', () => {
    const { container } = render(<PastilleStatut statut="depassement" libelle="Manque" />);
    const classes = container.firstElementChild?.className ?? '';
    // Discriminant : `text-…` est attendu, `bg-…` ne doit jamais apparaître ici.
    expect(classes).toContain('text-depassement');
    expect(classes).not.toContain('bg-');
  });
});

describe('LigneFiche — une liste de DÉFINITIONS, pas deux textes sans lien', () => {
  it('rend l’intitulé en `<dt>` et la valeur en `<dd>`', () => {
    const { container } = render(<LigneFiche libelle="Fournisseur" valeur="Moulin de Hollogne" />);

    /*
      Le balisage EST l'information : un lecteur d'écran annonce la paire
      terme/définition. Deux `<span>` diraient deux textes voisins, sans dire
      que l'un qualifie l'autre.
    */
    expect(container.querySelector('dt')?.textContent).toBe('Fournisseur');
    expect(container.querySelector('dd')?.textContent).toBe('Moulin de Hollogne');
  });

  it('la valeur porte les chiffres tabulaires — les montants d’une fiche s’alignent', () => {
    const { container } = render(<LigneFiche libelle="Prix" valeur="18,75 €" />);
    expect(container.querySelector('dd')?.className ?? '').toContain('num');
  });

  it('affiche la valeur telle qu’on la lui donne — aucun formatage, aucun calcul', () => {
    // Règle d'architecture n°1 : ce composant ne met pas en forme, il montre.
    render(<LigneFiche libelle="Contenance" valeur="25,0 kg" />);
    expect(screen.getByText('25,0 kg')).toBeInTheDocument();
  });

  it('un tiret d’absence reste un tiret — jamais transformé en zéro', () => {
    render(<LigneFiche libelle="Référence fournisseur" valeur="—" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
