import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formaterDate,
  formaterMontant,
  formaterQuantite,
  ouTiret,
  schemaCommandeDetail,
  schemaListeCommandes,
  schemaResultatEnvoiCommande,
  schemaResultatGeneration,
  type CommandeDetail,
  type CommandeResume,
  type IngredientIgnore,
  type LigneCommandeContrat,
  type Statut,
  type StatutCommande,
} from '@batte/core';
import { BoutonDocument } from '../composants/BoutonDocument';
import { PastilleStatut } from '../composants/affichage';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi, type ChampsEnErreur } from '../lib/api';
import { compteAccorde } from './pluriel';

/**
 * Ecran Achats (docs/01 module 2 ; Lot 7). Trois etapes DISTINCTES imposees par
 * D-009 (docs/05-DECISIONS.md) : generer, valider, envoyer. Aucune ne permet de
 * sauter de `brouillon` a `envoyee` — la garantie vient de l'API
 * (`apps/api/src/routes/commandes.ts` refuse toute transition hors ordre), cet
 * ecran se contente de ne JAMAIS proposer un bouton qui tenterait le saut.
 *
 * Regle d'architecture n°1 (CLAUDE.md §3) : ce composant n'effectue AUCUN
 * calcul metier. Le point de commande, les quantites a commander, le montant
 * de chaque ligne viennent tels quels de l'API. Le tri et le mappage
 * statut -> glyphe sont de la presentation (docs/07 §4.5), meme principe que
 * `statutLigne` dans `Stock.tsx`.
 *
 * Mise en page : panneau d'action « Generer » en haut (meme gabarit que le
 * « Nouvel ordre de production » de `Production.tsx`), puis liste des
 * commandes + detail docked a droite, exactement le patron de `Stock.tsx`
 * (liste a gauche, detail contextuel a droite, ni modale ni page).
 */

type EtatCommandesEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; commandes: CommandeResume[]; total: number };

type EtatDetailEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; detail: CommandeDetail };

/**
 * `succes` reste affiche jusqu'a la prochaine generation : ce n'est pas une
 * simple confirmation transitoire, mais un RESULTAT a examiner — la liste des
 * ingredients ignores est l'information la plus importante de tout l'ecran
 * (« un ingredient ecarte en silence est un futur rupture de stock »).
 */
type EtatGeneration =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'succes'; nbCommandes: number; ingredientsIgnores: IngredientIgnore[] }
  | { statut: 'erreur'; message: string };

/** Machine a etats simple pour la validation, transitoire (succes 5 s, docs/07 §4.7). */
type EtatEcriture =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'succes'; message: string }
  | { statut: 'erreur'; message: string };

/** Meme machine, avec les champs en erreur (l'email manquant se signale SOUS le champ). */
type EtatEnvoi =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'succes'; message: string }
  | { statut: 'erreur'; message: string; champs?: ChampsEnErreur };

const LIBELLE_STATUT_COMMANDE: Readonly<Record<StatutCommande, string>> = {
  brouillon: 'Brouillon',
  validee: 'Validée',
  envoyee: 'Envoyée',
  recue: 'Reçue',
  annulee: 'Annulée',
};

/**
 * Message affiché en PERMANENCE sous une commande `envoyee` / `recue` /
 * `annulee` (défaut du rejeu de parcours du 31/07/2026, docs/27 §3.a puis
 * docs/33, l'unique « impasse silencieuse » relevée sur ce parcours).
 *
 * Avant ce correctif, ce texte disait toujours « Envoyée à X le date. »,
 * qu'il s'agisse d'un envoi RÉEL ou d'un simple mode test (`MAIL_MODE_TEST`,
 * `apps/api/src/mail.ts`) : le mode n'était connu que le temps de la réponse
 * HTTP de l'envoi, jamais persisté — le rouvrir après un rechargement de
 * page (ou dans une session ultérieure) affichait un texte qui se lisait
 * exactement comme un envoi réel.
 *
 * DÉSORMAIS, `envoiModeTest`/`cheminFichierTest` viennent directement de
 * `GET /commandes/:id` (`packages/core/src/contrats/commandes.ts`,
 * `schemaCommandeDetail`) : ce fait est lu dans le journal d'audit côté
 * serveur (`packages/db/src/services/commandes.ts::envoiModeTestConnu`),
 * donc IDENTIQUE juste après l'envoi et après un rechargement complet de la
 * page. Il ne s'agit plus d'une mémoire locale à cet écran.
 *
 * `envoiModeTest` peut valoir `null` : commande envoyée AVANT ce correctif,
 * dont le journal d'audit ne porte donc pas encore ce fait. `null` n'est
 * PAS « envoi réel » (CLAUDE.md, doctrine « une valeur inconnue vaut `null`,
 * jamais `false` ») : ce cas se lit donc avec un texte qui dit explicitement
 * l'incertitude, plutôt que d'affirmer à tort un envoi réel.
 */
export function messageEnvoiCommande(
  commande: {
    readonly emailEnvoyeA: string | null;
    readonly dateEnvoi: string | null;
    readonly envoiModeTest: boolean | null;
    readonly cheminFichierTest: string | null;
  },
  formaterDateFn: (d: string) => string,
): string {
  if (commande.emailEnvoyeA === null) return 'Aucun envoi enregistré.';

  const dateSuffixe =
    commande.dateEnvoi !== null ? ` le ${formaterDateFn(commande.dateEnvoi)}` : '';

  if (commande.envoiModeTest === true) {
    return (
      `Mode test — rien n'a été envoyé au fournisseur. Le mail a été écrit dans ` +
      `${commande.cheminFichierTest ?? 'un fichier local'} ` +
      `(destinataire visé : ${commande.emailEnvoyeA}${dateSuffixe}).`
    );
  }

  if (commande.envoiModeTest === false) {
    return `Envoyée à ${commande.emailEnvoyeA}${dateSuffixe}.`;
  }

  // `null` : fait INCONNU (commande envoyée avant l'ajout de cette trace au
  // journal d'audit). Ni « mode test » ni « envoyée » ne peuvent être
  // affirmés sans mentir dans un des deux cas — le texte dit l'incertitude
  // elle-même, seule affirmation vraie dont on dispose ici.
  return (
    `Envoyée à ${commande.emailEnvoyeA}${dateSuffixe} — mode d'envoi non retrouvé ` +
    `(réel ou test) pour cette commande, probablement envoyée avant le suivi de ce fait.`
  );
}

