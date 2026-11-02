import { useMemo } from 'react'
import { COST_EPSILON, ENGINE_VERSION, MIN_INSTRUCTION_METRES, MIN_SEGMENT_METRES, PROFILES, PROFILE_ORDER, WALKING_SPEED_MPS } from '@/engine'

export interface EngineContract {
  readonly version: string
  readonly costEpsilon: number
  readonly minSegmentMetres: number
  /**
   * The pace each profile quotes `minutes` at, keyed by profile name exactly as the engine keys it — so a card
   * can print the number's units honestly (`18.1 min at 1.4 m/s`) without importing the constant. The record is
   * total over the profile union, which is what lets that lookup answer a `number` instead of a `number |
   * undefined`, and is why this hands the table out rather than a single average.
   */
  readonly walkingSpeedMps: typeof WALKING_SPEED_MPS
  /** Below this, a leg is folded into its neighbour rather than given a sentence of its own. */
  readonly minInstructionMetres: number
  /**
   * The five cost profiles, exactly as the engine defines them: label, blurb and factor for the picker and the
   * result card. Handed out rather than copied, because a preference's wording is a fact about the profile, and
   * a UI that invented its own "Shaded walk" would be free to claim the shaded route is shorter.
   */
  readonly profiles: typeof PROFILES
  /** The order the picker lists them in — the baseline first. */
  readonly profileOrder: typeof PROFILE_ORDER
}

/**
 * The sanctioned way for React to learn anything about the engine: a hook,
 * importing the barrel. Components import this, never `@/engine`.
 *
 * It exists in Phase 0 so the boundary is demonstrated by working code rather
 * than by an empty folder and a promise.
 */
export function useEngineContract(): EngineContract {
  return useMemo(
    () => ({
      version: ENGINE_VERSION,
      costEpsilon: COST_EPSILON,
      minSegmentMetres: MIN_SEGMENT_METRES,
      minInstructionMetres: MIN_INSTRUCTION_METRES,
      walkingSpeedMps: WALKING_SPEED_MPS,
      profiles: PROFILES,
      profileOrder: PROFILE_ORDER,
    }),
    [],
  )
}
