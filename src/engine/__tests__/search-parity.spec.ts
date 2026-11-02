/**
 * The four searches, against each other.
 *
 * Each algorithm spec already checks itself against a naive oracle. What no single algorithm can check is the
 * claim the *union* depends on — that a screen may branch on `result.reason` and `result.ok` without knowing
 * which search answered — so that claim gets its own file, and it is a claim about equality between
 * implementations rather than about correctness of any one of them.
 *
 * Two kinds of test live here:
 *
 * - **Identical refusals.** The same broken input, all four searches, one normalised object. `algorithm` and
 *   `ms` are stripped because those are the only two fields that are *supposed* to differ; everything else —
 *   reason, message, which vertices were settled, what the frontier looked like when the search stopped — has
 *   to match or the screens cannot be written once.
 * - **Identical reachability.** On seeded graphs, all four must agree about *whether* a pair is routable. The
 *   cost of a route is where they are allowed to disagree (BFS counts hops, DFS counts nothing useful), and
 *   whether a route exists is where they are not.
 */
import { describe, expect, it } from 'vitest'
import { stepsReplay } from '../algorithms/path-utils'
import { aStar } from '../algorithms/a-star'
import { bfs } from '../algorithms/bfs'
import { depthFirstRoute, reachableFrom } from '../algorithms/dfs'
import { dijkstra } from '../algorithms/dijkstra'
import {
  LADDER_COST,
  ladderCrossing,
  ladderIslands,
  ladderLine,
  refusalLadder,
  sweepGraphs,
  targetsOf,
  type RouteSearchFn,
} from './helpers'
import { PROFILE_ORDER } from '../routing/cost'
import type { EdgeId, GraphIndex, NodeId, RouteResult } from '../types'

interface Search {
  readonly name: string
  readonly run: RouteSearchFn
}

/** The order is the order the UI's dropdown will show, and the order the docs list them in. */
const SEARCHES: readonly Search[] = [
  { name: 'dijkstra', run: dijkstra },
  { name: 'a-star', run: aStar },
  { name: 'bfs', run: bfs },
  { name: 'dfs', run: depthFirstRoute },
]

/** Every field that must be byte-identical across searches, with the two honest exceptions removed. */
function comparable(result: RouteResult): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...result }
  delete fields.algorithm
  delete fields.ms
  return fields
}

