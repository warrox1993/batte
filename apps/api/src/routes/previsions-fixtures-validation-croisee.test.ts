/**
 * Garde structurelle — pas un test de route, un test de FIXTURE.
 *
 * Contexte (docs/05-DECISIONS.md D-089 et son complément du 01/08/2026) :
 * une fuite d'information dans la validation croisée leave-one-out du moteur
 * de prévision (l'historique transmis à un pli pouvait contenir des sessions
 * POSTÉRIEURES à la session évaluée) a été fermée dans huit modules. Cinq
 * tests d'intégration sont tombés en conséquence, et pour chacun la question
 * « décrivait-il le bon comportement ? » a été répondue NON : leur fixture
 * portait elle-même la fuite qu'elle était censée surveiller — soit en
 * utilisant du futur comme passé, soit en plaçant sa cible avant toute
 * occurrence utilisable, soit (le cinquième cas, `previsions.test.ts`,
 * « le facteur météo mesuré par catégorie ») en étant trop plate pour
 * discriminer une fois l'échantillon honnêtement filtré par date.
 *
 * CE FICHIER répond à la question posée par la mission : cette classe de
 * défaut est-elle détectable MÉCANIQUEMENT, avant qu'un correctif de
 * production ne la révèle par accident ?
 *
 * RÉPONSE APPORTÉE ICI, ARGUMENTÉE :
 *
 * Les cinq prédicteurs concernés (météo mesurée, jour de semaine, saison,
 * vacances scolaires, session consécutive) partagent tous le MÊME mécanisme
 * de validation : `validerParLeaveOneOut` (`packages/core/src/prevision/
 * validation-croisee.ts`), qui rend `nbPointsEvalues` — le nombre de plis où
 * les deux modèles (avec/sans prédicteur) ont pu se prononcer. Une fixture
 * qui prétend qu'un prédicteur DOIT être admis, mais qui ne fournit pas assez
 * de plis honnêtement évaluables une fois filtrée par date, est un bug —
 * quelle que soit la raison narrative de sa construction (trop peu de
 * semaines, cible mal placée, ou signal trop plat pour qu'on remarque le
 * problème).
 *
 * Cette propriété est VÉRIFIABLE sans lancer de serveur HTTP ni de base : il
 * suffit de rejouer, sur les données brutes de la fixture, EXACTEMENT les
 * mêmes fonctions pures que celles que `apps/api/src/routes/previsions.ts`
 * appelle en production (`classerObservationsMeteo`, `estimerAvecMeteoMesuree`,
 * `jourSemaineBp`, `demandeSansNouveauPredicteur`, `validerParLeaveOneOut`) —
 * jamais une réimplémentation séparée du calcul, qui risquerait de diverger
 * du vrai comportement (c'est très exactement la leçon de D-089 : « une
 * règle écrite deux fois se corrige une fois sur deux »).
 *
 * Les tests ci-dessous REJOUENT ce calcul sur les DEUX fixtures fautives
 * connues (le jeu à neuf dimanches identiques de la météo mesurée, et le jeu
 * à trois mercredis récents du jour de semaine, tous deux décrits dans
 * D-089) et montrent que le nombre de plis honnêtes y est TRÈS en dessous du
 * minimum exigé — la garde les aurait signalées avant qu'elles ne deviennent
 * des tests trompeurs. Appliqué aux fixtures CORRIGÉES (vingt dimanches
 * étalés pour la météo, douze + douze pour le jour de semaine), le même
 * calcul confirme un nombre de plis suffisant.
 *
 * CE QUE CETTE GARDE NE FAIT PAS, ET POURQUOI CE N'EST PAS UNE LACUNE :
 *
 * - Elle ne tourne PAS automatiquement sur toute nouvelle fixture : c'est un
 *   OUTIL à appeler explicitement en écrivant une fixture d'admission (au
 *   même titre qu'on relit `docs/05-DECISIONS.md` avant d'en écrire une),
 *   pas une analyse statique du dépôt. Un balayage automatique de TOUTES les
 *   fixtures de `apps/api/src` demanderait de réimplémenter, pour chacun des
 *   cinq prédicteurs, la règle d'éligibilité qui lui est PROPRE (la météo
 *   compte les observations de la MÊME CATÉGORIE, le jour de semaine compte
 *   les JOURS DISTINCTS ET les observations du jour cible, la saison a sa
 *   propre demi-vie...) — soit dupliquer cinq règles métier dans un outil de
 *   test, soit écrire un outil si générique qu'il ne vérifierait plus rien.
 *   Le seul invariant vraiment général est « rejoue le VRAI calcul » — ce
 *   que ce fichier fait, prédicteur par prédicteur, pas « devine si une
 *   fixture est suspecte sans l'exécuter ».
 *
 * - Elle ne signale PAS la « platitude » (troisième forme décrite par la
 *   mission) comme un défaut en soi. Un signal fort et parfaitement constant
 *   est une hypothèse de fixture LÉGITIME (« neuf dimanches à 300 crêpes
 *   contre un prior à 120 » décrit un signal réel, pas un mensonge). Ce qui
 *   a fait échouer le cinquième cas n'est pas la platitude en tant que
 *   telle, mais le fait qu'elle masquait un ÉCHANTILLON TROP PETIT une fois
 *   filtré par date — un problème de QUANTITÉ, pas de variance. Un garde-fou
 *   générique du type « rejeter toute fixture à variance nulle » produirait
 *   des faux positifs sur des scénarios de signal fort et constant
 *   parfaitement corrects (voir la note de conception du CLAUDE.md — « un
 *   signal fort et constant » est explicitement le cas que ce test doit
 *   couvrir), sans rien détecter que le contrôle de quantité ci-dessous ne
 *   détecte déjà. Conclusion assumée : PAS de garde de variance séparée.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_POINTS,
  CATALOGUE_PARAMETRES,
  Parametres,
  calculerBaseline,
  calculerPredicteursPrecision,
  classerMeteo,
  classerObservationsMeteo,
  demandeSansNouveauPredicteur,
  estimerAvecMeteoMesuree,
  facteurMeteo,
  jourSemaineBp,
  validerParLeaveOneOut,
  type ConditionsMeteo,
  type ConfigJourSemaine,
  type ObservationEcoulement,
  type ObservationMeteoBrute,
  type ObservationSession,
  type PeriodeVacances,
} from '@batte/core';
import {
  CREPES_DIMANCHE,
  CREPES_MERCREDI,
  CYCLE_CREPES_SIGNAL_FORT,
  METEO_TIEDE,
  NB_DIMANCHES_SIGNAL_FORT,
  NB_SEMAINES_JOUR_SEMAINE,
  PLIS_ATTENDUS_JOUR_SEMAINE,
  PLIS_ATTENDUS_SIGNAL_FORT,
  conditionsTiedeSaisonniere,
  fixtureVacancesScolaires,
  sessionsComparableCalendaire,
  sessionsSessionConsecutive,
  type SessionFixture,
} from './previsions-fixtures-partagees.js';

/** Paramètres du catalogue à leurs valeurs par défaut — jamais modifiées ici (aucun seuil touché). */
function parametresParDefaut(): Parametres {
  return new Parametres(CATALOGUE_PARAMETRES.map((d) => [d.cle, d.valeurDefaut] as const));
}

