import { describe, expect, it } from 'vitest';
import { ErreurMetier } from './erreurs.js';
import {
  CATALOGUE_ECHEANCES,
  construireCatalogueEcheances,
  estimerResultat,
  joursAvantEcheance,
  montantDeductible,
  planAmortissement,
  prochaineOccurrence,
  prochaineOccurrenceEcheance,
  totaliserJournal,
  valeurNetteComptable,
  type DefinitionEcheance,
  type Immobilisation,
  type MethodeAmortissement,
} from './comptabilite.js';
import { CATALOGUE_PARAMETRES, Parametres } from './parametres.js';

/** Le materiel du projet : ~3 500 € amortis sur 5 ans (docs/01 module 7). */
const MATERIEL: Immobilisation = {
  libelle: 'Matériel de crêperie ambulante',
  dateAcquisition: '2026-03-15',
  montantCents: 350_000,
  dureeAnnees: 5,
  methode: 'lineaire',
  valeurResiduelleCents: 0,
};

describe('planAmortissement — linéaire', () => {
  it('étale le montant sur la durée', () => {
    const plan = planAmortissement(MATERIEL);
    expect(plan).toHaveLength(5);
    expect(plan[0]?.montantCents).toBe(70_000);
    expect(plan[0]?.exercice).toBe(2026);
    expect(plan[4]?.exercice).toBe(2030);
  });

  it('somme EXACTEMENT au montant amortissable', () => {
    // Un plan dont le total ne correspond pas au bien est inexploitable par un
    // comptable : la derniere annuite absorbe l'arrondi.
    const plan = planAmortissement({ ...MATERIEL, montantCents: 350_003, dureeAnnees: 3 });
    const somme = plan.reduce((total, a) => total + a.montantCents, 0);
    expect(somme).toBe(350_003);
  });

  it('amène la valeur nette à zéro en fin de plan', () => {
    const plan = planAmortissement(MATERIEL);
    expect(plan.at(-1)?.valeurNetteFinCents).toBe(0);
  });

  it("n'amortit pas la valeur résiduelle", () => {
    // On n'amortit pas ce qu'on compte recuperer a la revente.
    const plan = planAmortissement({ ...MATERIEL, valeurResiduelleCents: 50_000 });
    const somme = plan.reduce((total, a) => total + a.montantCents, 0);
    expect(somme).toBe(300_000);
    expect(plan.at(-1)?.valeurNetteFinCents).toBe(50_000);
  });
});

describe('planAmortissement — dégressif', () => {
  it('charge davantage les premières années', () => {
    const plan = planAmortissement({ ...MATERIEL, methode: 'degressive' });
    expect(plan[0]!.montantCents).toBeGreaterThan(plan[1]!.montantCents);
    expect(plan[1]!.montantCents).toBeGreaterThan(plan[2]!.montantCents);
  });

  it('somme aussi exactement au montant amortissable', () => {
    const plan = planAmortissement({ ...MATERIEL, methode: 'degressive' });
    const somme = plan.reduce((total, a) => total + a.montantCents, 0);
    expect(somme).toBe(350_000);
  });
});

