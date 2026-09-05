/**
 * Dépôt des objectifs (budget), succès et niveaux (fiche
 * `docs/demandes/18-SUCCES-NIVEAUX-ET-OBJECTIFS.md`).
 *
 * `depots/sessions.ts` (pour `tableauSeuils`, `listerSessions`,
 * `lireSessionDetail`) est un fichier SŒUR du présent module, dans le même
 * paquet : l'import direct ci-dessous est un import relatif ordinaire entre
 * deux fichiers de `packages/db/src/depots/`. Tout le reste passe par le nom de
 * paquet `@batte/core`.
 *
 * ═══ Objectifs (budget, fiche §4) — câblés ═══
 *
 * La fiche identifie les OBJECTIFS comme l'apport le plus solide — se fixer
 * une cible de CA, de marge, de coût matière ou de nombre de sessions et
 * suivre l'écart dans le temps. La table `objectif` existe (migration
 * `0022_awesome_lyja.sql`). `creerObjectif`, `listerObjectifs` et
 * `annulerObjectif` ci-dessous en font la persistance ; le calcul de l'écart
 * cible/réalisé reste ENTIÈREMENT délégué à `evaluerObjectif`
 * (`packages/core/src/objectifs.ts`, CLAUDE.md §3 règle 1) — ce dépôt ne fait
 * que lire les sessions clôturées de la période et lui passer le réalisé.
 *
 * Correction ou abandon d'un objectif : CONTRE-ÉCRITURE dans `notes`
 * (marqueur `[ANNULATION:<id>]`), exactement comme `depense`
 * (`packages/db/src/depots/comptabilite.ts`, `MARQUEUR_ANNULATION`) — la table
 * `objectif` n'a pas de colonne `is_annule` / `annule_par_id`, et rien ne
 * s'efface (CLAUDE.md §3 règle 7). Il n'y a pas de fonction « modifier » qui
 * réécrirait une ligne existante : une correction s'annule puis se ressaisit,
 * même geste qu'une dépense.
 *
 * ═══ Succès et niveaux (fiche §3, §5) ═══
 *
 * `calculerSucces`, à l'inverse, ne dépend d'AUCUNE table nouvelle : un succès
 * est une VUE recalculée depuis les données déjà en base (CLAUDE.md §3
 * règle 5, fiche §5.1) — jamais un état stocké.
 */

import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  jourCivilBelge,
  evaluerAnticipationSeuil,
  evaluerNiveau,
  evaluerObjectif,
  evaluerPaliersSerie,
  trimestreCivil,
  ErreurIntrouvable,
  ErreurMetier,
  maintenantUtc,
  nouvelIdentifiant,
  JOURS_ANTICIPATION_PALIERS,
  PALIERS_AFSCA_SERIE,
  PALIERS_COUT_REVIENT_SERIE,
  PALIERS_GASPILLAGE_SERIE,
  PALIERS_MARGE_SERIE,
  PALIERS_NIVEAU_ANCIENNETE,
  PALIERS_NIVEAU_CA,
  PALIERS_PREVISION_SERIE,
  SEUIL_MARGE_NETTE_SERIE_CENTS,
  TOLERANCE_ECART_PREVISION_SERIE_BP,
  type EvenementSerie,
  type GrandeurObjectif,
  type ResultatEvaluationObjectif,
  type ResultatNiveau,
  type ResultatSerie,
} from '@batte/core';
import type { BaseBatte } from '../client.js';
import { objectif, prevision, releveTemperature, sessionMarche } from '../schema.js';
import { lireParametres } from './parametres.js';
import { lireSessionDetail, tableauSeuils, type TableauSeuilsResultat } from './sessions.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Objectifs (budget, fiche §4) — créer, lire, annuler
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Marqueur d'annulation, écrit dans `notes` — même mécanisme que `depense`
 * (`packages/db/src/depots/comptabilite.ts`, `MARQUEUR_ANNULATION`) : la
 * table `objectif` n'a pas de colonne `is_annule` / `annule_par_id`, et rien
 * ne s'efface (CLAUDE.md §3 règle 7). Constante propre à ce module — celle de
 * `comptabilite.ts` n'est pas exportée, et les deux tables sont indépendantes.
 */
