import { describe, expect, it } from 'vitest';
import {
  calculerRentabilite,
  coutMatiereTransformeSuspect,
  depassementProjete,
  ecartProduction,
  estPateVendueAuVolume,
  partRevenduBp,
  projeterSeuil,
  rapprocherCaisse,
  repartirCoutProductionEntrePateVendueEtCrepes,
  resoudreCoutEnergieSession,
  resoudreCrepesDepuisVolumeRestant,
  totaliserVentes,
  volumePateVendueDirectementMl,
  type LigneVente,
} from './sessions.js';
import { ErreurMetier } from './erreurs.js';

const CREPE_FROMENT: LigneVente = {
  produitVenteId: 'p1',
  nature: 'transforme',
  quantite: 24,
  prixUnitaireCents: 300,
  nbCrepesParUnite: 1,
  consommationSurPlace: false,
};

const POT_SIROP: LigneVente = {
  produitVenteId: 'p2',
  nature: 'revendu',
  quantite: 3,
  prixUnitaireCents: 750,
  nbCrepesParUnite: 0,
  consommationSurPlace: false,
};

describe('rapprocherCaisse — correction de l invariant n°4', () => {
  it('soustrait le fonds de caisse des especes comptees', () => {
    // 60 € de monnaie le matin, 178,50 € comptes le soir -> 118,50 € encaisses.
    const resultat = rapprocherCaisse(
      { fondsCaisseInitialCents: 6000, especesCompteesCents: 17_850, caCarteCents: 7050 },
      18_900,
    );

    expect(resultat.caEspecesCents).toBe(11_850);
    expect(resultat.caTotalEncaisseCents).toBe(18_900);
    expect(resultat.ecartCaisseCents).toBe(0);
  });

  it('sans cette correction, l ecart serait faux du montant du fonds', () => {
    // C'est precisement le defaut de la formulation d'origine : elle rendait
    // un ecart de +60 € sur une caisse parfaitement juste.
    const avecFonds = rapprocherCaisse(
      { fondsCaisseInitialCents: 6000, especesCompteesCents: 17_850, caCarteCents: 7050 },
      18_900,
    );
    const sansSoustraction = 17_850 + 7050 - 18_900;

    expect(sansSoustraction).toBe(6000);
    expect(avecFonds.ecartCaisseCents).toBe(0);
  });

  it('signale un manque en caisse par un ecart negatif', () => {
    const resultat = rapprocherCaisse(
      { fondsCaisseInitialCents: 6000, especesCompteesCents: 17_500, caCarteCents: 7050 },
      18_900,
    );
    expect(resultat.ecartCaisseCents).toBe(-350);
  });

  it('fonctionne sans fonds de caisse', () => {
    const resultat = rapprocherCaisse(
      { fondsCaisseInitialCents: 0, especesCompteesCents: 11_850, caCarteCents: 7050 },
      18_900,
    );
    expect(resultat.ecartCaisseCents).toBe(0);
  });

  /**
   * Défaut mesuré le 30/07/2026 : l'écran de clôture (`Sessions.tsx`)
   * appelait `rapprocherCaisse` avec `especesValeur ?? 0` / `carteValeur ?? 0`
   * sur un formulaire VIERGE (rien encore saisi) — ce qui affichait un écart
   * de caisse de −50,00 € avant la moindre frappe, sur l'écran qu'on remplit
   * à 23 h après six heures et demie de marché. « Pas encore compté » n'est
   * PAS « zéro euro en caisse » : `especesCompteesCents` et `caCarteCents`
   * sont donc `Centimes | null`, et l'inconnu doit se PROPAGER jusqu'à
   * `ecartCaisseCents`, jamais être rattrapé par un zéro inventé.
   */
  it('rend un écart NUL (pas zéro) quand les espèces comptées sont inconnues', () => {
    const resultat = rapprocherCaisse(
      { fondsCaisseInitialCents: 0, especesCompteesCents: null, caCarteCents: 7050 },
      5000,
    );
    expect(resultat.caEspecesCents).toBeNull();
    expect(resultat.caTotalEncaisseCents).toBeNull();
    expect(resultat.ecartCaisseCents).toBeNull();
  });

  it('rend un écart NUL quand le montant carte est inconnu', () => {
    const resultat = rapprocherCaisse(
      { fondsCaisseInitialCents: 0, especesCompteesCents: 11_850, caCarteCents: null },
      5000,
    );
    expect(resultat.caCarteCents).toBeNull();
    expect(resultat.caTotalEncaisseCents).toBeNull();
    expect(resultat.ecartCaisseCents).toBeNull();
  });

  it('LE CAS MESURÉ : un formulaire vierge (espèces ET carte inconnues) ne doit JAMAIS afficher −50 € — ni aucun autre chiffre', () => {
    // Formulaire tout juste ouvert : rien saisi, mais des ventes déjà tapées
    // pour 5000 centimes (50 €). L'ancien code (`?? 0` avant l'appel) rendait
    // ici un écart de −5000 centimes.
    const resultat = rapprocherCaisse(
      { fondsCaisseInitialCents: 0, especesCompteesCents: null, caCarteCents: null },
      5000,
    );
    expect(resultat.ecartCaisseCents).toBeNull();
  });

  it('un fonds de caisse connu mais des espèces et une carte encore inconnues restent NUL, jamais faussées par le fonds seul', () => {
    const resultat = rapprocherCaisse(
      { fondsCaisseInitialCents: 6000, especesCompteesCents: null, caCarteCents: null },
      0,
    );
    expect(resultat.caEspecesCents).toBeNull();
    expect(resultat.ecartCaisseCents).toBeNull();
  });
});

