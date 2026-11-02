/**
 * Which vertices of a route can actually be drawn — decided without a DOM.
 *
 * `marker-plan.ts` makes the case that an SVG should receive a finished decision rather than re-derive one per
 * element; a route needs the same treatment, for two reasons a naive `nodeIds.map(id => positions.get(id))`
 * gets wrong:
 *
 * - A path containing a vertex the model cannot place is **not drawn as a line at all**. Joining the two ends
 *   around the gap would invent a walkway across a building, and a route the map shows that the graph does not
 *   contain is a lie with an arrow on it. The pins survive, because those two vertices *are* placed — a reader
 *   learns where the route begins and ends even when the middle of it cannot be honoured. (`buildGraph` drops
 *   an edge whenever it drops one of its endpoints, so a vertex that came out of a search is always placed.
 *   This is the pure function's contract with any caller, not a fallback this app expects to take.)
 * - A one-vertex route — start and destination the same place, which every search answers with a 0 m walk —
 *   has no line but has a position, and two pins stacked on each other read as two places rather than one.
 *
 * Nothing here knows what a search is: the input is a list of ids and a lookup.
 */
import type { Px } from './view'

export interface PlannedRoute {
  /** The polyline in world units; empty when the route cannot be drawn honestly, or has nothing to connect. */
  readonly points: readonly Px[]
  /** The start pin's position, or `null` when there is no start to place. */
  readonly start: Px | null
  readonly end: Px | null
  /** How many vertices the route named that `positions` could not place. */
  readonly skipped: number
  /** Start and destination are the same spot: draw one pin, not two. */
  readonly samePlace: boolean
}

/**
 * @param nodeIds the route's vertices, in walking order — `RouteResult.nodeIds`, and nothing engine-specific
 *     about the type, because the map is allowed to know ids and coordinates and nothing else.
 * @param positions id → world position, the same map the walkway layer draws from.
 */
export function planRoute(nodeIds: readonly string[], positions: ReadonlyMap<string, Px>): PlannedRoute {
  const firstId = nodeIds[0]
  const lastId = nodeIds[nodeIds.length - 1]
  const start = firstId === undefined ? null : (positions.get(firstId) ?? null)
  const end = lastId === undefined ? null : (positions.get(lastId) ?? null)

  const points: Px[] = []
  let skipped = 0
  for (const id of nodeIds) {
    const point = positions.get(id)
    if (point === undefined) {
      skipped += 1
      continue
    }
    points.push(point)
  }

  return {
    points: skipped === 0 ? points : [],
    start,
    end,
    skipped,
    samePlace: start !== null && end !== null && start.x === end.x && start.y === end.y,
  }
}
