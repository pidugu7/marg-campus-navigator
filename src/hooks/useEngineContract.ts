import { useMemo } from 'react'
import { COST_EPSILON, ENGINE_VERSION, MIN_SEGMENT_METRES } from '@/engine'

export interface EngineContract {
  readonly version: string
  readonly costEpsilon: number
  readonly minSegmentMetres: number
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
    }),
    [],
  )
}
