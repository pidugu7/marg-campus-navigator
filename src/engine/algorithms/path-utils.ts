/**
 * From a list of vertices to a route a person can follow.
 *
 * A path out of a search is 12 node ids and 11 edge ids. That is the right shape for an algorithm and the
 * wrong shape for a human: nobody turns at a *vertex*, they turn at a corner, and a corner is exactly where
 * the heading changes by more than a shrug. This module is the translation, split in two on purpose —
 * {@link routeLegs} does the geometry and knows nothing about words, {@link stepsFromLegs} does the words and
 * knows nothing about the graph. The split is what lets a search assemble a complete `RouteResult` from
 * either half, and what lets the simplification pass land *between* them without either side noticing.
 *
 * The invariant this file earns its place with is {@link stepsReplay}: **the steps must replay the path**, and
 * it is checked on every random graph the specs generate. Directions that cannot be walked are decoration.
 */
import { compassOf, turnBetween, type CompassPoint } from '../geo/measure'
import type { EdgeId, GraphIndex, GraphNode, NodeId, RouteStep, TurnDirection } from '../types'

/** Degrees of heading change still worth calling straight. A 10° kink in a traced walkway is not news. */
export const STRAIGHT_WITHIN_DEGREES = 15
/** Up to here a nudge; past it, a turn a walker would mention. */
export const SLIGHT_WITHIN_DEGREES = 60
/** Past here you slow down for it. */
export const SHARP_WITHIN_DEGREES = 135

/** One stretch of walking that keeps its heading, ending at the corner where it does not. */
export interface RouteLeg {
  readonly nodeIds: readonly NodeId[]
  readonly edgeIds: readonly EdgeId[]
  readonly metres: number
  /** The turn made *into* this leg. `'straight'` for the first leg, and only for the first leg. */
  readonly direction: TurnDirection
  /**
   * Heading of the leg's first stretch, or `null` when the index cannot place one of its vertices — in
   * which case the sentence says "Set off" rather than inventing a direction.
   */
  readonly compass: CompassPoint | null
  /**
   * What the step is named after: the far end for the opening leg, the corner for any other leg. Decided in
   * the geometry half because it depends on where the leg starts, and the wording half must not have to
   * re-derive geometry to pick a noun. Empty when that vertex has no label to read, which is what makes the
   * sentence stop after the verb instead of printing "at ".
   */
  readonly landmark: string
  /** True when the leg ends on the destination, the only end worth calling "your destination". */
  readonly reachesDestination: boolean
}

/**
 * Every vertex of a path resolved once, in order.
 *
 * A slot that the index cannot place stays `undefined`, and "no bearing, no turn, no new leg" is the same
 * answer a walker would reach by looking at the map and shrugging. Resolving the whole path up front is what
 * lets the two scans below read their neighbours with a plain index — no bounds helper, and no `??`
 * standing in for a check the range already made.
 */
function placeAll(index: GraphIndex, ids: readonly NodeId[]): (GraphNode | undefined)[] {
  return ids.map((id) => index.node(id))
}

/** The turn at each interior vertex, in degrees, and `0` at the two ends where there is nothing to turn. */
function turnsAt(placed: readonly (GraphNode | undefined)[]): number[] {
  return placed.map((_, position) => {
    const before = placed[position - 1]
    const here = placed[position]
    const after = placed[position + 1]
    return before !== undefined && here !== undefined && after !== undefined ? turnBetween(before, here, after) : 0
  })
}

/**
 * Group a path's edges into legs, cutting at every corner.
 *
 * Consecutive edges stay in one leg while the heading moves by less than {@link STRAIGHT_WITHIN_DEGREES},
 * which is what removes the "Continue, Continue, Continue" noise a straight walkway produces when the file
 * stores it as four segments. A leg starts *at* the corner it turns at, so a leg's first vertex is the vertex
 * the turn happens on.
 *
 * Requires at least two vertices: a one-vertex path is not a leg, it is the "you are already here" case, and
 * the search answers that one itself.
 *
 * `metres` sums only the edges the index can resolve. An adjacency entry naming an edge that is not in the
 * snapshot cannot come from `AdjacencyGraph.seal()`, only from an index built by hand, and `validateGraph`
 * calls that file `dangling-edge-endpoint`; here it means no length to add, and nothing else.
 */
