/**
 * A* — the search that spends an estimate to save expansions.
 *
 * Four claims, and the specs are ordered by how much they cost to check:
 *
 * 1. **It agrees with Dijkstra about the cost.** On the same graphs, every time, under every profile. This is
 *    the optimality claim, and it is the one that would break if `h` overestimated by a single unit.
 * 2. **It settles no more vertices than Dijkstra.** The efficiency claim, checked on the same sweep rather than
 *    asserted in a comment.
 * 3. **The estimate is a lower bound.** Not taken on trust from the formula: `floydWarshall` computes the true
 *    remaining cost for every ordered pair of a tiny graph, and `h` is compared against it, in both directions
 *    of every one-way edge, with walkways closed and open.
 * 4. **A heuristic that overestimates returns a route that is not the cheapest** — pinned deliberately, so
 *    nobody can call inadmissible pruning "an optimisation".
 */
import { describe, expect, it } from 'vitest'
import { aStar } from './a-star'
import { dijkstra } from './dijkstra'
import { COST_EPSILON } from '../constants'
import { euclidean, euclideanHeuristic, minCostPerUnit } from '../geo/measure'
import {
  LADDER_COST,
  createRandom,
  floydWarshall,
  indexOfGraph,
  ladderCrossing,
  ladderLine,
  ladderOneWay,
  randomGraph,
  unravelledIndex,
  refusalLadder,
  sweepGraphs,
  targetsOf,
} from '../__tests__/helpers'
import type { EdgeCost, EdgeId, Heuristic, RouteResult } from '../types'

/** A route, or a failure message that names the trial and the refusal. */
function mustFind(result: RouteResult, where: string): Extract<RouteResult, { ok: true }> {
  if (result.ok) return result
  expect.fail(`${where}: refused with ${result.reason} — ${result.message}`)
}

