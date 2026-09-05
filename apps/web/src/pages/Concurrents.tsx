import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formaterDate,
  formaterEcartMontant,
  formaterEuros,
  formaterMontant,
  GLYPHE_STATUT,
  ouTiret,
  parserEuros,
  schemaListeLieux,
  TIRET_ABSENT,
  type LieuMarcheContrat,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { champsEnErreurApresModification } from '../composants/formulaire';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';
import { aujourdHui } from '../lib/dates';
/**
 * `packages/core/src/contrats/concurrents.ts` est un fichier NEUF, hors du
 * barrel `@batte/core` (câblage réservé à l'orchestrateur — voir le rapport de
 * livraison pour la ligne exacte à y ajouter). Import relatif temporaire, même
 * convention que `apps/web/src/pages/Ingredients.tsx` avant son câblage.
 */
import {
  AFFLUENCES_ESTIMEES,
  POSITIONNEMENTS_CONCURRENT,
  schemaComparateur,
  schemaConcurrent,
  schemaConcurrentDetail,
  schemaListeConcurrents,
  TYPES_OFFRE_CONCURRENT,
  type AffluenceEstimee,
  type Comparateur,
  type Concurrent,
  type ConcurrentDetail,
  type PositionnementConcurrent,
  type TypeOffreConcurrent,
} from '@batte/core';

/**
 * Écran Concurrents (fiche `docs/demandes/08-FICHES-CONCURRENTS.md`).
 *
 * Panneau gauche : la liste des concurrents, filtrable par lieu. Panneau
 * droit : la fiche complète du concurrent choisi — formulaire, historique des
 * produits relevés, historique des observations, et deux formulaires de
 * saisie rapide « après une visite » (mêmes conventions que la clôture de
 * session, docs/06).
 *
 * LIMITE ASSUMÉE, affichée en permanence sous le titre : ce module
 * n'alimente PAS le moteur de prévision. Un concurrent est un facteur de
 * RÉPARTITION de la clientèle entre vendeurs, jamais de la demande TOTALE du
 * marché — voir CLAUDE.md « les défauts les plus coûteux sont des silences ».
 *
 * Règle d'architecture n°1 : aucun calcul métier dans ce composant. Le
 * comparateur (moyennes, écart) vient ENTIÈREMENT du serveur
 * (`packages/db/src/depots/concurrents.ts`).
 */

const LIBELLE_TYPE_OFFRE: Readonly<Record<TypeOffreConcurrent, string>> = {
  crepes: 'Crêpes',
  gaufres: 'Gaufres',
  autre_sucre: 'Autre sucré',
  sale: 'Salé',
  mixte: 'Mixte',
};

const LIBELLE_POSITIONNEMENT: Readonly<Record<PositionnementConcurrent, string>> = {
  bas_de_gamme: 'Bas de gamme',
  standard: 'Standard',
  premium: 'Premium',
};

const LIBELLE_AFFLUENCE: Readonly<Record<AffluenceEstimee, string>> = {
  nulle: 'Nulle',
  faible: 'Faible',
  moyenne: 'Moyenne',
  forte: 'Forte',
};

/** `★★★☆☆` — jamais un chiffre nu : la légende qui l'accompagne rappelle que
 * c'est une appréciation subjective, pas une mesure (fiche 08). */
function etoiles(qualite: number): string {
  return '★'.repeat(qualite) + '☆'.repeat(5 - qualite);
}

function parserEntier1a5(saisie: string): number | null {
  const valeur = Number.parseInt(saisie, 10);
  return Number.isInteger(valeur) && valeur >= 1 && valeur <= 5 ? valeur : null;
}

/** Heure locale belge, pour l'indicateur « Enregistré 21:04 » (même convention que Fournisseurs.tsx). */
function heureCourante(): string {
  return new Intl.DateTimeFormat('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(new Date());
}

/**
 * Résout l'écart monétaire signé du comparateur de prix (concurrents − nous).
 *
 * `ecartBp` (calculé côté serveur, `packages/db/src/depots/concurrents.ts`)
 * est `null` EXACTEMENT quand l'un des deux prix moyens est `null` : les deux
 * montants ne sont donc jamais utilisables séparément une fois qu'on sait
 * l'écart connu. Un `?? 0` sur l'un des deux masquerait cette invariance et
 * ferait passer un prix INCONNU pour un prix NUL dans la soustraction —
 * même défaut que celui documenté par `avertissementCoutsManquants`
 * (`packages/core/src/affichage.ts`) pour la marge par lieu.
 */
export function resoudreEcartComparateur(moyenne: Comparateur['moyenne']): string | null {
  const { notrePrixMoyenCrepeCents, concurrentsPrixMoyenCents } = moyenne;
  if (notrePrixMoyenCrepeCents === null || concurrentsPrixMoyenCents === null) return null;
  return formaterEcartMontant(concurrentsPrixMoyenCents - notrePrixMoyenCrepeCents);
}

/**
 * Toutes les occurrences de ce bandeau dans cet écran signalent un
 * aller-retour réseau qui a échoué (chargement ou écriture), jamais une
 * alerte métier au sens du registre `depassement` — voir la même décision
 * dans `Comptabilite.tsx` (mission du 01/08/2026 sur `composants/EncartErreur.tsx`).
 */
function BandeauErreur({ message }: { message: string }) {
  return <MessageErreur message={message} />;
}

/* ═══════════════════════════════════════════════════════════════════════════
   États d'écran
   ═══════════════════════════════════════════════════════════════════════════ */

type EtatListe =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; concurrents: Concurrent[] };

type EtatLieux =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lieux: LieuMarcheContrat[] };

type EtatComparateur =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; comparateur: Comparateur };

type EtatDetail =
  | { statut: 'inactif' }
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; detail: ConcurrentDetail };

type EtatEnregistrement =
  | { phase: 'inchange' }
  | { phase: 'modifie' }
  | { phase: 'enregistrement' }
  | { phase: 'enregistre'; heure: string };

export type Brouillon = {
  nom: string;
  lieuId: string;
  typeOffre: TypeOffreConcurrent;
  positionnement: PositionnementConcurrent;
  emplacementObserve: string;
  qualitePercue: string;
  notesGenerales: string;
};

const BROUILLON_VIDE: Brouillon = {
  nom: '',
  lieuId: '',
  typeOffre: 'crepes',
  positionnement: 'standard',
  emplacementObserve: '',
  qualitePercue: '3',
  notesGenerales: '',
};

