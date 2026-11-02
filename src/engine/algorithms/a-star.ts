/**
 * A* — Dijkstra with an opinion about which direction to look in.
 *
 * **The invariant.** Everything Dijkstra's invariant says still holds here, with `cost` replaced by `cost +
 * h`: a vertex is settled only once its *estimate of the total* is the smallest on the frontier, which is
 * enough to prove optimality if and only if `h` never overestimates. That "if and only if" is the whole
 * algorithm: admissibility is not a performance property, it is a correctness one, and `a-star.spec.ts`
 * measures it against Bellman-Ford rather than trusting the formula.
 *
 * **Complexity.** Same O((V + E) log V) worst case as Dijkstra — a bad heuristic cannot make it *slower*
 * asymptotically, only wasteful. What an admissible, consistent `h` buys is the constant: the number of
 * settled vertices falls to roughly the vertices whose estimate is below the final cost, and on a campus that
 * is a corridor rather than a circle. The docs' claim is that A* settles **fewer or equal** vertices for the
 * same pair, and `src/test/campus-routing.spec.ts` is what holds the phase to it on the real data.
 *
 * **Where the estimate comes from.** `geo/measure.ts`, not from a metres-per-unit constant: the engine cannot
 * see `canvas.pixelsPerMetre` (that is `src/data`'s fact), so the scale is measured from the graph — the
 * cheapest cost per drawn unit among the edges this run may traverse. Which also means the estimate follows
 * the closure set, and stays admissible when walkways are blocked.
 */
import { SearchRun, type RouteSearchOptions } from './search-common'
import { euclideanHeuristic } from '../geo/measure'
import type { GraphIndex, Heuristic, NodeId, RouteResult } from '../types'

/** {@link RouteSearchOptions}, plus the estimate. */
export interface AStarOptions extends RouteSearchOptions {
  /**
   * `f = g + h`'s `h`. Left out, A* measures the map itself ({@link euclideanHeuristic}); supplied, it is
   * used exactly as given, which is how the inadmissible case in the specs is produced without touching the
   * default. A heuristic that overestimates is not rejected here: `Heuristic`'s contract is a comment and a
   * test, not a runtime check, because nothing in one call can tell whether a function is a lower bound.
   */
  readonly heuristic?: Heuristic
}

/**
 * Shortest path by `cost + estimate`, from `from` to `to`.
 *
 * @returns a `RouteResult`, never a throw — including when the index cannot place a vertex named by its own
 *   adjacency, where the estimate falls back to `0` and the search quietly becomes Dijkstra instead of
 *   producing `NaN` priorities that a heap cannot order.
 */
export function aStar(index: GraphIndex, from: NodeId, to: NodeId, options: AStarOptions = {}): RouteResult {
  const run = new SearchRun(index, from, to, 'a-star', options)
  const refusal = run.checkEndpoints()
  if (refusal !== null) return refusal

  // The cost comes from the run, not from `options`, because they are not the same thing: a request with only
  // a profile has no `options.cost` at all, yet prices its edges with that profile's factors. Reading
  // `options.cost` here used to scale the estimate by metres while the search minimised something else, and the
  // result was an inadmissible `h` that stopped at the goal one expansion too early. `cost.spec.ts` pins it.
  //
  // `exactOptionalPropertyTypes` means `blockedEdges` is built conditionally rather than passed through as
  // `undefined`, which is the right outcome: `minCostPerUnit` distinguishes "no closure set" from "a set that
  // happens to contain this id", and so does the object literal.
  const estimate =
    options.heuristic ??
    euclideanHeuristic(index, {
      cost: run.cost,
      ...(options.blockedEdges === undefined ? {} : { blockedEdges: options.blockedEdges }),
    })
  const target = index.node(to)
  const h = (id: NodeId): number => {
    const here = index.node(id)
    // Either side can be placeable-or-not for *any* `GraphIndex`, so the fallback is the algorithm's
    // behaviour, not a guard: no estimate, `0`, which is the admissible bound that costs nothing.
    return here === undefined || target === undefined ? 0 : estimate(here, target)
  }

  run.offer({ id: from, via: null, edgeId: null, priority: h(from), cost: 0, metres: 0 })
  for (;;) {
    const settled = run.next()
    if (settled === null) return run.exhausted()
    // Legal to stop here only because the heuristic is consistent: `f` is non-decreasing along the frontier,
    // so nothing still unexplored can come in under the cost just found. With an inadmissible estimate this
    // line is precisely where the wrong answer is returned — and the specs prove that too.
    if (settled.id === to) return run.found(settled)
    const expansion = run.expand(settled)
    if (expansion.badCost !== undefined) return run.refusedCost(expansion.badCost)
    for (const offer of expansion.offers) run.offer({ ...offer, priority: offer.cost + h(offer.id) })
  }
}
