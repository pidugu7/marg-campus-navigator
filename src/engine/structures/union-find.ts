/**
 * Disjoint-set forest with path compression and union by rank.
 *
 * ### Why this exists here
 * Two jobs, both about *reachability* rather than distance.
 *
 * 1. **Build time.** Before any search runs, `src/data/build-graph.ts` will know whether two
 *    places are in the same region at all. That separates "no route exists" from "no route was
 *    found", which is the difference between a data error and a bug, and it costs O(α(n)) instead
 *    of a search that runs to exhaustion on every query.
 * 2. **Resilience.** "Which places are stranded if this walkway closes?" is a rebuild over the
 *    surviving edges — see {@link buildComponents} — with no second algorithm and no copy of the
 *    graph.
 *
 * ### Invariants
 * - `#parent` is a forest: every element either points at another element or is a root
 *   (`parent[x] === x`), and `find` returns the root.
 * - rank is an upper bound on tree height: `rank[root] === ceil(log2 |component|)` in the worst
 *   case, and `depthOf`/`maxDepth` measure it without compressing, so the bound is checkable
 *   rather than asserted.
 * - `#size` is exact per root, so `sizeOf` is O(1) after a find.
 * - Union ties are broken by element order (`a < b`), never by Map iteration order, so two runs
 *   over the same data produce the same forest. That determinism is what makes a property test
 *   over random graphs meaningful.
 *
 * ### Complexity
 * O(α(n)) amortised per `find`/`union` (α = inverse Ackermann, ≤ 4 for any n a campus reaches);
 * O(n log n) worst case before compression has run; O(n) space for three maps.
 *
 * ### `connected` and `find` disagree about unknowns, on purpose
 * `find(unknown)` throws: a caller asking for a component cannot be answered, and inventing a
 * singleton would quietly report "not connected" as if it were a fact. `connected(a, b)` returns
 * `false`: a probe is not an error, and a UI asking "are these two connected?" wants an answer.
 */

import type { EdgeId, Graph, GraphEdge, NodeId } from '../types'

export interface UnionFindStats {
  readonly elements: number
  readonly components: number
  readonly finds: number
  readonly unions: number
  /** How many times a node was re-parented — i.e. how much work compression actually did. */
  readonly compressions: number
}

export interface BuildComponentsOptions {
  /** Edge ids to treat as closed. Read by reference, never copied (see below). */
  readonly blockedEdges?: ReadonlySet<EdgeId>
  /** Extra exclusion, e.g. edges a cost profile refuses to traverse. */
  readonly skip?: (edge: GraphEdge) => boolean
}

