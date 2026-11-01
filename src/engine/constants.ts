import type { EdgeAttributes } from './types'

/**
 * Single source of truth for the numbers the engine treats as invariants.
 * Kept out of `types.ts` so that file stays type-only (and erasable).
 */

/**
 * Version of the engine's public surface, not of the app. Bumped only when
 * `src/engine/index.ts` changes shape, so a failing boundary check points at
 * the contract rather than at UI churn.
 */
export const ENGINE_VERSION = '0.2.0-phase1.structures' as const

/** Below this, two waypoints are the same place for path-simplification purposes. */
export const MIN_SEGMENT_METRES = 0.5

/** Tolerance for comparing path costs from two different algorithms. */
export const COST_EPSILON = 1e-6

/** Assumed pedestrian pace per profile, in metres/second. */
export const WALKING_SPEED_MPS: Record<string, number> = {
  fastest: 1.4,
  shaded: 1.25,
  'step-free': 1.15,
  quiet: 1.3,
}

export const DEFAULT_EDGE_ATTRIBUTES: EdgeAttributes = {
  stairs: false,
  stepFree: true,
  shaded: false,
  lit: true,
  crowd: 0.2,
  surface: 'paved',
  slope: 0,
}
