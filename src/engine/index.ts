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
 * Phase 1 ships `structures/`, Phase 3 ships `algorithms/` and `geo/`, and `routing/` (Phase 4) will consume
 * both through *this* file: a hook may import `@/engine` and nothing else, which is what keeps a UI refactor
 * from discovering deep import paths. Note what a search takes — a `GraphIndex`, never a `CampusModel`: the
 * engine's only window onto a campus is vertices, edges and numbers.
 */

export type * from './types'
export {
  COST_EPSILON,
  DEFAULT_EDGE_ATTRIBUTES,
  ENGINE_VERSION,
  MIN_INSTRUCTION_METRES,
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

// --- Phase 3: graph searches, and the geometry they stand on -----------------------------------------
// The three searches share one run object (`algorithms/search-common.ts`), which is why its *option* types
// are published and the run itself is not: a caller steers a search, it does not drive its maps.
export { dijkstra } from './algorithms/dijkstra'
export { aStar, type AStarOptions } from './algorithms/a-star'
export { bfs } from './algorithms/bfs'
export {
  articulationPoints,
  dfs,
  depthFirstRoute,
  reachableFrom,
  type DfsOptions,
  type DfsTree,
  type DfsVisit,
  type Resilience,
} from './algorithms/dfs'
export {
  minutesFor,
  type Expansion,
  type Offer,
  type RouteSearchOptions,
  type SettledVertex,
} from './algorithms/search-common'
export {
  SHARP_WITHIN_DEGREES,
  SLIGHT_WITHIN_DEGREES,
  STRAIGHT_WITHIN_DEGREES,
  routeLegs,
  simplifyLegs,
  stepsFromLegs,
  stepsReplay,
  turnDirectionFor,
  type RouteLeg,
} from './algorithms/path-utils'
export {
  COMPASS_POINTS,
  compassOf,
  euclidean,
  euclideanHeuristic,
  minCostPerUnit,
  turnBetween,
  type CompassPoint,
  type CostScaleOptions,
} from './geo/measure'
export {
  CROWD_PENALTY_AT_FULL_CONGESTION,
  LIT_BONUS,
  NOT_STEP_FREE_PENALTY,
  PROFILES,
  PROFILE_ORDER,
  ROUGH_SURFACE_PENALTY,
  SHADED_BONUS,
  SLOPE_FACTOR_PER_GRADE,
  STAIRS_PENALTY,
  UNLIT_PENALTY,
  UNSHADED_PENALTY,
  costFor,
  factorFor,
  type ProfileDefinition,
} from './routing/cost'
