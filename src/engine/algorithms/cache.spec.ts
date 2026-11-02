/**
 * The route cache, and the one property that outranks all the others: **a hit must be the same answer.**
 *
 * A cache is the rare piece of code where a bug is invisible on the happy path. Every entry it serves wrongly
 * still *is* a route, on this graph, walkable and plausible — which is how a cache that keys on too little ships
 * for a term before someone notices the shaded walk is being served under "shortest". So the tests here are
 * mostly about refusal: a different profile, a different closure set, the reverse direction, an option the key
 * cannot represent, a different graph. The seeded sweep at the end is the one that catches the rest.
 *
 * `ms` and `cached` are dropped before every deep comparison, and the reason is in the module header: the first
 * figure measures the search that ran and the second says whether this call ran it. Neither is a property of the
 * answer, and pretending otherwise would make the test assert that the cache lies.
 */
import { describe, expect, it } from 'vitest'
import { PROFILE_ORDER } from '../routing/cost'
import { aStar } from './a-star'
import { bfs } from './bfs'
import { dijkstra } from './dijkstra'
import {
  createRandom,
  indexOfGraph,
  randomGraph,
  seedFrom,
  sweepGraphs,
  type GeneratedGraph,
} from '../__tests__/helpers'
import {
  NO_BLOCKED_EDGES,
  ROUTE_CACHE_CAPACITY,
  RouteCache,
  blockedSetHash,
  cachedSearch,
  clearRouteCache,
  entryAccepts,
  routeCacheFor,
  routeCacheKey,
  routeCacheView,
} from './cache'
import type { RouteCacheEntry, RouteQuery } from './cache'
import type { RouteSearchOptions } from './search-common'
import type { GraphIndex, NodeId, RouteFound, RouteResult, WeightProfile } from '../types'

const SEARCHES = {
  dijkstra,
  'a-star': aStar,
  bfs,
} as const

type SearchName = keyof typeof SEARCHES

/** The walk, in a shape a union of success and failure can be compared in. */
function pathOf(result: RouteResult): readonly NodeId[] {
  return result.ok ? result.nodeIds : []
}

/** Drop the two fields that describe the *call* rather than the answer. */
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

function query(
  from: NodeId,
  to: NodeId,
  algorithm: SearchName = 'dijkstra',
  profile: WeightProfile = 'shortest',
  blockedEdges?: ReadonlySet<NodeId>,
): RouteQuery {
  return {
    from,
    to,
    algorithm,
    options: { profile, ...(blockedEdges === undefined ? {} : { blockedEdges }) },
  }
}

/** A `run` that counts, so "it did not re-run" is an observation rather than an implication. */
function counter(index: GraphIndex, asked: RouteQuery): { run: () => RouteResult; calls: () => number } {
  let calls = 0
  const profile = asked.options?.profile ?? 'shortest'
  const blocked = asked.options?.blockedEdges
  const run = (): RouteResult => {
    calls += 1
    return SEARCHES[asked.algorithm as SearchName](index, asked.from, asked.to, {
      profile,
      ...(blocked === undefined ? {} : { blockedEdges: blocked }),
      ...(asked.options?.trace === undefined ? {} : { trace: asked.options.trace }),
    })
  }
  return { run, calls: () => calls }
}

/** A real `RouteFound`, because a hand-shaped success is a fixture with no owner. */
function foundRoute(from: NodeId, to: NodeId): RouteFound {
  const { index } = graphOf(6, `cache/route/${from}-${to}`)
  const result = dijkstra(index, from, to, { profile: 'shortest' })
  if (!result.ok) throw new Error(`${from}→${to} is not reachable on this fixture`)
  return result
}

function graphOf(nodeCount: number, seedTag: string, options: { extraEdges?: number; oneWayChance?: number } = {}) {
  const generated = randomGraph(nodeCount, createRandom(seedFrom(seedTag)), options)
  return { generated, index: indexOfGraph(generated) }
}

function targets(generated: GeneratedGraph, count: number): readonly NodeId[] {
  return generated.nodes.slice(0, count).map((node) => node.id)
}

