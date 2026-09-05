/**
 * La garantie de non-suppression de l'historique
 * (docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md §1,
 * CLAUDE.md §3 règle 7 : « Rien ne s'efface »).
 *
 * ## Pourquoi une rétention illimitée est LÉGALE ici, et pourquoi elle cesse
 * de l'être si une donnée personnelle entre un jour dans ces tables
 *
 * CLAUDE.md §3 règle 9 impose « zéro donnée personnelle client en V1 » : les
 * quatre tables d'origine de ce garde-fou (`session_vente`, `session_marche`,
 * `production`, `mouvement_stock`) n'enregistrent que des TRANSACTIONS et des
 * PANIERS anonymes — un montant, une quantité, une date, un numéro de lot.
 * Aucun nom, aucun e-mail, aucun identifiant qui rattache une ligne à une
 * personne physique identifiée ou identifiable.
 *
 * Le RGPD (règlement (UE) 2016/679) encadre la conservation d'une DONNÉE À
 * CARACTÈRE PERSONNEL (art. 4, 5.1.e — limitation de la conservation). Une
 * donnée totalement anonyme, qui ne permet pas de remonter à une personne
 * (même par recoupement), sort du champ d'application du règlement (art. 26
 * du considérant) : aucune durée de conservation n'est imposée, une rétention
 * illimitée n'est donc PAS une infraction. C'est exactement ce que demande
 * `docs/demandes/07` (« aucune limite de durée codée en dur ») et exactement
 * ce que documente `[[questions-ouvertes-pour-le-comptable]]` : on compte des
 * transactions, jamais des personnes.
 *
 * LA CONDITION QUI FAIT BASCULER CE RAISONNEMENT : si une donnée personnelle
 * entrait un jour dans l'une de ces quatre tables (un nom de client fidèle,
 * un e-mail de contact, un numéro de téléphone attaché à une commande
 * nominative...), la rétention illimitée deviendrait ILLÉGALE au sens du
 * RGPD — il faudrait alors une base légale de conservation et une politique
 * de durée, exactement ce que CLAUDE.md §3 règle 9 interdit tant qu'elle n'a
 * pas été écrite. CE TEST NE PEUT PAS VÉRIFIER CETTE CONDITION (il vérifie
 * l'ABSENCE de suppression, pas l'absence de donnée personnelle — c'est le
 * rôle d'un autre garde-fou, sur le schéma). Il porte ici le RAISONNEMENT,
 * pour qu'un futur relecteur qui verrait « jamais de DELETE » ne le prenne
 * PAS pour une négligence RGPD : c'est une garantie légale précisément parce
 * que ces tables restent anonymes.
 *
 * ## Extension aux tables du registre AFSCA (audit du 29/07/2026)
 *
 * Sept tables du registre AFSCA (`lot`, `non_conformite`,
 * `releve_temperature`, `nettoyage_execution`, `exercice_tracabilite`,
 * `journal_audit`, `document_genere`) sont entrées dans le périmètre à cette
 * date. LEUR base légale n'est PAS celle décrite ci-dessus — ce ne sont pas
 * des tables anonymes par nature, certaines portent potentiellement des noms
 * de personnes (`relevePar`, `executePar`, `parQui`). Leur non-suppression
 * est exigée par CLAUDE.md §3 règles 6 et 7 (traçabilité par lot obligatoire,
 * corrections par contrepassation jamais par `DELETE`) : ce sont exactement
 * les tables qu'un contrôle AFSCA vient consulter, et un `DELETE` y serait un
 * trou de traçabilité invisible par construction.
 *
 * ## Extension à TOUTES les tables du schéma (audit du 31/07/2026,
 * `docs/26-AUDIT-DIX-REGLES.md` §2 règle 7)
 *
 * DÉFAUT CORRIGÉ : jusqu'ici, `TABLES_PROTEGEES` était une liste ÉCRITE À LA
 * MAIN de onze tables — quatre RGPD, sept AFSCA. Trente-huit tables du
 * schéma n'y figuraient pas, dont les plus sensibles au sens de CLAUDE.md §1
 * et §7 : `depense`, `facture_fournisseur`, `immobilisation`, `echeance`,
 * `periode`. C'est très exactement le défaut que documente D-045 : « une
 * liste écrite à la main n'est pas une preuve d'absence ». Un futur
 * `.delete(depense)` n'aurait fait échouer AUCUN test existant.
 *
 * CORRECTION : `TABLES_PROTEGEES` n'énumère plus rien. Elle se DÉRIVE de
 * `schema.ts` — la source de vérité — par `tablesDuSchema()` ci-dessous, qui
 * fait un vrai balayage texte de chaque `export const … = sqliteTable('…', …)`.
 * Une table ajoutée demain au schéma entre AUTOMATIQUEMENT dans le périmètre
 * protégé, sans qu'aucun humain n'ait à y penser — c'est ça, le vrai
 * livrable : plus jamais de table oubliée, pas « onze tables de plus ».
 *
 * La seule table qu'on retire délibérément de ce périmètre dérivé est
 * `recette_ligne` (voir `EXCEPTIONS_SUPPRESSION` plus bas), et c'est un GESTE
 * VISIBLE : chaque exception porte un motif écrit ICI MÊME (jamais un renvoi
 * vers un commentaire ailleurs), et un test dédié fige la liste des
 * exceptions acceptées — l'ajout silencieux d'une exception fait échouer ce
 * test, nommément.
 *
 * ## Ce que le test vérifie
 *
 * Une garantie de non-suppression écrite en commentaire n'est vérifiable par
 * personne. Décision D-045 : « une liste écrite à la main n'est pas une
 * preuve d'absence » — le balayage anti-fuite de secrets avait justement été
 * pris en défaut par une énumération manuelle de routes. Ce test fait donc un
 * VRAI balayage du code source (comme `apps/api/src/securite-secrets.test.ts`)
 * plutôt que d'énumérer les endroits où l'on croit qu'aucun `DELETE` n'existe
 * — et désormais la LISTE DES TABLES elle-même est dérivée plutôt qu'énumérée.
 *
 * Deux formes de suppression sont détectées :
 *  - Drizzle : `db.delete(sessionVente)…` — l'identifiant JS de la table.
 *  - SQL brut : `DELETE FROM session_vente` / `"session_vente"` — insensible
 *    à la casse, avec ou sans guillemets.
 *
 * Le détecteur est lui-même testé par FALSIFICATION (ci-dessous) : on lui
 * injecte un extrait qui supprime réellement une table protégée et on
 * vérifie qu'il le détecte, ET on lui injecte des cas qui RESSEMBLENT à une
 * suppression sans en être une (un `Map.delete`, une suppression sur une
 * table exceptée) pour vérifier qu'il ne crie pas au loup à tort. Sans cette
 * double preuve, un test qui ne s'est jamais vu échouer ne prouve rien
 * (« [[perimetre-des-verifications]] »).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Racine du dépôt, déduite du chemin de ce fichier : packages/db/src -> ../../.. */
