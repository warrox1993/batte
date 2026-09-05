/**
 * Tests du cycle de vie de la base : ouverture, reglages, fermeture propre.
 *
 * Ce fichier existe a cause d'un defaut reel trouve en audit : la base n'etait
 * JAMAIS fermee. En mode WAL, les dernieres ecritures restent alors dans le
 * fichier `-wal` a cote du `.sqlite`. Or D-001 promet une base « sauvegardable
 * par simple copie » — un utilisateur qui copie le seul `.sqlite` obtenait donc
 * une sauvegarde silencieusement incomplete, defaut qu'on ne decouvre qu'au
 * moment de restaurer, c'est-a-dire trop tard.
 */

import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerBase, fermerBase, sqliteBrut } from './client.js';
import { migrer } from './migrer.js';
import { seed } from './seed/index.js';
import { parametre } from './schema.js';

let dossier: string;
let chemin: string;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'batte-client-'));
  chemin = join(dossier, 'base.sqlite');
});

afterEach(() => {
  // `force` : si un test a laisse un handle ouvert, on ne veut pas que le
  // nettoyage masque l'echec du test lui-meme par une erreur EPERM.
  rmSync(dossier, { recursive: true, force: true });
});

describe('creerBase — réglages indispensables', () => {
  it('active les clés étrangères, désactivées par défaut dans SQLite', () => {
    // Sans elles, la tracabilite par lot exigee par l'AFSCA peut se retrouver
    // avec des references orphelines.
    const base = creerBase(chemin);
    const [ligne] = sqliteBrut(base).pragma('foreign_keys') as { foreign_keys: number }[];
    expect(ligne?.foreign_keys).toBe(1);
    fermerBase(base);
  });

  it('ouvre en mode WAL', () => {
    const base = creerBase(chemin);
    const [ligne] = sqliteBrut(base).pragma('journal_mode') as { journal_mode: string }[];
    expect(ligne?.journal_mode).toBe('wal');
    fermerBase(base);
  });

  it('crée le dossier parent si nécessaire', () => {
    const imbrique = join(dossier, 'a', 'b', 'base.sqlite');
    const base = creerBase(imbrique);
    expect(existsSync(imbrique)).toBe(true);
    fermerBase(base);
  });
});

describe('fermerBase — la sauvegarde par simple copie doit être complète', () => {
  it('replie le journal WAL : aucun fichier -wal résiduel', () => {
    const base = creerBase(chemin);
    migrer(base);
    seed(base);

    // Avant fermeture, le WAL contient les ecritures qui viennent d'avoir lieu.
    expect(existsSync(`${chemin}-wal`)).toBe(true);

    fermerBase(base);

    // Apres fermeture, tout est dans le fichier principal. C'EST la garantie
    // qui rend D-001 vraie : copier le `.sqlite` suffit.
    const walResiduel = existsSync(`${chemin}-wal`) ? statSync(`${chemin}-wal`).size : 0;
    expect(walResiduel).toBe(0);
  });

  it('une copie du seul .sqlite après fermeture contient TOUTES les données', () => {
    const base = creerBase(chemin);
    migrer(base);
    const resultat = seed(base);
    const attendus = base.select().from(parametre).all().length;
    expect(attendus).toBe(resultat.parametres.inseres.length);
    fermerBase(base);

    // On rouvre le fichier principal seul, comme le ferait une restauration
    // depuis une copie manuelle.
    const copie = join(dossier, 'copie.sqlite');
    copyFileSync(chemin, copie);

    const restauree = creerBase(copie);
    expect(restauree.select().from(parametre).all().length).toBe(attendus);
    fermerBase(restauree);
  });

  it('est idempotent : fermer deux fois ne lève pas', () => {
    const base = creerBase(chemin);
    fermerBase(base);
    expect(() => fermerBase(base)).not.toThrow();
  });

  it('libère le fichier : il redevient supprimable', () => {
    // Sur Windows, un handle SQLite ouvert empeche toute suppression ou
    // deplacement du fichier — donc toute rotation de sauvegarde.
    const base = creerBase(chemin);
    migrer(base);
    fermerBase(base);

    expect(() => rmSync(chemin)).not.toThrow();
    expect(existsSync(chemin)).toBe(false);
  });
});

describe('intégrité structurelle après migration à blanc', () => {
  it('applique toutes les migrations sur une base vierge sans violation', () => {
    const base = creerBase(chemin);
    migrer(base);
    const sqlite = sqliteBrut(base);

    const [integrite] = sqlite.pragma('integrity_check') as { integrity_check: string }[];
    expect(integrite?.integrity_check).toBe('ok');

    // Une cle etrangere orpheline ferait perdre la tracabilite d'un lot.
    expect(sqlite.pragma('foreign_key_check')).toHaveLength(0);

    fermerBase(base);
  });

  it('le seed est intégralement idempotent sur une base vierge', () => {
    const base = creerBase(chemin);
    migrer(base);

    const premier = seed(base);
    expect(premier.parametres.inseres.length).toBeGreaterThan(0);

    const second = seed(base);
    // Relancer le seed sur une base utilisee ne doit jamais rien recreer.
    expect(second.parametres.inseres).toHaveLength(0);
    expect(second.motifs.inseres).toHaveLength(0);
    expect(second.afsca.inseres).toHaveLength(0);
    expect(second.echeancesInserees).toBe(0);
    expect(second.utilisateursInseres).toBe(0);

    fermerBase(base);
  });
});
