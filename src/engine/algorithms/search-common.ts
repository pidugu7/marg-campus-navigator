/**
 * What Dijkstra, A* and BFS share, so that the three of them cannot disagree.
 *
 * The algorithms differ in exactly one decision: **which candidate to settle next.** Everything else —
 * reading the cost function, refusing blocked and profile-closed edges, discarding stale heap entries,
 * remembering how each vertex was first reached, counting expansions, snapshotting the frontier for the
 * replay overlay, and assembling the `RouteResult` — is the same code. Three copies of it is how a phase
 * ends with an algorithm whose tooltip contradicts its own distance.
 *
 * So this module owns the run and each algorithm owns its ordering rule, which is also the honest answer to
 * the viva question "what makes A* different from Dijkstra?": one added term in one argument.
 */
import { COST_EPSILON, WALKING_SPEED_MPS } from '../constants'
import { MinHeap } from '../structures/min-heap'
import { routeLegs, stepsFromLegs } from './path-utils'
import type {
  AlgorithmName,
  EdgeCost,
  EdgeId,
  GraphIndex,
  NodeId,
  RouteFound,
  RouteMetrics,
  RouteNotFound,
  RouteResult,
  WeightProfile,
} from '../types'

/** Everything a caller may steer. All of it optional, none of it copied. */
export interface RouteSearchOptions {
  /** Weight of one edge. Contract: a finite number `> 0`, or `Infinity` to close the edge for this profile. */
  readonly cost?: EdgeCost
  /** Walkways closed for this query — a detour, roadworks, a gate shut at night. Read by reference. */
  readonly blockedEdges?: ReadonlySet<EdgeId>
  /** The pace `minutes` is quoted at, and the label the UI shows. Cost never reads it. */
  readonly profile?: WeightProfile
  /** Record a frontier snapshot per settled vertex (default `true`). Phase 4's benchmark sets `false`. */
  readonly trace?: boolean
  /** Clock in milliseconds. Injectable so `ms` can be *asserted* instead of bounded by `toBeLessThan`. */
  readonly now?: () => number
}

/** A candidate for settling, as recorded at the moment it was relaxed. */
export interface Offer {
  readonly id: NodeId
  /** Where the walker came from, and along which walkway. `null` only for the origin. */
  readonly via: NodeId | null
  readonly edgeId: EdgeId | null
  /** What the ordering policy compares: cost so far for Dijkstra, cost + estimate for A*, depth for BFS. */
  readonly priority: number
  /** The quantity *this* search minimises, accumulated: weighted cost, or hop count for BFS. */
  readonly cost: number
  /** The real length walked so far, which is what a human is shown whatever the profile does to `cost`. */
  readonly metres: number
}

/** The vertex just settled, carrying the totals that got it settled — so finishing needs no lookups. */
export interface SettledVertex {
  readonly id: NodeId
  readonly cost: number
  readonly metres: number
  readonly via: NodeId | null
  readonly edgeId: EdgeId | null
}

/** One expansion's output: what may be offered next, or the profile that broke its own contract. */
export interface Expansion {
  readonly offers: readonly Omit<Offer, 'priority'>[]
  /**
   * A cost that was neither finite-and-positive nor `Infinity`. Reported rather than clamped: a profile
   * that prices an edge at `0` or `NaN` is a bug in the profile, and silently routing around it would hide
   * it, while throwing would turn a bad weight function into a blank screen.
   */
  readonly badCost?: { readonly edgeId: EdgeId; readonly value: number }
}

const defaultCost: EdgeCost = (edge) => edge.metres

/** The searches that draw their next vertex from the heap, as opposed to the one that draws from a queue. */
const cheapestWins: ReadonlySet<AlgorithmName> = new Set(['dijkstra', 'a-star'])

/**
 * One search, start to finish.
 *
 * The caller's contract is `checkEndpoints()`, then `offer`/`next`/`expand` in whatever order its policy
 * wants, then exactly one of `found`/`exhausted`. The maps are written only by this class, which is what
 * lets `found()` read a total without a fallback: every settled vertex other than the origin got there
 * through a parent that was settled before it, so walking back terminates at the origin by construction.
 */
