/**
 * The shared vocabulary of the engine.
 *
 * Rules for anything added here (enforced by `src/test/architecture.test.ts`):
 *  - plain, structural data only — no classes, no `enum`, no functions holding
 *    state, so every value is JSON-serialisable and trivial to assert on;
 *  - no React, no DOM, no Node types;
 *  - no campus vocabulary. "building" and "walkway" are words from `src/data`;
 *    the engine only ever sees nodes, edges and numbers. The adapter
 *    `src/data/build-graph.ts` is what turns one representation into the other.
 *
 * Units: distances are metres, angles are degrees, coordinates are the map's
 * own world units (see docs/MAP-DATA.md for how world units map to metres).
 */

export type NodeId = string
export type EdgeId = string
export type ZoneId = string

/** A position in map world units. */
export interface Point {
  readonly x: number
  readonly y: number
}

export interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/**
 * What a vertex represents. The engine branches on none of these — they exist so
 * the UI can style a vertex and so search can rank one kind above another.
 */
export type NodeKind = 'junction' | 'place' | 'gate' | 'entrance'

/**
 * A vertex of the walkway network.
 *
 * A `junction` is a point where you can change direction; a `place`, `gate` or
 * `entrance` is a destination you can be routed to. Only junctions are expected
 * to carry edges, but the graph type does not require it.
 *
 * Deliberately absent: a floor/storey axis. This campus model is single-level
 * (outdoor routing), so `z` would be dead weight in every algorithm signature.
 */
export interface GraphNode {
  readonly id: NodeId
  readonly label: string
  readonly kind: NodeKind
  readonly x: number
  readonly y: number
  readonly zone?: ZoneId
}

/** Walkable surface kinds, ranked by how much they slow a pedestrian down. */
export type SurfaceKind = 'paved' | 'covered' | 'gravel' | 'grass' | 'stairs'

/**
 * Per-edge traversal facts. These are the only inputs the cost profiles know
 * about, which is what keeps "shaded route" a weight function rather than a
 * separate algorithm.
 */
export interface EdgeAttributes {
  /** Vertical travel via steps. Profiles that must stay step-free avoid these. */
  readonly stairs: boolean
  /** True when a wheelchair/pram can traverse the whole edge without help. */
  readonly stepFree: boolean
  /** Covered or tree-shaded for most of its length (the rain/sun edge flag). */
  readonly shaded: boolean
  /** Lit at night. Used by the 'quiet' profile together with `crowd`. */
  readonly lit: boolean
  /** Typical congestion, 0 (empty) to 1 (jammed). Clamped when built. */
  readonly crowd: number
  readonly surface: SurfaceKind
  /** Signed grade as rise/run, e.g. 0.06 for a 6% ramp. 0 is flat. */
  readonly slope: number
}

/**
 * One walkway segment between two vertices.
 *
 * `metres` is geometry; it is *not* the weight. Weight comes from an
 * {@link EdgeCost} so that two profiles can share one graph instance.
 */
export interface GraphEdge {
  readonly id: EdgeId
  readonly from: NodeId
  readonly to: NodeId
  /** Strictly positive, finite. */
  readonly metres: number
  readonly attributes: EdgeAttributes
  /** Traversable in one direction only. `false` means both ways. */
  readonly oneWay: boolean
}

/** The serialisable graph. Everything else in the engine is derived from it. */
export interface Graph {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
}

/** A single outgoing step in an adjacency list, with the edge that carries it. */
export interface AdjacencyEntry {
  readonly to: NodeId
  readonly edgeId: EdgeId
}

/**
 * Read-only adjacency view built once per graph (see `structures/graph.ts`).
 * Algorithms depend on this interface, never on the concrete implementation, so
 * a list, a map-of-maps or a CSR layout can be swapped without touching them.
 */
