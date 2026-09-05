import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import { CATALOGUE_PARAMETRES, Parametres } from '../parametres.js';
import type { ObservationSession } from './baseline.js';
import { calculerSaisonRetenue, calculerTendanceRetenue } from './facteurs-retenus.js';
import type { ConfigSaison } from './saison.js';
import type { ConfigTendance } from './tendance.js';

/**
 * Ces tests couvrent les trois états distincts de `calculerSaisonRetenue`/
 * `calculerTendanceRetenue` — « non modélisée » (démarrage à froid),
 * « rejetée par validation croisée », « mesurée » (admise) — que
 * `apps/api/src/routes/previsions.test.ts` (intégration HTTP) ne force jamais
 * séparément (`docs/26-AUDIT-DIX-REGLES.md` règle 1).
 */

const PARAMETRES = Parametres.depuisLignes(
  CATALOGUE_PARAMETRES.map((d) => ({ cle: d.cle, valeur: d.valeurDefaut })),
);

function sessionNeutre(dateSession: string, crepesVendues: number): ObservationSession {
  return {
    dateSession,
    crepesVendues,
    meteoBp: BASE_POINTS,
    evenementBp: BASE_POINTS,
    saisonBp: BASE_POINTS,
  };
}

function jourPlus(jour: string, jours: number): string {
  return new Date(Date.parse(`${jour}T12:00:00Z`) + jours * 86_400_000).toISOString().slice(0, 10);
}

describe('calculerSaisonRetenue', () => {
  const CONFIG: ConfigSaison = {
    observationsMinimum: 2,
    moisDistinctsMinimum: 2,
    demiVieJours: 200,
  };

  it('état 1a : « non modélisée — historique trop court » quand un seul mois est représenté', () => {
    const observations = [
      sessionNeutre('2026-01-04', 150),
      sessionNeutre('2026-01-11', 160),
      sessionNeutre('2026-01-18', 155),
    ];
    const resultat = calculerSaisonRetenue(observations, '2027-01-10', 1, CONFIG, PARAMETRES);
    expect(resultat.enUsage).toBe(false);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
    expect(resultat.origine).toContain('historique trop court');
  });

  it('état 1b : « non modélisée — encore X/Y » quand le mois cible manque d’observations', () => {
    const observations = [
      sessionNeutre('2026-01-04', 250), // un seul janvier.
      sessionNeutre('2026-07-04', 100),
      sessionNeutre('2026-07-11', 105),
      sessionNeutre('2026-07-18', 95),
    ];
    // observationsMinimum = 2 : janvier n'en a qu'une.
    const resultat = calculerSaisonRetenue(observations, '2027-01-10', 1, CONFIG, PARAMETRES);
    expect(resultat.enUsage).toBe(false);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
    expect(resultat.origine).toContain('encore 1/2');
  });

  it('état 2 : « rejetée par validation croisée » — mesurable, mais pas assez de points évaluables', () => {
    const observations = [
      sessionNeutre('2026-01-04', 250),
      sessionNeutre('2026-01-11', 250),
      sessionNeutre('2026-01-18', 250),
      sessionNeutre('2026-07-04', 100),
      sessionNeutre('2026-07-11', 100),
      sessionNeutre('2026-07-18', 100),
    ];
    const resultat = calculerSaisonRetenue(
      observations,
      '2027-01-10',
      100, // minPointsEvalues inatteignable sur 6 sessions.
      CONFIG,
      PARAMETRES,
    );
    expect(resultat.enUsage).toBe(false);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
    expect(resultat.origine).toContain('rejetée par validation croisée');
  });

  it('état 3 : « mesurée » et ADMISE quand un mois se distingue nettement du reste', () => {
    // Janvier vend systématiquement 2,5× plus que juillet — un signal que le
    // modèle de référence (sans saison) ne peut pas capter.
    const observations = [
      sessionNeutre('2026-01-04', 250),
      sessionNeutre('2026-01-11', 250),
      sessionNeutre('2026-01-18', 250),
      sessionNeutre('2026-01-25', 250),
      sessionNeutre('2026-07-04', 100),
      sessionNeutre('2026-07-11', 100),
      sessionNeutre('2026-07-18', 100),
      sessionNeutre('2026-07-25', 100),
    ];
    const resultat = calculerSaisonRetenue(observations, '2027-01-10', 1, CONFIG, PARAMETRES);
    expect(resultat.enUsage).toBe(true);
    expect(resultat.facteurBp).toBeGreaterThan(BASE_POINTS);
    expect(resultat.origine).toContain('Saison (janvier');
  });

  // Régression directe de la contamination leave-one-out de `saisonBp` (voir
  // saison.ts, et docs/05-DECISIONS.md D-089, qui avait laissé ce cas ouvert
  // sans le corriger). AVANT correction, `poidsRecence` (ex-fonction propre à
  // saison.ts, dupliquée de `poidsTemporel`) donnait le poids maximal (1) aux
  // sessions POSTÉRIEURES au point retiré par `validerParLeaveOneOut` — sur
  // CET historique précis (un an, signal janvier +10 % sur juillet, demi-vie
  // 90 jours), cela faisait rejeter un signal saisonnier réel :
  // `ameliorationBp` valait −157 (mapeAvec 1049 bp contre mapeSans 892 bp).
  // Après correction, le même jeu de données est ADMIS : `ameliorationBp`
  // vaut +310 (mapeAvec 640 bp contre mapeSans 950 bp) — voir le rapport de
  // livraison pour la mesure complète et le balayage de plusieurs intensités
  // de signal.
  it('état 4 : un signal saisonnier réel sur UNE SEULE année est désormais ADMIS (avant : rejeté)', () => {
    const observations = [
      ...Array.from({ length: 4 }, (_, i) => sessionNeutre(`2025-01-0${i + 1}`, 110)),
      ...Array.from({ length: 4 }, (_, i) => sessionNeutre(`2025-07-0${i + 1}`, 100)),
    ];
    const configDemiVieCourte: ConfigSaison = {
      observationsMinimum: 2,
      moisDistinctsMinimum: 2,
      demiVieJours: 90,
    };
    const resultat = calculerSaisonRetenue(
      observations,
      '2026-01-05',
      2,
      configDemiVieCourte,
      PARAMETRES,
    );
    expect(resultat.enUsage).toBe(true);
    expect(resultat.facteurBp).toBeGreaterThan(BASE_POINTS);
  });
});