function versBrouillon(c: Concurrent): Brouillon {
  return {
    nom: c.nom,
    lieuId: c.lieuId,
    typeOffre: c.typeOffre,
    positionnement: c.positionnement,
    emplacementObserve: c.emplacementObserve ?? '',
    qualitePercue: String(c.qualitePercue),
    notesGenerales: c.notesGenerales ?? '',
  };
}

/**
 * Validation LOCALE du brouillon de fiche, avant tout aller-retour — même
 * patron que `erreursSaisieProduit` (`Produits.tsx`).
 *
 * Extraite en fonction PURE et exportée pour prouver, sans monter tout
 * l'écran, quel champ un lieu non choisi ou une qualité perçue
 * illisible désigne EN PREMIER — c'est ce nom de champ que
 * `focaliserPremierChampFautif` doit atteindre juste après
 * `setChampsEnErreur`, jamais l'un sans l'autre (défaut mesuré le
 * 30/07/2026 : cet appel manquait ici, le focus restait sur le bouton
 * « Enregistrer »).
 */
export function erreursSaisieConcurrent(brouillon: Brouillon): Record<string, string> {
  if (brouillon.lieuId === '') {
    return { lieuId: 'Choisissez le lieu où ce concurrent est observé.' };
  }
  if (parserEntier1a5(brouillon.qualitePercue) === null) {
    return { qualitePercue: 'La qualité perçue est une note entière de 1 à 5.' };
  }
  return {};
}

/* ═══════════════════════════════════════════════════════════════════════════
   Colonnes
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Largeurs revues le 31/07/2026 (TROISIÈME passage — mission « deux restes de
 * la chaîne d'achat »). Les deux passages précédents ne rééquilibraient que
 * les LARGEURS ; celui-ci retire une COLONNE, et voici pourquoi c'était la
 * seule option qui restait.
 *
 * LE CALCUL QUI TRANCHE. Mesuré au clavier (canvas `measureText`, police et
 * rembourrage réels de chaque cellule, panneau à 551,7 px à 1280 px effectifs
 * — deux panneaux côte à côte, docs/07 §4.4) : la largeur MINIMALE pour ne
 * JAMAIS replier une valeur, sur les SIX colonnes d'alors, sommait à ~575 px
 * (Nom 178 + Offre 68 + Position 80 + Qualité 83 + Dernière 95 + Statut 71).
 * **575 px de besoin minimal pour 551,7 px disponibles** : aucune
 * redistribution de pourcentages ne referme cet écart de ~23 px, avant même
 * de compter qu'un nom réel peut dépasser les deux noms de démonstration
 * mesurés ici. C'est exactement le diagnostic de la mission : « aucun
 * rééquilibrage ne le sauve, il faut une décision sur les colonnes
 * elles-mêmes » — vérifié par le calcul, pas seulement observé à l'écran (la
 * colonne « Nom » s'y enroulait au milieu d'un mot, « Bretonn »/« e »,
 * capture à l'appui dans le rapport de livraison).
 *
 * LA COLONNE RETIRÉE : « Dernière visite » (`dateDerniereObservation`).
 * Argument, par élimination — les cinq autres sont chacune un CHAMP du
 * formulaire de fiche (`Brouillon` : nom, lieu, type d'offre, positionnement,
 * qualité perçue) donc dupliquées à dessein entre liste et fiche ; seule
 * « Dernière visite » n'est PAS un champ éditable, c'est une lecture SEULE,
 * dérivée de l'historique. Or ce même historique est déjà entièrement
 * consultable, à date exacte, dans le panneau « Observations (historique
 * complet) » de la fiche du concurrent sélectionné (plus bas dans ce
 * fichier) — MÊME précédent que `nbConditionnements` sur `Fournisseurs.tsx`
 * (« passé dans la fiche de droite, où il a la place d'être lisible »).
 * Aucune donnée perdue : seulement relocalisée là où elle a la place d'être
 * lisible. Aucun tri de la liste ne dépend de cette colonne (`visibles`
 * ci-dessous ne trie que sur `actif`) : rien d'autre n'y était accroché.
 *
 * LES CINQ LARGEURS RESTANTES, PAR BESOIN RÉEL (mesuré, pas estimé) :
 *  - Nom 37 % (204 px) : la colonne IDENTIFIANTE, `repli` jamais l'ellipse
 *    (docs/07 §4.5) — l'ex-besoin de 178 px, plus une marge pour un nom réel
 *    plus long que les deux de démonstration ;
 *  - Offre 13 % (72 px, inchangé) : suffit à 4 des 5 valeurs sur une ligne ;
 *    seule « Autre sucré » (94 px requis) replie sur son espace interne — déjà
 *    le cas avant ce correctif, `repli` fait exactement ce pour quoi il existe
 *    sur une valeur à deux mots ;
 *  - Position 20 % (110 px, inchangé) : couvre « Standard »/« Premium » sur
 *    une ligne, « Bas de gamme » (113 px) replie de 3 px sur son espace
 *    interne — statu quo, non aggravé par ce correctif ;
 *  - Qualité 16 % (88 px) : les cinq glyphes `etoiles()` ont une largeur FIXE
 *    (83 px, quelle que soit la note) — jamais de variation possible, marge
 *    de 5 px suffisante et garantie ;
 *  - Statut 14 % (77 px) : couvre « ● Actif » (66 px) et « Inactif » (64 px),
 *    les deux SEULES valeurs possibles — marge de 11 px, quasi identique à la
 *    marge d'avant ce correctif (11,8 px), donc pas de risque nouveau.
 *
 * `libelleLong` reste posé sur Position/Qualité (`Tableau.tsx`, infobulle
 * d'en-tête) : l'abréviation du libellé n'a pas changé, seule la largeur de
 * la colonne bouge.
 */
