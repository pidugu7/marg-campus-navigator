/**
 * Cost profiles — five weightings of one graph, and the admissibility argument that comes with them.
 *
 * Six claims, ordered by what they would cost to fix:
 *
 * 1. **The table is total.** Every profile prices every combination of the attributes a walkway can carry with
 *    a finite number greater than 0 — 1 280 combinations, checked rather than reasoned about, because
 *    `EdgeCost`'s contract is enforced at run time by the search (`badCost`) and a profile that violated it
 *    would be a refusal on every query, not a compile error.
 * 2. **A profile reads only what it claims to read.** `ProfileDefinition.reads` is documentation, and this
 *    file turns it into an assertion: `stairs` cannot change a `quiet` price, `crowd` cannot change a `lit` one.
 * 3. **The baseline is exactly metres.** `costFor('shortest')` is `edge.metres`, which is the sense in which
 *    the other four are "deviations" and the sense in which the result card's "Δ against shortest" is a
 *    comparison against the same quantity the user could have asked for.
 * 4. **A uniform factor cannot change the winner.** Every profile can end up uniform over a graph — a campus
 *    with no shade at all is `shaded` at 1.25 on every edge — and a scale that cancels in an argmin must not
 *    quietly re-order comparable routes. This is also why `cost` and `metres` are two numbers.
 * 5. **The estimate stays a lower bound.** `minCostPerUnit` under each profile, measured against `dijkstra`'s
 *    true cost for every vertex of 60 seeded graphs. Two profiles pay a *bonus*, so their scale is below 1, so
 *    a Euclidean estimate would over-state: claim 6 pins what that costs.
 * 6. **A* still equals Dijkstra**, on 200 seeded graphs with per-edge varied attributes, for all five profiles.
 */
import { describe, expect, it } from 'vitest'
import { aStar } from '../algorithms/a-star'
import { dijkstra } from '../algorithms/dijkstra'
import { minutesFor } from '../algorithms/search-common'
import { COST_EPSILON, DEFAULT_EDGE_ATTRIBUTES, WALKING_SPEED_MPS } from '../constants'
import { euclidean, minCostPerUnit } from '../geo/measure'
import { AdjacencyGraph } from '../structures/graph'
import {
  CROWD_PENALTY_AT_FULL_CONGESTION,
  LIT_BONUS,
  NOT_STEP_FREE_PENALTY,
  PROFILES,
  PROFILE_ORDER,
  ROUGH_SURFACE_PENALTY,
  SHADED_BONUS,
  SLOPE_FACTOR_PER_GRADE,
  STAIRS_PENALTY,
  UNLIT_PENALTY,
  UNSHADED_PENALTY,
  costFor,
  factorFor,
} from './cost'
import { createRandom, indexOfGraph, sweepGraphs, targetsOf } from '../__tests__/helpers'
import type { GeneratedGraph } from '../__tests__/helpers'
import type { EdgeAttributes, NodeId, RouteResult, SurfaceKind, WeightProfile } from '../types'

/** A route, or a failure message that names where and why. */
function mustFind(result: RouteResult, where: string): Extract<RouteResult, { ok: true }> {
  if (result.ok) return result
  return expect.fail(`${where}: refused with ${result.reason} — ${result.message}`)
}

const PROFILES_ALL: readonly WeightProfile[] = PROFILE_ORDER

const SURFACES: readonly SurfaceKind[] = ['paved', 'covered', 'gravel', 'grass', 'stairs']

/** One value per attribute kind, enough to cover every branch of every factor. */
const VALUES: Readonly<Record<keyof EdgeAttributes, readonly unknown[]>> = {
  stairs: [true, false],
  stepFree: [true, false],
  shaded: [true, false],
  lit: [true, false],
  crowd: [0, 0.2, 0.55, 1],
  surface: SURFACES,
  slope: [0, 0.02, -0.06, 0.5],
}

const profiles = <T>(visit: (profile: WeightProfile) => T): T[] => PROFILES_ALL.map(visit)

