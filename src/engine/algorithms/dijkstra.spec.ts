import { describe, expect, it } from 'vitest'
import { COST_EPSILON, DEFAULT_EDGE_ATTRIBUTES } from '../constants'
import { AdjacencyGraph } from '../structures/graph'
import {
  BASE_SEED,
  bellmanFord,
  createRandom,
  floydWarshall,
  indexOfGraph,
  randomGraph,
  sweepGraphs,
  type GeneratedGraph,
} from '../__tests__/helpers'
import { dijkstra } from './dijkstra'
import { stepsReplay } from './path-utils'
import type { EdgeAttributes, EdgeId, GraphIndex, NodeId, RouteFound } from '../types'

/**
 * Dijkstra, against a reference that is too stupid to be wrong.
 *
 * The pinned cases show the behaviour a reader wants to see stated once and precisely; the sweep is the part
 * that actually earns the claim "exact weighted shortest path" — 200 seeded graphs, a source-to-every-vertex
 * comparison against Bellman-Ford for every vertex of each, plus a second independent opinion from
 * Floyd–Warshall on the tiny ones. Paths are also re-walked edge by edge, because matching *costs* would let
 * a search return a path that is not a path.
 */

const attributes: EdgeAttributes = DEFAULT_EDGE_ATTRIBUTES
const EMPTY_BLOCKED: ReadonlySet<EdgeId> = new Set<string>()

interface Builder {
  readonly index: AdjacencyGraph
  readonly edgeIds: readonly EdgeId[]
}

/** Four vertices in a line, 10 m apart: the smallest case with a route worth checking. */
function line(extra?: (builder: AdjacencyGraph) => void): Builder {
  const builder = new AdjacencyGraph()
  const ids = ['n0', 'n1', 'n2', 'n3']
  ids.forEach((id, i) => builder.addNode({ id, x: i * 10, y: 0, label: `Node ${String(i)}`, kind: i === 3 ? 'place' : 'junction' }))
  const edgeIds: EdgeId[] = []
  for (let i = 1; i < ids.length; i++) {
    const id = `e${String(i)}`
    edgeIds.push(id)
    builder.addEdge({ id, from: ids[i - 1] as string, to: ids[i] as string, metres: 10, attributes })
  }
  extra?.(builder)
  return { index: builder.seal(), edgeIds }
}

/** The square with the expensive diagonal from `search-common.spec.ts`, shared by the two specs' ideas. */
function crossing(): AdjacencyGraph {
  const builder = new AdjacencyGraph()
  builder.addNode({ id: 'a', x: 0, y: 0, label: 'Gate', kind: 'gate' })
  builder.addNode({ id: 'b', x: 100, y: 0, label: 'Quad', kind: 'junction' })
  builder.addNode({ id: 'c', x: 100, y: 100, label: 'Library', kind: 'place' })
  builder.addNode({ id: 'd', x: 0, y: 100, label: 'Lab Block', kind: 'place' })
  builder.addEdge({ id: 'ab', from: 'a', to: 'b', metres: 100, attributes })
  builder.addEdge({ id: 'bc', from: 'b', to: 'c', metres: 100, attributes })
  builder.addEdge({ id: 'cd', from: 'c', to: 'd', metres: 100, attributes })
  builder.addEdge({ id: 'da', from: 'd', to: 'a', metres: 100, attributes })
  builder.addEdge({ id: 'ac', from: 'a', to: 'c', metres: 250, attributes })
  return builder.seal()
}

/** `a`→`b`→`c` plus a one-way `d`→`c`: to reach `c` from `d` you must go the long way round. */
function oneWayTrap(): AdjacencyGraph {
  const builder = new AdjacencyGraph()
  builder.addNode({ id: 'a', x: 0, y: 0 })
  builder.addNode({ id: 'b', x: 10, y: 0 })
  builder.addNode({ id: 'c', x: 20, y: 0 })
  builder.addNode({ id: 'd', x: 20, y: 40 })
  builder.addEdge({ id: 'ab', from: 'a', to: 'b', metres: 10, attributes })
  builder.addEdge({ id: 'bc', from: 'b', to: 'c', metres: 10, attributes })
  builder.addEdge({ id: 'dc', from: 'd', to: 'c', metres: 40, oneWay: true, attributes })
  builder.addEdge({ id: 'ad', from: 'a', to: 'd', metres: 45, attributes })
  return builder.seal()
}