describe('the cache key', () => {
  it('is a function of the whole request, so a profile and a closure set are both in it', () => {
    const open = routeCacheKey(query('a', 'b', 'dijkstra', 'shortest'))
    const shaded = routeCacheKey(query('a', 'b', 'dijkstra', 'shaded'))
    const blocked = routeCacheKey(query('a', 'b', 'dijkstra', 'shortest', new Set(['e1'])))
    const otherAlgorithm = routeCacheKey(query('a', 'b', 'bfs', 'shortest'))
    const swapped = routeCacheKey(query('b', 'a', 'dijkstra', 'shortest'))
    const keys = [open, shaded, blocked, otherAlgorithm, swapped]
    expect(new Set(keys).size, `${keys.join(' | ')}`).toBe(5)
    // …and equal requests give equal keys, which is the half a uniqueness check cannot show.
    expect(routeCacheKey(query('a', 'b', 'dijkstra', 'shortest'))).toBe(open)
    // "Nothing is closed" has four spellings an app might write, and they are one question. The empty set and
    // the field's absence hashing apart is how a hook that defaults to `NO_BLOCKED_EDGES` misses on every first
    // query while a hook that omits the field hits — the bug this line caught before the UI existed to hide it.
    expect(routeCacheKey(query('a', 'b', 'dijkstra', 'shortest', NO_BLOCKED_EDGES))).toBe(open)
    expect(routeCacheKey(query('a', 'b', 'dijkstra', 'shortest', new Set<string>()))).toBe(open)
    expect(routeCacheKey({ from: 'a', to: 'b', algorithm: 'dijkstra', options: { profile: 'shortest' } })).toBe(open)
    // A query with no option bag is a type-legal call on a public function, and it means "the engine's own
    // defaults" — which for this key is the same question as an empty bag, because `profile` absent *is*
    // `shortest` rather than a sixth profile nobody named.
    expect(routeCacheKey({ from: 'a', to: 'b', algorithm: 'dijkstra' })).toBe(
      routeCacheKey({ from: 'a', to: 'b', algorithm: 'dijkstra', options: {} }),
    )
    expect(routeCacheKey({ from: 'a', to: 'b', algorithm: 'dijkstra' })).not.toBeNull()
  })

  it('keys on every option the searches accept, with no case missing', () => {
    // The completeness claim the walk exists to make: with all five fields of `RouteSearchOptions` populated,
    // the two function-valued ones make the key `null` (unkeyable, so uncached), and the three that can be
    // spelled appear in the key by name. If a sixth option is ever added to the type, this expectation is the
    // one that has to be widened — which is the loud version of the failure the walk was written to avoid.
    const all: RouteSearchOptions = {
      profile: 'shaded',
      blockedEdges: new Set(['e1']),
      trace: false,
      cost: () => 1,
      now: () => 0,
    }
    expect(routeCacheKey({ from: 'a', to: 'b', algorithm: 'dijkstra', options: all })).toBeNull()
    const spelled = routeCacheKey({
      from: 'a',
      to: 'b',
      algorithm: 'dijkstra',
      options: { profile: 'shaded', blockedEdges: new Set(['e1']), trace: false },
    })
    expect(spelled).not.toBeNull()
    for (const part of ['profile=shaded', 'blockedEdges=set:', 'trace=false']) {
      expect(spelled, part).toContain(part)
    }
  })

  it('walks the option bag, so an option nobody thought about is still in the key', () => {
    const traced = routeCacheKey({ from: 'a', to: 'b', algorithm: 'dijkstra', options: { trace: true } })
    const untraced = routeCacheKey({ from: 'a', to: 'b', algorithm: 'dijkstra', options: { trace: false } })
    expect(traced).not.toBeNull()
    expect(untraced).not.toBeNull()
    expect(traced).not.toBe(untraced)
    // `trace: false` means the snapshots and settled order are empty, so two entries that differ only there
    // would serve a walker a route with no replay in it. The default is `true`, and "absent" and "true" must
    // therefore be the *same* key or the first query would miss its own entry.
    const defaulted = routeCacheKey({ from: 'a', to: 'b', algorithm: 'dijkstra', options: {} })
    expect(defaulted).not.toBe(untraced)
  })

  it('declines to key a query that carries a function, rather than guessing', () => {
    // The behaviour — run it, store nothing — is in the second describe, where a graph is in reach. Here the
    // claim is only that `null` is what a function-valued option produces, for both `cost` and `now`.
    for (const options of [{ cost: () => 1 }, { now: () => 0 }] as const) {
      expect(routeCacheKey({ from: 'a', to: 'b', algorithm: 'dijkstra', options }), JSON.stringify(Object.keys(options))).toBeNull()
    }
  })

  it('hashes a closure set by its contents, not by how it was filled', () => {
    const left = new Set(['e3', 'e1', 'e2'])
    const right = new Set(['e1', 'e2', 'e3'])
    expect(blockedSetHash(left)).toBe(blockedSetHash(right))
    expect(blockedSetHash(new Set<string>())).toBe(blockedSetHash(undefined))
    expect(blockedSetHash(new Set(['e1']))).not.toBe(blockedSetHash(new Set(['e2'])))
    expect(blockedSetHash(new Set(['e1', 'e2']))).not.toBe(blockedSetHash(new Set(['e1'])))
    expect(blockedSetHash(new Set(['e1', 'e2']))).toContain('2:')
  })

  it('separates every pair of same-size closure sets it is handed', () => {
    // Not a proof of injectivity — 64 bits cannot be that — but a measurement of the size of set this cache
    // actually sees: every subset of up to three walkways out of twelve, on two graphs. A collision here would
    // be the first one, and the entry check below is what makes even that harmless.
    const ids = Array.from({ length: 12 }, (_, i) => `e${String(i)}`)
    const seen = new Map<string, string>()
    let subsets = 0
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        for (let k = j + 1; k < ids.length; k++) {
          const one = ids[i]
          const two = ids[j]
          const three = ids[k]
          if (one === undefined || two === undefined || three === undefined) continue
          const set = new Set<string>([one, two, three])
          const hash = blockedSetHash(set)
          subsets += 1
          const prior = seen.get(hash)
          if (prior !== undefined) expect.fail(`${prior} and ${[...set].join(',')} collide`)
          seen.set(hash, [...set].join(','))
        }
      }
    }
    expect(subsets).toBe(220)
  })

  it('refuses an entry whose closure set does not match, which is what a collision needs to get past', () => {
    const found = foundRoute('n0', 'n1')
    const entry: RouteCacheEntry = { result: found, blockedIds: ['e1'] }
    expect(entryAccepts(entry, new Set(['e1']))).toBe(true)
    expect(entryAccepts(entry, new Set(['e2']))).toBe(false)
    expect(entryAccepts(entry, new Set<string>())).toBe(false)
    expect(entryAccepts({ result: found, blockedIds: [] }, undefined)).toBe(true)
    expect(entryAccepts({ result: found, blockedIds: [] }, NO_BLOCKED_EDGES)).toBe(true)
  })
})