const COLONNES_LISTE: ReadonlyArray<ColonneTableau<Concurrent>> = [
  {
    cle: 'nom',
    libelle: 'Nom',
    largeur: '37%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (c) => c.nom,
  },
  {
    cle: 'type',
    libelle: 'Offre',
    largeur: '13%',
    alignement: 'texte',
    // `repli` : « Autre sucré » (la valeur la plus longue) se coupait en
    // « Cr… » une fois la colonne resserrée pour le reste du tableau — vérifié
    // à l'écran le 31/07/2026, corrigé avant de passer au suivant.
    troncature: 'repli',
    rendu: (c) => LIBELLE_TYPE_OFFRE[c.typeOffre],
  },
  {
    cle: 'positionnement',
    libelle: 'Position',
    libelleLong: 'Positionnement',
    largeur: '20%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (c) => LIBELLE_POSITIONNEMENT[c.positionnement],
  },
  {
    cle: 'qualite',
    libelle: 'Qualité',
    libelleLong: 'Qualité perçue',
    largeur: '16%',
    alignement: 'texte',
    // `repli` : les glyphes ★/☆ sont plus larges qu'une lettre latine — les 5
    // caractères d'`etoiles()` se coupaient quand même (« ★★★… », vérifié à
    // l'écran le 31/07/2026). Perdre une étoile en silence change la note
    // affichée, exactement comme un chiffre tronqué.
    troncature: 'repli',
    rendu: (c) => etoiles(c.qualitePercue),
    titre: () => 'Appréciation subjective, pas une mesure.',
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    largeur: '14%',
    alignement: 'texte',
    // Vocabulaire de statut UNIFIÉ (recette au navigateur du 31/07/2026) :
    // la couleur seule ne portait pas le signal (daltonisme, export PDF noir
    // et blanc, docs/06) — même famille de défaut que `statutFournisseur`
    // (`Fournisseurs.tsx`), même remède : un glyphe double le mot pour
    // « Actif », « Inactif » reste NEUTRE (fin de suivi normale, pas une
    // alerte), même traitement que dans `Fournisseurs.tsx`.
    rendu: (c) => (
      <span className={c.actif ? 'text-conforme' : 'text-ink-3'}>
        {c.actif ? `${GLYPHE_STATUT.conforme} Actif` : 'Inactif'}
      </span>
    ),
  },
];

const COLONNES_NOTRE_CARTE: ReadonlyArray<
  ColonneTableau<{ produitVenteId: string; nom: string; nature: string; prixCents: number }>
> = [
  {
    cle: 'nom',
    libelle: 'Notre produit',
    largeur: '60%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (p) => p.nom,
  },
  {
    cle: 'prix',
    libelle: 'Prix (€)',
    largeur: '40%',
    alignement: 'nombre',
    rendu: (p) => formaterMontant(p.prixCents),
  },
];

/**
 * Largeurs revues le 31/07/2026 (troisième passage — recette au navigateur,
 * docs/25-RECETTE-APRES-CAMPAGNE.md §5) : la colonne « Relevé le » mesurait
 * 92,4 px et la date `JJ/MM/AAAA` (66,2 px de texte) passait à la ligne
 * (rangées à 46,8 et 64,8 px au lieu de 32) — exactement le défaut que
 * `troncature: 'repli'` doit prévenir (ne jamais PERDRE la date), mais qui
 * réclame en échange une largeur qui lui évite de se replier pour rien : une
 * date au format fixe ne devrait jamais avoir besoin de passer à la ligne.
 * Reprise sur les cinq colonnes plutôt que sur la seule colonne fautive :
 * `positionnement` gardait une large marge (son texte le plus long,
 * « Standard », n'utilisait qu'environ 75 px sur les 127 alloués) que
 * `concurrent`/`produit` réclamaient déjà pour ne plus s'enrouler sur
 * plusieurs lignes eux non plus (mesuré : « [démo] Crêperie du Quai » sur 3
 * lignes, « [démo] Galette sarrasin jambon-fromage » sur 3 lignes).
 *
 * `COLONNES_LISTE` ci-dessus porte le MÊME défaut sur sa colonne « Nom »
 * (rangées mesurées à 64,8/82,8 px, un nom coupé au milieu d'un mot :
 * « Bretonn »/« e ») — non repris ici : ce tableau-là n'a, lui, plus aucune
 * marge nulle part (chaque en-tête restant est déjà exactement à sa largeur
 * minimale, `Position`/`Qualité`/`Dernière`/`Statut` compris), donc l'élargir
 * exigerait de retirer ou fusionner une colonne, la même décision que celle
 * prise sur `Opportunites.tsx` (« Où aller ? ») — hors du périmètre nommé de
 * cette mission pour cet écran-ci. Signalé, pas corrigé : voir le rapport.
 */
const COLONNES_PRIX_CONCURRENTS: ReadonlyArray<
  ColonneTableau<{
    concurrentId: string;
    concurrentNom: string;
    positionnement: PositionnementConcurrent;
    nomProduit: string;
    prixCents: number;
    dateObservation: string;
  }>
