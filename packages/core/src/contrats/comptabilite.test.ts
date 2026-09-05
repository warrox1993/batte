import { describe, expect, it } from 'vitest';
import {
  agregerVentesParCreneau,
  schemaLigneAgregatCreneau,
  schemaListeVentesParCreneau,
  type LigneVenteCreneauBrute,
} from './comptabilite.js';

/**
 * Fiche 13 (docs/17) : le créneau horaire est saisi, stocké, affiché — et
 * jamais agrégé. `agregerVentesParCreneau` est le calcul qui manquait.
 *
 * Point d'attention repris de la fiche 7 (docs/17) : un coût ou une marge
 * INCONNUE ne doit jamais devenir un 0 silencieux. Plusieurs cas ci-dessous
 * vérifient précisément que `null` reste `null` quand aucune session
 * contributrice n'a de marge connue.
 */

function ligne(partiel: Partial<LigneVenteCreneauBrute>): LigneVenteCreneauBrute {
  return {
    sessionId: 's1',
    creneauHoraire: '10:00–11:00',
    montantCents: 1000,
    quantite: 10,
    margeBruteSessionCents: null,
    margeNetteSessionCents: null,
    ...partiel,
  };
}

describe('agregerVentesParCreneau — CA', () => {
  it('rend un tableau vide quand aucune ligne n’est fournie', () => {
    expect(agregerVentesParCreneau([])).toEqual([]);
  });

  it('cumule le CA et la quantité de deux lignes du même créneau, même session', () => {
    const resultat = agregerVentesParCreneau([
      ligne({ creneauHoraire: '10:00–11:00', montantCents: 1000, quantite: 6 }),
      ligne({ creneauHoraire: '10:00–11:00', montantCents: 500, quantite: 3 }),
    ]);

    expect(resultat).toEqual([
      {
        creneauHoraire: '10:00–11:00',
        nbSessions: 1,
        quantiteVendue: 9,
        caCents: 1500,
        nbSessionsAvecMargeConnue: 0,
        margeBruteEstimeeCents: null,
        margeNetteEstimeeCents: null,
      },
    ]);
  });

  it('cumule deux sessions distinctes sur le même créneau, et compte les deux sessions', () => {
    const resultat = agregerVentesParCreneau([
      ligne({ sessionId: 's1', creneauHoraire: 'matin', montantCents: 1000, quantite: 5 }),
      ligne({ sessionId: 's2', creneauHoraire: 'matin', montantCents: 2000, quantite: 8 }),
    ]);

    expect(resultat).toHaveLength(1);
    expect(resultat[0]).toMatchObject({
      creneauHoraire: 'matin',
      nbSessions: 2,
      quantiteVendue: 13,
      caCents: 3000,
    });
  });

  it('sépare deux créneaux différents de la MÊME session en deux lignes', () => {
    const resultat = agregerVentesParCreneau([
      ligne({ sessionId: 's1', creneauHoraire: '10:00–11:00', montantCents: 4000, quantite: 20 }),
      ligne({ sessionId: 's1', creneauHoraire: '13:00–14:00', montantCents: 1000, quantite: 5 }),
    ]);

    expect(resultat.map((l) => l.creneauHoraire)).toEqual(['10:00–11:00', '13:00–14:00']);
    expect(resultat[0]?.caCents).toBe(4000);
    expect(resultat[1]?.caCents).toBe(1000);
    // La MÊME session compte pour chacun de ses créneaux : « nbSessions »
    // n'est pas une partition de l'effectif total de sessions.
    expect(resultat[0]?.nbSessions).toBe(1);
    expect(resultat[1]?.nbSessions).toBe(1);
  });
});

describe('agregerVentesParCreneau — créneau non renseigné', () => {
  it('garde les ventes sans créneau dans un bucket `null`, jamais silencieusement écarté', () => {
    const resultat = agregerVentesParCreneau([
      ligne({ creneauHoraire: null, montantCents: 700, quantite: 4 }),
    ]);

    expect(resultat).toEqual([
      expect.objectContaining({ creneauHoraire: null, caCents: 700, quantiteVendue: 4 }),
    ]);
  });

  it('trie toujours le bucket `null` en dernier, quel que soit l’ordre alphabétique des créneaux', () => {
    const resultat = agregerVentesParCreneau([
      ligne({ sessionId: 's1', creneauHoraire: '15:00–16:00' }),
      ligne({ sessionId: 's2', creneauHoraire: null }),
      ligne({ sessionId: 's3', creneauHoraire: '09:00–10:00' }),
    ]);

    expect(resultat.map((l) => l.creneauHoraire)).toEqual(['09:00–10:00', '15:00–16:00', null]);
  });
});

