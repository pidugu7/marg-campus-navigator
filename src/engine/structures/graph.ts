/**
 * The adjacency-list graph every algorithm in this engine reads.
 *
 * ### Why this exists here
 * `Graph` in `types.ts` is two arrays, which is the right shape for a file on disk and the wrong
 * shape for a search: "who is next to this node?" against an edge list costs O(E) per vertex, so
 * Dijkstra becomes O(V·E) and the map stops feeling instant at a few hundred places. This module
 * builds an adjacency list once at load time, after which a neighbour lookup is O(deg) and a
 * component test is O(α). It is also where the *shape* rules live — dangling endpoints, self-loops,
 * duplicate ids — so that the algorithms never have to be defensive, and a bad `campus.json` is
 * reported as a list of issues instead of crashing a search three layers away.
 *
 * ### Two lifecycle states, enforced at runtime
 * **Constructing**: `addNode`/`addEdge`/`removeEdge` are allowed; the traversal reads throw. That
 * is deliberate — reading a half-built graph returns an empty adjacency list, and an empty list is
 * indistinguishable from "unreachable", which is the kind of bug that ships.
 *
 * **Sealed**: `seal()` freezes every node, every edge and every adjacency array, and the mutators
 * throw. Algorithms may therefore hold an adjacency array for their whole run without copying it,
 * and **blocking an edge never clones the graph**: a closure is a `ReadonlySet<EdgeId>` handed to
 * the walk and to the cost function, not a new structure. That single decision is what makes the
 * Phase 6 resilience sweep ("what closes if this walkway floods?") affordable.
 *
 * ### Invariants
 * - Every node and edge id is unique, and every edge's endpoints exist.
 * - An undirected edge stores two arcs (`from→to`, `to→from`); a one-way edge stores exactly one.
 *   `arcCount` is therefore not `2 * edgeCount` on a real campus, and the spec pins both.
 * - `#out.get(id)` exists for every id in `#nodes`, so a leaf yields an empty array rather than
 *   `undefined` — the difference between a `?.` in every loop and none.
 * - Parallel edges are legal (a ramp and a stair between the same two points are two edges), which
 *   is why arcs reference an edge id instead of inlining the cost.
 *
 * ### Complexity
 * Build O(V + E). Neighbour iteration O(deg). `componentOf` O(α) after one O(V + E) precompute.
 * `validate` O(V + E). Memory O(V + E) records, with one frozen object per node and edge shared by
 * every snapshot the UI draws.
 */

import { DEFAULT_EDGE_ATTRIBUTES } from '../constants'
import type {
  AdjacencyEntry,
  Bounds,
  EdgeAttributes,
  EdgeCost,
  EdgeId,
  Graph,
  GraphEdge,
  GraphIndex,
  GraphIssue,
  GraphNode,
  NodeId,
  NodeKind,
  ZoneId,
} from '../types'
import { buildComponents, type BuildComponentsOptions, type GraphComponents } from './union-find'

/** What `addNode` accepts: id and position are required, everything else has a sensible default. */
export interface NodeInput {
  readonly id: NodeId
  readonly x: number
  readonly y: number
  readonly label?: string
  readonly kind?: NodeKind
  readonly zone?: ZoneId
}

export interface EdgeInput {
  readonly id: EdgeId
  readonly from: NodeId
  readonly to: NodeId
  readonly metres: number
  readonly attributes?: Partial<EdgeAttributes>
  readonly oneWay?: boolean
}

export interface CreateGraphOptions {
  /** Canvas bounds used by the `node-outside-canvas` check. */
  readonly bounds?: Bounds
  /** Seal immediately (the default). Pass `false` to keep mutating after construction. */
  readonly seal?: boolean
}

export interface ValidateGraphOptions {
  readonly bounds?: Bounds
  /**
   * The cost function a profile will actually use. Supplied, validation also rejects a cost of
   * zero or below — legal in metres, fatal for Dijkstra.
   */
  readonly cost?: EdgeCost
}

