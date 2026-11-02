import { describe, expect, it } from 'vitest'
import {
  BASE_SEED,
  createRandom,
  randomGraph,
  seedFrom,
  weakComponentsReference,
  type GeneratedGraph,
} from '../__tests__/helpers'
import { UnionFind, buildComponents, type GraphComponents } from './union-find'
import type { EdgeId, Graph, GraphEdge } from '../types'

/**
 * The reference for every structural claim here is a breadth-first search, not another
 * disjoint-set implementation: BFS is slow, obvious and written a different way, which is exactly
 * what a cross-check needs.
 */

function graphOf(generated: GeneratedGraph): Graph {
  const edges: GraphEdge[] = generated.edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    metres: edge.metres,
    attributes: {
      stairs: false,
      stepFree: true,
      shaded: false,
      lit: true,
      crowd: 0.2,
      surface: 'paved' as const,
      slope: 0,
    },
    oneWay: edge.oneWay,
  }))
  const graph: Graph = {
    nodes: generated.nodes.map((node) => ({
      id: node.id,
      label: node.id,
      kind: 'junction' as const,
      x: node.x,
      y: node.y,
    })),
    edges,
  }
  return graph
}

/**
 * Canonical form for comparing two partitions: sort inside each group, then order the groups by
 * their smallest member. Without this, two correct answers differ only by which component the
 * implementation happened to enumerate first — which is exactly the bug this project refuses to
 * have, so it must not be introduced by a test.
 */
function asGroups(groups: readonly (readonly string[])[]): string[][] {
  const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  return groups
    .map((group) => [...group].sort(byText))
    .sort((a, b) => byText(a[0] ?? '', b[0] ?? ''))
}

const triangle: Graph = {
  nodes: [
    { id: 'a', label: 'a', kind: 'junction', x: 0, y: 0 },
    { id: 'b', label: 'b', kind: 'junction', x: 10, y: 0 },
    { id: 'c', label: 'c', kind: 'junction', x: 5, y: 9 },
    { id: 'd', label: 'd', kind: 'place', x: 50, y: 50 },
  ],
  edges: [
    {
      id: 'ab',
      from: 'a',
      to: 'b',
      metres: 10,
      attributes: { stairs: false, stepFree: true, shaded: false, lit: true, crowd: 0, surface: 'paved', slope: 0 },
      oneWay: false,
    },
    {
      id: 'bc',
      from: 'b',
      to: 'c',
      metres: 10,
      attributes: { stairs: true, stepFree: false, shaded: false, lit: true, crowd: 0, surface: 'stairs', slope: 0 },
      oneWay: false,
    },
    {
      id: 'ca',
      from: 'c',
      to: 'a',
      metres: 10,
      attributes: { stairs: false, stepFree: true, shaded: true, lit: true, crowd: 0, surface: 'paved', slope: 0 },
      oneWay: false,
    },
  ],
}

