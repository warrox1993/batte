/**
 * Politique de sauvegarde : une par jour civil belge, purge par le nom.
 *
 * TOUS ces tests ecrivent dans un dossier temporaire cree par le test lui-meme
 * et passe explicitement via `options.dossier`. Le vrai dossier `sauvegardes/`
 * de l'utilisateur n'est ni lu, ni ecrit, ni purge ici — c'est precisement
 * pourquoi `sauvegarder` et `purger` acceptent un dossier en parametre.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { horodatageFichier, jourCivilBelge } from '@batte/core';
import { config } from './config.js';
import {
  diagnostiquerSauvegarde,
  purger,
  restaurer,
  sauvegarder,
  versionSchemaAttendue,
  lireVersionSchema,
} from './sauvegarde.js';
import { migrer } from './migrer.js';
import { creerBase, fermerBase, sqliteBrut, schema, type BaseBatte } from './client.js';
import { seed } from './seed/index.js';
import { seedDemonstration } from './seed/demonstration.js';
import { seedDemonstrationActivite } from './seed/activite.js';
import { enregistrerReleveTemperature, listerRelevesTemperature } from './services/afsca.js';
import { listerSessions } from './depots/sessions.js';
import { tousLesLots } from './depots/stock.js';

let dossier: string;
let base: BaseBatte;

/**
 * Base en memoire minimale, PORTANT une table `__drizzle_migrations` a jour :
 * la plupart des tests ci-dessous n'ont rien a voir avec la version de
 * schema, seulement avec la mecanique de copie/purge. Sans ce marqueur,
 * `restaurer` refuserait desormais TOUTE sauvegarde issue de cette fixture
 * (aucune trace de migration Batte — voir la section dediee plus bas pour les
 * tests qui, eux, testent PRECISEMENT ce garde-fou).
 */
function baseEnMemoire(): BaseBatte {
  const sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE marqueur (id INTEGER PRIMARY KEY, valeur TEXT)');
  sqlite.prepare('INSERT INTO marqueur (valeur) VALUES (?)').run('temoin');
  sqlite.exec(
    'CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)',
  );
  sqlite
    .prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
    .run('fixture-a-jour', versionSchemaAttendue());
  return drizzle(sqlite, { schema }) as unknown as BaseBatte;
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'batte-sauvegarde-'));
  base = baseEnMemoire();
});

afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

/** Nom qu'une sauvegarde prise a cet instant portera. Jamais une chaine figee. */
function nomAttendu(instant: Date): string {
  return `batte-${horodatageFichier(instant)}.sqlite`;
}

describe('sauvegarder — frequence', () => {
  it('ecrit un fichier lisible au premier appel du jour', () => {
    const instant = new Date('2026-07-28T17:01:00Z');
    const resultat = sauvegarder(base, { dossier, instant });

    expect(resultat.reutilisee).toBe(false);
    expect(existsSync(resultat.chemin)).toBe(true);
    expect(resultat.tailleOctets).toBeGreaterThan(0);
    expect(readdirSync(dossier)).toEqual([nomAttendu(instant)]);

    // La sauvegarde contient bien la donnee, pas un fichier vide.
    const relue = new Database(resultat.chemin, { readonly: true });
    expect(relue.prepare('SELECT valeur FROM marqueur').get()).toEqual({ valeur: 'temoin' });
    relue.close();
  });

  it("n'ecrit RIEN au deuxieme demarrage du meme jour", () => {
    const matin = new Date('2026-07-28T06:12:00Z');
    const premiere = sauvegarder(base, { dossier, instant: matin });

    // Le cas reel : `tsx watch` redemarre a chaque edition de fichier. Vingt
    // redemarrages dans l'apres-midi ne doivent produire aucun fichier de plus.
    for (let i = 0; i < 20; i += 1) {
      const redemarrage = sauvegarder(base, {
        dossier,
        instant: new Date(`2026-07-28T1${i % 10}:0${i % 6}:00Z`),
      });
      expect(redemarrage.reutilisee).toBe(true);
      expect(redemarrage.chemin).toBe(premiere.chemin);
    }

    expect(readdirSync(dossier)).toHaveLength(1);
  });

  it('ecrit a nouveau le lendemain', () => {
    sauvegarder(base, { dossier, instant: new Date('2026-07-28T17:01:00Z') });
    const lendemain = sauvegarder(base, { dossier, instant: new Date('2026-07-29T08:00:00Z') });

    expect(lendemain.reutilisee).toBe(false);
    expect(readdirSync(dossier)).toHaveLength(2);
  });

  it('compte les jours en BELGE : 00h30 belge est un jour neuf', () => {
    // 22h30 UTC le 28 = 00h30 belge le 29. Un decompte en jours UTC aurait
    // considere ces deux instants comme la meme journee et saute la sauvegarde.
    const soir = new Date('2026-07-28T19:00:00Z');
    const apresMinuit = new Date('2026-07-28T22:30:00Z');
    expect(jourCivilBelge(soir)).not.toBe(jourCivilBelge(apresMinuit));

    sauvegarder(base, { dossier, instant: soir });
    const seconde = sauvegarder(base, { dossier, instant: apresMinuit });

    expect(seconde.reutilisee).toBe(false);
    expect(readdirSync(dossier)).toHaveLength(2);
  });

  it('force un point de restauration a la demande, meme le jour deja couvert', () => {
    sauvegarder(base, { dossier, instant: new Date('2026-07-28T06:00:00Z') });
    const forcee = sauvegarder(base, {
      dossier,
      instant: new Date('2026-07-28T15:42:00Z'),
      forcer: true,
    });

    expect(forcee.reutilisee).toBe(false);
    expect(readdirSync(dossier)).toHaveLength(2);
  });

  it('mesure : trois jours d usage intensif tiennent en trois fichiers', () => {
    // Reproduction du rythme mesure le 28/07/2026 — 197 demarrages en trois
    // jours — avec la nouvelle politique. C'est le chiffre qui justifie D-xxx.
    let ecrits = 0;
    for (let i = 0; i < 197; i += 1) {
      const jour = 26 + Math.floor(i / 66); // 26, 27, 28 juillet
      const heure = String(6 + (i % 14)).padStart(2, '0');
      const minute = String(i % 60).padStart(2, '0');
      const resultat = sauvegarder(base, {
        dossier,
        instant: new Date(`2026-07-${jour}T${heure}:${minute}:00Z`),
      });
      if (!resultat.reutilisee) ecrits += 1;
    }

    expect(ecrits).toBe(3);
    expect(readdirSync(dossier)).toHaveLength(3);
  });
});

