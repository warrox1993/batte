/**
 * Journal d'audit — ecriture et lecture.
 *
 * CLAUDE.md §3 regle 7 : « Rien ne s'efface. [...] Journal d'audit sur toutes
 * les tables sensibles. » La table `journal_audit` existait depuis le Lot 0 mais
 * n'etait ecrite nulle part : modifier un seuil legal effacait donc la valeur
 * anterieure sans laisser de trace. A la question « quel seuil de franchise TVA
 * appliquiez-vous en mars ? », la base n'avait plus de reponse.
 *
 * Deux regles gouvernent ce fichier :
 *
 *  1. **Append seul.** On INSERE, jamais on ne met a jour ni ne supprime une
 *     ligne du journal. Un journal rectifiable ne prouve rien.
 *  2. **Meme transaction que la modification tracee.** `journaliser` prend le
 *     meme handle que l'appelant (la base, ou la transaction en cours passee
 *     comme `BaseBatte`, convention deja suivie par `allouerNumero`). Un journal
 *     qui survit a un echec, ou qui manque apres un succes, ment.
 */

import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { journalAudit } from '../schema.js';

/** Reprend l'enum de la colonne `action` du schema. */
export type ActionAudit = 'creation' | 'modification' | 'annulation';

/**
 * Instantane d'une ligne, fige tel quel dans le journal. On stocke la ligne
 * ENTIERE et non le seul champ modifie : sur une donnee de reference, la valeur
 * seule ne se relit pas — il faut aussi savoir de quelle cle, de quelle periode
 * de validite et de quelle source elle provenait.
 */
export type InstantaneAudit = Readonly<Record<string, unknown>>;

export type EntreeAudit = {
  /** Nom SQL de la table tracee, ex. `parametre`. */
  readonly table: string;
  readonly enregistrementId: string;
  readonly action: ActionAudit;
  /** Etat avant. `null` sur une creation. */
  readonly valeurAvant?: InstantaneAudit | null;
  /** Etat apres. `null` sur une suppression logique. */
  readonly valeurApres?: InstantaneAudit | null;
  /**
   * Qui a agi. Nullable : pas d'authentification en V1 (D-001), la colonne
   * n'est renseignee que quand l'appelant sait de qui il s'agit.
   */
  readonly parQui?: string | null;
};

/**
 * Ecrit une entree dans le journal et renvoie son identifiant.
 *
 * A appeler DANS la transaction qui modifie la donnee, en lui passant le handle
 * de transaction. Sinon la trace et la modification peuvent diverger.
 */
export function journaliser(base: BaseBatte, entree: EntreeAudit): string {
  const id = nouvelIdentifiant();

  base
    .insert(journalAudit)
    .values({
      id,
      tableCible: entree.table,
      enregistrementId: entree.enregistrementId,
      action: entree.action,
      valeursAvant: entree.valeurAvant ?? null,
      valeursApres: entree.valeurApres ?? null,
      dateAction: maintenantUtc(),
      utilisateur: entree.parQui ?? null,
    })
    .run();

  return id;
}

export type FiltreJournalAudit = {
  readonly table?: string;
  readonly enregistrementId?: string;
  /**
   * Nature du geste. Ajoute pour l'ecran de consultation : « qu'est-ce qui a
   * ete ANNULE ce trimestre ? » n'a pas la meme reponse que « qu'est-ce qui a
   * ete cree ? », et filtrer cote client sur un journal deja tronque
   * repondrait a cote.
   */
  readonly action?: ActionAudit;
  /** Borne basse incluse. Jour civil `AAAA-MM-JJ` ou instant ISO complet. */
  readonly depuis?: string;
  /** Borne haute incluse : un jour civil couvre bien la journee entiere. */
  readonly jusqua?: string;
  readonly limite?: number;
};

export type LigneJournalAudit = {
  readonly id: string;
  readonly table: string;
  readonly enregistrementId: string;
  readonly action: ActionAudit;
  readonly valeurAvant: InstantaneAudit | null;
  readonly valeurApres: InstantaneAudit | null;
  readonly dateAction: string;
  readonly parQui: string | null;
};