const MARQUEUR_ANNULATION_OBJECTIF = /^\[ANNULATION:([^\]]+)\]\s*(.*)$/;

export type EntreeObjectif = {
  readonly grandeur: GrandeurObjectif;
  readonly dateDebut: string;
  readonly dateFin: string;
  readonly valeurCible: number;
  readonly notes?: string | null;
};

export type ObjectifLigne = {
  readonly id: string;
  readonly grandeur: GrandeurObjectif;
  readonly dateDebut: string;
  readonly dateFin: string;
  readonly valeurCible: number;
  readonly notes: string | null;
  /** Vrai si cette ligne EST une contre-écriture d'annulation. */
  readonly estAnnulation: boolean;
  /** Identifiant de l'objectif annulé par cette ligne, si `estAnnulation`. */
  readonly objectifAnnuleId: string | null;
  /** Vrai si une autre ligne annule celle-ci. */
  readonly estAnnule: boolean;
  readonly creeLe: string;
  readonly modifieLe: string;
  readonly evaluation: ResultatEvaluationObjectif;
};

/**
 * Réalisé d'un objectif sur sa période, lu depuis les sessions CLÔTURÉES qui y
 * tombent. `null` = aucune session clôturée sur la période — jamais confondu
 * avec un réalisé de zéro (voir `evaluerObjectif`, packages/core/src/objectifs.ts) :
 * une période qui n'a encore vu aucune session n'a simplement rien à évaluer.
 */
function calculerRealiseObjectif(
  base: BaseBatte,
  grandeur: GrandeurObjectif,
  dateDebut: string,
  dateFin: string,
): number | null {
  const sessions = base
    .select({
      id: sessionMarche.id,
      caTotalCents: sessionMarche.caTotalCents,
      margeNetteCents: sessionMarche.margeNetteCents,
    })
    .from(sessionMarche)
    .where(
      and(
        eq(sessionMarche.statut, 'cloturee'),
        gte(sessionMarche.dateSession, dateDebut),
        lte(sessionMarche.dateSession, dateFin),
      ),
    )
    .all();

  if (sessions.length === 0) return null;

  switch (grandeur) {
    case 'chiffre_affaires':
      return sessions.reduce((somme, s) => somme + (s.caTotalCents ?? 0), 0);
    case 'marge_nette':
      return sessions.reduce((somme, s) => somme + (s.margeNetteCents ?? 0), 0);
    case 'nombre_sessions':
      return sessions.length;
    case 'cout_matiere_par_crepe': {
      // Même source que l'axe « coût de revient » des succès
      // (`serieCoutRevient` plus bas) : `lireSessionDetail` reconstruit le
      // coût matière du TRANSFORME par crêpe vendue, en excluant le REVENDU.
      const couts = sessions
        .map((s) => lireSessionDetail(base, s.id)?.coutMatiereParCrepeCents ?? null)
        .filter((c): c is number => c !== null);
      if (couts.length === 0) return null;
      return Math.round(couts.reduce((somme, c) => somme + c, 0) / couts.length);
    }
  }
}

/** Enregistre un nouvel objectif. La cible doit être strictement positive
 * (défense en profondeur : `schemaCreationObjectif` la valide déjà côté
 * route, même geste que `enregistrerDepense` pour `montantCents`). */