describe('planAmortissement — refus', () => {
  it('refuse une durée nulle', () => {
    expect(() => planAmortissement({ ...MATERIEL, dureeAnnees: 0 })).toThrow(ErreurMetier);
  });

  it('refuse un montant nul', () => {
    expect(() => planAmortissement({ ...MATERIEL, montantCents: 0 })).toThrow(ErreurMetier);
  });

  it("refuse une valeur résiduelle égale au prix : il n'y aurait rien à amortir", () => {
    expect(() => planAmortissement({ ...MATERIEL, valeurResiduelleCents: 350_000 })).toThrow(
      ErreurMetier,
    );
  });

  /**
   * NON-REGRESSION. Sur une duree fractionnaire, le test d'absorption de
   * l'arrondi (`index === duree − 1`) n'etait jamais vrai : personne ne
   * rattrapait le reliquat. 1 000 € sur 2,5 ans produisait 3 x 400 € = 1 200 €,
   * soit 200 € d'amortissement fantome et une valeur nette finale NEGATIVE.
   */
  it('refuse une durée fractionnaire plutôt que de sur-amortir', () => {
    expect(() =>
      planAmortissement({ ...MATERIEL, montantCents: 100_000, dureeAnnees: 2.5 }),
    ).toThrow(ErreurMetier);
    // Le message dit quoi faire, pas seulement que c'est faux.
    expect(() =>
      planAmortissement({ ...MATERIEL, montantCents: 100_000, dureeAnnees: 2.5 }),
    ).toThrow(/années entières/);
  });

  it('refuse une durée non finie', () => {
    expect(() => planAmortissement({ ...MATERIEL, dureeAnnees: Number.NaN })).toThrow(ErreurMetier);
    expect(() => planAmortissement({ ...MATERIEL, dureeAnnees: Number.POSITIVE_INFINITY })).toThrow(
      ErreurMetier,
    );
  });

  it('refuse un montant à virgule : les centimes sont des entiers', () => {
    expect(() => planAmortissement({ ...MATERIEL, montantCents: 350_000.5 })).toThrow(ErreurMetier);
    expect(() => planAmortissement({ ...MATERIEL, valeurResiduelleCents: 0.5 })).toThrow(
      ErreurMetier,
    );
  });

  it('refuse une valeur résiduelle négative', () => {
    // Sans ce garde-fou, une residuelle negative GONFLE le montant amortissable.
    expect(() => planAmortissement({ ...MATERIEL, valeurResiduelleCents: -1 })).toThrow(
      ErreurMetier,
    );
  });

  it("refuse une date d'acquisition illisible : le premier exercice en dépend", () => {
    expect(() => planAmortissement({ ...MATERIEL, dateAcquisition: 'hier' })).toThrow(ErreurMetier);
  });
});

describe('planAmortissement — montants dérisoires', () => {
  /**
   * NON-REGRESSION. En lineaire, les n−1 premieres annuites valaient
   * `round(A/n)` sans plafond : leur somme pouvait DEPASSER l'amortissable et
   * rendre la derniere annuite negative. Cas minimal : 2 centimes sur 4 ans,
   * qui donnait 1, 1, 1, −1. Une annuite negative serait une reprise
   * d'amortissement, ce que ce plan ne represente pas.
   */
  it('ne produit jamais d annuité négative sur 2 centimes en 4 ans', () => {
    const plan = planAmortissement({
      libelle: 'Cas limite',
      dateAcquisition: '2026-01-01',
      montantCents: 2,
      dureeAnnees: 4,
      methode: 'lineaire',
      valeurResiduelleCents: 0,
    });
    for (const annuite of plan) {
      expect(annuite.montantCents).toBeGreaterThanOrEqual(0);
      expect(annuite.valeurNetteFinCents).toBeGreaterThanOrEqual(0);
    }
    expect(plan.reduce((s, a) => s + a.montantCents, 0)).toBe(2);
  });

  it('tient sur toute la plage où le défaut apparaissait (A < 0,5·n·(n−1))', () => {
    // Balayage exhaustif des petits montants : c'est la seule zone concernee,
    // autant la couvrir entierement plutot que d'echantillonner.
    const methodes: readonly MethodeAmortissement[] = ['lineaire', 'degressive'];
    for (const methode of methodes) {
      for (let montantCents = 1; montantCents <= 40; montantCents += 1) {
        for (let dureeAnnees = 1; dureeAnnees <= 20; dureeAnnees += 1) {
          const plan = planAmortissement({
            libelle: 'Balayage',
            dateAcquisition: '2026-01-01',
            montantCents,
            dureeAnnees,
            methode,
            valeurResiduelleCents: 0,
          });
          const contexte = `${methode} ${montantCents}c / ${dureeAnnees} ans`;

          expect(plan, contexte).toHaveLength(dureeAnnees);
          expect(
            plan.reduce((s, a) => s + a.montantCents, 0),
            contexte,
          ).toBe(montantCents);

          let precedent = montantCents;
          for (const annuite of plan) {
            expect(Number.isInteger(annuite.montantCents), contexte).toBe(true);
            expect(annuite.montantCents, contexte).toBeGreaterThanOrEqual(0);
            expect(annuite.valeurNetteFinCents, contexte).toBeLessThanOrEqual(precedent);
            expect(annuite.valeurNetteFinCents, contexte).toBeGreaterThanOrEqual(0);
            precedent = annuite.valeurNetteFinCents;
          }
          expect(plan.at(-1)?.valeurNetteFinCents, contexte).toBe(0);
        }
      }
    }
  });
});