describe('totaliserVentes', () => {
  it('ventile transforme et revendu', () => {
    // La ventilation est indispensable : a marge egale, la revente genere
    // ~2,6 fois plus de CA, et les seuils legaux portent sur le CA.
    const totaux = totaliserVentes([CREPE_FROMENT, POT_SIROP]);

    expect(totaux.caTotalCents).toBe(9450); // 7200 + 2250
    expect(totaux.caTransformeCents).toBe(7200);
    expect(totaux.caRevenduCents).toBe(2250);
  });

  it('ne compte pas un produit revendu dans les crepes vendues', () => {
    const totaux = totaliserVentes([CREPE_FROMENT, POT_SIROP]);
    expect(totaux.crepesVendues).toBe(24);
  });

  it('isole le CA consomme sur place, pour le seuil de caisse enregistreuse', () => {
    // La vente a emporter n'est PAS un service de restauration : le compteur
    // reste a zero tant qu'il n'y a ni table ni chaise (docs/07 §6.7).
    expect(totaliserVentes([CREPE_FROMENT]).caSurPlaceCents).toBe(0);
    expect(
      totaliserVentes([{ ...CREPE_FROMENT, consommationSurPlace: true }]).caSurPlaceCents,
    ).toBe(7200);
  });

  it('rend des totaux nuls sur une session sans vente', () => {
    const totaux = totaliserVentes([]);
    expect(totaux.caTotalCents).toBe(0);
    expect(totaux.nbArticlesVendus).toBe(0);
  });
});

describe('partRevenduBp', () => {
  it('mesure la part de la revente dans le CA', () => {
    // 2250 / 9450 = 23,8 %
    expect(partRevenduBp(totaliserVentes([CREPE_FROMENT, POT_SIROP]))).toBe(2381);
  });

  it('rend 0 sur un CA nul plutot que de diviser par zero', () => {
    expect(partRevenduBp(totaliserVentes([]))).toBe(0);
  });
});