describe('purger', () => {
  /** Fabrique un faux fichier de sauvegarde date, sans passer par SQLite. */
  function poser(nom: string): void {
    mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, nom), 'contenu');
  }

  // `plancher: 0` sur les quatre tests qui suivent : ils isolent la purge PAR
  // AGE, sur des jeux de moins de dix fichiers. Sans desactiver le plancher
  // explicitement, le plancher par defaut (`config.retentionSauvegardesMinimum`,
  // 10) protegerait tout ce petit jeu de fichiers et masquerait la purge par
  // age qu'on veut precisement observer ici. Le plancher lui-meme a sa propre
  // section plus bas.

  it('supprime au-dela de la retention et garde en deca', () => {
    poser('batte-20260601-1200.sqlite'); // 57 jours avant
    poser('batte-20260701-1200.sqlite'); // 27 jours avant
    poser('batte-20260728-1200.sqlite'); // le jour meme

    const supprimees = purger(30, {
      dossier,
      instant: new Date('2026-07-28T12:00:00Z'),
      plancher: 0,
    });

    expect(supprimees).toEqual(['batte-20260601-1200.sqlite']);
    expect(readdirSync(dossier).sort()).toEqual([
      'batte-20260701-1200.sqlite',
      'batte-20260728-1200.sqlite',
    ]);
  });

  it('garde le fichier pile a la limite de la retention', () => {
    // Une retention de 30 jours COUVRE le trentieme jour ; le supprimer serait
    // une retention de 29.
    poser('batte-20260628-1200.sqlite');
    const supprimees = purger(30, {
      dossier,
      instant: new Date('2026-07-28T12:00:00Z'),
      plancher: 0,
    });
    expect(supprimees).toEqual([]);
  });

  it('ne touche JAMAIS un fichier dont il ne sait pas lire la date', () => {
    poser('batte-avant-migration.sqlite');
    poser('batte-20260101-0000.sqlite');

    const supprimees = purger(30, {
      dossier,
      instant: new Date('2026-07-28T12:00:00Z'),
      plancher: 0,
    });

    expect(supprimees).toEqual(['batte-20260101-0000.sqlite']);
    expect(readdirSync(dossier)).toContain('batte-avant-migration.sqlite');
  });

  it('ignore ce qui n est pas une sauvegarde', () => {
    poser('batte-20260101-0000.sqlite');
    writeFileSync(join(dossier, 'notes.txt'), 'ne pas effacer');
    writeFileSync(join(dossier, 'batte-20260101-0000.sqlite-wal'), 'ni ceci');

    purger(30, { dossier, instant: new Date('2026-07-28T12:00:00Z'), plancher: 0 });

    expect(readdirSync(dossier).sort()).toEqual(['batte-20260101-0000.sqlite-wal', 'notes.txt']);
  });

  it('rend une liste vide sur un dossier inexistant', () => {
    expect(purger(30, { dossier: join(dossier, 'absent'), instant: new Date() })).toEqual([]);
  });

  it('borne le dossier : la retention par defaut plafonne le nombre de fichiers', () => {
    // Invariant derive de la politique, pas d'un nombre grave dans le marbre :
    // au plus une sauvegarde par jour et au plus RETENTION jours conserves
    // donnent au plus RETENTION + 1 fichiers (le jour courant compris).
    // `plancher: 0` : cet invariant est celui de la purge par AGE seule, le
    // plancher a le sien juste apres.
    const retention = 30;
    for (let jour = 1; jour <= 28; jour += 1) {
      poser(`batte-202607${String(jour).padStart(2, '0')}-1200.sqlite`);
    }
    for (let jour = 1; jour <= 30; jour += 1) {
      poser(`batte-202606${String(jour).padStart(2, '0')}-1200.sqlite`);
    }

    purger(retention, { dossier, instant: new Date('2026-07-28T12:00:00Z'), plancher: 0 });

    expect(readdirSync(dossier).length).toBeLessThanOrEqual(retention + 1);
  });

  describe('plancher — protection contre une purge totale', () => {
    it('conserve au moins le plancher meme si TOUT le dossier depasse la retention', () => {
      // Le cas exact du defaut n°1 de la fiche 19 : une machine restee eteinte
      // plus longtemps que la retention (5 jours ici) fait paraitre les 8
      // sauvegardes du 10 au 17 juillet perimees au meme instant, le 28.
      // Sans plancher, purger() les aurait toutes supprimees d'un coup — plus
      // AUCUN point de restauration.
      for (let jour = 10; jour <= 17; jour += 1) {
        poser(`batte-202607${String(jour).padStart(2, '0')}-1200.sqlite`);
      }

      const supprimees = purger(5, {
        dossier,
        instant: new Date('2026-07-28T12:00:00Z'),
        plancher: 3,
      });

      expect(supprimees).toHaveLength(5);
      // Les 3 PLUS RECENTES (15, 16, 17 juillet) doivent survivre : ce sont
      // elles que le plancher protege, jamais les plus anciennes.
      expect(readdirSync(dossier).sort()).toEqual([
        'batte-20260715-1200.sqlite',
        'batte-20260716-1200.sqlite',
        'batte-20260717-1200.sqlite',
      ]);
    });

    it('ne protege pas au-dela du nombre de fichiers reellement dates', () => {
      // Un plancher de 3 sur un dossier qui ne contient que 2 sauvegardes
      // datees ne doit rien supprimer ET ne rien inventer : les deux restent.
      poser('batte-20260601-1200.sqlite');
      poser('batte-20260602-1200.sqlite');

      const supprimees = purger(1, {
        dossier,
        instant: new Date('2026-07-28T12:00:00Z'),
        plancher: 3,
      });

      expect(supprimees).toEqual([]);
      expect(readdirSync(dossier)).toHaveLength(2);
    });

    it('ne protege JAMAIS un fichier dont le nom ne porte pas de date, meme dans le plancher', () => {
      // Le plancher compte les sauvegardes DATEES, pas les fichiers presents :
      // un nom illisible reste hors de portee de la purge (comme sans
      // plancher), mais il n'occupe pas non plus une place du plancher.
      poser('batte-illisible.sqlite');
      poser('batte-20260101-1200.sqlite');

      const supprimees = purger(1, {
        dossier,
        instant: new Date('2026-07-28T12:00:00Z'),
        plancher: 1,
      });

      expect(supprimees).toEqual([]); // le seul fichier date est protege par le plancher de 1
      expect(readdirSync(dossier).sort()).toEqual([
        'batte-20260101-1200.sqlite',
        'batte-illisible.sqlite',
      ]);
    });

    it('utilise le plancher de la configuration quand aucun n est fourni explicitement', () => {
      // Pas de valeur ecrite en dur : la seule chose testee est que l'appel
      // SANS `plancher` explicite retombe sur `config.retentionSauvegardesMinimum`,
      // quelle que soit sa valeur. Dates generees par arithmetique (`Date.UTC`)
      // plutot que par un gabarit de chaine : le nombre de jours depend de la
      // configuration et pourrait deborder un mois si on l'ecrivait a la main.
      const total = config.retentionSauvegardesMinimum + 4;
      for (let i = 0; i < total; i += 1) {
        const date = new Date(Date.UTC(2026, 0, 1 + i, 12, 0, 0));
        poser(`batte-${horodatageFichier(date)}.sqlite`);
      }

      // Retention de 0 jour : sans plancher, purger() supprimerait TOUT sauf le
      // jour courant (aucun fichier ici n'est du jour courant : tout serait
      // supprime). Avec le plancher par defaut, il doit en rester exactement
      // `config.retentionSauvegardesMinimum`.
      purger(0, { dossier, instant: new Date('2026-07-28T12:00:00Z') });

      expect(readdirSync(dossier)).toHaveLength(config.retentionSauvegardesMinimum);
    });
  });
});