describe('valeurNetteComptable', () => {
  it('rend le prix d achat avant le premier exercice', () => {
    expect(valeurNetteComptable(MATERIEL, 2025)).toBe(350_000);
  });

  it('décroît exercice après exercice', () => {
    expect(valeurNetteComptable(MATERIEL, 2026)).toBe(280_000);
    expect(valeurNetteComptable(MATERIEL, 2028)).toBe(140_000);
    expect(valeurNetteComptable(MATERIEL, 2030)).toBe(0);
  });
});

describe('montantDeductible', () => {
  it('applique la part professionnelle', () => {
    // Carburant a 60 % professionnel sur 100 € -> 60 € deductibles.
    expect(montantDeductible(10_000, 6000)).toBe(6000);
  });

  it('laisse intact ce qui est entièrement déductible', () => {
    expect(montantDeductible(10_000, 10_000)).toBe(10_000);
  });
});

describe('totaliserJournal', () => {
  const lignes = [
    {
      date: '2026-03-01',
      libelle: 'Emplacement mars',
      categorie: 'emplacement',
      montantCents: 8800,
      deductibleBp: 10_000,
    },
    {
      date: '2026-03-05',
      libelle: 'Carburant',
      categorie: 'carburant',
      montantCents: 6000,
      deductibleBp: 6000,
    },
  ];

  it('sépare le total du déductible', () => {
    const totaux = totaliserJournal(lignes);
    expect(totaux.montantTotalCents).toBe(14_800);
    expect(totaux.montantDeductibleCents).toBe(12_400); // 8800 + 3600
  });

  it('ventile par catégorie', () => {
    const totaux = totaliserJournal(lignes);
    expect(totaux.parCategorie.get('emplacement')).toBe(8800);
    expect(totaux.parCategorie.get('carburant')).toBe(6000);
  });

  it('rend des totaux nuls sur un journal vide', () => {
    const totaux = totaliserJournal([]);
    expect(totaux.montantTotalCents).toBe(0);
    expect(totaux.parCategorie.size).toBe(0);
  });
});

describe('estimerResultat', () => {
  const base = {
    recettesCents: 1_500_000,
    depensesDeductiblesCents: 400_000,
    amortissementsCents: 70_000,
    tauxCotisationBp: 2050,
    tauxImpotBp: 4000,
  };

  it('déduit dépenses et amortissements du bénéfice brut', () => {
    expect(estimerResultat(base).beneficeBrutCents).toBe(1_030_000);
  });

  it('calcule l impôt APRÈS déduction des cotisations sociales', () => {
    const r = estimerResultat(base);
    expect(r.cotisationsSocialesCents).toBe(211_150); // 20,50 %
    expect(r.impotEstimeCents).toBe(327_540); // 40 % de (1 030 000 − 211 150)
  });

  it('ne crée NI cotisation NI impôt sur une perte', () => {
    // Une perte ne cree pas de dette fiscale, et un montant negatif induirait
    // en erreur.
    const perte = estimerResultat({ ...base, recettesCents: 100_000 });
    expect(perte.beneficeBrutCents).toBeLessThan(0);
    expect(perte.cotisationsSocialesCents).toBe(0);
    expect(perte.impotEstimeCents).toBe(0);
    expect(perte.netEstimeCents).toBe(perte.beneficeBrutCents);
  });
});

/** Retrouve une echeance du catalogue, sans recopier ses dates dans le test. */
function echeanceDuCatalogue(fragmentDuLibelle: string): DefinitionEcheance {
  const trouvee = CATALOGUE_ECHEANCES.find((e) => e.libelle.includes(fragmentDuLibelle));
  if (trouvee === undefined) throw new Error(`Échéance « ${fragmentDuLibelle} » absente.`);
  return trouvee;
}