describe('calculerRentabilite', () => {
  const base = {
    totaux: totaliserVentes([CREPE_FROMENT, POT_SIROP]),
    // Aucune revente ici (0) : les tests ci-dessous verifient l'arithmetique
    // generale, pas la separation transforme/revendu — voir plus bas la
    // description dediee a cette separation (docs/17 fiche 12).
    coutMatiereTransformeCents: 1200,
    coutMarchandisesRevenduesCents: 0,
    coutComposantsVenteCents: 0,
    frais: {
      emplacementCents: 2200,
      deplacementCents: 1400,
      gazCents: 600,
      diversCents: 0,
      energieCents: 0,
    },
    caCarteCents: 7050,
    tauxCommissionCarteBp: 169,
    production: {
      crepesProduites: 30,
      crepesVendues: 24,
      crepesInvendues: 5,
      crepesCassees: 1,
    },
    dureeMinutes: 390, // 6 h 30
  };

  it('applique la commission carte au seul CA carte', () => {
    // 70,50 € x 1,69 % = 1,19 €
    expect(calculerRentabilite(base).commissionCarteCents).toBe(119);
  });

  it('deduit frais et commission de la marge nette, pas de la brute', () => {
    const r = calculerRentabilite(base);
    expect(r.margeBruteCents).toBe(8250); // 9450 - 1200
    expect(r.margeNetteCents).toBe(3931); // 8250 - 4200 - 119
  });

  /**
   * Fiche 17 — l'électricité entre dans la marge exactement comme les quatre
   * autres postes de frais : `energieCents` de `FraisSession` s'additionne
   * dans `fraisTotauxCents`, donc dans la marge nette ET dans le coût complet
   * par crêpe. Avant ce lot, la durée d'utilisation d'un équipement se
   * saisissait déjà (`equipement_session`) mais ne changeait RIEN à ce que le
   * porteur croyait gagner (voir le rapport de livraison).
   */
  it("fait entrer le coût d'électricité (energieCents) dans la marge et le coût complet", () => {
    const sansEnergie = calculerRentabilite(base);
    const avecEnergie = calculerRentabilite({
      ...base,
      frais: { ...base.frais, energieCents: 450 },
    });

    expect(avecEnergie.margeNetteCents).toBe(sansEnergie.margeNetteCents - 450);
    expect(avecEnergie.fraisTotauxCents).toBe(sansEnergie.fraisTotauxCents + 450);
    expect(avecEnergie.coutCompletParCrepeVendueCents).toBe(
      Math.round((1200 + 4200 + 450 + 119) / 24),
    );
  });

  it('calcule le taux d ecoulement, indicateur qui pilote la prevision suivante', () => {
    expect(calculerRentabilite(base).tauxEcoulementBp).toBe(8000); // 24/30
  });

  it('rend null et non zero quand rien n a ete produit', () => {
    // Une session qui ne vend QUE du revendu (aucune crepe produite) : 0/0
    // vaudrait 0 via `ratioEnPointsDeBase`, ce qui afficherait « 0 %
    // d'ecoulement » — un invendu total — alors que la question ne se pose
    // pas faute de production.
    const r = calculerRentabilite({
      ...base,
      production: { crepesProduites: 0, crepesVendues: 0, crepesInvendues: 0, crepesCassees: 0 },
    });
    expect(r.tauxEcoulementBp).toBeNull();
  });

  it('rend la marge par heure, le seul chiffre qui dit si la session valait le coup', () => {
    // 39,31 € sur 6 h 30 = 6,05 €/h
    expect(calculerRentabilite(base).margeParHeureCents).toBe(605);
  });

  it('rend null et non zero quand la duree est inconnue', () => {
    // Un denominateur invente donnerait un chiffre faux presente comme mesure.
    expect(calculerRentabilite({ ...base, dureeMinutes: null }).margeParHeureCents).toBeNull();
    expect(calculerRentabilite({ ...base, dureeMinutes: 0 }).margeParHeureCents).toBeNull();
  });

  it('impute le cout complet sur les crepes VENDUES, pas produites', () => {
    // Le cout des invendues est supporte par celles qu'on vend, sinon la marge
    // affichee serait flatteuse.
    const r = calculerRentabilite(base);
    expect(r.coutCompletParCrepeVendueCents).toBe(Math.round((1200 + 4200 + 119) / 24));
    expect(r.coutMatiereParCrepeCents).toBe(Math.round(1200 / 24));
  });

  it('rend null sur une session sans vente plutot que de diviser par zero', () => {
    const r = calculerRentabilite({
      ...base,
      totaux: totaliserVentes([]),
      production: { crepesProduites: 30, crepesVendues: 0, crepesInvendues: 30, crepesCassees: 0 },
    });
    expect(r.panierMoyenCents).toBeNull();
    expect(r.coutMatiereParCrepeCents).toBeNull();
    expect(r.coutCompletParCrepeVendueCents).toBeNull();
  });

  /**
   * DOCS/17 FICHE 12 — la matiere REVENDUE ne doit JAMAIS entrer dans un ratio
   * « par crepe », meme si elle pese normalement sur la marge de la session.
   * C'est exactement le defaut mesure sur SM-2026-0003 (`docs/14 G12`) :
   * l'ancien `coutRevientParCrepeCents` melangeait les deux et suggerait ~40 %
   * de marge sur une crepe qui en fait ~90 % (CLAUDE.md §6).
   */
  it('exclut la matiere REVENDUE des ratios par crepe, mais pas de la marge', () => {
    const avecRevente = calculerRentabilite({
      ...base,
      coutMatiereTransformeCents: 1200,
      coutMarchandisesRevenduesCents: 1920, // ex. un pot de sirop a 19,20 €
    });
    const sansRevente = calculerRentabilite({
      ...base,
      coutMatiereTransformeCents: 1200,
      coutMarchandisesRevenduesCents: 0,
    });

    // Les ratios PAR CREPE sont identiques : la revente n'a rien a voir avec
    // une crepe, l'ajouter ne doit rien deplacer.
    expect(avecRevente.coutMatiereParCrepeCents).toBe(sansRevente.coutMatiereParCrepeCents);
    expect(avecRevente.coutCompletParCrepeVendueCents).toBe(
      sansRevente.coutCompletParCrepeVendueCents,
    );
    // La marge, elle, DOIT bouger : la revente a un cout d'achat reel.
    expect(avecRevente.margeBruteCents).toBe(sansRevente.margeBruteCents - 1920);
    expect(avecRevente.coutMatiereCents).toBe(sansRevente.coutMatiereCents + 1920);
  });

  /**
   * Panier DEDIE pour les composants de vente (contenants, cafe a la
   * tasse…), distinct de `coutMarchandisesRevenduesCents` : meme raisonnement
   * que le test precedent, applique au troisieme panier plutot qu'au second.
   */
  it('exclut les COMPOSANTS DE VENTE des ratios par crepe, mais pas de la marge', () => {
    const avecComposants = calculerRentabilite({
      ...base,
      coutMatiereTransformeCents: 1200,
      coutComposantsVenteCents: 340, // ex. gobelets et serviettes
    });
    const sansComposants = calculerRentabilite({
      ...base,
      coutMatiereTransformeCents: 1200,
      coutComposantsVenteCents: 0,
    });

    // Les ratios PAR CREPE sont identiques : un gobelet n'a rien a voir avec
    // une crepe, l'ajouter ne doit rien deplacer.
    expect(avecComposants.coutMatiereParCrepeCents).toBe(sansComposants.coutMatiereParCrepeCents);
    expect(avecComposants.coutCompletParCrepeVendueCents).toBe(
      sansComposants.coutCompletParCrepeVendueCents,
    );
    // La marge, elle, DOIT bouger : les composants ont un cout d'achat reel.
    expect(avecComposants.margeBruteCents).toBe(sansComposants.margeBruteCents - 340);
    expect(avecComposants.coutMatiereCents).toBe(sansComposants.coutMatiereCents + 340);
  });

  /**
   * QUATRIEME PANIER (fiche 15 §5.1, mission « la pate vendue au volume
   * n'est jamais deduite du stock ») : meme raisonnement que les deux
   * paniers precedents, applique a la pate vendue DIRECTEMENT (bouteille).
   */
  it('exclut la PATE VENDUE DIRECTEMENT des ratios par crepe, mais pas de la marge', () => {
    const avecPateVendue = calculerRentabilite({
      ...base,
      coutMatiereTransformeCents: 1200,
      coutPateVendueDirectementCents: 141, // ex. une bouteille de pate
    });
    const sansPateVendue = calculerRentabilite({
      ...base,
      coutMatiereTransformeCents: 1200,
      coutPateVendueDirectementCents: 0,
    });

    // Les ratios PAR CREPE sont identiques : une bouteille n'a cuit aucune
    // crepe, l'ajouter ne doit rien deplacer.
    expect(avecPateVendue.coutMatiereParCrepeCents).toBe(sansPateVendue.coutMatiereParCrepeCents);
    expect(avecPateVendue.coutCompletParCrepeVendueCents).toBe(
      sansPateVendue.coutCompletParCrepeVendueCents,
    );
    // La marge, elle, DOIT bouger : la pate vendue directement a un cout reel.
    expect(avecPateVendue.margeBruteCents).toBe(sansPateVendue.margeBruteCents - 141);
    expect(avecPateVendue.coutMatiereCents).toBe(sansPateVendue.coutMatiereCents + 141);
  });

  it('omettre `coutPateVendueDirectementCents` equivaut a le fournir a 0 : aucune regression pour un appelant qui ne le connait pas encore', () => {
    // `base` n'a jamais porte ce champ (voir sa definition plus haut) : tous
    // les tests precedents de ce bloc l'appellent deja sans lui. Ce test
    // verrouille explicitement l'equivalence avec un 0 fourni.
    expect(calculerRentabilite(base)).toEqual(
      calculerRentabilite({ ...base, coutPateVendueDirectementCents: 0 }),
    );
  });
});

