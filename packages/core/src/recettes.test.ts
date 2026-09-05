import { describe, expect, it } from 'vitest';
import { ErreurMetier } from './erreurs.js';
import {
  agregerAllergenes,
  comparerLignesRecette,
  coutProduitVendu,
  ingredientLimitant,
  mettreAEchelle,
  rendementNetBp,
  tousAllergenesVerifies,
  type GarnitureCalcul,
  type LigneRecetteComparable,
  type RecetteCalcul,
} from './recettes.js';

/**
 * R1 telle que decrite dans CLAUDE.md §6, pour 6 crepes.
 *
 * Rendement de reference : 455 ml pour 6 crepes, soit ~76 ml/crepe. C'est la
 * valeur retenue par la decision D-014 — 5 L donnent alors ~66 crepes, ce que
 * CLAUDE.md §6 annonce. Les chiffres du calculateur de docs/06 (100 ml/crepe)
 * sont des maquettes illustratives et ne servent pas de reference.
 */
const R1: RecetteCalcul = {
  id: 'r1',
  code: 'R1',
  rendementReferenceMl: 455,
  rendementReferenceCrepes: 6,
  perteCuissonBp: 0,
  tauxCasseBp: 0,
  lignes: [
    {
      ingredientId: 'farine-t55',
      nomIngredient: 'Farine T55',
      unite: 'g',
      quantiteReference: 145,
      cumpCentsParUnite: 0.075,
      allergenes: ['gluten'],
    },
    {
      ingredientId: 'lait-entier',
      nomIngredient: 'Lait entier',
      unite: 'ml',
      quantiteReference: 240,
      cumpCentsParUnite: 0.115,
      allergenes: ['lait'],
    },
    {
      ingredientId: 'oeuf',
      nomIngredient: 'Oeufs',
      unite: 'piece',
      quantiteReference: 2,
      cumpCentsParUnite: 20,
      allergenes: ['oeufs'],
    },
    {
      ingredientId: 'beurre',
      nomIngredient: 'Beurre',
      unite: 'g',
      quantiteReference: 55,
      cumpCentsParUnite: 0.9,
      allergenes: ['lait'],
    },
  ],
};

describe('rendementNetBp', () => {
  it('rend 100 % sans perte ni casse', () => {
    expect(rendementNetBp({ perteCuissonBp: 0, tauxCasseBp: 0 })).toBe(10_000);
  });

  it('applique les deux pertes en cascade, pas en somme', () => {
    // 10 % puis 5 % = 0,90 x 0,95 = 0,855, et non 0,85.
    expect(rendementNetBp({ perteCuissonBp: 1000, tauxCasseBp: 500 })).toBe(8550);
  });
});

