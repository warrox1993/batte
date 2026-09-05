import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import {
  classerEcoulement,
  sessionConsecutiveBp,
  type ConfigSessionConsecutive,
  type ObservationEcoulement,
} from './session-consecutive.js';

const CONFIG: ConfigSessionConsecutive = {
  ecartMaxJours: 10,
  seuilRuptureBp: 200, // <= 2 % invendu = rupture potentielle
  seuilInvenduImportantBp: 1500, // >= 15 % invendu = invendu important
  occurrencesMinimum: 3,
  demiVieJours: 365,
};

function jourPlus(jour: string, jours: number): string {
  return new Date(Date.parse(`${jour}T12:00:00Z`) + jours * 86_400_000).toISOString().slice(0, 10);
}

function session(
  dateSession: string,
  crepesVendues: number,
  crepesProduites: number,
  crepesInvendues: number,
): ObservationEcoulement {
  return {
    dateSession,
    crepesVendues,
    crepesProduites,
    crepesInvendues,
    meteoBp: BASE_POINTS,
    evenementBp: BASE_POINTS,
    saisonBp: BASE_POINTS,
  };
}

describe('classerEcoulement', () => {
  it('classe une rupture (presque tout écoulé)', () => {
    expect(classerEcoulement(session('2026-01-04', 148, 150, 1), CONFIG)).toBe('rupture');
  });

  it('classe un invendu important', () => {
    expect(classerEcoulement(session('2026-01-04', 100, 150, 30), CONFIG)).toBe(
      'invendu_important',
    );
  });

  it('classe un écoulement neutre entre les deux seuils', () => {
    expect(classerEcoulement(session('2026-01-04', 130, 150, 10), CONFIG)).toBe('neutre');
  });

  it('rend indéterminé quand rien n’a été produit', () => {
    expect(classerEcoulement(session('2026-01-04', 0, 0, 0), CONFIG)).toBe('indetermine');
  });
});

describe('sessionConsecutiveBp — démarrage à froid', () => {
  it('reste inactif sans aucune session antérieure', () => {
    const resultat = sessionConsecutiveBp([], '2026-07-27', CONFIG);
    expect(resultat.actif).toBe(false);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
    expect(resultat.explication).toBeNull();
  });

  it('reste inactif quand la session précédente est trop ancienne (pas "consécutive")', () => {
    const observations = [session('2026-01-04', 130, 150, 10)];
    const resultat = sessionConsecutiveBp(observations, '2026-03-01', CONFIG);
    expect(resultat.actif).toBe(false);
  });

  it('reste inactif quand la session précédente est neutre : rien à ajuster', () => {
    const observations = [session('2026-07-20', 130, 150, 10)];
    const resultat = sessionConsecutiveBp(observations, '2026-07-27', CONFIG);
    expect(resultat.actif).toBe(false);
    expect(resultat.etatSessionPrecedente).toBe('neutre');
  });

  it('reste inactif faute d’assez d’occurrences PASSÉES de l’état pour le calibrer', () => {
    // Une seule rupture dans tout l'historique : rien pour calibrer l'ampleur.
    const observations = [
      session('2026-01-04', 130, 150, 10), // neutre
      session('2026-01-11', 130, 150, 10), // neutre
      session('2026-07-20', 149, 150, 1), // rupture, isolée
    ];
    const resultat = sessionConsecutiveBp(observations, '2026-07-27', CONFIG);
    expect(resultat.actif).toBe(false);
    expect(resultat.etatSessionPrecedente).toBe('rupture');
  });

  it('rapporte le VRAI nombre d’occurrences passées même quand il est insuffisant pour calibrer', () => {
    // Une occurrence de rupture EST exploitable dans l'historique (2026-01-04
    // -> 2026-01-11, un écart de 7 jours, dans la fenêtre) : ce n'est pas
    // « aucune rupture jamais vue », c'est « une seule, en dessous du seuil de
    // calibration (occurrencesMinimum = 3) ». `nbOccurrencesEtat` doit rendre
    // ce compte RÉEL (1), jamais 0 : une donnée manquante (pas assez pour
    // calibrer) ne doit jamais se confondre avec une donnée nulle (aucune
    // occurrence observée).
    const observations = [
      session('2026-01-04', 149, 150, 1), // rupture (avant)
      session('2026-01-11', 130, 150, 10), // neutre (apres) — 1 occurrence de rupture comptée
      session('2026-07-20', 149, 150, 1), // rupture, la VRAIE session précédant dateCible
    ];
    const resultat = sessionConsecutiveBp(observations, '2026-07-27', CONFIG);
    expect(resultat.actif).toBe(false);
    expect(resultat.etatSessionPrecedente).toBe('rupture');
    expect(resultat.nbOccurrencesEtat).toBe(1);
  });

  // Régression directe de la contamination leave-one-out (docs/05-DECISIONS.md
  // D-089, même défaut de fond que `saison.ts`/`jour-semaine.ts`/
  // `vacances-scolaires.ts`) : la calibration (`ratioCroissancePondereMoyen`)
  // comptait aussi les paires (avant, après) POSTÉRIEURES à `dateCible`. Ici,
  // seules DEUX occurrences de rupture sont réellement antérieures à la
  // cible (2026-01-04→11 et 2026-01-18→25) — sous le minimum de 3 — mais une
  // TROISIÈME paire de rupture existe entièrement APRÈS la cible
  // (2026-08-03→10). Avant la correction, cette paire future comptait quand
  // même (poids maximal), portant `nbOccurrencesEtat` à 3 et admettant le
  // prédicteur ; après correction, elle est exclue et le compte réel reste 2.
  it('exclut de la calibration les paires POSTÉRIEURES à la date cible, pas seulement en démarrage à froid', () => {
    const observations = [
      session('2026-01-04', 149, 150, 1), // rupture (avant) — occurrence 1
      session('2026-01-11', 130, 150, 10), // neutre (apres)
      session('2026-01-18', 149, 150, 1), // rupture (avant) — occurrence 2
      session('2026-01-25', 130, 150, 10), // neutre (apres)
      session('2026-07-13', 149, 150, 1), // rupture : la VRAIE session précédant la cible
      // POSTÉRIEUR à la cible (2026-07-20) : ne doit pas compter comme une
      // troisième occurrence de rupture pour la calibration.
      session('2026-08-03', 149, 150, 1), // rupture (avant) — future
      session('2026-08-10', 130, 150, 10), // neutre (apres) — future
    ];
    const resultat = sessionConsecutiveBp(observations, '2026-07-20', CONFIG);
    expect(resultat.etatSessionPrecedente).toBe('rupture');
    expect(resultat.actif).toBe(false);
    expect(resultat.nbOccurrencesEtat).toBe(2);
  });
});

