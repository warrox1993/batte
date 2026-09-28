import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GLYPHE_STATUT,
  TIRET_ABSENT,
  avertissementCoutRevientInconnu,
  formaterMontant,
  formaterPourcent,
  ouTiret,
  parserEuros,
  schemaListeCoutsProduits,
  schemaListeIngredients,
  schemaListeMenus,
  schemaListeProduits,
  schemaListeRecettes,
  schemaProduit,
  type ChampsEnErreur,
  type ConsommationUnite,
  type CoutProduitVenduContrat,
  type IngredientReferentiel,
  type MenuResume,
  type NatureProduitVente,
  type Produit,
  type RecetteResume,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { champsEnErreurApresModification } from '../composants/formulaire';
import { MessageErreur } from '../composants/EncartErreur';
import {
  ChampTexte,
  ChampSelect,
  IndicateurEnregistrement,
  type EtatEnregistrement,
} from '../composants/champs-formulaire';
import { ErreurApi, requeteApi } from '../lib/api';

/**
 * Ecran Produits (docs/06 — groupe RÉFÉRENTIEL) : la carte de ce qui se vend.
 *
 * POURQUOI LA NATURE EST LE PREMIER CHAMP DU FORMULAIRE, ET PAS UN DÉTAIL.
 *
 * Un produit TRANSFORMÉ sort d'une recette et consomme du stock d'ingrédients
 * (marge ≈ 90 %). Un produit REVENDU est acheté préemballé et revendu tel quel
 * (marge ≈ 30-40 %), stock géré à l'unité, sans recette. À marge égale, la
 * revente génère environ 2,6 fois plus de CHIFFRE D'AFFAIRES — et les seuils
 * légaux belges portent sur le CA, pas sur la marge (CLAUDE.md §6). Un pot de
 * sirop enregistré par erreur en « transformé » fausse donc la ventilation des
 * compteurs de seuils, et l'utilisateur sort de la franchise TVA sans l'avoir
 * vu venir.
 *
 * L'interface rend cette faute DIFFICILE À COMMETTRE, pas seulement refusée
 * après coup : la nature commande l'affichage, et le champ de rattachement qui
 * n'a pas de sens pour la nature choisie n'est simplement pas rendu. Le serveur
 * revalide malgré tout, avec le même schéma Zod partagé — l'interface guide,
 * elle ne fait pas foi.
 *
 * Règle d'architecture n°1 : aucun calcul métier ici.
 */

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | {
      statut: 'pret';
      produits: Produit[];
      recettes: RecetteResume[];
      ingredients: IngredientReferentiel[];
      /**
       * Résumé des menus déjà composés (`GET /api/menus`) — pas les produits
       * de nature `menu` eux-mêmes, mais ceux qui ont AU MOINS un composant
       * déclaré (`listerMenus`, `packages/db/src/depots/menus.ts`). Sert
       * uniquement à distinguer, pour un produit de nature `menu` sélectionné
       * ici, « composition déjà déclarée » de « menu encore vide » : un menu
       * vide n'y figure pas.
       */
      menus: MenuResume[];
      /**
       * Coût de revient catalogue (`GET /api/couts-produits`) : part de pâte
       * ou d'achat + garnitures, marge unitaire — calculé, testé et servi par
       * l'API, mais jusqu'ici jamais lu par cet écran (audit du 30/07/2026).
       * Au plus une ligne par produit `transforme` ou `revendu` ; un `menu`
       * n'y figure jamais (`listerCoutsRevientProduits`,
       * `packages/db/src/depots/recettes.ts`, l'omet volontairement — son
       * coût se déduit de ses composants sur l'écran Menus, un calcul
       * distinct). Voir `affichageCoutRevientProduit` ci-dessous.
       */
      couts: CoutProduitVenduContrat[];
    };

/** Filtre de nature. `tous` n'est pas une nature : c'est l'absence de filtre. */
type FiltreNature = 'tous' | NatureProduitVente;

export type Brouillon = {
  nom: string;
  nature: NatureProduitVente;
  /**
   * Ce qu'UNE unité vendue consomme de la production — LA VRAIE QUESTION
   * (fiche 15 §4/§5.1, décision du porteur du 31/07/2026), posée seulement
   * quand `nature === 'transforme'` : c'est elle qui commande quel champ de
   * suite (`nbCrepes` ou `volumeMlParUnite`) l'écran affiche ensuite. `''` =
   * pas encore choisi (nouveau produit transformé), ou sans objet (nature
   * différente de `transforme`).
   */
  consommationUnite: ConsommationUnite | '';
  recetteId: string;
  ingredientId: string;
  prix: string;
  /** Pertinent seulement quand `consommationUnite === 'crepes'`. */
  nbCrepes: string;
  /**
   * Volume (ml) qu'UNE unité vendue représente. Pertinent seulement quand
   * `consommationUnite === 'volume_pate'` : c'est le cas de la PÂTE VENDUE
   * TELLE QUELLE (fiche 15 §5.1), pas des crêpes cuites. Ignoré et envoyé à
   * `null` dans tous les autres cas — voir `corpsSaisieProduit`.
   */
  volumeMlParUnite: string;
  categorie: string;
  consommationSurPlace: boolean;
};

const BROUILLON_VIDE: Brouillon = {
  nom: '',
  nature: 'transforme',
  consommationUnite: 'crepes',
  recetteId: '',
  ingredientId: '',
  prix: '',
  nbCrepes: '1',
  volumeMlParUnite: '',
  categorie: '',
  consommationSurPlace: false,
};

/**
 * Trois natures, trois libelles EXPLICITES.
 *
 * Un ternaire `transforme ? … : 'Revendu'` etiquetait un menu comme « Revendu »
 * — faux, et invisible a la lecture. Un `switch` exhaustif force le compilateur
 * a signaler la prochaine nature ajoutee, au lieu de la ranger en silence dans
 * la derniere branche.
 */
function libelleNature(nature: NatureProduitVente): string {
  switch (nature) {
    case 'transforme':
      return 'Transformé';
    case 'revendu':
      return 'Revendu';
    case 'menu':
      return 'Menu';
  }
}

function versBrouillon(produit: Produit): Brouillon {
  return {
    nom: produit.nom,
    nature: produit.nature,
    consommationUnite: produit.consommationUnite ?? '',
    recetteId: produit.recetteId ?? '',
    ingredientId: produit.ingredientId ?? '',
    prix: formaterMontant(produit.prixCents),
    nbCrepes: produit.nbCrepes === null ? '' : String(produit.nbCrepes),
    volumeMlParUnite: produit.volumeMlParUnite === null ? '' : String(produit.volumeMlParUnite),
    categorie: produit.categorie ?? '',
    consommationSurPlace: produit.consommationSurPlace,
  };
}

