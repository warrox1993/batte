import { describe, expect, it } from 'vitest';
import {
  TIRET_ABSENT,
  type IngredientComplet,
  type LigneRecetteContrat,
  type RecetteDetail,
} from '@batte/core';
import {
  BROUILLON_VIDE,
  champAFocaliserApresAjoutLigne,
  cibleFocusApresChangementStatutRecette,
  libelleNouvelleVersion,
  lignesReferenceAffichees,
  phraseProduitsSurVersion,
  statutAffichageRecette,
  texteAllergenesRecalcules,
} from './Recettes';

/**
 * Audit du 30/07/2026 (« inconnu affiché comme zéro », couche affichage) :
 * le titre du panneau « Nouvelle version » calculait
 * `(recetteActive?.version ?? 0) + 1` — un repli qui ne peut jamais se
 * déclencher AUJOURD'HUI (`ouvrirEdition` garde contre `recetteActive ===
 * null` avant d'entrer en mode `version`), mais que le TYPE
 * (`RecetteDetail | null`) autorise. Si cette garde venait à sauter un jour,
 * l'écran aurait affiché « v1 » — un vrai numéro de version — pour une
 * recette dont on ne connaît en réalité aucune version.
 */

const RECETTE_MINIMALE: RecetteDetail = {
  id: 'recette-1',
  code: 'R1',
  nom: 'Froment',
  version: 3,
  statut: 'active',
  sansGluten: false,
  rendementReferenceMl: 5000,
  rendementReferenceCrepes: 66,
  nbLignes: 8,
  coutParCrepeCents: 33,
  typePate: 'froment',
  perteCuissonBp: 500,
  tauxCasseBp: 200,
  perteFixeMl: 100,
  procede: null,
  notes: null,
  dateActivation: '2026-01-01',
  lignes: [],
};

describe('libelleNouvelleVersion', () => {
  it('incrémente la version connue', () => {
    expect(libelleNouvelleVersion(RECETTE_MINIMALE)).toBe('4');
  });

  it('ne fabrique JAMAIS un numéro de version quand la recette active est inconnue', () => {
    expect(libelleNouvelleVersion(null)).toBe(TIRET_ABSENT);
  });
});

/**
 * Audit du 31/07/2026 (docs/21-CHAMPS-NON-LUS.md §1.7) : `nbProduits`
 * (`schemaRecetteReferentiel`) était calculé, testé, servi par
 * `GET /referentiel/recettes`, et jamais lu par cet écran — seul le compteur
 * voisin `nbProductions` (qui scelle la recette) l'était. Le commentaire du
 * contrat exige que ce compte soit annoncé AVANT le clic sur « Créer la
 * version », jamais après.
 *
 * Ces tests prouvent le choix de PHRASE selon le compte — ce fichier ne monte
 * pas l'écran, donc pas de preuve que la phrase apparaît réellement dans le
 * DOM au bon endroit ; c'est le rôle de `Recettes.montage.test.tsx`, à côté.
 */
/**
 * Recette au navigateur du 31/07/2026 : cette colonne rendait le statut en
 * texte nu, sans glyphe ni couleur, contrairement à Sessions/Fournisseurs
 * (`statutFournisseur`, `Fournisseurs.tsx`). Un mot SEUL ne porte aucun
 * signal avant lecture ; la couleur SEULE ne suffit ni au daltonisme ni à
 * l'export PDF noir et blanc (docs/06) — d'où le doublement systématique.
 */
describe('statutAffichageRecette', () => {
  it('« brouillon » porte l’alerte : une recette non activée attend une décision (« Activer »)', () => {
    expect(statutAffichageRecette('brouillon')).toEqual({
      texte: '▲ Brouillon',
      classe: 'text-alerte',
    });
  });

  it('« active » porte le conforme : c’est l’état normal, productible', () => {
    expect(statutAffichageRecette('active')).toEqual({
      texte: '● Active',
      classe: 'text-conforme',
    });
  });

  it('« archivee » reste NEUTRE, sans glyphe : une fin de vie normale n’est pas une alerte', () => {
    expect(statutAffichageRecette('archivee')).toEqual({
      texte: 'Archivée',
      classe: 'text-ink-3',
    });
  });
});