describe('UnionFind', () => {
  it('starts empty and refuses to invent elements', () => {
    const sets = new UnionFind<string>()
    expect(sets.elementCount).toBe(0)
    expect(sets.componentCount).toBe(0)
    expect(sets.components()).toEqual([])
    expect(sets.elements()).toEqual([])
    expect(sets.has('a')).toBe(false)
    expect(sets.connected('a', 'b')).toBe(false)
    expect(sets.sizeOf('a')).toBe(0)
    expect(sets.members('a')).toEqual([])
    expect(() => sets.find('a')).toThrow(RangeError)
    expect(() => sets.depthOf('a')).toThrow(RangeError)
  })

  it('registers each element as its own component', () => {
    const sets = new UnionFind<string>(['a', 'b', 'c'])
    expect(sets.componentCount).toBe(3)
    expect(sets.add('a')).toBe(false)
    expect(sets.add('d')).toBe(true)
    expect(sets.componentCount).toBe(4)
    expect(sets.maxDepth()).toBe(0)
  })

  it('unions, returns the surviving root, and connects both ways', () => {
    const sets = new UnionFind<string>(['a', 'b', 'c'])
    expect(sets.union('a', 'b')).toBe('a') // equal ranks: the lower id wins
    expect(sets.connected('a', 'b')).toBe(true)
    expect(sets.connected('b', 'a')).toBe(true)
    expect(sets.connected('a', 'c')).toBe(false)
    expect(sets.union('c', 'a')).toBe('a')
    expect(sets.componentCount).toBe(1)
    expect(sets.sizeOf('c')).toBe(3)
    expect(sets.members('b')).toEqual(['a', 'b', 'c'])
  })

  it('is idempotent: the same union twice changes nothing', () => {
    const sets = new UnionFind<string>(['a', 'b'])
    sets.union('a', 'b')
    const before = sets.stats
    expect(sets.union('b', 'a')).toBe('a')
    expect(sets.componentCount).toBe(before.components)
    expect(sets.members('a')).toEqual(['a', 'b'])
    expect(sets.union('a', 'a')).toBe('a')
  })

  it('compresses a path exactly once, then does no work on it again', () => {
    // b → a ← c ← d, i.e. d sits two levels down before anything is compressed.
    const sets = new UnionFind<string>(['a', 'b', 'c', 'd'])
    sets.union('a', 'b') // a is root, rank 1
    sets.union('c', 'd') // c is root, rank 1
    sets.union('c', 'a') // equal ranks, 'a' < 'c' → c hangs off a, so d is at depth 2
    expect(sets.depthOf('d')).toBe(2)
    sets.resetStats()
    expect(sets.find('d')).toBe('a')
    expect(sets.stats.compressions).toBe(1) // only 'd' moved; 'c' was already one step from a
    expect(sets.depthOf('d')).toBe(1)
    expect(sets.depthOf('c')).toBe(1)
    sets.resetStats()
    expect(sets.find('d')).toBe('a')
    expect(sets.stats.compressions).toBe(0)
  })

  it('keeps a hand-built tree at exactly the depth union-by-rank promises', () => {
    // The regression this pins: depthOf once walked from the root and answered 0 for everything,
    // which still satisfied the log bound below. An exact number is the only assertion that sees
    // it.
    const sets = new UnionFind<string>(['a', 'b', 'c', 'd', 'e'])
    sets.union('a', 'b')
    sets.union('c', 'd')
    sets.union('a', 'c')
    expect([sets.depthOf('a'), sets.depthOf('b'), sets.depthOf('c'), sets.depthOf('d')]).toEqual([
      0, 1, 1, 2,
    ])
    expect(sets.depthOf('e')).toBe(0)
    expect(sets.maxDepth()).toBe(2)
  })

  it('joins a whole chain into one component but random unions do not', () => {
    const count = 5000
    const ids = Array.from({ length: count }, (_, i) => `n${i}`)
    const chain = new UnionFind<string>(ids)
    for (let i = 1; i < ids.length; i++) chain.union(ids[i - 1] as string, ids[i] as string)
    expect(chain.componentCount).toBe(1)
    expect(chain.sizeOf('n0')).toBe(count)

    // 10 000 *random* pairs over 5 000 elements leave plenty of singletons behind. The number is
    // pinned so a future "optimisation" that quietly merges everything cannot pass this test.
    const rng = createRandom(seedFrom('union-find/random'))
    const random = new UnionFind<string>(ids)
    for (let i = 0; i < 10000; i++) {
      const a = rng.pick(ids) as string
      const b = rng.pick(ids) as string
      random.union(a, b)
    }
    expect(random.componentCount).toBeGreaterThan(1)
    expect(random.componentCount).toBeLessThan(count)
  })

  it('holds the rank bound at n = 5000', () => {
    const count = 5000
    const ids = Array.from({ length: count }, (_, i) => `n${i}`)
    const rng = createRandom(BASE_SEED + 7)
    const sets = new UnionFind<string>(ids)
    for (let i = 0; i < 10000; i++) {
      sets.union(rng.pick(ids) as string, rng.pick(ids) as string)
    }
    // Union by rank guarantees depth <= log2(size). Without the bound this is just a number.
    expect(sets.maxDepth()).toBeLessThanOrEqual(Math.ceil(Math.log2(count)))
    expect(sets.maxDepth()).toBeGreaterThan(0)
  })

  it('orders components and members deterministically', () => {
    const build = (order: readonly string[]): UnionFind<string> => {
      const sets = new UnionFind<string>(order)
      sets.union('b', 'd')
      sets.union('a', 'c')
      sets.union('c', 'b')
      sets.add('z')
      return sets
    }
    const forward = build(['a', 'b', 'c', 'd', 'z'])
    const backward = build(['z', 'd', 'c', 'b', 'a'])
    expect(forward.components()).toEqual(backward.components())
    expect(forward.components()).toEqual([
      ['a', 'b', 'c', 'd'],
      ['z'],
    ])
    expect(forward.members('d')).toEqual(forward.members('a'))
  })

  it('answers probes about unknown elements softly and lookups loudly', () => {
    const sets = new UnionFind<string>(['a'])
    expect(sets.connected('a', 'ghost')).toBe(false)
    expect(sets.members('ghost')).toEqual([])
    expect(sets.sizeOf('ghost')).toBe(0)
    expect(() => sets.union('a', 'ghost')).toThrow(RangeError)
    expect(() => sets.find('ghost')).toThrow(RangeError)
  })
})

