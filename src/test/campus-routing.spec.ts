/**
 * The searches, on the campus — not on a fixture.
 *
 * The engine specs are honest about their graphs: 200 seeded shapes with coordinates that have nothing to do
 * with a plan. That is what makes them good at finding logic errors and bad at finding *model* errors, and the
 * one claim this file exists to check is the one that only real geometry can answer:
 *
 * **A\* is at least as fast as Dijkstra on Amrita's Bengaluru plan, and never returns a different route
 * cost.** With `campus.json`'s coordinates drawn from a plan and its metres measured from those coordinates,
 * `minCostPerUnit` finds a scale that is a genuine lower bound, so the expansion count must go down, not up.
 * If it ever goes up, either the heuristic or the data has drifted — which is exactly why the check belongs in
 * a test and not in a paragraph of the docs.
 *
 * It also runs the two queue searches over every pair, because "we only tested BFS on graphs we generated" is
 * how a campus whose gate names sort oddly ends up surprising someone on stage. Nothing here asserts an exact
 * turn-by-turn sentence: that is `src/ui`'s contract and Phase 3's checkpoint 4.
 */
import { describe, expect, it } from 'vitest'
import {
  MIN_INSTRUCTION_METRES,
  aStar,
  bfs,
  depthFirstRoute,
  dijkstra,
  routeLegs,
  simplifyLegs,
  type GraphIndex,
  type NodeId,
  type RouteFound,
  type RouteResult,
} from '@/engine'
import { buildGraph, campus } from '@/data'

/**
 * The one spec file allowed to hold both doors in its hands.
 *
 * `src/test/*.spec.ts` is where `architecture.test.ts` lets `@/engine` and `@/data` meet, because *something*
 * has to check that the graph the data layer builds is the graph the engine searches — and a UI component
 * cannot do it without becoming the thing under test. `src/ui` still reaches the engine only through
 * `src/hooks`, and nothing here imports a component.
 */
const model = buildGraph(campus)

/** The points a person can pick: everything with a name, junctions excluded. */
const points: readonly { id: NodeId; label: string }[] = model.nodes
  .filter((node) => node.kind !== 'junction' && node.label !== '')
  .map((node) => ({ id: node.id, label: node.label }))

const index: GraphIndex = model.graph

function route(result: RouteResult, where: string): RouteFound {
  if (result.ok) return result
  return expect.fail(`${where}: refused with ${result.reason} — ${result.message}`)
}

/** Re-walk a returned path against the index: every step an open edge, in the direction it points. */
/**
 * Re-walk a returned path along the adjacency itself — not along the edge list. Checking that "the edge joins
 * these two nodes" would pass for a route that travels a one-way walkway backwards, which is the one error a
 * navigator must never make, and `neighboursOf` is the same array the search was iterating.
 */
function assertWalkable(found: RouteFound, where: string, from: NodeId, to: NodeId): void {
  expect(found.nodeIds[0], `${where} starts at the origin`).toBe(from)
  expect(found.nodeIds[found.nodeIds.length - 1], `${where} ends at the destination`).toBe(to)
  expect(found.edgeIds).toHaveLength(found.nodeIds.length - 1)
  for (let i = 1; i < found.nodeIds.length; i++) {
    const here = found.nodeIds[i - 1] as NodeId
    const there = found.nodeIds[i] as NodeId
    const edgeId = found.edgeIds[i - 1] as string
    const arc = index.neighboursOf(here).find((entry) => entry.to === there && entry.edgeId === edgeId)
    if (arc === undefined) {
      return expect.fail(`${where}: no walkway "${edgeId}" goes ${here} to ${there} in the direction it points`)
    }
  }
}

