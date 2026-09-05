/**
 * Contrat HTTP des routes `/api/depenses`, `/api/immobilisations`,
 * `/api/echeances`, `/api/periodes` et `/api/synthese-exercice` (Lot 10).
 */

import { z } from 'zod';
import { estJourCivilValide } from '../horodatage.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Depenses
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaCategorieDepense = z.enum([
  'matiere',
  'emplacement',
  'carburant',
  'materiel',
  'assurance',
  'formation',
  'frais_bancaires',
  'telecom',
  'autre',
]);

export const schemaDepenseLigne = z.object({
  id: z.string(),
  dateDepense: z.string(),
  libelle: z.string(),
  categorie: schemaCategorieDepense,
  montantCents: z.int(),
  montantDeductibleCents: z.int(),
  fournisseurId: z.string().nullable(),
  fournisseurNom: z.string().nullable(),
  justificatifPath: z.string().nullable(),
  deductibleBp: z.int(),
  immobilisationId: z.string().nullable(),
  notes: z.string().nullable(),
  estAnnulation: z.boolean(),
  depenseAnnuleeId: z.string().nullable(),
  estAnnulee: z.boolean(),
  creeLe: z.string(),
});

export const schemaListeDepenses = z.object({
  data: z.array(schemaDepenseLigne),
  meta: z.object({
    total: z.int(),
    montantTotalCents: z.int(),
    montantDeductibleTotalCents: z.int(),
    /**
     * Part du total partie en immobilisation (0 € déductible ici : sa
     * déduction passe par le plan d'amortissement). Sans ce chiffre, l'écart
     * entre `montantTotalCents` et `montantDeductibleTotalCents` sur une
     * dépense de matériel immobilisé se lit comme une erreur de saisie
     * (docs/16-AUDIT-COMPTABILITE.md §4.1 / §8).
     */
    montantImmobiliseTotalCents: z.int(),
  }),
});

