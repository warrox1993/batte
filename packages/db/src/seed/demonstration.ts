/**
 * REFERENTIEL de DEMONSTRATION (docs/01, exigences non fonctionnelles :
 * « jeu de donnees de demonstration installable, pour tester sans polluer les
 * donnees reelles »).
 *
 * Volontairement separe de `seed()`, qui ne contient que du reel (parametres
 * legaux, utilisateur). Ici tout ce qui n'est pas documente dans `CLAUDE.md` §6
 * est FICTIF et le dit dans son libelle : aucun nom de fournisseur reel n'est
 * invente, aucun prix reel n'est suppose.
 *
 * Ce qui est REEL et provient de `CLAUDE.md` §6 :
 *   - la composition de R1 pour 6 crepes ;
 *   - le rendement de R1 et R2 (76 ml/crepe, decision D-014) ;
 *   - les deux NATURES de produit vendu, transforme et revendu, et leurs
 *     ordres de marge (≈ 90 % contre 30–40 %).
 * Ce qui est FICTIF : les fournisseurs, les prix, les densites usuelles.
 * Ce qui est ABSENT parce que non documente : la composition de R2, qui reste
 * en brouillon a completer par l'utilisateur.
 *
 * Ce module ne cree QUE du referentiel — ce qui existe avant toute exploitation.
 * L'historique d'exploitation (receptions, production, session close) vit dans
 * `activite.ts` : separation classique en ERP entre donnees de base et
 * mouvements, et surtout garantie que les quinze fichiers de test qui utilisent
 * ce referentiel comme decor ne se retrouvent pas avec du stock et des ventes
 * qu'ils n'ont pas demandes. `npm run db:seed:demo` execute les DEUX.
 */

