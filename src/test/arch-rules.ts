/**
 * Shared rule sets for `architecture.test.ts`.
 *
 * Kept in its own module because the same lists have to be mirrored in
 * eslint.config.js for editor-time errors; `package.json` allow/deny checks can
 * only be done here, since ESLint cannot read the dependency graph.
 *
 * This file names banned identifiers as data, which is why `src/test/**` is out
 * of scope for the identifier scans — a scanner cannot police itself without
 * tripping over its own vocabulary.
 */

/**
 * Anything that would hand us the exact structures/algorithms the coursework
 * requires us to write. Matched as case-insensitive substrings against import
 * specifiers and against declared dependency names.
 */
export const ALGORITHM_DENYLIST: readonly string[] = [
  // graphs
  'graphology',
  'ngraph',
  'graph-data-structure',
  'graphlib',
  'networked-graph',
  'graph-cytoscape',
  'jsplumb',
  // priority queues / heaps
  'priority-queue',
  'priorityqueuejs',
  'fastpriorityqueue',
  'fast-priority-queue',
  'js-priority-queue',
  'heap-js',
  'binary-heap',
  'okdyp-lib',
  // tries / string indexes
  'trie-search',
  'triejs',
  'trie-prefix-tree',
  'radix64',
  // shortest path / search
  'dijkstra',
  'dijkstra-graph',
  'shortest-path',
  'shortest',
  'pathfinding',
  'path-js',
  'a-star',
  'astar',
  'jspathfinding',
  'astar-typescript',
  // the rest of the required set
  'union-find',
  'unionfind',
  'disjoint-set',
  'lru-cache',
  'quick-lru',
  'tiny-lru',
  'mnemonist',
  'immutable',
  'lodash',
  'ramda',
  // geometry helpers that would replace src/engine/geo
  'geolib',
  'turf',
  '@turf',
  'polylabel',
  'flatten-geojson',
]

/**
 * Runtime dependencies the app is allowed to ship. Everything else in
 * `dependencies` fails the build; devDependencies are free (they never reach
 * the browser) except for the denylist above.
 */
export const RUNTIME_DEP_ALLOWLIST: readonly string[] = ['react', 'react-dom', 'lucide-react']

/** Self-hosted fonts are allowed so the app can stay offline-friendly. */
export const RUNTIME_DEP_ALLOW_PATTERNS: readonly RegExp[] = [
  /^@fontsource\//,
  /^fontsource-/,
  /^@typefont\//,
  /-font$/,
  /^typeface-/,
]

/** Identifiers with no business existing inside `src/engine`. */
export const PLATFORM_GLOBALS_IN_ENGINE: readonly string[] = [
  'document',
  'window',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'HTMLElement',
  'SVGElement',
  'Element',
  'NodeListOf',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'matchMedia',
  'navigator',
  'Blob',
  'Image',
  'EventSource',
  'XMLHttpRequest',
  'process',
  'require',
  'globalThis',
]

/** No runtime network access anywhere in the app. There is no backend. */
export const NETWORK_APIS: readonly string[] = [
  'fetch(',
  'XMLHttpRequest',
  'axios',
  'new WebSocket',
  'EventSource',
  'sendBeacon',
  'navigator.clipboard.read',
]

/** Files the engine may not reach for, by specifier prefix. */
export const ENGINE_BANNED_IMPORT_PREFIXES: readonly string[] = [
  'react',
  'react-dom',
  'lucide-react',
  '@/ui',
  '@/data',
  '@/hooks',
  '@/state',
  '@/styles',
  'node:',
  'vitest',
]

/** Where an engine-touching import is legal. Hooks are the only app-side door. */
/**
 * Public surfaces and the directory that owns each one. A file outside the owning directory may import
 * the barrel and nothing else, which is the same rule applied to both layers that the coursework is about
 * (the engine) and to the adapter in front of it (the data layer). Enforcing it for `src/data` as well is
 * what stops `src/ui` typing `import { buildGraph } from '@/data/build-graph'` and quietly skipping the
 * barrel that exists so Phase 7's editor can swap the implementation.
 */
export const PUBLIC_BARRELS: readonly { readonly barrel: string; readonly home: string }[] = [
  { barrel: '@/engine', home: 'src/engine/' },
  { barrel: '@/data', home: 'src/data/' },
]

export const ENGINE_CONSUMERS_ALLOWED: readonly string[] = [
  'src/engine/', // internal
  'src/hooks/', // the bridge
  'src/data/', // adapters build engine-shaped graphs
  'src/test/', // the guard itself
]

/** Directory pairs that must exist for the "every module has a spec" rule. */
export const ENGINE_TESTED_DIRS: readonly string[] = [
  'src/engine/structures',
  // cp5: the seeded generator `npm run bench` and every sweep share. It joined this list rather than being left
  // unlisted because "no engine module without a spec" is the rule that makes sharing it safe — the benchmark's
  // graphs and the tests' graphs are the same code, so the code that draws them is under test like any other.
  'src/engine/testing',
  'src/engine/algorithms',
  'src/engine/routing',
  'src/engine/geo',
]