describe('phraseProduitsSurVersion', () => {
  it('dit qu’aucun produit n’est affecté quand le compte est nul', () => {
    const phrase = phraseProduitsSurVersion(0);
    expect(phrase).toContain('Aucun produit');
    expect(phrase).not.toContain('undefined');
  });

  it('accorde au singulier pour un seul produit', () => {
    const phrase = phraseProduitsSurVersion(1);
    expect(phrase.startsWith('1 produit de vente est rattaché')).toBe(true);
  });

  it('accorde au pluriel pour plusieurs produits, et nomme le compte exact', () => {
    const phrase = phraseProduitsSurVersion(3);
    expect(phrase).toContain('3 produits de vente sont rattachés');
  });
});

/**
 * Défaut mesuré par la recette clavier du 30/07/2026, reproduit deux fois :
 * après un clic sur « Ajouter un ingrédient », le focus restait sur ce
 * bouton, et le `Tab` suivant sautait entièrement la ligne qu'on venait de
 * créer pour atterrir sur « Procédé » — 4 `Shift+Tab` pour rattraper la
 * première ligne, 5 pour la deuxième.
 *
 * `champAFocaliserApresAjoutLigne` est la décision PURE derrière le
 * correctif (même mécanisme que `Factures.tsx` : une ref retient la clé de
 * la ligne neuve, un effet la retrouve dans `brouillon.lignes` une fois le
 * rendu fait). CE QUE CES TESTS NE PROUVENT PAS : que le focus arrive
 * réellement dans le navigateur — ce fichier ne monte pas l'écran, donc
 * `document.activeElement` n'y est pas observable (voir
 * `Recettes.montage.test.tsx`). Ils prouvent seulement
 * que le NOM DE CHAMP visé est le bon, compte tenu de la position de la
 * ligne dans le tableau au moment de l'effet.
 */
describe('champAFocaliserApresAjoutLigne', () => {
  it("cible l'ingrédient de l'unique ligne, à l'index 0", () => {
    const lignes = [{ cle: 'ligne-1', ingredientId: '', quantite: '', noteTechnique: '' }];
    expect(champAFocaliserApresAjoutLigne('ligne-1', lignes)).toBe('lignes.0.ingredientId');
  });

  it("cible l'ingrédient de la ligne ajoutée en DERNIER, quel que soit son index", () => {
    const lignes = [
      { cle: 'ligne-1', ingredientId: 'farine-t55', quantite: '145', noteTechnique: '' },
      { cle: 'ligne-2', ingredientId: 'lait-entier', quantite: '240', noteTechnique: '' },
      { cle: 'ligne-3', ingredientId: '', quantite: '', noteTechnique: '' },
    ];
    // C'est exactement le cas « deuxième ligne » du rapport : 5 Shift+Tab
    // auraient été nécessaires pour y revenir sans ce correctif.
    expect(champAFocaliserApresAjoutLigne('ligne-3', lignes)).toBe('lignes.2.ingredientId');
  });

  it("renvoie null si la clé n'existe plus dans les lignes courantes (ref périmée)", () => {
    const lignes = [{ cle: 'ligne-1', ingredientId: '', quantite: '', noteTechnique: '' }];
    expect(champAFocaliserApresAjoutLigne('ligne-disparue', lignes)).toBeNull();
  });

  it('renvoie null sur une liste de lignes vide', () => {
    expect(champAFocaliserApresAjoutLigne('ligne-1', [])).toBeNull();
  });
});

/**
 * Arbitrage du 30/07/2026 sur les « 0 » de démarrage du formulaire (audit
 * « inconnu affiché comme zéro ») : « Fournée de référence » et « Crêpes
 * obtenues » démarrent déjà vides, correctement. Sur les trois autres
 * champs numériques de l'en-tête, seul `perteFixeMl` peut suivre le même
 * chemin — voir le commentaire sur `BROUILLON_VIDE` dans `Recettes.tsx` pour
 * la justification complète (schéma vs colonne SQLite). Ce test verrouille
 * l'arbitrage : il échouerait si un futur correctif remettait `perteFixeMl`
 * à '0', ou videait à tort `perteCuissonBp`/`tauxCasseBp` sans que le schéma
 * et la colonne aient été mis à jour pour l'accepter.
 */
