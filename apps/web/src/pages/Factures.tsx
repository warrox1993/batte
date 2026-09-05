import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  GLYPHE_STATUT,
  TIRET_ABSENT,
  formaterDate,
  formaterEcartMontant,
  formaterEuros,
  formaterMontant,
  fournisseursProposables,
  nouvelIdentifiant,
  parserEuros,
  schemaCorrectionLotAppliquee,
  schemaFactureDetail,
  schemaListeFactures,
  schemaListeFournisseurs,
  schemaListeReceptionsEligibles,
  type CorrectionLotAppliquee,
  type FactureDetail,
  type FactureResume,
  type Fournisseur,
  type LigneFactureDetailContrat,
  type LigneReceptionEligibleContrat,
  type Statut,
  type StatutFacture,
} from '@batte/core';
import { PastilleStatut } from '../composants/affichage';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';
import { aujourdHui } from '../lib/dates';
import { compteAccorde } from './pluriel';
import {
  AUCUNE_ERREUR,
  BandeauAlerte,
  BandeauErreur,
  BandeauSucces,
  CLASSE_BOUTON_LIEN,
  CLASSE_BOUTON_PRIMAIRE,
  CLASSE_BOUTON_SECONDAIRE,
  ChampSaisie,
  ChampSelection,
  repartirErreurApi,
  type ErreursFormulaire,
  type OptionSelection,
} from '../saisie-stock/champs';

/**
 * Ecran Factures (fiche 14, docs/17-VINGT-AMELIORATIONS.md § 14).
 *
 * TROIS IDEES QUI GOUVERNENT CET ECRAN, A LIRE AVANT DE MODIFIER.
 *
 * 1. Saisir une facture RAPPROCHE ses lignes des receptions correspondantes et
 *    calcule un ecart de prix (facture − bon de livraison) IMMEDIATEMENT
 *    VISIBLE — jamais une correction silencieuse. Les frais de reception
 *    (transport, palette), eux, sont ventiles sur les lots des leur saisie :
 *    ce sont des couts additionnels, jamais une remise en cause d'un prix
 *    deja constate.
 * 2. L'ecart de prix ne corrige le cout du lot que si l'utilisateur clique
 *    explicitement sur « Corriger le coût du lot » : c'est une decision
 *    economique separee de la saisie, pas un effet de bord.
 * 3. Corriger un lot ne modifie JAMAIS retroactivement une marge deja
 *    constatee : seul le restant du lot, pas encore consomme, change de
 *    valeur (voir `packages/db/src/services/factures.ts`).
 *
 * Regle d'architecture n°1 (CLAUDE.md §3) : aucun calcul metier ici. Les
 * ecarts, les montants et les totaux viennent tous de l'API telle quelle.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   Etats d'ecran
   ═══════════════════════════════════════════════════════════════════════════ */

type EtatFacturesEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; factures: FactureResume[] };

type EtatDetailEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; detail: FactureDetail };

/** Machine a etats transitoire (succes affiche 5 s, docs/07 §4.7). */
type EtatAction =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'succes'; message: string }
  | { statut: 'erreur'; message: string };

const LIBELLE_STATUT_FACTURE: Readonly<Record<StatutFacture, string>> = {
  a_rapprocher: 'À rapprocher',
  rapprochee: 'Rapprochée',
  payee: 'Payée',
  litige: 'En litige',
};

/**
 * Trois etats du produit, meme principe que `statutAffichageCommande` dans
 * `Achats.tsx` : `a_rapprocher` attend une decision (alerte), `rapprochee` et
 * `payee` sont conformes, `litige` — ou une facture ANNULEE, ecriture de
 * contrepassation jamais une suppression (CLAUDE.md §3 regle 7) — se lit
 * comme un depassement.
 */
function statutAffichageFacture(facture: FactureResume): Statut {
  if (facture.estAnnulation) return 'depassement';
  switch (facture.statut) {
    case 'a_rapprocher':
      return 'alerte';
    case 'rapprochee':
    case 'payee':
      return 'conforme';
    case 'litige':
      return 'depassement';
  }
}

/**
 * Referme `factureAnnuleeId` (`schemaFactureResume`, docs/21-CHAMPS-NON-LUS.md
 * §5) : le badge « Annulation » disait QU'une facture venait d'être annulée,
 * jamais LAQUELLE — deux annulations du même fournisseur étaient
 * indiscernables sans comparer les dates à l'œil. Simple JOIN d'affichage sur
 * la liste déjà chargée, jamais un second calcul (CLAUDE.md §3 règle 1).
 *
 * Fonction PURE et exportée : son test prouve la résolution, pas le rendu
 * réel dans le DOM (celui-ci relève de `Factures.montage.test.tsx`).
 */
export function libelleCibleAnnulationFacture(
  factureAnnuleeId: string | null,
  toutes: readonly FactureResume[],
): string | null {
  if (factureAnnuleeId === null) return null;
  const cible = toutes.find((f) => f.id === factureAnnuleeId);
  if (cible === undefined) return null;
  return `annule la facture ${cible.numeroFournisseur} du ${formaterDate(cible.dateFacture)} (${cible.fournisseurNom})`;
}

/**
 * Lien de téléchargement de la pièce jointe (bon de livraison / facture
 * scannée), extrait en composant NOMMÉ (même convention que `PastilleStatut`
 * ci-dessus) pour être testé isolément par `renderToStaticMarkup`, sans
 * monter le composant `Factures` entier.
 *
 * `download` est la garde décisive contre l'exécution d'une Data URI dans le
 * navigateur (mission « surface d'attaque », 30/07/2026, voir la décision de
 * conception en tête de `packages/db/src/services/factures.ts`) : SANS lui,
 * cliquer ce lien NAVIGUERAIT vers la Data URI au lieu de l'enregistrer sur
 * disque — un `data:application/pdf` porteur d'un script s'exécuterait alors
 * dans le contexte du lecteur intégré du navigateur plutôt que d'être
 * simplement téléchargé. Aucun `target` : une Data URI n'a pas de
 * `window.opener` à protéger, et un `target="_blank"` ouvrirait un onglet
 * pour rien.
 */
export function LienPieceJointe({
  pieceJointe,
  numeroFournisseur,
}: {
  readonly pieceJointe: string;
  readonly numeroFournisseur: string;
}) {
  return (
    <a href={pieceJointe} download={`facture-${numeroFournisseur}`} className={CLASSE_BOUTON_LIEN}>
      Voir / télécharger le scan
    </a>
  );
}

/** Tri par urgence : ce qui attend une decision d'abord, la plus recente d'abord a rang egal. */
const RANG_STATUT_FACTURE: Readonly<Record<StatutFacture, number>> = {
  a_rapprocher: 0,
  litige: 1,
  rapprochee: 2,
  payee: 3,
};

function comparerFactures(a: FactureResume, b: FactureResume): number {
  const rangA = RANG_STATUT_FACTURE[a.statut];
  const rangB = RANG_STATUT_FACTURE[b.statut];
  if (rangA !== rangB) return rangA - rangB;
  const parDate = b.dateFacture.localeCompare(a.dateFacture);
  return parDate !== 0 ? parDate : b.id.localeCompare(a.id);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Pièce jointe (bon de livraison / facture scannée)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `schemaFactureDetail` (`@batte/core`) ne connaît pas encore
 * `fichierScanPath` (voir la décision de conception dans
 * `packages/db/src/services/factures.ts` et le rapport de livraison : le
 * contrat HTTP partagé est hors du périmètre d'écriture de la mission qui a
 * ajouté ce champ) — `.parse()` le retire donc silencieusement de l'objet
 * qu'il rend. Cette fonction lit la réponse BRUTE, AVANT ce filtrage, pour ne
 * pas perdre la pièce jointe que le serveur envoie pourtant déjà
 * (`apps/api/src/routes/factures.ts`).
 *
 * Exportée pour être testée sans navigateur (même convention que
 * `resoudreEcartLigneFacture` ci-dessous).
 */
function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null;
}

export function extraireFichierScanPath(reponse: unknown): string | null {
  if (!estObjet(reponse)) return null;
  const brut = reponse['fichierScanPath'];
  return typeof brut === 'string' ? brut : null;
}

/** Types MIME acceptés pour une pièce jointe, mêmes règles que `validerPieceJointe` côté serveur. */
const TYPES_MIME_PIECE_JOINTE_ACCEPTES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

/** Même plafond que côté serveur (`packages/db/src/services/factures.ts`) : feedback immédiat,
 * la vérification qui compte reste celle du serveur. */
const TAILLE_MAX_PIECE_JOINTE_OCTETS = 8 * 1024 * 1024;

