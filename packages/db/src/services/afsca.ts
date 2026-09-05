/**
 * Registre AFSCA (Lot 8) : relevés de température, plan de nettoyage,
 * non-conformités, exercice de traçabilité.
 *
 * CLAUDE.md §7 : « le registre enregistre ce qui a été saisi, avec sa date de
 * saisie réelle. » D'où la distinction stricte, sur chaque table, entre la
 * date MÉTIER de l'événement (`dateReleve`, `dateExecution`, `dateConstat`,
 * `dateExercice` — un jour civil belge) et `creeLe`, l'instant RÉEL d'écriture
 * en base. Aucune des deux ne se substitue à l'autre.
 */

import {
  ErreurIntrouvable,
  ErreurMetier,
  joursEntre,
  maintenantUtc,
  nouvelIdentifiant,
} from '@batte/core';
import { and, desc, eq, gt, gte, lte } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  exerciceTracabilite,
  lieuMarche,
  nettoyageExecution,
  nonConformite,
  releveTemperature,
  sessionMarche,
  tacheNettoyage,
} from '../schema.js';
import { journaliser, listerJournalAudit } from '../depots/audit.js';
import { lireParametres } from '../depots/parametres.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Relevés de température
   ═══════════════════════════════════════════════════════════════════════════ */

export type MomentReleve = 'depart' | 'arrivee' | 'mi_session' | 'retour' | 'stockage';
export type StatutReleveTemperature = 'active' | 'annulee';
export type ReleveTemperature = typeof releveTemperature.$inferSelect;

/**
 * Un relevé enrichi du motif et de l'instant de sa propre annulation (D-083),
 * quand elle a eu lieu — voir `avecMotifAnnulation` plus bas pour pourquoi ces
 * deux champs ne peuvent venir que du journal d'audit, jamais d'une colonne.
 */
export type ReleveTemperatureAvecAnnulation = ReleveTemperature & {
  readonly motifAnnulation: string | null;
  readonly dateAnnulation: string | null;
};

export type EntreeReleveTemperature = {
  readonly sessionId?: string | null;
  readonly productionId?: string | null;
  readonly equipement: string;
  readonly temperatureC: number;
  /** Jour civil belge du relevé — jamais l'instant de saisie. */
  readonly dateReleve: string;
  readonly moment: MomentReleve;
  readonly actionCorrective?: string | null;
  readonly relevePar?: string | null;
};

/**
 * Cœur d'`enregistrerReleveTemperature`, SANS transaction propre : appelable
 * depuis une transaction déjà ouverte, sans imbriquer de savepoint.
 *
 * Extrait pour la clôture d'une session (docs/17 fiche 17,
 * `packages/db/src/services/sessions.ts`) : `cloturerSession` rattache un
 * relevé à la session qu'elle clôture, DANS la même transaction que le reste
 * de la clôture — soit les deux s'écrivent, soit aucune. Même logique de
 * composition que `sortirLesGarnitures` : une fonction appelée à l'intérieur
 * d'une transaction ne rouvre jamais la sienne.
 *
 * Le seuil vient du paramètre `temperature_max_froid_c` en vigueur à la date
 * MÉTIER du relevé (jamais un nombre codé en dur), et la conformité calculée
 * ici n'est plus jamais recalculée à la lecture : un changement de seuil en
 * 2027 ne doit pas réécrire silencieusement l'historique de 2026. Un relevé
 * non conforme exige une action corrective — sans elle, le relevé est refusé.
 *
 * RÈGLE (docs/17 fiche 15) : un relevé HORS SEUIL OUVRE AUTOMATIQUEMENT une
 * non-conformité liée, dans la MÊME transaction. Décision tranchée pour
 * l'automatique plutôt que pour le proposé, et les deux arguments pesés :
 *
 *  - POUR l'automatique : « une non-conformité qu'on peut oublier d'ouvrir
 *    n'est pas un contrôle » (docs/17 fiche 15). Avant cette règle, l'écran
 *    affichait « ■ Non conforme » sur le relevé et « 0 non-conformités,
 *    situation attendue » sur l'onglet voisin — le registre se contredisait
 *    lui-même, or c'est le document qu'on présente à un contrôle AFSCA.
 *  - CONTRE l'automatique : ouvrir sans action corrective produirait une fiche
 *    vide. Cet argument NE S'APPLIQUE PAS ici : `actionCorrective` est déjà
 *    EXIGÉE ci-dessus avant d'accepter un relevé non conforme — la
 *    non-conformité créée n'est donc jamais vide, elle reprend cette même
 *    action corrective déjà saisie.
 *
 * Rien ne change pour un relevé CONFORME : aucune non-conformité n'est créée.
 */
