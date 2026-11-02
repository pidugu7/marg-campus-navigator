import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE_ATTRIBUTES } from '../constants'
import { AdjacencyGraph } from '../structures/graph'
import { createRandom, indexOfGraph, randomGraph, BASE_SEED } from '../__tests__/helpers'
import {
  COMPASS_POINTS,
  compassOf,
  euclidean,
  euclideanHeuristic,
  minCostPerUnit,
  turnBetween,
} from './measure'
import type { AdjacencyEntry, EdgeId, Graph, GraphEdge, GraphIndex, NodeId } from '../types'

/**
 * `geo/measure.ts` is the module A* stands on, so its specs are the proof of the heuristic's admissibility —
 * which is the one property of A* that can be silently false and stay false for the whole demo.
 */

/** A hand-written index, for the two cases `AdjacencyGraph` refuses to build: a dangling end and no edges. */
function stubIndex(nodes: { id: string; x: number; y: number }[], edges: GraphEdge[]): GraphIndex {
  const graph: Graph = { nodes: nodes.map((node) => ({ ...node, label: node.id, kind: 'junction' as const })), edges }
  const byId = new Map(nodes.map((node) => [node.id, { ...node, label: node.id, kind: 'junction' as const }]))
  const noNeighbours: readonly AdjacencyEntry[] = []
  const noEdges: readonly EdgeId[] = []
  return {
    graph,
    size: nodes.length,
    arcCount: edges.length,
    hasNode: (id: NodeId) => byId.has(id),
    node: (id: NodeId) => byId.get(id),
    edge: (id: string) => graph.edges.find((edge) => edge.id === id),
    neighboursOf: () => noNeighbours,
    edgesAt: () => noEdges,
    componentOf: () => 0,
  }
}

const edge = (id: string, from: string, to: string, metres: number, oneWay = false): GraphEdge => ({
  id,
  from,
  to,
  metres,
  oneWay,
  attributes: DEFAULT_EDGE_ATTRIBUTES,
})

/** Two vertices 10 world units apart, with `metres` as authored — the shape every scale test needs. */
function pair(drawnGap: number, metres: number): GraphIndex {
  const builder = new AdjacencyGraph()
  builder.addNode({ id: 'a', x: 0, y: 0 })
  builder.addNode({ id: 'b', x: drawnGap, y: 0 })
  builder.addEdge({ id: 'ab', from: 'a', to: 'b', metres })
  return builder.seal()
}

