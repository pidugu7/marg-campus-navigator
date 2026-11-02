/**
 * Depth-first search — reachability, cycles, and what would break if a place were removed.
 *
 * The route half of this file is the least flattering test in the project: `depthFirstRoute` is asked for a
 * route and is *allowed* to hand back one twice as long, because a stack takes whichever branch it opened last.
 * That is the behaviour the phase exists to demonstrate, so it is pinned as an expectation and not excused.
 *
 * The structure half is the part a viva is more likely to probe. `articulationPoints` reports cut vertices and
 * bridges from one low-link pass, and every reported vertex and edge is then **deleted from a rebuilt copy of
 * the graph and the components counted again** — by `weakComponentsReference`, which shares no code with the
 * DFS. A low-link implementation with an off-by-one in the `low` update can still print a plausible-looking set
 * of names; it cannot survive the deletion test, because the names it invented disconnect nothing and the ones
 * it missed do.
 *
 * And the third claim is engineering rather than theory: every walk here is on an explicit stack, so a graph
 * 5 000 vertices deep is a longer loop and not a `RangeError` in a browser. That is the difference between
 * "the campus is small" being a reason and being an excuse.
 */
import { describe, expect, it } from 'vitest'
import { articulationPoints, dfs, depthFirstRoute, reachableFrom } from './dfs'
import { dijkstra } from './dijkstra'
import {
  LADDER_COST,
  ladderBarbell,
  ladderCrossing,
  ladderIslands,
  ladderLine,
  ladderOneWay,
  ladderParallel,
  refusalLadder,
  unravelledIndex,
  sweepGraphs,
  weakComponentsReference,
  type LadderSpec,
} from '../__tests__/helpers'
import { AdjacencyGraph } from '../structures/graph'
import type { GraphIndex, RouteResult } from '../types'

function mustFind(result: RouteResult, where: string): Extract<RouteResult, { ok: true }> {
  if (result.ok) return result
  expect.fail(`${where}: refused with ${result.reason} — ${result.message}`)
}

/** A `ladderGraph` spec, so a fixture can be rebuilt with one vertex or one walkway taken out. */
function specOf(index: GraphIndex): LadderSpec {
  return {
    nodes: index.graph.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
    edges: index.graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      metres: edge.metres,
      oneWay: edge.oneWay,
    })),
  }
}

const build = (spec: LadderSpec): GraphIndex => {
  const builder = new AdjacencyGraph()
  for (const node of spec.nodes) builder.addNode({ id: node.id, x: node.x, y: node.y })
  for (const edge of spec.edges) {
    builder.addEdge({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      metres: edge.metres,
      oneWay: edge.oneWay ?? false,
    })
  }
  return builder.seal()
}

/** Weak components of `spec` minus one vertex (and everything touching it), or minus one walkway. */
function componentsWithout(spec: LadderSpec, removedNode: string | null, removedEdge: string | null): number {
  const nodes = removedNode === null ? spec.nodes : spec.nodes.filter((node) => node.id !== removedNode)
  const edges = spec.edges.filter(
    (edge) =>
      edge.id !== removedEdge &&
      (removedNode === null || (edge.from !== removedNode && edge.to !== removedNode)),
  )
  return weakComponentsReference(nodes, edges).length
}