export function ecrireReleveTemperature(
  baseTx: BaseBatte,
  entree: EntreeReleveTemperature,
): ReleveTemperatureAvecAnnulation {
  const parametres = lireParametres(baseTx, entree.dateReleve);
  const seuil = parametres.decimal('temperature_max_froid_c');
  const conforme = entree.temperatureC <= seuil;

  const actionCorrective = entree.actionCorrective?.trim() ?? '';
  if (!conforme && actionCorrective === '') {
    throw new ErreurMetier(
      'action_corrective_requise',
      `${entree.temperatureC} °C dépasse le seuil de ${seuil} °C : une action ` +
        "corrective est obligatoire avant d'enregistrer ce relevé.",
      { champs: { actionCorrective: "Indiquez l'action corrective prise." } },
    );
  }

  // Session rattachee verifiee AVANT l'insertion : sans ce controle, un
  // identifiant inconnu ne se manifestait qu'en violation de cle etrangere,
  // remontee en 500 generique. Sur un registre reglementaire, un releve refuse
  // doit dire POURQUOI.
  if (entree.sessionId !== undefined && entree.sessionId !== null) {
    const session = baseTx
      .select({ id: sessionMarche.id })
      .from(sessionMarche)
      .where(eq(sessionMarche.id, entree.sessionId))
      .get();
    if (session === undefined) throw new ErreurIntrouvable('Session', entree.sessionId);
  }

  const maintenant = maintenantUtc();

  const valeurs: ReleveTemperature = {
    id: nouvelIdentifiant(),
    sessionId: entree.sessionId ?? null,
    productionId: entree.productionId ?? null,
    equipement: entree.equipement,
    temperatureC: entree.temperatureC,
    dateReleve: entree.dateReleve,
    moment: entree.moment,
    conforme,
    actionCorrective: entree.actionCorrective ?? null,
    relevePar: entree.relevePar ?? null,
    // Instant réel d'écriture, distinct de la date métier ci-dessus.
    creeLe: maintenant,
    // Tout relevé NOUVELLEMENT saisi est `active` : seul `annulerReleveTemperature`
    // (plus bas) bascule ce statut, jamais cette fonction-ci.
    statut: 'active',
  };

  baseTx.insert(releveTemperature).values(valeurs).run();

  if (!conforme) {
    // Meme transaction que l'insertion du releve : soit les deux ecritures
    // passent, soit aucune — un releve hors seuil ne doit jamais exister
    // sans sa non-conformite, ni l'inverse.
    declarerNonConformite(baseTx, {
      dateConstat: entree.dateReleve,
      type: `Chaîne du froid — ${entree.equipement}`,
      description:
        `${entree.temperatureC} °C relevés sur « ${entree.equipement} » le ${entree.dateReleve} ` +
        `(${entree.moment}), au-delà du seuil de ${seuil} °C.`,
      gravite: 'majeure',
      actionCorrective: entree.actionCorrective ?? null,
      sessionId: entree.sessionId ?? null,
    });
  }

  // Un relevé tout juste écrit est TOUJOURS `active` : ni motif ni instant
  // d'annulation à ce stade, jamais devinés (CLAUDE.md §7). Voir
  // `avecMotifAnnulation` plus haut pour la même paire de champs, calculée
  // cette fois-ci pour un relevé qui pourrait avoir été annulé depuis.
  return { ...valeurs, motifAnnulation: null, dateAnnulation: null };
}

/**
 * Point d'entrée HTTP autonome : ouvre SA PROPRE transaction autour du même
 * cœur que `cloturerSession` réutilise (`ecrireReleveTemperature`). Voir ce
 * dernier pour la règle métier complète.
 */
export function enregistrerReleveTemperature(
  base: BaseBatte,
  entree: EntreeReleveTemperature,
): ReleveTemperatureAvecAnnulation {
  return base.transaction((tx) => ecrireReleveTemperature(tx as unknown as BaseBatte, entree));
}

