/**
 * Breadth-first search — the fewest walkways, whatever they are made of.
 *
 * The claim under test is *not* "BFS finds a short route". It is the sharper one: the number BFS minimises is
 * the hop count, so its `cost` field is a count of edges and its `metres` field is the length of the route it
 * happened to prefer. That split is why the reference is `minimumHopCounts` and not `bellmanFord`: an oracle
 * that also sums weights would let a search that sorted by length pass a test about counting edges.
 *
 * Then the two properties that make BFS the tool Phase 5 and Phase 6 use it for: it never looks at the cost
 * function's *values* (so it is the cheapest reachability walk in the app), and when a profile closes edges by
 * returning `Infinity` it changes which routes BFS can see without changing what it optimises.
 */
import { describe, expect, it } from 'vitest'
import { bfs } from './bfs'
import { dijkstra } from './dijkstra'
import { reachableFrom } from './dfs'
import {
  LADDER_COST,
  ladderCrossing,
  ladderIslands,
  ladderLine,
  ladderOneWay,
  minimumHopCounts,
  refusalLadder,
  sweepGraphs,
  targetsOf,
} from '../__tests__/helpers'
import type { EdgeCost, RouteResult } from '../types'

function mustFind(result: RouteResult, where: string): Extract<RouteResult, { ok: true }> {
  if (result.ok) return result
  expect.fail(`${where}: refused with ${result.reason} — ${result.message}`)
}

/** The unit profile, which is the only one where "fewest edges" and "cheapest" are the same question. */
const UNIT: EdgeCost = () => 1

describe('bfs, pinned', () => {
  refusalLadder('bfs', bfs)

  it('takes the one-hop diagonal over the two-hop detour, because hops are all it counts', () => {
    const index = ladderCrossing()
    // 250 m straight across, against 200 m in two walkways. Dijkstra walks the 200; BFS walks the 250, and
    // both answers are correct for what each was asked. This is the fixture that keeps the phase honest about
    // what "shortest" means.
    const short = mustFind(bfs(index, 'a', 'c', { cost: LADDER_COST }), 'hop-first')
    expect(short.nodeIds).toEqual(['a', 'c'])
    expect(short.cost).toBe(1)
    expect(short.hops).toBe(1)
    expect(short.metres).toBe(250)

    const cheap = mustFind(dijkstra(index, 'a', 'c', { cost: LADDER_COST }), 'cost-first')
    expect(cheap.nodeIds).toEqual(['a', 'b', 'c'])
    expect(cheap.metres).toBe(200)
  })

  it('settles in non-decreasing hop count, which is the invariant the queue buys', () => {
    const index = ladderLine(4)
    const result = mustFind(bfs(index, 'a', 'd', { cost: LADDER_COST }), 'line')
    expect(result.exploredOrder).toEqual(['a', 'b', 'c', 'd'])
    expect(result.cost).toBe(3)
    expect(result.hops).toBe(3)
    // On a line the frontier is never wider than one vertex, so every snapshot is empty once its own offer
    // has been drawn. A fan-out graph would show the queue growing; this shows the record-keeping is honest.
    expect(result.frontierSnapshots).toEqual([[], [], [], []])
  })

  it('follows one-way edges, and pays the detour they force', () => {
    const index = ladderOneWay()
    const fromC = mustFind(bfs(index, 'c', 'b', { cost: LADDER_COST }), 'c to b')
    expect(fromC.nodeIds).toEqual(['c', 'a', 'b'])
    expect(fromC.cost).toBe(2)
    expect(fromC.metres).toBe(200)
  })

  it('routes around a closure and still counts hops', () => {
    const index = ladderCrossing()
    // With `b-c` shut, `c` is 2 hops from `a` the long way — and the 1-hop diagonal is gone because the
    // closure set removed it. (`a-c` is still open, so this really is 1 hop.)
    const result = mustFind(bfs(index, 'a', 'c', { cost: LADDER_COST, blockedEdges: new Set(['a-c']) }), 'no diagonal')
    expect(result.nodeIds).toEqual(['a', 'b', 'c'])
    expect(result.cost).toBe(2)
    expect(result.metres).toBe(200)
  })

  it('prices a route in minutes from its length and not from its hop count', () => {
    const index = ladderCrossing()
    const result = mustFind(bfs(index, 'a', 'c', { cost: LADDER_COST }), 'pace')
    // 250 m at 1.4 m/s is 178.6 s, which the card rounds to 3.0 minutes. A search that reported `cost` as a
    // distance would print 0.0 minutes for every one-hop route, which is the bug this test exists to keep.
    expect(result.minutes).toBe(3)
  })

  it('reports an exhausted search as exactly the set DFS reports as reachable', () => {
    const index = ladderIslands()
    // An empty closure set, deliberately: `checkEndpoints` rejects two components from the precomputed
    // partition without searching (which is the answer Phase 6's report needs at zero cost), and an exhausted
    // search is the only version that reports what it *did* reach. Passing the empty set is how a caller says
    // "do not trust the partition, walk it".
    const result = bfs(index, 'a', 'd', { cost: LADDER_COST, blockedEdges: new Set() })
    expect(result.ok).toBe(false)
    if (result.ok) return expect.fail('a refusal')
    // The failure carries the reachable set, and there are two independent ways to compute it: a queue and a
    // stack. Their *orders* differ — that is the algorithm — so the comparison is on the sorted set.
    expect([...result.exploredOrder].sort()).toEqual([...reachableFrom(index, 'a')].sort())
  })

  it('is deterministic across runs, so a replay animates the same frames twice', () => {
    const index = ladderCrossing()
    const options = { cost: LADDER_COST, trace: true } as const
    const first = mustFind(bfs(index, 'a', 'c', options), 'first')
    const second = mustFind(bfs(index, 'a', 'c', options), 'second')
    expect(second.frontierSnapshots).toEqual(first.frontierSnapshots)
    expect(second.exploredOrder).toEqual(first.exploredOrder)
  })
})