export function creerObjectif(base: BaseBatte, entree: EntreeObjectif): { id: string } {
  if (!Number.isInteger(entree.valeurCible) || entree.valeurCible <= 0) {
    throw new ErreurMetier(
      'valeur_cible_invalide',
      'La cible doit être un nombre entier strictement positif.',
      { champs: { valeurCible: 'Indiquez une cible entière supérieure à zéro.' } },
    );
  }

  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  base
    .insert(objectif)
    .values({
      id,
      grandeur: entree.grandeur,
      dateDebut: entree.dateDebut,
      dateFin: entree.dateFin,
      valeurCible: entree.valeurCible,
      notes: entree.notes ?? null,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();

  return { id };
}

/**
 * Liste tous les objectifs (origines ET contre-écritures d'annulation),
 * chacun accompagné de son évaluation cible/réalisé.
 *
 * @param jourReference Jour civil belge utilisé pour décider si la période
 *   est terminée (`evaluerObjectif`). Paramètre explicite plutôt que
 *   `new Date()` figé à l'import — même geste que `calculerSucces` — pour
 *   rester testable sans horloge.
 */
export function listerObjectifs(base: BaseBatte, jourReference?: string): ObjectifLigne[] {
  const jour = jourReference ?? jourCivilBelge(new Date());

  const lignes = base
    .select({
      id: objectif.id,
      grandeur: objectif.grandeur,
      dateDebut: objectif.dateDebut,
      dateFin: objectif.dateFin,
      valeurCible: objectif.valeurCible,
      notes: objectif.notes,
      creeLe: objectif.creeLe,
      modifieLe: objectif.modifieLe,
    })
    .from(objectif)
    .orderBy(desc(objectif.dateDebut), desc(objectif.creeLe))
    .all();

  const idsAnnules = new Set(
    lignes
      .map((l) => (l.notes === null ? null : MARQUEUR_ANNULATION_OBJECTIF.exec(l.notes)?.[1]))
      .filter((id): id is string => id !== undefined && id !== null),
  );

  return lignes.map((l) => {
    const correspondance = l.notes === null ? null : MARQUEUR_ANNULATION_OBJECTIF.exec(l.notes);
    const realise = calculerRealiseObjectif(base, l.grandeur, l.dateDebut, l.dateFin);
    return {
      id: l.id,
      grandeur: l.grandeur,
      dateDebut: l.dateDebut,
      dateFin: l.dateFin,
      valeurCible: l.valeurCible,
      notes: l.notes,
      estAnnulation: correspondance !== null,
      objectifAnnuleId: correspondance?.[1] ?? null,
      estAnnule: idsAnnules.has(l.id),
      creeLe: l.creeLe,
      modifieLe: l.modifieLe,
      evaluation: evaluerObjectif({
        grandeur: l.grandeur,
        valeurCible: l.valeurCible,
        realise,
        periodeTerminee: jour > l.dateFin,
      }),
    };
  });
}

/**
 * Annule un objectif par contre-écriture (voir `MARQUEUR_ANNULATION_OBJECTIF`).
 *
 * Contrairement à `annulerDepense`, aucun verrou de période à vérifier : un
 * objectif est un budget personnel, pas une écriture comptable soumise à la
 * clôture mensuelle (`periode`) — cette contrainte n'existe donc pas ici.
 */
export function annulerObjectif(
  base: BaseBatte,
  objectifId: string,
  motif: string,
): { id: string } {
  const motifPropre = motif.trim();
  if (motifPropre === '') {
    throw new ErreurMetier(
      'motif_obligatoire',
      "L'annulation d'un objectif exige un motif : c'est lui qui rend la correction auditable.",
      { champs: { motif: 'Indiquez pourquoi cet objectif est annulé ou corrigé.' } },
    );
  }

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const origine = baseTx.select().from(objectif).where(eq(objectif.id, objectifId)).get();
    if (origine === undefined) throw new ErreurIntrouvable('Objectif', objectifId);

    const marqueur = `[ANNULATION:${objectifId}]`;
    const dejaAnnule = baseTx
      .select({ id: objectif.id })
      .from(objectif)
      .where(sql`${objectif.notes} LIKE ${`${marqueur}%`}`)
      .all();
    if (dejaAnnule.length > 0) {
      throw new ErreurMetier(
        'deja_annule',
        "Cet objectif a déjà été annulé. Une écriture ne se contrepasse qu'une seule fois.",
      );
    }

    const id = nouvelIdentifiant();
    const maintenant = maintenantUtc();

    baseTx
      .insert(objectif)
      .values({
        id,
        grandeur: origine.grandeur,
        dateDebut: origine.dateDebut,
        dateFin: origine.dateFin,
        valeurCible: origine.valeurCible,
        notes: `${marqueur} ${motifPropre}`,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    return { id };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Succès — cinq axes en série (fiche §3)
   ═══════════════════════════════════════════════════════════════════════════ */

export type ResultatSerieAxe = ResultatSerie & {
  readonly cle: string;
  readonly libelleAxe: string;
};

type SessionClotureeLigne = {
  readonly id: string;
  readonly dateSession: string;
  readonly margeNetteCents: number | null;
  readonly crepesInvendues: number;
  readonly crepesProduites: number;
};

function sessionsCloturees(base: BaseBatte): SessionClotureeLigne[] {
  return base
    .select({
      id: sessionMarche.id,
      dateSession: sessionMarche.dateSession,
      margeNetteCents: sessionMarche.margeNetteCents,
      crepesInvendues: sessionMarche.crepesInvendues,
      crepesProduites: sessionMarche.crepesProduites,
    })
    .from(sessionMarche)
    .where(eq(sessionMarche.statut, 'cloturee'))
    .orderBy(asc(sessionMarche.dateSession), asc(sessionMarche.numero))
    .all();
}

/** Axe « marge » : N sessions clôturées d'affilée au-dessus du seuil de marge nette. */
function serieMarge(sessions: readonly SessionClotureeLigne[]): ResultatSerieAxe {
  const evenements: EvenementSerie[] = sessions.map((s) => ({
    date: s.dateSession,
    reussite: s.margeNetteCents !== null && s.margeNetteCents >= SEUIL_MARGE_NETTE_SERIE_CENTS,
  }));
  return {
    cle: 'marge',
    libelleAxe: 'Marge nette',
    ...evaluerPaliersSerie(evenements, PALIERS_MARGE_SERIE),
  };
}

/** Axe « gaspillage » : N sessions clôturées d'affilée sans une seule crêpe invendue. */
function serieGaspillage(sessions: readonly SessionClotureeLigne[]): ResultatSerieAxe {
  const evenements: EvenementSerie[] = sessions.map((s) => ({
    date: s.dateSession,
    // `crepesProduites > 0` : une session sans production n'est pas un succès
    // de zéro gaspillage, c'est une session dégénérée.
    reussite: s.crepesProduites > 0 && s.crepesInvendues === 0,
  }));
  return {
    cle: 'gaspillage',
    libelleAxe: 'Zéro gaspillage',
    ...evaluerPaliersSerie(evenements, PALIERS_GASPILLAGE_SERIE),
  };
}

/** Axe « prévision » : N sessions d'affilée où l'écart prévision/réel reste sous la tolérance. */
function seriePrevision(base: BaseBatte): ResultatSerieAxe {
  const rapprochees = base
    .select({
      sessionId: prevision.sessionId,
      dateCalcul: prevision.dateCalcul,
      erreurAbsolueBp: prevision.erreurAbsolueBp,
      dateSession: sessionMarche.dateSession,
    })
    .from(prevision)
    .innerJoin(sessionMarche, eq(prevision.sessionId, sessionMarche.id))
    .where(sql`${prevision.crepesReelles} IS NOT NULL`)
    .all();

  // Une session peut avoir été prévisionnée plusieurs fois (J-7, J-3, J-1…) :
  // seule la DERNIÈRE prévision archivée compte, même choix que
  // `qualiteModele` (`packages/db/src/depots/previsions.ts`).
  const derniereParSession = new Map<string, (typeof rapprochees)[number]>();
  for (const r of rapprochees) {
    if (r.sessionId === null) continue;
    const existante = derniereParSession.get(r.sessionId);
    if (existante === undefined || r.dateCalcul > existante.dateCalcul) {
      derniereParSession.set(r.sessionId, r);
    }
  }

  const triees = [...derniereParSession.values()].sort((a, b) =>
    a.dateSession.localeCompare(b.dateSession),
  );
  const evenements: EvenementSerie[] = triees.map((r) => ({
    date: r.dateSession,
    reussite: r.erreurAbsolueBp !== null && r.erreurAbsolueBp <= TOLERANCE_ECART_PREVISION_SERIE_BP,
  }));
  return {
    cle: 'prevision',
    libelleAxe: 'Justesse de prévision',
    ...evaluerPaliersSerie(evenements, PALIERS_PREVISION_SERIE),
  };
}

/**
 * Axe « régularité AFSCA » : N sessions clôturées d'affilée avec un relevé
 * d'arrivée ET un relevé de retour. Lu sur les dates de saisie RÉELLES
 * (`releve_temperature`, jamais reconstitué) — CLAUDE.md §7.
 *
 * Un relevé ANNULÉ (`statut = 'annulee'`, D-083) ne compte PAS ici : il ne
 * fait plus foi, exactement comme dans `sessionsSansReleveTemperature`
 * (`packages/db/src/services/afsca.ts`). Le laisser compter reviendrait à
 * se décerner un succès de régularité sur un relevé qu'on vient soi-même de
 * déclarer faux — le sens même de l'annulation serait défait.
 */
function serieAfsca(base: BaseBatte, sessions: readonly SessionClotureeLigne[]): ResultatSerieAxe {
  const releves = base
    .select({ sessionId: releveTemperature.sessionId, moment: releveTemperature.moment })
    .from(releveTemperature)
    .where(
      and(
        inArray(releveTemperature.moment, ['arrivee', 'retour']),
        eq(releveTemperature.statut, 'active'),
      ),
    )
    .all();

  const momentsParSession = new Map<string, Set<string>>();
  for (const r of releves) {
    if (r.sessionId === null) continue;
    const ensemble = momentsParSession.get(r.sessionId) ?? new Set<string>();
    ensemble.add(r.moment);
    momentsParSession.set(r.sessionId, ensemble);
  }

  const evenements: EvenementSerie[] = sessions.map((s) => {
    const moments = momentsParSession.get(s.id);
    return {
      date: s.dateSession,
      reussite: moments !== undefined && moments.has('arrivee') && moments.has('retour'),
    };
  });
  return {
    cle: 'afsca',
    libelleAxe: 'Régularité AFSCA',
    ...evaluerPaliersSerie(evenements, PALIERS_AFSCA_SERIE),
  };
}

/**
 * Axe « coût de revient » : trimestres civils d'affilée où le coût matière
 * moyen du TRANSFORME par crêpe vendue a baissé par rapport au précédent.
 *
 * Réutilise `lireSessionDetail` (déjà exporté par `@batte/db`) plutôt que de
 * dupliquer la reconstruction transformé/revendu (mouvements de stock) que ce
 * calcul exige — voir le commentaire de `lireSessionDetail` dans
 * `depots/sessions.ts` : sans cette séparation, le coût d'achat d'un produit
 * REVENDU se retrouve divisé par des crêpes qui n'ont rien à voir avec lui.
 */
function serieCoutRevient(
  base: BaseBatte,
  sessions: readonly SessionClotureeLigne[],
): ResultatSerieAxe {
  const parTrimestre = new Map<
    string,
    { sommeCents: number; nb: number; derniereDateSession: string }
  >();

  for (const s of sessions) {
    const detail = lireSessionDetail(base, s.id);
    if (detail === null || detail.coutMatiereParCrepeCents === null) continue;

    const trimestre = trimestreCivil(detail.dateSession);
    const existant = parTrimestre.get(trimestre);
    if (existant === undefined) {
      parTrimestre.set(trimestre, {
        sommeCents: detail.coutMatiereParCrepeCents,
        nb: 1,
        derniereDateSession: detail.dateSession,
      });
    } else {
      existant.sommeCents += detail.coutMatiereParCrepeCents;
      existant.nb += 1;
      if (detail.dateSession > existant.derniereDateSession) {
        existant.derniereDateSession = detail.dateSession;
      }
    }
  }

  const trimestresTries = [...parTrimestre.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, agg]) => ({ moyenneCents: agg.sommeCents / agg.nb, date: agg.derniereDateSession }));

  const evenements: EvenementSerie[] = [];
  for (let i = 1; i < trimestresTries.length; i += 1) {
    const precedent = trimestresTries[i - 1]!;
    const courant = trimestresTries[i]!;
    evenements.push({
      date: courant.date,
      reussite: courant.moyenneCents < precedent.moyenneCents,
    });
  }

  return {
    cle: 'cout_revient',
    libelleAxe: 'Coût de revient en baisse',
    ...evaluerPaliersSerie(evenements, PALIERS_COUT_REVIENT_SERIE),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Niveaux — chiffre d'affaires cumulé (TOUJOURS avec le contexte des seuils
   légaux, fiche §2.1 : « un palier de CA ne doit jamais s'afficher nu ») et
   ancienneté active (nombre de sessions clôturées tenues).
   ═══════════════════════════════════════════════════════════════════════════ */

export type NiveauChiffreAffaires = {
  readonly niveau: ResultatNiveau;
  readonly contexteSeuilsLegaux: TableauSeuilsResultat;
};

function niveauChiffreAffaires(base: BaseBatte, jourReference: string): NiveauChiffreAffaires {
  const totaux = base
    .select({
      caTotalCents: sql<number>`COALESCE(SUM(${sessionMarche.caTotalCents}), 0)`,
    })
    .from(sessionMarche)
    .where(eq(sessionMarche.statut, 'cloturee'))
    .get();

  const anneeCourante = Number.parseInt(jourReference.slice(0, 4), 10);

  return {
    niveau: evaluerNiveau(totaux?.caTotalCents ?? 0, PALIERS_NIVEAU_CA),
    // Contexte lu EN DIRECT dans `parametre` via `tableauSeuils` (déjà exporté
    // par `@batte/db`) : jamais recopié dans les paliers de niveau, qui
    // resteraient périmés si un seuil légal changeait (voir `succes.ts`).
    contexteSeuilsLegaux: tableauSeuils(base, anneeCourante),
  };
}

function niveauAnciennete(sessions: readonly SessionClotureeLigne[]): ResultatNiveau {
  return evaluerNiveau(sessions.length, PALIERS_NIVEAU_ANCIENNETE);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Anticipation d'un seuil légal — la préparation, pas le montant (fiche §2.1)
   ═══════════════════════════════════════════════════════════════════════════ */

export type ResultatAnticipationSeuilNiveau = {
  readonly cle: string;
  readonly libelle: string;
  readonly dateFranchissementReel: string | null;
  readonly datePremiereAlerte: string | null;
  readonly joursAnticipation: number | null;
  readonly niveau: ResultatNiveau;
};

/**
 * Trois seuils à assiette CA (franchise TVA, Airbag, SCE) — la cotisation
 * réduite est exclue : son assiette est le REVENU NET, pas le CA, et sa
 * reconstruction historique session par session demanderait de rejouer
 * `syntheseExercice` à chaque point de la série, hors périmètre de cette
 * livraison.
 */
const SEUILS_ANTICIPATION = [
  { cle: 'seuil_franchise_tva_cents', libelle: 'Franchise TVA', assiette: 'total' },
  { cle: 'seuil_airbag_cents', libelle: 'Éligibilité Airbag', assiette: 'total' },
  {
    cle: 'seuil_sce_cents',
    libelle: 'Caisse enregistreuse certifiée (SCE)',
    assiette: 'ca_sur_place',
  },
] as const;

function anneesClotureesDistinctes(base: BaseBatte): number[] {
  return base
    .selectDistinct({ annee: sql<string>`substr(${sessionMarche.dateSession}, 1, 4)` })
    .from(sessionMarche)
    .where(eq(sessionMarche.statut, 'cloturee'))
    .all()
    .map((r) => Number.parseInt(r.annee, 10))
    .sort((a, b) => a - b);
}

function anticipationSeuils(base: BaseBatte): ResultatAnticipationSeuilNiveau[] {
  const resultats: ResultatAnticipationSeuilNiveau[] = [];

  for (const annee of anneesClotureesDistinctes(base)) {
    const lignesAnnee = base
      .select({
        dateSession: sessionMarche.dateSession,
        caTotalCents: sessionMarche.caTotalCents,
        caSurPlaceCents: sessionMarche.caSurPlaceCents,
      })
      .from(sessionMarche)
      .where(
        and(
          eq(sessionMarche.statut, 'cloturee'),
          sql`substr(${sessionMarche.dateSession}, 1, 4) = ${String(annee)}`,
        ),
      )
      .orderBy(asc(sessionMarche.dateSession))
      .all();

    // Lu à la même date que `tableauSeuils` pour une année passée : le rythme
    // et les plafonds qui s'appliquent sont ceux de CETTE année-là.
    const parametresAnnee = lireParametres(base, `${annee}-12-31`);
    const sessionsPrevuesDansLAnnee = parametresAnnee.entier('seuils_sessions_prevues_par_an');

    for (const definition of SEUILS_ANTICIPATION) {
      let cumul = 0;
      const serie = lignesAnnee.map((ligne, index) => {
        const valeur =
          definition.assiette === 'ca_sur_place'
            ? (ligne.caSurPlaceCents ?? 0)
            : (ligne.caTotalCents ?? 0);
        cumul += valeur;
        return { date: ligne.dateSession, cumulRealiseCents: cumul, sessionsTenues: index + 1 };
      });

      const resultat = evaluerAnticipationSeuil({
        cle: `${definition.cle}_${annee}`,
        libelle: `${definition.libelle} ${annee}`,
        serie,
        plafondCents: parametresAnnee.centimes(definition.cle),
        sessionsPrevuesDansLAnnee,
      });

      // Seuls les seuils EFFECTIVEMENT franchis cette année-là comptent comme
      // un fait accompli à afficher : un seuil jamais atteint n'a rien à
      // « anticiper ».
      if (resultat.dateFranchissementReel === null) continue;

      resultats.push({
        ...resultat,
        // Anticipation négative (alerte venue APRÈS le franchissement, donc
        // aucune anticipation) ou inconnue (jamais alertée) : niveau 0, jamais
        // un palier de préparation.
        niveau: evaluerNiveau(
          Math.max(resultat.joursAnticipation ?? 0, 0),
          JOURS_ANTICIPATION_PALIERS,
        ),
      });
    }
  }

  return resultats;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Enveloppe complète — alimente `GET /api/objectifs/succes`
   ═══════════════════════════════════════════════════════════════════════════ */

export type ResultatSucces = {
  readonly series: readonly ResultatSerieAxe[];
  readonly niveauChiffreAffaires: NiveauChiffreAffaires;
  readonly niveauAnciennete: ResultatNiveau;
  readonly anticipationSeuils: readonly ResultatAnticipationSeuilNiveau[];
};

/**
 * Calcule l'intégralité des succès et niveaux. Une VUE au sens strict
 * (CLAUDE.md §3 règle 5, fiche §5.1) : rien n'est lu ni écrit ailleurs qu'ici,
 * aucun drapeau « obtenu » n'existe en base — tout est recalculé à chaque
 * appel depuis les sessions, prévisions et relevés de température déjà
 * enregistrés.
 */
export function calculerSucces(base: BaseBatte, jourReference?: string): ResultatSucces {
  const jour = jourReference ?? jourCivilBelge(new Date());
  const sessions = sessionsCloturees(base);

  return {
    series: [
      serieMarge(sessions),
      serieGaspillage(sessions),
      seriePrevision(base),
      serieAfsca(base, sessions),
      serieCoutRevient(base, sessions),
    ],
    niveauChiffreAffaires: niveauChiffreAffaires(base, jour),
    niveauAnciennete: niveauAnciennete(sessions),
    anticipationSeuils: anticipationSeuils(base),
  };
}
