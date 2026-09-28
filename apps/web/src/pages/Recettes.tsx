import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CATALOGUE_ALLERGENES,
  ErreurMetier,
  GLYPHE_STATUT,
  LIBELLE_CATEGORIE_INGREDIENT,
  TIRET_ABSENT,
  champsDepuisErreurZod,
  comparerLignesRecette,
  formaterDate,
  formaterEuros,
  formaterMontant,
  formaterPointsDeBase,
  formaterQuantite,
  libelleAllergene,
  libelleUnite,
  mettreAEchelle,
  ouTiret,
  schemaCategorieIngredient,
  schemaIngredientComplet,
  schemaListeIngredientsComplets,
  schemaListeRecettes,
  schemaListeRecettesReferentiel,
  schemaRecetteDetail,
  schemaResultatCalcul,
  schemaResultatVersionRecette,
  schemaSaisieIngredient,
  schemaSaisieRecette,
  tousAllergenesVerifies,
  type CategorieIngredient,
  type ChampsEnErreur,
  type CibleCalcul,
  type DifferenceLigneRecette,
  type IngredientComplet,
  type LigneRecetteCalcul,
  type LigneRecetteContrat,
  type RecetteDetail,
  type RecetteReferentiel,
  type RecetteResume,
  type ResultatCalcul,
  type StatutRecette,
  type Unite,
} from '@batte/core';
import { BoutonDocument } from '../composants/BoutonDocument';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { champsEnErreurApresModification } from '../composants/formulaire';
import { MessageErreur } from '../composants/EncartErreur';
import { LigneFiche } from '../composants/affichage';
import { ChampTexte } from '../composants/champs-formulaire';
import { ErreurApi, requeteApi } from '../lib/api';
import { compteAccorde } from './pluriel';

/**
 * Ecran Recettes (docs/06 §5 « Recette »). Panneau gauche : la liste, puis la
 * fiche technique — désormais MODIFIABLE. Panneau droit : le calculateur
 * PERMANENT — pas de bouton « Calculer », le recalcul part de la saisie après
 * un court debounce.
 *
 * CE QUE CET ÉCRAN SAVAIT FAIRE, ET CE QU'IL SAIT FAIRE MAINTENANT. Jusqu'ici
 * une recette ne pouvait naître que du seed (docs/13 §4.7) : R2, la pâte
 * sarrasin-châtaigne sans gluten, était semée VIDE et en brouillon, et rien ne
 * permettait de la remplir. L'application proposait donc un produit sans gluten
 * dont elle ignorait le coût, les allergènes et le rendement — la colonne
 * « Coût/crêpe » de la liste affichait `—`, à vie.
 *
 * LE POINT DÉLICAT, ET IL EST COMPTABLE. D-005 : « une recette active est
 * immuable ; toute modification crée une nouvelle version ». La raison est que
 * `production.recette_id` désigne la version RÉELLEMENT utilisée : réécrire une
 * recette qui a servi réécrirait rétroactivement le coût matière de productions
 * passées, donc des pièces comptables.
 *
 * Le critère qui tranche n'est PAS le statut, c'est le NOMBRE DE PRODUCTIONS —
 * une recette que personne n'a jamais produite n'a aucun passé à protéger. Cet
 * écran affiche donc deux boutons NOMMÉS quand les deux gestes sont possibles,
 * exactement comme l'écran Paramètres (D-042), et n'offre plus que le
 * versionnage dès que la recette est scellée. Personne ne doit pouvoir réécrire
 * une pièce comptable en croyant corriger une coquille.
 *
 * Règle d'architecture n°1 (CLAUDE.md §3) : ce composant n'effectue AUCUN
 * calcul métier. Chaque quantité, chaque coût affiché vient soit tel quel de
 * l'API, soit d'un formateur pur de `@batte/core`. La seule arithmétique
 * présente convertit une chaîne saisie en entier — du parsing, jamais un calcul
 * sur une donnée métier.
 */

type LigneCalculee = ResultatCalcul['lignes'][number];

type EtatListeRecettes =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | {
      statut: 'pret';
      recettes: RecetteResume[];
      /** Ce qui scelle chaque recette : son nombre de productions (D-005). */
      referentiel: RecetteReferentiel[];
      /**
       * Fiches COMPLETES (`GET /referentiel/ingredients`), pas le sous-ensemble
       * de `GET /api/ingredients` : le coût unitaire (`coutUnitaireCents`) est
       * nécessaire à la prévisualisation de coût EN DIRECT pendant la saisie
       * (voir `previsualisation` plus bas), et lui seul le porte.
       */
      ingredients: IngredientComplet[];
    };

type EtatDetailRecette =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; recette: RecetteDetail };

type EtatCalcul =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; resultat: ResultatCalcul };

/**
 * État du panneau de comparaison de versions (fiche 04). `inactif` : le
 * panneau est replié, ou aucune des deux versions n'est encore choisie.
 */
type EtatComparaison =
  | { statut: 'inactif' }
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; avant: RecetteDetail; apres: RecetteDetail };

type TypeCible = 'crepes' | 'volume' | 'ingredient';

/**
 * Ce que la fiche est en train de faire.
 *
 * `intention` n'est pas un détail d'implémentation : c'est la décision métier
 * de D-005, portée jusqu'au bouton. Elle choisit entre `PATCH /recettes/:id`
 * (réécrit en place) et `POST /recettes/:id/versions` (ajoute une version et
 * archive la précédente).
 */
type ModeFiche =
  | { mode: 'consultation' }
  | { mode: 'creation' }
  | { mode: 'edition'; intention: 'modification' | 'version' };

type LigneBrouillon = {
  /** Clé React stable : `ingredientId` vaut `''` sur une ligne qu'on vient d'ajouter. */
  cle: string;
  ingredientId: string;
  quantite: string;
  noteTechnique: string;
};

type BrouillonRecette = {
  code: string;
  nom: string;
  typePate: string;
  sansGluten: boolean;
  rendementReferenceMl: string;
  rendementReferenceCrepes: string;
  perteCuissonBp: string;
  tauxCasseBp: string;
  perteFixeMl: string;
  procede: string;
  notes: string;
  lignes: LigneBrouillon[];
};

export const BROUILLON_VIDE: BrouillonRecette = {
  code: '',
  nom: '',
  typePate: '',
  sansGluten: false,
  rendementReferenceMl: '',
  rendementReferenceCrepes: '',
  // `perteCuissonBp` et `tauxCasseBp` DOIVENT rester '0' par défaut, et ne
  // sont PAS traités comme « Fournée de référence » / « Crêpes obtenues »
  // ci-dessus (audit 30/07/2026, recette clavier) : un taux de casse ou une
  // perte de cuisson à 0 % est une hypothèse discutable (la doctrine du
  // projet veut `null` pour une valeur inconnue, jamais 0), mais NI le
  // schéma (`schemaSaisieRecetteBrute.perteCuissonBp`/`tauxCasseBp`,
  // `packages/core/src/contrats/referentiel.ts` — `z.int()` obligatoire,
  // sans `.nullish()`) NI la colonne SQLite (`perte_cuisson_bp`/
  // `taux_casse_bp`, `packages/db/src/schema.ts` — `NOT NULL DEFAULT 0`) ne
  // savent exprimer « non renseigné » pour ces deux champs. Accepter `null`
  // ici sans changer les deux exigerait une migration, hors périmètre de ce
  // lot (« pas de migration cette nuit ») : ces deux champs restent donc
  // volontairement à '0', valeur RÉELLE au sens strict — c'est ce que la
  // recette produira si personne ne la corrige, jamais un silence déguisé.
  perteCuissonBp: '0',
  tauxCasseBp: '0',
  // `perteFixeMl`, en revanche, PEUT commencer vide : son schéma
  // (`champEntierFacultatif(...).transform((valeur) => valeur ?? 0)`) accepte
  // déjà `null`/absent et les convertit en 0 à l'écriture — la colonne reste
  // `NOT NULL DEFAULT 0`, mais rien n'exige de lui envoyer 0 explicitement.
  // Vide affiche donc honnêtement « pas encore renseigné », sans changer ce
  // qui sera réellement enregistré si le champ reste intact.
  perteFixeMl: '',
  procede: '',
  notes: '',
  lignes: [],
};

/**
 * Fiche 09, la partie qui vit ici : « si l'ingrédient recherché n'existe pas,
 * proposer sa création à la volée ». Une valeur d'option réservée, jamais un
 * identifiant réel (les identifiants sont des UUID) : la choisir dans le
 * `<select>` d'une ligne ouvre le mini-formulaire de création ci-dessous
 * plutôt que d'assigner cette chaîne comme `ingredientId`.
 */
const OPTION_CREER_INGREDIENT = '__creer-ingredient__';

/** Brouillon du mini-formulaire de création d'ingrédient « à la volée » (fiche 09). */
type BrouillonIngredientRapide = {
  nom: string;
  categorie: CategorieIngredient;
  uniteReference: Unite;
  densite: string;
  allergenes: string[];
};

const INGREDIENT_RAPIDE_VIDE: BrouillonIngredientRapide = {
  nom: '',
  categorie: 'farine',
  uniteReference: 'g',
  densite: '',
  allergenes: [],
};

/** État du mini-formulaire de création, ou `null` si aucune ligne n'en a ouvert un. */
type EtatCreationIngredient = {
  /** Index de la ligne de `brouillon.lignes` qui a déclenché la création. */
  ligneIndex: number;
  brouillon: BrouillonIngredientRapide;
  champsEnErreur: ChampsEnErreur;
  erreur: string | null;
  envoi: boolean;
};

/**
 * Ce que le panneau « coût recalculé en direct » a à montrer, PENDANT la
 * saisie — avant tout enregistrement (fiche 04, module 1). `indisponible`
 * n'est pas une erreur mais un état normal de saisie incomplète (recette
 * vide, ligne en cours de complétion, rendement pas encore renseigné) : le
 * message le dit en clair plutôt que d'afficher un chiffre invraisemblable.
 */
type PrevisualisationEdition =
  | { statut: 'indisponible'; message: string }
  | {
      statut: 'pret';
      /**
       * `null` dès qu'un ingrédient de la recette n'a pas encore de prix —
       * audit 29/07/2026, défaut n°1 : « un ingrédient sans prix est compté
       * gratuit, pas inconnu ». Jamais `0,00 €` dans ce cas : voir
       * `ingredientsSansPrix`, qui nomme le ou les ingrédients en cause.
       */
      coutMatiereCents: number | null;
      coutParCrepeCents: number | null;
      /** Noms des ingrédients de la recette sans conditionnement actif (prix inconnu). */
      ingredientsSansPrix: readonly string[];
      allergenes: readonly string[];
      /**
       * Vrai seulement si TOUS les ingrédients de la recette ont leurs
       * allergènes vérifiés (`tousAllergenesVerifies`, `@batte/core`). Tant
       * que c'est faux, `allergenes` ci-dessus ne dit rien de sûr : une liste
       * vide ne veut pas dire « aucun allergène », elle veut dire « pas
       * encore vérifié » (audit du 31/07/2026, docs/30-AUDIT-ALLERGENES.md
       * §2.2 — le tiret qui masquait cette distinction).
       */
      allergenesVerifies: boolean;
    };

const DELAI_DEBOUNCE_MS = 250;

const CLASSE_BOUTON_PRIMAIRE =
  'h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:bg-ink-4';
const CLASSE_BOUTON_SECONDAIRE =
  'h-controle rounded-sm border border-line-field bg-surface px-3 text-sm font-medium text-ink-2 hover:bg-surface-sunken';

/** Compteur de clés de lignes : `crypto.randomUUID` n'est pas nécessaire ici. */
let compteurLignes = 0;
function nouvelleCleLigne(): string {
  compteurLignes += 1;
  return `ligne-${compteurLignes}`;
}

function libelleStatutRecette(statut: StatutRecette): string {
  switch (statut) {
    case 'brouillon':
      return 'Brouillon';
    case 'active':
      return 'Active';
    case 'archivee':
      return 'Archivée';
  }
}

/**
 * Vocabulaire de statut UNIFIÉ avec le reste de l'application (recette au
 * navigateur du 31/07/2026 : Sessions et Fournisseurs employaient déjà
 * glyphe + couleur, cette colonne rendait le même concept en texte nu, sans
 * signal visuel — même famille de défaut que `statutFournisseur`,
 * `Fournisseurs.tsx`). Toujours doublé d'un mot, jamais la couleur seule
 * (daltonisme, export PDF noir et blanc) : `libelleStatutRecette` fournit ce
 * mot, réutilisé tel quel dans les phrases de l'écran (comparaison de
 * versions, confirmations).
 *
 * `archivee` reste NEUTRE (pas de glyphe) : c'est une fin de vie normale,
 * pas une alerte — même traitement que « Inactif » dans `statutFournisseur`.
 * `brouillon` porte l'alerte : « Seule une recette active peut être
 * produite » (voir le panneau des gestes ci-dessous), donc une recette non
 * activée est un ÉTAT QUI ATTEND UNE DÉCISION, pas une simple étape neutre.
 */
export function statutAffichageRecette(statut: StatutRecette): { texte: string; classe: string } {
  const libelle = libelleStatutRecette(statut);
  switch (statut) {
    case 'brouillon':
      return { texte: `${GLYPHE_STATUT.alerte} ${libelle}`, classe: 'text-alerte' };
    case 'active':
      return { texte: `${GLYPHE_STATUT.conforme} ${libelle}`, classe: 'text-conforme' };
    case 'archivee':
      return { texte: libelle, classe: 'text-ink-3' };
  }
}

/**
 * Bouton à focaliser une fois le statut d'une recette changé (recette
 * clavier du 31/07/2026 : « Activer »/« Archiver » faisaient retomber le
 * focus sur `<body>`, en démontant tout le panneau « Fiche technique » —
 * D-079, `docs/22-FOCUS-DETRUIT.md` §2.3).
 *
 * LE GESTE : « Activer » et « Archiver » sont deux boutons MUTUELLEMENT
 * EXCLUSIFS au même endroit de la fiche (`recetteActive.statut !== 'active'`
 * / `=== 'active'`, plus bas) : cliquer l'un fait disparaître SON bouton et
 * apparaître l'AUTRE à sa place visuelle — jamais les deux en même temps, et
 * jamais aucun des deux à la fois qu'une recette existe. La cible naturelle
 * après le changement est donc le bouton qui vient de prendre cette place,
 * jamais celui qu'on vient de cliquer (il n'existe plus).
 */
export function cibleFocusApresChangementStatutRecette(
  statutApres: StatutRecette,
): 'activer' | 'archiver' {
  return statutApres === 'active' ? 'archiver' : 'activer';
}

/**
 * Numéro de la version à créer, pour le titre du panneau « Nouvelle version ».
 *
 * `ouvrirEdition` (plus bas) garde toujours contre `recetteActive === null`
 * avant de passer en mode `version` : ce panneau ne s'ouvre donc jamais sans
 * recette active. Un `?? 0` masquait cette invariance — un `recetteActive`
 * `null` aurait affiché « v1 », un vrai numéro de version, là où la bonne
 * réponse est « on ne sait pas quelle version créer ».
 */