const RACINE = resolve(import.meta.dirname, '..', '..', '..');

const CHEMIN_SCHEMA = join(RACINE, 'packages', 'db', 'src', 'schema.ts');
const CONTENU_SCHEMA = readFileSync(CHEMIN_SCHEMA, 'utf-8');

/**
 * Une déclaration de table trouvée dans `schema.ts`, sous ses DEUX noms :
 * l'identifiant Drizzle (JS, `camelCase`) et le nom SQL réel (`snake_case`,
 * CLAUDE.md §4). Une suppression peut passer par l'un ou par l'autre.
 */
type TableDeclaree = { readonly identifiantJs: string; readonly nomSql: string };

/**
 * Motif qui reconnaît une déclaration de table Drizzle dans `schema.ts` :
 * `export const <identifiant> = sqliteTable(<espaces éventuels>'<nom_sql>'`.
 *
 * Couvre les DEUX formes réellement utilisées dans le fichier aujourd'hui —
 * `sqliteTable('nom', { ... })` sur une seule ligne (ex. `utilisateur`,
 * `immobilisation`, `objectif`) et `sqliteTable(\n  'nom',\n  { ... },\n)`
 * éclatée sur plusieurs lignes (la majorité) — parce que `\s` matche aussi
 * les retours à la ligne, sans qu'il soit nécessaire de les distinguer.
 */
