import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TIRET_ABSENT,
  formaterDate,
  formaterDateTableau,
  formaterMontant,
  formaterQuantite,
  motifsPour,
  schemaAnnulationReceptionCreee,
  schemaListeMouvementsLot,
  schemaLotAvecReception,
  schemaStatutLotChange,
  type LotAvecReception,
  type LotDetail,
  type MouvementLotContrat,
  type StatutLot,
  type Unite,
} from '@batte/core';
import { requeteApi } from '../lib/api';
import { aujourdHui } from '../lib/dates';
import { BoutonDocument } from '../composants/BoutonDocument';
import { MessageErreur } from '../composants/EncartErreur';
import {
  AUCUNE_ERREUR,
  CLASSE_BOUTON_LIEN,
  CLASSE_BOUTON_PRIMAIRE,
  CLASSE_BOUTON_SECONDAIRE,
  ChampSelection,
  repartirErreurApi,
  type ErreursFormulaire,
  type OptionSelection,
} from './champs';
import {
  OPTIONS_MOTIF_ANNULATION,
  blocageAnnulationReception,
  phraseApresAnnulationReception,
  phraseAvantAnnulationReception,
} from './annulation';
import { BlocAnnulation } from './BlocAnnulation';

/**
 * Options de motif, calculées UNE FOIS au chargement du module.
 *
 * Ces listes venaient d'un `GET /motifs` suivi d'un filtre par catégorie
 * réécrit à la main — c'est-à-dire `motifsPour` (`@batte/core`) réimplémenté
 * dans le navigateur, contre la règle d'architecture n°1. Or `motifsPour` lit
 * `CATALOGUE_MOTIFS`, un module statique déjà présent côté navigateur : la
 * requête relayait une donnée qu'on avait déjà. Elle est donc supprimée, avec
 * son état de chargement et son chemin d'erreur, devenus sans objet.
 *
 * Au niveau du module et non dans un `useMemo` : le catalogue ne change pas
 * pendant la vie de l'application, donc recalculer par composant n'apporterait
 * rien — et `motifsPour` rend un tableau neuf à chaque appel, ce qui ferait
 * inutilement changer une dépendance de rendu.
 *
 * Même correction que `SaisieSortie.tsx` (30/07/2026), et côté API que les deux
 * duplications de `definitionMotif` dans `routes/stock.ts`.
 *
 * La liste d'AJUSTEMENT, elle, a migré dans `annulation.ts`
 * (`OPTIONS_MOTIF_ANNULATION`) : la contrepassation d'un mouvement et
 * l'annulation d'une réception choisissent dans le MÊME catalogue, et deux
 * copies auraient fini par diverger.
 */
const OPTIONS_MOTIF_STATUT: OptionSelection[] = motifsPour('statut_lot').map((motif) => ({
  valeur: motif.code,
  libelle: motif.libelle,
}));

/**
 * Détail d'UN lot : son statut, son historique de mouvements, et les deux
 * gestes rares et critiques qui n'étaient atteignables par aucune interface.
 *
 * 1. LA CONTREPASSATION. C'est le seul chemin de correction prévu par
 *    CLAUDE.md §3 règle 7 (« corrections par écriture d'annulation, jamais par
 *    DELETE »). Sans elle, une erreur de saisie de stock est DÉFINITIVE : qui
 *    tape 250 kg au lieu de 25 kg n'a aucun recours. Elle vit ici, dans
 *    l'historique du lot, parce que c'est là qu'on VOIT l'erreur — corriger
 *    ailleurs que là où l'on constate obligerait à retrouver la ligne deux fois.
 *
 * 1 bis. L'ANNULATION DE LA RÉCEPTION qui a créé ce lot (D-087, 31/07/2026).
 *    `POST /receptions/:id/annuler` existait — service, contrat, motif
 *    obligatoire, tests de route — et AUCUN écran ne l'appelait : le porteur
 *    n'avait donc aucun moyen légitime de corriger une réception saisie deux
 *    fois, alors que la règle 7 n'autorise que l'écriture d'annulation motivée.
 *    Ce geste vit ICI, sur le lot, et pas sur la commande ni dans un écran
 *    « Réceptions » : aucune route ne LIT les réceptions, et surtout on ne
 *    pense jamais « je veux annuler RC-2026-0007 » — on pense « ces 10 kg de
 *    farine n'auraient jamais dû entrer ». Le lot EST la conséquence
 *    observable de la réception, et c'est la seule voie qui reste atteignable
 *    une fois l'écran de saisie quitté.
 *
 * 2. LA MISE EN QUARANTAINE. `schema.ts` la motive : « un ERP BLOQUE et exige
 *    un déblocage explicite tracé ; c'est aussi une exigence AFSCA : un lot
 *    suspecté doit pouvoir être mis en quarantaine avant décision. » La FEFO ne
 *    consomme que les lots `disponible` : le mécanisme protège réellement, il
 *    n'avait simplement aucun déclencheur.
 *
 * DEUX RÈGLES D'INTERFACE, ET AUCUNE N'EST COSMÉTIQUE.
 *
 * — LA LIGNE ANNULÉE RESTE VISIBLE ET BARRÉE. « Rien ne s'efface » est une
 *   promesse faite à l'utilisateur, pas seulement une règle de base de données.
 *   Le style existe déjà dans `index.css` (`tbody tr[data-annule='true']`) et
 *   attendait son premier usage. C'est aussi pour cela que ce tableau n'est PAS
 *   un `Tableau` : ce composant, qu'on ne modifie pas ici, ne sait pas poser
 *   d'attribut sur une rangée. La couche `base` de `index.css` habille tout
 *   `<table>` du produit, donc le rendu reste strictement celui des autres
 *   tableaux.
 *
 *   Et le barré n'est QU'un barré : D-021 rappelle que les cumuls incluent les
 *   écritures annulées. Masquer la ligne ici et la soustraire là-bas rendrait
 *   la matière deux fois (29 000 g au lieu de 25 000, mesuré à l'époque).
 *
 * — AUCUNE ACTION IRRÉVERSIBLE NE PART SUR `Entrée`. Ni la contrepassation ni
 *   le changement de statut ne sont enveloppés dans un `<form>` : il n'y a donc
 *   pas de soumission implicite. Même précaution que « Lancer la production »,
 *   qui consomme le stock en FEFO. La destruction d'un lot demande en plus une
 *   confirmation explicite — c'est le seul statut dont on ne revient pas.
 *
 * Règle d'architecture n°1 : aucun calcul ici. Chaque quantité, chaque coût
 * vient tel quel de l'API ; le signe affiché devant une quantité est un mappage
 * fixe du TYPE de mouvement, pas une arithmétique.
 */