/**
 * Corps envoyé à `POST /produits` ou `PATCH /produits/:id`, à partir du
 * brouillon du formulaire — une fois la saisie jugée valide par
 * `corpsDepuisBrouillon` (même patron que `corpsSaisieIngredient`,
 * `Ingredients.tsx`).
 *
 * Extraite en fonction PURE et exportée pour prouver, sans monter tout
 * l'écran, que la nature `menu` — jusqu'ici inatteignable depuis
 * ce formulaire — produit bien `nature: 'menu'` avec `recetteId` et
 * `ingredientId` à `null`, jamais une valeur orpheline d'une nature
 * précédente : c'est exactement ce que `verifierCoherenceProduit`
 * (`packages/core/src/contrats/referentiel.ts`) exige d'un menu.
 *
 * `consommationUnite` REMPLACE l'ancienne déduction « `nbCrepes === 0` =
 * pâte vendue au volume » (fiche 15 §4/§5.1, décision du porteur du
 * 31/07/2026) : `nbCrepes` et `volumeMlParUnite` sont désormais DÉRIVÉS de ce
 * choix plutôt que lus tels quels dans les champs de suite — `nbCrepes` vaut
 * TOUJOURS `0` pour `volume_pate` et `nomenclature` (jamais `null`, jamais
 * lu depuis un champ éventuellement caché), exactement la valeur EXPLICITE
 * qu'exige `verifierConsommationUniteTransforme` (même fichier que
 * `verifierCoherenceProduit`). Ne recalcule PAS d'erreurs : la présence de
 * `consommationUnite` et la validité du champ de suite ont déjà été jugées
 * par `erreursSaisieProduit`, appelée juste avant par `corpsDepuisBrouillon`.
 */
export function corpsSaisieProduit(brouillon: Brouillon): Record<string, unknown> {
  const consommationUnite =
    brouillon.nature === 'transforme' && brouillon.consommationUnite !== ''
      ? brouillon.consommationUnite
      : null;

  const saisieNbCrepes = brouillon.nbCrepes.trim();
  const nbCrepes =
    consommationUnite === null
      ? null
      : consommationUnite === 'crepes'
        ? /^\d+$/.test(saisieNbCrepes)
          ? Number.parseInt(saisieNbCrepes, 10)
          : null
        : // `volume_pate` et `nomenclature` ne consomment aucune crêpe : la
          // valeur est TOUJOURS 0, jamais lue dans un champ que l'écran a
          // pu masquer — sans quoi un champ resté à une ancienne valeur
          // (5 crêpes, par exemple) partirait au serveur sans correction.
          0;

  const saisieVolume = brouillon.volumeMlParUnite.trim();
  const volumeMlParUnite =
    consommationUnite === 'volume_pate' &&
    /^\d+$/.test(saisieVolume) &&
    Number.parseInt(saisieVolume, 10) > 0
      ? Number.parseInt(saisieVolume, 10)
      : null;

  return {
    nom: brouillon.nom,
    nature: brouillon.nature,
    // Les champs sans objet pour la nature choisie partent explicitement à
    // `null`, jamais à `''` : le contrat les normaliserait, mais l'intention
    // doit être lisible ici aussi. Un menu (comme un revendu) n'a ni recette
    // ni crêpes propres — seul un transformé en a.
    recetteId: brouillon.nature === 'transforme' ? brouillon.recetteId : null,
    ingredientId: brouillon.nature === 'revendu' ? brouillon.ingredientId : null,
    prixCents: parserEuros(brouillon.prix),
    consommationUnite,
    nbCrepes,
    volumeMlParUnite,
    categorie: brouillon.categorie,
    consommationSurPlace: brouillon.consommationSurPlace,
  };
}

/**
 * Validation LOCALE du brouillon, avant tout aller-retour — même esprit que
 * `schemaSaisieIngredient`/`schemaSaisieLieu` rejoués côté navigateur
 * (`Ingredients.tsx`, `LieuxMarche.tsx`), mais ici à la main : `prixCents` a
 * besoin de `parserEuros` (conversion euros -> centimes) AVANT toute règle
 * Zod, exactement comme le tarif d'emplacement de `LieuxMarche.tsx`.
 *
 * Extraite en fonction PURE et exportée : elle prouve, sans monter tout
 * l'écran, quel champ un prix vide ou un nombre de crêpes illisible désigne
 * en premier — c'est CE nom de champ que `focaliserPremierChampFautif` doit
 * atteindre. Défaut mesuré (recette clavier du 30/07/2026) : cette validation
 * existait déjà, mais `corpsDepuisBrouillon` posait les erreurs sans jamais
 * appeler `focaliserPremierChampFautif`, contrairement à Ingrédients et
 * Lieux de marché — le focus restait sur le bouton « Enregistrer », sans
 * rien qui guide vers le champ fautif. La fonction est désormais la SEULE
 * source des erreurs locales, appelée par `corpsDepuisBrouillon` ci-dessous,
 * qui enchaîne toujours `setChampsEnErreur` ET `focaliserPremierChampFautif`
 * ensemble — jamais l'un sans l'autre.
 */
export function erreursSaisieProduit(brouillon: Brouillon): ChampsEnErreur {
  const erreurs: ChampsEnErreur = {};

  if (parserEuros(brouillon.prix) === null) {
    erreurs['prixCents'] = 'Prix illisible. Exemple attendu : 3,50';
  }

  if (brouillon.nature === 'transforme') {
    if (brouillon.consommationUnite === '') {
      erreurs['consommationUnite'] =
        'Précisez ce qu’une unité vendue consomme : des crêpes, un volume de pâte, ou rien de la production.';
    } else if (brouillon.consommationUnite === 'crepes') {
      const saisie = brouillon.nbCrepes.trim();
      if (!/^\d+$/.test(saisie) || Number.parseInt(saisie, 10) < 1) {
        erreurs['nbCrepes'] =
          'Indiquez un nombre entier de crêpes consommées par unité vendue, au moins 1.';
      }
    } else if (brouillon.consommationUnite === 'volume_pate') {
      // Pâte vendue telle quelle (fiche 15 §5.1). Sans ce volume, la clôture
      // au volume recompterait la bouteille en crêpes — exactement le défaut
      // que la fiche signale comme urgent. Avertir ici plutôt que laisser le
      // serveur seul le refuser : même philosophie que l'avertissement de
      // lot de référence de l'écran Nomenclature de vente.
      const saisieVolume = brouillon.volumeMlParUnite.trim();
      if (!/^\d+$/.test(saisieVolume) || Number.parseInt(saisieVolume, 10) <= 0) {
        erreurs['volumeMlParUnite'] =
          'De la pâte vendue au volume doit indiquer le volume (ml) qu’une unité représente, sinon elle serait recomptée en crêpes à la clôture.';
      }
    }
    // 'nomenclature' (le café, un consommable…) : rien à valider ici — sa
    // composition se déclare à part, sur l'écran Nomenclature de vente, une
    // fois ce produit enregistré.
  }

  return erreurs;
}