/**
 * Audit du 30/07/2026 — marge brute à 100 % sans qu'aucun champ ne le
 * signale : le trou SYMÉTRIQUE de celui déjà corrigé côté revendu (protégé
 * par `EcartStockVente`) n'avait, lui, aucune protection côté transformé.
 *
 * LE SEUIL DE CETTE MISSION : `caTransformeCents > 0` ET
 * `coutMatiereTransformeCents === 0` ET `coutComposantsVenteCents === 0`,
 * STRICTEMENT — jamais un pourcentage. Voir la doc complète de
 * `coutMatiereTransformeSuspect` pour la justification (pourquoi un seuil
 * relatif protégerait moins bien, et pourquoi le cas « seulement du revendu »
 * doit rester silencieux).
 *
 * TROISIÈME PANIER (mission « café, recette vide, avertissement trop
 * bavard ») : `coutComposantsVenteCents` distingue « aucune source de coût
 * n'a été consultée » de « le coût est dans un autre panier » — un
 * transformé À LA DEMANDE (le café) dont la composition vient entièrement de
 * sa nomenclature de vente a bien un coût matière, simplement compté ici.
 */
describe('coutMatiereTransformeSuspect', () => {
  it("est SUSPECT : du transformé a été vendu, mais AUCUNE des deux sources de coût n'a rien retenu — l'anomalie exacte de cette mission", () => {
    expect(
      coutMatiereTransformeSuspect({
        caTransformeCents: 7200,
        coutMatiereTransformeCents: 0,
        coutComposantsVenteCents: 0,
      }),
    ).toBe(true);
  });

  it("N'EST PAS suspect quand la session n'a vendu QUE du revendu : un coût transformé nul y est la vérité, pas une anomalie", () => {
    expect(
      coutMatiereTransformeSuspect({
        caTransformeCents: 0,
        coutMatiereTransformeCents: 0,
        coutComposantsVenteCents: 0,
      }),
    ).toBe(false);
  });

  it("N'EST PAS suspect dès qu'un coût matière transformé, même partiel (un centime), a réellement été retenu", () => {
    expect(
      coutMatiereTransformeSuspect({
        caTransformeCents: 7200,
        coutMatiereTransformeCents: 1,
        coutComposantsVenteCents: 0,
      }),
    ).toBe(false);
  });

  it("N'EST PAS suspect quand rien n'a été vendu du tout (les trois montants sont nuls)", () => {
    expect(
      coutMatiereTransformeSuspect({
        caTransformeCents: 0,
        coutMatiereTransformeCents: 0,
        coutComposantsVenteCents: 0,
      }),
    ).toBe(false);
  });

  it(
    "N'EST PAS suspect — LE CAS CAFÉ — quand aucun coût n'est retenu dans " +
      "`coutMatiereTransformeCents`, MAIS qu'un coût de composants de vente a " +
      'été retenu : le coût existe, il est simplement dans un autre panier',
    () => {
      expect(
        coutMatiereTransformeSuspect({
          caTransformeCents: 20000,
          coutMatiereTransformeCents: 0,
          coutComposantsVenteCents: 340,
        }),
      ).toBe(false);
    },
  );

  it("N'EST PAS suspect dès qu'un coût de composants de vente, même partiel (un centime), a réellement été retenu — même règle que pour `coutMatiereTransformeCents`", () => {
    expect(
      coutMatiereTransformeSuspect({
        caTransformeCents: 20000,
        coutMatiereTransformeCents: 0,
        coutComposantsVenteCents: 1,
      }),
    ).toBe(false);
  });

  /**
   * QUATRIÈME PANIER (fiche 15 §5.1, mission « la pâte vendue au volume
   * n'est jamais déduite du stock ») : même raisonnement que le cas café
   * ci-dessus, appliqué à une session qui ne vend QUE de la pâte en
   * bouteille (aucune crêpe cuite).
   */
  it(
    "N'EST PAS suspect — LE CAS PÂTE VENDUE AU VOLUME — quand aucun coût " +
      "n'est retenu dans `coutMatiereTransformeCents` NI dans " +
      '`coutComposantsVenteCents`, MAIS que la pâte vendue directement en porte un',
    () => {
      expect(
        coutMatiereTransformeSuspect({
          caTransformeCents: 14_100,
          coutMatiereTransformeCents: 0,
          coutComposantsVenteCents: 0,
          coutPateVendueDirectementCents: 141,
        }),
      ).toBe(false);
    },
  );

  it('EST TOUJOURS suspect quand les TROIS paniers sont nuls, `coutPateVendueDirectementCents` omis ou fourni à 0', () => {
    expect(
      coutMatiereTransformeSuspect({
        caTransformeCents: 7200,
        coutMatiereTransformeCents: 0,
        coutComposantsVenteCents: 0,
      }),
    ).toBe(true);
    expect(
      coutMatiereTransformeSuspect({
        caTransformeCents: 7200,
        coutMatiereTransformeCents: 0,
        coutComposantsVenteCents: 0,
        coutPateVendueDirectementCents: 0,
      }),
    ).toBe(true);
  });
});

/**
 * Fiche 17 — décide le montant d'électricité RÉELLEMENT retenu dans la marge.
 *
 * Trois cas de docs/demandes/17, et la distinction centrale de ce lot : un
 * `montantCents` à 0 peut être un ZÉRO CERTAIN (rien à ajouter, c'est acquis)
 * ou un zéro par EXCLUSION (donnée manquante, compté 0 par prudence) —
 * `raisonExclusion` porte cette différence.
 */
