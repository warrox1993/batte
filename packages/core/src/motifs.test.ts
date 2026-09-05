/**
 * Tests du catalogue des motifs (D-013) : la source unique des codes motifs
 * qui repond a « ou fuit la matiere ? » (docs/07 §6.8 rang 9).
 *
 * `definitionMotif` a des appelants de production (routes/stock.ts revalide un
 * code saisi, services/mouvements.ts l'utilise pour libeller une
 * non-conformite), mais aucun test ne le couvrait avant ce fichier.
 *
 * `motifsPour` alimente les listes deroulantes de motif des ecrans de saisie
 * de stock (`apps/web/src/saisie-stock/` : `annulation.ts`, `DetailLot.tsx`,
 * `SaisieSortie.tsx`). C'est le seul endroit ou ces libelles sont produits :
 * les reecrire a la main dans le navigateur violerait la regle
 * d'architecture n°1. Un inventaire de code mort qui declarerait cette
 * fonction sans appelant casserait ces trois ecrans.
 */

import { describe, expect, it } from 'vitest';
import { CATALOGUE_MOTIFS, definitionMotif, motifsPour, type CategorieMotif } from './motifs.js';

describe('definitionMotif', () => {
  it('retrouve la definition complete d’un code existant', () => {
    expect(definitionMotif('DLC_DEPASSEE')).toEqual({
      code: 'DLC_DEPASSEE',
      libelle: 'Jeté pour DLC dépassée',
      categorie: 'perte',
    });
  });

  it('rend undefined sur un code inconnu, plutot que d’inventer un libelle', () => {
    expect(definitionMotif('CODE_INEXISTANT')).toBeUndefined();
  });

  it('est sensible a la casse : une variante mal saisie ne se resout pas par hasard', () => {
    expect(definitionMotif('dlc_depassee')).toBeUndefined();
  });

  it('rend undefined sur une chaine vide', () => {
    expect(definitionMotif('')).toBeUndefined();
  });

  it('retrouve chaque code du catalogue, sans exception', () => {
    for (const attendu of CATALOGUE_MOTIFS) {
      expect(definitionMotif(attendu.code)).toEqual(attendu);
    }
  });
});

describe('motifsPour', () => {
  it('ne rend que les motifs de la categorie demandee', () => {
    const motifs = motifsPour('perte');
    expect(motifs.length).toBeGreaterThan(0);
    for (const motif of motifs) {
      expect(motif.categorie).toBe('perte');
    }
  });

  it('rend les six motifs de perte, dans l’ordre du catalogue', () => {
    expect(motifsPour('perte').map((m) => m.code)).toEqual([
      'CASSE_CUISSON',
      'FOND_BASSINE',
      'SURDOSAGE',
      'CASSE_TRANSPORT',
      'DLC_DEPASSEE',
      'NON_CONFORME',
    ]);
  });

  it('rend les deux sorties volontaires', () => {
    expect(motifsPour('sortie_volontaire').map((m) => m.code)).toEqual(['PERSO', 'DON']);
  });

  it('rend les deux ajustements', () => {
    expect(motifsPour('ajustement').map((m) => m.code)).toEqual([
      'INVENTAIRE_ECART',
      'ERREUR_SAISIE',
    ]);
  });

  it('rend les trois changements de statut de lot', () => {
    expect(motifsPour('statut_lot').map((m) => m.code)).toEqual([
      'QUARANTAINE_DOUTE',
      'LEVEE_QUARANTAINE',
      'RAPPEL_FOURNISSEUR',
    ]);
  });

  it('rend un tableau vide sur une categorie inconnue du catalogue, jamais une erreur', () => {
    // Aucune des quatre categories declarees n'est vide aujourd'hui : ce test
    // verifie le comportement de `.filter()` sur une categorie qui ne
    // correspondrait a aucun motif, sans faire planter l'ecran qui l'appelle.
    expect(motifsPour('categorie_inexistante' as CategorieMotif)).toEqual([]);
  });

  it('les quatre categories couvrent le catalogue entier, sans recouvrement ni perte', () => {
    const categories: readonly CategorieMotif[] = [
      'perte',
      'sortie_volontaire',
      'ajustement',
      'statut_lot',
    ];
    const total = categories.reduce((somme, categorie) => somme + motifsPour(categorie).length, 0);
    expect(total).toBe(CATALOGUE_MOTIFS.length);
  });

  it('rend un nouveau tableau a chaque appel : filtrer le resultat ne mute pas le catalogue', () => {
    const premier = motifsPour('perte');
    const second = motifsPour('perte');
    expect(premier).not.toBe(second);
    expect(premier).toEqual(second);
  });
});