export function libelleNouvelleVersion(recetteActive: RecetteDetail | null): string {
  return recetteActive === null ? TIRET_ABSENT : String(recetteActive.version + 1);
}

/**
 * Phrase annonçant, AVANT le clic sur « Créer la version N+1 », combien de
 * produits de vente resteront accrochés à la version actuellement ouverte une
 * fois la nouvelle créée.
 *
 * `nbProduits` (`schemaRecetteReferentiel`, `packages/core/src/contrats/
 * referentiel.ts`) était calculé, testé, servi par `GET /referentiel/
 * recettes` et jamais lu par cet écran (audit du 30/07/2026, docs/21 §1.7) —
 * seul le compteur voisin `nbProductions` (qui scelle la recette) l'était.
 * Le commentaire du contrat est explicite : « le nombre de produits qui vont
 * rester accrochés à l'ancienne doit être annoncé avant, pas après ».
 * `produit_vente.recette_id` pointe une VERSION précise ; créer une version
 * n'y touche jamais — sans cette phrase, le porteur ne découvre le nombre
 * concerné qu'APRÈS avoir versionné, trop tard pour décider de repointer les
 * produits d'abord depuis l'écran Produits.
 *
 * Fonction PURE et exportée : son test prouve le choix de phrase selon le
 * compte, pas son rendu réel dans le DOM (celui-ci relève de
 * `Recettes.montage.test.tsx`).
 */
export function phraseProduitsSurVersion(nbProduits: number): string {
  if (nbProduits === 0) {
    return 'Aucun produit de vente n’est rattaché à cette version : en créer une nouvelle n’en affecte aucun.';
  }
  if (nbProduits === 1) {
    return (
      '1 produit de vente est rattaché à cette version et y restera : créer une nouvelle ' +
      'version ne le repointe pas automatiquement (à faire depuis l’écran Produits si besoin).'
    );
  }
  return (
    `${nbProduits} produits de vente sont rattachés à cette version et y resteront : créer une ` +
    'nouvelle version ne les repointe pas automatiquement (à faire depuis l’écran Produits si besoin).'
  );
}

/**
 * Nom du champ à focaliser après l'ajout d'une ligne d'ingrédient — la
 * décision PURE derrière l'effet de focus qui suit `ajouterLigne` plus bas.
 *
 * DÉFAUT MESURÉ (recette clavier du 30/07/2026), reproduit deux fois : après
 * un clic sur « Ajouter un ingrédient », le focus restait sur CE bouton, et
 * le `Tab` suivant sautait entièrement la ligne qu'on venait de créer pour
 * atterrir sur « Procédé » — la ligne neuve est ajoutée AVANT le bouton dans
 * le DOM, donc `Tab` depuis le bouton ne peut de toute façon jamais y
 * revenir. Il fallait 4 `Shift+Tab` pour rattraper la première ligne, 5 pour
 * la deuxième : un coût qui grandit avec la recette, sur exactement la
 * saisie répétitive que CLAUDE.md §3 règle 10 veut fluide au clavier.
 *
 * LE MÊME MÉCANISME QUE `Factures.tsx` (`cleLigneAFocaliserRef` + un effet
 * déclenché par le nouveau rendu des lignes), PAS UN TROISIÈME : une ref
 * retient la clé de la ligne qui vient de naître, et l'effet la cherche une
 * fois le rendu fait. Repris ici plutôt que le mécanisme à ÉTAT
 * (`cleAFocaliser` de `saisie-stock/SaisieReception.tsx`) — il y a déjà
 * quatre façons de faire la même chose dans ce dépôt, un cinquième n'aurait
 * aidé personne.
 *
 * Fonction PURE et exportée pour rester testable sans rendre l'écran : elle
 * prouve que le NOM DE CHAMP visé est le bon compte tenu de la position de la
 * ligne — elle NE PROUVE PAS que le focus arrive réellement dans le
 * navigateur, même limite que `cleAFocaliserApresRetrait`
 * (`saisie-stock/SaisieReception.tsx`).
 */
export function champAFocaliserApresAjoutLigne(
  cleNouvelleLigne: string,
  lignes: readonly LigneBrouillon[],
): string | null {
  const index = lignes.findIndex((ligne) => ligne.cle === cleNouvelleLigne);
  return index === -1 ? null : `lignes.${index}.ingredientId`;
}

/**
 * Lit le champ « valeur » du calculateur. Aucun schema Zod partage n'existe
 * pour un entier de saisie simple (contrairement a `parserEuros` pour un
 * montant) : la conversion reste donc locale a cet ecran, mais elle ne fait
 * que parser une chaine, jamais un calcul sur une donnee metier.
 */
function parserEntierPositif(saisie: string): number | null {
  const nettoyee = saisie.trim();
  if (!/^\d+$/.test(nettoyee)) return null;
  const valeur = Number.parseInt(nettoyee, 10);
  return valeur > 0 ? valeur : null;
}

/**
 * Lit un champ numérique du formulaire. `''` vaut ABSENT ; toute autre saisie
 * est rendue telle quelle, `NaN` compris, pour que le schéma Zod partagé
 * produise le message exact sous le bon champ plutôt qu'un silence.
 */
function nombreSaisi(saisie: string): number | null {
  const nettoye = saisie.trim().replace(',', '.');
  if (nettoye === '') return null;
  return Number(nettoye);
}

/**
 * Message d'erreur en ligne (docs/07 §4.7 : « pas "Quantité invalide" mais
 * "La quantité doit être un nombre entier de crêpes" »).
 */
function messageErreurValeur(cible: TypeCible): string {
  switch (cible) {
    case 'crepes':
      return 'Le nombre de crêpes doit être un nombre entier positif.';
    case 'volume':
      return 'Le volume doit être un nombre entier positif, en millilitres.';
    case 'ingredient':
      return "La quantité doit être un nombre entier positif, dans l'unité de l'ingrédient.";
  }
}

function libelleChampValeur(
  cible: TypeCible,
  recette: RecetteDetail,
  ingredientId: string | null,
): string {
  switch (cible) {
    case 'crepes':
      return 'Nombre de crêpes vendables visé';
    case 'volume':
      return 'Volume de pâte visé (ml)';
    case 'ingredient': {
      const ligne = recette.lignes.find((l) => l.ingredientId === ingredientId);
      return ligne === undefined
        ? 'Quantité disponible'
        : `Quantité disponible (${libelleUnite(ligne.unite)})`;
    }
  }
}

/**
 * Message d'un coût matière INCONNU (audit 29/07/2026, défaut n°1) : jamais
 * « 0,00 € », toujours le ou les ingrédients qui n'ont pas encore de prix —
 * exactement ce qui arrive juste après une création rapide d'ingrédient
 * (fiche 09), avant le passage par l'écran Ingrédients pour lui donner un
 * conditionnement.
 */
function messageCoutInconnu(nomsIngredients: readonly string[]): string {
  return nomsIngredients.length <= 1
    ? `Coût inconnu : prix manquant sur « ${nomsIngredients[0] ?? '?'} ».`
    : `Coût inconnu : prix manquant sur ${nomsIngredients.length} ingrédients (${nomsIngredients.join(', ')}).`;
}

/**
 * L'outil « calculer » (~2624-2669) ne connaît ses lignes que via l'API
 * (`POST /recettes/:id/calculer` → `schemaResultatCalcul`), qui ne porte pas
 * `allergenesVerifies` : ce contrat sert aussi d'autres appelants qui n'ont
 * jamais eu besoin de cette information. On rejoint donc chaque ligne à
 * l'ingrédient déjà chargé localement — le même référentiel que le panneau
 * de prévisualisation utilise (`ingredients`, `GET /referentiel/ingredients`)
 * — pour retrouver son statut de vérification, puis on applique la MÊME
 * règle agrégée que `mettreAEchelle` (`tousAllergenesVerifies`, @batte/core) :
 * un seul point de vérité pour la règle, deux appelants (ici et
 * `mettreAEchelle`), jamais deux écritures de la même décision.
 *
 * Un ingrédient introuvable localement (jamais censé arriver : la ligne
 * vient forcément d'un ingrédient existant) compte comme NON vérifié, par
 * prudence — jamais l'inverse.
 */
function allergenesVerifiesDuCalcul(
  lignes: readonly { readonly ingredientId: string }[],
  ingredients: readonly IngredientComplet[],
): boolean {
  return tousAllergenesVerifies(
    lignes.map((ligne) => {
      const ingredient = ingredients.find((i) => i.id === ligne.ingredientId);
      // `exactOptionalPropertyTypes` : on OMET la clé plutôt que d'y écrire
      // `undefined` explicitement — un ingrédient introuvable localement
      // (jamais censé arriver) compte alors comme non vérifié, par le même
      // repli que `tousAllergenesVerifies` applique déjà à une clé absente.
      return ingredient === undefined ? {} : { allergenesVerifies: ingredient.allergenesVerifies };
    }),
  );
}

/**
 * Formate un compte entier de crêpes. Ni `formaterQuantite` (qui suppose une
 * unite g/ml/pièce et accorde le mot « pièce(s) ») ni `formaterEuros` ne
 * conviennent a un simple compte de crêpes : ce regroupement de milliers reste
 * local, et ne fait — encore une fois — aucun calcul, seulement une mise en
 * forme d'un nombre deja fourni par l'API.
 */
function formaterCrepes(valeur: number): string {
  const nombre = new Intl.NumberFormat('fr-BE').format(valeur);
  // Accord au singulier a 0 et 1, comme le fait deja `formaterQuantite` pour
  // l'unite `piece` dans packages/core/src/unites.ts.
  return `${nombre} ${Math.abs(valeur) <= 1 ? 'crêpe' : 'crêpes'}`;
}

/**
 * QUATRE colonnes, et « Coût/crêpe » a pris la place de « Sans gluten ».
 *
 * Ce n'est pas un arbitrage esthétique : la colonne de coût est celle qui dit
 * si une recette est CHIFFRABLE. Un `—` y signifie soit une recette vide, soit
 * un ingrédient sans conditionnement actif — c'est-à-dire sans prix. C'était
 * l'état permanent de R2, et c'est exactement ce que ce lot répare, donc c'est
 * ce que la liste doit montrer. « Sans gluten » reste lisible dans la fiche,
 * où il n'est jamais tronqué.
 */
const COLONNES_LISTE: ReadonlyArray<ColonneTableau<RecetteResume>> = [
  {
    cle: 'code',
    libelle: 'Code',
    // 18 % : l'en-tête (toujours tronquée par ellipse, jamais par repli — voir
    // `Tableau.tsx`) a besoin de sa propre largeur, indépendamment du `repli`
    // posé sur la cellule. Mesuré à 1280 px (docs/07 §4.4) : 15 % coupait
    // « CODE » en « CO… ».
    largeur: '17%',
    alignement: 'texte',
    // Le code EST l'identifiant fonctionnel de la lignée : deux versions ne se
    // distinguent que par lui et par le numéro. Un code tronqué ne s'oppose
    // plus à rien.
    troncature: 'repli',
    rendu: (r) => (
      <span className="font-mono text-xs">
        {r.code} v{r.version}
      </span>
    ),
  },
  {
    cle: 'nom',
    libelle: 'Nom',
    largeur: '30%',
    alignement: 'texte',
    // Mesuré : « Pâte à crêpes sarrasin-châtaigne (sans gluten) » débordait, et
    // c'est le suffixe « (sans gluten) » qui sautait — précisément ce qui
    // distingue une recette de son homonyme.
    troncature: 'repli',
    rendu: (r) => r.nom,
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    // 22 % : « Brouillon » (le plus long des trois statuts) se coupait en
    // « Brouill… » à 20 % — mesuré à 1280 px.
    largeur: '22%',
    alignement: 'texte',
    rendu: (r) => {
      const statut = statutAffichageRecette(r.statut);
      return <span className={statut.classe}>{statut.texte}</span>;
    },
    titre: (r) => libelleStatutRecette(r.statut),
  },
  {
    cle: 'cout',
    libelle: 'Coût/crêpe (€)',
    largeur: '31%',
    alignement: 'nombre',
    // `null` et non `0,00 €` sur une recette vide : un chiffre faux présenté
    // comme une donnée est pire qu'une absence assumée.
    // `formaterMontant`, pas `formaterEuros` : l'unité va dans l'en-tête, pas
    // répétée sur chaque ligne (docs/07 §4.5) — voir Stock.tsx / Objectifs.tsx.
    rendu: (r) => ouTiret(r.coutParCrepeCents, (c) => formaterMontant(Math.round(c))),
  },
];

/**
 * `LigneRecetteContrat` (contrat HTTP de la recette enregistrée,
 * `packages/core/src/contrats/recettes.ts`) ne porte PAS
 * `allergenesVerifies` — cette information vit sur l'INGRÉDIENT
 * (`IngredientComplet`, `allergenesVerifies`), pas sur la ligne de recette.
 * On la rejoint donc ici, à l'affichage, plutôt que d'attendre l'ajout d'un
 * champ qui traverserait trois couches hors du périmètre de cette correction
 * (schéma HTTP, dépôt Drizzle, route) — voir `lignesReferenceAffichees`
 * ci-dessous.
 */
export type LigneReferenceAffichee = LigneRecetteContrat & {
  readonly allergenesVerifies: boolean;
};

/**
 * Enrichit chaque ligne de la fiche technique (`COLONNES_LIGNES_REFERENCE`)
 * du statut de vérification allergènes de son ingrédient, par jointure sur
 * `ingredients` (`GET /referentiel/ingredients`, déjà chargé par cet écran).
 *
 * Même repli que `allergenesVerifiesDuCalcul` ci-dessus : un ingrédient
 * introuvable localement (jamais censé arriver, l'identifiant vient
 * forcément d'un ingrédient existant) compte comme NON vérifié, jamais
 * l'inverse.
 */
export function lignesReferenceAffichees(
  lignes: readonly LigneRecetteContrat[],
  ingredients: readonly IngredientComplet[],
): LigneReferenceAffichee[] {
  return lignes.map((ligne) => ({
    ...ligne,
    allergenesVerifies:
      ingredients.find((i) => i.id === ligne.ingredientId)?.allergenesVerifies ?? false,
  }));
}

const COLONNES_LIGNES_REFERENCE: ReadonlyArray<ColonneTableau<LigneReferenceAffichee>> = [
  {
    cle: 'ingredient',
    libelle: 'Ingrédient',
    largeur: '45%',
    alignement: 'texte',
    rendu: (l) => l.nomIngredient,
    titre: (l) => l.nomIngredient,
  },
  {
    cle: 'quantite',
    libelle: 'Référence',
    largeur: '25%',
    alignement: 'nombre',
    rendu: (l) => formaterQuantite(l.quantiteReference, l.unite),
  },
  {
    cle: 'allergenes',
    libelle: 'Allergènes',
    largeur: '30%',
    alignement: 'texte',
    // Liste non bornée (« Céréales contenant du gluten · Œufs · Lait (y
    // compris lactose) ») ET information de sécurité alimentaire : un
    // allergène coupé par la fin est un allergène qu'on ne déclare pas.
    // `repli` plutôt qu'un `titre` — l'infobulle native n'est pas exposée au
    // clavier (CLAUDE.md §3 règle 10).
    //
    // `AllergenesRecalcules` (même sous-composant que les deux panneaux de
    // calcul en direct plus bas) : avant cette correction, cette colonne
    // affichait `l.allergenes.join(' · ')`, c'est-à-dire le CODE brut
    // (`gluten`) plutôt que le libellé réglementaire, et un même tiret pour
    // « jamais vérifié » et « vérifié, aucun allergène » (audit du
    // 31/07/2026, docs/30-AUDIT-ALLERGENES.md §2.2). Réutiliser le
    // sous-composant évite un troisième jeu de mots sur la même information.
    troncature: 'repli',
    rendu: (l) => (
      <AllergenesRecalcules verifies={l.allergenesVerifies} allergenes={l.allergenes} />
    ),
  },
];