/** Two islands, so "no route" is a fact about the map and not about a broken search. */
function islands(): AdjacencyGraph {
  const builder = new AdjacencyGraph()
  for (const [id, x] of [
    ['home', 0],
    ['work', 30],
    ['annexe', 900],
  ] as const) {
    builder.addNode({ id, x, y: 0, label: id, kind: 'place' })
  }
  builder.addEdge({ id: 'hw', from: 'home', to: 'work', metres: 30, attributes })
  return builder.seal()
}

/** Re-walk a returned path against the index, and say so in the failure message if it does not hold. */
function assertIsAPath(index: GraphIndex, result: RouteFound, trial: number, blocked: ReadonlySet<EdgeId> = EMPTY_BLOCKED): void {
  expect(result.nodeIds.length, `trial ${String(trial)}: a path of n vertices`).toBe(result.edgeIds.length + 1)
  expect(result.hops, `trial ${String(trial)}: hops counts edges`).toBe(result.edgeIds.length)
  expect(result.nodeIds[0], `trial ${String(trial)}: starts at the origin`).toBe(result.nodeIds[0])
  let metres = 0
  for (let i = 0; i < result.edgeIds.length; i++) {
    const edge = index.edge(result.edgeIds[i] as EdgeId)
    expect(edge, `trial ${String(trial)}: edge ${String(result.edgeIds[i])} exists`).toBeDefined()
    if (edge === undefined) return
    expect(blocked.has(edge.id), `trial ${String(trial)}: walked a closed edge ${edge.id}`).toBe(false)
    const from = result.nodeIds[i] as NodeId
    const to = result.nodeIds[i + 1] as NodeId
    const forward = edge.from === from && edge.to === to
    const backward = !edge.oneWay && edge.from === to && edge.to === from
    expect(forward || backward, `trial ${String(trial)}: edge ${edge.id} does not join ${from} to ${to}`).toBe(true)
    metres += edge.metres
  }
  expect(Math.abs(result.metres - Math.round(metres * 10) / 10), `trial ${String(trial)}: metres`).toBeLessThanOrEqual(0.05)
  // The step list is the same route in words, so it has to replay onto the same vertices.
  expect(stepsReplay(result.steps), `trial ${String(trial)}: steps replay the path`).toEqual(result.nodeIds)
  // Every settled vertex appears once, and no settled vertex is repeated.
  expect(new Set(result.exploredOrder).size, `trial ${String(trial)}: settled once each`).toBe(result.exploredOrder.length)
  expect(result.frontierSnapshots).toHaveLength(result.exploredOrder.length)
}

