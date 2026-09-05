import { describe, expect, it } from 'vitest';
import {
  evaluerAnticipationSeuil,
  evaluerNiveau,
  evaluerPaliersSerie,
  trimestreCivil,
  type EvenementSerie,
  type PalierNiveau,
  type PalierSerie,
} from './succes.js';

const PALIERS: readonly PalierSerie[] = [
  { niveau: 1, longueurRequise: 3, libelle: 'Trois' },
  { niveau: 2, longueurRequise: 5, libelle: 'Cinq' },
];

function evenement(date: string, reussite: boolean): EvenementSerie {
  return { date, reussite };
}

describe('evaluerPaliersSerie', () => {
  it('ne débloque rien sur un historique vide', () => {
    const resultat = evaluerPaliersSerie([], PALIERS);
    expect(resultat.meilleureSerieLongueur).toBe(0);
    expect(resultat.serieActuelleLongueur).toBe(0);
    expect(resultat.paliers.every((p) => p.debloqueLe === null)).toBe(true);
  });

  it('débloque le palier de trois à la date de la troisième réussite consécutive', () => {
    const resultat = evaluerPaliersSerie(
      [
        evenement('2026-01-01', true),
        evenement('2026-01-08', true),
        evenement('2026-01-15', true),
        evenement('2026-01-22', false),
      ],
      PALIERS,
    );
    const palier3 = resultat.paliers.find((p) => p.niveau === 1);
    expect(palier3?.debloqueLe).toBe('2026-01-15');
    const palier5 = resultat.paliers.find((p) => p.niveau === 2);
    expect(palier5?.debloqueLe).toBeNull();
    expect(resultat.meilleureSerieLongueur).toBe(3);
    // La série casse au dernier événement : la série EN COURS retombe à zéro.
    expect(resultat.serieActuelleLongueur).toBe(0);
  });

  it('reste débloqué même si la série casse ensuite (rétroactif, §5.2)', () => {
    const resultat = evaluerPaliersSerie(
      [
        evenement('2026-01-01', true),
        evenement('2026-01-08', true),
        evenement('2026-01-15', true),
        evenement('2026-01-22', false),
        evenement('2026-01-29', false),
      ],
      PALIERS,
    );
    expect(resultat.paliers.find((p) => p.niveau === 1)?.debloqueLe).toBe('2026-01-15');
  });

  it('prend la PREMIÈRE série qui atteint la longueur requise, pas la meilleure', () => {
    const resultat = evaluerPaliersSerie(
      [
        evenement('2026-01-01', true),
        evenement('2026-01-08', true),
        evenement('2026-01-15', true), // premier déblocage du palier "3" ici
        evenement('2026-01-22', false),
        evenement('2026-01-29', true),
        evenement('2026-02-05', true),
        evenement('2026-02-12', true),
        evenement('2026-02-19', true),
        evenement('2026-02-26', true), // meilleure série : 5, débloque le palier "5" ici
      ],
      PALIERS,
    );
    expect(resultat.paliers.find((p) => p.niveau === 1)?.debloqueLe).toBe('2026-01-15');
    expect(resultat.paliers.find((p) => p.niveau === 2)?.debloqueLe).toBe('2026-02-26');
    expect(resultat.meilleureSerieLongueur).toBe(5);
    expect(resultat.serieActuelleLongueur).toBe(5);
  });

  it('trie les paliers reçus dans le désordre', () => {
    const resultat = evaluerPaliersSerie(
      [evenement('2026-01-01', true), evenement('2026-01-08', true), evenement('2026-01-15', true)],
      [PALIERS[1]!, PALIERS[0]!],
    );
    expect(resultat.paliers.map((p) => p.niveau)).toEqual([1, 2]);
  });
});

