import { defineConfig } from 'vitest/config';

/**
 * Un fichier de test qui n'est pas dans `include` ne s'execute jamais, et rien
 * ne le signale : il est vert par absence. Les motifs ci-dessous doivent donc
 * couvrir TOUT le code source du depot, pas les repertoires ou l'on a pense a
 * ecrire des tests le jour ou l'on a ecrit la configuration. C'est la faute
 * exacte qui a rendu `apps/web` intestable pendant plusieurs lots.
 */
const MOTIFS_NODE = ['packages/**/*.test.{ts,tsx}', 'apps/api/src/**/*.test.{ts,tsx}'];
const MOTIFS_WEB = ['apps/web/src/**/*.test.{ts,tsx}'];

/**
 * Delai par test, releve au-dessus des 5 s par defaut de Vitest.
 *
 * ═══ Mesure du 01/08/2026 ═══
 *
 * La suite passe **4 580/4 580 sans instrumentation**, et des fichiers tombent
 * en `Test timed out in 5000ms` **des qu'on demande la couverture** :
 * l'instrumentation v8 ralentit sensiblement les tests qui ouvrent une base
 * SQLite, lancent Chromium ou montent un ecran en jsdom.
 *
 * Ce n'est pas un detail de confort. Une couverture que personne ne peut
 * produire sans passer une option en ligne de commande est **exactement la
 * meme classe de defaut** que le seuil de 80 % declare et physiquement
 * inexecutable qu'un audit avait trouve ici (docs/39 §1) : le chiffre finirait
 * par n'etre plus jamais mesure.
 *
 * ═══ ET LE PIEGE, paye immediatement ═══
 *
 * `testTimeout` pose a la RACINE de `test:` **n'est pas herite par les
 * projets**. Le premier correctif a donc ete ecrit, verifie… et le message
 * disait toujours « timed out in **5000ms** ». La valeur doit etre repetee
 * DANS CHAQUE projet — c'est pour ca qu'elle vit dans cette constante plutot
 * que d'etre recopiee deux fois.
 *
 * Meme famille que le `vi.setConfig()` appele dans un `beforeAll`, qui ne
 * s'applique jamais (docs/39 §10) : un reglage pose la ou il *semble* juste,
 * et que rien ne lit. La seule verification qui vaille est de **relire le
 * delai annonce dans le message d'echec**, jamais de relire la configuration.
 *
 * 20 s et non 30 : assez pour l'instrumentation, assez court pour qu'un test
 * reellement bloque tombe dans la minute. Un test qui a BESOIN de plus doit le
 * declarer lui-meme et dire pourquoi — jamais relever ce plafond global pour
 * le faire passer.
 */
const DELAI_TEST_MS = 20_000;

