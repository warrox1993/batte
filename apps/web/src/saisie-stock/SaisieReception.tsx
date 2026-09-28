import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GLYPHE_STATUT,
  TIRET_ABSENT,
  ajouterJours,
  avertissementDlcDejaDepassee,
  formaterDate,
  formaterEuros,
  formaterMontant,
  formaterQuantite,
  libelleUnite,
  nouvelIdentifiant,
  parserEuros,
  schemaAnnulationReceptionCreee,
  schemaListeCommandes,
  schemaListeFournisseurs,
  schemaListeIngredients,
  schemaReceptionCreee,
  type CommandeResume,
  type Fournisseur,
  type IngredientReferentiel,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { requeteApi } from '../lib/api';
import { aujourdHui } from '../lib/dates';
import {
  AUCUNE_ERREUR,
  BandeauSucces,
  CLASSE_BOUTON_LIEN,
  CLASSE_BOUTON_PRIMAIRE,
  CLASSE_BOUTON_SECONDAIRE,
  ChampSaisie,
  ChampSelection,
  parserEntierPositif,
  repartirErreurApi,
  type ErreursFormulaire,
  type OptionSelection,
} from './champs';
import {
  blocageAnnulationReception,
  phraseApresAnnulationReception,
  phraseAvantAnnulationReception,
} from './annulation';
import { BlocAnnulation } from './BlocAnnulation';

/**
 * Saisie d'une RECEPTION DE MARCHANDISE — le premier maillon de la chaine de
 * donnees decrite par CLAUDE.md §0 (« une reception de farine chez le meunier
 * doit se propager, sans ressaisie, jusqu'a la marge nette du dimanche suivant
 * et jusqu'au registre AFSCA »).
 *
 * QUATRE PARTIS PRIS QUI MERITENT D'ETRE LUS.
 *
 * 1. **Une reception est une PIECE, pas un formulaire ligne a ligne.** Le
 *    meunier livre la farine, le sel et le sucre dans la meme camionnette, avec
 *    un seul bon de livraison. L'ecran saisit donc N lignes et n'envoie qu'UNE
 *    requete : l'ecriture est atomique cote serveur
 *    (`packages/db/src/services/reception.ts`), et une reception a moitie ecrite
 *    laisserait des lots sans mouvement d'entree — donc un stock faux.
 *
 * 2. **La quantite se saisit dans l'unite de REFERENCE de l'ingredient**
 *    (grammes, millilitres, pieces — CLAUDE.md §3 regle 4), pas en kilos. C'est
 *    deja la convention de `Production.tsx`, ou l'on saisit un volume en
 *    millilitres. Convertir « 25 kg » en 25 000 g demanderait une fonction pure
 *    de `packages/core` qui n'existe pas encore ; l'inventer dans un composant
 *    React violerait la regle d'architecture n°1. En attendant, la valeur
 *    saisie est relue A COTE DU CHAMP par `formaterQuantite` (« 25,0 kg ») :
 *    une faute de frappe d'un facteur mille se voit immediatement.
 *
 * 3. **Le total saisi est affiche avant validation.** C'est une piece
 *    comptable : l'utilisateur la compare a son bon de livraison papier. Le
 *    montant qui fait foi reste celui rendu par le serveur (`montantTotalCents`),
 *    affiche dans la confirmation.
 *
 * 4. **Un enregistrement reussi VIDE le formulaire et lui rend le focus, il ne
 *    le ferme pas** (`reinitialiserFormulaire`, recette clavier du 30/07/2026).
 *    Le porteur enchaine les receptions les unes a la suite des autres —
 *    plusieurs fournisseurs livrent le meme jour. Fermer l'ecran apres CHAQUE
 *    reception forcerait a rouvrir « Enregistrer une réception » a chaque
 *    fois ; ne rien reinitialiser du tout ferait retomber le focus sur
 *    `<body>` (defaut mesure). Meme idiome que `Economies.tsx` apres une
 *    renegociation de tarif et `Evenements.tsx` apres une creation : vider les
 *    champs et rendre le focus, sans demonter le formulaire.
 *
 * Regle d'architecture n°1 : aucun calcul metier ici. Les montants passent par
 * `parserEuros` / `formaterMontant`, la DLC deduite par `ajouterJours` — LA
 * MEME fonction pure que le serveur appelle (`reception.ts`), afin que l'ecran
 * ne puisse pas annoncer une date que la base contredira.
 */

/** Ce que la route rend en 201. Type derive du schema, jamais reecrit (docs/06). */
export type ReceptionEnregistree = ReturnType<typeof schemaReceptionCreee.parse>;

/**
 * Deux intentions, une seule ecriture.
 *
 * `inventaire` designe l'inventaire d'ouverture : declarer ce qu'on a deja en
 * stock le jour de l'installation. Techniquement c'est une reception comme une
 * autre — memes lots, memes mouvements d'entree, meme tracabilite. Aucun
 * mecanisme parallele n'est introduit : ce serait une seconde porte d'entree
 * dans le stock, donc une seconde occasion de le desynchroniser.
 */
export type VarianteReception = 'reception' | 'inventaire';

type LigneBrouillon = {
  /** Cle React stable : les lignes se reordonnent et se suppriment. */
  readonly cle: string;
  ingredientId: string;
  quantite: string;
  prix: string;
  numeroLot: string;
  dlc: string;
};

type EtatReferentiel =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | {
      statut: 'pret';
      fournisseurs: Fournisseur[];
      ingredients: IngredientReferentiel[];
      commandes: CommandeResume[];
    };

type LigneCorps = {
  ingredientId: string;
  quantite: number;
  prixLigneCents: number;
  numeroLotFournisseur: string | null;
  dateDlc: string | null;
};

/** Erreurs de saisie, indexees par cle de ligne puis par nom de champ. */
type ErreursLignes = Record<string, Record<string, string>>;

/**
 * Champs d'en-tete que l'ecran sait afficher. Tout ce que le serveur signale
 * en dehors de cette liste — un chemin Zod `lignes.0.quantite`, un `_global`,
 * une cle qu'aucun champ ne porte — repart en bandeau plutot que d'etre perdu.
 *
 * SANS CETTE LISTE, un 422 dont la cle ne correspond a aucun champ rendu
 * disparaissait purement et simplement : l'ecran refusait d'enregistrer sans
 * rien afficher. C'est exactement l'echec silencieux que CLAUDE.md §4 interdit.
 */
const CHAMPS_ENTETE_AFFICHES: ReadonlySet<string> = new Set([
  'fournisseurId',
  'dateReception',
  'numeroBonLivraison',
  'commandeId',
  'notes',
]);

/**
 * Premier champ du formulaire — cible du focus a l'ouverture COMME apres un
 * enregistrement reussi (les deux redemarrent d'un formulaire vide). Une
 * seule constante plutot que deux chaines qui pourraient un jour diverger.
 */
const SELECTEUR_PREMIER_CHAMP = 'select[name="fournisseurId"]';

function absorberErreurServeur(reparties: ErreursFormulaire): ErreursFormulaire {
  const champs: Record<string, string> = {};
  const orphelins: string[] = [];

  for (const [cle, message] of Object.entries(reparties.champs)) {
    if (CHAMPS_ENTETE_AFFICHES.has(cle)) champs[cle] = message;
    else orphelins.push(message);
  }

  const general = [reparties.general, ...orphelins]
    .filter((message): message is string => message !== null && message !== '')
    .join(' ');

  return { champs, general: general === '' ? null : general };
}

/**
 * Une commande deja `recue` ou `annulee` ne peut plus etre soldee — le serveur
 * la refuse (`commande_deja_soldee`). On ne la propose donc pas.
 */