const NO_NEIGHBOURS: readonly AdjacencyEntry[] = Object.freeze([])
const NO_EDGES: readonly EdgeId[] = Object.freeze([])
/** `crowd` is a 0..1 ratio and `slope` a rise/run within ±100%; anything else is a data error. */
const CROWD_MAX = 1
const SLOPE_ABS_MAX = 1

const issue = (
  severity: 'error' | 'warning',
  code: GraphIssue['code'],
  message: string,
  which: { readonly nodeId?: NodeId; readonly edgeId?: EdgeId } = {},
): GraphIssue => {
  // Built up rather than spread, because `exactOptionalPropertyTypes` forbids writing
  // `nodeId: undefined` into a field declared `nodeId?: NodeId`.
  const out: {
    severity: 'error' | 'warning'
    code: GraphIssue['code']
    message: string
    nodeId?: NodeId
    edgeId?: EdgeId
  } = { severity, code, message }
  if (which.nodeId !== undefined) out.nodeId = which.nodeId
  if (which.edgeId !== undefined) out.edgeId = which.edgeId
  return out
}

const compareIssueIds = (a: GraphIssue, b: GraphIssue): number => {
  const left = a.nodeId ?? a.edgeId ?? ''
  const right = b.nodeId ?? b.edgeId ?? ''
  if (left < right) return -1
  if (left > right) return 1
  // Same subject (e.g. two complaints about one node): keep the report stable by comparing text.
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0
}

export class AdjacencyGraph implements GraphIndex {
  readonly #nodes = new Map<NodeId, GraphNode>()
  readonly #edges = new Map<EdgeId, GraphEdge>()
  readonly #out = new Map<NodeId, AdjacencyEntry[]>()
  readonly #incident = new Map<NodeId, EdgeId[]>()
  #sealed = false
  #snapshot: Graph | undefined
  #defaultComponents: GraphComponents | undefined

  get sealed(): boolean {
    return this.#sealed
  }

  /** Vertices. Answers in both lifecycle states: it is a fact about storage, not a traversal. */
  get size(): number {
    return this.#nodes.size
  }

  /** Undirected edges as stored (one entry per id). */
  get edgeCount(): number {
    return this.#edges.size
  }

  /** Directed arcs actually stored: 2 per undirected edge, 1 per one-way edge. */
  get arcCount(): number {
    this.#requireSealed('arcCount')
    let arcs = 0
    for (const list of this.#out.values()) arcs += list.length
    return arcs
  }

  /**
   * @throws TypeError on a duplicate id, a non-finite coordinate or a blank id. Nothing is added
   *   when a node is refused, so a failed load cannot leave a half-built map behind.
   */
  addNode(input: NodeInput): this {
    this.#requireMutable('addNode')
    const { id, x, y } = input
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('addNode requires a non-empty string id')
    }
    if (this.#nodes.has(id)) {
      throw new TypeError(`addNode: node id "${id}" is already in the graph`)
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError(`addNode("${id}"): x and y must be finite numbers, got ${String(x)}, ${String(y)}`)
    }
    const node: GraphNode = {
      id,
      x,
      y,
      label: input.label ?? '',
      kind: input.kind ?? 'junction',
    }
    // `exactOptionalPropertyTypes` means an absent zone is *absent*, not undefined — which is
    // exactly right: the UI checks `'zone' in node` and must not see a key it cannot render.
    const zone = input.zone
    if (zone !== undefined) (node as { zone?: ZoneId }).zone = zone
    this.#nodes.set(id, node)
    this.#out.set(id, [])
    this.#incident.set(id, [])
    return this
  }