/**
 * Ramene les cinq statuts a l'echelle a trois etats du produit : `brouillon`
 * et `validee` attendent une action de l'utilisateur (valider, puis envoyer)
 * donc se lisent comme une alerte ; `envoyee` et `recue` sont conformes,
 * l'affaire est close ; `annulee` — ecriture d'annulation, jamais une
 * suppression (docs/07 §1.4) — se lit comme un depassement. Simple mappage
 * fixe, aucun calcul (meme principe que `statutAffichageProduction` de
 * `Production.tsx`).
 */
function statutAffichageCommande(statut: StatutCommande): Statut {
  switch (statut) {
    case 'brouillon':
    case 'validee':
      return 'alerte';
    case 'envoyee':
    case 'recue':
      return 'conforme';
    case 'annulee':
      return 'depassement';
  }
}

/**
 * Tri par urgence, jamais alphabetique (docs/07 §4.5) : les commandes qui
 * attendent une action (`brouillon`, `validee`) d'abord, puis les cloturees.
 * A rang egal, la plus recente d'abord — meme logique que l'historique de
 * `Production.tsx`.
 */
const RANG_STATUT_COMMANDE: Readonly<Record<StatutCommande, number>> = {
  brouillon: 0,
  validee: 1,
  envoyee: 2,
  recue: 3,
  annulee: 4,
};

function comparerCommandes(a: CommandeResume, b: CommandeResume): number {
  const rangA = RANG_STATUT_COMMANDE[a.statut];
  const rangB = RANG_STATUT_COMMANDE[b.statut];
  if (rangA !== rangB) return rangA - rangB;
  const parDate = b.dateCreation.localeCompare(a.dateCreation);
  return parDate !== 0 ? parDate : b.id.localeCompare(a.id);
}

/**
 * En-têtes abrégés sur SIX des huit colonnes (`numero`, `creation`, `envoi`,
 * `montant`, `lignes`, `reception`), avec `libelleLong` pour le mot entier en
 * infobulle — décision du 31/07/2026 (docs/05-DECISIONS.md D-081, complément
 * « la liste des commandes quand le détail s'ouvre »).
 *
 * Mesuré à 1280 px effectifs, panneau de détail ouvert : ce tableau tombe à
 * 574 px (huit colonnes). Les VALEURS sont déjà protégées (`repli` sur les
 * identifiants, largeur mesurée sur les nombres) — c'est l'EN-TÊTE lui-même
 * qui débordait : « Numéro » (77 px requis pour 75 px alloués), « Créée le »
 * (71 pour 63), « Envoyée le » (88 pour 69), « Montant (€) » (98 pour 63, le
 * pire des six), « Lignes » (62 pour 46), « Réception » (88 pour 86).
 *
 * Élargir chaque colonne d'autant aurait fallu reprendre la largeur sur les
 * colonnes protégées (identifiants, nombres) — recréant ailleurs exactement le
 * défaut qu'on corrige ici. La bonne réponse, documentée dans
 * `Tableau.tsx` (doc du champ `libelleLong`) et déjà appliquée ailleurs dans
 * le produit : « une abréviation CHOISIE bat une troncature CSS qui dépend de
 * la largeur du navigateur ». `libelleLong` porte le mot entier, affiché en
 * infobulle sur l'en-tête — jamais utilisé à la place de `libelle` dans le
 * `<th>` lui-même.
 */
const COLONNES_COMMANDES: ReadonlyArray<ColonneTableau<CommandeResume>> = [
  {
    cle: 'numero',
    libelle: 'N°',
    libelleLong: 'Numéro',
    largeur: '13%',
    alignement: 'texte',
    // `repli` : c'est la colonne IDENTIFIANTE (« CF-2026-0001 ») — elle ne se
    // tronque jamais (docs/07 §4.5, audit visuel du 31/07/2026 : elle se
    // coupait en « CF-2026… »).
    troncature: 'repli',
    rendu: (c) => <span className="font-mono text-xs">{c.numero}</span>,
    titre: (c) => c.numero,
  },
  {
    cle: 'fournisseur',
    libelle: 'Fournisseur',
    largeur: '18%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (c) => c.fournisseurNom,
    titre: (c) => c.fournisseurNom,
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    largeur: '12%',
    alignement: 'texte',
    // `repli` : quand le panneau de détail est ouvert, cette liste se réduit à
    // ~586 px (mesuré à 1280 px effectifs, panneau détail docké à droite) et
    // « Brouillon » se coupait (« ▲Brouil… ») — un statut tronqué se lit comme
    // un autre statut, ce que docs/07 §3.5 interdit autant qu'un chiffre coupé.
    troncature: 'repli',
    rendu: (c) => (
      <PastilleStatut
        statut={statutAffichageCommande(c.statut)}
        libelle={LIBELLE_STATUT_COMMANDE[c.statut]}
      />
    ),
  },
  {
    cle: 'creation',
    libelle: 'Créée',
    libelleLong: 'Créée le',
    largeur: '11%',
    alignement: 'texte',
    // `repli` : même mesure, « 31/07/2026 » se coupait une fois le panneau de
    // détail ouvert — une date est un identifiant qualitatif (docs/07 §4.5),
    // jamais à l'ellipse.
    troncature: 'repli',
    rendu: (c) => formaterDate(c.dateCreation),
  },
  {
    cle: 'envoi',
    libelle: 'Envoy.',
    libelleLong: 'Envoyée le',
    largeur: '12%',
    alignement: 'texte',
    // `repli` : même raison que `creation` — une date envoyée réelle a la même
    // largeur qu'une date de création et se coupait dans le même scénario.
    troncature: 'repli',
    rendu: (c) => ouTiret(c.dateEnvoi, (d) => formaterDate(d)),
  },
  {
    cle: 'montant',
    libelle: '€',
    libelleLong: 'Montant (€)',
    largeur: '11%',
    alignement: 'nombre',
    rendu: (c) => formaterMontant(c.montantTotalCents),
  },
  {
    cle: 'lignes',
    libelle: 'Lgn',
    libelleLong: 'Lignes',
    // 8 % et non 6 : en dessous, l'en-tete « LIGNES » deborde de sa colonne.
    largeur: '8%',
    alignement: 'nombre',
    rendu: (c) => String(c.nbLignes),
  },
  {
    cle: 'reception',
    libelle: 'Récept.',
    libelleLong: 'Réception',
    largeur: '15%',
    alignement: 'texte',
    // `repli` : le numéro de réception est un identifiant au même titre que
    // le numéro de commande ci-dessus — jamais tronqué.
    troncature: 'repli',
    /**
     * Referme la boucle d'achat dans le sens commande -> réception (audit du
     * 30/07/2026, `reception.commandeId` écrite jamais relue avant ce
     * correctif — voir `receptionsRecentesParCommande`, `services/commandes.ts`).
     *
     * NEUTRE, pas rouge (revu le 31/07/2026) : annuler une réception est une
     * écriture de correction normale (CLAUDE.md §3 règle 7 ; docs/07 §1.4),
     * jamais une faute — même lecture que `BadgeReceptionAnnulee`
     * (`RegistreAfsca.tsx`). `annulerReception` (`services/reception.ts`)
     * restaure d'ailleurs le statut antérieur de la commande dès qu'il peut
     * être retrouvé avec certitude dans le journal d'audit : une réception
     * annulée ici ne signale donc PAS forcément une commande en incohérence.
     * Le cas où l'incohérence est réelle et non corrigée — une commande
     * encore affichée « reçue » sans la moindre réception active pour la
     * justifier — a sa PROPRE alerte dédiée, plus bas dans le détail
     * (`role="alert"`, texte explicite) : doubler ce signal ici referait la
     * même confusion que colorer chaque annulation en rouge.
     */
    rendu: (c) =>
      c.receptionNumero === null ? (
        <span className="text-ink-3">—</span>
      ) : (
        <span className={c.receptionStatut === 'annulee' ? 'text-ink-3' : undefined}>
          {c.receptionNumero}
          {c.receptionStatut === 'annulee' ? ' (annulée)' : ''}
        </span>
      ),
    titre: (c) =>
      c.receptionNumero === null
        ? '—'
        : `${c.receptionNumero}${c.receptionStatut === 'annulee' ? ' (annulée)' : ''}`,
  },
];