describe('a-star, pinned', () => {
  // Run verbatim from `__tests__/helpers.ts`, at describe level: the ladder registers its own cases, and
  // calling it from inside an `it` is a vitest error rather than a shortcut.
  refusalLadder('a-star', aStar)

  it('takes the two-segment way round the square, like Dijkstra, and settles less', () => {
    const index = ladderCrossing()
    const result = mustFind(aStar(index, 'a', 'c', { cost: LADDER_COST }), 'square')
    expect(result.nodeIds).toEqual(['a', 'b', 'c'])
    expect(result.cost).toBe(200)
    expect(result.metres).toBe(200)
    expect(result.hops).toBe(2)
    // Dijkstra must settle `a`, `b`, `d` before it will look at `c` at 200; A* already knows `c` is the goal,
    // so it settles `a`, `b` and stops. Three against four on a five-vertex graph is the whole idea.
    expect(result.expanded).toBe(3)
    expect(dijkstra(index, 'a', 'c', { cost: LADDER_COST }).ok).toBe(true)
  })

  it('is the same search as Dijkstra when the estimate is switched off', () => {
    const index = ladderCrossing()
    const zero = mustFind(
      aStar(index, 'a', 'c', { cost: LADDER_COST, heuristic: euclideanHeuristic(index, { cost: LADDER_COST, scale: 0 }) }),
      'zero heuristic',
    )
    const plain = mustFind(dijkstra(index, 'a', 'c', { cost: LADDER_COST }), 'dijkstra')
    expect(zero.nodeIds).toEqual(plain.nodeIds)
    expect(zero.exploredOrder).toEqual(plain.exploredOrder)
    expect(zero.frontierSnapshots).toEqual(plain.frontierSnapshots)
  })

  it('follows one-way edges and does not borrow the reverse arc', () => {
    const index = ladderOneWay()
    // `b→c` is one-way, so `c` reaches `b` only by going back through `a`.
    const fromC = mustFind(aStar(index, 'c', 'b', { cost: LADDER_COST }), 'c to b')
    expect(fromC.nodeIds).toEqual(['c', 'a', 'b'])
    expect(fromC.cost).toBe(200)
    // And the same pair in the other direction is the direct 100 m walkway.
    expect(mustFind(aStar(index, 'b', 'c', { cost: LADDER_COST }), 'b to c').cost).toBe(100)
  })

  it('detours around a closure instead of declaring the campus broken', () => {
    const index = ladderCrossing()
    const closed: ReadonlySet<EdgeId> = new Set(['b-c'])
    const result = mustFind(aStar(index, 'a', 'c', { cost: LADDER_COST, blockedEdges: closed }), 'b-c closed')
    expect(result.nodeIds).toEqual(['a', 'd', 'c'])
    expect(result.cost).toBe(200)
    expect(result.metres).toBe(200)
  })

  it('reports a walker already at the destination without an estimate at all', () => {
    const result = mustFind(aStar(ladderLine(3), 'b', 'b', { cost: LADDER_COST }), 'same place')
    expect(result.nodeIds).toEqual(['b'])
    expect(result.cost).toBe(0)
    expect(result.steps).toHaveLength(1)
  })

  it('prices the walk at the profile pace, not at metres', () => {
    const index = ladderLine(3)
    // 200 m of walkway, priced at 1 unit per edge: `cost` is 2 units, `metres` is 200, and the card's minute
    // count is derived from the metres because a walking speed is a speed over ground.
    const result = mustFind(aStar(index, 'a', 'c', { cost: () => 1 }), 'unit profile')
    expect(result.cost).toBe(2)
    expect(result.metres).toBe(200)
    expect(result.minutes).toBe(2.4)
  })

  it('records the same frontier twice on a rerun, so a replay can be recorded once', () => {
    const index = ladderCrossing()
    // `trace` defaults to on, because a replay that has to be remembered to enable is a replay nobody records.
    const options = { cost: LADDER_COST, trace: true } as const
    const first = mustFind(aStar(index, 'a', 'c', options), 'first run')
    const second = mustFind(aStar(index, 'a', 'c', options), 'second run')
    expect(first.frontierSnapshots).toEqual(second.frontierSnapshots)
    expect(first.frontierSnapshots).toHaveLength(3)
    // `trace: false` keeps the answer and drops the animation frames — Phase 4's benchmark prices the search,
    // not the record-keeping, and this is the one line where that trade is visible.
    const untraced = mustFind(aStar(index, 'a', 'c', { cost: LADDER_COST, trace: false }), 'untraced')
    expect(untraced.frontierSnapshots).toEqual([])
    expect(untraced.exploredOrder).toEqual(first.exploredOrder)
  })
})