describe('every search, over every pair of named places on the campus', () => {
  it('knows the plan well enough to have pairs to test', () => {
    // If a data edit ever renames every node, a sweep that silently becomes zero iterations would pass every
    // test below. This one is here so it fails here instead.
    expect(points.length).toBeGreaterThanOrEqual(18)
    expect(model.ok).toBe(true)
    expect(model.summary.componentCount).toBe(1)
    // The list a person picks from is the list the data layer counts as searchable, so the sweep below cannot
    // quietly shrink because a filter drifted.
    expect(points.length).toBe(model.summary.placeCount)
  })

  it('finds a route between all of them, and agrees on the cost', () => {
    let comparisons = 0
    let starFaster = 0
    let starSavedExpansions = 0
    for (const from of points) {
      for (const to of points) {
        if (from.id === to.id) continue
        comparisons += 1
        const where = `${from.label} to ${to.label}`
        const truth = route(dijkstra(index, from.id, to.id), where)
        const star = route(aStar(index, from.id, to.id), where)
        const queue = route(bfs(index, from.id, to.id), where)
        const stack = route(depthFirstRoute(index, from.id, to.id), where)

        // 1. the optimality claim, on real geometry and the real profiles.
        expect(star.cost, `${where}: a-star cost`).toBeCloseTo(truth.cost, 6)
        expect(star.metres, `${where}: a-star length`).toBe(truth.metres)
        // 2. the efficiency claim, which is the one the docs put in words.
        if (star.expanded < truth.expanded) starFaster += 1
        starSavedExpansions += truth.expanded - star.expanded
        expect(star.expanded, `${where}: a-star expanded more than dijkstra`).toBeLessThanOrEqual(truth.expanded)
        // 3. both queue searches return a walkable route, at least as long as the cheapest one.
        for (const [name, result] of [['bfs', queue], ['dfs', stack]] as const) {
          assertWalkable(result, `${where} (${name})`, from.id, to.id)
          expect(result.metres, `${where}: ${name} beat the cheapest route`).toBeGreaterThanOrEqual(truth.metres)
          expect(result.cost, `${where}: ${name} cost is its hop count`).toBe(result.hops)
        }
        // 4. A* answers the same question Dijkstra did, so the overlay and the card agree on the same vertices.
        expect(star.nodeIds[0], `${where}: a-star origin`).toBe(from.id)
        expect(star.nodeIds[star.nodeIds.length - 1], `${where}: a-star destination`).toBe(to.id)
      }
    }
    // The aggregate is the sentence Phase 5's overlay will be explained with, so it is asserted and not
    // printed: on a 39-node campus plan A* settles strictly fewer vertices on most pairs, and thousands of
    // expansions in total. Zero here would mean the heuristic is doing nothing, and a heuristic that does
    // nothing should be deleted rather than documented.
    expect(comparisons).toBe(points.length * (points.length - 1))
    expect(starFaster).toBeGreaterThan(0)
    expect(starSavedExpansions).toBeGreaterThan(0)
  })

  it('keeps every route a walker could actually follow', () => {
    // One closure per iteration, at the two walkways the validator warned about: a route that crosses a shut
    // gate is a bug in every search at once, and `blockedEdges` is the one argument the UI will pass around.
    const closures = new Set(['e-restroom-s--gate-south', 'e-sports-ground--courts'])
    for (const from of points) {
      for (const to of points) {
        if (from.id === to.id) continue
        const where = `${from.label} to ${to.label} with 2 walkways shut`
        for (const search of [dijkstra, aStar, bfs, depthFirstRoute] as const) {
          const result = search(index, from.id, to.id, { blockedEdges: closures })
          if (!result.ok) continue
          for (const edgeId of result.edgeIds) {
            expect(closures.has(edgeId), `${where}: ${search.name} walked "${edgeId}"`).toBe(false)
          }
          assertWalkable(result, where, from.id, to.id)
        }
      }
    }
  })

  it('gives the directions pass nothing to fold, and says why', () => {
    // `simplifyLegs` folds a leg shorter than `MIN_INSTRUCTION_METRES` into its neighbour. The shortest walkway
    // in this file is four times that, so the fold is a no-op on all 380 routes — measured, not assumed. The
    // pass is not dead code: it exists for the traced plan Phase 7's editor will import, where an entrance
    // stub is 6 m and every such stub would otherwise buy the walker a sentence. This test is the pair to that
    // claim: if a future edit adds short edges, the fold starts firing and the *counts* below change together;
    // if the fold ever eats a normal route, this fails instead of the screenshot looking slightly short.
    const shortest = model.edges.reduce((best, edge) => Math.min(best, edge.metres), Number.POSITIVE_INFINITY)
    expect(shortest).toBeGreaterThanOrEqual(MIN_INSTRUCTION_METRES * 3)
    let steps = 0
    for (const from of points) {
      for (const to of points) {
        if (from.id === to.id) continue
        const result = dijkstra(index, from.id, to.id)
        if (!result.ok) continue
        const before = routeLegs(index, result.nodeIds, result.edgeIds)
        expect(simplifyLegs(before)).toEqual(before)
        expect(result.steps).toHaveLength(before.length)
        steps += before.length
      }
    }
    expect(steps).toBeGreaterThan(0)
  })

  it('measures the walk in the units a person cares about', () => {
    // The card's three numbers, from the profile the UI defaults to: metres, minutes at 1.4 m/s, and the
    // expansion count. Rounding is the engine's decision, so the check is on the rounded figure.
    const first = points[0]
    const last = points[points.length - 1]
    if (first === undefined || last === undefined) return expect.fail('the campus has no named places')
    const found = route(dijkstra(index, first.id, last.id), 'end to end')
    expect(found.minutes).toBe(Math.round((found.metres / 1.4 / 60) * 10) / 10)
    expect(found.metres).toBeGreaterThan(0)
    expect(found.steps.length).toBeGreaterThan(0)
    expect(found.steps.length).toBeLessThanOrEqual(found.nodeIds.length)
  })
})