describe('BROUILLON_VIDE — démarrage des champs numériques de pertes', () => {
  it('perteFixeMl démarre VIDE : son schéma accepte déjà `null`/absent (converti en 0 à l’écriture)', () => {
    expect(BROUILLON_VIDE.perteFixeMl).toBe('');
  });

  it('perteCuissonBp et tauxCasseBp restent à 0 : ni le schéma ni la colonne SQLite (NOT NULL) ne savent exprimer « non renseigné » pour eux', () => {
    expect(BROUILLON_VIDE.perteCuissonBp).toBe('0');
    expect(BROUILLON_VIDE.tauxCasseBp).toBe('0');
  });
});

/**
 * Recette clavier du 31/07/2026 (D-079, `docs/22-FOCUS-DETRUIT.md` §2.3) :
 * « Activer »/« Archiver » faisaient retomber le focus sur `<body>`, en
 * démontant tout le panneau « Fiche technique ».
 *
 * « Activer » et « Archiver » sont deux boutons MUTUELLEMENT EXCLUSIFS au
 * même endroit de la fiche : cliquer l'un fait disparaître SON bouton et
 * apparaître l'AUTRE à sa place — jamais l'inverse, jamais les deux à la
 * fois. `cibleFocusApresChangementStatutRecette` est la décision PURE
 * derrière le correctif.
 *
 * Ce fichier ne monte pas l'écran : ce test fige la décision (quel bouton
 * devient la cible), pas le geste — il ne prouve PAS que `Recettes.tsx` pose
 * effectivement le focus sur ce bouton dans le DOM réel. Le montage vit dans
 * `Recettes.montage.test.tsx`.
 */
describe('cibleFocusApresChangementStatutRecette', () => {
  it('vise « archiver » quand la recette vient de devenir active : « Activer » a disparu, « Archiver » prend sa place', () => {
    expect(cibleFocusApresChangementStatutRecette('active')).toBe('archiver');
  });

  it('vise « activer » quand la recette vient d’être archivée : « Archiver » a disparu, « Activer » prend sa place', () => {
    expect(cibleFocusApresChangementStatutRecette('archivee')).toBe('activer');
  });

  it('vise « activer » aussi pour un retour à « brouillon » — cas non exploité par l’écran aujourd’hui (aucun bouton n’y ramène), mais couvert par exhaustivité sur le type', () => {
    expect(cibleFocusApresChangementStatutRecette('brouillon')).toBe('activer');
  });
});

/**
 * Audit allergènes du 31/07/2026 (docs/30-AUDIT-ALLERGENES.md §2.2) : cette
 * fonction est la décision PURE derrière `AllergenesRecalcules`, le
 * sous-composant partagé par les deux panneaux de calcul en direct ET (depuis
 * cette correction) par la colonne « Allergènes » de la fiche technique
 * (`COLONNES_LIGNES_REFERENCE`). Deux défauts corrigés ensemble :
 *  - un même tiret pour « jamais vérifié » et « vérifié, aucun allergène » ;
 *  - le CODE brut (`gluten`) affiché à la place du libellé réglementaire.
 *
 * CE QUE CES TESTS NE PROUVENT PAS : que `text-alerte` s'applique réellement
 * dans le DOM, ni que ce texte est bien rendu à l'écran par
 * `AllergenesRecalcules` — ce fichier ne monte pas l'écran, et jsdom
 * n'applique de toute façon aucune feuille de style. Ils prouvent seulement que le TEXTE choisi est le
 * bon, pour toute combinaison de `verifies` et de codes.
 */