describe('restaurer', () => {
  it('restaure une sauvegarde vers un fichier neuf, donnees intactes', () => {
    const sauvegarde = sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    const cible = join(dossier, 'restauree.sqlite');

    const resultat = restaurer({ cheminSauvegarde: sauvegarde.chemin, cheminCible: cible });

    expect(resultat.chemin).toBe(cible);
    expect(resultat.tailleOctets).toBeGreaterThan(0);

    const relue = new Database(cible, { readonly: true });
    expect(relue.prepare('SELECT valeur FROM marqueur').get()).toEqual({ valeur: 'temoin' });
    relue.close();
  });

  it('refuse de restaurer une sauvegarde introuvable', () => {
    expect(() =>
      restaurer({
        cheminSauvegarde: join(dossier, 'absente.sqlite'),
        cheminCible: join(dossier, 'cible.sqlite'),
      }),
    ).toThrow(/introuvable/);
  });

  it("refuse d'ecraser une cible avec une archive corrompue, et NE LA TOUCHE PAS", () => {
    const corrompue = join(dossier, 'corrompue.sqlite');
    writeFileSync(corrompue, "ceci n'est pas un fichier SQLite");
    const cible = join(dossier, 'cible.sqlite');
    writeFileSync(cible, 'contenu original a preserver');

    expect(() => restaurer({ cheminSauvegarde: corrompue, cheminCible: cible })).toThrow();
    // La verification d'integrite a lieu AVANT la copie : la cible existante
    // ne doit JAMAIS etre touchee par une restauration qui echoue.
    expect(readFileSync(cible, 'utf8')).toBe('contenu original a preserver');
  });

  it('refuse de se restaurer sur elle-meme', () => {
    const sauvegarde = sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    expect(() =>
      restaurer({ cheminSauvegarde: sauvegarde.chemin, cheminCible: sauvegarde.chemin }),
    ).toThrow();
  });

  it('supprime un -wal / -shm residuel de la cible avant de restaurer', () => {
    // Une cible qui a deja vecu en mode WAL (une base ouverte a cet
    // emplacement, jamais fermee proprement) peut porter ces deux fichiers.
    // Les laisser survivrait au remplacement du `.sqlite` et ferait relire, au
    // prochain `creerBase`, un melange entre l'archive restauree et un journal
    // qui parle d'un tout autre etat.
    const sauvegarde = sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    const cible = join(dossier, 'cible.sqlite');
    writeFileSync(cible, 'ancien contenu');
    writeFileSync(`${cible}-wal`, 'journal perime');
    writeFileSync(`${cible}-shm`, 'index perime');

    restaurer({ cheminSauvegarde: sauvegarde.chemin, cheminCible: cible });

    expect(existsSync(`${cible}-wal`)).toBe(false);
    expect(existsSync(`${cible}-shm`)).toBe(false);
  });

  it('cree le dossier parent de la cible si necessaire', () => {
    const sauvegarde = sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    const cible = join(dossier, 'un', 'chemin', 'imbrique', 'restauree.sqlite');

    restaurer({ cheminSauvegarde: sauvegarde.chemin, cheminCible: cible });

    expect(existsSync(cible)).toBe(true);
  });
});

