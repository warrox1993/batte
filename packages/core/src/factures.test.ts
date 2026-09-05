import { describe, expect, it } from 'vitest';
import { ErreurMetier } from './erreurs.js';
import { ecartPrix, ventilerFrais } from './factures.js';

describe('ventilerFrais', () => {
  it('repartit proportionnellement a la base, methode valeur', () => {
    const parts = ventilerFrais(1000, [
      { lotId: 'a', base: 3000 },
      { lotId: 'b', base: 1000 },
    ]);
    // a : 75 % de 1000 = 750, b : 25 % = 250.
    expect(parts).toEqual([
      { lotId: 'a', montantCents: 750 },
      { lotId: 'b', montantCents: 250 },
    ]);
  });

  it('la somme des parts est TOUJOURS exactement egale au montant a ventiler, meme avec un arrondi difficile', () => {
    // 3 lots de base egale : 1000 / 3 = 333,33... par lot, un naif perd ou gagne un centime.
    const parts = ventilerFrais(1000, [
      { lotId: 'a', base: 1 },
      { lotId: 'b', base: 1 },
      { lotId: 'c', base: 1 },
    ]);
    const somme = parts.reduce((s, p) => s + p.montantCents, 0);
    expect(somme).toBe(1000);
    // Les deux premiers arrondissent normalement, le dernier absorbe le reste.
    expect(parts[0]!.montantCents).toBe(333);
    expect(parts[1]!.montantCents).toBe(333);
    expect(parts[2]!.montantCents).toBe(334);
  });

  it('un seul lot recoit la totalite, sans arrondi possible', () => {
    const parts = ventilerFrais(1234, [{ lotId: 'unique', base: 999 }]);
    expect(parts).toEqual([{ lotId: 'unique', montantCents: 1234 }]);
  });

  it('rend un tableau vide sans lot a ventiler', () => {
    expect(ventilerFrais(1000, [])).toEqual([]);
  });

  it('leve une ErreurMetier si la base totale est nulle', () => {
    expect(() => ventilerFrais(1000, [{ lotId: 'a', base: 0 }])).toThrow(ErreurMetier);
  });

  it('methode quantite : repartit sur la quantite plutot que sur la valeur', () => {
    // Deux lots de quantites tres inegales : la base porte la quantite recue,
    // pas le montant paye — c'est a l'appelant de choisir laquelle passer.
    const parts = ventilerFrais(900, [
      { lotId: 'gros', base: 8000 },
      { lotId: 'petit', base: 1000 },
    ]);
    expect(parts).toEqual([
      { lotId: 'gros', montantCents: 800 },
      { lotId: 'petit', montantCents: 100 },
    ]);
  });
});

describe('ecartPrix', () => {
  it('rend un ecart positif quand la facture reclame plus que le bon de livraison', () => {
    expect(ecartPrix(4500, 4000)).toBe(500);
  });

  it('rend un ecart negatif quand la facture est INFERIEURE au bon de livraison (remise)', () => {
    expect(ecartPrix(3800, 4000)).toBe(-200);
  });

  it('rend zero quand la facture confirme exactement le bon de livraison', () => {
    expect(ecartPrix(4000, 4000)).toBe(0);
  });
});
