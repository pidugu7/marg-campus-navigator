/**
 * The route cache: what a search already answered, kept so it is not answered twice.
 *
 * ### Why the policy is in the engine and not in the hook
 * A hook could hold a `Map` and be done with it. It does not, for one reason: the key has to describe *the
 * question the search was asked*, and the question is {@link RouteSearchOptions} — the profile, the closure set,
 * the trace switch, and a caller-supplied `cost` function that a `Map` keyed on `` `${from}|${to}` `` would
 * silently ignore. Keying belongs next to the type it keys, so that adding a sixth option is an edit in one file
 * rather than a bug in another. `src/hooks/useRoute.ts` decides only *whether* to consult it, which is why
 * Phase 4's compare mode and Phase 3's baseline both became cached without writing any cache logic: they already
 * went through the one function that asks a search a question.
 *
 * ### What is in the key, and what makes a key
 * Every field of {@link RouteSearchOptions}, walked rather than listed, plus the two node ids and the
 * algorithm's name. Walking matters: a future option cannot be forgotten by the author of the cache because it
 * was never mentioned in it. The blocked-edge set enters as {@link blockedSetHash} — a count and two FNV-1a lanes
 * over the sorted ids — because a set has no identity worth storing and its *contents* are the question. An
 * absent closure set and an empty one are normalised to the same part, because they are the same question.
 *
 * A function-valued option (`cost`, `now`) makes {@link routeCacheKey} return `null`, and a `null` key means
 * **this query is not cacheable**: the search runs and nothing is stored. Two closures with the same source text
 * can compute different weights, and a cache that cannot tell them apart is worse than no cache — it is a cache
 * that is confidently wrong. The UI never passes one, which is what makes the decline rare rather than useless.
 *
 * ### What a hit is allowed to serve
 * A hash collision would have to match 64 bits *and* the id count, and even then it cannot serve the wrong walk:
 * {@link RouteCache.store} keeps the sorted ids beside the result and {@link entryAccepts} compares them, so a
 * colliding entry is refused and then replaced. That second check is the entire reason an entry is a pair rather
 * than a bare `RouteResult`.
 *
 * `from → to` and `to → from` are **different questions** and never share an entry: on a graph with one-way
 * walkways a reverse route is not the reverse of the route, and even where it is, proving that costs a scan of
 * the path. `docs/MAP-DATA.md` documents `oneWay` as ordinary, so the safe reading is the only one on offer.
 *
 * Refusals are cached too, under the same key. "There is no way there with the annexe closed" is an answer, and
 * `exploredOrder` on a failure is the reachable set Phase 6 draws — dropping it because the walk failed would
 * make the cache useful for exactly half the questions.
 *
 * ### What a hit reports
 * `cached: true`, and nothing else changes. `expanded` is the vertices the search settled when it ran and `ms`
 * is how long that took — both are properties of the search that produced the entry, so re-stamping `ms` to `0`
 * would turn a measured figure into a statement about the call that skipped the work. The badge is what tells a
 * reader the search did not run again, which is why `docs/ALGORITHMS.md` §13's rule (settled counts decide,
 * timings never do) and this cache agree rather than fight.
 *
 * ### Invariants
 * - Nothing is ever served for a different `from`, `to`, algorithm, profile, closure set, trace setting or
 *   graph. The graph is not in the key: one {@link RouteCache} per `GraphIndex`, held in a `WeakMap`, so a new
 *   graph is a new cache and an old entry cannot outlive the thing it describes. That is why no "invalidate the
 *   cache" call is needed when the map changes — {@link clearRouteCache} exists for the case where one is wanted
 *   (Phase 7's editor mutates in place).
 * - A hit is refused when the entry's sorted blocked ids differ from the query's, whatever the hash says.
 * - `size <= capacity`, and an eviction is always the least recently used entry. {@link LRUCache} owns that
 *   proof and its spec runs `consistency()` after every operation, so this file adds no ordering logic to
 *   re-verify and does not duplicate that test either.
 * - `lookups === hits + misses`, `misses >= 0`, and `hitRate` is `null` when nothing has been read.
 * - {@link RouteCache.clear} empties the entries *and* resets the counters: a rate quoted against lookups that
 *   are no longer possible is a number about a cache nobody has.
 *
 * ### Why 192, and what that number is not
 * Capacity bounds memory; it is not a hit-rate claim, so the honest justification is arithmetic about the working
 * set rather than tuning. A browsing session revisits the pairs a person actually toggles between — on this
 * campus the 20 named places × 19 partners for one algorithm and profile, a few dozen entries — while a sweep of
 * all 1 482 ordered pairs at five profiles asks 22 230 questions no fixed capacity fits. 192 is an order of
 * magnitude above the session and two below the sweep, so the sweep *thrashes* the cache and keeps answering
 * correctly, which is the only behaviour a bound has to guarantee (that is what the seeded sweep in
 * `cache.spec.ts` measures). Nothing about a hit depends on capacity: the cache is allowed to be small because
 * it is allowed to be wrong about nothing.
 *
 * ### Complexity
 * O(1) amortised per lookup, plus O(k log k) to canonicalise `k` blocked ids — `k` is at most the number of
 * walkways a person can close from a UI, and sorting ~50 strings costs far less than settling one vertex.
 * `blockedSetHash` is recomputed per call rather than memoised on the set, because a `ReadonlySet` arrives by
 * reference and a caller is free to build a new one each render; memoising it would need a side table whose
 * lifetime is the bug this file exists to avoid.
 */
