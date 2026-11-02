/**
 * Breadth-first search — the fewest walkways, whatever they are made of.
 *
 * **The invariant.** When vertex `v` is dequeued, `depth[v]` is the minimum number of edges from the origin
 * to `v`, and every vertex still in the queue has depth ≥ that. Both halves come from the queue being FIFO:
 * depth is non-decreasing along it, so a shorter route to `v` would already have been taken out. This is
 * *not* a statement about length: with a 250 m diagonal and a 200 m two-segment way round, BFS takes the
 * diagonal, and `bfs.spec.ts` pins that on the square fixture so nobody has to re-derive it under pressure.
 *
 * **Complexity.** O(V + E), no heap, no log. That is why it is here: it is the only search in the app whose
 * running time does not depend on the cost function at all, which makes it the right tool for the questions
 * that are really about *reachability and hops* — Phase 5's explored-region overlay, Phase 6's "what is
 * stranded if this gate closes", and `k`-hop neighbourhoods.
 *
 * **What `cost` does here.** It cannot reorder anything — the queue decides that — but it is still read on
 * every relaxation, for two reasons. `Infinity` is how a cost profile closes an edge, so a step-free profile
 * genuinely changes which routes BFS can see: the answer is "fewest walkways *among the allowed ones*". And
 * a profile that returns `0`/`NaN` is reported as `invalid-graph` exactly as the heap searches report it,
 * which is the shared-ladder claim in `search-common.ts` made visible.
 */
import { SearchRun, type RouteSearchOptions } from './search-common'
import type { GraphIndex, NodeId, RouteResult } from '../types'

/**
 * Hop-shortest path from `from` to `to`.
 *
 * The result's `cost` is the hop count, because that is the quantity this search minimises; `metres` stays
 * the length of the route actually chosen. Two algorithms whose `cost` means different things is deliberate —
 * `cost` means "what this search was minimising", never "metres", and that is why `RouteFound` carries
 * `metres` at all.
 */
export function bfs(index: GraphIndex, from: NodeId, to: NodeId, options: RouteSearchOptions = {}): RouteResult {
  const run = new SearchRun(index, from, to, 'bfs', options)
  const refusal = run.checkEndpoints()
  if (refusal !== null) return refusal

  run.offer({ id: from, via: null, edgeId: null, priority: 0, cost: 0, metres: 0 })
  for (;;) {
    const settled = run.next()
    if (settled === null) return run.exhausted()
    if (settled.id === to) return run.found(settled)
    const expansion = run.expand(settled)
    if (expansion.badCost !== undefined) return run.refusedCost(expansion.badCost)
    for (const offer of expansion.offers) run.offer({ ...offer, priority: offer.cost })
  }
}
