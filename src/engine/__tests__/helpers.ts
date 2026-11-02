/**
 * Shared test utilities for the engine specs.
 *
 * Two rules make these worth having in one file rather than inline per spec:
 *  1. **Nothing in a spec is random across runs.** Every generator takes a seed, and every
 *     seed is derived from a string constant, so a failure can be reproduced by copy-pasting
 *     the number out of the test. `Math.random` is banned in `src/engine/**` by ESLint for
 *     exactly this reason.
 *  2. **A property test needs an oracle that is not the code under test.** The reference
 *     implementations here are deliberately naive — `Array.prototype.sort`, a full scan, an
 *     O(V²·E) BFS — because comparing one clever algorithm against another clever algorithm
 *     mostly proves they share the same idea, not that either is right.
 */

/** A seeded generator: mulberry32. 20 lines, deterministic, and good enough for tests. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number
  /** Uniform element of `items`, or undefined for an empty array. */
  pick<T>(items: readonly T[]): T | undefined
  /** True with probability `chance` (default 0.5). */
  bool(chance?: number): boolean
  /** Fisher–Yates, in place on a copy. */
  shuffle<T>(items: readonly T[]): T[]
}

export function createRandom(seed: number): Rng {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    pick: (items) => (items.length === 0 ? undefined : items[Math.floor(next() * items.length)]),
    bool: (chance = 0.5) => next() < chance,
    shuffle: (items) => {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const held = out[i] as (typeof out)[number]
        out[i] = out[j] as (typeof out)[number]
        out[j] = held
      }
      return out
    },
  }
}

/** FNV-1a, so a test can say `seedFrom('min-heap/property')` and never need a magic number. */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** The seed every engine spec starts from; per-test strings branch off it. */
export const BASE_SEED = seedFrom('marg-campus-navigator/phase1')

export function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The ordering every reference model in this project uses for ids: code points, not ICU. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The reference sort. Explicit and boring on purpose: `-Infinity`/`+Infinity` and `NaN` behave
 * differently under `a - b` than under `<`/`>`, and a property test that disagrees with
 * `Array.sort` for that reason is testing the wrong thing.
 */
export function sortedByReference<T>(values: readonly T[], compare: (a: T, b: T) => number): T[] {
  return [...values].sort(compare)
}