describe('buildComponents', () => {
  it('groups a triangle and reports the stranded node', () => {
    const result = buildComponents(triangle)
    expect(result.count).toBe(2)
    expect(result.members(0)).toEqual(['a', 'b', 'c'])
    expect(result.members(1)).toEqual(['d'])
    expect(result.isolated).toEqual(['d'])
    expect(result.ignoredEdges).toEqual([])
    expect(result.componentOf('a')).toBe(result.componentOf('c'))
    expect(result.componentOf('d')).toBe(1)
    expect(result.componentOf('nope')).toBe(-1)
  })

  it('splits on blocked edges, read by reference', () => {
    // Closing 'bc', 'ca' and 'cd' leaves {a,b} | {c} | {d}: three components, not two — 'c' is
    // stranded on its own, which is the answer a router needs.
    const blocked = new Set<EdgeId>(['bc', 'ca'])
    const withClosure = buildComponents(triangle, { blockedEdges: blocked })
    expect(withClosure.count).toBe(3)
    expect(withClosure.members(0)).toEqual(['a', 'b'])
    expect(withClosure.members(1)).toEqual(['c'])
    expect(withClosure.members(2)).toEqual(['d'])
    expect(withClosure.ignoredEdges).toEqual(['bc', 'ca'])

    // The Set is not copied, so one mutation plus a rebuild is the whole cost of a sweep — this is
    // the evidence behind "blocking an edge never clones the graph".
    blocked.add('ab')
    const swept = buildComponents(triangle, { blockedEdges: blocked })
    expect(swept.count).toBe(4)
    expect(swept.isolated).toEqual(['a', 'b', 'c', 'd'])
  })

  it('uses weak connectivity, ignores self-loops and dangling endpoints', () => {
    const oneWay: Graph = {
      nodes: [
        { id: 'hub', label: 'hub', kind: 'junction', x: 0, y: 0 },
        { id: 'out', label: 'out', kind: 'place', x: 5, y: 0 },
        { id: 'loop', label: 'loop', kind: 'place', x: 9, y: 9 },
      ],
      edges: [
        {
          id: 'e-hub-out',
          from: 'hub',
          to: 'out',
          metres: 5,
          attributes: { stairs: false, stepFree: true, shaded: false, lit: true, crowd: 0, surface: 'paved', slope: 0 },
          oneWay: true,
        },
        {
          id: 'e-loop',
          from: 'loop',
          to: 'loop',
          metres: 2,
          attributes: { stairs: false, stepFree: true, shaded: false, lit: true, crowd: 0, surface: 'paved', slope: 0 },
          oneWay: false,
        },
        {
          id: 'e-dangling',
          from: 'hub',
          to: 'ghost',
          metres: 3,
          attributes: { stairs: false, stepFree: true, shaded: false, lit: true, crowd: 0, surface: 'paved', slope: 0 },
          oneWay: false,
        },
      ],
    }
    const result: GraphComponents = buildComponents(oneWay)
    // 'out' cannot reach 'hub' along a one-way edge, yet they share a component: this is the
    // region question, not the walk question.
    expect(result.count).toBe(2)
    expect(result.members(0)).toEqual(['hub', 'out'])
    // A self-loop is incident and useless, so 'loop' counts as stranded.
    expect(result.isolated).toEqual(['loop'])
    expect(result.ignoredEdges).toEqual(['e-loop', 'e-dangling'])

    // The skip predicate is the profile hook: step-free routing sees the same graph as a closure.
    const stepFree = buildComponents(oneWay, {
      skip: (edge) => edge.attributes.stairs,
    })
    expect(stepFree.count).toBe(2)
  })

  it('agrees with BFS over 200 random graphs, and again under closures', () => {
    const rng = createRandom(seedFrom('union-find/vs-bfs'))
    for (let trial = 0; trial < 200; trial++) {
      const nodeCount = 2 + rng.int(30)
      const generated = randomGraph(nodeCount, rng, {
        extraEdges: rng.int(nodeCount * 2),
        disconnected: rng.bool(0.4),
        oneWayChance: rng.bool(0.5) ? 0.4 : 0,
      })
      const graph = graphOf(generated)

      const mine = asGroups(buildComponents(graph).unionFind.components())
      const theirs = asGroups(weakComponentsReference(graph.nodes, graph.edges))
      expect(mine, `trial ${trial}`).toEqual(theirs)

      // Random closures, checked against the same oracle with those edges removed.
      const blocked = new Set<EdgeId>()
      for (const edge of generated.edges) if (rng.bool(0.25)) blocked.add(edge.id)
      const closed = buildComponents(graph, { blockedEdges: blocked })
      const closedReference = weakComponentsReference(graph.nodes, graph.edges, blocked)
      expect(asGroups(closed.unionFind.components()), `trial ${trial} blocked`).toEqual(
        asGroups(closedReference),
      )
      const stranded = closed.isolated
      const expectedStranded = graph.nodes
        .filter(
          (node) =>
            !generated.edges.some(
              (edge) => !blocked.has(edge.id) && (edge.from === node.id || edge.to === node.id) && edge.from !== edge.to,
            ),
        )
        .map((node) => node.id)
      expect([...stranded].sort(), `trial ${trial} isolated`).toEqual(expectedStranded.sort())
    }
  })

  it('reports stranded nodes in graph.nodes order, not in component order', () => {
    // Two stranded places, listed in the source order of each copy. If `isolated` were derived
    // from the union-find Map instead of `graph.nodes`, these two would not agree.
    const edges = triangle.edges.filter((edge) => edge.id !== 'bc' && edge.id !== 'ca')
    const forward: Graph = { nodes: [...triangle.nodes], edges }
    const reversed: Graph = { nodes: [...triangle.nodes].reverse(), edges }
    expect(buildComponents(forward).isolated).toEqual(['c', 'd'])
    expect(buildComponents(reversed).isolated).toEqual(['d', 'c'])
    expect(buildComponents(forward).count).toBe(buildComponents(reversed).count)
  })
})