describe('diagnostiquerSauvegarde — verifiable SEUL, sans rien ecrire', () => {
  // Extrait de `restaurer` le 01/08/2026 pour que `packages/db/src/restaurer.ts`
  // (`npm run db:restaurer`) puisse avertir l'operateur AVANT de demander la
  // confirmation qui ecrase la base. `restaurer` reste couvert par les tests
  // ci-dessus (il DELEGUE a cette fonction) ; ceux qui suivent prouvent que la
  // fonction extraite est correcte APPELEE SEULE, et qu'elle n'ecrit jamais rien.
  it('valide une sauvegarde saine et rend sa version de schema', () => {
    const sauvegarde = sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });

    const diagnostic = diagnostiquerSauvegarde(sauvegarde.chemin);

    expect(diagnostic.valide).toBe(true);
    if (!diagnostic.valide) return;
    expect(diagnostic.versionSchema).toBe(versionSchemaAttendue());
  });

  it('refuse un chemin introuvable, SANS lever — un diagnostic, pas une exception', () => {
    const diagnostic = diagnostiquerSauvegarde(join(dossier, 'absente.sqlite'));

    expect(diagnostic.valide).toBe(false);
    if (diagnostic.valide) return;
    expect(diagnostic.raison).toMatch(/introuvable/);
  });

  it('refuse une archive corrompue et NE MODIFIE RIEN sur le disque', () => {
    const corrompue = join(dossier, 'corrompue.sqlite');
    writeFileSync(corrompue, "ceci n'est pas un fichier SQLite");
    const tailleAvant = statSync(corrompue).size;

    const diagnostic = diagnostiquerSauvegarde(corrompue);

    expect(diagnostic.valide).toBe(false);
    if (diagnostic.valide) return;
    expect(diagnostic.raison).toMatch(/corrompue/);
    // Une fonction de DIAGNOSTIC qui reecrirait le fichier qu'elle inspecte
    // serait le pire des deux mondes : ni un verdict fiable, ni une lecture
    // seule. Le fichier doit ressortir OCTET POUR OCTET identique.
    expect(statSync(corrompue).size).toBe(tailleAvant);
    expect(readFileSync(corrompue, 'utf8')).toBe("ceci n'est pas un fichier SQLite");
  });
});