describe('CATALOGUE_ECHEANCES', () => {
  it('couvre les cinq échéances réglementaires identifiées', () => {
    expect(CATALOGUE_ECHEANCES.length).toBeGreaterThanOrEqual(5);
  });

  it('documente une source pour chaque échéance', () => {
    // Une date sans source est inverifiable l'annee suivante.
    for (const echeance of CATALOGUE_ECHEANCES) {
      expect(echeance.sourceLegale.length, echeance.libelle).toBeGreaterThan(20);
    }
  });

  it('inclut le listing TVA, obligatoire même à zéro', () => {
    const listing = echeanceDuCatalogue('Listing');
    expect(listing.jourReference).toBe('03-31');
    expect(listing.sourceLegale).toContain('même à zéro');
  });

  it('signale que la tolérance de 10 % sur la TVA a disparu', () => {
    expect(echeanceDuCatalogue('e604B').sourceLegale).toContain('DISPARU');
  });

  it('déclare QUATRE dates pour la cotisation INASTI trimestrielle', () => {
    // C'est le coeur du defaut corrige : trois des quatre echeances INASTI
    // n'existaient que dans le texte libre de `sourceLegale`, que rien ne lit.
    const inasti = echeanceDuCatalogue('INASTI');
    expect(inasti.recurrence).toBe('trimestrielle');
    expect([inasti.jourReference, ...inasti.joursSupplementaires]).toHaveLength(4);
  });

  it('ne déclare de jours supplémentaires que sur une trimestrielle', () => {
    for (const echeance of CATALOGUE_ECHEANCES) {
      if (echeance.recurrence !== 'trimestrielle') {
        expect(echeance.joursSupplementaires, echeance.libelle).toEqual([]);
      }
    }
  });

  it('avertit que les dates INASTI sont à reconfirmer chaque année', () => {
    // CLAUDE.md §7 : les dates sont publiees par la caisse et changent d'une
    // annee a l'autre. Les reconduire en silence serait fabriquer une certitude.
    expect(echeanceDuCatalogue('INASTI').sourceLegale).toContain('reconfirmer');
  });

  it("dit que l'autorisation ambulante exige la date réelle de délivrance", () => {
    const ambulant = echeanceDuCatalogue('ambulantes');
    expect(ambulant.recurrence).toBe('quinquennale');
    expect(ambulant.sourceLegale).toContain('délivrance');
  });

  it('ne déclare que des jours qui existent toutes les années', () => {
    for (const echeance of CATALOGUE_ECHEANCES) {
      for (const jour of [echeance.jourReference, ...echeance.joursSupplementaires]) {
        // Une annee bissextile et une annee commune : le 29 février serait pris.
        expect(() => prochaineOccurrence(jour, '2027-01-01'), echeance.libelle).not.toThrow();
        expect(() => prochaineOccurrence(jour, '2028-01-01'), echeance.libelle).not.toThrow();
      }
    }
  });
});

