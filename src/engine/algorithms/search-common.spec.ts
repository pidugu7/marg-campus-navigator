import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE_ATTRIBUTES } from '../constants'
import { AdjacencyGraph } from '../structures/graph'
import { SearchRun, minutesFor, type RouteSearchOptions, type SettledVertex } from './search-common'
import type { AdjacencyEntry, EdgeAttributes, EdgeId, Graph, GraphEdge, GraphIndex, NodeId, RouteResult } from '../types'

/**
 * The shared run, tested on its own — because all three searches are this object plus an ordering rule, and a
 * bug here would be invisible in any one algorithm's spec: it would look like three implementations of the
 * same wrong idea, agreeing.
 */

const attributes: EdgeAttributes = DEFAULT_EDGE_ATTRIBUTES
const origin = (id: NodeId): SettledVertex => ({ id, cost: 0, metres: 0, via: null, edgeId: null })

/**
 * A heap-ordered run. Every test that is not *about* the ordering policy wants `dijkstra`, and writing the
 * argument out 20 times is how a spec ends up testing the default by accident: the constructor's fourth
 * parameter is the algorithm, so an options bag passed in that slot typechecks as nothing at all.
 */
const heapRun = (index: GraphIndex, from: NodeId, to: NodeId, options: RouteSearchOptions = {}): SearchRun =>
  new SearchRun(index, from, to, 'dijkstra', options)

/**
 * The loop every algorithm runs, in one place. A spec for the shared run cannot import `dijkstra` and then
 * test decisions that module made, so this is the three lines of glue each algorithm adds — spelled here, and
 * pinned against the real ones in their own specs.
 */