/** A graph from literal positions, so `metres` can be derived from the geometry instead of drifting from it. */
function planarGraph(
  nodes: readonly { id: string; x: number; y: number }[],
  edges: readonly { id: string; from: string; to: string; attributes?: Partial<EdgeAttributes> }[],
): AdjacencyGraph {
  const builder = new AdjacencyGraph()
  for (const node of nodes) builder.addNode({ id: node.id, x: node.x, y: node.y })
  const placed = new Map(nodes.map((node) => [node.id, node] as const))
  for (const edge of edges) {
    const from = placed.get(edge.from)
    const to = placed.get(edge.to)
    if (from === undefined || to === undefined) throw new TypeError(`edge "${edge.id}" names no node`)
    builder.addEdge({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      // Straight, so the drawn length *is* the crow-flight: the profile's cost per unit of length is then
      // exactly its factor, which is what makes the fixtures below arithmetically checkable.
      metres: Math.hypot(to.x - from.x, to.y - from.y),
      attributes: { ...DEFAULT_EDGE_ATTRIBUTES, ...edge.attributes },
    })
  }
  return builder.seal()
}

/**
 * Attributes as a pure function of an edge's own length, so a sweep graph contains stairs, shade, crowds,
 * gravel, ramps and lit shortcuts without any RNG involvement. Without this, every generated edge carries the
 * defaults, every profile is uniform over the graph, and a parity sweep would prove only that a scale cancels.
 */
function attributesOf(metres: number): EdgeAttributes {
  return {
    stairs: metres % 4 === 0,
    stepFree: metres % 9 !== 0,
    shaded: metres % 3 === 0,
    lit: metres % 5 !== 0,
    crowd: (metres % 11) / 10,
    surface: SURFACES[metres % 5] ?? 'paved',
    slope: metres % 7 === 0 ? 0.08 : metres % 13 === 0 ? -0.05 : 0,
  }
}

function variedGraph(generated: GeneratedGraph): AdjacencyGraph {
  const builder = new AdjacencyGraph()
  for (const node of generated.nodes) builder.addNode({ id: node.id, x: node.x, y: node.y })
  for (const edge of generated.edges) {
    // The same self-loop rule as `indexOfGraph`: a search only correct on a simple graph is not correct.
    if (edge.from === edge.to) continue
    builder.addEdge({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      metres: edge.metres,
      oneWay: edge.oneWay,
      attributes: attributesOf(edge.metres),
    })
  }
  return builder.seal()
}