/** Tables (hors table interne Drizzle) et leurs colonnes, pour comparer deux bases par leur FORME. */
function instantanneSchema(cheminFichier: string): Map<string, string[]> {
  const sqlite = new Database(cheminFichier, { readonly: true });
  try {
    const noms = sqlite
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'`,
      )
      .all() as { name: string }[];
    return new Map(
      noms.map(({ name }) => {
        const colonnes = sqlite.pragma(`table_info(${JSON.stringify(name)})`) as { name: string }[];
        return [name, colonnes.map((colonne) => colonne.name).sort()] as const;
      }),
    );
  } finally {
    sqlite.close();
  }
}

type JournalMigrations = {
  readonly entries: readonly {
    readonly idx: number;
    readonly tag: string;
    readonly when: number;
  }[];
  readonly [cle: string]: unknown;
};

function lireJournalMigrations(): JournalMigrations {
  return JSON.parse(
    readFileSync(join(config.dossierMigrations, 'meta', '_journal.json'), 'utf8'),
  ) as JournalMigrations;
}

/**
 * Copie du VRAI dossier de migrations, amputee des `nombreAOmettre` dernieres
 * entrees. Sert a fabriquer une base a un schema REELLEMENT anterieur — par
 * de vraies migrations partielles, pas par une simulation de la table de
 * suivi — pour prouver que `restaurer` la rattrape au schema courant.
 */
function construireDossierMigrationsPartiel(nombreAOmettre: number): string {
  const journalOriginal = lireJournalMigrations();
  const entriesPartielles = journalOriginal.entries.slice(
    0,
    journalOriginal.entries.length - nombreAOmettre,
  );

  const dossierPartiel = mkdtempSync(join(tmpdir(), 'batte-migrations-partielles-'));
  mkdirSync(join(dossierPartiel, 'meta'), { recursive: true });
  writeFileSync(
    join(dossierPartiel, 'meta', '_journal.json'),
    JSON.stringify({ ...journalOriginal, entries: entriesPartielles }),
  );
  for (const entree of entriesPartielles) {
    copyFileSync(
      join(config.dossierMigrations, `${entree.tag}.sql`),
      join(dossierPartiel, `${entree.tag}.sql`),
    );
  }
  return dossierPartiel;
}

describe('restaurer — verification de la version de schema', () => {
  it('migre EXPLICITEMENT une sauvegarde a un schema ANTERIEUR aux migrations actuelles', () => {
    const dossierScenario = mkdtempSync(join(tmpdir(), 'batte-restauration-ancien-schema-'));
    const dossierMigrationsPartiel = construireDossierMigrationsPartiel(1);
    try {
      const cheminAncienne = join(dossierScenario, 'ancienne.sqlite');
      const cheminSauvegardeAncienne = join(dossierScenario, 'sauvegarde-ancienne.sqlite');
      const cheminCible = join(dossierScenario, 'restauree.sqlite');
      const cheminReference = join(dossierScenario, 'reference-complete.sqlite');

      // Base migree avec TOUTES les migrations SAUF la derniere : un schema
      // reellement anterieur, pas une etiquette falsifiee.
      const baseAncienne = creerBase(cheminAncienne);
      migrate(baseAncienne, { migrationsFolder: dossierMigrationsPartiel });
      fermerBase(baseAncienne);

      const baseAncienneRelue = creerBase(cheminAncienne);
      sqliteBrut(baseAncienneRelue).prepare('VACUUM INTO ?').run(cheminSauvegardeAncienne);
      fermerBase(baseAncienneRelue);

      const versionAvant = lireVersionSchema(cheminSauvegardeAncienne);
      expect(versionAvant).not.toBeNull();
      expect(versionAvant).toBeLessThan(versionSchemaAttendue());

      const resultat = restaurer({
        cheminSauvegarde: cheminSauvegardeAncienne,
        cheminCible,
        instant: new Date('2026-07-28T12:00:00Z'),
      });

      expect(resultat.migrationAppliquee).toBe(true);
      expect(resultat.versionSchemaSauvegarde).toBe(versionAvant);
      expect(resultat.versionSchemaAttendue).toBe(versionSchemaAttendue());

      // La cible restauree porte desormais EXACTEMENT le meme schema qu'une
      // base fraiche entierement migree — comparaison GENERIQUE (tables et
      // colonnes), sans presumer de ce que la derniere migration ajoute.
      const baseReference = creerBase(cheminReference);
      migrer(baseReference);
      fermerBase(baseReference);

      expect(instantanneSchema(cheminCible)).toEqual(instantanneSchema(cheminReference));
      expect(lireVersionSchema(cheminCible)).toBe(versionSchemaAttendue());
    } finally {
      rmSync(dossierScenario, { recursive: true, force: true });
      rmSync(dossierMigrationsPartiel, { recursive: true, force: true });
    }
  });

  it('refuse de restaurer une sauvegarde a un schema plus RECENT que les migrations connues, et NE TOUCHE PAS la cible', () => {
    const dossierScenario = mkdtempSync(join(tmpdir(), 'batte-restauration-schema-futur-'));
    try {
      const cheminFutur = join(dossierScenario, 'futur.sqlite');
      const sqlite = new Database(cheminFutur);
      sqlite.exec(
        'CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)',
      );
      sqlite
        .prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
        .run('fixture-future', versionSchemaAttendue() + 1_000_000_000);
      sqlite.close();

      const cible = join(dossierScenario, 'cible.sqlite');
      writeFileSync(cible, 'contenu original a preserver');

      expect(() => restaurer({ cheminSauvegarde: cheminFutur, cheminCible: cible })).toThrow(
        /recent/i,
      );
      // Refusee AVANT toute ecriture : la cible garde EXACTEMENT son contenu.
      expect(readFileSync(cible, 'utf8')).toBe('contenu original a preserver');
    } finally {
      rmSync(dossierScenario, { recursive: true, force: true });
    }
  });

  it('refuse de restaurer un fichier SQLite valide mais SANS AUCUNE trace de migration Batte', () => {
    const dossierScenario = mkdtempSync(join(tmpdir(), 'batte-restauration-fichier-etranger-'));
    try {
      const cheminEtranger = join(dossierScenario, 'etranger.sqlite');
      const sqlite = new Database(cheminEtranger);
      sqlite.exec('CREATE TABLE autre_chose (id INTEGER PRIMARY KEY)');
      sqlite.close();

      const cible = join(dossierScenario, 'cible.sqlite');
      writeFileSync(cible, 'contenu original a preserver');

      expect(() => restaurer({ cheminSauvegarde: cheminEtranger, cheminCible: cible })).toThrow(
        /migration/i,
      );
      expect(readFileSync(cible, 'utf8')).toBe('contenu original a preserver');
    } finally {
      rmSync(dossierScenario, { recursive: true, force: true });
    }
  });
});

