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
 * The cache arrives through `runSearch`, so it arrives here for free and with the same key as the card's query:
 * `(from, to, algorithm, profile, blocked)`. That identity is the point of the last paragraph of cp3's note —
 * three algorithms and one pair is one question asked three ways, and the answers are cached three ways too.
 */
import { useMemo } from 'react'
import { NO_BLOCKED_EDGES } from '@/engine'
import { COMPARE_ORDER } from '@/ui/compare/compare-plan'
import type { CompareRow } from '@/ui/compare/compare-plan'
import { runSearch } from './useRoute'
import type { RouteAlgorithmChoice } from './useRoute'
import type { EdgeId, GraphIndex, NodeId, RouteResult, WeightProfile } from '@/engine'

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
  blockedEdges: ReadonlySet<EdgeId> = NO_BLOCKED_EDGES,
): CompareState {
  const rows = useMemo(() => {
    if (!enabled || index === null || from === '' || to === '') return [] as const
    // Three questions, three cache lookups. Toggling compare off and on again is the commonest way this hook
    // runs twice, and the second time every row is served from the entries the card filled — which is the one
    // case where "compare three searches" is free rather than three times the work, and the reason the answer's
    // `cached` flag is worth keeping on the row rather than dropping with the rest of the metrics.
    return COMPARE_ORDER.map((algorithm) =>
      rowOf(algorithm, runSearch(index, from, to, algorithm, profile, blockedEdges)),
    )
  }, [index, from, to, profile, enabled, blockedEdges])
  return { rows, active: rows.length > 0 }
}