const COLONNES_CALCUL: ReadonlyArray<ColonneTableau<LigneCalculee>> = [
  {
    cle: 'ingredient',
    // Élargie de 40 à 50 % : la place gagnée en sortant l'unité « € » des
    // cellules de coût (ci-dessous) revient au nom d'ingrédient, celui qui en
    // avait le plus besoin (« Farine de frome… », « Eau de fleur d'or… »
    // mesurés tronqués à 1280 px).
    libelle: 'Ingrédient',
    largeur: '50%',
    alignement: 'texte',
    rendu: (l) => l.nomIngredient,
    titre: (l) => l.nomIngredient,
  },
  {
    cle: 'quantite',
    libelle: 'Quantité',
    largeur: '25%',
    alignement: 'nombre',
    rendu: (l) => formaterQuantite(l.quantite, l.unite),
  },
  {
    cle: 'cout',
    libelle: 'Coût (€)',
    largeur: '25%',
    alignement: 'nombre',
    // `null` quand `cumpCentsParUnite` est `null` : prix INCONNU, jamais
    // gratuit (audit 29/07/2026, défaut n°1) — un tiret, pas « 0,00 € ».
    // `formaterMontant`, pas `formaterEuros` : l'unité va dans l'en-tête, pas
    // répétée sur chaque ligne (docs/07 §4.5, mission du 31/07/2026 —
    // « 0,11 € », « 0,28 € » mangeaient la largeur de cette colonne ET
    // cassaient l'alignement décimal du symbole).
    rendu: (l) => ouTiret(l.coutCents, formaterMontant),
  },
];

/**
 * Une ligne de la comparaison de versions (fiche 04), aplatie pour `Tableau`.
 * `null` sur `quantiteAvant`/`quantiteApres` : une ligne ajoutée n'existait pas
 * « avant », une ligne retirée n'existe plus « après » — un `0` y ferait
 * croire à une quantité réelle plutôt qu'à une absence.
 */
type LigneComparaisonAffichee = {
  cle: string;
  nomIngredient: string;
  unite: Unite;
  evolution: DifferenceLigneRecette['evolution'];
  quantiteAvant: number | null;
  quantiteApres: number | null;
};

function libelleEvolution(evolution: DifferenceLigneRecette['evolution']): string {
  switch (evolution) {
    case 'ajoutee':
      return 'Ajouté';
    case 'retiree':
      return 'Retiré';
    case 'quantite-modifiee':
      return 'Quantité modifiée';
    case 'inchangee':
      return 'Inchangé';
  }
}

/** Couleur de jeton EXISTANTE (index.css), jamais une couleur Tailwind brute. */
function classeEvolution(evolution: DifferenceLigneRecette['evolution']): string {
  switch (evolution) {
    case 'ajoutee':
      return 'text-conforme';
    case 'retiree':
      return 'text-depassement';
    case 'quantite-modifiee':
      return 'text-alerte';
    case 'inchangee':
      return 'text-ink-3';
  }
}

const COLONNES_COMPARAISON: ReadonlyArray<ColonneTableau<LigneComparaisonAffichee>> = [
  {
    cle: 'ingredient',
    libelle: 'Ingrédient',
    largeur: '34%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) => l.nomIngredient,
  },
  {
    cle: 'avant',
    libelle: 'Avant',
    largeur: '20%',
    alignement: 'nombre',
    rendu: (l) =>
      l.quantiteAvant === null ? TIRET_ABSENT : formaterQuantite(l.quantiteAvant, l.unite),
  },
  {
    cle: 'apres',
    libelle: 'Après',
    largeur: '20%',
    alignement: 'nombre',
    rendu: (l) =>
      l.quantiteApres === null ? TIRET_ABSENT : formaterQuantite(l.quantiteApres, l.unite),
  },
  {
    cle: 'evolution',
    libelle: 'Évolution',
    largeur: '26%',
    alignement: 'texte',
    rendu: (l) => (
      <span className={classeEvolution(l.evolution)}>{libelleEvolution(l.evolution)}</span>
    ),
  },
];

/** Aplatit le résultat de `comparerLignesRecette` (core) pour `Tableau`. */
function lignesComparaisonAffichees(
  differences: readonly DifferenceLigneRecette[],
): LigneComparaisonAffichee[] {
  return differences
    .map((d): LigneComparaisonAffichee => {
      switch (d.evolution) {
        case 'ajoutee':
          return {
            cle: d.ligne.ingredientId,
            nomIngredient: d.ligne.nomIngredient,
            unite: d.ligne.unite,
            evolution: d.evolution,
            quantiteAvant: null,
            quantiteApres: d.ligne.quantiteReference,
          };
        case 'retiree':
          return {
            cle: d.ligne.ingredientId,
            nomIngredient: d.ligne.nomIngredient,
            unite: d.ligne.unite,
            evolution: d.evolution,
            quantiteAvant: d.ligne.quantiteReference,
            quantiteApres: null,
          };
        case 'quantite-modifiee':
          return {
            cle: d.ingredientId,
            nomIngredient: d.nomIngredient,
            unite: d.unite,
            evolution: d.evolution,
            quantiteAvant: d.quantiteAvant,
            quantiteApres: d.quantiteApres,
          };
        case 'inchangee':
          return {
            cle: d.ligne.ingredientId,
            nomIngredient: d.ligne.nomIngredient,
            unite: d.ligne.unite,
            evolution: d.evolution,
            quantiteAvant: d.ligne.quantiteReference,
            quantiteApres: d.ligne.quantiteReference,
          };
      }
    })
    .sort((a, b) => a.nomIngredient.localeCompare(b.nomIngredient, 'fr'));
}

/**
 * Champs d'en-tête qui DIFFÈRENT entre deux versions — pas les 8 champs
 * systématiquement : une liste qui ne montre que ce qui a changé se lit sans
 * deviner (fiche 04 : « voir ce qui a changé […] sans devoir deviner »).
 */
function differencesEntete(
  avant: RecetteDetail,
  apres: RecetteDetail,
): Array<{ libelle: string; avant: string; apres: string }> {
  const champs: Array<{ libelle: string; avant: string; apres: string }> = [];
  const ajouter = (libelle: string, valeurAvant: string, valeurApres: string): void => {
    if (valeurAvant !== valeurApres)
      champs.push({ libelle, avant: valeurAvant, apres: valeurApres });
  };

  ajouter('Type de pâte', avant.typePate, apres.typePate);
  ajouter('Sans gluten', avant.sansGluten ? 'Oui' : 'Non', apres.sansGluten ? 'Oui' : 'Non');
  ajouter(
    'Fournée de référence',
    formaterQuantite(avant.rendementReferenceMl, 'ml'),
    formaterQuantite(apres.rendementReferenceMl, 'ml'),
  );
  ajouter(
    'Crêpes obtenues',
    formaterCrepes(avant.rendementReferenceCrepes),
    formaterCrepes(apres.rendementReferenceCrepes),
  );
  ajouter(
    'Perte de cuisson',
    formaterPointsDeBase(avant.perteCuissonBp),
    formaterPointsDeBase(apres.perteCuissonBp),
  );
  ajouter(
    'Taux de casse',
    formaterPointsDeBase(avant.tauxCasseBp),
    formaterPointsDeBase(apres.tauxCasseBp),
  );
  ajouter(
    'Perte fixe',
    formaterQuantite(avant.perteFixeMl, 'ml'),
    formaterQuantite(apres.perteFixeMl, 'ml'),
  );
  ajouter(
    'Coût par crêpe',
    avant.coutParCrepeCents === null
      ? TIRET_ABSENT
      : formaterEuros(Math.round(avant.coutParCrepeCents)),
    apres.coutParCrepeCents === null
      ? TIRET_ABSENT
      : formaterEuros(Math.round(apres.coutParCrepeCents)),
  );

  return champs;
}