export class SearchRun {
  readonly #index: GraphIndex
  readonly #algorithm: AlgorithmName
  readonly #from: NodeId
  readonly #to: NodeId
  readonly #cost: EdgeCost
  readonly #blockedEdges: ReadonlySet<EdgeId> | undefined
  readonly #profile: WeightProfile
  readonly #trace: boolean
  readonly #now: () => number
  readonly #startedAt: number
  readonly #heap: MinHeap<Offer> | null
  readonly #queue: Offer[] = []

  /** Cheapest (BFS: first) value seen per vertex, and the record `found()` walks back. */
  readonly #best = new Map<NodeId, number>()
  readonly #parent = new Map<NodeId, { readonly via: NodeId; readonly edgeId: EdgeId }>()
  readonly #settled = new Set<NodeId>()
  readonly #explored: NodeId[] = []
  readonly #snapshots: NodeId[][] = []
  #queueHead = 0
  #expanded = 0

  constructor(index: GraphIndex, from: NodeId, to: NodeId, algorithm: AlgorithmName, options: RouteSearchOptions = {}) {
    const { cost = defaultCost, blockedEdges, profile = 'fastest', trace = true, now = Date.now } = options
    this.#index = index
    this.#algorithm = algorithm
    this.#from = from
    this.#to = to
    this.#cost = cost
    this.#blockedEdges = blockedEdges
    this.#profile = profile
    this.#trace = trace
    this.#now = now
    this.#startedAt = now()
    this.#heap = cheapestWins.has(algorithm) ? new MinHeap<Offer>(compareOffers) : null
  }

  // --- before the search ------------------------------------------------------------------------------

