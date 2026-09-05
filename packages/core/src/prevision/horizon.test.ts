import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import {
  bandeHorizon,
  confianceHorizonBp,
  inflationHorizonBp,
  intervalleExploitable,
  type ConfigInflationHorizon,
} from './horizon.js';

const CONFIG: ConfigInflationHorizon = {
  horizonFiableJours: 10,
  penteBpParSemaine: 500, // +5 % par semaine entamée au-delà du seuil fiable
  inflationMaxBp: 50000, // plafond ×5
};

describe('inflationHorizonBp', () => {
  it('reste neutre en-deçà du seuil fiable', () => {
    expect(inflationHorizonBp(0, CONFIG)).toBe(BASE_POINTS);
    expect(inflationHorizonBp(5, CONFIG)).toBe(BASE_POINTS);
    expect(inflationHorizonBp(10, CONFIG)).toBe(BASE_POINTS);
  });

  it('croît d’une pente par semaine entamée au-delà du seuil', () => {
    // 17 jours = seuil (10) + 1 semaine entamée (7 jours) -> +500 bp.
    expect(inflationHorizonBp(17, CONFIG)).toBe(BASE_POINTS + 500);
    // 24 jours = seuil + 2 semaines -> +1000 bp.
    expect(inflationHorizonBp(24, CONFIG)).toBe(BASE_POINTS + 1000);
  });

  it('croît STRICTEMENT avec l’horizon (jamais un plateau avant le plafond)', () => {
    const proche = inflationHorizonBp(15, CONFIG);
    const loin = inflationHorizonBp(300, CONFIG);
    expect(loin).toBeGreaterThan(proche);
  });

  it('rend la valeur exacte de la formule à 365 jours (une semaine calendaire complète)', () => {
    // 365 jours = 10 (seuil) + 50,71 semaines entamées -> +500 bp chacune.
    const semainesAuDela = (365 - 10) / 7;
    expect(inflationHorizonBp(365, CONFIG)).toBe(Math.round(BASE_POINTS + semainesAuDela * 500));
  });

  it('est plafonnée et ne dépasse jamais `inflationMaxBp`, sur un horizon très lointain', () => {
    expect(inflationHorizonBp(10_000, CONFIG)).toBe(50000);
    expect(inflationHorizonBp(100_000, CONFIG)).toBe(50000);
  });

  it('ne descend jamais sous 10000, quelle que soit l’entrée', () => {
    expect(inflationHorizonBp(-50, CONFIG)).toBe(BASE_POINTS);
    expect(inflationHorizonBp(Number.NaN, CONFIG)).toBe(BASE_POINTS);
  });

  it('rend le neutre sur un horizon non fini ou négatif, jamais une inflation inventée', () => {
    expect(inflationHorizonBp(Number.NaN, CONFIG)).toBe(BASE_POINTS);
    expect(inflationHorizonBp(Number.POSITIVE_INFINITY, CONFIG)).toBe(BASE_POINTS);
    expect(inflationHorizonBp(-1, CONFIG)).toBe(BASE_POINTS);
  });
});

describe('confianceHorizonBp', () => {
  it('vaut 100 % quand l’inflation est neutre', () => {
    expect(confianceHorizonBp(BASE_POINTS)).toBe(BASE_POINTS);
  });

  it('décroît quand l’inflation augmente', () => {
    const confianceProche = confianceHorizonBp(BASE_POINTS + 500);
    const confianceLoin = confianceHorizonBp(50000);
    expect(confianceLoin).toBeLessThan(confianceProche);
    expect(confianceProche).toBeLessThan(BASE_POINTS);
  });

  it('vaut 20 % à une inflation ×5 (cohérent avec le plafond de configuration)', () => {
    expect(confianceHorizonBp(50000)).toBe(2000);
  });

  it('rend 0 sur une inflation nulle, négative ou non finie — jamais une confiance inventée', () => {
    expect(confianceHorizonBp(0)).toBe(0);
    expect(confianceHorizonBp(-10)).toBe(0);
    expect(confianceHorizonBp(Number.NaN)).toBe(0);
  });
});

describe('bandeHorizon', () => {
  it('est "fiable" au seuil et en-deçà', () => {
    expect(bandeHorizon(0, 10)).toBe('fiable');
    expect(bandeHorizon(10, 10)).toBe('fiable');
  });

  it('est "elargie" au-delà du seuil', () => {
    expect(bandeHorizon(11, 10)).toBe('elargie');
    expect(bandeHorizon(300, 10)).toBe('elargie');
  });

  it('traite un horizon non fini comme "elargie" — jamais faussement fiable', () => {
    expect(bandeHorizon(Number.NaN, 10)).toBe('elargie');
  });
});

describe('intervalleExploitable', () => {
  it('est exploitable quand l’intervalle est étroit devant la médiane', () => {
    expect(intervalleExploitable(140, 150, 160, 15000)).toBe(true);
  });

  it('devient inexploitable quand l’intervalle dépasse le ratio autorisé', () => {
    // (300 - 10) / 150 = 1,933... soit 19333 bp > 15000.
    expect(intervalleExploitable(10, 150, 300, 15000)).toBe(false);
  });

  it('est inexploitable exactement au-dessus du seuil, exploitable exactement au seuil', () => {
    // (p90 - p10) / p50 = 1,5 exactement -> 15000 bp.
    expect(intervalleExploitable(25, 100, 175, 15000)).toBe(true);
    expect(intervalleExploitable(24, 100, 175, 15000)).toBe(false);
  });

  it('est inexploitable sur une médiane nulle ou négative — jamais une division déguisée', () => {
    expect(intervalleExploitable(0, 0, 10, 15000)).toBe(false);
    expect(intervalleExploitable(-5, -1, 3, 15000)).toBe(false);
  });

  it('est inexploitable si p10 ou p90 n’est pas fini', () => {
    expect(intervalleExploitable(Number.NaN, 100, 150, 15000)).toBe(false);
    expect(intervalleExploitable(50, 100, Number.POSITIVE_INFINITY, 15000)).toBe(false);
  });
});