/**
 * Ce que la fiche affiche pour le coût de revient et la marge d'UN produit, à
 * partir de la ligne que `GET /couts-produits` rend pour lui (`cout`,
 * `undefined` si la liste n'en porte aucune pour cet identifiant).
 */
export type AffichageCoutRevientProduit = {
  readonly coutMatiere: string;
  readonly marge: string;
  readonly margeTaux: string;
  readonly avertissement: string | null;
};

/**
 * Met en forme le coût de revient calculé côté serveur (`coutRevientProduit`,
 * `packages/db/src/depots/recettes.ts`, servi par `GET /couts-produits` et
 * `GET /produits/:id/cout-revient`, `apps/api/src/routes/recettes.ts:110-119`)
 * — AUCUN calcul ici, seulement la décision d'écriture (règle d'architecture
 * n°1, CLAUDE.md §3).
 *
 * LE CŒUR DE LA DÉCISION : `coutMatiereCents` et `margeCents` valent `null`
 * dès qu'une composante est inconnue (recette vide, ingrédient jamais
 * réceptionné, article revendu sans conditionnement actif) — et cette
 * fonction les écrit alors `—` (`TIRET_ABSENT`, via `ouTiret`), JAMAIS
 * `0,00`. Un coût affiché à zéro fabriquerait une marge à 100 % : exactement
 * le défaut que `avertissementCoutMatiereTransforme`
 * (`packages/db/src/services/sessions.ts`) signale déjà à la clôture d'une
 * session — même doctrine, appliquée ici au catalogue plutôt qu'à une vente
 * encaissée.
 *
 * UN MENU N'A PAS DE COÛT DE REVIENT AU SENS DE CES DEUX ROUTES : sa nature
 * est absente de `schemaCoutProduitVendu` (`nature: z.enum(['transforme',
 * 'revendu'])`, `packages/core/src/contrats/recettes.ts`), et
 * `listerCoutsRevientProduits` l'omet purement et simplement de la liste
 * (`coutRevientProduit` rend `null` pour un menu, jamais une ligne à zéro).
 * Son coût se déduit de ses composants, un calcul distinct exposé par
 * `POST /menus/:menuId/ventilation` (écran Menus) — pas reproduit ici. `cout`
 * est donc ignoré pour un menu, qu'il soit défini ou non : le premier bloc
 * ci-dessous court-circuite avant de le lire.
 *
 * LA TROISIÈME CAUSE, NOMMÉE LIGNE PAR LIGNE (mission du 01/08/2026) : parmi
 * `cout.composants` (nomenclature de vente, fiche 15), seuls ceux INCLUS
 * dans le total (`inclusDansLeCout`) et sans prix connu
 * (`cumpCentsParUnite === null`) sont réellement la cause d'un
 * `coutMatiereCents` inconnu — un composant optionnel ou hors mode de
 * consommation sans prix ne compte pour rien dans le total, lui donner la
 * parole désignerait le mauvais coupable. Cette liste, quand elle n'est pas
 * vide, prime sur le message générique (recette/achat) dans
 * `avertissementCoutRevientInconnu` : nommer LE composant vaut mieux que
 * nommer une classe de cause.
 */
export function affichageCoutRevientProduit(
  nature: NatureProduitVente,
  cout: CoutProduitVenduContrat | undefined,
): AffichageCoutRevientProduit {
  if (nature === 'menu') {
    return {
      coutMatiere: TIRET_ABSENT,
      marge: TIRET_ABSENT,
      margeTaux: TIRET_ABSENT,
      avertissement:
        'Un menu n’a pas de coût de revient propre : il se déduit de ses composants, sur l’écran Menus.',
    };
  }

  if (cout === undefined) {
    // La liste n'est pas encore chargée, ou (ne devrait pas arriver pour un
    // transforme/revendu : seul un menu est filtré par
    // `listerCoutsRevientProduits`) le produit lui manque. Un tiret plutôt
    // qu'une supposition — surtout pas un avertissement fabriqué sans donnée.
    return {
      coutMatiere: TIRET_ABSENT,
      marge: TIRET_ABSENT,
      margeTaux: TIRET_ABSENT,
      avertissement: null,
    };
  }

  const composantsSansPrix = cout.composants
    .filter((c) => c.inclusDansLeCout && c.cumpCentsParUnite === null)
    .map((c) => c.nomIngredient);

  return {
    coutMatiere: ouTiret(cout.coutMatiereCents, formaterMontant),
    marge: ouTiret(cout.margeCents, formaterMontant),
    margeTaux: ouTiret(cout.margeBp, formaterPourcent),
    avertissement:
      cout.coutMatiereCents === null
        ? avertissementCoutRevientInconnu(nature, composantsSansPrix)
        : null,
  };
}

