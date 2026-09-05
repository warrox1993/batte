import { describe, expect, it } from 'vitest';
import { BASE_POINTS } from '../argent.js';
import { CATALOGUE_PARAMETRES, Parametres } from '../parametres.js';
import { calculerBaseline } from './baseline.js';
import {
  calculerFacteurMeteoMesure,
  classerObservationsMeteo,
  estimerAvecMeteoMesuree,
  mesureFacteurMeteoCategorie,
  type ObservationMeteoBrute,
  type ObservationMeteoClassee,
} from './meteo-mesuree.js';
import { facteurMeteo, type CategorieMeteo, type ConditionsMeteo } from './meteo.js';

/**
 * Ces tests couvrent les cas limites que `apps/api/src/routes/previsions.test.ts`
 * (intégration HTTP) ne visite jamais : catégorie sans aucune observation,
 * division par zéro potentielle (`facteurAutres === 0`), et les trois états
 * distincts de `calculerFacteurMeteoMesure` (`docs/26-AUDIT-DIX-REGLES.md`
 * règle 1).
 */

const PARAMETRES = Parametres.depuisLignes(
  CATALOGUE_PARAMETRES.map((d) => ({ cle: d.cle, valeur: d.valeurDefaut })),
);

function parametresAvec(overrides: Record<string, string>): Parametres {
  return Parametres.depuisLignes(
    CATALOGUE_PARAMETRES.map((d) => ({ cle: d.cle, valeur: overrides[d.cle] ?? d.valeurDefaut })),
  );
}

function obsMeteoClassee(
  dateSession: string,
  crepesVendues: number,
  categorie: CategorieMeteo,
  overrides: Partial<Pick<ObservationMeteoClassee, 'evenementBp' | 'saisonBp' | 'ventFort'>> = {},
): ObservationMeteoClassee {
  return {
    dateSession,
    crepesVendues,
    meteoBp: BASE_POINTS,
    evenementBp: overrides.evenementBp ?? BASE_POINTS,
    saisonBp: overrides.saisonBp ?? BASE_POINTS,
    categorie,
    ventFort: overrides.ventFort ?? false,
  };
}

