/**
 * src/engine — the algorithms layer.
 *
 * This file is the ONLY public entry point. UI code may import `@/engine`
 * (through a hook, never directly); nothing here may import React, the DOM, or
 * anything from `src/data`, `src/ui`, `src/hooks` or `src/state`. The guard is
 * executable: `npm test -- architecture`.
 *
 * Layout, and what each directory owes the rest:
 *   structures/   hand-written data structures. No algorithms. No I/O.
 *   algorithms/   graph algorithms that consume structures + `types.ts`.
 *   routing/      the service layer: picks an algorithm, applies a cost
 *                 profile, caches results. The only part with policy.
 *   geo/          pure geometry used for weights, heuristics and snapping.
 *
 * Phase 1 ships the five data structures in `structures/`. `algorithms/` (Phase 3) and
 * `routing/` (Phase 4) will consume them through *this* file: a hook may import `@/engine`
 * and nothing else, which is what keeps a UI refactor from discovering deep import paths.
 */

export type * from './types'
export {
  COST_EPSILON,
  DEFAULT_EDGE_ATTRIBUTES,
  ENGINE_VERSION,
  MIN_SEGMENT_METRES,
  WALKING_SPEED_MPS,
} from './constants'

// --- Phase 1: hand-written structures ---------------------------------------------------------
// Each export is the whole public surface of that module: if the UI or an algorithm needs
// something not listed here, the structure is missing an API rather than the barrel needing a
// wildcard.
export {
  MinHeap,
  byPriority,
  type HeapComparator,
  type HeapEntry,
  type HeapOperations,
  type HeapViolation,
} from './structures/min-heap'
export {
  Trie,
  compareMatches,
  normaliseWord,
  type TrieMatch,
  type TrieNode,
  type TrieRecord,
} from './structures/trie'
export {
  UnionFind,
  buildComponents,
  type BuildComponentsOptions,
  type GraphComponents,
  type UnionFindStats,
} from './structures/union-find'
export { LRUCache, type LRUCacheEntry, type LRUCacheStats } from './structures/lru-cache'
export {
  AdjacencyGraph,
  createGraph,
  validateGraph,
  type CreateGraphOptions,
  type EdgeInput,
  type NodeInput,
  type ValidateGraphOptions,
} from './structures/graph'
