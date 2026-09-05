import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_SYNONYMES_INGREDIENTS,
  ingredientCorrespondALaRecherche,
  normaliserTexteRecherche,
} from './recherche-ingredients.js';

describe('normaliserTexteRecherche', () => {
  it('met en minuscules', () => {
    expect(normaliserTexteRecherche('FARINE')).toBe('farine');
  });

  it('retire les accents', () => {
    expect(normaliserTexteRecherche('Châtaigne')).toBe('chataigne');
    expect(normaliserTexteRecherche('sucre vanillé')).toBe('sucre vanille');
  });

  it('réduit la ligature œ à "oe"', () => {
    expect(normaliserTexteRecherche('Œufs')).toBe('oeufs');
    expect(normaliserTexteRecherche('œufs')).toBe('oeufs');
  });

  it('réduit la ligature æ à "ae"', () => {
    // Ligature rare en français courant, mais le même mécanisme que œ :
    // testée pour la même raison, pas parce qu'un ingrédient l'utilise.
    expect(normaliserTexteRecherche('caæsium')).toBe('caaesium');
  });

  it('recolle les espaces multiples et retire les espaces de bord', () => {
    expect(normaliserTexteRecherche('  Farine    de   froment ')).toBe('farine de froment');
  });

  it('recherche vide reste vide apres normalisation', () => {
    expect(normaliserTexteRecherche('   ')).toBe('');
  });
});

describe('CATALOGUE_SYNONYMES_INGREDIENTS', () => {
  it('contient le groupe vergeoise / cassonade cité par la fiche 09', () => {
    const contientVergeoiseEtCassonade = CATALOGUE_SYNONYMES_INGREDIENTS.some(
      (groupe) =>
        groupe.some((m) => normaliserTexteRecherche(m) === 'vergeoise') &&
        groupe.some((m) => normaliserTexteRecherche(m) === 'cassonade'),
    );
    expect(contientVergeoiseEtCassonade).toBe(true);
  });

  it('chaque groupe contient au moins deux noms (sinon ce n est pas un synonyme)', () => {
    for (const groupe of CATALOGUE_SYNONYMES_INGREDIENTS) {
      expect(groupe.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('ingredientCorrespondALaRecherche', () => {
  it('une recherche vide fait correspondre tout ingrédient', () => {
    expect(ingredientCorrespondALaRecherche('Farine de froment T55', '')).toBe(true);
    expect(ingredientCorrespondALaRecherche('Farine de froment T55', '   ')).toBe(true);
  });

  it('correspondance directe, insensible a la casse et aux accents', () => {
    expect(ingredientCorrespondALaRecherche('Farine de froment T55', 'FROMENT')).toBe(true);
    expect(ingredientCorrespondALaRecherche('Sucre vanillé', 'vanille')).toBe(true);
  });

  it('correspondance directe sur un fragment, pas seulement le mot entier', () => {
    expect(ingredientCorrespondALaRecherche('Farine de froment T55', 'T55')).toBe(true);
  });

  it("l'exemple exact de la fiche 09 : chercher cassonade trouve la vergeoise", () => {
    expect(ingredientCorrespondALaRecherche('Vergeoise blonde', 'cassonade')).toBe(true);
  });

  it('la correspondance par synonyme est symétrique', () => {
    expect(ingredientCorrespondALaRecherche('Cassonade brute', 'vergeoise')).toBe(true);
  });

  it('sarrasin et blé noir désignent la même farine (recette R2)', () => {
    expect(ingredientCorrespondALaRecherche('Farine de sarrasin', 'blé noir')).toBe(true);
    expect(ingredientCorrespondALaRecherche('Farine de blé noir', 'sarrasin')).toBe(true);
  });

  it('la ligature œ ne bloque pas la correspondance avec "oeufs"', () => {
    expect(ingredientCorrespondALaRecherche('Œufs entiers', 'oeufs')).toBe(true);
  });

  it('un mot sans rapport ne correspond pas', () => {
    expect(ingredientCorrespondALaRecherche('Farine de froment T55', 'chocolat')).toBe(false);
  });

  it('un synonyme ne fait pas remonter un ingrédient sans rapport', () => {
    // "vergeoise" désigne le groupe des sucres roux : un ingrédient de farine
    // ne doit pas remonter seulement parce qu'un groupe existe quelque part.
    expect(ingredientCorrespondALaRecherche('Farine de froment T55', 'cassonade')).toBe(false);
  });

  it('un pot de sirop d’érable revendu se retrouve via son synonyme courant', () => {
    expect(ingredientCorrespondALaRecherche("Sirop d'érable premium", 'sirop erable')).toBe(true);
  });
});