/**
 * Largeurs revues le 31/07/2026 : la somme faisait déjà 100 (32+26+12+14+16),
 * mais ce tableau vit dans le panneau de DÉTAIL, fixé à 26,25 rem (~420 px à
 * 1280 px effectifs) — mesuré avec `table-layout: auto` sur cette même
 * instance, la somme des besoins réels (100+154+44+79+102 ≈ 479 px) dépasse
 * ce qu'il y a de disponible. `Ingrédient` et `Conditionnement` portent déjà
 * `troncature: 'repli'` : leur VALEUR ne se perd jamais, seulement plus de
 * lignes si le nom est long. La place a donc été reprise sur ces deux
 * colonnes (qui absorbent le retrait en s'enroulant) pour donner sa pleine
 * largeur à `Montant (€)`, la seule colonne numérique du tableau.
 */
const COLONNES_LIGNES: ReadonlyArray<ColonneTableau<LigneCommandeContrat>> = [
  {
    cle: 'ingredient',
    libelle: 'Ingrédient',
    largeur: '19%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) => l.nomIngredient,
    titre: (l) => l.nomIngredient,
  },
  {
    cle: 'conditionnement',
    libelle: 'Conditionnement',
    largeur: '20%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) => ouTiret(l.conditionnementLibelle, (v) => v),
    titre: (l) => ouTiret(l.conditionnementLibelle, (v) => v),
  },
  {
    cle: 'quantiteConditionnements',
    libelle: 'Qté',
    largeur: '12%',
    alignement: 'nombre',
    rendu: (l) => String(l.quantiteConditionnements),
  },
  {
    cle: 'quantiteUniteRef',
    libelle: 'Quantité',
    largeur: '21%',
    alignement: 'nombre',
    rendu: (l) => formaterQuantite(l.quantiteUniteRef, l.unite),
  },
  {
    cle: 'montant',
    libelle: 'Montant (€)',
    largeur: '28%',
    alignement: 'nombre',
    rendu: (l) => formaterMontant(l.montantLigneCents),
  },
];

const COLONNES_IGNORES: ReadonlyArray<ColonneTableau<IngredientIgnore>> = [
  {
    cle: 'ingredient',
    libelle: 'Ingrédient',
    largeur: '35%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (i) => i.nomIngredient,
    titre: (i) => i.nomIngredient,
  },
  {
    cle: 'motif',
    libelle: 'Motif',
    largeur: '65%',
    alignement: 'texte',
    rendu: (i) => i.motif,
    titre: (i) => i.motif,
  },
];

const CLASSE_BOUTON_PRIMAIRE =
  'flex h-controle items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

/** Action secondaire (annuler) : jamais la couleur d'accent, réservée à l'étape
 * attendue du parcours D-009 — même principe que `Ingredients.tsx`. */
const CLASSE_BOUTON_SECONDAIRE =
  'flex h-controle items-center justify-center rounded-sm border border-line-field bg-surface px-3 text-sm font-medium text-ink-2 hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-60';