/**
 * Entrees du journal, de la plus recente a la plus ancienne.
 *
 * L'ordre secondaire sur `id` n'est pas cosmetique : `dateAction` est une ISO a
 * la milliseconde, et deux ecritures d'une meme transaction partagent souvent
 * le meme horodatage. L'UUID v7 etant triable chronologiquement, il departage
 * de facon stable — un journal dont l'ordre varie d'une lecture a l'autre est
 * inexploitable en controle.
 */
export function listerJournalAudit(
  base: BaseBatte,
  filtre: FiltreJournalAudit = {},
): LigneJournalAudit[] {
  const conditions = [
    filtre.table === undefined ? undefined : eq(journalAudit.tableCible, filtre.table),
    filtre.enregistrementId === undefined
      ? undefined
      : eq(journalAudit.enregistrementId, filtre.enregistrementId),
    filtre.action === undefined ? undefined : eq(journalAudit.action, filtre.action),
    filtre.depuis === undefined
      ? undefined
      : sql`${journalAudit.dateAction} >= ${borneBasse(filtre.depuis)}`,
    filtre.jusqua === undefined
      ? undefined
      : sql`${journalAudit.dateAction} <= ${borneHaute(filtre.jusqua)}`,
  ].filter((condition) => condition !== undefined);

  const requete = base
    .select()
    .from(journalAudit)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(sql`${journalAudit.dateAction} DESC`, sql`${journalAudit.id} DESC`);

  const lignes = filtre.limite === undefined ? requete.all() : requete.limit(filtre.limite).all();

  return lignes.map((ligne) => ({
    id: ligne.id,
    table: ligne.tableCible,
    enregistrementId: ligne.enregistrementId,
    action: ligne.action,
    valeurAvant: objetOuNull(ligne.valeursAvant),
    valeurApres: objetOuNull(ligne.valeursApres),
    dateAction: ligne.dateAction,
    parQui: ligne.utilisateur,
  }));
}

/**
 * Un jour civil seul (`2026-03-15`) designe la journee entiere. Compare en
 * l'etat a une ISO horodatee, il exclurait tout ce qui s'est passe ce jour-la
 * apres minuit pour la borne haute — c'est-a-dire a peu pres tout.
 */
const LONGUEUR_JOUR_CIVIL = 'AAAA-MM-JJ'.length;

function borneBasse(valeur: string): string {
  return valeur.length === LONGUEUR_JOUR_CIVIL ? `${valeur}T00:00:00.000Z` : valeur;
}

function borneHaute(valeur: string): string {
  return valeur.length === LONGUEUR_JOUR_CIVIL ? `${valeur}T23:59:59.999Z` : valeur;
}

/**
 * Les colonnes JSON reviennent en `unknown` : Drizzle ne peut rien promettre du
 * contenu d'un texte serialise. On ne garde que ce qui est reellement un objet,
 * plutot que de propager un `unknown` jusqu'a l'ecran.
 */
function objetOuNull(valeur: unknown): InstantaneAudit | null {
  if (typeof valeur !== 'object' || valeur === null) return null;
  return valeur as InstantaneAudit;
}

/**
 * Tables REELLEMENT tracees dans le journal, pour alimenter le filtre de
 * l'ecran de consultation.
 *
 * Derivee de la base et jamais codee en dur : une liste ecrite a la main
 * proposerait des tables vides et tairait celles qu'un futur appel a
 * `journaliser` ajoutera.
 *
 * Vivait comme une requete Drizzle DIRECTE dans `apps/api/src/routes/audit.ts`
 * (CLAUDE.md §3 regle 1 : aucune logique de donnees dans un handler Fastify),
 * faute de barillet modifiable au moment de son ecriture. Descendue ici.
 */
export function tablesTracees(base: BaseBatte): string[] {
  return base
    .selectDistinct({ nom: journalAudit.tableCible })
    .from(journalAudit)
    .orderBy(asc(journalAudit.tableCible))
    .all()
    .map((ligne) => ligne.nom);
}