describe('a-star, against dijkstra on 200 seeded graphs', () => {
  const profiles: readonly { name: string; cost: EdgeCost }[] = [
    { name: 'metres', cost: LADDER_COST },
    { name: 'unit', cost: () => 1 },
    { name: 'jittered', cost: (edge) => 1 + edge.metres / 500 },
    // Sub-linear on purpose: a factor below 1 is the case where an estimate scaled by an assumed 1 would
    // overestimate, so the sweep below is also the sweep that proves `minCostPerUnit` is load-bearing.
    { name: 'one-fifth', cost: (edge) => edge.metres * 0.2 },
  ]

  it('finds the same cost, and settles no more vertices', () => {
    // Both searches are handed the identical graph, closure set and profile, so the only difference between
    // them is `h`. That makes this one test the whole of "A* is Dijkstra with a better queue order".
    sweepGraphs(200, 'a-star/parity', ({ trial, generated, index, blocked, sources }) => {
      for (const profile of profiles) {
        for (const source of sources) {
          for (const target of targetsOf(generated)) {
            const options = { cost: profile.cost, blockedEdges: blocked }
            const expected = dijkstra(index, source, target, options)
            const actual = aStar(index, source, target, options)
            const where = `trial ${String(trial)} ${profile.name} ${source} to ${target}`
            if (!expected.ok) {
              if (actual.ok) expect(`${where}: dijkstra refused, a-star answered ${String(actual.cost)}`).toBe('the same refusal')
              continue
            }
            const found = mustFind(actual, where)
            expect(Math.abs(found.cost - expected.cost), `${where} cost`).toBeLessThanOrEqual(COST_EPSILON)
            expect(found.expanded, `${where} expansions`).toBeLessThanOrEqual(expected.expanded)
            expect(found.nodeIds[0], `${where} origin`).toBe(source)
            // `metres` is only forced by `cost` when the profile *is* metres. Under a unit or jittered profile
            // two cheapest routes can cost the same and be different lengths, and then the searches are allowed
            // to disagree about which one to walk — so that is the case where the shared number is `cost`.
            if (profile.name === 'metres') expect(found.metres, `${where} metres`).toBe(expected.metres)
            // `toBeGreaterThan` would fail on the one legal case where a route has no length: origin and
            // destination the same vertex, which the sweep includes because a graph knows its own vertices.
            else expect(found.metres, `${where} metres`).toBeGreaterThanOrEqual(0)
          }
        }
      }
    })
  })

  it('reaches the destination with the parent chain Dijkstra would have chosen, at zero scale', () => {
    // `scale: 0` is the switch that turns A* into Dijkstra by construction, so path *and* expansion order must
    // match vertex for vertex. A cost tie alone would not prove this: two equal-cost paths can differ.
    sweepGraphs(60, 'a-star/zero-scale', ({ trial, generated, index, blocked, sources }) => {
      for (const source of sources) {
        const heuristic = euclideanHeuristic(index, { cost: LADDER_COST, blockedEdges: blocked, scale: 0 })
        for (const target of targetsOf(generated)) {
          const plain = dijkstra(index, source, target, { cost: LADDER_COST, blockedEdges: blocked })
          const zero = aStar(index, source, target, {
            cost: LADDER_COST,
            blockedEdges: blocked,
            heuristic,
          })
          const where = `trial ${String(trial)} ${source} to ${target}`
          if (!plain.ok) {
            if (zero.ok) expect(`${where}: expected no route`).toBe('no route')
            continue
          }
          const found = mustFind(zero, where)
          expect(found.nodeIds, `${where} path`).toEqual(plain.nodeIds)
          expect(found.exploredOrder, `${where} order`).toEqual(plain.exploredOrder)
        }
      }
    })
  })
})