/**
 * Resout la cellule « Écart » d'une ligne de facture rapprochée.
 *
 * `ecartResiduelCents` est `null` EXACTEMENT quand `lotResolu` est faux
 * (contrat `LigneFactureDetailContrat`, `packages/core/src/contrats/factures.ts`) :
 * comparer un montant à « aucun lot » n'a pas de sens. Un `?? 0` masquait
 * cette invariance et aurait affiché « 0,00 € », coloré comme un vrai écart,
 * si un lot résolu remontait un jour sans écart résiduel connu — un cas que
 * le type autorise même si le serveur ne le produit pas aujourd'hui.
 *
 * `ecartInitialCents` (docs/21-CHAMPS-NON-LUS.md §5, champ `ecartPrixCents` du
 * même contrat, jamais lu avant ce correctif) distingue, dans le cas
 * `conforme`, une ligne qui n'a JAMAIS eu d'écart d'une ligne CORRIGÉE : une
 * fois `corrigerCoutLot` appliqué, `ecartResiduelCents` retombe à `0` — mais
 * `ecartPrixCents`, l'écart CONSTATÉ À LA SAISIE, reste le fait historique
 * figé. Sans cette distinction, une ligne réparée est indiscernable d'une
 * ligne qui n'a jamais posé de problème, alors que c'est exactement la trace
 * qu'un contrôle de cohérence fournisseur voudrait retrouver plus tard.
 */
export type EcartLigneFacture =
  | { type: 'absent' }
  | { type: 'conforme'; ecartInitialCents: number }
  | { type: 'ecart'; positif: boolean; texte: string };

export function resoudreEcartLigneFacture(ligne: LigneFactureDetailContrat): EcartLigneFacture {
  if (!ligne.lotResolu || ligne.ecartResiduelCents === null) return { type: 'absent' };
  if (ligne.ecartResiduelCents === 0) {
    return { type: 'conforme', ecartInitialCents: ligne.ecartPrixCents };
  }
  const positif = ligne.ecartResiduelCents > 0;
  return {
    type: 'ecart',
    positif,
    texte: `${positif ? '+' : ''}${formaterMontant(ligne.ecartResiduelCents)}`,
  };
}

/**
 * Confirmation du AVANT/APRÈS d'une correction de coût de lot
 * (docs/21-CHAMPS-NON-LUS.md §1.6, `schemaCorrectionLotAppliquee`,
 * `packages/core/src/contrats/factures.ts:149-154`) : le commentaire du
 * contrat est explicite — « le AVANT et le APRÈS, jamais "c'est fait" » — et
 * jusqu'à ce correctif, `corrigerCoutLot` ci-dessous appelait la route sans
 * même typer sa réponse (`Promise<unknown>` jamais parsé). Un geste qui
 * change un coût de matière, donc une marge, restait silencieux.
 */
export function phraseCorrectionCoutLot(resultat: CorrectionLotAppliquee): string {
  const delta = resultat.prixApresCents - resultat.prixAvantCents;
  return (
    `Coût du lot corrigé : ${formaterEuros(resultat.prixAvantCents)} → ` +
    `${formaterEuros(resultat.prixApresCents)} (${formaterEcartMontant(delta)} €).`
  );
}

/**
 * Clé de la ligne de facture à focaliser une fois qu'on vient de corriger le
 * coût de son lot (recette clavier du 31/07/2026 : le focus retombait sur
 * `<body>`, en démontant tout le panneau de détail — voir D-079,
 * `docs/22-FOCUS-DETRUIT.md` §2.2).
 *
 * LE GESTE RÉEL : une facture peut porter plusieurs lignes en écart de coût
 * (`resoudreEcartLigneFacture(l).type === 'ecart'`) ; on les corrige à la
 * suite, ligne après ligne. Le bouton « Corriger le coût du lot » de CETTE
 * ligne disparaît une fois la correction appliquée (l'écart résiduel devient
 * nul, `resoudreEcartLigneFacture` ne rend plus `'ecart'`) — même mécanisme
 * que `cleEcheanceAFocaliserApresPointage` (`Comptabilite.tsx`), transposé
 * d'une échéance à une ligne de facture. La continuité naturelle est donc la
 * PROCHAINE ligne encore en écart : si la corrigée était la dernière
 * actionnable, on revient sur la précédente ; s'il n'en reste aucune
 * (facture entièrement rapprochée), `null` — aucune cible forcée, même choix
 * que sur l'échéancier.
 */
