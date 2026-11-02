/**
 * The one door the UI has to the algorithms.
 *
 * A component asks for a route and gets back a `RouteResult`; it never imports a search, never builds a
 * `GraphIndex`, and never learns that a heap is involved. That is what the architecture guard checks, and it is
 * the promise Phase 4 kept: the cost-profile resolver went behind this signature in cp1 and the LRU cache went
 * behind it in cp5, and `src/ui` changed by one badge. The signature grew one optional argument for the closure
 * set, which is the only growth the boundary predicted.
 *
 * Three primitive arguments rather than one request object, on purpose: a `{ from, to, algorithm }` literal is a
 * fresh identity every render, which would make the memo below fire every render too. The dependency list can
 * only compare what it is given, so the hook is given the things it can actually compare. `profile` is the
 * fourth of them, and it is a string for exactly that reason — a `CostProfile` object would undo the work.
 */
import { useMemo } from 'react'
import { NO_BLOCKED_EDGES, aStar, bfs, cachedSearch, dijkstra } from '@/engine'
import type { EdgeId, GraphIndex, NodeId, RouteResult, WeightProfile } from '@/engine'

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
  /**
   * Whether the answer on screen was remembered rather than recomputed. It is on the `RouteResult` too; this is
   * the same boolean lifted so a card built from hook state alone can still say where its number came from, and
   * `false` while nothing has been asked, which is the honest reading of "no answer, so nothing was cached".
   */
  readonly cached: boolean
  readonly from: NodeId
  readonly to: NodeId
}

/**
 * The search named by `algorithm`, on the cost function named by `profile`, with nothing in front of it.
 *
 * Exported for the two places that must not be answered from memory: the cache's own deep-equality sweep, which
 * compares a cached answer against the search it claims to remember, and `scripts/bench.mjs`, which is measuring
 * searches and would otherwise be timing a `Map` lookup.
 */
export function searchUncached(
  index: GraphIndex,
  from: NodeId,
  to: NodeId,
  algorithm: RouteAlgorithmChoice,
  profile: WeightProfile,
  blockedEdges: ReadonlySet<EdgeId> = NO_BLOCKED_EDGES,
): RouteResult {
  // Which search, picked here — the component says a name and gets that name's answer.
  if (algorithm === 'dijkstra') return dijkstra(index, from, to, { profile, blockedEdges })
  if (algorithm === 'bfs') return bfs(index, from, to, { profile, blockedEdges })
  return aStar(index, from, to, { profile, blockedEdges })
}

/**
 * The same call, behind the per-graph LRU (`algorithms/cache.ts`).
 *
 * Exported, because this is the one place in the app where a picker's string becomes a function call, and a
 * second copy of that switch is a second thing to keep honest: `useCompare` asks three searches the same question
 * and needs the guarantee that "the same question" is literally the same call. Both hooks get the cache from the
 * same line, which is why `RouteResult.cached` became true in cp5 without either hook knowing how a cache works —
 * and why a hit cannot be served to a query with a different profile or closure set: those are in the key that
 * this call builds and the engine owns.
 */
export function runSearch(
  index: GraphIndex,
  from: NodeId,
  to: NodeId,
  algorithm: RouteAlgorithmChoice,
  profile: WeightProfile,
  blockedEdges: ReadonlySet<EdgeId> = NO_BLOCKED_EDGES,
): RouteResult {
  return cachedSearch(index, { from, to, algorithm, options: { profile, blockedEdges } }, () =>
    searchUncached(index, from, to, algorithm, profile, blockedEdges),
  )
}

/**
 * Runs the chosen search over `index` and returns its result, plus the baseline it is quoted against.
 *
 * `profile` is the whole preference: `SearchRun` turns it into the objective (`routing/cost.ts`, a factor per
 * edge) and into the pace `minutes` is quoted at (`WALKING_SPEED_MPS`), and the result carries the name back.
 * Phase 3 left this hook with no profile at all, which was honest then — the shortest walk in metres is what
 * `profile: 'shortest'` means — and the seam was the point: adding a preference cost this file and a `<select>`.
 *
 * `blockedEdges` is the closure set — walkways the reader has decided are shut — and it reaches both the search
 * and the cache key from this one call, which is the order that makes it safe: an answer remembered under one
 * closure set is never served to another. Phase 6 gives it a UI, from the articulation-point report; until then
 * the app passes nothing, and "nothing is closed" is what the key says rather than a missing field.
 */
export function useRoute(
  index: GraphIndex | null,
  from: NodeId,
  to: NodeId,
  algorithm: RouteAlgorithmChoice,
  profile: WeightProfile = 'shortest',
  blockedEdges: ReadonlySet<EdgeId> = NO_BLOCKED_EDGES,
): RouteHookState {
  const { result, baseline } = useMemo(() => {
    if (index === null || from === '' || to === '') return { result: null, baseline: null } as const
    const answer = runSearch(index, from, to, algorithm, profile, blockedEdges)
    if (profile === 'shortest') return { result: answer, baseline: null } as const
    // The baseline is the second search behind every non-default preference, and it is nearly free here for a
    // reason the doc on `RouteHookState.baseline` has claimed since cp2: the same query on `shortest` is already
    // in the cache from the last time the reader touched the knob. `cost-profiles.spec.ts` measures that claim
    // rather than leaving it as a comment, because a comment about a cache is a wish.
    return {
      result: answer,
      baseline: runSearch(index, from, to, algorithm, 'shortest', blockedEdges),
    } as const
  }, [index, from, to, algorithm, profile, blockedEdges])

  const asked = index !== null && from !== '' && to !== ''
  return {
    result,
    baseline,
    algorithm: asked ? algorithm : null,
    profile: asked ? profile : null,
    cached: result?.cached ?? false,
    from,
    to,
  }
}