const MOTIF_DECLARATION_TABLE = /export const (\w+) = sqliteTable\(\s*'([a-z_]+)'/g;

/**
 * Dérive la liste de TOUTES les tables déclarées dans le contenu de
 * `schema.ts` passé en argument. Fonction PURE (aucune lecture disque) pour
 * rester falsifiable par de simples chaînes, indépendamment du vrai dépôt —
 * voir les tests de dérivation plus bas.
 *
 * C'est LA fonction qui remplace l'ancienne liste `TABLES_PROTEGEES` écrite à
 * la main : ce qui n'est pas trouvé ici n'entre pas dans le périmètre protégé.
 * Une régression de cette fonction (un motif qui cesse de matcher une forme
 * d'écriture de `schema.ts`) se verrait dans le nombre de tables trouvées,
 * vérifié ci-dessous contre un comptage indépendant.
 */
export function tablesDuSchema(contenuSchema: string): readonly TableDeclaree[] {
  return [...contenuSchema.matchAll(MOTIF_DECLARATION_TABLE)].map((correspondance) => ({
    identifiantJs: correspondance[1]!,
    nomSql: correspondance[2]!,
  }));
}

/** Toutes les tables du schéma, dérivées — jamais énumérées. */
const TOUTES_LES_TABLES = tablesDuSchema(CONTENU_SCHEMA);

type ExceptionSuppression = TableDeclaree & { readonly motif: string };

/**
 * Les tables qu'on retire DÉLIBÉRÉMENT du périmètre protégé, chacune avec son
 * motif écrit ICI — jamais un renvoi vers un commentaire ailleurs dans le
 * dépôt, pour qu'un relecteur n'ait jamais à aller chercher la justification
 * d'une exception à la sécurité qu'il est en train de lire.
 *
 * GESTE VISIBLE, PAS OUBLI SILENCIEUX : ajouter une entrée ici sans motif ne
 * compile pas (`motif` est un champ requis du type `ExceptionSuppression`),
 * et le test « la liste des exceptions ne contient QUE celles revues... »
 * plus bas fige la liste attendue — un ajout non accompagné de la mise à
 * jour de CE test échoue, nommément. Il n'existe aucun autre mécanisme dans
 * ce fichier pour retirer une table du périmètre : c'est la SEULE porte.
 *
 * NE PAS AJOUTER PAR COMMODITÉ. La question à se poser avant d'ajouter une
 * ligne ici n'est jamais « comment faire passer le test ? » mais « pourquoi
 * supprime-t-on des lignes sur CETTE table ? ». Une exception non justifiée
 * est pire que l'absence de garde : elle a l'air d'une décision.
 */
const EXCEPTIONS_SUPPRESSION: readonly ExceptionSuppression[] = [
  {
    identifiantJs: 'recetteLigne',
    nomSql: 'recette_ligne',
    motif:
      'Le SEUL DELETE de production trouvé dans tout le dépôt (vérifié par balayage réel, ' +
      'voir le test « aucun DELETE... » plus bas) : packages/db/src/depots/referentiel-ecriture.ts, ' +
      'dans la fonction qui modifie une recette existante. Il supprime les lignes de composition ' +
      "d'UNE recette avant de les réécrire — MAIS seulement quand nbProductions(baseTx, id) === 0, " +
      "un contrôle qui lève l'erreur métier 'recette_scellee' dès qu'au moins une production a " +
      "consommé cette version. Une composition jamais servie est un BROUILLON en cours d'édition, " +
      'pas une pièce engagée : la règle 7 protège ce qui a été engagé (mouvements, sessions, ' +
      "écritures), pas la composition qu'on est en train d'écrire. La composition antérieure " +
      "complète part quand même dans journal_audit avant la suppression : rien n'est perdu, " +
      'seulement réécrit. Le fichier source porte lui-même le commentaire « LE SEUL DELETE DE CE ' +
      'FICHIER » au-dessus de cette ligne.',
  },
];

function estExceptee(identifiantJs: string): boolean {
  return EXCEPTIONS_SUPPRESSION.some((exception) => exception.identifiantJs === identifiantJs);
}

/** Toutes les tables du schéma, MOINS les exceptions documentées ci-dessus. */
const TABLES_PROTEGEES: readonly TableDeclaree[] = TOUTES_LES_TABLES.filter(
  (table) => !estExceptee(table.identifiantJs),
);

const DOSSIERS_IGNORES = new Set([
  'node_modules',
  'dist',
  '.git',
  'drizzle',
  'donnees',
  'sauvegardes',
  'sorties',
  '.playwright-mcp',
]);

/** Tous les fichiers source d'un dossier, TESTS EXCLUS — même convention que securite-secrets.test.ts. */
function fichiersSource(depart: string): string[] {
  if (!existsSync(depart)) return [];
  const trouves: string[] = [];

  const explorer = (dossier: string): void => {
    for (const entree of readdirSync(dossier)) {
      if (DOSSIERS_IGNORES.has(entree)) continue;
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) {
        explorer(chemin);
        continue;
      }
      if (!/\.(?:ts|tsx|js|mjs)$/.test(entree)) continue;
      if (/\.test\.(?:ts|tsx)$/.test(entree)) continue;
      trouves.push(chemin);
    }
  };

  explorer(depart);
  return trouves;
}

