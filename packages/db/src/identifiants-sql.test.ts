/**
 * Garde structurelle : aucun identifiant SQL ne doit venir d'une chaine
 * construite. C'est la seule facon dont l'injection SQL puisse entrer ici.
 *
 * ═══ Pourquoi cette garde existe (01/08/2026) ═══
 *
 * `drizzle-orm` 0.44.7 est vulnerable a une injection SQL via des identifiants
 * SQL mal echappes (GHSA-gpj5-g38j-94v9, severite HAUTE). Un audit du jour a
 * conclu que **la vulnerabilite n'est pas atteignable dans cette application**,
 * et il l'a demontre : les 50 tables prennent un nom LITTERAL, les ~95 sites
 * `orderBy` prennent tous un objet Column du schema, et `sql.raw` /
 * `sql.identifier` / `.as(` / `alias(` n'apparaissent nulle part.
 *
 * L'audit a aussi dit ce qui manquait : **cette absence est un fait constate,
 * pas un invariant maintenu**. Rien n'empeche la prochaine fiche « trier par
 * colonne au choix » de rouvrir la question EN SILENCE — et personne ne
 * relancerait un audit de securite pour ajouter un tri.
 *
 * Ce fichier transforme donc un rapport en protection durable. C'est le geste
 * que l'audit a designe comme le plus rentable de sa liste, devant la montee
 * de version elle-meme : monter en 0.45.x corrige un echappement, mais
 * n'empeche personne d'ecrire `sql.raw(colonneDemandee)` le mois prochain.
 *
 * ═══ Le candidat qui a failli etre un vrai defaut ═══
 *
 * `GET /api/audit?table=…` a exactement la forme suspecte : un nom de table
 * venu d'un parametre de requete. Il ne l'est pas — `depots/audit.ts` en fait
 * `eq(journalAudit.tableCible, filtre.table)`, ou `tableCible` est une COLONNE
 * TEXTE du journal. Le parametre filtre des LIGNES, il ne choisit pas de
 * table, et part donc en valeur liee. La distinction est fine et vaut d'etre
 * ecrite : c'est elle qui separe une route inoffensive d'une injection.
 *
 * ═══ Ce que cette garde NE couvre pas ═══
 *
 * Elle lit du texte source, pas un arbre syntaxique. Un appel ecrit sur
 * plusieurs lignes avec un argument complexe pourrait lui echapper. Elle vaut
 * pour ce qu'elle est : un signal qui se declenche au moment ou quelqu'un
 * introduit le motif dangereux, pas une preuve d'impossibilite.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_DEPOT = join(ICI, '..', '..', '..');

/** Paquets ou du SQL peut legitimement etre ecrit. */
const ZONES = [
  join(RACINE_DEPOT, 'packages', 'db', 'src'),
  join(RACINE_DEPOT, 'apps', 'api', 'src'),
];

/**
 * Les SEULS mecanismes par lesquels Drizzle emet un identifiant NON parametre.
 * Le tag `sql` lie toute interpolation de chaine comme *valeur* : il n'est donc
 * pas dans cette liste, et c'est voulu — l'y mettre noierait la garde sous des
 * centaines de faux positifs et elle finirait desactivee.
 */
const APPELS_A_IDENTIFIANT = ['sql.raw', 'sql.identifier', 'aliasedTable'];

/**
 * Plancher qui protege la garde d'elle-meme : si le parcours de fichiers
 * cassait (chemin change, dossier renomme), le balayage porterait sur zero
 * fichier et passerait VERT en ne regardant rien. Meme raisonnement que le
 * plancher de `apps/api/src/routes-enregistrement.test.ts`.
 *
 * Mesuré le 01/08/2026 : **93** fichiers `.ts` hors tests sur les deux zones.
 * Le plancher est posé nettement en dessous pour ne pas rougir au premier
 * fichier retiré — il n'est pas un compteur, seulement un anti-zéro.
 */