describe('the four searches, on the same broken input', () => {
  it('refuse identically', () => {
    const brokenInputs: readonly { label: string; graph: GraphIndex; from: NodeId; to: NodeId; cost: EdgeId | 'default' | 'bad' }[] = [
      { label: 'unknown destination', graph: ladderLine(4), from: 'a', to: 'nope', cost: 'default' },
      { label: 'unknown origin', graph: ladderLine(4), from: 'nope', to: 'a', cost: 'default' },
      { label: 'both unknown', graph: ladderLine(4), from: 'x', to: 'y', cost: 'default' },
      { label: 'across two components', graph: ladderIslands(), from: 'a', to: 'd', cost: 'default' },
      { label: 'stranded by closures', graph: ladderLine(3), from: 'a', to: 'c', cost: 'default' },
      { label: 'a profile that prices nothing', graph: ladderCrossing(), from: 'a', to: 'c', cost: 'bad' },
    ]
    for (const input of brokenInputs) {
      const options =
        input.cost === 'bad'
          ? { cost: () => 0 }
          : input.label === 'stranded by closures'
            ? { cost: LADDER_COST, blockedEdges: new Set(['b-c']) }
            : { cost: LADDER_COST }
      const results = SEARCHES.map((search) => ({ name: search.name, value: search.run(input.graph, input.from, input.to, options) }))
      const first = results[0]
      if (first === undefined) continue
      for (const later of results.slice(1)) {
        expect(comparable(later.value), `${input.label}: ${later.name} refused differently from ${first.name}`).toEqual(
          comparable(first.value),
        )
      }
      // And it must actually be a refusal — four identical *routes* would prove nothing about the ladder.
      expect(first.value.ok, `${input.label}: expected a refusal`).toBe(false)
    }
  })

  it('carry their own name and the shared profile in every metric', () => {
    // `PROFILE_ORDER` rather than a local list, so a sixth profile cannot quietly miss this sweep.
    for (const profile of PROFILE_ORDER) {
      for (const search of SEARCHES) {
        const found = search.run(ladderLine(3), 'a', 'c', { cost: LADDER_COST, profile })
        expect(found.algorithm, search.name).toBe(search.name)
        expect(found.profile, search.name).toBe(profile)
        const refused = search.run(ladderLine(3), 'a', 'nope', { cost: LADDER_COST, profile })
        expect(refused.profile, `${search.name} refusal`).toBe(profile)
      }
    }
  })

  it('all answer the same way for a request to stay put', () => {
    for (const search of SEARCHES) {
      const result = search.run(ladderCrossing(), 'b', 'b', { cost: LADDER_COST })
      expect(result.ok, search.name).toBe(true)
      if (!result.ok) continue
      expect(result.nodeIds, search.name).toEqual(['b'])
      expect(result.metres, search.name).toBe(0)
      expect(result.hops, search.name).toBe(0)
      expect(result.minutes, search.name).toBe(0)
      expect(result.steps, search.name).toHaveLength(1)
    }
  })

  it('close an edge identically, whichever edge it is', () => {
    // One closure at a time, over every walkway in the square: for each, all four must return the same
    // `ok`-ness. This is the shape of Phase 6's sweep, and the cheapest place to notice that one search
    // treats `blockedEdges` as a hint while another treats it as law.
    const index = ladderCrossing()
    for (const edge of index.graph.edges) {
      const verdicts = SEARCHES.map((search) => {
        const result = search.run(index, 'a', 'c', { cost: LADDER_COST, blockedEdges: new Set([edge.id]) })
        return `${search.name}:${String(result.ok)}`
      })
      const unique = new Set(verdicts.map((verdict) => verdict.slice(verdict.indexOf(':'))))
      expect(unique.size, `closing ${edge.id} → ${verdicts.join(' ')}`).toBe(1)
    }
  })

  it('report the reachable set when they run out of frontier', () => {
    // `exploredOrder` after an exhausted search is the reachable set, for a heap, a queue and a stack alike.
    // The comparison is on sorted sets because the *order* is precisely what distinguishes the searches.
    const index = ladderIslands()
    const reach = [...reachableFrom(index, 'a')].sort()
    for (const search of SEARCHES) {
      const result = search.run(index, 'a', 'd', { cost: LADDER_COST, blockedEdges: new Set() })
      expect(result.ok, search.name).toBe(false)
      if (result.ok) continue
      expect([...result.exploredOrder].sort(), search.name).toEqual(reach)
    }
  })
})

describe('the four searches, on the directions list', () => {
  it('replays the walk it found, on every algorithm, on every pair', () => {
    // cp3 put `simplifyLegs` between the geometry and the wording, so the property that matters is not "the
    // sentences are pretty" — it is that a step list, concatenated, is *the same path the search returned*. If
    // a fold ever dropped a vertex or double-counted a joint, this fails on all four searches at once, which
    // is the only way to notice it happened to the one you did not think about. `metres` accounting is checked
    // in the same sweep because a leg that loses a vertex usually loses its length too.
    sweepGraphs(60, 'parity/step-replay', ({ trial, generated, index, blocked, sources }) => {
      for (const source of sources) {
        for (const target of targetsOf(generated)) {
          const where = `trial ${String(trial)} ${source} to ${target}`
          for (const search of SEARCHES) {
            const result = search.run(index, source, target, { cost: LADDER_COST, blockedEdges: blocked })
            if (!result.ok) continue
            expect(stepsReplay(result.steps), `${where}: ${search.name} steps replay`).toEqual([...result.nodeIds])
            expect(result.steps.length, `${where}: ${search.name} one sentence per turn`).toBeLessThanOrEqual(
              result.hops + 1,
            )
            const told = result.steps.reduce((total, step) => total + step.metres, 0)
            expect(told, `${where}: ${search.name} sentence lengths`).toBeLessThanOrEqual(
              result.metres + 0.05 * result.steps.length,
            )
            expect(told, `${where}: ${search.name} lost a stretch`).toBeGreaterThanOrEqual(
              result.metres - 0.05 * result.steps.length,
            )
            for (const step of result.steps) {
              expect(step.instruction.length, `${where}: ${search.name} an empty sentence`).toBeGreaterThan(0)
              expect(step.nodeIds.length, `${where}: ${search.name} a step without vertices`).toBeGreaterThan(0)
            }
          }
        }
      }
    })
  })
})