describe('dijkstra, pinned', () => {
  it('walks a line and reports the length, the pace and the order it settled in', () => {
    const { index } = line()
    const result = dijkstra(index, 'n0', 'n3')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodeIds).toEqual(['n0', 'n1', 'n2', 'n3'])
    expect(result.edgeIds).toEqual(['e1', 'e2', 'e3'])
    expect(result.cost).toBe(30)
    expect(result.metres).toBe(30)
    expect(result.hops).toBe(3)
    // 30 m at 1.4 m/s is 21.4 s, and the card quotes it as minutes to one decimal.
    expect(result.minutes).toBe(0.4)
    expect(result.exploredOrder).toEqual(['n0', 'n1', 'n2', 'n3'])
    expect(result.algorithm).toBe('dijkstra')
    expect(result.profile).toBe('shortest')
    expect(result.cached).toBe(false)
    assertIsAPath(index, result, 0)
  })

  it('stops as soon as the destination is settled, without draining the heap', () => {
    const { index } = line()
    const toNeighbour = dijkstra(index, 'n0', 'n1')
    const toFarEnd = dijkstra(index, 'n0', 'n3')
    expect(toNeighbour.ok).toBe(true)
    expect(toFarEnd.ok).toBe(true)
    if (!toNeighbour.ok || !toFarEnd.ok) return
    // Two settled vertices against four. Reporting the full drain would be correct but would make the
    // expansion count useless for comparing against A*, which is what Phase 5 puts side by side.
    expect(toNeighbour.expanded).toBe(2)
    expect(toFarEnd.expanded).toBe(4)
    expect(toNeighbour.frontierSnapshots).toEqual([[], []])
  })

  it('prefers two edges over one, because it minimises cost and not hops', () => {
    const index = crossing()
    const result = dijkstra(index, 'a', 'c')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodeIds).toEqual(['a', 'b', 'c'])
    expect(result.cost).toBe(200)
    expect(result.hops).toBe(2)
    expect(result.edgeIds).not.toContain('ac')
    assertIsAPath(index, result, 1)
  })

  it('breaks a genuine tie the same way every time', () => {
    const index = crossing()
    // `a`-`b`-`c` and `a`-`d`-`c` are both 200 m, so the answer depends entirely on the tie-break, and the
    // tie-break is the heap's `(priority, id)` order. Determinism is not a nicety here: it is what makes the
    // explored-region overlay and the phase's screenshots reproducible.
    const first = dijkstra(index, 'a', 'c')
    const second = dijkstra(index, 'a', 'c')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.cost).toBe(200)
    expect(first.nodeIds).toEqual(['a', 'b', 'c'])
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.nodeIds).toEqual(first.nodeIds)
    expect(second.exploredOrder).toEqual(['a', 'b', 'd', 'c'])
    expect(first.exploredOrder).toEqual(second.exploredOrder)
  })

  it('follows a one-way walkway in the direction it points, and not otherwise', () => {
    const index = oneWayTrap()
    const forward = dijkstra(index, 'd', 'c')
    if (!forward.ok) return expect(forward.reason).toBe('a route was expected')
    // `d`→`c` is one-way *towards* `c`, so the direct hop is legal going that way and is 40 m.
    expect(forward.nodeIds).toEqual(['d', 'c'])
    expect(forward.metres).toBe(40)
    // The reverse has to go back out through `a` and around.
    const back = dijkstra(index, 'c', 'd')
    if (!back.ok) return expect(back.reason).toBe('a route was expected')
    expect(back.nodeIds).toEqual(['c', 'b', 'a', 'd'])
    expect(back.metres).toBe(65)
    assertIsAPath(index, back, 2)
  })

  it('takes the detour a blocked edge forces, and never walks the closed segment', () => {
    const index = crossing()
    const result = dijkstra(index, 'a', 'c', { blockedEdges: new Set(['ab']) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodeIds).toEqual(['a', 'd', 'c'])
    expect(result.cost).toBe(200)
    expect(result.edgeIds).not.toContain('ab')
    // Without the closure the same query answers `a`-`b`-`c`: same length, different walkway, which is the
    // whole point of passing the set instead of rebuilding the graph.
    expect(dijkstra(index, 'a', 'c').ok).toBe(true)
    assertIsAPath(index, result, 3, new Set(['ab']))
  })

  it('reports a closure that strands the destination as disconnected, naming the closure', () => {
    const index = crossing()
    const result = dijkstra(index, 'a', 'c', { blockedEdges: new Set(['ab', 'ac', 'da']) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('disconnected')
    expect(result.message).toContain('3 walkway(s) are closed')
    // `a` was still settled, so the failure is not reported as a search that never ran.
    expect(result.exploredOrder).toEqual(['a'])
    expect(result.algorithm).toBe('dijkstra')
  })

  it('closes an edge through the cost function too, which is how a profile says no', () => {
    const index = crossing()
    const avoidDiagonal = dijkstra(index, 'a', 'c', { cost: (edge) => (edge.id === 'ac' ? Number.POSITIVE_INFINITY : edge.metres) })
    if (!avoidDiagonal.ok) return expect(avoidDiagonal.reason).toBe('a route was expected')
    expect(avoidDiagonal.nodeIds).toEqual(['a', 'b', 'c'])
    // And the mirror: close the two outer edges and the only way through is the diagonal, at 250.
    const diagonalOnly = dijkstra(index, 'a', 'c', {
      cost: (edge) => (edge.id === 'ac' ? edge.metres : Number.POSITIVE_INFINITY),
    })
    if (!diagonalOnly.ok) return expect(diagonalOnly.reason).toBe('a route was expected')
    expect(diagonalOnly.nodeIds).toEqual(['a', 'c'])
    expect(diagonalOnly.metres).toBe(250)
  })

  it('says there is no route across two components, before it searches', () => {
    const index = islands()
    const result = dijkstra(index, 'home', 'annexe')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('disconnected')
    expect(result.message).toContain('no walkway connects them')
    expect(result.expanded).toBe(0)
  })

  it('answers a request for a place it has never heard of, without throwing', () => {
    const index = crossing()
    const missing = (reason: string, from: NodeId, to: NodeId): void => {
      const result = dijkstra(index, from, to)
      expect(result.ok).toBe(false)
    if (result.ok) return
      expect(result.reason).toBe(reason)
    }
    missing('unknown-origin', 'nowhere', 'a')
    missing('unknown-destination', 'a', 'nowhere')
    missing('unknown-origin', 'nope', 'also-nope')
    const empty = dijkstra(new AdjacencyGraph().seal(), 'a', 'b')
    expect(empty.ok).toBe(false)
    if (empty.ok) return
    expect(empty.reason).toBe('empty-graph')
  })

  it('routes a walker to the place they are standing on', () => {
    const result = dijkstra(crossing(), 'a', 'a')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodeIds).toEqual(['a'])
    expect(result.edgeIds).toEqual([])
    expect(result.cost).toBe(0)
    expect(result.metres).toBe(0)
    expect(result.minutes).toBe(0)
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]?.instruction).toBe('You are already at Gate.')
    // The one vertex still had to be drawn off the frontier to find out, so it counts as an expansion.
    expect(result.expanded).toBe(1)
    expect(result.frontierSnapshots).toEqual([[]])
  })

  it('refuses a profile that prices an edge at nothing', () => {
    const index = crossing()
    // A zero, a negative and a NaN are all a profile that broke its contract; `Infinity` is not in this
    // list because Infinity is how a profile legitimately says no, and it is tested above.
    for (const bad of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const result = dijkstra(index, 'a', 'c', { cost: () => bad })
      expect(result.ok, `a cost of ${String(bad)} must not be routed on`).toBe(false)
      if (result.ok) continue
      expect(result.reason).toBe('invalid-graph')
      expect(result.message).toContain('finite number greater than 0')
    }
  })

  it('returns the same object shape from a cache round-trip, because Phase 4 memoises it', () => {
    const result = dijkstra(crossing(), 'a', 'c')
    // Plain arrays and numbers, no Set, no Map, no class identity — so a route can be stored, exported by the
    // map editor, and compared in a spec without a revive step.
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})

