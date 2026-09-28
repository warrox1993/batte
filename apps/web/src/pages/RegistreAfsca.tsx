// `KeyboardEvent` de React est aliasé : le nom global du DOM est déjà utilisé
// plus bas pour les écouteurs `window.addEventListener('keydown', …)`.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as KeyboardEventReact,
} from 'react';
import {
  TIRET_ABSENT,
  ajouterJours,
  formaterDate,
  formaterDateHeure,
  ouTiret,
  schemaExecutionNettoyage,
  schemaExerciceTracabilite,
  schemaListeExecutionsNettoyage,
  schemaListeExercicesTracabilite,
  schemaListeNonConformites,
  schemaListeRelevesTemperature,
  schemaListeSessionsSansReleveTemperature,
  schemaListeTachesEnRetard,
  schemaListeTachesNettoyage,
  schemaNonConformite,
  schemaReleveTemperature,
  schemaTracabiliteAmontSession,
  schemaTracabiliteAvalLot,
  type ExecutionNettoyageDetailContrat,
  type ExerciceTracabiliteContrat,
  type FrequenceNettoyageContrat,
  type GraviteNonConformiteContrat,
  type MomentReleveContrat,
  type NonConformiteContrat,
  type ReleveTemperatureContrat,
  type ResultatExerciceContrat,
  type SessionSansReleveTemperatureContrat,
  type Statut,
  type StatutLot,
  type TacheEnRetardContrat,
  type TacheNettoyageContrat,
  type TracabiliteAmontSessionContrat,
  type TracabiliteAvalLotContrat,
} from '@batte/core';
import { BoutonDocument } from '../composants/BoutonDocument';
import { PastilleStatut } from '../composants/affichage';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi, type ChampsEnErreur } from '../lib/api';
import { aujourdHui } from '../lib/dates';
import { compteAccorde } from './pluriel';

/**
 * Ecran Registre AFSCA (docs/01 module 5 ; Lot 8).
 *
 * Cinq obligations distinctes (temperatures, nettoyage, non-conformites,
 * tracabilite, exercice) rassemblees en ONGLETS plutot qu'en un long
 * defilement : docs/07 §2.3 impose « une seule chose a la fois », et un
 * registre AFSCA n'est pas un seul flux de travail mais cinq registres
 * juxtaposes qui ne se lisent jamais ensemble.
 *
 * Regle d'architecture n°1 (CLAUDE.md §3) : aucun calcul metier ici. La
 * conformite d'une temperature, le retard d'une tache, le statut d'un
 * exercice viennent tels quels de l'API. Les mappages statut -> glyphe et les
 * verifications de presence (« ce champ est-il vide ? ») sont de la
 * PRESENTATION, jamais un calcul sur une donnee metier (meme principe que
 * `statutBesoin` dans `Production.tsx`).
 *
 * CLAUDE.md — le champ temperature ne part JAMAIS pre-rempli : un champ
 * pre-rempli a 4°C se validerait sans etre lu, ce qui est un faux en ecriture.
 */

/* La date du jour est lue à chaque appel, pas figée à l'import : voir le
   commentaire de `aujourdHui` dans `lib/dates.ts`. Sur un registre AFSCA, une
   date proposée par défaut qui traîne depuis l'avant-veille est un antidatage
   que l'utilisateur ne peut pas voir (CLAUDE.md §7). */

/**
 * Badge NEUTRE signalant qu'une réception a été annulée après coup
 * (`receptionStatut`, servi par les routes de traçabilité amont et aval).
 *
 * Ce badge DÉCORE, il ne filtre rien : une réception annulée reste dans le
 * registre, avec son lot et ses productions/ventes/garnitures — les masquer
 * réécrirait le passé, ce que CLAUDE.md §7 interdit. Ton volontairement
 * neutre (`text-ink-3`, pas `text-alerte`) : ce n'est pas une non-conformité,
 * seulement un fait à connaître en cas de rappel.
 */
export function BadgeReceptionAnnulee({ statut }: { statut: 'active' | 'annulee' }) {
  if (statut !== 'annulee') return null;
  return (
    <span
      className="ml-groupe text-ink-3"
      title="Cette réception a été annulée après coup ; le lot reste tracé pour mémoire."
    >
      — réception annulée
    </span>
  );
}

/**
 * Toutes les occurrences de ce bandeau dans cet écran signalent un
 * aller-retour réseau qui a échoué (chargement ou écriture), jamais une
 * alerte métier au sens du registre `depassement` — voir la même décision
 * dans `Comptabilite.tsx` (mission du 01/08/2026 sur `composants/EncartErreur.tsx`).
 * Le badge « réception annulée » (`BadgeReceptionAnnulee` ci-dessus) reste
 * volontairement neutre pour une autre raison : ce n'est pas une non-conformité.
 */
function BandeErreur({ message }: { message: string }) {
  return <MessageErreur message={message} />;
}

/** Entier lisible, sans unite : plusieurs contrats de tracabilite renvoient une
 * quantite sans preciser l'unite de l'ingredient — voir le commentaire sur
 * `COLONNES_CONSOMMATIONS_AMONT`. On formate donc un entier nu, jamais un
 * calcul, juste une mise en forme (meme famille que `formaterQuantite`).
 *
 * EXPORTÉ, comme les deux badges de ce fichier, et pour la même raison : un
 * test qui compare une quantité affichée doit passer par CE formateur, jamais
 * par un littéral tapé à la main. `Intl.NumberFormat('fr-BE')` insère une
 * espace INSÉCABLE dans « 1 200 » — deux chaînes visuellement identiques ne
 * sont alors jamais égales, et le piège symétrique est pire : un
 * `toContain('287')` passerait aussi bien sur « 1 287 ». */
export function formaterEntier(valeur: number): string {
  return new Intl.NumberFormat('fr-BE').format(valeur);
}

/** Un relevé sans unité affichée en en-tête : la température est toujours en °C
 * (docs/01 module 5), donc l'en-tête de colonne porte l'unité, jamais la cellule. */
function formaterTemperature(temperatureC: number): string {
  return new Intl.NumberFormat('fr-BE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(temperatureC);
}

/** Lit une temperature saisie (entiere ou decimale, negative autorisee — un
 * congelateur releve sous zero). Rend `null` plutot que de deviner un zero. */
function parserTemperature(saisie: string): number | null {
  const nettoyee = saisie.trim().replace(',', '.');
  if (nettoyee === '' || !/^-?\d+(\.\d+)?$/.test(nettoyee)) return null;
  const valeur = Number(nettoyee);
  return Number.isFinite(valeur) ? valeur : null;
}

/** Entier positif OPTIONNEL : chaine vide -> absent (`null`) ; sinon doit etre
 * un entier positif, sans quoi `undefined` signale une saisie invalide. */
function parserEntierPositifOptionnel(saisie: string): number | null | undefined {
  const nettoyee = saisie.trim();
  if (nettoyee === '') return null;
  if (!/^\d+$/.test(nettoyee)) return undefined;
  const valeur = Number.parseInt(nettoyee, 10);
  return valeur > 0 ? valeur : undefined;
}

const CLASSE_BOUTON_PRIMAIRE =
  'flex h-controle items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';
const CLASSE_CHAMP =
  'h-controle rounded-sm border border-line-field bg-surface px-2 text-base text-ink';

/* ═══════════════════════════════════════════════════════════════════════════
   Onglet 1 — Relevés de température
   ═══════════════════════════════════════════════════════════════════════════ */

const LIBELLE_MOMENT: Readonly<Record<MomentReleveContrat, string>> = {
  depart: 'Départ',
  arrivee: 'Arrivée',
  mi_session: 'Mi-session',
  retour: 'Retour',
  stockage: 'Stockage',
};

/**
 * Badge NEUTRE signalant qu'un relevé de température a été annulé après coup
 * (D-083, 31/07/2026) — même ton, même raisonnement que `BadgeReceptionAnnulee`
 * ci-dessus : ce n'est pas une faute, c'est une correction normale
 * (CLAUDE.md §3 règle 7), le badge DÉCORE, il ne filtre rien — le relevé reste
 * dans le tableau, jamais masqué.
 *
 * Auto-contenu comme `BadgeReceptionAnnulee` (rend `null` pour un relevé
 * `active`) : la colonne « Annulation » ci-dessous choisit quand même entre ce
 * badge et le bouton « Annuler » plutôt que de toujours monter les deux, mais
 * ce composant reste testable seul, sans dépendre de cette décision d'appelant.
 */
export function BadgeReleveAnnule({
  statut,
  motif,
}: {
  statut: 'active' | 'annulee';
  motif: string | null | undefined;
}) {
  if (statut !== 'annulee') return null;
  return (
    <span
      className="text-ink-3"
      title={
        motif !== null && motif !== undefined && motif !== ''
          ? `Relevé annulé : ${motif}`
          : 'Ce relevé a été annulé après coup ; il reste tracé pour mémoire.'
      }
    >
      — relevé annulé
    </span>
  );
}

/**
 * Colonnes du tableau des relevés — fonction (et non un tableau const) depuis
 * D-083 : la colonne « Annulation » a besoin du callback qui ouvre le
 * formulaire de motif, propre à l'instance du composant (`OngletTemperatures`).
 * Même geste que `colonnesStock` (`Stock.tsx`).
 */
function colonnesReleves(
  onAnnuler: (releve: ReleveTemperatureContrat) => void,
): ReadonlyArray<ColonneTableau<ReleveTemperatureContrat>> {
  return [
    // Somme exactement 100 %. Repartition mesuree a 1280 px : « Non conforme »
    // se coupait a 14 % (« Non conform »), et sur un registre AFSCA un statut de
    // conformite tronque est le pire endroit ou economiser des pixels. La date et
    // « Relevé par » se coupaient egalement. Les colonnes elargies sont prises sur
    // « Action corrective » et « Équipement », qui portent toutes deux un `titre`
    // et peuvent donc se tronquer sans perte d'information. Redistribuées le
    // 31/07/2026 pour faire place à la colonne « Annulation » (D-083).
    {
      cle: 'date',
      libelle: 'Date',
      largeur: '12%',
      alignement: 'texte',
      rendu: (r) => formaterDate(r.dateReleve),
    },
    {
      cle: 'moment',
      libelle: 'Moment',
      largeur: '11%',
      alignement: 'texte',
      rendu: (r) => LIBELLE_MOMENT[r.moment],
    },
    {
      cle: 'equipement',
      libelle: 'Équipement',
      largeur: '13%',
      alignement: 'texte',
      rendu: (r) => r.equipement,
      titre: (r) => r.equipement,
    },
    {
      // En-tete court : « Température (°C) » ne tenait pas dans la colonne et
      // s'y tronquait. L'unite est deja portee par chaque valeur.
      cle: 'temperature',
      libelle: 'Température',
      largeur: '11%',
      alignement: 'nombre',
      rendu: (r) => (
        // Barré quand le relevé est annulé (D-083) : la VALEUR ne fait plus
        // foi, exactement comme sur le registre imprimé
        // (`apps/api/src/documents/registre-afsca.ts`).
        <span className={r.statut === 'annulee' ? 'line-through text-ink-3' : undefined}>
          {formaterTemperature(r.temperatureC)}
        </span>
      ),
    },
    {
      cle: 'statut',
      libelle: 'Statut',
      largeur: '15%',
      alignement: 'texte',
      rendu: (r) => (
        <PastilleStatut
          statut={r.conforme ? 'conforme' : 'depassement'}
          libelle={r.conforme ? 'Conforme' : 'Non conforme'}
        />
      ),
    },
    {
      cle: 'action',
      libelle: 'Action corrective',
      largeur: '16%',
      alignement: 'texte',
      // Mesuré à 1280 px : « Blocs eutectiques remplacés, produits écartés »
      // débordait de 100 px. C'est le champ que l'AFSCA lit en premier sur un
      // relevé non conforme — ce qui a été FAIT face au dépassement. Texte libre,
      // longueur non bornée, et son `titre` n'était qu'un recours à la souris.
      troncature: 'repli',
      rendu: (r) => ouTiret(r.actionCorrective, (v) => v),
    },
    {
      cle: 'relevePar',
      libelle: 'Relevé par',
      largeur: '9%',
      alignement: 'texte',
      // Deux prenoms peuvent partager leur debut : couper par la fin fait
      // attribuer un releve a la mauvaise personne. Sur un registre d'autocontrole,
      // c'est la signature de la mesure.
      troncature: 'repli',
      rendu: (r) => ouTiret(r.relevePar, (v) => v),
    },
    {
      // Colonne D-083 : annuler un relevé mal saisi, ou voir qu'il l'a déjà
      // été. `titre` ne suffirait pas ici (CLAUDE.md §3 règle 10 — clavier
      // obligatoire) : le bouton lui-même est le recours accessible, le badge
      // neutre l'infobulle en confort supplémentaire.
      cle: 'annulation',
      libelle: 'Annulation',
      largeur: '13%',
      alignement: 'texte',
      rendu: (r) =>
        r.statut === 'annulee' ? (
          <BadgeReleveAnnule statut={r.statut} motif={r.motifAnnulation} />
        ) : (
          <button
            type="button"
            onClick={() => onAnnuler(r)}
            className="text-sm font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
          >
            Annuler
          </button>
        ),
    },
  ];
}

/**
 * Balayage de conformité — sessions clôturées d'une période SANS AUCUN relevé
 * de température rattaché (`GET /afsca/temperatures/sessions-sans-releve`,
 * `apps/api/src/routes/afsca.ts`, service testé mais jamais remonté à un
 * écran avant cette correction, docs/28-ORPHELINS-DERIVES.md §2.4). C'est la
 * question qu'un contrôleur AFSCA pose directement : « vous avez tenu un
 * marché ce jour-là, où est le relevé ? » — un vrai balayage rétrospectif,
 * pas seulement le rappel ponctuel déjà posé à la clôture d'UNE session
 * (`Sessions.tsx`).
 */
const COLONNES_SESSIONS_SANS_RELEVE: ReadonlyArray<
  ColonneTableau<SessionSansReleveTemperatureContrat>
> = [
  {
    cle: 'numero',
    libelle: 'Session',
    largeur: '20%',
    alignement: 'texte',
    rendu: (s) => <span className="font-mono text-xs">{s.numero}</span>,
    titre: (s) => s.numero,
  },
  {
    cle: 'date',
    libelle: 'Date',
    largeur: '20%',
    alignement: 'texte',
    rendu: (s) => formaterDate(s.dateSession),
  },
  {
    cle: 'lieu',
    libelle: 'Lieu',
    largeur: '60%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (s) => s.lieuNom,
    titre: (s) => s.lieuNom,
  },
];

type EtatSessionsSansReleve =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; sessions: SessionSansReleveTemperatureContrat[]; total: number };

type EtatReleves =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; releves: ReleveTemperatureContrat[]; total: number };

type EtatEcriture =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'succes'; message: string }
  | { statut: 'erreur'; message: string; champs?: ChampsEnErreur };

