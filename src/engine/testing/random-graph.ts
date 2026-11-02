/**
 * Seeded random graphs — the fixture generator the engine's property tests and `npm run bench` share.
 *
 * ### Why this is engine code rather than test scaffolding
 * It used to live in `src/engine/__tests__/helpers.ts`, which was fine while only specs needed it. The benchmark
 * needs it too, and a benchmark measuring a *second* generator is measuring a second thing: the numbers in
 * `docs/ALGORITHMS.md`'s measured results describe the graphs these functions draw, so the spanning-tree shuffle,
 * the `extraEdges` default and the deliberate self-loops must be literally the same code in both places. One
 * generator, imported twice, is the whole reason for this file. `helpers.ts` re-exports everything here, so the
 * specs never moved.
 *
 * `Math.random` is banned under `src/engine/**` by ESLint, so randomness here is a function of a seed: same seed,
 * same graph, on any machine — which is also what makes a benchmark table reproducible from the seed printed
 * above it.
 *
 * ### What is guaranteed, and what is deliberately unhelpful
 * Connected unless `disconnected: true`, because a shuffled spanning tree is laid down first; beyond that the
 * generator keeps self-loops and duplicate edges on purpose, since a search that is only correct on a simple
 * graph is not correct. Coordinates are a linear congruence over the vertex index, not anything spatial, so a
 * Euclidean heuristic on them is meaningless — which is why the A* spec weights them separately instead of
 * trusting this geometry to look like a plan.
 *
 * ### Complexity
 * O(V + E) with E ≈ 2V by default, O(V + extraEdges) as given. {@link indexOfGraph} is a second O(V + E) and is
 * the one place a generated graph becomes the `GraphIndex` searches are written against, so an oracle and the
 * implementation under test are handed the same edges — a disagreement is evidence, not a difference in setup.
 */
import { DEFAULT_EDGE_ATTRIBUTES } from '../constants'
import { AdjacencyGraph } from '../structures/graph'
import type { EdgeAttributes } from '../types'

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
 * A sealed `AdjacencyGraph` over a generated graph, with every attribute defaulted.
 *
 * The searches are written against `GraphIndex`, and the oracles in `../__tests__/helpers.ts` must be handed the
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
 * FNV-1a over a string, so a caller can write `seedFrom('min-heap/property')` and never need a magic number.
 *
 * It lives beside the generator rather than in the test helpers because both need it: a spec's seed and a
 * benchmark's seed have to mean the same thing, and a hash function duplicated across the two is a graph nobody
 * can re-draw. `>>> 0` at the end keeps the result a uint32, which is what `createRandom` asks for.
 */
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
