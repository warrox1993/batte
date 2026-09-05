import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import type { ObservationSession } from './baseline.js';
import { jourSemaineBp, type ConfigJourSemaine } from './jour-semaine.js';

const CONFIG: ConfigJourSemaine = {
  observationsMinimum: 5,
  joursDistinctsMinimum: 2,
  demiVieJours: 180,
};

function jourPlus(jour: string, jours: number): string {
  return new Date(Date.parse(`${jour}T12:00:00Z`) + jours * 86_400_000).toISOString().slice(0, 10);
}

function sessionNeutre(dateSession: string, crepesVendues: number): ObservationSession {
  return {
    dateSession,
    crepesVendues,
    meteoBp: BASE_POINTS,
    evenementBp: BASE_POINTS,
    saisonBp: BASE_POINTS,
  };
}

describe('jourSemaineBp — démarrage à froid', () => {
  it('reste inactif quand un seul jour de semaine est représenté (le cas La Batte seule)', () => {
    // Dix dimanches d'affilée : AUCUNE variation inter-jours à mesurer.
    const dimanches = Array.from({ length: 10 }, (_, i) =>
      sessionNeutre(jourPlus('2026-01-04', 7 * i), 150),
    );
    const resultat = jourSemaineBp(dimanches, jourPlus('2026-01-04', 70), CONFIG);
    expect(resultat.actif).toBe(false);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
    expect(resultat.explication).toBeNull();
    expect(resultat.nbJoursDistinctsObserves).toBe(1);
  });

  it('reste inactif si le jour cible lui-même n’a pas assez d’observations, même avec 2 jours distincts', () => {
    const observations = [
      ...Array.from({ length: 20 }, (_, i) => sessionNeutre(jourPlus('2026-01-04', 7 * i), 150)), // dimanches
      sessionNeutre('2026-01-07', 90), // un seul mercredi
    ];
    const resultat = jourSemaineBp(observations, '2026-06-10', CONFIG); // mercredi cible
    expect(resultat.jourSemaine).toBe(3);
    expect(resultat.actif).toBe(false);
  });

  // Régression directe de la contamination leave-one-out (docs/05-DECISIONS.md
  // D-089, cas ACTIF ET PROUVÉ pour `jour-semaine.ts` : un signal hebdomadaire
  // réel et fort — 150 crêpes le dimanche contre 40 le mercredi — était
  // REJETÉ par la validation croisée avant correction, non pas faute de
  // signal, mais parce que `calculerPredicteursPrecision`
  // (predicteurs-precision.ts) appelle `jourSemaineBp` DANS la validation
  // croisée leave-one-out, avec un historique qui exclut la session ciblée
  // PAR INDEX — donc qui peut encore contenir des sessions POSTÉRIEURES à
  // elle. Ici, les mercredis sont POSTÉRIEURS à la cible (20 janvier) : ils
  // ne doivent ni compter dans les jours distincts, ni peser dans les
  // moyennes. Avant la correction, ce test aurait vu `actif: true` (dimanche
  // + mercredi = 2 jours distincts, mercredis traités au poids maximal) au
  // lieu de `false`. Voir le rapport de livraison pour la mesure complète
  // sur le jeu de données réel de `apps/api/src/routes/previsions.test.ts`.
  it('exclut les sessions POSTÉRIEURES à la date cible, pas seulement en démarrage à froid', () => {
    const observations = [
      sessionNeutre('2026-01-04', 150),
      sessionNeutre('2026-01-11', 150),
      // Mercredis : POSTÉRIEURS à la cible du 20 janvier — ne doivent pas
      // compter comme un second jour de semaine observé.
      sessionNeutre('2026-01-28', 40),
      sessionNeutre('2026-02-04', 40),
    ];
    const config: ConfigJourSemaine = {
      observationsMinimum: 2,
      joursDistinctsMinimum: 2,
      demiVieJours: 180,
    };
    const resultat = jourSemaineBp(observations, '2026-01-20', config);
    expect(resultat.actif).toBe(false);
    expect(resultat.nbJoursDistinctsObserves).toBe(1);
  });
});

describe('jourSemaineBp — activation', () => {
  function historiqueDeuxJours(): ObservationSession[] {
    return [
      ...Array.from({ length: 15 }, (_, i) => sessionNeutre(jourPlus('2026-01-04', 7 * i), 150)), // dimanches
      ...Array.from({ length: 8 }, (_, i) => sessionNeutre(jourPlus('2026-01-07', 7 * i), 60)), // mercredis, plus faibles
    ];
  }

  it('détecte un effet du jour de semaine une fois assez d’observations pour CE jour', () => {
    const resultat = jourSemaineBp(historiqueDeuxJours(), '2026-06-10', CONFIG); // mercredi
    expect(resultat.actif).toBe(true);
    expect(resultat.facteurBp).toBeLessThan(BASE_POINTS); // le mercredi vend moins que la moyenne
    expect(resultat.explication).toContain('Jour de la semaine');
  });

  it('le jour fort (dimanche) reçoit un facteur au-dessus du neutre', () => {
    const resultat = jourSemaineBp(historiqueDeuxJours(), '2026-06-14', CONFIG); // dimanche
    expect(resultat.actif).toBe(true);
    expect(resultat.facteurBp).toBeGreaterThan(BASE_POINTS);
  });

  it('est déterministe', () => {
    const historique = historiqueDeuxJours();
    expect(jourSemaineBp(historique, '2026-06-10', CONFIG)).toEqual(
      jourSemaineBp(historique, '2026-06-10', CONFIG),
    );
  });
});
