import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import type { ConditionsMeteo } from './meteo.js';
import {
  ecartMeteoPrevueRealisee,
  type ConfigEcartMeteo,
  type PaireMeteo,
} from './ecart-meteo-prevue-realisee.js';

const CONFIG: ConfigEcartMeteo = {
  pairesMinimum: 8,
  echelleTemperatureC: 3,
  horizonReferenceJours: 7,
  inflationMaxBp: 20_000,
};

function conditions(temperatureC: number): ConditionsMeteo {
  return { temperatureC, precipitationsMm: 0, ventKmh: 10, couvertureNuageuseBp: 5000 };
}

function paire(ecartC: number): PaireMeteo {
  return { prevue: conditions(15), reelle: conditions(15 + ecartC) };
}

describe('ecartMeteoPrevueRealisee — démarrage à froid', () => {
  it('reste inactif sous le nombre minimal de paires', () => {
    const paires = Array.from({ length: 5 }, (_, i) => paire(i % 2 === 0 ? 2 : -2));
    const resultat = ecartMeteoPrevueRealisee(paires, 7, CONFIG);
    expect(resultat.actif).toBe(false);
    expect(resultat.inflationSigmaBp).toBe(BASE_POINTS);
    expect(resultat.explication).toBeNull();
  });

  it('reste inactif sur un horizon non fini ou nul', () => {
    const paires = Array.from({ length: 10 }, (_, i) => paire(i % 2 === 0 ? 2 : -2));
    expect(ecartMeteoPrevueRealisee(paires, 0, CONFIG).actif).toBe(false);
    expect(ecartMeteoPrevueRealisee(paires, Number.NaN, CONFIG).actif).toBe(false);
  });
});

describe('ecartMeteoPrevueRealisee — activation', () => {
  it('reste neutre quand la météo prévue colle parfaitement à la réalité', () => {
    const paires = Array.from({ length: 10 }, () => paire(0));
    const resultat = ecartMeteoPrevueRealisee(paires, 7, CONFIG);
    expect(resultat.actif).toBe(true);
    expect(resultat.inflationSigmaBp).toBe(BASE_POINTS);
    expect(resultat.ecartTypeTemperatureC).toBeCloseTo(0, 6);
  });

  it('élargit l’intervalle quand l’historique montre un vrai écart de prévision', () => {
    const paires = Array.from({ length: 12 }, (_, i) => paire(i % 2 === 0 ? 3 : -3));
    const resultat = ecartMeteoPrevueRealisee(paires, 7, CONFIG);
    expect(resultat.actif).toBe(true);
    expect(resultat.inflationSigmaBp).toBeGreaterThan(BASE_POINTS);
    expect(resultat.explication).toContain('météo');
  });

  it('élargit DAVANTAGE pour un horizon plus lointain que la référence J-7', () => {
    const paires = Array.from({ length: 12 }, (_, i) => paire(i % 2 === 0 ? 3 : -3));
    const proche = ecartMeteoPrevueRealisee(paires, 3, CONFIG);
    const lointain = ecartMeteoPrevueRealisee(paires, 21, CONFIG);
    expect(lointain.inflationSigmaBp).toBeGreaterThan(proche.inflationSigmaBp);
  });

  it('ne dépasse jamais le plafond configuré', () => {
    const paires = Array.from({ length: 20 }, (_, i) => paire(i % 2 === 0 ? 30 : -30));
    const resultat = ecartMeteoPrevueRealisee(paires, 60, CONFIG);
    expect(resultat.inflationSigmaBp).toBe(CONFIG.inflationMaxBp);
  });

  it('n’inflate jamais en dessous du neutre : l’intervalle ne se resserre jamais', () => {
    const paires = Array.from({ length: 12 }, () => paire(0.001));
    const resultat = ecartMeteoPrevueRealisee(paires, 1, CONFIG);
    expect(resultat.inflationSigmaBp).toBeGreaterThanOrEqual(BASE_POINTS);
  });

  it('est déterministe', () => {
    const paires = Array.from({ length: 12 }, (_, i) => paire(i % 2 === 0 ? 3 : -3));
    expect(ecartMeteoPrevueRealisee(paires, 7, CONFIG)).toEqual(
      ecartMeteoPrevueRealisee(paires, 7, CONFIG),
    );
  });
});