describe('mettreAEchelle — cible volume', () => {
  const resultat = mettreAEchelle(R1, { type: 'volume', volumeMl: 5000 });

  it('retrouve les ~66 crepes annoncees par CLAUDE.md §6 pour 5 L', () => {
    expect(resultat.crepesTheoriques).toBe(66);
  });

  it('met chaque ingredient a l echelle du meme facteur', () => {
    // 5000 / 455 = 10,989
    const farine = resultat.lignes.find((l) => l.ingredientId === 'farine-t55');
    const lait = resultat.lignes.find((l) => l.ingredientId === 'lait-entier');
    expect(farine?.quantite).toBe(1593); // 145 x 10,989
    expect(lait?.quantite).toBe(2637); // 240 x 10,989
  });

  it('arrondit les ingredients en pieces a l entier', () => {
    const oeufs = resultat.lignes.find((l) => l.ingredientId === 'oeuf');
    expect(oeufs?.quantite).toBe(22); // 2 x 10,989 = 21,98
    expect(Number.isInteger(oeufs?.quantite)).toBe(true);
  });

  it('chiffre le cout sur la quantite arrondie, pas sur la theorique', () => {
    // Sinon un ecart permanent apparaitrait avec les mouvements de stock.
    // R1 n'a que des prix CONNUS : le `?? 0` ne masque donc rien ici, il ne
    // fait que satisfaire le type `number | null` de `cumpCentsParUnite`
    // (audit 29/07/2026, defaut n°1).
    for (const ligne of resultat.lignes) {
      expect(ligne.coutCents).toBe(Math.round(ligne.quantite * (ligne.cumpCentsParUnite ?? 0)));
    }
  });

  it('rend un cout matiere entier en centimes, total EXACT et non la somme de lignes deja arrondies', () => {
    // Avant l'audit du 29/07/2026 (defaut n°2), ce test comparait
    // `coutMatiereCents` a la somme des `coutCents` DEJA ARRONDIS de chaque
    // ligne — une egalite TAUTOLOGIQUE a l'epoque (c'etait exactement ainsi
    // que le total etait calcule), qui ne testait donc rien de reel et
    // figeait la valeur fausse (155 c sur les vraies donnees de R1, voir
    // `audit-referentiel.test.ts`) sans jamais pouvoir la detecter.
    //
    // La valeur juste est le total EXACT (non arrondi ligne a ligne), arrondi
    // UNE seule fois a la fin — la doctrine de `repartir()` (`argent.ts`).
    // Sur CE jeu de donnees precis, les deux methodes coincident (1406 c dans
    // les deux cas : aucune ligne n'a un cout assez petit pour disparaitre a
    // l'arrondi), donc le nombre ne change pas ici — mais l'assertion, elle,
    // porte desormais sur le calcul CORRECT et non plus sur une tautologie.
    expect(Number.isInteger(resultat.coutMatiereCents)).toBe(true);
    const totalExactCentimes = resultat.lignes.reduce(
      (total, ligne) => total + ligne.quantite * (ligne.cumpCentsParUnite ?? 0),
      0,
    );
    expect(resultat.coutMatiereCents).toBe(Math.round(totalExactCentimes));
    expect(resultat.coutMatiereCents).toBe(1406);
  });

  it('une ligne a tres petit cout ne disparait plus du total (audit 29/07/2026, defaut n°2)', () => {
    // Recette minimale et volontairement construite pour isoler le mecanisme,
    // sans dependre des arrondis propres a R1 (verifie a la main) : une ligne
    // « grosse » dont le cout exact a une partie fractionnaire (500,4 c), et
    // une ligne « minuscule » a la maniere du sel de R1 (2 g a 0,09 c/g =
    // 0,18 c), qui s'arrondit a ZERO individuellement.
    //   - Ancienne methode (arrondir CHAQUE ligne puis sommer) :
    //     round(500,4) + round(0,18) = 500 + 0 = 500.
    //   - Methode CORRIGEE (sommer les valeurs EXACTES puis arrondir UNE fois) :
    //     round(500,4 + 0,18) = round(500,58) = 501.
    // Les deux methodes divergent donc d'exactement 1 centime : c'est ce
    // centime — celui de la ligne minuscule — que l'ancien code perdait.
    const recetteMinuscule: RecetteCalcul = {
      id: 'r-mini',
      code: 'R-MINI',
      rendementReferenceMl: 100,
      rendementReferenceCrepes: 10,
      perteCuissonBp: 0,
      tauxCasseBp: 0,
      lignes: [
        {
          ingredientId: 'gros-poste',
          nomIngredient: 'Gros poste',
          unite: 'g',
          quantiteReference: 2,
          cumpCentsParUnite: 250.2, // 2 x 250,2 = 500,4 c -> arrondi seul a 500.
          allergenes: [],
        },
        {
          ingredientId: 'epice-rare',
          nomIngredient: 'Épice rare',
          unite: 'g',
          quantiteReference: 2,
          cumpCentsParUnite: 0.09, // 2 x 0,09 = 0,18 c -> arrondi seul a 0.
          allergenes: [],
        },
      ],
    };

    // Facteur 1 (volume = rendement de reference) : quantite = quantiteReference.
    const resultatMinuscule = mettreAEchelle(recetteMinuscule, {
      type: 'volume',
      volumeMl: recetteMinuscule.rendementReferenceMl,
    });

    const ligneEpice = resultatMinuscule.lignes.find((l) => l.ingredientId === 'epice-rare');
    expect(ligneEpice?.coutCents).toBe(0); // Arrondi d'affichage par ligne : inoffensif.

    // Le total, lui, DOIT refleter les 0,18 c de l'epice : 501, jamais 500.
    expect(resultatMinuscule.coutMatiereCents).toBe(501);
    const totalAncienneMethode = resultatMinuscule.lignes.reduce(
      (total, ligne) => total + (ligne.coutCents ?? 0),
      0,
    );
    expect(totalAncienneMethode).toBe(500); // La valeur que l'ancien code aurait rendue.
    expect(resultatMinuscule.coutMatiereCents).not.toBe(totalAncienneMethode);
  });

  it('un ingredient sans prix connu rend la ligne ET le total INCONNUS (audit 29/07/2026, defaut n°1)', () => {
    const avecPrixInconnu: RecetteCalcul = {
      ...R1,
      lignes: [
        ...R1.lignes,
        {
          ingredientId: 'cannelle',
          nomIngredient: 'Cannelle',
          unite: 'g',
          quantiteReference: 5,
          cumpCentsParUnite: null,
          allergenes: [],
        },
      ],
    };

    const resultatAvecInconnu = mettreAEchelle(avecPrixInconnu, {
      type: 'volume',
      volumeMl: R1.rendementReferenceMl,
    });

    const ligneCannelle = resultatAvecInconnu.lignes.find((l) => l.ingredientId === 'cannelle');
    // La quantite PESEE reste affichee : seul le COUT est inconnu.
    expect(ligneCannelle?.quantite).toBeGreaterThan(0);
    expect(ligneCannelle?.coutCents).toBeNull();
    // Jamais une somme partielle (celle des autres lignes, bien connues)
    // presentee comme un total complet.
    expect(resultatAvecInconnu.coutMatiereCents).toBeNull();
    expect(resultatAvecInconnu.coutParCrepeCents).toBeNull();
  });
});

