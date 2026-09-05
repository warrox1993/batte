/**
 * Les secrets, verifies PAR LA CONSTRUCTION et non par l'intention.
 *
 * Ce fichier ne teste aucune fonction : il lit le depot et refuse ce qui rendrait
 * une fuite possible. Trois invariants de CLAUDE.md y sont figes :
 *
 *  - §2 « la cle ne doit jamais atteindre le navigateur » : `apps/web` ne lit
 *    aucun environnement, n'importe ni le SDK Anthropic ni Nodemailer ni la
 *    couche base, et ne depend que de `@batte/core` — qui, lui, ne lit rien non
 *    plus. Vite recopie dans le bundle TOUTE variable prefixee `VITE_` : il ne
 *    doit donc jamais en exister une seule.
 *  - §7 « fournir un `.env.example` documente » : le fichier decrit EXACTEMENT
 *    ce que le code lit, dans les deux sens. Une variable documentee mais jamais
 *    lue est pire qu'absente — elle fait croire a un reglage qui n'existe pas.
 *    C'est arrive deux fois (`PLAFOND_IA_MENSUEL_CENTS`, `OPEN_METEO_URL`).
 *  - §7 « les secrets vivent dans `.env`, jamais dans le depot » : aucun fichier
 *    versionne ne porte de valeur ressemblant a une cle.
 *
 * Il vit sous `apps/api` parce que la configuration de Vitest ne collecte que
 * `packages/**` et `apps/api/**` — pas parce qu'il ne concerne que l'API.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Racine du depot, deduite du chemin de ce fichier : apps/api/src -> ../../.. */
const RACINE = resolve(import.meta.dirname, '..', '..', '..');

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

/**
 * Tous les fichiers d'un dossier de documentation, sous-dossiers COMPRIS.
 *
 * `docs/` s'est mis a contenir des sous-dossiers (`docs/demandes/`) : un
 * parcours a plat rendait leur nom, que la lecture refusait ensuite avec
 * `EISDIR`. Le balayage anti-fuite tombait donc au lieu de couvrir plus.
 */
function fichiersMarkdown(depart: string): string[] {
  if (!existsSync(depart)) return [];
  const trouves: string[] = [];
  for (const entree of readdirSync(depart)) {
    const chemin = join(depart, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...fichiersMarkdown(chemin));
    else trouves.push(chemin);
  }
  return trouves;
}

/** Tous les fichiers source d'un dossier, tests exclus. */
function fichiersSource(depart: string, avecTests = false): string[] {
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
      if (!avecTests && /\.test\.(?:ts|tsx)$/.test(entree)) continue;
      trouves.push(chemin);
    }
  };

  explorer(depart);
  return trouves;
}

