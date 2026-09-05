import { describe, expect, it } from 'vitest';
import {
  agregerEconomies,
  calculerEconomieCents,
  calculerEconomieUnitaireCents,
  estEconomieStrictementPositive,
  partMargeDueAuxEconomiesBp,
  TYPES_ACTION_ECONOMIE,
  type EntreeEconomieAgregation,
} from './economies.js';

describe('calculerEconomieUnitaireCents', () => {
  it('rend un écart positif quand le prix baisse', () => {
    expect(calculerEconomieUnitaireCents(80, 70)).toBe(10);
  });

  it('rend un écart négatif quand le prix monte', () => {
    expect(calculerEconomieUnitaireCents(70, 80)).toBe(-10);
  });

  it('rend 0 sur un prix inchangé', () => {
    expect(calculerEconomieUnitaireCents(80, 80)).toBe(0);
  });
});

describe('calculerEconomieCents — le critère de fin de la fiche 12', () => {
  it('farine T55, 0,80 -> 0,70 €/kg sur 25 kg : 250 centimes économisés', () => {
    // 0,80 €/kg = 80 c/kg, 0,70 €/kg = 70 c/kg, 25 kg = 25 000 g mais le prix
    // est ici exprimé par kg pour coller à l'exemple du porteur : la fonction
    // ne connaît pas l'unité, elle multiplie ce qu'on lui donne.
    expect(calculerEconomieCents(80, 70, 25)).toBe(250);
  });

  it('est un calcul EXACT (soustraction puis produit d’entiers), jamais approximatif', () => {
    // Le cas qui aurait posé problème à une DIVISION (D-044) : ici il n'y en a
    // aucune, donc aucune perte de précision possible, quel que soit le jeu de
    // valeurs.
    expect(calculerEconomieCents(1299, 1201, 3)).toBe(294);
  });

  it('rend un montant négatif si le prix a augmenté : la fonction ne masque pas une hausse', () => {
    expect(calculerEconomieCents(70, 80, 25)).toBe(-250);
  });

  it('rend 0 sur une quantité nulle', () => {
    expect(calculerEconomieCents(80, 70, 0)).toBe(0);
  });
});

describe('estEconomieStrictementPositive', () => {
  it('vraie quand le prix baisse', () => {
    expect(estEconomieStrictementPositive(80, 70)).toBe(true);
  });

  it('fausse sur un prix inchangé : une économie nulle n’est pas une action', () => {
    expect(estEconomieStrictementPositive(80, 80)).toBe(false);
  });

  it('fausse quand le prix augmente', () => {
    expect(estEconomieStrictementPositive(70, 80)).toBe(false);
  });
});

describe('agregerEconomies', () => {
  const lignes: EntreeEconomieAgregation[] = [
    { dateAction: '2026-07-05', typeAction: 'negociation_prix', economieCents: 250 },
    { dateAction: '2026-07-20', typeAction: 'achat_alternatif', economieCents: 100 },
    { dateAction: '2026-08-02', typeAction: 'negociation_prix', economieCents: 50 },
    { dateAction: '2026-08-15', typeAction: 'remplacement_stock_immobilise', economieCents: 30 },
  ];

  it('cumule le total sur toute la période', () => {
    const tableau = agregerEconomies(lignes);
    expect(tableau.totalCents).toBe(430);
    expect(tableau.nbActions).toBe(4);
  });

  it('ventile par mois, trié chronologiquement', () => {
    const tableau = agregerEconomies(lignes);
    expect(tableau.parMois.map((m) => m.mois)).toEqual(['2026-07', '2026-08']);
    expect(tableau.parMois[0]?.totalCents).toBe(350);
    expect(tableau.parMois[0]?.parType.negociation_prix).toBe(250);
    expect(tableau.parMois[0]?.parType.achat_alternatif).toBe(100);
    expect(tableau.parMois[1]?.totalCents).toBe(80);
  });

  it('ventile par type — les QUATRE types sont présents même à 0 action', () => {
    const tableau = agregerEconomies(lignes);
    expect(tableau.parType.map((t) => t.typeAction)).toEqual(TYPES_ACTION_ECONOMIE);
    const autre = tableau.parType.find((t) => t.typeAction === 'autre');
    expect(autre?.totalCents).toBe(0);
    expect(autre?.nbActions).toBe(0);
    const negociation = tableau.parType.find((t) => t.typeAction === 'negociation_prix');
    expect(negociation?.totalCents).toBe(300);
    expect(negociation?.nbActions).toBe(2);
  });

  it('rend un tableau de bord vide, sans lever, sur une liste vide', () => {
    const tableau = agregerEconomies([]);
    expect(tableau.totalCents).toBe(0);
    expect(tableau.nbActions).toBe(0);
    expect(tableau.parMois).toEqual([]);
    expect(tableau.parType.every((t) => t.totalCents === 0 && t.nbActions === 0)).toBe(true);
  });
});

describe('partMargeDueAuxEconomiesBp', () => {
  it('calcule le ratio en points de base', () => {
    // 430 c d'économies sur une marge de 10 000 c (100,00 €) = 4,3 % = 430 bp.
    expect(partMargeDueAuxEconomiesBp(10_000, 430)).toBe(430);
  });

  it('rend null sur une marge nulle : pas de chiffre inventé', () => {
    expect(partMargeDueAuxEconomiesBp(0, 430)).toBeNull();
  });

  it('rend null sur une marge négative', () => {
    expect(partMargeDueAuxEconomiesBp(-500, 430)).toBeNull();
  });

  it('accepte une économie négative (hausse nette) sans lever', () => {
    expect(partMargeDueAuxEconomiesBp(10_000, -100)).toBe(-100);
  });
});
