import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CATALOGUE_ALLERGENES,
  GLYPHE_STATUT,
  LIBELLE_CATEGORIE_INGREDIENT,
  champsDepuisErreurZod,
  formaterMontant,
  formaterQuantite,
  libelleUnite,
  ouTiret,
  parserEuros,
  schemaCategorieIngredient,
  schemaConditionnement,
  ingredientCorrespondALaRecherche,
  schemaIngredientComplet,
  schemaListeConditionnements,
  schemaListeFournisseurs,
  schemaListeIngredientsComplets,
  schemaSaisieConditionnement,
  schemaSaisieIngredient,
  fournisseursProposables as calculerFournisseursProposables,
  type CategorieIngredient,
  type ChampsEnErreur,
  type Conditionnement,
  type Fournisseur,
  type IngredientComplet,
  type Unite,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { champsEnErreurApresModification } from '../composants/formulaire';
import { MessageErreur } from '../composants/EncartErreur';
import { LigneFiche } from '../composants/affichage';
import {
  ChampSelect,
  ChampTexte,
  IndicateurEnregistrement,
  type EtatEnregistrement,
} from '../composants/champs-formulaire';
import { ErreurApi, requeteApi } from '../lib/api';

/**
 * Ecran Ingrédients (docs/06 — groupe RÉFÉRENTIEL), avec ses conditionnements.
 *
 * POURQUOI CET ÉCRAN EXISTE. `ingredient` et `conditionnement` n'étaient
 * écrites que par la graine (docs/13 §4.7). Trois conséquences mesurées sur la
 * base réelle :
 *  - acheter un nouvel article — une farine sans gluten, un sirop d'un autre
 *    producteur — obligeait à éditer le code du seed ;
 *  - le prix d'achat vit dans `conditionnement.prix_cents` (D-018), donc un
 *    changement de tarif du meunier n'était pas saisissable : le coût matière
 *    restait figé au prix de la graine, pour toujours ;
 *  - `stock_securite` valait 0 partout, ce qui rend le point de commande — et
 *    tout l'écran de réapprovisionnement — inerte. C'est le champ « Stock de
 *    sécurité » ci-dessous qui le réveille.
 *
 * TROIS PARTIS PRIS QUI MÉRITENT D'ÊTRE LUS.
 *
 * 1. **On ne supprime pas, on désactive.** Aucun bouton « Supprimer », et il ne
 *    doit jamais en apparaître : un ingrédient est référencé par des lots reçus
 *    il y a deux ans, dont la traçabilité AFSCA doit rester lisible
 *    (CLAUDE.md §3 règle 7).
 *
 * 2. **Le formulaire refuse exactement ce que `unites.ts` refuse.** Une densité
 *    non finie ou nulle n'est pas rejetée par le serveur seulement : le schéma
 *    Zod PARTAGÉ est rejoué ici, avant tout aller-retour. D-034 dit pourquoi :
 *    le stock est la SOMME des mouvements, donc une seule densité `NaN` rend
 *    `NaN` le stock de l'ingrédient, sa valorisation, puis tout coût matière en
 *    aval — sans jamais lever.
 *
 * 3. **Changer un tarif et corriger une fiche sont deux gestes nommés**, comme
 *    dans l'écran Paramètres (D-042). Le prix porte une DATE : « le meunier a
 *    augmenté au 1er septembre » et « je m'étais trompé en tapant le prix » ne
 *    demandent pas la même écriture, et l'un des deux réécrit le passé.
 *
 * Règle d'architecture n°1 : aucun calcul métier ici. Les montants passent par
 * `parserEuros` / `formaterMontant`, les quantités par `formaterQuantite`, la
 * validation par les schémas partagés — et la réponse du serveur fait foi.
 */

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | {
      statut: 'pret';
      ingredients: IngredientComplet[];
      conditionnements: Conditionnement[];
      fournisseurs: Fournisseur[];
    };

/** Champs du formulaire, tous en chaînes : c'est ce que rend un `<input>`. */
export type BrouillonIngredient = {
  nom: string;
  categorie: CategorieIngredient;
  uniteReference: Unite;
  densite: string;
  allergenes: string[];
  /**
   * Distingue « vérifié, aucun allergène » de « jamais évalué »
   * (`ingredient.allergenes_verifies`). Tant que c'est décoché, les documents
   * affichent « allergènes non encore vérifiés » plutôt qu'une liste — voir
   * `corpsSaisieIngredient` ci-dessous pour le point exact où ce booléen part
   * dans le corps envoyé au serveur.
   */
  allergenesVerifies: boolean;
  stockSecurite: string;
  delaiLivraisonJours: string;
  dureeConservationJours: string;
  notes: string;
};

/**
 * `stockSecurite` démarre VIDE, comme ses voisins — pas `'0'`.
 *
 * DÉFAUT MESURÉ (recette clavier du 30/07/2026) : un ingrédient neuf arrivait
 * avec « Stock de sécurité » PRÉ-REMPLI à 0, alors que ses voisins (délai de
 * livraison, durée de conservation, densité) restaient vides. Un stock de
 * sécurité à 0 dit « je n'en veux jamais en réserve » ; un stock de sécurité
 * vide dit « je n'y ai pas encore réfléchi » — ce ne sont pas les mêmes
 * phrases, et l'écran affirmait la première à la place de l'utilisateur.
 *
 * La colonne `ingredient.stock_securite` reste `NOT NULL DEFAULT 0`
 * (`packages/db/src/schema.ts`, hors zone d'écriture de cet agent) et le
 * schéma partagé (`schemaSaisieIngredientBrute.stockSecurite`,
 * `packages/core/src/contrats/referentiel.ts`) exige toujours un entier —
 * jamais `null` : un champ laissé vide ne peut donc PAS s'enregistrer tel
 * quel. Voir `corpsSaisieIngredient` ci-dessous pour le point exact où ce
 * champ vide se résout à `0` — la même valeur que `statutStock`
 * (`packages/core/src/affichage.ts`) traite déjà comme « aucun seuil déclaré,
 * ne jamais alerter » : le comportement de l'alerte de réapprovisionnement
 * pour un ingrédient jamais configuré ne change donc pas. Seul change ce que
 * l'écran AFFICHE avant que l'utilisateur n'y touche.
 */
export const BROUILLON_INGREDIENT_VIDE: BrouillonIngredient = {
  nom: '',
  categorie: 'farine',
  uniteReference: 'g',
  densite: '',
  allergenes: [],
  // Une création sans case cochée n'a jamais été évaluée : même défaut que la
  // colonne elle-même (`packages/db/src/schema.ts`).
  allergenesVerifies: false,
  stockSecurite: '',
  delaiLivraisonJours: '',
  dureeConservationJours: '',
  notes: '',
};

type BrouillonConditionnement = {
  fournisseurId: string;
  libelle: string;
  quantiteUniteRef: string;
  prix: string;
  referenceFournisseur: string;
  datePrix: string;
};

/** Ce qu'on est en train de faire dans le panneau des conditionnements. */
type ModeConditionnement = 'consultation' | 'creation' | 'correction' | 'tarif';

const UNITES: readonly Unite[] = ['g', 'ml', 'piece'];

const CLASSE_BOUTON_PRIMAIRE =
  'h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:bg-ink-4';
const CLASSE_BOUTON_SECONDAIRE =
  'h-controle rounded-sm border border-line-field bg-surface px-3 text-sm font-medium text-ink-2 hover:bg-surface-sunken';

function heureCourante(): string {
  return new Intl.DateTimeFormat('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(new Date());
}

/** Jour civil du poste, au format attendu par `<input type="date">`. */
function aujourdHuiCivil(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());
}