describe('a-star, the estimate itself', () => {
  it('never overestimates the true remaining cost, on 80 tiny graphs', () => {
    // Admissibility is a correctness property, so it is measured against `floydWarshall`'s all-pairs truth
    // rather than argued from the formula: for every ordered pair `v, t`, `h(v, t)` must not exceed the cost of
    // the cheapest real route from `v` to `t`. One-way edges make this the interesting half — a bound derived
    // from undirected distance is admissible only by luck.
    const rng = createRandom(0x4c19)
    for (let trial = 0; trial < 80; trial++) {
      const generated = randomGraph(3 + (trial % 6), rng, {
        extraEdges: 2 + (trial % 5),
        oneWayChance: trial % 3 === 0 ? 0.4 : 0,
        disconnected: trial % 5 === 0,
      })
      const index = indexOfGraph(generated)
      // The bound and the truth must be told about the same closures: `minCostPerUnit` ignores a walkway that
      // is shut, so its scale rises, and a `floydWarshall` that still walks through it is measuring a different
      // graph. Both sides get `blocked`.
      const blocked = trial % 4 === 0 ? new Set([generated.edges[0]?.id as string]) : undefined
      const truth = floydWarshall(generated, {
        weight: (edge) => edge.metres,
        ...(blocked === undefined ? {} : { blockedEdges: blocked }),
      })
      for (const target of generated.nodes) {
        const heuristic = euclideanHeuristic(index, { cost: LADDER_COST, ...(blocked === undefined ? {} : { blockedEdges: blocked }) })
        for (const vertex of generated.nodes) {
          const remaining = truth(vertex.id, target.id)
          const estimate = heuristic({ x: vertex.x, y: vertex.y }, { x: target.x, y: target.y })
          const where = `trial ${String(trial)} h(${vertex.id}, ${target.id})`
          if (!Number.isFinite(remaining)) {
            // Nothing reaches the target, so there is no bound to violate; the heuristic must still be finite,
            // because a `NaN` priority would put the vertex at the bottom of a heap forever.
            expect(Number.isFinite(estimate), `${where} is finite`).toBe(true)
            continue
          }
          expect(estimate, `${where} ≤ ${String(remaining)}`).toBeLessThanOrEqual(remaining + COST_EPSILON)
        }
      }
    }
  })

  it('reads its scale from the edges it may still walk', () => {
    const index = ladderCrossing()
    // The scale is cost per *drawn* unit, because that is the only length an estimate can be taken from. Here
    // every side is 100 m drawn and 100 m walked, so one unit of drawing costs at least 1 unit of profile…
    expect(minCostPerUnit(index, { cost: LADDER_COST })).toBeCloseTo(1, 10)
    // …and the diagonal is 250 m of walkway over 141.42 m of drawing, so it is the ratio that would *raise*
    // the bound and it must not. Closing one side cannot raise the minimum either, because the sides that are
    // left already set it.
    expect(minCostPerUnit(index, { cost: LADDER_COST, blockedEdges: new Set(['a-b']) })).toBeCloseTo(1, 10)
    // A profile that charges per edge and not per metre takes the bound down to the longest drawing on the map
    // — the diagonal's, not its 250 m of labelled length. That is the difference between the two numbers and
    // the reason `randomGraph`'s fixtures, whose coordinates are unrelated to their metres, can be priced at
    // all: the estimate follows the picture, never the label.
    expect(minCostPerUnit(index, { cost: () => 1 })).toBeCloseTo(1 / Math.hypot(100, 100), 10)
    // Nothing left to price — every walkway closed — and the answer is `0`, not `Infinity`: a search with no
    // edges it may walk has no bound to offer, and `Infinity × distance` would put every vertex at the bottom
    // of the heap forever. Zero is the admissible estimate that costs nothing, which is what a stranded search
    // should fall back to rather than a number that looks like a measurement.
    expect(minCostPerUnit(index, { cost: LADDER_COST, blockedEdges: new Set(['a-b', 'a-d', 'b-c', 'd-c', 'a-c']) })).toBe(0)
  })

  it('returns a worse route when the estimate overreaches', () => {
    const index = ladderCrossing()
    // Ten times Euclidean distance is not a lower bound: the 100 m walkway to `b` looks like 1 000 m of
    // remaining work, so `c` through the 250 m diagonal is settled first and the search stops there. The route
    // it hands back is walkable and legal — it is 50 m longer than the one Dijkstra finds.
    const greedy: Heuristic = (from, to) => euclidean(from, to) * 10
    const result = mustFind(aStar(index, 'a', 'c', { cost: LADDER_COST, heuristic: greedy }), 'inadmissible')
    expect(result.nodeIds).toEqual(['a', 'c'])
    expect(result.cost).toBe(250)
    expect(dijkstra(index, 'a', 'c', { cost: LADDER_COST }).ok).toBe(true)
    const truth = mustFind(dijkstra(index, 'a', 'c', { cost: LADDER_COST }), 'truth')
    expect(truth.cost).toBe(200)
    expect(result.cost).toBeGreaterThan(truth.cost)
  })

  it('becomes correct again the moment the estimate is a bound', () => {
    const index = ladderCrossing()
    // Same graph, same goal, `h` exactly equal to distance: every side is 1 unit per metre, so this is the
    // tightest admissible bound available and the answer is the 200 m way round again.
    const tight = mustFind(aStar(index, 'a', 'c', { cost: LADDER_COST }), 'admissible')
    expect(tight.cost).toBe(200)
    expect(tight.nodeIds).toEqual(['a', 'b', 'c'])
  })

  it('routes without an estimate when the index cannot place a vertex', () => {
    // The one arm a sealed `AdjacencyGraph` can never produce, so it is built by hand: `a` is a vertex the
    // graph knows and the geometry has lost. A `NaN` priority here would put `a` at the bottom of the heap
    // forever and the search would answer "no route" about a 100 m walkway — so the fallback is the behaviour,
    // and the behaviour is "no estimate, carry on".
    const index = unravelledIndex()
    const forward = mustFind(aStar(index, 'a', 'b', { cost: LADDER_COST }), 'unplaceable origin')
    expect(forward.nodeIds).toEqual(['a', 'b'])
    expect(forward.cost).toBe(100)
    expect(forward.metres).toBe(100)
    // The destination is the unplaceable side this time, which is the other half of the same `?? 0`.
    const back = mustFind(aStar(index, 'b', 'a', { cost: LADDER_COST }), 'unplaceable destination')
    expect(back.nodeIds).toEqual(['b', 'a'])
    // And the steps survive it: `routeLegs` drops the leg it cannot draw rather than inventing a corner.
    expect(back.steps.length).toBeGreaterThan(0)
  })

  it('takes the factor from the profile it is given, not from an assumed 1', () => {
    // A profile may price a metre of walkway at less than one unit per metre — that is what `shaded`"
    // profile with a pace multiplier, or a shaded route that discounts a covered walkway, does. The scale is
    // then part of the measurement: `minCostPerUnit` divides each edge's cost by its drawn length and keeps
    // the smallest, so a uniform factor of 0.2 moves the whole estimate down by 0.2 and admissibility holds.
    const index = ladderCrossing()
    const fifth: EdgeCost = (edge) => edge.metres * 0.2
    expect(minCostPerUnit(index, { cost: fifth })).toBeCloseTo(0.2, 10)
    const result = mustFind(aStar(index, 'a', 'c', { cost: fifth }), 'one-fifth profile')
    expect(result.cost).toBeCloseTo(40, 10)
    expect(result.nodeIds).toEqual(['a', 'b', 'c'])
    expect(result.metres).toBe(200)
  })

  it('would answer wrongly on that profile if the estimate were not scaled', () => {
    // The mirror of the test above, and the reason `minCostPerUnit` exists: hand A* the same graph with the
    // obvious `h = metres between the points` — the assumption a fixed scale bakes in — and `a` looks like
    // 141.42 of remaining work when the true cheapest cost is 40. The search then settles the diagonal first
    // and stops, 10 units short of optimal, on a route a person could walk. Nothing in the types distinguishes
    // the two heuristics, which is why the scaling is measured rather than configured.
    const index = ladderCrossing()
    const fifth: EdgeCost = (edge) => edge.metres * 0.2
    const naive: Heuristic = (from, to) => euclidean(from, to)
    const wrong = mustFind(aStar(index, 'a', 'c', { cost: fifth, heuristic: naive }), 'unscaled')
    expect(wrong.nodeIds).toEqual(['a', 'c'])
    expect(wrong.cost).toBeCloseTo(50, 10)
    const scaled = mustFind(aStar(index, 'a', 'c', { cost: fifth }), 'measured scale')
    expect(scaled.cost).toBeCloseTo(40, 10)
    expect(wrong.cost).toBeGreaterThan(scaled.cost)
  })

  it('follows the cheapest edge, not the average, when one walkway is discounted', () => {
    // A single fast lane — a 40 m covered moving walkway drawn 100 m long — sets the ratio for the whole map:
    // the estimate must be a lower bound *everywhere*, so it is priced at that lane's 0.4 units per drawn
    // unit and every other vertex's estimate shrinks with it. Under-estimating is allowed and costs
    // expansions; the other direction costs correctness.
    const index = ladderCrossing()
    const lanes: EdgeCost = (edge) => (edge.id === 'a-b' ? 40 : edge.metres)
    expect(minCostPerUnit(index, { cost: lanes })).toBeCloseTo(0.4, 10)
    const star = mustFind(aStar(index, 'a', 'c', { cost: lanes }), 'with a fast lane')
    const truth = mustFind(dijkstra(index, 'a', 'c', { cost: lanes }), 'with a fast lane, dijkstra')
    expect(star.cost).toBeCloseTo(truth.cost, 10)
    expect(truth.cost).toBe(140)
  })

  it('reports its own name, profile and clock in the metrics a card reads', () => {
    const result = mustFind(aStar(ladderLine(3), 'a', 'c', { cost: LADDER_COST, profile: 'step-free' }), 'metrics')
    expect(result.algorithm).toBe('a-star')
    expect(result.profile).toBe('step-free')
    expect(result.cached).toBe(false)
    expect(result.ms).toBeGreaterThanOrEqual(0)
    expect(result.expanded).toBeLessThanOrEqual(3)
  })
})