/**
 * Enrichit un relevé du motif et de l'instant RÉEL de SA PROPRE annulation
 * (D-083), retrouvés dans le journal d'audit — la SEULE façon de les obtenir :
 * le motif n'est délibérément PAS une colonne de `releve_temperature` (voir
 * le commentaire de la colonne `statut` dans `packages/db/src/schema.ts`, et
 * celui de `annulerReleveTemperature` plus bas pour le raisonnement complet).
 *
 * `null` sur les deux champs pour un relevé encore `active` (l'écrasante
 * majorité des lectures), ou — cas qui ne devrait jamais survenir puisque
 * `annulerReleveTemperature` écrit systématiquement cette entrée dans la MÊME
 * transaction que le changement de statut — si le journal ne la retrouve pas :
 * CLAUDE.md §7, une valeur inconnue vaut `null`, jamais une invention.
 */
function avecMotifAnnulation(
  base: BaseBatte,
  releve: ReleveTemperature,
): ReleveTemperatureAvecAnnulation {
  if (releve.statut !== 'annulee') {
    return { ...releve, motifAnnulation: null, dateAnnulation: null };
  }

  // Le plus récent d'abord (`listerJournalAudit` trie desc) : un relevé ne
  // s'annule qu'une seule fois (`annulerReleveTemperature` refuse la double
  // annulation), donc au plus une entrée existe de toute façon.
  const [entree] = listerJournalAudit(base, {
    table: 'releve_temperature',
    enregistrementId: releve.id,
    action: 'annulation',
  });

  const motifBrut =
    entree === undefined || entree.valeurApres === null
      ? undefined
      : entree.valeurApres['motifAnnulation'];

  return {
    ...releve,
    motifAnnulation: typeof motifBrut === 'string' ? motifBrut : null,
    dateAnnulation: entree?.dateAction ?? null,
  };
}

/** Tous les relevés, du plus récent au plus ancien — ANNULÉS INCLUS (D-083) :
 * les deux relevés d'une correction restent visibles l'un et l'autre, jamais
 * seulement le bon. */
export function listerRelevesTemperature(base: BaseBatte): ReleveTemperatureAvecAnnulation[] {
  return base
    .select()
    .from(releveTemperature)
    .orderBy(desc(releveTemperature.dateReleve))
    .all()
    .map((releve) => avecMotifAnnulation(base, releve));
}

/** Relevés dont la date métier tombe dans la période, bornes incluses —
 * ANNULÉS INCLUS (D-083), voir `listerRelevesTemperature` ci-dessus. */
export function relevesTemperaturePeriode(
  base: BaseBatte,
  debutIso: string,
  finIso: string,
): ReleveTemperatureAvecAnnulation[] {
  return base
    .select()
    .from(releveTemperature)
    .where(
      and(gte(releveTemperature.dateReleve, debutIso), lte(releveTemperature.dateReleve, finIso)),
    )
    .orderBy(releveTemperature.dateReleve)
    .all()
    .map((releve) => avecMotifAnnulation(base, releve));
}

export type SessionSansReleveTemperature = {
  sessionId: string;
  numero: string;
  dateSession: string;
  lieuNom: string;
};