export default defineConfig({
  // Il n'existe pas de `tsconfig.json` a la racine (le projet a
  // `tsconfig.web.json` et `tsconfig.node.json`), donc esbuild ne lit nulle part
  // le `jsx: 'react-jsx'` de la configuration web et retomberait sur la
  // transformation classique — qui exige un `React` global. On le declare ici.
  esbuild: { jsx: 'automatic' },
  test: {
    /**
     * DEUX projets, et non un environnement unique.
     *
     * `jsdom` a ete installe le 01/08/2026 (D-095) pour rendre `apps/web`
     * testable au-dela du premier rendu. Le basculer GLOBALEMENT aurait ete
     * une faute : `packages/db` ouvre `better-sqlite3`, `apps/api` monte
     * Fastify et lance Chromium — aucun n'a besoin d'un DOM, et tous
     * paieraient le cout de son amorçage a chaque fichier.
     *
     * Le decoupage par projet dit AUSSI quelque chose de vrai sur le produit :
     * la logique metier chiffree (CLAUDE.md §3 regle 1) n'a jamais besoin
     * d'un navigateur pour etre prouvee. Si un test de `packages/core`
     * reclamait un jour un DOM, ce serait le signe que du calcul a fui dans
     * l'interface.
     */
    projects: [
      {
        esbuild: { jsx: 'automatic' },
        test: {
          name: 'node',
          include: MOTIFS_NODE,
          environment: 'node',
          testTimeout: DELAI_TEST_MS,
          hookTimeout: DELAI_TEST_MS,
        },
      },
      {
        esbuild: { jsx: 'automatic' },
        test: {
          name: 'web',
          include: MOTIFS_WEB,
          environment: 'jsdom',
          setupFiles: ['apps/web/src/test-setup.ts'],
          testTimeout: DELAI_TEST_MS,
          hookTimeout: DELAI_TEST_MS,
        },
      },
    ],
    /**
     * NOTE : ces deux valeurs sont posees ICI **sans effet**, et volontairement
     * conservees comme piege documente — voir `DELAI_TEST_MS` en tete de
     * fichier. Elles ne servent qu'aux eventuels tests hors projet.
     *
     * Ce n'est pas un detail de confort : une couverture que personne ne peut
     * produire sans passer une option en ligne de commande est **exactement
     * la meme classe de defaut** que le seuil de 80 % declare et physiquement
     * inexecutable qu'un audit avait trouve ici (docs/39 §1). Le chiffre
     * finirait par n'etre plus jamais mesure.
     *
     * 20 s et non 30 : assez pour l'instrumentation, assez court pour qu'un
     * test reellement bloque tombe dans la minute plutot que de faire trainer
     * la suite. Un test qui a BESOIN de plus doit le declarer lui-meme et dire
     * pourquoi — jamais relever ce plafond global pour le faire passer.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      /**
       * Le perimetre a longtemps ete `packages/core` SEUL, au motif que
       * CLAUDE.md §4 y fixe la cible de 80 % et laisse « le reste au
       * jugement ». Le chiffre affiche etait donc 98,81 % — exact, et
       * trompeur : il ne regardait qu'un paquet sur quatre. Mesure du
       * 01/08/2026 sur les quatre : **57,28 %**.
       *
       * « Le reste au jugement » veut dire que le SEUIL est plus bas
       * ailleurs, pas que le reste est invisible. Une mesure dont on ignore le
       * perimetre ne mesure rien.
       */
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        // Les trois `index.ts` de `packages/core` ont ete relus : ils ne
        // contiennent que des re-exports et des commentaires, aucune logique.
        // L'exclusion est donc exacte aujourd'hui — si un calcul y apparait un
        // jour, il faudra la retirer plutot que l'elargir.
        '**/index.ts',
        // Amorçage de test, pas du produit.
        'apps/web/src/test-setup.ts',
        /**
         * OUTILLAGE, et non produit — exclu apres mesure, pas par confort.
         *
         * Ce script de diagnostic pese 682 des 1 191 instructions non
         * couvertes de `packages/db`, soit 57 % du trou du paquet. Trois
         * raisons de ne PAS le couvrir :
         *
         *  - son propre en-tete explique pourquoi il n'est pas un test Vitest :
         *    il fabrique ~150 puis ~390 sessions par la vraie chaine de
         *    services, ce qui DOUBLERAIT la duree de la suite ;
         *  - il ne produit aucun chiffre qui entre en base ni qui atteigne un
         *    ecran — il imprime des chronos. Un test qui assere « le script a
         *    imprime des durees » ne mesure rien ;
         *  - le garder dans le perimetre FAUSSE la lecture : `packages/db`
         *    parait bloque a ~92 % alors qu'il est a **97,4 %**.
         *
         * `scripts/backtest.ts` reste DANS le perimetre : il a un test, et il
         * est lance par `npm run backtest`.
         */
        'packages/db/src/scripts/audit-echelle.ts',
      ],
      /**
       * Seuils GLOBAUX volontairement bas pour l'instant : ils valent
       * garde-fou anti-regression, pas objectif. La cible de 80 % de
       * CLAUDE.md §4 reste posee sur `packages/core`, ou elle est tenue a
       * 98,81 %. Relever ces chiffres au fur et a mesure que la couverture
       * d'`apps/web` monte — jamais les baisser pour faire passer une suite.
       */
      thresholds: { lines: 55, functions: 65, statements: 55 },
      reporter: ['text-summary', 'text'],
    },
  },
});
