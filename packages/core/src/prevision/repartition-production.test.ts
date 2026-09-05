import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import {
  repartitionProduction,
  type ConfigRepartitionProduction,
  type RecetteRepartition,
} from './repartition-production.js';

const CONFIG_SANS_PLANCHER: ConfigRepartitionProduction = {
  plancherSansGlutenBp: 0,
  arrondiVolumeMl: 500,
};

const R1: RecetteRepartition = {
  recetteId: 'r1',
  code: 'R1',
  sansGluten: false,
  rendementReferenceMl: 5000, // 5 L
  rendementReferenceCrepes: 66,
  partMesureeBp: 8000, // 80 %
};

const R2: RecetteRepartition = {
  recetteId: 'r2',
  code: 'R2',
  sansGluten: true,
  rendementReferenceMl: 5000,
  rendementReferenceCrepes: 68,
  partMesureeBp: 2000, // 20 %
};

describe('repartitionProduction — cas dégénérés', () => {
  it('rend un tableau vide sans recette exploitable', () => {
    const resultat = repartitionProduction([], 150, CONFIG_SANS_PLANCHER);
    expect(resultat.lignes).toEqual([]);
    expect(resultat.plancherApplique).toBe(false);
  });

  it('rend un tableau vide si la cible de crêpes n’est pas strictement positive', () => {
    const resultat = repartitionProduction([R1, R2], 0, CONFIG_SANS_PLANCHER);
    expect(resultat.lignes).toEqual([]);
  });

  it('ignore une recette dont le rendement est inexploitable', () => {
    const recetteVide: RecetteRepartition = { ...R2, rendementReferenceMl: 0 };
    const resultat = repartitionProduction([R1, recetteVide], 100, CONFIG_SANS_PLANCHER);
    expect(resultat.lignes).toHaveLength(1);
    expect(resultat.lignes[0]!.recetteId).toBe('r1');
  });
});

describe('repartitionProduction — répartition mesurée, sans plancher', () => {
  it('répartit exactement selon la part mesurée et la somme des crêpes vaut la cible', () => {
    const resultat = repartitionProduction([R1, R2], 150, CONFIG_SANS_PLANCHER);
    expect(resultat.plancherApplique).toBe(false);
    const total = resultat.lignes.reduce((s, l) => s + l.crepes, 0);
    expect(total).toBe(150); // invariant de `repartir` : jamais d'écart d'arrondi
    const r1 = resultat.lignes.find((l) => l.recetteId === 'r1')!;
    const r2 = resultat.lignes.find((l) => l.recetteId === 'r2')!;
    expect(r1.crepes).toBeGreaterThan(r2.crepes); // 80 % vs 20 %
  });

  it('convertit chaque part en volume arrondi au demi-litre', () => {
    const resultat = repartitionProduction([R1, R2], 132, CONFIG_SANS_PLANCHER);
    for (const ligne of resultat.lignes) {
      expect(ligne.volumeMl % 500).toBe(0);
    }
  });

  it('une seule recette active reçoit 100 % et la cible entière', () => {
    const resultat = repartitionProduction([R1], 66, CONFIG_SANS_PLANCHER);
    expect(resultat.lignes).toHaveLength(1);
    expect(resultat.lignes[0]!.partBp).toBe(BASE_POINTS);
    expect(resultat.lignes[0]!.crepes).toBe(66);
    expect(resultat.lignes[0]!.volumeMl).toBe(5000); // rendement de référence exact
  });

  it('est déterministe', () => {
    expect(repartitionProduction([R1, R2], 150, CONFIG_SANS_PLANCHER)).toEqual(
      repartitionProduction([R1, R2], 150, CONFIG_SANS_PLANCHER),
    );
  });
});

describe('repartitionProduction — plancher de sécurité sans gluten', () => {
  const AVEC_PLANCHER: ConfigRepartitionProduction = {
    plancherSansGlutenBp: 3000, // 30 %
    arrondiVolumeMl: 500,
  };

  it('relève la part sans gluten quand la mesure tombe sous le plancher', () => {
    const resultat = repartitionProduction([R1, R2], 150, AVEC_PLANCHER);
    expect(resultat.plancherApplique).toBe(true);
    const r2 = resultat.lignes.find((l) => l.recetteId === 'r2')!;
    expect(r2.partBp).toBeGreaterThanOrEqual(3000);
    // La somme reste exacte malgré l'ajustement.
    const total = resultat.lignes.reduce((s, l) => s + l.crepes, 0);
    expect(total).toBe(150);
  });

  it('ne touche pas la répartition quand la mesure dépasse déjà le plancher', () => {
    const r2Forte: RecetteRepartition = { ...R2, partMesureeBp: 5000 };
    const r1Faible: RecetteRepartition = { ...R1, partMesureeBp: 5000 };
    const resultat = repartitionProduction([r1Faible, r2Forte], 150, AVEC_PLANCHER);
    expect(resultat.plancherApplique).toBe(false);
    const r2 = resultat.lignes.find((l) => l.recetteId === 'r2')!;
    expect(r2.partBp).toBe(5000);
  });

  it('partage le plancher à parts égales entre recettes sans gluten sans historique', () => {
    const r2Neuve: RecetteRepartition = { ...R2, partMesureeBp: 0 };
    const r3Neuve: RecetteRepartition = {
      recetteId: 'r3',
      code: 'R3',
      sansGluten: true,
      rendementReferenceMl: 5000,
      rendementReferenceCrepes: 70,
      partMesureeBp: 0,
    };
    const resultat = repartitionProduction([R1, r2Neuve, r3Neuve], 150, AVEC_PLANCHER);
    expect(resultat.plancherApplique).toBe(true);
    const r2 = resultat.lignes.find((l) => l.recetteId === 'r2')!;
    const r3 = resultat.lignes.find((l) => l.recetteId === 'r3')!;
    // Les deux recettes sans gluten se partagent également le plancher.
    expect(Math.abs(r2.partBp - r3.partBp)).toBeLessThanOrEqual(1);
  });

  it('ignore le plancher si aucune recette active n’est sans gluten', () => {
    const r1Bis: RecetteRepartition = { ...R1, recetteId: 'r1bis', sansGluten: false };
    const resultat = repartitionProduction([R1, r1Bis], 150, AVEC_PLANCHER);
    expect(resultat.plancherApplique).toBe(false);
  });

  it('un plancher à zéro (défaut tant que non configuré) ne modifie jamais la mesure', () => {
    const resultat = repartitionProduction([R1, R2], 150, CONFIG_SANS_PLANCHER);
    expect(resultat.plancherApplique).toBe(false);
  });
});