describe('restaurer — cliche de securite avant ecrasement', () => {
  it("ne cree AUCUN cliche quand la cible n'existe pas encore", () => {
    const cible = join(dossier, 'neuve.sqlite');
    const sauvegarde = sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });

    const resultat = restaurer({ cheminSauvegarde: sauvegarde.chemin, cheminCible: cible });

    expect(resultat.sauvegardeSecurite).toBeNull();
  });

  it('cree un cliche de securite RELISIBLE, portant le contenu D AVANT la restauration', () => {
    const dossierScenario = mkdtempSync(join(tmpdir(), 'batte-cliche-securite-'));
    try {
      const cheminCible = join(dossierScenario, 'cible.sqlite');
      const baseCible = baseEnMemoire();
      sqliteBrut(baseCible).prepare('VACUUM INTO ?').run(cheminCible);

      const nouvelleSource = sauvegarder(baseEnMemoire(), {
        dossier: dossierScenario,
        instant: new Date('2026-07-28T09:00:00Z'),
      });

      const resultat = restaurer({
        cheminSauvegarde: nouvelleSource.chemin,
        cheminCible,
        instant: new Date('2026-07-28T12:00:00Z'),
      });

      expect(resultat.sauvegardeSecurite).not.toBeNull();
      const chemin = resultat.sauvegardeSecurite?.chemin;
      expect(chemin).toBeDefined();
      if (chemin === undefined) return;
      expect(existsSync(chemin)).toBe(true);

      // Un VACUUM INTO reussi doit se DECLARER comme tel : c'est ce qui
      // distingue un instantane coherent d'une copie brute degradee
      // (`methode`, ajoute le 01/08/2026 apres l'audit des echecs silencieux).
      expect(resultat.sauvegardeSecurite?.methode).toBe('vacuum');
      expect(resultat.sauvegardeSecurite?.raisonRepli).toBeNull();

      // Relisible ET porteur du contenu D'AVANT la restauration — un cliche
      // pris apres l'ecrasement ne protegerait rien.
      const relu = new Database(chemin, { readonly: true });
      try {
        expect(relu.prepare('SELECT valeur FROM marqueur').get()).toEqual({ valeur: 'temoin' });
      } finally {
        relu.close();
      }
    } finally {
      rmSync(dossierScenario, { recursive: true, force: true });
    }
  });

  it(
    "declare 'copie_brute' et renseigne raisonRepli quand la cible est DEJA CASSEE au " +
      'moment du cliche — le cas ou ce cliche est le dernier filet',
    () => {
      // Precisement le scenario documente sur `ResultatSauvegardeSecurite.methode` :
      // le repli en copie brute se declenche QUAND la cible est deja corrompue
      // ou verrouillee — donc au moment ou ce cliche est le SEUL filet restant.
      // Avant le 01/08/2026, ce cas rendait exactement le meme resultat qu'un
      // VACUUM INTO reussi : ce test aurait ete IMPOSSIBLE a ecrire.
      const dossierScenario = mkdtempSync(join(tmpdir(), 'batte-cliche-securite-degrade-'));
      try {
        const cheminCibleCassee = join(dossierScenario, 'cible-cassee.sqlite');
        writeFileSync(
          cheminCibleCassee,
          "ceci n'est pas un fichier SQLite valide : contenu arbitraire, assez long pour " +
            'ne pas etre confondu avec un fichier vide ou tronque des les premiers octets.',
        );

        const sauvegarde = sauvegarder(base, {
          dossier: dossierScenario,
          instant: new Date('2026-07-28T09:00:00Z'),
        });

        const resultat = restaurer({
          cheminSauvegarde: sauvegarde.chemin,
          cheminCible: cheminCibleCassee,
          instant: new Date('2026-07-28T12:00:00Z'),
        });

        expect(resultat.sauvegardeSecurite).not.toBeNull();
        expect(resultat.sauvegardeSecurite?.methode).toBe('copie_brute');
        expect(resultat.sauvegardeSecurite?.raisonRepli).not.toBeNull();
        expect(resultat.sauvegardeSecurite?.raisonRepli).toEqual(expect.any(String));

        // Le cliche degrade porte bien le contenu BRUT d'avant — une copie
        // d'octets, pas une base SQLite relisible : c'est exactement ce que le
        // porteur doit savoir avant de s'y fier comme dernier filet.
        const chemin = resultat.sauvegardeSecurite?.chemin;
        expect(chemin).toBeDefined();
        if (chemin === undefined) return;
        expect(readFileSync(chemin, 'utf8')).toContain("ceci n'est pas un fichier SQLite valide");
      } finally {
        rmSync(dossierScenario, { recursive: true, force: true });
      }
    },
  );

  it("protege l'etat courant de la cible et le RETABLIT si la restauration echoue en cours de route", () => {
    const journalOriginal = lireJournalMigrations();
    const derniereEntree = journalOriginal.entries.at(-1);
    expect(derniereEntree).toBeDefined();
    if (derniereEntree === undefined) return; // deja garanti par l'assertion ci-dessus, pour le typage

    const dossierScenario = mkdtempSync(join(tmpdir(), 'batte-restauration-echec-'));
    try {
      // ─── La cible AVANT restauration, avec une donnee reelle a proteger ──
      const cheminCible = join(dossierScenario, 'cible.sqlite');
      const baseCible = creerBase(cheminCible);
      migrer(baseCible);
      sqliteBrut(baseCible).exec(
        'CREATE TABLE marqueur_avant (id INTEGER PRIMARY KEY, valeur TEXT)',
      );
      sqliteBrut(baseCible)
        .prepare('INSERT INTO marqueur_avant (valeur) VALUES (?)')
        .run('etat-a-proteger');
      fermerBase(baseCible);

      // ─── Une sauvegarde EMPOISONNEE : physiquement A JOUR (toutes les
      // migrations reellement appliquees), mais dont la table de suivi
      // PRETEND etre en retard de la derniere migration. `restaurer` la croit
      // ANTERIEURE — a juste titre, d'apres sa seule source d'information —
      // et tente de la migrer. Cette tentative echoue REELLEMENT : la
      // derniere migration (`ALTER TABLE reception ADD statut ...`) re-joue
      // une instruction DDL deja appliquee physiquement, et SQLite refuse
      // d'ajouter deux fois la meme colonne.
      const cheminPoison = join(dossierScenario, 'poison.sqlite');
      const basePoison = creerBase(cheminPoison);
      migrer(basePoison);
      sqliteBrut(basePoison)
        .prepare('DELETE FROM "__drizzle_migrations" WHERE created_at = ?')
        .run(derniereEntree.when);
      fermerBase(basePoison);

      const cheminSauvegardePoison = join(dossierScenario, 'sauvegarde-poison.sqlite');
      const basePoisonRelue = creerBase(cheminPoison);
      sqliteBrut(basePoisonRelue).prepare('VACUUM INTO ?').run(cheminSauvegardePoison);
      fermerBase(basePoisonRelue);

      expect(() =>
        restaurer({
          cheminSauvegarde: cheminSauvegardePoison,
          cheminCible,
          instant: new Date('2026-07-28T12:00:00Z'),
        }),
      ).toThrow();

      // La cible doit avoir retrouve EXACTEMENT son etat d'avant la tentative
      // — pas un fichier absent, pas une copie partielle de la sauvegarde
      // empoisonnee. C'est la seule preuve qui compte : pas que le fichier
      // existe, mais que les VRAIES donnees s'y relisent.
      const baseApres = creerBase(cheminCible);
      try {
        const ligne = sqliteBrut(baseApres).prepare('SELECT valeur FROM marqueur_avant').get();
        expect(ligne).toEqual({ valeur: 'etat-a-proteger' });
        const [integrite] = sqliteBrut(baseApres).pragma('integrity_check') as {
          integrity_check: string;
        }[];
        expect(integrite?.integrity_check).toBe('ok');
      } finally {
        fermerBase(baseApres);
      }
    } finally {
      rmSync(dossierScenario, { recursive: true, force: true });
    }
  });
});

