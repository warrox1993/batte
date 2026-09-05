import { describe, expect, it } from 'vitest';
import {
  ageJours,
  anneeCivile,
  ecartCalendaireJours,
  jourDeSemaine,
  occurrencesJourSemaine,
} from './calendrier.js';

describe('ecartCalendaireJours', () => {
  it('vaut 0 sur le même jour, années différentes', () => {
    expect(ecartCalendaireJours('2026-02-02', '2023-02-02')).toBe(0);
  });

  it('mesure un écart simple dans la même moitié d’année', () => {
    expect(ecartCalendaireJours('2026-07-27', '2025-07-20')).toBe(7);
  });

  it('boucle autour du nouvel an : 30 décembre et 2 janvier sont proches', () => {
    expect(ecartCalendaireJours('2026-01-02', '2025-12-30')).toBe(3);
  });

  it('est symétrique', () => {
    expect(ecartCalendaireJours('2026-03-10', '2020-01-05')).toBe(
      ecartCalendaireJours('2020-01-05', '2026-03-10'),
    );
  });

  it('rend NaN sur une date illisible plutôt que de mentir sur un écart nul', () => {
    expect(Number.isNaN(ecartCalendaireJours('pas-une-date', '2026-07-27'))).toBe(true);
  });
});

describe('ageJours', () => {
  it('est positif quand l’observation précède la cible', () => {
    expect(ageJours('2026-07-27', '2026-07-20')).toBeCloseTo(7, 6);
  });

  it('est négatif quand l’observation est future', () => {
    expect(ageJours('2026-07-20', '2026-07-27')).toBeCloseTo(-7, 6);
  });

  it('rend NaN sur une date illisible', () => {
    expect(Number.isNaN(ageJours('2026-07-27', 'xxx'))).toBe(true);
  });
});

describe('anneeCivile', () => {
  it('extrait l’année', () => {
    expect(anneeCivile('2024-02-02')).toBe(2024);
  });
});

describe('jourDeSemaine', () => {
  it('identifie un dimanche connu (2 août 2026)', () => {
    // Marché type de La Batte, dimanche — vérifié : le 2 août 2026 est un dimanche.
    expect(jourDeSemaine('2026-08-02')).toBe(0);
  });

  it('identifie un jeudi connu', () => {
    expect(jourDeSemaine('2026-07-30')).toBe(4);
  });

  it('est déterministe : même entrée, même sortie', () => {
    expect(jourDeSemaine('2026-07-27')).toBe(jourDeSemaine('2026-07-27'));
  });
});

describe('occurrencesJourSemaine', () => {
  it('trouve tous les dimanches sur un horizon de 3 semaines, en partant d’un dimanche', () => {
    // 2026-08-02 est un dimanche (vérifié ci-dessus). Fenêtre demi-ouverte
    // [depuis, depuis + horizonJours[ : à 22 jours, le 4e dimanche (jour 21)
    // entre encore dans la fenêtre.
    expect(occurrencesJourSemaine(0, '2026-08-02', 22)).toEqual([
      '2026-08-02',
      '2026-08-09',
      '2026-08-16',
      '2026-08-23',
    ]);
    // À 21 jours pile, ce 4e dimanche sort de la fenêtre.
    expect(occurrencesJourSemaine(0, '2026-08-02', 21)).toEqual([
      '2026-08-02',
      '2026-08-09',
      '2026-08-16',
    ]);
  });

  it('avance jusqu’à la première occurrence quand `depuis` n’est pas le bon jour', () => {
    // 2026-07-30 est un jeudi : le premier dimanche suivant est le 2 août.
    expect(occurrencesJourSemaine(0, '2026-07-30', 10)).toEqual(['2026-08-02']);
  });

  it('inclut `depuis` lui-même quand il tombe déjà sur le bon jour', () => {
    expect(occurrencesJourSemaine(4, '2026-07-30', 1)).toEqual(['2026-07-30']);
  });

  it('rend un tableau vide sur un horizon nul, négatif ou non fini', () => {
    expect(occurrencesJourSemaine(0, '2026-08-02', 0)).toEqual([]);
    expect(occurrencesJourSemaine(0, '2026-08-02', -5)).toEqual([]);
    expect(occurrencesJourSemaine(0, '2026-08-02', Number.NaN)).toEqual([]);
  });

  it('boucle sur le nouvel an sans erreur', () => {
    // 2025-12-30 est un mardi ; le dimanche suivant est le 2026-01-04.
    expect(occurrencesJourSemaine(0, '2025-12-30', 10)).toEqual(['2026-01-04']);
  });
});
