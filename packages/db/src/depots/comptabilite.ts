/**
 * Comptabilite (Lot 10) : depenses, immobilisations, echeancier reglementaire,
 * verrou de periode et synthese d'exercice.
 *
 * Regle d'architecture n°1 (CLAUDE.md §3) : aucun calcul chiffre n'est refait
 * ici. Le plan d'amortissement vient de `planAmortissement`, la synthese
 * d'exercice de `estimerResultat`, toutes deux exportees par `@batte/core` —
 * ce depot se limite a lire/ecrire la base et a assembler leurs resultats.
 *
 * `syntheseExercice` lit AUSSI la table `reception` (achats de marchandises)
 * et les frais de session agreges sur `session_marche`, en plus de `depense` —
 * voir le commentaire de `syntheseExercice` pour la definition retenue d'une
 * charge de l'exercice (docs/14-TEST-PARCOURS-UTILISATEUR.md §G2).
 */

import {
  ErreurIntrouvable,
  ErreurMetier,
  ajouterJours,
  construireCatalogueEcheances,
  estimerResultat,
  jourCivilBelge,
  joursAvantEcheance,
  maintenantUtc,
  montantDeductibleCharge,
  nouvelIdentifiant,
  planAmortissement,
  prochaineOccurrenceEcheance,
  valeurNetteComptable,
  type Annuite,
  type DefinitionEcheance,
  type LigneVenteCreneauBrute,
  type MethodeAmortissement,
  type RecurrenceEcheance,
  type ResultatExercice,
} from '@batte/core';
import { and, desc, eq, gte, lte, ne, sql } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  amortissementAnnuite,
  depense,
  echeance,
  fournisseur,
  fraisReception,
  immobilisation,
  mouvementStock,
  periode,
  production,
  reception,
  sessionMarche,
  sessionVente,
} from '../schema.js';
import { journaliser } from './audit.js';
import { verifierFournisseurCommercial } from './fournisseur-systeme.js';
import { lireParametres } from './parametres.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Depenses
   ═══════════════════════════════════════════════════════════════════════════ */

export type CategorieDepense =
  | 'matiere'
  | 'emplacement'
  | 'carburant'
  | 'materiel'
  | 'assurance'
  | 'formation'
  | 'frais_bancaires'
  | 'telecom'
  | 'autre';

/**
 * Marqueur d'annulation, ecrit dans `notes`.
 *
 * `depense` n'a pas de colonne `is_annule` / `annule_par_id` (a la difference
 * de `mouvement_stock`) : le schema n'est pas modifiable par ce lot. La regle
 * n°7 de CLAUDE.md §3 (« rien ne s'efface, correction par ecriture
 * d'annulation ») est donc satisfaite par une CONTRE-ECRITURE — une nouvelle
 * ligne de meme categorie, montant negatif — plutot que par un drapeau. C'est
 * exactement le mecanisme d'une note de credit comptable, et il ne demande
 * aucune colonne supplementaire : la ligne d'origine reste lisible, intacte,
 * pour toujours.
 */
const MARQUEUR_ANNULATION = /^\[ANNULATION:([^\]]+)\]\s*(.*)$/;

export type EntreeDepense = {
  readonly dateDepense: string;
  readonly libelle: string;
  readonly categorie: CategorieDepense;
  readonly montantCents: number;
  readonly fournisseurId?: string | null;
  readonly justificatifPath?: string | null;
  /** Points de base, 10000 = 100 % deductible. Defaut : entierement deductible. */
  readonly deductibleBp?: number;
  readonly immobilisationId?: string | null;
  readonly notes?: string | null;
};

export type DepenseLigne = {
  readonly id: string;
  readonly dateDepense: string;
  readonly libelle: string;
  readonly categorie: CategorieDepense;
  readonly montantCents: number;
  readonly montantDeductibleCents: number;
  readonly fournisseurId: string | null;
  readonly fournisseurNom: string | null;
  readonly justificatifPath: string | null;
  readonly deductibleBp: number;
  readonly immobilisationId: string | null;
  readonly notes: string | null;
  /** Vrai si cette ligne EST une contre-ecriture d'annulation. */
  readonly estAnnulation: boolean;
  /** Identifiant de la depense annulee par cette ligne, si `estAnnulation`. */
  readonly depenseAnnuleeId: string | null;
  /** Vrai si une autre ligne annule celle-ci. */
  readonly estAnnulee: boolean;
  readonly creeLe: string;
};

/** Liste des depenses, la plus recente d'abord. Filtrable par annee civile. */
export function listerDepenses(base: BaseBatte, filtre?: { annee?: number }): DepenseLigne[] {
  const condition =
    filtre?.annee === undefined
      ? sql`1 = 1`
      : sql`substr(${depense.dateDepense}, 1, 4) = ${String(filtre.annee)}`;

  const lignes = base
    .select({
      id: depense.id,
      dateDepense: depense.dateDepense,
      libelle: depense.libelle,
      categorie: depense.categorie,
      montantCents: depense.montantCents,
      fournisseurId: depense.fournisseurId,
      fournisseurNom: fournisseur.nom,
      justificatifPath: depense.justificatifPath,
      deductibleBp: depense.deductibleBp,
      immobilisationId: depense.immobilisationId,
      notes: depense.notes,
      creeLe: depense.creeLe,
    })
    .from(depense)
    .leftJoin(fournisseur, eq(depense.fournisseurId, fournisseur.id))
    .where(condition)
    .orderBy(desc(depense.dateDepense), desc(depense.creeLe))
    .all();

  const idsAnnules = new Set(
    lignes
      .map((l) => (l.notes === null ? null : MARQUEUR_ANNULATION.exec(l.notes)?.[1]))
      .filter((id): id is string => id !== undefined && id !== null),
  );

  return lignes.map((l) => {
    const correspondance = l.notes === null ? null : MARQUEUR_ANNULATION.exec(l.notes);
    return {
      ...l,
      // Une depense rattachee a une immobilisation affiche 0 € deductible :
      // sa deduction passe par le plan d'amortissement, pas par le journal des
      // charges. Le montant decaisse, lui, reste visible sur la ligne.
      montantDeductibleCents: montantDeductibleCharge({
        montantCents: l.montantCents,
        deductibleBp: l.deductibleBp,
        immobilisee: l.immobilisationId !== null,
      }),
      estAnnulation: correspondance !== null,
      depenseAnnuleeId: correspondance?.[1] ?? null,
      estAnnulee: idsAnnules.has(l.id),
    };
  });
}

/** Enregistre une depense. Le montant doit etre strictement positif : les
 * corrections passent par `annulerDepense`, jamais par une saisie negative. */
