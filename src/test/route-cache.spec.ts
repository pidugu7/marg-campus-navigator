/**
 * The cache, on the campus the app actually loads.
 *
 * `src/engine/algorithms/cache.spec.ts` proves the mechanism over seeded graphs. This file is about the two
 * claims the UI makes and the mechanism cannot: that an answer remembered on *this* map is the answer this map
 * would have produced, and that the second search behind a preference — the baseline every Δ is quoted against —
 * is genuinely free after the first one. Both are measured through `runSearch`, the same function the hooks call,
 * because a cache tested around its own seam is a cache tested around the thing that could be wrong.
 */
import { describe, expect, it } from 'vitest'
import { buildGraph, campus } from '@/data'
import { runSearch, searchUncached } from '@/hooks/useRoute'
import { NO_BLOCKED_EDGES, routeCacheView } from '@/engine'
import type { RouteResult, WeightProfile } from '@/engine'

const model = buildGraph(campus)
const graph = model.graph
const ids = model.nodes.map((node) => node.id as string)
const pairs = ids.flatMap((from) => ids.filter((to) => to !== from).map((to) => [from, to] as const))
const ALGORITHMS = ['dijkstra', 'a-star', 'bfs'] as const

/** The two fields that describe the call rather than the walk are the two a cache is allowed to change. */
function comparable(result: RouteResult): Record<string, unknown> {
  // A copy minus two keys, rather than `{ ms, cached, ...rest }` destructuring: the underscore-blind-name idiom
  // is an `no-unused-vars` error in this repo's config, and the config is not the thing to change. Listing the
  // fields to *keep* would be quieter still and would stop covering a field the day someone adds one — which is
  // precisely the day this comparison matters.
  const rest: Record<string, unknown> = { ...result }
  delete rest['ms']
  delete rest['cached']
  return rest
}

function lookups(): { hits: number; misses: number; lookups: number; size: number } {
  const view = routeCacheView(graph)
  if (view === null) return expect.fail('the campus graph has no cache') as never
  return { hits: view.hits, misses: view.misses, lookups: view.lookups, size: view.size }
}

describe('the route cache on campus.json', () => {
  it('answers a repeat of the same question without searching', () => {
    const first = runSearch(graph, 'labs', 'hostel-2', 'a-star', 'shortest', NO_BLOCKED_EDGES)
    expect(first.cached).toBe(false)
    const second = runSearch(graph, 'labs', 'hostel-2', 'a-star', 'shortest', NO_BLOCKED_EDGES)
    expect(second.cached).toBe(true)
    expect(comparable(second)).toEqual(comparable(first))
    // …and the numbers a reader is shown are the search's own, not zeros standing in for skipped work.
    if (!(first.ok && second.ok)) return expect.fail('this pair routes on the campus')
    expect(second.expanded).toBe(first.expanded)
    expect(second.metres).toBe(first.metres)
    expect(second.ms).toBe(first.ms)
  })

  it('agrees with an uncached search on every ordered pair and every algorithm', () => {
    let checks = 0
    for (const [from, to] of pairs) {
      for (const algorithm of ALGORITHMS) {
        const profile: WeightProfile = 'shortest'
        const cached = runSearch(graph, from, to, algorithm, profile, NO_BLOCKED_EDGES)
        const fresh = searchUncached(graph, from, to, algorithm, profile, NO_BLOCKED_EDGES)
        expect(comparable(cached), `${from}→${to} by ${algorithm}`).toEqual(comparable(fresh))
        checks += 1
      }
    }
    expect(pairs.length).toBe(1482)
    expect(checks).toBe(1482 * ALGORITHMS.length)
  })

  it('never answers across a profile, and never across a closed walkway', () => {
    const seen: string[] = []
    for (const profile of ['shaded', 'lit', 'quiet', 'shaded'] as const) {
      const result = runSearch(graph, 'library', 'hostel-1', profile === 'shaded' ? 'dijkstra' : 'a-star', profile, NO_BLOCKED_EDGES)
      seen.push(`${profile}:${String(result.cached)}`)
    }
    // The repeat of `shaded` is the only one of the four that can be a hit, and it is — which is the same
    // sentence as "the other three were new questions", printed in one line.
    expect(seen).toEqual(['shaded:false', 'lit:false', 'quiet:false', 'shaded:true'])
    const edge = model.edges[0]
    if (edge === undefined) return expect.fail('the campus has no edges')
    // Warm the open question first, or the check below measures a query that was never asked.
    expect(runSearch(graph, 'cafeteria', 'sports-ground', 'bfs', 'shortest', NO_BLOCKED_EDGES).cached).toBe(false)
    const blockedOnce = runSearch(graph, 'cafeteria', 'sports-ground', 'bfs', 'shortest', new Set([edge.id]))
    expect(blockedOnce.cached).toBe(false)
    const blockedTwice = runSearch(graph, 'cafeteria', 'sports-ground', 'bfs', 'shortest', new Set([edge.id]))
    expect(blockedTwice.cached).toBe(true)
    const open = runSearch(graph, 'cafeteria', 'sports-ground', 'bfs', 'shortest', NO_BLOCKED_EDGES)
    expect(open.cached, 'closing a walkway must not disturb the open question').toBe(true)
  })

  it('serves the baseline from the entry the card already filled, which is what cp2 promised in a comment', () => {
    // `useRoute` asks two questions whenever the preference is not the baseline: the priced walk, and the same
    // walk on `shortest` to subtract it against. A hook cannot be *called* without a renderer, so this measures
    // the seam the hook drives, in the order a reader produces it — `shortest` first (what the card showed
    // before the knob was touched), then the preference, then the baseline the second screen needs. The third
    // call hitting is the whole claim: switching to `shaded` costs one search, not two.
    runSearch(graph, 'auditorium', 'gates', 'dijkstra', 'shortest', NO_BLOCKED_EDGES)
    expect(runSearch(graph, 'auditorium', 'gates', 'dijkstra', 'shaded', NO_BLOCKED_EDGES).cached).toBe(false)
    const priced = lookups()
    expect(priced.hits, 'a new preference cannot hit').toBeLessThan(priced.lookups)
    const before = lookups()
    expect(runSearch(graph, 'auditorium', 'gates', 'dijkstra', 'shortest', NO_BLOCKED_EDGES).cached).toBe(true)
    const after = lookups()
    expect(after.hits - before.hits, 'the baseline lookup hit').toBe(1)
    expect(after.lookups - before.lookups, 'and it was one lookup, not a search').toBe(1)
  })

  it('keeps its own ledger straight, over everything this file has asked', () => {
    const view = routeCacheView(graph)
    if (view === null) return expect.fail('the campus graph has no cache')
    expect(view.lookups).toBe(view.hits + view.misses)
    expect(view.size).toBeLessThanOrEqual(view.capacity)
    expect(view.capacity).toBe(192)
    // A rate printed to one decimal, and `null` is unreachable here because the sweep above already read the
    // cache — which is the point: after any real session the counters have data, so the badge never invents any.
    expect(view.lookups).toBeGreaterThan(100)
    expect(view.hitRate).not.toBeNull()
  })

  it('refuses to answer a question about a different graph, even one built from the same file', () => {
    const other = buildGraph(campus).graph
    expect(other).not.toBe(graph)
    const asked = runSearch(other, 'labs', 'hostel-2', 'a-star', 'shortest', NO_BLOCKED_EDGES)
    expect(asked.cached, 'a second campus model starts with an empty cache').toBe(false)
    expect(lookups().size).toBeLessThan(200)
  })
})
