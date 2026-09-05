import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import type { ObservationSession } from './baseline.js';
import {
  estEnVacances,
  facteurVacancesScolairesBp,
  type ConfigVacancesScolaires,
  type PeriodeVacances,
} from './vacances-scolaires.js';

const CONGE_ETE: PeriodeVacances = { nom: 'Été 2026', debut: '2026-07-01', fin: '2026-08-31' };
const CONFIG: ConfigVacancesScolaires = { observationsMinimum: 4, demiVieJours: 365 };

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

describe('estEnVacances', () => {
  it('inclut les bornes', () => {
    expect(estEnVacances('2026-07-01', [CONGE_ETE])).toBe(true);
    expect(estEnVacances('2026-08-31', [CONGE_ETE])).toBe(true);
    expect(estEnVacances('2026-06-30', [CONGE_ETE])).toBe(false);
    expect(estEnVacances('2026-09-01', [CONGE_ETE])).toBe(false);
  });

  it('gère plusieurs périodes', () => {
    const carnaval: PeriodeVacances = { nom: 'Carnaval', debut: '2026-02-16', fin: '2026-02-22' };
    expect(estEnVacances('2026-02-18', [CONGE_ETE, carnaval])).toBe(true);
  });
});

describe('facteurVacancesScolairesBp — démarrage à froid', () => {
  it('reste inactif sans assez d’observations dans un des deux groupes', () => {
    const observations = [
      sessionNeutre('2026-07-05', 200),
      sessionNeutre('2026-07-12', 210),
      sessionNeutre('2026-01-11', 100),
    ];
    const resultat = facteurVacancesScolairesBp(observations, '2026-07-19', [CONGE_ETE], CONFIG);
    expect(resultat.actif).toBe(false);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
    expect(resultat.explication).toBeNull();
  });

  // Régression directe de la contamination leave-one-out (docs/05-DECISIONS.md
  // D-089, même défaut de fond que `saison.ts`/`jour-semaine.ts`) :
  // `calculerPredicteursPrecision` (predicteurs-precision.ts) appelle
  // `facteurVacancesScolairesBp` DANS la validation croisée leave-one-out,
  // avec un historique qui exclut la session ciblée PAR INDEX — donc qui
  // peut encore contenir des sessions POSTÉRIEURES à elle. Ici, les sessions
  // « en vacances » sont POSTÉRIEURES à la cible (1ᵉʳ mars) : elles ne
  // doivent pas compter dans le groupe « en vacances », qui doit alors
  // rester sous le minimum d'observations. Avant la correction, ce test
  // aurait vu `actif: true` au lieu de `false`.
  it('exclut les sessions POSTÉRIEURES à la date cible, pas seulement en démarrage à froid', () => {
    const observations = [
      sessionNeutre('2026-01-05', 100),
      sessionNeutre('2026-01-12', 100),
      sessionNeutre('2026-01-19', 100),
      sessionNeutre('2026-01-26', 100),
      // Été 2026 : POSTÉRIEUR à la cible du 1ᵉʳ mars — ne doit pas compter
      // comme observations « en vacances ».
      sessionNeutre('2026-07-05', 200),
      sessionNeutre('2026-07-12', 200),
      sessionNeutre('2026-07-19', 200),
      sessionNeutre('2026-07-26', 200),
    ];
    const config: ConfigVacancesScolaires = { observationsMinimum: 4, demiVieJours: 365 };
    const resultat = facteurVacancesScolairesBp(observations, '2026-03-01', [CONGE_ETE], config);
    expect(resultat.actif).toBe(false);
    expect(resultat.nbObservationsEnVacances).toBe(0);
    expect(resultat.nbObservationsHorsVacances).toBe(4);
  });
});

describe('facteurVacancesScolairesBp — activation', () => {
  function historique(): ObservationSession[] {
    const observations: ObservationSession[] = [];
    // Six dimanches d'été (vacances), six dimanches hors vacances.
    for (let i = 0; i < 6; i += 1)
      observations.push(sessionNeutre(jourPlus('2026-07-05', 7 * i), 200));
    for (let i = 0; i < 6; i += 1)
      observations.push(sessionNeutre(jourPlus('2026-01-04', 7 * i), 100));
    return observations;
  }

  it('applique le facteur du groupe VACANCES quand la cible tombe en vacances', () => {
    const resultat = facteurVacancesScolairesBp(historique(), '2026-08-16', [CONGE_ETE], CONFIG);
    expect(resultat.actif).toBe(true);
    expect(resultat.enVacances).toBe(true);
    expect(resultat.facteurBp).toBeGreaterThan(BASE_POINTS);
    expect(resultat.explication).toContain('en vacances');
  });

  it('applique le facteur du groupe HORS VACANCES quand la cible n’y tombe pas', () => {
    // Cible en 2027, pas en 2026 : `historique()` contient aussi les six
    // dimanches d'été (juillet-août 2026), POSTÉRIEURS à un 1er mars 2026 —
    // les compter comme historique pour une cible de ce jour-là serait la
    // même fuite d'information que celle fermée par D-089 pour
    // `calculerBaseline` (`facteurVacancesScolairesBp` exclut désormais ces
    // sessions, donc ce test tomberait à `actif: false` s'il gardait la
    // cible en 2026 : plus aucune observation « en vacances » disponible).
    // Une cible en 2027 laisse tout l'historique 2026 strictement dans le
    // passé, et reste hors de `CONGE_ETE` (bornée à 2026) — sans rien
    // changer à l'intention du test.
    const resultat = facteurVacancesScolairesBp(historique(), '2027-03-01', [CONGE_ETE], CONFIG);
    expect(resultat.actif).toBe(true);
    expect(resultat.enVacances).toBe(false);
    expect(resultat.facteurBp).toBeLessThan(BASE_POINTS);
    expect(resultat.explication).toContain('hors vacances');
  });

  it('est déterministe', () => {
    const jeu = historique();
    expect(facteurVacancesScolairesBp(jeu, '2026-08-16', [CONGE_ETE], CONFIG)).toEqual(
      facteurVacancesScolairesBp(jeu, '2026-08-16', [CONGE_ETE], CONFIG),
    );
  });
});