function commandeOuverte(commande: CommandeResume): boolean {
  return commande.statut !== 'recue' && commande.statut !== 'annulee';
}

const LIBELLE_STATUT_COMMANDE: Readonly<Record<CommandeResume['statut'], string>> = {
  brouillon: 'brouillon',
  validee: 'validée',
  envoyee: 'envoyée',
  recue: 'reçue',
  annulee: 'annulée',
};

/**
 * Cle React d'une ligne.
 *
 * `nouvelIdentifiant` (UUID v7) et non un compteur : un compteur au niveau du
 * MODULE repart a zero des que Vite remplace le module a chaud, alors que le
 * composant conserve son etat — deux lignes se retrouvaient alors avec la cle
 * `ligne-1`, et React fusionnait leurs champs de saisie. Ce n'est pas qu'un
 * defaut de developpement : la meme collision se produirait avec un compteur
 * partage entre deux instances du formulaire.
 */
function ligneVide(): LigneBrouillon {
  return {
    cle: nouvelIdentifiant(),
    ingredientId: '',
    quantite: '',
    prix: '',
    numeroLot: '',
    dlc: '',
  };
}

/**
 * Ce que redevient le formulaire apres un enregistrement reussi (recette
 * clavier du 30/07/2026) : ENTIEREMENT vide, comme a l'ouverture de l'ecran —
 * jamais un champ qui « oublie » de se reinitialiser. `dateDuJour` et
 * `ligneInitiale` sont des PARAMETRES explicites plutot que des appels directs
 * a `aujourdHui()` / `ligneVide()` a l'interieur : cette fonction reste alors
 * testable sans dependre de l'horloge ni de l'identifiant genere (meme
 * discipline que `jourReference` dans `Stock.tsx`).
 */
export function valeursFormulaireVide(
  variante: VarianteReception,
  dateDuJour: string,
  ligneInitiale: LigneBrouillon,
): {
  fournisseurId: string;
  dateReception: string;
  commandeId: string;
  numeroBonLivraison: string;
  notes: string;
  lignes: LigneBrouillon[];
} {
  return {
    fournisseurId: '',
    dateReception: dateDuJour,
    commandeId: '',
    numeroBonLivraison: '',
    notes: variante === 'inventaire' ? "Inventaire d'ouverture" : '',
    lignes: [ligneInitiale],
  };
}

/**
 * Ce que doit faire la touche `Entree` depuis une ligne du tableau.
 *
 * `Entree` SEULE avance d'une ligne, ou en ajoute une depuis la derniere
 * (docs/07 §4.6, le mode « tableur »). `Ctrl+Entree` (ou `Cmd+Entree`) doit au
 * contraire s'EFFACER devant le raccourci d'enregistrement pose sur `<form>`
 * plus bas : les deux gestionnaires recoivent le MEME evenement (React fait
 * remonter le `keydown` du champ vers le formulaire), et rien n'arrete cette
 * remontee ici.
 *
 * DEFAUT CORRIGE (recette clavier du 30/07/2026) : avant ce correctif, la
 * verification ne portait que sur `evenement.key`, jamais sur `ctrlKey` /
 * `metaKey` — Ctrl+Entree declenchait donc CE gestionnaire-ci EN PLUS de celui
 * du formulaire. Sur la derniere ligne, cela ajoutait une ligne vide en meme
 * temps que le formulaire tentait d'enregistrer ; si cette ligne echouait
 * encore une validation (par exemple, ni numero de lot ni DLC saisis),
 * `enregistrer()` refusait l'envoi EN SILENCE (`construireCorps` rend `null`)
 * mais la ligne vide restait ajoutee — Ctrl+Entree semblait alors « ajouter
 * une ligne au lieu d'enregistrer ». Le meme code s'executait depuis N'IMPORTE
 * QUEL champ de la ligne (aucun n'a jamais eu de traitement different) : le
 * champ « Prix payé » est simplement celui ou l'utilisateur, ayant fini de
 * saisir le montant, est le plus tot tente d'enregistrer — donc le plus tot
 * expose si la ligne n'est pas encore complete.
 */
export function actionSurEntree(
  evenement: { readonly key: string; readonly ctrlKey: boolean; readonly metaKey: boolean },
  cle: string,
  lignes: readonly { readonly cle: string }[],
):
  | { readonly type: 'ignorer' }
  | { readonly type: 'nouvelle_ligne' }
  | { readonly type: 'ligne_suivante'; readonly cle: string } {
  if (evenement.key !== 'Enter') return { type: 'ignorer' };
  if (evenement.ctrlKey || evenement.metaKey) return { type: 'ignorer' };

  const index = lignes.findIndex((ligne) => ligne.cle === cle);
  const suivante = lignes[index + 1];
  return suivante === undefined
    ? { type: 'nouvelle_ligne' }
    : { type: 'ligne_suivante', cle: suivante.cle };
}

/**
 * Cle a focaliser une fois une ligne retiree (recette clavier du 30/07/2026 :
 * `Entree` sur « Retirer la ligne » faisait retomber le focus sur `<body>`,
 * sans cible du tout).
 *
 * LE GESTE REEL : on retire une ligne PARCE QU'ON S'EST TROMPE, et on veut
 * IMMEDIATEMENT continuer a saisir — au meme endroit a l'ecran, pas en
 * redescendant chercher une autre rangee. La cible est donc la ligne qui
 * prend VISUELLEMENT la place de celle qu'on retire : la suivante glisse vers
 * le haut ; si elle n'existait pas (derniere ligne retiree), c'est la
 * precedente qui devient derniere — le meme calcul d'index, borne a la
 * nouvelle longueur, couvre les deux cas sans les distinguer. Quand une seule
 * ligne existait, `lignesApres` porte la ligne vierge de remplacement
 * (`retirerLigne` la cree), seule candidate possible.
 */
export function cleAFocaliserApresRetrait<L extends { readonly cle: string }>(
  lignesAvant: readonly L[],
  cleRetiree: string,
  lignesApres: readonly L[],
): string | null {
  if (lignesApres.length === 0) return null;
  const indexAvant = lignesAvant.findIndex((ligne) => ligne.cle === cleRetiree);
  const indexCible = Math.min(Math.max(indexAvant, 0), lignesApres.length - 1);
  return lignesApres[indexCible]?.cle ?? null;
}

/**
 * L'avertissement NON BLOQUANT à afficher sous le champ DLC d'une ligne —
 * second défaut de docs/27-PARCOURS-REJOUE.md §3.d (01/08/2026) : rien
 * n'avertissait jusqu'ici qu'une DLC déjà dépassée à la date de réception
 * venait d'être saisie (une faute de frappe sur l'année, typiquement).
 *
 * Extrait en fonction PURE et exportée — ni jsdom ni `@testing-library/react`
 * dans ce dépôt (voir l'en-tête de `SaisieReception.test.tsx`) — même
 * discipline que `actionSurEntree`/`cleAFocaliserApresRetrait` ci-dessus :
 * la DÉCISION (quelle DLC retenir, quand avertir) est testable sans monter
 * le composant ; seul le déclenchement (`.tsx`, plus bas) ne l'est pas.
 *
 * La DLC EFFECTIVE est celle SAISIE si elle existe, sinon celle DÉDUITE de la
 * durée de conservation de l'ingrédient (`dlcDeduite`, dans le composant) :
 * les deux peuvent être en retard, la déduite si la date de réception saisie
 * est elle-même ancienne (rattrapage d'une réception oubliée).
 *
 * Délègue la PHRASE à `avertissementDlcDejaDepassee` (`@batte/core`) — la
 * MÊME fonction qui alimentera un jour l'avertissement équivalent côté
 * serveur (`enregistrerReception`, hors zone d'écriture de cette mission) :
 * une seule formulation, jamais deux qui pourraient diverger.
 *
 * `null` quand il n'y a rien à dire (pas d'ingrédient choisi, pas de date de
 * réception saisie, pas de DLC effective, ou DLC pas encore dépassée).
 */