export interface GraphIndex {
  readonly graph: Graph
  /** Number of vertices. */
  readonly size: number
  /** Number of directed arcs actually stored (an undirected edge counts twice). */
  readonly arcCount: number
  hasNode(id: NodeId): boolean
  node(id: NodeId): GraphNode | undefined
  edge(id: EdgeId): GraphEdge | undefined
  /** Neighbours in adjacency order. Empty for an unknown id, never undefined. */
  neighboursOf(id: NodeId): readonly AdjacencyEntry[]
  /** Every edge id incident to a node, both directions. */
  edgesAt(id: NodeId): readonly EdgeId[]
  /** Connected components, precomputed with union-find for O(α) checks. */
  componentOf(id: NodeId): number
}

/**
 * Cost of traversing one edge — the only place a routing preference lives.
 * Contract: returns a finite number `> 0`. A zero cost breaks Dijkstra's
 * "settled means settled" invariant, so it is rejected by validation.
 */
export type EdgeCost = (edge: GraphEdge) => number

/**
 * A* estimate of remaining travel between two points.
 * Contract: must never overestimate the true cost (admissible) or A* can return
 * a suboptimal path; scaling an admissible estimate by >1 is deliberate and is
 * reported as such by the caller.
 */
export type Heuristic = (from: Point, target: Point) => number

/** Route preferences offered in the UI. Each maps to a cost function. */
export type WeightProfile = 'fastest' | 'shaded' | 'step-free' | 'quiet'

export type AlgorithmName = 'dijkstra' | 'a-star' | 'bfs'

/** What the UI asks for; everything the router needs and nothing it doesn't. */
export interface RouteRequest {
  readonly from: NodeId
  readonly to: NodeId
  readonly profile?: WeightProfile
  readonly algorithm?: AlgorithmName
}

/** One leg of a route, in the words a person walking would use. */
export interface RouteStep {
  readonly instruction: string
  /** Cardinal-relative turn: 'straight' | 'slight-left' | 'left' | 'right' | … */
  readonly direction: string
  readonly metres: number
  readonly nodeIds: readonly NodeId[]
}

/** Fields shared by success and failure so callers can show one summary. */
export interface RouteMetrics {
  readonly algorithm: AlgorithmName
  readonly profile: WeightProfile
  /** Vertices popped from the frontier. The cost of the search, not the walk. */
  readonly expanded: number
  readonly ms: number
  /** Served from the LRU route cache rather than recomputed. */
  readonly cached: boolean
}

export interface RouteFound extends RouteMetrics {
  readonly ok: true
  readonly nodeIds: readonly NodeId[]
  readonly edgeIds: readonly EdgeId[]
  /** Sum of edge costs along the path (profile-weighted, so not metres). */
  readonly cost: number
  /** Sum of `metres` along the path — the number shown to a human. */
  readonly metres: number
  /** Number of edges traversed. */
  readonly hops: number
  /** Minutes at the profile's assumed walking pace. */
  readonly minutes: number
  readonly steps: readonly RouteStep[]
  /** Vertices settled, in order — drives the "watch it search" overlay. */
  readonly exploredOrder: readonly NodeId[]
}

export type RouteFailureReason =
  | 'empty-graph'
  | 'unknown-origin'
  | 'unknown-destination'
  | 'disconnected'
  | 'invalid-graph'

export interface RouteNotFound extends RouteMetrics {
  readonly ok: false
  readonly reason: RouteFailureReason
  readonly message: string
}

export type RouteResult = RouteFound | RouteNotFound

/** Codes emitted by `routing/validate.ts`; all are build-blocking for a map. */
export type GraphIssueCode =
  | 'duplicate-node-id'
  | 'duplicate-edge-id'
  | 'dangling-edge-endpoint'
  | 'self-loop'
  | 'non-positive-length'
  | 'non-finite-coordinate'
  | 'isolated-node'
  | 'node-outside-canvas'
  | 'attribute-out-of-range'

export interface GraphIssue {
  readonly code: GraphIssueCode
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly nodeId?: NodeId
  readonly edgeId?: EdgeId
}