/**
 * Lit un champ numérique de formulaire.
 *
 * `''` vaut ABSENT (`null`) ; toute autre saisie est rendue telle quelle, **y
 * compris `NaN` et `Infinity`**. C'est délibéré : passer la valeur fautive au
 * schéma Zod partagé lui fait produire le message exact que le serveur
 * produirait, sous le bon champ. Convertir en `null` ici transformerait une
 * densité illisible en « pas de densité », c'est-à-dire en silence.
 */
function nombreSaisi(saisie: string): number | null {
  const nettoye = saisie.trim().replace(',', '.');
  if (nettoye === '') return null;
  return Number(nettoye);
}

function versBrouillonIngredient(fiche: IngredientComplet): BrouillonIngredient {
  return {
    nom: fiche.nom,
    categorie: fiche.categorie,
    uniteReference: fiche.uniteReference,
    densite: fiche.densiteGParMl === null ? '' : String(fiche.densiteGParMl),
    allergenes: [...fiche.allergenes],
    allergenesVerifies: fiche.allergenesVerifies,
    stockSecurite: String(fiche.stockSecurite),
    delaiLivraisonJours:
      fiche.delaiLivraisonJours === null ? '' : String(fiche.delaiLivraisonJours),
    dureeConservationJours:
      fiche.dureeConservationJours === null ? '' : String(fiche.dureeConservationJours),
    notes: fiche.notes ?? '',
  };
}

/**
 * Corps envoyé à `POST /ingredients` ou `PATCH /ingredients/:id`, à partir du
 * brouillon du formulaire.
 *
 * Extraite en fonction PURE (et exportée) pour pouvoir prouver, sans monter
 * tout l'écran, que `allergenesVerifies` fait bien partie de ce corps — c'est
 * le point exact où le fil se coupait avant que ce champ n'y figure : un
 * `PATCH` qui l'omet fait conserver au dépôt l'ancienne valeur (comportement
 * voulu, `schemaSaisieIngredientBrute.allergenesVerifies`), donc une case
 * cochée à l'écran qui n'atteint jamais ce corps ne se serait jamais vue.
 */
export function corpsSaisieIngredient(brouillon: BrouillonIngredient): Record<string, unknown> {
  return {
    nom: brouillon.nom,
    categorie: brouillon.categorie,
    uniteReference: brouillon.uniteReference,
    densiteGParMl: nombreSaisi(brouillon.densite),
    allergenes: brouillon.allergenes,
    allergenesVerifies: brouillon.allergenesVerifies,
    /**
     * `?? 0`, jamais `null` : contrairement à `delaiLivraisonJours` et
     * `dureeConservationJours` ci-dessous, `stockSecurite` N'EST PAS nullish
     * dans le schéma partagé (`schemaSaisieIngredientBrute`) ni dans la
     * colonne (`NOT NULL DEFAULT 0`) — les deux hors de la zone d'écriture de
     * cet agent. Un champ laissé vide (`nombreSaisi` rend alors `null`) se
     * résout donc ici à `0`, la valeur que le reste de l'application traite
     * déjà comme « aucun seuil déclaré » (`statutStock`,
     * `packages/core/src/affichage.ts`) — jamais comme un choix actif de
     * zéro réserve. `NaN` (saisie illisible) n'est PAS intercepté par ce
     * `??` : il reste tel quel pour que le schéma Zod le refuse avec son
     * message précis, comme pour tout autre champ numérique de cet écran.
     */
    stockSecurite: nombreSaisi(brouillon.stockSecurite) ?? 0,
    delaiLivraisonJours: nombreSaisi(brouillon.delaiLivraisonJours),
    dureeConservationJours: nombreSaisi(brouillon.dureeConservationJours),
    notes: brouillon.notes,
  };
}

function versBrouillonConditionnement(ligne: Conditionnement): BrouillonConditionnement {
  return {
    fournisseurId: ligne.fournisseurId,
    libelle: ligne.libelle,
    quantiteUniteRef: String(ligne.quantiteUniteRef),
    prix: formaterMontant(ligne.prixCents),
    referenceFournisseur: ligne.referenceFournisseur ?? '',
    datePrix: ligne.datePrix,
  };
}

/**
 * CINQ colonnes, et le nom en `repli`.
 *
 * Les noms d'ingrédients partagent leur début et se distinguent par leur FIN —
 * « Farine de froment T55 », « Farine de froment T65 » — exactement ce que
 * l'ellipse coupe en premier. Choisir la mauvaise ligne ici, c'est éditer le
 * mauvais ingrédient : sa densité, son unité de référence et son stock de
 * sécurité pilotent le stock, le coût matière et le point de commande.
 */
const COLONNES: ReadonlyArray<ColonneTableau<IngredientComplet>> = [
  {
    cle: 'nom',
    libelle: 'Ingrédient',
    largeur: '33%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (i) => i.nom,
  },
  {
    // Contenu BORNÉ (« grammes » / « millilitres » / « pièces ») : cette colonne
    // peut céder de la largeur au nom, dont la longueur est imprévisible.
    cle: 'unite',
    libelle: 'Unité',
    largeur: '15%',
    alignement: 'texte',
    rendu: (i) => libelleUnite(i.uniteReference),
  },
  {
    // L'unité est DANS la cellule et non dans l'en-tête, contrairement à la
    // règle habituelle de docs/07 §4.5 : elle change d'une ligne à l'autre
    // (grammes, millilitres, pièces). Un en-tête ne peut pas porter trois
    // unités à la fois.
    // « Stock mini » et non « Stock de sécurité » : MESURÉ à la résolution cible,
    // l'intitulé complet se coupait en « STOCK DE SÉC… » — et un en-tête tronqué
    // ne se devine pas. La formulation complète vit dans le libellé du champ, à
    // droite, où rien ne la contraint.
    cle: 'securite',
    libelle: 'Stock mini',
    largeur: '20%',
    alignement: 'nombre',
    rendu: (i) =>
      i.stockSecurite === 0 ? (
        // 0 n'est pas une valeur ici mais une absence de paramétrage : le point
        // de commande vaut alors « consommation × délai », sans marge.
        <span className="text-ink-3">non défini</span>
      ) : (
        formaterQuantite(i.stockSecurite, i.uniteReference)
      ),
  },
  {
    // Même mesure : « CONDITIONNEMENTS » se coupait en « CONDIT… ». Le tableau
    // détaillé, juste en dessous, porte le mot entier.
    cle: 'achats',
    libelle: 'Formats',
    largeur: '16%',
    alignement: 'nombre',
    // Sans un seul conditionnement actif, aucun prix n'existe : le coût matière
    // de toute recette qui cite cet ingrédient est incalculable.
    rendu: (i) =>
      i.nbConditionnements === 0 ? (
        <span className="inline-flex items-center gap-groupe text-alerte">
          <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span>
          aucun
        </span>
      ) : (
        String(i.nbConditionnements)
      ),
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    largeur: '16%',
    alignement: 'texte',
    // Somme des largeurs : 33 + 15 + 20 + 16 + 16 = 100 %.
    rendu: (i) =>
      i.actif ? (
        <span className="text-ink-2">Actif</span>
      ) : (
        <span className="text-ink-3">Retiré</span>
      ),
  },
];