export default function Achats() {
  const [etatCommandes, setEtatCommandes] = useState<EtatCommandesEcran>({ statut: 'chargement' });
  const [commandeSelectionneeId, setCommandeSelectionneeId] = useState<string | null>(null);
  const [etatDetail, setEtatDetail] = useState<EtatDetailEcran | null>(null);
  const [etatGeneration, setEtatGeneration] = useState<EtatGeneration>({ statut: 'inactif' });
  const [etatValidation, setEtatValidation] = useState<EtatEcriture>({ statut: 'inactif' });
  const [emailSaisi, setEmailSaisi] = useState<string>('');
  const [etatEnvoi, setEtatEnvoi] = useState<EtatEnvoi>({ statut: 'inactif' });
  /**
   * Annulation (audit du 29/07/2026) : `annulee` existait dans l'énumération de
   * statut et dans `LIBELLE_STATUT_COMMANDE` sans qu'aucun geste de cet écran
   * n'y mène jamais — un brouillon abandonné restait donc compté indéfiniment
   * dans le stock projeté (voir `services/commandes.ts::annulerCommande`).
   */
  const [annulationOuverte, setAnnulationOuverte] = useState(false);
  const [motifAnnulationSaisi, setMotifAnnulationSaisi] = useState('');
  const [etatAnnulation, setEtatAnnulation] = useState<EtatEcriture>({ statut: 'inactif' });
  const boutonAnnulerCommande = useRef<HTMLButtonElement>(null);
  const champMotifAnnulation = useRef<HTMLInputElement>(null);
  const boutonFermerDetail = useRef<HTMLButtonElement>(null);
  /**
   * Conteneur du TABLEAU des commandes — jamais démonté quand le panneau de
   * détail se ferme, contrairement au panneau lui-même. C'est de là qu'on
   * retrouve la rangée qui avait ouvert le détail, et c'est le repli de dernier
   * recours si elle ne s'y trouve plus (voir `fermerDetailCommande`).
   *
   * ═══ CE QUE CETTE `ref` REMPLACE, ET LA PRÉMISSE FAUSSE QU'ELLE CORRIGE ═══
   *
   * Les deux fermetures visaient auparavant le bouton « Générer les
   * commandes », au motif écrit qu'une ligne de tableau « n'expose aucune ref
   * de rangée à réutiliser ». C'est faux : aucune `ref` de rangée n'est
   * nécessaire — `Tableau.tsx` pose `aria-selected="true"` sur la rangée
   * sélectionnée, et il suffit de l'interroger AVANT l'écriture d'état. C'est
   * le remède déjà tenu par `fermerDetailIngredient` (`Stock.tsx`),
   * `fermerDetailProduction` (`Production.tsx`) et `fermerDetail`
   * (`JournalAudit.tsx`).
   *
   * La cible d'avant était fautive DEUX FOIS. Elle téléportait d'abord le focus
   * en haut de page, dans un AUTRE panneau : c'est le repli « première rangée »
   * que `choisirRangeeDeRepli` (`composants/navigationGrille.ts`) écarte
   * explicitement — après la 30ᵉ ligne d'une liste de 40, on repart en haut, le
   * même abandon que `<body>` en moins visible. Et surtout, pendant une
   * génération en vol ce bouton est `disabled` : `.focus()` y est alors
   * INOPÉRANT et le focus tombe bel et bien sur `<body>`.
   */
  const conteneurTableauCommandes = useRef<HTMLDivElement>(null);

  // Rechargement de la liste, reutilise apres generation/validation/envoi —
  // meme patron que `charger` dans `ProchaineSession.tsx`.
  const chargerCommandes = useCallback(() => {
    requeteApi<unknown>('/commandes')
      .then((reponse) => {
        const liste = schemaListeCommandes.parse(reponse);
        setEtatCommandes({ statut: 'pret', commandes: liste.data, total: liste.meta.total });
      })
      .catch((erreur: unknown) => {
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatCommandes({ statut: 'erreur', message });
      });
  }, []);

  useEffect(() => {
    chargerCommandes();
  }, [chargerCommandes]);

  // Detail de la commande selectionnee, meme patron que `Stock.tsx`.
  useEffect(() => {
    if (commandeSelectionneeId === null) {
      setEtatDetail(null);
      return;
    }

    let annule = false;
    setEtatDetail({ statut: 'chargement' });

    requeteApi<unknown>(`/commandes/${commandeSelectionneeId}`)
      .then((reponse) => {
        const detail = schemaCommandeDetail.parse(reponse);
        if (annule) return;
        setEtatDetail({ statut: 'pret', detail });
        setEmailSaisi(detail.fournisseurEmail ?? '');
        setEtatValidation({ statut: 'inactif' });
        setEtatEnvoi({ statut: 'inactif' });
        setAnnulationOuverte(false);
        setMotifAnnulationSaisi('');
        setEtatAnnulation({ statut: 'inactif' });
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
  }, [commandeSelectionneeId]);

  /**
   * FERME le panneau de détail de la commande — bouton « Fermer » ou branche
   * FINALE d'Échap — en rendant le focus à la rangée du tableau qui l'avait
   * ouvert, jamais à `<body>` ni à un bouton d'un autre panneau.
   *
   * La rangée est capturée AVANT l'écriture d'état, tant que `aria-selected` la
   * désigne encore. `Tableau` réutilise le même nœud DOM d'un rendu à l'autre
   * (clé React stable sur `c.id`) et seul le panneau de détail se démonte : le
   * nœud capturé est donc toujours valide au moment où on lui rend le focus. Il
   * reste focalisable même s'il a perdu `tabIndex={0}` au profit d'une autre
   * rangée — `Tableau` pose `tabIndex={-1}` sur toutes les autres, ce qui les
   * laisse atteignables PROGRAMMATIQUEMENT.
   *
   * `requestAnimationFrame` et non un `.focus()` immédiat : la cible doit
   * d'abord avoir survécu au rendu déclenché par `setCommandeSelectionneeId`.
   * Aucune des deux fermetures ne l'avait, ce qui rendait leur `.focus()`
   * tributaire de l'état d'un bouton lointain.
   *
   * La recherche est PORTÉE au conteneur du tableau des commandes plutôt que
   * globale. Aucune autre grille de cet écran ne porte aujourd'hui
   * `aria-selected` — `Tableau` ne pose l'attribut que si `onSelectionnerLigne`
   * lui est fourni, ce qui n'est le cas ni pour les ingrédients ignorés ni pour
   * les lignes de la commande — mais un `document.querySelector` global
   * rendrait la bonne rangée par simple hasard d'ordre du document, et se
   * mettrait à mentir le jour où l'une de ces deux grilles deviendrait
   * sélectionnable (même raison que `conteneurTableauStock` dans `Stock.tsx`).
   *
   * `useCallback([])` : référence STABLE d'un rendu à l'autre — seuls des `ref`
   * (jamais réactifs) et un `setState` (stable par construction React) sont lus
   * à l'intérieur. C'est ce qui permet à l'effet Échap ci-dessous de la lister
   * en dépendance sans se réabonner à chaque rendu.
   */
  const fermerDetailCommande = useCallback((): void => {
    const conteneur = conteneurTableauCommandes.current;
    const rangeeCourante =
      conteneur?.querySelector<HTMLElement>('tr[aria-selected="true"]') ?? null;
    setCommandeSelectionneeId(null);
    requestAnimationFrame(() => {
      if (rangeeCourante !== null) rangeeCourante.focus();
      else conteneur?.focus();
    });
  }, []);

  // « Échap ferme » (docs/07 §4.6), identique a `Stock.tsx` et `Production.tsx`.
  // Une seule couche a la fois, la plus profonde d'abord : l'annulation en
  // cours de saisie se referme avant le detail complet, meme principe que
  // `Stock.tsx` (lot -> sortie -> ingredient).
  useEffect(() => {
    if (commandeSelectionneeId === null) return;

    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key !== 'Escape') return;
      if (annulationOuverte) {
        setAnnulationOuverte(false);
        setMotifAnnulationSaisi('');
        requestAnimationFrame(() => boutonAnnulerCommande.current?.focus());
        return;
      }
      // Rend le focus a la rangee du tableau, jamais a `<body>` — voir
      // `fermerDetailCommande` ci-dessus.
      fermerDetailCommande();
    }

    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [commandeSelectionneeId, annulationOuverte, fermerDetailCommande]);

  // Motif du meme motif focus-entrant/focus-restaure que `Economies.tsx` :
  // le bouton « Annuler cette commande » disparait au profit du formulaire,
  // le focus doit donc y entrer explicitement plutot que de retomber sur
  // `<body>`.
  useEffect(() => {
    if (annulationOuverte) champMotifAnnulation.current?.focus();
  }, [annulationOuverte]);

  useEffect(() => {
    if (etatValidation.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatValidation({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatValidation]);

  useEffect(() => {
    if (etatEnvoi.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatEnvoi({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatEnvoi]);

  useEffect(() => {
    if (etatAnnulation.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatAnnulation({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatAnnulation]);

  /**
   * Etape 1/3 (D-009) : GENERER. N'envoie rien, ne valide rien — cree des
   * brouillons et rend visibles les ingredients qu'elle n'a pas pu commander.
   */
  async function genererCommandes(): Promise<void> {
    if (etatGeneration.statut === 'en_cours') return;
    setEtatGeneration({ statut: 'en_cours' });
    try {
      const reponse = await requeteApi<unknown>('/commandes/generer', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const resultat = schemaResultatGeneration.parse(reponse);
      setEtatGeneration({
        statut: 'succes',
        nbCommandes: resultat.data.length,
        ingredientsIgnores: resultat.meta.ingredientsIgnores,
      });
      chargerCommandes();
    } catch (erreur) {
      setEtatGeneration({
        statut: 'erreur',
        message:
          erreur instanceof ErreurApi ? erreur.message : 'La génération des commandes a échoué.',
      });
    }
  }

  /** Etape 2/3 (D-009) : VALIDER — validation humaine explicite d'un brouillon. */
  async function validerCommandeSelectionnee(): Promise<void> {
    if (etatDetail === null || etatDetail.statut !== 'pret') return;
    const detail = etatDetail.detail;
    if (detail.statut !== 'brouillon' || etatValidation.statut === 'en_cours') return;

    setEtatValidation({ statut: 'en_cours' });
    try {
      const reponse = await requeteApi<unknown>(`/commandes/${detail.id}/valider`, {
        method: 'POST',
      });
      const detailMisAJour = schemaCommandeDetail.parse(reponse);
      setEtatDetail({ statut: 'pret', detail: detailMisAJour });
      setEtatCommandes((precedent) =>
        precedent.statut === 'pret'
          ? {
              statut: 'pret',
              commandes: precedent.commandes.map((c) =>
                c.id === detailMisAJour.id ? { ...c, statut: detailMisAJour.statut } : c,
              ),
              total: precedent.total,
            }
          : precedent,
      );
      setEtatValidation({
        statut: 'succes',
        message: `Commande ${detailMisAJour.numero} validée.`,
      });
      // Le bouton « Valider » vient de disparaître avec son bloc (la commande
      // n'est plus un brouillon) : le focus retomberait sur `<body>` au milieu
      // du parcours en 3 étapes de D-009. On le porte sur l'étape suivante,
      // qui est précisément le champ que le bloc d'envoi vient d'afficher.
      // `requestAnimationFrame` : le champ n'existe pas encore au moment de
      // l'appel, il naît du rendu déclenché par ce `setEtat…`.
      requestAnimationFrame(() => document.getElementById('achats-email')?.focus());
    } catch (erreur) {
      setEtatValidation({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'La validation a échoué.',
      });
    }
  }

  /**
   * Annule un brouillon ou une commande validée — jamais une commande déjà
   * envoyée ou reçue (l'API refuse ces deux cas ; le bouton n'est de toute
   * façon offert que pour les deux premiers statuts, voir le rendu plus bas).
   * Referme la boucle d'abandon : sans elle, une commande générée par erreur
   * ou devenue inutile restait comptée indéfiniment dans le stock projeté.
   */
  async function annulerCommandeSelectionnee(): Promise<void> {
    if (etatDetail === null || etatDetail.statut !== 'pret') return;
    const detail = etatDetail.detail;
    if (
      (detail.statut !== 'brouillon' && detail.statut !== 'validee') ||
      etatAnnulation.statut === 'en_cours'
    ) {
      return;
    }

    setEtatAnnulation({ statut: 'en_cours' });
    try {
      const motif = motifAnnulationSaisi.trim();
      const reponse = await requeteApi<unknown>(`/commandes/${detail.id}/annuler`, {
        method: 'POST',
        body: JSON.stringify(motif === '' ? {} : { motif }),
      });
      const detailMisAJour = schemaCommandeDetail.parse(reponse);
      setEtatDetail({ statut: 'pret', detail: detailMisAJour });
      setEtatCommandes((precedent) =>
        precedent.statut === 'pret'
          ? {
              statut: 'pret',
              commandes: precedent.commandes.map((c) =>
                c.id === detailMisAJour.id ? { ...c, statut: detailMisAJour.statut } : c,
              ),
              total: precedent.total,
            }
          : precedent,
      );
      setAnnulationOuverte(false);
      // Contrairement a « Renoncer », le succes fait DISPARAITRE
      // definitivement le bouton « Annuler cette commande » (la commande
      // n'est plus `brouillon`/`validee`) : y ramener le focus serait viser
      // un noeud qui va s'evanouir. On cible donc « Fermer », seul controle
      // du panneau qui survit a tous les statuts.
      requestAnimationFrame(() => boutonFermerDetail.current?.focus());
      setEtatAnnulation({
        statut: 'succes',
        message: `Commande ${detailMisAJour.numero} annulée.`,
      });
    } catch (erreur) {
      setEtatAnnulation({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : "L'annulation a échoué.",
      });
    }
  }

  /**
   * Etape 3/3 (D-009) : ENVOYER — la SEULE action qui declenche un envoi reel.
   * Refuse cote API toute commande qui n'est pas `validee` : ce bouton ne
   * s'affiche d'ailleurs jamais pour un autre statut (voir le rendu plus bas).
   */
  async function envoyerCommandeSelectionnee(): Promise<void> {
    if (etatDetail === null || etatDetail.statut !== 'pret') return;
    const detail = etatDetail.detail;
    const email = emailSaisi.trim();
    if (detail.statut !== 'validee' || etatEnvoi.statut === 'en_cours' || email === '') return;

    setEtatEnvoi({ statut: 'en_cours' });
    try {
      const reponse = await requeteApi<unknown>(`/commandes/${detail.id}/envoyer`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      const resultat = schemaResultatEnvoiCommande.parse(reponse);
      setEtatDetail({ statut: 'pret', detail: resultat });
      setEtatCommandes((precedent) =>
        precedent.statut === 'pret'
          ? {
              statut: 'pret',
              commandes: precedent.commandes.map((c) =>
                c.id === resultat.id
                  ? { ...c, statut: resultat.statut, dateEnvoi: resultat.dateEnvoi }
                  : c,
              ),
              total: precedent.total,
            }
          : precedent,
      );
      // Le bloc permanent plus bas (quand `detailCourant.statut` passe à
      // `envoyee`) lit `resultat.envoiModeTest`/`cheminFichierTest`
      // directement depuis `detailCourant` — aucune mémoire locale à
      // maintenir ici : ce fait est désormais PERSISTÉ côté serveur (journal
      // d'audit, voir `messageEnvoiCommande` ci-dessus) et identique qu'on le
      // lise à l'instant ou après un rechargement de page.
      setEtatEnvoi({
        statut: 'succes',
        message: resultat.envoiModeTest
          ? `Mode test : mail écrit dans ${resultat.cheminFichierTest ?? 'un fichier local'}, rien n'a été envoyé.`
          : `Commande ${resultat.numero} envoyée à ${email}.`,
      });
    } catch (erreur) {
      if (erreur instanceof ErreurApi) {
        setEtatEnvoi({
          statut: 'erreur',
          message: erreur.message,
          ...(erreur.champs !== undefined ? { champs: erreur.champs } : {}),
        });
      } else {
        setEtatEnvoi({ statut: 'erreur', message: "L'envoi a échoué." });
      }
    }
  }

  const commandesTriees: CommandeResume[] =
    etatCommandes.statut === 'pret' ? [...etatCommandes.commandes].sort(comparerCommandes) : [];

  const detailCourant =
    etatDetail !== null && etatDetail.statut === 'pret' ? etatDetail.detail : null;

  const erreurEmail =
    etatEnvoi.statut === 'erreur' && etatEnvoi.champs !== undefined
      ? etatEnvoi.champs.email
      : undefined;

  return (
    <div className="flex flex-col gap-bloc">
      <h1 className="flex h-rangee items-center text-lg text-ink">Achats</h1>

      <Panneau titre="Générer des commandes">
        <div className="flex flex-col gap-bloc">
          <div className="flex items-center gap-groupe">
            <button
              type="button"
              onClick={() => void genererCommandes()}
              disabled={etatGeneration.statut === 'en_cours'}
              className={`${CLASSE_BOUTON_PRIMAIRE} w-56`}
            >
              {etatGeneration.statut === 'en_cours' ? 'Génération…' : 'Générer les commandes'}
            </button>
            {etatGeneration.statut === 'succes' && (
              <p role="status" className="text-sm text-conforme">
                {etatGeneration.nbCommandes === 0
                  ? 'Aucun ingrédient sous le point de commande : aucun brouillon généré.'
                  : `${etatGeneration.nbCommandes} ${etatGeneration.nbCommandes > 1 ? 'brouillons générés' : 'brouillon généré'}.`}
              </p>
            )}
          </div>

          {etatGeneration.statut === 'erreur' && <MessageErreur message={etatGeneration.message} />}

          {etatGeneration.statut === 'succes' && (
            <div className="border-t border-line pt-3">
              <h3 className="text-2xs uppercase text-ink-3">Ingrédients ignorés</h3>
              <p className="mt-1 text-xs text-ink-3">
                Un ingrédient ignoré n'est pas commandé : vérifiez-le pour éviter une rupture.
              </p>
              <div className="mt-groupe">
                <Tableau
                  colonnes={COLONNES_IGNORES}
                  lignes={etatGeneration.ingredientsIgnores}
                  cleLigne={(i) => i.ingredientId}
                  etatVide={<EtatVide variante="normal" texte="Aucun ingrédient ignoré." />}
                />
              </div>
            </div>
          )}
        </div>
      </Panneau>

      {etatCommandes.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Chargement des commandes…</p>
      )}

      {etatCommandes.statut === 'erreur' && <MessageErreur message={etatCommandes.message} />}

      {etatCommandes.statut === 'pret' && (
        <div className="flex flex-col items-start gap-bloc lg:flex-row">
          {/* `ref` + `tabIndex={-1}` : repli de focus de `fermerDetailCommande`
              quand la rangée précédemment sélectionnée n'est, pour une raison
              quelconque, pas retrouvée — programmatique uniquement, jamais dans
              l'ordre de tabulation normal. */}
          <div
            ref={conteneurTableauCommandes}
            tabIndex={-1}
            className="min-w-0 flex-1 self-stretch"
          >
            <Panneau
              titre={compteAccorde(etatCommandes.total, 'commande', 'commandes')}
              sansRembourrage
            >
              <Tableau
                colonnes={COLONNES_COMMANDES}
                lignes={commandesTriees}
                cleLigne={(c) => c.id}
                {...(commandeSelectionneeId !== null
                  ? { ligneSelectionneeCle: commandeSelectionneeId }
                  : {})}
                onSelectionnerLigne={(c) =>
                  setCommandeSelectionneeId((precedent) => (precedent === c.id ? null : c.id))
                }
                etatVide={
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucune commande enregistrée"
                    explication="Générez un premier brouillon à partir des ingrédients sous le point de commande."
                    action={{
                      libelle: 'Générer les commandes',
                      onClick: () => void genererCommandes(),
                    }}
                  />
                }
              />
            </Panneau>
          </div>

          {detailCourant !== null && (
            <div className="w-full lg:w-[26.25rem] lg:shrink-0">
              <Panneau titre={detailCourant.numero} sansRembourrage>
                <div className="flex items-center justify-between border-b border-line px-4 py-2">
                  <div>
                    <p className="text-sm font-medium text-ink">{detailCourant.fournisseurNom}</p>
                    <p className="text-xs text-ink-3">
                      Créée le {formaterDate(detailCourant.dateCreation)}
                      {detailCourant.dateEnvoi !== null
                        ? ` · Envoyée le ${formaterDate(detailCourant.dateEnvoi)}`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    ref={boutonFermerDetail}
                    onClick={fermerDetailCommande}
                    className="text-xs font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Fermer
                  </button>
                </div>

                <div className="border-b border-line px-4 py-2">
                  <PastilleStatut
                    statut={statutAffichageCommande(detailCourant.statut)}
                    libelle={LIBELLE_STATUT_COMMANDE[detailCourant.statut]}
                  />
                </div>

                {/*
                  Boucle d'achat, sens commande -> réception (audit du
                  30/07/2026) : `reception.commandeId` était écrite à la
                  réception mais jamais relue depuis la table — seule sa
                  valeur d'ENTRÉE servait, pour solder la commande au moment
                  même de l'écriture.

                  Chaque réception listée ici garde son statut en TEXTE
                  NEUTRE (revu le 31/07/2026), même lecture que
                  `BadgeReceptionAnnulee` (`RegistreAfsca.tsx`) : annuler une
                  réception est une écriture de correction normale
                  (CLAUDE.md §3 règle 7 ; docs/07 §1.4), pas une faute, et
                  `annulerReception` restaure le statut antérieur de la
                  commande dès qu'il est retrouvable avec certitude — une
                  ligne « annulée » ici ne veut donc pas dire que CETTE
                  commande est en incohérence. Le vrai cas d'incohérence
                  (une commande encore « reçue » sans la moindre réception
                  active) a sa propre alerte ci-dessous, seule à porter
                  `text-depassement`.
                */}
                <div className="border-b border-line px-4 py-2">
                  <h3 className="text-2xs uppercase text-ink-3">Réception(s) liée(s)</h3>
                  {detailCourant.receptionsLiees.length === 0 ? (
                    <p className="mt-1 text-sm text-ink-3">
                      Aucune réception ne référence encore cette commande.
                    </p>
                  ) : (
                    <ul className="mt-1 flex flex-col gap-groupe text-sm">
                      {detailCourant.receptionsLiees.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-groupe">
                          <span className={r.statut === 'annulee' ? 'text-ink-3' : 'text-ink'}>
                            {r.numero} · {formaterDate(r.dateReception)}
                            {r.statut === 'annulee' ? ' (annulée)' : ''}
                          </span>
                          <span className="num text-ink-2">
                            {r.montantTotalCents === null
                              ? '—'
                              : `${formaterMontant(r.montantTotalCents)} €`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {detailCourant.statut === 'recue' &&
                    !detailCourant.receptionsLiees.some((r) => r.statut === 'active') && (
                      <p role="alert" className="mt-2 text-sm text-depassement">
                        Cette commande est marquée « reçue », mais aucune réception active ne la
                        référence : la réception liée a peut-être été annulée depuis.
                      </p>
                    )}
                </div>

                <Tableau
                  colonnes={COLONNES_LIGNES}
                  lignes={detailCourant.lignes}
                  cleLigne={(l) => l.id}
                  etatVide={
                    <EtatVide variante="normal" texte="Aucune ligne dans cette commande." />
                  }
                />

                <p className="border-t border-line px-4 py-2 text-sm text-ink-2">
                  Montant total :{' '}
                  <span className="num text-ink">
                    {formaterMontant(detailCourant.montantTotalCents)} €
                  </span>
                </p>

                {detailCourant.notes !== null && (
                  <p className="border-t border-line px-4 py-2 text-sm text-ink-2">
                    Notes : {detailCourant.notes}
                  </p>
                )}

                {/* Le bon de commande se relit AVANT l'envoi, et le bouton est
                    donc posé avant les deux étapes d'écriture de D-009 : c'est
                    le PDF qui partira au fournisseur, et la validation humaine
                    n'a de sens que si l'on a pu voir la pièce qu'on valide.
                    Offert à tous les statuts : une commande déjà envoyée se
                    relit aussi, pour retrouver ce qu'on a demandé. */}
                <div className="border-t border-line px-4 py-3">
                  <BoutonDocument
                    chemin={`/commandes/${detailCourant.id}/pdf`}
                    libelle="Relire le bon de commande (PDF)"
                    libelleAttente="Édition du bon…"
                  />
                </div>

                {/* Etape 2/3 : valider — reservee au brouillon, jamais offerte ailleurs. */}
                {detailCourant.statut === 'brouillon' && (
                  <div className="border-t border-line px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void validerCommandeSelectionnee()}
                      disabled={etatValidation.statut === 'en_cours'}
                      className={`${CLASSE_BOUTON_PRIMAIRE} w-full`}
                    >
                      {etatValidation.statut === 'en_cours' ? 'Validation…' : 'Valider la commande'}
                    </button>
                  </div>
                )}

                {/*
                  LE RETOUR DE LA VALIDATION VIT HORS DU BLOC « brouillon »
                  CI-DESSUS, et c'est tout l'objet du correctif du 01/08/2026.

                  Il y etait enferme : `validerCommandeSelectionnee` posait bien
                  `setEtatValidation({ statut: 'succes', … })`, mais la MEME
                  fonction venait de remplacer le detail par une commande de
                  statut `validee`. React rend les deux mises a jour dans le
                  meme passage : le bloc disparaissait, et la phrase n'avait
                  jamais de conteneur ou s'afficher. Le message existait, il
                  etait juste, et il etait structurellement inatteignable.

                  Ce n'est pas cosmetique : des trois etapes de D-009, la
                  validation — « la validation humaine explicite » — etait la
                  SEULE a ne renvoyer aucun mot de confirmation. L'annulation et
                  l'envoi en affichent une. Le porteur ne voyait que des boutons
                  changer, sans qu'une phrase lui dise que l'ecriture avait eu
                  lieu.

                  Le minuteur de 5 s (`useEffect` sur `etatValidation`) efface
                  l'etat de lui-meme, exactement comme pour l'envoi et
                  l'annulation : sorti du bloc, le message ne reste donc pas
                  affiche indefiniment.
                */}
                {etatValidation.statut === 'succes' && (
                  <p role="status" className="border-t border-line px-4 py-3 text-sm text-conforme">
                    {etatValidation.message}
                  </p>
                )}
                {etatValidation.statut === 'erreur' && (
                  <div className="border-t border-line px-4 py-3">
                    <MessageErreur message={etatValidation.message} />
                  </div>
                )}

                {/*
                  Annulation (audit du 29/07/2026) : offerte pour un brouillon
                  OU une commande validée, jamais pour une commande déjà
                  envoyée ou reçue — l'API refuse ce cas de toute façon
                  (`commande_non_annulable`), mais ne pas proposer le bouton
                  évite un aller-retour qui échouerait à coup sûr.
                */}
                {(detailCourant.statut === 'brouillon' || detailCourant.statut === 'validee') && (
                  <div className="border-t border-line px-4 py-3">
                    {!annulationOuverte ? (
                      <button
                        type="button"
                        ref={boutonAnnulerCommande}
                        onClick={() => setAnnulationOuverte(true)}
                        className={`${CLASSE_BOUTON_SECONDAIRE} w-full`}
                      >
                        Annuler cette commande
                      </button>
                    ) : (
                      <form
                        onSubmit={(evenement) => {
                          evenement.preventDefault();
                          void annulerCommandeSelectionnee();
                        }}
                        className="flex flex-col gap-groupe"
                      >
                        <label
                          className="flex flex-col gap-groupe text-sm text-ink-2"
                          htmlFor="achats-motif-annulation"
                        >
                          Motif (facultatif)
                          <input
                            id="achats-motif-annulation"
                            ref={champMotifAnnulation}
                            type="text"
                            value={motifAnnulationSaisi}
                            onChange={(evenement) =>
                              setMotifAnnulationSaisi(evenement.target.value)
                            }
                            placeholder="Ex. rupture chez le fournisseur, quantité revue après comptage"
                            className="h-controle rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                          />
                        </label>
                        <div className="flex items-center gap-groupe">
                          <button
                            type="submit"
                            disabled={etatAnnulation.statut === 'en_cours'}
                            className={CLASSE_BOUTON_SECONDAIRE}
                          >
                            {etatAnnulation.statut === 'en_cours'
                              ? 'Annulation…'
                              : `Confirmer l’annulation de ${detailCourant.numero}`}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAnnulationOuverte(false);
                              setMotifAnnulationSaisi('');
                              requestAnimationFrame(() => boutonAnnulerCommande.current?.focus());
                            }}
                            className="text-sm text-ink-3 hover:text-ink-2"
                          >
                            Renoncer
                          </button>
                        </div>
                      </form>
                    )}
                    {etatAnnulation.statut === 'succes' && (
                      <p role="status" className="mt-2 text-sm text-conforme">
                        {etatAnnulation.message}
                      </p>
                    )}
                    {etatAnnulation.statut === 'erreur' && (
                      <div className="mt-2">
                        <MessageErreur message={etatAnnulation.message} />
                      </div>
                    )}
                  </div>
                )}

                {/* Etape 3/3 : envoyer — reservee a une commande VALIDEE. Aucun chemin
                    de cet ecran ne propose ce bouton pour un brouillon (D-009). */}
                {detailCourant.statut === 'validee' && (
                  // Vrai `<form>` : dans un champ e-mail, `Entrée` doit envoyer.
                  // Le garde-fou reste entier — ce bloc n'existe QUE pour une
                  // commande déjà `validee` (parcours à 3 étapes de D-009), et
                  // le bouton est `disabled` tant que l'adresse est vide.
                  <form
                    onSubmit={(evenement) => {
                      evenement.preventDefault();
                      void envoyerCommandeSelectionnee();
                    }}
                    className="border-t border-line px-4 py-3"
                  >
                    <h3 className="text-2xs uppercase text-ink-3">Envoyer au fournisseur</h3>
                    <label
                      className="mt-2 flex flex-col gap-groupe text-sm text-ink-2"
                      htmlFor="achats-email"
                    >
                      Adresse email
                      <input
                        id="achats-email"
                        type="email"
                        className="h-controle w-full rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                        value={emailSaisi}
                        onChange={(evenement) => setEmailSaisi(evenement.target.value)}
                        aria-invalid={erreurEmail !== undefined}
                        aria-describedby={
                          erreurEmail !== undefined ? 'achats-email-erreur' : undefined
                        }
                      />
                    </label>
                    {erreurEmail !== undefined && (
                      <p id="achats-email-erreur" className="mt-1 text-sm text-depassement">
                        {erreurEmail}
                      </p>
                    )}

                    <div className="mt-3 flex items-center gap-groupe">
                      <button
                        type="submit"
                        disabled={etatEnvoi.statut === 'en_cours' || emailSaisi.trim() === ''}
                        className={`${CLASSE_BOUTON_PRIMAIRE} w-56`}
                      >
                        {etatEnvoi.statut === 'en_cours' ? 'Envoi…' : 'Envoyer par email'}
                      </button>
                      {etatEnvoi.statut === 'succes' && (
                        <p role="status" className="text-sm text-conforme">
                          {etatEnvoi.message}
                        </p>
                      )}
                    </div>
                    {etatEnvoi.statut === 'erreur' && erreurEmail === undefined && (
                      <div className="mt-2">
                        <MessageErreur message={etatEnvoi.message} />
                      </div>
                    )}
                  </form>
                )}

                {(detailCourant.statut === 'envoyee' ||
                  detailCourant.statut === 'recue' ||
                  detailCourant.statut === 'annulee') && (
                  <p className="border-t border-line px-4 py-3 text-sm text-ink-2">
                    {messageEnvoiCommande(detailCourant, formaterDate)}
                  </p>
                )}
              </Panneau>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