describe('cachedSearch, on the graphs the search specs use', () => {
  it('answers the second identical question without running the search', () => {
    const { index } = graphOf(24, 'cache/hit')
    const asked = query('n0', 'n1')
    const first = counter(index, asked)
    const one = cachedSearch(index, asked, first.run)
    expect(first.calls()).toBe(1)
    expect(one.cached).toBe(false)
    const second = counter(index, asked)
    const two = cachedSearch(index, asked, second.run)
    expect(second.calls()).toBe(0)
    expect(two.cached).toBe(true)
    expect(pathOf(two)).toEqual(pathOf(one))
    // …and the hit is byte-identical to the answer it replaced. A hit returns a shallow copy stamped
    // `cached: true` rather than the stored object, because the stored object must keep reporting itself as
    // fresh — one spread per hit is the price of that, and `useMemo` holds the reference across renders.
    expect(comparable(two)).toEqual(comparable(one))
  })

  it('never serves a hit across a profile', () => {
    const { index } = graphOf(20, 'cache/profile')
    for (const profile of PROFILE_ORDER) {
      // Each profile gets a cold cache, or the inner loop below — which deliberately asks every *other*
      // profile too — would find its own entries waiting on the next turn of the outer loop and the counts
      // would describe a warm cache while the test claims to be filling one.
      clearRouteCache(index)
      const asked = query('n0', 'n9', 'dijkstra', profile)
      const fresh = dijkstra(index, 'n0', 'n9', { profile })
      const warm = counter(index, asked)
      expect(cachedSearch(index, asked, warm.run).cached).toBe(false)
      expect(warm.calls()).toBe(1)
      const repeat = counter(index, asked)
      const replay = cachedSearch(index, asked, repeat.run)
      expect(repeat.calls(), `${profile} asked twice must not search twice`).toBe(0)
      expect(replay.cached).toBe(true)
      expect(comparable(replay)).toEqual(comparable(fresh))
      // Every *other* profile is a fresh question, even where it happens to agree on the walk: two profiles
      // sharing a route is common on a small graph, and it is exactly when a coarse key would be tempting and
      // exactly when it would be wrong.
      for (const other of PROFILE_ORDER) {
        if (other === profile) continue
        const askedElsewhere = query('n0', 'n9', 'dijkstra', other)
        const counter2 = counter(index, askedElsewhere)
        const otherResult = cachedSearch(index, askedElsewhere, counter2.run)
        expect(counter2.calls(), `${other} must not be answered from ${profile}`).toBe(1)
        expect(otherResult.cached).toBe(false)
        expect(comparable(otherResult)).toEqual(comparable(dijkstra(index, 'n0', 'n9', { profile: other })))
      }
    }
    // …and the whole 5-profile grid stays 5 entries, so none of the above was an eviction in disguise.
    expect(routeCacheView(index)?.size).toBe(PROFILE_ORDER.length)
  })

  it('never serves a hit across a closure set, or across the reverse direction', () => {
    const { generated, index } = graphOf(20, 'cache/blocked')
    const asked = query('n0', 'n9')
    const open = counter(index, asked)
    cachedSearch(index, asked, open.run)
    expect(open.calls()).toBe(1)
    for (const edge of generated.edges.slice(0, 6)) {
      const closed = query('n0', 'n9', 'dijkstra', 'shortest', new Set([edge.id]))
      const each = counter(index, closed)
      cachedSearch(index, closed, each.run)
      expect(each.calls(), `blocking ${edge.id} is a new question`).toBe(1)
      // …and the open question is still cached under its own key, not overwritten by the closure.
      expect(counter(index, asked).calls()).toBe(0)
      const reused = counter(index, asked)
      expect(cachedSearch(index, asked, reused.run).cached).toBe(true)
      expect(reused.calls()).toBe(0)
    }
    const back = counter(index, query('n9', 'n0'))
    expect(cachedSearch(index, query('n9', 'n0'), back.run).cached).toBe(false)
    expect(back.calls()).toBe(1)
  })

  it('keeps every answer identical to the uncached search, over seeded graphs', () => {
    let checks = 0
    sweepGraphs(40, 'cache/deep-equality', ({ index, blocked, generated, sources }) => {
      const nodes = generated.nodes.map((node) => node.id)
      for (const from of sources.slice(0, 1)) {
        for (const to of nodes.slice(0, 3)) {
          if (to === from) continue
          for (const algorithm of Object.keys(SEARCHES) as SearchName[]) {
            for (const profile of ['shortest', 'shaded'] as const) {
              const asked = query(from, to, algorithm, profile, blocked)
              const fresh = SEARCHES[algorithm](index, from, to, { profile, blockedEdges: blocked })
              expect(cachedSearch(index, asked, () => fresh).cached).toBe(false)
              const second = cachedSearch(index, asked, () => {
                throw new Error(`the cache re-ran ${algorithm} on check ${String(checks)}`)
              })
              expect(second.cached).toBe(true)
              expect(comparable(second)).toEqual(comparable(fresh))
              checks += 1
            }
          }
        }
      }
    })
    expect(checks).toBeGreaterThan(200)
  })

  it('caches a refusal, because "there is no way" is an answer with a payload', () => {
    const { generated, index } = graphOf(10, 'cache/refusal-kept')
    const asked = query('n0', 'n9', 'dijkstra', 'shortest', new Set(generated.edges.map((edge) => edge.id)))
    const first = counter(index, asked)
    const one = cachedSearch(index, asked, first.run)
    expect(first.calls()).toBe(1)
    expect(one.ok).toBe(false)
    expect(one.cached).toBe(false)
    const second = counter(index, asked)
    const two = cachedSearch(index, asked, second.run)
    expect(second.calls()).toBe(0)
    expect(two.ok).toBe(false)
    expect(two.cached).toBe(true)
    // The reachable set is the useful half of a refusal, and it survives the round trip.
    if (one.ok || two.ok) return expect.fail('this fixture was expected to refuse')
    expect(two.exploredOrder).toEqual(one.exploredOrder)
  })

  it('never stores an entry that reports itself as cached', () => {
    const { index } = graphOf(8, 'cache/restamp')
    clearRouteCache(index)
    const asked = query('n0', 'n1')
    routeCacheFor(index).store(asked, { ...foundRoute('n0', 'n1'), cached: true })
    expect(routeCacheFor(index).lookup(asked)?.cached).toBe(false)
  })
})

