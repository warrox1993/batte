import { describe, expect, it } from 'vitest';
import { compteAccorde } from './pluriel';

/**
 * `compteAccorde` corrige le défaut du rejeu de parcours du 31/07/2026
 * (docs/27, §3.f) : « 1 NON-CONFORMITÉS », « 1 RELEVÉS ». La règle testée ici
 * est la règle FRANÇAISE, à l'inverse de l'anglais : 0 ET 1 sont singuliers,
 * seul 2 et plus prend le pluriel.
 */
describe('compteAccorde — 0 et 1 au singulier, 2 et plus au pluriel (règle FRANÇAISE)', () => {
  it('accorde au SINGULIER pour 0 — contrairement à l’anglais où 0 est pluriel', () => {
    expect(compteAccorde(0, 'relevé', 'relevés')).toBe('0 relevé');
  });

  it('accorde au singulier pour 1', () => {
    expect(compteAccorde(1, 'relevé', 'relevés')).toBe('1 relevé');
  });

  it('accorde au pluriel à partir de 2', () => {
    expect(compteAccorde(2, 'relevé', 'relevés')).toBe('2 relevés');
    expect(compteAccorde(17, 'relevé', 'relevés')).toBe('17 relevés');
  });

  it('accepte une forme plurielle irrégulière fournie explicitement (lieu/lieux)', () => {
    expect(compteAccorde(0, 'lieu', 'lieux')).toBe('0 lieu');
    expect(compteAccorde(1, 'lieu', 'lieux')).toBe('1 lieu');
    expect(compteAccorde(3, 'lieu', 'lieux')).toBe('3 lieux');
  });

  it('accorde un groupe de mots entier, y compris un adjectif qui s’accorde aussi', () => {
    expect(compteAccorde(0, 'prévision archivée', 'prévisions archivées')).toBe(
      '0 prévision archivée',
    );
    expect(compteAccorde(2, 'prévision archivée', 'prévisions archivées')).toBe(
      '2 prévisions archivées',
    );
  });
});