describe('bfs, against the hop count on 200 seeded graphs', () => {
  it('settles every vertex at its minimum hop count, and no more often', () => {
    sweepGraphs(200, 'bfs/minimum-hops', ({ trial, generated, index, blocked, sources }) => {
      for (const source of sources) {
        const reference = minimumHopCounts(source, generated, { blockedEdges: blocked })
        for (const target of generated.nodes) {
          const result = bfs(index, source, target.id, { cost: UNIT, blockedEdges: blocked })
          const where = `trial ${String(trial)} ${source} to ${target.id}`
          const expected = reference.get(target.id)
          if (expected === undefined) {
            expect(result.ok, `${where}: expected no route`).toBe(false)
            continue
          }
          const found = mustFind(result, where)
          // The number BFS minimises, checked against a level-by-level scan of the same arcs.
          expect(found.cost, `${where} hops`).toBe(expected)
          expect(found.hops, `${where} hop field`).toBe(expected)
          expect(found.nodeIds).toHaveLength(expected + 1)
          expect(found.expanded, `${where} expansions`).toBeLessThanOrEqual(index.size)
        }
      }
    })
  })

  it('agrees with dijkstra when the profile charges one unit per walkway', () => {
    // Under `() => 1` the cheapest route *is* the fewest-hops route, so the two searches must return the same
    // `cost` on every pair — while `exploredOrder` may differ, because Dijkstra keeps working after the answer.
    sweepGraphs(200, 'bfs/unit-profile-dijkstra', ({ trial, generated, index, blocked, sources }) => {
      for (const source of sources) {
        for (const target of targetsOf(generated)) {
          const options = { cost: UNIT, blockedEdges: blocked }
          const expected = dijkstra(index, source, target, options)
          const actual = bfs(index, source, target, options)
          const where = `trial ${String(trial)} ${source} to ${target}`
          if (!expected.ok) {
            expect(actual.ok, `${where}: expected no route`).toBe(false)
            continue
          }
          const found = mustFind(actual, where)
          expect(found.cost, `${where} cost`).toBe(expected.cost)
        }
      }
    })
  })

  it('disagrees with dijkstra in exactly the way a hop count should', () => {
    // The mirror of the test above, and the one worth putting in front of a viva: on a weighted profile the
    // two answers differ, and the difference is `metres`, not a bug. `cost` for BFS is never a distance.
    sweepGraphs(120, 'bfs/against-dijkstra', ({ trial, generated, index, blocked, sources }) => {
      for (const source of sources) {
        for (const target of targetsOf(generated)) {
          const expected = dijkstra(index, source, target, { cost: LADDER_COST, blockedEdges: blocked })
          const actual = bfs(index, source, target, { cost: LADDER_COST, blockedEdges: blocked })
          const where = `trial ${String(trial)} ${source} to ${target}`
          if (!expected.ok || !actual.ok) continue
          // BFS's own `cost` is a hop count, so the only cross-algorithm inequality that always holds is on
          // the physical length: the hop-shortest route is never shorter than the cost-shortest one.
          expect(actual.metres, `${where} metres`).toBeGreaterThanOrEqual(expected.metres - 0.1)
        }
      }
    })
  })
})