describe('construireCatalogueEcheances — source de vérité déplacée vers `parametre` (docs/29 §6 point 1)', () => {
  /**
   * NON-REGRESSION centrale de cette migration : `CATALOGUE_ECHEANCES` reste
   * construit avec EXACTEMENT les mêmes jours, sources et URL qu'avant —
   * seul l'ENDROIT où ces valeurs sont écrites a changé (packages/core/src/
   * parametres.ts, plus packages/core/src/comptabilite.ts). Les littéraux
   * ci-dessous sont recopiés depuis le code d'AVANT cette migration, pas
   * depuis le nouveau catalogue : un test qui relirait `parametres.ts` pour
   * vérifier `parametres.ts` ne prouverait rien.
   */
  it('reproduit exactement les 5 échéances précédemment codées en dur', () => {
    expect(CATALOGUE_ECHEANCES).toEqual([
      {
        libelle: 'Listing clients TVA',
        recurrence: 'annuelle',
        jourReference: '03-31',
        joursSupplementaires: [],
        sourceLegale:
          'Obligatoire même à zéro depuis 2026, avec communication du chiffre d’affaires total ' +
          "de l'année précédente. Délai exceptionnellement porté au 30 avril pour 2026.",
        urlSource: null,
        pasAnnees: 1,
      },
      {
        libelle: 'Cotisation INASTI (trimestrielle)',
        recurrence: 'trimestrielle',
        jourReference: '04-10',
        joursSupplementaires: ['07-10', '10-12', '12-21'],
        sourceLegale:
          'Quatre échéances par an, à dates irrégulières fixées par la caisse d’assurances ' +
          'sociales : 10 avril, 10 juillet, 12 octobre et 21 décembre pour 2026. Ces jours ' +
          'sont reconduits tels quels les années suivantes faute de mieux — à reconfirmer ' +
          'chaque année auprès de la caisse, un retard entraînant des majorations.',
        urlSource: null,
        pasAnnees: 1,
      },
      {
        libelle: 'Contribution annuelle AFSCA',
        recurrence: 'annuelle',
        jourReference: '03-02',
        joursSupplementaires: [],
        sourceLegale:
          'Campagne ouverte le 2 mars 2026. Tarif starter 102,71 € avec autorisation, ' +
          '51,36 € sinon. À reconfirmer chaque année.',
        urlSource: null,
        pasAnnees: 1,
      },
      {
        libelle: "Renouvellement de l'autorisation d'activités ambulantes",
        recurrence: 'quinquennale',
        jourReference: '01-01',
        joursSupplementaires: [],
        sourceLegale:
          'Tous les 5 ans en Wallonie, à compter de la première délivrance. Le 1er janvier ' +
          "n'est qu'un repère par défaut : renseignez la date réelle de délivrance dans " +
          "l'échéancier, sinon la date affichée ne veut rien dire.",
        urlSource: null,
        // Valeur PAR DEFAUT du catalogue (`echeance_pas_quinquennal_annees`),
        // pas un littéral : `CATALOGUE_ECHEANCES` est construit depuis
        // `PARAMETRES_PAR_DEFAUT` (voir plus haut dans `comptabilite.ts`).
        pasAnnees: 5,
      },
      {
        libelle: 'Formulaire e604B — dépassement du seuil de franchise TVA',
        recurrence: 'annuelle',
        jourReference: '12-15',
        joursSupplementaires: [],
        sourceLegale:
          'À déposer avant le 15 décembre en cas de dépassement du seuil de 25 000 € sans ' +
          'excéder 27 500 €. La tolérance de 10 % a DISPARU au 1er janvier 2025. ' +
          'À confirmer auprès du guichet d’entreprises.',
        urlSource: null,
        pasAnnees: 1,
      },
    ] satisfies readonly DefinitionEcheance[]);
  });

  it('reproduit aussi le pas quinquennal : 5 ans entre deux renouvellements', () => {
    // Preuve indirecte de `PAS_ANNEES.quinquennale`, non exporté : verifiee
    // via le comportement observable de `prochaineOccurrenceEcheance`.
    const ambulant = echeanceDuCatalogue('ambulantes');
    expect(prochaineOccurrenceEcheance(ambulant, '2026-07-27', '2024-06-01')).toBe('2029-06-01');
  });

  it('lit RÉELLEMENT le jeu de paramètres reçu — pas un décor autour d’une valeur figée', () => {
    // Preuve que la source de verite a bien BOUGE : un Parametres construit
    // avec un jour de reference DIFFERENT produit un catalogue different.
    // Tout le reste du jeu vient des valeurs par defaut du catalogue reel :
    // seule la cle testee est substituee.
    const parametresModifies = Parametres.depuisLignes(
      CATALOGUE_PARAMETRES.map((definition) => ({
        cle: definition.cle,
        valeur: definition.cle === 'echeance_listing_tva_jours' ? '02-28' : definition.valeurDefaut,
      })),
    );

    const catalogueModifie = construireCatalogueEcheances(parametresModifies);
    const listingModifie = catalogueModifie.find((e) => e.libelle === 'Listing clients TVA');
    expect(listingModifie?.jourReference).toBe('02-28');
    // Les autres échéances, non touchées par la substitution, restent identiques.
    expect(catalogueModifie.find((e) => e.libelle.includes('INASTI'))?.jourReference).toBe('04-10');
  });

  it('refuse un parametre de jours vide plutot que de fabriquer une echeance sans date', () => {
    // Repart des VRAIS defauts du catalogue (garantit que les 4 autres
    // echeances restent lisibles) et n'abime QUE celle testee.
    const parametresAbimes = Parametres.depuisLignes(
      CATALOGUE_PARAMETRES.map((definition) => ({
        cle: definition.cle,
        valeur: definition.cle === 'echeance_listing_tva_jours' ? '' : definition.valeurDefaut,
      })),
    );

    expect(() => construireCatalogueEcheances(parametresAbimes)).toThrow(ErreurMetier);
  });
});