export function avertissementDlcSaisieDejaDepassee(
  dlcSaisie: string,
  dlcDeduite: string | null,
  dateReception: string,
  nomIngredient: string | undefined,
): string | null {
  if (nomIngredient === undefined || dateReception.trim() === '') return null;
  const dlcEffective = dlcSaisie.trim() !== '' ? dlcSaisie.trim() : dlcDeduite;
  if (dlcEffective === null) return null;
  return avertissementDlcDejaDepassee(nomIngredient, dlcEffective, dateReception);
}

/**
 * La réception qu'on VIENT d'enregistrer, gardée le temps de pouvoir encore la
 * reprendre (D-087, second chemin d'annulation).
 *
 * C'est le raccourci qui couvre le cas dominant : la faute qu'on remarque dans
 * la seconde qui suit. Le chemin canonique reste le LOT (`DetailLot.tsx`),
 * seul atteignable une fois cet écran quitté ; celui-ci évite d'avoir à
 * ressortir, retrouver l'ingrédient et rouvrir le lot pour défaire ce qu'on
 * vient de taper.
 *
 * `dateReception` est capturée AVANT la remise à blanc du formulaire : le
 * champ est vidé par `reinitialiserFormulaire` dans la foulée de
 * l'enregistrement, le relire ensuite donnerait la date du jour et non celle
 * de la pièce.
 *
 * `annulation` porte la confirmation une fois l'annulation faite. Elle NE
 * REMPLACE PAS l'enregistrement : les deux restent lisibles à l'écran, comme
 * les deux écritures restent au journal (D-083).
 */
type DerniereReception = {
  readonly receptionId: string;
  readonly numero: string;
  readonly dateReception: string;
  readonly nbLots: number;
  readonly annulation: string | null;
};

type SaisieReceptionProps = {
  variante: VarianteReception;
  onEnregistre: (resultat: ReceptionEnregistree) => void;
  onAnnuler: () => void;
};