export function routeLegs(index: GraphIndex, nodeIds: readonly NodeId[], edgeIds: readonly EdgeId[]): readonly RouteLeg[] {
  if (nodeIds.length < 2) return []
  const placed = placeAll(index, nodeIds)
  const turns = turnsAt(placed)
  const cuts: number[] = [0]
  for (let i = 1; i < nodeIds.length - 1; i++) {
    if (Math.abs(turns[i] as number) >= STRAIGHT_WITHIN_DEGREES) cuts.push(i)
  }
  const last = nodeIds.length - 1
  cuts.push(last)

  const legs: RouteLeg[] = []
  for (let position = 0; position + 1 < cuts.length; position++) {
    const start = cuts[position] as number
    const end = cuts[position + 1] as number
    const reachesDestination = end === last
    // The opening leg is named for where it takes you; *any* other leg for the corner you turn at. Not
    // "the last leg for its destination": the sentence already says "your destination", and naming the end
    // instead of the corner made the corner vanish from the one turn a walker most needs told.

    const corner = placed[position === 0 ? end : start]
    const head = placed[start]
    const far = placed[end]
    const metres = edgeIds
      .slice(start, end)
      .reduce((total, edgeId) => total + (index.edge(edgeId)?.metres ?? 0), 0)
    legs.push({
      nodeIds: nodeIds.slice(start, end + 1),
      edgeIds: edgeIds.slice(start, end),
      metres: Math.round(metres * 10) / 10,
      direction: position === 0 ? 'straight' : turnDirectionFor(turns[start] as number),
      compass: head !== undefined && far !== undefined ? compassOf(head, far) : null,
      landmark: corner?.label ?? '',
      reachesDestination,
    })
  }
  return legs
}

/**
 * Bucket a heading change into a turn word.
 *
 * Nine buckets, mirrored about zero, from a signed angle in `(-180, 180]`. The thresholds are the ones a
 * pedestrian notices rather than the ones that divide a circle evenly, and beyond `180 − 15°` is a U-turn —
 * a direction a route should never contain, which is exactly why it gets its own word instead of "left".
 */
export function turnDirectionFor(degrees: number): TurnDirection {
  const magnitude = Math.abs(degrees)
  if (magnitude > 180 - STRAIGHT_WITHIN_DEGREES) return 'uturn'
  if (magnitude < STRAIGHT_WITHIN_DEGREES) return 'straight'
  const side = degrees > 0 ? 'right' : 'left'
  const qualifier = magnitude >= SHARP_WITHIN_DEGREES ? 'sharp-' : magnitude >= SLIGHT_WITHIN_DEGREES ? '' : 'slight-'
  return `${qualifier}${side}` as TurnDirection
}

/**
 * The verb for each bucket. `'straight'` and `'stay'` are never chosen by a step sentence — the opening leg
 * says "Head north-east …" and the no-walking case is written where it is detected — and the record is total
 * anyway, because naming all nine is what makes a tenth bucket a compile error here rather than `undefined`
 * in a directions list.
 */
const TURN_WORDS: Readonly<Record<TurnDirection, string>> = {
  straight: 'Continue',
  'slight-left': 'Bear left',
  left: 'Turn left',
  'sharp-left': 'Turn sharply left',
  uturn: 'About-turn',
  'sharp-right': 'Turn sharply right',
  right: 'Turn right',
  'slight-right': 'Bear right',
  stay: 'Stay',
}

/**
 * The sentence for one leg.
 *
 * Two conventions, both argued out and both pinned by specs. Distances live in `RouteStep.metres` and are
 * never repeated inside the prose — one number, one source, and the UI appends it. And a turn is named
 * against the corner it happens at, unless that corner has no label to read, in which case the sentence stops
 * after the verb: "Turn left" is a direction, "Turn left at j-7" is not.
 */
export function stepsFromLegs(legs: readonly RouteLeg[]): readonly RouteStep[] {
  return legs.map((leg, position) => {
    const opening = position === 0
    const verb = opening ? (leg.compass === null ? 'Set off' : `Head ${leg.compass}`) : TURN_WORDS[leg.direction]
    const clause = leg.landmark === '' ? '' : `${opening ? ' to ' : ' at '}${leg.landmark}`
    return {
      direction: leg.direction,
      instruction: `${verb}${clause}${leg.reachesDestination ? ', your destination' : ''}`,
      metres: leg.metres,
      nodeIds: leg.nodeIds,
    }
  })
}

/**
 * Concatenate a step list back into the node path, joints counted once.
 *
 * Exported because it is the property the specs assert, and because the convention — legs overlap at their
 * shared vertex — belongs to the module that defines the shape rather than to a test that re-derives it.
 */
export function stepsReplay(steps: readonly RouteStep[]): readonly NodeId[] {
  const ids: NodeId[] = []
  for (const step of steps) {
    for (const id of step.nodeIds) {
      if (ids[ids.length - 1] === id) continue
      ids.push(id)
    }
  }
  return ids
}