/** Element counts, keyed by a stable string form. `-0` and `0` stay distinct. */
export function multiset<T>(values: readonly T[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) {
    const key =
      typeof value === 'number'
        ? Object.is(value, -0)
          ? '-0'
          : `n:${String(value)}`
        : `j:${JSON.stringify(value)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export function sameMultiset<T>(a: readonly T[], b: readonly T[]): boolean {
  const left = multiset(a)
  const right = multiset(b)
  if (left.size !== right.size) return false
  for (const [key, count] of left) {
    if (right.get(key) !== count) return false
  }
  return true
}

/*
 * The graph and cache generators below exist for the union-find, LRU and graph specs. They live
 * here rather than in those specs because the *reference* side of each property test is the part
 * that must not drift between files: two specs with two copies of "what a component is" is how
 * an engine bug gets ratified by a test.
 */

export interface GeneratedNode {
  readonly id: string
  readonly x: number
  readonly y: number
}

export interface GeneratedEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly metres: number
  readonly oneWay: boolean
}

export interface GeneratedGraph {
  readonly nodes: readonly GeneratedNode[]
  readonly edges: readonly GeneratedEdge[]
}

export interface RandomGraphOptions {
  /** Extra edges beyond the spanning tree, so cycles exist. Default `nodeCount`. */
  readonly extraEdges?: number
  /** Leave some vertices unconnected. Default false. */
  readonly disconnected?: boolean
  /** Probability an edge is one-way, 0..1. Default 0. */
  readonly oneWayChance?: number
}

/**
 * A random graph that is connected unless asked not to be: a shuffled spanning tree (so there is
 * always at least one path, and the vertex order carries no information), then random extra
 * edges, some of them deliberately self-loops or duplicates.
 */
export function randomGraph(
  nodeCount: number,
  rng: Rng,
  options: RandomGraphOptions = {},
): GeneratedGraph {
  const { extraEdges = nodeCount, disconnected = false, oneWayChance = 0 } = options
  const ids: string[] = []
  for (let i = 0; i < nodeCount; i++) ids.push(`n${i}`)
  const nodes: GeneratedNode[] = ids.map((id, i) => ({
    id,
    x: (i * 37) % 1000,
    y: (i * 91) % 1000,
  }))

  const edges: GeneratedEdge[] = []
  let serial = 0
  const shuffled = rng.shuffle(ids)
  const treeStart = disconnected && shuffled.length > 1 ? 1 + rng.int(shuffled.length - 1) : 1
  for (let i = treeStart; i < shuffled.length; i++) {
    const from = shuffled[i] as string
    const to = shuffled[rng.int(i)] as string
    edges.push({
      id: `e${serial++}`,
      from,
      to,
      metres: 1 + rng.int(200),
      oneWay: rng.bool(oneWayChance),
    })
  }
  for (let i = 0; i < extraEdges; i++) {
    edges.push({
      id: `e${serial++}`,
      from: rng.pick(ids) as string,
      to: rng.pick(ids) as string,
      metres: 1 + rng.int(200),
      oneWay: rng.bool(oneWayChance),
    })
  }
  return { nodes, edges }
}

/**
 * Weak connected components by breadth-first search, ignoring blocked edges and self-loops.
 * O(V²·E) and unapologetically so: it is the definition of the answer, not a competitor.
 */
export function weakComponentsReference(
  nodes: readonly { readonly id: string }[],
  edges: readonly { readonly id: string; readonly from: string; readonly to: string }[],
  blocked: ReadonlySet<string> = new Set<string>(),
): string[][] {
  const usable = edges.filter((edge) => !blocked.has(edge.id) && edge.from !== edge.to)
  const known = new Set(nodes.map((node) => node.id))
  const neighbours = new Map<string, Set<string>>()
  for (const node of nodes) neighbours.set(node.id, new Set())
  for (const edge of usable) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue
    ;(neighbours.get(edge.from) as Set<string>).add(edge.to)
    ;(neighbours.get(edge.to) as Set<string>).add(edge.from)
  }

  const seen = new Set<string>()
  const groups: string[][] = []
  for (const node of nodes) {
    if (seen.has(node.id)) continue
    const group: string[] = []
    const queue: string[] = [node.id]
    seen.add(node.id)
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head] as string
      group.push(current)
      for (const next of neighbours.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    groups.push(group.sort(compareStrings))
  }
  return groups.sort((a, b) => compareStrings(a[0] ?? '', b[0] ?? ''))
}

/**
 * The array-based model of an LRU cache: recency is maintained by splice + push, which is O(n)
 * per touch and exactly as correct. If the real cache and this ever disagree, one of them is
 * wrong, and it is not going to be the one that does not need a linked list to work.
 */
export class LruModel {
  #entries: { key: string; value: unknown }[] = []
  hits = 0
  misses = 0
  evictions = 0

  readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
  }

  #indexOf(key: string): number {
    return this.#entries.findIndex((entry) => entry.key === key)
  }

  get(key: string): unknown {
    const index = this.#indexOf(key)
    if (index < 0) {
      this.misses++
      return undefined
    }
    this.hits++
    const [entry] = this.#entries.splice(index, 1)
    if (entry !== undefined) this.#entries.push(entry)
    return entry?.value
  }

  peek(key: string): unknown {
    return this.#entries.find((entry) => entry.key === key)?.value
  }

  put(key: string, value: unknown): string | undefined {
    if (this.capacity <= 0) return undefined
    let evicted: string | undefined
    const index = this.#indexOf(key)
    if (index >= 0) {
      this.#entries.splice(index, 1)
      this.#entries.push({ key, value })
      return undefined
    }
    while (this.#entries.length >= this.capacity) {
      const victim = this.#entries.shift()
      if (victim !== undefined) {
        evicted = victim.key
        this.evictions++
      }
    }
    this.#entries.push({ key, value })
    return evicted
  }

  delete(key: string): boolean {
    const index = this.#indexOf(key)
    if (index < 0) return false
    this.#entries.splice(index, 1)
    return true
  }

  keys(): string[] {
    return this.#entries.map((entry) => entry.key)
  }

  get size(): number {
    return this.#entries.length
  }
}

// --- Phase 3: oracles for the searches ---------------------------------------------------------------
//
// Every function below answers a question by definition rather than by cleverness. Bellman-Ford relaxes
// every arc |V| − 1 times; Floyd–Warshall tries every vertex as an intermediate for every pair; the hop
// count is a BFS with no priority at all. None of them reconstructs *which* path it found, because a path is
// not unique when costs tie — the claims that can be pinned are the number, the reachability, and the fact
// that the engine's own path costs that number.

import { DEFAULT_EDGE_ATTRIBUTES } from '../constants'
import { describe, expect, it } from 'vitest'
import type { RouteSearchOptions } from '../algorithms/search-common'
import type { AdjacencyEntry, EdgeCost, EdgeId, Graph, GraphEdge, GraphIndex, NodeId, RouteResult } from '../types'
import { AdjacencyGraph } from '../structures/graph'
import type { EdgeAttributes } from '../types'

/** An arc with its weight already resolved: undirected edges appear twice, one-way edges once. */
export interface Arc {
  readonly from: string
  readonly to: string
  readonly weight: number
}

export interface OracleOptions {
  /** How much an edge costs. Defaults to its metres; pass `() => 1` to ask for hop counts instead. */
  readonly weight?: (edge: GeneratedEdge) => number
  /** Edge ids closed for this query, matched against the same ids the engine was given. */
  readonly blockedEdges?: ReadonlySet<string>
}

export function arcsOf(graph: GeneratedGraph, options: OracleOptions = {}): Arc[] {
  const weight = options.weight ?? ((edge: GeneratedEdge) => edge.metres)
  const blocked = options.blockedEdges
  const arcs: Arc[] = []
  for (const edge of graph.edges) {
    if (blocked?.has(edge.id) === true) continue
    const w = weight(edge)
    arcs.push({ from: edge.from, to: edge.to, weight: w })
    if (!edge.oneWay) arcs.push({ from: edge.to, to: edge.from, weight: w })
  }
  return arcs
}

/**
 * Single-source shortest paths, by relaxation over every arc, |V| − 1 times.
 *
 * O(V·E) and slow on purpose. The early exit when a pass changes nothing is the one optimisation kept, since
 * it cannot change an answer — and a reference that is *also* naive about its running time would make the
 * "Dijkstra is faster" claim in the benchmark impossible to interpret.
 */
export function bellmanFord(from: string, graph: GeneratedGraph, options: OracleOptions = {}): Map<string, number> {
  const distance = new Map<string, number>()
  for (const node of graph.nodes) distance.set(node.id, node.id === from ? 0 : Number.POSITIVE_INFINITY)
  const arcs = arcsOf(graph, options)
  for (let pass = 0; pass < graph.nodes.length - 1; pass++) {
    let changed = false
    for (const arc of arcs) {
      const here = distance.get(arc.from) ?? Number.POSITIVE_INFINITY
      const there = distance.get(arc.to) ?? Number.POSITIVE_INFINITY
      if (here + arc.weight < there) {
        distance.set(arc.to, here + arc.weight)
        changed = true
      }
    }
    if (!changed) break
  }
  return distance
}

/**
 * All-pairs shortest paths, by the three-loop Floyd–Warshall.
 *
 * Answers the question a single-source oracle cannot: that a pair with no route is reported as
 * `Infinity` by both, and that the matrix is symmetric for an undirected graph. O(V³) — which at the sizes
 * these specs use (a dozen vertices) is a fraction of a millisecond and a second independent opinion.
 */
export function floydWarshall(graph: GeneratedGraph, options: OracleOptions = {}): (from: string, to: string) => number {
  const ids = graph.nodes.map((node) => node.id)
  const distance = new Map<string, number>()
  const at = (from: string, to: string): number => distance.get(`${from}\u0000${to}`) ?? Number.POSITIVE_INFINITY
  const put = (from: string, to: string, value: number): void => {
    distance.set(`${from}\u0000${to}`, value)
  }
  for (const from of ids) {
    for (const to of ids) put(from, to, from === to ? 0 : Number.POSITIVE_INFINITY)
  }
  for (const arc of arcsOf(graph, options)) {
    put(arc.from, arc.to, Math.min(at(arc.from, arc.to), arc.weight))
  }
  for (const via of ids) {
    for (const from of ids) {
      for (const to of ids) {
        const through = at(from, via) + at(via, to)
        if (through < at(from, to)) put(from, to, through)
      }
    }
  }
  return at
}

/** Minimum number of *edges* from `from` to every reachable vertex, by an unweighted BFS. */
export function minimumHopCounts(from: string, graph: GeneratedGraph, options: OracleOptions = {}): Map<string, number> {
  const hops = new Map<string, number>([[from, 0]])
  const arcs = arcsOf(graph, options)
  let frontier = [from]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const current of frontier) {
      for (const arc of arcs) {
        if (arc.from !== current || hops.has(arc.to)) continue
        hops.set(arc.to, (hops.get(current) ?? 0) + 1)
        next.push(arc.to)
      }
    }
    frontier = next
  }
  return hops
}

/**
 * A sealed `AdjacencyGraph` over a generated graph, with every attribute defaulted.
 *
 * The searches are written against `GraphIndex`, so the oracles above and the engine below must be handed the
 * *same* edges: this is the one place a `GeneratedGraph` becomes a graph, which is what makes "the reference
 * and the implementation disagree" evidence rather than a difference in fixture setup.
 */
export function indexOfGraph(
  graph: GeneratedGraph,
  attributes: Partial<EdgeAttributes> = {},
): AdjacencyGraph {
  const builder = new AdjacencyGraph()
  for (const node of graph.nodes) builder.addNode({ id: node.id, x: node.x, y: node.y })
  for (const edge of graph.edges) {
    // Self-loops and duplicate edges are in the generator's output on purpose. `addEdge` refuses the first and
    // allows the second, and a search that is only correct on a simple graph is not correct.
    if (edge.from === edge.to) continue
    builder.addEdge({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      metres: edge.metres,
      oneWay: edge.oneWay,
      attributes: { ...DEFAULT_EDGE_ATTRIBUTES, ...attributes },
    })
  }
  return builder.seal()
}

/**
 * The seeded-graph sweep every search spec runs, in one place.
 *
 * Three algorithms claiming "against Bellman-Ford on 200 random graphs" in three files is how one of them
 * quietly ends up testing 40 graphs of a different shape. The variation is fixed here and is *deterministic*:
 * node count, extra edges, one-way chance, disconnection and a fifth of the walkways closed, all as
 * functions of the trial number, so trial 137 is the same graph in every spec and a failure can be
 * reproduced by writing the number down.
 */
export interface SweepCase {
  readonly trial: number
  readonly generated: GeneratedGraph
  readonly index: AdjacencyGraph
  /** The closure set for this trial — empty on even trials, a fifth of the edges on odd ones. */
  readonly blocked: ReadonlySet<string>
  /** Four sources, stepped through the vertex list rather than drawn at random. */
  readonly sources: readonly string[]
}

export function sweepGraphs(count: number, seedTag: string, visit: (trialCase: SweepCase) => void): void {
  const rng = createRandom(seedFrom(`${BASE_SEED}/${seedTag}`))
  for (let trial = 0; trial < count; trial++) {
    const generated = randomGraph(4 + (trial % 25), rng, {
      extraEdges: 2 + (trial % 12),
      oneWayChance: trial % 4 === 0 ? 0.35 : 0,
      disconnected: trial % 7 === 0,
    })
    const blocked = new Set<string>()
    if (trial % 2 === 1) {
      const blocker = createRandom(seedFrom(`${seedTag}/blocked/${String(trial)}`))
      for (const edge of generated.edges) if (blocker.bool(0.2)) blocked.add(edge.id)
    }
    const sources = [0, 7, 13, 21].map(
      (offset) => generated.nodes[(trial * 3 + offset) % generated.nodes.length]?.id as string,
    )
    visit({ trial, generated, index: indexOfGraph(generated), blocked, sources })
  }
}

/** Sampled targets, so a sweep says "every shape" rather than "every pair of every shape". */
export function targetsOf(generated: GeneratedGraph, limit = 6): readonly string[] {
  const step = Math.max(1, Math.floor(generated.nodes.length / limit))
  return generated.nodes.filter((_, i) => i % step === 0).map((node) => node.id)
}

const LADDER_ATTRIBUTES: EdgeAttributes = DEFAULT_EDGE_ATTRIBUTES
export const LADDER_COST: EdgeCost = (edge) => edge.metres

/**
 * The fixtures the ladder and the algorithm specs share.
 *
 * A walkway is **one edge id**, and `AdjacencyGraph` gives a two-way one two arcs by itself — so these
 * fixtures pass `oneWay: true` when direction matters and nothing else when it does not. That is worth
 * stating, because a fixture that models the two directions of a path as two edges makes `blockedEdges`
 * look broken (it closes both, and a fixture with two ids closes one) and makes the bridge test below
 * measure the wrong thing. Every one of these graphs is 100 m per side at unit cost unless labelled.
 */
export interface LadderSpec {
  readonly nodes: readonly { id: string; x: number; y: number }[]
  readonly edges: readonly { id: string; from: string; to: string; metres: number; oneWay?: boolean }[]
}

export function ladderGraph(spec: LadderSpec): GraphIndex {
  const builder = new AdjacencyGraph()
  for (const node of spec.nodes) builder.addNode({ id: node.id, x: node.x, y: node.y })
  for (const edge of spec.edges) {
    builder.addEdge({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      metres: edge.metres,
      oneWay: edge.oneWay ?? false,
      attributes: LADDER_ATTRIBUTES,
    })
  }
  return builder.seal()
}

/** `a—b—c—d…` in a line, 100 m apart, every walkway two-way. */
export const ladderLine = (count: number): GraphIndex => {
  const letters = ['a', 'b', 'c', 'd', 'e'].slice(0, count)
  return ladderGraph({
    nodes: letters.map((id, i) => ({ id, x: i * 100, y: 0 })),
    edges: letters
      .slice(0, -1)
      .map((id, i) => ({ id: `${id}-${letters[i + 1]}`, from: id, to: letters[i + 1] as string, metres: 100 })),
  })
}

/** The square with the expensive diagonal, so a greedy search and a cheap one disagree. */
export const ladderCrossing = (): GraphIndex =>
  ladderGraph({
    nodes: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 100, y: 0 },
      { id: 'c', x: 100, y: -100 },
      { id: 'd', x: 0, y: -100 },
    ],
    edges: [
      { id: 'a-b', from: 'a', to: 'b', metres: 100 },
      { id: 'a-d', from: 'a', to: 'd', metres: 100 },
      { id: 'b-c', from: 'b', to: 'c', metres: 100 },
      { id: 'd-c', from: 'd', to: 'c', metres: 100 },
      { id: 'a-c', from: 'a', to: 'c', metres: 250 },
    ],
  })

/** `a—b—c`, and a `d` nothing reaches. */
export const ladderIslands = (): GraphIndex =>
  ladderGraph({
    nodes: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 100, y: 0 },
      { id: 'c', x: 200, y: 0 },
      { id: 'd', x: 900, y: 0 },
    ],
    edges: [
      { id: 'a-b', from: 'a', to: 'b', metres: 100 },
      { id: 'b-c', from: 'b', to: 'c', metres: 100 },
    ],
  })

/**
 * `a→b→c` one-way, and `c—a` two-way.
 *
 * The point of the shape: from `c` the only way to `b` is the long way round through `a`, and a search that
 * reads an edge as "connects" rather than "leads to" answers in one hop. It is also the graph where `dfs`
 * looks best — the only *valid* answer from `b` to `a` walks out and around.
 */
export const ladderOneWay = (): GraphIndex =>
  ladderGraph({
    nodes: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 100, y: 0 },
      { id: 'c', x: 200, y: 0 },
    ],
    edges: [
      { id: 'a-b', from: 'a', to: 'b', metres: 100, oneWay: true },
      { id: 'b-c', from: 'b', to: 'c', metres: 100, oneWay: true },
      { id: 'a-c', from: 'a', to: 'c', metres: 100 },
    ],
  })

/** Two parallel walkways between `a` and `b` — a ramp and a stair — and nothing else. */
export const ladderParallel = (): GraphIndex =>
  ladderGraph({
    nodes: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 100, y: 0 },
    ],
    edges: [
      { id: 'a-b-ramp', from: 'a', to: 'b', metres: 120 },
      { id: 'a-b-stairs', from: 'a', to: 'b', metres: 90 },
    ],
  })

/** `a—b—c—d` with `e` hanging off `c`, and `f`—`g` as a second component: one bridge, one cut vertex. */
export const ladderBarbell = (): GraphIndex =>
  ladderGraph({
    nodes: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 100, y: 0 },
      { id: 'c', x: 200, y: 0 },
      { id: 'd', x: 300, y: 0 },
      { id: 'e', x: 200, y: -100 },
    ],
    edges: [
      { id: 'a-b', from: 'a', to: 'b', metres: 100 },
      { id: 'b-c', from: 'b', to: 'c', metres: 100 },
      { id: 'c-d', from: 'c', to: 'd', metres: 100 },
      { id: 'c-e', from: 'c', to: 'e', metres: 100 },
      // …and `e` back to `a`, so `b`—`c` is the only way out of `d`.
      { id: 'e-a', from: 'e', to: 'a', metres: 224 },
    ],
  })

/**
 * An index that disagrees with itself: the adjacency and `hasNode` know a vertex the snapshot cannot place, and
 * name an edge the snapshot has lost.
 *
 * `search-common.spec.ts` has a smaller version for `expand`. This one exists because *three* modules promise
 * the same behaviour — a search that meets an unusable record skips it rather than inventing a coordinate or a
 * length — and the promise is only worth anything if it is tested on the module that makes it. The shape is not
 * hypothetical: Phase 7's map editor builds indexes by hand while a plan is half-drawn, and "the editor crashed
 * because a node had no position" is the failure this file is the licence to survive.
 */
export function unravelledIndex(): GraphIndex {
  const ghostEdge: GraphEdge = {
    id: 'b-gone',
    from: 'b',
    to: 'gone',
    metres: 40,
    oneWay: false,
    attributes: DEFAULT_EDGE_ATTRIBUTES,
  }
  const realEdge: GraphEdge = {
    id: 'a-b',
    from: 'a',
    to: 'b',
    metres: 100,
    oneWay: false,
    attributes: DEFAULT_EDGE_ATTRIBUTES,
  }
  const graph: Graph = {
    // `a` is deliberately absent from `nodes`: the graph knows the id and cannot place it.
    nodes: [{ id: 'b', label: 'B', kind: 'junction', x: 100, y: 0 }],
    edges: [realEdge, ghostEdge],
  }
  const neighbours = new Map<string, AdjacencyEntry[]>([
    ['a', [{ to: 'b', edgeId: 'a-b' }]],
    ['b', [{ to: 'a', edgeId: 'a-b' }, { to: 'gone', edgeId: 'no-such-edge' }]],
  ])
  const incident = new Map<string, EdgeId[]>([
    ['a', ['a-b', 'no-such-edge']],
    ['b', ['a-b', 'b-gone']],
  ])
  return {
    graph,
    size: 2,
    arcCount: 3,
    hasNode: (id) => id === 'a' || id === 'b',
    node: (id) => graph.nodes.find((node) => node.id === id),
    edge: (id) => graph.edges.find((edge) => edge.id === id),
    neighboursOf: (id) => neighbours.get(id) ?? [],
    edgesAt: (id) => incident.get(id) ?? [],
    componentOf: () => 0,
  }
}

export type RouteSearchFn = (
  graph: GraphIndex,
  from: NodeId,
  to: NodeId,
  options?: RouteSearchOptions,
) => RouteResult

/**
 * The same broken inputs, fed to every algorithm, with one list of expectations.
 *
 * A `RouteResult` union is only worth having if a screen can branch on `result.reason` without knowing which
 * search produced it, so "the same broken input refuses the same way" is a contract *between* algorithms and
 * belongs in one list rather than in four files where one can drift. `dijkstra.spec.ts` pins these cases again
 * on its own fixtures — deliberately, because the ladder is shared support code and support code that is never
 * cross-checked is exactly how a shared helper starts agreeing with itself.
 *
 * There is no `toThrow` anywhere in this project: "never throws" is proven by the fact that every one of these
 * broken inputs comes back as a `RouteNotFound` a card can render, on all four searches.
 */
export function refusalLadder(label: string, search: RouteSearchFn): void {
  describe(`${label}, the refusals every search shares`, () => {
  it('refuses a place the map does not know, with nothing measured', () => {
    const graph = ladderLine(4)
    const cases: readonly { reason: NodeId; from: NodeId; to: NodeId; offender: NodeId }[] = [
      { reason: 'unknown-destination', from: 'a', to: 'nope', offender: 'nope' },
      { reason: 'unknown-origin', from: 'nowhere', to: 'a', offender: 'nowhere' },
      // Asking about two unknowns reports the origin: it is the one a person can fix without scrolling, and
      // the order of these three checks is the contract `checkEndpoints` exists to hold in one place.
      { reason: 'unknown-origin', from: 'nope', to: 'also-nope', offender: 'nope' },
    ]
    for (const testCase of cases) {
      // `now` is injected so that "a refusal measured nothing" is a checked fact rather than a stopwatch race:
      // the default clock is `Date.now`, which can tick between the two calls and report a millisecond for a
      // search that never ran. The seam exists for Phase 4's benchmark and this is its second use.
      const result = search(graph, testCase.from, testCase.to, { cost: LADDER_COST, now: () => 1_000 })
      expect(result.ok, `${testCase.from} to ${testCase.to}`).toBe(false)
      if (result.ok) continue
      expect(result.reason).toBe(testCase.reason)
      expect(result.message).toBe(`"${testCase.offender}" is not a node on this map`)
      // A refusal that never searched says so in every metric rather than leaving them undefined.
      expect(result.algorithm).toBe(label)
      expect(result.profile).toBe('shortest')
      expect(result.expanded).toBe(0)
      expect(result.ms).toBe(0)
      expect(result.cached).toBe(false)
      expect(result.exploredOrder).toEqual([])
      expect(result.frontierSnapshots).toEqual([])
    }
  })

  it('refuses an empty map before it looks for a node', () => {
    const result = search(new AdjacencyGraph().seal(), 'a', 'b', { cost: LADDER_COST })
    expect(result.ok).toBe(false)
    if (result.ok) return expect('a refusal').toBe('no route')
    expect(result.reason).toBe('empty-graph')
    expect(result.message).toBe('this map has no vertices, so there is nowhere to route between')
  })

  it('refuses two components before searching, because the partition already knows', () => {
    const result = search(ladderIslands(), 'a', 'd', { cost: LADDER_COST })
    expect(result.ok).toBe(false)
    if (result.ok) return expect('a refusal').toBe('no route')
    expect(result.reason).toBe('disconnected')
    expect(result.message).toContain('no walkway connects them')
    expect(result.expanded).toBe(0)
  })

  it('refuses a destination stranded by closures, and counts them', () => {
    // A line, with its middle walkway shut: there is no way round, and no cheap diagonal to blame either.
    const result = search(ladderLine(3), 'a', 'c', { cost: LADDER_COST, blockedEdges: new Set(['b-c']) })
    expect(result.ok).toBe(false)
    if (result.ok) return expect('a refusal').toBe('no route')
    expect(result.reason).toBe('disconnected')
    expect(result.message).toContain('1 walkway(s) are closed for this query')
    // `b` is the far end of what the search could reach. Which order they were settled in is the algorithm's
    // business; that both were, and that `c` never was, is the contract.
    expect([...result.exploredOrder].sort()).toEqual(['a', 'b'])
  })

  it('refuses a cost the arithmetic cannot use, naming the walkway and the value', () => {
    for (const bad of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY, undefined, '100'] as never[]) {
      const result = search(ladderCrossing(), 'a', 'c', { cost: () => bad as number })
      expect(result.ok, `${String(bad)} as a cost`).toBe(false)
      if (result.ok) continue
      expect(result.reason, `${String(bad)} as a cost`).toBe('invalid-graph')
      expect(result.message).toContain('finite number greater than 0')
      expect(result.message).toContain('walkway "a-b"')
    }
  })

  it('treats an infinite cost as a closed walkway and not as a broken one', () => {
    // `Infinity` is how a profile legitimately says *no* — under the step-free profile a stair costs
    // Infinity — so it must produce "no route", never "invalid graph". Every edge closed at once is the
    // harshest version: the origin is settled and there is nowhere to go from it.
    const result = search(ladderCrossing(), 'a', 'c', { cost: () => Number.POSITIVE_INFINITY })
    expect(result.ok).toBe(false)
    if (result.ok) return expect('a refusal').toBe('no route')
    expect(result.reason).toBe('disconnected')
    expect(result.exploredOrder).toEqual(['a'])
  })

  it('routes a walker to the place they are already standing on', () => {
    const result = search(ladderLine(3), 'a', 'a', { cost: LADDER_COST })
    expect(result.ok).toBe(true)
    if (!result.ok) return expect('a route').toBe(result.reason)
    expect(result.nodeIds).toEqual(['a'])
    expect(result.edgeIds).toEqual([])
    expect(result.cost).toBe(0)
    expect(result.metres).toBe(0)
    expect(result.hops).toBe(0)
    expect(result.minutes).toBe(0)
    expect(result.steps).toHaveLength(1)
    // The vertex still had to be drawn off the frontier to find out, so it counts as one expansion.
    expect(result.expanded).toBe(1)
    expect(result.frontierSnapshots).toEqual([[]])
  })
  })
}
