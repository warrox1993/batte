import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import { CATALOGUE_PARAMETRES, Parametres } from '../parametres.js';
import type { ObservationSession } from './baseline.js';
import {
  PREDICTEUR_NON_ADMIS,
  calculerPredicteursPrecision,
  demandeSansNouveauPredicteur,
  validerPredicteurDeDemande,
} from './predicteurs-precision.js';
import type { ObservationEcoulement } from './session-consecutive.js';

/**
 * Ces tests couvrent les cas limites que `apps/api/src/routes/previsions.test.ts`
 * (intégration HTTP) ne visite jamais : échantillon vide, une seule session,
 * démarrage à froid explicite, et le court-circuit de la validation croisée
 * (le mission le demande — `docs/26-AUDIT-DIX-REGLES.md` règle 1).
 */

/** Parametres charges depuis le catalogue : aucune valeur codee dans le test. */
const PARAMETRES = Parametres.depuisLignes(
  CATALOGUE_PARAMETRES.map((d) => ({ cle: d.cle, valeur: d.valeurDefaut })),
);

/** Meme catalogue, avec des cles precises ecrasees — pour forcer un cas degenere. */
function parametresAvec(overrides: Record<string, string>): Parametres {
  return Parametres.depuisLignes(
    CATALOGUE_PARAMETRES.map((d) => ({ cle: d.cle, valeur: overrides[d.cle] ?? d.valeurDefaut })),
  );
}

function sessionNeutre(
  dateSession: string,
  crepesVendues: number,
  overrides: Partial<Pick<ObservationSession, 'meteoBp' | 'evenementBp' | 'saisonBp'>> = {},
): ObservationSession {
  return {
    dateSession,
    crepesVendues,
    meteoBp: overrides.meteoBp ?? BASE_POINTS,
    evenementBp: overrides.evenementBp ?? BASE_POINTS,
    saisonBp: overrides.saisonBp ?? BASE_POINTS,
  };
}

function ecoulementNeutre(
  dateSession: string,
  crepesVendues: number,
  crepesProduites: number,
  crepesInvendues: number,
): ObservationEcoulement {
  return { ...sessionNeutre(dateSession, crepesVendues), crepesProduites, crepesInvendues };
}

describe('demandeSansNouveauPredicteur', () => {
  it('rend null quand la baseline est non calculable (prior ET k tous deux nuls, échantillon vide)', () => {
    // 0 sessions, prior 0, k 0 : (0×0 + 0×moyenne)/(0+0) = NaN. La fonction doit
    // refuser de répondre plutôt que de laisser le NaN se propager.
    const parametresDegenerees = parametresAvec({
      prevision_prior_baseline_crepes: '0',
      prevision_poids_prior_k: '0',
    });
    const resultat = demandeSansNouveauPredicteur(
      [],
      sessionNeutre('2026-07-27', 100),
      parametresDegenerees,
    );
    expect(resultat).toBeNull();
  });

  it('rend un nombre positif dès qu’un prior existe, même sur un échantillon totalement vide', () => {
    const resultat = demandeSansNouveauPredicteur([], sessionNeutre('2026-07-27', 100), PARAMETRES);
    expect(resultat).not.toBeNull();
    expect(resultat).toBeGreaterThan(0);
  });

  it('multiplie la baseline par les facteurs météo/événement/saison de LA CIBLE, pas de l’historique', () => {
    const baselineNeutre = demandeSansNouveauPredicteur(
      [],
      sessionNeutre('2026-07-27', 100),
      PARAMETRES,
    );
    const avecMeteoDoublee = demandeSansNouveauPredicteur(
      [],
      sessionNeutre('2026-07-27', 100, { meteoBp: 20_000 }),
      PARAMETRES,
    );
    expect(avecMeteoDoublee).toBeCloseTo((baselineNeutre ?? 0) * 2, 6);
  });
});

