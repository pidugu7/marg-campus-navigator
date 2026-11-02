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

/**
 * How the walker's heading changes at the start of a leg.
 *
 * Nine values, and they are a total union on purpose: the sentence a step prints is chosen by
 * switching over this set, so adding a tenth bucket is a compile error at every `switch` rather than a
 * runtime `undefined` in a directions list. `'stay'` is the degenerate one — origin and destination
 * the same place — and it exists so that case has a sentence instead of a special-cased empty list.
 *
 * Left/right are the walker's own, read from the bearing change; the map's +y axis points *down*, so
 * the compass words in `geo/measure.ts` translate it before any of these are chosen.
 */
export type TurnDirection =
  | 'straight'
  | 'slight-left'
  | 'left'
  | 'sharp-left'
  | 'uturn'
  | 'sharp-right'
  | 'right'
  | 'slight-right'
  | 'stay'

/** One leg of a route, in the words a person walking would use. */
export interface RouteStep {
  readonly instruction: string
  readonly direction: TurnDirection
  readonly metres: number
  /**
   * The vertices this step walks through, origin of the leg included and its far end included.
   * Concatenating the steps (minus the repeated joint) reproduces the node path exactly — a property
   * `path-utils.spec.ts` checks on every random graph, because directions that cannot be replayed are
   * decoration.
   */
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
  /**
   * Vertices settled, in order. On a failure this is the reachable set — the most useful half of the bad
   * news, which is why it lives here rather than only in {@link RouteFound}: Phase 6 draws "everything you
   * can get to from the south annexe" out of a result that has no route in it.
   */
  readonly exploredOrder: readonly NodeId[]
  /**
   * The frontier as it stood the moment each vertex was drawn off it, index-aligned with
   * {@link RouteFound.exploredOrder}: snapshot `k` lists the candidates still competing when
   * `exploredOrder[k]` was settled. One array per step of the search, which is what makes the
   * "watch it search" overlay and Phase 5's replay possible at all: without it there is nothing to
   * animate but the answer.
   *
   * Snapshot *contents* are sorted by (priority, id) for the heap searches and kept in discovery order
   * for BFS, so two runs of the same search on the same graph produce byte-identical arrays. They are
   * empty when a caller asks for `trace: false` — the option Phase 4's benchmark uses to price the
   * search without the record-keeping.
   */
  readonly frontierSnapshots: readonly (readonly NodeId[])[]
}

/**
 * A route a person could walk.
 *
 * The vocabulary, once, because two sets of names circulate for the same object: the *search* words are
 * `expanded` (vertices settled), `ms` (elapsed whole milliseconds) and `exploredOrder` (vertices settled,
 * in order); the *walk* words are `nodeIds` (the path), `edgeIds` (the walkways that carry it) and
 * `metres` (its length). `cost` is neither — it is the profile-weighted total the search minimised, which
 * is the number two algorithms must agree on and the only one that can be compared across profiles.
 */
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
  /**
   * A *weighted* cost that is not > 0. Separate from `non-positive-length` on purpose: an edge can
   * have perfectly legal metres and still cost zero under a profile, and a zero cost breaks
   * Dijkstra's "settled means settled" invariant. Only a supplied {@link EdgeCost} can see it, so
   * the check is opt-in rather than always on.
   */
  | 'non-positive-cost'

export interface GraphIssue {
  readonly code: GraphIssueCode
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly nodeId?: NodeId
  readonly edgeId?: EdgeId
}