/** Recule d'un nombre de semaines depuis une date `AAAA-MM-JJ`. */
function semainesAvant(dateReference: string, semaines: number): string {
  return new Date(Date.parse(`${dateReference}T12:00:00Z`) - semaines * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Seize sessions, deux catégories nettement séparées (≈200 crêpes vs ≈80),
 * toutes deux avec un prior NEUTRE (`meteoBp: BASE_POINTS`) — le prior ne
 * distingue pas les deux catégories, alors que la réalité le fait nettement.
 * Sert à démontrer qu'un facteur MESURÉ par catégorie bat un modèle qui
 * ignore la catégorie, sans jamais coder en dur la valeur numérique du
 * facteur attendu (fragile) — seule la DIRECTION de l'effet est vérifiée.
 *
 * NON PLATE DÉLIBÉRÉMENT (docs/05-DECISIONS.md D-089, complément du
 * 01/08/2026) : chaque catégorie varie AUSSI dans le temps (185 à 220, 72 à
 * 86), pas seulement entre catégories. Une fixture plate (valeur identique
 * pour toutes les sessions d'une catégorie) ne peut PAS distinguer un
 * historique filtré par date d'un historique qui ne l'est pas — moyenner un
 * sous-ensemble de valeurs identiques ou un autre donne le même résultat par
 * construction. C'est exactement pourquoi cette fixture, avant ce complément,
 * ne pouvait pas voir la fuite leave-one-out de `mesureFacteurMeteoCategorie`
 * (voir le rapport de livraison).
 */
function historiqueDeuxCategoriesSeparees(dateReference: string): ObservationMeteoClassee[] {
  const historique: ObservationMeteoClassee[] = [];
  for (let i = 1; i <= 8; i += 1) {
    historique.push(
      obsMeteoClassee(semainesAvant(dateReference, i * 2), 180 + i * 5, 'ensoleille_doux'),
    );
    historique.push(
      obsMeteoClassee(semainesAvant(dateReference, i * 2 + 1), 70 + i * 2, 'pluie_continue'),
    );
  }
  return historique;
}

describe('classerObservationsMeteo', () => {
  it('rend un tableau vide sur un historique vide', () => {
    expect(classerObservationsMeteo([], PARAMETRES)).toEqual([]);
  });

  it('reprend catégorie/facteur/vent de facteurMeteo et laisse passer les autres champs tels quels', () => {
    const conditions: ConditionsMeteo = {
      temperatureC: 15,
      precipitationsMm: 0,
      ventKmh: 5,
      couvertureNuageuseBp: 2000,
    };
    const brut: ObservationMeteoBrute = {
      dateSession: '2026-06-01',
      conditions,
      crepesVendues: 180,
      evenementBp: 12_000,
      saisonBp: 9_000,
    };
    const [classee] = classerObservationsMeteo([brut], PARAMETRES);
    const attendu = facteurMeteo(conditions, PARAMETRES);
    expect(classee).toEqual({
      dateSession: '2026-06-01',
      crepesVendues: 180,
      meteoBp: attendu.facteurBp,
      evenementBp: 12_000,
      saisonBp: 9_000,
      categorie: attendu.categorie,
      ventFort: attendu.ventFort,
    });
  });
});

describe('mesureFacteurMeteoCategorie', () => {
  it('rend null quand aucune observation ne correspond à la catégorie', () => {
    const historique = [obsMeteoClassee('2026-06-01', 150, 'pluie_continue')];
    expect(
      mesureFacteurMeteoCategorie(historique, 'ensoleille_doux', '2026-06-08', 100, PARAMETRES),
    ).toBeNull();
  });

  it('rend null quand la baseline transmise n’est pas strictement positive', () => {
    const historique = [obsMeteoClassee('2026-06-01', 150, 'ensoleille_doux')];
    expect(
      mesureFacteurMeteoCategorie(historique, 'ensoleille_doux', '2026-06-08', 0, PARAMETRES),
    ).toBeNull();
  });

  it('mesure le résidu moyen (1 observation, facteurs neutres) — cas exact à la main', () => {
    const historique = [obsMeteoClassee('2026-06-01', 150, 'ensoleille_doux')];
    const resultat = mesureFacteurMeteoCategorie(
      historique,
      'ensoleille_doux',
      '2026-06-08',
      100,
      PARAMETRES,
    );
    // valeur = 150 / (1×1×1) = 150 ; résidu = 150/100 = 1,5 ; facteurBp = 15000.
    expect(resultat).toEqual({ facteurBp: 15_000, nbObservations: 1 });
  });

  it('ne divise jamais par zéro quand un facteur de ventilation est nul (evenementBp = 0)', () => {
    // Mutation à surveiller : retirer la garde `facteurAutres > 0 ? … : …`
    // ferait de ce résultat un `Infinity`, pas 15000.
    const historique = [obsMeteoClassee('2026-06-01', 150, 'ensoleille_doux', { evenementBp: 0 })];
    const resultat = mesureFacteurMeteoCategorie(
      historique,
      'ensoleille_doux',
      '2026-06-08',
      100,
      PARAMETRES,
    );
    expect(resultat?.facteurBp).toBe(15_000);
    expect(Number.isFinite(resultat?.facteurBp)).toBe(true);
  });

  it('exclut une observation POSTÉRIEURE (ou du même jour) à `dateCible`, jamais moyennée avec le passé', () => {
    // Mutation à surveiller : retirer ce filtre ferait remonter la session du
    // 20/06 dans la moyenne alors qu'elle n'existe pas encore le 08/06.
    const historique = [
      obsMeteoClassee('2026-06-01', 150, 'ensoleille_doux'),
      obsMeteoClassee('2026-06-20', 900, 'ensoleille_doux'), // postérieure à dateCible.
      obsMeteoClassee('2026-06-08', 150, 'ensoleille_doux'), // même jour que dateCible : exclue aussi.
    ];
    const resultat = mesureFacteurMeteoCategorie(
      historique,
      'ensoleille_doux',
      '2026-06-08',
      100,
      PARAMETRES,
    );
    expect(resultat).toEqual({ facteurBp: 15_000, nbObservations: 1 });
  });
});

describe('estimerAvecMeteoMesuree', () => {
  it('rend null quand la baseline historique n’est pas calculable (prior et k tous deux nuls)', () => {
    const parametresDegenerees = parametresAvec({
      prevision_prior_baseline_crepes: '0',
      prevision_poids_prior_k: '0',
    });
    const cible = obsMeteoClassee('2026-06-08', 100, 'ensoleille_doux');
    expect(estimerAvecMeteoMesuree([], cible, parametresDegenerees, 1)).toBeNull();
  });

  it('rend null quand aucune observation de l’historique ne partage la catégorie de la cible', () => {
    const historique = [obsMeteoClassee('2026-06-01', 150, 'pluie_continue')];
    const cible = obsMeteoClassee('2026-06-08', 100, 'ensoleille_doux');
    expect(estimerAvecMeteoMesuree(historique, cible, PARAMETRES, 1)).toBeNull();
  });

  it('rend null quand la catégorie a moins d’observations que le minimum exigé', () => {
    const historique = [
      obsMeteoClassee('2026-06-01', 150, 'ensoleille_doux'),
      obsMeteoClassee('2026-06-08', 160, 'ensoleille_doux'),
    ];
    const cible = obsMeteoClassee('2026-06-15', 100, 'ensoleille_doux');
    expect(estimerAvecMeteoMesuree(historique, cible, PARAMETRES, 3)).toBeNull();
  });

  it('multiplie la baseline par le facteur mesuré ET par les facteurs événement/saison/vent de LA CIBLE', () => {
    const historique = [obsMeteoClassee('2026-06-01', 200, 'ensoleille_doux')];
    const cibleNeutre = obsMeteoClassee('2026-06-08', 0, 'ensoleille_doux');
    const cibleEvenement = { ...cibleNeutre, evenementBp: 20_000 };

    const resultatNeutre = estimerAvecMeteoMesuree(historique, cibleNeutre, PARAMETRES, 1);
    const resultatEvenement = estimerAvecMeteoMesuree(historique, cibleEvenement, PARAMETRES, 1);

    expect(resultatNeutre).not.toBeNull();
    // L'effet de l'événement de la CIBLE (×2), pas de l'historique.
    expect(resultatEvenement).toBeCloseTo((resultatNeutre ?? 0) * 2, 6);

    // Recoupement avec les primitives sous-jacentes : la valeur rendue est
    // exactement `baselineHist × facteurMesuré`, rien de plus, rien de moins.
    const baselineHist = calculerBaseline(
      historique,
      cibleNeutre.dateSession,
      PARAMETRES,
    ).baselineCrepes;
    const mesure = mesureFacteurMeteoCategorie(
      historique,
      'ensoleille_doux',
      cibleNeutre.dateSession,
      baselineHist,
      PARAMETRES,
    );
    const attendu = baselineHist * ((mesure?.facteurBp ?? 0) / BASE_POINTS);
    expect(resultatNeutre).toBeCloseTo(attendu, 6);
  });
});

/**
 * CONTAMINATION LEAVE-ONE-OUT (docs/05-DECISIONS.md D-089, complément du
 * 01/08/2026) : le huitième module, trouvé après le tableau de sept que le
 * complément du 01/08 croyait complet. `mesureFacteurMeteoCategorie` ne
 * filtrait PAS son historique par date — une session POSTÉRIEURE à
 * `dateCible` entrait dans la moyenne de sa catégorie exactement comme une
 * session passée, alors que `calculerFacteurMeteoMesure` appelle
 * `estimerAvecMeteoMesuree` À L'INTÉRIEUR de la validation croisée
 * leave-one-out (`validerParLeaveOneOut`), qui retire un point PAR INDEX,
 * jamais par date — l'historique transmis peut donc contenir des sessions
 * postérieures au point retiré.
 *
 * SÉRIE NON PLATE, DÉLIBÉRÉMENT : une catégorie météo dont toutes les
 * observations valent la même chose ne peut PAS distinguer un historique
 * filtré par date d'un historique qui ne l'est pas — moyenner un sous-
 * ensemble de valeurs identiques ou un autre donne le même résultat par
 * construction. C'est précisément pourquoi les fixtures plates de ce module
 * n'avaient jamais vu ce défaut : le test couvrait la fonction, il ne
 * pouvait STRUCTURELLEMENT pas détecter la fuite.
 */
describe('contamination leave-one-out (docs/05-DECISIONS.md D-089, complément du 01/08/2026)', () => {
  // Six sessions PASSÉES, en croissance semaine après semaine (série non
  // plate) — puis trois sessions FUTURES par rapport à `dateCible`, nettement
  // plus hautes. Sans le filtre par date, ces trois sessions futures
  // entreraient dans la moyenne de la catégorie exactement comme les six
  // passées.
  const passe: readonly ObservationMeteoClassee[] = [
    obsMeteoClassee('2026-05-04', 120, 'ensoleille_doux'),
    obsMeteoClassee('2026-05-18', 130, 'ensoleille_doux'),
    obsMeteoClassee('2026-06-01', 140, 'ensoleille_doux'),
    obsMeteoClassee('2026-06-15', 150, 'ensoleille_doux'),
    obsMeteoClassee('2026-06-29', 160, 'ensoleille_doux'),
    obsMeteoClassee('2026-07-13', 170, 'ensoleille_doux'),
  ];
  const futures: readonly ObservationMeteoClassee[] = [
    obsMeteoClassee('2026-08-10', 900, 'ensoleille_doux'),
    obsMeteoClassee('2026-08-24', 950, 'ensoleille_doux'),
    obsMeteoClassee('2026-09-07', 1000, 'ensoleille_doux'),
  ];
  const dateCible = '2026-07-27';

  it('mesureFacteurMeteoCategorie : mélanger des sessions futures à l’historique ne change RIEN au résultat', () => {
    const honnete = mesureFacteurMeteoCategorie(
      passe,
      'ensoleille_doux',
      dateCible,
      150,
      PARAMETRES,
    );
    // Ordre mélangé à dessein (futures avant passées) : la fonction ne doit
    // dépendre que de la DATE de chaque observation, jamais de sa position
    // dans le tableau — exactement ce que `validerParLeaveOneOut` produit en
    // retirant un point par index.
    const melange = mesureFacteurMeteoCategorie(
      [...futures, ...passe],
      'ensoleille_doux',
      dateCible,
      150,
      PARAMETRES,
    );

    expect(melange).toEqual(honnete);
    expect(honnete).toEqual({ facteurBp: 9_667, nbObservations: 6 });
    // AVANT ce correctif, le même appel « mélangé » rendait { facteurBp: 27556,
    // nbObservations: 9 } : les trois sessions futures, moyennées avec les six
    // passées sans aucun filtre, triplaient quasiment le facteur mesuré.
  });

  it('estimerAvecMeteoMesuree : historique contaminé ou filtré par date, MÊME résultat — 145 crêpes, pas 413', () => {
    const cible = obsMeteoClassee(dateCible, 175, 'ensoleille_doux');

    const honnete = estimerAvecMeteoMesuree(passe, cible, PARAMETRES, 3);
    const contamine = estimerAvecMeteoMesuree([...passe, ...futures], cible, PARAMETRES, 3);

    expect(contamine).toEqual(honnete);
    expect(honnete).toBeCloseTo(144.9966, 3);
    // AVANT ce correctif, `contamine` valait ≈ 413,34 crêpes contre ≈ 145,00
    // pour `honnete` — un facteur ×2,85 sur le nombre de crêpes à produire,
    // pour la seule raison que l'historique contenait des sessions futures.
  });
});

describe('calculerFacteurMeteoMesure — les trois états distincts', () => {
  it('état 1a : « prior, jamais mesuré » quand la catégorie n’a AUCUNE observation', () => {
    const resultat = calculerFacteurMeteoMesure(
      [],
      'ensoleille_doux',
      11_500,
      '2026-07-27',
      1,
      3,
      PARAMETRES,
    );
    expect(resultat).toEqual({
      enUsage: false,
      facteurBp: 11_500,
      nbObservations: 0,
      origine: 'prior, jamais mesuré',
    });
  });

  it('état 1b : prior avec le compte partiel quand la catégorie a quelques observations mais pas assez', () => {
    const historique = [
      obsMeteoClassee('2026-06-01', 150, 'ensoleille_doux'),
      obsMeteoClassee('2026-06-08', 160, 'ensoleille_doux'),
    ];
    const resultat = calculerFacteurMeteoMesure(
      historique,
      'ensoleille_doux',
      11_500,
      '2026-07-27',
      1,
      3,
      PARAMETRES,
    );
    expect(resultat.enUsage).toBe(false);
    expect(resultat.facteurBp).toBe(11_500);
    expect(resultat.nbObservations).toBe(2);
    expect(resultat.origine).toContain('encore 2/3 dimanche');
  });

  it('état 2 : « rejeté par validation croisée » — assez d’observations, mais pas assez de points évaluables', () => {
    const historique = historiqueDeuxCategoriesSeparees('2026-07-27');
    const resultat = calculerFacteurMeteoMesure(
      historique,
      'ensoleille_doux',
      10_000,
      '2026-07-27',
      100, // minPointsEvalues inatteignable sur 16 sessions.
      4,
      PARAMETRES,
    );
    expect(resultat.enUsage).toBe(false);
    expect(resultat.facteurBp).toBe(10_000); // le prior, inchangé.
    expect(resultat.nbObservations).toBe(8);
    expect(resultat.origine).toContain('rejeté par validation croisée');
  });

  it('état 3 : facteur MESURÉ et ADMIS quand il bat nettement le prior en validation croisée', () => {
    const historique = historiqueDeuxCategoriesSeparees('2026-07-27');
    const resultat = calculerFacteurMeteoMesure(
      historique,
      'ensoleille_doux', // catégorie qui vend nettement plus que l'autre (≈200 vs ≈80, non plates).
      BASE_POINTS, // prior neutre : ne distingue PAS les deux catégories.
      '2026-07-27',
      4,
      4,
      PARAMETRES,
    );
    expect(resultat.enUsage).toBe(true);
    // Le prior était neutre (10000) ; la catégorie vend nettement PLUS que la
    // moyenne générale (mélange 200/80) : le facteur mesuré doit s'élever
    // au-dessus du neutre pour le refléter.
    expect(resultat.facteurBp).toBeGreaterThan(BASE_POINTS);
    expect(resultat.nbObservations).toBe(8);
    expect(resultat.origine).toContain('mesuré sur 8 dimanche');
  });

  it('état 3 (symétrique) : la catégorie qui vend MOINS reçoit un facteur mesuré SOUS le neutre', () => {
    const historique = historiqueDeuxCategoriesSeparees('2026-07-27');
    const resultat = calculerFacteurMeteoMesure(
      historique,
      'pluie_continue', // catégorie qui vend nettement moins que l'autre.
      BASE_POINTS,
      '2026-07-27',
      4,
      4,
      PARAMETRES,
    );
    expect(resultat.enUsage).toBe(true);
    expect(resultat.facteurBp).toBeLessThan(BASE_POINTS);
    expect(resultat.nbObservations).toBe(8);
  });
});