describe('mettreAEchelle — cible crepes', () => {
  it('vise des crepes VENDABLES et non theoriques', () => {
    const resultat = mettreAEchelle(R1, { type: 'crepes', crepesVendables: 66 });
    // Sans perte, vendables == theoriques.
    expect(resultat.crepesVendables).toBe(66);
    expect(resultat.volumeMl).toBe(5005);
  });

  it('compense la perte de cuisson et la casse a la hausse', () => {
    const avecPertes: RecetteCalcul = { ...R1, perteCuissonBp: 1000, tauxCasseBp: 500 };
    const resultat = mettreAEchelle(avecPertes, { type: 'crepes', crepesVendables: 100 });

    // Il faut produire plus de 100 crepes theoriques pour en vendre 100.
    expect(resultat.crepesTheoriques).toBeGreaterThan(100);
    expect(resultat.crepesVendables).toBeGreaterThanOrEqual(100);
  });

  it('impute le cout des crepes ratees sur celles qui sont vendues', () => {
    const sansPerte = mettreAEchelle(R1, { type: 'crepes', crepesVendables: 100 });
    const avecPerte = mettreAEchelle(
      { ...R1, perteCuissonBp: 2000, tauxCasseBp: 0 },
      { type: 'crepes', crepesVendables: 100 },
    );
    // Cible de 100 crepes vendables des deux cotes : jamais null ici. La
    // fonction rend desormais `null` plutot que `0` quand `crepesVendables`
    // tombe a zero (docs/17 fiche 7) — hors de propos sur ce cas.
    expect(sansPerte.coutParCrepeCents).not.toBeNull();
    expect(avecPerte.coutParCrepeCents).not.toBeNull();
    // Une marge calculee sur les crepes theoriques serait flatteuse.
    expect(avecPerte.coutParCrepeCents ?? 0).toBeGreaterThan(sansPerte.coutParCrepeCents ?? 0);
  });
});

describe('mettreAEchelle — cible ingredient limitant', () => {
  it('repond a « il me reste 4 kg de farine, ca me fait combien ? »', () => {
    const resultat = mettreAEchelle(R1, {
      type: 'ingredient',
      ingredientId: 'farine-t55',
      quantiteDisponible: 4000,
    });
    // 4000 / 145 = 27,586 fournees de 6 crepes.
    expect(resultat.crepesTheoriques).toBe(166);
    expect(resultat.lignes.find((l) => l.ingredientId === 'farine-t55')?.quantite).toBe(4000);
  });

  it('refuse un ingredient absent de la recette', () => {
    expect(() =>
      mettreAEchelle(R1, {
        type: 'ingredient',
        ingredientId: 'sarrasin',
        quantiteDisponible: 1000,
      }),
    ).toThrow(ErreurMetier);
  });
});

