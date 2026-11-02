/**
 * The one door the UI has to the algorithms.
 *
 * A component asks for a route and gets back a `RouteResult`; it never imports a search, never builds a
 * `GraphIndex`, and never learns that a heap is involved. That is what the architecture guard checks, and it is
 * the reason Phase 4 can put an LRU cache and a cost-profile resolver behind this same signature without a
 * single change in `src/ui`.
 *
 * Three primitive arguments rather than one request object, on purpose: a `{ from, to, algorithm }` literal is a
 * fresh identity every render, which would make the memo below fire every render too. The dependency list can
 * only compare what it is given, so the hook is given the things it can actually compare. `profile` is the
 * fourth of them, and it is a string for exactly that reason — a `CostProfile` object would undo the work.
 */
import { useMemo } from 'react'
import { aStar, bfs, dijkstra } from '@/engine'
import type { GraphIndex, NodeId, RouteResult, WeightProfile } from '@/engine'

/** The three names the picker offers. Depth-first is in the engine and not here: it answers "is there a way",
 *  not "what is the way", and a card that quietly shows a 1.5 km detour as if it were a finding would be a
 *  worse teacher than no fourth option. */
export type RouteAlgorithmChoice = 'dijkstra' | 'a-star' | 'bfs'

export interface RouteHookState {
  /** `null` while either picker is empty — nothing was asked, so nothing was answered. */
  readonly result: RouteResult | null
  /**
   * The same query on the same algorithm with no preference at all — `shortest`, whose cost is metres. `null`
   * when that *is* what was asked, so a card never prints "0 m against itself".
   *
   * Computed here rather than subtracted in a component because the two searches are one question asked twice:
   * a Δ that is not measured on the same graph with the same closure set is not a Δ. It is also nearly free, and
   * for a reason the UI should not have to care about — Phase 4's cache keys on
   * `(from, to, algorithm, profile, blocked)`, so switching from `shaded` to `lit` re-runs one search and reads
   * the other.
   */
  readonly baseline: RouteResult | null
  /** Echoed back so a card can label a number with the method that produced it. */
  readonly algorithm: RouteAlgorithmChoice | null
  /** The preference the answer is priced under, or `null` when nothing was asked. */
  readonly profile: WeightProfile | null
  readonly from: NodeId
  readonly to: NodeId
}

/** The search named by `algorithm`, on the cost function named by `profile`. */
function run(
  index: GraphIndex,
  from: NodeId,
  to: NodeId,
  algorithm: RouteAlgorithmChoice,
  profile: WeightProfile,
): RouteResult {
  // Which search, picked here — the component says a name and gets that name's answer.
  if (algorithm === 'dijkstra') return dijkstra(index, from, to, { profile })
  if (algorithm === 'bfs') return bfs(index, from, to, { profile })
  return aStar(index, from, to, { profile })
}

/**
 * Runs the chosen search over `index` and returns its result, plus the baseline it is quoted against.
 *
 * `profile` is the whole preference: `SearchRun` turns it into the objective (`routing/cost.ts`, a factor per
 * edge) and into the pace `minutes` is quoted at (`WALKING_SPEED_MPS`), and the result carries the name back.
 * Phase 3 left this hook with no profile at all, which was honest then — the shortest walk in metres is what
 * `profile: 'shortest'` means — and the seam was the point: adding a preference cost this file and a `<select>`.
 *
 * No closure set reaches the search yet. That is Phase 6's resilience work, and it arrives as a fifth option to
 * the same call, which is also what will make it a cache key.
 */
export function useRoute(
  index: GraphIndex | null,
  from: NodeId,
  to: NodeId,
  algorithm: RouteAlgorithmChoice,
  profile: WeightProfile = 'shortest',
): RouteHookState {
  const { result, baseline } = useMemo(() => {
    if (index === null || from === '' || to === '') return { result: null, baseline: null } as const
    const answer = run(index, from, to, algorithm, profile)
    if (profile === 'shortest') return { result: answer, baseline: null } as const
    return { result: answer, baseline: run(index, from, to, algorithm, 'shortest') } as const
  }, [index, from, to, algorithm, profile])

  const asked = index !== null && from !== '' && to !== ''
  return {
    result,
    baseline,
    algorithm: asked ? algorithm : null,
    profile: asked ? profile : null,
    from,
    to,
  }
}
