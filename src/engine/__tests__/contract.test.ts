import { describe, expect, it } from 'vitest'
import {
  COST_EPSILON,
  DEFAULT_EDGE_ATTRIBUTES,
  ENGINE_VERSION,
  MIN_SEGMENT_METRES,
  WALKING_SPEED_MPS,
} from '../index'
import type { Graph, GraphEdge, GraphIndex, GraphNode, RouteResult } from '../index'

/**
 * The one test Phase 0 can honestly have: the barrel exposes what it claims,
 * and the graph contract can actually be satisfied by hand-written data. When
 * structures/algorithms land, this file grows into the integration specs that
 * read the campus graph through the public surface only.
 */
describe('engine public surface', () => {
  it('exports a version marker so the UI can prove which engine it is wired to', () => {
    expect(typeof ENGINE_VERSION).toBe('string')
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+-/)
  })

  it('exposes the numeric invariants as frozen, finite values', () => {
    expect(COST_EPSILON).toBeGreaterThan(0)
    expect(MIN_SEGMENT_METRES).toBeGreaterThan(0)
    expect(Number.isFinite(DEFAULT_EDGE_ATTRIBUTES.crowd)).toBe(true)
    for (const [profile, speed] of Object.entries(WALKING_SPEED_MPS)) {
      expect(speed, `walking pace for "${profile}"`).toBeGreaterThan(0)
    }
  })

  it('accepts a hand-written graph with no builder, cast or helper', () => {
    const nodes: readonly GraphNode[] = [
      { id: 'gate-1', label: 'Main Gate', kind: 'gate', x: 0, y: 0, zone: 'arrival' },
      { id: 'jquad', label: 'Quad Crossing', kind: 'junction', x: 40, y: 0 },
      { id: 'lib', label: 'Central Library', kind: 'place', x: 40, y: 55, zone: 'academic' },
    ]

    const edge = (id: string, from: string, to: string, metres: number): GraphEdge => ({
      id,
      from,
      to,
      metres,
      attributes: DEFAULT_EDGE_ATTRIBUTES,
      oneWay: false,
    })

    const graph: Graph = {
      nodes,
      edges: [edge('e1', 'gate-1', 'jquad', 40), edge('e2', 'jquad', 'lib', 55)],
    }

    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges.every((e) => e.metres > 0)).toBe(true)

    // A result object is constructible from the contract alone — i.e. nothing
    // in the route shape depends on a class identity or a private field.
    const result: RouteResult = {
      ok: true,
      algorithm: 'a-star',
      profile: 'fastest',
      expanded: 3,
      ms: 0,
      cached: false,
      nodeIds: ['gate-1', 'jquad', 'lib'],
      edgeIds: ['e1', 'e2'],
      cost: 95,
      metres: 95,
      hops: 2,
      minutes: 95 / (WALKING_SPEED_MPS['fastest'] ?? 1.4) / 60,
      steps: [],
      exploredOrder: ['gate-1', 'jquad', 'lib'],
    }
    expect(result.ok && result.hops).toBe(2)
  })

  it('keeps GraphIndex an interface (implementable by a plain object literal)', () => {
    const index: GraphIndex = {
      graph: { nodes: [], edges: [] },
      size: 0,
      arcCount: 0,
      hasNode: () => false,
      node: () => undefined,
      edge: () => undefined,
      neighboursOf: () => [],
      edgesAt: () => [],
      componentOf: () => -1,
    }
    expect(index.size).toBe(0)
    expect(index.neighboursOf('missing')).toEqual([])
  })
})