  /**
   * @throws TypeError on a duplicate id, an unknown endpoint, a self-loop, or a length that is not
   *   a finite positive number. A one-way edge is stored as one arc; anything else as two.
   */
  addEdge(input: EdgeInput): this {
    this.#requireMutable('addEdge')
    const { id, from, to, metres } = input
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('addEdge requires a non-empty string id')
    }
    if (this.#edges.has(id)) {
      throw new TypeError(`addEdge: edge id "${id}" is already in the graph`)
    }
    if (from === to) {
      throw new TypeError(`addEdge("${id}"): a self-loop has no use in a walkable network`)
    }
    if (!this.#nodes.has(from) || !this.#nodes.has(to)) {
      const missing = this.#nodes.has(from) ? to : from
      throw new TypeError(`addEdge("${id}"): endpoint "${missing}" is not in the graph`)
    }
    if (!(typeof metres === 'number' && Number.isFinite(metres) && metres > 0)) {
      throw new TypeError(`addEdge("${id}"): metres must be a finite number > 0, got ${String(metres)}`)
    }
    const edge: GraphEdge = {
      id,
      from,
      to,
      metres,
      attributes: { ...DEFAULT_EDGE_ATTRIBUTES, ...(input.attributes ?? {}) },
      oneWay: input.oneWay ?? false,
    }
    this.#edges.set(id, edge)
    this.#push(id, from, to)
    if (!edge.oneWay) this.#push(id, to, from)
    // Incidence is symmetric even when travel is not: a one-way exit still *touches* the node it
    // leaves, and the UI highlights edges at a selected place using this list.
    this.#incidentPush(id, from)
    this.#incidentPush(id, to)
    return this
  }

  /**
   * Construction-time only: after `seal()` the graph is immutable during queries, and a closure is
   * expressed as a blocked-edge set instead. Removing an edge here is for a loader that decides an
   * imported walkway does not exist at all.
   */
  removeEdge(id: EdgeId): boolean {
    this.#requireMutable('removeEdge')
    const edge = this.#edges.get(id)
    if (edge === undefined) return false
    this.#edges.delete(id)
    this.#pull(id, edge.from, edge.to)
    if (!edge.oneWay) this.#pull(id, edge.to, edge.from)
    this.#incidentPull(id, edge.from)
    this.#incidentPull(id, edge.to)
    return true
  }

  /** Freeze the snapshot and every adjacency array. Idempotent, and returns the graph. */
  seal(): this {
    if (this.#sealed) return this
    for (const list of this.#out.values()) Object.freeze(list)
    for (const list of this.#incident.values()) Object.freeze(list)
    for (const node of this.#nodes.values()) Object.freeze(node)
    for (const edge of this.#edges.values()) {
      Object.freeze(edge.attributes)
      Object.freeze(edge)
    }
    this.#snapshot = Object.freeze({
      nodes: Object.freeze([...this.#nodes.values()]),
      edges: Object.freeze([...this.#edges.values()]),
    })
    this.#sealed = true
    return this
  }

  /** The one shared frozen snapshot. No copy is made per call, and none can be mutated. */
  get graph(): Graph {
    return this.#sealedGraph()
  }

  hasNode(id: NodeId): boolean {
    return this.#nodes.has(id)
  }

  node(id: NodeId): GraphNode | undefined {
    return this.#nodes.get(id)
  }

  edge(id: EdgeId): GraphEdge | undefined {
    return this.#edges.get(id)
  }

  /** Neighbours in insertion order. Empty for a leaf; throws before `seal()`. */
  neighboursOf(id: NodeId): readonly AdjacencyEntry[] {
    this.#requireSealed('neighboursOf')
    return this.#out.get(id) ?? NO_NEIGHBOURS
  }

  /** Every edge id touching a node, in either direction. */
  edgesAt(id: NodeId): readonly EdgeId[] {
    this.#requireSealed('edgesAt')
    return this.#incident.get(id) ?? NO_EDGES
  }

  /** Number of incident edges (an undirected edge counts once), or -1 for an unknown node. */
  degree(id: NodeId): number {
    this.#requireSealed('degree')
    const list = this.#incident.get(id)
    if (list === undefined) return -1
    return list.length
  }

  /** The edge joining two vertices in either direction; the first stored when there are parallels. */
  edgeBetween(a: NodeId, b: NodeId): GraphEdge | undefined {
    this.#requireSealed('edgeBetween')
    for (const entry of this.#out.get(a) ?? NO_NEIGHBOURS) {
      if (entry.to === b) return this.#edges.get(entry.edgeId)
    }
    return undefined
  }

  /** Weak component index in `graph.nodes` order, or -1 for an unknown node. */
  componentOf(id: NodeId): number {
    this.#requireSealed('componentOf')
    return this.#sealedComponents().componentOf(id)
  }

  /** Components with a closure applied. `blockedEdges` is read by reference, never copied. */
  components(options: BuildComponentsOptions = {}): GraphComponents {
    this.#requireSealed('components')
    if (options.blockedEdges === undefined && options.skip === undefined) {
      const cached = this.#sealedComponents()
      return cached
    }
    return buildComponents(this.#sealedGraph(), options)
  }

  /**
   * A mutable copy for callers that want to derive a variant (the map editor, a test fixture).
   * The arrays are new; the node and edge objects are the shared frozen ones, so a copy can be
   * appended to but nothing in it can be edited in place.
   */
  toGraph(): Graph & { readonly nodes: GraphNode[]; readonly edges: GraphEdge[] } {
    const snapshot = this.#sealedGraph()
    return { nodes: [...snapshot.nodes], edges: [...snapshot.edges] }
  }

  /** Issues for this graph, in the builder's own terms. Works before and after `seal()`. */
  validate(options: ValidateGraphOptions = {}): GraphIssue[] {
    return validateGraph(
      { nodes: [...this.#nodes.values()], edges: [...this.#edges.values()] },
      options,
    )
  }

  // --- internals -------------------------------------------------------------------------------

  #push(id: EdgeId, from: NodeId, to: NodeId): void {
    const out = this.#out.get(from)
    if (out !== undefined) out.push({ to, edgeId: id })
  }

  #pull(id: EdgeId, from: NodeId, to: NodeId): void {
    const out = this.#out.get(from)
    if (out !== undefined) {
      const index = out.findIndex((entry) => entry.edgeId === id && entry.to === to)
      if (index >= 0) out.splice(index, 1)
    }
  }

  #incidentPush(id: EdgeId, at: NodeId): void {
    const incident = this.#incident.get(at)
    if (incident !== undefined && !incident.includes(id)) incident.push(id)
  }

  #incidentPull(id: EdgeId, at: NodeId): void {
    const incident = this.#incident.get(at)
    if (incident === undefined) return
    const index = incident.indexOf(id)
    if (index >= 0) incident.splice(index, 1)
  }

  #requireMutable(operation: string): void {
    if (this.#sealed) {
      throw new TypeError(
        `AdjacencyGraph.${operation}: the graph is sealed and immutable during queries. ` +
          `Express a closure as a blocked-edge set instead of mutating it.`,
      )
    }
  }

  #requireSealed(operation: string): void {
    if (!this.#sealed) {
      throw new TypeError(
        `AdjacencyGraph.${operation}: the graph is still under construction. ` +
          `Reading a half-built graph silently returns empty adjacency, which looks like an ` +
          `unreachable place rather than a bug, so it is refused. Call seal() when loading ends.`,
      )
    }
  }

  #sealedGraph(): Graph {
    const snapshot = this.#snapshot
    if (snapshot === undefined) throw new TypeError('AdjacencyGraph: call seal() before reading the graph')
    return snapshot
  }

  #sealedComponents(): GraphComponents {
    const cached = this.#defaultComponents
    if (cached !== undefined) return cached
    const built = buildComponents(this.#sealedGraph())
    this.#defaultComponents = built
    return built
  }
}

/** Build and validate in one call; the shape `src/data/build-graph.ts` will use. */
export function createGraph(
  nodes: readonly NodeInput[],
  edges: readonly EdgeInput[],
  options: CreateGraphOptions = {},
): AdjacencyGraph {
  const graph = new AdjacencyGraph()
  for (const node of nodes) graph.addNode(node)
  for (const edge of edges) graph.addEdge(edge)
  if (options.seal ?? true) graph.seal()
  return graph
}

/**
 * Every structural claim a map has to satisfy, as data rather than exceptions.
 *
 * This is a pure function over any `Graph` — including one that never went through
 * {@link AdjacencyGraph} — because the map editor exports JSON that has to be checkable before
 * anything is built from it, and because a `campus.json` from a teammate deserves a report, not a
 * stack trace. Issues come back sorted by severity, then code, then id, so two runs on the same
 * file produce a diffable report.
 */
export function validateGraph(graph: Graph, options: ValidateGraphOptions = {}): GraphIssue[] {
  const { bounds, cost } = options
  const issues: GraphIssue[] = []
  const nodeIds = new Set<NodeId>()
  const degree = new Map<NodeId, number>()

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push(issue('error', 'duplicate-node-id', `node id "${node.id}" appears more than once`, { nodeId: node.id }))
      continue
    }
    nodeIds.add(node.id)
    degree.set(node.id, 0)
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      issues.push(
        issue('error', 'non-finite-coordinate', `node "${node.id}" has non-finite coordinates (${String(node.x)}, ${String(node.y)})`, {
          nodeId: node.id,
        }),
      )
    }
    if (bounds !== undefined) {
      const outside =
        node.x < bounds.minX || node.x > bounds.maxX || node.y < bounds.minY || node.y > bounds.maxY
      if (outside) {
        issues.push(
          issue('warning', 'node-outside-canvas', `node "${node.id}" at (${String(node.x)}, ${String(node.y)}) is outside the canvas`, {
            nodeId: node.id,
          }),
        )
      }
    }
  }

  const edgeIds = new Set<EdgeId>()
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push(issue('error', 'duplicate-edge-id', `edge id "${edge.id}" appears more than once`, { edgeId: edge.id }))
      continue
    }
    edgeIds.add(edge.id)
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      const missing = nodeIds.has(edge.from) ? edge.to : edge.from
      issues.push(
        issue('error', 'dangling-edge-endpoint', `edge "${edge.id}" refers to node "${missing}", which is not in the graph`, {
          edgeId: edge.id,
        }),
      )
      continue
    }
    if (edge.from === edge.to) {
      issues.push(issue('error', 'self-loop', `edge "${edge.id}" starts and ends at "${edge.from}"`, { edgeId: edge.id }))
      continue
    }
    if (!(Number.isFinite(edge.metres) && edge.metres > 0)) {
      issues.push(
        issue('error', 'non-positive-length', `edge "${edge.id}" length must be a finite number > 0, got ${String(edge.metres)}`, {
          edgeId: edge.id,
        }),
      )
    }
    const { crowd, slope } = edge.attributes
    if (!(crowd >= 0 && crowd <= CROWD_MAX) || !Number.isFinite(slope) || Math.abs(slope) > SLOPE_ABS_MAX) {
      issues.push(
        issue('warning', 'attribute-out-of-range', `edge "${edge.id}" has crowd=${String(crowd)} slope=${String(slope)}, expected 0..1 and -1..1`, {
          edgeId: edge.id,
        }),
      )
    }
    if (cost !== undefined) {
      const value = cost(edge)
      if (!(Number.isFinite(value) && value > 0)) {
        issues.push(
          issue('error', 'non-positive-cost', `edge "${edge.id}" costs ${String(value)} under this profile; a zero cost breaks Dijkstra`, {
            edgeId: edge.id,
          }),
        )
      }
    }
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }

  for (const node of graph.nodes) {
    if ((degree.get(node.id) ?? 0) === 0 && nodeIds.has(node.id)) {
      issues.push(
        issue('warning', 'isolated-node', `node "${node.id}" has no edge, so nothing can be routed to it`, {
          nodeId: node.id,
        }),
      )
    }
  }

  return issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1
    if (a.code !== b.code) return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
    return compareIssueIds(a, b)
  })
}