type TypeMouvement = MouvementLotContrat['type'];

const LIBELLE_TYPE: Readonly<Record<TypeMouvement, string>> = {
  entree: 'Réception',
  sortie_production: 'Production',
  sortie_vente: 'Vente',
  perte: 'Perte',
  ajustement_inventaire: 'Ajustement',
  consommation_perso: 'Sortie volontaire',
};

/**
 * La quantité est TOUJOURS stockée positive, c'est le type qui porte le signe
 * (`schema.ts`). Sans ce rappel à l'écran, une entrée de 25 kg et une sortie de
 * 25 kg s'écrivent à l'identique dans la colonne — et l'historique devient
 * illisible au moment précis où on le lit pour comprendre un écart.
 * Mappage fixe, jamais un calcul : le signe MOINS typographique, pas un tiret.
 */
const SIGNE_TYPE: Readonly<Record<TypeMouvement, string>> = {
  entree: '+',
  sortie_production: '−',
  sortie_vente: '−',
  perte: '−',
  ajustement_inventaire: '−',
  consommation_perso: '−',
};

const LIBELLE_STATUT: Readonly<Record<StatutLot, string>> = {
  disponible: 'Disponible',
  quarantaine: 'Quarantaine',
  bloque: 'Bloqué',
  detruit: 'Détruit',
};

/**
 * Ce que chaque statut CHANGE, en une phrase. Un libellé seul ne dit pas qu'un
 * lot bloqué cesse d'être servi par la FEFO — or c'est la seule chose qui
 * compte au moment de choisir.
 */
const EFFET_STATUT: Readonly<Record<StatutLot, string>> = {
  disponible: 'La FEFO peut de nouveau servir ce lot.',
  quarantaine: 'Le lot est retiré de la FEFO en attendant une décision.',
  bloque: 'Le lot est retiré de la FEFO — rappel fournisseur, non-conformité.',
  detruit: 'Le lot est sorti définitivement. Ce statut ne se reprend pas.',
};

const OPTIONS_STATUT: readonly OptionSelection[] = (
  ['disponible', 'quarantaine', 'bloque', 'detruit'] as const
).map((statut) => ({ valeur: statut, libelle: LIBELLE_STATUT[statut] }));

/**
 * Cle du mouvement a focaliser une fois qu'on vient d'en contrepasser un
 * (recette clavier du 30/07/2026, D-079 / docs/22 §2.1 : le focus retombait
 * sur `<body>`, comme les autres cas du sweep).
 *
 * LE GESTE REEL, VERIFIE avant d'ecrire cette fonction : contrepasser NE FAIT
 * PAS disparaitre la ligne du mouvement corrige — CLAUDE.md §3 regle 7,
 * « rien ne s'efface » : le mouvement original reste au tableau, barre
 * (`isAnnule`), et une ECRITURE INVERSE nouvelle s'ajoute a cote. Ce n'est
 * donc PAS le cas de `cleAFocaliserApresRetrait` (SaisieReception.tsx), qui
 * suppose une ligne reellement retiree du tableau — appliquer son calcul
 * d'index ici serait faux, puisque rien n'est retire de la liste.
 *
 * C'est en revanche EXACTEMENT le cas de `cleEcheanceAFocaliserApresPointage`
 * (Comptabilite.tsx) : la ligne reste affichee, seul le BOUTON d'action de
 * CETTE ligne disparait (remplace par « Annule » ou « Contrepassation », voir
 * le rendu du tableau plus bas) — donc la continuite naturelle est le
 * PROCHAIN mouvement encore corrigeable, memes bornes, meme raisonnement
 * transpose une seconde fois. Si le contrepasse etait le dernier corrigeable,
 * on revient sur le precedent ; s'il n'en reste aucun, `null` — aucune cible
 * forcee, meme choix que sur l'echeancier plutot qu'un repli invente.
 */
export function cleMouvementAFocaliserApresContrepassation(
  mouvementsAvant: readonly Pick<MouvementLotContrat, 'id' | 'isAnnule' | 'estContrepassation'>[],
  idContrepasse: string,
): string | null {
  const corrigeablesAvant = mouvementsAvant
    .filter((m) => !m.isAnnule && !m.estContrepassation)
    .map((m) => m.id);
  const indexAvant = corrigeablesAvant.findIndex((id) => id === idContrepasse);
  const corrigeablesApres = corrigeablesAvant.filter((id) => id !== idContrepasse);
  if (corrigeablesApres.length === 0) return null;
  const indexCible = Math.min(Math.max(indexAvant, 0), corrigeablesApres.length - 1);
  return corrigeablesApres[indexCible] ?? null;
}

