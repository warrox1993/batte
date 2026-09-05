import { describe, expect, it } from 'vitest';
import {
  actionSurEntree,
  avertissementDlcSaisieDejaDepassee,
  cleAFocaliserApresRetrait,
  valeursFormulaireVide,
} from './SaisieReception';

/**
 * Recette clavier du 30/07/2026 (`apps/web/src/saisie-stock/`, l'ecran le plus
 * utilise de l'application) : deux defauts de focus, confirmes avec de vraies
 * frappes.
 *
 * Ce fichier n'a NI `jsdom` NI `@testing-library/react` (aucun des deux n'est
 * installe — voir `vitest.config.ts` et `Tableau.test.tsx`, meme discipline).
 * On prouve donc les DECISIONS par des fonctions pures extraites du composant,
 * comme `navigationGrille.ts` le fait deja pour `Tableau.tsx`. Ce que cela ne
 * peut PAS prouver : que `element.focus()` deplace reellement le focus dans un
 * navigateur. Cette moitie-la reste verifiee a la main (voir le rapport de
 * livraison).
 */

type LigneTest = { readonly cle: string };

const LIGNES: readonly LigneTest[] = [{ cle: 'a' }, { cle: 'b' }, { cle: 'c' }];

describe('actionSurEntree — Ctrl+Entrée doit s’effacer devant le raccourci d’enregistrement', () => {
  it('ignore toute touche qui n’est pas Entrée', () => {
    expect(actionSurEntree({ key: 'Tab', ctrlKey: false, metaKey: false }, 'a', LIGNES)).toEqual({
      type: 'ignorer',
    });
  });

  it('Entrée seule avance vers la ligne suivante', () => {
    expect(actionSurEntree({ key: 'Enter', ctrlKey: false, metaKey: false }, 'a', LIGNES)).toEqual({
      type: 'ligne_suivante',
      cle: 'b',
    });
  });

  it('Entrée seule sur la dernière ligne demande une ligne nouvelle', () => {
    expect(actionSurEntree({ key: 'Enter', ctrlKey: false, metaKey: false }, 'c', LIGNES)).toEqual({
      type: 'nouvelle_ligne',
    });
  });

  it('DÉFAUT CORRIGÉ : Ctrl+Entrée depuis la DERNIÈRE ligne ne doit RIEN faire ici', () => {
    // Avant le correctif, `surEntree` agissait sur Ctrl+Entrée exactement comme
    // sur Entrée seule : depuis la dernière ligne, il ajoutait une ligne vide
    // EN MÊME TEMPS que le formulaire tentait d'enregistrer (gestionnaire du
    // <form>, plus bas dans SaisieReception.tsx) — visible dès que cette ligne
    // échouait encore la validation (ex. ni numéro de lot ni DLC saisis), quel
    // que soit le champ d'où partait la frappe (« Prix payé » y compris, mais
    // pas seulement lui : aucun champ n'a de traitement différent des autres).
    expect(actionSurEntree({ key: 'Enter', ctrlKey: true, metaKey: false }, 'c', LIGNES)).toEqual({
      type: 'ignorer',
    });
  });

  it('même règle pour Ctrl+Entrée depuis une ligne du milieu (pas seulement la dernière)', () => {
    expect(actionSurEntree({ key: 'Enter', ctrlKey: true, metaKey: false }, 'a', LIGNES)).toEqual({
      type: 'ignorer',
    });
  });

  it('même règle pour Cmd+Entrée (metaKey, clavier Mac)', () => {
    expect(actionSurEntree({ key: 'Enter', ctrlKey: false, metaKey: true }, 'a', LIGNES)).toEqual({
      type: 'ignorer',
    });
  });
});