/**
 * Cherche, dans le CONTENU d'un fichier, tout appel qui supprimerait une des
 * tables protégées (toutes les tables du schéma, moins les exceptions
 * documentées). Fonction PURE (aucune lecture disque) : c'est ce qui la rend
 * falsifiable par de simples chaînes, indépendamment du vrai dépôt.
 *
 * Rend une ligne de description par violation trouvée, vide si aucune.
 */
export function suppressionsDangereuses(contenu: string, cheminAffichage: string): string[] {
  const violations: string[] = [];

  for (const { identifiantJs, nomSql } of TABLES_PROTEGEES) {
    // Drizzle : `.delete(` suivi (après espaces/retours à la ligne) de
    // l'identifiant EXACT de la table — jamais un préfixe d'un autre nom
    // (`\b` empêche `.delete(sessionVenteArchive)` de matcher `sessionVente`).
    const motifDrizzle = new RegExp(`\\.delete\\s*\\(\\s*${identifiantJs}\\b`);
    if (motifDrizzle.test(contenu)) {
      violations.push(
        `${cheminAffichage} : ".delete(${identifiantJs})" — suppression Drizzle interdite.`,
      );
    }

    // SQL brut, avec ou sans guillemets, insensible à la casse : `DELETE FROM
    // session_vente`, `delete from "session_vente"`, dans un `sql\`…\`` ou une
    // chaîne construite à la main.
    const motifSql = new RegExp(`delete\\s+from\\s+["'\`]?${nomSql}\\b`, 'i');
    if (motifSql.test(contenu)) {
      violations.push(`${cheminAffichage} : "DELETE FROM ${nomSql}" — suppression SQL interdite.`);
    }
  }

  return violations;
}

/* ═══════════════════════════════════════════════════════════════════════════
   0. La dérivation elle-même : preuve qu'elle balaie tout le schéma, et rien
      qu'un défaut ne pourrait faire baisser en silence
   ═══════════════════════════════════════════════════════════════════════════ */