describe('dfs, walking a directed graph', () => {
  it('goes as deep as it can before it turns around', () => {
    const tree = dfs(ladderLine(4), 'a')
    expect(tree.order).toEqual(['a', 'b', 'c', 'd'])
    expect(tree.postOrder).toEqual(['d', 'c', 'b', 'a'])
    expect(tree.visits.map((visit) => visit.depth)).toEqual([0, 1, 2, 3])
    expect(tree.visits.map((visit) => visit.viaEdgeId)).toEqual([null, 'a-b', 'b-c', 'c-d'])
    expect(tree.treeEdgeIds).toEqual(['a-b', 'b-c', 'c-d'])
    expect(tree.backEdgeIds).toEqual([])
    expect(tree.cycle).toBe(false)
  })

  it('counts the square as a loop and the way back along it as nothing', () => {
    // Every corridor in the app is a single edge id with two arcs, so a walk that counted the return trip as a
    // back edge would report a cycle in a straight line — and the flag would stop meaning anything. The square
    // *does* have a cycle: `a—b—c—d` and then `d`'s other arc back to `a`, which is a different edge id.
    const line = dfs(ladderLine(4), 'a')
    expect(line.cycle).toBe(false)
    expect(line.backEdgeIds).toEqual([])
    const square = dfs(ladderCrossing(), 'a')
    expect(square.order).toEqual(['a', 'b', 'c', 'd'])
    expect(square.cycle).toBe(true)
    // Two, not one: the ring `a—b—c—d—…—a` and the 250 m diagonal `a-c` are different cycles, and a walk that
    // lists both is the one that will be asked "how many loops does this plan have".
    expect(square.backEdgeIds).toEqual(['a-d', 'a-c'])
  })

  it('calls a one-way circuit a loop, because it is one', () => {
    // `a→b`, `b→c`, `c—a`: from `b` the walk goes b→c→a and then finds `b` still open on the stack.
    const tree = dfs(ladderOneWay(), 'b')
    expect(tree.order).toEqual(['b', 'c', 'a'])
    expect(tree.cycle).toBe(true)
    expect(tree.backEdgeIds).toEqual(['a-b'])
  })

  it('stops at a closed walkway', () => {
    const open = dfs(ladderLine(4), 'a')
    const closed = dfs(ladderLine(4), 'a', { blockedEdges: new Set(['b-c']) })
    expect(open.order).toHaveLength(4)
    expect(closed.order).toEqual(['a', 'b'])
    // The cut is in the middle of the walk, not at the start: `c-d` is never offered.
    expect(closed.treeEdgeIds).toEqual(['a-b'])
  })

  it('reports an empty reach for a vertex the map does not know', () => {
    const tree = dfs(ladderLine(3), 'nope')
    expect(tree.order).toEqual([])
    expect(tree.root).toBe('nope')
    expect(tree.cycle).toBe(false)
    expect(reachableFrom(ladderLine(3), 'nope')).toEqual([])
  })

  it('answers with the reachable set and nothing else', () => {
    const index = ladderIslands()
    expect([...reachableFrom(index, 'a')].sort()).toEqual(['a', 'b', 'c'])
    expect(reachableFrom(index, 'd')).toEqual(['d'])
  })

  it('walks 5 000 vertices deep without running out of call frames', () => {
    // The recursion this replaces would need 5 000 stack frames — fine on a laptop, and a `RangeError` in a
    // browser with a shallower default. A corridor of a thousand courtyards is a plausible import from a
    // traced plan, which is why the claim is in a test and not in a comment.
    const count = 5_000
    const nodes: { id: string; x: number; y: number }[] = []
    const edges: { id: string; from: string; to: string; metres: number }[] = []
    for (let i = 0; i < count; i++) {
      nodes.push({ id: `n${String(i)}`, x: i * 10, y: 0 })
      if (i > 0) edges.push({ id: `e${String(i)}`, from: `n${String(i - 1)}`, to: `n${String(i)}`, metres: 10 })
    }
    const tree = dfs(build({ nodes, edges }), 'n0')
    expect(tree.visits).toHaveLength(count)
    expect(tree.cycle).toBe(false)
    expect(tree.visits[count - 1]?.depth).toBe(count - 1)
    expect(tree.postOrder[0]).toBe(`n${String(count - 1)}`)
  })
})