describe('evaluerNiveau', () => {
  const PALIERS_NIVEAU: readonly PalierNiveau[] = [
    { niveau: 1, seuil: 1_000, libelle: 'Mille' },
    { niveau: 2, seuil: 5_000, libelle: 'Cinq mille' },
    { niveau: 3, seuil: 10_000, libelle: 'Dix mille' },
  ];

  it('rend le niveau 0 sous le premier palier', () => {
    const resultat = evaluerNiveau(500, PALIERS_NIVEAU);
    expect(resultat.niveauActuel).toBe(0);
    expect(resultat.libelleNiveauActuel).toBeNull();
    expect(resultat.prochainPalier?.niveau).toBe(1);
    expect(resultat.progressionVersProchainBp).toBe(5_000);
  });

  it('rend le palier exact quand la valeur l’égale pile', () => {
    const resultat = evaluerNiveau(5_000, PALIERS_NIVEAU);
    expect(resultat.niveauActuel).toBe(2);
    expect(resultat.libelleNiveauActuel).toBe('Cinq mille');
    expect(resultat.prochainPalier?.niveau).toBe(3);
  });

  it('rend le dernier palier et aucun prochain palier au-delà du plus haut seuil', () => {
    const resultat = evaluerNiveau(50_000, PALIERS_NIVEAU);
    expect(resultat.niveauActuel).toBe(3);
    expect(resultat.prochainPalier).toBeNull();
    expect(resultat.progressionVersProchainBp).toBeNull();
  });

  it('trie les paliers reçus dans le désordre', () => {
    const resultat = evaluerNiveau(6_000, [
      PALIERS_NIVEAU[2]!,
      PALIERS_NIVEAU[0]!,
      PALIERS_NIVEAU[1]!,
    ]);
    expect(resultat.niveauActuel).toBe(2);
  });
});

describe('evaluerAnticipationSeuil', () => {
  it('rend tout à null si le plafond n’a jamais été franchi', () => {
    const resultat = evaluerAnticipationSeuil({
      cle: 'seuil_test',
      libelle: 'Seuil test',
      serie: [
        { date: '2026-01-04', cumulRealiseCents: 50_000, sessionsTenues: 1 },
        { date: '2026-01-11', cumulRealiseCents: 90_000, sessionsTenues: 2 },
      ],
      plafondCents: 2_500_000,
      sessionsPrevuesDansLAnnee: 50,
    });
    expect(resultat.dateFranchissementReel).toBeNull();
    expect(resultat.joursAnticipation).toBeNull();
  });

  it('mesure l’avance de la première alerte projetée sur le franchissement réel', () => {
    // Rythme constant de 100 000 c/session, plafond à 500 000 : franchi à la
    // 5e session. Dès que sessionsTenues >= 2, la projection au rythme observé
    // (realise / sessionsTenues * sessionsPrevues) dépasse déjà le plafond
    // avec sessionsPrevuesDansLAnnee assez grand.
    const resultat = evaluerAnticipationSeuil({
      cle: 'seuil_test',
      libelle: 'Seuil test',
      serie: [
        { date: '2026-01-04', cumulRealiseCents: 100_000, sessionsTenues: 1 },
        { date: '2026-01-11', cumulRealiseCents: 200_000, sessionsTenues: 2 },
        { date: '2026-01-18', cumulRealiseCents: 300_000, sessionsTenues: 3 },
        { date: '2026-01-25', cumulRealiseCents: 400_000, sessionsTenues: 4 },
        { date: '2026-02-01', cumulRealiseCents: 500_000, sessionsTenues: 5 },
      ],
      plafondCents: 500_000,
      sessionsPrevuesDansLAnnee: 10,
    });
    expect(resultat.dateFranchissementReel).toBe('2026-02-01');
    // Projection à la 2e session : 200 000 / 2 * 10 = 1 000 000 >= 500 000 plafond.
    expect(resultat.datePremiereAlerte).toBe('2026-01-11');
    expect(resultat.joursAnticipation).toBe(21);
  });
});

describe('trimestreCivil', () => {
  it('associe chaque mois au bon trimestre', () => {
    expect(trimestreCivil('2026-01-15')).toBe('2026-T1');
    expect(trimestreCivil('2026-03-31')).toBe('2026-T1');
    expect(trimestreCivil('2026-04-01')).toBe('2026-T2');
    expect(trimestreCivil('2026-06-30')).toBe('2026-T2');
    expect(trimestreCivil('2026-07-28')).toBe('2026-T3');
    expect(trimestreCivil('2026-09-30')).toBe('2026-T3');
    expect(trimestreCivil('2026-10-01')).toBe('2026-T4');
    expect(trimestreCivil('2026-12-31')).toBe('2026-T4');
  });
});