describe('tablesDuSchema — dérivation de la liste des tables depuis schema.ts', () => {
  it('trouve exactement autant de tables que de déclarations sqliteTable(...) dans schema.ts', () => {
    // Comptage INDÉPENDANT du motif de dérivation, par une regex plus simple
    // qui ne capture rien : si `MOTIF_DECLARATION_TABLE` régressait (une forme
    // d'écriture qu'il cesserait de reconnaître), ce test le verrait — les
    // deux comptages divergeraient. Reproductible en ligne de commande :
    // `rg -U --multiline-dotall "export const \w+ = sqliteTable" packages/db/src/schema.ts | wc -l`
    const nombreDeclarations = (CONTENU_SCHEMA.match(/export const \w+ = sqliteTable\(/g) ?? [])
      .length;
    expect(TOUTES_LES_TABLES.length).toBe(nombreDeclarations);
    // Valeur observée le 31/07/2026 — si ce nombre change, c'est le SCHÉMA qui
    // a changé (table ajoutée/retirée), pas une preuve en soi ; mais un écart
    // entre ce nombre et `nombreDeclarations` ci-dessus serait un défaut du
    // PARSEUR, pas du schéma.
    expect(TOUTES_LES_TABLES.length).toBeGreaterThan(0);
  });

  it('chaque table dérivée a un identifiant JS et un nom SQL non vides et bien formés', () => {
    // Garde contre une capture regex qui rendrait une chaîne vide ou du bruit
    // (par exemple si `MOTIF_DECLARATION_TABLE` matchait un fragment de
    // commentaire) : CLAUDE.md §4 impose camelCase en TS, snake_case en SQL.
    for (const { identifiantJs, nomSql } of TOUTES_LES_TABLES) {
      expect(identifiantJs, 'identifiant JS').toMatch(/^[a-z][a-zA-Z0-9]*$/);
      expect(nomSql, `nomSql de ${identifiantJs}`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('détecte une déclaration sur une seule ligne ET une déclaration éclatée sur plusieurs lignes', () => {
    // Falsification du parseur lui-même, indépendamment du vrai schema.ts :
    // les deux formes réellement utilisées aujourd'hui (`utilisateur`,
    // `immobilisation`, `objectif` sur une ligne ; la majorité éclatée).
    const fixture = [
      "export const utilisateur = sqliteTable('utilisateur', {",
      "  id: text('id').primaryKey(),",
      '});',
      '',
      'export const sessionMarche = sqliteTable(',
      "  'session_marche',",
      "  { id: text('id').primaryKey() },",
      ');',
    ].join('\n');
    expect(tablesDuSchema(fixture)).toEqual([
      { identifiantJs: 'utilisateur', nomSql: 'utilisateur' },
      { identifiantJs: 'sessionMarche', nomSql: 'session_marche' },
    ]);
  });

  it('ne trouve RIEN sur du code qui ne déclare aucune table (falsification négative)', () => {
    const fixture = 'export function calculerTotal(a: number, b: number): number { return a + b; }';
    expect(tablesDuSchema(fixture)).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   0bis. Les exceptions : un périmètre réduit délibérément, jamais en silence
   ═══════════════════════════════════════════════════════════════════════════ */

describe('EXCEPTIONS_SUPPRESSION — le seul retrait délibéré du périmètre protégé', () => {
  it('la liste des exceptions ne contient QUE celles revues et nommées explicitement par ce test', () => {
    // GESTE VISIBLE : si quelqu'un ajoute une table à EXCEPTIONS_SUPPRESSION
    // sans mettre à jour CETTE assertion, ce test échoue et nomme l'écart —
    // impossible d'élargir le trou dans le garde-fou sans que ça se voie ici.
    expect(EXCEPTIONS_SUPPRESSION.map((exception) => exception.identifiantJs)).toEqual([
      'recetteLigne',
    ]);
  });

  it('chaque exception documentée correspond à une VRAIE table du schéma, jamais un nom obsolète', () => {
    for (const exception of EXCEPTIONS_SUPPRESSION) {
      const table = TOUTES_LES_TABLES.find((t) => t.identifiantJs === exception.identifiantJs);
      expect(table, `${exception.identifiantJs} n'existe plus dans schema.ts`).toBeDefined();
      expect(table!.nomSql, `nomSql de ${exception.identifiantJs}`).toBe(exception.nomSql);
    }
  });

  it('chaque exception porte un motif substantiel, écrit ICI — pas un renvoi vide', () => {
    for (const exception of EXCEPTIONS_SUPPRESSION) {
      expect(exception.motif.length, `motif de ${exception.identifiantJs}`).toBeGreaterThan(120);
    }
  });

  it('le nombre de tables protégées = toutes les tables du schéma moins les exceptions', () => {
    expect(TABLES_PROTEGEES.length).toBe(TOUTES_LES_TABLES.length - EXCEPTIONS_SUPPRESSION.length);
  });

  it("l'exception documentée (recetteLigne) n'est PAS signalée par le détecteur — elle est hors périmètre par construction", () => {
    const extrait = 'baseTx.delete(recetteLigne).where(eq(recetteLigne.recetteId, id)).run();';
    expect(suppressionsDangereuses(extrait, 'fixture.ts')).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. Falsification du détecteur : preuve qu'il sait dire NON
   ═══════════════════════════════════════════════════════════════════════════ */

describe('suppressionsDangereuses — falsification du détecteur', () => {
  it('détecte un DELETE Drizzle sur CHACUNE des tables protégées (dérivées du schéma)', () => {
    for (const { identifiantJs } of TABLES_PROTEGEES) {
      const extrait = `base.delete(${identifiantJs}).where(eq(${identifiantJs}.id, id)).run();`;
      expect(suppressionsDangereuses(extrait, 'fixture.ts'), identifiantJs).not.toEqual([]);
    }
  });

  it('détecte un DELETE Drizzle même reformaté sur plusieurs lignes', () => {
    const extrait =
      'base\n  .delete(\n    mouvementStock\n  )\n  .where(eq(mouvementStock.id, id))\n  .run();';
    expect(suppressionsDangereuses(extrait, 'fixture.ts')).not.toEqual([]);
  });

  it('détecte un DELETE FROM SQL brut, guillemets et casse comprises', () => {
    expect(suppressionsDangereuses('sql`DELETE FROM session_vente`', 'a.ts')).not.toEqual([]);
    expect(suppressionsDangereuses('db.run(`delete from "session_marche"`)', 'b.ts')).not.toEqual(
      [],
    );
    expect(suppressionsDangereuses("execute('DELETE FROM `production`')", 'c.ts')).not.toEqual([]);
    // Nouvellement couvertes (avant cette mission, hors périmètre) : preuve
    // que la dérivation les protège vraiment, pas seulement les onze d'origine.
    expect(suppressionsDangereuses('sql`DELETE FROM depense`', 'd.ts')).not.toEqual([]);
    expect(
      suppressionsDangereuses('db.run(`DELETE FROM "facture_fournisseur"`)', 'e.ts'),
    ).not.toEqual([]);
  });

  it('NE SE TROMPE PAS sur un Map.delete (même nom de variable)', () => {
    // Le piège reel de ce depot : `packages/core/src/recettes.ts` contient
    // `parIngredient.delete(ingredientId)`, un `Map.delete`, pas un DELETE SQL.
    const extrait = 'const production = new Map(); production.delete(id);';
    expect(suppressionsDangereuses(extrait, 'fixture.ts')).toEqual([]);
  });

  it('NE SE TROMPE PAS sur la suppression de la table EXCEPTÉE (recetteLigne)', () => {
    // `referentiel-ecriture.ts` supprime légitimement des lignes de recette
    // (`recetteLigne`) — la SEULE exception documentée, voir
    // `EXCEPTIONS_SUPPRESSION` plus haut pour le motif complet.
    const extrait = 'baseTx.delete(recetteLigne).where(eq(recetteLigne.recetteId, id)).run();';
    expect(suppressionsDangereuses(extrait, 'fixture.ts')).toEqual([]);
  });

  it('NE SE TROMPE PAS sur un identifiant qui ne fait que commencer pareil', () => {
    const extrait = 'base.delete(productionArchivee).run();';
    expect(suppressionsDangereuses(extrait, 'fixture.ts')).toEqual([]);
  });

  /**
   * Piège vérifié sur des noms de tables courts, qui apparaissent comme
   * PRÉFIXE de plusieurs identifiants réels du dépôt (`lotsProchesDlc`,
   * `exerciceTracabilite.lotDepartId`, `depenseDuMoisCents`…). Sans `\b`, les
   * élargir aurait pu faire crier au loup sur du code parfaitement légitime.
   */
  it('NE SE TROMPE PAS sur un préfixe d’une table protégée (lot, non_conformite, depense)', () => {
    expect(suppressionsDangereuses('base.delete(lotsArchives).run();', 'fixture.ts')).toEqual([]);
    expect(
      suppressionsDangereuses('base.delete(nonConformiteResume).run();', 'fixture.ts'),
    ).toEqual([]);
    expect(suppressionsDangereuses('base.delete(depenseAnnulee).run();', 'fixture.ts')).toEqual([]);
  });

  it('rend une liste vide sur du code qui ne supprime rien', () => {
    const extrait = 'base.insert(sessionVente).values({ id, montantCents: 350 }).run();';
    expect(suppressionsDangereuses(extrait, 'fixture.ts')).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Le VRAI balayage du dépôt — ce qui échouera demain si quelqu'un ajoute
      un DELETE sur N'IMPORTE QUELLE table du schéma (sauf l'exception
      documentée), exactement l'exigence de la fiche 07 et de CLAUDE.md §3 règle 7
   ═══════════════════════════════════════════════════════════════════════════ */

describe('non-suppression réelle du dépôt', () => {
  it('aucun DELETE, Drizzle ou SQL, sur AUCUNE table protégée du schéma (dérivée, exceptions documentées exclues)', () => {
    const violations: string[] = [];
    for (const dossier of ['apps', 'packages']) {
      for (const fichier of fichiersSource(join(RACINE, dossier))) {
        const contenu = readFileSync(fichier, 'utf-8');
        violations.push(...suppressionsDangereuses(contenu, relative(RACINE, fichier)));
      }
    }

    expect(
      violations,
      'Une suppression a été trouvée sur une table protégée. CLAUDE.md §3 règle 7 : ' +
        '« Rien ne s’efface. Corrections par écriture d’annulation (`is_annule` + ' +
        '`annule_par_id`), jamais par `DELETE`. »',
    ).toEqual([]);
  });
});