describe('mettreAEchelle — cas limites', () => {
  it('refuse une cible nulle ou negative', () => {
    expect(() => mettreAEchelle(R1, { type: 'volume', volumeMl: 0 })).toThrow(ErreurMetier);
    expect(() => mettreAEchelle(R1, { type: 'crepes', crepesVendables: -5 })).toThrow(ErreurMetier);
  });

  it('refuse une recette sans rendement de reference', () => {
    const cassee: RecetteCalcul = { ...R1, rendementReferenceCrepes: 0 };
    expect(() => mettreAEchelle(cassee, { type: 'volume', volumeMl: 5000 })).toThrow(ErreurMetier);
  });

  it('refuse une recette sans ingredient', () => {
    const vide: RecetteCalcul = { ...R1, lignes: [] };
    expect(() => mettreAEchelle(vide, { type: 'volume', volumeMl: 5000 })).toThrow(ErreurMetier);
  });

  it('refuse une recette dont les pertes annulent la production', () => {
    const absurde: RecetteCalcul = { ...R1, perteCuissonBp: 10_000, tauxCasseBp: 0 };
    expect(() => mettreAEchelle(absurde, { type: 'volume', volumeMl: 5000 })).toThrow(ErreurMetier);
  });
});

describe('coutProduitVendu — garniture sans prix connu (audit 29/07/2026, defaut n°1)', () => {
  // Meme regle que la pate d'une recette : `garnitures.test.ts` verrouille deja
  // le cas nominal (garniture connue, additionnee sans etre re-sommee) ; ce
  // bloc-ci verrouille le cas ou une garniture est PRESENTE mais sans prix.
  const garnitureSansPrix: GarnitureCalcul = {
    ingredientId: 'ing-cannelle',
    nomIngredient: 'Cannelle',
    unite: 'g',
    quantiteParUnite: 3,
    cumpCentsParUnite: null,
    allergenes: [],
  };
  const garnitureConnue: GarnitureCalcul = {
    ingredientId: 'ing-vergeoise',
    nomIngredient: 'Vergeoise blonde',
    unite: 'g',
    quantiteParUnite: 20,
    cumpCentsParUnite: 0.32,
    allergenes: [],
  };

  it('une garniture sans prix rend son propre cout INCONNU, jamais gratuit', () => {
    const cout = coutProduitVendu({
      coutParCrepeCents: 26,
      nbCrepesParUnite: 1,
      coutAchatUniteCents: null,
      estRevendu: false,
      garnitures: [garnitureSansPrix],
      allergenesPate: [],
    });

    const ligneCannelle = cout.garnitures.find((g) => g.ingredientId === 'ing-cannelle');
    expect(ligneCannelle?.coutCents).toBeNull();
  });

  it('une seule garniture sans prix rend coutGarnituresCents ET coutMatiereCents INCONNUS, pas amputes', () => {
    const cout = coutProduitVendu({
      coutParCrepeCents: 26,
      nbCrepesParUnite: 1,
      coutAchatUniteCents: null,
      estRevendu: false,
      // Une garniture CONNUE et une garniture INCONNUE : le total ne doit
      // jamais se réduire silencieusement à la seule part connue (26 + 6 = 32),
      // ce qui compterait la cannelle comme gratuite.
      garnitures: [garnitureConnue, garnitureSansPrix],
      allergenesPate: [],
    });

    expect(cout.coutGarnituresCents).toBeNull();
    expect(cout.coutMatiereCents).toBeNull();
    // La pate, elle, reste chiffrable individuellement (aucune ambiguite sur
    // cette composante) — seul le TOTAL devient inconnu.
    expect(cout.coutPateCents).toBe(26);
  });
});

