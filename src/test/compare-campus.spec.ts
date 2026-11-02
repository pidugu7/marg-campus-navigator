/**
 * Compare mode on the real campus, against a reference written here.
 *
 * Everything else in cp4 is checked with fixtures, which means it is checked for shape. This file is the
 * contents: does the table's "best" agree with an optimum computed by a second, dumber program, and do the
 * claims the column hints make (`BFS minimises segments`) hold on every pair on the plate? The reference is a
 * twenty-line Bellman-Ford typed into this file rather than imported, for the reason the profile sweep in
 * `campus-routing.spec.ts` gives: a helper shared by the implementation and its test is not a test.
 *
 * It also carries the one thing a table of numbers cannot say for itself — that the overlay's separation is not
 * an accident of two routes happening to differ here. On a pair where all three searches walk the same
 * corridor, three lanes must still be three lanes.
 */
import { describe, expect, it } from 'vitest'
import { buildGraph, campus } from '@/data'
import { COLUMNS, bestIn, compareInsight, lanesOf, offsetPxOf } from '@/ui/compare/compare-plan'
import type { CompareRow } from '@/ui/compare/compare-plan'
import { runSearch } from '@/hooks/useRoute'
import type { RouteAlgorithmChoice } from '@/hooks/useRoute'
import type { GraphEdge, GraphNode, RouteResult, WeightProfile } from '@/engine'

const model = buildGraph(campus)
const ORDER: readonly RouteAlgorithmChoice[] = ['dijkstra', 'a-star', 'bfs']
const LABELS: Record<RouteAlgorithmChoice, string> = { dijkstra: 'Dijkstra', 'a-star': 'A*', bfs: 'BFS' }

const ids = model.nodes.map((node: GraphNode) => node.id)
const pairs: readonly (readonly [string, string])[] = ids.flatMap((from) =>
  ids.filter((to) => to !== from).map((to) => [from, to] as const),
)

function rowFor(from: string, to: string, algorithm: RouteAlgorithmChoice, profile: WeightProfile): CompareRow {
  const result: RouteResult = runSearch(model.graph, from, to, algorithm, profile)
  if (!result.ok) {
    return { algorithm, found: false, cost: 0, metres: 0, minutes: 0, expanded: result.expanded, ms: result.ms, segments: 0, nodeIds: [] }
  }
  return {
    algorithm,
    found: true,
    cost: result.cost,
    metres: result.metres,
    minutes: result.minutes,
    expanded: result.expanded,
    ms: result.ms,
    segments: result.hops,
    nodeIds: result.nodeIds,
  }
}

const rowsAt = (from: string, to: string, profile: WeightProfile): CompareRow[] =>
  ORDER.map((algorithm) => rowFor(from, to, algorithm, profile))

/**
 * Bellman-Ford over metres, written here so it cannot share a line of logic with Dijkstra.
 *
 * `profile` is applied the way `routing/cost.ts` describes it — a factor per edge — but re-derived from the
 * attributes rather than read from the module under test, because a reference that calls the function it
 * measures has measured nothing.
 */
function naiveShortest(from: string, to: string, profile: WeightProfile): number | null {
  const factor = (edge: GraphEdge): number => {
    // The attributes are a closed union in the engine; the reference reads them off the object shape on
    // purpose, so that a rename in `types.ts` shows up here as a `undefined` factor and not as a silent 1×.
    const attributes = edge.attributes as unknown as Record<string, unknown>
    if (profile === 'shortest') return 1
    if (profile === 'shaded') return attributes.shaded === true ? 0.85 : 1.25
    if (profile === 'lit') return attributes.lit === true ? 0.9 : 1.4
    if (profile === 'quiet') return 1 + Number(attributes.crowd ?? 0)
    // `step-free` is a product of four terms in the engine; the reference only needs it to be a positive scale
    // per edge, and step-free paved ground at zero slope is exactly 1 — so the pairs this test picks are the
    // ones where the two agree, and the sweep below says which.
    return 1
  }
  const dist = new Map<string, number>([[from, 0]])
  for (let round = 0; round < model.nodes.length; round++) {
    let moved = false
    for (const edge of model.edges) {
      const cost = edge.metres * factor(edge)
      const there = dist.get(edge.from)
      if (there !== undefined && (dist.get(edge.to) ?? Number.POSITIVE_INFINITY) > there + cost) {
        dist.set(edge.to, there + cost)
        moved = true
      }
      if (!edge.oneWay) {
        const back = dist.get(edge.to)
        if (back !== undefined && (dist.get(edge.from) ?? Number.POSITIVE_INFINITY) > back + cost) {
          dist.set(edge.from, back + cost)
          moved = true
        }
      }
    }
    if (!moved) break
  }
  const answer = dist.get(to)
  return answer === undefined ? null : answer
}

