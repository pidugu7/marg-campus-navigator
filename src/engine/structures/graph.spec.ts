import { describe, expect, it } from 'vitest'
import { BASE_SEED, createRandom, randomGraph } from '../__tests__/helpers'
import { DEFAULT_EDGE_ATTRIBUTES } from '../constants'
import {
  AdjacencyGraph,
  createGraph,
  validateGraph,
  type EdgeInput,
  type NodeInput,
} from './graph'
import type { AdjacencyEntry, Bounds, Graph, GraphEdge, GraphIssue, GraphNode, NodeId } from '../types'

const NODES: NodeInput[] = [
  { id: 'a', x: 0, y: 0, label: 'Main Gate', kind: 'gate', zone: 'north' },
  { id: 'b', x: 40, y: 0 },
  { id: 'c', x: 40, y: 55, label: 'Library', kind: 'place' },
]

const EDGES: EdgeInput[] = [
  { id: 'ab', from: 'a', to: 'b', metres: 40 },
  { id: 'bc', from: 'b', to: 'c', metres: 55 },
]

const line = () => createGraph(NODES, EDGES)

const codesOf = (issues: readonly GraphIssue[]): string[] => issues.map((entry) => entry.code)

describe('AdjacencyGraph construction', () => {
  it('accepts the smallest graph that means anything: one node, no edges', () => {
    const solo = createGraph([{ id: 'solo', x: 5, y: 5, label: 'Pavilion', kind: 'place' }], [])
    expect(solo.size).toBe(1)
    expect(solo.edgeCount).toBe(0)
    expect(solo.arcCount).toBe(0)
    expect(solo.degree('solo')).toBe(0)
    expect(solo.neighboursOf('solo')).toEqual([])
    expect(solo.componentOf('solo')).toBe(0)
    expect(solo.components().count).toBe(1)
    // Valid, yet reported: a place nothing can reach is a data problem the builder must surface.
    expect(codesOf(solo.validate())).toEqual(['isolated-node'])
  })

  it('accepts the empty graph', () => {
    const empty = new AdjacencyGraph().seal()
    expect(empty.size).toBe(0)
    expect(empty.arcCount).toBe(0)
    expect(empty.graph).toEqual({ nodes: [], edges: [] })
    expect(empty.validate()).toEqual([])
    expect(empty.components().count).toBe(0)
    expect(empty.componentOf('nope')).toBe(-1)
    expect(empty.degree('nope')).toBe(-1)
  })

  it('fills in defaults and keeps `zone` absent rather than undefined', () => {
    const graph = line()
    const a = graph.node('a')
    const b = graph.node('b')
    expect(a).toEqual({ id: 'a', x: 0, y: 0, label: 'Main Gate', kind: 'gate', zone: 'north' })
    expect(b).toEqual({ id: 'b', x: 40, y: 0, label: '', kind: 'junction' })
    expect('zone' in (b as object)).toBe(false)
    expect(graph.edge('ab')?.attributes).toEqual(DEFAULT_EDGE_ATTRIBUTES)
    expect(graph.edge('ab')?.oneWay).toBe(false)
  })

  it('merges partial attributes over the defaults', () => {
    const graph = createGraph(NODES, [
      { id: 'ab', from: 'a', to: 'b', metres: 40, attributes: { stairs: true, stepFree: false } },
    ])
    expect(graph.edge('ab')?.attributes).toEqual({
      ...DEFAULT_EDGE_ATTRIBUTES,
      stairs: true,
      stepFree: false,
    })
  })

  it('refuses every malformed construction, adding nothing on the way out', () => {
    const rejections: { label: string; run: (graph: AdjacencyGraph) => unknown }[] = [
      { label: 'duplicate node id', run: (g) => g.addNode({ id: 'a', x: 1, y: 1 }) },
      { label: 'blank node id', run: (g) => g.addNode({ id: '', x: 1, y: 1 }) },
      { label: 'NaN coordinate', run: (g) => g.addNode({ id: 'z', x: Number.NaN, y: 1 }) },
      { label: 'infinite coordinate', run: (g) => g.addNode({ id: 'z', x: 0, y: Number.POSITIVE_INFINITY }) },
      { label: 'duplicate edge id', run: (g) => g.addEdge({ id: 'ab', from: 'a', to: 'c', metres: 5 }) },
      { label: 'blank edge id', run: (g) => g.addEdge({ id: '', from: 'a', to: 'c', metres: 5 }) },
      { label: 'self-loop', run: (g) => g.addEdge({ id: 'xx', from: 'a', to: 'a', metres: 5 }) },
      { label: 'unknown endpoint', run: (g) => g.addEdge({ id: 'xx', from: 'a', to: 'ghost', metres: 5 }) },
      { label: 'zero length', run: (g) => g.addEdge({ id: 'xx', from: 'a', to: 'c', metres: 0 }) },
      { label: 'negative length', run: (g) => g.addEdge({ id: 'xx', from: 'a', to: 'c', metres: -3 }) },
      { label: 'NaN length', run: (g) => g.addEdge({ id: 'xx', from: 'a', to: 'c', metres: Number.NaN }) },
    ]
    for (const { label, run } of rejections) {
      const graph = new AdjacencyGraph()
      graph.addNode({ id: 'a', x: 0, y: 0 }).addNode({ id: 'c', x: 3, y: 4 })
      graph.addEdge({ id: 'ab', from: 'a', to: 'c', metres: 5 })
      expect(() => run(graph), label).toThrow(TypeError)
      expect([graph.size, graph.edgeCount], `${label} changed the graph`).toEqual([2, 1])
    }
  })

  it('stores an undirected edge twice and a one-way edge once', () => {
    const undirected = createGraph(NODES, [{ id: 'ab', from: 'a', to: 'b', metres: 40 }])
    expect(undirected.arcCount).toBe(2)
    expect(undirected.neighboursOf('b').map((entry) => entry.to)).toEqual(['a'])

    const oneWay = createGraph(NODES, [{ id: 'ab', from: 'a', to: 'b', metres: 40, oneWay: true }])
    expect(oneWay.arcCount).toBe(1)
    expect(oneWay.edgeCount).toBe(1)
    expect(oneWay.neighboursOf('a').map((entry) => entry.to)).toEqual(['b'])
    expect(oneWay.neighboursOf('b')).toEqual([])
    expect(oneWay.degree('b')).toBe(1) // incident, even when you cannot travel it
  })

  it('allows parallel edges and answers with the first stored', () => {
    const graph = createGraph(NODES, [
      { id: 'ramp', from: 'a', to: 'b', metres: 42, attributes: { stepFree: true } },
      { id: 'stair', from: 'a', to: 'b', metres: 30, attributes: { stairs: true, stepFree: false } },
    ])
    expect(graph.edgeCount).toBe(2)
    expect(graph.arcCount).toBe(4)
    expect(graph.edgesAt('a')).toEqual(['ramp', 'stair'])
    expect(graph.edgeBetween('a', 'b')?.id).toBe('ramp')
    expect(graph.edgeBetween('b', 'a')?.id).toBe('ramp') // either direction, same edge object
    // Non-adjacent is a plain `undefined`, not a throw: "is there a direct walkway" is a question a
    // caller is allowed to ask about any pair.
    expect(graph.edgeBetween('a', 'c')).toBeUndefined()
    expect(graph.edgeBetween('a', 'ghost')).toBeUndefined()
  })

  it('removeEdge takes both arcs away at construction time', () => {
    const build = (): AdjacencyGraph => {
      const graph = new AdjacencyGraph()
      for (const node of NODES) graph.addNode(node)
      for (const edge of EDGES) graph.addEdge(edge)
      return graph
    }

    const graph = build()
    expect(graph.removeEdge('ab')).toBe(true)
    expect(graph.removeEdge('ab')).toBe(false)
    // Removal and re-adding must both precede seal(), and reads must follow it: that is the
    // lifecycle the class enforces, so the test walks it in that order rather than around it.
    graph.seal()
    expect(graph.neighboursOf('a')).toEqual([])
    expect(graph.neighboursOf('b').map((entry) => entry.to)).toEqual(['c'])
    expect(graph.edgesAt('a')).toEqual([])
    expect(graph.degree('a')).toBe(0)
    expect(graph.edgeCount).toBe(1)
    expect(graph.arcCount).toBe(2)

    // The id is free again, which is what a reload of the same file needs.
    const reloaded = build()
    reloaded.removeEdge('ab')
    expect(() => reloaded.addEdge({ id: 'ab', from: 'a', to: 'c', metres: 60 })).not.toThrow()
    expect(reloaded.edgeCount).toBe(2)
    expect(() => reloaded.seal().removeEdge('ab')).toThrow(TypeError)
  })

  it('answers identity lookups while constructing and refuses traversals', () => {
    const graph = new AdjacencyGraph()
    graph.addNode({ id: 'a', x: 0, y: 0 })
    expect(graph.hasNode('a')).toBe(true)
    expect(graph.node('a')?.x).toBe(0)
    expect(graph.size).toBe(1)
    expect(graph.edgeCount).toBe(0)
    expect(codesOf(graph.validate())).toEqual(['isolated-node'])
    for (const read of [
      () => graph.neighboursOf('a'),
      () => graph.edgesAt('a'),
      () => graph.degree('a'),
      () => graph.edgeBetween('a', 'a'),
      () => graph.componentOf('a'),
      () => graph.components(),
      () => graph.arcCount,
      () => graph.graph,
      () => graph.toGraph(),
    ]) {
      expect(read).toThrow(TypeError)
    }
  })

  it('seals once, freezes everything, and refuses mutation afterwards', () => {
    const graph = new AdjacencyGraph()
    for (const node of NODES) graph.addNode(node)
    for (const edge of EDGES) graph.addEdge(edge)
    expect(graph.seal()).toBe(graph)
    expect(graph.seal()).toBe(graph) // idempotent
    expect(graph.sealed).toBe(true)

    expect(() => graph.addNode({ id: 'd', x: 1, y: 1 })).toThrow(TypeError)
    expect(() => graph.addEdge({ id: 'cd', from: 'c', to: 'd', metres: 5 })).toThrow(TypeError)
    expect(() => graph.removeEdge('ab')).toThrow(TypeError)

    const node = graph.node('a') as object
    expect(Object.isFrozen(node)).toBe(true)
    expect(() => {
      ;(node as { label: string }).label = 'changed'
    }).toThrow(TypeError)
    const edge = graph.edge('ab') as GraphEdge
    expect(Object.isFrozen(edge)).toBe(true)
    expect(Object.isFrozen(edge.attributes)).toBe(true)

    const adjacency = graph.neighboursOf('a')
    expect(() => (adjacency as unknown as AdjacencyEntry[]).push({ to: 'c', edgeId: 'ab' })).toThrow(TypeError)
    expect(() => {
      ;(graph.node('a') as { x: number }).x = 99
    }).toThrow(TypeError)
  })

  it('shares one frozen snapshot and hands out a copy that cannot reach back', () => {
    const graph = line()
    expect(graph.graph).toBe(graph.graph) // no per-call copy
    const copy = graph.toGraph()
    expect(copy).not.toBe(graph.graph)
    expect(copy.nodes).toHaveLength(3)
    expect(() => copy.nodes.push(copy.nodes[0] as GraphNode)).not.toThrow() // the array is the caller's
    expect(copy.nodes).toHaveLength(4)
    expect(graph.graph.nodes).toHaveLength(3) // and the graph never felt it
    expect(() => {
      ;(copy.nodes[0] as { label: string }).label = 'hijacked'
    }).toThrow(TypeError) // the node objects are still the frozen originals
  })

  it('reports components, and rebuilds them over a closure without touching the graph', () => {
    const graph = createGraph(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
        { id: 'c', x: 20, y: 0 },
        { id: 'island', x: 90, y: 90 },
      ],
      [
        { id: 'ab', from: 'a', to: 'b', metres: 10 },
        { id: 'bc', from: 'b', to: 'c', metres: 10 },
      ],
    )
    expect(graph.componentOf('a')).toBe(graph.componentOf('c'))
    expect(graph.componentOf('island')).not.toBe(graph.componentOf('a'))
    expect(graph.components().count).toBe(2)
    expect(graph.components().isolated).toEqual(['island'])

    const blocked = new Set<string>(['bc'])
    const closed = graph.components({ blockedEdges: blocked })
    expect(closed.count).toBe(3)
    expect(closed.members(1)).toEqual(['c'])
    expect(closed.isolated).toEqual(['c', 'island'])
    expect(graph.components().count).toBe(2) // the default partition was not disturbed
    expect(graph.edge('bc')).toBeDefined() // and the closure never edited the graph
  })

  it('caches the default partition and does not cache a blocked one', () => {
    const graph = line()
    expect(graph.components()).toBe(graph.components())
    const blocked = new Set<string>()
    expect(graph.components({ blockedEdges: blocked })).not.toBe(graph.components({ blockedEdges: blocked }))
    expect(graph.components({ blockedEdges: blocked }).count).toBe(1)
  })

  it('keeps the arc arithmetic honest on 100 random graphs', () => {
    const rng = createRandom(BASE_SEED + 211)
    for (let trial = 0; trial < 100; trial++) {
      const generated = randomGraph(2 + rng.int(24), rng, {
        extraEdges: rng.int(20),
        disconnected: rng.bool(0.3),
        oneWayChance: 0.35,
      })
      const nodes: NodeInput[] = generated.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y }))
      const edges: EdgeInput[] = generated.edges.map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        metres: edge.metres,
        oneWay: edge.oneWay,
      }))
      // randomGraph may emit a self-loop or an edge to a node it never made; both are refused, so
      // filter the same way the loader does and check the arithmetic on what survives.
      const known = new Set(nodes.map((node) => node.id))
      const usable = edges.filter((edge) => edge.from !== edge.to && known.has(edge.from) && known.has(edge.to))
      const seen = new Set<string>()
      const built = usable.filter((edge) => {
        if (seen.has(edge.id)) return false
        seen.add(edge.id)
        return true
      })
      const graph = createGraph(nodes, built)
      const expectedArcs = built.reduce((total, edge) => total + (edge.oneWay ? 1 : 2), 0)
      expect(graph.arcCount, `trial ${trial}`).toBe(expectedArcs)
      let adjacencyTotal = 0
      for (const node of nodes) adjacencyTotal += graph.neighboursOf(node.id as NodeId).length
      expect(adjacencyTotal, `trial ${trial} adjacency`).toBe(expectedArcs)
      // Every stored edge is reachable from both of its endpoints (or one, if it is one-way).
      for (const edge of built) {
        const forward = graph.neighboursOf(edge.from).some((entry) => entry.edgeId === edge.id)
        const back = graph.neighboursOf(edge.to).some((entry) => entry.edgeId === edge.id)
        expect(forward, `trial ${trial} ${edge.id} forward`).toBe(true)
        expect(back).toBe(edge.oneWay ? false : true)
      }
    }
  })
})