import { LRUCache } from '../structures/lru-cache'
import type { EdgeId, GraphIndex, NodeId, RouteResult } from '../types'
import type { RouteSearchOptions } from './search-common'

/** Entries kept per graph. See "Why 192" above. */
export const ROUTE_CACHE_CAPACITY = 192

/**
 * The empty closure set, in one shared instance.
 *
 * A fresh `new Set()` per render is a *different reference*, which is harmless for the key (the hash of nothing
 * is stable either way) and harmful for `useMemo`'s dependency array, where it would re-run every search on
 * every render. Hooks default to this instead of allocating.
 */
export const NO_BLOCKED_EDGES: ReadonlySet<EdgeId> = new Set<EdgeId>()

/** One question, in the shape the searches take. */
export interface RouteQuery {
  readonly from: NodeId
  readonly to: NodeId
  /** The picker's name for the search — the only thing besides the pair and the options that two entries may
   *  not share. A name, not a function, because the answer's vocabulary is the engine's and the request's is
   *  the picker's. */
  readonly algorithm: string
  /** The request's whole option bag: the profile, the closure set, the trace switch. There is deliberately no
   *  separate `profile` field, because two ways to say the same thing are two ways for one of them to leave the
   *  key behind. */
  readonly options?: RouteSearchOptions
}

/** What one entry holds: the answer, and the closure set it was true under. */
export interface RouteCacheEntry {
  readonly result: RouteResult
  readonly blockedIds: readonly EdgeId[]
}

/** The numbers the badge and the hit-rate counter print. */
export interface RouteCacheView {
  readonly hits: number
  readonly misses: number
  readonly lookups: number
  /** `hits / lookups`, or `null` when nothing has been read: a rate over no data is not a rate. */
  readonly hitRate: number | null
  readonly size: number
  readonly capacity: number
  readonly evictions: number
}