function lire(chemin: string): string {
  return readFileSync(chemin, 'utf-8');
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. `.env.example` décrit exactement ce que le code lit
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Les trois façons dont ce dépôt lit l'environnement.
 *
 * L'indirection compte autant que l'accès direct : `apps/api/src/mail.ts` passe
 * par `texteEnv('SMTP_HOTE')` et `packages/db/src/config.ts` par
 * `texte('CHEMIN_BASE', …)`. Un scan qui ne verrait que `process.env[…]`
 * declarerait ces variables « non lues » et supprimerait leur documentation.
 * Une quatrieme indirection devra etre ajoutee ici.
 */
const LECTEURS_ENV: readonly RegExp[] = [
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /\btexteEnv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /\b(?:texte|entier|chemin)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
];

function variablesLuesParLeCode(): Set<string> {
  const trouvees = new Set<string>();
  for (const dossier of ['apps', 'packages']) {
    for (const fichier of fichiersSource(join(RACINE, dossier))) {
      const contenu = lire(fichier);
      for (const lecteur of LECTEURS_ENV) {
        for (const occurrence of contenu.matchAll(lecteur)) {
          trouvees.add(occurrence[1]!);
        }
      }
    }
  }
  return trouvees;
}

function variablesDocumentees(): Set<string> {
  const contenu = lire(join(RACINE, '.env.example'));
  const cles = new Set<string>();
  for (const ligne of contenu.split('\n')) {
    const declaration = /^([A-Z][A-Z0-9_]*)=/.exec(ligne.trim());
    if (declaration !== null) cles.add(declaration[1]!);
  }
  return cles;
}

describe('.env.example', () => {
  it('existe et n’expose aucune valeur de secret', () => {
    const contenu = lire(join(RACINE, '.env.example'));
    // Les variables sensibles y figurent, VIDES : c'est un gabarit, pas un coffre.
    expect(contenu).toMatch(/^ANTHROPIC_API_KEY=\s*$/m);
    expect(contenu).toMatch(/^SMTP_MOT_DE_PASSE=\s*$/m);
    expect(contenu).not.toMatch(/sk-ant-/);
  });

  it('documente TOUTE variable que le code lit', () => {
    const lues = variablesLuesParLeCode();
    const documentees = variablesDocumentees();
    const oubliees = [...lues].filter((cle) => !documentees.has(cle)).sort();

    expect(oubliees, `variables lues mais non documentées : ${oubliees.join(', ')}`).toEqual([]);
  });

  it('ne documente AUCUNE variable que le code ignore', () => {
    // Le piege inverse, et le plus dangereux : un utilisateur qui pose
    // `PLAFOND_IA_MENSUEL_CENTS=0` croit avoir coupé la dépense alors que le
    // plafond réel vit dans la table `parametre`.
    const lues = variablesLuesParLeCode();
    const documentees = variablesDocumentees();
    const fantomes = [...documentees].filter((cle) => !lues.has(cle)).sort();

    expect(fantomes, `variables documentées mais jamais lues : ${fantomes.join(', ')}`).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Le navigateur ne peut structurellement pas voir un secret
   ═══════════════════════════════════════════════════════════════════════════ */

describe('confinement côté serveur', () => {
  const sourcesWeb = fichiersSource(join(RACINE, 'apps', 'web', 'src'), true);

  it('trouve bien les sources du front (sinon ce bloc ne prouverait rien)', () => {
    expect(sourcesWeb.length).toBeGreaterThan(5);
  });

  it('aucun fichier du front ne lit l’environnement', () => {
    for (const fichier of sourcesWeb) {
      const contenu = lire(fichier);
      const nom = relative(RACINE, fichier);
      expect(contenu, `${nom} lit process.env`).not.toMatch(/process\s*\.\s*env/);
      // Vite INLINE toute variable `VITE_` dans le bundle : une seule
      // suffirait a faire d'un secret un fichier statique public.
      expect(contenu, `${nom} lit import.meta.env`).not.toMatch(/import\s*\.\s*meta\s*\.\s*env/);
      expect(contenu, `${nom} référence une variable VITE_`).not.toMatch(/\bVITE_[A-Z0-9_]+/);
    }
  });

  it('aucun fichier du front n’importe un module qui parle aux secrets', () => {
    const modulesInterdits = ['@anthropic-ai/sdk', 'nodemailer', '@batte/db', 'node:fs'];
    for (const fichier of sourcesWeb) {
      const contenu = lire(fichier);
      const nom = relative(RACINE, fichier);
      for (const module of modulesInterdits) {
        expect(contenu, `${nom} importe ${module}`).not.toMatch(
          new RegExp(`from\\s+['"]${module.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}`),
        );
      }
    }
  });

  it('le graphe de dépendances du front ne peut pas atteindre le SDK', () => {
    // Verification par la CONSTRUCTION : `apps/web` ne declare que `@batte/core`
    // comme paquet du dépôt, et `@batte/core` ne dépend d'aucun module réseau.
    const web = JSON.parse(lire(join(RACINE, 'apps', 'web', 'package.json'))) as {
      dependencies?: Record<string, string>;
    };
    const core = JSON.parse(lire(join(RACINE, 'packages', 'core', 'package.json'))) as {
      dependencies?: Record<string, string>;
    };

    const depsWeb = Object.keys(web.dependencies ?? {});
    expect(depsWeb).not.toContain('@anthropic-ai/sdk');
    expect(depsWeb).not.toContain('nodemailer');
    expect(depsWeb).not.toContain('@batte/db');
    // Le seul paquet du dépôt que le front consomme.
    expect(depsWeb.filter((d) => d.startsWith('@batte/'))).toEqual(['@batte/core']);

    const depsCore = Object.keys(core.dependencies ?? {});
    expect(depsCore).not.toContain('@anthropic-ai/sdk');
    expect(depsCore).not.toContain('nodemailer');
  });

  it('packages/core ne lit jamais l’environnement', () => {
    // C'est le seul paquet du dépôt embarqué dans le bundle : s'il lisait
    // `process.env`, Vite y substituerait une valeur figée à la compilation.
    for (const fichier of fichiersSource(join(RACINE, 'packages', 'core', 'src'))) {
      expect(lire(fichier), relative(RACINE, fichier)).not.toMatch(/process\s*\.\s*env/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. La sortie de Claude n'a aucun chemin vers la base
   ═══════════════════════════════════════════════════════════════════════════ */

describe('sortie de Claude', () => {
  it('n’est enregistrée nulle part : `reponseBrute` reste une colonne inutilisée', () => {
    /*
     * CLAUDE.md §3 regle 2 : « toute sortie d'un appel Claude qui alimente la
     * base doit passer par un schema Zod strict et etre marquee `source = 'ia'`
     * avec validation humaine explicite ». Aujourd'hui le produit ne stocke
     * AUCUNE sortie de Claude — les commentaires sont affiches puis oublies —
     * et c'est la façon la plus sûre de tenir la règle.
     *
     * Ce test garde la porte : le jour ou quelqu'un renseignera `reponseBrute`,
     * il tombera, et la question « ou est le schema Zod, ou est la validation
     * humaine ? » se posera AVANT la fusion, pas apres.
     */
    const ecrivains = [
      ...fichiersSource(join(RACINE, 'apps')),
      ...fichiersSource(join(RACINE, 'packages')),
    ].filter((fichier) => {
      const nom = relative(RACINE, fichier).replace(/\\/g, '/');
      // Le depot et le schema ont le droit de NOMMER la colonne : eux la
      // declarent, ils ne la remplissent pas.
      if (nom === 'packages/db/src/depots/ia.ts' || nom === 'packages/db/src/schema.ts') {
        return false;
      }
      return /\breponseBrute\b/.test(lire(fichier));
    });

    expect(
      ecrivains.map((f) => relative(RACINE, f)),
      'une sortie de Claude est sur le point d’entrer en base',
    ).toEqual([]);
  });

  it('passe par un contrat Zod partout où elle est renvoyée', () => {
    const appelants = [...fichiersSource(join(RACINE, 'apps', 'api', 'src'))].filter((fichier) =>
      /\bdemanderCommentaire\s*\(/.test(lire(fichier)),
    );

    // Au moins les deux routes de commentaire, et le client lui-même.
    expect(appelants.length).toBeGreaterThanOrEqual(2);

    for (const fichier of appelants) {
      const nom = relative(RACINE, fichier).replace(/\\/g, '/');
      if (nom.endsWith('ia/client.ts')) continue; // le producteur, pas un appelant
      expect(lire(fichier), `${nom} rend un commentaire sans le valider`).toContain(
        'schemaCommentaireIa.parse',
      );
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Le bundle réellement produit
   ═══════════════════════════════════════════════════════════════════════════ */

describe('bundle de production', () => {
  const dist = join(RACINE, 'apps', 'web', 'dist');

  /**
   * Motifs cherches dans les fichiers livres au navigateur.
   *
   * `sk-ant-` et consorts ne peuvent y entrer que par une variable `VITE_` ou
   * une constante recopiee a la main — les deux sont interdites plus haut, ceci
   * en est la contre-verification a posteriori.
   */
  const MOTIFS_SECRETS: readonly RegExp[] = [
    /sk-ant-[A-Za-z0-9_-]{6,}/,
    /ANTHROPIC[_A-Z]*\s*[:=]/,
    /SMTP_[A-Z_]+/,
    /\bMOT_DE_PASSE\b/,
    /\bBearer\s+[A-Za-z0-9._-]{10,}/i,
  ];

  it(
    'ne contient aucun secret, ni aucune trace du SDK Anthropic',
    { skip: !existsSync(dist) },
    () => {
      const fichiers = readdirSync(join(dist, 'assets')).map((f) => join(dist, 'assets', f));
      fichiers.push(join(dist, 'index.html'));

      for (const fichier of fichiers) {
        const contenu = lire(fichier);
        const nom = relative(RACINE, fichier);
        for (const motif of MOTIFS_SECRETS) {
          expect(contenu, `${nom} : ${String(motif)}`).not.toMatch(motif);
        }
        expect(contenu.toLowerCase(), `${nom} embarque le SDK`).not.toContain('@anthropic-ai');
        expect(contenu, `${nom} embarque une lecture d'environnement`).not.toMatch(
          /process\.env\.[A-Z]/,
        );
      }
    },
  );

  /**
   * `MOTIFS_SECRETS` ci-dessus est une liste de PRÉFIXES écrite à la main
   * (`ANTHROPIC`, `SMTP_`) : exactement le défaut que D-045 a déjà trouvé
   * ailleurs dans ce dépôt (« une liste écrite à la main n'est pas une preuve
   * d'absence »). Le jour où une TROISIÈME famille de secret apparaît dans
   * `.env.example` — un jeton Google (D-008 l'anticipe pour un futur lot),
   * une clé d'un autre service — rien n'obligerait à étendre cette liste, et
   * le balayage du bundle continuerait de dire « rien trouvé » sans plus rien
   * couvrir.
   *
   * Ce test-ci DÉRIVE les noms à chercher de `.env.example` lui-même (déjà la
   * source de vérité pour les deux autres tests de ce fichier), filtrés sur
   * la FORME du nom plutôt que sur une énumération figée de préfixes :
   * n'importe quelle variable dont le nom ressemble à un identifiant de
   * secret est balayée, qu'elle existe aujourd'hui ou qu'elle soit ajoutée
   * demain.
   */
  function estNomDeVariableSensible(nom: string): boolean {
    return /SECRET|TOKEN|MOT_DE_PASSE|PASSWORD|API_KEY|\bCLE\b/.test(nom);
  }

  it(
    'ne cite le NOM d’aucune variable sensible de .env.example — y compris une future',
    { skip: !existsSync(dist) },
    () => {
      const nomsSensibles = [...variablesDocumentees()].filter(estNomDeVariableSensible);
      // Si cette liste est vide, le test ci-dessous ne prouverait rien :
      // aujourd'hui ANTHROPIC_API_KEY et SMTP_MOT_DE_PASSE doivent y figurer.
      expect(nomsSensibles.length).toBeGreaterThan(0);

      const fichiers = readdirSync(join(dist, 'assets')).map((f) => join(dist, 'assets', f));
      fichiers.push(join(dist, 'index.html'));

      for (const fichier of fichiers) {
        const contenu = lire(fichier);
        const nom = relative(RACINE, fichier);
        for (const cle of nomsSensibles) {
          expect(contenu, `${nom} cite la variable sensible ${cle}`).not.toMatch(
            new RegExp(`\\b${cle}\\b`),
          );
        }
      }
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Aucun secret en clair dans le dépôt
   ═══════════════════════════════════════════════════════════════════════════ */

describe('dépôt', () => {
  it('ignore `.env` et les dossiers de données', () => {
    const gitignore = lire(join(RACINE, '.gitignore'));
    for (const attendu of ['.env', 'donnees/', 'sauvegardes/', 'sorties/']) {
      expect(gitignore, `${attendu} devrait être ignoré`).toContain(attendu);
    }
  });

  it('aucune source ni aucun document ne porte une clé en clair', () => {
    /**
     * Ce qui ressemble a une vraie cle, sentinelles de test exceptees.
     *
     * Les tests POSENT volontairement des chaines en `sk-ant-…` dans
     * l'environnement pour prouver qu'elles ne ressortent pas ; elles portent
     * toutes le marqueur `SENTINELLE`, qui est precisement ce qui les distingue
     * d'un secret reel. On ne renvoie jamais le contenu du fichier dans le
     * message d'echec : ce serait recopier le secret dans la sortie de test.
     */
    const clesEnClair = (contenu: string): string[] =>
      [...contenu.matchAll(/sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/g)]
        .map((occurrence) => occurrence[0])
        .filter((valeur) => !valeur.includes('SENTINELLE'));

    const cibles = [
      ...fichiersSource(join(RACINE, 'apps'), true),
      ...fichiersSource(join(RACINE, 'packages'), true),
      // `docs/` contient desormais des SOUS-DOSSIERS (`docs/demandes/`). Un
      // `readdirSync` a plat rendait leur nom, que `readFileSync` refusait avec
      // `EISDIR` — le balayage tombait donc au lieu de scanner plus large. On
      // descend recursivement : une cle en clair dans un document de travail
      // fuite exactement autant que dans un fichier source.
      ...fichiersMarkdown(join(RACINE, 'docs')),
      join(RACINE, '.env.example'),
      join(RACINE, 'CLAUDE.md'),
    ];

    const fautifs = cibles
      .filter((fichier) => clesEnClair(lire(fichier)).length > 0)
      .map((fichier) => relative(RACINE, fichier));

    expect(fautifs, `clé Anthropic en clair dans : ${fautifs.join(', ')}`).toEqual([]);
  });
});