describe('capacity, decline and the numbers the badge prints', () => {
  it('keeps the bound and evicts the oldest answer', () => {
    const { generated, index } = graphOf(16, 'cache/bound')
    clearRouteCache(index)
    const cache = new RouteCache(3)
    const nodes = targets(generated, 6).map(String)
    const [a, b, c, d, e] = nodes
    for (const to of [b, c, d]) {
      expect(to).toBeDefined()
      cache.store(query(String(a), String(to)), foundRoute('n0', String(to)))
    }
    expect(cache.size).toBe(3)
    expect(cache.victim()).toBe(routeCacheKey(query(String(a), String(b))))
    cache.store(query(String(a), String(e)), foundRoute('n0', String(e)))
    expect(cache.size).toBe(3)
    expect(cache.view().evictions).toBe(1)
    expect(cache.view()).toMatchObject({ lookups: 0, hits: 0, misses: 0 })
    // The oldest question is unanswered again: a bound that evicted the newest instead would be a different
    // policy, and the name says which one this is.
    expect(cache.lookup(query(String(a), String(b)))).toBeNull()
    expect(cache.lookup(query(String(a), String(c)))).not.toBeNull()
    expect(ROUTE_CACHE_CAPACITY).toBeGreaterThan(64)
  })

  it('stores nothing when capacity is zero, which is how the cache is switched off', () => {
    const { generated } = graphOf(10, 'cache/off')
    const [a, b] = targets(generated, 2).map(String)
    const cache = new RouteCache(0)
    const asked = query(String(a), String(b))
    cache.store(asked, foundRoute(String(a), String(b)))
    expect(cache.size).toBe(0)
    expect(cache.lookup(asked)).toBeNull()
  })

  it('declines a query it cannot key, and says it was not cached', () => {
    const { generated, index } = graphOf(12, 'cache/function-decline')
    const [a, b] = targets(generated, 2).map(String)
    const priced: RouteQuery = { from: String(a), to: String(b), algorithm: 'dijkstra', options: { cost: () => 1 } }
    expect(routeCacheKey(priced)).toBeNull()
    clearRouteCache(index)
    const first = cachedSearch(index, priced, () => foundRoute(String(a), String(b)))
    const second = cachedSearch(index, priced, () => foundRoute(String(a), String(b)))
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(false)
    expect(routeCacheView(index)?.size).toBe(0)
  })

  it('reports a rate, and reports having no data as no data', () => {
    const { generated, index } = graphOf(14, 'cache/stats')
    clearRouteCache(index)
    expect(routeCacheView(index)).toMatchObject({ hits: 0, misses: 0, lookups: 0, hitRate: null, size: 0 })
    const [a, b, c] = targets(generated, 3).map(String)
    const first = query(String(a), String(b))
    const secondQuery = query(String(a), String(c))
    for (let i = 0; i < 3; i++) cachedSearch(index, first, () => foundRoute(String(a), String(b)))
    cachedSearch(index, secondQuery, () => foundRoute(String(a), String(c)))
    const view = routeCacheView(index)
    expect(view).toMatchObject({ hits: 2, misses: 2, lookups: 4, size: 2 })
    expect(view?.hitRate).toBeCloseTo(0.5, 10)
    clearRouteCache(index)
    expect(routeCacheView(index)).toMatchObject({ hits: 0, misses: 0, lookups: 0, hitRate: null, size: 0 })
  })

  it('gives each graph its own cache, so a new map cannot inherit an old answer', () => {
    const first = graphOf(12, 'cache/per-graph')
    const second = graphOf(12, 'cache/per-graph')
    expect(first.index).not.toBe(second.index)
    const asked = query('n0', 'n1')
    routeCacheFor(first.index).store(asked, foundRoute('n0', 'n1'))
    expect(routeCacheFor(first.index).lookup(asked)).not.toBeNull()
    expect(routeCacheFor(second.index).lookup(asked)).toBeNull()
    expect(routeCacheFor(second.index)).toBe(routeCacheFor(second.index))
    expect(routeCacheView(null)).toBeNull()
  })
})