describe('resoudreCoutEnergieSession', () => {
  const UN_RADIATEUR = [{ puissanceW: 1000, dureeMinutes: 120 }]; // 2 kWh

  it('cas 1 — lieu sans électricité : zéro CERTAIN, jamais un avertissement', () => {
    const r = resoudreCoutEnergieSession({
      equipementsUtilises: UN_RADIATEUR,
      facturationElectricite: 'aucune',
      prixKwhCentsParKwh: 20,
    });
    expect(r.montantCents).toBe(0);
    expect(r.raisonExclusion).toBeNull();
  });

  /**
   * LE TEST QUI PROUVE L'ABSENCE DE DOUBLE COMPTAGE (cas 2) : un lieu dont
   * l'électricité est COMPRISE dans l'emplacement, ou au FORFAIT, ne doit
   * jamais la payer une seconde fois — même quand un vrai radiateur a
   * réellement tourné (2 kWh, un coût qui existerait bel et bien si le lieu
   * facturait au compteur). `montantCents` doit rester 0, et SANS
   * avertissement : ce n'est pas une donnée qui manque, c'est un fait acquis
   * (déjà payé via `frais.emplacementCents`).
   */
  it('cas 2 — électricité COMPRISE dans l’emplacement : zéro CERTAIN malgré un usage réel (pas de double comptage)', () => {
    const r = resoudreCoutEnergieSession({
      equipementsUtilises: UN_RADIATEUR,
      facturationElectricite: 'comprise',
      prixKwhCentsParKwh: 20,
    });
    expect(r.montantCents).toBe(0);
    expect(r.raisonExclusion).toBeNull();
  });

  it('cas 2 — électricité au FORFAIT journalier : même garde-fou que « comprise »', () => {
    const r = resoudreCoutEnergieSession({
      equipementsUtilises: UN_RADIATEUR,
      facturationElectricite: 'forfait',
      prixKwhCentsParKwh: 20,
    });
    expect(r.montantCents).toBe(0);
    expect(r.raisonExclusion).toBeNull();
  });

  it('cas 3 — facturé au compteur, prix connu, équipements renseignés : un coût RÉEL, connu', () => {
    // 2 kWh x 20 c€/kWh = 40 c€.
    const r = resoudreCoutEnergieSession({
      equipementsUtilises: UN_RADIATEUR,
      facturationElectricite: 'compteur',
      prixKwhCentsParKwh: 20,
    });
    expect(r.montantCents).toBe(40);
    expect(r.raisonExclusion).toBeNull();
  });

  it('cas 3 — facturé au compteur mais prix du kWh non paramétré : exclu (0), jamais deviné', () => {
    const r = resoudreCoutEnergieSession({
      equipementsUtilises: UN_RADIATEUR,
      facturationElectricite: 'compteur',
      prixKwhCentsParKwh: null,
    });
    expect(r.montantCents).toBe(0);
    expect(r.raisonExclusion).not.toBeNull();
  });

  /**
   * LE CAS DES SESSIONS DÉJÀ CLOSES (et, plus largement, de toute session
   * pour laquelle aucune durée d'équipement n'a jamais été enregistrée) :
   * sur un lieu facturé au compteur, une liste VIDE ne prouve pas « rien n'a
   * tourné » — elle peut aussi bien vouloir dire « jamais mesuré ». Compter 0
   * sans le dire affirmerait à tort que la session n'a rien consommé, ce qui
   * embellirait sa marge (consigne de ce lot). Le montant reste donc 0
   * (rien de plus à soustraire qu'on connaisse), mais SIGNALÉ.
   */
  it("cas 3 — aucune durée d'équipement enregistrée : EXCLU (0), jamais affirmé nul (sessions déjà closes)", () => {
    const r = resoudreCoutEnergieSession({
      equipementsUtilises: [],
      facturationElectricite: 'compteur',
      prixKwhCentsParKwh: 20,
    });
    expect(r.montantCents).toBe(0);
    expect(r.raisonExclusion).not.toBeNull();
  });

  it('mode de facturation du lieu inconnu : exclu (0), jamais lu comme un zéro certain', () => {
    const r = resoudreCoutEnergieSession({
      equipementsUtilises: UN_RADIATEUR,
      facturationElectricite: null,
      prixKwhCentsParKwh: 20,
    });
    expect(r.montantCents).toBe(0);
    expect(r.raisonExclusion).not.toBeNull();
  });

  it('une liste vide sur un lieu SANS électricité reste un zéro certain (rien à mesurer)', () => {
    // Le garde-fou de ce lot ne porte QUE sur `compteur` : un lieu `aucune`
    // n'a de toute façon rien à faire tourner, une liste vide n'y est donc
    // jamais ambiguë.
    const r = resoudreCoutEnergieSession({
      equipementsUtilises: [],
      facturationElectricite: 'aucune',
      prixKwhCentsParKwh: 20,
    });
    expect(r.montantCents).toBe(0);
    expect(r.raisonExclusion).toBeNull();
  });
});

describe('ecartProduction', () => {
  it('est nul quand tout est justifie', () => {
    expect(
      ecartProduction({
        crepesProduites: 30,
        crepesVendues: 24,
        crepesInvendues: 5,
        crepesCassees: 1,
      }),
    ).toBe(0);
  });

  it('signale les crepes non justifiees', () => {
    expect(
      ecartProduction({
        crepesProduites: 30,
        crepesVendues: 24,
        crepesInvendues: 2,
        crepesCassees: 1,
      }),
    ).toBe(3);
  });
});