const COLONNES_CONDITIONNEMENTS: ReadonlyArray<ColonneTableau<Conditionnement>> = [
  {
    // Intitulés COURTS et largeurs mesurées à la résolution cible : « Format »
    // plutôt que « Conditionnement », « Depuis le » plutôt que « En vigueur
    // le ». Les deux intitulés longs se coupaient dans leur en-tête, et un
    // en-tête tronqué ne se devine pas. Somme : 20 + 28 + 19 + 14 + 19 = 100 %.
    cle: 'libelle',
    libelle: 'Format',
    largeur: '20%',
    alignement: 'texte',
    // C'est ce libellé qui figure sur le bon de commande envoyé au fournisseur :
    // « Sac 25 kg » tronqué en « Sac 2… » commande autre chose.
    troncature: 'repli',
    rendu: (c) => c.libelle,
  },
  {
    cle: 'fournisseur',
    libelle: 'Fournisseur',
    largeur: '28%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (c) => c.fournisseurNom,
  },
  {
    cle: 'contenance',
    libelle: 'Contenance',
    largeur: '19%',
    alignement: 'nombre',
    rendu: (c) => formaterQuantite(c.quantiteUniteRef, c.uniteReference),
  },
  {
    cle: 'prix',
    libelle: 'Prix (€)',
    largeur: '14%',
    alignement: 'nombre',
    rendu: (c) => formaterMontant(c.prixCents),
  },
  {
    /**
     * Date de PRIX, pas de saisie : c'est elle qui décide quel tarif s'applique.
     *
     * `repli` et non ellipse : deux lignes de tarif du même article ne diffèrent
     * QUE par cette date et par le prix. Ellipsée, « 2026-01-05 — archivé »
     * devenait « 2026-01-0… », donc indiscernable de « 2026-01-09 » — et c'est
     * exactement la colonne qui dit laquelle des deux est en vigueur.
     */
    cle: 'date',
    libelle: 'Depuis le',
    largeur: '19%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (c) =>
      c.actif ? c.datePrix : <span className="text-ink-3">{c.datePrix} — archivé</span>,
  },
];