describe('prochaineOccurrence — primitive annuelle', () => {
  it('rend la date de cette année si elle est à venir', () => {
    expect(prochaineOccurrence('03-31', '2026-01-15')).toBe('2026-03-31');
  });

  it("bascule sur l'année suivante si elle est passée", () => {
    expect(prochaineOccurrence('03-31', '2026-07-27')).toBe('2027-03-31');
  });

  it('rend le jour même quand la date tombe aujourd hui', () => {
    expect(prochaineOccurrence('03-31', '2026-03-31')).toBe('2026-03-31');
  });

  it('refuse un jour de référence mal formé', () => {
    expect(() => prochaineOccurrence('31/03', '2026-01-15')).toThrow(ErreurMetier);
    expect(() => prochaineOccurrence('2026-03-31', '2026-01-15')).toThrow(ErreurMetier);
  });

  it('refuse une date de départ mal formée', () => {
    expect(() => prochaineOccurrence('03-31', '15/01/2026')).toThrow(ErreurMetier);
  });

  it('refuse de fabriquer un 29 février qui n existe pas', () => {
    // Sinon `joursAvantEcheance` rendrait NaN et l'echeancier afficherait une
    // date inexistante sans jamais alerter.
    expect(() => prochaineOccurrence('02-29', '2027-01-01')).toThrow(ErreurMetier);
    expect(prochaineOccurrence('02-29', '2028-01-01')).toBe('2028-02-29');
  });
});

describe('prochaineOccurrenceEcheance — récurrence annuelle', () => {
  it('se comporte comme la primitive annuelle', () => {
    const listing = echeanceDuCatalogue('Listing');
    expect(prochaineOccurrenceEcheance(listing, '2026-01-15')).toBe('2026-03-31');
    expect(prochaineOccurrenceEcheance(listing, '2026-07-27')).toBe('2027-03-31');
  });
});