describe('resoudreCrepesDepuisVolumeRestant', () => {
  it('deduit les crepes depuis le volume mesure — exemple CLAUDE.md §6 (R1, 455 ml / 6 crepes)', () => {
    // Une seule production, sans perte declaree : le ratio agrege coincide
    // avec le rendement de reference de la recette (455/6 ≈ 75,83 ml/crepe).
    // 5000 ml partis en production, 800 ml mesures restants -> 4200 ml
    // consommes -> 4200 * 66 / 5000 = 55,44 -> 55 crepes.
    const resultat = resoudreCrepesDepuisVolumeRestant(
      [{ volumeProduitMl: 5000, crepesProduites: 66 }],
      800,
    );
    expect(resultat.crepesProduites).toBe(55);
    expect(resultat.volumeProduitMl).toBe(5000);
    expect(resultat.volumeConsommeMl).toBe(4200);
  });

  it('agrege plusieurs productions rattachees, ponderees par leur volume', () => {
    // Deux fournees de recettes differentes : le ratio agrege doit ponderer
    // chacune par SON volume, pas les traiter comme un rendement unique.
    const resultat = resoudreCrepesDepuisVolumeRestant(
      [
        { volumeProduitMl: 5000, crepesProduites: 66 }, // R1 : ≈ 75,8 ml/crepe
        { volumeProduitMl: 3000, crepesProduites: 30 }, // R2 : 100 ml/crepe
      ],
      1000, // restant sur le total des deux bacs
    );
    // Volume produit total 8000, restant 1000 -> consomme 7000.
    // Crepes totales 96 sur 8000 ml -> 7000 * 96 / 8000 = 84.
    expect(resultat.volumeProduitMl).toBe(8000);
    expect(resultat.volumeConsommeMl).toBe(7000);
    expect(resultat.crepesProduites).toBe(84);
  });

  it('rend zero crepe quand tout le volume produit est encore dans le bac', () => {
    const resultat = resoudreCrepesDepuisVolumeRestant(
      [{ volumeProduitMl: 5000, crepesProduites: 66 }],
      5000,
    );
    expect(resultat.crepesProduites).toBe(0);
    expect(resultat.volumeConsommeMl).toBe(0);
  });

  it('refuse un volume restant superieur au volume produit — pas une mesure, une saisie impossible', () => {
    expect(() =>
      resoudreCrepesDepuisVolumeRestant([{ volumeProduitMl: 5000, crepesProduites: 66 }], 5001),
    ).toThrow(ErreurMetier);
  });

  it("refuse quand aucune production n'est rattachee (volume total nul)", () => {
    expect(() => resoudreCrepesDepuisVolumeRestant([], 0)).toThrow(ErreurMetier);
  });

  it("n'a aucune notion de coherence avec vendues + invendues + cassees — ce n'est pas son role", () => {
    // La fonction ne prend meme pas ces trois nombres en parametre : c'est
    // la preuve, au niveau du type, qu'elle ne peut PAS les comparer. L'ecart
    // est affiche par l'appelant via `ecartProduction`, jamais refuse ici.
    const resultat = resoudreCrepesDepuisVolumeRestant(
      [{ volumeProduitMl: 5000, crepesProduites: 66 }],
      800,
    );
    expect(
      ecartProduction({
        crepesProduites: resultat.crepesProduites,
        crepesVendues: 40,
        crepesInvendues: 4,
        crepesCassees: 2,
      }),
    ).toBe(9); // 55 - (40 + 4 + 2) : un ecart affiche, pas un refus.
  });

  /**
   * FICHE 15 §5.1 — LE TEST QUI PROUVE QUE VENDRE DEUX LITRES DE PÂTE NE CRÉE
   * PAS DE FAUSSES CRÊPES.
   *
   * Sans cette retenue, les 2000 ml vendus en bouteille quittent le bac
   * exactement comme s'ils avaient été cuits : le calcul les compterait comme
   * des crêpes produites, surestimant la production (55 au lieu de 29).
   */
  it('retranche la pâte vendue directement du volume consommé AVANT de la convertir en crêpes', () => {
    // Même base que le test CLAUDE.md §6 ci-dessus : 5000 ml produits, 66
    // crêpes, 800 ml restants -> 4200 ml disparus du bac. Sans retenue, ces
    // 4200 ml donneraient 55 crêpes (round(4200 * 66 / 5000)).
    const sansPateVendue = resoudreCrepesDepuisVolumeRestant(
      [{ volumeProduitMl: 5000, crepesProduites: 66 }],
      800,
    );
    expect(sansPateVendue.crepesProduites).toBe(55);

    // Sur ces mêmes 4200 ml disparus, 2000 ml sont partis en bouteille, tels
    // quels : seuls 2200 ml ont réellement été cuits en crêpes.
    // round(2200 * 66 / 5000) = round(29,04) = 29.
    const avecPateVendue = resoudreCrepesDepuisVolumeRestant(
      [{ volumeProduitMl: 5000, crepesProduites: 66 }],
      800,
      2000,
    );
    expect(avecPateVendue.crepesProduites).toBe(29);
    expect(avecPateVendue.crepesProduites).not.toBe(sansPateVendue.crepesProduites);
    // Le volume disparu du bac ne change pas : c'est bien sa DESTINATION
    // (crêpes cuites contre pâte embouteillée) qui se répartit différemment.
    expect(avecPateVendue.volumeConsommeMl).toBe(4200);
    expect(avecPateVendue.volumePateVendueMl).toBe(2000);
  });

  /**
   * L'INVARIANT DE LA MISSION « la pâte vendue au volume n'est jamais
   * déduite du stock » (point 4 du rapport demandé) : le volume restant dans
   * le bac, le volume vendu directement en bouteille, et le volume
   * réellement transformé en crêpes doivent se sommer EXACTEMENT au volume
   * produit — aucun millilitre ne doit apparaître ni disparaître.
   */
  it('INVARIANT : volume restant + volume vendu au volume + volume transformé en crêpes = volume produit', () => {
    const resultat = resoudreCrepesDepuisVolumeRestant(
      [{ volumeProduitMl: 5000, crepesProduites: 66 }],
      800,
      2000,
    );
    const volumeTransformeEnCrepesMl = resultat.volumeConsommeMl - resultat.volumePateVendueMl;

    expect(volumeTransformeEnCrepesMl).toBe(2200);
    expect(
      resultat.volumeRestantMl + resultat.volumePateVendueMl + volumeTransformeEnCrepesMl,
    ).toBe(resultat.volumeProduitMl);
  });

  it('omettre le troisième paramètre équivaut à vendre 0 ml de pâte directement (rétrocompatible)', () => {
    const explicite = resoudreCrepesDepuisVolumeRestant(
      [{ volumeProduitMl: 5000, crepesProduites: 66 }],
      800,
      0,
    );
    const implicite = resoudreCrepesDepuisVolumeRestant(
      [{ volumeProduitMl: 5000, crepesProduites: 66 }],
      800,
    );
    expect(implicite).toEqual(explicite);
    expect(implicite.volumePateVendueMl).toBe(0);
  });

  it('refuse un volume de pâte vendue supérieur au volume disparu du bac — pas une mesure, une saisie impossible', () => {
    // 4200 ml disparus, mais 5000 ml de pâte vendue déclarés : physiquement
    // impossible, ce n'est pas un écart de mesure à afficher.
    expect(() =>
      resoudreCrepesDepuisVolumeRestant(
        [{ volumeProduitMl: 5000, crepesProduites: 66 }],
        800,
        5000,
      ),
    ).toThrow(ErreurMetier);
  });

  it('refuse un volume de pâte vendue négatif', () => {
    expect(() =>
      resoudreCrepesDepuisVolumeRestant([{ volumeProduitMl: 5000, crepesProduites: 66 }], 800, -1),
    ).toThrow(ErreurMetier);
  });
});

