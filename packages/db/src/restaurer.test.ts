/**
 * `npm run db:restaurer` — voir l'en-tête de `restaurer.ts` pour le scénario
 * complet (quatre situations : sans argument, introuvable, schéma illisible,
 * réussie) et pourquoi la confirmation demande de retaper le nom du fichier.
 *
 * TOUT passe par `executerRestauration`, jamais par le point d'entrée CLI :
 * `dossierSauvegardes` et `cheminCible` sont TOUJOURS des chemins temporaires
 * créés par le test lui-même — à aucun moment `donnees/batte.sqlite` ni le
 * vrai dossier `sauvegardes/` du porteur ne sont lus, écrits ou purgés ici.
 * `demanderConfirmation`, `ecrire` et `ecrireErreur` sont toujours injectés :
 * aucun test n'ouvre un vrai terminal.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { horodatageFichier } from '@batte/core';
import { schema, type BaseBatte } from './client.js';
import { sauvegarder, versionSchemaAttendue } from './sauvegarde.js';
import {
  executerRestauration,
  formaterTailleOctets,
  listerSauvegardesDisponibles,
  resoudreCheminSauvegarde,
  texteConfirmationRestauration,
} from './restaurer.js';

let dossier: string;
let base: BaseBatte;

/** Base en mémoire minimale, PORTANT une table `__drizzle_migrations` à jour — même fixture que `sauvegarde.test.ts`. */
function baseEnMemoire(): BaseBatte {
  const sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE marqueur (id INTEGER PRIMARY KEY, valeur TEXT)');
  sqlite.prepare('INSERT INTO marqueur (valeur) VALUES (?)').run('temoin-restauration');
  sqlite.exec(
    'CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)',
  );
  sqlite
    .prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
    .run('fixture-a-jour', versionSchemaAttendue());
  return drizzle(sqlite, { schema }) as unknown as BaseBatte;
}

/** Capture toutes les lignes écrites, pour les affirmer sans dépendre de l'ordre exact des espaces. */
function capture(): { lignes: string[]; ecrire: (t: string) => void } {
  const lignes: string[] = [];
  return { lignes, ecrire: (t: string) => lignes.push(t) };
}

/** `demanderConfirmation` simulé qui rend toujours la même réponse, quelle que soit la question posée. */
function reponseFixe(reponse: string): (question: string) => Promise<string> {
  return async () => reponse;
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'batte-restaurer-cli-'));
  base = baseEnMemoire();
});

afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

describe('listerSauvegardesDisponibles', () => {
  it('rend une liste vide sur un dossier inexistant, jamais une exception', () => {
    expect(listerSauvegardesDisponibles(join(dossier, 'absent'))).toEqual([]);
  });

  it('liste les sauvegardes, la plus RÉCENTE en tête, avec nom/taille/date', () => {
    sauvegarder(base, { dossier, instant: new Date('2026-07-20T09:00:00Z') });
    sauvegarder(baseEnMemoire(), {
      dossier,
      instant: new Date('2026-07-28T18:30:00Z'),
      forcer: true,
    });

    const liste = listerSauvegardesDisponibles(dossier);

    expect(liste).toHaveLength(2);
    expect(liste[0]?.nom).toBe(
      `batte-${horodatageFichier(new Date('2026-07-28T18:30:00Z'))}.sqlite`,
    );
    expect(liste[1]?.nom).toBe(
      `batte-${horodatageFichier(new Date('2026-07-20T09:00:00Z'))}.sqlite`,
    );
    expect(liste[0]?.tailleOctets).toBeGreaterThan(0);
    expect(liste[0]?.dateAffichage).toBe('28/07/2026 20:30'); // 18h30 UTC = 20h30 belge en été
  });

  it("ignore ce qui n'est pas un fichier .sqlite", () => {
    sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    writeFileSync(join(dossier, 'notes.txt'), 'pas une sauvegarde');

    expect(listerSauvegardesDisponibles(dossier)).toHaveLength(1);
  });
});