> = [
  {
    cle: 'concurrent',
    libelle: 'Concurrent',
    largeur: '25%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (p) => p.concurrentNom,
  },
  {
    cle: 'produit',
    libelle: 'Produit',
    largeur: '27%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (p) => p.nomProduit,
  },
  {
    // Abrégé en « Position » (`libelleLong` porte le mot entier), même
    // convention que la colonne homonyme de `COLONNES_LISTE` ci-dessus : à
    // 14 % l'en-tête complet « Positionnement » (123 px requis) débordait de
    // lui-même (81 px alloués), trouvé en re-mesurant après le premier
    // correctif de cette colonne (31/07/2026).
    cle: 'positionnement',
    libelle: 'Position',
    libelleLong: 'Positionnement',
    largeur: '14%',
    alignement: 'texte',
    // `repli` : « Standard », « Premium »… se coupaient en « Stan… », « Prem… »
    // (audit visuel du 31/07/2026) — un mot-catégorie coupé n'est pas un mot
    // différent le temps qu'on hésite, mais autant ne jamais le couper.
    troncature: 'repli',
    rendu: (p) => LIBELLE_POSITIONNEMENT[p.positionnement],
  },
  {
    cle: 'prix',
    libelle: 'Prix (€)',
    largeur: '16%',
    alignement: 'nombre',
    rendu: (p) => formaterMontant(p.prixCents),
  },
  {
    cle: 'date',
    libelle: 'Relevé le',
    largeur: '18%',
    alignement: 'texte',
    // `repli` : une date coupée (« 2… ») est un identifiant qualitatif détruit,
    // même gravité qu'un numéro de lot coupé (docs/07 §4.5) — jamais l'ellipse.
    // Mais `repli` protège la VALEUR, pas la MISE EN PAGE : à 16 % cette même
    // colonne repliait quand même « 24/07/2026 » faute de place (voir le
    // commentaire au-dessus du tableau). 18 % loge le texte (66,2 px) sans
    // recourir au repli dans l'usage normal.
    troncature: 'repli',
    rendu: (p) => formaterDate(p.dateObservation),
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   Composant
   ═══════════════════════════════════════════════════════════════════════════ */

export default function Concurrents() {
  const [lieuFiltre, setLieuFiltre] = useState('');
  const [afficherInactifs, setAfficherInactifs] = useState(false);

  const [etatListe, setEtatListe] = useState<EtatListe>({ statut: 'chargement' });
  const [etatLieux, setEtatLieux] = useState<EtatLieux>({ statut: 'chargement' });
  const [etatComparateur, setEtatComparateur] = useState<EtatComparateur>({ statut: 'chargement' });

  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [etatDetail, setEtatDetail] = useState<EtatDetail>({ statut: 'inactif' });

  const [brouillon, setBrouillon] = useState<Brouillon>(BROUILLON_VIDE);
  const [champsEnErreur, setChampsEnErreur] = useState<Record<string, string>>({});
  const [erreurFormulaire, setErreurFormulaire] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState<EtatEnregistrement>({ phase: 'inchange' });

  const [produitNom, setProduitNom] = useState('');
  const [produitPrix, setProduitPrix] = useState('');
  const [produitDescription, setProduitDescription] = useState('');
  const [produitDate, setProduitDate] = useState(aujourdHui);
  const [etatAjoutProduit, setEtatAjoutProduit] = useState<EtatEnregistrement>({
    phase: 'inchange',
  });

  const [observationDate, setObservationDate] = useState(aujourdHui);
  const [observationAffluence, setObservationAffluence] = useState<AffluenceEstimee>('moyenne');
  const [observationFileAttente, setObservationFileAttente] = useState(false);
  const [observationNotes, setObservationNotes] = useState('');
  const [etatAjoutObservation, setEtatAjoutObservation] = useState<EtatEnregistrement>({
    phase: 'inchange',
  });

  const formulaireRef = useRef<HTMLFormElement>(null);

  /* ─── Chargements ────────────────────────────────────────────────────────── */

  const chargerListe = useCallback((): void => {
    setEtatListe({ statut: 'chargement' });
    requeteApi<unknown>(`/concurrents${lieuFiltre === '' ? '' : `?lieuId=${lieuFiltre}`}`)
      .then((reponse) =>
        setEtatListe({ statut: 'pret', concurrents: schemaListeConcurrents.parse(reponse).data }),
      )
      .catch((erreur: unknown) => {
        setEtatListe({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Erreur inattendue, sans plus de détail.',
        });
      });
  }, [lieuFiltre]);

  const chargerComparateur = useCallback((): void => {
    setEtatComparateur({ statut: 'chargement' });
    requeteApi<unknown>(
      `/concurrents/comparateur${lieuFiltre === '' ? '' : `?lieuId=${lieuFiltre}`}`,
    )
      .then((reponse) =>
        setEtatComparateur({ statut: 'pret', comparateur: schemaComparateur.parse(reponse) }),
      )
      .catch((erreur: unknown) => {
        setEtatComparateur({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Erreur inattendue, sans plus de détail.',
        });
      });
  }, [lieuFiltre]);

  const chargerLieux = useCallback((): void => {
    setEtatLieux({ statut: 'chargement' });
    requeteApi<unknown>('/lieux')
      .then((reponse) =>
        setEtatLieux({ statut: 'pret', lieux: schemaListeLieux.parse(reponse).data }),
      )
      .catch((erreur: unknown) => {
        setEtatLieux({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Erreur inattendue, sans plus de détail.',
        });
      });
  }, []);

  const chargerDetail = useCallback((id: string): void => {
    setEtatDetail({ statut: 'chargement' });
    requeteApi<unknown>(`/concurrents/${id}`)
      .then((reponse) =>
        setEtatDetail({ statut: 'pret', detail: schemaConcurrentDetail.parse(reponse) }),
      )
      .catch((erreur: unknown) => {
        setEtatDetail({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Erreur inattendue, sans plus de détail.',
        });
      });
  }, []);

  useEffect(chargerListe, [chargerListe]);
  useEffect(chargerComparateur, [chargerComparateur]);
  useEffect(chargerLieux, [chargerLieux]);

  const concurrents = useMemo(
    () => (etatListe.statut === 'pret' ? etatListe.concurrents : []),
    [etatListe],
  );
  const visibles = useMemo(
    () => (afficherInactifs ? concurrents : concurrents.filter((c) => c.actif)),
    [concurrents, afficherInactifs],
  );

  /* ─── Sélection et formulaire de fiche ───────────────────────────────────── */

  function choisir(c: Concurrent): void {
    setSelectionId(c.id);
    setBrouillon(versBrouillon(c));
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement({ phase: 'inchange' });
    reinitialiserFormulaireProduit();
    reinitialiserFormulaireObservation();
    chargerDetail(c.id);
  }

  function nouveau(): void {
    setSelectionId(null);
    setEtatDetail({ statut: 'inactif' });
    setBrouillon(BROUILLON_VIDE);
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement({ phase: 'inchange' });
    window.setTimeout(() => formulaireRef.current?.querySelector('input')?.focus(), 0);
  }

  function modifierChamp<C extends keyof Brouillon>(champ: C, valeur: Brouillon[C]): void {
    setBrouillon((precedent) => ({ ...precedent, [champ]: valeur }));
    setEnregistrement({ phase: 'modifie' });
    // Validation À LA SAUVEGARDE, jamais en direct — voir
    // `champsEnErreurApresModification` (`../composants/formulaire`) pour la
    // justification complète, partagée avec Ingrédients, Produits et Lieux de
    // marché.
    setChampsEnErreur(champsEnErreurApresModification);
  }

  function focaliserPremierChampFautif(champs: Record<string, string>): void {
    const premier = Object.keys(champs)[0];
    if (premier === undefined) return;
    formulaireRef.current?.querySelector<HTMLElement>(`[name="${premier}"]`)?.focus();
  }

  function corpsFicheDepuisBrouillon(): Record<string, unknown> | null {
    const erreurs = erreursSaisieConcurrent(brouillon);
    if (Object.keys(erreurs).length > 0) {
      setChampsEnErreur(erreurs);
      focaliserPremierChampFautif(erreurs);
      return null;
    }
    // `erreursSaisieConcurrent` vient de vérifier que la qualité perçue est
    // lisible : ne recalcule aucune erreur, redérive seulement la même valeur
    // (même patron que `corpsSaisieProduit`, `Produits.tsx`).
    return {
      nom: brouillon.nom,
      lieuId: brouillon.lieuId,
      typeOffre: brouillon.typeOffre,
      positionnement: brouillon.positionnement,
      emplacementObserve: brouillon.emplacementObserve,
      qualitePercue: parserEntier1a5(brouillon.qualitePercue),
      notesGenerales: brouillon.notesGenerales,
    };
  }

  function enregistrerFiche(): void {
    const corps = corpsFicheDepuisBrouillon();
    if (corps === null) return;

    setErreurFormulaire(null);
    setEnregistrement({ phase: 'enregistrement' });

    const chemin = selectionId === null ? '/concurrents' : `/concurrents/${selectionId}`;
    const methode = selectionId === null ? 'POST' : 'PATCH';

    requeteApi<unknown>(chemin, { method: methode, body: JSON.stringify(corps) })
      .then((reponse) => {
        const enregistre = schemaConcurrent.parse(reponse);
        chargerListe();
        chargerComparateur();
        setSelectionId(enregistre.id);
        setBrouillon(versBrouillon(enregistre));
        setEnregistrement({ phase: 'enregistre', heure: heureCourante() });
        chargerDetail(enregistre.id);
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
    if (etatDetail.statut !== 'pret') return;
    const cible = !etatDetail.detail.actif;
    requeteApi<unknown>(`/concurrents/${etatDetail.detail.id}/activite`, {
      method: 'PATCH',
      body: JSON.stringify({ actif: cible }),
    })
      .then((reponse) => {
        const modifie = schemaConcurrent.parse(reponse);
        chargerListe();
        setBrouillon(versBrouillon(modifie));
        chargerDetail(modifie.id);
      })
      .catch((erreur: unknown) => {
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  /* ─── Saisie rapide : produit observé ────────────────────────────────────── */

  function reinitialiserFormulaireProduit(): void {
    setProduitNom('');
    setProduitPrix('');
    setProduitDescription('');
    setProduitDate(aujourdHui());
    setEtatAjoutProduit({ phase: 'inchange' });
  }

  function ajouterProduit(): void {
    if (selectionId === null) return;
    if (produitNom.trim() === '') {
      setEtatAjoutProduit({ phase: 'modifie' });
      setErreurFormulaire('Indiquez le nom du produit observé.');
      return;
    }
    const prix = parserEuros(produitPrix);
    if (prix === null || prix < 0) {
      setErreurFormulaire('Le prix relevé doit être un montant valide.');
      return;
    }
    setErreurFormulaire(null);
    setEtatAjoutProduit({ phase: 'enregistrement' });

    requeteApi<unknown>(`/concurrents/${selectionId}/produits`, {
      method: 'POST',
      body: JSON.stringify({
        nomProduit: produitNom.trim(),
        prixCents: prix,
        description: produitDescription.trim() === '' ? null : produitDescription.trim(),
        dateObservation: produitDate,
      }),
    })
      .then(() => {
        reinitialiserFormulaireProduit();
        setEtatAjoutProduit({ phase: 'enregistre', heure: heureCourante() });
        chargerDetail(selectionId);
        chargerListe();
        chargerComparateur();
      })
      .catch((erreur: unknown) => {
        setEtatAjoutProduit({ phase: 'modifie' });
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  /* ─── Saisie rapide : observation qualitative ────────────────────────────── */

  function reinitialiserFormulaireObservation(): void {
    setObservationDate(aujourdHui());
    setObservationAffluence('moyenne');
    setObservationFileAttente(false);
    setObservationNotes('');
    setEtatAjoutObservation({ phase: 'inchange' });
  }

  function ajouterObservation(): void {
    if (selectionId === null) return;
    if (observationNotes.trim() === '') {
      setErreurFormulaire('Décrivez ce que vous avez observé : c’est le cœur de la visite.');
      return;
    }
    setErreurFormulaire(null);
    setEtatAjoutObservation({ phase: 'enregistrement' });

    requeteApi<unknown>(`/concurrents/${selectionId}/observations`, {
      method: 'POST',
      body: JSON.stringify({
        dateObservation: observationDate,
        affluenceEstimee: observationAffluence,
        fileAttente: observationFileAttente,
        notes: observationNotes.trim(),
      }),
    })
      .then(() => {
        reinitialiserFormulaireObservation();
        setEtatAjoutObservation({ phase: 'enregistre', heure: heureCourante() });
        chargerDetail(selectionId);
        chargerListe();
      })
      .catch((erreur: unknown) => {
        setEtatAjoutObservation({ phase: 'modifie' });
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  /* ─── Rendu ───────────────────────────────────────────────────────────────── */

  const comparateur = etatComparateur.statut === 'pret' ? etatComparateur.comparateur : null;
  const ecart = comparateur?.moyenne.ecartBp ?? null;

  return (
    <div
      className="flex flex-col gap-bloc"
      onKeyDown={(evenement) => {
        if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === 's') {
          evenement.preventDefault();
          enregistrerFiche();
        }
      }}
    >
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Concurrents</h1>
        <button
          type="button"
          onClick={nouveau}
          className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Nouveau concurrent
        </button>
      </div>

      {/* ═══ Limite assumée — écrite ici, pas seulement dans le code ═══════ */}
      <div className="border-l-2 border-line-strong bg-surface-sunken px-3 py-2 text-xs text-ink-2">
        Ce module ne modifie pas la prévision de production : un concurrent influence la{' '}
        <strong>répartition</strong> de la clientèle entre vendeurs à La Batte, pas la demande{' '}
        <strong>totale</strong> du marché. Aucun chiffre de cet écran n'entre dans le calcul de la
        prochaine session.
      </div>

      {/* ═══ Comparateur — le seul écran du module qui change une décision ═ */}
      <Panneau titre="Comparateur de prix">
        {etatComparateur.statut === 'chargement' && (
          <p className="text-sm text-ink-3">Calcul en cours…</p>
        )}
        {etatComparateur.statut === 'erreur' && <BandeauErreur message={etatComparateur.message} />}
        {comparateur !== null && (
          <div className="flex flex-col gap-bloc">
            <div className="flex flex-wrap items-end gap-section">
              <div>
                <p className="text-2xs uppercase text-ink-3">Moyenne de nos crêpes</p>
                <p className="num text-left text-2xl text-ink">
                  {ouTiret(comparateur.moyenne.notrePrixMoyenCrepeCents, formaterEuros)}
                </p>
              </div>
              <div>
                <p className="text-2xs uppercase text-ink-3">
                  Moyenne des concurrents équivalents (
                  {comparateur.moyenne.nbConcurrentsEquivalents})
                </p>
                <p className="num text-left text-2xl text-ink">
                  {ouTiret(comparateur.moyenne.concurrentsPrixMoyenCents, formaterEuros)}
                </p>
              </div>
              <div>
                <p className="text-2xs uppercase text-ink-3">Écart</p>
                <p
                  className={`num text-left text-2xl ${
                    ecart === null ? 'text-ink-3' : ecart < 0 ? 'text-alerte' : 'text-conforme'
                  }`}
                >
                  {ecart === null
                    ? TIRET_ABSENT
                    : (resoudreEcartComparateur(comparateur.moyenne) ?? TIRET_ABSENT)}
                </p>
                <p className="text-xs text-ink-3">
                  {ecart === null
                    ? 'Comparaison indisponible : il manque un prix de notre côté ou chez les concurrents équivalents.'
                    : ecart < 0
                      ? 'Nous sommes plus chers que la moyenne des concurrents équivalents.'
                      : 'Nous sommes moins chers que, ou alignés sur, la moyenne des concurrents équivalents.'}
                </p>
              </div>
            </div>

            {/* `minmax(0,2fr)_minmax(0,3fr)` et non un 50/50 (audit visuel du
                31/07/2026) : « Notre carte » n'a que 2 colonnes, « Derniers prix
                relevés » en a 5 — un partage égal donnait a ce second tableau
                une largeur bien insuffisante (CONCURR…, POSI…, PR…, R…) alors
                que le premier restait a l'aise avec bien moins. La largeur
                allouee etait en cause, pas l'ecran (voir docs/23-AUDIT-VISUEL
                §2.1). */}
            <div className="grid grid-cols-1 gap-bloc lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div>
                <h3 className="mb-1 text-2xs uppercase text-ink-3">
                  Notre carte (produits actifs)
                </h3>
                <Tableau
                  colonnes={COLONNES_NOTRE_CARTE}
                  lignes={comparateur.notreCarte}
                  cleLigne={(p) => p.produitVenteId}
                  etatVide={<EtatVide variante="normal" texte="Aucun produit actif en carte." />}
                />
              </div>
              <div>
                <h3 className="mb-1 text-2xs uppercase text-ink-3">
                  Derniers prix relevés chez les concurrents équivalents (offre crêpes ou mixte)
                </h3>
                <Tableau
                  colonnes={COLONNES_PRIX_CONCURRENTS}
                  lignes={comparateur.dernierPrixConcurrents}
                  cleLigne={(p) => `${p.concurrentId}-${p.nomProduit}`}
                  etatVide={
                    <EtatVide
                      variante="normal"
                      texte="Aucun prix relevé chez un concurrent équivalent pour l'instant."
                    />
                  }
                />
              </div>
            </div>
          </div>
        )}
      </Panneau>

      {/* ═══ Liste + fiche ══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 items-start gap-bloc lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        {/* ─── Liste ────────────────────────────────────────────────────────── */}
        <Panneau titre="Liste des concurrents" sansRembourrage>
          <div className="flex flex-wrap items-center justify-between gap-groupe border-b border-line px-4 py-2">
            <label
              className="flex items-center gap-groupe text-sm text-ink-2"
              htmlFor="filtre-lieu"
            >
              Lieu
              <select
                id="filtre-lieu"
                className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                value={lieuFiltre}
                onChange={(e) => setLieuFiltre(e.target.value)}
              >
                <option value="">Tous les lieux</option>
                {etatLieux.statut === 'pret' &&
                  etatLieux.lieux.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nom}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex items-center gap-groupe text-sm text-ink-2">
              <input
                type="checkbox"
                checked={afficherInactifs}
                onChange={(e) => setAfficherInactifs(e.target.checked)}
              />
              Afficher aussi les concurrents désactivés
            </label>
          </div>

          {etatListe.statut === 'chargement' && (
            <p className="px-4 py-2 text-sm text-ink-3">Chargement des concurrents…</p>
          )}
          {etatListe.statut === 'erreur' && <BandeauErreur message={etatListe.message} />}
          {etatListe.statut === 'pret' && (
            <Tableau
              colonnes={COLONNES_LISTE}
              lignes={visibles}
              cleLigne={(c) => c.id}
              total={concurrents.length}
              libelleEntite="concurrents"
              {...(selectionId !== null ? { ligneSelectionneeCle: selectionId } : {})}
              onSelectionnerLigne={choisir}
              etatVide={
                concurrents.length > 0 ? (
                  <EtatVide
                    variante="filtre"
                    explicationFiltre={`Tous les concurrents enregistrés (${concurrents.length}) sont désactivés et masqués par le filtre.`}
                    onReinitialiser={() => setAfficherInactifs(true)}
                  />
                ) : (
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucun concurrent enregistré"
                    explication="Créez une fiche pour chaque vendeur concurrent observé sur un marché — les deux vendeurs de crêpes déjà repérés à La Batte en sont le premier exemple."
                    action={{ libelle: 'Créer un concurrent', onClick: nouveau }}
                  />
                )
              }
            />
          )}
        </Panneau>

        {/* ─── Fiche ────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-bloc">
          <Panneau
            titre={selectionId === null ? 'Nouveau concurrent' : brouillon.nom || 'Concurrent'}
          >
            <form
              ref={formulaireRef}
              className="flex flex-col gap-bloc"
              onSubmit={(e) => {
                e.preventDefault();
                enregistrerFiche();
              }}
            >
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="concurrent-nom"
              >
                Nom
                <input
                  id="concurrent-nom"
                  name="nom"
                  type="text"
                  required
                  className={`h-controle rounded-sm border bg-surface px-2 text-base text-ink ${
                    champsEnErreur['nom'] === undefined ? 'border-line-field' : 'border-depassement'
                  }`}
                  value={brouillon.nom}
                  onChange={(e) => modifierChamp('nom', e.target.value)}
                />
              </label>

              <div className="grid grid-cols-2 gap-groupe">
                <label
                  className="flex flex-col gap-groupe text-sm text-ink-2"
                  htmlFor="concurrent-lieu"
                >
                  Lieu
                  <select
                    id="concurrent-lieu"
                    name="lieuId"
                    className={`h-controle rounded-sm border bg-surface px-2 text-sm text-ink ${
                      champsEnErreur['lieuId'] === undefined
                        ? 'border-line-field'
                        : 'border-depassement'
                    }`}
                    value={brouillon.lieuId}
                    onChange={(e) => modifierChamp('lieuId', e.target.value)}
                  >
                    <option value="">— Choisir —</option>
                    {etatLieux.statut === 'pret' &&
                      etatLieux.lieux.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nom}
                        </option>
                      ))}
                  </select>
                  {champsEnErreur['lieuId'] !== undefined && (
                    <span className="text-xs text-depassement">{champsEnErreur['lieuId']}</span>
                  )}
                </label>
                <label
                  className="flex flex-col gap-groupe text-sm text-ink-2"
                  htmlFor="concurrent-qualite"
                >
                  Qualité perçue (1 à 5, subjective)
                  <select
                    id="concurrent-qualite"
                    name="qualitePercue"
                    className={`h-controle rounded-sm border bg-surface px-2 text-sm text-ink ${
                      champsEnErreur['qualitePercue'] === undefined
                        ? 'border-line-field'
                        : 'border-depassement'
                    }`}
                    value={brouillon.qualitePercue}
                    onChange={(e) => modifierChamp('qualitePercue', e.target.value)}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {etoiles(n)} ({n}/5)
                      </option>
                    ))}
                  </select>
                  {champsEnErreur['qualitePercue'] !== undefined && (
                    <span className="text-xs text-depassement">
                      {champsEnErreur['qualitePercue']}
                    </span>
                  )}
                </label>
              </div>

              <div className="grid grid-cols-2 gap-groupe">
                <label
                  className="flex flex-col gap-groupe text-sm text-ink-2"
                  htmlFor="concurrent-offre"
                >
                  Type d'offre
                  <select
                    id="concurrent-offre"
                    className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                    value={brouillon.typeOffre}
                    onChange={(e) =>
                      modifierChamp('typeOffre', e.target.value as TypeOffreConcurrent)
                    }
                  >
                    {TYPES_OFFRE_CONCURRENT.map((t) => (
                      <option key={t} value={t}>
                        {LIBELLE_TYPE_OFFRE[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className="flex flex-col gap-groupe text-sm text-ink-2"
                  htmlFor="concurrent-positionnement"
                >
                  Positionnement
                  <select
                    id="concurrent-positionnement"
                    className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                    value={brouillon.positionnement}
                    onChange={(e) =>
                      modifierChamp('positionnement', e.target.value as PositionnementConcurrent)
                    }
                  >
                    {POSITIONNEMENTS_CONCURRENT.map((p) => (
                      <option key={p} value={p}>
                        {LIBELLE_POSITIONNEMENT[p]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="concurrent-emplacement"
              >
                Emplacement observé
                <input
                  id="concurrent-emplacement"
                  type="text"
                  className="h-controle rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={brouillon.emplacementObserve}
                  onChange={(e) => modifierChamp('emplacementObserve', e.target.value)}
                />
              </label>

              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="concurrent-notes"
              >
                Notes générales
                <input
                  id="concurrent-notes"
                  type="text"
                  className="h-controle rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={brouillon.notesGenerales}
                  onChange={(e) => modifierChamp('notesGenerales', e.target.value)}
                />
              </label>

              {erreurFormulaire !== null && <BandeauErreur message={erreurFormulaire} />}

              <div className="flex items-center justify-between border-t border-line pt-3">
                <IndicateurEnregistrement etat={enregistrement} />
                <div className="flex items-center gap-groupe">
                  {etatDetail.statut === 'pret' && (
                    <button
                      type="button"
                      onClick={basculerActivite}
                      className="h-controle rounded-sm border border-line-field bg-surface px-3 text-sm font-medium text-ink-2 hover:bg-surface-sunken"
                    >
                      {etatDetail.detail.actif ? 'Désactiver' : 'Réactiver'}
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
              {etatDetail.statut === 'pret' && !etatDetail.detail.actif && (
                <p className="text-xs text-ink-3">
                  Un concurrent ne se supprime pas : désactivé, il disparaît des comparateurs mais
                  son historique de prix reste lisible.
                </p>
              )}
            </form>
          </Panneau>

          {selectionId !== null && (
            <>
              {/* ═══ Historique des produits relevés ═══════════════════════ */}
              <Panneau titre="Produits relevés (historique complet)" sansRembourrage>
                {etatDetail.statut === 'chargement' && (
                  <p className="px-4 py-2 text-sm text-ink-3">Chargement…</p>
                )}
                {etatDetail.statut === 'erreur' && <BandeauErreur message={etatDetail.message} />}
                {etatDetail.statut === 'pret' && (
                  <Tableau
                    // Largeurs revues le 31/07/2026 (recette au navigateur,
                    // docs/25-RECETTE-APRES-CAMPAGNE.md §5) : ce panneau ne
                    // fait que ~441 px (colonne de droite de la fiche), et
                    // « Relevé le » (94,2 px requis) y repliait la date sur
                    // deux lignes à 18 % (79,4 px) — même défaut que
                    // `COLONNES_PRIX_CONCURRENTS` ci-dessus. 22 % la loge sur
                    // une seule ligne ; les 4 points cédés viennent de
                    // `Produit`, dont l'EN-TÊTE (48,6 px) n'a besoin que d'une
                    // fraction de ses 36 % — les noms de produit gardent
                    // `repli`, ils replient un peu plus souvent, jamais ne
                    // perdent de texte.
                    colonnes={[
                      {
                        cle: 'date',
                        libelle: 'Relevé le',
                        largeur: '22%',
                        alignement: 'texte',
                        troncature: 'repli',
                        rendu: (p) => formaterDate(p.dateObservation),
                      },
                      {
                        cle: 'nom',
                        libelle: 'Produit',
                        largeur: '32%',
                        alignement: 'texte',
                        troncature: 'repli',
                        rendu: (p) => p.nomProduit,
                      },
                      {
                        cle: 'prix',
                        libelle: 'Prix (€)',
                        largeur: '18%',
                        alignement: 'nombre',
                        rendu: (p) => formaterMontant(p.prixCents),
                      },
                      {
                        cle: 'description',
                        libelle: 'Description',
                        largeur: '28%',
                        alignement: 'texte',
                        troncature: 'repli',
                        rendu: (p) => p.description ?? TIRET_ABSENT,
                      },
                    ]}
                    lignes={etatDetail.detail.produits}
                    cleLigne={(p) => p.id}
                    etatVide={
                      <EtatVide
                        variante="normal"
                        texte="Aucun produit relevé pour ce concurrent pour l'instant."
                      />
                    }
                  />
                )}

                <form
                  className="border-t border-line px-4 py-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    ajouterProduit();
                  }}
                >
                  <p className="mb-2 text-xs text-ink-3">Ajouter un produit observé</p>
                  <div className="flex flex-wrap items-end gap-groupe">
                    <label
                      className="flex flex-col gap-groupe text-sm text-ink-2"
                      htmlFor="produit-nom"
                    >
                      Nom du produit
                      <input
                        id="produit-nom"
                        type="text"
                        className="h-controle w-48 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                        value={produitNom}
                        onChange={(e) => setProduitNom(e.target.value)}
                      />
                    </label>
                    <label
                      className="flex flex-col gap-groupe text-sm text-ink-2"
                      htmlFor="produit-prix"
                    >
                      Prix (€)
                      <input
                        id="produit-prix"
                        type="text"
                        inputMode="decimal"
                        className="num h-controle w-28 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                        value={produitPrix}
                        onChange={(e) => setProduitPrix(e.target.value)}
                      />
                    </label>
                    <label
                      className="flex flex-col gap-groupe text-sm text-ink-2"
                      htmlFor="produit-date"
                    >
                      Relevé le
                      <input
                        id="produit-date"
                        type="date"
                        className="h-controle w-40 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                        value={produitDate}
                        onChange={(e) => setProduitDate(e.target.value)}
                      />
                    </label>
                    <label
                      className="flex flex-1 flex-col gap-groupe text-sm text-ink-2"
                      htmlFor="produit-description"
                    >
                      Description (facultative)
                      <input
                        id="produit-description"
                        type="text"
                        className="h-controle w-full rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                        value={produitDescription}
                        onChange={(e) => setProduitDescription(e.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={etatAjoutProduit.phase === 'enregistrement'}
                      className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
                    >
                      Ajouter
                    </button>
                  </div>
                </form>
              </Panneau>

              {/* ═══ Historique des observations ════════════════════════════ */}
              <Panneau titre="Observations (historique complet)" sansRembourrage>
                {etatDetail.statut === 'pret' && (
                  <Tableau
                    // Largeurs revues le 31/07/2026 (même mesure que le
                    // tableau « Produits relevés » ci-dessus) : la VALEUR de
                    // « Visite du » (94,2 px requis, une date, pas son
                    // en-tête de 9 caractères qui aurait suffi à moins) et
                    // l'EN-TÊTE « Affluence » (84,7 px requis, plus long que
                    // sa plus longue valeur, « Moyenne ») débordaient de
                    // leurs 16 % et 14 % d'origine. Les points cédés viennent
                    // de `Notes`, du texte libre déjà protégé par `repli` :
                    // il replie un peu plus tôt, jamais ne perd un mot.
                    colonnes={[
                      {
                        cle: 'date',
                        libelle: 'Visite du',
                        largeur: '22%',
                        alignement: 'texte',
                        troncature: 'repli',
                        rendu: (o) => formaterDate(o.dateObservation),
                      },
                      {
                        cle: 'affluence',
                        libelle: 'Affluence',
                        largeur: '20%',
                        alignement: 'texte',
                        rendu: (o) => LIBELLE_AFFLUENCE[o.affluenceEstimee],
                      },
                      {
                        cle: 'file',
                        libelle: 'File',
                        largeur: '11%',
                        alignement: 'texte',
                        rendu: (o) => (o.fileAttente ? 'Oui' : 'Non'),
                      },
                      {
                        cle: 'notes',
                        libelle: 'Notes',
                        largeur: '47%',
                        alignement: 'texte',
                        troncature: 'repli',
                        rendu: (o) => o.notes ?? TIRET_ABSENT,
                      },
                    ]}
                    lignes={etatDetail.detail.observations}
                    cleLigne={(o) => o.id}
                    etatVide={
                      <EtatVide
                        variante="normal"
                        texte="Aucune observation pour ce concurrent pour l'instant."
                      />
                    }
                  />
                )}

                <form
                  className="border-t border-line px-4 py-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    ajouterObservation();
                  }}
                >
                  <p className="mb-2 text-xs text-ink-3">
                    Saisie rapide après une visite — quelques minutes suffisent
                  </p>
                  <div className="flex flex-wrap items-end gap-groupe">
                    <label
                      className="flex flex-col gap-groupe text-sm text-ink-2"
                      htmlFor="observation-date"
                    >
                      Visite du
                      <input
                        id="observation-date"
                        type="date"
                        className="h-controle w-40 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                        value={observationDate}
                        onChange={(e) => setObservationDate(e.target.value)}
                      />
                    </label>
                    <label
                      className="flex flex-col gap-groupe text-sm text-ink-2"
                      htmlFor="observation-affluence"
                    >
                      Affluence
                      <select
                        id="observation-affluence"
                        className="h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                        value={observationAffluence}
                        onChange={(e) =>
                          setObservationAffluence(e.target.value as AffluenceEstimee)
                        }
                      >
                        {AFFLUENCES_ESTIMEES.map((a) => (
                          <option key={a} value={a}>
                            {LIBELLE_AFFLUENCE[a]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-groupe pb-2 text-sm text-ink-2">
                      <input
                        type="checkbox"
                        checked={observationFileAttente}
                        onChange={(e) => setObservationFileAttente(e.target.checked)}
                      />
                      File d'attente
                    </label>
                    <label
                      className="flex flex-1 basis-full flex-col gap-groupe text-sm text-ink-2"
                      htmlFor="observation-notes"
                    >
                      Notes (ce que vous avez goûté, vu, remarqué)
                      <input
                        id="observation-notes"
                        type="text"
                        className="h-controle w-full rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                        value={observationNotes}
                        onChange={(e) => setObservationNotes(e.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={etatAjoutObservation.phase === 'enregistrement'}
                      className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
                    >
                      Enregistrer la visite
                    </button>
                  </div>
                </form>
              </Panneau>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Ligne persistante à trois états, plutôt qu'une notification (docs/07 §4.7). */
function IndicateurEnregistrement({ etat }: { etat: EtatEnregistrement }) {
  switch (etat.phase) {
    case 'inchange':
      return <span className="text-xs text-ink-3">{TIRET_ABSENT}</span>;
    case 'modifie':
      return <span className="text-xs text-alerte">Modifications non enregistrées</span>;
    case 'enregistrement':
      return <span className="text-xs text-ink-3">Enregistrement…</span>;
    case 'enregistre':
      return <span className="text-xs text-conforme">Enregistré {etat.heure}</span>;
  }
}