describe('coutProduitVendu — une OPTION porte son allergène (fiche 15 §4.1bis, [ALERTE])', () => {
  // Un café noir (recette de base + composants structurels : café, sucre,
  // eau, gobelet) ne porte aucun allergène. Un café SERVI AVEC CRÈME, si —
  // et l'application ne sait pas à l'avance ce que le client demandera : le
  // calcul doit donc porter sur le produit TEL QU'IL PEUT ÊTRE SERVI, options
  // comprises, jamais sur la seule recette de base.
  const cafeNoir = {
    coutParCrepeCents: null,
    nbCrepesParUnite: 0,
    coutAchatUniteCents: null,
    // Transforme A LA DEMANDE (D-085) : ni un revendu, ni la pate d'une
    // fournee — voir `estRevendu` (`recettes.ts`).
    estRevendu: false,
    garnitures: [],
    allergenesPate: [],
  };

  it("un produit sans nomenclature de vente déclarée n'est pas affecté (cas normal, pas une erreur)", () => {
    const cout = coutProduitVendu(cafeNoir);
    expect(cout.allergenes).toEqual([]);
  });

  it('un composant de nomenclature de vente SANS allergène (café, sucre, eau, gobelet) ne change rien', () => {
    const cout = coutProduitVendu({
      ...cafeNoir,
      composants: [{ allergenes: [] }, { allergenes: [] }],
    });
    expect(cout.allergenes).toEqual([]);
  });

  it("[ALERTE] une OPTION (crème) ajoute son allergène alors que la recette de base n'en porte aucun", () => {
    // C'est le défaut exact à corriger : sans cette prise en compte,
    // l'application déclarerait ce café « sans allergène » alors qu'on vient
    // d'y verser de la crème — une information FAUSSE donnée à un client
    // allergique, pas une simple imprécision comptable.
    const cafeAvecCreme = coutProduitVendu({
      ...cafeNoir,
      composants: [{ allergenes: [] }, { allergenes: ['lait'] }],
    });
    expect(cafeAvecCreme.allergenes).toEqual(['lait']);

    // Le café noir, lui, reste bien sans allergène : l'option ne contamine
    // pas les AUTRES ventes du même produit.
    const cafeSansOption = coutProduitVendu(cafeNoir);
    expect(cafeSansOption.allergenes).toEqual([]);
  });

  it('agrège les allergènes de la pâte, des garnitures ET des composants de vente, sans doublon', () => {
    const cout = coutProduitVendu({
      coutParCrepeCents: 26,
      nbCrepesParUnite: 1,
      coutAchatUniteCents: null,
      estRevendu: false,
      garnitures: [
        {
          ingredientId: 'ing-beurre',
          nomIngredient: 'Beurre',
          unite: 'g',
          quantiteParUnite: 5,
          cumpCentsParUnite: 0.9,
          allergenes: ['lait'],
        },
      ],
      allergenesPate: ['gluten'],
      // « lait » apparaît déjà via la garniture ET via l'option : une seule
      // occurrence doit rester dans le résultat.
      composants: [{ allergenes: ['lait'] }, { allergenes: ['fruits à coque'] }],
    });
    expect(cout.allergenes).toEqual(['fruits à coque', 'gluten', 'lait']);
  });
});

