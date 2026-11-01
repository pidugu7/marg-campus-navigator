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