export default function Recettes() {
  const [etatListe, setEtatListe] = useState<EtatListeRecettes>({ statut: 'chargement' });
  const [recetteSelectionneeId, setRecetteSelectionneeId] = useState<string | null>(null);
  const [etatDetail, setEtatDetail] = useState<EtatDetailRecette | null>(null);
  const [calculateur, setCalculateur] = useState<{
    typeCible: TypeCible;
    valeurSaisie: string;
    ingredientId: string | null;
  }>({ typeCible: 'volume', valeurSaisie: '', ingredientId: null });
  const [erreurValeur, setErreurValeur] = useState<string | null>(null);
  const [etatCalcul, setEtatCalcul] = useState<EtatCalcul | null>(null);

  const [modeFiche, setModeFiche] = useState<ModeFiche>({ mode: 'consultation' });
  const [brouillon, setBrouillon] = useState<BrouillonRecette>(BROUILLON_VIDE);
  const [champsEnErreur, setChampsEnErreur] = useState<ChampsEnErreur>({});
  const [erreurFormulaire, setErreurFormulaire] = useState<string | null>(null);
  const [messageSucces, setMessageSucces] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<'inactif' | 'envoi'>('inactif');
  /**
   * Incrémenté après chaque écriture pour forcer le rechargement de la fiche.
   * Sans lui, un `PATCH` qui ne change pas l'identifiant sélectionné laisserait
   * la fiche — et le calculateur — sur les valeurs d'avant.
   */
  const [rechargement, setRechargement] = useState(0);

  /** Mini-formulaire de création d'ingrédient « à la volée », ouvert depuis une ligne (fiche 09). */
  const [creationIngredient, setCreationIngredient] = useState<EtatCreationIngredient | null>(null);

  /** Comparaison de versions (fiche 04) : panneau replié par défaut. */
  const [comparaisonOuverte, setComparaisonOuverte] = useState(false);
  const [comparaisonAvantId, setComparaisonAvantId] = useState<string | null>(null);
  const [comparaisonApresId, setComparaisonApresId] = useState<string | null>(null);
  const [etatComparaison, setEtatComparaison] = useState<EtatComparaison>({ statut: 'inactif' });

  const formulaireRef = useRef<HTMLFormElement>(null);
  const boutonAjouterLigne = useRef<HTMLButtonElement>(null);
  /**
   * Clé de la ligne à focaliser au prochain rendu — voir
   * `champAFocaliserApresAjoutLigne` ci-dessus et `ajouterLigne` plus bas.
   * Même mécanisme (une ref, pas un état) que `cleLigneAFocaliserRef` dans
   * `Factures.tsx`.
   */
  const cleLigneAFocaliserRef = useRef<string | null>(null);
  // « Nouvelle recette » est le seul bouton d'ouverture TOUJOURS monté (les
  // boutons « Modifier »/« Nouvelle version » disparaissent avec le panneau de
  // consultation) : ancre de repli commune quand la fiche se referme, qu'elle
  // ait été ouverte en création ou en édition — même principe que
  // `boutonNouvelleDepense` dans `Comptabilite.tsx`.
  const boutonNouvelleRecette = useRef<HTMLButtonElement>(null);
  // « Activer » et « Archiver » sont mutuellement exclusifs (voir
  // `cibleFocusApresChangementStatutRecette` ci-dessus) : après
  // `changerStatut`, on focalise celui des deux qui vient de prendre la
  // place visuelle de l'autre.
  const boutonActiverRecette = useRef<HTMLButtonElement>(null);
  const boutonArchiverRecette = useRef<HTMLButtonElement>(null);

  const chargerListes = useCallback(async () => {
    const [recettes, referentiel, ingredients] = await Promise.all([
      requeteApi<unknown>('/recettes').then((r) => schemaListeRecettes.parse(r).data),
      requeteApi<unknown>('/referentiel/recettes').then(
        (r) => schemaListeRecettesReferentiel.parse(r).data,
      ),
      // Fiches COMPLÈTES (`coutUnitaireCents` compris) : c'est ce que la
      // prévisualisation de coût en direct doit lire pour chaque ligne, et
      // `GET /api/ingredients` ne le porte pas.
      requeteApi<unknown>('/referentiel/ingredients').then(
        (r) => schemaListeIngredientsComplets.parse(r).data,
      ),
    ]);
    return { recettes, referentiel, ingredients };
  }, []);

  /**
   * Recharge SEULEMENT les ingrédients, après une création « à la volée ».
   * Un rechargement complet (`chargerListes`) resélectionnerait potentiellement
   * une autre recette dans certains enchaînements ; ici seule la liste
   * d'ingrédients doit changer, la fiche en cours d'édition doit rester intacte.
   */
  const rechargerIngredients = useCallback(async (): Promise<IngredientComplet[]> => {
    const ingredients = await requeteApi<unknown>('/referentiel/ingredients').then(
      (r) => schemaListeIngredientsComplets.parse(r).data,
    );
    setEtatListe((precedent) =>
      precedent.statut === 'pret' ? { ...precedent, ingredients } : precedent,
    );
    return ingredients;
  }, []);

  // Chargement de la liste au montage, et selection automatique de la
  // premiere recette : l'ecran ne doit jamais afficher un panneau vide alors
  // que des donnees existent (docs/07 §0, « ne jamais faire sentir perdu »).
  useEffect(() => {
    let annule = false;

    chargerListes()
      .then(({ recettes, referentiel, ingredients }) => {
        if (annule) return;
        setEtatListe({ statut: 'pret', recettes, referentiel, ingredients });
        setRecetteSelectionneeId((precedent) => precedent ?? recettes[0]?.id ?? null);
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatListe({ statut: 'erreur', message });
      });

    return () => {
      annule = true;
    };
  }, [chargerListes, rechargement]);

  // Chargement de la fiche detaillee a chaque changement de selection.
  useEffect(() => {
    if (recetteSelectionneeId === null) {
      setEtatDetail(null);
      return;
    }

    let annule = false;
    setEtatDetail({ statut: 'chargement' });

    requeteApi<unknown>(`/recettes/${recetteSelectionneeId}`)
      .then((reponse) => {
        const recette = schemaRecetteDetail.parse(reponse);
        if (annule) return;
        setEtatDetail({ statut: 'pret', recette });
        // Reinitialise le calculateur sur des valeurs REELLES issues de la
        // recette (jamais une valeur inventee, CLAUDE.md §7) : le volume de
        // reference de la fournee, et le premier ingredient de la recette.
        setCalculateur({
          typeCible: 'volume',
          valeurSaisie: String(recette.rendementReferenceMl),
          ingredientId: recette.lignes[0]?.ingredientId ?? null,
        });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatDetail({ statut: 'erreur', message });
      });

    return () => {
      annule = true;
    };
  }, [recetteSelectionneeId, rechargement]);

  // Calculateur permanent : pas de bouton « Calculer », le recalcul part de
  // la saisie apres un court debounce (docs/06 §5). Toute la reponse vient de
  // l'API ; ce bloc ne fait que parser la saisie et construire le corps de
  // la requete, jamais un calcul de quantite ou de cout.
  useEffect(() => {
    if (etatDetail === null || etatDetail.statut !== 'pret') return;
    const recette = etatDetail.recette;
    if (recette.lignes.length === 0) return; // rien a mettre a l'echelle (recette vide)

    const valeur = parserEntierPositif(calculateur.valeurSaisie);
    if (valeur === null) {
      setErreurValeur(messageErreurValeur(calculateur.typeCible));
      setEtatCalcul(null);
      return;
    }

    let corps: CibleCalcul;
    if (calculateur.typeCible === 'ingredient') {
      if (calculateur.ingredientId === null) {
        setErreurValeur('Sélectionnez un ingrédient de la recette.');
        setEtatCalcul(null);
        return;
      }
      corps = { cible: 'ingredient', valeur, ingredientId: calculateur.ingredientId };
    } else if (calculateur.typeCible === 'crepes') {
      corps = { cible: 'crepes', valeur };
    } else {
      corps = { cible: 'volume', valeur };
    }

    setErreurValeur(null);

    let annule = false;
    const identifiantRecette = recette.id;
    const minuteur = window.setTimeout(() => {
      setEtatCalcul({ statut: 'chargement' });
      requeteApi<unknown>(`/recettes/${identifiantRecette}/calculer`, {
        method: 'POST',
        body: JSON.stringify(corps),
      })
        .then((reponse) => {
          const resultat = schemaResultatCalcul.parse(reponse);
          if (!annule) setEtatCalcul({ statut: 'pret', resultat });
        })
        .catch((erreur: unknown) => {
          if (annule) return;
          const message =
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Erreur inattendue, sans plus de détail.';
          setEtatCalcul({ statut: 'erreur', message });
        });
    }, DELAI_DEBOUNCE_MS);

    return () => {
      annule = true;
      window.clearTimeout(minuteur);
    };
  }, [etatDetail, calculateur]);

  // Focalise le premier champ (l'ingrédient) de la ligne qui vient d'être
  // ajoutée — voir `champAFocaliserApresAjoutLigne` ci-dessus pour la
  // justification complète. Un `useEffect` et non un appel direct depuis
  // `ajouterLigne` : le champ n'existe pas encore dans le DOM au moment du
  // clic, seulement après le rendu déclenché par la mise à jour du brouillon.
  useEffect(() => {
    const cle = cleLigneAFocaliserRef.current;
    if (cle === null) return;
    cleLigneAFocaliserRef.current = null;
    const nom = champAFocaliserApresAjoutLigne(cle, brouillon.lignes);
    if (nom === null) return;
    formulaireRef.current?.querySelector<HTMLElement>(`[name="${nom}"]`)?.focus();
  }, [brouillon.lignes]);

  const recettes = useMemo(
    () => (etatListe.statut === 'pret' ? etatListe.recettes : []),
    [etatListe],
  );
  const referentiel = useMemo(
    () => (etatListe.statut === 'pret' ? etatListe.referentiel : []),
    [etatListe],
  );
  const ingredients = useMemo(
    () => (etatListe.statut === 'pret' ? etatListe.ingredients : []),
    [etatListe],
  );
  /**
   * Ingrédients PROPOSABLES dans un `<select>` de ligne : les actifs
   * seulement, comme partout ailleurs dans l'application (un ingrédient
   * retiré du référentiel disparaît des listes de choix, il reste dans
   * l'historique — CLAUDE.md §3 règle 7).
   */
  const ingredientsActifs = useMemo(() => ingredients.filter((i) => i.actif), [ingredients]);

  const recetteActive =
    etatDetail !== null && etatDetail.statut === 'pret' ? etatDetail.recette : null;

  /** Ce qui scelle la recette ouverte, au sens de D-005. */
  const etatEcriture = useMemo(
    () => referentiel.find((r) => r.id === recetteSelectionneeId) ?? null,
    [referentiel, recetteSelectionneeId],
  );
  const scellee = etatEcriture !== null && etatEcriture.nbProductions > 0;

  /**
   * Toutes les versions de la lignée de la recette ouverte, triées par
   * numéro croissant. Sert au sélecteur de comparaison de versions (fiche 04) :
   * une lignée à une seule version n'a rien à comparer.
   */
  const versionsDeLaLignee = useMemo(
    () =>
      recetteActive === null
        ? []
        : referentiel
            .filter((r) => r.code === recetteActive.code)
            .slice()
            .sort((a, b) => a.version - b.version),
    [referentiel, recetteActive],
  );

  /**
   * Coût matière, coût par crêpe et allergènes agrégés, recalculés EN DIRECT
   * sur le brouillon en cours de saisie — fiche 04, module 1 : « ajouter une
   * ligne, en retirer une, changer une quantité, avec recalcul en direct ».
   *
   * Calcul CLIENT, mais pas un calcul métier INVENTÉ ici : `mettreAEchelle` et
   * `agregerAllergenes` sont les MÊMES fonctions pures de `@batte/core` que
   * `POST /recettes/:id/calculer` appelle côté serveur (règle d'architecture
   * n°1 — le paquet est explicitement partagé avec le navigateur). L'appel HTTP
   * ne convient pas ici : il suppose une recette déjà enregistrée, alors que ce
   * panneau doit refléter des lignes pas encore soumises, y compris en pleine
   * création d'une recette qui n'a pas encore d'identifiant.
   *
   * `mettreAEchelle` est appelée pour la cible `volume` au volume de RÉFÉRENCE
   * (facteur 1) : c'est exactement ce que fait déjà `coutParCrepe`
   * (`packages/db/src/depots/recettes.ts`) pour chiffrer une recette enregistrée,
   * donc la prévisualisation reste comparable au coût affiché une fois enregistré.
   */
  const previsualisation = useMemo<PrevisualisationEdition>(() => {
    if (brouillon.lignes.length === 0) {
      return {
        statut: 'indisponible',
        message: 'Aucun ingrédient : rien à chiffrer pour le moment.',
      };
    }

    const rendementReferenceMl = nombreSaisi(brouillon.rendementReferenceMl);
    const rendementReferenceCrepes = nombreSaisi(brouillon.rendementReferenceCrepes);
    const perteCuissonBp = nombreSaisi(brouillon.perteCuissonBp);
    const tauxCasseBp = nombreSaisi(brouillon.tauxCasseBp);

    if (
      rendementReferenceMl === null ||
      !Number.isFinite(rendementReferenceMl) ||
      rendementReferenceMl <= 0 ||
      rendementReferenceCrepes === null ||
      !Number.isFinite(rendementReferenceCrepes) ||
      rendementReferenceCrepes <= 0 ||
      perteCuissonBp === null ||
      !Number.isFinite(perteCuissonBp) ||
      tauxCasseBp === null ||
      !Number.isFinite(tauxCasseBp)
    ) {
      return {
        statut: 'indisponible',
        message:
          'Renseignez la fournée de référence (volume et crêpes) et les pertes pour voir le coût recalculé.',
      };
    }

    const lignesResolues: LigneRecetteCalcul[] = [];
    for (const ligne of brouillon.lignes) {
      const ingredient = ingredients.find((i) => i.id === ligne.ingredientId);
      const quantite = nombreSaisi(ligne.quantite);
      if (
        ingredient === undefined ||
        quantite === null ||
        !Number.isFinite(quantite) ||
        quantite <= 0
      ) {
        return {
          statut: 'indisponible',
          message: 'Complétez chaque ligne (ingrédient et quantité) pour voir le coût recalculé.',
        };
      }
      lignesResolues.push({
        ingredientId: ingredient.id,
        nomIngredient: ingredient.nom,
        unite: ingredient.uniteReference,
        quantiteReference: quantite,
        // `ingredient.coutUnitaireCents` est déjà `number | null` (contrat
        // `IngredientComplet`) : un ingrédient sans conditionnement actif a un
        // prix INCONNU, jamais gratuit — même repli que le serveur
        // (`chargerRecettePourCalcul`, `packages/db/src/depots/recettes.ts`),
        // qui ne fait plus `?? 0` depuis l'audit 29/07/2026 (défaut n°1). La
        // prévisualisation doit rester cohérente avec ce que l'enregistrement
        // produira réellement.
        cumpCentsParUnite: ingredient.coutUnitaireCents,
        allergenes: ingredient.allergenes,
        allergenesVerifies: ingredient.allergenesVerifies,
      });
    }

    try {
      const resultat = mettreAEchelle(
        {
          id: recetteActive?.id ?? 'brouillon',
          code: brouillon.code,
          rendementReferenceMl,
          rendementReferenceCrepes,
          perteCuissonBp,
          tauxCasseBp,
          lignes: lignesResolues,
        },
        { type: 'volume', volumeMl: rendementReferenceMl },
      );
      return {
        statut: 'pret',
        coutMatiereCents: resultat.coutMatiereCents,
        coutParCrepeCents: resultat.coutParCrepeCents,
        // Noms des ingrédients dont le coût est inconnu — c'est exactement ce
        // qui distingue un coût matière absent (recette pas encore complète)
        // d'un coût matière INCONNU (ingrédients complets, mais sans prix) :
        // le message affiché doit pouvoir dire LEQUEL manque (CLAUDE.md §7).
        ingredientsSansPrix: resultat.lignes
          .filter((l) => l.cumpCentsParUnite === null)
          .map((l) => l.nomIngredient),
        allergenes: resultat.allergenes,
        allergenesVerifies: resultat.allergenesVerifies,
      };
    } catch (erreur) {
      return {
        statut: 'indisponible',
        message:
          erreur instanceof ErreurMetier ? erreur.message : 'Coût non calculable pour le moment.',
      };
    }
  }, [
    brouillon.code,
    brouillon.lignes,
    brouillon.perteCuissonBp,
    brouillon.rendementReferenceCrepes,
    brouillon.rendementReferenceMl,
    brouillon.tauxCasseBp,
    ingredients,
    recetteActive,
  ]);

  // Recharge les deux fiches comparées dès que l'une des deux sélections
  // change. Chaque version est chargée par `GET /recettes/:id`, exactement la
  // route déjà utilisée pour ouvrir une fiche : aucune route dédiée à créer.
  useEffect(() => {
    if (!comparaisonOuverte || comparaisonAvantId === null || comparaisonApresId === null) {
      setEtatComparaison({ statut: 'inactif' });
      return;
    }

    let annule = false;
    setEtatComparaison({ statut: 'chargement' });

    Promise.all([
      requeteApi<unknown>(`/recettes/${comparaisonAvantId}`).then((r) =>
        schemaRecetteDetail.parse(r),
      ),
      requeteApi<unknown>(`/recettes/${comparaisonApresId}`).then((r) =>
        schemaRecetteDetail.parse(r),
      ),
    ])
      .then(([avant, apres]) => {
        if (annule) return;
        setEtatComparaison({ statut: 'pret', avant, apres });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        setEtatComparaison({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Erreur inattendue, sans plus de détail.',
        });
      });

    return () => {
      annule = true;
    };
  }, [comparaisonOuverte, comparaisonAvantId, comparaisonApresId]);

  /**
   * Ouvre le panneau de comparaison, avec une paire par défaut UTILE :
   * la version ouverte, et sa version PARENTE (D-005 : `recetteParentId`) —
   * c'est la comparaison qu'on veut voir juste après avoir créé une version.
   * À défaut de parent (une v1 seule dans une lignée à plusieurs recettes —
   * cas impossible en pratique, mais sans risque à défendre), on retombe sur
   * n'importe quelle autre version de la lignée.
   */
  function ouvrirComparaison(): void {
    if (recetteActive === null) return;
    const parentId = etatEcriture?.recetteParentId ?? null;
    const repli = versionsDeLaLignee.find((v) => v.id !== recetteActive.id)?.id ?? null;
    setComparaisonApresId(recetteActive.id);
    setComparaisonAvantId(parentId ?? repli);
    setComparaisonOuverte(true);
  }

  function fermerComparaison(): void {
    setComparaisonOuverte(false);
    setEtatComparaison({ statut: 'inactif' });
  }

  /* ─── Création d'ingrédient « à la volée » (fiche 09) ────────────────── */

  /**
   * Options du `<select>` d'une ligne : les actifs, PLUS l'ingrédient déjà
   * choisi sur cette ligne s'il a depuis été retiré du référentiel — sinon le
   * champ afficherait une case vide pour une ligne pourtant renseignée.
   */
  function ingredientsPourLigne(ligne: LigneBrouillon): IngredientComplet[] {
    if (ligne.ingredientId === '' || ingredientsActifs.some((i) => i.id === ligne.ingredientId)) {
      return ingredientsActifs;
    }
    const retire = ingredients.find((i) => i.id === ligne.ingredientId);
    return retire === undefined ? ingredientsActifs : [retire, ...ingredientsActifs];
  }

  /**
   * Cœur de la fiche 09 : « si l'ingrédient recherché n'existe pas, proposer
   * sa création à la volée ». Ouvre le mini-formulaire SCOPÉ à la ligne qui l'a
   * déclenché — sans quitter l'écran de recette, sans perdre le reste de la
   * saisie en cours (les autres lignes, l'en-tête).
   */
  function ouvrirCreationIngredient(ligneIndex: number): void {
    setCreationIngredient({
      ligneIndex,
      brouillon: INGREDIENT_RAPIDE_VIDE,
      champsEnErreur: {},
      erreur: null,
      envoi: false,
    });
    // Le mini-formulaire nait de ce rendu : meme motif que `ouvrirCreation`
    // ci-dessus, le champ n'existe pas encore au moment de l'appel.
    window.setTimeout(
      () =>
        formulaireRef.current
          ?.querySelector<HTMLInputElement>('[name="ingredient-rapide-nom"]')
          ?.focus(),
      0,
    );
  }

  function fermerCreationIngredient(): void {
    const ligneIndex = creationIngredient?.ligneIndex;
    setCreationIngredient(null);
    // Le bouton qui a ouvert ce mini-formulaire (le <select> d'ingrédient de
    // la ligne) disparait du DOM en meme temps que lui : sans ce rappel, le
    // focus retomberait sur `<body>` au milieu de la composition d'une recette.
    if (ligneIndex !== undefined) {
      window.setTimeout(
        () =>
          formulaireRef.current
            ?.querySelector<HTMLElement>(`[name="lignes.${ligneIndex}.ingredientId"]`)
            ?.focus(),
        0,
      );
    }
  }

  function modifierCreationIngredient<C extends keyof BrouillonIngredientRapide>(
    champ: C,
    valeur: BrouillonIngredientRapide[C],
  ): void {
    setCreationIngredient((precedent) => {
      if (precedent === null) return precedent;
      return {
        ...precedent,
        brouillon: { ...precedent.brouillon, [champ]: valeur },
        // Validation À LA SAUVEGARDE, jamais en direct — voir
        // `champsEnErreurApresModification` (`../composants/formulaire`).
        // Défaut mesuré (recette clavier du 30/07/2026) : ce mini-formulaire
        // effaçait l'erreur du champ modifié dès la première frappe, sans
        // revalider la nouvelle valeur — même défaut que `modifierChamp`
        // ci-dessus, sur ce formulaire imbriqué de création d'ingrédient
        // « à la volée » (fiche 09).
        champsEnErreur: champsEnErreurApresModification(precedent.champsEnErreur),
      };
    });
  }

  function basculerAllergeneCreation(code: string, coche: boolean): void {
    setCreationIngredient((precedent) => {
      if (precedent === null) return precedent;
      const allergenes = coche
        ? [...precedent.brouillon.allergenes, code]
        : precedent.brouillon.allergenes.filter((a) => a !== code);
      return { ...precedent, brouillon: { ...precedent.brouillon, allergenes } };
    });
  }

  /**
   * Crée l'ingrédient, PUIS l'assigne à la ligne qui a ouvert le formulaire.
   *
   * N'appelle QUE `POST /ingredients` (`apps/api/src/routes/referentiel-ecriture.ts`,
   * déjà livré) : aucune logique de création réécrite ici, exactement la
   * consigne de la fiche 09 (« la route existe déjà […] Appelle-la »). Mêmes
   * schéma et mêmes valeurs par défaut que l'écran Ingrédients pour un
   * ingrédient créé depuis LÀ : stock de sécurité à 0, délai et durée de
   * conservation vides — ils se complètent ensuite depuis l'écran Ingrédients,
   * qui porte aussi l'association fournisseur/conditionnement.
   */
  function creerIngredientRapide(): void {
    if (creationIngredient === null) return;
    // Garde contre le doublon de référentiel (défaut connu corrigé le
    // 28/09/2026) : le bouton est `disabled` pendant l'envoi, mais la touche
    // Entrée du mini-formulaire appelle cette fonction sans passer par lui.
    if (creationIngredient.envoi) return;
    const b = creationIngredient.brouillon;
    const ligneIndex = creationIngredient.ligneIndex;

    const corps = {
      nom: b.nom,
      categorie: b.categorie,
      uniteReference: b.uniteReference,
      densiteGParMl: b.uniteReference === 'piece' ? null : nombreSaisi(b.densite),
      allergenes: b.allergenes,
      stockSecurite: 0,
      delaiLivraisonJours: null,
      dureeConservationJours: null,
      notes: null,
    };

    // Le MÊME schéma que le serveur, rejoué avant tout aller-retour — comme
    // partout ailleurs dans cet écran et dans Ingredients.tsx.
    const verification = schemaSaisieIngredient.safeParse(corps);
    if (!verification.success) {
      const champs = champsDepuisErreurZod(verification.error);
      setCreationIngredient((precedent) =>
        precedent === null ? precedent : { ...precedent, champsEnErreur: champs },
      );
      return;
    }

    setCreationIngredient((precedent) =>
      precedent === null ? precedent : { ...precedent, envoi: true, erreur: null },
    );

    requeteApi<unknown>('/ingredients', { method: 'POST', body: JSON.stringify(corps) })
      .then(async (reponse) => {
        const cree = schemaIngredientComplet.parse(reponse);
        await rechargerIngredients();
        setCreationIngredient((precedent) => {
          if (precedent === null) return precedent;
          modifierLigne(precedent.ligneIndex, 'ingredientId', cree.id);
          return null;
        });
        // L'ingrédient est choisi : l'étape suivante de la saisie est sa
        // quantité, sur la MÊME ligne (même motif que le focus-entrant de
        // `ouvrirCreationIngredient` ci-dessus).
        window.setTimeout(
          () =>
            formulaireRef.current
              ?.querySelector<HTMLElement>(`[name="lignes.${ligneIndex}.quantiteUniteRef"]`)
              ?.focus(),
          0,
        );
      })
      .catch((erreur: unknown) => {
        setCreationIngredient((precedent) => {
          if (precedent === null) return precedent;
          if (erreur instanceof ErreurApi && erreur.champs !== undefined) {
            return { ...precedent, envoi: false, champsEnErreur: erreur.champs };
          }
          return {
            ...precedent,
            envoi: false,
            erreur:
              erreur instanceof ErreurApi
                ? erreur.message
                : 'Erreur inattendue, sans plus de détail.',
          };
        });
      });
  }

  function choisirCible(recette: RecetteDetail, nouvelleCible: TypeCible): void {
    setCalculateur((precedent) => {
      switch (nouvelleCible) {
        case 'crepes':
          return {
            typeCible: 'crepes',
            // Valeur de depart reelle : le rendement de reference en crepes,
            // pas un chiffre rond invente (CLAUDE.md §7).
            valeurSaisie: String(recette.rendementReferenceCrepes),
            ingredientId: precedent.ingredientId,
          };
        case 'volume':
          return {
            typeCible: 'volume',
            valeurSaisie: String(recette.rendementReferenceMl),
            ingredientId: precedent.ingredientId,
          };
        case 'ingredient': {
          const id = precedent.ingredientId ?? recette.lignes[0]?.ingredientId ?? null;
          const ligne = recette.lignes.find((l) => l.ingredientId === id);
          return {
            typeCible: 'ingredient',
            valeurSaisie: ligne !== undefined ? String(ligne.quantiteReference) : '',
            ingredientId: id,
          };
        }
      }
    });
  }

  function choisirIngredient(recette: RecetteDetail, ingredientId: string): void {
    const ligne = recette.lignes.find((l) => l.ingredientId === ingredientId);
    setCalculateur((precedent) => ({
      ...precedent,
      ingredientId,
      valeurSaisie: ligne !== undefined ? String(ligne.quantiteReference) : precedent.valeurSaisie,
    }));
  }

  /* ─── Ouverture des formulaires ──────────────────────────────────────── */

  function reinitialiserMessages(): void {
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setMessageSucces(null);
  }

  function ouvrirCreation(): void {
    reinitialiserMessages();
    setBrouillon(BROUILLON_VIDE);
    setModeFiche({ mode: 'creation' });
    window.setTimeout(() => formulaireRef.current?.querySelector('input')?.focus(), 0);
  }

  function ouvrirEdition(intention: 'modification' | 'version'): void {
    if (recetteActive === null) return;
    reinitialiserMessages();
    // Notes techniques déjà en base, indexées par ingrédient : `RecetteDetail.lignes`
    // (schéma `schemaRecetteDetail`, `@batte/core`) ne porte pas encore ce champ,
    // mais `GET /referentiel/recettes` (état `referentiel`, `etatEcriture` ici)
    // l'expose depuis l'audit du 30/07/2026 (`RecetteReferentielLigne.notesTechniques`).
    // Sans cette lecture croisée, rouvrir puis réenregistrer une recette
    // EFFACERAIT une note qu'on n'aurait jamais pu voir — la faute la plus
    // vicieuse d'un formulaire, parce que rien ne la signale.
    const notesConnues = new Map(
      (etatEcriture?.notesTechniques ?? []).map((n) => [n.ingredientId, n.noteTechnique]),
    );
    setBrouillon({
      code: recetteActive.code,
      nom: recetteActive.nom,
      typePate: recetteActive.typePate,
      sansGluten: recetteActive.sansGluten,
      rendementReferenceMl: String(recetteActive.rendementReferenceMl),
      rendementReferenceCrepes: String(recetteActive.rendementReferenceCrepes),
      perteCuissonBp: String(recetteActive.perteCuissonBp),
      tauxCasseBp: String(recetteActive.tauxCasseBp),
      perteFixeMl: String(recetteActive.perteFixeMl),
      procede: recetteActive.procede ?? '',
      notes: recetteActive.notes ?? '',
      lignes: recetteActive.lignes.map((l) => ({
        cle: nouvelleCleLigne(),
        ingredientId: l.ingredientId,
        quantite: String(l.quantiteReference),
        noteTechnique: notesConnues.get(l.ingredientId) ?? '',
      })),
    });
    setModeFiche({ mode: 'edition', intention });
    window.setTimeout(() => formulaireRef.current?.querySelector('input')?.focus(), 0);
  }

  function modifierChamp<C extends keyof BrouillonRecette>(
    champ: C,
    valeur: BrouillonRecette[C],
  ): void {
    setBrouillon((precedent) => ({ ...precedent, [champ]: valeur }));
    // Validation À LA SAUVEGARDE, jamais en direct — voir
    // `champsEnErreurApresModification` (`../composants/formulaire`) pour la
    // justification complète, partagée avec Ingrédients, Produits, Lieux de
    // marché et Concurrents. Défaut mesuré (recette clavier du 30/07/2026) :
    // cette fonction effaçait l'erreur du champ modifié dès la première
    // frappe, sans revalider la nouvelle valeur.
    setChampsEnErreur(champsEnErreurApresModification);
  }

  function modifierLigne(index: number, champ: keyof LigneBrouillon, valeur: string): void {
    setBrouillon((precedent) => ({
      ...precedent,
      lignes: precedent.lignes.map((ligne, i) =>
        i === index ? { ...ligne, [champ]: valeur } : ligne,
      ),
    }));
    // Même choix que `modifierChamp` ci-dessus, sur le MÊME état
    // `champsEnErreur` (les clés `lignes.${index}.*` y vivent aussi) : voir
    // `champsEnErreurApresModification`. Avant ce correctif, cette fonction
    // ne touchait `champsEnErreur` d'aucune façon — un no-op qui produit
    // accidentellement le même résultat que l'utilitaire, mais sans passer
    // par lui, donc invérifié et non protégé contre un futur correctif qui
    // y ajouterait un `delete` par frappe.
    setChampsEnErreur(champsEnErreurApresModification);
  }

  function ajouterLigne(): void {
    const nouvelle: LigneBrouillon = {
      cle: nouvelleCleLigne(),
      ingredientId: '',
      quantite: '',
      noteTechnique: '',
    };
    // Cible du focus une fois la ligne rendue — voir l'effet sur
    // `brouillon.lignes` plus haut, et `champAFocaliserApresAjoutLigne`.
    cleLigneAFocaliserRef.current = nouvelle.cle;
    setBrouillon((precedent) => ({
      ...precedent,
      lignes: [...precedent.lignes, nouvelle],
    }));
  }

  function retirerLigne(index: number): void {
    setBrouillon((precedent) => ({
      ...precedent,
      lignes: precedent.lignes.filter((_, i) => i !== index),
    }));
  }

  function focaliserPremierChampFautif(champs: ChampsEnErreur): void {
    const premier = Object.keys(champs)[0];
    if (premier === undefined) return;
    formulaireRef.current?.querySelector<HTMLElement>(`[name="${premier}"]`)?.focus();
  }

  function enregistrer(): void {
    const corps = {
      code: brouillon.code,
      nom: brouillon.nom,
      typePate: brouillon.typePate,
      sansGluten: brouillon.sansGluten,
      rendementReferenceMl: nombreSaisi(brouillon.rendementReferenceMl),
      rendementReferenceCrepes: nombreSaisi(brouillon.rendementReferenceCrepes),
      perteCuissonBp: nombreSaisi(brouillon.perteCuissonBp),
      tauxCasseBp: nombreSaisi(brouillon.tauxCasseBp),
      perteFixeMl: nombreSaisi(brouillon.perteFixeMl),
      procede: brouillon.procede,
      notes: brouillon.notes,
      lignes: brouillon.lignes.map((ligne) => ({
        ingredientId: ligne.ingredientId,
        quantiteUniteRef: nombreSaisi(ligne.quantite),
        noteTechnique: ligne.noteTechnique,
      })),
    };

    // Le MÊME schéma que le serveur, rejoué avant tout aller-retour : le doublon
    // d'ingrédient et la quantité illisible s'affichent sous la ligne fautive,
    // sans attendre la réponse.
    const verification = schemaSaisieRecette.safeParse(corps);
    if (!verification.success) {
      const champs = champsDepuisErreurZod(verification.error);
      setChampsEnErreur(champs);
      focaliserPremierChampFautif(champs);
      return;
    }

    setErreurFormulaire(null);
    setMessageSucces(null);
    setEnvoi('envoi');

    const versionnage = modeFiche.mode === 'edition' && modeFiche.intention === 'version';
    const chemin =
      modeFiche.mode === 'creation'
        ? '/recettes'
        : versionnage
          ? `/recettes/${recetteSelectionneeId}/versions`
          : `/recettes/${recetteSelectionneeId}`;
    const methode = modeFiche.mode === 'creation' || versionnage ? 'POST' : 'PATCH';

    requeteApi<unknown>(chemin, { method: methode, body: JSON.stringify(corps) })
      .then((reponse) => {
        if (versionnage) {
          const resultat = schemaResultatVersionRecette.parse(reponse);
          setRecetteSelectionneeId(resultat.id);
          setMessageSucces(
            `${resultat.code} v${resultat.version} créée, et la version précédente archivée. ` +
              `${resultat.produitsSurVersionPrecedente} produit(s) de vente restent rattachés à ` +
              `la version précédente : ils continueront de consommer son ancienne composition ` +
              `tant que vous ne les aurez pas repointés depuis l’écran Produits.`,
          );
        } else {
          const detail = schemaRecetteDetail.parse(reponse);
          setRecetteSelectionneeId(detail.id);
          setMessageSucces(
            modeFiche.mode === 'creation'
              ? `${detail.code} v${detail.version} créée en brouillon. Activez-la pour pouvoir la produire.`
              : `${detail.code} v${detail.version} enregistrée.`,
          );
        }
        setChampsEnErreur({});
        setModeFiche({ mode: 'consultation' });
        requestAnimationFrame(() => boutonNouvelleRecette.current?.focus());
        setRechargement((n) => n + 1);
      })
      .catch((erreur: unknown) => {
        if (erreur instanceof ErreurApi && erreur.champs !== undefined) {
          setChampsEnErreur(erreur.champs);
          focaliserPremierChampFautif(erreur.champs);
          return;
        }
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      })
      .finally(() => setEnvoi('inactif'));
  }

  function changerStatut(statut: StatutRecette): void {
    if (recetteSelectionneeId === null) return;
    setErreurFormulaire(null);
    setMessageSucces(null);

    requeteApi<unknown>(`/recettes/${recetteSelectionneeId}/statut`, {
      method: 'PATCH',
      body: JSON.stringify({ statut }),
    })
      .then((reponse) => {
        const detail = schemaRecetteDetail.parse(reponse);
        setMessageSucces(
          `${detail.code} v${detail.version} — ${libelleStatutRecette(detail.statut)}.`,
        );
        // Écrit directement `{ statut: 'pret', recette: detail }` (D-079,
        // même patron que `appliquerChangementStatut` dans `Factures.tsx`) :
        // la réponse du PATCH porte déjà la fiche à jour, inutile de
        // repasser par `setRechargement`, qui ferait retransiter l'effet de
        // chargement du détail (ci-dessus, dépendances
        // `[recetteSelectionneeId, rechargement]`) par
        // `{ statut: 'chargement' }` et démonterait tout le panneau « Fiche
        // technique » — Activer/Archiver compris.
        setEtatDetail({ statut: 'pret', recette: detail });
        // La liste de gauche affiche aussi le statut (colonne dédiée) : mise
        // à jour EN PLACE, sans recharger toute la liste — même raisonnement
        // que `rechargerIngredients` un peu plus haut. `detail` (un
        // `RecetteDetail`) porte tous les champs d'un `RecetteResume`
        // (`schemaRecetteDetail = schemaRecetteResume.extend(...)`).
        setEtatListe((precedent) =>
          precedent.statut === 'pret'
            ? {
                ...precedent,
                recettes: precedent.recettes.map((r) => (r.id === detail.id ? detail : r)),
              }
            : precedent,
        );
        // Le bouton cliqué (Activer/Archiver) disparaît légitimement — son
        // statut vient de changer — et son opposé prend sa place visuelle
        // dans le même bloc (voir `cibleFocusApresChangementStatutRecette`
        // ci-dessus). `requestAnimationFrame` : même patron que
        // `boutonNouvelleRecette` plus bas dans `enregistrer`, le bouton visé
        // n'existe pas encore dans le DOM au moment de cet appel.
        const cible = cibleFocusApresChangementStatutRecette(detail.statut);
        requestAnimationFrame(() => {
          (cible === 'archiver' ? boutonArchiverRecette : boutonActiverRecette).current?.focus();
        });
      })
      .catch((erreur: unknown) => {
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  return (
    <div
      className="flex flex-col gap-bloc"
      onKeyDown={(evenement) => {
        // Ctrl+S : raccourci d'enregistrement universel (docs/07 §4.6).
        if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === 's') {
          evenement.preventDefault();
          if (modeFiche.mode !== 'consultation') enregistrer();
        }
      }}
    >
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Recettes</h1>
        <button
          type="button"
          ref={boutonNouvelleRecette}
          onClick={ouvrirCreation}
          className={CLASSE_BOUTON_PRIMAIRE}
        >
          Nouvelle recette
        </button>
      </div>

      {/*
        Deux panneaux cote a cote des 1024 px, et non 1280 : la cible de
        conception est un viewport EFFECTIF de 1280x720 (Windows a 150 %), donc
        un point de rupture a 1280 ferait retomber l'ecran en colonne unique
        exactement a la resolution visee.
      */}
      <div className="grid grid-cols-1 items-start gap-bloc lg:grid-cols-2">
        {/* ═══ Colonne gauche : la recette ═══════════════════════════════ */}
        <div className="flex flex-col gap-bloc">
          <Panneau
            titre={
              etatListe.statut === 'pret'
                ? compteAccorde(etatListe.recettes.length, 'recette', 'recettes')
                : 'Recettes'
            }
            sansRembourrage
          >
            {etatListe.statut === 'chargement' && (
              <p className="px-4 py-2 text-sm text-ink-3">Chargement des recettes…</p>
            )}
            {etatListe.statut === 'erreur' && (
              <div className="px-4 py-2">
                <MessageErreur message={etatListe.message} />
              </div>
            )}
            {etatListe.statut === 'pret' && (
              <Tableau
                colonnes={COLONNES_LISTE}
                lignes={recettes}
                cleLigne={(r) => r.id}
                // `exactOptionalPropertyTypes` interdit un `undefined` explicite
                // sur une prop optionnelle : on ne la fournit que si une recette
                // est reellement selectionnee.
                {...(recetteSelectionneeId !== null
                  ? { ligneSelectionneeCle: recetteSelectionneeId }
                  : {})}
                onSelectionnerLigne={(r) => {
                  setRecetteSelectionneeId(r.id);
                  setModeFiche({ mode: 'consultation' });
                  reinitialiserMessages();
                }}
                etatVide={
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucune recette enregistrée"
                    explication="Créez une première recette : sa composition, son rendement et ses pertes suffisent à calculer un coût matière par crêpe."
                    action={{ libelle: 'Créer une recette', onClick: ouvrirCreation }}
                  />
                }
              />
            )}
          </Panneau>

          {etatDetail !== null && etatDetail.statut === 'chargement' && (
            <p className="text-sm text-ink-3">Chargement de la recette…</p>
          )}

          {etatDetail !== null && etatDetail.statut === 'erreur' && (
            <MessageErreur message={etatDetail.message} />
          )}

          {messageSucces !== null && modeFiche.mode === 'consultation' && (
            <div className="border-l-2 border-conforme bg-conforme-bg px-3 py-2 text-sm text-conforme">
              {messageSucces}
            </div>
          )}

          {erreurFormulaire !== null && modeFiche.mode === 'consultation' && (
            <MessageErreur message={erreurFormulaire} />
          )}

          {/* ═══ Fiche technique, en lecture ═══════════════════════════ */}
          {modeFiche.mode === 'consultation' && recetteActive !== null && (
            <Panneau
              titre={`${recetteActive.code} v${recetteActive.version} — ${recetteActive.nom}`}
              sansRembourrage
            >
              {/* CLAUDE.md §1 : « Recettes & fiches techniques » est le premier
                  des cinq domaines fonctionnels du produit. Le document existe
                  côté serveur (`GET /documents/fiche-technique/:id`, gabarit
                  testé) depuis longtemps sans le moindre bouton nulle part
                  (docs/28-ORPHELINS-DERIVES.md §2.3). `BoutonDocument` est déjà
                  le composant partagé pour tous les autres documents — on le
                  réutilise tel quel, jamais un second mécanisme. */}
              <div className="flex items-center justify-end border-b border-line px-4 py-2">
                <BoutonDocument
                  chemin={`/documents/fiche-technique/${recetteActive.id}`}
                  libelle="Fiche technique (PDF)"
                  libelleAttente="Édition de la fiche…"
                />
              </div>
              <Tableau
                colonnes={COLONNES_LIGNES_REFERENCE}
                lignes={lignesReferenceAffichees(recetteActive.lignes, ingredients)}
                cleLigne={(l) => l.ingredientId}
                etatVide={
                  <EtatVide
                    variante="normal"
                    texte="Aucun ingrédient enregistré : cette recette est un brouillon vide. Sa composition est saisissable ci-dessous."
                  />
                }
              />

              <dl className="flex flex-col gap-1 border-t border-line p-4 text-sm">
                <LigneFiche libelle="Type de pâte" valeur={recetteActive.typePate} />
                <LigneFiche
                  libelle="Sans gluten"
                  valeur={recetteActive.sansGluten ? 'Oui' : 'Non'}
                />
                <LigneFiche
                  libelle="Fournée de référence"
                  valeur={`${formaterQuantite(recetteActive.rendementReferenceMl, 'ml')} pour ${formaterCrepes(recetteActive.rendementReferenceCrepes)}`}
                />
                <LigneFiche
                  libelle="Perte de cuisson"
                  valeur={formaterPointsDeBase(recetteActive.perteCuissonBp)}
                />
                <LigneFiche
                  libelle="Taux de casse"
                  valeur={formaterPointsDeBase(recetteActive.tauxCasseBp)}
                />
                <LigneFiche
                  libelle="Perte fixe"
                  valeur={formaterQuantite(recetteActive.perteFixeMl, 'ml')}
                />
              </dl>

              <div className="border-t border-line p-4">
                <h3 className="text-2xs uppercase text-ink-3">Procédé</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">
                  {ouTiret(recetteActive.procede, (p) => p)}
                </p>
              </div>

              {/*
                Notes techniques du GESTE, PAR INGRÉDIENT (« beurre noisette, ne
                pas dépasser la coloration ») — pas les allergènes, qui figurent
                déjà dans la colonne dédiée du tableau ci-dessus. Ce bloc n'existe
                que si au moins une ligne en porte une : une recette sans note
                particulière n'a rien à montrer ici.
              */}
              {(etatEcriture?.notesTechniques.length ?? 0) > 0 && (
                <div className="border-t border-line p-4">
                  <h3 className="text-2xs uppercase text-ink-3">Notes techniques</h3>
                  <dl className="mt-1 flex flex-col gap-2 text-sm">
                    {etatEcriture?.notesTechniques.map((n) => (
                      <div key={n.ingredientId}>
                        <dt className="text-ink-2">{n.nomIngredient}</dt>
                        <dd className="whitespace-pre-wrap text-ink-3">{n.noteTechnique}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {/* ═══ Les gestes, nommés ═══════════════════════════════ */}
              <div className="flex flex-col gap-groupe border-t border-line p-4">
                {scellee ? (
                  <>
                    <button
                      type="button"
                      onClick={() => ouvrirEdition('version')}
                      className={CLASSE_BOUTON_PRIMAIRE}
                    >
                      Créer la version {recetteActive.version + 1}
                    </button>
                    <p className="text-xs text-ink-3">
                      {recetteActive.code} v{recetteActive.version} a déjà servi à{' '}
                      {etatEcriture?.nbProductions} production(s) : elle ne se modifie plus. Les
                      réécrire changerait rétroactivement leur coût matière, qui est une pièce
                      comptable. La nouvelle version laisse les productions passées rattachées à
                      celle qui a réellement été utilisée.
                    </p>
                    {etatEcriture !== null && (
                      <p className="text-xs text-ink-3">
                        {phraseProduitsSurVersion(etatEcriture.nbProduits)}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    {/* Deux actions NOMMÉES, jamais un « Modifier » unique : le
                        choix entre corriger une composition jamais servie et
                        acter une évolution est métier (D-005, même famille que
                        D-042 pour les paramètres). */}
                    <button
                      type="button"
                      onClick={() => ouvrirEdition('modification')}
                      className={CLASSE_BOUTON_PRIMAIRE}
                      disabled={recetteActive.statut === 'archivee'}
                    >
                      Modifier cette version
                    </button>
                    <button
                      type="button"
                      onClick={() => ouvrirEdition('version')}
                      className={CLASSE_BOUTON_SECONDAIRE}
                    >
                      Créer la version {recetteActive.version + 1}
                    </button>
                    <p className="text-xs text-ink-3">
                      Cette version n’a servi à aucune production : la modifier ne réécrit aucune
                      pièce comptable. Créez plutôt une nouvelle version si vous voulez garder la
                      composition actuelle consultable — les productions passées, elles, restent
                      toujours rattachées à la version qu’elles ont réellement utilisée.
                    </p>
                    {etatEcriture !== null && (
                      <p className="text-xs text-ink-3">
                        {phraseProduitsSurVersion(etatEcriture.nbProduits)}
                      </p>
                    )}
                  </>
                )}

                <div className="flex items-center gap-groupe border-t border-line pt-3">
                  {recetteActive.statut !== 'active' && (
                    <button
                      type="button"
                      ref={boutonActiverRecette}
                      onClick={() => changerStatut('active')}
                      className={CLASSE_BOUTON_SECONDAIRE}
                    >
                      Activer
                    </button>
                  )}
                  {recetteActive.statut === 'active' && (
                    <button
                      type="button"
                      ref={boutonArchiverRecette}
                      onClick={() => changerStatut('archivee')}
                      className={CLASSE_BOUTON_SECONDAIRE}
                    >
                      Archiver
                    </button>
                  )}
                  <span className="text-xs text-ink-3">
                    Seule une recette active peut être produite.
                    {
                      /* `dateActivation` (`schemaRecetteDetail`,
                         docs/21-CHAMPS-NON-LUS.md §5) : date de la PREMIÈRE
                         activation de CETTE version — fixée une fois pour
                         toutes, elle ne bouge plus même si la version est
                         ensuite archivée (`referentiel-ecriture.ts`). C'est
                         donc « depuis quand cette composition a servi », pas
                         « depuis quand elle est active aujourd'hui » : utile
                         pour situer une version dans le temps, y compris une
                         fois archivée, sans jamais l'avoir montré avant ce
                         correctif. */
                      recetteActive.dateActivation !== null && (
                        <> Mise en production le {formaterDate(recetteActive.dateActivation)}.</>
                      )
                    }
                  </span>
                </div>
              </div>
            </Panneau>
          )}

          {/* ═══ Comparaison de versions (fiche 04) ═══════════════════════ */}
          {modeFiche.mode === 'consultation' &&
            recetteActive !== null &&
            versionsDeLaLignee.length > 1 && (
              <Panneau titre="Comparer deux versions">
                <div className="flex flex-col gap-groupe">
                  {!comparaisonOuverte ? (
                    <button
                      type="button"
                      onClick={ouvrirComparaison}
                      className={`${CLASSE_BOUTON_SECONDAIRE} self-start`}
                    >
                      Comparer les versions
                    </button>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-groupe">
                        <label className="flex flex-col gap-groupe text-sm text-ink-2">
                          Avant
                          <select
                            className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                            value={comparaisonAvantId ?? ''}
                            onChange={(evenement) => setComparaisonAvantId(evenement.target.value)}
                          >
                            {versionsDeLaLignee.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.code} v{v.version} — {libelleStatutRecette(v.statut)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-groupe text-sm text-ink-2">
                          Après
                          <select
                            className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                            value={comparaisonApresId ?? ''}
                            onChange={(evenement) => setComparaisonApresId(evenement.target.value)}
                          >
                            {versionsDeLaLignee.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.code} v{v.version} — {libelleStatutRecette(v.statut)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      {etatComparaison.statut === 'chargement' && (
                        <p className="text-sm text-ink-3">Chargement des deux versions…</p>
                      )}
                      {etatComparaison.statut === 'erreur' && (
                        <MessageErreur message={etatComparaison.message} />
                      )}
                      {etatComparaison.statut === 'pret' && (
                        <>
                          {etatComparaison.avant.id === etatComparaison.apres.id ? (
                            <p className="text-sm text-ink-3">
                              Choisissez deux versions différentes pour voir ce qui a changé.
                            </p>
                          ) : (
                            <>
                              {(() => {
                                const entete = differencesEntete(
                                  etatComparaison.avant,
                                  etatComparaison.apres,
                                );
                                return entete.length === 0 ? (
                                  <p className="text-sm text-ink-3">
                                    Aucun champ d’en-tête n’a changé entre ces deux versions.
                                  </p>
                                ) : (
                                  <dl className="flex flex-col gap-1 text-sm">
                                    {entete.map((champ) => (
                                      <div
                                        key={champ.libelle}
                                        className="flex items-baseline justify-between"
                                      >
                                        <dt className="text-ink-3">{champ.libelle}</dt>
                                        <dd className="num text-ink">
                                          {champ.avant} → {champ.apres}
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                );
                              })()}
                              <Tableau
                                colonnes={COLONNES_COMPARAISON}
                                lignes={lignesComparaisonAffichees(
                                  comparerLignesRecette(
                                    etatComparaison.avant.lignes,
                                    etatComparaison.apres.lignes,
                                  ),
                                )}
                                cleLigne={(l) => l.cle}
                                etatVide={
                                  <EtatVide
                                    variante="normal"
                                    texte="Aucun ingrédient dans l’une ou l’autre version."
                                  />
                                }
                              />
                            </>
                          )}
                        </>
                      )}

                      <button
                        type="button"
                        onClick={fermerComparaison}
                        className={`${CLASSE_BOUTON_SECONDAIRE} self-start`}
                      >
                        Masquer la comparaison
                      </button>
                    </>
                  )}
                </div>
              </Panneau>
            )}

          {/* ═══ Fiche technique, en écriture ══════════════════════════ */}
          {modeFiche.mode !== 'consultation' && (
            <Panneau
              titre={
                modeFiche.mode === 'creation'
                  ? 'Nouvelle recette'
                  : modeFiche.intention === 'version'
                    ? `Nouvelle version — ${brouillon.code} v${libelleNouvelleVersion(recetteActive)}`
                    : `Modifier ${brouillon.code} v${recetteActive?.version ?? ''}`
              }
            >
              <form
                ref={formulaireRef}
                className="flex flex-col gap-bloc"
                onSubmit={(evenement) => {
                  evenement.preventDefault();
                  enregistrer();
                }}
              >
                {modeFiche.mode === 'edition' && modeFiche.intention === 'version' && (
                  <p className="border-l-2 border-accent-line bg-accent-subtle px-3 py-2 text-xs text-ink-2">
                    Une nouvelle version garde le CODE de sa lignée : c’est lui qui identifie la
                    recette d’une version à l’autre. La version actuelle sera archivée, et les
                    productions passées y resteront rattachées.
                  </p>
                )}

                <div className="grid grid-cols-3 gap-groupe">
                  <ChampTexte
                    nom="code"
                    libelle="Code"
                    valeur={brouillon.code}
                    onChange={(v) => modifierChamp('code', v)}
                    erreur={champsEnErreur['code']}
                    obligatoire
                    lectureSeule={modeFiche.mode === 'edition' && modeFiche.intention === 'version'}
                  />
                  <ChampTexte
                    nom="typePate"
                    libelle="Type de pâte"
                    valeur={brouillon.typePate}
                    onChange={(v) => modifierChamp('typePate', v)}
                    erreur={champsEnErreur['typePate']}
                    obligatoire
                  />
                  <label className="flex items-end gap-groupe pb-2 text-sm text-ink-2">
                    <input
                      type="checkbox"
                      name="sansGluten"
                      checked={brouillon.sansGluten}
                      onChange={(evenement) =>
                        modifierChamp('sansGluten', evenement.target.checked)
                      }
                    />
                    Sans gluten
                  </label>
                </div>

                <ChampTexte
                  nom="nom"
                  libelle="Nom de la recette"
                  valeur={brouillon.nom}
                  onChange={(v) => modifierChamp('nom', v)}
                  erreur={champsEnErreur['nom']}
                  obligatoire
                />

                <div className="grid grid-cols-2 gap-groupe">
                  <ChampTexte
                    nom="rendementReferenceMl"
                    libelle="Fournée de référence (ml)"
                    valeur={brouillon.rendementReferenceMl}
                    onChange={(v) => modifierChamp('rendementReferenceMl', v)}
                    erreur={champsEnErreur['rendementReferenceMl']}
                    numerique="entier"
                  />
                  <ChampTexte
                    nom="rendementReferenceCrepes"
                    libelle="Crêpes obtenues"
                    valeur={brouillon.rendementReferenceCrepes}
                    onChange={(v) => modifierChamp('rendementReferenceCrepes', v)}
                    erreur={champsEnErreur['rendementReferenceCrepes']}
                    numerique="entier"
                    aide="Les quantités ci-dessous valent POUR cette fournée. Tout le reste s’en déduit par mise à l’échelle."
                  />
                </div>

                <div className="grid grid-cols-3 gap-groupe">
                  <ChampTexte
                    nom="perteCuissonBp"
                    libelle="Perte cuisson (bp)"
                    valeur={brouillon.perteCuissonBp}
                    onChange={(v) => modifierChamp('perteCuissonBp', v)}
                    erreur={champsEnErreur['perteCuissonBp']}
                    numerique="entier"
                    aide={aidePointsDeBase(brouillon.perteCuissonBp)}
                  />
                  <ChampTexte
                    nom="tauxCasseBp"
                    libelle="Taux de casse (bp)"
                    valeur={brouillon.tauxCasseBp}
                    onChange={(v) => modifierChamp('tauxCasseBp', v)}
                    erreur={champsEnErreur['tauxCasseBp']}
                    numerique="entier"
                    aide={aidePointsDeBase(brouillon.tauxCasseBp)}
                  />
                  <ChampTexte
                    nom="perteFixeMl"
                    libelle="Perte fixe (ml)"
                    valeur={brouillon.perteFixeMl}
                    onChange={(v) => modifierChamp('perteFixeMl', v)}
                    erreur={champsEnErreur['perteFixeMl']}
                    numerique="entier"
                    aide="Fond de bassine, louche : ce qui ne se cuit jamais."
                  />
                </div>

                {/* ═══ Composition ═════════════════════════════════════ */}
                <fieldset className="flex flex-col gap-groupe border-t border-line pt-3">
                  <legend className="text-2xs uppercase text-ink-3">
                    Composition de la fournée
                  </legend>

                  {brouillon.lignes.length === 0 && (
                    <p className="text-sm text-ink-3">
                      Aucun ingrédient. Une recette vide ne peut être ni mise à l’échelle, ni
                      activée, ni chiffrée.
                    </p>
                  )}

                  {brouillon.lignes.map((ligne, index) => {
                    const ingredient = ingredients.find((i) => i.id === ligne.ingredientId);
                    return (
                      <div key={ligne.cle} className="flex flex-col gap-groupe">
                        <div className="flex items-start gap-groupe">
                          <div className="flex-1">
                            <select
                              name={`lignes.${index}.ingredientId`}
                              aria-label={`Ingrédient de la ligne ${index + 1}`}
                              className={`h-controle w-full rounded-sm border bg-surface px-2 text-sm text-ink ${
                                champsEnErreur[`lignes.${index}.ingredientId`] === undefined
                                  ? 'border-line-field'
                                  : 'border-depassement'
                              }`}
                              value={ligne.ingredientId}
                              onChange={(evenement) => {
                                const valeur = evenement.target.value;
                                // Fiche 09 : l'ingrédient cherché n'existe pas
                                // encore — ouvrir sa création SANS quitter cet
                                // écran, plutôt que d'assigner cette valeur
                                // sentinelle comme si c'était un identifiant réel.
                                if (valeur === OPTION_CREER_INGREDIENT) {
                                  ouvrirCreationIngredient(index);
                                  return;
                                }
                                modifierLigne(index, 'ingredientId', valeur);
                              }}
                            >
                              <option value="">Choisir un ingrédient…</option>
                              {ingredientsPourLigne(ligne).map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.nom}
                                </option>
                              ))}
                              <option value={OPTION_CREER_INGREDIENT}>
                                + Créer un nouvel ingrédient…
                              </option>
                            </select>
                            {champsEnErreur[`lignes.${index}.ingredientId`] !== undefined && (
                              <span className="text-xs text-depassement">
                                {champsEnErreur[`lignes.${index}.ingredientId`]}
                              </span>
                            )}
                            {/*
                             * Un ingrédient SANS conditionnement actif n'a pas de
                             * coût NUL, il a un coût INCONNU — et c'est bien ce
                             * que le produit fait désormais : `previsualisation`
                             * transmet `ingredient.coutUnitaireCents` tel quel,
                             * `null` compris (voir `cumpCentsParUnite` plus haut),
                             * `mettreAEchelle` rend alors `coutMatiereCents: null`
                             * et le panneau « Coût recalculé en direct » juste en
                             * dessous écrit « Coût inconnu : prix manquant sur … »
                             * (`messageCoutInconnu`). Le `?? 0` que décrivait ce
                             * commentaire a disparu côté serveur le 29/07/2026 et
                             * côté écran avec lui.
                             *
                             * LE TEXTE, LUI, ÉTAIT RESTÉ À L'ANCIEN COMPORTEMENT
                             * (corrigé le 01/08/2026). Il annonçait « son coût est
                             * compté comme 0 € », à trois centimètres d'un panneau
                             * qui affichait simultanément « Coût inconnu » : deux
                             * messages contradictoires, dont le premier était
                             * exactement le mensonge que la doctrine « inconnu ≠
                             * zéro » interdit — un porteur qui le lisait pouvait
                             * conclure que sa marge était surestimée de la valeur
                             * de l'ingrédient, alors qu'elle n'est simplement pas
                             * calculée.
                             *
                             * L'avertissement reste utile et reste ici : c'est le
                             * chemin emprunté par la création rapide d'ingrédient
                             * (fiche 09) juste au-dessus, qui ne crée jamais de
                             * conditionnement. Il nomme la ligne fautive, là où le
                             * panneau du dessous ne nomme que le total.
                             */}
                            {ingredient !== undefined && ingredient.nbConditionnements === 0 && (
                              <span className="text-xs text-alerte">
                                Aucun prix connu pour « {ingredient.nom} » : le coût de cette
                                recette restera inconnu, et non nul, tant qu’aucun conditionnement
                                ne lui est associé (écran Ingrédients).
                              </span>
                            )}
                          </div>
                          <div className="w-32">
                            <input
                              name={`lignes.${index}.quantiteUniteRef`}
                              type="text"
                              inputMode="numeric"
                              aria-label={`Quantité de la ligne ${index + 1}${
                                ingredient === undefined
                                  ? ''
                                  : ` en ${libelleUnite(ingredient.uniteReference)}`
                              }`}
                              className={`num h-controle w-full rounded-sm border bg-surface px-2 text-base text-ink ${
                                champsEnErreur[`lignes.${index}.quantiteUniteRef`] === undefined
                                  ? 'border-line-field'
                                  : 'border-depassement'
                              }`}
                              value={ligne.quantite}
                              onChange={(evenement) =>
                                modifierLigne(index, 'quantite', evenement.target.value)
                              }
                            />
                            {champsEnErreur[`lignes.${index}.quantiteUniteRef`] !== undefined && (
                              <span className="text-xs text-depassement">
                                {champsEnErreur[`lignes.${index}.quantiteUniteRef`]}
                              </span>
                            )}
                          </div>
                          {/* L'unité vient de l'ingrédient choisi : elle n'est ni
                              saisie, ni devinée — une quantité sans unité affichée
                              est une quantité qu'on lit de travers. */}
                          <span className="flex h-controle items-center text-xs text-ink-3">
                            {ingredient === undefined
                              ? TIRET_ABSENT
                              : libelleUnite(ingredient.uniteReference)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              retirerLigne(index);
                              // La ligne (et son bouton) disparait du DOM :
                              // sans ce rappel, le focus retomberait sur
                              // `<body>` au milieu d'une composition a
                              // plusieurs ingredients.
                              window.setTimeout(() => boutonAjouterLigne.current?.focus(), 0);
                            }}
                            aria-label={`Retirer la ligne ${index + 1}`}
                            className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink-2 hover:bg-surface-sunken"
                          >
                            Retirer
                          </button>
                        </div>

                        {/*
                         * Note technique du GESTE (« beurre noisette, ne pas
                         * dépasser la coloration »), PAS un allergène — deux
                         * informations aux exigences différentes (CLAUDE.md
                         * §7). Facultative : une ligne sans note n'affirme
                         * rien de particulier sur le geste.
                         */}
                        <label className="flex items-center gap-groupe text-xs text-ink-3">
                          <span className="w-28 shrink-0">Note technique</span>
                          <input
                            name={`lignes.${index}.noteTechnique`}
                            type="text"
                            placeholder="Le geste, facultatif : « ne pas dépasser la coloration »…"
                            aria-label={`Note technique de la ligne ${index + 1}`}
                            className="h-controle flex-1 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                            value={ligne.noteTechnique}
                            onChange={(evenement) =>
                              modifierLigne(index, 'noteTechnique', evenement.target.value)
                            }
                          />
                        </label>

                        {/* ═══ Fiche 09 : création d'ingrédient à la volée ═══ */}
                        {creationIngredient !== null && creationIngredient.ligneIndex === index && (
                          <FormulaireIngredientRapide
                            etat={creationIngredient}
                            onChamp={modifierCreationIngredient}
                            onAllergene={basculerAllergeneCreation}
                            onAnnuler={fermerCreationIngredient}
                            onCreer={creerIngredientRapide}
                          />
                        )}
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    ref={boutonAjouterLigne}
                    onClick={ajouterLigne}
                    className={`${CLASSE_BOUTON_SECONDAIRE} self-start`}
                  >
                    Ajouter un ingrédient
                  </button>

                  {/* ═══ Coût recalculé EN DIRECT, avant tout enregistrement ═══ */}
                  <div className="flex flex-col gap-groupe border-t border-line pt-3">
                    <h4 className="text-2xs uppercase text-ink-3">Coût recalculé en direct</h4>
                    {previsualisation.statut === 'indisponible' ? (
                      <p className="text-sm text-ink-3">{previsualisation.message}</p>
                    ) : (
                      <>
                        <p className="flex items-baseline justify-between text-sm">
                          <span className="text-ink-2">Coût matière (fournée)</span>
                          <span className="num text-ink">
                            {previsualisation.coutMatiereCents === null ? (
                              <span className="text-alerte">
                                {messageCoutInconnu(previsualisation.ingredientsSansPrix)}
                              </span>
                            ) : (
                              formaterEuros(previsualisation.coutMatiereCents)
                            )}
                          </span>
                        </p>
                        <p className="flex items-baseline justify-between text-sm font-semibold">
                          <span className="text-ink">Coût par crêpe</span>
                          <span className="num text-ink">
                            {ouTiret(previsualisation.coutParCrepeCents, (c) =>
                              formaterEuros(Math.round(c)),
                            )}
                          </span>
                        </p>
                        <p className="text-sm text-ink-2">
                          Allergènes :{' '}
                          <AllergenesRecalcules
                            verifies={previsualisation.allergenesVerifies}
                            allergenes={previsualisation.allergenes}
                          />
                        </p>
                      </>
                    )}
                  </div>
                </fieldset>

                <ChampZoneTexte
                  nom="procede"
                  libelle="Procédé"
                  valeur={brouillon.procede}
                  onChange={(v) => modifierChamp('procede', v)}
                  erreur={champsEnErreur['procede']}
                />
                <ChampZoneTexte
                  nom="notes"
                  libelle="Notes"
                  valeur={brouillon.notes}
                  onChange={(v) => modifierChamp('notes', v)}
                  erreur={champsEnErreur['notes']}
                />

                {champsEnErreur['_global'] !== undefined && (
                  <div
                    role="alert"
                    className="border-l-2 border-depassement bg-depassement-bg px-3 py-2 text-sm text-depassement"
                  >
                    {champsEnErreur['_global']}
                  </div>
                )}

                {erreurFormulaire !== null && <MessageErreur message={erreurFormulaire} />}

                <div className="flex items-center justify-end gap-groupe border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setModeFiche({ mode: 'consultation' });
                      reinitialiserMessages();
                      requestAnimationFrame(() => boutonNouvelleRecette.current?.focus());
                    }}
                    className={CLASSE_BOUTON_SECONDAIRE}
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={envoi === 'envoi'}
                    className={CLASSE_BOUTON_PRIMAIRE}
                  >
                    {modeFiche.mode === 'creation'
                      ? 'Créer la recette'
                      : modeFiche.intention === 'version'
                        ? 'Créer la version'
                        : 'Enregistrer les modifications'}
                  </button>
                </div>
              </form>
            </Panneau>
          )}
        </div>

        {/* ═══ Colonne droite : le calculateur permanent ═════════════════ */}
        <div className="flex flex-col gap-bloc">
          <Panneau titre="Calculateur">
            {recetteActive === null ? (
              <EtatVide
                variante="normal"
                texte="Sélectionnez une recette dans la liste pour utiliser le calculateur."
              />
            ) : recetteActive.lignes.length === 0 ? (
              <EtatVide
                variante="normal"
                texte="Le calculateur sera disponible dès que cette recette contiendra au moins un ingrédient."
              />
            ) : (
              <div className="flex flex-col gap-bloc">
                <fieldset className="flex flex-col gap-groupe">
                  <legend className="text-2xs uppercase text-ink-3">Calculer pour…</legend>
                  <label className="flex items-center gap-groupe text-sm text-ink-2">
                    <input
                      type="radio"
                      name="cible-calcul"
                      checked={calculateur.typeCible === 'crepes'}
                      onChange={() => choisirCible(recetteActive, 'crepes')}
                    />
                    Un nombre de crêpes
                  </label>
                  <label className="flex items-center gap-groupe text-sm text-ink-2">
                    <input
                      type="radio"
                      name="cible-calcul"
                      checked={calculateur.typeCible === 'volume'}
                      onChange={() => choisirCible(recetteActive, 'volume')}
                    />
                    Un volume de pâte
                  </label>
                  <label className="flex items-center gap-groupe text-sm text-ink-2">
                    <input
                      type="radio"
                      name="cible-calcul"
                      checked={calculateur.typeCible === 'ingredient'}
                      onChange={() => choisirCible(recetteActive, 'ingredient')}
                    />
                    Tout mon stock d&apos;un ingrédient
                  </label>
                </fieldset>

                {calculateur.typeCible === 'ingredient' && (
                  <label className="flex flex-col gap-groupe text-sm text-ink-2">
                    Ingrédient
                    <select
                      className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                      value={calculateur.ingredientId ?? ''}
                      onChange={(evenement) =>
                        choisirIngredient(recetteActive, evenement.target.value)
                      }
                    >
                      {recetteActive.lignes.map((ligne) => (
                        <option key={ligne.ingredientId} value={ligne.ingredientId}>
                          {ligne.nomIngredient}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label
                  className="flex flex-col gap-groupe text-sm text-ink-2"
                  htmlFor="calculateur-valeur"
                >
                  {libelleChampValeur(
                    calculateur.typeCible,
                    recetteActive,
                    calculateur.ingredientId,
                  )}
                  <input
                    id="calculateur-valeur"
                    type="text"
                    inputMode="numeric"
                    className="num h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                    value={calculateur.valeurSaisie}
                    onChange={(evenement) =>
                      setCalculateur((precedent) => ({
                        ...precedent,
                        valeurSaisie: evenement.target.value,
                      }))
                    }
                    aria-invalid={erreurValeur !== null}
                    aria-describedby={
                      erreurValeur !== null ? 'calculateur-valeur-erreur' : undefined
                    }
                  />
                </label>
                {erreurValeur !== null && (
                  <p id="calculateur-valeur-erreur" className="text-sm text-depassement">
                    {erreurValeur}
                  </p>
                )}

                {etatCalcul !== null && etatCalcul.statut === 'erreur' && (
                  <MessageErreur message={etatCalcul.message} />
                )}

                {etatCalcul !== null && etatCalcul.statut === 'pret' && (
                  <>
                    <Tableau
                      colonnes={COLONNES_CALCUL}
                      lignes={etatCalcul.resultat.lignes}
                      cleLigne={(l) => l.ingredientId}
                      etatVide={<EtatVide variante="normal" texte="Aucun ingrédient à afficher." />}
                    />
                    <div className="flex flex-col gap-groupe border-t border-line pt-3">
                      <p className="flex items-baseline justify-between text-sm">
                        <span className="text-ink-2">Crêpes vendables</span>
                        <span className="num text-ink">
                          {formaterCrepes(etatCalcul.resultat.crepesVendables)}
                        </span>
                      </p>
                      <p className="flex items-baseline justify-between text-sm">
                        <span className="text-ink-2">Coût matière</span>
                        <span className="num text-ink">
                          {etatCalcul.resultat.coutMatiereCents === null ? (
                            <span className="text-alerte">
                              {messageCoutInconnu(
                                etatCalcul.resultat.lignes
                                  .filter((l) => l.cumpCentsParUnite === null)
                                  .map((l) => l.nomIngredient),
                              )}
                            </span>
                          ) : (
                            formaterEuros(etatCalcul.resultat.coutMatiereCents)
                          )}
                        </span>
                      </p>
                      <p className="flex items-baseline justify-between text-sm font-semibold">
                        <span className="text-ink">Coût par crêpe</span>
                        <span className="num text-ink">
                          {ouTiret(etatCalcul.resultat.coutParCrepeCents, (c) =>
                            formaterEuros(Math.round(c)),
                          )}
                        </span>
                      </p>
                      <p className="text-sm text-ink-2">
                        Allergènes :{' '}
                        <AllergenesRecalcules
                          verifies={allergenesVerifiesDuCalcul(
                            etatCalcul.resultat.lignes,
                            ingredients,
                          )}
                          allergenes={etatCalcul.resultat.allergenes}
                        />
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </Panneau>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Sous-composants locaux
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Rappel en clair de ce que valent les points de base saisis.
 *
 * Les pertes sont stockées en bp (10 000 = 100 %, CLAUDE.md §3) pour ne jamais
 * porter un taux en flottant. C'est juste, et illisible : « 1 200 » ne dit pas
 * « 12 % ». Le formatage vient de `@batte/core`, aucun calcul ici.
 */
function aidePointsDeBase(saisie: string): string {
  const valeur = nombreSaisi(saisie);
  if (valeur === null || !Number.isFinite(valeur)) return '10 000 = 100 %';
  return `soit ${formaterPointsDeBase(valeur)}`;
}

/**
 * Distingue « jamais vérifié » (l'absence d'allergène n'est pas confirmée,
 * jamais assimilable à « pas d'allergène ») de « vérifié, aucun allergène »
 * (l'affirmation d'absence est alors légitime) — le même tiret masquait les
 * deux cas sur les deux panneaux de calcul en direct de cet écran avant cette
 * correction (audit allergènes du 31/07/2026, docs/30-AUDIT-ALLERGENES.md
 * §2.2). Même vocabulaire que les trois documents imprimés
 * (`apps/api/src/documents/gabarits.ts`), pour ne pas inventer un troisième
 * jeu de mots sur la même information.
 *
 * `text-alerte`, pas une nouvelle couleur : le même jeton que
 * `messageCoutInconnu` utilise déjà sur ce panneau pour « information
 * manquante » (docs/07 §4.8 : aucun glyphe ni couleur nouvelle).
 *
 * `libelleAllergene` traduit chaque CODE (`gluten`) en libellé réglementaire
 * (« Céréales contenant du gluten ») — sans elle, ce composant affichait le
 * code brut, alors que les trois documents imprimés appellent déjà
 * systématiquement `libelleAllergene` pour la même liste (même audit,
 * §2.2 : « affiche en plus le code brut… contrairement aux trois documents
 * imprimés »). Réutilisé tel quel par la colonne « Allergènes » de la fiche
 * technique (`COLONNES_LIGNES_REFERENCE` plus haut), pas seulement par ces
 * deux panneaux : un seul endroit qui sait traduire un code, quel que soit
 * l'appelant.
 */
export function texteAllergenesRecalcules(
  verifies: boolean,
  allergenes: readonly string[],
): string {
  if (!verifies) return 'non vérifié';
  return allergenes.length > 0
    ? allergenes.map(libelleAllergene).join(' · ')
    : 'Aucun allergène déclaré';
}

function AllergenesRecalcules({
  verifies,
  allergenes,
}: {
  readonly verifies: boolean;
  readonly allergenes: readonly string[];
}) {
  const texte = texteAllergenesRecalcules(verifies, allergenes);
  return verifies ? <>{texte}</> : <span className="text-alerte">{texte}</span>;
}

function ChampZoneTexte({
  nom,
  libelle,
  valeur,
  onChange,
  erreur,
}: {
  nom: string;
  libelle: string;
  valeur: string;
  onChange: (valeur: string) => void;
  erreur?: string | undefined;
}) {
  const idErreur = `${nom}-erreur`;
  return (
    <label className="flex flex-col gap-groupe text-sm text-ink-2">
      {libelle}
      <textarea
        name={nom}
        rows={3}
        className={`rounded-sm border bg-surface px-2 py-1 text-sm text-ink ${
          erreur === undefined ? 'border-line-field' : 'border-depassement'
        }`}
        value={valeur}
        onChange={(evenement) => onChange(evenement.target.value)}
        aria-invalid={erreur !== undefined}
        {...(erreur === undefined ? {} : { 'aria-describedby': idErreur })}
      />
      {erreur !== undefined && (
        <span id={idErreur} className="text-xs text-depassement">
          {erreur}
        </span>
      )}
    </label>
  );
}

/**
 * Mini-formulaire de création d'ingrédient « à la volée » (fiche 09).
 *
 * Volontairement PLUS COURT que l'écran Ingrédients complet : nom, catégorie,
 * unité, densité si pertinente, allergènes — ce qu'il faut pour que la ligne
 * de recette soit immédiatement chiffrable et que l'allergène soit déclaré.
 * Le stock de sécurité (0), le délai de livraison et la durée de conservation
 * partent vides ; l'association fournisseur/conditionnement — donc LE PRIX —
 * se fait ensuite depuis l'écran Ingrédients, qui la porte déjà : cette
 * fiche-là n'a pas à la dupliquer pour rester lisible en une saisie.
 */
function FormulaireIngredientRapide({
  etat,
  onChamp,
  onAllergene,
  onAnnuler,
  onCreer,
}: {
  etat: EtatCreationIngredient;
  onChamp: <C extends keyof BrouillonIngredientRapide>(
    champ: C,
    valeur: BrouillonIngredientRapide[C],
  ) => void;
  onAllergene: (code: string, coche: boolean) => void;
  onAnnuler: () => void;
  onCreer: () => void;
}) {
  const { brouillon, champsEnErreur, erreur, envoi } = etat;

  return (
    // DÉFAUT MESURÉ (recette clavier du 30/07/2026, reproduit au navigateur
    // en direct pendant la vérification du point 2 de cette mission) : ce
    // mini-formulaire était un second `<form>`, imbriqué dans le `<form>` de
    // la recette (`formulaireRef` plus haut) — un `<form>` ne peut pas en
    // contenir un autre. Sous rendu client (pas de HTML parsé), le DOM
    // contenait donc réellement deux `<form>` emboîtés, et cliquer sur
    // « Créer et utiliser dans cette ligne » déclenchait une VRAIE soumission
    // native du formulaire le plus proche (GET, avec les champs de CE
    // mini-formulaire en paramètres d'URL) au lieu du gestionnaire React —
    // `evenement.preventDefault()` de l'ancien `onSubmit` n'empêchait rien.
    // Conséquence réelle observée : rechargement complet de la page, recette
    // en cours de saisie perdue en entier. Un `<div>` plus `onKeyDown` sur
    // Entrée reproduit le confort clavier d'un formulaire sans l'imbrication
    // invalide.
    <div
      onKeyDown={(evenement) => {
        if (evenement.key !== 'Enter') return;
        // Aucun `<textarea>` dans ce mini-formulaire : Entrée ne doit jamais
        // sauter une ligne, elle déclenche toujours la création.
        evenement.preventDefault();
        onCreer();
      }}
      className="flex flex-col gap-groupe border border-line-field bg-surface-sunken p-3"
    >
      <h4 className="text-2xs uppercase text-ink-3">Nouvel ingrédient</h4>

      <ChampTexte
        nom="ingredient-rapide-nom"
        libelle="Nom"
        valeur={brouillon.nom}
        onChange={(v) => onChamp('nom', v)}
        erreur={champsEnErreur['nom']}
        obligatoire
      />

      <div className="grid grid-cols-2 gap-groupe">
        <label className="flex flex-col gap-groupe text-sm text-ink-2">
          Catégorie
          <select
            className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
            value={brouillon.categorie}
            onChange={(evenement) =>
              onChamp('categorie', evenement.target.value as CategorieIngredient)
            }
          >
            {schemaCategorieIngredient.options.map((code) => (
              <option key={code} value={code}>
                {LIBELLE_CATEGORIE_INGREDIENT[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-groupe text-sm text-ink-2">
          Unité de compte
          <select
            className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
            value={brouillon.uniteReference}
            onChange={(evenement) => onChamp('uniteReference', evenement.target.value as Unite)}
          >
            {(['g', 'ml', 'piece'] as const).map((unite) => (
              <option key={unite} value={unite}>
                {libelleUnite(unite)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Une quantité en pièces ne se convertit ni en masse ni en volume : une
          densité posée dessus ne serait jamais lue (même règle que l'écran
          Ingrédients et que `verifierCoherenceIngredient`, core/contrats). */}
      {brouillon.uniteReference !== 'piece' && (
        <ChampTexte
          nom="ingredient-rapide-densite"
          libelle="Densité (g/ml)"
          valeur={brouillon.densite}
          onChange={(v) => onChamp('densite', v)}
          erreur={champsEnErreur['densiteGParMl']}
          numerique="decimal"
          aide="Laissez vide si aucune conversion masse ↔ volume n’est nécessaire."
        />
      )}

      <fieldset className="flex flex-col gap-groupe">
        <legend className="text-2xs uppercase text-ink-3">Allergènes déclarés</legend>
        <div className="grid grid-cols-2 gap-x-groupe">
          {CATALOGUE_ALLERGENES.map((allergene) => (
            <label key={allergene.code} className="flex items-center gap-groupe text-xs text-ink-2">
              <input
                type="checkbox"
                checked={brouillon.allergenes.includes(allergene.code)}
                onChange={(evenement) => onAllergene(allergene.code, evenement.target.checked)}
              />
              {allergene.libelle}
            </label>
          ))}
        </div>
      </fieldset>

      {erreur !== null && <MessageErreur message={erreur} />}

      <p className="text-xs text-ink-3">
        Le fournisseur et le conditionnement — donc le prix — se règlent ensuite depuis l’écran
        Ingrédients : cet ingrédient y apparaîtra immédiatement, actif, à quantité zéro dans l’écran
        Stock.
      </p>

      <div className="flex items-center justify-end gap-groupe">
        <button type="button" onClick={onAnnuler} className={CLASSE_BOUTON_SECONDAIRE}>
          Annuler
        </button>
        <button type="button" disabled={envoi} onClick={onCreer} className={CLASSE_BOUTON_PRIMAIRE}>
          Créer et utiliser dans cette ligne
        </button>
      </div>
    </div>
  );
}