/** The result of one component pass. Every array is in `graph.nodes` order. */
export interface GraphComponents {
  readonly count: number
  /** Component index for a node, or -1 when the node is not in the graph. */
  componentOf(id: NodeId): number
  members(index: number): readonly NodeId[]
  /** Nodes with no *usable* edge. A self-loop is incident but gets you nowhere, so it does not count. */
  readonly isolated: readonly NodeId[]
  /** Edges that could not be used: closed, skipped, dangling or a self-loop. */
  readonly ignoredEdges: readonly EdgeId[]
  readonly unionFind: UnionFind<NodeId>
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export class UnionFind<TElement extends string> {
  readonly #parent = new Map<TElement, TElement>()
  readonly #rank = new Map<TElement, number>()
  readonly #size = new Map<TElement, number>()
  #compressions = 0
  #finds = 0
  #unions = 0

  constructor(elements: Iterable<TElement> = []) {
    for (const element of elements) this.add(element)
  }

  /** Register an element as its own component. False when it was already present. */
  add(element: TElement): boolean {
    if (this.#parent.has(element)) return false
    this.#parent.set(element, element)
    this.#rank.set(element, 0)
    this.#size.set(element, 1)
    return true
  }

  has(element: TElement): boolean {
    return this.#parent.has(element)
  }

  get elementCount(): number {
    return this.#parent.size
  }

  get componentCount(): number {
    let roots = 0
    for (const [element, parent] of this.#parent) if (element === parent) roots++
    return roots
  }

  /**
   * Root of `element`'s tree, compressing the path on the way back out.
   * @throws RangeError for an unregistered element — see the class header for why.
   */
  find(element: TElement): TElement {
    this.#finds++
    const root = this.#rootOf(element)
    // Second pass: re-parent everything on the path. Compression is done iteratively rather than
    // recursively because a chain of 5 000 nodes would otherwise be a 5 000-frame stack.
    let walker: TElement = element
    for (;;) {
      const parent = this.#parent.get(walker) as TElement
      if (parent === root) break
      this.#parent.set(walker, root)
      // Counted only when the pointer really moved, so `stats().compressions` measures the work
      // done and not the number of find() calls.
      this.#compressions++
      walker = parent
    }
    return root
  }

  /**
   * Merge two components. Returns the surviving root, so a caller that keeps a per-root table can
   * update it without a second find.
   */
  union(a: TElement, b: TElement): TElement {
    this.#unions++
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA === rootB) return rootA
    const rankA = this.#rank.get(rootA) as number
    const rankB = this.#rank.get(rootB) as number
    // Equal ranks: the lower element wins, which is what makes the forest reproducible.
    const winner = rankA > rankB ? rootA : rankB > rankA ? rootB : compareStrings(rootA, rootB) < 0 ? rootA : rootB
    const loser = winner === rootA ? rootB : rootA
    this.#parent.set(loser, winner)
    const sizeWinner = (this.#size.get(winner) as number) + (this.#size.get(loser) as number)
    this.#size.set(winner, sizeWinner)
    this.#size.delete(loser)
    if (rankA === rankB) this.#rank.set(winner, rankA + 1)
    return winner
  }

  connected(a: TElement, b: TElement): boolean {
    if (!this.has(a) || !this.has(b)) return false
    return this.find(a) === this.find(b)
  }

  /** Members of `element`'s component, in sorted order. Empty for an unknown element. */
  members(element: TElement): TElement[] {
    if (!this.has(element)) return []
    const root = this.find(element)
    const out: TElement[] = []
    for (const candidate of this.#parent.keys()) {
      if (this.find(candidate) === root) out.push(candidate)
    }
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }

  sizeOf(element: TElement): number {
    if (!this.has(element)) return 0
    return this.#size.get(this.find(element)) as number
  }

  /** Every component, ordered by its smallest element so the array itself is deterministic. */
  components(): TElement[][] {
    const groups = new Map<TElement, TElement[]>()
    for (const element of this.#parent.keys()) {
      const root = this.find(element)
      const group = groups.get(root)
      if (group === undefined) groups.set(root, [element])
      else group.push(element)
    }
    return [...groups.values()]
      .map((group) => group.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
      .sort((a, b) => compareStrings(String(a[0] ?? ''), String(b[0] ?? '')))
  }

  elements(): TElement[] {
    return [...this.#parent.keys()]
  }

  get stats(): UnionFindStats {
    return {
      elements: this.#parent.size,
      components: this.componentCount,
      finds: this.#finds,
      unions: this.#unions,
      compressions: this.#compressions,
    }
  }

  resetStats(): void {
    this.#compressions = 0
    this.#finds = 0
    this.#unions = 0
  }

  /**
   * Distance from `element` up to its root, measured by walking **without** compressing. This is
   * the only way the "union by rank keeps trees shallow" claim can be tested at all, so it is
   * public. A version of this method that started its walk at the root returned 0 for every node —
   * and still passed a `maxDepth <= log2 n` test, because 0 <= 13. See the spec's exact-depth case.
   * @throws RangeError for an unregistered element.
   */
  depthOf(element: TElement): number {
    if (!this.has(element)) throw new RangeError(`UnionFind.depthOf: "${String(element)}" is not registered`)
    let current = element
    let depth = 0
    for (;;) {
      const parent = this.#parent.get(current) as TElement
      if (parent === current) return depth
      depth++
      current = parent
    }
  }

  /** The deepest leaf anywhere in the forest. */
  maxDepth(): number {
    let deepest = 0
    for (const element of this.#parent.keys()) {
      const depth = this.depthOf(element)
      if (depth > deepest) deepest = depth
    }
    return deepest
  }

  #rootOf(element: TElement): TElement {
    const parent = this.#parent.get(element)
    if (parent === undefined) {
      throw new RangeError(`UnionFind: "${String(element)}" is not a registered element`)
    }
    let current = element
    while (true) {
      const next = this.#parent.get(current) as TElement
      if (next === current) return current
      current = next
    }
  }
}

/**
 * Components of a `Graph`, as one pass of union-find.
 *
 * **Connectivity here is weak**: a one-way walkway still joins its endpoints. That is the right
 * question for "could these two places ever be in the same region, given the closures we are
 * considering"; whether you can actually *get* from A to B along one-way edges is reachability,
 * which is BFS's job in Phase 3. The name says weak in the docs rather than the type because
 * `GraphIndex.componentOf` has the same rule, and one word for both is worth more than two
 * accurate names for the same idea.
 *
 * `blockedEdges` is read, never copied, so a resilience sweep that closes one more walkway and
 * rebuilds costs one Set mutation plus O(E) — no graph cloning anywhere near it.
 */
export function buildComponents(graph: Graph, options: BuildComponentsOptions = {}): GraphComponents {
  const { blockedEdges, skip } = options
  const ids = graph.nodes.map((node) => node.id)
  const known = new Set<NodeId>(ids)
  const sets = new UnionFind<NodeId>(ids)
  const ignored: EdgeId[] = []
  // Degrees count only edges that can actually move a person, which is why a self-loop is ignored
  // rather than merely skipped for union purposes.
  const usableIncidence = new Map<NodeId, number>()

  for (const edge of graph.edges) {
    const closed = blockedEdges?.has(edge.id) ?? false
    const refused = skip?.(edge) ?? false
    if (closed || refused) {
      ignored.push(edge.id)
      continue
    }
    if (!known.has(edge.from) || !known.has(edge.to)) {
      ignored.push(edge.id)
      continue
    }
    if (edge.from === edge.to) {
      ignored.push(edge.id)
      continue
    }
    sets.union(edge.from, edge.to)
    usableIncidence.set(edge.from, (usableIncidence.get(edge.from) ?? 0) + 1)
    usableIncidence.set(edge.to, (usableIncidence.get(edge.to) ?? 0) + 1)
  }

  const groups = sets.components()
  const indexOfRoot = new Map<NodeId, number>()
  groups.forEach((group, index) => {
    const head = group[0]
    if (head !== undefined) indexOfRoot.set(head, index)
  })

  const isolated = ids.filter((id) => (usableIncidence.get(id) ?? 0) === 0)
  return {
    count: groups.length,
    componentOf: (id: NodeId): number => {
      if (!known.has(id)) return -1
      const root = sets.find(id)
      return indexOfRoot.get(root) ?? -1
    },
    members: (index: number): readonly NodeId[] => groups[index] ?? [],
    isolated,
    ignoredEdges: ignored,
    unionFind: sets,
  }
}