function heureCourante(): string {
  return new Intl.DateTimeFormat('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(new Date());
}

/**
 * QUATRE colonnes, pas cinq.
 *
 * A la resolution cible (viewport effectif 1280x720, docs/07 §4.4), ce panneau
 * retombe a ~460 px. Une colonne « Rattaché à » supplementaire tronquait les
 * EN-TETES (« NAT… », « RATTACHÉ… », « PRI… ») : un en-tete tronque ne se
 * devine pas. Le rattachement est donc lu dans la fiche de droite, ou il est
 * entier — tandis que la NATURE, elle, reste dans la liste : c'est la
 * distinction structurante de cet ecran, celle qui pilote la ventilation des
 * compteurs de seuils legaux. Entre les deux, c'est la nature qui gagne.
 */
const COLONNES: ReadonlyArray<ColonneTableau<Produit>> = [
  {
    /**
     * `repli` et non ellipse, et c'est une correction de SÛRETÉ, pas de confort.
     *
     * Les noms de produits partagent leur début (« Crêpe froment / … ») et se
     * distinguent par leur FIN — exactement ce que l'ellipse coupe en premier.
     * Deux produits différents s'affichaient donc « Crêpe fro… » tous les deux.
     * Or choisir la mauvaise ligne ici, c'est éditer le mauvais produit : la
     * nature décide de la marge et donc du compteur de seuil légal. Une liste
     * où deux entrées sont indiscernables ruine ce que cet écran existe pour
     * empêcher.
     *
     * La densité n'est payée que par les rangées qui débordent réellement :
     * `height` sur une cellule est un minimum, donc une ligne courte reste à
     * 32 px. Pas de `titre` ici — la valeur entière est rendue, une infobulle
     * qui répéterait le texte visible serait du bruit.
     */
    cle: 'nom',
    libelle: 'Produit',
    // Mesuré à 1280 px (docs/07 §4.4) : 44 % laissait « Prix (€) » et
    // « Transformé » se tronquer sur les colonnes voisines. `repli` absorbe la
    // largeur cédée sans jamais couper le nom, qui reste l'identifiant.
    largeur: '36%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (p) => p.nom,
  },
  {
    // « Transformé » / « Revendu » / « Menu » : contenu BORNÉ, mais
    // « Transformé » (10 lettres) se coupait en « Transfor… » à 20 %.
    cle: 'nature',
    libelle: 'Nature',
    largeur: '24%',
    alignement: 'texte',
    rendu: (p) => libelleNature(p.nature),
    titre: (p) => libelleNature(p.nature),
  },
  {
    // L'unité va dans l'en-tête, jamais répétée dans la cellule (docs/07 §4.5).
    // 20 % : l'en-tête « PRIX (€) » se coupait en « PRIX (… » à 16 %.
    cle: 'prix',
    libelle: 'Prix (€)',
    largeur: '20%',
    alignement: 'nombre',
    rendu: (p) => formaterMontant(p.prixCents),
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    largeur: '20%',
    alignement: 'texte',
    rendu: (p) =>
      p.actif ? (
        <span className="text-ink-2">En vente</span>
      ) : (
        <span className="text-ink-3">Retiré</span>
      ),
  },
];

export default function Produits() {
  const navigate = useNavigate();
  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon>(BROUILLON_VIDE);
  const [champsEnErreur, setChampsEnErreur] = useState<ChampsEnErreur>({});
  const [erreurFormulaire, setErreurFormulaire] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState<EtatEnregistrement>({ phase: 'inchange' });
  const [filtreNature, setFiltreNature] = useState<FiltreNature>('tous');
  const [afficherRetires, setAfficherRetires] = useState(false);

  const formulaireRef = useRef<HTMLFormElement>(null);

  const chargerProduits = useCallback(async (): Promise<Produit[]> => {
    const reponse = await requeteApi<unknown>('/produits');
    return schemaListeProduits.parse(reponse).data;
  }, []);

  /**
   * `GET /couts-produits` (`apps/api/src/routes/recettes.ts:110-113`) : coût
   * de revient catalogue, UNE liste pour tous les produits à la fois — c'est
   * exactement ce que le commentaire de cette route demande (« l'écran
   * Produits a besoin de la colonne pour toutes ses lignes à la fois »), pas
   * un appel par produit.
   */
  const chargerCouts = useCallback(async (): Promise<CoutProduitVenduContrat[]> => {
    const reponse = await requeteApi<unknown>('/couts-produits');
    return schemaListeCoutsProduits.parse(reponse).data;
  }, []);

  useEffect(() => {
    let annule = false;

    Promise.all([
      chargerProduits(),
      requeteApi<unknown>('/recettes').then((r) => schemaListeRecettes.parse(r).data),
      requeteApi<unknown>('/ingredients').then((r) => schemaListeIngredients.parse(r).data),
      requeteApi<unknown>('/menus').then((r) => schemaListeMenus.parse(r).data),
      chargerCouts(),
    ])
      .then(([produits, recettes, ingredients, menus, couts]) => {
        if (annule) return;
        setEtat({ statut: 'pret', produits, recettes, ingredients, menus, couts });
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
  }, [chargerProduits, chargerCouts]);

  // Chaque liste passe par son propre `useMemo` : un ternaire rendant `[]`
  // fabrique un tableau NEUF à chaque rendu, ce qui annule les `useMemo` qui en
  // dépendent — ils se recalculent alors systématiquement. Aucun affichage
  // n'était faux, c'était un défaut de performance ; mais il est invisible sans
  // la règle `react-hooks/exhaustive-deps` (D-047).
  const produits = useMemo(() => (etat.statut === 'pret' ? etat.produits : []), [etat]);
  const recettes = useMemo(() => (etat.statut === 'pret' ? etat.recettes : []), [etat]);
  const ingredients = useMemo(() => (etat.statut === 'pret' ? etat.ingredients : []), [etat]);
  const menus = useMemo(() => (etat.statut === 'pret' ? etat.menus : []), [etat]);
  const couts = useMemo(() => (etat.statut === 'pret' ? etat.couts : []), [etat]);

  /** Un produit `transforme`/`revendu` a AU PLUS une ligne ; un `menu` n'en a aucune. */
  const coutsParProduit = useMemo(
    () => new Map(couts.map((c) => [c.produitVenteId, c] as const)),
    [couts],
  );

  const visibles = useMemo(
    () =>
      produits
        .filter((p) => afficherRetires || p.actif)
        .filter((p) => filtreNature === 'tous' || p.nature === filtreNature),
    [produits, afficherRetires, filtreNature],
  );

  const selection = useMemo(
    () => produits.find((p) => p.id === selectionId) ?? null,
    [produits, selectionId],
  );

  /**
   * Vrai si le produit sélectionné est un menu et n'a encore AUCUN composant
   * actif déclaré (fiche 16 §2) — un menu vide est une coquille dangereuse :
   * il a l'air d'un produit valide, mais il ne sort rien du stock à la vente
   * et sa ventilation transformé/revendu (CLAUDE.md §6) reste incalculable.
   *
   * `menus` (`GET /api/menus`, `listerMenus`) ne recense QUE les produits qui
   * ont au moins une ligne de composition : un menu fraîchement créé n'y
   * figure donc pas du tout — son absence de la liste EST le signal.
   */
  const menuSelectionSansComposantActif = useMemo(() => {
    if (selection === null || selection.nature !== 'menu') return false;
    const resume = menus.find((m) => m.id === selection.id);
    return resume === undefined || resume.nbComposantsActifs === 0;
  }, [selection, menus]);

  /**
   * Coût de revient et marge du produit sélectionné, mis en forme pour la
   * fiche — voir `affichageCoutRevientProduit` : un coût inconnu s'y écrit
   * `—`, jamais `0,00 €`.
   */
  const coutSelection = useMemo(
    () =>
      selection === null
        ? null
        : affichageCoutRevientProduit(selection.nature, coutsParProduit.get(selection.id)),
    [selection, coutsParProduit],
  );

  /**
   * Recettes proposables : toutes celles qui ne sont pas archivées, PLUS celle
   * déjà rattachée au produit ouvert même si elle l'est. Sans ce second terme,
   * ouvrir un produit qui pointe une recette archivée viderait silencieusement
   * son rattachement au premier enregistrement.
   */
  const recettesProposables = useMemo(() => {
    const proposables = recettes.filter((r) => r.statut !== 'archivee');
    const rattachee = recettes.find((r) => r.id === brouillon.recetteId);
    if (rattachee !== undefined && !proposables.some((r) => r.id === rattachee.id)) {
      return [rattachee, ...proposables];
    }
    return proposables;
  }, [recettes, brouillon.recetteId]);

  function choisir(produit: Produit): void {
    setSelectionId(produit.id);
    setBrouillon(versBrouillon(produit));
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement({ phase: 'inchange' });
  }

  function nouveau(): void {
    setSelectionId(null);
    setBrouillon(BROUILLON_VIDE);
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement({ phase: 'inchange' });
    window.setTimeout(() => formulaireRef.current?.querySelector('input')?.focus(), 0);
  }

  function modifier<C extends keyof Brouillon>(champ: C, valeur: Brouillon[C]): void {
    setBrouillon((precedent) => ({ ...precedent, [champ]: valeur }));
    setEnregistrement({ phase: 'modifie' });
    // Validation À LA SAUVEGARDE, jamais en direct — voir
    // `champsEnErreurApresModification` (`../composants/formulaire`) pour la
    // justification complète et partagée avec Ingrédients et Lieux de marché.
    setChampsEnErreur(champsEnErreurApresModification);
  }

  /**
   * Change la nature ET PURGE le rattachement devenu absurde.
   *
   * C'est le geste qui rend la faute difficile à commettre plutôt que
   * simplement refusée : bascule « transformé » → « revendu » sans purge, et
   * l'ancien `recetteId` partirait au serveur, qui répondrait 422. Ici, il ne
   * part jamais.
   */
  function changerNature(nature: NatureProduitVente): void {
    setBrouillon((precedent) => ({
      ...precedent,
      nature,
      // La question « qu'est-ce qu'une unité vendue consomme ? » ne se pose
      // QUE sur un transformé (fiche 15 §4/§5.1) : elle repart à vide pour un
      // revendu ou un menu, exactement comme le rattachement recette/article
      // ci-dessous — `!== 'transforme'` et non `=== 'revendu'`, un menu doit
      // être purgé exactement comme un revendu.
      consommationUnite:
        nature === 'transforme'
          ? precedent.consommationUnite === ''
            ? 'crepes'
            : precedent.consommationUnite
          : '',
      recetteId: nature === 'transforme' ? precedent.recetteId : '',
      ingredientId: nature === 'revendu' ? precedent.ingredientId : '',
      // Un revendu ou un menu ne consomme aucune crêpe lui-même ; un
      // transformé « crêpes » en consomme au moins une. La valeur par défaut
      // est réelle, pas inventée.
      nbCrepes:
        nature === 'transforme' ? (precedent.nbCrepes === '' ? '1' : precedent.nbCrepes) : '',
      // Ni un revendu ni un menu n'ont de volume de pâte : le champ n'a alors
      // plus de sens. `!== 'transforme'` et non `=== 'revendu'` : un menu doit
      // être purgé exactement comme un revendu, sans quoi basculer
      // transformé → menu laisserait un volume orphelin partir au serveur.
      volumeMlParUnite: nature !== 'transforme' ? '' : precedent.volumeMlParUnite,
    }));
    setEnregistrement({ phase: 'modifie' });
    setChampsEnErreur({});
  }

  /**
   * Change ce qu'une unité vendue consomme, ET PURGE le champ de suite
   * devenu absurde — même geste que `changerNature` : basculer « crêpes » ->
   * « pâte au volume » sans purge laisserait un ancien nombre de crêpes
   * partir au serveur, qui le refuserait (`verifierConsommationUniteTransforme`,
   * `packages/core/src/contrats/referentiel.ts`) — la faute doit être
   * difficile à commettre, pas seulement refusée après coup.
   *
   * `nbCrepes` repart à `'0'` pour `volume_pate` et `nomenclature` : c'est la
   * valeur EXPLICITE que le serveur exige pour ces deux cas (« cette unité ne
   * produit aucune crêpe »), jamais une absence — voir `corpsSaisieProduit`,
   * qui la fige de toute façon à `0` quelle que soit la valeur affichée ici.
   * `''` (retour au placeholder du `<select>`) ne force aucun défaut : rien
   * n'est encore choisi.
   */
  function changerConsommationUnite(valeur: ConsommationUnite | ''): void {
    setBrouillon((precedent) => ({
      ...precedent,
      consommationUnite: valeur,
      nbCrepes:
        valeur === ''
          ? ''
          : valeur === 'crepes'
            ? precedent.nbCrepes === '' || precedent.nbCrepes === '0'
              ? '1'
              : precedent.nbCrepes
            : '0',
      volumeMlParUnite: valeur === 'volume_pate' ? precedent.volumeMlParUnite : '',
    }));
    setEnregistrement({ phase: 'modifie' });
    setChampsEnErreur({});
  }

  function corpsDepuisBrouillon(): Record<string, unknown> | null {
    const erreurs = erreursSaisieProduit(brouillon);

    if (Object.keys(erreurs).length > 0) {
      setChampsEnErreur(erreurs);
      // Même mécanisme qu'Ingrédients et Lieux de marché : jamais
      // `setChampsEnErreur` sans `focaliserPremierChampFautif` juste après.
      // Défaut mesuré (recette clavier du 30/07/2026, reproduit avec un prix
      // de vente vide) : cet appel manquait ici, et le focus restait sur le
      // bouton « Enregistrer ».
      focaliserPremierChampFautif(erreurs);
      return null;
    }

    return corpsSaisieProduit(brouillon);
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
    const corps = corpsDepuisBrouillon();
    if (corps === null) return;

    setErreurFormulaire(null);
    setEnregistrement({ phase: 'enregistrement' });

    const chemin = selectionId === null ? '/produits' : `/produits/${selectionId}`;
    const methode = selectionId === null ? 'POST' : 'PATCH';

    requeteApi<unknown>(chemin, { method: methode, body: JSON.stringify(corps) })
      .then(async (reponse) => {
        const enregistre = schemaProduit.parse(reponse);
        // Le prix, la recette ou l'article rattaché viennent de changer : le
        // coût de revient catalogue doit être rechargé avec la liste des
        // produits, sinon la fiche rouverte afficherait une marge calculée
        // sur l'ANCIENNE valeur jusqu'au prochain rechargement de page.
        const [liste, listeCouts] = await Promise.all([chargerProduits(), chargerCouts()]);
        setEtat((precedent) =>
          precedent.statut === 'pret'
            ? { ...precedent, produits: liste, couts: listeCouts }
            : precedent,
        );
        setSelectionId(enregistre.id);
        setBrouillon(versBrouillon(enregistre));
        setChampsEnErreur({});
        setEnregistrement({ phase: 'enregistre', heure: heureCourante() });
      })
      .catch((erreur: unknown) => {
        setEnregistrement({ phase: 'modifie' });
        if (erreur instanceof ErreurApi && erreur.champs !== undefined) {
          setChampsEnErreur(erreur.champs);
          focaliserPremierChampFautif(erreur.champs);
          return;
        }
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  function basculerActivite(): void {
    if (selection === null) return;

    requeteApi<unknown>(`/produits/${selection.id}/activite`, {
      method: 'PATCH',
      body: JSON.stringify({ actif: !selection.actif }),
    })
      .then(async (reponse) => {
        const modifie = schemaProduit.parse(reponse);
        const liste = await chargerProduits();
        setEtat((precedent) =>
          precedent.statut === 'pret' ? { ...precedent, produits: liste } : precedent,
        );
        setBrouillon(versBrouillon(modifie));
        setEnregistrement({ phase: 'enregistre', heure: heureCourante() });
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
        if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === 's') {
          evenement.preventDefault();
          enregistrer();
        }
      }}
    >
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Produits</h1>
        <button
          type="button"
          onClick={nouveau}
          className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Nouveau produit
        </button>
      </div>

      {/*
        Point de rupture a `lg` (1024 px) et JAMAIS a `xl` (1280 px) : la cible
        de conception est un viewport EFFECTIF de 1280x720 (Windows a 150 %),
        donc un `xl:` ferait retomber l'ecran en colonne unique exactement a la
        resolution de travail.

        Repartition 5/4 et non 50/50 : a 1280 px, deux colonnes egales laissent
        ~460 px au tableau, ou « Transformé » se tronque. Le tableau a besoin de
        plus de largeur que le formulaire, dont les champs vont deja par deux.

        `minmax(0, …)` et non `5fr_4fr` tout court : un `fr` vaut
        `minmax(auto, Xfr)`, donc son plancher est la largeur de CONTENU MINIMAL
        de la colonne. Le formulaire de droite contient un `<select>` long
        (« R1 v1 — Pâte à crêpes froment ») qui poussait ce plancher au-dessus de
        sa part — resultat, la colonne de droite s'elargissait et le tableau
        RETRECISSAIT, exactement l'inverse de l'intention. `minmax(0, …)` autorise
        la colonne a passer sous son contenu minimal, et le ratio est respecte.
      */}
      <div className="grid grid-cols-1 items-start gap-bloc lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        {/* ═══ Liste ══════════════════════════════════════════════════════ */}
        <Panneau titre="Carte des produits" sansRembourrage>
          <div className="flex flex-wrap items-center justify-between gap-groupe border-b border-line px-4 py-2">
            <fieldset className="flex items-center gap-3">
              <legend className="sr-only">Filtrer par nature</legend>
              {(['tous', 'transforme', 'revendu', 'menu'] as const).map((valeur) => (
                <label key={valeur} className="flex items-center gap-1 text-sm text-ink-2">
                  <input
                    type="radio"
                    name="filtre-nature"
                    checked={filtreNature === valeur}
                    onChange={() => setFiltreNature(valeur)}
                  />
                  {valeur === 'tous' ? 'Tous' : `${libelleNature(valeur)}s`}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-groupe text-sm text-ink-2">
              <input
                type="checkbox"
                checked={afficherRetires}
                onChange={(evenement) => setAfficherRetires(evenement.target.checked)}
              />
              Afficher les produits retirés
            </label>
          </div>

          {etat.statut === 'chargement' && (
            <p className="px-4 py-2 text-sm text-ink-3">Chargement des produits…</p>
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
              cleLigne={(p) => p.id}
              total={produits.length}
              libelleEntite="produits"
              {...(selectionId !== null ? { ligneSelectionneeCle: selectionId } : {})}
              onSelectionnerLigne={choisir}
              etatVide={
                produits.length > 0 ? (
                  <EtatVide
                    variante="filtre"
                    explicationFiltre={`Aucun des ${produits.length} produits enregistrés ne correspond au filtre en cours (${filtreNature === 'tous' ? 'tous' : `${libelleNature(filtreNature)}s`}${afficherRetires ? '' : ', retirés masqués'}).`}
                    onReinitialiser={() => {
                      setFiltreNature('tous');
                      setAfficherRetires(true);
                    }}
                  />
                ) : (
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucun produit enregistré"
                    explication="Définissez ce que vous vendez : les crêpes issues de vos recettes, et les produits du terroir revendus tels quels."
                    action={{ libelle: 'Créer un produit', onClick: nouveau }}
                  />
                )
              }
            />
          )}
        </Panneau>

        {/* ═══ Fiche ══════════════════════════════════════════════════════ */}
        <Panneau titre={selection === null ? 'Nouveau produit' : selection.nom}>
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
              libelle="Nom du produit"
              valeur={brouillon.nom}
              onChange={(v) => modifier('nom', v)}
              erreur={champsEnErreur['nom']}
              obligatoire
            />

            {/* La nature commande tout le reste du formulaire : elle vient en
                deuxième, juste après le nom, et jamais enterrée plus bas. */}
            <fieldset className="flex flex-col gap-groupe">
              <legend className="text-2xs uppercase text-ink-3">Nature</legend>
              <label className="flex items-center gap-groupe text-sm text-ink-2">
                <input
                  type="radio"
                  name="nature"
                  checked={brouillon.nature === 'transforme'}
                  onChange={() => changerNature('transforme')}
                />
                Transformé — issu d’une recette
              </label>
              <label className="flex items-center gap-groupe text-sm text-ink-2">
                <input
                  type="radio"
                  name="nature"
                  checked={brouillon.nature === 'revendu'}
                  onChange={() => changerNature('revendu')}
                />
                Revendu — acheté préemballé
              </label>
              <label className="flex items-center gap-groupe text-sm text-ink-2">
                <input
                  type="radio"
                  name="nature"
                  checked={brouillon.nature === 'menu'}
                  onChange={() => changerNature('menu')}
                />
                Menu — composé d’autres produits
              </label>
              <p className="text-xs text-ink-3">
                {brouillon.nature === 'transforme'
                  ? 'Fabriqué à partir d’une recette : la production consomme le stock des ingrédients de cette recette.'
                  : brouillon.nature === 'revendu'
                    ? 'Acheté tel quel et revendu tel quel : la vente sort une unité de stock, sans recette. Attention, la revente compte dans le chiffre d’affaires au même titre qu’une crêpe — et les seuils légaux portent sur le chiffre d’affaires, pas sur la marge.'
                    : 'Composé d’autres produits déjà déclarés (une crêpe, un café…), vendus ensemble à prix groupé. Ni recette ni article propre : son coût de revient et sa ventilation transformé/revendu se déduisent de ses composants, déclarés sur l’écran Menus une fois ce produit enregistré ici.'}
              </p>
            </fieldset>

            {/* Un seul des trois rattachements est rendu, jamais deux à la
                fois : le champ sans objet pour la nature choisie n'existe pas
                à l'écran. Un menu n'en a AUCUN — sa « composition » (les
                produits qu'il contient) est une notion différente, déclarée à
                part sur l'écran Menus, jamais ici. */}
            {brouillon.nature === 'transforme' ? (
              <ChampSelect
                nom="recetteId"
                libelle="Recette"
                valeur={brouillon.recetteId}
                onChange={(v) => modifier('recetteId', v)}
                erreur={champsEnErreur['recetteId']}
                options={recettesProposables.map((r) => ({
                  valeur: r.id,
                  libelle: `${r.code} v${r.version} — ${r.nom}`,
                }))}
                optionVide="Choisir une recette…"
              />
            ) : brouillon.nature === 'revendu' ? (
              <ChampSelect
                nom="ingredientId"
                libelle="Article revendu"
                valeur={brouillon.ingredientId}
                onChange={(v) => modifier('ingredientId', v)}
                erreur={champsEnErreur['ingredientId']}
                options={ingredients.map((i) => ({ valeur: i.id, libelle: i.nom }))}
                optionVide="Choisir un article…"
                aide="L’article de stock dont une unité sort à chaque vente."
              />
            ) : (
              <p className="text-xs text-ink-3">
                Un menu n’a ni recette ni article à rattacher ici : enregistrez-le d’abord, puis
                déclarez ses composants sur l’écran Menus.
              </p>
            )}

            {/*
              LA VRAIE QUESTION (fiche 15 §4/§5.1, décision du porteur du
              31/07/2026) : ce qu'une unité vendue consomme n'a que trois
              réponses, et elles s'excluent. Avant ce champ, l'écran faisait
              deviner que « 0 crêpe » signifiait secrètement « pâte » —
              exactement le piège qu'il supprime. Un `<select>` plutôt qu'un
              troisième bloc de radios : la hauteur est la ressource rare à
              1280×720 (docs/07 §4.4), et un champ qui apparaît À LA PLACE
              d'un autre ne coûte rien, contrairement à trois champs empilés
              en permanence.
            */}
            {brouillon.nature === 'transforme' && (
              <ChampSelect
                nom="consommationUnite"
                libelle="Une unité vendue consomme…"
                valeur={brouillon.consommationUnite}
                onChange={(v) => changerConsommationUnite(v === '' ? '' : (v as ConsommationUnite))}
                erreur={champsEnErreur['consommationUnite']}
                options={[
                  { valeur: 'crepes', libelle: 'Des crêpes, issues de la pâte' },
                  { valeur: 'volume_pate', libelle: 'De la pâte, vendue telle quelle (au volume)' },
                  {
                    valeur: 'nomenclature',
                    libelle: 'Rien : sa composition se déclare à part (café, consommable…)',
                  },
                ]}
                optionVide="Choisir…"
              />
            )}

            <div className="grid grid-cols-2 gap-groupe">
              <ChampTexte
                nom="prixCents"
                libelle="Prix de vente (€)"
                valeur={brouillon.prix}
                onChange={(v) => modifier('prix', v)}
                erreur={champsEnErreur['prixCents']}
                numerique="decimal"
              />
              {/* Seul cas où ce champ a un sens, donc seul cas où il est
                  rendu (même principe que le rattachement recette/ingrédient
                  ci-dessus) : un « 0 » masqué qui traînerait à l'écran pour
                  `volume_pate`/`nomenclature` n'apporterait rien à voir, et
                  la valeur est de toute façon fixée par `corpsSaisieProduit`. */}
              {brouillon.nature === 'transforme' && brouillon.consommationUnite === 'crepes' && (
                <ChampTexte
                  nom="nbCrepes"
                  libelle="Crêpes par unité vendue"
                  valeur={brouillon.nbCrepes}
                  onChange={(v) => modifier('nbCrepes', v)}
                  erreur={champsEnErreur['nbCrepes']}
                  numerique="entier"
                />
              )}
            </div>

            {/* Pâte vendue telle quelle (fiche 15 §5.1) : seul cas où ce champ
                a un sens, donc seul cas où il est rendu. */}
            {brouillon.nature === 'transforme' && brouillon.consommationUnite === 'volume_pate' && (
              <ChampTexte
                nom="volumeMlParUnite"
                libelle="Volume représenté par une unité (ml)"
                valeur={brouillon.volumeMlParUnite}
                onChange={(v) => modifier('volumeMlParUnite', v)}
                erreur={champsEnErreur['volumeMlParUnite']}
                aide="Exemple : une bouteille de 50 cl vaut 500. Sans ce volume, la clôture au volume recompterait la bouteille en crêpes."
                numerique="entier"
                obligatoire
              />
            )}

            {/*
              Coût de revient et marge (audit du 30/07/2026) : les deux routes
              qui les calculent (`GET /couts-produits`,
              `GET /produits/:id/cout-revient`) existaient déjà, testées et
              servies, mais rien ne les affichait — l'écran ne montrait que
              nom, nature, prix et statut.

              DANS LA FICHE, PAS UNE COLONNE DE PLUS. Le tableau de gauche est
              déjà réglé à QUATRE colonnes pile pour le viewport cible
              (1280×720 effectif, voir le commentaire sur `COLONNES`
              ci-dessus) : une tentative précédente d'une cinquième colonne
              tronquait déjà les en-têtes existants avec des valeurs COURTES.
              Rétrécir encore `nom` pour loger une valeur monétaire referait
              exactement la confusion que sa largeur généreuse corrige
              (distinguer deux produits qui partagent leur début). La fiche,
              elle, n'a pas cette contrainte : elle affiche un seul produit à
              la fois, et c'est là que le porteur regarde déjà le prix qu'il
              vient de saisir.
            */}
            {coutSelection !== null && (
              <div className="flex flex-col gap-groupe rounded-sm border border-line-field bg-surface-sunken px-3 py-2">
                <p className="text-2xs uppercase text-ink-3">Coût de revient</p>
                <div className="flex items-center justify-between text-sm text-ink-2">
                  <span>Coût matière (€)</span>
                  <span className="num">{coutSelection.coutMatiere}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-ink-2">
                  <span>Marge (€)</span>
                  <span className="num">
                    {coutSelection.marge}
                    {coutSelection.margeTaux !== TIRET_ABSENT
                      ? ` (${coutSelection.margeTaux})`
                      : ''}
                  </span>
                </div>
                {coutSelection.avertissement !== null && (
                  <p role="alert" className="text-xs text-alerte">
                    <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span>{' '}
                    {coutSelection.avertissement}
                  </p>
                )}
              </div>
            )}

            <ChampTexte
              nom="categorie"
              libelle="Catégorie"
              valeur={brouillon.categorie}
              onChange={(v) => modifier('categorie', v)}
              erreur={champsEnErreur['categorie']}
            />

            <label className="flex items-start gap-groupe text-sm text-ink-2">
              <input
                type="checkbox"
                name="consommationSurPlace"
                className="mt-1"
                checked={brouillon.consommationSurPlace}
                onChange={(evenement) => modifier('consommationSurPlace', evenement.target.checked)}
              />
              <span>
                Consommation sur place
                <span className="block text-xs text-ink-3">
                  À cocher seulement s’il y a table ou chaise au stand. Ce drapeau alimente le
                  compteur du seuil « caisse enregistreuse certifiée », distinct de celui de la
                  franchise TVA. La vente à emporter n’est pas un service de restauration.
                </span>
              </span>
            </label>

            {erreurFormulaire !== null && <MessageErreur message={erreurFormulaire} />}

            <div className="flex items-center justify-between border-t border-line pt-3">
              <IndicateurEnregistrement etat={enregistrement} />
              <div className="flex items-center gap-groupe">
                {selection !== null && (
                  <button
                    type="button"
                    onClick={basculerActivite}
                    className="h-controle rounded-sm border border-line-field bg-surface px-3 text-sm font-medium text-ink-2 hover:bg-surface-sunken"
                  >
                    {selection.actif ? 'Retirer de la vente' : 'Remettre en vente'}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={enregistrement.phase === 'enregistrement'}
                  className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:bg-ink-4"
                >
                  Enregistrer
                </button>
              </div>
            </div>

            {selection !== null && (
              <>
                <p className="text-xs text-ink-3">
                  Un produit ne se supprime pas : il figure dans des sessions clôturées, qui sont
                  des pièces comptables. Retiré de la vente, il disparaît de la saisie de clôture
                  mais reste dans l’historique.
                </p>

                {/* Un menu se déclare en DEUX écrans : ce formulaire ne porte
                    ni recette ni article, donc rien à saisir de plus ici — sa
                    composition (les produits qu'il contient) vit sur l'écran
                    Menus. Sans ce pont, il faudrait rouvrir « Menus » et
                    rechercher ce produit dans une seconde liste déroulante,
                    exactement l'inconfort que le pont vers Nomenclature de
                    vente (ci-dessous) existe déjà pour éviter. Un menu SANS
                    composant est une coquille dangereuse — il a l'air d'un
                    produit valide, mais il ne sort rien du stock à la vente et
                    sa ventilation transformé/revendu (CLAUDE.md §6) reste
                    incalculable — d'où l'avertissement, visible tant qu'aucun
                    composant actif n'est déclaré, en plus du lien qui y mène. */}
                {selection.nature === 'menu' && (
                  <>
                    {menuSelectionSansComposantActif && (
                      <div
                        role="alert"
                        className="border-l-2 border-alerte bg-alerte-bg px-3 py-2 text-xs text-alerte"
                      >
                        Ce menu ne contient encore aucun composant actif : il ne sort rien du stock
                        à la vente et sa ventilation transformé/revendu reste incalculable tant
                        qu’aucun composant n’est déclaré.
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate(`/menus?produit=${selection.id}`)}
                      className="self-start text-xs font-medium text-accent hover:underline"
                    >
                      Définir la composition de ce menu →
                    </button>
                  </>
                )}

                {/* Pont vers l'écran voisin (fiche 15) : un café, un
                    consommable ou un topping vendu à la pièce ne sort du stock
                    QUE via sa nomenclature de vente — sans ce pont, il faudrait
                    rouvrir « Nomenclature de vente » et rechercher ce produit
                    dans une seconde liste déroulante. */}
                <button
                  type="button"
                  onClick={() => navigate(`/nomenclature-vente?produit=${selection.id}`)}
                  className="self-start text-xs font-medium text-accent hover:underline"
                >
                  Déclarer ce qu’il consomme à la vente (serviette, gobelet, café…) →
                </button>
              </>
            )}
          </form>
        </Panneau>
      </div>
    </div>
  );
}

/**
 * `ChampTexte`, `ChampSelect` et `IndicateurEnregistrement` locaux — SUPPRIMÉS
 * (01/08/2026, mission « composants partagés ») au profit de `../composants/
 * champs-formulaire` (voir son en-tête pour ce que la fusion des six variantes
 * historiques devait préserver). Traductions faites ici :
 *  - `numerique` (booléen) → `'entier' | 'decimal'` : `nbCrepes` et
 *    `volumeMlParUnite` restent des ENTIERS (grammes/ml/comptes, CLAUDE.md §3
 *    règle 4), `prixCents` devient `'decimal'` (un prix de vente se saisit
 *    avec des centimes, « 3,50 ») ;
 *  - `placeholder` de l'ancien `ChampSelect` local → `optionVide` du partagé,
 *    toujours fourni ici donc sans changement de comportement.
 */