function drainFrom(run: SearchRun, from: NodeId, to: NodeId): RouteResult {
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

/** A square with a diagonal: `a`-`b`-`c`-`d` around the outside, `a`-`c` straight across but longer. */
function square(): AdjacencyGraph {
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

/** Two islands of two nodes each, so a component mismatch is a fact about the data and not a stub. */
function twoComponents(): AdjacencyGraph {
  const builder = new AdjacencyGraph()
  for (const [id, x] of [
    ['a', 0],
    ['b', 10],
    ['c', 500],
    ['d', 510],
  ] as const) {
    builder.addNode({ id, x, y: 0 })
  }
  builder.addEdge({ id: 'ab', from: 'a', to: 'b', metres: 10, attributes })
  builder.addEdge({ id: 'cd', from: 'c', to: 'd', metres: 10, attributes })
  return builder.seal()
}

/** An index whose adjacency names a vertex and an edge the snapshot does not contain. */
function brokenIndex(): GraphIndex {
  const nodes = [{ id: 'a', x: 0, y: 0, label: 'A', kind: 'junction' as const }]
  const graph: Graph = { nodes, edges: [] }
  const adjacency: AdjacencyEntry[] = [
    { to: 'gone', edgeId: 'ghost' },
    { to: 'a', edgeId: 'missing' },
  ]
  return {
    graph,
    size: 1,
    arcCount: 2,
    hasNode: (id: NodeId) => id === 'a',
    node: (id: NodeId) => graph.nodes.find((node) => node.id === id),
    edge: (id: EdgeId) => (graph.edges as GraphEdge[]).find((edge) => edge.id === id),
    neighboursOf: () => adjacency,
    edgesAt: () => [],
    componentOf: () => 0,
  }
}

describe('SearchRun.checkEndpoints', () => {
  it('reports an empty graph before it reports anything about the ids', () => {
    const refusal = heapRun(new AdjacencyGraph().seal(), 'north', 'south').checkEndpoints()
    expect(refusal?.reason).toBe('empty-graph')
    // The order is the point. With nothing on the map at all, "north is not a node" would send a reader off to
    // fix the wrong line of the file.
    expect(refusal?.message).toContain('no vertices')
  })

  it('names the origin before the destination when both are wrong', () => {
    expect(heapRun(square(), 'nope', 'also-nope').checkEndpoints()?.reason).toBe('unknown-origin')
    expect(heapRun(square(), 'a', 'also-nope').checkEndpoints()?.reason).toBe('unknown-destination')
  })

  it('rejects two components only when nothing is closed', () => {
    const index = twoComponents()
    const refusal = heapRun(index, 'a', 'c').checkEndpoints()
    expect(refusal?.reason).toBe('disconnected')
    expect(refusal?.message).toContain('component 0')
    expect(refusal?.message).toContain('component 1')
    // With a blocked set the precomputed partition cannot be trusted, so the search has to find out for
    // itself. `null` here means "ask me again at the end", not "there is a route".
    expect(heapRun(index, 'a', 'c', { blockedEdges: new Set(['ab']) }).checkEndpoints()).toBeNull()
  })

  it('says how many walkways were closed when the search ran out of map', () => {
    const run = heapRun(square(), 'a', 'c', { blockedEdges: new Set(['ab', 'ac', 'da']) })
    const result = run.checkEndpoints() === null ? drainFrom(run, 'a', 'c') : null
    expect(result?.ok).toBe(false)
    if (result?.ok === false) {
      expect(result.reason).toBe('disconnected')
      expect(result.message).toContain('3 walkway(s) are closed')
    }
  })

  it('treats origin and destination as one route, not as a failure', () => {
    const run = heapRun(square(), 'a', 'a')
    expect(run.isSamePlace()).toBe(true)
    expect(run.checkEndpoints()).toBeNull()
    const result = drainFrom(run, 'a', 'a')
    if (!result.ok) return expect(result.reason).toBe('a route was expected')
    expect(result.nodeIds).toEqual(['a'])
    expect(result.edgeIds).toEqual([])
    expect(result.hops).toBe(0)
    expect(result.metres).toBe(0)
    expect(result.minutes).toBe(0)
    // One expansion: the search draws the origin, sees it is the destination, and stops. Reporting 0 would
    // be defensible too, but `expanded` means "vertices drawn off the frontier", and one was drawn.
    expect(result.exploredOrder).toEqual(['a'])
    expect(result.steps).toEqual([{ direction: 'stay', instruction: 'You are already at Gate.', metres: 0, nodeIds: ['a'] }])
  })
})

describe('SearchRun frontier', () => {
  it('settles the cheapest first, and skips the entry a better record moved past', () => {
    const run = heapRun(square(), 'a', 'c')
    // Three offers by hand, cheapest last, which is the shape a relaxation makes when it first finds the long
    // way round. A heap with no decrease-key leaves the superseded entry sitting there; `next` must ignore it.
    run.offer({ id: 'b', via: 'a', edgeId: 'ab', priority: 100, cost: 100, metres: 100 })
    run.offer({ id: 'c', via: 'b', edgeId: 'bc', priority: 200, cost: 200, metres: 200 })
    run.offer({ id: 'c', via: 'a', edgeId: 'ac', priority: 250, cost: 250, metres: 250 })
    expect(run.next()?.id).toBe('b')
    const settled = run.next()
    expect(settled?.id).toBe('c')
    expect(settled?.cost).toBe(200)
    expect(settled?.via).toBe('b')
    expect(run.next()).toBeNull()
  })

  it('keeps the first parent a queue saw, which is what makes BFS hop-shortest', () => {
    const builder = new AdjacencyGraph()
    builder.addNode({ id: 'a', x: 0, y: 0 })
    builder.addNode({ id: 'b', x: 10, y: 0 })
    builder.addEdge({ id: 'far', from: 'a', to: 'b', metres: 300, attributes })
    builder.addEdge({ id: 'near', from: 'a', to: 'b', metres: 10, attributes })
    const index = builder.seal()

    const queue = new SearchRun(index, 'a', 'b', 'bfs')
    queue.offer({ id: 'a', via: null, edgeId: null, priority: 0, cost: 0, metres: 0 })
    const start = queue.next() as SettledVertex
    expect(start.id).toBe('a')
    const foundByQueue = queue.expand(start).offers.map((offer) => ({ ...offer, priority: offer.cost }))
    for (const offer of foundByQueue) queue.offer(offer)
    const settledQueue = queue.next()
    // Both arcs are one hop, so the first one recorded is the one that counts: BFS answers "how many
    // walkways", and it must not be influenced by which of two parallel paths happens to be longer.
    expect(settledQueue?.edgeId).toBe('far')
    expect(settledQueue?.metres).toBe(300)
    // A queue drains, and says so: `null`, not an exception and not the same vertex again.
    expect(queue.next()).toBeNull()

    const heap = new SearchRun(index, 'a', 'b', 'dijkstra')
    heap.offer({ id: 'a', via: null, edgeId: null, priority: 0, cost: 0, metres: 0 })
    const heapStart = heap.next() as SettledVertex
    for (const offer of heap.expand(heapStart).offers) heap.offer({ ...offer, priority: offer.cost })
    expect(heap.next()?.edgeId).toBe('near')
  })

  it('holds two identical offers without losing either or looping', () => {
    // Two parallel walkways of the same length between the same vertices: the comparator says `0`, so the
    // heap has no preference between them, and the run has to settle the vertex once and finish anyway. An
    // equal-priority pair is the one input a comparator container can get stuck on if the sift-up is written
    // with `<` where it means `<=`.
    const builder = new AdjacencyGraph()
    builder.addNode({ id: 'a', x: 0, y: 0 })
    builder.addNode({ id: 'b', x: 10, y: 0 })
    builder.addEdge({ id: 'left', from: 'a', to: 'b', metres: 12, attributes })
    builder.addEdge({ id: 'right', from: 'a', to: 'b', metres: 12, attributes })
    const index = builder.seal()
    const search = heapRun(index, 'a', 'b')
    const result = drainFrom(search, 'a', 'b')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cost).toBe(12)
    expect(result.nodeIds).toEqual(['a', 'b'])
    expect(result.exploredOrder).toEqual(['a', 'b'])
    // Whichever parallel edge the heap happened to draw first is the one that becomes the route.
    expect(['left', 'right']).toContain(result.edgeIds[0])
  })

  it('will not settle a vertex twice, so it is never re-offered either', () => {
    const run = heapRun(square(), 'a', 'c')
    run.offer({ id: 'b', via: 'a', edgeId: 'ab', priority: 1, cost: 1, metres: 1 })
    expect(run.next()?.id).toBe('b')
    run.offer({ id: 'b', via: 'c', edgeId: 'bc', priority: 0.5, cost: 0.5, metres: 0.5 })
    expect(run.next()).toBeNull()
  })

  it('snapshots the frontier once per settled vertex, in priority order with ties by id', () => {
    const run = heapRun(square(), 'a', 'c')
    const result = drainFrom(run, 'a', 'c')
    if (!result.ok) return expect(result.reason).toBe('a route was expected')
    expect(result.nodeIds).toEqual(['a', 'b', 'c'])
    expect(result.edgeIds).toEqual(['ab', 'bc'])
    expect(result.cost).toBe(200)
    expect(result.metres).toBe(200)
    expect(result.hops).toBe(2)
    expect(result.minutes).toBe(2.4)
    expect(result.exploredOrder).toEqual(['a', 'b', 'd', 'c'])
    expect(result.frontierSnapshots).toHaveLength(result.exploredOrder.length)
    // Frame 0 is empty because nothing had been offered yet when `a` was drawn. Frame 1 holds `d` at 100 and
    // `c` at 250 — the diagonal, before `b` had a chance to undercut it. Frame 2 holds only `c`, and only
    // once: the stale 250 entry is still physically in the heap, and drawing it would show a candidate the
    // search had already rejected. Frame 3 is the empty frontier the search stopped on.
    expect(result.frontierSnapshots).toEqual([[], ['d', 'c'], ['c'], []])
  })

  it('orders a frame by the priority, not by the order the heap happened to be built in', () => {
    // A heap is not a sort: two heaps holding the same three candidates can hold them in different array
    // orders, and a snapshot that leaked that order would make two identical searches look different.
    const forward = heapRun(square(), 'a', 'c')
    const backward = heapRun(square(), 'a', 'c')
    for (const offer of [
      { id: 'b', edgeId: 'ab', priority: 100 },
      { id: 'd', edgeId: 'da', priority: 100 },
      { id: 'c', edgeId: 'ac', priority: 250 },
    ]) {
      forward.offer({ ...offer, via: 'a', cost: offer.priority, metres: offer.priority })
    }
    for (const offer of [
      { id: 'c', edgeId: 'ac', priority: 250 },
      { id: 'd', edgeId: 'da', priority: 100 },
      { id: 'b', edgeId: 'ab', priority: 100 },
    ]) {
      backward.offer({ ...offer, via: 'a', cost: offer.priority, metres: offer.priority })
    }
    const first = forward.next()
    const firstAgain = backward.next()
    expect(first?.id).toBe(firstAgain?.id)
    expect(forward.next()).not.toBeNull()
    expect(backward.next()).not.toBeNull()
    // Same three candidates, same priorities, so the frames after the first draw must match even though the
    // two heaps were filled in opposite orders.
    const frameOf = (run: SearchRun): readonly NodeId[] => {
      const next = run.next()
      return next === null ? [] : [next.id]
    }
    expect(frameOf(forward)).toEqual(frameOf(backward))
  })

  it('records nothing per step when the caller asks not to trace', () => {
    const result = drainFrom(heapRun(square(), 'a', 'c', { trace: false }), 'a', 'c')
    if (!result.ok) return expect(result.reason).toBe('a route was expected')
    expect(result.frontierSnapshots).toEqual([])
    // `exploredOrder` still describes the search, because the overlay is what needs the snapshots and the
    // result card needs the count — turning the trace off must not cost either of them.
    expect(result.exploredOrder).toEqual(['a', 'b', 'd', 'c'])
  })
})

describe('SearchRun.expand', () => {
  it('will not walk a walkway that is closed for this query', () => {
    const run = heapRun(square(), 'a', 'c', { blockedEdges: new Set(['ab']) })
    expect(run.expand(origin('a')).offers.map((offer) => offer.id)).toEqual(['d', 'c'])
  })

  it('lets a profile close an edge by pricing it at Infinity', () => {
    const run = heapRun(square(), 'a', 'c', {
      cost: (edge) => (edge.id === 'ab' ? Number.POSITIVE_INFINITY : edge.metres),
    })
    expect(run.expand(origin('a')).offers.map((offer) => offer.id)).toEqual(['d', 'c'])
    // And the diagonal is still there, so closing one edge is not the same as losing a vertex.
    expect(run.expand(origin('a')).offers.some((offer) => offer.id === 'c')).toBe(true)
  })

  it('adds one per edge to a queue search and the weight to a heap search', () => {
    const index = square()
    const queue = new SearchRun(index, 'a', 'c', 'bfs')
    const heap = new SearchRun(index, 'a', 'c', 'dijkstra')
    expect(queue.expand(origin('a')).offers.map((offer) => offer.cost)).toEqual([1, 1, 1])
    expect(heap.expand(origin('a')).offers.map((offer) => offer.cost)).toEqual([100, 100, 250])
    // The length is the same either way, which is why the card can show metres for a hop-shortest route.
    expect(queue.expand(origin('a')).offers.map((offer) => offer.metres)).toEqual([100, 100, 250])
  })

  it('does not walk back into a vertex it has already settled', () => {
    const run = heapRun(square(), 'a', 'c')
    run.offer({ id: 'd', via: 'a', edgeId: 'da', priority: 100, cost: 100, metres: 100 })
    expect(run.next()?.id).toBe('d')
    const fromC = run.expand({ id: 'c', cost: 200, metres: 200, via: 'b', edgeId: 'bc' })
    expect(fromC.offers.map((offer) => offer.id)).not.toContain('d')
    expect(fromC.offers.map((offer) => offer.id)).toContain('b')
  })

  it('skips an adjacency entry whose edge the snapshot lost', () => {
    const expansion = heapRun(brokenIndex(), 'a', 'gone').expand(origin('a'))
    expect(expansion.offers).toEqual([])
    expect(expansion.badCost).toBeUndefined()
  })

  it.each([0, -3, Number.NaN, Number.NEGATIVE_INFINITY])('reports a cost of %s as a broken profile instead of routing around it', (value) => {
    const run = heapRun(square(), 'a', 'c', { cost: () => value })
    const expansion = run.expand(origin('a'))
    expect(expansion.offers).toEqual([])
    expect(expansion.badCost?.value).toBe(value)
    const refusal = run.refusedCost(expansion.badCost as { edgeId: EdgeId; value: number })
    expect(refusal.reason).toBe('invalid-graph')
    expect(refusal.message).toContain('walkway "ab"')
    expect(refusal.message).toContain('finite number greater than 0')
  })
})

describe('SearchRun result assembly', () => {
  it('rounds the pace to a tenth of a minute and quotes the profile it was told', () => {
    expect(minutesFor(100, 'fastest')).toBe(1.2)
    expect(minutesFor(100, 'step-free')).toBe(1.4)
    expect(minutesFor(0, 'quiet')).toBe(0)
    // 1.4 m/s is the number the result card shows, so it is pinned here rather than in a component.
    expect(minutesFor(1400, 'fastest')).toBe(16.7)
  })

  it('takes the profile into the result even though cost never read it', () => {
    const result = drainFrom(heapRun(square(), 'a', 'c', { profile: 'shaded' }), 'a', 'c')
    if (!result.ok) return expect(result.reason).toBe('a route was expected')
    expect(result.profile).toBe('shaded')
    // 200 m at the shaded pace is slower than at 1.4 m/s, and the route is the same one: a profile is a
    // *reading* of the graph until Phase 4 gives it a cost function to argue with.
    expect(result.minutes).toBe(2.7)
    expect(result.cost).toBe(200)
  })

  it('measures elapsed time from the injected clock, in whole milliseconds', () => {
    let now = 1_000
    const run = heapRun(square(), 'a', 'a', {
      now: () => {
        now += 37
        return now
      },
    })
    const result = drainFrom(run, 'a', 'a')
    if (!result.ok) return expect(result.reason).toBe('a route was expected')
    // One tick at construction, one at the report: the search itself does not read the clock.
    expect(result.ms).toBe(37)
  })

  it('refuses to report a negative duration when the machine clock went backwards', () => {
    // A clock corrected by NTP during a search is the only way this happens, and a card that says "-12 ms" is
    // a worse bug than one that says 0. The tick list is read once at construction and once at the report.
    const ticks = [1_000, 500]
    const run = heapRun(square(), 'a', 'a', { now: () => (ticks.shift() ?? 0) })
    const result = run.found(origin('a'))
    if (!result.ok) return expect(result.reason).toBe('a route was expected')
    expect(result.ms).toBe(0)
  })

  it('reports a run with no path as a result carrying the metrics it did collect', () => {
    const run = heapRun(twoComponents(), 'a', 'c', { blockedEdges: new Set(['ab']) })
    const result = drainFrom(run, 'a', 'c')
    expect(result.ok).toBe(false)
    if (result.ok) return expect(result.nodeIds).toEqual('nothing')
    // `a` was still settled, so the search is not being reported as having done nothing.
    expect(result.exploredOrder).toEqual(['a'])
    expect(result.frontierSnapshots).toEqual([[]])
    expect(result.algorithm).toBe('dijkstra')
    expect(result.cached).toBe(false)
  })
})