describe('coutProduitVendu — D-085 : volume_pate hérite à tort du faux positif « revendu sans achat »', () => {
  // Une pâte vendue au volume (D-085, `consommationUnite: 'volume_pate'`,
  // la pâte en bouteille) partage `nbCrepesParUnite === 0` avec un
  // transformé À LA DEMANDE (le café, `nomenclature`) ET avec un vrai
  // REVENDU — mais elle n'est ni l'un ni l'autre : ce n'est pas un article
  // acheté préemballé, elle n'attend donc AUCUN prix d'achat. Avant ce
  // correctif, `coutProduitVendu` ne le savait pas : elle traitait TOUT
  // `nbCrepesParUnite === 0` comme « revendu sans prix d'achat connu »,
  // exactement le défaut que D-085 a déjà dû corriger une fois côté café.
  const BOUCHON: GarnitureCalcul = {
    ingredientId: 'ing-bouchon',
    nomIngredient: 'Bouchon liège',
    unite: 'piece',
    quantiteParUnite: 1,
    cumpCentsParUnite: 8,
    allergenes: [],
  };

  it('sans `estPateVendueAuVolume`, une pâte au volume garde son défaut D-085 originel : la pâte ne pèse RIEN dans le total', () => {
    // REPRODUCTION DU ROUGE (mission « la pâte vendue au volume n'est jamais
    // déduite du stock », 01/08/2026) : c'est EXACTEMENT l'appel que
    // `packages/db/src/depots/recettes.ts::coutRevientProduit` fait encore
    // aujourd'hui (hors zone d'écriture de cette mission) — il ne fournit ni
    // `estPateVendueAuVolume`, ni `coutParMlCents`, ni `volumeMlParUnite`.
    // `nbCrepesParUnite: 0` (une pâte au volume ne consomme aucune crêpe)
    // fait que `coutParCrepeCents * nbCrepesParUnite` vaut TOUJOURS zéro,
    // quel que soit le prix de la recette : c'est le mensonge « coût à zéro,
    // marge à 100 % » que cette mission corrige — voir le test suivant pour
    // la correction, à ACTIVER en fournissant les trois champs ci-dessous.
    const cout = coutProduitVendu({
      coutParCrepeCents: 33, // recette entièrement chiffrée (R1, CLAUDE.md §6)
      nbCrepesParUnite: 0, // D-085 : `volume_pate`, pas des crêpes
      coutAchatUniteCents: null, // aucun article acheté : SANS OBJET, pas manquant
      estRevendu: false, // ni un revendu ni un café : une pâte au volume
      garnitures: [BOUCHON], // connue elle aussi
      allergenesPate: [],
    });

    // Chaque composante est CONNUE (pâte à 33, bouchon à 8) : le total ne
    // doit jamais être `null` (D-085, `estRevendu: false` évite le faux
    // positif « revendu sans prix d'achat »).
    expect(cout.coutMatiereCents).not.toBeNull();
    // Mais la pâte, elle, ne pèse toujours RIEN dans ce total tant que
    // `estPateVendueAuVolume` n'est pas explicitement fourni : seule la
    // garniture y contribue. Prix de vente inchangé, coût matière ampute
    // → marge affichée gonflée. C'est précisément le rouge à corriger.
    expect(cout.coutPateCents).toBe(0);
    expect(cout.coutMatiereCents).toBe(8);
  });

  it('[CORRECTION] avec `estPateVendueAuVolume` + `coutParMlCents` + `volumeMlParUnite`, la pâte pèse enfin dans le coût — un seul arrondi, à la fin', () => {
    // Taux de coût EXACT (non arrondi), volontairement une décimale
    // périodique : 127,975 c pour 455 ml (R1, CLAUDE.md §6) = 0,2812637...
    // c/ml. Si ce taux était arrondi AVANT d'être multiplié par le volume
    // (« 0 centime le ml »), la pâte disparaîtrait entièrement du coût — la
    // même classe de piège que la cannelle (fiche 15 §4.1) ou la farine
    // (docs internes de `mettreAEchelle`).
    const coutParMlCentsExact = 127.975 / 455;
    const cout = coutProduitVendu({
      coutParCrepeCents: null, // sans objet pour une pâte au volume
      nbCrepesParUnite: 0,
      coutAchatUniteCents: null,
      estRevendu: false,
      estPateVendueAuVolume: true,
      coutParMlCents: coutParMlCentsExact,
      volumeMlParUnite: 500, // bouteille de 50 cl
      garnitures: [BOUCHON], // le bouchon, 8 c
      allergenesPate: [],
    });

    // 0,2812637... × 500 = 140,6318... → arrondi UNE FOIS à 141. Une pâte
    // dont le taux au ml aurait été arrondi AVANT la multiplication vaudrait
    // 0 (0,28 arrondi à l'entier) : ce test verrouille que ce n'est PAS ce
    // qui se produit.
    expect(cout.coutPateCents).toBe(141);
    // Le total agrège la pâte (141) ET le bouchon (8), jamais l'un sans
    // l'autre : 149, pas 8 comme dans le test précédent (le rouge).
    expect(cout.coutMatiereCents).toBe(149);
  });

  it('[CORRECTION] un coût au ml INCONNU rend le total `null`, jamais `0` (« inconnu ≠ gratuit », CLAUDE.md §7)', () => {
    const cout = coutProduitVendu({
      coutParCrepeCents: null,
      nbCrepesParUnite: 0,
      coutAchatUniteCents: null,
      estRevendu: false,
      estPateVendueAuVolume: true,
      coutParMlCents: null, // recette pas encore chiffrable (prix manquant, par exemple)
      volumeMlParUnite: 500,
      garnitures: [],
      allergenesPate: [],
    });

    expect(cout.coutPateCents).toBe(0);
    expect(cout.coutMatiereCents).toBeNull();
  });

  it('[CORRECTION] un `volumeMlParUnite` manquant rend aussi le total `null`, même garde-fou', () => {
    const cout = coutProduitVendu({
      coutParCrepeCents: null,
      nbCrepesParUnite: 0,
      coutAchatUniteCents: null,
      estRevendu: false,
      estPateVendueAuVolume: true,
      coutParMlCents: 0.28,
      volumeMlParUnite: null,
      garnitures: [],
      allergenesPate: [],
    });

    expect(cout.coutMatiereCents).toBeNull();
  });

  it('un vrai REVENDU sans prix d’achat reste bien `null` : `estRevendu` ne relâche rien pour lui', () => {
    // Non-régression : la distinction ne doit jamais dispenser un revendu
    // réel de son prix d'achat.
    const cout = coutProduitVendu({
      coutParCrepeCents: null,
      nbCrepesParUnite: 0,
      coutAchatUniteCents: null,
      estRevendu: true,
      garnitures: [],
      allergenesPate: [],
    });

    expect(cout.coutMatiereCents).toBeNull();
  });

  it('une CRÊPE ordinaire ignore totalement `estPateVendueAuVolume` omis : aucune régression sur le chemin existant', () => {
    // Un produit crêpe classique n'a jamais de raison de fournir les trois
    // nouveaux champs : `coutProduitVendu` doit se comporter exactement comme
    // avant cette mission quand ils sont omis.
    const cout = coutProduitVendu({
      coutParCrepeCents: 21,
      nbCrepesParUnite: 2,
      coutAchatUniteCents: null,
      estRevendu: false,
      garnitures: [],
      allergenesPate: [],
    });

    expect(cout.coutPateCents).toBe(42);
    expect(cout.coutMatiereCents).toBe(42);
  });
});

