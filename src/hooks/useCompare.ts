/**
 * The three searches, run together, once.
 *
 * Compare mode is a question about *the same* request: three algorithms, one pair, one preference, one graph. So
 * the hook calls the same `runSearch` the card's search goes through — the one place a name becomes a function —
 * and any difference in the table has to come from the algorithm, because nothing else varies.
 *
 * `enabled` gates the work rather than hiding it. Three searches is three times the searching, and a reader who
 * never opens compare should never pay for it; a hidden-but-running comparison would also make the toggle a lie.
 *
 * No cache here yet: that is cp5's, and its key is exactly this hook's argument list — `(from, to, algorithm,
 * profile, blocked)` — which is why the arguments are primitives and why `runSearch` is called with nothing else.
 */
import { useMemo } from 'react'
import { COMPARE_ORDER } from '@/ui/compare/compare-plan'
import type { CompareRow } from '@/ui/compare/compare-plan'
import { runSearch } from './useRoute'
import type { RouteAlgorithmChoice } from './useRoute'
import type { GraphIndex, NodeId, RouteResult, WeightProfile } from '@/engine'

export interface CompareState {
  /** Empty when nothing was asked or the toggle is off, which is how the map knows to draw no overlay. */
  readonly rows: readonly CompareRow[]
  readonly active: boolean
}

/** One search's answer, narrowed to the five numbers a row carries. */
function rowOf(algorithm: RouteAlgorithmChoice, result: RouteResult): CompareRow {
  if (!result.ok) {
    return {
      algorithm,
      found: false,
      cost: 0,
      metres: 0,
      minutes: 0,
      expanded: result.expanded,
      ms: result.ms,
      segments: 0,
      nodeIds: [],
    }
  }
  return {
    algorithm,
    found: true,
    cost: result.cost,
    metres: result.metres,
    minutes: result.minutes,
    expanded: result.expanded,
    ms: result.ms,
    segments: result.hops,
    nodeIds: result.nodeIds,
  }
}

export function useCompare(
  index: GraphIndex | null,
  from: NodeId,
  to: NodeId,
  profile: WeightProfile,
  enabled: boolean,
): CompareState {
  const rows = useMemo(() => {
    if (!enabled || index === null || from === '' || to === '') return [] as const
    return COMPARE_ORDER.map((algorithm) => rowOf(algorithm, runSearch(index, from, to, algorithm, profile)))
  }, [index, from, to, profile, enabled])
  return { rows, active: rows.length > 0 }
}