describe('dijkstra, against Bellman-Ford on 200 seeded graphs', () => {
  it('matches the naive relaxation for every source on every graph', () => {
    // 200 shapes, four sampled sources each, every vertex as a target, under the same closure set the search
    // was given. The reference answers with a number, so that is what is compared; the path itself is audited
    // edge by edge by `assertIsAPath`, because two algorithms can agree on a cost and one of them can have
    // returned a walk that is not a walk.
    sweepGraphs(200, 'dijkstra/bellman-ford', ({ trial, generated, index, blocked, sources }) => {
      const closures: ReadonlySet<EdgeId> = blocked
      for (const source of sources) {
        const reference = bellmanFord(source, generated, { blockedEdges: blocked })
        for (const target of generated.nodes) {
          const result = dijkstra(index, source, target.id, { blockedEdges: closures })
          const expected = reference.get(target.id) ?? Number.POSITIVE_INFINITY
          if (!Number.isFinite(expected)) {
            expect(result.ok, `trial ${String(trial)} ${source} to ${target.id}: expected no route`).toBe(false)
            if (!result.ok) expect(result.reason).toBe('disconnected')
            continue
          }
          if (!result.ok) {
            // A source asked about itself always has a route, so the only legitimate refusal left is a vertex
            // stranded by the closures — which the reference agrees is infinite, and it did not.
            return expect(`trial ${String(trial)}: ${source} to ${target.id} refused with ${result.reason} at cost ${String(expected)}`).toBe('a route')
          }
          expect(Math.abs(result.cost - expected), `trial ${String(trial)} ${source} to ${target.id} cost`).toBeLessThanOrEqual(COST_EPSILON)
          expect(result.nodeIds[0], `trial ${String(trial)}: starts at the origin`).toBe(source)
          expect(result.nodeIds[result.nodeIds.length - 1], `trial ${String(trial)}: ends at the destination`).toBe(target.id)
          expect(result.expanded).toBeLessThanOrEqual(index.size)
          if (source !== target.id) assertIsAPath(index, result, trial, blocked)
        }
      }
    })
  })

  it('agrees with Floyd–Warshall on all-pairs costs for 30 tiny graphs', () => {
    // A third opinion, from a different algorithm shape entirely: three nested loops over a matrix. If
    // Dijkstra and Bellman-Ford could share a bug through the adjacency view, the matrix cannot.
    const rng = createRandom(BASE_SEED ^ 0xf10ca7)
    for (let trial = 0; trial < 30; trial++) {
      const generated = randomGraph(3 + (trial % 6), rng, { extraEdges: 1 + (trial % 4), oneWayChance: trial % 3 === 0 ? 0.5 : 0 })
      const index = indexOfGraph(generated)
      const at = floydWarshall(generated)
      for (const from of generated.nodes) {
        for (const to of generated.nodes) {
          const result = dijkstra(index, from.id, to.id)
          const expected = at(from.id, to.id)
          const got = result.ok ? result.cost : Number.POSITIVE_INFINITY
          expect(got, `trial ${String(trial)} ${from.id} to ${to.id}`).toBeLessThanOrEqual(expected + COST_EPSILON)
          expect(got, `trial ${String(trial)} ${from.id} to ${to.id}: also not shorter`).toBeGreaterThanOrEqual(expected - COST_EPSILON)
        }
      }
    }
  })

  it('costs an undirected graph the same in both directions, and a one-way graph not necessarily', () => {
    const rng = createRandom(BASE_SEED ^ 0x51ee5)
    for (let trial = 0; trial < 25; trial++) {
      const generated = randomGraph(5 + (trial % 8), rng, { extraEdges: trial % 5 })
      const index = indexOfGraph(generated)
      for (const from of generated.nodes) {
        for (const to of generated.nodes) {
          const there = dijkstra(index, from.id, to.id)
          const back = dijkstra(index, to.id, from.id)
          expect(there.ok, `trial ${String(trial)}: ${from.id} to ${to.id}`).toBe(back.ok)
          if (there.ok && back.ok) {
            expect(Math.abs(there.cost - back.cost), `trial ${String(trial)} symmetric costs`).toBeLessThanOrEqual(COST_EPSILON)
          }
        }
      }
    }
  })

  it('never expands a vertex that the graph does not have', () => {
    const generated: GeneratedGraph = randomGraph(20, createRandom(BASE_SEED ^ 0x20), { extraEdges: 40 })
    const index = indexOfGraph(generated)
    const known = new Set(generated.nodes.map((node) => node.id))
    for (const source of generated.nodes.slice(0, 5)) {
      for (const target of generated.nodes.slice(0, 5)) {
        const result = dijkstra(index, source.id, target.id)
        for (const id of result.exploredOrder) expect(known.has(id)).toBe(true)
        for (const frame of result.frontierSnapshots) {
          for (const id of frame) expect(known.has(id)).toBe(true)
        }
      }
    }
  })
})