describe('agregerVentesParCreneau — marge estimée, jamais un 0 masquant une inconnue', () => {
  it('rend `null` quand AUCUNE session contributrice n’a de marge connue (pas 0)', () => {
    const resultat = agregerVentesParCreneau([
      ligne({ margeBruteSessionCents: null, margeNetteSessionCents: null }),
    ]);

    expect(resultat[0]?.margeBruteEstimeeCents).toBeNull();
    expect(resultat[0]?.margeNetteEstimeeCents).toBeNull();
    expect(resultat[0]?.nbSessionsAvecMargeConnue).toBe(0);
  });

  it('répartit la marge d’une session au prorata EXACT du CA de chaque créneau', () => {
    // Session à 4000 cents de CA total, marge brute 2000 : le créneau qui
    // pèse 75 % du CA doit porter 75 % de la marge, jamais une moyenne brute.
    const resultat = agregerVentesParCreneau([
      ligne({
        sessionId: 's1',
        creneauHoraire: 'matin',
        montantCents: 3000,
        margeBruteSessionCents: 2000,
        margeNetteSessionCents: 1600,
      }),
      ligne({
        sessionId: 's1',
        creneauHoraire: 'apres-midi',
        montantCents: 1000,
        margeBruteSessionCents: 2000,
        margeNetteSessionCents: 1600,
      }),
    ]);

    const matin = resultat.find((l) => l.creneauHoraire === 'matin');
    const apresMidi = resultat.find((l) => l.creneauHoraire === 'apres-midi');
    expect(matin?.margeBruteEstimeeCents).toBe(1500); // 75 % de 2000
    expect(matin?.margeNetteEstimeeCents).toBe(1200); // 75 % de 1600
    expect(apresMidi?.margeBruteEstimeeCents).toBe(500); // 25 % de 2000
    expect(apresMidi?.margeNetteEstimeeCents).toBe(400); // 25 % de 1600
  });

  it('exclut une session à marge inconnue du calcul SANS la compter comme 0, quand d’autres l’ont', () => {
    const resultat = agregerVentesParCreneau([
      ligne({
        sessionId: 's1',
        creneauHoraire: 'matin',
        montantCents: 1000,
        margeBruteSessionCents: 400,
        margeNetteSessionCents: 300,
      }),
      ligne({
        sessionId: 's2',
        creneauHoraire: 'matin',
        montantCents: 1000,
        margeBruteSessionCents: null,
        margeNetteSessionCents: null,
      }),
    ]);

    // Une seule des deux sessions a une marge connue : l'estimation ne porte
    // que sur elle (400, pas (400 + 0) / 2 = 200).
    expect(resultat[0]?.margeBruteEstimeeCents).toBe(400);
    expect(resultat[0]?.margeNetteEstimeeCents).toBe(300);
    expect(resultat[0]?.nbSessionsAvecMargeConnue).toBe(1);
    expect(resultat[0]?.nbSessions).toBe(2);
  });

  it('traite marge brute et marge nette comme deux inconnues INDÉPENDANTES', () => {
    // Cas limite : une session porte une marge brute connue mais une marge
    // nette encore nulle (frais de session pas tous saisis). Conflater les
    // deux ferait perdre la marge brute réellement connue.
    const resultat = agregerVentesParCreneau([
      ligne({
        sessionId: 's1',
        creneauHoraire: 'matin',
        montantCents: 1000,
        margeBruteSessionCents: 500,
        margeNetteSessionCents: null,
      }),
    ]);

    expect(resultat[0]?.margeBruteEstimeeCents).toBe(500);
    expect(resultat[0]?.margeNetteEstimeeCents).toBeNull();
  });

  it('arrondit à l’entier le plus proche (des centimes ne se fractionnent pas)', () => {
    const resultat = agregerVentesParCreneau([
      ligne({
        sessionId: 's1',
        creneauHoraire: 'matin',
        montantCents: 1,
        margeBruteSessionCents: 100,
        margeNetteSessionCents: 100,
      }),
      ligne({
        sessionId: 's1',
        creneauHoraire: 'soir',
        montantCents: 2,
        margeBruteSessionCents: 100,
        margeNetteSessionCents: 100,
      }),
    ]);

    // 1/3 de 100 = 33,33… -> 33 ; 2/3 de 100 = 66,66… -> 67.
    const matin = resultat.find((l) => l.creneauHoraire === 'matin');
    const soir = resultat.find((l) => l.creneauHoraire === 'soir');
    expect(matin?.margeBruteEstimeeCents).toBe(33);
    expect(soir?.margeBruteEstimeeCents).toBe(67);
  });

  it('ne divise jamais par zéro quand le CA total d’une session est nul', () => {
    expect(() =>
      agregerVentesParCreneau([
        ligne({ sessionId: 's1', montantCents: 0, margeBruteSessionCents: 100 }),
      ]),
    ).not.toThrow();
    const resultat = agregerVentesParCreneau([
      ligne({ sessionId: 's1', montantCents: 0, margeBruteSessionCents: 100 }),
    ]);
    expect(resultat[0]?.margeBruteEstimeeCents).toBeNull();
  });
});

describe('schemaLigneAgregatCreneau / schemaListeVentesParCreneau', () => {
  it('accepte la forme produite par agregerVentesParCreneau', () => {
    const resultat = agregerVentesParCreneau([
      ligne({ margeBruteSessionCents: 400, margeNetteSessionCents: 300 }),
    ]);
    for (const l of resultat) expect(() => schemaLigneAgregatCreneau.parse(l)).not.toThrow();
  });

  it('accepte une liste complète avec ses métadonnées', () => {
    expect(() =>
      schemaListeVentesParCreneau.parse({
        data: agregerVentesParCreneau([ligne({})]),
        meta: { annee: 2026, nbSessionsCloturees: 1 },
      }),
    ).not.toThrow();
  });

  it('rejette un créneau qui ne serait ni une chaîne ni `null`', () => {
    expect(() =>
      schemaLigneAgregatCreneau.parse({
        creneauHoraire: 42,
        nbSessions: 1,
        quantiteVendue: 1,
        caCents: 100,
        nbSessionsAvecMargeConnue: 0,
        margeBruteEstimeeCents: null,
        margeNetteEstimeeCents: null,
      }),
    ).toThrow();
  });
});