describe('resoudreCheminSauvegarde', () => {
  it('résout un nom simple présent DANS le dossier de sauvegardes', () => {
    const resultat = sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    const nom = resultat.chemin.split(/[\\/]/).pop()!;

    expect(resoudreCheminSauvegarde(nom, dossier)).toBe(resultat.chemin);
  });

  it('résout un chemin complet HORS du dossier (clé USB, disque réseau)', () => {
    const ailleurs = mkdtempSync(join(tmpdir(), 'batte-restaurer-ailleurs-'));
    try {
      const resultat = sauvegarder(base, {
        dossier: ailleurs,
        instant: new Date('2026-07-28T12:00:00Z'),
      });
      expect(resoudreCheminSauvegarde(resultat.chemin, dossier)).toBe(resultat.chemin);
    } finally {
      rmSync(ailleurs, { recursive: true, force: true });
    }
  });

  it("rend null quand l'argument n'existe ni tel quel ni dans le dossier", () => {
    expect(resoudreCheminSauvegarde('fantome.sqlite', dossier)).toBeNull();
  });
});

describe('formaterTailleOctets', () => {
  it.each([
    [0, '0 o'],
    [512, '512 o'],
    [1024, '1 Ko'],
    [1536, '1,5 Ko'],
    [1024 * 1024, '1 Mo'],
  ])('formate %i octets en « %s »', (octets, attendu) => {
    expect(formaterTailleOctets(octets)).toBe(attendu);
  });
});

describe('texteConfirmationRestauration', () => {
  it('rend exactement le nom donné, sans transformation', () => {
    expect(texteConfirmationRestauration('batte-20260728-1200.sqlite')).toBe(
      'batte-20260728-1200.sqlite',
    );
  });
});

describe('executerRestauration — cas 1 : lancé SANS argument', () => {
  it('liste les sauvegardes disponibles plutôt que d’échouer', async () => {
    sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    const { lignes, ecrire } = capture();

    const code = await executerRestauration({ argv: [], dossierSauvegardes: dossier, ecrire });

    expect(code).toBe(0);
    expect(lignes.join('\n')).toContain('Sauvegardes disponibles');
    expect(lignes.join('\n')).toContain(
      `batte-${horodatageFichier(new Date('2026-07-28T12:00:00Z'))}.sqlite`,
    );
    expect(lignes.join('\n')).toContain('npm run db:restaurer --');
  });

  it("un dossier VIDE affiche un message qui dit quoi faire, pas seulement l'absence", async () => {
    const { lignes, ecrire } = capture();

    const code = await executerRestauration({ argv: [], dossierSauvegardes: dossier, ecrire });

    expect(code).toBe(0);
    const texte = lignes.join('\n');
    expect(texte).toContain('Aucune sauvegarde trouvée');
    expect(texte).toContain('chemin complet');
  });
});

describe('executerRestauration — cas 2 : sauvegarde INTROUVABLE', () => {
  it('signale le nom recherché ET réaffiche la liste réelle, sans jamais demander confirmation', async () => {
    sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    const { lignes: erreurs, ecrire: ecrireErreur } = capture();
    let confirmationDemandee = false;

    const code = await executerRestauration({
      argv: ['ce-fichier-nexiste-pas.sqlite'],
      dossierSauvegardes: dossier,
      ecrireErreur,
      demanderConfirmation: async () => {
        confirmationDemandee = true;
        return '';
      },
    });

    expect(code).toBe(1);
    expect(confirmationDemandee).toBe(false);
    const texte = erreurs.join('\n');
    expect(texte).toContain('introuvable');
    expect(texte).toContain('ce-fichier-nexiste-pas.sqlite');
    // La liste RÉELLE est réaffichée pour corriger sans deviner.
    expect(texte).toContain(`batte-${horodatageFichier(new Date('2026-07-28T12:00:00Z'))}.sqlite`);
  });
});

