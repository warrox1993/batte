/**
 * Une depense immobilisee ne se deduit pas deux fois.
 *
 * POURQUOI CE FICHIER EXISTE. `syntheseExercice` additionnait, pour un meme
 * exercice, la TOTALITE des depenses deductibles ET la totalite des annuites
 * d'amortissement. Or `depense.immobilisation_id` existe precisement pour dire
 * « cette depense est l'achat d'un bien immobilise » : son cout part dans le
 * plan, il n'a rien a faire une seconde fois en charge de l'exercice.
 *
 * Le materiel du projet (≈ 3 500 € sur 5 ans, docs/01 module 7) donnait donc
 * 3 500 € de charge en 2026 PLUS 5 x 700 € d'annuites, soit 7 000 € deduits
 * pour un bien de 3 500 €. Un resultat minore de 3 500 € : CLAUDE.md §7
 * interdit de produire un chiffre qui minore ce qui est du.
 */

import { describe, expect, it } from 'vitest';
import {
  montantDeductible,
  montantDeductibleCharge,
  planAmortissement,
  totaliserJournal,
  type Immobilisation,
  type LigneJournal,
} from './comptabilite.js';

/** Le materiel du projet, tel que decrit dans docs/01 module 7. */
const MATERIEL: Immobilisation = {
  libelle: 'Matériel de crêperie ambulante',
  dateAcquisition: '2026-03-15',
  montantCents: 350_000,
  dureeAnnees: 5,
  methode: 'lineaire',
  valeurResiduelleCents: 0,
};

describe('montantDeductibleCharge', () => {
  it('rend zéro sur une dépense immobilisée : elle se déduit par son plan', () => {
    expect(
      montantDeductibleCharge({ montantCents: 350_000, deductibleBp: 10_000, immobilisee: true }),
    ).toBe(0);
  });

  it('se comporte comme montantDeductible sur une dépense ordinaire', () => {
    // Carburant a 60 % professionnel : la part professionnelle joue toujours.
    const ligne = { montantCents: 10_000, deductibleBp: 6000 };
    expect(montantDeductibleCharge(ligne)).toBe(montantDeductible(10_000, 6000));
    expect(montantDeductibleCharge({ ...ligne, immobilisee: false })).toBe(
      montantDeductible(10_000, 6000),
    );
  });

  it('reste symétrique sur une contre-écriture d annulation', () => {
    // Une annulation porte le montant OPPOSE (voir MARQUEUR_ANNULATION dans
    // `packages/db`). Elle doit rendre exactement ce que la depense d'origine
    // avait deduit, sinon un centime reste au journal sans contrepartie.
    const origine = { montantCents: 8888, deductibleBp: 6000 };
    const annulation = { montantCents: -8888, deductibleBp: 6000 };
    expect(montantDeductibleCharge(origine) + montantDeductibleCharge(annulation)).toBe(0);
  });
});

describe('totaliserJournal — dépenses immobilisées', () => {
  const lignes: readonly LigneJournal[] = [
    {
      date: '2026-03-05',
      libelle: 'Carburant',
      categorie: 'carburant',
      montantCents: 6000,
      deductibleBp: 6000,
    },
    {
      date: '2026-03-15',
      libelle: 'Matériel de crêperie',
      categorie: 'materiel',
      montantCents: 350_000,
      deductibleBp: 10_000,
      immobilisee: true,
    },
  ];

  it("garde la dépense immobilisée dans le total décaissé : l'argent est bien sorti", () => {
    const totaux = totaliserJournal(lignes);
    expect(totaux.montantTotalCents).toBe(lignes.reduce((s, l) => s + l.montantCents, 0));
    expect(totaux.parCategorie.get('materiel')).toBe(350_000);
  });

  it("l'exclut du déductible et l'isole dans son propre total", () => {
    const totaux = totaliserJournal(lignes);
    expect(totaux.montantDeductibleCents).toBe(montantDeductible(6000, 6000));
    expect(totaux.montantImmobiliseCents).toBe(350_000);
  });

  it('reconstitue toujours ses totaux ligne à ligne', () => {
    // Invariant, pas valeur absolue : le total rendu est exactement la somme
    // des lignes fournies, quelles qu'elles soient.
    const totaux = totaliserJournal(lignes);
    expect(totaux.montantDeductibleCents).toBe(
      lignes.reduce((s, l) => s + montantDeductibleCharge(l), 0),
    );
    expect([...totaux.parCategorie.values()].reduce((s, v) => s + v, 0)).toBe(
      totaux.montantTotalCents,
    );
  });

  it('laisse un journal sans immobilisation strictement inchangé', () => {
    // Non-regression : le cas courant (aucune depense immobilisee) doit rendre
    // exactement ce que la regle precedente rendait.
    const ordinaires = lignes.filter((l) => l.immobilisee !== true);
    const totaux = totaliserJournal(ordinaires);
    expect(totaux.montantImmobiliseCents).toBe(0);
    expect(totaux.montantDeductibleCents).toBe(
      ordinaires.reduce((s, l) => s + montantDeductible(l.montantCents, l.deductibleBp), 0),
    );
  });
});

describe('LE CALCUL QUI DÉMONTRE LA DOUBLE DÉDUCTION', () => {
  it('déduit le matériel UNE fois sur toute la durée du plan, pas deux', () => {
    const plan = planAmortissement(MATERIEL);
    const achat: LigneJournal = {
      date: MATERIEL.dateAcquisition,
      libelle: MATERIEL.libelle,
      categorie: 'materiel',
      montantCents: MATERIEL.montantCents,
      deductibleBp: 10_000,
      immobilisee: true,
    };

    const chargeParLeJournal = totaliserJournal([achat]).montantDeductibleCents;
    const chargeParLePlan = plan.reduce((s, a) => s + a.montantCents, 0);

    // Le plan porte l'INTEGRALITE de la deduction, le journal n'en porte rien.
    expect(chargeParLeJournal).toBe(0);
    expect(chargeParLePlan).toBe(MATERIEL.montantCents);
    expect(chargeParLeJournal + chargeParLePlan).toBe(MATERIEL.montantCents);

    // L'ancienne regle (`montantDeductible` sur toutes les lignes) donnait le
    // DOUBLE : 3 500 € de charge immediate + 3 500 € d'annuites = 7 000 €.
    const ancienneRegle = montantDeductible(achat.montantCents, achat.deductibleBp);
    expect(ancienneRegle + chargeParLePlan).toBe(2 * MATERIEL.montantCents);
  });
});
