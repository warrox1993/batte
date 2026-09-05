import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import type { ObservationSession } from './baseline.js';
import { tendanceBp, type ConfigTendance } from './tendance.js';

const CONFIG: ConfigTendance = {
  sessionsMinimum: 10,
  fenetreSessions: 12,
  borneBp: 3000, // ±30 %, docs/03
};

function sessionNeutre(dateSession: string, crepesVendues: number): ObservationSession {
  return {
    dateSession,
    crepesVendues,
    meteoBp: BASE_POINTS,
    evenementBp: BASE_POINTS,
    saisonBp: BASE_POINTS,
  };
}

function jourPlus(jour: string, jours: number): string {
  return new Date(Date.parse(`${jour}T12:00:00Z`) + jours * 86_400_000).toISOString().slice(0, 10);
}

describe('tendanceBp — démarrage à froid', () => {
  it('reste neutre tant que moins de dix sessions antérieures existent (docs/03)', () => {
    const observations = Array.from({ length: 9 }, (_, i) =>
      sessionNeutre(jourPlus('2026-01-04', 7 * i), 100 + i * 5),
    );
    const cible = jourPlus('2026-01-04', 7 * 9);
    const resultat = tendanceBp(observations, cible, CONFIG);
    expect(resultat.actif).toBe(false);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
    expect(resultat.explication).toBeNull();
  });

  it('ignore les sessions postérieures à la cible (pas de fuite du futur)', () => {
    // Dix sessions croissantes avant la cible, MAIS une seule "future" très
    // forte ne doit rien changer : elle n'existait pas au moment de decider.
    const avant = Array.from({ length: 10 }, (_, i) =>
      sessionNeutre(jourPlus('2026-01-04', 7 * i), 100),
    );
    const cible = jourPlus('2026-01-04', 7 * 10);
    const futur = sessionNeutre(jourPlus('2026-01-04', 7 * 20), 1000);
    const sansFutur = tendanceBp(avant, cible, CONFIG);
    const avecFutur = tendanceBp([...avant, futur], cible, CONFIG);
    expect(avecFutur).toEqual(sansFutur);
  });
});

describe('tendanceBp — activation', () => {
  it('détecte une croissance et extrapole un facteur au-dessus du neutre', () => {
    // Ventes strictement croissantes sur 12 sessions.
    const observations = Array.from({ length: 12 }, (_, i) =>
      sessionNeutre(jourPlus('2026-01-04', 7 * i), 100 + i * 10),
    );
    const cible = jourPlus('2026-01-04', 7 * 12);
    const resultat = tendanceBp(observations, cible, CONFIG);
    expect(resultat.actif).toBe(true);
    expect(resultat.facteurBp).toBeGreaterThan(BASE_POINTS);
    expect(resultat.explication).toContain('croissance');
  });

  it('détecte une érosion et extrapole un facteur sous le neutre', () => {
    const observations = Array.from({ length: 12 }, (_, i) =>
      sessionNeutre(jourPlus('2026-01-04', 7 * i), 200 - i * 10),
    );
    const cible = jourPlus('2026-01-04', 7 * 12);
    const resultat = tendanceBp(observations, cible, CONFIG);
    expect(resultat.actif).toBe(true);
    expect(resultat.facteurBp).toBeLessThan(BASE_POINTS);
    expect(resultat.explication).toContain('érosion');
  });

  it('plafonne à ±30 % même sur une série extrêmement chanceuse', () => {
    // Ventes qui décuplent sur 12 sessions : la pente brute dépasserait
    // largement 30 %, la borne doit l'écrêter.
    const observations = Array.from({ length: 12 }, (_, i) =>
      sessionNeutre(jourPlus('2026-01-04', 7 * i), 10 * 2 ** i),
    );
    const cible = jourPlus('2026-01-04', 7 * 12);
    const resultat = tendanceBp(observations, cible, CONFIG);
    expect(resultat.actif).toBe(true);
    expect(resultat.facteurBp).toBeLessThanOrEqual(13_000);
    expect(resultat.explication).toContain('plafonnée à ±30 %');
  });

  it('reste stable (facteur neutre) sur un historique sans tendance', () => {
    const observations = Array.from({ length: 12 }, (_, i) =>
      sessionNeutre(jourPlus('2026-01-04', 7 * i), 150),
    );
    const cible = jourPlus('2026-01-04', 7 * 12);
    const resultat = tendanceBp(observations, cible, CONFIG);
    expect(resultat.actif).toBe(true);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
  });

  it('est déterministe', () => {
    const observations = Array.from({ length: 12 }, (_, i) =>
      sessionNeutre(jourPlus('2026-01-04', 7 * i), 100 + i * 10),
    );
    const cible = jourPlus('2026-01-04', 7 * 12);
    expect(tendanceBp(observations, cible, CONFIG)).toEqual(
      tendanceBp(observations, cible, CONFIG),
    );
  });
});