describe('texteAllergenesRecalcules', () => {
  it('affiche « non vérifié », jamais un tiret, quand le drapeau est faux et la liste vide', () => {
    expect(texteAllergenesRecalcules(false, [])).toBe('non vérifié');
  });

  it('affiche « non vérifié » même si la liste porte déjà des codes : un contributeur non vérifié rend toute la liste incertaine', () => {
    expect(texteAllergenesRecalcules(false, ['gluten'])).toBe('non vérifié');
  });

  it('affiche « Aucun allergène déclaré », jamais un tiret, quand tout est vérifié et la liste est vide', () => {
    expect(texteAllergenesRecalcules(true, [])).toBe('Aucun allergène déclaré');
  });

  it('traduit chaque code en libellé réglementaire complet, jamais le code brut', () => {
    expect(texteAllergenesRecalcules(true, ['gluten', 'lait'])).toBe(
      'Céréales contenant du gluten · Lait (y compris lactose)',
    );
  });

  it('ne réduit jamais une famille à un seul de ses membres (fruits à coque en couvre huit)', () => {
    expect(texteAllergenesRecalcules(true, ['fruits-a-coque'])).toBe('Fruits à coque');
  });
});

const INGREDIENT_VERIFIE_SANS_ALLERGENE: IngredientComplet = {
  id: 'ing-sel',
  nom: 'Sel fin',
  categorie: 'aromate',
  uniteReference: 'g',
  densiteGParMl: null,
  allergenes: [],
  allergenesVerifies: true,
  stockSecurite: 0,
  delaiLivraisonJours: null,
  dureeConservationJours: null,
  notes: null,
  actif: true,
  nbConditionnements: 1,
  coutUnitaireCents: 1,
  nbLignesRecette: 1,
  nbLots: 0,
};

const INGREDIENT_NON_VERIFIE_GLUTEN: IngredientComplet = {
  ...INGREDIENT_VERIFIE_SANS_ALLERGENE,
  id: 'ing-farine',
  nom: 'Farine de froment T55',
  categorie: 'farine',
  allergenes: ['gluten'],
  allergenesVerifies: false,
};

const LIGNE_FARINE: LigneRecetteContrat = {
  ingredientId: 'ing-farine',
  nomIngredient: 'Farine de froment T55',
  unite: 'g',
  quantiteReference: 145,
  cumpCentsParUnite: 10,
  allergenes: ['gluten'],
  ordre: 0,
};

const LIGNE_SEL: LigneRecetteContrat = {
  ingredientId: 'ing-sel',
  nomIngredient: 'Sel fin',
  unite: 'g',
  quantiteReference: 2,
  cumpCentsParUnite: 1,
  allergenes: [],
  ordre: 1,
};

/**
 * `LigneRecetteContrat` (contrat HTTP de la recette enregistrée) ne porte pas
 * `allergenesVerifies` — cette information vit sur l'INGRÉDIENT. Ces tests
 * prouvent la jointure, PAS un rendu réel : même limite que les autres
 * fonctions pures de ce fichier (CLAUDE.md §7).
 */
describe('lignesReferenceAffichees', () => {
  const ingredients = [INGREDIENT_NON_VERIFIE_GLUTEN, INGREDIENT_VERIFIE_SANS_ALLERGENE];

  it('reporte allergenesVerifies=true pour une ligne dont l’ingrédient est vérifié', () => {
    const [ligne] = lignesReferenceAffichees([LIGNE_SEL], ingredients);
    expect(ligne?.allergenesVerifies).toBe(true);
  });

  it('reporte allergenesVerifies=false pour une ligne dont l’ingrédient n’est pas vérifié', () => {
    const [ligne] = lignesReferenceAffichees([LIGNE_FARINE], ingredients);
    expect(ligne?.allergenesVerifies).toBe(false);
  });

  it('compte NON vérifié un ingrédient introuvable localement, jamais l’inverse', () => {
    const [ligne] = lignesReferenceAffichees(
      [{ ...LIGNE_FARINE, ingredientId: 'inconnu' }],
      ingredients,
    );
    expect(ligne?.allergenesVerifies).toBe(false);
  });

  it('conserve les autres champs de la ligne intacts : aucun calcul, seulement une jointure', () => {
    const [ligne] = lignesReferenceAffichees([LIGNE_SEL], ingredients);
    expect(ligne).toMatchObject({
      ingredientId: 'ing-sel',
      nomIngredient: 'Sel fin',
      quantiteReference: 2,
    });
  });
});