describe('dfs, the structure underneath', () => {
  it('finds the courtyard that holds the campus together', () => {
    // `a—b—c—d` with `c—e—a` closing a loop: `d` hangs off `c`, so `c` is the only cut vertex and `c—d` the
    // only bridge. Removing `c` leaves `{a,b,e}` and `{d}` — two components where there was one.
    const index = ladderBarbell()
    const { cutVertices, bridges, componentCount } = articulationPoints(index)
    expect(componentCount).toBe(1)
    expect(cutVertices).toEqual(['c'])
    expect(bridges).toEqual(['c-d'])
    // And the deletion check, which is the whole reason the names above are worth printing:
    expect(componentsWithout(specOf(index), 'c', null)).toBe(2)
    expect(componentsWithout(specOf(index), 'b', null)).toBe(1)
    expect(componentsWithout(specOf(index), null, 'c-d')).toBe(2)
    expect(componentsWithout(specOf(index), null, 'a-b')).toBe(1)
  })

  it('calls every middle of a line a cut vertex, and every segment a bridge', () => {
    const index = ladderLine(4)
    const report = articulationPoints(index)
    expect(report.cutVertices).toEqual(['b', 'c'])
    expect(report.bridges).toEqual(['a-b', 'b-c', 'c-d'])
    for (const vertex of report.cutVertices) {
      expect(componentsWithout(specOf(index), vertex, null), `removing ${vertex}`).toBeGreaterThan(report.componentCount)
    }
    // The ends are not cuts, and that is the DFS root rule rather than a low-link comparison: a root is a cut
    // vertex only when it has two or more children, and `a` has one.
    for (const vertex of ['a', 'd'] as const) {
      expect(componentsWithout(specOf(index), vertex, null), `removing ${vertex}`).toBe(1)
    }
  })

  it('refuses to call a pair of parallel walkways a bridge', () => {
    // A ramp and a stair between the same two points are two edges. Losing one leaves the other, so neither is
    // a bridge — and a low-link that skipped its parent *vertex* instead of its parent *edge id* reports both
    // of them as bridges, which is the single most common bug in this algorithm.
    const index = ladderParallel()
    const report = articulationPoints(index)
    expect(report.bridges).toEqual([])
    expect(report.cutVertices).toEqual([])
    expect(componentsWithout(specOf(index), null, 'a-b-ramp')).toBe(1)
    expect(componentsWithout(specOf(index), null, 'a-b-stairs')).toBe(1)
  })

  it('counts components it had to start a new walk for', () => {
    expect(articulationPoints(ladderIslands()).componentCount).toBe(2)
    expect(articulationPoints(ladderBarbell()).componentCount).toBe(1)
    expect(articulationPoints(new AdjacencyGraph().seal()).componentCount).toBe(0)
  })

  it('sees the physical campus, not the traffic pattern', () => {
    // `a→b→c` with `a—c` two-way. Directed reachability would call `a` indispensable to getting from `a` to
    // anywhere; the *structure* does not care, because nothing is physically severed by removing it. This is
    // the distinction Phase 6's report has to keep straight, and the reason `dfs` and `articulationPoints` are
    // two functions on two views of the same index.
    const report = articulationPoints(ladderOneWay())
    expect(report.cutVertices).toEqual([])
    expect(report.bridges).toEqual([])
    // And a walk that does respect direction, on the same graph:
    expect(reachableFrom(ladderOneWay(), 'c')).toEqual(['c', 'a', 'b'])
    expect(dfs(ladderOneWay(), 'a').order).toEqual(['a', 'b', 'c'])
  })

  it('is checked against deletion on 40 seeded graphs', () => {
    // Every claim of the form "`v` is a cut vertex" is a claim about a component count after a removal, so that
    // is what is measured — for every vertex, not only the reported ones, so a missed cut vertex fails too.
    // Bridges are the same argument with an edge removed instead of a vertex.
    sweepGraphs(40, 'dfs/deletion-oracle', ({ generated }) => {
      // Self-loops are dropped for the same reason `indexOfGraph` drops them: the generator emits them on
      // purpose, and `addEdge` refuses them on purpose — a courtyard that is its own neighbour is a drawing
      // error, not a network. The oracles see the same filtered set, so all three are counting one graph.
      const spec: LadderSpec = {
        nodes: generated.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
        edges: generated.edges.filter((edge) => edge.from !== edge.to).map((edge) => ({
          id: edge.id,
          from: edge.from,
          to: edge.to,
          metres: edge.metres,
          oneWay: edge.oneWay,
        })),
      }
      const index = build(spec)
      const { cutVertices, bridges, componentCount } = articulationPoints(index)
      expect(componentCount, 'component count').toBe(componentsWithout(spec, null, null))

      for (const node of spec.nodes) {
        const after = componentsWithout(spec, node.id, null)
        const severed = after > componentCount
        expect(severed, `removing ${node.id} splits the graph: ${cutVertices.includes(node.id) ? 'reported as a cut' : 'not reported'}`).toBe(
          cutVertices.includes(node.id),
        )
      }

      for (const edge of spec.edges) {
        const after = componentsWithout(spec, null, edge.id)
        expect(after > componentCount, `closing ${edge.id}`).toBe(bridges.includes(edge.id))
      }
    })
  })

  it('walks around a vertex the index lost instead of drawing one', () => {
    // The `unravelledIndex` promise, in the two places it can bite: `dfs` must not follow an arc to a vertex it
    // cannot place, and `articulationPoints` must not treat an id with no edge record as a walkway. Neither
    // gets a `TypeError`, and neither gets a phantom courtyard.
    const index = unravelledIndex()
    expect(dfs(index, 'a').order).toEqual(['a', 'b'])
    const report = articulationPoints(index)
    // `b`—`a` is the only edge either vertex has, so it is a bridge; `b` is the DFS root with one child, so it
    // is not a cut vertex, and the lost `gone` is not a vertex at all — it appears nowhere.
    expect(report.bridges).toEqual(['a-b'])
    expect(report.cutVertices).toEqual([])
    expect(report.componentCount).toBe(1)
  })

  it('honours a closure set the way the searches do', () => {
    // The same `ReadonlySet<EdgeId>` a route query receives: closing a walkway can create a bridge out of an
    // ordinary street, and a resilience sweep (Phase 6) asks exactly this question for every flood-prone edge.
    const index = ladderBarbell()
    const withLoop = articulationPoints(index)
    const loopCut = articulationPoints(index, { blockedEdges: new Set(['e-a']) })
    expect(withLoop.bridges).toEqual(['c-d'])
    // With `e—a` shut, `a` is a dead-end off `e`, `b` is the only way in, and three more edges become bridges.
    expect(loopCut.bridges).toEqual(['a-b', 'b-c', 'c-d', 'c-e'])
    expect(loopCut.cutVertices).toEqual(['b', 'c'])
  })
})

