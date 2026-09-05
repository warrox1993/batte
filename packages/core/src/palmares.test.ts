import { describe, expect, it } from 'vitest';
import {
  RAISON_DELAI_LIVRAISON_INDISPONIBLE,
  RAISON_MARGE_MINUTE_REVENDU_INDISPONIBLE,
  RAISON_MARGE_MINUTE_TRANSFORME_INDISPONIBLE,
  RAISON_QUALITE_PRODUIT_INDISPONIBLE,
  SEUIL_MINIMUM_ECHANTILLON_PALMARES,
  agregerEconomiesParFournisseur,
  agregerFiabiliteFacturationParFournisseur,
  agregerVentesParProduit,
  bornesPeriodePalmares,
  comparerPrixParIngredient,
  construireGroupePalmaresFournisseurs,
  construireGroupePalmaresProduits,
  construireLigneClassementFournisseur,
  construireLigneClassementProduit,
  detecterDivergenceVenteRentabilite,
  fournisseursActifsSurPeriode,
  produitsVendusSurPeriode,
  trierClassementFournisseurs,
  trierClassementProduits,
  type LigneClassementProduit,
} from './palmares.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Produits
   ═══════════════════════════════════════════════════════════════════════════ */

describe('agregerVentesParProduit', () => {
  it('cumule quantité et montant sur plusieurs lignes du même produit', () => {
    const agregats = agregerVentesParProduit([
      { produitVenteId: 'p1', quantite: 10, montantCents: 3000 },
      { produitVenteId: 'p1', quantite: 5, montantCents: 1500 },
      { produitVenteId: 'p2', quantite: 2, montantCents: 600 },
    ]);
    expect(agregats.get('p1')).toEqual({ volumeVendu: 15, caGenereCents: 4500 });
    expect(agregats.get('p2')).toEqual({ volumeVendu: 2, caGenereCents: 600 });
  });

  it('rend une Map vide sur une liste vide', () => {
    expect(agregerVentesParProduit([]).size).toBe(0);
  });
});

describe('construireLigneClassementProduit', () => {
  it('calcule la marge totale et unitaire quand le coût matière est connu', () => {
    const ligne = construireLigneClassementProduit(
      {
        produitVenteId: 'p1',
        nom: 'Crêpe froment',
        nature: 'transforme',
        coutMatiereUnitaireCents: 33,
      },
      { volumeVendu: 100, caGenereCents: 25_000 },
    );
    expect(ligne.volumeVendu).toBe(100);
    expect(ligne.caGenereCents).toBe(25_000);
    expect(ligne.margeTotaleGenereeCents).toBe(25_000 - 100 * 33);
    expect(ligne.margeUnitaireMoyenneCents).toBe(Math.round((25_000 - 3300) / 100));
  });

  it('rend `null` sur la marge quand le coût matière est inconnu — jamais 0', () => {
    const ligne = construireLigneClassementProduit(
      { produitVenteId: 'p1', nom: 'Sirop', nature: 'revendu', coutMatiereUnitaireCents: null },
      { volumeVendu: 10, caGenereCents: 5000 },
    );
    expect(ligne.margeTotaleGenereeCents).toBeNull();
    expect(ligne.margeUnitaireMoyenneCents).toBeNull();
    // Le volume et le CA restent connus même si le coût ne l'est pas : deux inconnues indépendantes.
    expect(ligne.volumeVendu).toBe(10);
    expect(ligne.caGenereCents).toBe(5000);
  });

  it('rend un volume et un CA à zéro, marge unitaire nulle, quand le produit n’a jamais été vendu', () => {
    const ligne = construireLigneClassementProduit(
      {
        produitVenteId: 'p1',
        nom: 'Crêpe sarrasin',
        nature: 'transforme',
        coutMatiereUnitaireCents: 40,
      },
      undefined,
    );
    expect(ligne.volumeVendu).toBe(0);
    expect(ligne.caGenereCents).toBe(0);
    expect(ligne.margeTotaleGenereeCents).toBe(0);
    // Division par un volume nul : jamais un chiffre inventé.
    expect(ligne.margeUnitaireMoyenneCents).toBeNull();
  });

  it('porte la raison TRANSFORMÉ pour « marge par minute de cuisson », jamais inventée', () => {
    const ligne = construireLigneClassementProduit(
      { produitVenteId: 'p1', nom: 'Crêpe', nature: 'transforme', coutMatiereUnitaireCents: 33 },
      { volumeVendu: 1, caGenereCents: 300 },
    );
    expect(ligne.margeParMinuteCuissonCents).toBeNull();
    expect(ligne.raisonMargeParMinuteCuissonIndisponible).toBe(
      RAISON_MARGE_MINUTE_TRANSFORME_INDISPONIBLE,
    );
  });

  it('porte la raison REVENDU (sans objet), distincte de celle du transformé', () => {
    const ligne = construireLigneClassementProduit(
      { produitVenteId: 'p1', nom: 'Sirop', nature: 'revendu', coutMatiereUnitaireCents: 100 },
      { volumeVendu: 1, caGenereCents: 300 },
    );
    expect(ligne.margeParMinuteCuissonCents).toBeNull();
    expect(ligne.raisonMargeParMinuteCuissonIndisponible).toBe(
      RAISON_MARGE_MINUTE_REVENDU_INDISPONIBLE,
    );
    expect(ligne.raisonMargeParMinuteCuissonIndisponible).not.toBe(
      RAISON_MARGE_MINUTE_TRANSFORME_INDISPONIBLE,
    );
  });
});