/**
 * Sessions CLÔTURÉES de la période, sans AUCUN relevé de température rattaché
 * (`releveTemperature.sessionId`).
 *
 * DÉFAUT CORRIGÉ (audit AFSCA du 30/07/2026, mission dédiée) : « un registre
 * qui affiche seulement ce qui existe donne une fausse impression de
 * complétude » — un registre affichant deux relevés sur un mois qui a compté
 * six marchés se lit, à tort, comme complet : rien ne signalait les quatre
 * marchés SANS AUCUN relevé. Cette fonction répond exactement à la question
 * que pose un inspecteur : « vous avez tenu un marché ce jour-là, où est le
 * relevé de chaîne du froid ? »
 *
 * Une session ANNULÉE n'est pas retenue : elle n'a jamais eu lieu commercialement,
 * il n'y a rien à y relever. Un relevé lié à la PRODUCTION (`productionId`,
 * jamais `sessionId`) ne compte pas non plus ici : ce n'est pas un relevé de
 * chaîne du froid tenu PENDANT le marché, la question posée par ce contrôle
 * porte spécifiquement sur la session.
 *
 * Un relevé ANNULÉ (`statut = 'annulee'`, D-083) ne compte PAS non plus comme
 * un relevé : c'est précisément le point qui aurait pu créer un angle mort
 * réglementaire. Sans ce filtre, une session dont l'UNIQUE relevé était mal
 * saisi puis annulé aurait continué à disparaître de cette liste — alors
 * qu'après l'annulation, elle n'a, EN RÉALITÉ, plus aucun relevé valide.
 * « Corriger » une donnée en la gardant malgré tout dans ce contrôle aurait
 * exactement défait ce que l'annulation cherche à accomplir. Le relevé annulé
 * reste bien entendu visible AILLEURS (registre imprimé, `listerRelevesTemperature`,
 * `relevesTemperaturePeriode`) — seule CETTE fonction, qui répond à « existe-t-il
 * au moins un relevé qui FAIT FOI ? », doit l'ignorer.
 *
 * TROIS LECTEURS, et ils ne disent pas la même chose au même moment :
 *   1. le registre imprimé (`documents/donnees.ts` → `registre-afsca.ts`,
 *      section « Sessions sans relevé de température ») — vu au mieux le mois
 *      suivant, au pire le jour d'un contrôle ;
 *   2. la route `GET /afsca/temperatures/sessions-sans-releve` ;
 *   3. RIEN à la clôture — c'est justement là que l'oubli coûte le moins cher
 *      à réparer (le dimanche soir, thermomètre encore sur la table). L'écran
 *      de clôture pose donc son propre rappel SANS passer par cette fonction :
 *      le client sait déjà localement combien de relevés il vient d'envoyer
 *      (`formaterAvertissementReleveTemperatureAbsent`, `Sessions.tsx`), et
 *      élargir `ResultatCloture` pour une information déjà en main aurait été
 *      du contrat en plus sans information en plus.
 *
 * L'ancienne note disait ici que `donnees.ts` « ne l'appelle pas encore ». Câblé
 * depuis le 30/07/2026 ; corrigé le 31/07/2026.
 */
export function sessionsSansReleveTemperature(
  base: BaseBatte,
  debutIso: string,
  finIso: string,
): SessionSansReleveTemperature[] {
  const sessions = base
    .select({
      id: sessionMarche.id,
      numero: sessionMarche.numero,
      dateSession: sessionMarche.dateSession,
      lieuNom: lieuMarche.nom,
    })
    .from(sessionMarche)
    .innerJoin(lieuMarche, eq(sessionMarche.lieuId, lieuMarche.id))
    .where(
      and(
        eq(sessionMarche.statut, 'cloturee'),
        gte(sessionMarche.dateSession, debutIso),
        lte(sessionMarche.dateSession, finIso),
      ),
    )
    .orderBy(sessionMarche.dateSession)
    .all();

  return sessions
    .filter((s) => {
      const releve = base
        .select({ id: releveTemperature.id })
        .from(releveTemperature)
        .where(and(eq(releveTemperature.sessionId, s.id), eq(releveTemperature.statut, 'active')))
        .limit(1)
        .get();
      return releve === undefined;
    })
    .map((s) => ({
      sessionId: s.id,
      numero: s.numero,
      dateSession: s.dateSession,
      lieuNom: s.lieuNom,
    }));
}

export type ResultatAnnulationReleveTemperature = {
  readonly releveId: string;
  readonly motif: string;
};

