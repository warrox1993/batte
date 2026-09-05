/**
 * Connexion SQLite. Un seul fichier, sauvegardable par simple copie (D-001).
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from './config.js';
import * as schema from './schema.js';

export type BaseBatte = ReturnType<typeof creerBase>;

/**
 * Ouvre la base et applique les reglages qui ne sont PAS des valeurs par defaut
 * chez SQLite mais qui sont indispensables ici :
 *
 *  - `foreign_keys` : desactive par defaut dans SQLite. Sans lui, la tracabilite
 *    par lot exigee par l'AFSCA peut se retrouver avec des references orphelines.
 *  - `journal_mode = WAL` : lectures concurrentes pendant une ecriture. L'API et
 *    un export Excel peuvent lire pendant qu'une cloture de session ecrit.
 *  - `busy_timeout` : plutot qu'un `SQLITE_BUSY` immediat, on attend. Sur un
 *    poste local, une attente courte vaut mieux qu'une erreur remontee a l'ecran.
 */
export function creerBase(cheminFichier: string = config.cheminBase) {
  if (cheminFichier !== ':memory:') {
    mkdirSync(dirname(cheminFichier), { recursive: true });
  }

  const sqlite = new Database(cheminFichier);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  return drizzle(sqlite, { schema });
}

/** Acces au handle brut, pour les PRAGMA, les vues SQL et les sauvegardes. */
export function sqliteBrut(base: BaseBatte): Database.Database {
  // Drizzle expose la connexion sous-jacente ; le cast est confine ici plutot
  // que reparti dans le code appelant.
  return (base as unknown as { $client: Database.Database }).$client;
}

/**
 * Ferme proprement la base, en REPLIANT d'abord le journal WAL.
 *
 * Sans ce checkpoint, les dernieres transactions restent dans le fichier
 * `batte.sqlite-wal` a cote du `.sqlite`. Or D-001 promet une base
 * « sauvegardable par simple copie » : un utilisateur qui copie le seul
 * `.sqlite` apres un arret sans checkpoint obtient une sauvegarde
 * SILENCIEUSEMENT INCOMPLETE — le pire mode de defaillance possible pour un
 * registre AFSCA, puisqu'on ne s'en apercoit qu'au moment de restaurer.
 *
 * `TRUNCATE` plutot que `PASSIVE` : il attend les lecteurs en cours et vide
 * reellement le fichier WAL, la ou `PASSIVE` abandonne en silence s'il y a
 * encore une lecture ouverte.
 */
export function fermerBase(base: BaseBatte): void {
  const sqlite = sqliteBrut(base);
  if (!sqlite.open) return;

  try {
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    // La fermeture doit avoir lieu meme si le checkpoint echoue : garder le
    // fichier ouvert serait pire que garder un WAL non replie.
    sqlite.close();
  }
}

export { schema };