describe('cost profiles, the factor table', () => {
    it('prices the baseline at exactly its metres', () => {
      const rng = createRandom(20_400)
      const index = indexOfGraph(randomEdges(rng, 300))
      const cost = costFor('shortest')
      expect(index.graph.edges.length, 'the generator produced edges to price').toBeGreaterThan(0)
      for (const edge of index.graph.edges) expect(cost(edge)).toBe(edge.metres)
    })

    it('keeps every factor finite and positive across the whole attribute space', () => {
      // `EdgeCost`'s contract is "a finite number > 0, or Infinity to close the edge". No profile is allowed the
      // second: a profile that closed an edge could disconnect the campus, which is `blockedEdges`' job.
      let checks = 0
      for (const stairs of VALUES.stairs as readonly boolean[]) {
        for (const stepFree of VALUES.stepFree as readonly boolean[]) {
          for (const shaded of VALUES.shaded as readonly boolean[]) {
            for (const lit of VALUES.lit as readonly boolean[]) {
              for (const crowd of VALUES.crowd as readonly number[]) {
                for (const surface of VALUES.surface as readonly SurfaceKind[]) {
                  for (const slope of VALUES.slope as readonly number[]) {
                    const attributes: EdgeAttributes = { stairs, stepFree, shaded, lit, crowd, surface, slope }
                    for (const factor of profiles((profile) => factorFor(profile, attributes))) {
                      checks += 1
                      expect(Number.isFinite(factor), `finite: ${String(factor)}`).toBe(true)
                      expect(factor, `positive: ${String(factor)}`).toBeGreaterThan(0)
                    }
                  }
                }
              }
            }
          }
        }
      }
      // The grid ran over every combination, or this file's headline claim is a comment.
      expect(checks).toBe(1_280 * PROFILES_ALL.length)
    })

    it('reads only the attributes it claims to read', () => {
      for (const profile of PROFILES_ALL) {
        const { reads } = PROFILES[profile]
        for (const key of Object.keys(DEFAULT_EDGE_ATTRIBUTES) as (keyof EdgeAttributes)[]) {
          const baseline = factorFor(profile, DEFAULT_EDGE_ATTRIBUTES)
          const alternatives = VALUES[key] as readonly unknown[]
          const changed = alternatives
            .map((value) => factorFor(profile, { ...DEFAULT_EDGE_ATTRIBUTES, [key]: value }))
            .filter((factor) => Math.abs(factor - baseline) > COST_EPSILON)
          if (!reads.includes(key)) {
            expect(changed, `${profile} must ignore "${key}"`).toEqual([])
          } else {
            expect(changed.length, `${profile} must respond to "${key}"`).toBeGreaterThan(0)
          }
        }
      }
    })

    it('pays a bonus for shade and light, and charges the crowd once', () => {
      expect(factorFor('shaded', { ...DEFAULT_EDGE_ATTRIBUTES, shaded: true })).toBe(SHADED_BONUS)
      expect(factorFor('shaded', { ...DEFAULT_EDGE_ATTRIBUTES, shaded: false })).toBe(UNSHADED_PENALTY)
      expect(SHADED_BONUS, 'a bonus profile, so the estimate must scale below 1').toBeLessThan(1)
      expect(UNSHADED_PENALTY).toBeGreaterThan(1)
      expect(factorFor('lit', { ...DEFAULT_EDGE_ATTRIBUTES, lit: true })).toBe(LIT_BONUS)
      expect(factorFor('lit', { ...DEFAULT_EDGE_ATTRIBUTES, lit: false })).toBe(UNLIT_PENALTY)
      expect(factorFor('quiet', { ...DEFAULT_EDGE_ATTRIBUTES, crowd: 0 })).toBe(1)
      expect(factorFor('quiet', { ...DEFAULT_EDGE_ATTRIBUTES, crowd: 1 })).toBeCloseTo(
        1 + CROWD_PENALTY_AT_FULL_CONGESTION,
        12,
      )
      // An empty corridor is not free, and a jammed one is not twice as long: it is twice as *costly*.
      expect(costFor('quiet')({ ...anEdge(100), attributes: { ...DEFAULT_EDGE_ATTRIBUTES, crowd: 1 } })).toBe(200)
    })

    it('stacks the step-free penalties multiplicatively', () => {
      const worst: EdgeAttributes = {
        ...DEFAULT_EDGE_ATTRIBUTES,
        stairs: true,
        stepFree: false,
        surface: 'gravel',
        slope: 0.1,
      }
      const expected =
        STAIRS_PENALTY * NOT_STEP_FREE_PENALTY * ROUGH_SURFACE_PENALTY * (1 + 0.1 * SLOPE_FACTOR_PER_GRADE)
      expect(factorFor('step-free', worst)).toBeCloseTo(expected, 12)
      expect(factorFor('step-free', DEFAULT_EDGE_ATTRIBUTES), 'a flat paved kerb-free walkway').toBe(1)
      // A descent is as tiring to manage as a climb for a small wheel, hence `Math.abs`.
      expect(factorFor('step-free', { ...DEFAULT_EDGE_ATTRIBUTES, slope: -0.06 })).toBe(
        factorFor('step-free', { ...DEFAULT_EDGE_ATTRIBUTES, slope: 0.06 }),
      )
    })

    it('avoids a staircase without forbidding it', () => {
      // A staircase is priced by the steps *or* by the kerb at its foot, never twice: `roughness` charges gravel
      // and grass, and a `surface: 'stairs'` edge is already paying twelve times for the steps themselves. That
      // is a deliberate refusal to double-count, and it is what makes the threshold below arithmetically honest.
      expect(factorFor('step-free', { ...DEFAULT_EDGE_ATTRIBUTES, stairs: true, surface: 'stairs' })).toBe(
        STAIRS_PENALTY,
      )
      expect(factorFor('step-free', { ...DEFAULT_EDGE_ATTRIBUTES, stairs: true, surface: 'gravel' })).toBeCloseTo(
        STAIRS_PENALTY * ROUGH_SURFACE_PENALTY,
        12,
      )
      // One staircase between `a` and `t`, and one detour: `west` of `detourMetres`, 100 m of `north`, then
      // `east` of `detourMetres + 100` (because `t` sits above `s`, not above `a`), so the walk around is
      // 2·detourMetres + 200 flat metres at a factor of 1.
      const stairCost = 100 * STAIRS_PENALTY * NOT_STEP_FREE_PENALTY + 100
      const around = (detourMetres: number): AdjacencyGraph =>
        planarGraph(
          [
            { id: 'a', x: 0, y: 0 },
            { id: 's', x: 100, y: 0 },
            { id: 't', x: 100, y: 100 },
            { id: 'd1', x: -detourMetres, y: 0 },
            { id: 'd2', x: -detourMetres, y: 100 },
          ],
          [
            { id: 'stairs', from: 'a', to: 's', attributes: { stairs: true, stepFree: false, surface: 'stairs' } },
            { id: 'up', from: 's', to: 't' },
            { id: 'west', from: 'a', to: 'd1' },
            { id: 'north', from: 'd1', to: 'd2' },
            { id: 'east', from: 'd2', to: 't' },
          ],
        )
      // 12 × 2.2 is 26.400000000000002 in binary floating point, hence `toBeCloseTo` throughout: the round
      // numbers are claims about the arithmetic, and `COST_EPSILON` is what two *algorithms* are compared with.
      expect(stairCost).toBeCloseTo(2740, 9)
      const near = mustFind(dijkstra(around(900), 'a', 't', { profile: 'step-free' }), 'a 2 000 m detour')
      expect(near.nodeIds).toEqual(['a', 'd1', 'd2', 't'])
      expect(near.metres).toBe(2000)
      expect(near.cost).toBeCloseTo(2000, 9)
      const far = mustFind(dijkstra(around(1400), 'a', 't', { profile: 'step-free' }), 'a 3 000 m detour')
      expect(far.nodeIds).toEqual(['a', 's', 't'])
      expect(far.cost).toBeCloseTo(stairCost, 9)
      expect(far.metres).toBe(200)
      // Twice the same query on the baseline, and the staircase is simply 100 m: a profile is an opinion about
      // the world, and `shortest` is the opinion every other one is quoted against.
      expect(
        mustFind(dijkstra(around(900), 'a', 't', { profile: 'shortest' }), 'shortest takes the stairs').nodeIds,
      ).toEqual(['a', 's', 't'])
      // And when the staircase is the only way, the answer is a route at 26.4 times its length rather than a
      // refusal — a refusal would be a lie about the campus, and `blockedEdges` is where a closure belongs.
      const deadEnd = planarGraph(
        [
          { id: 'a', x: 0, y: 0 },
          { id: 's', x: 100, y: 0 },
        ],
        [{ id: 'stairs', from: 'a', to: 's', attributes: { stairs: true, stepFree: false, surface: 'stairs' } }],
      )
      const climbed = mustFind(dijkstra(deadEnd, 'a', 's', { profile: 'step-free' }), 'only the stairs lead there')
      expect(climbed.cost).toBeCloseTo(100 * STAIRS_PENALTY * NOT_STEP_FREE_PENALTY, 9)
      expect(climbed.ok ?? true).toBe(true)
    })

    it('changes the price but not the winner when the factor is uniform', () => {
      // A campus with no shade at all is `shaded` × 1.25 on every edge — and a scale that applies everywhere
      // cancels in an argmin. If this test ever fails, a profile has stopped being a weighting and become a
      // different graph.
      const graph = planarGraph(
        [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 100, y: 0 },
          { id: 'c', x: 100, y: 100 },
        ],
        [
          { id: 'ab', from: 'a', to: 'b' },
          { id: 'bc', from: 'b', to: 'c' },
          { id: 'ac', from: 'a', to: 'c' },
        ],
      )
      const bare = mustFind(dijkstra(graph, 'a', 'c', { profile: 'shortest' }), 'shortest')
      const sunny = mustFind(dijkstra(graph, 'a', 'c', { profile: 'shaded' }), 'shaded, nothing shaded')
      expect(sunny.nodeIds).toEqual(bare.nodeIds)
      expect(sunny.metres).toBe(bare.metres)
      expect(sunny.cost).toBeCloseTo(bare.cost * UNSHADED_PENALTY, 6)
      // The direct line is 141.42 m and the corner route 200 m, so `shortest` picks the diagonal. Shade changes
      // nothing here because it changes everything by the same amount.
      expect(bare.nodeIds).toEqual(['a', 'c'])
    })

    it('quotes minutes from the pace table, not from the factor', () => {
      for (const profile of PROFILES_ALL) {
        const pace = WALKING_SPEED_MPS[profile]
        expect(pace, `${profile} has a pace`).toBeGreaterThan(0)
        expect(minutesFor(600, profile)).toBe(Math.round((600 / pace / 60) * 10) / 10)
      }
      // A step-free route is quoted slower than the same metres walked flat, and that is a *claim about people*,
      // not about the graph: the cost of the two is comparable, the minutes are not.
      expect(minutesFor(600, 'step-free')).toBeGreaterThan(minutesFor(600, 'shortest'))
    })

    it('gives the UI a label and a sentence for every profile, and no more', () => {
      expect(Object.keys(PROFILES).sort()).toEqual([...PROFILES_ALL].sort())
      expect(PROFILE_ORDER[0], 'the baseline is first in the picker').toBe('shortest')
      for (const profile of PROFILES_ALL) {
        const definition = PROFILES[profile]
        expect(definition.profile).toBe(profile)
        expect(definition.label.length).toBeGreaterThan(0)
        expect(definition.label.length, `${profile} label fits a 360 px <select>`).toBeLessThanOrEqual(24)
        expect(definition.blurb.length, `${profile} blurb is a sentence`).toBeGreaterThan(20)
        // Three lines of 36 characters is what a 360 px wide card has room for before the map disappears.
        expect(definition.blurb.length, `${profile} blurb stays a caption`).toBeLessThanOrEqual(118)
      }
    })

    it('is a pure view of the attributes, so two searches can share one function', () => {
      const first = costFor('step-free')
      const second = costFor('step-free')
      const rng = createRandom(70_700)
      const index = indexOfGraph(randomEdges(rng, 60))
      for (const edge of index.graph.edges) {
        expect(first(edge)).toBe(second(edge))
        expect(first(edge)).toBe(first(edge))
      }
    })
  })