/**
 * Annule un relevé de température MAL SAISI (D-083, tranché par le porteur le
 * 31/07/2026) : PAR ÉCRITURE NOUVELLE, jamais par suppression ni par
 * réécriture de la valeur d'origine (CLAUDE.md §3 règle 7). Le mauvais relevé
 * RESTE en base, seul `statut` bascule à `'annulee'` — sa température, sa date
 * de relevé et son `creeLe` (date de SAISIE réelle) ne bougent JAMAIS : un
 * contrôleur doit voir la correction ET sa raison, jamais deux relevés
 * contradictoires sans savoir lequel fait foi (c'est exactement l'argument qui
 * a fait écarter l'option « interdire l'annulation »).
 *
 * MÊME PATRON QUE `annulerReception` (`services/reception.ts`) : vérifier
 * l'existence, refuser la double annulation, écrire le changement de statut,
 * journaliser dans la MÊME transaction. UNE DIFFÉRENCE ASSUMÉE sur le MOTIF :
 * `annulerReception` / `annulerProduction` prennent un `CodeMotif` du
 * catalogue (`packages/core/src/motifs.ts`) parce que ces deux annulations
 * CONTREPASSENT un mouvement de stock, et c'est CE mouvement contrepassé qui
 * porte le motif structuré, dans SA PROPRE entrée de journal
 * (`table: 'mouvement_stock'`). Un relevé de température n'a AUCUN mouvement
 * de stock à contrepasser : il n'existe donc aucune écriture sœur où loger un
 * motif structuré. Le motif est ici du TEXTE LIBRE, OBLIGATOIRE (refusé s'il
 * est vide — même garde que `annulerSession`, `services/sessions.ts`), et
 * embarqué DIRECTEMENT dans le JSON de CETTE entrée de journal
 * (`valeurApres.motifAnnulation`, une clé qui n'est PAS une colonne de
 * `releve_temperature` — voir le commentaire de la colonne `statut` dans
 * `packages/db/src/schema.ts`) : c'est très exactement ce que veut dire
 * « le motif vit dans journal_audit ». `avecMotifAnnulation` ci-dessus est
 * l'unique lecteur qui va le rechercher.
 *
 * PAS DE VERROU DE PÉRIODE COMPTABLE (`verifierPeriodeNonVerrouillee`, à la
 * différence de `annulerReception`/`annulerProduction`/`annulerSession`) :
 * cette vérification protège des ÉCRITURES COMPTABLES — stock, dépense,
 * production (voir son commentaire dans `depots/comptabilite.ts`, « à appeler
 * avant toute écriture datée »). Un relevé de température n'a AUCUN impact
 * comptable ni sur la valorisation du stock : l'annuler après la clôture d'un
 * exercice ne rouvre rien de financier.
 *
 * RÉSERVE (D-083) : la question reste posée à l'AFSCA. Si elle refuse qu'un
 * relevé annulé figure au registre IMPRIMÉ, c'est l'IMPRESSION qui changera
 * (`apps/api/src/documents/registre-afsca.ts`), jamais ce modèle — la donnée,
 * elle, doit rester.
 */
export function annulerReleveTemperature(
  base: BaseBatte,
  releveId: string,
  motif: string,
  creePar?: string | null,
): ResultatAnnulationReleveTemperature {
  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const existante = baseTx
      .select()
      .from(releveTemperature)
      .where(eq(releveTemperature.id, releveId))
      .get();
    if (existante === undefined) throw new ErreurIntrouvable('Relevé de température', releveId);

    if (existante.statut === 'annulee') {
      throw new ErreurMetier(
        'releve_deja_annule',
        `Ce relevé de température du ${existante.dateReleve} (${existante.equipement}) est déjà ` +
          'annulé.',
      );
    }

    const motifPropre = motif.trim();
    if (motifPropre === '') {
      throw new ErreurMetier(
        'motif_obligatoire',
        "L'annulation d'un relevé de température exige un motif : c'est lui qui rend la " +
          'correction auditable.',
        { champs: { motif: 'Indiquez pourquoi ce relevé est annulé.' } },
      );
    }

    const apres = baseTx
      .update(releveTemperature)
      .set({ statut: 'annulee' })
      .where(eq(releveTemperature.id, releveId))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'releve_temperature',
      enregistrementId: releveId,
      action: 'annulation',
      valeurAvant: existante,
      valeurApres: { ...apres, motifAnnulation: motifPropre },
      parQui: creePar ?? null,
    });

    return { releveId, motif: motifPropre };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Plan de nettoyage
   ═══════════════════════════════════════════════════════════════════════════ */

export type FrequenceNettoyage = 'apres_session' | 'hebdomadaire' | 'mensuelle';
export type TacheNettoyage = typeof tacheNettoyage.$inferSelect;
export type NettoyageExecution = typeof nettoyageExecution.$inferSelect;

/** Tâches actives, pour la liste déroulante d'exécution comme pour l'écran de plan. */
export function listerTachesNettoyage(base: BaseBatte): TacheNettoyage[] {
  return base
    .select()
    .from(tacheNettoyage)
    .where(eq(tacheNettoyage.actif, true))
    .orderBy(tacheNettoyage.zone, tacheNettoyage.libelle)
    .all();
}

export type EntreeExecutionNettoyage = {
  readonly tacheId: string;
  readonly sessionId?: string | null;
  readonly dateExecution: string;
  readonly executePar?: string | null;
  readonly observations?: string | null;
};