describe('validerPredicteurDeDemande', () => {
  // Historique volontairement varié : un modèle « sans » (baseline neutre) ne
  // peut pas coller exactement à des ventes aussi dispersées, ce qui rend le
  // test d'amélioration (ci-dessous) discriminant plutôt qu'accidentel.
  const historique: ObservationSession[] = [
    sessionNeutre('2026-06-01', 90),
    sessionNeutre('2026-06-08', 200),
    sessionNeutre('2026-06-15', 60),
    sessionNeutre('2026-06-22', 220),
  ];

  it('rend PREDICTEUR_NON_ADMIS SANS appeler la validation croisée quand le prédicteur est en démarrage à froid', () => {
    let estimateurAvecAppele = false;
    const resultat = validerPredicteurDeDemande(
      historique,
      '2026-06-29',
      1,
      PARAMETRES,
      () => ({ actif: false, facteurBp: 15_000, explication: 'jamais affiché' }),
      () => {
        estimateurAvecAppele = true;
        return 100;
      },
    );
    expect(resultat).toEqual(PREDICTEUR_NON_ADMIS);
    // La garantie économique du court-circuit : juger un prédicteur qui resterait
    // neutre de toute façon serait du travail perdu — l'estimateur ne doit même
    // pas être invoqué.
    expect(estimateurAvecAppele).toBe(false);
  });

  it('admet un prédicteur qui prédit exactement la valeur réelle (améliore strictement le MAPE)', () => {
    const resultat = validerPredicteurDeDemande(
      historique,
      '2026-06-29',
      1,
      PARAMETRES,
      () => ({ actif: true, facteurBp: 12_345, explication: 'explication de test' }),
      (_historique, cible) => cible.crepesVendues,
    );
    expect(resultat).toEqual({
      admis: true,
      facteurBp: 12_345,
      explication: 'explication de test',
    });
  });

  it('rejette un prédicteur strictement identique au modèle de référence (amélioration nulle, pas de tolérance)', () => {
    const resultat = validerPredicteurDeDemande(
      historique,
      '2026-06-29',
      1,
      PARAMETRES,
      () => ({ actif: true, facteurBp: 12_345, explication: 'x' }),
      (hist, cible) => demandeSansNouveauPredicteur(hist, cible, PARAMETRES),
    );
    expect(resultat).toEqual(PREDICTEUR_NON_ADMIS);
  });

  it('rejette faute d’assez de points évalués, même si le prédicteur devine juste à chaque fois', () => {
    const resultat = validerPredicteurDeDemande(
      historique,
      '2026-06-29',
      100, // minPointsEvalues inatteignable sur 4 sessions.
      PARAMETRES,
      () => ({ actif: true, facteurBp: 12_345, explication: 'x' }),
      (_historique, cible) => cible.crepesVendues,
    );
    expect(resultat).toEqual(PREDICTEUR_NON_ADMIS);
  });
});

describe('calculerPredicteursPrecision — assemblage des cinq prédicteurs', () => {
  it('rend les cinq prédicteurs non admis sur un historique totalement vide', () => {
    const resultat = calculerPredicteursPrecision([], [], [], [], '2026-07-27', 7, 118, PARAMETRES);
    expect(resultat.comparableCalendaire).toEqual(PREDICTEUR_NON_ADMIS);
    expect(resultat.jourSemaine).toEqual(PREDICTEUR_NON_ADMIS);
    expect(resultat.vacancesScolaires).toEqual(PREDICTEUR_NON_ADMIS);
    expect(resultat.sessionConsecutive).toEqual(PREDICTEUR_NON_ADMIS);
    expect(resultat.ecartMeteo).toEqual(PREDICTEUR_NON_ADMIS);
  });

  it('rend les cinq prédicteurs non admis avec une seule session observée (rien à comparer)', () => {
    const uneSession = sessionNeutre('2026-07-20', 100);
    const uneSessionEcoulement = ecoulementNeutre('2026-07-20', 100, 110, 10);
    const resultat = calculerPredicteursPrecision(
      [uneSession],
      [uneSessionEcoulement],
      [],
      [],
      '2026-07-27',
      7,
      100,
      PARAMETRES,
    );
    expect(resultat.comparableCalendaire.admis).toBe(false);
    expect(resultat.jourSemaine.admis).toBe(false);
    expect(resultat.vacancesScolaires.admis).toBe(false);
    expect(resultat.sessionConsecutive.admis).toBe(false);
    expect(resultat.ecartMeteo.admis).toBe(false);
  });
});