describe('euclidean', () => {
  it('measures in the map units the coordinates are written in, not in metres', () => {
    expect(euclidean({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(euclidean({ x: -2, y: 6 }, { x: -2, y: 6 })).toBe(0)
  })
})

describe('compassOf', () => {
  it('reads the eight points off a +y-down plane, where north is up the screen', () => {
    expect(COMPASS_POINTS).toHaveLength(8)
    expect(compassOf({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe('north')
    expect(compassOf({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe('east')
    expect(compassOf({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe('south')
    expect(compassOf({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe('west')
    expect(compassOf({ x: 0, y: 0 }, { x: 10, y: -10 })).toBe('north-east')
    expect(compassOf({ x: 0, y: 0 }, { x: -10, y: 10 })).toBe('south-west')
  })

  it('wraps at 359 degrees instead of running off the end of the list', () => {
    // 359° is the case that reads as `COMPASS_POINTS[8]` if the modulo is applied after the rounding, and a
    // directions list that says "Head undefined" is exactly the bug a boundary is supposed to make
    // impossible. Two points either side of north, both expected to answer `north`.
    const near = 1000
    expect(compassOf({ x: 0, y: 0 }, { x: Math.sin((-1 * Math.PI) / 180) * near, y: -Math.cos((-1 * Math.PI) / 180) * near })).toBe('north')
    expect(compassOf({ x: 0, y: 0 }, { x: Math.sin((1 * Math.PI) / 180) * near, y: -Math.cos((1 * Math.PI) / 180) * near })).toBe('north')
  })

  it('gives every one of the eight points a home at its own exact bearing', () => {
    for (const [index, name] of COMPASS_POINTS.entries()) {
      const radians = (index * 45 * Math.PI) / 180
      const point = { x: Math.sin(radians) * 100, y: -Math.cos(radians) * 100 }
      expect(compassOf({ x: 0, y: 0 }, point), `bearing ${String(index * 45)}°`).toBe(name)
    }
  })
})

describe('turnBetween', () => {
  it('is positive to the walker’s right and negative to the left, on a y-down map', () => {
    // Walking east along the top of the canvas then heading down the screen is a right turn, and the sign
    // has to agree with that or every "turn left" in the app would be a turn right.
    expect(turnBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(90, 9)
    expect(turnBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -10 })).toBeCloseTo(-90, 9)
  })

  it('calls a straight-on vertex zero and a reversal 180, never -180', () => {
    expect(turnBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 })).toBeCloseTo(0, 9)
    expect(turnBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(180, 9)
  })

  it('does not need a wrap-around branch at the 360 seam', () => {
    // Two bearings of 350° and 10° differ by 20°, not 340°: the reason the function takes three points
    // instead of two angles. A 5°-either-side tolerance would let a 30° error through, so this is tight.
    // The outgoing leg runs east again, 0.001 off: a kink, not a corner. (Writing this as
    // `{ x: 10, y: 0.001 }` instead asks for the turn from east to *south*, which is a real 90°, and the
    // implementation was right to say so — the expectation was the bug.)
    expect(Math.abs(turnBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 110, y: 0.001 }))).toBeLessThan(1)
    const slight = turnBetween({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100 + 100, y: 30 })
    expect(slight).toBeGreaterThan(10)
    expect(slight).toBeLessThan(20)
  })

  it('measures the turn at the middle point only, whatever the leg lengths are', () => {
    const short = turnBetween({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1.5, y: 1 })
    const long = turnBetween({ x: -100, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 1 })
    expect(short).toBeCloseTo(63.4349488, 4)
    expect(long).toBeCloseTo(63.4349488, 4)
  })
})

describe('minCostPerUnit', () => {
  it('is 1 when one world unit is one metre and the cost function is the length', () => {
    expect(minCostPerUnit(pair(10, 10))).toBeCloseTo(1, 9)
  })

  it('scales to the authored metres when the drawing disagrees with them', () => {
    // `build-graph.ts` tolerates a 15% difference between a traced line and a stated length, so a heuristic
    // that assumed 1:1 could overestimate by that much and A* would then return a longer route than
    // Dijkstra. Measuring the ratio is what makes that tolerance safe rather than load-bearing.
    expect(minCostPerUnit(pair(100, 50))).toBeCloseTo(0.5, 9)
    expect(minCostPerUnit(pair(50, 100))).toBeCloseTo(2, 9)
  })

  it('takes the cheapest edge in the graph, because every route is made of edges', () => {
    const builder = new AdjacencyGraph()
    builder.addNode({ id: 'a', x: 0, y: 0 })
    builder.addNode({ id: 'b', x: 100, y: 0 })
    builder.addNode({ id: 'c', x: 200, y: 0 })
    builder.addEdge({ id: 'expensive', from: 'a', to: 'b', metres: 400 })
    builder.addEdge({ id: 'cheap', from: 'b', to: 'c', metres: 50 })
    expect(minCostPerUnit(builder.seal())).toBeCloseTo(0.5, 9)
  })

  it('ignores walkways closed for this query, which makes the estimate sharper, not looser', () => {
    const index = pair(100, 20)
    const builder = new AdjacencyGraph()
    builder.addNode({ id: 'a', x: 0, y: 0 })
    builder.addNode({ id: 'b', x: 100, y: 0 })
    builder.addNode({ id: 'c', x: 100, y: 10 })
    builder.addEdge({ id: 'shortcut', from: 'a', to: 'b', metres: 20 })
    builder.addEdge({ id: 'long', from: 'a', to: 'c', metres: 300 })
    const sealed = builder.seal()
    expect(minCostPerUnit(index)).toBeCloseTo(0.2, 9)
    // The remaining edge is 300 authored metres over a drawn `hypot(100, 10)` units, and the ratio uses the
    // drawing because that is the same ruler the heuristic measures with.
    expect(minCostPerUnit(sealed, { blockedEdges: new Set(['shortcut']) })).toBeCloseTo(300 / Math.hypot(100, 10), 9)
    expect(minCostPerUnit(sealed)).toBeCloseTo(0.2, 9)
  })

  it('refuses to let a closed or broken price set the cost of every metre on the campus', () => {
    const builder = new AdjacencyGraph()
    builder.addNode({ id: 'a', x: 0, y: 0 })
    builder.addNode({ id: 'b', x: 10, y: 0 })
    builder.addNode({ id: 'c', x: 20, y: 0 })
    builder.addEdge({ id: 'ab', from: 'a', to: 'b', metres: 10 })
    builder.addEdge({ id: 'bc', from: 'b', to: 'c', metres: 10 })
    const sealed = builder.seal()
    // A profile closes an edge by pricing it at Infinity. That edge must not become the cheapest per unit,
    // and neither may a NaN or a zero — which `expand` reports as `invalid-graph` when the search reaches it.
    expect(minCostPerUnit(sealed, { cost: (e) => (e.id === 'bc' ? Number.POSITIVE_INFINITY : e.metres) })).toBeCloseTo(1, 9)
    expect(minCostPerUnit(sealed, { cost: () => Number.NaN })).toBe(0)
    expect(minCostPerUnit(sealed, { cost: () => 0 })).toBe(0)
    expect(minCostPerUnit(sealed, { cost: () => -5 })).toBe(0)
  })

  it('is zero for a graph with nothing to measure, rather than Infinity or NaN', () => {
    expect(minCostPerUnit(new AdjacencyGraph().seal())).toBe(0)
    const builder = new AdjacencyGraph()
    builder.addNode({ id: 'alone', x: 1, y: 2 })
    expect(minCostPerUnit(builder.seal())).toBe(0)
  })

  it('skips an edge whose drawn length is zero, because it adds nothing to any route', () => {
    const builder = new AdjacencyGraph()
    builder.addNode({ id: 'a', x: 5, y: 5 })
    builder.addNode({ id: 'b', x: 5, y: 5 })
    builder.addNode({ id: 'c', x: 50, y: 5 })
    builder.addEdge({ id: 'pin', from: 'a', to: 'b', metres: 30 })
    builder.addEdge({ id: 'run', from: 'b', to: 'c', metres: 45 })
    // 45 metres over 45 units is 1 per unit; the zero-length `pin` would claim 30 per unit, which is
    // *higher* and so would not have been chosen anyway — the point is that no `Infinity` or `NaN` appears.
    expect(minCostPerUnit(builder.seal())).toBeCloseTo(1, 9)
  })

  it('skips an edge whose endpoint the index cannot place, instead of throwing', () => {
    const index = stubIndex([{ id: 'a', x: 0, y: 0 }], [edge('ghost', 'a', 'nowhere', 10), edge('real', 'a', 'a2', 30)])
    // `nowhere` and `a2` are both missing, so nothing qualifies and the heuristic degrades to Dijkstra.
    expect(minCostPerUnit(index)).toBe(0)
    const onePlaced = stubIndex([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 60, y: 0 }], [edge('real', 'a', 'b', 30), edge('ghost', 'a', 'nowhere', 1)])
    expect(minCostPerUnit(onePlaced)).toBeCloseTo(0.5, 9)
  })

  it('is a lower bound on cost per unit for every edge of 60 random graphs', () => {
    const rng = createRandom(BASE_SEED ^ 0x5eed3)
    for (let trial = 0; trial < 60; trial++) {
      const generated = randomGraph(4 + (trial % 14), rng, {
        extraEdges: 3 + (trial % 9),
        oneWayChance: trial % 3 === 0 ? 0.4 : 0,
      })
      const index = indexOfGraph(generated)
      const k = minCostPerUnit(index)
      expect(k, `trial ${String(trial)}: k must be finite and non-negative`).toBeGreaterThanOrEqual(0)
      for (const stored of index.graph.edges) {
        const from = index.node(stored.from)
        const to = index.node(stored.to)
        if (from === undefined || to === undefined) continue
        const length = euclidean(from, to)
        if (!(length > 0)) continue
        // The defining property: no edge costs less than k × its own drawn length.
        expect(stored.metres / length, `trial ${String(trial)} edge ${stored.id}`).toBeGreaterThanOrEqual(k - 1e-9)
      }
    }
  })
})

describe('euclideanHeuristic', () => {
  it('estimates the cost of a straight line, not its length', () => {
    const index = pair(100, 50)
    const h = euclideanHeuristic(index)
    expect(h({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(50, 9)
    expect(h({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0)
  })

  it('is symmetric, and 0 for a graph with nothing to measure', () => {
    const index = pair(100, 50)
    const h = euclideanHeuristic(index)
    const a = { x: 0, y: 0 }
    const b = { x: 100, y: 0 }
    expect(h(a, b)).toBe(h(b, a))
    expect(euclideanHeuristic(new AdjacencyGraph().seal())(a, b)).toBe(0)
  })

  it('scales with the `scale` knob, which is how the inadmissible case is produced on purpose', () => {
    const index = pair(100, 50)
    expect(euclideanHeuristic(index, { scale: 1 })({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(50, 9)
    expect(euclideanHeuristic(index, { scale: 3 })({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(150, 9)
    expect(euclideanHeuristic(index, { scale: 0 })({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(0)
  })

  it('obeys the triangle inequality through every edge, which is what consistency means', () => {
    // h(u) ≤ cost(u,v) + h(v) for every edge and every target. Consistency is the stronger half of
    // admissibility and it is what lets a search return the moment it settles the destination, so the claim
    // is checked rather than assumed — 40 graphs, every edge, every vertex as target.
    const rng = createRandom(BASE_SEED ^ 0x9e37)
    for (let trial = 0; trial < 40; trial++) {
      const generated = randomGraph(5 + (trial % 10), rng, { extraEdges: 2 + (trial % 6) })
      const index = indexOfGraph(generated)
      const h = euclideanHeuristic(index)
      const placed = index.graph.nodes.flatMap((node) => {
        const point = index.node(node.id)
        return point === undefined ? [] : [{ id: node.id, point }]
      })
      for (const target of placed) {
        for (const here of placed) {
          for (const entry of index.neighboursOf(here.id)) {
            const edge = index.edge(entry.edgeId)
            const there = index.node(entry.to)
            if (edge === undefined || there === undefined) continue
            const slack = h(here.point, target.point) - (edge.metres + h(there, target.point))
            expect(slack, `trial ${String(trial)} via ${edge.id}`).toBeLessThanOrEqual(1e-9)
          }
        }
      }
    }
  })
})