export function SaisieReception({ variante, onEnregistre, onAnnuler }: SaisieReceptionProps) {
  const [referentiel, setReferentiel] = useState<EtatReferentiel>({ statut: 'chargement' });

  const [fournisseurId, setFournisseurId] = useState('');
  const [dateReception, setDateReception] = useState(aujourdHui);
  const [commandeId, setCommandeId] = useState('');
  const [numeroBonLivraison, setNumeroBonLivraison] = useState('');
  const [notes, setNotes] = useState(() =>
    // Visible et modifiable, jamais une donnee glissee en douce : la note
    // distingue l'inventaire d'ouverture d'un achat reel dans le journal des
    // receptions, ce qui compte le jour ou on relit l'historique.
    variante === 'inventaire' ? "Inventaire d'ouverture" : '',
  );
  const [lignes, setLignes] = useState<LigneBrouillon[]>(() => [ligneVide()]);

  const [erreursEntete, setErreursEntete] = useState<ErreursFormulaire>(AUCUNE_ERREUR);
  const [erreursLignes, setErreursLignes] = useState<ErreursLignes>({});
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const formulaireRef = useRef<HTMLFormElement>(null);
  /** Ligne dont le premier champ doit recevoir le focus au prochain rendu. */
  const [cleAFocaliser, setCleAFocaliser] = useState<string | null>(null);

  // ─── Reprise immédiate de la réception qu'on vient d'écrire (D-087) ──────
  const [derniereReception, setDerniereReception] = useState<DerniereReception | null>(null);
  const [annulationOuverte, setAnnulationOuverte] = useState(false);
  const [motifAnnulation, setMotifAnnulation] = useState('');
  const [erreursAnnulation, setErreursAnnulation] = useState<ErreursFormulaire>(AUCUNE_ERREUR);
  /**
   * État d'envoi PROPRE à l'annulation, distinct d'`envoiEnCours` : les deux
   * boutons coexistent à l'écran, et partager l'indicateur désactiverait
   * « Enregistrer la réception » pendant qu'on annule la précédente.
   */
  const [annulationEnCours, setAnnulationEnCours] = useState(false);
  // D-079, complément du 31/07/2026 : `disabled` posé sur un bouton qui a le
  // focus le lui fait lâcher par le navigateur, avant tout rendu React. Les
  // deux `ref` servent à le lui rendre — voir `annulerDerniereReception`.
  const boutonOuvrirAnnulationRef = useRef<HTMLButtonElement>(null);
  const boutonConfirmerAnnulationRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let annule = false;

    Promise.all([
      requeteApi<unknown>('/fournisseurs'),
      requeteApi<unknown>('/ingredients'),
      requeteApi<unknown>('/commandes'),
    ])
      .then(([reponseFournisseurs, reponseIngredients, reponseCommandes]) => {
        if (annule) return;
        setReferentiel({
          statut: 'pret',
          fournisseurs: schemaListeFournisseurs.parse(reponseFournisseurs).data,
          ingredients: schemaListeIngredients.parse(reponseIngredients).data,
          commandes: schemaListeCommandes.parse(reponseCommandes).data,
        });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        setReferentiel({
          statut: 'erreur',
          message: repartirErreurApi(erreur).general ?? 'Erreur inattendue, sans plus de détail.',
        });
      });

    return () => {
      annule = true;
    };
  }, []);

  /**
   * Focus sur le premier champ des que le formulaire devient utilisable.
   *
   * INDISPENSABLE, PAS COSMETIQUE. Le bouton « Enregistrer une réception » qui
   * ouvre ce formulaire DISPARAIT en s'ouvrant : le focus retombait alors sur
   * `<body>`, et la tabulation suivante repartait du tout debut du document —
   * la barre de navigation, ses quinze liens, puis seulement le formulaire.
   * Ouvrir la saisie au clavier coutait donc une vingtaine de tabulations, ce
   * qui revient a dire qu'elle n'etait pas utilisable au clavier
   * (CLAUDE.md §3 regle 10).
   */
  useEffect(() => {
    if (referentiel.statut !== 'pret') return;
    formulaireRef.current?.querySelector<HTMLElement>(SELECTEUR_PREMIER_CHAMP)?.focus();
  }, [referentiel.statut]);

  // Focus sur la ligne qui vient d'etre ajoutee. Un `useEffect` et non un appel
  // direct : le noeud n'existe pas encore au moment ou l'on ajoute la ligne.
  useEffect(() => {
    if (cleAFocaliser === null) return;
    const champ = formulaireRef.current?.querySelector<HTMLElement>(
      `[data-ligne="${cleAFocaliser}"][data-champ="ingredientId"] select`,
    );
    champ?.focus();
    setCleAFocaliser(null);
  }, [cleAFocaliser]);

  /**
   * Les trois listes du referentiel, extraites de la machine a etats.
   *
   * `useMemo` et non un simple ternaire : la branche « pas encore charge »
   * construit un tableau NEUF a chaque rendu, ce qui change l'identite de la
   * dependance et fait recalculer toutes les listes d'options en dessous a
   * chaque frappe de l'utilisateur. Memoiser ici, une fois, plutot que dans
   * chacun des cinq consommateurs.
   */
  const fournisseurs = useMemo(
    () => (referentiel.statut === 'pret' ? referentiel.fournisseurs : []),
    [referentiel],
  );
  const ingredients = useMemo(
    () => (referentiel.statut === 'pret' ? referentiel.ingredients : []),
    [referentiel],
  );
  const commandes = useMemo(
    () => (referentiel.statut === 'pret' ? referentiel.commandes : []),
    [referentiel],
  );

  const optionsFournisseurs: OptionSelection[] = useMemo(
    () =>
      fournisseurs
        // Un fournisseur desactive reste dans l'historique mais disparait des
        // listes de choix (docs/07 §1.1).
        .filter((f) => f.actif)
        .map((f) => ({ valeur: f.id, libelle: f.nom })),
    [fournisseurs],
  );

  /*
   * SANS FOURNISSEUR ACTIF, pas de formulaire : seulement une explication.
   * Defaut connu corrige le 28/09/2026 : cet etat etait un cul-de-sac au
   * clavier (CLAUDE.md §3 regle 10). Le bouton qui ouvrait la saisie n'est plus
   * rendu, et Echap est volontairement neutralise par l'ecran parent en mode
   * reception, pour proteger une saisie recopiee d'un bon papier. Ici, il n'y
   * a AUCUNE saisie a proteger : Echap revient a l'ecran precedent, et un
   * bouton « Annuler », focalise d'office, offre la meme sortie.
   */
  const sansFournisseurActif = referentiel.statut === 'pret' && optionsFournisseurs.length === 0;
  const boutonSortieSansFournisseurRef = useRef<HTMLButtonElement>(null);
  // `onAnnuler` est souvent une fonction flechee recreee a chaque rendu du
  // parent : la lire par une ref evite de rejouer l'effet (et de reprendre le
  // focus) a chaque rendu.
  const onAnnulerRef = useRef(onAnnuler);
  onAnnulerRef.current = onAnnuler;
  useEffect(() => {
    if (!sansFournisseurActif) return;
    requestAnimationFrame(() => boutonSortieSansFournisseurRef.current?.focus());
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key === 'Escape') onAnnulerRef.current();
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [sansFournisseurActif]);

  /**
   * Le NOM SEUL, sans suffixe d'unite. Une liste deroulante coupe son propre
   * texte a la largeur du controle : « Farine de froment T55 (gramme… » perdait
   * la fin, c'est-a-dire la seule chose qui distingue une T55 d'une T65.
   * L'unite n'est pas perdue pour autant — elle est relue sous la quantite, la
   * ou elle sert reellement (« 25,0 kg »).
   */
  const optionsIngredients: OptionSelection[] = useMemo(
    () => ingredients.map((i) => ({ valeur: i.id, libelle: i.nom })),
    [ingredients],
  );

  /** Commandes encore ouvertes CHEZ LE FOURNISSEUR CHOISI, les seules soldables. */
  const commandesSoldables = useMemo(
    () =>
      fournisseurId === ''
        ? []
        : commandes.filter((c) => c.fournisseurId === fournisseurId && commandeOuverte(c)),
    [commandes, fournisseurId],
  );

  const optionsCommandes: OptionSelection[] = useMemo(
    () =>
      commandesSoldables.map((c) => ({
        valeur: c.id,
        libelle: `${c.numero} — ${formaterEuros(c.montantTotalCents)} — ${LIBELLE_STATUT_COMMANDE[c.statut]}`,
      })),
    [commandesSoldables],
  );

  /**
   * La commande CHOISIE, pour la redire en toutes lettres sous le menu
   * déroulant (« voir laquelle » — mission « boucle d'achat », 30/07/2026).
   * Le menu affiche déjà son numéro dans l'option sélectionnée, mais un menu
   * déroulant fermé n'affiche qu'un texte tronqué à la largeur du contrôle :
   * le rappel explicite, lui, ne l'est jamais.
   */
  const commandeSelectionnee = useMemo(
    () => commandesSoldables.find((c) => c.id === commandeId),
    [commandesSoldables, commandeId],
  );

  const ingredientDe = useCallback(
    (ingredientId: string): IngredientReferentiel | undefined =>
      ingredients.find((i) => i.id === ingredientId),
    [ingredients],
  );

  function modifierLigne<C extends keyof Omit<LigneBrouillon, 'cle'>>(
    cle: string,
    champ: C,
    valeur: string,
  ): void {
    setLignes((precedentes) =>
      precedentes.map((ligne) => (ligne.cle === cle ? { ...ligne, [champ]: valeur } : ligne)),
    );
    // L'erreur d'un champ disparait des qu'on le corrige : la laisser affichee
    // pendant la correction fait douter de ce qu'on vient de taper.
    setErreursLignes((precedentes) => {
      const ligne = precedentes[cle];
      if (ligne === undefined || ligne[champ] === undefined) return precedentes;
      const suite = { ...ligne };
      delete suite[champ];
      return { ...precedentes, [cle]: suite };
    });
  }

  function ajouterLigne(): void {
    const nouvelle = ligneVide();
    setLignes((precedentes) => [...precedentes, nouvelle]);
    setCleAFocaliser(nouvelle.cle);
  }

  function retirerLigne(cle: string): void {
    // Jamais zero ligne : le serveur refuse une reception vide, et un tableau
    // vide n'offre plus aucune cible de saisie au clavier.
    const lignesApres =
      lignes.length <= 1 ? [ligneVide()] : lignes.filter((ligne) => ligne.cle !== cle);

    setLignes(lignesApres);
    setErreursLignes((precedentes) => {
      const suite = { ...precedentes };
      delete suite[cle];
      return suite;
    });
    // Continuer a saisir IMMEDIATEMENT, au meme endroit a l'ecran — voir
    // `cleAFocaliserApresRetrait` ci-dessus pour la justification du choix.
    setCleAFocaliser(cleAFocaliserApresRetrait(lignes, cle, lignesApres));
  }

  /**
   * `Entrée` = ligne suivante, `Tab` = champ suivant : c'est le mode « tableur »
   * de docs/07 §4.6, celui que l'utilisateur cible connait deja. Sur la
   * derniere ligne, `Entrée` en ajoute une et y place le focus — la saisie d'un
   * bon de livraison a six articles ne demande donc jamais la souris.
   *
   * `Ctrl+Entrée` / `Cmd+Entrée` sont volontairement IGNORES ici — voir
   * `actionSurEntree` ci-dessus : c'est le raccourci d'enregistrement du
   * formulaire, pas celui-ci, qui doit les traiter.
   *
   * `preventDefault` est indispensable : sans lui, `Entrée` dans un formulaire
   * declenche l'envoi, et une reception partielle partirait a la premiere ligne.
   */
  function surEntree(
    cle: string,
    evenement: {
      readonly key: string;
      readonly ctrlKey: boolean;
      readonly metaKey: boolean;
      preventDefault: () => void;
    },
  ): void {
    const action = actionSurEntree(evenement, cle, lignes);
    if (action.type === 'ignorer') return;
    evenement.preventDefault();
    if (action.type === 'nouvelle_ligne') ajouterLigne();
    else setCleAFocaliser(action.cle);
  }

  /**
   * DLC deduite de la duree de conservation declaree de l'ingredient, exactement
   * comme le fait le serveur (`reception.ts`). Affichee pour etre CONTESTABLE :
   * une date que l'application pose en silence est une date que personne ne
   * verifie.
   */
  function dlcDeduite(ligne: LigneBrouillon): string | null {
    if (ligne.dlc.trim() !== '') return null;
    if (dateReception.trim() === '') return null;
    const ingredient = ingredientDe(ligne.ingredientId);
    if (ingredient === undefined || ingredient.dureeConservationJours === null) return null;
    return ajouterJours(dateReception, ingredient.dureeConservationJours);
  }

  /**
   * Total de controle. La somme des montants deja saisis, dans la meme unite
   * entiere que la base — c'est le nombre que l'utilisateur compare a son bon
   * de livraison papier avant de valider. Le montant qui FAIT FOI reste celui
   * que le serveur renvoie apres ecriture.
   */
  const lignesAvecPrix = lignes
    .map((ligne) => parserEuros(ligne.prix))
    .filter((centimes): centimes is number => centimes !== null);
  const totalSaisiCents = lignesAvecPrix.reduce((total, centimes) => total + centimes, 0);
  const nbPrixIllisibles = lignes.filter(
    (ligne) => ligne.prix.trim() !== '' && parserEuros(ligne.prix) === null,
  ).length;

  /**
   * Traduit le brouillon en corps de requete. Rend `null` et signale les champs
   * fautifs — jamais de valeur devinee : un zero silencieux fabriquerait une
   * entree de stock vide ou un prix d'achat faux, donc un cout matiere faux.
   */
  function construireCorps(): Record<string, unknown> | null {
    const erreursDEntete: Record<string, string> = {};
    const erreursDeLignes: ErreursLignes = {};

    if (fournisseurId === '') {
      erreursDEntete['fournisseurId'] =
        variante === 'inventaire'
          ? "Choisissez le fournisseur d'où vient cette marchandise. À défaut, créez un fournisseur « Inventaire d'ouverture » dans l'écran Fournisseurs."
          : 'Choisissez le fournisseur qui a livré cette marchandise.';
    }
    if (dateReception.trim() === '') {
      erreursDEntete['dateReception'] = 'Indiquez le jour où la marchandise est arrivée.';
    }

    const lignesCorps: LigneCorps[] = [];

    for (const ligne of lignes) {
      const erreurs: Record<string, string> = {};
      const ingredient = ingredientDe(ligne.ingredientId);

      if (ingredient === undefined) {
        erreurs['ingredientId'] = 'Choisissez un ingrédient dans la liste.';
      }

      const quantite = parserEntierPositif(ligne.quantite);
      if (quantite === null) {
        erreurs['quantite'] =
          ingredient === undefined
            ? 'La quantité reçue doit être un nombre entier supérieur à zéro.'
            : `La quantité reçue doit être un nombre entier de ${libelleUnite(ingredient.unite)}, supérieur à zéro.`;
      }

      const prixLigneCents = parserEuros(ligne.prix);
      if (prixLigneCents === null) {
        erreurs['prix'] = 'Montant illisible. Exemple attendu : 24,90';
      } else if (prixLigneCents < 0) {
        erreurs['prix'] = 'Le prix payé ne peut pas être négatif.';
      }

      const numeroLot = ligne.numeroLot.trim();
      const dlc = ligne.dlc.trim();
      /**
       * Fiche 16 (docs/17), regle CORRIGEE : un lot doit etre IDENTIFIABLE,
       * par son numero fournisseur OU par une DLC precise au jour pres — les
       * deux ne sont JAMAIS exiges ensemble (directive europeenne 2011/91/UE :
       * la DLC en clair fait deja office d'identifiant de lot). Bloquer ici
       * uniquement quand NI L'UN NI L'AUTRE n'existe, meme regle que le
       * serveur (`reception.ts`) : la ou la tracabilite est REELLEMENT
       * impossible. Quand seule la DLC identifie, aucune erreur ici — l'aide
       * du champ `numeroLot` (plus bas, dans le rendu) le signale sans
       * bloquer la saisie.
       */
      if (numeroLot === '' && dlc === '' && dlcDeduite(ligne) === null) {
        erreurs['numeroLot'] =
          'Aucun identifiant pour ce lot : indiquez un numéro de lot fournisseur, ou à défaut ' +
          'une DLC précise (jour et mois).';
      }

      if (Object.keys(erreurs).length > 0) {
        erreursDeLignes[ligne.cle] = erreurs;
        continue;
      }
      if (ingredient === undefined || quantite === null || prixLigneCents === null) continue;

      lignesCorps.push({
        ingredientId: ingredient.id,
        quantite,
        prixLigneCents,
        numeroLotFournisseur: numeroLot === '' ? null : numeroLot,
        // DLC laissee a `null` quand elle n'est pas saisie : c'est le SERVEUR
        // qui la deduit de la duree de conservation. Envoyer la date deduite
        // depuis le navigateur ferait de l'ecran la source de verite d'une
        // donnee reglementaire.
        dateDlc: dlc === '' ? null : dlc,
      });
    }

    if (Object.keys(erreursDEntete).length > 0 || Object.keys(erreursDeLignes).length > 0) {
      setErreursEntete({ champs: erreursDEntete, general: null });
      setErreursLignes(erreursDeLignes);
      focaliserPremierChampFautif(erreursDEntete, erreursDeLignes);
      return null;
    }

    return {
      fournisseurId,
      dateReception,
      numeroBonLivraison: numeroBonLivraison.trim() === '' ? null : numeroBonLivraison.trim(),
      commandeId: commandeId === '' ? null : commandeId,
      notes: notes.trim() === '' ? null : notes.trim(),
      lignes: lignesCorps,
    };
  }

  /** Focus sur le premier champ fautif (docs/07 §4.7). */
  function focaliserPremierChampFautif(
    entete: Record<string, string>,
    parLigne: ErreursLignes,
  ): void {
    const premierEntete = Object.keys(entete)[0];
    if (premierEntete !== undefined) {
      formulaireRef.current?.querySelector<HTMLElement>(`[name="${premierEntete}"]`)?.focus();
      return;
    }
    for (const ligne of lignes) {
      const champs = parLigne[ligne.cle];
      const premier = champs === undefined ? undefined : Object.keys(champs)[0];
      if (premier === undefined) continue;
      formulaireRef.current
        ?.querySelector<HTMLElement>(
          `[data-ligne="${ligne.cle}"][data-champ="${premier}"] input, [data-ligne="${ligne.cle}"][data-champ="${premier}"] select`,
        )
        ?.focus();
      return;
    }
  }

  /**
   * Reconduit le formulaire a son etat d'ouverture (recette clavier du
   * 30/07/2026 : « le porteur enchaine les receptions »). Appelee UNIQUEMENT
   * apres un enregistrement reussi — jamais apres un refus, ou la saisie
   * fautive doit rester a l'ecran pour etre corrigee (docs/07 §4.7 : ne
   * jamais faire retaper ce qui vient d'etre tape).
   */
  function reinitialiserFormulaire(): void {
    const valeurs = valeursFormulaireVide(variante, aujourdHui(), ligneVide());
    setFournisseurId(valeurs.fournisseurId);
    setDateReception(valeurs.dateReception);
    setCommandeId(valeurs.commandeId);
    setNumeroBonLivraison(valeurs.numeroBonLivraison);
    setNotes(valeurs.notes);
    setLignes(valeurs.lignes);
  }

  function enregistrer(): void {
    if (envoiEnCours) return;
    const corps = construireCorps();
    if (corps === null) return;

    // Capturée AVANT l'envoi : `reinitialiserFormulaire` remet le champ à la
    // date du jour dès le retour, et la pièce peut porter une autre date.
    const dateDeLaPiece = dateReception;

    setErreursEntete(AUCUNE_ERREUR);
    setErreursLignes({});
    setEnvoiEnCours(true);

    requeteApi<unknown>('/receptions', { method: 'POST', body: JSON.stringify(corps) })
      .then((reponse) => {
        const resultat = schemaReceptionCreee.parse(reponse);
        setEnvoiEnCours(false);
        // La réception enregistrée devient reprenable ; toute trace de la
        // précédente disparaît, y compris un formulaire d'annulation resté
        // ouvert sur elle — l'annuler après coup viserait la mauvaise pièce.
        setDerniereReception({
          receptionId: resultat.receptionId,
          numero: resultat.numero,
          dateReception: dateDeLaPiece,
          nbLots: resultat.nbLots,
          annulation: null,
        });
        setAnnulationOuverte(false);
        setMotifAnnulation('');
        setErreursAnnulation(AUCUNE_ERREUR);
        // Le formulaire redevient vierge et reprend le focus AVANT de
        // prevenir le parent : c'est ce qui rend l'enchainement possible sans
        // repasser par « Enregistrer une réception ». Voir le rapport de
        // livraison — defaut confirme deux fois au clavier, le focus retombait
        // sur `<body>` a cet instant precis.
        reinitialiserFormulaire();
        formulaireRef.current?.querySelector<HTMLElement>(SELECTEUR_PREMIER_CHAMP)?.focus();
        onEnregistre(resultat);
      })
      .catch((erreur: unknown) => {
        setEnvoiEnCours(false);
        const reparties = absorberErreurServeur(repartirErreurApi(erreur));
        setErreursEntete(reparties);
        focaliserPremierChampFautif(reparties.champs, {});
      });
  }

  function ouvrirAnnulationReception(): void {
    setErreursAnnulation(AUCUNE_ERREUR);
    setMotifAnnulation('');
    setAnnulationOuverte(true);
  }

  function fermerAnnulationReception(): void {
    setAnnulationOuverte(false);
    requestAnimationFrame(() => boutonOuvrirAnnulationRef.current?.focus());
  }

  /**
   * Annule la réception qu'on vient d'enregistrer (D-087).
   *
   * Le service contrepasse l'entrée de CHACUN de ses lots dans une seule
   * transaction. Un refus (`entree_deja_consommee`, période verrouillée) est
   * affiché TEL QUEL : le message du serveur porte déjà le nom de l'ingrédient
   * et la quantité manquante, deux chiffres qu'une reformulation perdrait.
   */
  function annulerDerniereReception(): void {
    if (annulationEnCours || derniereReception === null) return;
    const cible = derniereReception;

    if (motifAnnulation === '') {
      setErreursAnnulation({
        champs: { motifCode: 'Choisissez un motif dans la liste.' },
        general: null,
      });
      return;
    }

    setErreursAnnulation(AUCUNE_ERREUR);
    setAnnulationEnCours(true);

    requeteApi<unknown>(`/receptions/${cible.receptionId}/annuler`, {
      method: 'POST',
      body: JSON.stringify({ motifCode: motifAnnulation }),
    })
      .then((reponse) => {
        const resultat = schemaAnnulationReceptionCreee.parse(reponse);
        setAnnulationEnCours(false);
        setAnnulationOuverte(false);
        // L'enregistrement RESTE affiché à côté de son annulation : jamais
        // l'une à la place de l'autre (D-083).
        setDerniereReception({ ...cible, annulation: phraseApresAnnulationReception(resultat) });
        /**
         * LE FOCUS REVIENT AU PREMIER CHAMP DU FORMULAIRE, et c'est la
         * continuation naturelle du geste (D-079) : on annule une réception
         * qu'on vient de taper PARCE QU'ON S'EST TROMPÉ, et la seule chose
         * qu'on veut faire ensuite est de la ressaisir correctement — le
         * formulaire vide est juste au-dessus. Ce n'est pas une cible
         * inventée faute de mieux : c'est la même que celle que
         * l'enregistrement lui-même vise.
         */
        requestAnimationFrame(() => {
          formulaireRef.current?.querySelector<HTMLElement>(SELECTEUR_PREMIER_CHAMP)?.focus();
        });
      })
      .catch((erreur: unknown) => {
        setAnnulationEnCours(false);
        setErreursAnnulation(repartirErreurApi(erreur));
        // Le bloc reste ouvert : le bouton de confirmation existe toujours, il
        // a seulement été `disabled` le temps de l'appel. On lui rend le focus.
        requestAnimationFrame(() => boutonConfirmerAnnulationRef.current?.focus());
      });
  }

  const titrePanneau =
    variante === 'inventaire' ? "Inventaire d'ouverture" : 'Réception de marchandise';

  /**
   * Colonnes reconstruites a chaque rendu, et NON memoisees : chaque `rendu`
   * est une fermeture sur l'etat de saisie courant (valeur du champ, erreur de
   * la ligne, DLC deduite). Une memoisation obligerait a lister toutes ces
   * dependances pour ne rien gagner — `Tableau` ne memoise pas ses rangees.
   * L'identite DOM des champs, elle, est preservee par les cles stables
   * (`cleLigne` par rangee, `cle` par colonne) : le focus ne saute pas.
   */
  function construireColonnes(): ReadonlyArray<ColonneTableau<LigneBrouillon>> {
    const erreurDe = (ligne: LigneBrouillon, champ: string): string | undefined =>
      erreursLignes[ligne.cle]?.[champ];

    const numeroLigne = (ligne: LigneBrouillon): number =>
      lignes.findIndex((l) => l.cle === ligne.cle) + 1;

    return [
      {
        cle: 'ingredient',
        libelle: 'Ingrédient',
        largeur: '24%',
        alignement: 'texte',
        // Jamais coupe : deux ingredients peuvent partager un debut de nom
        // (« Farine de froment T55 » / « Farine de froment T65 »).
        troncature: 'repli',
        rendu: (ligne) => (
          <div data-ligne={ligne.cle} data-champ="ingredientId">
            <ChampSelection
              nom={`ingredient-${ligne.cle}`}
              libelle={`Ingrédient, ligne ${numeroLigne(ligne)}`}
              libelleMasque
              valeur={ligne.ingredientId}
              onChange={(valeur) => modifierLigne(ligne.cle, 'ingredientId', valeur)}
              options={optionsIngredients}
              optionVide="Choisir…"
              erreur={erreurDe(ligne, 'ingredientId')}
              onKeyDown={(evenement) => surEntree(ligne.cle, evenement)}
            />
          </div>
        ),
      },
      {
        cle: 'quantite',
        libelle: 'Quantité reçue',
        largeur: '17%',
        alignement: 'texte',
        troncature: 'repli',
        rendu: (ligne) => {
          const ingredient = ingredientDe(ligne.ingredientId);
          const quantite = parserEntierPositif(ligne.quantite);
          return (
            <div data-ligne={ligne.cle} data-champ="quantite">
              <ChampSaisie
                nom={`quantite-${ligne.cle}`}
                libelle={`Quantité reçue, ligne ${numeroLigne(ligne)}`}
                libelleMasque
                numerique="entier"
                valeur={ligne.quantite}
                onChange={(valeur) => modifierLigne(ligne.cle, 'quantite', valeur)}
                erreur={erreurDe(ligne, 'quantite')}
                onKeyDown={(evenement) => surEntree(ligne.cle, evenement)}
                aide={
                  ingredient === undefined
                    ? undefined
                    : quantite === null
                      ? libelleUnite(ingredient.unite)
                      : // Relecture immediate : « 25000 » se lit « 25,0 kg ».
                        // Une faute de frappe d'un facteur mille se voit ici.
                        formaterQuantite(quantite, ingredient.unite)
                }
              />
            </div>
          );
        },
      },
      {
        cle: 'prix',
        libelle: 'Prix payé (€)',
        largeur: '15%',
        alignement: 'texte',
        troncature: 'repli',
        rendu: (ligne) => (
          <div data-ligne={ligne.cle} data-champ="prix">
            <ChampSaisie
              nom={`prix-${ligne.cle}`}
              libelle={`Prix payé pour la ligne ${numeroLigne(ligne)}, en euros`}
              libelleMasque
              numerique="decimal"
              valeur={ligne.prix}
              onChange={(valeur) => modifierLigne(ligne.cle, 'prix', valeur)}
              erreur={erreurDe(ligne, 'prix')}
              onKeyDown={(evenement) => surEntree(ligne.cle, evenement)}
            />
          </div>
        ),
      },
      {
        cle: 'numeroLot',
        libelle: 'N° de lot fournisseur',
        largeur: '20%',
        alignement: 'texte',
        // Jamais coupe : un numero de lot tronque est un rappel de marchandise
        // qu'on ne peut pas effectuer (docs/07, `Tableau.tsx`).
        troncature: 'repli',
        rendu: (ligne) => {
          // Avertissement NON BLOQUANT (fiche 16) : la DLC (saisie ou deduite)
          // suffit deja a identifier ce lot — mais deux receptions a la meme
          // DLC resteront indistinguables en cas de rappel tant qu'aucun
          // numero ne les distingue. Affiche des la saisie, pas seulement
          // apres un refus serveur.
          const dlcIdentifieSeule =
            ligne.numeroLot.trim() === '' &&
            (ligne.dlc.trim() !== '' || dlcDeduite(ligne) !== null);
          return (
            <div data-ligne={ligne.cle} data-champ="numeroLot">
              <ChampSaisie
                nom={`numeroLot-${ligne.cle}`}
                libelle={`Numéro de lot fournisseur, ligne ${numeroLigne(ligne)}`}
                libelleMasque
                valeur={ligne.numeroLot}
                onChange={(valeur) => modifierLigne(ligne.cle, 'numeroLot', valeur)}
                erreur={erreurDe(ligne, 'numeroLot')}
                {...(dlcIdentifieSeule
                  ? {
                      aide: 'DLC seule : deux réceptions à cette DLC seront indistinguables en cas de rappel.',
                    }
                  : {})}
                onKeyDown={(evenement) => surEntree(ligne.cle, evenement)}
              />
            </div>
          );
        },
      },
      {
        cle: 'dlc',
        libelle: 'DLC',
        largeur: '17%',
        alignement: 'texte',
        troncature: 'repli',
        rendu: (ligne) => {
          const deduite = dlcDeduite(ligne);
          const ingredient = ingredientDe(ligne.ingredientId);
          // Voir `avertissementDlcSaisieDejaDepassee` ci-dessus : alerte NON
          // BLOQUANTE, jamais un motif de refus (CLAUDE.md §7).
          const dlcDejaDepassee = avertissementDlcSaisieDejaDepassee(
            ligne.dlc,
            deduite,
            dateReception,
            ingredient?.nom,
          );
          return (
            <div data-ligne={ligne.cle} data-champ="dlc">
              <ChampSaisie
                nom={`dlc-${ligne.cle}`}
                libelle={`Date limite de consommation, ligne ${numeroLigne(ligne)}`}
                libelleMasque
                type="date"
                valeur={ligne.dlc}
                onChange={(valeur) => modifierLigne(ligne.cle, 'dlc', valeur)}
                erreur={erreurDe(ligne, 'dlc')}
                // Indispensable ici AUSSI : sans ce gestionnaire, `Entrée` dans
                // le dernier champ d'une ligne declencherait l'envoi natif du
                // formulaire — donc une reception partielle, saisie a moitie.
                onKeyDown={(evenement) => surEntree(ligne.cle, evenement)}
                aide={
                  dlcDejaDepassee !== null ? (
                    // Glyphe canal redondant a la couleur (docs/07 §4.5), meme
                    // convention que `PastilleStatut` (`Stock.tsx`) : une alerte
                    // NON BLOQUANTE se voit, y compris a l'impression N&B.
                    <span className="text-alerte">
                      <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span> {dlcDejaDepassee}
                    </span>
                  ) : deduite !== null ? (
                    `Déduite : ${formaterDate(deduite)}`
                  ) : ligne.dlc.trim() === '' && ingredient !== undefined ? (
                    'Sans DLC : servi en dernier (FEFO)'
                  ) : undefined
                }
              />
            </div>
          );
        },
      },
      {
        // Intitule non vide : un `<th>` sans texte est annonce « colonne vide »
        // par un lecteur d'ecran, et la rangee devient impossible a situer.
        cle: 'action',
        libelle: 'Action',
        largeur: '7%',
        alignement: 'texte',
        rendu: (ligne) => (
          <button
            type="button"
            onClick={() => retirerLigne(ligne.cle)}
            className={CLASSE_BOUTON_LIEN}
            aria-label={`Retirer la ligne ${numeroLigne(ligne)}`}
          >
            Retirer
          </button>
        ),
      },
    ];
  }

  /* ═══ Rendu ══════════════════════════════════════════════════════════════ */

  if (referentiel.statut === 'chargement') {
    return (
      <Panneau titre={titrePanneau}>
        <p className="text-sm text-ink-3">Chargement du référentiel…</p>
      </Panneau>
    );
  }

  if (referentiel.statut === 'erreur') {
    return (
      <Panneau titre={titrePanneau}>
        <MessageErreur message={referentiel.message} />
      </Panneau>
    );
  }

  if (sansFournisseurActif) {
    return (
      <Panneau titre={titrePanneau}>
        <EtatVide
          variante="premier-lancement"
          titre="Aucun fournisseur actif"
          explication={
            variante === 'inventaire'
              ? "Un lot porte toujours l'identité de celui qui l'a livré : c'est une obligation de traçabilité, pas un champ décoratif. Créez d'abord un fournisseur — pour un inventaire d'ouverture, un fournisseur nommé « Inventaire d'ouverture » convient."
              : "Une réception se rattache toujours à un fournisseur : c'est lui qui identifie le lot en cas de rappel. Créez-le d'abord dans l'écran Fournisseurs."
          }
        />
        <div className="px-4 pb-4">
          <button
            ref={boutonSortieSansFournisseurRef}
            type="button"
            onClick={onAnnuler}
            className={CLASSE_BOUTON_SECONDAIRE}
          >
            Annuler
          </button>
        </div>
      </Panneau>
    );
  }

  return (
    <form
      ref={formulaireRef}
      onSubmit={(evenement) => {
        evenement.preventDefault();
        enregistrer();
      }}
      onKeyDown={(evenement) => {
        // `Ctrl+S` enregistrer, `Ctrl+Entrée` valider (docs/07 §4.6). Ni
        // `Ctrl+N` ni `Ctrl+T` ni `Ctrl+W`, reserves au navigateur.
        if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === 's') {
          evenement.preventDefault();
          enregistrer();
        }
        if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === 'Enter') {
          evenement.preventDefault();
          enregistrer();
        }
      }}
    >
      <Panneau titre={titrePanneau} sansRembourrage>
        {/* ═══ En-tete de la piece ═══════════════════════════════════════ */}
        <div className="flex flex-col gap-bloc p-4">
          <div className="grid grid-cols-1 gap-groupe lg:grid-cols-3">
            <ChampSelection
              nom="fournisseurId"
              libelle="Fournisseur"
              valeur={fournisseurId}
              onChange={(valeur) => {
                setFournisseurId(valeur);
                // La commande soldee appartient a un fournisseur : changer de
                // fournisseur sans oublier la commande rattacherait la
                // reception a la commande d'un autre.
                setCommandeId('');
              }}
              options={optionsFournisseurs}
              optionVide="Choisir…"
              obligatoire
              erreur={erreursEntete.champs['fournisseurId']}
            />
            <ChampSaisie
              nom="dateReception"
              libelle="Date de réception"
              type="date"
              valeur={dateReception}
              onChange={setDateReception}
              obligatoire
              erreur={erreursEntete.champs['dateReception']}
            />
            <ChampSaisie
              nom="numeroBonLivraison"
              libelle="N° de bon de livraison"
              valeur={numeroBonLivraison}
              onChange={setNumeroBonLivraison}
              erreur={erreursEntete.champs['numeroBonLivraison']}
            />
          </div>

          <div className="grid grid-cols-1 gap-groupe lg:grid-cols-3">
            {/* La commande ne s'affiche que s'il y en a une a solder : un
                controle vide en permanence est du chrome sans fonction
                (docs/07 §2.1). */}
            {commandesSoldables.length > 0 && (
              <ChampSelection
                nom="commandeId"
                libelle="Commande à solder"
                valeur={commandeId}
                onChange={setCommandeId}
                options={optionsCommandes}
                optionVide="Aucune (réception hors commande)"
                erreur={erreursEntete.champs['commandeId']}
                aide={
                  commandeId === ''
                    ? // D-036 : sans ce rattachement, la commande reste comptee
                      // comme « en route » par le point de commande.
                      `${commandesSoldables.length} commande${commandesSoldables.length > 1 ? 's' : ''} encore ouverte${commandesSoldables.length > 1 ? 's' : ''} chez ce fournisseur. Sans rattachement, la marchandise reçue sera comptée deux fois par le point de commande.`
                    : // Numéro redit explicitement (« voir laquelle ») : le
                      // menu déroulant fermé ne montre qu'un texte tronqué.
                      commandeSelectionnee === undefined
                      ? 'La commande passera en « reçue » et sortira du stock projeté.'
                      : `La commande ${commandeSelectionnee.numero} passera en « reçue » et sortira du stock projeté.`
                }
              />
            )}
            <div className="lg:col-span-2">
              <ChampSaisie
                nom="notes"
                libelle="Notes"
                valeur={notes}
                onChange={setNotes}
                erreur={erreursEntete.champs['notes']}
              />
            </div>
          </div>
        </div>

        {/* ═══ Lignes ════════════════════════════════════════════════════ */}
        <div className="border-t border-line">
          <Tableau
            colonnes={construireColonnes()}
            lignes={lignes}
            cleLigne={(ligne) => ligne.cle}
            etatVide={<EtatVide variante="normal" texte="Aucune ligne." />}
          />
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-2">
          <button type="button" onClick={ajouterLigne} className={CLASSE_BOUTON_LIEN}>
            Ajouter une ligne
          </button>
          {/* Les raccourcis s'apprennent en etant ecrits la ou on les utilise
              (docs/07 §4.6), pas dans une aide separee. */}
          <p className="text-xs text-ink-3">Entrée : ligne suivante · Ctrl+Entrée : enregistrer</p>
        </div>

        {/* ═══ Total de controle ═════════════════════════════════════════ */}
        <div className="flex items-baseline justify-between border-t border-line-strong bg-surface-sunken px-4 py-2">
          <span className="text-xs text-ink-2">
            {lignes.length} ligne{lignes.length > 1 ? 's' : ''} — à comparer{' '}
            {variante === 'inventaire' ? 'à votre comptage' : 'au bon de livraison'} avant
            d’enregistrer.
          </span>
          <span className="text-sm text-ink">
            Total saisi{' '}
            <span className="num font-medium">
              {lignesAvecPrix.length === 0 ? TIRET_ABSENT : `${formaterMontant(totalSaisiCents)} €`}
            </span>
            {nbPrixIllisibles > 0 && (
              <span className="ml-groupe text-xs text-alerte">
                {nbPrixIllisibles} montant{nbPrixIllisibles > 1 ? 's' : ''} illisible
                {nbPrixIllisibles > 1 ? 's' : ''}
              </span>
            )}
          </span>
        </div>

        {erreursEntete.general !== null && (
          <div className="px-4 py-2">
            <MessageErreur message={erreursEntete.general} />
          </div>
        )}

        <div className="flex items-center justify-end gap-groupe border-t border-line px-4 py-3">
          <button type="button" onClick={onAnnuler} className={CLASSE_BOUTON_SECONDAIRE}>
            Annuler
          </button>
          <button type="submit" disabled={envoiEnCours} className={CLASSE_BOUTON_PRIMAIRE}>
            {envoiEnCours
              ? 'Enregistrement…'
              : variante === 'inventaire'
                ? "Enregistrer l'inventaire"
                : 'Enregistrer la réception'}
          </button>
        </div>

        {/* ═══ Reprendre la réception qu'on vient d'écrire (D-087) ════════
            EN DERNIER dans le formulaire, jamais au-dessus des champs : la
            saisie suivante est le geste courant, la reprise est l'exception.
            Placé ici, l'ordre de tabulation reste « en-tête → lignes →
            enregistrer », et la reprise n'apparaît qu'après. */}
        {derniereReception !== null && (
          <div
            onKeyDown={(evenement) => {
              /* `Entrée` DANS ce bloc ne doit rien déclencher. Le bloc vit à
                 l'intérieur du `<form>` (il appartient au panneau de saisie) :
                 sans cette garde, `Entrée` depuis la liste des motifs
                 provoquerait la soumission IMPLICITE du formulaire, c'est-à-dire
                 l'enregistrement d'une NOUVELLE réception au moment précis où
                 l'on cherche à en défaire une. Même technique que `surEntree`
                 sur les lignes du tableau. */
              if (evenement.key === 'Enter') {
                evenement.preventDefault();
                evenement.stopPropagation();
              }
            }}
          >
            <BlocAnnulation
              // `SaisieReception` sert aussi l'inventaire d'ouverture
              // (`InventaireInitial.tsx`) : le titre suit la variante, comme
              // celui du panneau. Techniquement c'est la même réception —
              // mêmes lots, mêmes mouvements — mais l'appeler « réception »
              // devant quelqu'un qui vient de compter ses étagères le
              // ferait douter d'avoir enregistré la bonne chose.
              titre={
                variante === 'inventaire'
                  ? "Inventaire enregistré à l'instant"
                  : "Réception enregistrée à l'instant"
              }
              identite={
                <>
                  {'Réception '}
                  <span className="font-mono text-xs text-ink">{derniereReception.numero}</span>
                  {' du '}
                  {formaterDate(derniereReception.dateReception)}
                  {' — '}
                  {derniereReception.nbLots}
                  {derniereReception.nbLots > 1 ? ' lots créés.' : ' lot créé.'}
                </>
              }
              blocage={blocageAnnulationReception({
                receptionStatut: derniereReception.annulation === null ? 'active' : 'annulee',
              })}
              ouvert={annulationOuverte}
              onOuvrir={ouvrirAnnulationReception}
              onFermer={fermerAnnulationReception}
              libelleOuverture={
                variante === 'inventaire' ? 'Annuler cet inventaire…' : 'Annuler cette réception…'
              }
              phraseAvant={phraseAvantAnnulationReception({
                numero: derniereReception.numero,
                dateReception: derniereReception.dateReception,
                nbLots: derniereReception.nbLots,
                depuisUnLot: false,
              })}
              libelleConfirmation="Annuler la réception"
              nomChampMotif="motifAnnulationDerniereReception"
              motif={motifAnnulation}
              onMotifChange={setMotifAnnulation}
              erreurs={erreursAnnulation}
              enCours={annulationEnCours}
              onConfirmer={annulerDerniereReception}
              refOuvrir={boutonOuvrirAnnulationRef}
              refConfirmer={boutonConfirmerAnnulationRef}
            />
            {derniereReception.annulation !== null && (
              <div className="px-4 py-2">
                <BandeauSucces>{derniereReception.annulation}</BandeauSucces>
              </div>
            )}
          </div>
        )}
      </Panneau>
    </form>
  );
}