describe('prochaineOccurrenceEcheance — récurrence trimestrielle', () => {
  const inasti = echeanceDuCatalogue('INASTI');

  /**
   * NON-REGRESSION du defaut le plus grave. `prochaineOccurrence` ne savait
   * faire que « meme jour, annee suivante » : cochee le 10 avril, la cotisation
   * INASTI repartait au 10 avril de l'annee suivante et les echeances de
   * juillet, octobre et decembre n'etaient JAMAIS rappelees. Un trimestre
   * oublie, ce sont des majorations de retard.
   */
  it('rappelle les QUATRE échéances de l année, pas seulement la première', () => {
    expect(prochaineOccurrenceEcheance(inasti, '2026-01-01')).toBe('2026-04-10');
    expect(prochaineOccurrenceEcheance(inasti, '2026-04-11')).toBe('2026-07-10');
    expect(prochaineOccurrenceEcheance(inasti, '2026-07-11')).toBe('2026-10-12');
    expect(prochaineOccurrenceEcheance(inasti, '2026-10-13')).toBe('2026-12-21');
  });

  it("ne saute PAS d'un an après le premier trimestre", () => {
    expect(prochaineOccurrenceEcheance(inasti, '2026-04-11')).not.toBe('2027-04-10');
  });

  it('rend le jour même quand une échéance tombe aujourd hui', () => {
    expect(prochaineOccurrenceEcheance(inasti, '2026-10-12')).toBe('2026-10-12');
  });

  it("repart au premier trimestre de l'année suivante après la dernière", () => {
    expect(prochaineOccurrenceEcheance(inasti, '2026-12-22')).toBe('2027-04-10');
  });

  it('avance toujours, jour après jour sur deux années complètes', () => {
    // Balayage : la date rendue est toujours >= le jour, et fait partie des
    // quatre dates declarees au catalogue — jamais une date inventee.
    const joursDeclares = new Set([inasti.jourReference, ...inasti.joursSupplementaires]);
    let jour = '2026-01-01';
    for (let i = 0; i < 730; i += 1) {
      const occurrence = prochaineOccurrenceEcheance(inasti, jour);
      expect(occurrence >= jour, jour).toBe(true);
      expect(joursDeclares.has(occurrence.slice(5)), occurrence).toBe(true);
      expect(joursAvantEcheance(occurrence, jour), jour).toBeLessThanOrEqual(365);
      jour = new Date(Date.parse(`${jour}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
  });
});

describe('prochaineOccurrenceEcheance — récurrence quinquennale', () => {
  const ambulant = echeanceDuCatalogue('ambulantes');
  /** Date de premiere delivrance : donnee de l'utilisateur, pas du catalogue. */
  const DELIVRANCE = '2024-06-01';

  it("exige la date de délivrance plutôt que d'inventer une échéance", () => {
    // CLAUDE.md §7 : une echeance dans le doute se signale. Rendre le 1er
    // janvier du catalogue laisserait croire a un rappel fiable.
    expect(() => prochaineOccurrenceEcheance(ambulant, '2026-07-27')).toThrow(ErreurMetier);
    expect(() => prochaineOccurrenceEcheance(ambulant, '2026-07-27')).toThrow(/délivrance/);
  });

  it('ajoute cinq ans à la délivrance, pas un an', () => {
    expect(prochaineOccurrenceEcheance(ambulant, '2026-07-27', DELIVRANCE)).toBe('2029-06-01');
    expect(prochaineOccurrenceEcheance(ambulant, '2026-07-27', DELIVRANCE)).not.toBe('2027-01-01');
  });

  it('prend le jour anniversaire de la délivrance, pas le repère du catalogue', () => {
    expect(prochaineOccurrenceEcheance(ambulant, '2026-07-27', '2023-09-14')).toBe('2028-09-14');
  });

  it('rend le jour même le jour du renouvellement', () => {
    expect(prochaineOccurrenceEcheance(ambulant, '2029-06-01', DELIVRANCE)).toBe('2029-06-01');
  });

  it('passe au cycle suivant le lendemain du renouvellement', () => {
    expect(prochaineOccurrenceEcheance(ambulant, '2029-06-02', DELIVRANCE)).toBe('2034-06-01');
  });

  it('ne rappelle jamais la délivrance elle-même : elle ouvre la validité', () => {
    expect(prochaineOccurrenceEcheance(ambulant, '2023-01-01', DELIVRANCE)).toBe('2029-06-01');
  });
});

describe('prochaineOccurrenceEcheance — récurrence ponctuelle', () => {
  const ponctuelle: DefinitionEcheance = {
    libelle: 'Déclaration unique',
    recurrence: 'ponctuelle',
    jourReference: '2026-05-20',
    joursSupplementaires: [],
    sourceLegale: 'Échéance unique inventée pour le test, sans portée réglementaire.',
    urlSource: null,
    pasAnnees: null,
  };

  it('rend sa date telle quelle avant le jour dit', () => {
    expect(prochaineOccurrenceEcheance(ponctuelle, '2026-01-01')).toBe('2026-05-20');
  });

  it('reste en retard une fois dépassée, au lieu de se reporter d un an', () => {
    // Une ponctuelle manquee doit rester visible dans les retards : la reporter
    // la ferait disparaitre de la liste, ce qui masque une obligation.
    expect(prochaineOccurrenceEcheance(ponctuelle, '2026-07-27')).toBe('2026-05-20');
    expect(joursAvantEcheance('2026-05-20', '2026-07-27')).toBeLessThan(0);
  });
});

describe('prochaineOccurrenceEcheance — sur tout le catalogue', () => {
  it('rend une date à venir et exploitable pour chaque échéance récurrente', () => {
    const ancrage = '2024-06-01';
    for (const echeance of CATALOGUE_ECHEANCES) {
      for (const jour of ['2026-01-01', '2026-06-15', '2026-12-31']) {
        const occurrence = prochaineOccurrenceEcheance(echeance, jour, ancrage);
        expect(occurrence >= jour, `${echeance.libelle} @ ${jour}`).toBe(true);
        expect(Number.isFinite(joursAvantEcheance(occurrence, jour))).toBe(true);
      }
    }
  });
});

describe('joursAvantEcheance', () => {
  it('compte les jours restants', () => {
    expect(joursAvantEcheance('2026-08-02', '2026-07-27')).toBe(6);
  });

  it('rend un nombre négatif sur une échéance dépassée', () => {
    expect(joursAvantEcheance('2026-07-20', '2026-07-27')).toBe(-7);
  });
});