export default function Ingredients() {
  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState<BrouillonIngredient>(BROUILLON_INGREDIENT_VIDE);
  const [champsEnErreur, setChampsEnErreur] = useState<ChampsEnErreur>({});
  const [erreurFormulaire, setErreurFormulaire] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState<EtatEnregistrement>({ phase: 'inchange' });
  const [afficherRetires, setAfficherRetires] = useState(false);
  /**
   * Recherche par nom ET synonymes courants (fiche 09). Sans elle, chercher
   * « cassonade » sur un référentiel qui ne connaît que « Vergeoise blonde »
   * ne trouve rien, et la saisie la plus rapide devient une seconde ligne de
   * stock pour la même denrée — exactement le doublon que la fiche demande
   * d'éviter.
   */
  const [recherche, setRecherche] = useState('');

  const [conditionnementId, setConditionnementId] = useState<string | null>(null);
  const [modeConditionnement, setModeConditionnement] =
    useState<ModeConditionnement>('consultation');

  const formulaireRef = useRef<HTMLFormElement>(null);
  // Le bouton « Enregistrer » se DÉSACTIVE le temps de l'aller-retour
  // (`disabled={enregistrement.phase === 'enregistrement'}` ci-dessous) : un
  // bouton qui perd `disabled` PENDANT qu'il a le focus est blur par le
  // navigateur lui-même, avant même que React ne s'en mêle — le focus
  // retombe alors sur `<body>` (recette au navigateur du 31/07/2026,
  // rejouée après la campagne de correctifs). `requestAnimationFrame`
  // attend que le DOM ait bien réappliqué `disabled=false` avant de
  // reprendre le focus, même patron que `boutonSortir` (`Stock.tsx`, D-079).
  const boutonEnregistrerRef = useRef<HTMLButtonElement>(null);

  const charger = useCallback(async (): Promise<{
    ingredients: IngredientComplet[];
    conditionnements: Conditionnement[];
  }> => {
    const [ingredients, conditionnements] = await Promise.all([
      requeteApi<unknown>('/referentiel/ingredients').then(
        (r) => schemaListeIngredientsComplets.parse(r).data,
      ),
      requeteApi<unknown>('/conditionnements').then(
        (r) => schemaListeConditionnements.parse(r).data,
      ),
    ]);
    return { ingredients, conditionnements };
  }, []);

  useEffect(() => {
    let annule = false;

    Promise.all([
      charger(),
      requeteApi<unknown>('/fournisseurs').then((r) => schemaListeFournisseurs.parse(r).data),
    ])
      .then(([referentiel, fournisseurs]) => {
        if (annule) return;
        setEtat({ statut: 'pret', ...referentiel, fournisseurs });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        setEtat({
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
  }, [charger]);

  // Chaque liste passe par son propre `useMemo` : un ternaire rendant `[]`
  // fabrique un tableau NEUF à chaque rendu, ce qui annule les `useMemo` qui en
  // dépendent (D-047).
  const ingredients = useMemo(() => (etat.statut === 'pret' ? etat.ingredients : []), [etat]);
  const conditionnements = useMemo(
    () => (etat.statut === 'pret' ? etat.conditionnements : []),
    [etat],
  );
  const fournisseurs = useMemo(() => (etat.statut === 'pret' ? etat.fournisseurs : []), [etat]);

  const visibles = useMemo(
    () =>
      ingredients.filter(
        (i) => (afficherRetires || i.actif) && ingredientCorrespondALaRecherche(i.nom, recherche),
      ),
    [ingredients, afficherRetires, recherche],
  );

  const selection = useMemo(
    () => ingredients.find((i) => i.id === selectionId) ?? null,
    [ingredients, selectionId],
  );

  const conditionnementsDeLIngredient = useMemo(
    () => conditionnements.filter((c) => c.ingredientId === selectionId),
    [conditionnements, selectionId],
  );

  const conditionnementChoisi = useMemo(
    () => conditionnementsDeLIngredient.find((c) => c.id === conditionnementId) ?? null,
    [conditionnementsDeLIngredient, conditionnementId],
  );

  /**
   * Fournisseurs proposables : les COMMERCIAUX actifs.
   *
   * « Inventaire d'ouverture » (type `systeme`) n'est pas un fournisseur : c'est
   * la contrepartie interne du stock présent avant l'installation. Un
   * conditionnement posé sur lui ne servirait jamais à générer une commande — le
   * serveur le refuse, l'écran ne le propose donc pas.
   *
   * Filtre désormais DÉLÉGUÉ à `fournisseursProposables`
   * (`@batte/core`, `packages/core/src/fournisseurs.ts` — mission « deux
   * restes de la chaîne d'achat », 31/07/2026, puis déplacée de l'écran
   * `Fournisseurs.tsx` vers `packages/core` le même jour) : cette copie
   * locale était correcte, mais recopiée à la main dans deux autres écrans qui,
   * eux, avaient divergé (voir cette fonction pour le détail complet). Même
   * comportement qu'avant, une seule fois.
   */
  const fournisseursProposables = useMemo(
    () => calculerFournisseursProposables(fournisseurs),
    [fournisseurs],
  );

  function choisir(fiche: IngredientComplet): void {
    setSelectionId(fiche.id);
    setBrouillon(versBrouillonIngredient(fiche));
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement({ phase: 'inchange' });
    setConditionnementId(null);
    setModeConditionnement('consultation');
  }

  function nouveau(): void {
    setSelectionId(null);
    setBrouillon(BROUILLON_INGREDIENT_VIDE);
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement({ phase: 'inchange' });
    setConditionnementId(null);
    setModeConditionnement('consultation');
    window.setTimeout(() => formulaireRef.current?.querySelector('input')?.focus(), 0);
  }

  function modifier<C extends keyof BrouillonIngredient>(
    champ: C,
    valeur: BrouillonIngredient[C],
  ): void {
    setBrouillon((precedent) => ({ ...precedent, [champ]: valeur }));
    setEnregistrement({ phase: 'modifie' });
    // Validation À LA SAUVEGARDE, jamais en direct — voir
    // `champsEnErreurApresModification` (`../composants/formulaire`) pour la
    // justification complète et partagée avec Produits et Lieux de marché.
    setChampsEnErreur(champsEnErreurApresModification);
  }

  function basculerAllergene(code: string, coche: boolean): void {
    setBrouillon((precedent) => ({
      ...precedent,
      allergenes: coche
        ? [...precedent.allergenes, code]
        : precedent.allergenes.filter((a) => a !== code),
    }));
    setEnregistrement({ phase: 'modifie' });
  }

  function focaliserPremierChampFautif(champs: ChampsEnErreur): void {
    const premier = Object.keys(champs)[0];
    if (premier === undefined) return;
    formulaireRef.current?.querySelector<HTMLElement>(`[name="${premier}"]`)?.focus();
  }

  function enregistrer(): void {
    // Garde contre la double écriture (défaut connu corrigé le 28/09/2026) :
    // le bouton « Enregistrer » est `disabled` pendant l'envoi, mais Ctrl+S
    // appelle cette fonction directement depuis le conteneur, sans passer
    // par lui. Sans ce retour, un second Ctrl+S repartait en réseau.
    if (enregistrement.phase === 'enregistrement') return;
    const corps = corpsSaisieIngredient(brouillon);

    /**
     * Le MÊME schéma que le serveur, rejoué ici avant tout aller-retour.
     *
     * Ce n'est pas de la duplication : c'est le seul et même code, importé de
     * `@batte/core`. Le gain est de refuser une densité non finie sans qu'elle
     * quitte jamais le navigateur — `JSON.stringify(NaN)` vaut `null`, donc une
     * densité illisible envoyée telle quelle serait reçue comme « pas de
     * densité », et l'utilisateur croirait avoir saisi une valeur.
     */
    const verification = schemaSaisieIngredient.safeParse(corps);
    if (!verification.success) {
      const champs = champsDepuisErreurZod(verification.error);
      setChampsEnErreur(champs);
      focaliserPremierChampFautif(champs);
      setEnregistrement({ phase: 'modifie' });
      return;
    }

    setErreurFormulaire(null);
    setEnregistrement({ phase: 'enregistrement' });

    // Capturé AVANT l'aller-retour : `selectionId` ne dit plus « création »
    // une fois la réponse posée, `setSelectionId` ci-dessous l'ayant déjà
    // remplacé par l'identifiant nouvellement créé.
    const etaitUneCreation = selectionId === null;
    const chemin = selectionId === null ? '/ingredients' : `/ingredients/${selectionId}`;
    const methode = selectionId === null ? 'POST' : 'PATCH';

    requeteApi<unknown>(chemin, { method: methode, body: JSON.stringify(corps) })
      .then(async (reponse) => {
        const enregistre = schemaIngredientComplet.parse(reponse);
        const referentiel = await charger();
        setEtat((precedent) =>
          precedent.statut === 'pret' ? { ...precedent, ...referentiel } : precedent,
        );
        setSelectionId(enregistre.id);
        setBrouillon(versBrouillonIngredient(enregistre));
        setChampsEnErreur({});
        setEnregistrement({ phase: 'enregistre', heure: heureCourante() });
        // Reprendre le focus une fois le bouton réactivé (voir le
        // commentaire de `boutonEnregistrerRef` plus haut) : sans ce rappel,
        // l'utilisateur retombe sur `<body>` après CHAQUE enregistrement et
        // doit retraverser tout le menu latéral pour continuer à saisir.
        requestAnimationFrame(() => boutonEnregistrerRef.current?.focus());
        // Une recherche active masquerait le nouvel ingrédient s'il ne
        // correspond pas au terme tapé pour VÉRIFIER qu'il n'existait pas
        // déjà — l'utilisateur croirait alors la création silencieusement
        // ratée, et retenterait, ce qui est exactement le doublon que la
        // recherche par synonymes doit éviter (fiche 09). Seule la CRÉATION
        // réinitialise le filtre ; corriger une fiche existante trouvée par
        // recherche ne doit pas faire sauter la liste sous les yeux.
        if (etaitUneCreation) setRecherche('');
      })
      .catch((erreur: unknown) => {
        setEnregistrement({ phase: 'modifie' });
        if (erreur instanceof ErreurApi && erreur.champs !== undefined) {
          setChampsEnErreur(erreur.champs);
          focaliserPremierChampFautif(erreur.champs);
          // Pas de bandeau EN PLUS des messages en ligne : un double
          // signalement fait chercher l'erreur deux fois (docs/07 §4.7).
          return;
        }
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
        // Même reprise de focus que sur le succès : ce bouton vient lui
        // aussi de se réactiver après avoir été désactivé le temps de
        // l'appel (voir `boutonEnregistrerRef`).
        requestAnimationFrame(() => boutonEnregistrerRef.current?.focus());
      });
  }

  function basculerActivite(): void {
    if (selection === null) return;

    requeteApi<unknown>(`/ingredients/${selection.id}/activite`, {
      method: 'PATCH',
      body: JSON.stringify({ actif: !selection.actif }),
    })
      .then(async (reponse) => {
        const modifie = schemaIngredientComplet.parse(reponse);
        const referentiel = await charger();
        setEtat((precedent) =>
          precedent.statut === 'pret' ? { ...precedent, ...referentiel } : precedent,
        );
        setBrouillon(versBrouillonIngredient(modifie));
        setEnregistrement({ phase: 'enregistre', heure: heureCourante() });
      })
      .catch((erreur: unknown) => {
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  /** Recharge après une écriture de conditionnement, et referme le formulaire. */
  async function apresEcritureConditionnement(id: string): Promise<void> {
    const referentiel = await charger();
    setEtat((precedent) =>
      precedent.statut === 'pret' ? { ...precedent, ...referentiel } : precedent,
    );
    setConditionnementId(id);
    setModeConditionnement('consultation');
  }

  return (
    <div
      className="flex flex-col gap-bloc"
      onKeyDown={(evenement) => {
        // Ctrl+S : raccourci d'enregistrement universel (docs/07 §4.6). Ni
        // Ctrl+N ni Ctrl+T ni Ctrl+W, qui sont réservés au navigateur.
        if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === 's') {
          evenement.preventDefault();
          enregistrer();
        }
      }}
    >
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Ingrédients</h1>
        <button type="button" onClick={nouveau} className={CLASSE_BOUTON_PRIMAIRE}>
          Nouvel ingrédient
        </button>
      </div>

      {/*
        Point de rupture à `lg` (1024 px) et JAMAIS à `xl` (1280 px) : la cible
        de conception est un viewport EFFECTIF de 1280x720 (Windows à 150 %),
        donc un `xl:` ferait retomber l'écran en colonne unique exactement à la
        résolution de travail.

        `minmax(0, …)` et non `5fr_4fr` tout court : un `fr` vaut
        `minmax(auto, Xfr)`, donc son plancher est la largeur de CONTENU MINIMAL
        de la colonne — un `<select>` long élargirait la colonne de droite et
        RÉTRÉCIRAIT le tableau, exactement l'inverse de l'intention.
      */}
      <div className="grid grid-cols-1 items-start gap-bloc lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        {/* ═══ Liste ══════════════════════════════════════════════════════ */}
        <Panneau titre="Liste des ingrédients" sansRembourrage>
          <div className="flex flex-col gap-groupe border-b border-line px-4 py-2">
            {/*
              Recherche par nom ET synonymes courants (fiche 09). C'est le
              point qui évite le doublon : chercher « cassonade » doit
              retrouver la « Vergeoise blonde » déjà en stock, sans quoi la
              saisie la plus rapide est d'en créer une seconde ligne.
              `type="search"` plutôt que `text` : le navigateur pose alors une
              croix d'effacement native, en plus du bouton ci-dessous — deux
              chemins clavier vers le même geste (Tab puis Entrée sur la croix,
              ou Tab jusqu'au bouton « Effacer »).
            */}
            <label className="flex flex-col gap-groupe text-sm text-ink-2">
              Rechercher un ingrédient
              <div className="flex items-center gap-groupe">
                <input
                  type="search"
                  value={recherche}
                  onChange={(evenement) => setRecherche(evenement.target.value)}
                  placeholder="Nom ou synonyme courant — « cassonade » trouve aussi la vergeoise"
                  aria-label="Rechercher un ingrédient par nom ou synonyme"
                  className="h-controle w-full rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                />
                {recherche !== '' && (
                  <button
                    type="button"
                    onClick={() => setRecherche('')}
                    className={`shrink-0 ${CLASSE_BOUTON_SECONDAIRE}`}
                  >
                    Effacer
                  </button>
                )}
              </div>
            </label>

            <label className="flex items-center gap-groupe text-sm text-ink-2">
              <input
                type="checkbox"
                checked={afficherRetires}
                onChange={(evenement) => setAfficherRetires(evenement.target.checked)}
              />
              Afficher aussi les ingrédients retirés
            </label>
          </div>

          {etat.statut === 'chargement' && (
            <p className="px-4 py-2 text-sm text-ink-3">Chargement des ingrédients…</p>
          )}

          {etat.statut === 'erreur' && (
            <div className="px-4 py-2">
              <MessageErreur message={etat.message} />
            </div>
          )}

          {etat.statut === 'pret' && (
            <Tableau
              colonnes={COLONNES}
              lignes={visibles}
              cleLigne={(i) => i.id}
              total={ingredients.length}
              libelleEntite="ingrédients"
              {...(selectionId !== null ? { ligneSelectionneeCle: selectionId } : {})}
              onSelectionnerLigne={choisir}
              etatVide={
                ingredients.length > 0 ? (
                  <EtatVide
                    variante="filtre"
                    explicationFiltre={
                      recherche.trim() !== ''
                        ? // Le vrai risque ici n'est pas l'ennui d'un filtre trop
                          // strict : c'est de croire que « cassonade » n'existe
                          // pas encore et d'en créer un doublon (fiche 09). Le
                          // message le dit explicitement plutôt que de renvoyer
                          // au chiffre brut sans explication.
                          `Aucun des ${ingredients.length} ingrédients enregistrés ne correspond à « ${recherche.trim()} », nom ou synonyme confondus. S'il s'agit bien d'un ingrédient nouveau, créez-le avec « Nouvel ingrédient ».`
                        : ingredients.length > 1
                          ? `Les ${ingredients.length} ingrédients enregistrés sont tous retirés, et le filtre les masque.`
                          : `L'unique ingrédient enregistré est retiré, et le filtre le masque.`
                    }
                    onReinitialiser={() => {
                      setRecherche('');
                      setAfficherRetires(true);
                    }}
                  />
                ) : (
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucun ingrédient enregistré"
                    explication="Saisissez ce que vous achetez : farines, produits laitiers, garnitures. Chaque ingrédient porte son unité de compte, sa densité et son stock de sécurité."
                    action={{ libelle: 'Créer un ingrédient', onClick: nouveau }}
                  />
                )
              }
            />
          )}
        </Panneau>

        {/* ═══ Fiche ══════════════════════════════════════════════════════ */}
        <Panneau titre={selection === null ? 'Nouvel ingrédient' : selection.nom}>
          <form
            ref={formulaireRef}
            className="flex flex-col gap-bloc"
            onSubmit={(evenement) => {
              evenement.preventDefault();
              enregistrer();
            }}
          >
            <ChampTexte
              nom="nom"
              libelle="Nom de l’ingrédient"
              valeur={brouillon.nom}
              onChange={(v) => modifier('nom', v)}
              erreur={champsEnErreur['nom']}
              obligatoire
            />

            <div className="grid grid-cols-2 gap-groupe">
              <ChampSelect
                nom="categorie"
                libelle="Catégorie"
                valeur={brouillon.categorie}
                onChange={(v) => modifier('categorie', v as CategorieIngredient)}
                erreur={champsEnErreur['categorie']}
                options={schemaCategorieIngredient.options.map((code) => ({
                  valeur: code,
                  libelle: LIBELLE_CATEGORIE_INGREDIENT[code],
                }))}
              />
              <ChampSelect
                nom="uniteReference"
                libelle="Unité de compte"
                valeur={brouillon.uniteReference}
                onChange={(v) => modifier('uniteReference', v as Unite)}
                erreur={champsEnErreur['uniteReference']}
                options={UNITES.map((unite) => ({ valeur: unite, libelle: libelleUnite(unite) }))}
                {...(selection !== null && (selection.nbLots > 0 || selection.nbLignesRecette > 0)
                  ? {
                      aide: `Figée : ${selection.nbLots} lot(s) et ${selection.nbLignesRecette} ligne(s) de recette sont déjà exprimés dans cette unité. La changer ne convertirait pas les quantités, elle les réinterpréterait.`,
                    }
                  : {})}
              />
            </div>

            {/* La densité n'est demandée que là où elle sert : une quantité en
                pièces ne se convertit ni en masse ni en volume, donc une densité
                posée sur un ingrédient compté à la pièce ne serait jamais lue. */}
            {brouillon.uniteReference !== 'piece' && (
              <ChampTexte
                nom="densiteGParMl"
                libelle="Densité (g/ml)"
                valeur={brouillon.densite}
                onChange={(v) => modifier('densite', v)}
                erreur={champsEnErreur['densiteGParMl']}
                numerique="decimal"
                aide="Sert à convertir une masse en volume et inversement — 240 ml de lait pesés en grammes, par exemple. Sans elle, l’application refuse la conversion plutôt que de deviner : une valeur fausse remonterait jusqu’au stock, à sa valorisation et au coût matière sans qu’aucune erreur ne soit levée. Laissez vide si aucune conversion n’est nécessaire."
              />
            )}

            <fieldset className="flex flex-col gap-groupe">
              <legend className="text-2xs uppercase text-ink-3">Allergènes déclarés</legend>
              {/* Liste RÉGLEMENTAIRE fermée (règlement UE 1169/2011, annexe II),
                  pas un champ libre : un allergène en texte libre serait
                  invisible sur l'affichette obligatoire du stand. */}
              <div className="grid grid-cols-2 gap-x-groupe">
                {CATALOGUE_ALLERGENES.map((allergene) => (
                  <label
                    key={allergene.code}
                    className="flex items-center gap-groupe text-xs text-ink-2"
                  >
                    <input
                      type="checkbox"
                      name={`allergene-${allergene.code}`}
                      checked={brouillon.allergenes.includes(allergene.code)}
                      onChange={(evenement) =>
                        basculerAllergene(allergene.code, evenement.target.checked)
                      }
                    />
                    {allergene.libelle}
                  </label>
                ))}
              </div>
              {champsEnErreur['allergenes'] !== undefined && (
                <span className="text-xs text-depassement">{champsEnErreur['allergenes']}</span>
              )}
            </fieldset>

            {/* Distingue « vérifié, aucun allergène » de « jamais évalué »
                (`ingredient.allergenes_verifies`) : tant que c'est décoché, les
                documents affichent « Allergènes non encore vérifiés » plutôt
                qu'une liste, même si `allergenes` ci-dessus est vide. Case à
                cocher NATIVE, atteignable au clavier par tabulation et
                actionnable par Espace (CLAUDE.md §3 règle 10) — aucun
                `div onClick`. */}
            <label className="flex items-center gap-groupe text-sm text-ink-2">
              <input
                type="checkbox"
                name="allergenesVerifies"
                checked={brouillon.allergenesVerifies}
                onChange={(evenement) => modifier('allergenesVerifies', evenement.target.checked)}
              />
              Allergènes vérifiés
            </label>
            <p className="-mt-groupe text-xs text-ink-3">
              Cochez une fois la liste ci-dessus contrôlée. Tant que c’est décoché, les documents
              affichent « allergènes non encore vérifiés » plutôt qu’une liste.
            </p>

            <div className="grid grid-cols-2 gap-groupe">
              <ChampTexte
                nom="stockSecurite"
                libelle={`Stock de sécurité (${libelleUnite(brouillon.uniteReference)})`}
                valeur={brouillon.stockSecurite}
                onChange={(v) => modifier('stockSecurite', v)}
                erreur={champsEnErreur['stockSecurite']}
                numerique="entier"
                aide="Point de commande = consommation moyenne × délai + stock de sécurité. Laissez vide si vous n’y avez pas encore réfléchi : cela équivaut à zéro tant que ce n’est pas précisé, et l’écran de réapprovisionnement ne peut alors rien alerter."
              />
              <ChampTexte
                nom="delaiLivraisonJours"
                libelle="Délai de livraison (jours)"
                valeur={brouillon.delaiLivraisonJours}
                onChange={(v) => modifier('delaiLivraisonJours', v)}
                erreur={champsEnErreur['delaiLivraisonJours']}
                numerique="entier"
              />
            </div>

            <ChampTexte
              nom="dureeConservationJours"
              libelle="Durée de conservation (jours)"
              valeur={brouillon.dureeConservationJours}
              onChange={(v) => modifier('dureeConservationJours', v)}
              erreur={champsEnErreur['dureeConservationJours']}
              numerique="entier"
              aide="Sert à proposer une DLC à la réception. Laissez vide si la DLC est toujours relevée sur l’emballage."
            />

            <ChampTexte
              nom="notes"
              libelle="Notes"
              valeur={brouillon.notes}
              onChange={(v) => modifier('notes', v)}
              erreur={champsEnErreur['notes']}
            />

            {erreurFormulaire !== null && <MessageErreur message={erreurFormulaire} />}

            <div className="flex items-center justify-between border-t border-line pt-3">
              <IndicateurEnregistrement etat={enregistrement} />
              <div className="flex items-center gap-groupe">
                {selection !== null && (
                  <button
                    type="button"
                    onClick={basculerActivite}
                    className={CLASSE_BOUTON_SECONDAIRE}
                  >
                    {selection.actif ? 'Retirer du référentiel' : 'Remettre en service'}
                  </button>
                )}
                <button
                  ref={boutonEnregistrerRef}
                  type="submit"
                  disabled={enregistrement.phase === 'enregistrement'}
                  className={CLASSE_BOUTON_PRIMAIRE}
                >
                  Enregistrer
                </button>
              </div>
            </div>

            {selection !== null && (
              <p className="text-xs text-ink-3">
                Un ingrédient ne se supprime pas : {selection.nbLots} lot(s) reçu(s) le référencent,
                et leur traçabilité AFSCA doit rester lisible. Retiré du référentiel, il disparaît
                des listes de choix mais reste dans l’historique.
              </p>
            )}
          </form>
        </Panneau>
      </div>

      {/* ═══ Conditionnements — LE PRIX ═══════════════════════════════════ */}
      {selection !== null && (
        <div className="grid grid-cols-1 items-start gap-bloc lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
          <Panneau titre={`Conditionnements — ${selection.nom}`} sansRembourrage>
            <Tableau
              colonnes={COLONNES_CONDITIONNEMENTS}
              lignes={conditionnementsDeLIngredient}
              cleLigne={(c) => c.id}
              {...(conditionnementId !== null ? { ligneSelectionneeCle: conditionnementId } : {})}
              onSelectionnerLigne={(c) => {
                setConditionnementId(c.id);
                setModeConditionnement('consultation');
              }}
              etatVide={
                <EtatVide
                  variante="premier-lancement"
                  titre="Aucun conditionnement"
                  explication="Sans format d’achat, cet ingrédient n’a pas de prix : le coût matière de toute recette qui le cite reste incalculable, et aucune commande ne peut être générée."
                  action={{
                    libelle: 'Ajouter un conditionnement',
                    onClick: () => {
                      setConditionnementId(null);
                      setModeConditionnement('creation');
                    },
                  }}
                />
              }
            />
            <div className="border-t border-line px-4 py-2">
              <p className="text-xs text-ink-3">
                Les lignes archivées restent affichées : c’est l’historique des prix, et c’est lui
                qui répond à « le meunier a-t-il augmenté ? ».
              </p>
            </div>
          </Panneau>

          <FormulaireConditionnement
            ingredient={selection}
            fournisseurs={fournisseursProposables}
            choisi={conditionnementChoisi}
            mode={modeConditionnement}
            onChangerMode={setModeConditionnement}
            onEcrit={apresEcritureConditionnement}
          />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Conditionnements : trois gestes distincts, jamais un « Modifier » unique
   ═══════════════════════════════════════════════════════════════════════════ */

type FormulaireConditionnementProps = {
  ingredient: IngredientComplet;
  fournisseurs: readonly Fournisseur[];
  choisi: Conditionnement | null;
  mode: ModeConditionnement;
  onChangerMode: (mode: ModeConditionnement) => void;
  onEcrit: (id: string) => Promise<void>;
};

/**
 * Le panneau qui porte LE PRIX.
 *
 * Quatre gestes, quatre écritures différentes, et la distinction est métier :
 *  - **ajouter** un format d'achat ;
 *  - **faire évoluer le tarif** — le prix était juste et change à partir d'une
 *    date. Une ligne datée s'ajoute, l'ancienne est archivée ; le passé reste
 *    lisible et le coût matière historique reste juste ;
 *  - **corriger la fiche** — la valeur saisie était fausse, elle n'a jamais été
 *    vraie. La ligne est réécrite en place, y compris pour les productions déjà
 *    chiffrées ;
 *  - **retirer le format** — le fournisseur ne le vend plus du tout. Le prix
 *    était juste et le reste ; c'est l'ARTICLE qui disparaît du catalogue, sans
 *    remplaçant tarifé. Seul geste des quatre qui n'écrit aucun prix.
 *
 * C'est exactement la distinction de D-042 pour les paramètres. Les trois
 * premiers boutons sont NOMMÉS, parce que seul l'utilisateur sait lequel
 * s'applique.
 */
function FormulaireConditionnement({
  ingredient,
  fournisseurs,
  choisi,
  mode,
  onChangerMode,
  onEcrit,
}: FormulaireConditionnementProps) {
  const [brouillon, setBrouillon] = useState<BrouillonConditionnement>({
    fournisseurId: '',
    libelle: '',
    quantiteUniteRef: '',
    prix: '',
    referenceFournisseur: '',
    datePrix: aujourdHuiCivil(),
  });
  const [champs, setChamps] = useState<ChampsEnErreur>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<'inactif' | 'envoi'>('inactif');
  const formulaire = useRef<HTMLFormElement>(null);
  // Mémorise le mode d'écriture qui vient de se refermer, pour rendre le
  // focus au bouton précis qui l'a ouvert (trois boutons distincts mènent à
  // trois modes distincts, voir plus bas).
  const modePrecedent = useRef<ModeConditionnement>(mode);
  const boutonTarif = useRef<HTMLButtonElement>(null);
  const boutonCorrection = useRef<HTMLButtonElement>(null);
  const boutonCreation = useRef<HTMLButtonElement>(null);

  // Le formulaire se recharge quand on change de mode ou de ligne choisie : une
  // saisie de correction ne doit jamais partir sur une autre ligne.
  useEffect(() => {
    setChamps({});
    setErreur(null);
    if (mode === 'correction' && choisi !== null) {
      setBrouillon(versBrouillonConditionnement(choisi));
      return;
    }
    if (mode === 'tarif' && choisi !== null) {
      setBrouillon({
        ...versBrouillonConditionnement(choisi),
        // Le prix et la date sont VIDES : ce sont les deux valeurs que le geste
        // change, les pré-remplir avec l'ancienne inviterait à valider sans lire.
        prix: '',
        datePrix: '',
      });
      return;
    }
    if (mode === 'creation') {
      setBrouillon({
        fournisseurId: '',
        libelle: '',
        quantiteUniteRef: '',
        prix: '',
        referenceFournisseur: '',
        datePrix: aujourdHuiCivil(),
      });
    }
  }, [mode, choisi]);

  useEffect(() => {
    if (mode !== 'consultation') {
      formulaire.current?.querySelector<HTMLElement>('input, select')?.focus();
    } else if (modePrecedent.current !== 'consultation') {
      // Un mode d'écriture vient de se refermer (Annuler ou écriture
      // réussie) : sans ce rappel, le focus retomberait sur `<body>` au
      // milieu d'une série de corrections de tarifs.
      const cible =
        modePrecedent.current === 'tarif'
          ? boutonTarif.current
          : modePrecedent.current === 'correction'
            ? boutonCorrection.current
            : boutonCreation.current;
      cible?.focus();
    }
    modePrecedent.current = mode;
  }, [mode]);

  // « Échap ferme » (docs/07 §4.6), même patron que les autres écrans.
  useEffect(() => {
    if (mode === 'consultation') return;
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key === 'Escape') onChangerMode('consultation');
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [mode, onChangerMode]);

  function focaliser(cibles: ChampsEnErreur): void {
    const premier = Object.keys(cibles)[0];
    if (premier === undefined) return;
    formulaire.current?.querySelector<HTMLElement>(`[name="${premier}"]`)?.focus();
  }

  function envoyer(
    chemin: string,
    methode: 'POST' | 'PATCH',
    corps: Record<string, unknown>,
  ): void {
    setEnvoi('envoi');
    setErreur(null);

    requeteApi<unknown>(chemin, { method: methode, body: JSON.stringify(corps) })
      .then(async (reponse) => {
        const ligne = schemaConditionnement.parse(reponse);
        await onEcrit(ligne.id);
      })
      .catch((cause: unknown) => {
        if (cause instanceof ErreurApi && cause.champs !== undefined) {
          setChamps(cause.champs);
          focaliser(cause.champs);
          return;
        }
        setErreur(
          cause instanceof ErreurApi ? cause.message : 'Erreur inattendue, sans plus de détail.',
        );
      })
      .finally(() => setEnvoi('inactif'));
  }

  /**
   * RETIRER un format d'achat que le fournisseur ne vend plus.
   *
   * Le geste qui manquait : `enregistrerNouveauTarif` désactive l'ancienne
   * ligne toute seule, mais un format simplement ABANDONNÉ — le meunier
   * remplace son sac de 25 kg par du 10 kg, sans nouveau tarif sur l'ancien —
   * n'avait aucun chemin pour sortir. Il restait servi au coût matière et aux
   * bons de commande indéfiniment.
   *
   * CE QUE FAIT RÉELLEMENT LA ROUTE (lu dans `changerActiviteConditionnement`,
   * `packages/db/src/depots/referentiel-ecriture.ts`) : elle bascule le seul
   * booléen `actif`, en transaction, avec journal d'audit. Elle n'efface RIEN
   * — ni la ligne, ni son prix, ni sa date. C'est ce qui rend l'écran honnête
   * de dire « retiré » et jamais « supprimé » : `commande_ligne` et
   * `economie_achat` portent chacune une clé étrangère vers cette ligne
   * (`packages/db/src/schema.ts`), et l'historique des prix reste la base de
   * valorisation (CLAUDE.md §3 règles 6 et 7).
   *
   * Même geste que les huit autres `…/activite` du dépôt : bouton secondaire,
   * libellé apparié actif/inactif, AUCUNE confirmation — aucun des huit n'en
   * pose, et le geste est réversible d'un clic.
   */
  function basculerActivite(): void {
    // Garde-fou réel de l'inertie : `aria-disabled` ci-dessous ANNONCE
    // l'indisponibilité sans retirer le focus, c'est ce test qui l'applique
    // (même motif que `BoutonDocument`, et la raison y est écrite en long).
    if (choisi === null || envoi === 'envoi') return;

    setEnvoi('envoi');
    setErreur(null);

    requeteApi<unknown>(`/conditionnements/${choisi.id}/activite`, {
      method: 'PATCH',
      body: JSON.stringify({ actif: !choisi.actif }),
    })
      .then(async (reponse) => {
        const ligne = schemaConditionnement.parse(reponse);
        await onEcrit(ligne.id);
      })
      .catch((cause: unknown) => {
        setErreur(
          cause instanceof ErreurApi ? cause.message : 'Erreur inattendue, sans plus de détail.',
        );
      })
      .finally(() => setEnvoi('inactif'));
  }

  function soumettre(): void {
    const prixCents = parserEuros(brouillon.prix);
    if (prixCents === null) {
      const cibles = { prixCents: 'Prix illisible. Exemple attendu : 18,75' };
      setChamps(cibles);
      focaliser(cibles);
      return;
    }

    if (mode === 'tarif' && choisi !== null) {
      envoyer(`/conditionnements/${choisi.id}/tarifs`, 'POST', {
        prixCents,
        datePrix: brouillon.datePrix,
        referenceFournisseur: brouillon.referenceFournisseur,
      });
      return;
    }

    const corps = {
      ingredientId: ingredient.id,
      fournisseurId: brouillon.fournisseurId,
      libelle: brouillon.libelle,
      quantiteUniteRef: nombreSaisi(brouillon.quantiteUniteRef),
      prixCents,
      referenceFournisseur: brouillon.referenceFournisseur,
      datePrix: brouillon.datePrix,
    };

    // Même schéma que le serveur, rejoué avant l'aller-retour.
    const verification = schemaSaisieConditionnement.safeParse(corps);
    if (!verification.success) {
      const cibles = champsDepuisErreurZod(verification.error);
      setChamps(cibles);
      focaliser(cibles);
      return;
    }

    if (mode === 'correction' && choisi !== null) {
      envoyer(`/conditionnements/${choisi.id}`, 'PATCH', corps);
      return;
    }
    envoyer('/conditionnements', 'POST', corps);
  }

  const titre =
    mode === 'creation'
      ? 'Nouveau conditionnement'
      : mode === 'tarif'
        ? 'Nouveau tarif'
        : mode === 'correction'
          ? 'Corriger la fiche'
          : 'Format d’achat';

  return (
    <Panneau titre={titre}>
      {mode === 'consultation' ? (
        <div className="flex flex-col gap-groupe">
          {choisi === null ? (
            <p className="text-sm text-ink-2">
              Choisissez un conditionnement dans la liste pour en changer le tarif, ou ajoutez-en
              un.
            </p>
          ) : (
            <dl className="flex flex-col gap-1 text-sm">
              <LigneFiche libelle="Fournisseur" valeur={choisi.fournisseurNom} />
              <LigneFiche
                libelle="Contenance"
                valeur={formaterQuantite(choisi.quantiteUniteRef, choisi.uniteReference)}
              />
              <LigneFiche libelle="Prix" valeur={`${formaterMontant(choisi.prixCents)} €`} />
              <LigneFiche libelle="En vigueur depuis le" valeur={choisi.datePrix} />
              <LigneFiche
                libelle="Référence fournisseur"
                valeur={ouTiret(choisi.referenceFournisseur, (r) => r)}
              />
            </dl>
          )}

          <div className="flex flex-col gap-groupe border-t border-line pt-3">
            {/* Deux actions NOMMÉES, jamais un « Modifier » unique : le choix
                entre rectifier une erreur et acter une hausse de tarif est
                métier, et l'utilisateur seul peut le faire. */}
            {choisi !== null && choisi.actif && (
              <>
                <button
                  type="button"
                  ref={boutonTarif}
                  onClick={() => onChangerMode('tarif')}
                  className={CLASSE_BOUTON_PRIMAIRE}
                >
                  Enregistrer un nouveau tarif
                </button>
                <button
                  type="button"
                  ref={boutonCorrection}
                  onClick={() => onChangerMode('correction')}
                  className={CLASSE_BOUTON_SECONDAIRE}
                >
                  Corriger la fiche
                </button>
                <p className="text-xs text-ink-3">
                  Un nouveau tarif ajoute une ligne datée et archive celle-ci : le passé reste
                  lisible, et le coût matière déjà calculé ne bouge pas. Corriger réécrit cette
                  ligne à sa date d’origine, y compris pour les productions déjà chiffrées —
                  réservez-le à une faute de frappe.
                </p>
              </>
            )}
            {choisi !== null && !choisi.actif && (
              <p className="text-xs text-ink-3">
                Cette ligne est archivée : c’est de l’historique de prix. Repartez du tarif actif
                pour enregistrer une évolution.
              </p>
            )}

            {/*
              RENDU HORS des deux blocs conditionnels ci-dessus, et c'est
              délibéré : placé à l'intérieur, le bouton serait DÉMONTÉ à
              l'instant où `actif` bascule, et le focus de l'utilisateur qui
              vient de l'actionner retomberait sur `<body>` — le défaut corrigé
              trois fois le 01/08/2026. Ici sa position parmi ses frères ne
              change pas, React réutilise le même nœud, et le focus survit au
              seul changement de libellé.

              `aria-disabled` et non `disabled` pendant l'aller-retour, pour la
              même raison, développée en tête de `BoutonDocument` : un
              `<button disabled>` qui a le focus le perd. L'inertie vient du
              garde-fou de `basculerActivite`, pas de l'attribut.
            */}
            {choisi !== null && (
              <button
                type="button"
                aria-disabled={envoi === 'envoi'}
                onClick={basculerActivite}
                className={CLASSE_BOUTON_SECONDAIRE}
              >
                {choisi.actif ? 'Retirer ce format d’achat' : 'Remettre ce format en service'}
              </button>
            )}

            {choisi !== null && (
              <p className="text-xs text-ink-3">
                {choisi.actif
                  ? /*
                      Ce que la désactivation fait VRAIMENT : elle ne retire la
                      ligne d'aucune table, elle la sort des lectures qui
                      filtrent `actif`. Dérivé de la source, jamais compté à la
                      main (docs/39 §2) — les symboles, à ce jour :
                      `coutsDeReference` et `coutsUnitaires` pour le coût
                      matière, `conditionnementReference` pour le choix du
                      fournisseur à qui commander, `detecterEconomie` pour la
                      renégociation, `compteursIngredients` et
                      `conditionnementsParFournisseur` pour les compteurs
                      affichés. Une première rédaction disait « les TROIS
                      lectures » : il y en a sept, et un décompte écrit à la
                      main dans un commentaire n'a aucun moyen de rester vrai.

                      Rien sur la RÉCEPTION, en revanche : `LigneReception`
                      porte un ingrédient, une quantité et un prix payé, jamais
                      un conditionnement. Les seules clés étrangères vers cette
                      ligne sont `commande_ligne` et `economie_achat`.
                    */
                    'Un format d’achat ne se supprime pas : des commandes déjà passées le référencent, et son prix reste la base de valorisation des lots reçus à l’époque. Retiré, il ne sert plus au coût matière ni aux bons de commande, mais cette ligne et son prix restent affichés ici.'
                  : // La mise en garde qui manquerait sinon : deux lignes
                    // actives pour le même article donnent deux prix en
                    // circulation et un inventaire fournisseur faux — c'est le
                    // raisonnement écrit dans `enregistrerNouveauTarif`.
                    'Remettre ce format en service le rend à nouveau disponible pour le coût matière et les bons de commande. S’il avait été archivé par un changement de tarif, deux prix coexisteraient alors pour le même article : corrigez d’abord la ligne devenue caduque.'}
              </p>
            )}

            {/*
              Le bandeau d'erreur vivait UNIQUEMENT dans la branche formulaire :
              un refus du serveur sur ce bouton-ci aurait posé `erreur` sans que
              rien ne s'affiche. Un échec muet est pire qu'un échec.
            */}
            {erreur !== null && <MessageErreur message={erreur} />}

            <button
              type="button"
              ref={boutonCreation}
              onClick={() => onChangerMode('creation')}
              className={CLASSE_BOUTON_SECONDAIRE}
            >
              Ajouter un conditionnement
            </button>
          </div>
        </div>
      ) : (
        <form
          ref={formulaire}
          className="flex flex-col gap-bloc"
          onSubmit={(evenement) => {
            evenement.preventDefault();
            soumettre();
          }}
        >
          {mode === 'tarif' && choisi !== null && (
            <p className="border-l-2 border-accent-line bg-accent-subtle px-3 py-2 text-xs text-ink-2">
              « {choisi.libelle} » chez {choisi.fournisseurNom} — tarif en vigueur :{' '}
              {formaterMontant(choisi.prixCents)} € depuis le {choisi.datePrix}. La nouvelle date
              doit être postérieure, sinon le nouveau prix ne serait jamais retenu.
            </p>
          )}

          {mode !== 'tarif' && (
            <>
              <ChampSelect
                nom="fournisseurId"
                libelle="Fournisseur"
                valeur={brouillon.fournisseurId}
                onChange={(v) => setBrouillon((p) => ({ ...p, fournisseurId: v }))}
                erreur={champs['fournisseurId']}
                options={fournisseurs.map((f) => ({ valeur: f.id, libelle: f.nom }))}
                optionVide="Choisir un fournisseur…"
              />
              <ChampTexte
                nom="libelle"
                libelle="Libellé du format d’achat"
                valeur={brouillon.libelle}
                onChange={(v) => setBrouillon((p) => ({ ...p, libelle: v }))}
                erreur={champs['libelle']}
                obligatoire
                aide="C’est ce libellé qui figure sur le bon de commande envoyé au fournisseur : « Sac 25 kg »."
              />
              <ChampTexte
                nom="quantiteUniteRef"
                libelle={`Contenance (${libelleUnite(ingredient.uniteReference)})`}
                valeur={brouillon.quantiteUniteRef}
                onChange={(v) => setBrouillon((p) => ({ ...p, quantiteUniteRef: v }))}
                erreur={champs['quantiteUniteRef']}
                numerique="entier"
                aide="Elle divise le prix : c’est elle qui donne le coût unitaire, jamais un prix unitaire saisi à part."
              />
            </>
          )}

          <div className="grid grid-cols-2 gap-groupe">
            <ChampTexte
              nom="prixCents"
              libelle="Prix payé (€)"
              valeur={brouillon.prix}
              onChange={(v) => setBrouillon((p) => ({ ...p, prix: v }))}
              erreur={champs['prixCents']}
              numerique="decimal"
            />
            <ChampTexte
              nom="datePrix"
              libelle="Prix en vigueur le"
              type="date"
              valeur={brouillon.datePrix}
              onChange={(v) => setBrouillon((p) => ({ ...p, datePrix: v }))}
              erreur={champs['datePrix']}
            />
          </div>

          <ChampTexte
            nom="referenceFournisseur"
            libelle="Référence article du fournisseur"
            valeur={brouillon.referenceFournisseur}
            onChange={(v) => setBrouillon((p) => ({ ...p, referenceFournisseur: v }))}
            erreur={champs['referenceFournisseur']}
            aide="Celle qu’on cite au téléphone. Facultative."
          />

          {erreur !== null && <MessageErreur message={erreur} />}

          <div className="flex items-center justify-end gap-groupe border-t border-line pt-3">
            <button
              type="button"
              onClick={() => onChangerMode('consultation')}
              className={CLASSE_BOUTON_SECONDAIRE}
            >
              Annuler
            </button>
            <button type="submit" disabled={envoi === 'envoi'} className={CLASSE_BOUTON_PRIMAIRE}>
              {mode === 'tarif' ? 'Enregistrer le tarif' : 'Enregistrer'}
            </button>
          </div>
        </form>
      )}
    </Panneau>
  );
}
