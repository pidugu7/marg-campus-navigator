/**
 * The only geometry the engine needs, and the reason A* is allowed to be fast here at all.
 *
 * Two facts are in tension: a route's cost is measured in *weighted metres* while a map's coordinates are
 * in *world units*, and the conversion factor (`canvas.pixelsPerMetre`) belongs to `src/data`, which the
 * engine may not import. A heuristic written as `Math.hypot(dx, dy)` would therefore be wrong by whatever
 * that factor is — and a heuristic that is wrong by a constant multiple is not a heuristic, it is a
 * coin-flip on whether the route you get is the shortest one.
 *
 * So the scale is *measured from the graph* instead of being passed in: {@link minCostPerUnit} finds the
 * cheapest cost per unit of drawn length that the search is allowed to traverse, and the heuristic
 * multiplies straight-line length by exactly that. Both halves of that sentence are what the specs pin.
 *
 * Angles are degrees. The map's +y axis points **down**, so `north` is `−y`: any compass word in this file
 * is a word about the ground, not about the screen, and `turnBetween` returns positive for a right turn
 * because that is what a walker reading a directions list needs.
 */
import type { EdgeCost, EdgeId, GraphIndex, Heuristic, Point } from '../types'

/** Eight compass points, indexed from north and stepping clockwise. */
export const COMPASS_POINTS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
] as const

export type CompassPoint = (typeof COMPASS_POINTS)[number]

/** Straight-line distance between two map coordinates, in whatever units the map draws with. */
export function euclidean(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/**
 * The compass point a walker is facing when they go from `from` to `to`.
 *
 * `Math.round(heading / 45)` picks the nearest of eight, and `% 8` after the division rather than after the
 * rounding is what keeps 359° from becoming `COMPASS_POINTS[8]` — `undefined`, and then a directions list
 * that says "Head undefined".
 */
export function compassOf(from: Point, to: Point): CompassPoint {
  const heading = normalise360((Math.atan2(to.x - from.x, from.y - to.y) * 180) / Math.PI)
  return COMPASS_POINTS[Math.round(heading / 45) % 8] as CompassPoint
}

/**
 * Signed turn at `via`, in degrees, **positive to the right** — the walker's right.
 *
 * Computed from the cross and dot products of the incoming and outgoing vectors rather than from two
 * `atan2` bearings and a subtraction, because the latter needs a wrap-around branch and this does not:
 * `atan2` already returns one value per pair of directions, so 350° → 10° is −20° with no special case.
 * The result is in `(-180, 180]`; exactly `180` is a U-turn, and `0` means the vertex is not worth
 * telling anybody about.
 */
export function turnBetween(from: Point, via: Point, to: Point): number {
  const inX = via.x - from.x
  const inY = via.y - from.y
  const outX = to.x - via.x
  const outY = to.y - via.y
  return (Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY) * 180) / Math.PI
}

const normalise360 = (degrees: number): number => ((degrees % 360) + 360) % 360

/** {@link minCostPerUnit}'s inputs — the same two the search itself is given, so scale and search agree. */
export interface CostScaleOptions {
  readonly cost?: EdgeCost
  /** Closed for this query. Excluded from the minimum, which is what lets the heuristic stay admissible
   *  while being sharper than a graph-wide lower bound. */
  readonly blockedEdges?: ReadonlySet<EdgeId>
}

/**
 * The least cost per unit of drawn length among the edges a search could actually traverse.
 *
 * Admissibility proof, in one line each: every stored edge costs at least `k × its own length` (that is how
 * `k` is defined, as a minimum over those very edges); any route from A to B is a chain of such edges, so
 * it costs at least `k × (total length of the chain)`; and a chain's total length is at least the
 * straight-line length A→B, by the triangle inequality. Hence `k × euclidean(A, B)` never exceeds the true
 * cost, which is exactly what {@link Heuristic} is required to guarantee.
 *
 * Two edges can be *parallel* in this data (two walkways between the same pair of vertices) and one can be
 * much shorter in metres than the line drawn between the nodes: `metres` is authored, coordinates are
 * traced, and `build-graph.ts` only warns if they disagree by more than 15%. Measuring `k` over the ratio
 * instead of assuming 1 metre per unit is what survives that.
 *
 * A zero-length edge would divide by zero, so it is skipped — and a skipped edge cannot undercut the bound,
 * because an edge with no drawn length adds nothing to any chain's total length. `k` is `0` when no edge
 * qualifies (an empty graph, or one where every cost is non-finite), which degrades the heuristic to
 * Dijkstra rather than producing a `NaN`.
 */
export function minCostPerUnit(index: GraphIndex, options: CostScaleOptions = {}): number {
  const { cost = (edge) => edge.metres, blockedEdges } = options
  let best = Number.POSITIVE_INFINITY
  for (const edge of index.graph.edges) {
    // No direction filter here: a one-way edge still costs something, and the search can traverse it in
    // the direction it points, so it belongs in the minimum either way.
    if (blockedEdges?.has(edge.id) === true) continue
    const from = index.node(edge.from)
    const to = index.node(edge.to)
    if (from === undefined || to === undefined) continue
    const length = euclidean(from, to)
    if (!(length > 0)) continue
    const value = cost(edge)
    // `Number.isFinite` rather than `> 0`: a profile closes an edge by returning Infinity, and that edge
    // must not set the price of every metre on the campus.
    if (!Number.isFinite(value) || value <= 0) continue
    best = Math.min(best, value / length)
  }
  return Number.isFinite(best) ? best : 0
}

/**
 * A*’s estimate of the cost still to come, in the same units as the cost function it is paired with.
 *
 * Admissible by the proof above, and *consistent* as well — the triangle inequality holds for `k × length`
 * because `k` is a constant — which is what lets the search stop the moment it settles the destination
 * rather than draining the heap. `scale` exists for the viva, not for the app: multiplying by more than 1
 * is how you make A* greedy, it finds *a* route faster and gives up the guarantee of finding the best one,
 * and `a-star.spec.ts` ships the case where that produces a longer walk.
 */
export function euclideanHeuristic(
  index: GraphIndex,
  options: CostScaleOptions & { readonly scale?: number } = {},
): Heuristic {
  const { scale = 1, ...scaleOf } = options
  const k = scale * minCostPerUnit(index, scaleOf)
  return (from: Point, to: Point) => k * euclidean(from, to)
}
