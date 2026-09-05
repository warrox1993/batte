import { describe, expect, it } from 'vitest';
import { ErreurMetier } from './erreurs.js';
import { convertir, estUnite, formaterQuantite, libelleUnite } from './unites.js';

describe('convertir', () => {
  it('est l identite pour une meme unite', () => {
    expect(convertir(1450, 'g', 'g')).toBe(1450);
    expect(convertir(2400, 'ml', 'ml')).toBe(2400);
    expect(convertir(17, 'piece', 'piece')).toBe(17);
  });

  it('convertit des millilitres de lait en grammes via la densite', () => {
    // Lait entier : 1,03 g/ml. 240 ml -> 247 g.
    expect(convertir(240, 'ml', 'g', 1.03)).toBe(247);
  });

  it('convertit des grammes en millilitres via la densite', () => {
    expect(convertir(247, 'g', 'ml', 1.03)).toBe(240);
  });

  it('fait un aller-retour stable a l arrondi pres', () => {
    const grammes = convertir(2000, 'ml', 'g', 1.03);
    expect(convertir(grammes, 'g', 'ml', 1.03)).toBe(2000);
  });

  it('rend toujours un entier', () => {
    expect(Number.isInteger(convertir(333, 'ml', 'g', 1.03))).toBe(true);
  });

  it('refuse de convertir sans densite plutot que de supposer 1 g/ml', () => {
    // Supposer l'eau serait faux pour l'huile (0,92) comme pour le sirop (1,35),
    // et l'erreur se propagerait jusqu'au cout matiere.
    expect(() => convertir(240, 'ml', 'g')).toThrow(ErreurMetier);
    expect(() => convertir(240, 'ml', 'g', null)).toThrow(ErreurMetier);
    expect(() => convertir(240, 'ml', 'g', 0)).toThrow(ErreurMetier);
  });

  it('refuse toute conversion impliquant des pieces', () => {
    expect(() => convertir(2, 'piece', 'g', 60)).toThrow(ErreurMetier);
    expect(() => convertir(120, 'g', 'piece', 60)).toThrow(ErreurMetier);
  });

  it('porte un code d erreur exploitable par l interface', () => {
    try {
      convertir(240, 'ml', 'g');
      expect.unreachable('la conversion aurait du lever');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('densite_manquante');
    }
  });
});

describe('formaterQuantite', () => {
  it('bascule en kilogrammes au-dela de 1000 g', () => {
    expect(formaterQuantite(4200, 'g')).toBe('4,2 kg');
    expect(formaterQuantite(999, 'g')).toBe('999 g');
    expect(formaterQuantite(1000, 'g')).toBe('1,0 kg');
  });

  it('bascule en litres au-dela de 1000 ml', () => {
    expect(formaterQuantite(12_000, 'ml')).toBe('12,0 L');
    expect(formaterQuantite(500, 'ml')).toBe('500 ml');
  });

  it('accorde le pluriel des pieces', () => {
    expect(formaterQuantite(1, 'piece')).toBe('1 pièce');
    expect(formaterQuantite(17, 'piece')).toBe('17 pièces');
    expect(formaterQuantite(0, 'piece')).toBe('0 pièce');
  });

  it('gere une quantite negative (mouvement de sortie)', () => {
    expect(formaterQuantite(-4200, 'g')).toBe('-4,2 kg');
  });
});

describe('estUnite', () => {
  it('reconnait les trois unites de reference', () => {
    expect(estUnite('g')).toBe(true);
    expect(estUnite('ml')).toBe(true);
    expect(estUnite('piece')).toBe(true);
  });

  it('rejette une unite inconnue', () => {
    expect(estUnite('kg')).toBe(false);
    expect(estUnite('')).toBe(false);
  });
});

describe('libelleUnite', () => {
  it('donne un libelle lisible pour chaque unite', () => {
    expect(libelleUnite('g')).toBe('grammes');
    expect(libelleUnite('ml')).toBe('millilitres');
    expect(libelleUnite('piece')).toBe('pièces');
  });
});
