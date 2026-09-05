import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import type { ObservationSession } from './baseline.js';
import { saisonBp, type ConfigSaison } from './saison.js';

const CONFIG: ConfigSaison = {
  observationsMinimum: 3,
  moisDistinctsMinimum: 3,
  demiVieJours: 180,
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

describe('saisonBp — démarrage à froid', () => {
  it('reste inactif tant que moins de trois mois distincts sont représentés', () => {
    // Deux mois seulement (janvier, février) : rien à comparer à un troisième.
    const observations = [
      sessionNeutre('2026-01-04', 100),
      sessionNeutre('2026-01-11', 100),
      sessionNeutre('2026-02-01', 100),
      sessionNeutre('2026-02-08', 100),
    ];
    const resultat = saisonBp(observations, '2026-08-02', CONFIG);
    expect(resultat.actif).toBe(false);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
    expect(resultat.explication).toBeNull();
    expect(resultat.nbMoisDistinctsObserves).toBe(2);
  });

  it('reste inactif si le mois cible lui-même n’a pas assez d’observations', () => {
    const observations = [
      sessionNeutre('2026-01-04', 100),
      sessionNeutre('2026-01-11', 100),
      sessionNeutre('2026-02-01', 100),
      sessionNeutre('2026-02-08', 100),
      sessionNeutre('2026-03-01', 100),
      sessionNeutre('2026-08-02', 150), // un seul août
    ];
    const resultat = saisonBp(observations, '2026-08-09', CONFIG);
    expect(resultat.mois).toBe(8);
    expect(resultat.actif).toBe(false);
    expect(resultat.nbObservationsMoisCible).toBe(1);
  });

  it('une date cible illisible reste inactive plutôt que de lever', () => {
    const resultat = saisonBp([sessionNeutre('2026-01-04', 100)], 'pas-une-date', CONFIG);
    expect(resultat.actif).toBe(false);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
  });

  // Régression directe de la contamination leave-one-out (docs/05-DECISIONS.md
  // D-089, cas laissé ouvert pour `saison.ts`) : `calculerSaisonRetenue`
  // (facteurs-retenus.ts) appelle `saisonBp` À L'INTÉRIEUR de la validation
  // croisée leave-one-out, avec un historique qui exclut la session ciblée
  // PAR INDEX — donc qui peut encore contenir des sessions POSTÉRIEURES à
  // elle. Ici, mars est postérieur à la cible (20 janvier) : il ne doit ni
  // compter dans les mois distincts, ni peser dans les moyennes. Avant la
  // correction, ce test aurait vu `actif: true` (janvier + mars = 2 mois
  // distincts, mars traité au poids maximal) au lieu de `false`.
  it('exclut les sessions POSTÉRIEURES à la date cible, pas seulement en démarrage à froid', () => {
    const observations = [
      sessionNeutre('2026-01-04', 100),
      sessionNeutre('2026-01-11', 100),
      // Mars 2026 : POSTÉRIEUR à la cible du 20 janvier — ne doit pas compter
      // comme un second mois observé.
      sessionNeutre('2026-03-04', 300),
      sessionNeutre('2026-03-11', 300),
    ];
    const config: ConfigSaison = {
      observationsMinimum: 2,
      moisDistinctsMinimum: 2,
      demiVieJours: 180,
    };
    const resultat = saisonBp(observations, '2026-01-20', config);
    expect(resultat.actif).toBe(false);
    expect(resultat.nbMoisDistinctsObserves).toBe(1);
  });
});

describe('saisonBp — activation', () => {
  function historiqueTroisMois(): ObservationSession[] {
    return [
      // Janvier et février : creux.
      ...Array.from({ length: 4 }, (_, i) => sessionNeutre(`2026-01-0${i + 1}`, 60)),
      ...Array.from({ length: 4 }, (_, i) => sessionNeutre(`2026-02-0${i + 1}`, 60)),
      // Août : forte affluence, sur PLUSIEURS années pour dépasser le minimum.
      ...Array.from({ length: 4 }, (_, i) => sessionNeutre(`2024-08-0${i + 1}`, 200)),
      ...Array.from({ length: 4 }, (_, i) => sessionNeutre(`2025-08-0${i + 1}`, 200)),
    ];
  }

  it('détecte un effet saisonnier une fois assez d’observations pour CE mois', () => {
    const resultat = saisonBp(historiqueTroisMois(), '2026-08-15', CONFIG);
    expect(resultat.actif).toBe(true);
    expect(resultat.facteurBp).toBeGreaterThan(BASE_POINTS); // août est plus fort que la moyenne
    expect(resultat.explication).toContain('Saison');
  });

  it('le mois creux reçoit un facteur sous le neutre', () => {
    // Cible en 2027, pas en 2026 : `historiqueTroisMois()` contient aussi des
    // sessions de février 2026, POSTÉRIEURES à un 20 janvier 2026 — les
    // compter comme historique pour une cible de ce jour-là serait la même
    // fuite d'information que celle fermée par D-089 pour `calculerBaseline`
    // (`saisonBp` exclut désormais ces sessions, donc ce test tomberait à
    // `actif: false` s'il gardait la cible en 2026 : deux mois distincts
    // seulement, sous le minimum de trois). Une cible en 2027 laisse tout
    // l'historique (2024-2026) strictement dans le passé, sans rien changer
    // à l'intention du test.
    const resultat = saisonBp(historiqueTroisMois(), '2027-01-20', CONFIG);
    expect(resultat.actif).toBe(true);
    expect(resultat.facteurBp).toBeLessThan(BASE_POINTS);
  });

  it('est déterministe', () => {
    const historique = historiqueTroisMois();
    expect(saisonBp(historique, '2026-08-15', CONFIG)).toEqual(
      saisonBp(historique, '2026-08-15', CONFIG),
    );
  });
});