describe('cleAFocaliserApresRetrait — continuer à saisir là où l’erreur vient d’être corrigée', () => {
  it('retirer une ligne du MILIEU focalise celle qui glisse à sa place (la suivante)', () => {
    const lignesApres: readonly LigneTest[] = [{ cle: 'a' }, { cle: 'c' }];
    expect(cleAFocaliserApresRetrait(LIGNES, 'b', lignesApres)).toBe('c');
  });

  it('retirer la DERNIÈRE ligne focalise la précédente, désormais dernière', () => {
    const lignesApres: readonly LigneTest[] = [{ cle: 'a' }, { cle: 'b' }];
    expect(cleAFocaliserApresRetrait(LIGNES, 'c', lignesApres)).toBe('b');
  });

  it('retirer la PREMIÈRE ligne focalise celle qui glisse en tête', () => {
    const lignesApres: readonly LigneTest[] = [{ cle: 'b' }, { cle: 'c' }];
    expect(cleAFocaliserApresRetrait(LIGNES, 'a', lignesApres)).toBe('b');
  });

  it('retirer l’unique ligne focalise la ligne vierge de remplacement', () => {
    const uneLigne: readonly LigneTest[] = [{ cle: 'seule' }];
    const remplacement: readonly LigneTest[] = [{ cle: 'nouvelle' }];
    expect(cleAFocaliserApresRetrait(uneLigne, 'seule', remplacement)).toBe('nouvelle');
  });
});

describe('valeursFormulaireVide — ce que le formulaire redevient après un enregistrement réussi', () => {
  const ligneVierge = {
    cle: 'x',
    ingredientId: '',
    quantite: '',
    prix: '',
    numeroLot: '',
    dlc: '',
  };

  it('vide tous les champs d’en-tête et repart avec une seule ligne, pour une réception', () => {
    expect(valeursFormulaireVide('reception', '2026-07-30', ligneVierge)).toEqual({
      fournisseurId: '',
      dateReception: '2026-07-30',
      commandeId: '',
      numeroBonLivraison: '',
      notes: '',
      lignes: [ligneVierge],
    });
  });

  it('remet la note « Inventaire d’ouverture » par défaut pour un inventaire', () => {
    expect(valeursFormulaireVide('inventaire', '2026-07-30', ligneVierge).notes).toBe(
      "Inventaire d'ouverture",
    );
  });
});

/**
 * Second défaut de docs/27-PARCOURS-REJOUE.md §3.d (01/08/2026) : une DLC
 * déjà dépassée à la date de réception (typiquement une faute de frappe sur
 * l'année) entrait en stock sans un mot. Cette fonction décide QUAND
 * l'avertir — la PHRASE elle-même est testée dans
 * `packages/core/src/stock.test.ts` (`avertissementDlcDejaDepassee`).
 */
describe('avertissementDlcSaisieDejaDepassee — alerte non bloquante à la saisie', () => {
  it('reproduit le cas réel : DLC 01/01/2026 saisie, réception du 01/08/2026', () => {
    const avertissement = avertissementDlcSaisieDejaDepassee(
      '2026-01-01',
      null,
      '2026-08-01',
      'Café moulu',
    );
    expect(avertissement).not.toBeNull();
    expect(avertissement).toContain('Café moulu');
  });

  it('utilise la DLC DÉDUITE quand rien n’est saisi', () => {
    // La date de réception saisie est elle-même ancienne (rattrapage) : la
    // DLC déduite de la durée de conservation peut donc, elle aussi, être
    // déjà dépassée à cette date.
    const avertissement = avertissementDlcSaisieDejaDepassee(
      '',
      '2026-01-01',
      '2026-08-01',
      'Lait entier',
    );
    expect(avertissement).not.toBeNull();
  });

  it('la DLC SAISIE l’emporte sur la DLC déduite quand les deux existent', () => {
    // Déduite : dans le futur (pas d'avertissement) ; saisie : déjà dépassée.
    // Si la fonction se trompait de source, ce test échouerait.
    const avertissement = avertissementDlcSaisieDejaDepassee(
      '2026-01-01',
      '2027-01-01',
      '2026-08-01',
      'Ingrédient',
    );
    expect(avertissement).not.toBeNull();
  });

  it('rend null sans ingrédient choisi — rien à nommer dans le message', () => {
    expect(
      avertissementDlcSaisieDejaDepassee('2026-01-01', null, '2026-08-01', undefined),
    ).toBeNull();
  });

  it('rend null sans date de réception saisie', () => {
    expect(avertissementDlcSaisieDejaDepassee('2026-01-01', null, '', 'Ingrédient')).toBeNull();
  });

  it('rend null sans aucune DLC (ni saisie, ni déduite)', () => {
    expect(avertissementDlcSaisieDejaDepassee('', null, '2026-08-01', 'Ingrédient')).toBeNull();
  });

  it('rend null quand la DLC effective n’est pas encore dépassée', () => {
    expect(
      avertissementDlcSaisieDejaDepassee('2027-01-01', null, '2026-08-01', 'Ingrédient'),
    ).toBeNull();
  });
});