describe('depth-first routing', () => {
  refusalLadder('dfs', depthFirstRoute)

  it('returns a route result, so a screen can render it without asking which search ran', () => {
    const result = depthFirstRoute(ladderCrossing(), 'a', 'c', { cost: LADDER_COST })
    expect(result.ok).toBe(true)
    if (!result.ok) return expect.fail('a route')
    expect(result.algorithm).toBe('dfs')
    expect(result.nodeIds[0]).toBe('a')
    expect(result.nodeIds[result.nodeIds.length - 1]).toBe('c')
    expect(result.metres).toBeGreaterThan(0)
    expect(result.steps.length).toBeGreaterThan(0)
    expect(result.expanded).toBeLessThanOrEqual(4)
  })

  it('walks whichever way the stack opened, and that is not always the cheap way', () => {
    const index = ladderCrossing()
    const depth = mustFind(depthFirstRoute(index, 'a', 'c', { cost: LADDER_COST }), 'dfs')
    const cheap = mustFind(dijkstra(index, 'a', 'c', { cost: LADDER_COST }), 'dijkstra')
    // `a`'s adjacency is [b, d, c], so `c` is pushed last and popped first: the search walks the 250 m
    // diagonal, settles one vertex, and never looks at the 200 m way round. Correct as a route, wrong as the
    // cheapest one — which is the sentence the phase is built around.
    expect(depth.nodeIds).toEqual(['a', 'c'])
    expect(depth.metres).toBe(250)
    expect(depth.expanded).toBe(2)
    expect(cheap.nodeIds).toEqual(['a', 'b', 'c'])
    expect(cheap.metres).toBe(200)
    // What is *not* compared here is `cost`: a stack search counts hops and a heap search counts whatever its
    // profile prices, so 1 against 200 is not a winner — it is two different questions. `metres` is the shared
    // currency, and the app's card shows that one.
    expect(depth.cost).toBe(depth.hops)
    expect(depth.cost).toBe(1)
  })

  it('never repeats a vertex, so a bad route is at least walkable', () => {
    // A stack search with no visited set wanders forever on a cycle; with one, the path it returns is simple.
    // `cost` here is a hop count, so optimality is not on the table — validity is, and it is checked on every
    // shape in the sweep rather than argued from the code.
    sweepGraphs(120, 'dfs/validity', ({ trial, generated, index, blocked, sources }) => {
      for (const source of sources) {
        for (const target of generated.nodes) {
          const result = depthFirstRoute(index, source, target.id, { cost: LADDER_COST, blockedEdges: blocked })
          const where = `trial ${String(trial)} ${source} to ${target.id}`
          if (!result.ok) continue
          expect(new Set(result.nodeIds).size, `${where} repeats a vertex`).toBe(result.nodeIds.length)
          expect(result.expanded, `${where} expansions`).toBeLessThanOrEqual(index.size)
          expect(result.nodeIds[0], `${where} origin`).toBe(source)
          expect(result.cost, `${where} hops`).toBe(result.hops)
          // Every edge on the path must exist and be open, in the direction travelled.
          for (let i = 1; i < result.nodeIds.length; i++) {
            const step = result.nodeIds[i] as string
            const before = result.nodeIds[i - 1] as string
            const walkable = index
              .neighboursOf(before)
              .some((entry) => entry.to === step && !blocked.has(entry.edgeId))
            expect(walkable, `${where} uses ${before} to ${step}`).toBe(true)
          }
        }
      }
    })
  })

  it('settles for the first path it can find, which is why it is not in the picker', () => {
    // The comparison the docs quote: on the same square, the greedy stack answers after two vertices while
    // Dijkstra settles four — fewer work, longer walk. Nobody should ship that trade for a navigation app,
    // and the UI's algorithm list is where that decision is recorded.
    const index = ladderCrossing()
    const depth = mustFind(depthFirstRoute(index, 'a', 'c', { cost: LADDER_COST }), 'dfs')
    const cheap = mustFind(dijkstra(index, 'a', 'c', { cost: LADDER_COST }), 'dijkstra')
    expect(depth.expanded).toBeLessThan(cheap.expanded)
    expect(depth.metres).toBeGreaterThan(cheap.metres)
    expect(depth.hops).toBeLessThan(cheap.hops)
  })
})
