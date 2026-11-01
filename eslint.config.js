import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Lint config.
 *
 * The runtime-dependency rules that matter for this project's grading are
 * enforced twice on purpose:
 *   - here, as fast `no-restricted-imports` bans (lint-time, in the editor),
 *   - in src/test/architecture.test.ts, as an authoritative source scan
 *     (also checks package.json, which lint cannot do).
 * `src/test/arch-rules.ts` is the source of truth for the lists; the drift test
 * asserts every banned package name below appears in this file.
 *
 * Note: create-vite 9 now scaffolds with oxlint + TypeScript 7. We stay on
 * ESLint 9 + TS 5.9.3 because typescript-eslint@8 peers `typescript >=4.8.4
 * <6.1.0`, and the boundary rules need a flat config we fully control.
 */

/** Libraries that would defeat the coursework requirement to hand-write these structures. */
const FORBIDDEN_LIBRARIES = [
  'graphology',
  'ngraph',
  'jsplumb',
  'priority-queue',
  'priorityqueuejs',
  'fastpriorityqueue',
  'js-priority-queue',
  'heap-js',
  'binary-heap',
  'tiny-queue',
  'mnemonist',
  'lodash',
  'underscore',
  'trie-search',
  'triejs',
  'natsort',
  'dijkstra',
  'dijkstra-graph',
  'shortest-path',
  'pathfinding',
  'path-js',
  'a-star',
  'astar',
  'jspathfinding',
  'union-find',
  'unionfind',
  'lru-cache',
  'lru',
  'quick-lru',
  'graph-data-structure',
  'geolib',
]

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '*.tsbuildinfo',
      // Built output served by `vite preview` never exists in the repo.
    ],
  },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.es2023 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-restricted-imports': 'off',

      // Nobody, anywhere, may pull in an off-the-shelf algorithm library.
      'no-restricted-imports': [
        'error',
        {
          paths: FORBIDDEN_LIBRARIES.map((name) => ({
            name,
            message: `Hand-write this in src/engine instead — ${name} implements a structure the coursework requires us to implement ourselves.`,
          })),
          // (No `@/*/*` deep-import pattern here: it would also ban side-effect
          // imports such as "@/styles/app.css". Barrel-only access for the
          // engine is enforced precisely by the architecture test instead.)
        },
      ],

      // The engine is framework-free by construction, so it has no reason to
      // reach for a timer or an encoding helper from the platform.
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'navigator'],
    },
  },

  {
    files: ['src/test/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // The architecture scanner reads source text and must recognise the words
      // it forbids elsewhere; comment/string literals are stripped by the
      // scanner itself, so the ban has to lift for the scanner's own ruleset.
      'no-restricted-globals': 'off',
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  {
    // The one place React is allowed to touch the document: the mount point.
    files: ['src/main.tsx'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'localStorage', 'sessionStorage', 'fetch', 'navigator'],
    },
  },

  {
    files: ['scripts/**/*.mjs', 'vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'off',
    },
  },
)