describe('dijkstra, the numbers a card shows', () => {
  it('rounds the length to a tenth of a metre, once, here', () => {
    const builder = new AdjacencyGraph()
    builder.addNode({ id: 'a', x: 0, y: 0 })
    builder.addNode({ id: 'b', x: 33.3333, y: 0 })
    builder.addEdge({ id: 'ab', from: 'a', to: 'b', metres: 33.3333, attributes })
    const index = builder.seal()
    const result = dijkstra(index, 'a', 'b')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.metres).toBe(33.3)
    // `cost` is the unrounded weighted total: the number two algorithms are compared on must not have been
    // rounded before the comparison.
    expect(result.cost).toBe(33.3333)
  })

  it('quotes minutes at the profile pace, not at a pace invented in the UI', () => {
    const index = crossing()
    for (const [profile, minutes] of [
      ['shortest', 2.4],
      ['shaded', 2.6],
      ['lit', 2.7],
      ['step-free', 3.2],
      ['quiet', 2.5],
    ] as const) {
      const result = dijkstra(index, 'a', 'c', { profile })
      expect(result.ok, `${profile} pace`).toBe(true)
      if (!result.ok) continue
      expect(result.minutes, `${profile} pace`).toBe(minutes)
      expect(result.profile).toBe(profile)
      // 200 m is 200 / 1.4 / 60 = 2.38 minutes on the baseline pace and 200 / 1.05 / 60 = 3.17 step-free.
      // The pace is a label, so the metres walked are the same route's metres whichever profile is asked for.
      expect(result.metres).toBe(200)
    }
  })
})