describe('estPateVendueAuVolume — identifier un produit qui vend la pâte telle quelle', () => {
  it('reconnaît un transformé dont `consommationUnite` vaut `volume_pate`', () => {
    expect(estPateVendueAuVolume({ nature: 'transforme', consommationUnite: 'volume_pate' })).toBe(
      true,
    );
  });

  it("une crêpe normale (`consommationUnite: 'crepes'`) n'est jamais de la pâte vendue au volume", () => {
    expect(estPateVendueAuVolume({ nature: 'transforme', consommationUnite: 'crepes' })).toBe(
      false,
    );
  });

  it('un produit revendu ne peut pas être de la pâte vendue au volume', () => {
    expect(estPateVendueAuVolume({ nature: 'revendu', consommationUnite: null })).toBe(false);
  });

  /**
   * LE DÉFAUT CORRIGÉ (décision du porteur, 31/07/2026, fiche 15 §4) : un
   * transformé À LA DEMANDE (le café) partage `nbCrepes = 0` avec la pâte
   * vendue au volume, pour une raison DIFFÉRENTE — sa composition vient de la
   * nomenclature de vente, jamais d'une recette de production. Avant cette
   * décision, l'ancienne signature (`recetteId !== null && nbCrepes === 0`)
   * rendait VRAI pour un café qu'on avait rattaché à une recette (même vide)
   * pour satisfaire `verifierCoherenceProduit` — ce test prouve que
   * `consommationUnite` lève cette ambiguïté : un `'nomenclature'` n'est
   * JAMAIS de la pâte vendue au volume, quelle que soit sa recette.
   */
  it("un transformé À LA DEMANDE (`consommationUnite: 'nomenclature'`, le café) n'est pas de la pâte vendue au volume", () => {
    expect(estPateVendueAuVolume({ nature: 'transforme', consommationUnite: 'nomenclature' })).toBe(
      false,
    );
  });

  it('un transformé dont `consommationUnite` est encore inconnu (`null`) ne compte pas non plus', () => {
    expect(estPateVendueAuVolume({ nature: 'transforme', consommationUnite: null })).toBe(false);
  });
});

describe('volumePateVendueDirectementMl — cumul du volume vendu en bouteille', () => {
  it('cumule quantité × volume par unité, uniquement sur les lignes de pâte vendue', () => {
    const total = volumePateVendueDirectementMl([
      // 2 bouteilles de 1000 ml de pâte vendue directement.
      { quantite: 2, estPateVendueAuVolume: true, volumeMlParUnite: 1000 },
      // Une crêpe normale : ne contribue jamais, même avec un volume renseigné.
      { quantite: 24, estPateVendueAuVolume: false, volumeMlParUnite: 76 },
    ]);
    expect(total).toBe(2000);
  });

  it('ignore une ligne de pâte vendue dont le volume par unité est encore inconnu', () => {
    // Limite documentée (fiche 15 §5.1) : tant qu'aucun champ du modèle ne
    // porte ce volume, la ligne est IGNORÉE plutôt que comptée pour 0 ml — ce
    // qui serait indiscernable d'une vraie absence de pâte vendue.
    const total = volumePateVendueDirectementMl([
      { quantite: 2, estPateVendueAuVolume: true, volumeMlParUnite: null },
    ]);
    expect(total).toBe(0);
  });

  it('rend 0 sur une liste vide', () => {
    expect(volumePateVendueDirectementMl([])).toBe(0);
  });
});

/**
 * Mission « la pâte vendue au volume n'est jamais déduite du stock »,
 * point 3 du rapport demandé : le coût de la recette doit entrer AU
 * PRORATA du volume vendu — PRÉLEVÉ sur le coût de production déjà connu,
 * JAMAIS RECRÉÉ (une production a déjà sorti farine, lait et œufs du stock
 * une seule fois).
 */