const NB_MINIMUM_FICHIERS_ATTENDU = 70;

function fichiersSourceDe(dossier: string): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) {
      trouves.push(...fichiersSourceDe(chemin));
    } else if (chemin.endsWith('.ts') && !chemin.endsWith('.test.ts')) {
      trouves.push(chemin);
    }
  }
  return trouves;
}

function tousLesFichiersSource(): string[] {
  return ZONES.flatMap((zone) => fichiersSourceDe(zone));
}

/**
 * Rend les appels a identifiant dont l'argument N'EST PAS un littéral.
 *
 * `sql.raw('PRAGMA foreign_keys = ON')` est inoffensif — la chaine est ecrite
 * dans le code. `sql.raw(colonneDemandee)` ne l'est pas. La garde ne refuse
 * donc pas le mecanisme, elle refuse qu'on lui passe autre chose qu'un
 * littéral. Exportee pour etre testee directement.
 */
export function appelsDangereuxDe(contenu: string): readonly string[] {
  const dangereux: string[] = [];
  for (const appel of APPELS_A_IDENTIFIANT) {
    const motif = new RegExp(`${appel.replace('.', '\\.')}\\s*\\(\\s*([^)]*)`, 'g');
    for (const trouve of contenu.matchAll(motif)) {
      const argument = (trouve[1] ?? '').trim();
      /*
       * Un gabarit AVEC interpolation n'est PAS un littéral, même s'il
       * commence par un backtick — c'est au contraire la forme exacte du
       * danger : `` sql.raw(`${tri} DESC`) ``.
       *
       * Ce cas a été trouvé par le test « le détecteur sait distinguer un
       * littéral d'une variable », quelques lignes plus bas, à la première
       * exécution. Sans lui, cette garde aurait été verte en laissant passer
       * précisément ce contre quoi elle existe.
       */
      const estLitteral =
        /^(['"])/.test(argument) || (argument.startsWith('`') && !argument.includes('${'));
      if (!estLitteral) dangereux.push(`${appel}(${argument.slice(0, 40)}`);
    }
  }
  return dangereux;
}

describe('aucun identifiant SQL ne vient d’une chaîne construite', () => {
  it('le balayage voit réellement des fichiers (il ne passe pas vert en ne regardant rien)', () => {
    expect(tousLesFichiersSource().length).toBeGreaterThanOrEqual(NB_MINIMUM_FICHIERS_ATTENDU);
  });

  it('aucun `sql.raw` / `sql.identifier` / `aliasedTable` à argument non littéral', () => {
    const fautifs: string[] = [];
    for (const fichier of tousLesFichiersSource()) {
      for (const appel of appelsDangereuxDe(readFileSync(fichier, 'utf8'))) {
        fautifs.push(`${fichier.slice(RACINE_DEPOT.length + 1)} → ${appel}`);
      }
    }
    expect(fautifs, `identifiants SQL construits :\n${fautifs.join('\n')}`).toEqual([]);
  });

  /**
   * La garde de la garde. Sans ce test, la précédente resterait verte le jour
   * où le motif cesserait de fonctionner — et personne ne le remarquerait,
   * puisqu'un balayage qui ne trouve rien ressemble exactement à un dépôt sain.
   */
  it('le détecteur sait distinguer un littéral d’une variable', () => {
    expect(appelsDangereuxDe("sql.raw('PRAGMA foreign_keys = ON')")).toEqual([]);
    expect(appelsDangereuxDe('sql.identifier(`journal_audit`)')).toEqual([]);
    expect(appelsDangereuxDe('sql.raw(colonneDemandee)')).toHaveLength(1);
    expect(appelsDangereuxDe('sql.identifier(filtre.table)')).toHaveLength(1);
    // Le cas réel qu'une future fiche « trier par colonne » produirait.
    expect(appelsDangereuxDe('orderBy(sql.raw(`${tri} DESC`))')).toHaveLength(1);
  });
});