export function enregistrerExecutionNettoyage(
  base: BaseBatte,
  entree: EntreeExecutionNettoyage,
): NettoyageExecution {
  const tache = base
    .select({ id: tacheNettoyage.id })
    .from(tacheNettoyage)
    .where(eq(tacheNettoyage.id, entree.tacheId))
    .get();
  if (tache === undefined) throw new ErreurIntrouvable('Tâche de nettoyage', entree.tacheId);

  const valeurs: NettoyageExecution = {
    id: nouvelIdentifiant(),
    tacheId: entree.tacheId,
    sessionId: entree.sessionId ?? null,
    dateExecution: entree.dateExecution,
    executePar: entree.executePar ?? null,
    observations: entree.observations ?? null,
    creeLe: maintenantUtc(),
  };

  base.insert(nettoyageExecution).values(valeurs).run();
  return valeurs;
}

export type ExecutionNettoyageDetail = {
  id: string;
  tacheId: string;
  tacheLibelle: string;
  zone: string;
  dateExecution: string;
  executePar: string | null;
  observations: string | null;
  /**
   * Instant RÉEL d'écriture de cette exécution, distinct de `dateExecution`
   * (jour civil MÉTIER du nettoyage) — CLAUDE.md §7 : « le registre
   * enregistre ce qui a été saisi, avec sa date de saisie réelle. »
   *
   * DÉFAUT CORRIGÉ (audit AFSCA du 30/07/2026) : ce champ existait déjà en
   * base (`nettoyage_execution.cree_le`, voir `enregistrerExecutionNettoyage`
   * ci-dessous) mais n'était pas sélectionné ici — la seule fonction qui
   * alimente le registre imprimé (`executionsNettoyagePeriode`,
   * `apps/api/src/documents/donnees.ts`) n'avait donc AUCUN moyen de
   * distinguer une exécution saisie le jour même d'une exécution saisie des
   * semaines plus tard pour une date passée choisie librement — exactement ce
   * que CLAUDE.md §7 interdit de laisser invisible.
   */
  creeLe: string;
};

/** Exécutions dont la date métier tombe dans la période, avec le libellé de la tâche. */
export function executionsNettoyagePeriode(
  base: BaseBatte,
  debutIso: string,
  finIso: string,
): ExecutionNettoyageDetail[] {
  return base
    .select({
      id: nettoyageExecution.id,
      tacheId: nettoyageExecution.tacheId,
      tacheLibelle: tacheNettoyage.libelle,
      zone: tacheNettoyage.zone,
      dateExecution: nettoyageExecution.dateExecution,
      executePar: nettoyageExecution.executePar,
      observations: nettoyageExecution.observations,
      creeLe: nettoyageExecution.creeLe,
    })
    .from(nettoyageExecution)
    .innerJoin(tacheNettoyage, eq(nettoyageExecution.tacheId, tacheNettoyage.id))
    .where(
      and(
        gte(nettoyageExecution.dateExecution, debutIso),
        lte(nettoyageExecution.dateExecution, finIso),
      ),
    )
    .orderBy(nettoyageExecution.dateExecution)
    .all();
}

export type TacheEnRetard = {
  tacheId: string;
  libelle: string;
  zone: string;
  frequence: FrequenceNettoyage;
  derniereExecution: string | null;
  motif: string;
};

/**
 * Tâches actives en retard à `dateReference` (jour civil belge).
 *
 * `apres_session` n'a pas de délai calendaire fixe : la tâche est en retard
 * dès qu'une session a été CLÔTURÉE depuis la dernière exécution (ou depuis
 * toujours, si elle n'a jamais été faite). `hebdomadaire` et `mensuelle` sont
 * jugées sur un délai en jours, lui-même paramétrable — jamais 7 ou 30 codés
 * en dur (CLAUDE.md §7).
 */