/**
 * The factor table restated *by hand*, with the literals written out rather than imported, because a change to
 * `SHADED_BONUS` is supposed to break something. Same for `minCostPerUnit`: this is its definition, not its
 * implementation — a plain loop over the edge list with `Math.hypot`, and the skips spelled out.
 */
function referenceFactor(profile: WeightProfile, a: EdgeAttributes): number {
  switch (profile) {
    case 'shortest':
      return 1
    case 'shaded':
      return a.shaded ? 0.85 : 1.25
    case 'lit':
      return a.lit ? 0.9 : 1.4
    case 'quiet':
      return 1 + a.crowd
    case 'step-free': {
      const stairs = a.stairs ? 12 : 1
      const kerbs = a.stepFree ? 1 : 2.2
      const rough = a.surface === 'gravel' || a.surface === 'grass' ? 1.4 : 1
      return stairs * kerbs * rough * (1 + Math.abs(a.slope) * 4)
    }
  }
}

function referenceScale(index: AdjacencyGraph, blocked: ReadonlySet<string>, profile: WeightProfile): number {
  const places = new Map(index.graph.nodes.map((node) => [node.id, node] as const))
  let best = Number.POSITIVE_INFINITY
  for (const edge of index.graph.edges) {
    if (blocked.has(edge.id)) continue
    const from = places.get(edge.from)
    const to = places.get(edge.to)
    if (from === undefined || to === undefined) continue
    const line = Math.hypot(to.x - from.x, to.y - from.y)
    const value = edge.metres * referenceFactor(profile, edge.attributes)
    if (!(line > 0) || !(value > 0) || !Number.isFinite(value)) continue
    if (value / line < best) best = value / line
  }
  return Number.isFinite(best) ? best : 0
}