describe('executerRestauration — cas 3 : schéma illisible ou archive corrompue', () => {
  it('refuse une archive corrompue AVANT de demander confirmation, message actionnable', async () => {
    const corrompu = join(dossier, 'corrompu.sqlite');
    writeFileSync(corrompu, "ceci n'est pas un fichier SQLite valide");
    const { lignes: erreurs, ecrire: ecrireErreur } = capture();
    let confirmationDemandee = false;

    const code = await executerRestauration({
      argv: ['corrompu.sqlite'],
      dossierSauvegardes: dossier,
      cheminCible: join(dossier, 'cible-jamais-touchee.sqlite'),
      ecrireErreur,
      demanderConfirmation: async () => {
        confirmationDemandee = true;
        return '';
      },
    });

    expect(code).toBe(1);
    // LE POINT CENTRAL de ce test : la validité est vérifiée AVANT de faire
    // retaper un nom de fichier à un opérateur sous stress pour une
    // restauration qui échouerait de toute façon.
    expect(confirmationDemandee).toBe(false);
    expect(erreurs.join('\n')).toContain('corrompue');
    expect(existsSync(join(dossier, 'cible-jamais-touchee.sqlite'))).toBe(false);
  });

  it('refuse une sauvegarde SANS trace de migration Batte, message actionnable', async () => {
    const etranger = join(dossier, 'etranger.sqlite');
    const sqlite = new Database(etranger);
    sqlite.exec('CREATE TABLE autre_chose (id INTEGER PRIMARY KEY)');
    sqlite.close();
    const { lignes: erreurs, ecrire: ecrireErreur } = capture();

    const code = await executerRestauration({
      argv: ['etranger.sqlite'],
      dossierSauvegardes: dossier,
      cheminCible: join(dossier, 'cible-jamais-touchee.sqlite'),
      ecrireErreur,
      demanderConfirmation: async () => '',
    });

    expect(code).toBe(1);
    expect(erreurs.join('\n')).toMatch(/migration/i);
  });
});