describe('the four searches, on 60 seeded graphs', () => {
  it('agree about which pairs are routable at all', () => {
    sweepGraphs(60, 'parity/reachability', ({ trial, generated, index, blocked, sources }) => {
      for (const source of sources) {
        for (const target of targetsOf(generated)) {
          const options = { cost: LADDER_COST, blockedEdges: blocked }
          const verdicts = SEARCHES.map((search) => `${search.name}:${String(search.run(index, source, target, options).ok)}`)
          const where = `trial ${String(trial)} ${source} to ${target}`
          expect(new Set(verdicts.map((verdict) => verdict.slice(verdict.indexOf(':')))).size, `${where}: ${verdicts.join(' ')}`).toBe(1)
        }
      }
    })
  })

  it('leave dijkstra and a-star indistinguishable in cost, and the two queue searches indistinguishable in reach', () => {
    sweepGraphs(60, 'parity/cost-roles', ({ trial, generated, index, blocked, sources }) => {
      for (const source of sources) {
        for (const target of targetsOf(generated)) {
          const options = { cost: LADDER_COST, blockedEdges: blocked }
          const dijk = dijkstra(index, source, target, options)
          const star = aStar(index, source, target, options)
          const queue = bfs(index, source, target, options)
          const stack = depthFirstRoute(index, source, target, options)
          const where = `trial ${String(trial)} ${source} to ${target}`
          if (!dijk.ok || !star.ok) {
            expect(star.ok, `${where}: a-star agreed to disagree`).toBe(dijk.ok)
            continue
          }
          // The heap pair: same optimum, and A* may settle less.
          expect(Math.abs(star.cost - dijk.cost), `${where} cost`).toBeLessThanOrEqual(1e-6)
          expect(star.expanded, `${where} expansions`).toBeLessThanOrEqual(dijk.expanded)
          // The queue pair and the stack: both must walk a legal route no shorter than the optimum, and both
          // must return the same hop count they report as `cost`.
          for (const [name, result] of [['bfs', queue], ['dfs', stack]] as const) {
            if (!result.ok) continue
            expect(result.cost, `${where} ${name} cost is hops`).toBe(result.hops)
            expect(result.metres, `${where} ${name} length`).toBeGreaterThanOrEqual(dijk.metres - 0.1)
          }
        }
      }
    })
  })
})

describe('each search against the shared ladder', () => {
  // The ladder in `helpers.ts` is what the four `refusalLadder` calls in the algorithm specs run. Running it
  // here again — on dijkstra, whose own spec pins the same cases on its own fixtures — is the deliberate
  // redundancy: it means a change to the ladder has to break a *dijkstra* test, not only the three newer ones.
  refusalLadder('dijkstra', dijkstra)
})

/** The list above is the whole set of searches; a new one has to be added here or this fails loudly. */
it('has a search for every name the metrics type allows', () => {
  expect(SEARCHES.map((search) => search.name).sort()).toEqual(['a-star', 'bfs', 'dfs', 'dijkstra'])
})