export const schemaCreationDepense = z.object({
  /**
   * Aucune validation de format n'existait ici : `01/08/2026` etait accepte
   * tel quel, puis compare a des dates ISO — une depense invisible dans son
   * propre exercice.
   */
  dateDepense: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ, par exemple 2026-07-30.')
    .refine(estJourCivilValide, 'Cette date n’existe pas au calendrier.'),
  libelle: z.string().min(1, 'Le libellé est obligatoire.'),
  categorie: schemaCategorieDepense,
  montantCents: z.int().positive(),
  fournisseurId: z.string().nullable().optional(),
  justificatifPath: z.string().nullable().optional(),
  deductibleBp: z.int().min(0).max(10_000).optional(),
  immobilisationId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const schemaAnnulationDepense = z.object({
  motif: z.string().min(1, 'Indiquez pourquoi cette dépense est annulée.'),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Immobilisations
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaMethodeAmortissement = z.enum(['lineaire', 'degressive']);

export const schemaAnnuiteContrat = z.object({
  exercice: z.int(),
  montantCents: z.int(),
  valeurNetteFinCents: z.int(),
});

export const schemaImmobilisationDetail = z.object({
  id: z.string(),
  libelle: z.string(),
  dateAcquisition: z.string(),
  montantCents: z.int(),
  dureeAmortissementAnnees: z.int(),
  methode: schemaMethodeAmortissement,
  valeurResiduelleCents: z.int(),
  /**
   * Toujours `null` aujourd'hui, DÉLIBÉRÉMENT : aucun schéma d'entrée ni
   * aucune route ne permet de la renseigner (audit du 30/07/2026,
   * `packages/db/src/audit-colonnes-orphelines.test.ts`).
   *
   * Ce n'est PAS un oubli — c'est documenté depuis `docs/16-AUDIT-COMPTABILITE.md`
   * §5.3 et `docs/05-DECISIONS.md` : « le traitement de l'année de cession
   * (prorata jusqu'à la vente, plus- ou moins-value de cession, sort de la
   * valeur nette résiduelle) est entièrement réglementaire. Coder « on arrête
   * après l'année de cession » serait inventer une convention. À spécifier
   * avant d'ouvrir la saisie d'une cession. » Vérifié à nouveau ici : ni
   * `planAmortissement` ni `valeurNetteComptable` (`packages/core/src/comptabilite.ts`)
   * ne regardent cette colonne — un bien cédé continuerait de produire ses
   * annuités déductibles jusqu'au bout du plan. Ouvrir la saisie SANS
   * répondre d'abord à cette question réglementaire créerait un champ qui
   * ment (CLAUDE.md §9 : ne pas deviner une règle métier ambiguë).
   */
  dateCession: z.string().nullable(),
  notes: z.string().nullable(),
  valeurNetteActuelleCents: z.int(),
  annuites: z.array(schemaAnnuiteContrat),
  creeLe: z.string(),
});

export const schemaListeImmobilisations = z.object({
  data: z.array(schemaImmobilisationDetail),
  meta: z.object({ total: z.int(), annee: z.int() }),
});

export const schemaCreationImmobilisation = z.object({
  libelle: z.string().min(1, 'Le libellé est obligatoire.'),
  dateAcquisition: z.string().min(1),
  montantCents: z.int().positive(),
  dureeAmortissementAnnees: z.int().positive(),
  methode: schemaMethodeAmortissement.optional(),
  valeurResiduelleCents: z.int().nonnegative().optional(),
  notes: z.string().nullable().optional(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Echeancier reglementaire
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaRecurrenceEcheance = z.enum([
  'annuelle',
  'trimestrielle',
  'quinquennale',
  'ponctuelle',
]);

export const schemaStatutEcheance = z.enum(['a_venir', 'faite', 'en_retard']);

export const schemaEcheanceLigne = z.object({
  id: z.string(),
  libelle: z.string(),
  recurrence: schemaRecurrenceEcheance,
  prochaineDate: z.string(),
  sourceLegale: z.string(),
  urlSource: z.string().nullable(),
  montantEstimeCents: z.int().nullable(),
  statut: schemaStatutEcheance,
  dateRealisation: z.string().nullable(),
  joursAvantEcheance: z.int(),
  /**
   * L'échéance approche assez pour alerter. Calculée par le serveur à partir de
   * `echeance_horizon_alerte_jours` : le seuil était écrit en dur, à 30, dans
   * deux écrans différents.
   */
  alerteProche: z.boolean(),
});

export const schemaListeEcheances = z.object({
  data: z.array(schemaEcheanceLigne),
  meta: z.object({ total: z.int() }),
});

export const schemaMarquerEcheanceFaite = z.object({
  dateRealisation: z.string().optional(),
});

/**
 * Saisie du montant estimé d'une échéance réglementaire.
 *
 * `null` explicite pour EFFACER une estimation devenue incertaine — jamais un
 * 0 silencieux (CLAUDE.md : « une valeur inconnue vaut `null`, jamais `0` »).
 * Le champ est OBLIGATOIRE dans le corps (mais accepte `null`) : ça force
 * l'appelant à choisir consciemment entre une valeur et l'absence de valeur,
 * plutôt que de laisser un champ omis retomber sur un défaut implicite.
 *
 * Aucune validation de format sur la valeur elle-même au-delà du signe :
 * cette estimation vient TOUJOURS d'une saisie manuelle du porteur — jamais
 * un calcul de l'application (CLAUDE.md §3 règle 2 : un LLM ne calcule
 * jamais, et ici même l'application elle-même ne calcule rien).
 */
export const schemaEstimerMontantEcheance = z.object({
  montantEstimeCents: z.int().nonnegative().nullable(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Verrou de periode
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaStatutPeriode = z.enum(['ouverte', 'cloturee', 'verrouillee']);

export const schemaPeriodeLigne = z.object({
  id: z.string(),
  annee: z.int(),
  mois: z.int(),
  statut: schemaStatutPeriode,
  dateCloture: z.string().nullable(),
  clotureePar: z.string().nullable(),
  dateReouverture: z.string().nullable(),
  motifReouverture: z.string().nullable(),
});

export const schemaListePeriodes = z.object({
  data: z.array(schemaPeriodeLigne),
  meta: z.object({ total: z.int() }),
});

export const schemaClotureRequisePeriode = z.object({
  annee: z.int(),
  mois: z.int().min(1).max(12),
  clotureePar: z.string().nullable().optional(),
});

export const schemaReouverturePeriode = z.object({
  motif: z.string().min(1, 'Indiquez pourquoi cette période est rouverte.'),
});

/**
 * Corps de `POST /periodes/:id/verrouiller` — geste du troisième niveau du
 * verrou, jamais posé par aucun chemin de production avant cette mission
 * (docs/34-VERROU-COMPTABLE.md §1). Pas de champ `motif` ici, à la différence
 * de `schemaReouverturePeriode` : verrouiller n'est pas une correction à
 * justifier, c'est le geste PRINCIPAL attendu une fois l'exercice transmis —
 * `verrouillePar` (comme `clotureePar`) trace seulement QUI l'a posé.
 */
export const schemaVerrouillageRequisPeriode = z.object({
  verrouillePar: z.string().nullable().optional(),
});

/**
 * Impact CHIFFRÉ d'un verrouillage — à demander et AFFICHER avant de poser le
 * geste (docs/34-VERROU-COMPTABLE.md), jamais après : un verrou posé par
 * erreur est irréversible (`rouvrirPeriode` refuse déjà une période
 * `verrouillee`, établi par `packages/db/src/depots/comptabilite.test.ts`).
 *
 * Voir `calculerImpactVerrouillagePeriode`
 * (`packages/db/src/depots/comptabilite.ts`) pour la provenance exacte de
 * chaque compte — dérivée des 13 points d'appel RÉELS de
 * `verifierPeriodeNonVerrouillee` (grep exhaustif, docs/34 §1.2), jamais
 * énumérée à la main :
 *
 *  - `mouvementsStockNonAnnulesCount`, `receptionsNonAnnuleesCount`,
 *    `productionsNonAnnuleesCount`, `sessionsNonAnnuleesCount` — ce sont les
 *    écritures qui deviennent DÉFINITIVEMENT incorrigibles : leur seule voie
 *    de correction (contrepassation, annulation, saisie du réalisé) vérifie
 *    le verrou sur la date D'ORIGINE de l'écriture, jamais sur aujourd'hui.
 *  - `depensesCount` et `immobilisationsCount` sont fournis À PART,
 *    INFORMATIFS seulement — ils NE deviennent PAS incorrigibles par ce
 *    verrou (asymétrie réelle, docs/34 §2 et §5) : une dépense de ce mois
 *    reste annulable par contre-écriture datée d'AUJOURD'HUI tant que le
 *    mois COURANT reste ouvert (`annulerDepense` vérifie la date de la
 *    contre-écriture, jamais celle de la dépense d'origine), et une
 *    immobilisation n'a de toute façon aucun mécanisme d'annulation dans
 *    l'application, verrouillée ou non. Un écran qui les additionnerait aux
 *    quatre comptes précédents mentirait sur ce que ce verrou fige
 *    réellement (CLAUDE.md §7).
 *
 * NE COUVRE PAS `changerStatutLot` (le 13e site d'appel,
 * `services/mouvements.ts:450`) : son verrou porte sur la date de L'ACTION
 * (mise en quarantaine, blocage, destruction), un paramètre fourni par
 * l'appelant au moment où il agit — pas une colonne stockée sur `lot` qu'on
 * pourrait relire aujourd'hui. Aucun décompte n'est donc possible pour cette
 * catégorie : ce n'est pas une valeur inconnue (elle vaudrait `null`), c'est
 * une catégorie qui ne compte PAS des écritures existantes, seulement des
 * actions futures encore non tentées. Le verrou empêche seulement de dater
 * rétroactivement dans ce mois un NOUVEAU changement de statut — aucun lot
 * existant n'est figé par ce mécanisme précis. À dire à l'écran, pas à
 * taire.
 */
export const schemaImpactVerrouillagePeriode = z.object({
  periodeId: z.string(),
  annee: z.int(),
  mois: z.int(),
  mouvementsStockNonAnnulesCount: z.int(),
  receptionsNonAnnuleesCount: z.int(),
  productionsNonAnnuleesCount: z.int(),
  sessionsNonAnnuleesCount: z.int(),
  depensesCount: z.int(),
  immobilisationsCount: z.int(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Synthese d'exercice
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaSyntheseExercice = z.object({
  annee: z.int(),
  recettesCents: z.int(),
  depensesDeductiblesCents: z.int(),
  amortissementsCents: z.int(),
  beneficeBrutCents: z.int(),
  cotisationsSocialesCents: z.int(),
  impotEstimeCents: z.int(),
  netEstimeCents: z.int(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Ventes par créneau horaire (docs/17 fiche 13)

   « Le créneau horaire est saisi, stocké, affiché — et jamais agrégé » :
   `session_vente.creneau_horaire` existe (docs/07 §6.3) mais rien ne le
   regroupe. `agregerVentesParCreneau` comble ce manque.

   Calcul PUR placé ici à titre EXCEPTIONNEL — sa place naturelle serait
   `packages/core/src/comptabilite.ts`, à côté d'`estimerResultat`. Ce fichier
   est hors de la zone d'écriture de cet agent (un autre chantier le réserve),
   et `packages/core/src/index.ts` (le barillet qui le réexporte) est lui
   aussi verrouillé pendant cette campagne multi-agents. `contrats/index.ts`
   PUIS `index.ts` réexportent tous deux ce fichier-ci en `export *` : tout
   symbole d'ici est donc déjà joignable depuis `@batte/core` sans toucher à
   aucun barillet — même contrainte, même contournement que
   `contrats/referentiel.ts` (les fonctions `verifierCoherence*` vivent déjà
   au milieu de schémas, pour la même raison). À redescendre dans
   `comptabilite.ts` dès que ce fichier redevient disponible.
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaLigneAgregatCreneau = z.object({
  /** `null` = ventes sans créneau saisi. Reste dans l'agrégat plutôt que
   * d'être écarté : une ligne disparue en silence fausserait le total
   * affiché (CLAUDE.md §7). */
  creneauHoraire: z.string().nullable(),
  nbSessions: z.int(),
  quantiteVendue: z.int(),
  caCents: z.int(),
  /** Sur combien de sessions la marge a pu être répartie. Une session dont la
   * marge vaut encore `null` (non close par ce mécanisme, ou close avant son
   * existence) n'entre PAS dans `margeBruteEstimeeCents` : un 0 masquerait une
   * inconnue, exactement le défaut mesuré par la fiche 7. */
  nbSessionsAvecMargeConnue: z.int(),
  /** Répartition au PRORATA du CA de chaque session sur ce créneau —
   * approximation assumée (aucune ligne de vente ne porte de coût
   * individuel), jamais une décomposition réelle du coût par tranche horaire.
   * `null` si aucune session contributrice n'a de marge connue. */
  margeBruteEstimeeCents: z.int().nullable(),
  margeNetteEstimeeCents: z.int().nullable(),
});

export const schemaListeVentesParCreneau = z.object({
  data: z.array(schemaLigneAgregatCreneau),
  meta: z.object({
    annee: z.int(),
    nbSessionsCloturees: z.int(),
  }),
});

export type LigneAgregatCreneauContrat = z.infer<typeof schemaLigneAgregatCreneau>;
export type ListeVentesParCreneauContrat = z.infer<typeof schemaListeVentesParCreneau>;

/** Une ligne de vente brute, telle que lue en base, pour une session
 * CLÔTURÉE. Type d'entrée pur — l'appelant (la route, faute de dépôt
 * accessible) filtre déjà sur `statut = 'cloturee'` et sur l'exercice voulu :
 * cette fonction ne connaît rien de la base. */
export type LigneVenteCreneauBrute = {
  readonly sessionId: string;
  readonly creneauHoraire: string | null;
  readonly montantCents: number;
  readonly quantite: number;
  /** Marge de la SESSION entière (dénormalisée à sa clôture), répétée sur
   * chaque ligne de vente de cette même session — jamais recalculée ici,
   * seulement lue puis répartie. */
  readonly margeBruteSessionCents: number | null;
  readonly margeNetteSessionCents: number | null;
};

/**
 * Regroupe des lignes de vente brutes par créneau horaire, cumulées sur
 * toutes les lignes fournies.
 *
 * Le CA par créneau est exact (une simple somme). La marge par créneau est
 * une ESTIMATION : elle répartit la marge globale de chaque session au
 * prorata du CA que CE créneau a représenté dans CETTE session — c'est une
 * approximation assumée, jamais une mesure, d'où le suffixe `Estimee` du nom
 * de champ (CLAUDE.md §7 : ne jamais faire passer une estimation pour une
 * mesure sans le dire).
 *
 * Le bucket `creneauHoraire: null` (ventes sans créneau saisi) est trié en
 * dernier ; les autres suivent l'ordre alphabétique, qui correspond à l'ordre
 * chronologique tant que la saisie suit un format « HH:MM–HH:MM ».
 */
export function agregerVentesParCreneau(
  lignes: readonly LigneVenteCreneauBrute[],
): LigneAgregatCreneauContrat[] {
  // CA total de chaque session : le dénominateur du prorata.
  const caTotalParSession = new Map<string, number>();
  for (const ligne of lignes) {
    caTotalParSession.set(
      ligne.sessionId,
      (caTotalParSession.get(ligne.sessionId) ?? 0) + ligne.montantCents,
    );
  }

  type Accumulateur = {
    readonly sessions: Set<string>;
    quantiteVendue: number;
    caCents: number;
    readonly sessionsAvecMargeBruteConnue: Set<string>;
    readonly sessionsAvecMargeNetteConnue: Set<string>;
    margeBruteEstimeeCents: number;
    margeNetteEstimeeCents: number;
  };
  const parCreneau = new Map<string | null, Accumulateur>();

  for (const ligne of lignes) {
    const cle = ligne.creneauHoraire;
    const accumulateur: Accumulateur = parCreneau.get(cle) ?? {
      sessions: new Set<string>(),
      quantiteVendue: 0,
      caCents: 0,
      sessionsAvecMargeBruteConnue: new Set<string>(),
      sessionsAvecMargeNetteConnue: new Set<string>(),
      margeBruteEstimeeCents: 0,
      margeNetteEstimeeCents: 0,
    };

    accumulateur.sessions.add(ligne.sessionId);
    accumulateur.quantiteVendue += ligne.quantite;
    accumulateur.caCents += ligne.montantCents;

    const caTotalSession = caTotalParSession.get(ligne.sessionId) ?? 0;
    if (caTotalSession > 0) {
      const partDuCa = ligne.montantCents / caTotalSession;
      if (ligne.margeBruteSessionCents !== null) {
        accumulateur.sessionsAvecMargeBruteConnue.add(ligne.sessionId);
        accumulateur.margeBruteEstimeeCents += partDuCa * ligne.margeBruteSessionCents;
      }
      if (ligne.margeNetteSessionCents !== null) {
        accumulateur.sessionsAvecMargeNetteConnue.add(ligne.sessionId);
        accumulateur.margeNetteEstimeeCents += partDuCa * ligne.margeNetteSessionCents;
      }
    }

    parCreneau.set(cle, accumulateur);
  }

  return [...parCreneau.entries()]
    .map(([creneauHoraire, a]) => ({
      creneauHoraire,
      nbSessions: a.sessions.size,
      quantiteVendue: a.quantiteVendue,
      caCents: a.caCents,
      nbSessionsAvecMargeConnue: a.sessionsAvecMargeBruteConnue.size,
      margeBruteEstimeeCents:
        a.sessionsAvecMargeBruteConnue.size === 0 ? null : Math.round(a.margeBruteEstimeeCents),
      margeNetteEstimeeCents:
        a.sessionsAvecMargeNetteConnue.size === 0 ? null : Math.round(a.margeNetteEstimeeCents),
    }))
    .sort((x, y) => {
      if (x.creneauHoraire === null) return 1;
      if (y.creneauHoraire === null) return -1;
      return x.creneauHoraire.localeCompare(y.creneauHoraire);
    });
}

export type CategorieDepenseContrat = z.infer<typeof schemaCategorieDepense>;
export type DepenseLigneContrat = z.infer<typeof schemaDepenseLigne>;
export type ListeDepenses = z.infer<typeof schemaListeDepenses>;
export type CreationDepense = z.infer<typeof schemaCreationDepense>;
export type MethodeAmortissementContrat = z.infer<typeof schemaMethodeAmortissement>;
export type ImmobilisationDetailContrat = z.infer<typeof schemaImmobilisationDetail>;
export type ListeImmobilisations = z.infer<typeof schemaListeImmobilisations>;
export type CreationImmobilisation = z.infer<typeof schemaCreationImmobilisation>;
export type EcheanceLigneContrat = z.infer<typeof schemaEcheanceLigne>;
export type ListeEcheances = z.infer<typeof schemaListeEcheances>;
export type EstimerMontantEcheance = z.infer<typeof schemaEstimerMontantEcheance>;
export type PeriodeLigneContrat = z.infer<typeof schemaPeriodeLigne>;
export type ListePeriodes = z.infer<typeof schemaListePeriodes>;
export type ClotureRequisePeriode = z.infer<typeof schemaClotureRequisePeriode>;
export type VerrouillageRequisPeriode = z.infer<typeof schemaVerrouillageRequisPeriode>;
export type ImpactVerrouillagePeriodeContrat = z.infer<typeof schemaImpactVerrouillagePeriode>;
export type SyntheseExerciceContrat = z.infer<typeof schemaSyntheseExercice>;