describe('calculerTendanceRetenue', () => {
  const CONFIG: ConfigTendance = { sessionsMinimum: 10, fenetreSessions: 12, borneBp: 3000 };

  it('état 1 : « non modélisée » quand pas assez de sessions antérieures existent', () => {
    const observations = Array.from({ length: 2 }, (_, i) =>
      sessionNeutre(jourPlus('2026-01-04', 7 * i), 100 + i * 10),
    );
    const cible = jourPlus('2026-01-04', 7 * 2);
    const resultat = calculerTendanceRetenue(observations, cible, 1, CONFIG, PARAMETRES);
    expect(resultat.enUsage).toBe(false);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
    expect(resultat.origine).toContain('antérieures exploitables');
  });

  it('état 2 : « rejetée par validation croisée » — mesurable, mais pas assez de points évaluables', () => {
    const observations = Array.from({ length: 12 }, (_, i) =>
      sessionNeutre(jourPlus('2026-01-04', 7 * i), 100 + i * 10),
    );
    const cible = jourPlus('2026-01-04', 7 * 12);
    const resultat = calculerTendanceRetenue(
      observations,
      cible,
      100, // minPointsEvalues inatteignable.
      CONFIG,
      PARAMETRES,
    );
    expect(resultat.enUsage).toBe(false);
    expect(resultat.facteurBp).toBe(BASE_POINTS);
    expect(resultat.origine).toContain('rejetée par validation croisée');
  });

  // Historique de ce test : jusqu'à la correction de la contamination
  // leave-one-out de `calculerBaseline` (voir `baseline.ts`,
  // `ageEnJours`/`poidsTemporel`, et le rapport de livraison), une rampe
  // linéaire ou exponentielle SIMPLE sur toute la série ne suffisait PAS à
  // faire admettre la tendance ici : `demandeSansNouveauPredicteur` (le
  // modèle « sans »), appelé PAR la validation croisée avec un historique
  // « troué » par le retrait leave-one-out, laissait `calculerBaseline`
  // traiter les sessions POSTÉRIEURES au point retiré comme pleinement
  // récentes (poids 1). Sur une série qui croît partout, ce mélange faisait
  // déjà remonter artificiellement le baseline de référence vers la moyenne
  // globale pour CHAQUE point testé, et la tendance — qui, elle, n'extrapole
  // qu'à partir des sessions vraiment antérieures — s'ajoutait PAR-DESSUS un
  // baseline déjà haussier : elle surestimait plutôt qu'elle n'améliorait.
  // Un plateau long suivi d'une accélération RÉCENTE contournait ce piège
  // (voir le test suivant). Depuis la correction, une rampe simple est
  // admise directement (voir « état 3 bis » ci-dessous) ; ce test de
  // contournement reste une couverture valide d'un second scénario, pas un
  // constat de défaut.
  it('état 3 : « mesurée » et ADMISE sur un plateau suivi d’une accélération récente', () => {
    const observations = [
      ...Array.from({ length: 30 }, (_, i) => sessionNeutre(jourPlus('2026-01-04', 7 * i), 100)),
      ...Array.from({ length: 10 }, (_, i) =>
        sessionNeutre(jourPlus('2026-01-04', 7 * (30 + i)), 100 + (i + 1) * 15),
      ),
    ];
    const cible = jourPlus('2026-01-04', 7 * 40);
    const resultat = calculerTendanceRetenue(observations, cible, 10, CONFIG, PARAMETRES);
    expect(resultat.enUsage).toBe(true);
    expect(resultat.facteurBp).toBeGreaterThan(BASE_POINTS);
    expect(resultat.origine).toContain('croissance');
  });

  it('état 3 (symétrique) : un plateau suivi d’une érosion récente est ADMIS avec un facteur sous le neutre', () => {
    const observations = [
      ...Array.from({ length: 30 }, (_, i) => sessionNeutre(jourPlus('2026-01-04', 7 * i), 250)),
      ...Array.from({ length: 10 }, (_, i) =>
        sessionNeutre(jourPlus('2026-01-04', 7 * (30 + i)), 250 - (i + 1) * 15),
      ),
    ];
    const cible = jourPlus('2026-01-04', 7 * 40);
    const resultat = calculerTendanceRetenue(observations, cible, 10, CONFIG, PARAMETRES);
    expect(resultat.enUsage).toBe(true);
    expect(resultat.facteurBp).toBeLessThan(BASE_POINTS);
    expect(resultat.origine).toContain('érosion');
  });

  // Régression directe de la correction de la contamination leave-one-out
  // (voir la note ci-dessus) : une rampe linéaire SIMPLE, sans plateau ni
  // contournement, doit désormais être ADMISE directement. Avant correction,
  // ce même jeu de données donnait `enUsage: false` (amélioration MAPE
  // négative : -317 points de base) — voir le rapport de livraison pour la
  // mesure complète.
  it('état 3 bis : une rampe linéaire SIMPLE (sans plateau) est désormais ADMISE directement', () => {
    const observations = Array.from({ length: 40 }, (_, i) =>
      sessionNeutre(jourPlus('2026-01-04', 7 * i), 100 + i * 3),
    );
    const cible = jourPlus('2026-01-04', 7 * 40);
    const resultat = calculerTendanceRetenue(observations, cible, 10, CONFIG, PARAMETRES);
    expect(resultat.enUsage).toBe(true);
    expect(resultat.facteurBp).toBeGreaterThan(BASE_POINTS);
    expect(resultat.origine).toContain('croissance');
  });
});
