import { describe, expect, it } from 'vitest';
import type { Fournisseur } from './contrats/referentiel.js';
import { fournisseursProposables } from './fournisseurs.js';

/**
 * Fabrique un `Fournisseur` complet : le contrat `schemaFournisseur`
 * (`./contrats/referentiel.ts`) exige tous ces champs, un objet partiel
 * romprait le typage que `exactOptionalPropertyTypes: true` impose sur tout
 * le dépôt.
 */
function fournisseur(champs: Partial<Fournisseur> = {}): Fournisseur {
  return {
    id: 'f-test',
    nom: 'Moulin de la Meuse',
    type: 'moulin',
    email: 'contact@moulin-meuse.example',
    telephone: null,
    adresse: null,
    delaiLivraisonJours: 3,
    francoDePortCents: null,
    commandeMinimumCents: null,
    notes: null,
    actif: true,
    nbConditionnements: 0,
    ...champs,
  };
}

/**
 * `fournisseursProposables` — DÉPLACÉ depuis `apps/web/src/pages/Fournisseurs.tsx`
 * (mission « garde-fou fournisseur système : de l'écran au service, puis son
 * vrai foyer », 31/07/2026), avec ses tests — précédemment dans
 * `Fournisseurs.test.tsx`.
 *
 * Ces trois premiers tests reproduisent EXACTEMENT les trois défauts mesurés
 * dans le dépôt avant la mission qui a introduit cette fonction
 * (« deux restes de la chaîne d'achat », 31/07/2026) :
 *  - `Factures.tsx` ne testait que `actif` → une facture restait saisissable
 *    au nom du fournisseur SYSTÈME ;
 *  - `Economies.tsx` ne testait que `type` → un fournisseur COMMERCIAL
 *    désactivé restait proposable pour une économie neuve ;
 *  - `Ingredients.tsx` avait déjà les deux conditions (non-régression).
 *
 * CE QUE CES TESTS NE PROUVENT PAS : que `Factures.tsx`, `Ingredients.tsx` et
 * `Economies.tsx` appellent bien cette fonction au rendu — ce paquet ne rend
 * aucun composant, par construction (CLAUDE.md §3 règle 1). Le câblage se
 * prouve côté `apps/web`, dans les tests de ces écrans.
 */
describe('fournisseursProposables — actif ET commercial, les deux conditions', () => {
  it('exclut le fournisseur SYSTÈME même actif (défaut mesuré sur Factures.tsx)', () => {
    const resultat = fournisseursProposables([
      fournisseur({ id: 'sys', type: 'systeme', actif: true }),
      fournisseur({ id: 'com', type: 'moulin', actif: true }),
    ]);
    expect(resultat.map((f) => f.id)).toEqual(['com']);
  });

  it('exclut un fournisseur COMMERCIAL désactivé (défaut mesuré sur Economies.tsx)', () => {
    const resultat = fournisseursProposables([
      fournisseur({ id: 'inactif', type: 'grossiste', actif: false }),
      fournisseur({ id: 'actif', type: 'grossiste', actif: true }),
    ]);
    expect(resultat.map((f) => f.id)).toEqual(['actif']);
  });

  it('garde un fournisseur commercial actif (non-régression, comportement déjà correct d’Ingredients.tsx)', () => {
    const resultat = fournisseursProposables([
      fournisseur({ id: 'ferme', type: 'ferme', actif: true }),
    ]);
    expect(resultat.map((f) => f.id)).toEqual(['ferme']);
  });

  it('rend un tableau vide sans lever, sur une liste vide', () => {
    expect(fournisseursProposables([])).toEqual([]);
  });
});