export function tachesEnRetard(base: BaseBatte, dateReference: string): TacheEnRetard[] {
  const parametres = lireParametres(base, dateReference);
  const delaiHebdomadaire = parametres.entier('nettoyage_delai_hebdomadaire_jours');
  const delaiMensuel = parametres.entier('nettoyage_delai_mensuel_jours');

  const resultat: TacheEnRetard[] = [];

  for (const tache of listerTachesNettoyage(base)) {
    const derniere = base
      .select({ dateExecution: nettoyageExecution.dateExecution })
      .from(nettoyageExecution)
      .where(eq(nettoyageExecution.tacheId, tache.id))
      .orderBy(desc(nettoyageExecution.dateExecution))
      .limit(1)
      .get();
    const derniereExecution = derniere?.dateExecution ?? null;

    if (tache.frequence === 'apres_session') {
      const clause =
        derniereExecution === null
          ? and(eq(sessionMarche.statut, 'cloturee'), lte(sessionMarche.dateSession, dateReference))
          : and(
              eq(sessionMarche.statut, 'cloturee'),
              lte(sessionMarche.dateSession, dateReference),
              gt(sessionMarche.dateSession, derniereExecution),
            );

      const sessionOubliee = base
        .select({ id: sessionMarche.id })
        .from(sessionMarche)
        .where(clause)
        .limit(1)
        .get();

      if (sessionOubliee !== undefined) {
        resultat.push({
          tacheId: tache.id,
          libelle: tache.libelle,
          zone: tache.zone,
          frequence: tache.frequence,
          derniereExecution,
          motif: 'Une session a été clôturée depuis le dernier nettoyage.',
        });
      }
      continue;
    }

    const delai = tache.frequence === 'hebdomadaire' ? delaiHebdomadaire : delaiMensuel;
    const enRetard =
      derniereExecution === null || joursEntre(derniereExecution, dateReference) > delai;

    if (enRetard) {
      resultat.push({
        tacheId: tache.id,
        libelle: tache.libelle,
        zone: tache.zone,
        frequence: tache.frequence,
        derniereExecution,
        motif:
          derniereExecution === null
            ? 'Jamais exécutée.'
            : `Dernier passage il y a plus de ${delai} jours.`,
      });
    }
  }

  return resultat;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Non-conformités
   ═══════════════════════════════════════════════════════════════════════════ */

export type GraviteNonConformite = 'mineure' | 'majeure' | 'critique';
export type NonConformite = typeof nonConformite.$inferSelect;

export type EntreeNonConformite = {
  readonly dateConstat: string;
  readonly type: string;
  readonly description: string;
  readonly gravite: GraviteNonConformite;
  readonly actionCorrective?: string | null;
  readonly sessionId?: string | null;
  readonly lotId?: string | null;
};

export function declarerNonConformite(base: BaseBatte, entree: EntreeNonConformite): NonConformite {
  const maintenant = maintenantUtc();
  const valeurs: NonConformite = {
    id: nouvelIdentifiant(),
    dateConstat: entree.dateConstat,
    type: entree.type,
    description: entree.description,
    gravite: entree.gravite,
    actionCorrective: entree.actionCorrective ?? null,
    dateResolution: null,
    sessionId: entree.sessionId ?? null,
    lotId: entree.lotId ?? null,
    creeLe: maintenant,
    modifieLe: maintenant,
  };

  base.insert(nonConformite).values(valeurs).run();
  return valeurs;
}

export type EntreeClotureNonConformite = {
  readonly dateResolution: string;
  readonly actionCorrective: string;
};

/**
 * Clôture une non-conformité. Refuse une clôture déjà faite (« rien ne
 * s'efface » : une clôture existante ne se réécrit pas, elle se corrigerait
 * par une nouvelle non-conformité) et exige une action corrective non vide.
 */
export function cloturerNonConformite(
  base: BaseBatte,
  id: string,
  entree: EntreeClotureNonConformite,
): NonConformite {
  const existante = base.select().from(nonConformite).where(eq(nonConformite.id, id)).get();
  if (existante === undefined) throw new ErreurIntrouvable('Non-conformité', id);

  if (existante.dateResolution !== null) {
    throw new ErreurMetier(
      'non_conformite_deja_cloturee',
      `Cette non-conformité est déjà clôturée depuis le ${existante.dateResolution}.`,
    );
  }
  if (entree.actionCorrective.trim() === '') {
    throw new ErreurMetier(
      'action_corrective_requise',
      'Une non-conformité ne peut être clôturée sans action corrective.',
      { champs: { actionCorrective: "Décrivez l'action corrective prise." } },
    );
  }

  const modifieLe = maintenantUtc();
  base
    .update(nonConformite)
    .set({
      dateResolution: entree.dateResolution,
      actionCorrective: entree.actionCorrective,
      modifieLe,
    })
    .where(eq(nonConformite.id, id))
    .run();

  return {
    ...existante,
    dateResolution: entree.dateResolution,
    actionCorrective: entree.actionCorrective,
    modifieLe,
  };
}

/** Toutes les non-conformités, de la plus récente à la plus ancienne. */
export function listerNonConformites(base: BaseBatte): NonConformite[] {
  return base.select().from(nonConformite).orderBy(desc(nonConformite.dateConstat)).all();
}

/** Non-conformités constatées dans la période, bornes incluses. */
export function nonConformitesPeriode(
  base: BaseBatte,
  debutIso: string,
  finIso: string,
): NonConformite[] {
  return base
    .select()
    .from(nonConformite)
    .where(and(gte(nonConformite.dateConstat, debutIso), lte(nonConformite.dateConstat, finIso)))
    .orderBy(nonConformite.dateConstat)
    .all();
}

/* ═══════════════════════════════════════════════════════════════════════════
   Exercice de traçabilité
   ═══════════════════════════════════════════════════════════════════════════ */

export type ResultatExercice = 'concluant' | 'ecarts' | 'echec';
export type ExerciceTracabilite = typeof exerciceTracabilite.$inferSelect;

export type EntreeExerciceTracabilite = {
  readonly dateExercice: string;
  readonly lotDepartId?: string | null;
  readonly dureeMinutes?: number | null;
  readonly resultat: ResultatExercice;
  readonly ecartsConstates?: string | null;
};

/**
 * Consigne un exercice de traçabilité périodique (docs/07 §6.8 rang 11) : temps
 * mis et résultat. Un exercice non concluant sans description des écarts
 * n'apporte aucune preuve — il est refusé, au même titre qu'un relevé de
 * température non conforme sans action corrective.
 */
export function enregistrerExerciceTracabilite(
  base: BaseBatte,
  entree: EntreeExerciceTracabilite,
): ExerciceTracabilite {
  const ecarts = entree.ecartsConstates?.trim() ?? '';
  if (entree.resultat !== 'concluant' && ecarts === '') {
    throw new ErreurMetier(
      'ecarts_non_decrits',
      'Un exercice non concluant doit décrire les écarts constatés.',
      { champs: { ecartsConstates: 'Décrivez les écarts constatés.' } },
    );
  }

  const valeurs: ExerciceTracabilite = {
    id: nouvelIdentifiant(),
    dateExercice: entree.dateExercice,
    lotDepartId: entree.lotDepartId ?? null,
    dureeMinutes: entree.dureeMinutes ?? null,
    resultat: entree.resultat,
    ecartsConstates: entree.ecartsConstates ?? null,
    /**
     * `null` A VIE, et c'est CORRECT — meme situation que
     * `commande_fournisseur.document_id` (`services/commandes.ts`).
     *
     * Le lien reel se fait DANS L'AUTRE SENS : chaque exercice archive sur sa
     * periode apparait dans le registre AFSCA mensuel
     * (`sectionExercicesTracabilite`), lui-meme archive dans `document_genere`
     * (`type = 'registre_afsca'`, `objetId` = la periode « AAAA-MM »).
     * Retrouver la preuve de CET exercice, c'est donc chercher `document_genere`
     * sur `objetId = dateExercice.slice(0, 7)`.
     *
     * Et il y a une raison POSITIVE de ne pas relier par cle etrangere :
     * `document_genere` archive une NOUVELLE VERSION a chaque regeneration du
     * registre d'un mois (jamais un ecrasement). Une cle unique ne pourrait
     * pointer que vers UNE version — fausse des la regeneration suivante.
     *
     * Ce commentaire est ecrit le 30/07/2026 parce qu'il manquait, et que son
     * absence SUFFISAIT a faire de cette colonne un defaut : une colonne dont
     * personne ne sait si elle sert en est un, alors qu'une colonne dont
     * l'inutilite est justifiee n'en est pas un.
     */
    documentId: null,
    creeLe: maintenantUtc(),
  };

  base.insert(exerciceTracabilite).values(valeurs).run();
  return valeurs;
}

/** Tous les exercices, du plus récent au plus ancien — alimente le registre mensuel. */
export function listerExercicesTracabilite(base: BaseBatte): ExerciceTracabilite[] {
  return base
    .select()
    .from(exerciceTracabilite)
    .orderBy(desc(exerciceTracabilite.dateExercice))
    .all();
}
