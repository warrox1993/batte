import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import { normaliserObservation, type ObservationSession } from './baseline.js';
import {
  comparableCalendaireBp,
  type ConfigComparableCalendaire,
} from './comparable-calendaire.js';
import { validerParLeaveOneOut } from './validation-croisee.js';

const CONFIG: ConfigComparableCalendaire = {
  fenetreJours: 10,
  ageMinimumJours: 250,
  demiVieAns: 5,
  anneesMinimum: 2,
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

/**
 * Historique hebdomadaire (dimanches, comme La Batte) sur `nbAnnees` années à
 * partir du 2022-01-02 (dimanche vérifié), avec un pic déterministe autour du
 * 2 février de chaque année — motif Chandeleur de docs/demandes/07 §2.
 */
function historiqueAvecChandeleur(nbAnnees: number): ObservationSession[] {
  const observations: ObservationSession[] = [];
  let date = '2022-01-02';
  for (let semaine = 0; semaine < nbAnnees * 52; semaine += 1) {
    const [, mois, jour] = date.split('-').map(Number);
    const proche2Fevrier = mois === 2 && Math.abs((jour ?? 0) - 2) <= 3;
    // Egalement proche fin janvier, la fenetre du dimanche le plus proche du 2/02.
    const procheFinJanvier = mois === 1 && (jour ?? 0) >= 28;
    const estChandeleur = proche2Fevrier || procheFinJanvier;
    observations.push(sessionNeutre(date, estChandeleur ? 300 : 120));
    date = jourPlus(date, 7);
  }
  return observations;
}

describe('comparableCalendaireBp — démarrage à froid', () => {
  it('reste inactif avec une seule année d’historique', () => {
    const historique = historiqueAvecChandeleur(1);
    // Cible : la Chandeleur de l'annee SUIVANTE, avec une seule annee passee.
    const resultat = comparableCalendaireBp(historique, '2023-01-29', 120, CONFIG);
    expect(resultat.actif).toBe(false);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
    expect(resultat.explication).toBeNull();
  });

  it('reste inactif quand la baseline générale est nulle ou invalide', () => {
    const historique = historiqueAvecChandeleur(3);
    expect(comparableCalendaireBp(historique, '2025-01-26', 0, CONFIG).actif).toBe(false);
    expect(comparableCalendaireBp(historique, '2025-01-26', -5, CONFIG).actif).toBe(false);
    expect(comparableCalendaireBp(historique, '2025-01-26', Number.NaN, CONFIG).actif).toBe(false);
  });
});

describe('comparableCalendaireBp — activation et décomposition affichable', () => {
  it('s’active dès que deux années distinctes couvrent le jour cible', () => {
    const historique = historiqueAvecChandeleur(3);
    const resultat = comparableCalendaireBp(historique, '2025-01-26', 120, CONFIG);
    expect(resultat.actif).toBe(true);
    expect(resultat.nbAnneesDistinctes).toBeGreaterThanOrEqual(2);
    // La ligne de décomposition doit être affichable telle quelle (docs/07 §3).
    expect(resultat.explication).toContain('Comparable calendaire');
  });

  it('détecte un facteur NETTEMENT au-dessus du neutre sur un jour de forte saisonnalité', () => {
    const historique = historiqueAvecChandeleur(3);
    const resultat = comparableCalendaireBp(historique, '2025-01-26', 120, CONFIG);
    expect(resultat.facteurBp).toBeGreaterThan(15_000); // les comparables valent 300, la baseline générale 120
  });

  it('reste proche du neutre sur un jour ordinaire', () => {
    const historique = historiqueAvecChandeleur(3);
    const resultat = comparableCalendaireBp(historique, '2025-06-15', 120, CONFIG);
    expect(resultat.actif).toBe(true);
    expect(resultat.facteurBp).toBeGreaterThan(9000);
    expect(resultat.facteurBp).toBeLessThan(11_000);
  });

  it('est déterministe : même entrée, même sortie', () => {
    const historique = historiqueAvecChandeleur(3);
    expect(comparableCalendaireBp(historique, '2025-01-26', 120, CONFIG)).toEqual(
      comparableCalendaireBp(historique, '2025-01-26', 120, CONFIG),
    );
  });
});

describe('comparableCalendaireBp — validation croisée : le garde-fou anti-sur-apprentissage', () => {
  /** Estimateur "sans prédicteur" : moyenne pondérée par récence, demi-vie courte. */
  function estimerSansPredicteur(
    historique: readonly ObservationSession[],
    cible: ObservationSession,
  ): number | null {
    if (historique.length === 0) return null;
    let sommePoids = 0;
    let sommePonderee = 0;
    for (const observation of historique) {
      const age =
        (Date.parse(`${cible.dateSession}T12:00:00Z`) -
          Date.parse(`${observation.dateSession}T12:00:00Z`)) /
        86_400_000;
      const poids = age > 0 ? 0.5 ** (age / 60) : 1;
      sommePoids += poids;
      sommePonderee += poids * normaliserObservation(observation);
    }
    return sommePoids > 0 ? sommePonderee / sommePoids : null;
  }

  function estimerAvecPredicteur(
    historique: readonly ObservationSession[],
    cible: ObservationSession,
  ): number | null {
    const base = estimerSansPredicteur(historique, cible);
    if (base === null) return null;
    const resultat = comparableCalendaireBp(historique, cible.dateSession, base, CONFIG);
    // Neutre quand le prédicteur est en démarrage à froid : le point reste
    // dans la comparaison, mais SANS AUCUN effet — exactement le comportement
    // de `moteur.ts` quand le facteur vaut 10000.
    return resultat.actif ? base * (resultat.facteurBp / BASE_POINTS) : base;
  }

  it('ADMET le prédicteur sur un historique à vraie saisonnalité calendaire (Chandeleur)', () => {
    const jeu = historiqueAvecChandeleur(4);
    const resultat = validerParLeaveOneOut(
      jeu,
      (o) => o.crepesVendues,
      estimerSansPredicteur,
      estimerAvecPredicteur,
      20,
    );

    expect(resultat.admis).toBe(true);
    expect(resultat.ameliorationBp).not.toBeNull();
    expect(resultat.ameliorationBp!).toBeGreaterThan(0);
  });

  it('REFUSE le prédicteur sur un historique en pure tendance, sans aucune saisonnalité', () => {
    // Piège de sur-apprentissage : une tendance de fond (le bouche-à-oreille
    // qui grandit) n'a RIEN à voir avec le calendrier. Le comparable
    // calendaire, en regardant des années ANCIENNES (donc un niveau de
    // tendance plus bas), tire la prévision vers le BAS alors que
    // l'estimateur de récence suit déjà correctement la tendance récente.
    const jeu: ObservationSession[] = [];
    let date = '2022-01-02';
    for (let semaine = 0; semaine < 4 * 52; semaine += 1) {
      jeu.push(sessionNeutre(date, 100 + semaine)); // tendance linéaire pure, zéro saison
      date = jourPlus(date, 7);
    }

    const resultat = validerParLeaveOneOut(
      jeu,
      (o) => o.crepesVendues,
      estimerSansPredicteur,
      estimerAvecPredicteur,
      20,
    );

    expect(resultat.admis).toBe(false);
    expect(resultat.ameliorationBp).not.toBeNull();
    expect(resultat.ameliorationBp!).toBeLessThanOrEqual(0);
  });
});
