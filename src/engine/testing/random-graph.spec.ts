/**
 * The generator `npm run bench` and every seeded engine spec share.
 *
 * This is not a test of randomness in the statistical sense; it is a test of the *contract* the sweeps rely
 * on. Four claims, each of which some spec somewhere assumes: the same seed draws the same graph, a graph is
 * connected unless it was asked not to be, the ugly cases (self-loops, duplicate edges) really do appear so a
 * search that only works on a simple graph cannot pass for 40 trials by luck, and `indexOfGraph` is the only
 * place a generated graph becomes a `GraphIndex` — which is what makes an oracle and the implementation disagree
 * about something real rather than about their fixtures.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE_ATTRIBUTES } from '../constants'
import { weakComponentsReference, createRandom, seedFrom } from '../__tests__/helpers'
import { indexOfGraph, randomGraph } from './random-graph'

function draw(tag: string, nodeCount = 14, options: Parameters<typeof randomGraph>[2] = {}) {
  return randomGraph(nodeCount, createRandom(seedFrom(tag)), options)
}

function shape(graph: ReturnType<typeof randomGraph>): string {
  return JSON.stringify({ nodes: graph.nodes, edges: graph.edges })
}

describe('the seeded graph generator', () => {
  it('draws the same graph from the same seed, and a different one from a different seed', () => {
    expect(shape(draw('random-graph/determinism'))).toBe(shape(draw('random-graph/determinism')))
    expect(shape(draw('random-graph/a'))).not.toBe(shape(draw('random-graph/b')))
    // A seed of 0 must be as usable as any other, since `seedFrom` can produce it and `>>> 0` would happily
    // leave a generator parked at its initial state if the state were treated as falsy.
    expect(shape(randomGraph(6, createRandom(0)))).not.toBe(shape(randomGraph(6, createRandom(1))))
  })

  it('is connected unless told not to be, because every sweep assumes a route exists', () => {
    for (const nodeCount of [2, 7, 40, 200]) {
      const graph = draw(`random-graph/connected/${String(nodeCount)}`, nodeCount)
      expect(graph.nodes).toHaveLength(nodeCount)
      expect(weakComponentsReference(graph.nodes, graph.edges)).toHaveLength(1)
    }
    // `disconnected: true` is "leave some vertices unconnected", and the split point is drawn rather than fixed,
    // so the honest claim is that the switch changes the distribution: it splits sometimes, and it does not split
    // always. "Always" would be wrong, because the extra edges are drawn over the whole vertex list and can
    // re-attach the orphan the tree skipped — measured as 6 of 12 seeds here, which is the mixture a search spec
    // needs if it is to meet both a one-component map and a fragmented one.
    let splits = 0
    for (let trial = 0; trial < 12; trial++) {
      const graph = draw(`random-graph/disconnected/${String(trial)}`, 24, { disconnected: true })
      expect(graph.nodes).toHaveLength(24)
      if (weakComponentsReference(graph.nodes, graph.edges).length > 1) splits += 1
    }
    expect(splits).toBeGreaterThan(0)
    expect(splits).toBeLessThan(12)
  })

  it('gives the generator itself the answers its type promises', () => {
    // `pick` on an empty array returns `undefined` rather than throwing, which every call site above relies on
    // and none of them can reach: a graph with no vertices has no edges to draw either. So the promise is
    // checked where it lives, on the interface `Rng` declares, with `?? null` turns in the callers kept honest.
    const rng = createRandom(seedFrom('random-graph/rng'))
    expect(rng.pick([])).toBeUndefined()
    expect(rng.pick(['only'])).toBe('only')
    expect(rng.int(1)).toBe(0)
    expect(rng.bool(1)).toBe(true)
    expect(rng.bool(0)).toBe(false)
    const coin = rng.bool()
    expect(typeof coin).toBe('boolean')
    expect(rng.shuffle([])).toEqual([])
  })

  it('degenerates without complaint at one vertex, where there is no tree to lay', () => {
    const one = draw('random-graph/single', 1)
    expect(one.nodes).toHaveLength(1)
    // The spanning tree has nothing to lay, but the extra-edge loop still runs, and with one vertex both of its
    // endpoints must be that vertex: the generator emits a self-loop here, and `indexOfGraph` is what refuses it.
    expect(one.edges.every((edge) => edge.from === edge.to)).toBe(true)
    const sealed = indexOfGraph(one)
    expect(sealed.size).toBe(1)
    expect(sealed.arcCount).toBe(0)
    // Two vertices, disconnected from the first draw onward: the split point cannot be 0, and the span of the
    // tree is `1..length-1`, so a two-vertex graph is either one edge or none — both legal, neither a crash.
    for (let trial = 0; trial < 6; trial++) {
      const pair = randomGraph(2, createRandom(seedFrom(`random-graph/pair/${String(trial)}`)), { disconnected: true })
      // One tree edge at most, `extraEdges = 2` drawn over the whole vertex list: three is the ceiling, and
      // `disconnected: true` only says the tree may skip the first vertex — the extras can still join it back up.
      expect(pair.edges.length).toBeLessThanOrEqual(3)
    }
  })

  it('keeps the self-loops and duplicate edges, since a search must survive them rather than be fed simple ones', () => {
    let loops = 0
    let duplicates = 0
    for (let trial = 0; trial < 40; trial++) {
      const graph = draw(`random-graph/ugly/${String(trial)}`, 10, { extraEdges: 12 })
      const pairs = new Map<string, number>()
      for (const edge of graph.edges) {
        if (edge.from === edge.to) loops += 1
        const key = `${edge.from}>${edge.to}`
        pairs.set(key, (pairs.get(key) ?? 0) + 1)
      }
      for (const count of pairs.values()) if (count > 1) duplicates += count - 1
    }
    expect(loops, 'no self-loop in 40 trials would mean the generator stopped being honest').toBeGreaterThan(0)
    expect(duplicates).toBeGreaterThan(0)
  })

  it('honours extraEdges and oneWayChance, which is how the A* sweep gets a weighted variant', () => {
    const tree = draw('random-graph/tree-only', 12, { extraEdges: 0 })
    expect(tree.edges.length).toBe(11)
    const strict = draw('random-graph/one-way', 12, { oneWayChance: 1 })
    expect(strict.edges.every((edge) => edge.oneWay)).toBe(true)
    const open = draw('random-graph/two-way', 12)
    expect(open.edges.every((edge) => !edge.oneWay)).toBe(true)
  })

  it('drops self-loops and defaults attributes exactly once, in indexOfGraph', () => {
    const graph = draw('random-graph/index', 12, { extraEdges: 8 })
    // Loops are not guaranteed by one seed — the test above owns "they appear in the family" — so the
    // arithmetic below holds for either case, and it does: 0 loops here, still exact.
    const loops = graph.edges.filter((edge) => edge.from === edge.to).length
    const index = indexOfGraph(graph)
    // Two arcs per non-loop edge; a loop that had been added would have shown up as two more.
    expect(index.arcCount).toBe((graph.edges.length - loops) * 2)
    expect(index.size).toBe(graph.nodes.length)
    const first = graph.edges.find((edge) => edge.from !== edge.to)
    if (first === undefined) return expect.fail('this fixture has no usable edge')
    expect(index.edge(first.id)?.metres).toBe(first.metres)
    expect(index.edge(first.id)?.attributes).toEqual(DEFAULT_EDGE_ATTRIBUTES)
    // …and an attribute set for the whole graph reaches the edge, which is how a sweep prices a profile.
    const shaded = indexOfGraph(graph, { shaded: true })
    expect(shaded.edge(first.id)?.attributes.shaded).toBe(true)
    expect(shaded.edge(first.id)?.attributes.surface).toBe(DEFAULT_EDGE_ATTRIBUTES.surface)
  })
})
