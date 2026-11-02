import type { EdgeAttributes, WeightProfile } from './types'

/**
 * Single source of truth for the numbers the engine treats as invariants.
 * Kept out of `types.ts` so that file stays type-only (and erasable).
 */

/**
 * Version of the engine's public surface, not of the app. Bumped only when
 * `src/engine/index.ts` changes shape, so a failing boundary check points at
 * the contract rather than at UI churn. `0.3.0` opens `algorithms/` and `geo/`.
 */
export const ENGINE_VERSION = '0.3.0-phase3.algorithms' as const

/** Below this, two waypoints are the same place for path-simplification purposes. */
export const MIN_SEGMENT_METRES = 0.5

/**
 * Below this, a leg is not worth a sentence of its own — see `simplifyLegs`. 20 m is fourteen seconds at the
 * `shortest` pace: short enough that reading a turn instruction for it costs more attention than making the
 * turn costs feet. Pinned from both sides of the boundary in `path-utils.spec.ts`, because a threshold that
 * nobody can measure the edge of is a preference dressed as a constant.
 */
export const MIN_INSTRUCTION_METRES = 20

/** Tolerance for comparing path costs from two different algorithms. */
export const COST_EPSILON = 1e-6

/**
 * Assumed pedestrian pace per profile, in metres/second.
 *
 * Keyed by `WeightProfile` rather than `string` so the lookup is total: `WALKING_SPEED_MPS[profile]` is a
 * `number`, not a `number | undefined`, which is what lets `minutes` be computed without a `?? 1.4`
 * fallback the type system already knows is unreachable. A new profile is a compile error here until it
 * has a pace, instead of a silent 1.4 m/s.
 */
/**
 * The five paces, one per profile. Each is an assumption about how *that* kind of route gets walked — a
 * family with a pram in shade, a student crossing the campus at night, someone in a wheelchair over ramps and
 * kerbs — and each is a label, not an input: no cost function reads this table, and `routing/cost.ts`'s
 * factors never mention minutes. Keyed by the union so a new profile is a compile error here rather than a
 * silent 1.4.
 */
export const WALKING_SPEED_MPS: Readonly<Record<WeightProfile, number>> = {
  shortest: 1.4,
  shaded: 1.3,
  lit: 1.25,
  'step-free': 1.05,
  quiet: 1.35,
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