export function cleLigneFactureAFocaliserApresCorrection(
  lignesAvant: readonly LigneFactureDetailContrat[],
  ligneCorrigeeId: string,
): string | null {
  const actionnablesAvant = lignesAvant
    .filter((l) => resoudreEcartLigneFacture(l).type === 'ecart')
    .map((l) => l.id);
  const indexAvant = actionnablesAvant.findIndex((id) => id === ligneCorrigeeId);
  const actionnablesApres = actionnablesAvant.filter((id) => id !== ligneCorrigeeId);
  if (actionnablesApres.length === 0) return null;
  const indexCible = Math.min(Math.max(indexAvant, 0), actionnablesApres.length - 1);
  return actionnablesApres[indexCible] ?? null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Colonnes
   ═══════════════════════════════════════════════════════════════════════════ */

/** Ligne enrichie de la résolution de `factureAnnuleeId` (voir
 * `libelleCibleAnnulationFacture`), calculée une seule fois pour tout le
 * tableau plutôt qu'à chaque cellule. */
type FactureLigneAffichage = FactureResume & { libelleAnnulation: string | null };

const COLONNES_FACTURES: ReadonlyArray<ColonneTableau<FactureLigneAffichage>> = [
  {
    cle: 'numero',
    libelle: 'N° facture',
    largeur: '16%',
    alignement: 'texte',
    rendu: (f) => <span className="font-mono text-xs">{f.numeroFournisseur}</span>,
    titre: (f) => f.numeroFournisseur,
  },
  {
    cle: 'fournisseur',
    libelle: 'Fournisseur',
    largeur: '22%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (f) => f.fournisseurNom,
    titre: (f) => f.fournisseurNom,
  },
  {
    cle: 'date',
    libelle: 'Date',
    largeur: '12%',
    alignement: 'texte',
    rendu: (f) => formaterDate(f.dateFacture),
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    largeur: '16%',
    // `repli` : la résolution de `factureAnnuleeId` (ligne muette ci-dessous,
    // docs/21-CHAMPS-NON-LUS.md §5) n'est jamais coupée. Ne grandit que les
    // rares lignes d'annulation, jamais les autres (docs/07 §4.4).
    troncature: 'repli',
    alignement: 'texte',
    rendu: (f) => (
      <>
        <PastilleStatut
          statut={statutAffichageFacture(f)}
          libelle={f.estAnnulation ? 'Annulation' : LIBELLE_STATUT_FACTURE[f.statut]}
        />
        {/* `factureAnnuleeId` résolu en texte VISIBLE, jamais en simple
            infobulle à la souris (CLAUDE.md §3 règle 10). */}
        {f.libelleAnnulation !== null && (
          <span className="block text-2xs text-ink-3">{f.libelleAnnulation}</span>
        )}
      </>
    ),
  },
  {
    cle: 'montant',
    libelle: 'Montant (€)',
    largeur: '17%',
    alignement: 'nombre',
    rendu: (f) => formaterMontant(f.montantTotalCents),
  },
  {
    cle: 'ecart',
    libelle: 'Écart (€)',
    largeur: '17%',
    alignement: 'nombre',
    rendu: (f) =>
      f.ecartTotalCents === 0 ? (
        <span className="text-ink-3">{TIRET_ABSENT}</span>
      ) : (
        <span
          className={`inline-flex items-center gap-groupe ${
            f.ecartTotalCents > 0 ? 'text-depassement' : 'text-alerte'
          }`}
        >
          <span aria-hidden="true">
            {GLYPHE_STATUT[f.ecartTotalCents > 0 ? 'depassement' : 'alerte']}
          </span>
          {f.ecartTotalCents > 0 ? '+' : ''}
          {formaterMontant(f.ecartTotalCents)}
        </span>
      ),
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   Composant principal
   ═══════════════════════════════════════════════════════════════════════════ */

export default function Factures() {
  const [etatFactures, setEtatFactures] = useState<EtatFacturesEcran>({ statut: 'chargement' });
  const [factureSelectionneeId, setFactureSelectionneeId] = useState<string | null>(null);
  const [etatDetail, setEtatDetail] = useState<EtatDetailEcran | null>(null);
  // Voir `extraireFichierScanPath` : `schemaFactureDetail` ne porte pas encore
  // ce champ, il est donc conservé À PART, extrait de la réponse BRUTE.
  const [pieceJointeDetail, setPieceJointeDetail] = useState<string | null>(null);
  const [saisieOuverte, setSaisieOuverte] = useState(false);
  const boutonNouvelleFacture = useRef<HTMLButtonElement>(null);
  // « Fermer » du panneau de détail : seul bouton STABLE de ce panneau, hors
  // du bloc « statut + annulation » qui disparaît légitimement une fois la
  // facture annulée (`!detailCourant.estAnnulee`, plus bas) — voir
  // `annulerFactureSelectionnee`.
  const boutonFermerDetail = useRef<HTMLButtonElement>(null);
  // Continue la correction de coût sur la PROCHAINE ligne encore en écart
  // (D-079) — voir `cleLigneFactureAFocaliserApresCorrection` ci-dessus et
  // l'effet plus bas. Même patron que `refListeEcheances` /
  // `cleEcheanceAFocaliser` dans `Comptabilite.tsx`.
  const refLignesFacture = useRef<HTMLDivElement>(null);
  const [cleLigneFactureAFocaliser, setCleLigneFactureAFocaliser] = useState<string | null>(null);

  const [statutChoisi, setStatutChoisi] = useState<StatutFacture>('a_rapprocher');
  const [etatChangementStatut, setEtatChangementStatut] = useState<EtatAction>({
    statut: 'inactif',
  });

  const [motifAnnulation, setMotifAnnulation] = useState('');
  const [etatAnnulation, setEtatAnnulation] = useState<EtatAction>({ statut: 'inactif' });

  const [etatCorrection, setEtatCorrection] = useState<
    | { statut: 'inactif' }
    | { statut: 'en_cours'; ligneId: string }
    | { statut: 'succes'; message: string }
    | { statut: 'erreur'; message: string }
  >({ statut: 'inactif' });

  // Succès affiché 5 s puis effacé (docs/07 §4.7), même patron que
  // `etatChangementStatut`/`etatAnnulation` ci-dessus.
  useEffect(() => {
    if (etatCorrection.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatCorrection({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatCorrection]);

  const chargerFactures = useCallback(() => {
    requeteApi<unknown>('/factures')
      .then((reponse) => {
        const liste = schemaListeFactures.parse(reponse);
        setEtatFactures({ statut: 'pret', factures: liste.data });
      })
      .catch((erreur: unknown) => {
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatFactures({ statut: 'erreur', message });
      });
  }, []);

  useEffect(() => {
    chargerFactures();
  }, [chargerFactures]);

  const chargerDetail = useCallback((id: string) => {
    let annule = false;
    setEtatDetail({ statut: 'chargement' });

    requeteApi<unknown>(`/factures/${id}`)
      .then((reponse) => {
        const detail = schemaFactureDetail.parse(reponse);
        if (annule) return;
        setEtatDetail({ statut: 'pret', detail });
        setPieceJointeDetail(extraireFichierScanPath(reponse));
        setStatutChoisi(detail.statut);
        setEtatChangementStatut({ statut: 'inactif' });
        setEtatAnnulation({ statut: 'inactif' });
        // PAS dans `rechargerDetailEnArrierePlan` ci-dessous : c'est ELLE qui
        // suit immédiatement le succès posé par `corrigerCoutLot`, et la
        // bannière AVANT/APRÈS doit survivre à ce rechargement précis.
        setEtatCorrection({ statut: 'inactif' });
        setMotifAnnulation('');
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
  }, []);

  /**
   * Recharge le détail d'une facture DÉJÀ affichée, sans jamais repasser par
   * `{ statut: 'chargement' }` (D-079, même patron que
   * `rechargerEcheancesEnArrierePlan` dans `Comptabilite.tsx`) : le panneau
   * de détail — `<Tableau>` des lignes, bouton « Corriger le coût du lot »
   * compris — reste MONTÉ pendant tout l'aller-retour réseau, donc le focus
   * posé par l'effet `cleLigneFactureAFocaliser` (ou par
   * `annulerFactureSelectionnee`) survit. Réservée aux rechargements
   * DÉCLENCHÉS PENDANT que ce détail est déjà affiché (correction de coût,
   * annulation) — `chargerDetail` ci-dessus reste seule appropriée au PREMIER
   * affichage, où il n'y a encore rien à montrer.
   */
  const rechargerDetailEnArrierePlan = useCallback((id: string): void => {
    requeteApi<unknown>(`/factures/${id}`)
      .then((reponse) => {
        const detail = schemaFactureDetail.parse(reponse);
        setEtatDetail({ statut: 'pret', detail });
        setPieceJointeDetail(extraireFichierScanPath(reponse));
        setStatutChoisi(detail.statut);
        setEtatChangementStatut({ statut: 'inactif' });
        setEtatAnnulation({ statut: 'inactif' });
        setMotifAnnulation('');
      })
      .catch((erreur: unknown) => {
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatDetail({ statut: 'erreur', message });
      });
  }, []);

  useEffect(() => {
    if (factureSelectionneeId === null) {
      setEtatDetail(null);
      setPieceJointeDetail(null);
      return;
    }
    return chargerDetail(factureSelectionneeId);
  }, [factureSelectionneeId, chargerDetail]);

  // Continue la correction de coût sur la PROCHAINE ligne encore en écart
  // (recette clavier du 31/07/2026 — voir `cleLigneFactureAFocaliserApresCorrection`
  // ci-dessus). Le bouton ciblé existe déjà au moment où cet effet s'exécute :
  // corriger le coût d'une ligne ne démonte NI l'id NI la clé React des
  // AUTRES lignes, qui ne sont donc jamais démontées par le rechargement en
  // tâche de fond (`rechargerDetailEnArrierePlan`).
  useEffect(() => {
    if (cleLigneFactureAFocaliser === null) return;
    refLignesFacture.current
      ?.querySelector<HTMLElement>(`[data-ligne-facture="${cleLigneFactureAFocaliser}"] button`)
      ?.focus();
    setCleLigneFactureAFocaliser(null);
  }, [cleLigneFactureAFocaliser]);

  // « Échap ferme » (docs/07 §4.6), même patron que `Achats.tsx` / `Stock.tsx`.
  // Le focus revient sur « Nouvelle facture » : le détail s'ouvre depuis une
  // ligne du tableau (`onSelectionnerLigne`), qui n'expose aucune ref de
  // rangée à réutiliser — même repli que `boutonNouvelleDepense` dans
  // `Comptabilite.tsx` pour un panneau ouvert depuis une ligne.
  useEffect(() => {
    if (factureSelectionneeId === null) return;
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key !== 'Escape') return;
      setFactureSelectionneeId(null);
      boutonNouvelleFacture.current?.focus();
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [factureSelectionneeId]);

  // Même patron pour le panneau « Nouvelle facture » : Échap le referme et
  // rend le focus au bouton bascule, comme `Economies.tsx`.
  useEffect(() => {
    if (!saisieOuverte) return;
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key !== 'Escape') return;
      setSaisieOuverte(false);
      boutonNouvelleFacture.current?.focus();
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [saisieOuverte]);

  useEffect(() => {
    if (etatChangementStatut.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatChangementStatut({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatChangementStatut]);

  useEffect(() => {
    if (etatAnnulation.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatAnnulation({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatAnnulation]);

  async function appliquerChangementStatut(): Promise<void> {
    if (etatDetail === null || etatDetail.statut !== 'pret') return;
    const detail = etatDetail.detail;
    if (statutChoisi === detail.statut || etatChangementStatut.statut === 'en_cours') return;

    setEtatChangementStatut({ statut: 'en_cours' });
    try {
      const reponse = await requeteApi<unknown>(`/factures/${detail.id}/statut`, {
        method: 'PATCH',
        body: JSON.stringify({ statut: statutChoisi }),
      });
      const detailMisAJour = schemaFactureDetail.parse(reponse);
      setEtatDetail({ statut: 'pret', detail: detailMisAJour });
      setPieceJointeDetail(extraireFichierScanPath(reponse));
      setEtatChangementStatut({ statut: 'succes', message: 'Statut mis à jour.' });
      chargerFactures();
    } catch (erreur) {
      setEtatChangementStatut({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'Le changement de statut a échoué.',
      });
    }
  }

  async function annulerFactureSelectionnee(): Promise<void> {
    if (etatDetail === null || etatDetail.statut !== 'pret') return;
    const detail = etatDetail.detail;
    const motif = motifAnnulation.trim();
    if (motif === '' || etatAnnulation.statut === 'en_cours') return;

    setEtatAnnulation({ statut: 'en_cours' });
    try {
      await requeteApi<unknown>(`/factures/${detail.id}/annuler`, {
        method: 'POST',
        body: JSON.stringify({ motif }),
      });
      setEtatAnnulation({
        statut: 'succes',
        message: 'Facture annulée par contre-écriture. La facture originale reste consultable.',
      });
      setMotifAnnulation('');
      chargerFactures();
      // Le bloc « Annuler cette facture » (bouton compris) disparaît
      // légitimement dès que `estAnnulee` devient vrai (plus bas,
      // `!detailCourant.estAnnulee`) — geste PONCTUEL par facture, jamais
      // enchaîné (à la différence de la correction de coût ci-dessous) :
      // la cible stable la plus proche est « Fermer », qui reste monté quel
      // que soit le statut d'annulation. Focus posé AVANT le rechargement,
      // même patron que `sortieEnregistree` (`Stock.tsx`) — D-079.
      boutonFermerDetail.current?.focus();
      rechargerDetailEnArrierePlan(detail.id);
    } catch (erreur) {
      setEtatAnnulation({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : "L'annulation a échoué.",
      });
    }
  }

  async function corrigerCoutLot(ligne: LigneFactureDetailContrat): Promise<void> {
    if (etatDetail === null || etatDetail.statut !== 'pret') return;
    const lignesAvant = etatDetail.detail.lignes;
    setEtatCorrection({ statut: 'en_cours', ligneId: ligne.id });
    try {
      const reponse = await requeteApi<unknown>(`/factures/lignes/${ligne.id}/corriger-lot`, {
        method: 'POST',
      });
      const resultat = schemaCorrectionLotAppliquee.parse(reponse);
      setEtatCorrection({ statut: 'succes', message: phraseCorrectionCoutLot(resultat) });
      // Continuer la correction sans retomber sur `<body>` — voir
      // `cleLigneFactureAFocaliserApresCorrection` et
      // `rechargerDetailEnArrierePlan` ci-dessus (D-079).
      setCleLigneFactureAFocaliser(cleLigneFactureAFocaliserApresCorrection(lignesAvant, ligne.id));
      rechargerDetailEnArrierePlan(etatDetail.detail.id);
    } catch (erreur) {
      setEtatCorrection({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'La correction a échoué.',
      });
    }
  }

  const facturesTriees: FactureLigneAffichage[] =
    etatFactures.statut === 'pret'
      ? [...etatFactures.factures].sort(comparerFactures).map((f) => ({
          ...f,
          libelleAnnulation: libelleCibleAnnulationFacture(
            f.factureAnnuleeId,
            etatFactures.factures,
          ),
        }))
      : [];

  const detailCourant =
    etatDetail !== null && etatDetail.statut === 'pret' ? etatDetail.detail : null;

  const colonnesLignes: ReadonlyArray<ColonneTableau<LigneFactureDetailContrat>> = useMemo(
    () => [
      {
        cle: 'libelle',
        libelle: 'Ligne',
        largeur: '26%',
        alignement: 'texte',
        troncature: 'repli',
        rendu: (l) => l.libelle,
        titre: (l) => l.libelle,
      },
      {
        cle: 'rapprochement',
        libelle: 'Rapprochée à',
        largeur: '26%',
        alignement: 'texte',
        troncature: 'repli',
        // `receptionAnnulee` (recalculé À CHAQUE LECTURE, jamais figé à la
        // saisie — voir `packages/db/src/services/factures.ts`) : le
        // rattachement reste ACCEPTÉ, ce marqueur n'est qu'un avertissement
        // visuel EN PLUS du bandeau agrégé plus haut, pour dire LAQUELLE des
        // lignes est concernée sur une facture qui en compte plusieurs.
        rendu: (l) =>
          l.numeroReception === null ? (
            <span className="text-ink-3">Aucun lien</span>
          ) : (
            <span>
              {`${l.numeroReception} — ${l.nomIngredient ?? 'frais de réception'}`}
              {l.receptionAnnulee && (
                <span className="ml-groupe text-depassement" title="Cette réception a été annulée.">
                  <span aria-hidden="true">{GLYPHE_STATUT.depassement}</span> annulée
                </span>
              )}
            </span>
          ),
      },
      {
        cle: 'montant',
        libelle: 'Montant (€)',
        largeur: '14%',
        alignement: 'nombre',
        rendu: (l) => formaterMontant(l.montantCents),
      },
      {
        cle: 'ecart',
        libelle: 'Écart (€)',
        largeur: '14%',
        alignement: 'nombre',
        rendu: (l) => {
          const ecart = resoudreEcartLigneFacture(l);
          switch (ecart.type) {
            case 'absent':
              return <span className="text-ink-3">{TIRET_ABSENT}</span>;
            case 'conforme':
              return (
                <span className="inline-flex items-center gap-groupe text-conforme">
                  <span aria-hidden="true">{GLYPHE_STATUT.conforme}</span>
                  {ecart.ecartInitialCents === 0
                    ? 'Conforme'
                    : `Corrigé (était ${formaterEcartMontant(ecart.ecartInitialCents)})`}
                </span>
              );
            case 'ecart':
              return (
                <span
                  className={`inline-flex items-center gap-groupe ${
                    ecart.positif ? 'text-depassement' : 'text-alerte'
                  }`}
                >
                  <span aria-hidden="true">
                    {GLYPHE_STATUT[ecart.positif ? 'depassement' : 'alerte']}
                  </span>
                  {ecart.texte}
                </span>
              );
          }
        },
      },
      {
        cle: 'action',
        libelle: 'Action',
        largeur: '20%',
        alignement: 'texte',
        // `data-ligne-facture` cible la cellule MÊME quand le bouton
        // disparaît (une fois l'écart résolu) :
        // `cleLigneFactureAFocaliserApresCorrection` pointe la PROCHAINE
        // ligne encore en écart, jamais celle-ci (D-079).
        rendu: (l) => {
          const enCours = etatCorrection.statut === 'en_cours' && etatCorrection.ligneId === l.id;
          return (
            <span data-ligne-facture={l.id}>
              {resoudreEcartLigneFacture(l).type === 'ecart' && (
                <button
                  type="button"
                  onClick={() => void corrigerCoutLot(l)}
                  disabled={enCours}
                  className={CLASSE_BOUTON_LIEN}
                >
                  {enCours ? 'Correction…' : 'Corriger le coût du lot'}
                </button>
              )}
            </span>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [etatCorrection],
  );

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Factures fournisseur</h1>
        <button
          type="button"
          ref={boutonNouvelleFacture}
          onClick={() => setSaisieOuverte((precedent) => !precedent)}
          className={CLASSE_BOUTON_PRIMAIRE}
        >
          {saisieOuverte ? 'Fermer la saisie' : 'Nouvelle facture'}
        </button>
      </div>

      {saisieOuverte && (
        <SaisieFacture
          onEnregistre={() => {
            setSaisieOuverte(false);
            boutonNouvelleFacture.current?.focus();
            chargerFactures();
          }}
          onAnnuler={() => {
            setSaisieOuverte(false);
            boutonNouvelleFacture.current?.focus();
          }}
        />
      )}

      {etatFactures.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Chargement des factures…</p>
      )}

      {etatFactures.statut === 'erreur' && <MessageErreur message={etatFactures.message} />}

      {etatFactures.statut === 'pret' && (
        <div className="flex flex-col items-start gap-bloc lg:flex-row">
          <div className="min-w-0 flex-1 self-stretch">
            <Panneau
              titre={compteAccorde(facturesTriees.length, 'facture', 'factures')}
              sansRembourrage
            >
              <Tableau
                colonnes={COLONNES_FACTURES}
                lignes={facturesTriees}
                cleLigne={(f) => f.id}
                {...(factureSelectionneeId !== null
                  ? { ligneSelectionneeCle: factureSelectionneeId }
                  : {})}
                onSelectionnerLigne={(f) =>
                  setFactureSelectionneeId((precedent) => (precedent === f.id ? null : f.id))
                }
                etatVide={
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucune facture enregistrée"
                    explication="Enregistrez une première facture pour la rapprocher des réceptions correspondantes."
                    action={{ libelle: 'Nouvelle facture', onClick: () => setSaisieOuverte(true) }}
                  />
                }
              />
            </Panneau>
          </div>

          {etatDetail !== null && etatDetail.statut === 'chargement' && (
            <div className="w-full lg:w-[35rem] lg:shrink-0">
              <Panneau titre="Chargement…">
                <p className="text-sm text-ink-3">Chargement du détail…</p>
              </Panneau>
            </div>
          )}

          {etatDetail !== null && etatDetail.statut === 'erreur' && (
            <div className="w-full lg:w-[35rem] lg:shrink-0">
              <Panneau titre="Erreur">
                <MessageErreur message={etatDetail.message} />
              </Panneau>
            </div>
          )}

          {detailCourant !== null && (
            <div className="w-full lg:w-[35rem] lg:shrink-0">
              <Panneau titre={detailCourant.numeroFournisseur} sansRembourrage>
                <div className="flex items-center justify-between border-b border-line px-4 py-2">
                  <div>
                    <p className="text-sm font-medium text-ink">{detailCourant.fournisseurNom}</p>
                    <p className="text-xs text-ink-3">
                      Facturée le {formaterDate(detailCourant.dateFacture)}
                      {detailCourant.dateEcheance !== null
                        ? ` · Échéance le ${formaterDate(detailCourant.dateEcheance)}`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    ref={boutonFermerDetail}
                    onClick={() => {
                      setFactureSelectionneeId(null);
                      boutonNouvelleFacture.current?.focus();
                    }}
                    className="text-xs font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Fermer
                  </button>
                </div>

                <div className="border-b border-line px-4 py-2">
                  <PastilleStatut
                    statut={statutAffichageFacture(detailCourant)}
                    libelle={
                      detailCourant.estAnnulation
                        ? 'Annulation'
                        : LIBELLE_STATUT_FACTURE[detailCourant.statut]
                    }
                  />
                  {detailCourant.estAnnulee && (
                    <p className="mt-1 text-xs text-depassement">
                      Cette facture a été annulée par une contre-écriture.
                    </p>
                  )}
                </div>

                {/* Avertissement NON BLOQUANT (mission « deux restes de la
                    chaîne d'achat », 31/07/2026) : au moins une ligne est
                    rattachée à une réception depuis annulée. Le rattachement
                    reste ACCEPTÉ — voir `packages/db/src/services/factures.ts`
                    — ce bandeau ne fait que le rendre visible, recalculé À
                    CHAQUE LECTURE, jamais figé à la saisie. Affiché TEL QUEL,
                    une phrase par ligne concernée, jamais reformulé. Absent
                    (donc rien à l'écran) sur une facture qui n'en produit
                    aucune — le cas le plus fréquent. */}
                {detailCourant.avertissements.length > 0 && (
                  <div className="border-b border-line px-4 py-2">
                    <BandeauAlerte>
                      {detailCourant.avertissements.map((avertissement, index) => (
                        <p key={index} className={index > 0 ? 'mt-groupe' : undefined}>
                          <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span> {avertissement}
                        </p>
                      ))}
                    </BandeauAlerte>
                  </div>
                )}

                <div ref={refLignesFacture}>
                  <Tableau
                    colonnes={colonnesLignes}
                    lignes={detailCourant.lignes}
                    cleLigne={(l) => l.id}
                    etatVide={
                      <EtatVide variante="normal" texte="Aucune ligne dans cette facture." />
                    }
                  />
                </div>

                {etatCorrection.statut === 'succes' && (
                  <div className="px-4 py-2">
                    <BandeauSucces>{etatCorrection.message}</BandeauSucces>
                  </div>
                )}

                {etatCorrection.statut === 'erreur' && (
                  <div className="px-4 py-2">
                    <MessageErreur message={etatCorrection.message} />
                  </div>
                )}

                <p className="flex items-baseline justify-between border-t border-line px-4 py-2 text-sm text-ink-2">
                  <span>Montant total</span>
                  <span className="num text-ink">
                    {formaterMontant(detailCourant.montantTotalCents)} €
                  </span>
                </p>
                {detailCourant.ecartTotalCents !== 0 && (
                  <p className="flex items-baseline justify-between px-4 py-1 text-sm text-ink-2">
                    <span>Écart total constaté</span>
                    <span
                      className={`num ${detailCourant.ecartTotalCents > 0 ? 'text-depassement' : 'text-alerte'}`}
                    >
                      {detailCourant.ecartTotalCents > 0 ? '+' : ''}
                      {formaterMontant(detailCourant.ecartTotalCents)} €
                    </span>
                  </p>
                )}

                {detailCourant.notes !== null && (
                  <p className="border-t border-line px-4 py-2 text-sm text-ink-2">
                    Notes : {detailCourant.notes}
                  </p>
                )}

                <div className="border-t border-line px-4 py-2">
                  <p className="text-2xs uppercase text-ink-3">Pièce jointe</p>
                  {pieceJointeDetail !== null ? (
                    <LienPieceJointe
                      pieceJointe={pieceJointeDetail}
                      numeroFournisseur={detailCourant.numeroFournisseur}
                    />
                  ) : (
                    <p className="text-xs text-ink-3">
                      Aucune pièce jointe — elle ne peut être ajoutée qu'à la saisie (CLAUDE.md §7 :
                      jamais reconstituée après coup).
                    </p>
                  )}
                </div>

                {!detailCourant.estAnnulation && !detailCourant.estAnnulee && (
                  <>
                    <div className="flex items-end gap-groupe border-t border-line px-4 py-3">
                      <ChampSelection
                        nom="statut-facture"
                        libelle="Statut"
                        valeur={statutChoisi}
                        onChange={(valeur) => setStatutChoisi(valeur as StatutFacture)}
                        options={[
                          { valeur: 'a_rapprocher', libelle: 'À rapprocher' },
                          { valeur: 'rapprochee', libelle: 'Rapprochée' },
                          { valeur: 'payee', libelle: 'Payée' },
                          { valeur: 'litige', libelle: 'En litige' },
                        ]}
                      />
                      <button
                        type="button"
                        onClick={() => void appliquerChangementStatut()}
                        disabled={
                          statutChoisi === detailCourant.statut ||
                          etatChangementStatut.statut === 'en_cours'
                        }
                        className={CLASSE_BOUTON_SECONDAIRE}
                      >
                        {etatChangementStatut.statut === 'en_cours' ? 'Mise à jour…' : 'Appliquer'}
                      </button>
                    </div>
                    {etatChangementStatut.statut === 'succes' && (
                      <p role="status" className="px-4 pb-2 text-sm text-conforme">
                        {etatChangementStatut.message}
                      </p>
                    )}
                    {etatChangementStatut.statut === 'erreur' && (
                      <div className="px-4 pb-2">
                        <MessageErreur message={etatChangementStatut.message} />
                      </div>
                    )}

                    <form
                      onSubmit={(evenement) => {
                        evenement.preventDefault();
                        void annulerFactureSelectionnee();
                      }}
                      className="border-t border-line px-4 py-3"
                    >
                      <h3 className="text-2xs uppercase text-ink-3">
                        Annuler cette facture (facture mal saisie)
                      </h3>
                      <p className="mt-1 text-xs text-ink-3">
                        Écrit une contre-écriture (montant inverse) : la facture originale reste
                        lisible, elle n'est jamais supprimée.
                      </p>
                      <div className="mt-2 flex items-end gap-groupe">
                        <div className="flex-1">
                          <ChampSaisie
                            nom="motif-annulation"
                            libelle="Motif de l'annulation"
                            valeur={motifAnnulation}
                            onChange={setMotifAnnulation}
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={
                            motifAnnulation.trim() === '' || etatAnnulation.statut === 'en_cours'
                          }
                          className={CLASSE_BOUTON_SECONDAIRE}
                        >
                          {etatAnnulation.statut === 'en_cours'
                            ? 'Annulation…'
                            : 'Annuler la facture'}
                        </button>
                      </div>
                      {etatAnnulation.statut === 'succes' && (
                        <BandeauSucces>{etatAnnulation.message}</BandeauSucces>
                      )}
                      {etatAnnulation.statut === 'erreur' && (
                        <div className="mt-2">
                          <MessageErreur message={etatAnnulation.message} />
                        </div>
                      )}
                    </form>
                  </>
                )}
              </Panneau>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Saisie d'une nouvelle facture
   ═══════════════════════════════════════════════════════════════════════════ */

type NatureLigne = 'rapprochee' | 'frais' | 'libre';

type LigneBrouillon = {
  readonly cle: string;
  nature: NatureLigne;
  libelle: string;
  montant: string;
  /** Pour `nature === 'rapprochee'` : clé composite `receptionId::ingredientId`. */
  receptionIngredientCle: string;
  /** Pour `nature === 'frais'` : identifiant de réception seul. */
  receptionCle: string;
  methodeRepartitionFrais: 'valeur' | 'quantite';
};

function ligneVide(): LigneBrouillon {
  return {
    cle: nouvelIdentifiant(),
    nature: 'rapprochee',
    libelle: '',
    montant: '',
    receptionIngredientCle: '',
    receptionCle: '',
    methodeRepartitionFrais: 'valeur',
  };
}

/**
 * Cle de ligne a focaliser une fois qu'on vient d'en retirer une (recette
 * clavier du 30/07/2026 : « Retirer » une ligne de facture faisait retomber
 * le focus sur `<body>`, deux fois).
 *
 * MÊME RAISONNEMENT que `cleAFocaliserApresRetrait`
 * (`saisie-stock/SaisieReception.tsx`, à lire avant de modifier ce fichier) —
 * dupliqué ici à dessein plutôt qu'importé d'un fichier actif sous un autre
 * agent ce soir : on retire une ligne PARCE QU'ON S'EST TROMPÉ, et on veut
 * continuer à saisir IMMÉDIATEMENT, au même endroit à l'écran — jamais en
 * redescendant chercher une autre rangée. La cible est donc la ligne qui
 * prend la place VISUELLE de celle qu'on retire : la suivante glisse vers le
 * haut ; sur la dernière ligne retirée, c'est la précédente qui devient
 * dernière. `retirerLigne` insère toujours une ligne vide si la liste
 * deviendrait vide, donc `lignesApres` n'est jamais vide ici non plus.
 */
export function cleAFocaliserApresRetraitLigneFacture<L extends { readonly cle: string }>(
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
 * Le nom DOM de certains champs diverge de la clé d'erreur utilisée par
 * `construireCorps` (alignée sur le corps envoyé au serveur) — voir le `nom`
 * réellement posé sur le `<input>`/`<select>` plus bas dans le rendu. Sans
 * cette table, `focaliserPremierChampFautif` interrogerait
 * `[name="receptionIngredientCle"]`, qui n'existe pas : le focus resterait
 * immobile en silence (`.focus()` sur `undefined` ne fait rien).
 */
const NOM_DOM_PAR_CHAMP_ENTETE: Readonly<Record<string, string>> = {
  fichierScanPath: 'piece-jointe-facture',
};
const NOM_DOM_PAR_CHAMP_LIGNE: Readonly<Record<string, string>> = {
  receptionIngredientCle: 'rapprochement',
  receptionCle: 'reception',
};

type EtatReferentielFacture =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; fournisseurs: Fournisseur[] };

function SaisieFacture({
  onEnregistre,
  onAnnuler,
}: {
  onEnregistre: () => void;
  onAnnuler: () => void;
}) {
  const [referentiel, setReferentiel] = useState<EtatReferentielFacture>({ statut: 'chargement' });
  const [fournisseurId, setFournisseurId] = useState('');
  const [numeroFournisseur, setNumeroFournisseur] = useState('');
  const [dateFacture, setDateFacture] = useState(aujourdHui);
  const [dateEcheance, setDateEcheance] = useState('');
  const [notes, setNotes] = useState('');
  // Piece jointe (bon de livraison / facture scannee) : convertie en Data URI
  // cote client (voir la decision de conception, `packages/db/src/services/
  // factures.ts`) et envoyee telle quelle — le SERVEUR reste l'autorite sur
  // le format et la taille (`validerPieceJointe`), ce controle client n'est
  // qu'un retour immediat.
  const [pieceJointe, setPieceJointe] = useState<string | null>(null);
  const [erreurPieceJointe, setErreurPieceJointe] = useState<string | null>(null);
  const [lignes, setLignes] = useState<LigneBrouillon[]>(() => [ligneVide()]);
  const [receptionsEligibles, setReceptionsEligibles] = useState<LigneReceptionEligibleContrat[]>(
    [],
  );
  const [erreurReceptionsEligibles, setErreurReceptionsEligibles] = useState<string | null>(null);
  // Focalise le premier champ de la ligne qui vient d'être ajoutée (voir
  // `ajouterLigne`) : sans ce rappel, le focus restait sur le bouton « Ajouter
  // une ligne » et forçait une tabulation de plus pour reprendre la saisie —
  // même raison que `aFocaliserProchaineLigneRef` dans Sessions.tsx.
  const cleLigneAFocaliserRef = useRef<string | null>(null);
  const champFournisseur = useRef<HTMLSelectElement>(null);
  // Portee des recherches `[name="…"]` de `focaliserPremierChampFautif`
  // ci-dessous — même rôle que `formulaireRef` dans
  // `saisie-stock/SaisieReception.tsx`.
  const formulaireRef = useRef<HTMLFormElement>(null);

  // Focus entrant a l'ouverture du panneau (docs/07 §4.6) : ce composant n'est
  // monte QUE quand `saisieOuverte` devient vrai, le montage EST donc
  // l'ouverture — pas besoin d'un effet conditionne sur une prop.
  useEffect(() => {
    champFournisseur.current?.focus();
  }, []);

  const [erreursEntete, setErreursEntete] = useState<ErreursFormulaire>(AUCUNE_ERREUR);
  const [erreursLignes, setErreursLignes] = useState<Record<string, Record<string, string>>>({});
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  useEffect(() => {
    let annule = false;
    requeteApi<unknown>('/fournisseurs')
      .then((reponse) => {
        if (annule) return;
        setReferentiel({
          statut: 'pret',
          fournisseurs: schemaListeFournisseurs.parse(reponse).data,
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

  // Les réceptions éligibles dépendent du fournisseur choisi : une facture ne
  // se rapproche qu'à une réception DU MÊME fournisseur (le serveur le refuse
  // sinon).
  useEffect(() => {
    if (fournisseurId === '') {
      setReceptionsEligibles([]);
      setErreurReceptionsEligibles(null);
      return;
    }
    let annule = false;
    requeteApi<unknown>(`/factures/receptions-eligibles/${fournisseurId}`)
      .then((reponse) => {
        if (annule) return;
        setReceptionsEligibles(schemaListeReceptionsEligibles.parse(reponse).data);
        setErreurReceptionsEligibles(null);
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        // CLAUDE.md §4 : jamais de catch silencieux. Vider la liste sans rien
        // dire rendait un ECHEC RESEAU indiscernable d'un fournisseur qui n'a
        // simplement aucune réception — l'utilisateur choisissait alors « sans
        // lien » en croyant qu'il n'y avait rien à rapprocher, alors que la
        // réception existait bel et bien côté serveur.
        setReceptionsEligibles([]);
        setErreurReceptionsEligibles(
          erreur instanceof ErreurApi
            ? erreur.message
            : 'Impossible de charger les réceptions de ce fournisseur, sans plus de détail.',
        );
      });
    return () => {
      annule = true;
    };
  }, [fournisseurId]);

  const fournisseurs = useMemo(
    () => (referentiel.statut === 'pret' ? referentiel.fournisseurs : []),
    [referentiel],
  );
  /**
   * BUG CORRIGÉ (mission « deux restes de la chaîne d'achat », 31/07/2026) :
   * ce filtre ne testait jusqu'ici que `f.actif`, jamais `f.type !== 'systeme'`
   * — une facture pouvait donc se saisir au nom d'« Inventaire d'ouverture »,
   * la contrepartie interne qui porte le stock d'avant l'installation
   * (`packages/db/src/seed/fournisseurs-systeme.ts`). Elle n'émet aucune
   * facture : `Ingredients.tsx` excluait déjà ce type pour ses
   * conditionnements, cet écran seul l'oubliait pour les factures. Centralisé
   * dans `fournisseursProposables` (`@batte/core`,
   * `packages/core/src/fournisseurs.ts`) : voir cette fonction pour
   * l'argument complet et pour ce qui reste HORS de son périmètre (la
   * réception de marchandise, qui inclut ce fournisseur à dessein). Le
   * SERVEUR porte désormais la même garde côté écriture
   * (`packages/db/src/services/factures.ts::enregistrerFacture`), pour que
   * ce filtre d'écran ne soit plus la seule ligne de défense.
   */
  const optionsFournisseurs: OptionSelection[] = useMemo(
    () => fournisseursProposables(fournisseurs).map((f) => ({ valeur: f.id, libelle: f.nom })),
    [fournisseurs],
  );

  const optionsRapprochement: OptionSelection[] = useMemo(
    () =>
      receptionsEligibles.map((l) => ({
        valeur: `${l.receptionId}::${l.ingredientId}`,
        libelle:
          `${l.numeroReception} — ${l.nomIngredient} — BL ${formaterEuros(l.prixLigneCents)}` +
          (l.numeroLotFournisseur !== null ? ` — lot ${l.numeroLotFournisseur}` : ''),
      })),
    [receptionsEligibles],
  );

  const optionsReceptions: OptionSelection[] = useMemo(() => {
    const parReception = new Map<string, { numero: string; date: string }>();
    for (const l of receptionsEligibles) {
      if (!parReception.has(l.receptionId)) {
        parReception.set(l.receptionId, { numero: l.numeroReception, date: l.dateReception });
      }
    }
    return [...parReception.entries()].map(([receptionId, r]) => ({
      valeur: receptionId,
      libelle: `${r.numero} — ${formaterDate(r.date)}`,
    }));
  }, [receptionsEligibles]);

  /**
   * Lit le fichier choisi et le convertit en Data URI (`FileReader`). Rejette
   * localement un format ou une taille non conformes — même règles que
   * `validerPieceJointe` côté serveur, pour un retour immédiat plutôt qu'un
   * aller-retour réseau qui échouerait de toute façon.
   */
  function surChangementPieceJointe(evenement: ChangeEvent<HTMLInputElement>): void {
    const fichier = evenement.target.files?.[0] ?? null;
    if (fichier === null) {
      setPieceJointe(null);
      setErreurPieceJointe(null);
      return;
    }
    if (!TYPES_MIME_PIECE_JOINTE_ACCEPTES.includes(fichier.type)) {
      setErreurPieceJointe(
        'Format non pris en charge : choisissez une image (JPEG, PNG, WEBP) ou un PDF.',
      );
      setPieceJointe(null);
      evenement.target.value = '';
      return;
    }
    if (fichier.size > TAILLE_MAX_PIECE_JOINTE_OCTETS) {
      setErreurPieceJointe(
        `Fichier trop volumineux (maximum ${Math.floor(TAILLE_MAX_PIECE_JOINTE_OCTETS / (1024 * 1024))} Mo).`,
      );
      setPieceJointe(null);
      evenement.target.value = '';
      return;
    }

    const lecteur = new FileReader();
    lecteur.onload = () => {
      const resultat = lecteur.result;
      if (typeof resultat !== 'string') {
        setErreurPieceJointe('Impossible de lire ce fichier.');
        return;
      }
      setPieceJointe(resultat);
      setErreurPieceJointe(null);
    };
    lecteur.onerror = () => {
      setErreurPieceJointe('Impossible de lire ce fichier.');
    };
    lecteur.readAsDataURL(fichier);
  }

  function modifierLigne<C extends keyof Omit<LigneBrouillon, 'cle'>>(
    cle: string,
    champ: C,
    valeur: LigneBrouillon[C],
  ): void {
    setLignes((precedentes) =>
      precedentes.map((ligne) => (ligne.cle === cle ? { ...ligne, [champ]: valeur } : ligne)),
    );
    setErreursLignes((precedentes) => {
      const ligne = precedentes[cle];
      if (ligne === undefined) return precedentes;
      const suite = { ...ligne };
      delete suite[champ as string];
      return { ...precedentes, [cle]: suite };
    });
  }

  function ajouterLigne(): void {
    const nouvelle = ligneVide();
    cleLigneAFocaliserRef.current = nouvelle.cle;
    setLignes((precedentes) => [...precedentes, nouvelle]);
  }

  useEffect(() => {
    const cle = cleLigneAFocaliserRef.current;
    if (cle === null) return;
    cleLigneAFocaliserRef.current = null;
    const champ = document.getElementsByName(`libelle-${cle}`)[0];
    if (champ instanceof HTMLElement) champ.focus();
  }, [lignes]);

  function retirerLigne(cle: string): void {
    // Lit `lignes` directement (pas un updater fonctionnel) : c'est ce qui
    // permet de calculer la cible de focus AVANT l'écriture, même patron que
    // `SaisieReception.tsx`. Le même `useEffect` que `ajouterLigne` (ci-dessus,
    // sur `[lignes]`) applique ensuite le focus — aucun mécanisme de plus.
    const lignesApres =
      lignes.length <= 1 ? [ligneVide()] : lignes.filter((ligne) => ligne.cle !== cle);
    cleLigneAFocaliserRef.current = cleAFocaliserApresRetraitLigneFacture(lignes, cle, lignesApres);
    setLignes(lignesApres);
  }

  const lignesAvecMontant = lignes
    .map((l) => parserEuros(l.montant))
    .filter((c): c is number => c !== null);
  const totalSaisiCents = lignesAvecMontant.reduce((total, c) => total + c, 0);

  function construireCorps(): Record<string, unknown> | null {
    const erreursDEntete: Record<string, string> = {};
    const erreursDeLignes: Record<string, Record<string, string>> = {};

    if (fournisseurId === '') {
      erreursDEntete['fournisseurId'] = 'Choisissez le fournisseur qui a émis cette facture.';
    }
    if (numeroFournisseur.trim() === '') {
      erreursDEntete['numeroFournisseur'] = 'Indiquez le numéro de facture du fournisseur.';
    }
    if (dateFacture.trim() === '') {
      erreursDEntete['dateFacture'] = 'Indiquez la date de la facture.';
    }

    const lignesCorps: Record<string, unknown>[] = [];

    for (const ligne of lignes) {
      const erreurs: Record<string, string> = {};

      if (ligne.libelle.trim() === '') {
        erreurs['libelle'] = 'Indiquez un libellé pour cette ligne.';
      }

      const montantCents = parserEuros(ligne.montant);
      if (montantCents === null) {
        erreurs['montant'] =
          'Montant illisible. Exemple attendu : 24,90 (ou -24,90 pour une remise).';
      } else if (montantCents === 0) {
        erreurs['montant'] = 'Le montant ne peut pas être nul.';
      }

      let receptionId: string | null = null;
      let ingredientId: string | null = null;

      if (ligne.nature === 'rapprochee') {
        if (ligne.receptionIngredientCle === '') {
          erreurs['receptionIngredientCle'] = 'Choisissez la réception et l’ingrédient concernés.';
        } else {
          const [rec, ing] = ligne.receptionIngredientCle.split('::');
          receptionId = rec ?? null;
          ingredientId = ing ?? null;
        }
      } else if (ligne.nature === 'frais') {
        if (ligne.receptionCle === '') {
          erreurs['receptionCle'] = 'Choisissez la réception concernée par ce frais.';
        } else {
          receptionId = ligne.receptionCle;
        }
        if (montantCents !== null && montantCents <= 0) {
          erreurs['montant'] = 'Un frais de réception doit être strictement positif.';
        }
      }

      if (Object.keys(erreurs).length > 0) {
        erreursDeLignes[ligne.cle] = erreurs;
        continue;
      }
      if (montantCents === null) continue;

      lignesCorps.push({
        libelle: ligne.libelle.trim(),
        montantCents,
        receptionId,
        ingredientId,
        ...(ligne.nature === 'frais'
          ? { methodeRepartitionFrais: ligne.methodeRepartitionFrais }
          : {}),
      });
    }

    if (Object.keys(erreursDEntete).length > 0 || Object.keys(erreursDeLignes).length > 0) {
      setErreursEntete({ champs: erreursDEntete, general: null });
      setErreursLignes(erreursDeLignes);
      // Défaut mesuré (recette clavier du 30/07/2026) : un refus restait où
      // `Ctrl+Entrée` avait été déclenché, jamais sur le champ fautif — même
      // mécanisme que `SaisieReception.tsx` (`focaliserPremierChampFautif`).
      focaliserPremierChampFautif(erreursDEntete, erreursDeLignes);
      return null;
    }

    return {
      numeroFournisseur: numeroFournisseur.trim(),
      fournisseurId,
      dateFacture,
      dateEcheance: dateEcheance.trim() === '' ? null : dateEcheance,
      notes: notes.trim() === '' ? null : notes.trim(),
      fichierScanPath: pieceJointe,
      lignes: lignesCorps,
    };
  }

  /**
   * Focus sur le premier champ fautif (docs/07 §4.7), en-tête d'abord, puis la
   * première ligne qui en porte un — même ordre de priorité que
   * `SaisieReception.tsx`. `NOM_DOM_PAR_CHAMP_ENTETE`/`NOM_DOM_PAR_CHAMP_LIGNE`
   * traduisent une clé d'erreur vers le `name` RÉELLEMENT posé sur le champ
   * quand les deux divergent (voir leur définition ci-dessus).
   */
  function focaliserPremierChampFautif(
    entete: Record<string, string>,
    parLignes: Record<string, Record<string, string>>,
  ): void {
    const premierEntete = Object.keys(entete)[0];
    if (premierEntete !== undefined) {
      const nom = NOM_DOM_PAR_CHAMP_ENTETE[premierEntete] ?? premierEntete;
      formulaireRef.current?.querySelector<HTMLElement>(`[name="${nom}"]`)?.focus();
      return;
    }
    for (const ligne of lignes) {
      const champs = parLignes[ligne.cle];
      const premier = champs === undefined ? undefined : Object.keys(champs)[0];
      if (premier === undefined) continue;
      const prefixe = NOM_DOM_PAR_CHAMP_LIGNE[premier] ?? premier;
      formulaireRef.current
        ?.querySelector<HTMLElement>(`[name="${prefixe}-${ligne.cle}"]`)
        ?.focus();
      return;
    }
  }

  function enregistrer(): void {
    if (envoiEnCours) return;
    const corps = construireCorps();
    if (corps === null) return;

    setErreursEntete(AUCUNE_ERREUR);
    setErreursLignes({});
    setEnvoiEnCours(true);

    requeteApi<unknown>('/factures', { method: 'POST', body: JSON.stringify(corps) })
      .then(() => {
        setEnvoiEnCours(false);
        onEnregistre();
      })
      .catch((erreur: unknown) => {
        setEnvoiEnCours(false);
        const reparties = repartirErreurApi(erreur);
        setErreursEntete(reparties);
        // Même défaut, même correctif, pour un refus qui vient du SERVEUR
        // plutôt que de la validation locale ci-dessus.
        focaliserPremierChampFautif(reparties.champs, {});
      });
  }

  if (referentiel.statut === 'chargement') {
    return (
      <Panneau titre="Nouvelle facture">
        <p className="text-sm text-ink-3">Chargement du référentiel…</p>
      </Panneau>
    );
  }

  if (referentiel.statut === 'erreur') {
    return (
      <Panneau titre="Nouvelle facture">
        <MessageErreur message={referentiel.message} />
      </Panneau>
    );
  }

  if (optionsFournisseurs.length === 0) {
    return (
      <Panneau titre="Nouvelle facture">
        <EtatVide
          variante="premier-lancement"
          titre="Aucun fournisseur actif"
          explication="Une facture se rattache toujours à un fournisseur. Créez-le d'abord dans l'écran Fournisseurs."
        />
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
        if (
          (evenement.ctrlKey || evenement.metaKey) &&
          (evenement.key === 's' || evenement.key === 'Enter')
        ) {
          evenement.preventDefault();
          enregistrer();
          return;
        }
        // Entrée SEULE ne doit jamais soumettre la facture. Sans cette garde,
        // le comportement natif du <form> soumettait (et donc tentait
        // d'enregistrer) dès qu'Entrée était pressée dans N'IMPORTE QUEL champ
        // — y compris au milieu de la saisie d'une ligne — ce qui contredisait
        // le repère affiché plus bas (« Ctrl+Entrée : enregistrer ») et
        // pouvait déclencher un enregistrement prématuré d'une facture
        // incomplète. Entrée se comporte donc comme Tab : elle avance au
        // champ suivant, jamais plus (`Ajouter une ligne` et `Enregistrer`
        // restent atteignables au clavier via ce même Tab, et gardent leur
        // sens natif — clic / soumission — une fois focalisés).
        if (evenement.key !== 'Enter') return;
        const cible = evenement.target;
        if (!(cible instanceof HTMLElement)) return;
        if (cible.tagName === 'TEXTAREA' || cible.tagName === 'BUTTON') return;
        evenement.preventDefault();
        const focalisables = Array.from(
          evenement.currentTarget.querySelectorAll<HTMLElement>(
            'input:not([disabled]), select:not([disabled]), button:not([disabled])',
          ),
        );
        const index = focalisables.indexOf(cible);
        focalisables[index + 1]?.focus();
      }}
    >
      <Panneau titre="Nouvelle facture" sansRembourrage>
        <div className="flex flex-col gap-bloc p-4">
          <div className="grid grid-cols-1 gap-groupe lg:grid-cols-3">
            <ChampSelection
              nom="fournisseurId"
              refChamp={champFournisseur}
              libelle="Fournisseur"
              valeur={fournisseurId}
              onChange={(valeur) => {
                setFournisseurId(valeur);
                setLignes([ligneVide()]);
              }}
              options={optionsFournisseurs}
              optionVide="Choisir…"
              obligatoire
              erreur={erreursEntete.champs['fournisseurId']}
            />
            <ChampSaisie
              nom="numeroFournisseur"
              libelle="N° de facture (fournisseur)"
              valeur={numeroFournisseur}
              onChange={setNumeroFournisseur}
              obligatoire
              erreur={erreursEntete.champs['numeroFournisseur']}
            />
            <ChampSaisie
              nom="dateFacture"
              libelle="Date de la facture"
              type="date"
              valeur={dateFacture}
              onChange={setDateFacture}
              obligatoire
              erreur={erreursEntete.champs['dateFacture']}
            />
          </div>
          <div className="grid grid-cols-1 gap-groupe lg:grid-cols-3">
            <ChampSaisie
              nom="dateEcheance"
              libelle="Échéance (facultatif)"
              type="date"
              valeur={dateEcheance}
              onChange={setDateEcheance}
            />
            <div className="lg:col-span-2">
              <ChampSaisie nom="notes" libelle="Notes" valeur={notes} onChange={setNotes} />
            </div>
          </div>
          <div>
            <label htmlFor="piece-jointe-facture" className="block text-2xs uppercase text-ink-3">
              Pièce jointe (bon de livraison ou facture scannée)
            </label>
            <input
              id="piece-jointe-facture"
              name="piece-jointe-facture"
              type="file"
              accept={TYPES_MIME_PIECE_JOINTE_ACCEPTES.join(',')}
              onChange={surChangementPieceJointe}
              className="mt-1 block w-full text-sm text-ink-2"
            />
            <p className="mt-1 text-xs text-ink-3">
              Rattachée maintenant, pas reconstituée après coup : joignez le scan avant
              d'enregistrer.
            </p>
            {pieceJointe !== null && (
              <p className="mt-1 text-xs text-conforme">Fichier prêt à être joint.</p>
            )}
            {erreurPieceJointe !== null && (
              <div className="mt-1">
                <BandeauErreur message={erreurPieceJointe} />
              </div>
            )}
            {/*
             * Rejet SERVEUR de la pièce jointe (format invalide, ou depuis
             * cette mission, contenu incohérent avec le type déclaré —
             * `validerPieceJointe`, `packages/db/src/services/factures.ts`) :
             * `repartirErreurApi` range ce refus sous
             * `erreursEntete.champs['fichierScanPath']`, jamais sous
             * `erreursEntete.general` (un seul champ en erreur => pas de
             * bandeau global — voir le commentaire de `repartirErreurApi`).
             * SANS cet affichage, un fichier accepté par le contrôle client
             * (qui ne vérifie que l'extension déclarée par le navigateur,
             * jamais le contenu réel) puis refusé par le serveur échouait
             * silencieusement : un clic sur « Enregistrer » qui ne se
             * produisait pas, sans un seul mot à l'écran — exactement le
             * « catch silencieux » que CLAUDE.md §4 interdit.
             */}
            {erreursEntete.champs['fichierScanPath'] !== undefined && (
              <div className="mt-1">
                <BandeauErreur message={erreursEntete.champs['fichierScanPath']} />
              </div>
            )}
          </div>
          {fournisseurId !== '' && erreurReceptionsEligibles !== null && (
            <MessageErreur message={erreurReceptionsEligibles} />
          )}
          {fournisseurId !== '' &&
            erreurReceptionsEligibles === null &&
            receptionsEligibles.length === 0 && (
              <p className="text-xs text-ink-3">
                Aucune réception connue pour ce fournisseur : les lignes ne pourront être que « sans
                lien » (frais divers, service).
              </p>
            )}
        </div>

        <div className="border-t border-line">
          {lignes.map((ligne, index) => (
            <div key={ligne.cle} className="border-b border-line p-4 last:border-b-0">
              <div className="flex items-center justify-between">
                <span className="text-2xs uppercase text-ink-3">Ligne {index + 1}</span>
                <button
                  type="button"
                  onClick={() => retirerLigne(ligne.cle)}
                  className={CLASSE_BOUTON_LIEN}
                >
                  Retirer
                </button>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-groupe lg:grid-cols-4">
                <ChampSaisie
                  nom={`libelle-${ligne.cle}`}
                  libelle="Libellé"
                  valeur={ligne.libelle}
                  onChange={(v) => modifierLigne(ligne.cle, 'libelle', v)}
                  erreur={erreursLignes[ligne.cle]?.['libelle']}
                />
                <ChampSelection
                  nom={`nature-${ligne.cle}`}
                  libelle="Type de ligne"
                  valeur={ligne.nature}
                  onChange={(v) => modifierLigne(ligne.cle, 'nature', v as NatureLigne)}
                  options={[
                    { valeur: 'rapprochee', libelle: 'Rapprochée à une réception' },
                    { valeur: 'frais', libelle: 'Frais de réception (transport, palette…)' },
                    { valeur: 'libre', libelle: 'Sans lien (frais divers, service)' },
                  ]}
                />
                <ChampSaisie
                  nom={`montant-${ligne.cle}`}
                  libelle="Montant (€)"
                  numerique="decimal"
                  valeur={ligne.montant}
                  onChange={(v) => modifierLigne(ligne.cle, 'montant', v)}
                  erreur={erreursLignes[ligne.cle]?.['montant']}
                  aide={
                    ligne.nature === 'libre' ? 'Une remise se saisit avec un signe -.' : undefined
                  }
                />
                {ligne.nature === 'rapprochee' && (
                  <ChampSelection
                    nom={`rapprochement-${ligne.cle}`}
                    libelle="Réception / ingrédient"
                    valeur={ligne.receptionIngredientCle}
                    onChange={(v) => modifierLigne(ligne.cle, 'receptionIngredientCle', v)}
                    options={optionsRapprochement}
                    optionVide="Choisir…"
                    erreur={erreursLignes[ligne.cle]?.['receptionIngredientCle']}
                  />
                )}
                {ligne.nature === 'frais' && (
                  <>
                    <ChampSelection
                      nom={`reception-${ligne.cle}`}
                      libelle="Réception concernée"
                      valeur={ligne.receptionCle}
                      onChange={(v) => modifierLigne(ligne.cle, 'receptionCle', v)}
                      options={optionsReceptions}
                      optionVide="Choisir…"
                      erreur={erreursLignes[ligne.cle]?.['receptionCle']}
                    />
                    <ChampSelection
                      nom={`methode-${ligne.cle}`}
                      libelle="Répartition sur les lots"
                      valeur={ligne.methodeRepartitionFrais}
                      onChange={(v) =>
                        modifierLigne(
                          ligne.cle,
                          'methodeRepartitionFrais',
                          v as 'valeur' | 'quantite',
                        )
                      }
                      options={[
                        { valeur: 'valeur', libelle: 'Au prorata de la valeur des lots' },
                        { valeur: 'quantite', libelle: 'Au prorata de la quantité reçue' },
                      ]}
                    />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-2">
          <button type="button" onClick={ajouterLigne} className={CLASSE_BOUTON_LIEN}>
            Ajouter une ligne
          </button>
          <p className="text-xs text-ink-3">Ctrl+Entrée : enregistrer</p>
        </div>

        <div className="flex items-baseline justify-between border-t border-line-strong bg-surface-sunken px-4 py-2">
          <span className="text-xs text-ink-2">
            {lignes.length} ligne{lignes.length > 1 ? 's' : ''} — à comparer à la facture papier
            avant d'enregistrer.
          </span>
          <span className="text-sm text-ink">
            Total saisi{' '}
            <span className="num font-medium">
              {lignesAvecMontant.length === 0
                ? TIRET_ABSENT
                : `${formaterMontant(totalSaisiCents)} €`}
            </span>
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
            {envoiEnCours ? 'Enregistrement…' : 'Enregistrer la facture'}
          </button>
        </div>
      </Panneau>
    </form>
  );
}