describe('validateGraph', () => {
  const attrs = DEFAULT_EDGE_ATTRIBUTES

  it('reports each issue code on its own, from a graph that was never built by the class', () => {
    const cases: { code: string; graph: Graph; options?: { bounds?: Bounds } }[] = [
      {
        code: 'duplicate-node-id',
        graph: {
          nodes: [
            { id: 'x', label: '', kind: 'junction', x: 0, y: 0 },
            { id: 'x', label: '', kind: 'junction', x: 1, y: 1 },
          ],
          edges: [],
        },
      },
      {
        code: 'duplicate-edge-id',
        graph: {
          nodes: [
            { id: 'p', label: '', kind: 'junction', x: 0, y: 0 },
            { id: 'q', label: '', kind: 'junction', x: 1, y: 0 },
          ],
          edges: [
            { id: 'pq', from: 'p', to: 'q', metres: 1, attributes: attrs, oneWay: false },
            { id: 'pq', from: 'q', to: 'p', metres: 2, attributes: attrs, oneWay: false },
          ],
        },
      },
      {
        code: 'dangling-edge-endpoint',
        graph: {
          nodes: [{ id: 'p', label: '', kind: 'junction', x: 0, y: 0 }],
          edges: [{ id: 'pq', from: 'p', to: 'ghost', metres: 1, attributes: attrs, oneWay: false }],
        },
      },
      {
        code: 'self-loop',
        graph: {
          nodes: [
            { id: 'p', label: '', kind: 'junction', x: 0, y: 0 },
            { id: 'q', label: '', kind: 'junction', x: 1, y: 0 },
          ],
          edges: [
            { id: 'pp', from: 'p', to: 'p', metres: 1, attributes: attrs, oneWay: false },
            { id: 'pq', from: 'p', to: 'q', metres: 1, attributes: attrs, oneWay: false },
          ],
        },
      },
      {
        code: 'non-positive-length',
        graph: {
          nodes: [
            { id: 'p', label: '', kind: 'junction', x: 0, y: 0 },
            { id: 'q', label: '', kind: 'junction', x: 1, y: 0 },
          ],
          edges: [{ id: 'pq', from: 'p', to: 'q', metres: 0, attributes: attrs, oneWay: false }],
        },
      },
      {
        code: 'non-finite-coordinate',
        graph: {
          nodes: [
            { id: 'p', label: '', kind: 'junction', x: Number.NaN, y: 0 },
            { id: 'q', label: '', kind: 'junction', x: 1, y: 0 },
          ],
          edges: [{ id: 'pq', from: 'p', to: 'q', metres: 1, attributes: attrs, oneWay: false }],
        },
      },
      {
        code: 'attribute-out-of-range',
        graph: {
          nodes: [
            { id: 'p', label: '', kind: 'junction', x: 0, y: 0 },
            { id: 'q', label: '', kind: 'junction', x: 1, y: 0 },
          ],
          edges: [
            {
              id: 'pq',
              from: 'p',
              to: 'q',
              metres: 1,
              attributes: { ...attrs, crowd: 1.4, slope: Number.NaN },
              oneWay: false,
            },
          ],
        },
      },
      {
        code: 'isolated-node',
        graph: {
          nodes: [
            { id: 'p', label: '', kind: 'junction', x: 0, y: 0 },
            { id: 'q', label: '', kind: 'junction', x: 1, y: 0 },
            { id: 'lonely', label: '', kind: 'place', x: 5, y: 5 },
          ],
          edges: [{ id: 'pq', from: 'p', to: 'q', metres: 1, attributes: attrs, oneWay: false }],
        },
      },
      {
        code: 'node-outside-canvas',
        graph: {
          nodes: [
            { id: 'p', label: '', kind: 'junction', x: 4000, y: 0 },
            { id: 'q', label: '', kind: 'junction', x: 1, y: 0 },
          ],
          edges: [{ id: 'pq', from: 'p', to: 'q', metres: 1, attributes: attrs, oneWay: false }],
        },
      },
    ]

    for (const testCase of cases) {
      const options = testCase.code === 'node-outside-canvas' ? { bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } } : {}
      const issues = validateGraph(testCase.graph, options)
      expect(codesOf(issues), testCase.code).toContain(testCase.code)
      for (const found of issues) {
        expect(['error', 'warning']).toContain(found.severity)
        expect(found.message.length).toBeGreaterThan(10)
        expect(found.nodeId ?? found.edgeId, `${testCase.code} names a subject`).toBeDefined()
      }
    }
  })

  it('separates legal metres from an illegal cost', () => {
    const graph: Graph = {
      nodes: [
        { id: 'p', label: '', kind: 'junction', x: 0, y: 0 },
        { id: 'q', label: '', kind: 'junction', x: 10, y: 0 },
      ],
      edges: [
        {
          id: 'pq',
          from: 'p',
          to: 'q',
          metres: 10,
          attributes: { ...attrs, crowd: 0.5 },
          oneWay: false,
        },
      ],
    }
    expect(validateGraph(graph)).toEqual([])
    const free = () => 0 // a profile that prices a shortcut at nothing: Dijkstra stops being sound
    const issues = validateGraph(graph, { cost: free })
    expect(codesOf(issues)).toEqual(['non-positive-cost'])
    expect(issues[0]?.severity).toBe('error')
    expect(validateGraph(graph, { cost: () => Number.NaN })).toHaveLength(1)
    expect(validateGraph(graph, { cost: (edge) => edge.metres })).toEqual([])
  })

  it('sorts errors before warnings, then by code, then by id', () => {
    const graph: Graph = {
      nodes: [
        { id: 'zz', label: '', kind: 'junction', x: Number.NaN, y: 0 },
        { id: 'aa', label: '', kind: 'junction', x: 5, y: 5 },
        { id: 'mm', label: '', kind: 'junction', x: 6, y: 6 },
      ],
      edges: [
        { id: 'e1', from: 'zz', to: 'aa', metres: -1, attributes: attrs, oneWay: false },
        { id: 'e2', from: 'aa', to: 'mm', metres: 5, attributes: { ...attrs, crowd: 9 }, oneWay: false },
      ],
    }
    const issues = validateGraph(graph)
    expect(issues.map((entry) => `${entry.severity}:${entry.code}`)).toEqual([
      'error:non-finite-coordinate',
      'error:non-positive-length',
      'warning:attribute-out-of-range',
    ])
  })

  it('accepts a graph the builder produced without complaint', () => {
    expect(line().validate()).toEqual([])
    expect(line().validate({ bounds: { minX: -1, minY: -1, maxX: 100, maxY: 100 } })).toEqual([])
    expect(line().validate({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }).length).toBeGreaterThan(0)
    expect(createGraph(NODES, EDGES, { seal: false }).sealed).toBe(false)
  })
})