  /**
   * The questions every algorithm must ask before it looks at an edge, in the order it asks them.
   *
   * Shared so that the *order* is the contract: being told "unknown-destination" about an empty map is a
   * lie about which of two problems to fix first, and three searches giving three different messages for
   * one broken file is the drift this whole module exists to prevent.
   */
  checkEndpoints(): RouteNotFound | null {
    const index = this.#index
    if (index.size === 0) {
      return this.refused('empty-graph', 'this map has no vertices, so there is nowhere to route between')
    }
    if (!index.hasNode(this.#from)) {
      return this.refused('unknown-origin', `"${this.#from}" is not a node on this map`)
    }
    if (!index.hasNode(this.#to)) {
      return this.refused('unknown-destination', `"${this.#to}" is not a node on this map`)
    }
    // `componentOf` is precomputed over the whole graph, so it is only a sound fast-reject when nothing is
    // closed. With blocked edges the components can split mid-query, and a search that finds that out by
    // exhausting itself is both cheaper than rebuilding the partition and the truth.
    if (this.#blockedEdges === undefined && index.componentOf(this.#from) !== index.componentOf(this.#to)) {
      return this.refused(
        'disconnected',
        `"${this.#from}" sits in component ${String(index.componentOf(this.#from))} and "${this.#to}" in component ${String(index.componentOf(this.#to))}, so no walkway connects them`,
      )
    }
    return null
  }

  /** `from` and `to` the same vertex: not a failure, and not a search either. */
  isSamePlace(): boolean {
    return this.#from === this.#to
  }

  // --- the ordering policy ----------------------------------------------------------------------------

  /**
   * Put a candidate on the frontier.
   *
   * `Infinity` never reaches here (a closed edge is skipped in `expand`), so one comparison covers both
   * "this is the first time we have seen this vertex" and "this beats the record".
   */
  offer(offer: Offer): void {
    if (this.#settled.has(offer.id)) return
    const seen = this.#best.get(offer.id)
    if (seen !== undefined) {
      // A queue settles a vertex the moment it is discovered, so every later edge to it is uninteresting —
      // that is what makes BFS hop-shortest. A heap keeps the cheaper record and leaves the older entry in
      // place to be discarded on the way out: lazy deletion, and the reason `offer` never mutates the heap.
      if (this.#heap === null) return
      if (!(offer.cost + COST_EPSILON < seen)) return
    }
    this.#best.set(offer.id, offer.cost)
    if (offer.via !== null && offer.edgeId !== null) {
      this.#parent.set(offer.id, { via: offer.via, edgeId: offer.edgeId })
    }
    if (this.#heap !== null) this.#heap.push(offer)
    else this.#queue.push(offer)
  }

  /**
   * Draw the next vertex to settle, discarding stale entries. `null` once the frontier is exhausted.
   *
   * One test, not the two this function first carried. The textbook lazy-deletion skip is
   * `if (popped.cost > best[popped.id]) continue`, and it is implied by the membership check below: under
   * non-negative costs a vertex's cheaper entry always pops first, so a superseded entry can only arrive
   * *after* the vertex was settled. Both lines were tried, one at a time, and the specs were the judge —
   * removing the cost comparison left all 148 engine tests passing (a check that nothing can observe), while
   * removing this one fails "settles the cheapest first, and skips the entry a better record moved past",
   * which is exactly the duplicate pop this line exists to swallow. `docs/ALGORITHMS.md` §1 carries the same
   * correction against the claim Phase 1 wrote.
   */
  next(): SettledVertex | null {
    for (;;) {
      const picked = this.#take()
      if (picked === null) return null
      if (this.#settled.has(picked.id)) continue
      this.#settled.add(picked.id)
      this.#expanded += 1
      this.#explored.push(picked.id)
      this.#snapshots.push(this.#frontierIds())
      return picked
    }
  }

  #take(): Offer | null {
    const heap = this.#heap
    if (heap !== null) return heap.pop() ?? null
    const head = this.#queue[this.#queueHead]
    if (head === undefined) return null
    this.#queueHead += 1
    return head
  }

  /**
   * Neighbours this run may still walk to, with the totals a walker arriving through each would carry.
   *
   * Three refusals, in the order a person would check them: the walkway is closed for this query; the
   * vertex is already settled (a settled vertex cannot improve under non-negative costs, and skipping it
   * here is what keeps `expanded` equal to the vertex count rather than the arc count); the profile closed
   * the edge by pricing it at `Infinity`. A dangling adjacency entry is skipped too — an index built by
   * hand rather than by `AdjacencyGraph.seal()` can name an edge that is not in the snapshot, and there is
   * no length to add, so inventing one would draw a phantom walkway on the map.
   */
  expand(from: SettledVertex): Expansion {
    const offers: Omit<Offer, 'priority'>[] = []
    for (const entry of this.#index.neighboursOf(from.id)) {
      if (this.#blockedEdges?.has(entry.edgeId) === true) continue
      if (this.#settled.has(entry.to)) continue
      const edge = this.#index.edge(entry.edgeId)
      if (edge === undefined) continue
      const weight = this.#cost(edge)
      if (weight === Number.POSITIVE_INFINITY) continue
      if (!(weight > 0) || !Number.isFinite(weight)) {
        return { offers: [], badCost: { edgeId: edge.id, value: weight } }
      }
      const isHop = !cheapestWins.has(this.#algorithm)
      offers.push({
        id: entry.to,
        via: from.id,
        edgeId: edge.id,
        cost: from.cost + (isHop ? 1 : weight),
        metres: Math.round((from.metres + edge.metres) * 10) / 10,
      })
    }
    return { offers }
  }

  // --- after the search -------------------------------------------------------------------------------

  #metrics(): RouteMetrics {
    return {
      algorithm: this.#algorithm,
      profile: this.#profile,
      expanded: this.#expanded,
      // Clamped, because `Date.now()` can step backwards when the machine's clock is corrected, and a
      // negative duration in a results card is a worse bug than a zero. `search-common.spec.ts` pins it.
      ms: Math.max(0, this.#now() - this.#startedAt),
      cached: false,
      // A failure carries it too: on a search that found nothing, the vertices it *did* settle are the
      // reachable set, which is the useful half of the bad news.
      exploredOrder: this.#explored,
      frontierSnapshots: this.#trace ? this.#snapshots : [],
    }
  }

  refused(reason: RouteNotFound['reason'], message: string): RouteNotFound {
    return { ok: false, reason, message, ...this.#metrics() }
  }

  /**
   * The one failure a caller brings on itself: a cost function that breaks its own contract.
   *
   * One message for all three searches on purpose. "The same broken profile fails the same way whichever
   * algorithm you picked" is only true if the wording lives in one place, and the number that matters — what
   * it returned, for which walkway — is in the sentence rather than in a console line nobody opened.
   */
  refusedCost(bad: { readonly edgeId: EdgeId; readonly value: number }): RouteNotFound {
    return this.refused(
      'invalid-graph',
      `the cost function returned ${String(bad.value)} for walkway "${bad.edgeId}"; an edge must cost a finite number greater than 0, or Infinity to close it`,
    )
  }

  /** No route, for the reason a search that ran out of frontier is the only one entitled to give. */
  exhausted(): RouteResult {
    return this.refused(
      'disconnected',
      `the search walked every walkway reachable from "${this.#from}" and never met "${this.#to}"${
        this.#blockedEdges === undefined ? '' : ` — ${String(this.#blockedEdges.size)} walkway(s) are closed for this query`
      }`,
    )
  }

  /** The result for a finished search. `settled` must be the vertex `next()` last returned. */
  found(settled: SettledVertex): RouteResult {
    if (this.isSamePlace()) return this.#trivial(settled)
    const nodeIds: NodeId[] = [this.#to]
    const edgeIds: EdgeId[] = []
    let cursor: NodeId = this.#to
    // Bounded by the number of settled vertices, which is the length of the longest possible parent chain:
    // a parent is always settled *before* its child, so the walk cannot loop, and counting the steps is how
    // the loop needs no "should not happen" branch inside it.
    for (let steps = 0; steps < this.#explored.length && cursor !== this.#from; steps++) {
      const parent = this.#parent.get(cursor)
      if (parent === undefined) break
      nodeIds.unshift(parent.via)
      edgeIds.unshift(parent.edgeId)
      cursor = parent.via
    }
    const legs = routeLegs(this.#index, nodeIds, edgeIds)
    const found: RouteFound = {
      ok: true,
      nodeIds,
      edgeIds,
      cost: settled.cost,
      metres: settled.metres,
      hops: edgeIds.length,
      minutes: minutesFor(settled.metres, this.#profile),
      steps: stepsFromLegs(legs),
      ...this.#metrics(),
    }
    return found
  }

  /** Origin and destination the same vertex: a route of nothing, which is still a route. */
  #trivial(settled: SettledVertex): RouteFound {
    const label = this.#index.node(this.#from)?.label ?? this.#from
    return {
      ok: true,
      nodeIds: [this.#from],
      edgeIds: [],
      cost: settled.cost,
      metres: 0,
      hops: 0,
      minutes: 0,
      steps: [{ direction: 'stay', instruction: `You are already at ${label}.`, metres: 0, nodeIds: [this.#from] }],
      ...this.#metrics(),
    }
  }

  /** The frontier as the replay overlay wants it: unsettled candidates, soonest first, ties by id. */
  #frontierIds(): NodeId[] {
    if (!this.#trace) return []
    const raw: readonly Offer[] = this.#heap !== null ? this.#heap.toArray() : this.#queue.slice(this.#queueHead)
    // Two filters, both of them a fact about the search rather than a guard: a settled vertex is no longer
    // on the frontier, and an entry the record has moved past is stale — it is still physically in the heap,
    // and drawing it would show a candidate the search had already rejected. The pair also removes
    // duplicates, because a vertex can only be re-offered at a strictly cheaper cost.
    return raw
      .filter((offer) => !this.#settled.has(offer.id) && this.#best.get(offer.id) === offer.cost)
      .sort(compareOffers)
      .map((offer) => offer.id)
  }
}

/** Heap order for offers: cheapest first, then id, so a run is reproducible rather than insertion-shaped. */
function compareOffers(a: Offer, b: Offer): number {
  if (a.priority !== b.priority) return a.priority - b.priority
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Minutes at the profile's own pace, to one decimal — 62.3 rather than 62.28571428571429. */
export function minutesFor(metres: number, profile: WeightProfile): number {
  return Math.round((metres / WALKING_SPEED_MPS[profile] / 60) * 10) / 10
}
