import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/drizzle/**',
      '.husky/**',
      'donnees/**',
      'sauvegardes/**',
      // Repertoire de SORTIE, au meme titre que `donnees/` et `sauvegardes/` :
      // PDF, classeurs, mails et captures d'ecran produits par l'application ou
      // par les scripts de verification. Rien de ce qui s'y trouve n'est du code
      // source du produit, et les scripts de capture qui y vivent s'executent
      // dans un navigateur (`document`, `location`) que la configuration Node
      // ne connait pas.
      'sorties/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // CLAUDE.md §4 : pas de `any`, `unknown` + affinage si necessaire.
      '@typescript-eslint/no-explicit-any': 'error',
      // CLAUDE.md §4 : jamais de catch silencieux.
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    // Regles des hooks React. Aucun typage ne voit la dependance manquante d'un
    // `useEffect` : le symptome est une donnee perimee a l'ecran, qui n'apparait
    // qu'a l'usage. Sur une base React de plusieurs milliers de lignes, c'est le
    // seul filet possible.
    //
    // On n'active QUE les deux regles historiques. Le preset `recommended-latest`
    // de la v7 embarque en plus une quinzaine de regles du React Compiler
    // (`purity`, `immutability`, `static-components`...) : ce sont des regles de
    // style de compilation, hors du perimetre de cet outillage, et CLAUDE.md §9
    // demande de privilegier la lisibilite plutot que d'empiler les contraintes.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  // Le cliquet qui tolerait `exhaustive-deps` en `warn` sur quatre ecrans a ete
  // SOLDE le 28/07/2026. Les quatre portaient le meme defaut : un ternaire
  // rendant `[]` recreait un tableau a chaque rendu, ce qui annulait le
  // `useMemo` qui en dependait. Tous enveloppes dans leur propre `useMemo`.
  // La regle est desormais BLOQUANTE partout — un cliquet se supprime, il ne
  // s'etend pas.
  {
    // Les fichiers de configuration tournent hors du projet TypeScript.
    files: ['*.config.js', '*.config.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