/** FNV-1a over the whole string. Two lanes with different offsets, so a collision has to be unlucky twice. */
function fnv1a(text: string, offset: number): number {
  let hash = offset >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Sorted, because a set's order is an accident of how it was filled and its contents are the question. */
export function canonicalBlockedIds(blocked: ReadonlySet<EdgeId> | undefined): readonly EdgeId[] {
  return blocked === undefined || blocked.size === 0 ? [] : [...blocked].sort()
}

/**
 * `count:digest` for a closure set — how many walkways are closed, and two 32-bit FNV-1a lanes over the sorted
 * ids, in hex.
 *
 * Exported because it is the part worth reading on its own, and because the two properties that matter can be
 * asserted without knowing the key's layout: the hash of a set does not depend on insertion order, and one id
 * more or less always changes it.
 */
export function blockedSetHash(blocked: ReadonlySet<EdgeId> | undefined): string {
  const ids = canonicalBlockedIds(blocked)
  const joined = ids.join('\u0000')
  const low = fnv1a(joined, 0x811c9dc5)
  const high = fnv1a(`${String(joined.length)}\u0000${joined}`, 0x9e3779b9)
  return `${String(ids.length)}:${low.toString(16).padStart(8, '0')}${high.toString(16).padStart(8, '0')}`
}

/**
 * The second lock: does this entry actually answer this closure set?
 *
 * Exported as a pure predicate so it can be tested with a doctored entry — a hash collision is not something a
 * test can manufacture on demand, and a guard nobody can reach is a guard nobody can believe.
 */
export function entryAccepts(entry: RouteCacheEntry, blocked: ReadonlySet<EdgeId> | undefined): boolean {
  const wanted = canonicalBlockedIds(blocked)
  const held = entry.blockedIds
  if (held.length !== wanted.length) return false
  return held.every((id, index) => id === wanted[index])
}

/** `null` for a value no string can represent, which is the caller's cue to not cache the query at all. */
function optionField(name: string, value: unknown): string | null {
  if (typeof value === 'function') return null
  if (value instanceof Set) return `${name}=set:${blockedSetHash(value)}`
  // Every remaining type in `RouteSearchOptions` — a string, a boolean, a number — has a `String` form that
  // separates two distinct values, which is all a key part has to do. An *object*-valued option would not, so
  // this is the line to change if one is ever added; there is deliberately no `JSON.stringify` branch standing
  // here for a field that does not exist, because a branch no caller can reach is coverage theatre and the
  // spec below is what makes the day it changes loud.
  return `${name}=${String(value)}`
}

/**
 * The cache key for a query, or `null` when the query carries something no key can represent.
 *
 * `null` is not "cache it anyway under a coarser key" — see the module header. Every defined field of
 * `RouteSearchOptions` is walked in sorted order, so the key is a function of the whole request.
 */
export function routeCacheKey(query: RouteQuery): string | null {
  const parts: string[] = [`from=${query.from}`, `to=${query.to}`, `algorithm=${query.algorithm}`]
  const options: Record<string, unknown> = { ...(query.options ?? {}) }
  // "Nothing is closed" has three spellings — the field absent, `undefined`, and an empty set — and all three
  // are the same question. Without this line the third hashes to `set:0:…` while the first two contribute
  // nothing, and a hook defaulting to NO_BLOCKED_EDGES would miss on every query while a hook omitting the field
  // hit. Found by the key's own equality test, before there was a UI to hide it in.
  if (!(options.blockedEdges instanceof Set)) options.blockedEdges = NO_BLOCKED_EDGES
  for (const name of Object.keys(options).sort()) {
    const field = optionField(name, options[name])
    if (field === null) return null
    parts.push(field)
  }
  return parts.join('\u0000')
}

/** One `RouteCache` per graph, so "the graph changed" and "the cache was invalidated" are the same event. */
const CACHES = new WeakMap<GraphIndex, RouteCache>()

export class RouteCache {
  readonly #store: LRUCache<string, RouteCacheEntry>
  #lookups = 0
  #hits = 0

  /** `0` is legal and means "cache off": the UI gets a way to stop memoising without a null check in front of
   *  every call, and every lookup then declines in one place. */
  constructor(capacity: number = ROUTE_CACHE_CAPACITY) {
    this.#store = new LRUCache<string, RouteCacheEntry>(capacity)
  }

  /** A hit, or `null`. A colliding hash is a `null` too: the entry refuses the query. */
  lookup(query: RouteQuery): RouteResult | null {
    const key = routeCacheKey(query)
    // An unkeyable query is not a cache read, so it is not counted as one either: it would put a miss in a
    // badge whose whole job is to report what the cache did.
    if (key === null) return null
    this.#lookups += 1
    const entry = this.#store.get(key)
    // One probe, not two: a `peek` first would need a second read to promote, and the second read's `undefined`
    // would be a branch no single-threaded caller can reach — the shape of test the brief rules out. The cost of
    // ordering it this way is that a *refused* collision has already been promoted in the list, which is an
    // eviction-order nuance behind a 64-bit collision plus a matching count, and the entry is replaced by the
    // `store` that follows the miss anyway.
    if (entry === undefined || !entryAccepts(entry, query.options?.blockedEdges)) return null
    this.#hits += 1
    return entry.result
  }

  /** Store an answer. Silently declines an unkeyable query, so callers never branch on it. */
  store(query: RouteQuery, result: RouteResult): void {
    const key = routeCacheKey(query)
    if (key === null) return
    const stored: RouteResult = result.cached ? { ...result, cached: false } : result
    this.#store.put(key, { result: stored, blockedIds: canonicalBlockedIds(query.options?.blockedEdges) })
  }

  get size(): number {
    return this.#store.size
  }

  get capacity(): number {
    return this.#store.capacity
  }

  /** The key a `put` will evict next, for a test or a tooltip. */
  victim(): string | undefined {
    return this.#store.victim()
  }

  /**
   * The counters the badge and the hit-rate read.
   *
   * `RouteCache` keeps its own hit count rather than reading `LRUCache`'s, because the two ledgers answer
   * different questions. The list counts *map reads*, and a lookup that is refused — no entry, or an entry whose
   * closure set does not match — never reaches its `get`, so its `misses` would stay `0` while the caller walked
   * away with nothing. That is "100 % hit rate" after two hits and two misses, which is how a badge starts
   * advertising a cache that is not helping. Here one call to {@link lookup} is one lookup, hits are the ones
   * that answered, and `misses` is the difference — so `lookups === hits + misses` cannot be false by
   * construction. `evictions` still comes from the list, because that is the list's event and not this cache's.
   */
  view(): RouteCacheView {
    return {
      hits: this.#hits,
      misses: this.#lookups - this.#hits,
      lookups: this.#lookups,
      // The getters rather than `#store` again, so the two ways of asking the same question cannot drift.
      // `null`, not `0`: `LRUCacheStats.hitRate` has to stay a number, and uses 0 for "nothing read yet". A
      // badge must distinguish "0 % of your lookups hit" from "no lookups yet", so this one says `null`.
      hitRate: this.#lookups === 0 ? null : this.#hits / this.#lookups,
      size: this.size,
      capacity: this.capacity,
      evictions: this.#store.stats.evictions,
    }
  }

  /** Empty the entries and forget the counters — see the invariant in the header. */
  clear(): void {
    this.#store.clear()
    this.#store.resetStats()
    this.#lookups = 0
    this.#hits = 0
  }
}

/** The cache that belongs to this graph, created on first use. */
export function routeCacheFor(index: GraphIndex): RouteCache {
  const existing = CACHES.get(index)
  if (existing !== undefined) return existing
  const created = new RouteCache()
  CACHES.set(index, created)
  return created
}

/**
 * Drop everything cached for `index`.
 *
 * Not needed for correctness — a new graph gets a new cache on its own — but Phase 7's editor will mutate a
 * graph in place, and a button that says "the cache is empty now" has to mean it.
 */
export function clearRouteCache(index: GraphIndex): void {
  routeCacheFor(index).clear()
}

/** The numbers for the badge, or `null` when there is no graph to have a cache about. */
export function routeCacheView(index: GraphIndex | null): RouteCacheView | null {
  return index === null ? null : routeCacheFor(index).view()
}

/**
 * Ask `run` unless this exact question was asked before, and report which happened by setting `cached`.
 *
 * `run` is the search itself, passed in rather than imported, because the *choice* of search belongs to
 * `src/hooks/useRoute.ts` (one place a picker's string becomes a function call) while the *policy* belongs here.
 * Keeping them on opposite sides of that line is what lets this cache cover Dijkstra, A*, BFS and depth-first
 * identically without importing any of them.
 */
export function cachedSearch(
  index: GraphIndex,
  query: RouteQuery,
  run: () => RouteResult,
): RouteResult {
  const cache = routeCacheFor(index)
  const hit = cache.lookup(query)
  // A copy on both paths, always: the entry in the cache keeps `cached: false` so it never lies to whichever
  // query reads it next, and the caller's object is stamped here. One shallow spread per lookup, which is what
  // the module's Complexity note costs against a search, and it buys back more than that at a `useMemo`, which
  // gets a stable value to hold.
  if (hit !== null) return { ...hit, cached: true }
  const answer: RouteResult = { ...run(), cached: false }
  cache.store(query, answer)
  return answer
}
