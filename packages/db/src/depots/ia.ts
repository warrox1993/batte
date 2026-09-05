/**
 * Journal des appels Claude (Lot 9).
 *
 * CLAUDE.md §5 impose « un compteur de cout par appel, stocke en base ». Ce
 * depot ecrit une ligne par appel, REUSSI OU NON : un appel qui a echoue apres
 * consommation de tokens a quand meme coute quelque chose, et un echec
 * silencieux masquerait une panne recurrente.
 */

import { maintenantUtc, nouvelIdentifiant, type UsageIa } from '@batte/core';
import { and, desc, gte, lt, sql } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { journalIa } from '../schema.js';

export type EntreeJournalIa = {
  readonly usage: UsageIa;
  readonly modele: string;
  readonly tokensEntree: number;
  readonly tokensSortie: number;
  readonly coutCents: number;
  readonly dureeMs: number;
  /** `null` quand la sortie n'alimente pas la base (commentaire pur). */
  readonly valideeParHumain: boolean | null;
  readonly erreur?: string | null;
  readonly reponseBrute?: string | null;
};

/** Enregistre un appel. Rend l'identifiant de la ligne creee. */
export function journaliserAppelIa(base: BaseBatte, entree: EntreeJournalIa): string {
  const id = nouvelIdentifiant();

  base
    .insert(journalIa)
    .values({
      id,
      dateAppel: maintenantUtc(),
      usage: entree.usage,
      modele: entree.modele,
      tokensEntree: entree.tokensEntree,
      tokensSortie: entree.tokensSortie,
      coutCents: entree.coutCents,
      // Le prompt lui-meme n'est pas conserve : il contient les chiffres de
      // l'activite, et le journal n'a pas vocation a en etre une seconde copie.
      promptHash: null,
      reponseBrute: entree.reponseBrute ?? null,
      valideeParHumain: entree.valideeParHumain,
      dureeMs: entree.dureeMs,
      erreur: entree.erreur ?? null,
    })
    .run();

  return id;
}

/** Premier jour du mois civil suivant, en ISO. Borne haute exclusive. */
function moisSuivant(annee: number, mois: number): string {
  return mois === 12
    ? `${annee + 1}-01-01T00:00:00.000Z`
    : `${annee}-${String(mois + 1).padStart(2, '0')}-01T00:00:00.000Z`;
}

/**
 * Depense Claude d'un mois civil, en centimes.
 *
 * Le plafond de CLAUDE.md §5 est mensuel : c'est donc le mois civil qui fait
 * foi, pas une fenetre glissante de 30 jours.
 */
export function depenseIaDuMois(base: BaseBatte, annee: number, mois: number): number {
  const debut = `${annee}-${String(mois).padStart(2, '0')}-01T00:00:00.000Z`;

  const ligne = base
    .select({ total: sql<number>`COALESCE(SUM(${journalIa.coutCents}), 0)` })
    .from(journalIa)
    .where(and(gte(journalIa.dateAppel, debut), lt(journalIa.dateAppel, moisSuivant(annee, mois))))
    .get();

  return ligne?.total ?? 0;
}

/** Journal complet, du plus recent au plus ancien. */
export function listerAppelsIa(base: BaseBatte, limite = 100) {
  return base
    .select({
      id: journalIa.id,
      dateAppel: journalIa.dateAppel,
      usage: journalIa.usage,
      modele: journalIa.modele,
      tokensEntree: journalIa.tokensEntree,
      tokensSortie: journalIa.tokensSortie,
      coutCents: journalIa.coutCents,
      dureeMs: journalIa.dureeMs,
      valideeParHumain: journalIa.valideeParHumain,
      erreur: journalIa.erreur,
    })
    .from(journalIa)
    .orderBy(desc(journalIa.dateAppel))
    .limit(limite)
    .all();
}