describe('agregerAllergenes', () => {
  it('dedoublonne et trie les allergenes de la recette', () => {
    // « lait » apparait sur le lait entier ET sur le beurre.
    expect(agregerAllergenes(R1.lignes)).toEqual(['gluten', 'lait', 'oeufs']);
  });

  it('rend une liste vide pour une recette sans allergene', () => {
    expect(agregerAllergenes([{ allergenes: [] }])).toEqual([]);
  });
});

/**
 * Audit allergenes du 31/07/2026 (docs/30-AUDIT-ALLERGENES.md §2.2) : sans ce
 * drapeau, « jamais vérifié » et « vérifié, aucun allergène » produisaient le
 * même tiret sur les deux panneaux de calcul en direct de Recettes.tsx. Ces
 * tests couvrent la fonction pure ; ils NE PROUVENT PAS que Recettes.tsx
 * l'utilise correctement à l'écran — ce paquet ne rend aucun composant, par
 * construction (CLAUDE.md §3 règle 1). Le rendu se prouve côté `apps/web`,
 * le VISUEL par une capture d'écran.
 */
describe('tousAllergenesVerifies', () => {
  it('rend faux si UNE SEULE ligne n a jamais ete verifiee', () => {
    expect(
      tousAllergenesVerifies([{ allergenesVerifies: true }, { allergenesVerifies: false }]),
    ).toBe(false);
  });

  it('traite un drapeau ABSENT exactement comme non verifie, jamais comme verifie', () => {
    // Cas des appelants qui n'ont pas cette information (moteur de prevision,
    // service de production) : l'absence ne doit jamais se lire comme une
    // confirmation silencieuse.
    expect(tousAllergenesVerifies([{ allergenesVerifies: true }, {}])).toBe(false);
  });

  it('rend vrai seulement quand TOUTES les lignes sont verifiees', () => {
    expect(
      tousAllergenesVerifies([{ allergenesVerifies: true }, { allergenesVerifies: true }]),
    ).toBe(true);
  });

  it('rend vrai sur une liste vide (aucune ligne contradictoire)', () => {
    expect(tousAllergenesVerifies([])).toBe(true);
  });
});

describe('mettreAEchelle — allergenesVerifies agrege', () => {
  const ligneVerifieeSansAllergene = {
    ingredientId: 'sucre',
    nomIngredient: 'Sucre',
    unite: 'g' as const,
    quantiteReference: 10,
    cumpCentsParUnite: 1,
    allergenes: [] as string[],
    allergenesVerifies: true,
  };
  const ligneNonVerifiee = {
    ingredientId: 'mystere',
    nomIngredient: 'Ingrédient mystère',
    unite: 'g' as const,
    quantiteReference: 5,
    cumpCentsParUnite: 1,
    allergenes: [] as string[],
    allergenesVerifies: false,
  };
  const base: RecetteCalcul = {
    id: 'r-test',
    code: 'TEST',
    rendementReferenceMl: 100,
    rendementReferenceCrepes: 1,
    perteCuissonBp: 0,
    tauxCasseBp: 0,
    lignes: [],
  };

  it('vrai, aucun allergène : toutes les lignes sont vérifiées', () => {
    const resultat = mettreAEchelle(
      { ...base, lignes: [ligneVerifieeSansAllergene] },
      { type: 'volume', volumeMl: 100 },
    );
    expect(resultat.allergenesVerifies).toBe(true);
    expect(resultat.allergenes).toEqual([]);
  });

  it('faux dès qu une seule ligne n a jamais été vérifiée — même avec une liste vide', () => {
    const resultat = mettreAEchelle(
      { ...base, lignes: [ligneVerifieeSansAllergene, ligneNonVerifiee] },
      { type: 'volume', volumeMl: 100 },
    );
    // C'EST le défaut corrigé : `allergenes` reste vide ici, mais le drapeau
    // dit qu'il ne faut PAS lire cette liste vide comme « aucun allergène ».
    expect(resultat.allergenes).toEqual([]);
    expect(resultat.allergenesVerifies).toBe(false);
  });

  it('une ligne sans le drapeau (appelant qui ne le fournit pas) compte comme non vérifiée', () => {
    // Construit SANS `allergenesVerifies` plutôt que de le mettre à
    // `undefined` (`exactOptionalPropertyTypes` distingue les deux) : c'est
    // exactement le cas des appelants qui n'ont pas cette information.
    const ligneSansDrapeau = {
      ingredientId: ligneVerifieeSansAllergene.ingredientId,
      nomIngredient: ligneVerifieeSansAllergene.nomIngredient,
      unite: ligneVerifieeSansAllergene.unite,
      quantiteReference: ligneVerifieeSansAllergene.quantiteReference,
      cumpCentsParUnite: ligneVerifieeSansAllergene.cumpCentsParUnite,
      allergenes: ligneVerifieeSansAllergene.allergenes,
    };
    const resultat = mettreAEchelle(
      { ...base, lignes: [ligneSansDrapeau] },
      { type: 'volume', volumeMl: 100 },
    );
    expect(resultat.allergenesVerifies).toBe(false);
  });
});