/**
 * ESSAI REEL de restauration, sur le critere de fin exact de la fiche 19 :
 * « Un test restaure une sauvegarde dans une base neuve et retrouve les memes
 * sessions, lots et releves. » Tout se passe sur des fichiers dans un dossier
 * temporaire propre a CE test — a aucun moment `donnees/batte.sqlite` n'est lu
 * ni ecrit.
 *
 * Deliberement plus lourd que le reste du fichier : vrai schema, vraies
 * migrations, vrais services (`enregistrerReception`, `creerSession`,
 * `cloturerSession` via les seeds de demonstration), pour prouver que la paire
 * `sauvegarder` / `restaurer` survit a un etat aussi charge que celui d'un
 * dimanche soir reel — pas seulement a la table `marqueur` a une ligne des
 * tests ci-dessus.
 */
describe('restaurer — essai reel sur un etat ERP complet', () => {
  it('retrouve les memes sessions, lots et releves apres sauvegarde puis restauration', () => {
    const dossierScenario = mkdtempSync(join(tmpdir(), 'batte-restauration-reelle-'));
    try {
      const cheminOriginal = join(dossierScenario, 'originale.sqlite');
      const cheminRestaure = join(dossierScenario, 'restauree.sqlite');
      const dossierSauvegardesScenario = join(dossierScenario, 'sauvegardes');

      // ─── Constitution d'un etat ERP realiste ───────────────────────────
      const baseOriginale = creerBase(cheminOriginal);
      migrer(baseOriginale);
      seed(baseOriginale);
      seedDemonstration(baseOriginale);
      seedDemonstrationActivite(baseOriginale);

      const sessionRef = listerSessions(baseOriginale)[0];
      // Un releve de temperature REEL, hors seed : le critere de fin de la
      // fiche 19 nomme explicitement les « releves » a cote des sessions et
      // des lots — sans cette ligne, le test ne prouverait rien a leur sujet.
      enregistrerReleveTemperature(baseOriginale, {
        sessionId: sessionRef?.id ?? null,
        equipement: 'Glaciere rigide',
        temperatureC: 4,
        dateReleve: '2026-07-26',
        moment: 'depart',
      });

      const sessionsAvant = listerSessions(baseOriginale);
      const lotsAvant = tousLesLots(baseOriginale);
      const relevesAvant = listerRelevesTemperature(baseOriginale);

      // Le seed doit avoir vraiment produit quelque chose : sans ces trois
      // garde-fous, un seed silencieusement vide ferait passer le test sans
      // avoir rien restaure de significatif.
      expect(sessionsAvant.length).toBeGreaterThan(0);
      expect(lotsAvant.length).toBeGreaterThan(0);
      expect(relevesAvant.length).toBeGreaterThan(0);

      // Fermeture AVANT sauvegarde : replie le WAL (D-033). C'est le geste
      // attendu en production (voir `contexte.ts`) avant que `sauvegarder`
      // rouvre la base pour son `VACUUM INTO`.
      fermerBase(baseOriginale);
      const baseCoherente = creerBase(cheminOriginal);

      const sauvegarde = sauvegarder(baseCoherente, {
        dossier: dossierSauvegardesScenario,
        instant: new Date('2026-07-28T20:00:00Z'),
      });
      fermerBase(baseCoherente);

      // ─── LA restauration : sur une COPIE, jamais sur l'originale ───────
      const resultat = restaurer({
        cheminSauvegarde: sauvegarde.chemin,
        cheminCible: cheminRestaure,
      });
      expect(resultat.tailleOctets).toBeGreaterThan(0);
      expect(cheminRestaure).not.toBe(cheminOriginal);

      const baseRestauree = creerBase(cheminRestaure);
      try {
        // Integrite structurelle de la base restauree elle-meme : une copie
        // qui s'ouvre sans lever une exception ne prouve pas qu'elle est saine.
        const [integrite] = sqliteBrut(baseRestauree).pragma('integrity_check') as {
          integrity_check: string;
        }[];
        expect(integrite?.integrity_check).toBe('ok');

        expect(listerSessions(baseRestauree)).toEqual(sessionsAvant);
        expect(tousLesLots(baseRestauree)).toEqual(lotsAvant);
        expect(listerRelevesTemperature(baseRestauree)).toEqual(relevesAvant);
      } finally {
        fermerBase(baseRestauree);
      }
    } finally {
      rmSync(dossierScenario, { recursive: true, force: true });
    }
  });
});