type EtatMouvements =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; mouvements: MouvementLotContrat[]; nbAnnules: number };

/**
 * Le MÊME lot, relu par `GET /lots/:lotId` — la seule route qui porte sa
 * RÉCEPTION d'origine (identifiant, numéro lisible, nombre de lots créés).
 *
 * Pourquoi un second appel alors que `lot` est déjà une propriété : le lot
 * reçu du parent vient de `GET /stock/:id/lots`, dont la route assemble le
 * contrat champ par champ (`apps/api/src/routes/stock.ts`) et ne transporte
 * pas ces trois-là. Le jour où elle les transportera, ce second appel et cet
 * état disparaissent — voir le commentaire de `schemaLotAvecReception`
 * (`packages/core/src/contrats/stock.ts`).
 */
type EtatReception =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lot: LotAvecReception };

type DetailLotProps = {
  lot: LotDetail;
  nomIngredient: string;
  unite: Unite;
  /** Appelé après toute écriture : le tableau de stock et les lots sont périmés. */
  onEcriture: (message: string) => void;
};

export function DetailLot({ lot, nomIngredient, unite, onEcriture }: DetailLotProps) {
  const [etatMouvements, setEtatMouvements] = useState<EtatMouvements>({ statut: 'chargement' });
  const [etatReception, setEtatReception] = useState<EtatReception>({ statut: 'chargement' });
  const [revision, setRevision] = useState(0);

  // ─── Annulation de la réception d'origine (D-087) ────────────────────────
  const [annulationOuverte, setAnnulationOuverte] = useState(false);
  const [motifAnnulation, setMotifAnnulation] = useState('');
  const [erreursAnnulation, setErreursAnnulation] = useState<ErreursFormulaire>(AUCUNE_ERREUR);
  /**
   * Les deux boutons du bloc d'annulation, tenus par `ref` — D-079,
   * complément du 31/07/2026 : `disabled={envoiEnCours}` posé sur le bouton
   * qui a le focus le lui fait LÂCHER par le navigateur, avant tout rendu
   * React, et le focus retombe sur `<body>`. Le nœud n'est pas démonté, il
   * devient inéligible ; c'est le cas général de tout bouton d'action
   * asynchrone protégé contre le double-clic. Même remède que `boutonSortir`
   * dans `Stock.tsx` : `requestAnimationFrame` + `ref`.
   */
  const boutonOuvrirAnnulationRef = useRef<HTMLButtonElement>(null);
  const boutonConfirmerAnnulationRef = useRef<HTMLButtonElement>(null);

  // ─── Changement de statut ────────────────────────────────────────────────
  const [statutOuvert, setStatutOuvert] = useState(false);
  const [statutVise, setStatutVise] = useState<StatutLot>('quarantaine');
  const [motifStatut, setMotifStatut] = useState('');
  const [destructionConfirmee, setDestructionConfirmee] = useState(false);
  const [erreursStatut, setErreursStatut] = useState<ErreursFormulaire>(AUCUNE_ERREUR);
  // Bouton bascule « Changer le statut… » : se REFERME en appliquant un
  // nouveau statut, donc DEMONTE le bouton « Appliquer le statut » qui vient
  // d'être cliqué (recette clavier du 30/07/2026, D-079 / docs/22 §2.1). Sans
  // cette ref, le focus retombe sur `<body>` — même mécanisme que
  // `boutonSortir` dans `Stock.tsx`.
  const boutonChangerStatutRef = useRef<HTMLButtonElement>(null);

  // ─── Contrepassation ─────────────────────────────────────────────────────
  const [mouvementACorriger, setMouvementACorriger] = useState<string | null>(null);
  const [motifCorrection, setMotifCorrection] = useState('');
  const [erreursCorrection, setErreursCorrection] = useState<ErreursFormulaire>(AUCUNE_ERREUR);
  /**
   * Mouvement dont le bouton « Corriger… » doit recevoir le focus au prochain
   * rendu (voir `cleMouvementAFocaliserApresContrepassation` ci-dessus). Un
   * état + un effet, jamais un ref direct sur le bouton : ce tableau n'a pas
   * de composant `Tableau.tsx` pour poser une ref imperative par ligne, même
   * limite que `cleEcheanceAFocaliser` dans `Comptabilite.tsx`.
   */
  const [mouvementAFocaliser, setMouvementAFocaliser] = useState<string | null>(null);
  // Portée des recherches `[data-mouvement="…"]` ci-dessous — même rôle que
  // `refListeEcheances` dans `Comptabilite.tsx`.
  const conteneurRef = useRef<HTMLDivElement>(null);

  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const anneeReference = Number.parseInt(aujourdHui().slice(0, 4), 10);

  /**
   * Dernier lot pour lequel les mouvements ont été chargés — distingue les
   * deux déclencheurs de l'effet ci-dessous SANS dupliquer la fonction (même
   * raisonnement que l'effet des lots dans `Stock.tsx`, D-079 / docs/22
   * §2.1) :
   *  - changer de LOT (`lot.id` change) est un PREMIER chargement, rien
   *    n'est encore affiché — `'chargement'` est légitime ;
   *  - un bump de `revision` sur le MÊME lot est un rechargement
   *    D'ARRIÈRE-PLAN déclenché par `appliquerStatut`/`contrepasser`
   *    ci-dessous. Y repasser par `'chargement'` démonterait ce tableau de
   *    mouvements et son formulaire de correction — y compris le bouton qui
   *    vient d'agir — et ferait retomber le focus sur `<body>`.
   */
  const dernierLotChargeRef = useRef<string | null>(null);

  useEffect(() => {
    let annule = false;
    const premierChargement = dernierLotChargeRef.current !== lot.id;
    dernierLotChargeRef.current = lot.id;
    if (premierChargement) {
      setEtatMouvements({ statut: 'chargement' });
      setEtatReception({ statut: 'chargement' });
    }

    requeteApi<unknown>(`/lots/${lot.id}/mouvements`)
      .then((reponse) => {
        const liste = schemaListeMouvementsLot.parse(reponse);
        if (annule) return;
        setEtatMouvements({
          statut: 'pret',
          mouvements: liste.data,
          nbAnnules: liste.meta.nbAnnules,
        });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        setEtatMouvements({
          statut: 'erreur',
          message: repartirErreurApi(erreur).general ?? 'Erreur inattendue, sans plus de détail.',
        });
      });

    // Deux chaînes INDÉPENDANTES et non un `Promise.all` : un échec de l'une
    // ne doit pas effacer ce que l'autre a réussi à afficher. L'historique des
    // mouvements reste lisible même si la réception d'origine ne se relit pas,
    // et réciproquement.
    requeteApi<unknown>(`/lots/${lot.id}`)
      .then((reponse) => {
        const relu = schemaLotAvecReception.parse(reponse);
        if (!annule) setEtatReception({ statut: 'pret', lot: relu });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        setEtatReception({
          statut: 'erreur',
          message: repartirErreurApi(erreur).general ?? 'Erreur inattendue, sans plus de détail.',
        });
      });

    return () => {
      annule = true;
    };
  }, [lot.id, revision]);

  // Continue la correction sur le PROCHAIN mouvement encore corrigeable
  // (recette clavier du 30/07/2026 — voir `cleMouvementAFocaliserApresContrepassation`
  // ci-dessus). Le bouton cible existe déjà au moment où cet effet s'exécute :
  // contrepasser un mouvement ne modifie ni l'id ni la position des AUTRES
  // lignes, qui ne sont donc jamais démontées par le rechargement en tâche de
  // fond (effet ci-dessus, une fois corrigé pour ne plus transiter par
  // `'chargement'`).
  useEffect(() => {
    if (mouvementAFocaliser === null) return;
    conteneurRef.current
      ?.querySelector<HTMLElement>(`[data-mouvement="${mouvementAFocaliser}"] button`)
      ?.focus();
    setMouvementAFocaliser(null);
  }, [mouvementAFocaliser]);

  // Changer de lot referme tout : laisser un formulaire de destruction ouvert
  // sur un lot qu'on vient de quitter est exactement le geste qu'on cherche à
  // rendre impossible.
  useEffect(() => {
    setStatutOuvert(false);
    setMouvementACorriger(null);
    setDestructionConfirmee(false);
    setErreursStatut(AUCUNE_ERREUR);
    setErreursCorrection(AUCUNE_ERREUR);
    setAnnulationOuverte(false);
    setErreursAnnulation(AUCUNE_ERREUR);
  }, [lot.id]);

  const rafraichir = useCallback(() => setRevision((precedent) => precedent + 1), []);

  const optionsMotifStatut = OPTIONS_MOTIF_STATUT;

  const optionsMotifCorrection = OPTIONS_MOTIF_ANNULATION;

  function ouvrirStatut(): void {
    setErreursStatut(AUCUNE_ERREUR);
    setDestructionConfirmee(false);
    // Proposer un statut DIFFÉRENT de l'actuel : le serveur refuse le
    // changement nul (422 `statut_inchange`), autant ne jamais le proposer.
    setStatutVise(lot.statut === 'quarantaine' ? 'disponible' : 'quarantaine');
    setMotifStatut('');
    setStatutOuvert(true);
  }

  function appliquerStatut(): void {
    if (envoiEnCours) return;

    if (motifStatut === '') {
      setErreursStatut({
        champs: { motifCode: 'Choisissez un motif dans la liste.' },
        general: null,
      });
      return;
    }

    // Palier de confirmation pour le seul statut dont on ne revient pas. Un
    // clic ne détruit jamais un lot ; il demande d'abord confirmation.
    if (statutVise === 'detruit' && !destructionConfirmee) {
      setDestructionConfirmee(true);
      return;
    }

    setErreursStatut(AUCUNE_ERREUR);
    setEnvoiEnCours(true);

    requeteApi<unknown>(`/lots/${lot.id}/statut`, {
      method: 'PATCH',
      body: JSON.stringify({ statut: statutVise, motifCode: motifStatut }),
    })
      .then((reponse) => {
        const resultat = schemaStatutLotChange.parse(reponse);
        setEnvoiEnCours(false);
        setStatutOuvert(false);
        setDestructionConfirmee(false);
        // Une destruction qui a reellement retire de la matiere l'annonce EN
        // CHIFFRE (regle n°5, docs/17 fiche 18) : la confirmation doit dire CE
        // QUI a bouge, jamais seulement « c'est fait ». Un lot deja vide au
        // moment de la destruction n'ecrit aucun mouvement — la phrase generale
        // suffit alors.
        const detailDestruction =
          resultat.mouvementDestructionId !== null &&
          resultat.quantiteDetruite !== null &&
          resultat.coutDetruitCents !== null
            ? ` ${formaterQuantite(resultat.quantiteDetruite, unite)} sorties du stock en mouvement ` +
              `de perte (${formaterMontant(resultat.coutDetruitCents)}), tracées au journal.`
            : '';
        onEcriture(
          `Lot ${lot.numeroLotFournisseur ?? lot.id} — statut « ${LIBELLE_STATUT[lot.statut]} » ` +
            `remplacé par « ${LIBELLE_STATUT[statutVise]} ». ${EFFET_STATUT[statutVise]}${detailDestruction}`,
        );
        /**
         * Reposer le focus sur le bouton bascule qui vient de réapparaître
         * (recette clavier du 30/07/2026, D-079 / docs/22 §2.1) : le bouton
         * « Appliquer le statut », qui avait le focus, est démonté avec le
         * formulaire par `setStatutOuvert(false)` ci-dessus. `requestAnimationFrame`
         * est nécessaire — même patron que `boutonSortir` dans `Stock.tsx` —
         * car `boutonChangerStatutRef` ne pointe vers un nœud monté qu'APRÈS
         * le prochain rendu, jamais au moment de cet appel.
         *
         * LIMITE CONNUE, ASSUMÉE, PAS COMBLÉE : si ce changement de statut
         * fait sortir le lot de la liste FILTRÉE que `Stock.tsx` affiche
         * (`quantiteRestante === 0 ET statut redevenu 'disponible'` —
         * `apps/api/src/routes/stock.ts`, filtre de `/stock/:id/lots`),
         * `<DetailLot>` se démonte entièrement dès que le rechargement du
         * parent aboutit, et cette ref ne pointera plus rien. Aucun repli
         * n'est fabriqué pour ce cas rare : même choix que l'échéancier de
         * `Comptabilite.tsx` (D-079) — quand la cible naturelle n'existe
         * plus, on ne force rien.
         */
        requestAnimationFrame(() => boutonChangerStatutRef.current?.focus());
        // Sans ce rafraichissement, l'historique de CE lot restait sur son
        // ancienne revision : le mouvement de destruction venait d'etre ecrit
        // mais n'apparaissait qu'apres avoir referme puis rouvert le lot. Meme
        // reflexe que `contrepasser()` juste en dessous.
        rafraichir();
      })
      .catch((erreur: unknown) => {
        setEnvoiEnCours(false);
        setDestructionConfirmee(false);
        setErreursStatut(repartirErreurApi(erreur));
      });
  }

  function ouvrirCorrection(mouvementId: string): void {
    setErreursCorrection(AUCUNE_ERREUR);
    setMotifCorrection('');
    setMouvementACorriger(mouvementId);
  }

  function contrepasser(mouvement: MouvementLotContrat): void {
    if (envoiEnCours) return;

    if (motifCorrection === '') {
      setErreursCorrection({
        champs: { motifCode: 'Choisissez un motif dans la liste.' },
        general: null,
      });
      return;
    }

    // Capture AVANT l'aller-retour reseau : c'est l'etat affiche au moment du
    // clic qui decide de la prochaine cible, jamais un etat deja recharge
    // (meme raisonnement que `marquerEcheanceFaite`, `Comptabilite.tsx`).
    const mouvementsAvant = mouvements;

    setErreursCorrection(AUCUNE_ERREUR);
    setEnvoiEnCours(true);

    requeteApi<unknown>(`/mouvements/${mouvement.id}/annuler`, {
      method: 'POST',
      body: JSON.stringify({ motifCode: motifCorrection }),
    })
      .then(() => {
        setEnvoiEnCours(false);
        setMouvementACorriger(null);
        onEcriture(
          `Mouvement contrepassé — ${formaterQuantite(mouvement.quantite, unite)} de ` +
            `${nomIngredient} remis en jeu. Les deux écritures restent au journal.`,
        );
        // Continuer la correction sans repasser par `<body>` — voir
        // `cleMouvementAFocaliserApresContrepassation` ci-dessus pour la
        // justification du choix (même limite assumée qu'`appliquerStatut` :
        // si ce mouvement fait sortir le lot de la liste filtrée de
        // `Stock.tsx`, `<DetailLot>` se démonte et rien ne force de cible).
        setMouvementAFocaliser(
          cleMouvementAFocaliserApresContrepassation(mouvementsAvant, mouvement.id),
        );
        rafraichir();
      })
      .catch((erreur: unknown) => {
        setEnvoiEnCours(false);
        setErreursCorrection(repartirErreurApi(erreur));
      });
  }

  function ouvrirAnnulationReception(): void {
    setErreursAnnulation(AUCUNE_ERREUR);
    setMotifAnnulation('');
    setAnnulationOuverte(true);
  }

  function fermerAnnulationReception(): void {
    setAnnulationOuverte(false);
    // Le bouton « Annuler la réception… » vient de réapparaître : il n'existe
    // qu'au prochain rendu, d'où `requestAnimationFrame` — même patron que
    // `boutonChangerStatutRef` ci-dessus.
    requestAnimationFrame(() => boutonOuvrirAnnulationRef.current?.focus());
  }

  /**
   * ANNULE LA RÉCEPTION D'ORIGINE de ce lot (D-087). Le service contrepasse
   * l'entrée de CHACUN de ses lots dans une seule transaction : si un seul a
   * déjà été consommé, `contrepasserMouvement` lève `entree_deja_consommee` et
   * TOUTE l'annulation échoue — comportement correct, et le message du serveur
   * porte déjà le nom de l'ingrédient et la quantité manquante. On l'affiche
   * tel quel : le reformuler ici perdrait précisément les deux chiffres qui
   * rendent le refus actionnable.
   */
  function annulerLaReception(): void {
    if (envoiEnCours || etatReception.statut !== 'pret') return;
    const receptionId = etatReception.lot.receptionId;

    if (motifAnnulation === '') {
      setErreursAnnulation({
        champs: { motifCode: 'Choisissez un motif dans la liste.' },
        general: null,
      });
      return;
    }

    setErreursAnnulation(AUCUNE_ERREUR);
    setEnvoiEnCours(true);

    requeteApi<unknown>(`/receptions/${receptionId}/annuler`, {
      method: 'POST',
      body: JSON.stringify({ motifCode: motifAnnulation }),
    })
      .then((reponse) => {
        const resultat = schemaAnnulationReceptionCreee.parse(reponse);
        setEnvoiEnCours(false);
        setAnnulationOuverte(false);
        onEcriture(phraseApresAnnulationReception(resultat));
        /**
         * AUCUNE CIBLE DE FOCUS FORCÉE ICI-MÊME, et ce n'est plus tout à fait
         * le choix qui l'était (mise à jour du 31/07/2026, D-083) : le bouton
         * qui vient d'agir disparaît toujours (`setAnnulationOuverte(false)`
         * ci-dessus démonte le bouton de confirmation), et le lot, lui, ne
         * quitte PLUS forcément la liste filtrée de `Stock.tsx` — corrigée le
         * même jour pour garder visible un lot dont la réception est annulée
         * (`apps/api/src/routes/stock.ts`, D-083). Mais MÊME quand le lot
         * survit, il ne reste rien À L'INTÉRIEUR de ce bloc vers quoi revenir
         * : une fois `receptionStatut === 'annulee'`, `BlocAnnulation`
         * n'affiche plus qu'une phrase de blocage (`blocageAnnulationReception`,
         * `annulation.ts`) à la place du bouton. Fabriquer une cible ICI
         * serait donc l'inventer. Le repli existe, mais un niveau AU-DESSUS,
         * dans `ecritureSurLot` (`Stock.tsx`) : voir son commentaire pour le
         * raisonnement complet, y compris la seconde cause de perte de focus
         * (`disabled={enCours}` sur le bouton qui vient de cliquer).
         */
        rafraichir();
      })
      .catch((erreur: unknown) => {
        setEnvoiEnCours(false);
        setErreursAnnulation(repartirErreurApi(erreur));
        // Le refus, lui, LAISSE le bloc ouvert : le bouton de confirmation
        // existe toujours, il a seulement été `disabled` le temps de l'appel —
        // donc lâché par le navigateur. On le lui rend.
        requestAnimationFrame(() => boutonConfirmerAnnulationRef.current?.focus());
      });
  }

  const mouvements = etatMouvements.statut === 'pret' ? etatMouvements.mouvements : [];

  return (
    <div className="flex flex-col" ref={conteneurRef}>
      {/* ─── Bandeau de statut ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-groupe border-b border-line px-4 py-2">
        <div>
          <p className="text-xs text-ink-3">
            Lot{' '}
            <span className="font-mono text-xs text-ink">
              {lot.numeroLotFournisseur ?? TIRET_ABSENT}
            </span>
            {' · reçu le '}
            {formaterDate(lot.dateReception)}
            {' · statut '}
            <span className="font-medium text-ink">{LIBELLE_STATUT[lot.statut]}</span>
            {' — '}
            {EFFET_STATUT[lot.statut]}
          </p>
          {/* Identifiant TECHNIQUE, distinct du numéro fournisseur ci-dessus.
              Sans lui affiché ici, la recherche « Aval » du Registre AFSCA
              (« ce lot est rappelé, où est-il parti ? ») et le rattachement
              d'une non-conformité à ce lot précis n'avaient AUCUNE valeur à
              saisir : cet identifiant n'apparaissait nulle part ailleurs dans
              l'application. Le numéro fournisseur reste le repère usuel — la
              recherche AFSCA l'accepte désormais aussi — mais quand plusieurs
              lots partagent le même numéro (même fournisseur, même mention),
              seul cet identifiant cible celui-ci sans ambiguïté. */}
          <p className="mt-groupe text-2xs text-ink-3">
            Identifiant technique (pour la recherche de traçabilité du Registre AFSCA si le numéro
            de lot est ambigu ou absent) :{' '}
            <span className="select-all font-mono text-2xs text-ink-2">{lot.id}</span>
          </p>
        </div>
        <div className="flex items-center gap-groupe">
          {/* TOUJOURS VISIBLE, jamais conditionné au statut du lot (mission du
              01/08/2026). Deux raisons, pas une préférence esthétique :
                1. La recherche « Aval » du Registre AFSCA, qui lit exactement
                   les mêmes données (`tracabiliteAvalLot`), n'est elle-même
                   conditionnée à AUCUN statut — un contrôleur peut demander la
                   traçabilité d'un lot parfaitement `disponible`, hors de tout
                   rappel. Réserver ce bouton aux statuts `quarantaine`/`bloque`
                   rendrait, pour la MÊME donnée, ce geste plus restrictif ici
                   que sur l'écran qui sert justement de référence.
                2. `BoutonDocument` porte déjà la doctrine du produit sur ce
                   point (docs/07 §0, « ne jamais faire sentir l'utilisateur
                   idiot ») : un geste rare reste ATTEIGNABLE en permanence,
                   quitte à expliquer pourquoi il est inerte — jamais caché.
                   Un bouton conditionnel est introuvable le jour précis où le
                   meunier appelle et où ce lot est encore `disponible` à
                   l'écran, la mise en quarantaine n'ayant pas encore été
                   saisie. Il n'y a d'ailleurs ici aucun état qui invaliderait
                   le document (contrairement à l'étiquette de bac d'une
                   production annulée) : un lot sans aucune production
                   consommatrice donne un document qui le DIT, ce n'est pas
                   une erreur — donc aucun `raisonIndisponible` non plus. */}
          <BoutonDocument
            chemin={`/documents/fiche-rappel/${lot.id}`}
            libelle="Fiche de rappel (PDF)"
            libelleAttente="Édition de la fiche…"
          />
          {!statutOuvert && (
            <button
              type="button"
              ref={boutonChangerStatutRef}
              onClick={ouvrirStatut}
              className={`text-xs ${CLASSE_BOUTON_LIEN}`}
            >
              Changer le statut…
            </button>
          )}
        </div>
      </div>

      {/* Volontairement PAS un <form> : `Entrée` ne doit pas pouvoir bloquer ni
          détruire un lot par mégarde (docs/07, même précaution que « Lancer la
          production »). */}
      {statutOuvert && (
        <div className="flex flex-col gap-groupe border-b border-line px-4 py-3">
          <div className="grid grid-cols-1 items-start gap-groupe lg:grid-cols-3">
            <ChampSelection
              nom="statut"
              libelle="Nouveau statut"
              valeur={statutVise}
              onChange={(valeur) => {
                setStatutVise(valeur as StatutLot);
                setDestructionConfirmee(false);
              }}
              options={OPTIONS_STATUT}
              erreur={erreursStatut.champs['statut']}
              aide={EFFET_STATUT[statutVise]}
            />
            <ChampSelection
              nom="motifCode"
              libelle="Motif"
              valeur={motifStatut}
              onChange={(valeur) => setMotifStatut(valeur)}
              options={optionsMotifStatut}
              optionVide="Choisir…"
              obligatoire
              erreur={erreursStatut.champs['motifCode']}
              aide="Choisi dans la liste, jamais tapé : c'est lui qui reste au journal d'audit."
            />
          </div>

          {destructionConfirmee && (
            <div
              role="alert"
              className="border-l-2 border-depassement bg-depassement-bg px-3 py-2 text-sm text-depassement"
            >
              Ce lot sera marqué <strong>détruit</strong> : il sortira définitivement de la FEFO et
              ce statut ne se reprend pas. Ses mouvements resteront lisibles au journal. Confirmez
              pour appliquer.
            </div>
          )}

          {erreursStatut.general !== null && <MessageErreur message={erreursStatut.general} />}

          <div className="flex items-center justify-end gap-groupe">
            <button
              type="button"
              onClick={() => {
                setStatutOuvert(false);
                setDestructionConfirmee(false);
              }}
              className={CLASSE_BOUTON_SECONDAIRE}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={appliquerStatut}
              disabled={envoiEnCours}
              className={CLASSE_BOUTON_PRIMAIRE}
            >
              {/* Libellé d'attente, comme les deux autres écritures de ce
                  fichier (défaut connu corrigé le 28/09/2026). */}
              {envoiEnCours
                ? 'Enregistrement…'
                : destructionConfirmee
                  ? 'Confirmer la destruction'
                  : 'Appliquer le statut'}
            </button>
          </div>
        </div>
      )}

      {/* ─── Réception d'origine, et son annulation (D-087) ─────────────── */}
      {etatReception.statut === 'erreur' && (
        <div className="border-b border-line px-4 py-2">
          <MessageErreur
            message={`Réception d'origine illisible : ${etatReception.message} L'annulation de la réception n'est donc pas proposée.`}
          />
        </div>
      )}

      {etatReception.statut === 'pret' && (
        <BlocAnnulation
          titre="Réception d'origine"
          identite={
            <>
              {'Réception '}
              <span className="font-mono text-xs text-ink">
                {etatReception.lot.receptionNumero}
              </span>
              {' du '}
              {formaterDate(etatReception.lot.dateReception)}
              {' — '}
              {etatReception.lot.receptionNbLots}
              {etatReception.lot.receptionNbLots > 1 ? ' lots créés.' : ' lot créé.'}
            </>
          }
          blocage={blocageAnnulationReception({
            receptionStatut: etatReception.lot.receptionStatut,
          })}
          ouvert={annulationOuverte}
          onOuvrir={ouvrirAnnulationReception}
          onFermer={fermerAnnulationReception}
          libelleOuverture="Annuler la réception…"
          phraseAvant={phraseAvantAnnulationReception({
            numero: etatReception.lot.receptionNumero,
            dateReception: etatReception.lot.dateReception,
            nbLots: etatReception.lot.receptionNbLots,
            depuisUnLot: true,
          })}
          libelleConfirmation="Annuler la réception"
          nomChampMotif="motifAnnulationReception"
          motif={motifAnnulation}
          onMotifChange={setMotifAnnulation}
          erreurs={erreursAnnulation}
          enCours={envoiEnCours}
          onConfirmer={annulerLaReception}
          refOuvrir={boutonOuvrirAnnulationRef}
          refConfirmer={boutonConfirmerAnnulationRef}
        />
      )}

      {/* ─── Historique des mouvements ──────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <h3 className="text-2xs uppercase text-ink-3">Mouvements de ce lot</h3>
        {etatMouvements.statut === 'pret' && etatMouvements.nbAnnules > 0 && (
          <p className="text-xs text-ink-3">
            {etatMouvements.nbAnnules} écriture{etatMouvements.nbAnnules > 1 ? 's' : ''} annulée
            {etatMouvements.nbAnnules > 1 ? 's' : ''} — barrée
            {etatMouvements.nbAnnules > 1 ? 's' : ''}, jamais effacée
            {etatMouvements.nbAnnules > 1 ? 's' : ''}.
          </p>
        )}
      </div>

      {etatMouvements.statut === 'chargement' && (
        <p className="px-4 py-2 text-sm text-ink-3">Chargement des mouvements…</p>
      )}

      {etatMouvements.statut === 'erreur' && (
        <div className="px-4 py-2">
          <MessageErreur message={etatMouvements.message} />
        </div>
      )}

      {etatMouvements.statut === 'pret' && mouvements.length === 0 && (
        <p className="px-4 py-2 text-sm text-ink-3">
          Aucun mouvement enregistré sur ce lot. Même sa réception d'origine est absente : c'est une
          incohérence à signaler.
        </p>
      )}

      {etatMouvements.statut === 'pret' && mouvements.length > 0 && (
        <table>
          <colgroup>
            <col style={{ width: '12%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Nature</th>
              <th scope="col" className="num">
                Quantité
              </th>
              <th scope="col">Motif</th>
              <th scope="col" className="num">
                Coût (€)
              </th>
              <th scope="col">Correction</th>
            </tr>
          </thead>
          <tbody>
            {mouvements.map((mouvement) => (
              <tr
                key={mouvement.id}
                // Cible de `cleMouvementAFocaliserApresContrepassation` (voir
                // l'effet sur `mouvementAFocaliser` plus haut).
                data-mouvement={mouvement.id}
                // LE point de cette vue : l'écriture annulée reste lisible et
                // se barre. Style déjà défini dans `index.css`.
                {...(mouvement.isAnnule ? { 'data-annule': 'true' } : {})}
              >
                <td>{formaterDateTableau(mouvement.dateMouvement, anneeReference)}</td>
                <td className="truncate" title={LIBELLE_TYPE[mouvement.type]}>
                  {LIBELLE_TYPE[mouvement.type]}
                </td>
                <td className="num">
                  {SIGNE_TYPE[mouvement.type]}
                  {' '}
                  {formaterQuantite(mouvement.quantite, unite)}
                </td>
                {/* `repli` : un motif libre porte le POURQUOI, et un pourquoi
                    coupé en son milieu ne sert à rien. */}
                <td data-troncature="repli">
                  {mouvement.motifLibelle ?? mouvement.motifTexte ?? TIRET_ABSENT}
                  {mouvement.motifLibelle !== null && mouvement.motifTexte !== null && (
                    <span className="block text-xs text-ink-3">{mouvement.motifTexte}</span>
                  )}
                </td>
                <td className="num">{formaterMontant(mouvement.coutCents)}</td>
                <td>
                  {mouvement.isAnnule ? (
                    <span className="text-xs text-ink-3">Annulé</span>
                  ) : mouvement.estContrepassation ? (
                    <span className="text-xs text-ink-3">Contrepassation</span>
                  ) : mouvementACorriger === mouvement.id ? (
                    <button
                      type="button"
                      onClick={() => setMouvementACorriger(null)}
                      className={`text-xs ${CLASSE_BOUTON_LIEN}`}
                    >
                      Fermer
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => ouvrirCorrection(mouvement.id)}
                      className={`text-xs ${CLASSE_BOUTON_LIEN}`}
                    >
                      Corriger…
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Formulaire de contrepassation, SOUS le tableau et non dans une rangée :
          une rangée de 32 px ne peut pas porter une liste déroulante sans casser
          le rythme du tableau. Encore une fois, pas un <form>. */}
      {mouvementACorriger !== null &&
        (() => {
          const cible = mouvements.find((m) => m.id === mouvementACorriger);
          if (cible === undefined) return null;
          return (
            <div className="flex flex-col gap-groupe border-t border-line-strong px-4 py-3">
              <p className="text-xs text-ink-2">
                Contrepasser le mouvement du{' '}
                <span className="font-medium text-ink">{formaterDate(cible.dateMouvement)}</span> —{' '}
                <span className="num font-medium text-ink">
                  {SIGNE_TYPE[cible.type]}
                  {' '}
                  {formaterQuantite(cible.quantite, unite)}
                </span>{' '}
                de {nomIngredient}. Une écriture INVERSE sera ajoutée ; l'originale restera au
                journal, barrée. Elle ne pourra plus être contrepassée une seconde fois.
              </p>

              <div className="grid grid-cols-1 items-start gap-groupe lg:grid-cols-3">
                <ChampSelection
                  nom="motifCode"
                  libelle="Motif de la correction"
                  valeur={motifCorrection}
                  onChange={(valeur) => setMotifCorrection(valeur)}
                  options={optionsMotifCorrection}
                  optionVide="Choisir…"
                  obligatoire
                  erreur={erreursCorrection.champs['motifCode']}
                  aide="Il répondra plus tard à « pourquoi ce chiffre a-t-il bougé ? »."
                />
              </div>

              {erreursCorrection.general !== null && (
                <MessageErreur message={erreursCorrection.general} />
              )}

              <div className="flex items-center justify-end gap-groupe">
                <button
                  type="button"
                  onClick={() => setMouvementACorriger(null)}
                  className={CLASSE_BOUTON_SECONDAIRE}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => contrepasser(cible)}
                  disabled={envoiEnCours}
                  className={CLASSE_BOUTON_PRIMAIRE}
                >
                  {envoiEnCours ? 'Enregistrement…' : 'Contrepasser ce mouvement'}
                </button>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