/** The hop-by-hop existence check, so a route that costs the right number is not enough. */
function assertWalkable(index: AdjacencyGraph, nodeIds: readonly NodeId[], blocked: ReadonlySet<string>): void {
  for (let i = 1; i < nodeIds.length; i++) {
    const previous = nodeIds[i - 1] as NodeId
    const next = nodeIds[i] as NodeId
    // Via the adjacency list rather than `edgeBetween`: the generator emits duplicate walkways between the same
    // pair on purpose, and one of them may be closed while the other is not. An arc, not an edge, is what the
    // search was allowed to use — which also makes this check direction-aware for the one-way trials.
    const arc = index
      .neighboursOf(previous)
      .find((entry) => entry.to === next && !blocked.has(entry.edgeId))
    expect(arc, `an open walkway from "${previous}" to "${next}"`).toBeDefined()
  }
}

describe('cost profiles, and the estimate that has to agree with them', () => {
  it('measures the scale from the profile, so a bonus drags it below 1', () => {
    const shady = planarGraph(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 100, y: 0 },
      ],
      [{ id: 'ab', from: 'a', to: 'b', attributes: { shaded: true } }],
    )
    const sunny = planarGraph(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 100, y: 0 },
      ],
      [{ id: 'ab', from: 'a', to: 'b', attributes: { shaded: false, lit: false } }],
    )
    // Straight edges, so crow-flight == metres and the measured scale *is* the factor.
    expect(minCostPerUnit(shady, { cost: costFor('shaded') })).toBeCloseTo(SHADED_BONUS, 12)
    expect(minCostPerUnit(sunny, { cost: costFor('shaded') })).toBeCloseTo(UNSHADED_PENALTY, 12)
    expect(minCostPerUnit(sunny, { cost: costFor('lit') })).toBeCloseTo(UNLIT_PENALTY, 12)
    for (const profile of ['shortest', 'step-free', 'quiet'] as const) {
      expect(
        minCostPerUnit(shady, { cost: costFor(profile) }),
        `${profile} never pays below a metre`,
      ).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps the estimate at or below the true remaining cost — 60 seeded graphs × 5 profiles', () => {
    let bounds = 0
    sweepGraphs(60, 'cost/admissibility', ({ generated, blocked }) => {
      const index = variedGraph(generated)
      const places = new Map(index.graph.nodes.map((node) => [node.id, node] as const))
      const target = targetsOf(generated, 1)[0] as NodeId
      const goal = places.get(target)
      if (goal === undefined) return expect.fail(`the sampled target "${target}" is not in the index`)
      for (const profile of PROFILES_ALL) {
        const cost = costFor(profile)
        const scale = minCostPerUnit(index, { cost, blockedEdges: blocked })
        expect(scale, `${profile}: measured scale == the definition`).toBeCloseTo(
          referenceScale(index, blocked, profile),
          9,
        )
        for (const node of index.graph.nodes) {
          const remaining = dijkstra(index, node.id, target, { cost, blockedEdges: blocked })
          const estimate = scale * euclidean(node, goal)
          if (!remaining.ok) {
            // Nothing reachable means no bound to check — but `h` must still be a number, because A* adds it to
            // `g` for every vertex it touches, including the ones that cannot arrive.
            expect(Number.isFinite(estimate), `${profile}: finite estimate for an unreachable pair`).toBe(true)
            continue
          }
          bounds += 1
          expect(
            estimate,
            `${profile}: h("${node.id}") = ${String(estimate)} overstates the true ${String(remaining.cost)}`,
          ).toBeLessThanOrEqual(remaining.cost + COST_EPSILON)
        }
      }
    })
    expect(bounds, 'the sweep checked real bounds, not an empty loop').toBeGreaterThan(400)
  })

  it('would answer wrongly on `shaded` if the estimate were not scaled', () => {
    // `a-star.spec.ts` proves the mechanism with a synthetic ×0.2 weighting. This is the same failure with a
    // profile that ships, which is what makes it a bug report rather than a thought experiment: 146 m of shade
    // costs 124.1, the 100 m sunlit line costs 125, and `h = crow-flight` prices the shaded corner as though it
    // would cost a metre per metre. The margin is small — 0.9 units — because the 1.25 penalty caps how far the
    // 0.85 bonus can mislead, and it is still a route the user would have walked wrong.
    // `b` is placed by solving the two circle intersections: |ab| = 105, |bc| = 41, |ac| = 100. The drawn
    // length of each edge is then its own crow-flight, so a factor and a cost per unit are the same number.
    const bx = (105 ** 2 - 41 ** 2 + 100 ** 2) / 200
    const by = Math.sqrt(Math.max(0, 105 ** 2 - bx ** 2))
    const index = planarGraph(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: bx, y: by },
        { id: 'c', x: 100, y: 0 },
      ],
      [
        { id: 'ab', from: 'a', to: 'b', attributes: { shaded: true } },
        { id: 'bc', from: 'b', to: 'c', attributes: { shaded: true } },
        { id: 'ac', from: 'a', to: 'c', attributes: { shaded: false } },
      ],
    )
    const optimum = mustFind(dijkstra(index, 'a', 'c', { profile: 'shaded' }), 'dijkstra')
    expect(optimum.nodeIds).toEqual(['a', 'b', 'c'])
    expect(optimum.cost).toBeCloseTo((105 + 41) * SHADED_BONUS, 9)

    // The default: A* measures the 0.85 off the graph and agrees.
    const scaled = mustFind(aStar(index, 'a', 'c', { profile: 'shaded' }), 'a-star, scaled estimate')
    expect(scaled.nodeIds).toEqual(['a', 'b', 'c'])
    expect(scaled.cost).toBe(optimum.cost)

    // The naive `h = metres between the points`, i.e. the assumption a fixed scale bakes in: the corner looks
    // like 130.25 of work and the sunlit line like 125, so the goal is settled first and the search stops.
    const naive: Extract<RouteResult, { ok: true }> = mustFind(
      aStar(index, 'a', 'c', { profile: 'shaded', heuristic: (from, to) => euclidean(from, to) }),
      'a-star, unscaled estimate',
    )
    expect(naive.nodeIds).toEqual(['a', 'c'])
    expect(naive.cost).toBeCloseTo(100 * UNSHADED_PENALTY, 9)
    expect(naive.cost - optimum.cost).toBeGreaterThan(0.5)
    expect(naive.metres).toBe(100)
    expect(scaled.metres).toBeCloseTo(146, 9)
  })

  it('settles the same cost as Dijkstra under every profile — 200 seeded graphs', () => {
    let pairs = 0
    /** How often each profile chose a *different walk* from `shortest`, to prove the sweep is not uniform. */
    const differing = new Map<WeightProfile, number>(profiles((profile) => [profile, 0]))
    sweepGraphs(200, 'cost/profile-parity', ({ generated, blocked }) => {
      const index = variedGraph(generated)
      const first = index.graph.nodes[0]
      if (first === undefined) return expect.fail('a sweep graph with no vertices')
      const baseline = new Map<NodeId, readonly NodeId[]>()
      for (const profile of PROFILES_ALL) {
        for (const target of targetsOf(generated, 3) as readonly NodeId[]) {
          const expected = dijkstra(index, first.id, target, { profile, blockedEdges: blocked })
          const actual = aStar(index, first.id, target, { profile, blockedEdges: blocked })
          if (!expected.ok) {
            expect(actual.ok, `trial with "${target}" unreachable: a-star must refuse too`).toBe(false)
            continue
          }
          const found = mustFind(actual, `${profile} ${first.id} to ${target}`)
          pairs += 1
          expect(found.cost, `${profile}: cost parity`).toBeCloseTo(expected.cost, 9)
          expect(found.nodeIds[0]).toBe(first.id)
          expect(found.nodeIds[found.nodeIds.length - 1]).toBe(target)
          assertWalkable(index, found.nodeIds, blocked)
          if (profile === 'shortest') {
            baseline.set(target, expected.nodeIds)
            continue
          }
          const same = baseline.get(target)
          if (same !== undefined && same.join('>') !== found.nodeIds.join('>')) {
            differing.set(profile, (differing.get(profile) ?? 0) + 1)
          }
        }
      }
    })
    expect(pairs, 'the parity sweep ran real pairs').toBeGreaterThan(1500)
    for (const [profile, count] of differing) {
      if (profile === 'shortest') continue
      expect(count, `${profile} must actually choose differently somewhere in the sweep`).toBeGreaterThan(0)
    }
  })
})

/** A throwaway edge for the pricing claims that need an `GraphEdge` rather than an index. */
function anEdge(metres: number): Parameters<ReturnType<typeof costFor>>[0] {
  return {
    id: 'e',
    from: 'a' as NodeId,
    to: 'b' as NodeId,
    metres,
    oneWay: false,
    attributes: DEFAULT_EDGE_ATTRIBUTES,
  }
}

/** A `GeneratedGraph` of random lengths, for the claims that need many edges and no topology. */
function randomEdges(rng: ReturnType<typeof createRandom>, count: number): GeneratedGraph {
  const nodes = Array.from({ length: count + 1 }, (_, i) => ({ id: `n${String(i)}`, x: i * 10, y: (i % 7) * 10 }))
  const edges = Array.from({ length: count }, (_, i) => ({
    id: `e${String(i)}`,
    from: `n${String(i)}`,
    to: `n${String(i + 1)}`,
    metres: 1 + rng.int(400),
    oneWay: false,
  }))
  return { nodes, edges }
}
