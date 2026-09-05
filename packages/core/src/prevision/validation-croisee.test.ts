import { describe, expect, it } from 'vitest';
import { validerParLeaveOneOut } from './validation-croisee.js';

type Point = { readonly id: number; readonly reel: number; readonly indice: number };

/** Un jeu de points où `indice` est un signal PARFAITEMENT correlé au réel. */
function jeuAvecSignal(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, reel: 100 + i * 3, indice: 100 + i * 3 }));
}

/** Moyenne : l'estimateur « sans prédicteur » de tous les tests ci-dessous. */
function estimerParMoyenne(historique: readonly Point[]): number | null {
  if (historique.length === 0) return null;
  return historique.reduce((s, p) => s + p.reel, 0) / historique.length;
}

describe('validerParLeaveOneOut — le mécanisme qui REFUSE, pas seulement qui mesure', () => {
  it('ADMET un prédicteur qui connaît vraiment le signal', () => {
    const jeu = jeuAvecSignal(20);
    // Le "predicteur" lit directement l'indice de la cible (fuite volontaire et
    // assumée dans ce test : il sert à prouver que le mécanisme sait dire OUI
    // quand un signal parfait existe, pas à modéliser un cas réel).
    const avecPredicteur = (_h: readonly Point[], cible: Point): number => cible.indice;

    const resultat = validerParLeaveOneOut(
      jeu,
      (p) => p.reel,
      estimerParMoyenne,
      avecPredicteur,
      8,
    );

    expect(resultat.admis).toBe(true);
    expect(resultat.ameliorationBp).not.toBeNull();
    expect(resultat.ameliorationBp!).toBeGreaterThan(0);
    expect(resultat.mapeAvecPredicteurBp).toBe(0);
    expect(resultat.raisonRefus).toBeNull();
  });

  it('REFUSE un prédicteur qui n’apporte rien (identique au modèle sans lui)', () => {
    const jeu = jeuAvecSignal(20);
    const identique = (h: readonly Point[]): number | null => estimerParMoyenne(h);

    const resultat = validerParLeaveOneOut(jeu, (p) => p.reel, estimerParMoyenne, identique, 8);

    // Amélioration nulle : PAS admis. C'est le garde-fou anti-sur-apprentissage
    // demandé par docs/demandes/07 §3 — un score inchangé n'est pas un progrès.
    expect(resultat.ameliorationBp).toBe(0);
    expect(resultat.admis).toBe(false);
    expect(resultat.raisonRefus).not.toBeNull();
  });

  it('REFUSE un prédicteur qui dégrade la prévision (du bruit pur)', () => {
    const jeu = jeuAvecSignal(20);
    // Un "predicteur" qui ajoute un bruit deterministe mais sans rapport avec
    // le reel : pire que l'estimateur de reference.
    const bruite = (h: readonly Point[], cible: Point): number | null => {
      const base = estimerParMoyenne(h);
      return base === null ? null : base + (cible.id % 2 === 0 ? 40 : -40);
    };

    const resultat = validerParLeaveOneOut(jeu, (p) => p.reel, estimerParMoyenne, bruite, 8);

    expect(resultat.ameliorationBp).not.toBeNull();
    expect(resultat.ameliorationBp!).toBeLessThan(0);
    expect(resultat.admis).toBe(false);
  });

  it('REFUSE faute d’assez de points évalués, même si le prédicteur est parfait', () => {
    const jeu = jeuAvecSignal(5);
    const avecPredicteur = (_h: readonly Point[], cible: Point): number => cible.indice;

    const resultat = validerParLeaveOneOut(
      jeu,
      (p) => p.reel,
      estimerParMoyenne,
      avecPredicteur,
      8,
    );

    expect(resultat.admis).toBe(false);
    expect(resultat.mapeAvecPredicteurBp).toBeNull();
    expect(resultat.raisonRefus).toContain('5');
  });

  it('ne compare que les points où LES DEUX modèles se prononcent', () => {
    const jeu = jeuAvecSignal(20);
    // Le predicteur "avec" ne s'active qu'un point sur deux (demarrage a froid
    // simule) : les points ou il est muet ne doivent influencer NI l'un NI
    // l'autre MAPE.
    const partiel = (_h: readonly Point[], cible: Point): number | null =>
      cible.id % 2 === 0 ? cible.indice : null;

    const resultat = validerParLeaveOneOut(jeu, (p) => p.reel, estimerParMoyenne, partiel, 5);

    expect(resultat.nbPointsEvalues).toBe(10);
    expect(resultat.admis).toBe(true);
  });

  it('ignore un point à valeur réelle nulle (division par zéro évitée)', () => {
    const jeu = [...jeuAvecSignal(15), { id: 99, reel: 0, indice: 0 }];
    const avecPredicteur = (_h: readonly Point[], cible: Point): number => cible.indice;

    const resultat = validerParLeaveOneOut(
      jeu,
      (p) => p.reel,
      estimerParMoyenne,
      avecPredicteur,
      8,
    );

    expect(resultat.nbPointsEvalues).toBe(15);
    expect(Number.isFinite(resultat.mapeAvecPredicteurBp)).toBe(true);
  });

  it('est déterministe : même échantillon, même verdict', () => {
    const jeu = jeuAvecSignal(20);
    const avecPredicteur = (_h: readonly Point[], cible: Point): number => cible.indice;

    const a = validerParLeaveOneOut(jeu, (p) => p.reel, estimerParMoyenne, avecPredicteur, 8);
    const b = validerParLeaveOneOut(jeu, (p) => p.reel, estimerParMoyenne, avecPredicteur, 8);
    expect(a).toEqual(b);
  });
});
