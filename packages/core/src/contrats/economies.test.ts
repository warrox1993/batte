import { describe, expect, it } from 'vitest';
import {
  schemaCreationEconomie,
  schemaEconomieLigne,
  schemaListeEconomies,
  schemaRenegociationTarif,
  schemaResultatRenegociation,
  schemaTableauBordEconomies,
} from './economies.js';

const LIGNE_VALIDE = {
  id: 'eco-1',
  dateAction: '2026-07-28',
  ingredientId: 'ing-1',
  ingredientNom: 'Farine de froment T55',
  fournisseurId: 'four-1',
  fournisseurNom: 'Moulin de la Batte',
  conditionnementId: null,
  conditionnementLibelle: null,
  typeAction: 'negociation_prix',
  description: 'Renégociation annuelle',
  prixUnitaireAvantCents: 80,
  prixUnitaireApresCents: 70,
  quantiteConcernee: 25,
  economieCents: 250,
  commandeId: null,
  commandeNumero: null,
  saisiPar: null,
  creeLe: '2026-07-28T10:00:00.000Z',
};

describe('schemaEconomieLigne', () => {
  it('accepte une ligne complète', () => {
    expect(schemaEconomieLigne.parse(LIGNE_VALIDE)).toEqual(LIGNE_VALIDE);
  });

  it('rejette un type d’action inconnu', () => {
    expect(() => schemaEconomieLigne.parse({ ...LIGNE_VALIDE, typeAction: 'invente' })).toThrow();
  });
});

describe('schemaListeEconomies', () => {
  it('accepte une liste avec ses métadonnées', () => {
    const liste = { data: [LIGNE_VALIDE], meta: { total: 1, economieTotaleCents: 250 } };
    expect(schemaListeEconomies.parse(liste)).toEqual(liste);
  });
});

describe('schemaCreationEconomie', () => {
  it('normalise les champs facultatifs absents en null', () => {
    const saisie = schemaCreationEconomie.parse({
      dateAction: '2026-07-28',
      ingredientId: 'ing-1',
      fournisseurId: 'four-1',
      typeAction: 'remplacement_stock_immobilise',
      description: 'Excédent réutilisé avant la DLC',
      prixUnitaireAvantCents: 100,
      prixUnitaireApresCents: 0,
      quantiteConcernee: 5,
    });
    expect(saisie.conditionnementId).toBeNull();
    expect(saisie.commandeId).toBeNull();
    expect(saisie.saisiPar).toBeNull();
  });

  it('rejette une description vide : c’est la justification de l’économie', () => {
    expect(() =>
      schemaCreationEconomie.parse({
        dateAction: '2026-07-28',
        ingredientId: 'ing-1',
        fournisseurId: 'four-1',
        typeAction: 'autre',
        description: '   ',
        prixUnitaireAvantCents: 100,
        prixUnitaireApresCents: 90,
        quantiteConcernee: 1,
      }),
    ).toThrow();
  });

  it('rejette une quantité nulle ou négative', () => {
    expect(() =>
      schemaCreationEconomie.parse({
        dateAction: '2026-07-28',
        ingredientId: 'ing-1',
        fournisseurId: 'four-1',
        typeAction: 'autre',
        description: 'Test',
        prixUnitaireAvantCents: 100,
        prixUnitaireApresCents: 90,
        quantiteConcernee: 0,
      }),
    ).toThrow();
  });
});

describe('schemaRenegociationTarif', () => {
  it('normalise description, référence et saisiPar absents en null', () => {
    const saisie = schemaRenegociationTarif.parse({
      conditionnementId: 'cond-1',
      prixCents: 70,
      datePrix: '2026-07-28',
      quantiteConcernee: 25,
    });
    expect(saisie.description).toBeNull();
    expect(saisie.referenceFournisseur).toBeNull();
    expect(saisie.saisiPar).toBeNull();
  });

  it('rejette une date mal formée', () => {
    expect(() =>
      schemaRenegociationTarif.parse({
        conditionnementId: 'cond-1',
        prixCents: 70,
        datePrix: '28/07/2026',
        quantiteConcernee: 25,
      }),
    ).toThrow();
  });
});

describe('schemaResultatRenegociation', () => {
  it('accepte une économie nulle : un tarif qui monte ne produit aucune ligne', () => {
    const resultat = {
      conditionnementId: 'cond-1',
      ancienPrixCents: 70,
      nouveauPrixCents: 80,
      economie: null,
    };
    expect(schemaResultatRenegociation.parse(resultat)).toEqual(resultat);
  });

  it('accepte une économie enregistrée', () => {
    const resultat = {
      conditionnementId: 'cond-1',
      ancienPrixCents: 80,
      nouveauPrixCents: 70,
      economie: LIGNE_VALIDE,
    };
    expect(schemaResultatRenegociation.parse(resultat)).toEqual(resultat);
  });
});

describe('schemaTableauBordEconomies', () => {
  it('accepte un tableau de bord complet, avec les quatre types présents', () => {
    const tableau = {
      periode: { debut: '2026-01-01', fin: '2026-12-31T23:59:59.999Z' },
      totalCents: 250,
      nbActions: 1,
      parMois: [
        {
          mois: '2026-07',
          parType: {
            negociation_prix: 250,
            achat_alternatif: 0,
            remplacement_stock_immobilise: 0,
            autre: 0,
          },
          totalCents: 250,
        },
      ],
      parType: [
        { typeAction: 'negociation_prix', totalCents: 250, nbActions: 1 },
        { typeAction: 'achat_alternatif', totalCents: 0, nbActions: 0 },
        { typeAction: 'remplacement_stock_immobilise', totalCents: 0, nbActions: 0 },
        { typeAction: 'autre', totalCents: 0, nbActions: 0 },
      ],
      partMargeBp: 430,
    };
    expect(schemaTableauBordEconomies.parse(tableau)).toEqual(tableau);
  });

  it('accepte une part de marge nulle (marge inconnue ou négative)', () => {
    expect(
      schemaTableauBordEconomies.parse({
        periode: { debut: '2026-01-01', fin: '2026-12-31T23:59:59.999Z' },
        totalCents: 0,
        nbActions: 0,
        parMois: [],
        parType: [
          { typeAction: 'negociation_prix', totalCents: 0, nbActions: 0 },
          { typeAction: 'achat_alternatif', totalCents: 0, nbActions: 0 },
          { typeAction: 'remplacement_stock_immobilise', totalCents: 0, nbActions: 0 },
          { typeAction: 'autre', totalCents: 0, nbActions: 0 },
        ],
        partMargeBp: null,
      }).partMargeBp,
    ).toBeNull();
  });
});