function OngletTemperatures() {
  const [etatReleves, setEtatReleves] = useState<EtatReleves>({ statut: 'chargement' });

  // ── Balayage de conformité : sessions sans relevé (docs/28 §2.4) ──────────
  // Par défaut depuis le 1er janvier de l'année en cours jusqu'à aujourd'hui :
  // c'est un contrôle ANNUEL (« avant un contrôle AFSCA »), pas un rappel des
  // 30 derniers jours comme « Exécutions récentes » du plan de nettoyage.
  const [debutSansReleve, setDebutSansReleve] = useState(() => `${aujourdHui().slice(0, 4)}-01-01`);
  const [finSansReleve, setFinSansReleve] = useState(aujourdHui);
  const [etatSansReleve, setEtatSansReleve] = useState<EtatSessionsSansReleve>({
    statut: 'chargement',
  });

  const [equipement, setEquipement] = useState('');
  // JAMAIS de valeur par defaut : un champ pre-rempli se validerait sans etre lu.
  const [temperatureSaisie, setTemperatureSaisie] = useState('');
  const [dateReleve, setDateReleve] = useState(aujourdHui);
  const [moment, setMoment] = useState<MomentReleveContrat>('depart');
  const [actionCorrective, setActionCorrective] = useState('');
  const [relevePar, setRelevePar] = useState('');
  const [etatEcriture, setEtatEcriture] = useState<EtatEcriture>({ statut: 'inactif' });
  // Le focus repart sur la temperature apres chaque enregistrement : c'est le
  // SEUL champ que l'on revide (equipement, date et moment restent en place
  // pour le releve suivant du meme equipement). Sans ce rappel, le focus reste
  // sur le bouton et il faut tabuler a l'envers a chaque ligne.
  const champTemperature = useRef<HTMLInputElement>(null);

  // ── Annulation d'un relevé mal saisi (D-083, 31/07/2026) ──────────────────
  // `annulationCible` porte le relevé visé (jamais seulement son id) : le
  // panneau doit pouvoir rappeler QUOI on est en train d'annuler (date,
  // équipement, valeur) sans un second aller-retour serveur.
  const [annulationCible, setAnnulationCible] = useState<ReleveTemperatureContrat | null>(null);
  const [motifAnnulationSaisi, setMotifAnnulationSaisi] = useState('');
  const [etatAnnulation, setEtatAnnulation] = useState<EtatEcriture>({ statut: 'inactif' });
  const champMotifAnnulation = useRef<HTMLInputElement>(null);

  /**
   * Recharge la liste depuis le serveur — extrait pour être rejoué après une
   * annulation réussie : le serveur seul connaît le motif ET l'instant RÉELS
   * de l'annulation (`journal_audit`), les fabriquer côté client violerait
   * CLAUDE.md §7. Un aller-retour de plus coûte moins qu'une donnée inventée.
   */
  const chargerReleves = useCallback(() => {
    let annule = false;
    requeteApi<unknown>('/afsca/temperatures')
      .then((reponse) => {
        const liste = schemaListeRelevesTemperature.parse(reponse);
        if (!annule)
          setEtatReleves({ statut: 'pret', releves: liste.data, total: liste.meta.total });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatReleves({ statut: 'erreur', message });
      });
    return () => {
      annule = true;
    };
  }, []);

  useEffect(() => chargerReleves(), [chargerReleves]);

  /** Recharge le balayage « sessions sans relevé » sur la période choisie. */
  const chargerSessionsSansReleve = useCallback((debut: string, fin: string) => {
    setEtatSansReleve({ statut: 'chargement' });
    requeteApi<unknown>(`/afsca/temperatures/sessions-sans-releve?debut=${debut}&fin=${fin}`)
      .then((reponse) => {
        const liste = schemaListeSessionsSansReleveTemperature.parse(reponse);
        setEtatSansReleve({ statut: 'pret', sessions: liste.data, total: liste.meta.total });
      })
      .catch((erreur: unknown) => {
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatSansReleve({ statut: 'erreur', message });
      });
  }, []);

  useEffect(() => {
    if (debutSansReleve === '' || finSansReleve === '') return;
    chargerSessionsSansReleve(debutSansReleve, finSansReleve);
  }, [debutSansReleve, finSansReleve, chargerSessionsSansReleve]);

  useEffect(() => {
    if (etatEcriture.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatEcriture({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatEcriture]);

  useEffect(() => {
    if (etatAnnulation.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatAnnulation({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatAnnulation]);

  /** Ouvre le panneau de motif pour CE relevé — un seul à la fois. */
  function ouvrirAnnulation(releve: ReleveTemperatureContrat): void {
    setAnnulationCible(releve);
    setMotifAnnulationSaisi('');
    setEtatAnnulation({ statut: 'inactif' });
    requestAnimationFrame(() => champMotifAnnulation.current?.focus());
  }

  async function annulerReleveCible(): Promise<void> {
    if (annulationCible === null || etatAnnulation.statut === 'en_cours') return;
    const motif = motifAnnulationSaisi.trim();
    if (motif === '') {
      setEtatAnnulation({
        statut: 'erreur',
        message: 'Indiquez pourquoi ce relevé est annulé.',
        champs: { motif: 'Indiquez pourquoi ce relevé est annulé.' },
      });
      champMotifAnnulation.current?.focus();
      return;
    }

    setEtatAnnulation({ statut: 'en_cours' });
    try {
      await requeteApi<unknown>(`/afsca/temperatures/${annulationCible.id}/annuler`, {
        method: 'POST',
        body: JSON.stringify({ motif }),
      });
      // Rechargé depuis le serveur (voir `chargerReleves` ci-dessus) : le bon
      // ET le mauvais relevé restent visibles (D-083), avec le motif et
      // l'instant d'annulation RÉELS, jamais reconstitués côté client.
      chargerReleves();
      setAnnulationCible(null);
      setEtatAnnulation({ statut: 'succes', message: 'Relevé annulé.' });
    } catch (erreur) {
      setEtatAnnulation({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : "L'annulation a échoué.",
      });
    }
  }

  const temperature = parserTemperature(temperatureSaisie);
  const erreurActionCorrective =
    etatEcriture.statut === 'erreur' ? etatEcriture.champs?.actionCorrective : undefined;
  const peutEnregistrer =
    equipement.trim() !== '' &&
    temperature !== null &&
    dateReleve !== '' &&
    etatEcriture.statut !== 'en_cours';

  async function enregistrerReleve(): Promise<void> {
    if (!peutEnregistrer || temperature === null) return;

    setEtatEcriture({ statut: 'en_cours' });
    try {
      const corps = {
        equipement: equipement.trim(),
        temperatureC: temperature,
        dateReleve,
        moment,
        actionCorrective: actionCorrective.trim() === '' ? null : actionCorrective.trim(),
        relevePar: relevePar.trim() === '' ? null : relevePar.trim(),
      };
      const reponse = await requeteApi<unknown>('/afsca/temperatures', {
        method: 'POST',
        body: JSON.stringify(corps),
      });
      const releve = schemaReleveTemperature.parse(reponse);
      setEtatReleves((precedent) =>
        precedent.statut === 'pret'
          ? { statut: 'pret', releves: [releve, ...precedent.releves], total: precedent.total + 1 }
          : precedent,
      );
      // Le champ temperature repart TOUJOURS vide (regle absolue) ; l'action
      // corrective aussi, une fois le relevé accepté. Le reste (équipement,
      // date, moment) reste en place pour la saisie suivante, généralement
      // le même équipement à un autre moment de la même session.
      setTemperatureSaisie('');
      setActionCorrective('');
      setEtatEcriture({
        statut: 'succes',
        // Un relevé hors seuil ouvre AUTOMATIQUEMENT une non-conformité liée
        // (docs/17 fiche 15) : la confirmation le dit, sinon rien à l'écran
        // n'indique que ce second registre vient d'être écrit.
        message: releve.conforme
          ? 'Relevé enregistré — conforme.'
          : 'Relevé enregistré — NON CONFORME. Une non-conformité a été ouverte ' +
            'automatiquement dans l’onglet Non-conformités.',
      });
      champTemperature.current?.focus();
    } catch (erreur) {
      if (erreur instanceof ErreurApi) {
        setEtatEcriture({
          statut: 'erreur',
          message: erreur.message,
          ...(erreur.champs !== undefined ? { champs: erreur.champs } : {}),
        });
        // docs/07 §4.7 : le focus va sur le premier champ fautif, et la saisie
        // n'est jamais videe. Un relevé hors seuil est refusé tant que l'action
        // corrective manque — c'est ce champ-là qu'il faut atteindre, pas le
        // haut du formulaire.
        if (erreur.champs?.actionCorrective !== undefined) {
          document.getElementById('temp-action')?.focus();
        }
      } else {
        setEtatEcriture({ statut: 'erreur', message: 'Erreur inattendue, sans plus de détail.' });
      }
    }
  }

  return (
    <div className="flex flex-col gap-bloc">
      <Panneau titre="Saisir un relevé">
        {/* Un vrai `<form>` : la regle 10 de CLAUDE.md veut « tabulation,
            entree, chiffres ». Un releve se saisit plusieurs fois par session,
            et aller chercher le bouton a la souris a chaque fois casse le
            rythme. `peutEnregistrer` reste le seul garde-fou : la soumission
            est refusee tant que l'equipement, la temperature et la date ne
            sont pas renseignes, donc une frappe malheureuse ne peut pas ecrire
            une ligne de registre a moitie vide. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enregistrerReleve();
          }}
          className="flex flex-col gap-bloc"
        >
          <div className="flex flex-wrap items-end gap-bloc">
            <label
              className="flex flex-col gap-groupe text-sm text-ink-2"
              htmlFor="temp-equipement"
            >
              Équipement
              <input
                id="temp-equipement"
                type="text"
                className={`${CLASSE_CHAMP} w-48`}
                value={equipement}
                onChange={(e) => setEquipement(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="temp-valeur">
              Température (°C)
              <input
                id="temp-valeur"
                ref={champTemperature}
                type="text"
                inputMode="decimal"
                placeholder="—"
                className={`num ${CLASSE_CHAMP} w-28`}
                value={temperatureSaisie}
                onChange={(e) => setTemperatureSaisie(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="temp-moment">
              Moment
              <select
                id="temp-moment"
                className={`${CLASSE_CHAMP} w-40`}
                value={moment}
                onChange={(e) => setMoment(e.target.value as MomentReleveContrat)}
              >
                {Object.entries(LIBELLE_MOMENT).map(([cle, libelle]) => (
                  <option key={cle} value={cle}>
                    {libelle}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="temp-date">
              Date du relevé
              <input
                id="temp-date"
                type="date"
                className={`${CLASSE_CHAMP} w-40`}
                value={dateReleve}
                onChange={(e) => setDateReleve(e.target.value)}
              />
            </label>

            <label
              className="flex flex-col gap-groupe text-sm text-ink-2"
              htmlFor="temp-releve-par"
            >
              Relevé par (optionnel)
              <input
                id="temp-releve-par"
                type="text"
                className={`${CLASSE_CHAMP} w-40`}
                value={relevePar}
                onChange={(e) => setRelevePar(e.target.value)}
              />
            </label>
          </div>

          <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="temp-action">
            Action corrective (obligatoire si le relevé dépasse le seuil)
            <input
              id="temp-action"
              type="text"
              className={CLASSE_CHAMP}
              value={actionCorrective}
              onChange={(e) => setActionCorrective(e.target.value)}
              aria-invalid={erreurActionCorrective !== undefined}
              aria-describedby={
                erreurActionCorrective !== undefined ? 'temp-action-erreur' : undefined
              }
            />
          </label>
          {erreurActionCorrective !== undefined && (
            <p id="temp-action-erreur" className="text-sm text-depassement">
              {erreurActionCorrective}
            </p>
          )}

          <div className="flex items-center gap-groupe">
            <button
              type="submit"
              disabled={!peutEnregistrer}
              className={`${CLASSE_BOUTON_PRIMAIRE} w-56`}
            >
              {etatEcriture.statut === 'en_cours' ? 'Enregistrement…' : 'Enregistrer le relevé'}
            </button>
            {etatEcriture.statut === 'succes' && (
              <p role="status" className="text-sm text-conforme">
                {etatEcriture.message}
              </p>
            )}
          </div>
          {etatEcriture.statut === 'erreur' && erreurActionCorrective === undefined && (
            <BandeErreur message={etatEcriture.message} />
          )}
        </form>
      </Panneau>

      {/*
        Annulation d'un relevé mal saisi (D-083, 31/07/2026) : ÉCRITURE
        NOUVELLE, jamais une suppression ni une réécriture — le motif est
        OBLIGATOIRE (refusé vide, même garde côté serveur), et le relevé visé
        reste rappelé en toutes lettres pour qu'on ne l'annule pas à l'aveugle.
      */}
      {annulationCible !== null && (
        <Panneau titre="Annuler ce relevé">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void annulerReleveCible();
            }}
            className="flex flex-col gap-groupe"
          >
            <p className="text-sm text-ink-2">
              {formaterDate(annulationCible.dateReleve)} — {LIBELLE_MOMENT[annulationCible.moment]}{' '}
              — {annulationCible.equipement} — {formaterTemperature(annulationCible.temperatureC)}{' '}
              °C
            </p>
            <label
              className="flex flex-col gap-groupe text-sm text-ink-2"
              htmlFor="temp-motif-annulation"
            >
              Motif de l’annulation
              <input
                id="temp-motif-annulation"
                ref={champMotifAnnulation}
                type="text"
                className={CLASSE_CHAMP}
                value={motifAnnulationSaisi}
                onChange={(e) => setMotifAnnulationSaisi(e.target.value)}
                placeholder="Ex. thermomètre mal calibré, valeur recopiée à la mauvaise ligne"
                aria-invalid={etatAnnulation.statut === 'erreur'}
              />
            </label>
            <div className="flex items-center gap-groupe">
              <button
                type="submit"
                disabled={etatAnnulation.statut === 'en_cours'}
                className={`${CLASSE_BOUTON_PRIMAIRE} w-56`}
              >
                {etatAnnulation.statut === 'en_cours' ? 'Annulation…' : 'Confirmer l’annulation'}
              </button>
              <button
                type="button"
                onClick={() => setAnnulationCible(null)}
                className="text-sm text-ink-2 underline underline-offset-2 hover:text-ink"
              >
                Renoncer
              </button>
            </div>
            {etatAnnulation.statut === 'erreur' && <BandeErreur message={etatAnnulation.message} />}
          </form>
        </Panneau>
      )}
      {etatAnnulation.statut === 'succes' && (
        <p role="status" className="text-sm text-conforme">
          {etatAnnulation.message}
        </p>
      )}

      {etatReleves.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Chargement des relevés…</p>
      )}
      {etatReleves.statut === 'erreur' && <BandeErreur message={etatReleves.message} />}
      {etatReleves.statut === 'pret' && (
        <Panneau titre={compteAccorde(etatReleves.total, 'relevé', 'relevés')} sansRembourrage>
          <Tableau
            colonnes={colonnesReleves(ouvrirAnnulation)}
            lignes={etatReleves.releves}
            cleLigne={(r) => r.id}
            etatVide={
              <EtatVide
                variante="premier-lancement"
                titre="Aucun relevé enregistré"
                explication="Saisissez le premier relevé de température avec le formulaire ci-dessus."
              />
            }
          />
        </Panneau>
      )}

      {/* ═══ Balayage de conformité : sessions sans relevé (docs/28 §2.4) ═══
          Question qu'un contrôleur AFSCA pose directement : « vous avez tenu
          un marché ce jour-là, où est le relevé ? ». Câblé le 01/08/2026 :
          `GET /afsca/temperatures/sessions-sans-releve` existait déjà, testé,
          sans le moindre écran appelant. */}
      <Panneau titre="Sessions sans relevé de température" sansRembourrage>
        <div className="flex flex-wrap items-end gap-bloc border-b border-line px-4 py-3">
          <label
            className="flex flex-col gap-groupe text-sm text-ink-2"
            htmlFor="sans-releve-debut"
          >
            Du
            <input
              id="sans-releve-debut"
              type="date"
              className={`${CLASSE_CHAMP} w-40`}
              value={debutSansReleve}
              onChange={(e) => setDebutSansReleve(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="sans-releve-fin">
            Au
            <input
              id="sans-releve-fin"
              type="date"
              className={`${CLASSE_CHAMP} w-40`}
              value={finSansReleve}
              onChange={(e) => setFinSansReleve(e.target.value)}
            />
          </label>
        </div>

        {etatSansReleve.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Chargement…</p>
        )}
        {etatSansReleve.statut === 'erreur' && (
          <div className="px-4 py-2">
            <BandeErreur message={etatSansReleve.message} />
          </div>
        )}
        {etatSansReleve.statut === 'pret' && (
          <Tableau
            colonnes={COLONNES_SESSIONS_SANS_RELEVE}
            lignes={etatSansReleve.sessions}
            cleLigne={(s) => s.sessionId}
            etatVide={
              // `normal`, pas `filtre` : une liste vide ICI est une BONNE
              // nouvelle (conformité complète sur la période), pas un filtre
              // trop étroit à élargir — les deux se lisent différemment
              // (docs/07 §4.7, trois états vides distincts).
              <EtatVide
                variante="normal"
                texte="Aucune session clôturée sans relevé sur la période choisie."
              />
            }
          />
        )}
      </Panneau>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Onglet 2 — Plan de nettoyage
   ═══════════════════════════════════════════════════════════════════════════ */

const LIBELLE_FREQUENCE: Readonly<Record<FrequenceNettoyageContrat, string>> = {
  apres_session: 'Après chaque session',
  hebdomadaire: 'Hebdomadaire',
  mensuelle: 'Mensuelle',
};

const COLONNES_TACHES_EN_RETARD: ReadonlyArray<ColonneTableau<TacheEnRetardContrat>> = [
  {
    cle: 'libelle',
    libelle: 'Tâche',
    largeur: '22%',
    alignement: 'texte',
    // Mesuré à 1280 px : les 10 rangées sur 10 débordaient, jusqu'à +136 px.
    // « Nettoyage et désinfection de la glacière » et « Nettoyage et
    // désinfection du bac » s'affichaient tous deux « Nettoyage et
    // désinfec… » — deux tâches distinctes devenues la même ligne, dans une
    // WORKLIST dont le libellé EST la consigne à exécuter (docs/07 §2.3).
    // Le `titre` ne pouvait pas servir de recours : l'infobulle native n'est
    // pas exposée au clavier (CLAUDE.md §3 règle 10).
    troncature: 'repli',
    rendu: (t) => t.libelle,
  },
  // Les zones partagent leur debut (« Cuisine — plan de travail », « Cuisine —
  // evier ») : l'ellipse coupe exactement ce qui les distingue.
  {
    cle: 'zone',
    libelle: 'Zone',
    largeur: '16%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (t) => t.zone,
  },
  {
    cle: 'frequence',
    libelle: 'Fréquence',
    largeur: '16%',
    alignement: 'texte',
    rendu: (t) => LIBELLE_FREQUENCE[t.frequence],
  },
  {
    cle: 'derniere',
    libelle: 'Dernier passage',
    largeur: '14%',
    alignement: 'texte',
    rendu: (t) => ouTiret(t.derniereExecution, (d) => formaterDate(d)),
  },
  {
    cle: 'motif',
    libelle: 'Motif',
    largeur: '32%',
    alignement: 'texte',
    // Débordait de 15 px sur 5 rangées sur 10. Le repli y est GRATUIT en
    // hauteur : « Tâche » ci-dessus met déjà ces mêmes rangées sur deux lignes,
    // donc le motif s'y replie sans ajouter un seul pixel. Et il en a besoin —
    // les motifs sont des phrases gabarit qui partagent leur début et se
    // distinguent par leur fin (« …depuis le dernier nettoyage »).
    troncature: 'repli',
    rendu: (t) => t.motif,
  },
];

const COLONNES_TACHES: ReadonlyArray<ColonneTableau<TacheNettoyageContrat>> = [
  {
    cle: 'libelle',
    libelle: 'Tâche',
    largeur: '40%',
    alignement: 'texte',
    // `repli` : ce tableau partage sa colonne `libelle` avec
    // `COLONNES_TACHES_EN_RETARD` ci-dessus, qui a déjà `repli` pour la même
    // raison (« Nettoyage et désinfection de la glacière » / « … du bac » se
    // réduisaient à la même ligne « Nettoyage et désinfec… », deux tâches
    // devenues indiscernables dans une WORKLIST dont le libellé EST la
    // consigne à exécuter, docs/07 §2.3). Mesuré ici le 31/07/2026 : une fois
    // le panneau d'exécution ouvert (ce tableau se réduit à ~614 px), 8 des 10
    // tâches actives se coupaient de la même façon — cette table n'avait
    // simplement jamais reçu le même correctif que sa voisine.
    troncature: 'repli',
    rendu: (t) => t.libelle,
    titre: (t) => t.libelle,
  },
  {
    cle: 'zone',
    libelle: 'Zone',
    largeur: '30%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (t) => t.zone,
  },
  {
    cle: 'frequence',
    libelle: 'Fréquence',
    largeur: '30%',
    alignement: 'texte',
    rendu: (t) => LIBELLE_FREQUENCE[t.frequence],
  },
];

const COLONNES_EXECUTIONS: ReadonlyArray<ColonneTableau<ExecutionNettoyageDetailContrat>> = [
  {
    cle: 'date',
    libelle: 'Date',
    largeur: '14%',
    alignement: 'texte',
    rendu: (e) => formaterDate(e.dateExecution),
  },
  {
    cle: 'tache',
    libelle: 'Tâche',
    largeur: '26%',
    alignement: 'texte',
    rendu: (e) => e.tacheLibelle,
    titre: (e) => e.tacheLibelle,
  },
  {
    cle: 'zone',
    libelle: 'Zone',
    largeur: '16%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (e) => e.zone,
  },
  {
    cle: 'executePar',
    libelle: 'Exécuté par',
    largeur: '16%',
    alignement: 'texte',
    // Qui a execute la tache est la signature du registre : jamais tronquee.
    troncature: 'repli',
    rendu: (e) => ouTiret(e.executePar, (v) => v),
  },
  {
    cle: 'observations',
    libelle: 'Observations',
    largeur: '28%',
    alignement: 'texte',
    rendu: (e) => ouTiret(e.observations, (v) => v),
    titre: (e) => ouTiret(e.observations, (v) => v),
  },
];

type EtatTachesEnRetard =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; taches: TacheEnRetardContrat[]; total: number };

type EtatTaches =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; taches: TacheNettoyageContrat[]; total: number };

type EtatExecutions =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; executions: ExecutionNettoyageDetailContrat[]; total: number };

function OngletNettoyage() {
  const [etatTachesEnRetard, setEtatTachesEnRetard] = useState<EtatTachesEnRetard>({
    statut: 'chargement',
  });
  const [etatTaches, setEtatTaches] = useState<EtatTaches>({ statut: 'chargement' });

  const [debutExecutions, setDebutExecutions] = useState(() => ajouterJours(aujourdHui(), -30));
  const [finExecutions, setFinExecutions] = useState(aujourdHui);
  const [etatExecutions, setEtatExecutions] = useState<EtatExecutions>({ statut: 'chargement' });

  const [tacheSelectionneeId, setTacheSelectionneeId] = useState<string | null>(null);
  const [tacheSelectionneeLibelle, setTacheSelectionneeLibelle] = useState('');
  const [dateExecution, setDateExecution] = useState(aujourdHui);
  const [executePar, setExecutePar] = useState('');
  const [observations, setObservations] = useState('');
  const [etatEcriture, setEtatEcriture] = useState<EtatEcriture>({ statut: 'inactif' });

  const chargerTachesEnRetard = useCallback(() => {
    requeteApi<unknown>('/afsca/nettoyage/taches-en-retard')
      .then((reponse) => {
        const liste = schemaListeTachesEnRetard.parse(reponse);
        setEtatTachesEnRetard({ statut: 'pret', taches: liste.data, total: liste.meta.total });
      })
      .catch((erreur: unknown) => {
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatTachesEnRetard({ statut: 'erreur', message });
      });
  }, []);

  const chargerExecutions = useCallback((debut: string, fin: string) => {
    setEtatExecutions({ statut: 'chargement' });
    requeteApi<unknown>(`/afsca/nettoyage/executions?debut=${debut}&fin=${fin}`)
      .then((reponse) => {
        const liste = schemaListeExecutionsNettoyage.parse(reponse);
        setEtatExecutions({ statut: 'pret', executions: liste.data, total: liste.meta.total });
      })
      .catch((erreur: unknown) => {
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatExecutions({ statut: 'erreur', message });
      });
  }, []);

  useEffect(() => {
    chargerTachesEnRetard();
  }, [chargerTachesEnRetard]);

  useEffect(() => {
    let annule = false;
    requeteApi<unknown>('/afsca/nettoyage/taches')
      .then((reponse) => {
        const liste = schemaListeTachesNettoyage.parse(reponse);
        if (!annule) setEtatTaches({ statut: 'pret', taches: liste.data, total: liste.meta.total });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatTaches({ statut: 'erreur', message });
      });
    return () => {
      annule = true;
    };
  }, []);

  useEffect(() => {
    if (debutExecutions === '' || finExecutions === '') return;
    chargerExecutions(debutExecutions, finExecutions);
  }, [debutExecutions, finExecutions, chargerExecutions]);

  useEffect(() => {
    if (tacheSelectionneeId === null) return;
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key === 'Escape') setTacheSelectionneeId(null);
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [tacheSelectionneeId]);

  useEffect(() => {
    if (etatEcriture.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatEcriture({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatEcriture]);

  function selectionnerTache(id: string, libelle: string): void {
    setTacheSelectionneeId((precedent) => (precedent === id ? null : id));
    setTacheSelectionneeLibelle(libelle);
    setDateExecution(aujourdHui());
    setExecutePar('');
    setObservations('');
    setEtatEcriture({ statut: 'inactif' });
  }

  async function enregistrerExecution(): Promise<void> {
    if (tacheSelectionneeId === null || dateExecution === '' || etatEcriture.statut === 'en_cours')
      return;

    setEtatEcriture({ statut: 'en_cours' });
    try {
      const corps = {
        tacheId: tacheSelectionneeId,
        dateExecution,
        executePar: executePar.trim() === '' ? null : executePar.trim(),
        observations: observations.trim() === '' ? null : observations.trim(),
      };
      const reponse = await requeteApi<unknown>('/afsca/nettoyage/executions', {
        method: 'POST',
        body: JSON.stringify(corps),
      });
      // Valide la forme de la reponse (frontiere HTTP, CLAUDE.md §4) ; son
      // contenu n'a pas besoin d'etre affiche ici, les listes sont rechargees
      // depuis le serveur juste apres car le RETARD est un calcul serveur.
      schemaExecutionNettoyage.parse(reponse);
      setEtatEcriture({ statut: 'succes', message: 'Exécution enregistrée.' });
      chargerTachesEnRetard();
      chargerExecutions(debutExecutions, finExecutions);
    } catch (erreur) {
      setEtatEcriture({
        statut: 'erreur',
        message:
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
      });
    }
  }

  return (
    <div className="flex flex-col gap-bloc">
      {etatTachesEnRetard.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Vérification des tâches en retard…</p>
      )}
      {etatTachesEnRetard.statut === 'erreur' && (
        <BandeErreur message={etatTachesEnRetard.message} />
      )}
      {etatTachesEnRetard.statut === 'pret' && (
        <Panneau titre="Tâches en retard" sansRembourrage>
          <Tableau
            colonnes={COLONNES_TACHES_EN_RETARD}
            lignes={etatTachesEnRetard.taches}
            cleLigne={(t) => t.tacheId}
            {...(tacheSelectionneeId !== null ? { ligneSelectionneeCle: tacheSelectionneeId } : {})}
            onSelectionnerLigne={(t) => selectionnerTache(t.tacheId, t.libelle)}
            etatVide={<EtatVide variante="normal" texte="Aucune tâche en retard." />}
          />
        </Panneau>
      )}

      <div className="flex flex-col items-start gap-bloc lg:flex-row">
        <div className="min-w-0 flex-1 self-stretch">
          {etatTaches.statut === 'chargement' && (
            <p className="text-sm text-ink-3">Chargement des tâches…</p>
          )}
          {etatTaches.statut === 'erreur' && <BandeErreur message={etatTaches.message} />}
          {etatTaches.statut === 'pret' && (
            <Panneau
              titre={compteAccorde(etatTaches.total, 'tâche active', 'tâches actives')}
              sansRembourrage
            >
              <Tableau
                colonnes={COLONNES_TACHES}
                lignes={etatTaches.taches}
                cleLigne={(t) => t.id}
                {...(tacheSelectionneeId !== null
                  ? { ligneSelectionneeCle: tacheSelectionneeId }
                  : {})}
                onSelectionnerLigne={(t) => selectionnerTache(t.id, t.libelle)}
                etatVide={
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucune tâche de nettoyage active"
                    explication="Le plan de nettoyage se paramètre dans l'écran Paramètres."
                  />
                }
              />
            </Panneau>
          )}
        </div>

        {tacheSelectionneeId !== null && (
          <div className="w-full lg:w-[23.75rem] lg:shrink-0">
            <Panneau titre={`Exécution — ${tacheSelectionneeLibelle}`} sansRembourrage>
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <p className="text-xs text-ink-3">Enregistrer un passage effectué</p>
                <button
                  type="button"
                  onClick={() => setTacheSelectionneeId(null)}
                  className="text-xs font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Fermer
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void enregistrerExecution();
                }}
                className="flex flex-col gap-bloc px-4 py-3"
              >
                <label
                  className="flex flex-col gap-groupe text-sm text-ink-2"
                  htmlFor="nettoyage-date"
                >
                  Date d'exécution
                  <input
                    id="nettoyage-date"
                    type="date"
                    className={CLASSE_CHAMP}
                    value={dateExecution}
                    onChange={(e) => setDateExecution(e.target.value)}
                  />
                </label>
                <label
                  className="flex flex-col gap-groupe text-sm text-ink-2"
                  htmlFor="nettoyage-par"
                >
                  Exécuté par (optionnel)
                  <input
                    id="nettoyage-par"
                    type="text"
                    className={CLASSE_CHAMP}
                    value={executePar}
                    onChange={(e) => setExecutePar(e.target.value)}
                  />
                </label>
                <label
                  className="flex flex-col gap-groupe text-sm text-ink-2"
                  htmlFor="nettoyage-observations"
                >
                  Observations (optionnel)
                  <input
                    id="nettoyage-observations"
                    type="text"
                    className={CLASSE_CHAMP}
                    value={observations}
                    onChange={(e) => setObservations(e.target.value)}
                  />
                </label>

                <div className="flex items-center gap-groupe">
                  <button
                    type="submit"
                    disabled={dateExecution === '' || etatEcriture.statut === 'en_cours'}
                    className={`${CLASSE_BOUTON_PRIMAIRE} w-full`}
                  >
                    {etatEcriture.statut === 'en_cours' ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </div>
                {etatEcriture.statut === 'succes' && (
                  <p role="status" className="text-sm text-conforme">
                    {etatEcriture.message}
                  </p>
                )}
                {etatEcriture.statut === 'erreur' && <BandeErreur message={etatEcriture.message} />}
              </form>
            </Panneau>
          </div>
        )}
      </div>

      <Panneau titre="Exécutions récentes" sansRembourrage>
        <div className="flex flex-wrap items-end gap-bloc border-b border-line px-4 py-3">
          <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="executions-debut">
            Du
            <input
              id="executions-debut"
              type="date"
              className={`${CLASSE_CHAMP} w-40`}
              value={debutExecutions}
              onChange={(e) => setDebutExecutions(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="executions-fin">
            Au
            <input
              id="executions-fin"
              type="date"
              className={`${CLASSE_CHAMP} w-40`}
              value={finExecutions}
              onChange={(e) => setFinExecutions(e.target.value)}
            />
          </label>
        </div>

        {etatExecutions.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Chargement…</p>
        )}
        {etatExecutions.statut === 'erreur' && (
          <div className="px-4 py-2">
            <BandeErreur message={etatExecutions.message} />
          </div>
        )}
        {etatExecutions.statut === 'pret' && (
          <Tableau
            colonnes={COLONNES_EXECUTIONS}
            lignes={etatExecutions.executions}
            cleLigne={(e) => e.id}
            etatVide={
              <EtatVide
                variante="filtre"
                explicationFiltre="Aucune exécution enregistrée sur la période choisie."
                onReinitialiser={() => {
                  setDebutExecutions(ajouterJours(aujourdHui(), -30));
                  setFinExecutions(aujourdHui());
                }}
              />
            }
          />
        )}
      </Panneau>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Onglet 3 — Non-conformités
   ═══════════════════════════════════════════════════════════════════════════ */

const LIBELLE_GRAVITE: Readonly<Record<GraviteNonConformiteContrat, string>> = {
  mineure: 'Mineure',
  majeure: 'Majeure',
  critique: 'Critique',
};

/** Statut d'OUVERTURE, pas de gravité : une non-conformité résolue est
 * conforme quelle que soit sa gravité passée, une non-conformité ouverte
 * attend toujours une action, quelle que soit sa gravité. La gravité se lit
 * en texte simple dans sa propre colonne, sans porter de couleur — ce serait
 * un second signal colore sur la meme ligne, contraire a docs/07 §4.5. */
function statutAffichageNonConformite(dateResolution: string | null): Statut {
  return dateResolution === null ? 'alerte' : 'conforme';
}

/**
 * Largeurs revues le 31/07/2026 : ce tableau sert au fil de l'onglet
 * « Non-conformités » ET dans « Traçabilité » (non-conformités rattachées à
 * un lot), toujours à pleine largeur (1022 px) — SAUF quand un panneau de
 * détail est ouvert à côté de la liste, où il se réduit à ~614 px. Mesuré
 * dans cet état : `date` (« 31/07/2026 »), `gravite` (« Majeure ») et
 * `statut` (« ▲Ouverte ») se coupaient, alors que ce sont trois valeurs
 * courtes — une date et un statut sont des identifiants qualitatifs
 * (docs/07 §4.5), jamais à l'ellipse. `type`/`description`/`action` restent
 * en ellipse + infobulle `titre` (texte libre, longueur non bornée : même
 * compromis que `Type d'action`/`Description` ailleurs dans le produit).
 */
const COLONNES_NON_CONFORMITES: ReadonlyArray<ColonneTableau<NonConformiteContrat>> = [
  {
    cle: 'date',
    libelle: 'Constatée le',
    largeur: '18%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (n) => formaterDate(n.dateConstat),
  },
  {
    cle: 'type',
    libelle: 'Type',
    largeur: '15%',
    alignement: 'texte',
    rendu: (n) => n.type,
    titre: (n) => n.type,
  },
  {
    cle: 'gravite',
    libelle: 'Gravité',
    largeur: '13%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (n) => LIBELLE_GRAVITE[n.gravite],
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    largeur: '16%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (n) => (
      <PastilleStatut
        statut={statutAffichageNonConformite(n.dateResolution)}
        libelle={n.dateResolution === null ? 'Ouverte' : 'Résolue'}
      />
    ),
  },
  {
    cle: 'description',
    libelle: 'Description',
    largeur: '23%',
    alignement: 'texte',
    rendu: (n) => n.description,
    titre: (n) => n.description,
  },
  {
    cle: 'action',
    libelle: 'Action corrective',
    largeur: '15%',
    alignement: 'texte',
    rendu: (n) => ouTiret(n.actionCorrective, (v) => v),
    titre: (n) => ouTiret(n.actionCorrective, (v) => v),
  },
];

type EtatNonConformites =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; nonConformites: NonConformiteContrat[]; total: number };

/**
 * Existe-t-il, dans TOUT le registre des relevés, au moins un relevé hors
 * seuil ? Sert UNIQUEMENT à décider si l'état vide de cet onglet peut affirmer
 * « situation attendue » (docs/17 fiche 15) : depuis que `enregistrerRelevé
 * Temperature` ouvre automatiquement une non-conformité liée, un relevé hors
 * seuil FUTUR ne laissera plus jamais cette liste vide — mais un relevé
 * ANTÉRIEUR à cette règle peut encore exister sans non-conformité liée
 * (CLAUDE.md §7 : on ne fabrique pas de registre a posteriori). `'chargement'`
 * est traité comme `'existe'` : tant que la vérification n'a pas positivement
 * conclu à une absence, l'écran ne rassure pas à tort.
 */
type EtatReleveHorsSeuil = 'chargement' | 'aucun' | 'existe' | 'echec_verification';

function OngletNonConformites() {
  const [etatListe, setEtatListe] = useState<EtatNonConformites>({ statut: 'chargement' });
  const [etatReleveHorsSeuil, setEtatReleveHorsSeuil] = useState<EtatReleveHorsSeuil>('chargement');

  const [dateConstat, setDateConstat] = useState(aujourdHui);
  const [type, setType] = useState('');
  const [description, setDescription] = useState('');
  const [gravite, setGravite] = useState<GraviteNonConformiteContrat>('mineure');
  const [actionDeclaration, setActionDeclaration] = useState('');
  // Rattachement OPTIONNEL à un lot précis (numéro fournisseur, ou identifiant
  // technique si le numéro est ambigu — voir `resoudreLotId`,
  // `packages/db/src/depots/tracabilite.ts`). Le champ existait déjà côté
  // contrat et service (`schemaCreationNonConformite.lotId`) mais aucun écran
  // ne le proposait : une non-conformité de type « ce lot sent mauvais » ou
  // « bloqué suite à rappel fournisseur » ne pouvait donc jamais être
  // reliée au lot concerné, ce qui est exactement l'information qu'un
  // contrôle réclame en premier.
  const [lotIdDeclaration, setLotIdDeclaration] = useState('');
  const [etatDeclaration, setEtatDeclaration] = useState<EtatEcriture>({ statut: 'inactif' });

  const [selectionneeId, setSelectionneeId] = useState<string | null>(null);
  const [dateResolution, setDateResolution] = useState(aujourdHui);
  const [actionCloture, setActionCloture] = useState('');
  const [etatCloture, setEtatCloture] = useState<EtatEcriture>({ statut: 'inactif' });

  useEffect(() => {
    let annule = false;
    requeteApi<unknown>('/afsca/non-conformites')
      .then((reponse) => {
        const liste = schemaListeNonConformites.parse(reponse);
        if (!annule)
          setEtatListe({ statut: 'pret', nonConformites: liste.data, total: liste.meta.total });
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
  }, []);

  // Verification CROISEE, best-effort : sans elle, un relevé hors seuil saisi
  // AVANT la fiche 15 (donc sans non-conformité liée) laisserait cet onglet
  // affirmer « situation attendue » alors qu'un relevé de température est
  // toujours hors seuil dans le registre voisin.
  useEffect(() => {
    let annule = false;
    requeteApi<unknown>('/afsca/temperatures')
      .then((reponse) => {
        if (annule) return;
        const liste = schemaListeRelevesTemperature.parse(reponse);
        setEtatReleveHorsSeuil(liste.data.some((r) => !r.conforme) ? 'existe' : 'aucun');
      })
      .catch(() => {
        // Echec de la verification (CLAUDE.md §4 : jamais de catch silencieux) :
        // rester dans l'etat le plus prudent plutot que de supposer une
        // absence, MAIS sans etat dedie le message affirmerait a tort qu'un
        // relevé hors seuil a ete CONSTATE alors que la verification n'a
        // simplement pas pu s'executer — deux faits differents.
        if (!annule) setEtatReleveHorsSeuil('echec_verification');
      });
    return () => {
      annule = true;
    };
  }, []);

  useEffect(() => {
    if (selectionneeId === null) return;
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key === 'Escape') setSelectionneeId(null);
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [selectionneeId]);

  useEffect(() => {
    if (etatDeclaration.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatDeclaration({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatDeclaration]);

  useEffect(() => {
    if (etatCloture.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatCloture({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatCloture]);

  const peutDeclarer =
    dateConstat !== '' &&
    type.trim() !== '' &&
    description.trim() !== '' &&
    etatDeclaration.statut !== 'en_cours';

  const erreurLotDeclaration =
    etatDeclaration.statut === 'erreur' ? etatDeclaration.champs?.lotId : undefined;

  async function declarer(): Promise<void> {
    if (!peutDeclarer) return;
    setEtatDeclaration({ statut: 'en_cours' });
    try {
      const corps = {
        dateConstat,
        type: type.trim(),
        description: description.trim(),
        gravite,
        actionCorrective: actionDeclaration.trim() === '' ? null : actionDeclaration.trim(),
        lotId: lotIdDeclaration.trim() === '' ? null : lotIdDeclaration.trim(),
      };
      const reponse = await requeteApi<unknown>('/afsca/non-conformites', {
        method: 'POST',
        body: JSON.stringify(corps),
      });
      const creee = schemaNonConformite.parse(reponse);
      setEtatListe((precedent) =>
        precedent.statut === 'pret'
          ? {
              statut: 'pret',
              nonConformites: [creee, ...precedent.nonConformites],
              total: precedent.total + 1,
            }
          : precedent,
      );
      setType('');
      setDescription('');
      setActionDeclaration('');
      setLotIdDeclaration('');
      setEtatDeclaration({ statut: 'succes', message: 'Non-conformité déclarée.' });
    } catch (erreur) {
      if (erreur instanceof ErreurApi) {
        setEtatDeclaration({
          statut: 'erreur',
          message: erreur.message,
          ...(erreur.champs !== undefined ? { champs: erreur.champs } : {}),
        });
        // Meme reflexe que le formulaire de temperature : le focus va sur le
        // champ fautif, la saisie n'est jamais perdue (docs/07 §4.7).
        if (erreur.champs?.lotId !== undefined) {
          document.getElementById('nc-lot')?.focus();
        }
      } else {
        setEtatDeclaration({
          statut: 'erreur',
          message: 'Erreur inattendue, sans plus de détail.',
        });
      }
    }
  }

  function selectionner(id: string, dateResolutionExistante: string | null): void {
    setSelectionneeId((precedent) => (precedent === id ? null : id));
    setDateResolution(dateResolutionExistante ?? aujourdHui());
    setActionCloture('');
    setEtatCloture({ statut: 'inactif' });
  }

  async function cloturer(): Promise<void> {
    if (selectionneeId === null || dateResolution === '' || actionCloture.trim() === '') return;
    if (etatCloture.statut === 'en_cours') return;

    setEtatCloture({ statut: 'en_cours' });
    try {
      const corps = { dateResolution, actionCorrective: actionCloture.trim() };
      const reponse = await requeteApi<unknown>(
        `/afsca/non-conformites/${selectionneeId}/cloturer`,
        {
          method: 'POST',
          body: JSON.stringify(corps),
        },
      );
      const misAJour = schemaNonConformite.parse(reponse);
      setEtatListe((precedent) =>
        precedent.statut === 'pret'
          ? {
              statut: 'pret',
              nonConformites: precedent.nonConformites.map((n) =>
                n.id === misAJour.id ? misAJour : n,
              ),
              total: precedent.total,
            }
          : precedent,
      );
      setEtatCloture({ statut: 'succes', message: 'Non-conformité clôturée.' });
    } catch (erreur) {
      setEtatCloture({
        statut: 'erreur',
        message:
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
      });
    }
  }

  const nonConformiteSelectionnee =
    etatListe.statut === 'pret'
      ? (etatListe.nonConformites.find((n) => n.id === selectionneeId) ?? null)
      : null;

  return (
    <div className="flex flex-col gap-bloc">
      <Panneau titre="Déclarer une non-conformité">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void declarer();
          }}
          className="flex flex-col gap-bloc"
        >
          <div className="flex flex-wrap items-end gap-bloc">
            <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="nc-date">
              Constatée le
              <input
                id="nc-date"
                type="date"
                className={`${CLASSE_CHAMP} w-40`}
                value={dateConstat}
                onChange={(e) => setDateConstat(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="nc-type">
              Type
              <input
                id="nc-type"
                type="text"
                placeholder="ex. chaîne du froid, hygiène du stand…"
                className={`${CLASSE_CHAMP} w-64`}
                value={type}
                onChange={(e) => setType(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="nc-gravite">
              Gravité
              <select
                id="nc-gravite"
                className={`${CLASSE_CHAMP} w-36`}
                value={gravite}
                onChange={(e) => setGravite(e.target.value as GraviteNonConformiteContrat)}
              >
                {Object.entries(LIBELLE_GRAVITE).map(([cle, libelle]) => (
                  <option key={cle} value={cle}>
                    {libelle}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="nc-description">
            Description
            <input
              id="nc-description"
              type="text"
              className={CLASSE_CHAMP}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <label
            className="flex flex-col gap-groupe text-sm text-ink-2"
            htmlFor="nc-action-declaration"
          >
            Action corrective déjà prise (optionnel)
            <input
              id="nc-action-declaration"
              type="text"
              className={CLASSE_CHAMP}
              value={actionDeclaration}
              onChange={(e) => setActionDeclaration(e.target.value)}
            />
          </label>

          {/* Rattachement à un lot précis — voir le commentaire de
              `lotIdDeclaration` plus haut. Sans ce champ, une non-conformité
              du type « bloqué suite à rappel fournisseur » ou « ce lot sent
              mauvais » n'avait AUCUN moyen d'être reliée au lot concerné,
              alors que le contrat et le service le permettaient déjà. */}
          <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="nc-lot">
            Lot concerné (optionnel)
            <input
              id="nc-lot"
              type="text"
              placeholder="identifiant technique du lot"
              className={CLASSE_CHAMP}
              value={lotIdDeclaration}
              onChange={(e) => setLotIdDeclaration(e.target.value)}
              aria-invalid={erreurLotDeclaration !== undefined}
              aria-describedby={erreurLotDeclaration !== undefined ? 'nc-lot-erreur' : undefined}
            />
          </label>
          {erreurLotDeclaration !== undefined ? (
            <p id="nc-lot-erreur" className="text-sm text-depassement">
              {erreurLotDeclaration}
            </p>
          ) : (
            <p className="text-xs text-ink-3">
              Uniquement si cette non-conformité concerne un lot précis (rappel fournisseur, doute
              sur la conformité…). L'identifiant technique se trouve dans Stock, en ouvrant le
              détail du lot.
            </p>
          )}

          <div className="flex items-center gap-groupe">
            <button
              type="submit"
              disabled={!peutDeclarer}
              className={`${CLASSE_BOUTON_PRIMAIRE} w-56`}
            >
              {etatDeclaration.statut === 'en_cours' ? 'Enregistrement…' : 'Déclarer'}
            </button>
            {etatDeclaration.statut === 'succes' && (
              <p role="status" className="text-sm text-conforme">
                {etatDeclaration.message}
              </p>
            )}
          </div>
          {etatDeclaration.statut === 'erreur' && <BandeErreur message={etatDeclaration.message} />}
        </form>
      </Panneau>

      {etatListe.statut === 'chargement' && <p className="text-sm text-ink-3">Chargement…</p>}
      {etatListe.statut === 'erreur' && <BandeErreur message={etatListe.message} />}
      {etatListe.statut === 'pret' && (
        <div className="flex flex-col items-start gap-bloc lg:flex-row">
          <div className="min-w-0 flex-1 self-stretch">
            <Panneau
              titre={compteAccorde(etatListe.total, 'non-conformité', 'non-conformités')}
              sansRembourrage
            >
              <Tableau
                colonnes={COLONNES_NON_CONFORMITES}
                lignes={etatListe.nonConformites}
                cleLigne={(n) => n.id}
                {...(selectionneeId !== null ? { ligneSelectionneeCle: selectionneeId } : {})}
                onSelectionnerLigne={(n) => selectionner(n.id, n.dateResolution)}
                etatVide={
                  <EtatVide
                    variante="normal"
                    texte={
                      etatReleveHorsSeuil === 'aucun'
                        ? 'Aucune non-conformité déclarée. C’est la situation attendue.'
                        : etatReleveHorsSeuil === 'existe'
                          ? 'Aucune non-conformité déclarée — mais au moins un relevé de ' +
                            'température dépasse le seuil : vérifiez l’onglet Températures.'
                          : etatReleveHorsSeuil === 'echec_verification'
                            ? 'Aucune non-conformité déclarée — la vérification croisée avec le ' +
                              'registre des températures a échoué : vérifiez l’onglet ' +
                              'Températures par prudence.'
                            : 'Aucune non-conformité déclarée.'
                    }
                  />
                }
              />
            </Panneau>
          </div>

          {nonConformiteSelectionnee !== null && (
            <div className="w-full lg:w-[23.75rem] lg:shrink-0">
              <Panneau titre={nonConformiteSelectionnee.type} sansRembourrage>
                <div className="flex items-center justify-between border-b border-line px-4 py-2">
                  <p className="text-xs text-ink-3">
                    {formaterDate(nonConformiteSelectionnee.dateConstat)} —{' '}
                    {LIBELLE_GRAVITE[nonConformiteSelectionnee.gravite]}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelectionneeId(null)}
                    className="text-xs font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Fermer
                  </button>
                </div>

                <p className="border-b border-line px-4 py-2 text-sm text-ink-2">
                  {nonConformiteSelectionnee.description}
                </p>

                {/* `lotId` n'est qu'un identifiant technique ici : ce panneau
                    n'a pas les données du lot (nom d'ingrédient, numéro
                    fournisseur) sous la main, et les redemander romprait la
                    règle n°1 (aucun calcul, aucun enrichissement ici). On
                    rend donc l'identifiant tel quel — sélectionnable pour être
                    recollé dans la recherche « Aval » de l'onglet
                    Traçabilité, qui l'accepte directement. */}
                {nonConformiteSelectionnee.lotId !== null && (
                  <p className="border-b border-line px-4 py-2 text-xs text-ink-3">
                    Lot concerné :{' '}
                    <span className="select-all font-mono text-2xs text-ink-2">
                      {nonConformiteSelectionnee.lotId}
                    </span>
                  </p>
                )}

                {nonConformiteSelectionnee.dateResolution === null ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void cloturer();
                    }}
                    className="flex flex-col gap-bloc px-4 py-3"
                  >
                    <h3 className="text-2xs uppercase text-ink-3">Clôturer</h3>
                    <label
                      className="flex flex-col gap-groupe text-sm text-ink-2"
                      htmlFor="nc-date-resolution"
                    >
                      Date de résolution
                      <input
                        id="nc-date-resolution"
                        type="date"
                        className={CLASSE_CHAMP}
                        value={dateResolution}
                        onChange={(e) => setDateResolution(e.target.value)}
                      />
                    </label>
                    <label
                      className="flex flex-col gap-groupe text-sm text-ink-2"
                      htmlFor="nc-action-cloture"
                    >
                      Action corrective prise
                      <input
                        id="nc-action-cloture"
                        type="text"
                        className={CLASSE_CHAMP}
                        value={actionCloture}
                        onChange={(e) => setActionCloture(e.target.value)}
                      />
                    </label>
                    <div className="flex items-center gap-groupe">
                      <button
                        type="submit"
                        disabled={
                          dateResolution === '' ||
                          actionCloture.trim() === '' ||
                          etatCloture.statut === 'en_cours'
                        }
                        className={`${CLASSE_BOUTON_PRIMAIRE} w-full`}
                      >
                        {etatCloture.statut === 'en_cours' ? 'Clôture…' : 'Clôturer'}
                      </button>
                    </div>
                    {etatCloture.statut === 'erreur' && (
                      <BandeErreur message={etatCloture.message} />
                    )}
                  </form>
                ) : (
                  <p className="px-4 py-3 text-sm text-ink-2">
                    Clôturée le {formaterDate(nonConformiteSelectionnee.dateResolution)}.{' '}
                    {nonConformiteSelectionnee.actionCorrective !== null && (
                      <>Action corrective : {nonConformiteSelectionnee.actionCorrective}</>
                    )}
                  </p>
                )}
                {/* Hors du ternaire (défaut connu corrigé le 28/09/2026) : la
                    clôture réussie donne à la non-conformité sa date de
                    résolution, ce qui démonte le formulaire au même rendu. Un
                    message posé DANS le formulaire n'était donc jamais visible. */}
                {etatCloture.statut === 'succes' && (
                  <p role="status" className="px-4 pb-3 text-sm text-conforme">
                    {etatCloture.message}
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

/* ═══════════════════════════════════════════════════════════════════════════
   Onglet 4 — Traçabilité amont / aval
   ═══════════════════════════════════════════════════════════════════════════ */

type ConsommationAmont =
  TracabiliteAmontSessionContrat['productions'][number]['consommations'][number];
type ProductionAval = TracabiliteAvalLotContrat['productions'][number];
type RevenduAmont = TracabiliteAmontSessionContrat['revendus'][number];
type GarnitureAmont = TracabiliteAmontSessionContrat['garnitures'][number];
type VenteAval = TracabiliteAvalLotContrat['ventes'][number];
type GarnitureAval = TracabiliteAvalLotContrat['garnitures'][number];

const LIBELLE_STATUT_LOT: Readonly<Record<StatutLot, string>> = {
  disponible: 'Disponible',
  quarantaine: 'En quarantaine',
  bloque: 'Bloqué',
  detruit: 'Détruit',
};

/**
 * Couleur du statut d'un LOT — domaine différent de la table de couleurs de
 * `PastilleStatut` (`composants/affichage.tsx`, qui code la conformité d'une
 * mesure, trois valeurs) : les réutiliser telles quelles aurait fait vivre une
 * correspondance à quatre valeurs sur un type qui n'en accepte que trois.
 * `disponible` et `detruit`
 * restent neutres : le premier est l'état courant sans rien à signaler, le
 * second est un état FINAL décidé (pas une alerte qui attend une action).
 * `quarantaine` (un doute à lever) et `bloque` (matière retirée de la vente
 * sans qu'une décision définitive ait été prise) sont les deux seuls qui
 * demandent un regard.
 */
const CLASSE_STATUT_LOT: Readonly<Record<StatutLot, string>> = {
  disponible: 'text-ink-2',
  quarantaine: 'text-alerte',
  bloque: 'text-depassement',
  detruit: 'text-ink-3',
};

function PastilleStatutLot({ statut }: { statut: StatutLot }) {
  return (
    <span className={`font-medium ${CLASSE_STATUT_LOT[statut]}`}>{LIBELLE_STATUT_LOT[statut]}</span>
  );
}

/**
 * Dernier changement de statut d'un lot — `motifStatutLibelle` et
 * `dateChangementStatut` (`packages/db/src/depots/tracabilite.ts`,
 * `TracabiliteAvalLot`).
 *
 * DÉFAUT CORRIGÉ (audit du 30/07/2026, `audit-colonnes-orphelines.test.ts`) :
 * `lot.motif_statut_id` et `lot.date_changement_statut` sont écrites à CHAQUE
 * changement de statut (`changerStatutLot`, `services/mouvements.ts`) — la
 * trace exacte qu'un contrôle AFSCA vient chercher, « pourquoi ce lot a-t-il
 * été bloqué, et quand » — mais n'étaient exposées nulle part avant ce
 * correctif, y compris sur cet écran.
 *
 * Rendu SEULEMENT quand `motifStatutLibelle` n'est pas `null` : un lot resté
 * `disponible` depuis sa réception n'a jamais changé de statut, et ne doit
 * donc afficher aucun motif — jamais « aucun motif » à la place d'un silence
 * (CLAUDE.md §7).
 */
function DernierChangementStatutLot({
  motifStatutLibelle,
  dateChangementStatut,
}: {
  motifStatutLibelle: string | null;
  dateChangementStatut: string | null;
}) {
  if (motifStatutLibelle === null) return null;
  return (
    <>
      {' '}
      — dernier changement
      {dateChangementStatut !== null ? ` le ${formaterDateHeure(dateChangementStatut)}` : ''} :{' '}
      {motifStatutLibelle}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TROIS QUANTITÉS, ET DEUX COLONNES — la décision du 01/08/2026
   ═══════════════════════════════════════════════════════════════════════════

   Une ligne de consommation porte désormais TROIS quantités, qui ne disent pas
   la même chose :

     - `quantiteTheorique`   ce que la recette prévoyait de prendre SUR CE LOT.
                             `0` — un VRAI zéro — pour un lot que la fournée
                             n'avait pas prévu ;
     - `quantiteReelle`      ce que le porteur a DÉCLARÉ, pour l'INGRÉDIENT
                             entier. `null` dès que la fournée a puisé dans
                             plusieurs lots : la déclaration n'est alors
                             attribuable à aucun lot sans inventer une
                             répartition ;
     - `quantiteMouvementee` ce que le STOCK a enregistré, LOT PAR LOT (net
                             signé des mouvements). Toujours connue, toujours
                             attribuable.

   Sur une SUR-CONSOMMATION, les deux dernières diffèrent légitimement : la
   matière en trop est prise en FEFO sur le stock du jour, donc possiblement
   sur un lot que la fournée n'avait jamais prévu. Elles ne sont PAS
   interchangeables.

   ═══ Ce que les tableaux ci-dessous affichent, et ce qu'ils n'affichent plus ═══

   Une HUITIÈME colonne était exclue : `COLONNES_CONSOMMATIONS_AMONT` en compte
   déjà sept, et le budget de largeur mesuré au 31/07/2026 (819 px de besoin
   réel pour 978 px disponibles à 1280 px) ne laisse pas la place d'une colonne
   numérique de plus sans reprendre les pixels sur `Ingrédient` (155 px requis)
   et `Fournisseur` (196 px) — les deux colonnes que la décision d'empiler
   Amont/Aval venait précisément de sortir d'une troncature à un ou deux
   caractères.

   C'est donc « Réel » qui CÈDE SA PLACE à « Sorti du lot ». Ce que le porteur
   perd, dit franchement : la quantité DÉCLARÉE n'est plus lisible sur cet
   écran. Elle reste consultable sur le détail d'une production
   (`Production.tsx`, panneau « Consommations »), et elle était de toute façon
   la seule des trois à ne PAS être attribuable à la ligne où elle s'affichait
   — un registre de traçabilité présentait ainsi, sur une ligne de LOT, un
   chiffre qui parlait de l'INGRÉDIENT.

   L'en-tête est RENOMMÉ, jamais réutilisé tel quel : garder « Réel » en lui
   faisant lire une autre valeur ferait relire le nouveau chiffre avec
   l'ancienne signification, ce qui est le pire des deux mondes.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Marque NEUTRE : ce lot n'était PAS prévu par la fournée, et il l'a pourtant
 * alimentée. C'est exactement ce qu'un rappel sanitaire cherche (CLAUDE.md §3
 * règle 6) — s'il se lit comme les autres, il sera lu comme les autres.
 *
 * POSÉE DANS LA CELLULE « Théorique », et pas ailleurs : c'est CE `0` qui
 * induit en erreur. Seul, il se lit « ce lot n'a rien fourni », soit l'inverse
 * de la vérité ; la marque le corrige à l'endroit exact où le contresens se
 * produit, sans que l'œil ait à chercher l'explication dans une autre colonne.
 *
 * NEUTRE (`text-ink-3`), et non `text-alerte` : une sur-consommation comblée
 * par un autre lot est un événement NORMAL du stock, pas une non-conformité.
 * Même raisonnement que `BadgeReceptionAnnulee` plus haut, et même garde-fou
 * que les 78 emplacements corrigés le 01/08/2026 — le registre d'alerte métier
 * doit rester rare pour rester lu.
 *
 * Le TEXTE porte l'information, l'infobulle n'ajoute que la phrase longue :
 * une infobulle native n'est pas exposée au clavier (CLAUDE.md §3 règle 10),
 * elle ne peut donc jamais être le seul support d'un fait réglementaire. Le
 * vocabulaire « hors fournée » est celui déjà employé par `Production.tsx`
 * pour le même événement.
 *
 * Ne dépend QUE de `quantiteTheorique` : « rien n'était prévu de ce lot » est
 * une lecture d'un seul champ, pas une comparaison entre deux (CLAUDE.md §3
 * règle 1 — ce composant ne calcule aucun net, il n'en met aucun en regard).
 */
export function BadgeLotHorsFournee({ quantiteTheorique }: { quantiteTheorique: number }) {
  if (quantiteTheorique !== 0) return null;
  return (
    <span
      className="ml-groupe text-ink-3"
      title="Ce lot n’était pas prévu par cette fournée : il n’a servi qu’à combler un écart de consommation déclaré après coup. Ce qui en est réellement sorti est dans la colonne « Sorti du lot »."
    >
      — hors fournée
    </span>
  );
}

/**
 * Ces deux contrats ne portent pas l'unite de l'ingredient (contrairement a
 * `LigneStockContrat`) : on affiche donc un entier nu, sans kg ni ml. C'est
 * une limite du contrat existant, pas un calcul manquant de ce composant —
 * les fichiers de contrat sont hors perimetre de cette tache.
 *
 * Largeurs REVUES le 31/07/2026, puis RECALCULÉES le même jour après la
 * décision d'empiler Amont/Aval au lieu de les mettre côte à côte (voir le
 * commentaire du conteneur `grid`, plus bas dans `OngletTracabilite`) : ce
 * tableau passe de 464 px (une des DEUX colonnes d'une grille `lg:grid-cols-2`)
 * à ~978 px (panneau en pleine largeur), mesuré à 1280 px effectifs.
 *
 * Les pourcentages ci-dessous ne sont PAS les mêmes qu'avant l'empilement :
 * les reconduire tels quels aurait laissé `Fournisseur` à 6 % — 59 px à
 * 978 px, quand son besoin réel mesuré (`table-layout: auto`, même méthode
 * que le 31/07) est de 196 px. Élargir le conteneur SANS rééquilibrer les
 * colonnes n'aurait rien résolu : ce sont les proportions qui doivent changer,
 * pas seulement la largeur totale. Nouvelle répartition, mesurée sur la MÊME
 * session réelle (8 lignes de consommation) : `Ingrédient` (155 px requis),
 * `N° lot fournisseur` (148 px), `Fournisseur` (196 px), `Réception`/`DLC`
 * (90 px chacune), `Théorique` (87 px), `Réel` (53 px) — total 819 px pour
 * 978 px disponibles, avec une marge sur chaque colonne. `Ingrédient` et
 * `Fournisseur` gardent l'ellipse + infobulle `titre` : à cette largeur, la
 * troncature ne joue plus que sur les noms les plus longs, plus sur la
 * première lettre. `Théorique` et `Réel` sont les deux seules colonnes qui ne
 * tolèrent aucune troncature sous AUCUNE forme (docs/07 §4.5) : elles gardent
 * une marge large. `N° lot fournisseur` reste en `repli` (c'est le champ du
 * rappel produit, CLAUDE.md §3 règle 6) avec une largeur qui lui évite
 * désormais de s'enrouler sur plus d'une ligne pour la plupart des numéros.
 *
 * REDISTRIBUÉES le 01/08/2026, quand « Réel » a cédé la place à
 * « Sorti du lot » (voir le bloc « TROIS QUANTITÉS, ET DEUX COLONNES »
 * ci-dessus). Le NOMBRE de colonnes ne change pas — sept avant, sept après —
 * mais deux d'entre elles ont un besoin plus large qu'avant : « Sorti du lot »
 * est un en-tête de douze caractères là où « Réel » en faisait quatre (53 px
 * mesurés), et « Théorique » accueille désormais la marque « hors fournée ».
 * Les 24 px repris le sont sur `Ingrédient`, `N° lot fournisseur` et
 * `Fournisseur`, tous trois encore au-dessus de leur besoin mesuré
 * (176/166/205 px alloués à 1280 px, pour 155/148/196 requis).
 *
 * HONNÊTEMENT : ces pourcentages sont RECALCULÉS à partir des besoins déjà
 * mesurés au navigateur le 31/07, ils n'ont PAS été re-mesurés à l'écran —
 * `Sorti du lot` et la marque « hors fournée » sont les deux seuls contenus
 * dont la largeur réelle reste estimée, et c'est ce qui reste à vérifier au
 * navigateur. Les deux colonnes concernées portent `troncature: 'repli'`, ce
 * qui rend une estimation trop basse coûteuse en HAUTEUR (la cellule
 * s'enroule) mais jamais en information perdue : un nombre ne peut pas y être
 * tronqué (docs/07 §4.5).
 */
const COLONNES_CONSOMMATIONS_AMONT: ReadonlyArray<ColonneTableau<ConsommationAmont>> = [
  {
    cle: 'ingredient',
    libelle: 'Ingrédient',
    largeur: '18%',
    alignement: 'texte',
    rendu: (c) => c.ingredientNom,
    titre: (c) => c.ingredientNom,
  },
  {
    cle: 'lot',
    libelle: 'N° lot fournisseur',
    largeur: '17%',
    alignement: 'texte',
    // C'EST le champ qui sert a rappeler une marchandise. Les numeros d'un meme
    // fournisseur partagent leur prefixe et ne different que par la fin :
    // tronquer par la fin rend deux lots indiscernables. Obligation de
    // tracabilite (CLAUDE.md §3 regle 6), pas une preference visuelle.
    troncature: 'repli',
    rendu: (c) => ouTiret(c.numeroLotFournisseur, (v) => v),
  },
  {
    cle: 'fournisseur',
    libelle: 'Fournisseur',
    largeur: '21%',
    alignement: 'texte',
    rendu: (c) => c.fournisseurNom,
    titre: (c) => c.fournisseurNom,
  },
  {
    cle: 'reception',
    libelle: 'Réception',
    largeur: '10%',
    alignement: 'texte',
    rendu: (c) => (
      <>
        {formaterDate(c.dateReception)}
        <BadgeReceptionAnnulee statut={c.receptionStatut} />
      </>
    ),
  },
  {
    cle: 'dlc',
    libelle: 'DLC',
    largeur: '10%',
    alignement: 'texte',
    rendu: (c) => ouTiret(c.dateDlc, (d) => formaterDate(d)),
  },
  {
    cle: 'theorique',
    libelle: 'Théorique',
    largeur: '12%',
    alignement: 'nombre',
    // `repli` OBLIGATOIRE depuis que la cellule porte la marque « hors
    // fournée » : avec la troncature par défaut, l'ellipse mangerait la marque
    // avant le nombre, et le lot du rappel redeviendrait un « 0 » muet.
    troncature: 'repli',
    rendu: (c) => (
      <>
        {formaterEntier(c.quantiteTheorique)}
        <BadgeLotHorsFournee quantiteTheorique={c.quantiteTheorique} />
      </>
    ),
  },
  {
    // REMPLACE « Réel » (`quantiteReelle`) depuis le 01/08/2026 — voir le bloc
    // « TROIS QUANTITÉS, ET DEUX COLONNES ». C'est le seul des trois chiffres
    // qui soit attribuable AU LOT de cette ligne, donc le seul qui réponde à
    // « combien de ce lot rappelé est parti dans cette pâte ? ».
    cle: 'sorti',
    libelle: 'Sorti du lot',
    largeur: '12%',
    alignement: 'nombre',
    // Un nombre ne se tronque sous aucune forme (docs/07 §4.5) ; l'en-tête, lui,
    // porte une espace où s'enrouler proprement.
    troncature: 'repli',
    // `0` est un VRAI zéro : la matière prise sur ce lot a été intégralement
    // restituée. Il s'affiche donc tel quel, jamais en « — » (CLAUDE.md §7).
    //
    // `ouTiret` est ici purement DÉFENSIF, et son coût est nul. Le champ est
    // REQUIS au contrat (`schemaTracabiliteAmontConsommation`) depuis le
    // 01/08/2026, et l'écran re-valide la charge avant de la rendre
    // (`rechercherAmont`) : `undefined` n'atteint plus cette ligne. Il reste
    // parce qu'un garde-fou de cohérence inatteignable se garde — il redevient
    // utile le jour où le contrat serait assoupli (docs/39 §6).
    rendu: (c) => ouTiret(c.quantiteMouvementee, (v) => formaterEntier(v)),
  },
];

/**
 * Marchandises REVENDUES d'une session — sirop, confiture, vendus tels quels.
 *
 * Elles n'apparaissent dans AUCUNE production : leur matière n'est transformée
 * par aucune recette, elles sortent du stock à la clôture. Sans ce tableau,
 * une denrée à DLC vendue au public serait absente du registre — or
 * l'obligation AFSCA ne fait aucune différence entre transformé et revendu.
 */
/**
 * Largeurs RECALCULÉES le 31/07/2026 après la décision d'empiler Amont/Aval
 * (voir le commentaire du conteneur `grid` dans `OngletTracabilite`) : ce
 * panneau passe de 464 px à ~978 px. Même correctif que sur
 * `COLONNES_CONSOMMATIONS_AMONT` ci-dessus : reconduire les anciens
 * pourcentages sur un conteneur plus large n'aurait rien réglé, il fallait
 * redistribuer. Besoins réels mesurés (`table-layout: auto`, même session) :
 * `Article` 177 px, `N° lot fournisseur` 163 px, `Fournisseur` 209 px,
 * `Réception`/`DLC` 88 px chacune, `Vendu` 66 px — total 791 px pour 978 px
 * disponibles. `Article`/`Fournisseur` gardent l'ellipse + infobulle `titre` :
 * ce ne sont pas le champ du rappel (`N° lot fournisseur` l'est, CLAUDE.md §3
 * règle 6), qui reste seul en `repli`, avec une largeur qui limite désormais
 * son propre enroulement à une seule ligne pour la plupart des numéros.
 */
const COLONNES_REVENDUS_AMONT: ReadonlyArray<ColonneTableau<RevenduAmont>> = [
  {
    cle: 'ingredient',
    libelle: 'Article',
    largeur: '22%',
    alignement: 'texte',
    rendu: (r) => r.ingredientNom,
    titre: (r) => r.ingredientNom,
  },
  {
    cle: 'lot',
    libelle: 'N° lot fournisseur',
    largeur: '20%',
    alignement: 'texte',
    // Même enjeu que pour les consommations : c'est le champ du rappel.
    troncature: 'repli',
    rendu: (r) => ouTiret(r.numeroLotFournisseur, (v) => v),
  },
  {
    cle: 'fournisseur',
    libelle: 'Fournisseur',
    largeur: '26%',
    alignement: 'texte',
    rendu: (r) => r.fournisseurNom,
    titre: (r) => r.fournisseurNom,
  },
  {
    cle: 'reception',
    libelle: 'Réception',
    largeur: '10%',
    alignement: 'texte',
    rendu: (r) => (
      <>
        {formaterDate(r.dateReception)}
        <BadgeReceptionAnnulee statut={r.receptionStatut} />
      </>
    ),
  },
  {
    cle: 'dlc',
    libelle: 'DLC',
    largeur: '10%',
    alignement: 'texte',
    rendu: (r) => ouTiret(r.dateDlc, (d) => formaterDate(d)),
  },
  {
    cle: 'quantite',
    libelle: 'Vendu',
    largeur: '12%',
    alignement: 'nombre',
    rendu: (r) => formaterEntier(r.quantite),
  },
];

/**
 * GARNITURES d'une session — ce qui a été étalé sur une crêpe au service.
 *
 * Tableau distinct des marchandises revendues, et ce n'est pas une préférence
 * de mise en page : le client d'un pot fermé emporte l'emballage, donc le
 * numéro de lot ; celui d'une crêpe garnie n'emporte rien. Seul le registre
 * peut alors dire quel lot est parti sur quel marché — c'est cette différence
 * qui décide de la portée d'un rappel. La colonne « Sur produit(s) » est ce que
 * le tableau des revendus n'a pas : elle relie le lot à l'assiette.
 */
/**
 * Largeurs RECALCULÉES le 31/07/2026 après la décision d'empiler Amont/Aval :
 * ce panneau passe de 464 px à ~978 px, mais reste le pire cas des trois
 * (SEPT colonnes). Besoins réels mesurés (`table-layout: auto`, même
 * session) : `Garniture` 230 px, `N° lot fournisseur` 156 px,
 * `Sur produit(s)` 246 px, `Fournisseur` 209 px, `Réception` 90 px, `DLC`
 * 86 px, `Étalé` 59 px — total 1077 px pour 978 px disponibles. Empiler ne
 * suffit donc PAS à éliminer toute troncature ICI (contrairement aux deux
 * tableaux voisins) : les trois colonnes de texte libre (`Garniture`,
 * `Sur produit(s)`, `Fournisseur`) se partagent ce qui reste une fois les
 * quatre colonnes protégées (lot, réception, DLC, étalé) servies à leur
 * besoin réel — environ 78 % de leur besoin chacune, contre 46-58 % avant
 * l'empilement. Concrètement : un nom qui affichait 1-2 caractères avant
 * l'ellipse en affiche désormais 25 à 30, l'infobulle `titre` restant le
 * recours pour le reste — la même dégradation gracieuse qu'ailleurs dans le
 * produit, simplement moins tendue. Seul `N° lot fournisseur` — le champ du
 * rappel — garde `repli`, avec une largeur qui limite son enroulement.
 *
 * Second passage, capture d'écran à l'appui : la première répartition
 * (9 %/9 %/8 % sur Réception/DLC/Étalé, soit 88/88/78 px) collait le besoin
 * mesuré au pixel près, SANS marge — `tabular-nums` rend les chiffres plus
 * larges que le texte ordinaire de même longueur mesuré hors contexte, et
 * `23/07/2026` (90 px réels) débordait de 2 px sur une colonne à 88 px,
 * suffisant pour déclencher l'ellipse sur une DATE. Un nombre ou une date
 * tronqués sont interdits sous toute forme (docs/07 §4.5) : ces trois
 * colonnes protégées reçoivent maintenant une marge mesurée (+10-12 px
 * chacune), reprise sur les trois colonnes de texte libre qui tolèrent déjà
 * l'ellipse par conception.
 */
const COLONNES_GARNITURES_AMONT: ReadonlyArray<ColonneTableau<GarnitureAmont>> = [
  {
    cle: 'ingredient',
    libelle: 'Garniture',
    largeur: '18%',
    alignement: 'texte',
    rendu: (g) => g.ingredientNom,
    titre: (g) => g.ingredientNom,
  },
  {
    cle: 'lot',
    libelle: 'N° lot fournisseur',
    largeur: '17%',
    alignement: 'texte',
    // Même enjeu que partout ailleurs dans cet onglet : un numéro tronqué est
    // un rappel qu'on ne peut pas effectuer.
    troncature: 'repli',
    rendu: (g) => ouTiret(g.numeroLotFournisseur, (v) => v),
  },
  {
    cle: 'produits',
    libelle: 'Sur produit(s)',
    largeur: '19%',
    alignement: 'texte',
    rendu: (g) => g.produits.join(', '),
    titre: (g) => g.produits.join(', '),
  },
  {
    cle: 'fournisseur',
    libelle: 'Fournisseur',
    largeur: '17%',
    alignement: 'texte',
    rendu: (g) => g.fournisseurNom,
    titre: (g) => g.fournisseurNom,
  },
  {
    cle: 'reception',
    libelle: 'Réception',
    largeur: '10%',
    alignement: 'texte',
    rendu: (g) => (
      <>
        {formaterDate(g.dateReception)}
        <BadgeReceptionAnnulee statut={g.receptionStatut} />
      </>
    ),
  },
  {
    cle: 'dlc',
    libelle: 'DLC',
    largeur: '10%',
    alignement: 'texte',
    rendu: (g) => ouTiret(g.dateDlc, (d) => formaterDate(d)),
  },
  {
    cle: 'quantite',
    libelle: 'Étalé',
    largeur: '9%',
    alignement: 'nombre',
    rendu: (g) => formaterEntier(g.quantite),
  },
];

/** Sorties en vente directe d'un lot : la réponse au « où est parti ce lot ? ». */
const COLONNES_VENTES_AVAL: ReadonlyArray<ColonneTableau<VenteAval>> = [
  {
    cle: 'session',
    libelle: 'Session',
    largeur: '58%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (v) =>
      `${v.session.numero} — ${v.session.lieuNom}, ${formaterDate(v.session.dateSession)}`,
  },
  {
    cle: 'date',
    libelle: 'Date de sortie',
    largeur: '24%',
    alignement: 'texte',
    rendu: (v) => formaterDate(v.dateMouvement),
  },
  {
    cle: 'quantite',
    libelle: 'Quantité',
    largeur: '18%',
    alignement: 'nombre',
    rendu: (v) => formaterEntier(v.quantite),
  },
];

/**
 * Sorties d'un lot ÉTALÉES sur une crêpe — le symétrique aval du tableau
 * précédent. Un même lot peut apparaître dans les trois blocs de ce panneau :
 * la vergeoise entre dans la pâte (production), s'étale au service (garniture),
 * et pourrait être vendue en sachet (vente). Trois usages, trois blocs.
 */
/**
 * Largeurs revues le 31/07/2026, même panneau de 464 px que les autres
 * tableaux de cet onglet. `Date de sortie` (identifiant) et `Quantité` (seule
 * colonne NUMÉRIQUE) se coupaient (109 px et 83 px nécessaires, 88 et 65
 * alloués) : la place est reprise sur `Session`/`Sur produit(s)`, déjà en
 * `repli`, qui l'absorbent en s'enroulant.
 */
const COLONNES_GARNITURES_AVAL: ReadonlyArray<ColonneTableau<GarnitureAval>> = [
  {
    cle: 'session',
    libelle: 'Session',
    largeur: '34%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (g) =>
      `${g.session.numero} — ${g.session.lieuNom}, ${formaterDate(g.session.dateSession)}`,
  },
  {
    cle: 'produits',
    libelle: 'Sur produit(s)',
    largeur: '20%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (g) => g.produits.join(', '),
    titre: (g) => g.produits.join(', '),
  },
  {
    cle: 'date',
    libelle: 'Date de sortie',
    largeur: '26%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (g) => formaterDate(g.dateMouvement),
  },
  {
    cle: 'quantite',
    libelle: 'Quantité',
    largeur: '20%',
    alignement: 'nombre',
    rendu: (g) => formaterEntier(g.quantite),
  },
];

/**
 * Largeurs revues le 31/07/2026, même panneau de 464 px que les tableaux
 * « Amont » ci-dessus (côté Aval, cette fois). Premier essai : `repli` sur
 * `Production` ET `Date`, comme ailleurs dans ce fichier — mais vérifié à
 * l'écran, ce `repli` s'est révélé PIRE que l'ellipse ici : ni « PR-2026-0001 »
 * ni « 25/07/2026 » ne contiennent d'espace où `overflow-wrap: anywhere`
 * pourrait couper proprement, et à une largeur aussi étroite les deux
 * s'enroulaient caractère par caractère (« PR\n-2\n02\n6-\n00\n01 ») — moins
 * lisible qu'une troncature propre avec infobulle. `Production` porte déjà
 * `titre` : il retourne à l'ellipse (comme `ingredient`/`fournisseur` dans les
 * tableaux Amont). `Date` reçoit assez de largeur pour ne PLUS avoir besoin de
 * s'enrouler du tout (format fixe, besoin mesuré ~90 px). `Théorique`/`Réel`
 * gardent une largeur confortable ; `Session` (déjà en `repli`, avec des
 * espaces où se couper proprement) absorbe le reste.
 *
 * Colonne « Lot de pâte » ajoutée le 01/08/2026 (rappel sanitaire, voir
 * `schemaTracabiliteAvalProduction.numeroLotPate` — le champ que le dépôt
 * calculait déjà sans qu'aucun contrat ni écran ne le porte : « quel lot de
 * pâte est issu d'une production ayant consommé ce lot d'ingrédient rappelé ? »
 * n'était répondable nulle part). Ellipse + `titre`, PAS `repli` : même
 * raisonnement que `Production` juste au-dessus — « PATE-PR-2026-0001 » ne
 * contient aucun espace où `overflow-wrap: anywhere` couperait proprement, et
 * cette table a déjà mesuré qu'un `repli` sans espace s'enroule caractère par
 * caractère à cette largeur de panneau (le même défaut qu'ailleurs a fait
 * monter une rangée à 550 px). Largeur reprise à `Théorique`/`Réel`/`Session`,
 * qui la cèdent sans perte : ce sont des nombres bornés ou une chaîne déjà en
 * `repli` avec de vrais espaces où se couper.
 *
 * Colonne « Réel » REMPLACÉE par « Sorti du lot » le 01/08/2026 — voir le bloc
 * « TROIS QUANTITÉS, ET DEUX COLONNES » plus haut dans ce fichier. C'est LE
 * tableau du rappel sanitaire : on y arrive avec le numéro de lot d'un avis
 * fournisseur, et la question est « combien de CE lot est parti dans quelle
 * pâte ». `quantiteReelle` ne pouvait pas y répondre — elle est `null` dès que
 * l'ingrédient a été servi par plusieurs lots, c'est-à-dire précisément le cas
 * d'une sur-consommation comblée ailleurs, celui qui amène ce lot ici.
 *
 * `Date` cède les 6 points nécessaires : son besoin mesuré (~90 px, format
 * fixe) tenait déjà largement dans les 20 % précédents et tient toujours dans
 * 14 % du panneau empilé.
 */
const COLONNES_PRODUCTIONS_AVAL: ReadonlyArray<ColonneTableau<ProductionAval>> = [
  {
    cle: 'numero',
    libelle: 'Production',
    largeur: '10%',
    alignement: 'texte',
    rendu: (p) => <span className="font-mono text-xs">{p.numero}</span>,
    titre: (p) => p.numero,
  },
  {
    cle: 'lotPate',
    libelle: 'Lot de pâte',
    largeur: '20%',
    alignement: 'texte',
    rendu: (p) => <span className="font-mono text-xs">{p.numeroLotPate}</span>,
    titre: (p) => p.numeroLotPate,
  },
  {
    cle: 'date',
    libelle: 'Date',
    largeur: '14%',
    alignement: 'texte',
    rendu: (p) => formaterDate(p.dateProduction),
  },
  {
    cle: 'theorique',
    libelle: 'Théorique',
    largeur: '13%',
    alignement: 'nombre',
    // Même raison qu'en amont : la cellule porte la marque « hors fournée »,
    // que l'ellipse par défaut couperait avant le nombre.
    troncature: 'repli',
    rendu: (p) => (
      <>
        {formaterEntier(p.quantiteTheorique)}
        <BadgeLotHorsFournee quantiteTheorique={p.quantiteTheorique} />
      </>
    ),
  },
  {
    cle: 'sorti',
    libelle: 'Sorti du lot',
    largeur: '13%',
    alignement: 'nombre',
    troncature: 'repli',
    // `0` = matière intégralement restituée (vrai zéro). `ouTiret` est ici
    // défensif au même titre qu'en amont, et pour la même raison : voir la
    // colonne jumelle de `COLONNES_CONSOMMATIONS_AMONT`.
    rendu: (p) => ouTiret(p.quantiteMouvementee, (v) => formaterEntier(v)),
  },
  {
    cle: 'session',
    libelle: 'Session',
    largeur: '30%',
    alignement: 'texte',
    // Chaine composite la plus longue du projet (numero — lieu, date). L'ellipse
    // emportait la date, c'est-a-dire le seul element qui distingue deux
    // sessions du meme lieu.
    troncature: 'repli',
    rendu: (p) =>
      p.session === null
        ? TIRET_ABSENT
        : `${p.session.numero} — ${p.session.lieuNom}, ${formaterDate(p.session.dateSession)}`,
  },
];

type EtatAmont =
  | { statut: 'inactif' }
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; resultat: TracabiliteAmontSessionContrat };

type EtatAval =
  | { statut: 'inactif' }
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; resultat: TracabiliteAvalLotContrat };

function OngletTracabilite() {
  const [sessionIdSaisi, setSessionIdSaisi] = useState('');
  const [etatAmont, setEtatAmont] = useState<EtatAmont>({ statut: 'inactif' });

  const [lotIdSaisi, setLotIdSaisi] = useState('');
  const [etatAval, setEtatAval] = useState<EtatAval>({ statut: 'inactif' });

  async function rechercherAmont(): Promise<void> {
    const id = sessionIdSaisi.trim();
    if (id === '' || etatAmont.statut === 'chargement') return;
    setEtatAmont({ statut: 'chargement' });
    try {
      const reponse = await requeteApi<unknown>(`/afsca/tracabilite/sessions/${id}`);
      setEtatAmont({ statut: 'pret', resultat: schemaTracabiliteAmontSession.parse(reponse) });
    } catch (erreur) {
      setEtatAmont({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'La recherche a échoué.',
      });
    }
  }

  async function rechercherAval(): Promise<void> {
    const id = lotIdSaisi.trim();
    if (id === '' || etatAval.statut === 'chargement') return;
    setEtatAval({ statut: 'chargement' });
    try {
      const reponse = await requeteApi<unknown>(`/afsca/tracabilite/lots/${id}`);
      setEtatAval({ statut: 'pret', resultat: schemaTracabiliteAvalLot.parse(reponse) });
    } catch (erreur) {
      setEtatAval({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'La recherche a échoué.',
      });
    }
  }

  return (
    /**
     * EMPILÉ, et non côte à côte (décision du 31/07/2026, docs/05-DECISIONS.md
     * D-081, complément « deux tableaux structurellement trop larges »).
     *
     * Mesuré à 1280 px effectifs (clientWidth vérifié) sur une session réelle
     * (8 ingrédients consommés, 2 lots revendus, 3 lignes de garniture) : côte
     * à côte (`lg:grid-cols-2`), chaque tableau ne recevait que 464 px pour
     * jusqu'à SEPT colonnes — « Ingrédient », « Fournisseur » et
     * « Sur produit(s) » s'y réduisaient à 1-2 caractères avant l'ellipse,
     * l'infobulle `titre` devenant le SEUL moyen de lire la valeur. Empilé
     * (pleine largeur, ~978 px mesurés), le besoin RÉEL de largeur
     * (`table-layout: auto`, mesuré au navigateur, pas estimé) tient
     * intégralement pour les Consommations (820 px) et les Revendus (791 px),
     * et tient à ~85 % pour les Garnitures (1077 px, le pire des trois) —
     * contre 46-58 % de couverture aujourd'hui sur ces mêmes colonnes.
     *
     * Le coût mesuré, honnêtement : la hauteur totale du bloc passe de
     * 1149 px (côte à côte, les deux panneaux étirés à la même hauteur) à
     * 1500 px empilé (Amont 845 px + Aval 639 px), soit +30 % — mais le
     * bénéfice « voir Amont et Aval ensemble sans défiler » qui justifierait
     * de garder le côte à côte ne tient déjà PLUS aujourd'hui : à 609 px
     * utiles sous le chrome de page (docs/07 §4.4), le bloc actuel dépasse
     * DÉJÀ le premier écran de 1149 − 609 = 540 px sur cette session réaliste.
     * On défile déjà pour tout voir des deux côtés ; empiler ne fait que
     * décider CE QUI est visible en premier (Amont entier, puis Aval), au lieu
     * d'un peu des deux à la fois.
     *
     * Pas de seuil de largeur conditionnel (`lg:grid-cols-2` à une résolution
     * plus généreuse) : docs/07-DOCTRINE-ERP-ET-DESIGN.md §4.4 fixe 1280×720
     * comme LA résolution de conception, « jamais 1920×1080 » — calibrer un
     * palier au-delà de 1280 revient à empiler tout le temps en pratique,
     * pour un second mode jamais testé (même logique que « une seule densité,
     * fixée globalement », §4.3).
     */
    <div className="grid grid-cols-1 gap-bloc">
      <Panneau titre="Amont — d'une session vers les lots consommés">
        <div className="flex flex-col gap-bloc">
          {/* `Entrée` dans un champ de recherche est le geste clavier le plus
              universel qui soit, et la recherche est en LECTURE SEULE : aucun
              risque a la rendre soumissible. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void rechercherAmont();
            }}
            className="flex items-end gap-groupe"
          >
            <label
              className="flex flex-col gap-groupe text-sm text-ink-2"
              htmlFor="tracabilite-session"
            >
              Identifiant de la session
              <input
                id="tracabilite-session"
                type="text"
                className={`${CLASSE_CHAMP} w-64`}
                value={sessionIdSaisi}
                onChange={(e) => setSessionIdSaisi(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={sessionIdSaisi.trim() === '' || etatAmont.statut === 'chargement'}
              className={`${CLASSE_BOUTON_PRIMAIRE} w-32`}
            >
              {etatAmont.statut === 'chargement' ? 'Recherche…' : 'Rechercher'}
            </button>
          </form>

          {etatAmont.statut === 'erreur' && <BandeErreur message={etatAmont.message} />}

          {etatAmont.statut === 'pret' && (
            <div className="border-t border-line pt-3">
              <p className="text-sm text-ink-2">
                Session{' '}
                <span className="font-mono text-xs text-ink">{etatAmont.resultat.numero}</span> —{' '}
                {formaterDate(etatAmont.resultat.dateSession)}
              </p>

              {etatAmont.resultat.productions.length === 0 &&
              etatAmont.resultat.revendus.length === 0 &&
              etatAmont.resultat.garnitures.length === 0 ? (
                <div className="mt-groupe">
                  <EtatVide
                    variante="normal"
                    texte="Aucune production, marchandise revendue ni garniture rattachée à cette session."
                  />
                </div>
              ) : (
                <>
                  {etatAmont.resultat.productions.map((p) => (
                    <div key={p.productionId} className="mt-bloc border-t border-line pt-bloc">
                      <h3 className="text-2xs uppercase text-ink-3">
                        {p.recetteCode} — {p.recetteNom} · Lot {p.numeroLotPate} ·{' '}
                        {formaterDate(p.dateProduction)}
                      </h3>
                      <div className="mt-groupe">
                        <Tableau
                          colonnes={COLONNES_CONSOMMATIONS_AMONT}
                          lignes={p.consommations}
                          cleLigne={(c) => c.lotId}
                          etatVide={
                            <EtatVide variante="normal" texte="Aucune consommation enregistrée." />
                          }
                        />
                      </div>
                    </div>
                  ))}

                  {/* Bloc SÉPARÉ, jamais fondu dans les productions : une
                      marchandise revendue n'a été transformée par aucune
                      recette. La ranger parmi les consommations d'une
                      production ferait état d'une fabrication qui n'a pas eu
                      lieu, dans le document même qui sert à prouver ce qui
                      s'est réellement passé. */}
                  {etatAmont.resultat.revendus.length > 0 && (
                    <div className="mt-bloc border-t border-line pt-bloc">
                      <h3 className="text-2xs uppercase text-ink-3">
                        Marchandises revendues — sorties du stock sans production
                      </h3>
                      <div className="mt-groupe">
                        <Tableau
                          colonnes={COLONNES_REVENDUS_AMONT}
                          lignes={etatAmont.resultat.revendus}
                          cleLigne={(r) => r.lotId}
                          etatVide={<EtatVide variante="normal" texte="Aucune." />}
                        />
                      </div>
                    </div>
                  )}

                  {/* Troisième bloc, et non une ligne des deux précédents. Une
                      garniture n'est étalée par aucune fournée — elle n'a donc
                      rien à faire dans les consommations d'une production —
                      mais elle n'est pas non plus vendue telle quelle : le
                      client repart avec une crêpe, pas avec un emballage
                      portant un numéro de lot. C'est précisément ce que le
                      registre doit conserver à sa place. */}
                  {etatAmont.resultat.garnitures.length > 0 && (
                    <div className="mt-bloc border-t border-line pt-bloc">
                      <h3 className="text-2xs uppercase text-ink-3">
                        Garnitures — étalées au service, sans production
                      </h3>
                      <div className="mt-groupe">
                        <Tableau
                          colonnes={COLONNES_GARNITURES_AMONT}
                          lignes={etatAmont.resultat.garnitures}
                          // Un même ingrédient peut sortir de deux lots (FEFO) :
                          // la clé porte le lot, jamais l'ingrédient.
                          cleLigne={(g) => g.lotId}
                          etatVide={<EtatVide variante="normal" texte="Aucune." />}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Panneau>

      <Panneau titre="Aval — d'un lot vers les sessions impactées">
        <div className="flex flex-col gap-bloc">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void rechercherAval();
            }}
            className="flex items-end gap-groupe"
          >
            <label
              className="flex flex-col gap-groupe text-sm text-ink-2"
              htmlFor="tracabilite-lot"
            >
              Numéro de lot fournisseur (ou identifiant technique)
              <input
                id="tracabilite-lot"
                type="text"
                placeholder="celui de l'avis de rappel, par ex."
                className={`${CLASSE_CHAMP} w-64`}
                value={lotIdSaisi}
                onChange={(e) => setLotIdSaisi(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={lotIdSaisi.trim() === '' || etatAval.statut === 'chargement'}
              className={`${CLASSE_BOUTON_PRIMAIRE} w-32`}
            >
              {etatAval.statut === 'chargement' ? 'Recherche…' : 'Rechercher'}
            </button>
          </form>
          {/* La recherche accepte le numero fournisseur ET l'identifiant
              technique (`resoudreLotId`, `packages/db/src/depots/tracabilite.ts`) :
              lors d'un rappel reel, c'est le PREMIER que porte l'avis du
              fournisseur — l'identifiant technique n'apparait nulle part
              ailleurs que dans le detail d'un lot, ecran Stock. */}
          <p className="text-xs text-ink-3">
            Si plusieurs lots partagent ce numéro, une réponse le signale : recherchez alors
            l'identifiant technique, visible dans Stock, détail du lot.
          </p>

          {etatAval.statut === 'erreur' && <BandeErreur message={etatAval.message} />}

          {etatAval.statut === 'pret' && (
            <div className="border-t border-line pt-3">
              <p className="text-sm text-ink-2">
                {ouTiret(etatAval.resultat.numeroLotFournisseur, (v) => v)} —{' '}
                {etatAval.resultat.ingredientNom} · {etatAval.resultat.fournisseurNom} · réceptionné
                le {formaterDate(etatAval.resultat.dateReception)}
                <BadgeReceptionAnnulee statut={etatAval.resultat.receptionStatut} />
                {etatAval.resultat.dateDlc !== null
                  ? ` · DLC ${formaterDate(etatAval.resultat.dateDlc)}`
                  : ''}
              </p>

              {/* Statut du lot et trace de son dernier changement — voir la
                  doc de `DernierChangementStatutLot` ci-dessus. C'est la
                  réponse directe à la question qu'un contrôle pose sur un
                  lot bloqué : pourquoi, et depuis quand. */}
              <p className="text-sm text-ink-2">
                Statut du lot : <PastilleStatutLot statut={etatAval.resultat.statut} />
                <DernierChangementStatutLot
                  motifStatutLibelle={etatAval.resultat.motifStatutLibelle}
                  dateChangementStatut={etatAval.resultat.dateChangementStatut}
                />
              </p>

              {/* DÉFAUT CORRIGÉ (audit du 29/07/2026) : `tracabiliteAvalLot` ne
                  lisait jamais `non_conformite.lot_id` — une non-conformité
                  pouvait être rattachée à ce lot précis (onglet
                  Non-conformités) sans jamais réapparaître ici. Sur un rappel
                  réel, « ce lot a-t-il déjà fait l'objet d'un doute ? » est la
                  première question, avant même « où est-il parti ? » —
                  d'où ce bloc EN PREMIER, avant même les productions. */}
              <div className="mt-groupe">
                <h3 className="text-2xs uppercase text-ink-3">
                  Non-conformités déjà rattachées à ce lot
                </h3>
                <div className="mt-groupe">
                  <Tableau
                    colonnes={COLONNES_NON_CONFORMITES}
                    lignes={etatAval.resultat.nonConformites}
                    cleLigne={(n) => n.id}
                    etatVide={
                      <EtatVide
                        variante="normal"
                        texte="Aucune non-conformité rattachée à ce lot."
                      />
                    }
                  />
                </div>
              </div>

              <div className="mt-bloc">
                <h3 className="text-2xs uppercase text-ink-3">Consommé en production</h3>
                <div className="mt-groupe">
                  <Tableau
                    colonnes={COLONNES_PRODUCTIONS_AVAL}
                    lignes={etatAval.resultat.productions}
                    cleLigne={(p) => p.productionId}
                    etatVide={
                      <EtatVide variante="normal" texte="Aucune production n'a consommé ce lot." />
                    }
                  />
                </div>
              </div>

              {/* Pour une marchandise revendue, c'est le SEUL bloc renseigné —
                  et c'est lui qui répond à « ce lot est rappelé, dans quelles
                  sessions est-il parti ? ». Tant qu'il n'existait pas, la
                  question restait sans réponse. */}
              <div className="mt-bloc">
                <h3 className="text-2xs uppercase text-ink-3">Vendu tel quel</h3>
                <div className="mt-groupe">
                  <Tableau
                    colonnes={COLONNES_VENTES_AVAL}
                    lignes={etatAval.resultat.ventes}
                    cleLigne={(v) => `${v.session.id}-${v.dateMouvement}-${v.quantite}`}
                    etatVide={
                      <EtatVide variante="normal" texte="Ce lot n'a pas été vendu tel quel." />
                    }
                  />
                </div>
              </div>

              {/* Un lot peut alimenter les TROIS blocs : la vergeoise entre
                  dans la pâte, s'étale au service, et pourrait se vendre en
                  sachet. Les fondre ferait croire à un seul usage, et un rappel
                  sur le mauvais périmètre est un rappel manqué. */}
              <div className="mt-bloc">
                <h3 className="text-2xs uppercase text-ink-3">Étalé en garniture</h3>
                <div className="mt-groupe">
                  <Tableau
                    colonnes={COLONNES_GARNITURES_AVAL}
                    lignes={etatAval.resultat.garnitures}
                    cleLigne={(g) => `${g.session.id}-${g.dateMouvement}-${g.quantite}`}
                    etatVide={
                      <EtatVide variante="normal" texte="Ce lot n'a pas été étalé en garniture." />
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </Panneau>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Onglet 5 — Exercice de traçabilité
   ═══════════════════════════════════════════════════════════════════════════ */

const LIBELLE_RESULTAT_EXERCICE: Readonly<Record<ResultatExerciceContrat, string>> = {
  concluant: 'Concluant',
  ecarts: 'Écarts constatés',
  echec: 'Échec',
};

function statutAffichageExercice(resultat: ResultatExerciceContrat): Statut {
  switch (resultat) {
    case 'concluant':
      return 'conforme';
    case 'ecarts':
      return 'alerte';
    case 'echec':
      return 'depassement';
  }
}

const COLONNES_EXERCICES: ReadonlyArray<ColonneTableau<ExerciceTracabiliteContrat>> = [
  {
    cle: 'date',
    libelle: 'Date',
    largeur: '14%',
    alignement: 'texte',
    rendu: (e) => formaterDate(e.dateExercice),
  },
  {
    cle: 'duree',
    libelle: 'Durée (min)',
    largeur: '14%',
    alignement: 'nombre',
    rendu: (e) => ouTiret(e.dureeMinutes, (v) => formaterEntier(v)),
  },
  {
    cle: 'resultat',
    libelle: 'Résultat',
    largeur: '16%',
    alignement: 'texte',
    rendu: (e) => (
      <PastilleStatut
        statut={statutAffichageExercice(e.resultat)}
        libelle={LIBELLE_RESULTAT_EXERCICE[e.resultat]}
      />
    ),
  },
  {
    cle: 'ecarts',
    libelle: 'Écarts constatés',
    largeur: '38%',
    alignement: 'texte',
    rendu: (e) => ouTiret(e.ecartsConstates, (v) => v),
    titre: (e) => ouTiret(e.ecartsConstates, (v) => v),
  },
  {
    cle: 'lotDepart',
    libelle: 'Lot de départ',
    largeur: '18%',
    alignement: 'texte',
    // Identifiant technique a prefixe commun : meme enjeu de tracabilite que
    // « N° lot fournisseur » ci-dessus.
    troncature: 'repli',
    rendu: (e) => <span className="font-mono text-xs">{ouTiret(e.lotDepartId, (v) => v)}</span>,
  },
];

type EtatExercices =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; exercices: ExerciceTracabiliteContrat[]; total: number };

function OngletExercice() {
  const [etatListe, setEtatListe] = useState<EtatExercices>({ statut: 'chargement' });

  const [dateExercice, setDateExercice] = useState(aujourdHui);
  const [lotDepartId, setLotDepartId] = useState('');
  const [dureeSaisie, setDureeSaisie] = useState('');
  const [resultat, setResultat] = useState<ResultatExerciceContrat>('concluant');
  const [ecartsConstates, setEcartsConstates] = useState('');
  const [etatEcriture, setEtatEcriture] = useState<EtatEcriture>({ statut: 'inactif' });

  useEffect(() => {
    let annule = false;
    requeteApi<unknown>('/afsca/exercices-tracabilite')
      .then((reponse) => {
        const liste = schemaListeExercicesTracabilite.parse(reponse);
        if (!annule)
          setEtatListe({ statut: 'pret', exercices: liste.data, total: liste.meta.total });
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
  }, []);

  useEffect(() => {
    if (etatEcriture.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatEcriture({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatEcriture]);

  const duree = parserEntierPositifOptionnel(dureeSaisie);
  const erreurEcarts =
    etatEcriture.statut === 'erreur' ? etatEcriture.champs?.ecartsConstates : undefined;
  const peutEnregistrer =
    dateExercice !== '' && duree !== undefined && etatEcriture.statut !== 'en_cours';

  async function enregistrer(): Promise<void> {
    if (!peutEnregistrer) return;
    setEtatEcriture({ statut: 'en_cours' });
    try {
      const corps = {
        dateExercice,
        lotDepartId: lotDepartId.trim() === '' ? null : lotDepartId.trim(),
        dureeMinutes: duree,
        resultat,
        ecartsConstates: ecartsConstates.trim() === '' ? null : ecartsConstates.trim(),
      };
      const reponse = await requeteApi<unknown>('/afsca/exercices-tracabilite', {
        method: 'POST',
        body: JSON.stringify(corps),
      });
      const cree = schemaExerciceTracabilite.parse(reponse);
      setEtatListe((precedent) =>
        precedent.statut === 'pret'
          ? {
              statut: 'pret',
              exercices: [cree, ...precedent.exercices],
              total: precedent.total + 1,
            }
          : precedent,
      );
      setLotDepartId('');
      setDureeSaisie('');
      setEcartsConstates('');
      setEtatEcriture({ statut: 'succes', message: 'Exercice enregistré.' });
    } catch (erreur) {
      if (erreur instanceof ErreurApi) {
        setEtatEcriture({
          statut: 'erreur',
          message: erreur.message,
          ...(erreur.champs !== undefined ? { champs: erreur.champs } : {}),
        });
        // docs/07 §4.7 : focus sur le premier champ fautif. Un exercice non
        // concluant est refusé tant que les écarts ne sont pas décrits.
        if (erreur.champs?.ecartsConstates !== undefined) {
          document.getElementById('exercice-ecarts')?.focus();
        }
      } else {
        setEtatEcriture({ statut: 'erreur', message: 'Erreur inattendue, sans plus de détail.' });
      }
    }
  }

  return (
    <div className="flex flex-col gap-bloc">
      <Panneau titre="Enregistrer un exercice">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enregistrer();
          }}
          className="flex flex-col gap-bloc"
        >
          <div className="flex flex-wrap items-end gap-bloc">
            <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="exercice-date">
              Date
              <input
                id="exercice-date"
                type="date"
                className={`${CLASSE_CHAMP} w-40`}
                value={dateExercice}
                onChange={(e) => setDateExercice(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="exercice-duree">
              Durée (minutes, optionnel)
              <input
                id="exercice-duree"
                type="text"
                inputMode="numeric"
                className={`num ${CLASSE_CHAMP} w-32`}
                value={dureeSaisie}
                onChange={(e) => setDureeSaisie(e.target.value)}
              />
            </label>
            <label
              className="flex flex-col gap-groupe text-sm text-ink-2"
              htmlFor="exercice-resultat"
            >
              Résultat
              <select
                id="exercice-resultat"
                className={`${CLASSE_CHAMP} w-44`}
                value={resultat}
                onChange={(e) => setResultat(e.target.value as ResultatExerciceContrat)}
              >
                {Object.entries(LIBELLE_RESULTAT_EXERCICE).map(([cle, libelle]) => (
                  <option key={cle} value={cle}>
                    {libelle}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="exercice-lot">
              Lot de départ (optionnel)
              <input
                id="exercice-lot"
                type="text"
                className={`${CLASSE_CHAMP} w-48`}
                value={lotDepartId}
                onChange={(e) => setLotDepartId(e.target.value)}
              />
            </label>
          </div>

          <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="exercice-ecarts">
            Écarts constatés {resultat !== 'concluant' ? '(obligatoire)' : '(optionnel)'}
            <input
              id="exercice-ecarts"
              type="text"
              className={CLASSE_CHAMP}
              value={ecartsConstates}
              onChange={(e) => setEcartsConstates(e.target.value)}
              aria-invalid={erreurEcarts !== undefined}
              aria-describedby={erreurEcarts !== undefined ? 'exercice-ecarts-erreur' : undefined}
            />
          </label>
          {erreurEcarts !== undefined && (
            <p id="exercice-ecarts-erreur" className="text-sm text-depassement">
              {erreurEcarts}
            </p>
          )}

          <div className="flex items-center gap-groupe">
            <button
              type="submit"
              disabled={!peutEnregistrer}
              className={`${CLASSE_BOUTON_PRIMAIRE} w-56`}
            >
              {etatEcriture.statut === 'en_cours' ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {etatEcriture.statut === 'succes' && (
              <p role="status" className="text-sm text-conforme">
                {etatEcriture.message}
              </p>
            )}
          </div>
          {etatEcriture.statut === 'erreur' && erreurEcarts === undefined && (
            <BandeErreur message={etatEcriture.message} />
          )}
        </form>
      </Panneau>

      {etatListe.statut === 'chargement' && <p className="text-sm text-ink-3">Chargement…</p>}
      {etatListe.statut === 'erreur' && <BandeErreur message={etatListe.message} />}
      {etatListe.statut === 'pret' && (
        <Panneau titre={compteAccorde(etatListe.total, 'exercice', 'exercices')} sansRembourrage>
          <Tableau
            colonnes={COLONNES_EXERCICES}
            lignes={etatListe.exercices}
            cleLigne={(e) => e.id}
            etatVide={
              <EtatVide
                variante="premier-lancement"
                titre="Aucun exercice de traçabilité enregistré"
                explication="Consignez le premier exercice périodique avec le formulaire ci-dessus."
              />
            }
          />
        </Panneau>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Documents opposables — en tête de l'écran, hors onglets
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Mois écoulé au format `AAAA-MM`, à partir d'un jour civil `AAAA-MM-JJ`.
 *
 * C'est le défaut voulu neuf fois sur dix : on édite le registre d'un mois
 * TERMINÉ. Proposer le mois en cours produirait un registre incomplet — des
 * relevés y manqueraient sans que rien ne le dise, et c'est exactement le
 * document qu'on présente à un contrôle.
 *
 * Exportée pour être testée : le passage de janvier à décembre de l'année
 * précédente est le seul endroit où cette fonction peut se tromper.
 */
export function moisEcoule(jour: string): string {
  const annee = Number.parseInt(jour.slice(0, 4), 10);
  const mois = Number.parseInt(jour.slice(5, 7), 10);
  const anneeCible = mois === 1 ? annee - 1 : annee;
  const moisCible = mois === 1 ? 12 : mois - 1;
  return `${String(anneeCible).padStart(4, '0')}-${String(moisCible).padStart(2, '0')}`;
}

/** Même expression que le schéma Zod de la route (`apps/api/src/routes/documents.ts`). */
const MOTIF_PERIODE_MENSUELLE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Les deux seuls documents que l'application produit et qu'un tiers exige :
 *
 *  - le REGISTRE d'autocontrôle mensuel, seule pièce opposable à un contrôle
 *    AFSCA (`docs/04` : « minimum vital ») ;
 *  - l'AFFICHETTE ALLERGÈNES, obligation d'affichage sur un stand alimentaire.
 *
 * Ils vivent en tête de l'écran et HORS des onglets : ils ne relèvent d'aucune
 * des cinq sections, et celui qui les cherche vient de recevoir un contrôleur —
 * il ne doit pas avoir à deviner quel onglet ouvrir.
 */
function DocumentsOpposables() {
  const [periode, setPeriode] = useState(() => moisEcoule(aujourdHui()));
  const periodeValide = MOTIF_PERIODE_MENSUELLE.test(periode);

  return (
    <div className="flex flex-wrap items-start gap-bloc">
      <label
        className="flex h-controle items-center gap-groupe text-sm text-ink-2"
        htmlFor="afsca-periode"
      >
        Mois du registre (PDF)
        <input
          id="afsca-periode"
          // `type="month"` : le format natif du champ EST celui qu'attend la
          // route (`AAAA-MM`), il n'y a donc aucune conversion à écrire, et le
          // clavier suffit à le remplir (flèches sur chaque partie).
          type="month"
          className="h-controle w-40 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
          value={periode}
          onChange={(evenement) => setPeriode(evenement.target.value)}
        />
      </label>

      <BoutonDocument
        chemin={`/documents/registre-afsca?periode=${encodeURIComponent(periode)}`}
        libelle="Éditer le registre du mois (PDF)"
        libelleAttente="Édition du registre…"
        variante="primaire"
        {...(periodeValide
          ? {}
          : {
              raisonIndisponible:
                'Choisissez le mois du registre avant de l’éditer (format AAAA-MM).',
            })}
      />

      <BoutonDocument
        chemin="/documents/affichette-allergenes"
        libelle="Affichette allergènes (PDF)"
        libelleAttente="Édition de l’affichette…"
      />

      {/*
       * Rejeu de parcours du 31/07/2026 (docs/27 §3.h) : le libellé « Mois »
       * seul laissait croire que ce champ filtrait les onglets plus bas —
       * il ne pilote QUE la génération du PDF (voir l'en-tête de
       * `DocumentsOpposables` : « hors des onglets »). Les onglets, eux,
       * n'acceptent aucun paramètre de période et affichent tout
       * l'historique enregistré, quel que soit ce champ. Un libellé qui
       * ment est pire qu'un filtre absent (docs/07 §2.6) : cette phrase
       * dit ce que le champ fait réellement, à l'endroit même où on
       * pourrait croire le contraire.
       */}
      <p className="w-full text-xs text-ink-3">
        Ne filtre que le PDF ci-dessus. Les onglets ci-dessous affichent toujours tout l’historique
        enregistré, quel que soit ce mois.
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Composant racine — barre d'onglets
   ═══════════════════════════════════════════════════════════════════════════ */

type Onglet = 'temperatures' | 'nettoyage' | 'non_conformites' | 'tracabilite' | 'exercice';

const ONGLETS: ReadonlyArray<{ cle: Onglet; libelle: string }> = [
  { cle: 'temperatures', libelle: 'Températures' },
  { cle: 'nettoyage', libelle: 'Nettoyage' },
  { cle: 'non_conformites', libelle: 'Non-conformités' },
  { cle: 'tracabilite', libelle: 'Traçabilité' },
  { cle: 'exercice', libelle: 'Exercice de traçabilité' },
];

/**
 * Barre d'onglets conforme au motif « Tabs » de l'ARIA Authoring Practices.
 *
 * Un `role="tablist"` n'est pas une décoration : il fait une PROMESSE au
 * lecteur d'écran et au clavier. Chaque `tab` doit donc désigner le panneau
 * qu'il pilote (`aria-controls`), le panneau doit renvoyer vers son onglet
 * (`aria-labelledby`), et surtout le groupe entier ne compte que pour UNE
 * tabulation : `Tab` entre dans la barre, les FLÈCHES changent d'onglet, `Tab`
 * en ressort vers le contenu. Sans ce « tabindex glissant », les cinq onglets
 * s'intercalaient dans le parcours et il fallait cinq tabulations pour
 * atteindre le premier champ du formulaire — à chaque écran, à chaque saisie.
 *
 * Le panneau, lui, ne porte PAS `tabIndex` — voir le commentaire posé sur le
 * `role="tabpanel"` plus bas : l'APG ne le rend focalisable que lorsqu'il ne
 * contient aucun élément focalisable, ce qui n'arrive dans aucun des cinq
 * onglets. Après avoir changé d'onglet à la flèche, une tabulation atterrit
 * donc directement sur le premier champ du formulaire révélé.
 */
export default function RegistreAfsca() {
  const [ongletActif, setOngletActif] = useState<Onglet>('temperatures');
  const referencesOnglets = useRef<Array<HTMLButtonElement | null>>([]);

  /** Active l'onglet d'indice donné ET y porte le focus : le motif APG veut que
   * la flèche déplace le focus, sans quoi la sélection avance mais le clavier
   * reste sur l'onglet précédent. Modulo pour boucler d'un bout à l'autre. */
  function activerParIndice(indice: number): void {
    const nombre = ONGLETS.length;
    const indiceBorne = ((indice % nombre) + nombre) % nombre;
    const onglet = ONGLETS[indiceBorne];
    if (onglet === undefined) return;
    setOngletActif(onglet.cle);
    referencesOnglets.current[indiceBorne]?.focus();
  }

  function surToucheOnglet(evenement: KeyboardEventReact<HTMLButtonElement>, indice: number): void {
    switch (evenement.key) {
      case 'ArrowRight':
        activerParIndice(indice + 1);
        break;
      case 'ArrowLeft':
        activerParIndice(indice - 1);
        break;
      case 'Home':
        activerParIndice(0);
        break;
      case 'End':
        activerParIndice(ONGLETS.length - 1);
        break;
      default:
        // Toute autre touche garde son comportement natif (Tab sort du groupe).
        return;
    }
    // Empêche le défilement de la page sur les flèches et Home/Fin.
    evenement.preventDefault();
  }

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex flex-wrap items-center justify-between gap-bloc">
        <h1 className="flex h-rangee items-center text-lg text-ink">Registre AFSCA</h1>
        <DocumentsOpposables />
      </div>

      <div
        role="tablist"
        aria-label="Sections du registre AFSCA"
        className="flex gap-groupe border-b border-line-strong"
      >
        {ONGLETS.map((o, indice) => {
          const actif = ongletActif === o.cle;
          return (
            <button
              key={o.cle}
              id={`onglet-${o.cle}`}
              ref={(element) => {
                referencesOnglets.current[indice] = element;
              }}
              type="button"
              role="tab"
              aria-selected={actif}
              aria-controls={`panneau-${o.cle}`}
              tabIndex={actif ? 0 : -1}
              onClick={() => setOngletActif(o.cle)}
              onKeyDown={(evenement) => surToucheOnglet(evenement, indice)}
              className={`h-controle border-b-2 px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                // Onglet inactif en `ink-2` et non `ink-3` : mesure a 13 px,
                // `ink-3` tombait a 4,40:1, sous le seuil AA de 4,5:1. L'onglet
                // actif reste distingue par `ink` ET par son souligne d'accent
                // — jamais par la seule couleur.
                actif ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'
              }`}
            >
              {o.libelle}
            </button>
          );
        })}
      </div>

      {/* Pas de `tabIndex` sur le panneau : l'APG ne le rend focalisable que
          lorsqu'il ne contient AUCUN élément focalisable, ce qui n'arrive dans
          aucun des cinq onglets. L'ajouter coûterait une tabulation de plus
          avant le premier champ, à chaque saisie et sur chaque onglet. */}
      <div role="tabpanel" id={`panneau-${ongletActif}`} aria-labelledby={`onglet-${ongletActif}`}>
        {ongletActif === 'temperatures' && <OngletTemperatures />}
        {ongletActif === 'nettoyage' && <OngletNettoyage />}
        {ongletActif === 'non_conformites' && <OngletNonConformites />}
        {ongletActif === 'tracabilite' && <OngletTracabilite />}
        {ongletActif === 'exercice' && <OngletExercice />}
      </div>
    </div>
  );
}