describe('repartirCoutProductionEntrePateVendueEtCrepes', () => {
  it("ne prélève rien quand aucune pâte n'a été vendue au volume — le cas de la quasi-totalité des sessions", () => {
    const resultat = repartirCoutProductionEntrePateVendueEtCrepes({
      coutProductionsCents: 12_800,
      volumeProduitMl: 5000,
      volumePateVendueDirectementMl: 0,
    });
    expect(resultat.coutPateVendueDirectementCents).toBe(0);
    // La totalité reste dans le panier « crêpes » : ZÉRO changement par
    // rapport au calcul d'avant cette mission.
    expect(resultat.coutMatiereTransformeRestantCents).toBe(12_800);
  });

  it("ne lève AUCUNE erreur quand aucune pâte n'est vendue, même sans production rattachée (volumeProduitMl à 0)", () => {
    // Le chemin rapide (`volumePateVendueDirectementMl === 0`) ne doit JAMAIS
    // dépendre de `volumeProduitMl` : une session qui ne vend aucune pâte au
    // volume ne doit jamais buter sur une garde pensée pour l'AUTRE cas.
    const resultat = repartirCoutProductionEntrePateVendueEtCrepes({
      coutProductionsCents: 0,
      volumeProduitMl: 0,
      volumePateVendueDirectementMl: 0,
    });
    expect(resultat).toEqual({
      coutPateVendueDirectementCents: 0,
      coutMatiereTransformeRestantCents: 0,
    });
  });

  it('partage AU PRORATA du volume, sans jamais recréer de coût — la somme égale exactement le coût de production', () => {
    // 12 800 c pour 5000 ml produits, dont 2000 ml vendus en bouteille :
    // 12 800 × 2000/5000 = 5120 c pour la bouteille, 7680 c pour les crêpes.
    const resultat = repartirCoutProductionEntrePateVendueEtCrepes({
      coutProductionsCents: 12_800,
      volumeProduitMl: 5000,
      volumePateVendueDirectementMl: 2000,
    });
    expect(resultat.coutPateVendueDirectementCents).toBe(5120);
    expect(resultat.coutMatiereTransformeRestantCents).toBe(7680);
    // GARANTIE NON NÉGOCIABLE : la somme des deux parts vaut EXACTEMENT le
    // coût de production — rien n'est ajouté, rien n'est perdu.
    expect(
      resultat.coutPateVendueDirectementCents + resultat.coutMatiereTransformeRestantCents,
    ).toBe(12_800);
  });

  it('arrondit UNE SEULE FOIS : un partage qui ne tombe pas juste garde quand même une somme exacte', () => {
    // 10 000 c pour 3000 ml, dont 1000 ml vendus (1/3, décimale périodique) :
    // 10 000 / 3 = 3333,33... → 3333 c, le reste (6667 c) va aux crêpes.
    const resultat = repartirCoutProductionEntrePateVendueEtCrepes({
      coutProductionsCents: 10_000,
      volumeProduitMl: 3000,
      volumePateVendueDirectementMl: 1000,
    });
    expect(resultat.coutPateVendueDirectementCents).toBe(3333);
    expect(resultat.coutMatiereTransformeRestantCents).toBe(6667);
    expect(
      resultat.coutPateVendueDirectementCents + resultat.coutMatiereTransformeRestantCents,
    ).toBe(10_000);
  });

  it("refuse — impossibilité physique — de la pâte vendue au volume alors qu'AUCUNE production n'est rattachée", () => {
    expect(() =>
      repartirCoutProductionEntrePateVendueEtCrepes({
        coutProductionsCents: 0,
        volumeProduitMl: 0,
        volumePateVendueDirectementMl: 500,
      }),
    ).toThrow(ErreurMetier);
  });

  it('refuse — impossibilité physique — un volume vendu supérieur au volume produit', () => {
    expect(() =>
      repartirCoutProductionEntrePateVendueEtCrepes({
        coutProductionsCents: 12_800,
        volumeProduitMl: 5000,
        volumePateVendueDirectementMl: 5001,
      }),
    ).toThrow(ErreurMetier);
  });

  it('accepte le cas limite : toute la pâte produite est vendue au volume, aucune crêpe', () => {
    const resultat = repartirCoutProductionEntrePateVendueEtCrepes({
      coutProductionsCents: 12_800,
      volumeProduitMl: 5000,
      volumePateVendueDirectementMl: 5000,
    });
    expect(resultat.coutPateVendueDirectementCents).toBe(12_800);
    expect(resultat.coutMatiereTransformeRestantCents).toBe(0);
  });
});

describe('projeterSeuil', () => {
  const commun = {
    cle: 'seuil_franchise_tva_cents',
    libelle: 'Franchise TVA',
    plafondCents: 2_500_000,
    sessionsPrevuesDansLAnnee: 50,
  };

  it('projette le CA de fin d annee au rythme observe', () => {
    // 8 sessions a 4210 € cumules -> 50 sessions donneraient 26 312 €.
    const compteur = projeterSeuil({ ...commun, realiseCents: 421_000, sessionsTenues: 8 });
    expect(compteur.projectionFinAnneeCents).toBe(2_631_250);
  });

  it('rend la part instantanee en points de base', () => {
    const compteur = projeterSeuil({ ...commun, realiseCents: 421_000, sessionsTenues: 8 });
    expect(compteur.partBp).toBe(1684); // 16,84 %
  });

  it('ne projette pas sur une seule session', () => {
    // Une seule session ne dit rien d'un rythme.
    const compteur = projeterSeuil({ ...commun, realiseCents: 60_000, sessionsTenues: 1 });
    expect(compteur.projectionFinAnneeCents).toBeNull();
  });

  it('ne divise pas par un plafond nul', () => {
    const compteur = projeterSeuil({
      ...commun,
      plafondCents: 0,
      realiseCents: 100,
      sessionsTenues: 5,
    });
    expect(compteur.partBp).toBe(0);
  });
});

describe('depassementProjete', () => {
  const commun = {
    cle: 'seuil_franchise_tva_cents',
    libelle: 'Franchise TVA',
    plafondCents: 2_500_000,
    sessionsPrevuesDansLAnnee: 50,
  };

  it('alerte quand la trajectoire franchit le plafond, meme loin du seuil', () => {
    // 16,8 % du seuil aujourd'hui, mais la projection depasse : c'est
    // l'alerte qui compte, pas le pourcentage instantane.
    const compteur = projeterSeuil({ ...commun, realiseCents: 421_000, sessionsTenues: 8 });
    expect(compteur.partBp).toBeLessThan(2000);
    expect(depassementProjete(compteur)).toBe(true);
  });

  it("n'alerte pas quand la trajectoire reste sous le plafond", () => {
    const compteur = projeterSeuil({ ...commun, realiseCents: 300_000, sessionsTenues: 8 });
    expect(depassementProjete(compteur)).toBe(false);
  });

  it("n'alerte pas faute de projection", () => {
    const compteur = projeterSeuil({ ...commun, realiseCents: 900_000, sessionsTenues: 1 });
    expect(depassementProjete(compteur)).toBe(false);
  });
});
