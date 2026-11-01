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
 * Phase 0 ships the contract only: `types.ts` and `constants.ts`. The
 * structures arrive in Phase 1, the algorithms in Phase 3.
 */

export type * from './types'
export {
  COST_EPSILON,
  DEFAULT_EDGE_ATTRIBUTES,
  ENGINE_VERSION,
  MIN_SEGMENT_METRES,
  WALKING_SPEED_MPS,
} from './constants'