function ligne(
  partiel: Partial<LigneClassementProduit> & { produitVenteId: string },
): LigneClassementProduit {
  return {
    nom: partiel.produitVenteId,
    nature: 'transforme',
    volumeVendu: 0,
    caGenereCents: 0,
    margeTotaleGenereeCents: null,
    margeUnitaireMoyenneCents: null,
    margeParMinuteCuissonCents: null,
    raisonMargeParMinuteCuissonIndisponible: RAISON_MARGE_MINUTE_TRANSFORME_INDISPONIBLE,
    ...partiel,
  };
}

describe('produitsVendusSurPeriode', () => {
  it('exclut les produits à volume nul', () => {
    const lignes = [
      ligne({ produitVenteId: 'p1', volumeVendu: 10 }),
      ligne({ produitVenteId: 'p2', volumeVendu: 0 }),
    ];
    expect(produitsVendusSurPeriode(lignes).map((l) => l.produitVenteId)).toEqual(['p1']);
  });
});

describe('trierClassementProduits', () => {
  const lignes = [
    ligne({
      produitVenteId: 'a',
      margeTotaleGenereeCents: 500,
      margeUnitaireMoyenneCents: 10,
      volumeVendu: 50,
    }),
    ligne({
      produitVenteId: 'b',
      margeTotaleGenereeCents: 900,
      margeUnitaireMoyenneCents: 5,
      volumeVendu: 180,
    }),
    ligne({
      produitVenteId: 'c',
      margeTotaleGenereeCents: null,
      margeUnitaireMoyenneCents: null,
      volumeVendu: 20,
    }),
  ];

  it('trie par marge totale décroissante, valeur inconnue en dernier', () => {
    expect(trierClassementProduits(lignes, 'marge_totale').map((l) => l.produitVenteId)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('trie par marge unitaire décroissante, valeur inconnue en dernier', () => {
    expect(trierClassementProduits(lignes, 'marge_unitaire').map((l) => l.produitVenteId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('trie par volume vendu décroissant', () => {
    expect(trierClassementProduits(lignes, 'volume_vendu').map((l) => l.produitVenteId)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('« marge par minute de cuisson » ne trie rien : aucune valeur n’est jamais renseignée', () => {
    expect(
      trierClassementProduits(lignes, 'marge_par_minute_cuisson').map((l) => l.produitVenteId),
    ).toEqual(['a', 'b', 'c']);
  });

  it('ne mute pas le tableau reçu', () => {
    const original = [...lignes];
    trierClassementProduits(lignes, 'volume_vendu');
    expect(lignes).toEqual(original);
  });
});

describe('detecterDivergenceVenteRentabilite', () => {
  it('signale quand le plus vendu et le plus rentable diffèrent — « c’est une information, pas un problème »', () => {
    const lignes = [
      ligne({
        produitVenteId: 'best-seller',
        nom: 'Crêpe nature',
        volumeVendu: 200,
        margeTotaleGenereeCents: 4000,
      }),
      ligne({
        produitVenteId: 'best-margin',
        nom: 'Crêpe Nutella',
        volumeVendu: 50,
        margeTotaleGenereeCents: 6000,
      }),
    ];
    const divergence = detecterDivergenceVenteRentabilite('transforme', lignes);
    expect(divergence).toEqual({
      nature: 'transforme',
      nomPlusVendu: 'Crêpe nature',
      nomPlusRentable: 'Crêpe Nutella',
    });
  });

  it('rend `null` quand le même produit domine les deux classements', () => {
    const lignes = [
      ligne({ produitVenteId: 'a', nom: 'A', volumeVendu: 200, margeTotaleGenereeCents: 9000 }),
      ligne({ produitVenteId: 'b', nom: 'B', volumeVendu: 50, margeTotaleGenereeCents: 1000 }),
    ];
    expect(detecterDivergenceVenteRentabilite('transforme', lignes)).toBeNull();
  });

  it('rend `null` avec moins de deux produits vendus : rien à comparer honnêtement', () => {
    const lignes = [ligne({ produitVenteId: 'a', volumeVendu: 10, margeTotaleGenereeCents: 100 })];
    expect(detecterDivergenceVenteRentabilite('transforme', lignes)).toBeNull();
  });

  it('rend `null` quand la marge totale du plus rentable est inconnue', () => {
    const lignes = [
      ligne({ produitVenteId: 'a', volumeVendu: 200, margeTotaleGenereeCents: null }),
      ligne({ produitVenteId: 'b', volumeVendu: 50, margeTotaleGenereeCents: null }),
    ];
    expect(detecterDivergenceVenteRentabilite('transforme', lignes)).toBeNull();
  });
});

describe('construireGroupePalmaresProduits', () => {
  const lignesMixtes = [
    ligne({ produitVenteId: 't1', nature: 'transforme', volumeVendu: 10 }),
    ligne({ produitVenteId: 'r1', nature: 'revendu', volumeVendu: 5 }),
    ligne({ produitVenteId: 't2', nature: 'transforme', volumeVendu: 0 }), // jamais vendu
  ];

  it('ne garde que la nature demandée, et exclut les invendus', () => {
    const groupe = construireGroupePalmaresProduits(
      'transforme',
      lignesMixtes,
      SEUIL_MINIMUM_ECHANTILLON_PALMARES,
    );
    expect(groupe.lignes.map((l) => l.produitVenteId)).toEqual(['t1']);
  });

  it('échantillon suffisant à exactement le seuil minimum', () => {
    const groupe = construireGroupePalmaresProduits(
      'transforme',
      lignesMixtes,
      SEUIL_MINIMUM_ECHANTILLON_PALMARES,
    );
    expect(groupe.echantillonSuffisant).toBe(true);
    expect(groupe.raisonEchantillonInsuffisant).toBeNull();
  });

  it('échantillon insuffisant sous le seuil : dit pourquoi plutôt que de classer trois éléments sur deux ventes', () => {
    const groupe = construireGroupePalmaresProduits(
      'transforme',
      lignesMixtes,
      SEUIL_MINIMUM_ECHANTILLON_PALMARES - 1,
    );
    expect(groupe.echantillonSuffisant).toBe(false);
    expect(groupe.raisonEchantillonInsuffisant).not.toBeNull();
    expect(groupe.divergenceVenteRentabilite).toBeNull();
  });
});

describe('bornesPeriodePalmares', () => {
  it('rend une fenêtre de 365 jours se terminant au jour de référence', () => {
    const bornes = bornesPeriodePalmares('2026-08-01');
    expect(bornes.fin).toBe('2026-08-01');
    expect(bornes.jours).toBe(365);
    expect(bornes.debut < bornes.fin).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Fournisseurs
   ═══════════════════════════════════════════════════════════════════════════ */

describe('agregerEconomiesParFournisseur', () => {
  it('cumule les économies par fournisseur', () => {
    const totaux = agregerEconomiesParFournisseur([
      { fournisseurId: 'f1', economieCents: 500 },
      { fournisseurId: 'f1', economieCents: 300 },
      { fournisseurId: 'f2', economieCents: 100 },
    ]);
    expect(totaux.get('f1')).toBe(800);
    expect(totaux.get('f2')).toBe(100);
  });
});

describe('agregerFiabiliteFacturationParFournisseur', () => {
  it('calcule un écart moyen en points de base, en VALEUR ABSOLUE (facturer moins compte aussi)', () => {
    const resultat = agregerFiabiliteFacturationParFournisseur([
      { fournisseurId: 'f1', montantTotalCents: 10_000, ecartTotalCents: 200 }, // +2 %
      { fournisseurId: 'f1', montantTotalCents: 10_000, ecartTotalCents: -200 }, // -2 %, compte pareil
    ]);
    const f1 = resultat.get('f1');
    expect(f1?.nbFactures).toBe(2);
    expect(f1?.montantCumuleCents).toBe(20_000);
    expect(f1?.ecartAbsoluCumuleCents).toBe(400);
    expect(f1?.ecartMoyenBp).toBe(200); // 400 / 20 000 = 2 %
  });

  it('rend `null` sur `ecartMoyenBp` si le montant cumulé est nul, jamais 0/parfait', () => {
    const resultat = agregerFiabiliteFacturationParFournisseur([
      { fournisseurId: 'f1', montantTotalCents: 0, ecartTotalCents: 0 },
    ]);
    expect(resultat.get('f1')?.ecartMoyenBp).toBeNull();
  });

  it('un fournisseur sans facture reste absent de la Map (inconnu, pas zéro)', () => {
    const resultat = agregerFiabiliteFacturationParFournisseur([]);
    expect(resultat.has('f1')).toBe(false);
  });
});

describe('comparerPrixParIngredient', () => {
  it('ne compare QUE les ingrédients à au moins deux fournisseurs actifs', () => {
    const resultat = comparerPrixParIngredient([
      // Farine : deux fournisseurs actifs -> comparable.
      {
        ingredientId: 'farine',
        fournisseurId: 'moulin',
        prixCents: 2500,
        quantiteUniteRef: 25_000,
        datePrix: '2026-01-01',
        actif: true,
      },
      {
        ingredientId: 'farine',
        fournisseurId: 'grossiste',
        prixCents: 3000,
        quantiteUniteRef: 25_000,
        datePrix: '2026-01-01',
        actif: true,
      },
      // Sirop : un seul fournisseur -> pas comparable.
      {
        ingredientId: 'sirop',
        fournisseurId: 'grossiste',
        prixCents: 500,
        quantiteUniteRef: 1000,
        datePrix: '2026-01-01',
        actif: true,
      },
    ]);

    const moulin = resultat.get('moulin');
    expect(moulin?.nbIngredientsComparables).toBe(1);
    expect(moulin?.ecartMoyenBp).toBe(0); // le moins cher sur la farine

    const grossiste = resultat.get('grossiste');
    expect(grossiste?.nbIngredientsComparables).toBe(1); // seule la farine compte, pas le sirop
    expect(grossiste?.ecartMoyenBp).toBe(2000); // 20 % plus cher que le moulin
  });

  it('un fournisseur sans aucun ingrédient partagé est absent de la Map — jamais un prix neutre', () => {
    const resultat = comparerPrixParIngredient([
      {
        ingredientId: 'sirop',
        fournisseurId: 'seul-vendeur',
        prixCents: 500,
        quantiteUniteRef: 1000,
        datePrix: '2026-01-01',
        actif: true,
      },
    ]);
    expect(resultat.has('seul-vendeur')).toBe(false);
  });

  it('ignore les conditionnements inactifs (tarif historique)', () => {
    const resultat = comparerPrixParIngredient([
      {
        ingredientId: 'farine',
        fournisseurId: 'moulin',
        prixCents: 2000,
        quantiteUniteRef: 25_000,
        datePrix: '2025-01-01',
        actif: false,
      },
      {
        ingredientId: 'farine',
        fournisseurId: 'moulin',
        prixCents: 2500,
        quantiteUniteRef: 25_000,
        datePrix: '2026-01-01',
        actif: true,
      },
      {
        ingredientId: 'farine',
        fournisseurId: 'grossiste',
        prixCents: 2500,
        quantiteUniteRef: 25_000,
        datePrix: '2026-01-01',
        actif: true,
      },
    ]);
    // Les deux fournisseurs sont à égalité sur le tarif ACTIF (2 500 chacun) : 0 % d'écart pour les deux.
    expect(resultat.get('moulin')?.ecartMoyenBp).toBe(0);
    expect(resultat.get('grossiste')?.ecartMoyenBp).toBe(0);
  });

  it('ne retient que le tarif actif le plus RÉCENT par couple ingrédient/fournisseur', () => {
    const resultat = comparerPrixParIngredient([
      {
        ingredientId: 'farine',
        fournisseurId: 'moulin',
        prixCents: 5000,
        quantiteUniteRef: 25_000,
        datePrix: '2020-01-01',
        actif: true,
      },
      {
        ingredientId: 'farine',
        fournisseurId: 'moulin',
        prixCents: 2500,
        quantiteUniteRef: 25_000,
        datePrix: '2026-01-01',
        actif: true,
      },
      {
        ingredientId: 'farine',
        fournisseurId: 'grossiste',
        prixCents: 2500,
        quantiteUniteRef: 25_000,
        datePrix: '2026-01-01',
        actif: true,
      },
    ]);
    expect(resultat.get('moulin')?.ecartMoyenBp).toBe(0); // le tarif 2026, pas le tarif 2020
  });
});

describe('construireLigneClassementFournisseur', () => {
  it('assemble les trois critères calculables et fixe les deux autres à `null`', () => {
    const ligneF = construireLigneClassementFournisseur(
      { id: 'f1', nom: 'Moulin Dupont' },
      1200,
      { nbFactures: 3, montantCumuleCents: 30_000, ecartAbsoluCumuleCents: 300, ecartMoyenBp: 100 },
      { nbIngredientsComparables: 2, ecartMoyenBp: 500 },
    );
    expect(ligneF).toEqual({
      fournisseurId: 'f1',
      nom: 'Moulin Dupont',
      economieGenereeCents: 1200,
      fiabiliteFacturationBp: 100,
      nbFacturesConsiderees: 3,
      prixComparableEcartBp: 500,
      nbIngredientsComparables: 2,
      delaiLivraisonJours: null,
      qualiteProduitScore: null,
    });
  });

  it('rend `null`/0 proprement quand aucune facture ni prix comparable n’existe', () => {
    const ligneF = construireLigneClassementFournisseur(
      { id: 'f1', nom: 'X' },
      0,
      undefined,
      undefined,
    );
    expect(ligneF.fiabiliteFacturationBp).toBeNull();
    expect(ligneF.nbFacturesConsiderees).toBe(0);
    expect(ligneF.prixComparableEcartBp).toBeNull();
    expect(ligneF.nbIngredientsComparables).toBe(0);
  });
});

describe('trierClassementFournisseurs', () => {
  const lignes = [
    construireLigneClassementFournisseur(
      { id: 'a', nom: 'A' },
      100,
      { nbFactures: 1, montantCumuleCents: 10_000, ecartAbsoluCumuleCents: 500, ecartMoyenBp: 500 },
      { nbIngredientsComparables: 1, ecartMoyenBp: 1000 },
    ),
    construireLigneClassementFournisseur(
      { id: 'b', nom: 'B' },
      900,
      { nbFactures: 1, montantCumuleCents: 10_000, ecartAbsoluCumuleCents: 100, ecartMoyenBp: 100 },
      { nbIngredientsComparables: 1, ecartMoyenBp: 0 },
    ),
    construireLigneClassementFournisseur({ id: 'c', nom: 'C' }, 300, undefined, undefined),
  ];

  it('économie générée : décroissant', () => {
    expect(
      trierClassementFournisseurs(lignes, 'economie_generee').map((l) => l.fournisseurId),
    ).toEqual(['b', 'c', 'a']);
  });

  it('fiabilité de facturation : croissant (moins d’écart = meilleur), inconnu en dernier', () => {
    expect(
      trierClassementFournisseurs(lignes, 'fiabilite_facturation').map((l) => l.fournisseurId),
    ).toEqual(['b', 'a', 'c']);
  });

  it('prix comparable : croissant (moins cher = meilleur), inconnu en dernier', () => {
    expect(
      trierClassementFournisseurs(lignes, 'prix_comparable').map((l) => l.fournisseurId),
    ).toEqual(['b', 'a', 'c']);
  });

  it('délai de livraison et qualité produit : aucun ordre, rendu inchangé', () => {
    expect(
      trierClassementFournisseurs(lignes, 'delai_livraison').map((l) => l.fournisseurId),
    ).toEqual(['a', 'b', 'c']);
    expect(
      trierClassementFournisseurs(lignes, 'qualite_produit').map((l) => l.fournisseurId),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('fournisseursActifsSurPeriode', () => {
  it('exclut un fournisseur sans aucun signal (jamais un 0 par défaut affiché comme une note)', () => {
    const lignes = [
      construireLigneClassementFournisseur(
        { id: 'actif', nom: 'Actif' },
        0,
        { nbFactures: 1, montantCumuleCents: 100, ecartAbsoluCumuleCents: 0, ecartMoyenBp: 0 },
        undefined,
      ),
      construireLigneClassementFournisseur(
        { id: 'dormant', nom: 'Dormant' },
        0,
        undefined,
        undefined,
      ),
    ];
    expect(fournisseursActifsSurPeriode(lignes).map((l) => l.fournisseurId)).toEqual(['actif']);
  });
});

describe('construireGroupePalmaresFournisseurs', () => {
  it('échantillon suffisant à partir du seuil (factures + économies confondues)', () => {
    const groupe = construireGroupePalmaresFournisseurs([], 2, 2);
    expect(groupe.echantillonSuffisant).toBe(true);
    expect(groupe.raisonEchantillonInsuffisant).toBeNull();
  });

  it('échantillon insuffisant sous le seuil : dit pourquoi', () => {
    const groupe = construireGroupePalmaresFournisseurs([], 1, 0);
    expect(groupe.echantillonSuffisant).toBe(false);
    expect(groupe.raisonEchantillonInsuffisant).not.toBeNull();
  });
});

describe('Raisons d’indisponibilité — jamais deux critères qui se ressemblent', () => {
  it('les quatre raisons sont non vides et toutes distinctes', () => {
    const raisons = [
      RAISON_MARGE_MINUTE_TRANSFORME_INDISPONIBLE,
      RAISON_MARGE_MINUTE_REVENDU_INDISPONIBLE,
      RAISON_DELAI_LIVRAISON_INDISPONIBLE,
      RAISON_QUALITE_PRODUIT_INDISPONIBLE,
    ];
    expect(new Set(raisons).size).toBe(raisons.length);
    for (const r of raisons) expect(r.length).toBeGreaterThan(10);
  });
});
