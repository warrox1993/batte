/**
 * Le schema declare et les migrations appliquees doivent decrire la MEME base.
 *
 * Ce fichier existe a cause d'un trou d'outillage, pas d'un defaut de code.
 * `schema.ts` est la source de verite en TypeScript ; `packages/db/drizzle/*.sql`
 * est ce qui est reellement applique au fichier SQLite. Rien ne les reliait :
 * `npm run db:generate` n'est lance qu'a la main, et la porte de sortie
 * (typecheck + lint + tests + build) ne l'appelle jamais. Ajouter une colonne a
 * `schema.ts` sans regenerer la migration donnait donc une porte de sortie
 * entierement verte, un `npm run dev` qui demarre, et une erreur SQLite
 * « no such column » au premier ecran qui lit cette colonne.
 *
 * Pour un registre AFSCA, ce mode de defaillance est le pire possible : il
 * n'apparait pas au developpement (la base de dev a ete migree quand la colonne
 * existait encore dans les deux) mais sur une base fraiche, c'est-a-dire chez
 * l'utilisateur ou apres une restauration.
 *
 * On ne compare pas des textes SQL — ils different legitimement (ordre des
 * clauses, quotes). On compare ce qui compte a l'usage : les tables et les
 * colonnes qui existent apres migration a blanc.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { creerBase, fermerBase, sqliteBrut, type BaseBatte } from './client.js';
import { migrer } from './migrer.js';
import * as schema from './schema.js';

/** Table de suivi creee par le migrateur Drizzle : elle n'est pas dans `schema.ts`. */
const TABLE_INTERNE_DRIZZLE = '__drizzle_migrations';

/**
 * Tables declarees en TypeScript, avec leurs colonnes, nommees cote SQL.
 *
 * `schema.ts` exporte aussi des `relations()`, qui ne sont pas des tables. On
 * passe par `unknown` plutot que par le type union des exports : ce dernier est
 * la reunion de 41 types de tables litteraux (`name: "parametre"`...), et un
 * predicat vers le type generique `SQLiteTable` n'y est pas assignable
 * (CLAUDE.md §4 : `unknown` + affinage, jamais `any`).
 */
const exportsDuSchema: unknown[] = Object.values(schema);

const declare = new Map<string, string[]>(
  exportsDuSchema
    .filter((valeur): valeur is SQLiteTable => is(valeur, SQLiteTable))
    .map((table) => {
      const config = getTableConfig(table);
      return [config.name, config.columns.map((colonne) => colonne.name).sort()] as const;
    }),
);

let dossier: string;
let base: BaseBatte;
/** Tables reellement presentes apres application de toutes les migrations. */
let migre: Map<string, string[]>;

beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'batte-derive-'));
  base = creerBase(join(dossier, 'base.sqlite'));
  migrer(base);

  const sqlite = sqliteBrut(base);
  const noms = sqlite
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> ?`,
    )
    .all(TABLE_INTERNE_DRIZZLE) as { name: string }[];

  migre = new Map(
    noms.map(({ name }) => {
      const colonnes = sqlite.pragma(`table_info(${JSON.stringify(name)})`) as { name: string }[];
      return [name, colonnes.map((colonne) => colonne.name).sort()] as const;
    }),
  );
});

afterAll(() => {
  fermerBase(base);
  rmSync(dossier, { recursive: true, force: true });
});

describe('schema.ts et les migrations decrivent la meme base', () => {
  it('le schema declare au moins une table (la sonde elle-meme doit etre vivante)', () => {
    // Sans cette assertion, une erreur de filtrage rendrait les tests suivants
    // vrais par vacuite : comparer deux ensembles vides passe toujours.
    expect(declare.size).toBeGreaterThan(30);
    expect(migre.size).toBeGreaterThan(30);
  });

  it('aucune table declaree ne manque dans les migrations', () => {
    // Symptome typique : une `sqliteTable` ajoutee sans `npm run db:generate`.
    const manquantes = [...declare.keys()].filter((nom) => !migre.has(nom)).sort();
    expect(manquantes).toEqual([]);
  });

  it('aucune table migree n a disparu du schema', () => {
    // Symptome inverse : une table retiree de `schema.ts` sans migration de
    // suppression. Elle survit dans toute base existante, et le jour ou on la
    // relit on ne sait plus qui la remplit.
    const orphelines = [...migre.keys()].filter((nom) => !declare.has(nom)).sort();
    expect(orphelines).toEqual([]);
  });

  it('chaque table a exactement les colonnes declarees', () => {
    const ecarts: string[] = [];

    for (const [nom, colonnesDeclarees] of declare) {
      const colonnesMigrees = migre.get(nom);
      if (colonnesMigrees === undefined) continue; // deja signale par le test ci-dessus

      for (const colonne of colonnesDeclarees) {
        if (!colonnesMigrees.includes(colonne)) {
          ecarts.push(`${nom}.${colonne} : declaree dans schema.ts, absente des migrations`);
        }
      }
      for (const colonne of colonnesMigrees) {
        if (!colonnesDeclarees.includes(colonne)) {
          ecarts.push(`${nom}.${colonne} : presente en base, absente de schema.ts`);
        }
      }
    }

    // Le message d'echec doit nommer la colonne : « lancez npm run db:generate »
    // sans dire laquelle oblige a relire 1 500 lignes de schema.
    expect(ecarts).toEqual([]);
  });
});
