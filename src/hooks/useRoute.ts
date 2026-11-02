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
 * only compare what it is given, so the hook is given the things it can actually compare.
 */
import { useMemo } from 'react'
import { aStar, bfs, dijkstra } from '@/engine'
import type { GraphIndex, NodeId, RouteResult } from '@/engine'

/** The three names the picker offers. Depth-first is in the engine and not here: it answers "is there a way",
 *  not "what is the way", and a card that quietly shows a 1.5 km detour as if it were a finding would be a
 *  worse teacher than no fourth option. */
export type RouteAlgorithmChoice = 'dijkstra' | 'a-star' | 'bfs'

export interface RouteHookState {
  /** `null` while either picker is empty — nothing was asked, so nothing was answered. */
  readonly result: RouteResult | null
  /** Echoed back so a card can label a number with the method that produced it. */
  readonly algorithm: RouteAlgorithmChoice | null
  readonly from: NodeId
  readonly to: NodeId
}

/**
 * Runs the chosen search over `index` and returns its result.
 *
 * No profile and no closures reach the search yet: Phase 3 asks the map for the shortest walk in metres, which
 * is what the options' own defaults answer — `profile: 'fastest'` (a label and a pace for `minutes`, nothing
 * that reweights an edge) and `cost` left to `defaultCost`, which is the edge's `metres`. The shaded-at-noon and
 * step-free profiles are Phase 4's, and they belong in this file rather than in a component for exactly the
 * reason the guard exists.
 */
export function useRoute(
  index: GraphIndex | null,
  from: NodeId,
  to: NodeId,
  algorithm: RouteAlgorithmChoice,
): RouteHookState {
  const result = useMemo<RouteResult | null>(() => {
    if (index === null || from === '' || to === '') return null
    // Which search, picked here — the component says a name and gets that name's answer.
    if (algorithm === 'dijkstra') return dijkstra(index, from, to)
    if (algorithm === 'bfs') return bfs(index, from, to)
    return aStar(index, from, to)
  }, [index, from, to, algorithm])

  const asked = index !== null && from !== '' && to !== ''
  return { result, algorithm: asked ? algorithm : null, from, to }
}