describe('ingredientLimitant', () => {
  it('designe l ingredient qui bride la production', () => {
    const stock = new Map([
      ['farine-t55', 10_000], // 68,9 fournees
      ['lait-entier', 3000], // 12,5 fournees  <- le plus contraignant
      ['oeuf', 60], // 30 fournees
      ['beurre', 5000], // 90,9 fournees
    ]);
    const limitant = ingredientLimitant(R1, stock);
    expect(limitant?.ingredientId).toBe('lait-entier');
    expect(limitant?.facteurMaximal).toBeCloseTo(12.5, 2);
  });

  it('traite un ingredient absent du stock comme une quantite nulle', () => {
    const limitant = ingredientLimitant(R1, new Map([['farine-t55', 10_000]]));
    expect(limitant?.facteurMaximal).toBe(0);
  });
});

describe('comparerLignesRecette', () => {
  const farine: LigneRecetteComparable = {
    ingredientId: 'farine-t55',
    nomIngredient: 'Farine T55',
    unite: 'g',
    quantiteReference: 145,
  };
  const lait: LigneRecetteComparable = {
    ingredientId: 'lait-entier',
    nomIngredient: 'Lait entier',
    unite: 'ml',
    quantiteReference: 240,
  };
  const confiture: LigneRecetteComparable = {
    ingredientId: 'confiture-mirabelle',
    nomIngredient: 'Confiture de mirabelle',
    unite: 'g',
    quantiteReference: 30,
  };

  it('detecte un ingredient ajoute (present seulement dans la version apres)', () => {
    const differences = comparerLignesRecette([farine], [farine, confiture]);
    expect(differences).toEqual([
      { evolution: 'inchangee', ligne: farine },
      { evolution: 'ajoutee', ligne: confiture },
    ]);
  });

  it('detecte un ingredient retire (present seulement dans la version avant)', () => {
    const differences = comparerLignesRecette([farine, lait], [farine]);
    expect(differences).toEqual([
      { evolution: 'inchangee', ligne: farine },
      { evolution: 'retiree', ligne: lait },
    ]);
  });

  it('detecte une quantite modifiee sur un ingredient present des deux cotes', () => {
    const laitAugmente = { ...lait, quantiteReference: 260 };
    const differences = comparerLignesRecette([farine, lait], [farine, laitAugmente]);
    expect(differences).toEqual([
      { evolution: 'inchangee', ligne: farine },
      {
        evolution: 'quantite-modifiee',
        ingredientId: 'lait-entier',
        nomIngredient: 'Lait entier',
        unite: 'ml',
        quantiteAvant: 240,
        quantiteApres: 260,
      },
    ]);
  });

  it('ne signale rien quand la composition est identique', () => {
    const differences = comparerLignesRecette([farine, lait], [farine, lait]);
    expect(differences.every((d) => d.evolution === 'inchangee')).toBe(true);
  });

  it('appairage par ingredientId, pas par position : un reordonnancement seul n’est pas une modification', () => {
    const differences = comparerLignesRecette([farine, lait], [lait, farine]);
    expect(differences).toEqual([
      { evolution: 'inchangee', ligne: farine },
      { evolution: 'inchangee', ligne: lait },
    ]);
  });

  it('rend un tableau vide pour deux compositions vides', () => {
    expect(comparerLignesRecette([], [])).toEqual([]);
  });
});