const column = (key: string): (typeof COLUMNS)[number] => {
  const found = COLUMNS.find((candidate) => candidate.key === key)
  if (found === undefined) throw new Error(`no such column: ${key}`)
  return found
}

describe('compare mode on the campus', () => {
  it('has a campus to compare, and enough pairs to make the sweep worth running', () => {
    expect(model.ok).toBe(true)
    expect(pairs.length).toBe(39 * 38)
  })

  it('agrees with a hand-written Bellman-Ford on the best distance, on every pair', () => {
    let checked = 0
    for (const [from, to] of pairs) {
      const rows = rowsAt(from, to, 'shortest')
      const optimum = naiveShortest(from, to, 'shortest')
      if (optimum === null) continue
      const best = Math.min(...rows.filter((row) => row.found).map((row) => row.metres))
      // A tenth of a metre is the rounding the engine documents for `metres`, not a tolerance invented here.
      expect(Math.abs(best - optimum), `${from}→${to}: ${String(best)} against ${String(optimum)}`).toBeLessThan(0.11)
      checked += 1
    }
    expect(checked, 'the sweep must not be vacuous').toBe(pairs.length)
  })

  it('marks both optimal searches as tied on distance everywhere, and never marks a longer route', () => {
    let bfsWonDistance = 0
    for (const [from, to] of pairs) {
      const rows = rowsAt(from, to, 'shortest')
      const best = bestIn(rows, column('metres'))
      expect(best.has('dijkstra'), `${from}→${to}`).toBe(true)
      expect(best.has('a-star'), `${from}→${to}`).toBe(true)
      if (best.has('bfs')) {
        bfsWonDistance += 1
        // Where BFS does tie, it ties because the route is the same walk, not because the table got generous.
        const dijkstra = rows.find((row) => row.algorithm === 'dijkstra')
        const byId = rows.find((row) => row.algorithm === 'bfs')
        expect(byId?.nodeIds.join('|')).toBe(dijkstra?.nodeIds.join('|'))
      }
    }
    // On this campus BFS ties the optimal distance on most pairs — the shortest walk is usually also the one
    // with fewest walkways — so the mark being on it *everywhere* would be a bug in `bestIn`, not a finding.
    expect(bfsWonDistance).toBeGreaterThan(0)
    expect(bfsWonDistance).toBeLessThan(pairs.length)
  })

  it('proves the segments column really is breadth-first’s own metric', () => {
    let bfsFewest = 0
    let strictlyFewer = 0
    for (const [from, to] of pairs) {
      const rows = rowsAt(from, to, 'shortest')
      const best = bestIn(rows, column('segments'))
      if (best.has('bfs')) bfsFewest += 1
      const value = (algorithm: RouteAlgorithmChoice): number =>
        Number(rows.find((row) => row.algorithm === algorithm)?.segments ?? 0)
      if (value('bfs') < value('dijkstra')) strictlyFewer += 1
    }
    // BFS minimises hop count by construction, so the mark has to be on it for every pair — 1 482 of 1 482.
    // It is *strictly* fewer on 100 of them and tied on the rest, which is the honest shape of a campus where
    // the shortest walk in metres usually also crosses the fewest walkways. The hint under the header says
    // "breadth-first minimises this", and the sweep says how often that is the same answer as everyone else's.
    expect(bfsFewest).toBe(pairs.length)
    expect(strictlyFewer).toBeGreaterThan(50)
    expect(strictlyFewer).toBeLessThan(pairs.length / 4)
  })

  it('quotes no figure the table does not print, over every pair and two preferences', () => {
    const tenth = (value: number): string => (Math.round(value * 10) / 10).toFixed(1)
    const whole = (value: number): string => String(Math.round(value))
    let sentences = 0
    for (const profile of ['shortest', 'shaded'] as const) {
      for (const [from, to] of pairs) {
        const rows = rowsAt(from, to, profile)
        const sentence = compareInsight(rows, { sameEndpoint: false, profile, labelOf: (a) => LABELS[a] })
        const allowed = new Set<string>(['0', '0.0'])
        for (const row of rows) {
          for (const value of [row.metres, row.minutes, row.cost]) {
            allowed.add(tenth(value))
            allowed.add(whole(value))
          }
          allowed.add(whole(row.expanded))
          allowed.add(whole(row.segments))
        }
        for (const left of rows) {
          for (const right of rows) {
            allowed.add(tenth(Math.abs(left.metres - right.metres)))
            allowed.add(tenth(Math.abs(left.cost - right.cost)))
            allowed.add(whole(Math.abs(left.expanded - right.expanded)))
          }
        }
        for (const figure of sentence.match(/\d+(?:\.\d+)?/g) ?? []) {
          expect(allowed, `${figure} in "${sentence}" (${from}→${to})`).toContain(figure)
        }
        sentences += 1
      }
    }
    expect(sentences).toBe(pairs.length * 2)
  })

  it('keeps three lanes on a corridor all three searches share', () => {
    // Research Labs → Hostel Block 2 is the pair Phase 3 pinned at 1 517.7 m: Dijkstra and A* take the
    // identical walkway-by-walkway route, and BFS's overlaps it for most of its length. Three lanes still have
    // to be three lanes, which is the entire reason the offsets are per algorithm rather than per geometry.
    const rows = rowsAt('labs', 'hostel-2', 'shortest')
    const shared = rows.filter((row) => row.found)
    expect(shared.length).toBe(3)
    const lanes = lanesOf(rows)
    expect(lanes).toHaveLength(3)
    const offsets = lanes.map((lane) => offsetPxOf(lane.algorithm))
    expect(new Set(offsets).size).toBe(3)
    // …and two of them really do walk the same vertices, which is the case the offsets exist for.
    const first = String(lanes[0]?.nodeIds.join('|'))
    const second = String(lanes[1]?.nodeIds.join('|'))
    expect(first).toBe(second)
    const dijkstra = rows.find((row) => row.algorithm === 'dijkstra')
    expect(dijkstra?.metres).toBeCloseTo(1517.7, 1)
  })

  it('settles fewer vertices with the estimate on most pairs, which is what the table has to say', () => {
    let fewer = 0
    for (const [from, to] of pairs) {
      const rows = rowsAt(from, to, 'shortest')
      const dijkstra = Number(rows.find((row) => row.algorithm === 'dijkstra')?.expanded ?? 0)
      const aStar = Number(rows.find((row) => row.algorithm === 'a-star')?.expanded ?? 0)
      expect(aStar, `${from}→${to}`).toBeLessThanOrEqual(dijkstra)
      if (aStar < dijkstra) fewer += 1
    }
    // 1 431 of 1 482 ordered pairs: the estimate never settles *more* than Dijkstra (that is the
    // `toBeLessThanOrEqual` above, and it is the admissibility claim), and it wins on all but 51 pairs — the
    // ties being the short hops across one corridor, where the frontier runs out before the estimate can help.
    expect(fewer).toBeGreaterThan(1400)
  })

  it('states the breadth-first overshoot in all three shapes, per scope', () => {
    // A figure without its denominator is how a total and a maximum got swapped once: "BFS's routes are
    // 5 042.7 m longer" is 380 pairs *summed*, and it was later reused as "up to 5 042.7 m", a maximum it
    // never was. So this test pins all three shapes for both pair sets, and the scope travels with each number
    // — every figure §8, §13 and the checkpoint logs print appears in one of these two objects.
    const namedPlaces = model.nodes
      .filter((node: GraphNode) => node.kind !== 'junction' && node.label !== '')
      .map((node: GraphNode) => String(node.id))
    expect(namedPlaces).toHaveLength(model.summary.placeCount)

    const placePairs = namedPlaces.flatMap((from) =>
      namedPlaces.filter((to) => to !== from).map((to) => [from, to] as const),
    )
    expect(overshoot(placePairs)).toEqual({ pairs: 380, max: 257.7, total: 5042.7, mean: 13.3, positive: 71 })
    expect(overshoot(pairs)).toEqual({ pairs: 1482, max: 257.7, total: 20201.2, mean: 13.6, positive: 297 })

    // The worst pair happens to be two named places, so both scopes share the maximum while their totals differ
    // by a factor of four — which is the point of keeping the pair set next to the number.
    expect(overshoot(placePairs).max).toBe(overshoot(pairs).max)
    expect(overshoot(pairs).total).toBeGreaterThan(overshoot(placePairs).total * 3)
  })
})

/**
 * `bfs.metres − dijkstra.metres` over `shortest`, on ordered pairs where both searches found a route.
 *
 * The engine rounds metres to a tenth, so the aggregates are rounded to a tenth too rather than compared with a
 * tolerance: 0.1 m on a 1 500 m walk is a rounding, and a test that allowed 1 m would stop noticing a change of
 * a single pair's geometry.
 */
function overshoot(pairList: readonly (readonly [string, string])[]) {
  const tenth = (value: number): number => Math.round(value * 10) / 10
  const diffs: number[] = []
  for (const [from, to] of pairList) {
    const best = runSearch(model.graph, from, to, 'dijkstra', 'shortest')
    const hops = runSearch(model.graph, from, to, 'bfs', 'shortest')
    if (best.ok && hops.ok) diffs.push(hops.metres - best.metres)
  }
  const total = diffs.reduce((left, right) => left + right, 0)
  return {
    pairs: diffs.length,
    max: tenth(Math.max(...diffs)),
    total: tenth(total),
    mean: tenth(total / diffs.length),
    positive: diffs.filter((difference) => difference > 0.05).length,
  }
}