import {
  jourCivilBelge,
  maintenantUtc,
  nouvelIdentifiant,
  type ConsommationUnite,
} from '@batte/core';
import { and, eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { estModulePrincipal } from '../module-principal.js';
import { allouerNumero } from '../depots/numerotation.js';
import { creerComposantVente } from '../depots/nomenclature-vente.js';
import {
  conditionnement,
  fournisseur,
  ingredient,
  lieuMarche,
  produitGarniture,
  produitVente,
  produitVenteComposant,
  recette,
  recetteLigne,
  sessionMarche,
} from '../schema.js';
import { seedDemonstrationActivite, type ResultatSeedActivite } from './activite.js';
// Concurrents de démonstration (fiche 08) : les deux vendeurs de crêpes déjà
// repérés à La Batte, avec leur historique de prix et une observation
// qualitative chacun. Rattaché ici et non dans `activite.ts` : une fiche
// concurrent est du RÉFÉRENTIEL (elle ne dépend d'aucune réception ni
// production), même famille que `seedLieu` juste au-dessus.
import { seedConcurrentsDemonstration } from './concurrents.js';

const PREFIXE_DEMO = '[démo] ';

/* ═══════════════════════════════════════════════════════════════════════════
   Fournisseurs
   ═══════════════════════════════════════════════════════════════════════════ */

/** Cle interne, jamais stockee : elle relie les definitions entre elles. */
type CleFournisseur = 'grossiste' | 'terroir';

type DefinitionFournisseur = {
  readonly cle: CleFournisseur;
  readonly nom: string;
  readonly type: 'moulin' | 'grossiste' | 'ferme' | 'detail';
  readonly delaiLivraisonJours: number;
  readonly notes: string;
};

/**
 * DEUX fournisseurs, et non un seul : la matiere premiere transformee et
 * l'article revendu ne viennent jamais du meme circuit. Un seul fournisseur
 * generique rendait invisible le fait qu'une commande de reapprovisionnement se
 * groupe PAR fournisseur.
 *
 * Aucun nom, aucune adresse, aucune adresse e-mail d'entreprise existante :
 * ces libelles sont des marque-places prefixes `[démo]`.
 */
const FOURNISSEURS: readonly DefinitionFournisseur[] = [
  {
    cle: 'grossiste',
    nom: `${PREFIXE_DEMO}Fournisseur générique`,
    type: 'grossiste',
    delaiLivraisonJours: 3,
    notes:
      'Fournisseur fictif du jeu de démonstration. Remplacez-le par vos vrais fournisseurs ; ' +
      'les prix ci-dessous sont des ordres de grandeur, pas des tarifs négociés.',
  },
  {
    cle: 'terroir',
    nom: `${PREFIXE_DEMO}Producteur local (terroir)`,
    type: 'ferme',
    delaiLivraisonJours: 7,
    notes:
      'Fournisseur fictif du jeu de démonstration : le circuit des produits REVENDUS ' +
      "(achetés préemballés, revendus tels quels). Il est distinct du grossiste parce qu'une " +
      'commande de réapprovisionnement se groupe par fournisseur.',
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   Ingredients et conditionnements
   ═══════════════════════════════════════════════════════════════════════════ */

type DefinitionIngredient = {
  readonly cle: string;
  readonly nom: string;
  readonly categorie:
    | 'farine'
    | 'laitier'
    | 'oeuf'
    | 'sucre'
    | 'garniture'
    | 'consommable'
    | 'gaz'
    // Ajoutees le 31/07/2026 (fiche 15 §2.3 et §4.1) : cafe moulu, chicoree,
    // cannelle et eau n'avaient aucun classement honnete (`boisson`) avant
    // l'ajout de ces categories a `schemaCategorieIngredient`
    // (packages/core/src/contrats/referentiel.ts) ; le sel fin et l'eau de
    // fleur d'oranger, eux, etaient a tort ranges en `consommable` — faite
    // pour le NON alimentaire — faute d'une categorie juste (`aromate`).
    | 'boisson'
    | 'aromate';
  readonly unite: 'g' | 'ml' | 'piece';
  readonly densiteGParMl: number | null;
  readonly allergenes: string[];
  readonly fournisseur: CleFournisseur;
  /** `null` = duree inconnue : la DLC sera saisie a la reception, pas deduite. */
  readonly dureeConservationJours: number | null;
  /** Conditionnement fictif : libelle, quantite en unite de reference, prix en centimes. */
  readonly conditionnement: { libelle: string; quantite: number; prixCents: number };
};

/**
 * Densites usuelles, arrondies. Elles ne sont utilisees que par la conversion
 * masse<->volume et restent modifiables : ce sont des valeurs de depart, pas des
 * mesures faites sur les produits reellement achetes.
 */
const INGREDIENTS: readonly DefinitionIngredient[] = [
  {
    cle: 'farine-t55',
    nom: 'Farine de froment T55',
    categorie: 'farine',
    unite: 'g',
    densiteGParMl: 0.55,
    allergenes: ['gluten'],
    fournisseur: 'grossiste',
    dureeConservationJours: null,
    conditionnement: { libelle: 'Sac 25 kg', quantite: 25_000, prixCents: 1875 },
  },
  {
    cle: 'lait-entier',
    nom: 'Lait entier',
    categorie: 'laitier',
    unite: 'ml',
    densiteGParMl: 1.03,
    allergenes: ['lait'],
    fournisseur: 'grossiste',
    dureeConservationJours: null,
    conditionnement: { libelle: 'Brique 1 L', quantite: 1000, prixCents: 115 },
  },
  {
    cle: 'oeuf',
    nom: 'Œufs entiers',
    categorie: 'oeuf',
    unite: 'piece',
    densiteGParMl: null,
    allergenes: ['oeufs'],
    fournisseur: 'grossiste',
    dureeConservationJours: null,
    conditionnement: { libelle: 'Plaque 30 pièces', quantite: 30, prixCents: 600 },
  },
  {
    cle: 'beurre',
    nom: 'Beurre',
    categorie: 'laitier',
    unite: 'g',
    densiteGParMl: 0.91,
    allergenes: ['lait'],
    fournisseur: 'grossiste',
    dureeConservationJours: null,
    conditionnement: { libelle: 'Plaquette 500 g', quantite: 500, prixCents: 450 },
  },
  {
    cle: 'vergeoise',
    nom: 'Vergeoise blonde',
    categorie: 'sucre',
    unite: 'g',
    densiteGParMl: 0.8,
    allergenes: [],
    fournisseur: 'grossiste',
    dureeConservationJours: null,
    conditionnement: { libelle: 'Paquet 1 kg', quantite: 1000, prixCents: 320 },
  },
  {
    cle: 'sel',
    nom: 'Sel fin',
    // `aromate` depuis le 31/07/2026 : `consommable` est faite pour le NON
    // alimentaire (gobelet, serviette, assiette). Un sel range avec les gobelets
    // rendait le filtre inutile pour distinguer ce qui se mange.
    categorie: 'aromate',
    unite: 'g',
    densiteGParMl: 1.2,
    allergenes: [],
    fournisseur: 'grossiste',
    dureeConservationJours: null,
    conditionnement: { libelle: 'Paquet 1 kg', quantite: 1000, prixCents: 90 },
  },
  {
    cle: 'sucre-vanille',
    nom: 'Sucre vanillé',
    categorie: 'sucre',
    unite: 'g',
    densiteGParMl: 0.85,
    allergenes: [],
    fournisseur: 'grossiste',
    dureeConservationJours: null,
    conditionnement: { libelle: 'Boîte 10 sachets (7,5 g)', quantite: 75, prixCents: 130 },
  },
  {
    cle: 'fleur-oranger',
    nom: "Eau de fleur d'oranger",
    // `aromate` depuis le 31/07/2026 : elle parfume la pate R1, elle n'est ni un
    // contenant ni une boisson. Elle etait `consommable` faute de categorie
    // juste — c'est le trou que la fiche 15 §2.3 signalait.
    categorie: 'aromate',
    unite: 'ml',
    densiteGParMl: 1.0,
    allergenes: [],
    fournisseur: 'grossiste',
    dureeConservationJours: null,
    conditionnement: { libelle: 'Flacon 250 ml', quantite: 250, prixCents: 290 },
  },
  /**
   * L'article REVENDU. `CLAUDE.md` §6 : « produit du terroir acheté préemballé
   * et revendu tel quel (sirop, confiture) ». Le sirop de Liège est le produit
   * emblematique du marche de La Batte.
   *
   * Unite `piece` et densite nulle : un pot ne se pese pas, il se compte —
   * c'est la difference de mecanique de stock entre revendu et transforme.
   *
   * Prix d'achat 4,80 € le pot (5 760 c le carton de 12), prix de vente 7,50 € :
   * marge de 36 %, dans la fourchette 30–40 % de `CLAUDE.md` §6. Ces deux prix
   * sont FICTIFS et n'engagent aucun fournisseur reel.
   */
  {
    cle: 'sirop-liege',
    nom: 'Sirop de Liège (pot 450 g)',
    categorie: 'garniture',
    unite: 'piece',
    densiteGParMl: null,
    allergenes: [],
    fournisseur: 'terroir',
    // Duree de conservation declaree : la DLC du lot en sera DEDUITE a la
    // reception, au lieu d'etre saisie a la main. Valeur de demonstration,
    // a remplacer par celle imprimee sur le pot.
    dureeConservationJours: 365,
    conditionnement: { libelle: 'Carton de 12 pots', quantite: 12, prixCents: 5760 },
  },
  /**
   * La GARNITURE, distincte du pot revendu tel quel — et c'est le point.
   *
   * On n'etale pas des pots de detail sur une crepe : on achete du vrac, moins
   * cher au gramme, et c'est un ARTICLE DIFFERENT chez le meme fournisseur.
   * Deux consequences que la demonstration doit rendre visibles :
   *   - l'unite change (`g` et non `piece`) : une garniture se pese, un pot se
   *     compte, et `produit_garniture.quantite_unite_ref` est un entier — on ne
   *     peut pas etaler « 0,05 pot » ;
   *   - le stock des deux articles se suit separement, donc leurs points de
   *     commande aussi.
   *
   * Prix FICTIF : 22,00 € le seau de 2,5 kg, soit 0,88 c/g contre 1,07 c/g au
   * detail. Ordre de grandeur, pas un tarif negocie.
   */
  {
    cle: 'sirop-liege-vrac',
    nom: 'Sirop de Liège en vrac (seau 2,5 kg)',
    categorie: 'garniture',
    unite: 'g',
    densiteGParMl: 1.4,
    allergenes: [],
    fournisseur: 'terroir',
    dureeConservationJours: 365,
    conditionnement: { libelle: 'Seau 2,5 kg', quantite: 2500, prixCents: 2200 },
  },

  /**
   * LE CAFÉ (fiche 15 §4) : sept ingrédients pour un exemple complet.
   *
   * Cinq entrent dans la tasse (café, chicorée, sucre, eau, cannelle), un est
   * le contenant (gobelet), un est une OPTION laitière (crème — le lait et le
   * beurre, eux, existent déjà ci-dessus et sont réutilisés tels quels). Tous
   * `'boisson'` sauf le sucre (catégorie `'sucre'`, qui existe déjà) et le
   * gobelet (`'consommable'`, un contenant n'est pas une boisson) et la crème
   * (`'laitier'`, comme le lait et le beurre).
   *
   * Prix FICTIFS, ordres de grandeur seulement — aucun tarif fournisseur réel.
   */
  {
    cle: 'cafe-moulu',
    nom: 'Café moulu',
    categorie: 'boisson',
    unite: 'g',
    densiteGParMl: null,
    allergenes: [],
    fournisseur: 'grossiste',
    dureeConservationJours: 270,
    conditionnement: { libelle: 'Paquet 1 kg', quantite: 1000, prixCents: 1400 },
  },
  {
    cle: 'chicoree',
    nom: 'Chicorée',
    categorie: 'boisson',
    unite: 'g',
    densiteGParMl: null,
    allergenes: [],
    fournisseur: 'grossiste',
    dureeConservationJours: 270,
    conditionnement: { libelle: 'Boîte 500 g', quantite: 500, prixCents: 350 },
  },
  {
    cle: 'sucre-poudre',
    nom: 'Sucre en poudre',
    categorie: 'sucre',
    unite: 'g',
    densiteGParMl: 0.85,
    allergenes: [],
    fournisseur: 'grossiste',
    dureeConservationJours: null,
    conditionnement: { libelle: 'Paquet 1 kg', quantite: 1000, prixCents: 180 },
  },
  {
    cle: 'eau',
    nom: 'Eau',
    categorie: 'boisson',
    unite: 'ml',
    densiteGParMl: 1.0,
    allergenes: [],
    fournisseur: 'grossiste',
    dureeConservationJours: null,
    // Transportée en jerrican (fiche 15 §4.2) : pas d'arrivée d'eau au stand.
    conditionnement: { libelle: 'Jerrican 5 L', quantite: 5000, prixCents: 80 },
  },
  /**
   * LA CANNELLE : le piège de la fiche 15 §4.1. À 0,2 g par tasse, une saisie
   * « pour 1 café » s'arrondirait à 0 g — coût nul, stock immobile. La
   * nomenclature de vente (plus bas, `COMPOSANTS_CAFE`) la déclare donc pour un
   * LOT DE RÉFÉRENCE de 100 cafés, jamais 1 pour 1.
   */
  {
    cle: 'cannelle',
    nom: 'Cannelle',
    // `aromate` et non `boisson` : elle parfume le cafe, mais aussi une crepe en
    // topping. C'est precisement l'ambiguite que le porteur avait acceptee le
    // matin du 31/07/2026 avec une categorie unique, et que la seconde
    // categorie leve le soir meme.
    categorie: 'aromate',
    unite: 'g',
    densiteGParMl: null,
    allergenes: [],
    fournisseur: 'grossiste',
    // Une épice moulue se conserve longtemps : durée volontairement plus
    // longue que les autres ingrédients de cette liste.
    dureeConservationJours: 730,
    conditionnement: { libelle: 'Boîte 250 g', quantite: 250, prixCents: 480 },
  },
  {
    cle: 'gobelet-carton',
    nom: 'Gobelet carton',
    categorie: 'consommable',
    unite: 'piece',
    densiteGParMl: null,
    allergenes: [],
    fournisseur: 'grossiste',
    dureeConservationJours: null,
    conditionnement: { libelle: 'Manchon de 50 gobelets', quantite: 50, prixCents: 650 },
  },
  /**
   * OPTION du café (fiche 15 §4.1bis) : la crème, servie sur demande. Le lait
   * et le beurre, les deux autres options citées par le porteur, réutilisent
   * les ingrédients `lait-entier` et `beurre` déjà déclarés ci-dessus — inutile
   * de les dupliquer, un même ingrédient peut très bien servir à la fois une
   * recette et une nomenclature de vente.
   */
  {
    cle: 'creme-liquide',
    nom: 'Crème liquide',
    categorie: 'laitier',
    unite: 'ml',
    densiteGParMl: 1.01,
    allergenes: ['lait'],
    fournisseur: 'grossiste',
    // DLC courte (produit laitier frais) : chaîne du froid PASSIVE au stand
    // (CLAUDE.md §6) — voir le rapport de livraison pour la remarque adressée
    // au porteur sur ce point.
    dureeConservationJours: 10,
    conditionnement: { libelle: 'Brique 25 cl', quantite: 250, prixCents: 145 },
  },
];

/**
 * R1 pour 6 crepes, exactement comme documente dans `CLAUDE.md` §6.
 * Le rendement de reference est 455 ml pour 6 crepes, soit ~76 ml/crepe : 5 L
 * donnent alors ~66 crepes, ce qu'annonce `CLAUDE.md` (decision D-014).
 * Un sachet de sucre vanille pese 7,5 g — arrondi a 8 g, l'unite etant le gramme.
 */
const LIGNES_R1: readonly { cle: string; quantite: number }[] = [
  { cle: 'farine-t55', quantite: 145 },
  { cle: 'lait-entier', quantite: 240 },
  { cle: 'oeuf', quantite: 2 },
  { cle: 'beurre', quantite: 55 },
  { cle: 'vergeoise', quantite: 23 },
  { cle: 'sel', quantite: 2 },
  { cle: 'sucre-vanille', quantite: 8 },
  { cle: 'fleur-oranger', quantite: 4 },
];

/* ═══════════════════════════════════════════════════════════════════════════
   Produits vendus
   ═══════════════════════════════════════════════════════════════════════════ */

type DefinitionProduit = {
  readonly nom: string;
  readonly nature: 'transforme' | 'revendu';
  /** Code de recette pour un transforme, `null` pour un revendu. */
  readonly recetteCode: string | null;
  /** Cle d'ingredient pour un revendu, `null` pour un transforme. */
  readonly ingredientCle: string | null;
  readonly prixCents: number;
  /**
   * Ce qu'UNE unite vendue consomme de la production (decision du porteur,
   * 31/07/2026, fiche 15 §4/§5.1) : `null` pour un revendu, la question ne se
   * pose pas.
   */
  readonly consommationUnite: ConsommationUnite | null;
  readonly nbCrepes: number | null;
  readonly categorie: string;
};

/**
 * Code de la recette VIDE rattachée au café (voir `seedRecettes` pour
 * pourquoi elle existe et pourquoi elle ne porte jamais de ligne). Exporté
 * pour que `demonstration.test.ts` puisse la retrouver sans recopier ce
 * libellé en dur.
 */
export const CODE_RECETTE_VIDE_CAFE = 'CAFE-VIDE';

/**
 * Prix fictifs. La distinction transforme / revendu est structurante et doit
 * exister DANS LES DONNEES des la demonstration : les seuils legaux portent sur
 * le CA, et la revente en genere ~2,6 fois plus a marge egale (`CLAUDE.md` §6).
 * Un catalogue 100 % transforme affiche une ventilation qui ne ventile rien et
 * cache a l'utilisateur le seul risque financier que la specification nomme.
 *
 * L'article revendu est declare EN DERNIER a dessein : plusieurs tests d'autres
 * paquets prennent « le premier produit » sans preciser sa nature. Les inserer
 * dans cet ordre leur laisse un produit transforme.
 */
const PRODUITS: readonly DefinitionProduit[] = [
  {
    nom: `${PREFIXE_DEMO}Crêpe froment / cassonade`,
    nature: 'transforme',
    recetteCode: 'R1',
    ingredientCle: null,
    prixCents: 300,
    consommationUnite: 'crepes',
    nbCrepes: 1,
    categorie: 'sucrée',
  },
  {
    nom: `${PREFIXE_DEMO}Crêpe froment / Sirop de Liège`,
    nature: 'transforme',
    recetteCode: 'R1',
    ingredientCle: null,
    prixCents: 350,
    consommationUnite: 'crepes',
    nbCrepes: 1,
    categorie: 'sucrée',
  },
  /**
   * LE CAFÉ (fiche 15 §4) : un TRANSFORMÉ À LA DEMANDE, pas un transformé PAR
   * LOT comme la crêpe. Il ne se produit pas par fournée la veille — il se
   * fait à la tasse — et sa composition vient ENTIÈREMENT de la nomenclature
   * de vente (`COMPOSANTS_CAFE` / `produit_vente_composant`, wiring plus bas
   * dans `seedComposantsVente`), jamais d'une recette de production.
   *
   * `recetteCode: CODE_RECETTE_VIDE_CAFE`, ET NON `null` (décision du porteur,
   * 31/07/2026) : `verifierCoherenceProduit`
   * (`packages/core/src/contrats/referentiel.ts`) exige qu'un `transforme`
   * porte une recette. Plutôt que d'assouplir cette règle ou d'ajouter une
   * quatrième nature de produit, le café reçoit une recette VOLONTAIREMENT
   * VIDE (aucune ligne, jamais activée — voir `seedRecettes`), dont le SEUL
   * rôle est de satisfaire ce rattachement.
   *
   * `consommationUnite: 'nomenclature'` (REFONTE DU 31/07/2026, décision du
   * porteur qui tranche le trou documenté ci-dessous) : ce champ NOMME
   * désormais le cas, là où il fallait auparavant le DÉDUIRE de `nbCrepes = 0`
   * — et cette déduction était fausse pour le café. `nbCrepes = 0` signifiait
   * à la fois « c'est de la pâte vendue au volume » (fiche 15 §5.1) et « ce
   * produit ne consomme aucune crêpe » (fiche 15 §4, le café) : la validation
   * ne pouvait pas distinguer les deux, et réclamait donc à tort un
   * `volumeMlParUnite` pour un café — rouvrir sa fiche dans l'écran Produits
   * et l'enregistrer SANS RIEN CHANGER échouait en 422 (voir le test dédié,
   * `demonstration.test.ts`, ex-`it.fails` converti par cette même décision).
   * `consommationUnite: 'nomenclature'` répond que le café ne consomme RIEN de
   * la production — ni crêpes ni volume de pâte, sa composition vit entière-
   * ment dans `produit_vente_composant` — et `estPateVendueAuVolume`
   * (`@batte/core`, `sessions.ts`) rend désormais FAUX pour le café, quelle
   * que soit sa recette : la fausse solution évidente (donner 100 ml au café,
   * l'eau de la tasse) aurait fait retrancher 100 ml du bac de pâte à chaque
   * café vendu — pire que le blocage qu'elle prétendait résoudre.
   *
   * `nbCrepes: 0` reste inchangé : c'est la MÊME valeur explicite qu'avant
   * cette refonte (« cette unité ne consomme aucune crêpe »), pour une raison
   * différente de celle de la pâte vendue au volume — voir
   * `verifierConsommationUniteTransforme` (`packages/core/src/contrats/
   * referentiel.ts`) pour pourquoi elle doit rester à `0` et non `null` :
   * `nbCrepesParUnite` (`services/sessions.ts`) retomberait sinon sur son
   * défaut `?? 1`, et un café compterait comme une crêpe produite.
   */
  {
    nom: `${PREFIXE_DEMO}Tasse de café à emporter`,
    nature: 'transforme',
    recetteCode: CODE_RECETTE_VIDE_CAFE,
    ingredientCle: null,
    prixCents: 200,
    consommationUnite: 'nomenclature',
    nbCrepes: 0,
    categorie: 'boisson',
  },
  {
    nom: `${PREFIXE_DEMO}Sirop de Liège — pot 450 g`,
    nature: 'revendu',
    recetteCode: null,
    ingredientCle: 'sirop-liege',
    prixCents: 750,
    // `null` : un revendu ne consomme rien de la production, la question ne
    // se pose pas (`verifierCoherenceProduit`).
    consommationUnite: null,
    // `null` et non 1 : un pot ne consomme aucune crepe. Mettre 1 ferait
    // compter 54 crepes vendues qui n'ont jamais ete cuites, et fausserait le
    // taux d'ecoulement comme le cout matiere par crepe.
    nbCrepes: null,
    categorie: 'terroir',
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   Garnitures — ce qui s'ajoute a la crepe au moment du service
   ═══════════════════════════════════════════════════════════════════════════ */

type DefinitionGarniture = {
  readonly nomProduit: string;
  readonly ingredientCle: string;
  /** Quantite par UNITE VENDUE, dans l'unite de reference de l'ingredient. */
  readonly quantiteUniteRef: number;
};

/**
 * Sans ces deux lignes, le jeu de demonstration illustrait involontairement le
 * defaut qu'il devait montrer : « Crêpe froment / cassonade » a 3,00 € et
 * « Crêpe froment / Sirop de Liège » a 3,50 € avaient le MEME cout de revient,
 * et les 0,50 € d'ecart de prix ne rencontraient aucun ecart de cout.
 *
 * Les quantites sont des ordres de grandeur de DEMONSTRATION : pesez une
 * cuillere de cassonade et une louche de sirop sur vos premieres sessions, puis
 * corrigez-les. C'est le seul chiffre de ce fichier que l'utilisateur peut
 * mesurer lui-meme en trente secondes.
 *
 * Aucune garniture sur le produit REVENDU : un pot se vend ferme.
 */
const GARNITURES: readonly DefinitionGarniture[] = [
  {
    nomProduit: `${PREFIXE_DEMO}Crêpe froment / cassonade`,
    ingredientCle: 'vergeoise',
    quantiteUniteRef: 20,
  },
  {
    nomProduit: `${PREFIXE_DEMO}Crêpe froment / Sirop de Liège`,
    ingredientCle: 'sirop-liege-vrac',
    quantiteUniteRef: 20,
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   Nomenclature de VENTE — ce que le café consomme A LA VENTE (fiche 15 §4)
   ═══════════════════════════════════════════════════════════════════════════ */

type DefinitionComposantVente = {
  readonly ingredientCle: string;
  /** Quantite consommee pour `quantiteReferenceUnites` UNITES VENDUES. */
  readonly quantiteUniteRef: number;
  /** Lot de reference. 1 pour le gobelet, 100 pour la cannelle (voir plus bas). */
  readonly quantiteReferenceUnites: number;
  /** `true` = servi seulement sur demande (une option) ; `false` = toujours applique. */
  readonly optionnel: boolean;
};

/**
 * Composants du café à emporter — le lot de référence en action (fiche 15 §4.1).
 *
 * CINQ ingrédients « toujours appliqués » (café, chicorée, sucre, eau,
 * cannelle) plus le gobelet, et TROIS options (lait, crème, beurre — fiche 15
 * §4.1bis). Les quantités sont des ordres de grandeur de DEMONSTRATION, comme
 * celles de `GARNITURES` ci-dessus : à corriger sur les premières tasses
 * réellement servies.
 *
 * LE POINT DE CETTE LISTE, littéralement : deux lignes au ratio opposé.
 *   - le gobelet : 1 pour 1 — un gobelet par café, le cas courant ;
 *   - la cannelle : 20 g pour 100 cafés, soit 0,2 g par tasse. Saisie « pour 1
 *     café » (1 g arrondi... non, 0,2 g arrondi), elle vaudrait 0 g : coût nul,
 *     stock immobile, le produit ment (fiche 15 §4.1). Le lot de référence de
 *     100 est ce qui la sauve — voir `packages/core/src/nomenclature-vente.ts`
 *     et le test qui suit dans `demonstration.test.ts`, qui prouve que son coût
 *     indicatif n'est PAS nul.
 *
 * Un seul ratio 1:1 partout n'aurait rien démontré (c'est exactement la mise
 * en garde de ce chantier) : cette liste porte donc DÉLIBÉRÉMENT les deux cas.
 */
const COMPOSANTS_CAFE: readonly DefinitionComposantVente[] = [
  {
    ingredientCle: 'cafe-moulu',
    quantiteUniteRef: 7,
    quantiteReferenceUnites: 1,
    optionnel: false,
  },
  { ingredientCle: 'chicoree', quantiteUniteRef: 2, quantiteReferenceUnites: 1, optionnel: false },
  {
    ingredientCle: 'sucre-poudre',
    quantiteUniteRef: 5,
    quantiteReferenceUnites: 1,
    optionnel: false,
  },
  { ingredientCle: 'eau', quantiteUniteRef: 100, quantiteReferenceUnites: 1, optionnel: false },
  // LA CANNELLE — voir le commentaire de tête ci-dessus : 20 g pour 100 cafés,
  // jamais « 0,2 g pour 1 ».
  {
    ingredientCle: 'cannelle',
    quantiteUniteRef: 20,
    quantiteReferenceUnites: 100,
    optionnel: false,
  },
  // LE GOBELET — 1 pour 1, le contraste volontaire avec la cannelle ci-dessus.
  {
    ingredientCle: 'gobelet-carton',
    quantiteUniteRef: 1,
    quantiteReferenceUnites: 1,
    optionnel: false,
  },
  // Options (fiche 15 §4.1bis) : servies seulement sur demande. Le lait et le
  // beurre réutilisent des ingrédients déjà déclarés pour R1.
  {
    ingredientCle: 'lait-entier',
    quantiteUniteRef: 30,
    quantiteReferenceUnites: 1,
    optionnel: true,
  },
  {
    ingredientCle: 'creme-liquide',
    quantiteUniteRef: 15,
    quantiteReferenceUnites: 1,
    optionnel: true,
  },
  { ingredientCle: 'beurre', quantiteUniteRef: 5, quantiteReferenceUnites: 1, optionnel: true },
];

/**
 * Exporté pour `demonstration.test.ts` : aucun test ne doit recopier ce libellé
 * en dur.
 *
 * « Tasse de café », et non « Café » tout court : plusieurs depots
 * (`listerProduitsVendables`, `depots/sessions.ts` ; `listerProduits`,
 * `depots/referentiel.ts` ; etc.) trient les produits PAR NOM et des tests pris
 * ailleurs dans le dépôt (hors zone d'écriture de ce chantier) prennent le
 * PREMIER produit `transforme` de cette liste triée sans préciser lequel, en
 * confiance qu'il s'agit d'une vraie crêpe (recette + `nbCrepes = 1`) — audité
 * le 31/07/2026 : « [démo] Café à emporter » triait AVANT les deux crêpes
 * (« C » < « Cr »), ce qui cassait `packages/db/src/depots/comptabilite.test.ts`
 * et `apps/api/src/routes/integration.test.ts` en leur donnant le café
 * (`nbCrepes = 0`) au lieu d'une crêpe. « Tasse de café » trie APRÈS « Crêpe
 * froment / … » (vérifié avec le même moteur SQLite que l'application) et
 * restaure l'hypothèse implicite de ces tests sans les modifier.
 */
export const NOM_PRODUIT_CAFE = `${PREFIXE_DEMO}Tasse de café à emporter`;

export type ResultatSeedDemo = {
  fournisseurs: number;
  ingredients: number;
  conditionnements: number;
  recettes: number;
  produits: number;
  garnitures: number;
  composantsVente: number;
  lieux: number;
  sessions: number;
  /** Fiches concurrent créées (fiche 08), avec leurs produits et observations. */
  concurrents: number;
  concurrentsProduits: number;
  concurrentsObservations: number;
};

/* ═══════════════════════════════════════════════════════════════════════════
   Seed
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Idempotent PAR ENTITE, et non en bloc.
 *
 * Une premiere version gardait un `if (deja installe) return` global : tout ce
 * qu'on ajoutait ensuite au jeu de demonstration ne pouvait plus JAMAIS
 * s'appliquer a une base existante, il fallait tout reinitialiser. Une seconde
 * version en gardait la moitie — « si le premier ingredient existe, on saute
 * tout sauf le lieu » — avec exactement le meme effet des qu'on ajoutait un
 * ingredient ou un produit. Chaque bloc verifie donc desormais sa PROPRE
 * presence. Relancer ne duplique rien et n'ecrase aucune saisie.
 */
export function seedDemonstration(base: BaseBatte): ResultatSeedDemo {
  const maintenant = maintenantUtc();

  const fournisseurs = seedFournisseurs(base, maintenant);
  const ingredients = seedIngredients(base, maintenant, fournisseurs.ids);
  const recettes = seedRecettes(base, maintenant, ingredients.ids);
  const produits = seedProduits(base, maintenant, recettes.ids, ingredients.ids);
  const garnitures = seedGarnitures(base, ingredients.ids);
  const composantsVente = seedComposantsVente(base, ingredients.ids);
  const lieux = seedLieu(base, maintenant);
  const sessions = seedProchaineSession(base, maintenant);
  // Après `seedLieu` : une fiche concurrent est rattachée à « La Batte », qui
  // doit donc déjà exister.
  const concurrents = seedConcurrentsDemonstration(base);

  return {
    fournisseurs: fournisseurs.inseres,
    ingredients: ingredients.inseres,
    conditionnements: ingredients.conditionnementsInseres,
    recettes: recettes.inseres,
    produits: produits.inseres,
    garnitures: garnitures.inseres,
    composantsVente: composantsVente.inseres,
    ...lieux,
    ...sessions,
    concurrents: concurrents.concurrents,
    concurrentsProduits: concurrents.produits,
    concurrentsObservations: concurrents.observations,
  };
}

function seedFournisseurs(
  base: BaseBatte,
  maintenant: string,
): { ids: Map<CleFournisseur, string>; inseres: number } {
  const ids = new Map<CleFournisseur, string>();
  let inseres = 0;

  for (const definition of FOURNISSEURS) {
    const existant = base
      .select({ id: fournisseur.id })
      .from(fournisseur)
      .where(eq(fournisseur.nom, definition.nom))
      .get();

    if (existant !== undefined) {
      ids.set(definition.cle, existant.id);
      continue;
    }

    const id = nouvelIdentifiant();
    base
      .insert(fournisseur)
      .values({
        id,
        nom: definition.nom,
        type: definition.type,
        delaiLivraisonJours: definition.delaiLivraisonJours,
        actif: true,
        notes: definition.notes,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    ids.set(definition.cle, id);
    inseres += 1;
  }

  return { ids, inseres };
}

function seedIngredients(
  base: BaseBatte,
  maintenant: string,
  fournisseurs: ReadonlyMap<CleFournisseur, string>,
): { ids: Map<string, string>; inseres: number; conditionnementsInseres: number } {
  const ids = new Map<string, string>();
  let inseres = 0;
  let conditionnementsInseres = 0;

  for (const definition of INGREDIENTS) {
    const existant = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, definition.nom))
      .get();

    let id = existant?.id;
    if (id === undefined) {
      id = nouvelIdentifiant();
      base
        .insert(ingredient)
        .values({
          id,
          nom: definition.nom,
          categorie: definition.categorie,
          uniteReference: definition.unite,
          densiteGParMl: definition.densiteGParMl,
          allergenes: definition.allergenes,
          // Zero volontaire : un point de commande se REGLE sur une
          // consommation observee, il ne s'invente pas avant la premiere
          // session. C'est a l'utilisateur de le poser.
          stockSecurite: 0,
          delaiLivraisonJours: FOURNISSEURS.find((f) => f.cle === definition.fournisseur)!
            .delaiLivraisonJours,
          dureeConservationJours: definition.dureeConservationJours,
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      inseres += 1;
    }
    ids.set(definition.cle, id);

    const fournisseurId = fournisseurs.get(definition.fournisseur)!;
    const conditionnementExistant = base
      .select({ id: conditionnement.id })
      .from(conditionnement)
      .where(
        and(
          eq(conditionnement.ingredientId, id),
          eq(conditionnement.libelle, definition.conditionnement.libelle),
        ),
      )
      .get();

    if (conditionnementExistant === undefined) {
      base
        .insert(conditionnement)
        .values({
          id: nouvelIdentifiant(),
          ingredientId: id,
          fournisseurId,
          libelle: definition.conditionnement.libelle,
          quantiteUniteRef: definition.conditionnement.quantite,
          prixCents: definition.conditionnement.prixCents,
          datePrix: maintenant.slice(0, 10),
          actif: true,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      conditionnementsInseres += 1;
    }
  }

  return { ids, inseres, conditionnementsInseres };
}

function seedRecettes(
  base: BaseBatte,
  maintenant: string,
  ingredients: ReadonlyMap<string, string>,
): { ids: Map<string, string>; inseres: number } {
  const ids = new Map<string, string>();
  let inseres = 0;

  // --- R1 : composition reelle documentee -----------------------------------
  const r1Existante = base
    .select({ id: recette.id })
    .from(recette)
    .where(and(eq(recette.code, 'R1'), eq(recette.version, 1)))
    .get();

  if (r1Existante === undefined) {
    const idR1 = nouvelIdentifiant();
    base
      .insert(recette)
      .values({
        id: idR1,
        code: 'R1',
        nom: 'Pâte à crêpes froment',
        version: 1,
        statut: 'active',
        typePate: 'froment',
        sansGluten: false,
        rendementReferenceMl: 455,
        rendementReferenceCrepes: 6,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: 0,
        procede:
          'Mélanger la farine, le sel et les sucres. Incorporer les œufs puis le lait ' +
          "progressivement. Ajouter le beurre noisette tiède et la fleur d'oranger. " +
          'Laisser reposer avant cuisson.',
        dateActivation: maintenant,
        notes:
          'Composition issue de CLAUDE.md §6. Rendement de référence : 455 ml pour 6 crêpes ' +
          '(~76 ml/crêpe), soit ~66 crêpes pour 5 L — voir la décision D-014. Les pertes de ' +
          'cuisson et de casse sont à 0 : mesurez-les sur vos premières sessions.',
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    LIGNES_R1.forEach((ligne, index) => {
      base
        .insert(recetteLigne)
        .values({
          id: nouvelIdentifiant(),
          recetteId: idR1,
          ingredientId: ingredients.get(ligne.cle)!,
          quantiteUniteRef: ligne.quantite,
          ordre: index,
        })
        .run();
    });

    ids.set('R1', idR1);
    inseres += 1;
  } else {
    ids.set('R1', r1Existante.id);
  }

  // --- R2 : rendement documente, composition NON documentee ------------------
  // On ne l'invente pas. La recette existe en brouillon avec son rendement, et
  // l'utilisateur la complete. Une recette sans ligne echoue volontairement au
  // controle de `mettreAEchelle` : elle n'est pas utilisable tant qu'elle est vide.
  const r2Existante = base
    .select({ id: recette.id })
    .from(recette)
    .where(and(eq(recette.code, 'R2'), eq(recette.version, 1)))
    .get();

  if (r2Existante === undefined) {
    const idR2 = nouvelIdentifiant();
    base
      .insert(recette)
      .values({
        id: idR2,
        code: 'R2',
        nom: 'Pâte à crêpes sarrasin-châtaigne (sans gluten)',
        version: 1,
        statut: 'brouillon',
        typePate: 'sarrasin-chataigne',
        sansGluten: true,
        rendementReferenceMl: 441,
        rendementReferenceCrepes: 6,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: 0,
        notes:
          'À COMPLÉTER. CLAUDE.md §6 documente le rendement (5 L ≈ 68 crêpes, soit ~73,5 ml/crêpe) ' +
          'et le coût matière (0,41–0,45 €/crêpe), mais pas la composition. Saisissez vos ' +
          "ingrédients : la recette reste inutilisable tant qu'elle est vide.",
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    ids.set('R2', idR2);
    inseres += 1;
  } else {
    ids.set('R2', r2Existante.id);
  }

  // --- Recette VIDE du café : ne sert JAMAIS à produire, seulement à ---------
  // satisfaire la règle de cohérence d'un produit `transforme` ----------------
  //
  // Décision du porteur (31/07/2026, fiche 15 §4 + audit du trou de validation
  // documenté sur `PRODUITS` ci-dessous) : plutôt que de créer une quatrième
  // nature de produit ou d'assouplir `verifierCoherenceProduit`
  // (`packages/core/src/contrats/referentiel.ts`, hors zone d'écriture de ce
  // chantier — la validation ne change pas), le café reçoit une recette VIDE.
  // Aucune ligne, jamais activée (`statut: 'brouillon'` pour toujours — rien
  // dans cette graine ni dans l'application ne l'active) : son seul rôle est
  // que `produit_vente.recette_id` ne soit pas `null`, exactement ce
  // qu'exige la règle. Rouvrir la fiche du café dans l'écran Produits et
  // l'enregistrer SANS RIEN CHANGER n'échoue donc plus en 422.
  //
  // `rendementReferenceMl` / `rendementReferenceCrepes` sont NOT NULL en base
  // (`schema.ts`) : les valeurs ci-dessous sont des PLACEHOLDERS inertes,
  // jamais lus — `coutParCrepe` (`depots/recettes.ts`) rend `null` dès qu'une
  // recette n'a AUCUNE ligne, avant même de les regarder, et `mettreAEchelle`
  // n'est de toute façon jamais appelée sur une recette non `active`
  // (`lancerProduction` la refuse). La vraie composition du café reste
  // ENTIÈREMENT portée par la nomenclature de VENTE (`COMPOSANTS_CAFE` /
  // `seedComposantsVente` plus bas), jamais par cette recette.
  const recetteVideCafeExistante = base
    .select({ id: recette.id })
    .from(recette)
    .where(and(eq(recette.code, CODE_RECETTE_VIDE_CAFE), eq(recette.version, 1)))
    .get();

  if (recetteVideCafeExistante === undefined) {
    const idRecetteVideCafe = nouvelIdentifiant();
    base
      .insert(recette)
      .values({
        id: idRecetteVideCafe,
        code: CODE_RECETTE_VIDE_CAFE,
        nom: 'Café — recette vide (satisfait uniquement la règle de cohérence)',
        version: 1,
        statut: 'brouillon',
        typePate: 'sans-objet',
        sansGluten: false,
        rendementReferenceMl: 1,
        rendementReferenceCrepes: 1,
        perteCuissonBp: 0,
        tauxCasseBp: 0,
        perteFixeMl: 0,
        dateActivation: null,
        notes:
          'Recette délibérément VIDE et jamais activée (fiche 15 §4, décision du porteur, ' +
          '31/07/2026). Le café ne se produit pas par lot : sa composition vient entièrement de ' +
          "sa nomenclature de VENTE (écran « composants de vente »), jamais d'une recette. Cette " +
          "ligne n'existe que pour satisfaire la règle « un produit transformé porte une " +
          "recette » (`verifierCoherenceProduit`) — ne JAMAIS y ajouter de ligne ni l'activer.",
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    ids.set(CODE_RECETTE_VIDE_CAFE, idRecetteVideCafe);
    inseres += 1;
  } else {
    ids.set(CODE_RECETTE_VIDE_CAFE, recetteVideCafeExistante.id);
  }

  return { ids, inseres };
}

function seedProduits(
  base: BaseBatte,
  maintenant: string,
  recettes: ReadonlyMap<string, string>,
  ingredients: ReadonlyMap<string, string>,
): { inseres: number } {
  let inseres = 0;

  for (const definition of PRODUITS) {
    const existant = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nom, definition.nom))
      .get();
    if (existant !== undefined) continue;

    base
      .insert(produitVente)
      .values({
        id: nouvelIdentifiant(),
        nom: definition.nom,
        nature: definition.nature,
        recetteId: definition.recetteCode === null ? null : recettes.get(definition.recetteCode)!,
        ingredientId:
          definition.ingredientCle === null ? null : ingredients.get(definition.ingredientCle)!,
        prixCents: definition.prixCents,
        consommationUnite: definition.consommationUnite,
        nbCrepes: definition.nbCrepes,
        categorie: definition.categorie,
        // Vente à emporter : ce n'est PAS un service de restauration au sens du
        // seuil SCE tant qu'il n'y a ni table ni chaise (docs/07 §6.7).
        consommationSurPlace: false,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    inseres += 1;
  }

  return { inseres };
}

/**
 * Rattache les garnitures aux produits transformes.
 *
 * Idempotent par LIGNE, comme les autres blocs : l'index unique
 * (produit, ingredient) garantit qu'on ne peut pas declarer deux fois la meme
 * garniture, et la verification prealable evite de compter sur une violation de
 * contrainte pour s'en apercevoir.
 */
function seedGarnitures(
  base: BaseBatte,
  ingredients: ReadonlyMap<string, string>,
): { inseres: number } {
  let inseres = 0;

  for (const definition of GARNITURES) {
    const produit = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nom, definition.nomProduit))
      .get();
    const ingredientId = ingredients.get(definition.ingredientCle);
    if (produit === undefined || ingredientId === undefined) continue;

    const existante = base
      .select({ id: produitGarniture.id })
      .from(produitGarniture)
      .where(
        and(
          eq(produitGarniture.produitVenteId, produit.id),
          eq(produitGarniture.ingredientId, ingredientId),
        ),
      )
      .get();
    if (existante !== undefined) continue;

    base
      .insert(produitGarniture)
      .values({
        id: nouvelIdentifiant(),
        produitVenteId: produit.id,
        ingredientId,
        quantiteUniteRef: definition.quantiteUniteRef,
      })
      .run();
    inseres += 1;
  }

  return { inseres };
}

/**
 * Rattache les composants de la NOMENCLATURE DE VENTE (fiche 15) au café.
 *
 * Idempotent par LIGNE, comme `seedGarnitures` juste au-dessus : une
 * verification prealable (produit + ingredient), et non un index unique en
 * base — `produit_vente_composant` (schema.ts) n'en porte aucun sur (produit,
 * ingredient), seulement des index simples sur chaque colonne separement.
 * Cette graine ne s'appuie donc pas sur une contrainte SQL pour rester
 * idempotente : elle verifie elle-meme, comme `seedGarnitures`.
 *
 * Passe par `creerComposantVente` (depot, deja exporte par le barrel
 * `@batte/db`) plutot que par un `INSERT` direct : c'est la meme fonction que
 * la route HTTP `POST /produits/:id/composants` appelle, donc la graine ne
 * peut pas fabriquer un etat que l'application serait incapable de produire
 * elle-meme (meme doctrine que `activite.ts` pour les receptions et la
 * production).
 */
function seedComposantsVente(
  base: BaseBatte,
  ingredients: ReadonlyMap<string, string>,
): { inseres: number } {
  let inseres = 0;

  const produit = base
    .select({ id: produitVente.id })
    .from(produitVente)
    .where(eq(produitVente.nom, NOM_PRODUIT_CAFE))
    .get();
  if (produit === undefined) return { inseres };

  for (const definition of COMPOSANTS_CAFE) {
    const ingredientId = ingredients.get(definition.ingredientCle);
    if (ingredientId === undefined) continue;

    const existant = base
      .select({ id: produitVenteComposant.id })
      .from(produitVenteComposant)
      .where(
        and(
          eq(produitVenteComposant.produitVenteId, produit.id),
          eq(produitVenteComposant.ingredientId, ingredientId),
        ),
      )
      .get();
    if (existant !== undefined) continue;

    creerComposantVente(base, produit.id, {
      ingredientId,
      quantiteUniteRef: definition.quantiteUniteRef,
      quantiteReferenceUnites: definition.quantiteReferenceUnites,
      // Toujours consomme, quel que soit le mode (sur place / a emporter) :
      // aucun de ces composants n'est un contenant reserve a l'un des deux
      // modes (contrairement a une assiette ou une bouteille, fiche 15 §4.3).
      consommationSurPlace: null,
      optionnel: definition.optionnel,
    });
    inseres += 1;
  }

  return { inseres };
}

/**
 * La Batte est REELLE et documentee : coordonnees issues de docs/03 (facteur
 * meteo), fenetre de 6 h 30 issue de CLAUDE.md §6. Le tarif d'emplacement, lui,
 * n'est documente nulle part — il reste `null` plutot qu'invente.
 */
function seedLieu(base: BaseBatte, maintenant: string): { lieux: number } {
  const deja = base
    .select({ id: lieuMarche.id })
    .from(lieuMarche)
    .where(eq(lieuMarche.nom, 'La Batte'))
    .limit(1)
    .all();
  if (deja.length > 0) return { lieux: 0 };

  base
    .insert(lieuMarche)
    .values({
      id: nouvelIdentifiant(),
      nom: 'La Batte',
      adresse: 'Quai de la Batte, 4000 Liège',
      latitude: 50.6447,
      longitude: 5.5822,
      jourSemaine: 0, // dimanche
      heureDebut: '08:00',
      heureFin: '14:30',
      tarifEmplacementCents: null,
      modeTarification: null,
      metresLineaires: null,
      actif: true,
      notes:
        "Coordonnées et fenêtre horaire documentées. Le tarif d'emplacement n'est pas " +
        'documenté : renseignez-le avant la première session.',
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  return { lieux: 1 };
}

/**
 * Une session planifiee au prochain dimanche.
 *
 * Sans elle, l'ecran « Prochaine session » n'a rien a prevoir et le jeu de
 * demonstration ne demontre pas le module le plus utile de l'application.
 * Le numero est alloue par la sequence normale : une session de demonstration
 * reste une session, pas un objet a part.
 */
function seedProchaineSession(base: BaseBatte, maintenant: string): { sessions: number } {
  const lieu = base
    .select({ id: lieuMarche.id, jourSemaine: lieuMarche.jourSemaine })
    .from(lieuMarche)
    .where(eq(lieuMarche.nom, 'La Batte'))
    .get();
  if (lieu === undefined) return { sessions: 0 };

  const dateSession = prochainJourDeMarche(lieu.jourSemaine ?? 0);

  const deja = base
    .select({ id: sessionMarche.id })
    .from(sessionMarche)
    .where(eq(sessionMarche.dateSession, dateSession))
    .limit(1)
    .all();
  if (deja.length > 0) return { sessions: 0 };

  // Allocation du numero et insertion dans la MEME transaction, comme les
  // quatre autres appelants d'`allouerNumero` : si l'insertion echoue, le
  // numero doit etre annule avec elle, sinon on cree le trou qu'on cherche
  // precisement a eviter dans une numerotation legale.
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    baseTx
      .insert(sessionMarche)
      .values({
        id: nouvelIdentifiant(),
        numero: allouerNumero(baseTx, 'session', Number.parseInt(dateSession.slice(0, 4), 10)),
        lieuId: lieu.id,
        dateSession,
        statut: 'planifiee',
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  });

  return { sessions: 1 };
}

/** Prochaine occurrence d'un jour de la semaine (0 = dimanche), en jour civil belge. */
function prochainJourDeMarche(jourSemaine: number): string {
  const aujourdHui = new Date(`${jourCivilBelge(new Date())}T12:00:00Z`);
  const ecart = (jourSemaine - aujourdHui.getUTCDay() + 7) % 7;
  aujourdHui.setUTCDate(aujourdHui.getUTCDate() + ecart);
  return aujourdHui.toISOString().slice(0, 10);
}

if (estModulePrincipal(import.meta.url)) {
  const base = creerBase();
  const r = seedDemonstration(base);
  const total =
    r.fournisseurs +
    r.ingredients +
    r.conditionnements +
    r.recettes +
    r.produits +
    r.garnitures +
    r.composantsVente +
    r.lieux +
    r.sessions +
    r.concurrents;

  if (total === 0) {
    console.log('Référentiel de démonstration déjà complet — rien à ajouter.');
  } else {
    console.log(
      `Démonstration : ${r.fournisseurs} fournisseur(s), ${r.ingredients} ingrédient(s), ` +
        `${r.conditionnements} conditionnement(s), ${r.recettes} recette(s), ` +
        `${r.produits} produit(s), ${r.garnitures} garniture(s), ` +
        `${r.composantsVente} composant(s) de nomenclature de vente, ${r.lieux} lieu(x), ` +
        `${r.sessions} session(s) planifiée(s), ${r.concurrents} concurrent(s) ` +
        `(${r.concurrentsProduits} produit(s) relevé(s), ${r.concurrentsObservations} observation(s)).`,
    );
    if (r.recettes > 0) {
      console.log(
        "  R2 est en brouillon : sa composition n'est pas documentée dans CLAUDE.md, à saisir.",
      );
    }
  }

  // L'historique d'exploitation vient APRES le referentiel : il en depend
  // entierement (il faut un ingredient pour le recevoir, une recette pour la
  // produire, un lieu pour y tenir un marche).
  const activite: ResultatSeedActivite = seedDemonstrationActivite(base);
  if (activite.receptions + activite.productions + activite.sessionsCloturees === 0) {
    console.log('Historique de démonstration déjà complet — rien à ajouter.');
  } else {
    console.log(
      `Historique : ${activite.receptions} réception(s), ${activite.productions} production(s), ` +
        `${activite.sessionsCloturees} session(s) clôturée(s).`,
    );
  }
  if (activite.ecartsStock.length > 0) {
    console.log(
      `  Écarts de stock à la clôture : ${activite.ecartsStock
        .map((e) => `${e.nomIngredient} (${e.quantiteManquante})`)
        .join(', ')}`,
    );
  }
}