export function enregistrerDepense(base: BaseBatte, entree: EntreeDepense): { id: string } {
  if (entree.montantCents <= 0) {
    throw new ErreurMetier(
      'montant_invalide',
      "Le montant d'une dépense doit être strictement positif.",
      { champs: { montantCents: 'Indiquez un montant supérieur à zéro.' } },
    );
  }
  if (
    entree.deductibleBp !== undefined &&
    (entree.deductibleBp < 0 || entree.deductibleBp > 10_000)
  ) {
    throw new ErreurMetier(
      'taux_deductible_invalide',
      'La part déductible doit être comprise entre 0 % et 100 %.',
      { champs: { deductibleBp: 'Indiquez un pourcentage entre 0 et 100.' } },
    );
  }

  // Verrou de periode (docs/07 §1.6) : une ecriture datee dans un exercice
  // verrouille est refusee AVANT toute autre verification metier.
  verifierPeriodeNonVerrouillee(base, entree.dateDepense);

  // Fournisseur verifie AVANT l'insertion : sinon un identifiant inconnu ne se
  // manifestait qu'en violation de cle etrangere SQLite, remontee en 500
  // generique. 422 et non 404 : c'est un CHAMP DE FORMULAIRE, et `champs` dit a
  // l'ecran ou accrocher le message (404 est reserve a la ressource adressee
  // dans l'URL).
  //
  // TROU COMBLE (audit du 31/07/2026) : cette verification ne portait
  // jusqu'ici QUE sur l'existence du fournisseur, jamais sur son type — rien
  // n'empechait donc d'attribuer une depense au fournisseur SYSTEME
  // (« Inventaire d'ouverture »), qui n'a jamais engage la moindre charge
  // reelle (`seed/fournisseurs-systeme.ts` : il ne sert qu'a porter les lots
  // de l'inventaire d'ouverture, pas a etre un tiers avec qui on transige).
  // `verifierFournisseurCommercial` (`depots/fournisseur-systeme.ts`) est
  // desormais le foyer UNIQUE de cette regle, partage avec
  // `depots/referentiel-ecriture.ts`, `depots/economies.ts` et
  // `services/factures.ts`, qui portaient chacun leur propre copie du meme
  // controle.
  if (entree.fournisseurId !== undefined && entree.fournisseurId !== null) {
    verifierFournisseurCommercial(
      base,
      entree.fournisseurId,
      "aucune dépense ne s'enregistre à son nom.",
    );
  }

  // Meme controle pour l'immobilisation, et il compte DAVANTAGE que celui du
  // fournisseur : `depense.immobilisation_id` ne porte AUCUNE cle etrangere en
  // base (schema.ts), et c'est lui qui decide si la depense est deduite en
  // charge ou par le plan d'amortissement. Un identifiant fantaisiste passait
  // donc sans bruit et rendait la depense integralement deductible en plus des
  // annuites — la double deduction que `montantDeductibleCharge` corrige.
  if (entree.immobilisationId !== undefined && entree.immobilisationId !== null) {
    const immo = base
      .select({ id: immobilisation.id })
      .from(immobilisation)
      .where(eq(immobilisation.id, entree.immobilisationId))
      .get();
    if (immo === undefined) {
      throw new ErreurMetier(
        'immobilisation_introuvable',
        "L'immobilisation choisie n'existe pas. Créez-la d'abord, puis rattachez-lui la dépense.",
        { champs: { immobilisationId: 'Choisissez une immobilisation dans la liste.' } },
      );
    }
  }

  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  base
    .insert(depense)
    .values({
      id,
      dateDepense: entree.dateDepense,
      libelle: entree.libelle,
      categorie: entree.categorie,
      montantCents: entree.montantCents,
      fournisseurId: entree.fournisseurId ?? null,
      justificatifPath: entree.justificatifPath ?? null,
      deductibleBp: entree.deductibleBp ?? 10_000,
      immobilisationId: entree.immobilisationId ?? null,
      notes: entree.notes ?? null,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  return { id };
}

/**
 * Annule une depense par contre-ecriture (voir `MARQUEUR_ANNULATION`).
 *
 * La contre-ecriture est datee du JOUR DE L'ANNULATION, pas de la date de la
 * depense d'origine : une periode close ne doit jamais voir ses totaux
 * bouger apres coup (docs/07 §1.6) — la correction se comptabilise dans la
 * periode courante, comme le ferait un comptable.
 */
export function annulerDepense(base: BaseBatte, depenseId: string, motif: string): { id: string } {
  const motifPropre = motif.trim();
  if (motifPropre === '') {
    throw new ErreurMetier(
      'motif_obligatoire',
      "L'annulation d'une dépense exige un motif : c'est lui qui rend la correction auditable.",
      { champs: { motif: 'Indiquez pourquoi cette dépense est annulée.' } },
    );
  }

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const origine = baseTx.select().from(depense).where(eq(depense.id, depenseId)).get();
    if (origine === undefined) throw new ErreurIntrouvable('Dépense', depenseId);

    const marqueur = `[ANNULATION:${depenseId}]`;
    const dejaAnnulee = baseTx
      .select({ id: depense.id })
      .from(depense)
      .where(sql`${depense.notes} LIKE ${`${marqueur}%`}`)
      .all();
    if (dejaAnnulee.length > 0) {
      throw new ErreurMetier(
        'deja_annule',
        "Cette dépense a déjà été annulée. Une écriture ne se contrepasse qu'une seule fois.",
      );
    }

    // La contre-ecriture est datee du jour de l'annulation (voir le
    // commentaire de fonction) : le verrou de periode se verifie donc sur
    // AUJOURD'HUI, jamais sur la date de la depense d'origine — une erreur
    // remontant a un exercice deja verrouille reste corrigible tant que le
    // mois COURANT, lui, est ouvert (`verifierPeriodeNonVerrouillee`, docs/07
    // §1.4 : c'est exactement le mecanisme d'une note de credit comptable).
    const dateContreEcriture = jourCivilBelge(new Date());
    verifierPeriodeNonVerrouillee(baseTx, dateContreEcriture);

    const id = nouvelIdentifiant();
    const maintenant = maintenantUtc();

    baseTx
      .insert(depense)
      .values({
        id,
        dateDepense: dateContreEcriture,
        libelle: `Annulation — ${origine.libelle}`,
        categorie: origine.categorie,
        montantCents: -origine.montantCents,
        fournisseurId: origine.fournisseurId,
        justificatifPath: null,
        deductibleBp: origine.deductibleBp,
        immobilisationId: origine.immobilisationId,
        notes: `${marqueur} ${motifPropre}`,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    return { id };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Carburant — matière première du coût kilométrique MESURÉ (fiche 13 §3.1)
   ═══════════════════════════════════════════════════════════════════════════ */

export type CarburantMesure = {
  /** Net des contre-écritures d'annulation (`annulerDepense`) : une somme, jamais recalculée ailleurs. */
  readonly totalCents: number;
  /** Nombre de pleins RÉELS — voir le commentaire de fonction pour ce qui est exclu et pourquoi. */
  readonly nbPleins: number;
};

/**
 * Total des dépenses de catégorie `carburant`, et nombre de PLEINS distincts —
 * matière première du coût kilométrique MESURÉ (docs/demandes/13 §3.1, voie B,
 * `coutKilometriqueRetenu` dans `@batte/core`, composé par
 * `depots/lieux-rentabilite.ts`).
 *
 * SEULE catégorie retenue : la fiche cite aussi les pneus et l'entretien, mais
 * `depense.categorie` (schema.ts, hors zone d'écriture de cet agent) n'a pas
 * de valeur dédiée pour eux — ils tombent dans `materiel` ou `autre`,
 * indiscernables d'une dépense SANS AUCUN rapport avec le véhicule. Les
 * compter serait deviner un montant ; on ne compte que ce qu'on identifie
 * avec certitude.
 *
 * `nbPleins` ne compte que les montants STRICTEMENT POSITIFS : une
 * contre-écriture d'annulation (montant négatif, `annulerDepense`) est une
 * CORRECTION du même plein, jamais un plein supplémentaire. Elle reste
 * retranchée de `totalCents`, qui reste net — voir le test « une annulation
 * ne compte jamais comme un plein de plus, mais réduit bien le total net ».
 */
export function mesureCarburant(base: BaseBatte): CarburantMesure {
  const lignes = base
    .select({ montantCents: depense.montantCents })
    .from(depense)
    .where(eq(depense.categorie, 'carburant'))
    .all();

  return {
    totalCents: lignes.reduce((somme, l) => somme + l.montantCents, 0),
    nbPleins: lignes.filter((l) => l.montantCents > 0).length,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Immobilisations
   ═══════════════════════════════════════════════════════════════════════════ */

export type EntreeImmobilisation = {
  readonly libelle: string;
  readonly dateAcquisition: string;
  readonly montantCents: number;
  readonly dureeAmortissementAnnees: number;
  readonly methode?: MethodeAmortissement;
  readonly valeurResiduelleCents?: number;
  readonly notes?: string | null;
};

export type ImmobilisationDetail = {
  readonly id: string;
  readonly libelle: string;
  readonly dateAcquisition: string;
  readonly montantCents: number;
  readonly dureeAmortissementAnnees: number;
  readonly methode: MethodeAmortissement;
  readonly valeurResiduelleCents: number;
  readonly dateCession: string | null;
  readonly notes: string | null;
  readonly valeurNetteActuelleCents: number;
  readonly annuites: readonly Annuite[];
  readonly creeLe: string;
};

/** Liste des immobilisations avec leur plan d'amortissement PERSISTE et leur
 * valeur nette a l'exercice courant (ou a l'exercice demande). */
export function listerImmobilisations(
  base: BaseBatte,
  exerciceCourant?: number,
): ImmobilisationDetail[] {
  const annee = exerciceCourant ?? Number.parseInt(jourCivilBelge(new Date()).slice(0, 4), 10);

  const lignes = base
    .select()
    .from(immobilisation)
    .orderBy(desc(immobilisation.dateAcquisition))
    .all();

  return lignes.map((immo) => {
    const annuites = base
      .select({
        exercice: amortissementAnnuite.exercice,
        montantCents: amortissementAnnuite.montantCents,
        valeurNetteFinCents: amortissementAnnuite.valeurNetteFinCents,
      })
      .from(amortissementAnnuite)
      .where(eq(amortissementAnnuite.immobilisationId, immo.id))
      .orderBy(amortissementAnnuite.exercice)
      .all();

    const valeurNetteActuelleCents = valeurNetteComptable(
      {
        libelle: immo.libelle,
        dateAcquisition: immo.dateAcquisition,
        montantCents: immo.montantCents,
        dureeAnnees: immo.dureeAmortissementAnnees,
        methode: immo.methode,
        valeurResiduelleCents: immo.valeurResiduelleCents,
      },
      annee,
    );

    return { ...immo, valeurNetteActuelleCents, annuites };
  });
}

/**
 * Enregistre une immobilisation et PERSISTE son plan d'amortissement complet.
 *
 * Le plan est calcule AVANT toute ecriture : si `planAmortissement` leve
 * (duree ou montant invalide), aucune ligne n'atteint la base — pas
 * d'immobilisation sans plan valide, meme partiellement ecrite.
 */
export function enregistrerImmobilisation(
  base: BaseBatte,
  entree: EntreeImmobilisation,
): { id: string; annuites: readonly Annuite[] } {
  const methode = entree.methode ?? 'lineaire';
  const valeurResiduelleCents = entree.valeurResiduelleCents ?? 0;

  const plan = planAmortissement({
    libelle: entree.libelle,
    dateAcquisition: entree.dateAcquisition,
    montantCents: entree.montantCents,
    dureeAnnees: entree.dureeAmortissementAnnees,
    methode,
    valeurResiduelleCents,
  });

  // Verrou de periode (docs/07 §1.6) : verifie une fois le plan calcule (donc
  // la duree/le montant deja valides par `planAmortissement`), avant toute
  // ecriture.
  verifierPeriodeNonVerrouillee(base, entree.dateAcquisition);

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    const id = nouvelIdentifiant();
    const maintenant = maintenantUtc();

    baseTx
      .insert(immobilisation)
      .values({
        id,
        libelle: entree.libelle,
        dateAcquisition: entree.dateAcquisition,
        montantCents: entree.montantCents,
        dureeAmortissementAnnees: entree.dureeAmortissementAnnees,
        methode,
        valeurResiduelleCents,
        dateCession: null,
        notes: entree.notes ?? null,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    for (const annuite of plan) {
      baseTx
        .insert(amortissementAnnuite)
        .values({
          id: nouvelIdentifiant(),
          immobilisationId: id,
          exercice: annuite.exercice,
          montantCents: annuite.montantCents,
          valeurNetteFinCents: annuite.valeurNetteFinCents,
        })
        .run();
    }

    return { id, annuites: plan };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Echeancier reglementaire
   ═══════════════════════════════════════════════════════════════════════════ */

export type StatutEcheance = 'a_venir' | 'faite' | 'en_retard';

export type EcheanceLigne = {
  readonly id: string;
  readonly libelle: string;
  readonly recurrence: RecurrenceEcheance;
  readonly prochaineDate: string;
  readonly sourceLegale: string;
  readonly urlSource: string | null;
  readonly montantEstimeCents: number | null;
  readonly statut: StatutEcheance;
  readonly dateRealisation: string | null;
  /**
   * Tarifs officiels de RÉFÉRENCE de la contribution AFSCA — `null` sur toute
   * échéance SAUF « Contribution annuelle AFSCA », `not null` sur celle-ci.
   *
   * DÉFAUT CORRIGÉ (audit du 30/07/2026, `echeance_contribution_afsca_avec_
   * autorisation_cents` / `_sans_autorisation_cents`) : ces deux clés du
   * catalogue de paramètres n'étaient lues NULLE PART — extraites de la
   * PROSE de `sourceLegale` vers des colonnes numériques dédiées, mais jamais
   * câblées ensuite.
   *
   * JAMAIS auto-sélectionnées en une seule valeur : rien dans l'application
   * ne sait si CET établissement tient une autorisation AFSCA ou un simple
   * enregistrement (la clé `exploitant_numero_enregistrement_afsca` qui
   * pourrait un jour trancher cette question est câblée par ailleurs, hors
   * de cette mission — voir son propre commentaire). Choisir l'un des deux
   * montants ici serait deviner une donnée métier que rien ne confirme
   * (CLAUDE.md §9). Les DEUX sont donc rendus côte à côte, à charge pour le
   * porteur de reporter le bon dans `montantEstimeCents` via
   * `estimerMontantEcheance` — même doctrine que `DetectionEconomie.
   * commandeMinimumCents`/`francoDePortCents` (`depots/economies.ts`) :
   * « l'écran doit les montrer À CÔTÉ du chiffre, jamais les traduire en un
   * verdict automatique ».
   */
  readonly montantsReferenceAfscaCents: {
    readonly avecAutorisationCents: number;
    readonly sansAutorisationCents: number;
  } | null;
  /** Negatif si l'echeance est deja passee. */
  readonly joursAvantEcheance: number;
  /**
   * L'echeance approche assez pour meriter une alerte.
   *
   * Calcule ICI et non dans l'ecran : le seuil vient de
   * `echeance_horizon_alerte_jours`, et il etait auparavant ecrit en dur — a
   * 30 — dans DEUX composants React (`TableauDeBord.tsx` et `Comptabilite.tsx`),
   * chacun avec un commentaire renvoyant a l'autre. Une regle metier dupliquee
   * dans deux ecrans finit toujours par diverger dans un seul.
   */
  readonly alerteProche: boolean;
};

/** Resultat d'une (re)semence de l'echeancier : voir `seedEcheances`. */
export type ResultatSeedEcheances = {
  readonly inserees: number;
  /** Libelles dont un champ derive du catalogue a ete resynchronise sur une ligne DEJA presente. */
  readonly misesAJour: readonly string[];
};

/**
 * Peuple l'echeancier depuis le catalogue des echeances reglementaires, ET LE
 * MAINTIENT A JOUR.
 *
 * Idempotent PAR ENTITE : chaque echeance du catalogue est recherchee par son
 * LIBELLE avant insertion, jamais « si la table est vide ». C'est ce qui
 * permet d'ajouter une sixieme echeance au catalogue plus tard sans dupliquer
 * les cinq premieres deja en base.
 *
 * DEFAUT CORRIGE (audit du 01/08/2026, docs/29 §3 et §6 point 1) : cette
 * fonction se contentait auparavant d'inserer les echeances manquantes et ne
 * mettait JAMAIS a jour une ligne deja semee — contrairement a
 * `seedParametres`/`seedMotifs`/`seedAfsca`, qui resynchronisent tous leur
 * documentation a chaque execution. Consequence concrete : le jour ou une
 * echeance reglementaire change (l'INASTI deplace une date, l'AFSCA change
 * son calendrier), une base DEJA installee gardait silencieusement l'ancienne
 * valeur pour toujours — corriger `packages/core/src/comptabilite.ts` puis
 * relancer `npm run db:seed` ne changeait RIEN sur une installation existante.
 *
 * CE QUI EST RESYNCHRONISE INCONDITIONNELLEMENT (documentation du catalogue,
 * jamais saisie par un humain — aucune route HTTP ne permet de la modifier) :
 * `recurrence`, `sourceLegale`, `urlSource`.
 *
 * CE QUI N'EST RESYNCHRONISE QUE SI L'ECHEANCE N'A JAMAIS ETE HONOREE
 * (`dateRealisation === null`) : `prochaineDate`, recalculee EXACTEMENT comme
 * a l'insertion (meme appel a `prochaineOccurrenceEcheance`).
 *
 * POURQUOI CE GARDE-FOU PRECIS, ET PAS UN AUTRE : `dateRealisation` est le
 * SEUL signal DEJA present dans le schema (aucune migration n'etait dans le
 * perimetre de cette correction) qui prouve qu'un humain a agi sur CETTE
 * ligne precise, via `marquerEcheanceFaite`. Une echeance PONCTUELLE honoree
 * reste `faite` avec sa `dateRealisation` figee pour toujours ; une echeance
 * RECURRENTE honoree rebondit (`statut` repasse `a_venir`) mais GARDE sa
 * `dateRealisation` — c'est donc, dans les deux cas, un marqueur permanent et
 * fiable de « cette occurrence a ete honoree, sa date ne doit plus jamais
 * bouger sous elle ». Une fois ce marqueur pose, la SEULE fonction autorisee a
 * faire avancer `prochaineDate` redevient `marquerEcheanceFaite`, qui relit
 * deja le catalogue EN DIRECT a chaque rebond (voir son propre commentaire) —
 * elle s'auto-corrige donc toute seule au rebond suivant, sans aide de cette
 * graine.
 *
 * DECISION EXPLICITE, A NE PAS LIRE COMME UN OUBLI : `montantEstimeCents`
 * (pose par `estimerMontantEcheance`, l'AUTRE seul point d'ecriture humaine
 * sur cette table) NE GATE PAS ce recalcul. Un montant estime est une note
 * sur le COUT probable d'une echeance PAS ENCORE honoree ; il ne dit rien sur
 * SA DATE, et il n'est meme pas remis a zero quand l'echeance rebondit
 * (`marquerEcheanceFaite` ne touche jamais cette colonne). Le geler sur ce
 * seul critere recreerait, par un autre chemin, exactement le defaut que
 * cette fonction corrige : une date qui ne bougerait plus jamais des qu'elle
 * a ete estimee une fois, potentiellement pour toujours.
 *
 * CE QUI N'EST JAMAIS TOUCHE, QUEL QUE SOIT L'ETAT DE LA LIGNE : `statut`,
 * `dateRealisation`, `montantEstimeCents` — les trois champs qu'une action
 * humaine peut poser, jamais reecrits par une graine (CLAUDE.md §3 regle 7,
 * « rien ne s'efface »).
 *
 * DEFAUT CORRIGE UNE SECONDE FOIS (mission du 01/08/2026, meme reference
 * docs/29 §6 point 1) : le paragraphe ci-dessus decrit le rattrapage PAR
 * LIGNE (documentation resynchronisee, date recalculee tant que non honoree),
 * mais jusqu'ici cette fonction lisait `CATALOGUE_ECHEANCES` — une CONSTANTE
 * DE COMPILATION construite UNE SEULE FOIS, au chargement du module
 * `packages/core/src/comptabilite.ts`, a partir des valeurs PAR DEFAUT du
 * catalogue de parametres, jamais depuis la table `parametre` reellement en
 * base. Modifier l'une des cles `echeance_*` depuis l'ecran Parametres
 * n'avait donc AUCUN effet ici, meme apres la correction du rattrapage : le
 * mecanisme de rattrapage fonctionnait, mais il rattrapait vers la mauvaise
 * source. C'est exactement le defaut que ce deplacement corrige — voir
 * `construireCatalogueEcheances` (`@batte/core`) pour le detail de ce qui est
 * lu, et le commentaire ci-dessous pour le MOMENT choisi de cette lecture.
 *
 * MOMENT DE CONSTRUCTION DU CATALOGUE — A LA VOLEE, A CHAQUE APPEL, PAS UNE
 * FOIS AU DEMARRAGE : deux options existaient ici : (a) construire le
 * catalogue une fois au demarrage du serveur et le garder en memoire, plus
 * rapide et previsible, ou (b) le reconstruire a chaque appel depuis
 * `lireParametres`, plus couteux mais toujours a jour. Choix retenu : (b).
 * Trois raisons : premierement, une echeance reglementaire change au MIEUX
 * une fois par an (docs/29 §6 point 1) — le cout d'un appel `lireParametres`
 * (une poignee de lignes SQLite) est negligeable face a cette frequence, et
 * totalement negligeable face au volume de l'application (une session de
 * marche par semaine, CLAUDE.md §0). Deuxiemement, et c'est LA raison qui
 * compte : l'option (a) recree exactement le defaut que cette mission existe
 * pour corriger, sous un autre habit — un parametre modifie depuis l'ecran
 * Parametres resterait sans effet TANT QUE le serveur Fastify n'aurait pas
 * ete redemarre, et RIEN dans l'ecran ne le dirait : le porteur verrait sa
 * modification enregistree, croirait l'echeancier a jour, et ne le
 * decouvrirait qu'au prochain redemarrage — un mensonge a retardement plutot
 * qu'un mensonge permanent, pas une correction. Troisiemement, cette fonction
 * (comme `marquerEcheanceFaite` et `listerEcheances`) recoit deja `base` en
 * parametre et n'est jamais appelee dans une boucle chaude : il n'existe pas
 * de chemin ou reconstruire ce catalogue de 5 entrees a chaque appel devient
 * un cout mesurable.
 *
 * LIMITE RESIDUELLE, HORS DE PORTEE DE CE DEPLACEMENT (packages/core, zone
 * interdite a cette correction) : `echeance_pas_quinquennal_annees` fait
 * PARTIE du catalogue de parametres et EST desormais editable a l'ecran, mais
 * son effet reel — le pas en annees entre deux renouvellements de
 * l'autorisation ambulante — reste lu depuis `PAS_ANNEES.quinquennale`, une
 * CONSTANTE PRIVEE de module dans `packages/core/src/comptabilite.ts`,
 * calculee UNE FOIS depuis `PARAMETRES_PAR_DEFAUT` et jamais depuis un
 * `Parametres` charge en base. Ni `construireCatalogueEcheances` ni
 * `prochaineOccurrenceEcheance` ne recoivent ce pas en argument : leur
 * signature ne le permet pas. Consequence concrete : modifier cette cle
 * precise depuis l'ecran Parametres reste SANS EFFET sur la prochaine
 * occurrence quinquennale calculee ici, malgre cette correction — c'est
 * exactement le defaut que cette mission corrige pour les 15 AUTRES cles
 * `echeance_*`, mais qui persiste sur celle-ci faute de pouvoir toucher
 * `packages/core` dans cette zone d'ecriture.
 */
export function seedEcheances(base: BaseBatte, aujourdHui?: string): ResultatSeedEcheances {
  const jour = aujourdHui ?? jourCivilBelge(new Date());
  let inserees = 0;
  const misesAJour: string[] = [];

  // Catalogue construit A LA VOLEE depuis les parametres REELLEMENT en base a
  // la date `jour` — voir le commentaire de fonction pour l'arbitrage entre
  // « au demarrage » et « a chaque appel ».
  const catalogue: readonly DefinitionEcheance[] = construireCatalogueEcheances(
    lireParametres(base, jour),
  );

  for (const definition of catalogue) {
    const existante = base
      .select({
        id: echeance.id,
        recurrence: echeance.recurrence,
        sourceLegale: echeance.sourceLegale,
        urlSource: echeance.urlSource,
        prochaineDate: echeance.prochaineDate,
        dateRealisation: echeance.dateRealisation,
      })
      .from(echeance)
      .where(eq(echeance.libelle, definition.libelle))
      .get();

    const maintenant = maintenantUtc();

    if (existante === undefined) {
      base
        .insert(echeance)
        .values({
          id: nouvelIdentifiant(),
          libelle: definition.libelle,
          recurrence: definition.recurrence,
          // `prochaineOccurrenceEcheance` et non la primitive annuelle : c'est
          // elle qui connait les quatre recurrences. Avec l'ancienne, trois des
          // quatre cotisations INASTI n'etaient jamais rappelees.
          //
          // Le jour d'installation sert d'ANCRAGE PROVISOIRE aux recurrences
          // pluriannuelles : on ignore la date de premiere delivrance de
          // l'autorisation ambulante, et le calcul la reclame. Refuser de creer
          // l'echeance serait pire — une echeance qu'il faut penser a creer
          // soi-meme ne rappelle rien (D-032). Elle apparait donc dans
          // l'echeancier, avec sa `sourceLegale` qui dit de la re-ancrer sur la
          // date reelle.
          prochaineDate: prochaineOccurrenceEcheance(definition, jour, jour),
          sourceLegale: definition.sourceLegale,
          urlSource: definition.urlSource,
          montantEstimeCents: null,
          statut: 'a_venir',
          dateRealisation: null,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      inserees += 1;
      continue;
    }

    // Ligne DEJA semee : voir le commentaire de fonction pour la regle
    // complete. En resume — la documentation se resynchronise toujours, la
    // date ne se recalcule que si personne n'a jamais honore cette echeance.
    const peutRecalculerLaDate = existante.dateRealisation === null;
    const prochaineDateAJour = peutRecalculerLaDate
      ? prochaineOccurrenceEcheance(definition, jour, jour)
      : existante.prochaineDate;

    const aDerive =
      existante.recurrence !== definition.recurrence ||
      existante.sourceLegale !== definition.sourceLegale ||
      existante.urlSource !== definition.urlSource ||
      existante.prochaineDate !== prochaineDateAJour;

    if (!aDerive) continue;

    base
      .update(echeance)
      .set({
        recurrence: definition.recurrence,
        sourceLegale: definition.sourceLegale,
        urlSource: definition.urlSource,
        prochaineDate: prochaineDateAJour,
        modifieLe: maintenant,
      })
      .where(eq(echeance.id, existante.id))
      .run();
    misesAJour.push(definition.libelle);
  }

  return { inserees, misesAJour };
}

/** Liste des echeances, avec un statut « en retard » RECALCULE a la lecture —
 * jamais persiste, exactement comme `statutStock` sur les ingredients : ce
 * n'est pas une piece comptable figee, c'est une lecture du calendrier. */
export function listerEcheances(base: BaseBatte, aujourdHui?: string): EcheanceLigne[] {
  const jour = aujourdHui ?? jourCivilBelge(new Date());

  const lignes = base.select().from(echeance).orderBy(echeance.prochaineDate).all();
  const parametres = lireParametres(base, jour);
  const horizonAlerteJours = parametres.entier('echeance_horizon_alerte_jours');

  return lignes.map((l) => {
    const restants = joursAvantEcheance(l.prochaineDate, jour);
    const statut: StatutEcheance =
      l.statut === 'faite' ? 'faite' : restants < 0 ? 'en_retard' : 'a_venir';

    return {
      ...l,
      statut,
      joursAvantEcheance: restants,
      // Une echeance FAITE n'alerte jamais, meme si sa date approche : c'est
      // tout l'interet de l'avoir marquee.
      alerteProche: statut !== 'faite' && restants <= horizonAlerteJours,
      // Voir le commentaire de `EcheanceLigne.montantsReferenceAfscaCents` :
      // rendu SEULEMENT sur cette échéance precise, jamais choisi a sa place.
      montantsReferenceAfscaCents:
        l.libelle === 'Contribution annuelle AFSCA'
          ? {
              avecAutorisationCents: parametres.centimes(
                'echeance_contribution_afsca_avec_autorisation_cents',
              ),
              sansAutorisationCents: parametres.centimes(
                'echeance_contribution_afsca_sans_autorisation_cents',
              ),
            }
          : null,
    };
  });
}

/**
 * Marque une echeance comme faite.
 *
 * Une echeance PONCTUELLE reste `faite` definitivement. Une echeance
 * RECURRENTE rebondit sur sa prochaine occurrence et repasse `a_venir` :
 * c'est le sens meme du champ `recurrence` — sinon le rappel de l'annee
 * suivante disparaitrait. Meme principe que `changerStatutLot`, qui met a
 * jour un statut informatif sans recreer de ligne.
 *
 * CATALOGUE RELU EN DIRECT (mission du 01/08/2026, docs/29 §6 point 1) : le
 * catalogue est reconstruit ici via `construireCatalogueEcheances` a partir
 * des parametres REELLEMENT en base, jamais depuis la constante
 * `CATALOGUE_ECHEANCES` de `@batte/core` — voir le commentaire de
 * `seedEcheances` pour l'arbitrage complet entre construction « au
 * demarrage » et « a chaque appel ». Lu a la date DU JOUR (systeme), pas a la
 * `dateRealisation` fournie : cette derniere peut etre une date PASSEE (une
 * echeance honoree avec retard, saisie apres coup), et c'est la recurrence
 * ACTUELLE du catalogue — pas celle qui aurait ete en vigueur au moment de la
 * realisation — qui doit determiner la prochaine occurrence a venir.
 */
export function marquerEcheanceFaite(
  base: BaseBatte,
  echeanceId: string,
  dateRealisation?: string,
): void {
  const jour = dateRealisation ?? jourCivilBelge(new Date());
  const existante = base.select().from(echeance).where(eq(echeance.id, echeanceId)).get();
  if (existante === undefined) throw new ErreurIntrouvable('Échéance', echeanceId);

  const maintenant = maintenantUtc();

  if (existante.recurrence === 'ponctuelle') {
    base
      .update(echeance)
      .set({ statut: 'faite', dateRealisation: jour, modifieLe: maintenant })
      .where(eq(echeance.id, echeanceId))
      .run();
    return;
  }

  // L'ancrage est le lendemain de l'ECHEANCE COURANTE, pas de la date de
  // realisation : une echeance honoree EN AVANCE (ex. TVA deposee le 20/03
  // pour une echeance au 31/03) doit tout de meme rebondir sur l'annee
  // suivante, jamais retomber sur elle-meme parce que la realisation precede
  // la date butoir.
  const catalogue: readonly DefinitionEcheance[] = construireCatalogueEcheances(
    lireParametres(base, jourCivilBelge(new Date())),
  );
  const definition = catalogue.find((d) => d.libelle === existante.libelle);
  const lendemain = jourCivilBelge(ajouterJours(existante.prochaineDate, 1));

  // On repasse par le catalogue pour retrouver la recurrence complete : la
  // ligne en base ne porte que la prochaine date, pas les jours du cycle. Sans
  // definition (echeance saisie a la main), on retombe sur un pas annuel.
  const prochaine =
    definition === undefined
      ? prochaineOccurrenceEcheance(
          {
            libelle: existante.libelle,
            recurrence: 'annuelle',
            jourReference: existante.prochaineDate.slice(5),
            joursSupplementaires: [],
            sourceLegale: existante.sourceLegale,
            urlSource: existante.urlSource,
            // Repli annuel, pas de 1 an — voir le commentaire ci-dessus :
            // « sans definition, on retombe sur un pas annuel ».
            pasAnnees: 1,
          },
          lendemain,
        )
      : prochaineOccurrenceEcheance(definition, lendemain, existante.prochaineDate);

  base
    .update(echeance)
    .set({
      statut: 'a_venir',
      dateRealisation: jour,
      prochaineDate: prochaine,
      modifieLe: maintenant,
    })
    .where(eq(echeance.id, echeanceId))
    .run();
}

/**
 * Enregistre (ou efface avec `null`) l'estimation manuelle du montant d'une
 * echeance reglementaire (audit du 30/07/2026 : cette ecriture vivait EN DUR
 * dans `apps/api/src/routes/comptabilite.ts`, faute de barillet modifiable au
 * moment de son ecriture — CLAUDE.md §3 regle 1 : aucune ecriture de donnees
 * dans un handler Fastify). Descendue ici, meme patron que les fonctions
 * voisines de cette section (verification d'existence puis `update` cible).
 *
 * PAS de verrou de periode ici (`verifierPeriodeNonVerrouillee`), a la
 * difference d'`enregistrerDepense`/`enregistrerImmobilisation` — et c'est un
 * choix qui merite d'etre justifie dans les deux sens, pas seulement affirme :
 *
 *  - POUR le verrou : une estimation EST une donnee de gestion datee (la
 *    `prochaineDate` de l'echeance peut tomber dans un exercice deja
 *    verrouille, en particulier pour une echeance `en_retard`), et §1.6 pose
 *    le verrouillage comme un « point de non-retour » qu'on pourrait vouloir
 *    etendre a toute ecriture touchant cette table.
 *  - CONTRE : ce champ n'alimente AUCUN total transmis. `syntheseExercice`
 *    (cette meme fonction, ci-dessous) ne lit jamais `echeance` — verifie a la
 *    lecture du corps de la fonction : ni `montantEstimeCents`, ni aucune
 *    autre colonne de cette table n'entre dans `depensesDeductiblesCents`, le
 *    CA, les amortissements ou le resultat estime. Ce n'est PAS une ecriture
 *    comptable au sens des dix autres points d'appel du verrou (docs/07 §1.6 :
 *    depenses, immobilisations, mouvements de stock, receptions, productions)
 *    — c'est un pense-bete ("combien cette echeance va probablement couter"),
 *    saisi a la main, qui ne rentre jamais dans un document transmis au
 *    comptable. Le bloquer interdirait precisement l'usage le plus probable
 *    du champ : finir de chiffrer un echeancier en retard APRES la cloture du
 *    dossier de l'exercice concerne — un pense-bete qui reste vrai apres
 *    coup, contrairement a une charge qui, elle, doit rester figee.
 *
 * Cette seconde lecture l'emporte, et elle est cohérente avec le seul autre
 * point d'ecriture de cette meme table : `marquerEcheanceFaite` (ci-dessus)
 * ecrit egalement sur `echeance`, avec le meme risque de retomber sur une
 * `prochaineDate` verrouillee, et n'appelle PAS non plus ce verrou.
 */
export function estimerMontantEcheance(
  base: BaseBatte,
  echeanceId: string,
  montantEstimeCents: number | null,
): void {
  const existante = base
    .select({ id: echeance.id })
    .from(echeance)
    .where(eq(echeance.id, echeanceId))
    .get();
  if (existante === undefined) throw new ErreurIntrouvable('Échéance', echeanceId);

  base
    .update(echeance)
    .set({ montantEstimeCents, modifieLe: maintenantUtc() })
    .where(eq(echeance.id, echeanceId))
    .run();
}

/* ═══════════════════════════════════════════════════════════════════════════
   Verrou de periode
   ═══════════════════════════════════════════════════════════════════════════ */

export type StatutPeriode = 'ouverte' | 'cloturee' | 'verrouillee';

export type PeriodeLigne = {
  readonly id: string;
  readonly annee: number;
  readonly mois: number;
  readonly statut: StatutPeriode;
  readonly dateCloture: string | null;
  readonly clotureePar: string | null;
  readonly dateReouverture: string | null;
  readonly motifReouverture: string | null;
};

export function listerPeriodes(base: BaseBatte): PeriodeLigne[] {
  return base
    .select({
      id: periode.id,
      annee: periode.annee,
      mois: periode.mois,
      statut: periode.statut,
      dateCloture: periode.dateCloture,
      clotureePar: periode.clotureePar,
      dateReouverture: periode.dateReouverture,
      motifReouverture: periode.motifReouverture,
    })
    .from(periode)
    .orderBy(desc(periode.annee), desc(periode.mois))
    .all();
}

/**
 * Refuse une ecriture DATEE dans une periode VERROUILLEE — le troisieme
 * niveau du verrou (docs/07 §1.6, « point de non-retour »), a distinguer
 * explicitement du second :
 *
 *   - une periode simplement CLOTUREE n'interdit RIEN : « la cloture MARQUE
 *     plutot qu'elle n'interdit » (docs/07 §1.6). C'est deliberement le cas
 *     aujourd'hui : coder ce marquage exigerait une colonne supplementaire
 *     (`depense.periode_close_a_la_saisie`, par exemple) sur une table hors
 *     perimetre d'ecriture de ce lot — voir docs/16-AUDIT-COMPTABILITE.md §6.1
 *     et docs/17-VINGT-AMELIORATIONS.md §7.3, qui documentent deja ce manque
 *     et pourquoi il n'a pas ete comble a la legere (« une estampille derivee
 *     a la lecture serait un pis-aller trompeur »).
 *   - une periode VERROUILLEE est un exercice que le porteur considere
 *     definitivement clos et transmis (comptable, TVA…). `rouvrirPeriode`
 *     refuse deja de la rouvrir, pour la MEME raison — CE garde-fou est
 *     l'autre moitie du meme principe : sans lui, on pouvait ecrire dans un
 *     exercice qu'on ne pouvait plus rouvrir pour corriger, le pire des deux
 *     mondes (docs/16 §6.1 : « on peut ecrire dans un mois clos sans que rien,
 *     nulle part, ne le signale »).
 *
 * Sans ligne `periode` pour cette annee/mois, l'etat implicite est « ouverte »
 * (voir le commentaire de `cloturerPeriode` ci-dessous) : aucun refus.
 *
 * A appeler AVANT toute ecriture datee — depense, immobilisation, mouvement de
 * stock, reception, production — avec la date METIER de l'ecriture (JAMAIS
 * `maintenantUtc()`) : c'est elle qui decide dans QUELLE periode l'ecriture
 * tombe, pas l'instant ou elle est saisie. Une CONTRE-ecriture datee du jour
 * (`annulerDepense`) reste donc possible tant que le mois COURANT est ouvert,
 * meme si l'ecriture qu'elle corrige remonte a un exercice deja verrouille —
 * c'est exactement le mecanisme d'une note de credit comptable (docs/07 §1.4).
 * Une CONTRE-PASSATION de mouvement de stock (`contrepasserMouvement`), en
 * revanche, porte la MEME date que l'original (deja le cas avant ce
 * garde-fou, pour que les cumuls d'une periode close ne bougent pas) : si
 * cette date tombe desormais dans une periode verrouillee, la contrepassation
 * est refusee elle aussi — un mouvement de stock verrouille ne se corrige
 * plus du tout dans l'application, ce qui est exactement le sens de
 * « irreversible meme pour un administrateur » (docs/07 §1.6).
 *
 * Meme code d'erreur que `rouvrirPeriode` (`periode_verrouillee`) : les deux
 * refus expriment la MEME invariante (« ce point de non-retour ne bouge
 * plus »), jamais une reouverture proposee en sortie — elle n'existe pas pour
 * ce niveau, et la proposer mentirait.
 *
 * ── Le message DIT CE QUI RESTE POSSIBLE, pas seulement ce qui ne l'est plus ──
 *
 * Ce refus survient, par construction, LONGTEMPS apres le geste qui l'a rendu
 * possible — le verrou se pose sur un exercice transmis, le refus tombe le
 * jour ou l'on essaie d'y toucher, des semaines plus tard. Un « operation
 * impossible » sec ne laisserait alors AUCUNE issue au porteur, alors que
 * deux issues existent reellement et sont verifiees dans ce fichier :
 *
 *  - une ecriture NOUVELLE (depense, immobilisation, mouvement, reception,
 *    production, changement de statut de lot) se date par l'appelant : la
 *    porter sur un mois encore ouvert la fait passer, puisque ce garde-fou ne
 *    lit QUE `dateEcriture` ;
 *  - une DEPENSE deja enregistree dans le mois verrouille reste annulable :
 *    `annulerDepense` (plus haut) appelle ce meme garde-fou sur la date de la
 *    CONTRE-ECRITURE — `jourCivilBelge(new Date())` — jamais sur celle de la
 *    depense d'origine.
 *
 * Ce que le message ne promet PAS, parce que c'est faux : une correction de
 * mouvement de stock, de reception, de production ou de session de ce mois.
 * Ces quatre-la verifient le verrou sur la date D'ORIGINE de l'ecriture
 * (`contrepasserMouvement` :210, `annulerReception` :572, `saisirRealise`
 * :486 / `annulerProduction` :766, `cloturerSession` :881 / `annulerSession`
 * :1887) : dans l'application, elles n'ont plus aucune voie de retour, et le
 * message renvoie donc au comptable plutot que de laisser chercher un bouton
 * qui n'existe pas (CLAUDE.md §7 : l'application ne remplace pas un
 * comptable — ici elle le dit au moment ou ca compte).
 *
 * CE MESSAGE NE PARLE PAS DES FACTURES FOURNISSEUR, et c'est exact :
 * `services/factures.ts` n'appelle JAMAIS ce garde-fou (grep de
 * `verifierPeriodeNonVerrouillee` sur ce fichier : zero occurrence). Une
 * facture datee dans un mois verrouille s'enregistre, se change de statut,
 * s'annule, et `corrigerCoutLot` y reecrit encore `lot.prix_ligne_cents`.
 * Enumerer les factures parmi les refus mentirait ; l'ecart est signale la ou
 * il se decide, dans l'avertissement d'avant-verrouillage
 * (`ImpactVerrouillagePeriode`, `apps/web/src/pages/Comptabilite.tsx`).
 */
export function verifierPeriodeNonVerrouillee(base: BaseBatte, dateEcriture: string): void {
  const annee = Number.parseInt(dateEcriture.slice(0, 4), 10);
  const mois = Number.parseInt(dateEcriture.slice(5, 7), 10);

  const existante = base
    .select({ statut: periode.statut })
    .from(periode)
    .where(and(eq(periode.annee, annee), eq(periode.mois, mois)))
    .get();

  if (existante === undefined || existante.statut !== 'verrouillee') return;

  throw new ErreurMetier(
    'periode_verrouillee',
    `La période ${String(mois).padStart(2, '0')}/${annee} est verrouillée : aucune écriture ne ` +
      "peut plus y être datée, pas même une correction. C'est un point de non-retour définitif — " +
      'cette période ne peut pas être rouverte, y compris par ce logiciel. ' +
      "Ce qui reste possible : dater cette écriture d'un mois encore ouvert s'il s'agit d'une " +
      'écriture nouvelle, et annuler une dépense de cette période par contre-écriture datée ' +
      "d'aujourd'hui, tant que le mois courant est ouvert. Ce qui ne l'est plus : corriger un " +
      'mouvement de stock, une réception, une production ou une session datés de ce mois — cette ' +
      "correction se traite hors de l'application, avec votre comptable.",
  );
}

/**
 * Cloture une periode. La ligne est creee a la volee si elle n'existe pas
 * encore : une periode « ouverte » est l'etat implicite par defaut, elle n'a
 * pas besoin d'exister en base avant sa premiere cloture (docs/07 §1.6 —
 * « la cloture MARQUE plutot qu'elle n'interdit »).
 */
export function cloturerPeriode(
  base: BaseBatte,
  annee: number,
  mois: number,
  clotureePar?: string | null,
): { id: string } {
  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    const maintenant = maintenantUtc();

    const existante = baseTx
      .select()
      .from(periode)
      .where(and(eq(periode.annee, annee), eq(periode.mois, mois)))
      .get();

    if (existante === undefined) {
      const id = nouvelIdentifiant();
      baseTx
        .insert(periode)
        .values({
          id,
          annee,
          mois,
          statut: 'cloturee',
          dateCloture: maintenant,
          clotureePar: clotureePar ?? null,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      journaliser(baseTx, {
        table: 'periode',
        enregistrementId: id,
        action: 'creation',
        valeurApres: { annee, mois, statut: 'cloturee', dateCloture: maintenant },
        parQui: clotureePar ?? null,
      });
      return { id };
    }

    if (existante.statut !== 'ouverte') {
      throw new ErreurMetier(
        'periode_deja_cloturee',
        `La période ${String(mois).padStart(2, '0')}/${annee} est déjà ` +
          `${existante.statut === 'cloturee' ? 'clôturée' : 'verrouillée'}.`,
      );
    }

    baseTx
      .update(periode)
      .set({
        statut: 'cloturee',
        dateCloture: maintenant,
        clotureePar: clotureePar ?? null,
        modifieLe: maintenant,
      })
      .where(eq(periode.id, existante.id))
      .run();

    // Une RE-cloture ecrase `date_cloture` et `cloturee_par` de la cloture
    // precedente. Le journal garde l'etat d'avant : sans lui, un cycle
    // cloture -> reouverture -> cloture ne laisse aucune trace du premier tour
    // (CLAUDE.md §3 regle n°7, « rien ne s'efface »).
    journaliser(baseTx, {
      table: 'periode',
      enregistrementId: existante.id,
      action: 'modification',
      valeurAvant: {
        statut: existante.statut,
        dateCloture: existante.dateCloture,
        clotureePar: existante.clotureePar,
        dateReouverture: existante.dateReouverture,
        motifReouverture: existante.motifReouverture,
      },
      valeurApres: {
        statut: 'cloturee',
        dateCloture: maintenant,
        clotureePar: clotureePar ?? null,
      },
      parQui: clotureePar ?? null,
    });

    return { id: existante.id };
  });
}

/**
 * Rouvre une periode cloturee. Exige un motif : la reouverture est elle-meme
 * tracee (`date_reouverture` + `motif_reouverture`), pour qu'un comptable qui
 * relit le dossier comprenne pourquoi un mois pretendument clos a bouge.
 *
 * Une periode VERROUILLEE ne se rouvre pas : ce second niveau est reserve a
 * un exercice definitivement clos (au-dela du delai de correction usuel).
 */
export function rouvrirPeriode(base: BaseBatte, periodeId: string, motif: string): void {
  const motifPropre = motif.trim();
  if (motifPropre === '') {
    throw new ErreurMetier(
      'motif_obligatoire',
      "La réouverture d'une période exige un motif : c'est lui qui rend la correction auditable.",
      { champs: { motif: 'Indiquez pourquoi cette période est rouverte.' } },
    );
  }

  // Transaction : la trace d'audit et la reouverture doivent vivre ou mourir
  // ensemble. Une periode rouverte sans trace, ou une trace sans reouverture,
  // ment toutes les deux a qui relit le dossier.
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const existante = baseTx.select().from(periode).where(eq(periode.id, periodeId)).get();
    if (existante === undefined) throw new ErreurIntrouvable('Période', periodeId);

    if (existante.statut === 'ouverte') {
      throw new ErreurMetier('periode_deja_ouverte', 'Cette période est déjà ouverte.');
    }
    if (existante.statut === 'verrouillee') {
      throw new ErreurMetier(
        'periode_verrouillee',
        'Cette période est verrouillée et ne peut plus être rouverte.',
      );
    }

    const maintenant = maintenantUtc();
    baseTx
      .update(periode)
      .set({
        statut: 'ouverte',
        dateReouverture: maintenant,
        motifReouverture: motifPropre,
        modifieLe: maintenant,
      })
      .where(eq(periode.id, periodeId))
      .run();

    // LE MOTIF DE LA REOUVERTURE PRECEDENTE EST ECRASE ICI. La ligne `periode`
    // ne porte qu'UN couple (date, motif) : au deuxieme cycle
    // cloture -> reouverture, le premier motif disparait sans retour. C'est
    // exactement la trace qu'un comptable vient chercher quand un mois
    // pretendument clos a bouge deux fois. Le journal d'audit la conserve,
    // append seul, conformement a CLAUDE.md §3 regle n°7.
    journaliser(baseTx, {
      table: 'periode',
      enregistrementId: periodeId,
      action: 'modification',
      valeurAvant: {
        statut: existante.statut,
        dateCloture: existante.dateCloture,
        clotureePar: existante.clotureePar,
        dateReouverture: existante.dateReouverture,
        motifReouverture: existante.motifReouverture,
      },
      valeurApres: {
        statut: 'ouverte',
        dateReouverture: maintenant,
        motifReouverture: motifPropre,
      },
    });
  });
}

/**
 * Bornes ISO d'un mois civil complet, MEME CONVENTION que
 * `totalAchatsMarchandisesCents`/`totalFraisReceptionCents` (plus bas dans ce
 * fichier) pour une annee entiere : `fin` porte un 31 volontairement invalide
 * pour les mois plus courts (ex. `2026-02-31`). Sans consequence : la
 * comparaison lexicographique d'une date ISO `AAAA-MM-JJ` (ou horodatee)
 * reste correcte face a une borne haute qui n'existe pas au calendrier —
 * `2026-02-28` < `2026-02-31` textuellement, comme numeriquement.
 */
function bornesMois(annee: number, mois: number): { debut: string; fin: string } {
  const moisPad = String(mois).padStart(2, '0');
  return { debut: `${annee}-${moisPad}-01`, fin: `${annee}-${moisPad}-31T23:59:59.999Z` };
}

export type ImpactVerrouillagePeriode = {
  readonly periodeId: string;
  readonly annee: number;
  readonly mois: number;
  /** Mouvements de stock NON DEJA ANNULES dates ce mois — deviennent
   * definitivement non contrepassables (voir le commentaire de fonction). */
  readonly mouvementsStockNonAnnulesCount: number;
  readonly receptionsNonAnnuleesCount: number;
  readonly productionsNonAnnuleesCount: number;
  readonly sessionsNonAnnuleesCount: number;
  /** INFORMATIF seulement — n'entre PAS dans les quatre comptes ci-dessus :
   * cette categorie NE DEVIENT PAS incorrigible par ce verrou (asymetrie
   * documentee ci-dessous). */
  readonly depensesCount: number;
  /** INFORMATIF seulement, meme raison. */
  readonly immobilisationsCount: number;
};

/**
 * Impact CHIFFRE d'un verrouillage sur LA PERIODE VISEE — a calculer et
 * AFFICHER avant de poser le geste (docs/34-VERROU-COMPTABLE.md), jamais
 * apres : `rouvrirPeriode` ci-dessus refuse deja une periode 'verrouillee',
 * et ce geste n'a, dans cette application, AUCUNE fonction qui le defasse.
 *
 * Chaque compte est derive d'un point d'appel REEL de
 * `verifierPeriodeNonVerrouillee` (grep exhaustif, docs/34-VERROU-COMPTABLE.md
 * §1.2 — 13 sites dans 5 fichiers), jamais enumere a la main :
 *
 *  - `mouvementsStockNonAnnulesCount` — mouvements non deja annules
 *    (`mouvement_stock.is_annule = false`) dates ce mois.
 *    `contrepasserMouvement` (`services/mouvements.ts:210`, partagee par
 *    `annulerMouvement` ET `annulerProduction`) verifie le verrou sur
 *    `origine.dateMouvement`, LA DATE D'ORIGINE d'une ecriture DEJA EN BASE :
 *    une fois le mois verrouille, plus AUCUN de ces mouvements — entrees,
 *    sorties, ou contrepassations anterieures elles-memes — ne pourra plus
 *    jamais etre contrepasse. C'est la categorie la plus proche du sens
 *    litteral de « point de non-retour ».
 *  - `receptionsNonAnnuleesCount` — receptions actives (`statut = 'active'`)
 *    datees ce mois. `annulerReception` (`services/reception.ts:572`)
 *    verifie le verrou sur `existante.dateReception` : meme mecanisme.
 *  - `productionsNonAnnuleesCount` — productions non annulees
 *    (`statut != 'annulee'`) datees ce mois. `saisirRealise`
 *    (`services/production.ts:486`) ET `annulerProduction` (`:766`)
 *    verifient TOUTES DEUX le verrou sur `existante.dateProduction` : une
 *    production dont le realise n'est pas encore saisi le restera pour
 *    toujours (volume et crepes ne sont plus jamais corrigibles), en plus de
 *    devenir non annulable.
 *  - `sessionsNonAnnuleesCount` — sessions non annulees (`statut !=
 *    'annulee'`) datees ce mois. `cloturerSession`
 *    (`services/sessions.ts:855`) ET `annulerSession` (`:1789`) verifient
 *    TOUTES DEUX le verrou sur `session.dateSession` : une session encore
 *    `planifiee` ne pourra plus jamais etre cloturee, une session `cloturee`
 *    ne pourra plus jamais etre annulee.
 *
 * `depensesCount` et `immobilisationsCount` sont fournis A PART, JAMAIS
 * additionnes aux quatre comptes ci-dessus : ce ne sont PAS des ecritures qui
 * deviennent incorrigibles (asymetrie reelle, docs/34 §2 et §5, a faire
 * figurer explicitement dans le message de confirmation affiche a l'ecran) —
 *  - une depense de ce mois reste annulable par CONTRE-ECRITURE datee
 *    d'AUJOURD'HUI tant que le mois COURANT reste ouvert : `annulerDepense`
 *    (plus haut dans ce fichier) verifie le verrou sur la date de LA
 *    CONTRE-ECRITURE, jamais sur celle de la depense d'origine. Le compte
 *    ci-dessous exclut deja les contre-ecritures et les depenses deja
 *    annulees (memes champs `estAnnulation`/`estAnnulee` que
 *    `listerDepenses`) : ce sont les depenses qui n'ont, a ce jour, RIEN qui
 *    les protege encore — pas celles que ce verrou menace.
 *  - une immobilisation n'a AUCUN mecanisme d'annulation dans l'application
 *    aujourd'hui, verrouillee ou non (grep exhaustif de ce depot) : ce
 *    verrou ne change rien a son sort, il empeche seulement d'en CREER une
 *    NOUVELLE datee dans ce mois.
 *
 * EXCLU DELIBEREMENT de ce decompte : `changerStatutLot`
 * (`services/mouvements.ts:450`, le 13e site d'appel). Son verrou porte sur
 * la date de L'ACTION (mise en quarantaine, blocage, destruction), un
 * PARAMETRE fourni par l'appelant au moment ou il agit — PAS une colonne
 * stockee sur `lot` qu'on pourrait relire aujourd'hui. Il n'existe donc
 * AUCUNE facon de compter, a l'avance, « combien de changements de statut de
 * lot ce verrou empechera » : ce serait compter des actions qui n'ont pas
 * encore ete tentees. Ce site bloque uniquement la CREATION future d'un
 * changement de statut date retroactivement dans ce mois — aucun lot
 * EXISTANT n'est fige par ce mecanisme precis. A dire a l'ecran en toutes
 * lettres plutot qu'a taire (CLAUDE.md §7).
 *
 * Chaque compte est un ENTIER TOUJOURS CONNU (une simple agregation SQL sur
 * une colonne indexee ne peut pas etre « inconnue ») : aucun champ de cette
 * fonction ne vaut jamais `0` par defaut faute de savoir compter. Si une
 * evolution future rendait un de ces comptes reellement incalculable, elle
 * devrait renvoyer `null`, jamais `0` (CLAUDE.md §7 : une valeur inconnue ne
 * vaut pas zero) — et l'appelant devrait alors refuser de verrouiller tant
 * que ce compte reste inconnu.
 */
export function calculerImpactVerrouillagePeriode(
  base: BaseBatte,
  periodeId: string,
): ImpactVerrouillagePeriode {
  const cible = base.select().from(periode).where(eq(periode.id, periodeId)).get();
  if (cible === undefined) throw new ErreurIntrouvable('Période', periodeId);

  const { debut, fin } = bornesMois(cible.annee, cible.mois);

  const mouvementsStockNonAnnulesCount = base
    .select({ id: mouvementStock.id })
    .from(mouvementStock)
    .where(
      and(
        gte(mouvementStock.dateMouvement, debut),
        lte(mouvementStock.dateMouvement, fin),
        eq(mouvementStock.isAnnule, false),
      ),
    )
    .all().length;

  const receptionsNonAnnuleesCount = base
    .select({ id: reception.id })
    .from(reception)
    .where(
      and(
        gte(reception.dateReception, debut),
        lte(reception.dateReception, fin),
        eq(reception.statut, 'active'),
      ),
    )
    .all().length;

  const productionsNonAnnuleesCount = base
    .select({ id: production.id })
    .from(production)
    .where(
      and(
        gte(production.dateProduction, debut),
        lte(production.dateProduction, fin),
        ne(production.statut, 'annulee'),
      ),
    )
    .all().length;

  const sessionsNonAnnuleesCount = base
    .select({ id: sessionMarche.id })
    .from(sessionMarche)
    .where(
      and(
        gte(sessionMarche.dateSession, debut),
        lte(sessionMarche.dateSession, fin),
        ne(sessionMarche.statut, 'annulee'),
      ),
    )
    .all().length;

  // Depenses ACTIVES uniquement (ni contre-ecriture, ni deja annulee) : voir
  // le commentaire de fonction sur l'asymetrie. `listerDepenses` porte deja
  // la regex de `MARQUEUR_ANNULATION`, jamais dupliquee ici.
  const depensesCount = listerDepenses(base, { annee: cible.annee }).filter(
    (d) => d.dateDepense >= debut && d.dateDepense <= fin && !d.estAnnulation && !d.estAnnulee,
  ).length;

  const immobilisationsCount = base
    .select({ id: immobilisation.id })
    .from(immobilisation)
    .where(
      and(gte(immobilisation.dateAcquisition, debut), lte(immobilisation.dateAcquisition, fin)),
    )
    .all().length;

  return {
    periodeId,
    annee: cible.annee,
    mois: cible.mois,
    mouvementsStockNonAnnulesCount,
    receptionsNonAnnuleesCount,
    productionsNonAnnuleesCount,
    sessionsNonAnnuleesCount,
    depensesCount,
    immobilisationsCount,
  };
}

/**
 * Verrouille DEFINITIVEMENT une periode deja CLOTUREE — le troisieme etat de
 * `periode.statut`, jusqu'ici jamais ecrit par aucun chemin de production
 * (docs/34-VERROU-COMPTABLE.md §1 : deux gardes le LISENT depuis le Lot 10,
 * aucune fonction ne l'ECRIVAIT). Decision du porteur, prise sur ce document
 * apres analyse chiffree : cabler le geste, ne pas l'attenuer.
 *
 * ENCHAINEMENT IMPOSE, verifie ici et non suppose : 'ouverte' -> 'cloturee'
 * -> 'verrouillee'. Un raccourci direct depuis 'ouverte' est refuse
 * (`periode_non_cloturee`) : il sauterait l'etape qui existe pour permettre
 * les corrections courantes (`rouvrirPeriode`) — le verrou ne s'applique
 * qu'a un exercice DEJA transmis, jamais a un mois encore en cours de
 * saisie.
 *
 * IRREVERSIBLE, etabli et non suppose : `rouvrirPeriode` (ci-dessus)
 * refuse deja une periode `'verrouillee'` (`existante.statut === 'verrouillee'`
 * jette `periode_verrouillee`, voir son corps). Aucune fonction de ce depot
 * ne fait redescendre une periode `'verrouillee'` vers `'cloturee'` ou
 * `'ouverte'` : ce geste n'a, dans cette application, aucune voie de retour.
 *
 * Consequence exacte de l'ecriture ci-dessous (docs/34 §1.2, §2) : les 13
 * points d'appel de `verifierPeriodeNonVerrouillee` refusent des lors toute
 * ecriture DATEE dans ce mois — dont, sur la date D'ORIGINE d'une ecriture
 * DEJA EN BASE, la contrepassation d'un mouvement de stock, la saisie du
 * realise et l'annulation d'une production, l'annulation d'une reception, et
 * la cloture ou l'annulation d'une session. C'est pourquoi l'appelant DOIT
 * afficher `calculerImpactVerrouillagePeriode` avant de poser ce geste,
 * jamais apres — un verrou pose par erreur est, par construction, le pire
 * scenario possible de cette fonctionnalite.
 *
 * PAS DE COLONNE `date_verrouillage` / `verrouille_par` SUR `periode`
 * (schema.ts, hors zone d'ecriture de cet agent) — a la difference de
 * `date_cloture`/`cloturee_par` et `date_reouverture`/`motif_reouverture`,
 * qui existent deja pour les deux gestes voisins. La trace du QUI et du
 * QUAND ne vit donc, pour l'instant, QUE dans `journal_audit` (parametre
 * `verrouillePar`, horodatage propre a l'ecriture du journal) : une future
 * migration pourrait ajouter ces deux colonnes, symetriques aux deux paires
 * deja existantes, si ce depot venait a s'ouvrir.
 */
export function verrouillerPeriode(
  base: BaseBatte,
  periodeId: string,
  verrouillePar?: string | null,
): { id: string } {
  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const existante = baseTx.select().from(periode).where(eq(periode.id, periodeId)).get();
    if (existante === undefined) throw new ErreurIntrouvable('Période', periodeId);

    if (existante.statut === 'verrouillee') {
      throw new ErreurMetier(
        'periode_deja_verrouillee',
        `La période ${String(existante.mois).padStart(2, '0')}/${existante.annee} est déjà ` +
          'verrouillée.',
      );
    }
    if (existante.statut === 'ouverte') {
      throw new ErreurMetier(
        'periode_non_cloturee',
        `La période ${String(existante.mois).padStart(2, '0')}/${existante.annee} doit d'abord ` +
          'être clôturée : le verrouillage vient après la clôture, jamais à sa place.',
      );
    }

    // Impact fige AU MOMENT du verrouillage, journalise avec le changement de
    // statut : une preuve DATEE de ce qui etait CONNU au moment du geste,
    // jamais recalculee apres coup (CLAUDE.md §3 regle 7 — rien ne s'efface,
    // et rien ne se reecrit silencieusement non plus).
    const impact = calculerImpactVerrouillagePeriode(baseTx, periodeId);

    const maintenant = maintenantUtc();
    baseTx
      .update(periode)
      .set({ statut: 'verrouillee', modifieLe: maintenant })
      .where(eq(periode.id, periodeId))
      .run();

    journaliser(baseTx, {
      table: 'periode',
      enregistrementId: periodeId,
      action: 'modification',
      valeurAvant: { statut: existante.statut },
      valeurApres: { statut: 'verrouillee', impactConnuAuVerrouillage: impact },
      parQui: verrouillePar ?? null,
    });

    return { id: periodeId };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Synthese d'exercice
   ═══════════════════════════════════════════════════════════════════════════ */

export type SyntheseExercice = ResultatExercice & { readonly annee: number };

/**
 * Achats de marchandises (receptions fournisseur) d'un exercice, en centimes.
 *
 * SOURCE UNIQUE, au sens litteral : c'est la MEME table (`reception`), la MEME
 * colonne (`montant_total_cents`) et la MEME fenetre de dates que celles lues
 * par `donneesJournalAchats` (apps/api/src/documents/donnees.ts) pour produire
 * le classeur « Journal des achats ». C'est exactement le defaut mesure par
 * docs/14-TEST-PARCOURS-UTILISATEUR.md §G2 : l'ecran affichait
 * `BENEFICE BRUT 973,00 €` (= les seules recettes, aucun achat deduit) quand le
 * bouton « Journal des achats (Excel) » DU MEME ECRAN listait 447,61 €
 * d'achats sur l'annee — deux exports du meme module qui se contredisaient
 * parce qu'un seul des deux lisait `reception`.
 *
 * Bornes de date IDENTIQUES a celles de `donneesJournalAchats` (borne haute en
 * ISO complet `T23:59:59.999Z`, jamais un jour civil nu) : une reception peut
 * porter une date en ISO complet, et une borne haute nue exclurait a tort la
 * derniere journee de l'annee.
 *
 * Un montant NUL (`reception.montant_total_cents` est nullable en base) compte
 * pour 0 €, jamais pour une erreur : c'est le meme parti pris que
 * `centimesEnEuros` cote export Excel, qui rend alors une cellule vide.
 *
 * EXCLUT les réceptions `annulee` (colonne `reception.statut`, ajoutée le
 * 30/07/2026 — migration `0025_high_captain_universe.sql`, écrite par
 * `annulerReception`, `packages/db/src/services/reception.ts`). Même
 * raisonnement que D-038 pour `production.statut` : une réception annulée est
 * une CONTREPASSATION, son stock est déjà revenu à zéro — la compter quand
 * même dans les achats de l'exercice ferait peser sur le résultat une
 * marchandise que le porteur n'a, au final, jamais payée pour de bon (ou
 * qu'il a rendue). Sans ce filtre, une réception saisie deux fois puis
 * annulée resterait comptée dans les dépenses déductibles alors que le stock
 * qu'elle représentait a disparu du grand livre — exactement le double
 * compte que ce filtre évite.
 *
 * ATTENTION SYMÉTRIE : `donneesJournalAchats`
 * (`apps/api/src/documents/donnees.ts`) lit la MÊME table sur la MÊME
 * fenêtre pour produire le classeur « Journal des achats » (voir le
 * commentaire de fonction ci-dessus sur la réconciliation G2) mais ne filtre
 * PAS encore `statut` : tant que ce fichier n'est pas corrigé en miroir, une
 * réception annulée disparaît de cette synthèse mais reste comptée dans le
 * classeur Excel — la même divergence, dans l'autre sens, que celle que G2
 * avait mesurée.
 */
export function totalAchatsMarchandisesCents(base: BaseBatte, annee: number): number {
  const debut = `${annee}-01-01`;
  const fin = `${annee}-12-31T23:59:59.999Z`;

  const lignes = base
    .select({ montantTotalCents: reception.montantTotalCents })
    .from(reception)
    .where(
      and(
        gte(reception.dateReception, debut),
        lte(reception.dateReception, fin),
        eq(reception.statut, 'active'),
      ),
    )
    .all();

  return lignes.reduce((somme, l) => somme + (l.montantTotalCents ?? 0), 0);
}

/**
 * Frais accessoires de réception (transport, palette…) d'un exercice, en
 * centimes — audit du 30/07/2026 : `frais_reception` (`schema.ts`) est écrite
 * par `enregistrerFacture` (`packages/db/src/services/factures.ts`, hors zone
 * d'écriture de cet agent) à chaque ligne de facture rattachée à une
 * réception SANS ingrédient (un frais, pas un achat de marchandise
 * identifiable), puis ventilée IMMÉDIATEMENT sur `lot.prixLigneCents` — mais
 * la table elle-même n'était relue nulle part : ni dépôt, ni route.
 *
 * POURQUOI la relire répond à une question réelle, et pas à un usage
 * inventé : ce frais est un DÉCAISSEMENT réel, distinct de la valeur des
 * marchandises. `reception.montantTotalCents` (lu par
 * `totalAchatsMarchandisesCents` ci-dessus) est figé au moment de la
 * RÉCEPTION — c'est le montant du bon de livraison — et n'est JAMAIS mis à
 * jour quand la facture arrive ensuite avec ses frais de transport
 * (`appliquerVentilationFrais` ne touche que `lot.prixLigneCents`, jamais
 * `reception.montantTotalCents` — vérifié par lecture de
 * `services/factures.ts`). Sans cette fonction, le transport payé pour aller
 * chercher la marchandise n'apparaissait dans AUCUNE charge de l'exercice :
 * ni dans les achats de marchandises, ni dans les dépenses saisies (sauf
 * saisie manuelle redondante en catégorie « carburant », déjà signalée comme
 * un risque de double comptage dans `syntheseExercice` ci-dessous) — un
 * décaissement réel, invisible du résultat de l'exercice. C'est exactement le
 * défaut déjà corrigé pour les achats de marchandises, les frais de session
 * et la commission carte (voir le commentaire de `syntheseExercice`) :
 * `frais_reception` en est une CINQUIÈME population, découverte au même
 * audit.
 *
 * DATE RETENUE : `frais_reception` ne porte AUCUNE colonne de date propre
 * (schema.ts, hors zone d'écriture de cet agent) — seule la réception qu'elle
 * complète en porte une. On date donc ce frais sur `reception.dateReception`,
 * MÊMES bornes et même filtre `statut = 'active'` que
 * `totalAchatsMarchandisesCents` : un frais ventilé sur les lots d'une
 * réception annulée est revenu à zéro avec elle, pour la même raison.
 */
export function totalFraisReceptionCents(base: BaseBatte, annee: number): number {
  const debut = `${annee}-01-01`;
  const fin = `${annee}-12-31T23:59:59.999Z`;

  const lignes = base
    .select({ montantCents: fraisReception.montantCents })
    .from(fraisReception)
    .innerJoin(reception, eq(fraisReception.receptionId, reception.id))
    .where(
      and(
        gte(reception.dateReception, debut),
        lte(reception.dateReception, fin),
        eq(reception.statut, 'active'),
      ),
    )
    .all();

  return lignes.reduce((somme, l) => somme + l.montantCents, 0);
}

/**
 * Synthese d'un exercice civil : recettes des sessions closes, charges
 * deductibles, amortissements de l'exercice, puis `estimerResultat` de
 * `@batte/core` — aucun calcul n'est refait ici (CLAUDE.md §3, regle n°1).
 *
 * INDICATIF : l'ecran qui affiche ce resultat doit porter la mention « ne
 * remplace pas un comptable » (CLAUDE.md §7).
 *
 * ── Definition d'une « charge deductible de l'exercice » (docs/14 §G2) ──────
 *
 * Cinq populations DECAISSEES coexistent dans la base :
 *
 *   1. `depense`      — saisie manuelle sur l'ecran Comptabilite (loyer,
 *                        assurance, materiel, formation…). DEJA comptee.
 *   2. `reception`     — achats de marchandises (farine, lait, œufs, sirop…),
 *                        payes au fournisseur et enregistres via Stock. Cette
 *                        somme n'avait AUCUN point d'entree dans la synthese :
 *                        « la matiere n'a donc aucun autre point d'entree »
 *                        (docs/14). Corrige ici via
 *                        `totalAchatsMarchandisesCents`.
 *   3. `session_frais` — frais de la session (emplacement, deplacement, gaz,
 *                        divers), decaisses reels ecrits a la CLOTURE de
 *                        chaque session (`cloturerSession`, hors perimetre de
 *                        ce lot). Ils entraient deja dans la MARGE NETTE de
 *                        chaque session (comptabilite ANALYTIQUE), mais nulle
 *                        part dans cette synthese d'exercice (comptabilite
 *                        GENERALE) : le loyer d'emplacement du marche est
 *                        pourtant un decaissement professionnel reel de
 *                        l'annee, exactement de la meme famille que les
 *                        achats. Corrige ici en lisant les quatre colonnes de
 *                        `session_marche` deja agregees a la cloture.
 *   4. `commission_carte_cents` — commission SumUp retenue sur l'encaissement
 *                        carte de chaque session (`session_marche`, calculee
 *                        a la cloture par `calculerRentabilite` au taux
 *                        `taux_commission_sumup_bp`). MEME defaut que le
 *                        n° 3 et corrige de la meme facon : elle entrait deja
 *                        dans `margeNetteCents` (comptabilite ANALYTIQUE),
 *                        mais aucune ligne de cette synthese (comptabilite
 *                        GENERALE) ne la reprenait. C'est pourtant un
 *                        decaissement reel — SumUp la retient sur chaque
 *                        versement — de la MEME famille que les frais de
 *                        session : l'omettre SOUS-ESTIME les charges de
 *                        l'annee et SURESTIME d'autant le benefice, les
 *                        cotisations et l'impot estimes. Corrige ici en
 *                        lisant `session_marche.commission_carte_cents`.
 *   5. `frais_reception` — frais accessoires de reception (transport,
 *                        palette…), factures APRES la reception et ventiles
 *                        sur `lot.prixLigneCents` — jamais repercutes sur
 *                        `reception.montantTotalCents` (audit du 30/07/2026,
 *                        voir le commentaire de `totalFraisReceptionCents`
 *                        ci-dessus). MEME famille que les trois precedents :
 *                        un decaissement reel, invisible de cette synthese
 *                        tant qu'il n'etait pas relu. Corrige ici en lisant
 *                        `totalFraisReceptionCents`.
 *
 * ── Ce qui N'ENTRE PAS ici, et pourquoi ─────────────────────────────────────
 *
 * Le COUT MATIERE d'une session (`session_marche.cout_matiere_cents`) N'EST
 * PAS ajoute, alors qu'il semble decrire la meme farine. C'est la distinction
 * que CLAUDE.md §0 pose explicitement entre deux modules d'un ERP :
 *
 *   - « Comptabilite generale »   — CETTE fonction : ce qui a ete DECAISSE
 *     dans l'annee (achats + frais + depenses), independamment de ce qui a ete
 *     CONSOMME ou VENDU. C'est une comptabilite de tresorerie/engagement, la
 *     norme pour un independant complementaire sous le regime de la
 *     comptabilite simplifiee (pas de valorisation de stock au bilan).
 *   - « Comptabilite analytique » — `cout_matiere_cents` d'une session : ce
 *     que CE MARCHE a coute en matiere reellement sortie du stock (FEFO), pour
 *     calculer la marge de CETTE session precise. C'est une vue de gestion,
 *     pas une piece fiscale de l'exercice.
 *
 * Additionner les deux compterait la meme farine DEUX FOIS : une fois a
 * l'achat (reception), une fois a la consommation (cout matiere de session) —
 * exactement le meme defaut de fond que la depense immobilisee comptee a la
 * fois en charge et en annuite (docs/16 §4.1, corrige par
 * `montantDeductibleCharge`). Un test verifie explicitement que rattacher une
 * production couteuse a une session n'ajoute RIEN a `depensesDeductiblesCents`
 * au-dela des achats et des frais deja comptes
 * (`comptabilite-seuils-et-audit.test.ts`).
 *
 * ── Point NON TRANCHE, signale et non corrige (CLAUDE.md §7) ────────────────
 *
 * `depense.categorie` accepte la valeur `'matiere'` sur une saisie MANUELLE,
 * sans lien vers une reception. Si l'utilisateur y saisit un achat de matiere
 * deja couvert par une reception, celui-ci sera compte deux fois — et rien
 * dans le modele de donnees ne peut le detecter (aucune cle entre `depense` et
 * `reception`/`lot`). Ce n'est PAS corrige ici : exclure silencieusement la
 * categorie `matiere` risquerait au contraire de FAIRE DISPARAITRE une charge
 * reelle (un achat hors reception, cas rare mais possible). A confirmer avec
 * l'utilisateur : la categorie `matiere` doit-elle rester selectionnable sur
 * une depense manuelle maintenant que les receptions sont comptees a part ?
 *
 * Question fiscale distincte, elle aussi SIGNALEE et non tranchee : ce calcul
 * traite un achat comme une charge integrale de l'annee ou il est PAYE
 * (methode de caisse), sans retirer la valeur du stock non consomme en fin
 * d'exercice. Si le regime fiscal applicable exige une comptabilite
 * d'engagement avec valorisation de stock (stock initial + achats − stock
 * final = charge reelle), ce montant serait trop eleve les annees ou du stock
 * s'accumule. A confirmer avec un comptable.
 *
 * MEME AMBIGUITE, repere lors de l'ajout de la population n° 4 ci-dessus, sur
 * DEUX autres categories de `depense` qui recoupent des champs DEJA agreges
 * depuis `session_marche` :
 *   - `depense.categorie = 'emplacement'` ou `'carburant'` recoupent
 *     respectivement `frais_emplacement_cents` et
 *     `frais_deplacement_cents`/`frais_gaz_cents` deja comptes via
 *     `fraisSessionCents`. Rien n'empeche de saisir a la main le loyer
 *     d'emplacement ou le plein d'essence d'une session DEJA cloturee (ni cle
 *     ni controle entre `depense` et `session_marche`) ;
 *   - `depense.categorie = 'frais_bancaires'` recoupe desormais
 *     `commission_carte_cents` (population n° 4). Un releve SumUp saisi a la
 *     main comme frais bancaire compterait la MEME commission une seconde
 *     fois.
 * Meme parti pris que pour `matiere` : NE PAS retirer ces categories (un
 * loyer annuel hors session, ou de vrais frais bancaires distincts de SumUp,
 * restent des charges reelles a saisir ici), mais avertir au point de saisie
 * — voir `apps/web/src/pages/Comptabilite.tsx`.
 *
 * ── UN QUATRIEME RISQUE DU MEME GENRE, PROPRE AU GAZ (audit du 30/07/2026,
 * fiche 13) ──────────────────────────────────────────────────────────────
 *
 * Le gaz existe DEUX FOIS dans le modele de donnees (docs/demandes/17 « le
 * point central » : « le gaz existe deja deux fois dans l'application » ;
 * docs/demandes/15 §4.1 « piege n° 2 — le gaz serait compte deux fois »,
 * jamais tranche) :
 *   - comme CATEGORIE D'INGREDIENT (`ingredient.categorie = 'gaz'`), achetee
 *     en bouteilles via une `reception` — donc DEJA comptee ici, dans
 *     `achatsMarchandisesCents`, exactement comme n'importe quel autre
 *     ingredient ;
 *   - comme FRAIS DE SESSION (`session_marche.frais_gaz_cents`), saisi a la
 *     cloture — DEJA compte ici aussi, via `fraisSessionCents`.
 * Si les deux representent la MEME bouteille (achetee, puis « consommee »
 * cette session-la), ce montant est compte DEUX FOIS — precisement le defaut
 * deja evite pour le cout matiere de production (`coutMatiereCents`,
 * volontairement EXCLU ci-dessus). Contrairement a ce dernier cas, RIEN ici
 * n'exclut `frais_gaz_cents` : aucune cle ne relie non plus `reception`/`lot`
 * a `session_marche`, donc le risque ne peut pas etre detecte techniquement,
 * seulement signale. `depots/comptabilite.test.ts` (« ne protege PAS contre
 * le double comptage du gaz ») PROUVE ce constat sur le code actuel, sans le
 * corriger : exclure `frais_gaz_cents` supposerait que le gaz est TOUJOURS
 * suivi en stock (docs/demandes/15 §4.1 hypothese A retenue : « le gaz reste
 * un frais de session forfaitaire », PAS une consommation de stock), ce qui
 * ferait au contraire DISPARAITRE une charge reelle chez qui ne receptionne
 * jamais ses bouteilles de gaz comme un ingredient. A confirmer avec le
 * porteur : les bouteilles de gaz sont-elles reellement receptionnees via le
 * circuit stock, et si oui, `frais_gaz_cents` doit-il alors disparaitre de
 * cette synthese (comptabilite GENERALE) tout en restant dans la marge
 * ANALYTIQUE de la session (`calculerRentabilite`, `@batte/core`) ?
 *
 * ── UN CINQUIEME RISQUE DU MEME GENRE, PROPRE AUX FRAIS DE RECEPTION (audit
 * du 30/07/2026) ────────────────────────────────────────────────────────────
 *
 * Le commentaire de `frais_reception` dans `schema.ts` (hors zone d'ecriture
 * de cet agent) est explicite sur son origine : « Aller chercher 50 kg de
 * farine au moulin a un cout. Aujourd'hui il atterrit dans `depense` avec la
 * categorie carburant ». C'est exactement la categorie `depense.categorie =
 * 'carburant'` deja signalee ci-dessus pour son recoupement avec
 * `frais_deplacement_cents`/`frais_gaz_cents` de session — et le MEME trajet
 * peut desormais AUSSI apparaitre une troisieme fois ici, en `frais_reception`,
 * si le fournisseur facture lui-meme le transport plutot que le porteur
 * n'aille le chercher. Rien ne relie techniquement une ligne `depense`
 * (categorie carburant) a une ligne `frais_reception` : le risque ne peut pas
 * etre detecte, seulement signale — meme parti pris que pour le gaz et la
 * matiere ci-dessus : NE PAS retirer la categorie `carburant`, avertir au
 * point de saisie (voir `apps/web/src/pages/Comptabilite.tsx`).
 */
export function syntheseExercice(base: BaseBatte, annee: number): SyntheseExercice {
  const sessions = base
    .select({
      ca: sessionMarche.caTotalCents,
      fraisEmplacementCents: sessionMarche.fraisEmplacementCents,
      fraisDeplacementCents: sessionMarche.fraisDeplacementCents,
      fraisGazCents: sessionMarche.fraisGazCents,
      fraisDiversCents: sessionMarche.fraisDiversCents,
      commissionCarteCents: sessionMarche.commissionCarteCents,
    })
    .from(sessionMarche)
    .where(
      and(
        eq(sessionMarche.statut, 'cloturee'),
        sql`substr(${sessionMarche.dateSession}, 1, 4) = ${String(annee)}`,
      ),
    )
    .all();
  const recettesCents = sessions.reduce((somme, s) => somme + (s.ca ?? 0), 0);

  // Frais de session (emplacement, deplacement, gaz, divers) : voir le
  // commentaire de fonction — decaisses reels de l'exercice, jusqu'ici invisibles
  // de cette synthese alors qu'ils entraient deja dans la marge nette analytique.
  const fraisSessionCents = sessions.reduce(
    (somme, s) =>
      somme +
      s.fraisEmplacementCents +
      s.fraisDeplacementCents +
      s.fraisGazCents +
      s.fraisDiversCents,
    0,
  );

  // Commission SumUp (population n° 4, voir le commentaire de fonction) :
  // nullable en base (sessions closes sans encaissement carte), `?? 0` comme
  // pour les receptions a `montant_total_cents` nul.
  const commissionsCarteCents = sessions.reduce(
    (somme, s) => somme + (s.commissionCarteCents ?? 0),
    0,
  );

  // `immobilisationId` est lu et non ignore : une depense immobilisee se deduit
  // par ses annuites, pas en charge de l'exercice. La compter des deux cotes
  // deduisait deux fois le meme bien et minorait le resultat d'autant — voir
  // `montantDeductibleCharge` dans `@batte/core` pour le chiffrage.
  const lignesDepenses = base
    .select({
      montantCents: depense.montantCents,
      deductibleBp: depense.deductibleBp,
      immobilisationId: depense.immobilisationId,
    })
    .from(depense)
    .where(sql`substr(${depense.dateDepense}, 1, 4) = ${String(annee)}`)
    .all();
  const depensesSaisiesCents = lignesDepenses.reduce(
    (somme, l) =>
      somme +
      montantDeductibleCharge({
        montantCents: l.montantCents,
        deductibleBp: l.deductibleBp,
        immobilisee: l.immobilisationId !== null,
      }),
    0,
  );

  // Achats de marchandises (receptions) : voir le commentaire de fonction pour
  // la definition retenue et ce qui est deliberement exclu (cout matiere).
  const achatsMarchandisesCents = totalAchatsMarchandisesCents(base, annee);

  // Frais accessoires de reception (transport, palette…) : voir le
  // commentaire de `totalFraisReceptionCents` — cinquieme population,
  // decouverte a l'audit du 30/07/2026.
  const fraisReceptionCents = totalFraisReceptionCents(base, annee);

  // Les CINQ populations de charges de l'exercice, additionnees UNE SEULE
  // fois chacune : depenses saisies + achats de marchandises + frais de
  // session + commission carte + frais de reception. `estimerResultat` ne
  // fait que retrancher ce total des recettes, aucun calcul metier n'est
  // refait ici (CLAUDE.md §3 regle n°1).
  const depensesDeductiblesCents =
    depensesSaisiesCents +
    achatsMarchandisesCents +
    fraisSessionCents +
    commissionsCarteCents +
    fraisReceptionCents;

  const lignesAmortissement = base
    .select({ montantCents: amortissementAnnuite.montantCents })
    .from(amortissementAnnuite)
    .where(eq(amortissementAnnuite.exercice, annee))
    .all();
  const amortissementsCents = lignesAmortissement.reduce((somme, l) => somme + l.montantCents, 0);

  const parametres = lireParametres(base, `${annee}-12-31`);

  const resultat = estimerResultat({
    recettesCents,
    depensesDeductiblesCents,
    amortissementsCents,
    tauxCotisationBp: parametres.pointsDeBase('taux_cotisation_inasti_bp'),
    tauxImpotBp: parametres.pointsDeBase('taux_ipp_marginal_bp'),
  });

  return { ...resultat, annee };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ventes par creneau horaire (fiche 13, docs/17)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Lignes de vente brutes des sessions CLOTUREES d'un exercice, matiere
 * premiere de `agregerVentesParCreneau` (@batte/core, qui cumule par creneau
 * horaire).
 *
 * Vivait comme une requete Drizzle DIRECTE dans
 * `apps/api/src/routes/comptabilite.ts`, faute de barillet modifiable au
 * moment de son ecriture (CLAUDE.md §3 regle 1 : aucune logique de donnees
 * dans un handler Fastify). Descendue ici.
 *
 * Depot COMPTABILITE, pas SESSIONS, et c'est un choix deliberement repris de
 * la route d'origine : `depots/sessions.ts` repond deja a « une session, en
 * detail » et « la liste des sessions ». Cumuler des ventes AU TRAVERS de
 * plusieurs sessions pour en tirer une marge PAR AXE est exactement ce que
 * CLAUDE.md §0 nomme « comptabilite analytique » — la meme famille que
 * `syntheseExercice` ci-dessus, qui lit deja `session_marche` dans CE fichier
 * pour la meme raison.
 */
export function ventesParCreneauBrutes(base: BaseBatte, annee: number): LigneVenteCreneauBrute[] {
  return base
    .select({
      sessionId: sessionVente.sessionId,
      creneauHoraire: sessionVente.creneauHoraire,
      montantCents: sessionVente.montantCents,
      quantite: sessionVente.quantite,
      margeBruteSessionCents: sessionMarche.margeBruteCents,
      margeNetteSessionCents: sessionMarche.margeNetteCents,
    })
    .from(sessionVente)
    .innerJoin(sessionMarche, eq(sessionVente.sessionId, sessionMarche.id))
    .where(
      and(
        eq(sessionMarche.statut, 'cloturee'),
        sql`substr(${sessionMarche.dateSession}, 1, 4) = ${String(annee)}`,
      ),
    )
    .all();
}
