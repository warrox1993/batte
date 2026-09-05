import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import { CATALOGUE_PARAMETRES, Parametres } from '../parametres.js';
import { calculerBaseline, estPremierPassage, type ObservationSession } from './baseline.js';

/** Parametres charges depuis le catalogue : aucune valeur codee dans le test. */
const PARAMETRES = Parametres.depuisLignes(
  CATALOGUE_PARAMETRES.map((d) => ({ cle: d.cle, valeur: d.valeurDefaut })),
);

const PRIOR = Number(
  CATALOGUE_PARAMETRES.find((p) => p.cle === 'prevision_prior_baseline_crepes')!.valeurDefaut,
);
const K = Number(
  CATALOGUE_PARAMETRES.find((p) => p.cle === 'prevision_poids_prior_k')!.valeurDefaut,
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

/** Recule d'un nombre de jours. Deterministe : `Date` n'est jamais appele sans argument. */
function jourMoins(jour: string, jours: number): string {
  return new Date(Date.parse(`${jour}T12:00:00Z`) - jours * 86_400_000).toISOString().slice(0, 10);
}

/** Avance d'un nombre de jours — pour construire une session FUTURE relative à jourReference. */
function jourPlus(jour: string, jours: number): string {
  return new Date(Date.parse(`${jour}T12:00:00Z`) + jours * 86_400_000).toISOString().slice(0, 10);
}

/** Historique hebdomadaire : la session i date de i+1 semaines avant la reference. */
function historiqueHebdomadaire(
  jourReference: string,
  nbSessions: number,
  crepes: (i: number) => number,
): ObservationSession[] {
  return Array.from({ length: nbSessions }, (_, i) =>
    sessionNeutre(jourMoins(jourReference, 7 * (i + 1)), crepes(i)),
  );
}

/** Serie deterministe et variee, pour ne pas tester sur des valeurs toutes egales. */
const ventesVariees = (i: number): number => 140 + ((i * 37) % 90);

describe('calculerBaseline — démarrage à froid', () => {
  it('rend le prior quand rien n a encore été vendu', () => {
    // Le jour de l'installation, l'application doit quand meme donner un chiffre.
    const resultat = calculerBaseline([], '2026-07-27', PARAMETRES);
    expect(resultat.baselineCrepes).toBe(PRIOR);
    expect(resultat.poidsPriorBp).toBe(BASE_POINTS);
    expect(resultat.explication).toContain('Aucune session close');
  });

  it('mélange prior et observation dès la première session', () => {
    const resultat = calculerBaseline([sessionNeutre('2026-07-19', 200)], '2026-07-27', PARAMETRES);
    expect(resultat.baselineCrepes).toBe(Math.round((K * PRIOR + 200) / (K + 1)));
    expect(resultat.baselineCrepes).toBeGreaterThan(PRIOR);
    expect(resultat.baselineCrepes).toBeLessThan(200);
  });

  it('efface progressivement le prior', () => {
    const douze = Array.from({ length: 12 }, (_, i) =>
      sessionNeutre(`2026-0${1 + Math.floor(i / 4)}-0${(i % 4) + 1}`, 200),
    );
    const resultat = calculerBaseline(douze, '2026-07-27', PARAMETRES);
    // k = 3 sur 15 -> le prior ne pese plus que 20 %, comme annonce dans docs/03.
    expect(resultat.poidsPriorBp).toBe(2000);
  });

  it('le poids du prior ne dépend que du NOMBRE de sessions, pas de leur âge', () => {
    // Corollaire de la correction : la ponderation temporelle redistribue le
    // poids entre les observations, elle ne retire pas de masse a l'historique.
    // Douze sessions recentes et douze sessions tres anciennes donnent donc la
    // meme part de prior — sinon un historique qui vieillit ferait remonter
    // l'estimation de depart, ce qui est precisement le defaut corrige.
    const recentes = historiqueHebdomadaire('2026-07-27', 12, () => 200);
    const anciennes = Array.from({ length: 12 }, (_, i) =>
      sessionNeutre(jourMoins('2023-01-01', 7 * i), 200),
    );

    expect(calculerBaseline(recentes, '2026-07-27', PARAMETRES).poidsPriorBp).toBe(2000);
    expect(calculerBaseline(anciennes, '2026-07-27', PARAMETRES).poidsPriorBp).toBe(2000);
  });
});

describe('calculerBaseline — normalisation des facteurs', () => {
  it('remonte une session pluvieuse à ce qu elle aurait donné par temps neutre', () => {
    // 110 crepes vendues sous un facteur 0,55 valent une session neutre a 200.
    const pluvieuse: ObservationSession = {
      dateSession: '2026-07-19',
      crepesVendues: 110,
      meteoBp: 5500,
      evenementBp: BASE_POINTS,
      saisonBp: BASE_POINTS,
    };
    const avecPluie = calculerBaseline([pluvieuse], '2026-07-27', PARAMETRES);
    const neutre = calculerBaseline([sessionNeutre('2026-07-19', 200)], '2026-07-27', PARAMETRES);
    expect(avecPluie.baselineCrepes).toBe(neutre.baselineCrepes);
  });

  it('ne divise pas par un facteur nul', () => {
    const absurde: ObservationSession = {
      dateSession: '2026-07-19',
      crepesVendues: 100,
      meteoBp: 0,
      evenementBp: BASE_POINTS,
      saisonBp: BASE_POINTS,
    };
    const resultat = calculerBaseline([absurde], '2026-07-27', PARAMETRES);
    expect(Number.isFinite(resultat.baselineCrepes)).toBe(true);
  });

  it('une date de session illisible ne contamine pas tout le calcul', () => {
    // La ponderation lit une date : si elle rendait NaN, la somme des poids et
    // donc la baseline entiere partiraient en NaN sans qu'aucune erreur ne soit
    // levee. Une date aberrante est ramenee au poids neutre.
    const observations = [
      sessionNeutre('pas-une-date', 200),
      sessionNeutre(jourMoins('2026-07-27', 7), 200),
    ];
    const resultat = calculerBaseline(observations, '2026-07-27', PARAMETRES);
    expect(Number.isFinite(resultat.baselineCrepes)).toBe(true);
    expect(resultat.baselineCrepes).toBe(Math.round((K * PRIOR + 2 * 200) / (K + 2)));
  });
});

describe('calculerBaseline — sigma observé', () => {
  it('reste null sous 8 sessions : on ne mesure rien', () => {
    const sept = Array.from({ length: 7 }, (_, i) => sessionNeutre(`2026-05-0${i + 1}`, 180 + i));
    expect(calculerBaseline(sept, '2026-07-27', PARAMETRES).sigmaObserve).toBeNull();
  });

  it('mesure la dispersion à partir de 8 sessions', () => {
    const huit = Array.from({ length: 8 }, (_, i) =>
      sessionNeutre(`2026-05-0${i + 1}`, 150 + i * 20),
    );
    const sigma = calculerBaseline(huit, '2026-07-27', PARAMETRES).sigmaObserve;
    expect(sigma).not.toBeNull();
    expect(sigma!).toBeGreaterThan(0);
  });

  it('rend un sigma quasi nul sur un historique parfaitement régulier', () => {
    const regulier = Array.from({ length: 10 }, (_, i) =>
      sessionNeutre(`2026-05-${String(i + 1).padStart(2, '0')}`, 200),
    );
    expect(calculerBaseline(regulier, '2026-07-27', PARAMETRES).sigmaObserve).toBeCloseTo(0, 6);
  });

  it('compte les résidus EXPLOITABLES, pas les sessions', () => {
    // Une session a zero crepe (marche annule sur place) n'a pas de logarithme
    // et sort du calcul. Compter 8 sessions pour n'en exploiter que 7 ferait
    // mentir le seuil : l'ecart-type serait annonce comme mesure alors qu'il
    // porte sur moins de points que le minimum exige.
    const sessionsAvecUnZero = (nb: number): ObservationSession[] => [
      sessionNeutre(jourMoins('2026-07-27', 7), 0),
      ...Array.from({ length: nb - 1 }, (_, i) =>
        sessionNeutre(jourMoins('2026-07-27', 14 + 7 * i), 150 + i * 10),
      ),
    ];

    expect(
      calculerBaseline(sessionsAvecUnZero(8), '2026-07-27', PARAMETRES).sigmaObserve,
    ).toBeNull();
    expect(
      calculerBaseline(sessionsAvecUnZero(9), '2026-07-27', PARAMETRES).sigmaObserve,
    ).not.toBeNull();
  });
});

describe('calculerBaseline — pondération temporelle', () => {
  /*
   * Ces deux premiers tests remplacent une paire qui encodait le defaut corrige.
   *
   * L'ancienne attente etait : « aucune decroissance sous 30 sessions » (le
   * resultat devait valoir la moyenne NON ponderee), puis « decroissance
   * au-dela de 30 ». Elle etait fausse par construction : ce seuil faisait
   * chuter la somme des poids de 30 a ≈ 21,3 d'un coup, donc REMONTER le poids
   * du prior de 9,1 % a 12,3 % entre la 30e et la 31e session. Une session de
   * plus rendait de l'influence a l'estimation de depart. La ponderation
   * s'applique desormais des la premiere session.
   */

  it('penche vers les sessions récentes dès les premières sessions, sans seuil', () => {
    const observations = [
      ...Array.from({ length: 10 }, (_, i) =>
        sessionNeutre(jourMoins('2026-07-27', 730 + 7 * i), 100),
      ),
      ...historiqueHebdomadaire('2026-07-27', 10, () => 300),
    ];
    const resultat = calculerBaseline(observations, '2026-07-27', PARAMETRES);

    const moyenneNonPonderee = Math.round((K * PRIOR + 10 * 100 + 10 * 300) / (K + 20));
    // Les dix sessions de 2024 pesent ≈ 0,06 fois les recentes : le resultat
    // doit nettement depasser la moyenne plate, sans jamais sortir de [100;300].
    expect(resultat.baselineCrepes).toBeGreaterThan(moyenneNonPonderee);
    expect(resultat.baselineCrepes).toBeLessThan(300);
    expect(resultat.explication).toContain('demi-vie 26 semaines');
  });

  it('au-delà de 30 sessions, les récentes pèsent toujours davantage', () => {
    const observations = [
      ...Array.from({ length: 20 }, (_, i) =>
        sessionNeutre(jourMoins('2026-07-27', 730 + 7 * i), 100),
      ),
      ...historiqueHebdomadaire('2026-07-27', 11, () => 300),
    ];
    const resultat = calculerBaseline(observations, '2026-07-27', PARAMETRES);
    // Moyenne non ponderee : (20×100 + 11×300) / 31 ≈ 171. Avec decroissance, les
    // vieilles sessions de 2024 s'effacent et le resultat penche vers 300.
    expect(resultat.baselineCrepes).toBeGreaterThan(200);
  });

  it('ne fait jamais remonter le poids du prior quand une session s ajoute', () => {
    // L'INVARIANT central de ce module. Verifie sur un historique hebdomadaire
    // de 0 a 60 sessions, c'est-a-dire de part et d'autre de l'ancien seuil.
    const jourReference = '2026-07-26';
    let precedent = calculerBaseline([], jourReference, PARAMETRES).poidsPriorBp;

    for (let n = 1; n <= 60; n += 1) {
      const resultat = calculerBaseline(
        historiqueHebdomadaire(jourReference, n, ventesVariees),
        jourReference,
        PARAMETRES,
      );
      expect(resultat.poidsPriorBp).toBeLessThan(precedent);
      expect(resultat.poidsPriorBp).toBe(Math.round((K / (K + n)) * BASE_POINTS));
      precedent = resultat.poidsPriorBp;
    }
  });

  it('ne présente aucune marche d escalier à la 31e session', () => {
    // Regression directe du defaut : avant correction, une session de plus sur
    // un historique parfaitement regulier faisait sauter la baseline de 193 a
    // 190 crepes et le poids du prior de 909 a 1230 points de base.
    const jourReference = '2026-07-26';
    const pas = (n: number) =>
      calculerBaseline(
        historiqueHebdomadaire(jourReference, n, () => 200),
        jourReference,
        PARAMETRES,
      );

    const vingtNeuf = pas(29);
    const trente = pas(30);
    const trenteEtUn = pas(31);

    // Un historique regulier ne doit pas bouger d'une session a l'autre.
    expect(Math.abs(trenteEtUn.baselineCrepes - trente.baselineCrepes)).toBeLessThanOrEqual(1);
    // Et le pas du poids du prior reste du meme ordre que le pas precedent.
    const pasAvant = vingtNeuf.poidsPriorBp - trente.poidsPriorBp;
    const pasApres = trente.poidsPriorBp - trenteEtUn.poidsPriorBp;
    expect(pasApres).toBeGreaterThan(0);
    expect(pasApres).toBeLessThanOrEqual(pasAvant);
  });

  it('reste une moyenne convexe : la baseline ne sort pas de l enveloppe des données', () => {
    const jourReference = '2026-07-26';
    for (const n of [1, 5, 17, 31, 52]) {
      const observations = historiqueHebdomadaire(jourReference, n, ventesVariees);
      const valeurs = [PRIOR, ...observations.map((o) => o.crepesVendues)];
      const resultat = calculerBaseline(observations, jourReference, PARAMETRES);

      // Tolerance de 1 : la baseline est arrondie a l'entier.
      expect(resultat.baselineCrepes).toBeGreaterThanOrEqual(Math.min(...valeurs) - 1);
      expect(resultat.baselineCrepes).toBeLessThanOrEqual(Math.max(...valeurs) + 1);
    }
  });

  it('est déterministe : même entrée, même sortie', () => {
    // Condition du backtesting : aucune horloge, aucun alea dans le calcul.
    const observations = historiqueHebdomadaire('2026-07-26', 40, ventesVariees);
    expect(calculerBaseline(observations, '2026-07-26', PARAMETRES)).toEqual(
      calculerBaseline(observations, '2026-07-26', PARAMETRES),
    );
  });
});

describe('calculerBaseline — contamination par des sessions FUTURES (contexte leave-one-out)', () => {
  /*
   * En validation croisée leave-one-out (`validation-croisee.ts`), l'historique
   * transmis à `calculerBaseline` exclut la session ciblée mais peut encore
   * contenir des sessions POSTÉRIEURES à elle : le trou laissé par le retrait
   * tombe au milieu d'une série chronologique, pas forcément à son extrémité
   * (voir `predicteurs-precision.ts`, `demandeSansNouveauPredicteur`, qui
   * transmet cet historique « troué » tel quel, non trié). Une référence
   * leave-one-out ne doit voir que ce qui PRÉCÈDE le point retiré — même
   * principe déjà appliqué par `tendanceBp` (voir `tendance.ts`).
   *
   * Ces deux tests sont ROUGES avant correction : `poidsTemporel` traite un
   * âge négatif (session future) comme un poids de 1, le poids maximal —
   * celui d'une session survenue aujourd'hui — au lieu de l'exclure.
   */

  it('une session postérieure au jour de référence ne change ni la baseline ni le nombre de sessions retenues', () => {
    const jourReference = '2026-07-27';
    const passees = historiqueHebdomadaire(jourReference, 10, () => 150);
    // Valeur extrême et nettement future : si elle pèse ne serait-ce qu'un
    // peu, l'écart sur baselineCrepes devient impossible à manquer.
    const future = sessionNeutre(jourPlus(jourReference, 14), 900);

    const sansFutur = calculerBaseline(passees, jourReference, PARAMETRES);
    const avecFutur = calculerBaseline([...passees, future], jourReference, PARAMETRES);

    expect(avecFutur.baselineCrepes).toBe(sansFutur.baselineCrepes);
    expect(avecFutur.nbSessionsRetenues).toBe(sansFutur.nbSessionsRetenues);
  });

  it('une session future ne fait pas non plus bouger le poids du prior', () => {
    const jourReference = '2026-07-27';
    const passees = historiqueHebdomadaire(jourReference, 12, () => 150);
    // Valeur IDENTIQUE aux autres ici : isole l'effet sur `poidsPriorBp` (qui
    // ne dépend que du NOMBRE de sessions retenues) de l'effet sur la
    // moyenne pondérée, déjà couvert par le test précédent.
    const future = sessionNeutre(jourPlus(jourReference, 7), 150);

    const sansFutur = calculerBaseline(passees, jourReference, PARAMETRES);
    const avecFutur = calculerBaseline([...passees, future], jourReference, PARAMETRES);

    expect(avecFutur.poidsPriorBp).toBe(sansFutur.poidsPriorBp);
  });
});

describe('estPremierPassage — seuil D-082', () => {
  it('vaut vrai à zéro session close, jamais au-delà', () => {
    expect(estPremierPassage(0)).toBe(true);
    expect(estPremierPassage(1)).toBe(false);
    expect(estPremierPassage(2)).toBe(false);
    expect(estPremierPassage(60)).toBe(false);
  });

  it('coïncide avec `nbSessionsRetenues` réellement rendu par calculerBaseline', () => {
    // Le seuil ne vaut que ce que dit calculerBaseline lui-même : ce test
    // vérifie que les deux ne divergent jamais, plutôt que de re-décréter un
    // chiffre indépendamment de la fonction qu'il gouverne.
    expect(
      estPremierPassage(calculerBaseline([], '2026-07-27', PARAMETRES).nbSessionsRetenues),
    ).toBe(true);
    expect(
      estPremierPassage(
        calculerBaseline([sessionNeutre('2026-07-19', 200)], '2026-07-27', PARAMETRES)
          .nbSessionsRetenues,
      ),
    ).toBe(false);
  });
});