describe('sessionConsecutiveBp — activation', () => {
  /**
   * Historique où une rupture est SYSTÉMATIQUEMENT suivie d'un rebond, et un
   * invendu important SYSTÉMATIQUEMENT suivi d'un repli — motif assez net et
   * assez répété pour être calibré.
   */
  function historiqueAvecMotif(): ObservationEcoulement[] {
    const observations: ObservationEcoulement[] = [];
    let date = '2025-01-05';
    const cycle: readonly ('rupture' | 'invendu_important' | 'neutre')[] = [
      'neutre',
      'rupture',
      'neutre',
      'invendu_important',
    ];
    for (let i = 0; i < 24; i += 1) {
      const etat = cycle[i % cycle.length]!;
      if (etat === 'rupture') {
        observations.push(session(date, 149, 150, 1));
      } else if (etat === 'invendu_important') {
        observations.push(session(date, 100, 150, 30));
      } else {
        observations.push(session(date, 130, 150, 10));
      }
      date = jourPlus(date, 7);
    }
    return observations;
  }

  it('applique un ajustement quand la VRAIE session précédente est en rupture', () => {
    const historique = historiqueAvecMotif();
    // Cible juste après la 5ᵉ rupture du cycle (index 17), pas la 1ʳᵉ (index
    // 1) : la calibration (`ratioCroissancePondereMoyen`) exclut désormais les
    // paires dont `apres` n'est pas STRICTEMENT antérieur à la cible — même
    // garde anti-fuite leave-one-out que `calculerBaseline`
    // (docs/05-DECISIONS.md D-089). Sur la 1ʳᵉ rupture, aucune occurrence
    // antérieure n'existerait pour calibrer l'ampleur (`occurrencesMinimum`
    // ne serait jamais atteint) ; sur la 5ᵉ, quatre occurrences antérieures
    // (index 1, 5, 9, 13) restent disponibles.
    const dateApresRupture = jourPlus(historique[17]!.dateSession, 7);
    const resultat = sessionConsecutiveBp(historique, dateApresRupture, CONFIG);
    expect(resultat.etatSessionPrecedente).toBe('rupture');
    expect(resultat.actif).toBe(true);
    expect(resultat.explication).toContain('rupture');
  });

  it('applique un ajustement quand la VRAIE session précédente a un invendu important', () => {
    const historique = historiqueAvecMotif();
    // Même raison que ci-dessus : la 5ᵉ occurrence (index 19), pas la 1ʳᵉ
    // (index 3), pour laisser quatre occurrences antérieures (index 3, 7,
    // 11, 15) disponibles à la calibration.
    const dateApresInvendu = jourPlus(historique[19]!.dateSession, 7);
    const resultat = sessionConsecutiveBp(historique, dateApresInvendu, CONFIG);
    expect(resultat.etatSessionPrecedente).toBe('invendu_important');
    expect(resultat.actif).toBe(true);
    expect(resultat.explication).toContain('invendu');
  });

  it('est déterministe', () => {
    const historique = historiqueAvecMotif();
    const cible = jourPlus(historique[1]!.dateSession, 7);
    expect(sessionConsecutiveBp(historique, cible, CONFIG)).toEqual(
      sessionConsecutiveBp(historique, cible, CONFIG),
    );
  });
});
