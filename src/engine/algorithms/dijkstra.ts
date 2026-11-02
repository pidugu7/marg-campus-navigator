/**
 * Dijkstra — the exact weighted shortest path, and the baseline every other search in this folder is judged
 * against.
 *
 * **The invariant.** `#explored` is always, at every moment, a set of vertices whose cost is final. Cost
 * never decreases as the search grows: each vertex drawn off the frontier has the cheapest cost of anything
 * still on it, so no future route can undercut it — and that is only true because every cost is `> 0`. A
 * profile that priced one edge at zero would break it, which is why {@link SearchRun.expand} refuses such a
 * cost instead of routing around it, and why `validateGraph` has a `non-positive-cost` code of its own.
 *
 * **Complexity.** O((V + E) log V) with this binary heap and lazy deletion: at most one heap entry per
 * *successful relaxation*, so E pushes and E pops in the worst case, each O(log E) ⊆ O(log V + log E).
 * Memory O(V) for the records plus O(E) for the stale entries the heap is holding until they are skipped.
 *
 * **Why lazy deletion, again, here.** An indexed heap with `decreaseKey` keeps the heap at O(V) and needs a
 * position map maintained inside every push, pop and swap. `MinHeap` is a pure comparator container, shared
 * unchanged with A* and (as a queue) with BFS, so the cost of that simplicity is paid where it is cheap:
 * two lines on the way out of the frontier, and a duplication factor Phase 4 measures rather than argues
 * about.
 *
 * **The whole of it, in one expression.** Dijkstra offers each neighbour at priority `cost`; A* offers the
 * same neighbour at `cost + h(neighbour)`. Nothing else in the two files differs, which is the cleanest way
 * to show what a heuristic is *for*.
 */
import { SearchRun, type RouteSearchOptions } from './search-common'
import type { GraphIndex, NodeId, RouteResult } from '../types'

/**
 * Shortest path by accumulated cost, from `from` to `to`.
 *
 * @param index the sealed adjacency view — read-only, never copied, never mutated
 * @param from origin vertex id
 * @param to destination vertex id
 * @param options cost function, closed walkways, profile for the quoted pace, trace, clock
 * @returns a `RouteResult`; "no route" is a value here (`disconnected`, `unknown-origin`, …), never a throw,
 *   because a campus with an unreachable annexe is a fact about the map and not an exception in a render
 */
export function dijkstra(
  index: GraphIndex,
  from: NodeId,
  to: NodeId,
  options: RouteSearchOptions = {},
): RouteResult {
  const run = new SearchRun(index, from, to, 'dijkstra', options)
  const refusal = run.checkEndpoints()
  if (refusal !== null) return refusal

  run.offer({ id: from, via: null, edgeId: null, priority: 0, cost: 0, metres: 0 })
  for (;;) {
    const settled = run.next()
    if (settled === null) return run.exhausted()
    // Settled means final, so the first time the destination appears it can be returned. Draining the rest
    // of the heap would compute the same answer and report a larger `expanded`, which would make the A*
    // comparison in `a-star.spec.ts` a measurement of the wrong thing.
    if (settled.id === to) return run.found(settled)
    const expansion = run.expand(settled)
    if (expansion.badCost !== undefined) return run.refusedCost(expansion.badCost)
    for (const offer of expansion.offers) run.offer({ ...offer, priority: offer.cost })
  }
}