function joursAvant(reference: string, n: number): string {
  const d = new Date(`${reference}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const parametres = parametresParDefaut();
const minPointsEvalues = parametres.entier('prevision_validation_croisee_points_minimum');
const DATE_CIBLE = '2026-08-02';

describe('Garde : rejouer la VRAIE validation croisée sur une fixture avant de lui faire confiance', () => {
  describe('prédicteur météo mesurée par catégorie', () => {
    /**
     * Conditions de la fixture FAUTIVE d'origine : constantes, comme elle
     * l'était. C'est bien ce jeu-là que les deux tests « DÉTECTE » ci-dessous
     * doivent reproduire — pas la fixture corrigée.
     */
    const CONDITIONS_TIEDE: ConditionsMeteo = METEO_TIEDE;

    function construireHistoriqueMeteo(
      nbDimanches: number,
      quantite: (indexSemaine: number) => number,
      conditions: (indexSemaine: number) => ConditionsMeteo = () => CONDITIONS_TIEDE,
    ): ObservationMeteoBrute[] {
      return Array.from({ length: nbDimanches }, (_, k) => {
        const i = k + 1;
        return {
          dateSession: joursAvant(DATE_CIBLE, 7 * i),
          conditions: conditions(i),
          crepesVendues: quantite(i),
          evenementBp: BASE_POINTS,
          saisonBp: BASE_POINTS,
        };
      });
    }

    function plisEvaluablesMeteo(brutes: ObservationMeteoBrute[]): number {
      const classees = classerObservationsMeteo(brutes, parametres);
      const resultat = validerParLeaveOneOut(
        classees,
        (o) => o.crepesVendues,
        (historique, cible) => demandeSansNouveauPredicteur(historique, cible, parametres),
        (historique, cible) =>
          estimerAvecMeteoMesuree(historique, cible, parametres, minPointsEvalues),
        minPointsEvalues,
      );
      return resultat.nbPointsEvalues;
    }

    it(
      'DÉTECTE la fixture fautive connue : neuf dimanches identiques (D-089, cinquième cas) ' +
        "ne fournissent qu'un seul pli honnête, très en dessous du minimum",
      () => {
        const historique = construireHistoriqueMeteo(9, () => 300);
        const plis = plisEvaluablesMeteo(historique);

        // Preuve que la garde AURAIT signalé cette fixture avant qu'elle ne
        // devienne un test trompeur : bien en dessous du minimum exigé par
        // `previsions.ts`, alors que la fixture prétendait démontrer une
        // admission.
        expect(plis).toBeLessThan(minPointsEvalues);
        expect(plis).toBe(1);
      },
    );

    it(
      'DÉTECTE aussi un défaut MASQUÉ dans un test resté VERT : « rejette la mesure quand elle ' +
        'n’améliore rien » (previsions.test.ts) construit également neuf dimanches identiques ' +
        '(valeur = prior, 120) et reste vert — mais pour la MAUVAISE raison. Son commentaire dit ' +
        '« aucune amélioration possible sur le prior déjà neutre » ; le calcul RÉEL montre que le ' +
        'rejet vient d’un échantillon insuffisant (1 pli), pas d’une absence d’amélioration',
      () => {
        const historique = construireHistoriqueMeteo(9, () => 120);
        const plis = plisEvaluablesMeteo(historique);

        // Le test HTTP correspondant reste vert (le facteur retombe bien sur
        // le prior neutre), mais CE calcul prouve que c'est un hasard
        // heureux : la validation croisée ne rend même pas de verdict de
        // MAPE ici, elle refuse de répondre faute de points — exactement le
        // même défaut que le cinquième cas, resté invisible parce que son
        // symptôme externe (rejet) coïncide avec le symptôme attendu.
        expect(plis).toBeLessThan(minPointsEvalues);
        expect(plis).toBe(1);
      },
    );

    it('CONFIRME que la fixture corrigée (vingt dimanches étalés) franchit honnêtement le seuil', () => {
      // DÉRIVÉ de la vraie fixture (`previsions-fixtures-partagees.ts`), jamais
      // recopié : c'est tout l'objet de cette garde. Tant que ces valeurs
      // étaient retapées ici, ramener la vraie fixture de 20 à 9 dimanches —
      // c'est-à-dire y rouvrir le défaut D-089 — laissait cette garde VERTE.
      const historique = construireHistoriqueMeteo(
        NB_DIMANCHES_SIGNAL_FORT,
        (i) => CYCLE_CREPES_SIGNAL_FORT[i % CYCLE_CREPES_SIGNAL_FORT.length]!,
        conditionsTiedeSaisonniere,
      );
      const plis = plisEvaluablesMeteo(historique);

      expect(plis).toBeGreaterThanOrEqual(minPointsEvalues);
      expect(plis).toBe(PLIS_ATTENDUS_SIGNAL_FORT);

      // Et le verdict complet (pas seulement le compte de plis) admet bien
      // la mesure, avec un facteur au-dessus du neutre — jamais en dessous.
      const classees = classerObservationsMeteo(historique, parametres);
      const categorie = classerMeteo(conditionsTiedeSaisonniere(1), parametres);
      const facteurPrior = facteurMeteo(conditionsTiedeSaisonniere(1), parametres).facteurBp;
      const resultat = validerParLeaveOneOut(
        classees,
        (o) => o.crepesVendues,
        (h, c) => demandeSansNouveauPredicteur(h, c, parametres),
        (h, c) => estimerAvecMeteoMesuree(h, c, parametres, minPointsEvalues),
        minPointsEvalues,
      );
      expect(resultat.admis).toBe(true);
      expect(categorie).toBe('ensoleille_tiede');
      expect(facteurPrior).toBe(BASE_POINTS);
    });
  });

  describe('prédicteur jour de semaine (généralisation à un second prédicteur)', () => {
    function sessionNeutre(dateSession: string, crepesVendues: number): ObservationSession {
      return {
        dateSession,
        crepesVendues,
        meteoBp: BASE_POINTS,
        evenementBp: BASE_POINTS,
        saisonBp: BASE_POINTS,
      };
    }

    const configJourSemaine: ConfigJourSemaine = {
      observationsMinimum: parametres.entier('prevision_jour_semaine_observations_minimum'),
      joursDistinctsMinimum: parametres.entier('prevision_jour_semaine_jours_distincts_minimum'),
      demiVieJours: parametres.entier('prevision_demi_vie_ponderation_jours'),
    };

    function estimerAvecJourSemaine(
      historique: readonly ObservationSession[],
      cible: ObservationSession,
    ): number | null {
      const sans = demandeSansNouveauPredicteur(historique, cible, parametres);
      if (sans === null) return null;
      const resultat = jourSemaineBp(historique, cible.dateSession, configJourSemaine);
      if (!resultat.actif) return null;
      return sans * (resultat.facteurBp / BASE_POINTS);
    }

    function plisEvaluablesJourSemaine(echantillon: readonly ObservationSession[]): number {
      return validerParLeaveOneOut(
        echantillon,
        (o) => o.crepesVendues,
        (h, c) => demandeSansNouveauPredicteur(h, c, parametres),
        estimerAvecJourSemaine,
        minPointsEvalues,
      ).nbPointsEvalues;
    }

    it(
      'DÉTECTE la fixture fautive D-089 pour « jour de semaine » : dix dimanches à 150 crêpes ' +
        'contre trois mercredis TOUS récents (0 à 14 jours) ne fournissent que deux plis honnêtes',
      () => {
        const dimanches = Array.from({ length: 10 }, (_, k) =>
          sessionNeutre(joursAvant(DATE_CIBLE, 7 * (k + 1)), 150),
        );
        const mercredis = [0, 1, 2].map((k) =>
          sessionNeutre(joursAvant(DATE_CIBLE, 7 * k + 4), 40),
        );
        const plis = plisEvaluablesJourSemaine([...dimanches, ...mercredis]);

        expect(plis).toBeLessThan(minPointsEvalues);
        expect(plis).toBe(2);
      },
    );

    it(
      'CONFIRME la fixture corrigée (douze dimanches + douze mercredis, même fenêtre, ' +
        'previsions.test.ts) : assez de plis honnêtes, le prédicteur est admis',
      () => {
        const dimanches = Array.from({ length: NB_SEMAINES_JOUR_SEMAINE }, (_, k) =>
          sessionNeutre(joursAvant(DATE_CIBLE, 7 * (k + 1)), CREPES_DIMANCHE),
        );
        const mercredis = Array.from({ length: NB_SEMAINES_JOUR_SEMAINE }, (_, k) =>
          sessionNeutre(joursAvant(DATE_CIBLE, 7 * k + 4), CREPES_MERCREDI),
        );
        const echantillon = [...dimanches, ...mercredis];
        const plis = plisEvaluablesJourSemaine(echantillon);

        expect(plis).toBeGreaterThanOrEqual(minPointsEvalues);
        // Égalité EXACTE, pas seulement « au-dessus du minimum » : voir
        // `PLIS_ATTENDUS_JOUR_SEMAINE`. Les deux assertions qui existaient
        // ici (`plis >= minimum`, `admis === true`) s'AMÉLIORENT toutes deux
        // quand la fuite leave-one-out se rouvre — elles ne pouvaient donc
        // pas la voir.
        expect(plis).toBe(PLIS_ATTENDUS_JOUR_SEMAINE);

        const resultat = validerParLeaveOneOut(
          echantillon,
          (o) => o.crepesVendues,
          (h, c) => demandeSansNouveauPredicteur(h, c, parametres),
          estimerAvecJourSemaine,
          minPointsEvalues,
        );
        expect(resultat.admis).toBe(true);
      },
    );
  });

  /**
   * ISOLEMENT des trois fixtures d'admission ajoutées pour « comparable
   * calendaire », « vacances scolaires » et « session consécutive ».
   *
   * CE QUE CETTE GARDE SURVEILLE, ET POURQUOI ELLE EST NÉCESSAIRE. Les trois
   * tests d'intégration correspondants (`previsions.test.ts`) prouvent chacun
   * qu'UN prédicteur est câblé, en neutralisant ses sites de câblage et en
   * constatant le rouge. Cette preuve ne vaut QUE si chaque fixture n'en
   * active qu'un seul : si deux prédicteurs s'activaient sur le même jeu de
   * données, neutraliser le câblage de l'un ferait rougir le test de l'autre,
   * et l'on croirait avoir prouvé un câblage qu'on n'a pas prouvé.
   *
   * ELLE REJOUE `calculerPredicteursPrecision` — la fonction que
   * `routes/previsions.ts` appelle RÉELLEMENT — et non un assemblage
   * d'estimateurs recopiés : la leçon de D-089 est qu'« une règle écrite deux
   * fois se corrige une fois sur deux ». Prix payé et assumé : cette fonction
   * n'expose pas `nbPointsEvalues`, donc cette garde ne PINNE PAS le nombre de
   * plis comme le font `PLIS_ATTENDUS_SIGNAL_FORT` / `..._JOUR_SEMAINE`
   * ci-dessus. Reproduire ce compte demanderait de redupliquer les quatre
   * estimateurs de `predicteurs-precision.ts` — soit exactement la duplication
   * que D-089 a punie.
   *
   * QUATRE DATES CIBLES et non une seule : les fixtures sont construites
   * RELATIVEMENT à la session à venir, et la vraie route tourne n'importe quel
   * dimanche de l'année. Le début janvier est le cas le plus délicat — la
   * fenêtre de ±10 jours calendaires de « comparable calendaire » y enjambe le
   * Nouvel An et voit alors DEUX années civiles pour un seul anniversaire, ce
   * qui pourrait le réveiller sur les fixtures où il doit rester muet.
   */
  describe('isolement des trois fixtures d’admission (un seul prédicteur admis par fixture)', () => {
    /** Quatre dimanches répartis dans l'année, dont un juste après le Nouvel An. */
    const DATES_CIBLES = ['2026-08-02', '2026-11-01', '2027-01-03', '2027-04-04'] as const;

    /**
     * Fixture → observations du moteur. Météo, événement et saison NEUTRES :
     * `observationsDuLieu` (`packages/db`) les rend ainsi tant qu'aucun relevé
     * ni aucun événement n'est daté sur la session, ce qui est le cas des
     * trois fixtures.
     */
    function enObservations(sessions: readonly SessionFixture[]): ObservationEcoulement[] {
      return sessions.map((s) => ({
        dateSession: s.dateSession,
        crepesVendues: s.crepesVendues,
        crepesProduites: s.crepesProduites,
        crepesInvendues: s.crepesProduites - s.crepesVendues,
        meteoBp: BASE_POINTS,
        evenementBp: BASE_POINTS,
        saisonBp: BASE_POINTS,
      }));
    }

    /** Le vecteur d'admission des cinq prédicteurs, tel que la route l'obtient. */
    function admissions(
      sessions: readonly SessionFixture[],
      dateCible: string,
      periodes: readonly PeriodeVacances[],
    ): Record<string, boolean> {
      const observations = enObservations(sessions);
      const baseline = calculerBaseline(observations, dateCible, parametres).baselineCrepes;
      const predicteurs = calculerPredicteursPrecision(
        observations,
        observations,
        // Aucune paire (prévu, réalisé) : les trois fixtures ne posent qu'un
        // relevé de prévision pour la session à venir, jamais de « reelle ».
        [],
        periodes,
        dateCible,
        3,
        baseline,
        parametres,
      );
      return Object.fromEntries(
        Object.entries(predicteurs).map(([cle, retenu]) => [cle, retenu.admis]),
      );
    }

    it.each(DATES_CIBLES)(
      'cible %s : « comparable calendaire » est le SEUL prédicteur admis sur sa fixture',
      (dateCible) => {
        expect(admissions(sessionsComparableCalendaire(dateCible), dateCible, [])).toEqual({
          comparableCalendaire: true,
          jourSemaine: false,
          vacancesScolaires: false,
          sessionConsecutive: false,
          ecartMeteo: false,
        });
      },
    );

    it.each(DATES_CIBLES)(
      'cible %s : « vacances scolaires » est le SEUL prédicteur admis sur sa fixture',
      (dateCible) => {
        const { sessions, periodes } = fixtureVacancesScolaires(dateCible);
        expect(admissions(sessions, dateCible, periodes)).toEqual({
          comparableCalendaire: false,
          jourSemaine: false,
          vacancesScolaires: true,
          sessionConsecutive: false,
          ecartMeteo: false,
        });
      },
    );

    it.each(DATES_CIBLES)(
      'cible %s : « session consécutive » est le SEUL prédicteur admis sur sa fixture',
      (dateCible) => {
        expect(admissions(sessionsSessionConsecutive(dateCible), dateCible, [])).toEqual({
          comparableCalendaire: false,
          jourSemaine: false,
          vacancesScolaires: false,
          sessionConsecutive: true,
          ecartMeteo: false,
        });
      },
    );
  });
});