describe('executerRestauration — cas 4 : restauration RÉUSSIE', () => {
  it('affiche l’état de la cible, demande le nom exact, puis restaure', async () => {
    const sauvegarde = sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    const nom = sauvegarde.chemin.split(/[\\/]/).pop()!;
    const cible = join(dossier, 'cible-neuve.sqlite');
    const { lignes, ecrire } = capture();
    const questionsPosees: string[] = [];

    const code = await executerRestauration({
      argv: [nom],
      dossierSauvegardes: dossier,
      cheminCible: cible,
      ecrire,
      demanderConfirmation: async (question) => {
        questionsPosees.push(question);
        return nom;
      },
    });

    expect(code).toBe(0);
    // La confirmation demande explicitement le NOM DU FICHIER, jamais un
    // simple y/N — le point central de la contrainte n°2 de cette mission.
    expect(questionsPosees).toHaveLength(1);
    expect(questionsPosees[0]).toContain(nom);
    expect(lignes.join('\n')).toContain('rien à écraser'); // cible neuve
    expect(lignes.join('\n')).toContain('Restauration réussie');

    // MUTATION : la cible porte réellement la donnée de la sauvegarde.
    const relue = new Database(cible, { readonly: true });
    try {
      expect(relue.prepare('SELECT valeur FROM marqueur').get()).toEqual({
        valeur: 'temoin-restauration',
      });
    } finally {
      relue.close();
    }
  });

  it('annule SANS rien modifier quand la confirmation ne correspond pas', async () => {
    const sauvegarde = sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    const nom = sauvegarde.chemin.split(/[\\/]/).pop()!;
    const cible = join(dossier, 'cible-annulee.sqlite');
    const { lignes, ecrire } = capture();

    const code = await executerRestauration({
      argv: [nom],
      dossierSauvegardes: dossier,
      cheminCible: cible,
      ecrire,
      demanderConfirmation: async () => 'oui', // pas le nom exact
    });

    expect(code).toBe(0);
    expect(lignes.join('\n')).toContain('annulée');
    // RIEN n'a été créé : c'est la preuve, pas seulement le message.
    expect(existsSync(cible)).toBe(false);
  });

  it('accepte la confirmation avec des espaces superflus, mais refuse une casse différente', async () => {
    const sauvegarde = sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    const nom = sauvegarde.chemin.split(/[\\/]/).pop()!;

    const codeAvecEspaces = await executerRestauration({
      argv: [nom],
      dossierSauvegardes: dossier,
      cheminCible: join(dossier, 'cible-espaces.sqlite'),
      demanderConfirmation: reponseFixe(`  ${nom}  `),
    });
    expect(codeAvecEspaces).toBe(0);
    expect(existsSync(join(dossier, 'cible-espaces.sqlite'))).toBe(true);

    const codeCasseDifferente = await executerRestauration({
      argv: [nom],
      dossierSauvegardes: dossier,
      cheminCible: join(dossier, 'cible-casse.sqlite'),
      demanderConfirmation: reponseFixe(nom.toUpperCase()),
    });
    expect(codeCasseDifferente).toBe(0); // annulation, pas une erreur
    expect(existsSync(join(dossier, 'cible-casse.sqlite'))).toBe(false);
  });

  it('signale le remplacement ET la taille/date de la base actuelle quand elle existe déjà', async () => {
    const sauvegarde = sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    const nom = sauvegarde.chemin.split(/[\\/]/).pop()!;
    const cible = join(dossier, 'cible-existante.sqlite');
    writeFileSync(cible, 'ancien contenu à remplacer');
    const { lignes, ecrire } = capture();

    const code = await executerRestauration({
      argv: [nom],
      dossierSauvegardes: dossier,
      cheminCible: cible,
      ecrire,
      demanderConfirmation: reponseFixe(nom),
    });

    expect(code).toBe(0);
    expect(lignes.join('\n')).toContain('sera ÉCRASÉE');
    // Un cliché de sécurité a bien été pris de l'ancien contenu.
    expect(lignes.join('\n')).toContain('Cliché de sécurité');
  });

  it('avertit EXPLICITEMENT quand le cliché de sécurité est une copie brute dégradée', async () => {
    const sauvegarde = sauvegarder(base, { dossier, instant: new Date('2026-07-28T12:00:00Z') });
    const nom = sauvegarde.chemin.split(/[\\/]/).pop()!;
    const cible = join(dossier, 'cible-cassee.sqlite');
    writeFileSync(
      cible,
      "ceci n'est pas un fichier SQLite valide : contenu arbitraire assez long pour ne pas " +
        'être confondu avec un fichier vide ou tronqué.',
    );
    const { lignes: erreurs, ecrire: ecrireErreur } = capture();

    const code = await executerRestauration({
      argv: [nom],
      dossierSauvegardes: dossier,
      cheminCible: cible,
      ecrireErreur,
      demanderConfirmation: reponseFixe(nom),
    });

    expect(code).toBe(0);
    const texte = erreurs.join('\n');
    expect(texte).toContain('ATTENTION');
    expect(texte).toContain('COPIE BRUTE');
    expect(texte).not.toContain('undefined');
  });

  it('signale la migration explicite quand la sauvegarde porte un schéma antérieur', async () => {
    // Reprend le scénario de `sauvegarde.test.ts` (migration explicite d'un
    // schéma antérieur), mais vérifié ici via l'entrée en ligne de commande :
    // c'est CE texte que l'opérateur lira réellement.
    const dossierScenario = mkdtempSync(join(tmpdir(), 'batte-restaurer-ancien-schema-'));
    try {
      // Fabrique une sauvegarde qui a REELLEMENT toutes les migrations sauf la
      // marque explicite (ici on triche volontairement en amputant la table
      // de suivi d'une entrée récente sans rejouer une migration DDL réelle,
      // ce qui suffit à exercer le CHEMIN et le TEXTE de ce script — le détail
      // du rattrapage lui-même est déjà prouvé par `sauvegarde.test.ts`).
      const cheminAncien = join(dossierScenario, 'ancien.sqlite');
      const sqlite = new Database(cheminAncien);
      sqlite.exec(
        'CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)',
      );
      sqlite
        .prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
        .run('fixture-ancienne', 1);
      sqlite.close();

      const { lignes, ecrire } = capture();
      const code = await executerRestauration({
        argv: [cheminAncien],
        dossierSauvegardes: dossierScenario,
        cheminCible: join(dossierScenario, 'cible.sqlite'),
        ecrire,
        demanderConfirmation: reponseFixe('ancien.sqlite'),
      });

      expect(code).toBe(0);
      expect(lignes.join('\n')).toContain('schéma antérieur');
      expect(lignes.join('\n')).toContain('migrée');
    } finally {
      rmSync(dossierScenario, { recursive: true, force: true });
    }
  });
});
