/**
 * The adapter: `campus.json` → an engine graph, plus every complaint a data editor needs.
 *
 * This is the only file in the project that reads the *values* in the data file. Two jobs happen
 * here, in this order, and they are separate on purpose:
 *
 *  1. **Narrow.** `campus.types.ts` declares only what a JSON import can prove (`string`, not a
 *     union; `number[][]`, not a tuple), so the literal-union types the engine wants are produced
 *     here by looking a value up in the engine's own unions — `KINDS.find(...)` — never by casting.
 *     A field off the list yields an issue naming the id, and the bad value never reaches a graph.
 *  2. **Report, never throw.** `AdjacencyGraph.addNode`/`addEdge` raise a `TypeError` for an empty
 *     id, a duplicate, a self-loop, a dangling endpoint, a non-finite coordinate or a length ≤ 0 —
 *     right behaviour for a graph built by code, wrong for a file a student hand-edited at 11 p.m.
 *     Every one of those preconditions is settled here first and an entry that fails it is dropped
 *     rather than passed on. This is why the module has no `try`/`catch`: after the pre-clear there
 *     is no reachable throw, and a `catch` for an unreachable error is decoration that also hides
 *     the bug it claims to survive.
 *
 * {@link validateCampusFile} asks questions and reports; {@link buildGraph} asks the *same*
 * questions through the same predicates and keeps only what survives. That repeats the questions, not
 * the logic, and it is what stops the two halves disagreeing about what a usable id is — which is the
 * failure mode this module exists to prevent.
 *
 * What is *not* done here: re-running `validateGraph` over the finished graph. Every check it makes
 * is either one the pre-clear already settled or one that needs the file's canvas and raw attribute
 * values, so from this path it could report nothing. `docs/SCHEMA.md` states which layer owns which
 * code; `validateGraph` stays the right tool for Phase 7's editor, which holds a graph in memory and
 * never has a file to read.
 *
 * **Cascade policy**, because a report nobody reads is worse than a crash:
 *  - a node with a fatal field is dropped and every edge touching it is dropped silently (the one
 *    error already names the node; twelve more lines about my own repair would bury it);
 *  - an edge with a fatal field is dropped and reported on its own id;
 *  - `outside-canvas`, `isolated-node` and `disconnected-component` measure *completeness*, and are
 *    not produced while any error exists, because dropping entries makes them trivially true.
 */

import {
  DEFAULT_EDGE_ATTRIBUTES,
  createGraph,
  type AdjacencyGraph,
  type Bounds,
  type EdgeAttributes,
  type EdgeInput,
  type GraphEdge,
  type GraphNode,
  type NodeInput,
  type NodeKind,
  type SurfaceKind,
} from '@/engine'

/** The only `schemaVersion` major this builder reads; anything else is a refusal, not a warning. */
export const MAP_SCHEMA_MAJOR = '1'

export type MapIssueSeverity = 'error' | 'warning'

/**
 * One code per thing that can be wrong with the file, as a *value* so it can be tested against:
 * `docs/SCHEMA.md` must have a row for each one and `src/data/build-graph.spec.ts` must have a case for
 * each one, which is what stops the documentation and the rule set drifting apart as codes are added.
 * The union below is derived from this array, so there is one list and not two to keep in step.
 */
export const MAP_ISSUE_CODES = [
  'schema-version',
  'missing-block',
  'duplicate-id',
  'bad-id',
  'bad-number',
  'bad-canvas',
  'bad-kind',
  'bad-surface',
  'bad-attr',
  'crowd-range',
  'unknown-ref',
  'unknown-zone',
  'self-loop',
  'no-entrance',
  'entrance-unreachable',
  'bad-ring',
  'empty-graph',
  'missing-zone',
  'place-to-place',
  'length-mismatch',
  'non-simple-ring',
  'isolated-node',
  'outside-canvas',
  'disconnected-component',
] as const

export type MapIssueCode = (typeof MAP_ISSUE_CODES)[number]

export interface MapIssue {
  readonly severity: MapIssueSeverity
  readonly code: MapIssueCode
  /** A sentence a person can act on, with the offending id quoted exactly as written. */
  readonly message: string
  /** The id to search for in the file. Nodes, edges, buildings, surfaces and zones share one space. */
  readonly subject: string
}

export interface CampusSummary {
  readonly nodeCount: number
  readonly edgeCount: number
  /** Nodes a person can search for: everything that is not a bare junction. */
  readonly placeCount: number
  readonly buildingCount: number
  readonly surfaceCount: number
  readonly zoneCount: number
  readonly componentCount: number
  /** Sum of `metres` over the graph's edges — the size of the network, not of a route. */
  readonly totalMetres: number
  /** Longest single edge, so a 4 km "walkway" is visible without opening the file. */
  readonly longestEdgeMetres: number
}

export interface CampusReport {
  readonly issues: readonly MapIssue[]
  readonly errors: number
  readonly warnings: number
}

export interface CampusModel extends CampusReport {
  /** False when any error was reported. Warnings alone still leave the model `ok`. */
  readonly ok: boolean
  /**
   * Built from whatever the file got right, so the map can draw *something* next to a report instead
   * of a white screen. An unreadable file yields an empty graph, which is the truth.
   */
  readonly graph: AdjacencyGraph
  /** Nodes as the engine holds them, in file order — also the map's draw order for markers. */
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly summary: CampusSummary
}

const KINDS: readonly NodeKind[] = ['junction', 'place', 'gate', 'entrance']
const WALKWAYS: readonly SurfaceKind[] = ['paved', 'covered', 'gravel', 'grass', 'stairs']
const GROUNDS = ['lawn', 'water', 'plaza', 'parking', 'construction'] as const
/** A stated length this far from the coordinates is a stale measurement, not a fact to trust. */
const LENGTH_TOLERANCE = 0.15
/** How many stranded ids a disconnected-network message names before "and others". */
const STRANDED_SHOWN = 6

const quote = (value: unknown): string => (typeof value === 'string' ? `"${value}"` : String(value))

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** A string a map can render. Anything else in a text field falls back rather than printing `[object Object]`. */
const text = (value: unknown, fallback = ''): string => (typeof value === 'string' && value.length > 0 ? value : fallback)

/** A usable id: non-empty, no surrounding whitespace, no space inside. Shared by both halves. */
export function isUsableId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim() && !/\s/.test(value)
}

/**
 * `resolveJsonModule` widens every string to `string`, so a field can arrive as anything at runtime
 * however the types read, and narrowing has to *ask* rather than assume. The lists asked against are
 * the engine's own unions, so a new `SurfaceKind` becomes legal here the day it is added to the
 * engine, with nothing to remember to update — a drift test in Phase 1's contract spec already covers
 * the barrel, and this is the same idea one layer out.
 */
const asKind = (value: unknown): NodeKind | undefined => KINDS.find((kind) => kind === value)
const asSurface = (value: unknown): SurfaceKind | undefined => WALKWAYS.find((surface) => surface === value)

/** Derived length in metres, to one decimal, so a hand-edited file reads the same number back. */
export function deriveMetres(ax: number, ay: number, bx: number, by: number, pixelsPerMetre: number): number {
  return Math.round((Math.hypot(bx - ax, by - ay) / pixelsPerMetre) * 10) / 10
}

/**
 * Materialise the attributes the engine requires from the file's optional ones. Two things happen:
 * absence becomes the engine's own default (so `crowd`'s `0.2` is written once, in
 * `DEFAULT_EDGE_ATTRIBUTES`, and cannot drift from what the cost profiles will assume), and a value of
 * the wrong type falls back to that default instead of travelling into a cost function as a string.
 * The validator has already reported it — this is what stops the report being the only defence.
 */
function sanitiseAttributes(spec: unknown): EdgeAttributes {
  const source = typeof spec === 'object' && spec !== null && !Array.isArray(spec) ? (spec as Record<string, unknown>) : undefined
  const flag = (name: 'stairs' | 'stepFree' | 'shaded' | 'lit'): boolean => {
    const value = source?.[name]
    return typeof value === 'boolean' ? value : DEFAULT_EDGE_ATTRIBUTES[name]
  }
  const crowd = source?.crowd
  const slope = source?.slope
  return {
    stairs: flag('stairs'),
    stepFree: flag('stepFree'),
    shaded: flag('shaded'),
    lit: flag('lit'),
    crowd: isFiniteNumber(crowd) && crowd >= 0 && crowd <= 1 ? crowd : DEFAULT_EDGE_ATTRIBUTES.crowd,
    surface: asSurface(source?.surface) ?? DEFAULT_EDGE_ATTRIBUTES.surface,
    slope: isFiniteNumber(slope) && Math.abs(slope) <= 1 ? slope : DEFAULT_EDGE_ATTRIBUTES.slope,
  }
}

/** A node row that has survived the id and coordinate checks, so its geometry is trustworthy. */
interface GoodNode {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly raw: Record<string, unknown>
}

/**
 * An edge the file is entitled to have. The endpoints are the *resolved* nodes rather than ids, and
 * `metres` is already the stated-or-derived number, so `buildGraph` never recomputes either — a second
 * derivation would need a second guard, and a guard that cannot fail is a lie about the code.
 */
interface GoodEdge {
  readonly id: string
  readonly from: GoodNode
  readonly to: GoodNode
  readonly metres: number
  readonly attrs: unknown
  readonly oneWay: unknown
}

/**
 * The file, indexed once and defaulted once. A real campus has thousands of rows, so every lookup
 * below is a `Map` read, and no rule re-scans the file to ask a question already answered.
 */
interface Index {
  readonly schemaVersion: unknown
  readonly metadata: Record<string, unknown> | undefined
  readonly canvas: Record<string, unknown> | undefined
  // The five blocks, filled by `records` once an index exists to report dropped rows through.
  zones: readonly Record<string, unknown>[]
  rawNodes: readonly Record<string, unknown>[]
  rawEdges: readonly Record<string, unknown>[]
  buildings: readonly Record<string, unknown>[]
  surfaces: readonly Record<string, unknown>[]
  /** Every id in the file, and how many rows claimed it. One flat name space. */
  claims: Map<string, number>
  /** Nodes after the id and coordinate rules. This is both the graph's node list and the referent
   *  for "does this edge name something real", which is why a dropped node drops its edges with it. */
  good: Map<string, GoodNode>
  /** Nodes that failed on their own coordinates, so their edges are not additionally blamed. */
  broken: Set<string>
  pixelsPerMetre: number
  bounds: Bounds
  /** Edges that survived every rule, by id — the engine's edge list, minus anything reported. */
  usable: Map<string, GoodEdge>
  /** Surviving-edge count per node, which is how a reachable entrance is told from a decorative one. */
  incidents: Map<string, number>
  /** True when a required block was unusable, so the rules below would only invent noise. */
  fatal: boolean
  readonly issues: MapIssue[]
}

function error(index: Index, code: MapIssueCode, subject: string, detail: string): void {
  index.issues.push({ severity: 'error', code, subject, message: `${code}: ${detail}` })
}

function warn(index: Index, code: MapIssueCode, subject: string, detail: string): void {
  index.issues.push({ severity: 'warning', code, subject, message: `${code}: ${detail}` })
}

/**
 * Reads a block as an array of records so the loops below never re-ask "is this an array?", and names
 * any row dropped on the way: `"nodes": [null, 42]` — a bad merge, a stray comma — is a shape problem
 * in the file, and staying silent until `empty-graph` would blame the wrong thing.
 */
function records(index: Index, name: string, value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  const kept: Record<string, unknown>[] = []
  value.forEach((row, position) => {
    if (typeof row === 'object' && row !== null && !Array.isArray(row)) kept.push(row as Record<string, unknown>)
    else error(index, 'missing-block', `${name}[${String(position)}]`, `"${name}" entry ${String(position)} is ${quote(row)}; every row must be an object`)
  })
  return kept
}

/**
 * One reading of one value, shared by the rules and the builder. A row that is not an object at all
 * (`"nodes": [null, 42]`) is reported where it sits rather than crashing the walk over the array.
 */
function inspect(source: unknown): Index {
  const base: Index = {
    schemaVersion: undefined,
    metadata: undefined,
    canvas: undefined,
    zones: [],
    rawNodes: [],
    rawEdges: [],
    buildings: [],
    surfaces: [],
    claims: new Map(),
    good: new Map(),
    broken: new Set(),
    pixelsPerMetre: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    usable: new Map(),
    incidents: new Map(),
    fatal: false,
    issues: [],
  }
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    error(base, 'missing-block', 'campus.json', 'the file must be a single JSON object')
    base.fatal = true
    return base
  }
  const file = source as Record<string, unknown>
  const index: Index = {
    ...base,
    schemaVersion: file.schemaVersion,
    metadata: typeof file.metadata === 'object' && file.metadata !== null ? (file.metadata as Record<string, unknown>) : undefined,
    canvas: typeof file.canvas === 'object' && file.canvas !== null ? (file.canvas as Record<string, unknown>) : undefined,
    zones: [],
    rawNodes: [],
    rawEdges: [],
    buildings: [],
    surfaces: [],
  }
  // Built after the literal because `records` reports through the index it is filling.
  index.zones = records(index, 'zones', file.zones)
  index.rawNodes = records(index, 'nodes', file.nodes)
  index.rawEdges = records(index, 'edges', file.edges)
  index.buildings = records(index, 'buildings', file.buildings)
  index.surfaces = records(index, 'surfaces', file.surfaces)
  // A row that is not an object at all (`"nodes": [null, 42]`) was dropped by `records`, which is a
  // shape problem worth naming rather than a hundred rows of "id undefined".
  const arrays = [
    ['nodes', file.nodes, true],
    ['edges', file.edges, true],
    ['zones', file.zones, false],
    ['buildings', file.buildings, false],
    ['surfaces', file.surfaces, false],
  ] as const
  for (const [name, value, required] of arrays) {
    if (!Array.isArray(value) && (required || value !== undefined)) {
      error(index, 'missing-block', name, `"${name}" must be an array${required ? '' : ' when present'} (found ${value === undefined ? 'nothing' : typeof value})`)
      if (required) index.fatal = true
    }
  }
  if (index.metadata === undefined) {
    error(index, 'missing-block', 'metadata', '"metadata" is required: without it the map cannot say which campus it is, or how far to trust its scale')
  } else if (typeof index.metadata.dataStatus !== 'string') {
    error(index, 'missing-block', 'metadata.dataStatus', `metadata.dataStatus must be a string (got ${quote(index.metadata.dataStatus)}); it is what labels a placeholder as one`)
  }
  return index
}

/** The version gate, separate because a file from a future builder must be refused, not half-read. */
function checkVersion(index: Index): void {
  if (typeof index.schemaVersion !== 'string' || index.schemaVersion.length === 0) {
    error(index, 'missing-block', 'schemaVersion', '"schemaVersion" must be a string like "1"')
    return
  }
  if (index.schemaVersion.split('.')[0] !== MAP_SCHEMA_MAJOR) {
    error(index, 'schema-version', 'schemaVersion', `the file says ${quote(index.schemaVersion)} and this build reads major ${quote(MAP_SCHEMA_MAJOR)}; refusing to guess what changed`)
  }
}

/**
 * The canvas is the app's only unit conversion, so a bad number in it is not cosmetic — it is the
 * divisor of every derived length and the extent every label is clipped to. It is repaired for
 * reporting purposes (1 unit = 1 m, a 1×1 extent) while still being reported: one typo yields one
 * line rather than one line per edge.
 */
function readCanvas(index: Index): void {
  const canvas = index.canvas
  if (canvas === undefined) {
    error(index, 'missing-block', 'canvas', '"canvas" is required: the map has no extent without it')
    return
  }
  const ppm = canvas.pixelsPerMetre
  if (!isFiniteNumber(ppm) || ppm <= 0) {
    error(index, 'bad-canvas', 'canvas.pixelsPerMetre', `pixelsPerMetre must be a finite number > 0 (got ${quote(ppm)}); derived lengths used 1 meanwhile`)
  } else {
    index.pixelsPerMetre = ppm
  }
  const width = canvas.width
  const height = canvas.height
  if (!isFiniteNumber(width) || width <= 0 || !isFiniteNumber(height) || height <= 0) {
    error(index, 'bad-canvas', 'canvas', `width and height must be finite numbers > 0 (got ${quote(width)}, ${quote(height)})`)
    return
  }
  index.bounds = { minX: 0, minY: 0, maxX: width, maxY: height }
}

/** Claims every id in the file in one flat space, so a reference can never be ambiguous. */
function claimIds(index: Index): void {
  const claim = (id: unknown, block: string, position: number): void => {
    if (!isUsableId(id)) {
      error(index, 'bad-id', `${block}[${String(position)}]`, `${block} entry ${String(position)} has id ${quote(id)}; ids must be non-empty and contain no whitespace`)
      return
    }
    index.claims.set(id, (index.claims.get(id) ?? 0) + 1)
  }
  index.zones.forEach((zone, position) => claim(zone.id, 'zones', position))
  index.rawNodes.forEach((node, position) => claim(node.id, 'nodes', position))
  index.rawEdges.forEach((edge, position) => claim(edge.id, 'edges', position))
  index.buildings.forEach((building, position) => claim(building.id, 'buildings', position))
  index.surfaces.forEach((surface, position) => claim(surface.id, 'surfaces', position))
  for (const [id, count] of index.claims) {
    if (count > 1) {
      error(index, 'duplicate-id', id, `id ${quote(id)} is claimed ${String(count)} times; every node, edge, building, surface and zone shares one name space, so a reference to it would be ambiguous`)
    }
  }
}

/** A zone name only helps if `zones` declares it, because an undeclared one cannot be coloured. */
function checkZone(index: Index, subject: string, zone: unknown, what: string): void {
  if (zone === undefined) {
    warn(index, 'missing-zone', subject, `${what} ${quote(subject)} has no "zone", so the legend and hover grouping will skip it`)
    return
  }
  if (!index.zones.some((candidate) => candidate.id === zone)) {
    error(index, 'unknown-zone', subject, `${what} ${quote(subject)} is in zone ${quote(zone)}, which "zones" does not declare`)
  }
}

/** Nodes: id, geometry, kind and zone. What survives becomes `index.good`. */
/**
 * Nodes: id, geometry, kind and zone. What survives becomes `index.good`.
 *
 * A repeated id keeps its *first* row and drops the rest: the collision is one error about one id,
 * and the campus the file means is still describable. Dropping both rows instead turned a single
 * duplicated name into a report about every edge that had trusted it.
 */
function walkNodes(index: Index): void {
  for (const node of index.rawNodes) {
    const id = node.id
    if (!isUsableId(id) || index.good.has(id) || index.broken.has(id)) continue
    if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) {
      error(index, 'bad-number', id, `node ${quote(id)} has coordinates (${quote(node.x)}, ${quote(node.y)}); both must be finite numbers`)
      index.broken.add(id)
      continue
    }
    if (asKind(node.kind) === undefined) {
      error(index, 'bad-kind', id, `node ${quote(id)} has kind ${quote(node.kind)}; expected ${KINDS.map(quote).join(' | ')}`)
    }
    checkZone(index, id, node.zone, 'node')
    index.good.set(id, { id, x: node.x, y: node.y, raw: node })
  }
}

/** One edge's attribute block, checked against the types the engine's cost functions will read. */
function checkAttributes(index: Index, edge: Record<string, unknown>): void {
  const id = edge.id as string
  const spec = edge.attrs
  if (spec === undefined) return
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    error(index, 'bad-attr', id, `edge ${quote(id)} has attrs of type ${typeof spec}; expected an object or nothing`)
    return
  }
  const attrs = spec as Record<string, unknown>
  for (const flag of ['stairs', 'stepFree', 'shaded', 'lit'] as const) {
    const value = attrs[flag]
    if (value !== undefined && typeof value !== 'boolean') {
      error(index, 'bad-attr', id, `edge ${quote(id)} attrs.${flag} is ${quote(value)}; expected true or false`)
    }
  }
  if (attrs.stairs === true && attrs.stepFree === true) {
    error(index, 'bad-attr', id, `edge ${quote(id)} claims stairs and no steps at once; set stepFree to false or drop the stairs flag`)
  }
  if (attrs.crowd !== undefined) {
    const crowd = attrs.crowd
    if (!isFiniteNumber(crowd) || crowd < 0 || crowd > 1) {
      // Never clamped: a clamp turns a typo into a plausible route, and that difference is exactly
      // what the `quiet` profile is graded on.
      error(index, 'crowd-range', id, `edge ${quote(id)} attrs.crowd is ${quote(crowd)}; expected a finite number 0..1`)
    }
  }
  if (attrs.slope !== undefined) {
    const slope = attrs.slope
    if (!isFiniteNumber(slope) || Math.abs(slope) > 1) {
      error(index, 'bad-attr', id, `edge ${quote(id)} attrs.slope is ${quote(slope)}; expected a finite rise/run within -1..1`)
    }
  }
  if (attrs.surface !== undefined && asSurface(attrs.surface) === undefined) {
    error(index, 'bad-surface', id, `edge ${quote(id)} attrs.surface is ${quote(attrs.surface)}; expected ${WALKWAYS.map(quote).join(' | ')}`)
  }
}

/**
 * One endpoint of an edge: the value, or the reason there is none. Reporting and resolving happen in
 * the same place so the caller never has to re-read a map to find out what it just was told.
 */
function endpoint(index: Index, edgeId: string, ref: unknown): GoodNode | null {
  if (!isUsableId(ref)) {
    error(index, 'unknown-ref', edgeId, `edge ${quote(edgeId)} refers to node ${quote(ref)}, which is not a usable id`)
    return null
  }
  const found = index.good.get(ref)
  if (found !== undefined) return found
  // A node that failed on its own coordinates is already reported; saying so again here would be
  // describing my own repair, and would bury the one line that explains it.
  if (!index.broken.has(ref)) error(index, 'unknown-ref', edgeId, `edge ${quote(edgeId)} refers to node ${quote(ref)}, which is not in "nodes"`)
  return null
}

/** Is this edge's row usable? `null` means it was reported, or is a duplicate of a row kept above. */
function resolveEdge(index: Index, edge: Record<string, unknown>): { readonly id: string; readonly from: GoodNode; readonly to: GoodNode } | null {
  const id = edge.id
  // `index.usable` doubles as the "already claimed this id" set, so a duplicate never overwrites the
  // edge that got there first.
  if (!isUsableId(id) || index.usable.has(id)) return null
  const from = endpoint(index, id, edge.from)
  const to = endpoint(index, id, edge.to)
  if (from === null || to === null) return null
  if (edge.from === edge.to) {
    error(index, 'self-loop', id, `edge ${quote(id)} starts and ends at ${quote(edge.from)}; a walkway that goes nowhere still costs a route`)
    return null
  }
  return { id, from, to }
}

/** Edges: references, lengths and attributes. `index.usable` is what the engine will be handed. */
/**
 * Edges: references, lengths and attributes. Everything a later step needs is settled here once —
 * including the length, so `buildGraph` reads a number instead of repeating the arithmetic and then
 * guarding against a case this function already rejected.
 */
function walkEdges(index: Index): void {
  for (const edge of index.rawEdges) {
    const resolved = resolveEdge(index, edge)
    if (resolved === null) continue
    const { id, from, to } = resolved
    const stated = edge.metres
    if (stated !== undefined && (!isFiniteNumber(stated) || stated <= 0)) {
      error(index, 'bad-number', id, `edge ${quote(id)} has metres ${quote(stated)}; a length must be a finite number > 0, or omitted to derive it from the coordinates`)
      continue
    }
    const derived = deriveMetres(from.x, from.y, to.x, to.y, index.pixelsPerMetre)
    if (stated === undefined && derived <= 0) {
      error(index, 'bad-number', id, `edge ${quote(id)} joins two nodes at the same point, so its derived length is ${String(derived)}; move one of them, or state metres`)
      continue
    }
    checkAttributes(index, edge)
    const metres = stated === undefined ? derived : (stated as number)
    if (stated !== undefined) {
      const gap = Math.abs(metres - derived) / derived
      if (gap > LENGTH_TOLERANCE) {
        warn(index, 'length-mismatch', id, `edge ${quote(id)} says ${String(metres)} m and its coordinates say ${String(derived)} m (${String(Math.round(gap * 100))}% apart); usually a node moved and this edge was not re-measured`)
      }
    }
    if (from.raw.kind !== 'junction' && to.raw.kind !== 'junction') {
      warn(index, 'place-to-place', id, `edge ${quote(id)} joins two places (${quote(from.id)}, ${quote(to.id)}) with no junction between them; legal for a plaza, but a route through it gets a vaguer turn instruction`)
    }
    index.usable.set(id, { id, from, to, metres, attrs: edge.attrs, oneWay: edge.oneWay })
    index.incidents.set(from.id, (index.incidents.get(from.id) ?? 0) + 1)
    index.incidents.set(to.id, (index.incidents.get(to.id) ?? 0) + 1)
  }
}

/** One corner of a ring. A tuple, so the geometry below never has to ask whether a point has two numbers. */
type RingPoint = readonly [number, number]

/**
 * `footprint` and `ring` share one rule: at least three `[x, y]` points of finite numbers. The cast at
 * the end is the one place the runtime proof meets the type — everywhere else the points are tuples, so
 * no `?? 0` fallbacks are needed to satisfy `noUncheckedIndexedAccess` and none can be uncovered.
 */
function checkRing(value: unknown): readonly RingPoint[] | null {
  if (!Array.isArray(value) || value.length < 3) return null
  for (const point of value) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(isFiniteNumber)) return null
  }
  return value as readonly RingPoint[]
}

/** Strict crossing of two segments by orientation sign — no division, so no epsilon and no collinear special case. */
function segmentsCross(a: RingPoint, b: RingPoint, c: RingPoint, d: RingPoint): boolean {
  const orient = (p: RingPoint, q: RingPoint, r: RingPoint): number =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0
}

/** Consecutive corner pairs, with the closing side from the last point back to the first. */
function ringSides(ring: readonly RingPoint[]): [RingPoint, RingPoint][] {
  const sides: [RingPoint, RingPoint][] = []
  let first: RingPoint | undefined
  let previous: RingPoint | undefined
  for (const point of ring) {
    if (first === undefined) first = point
    if (previous !== undefined) sides.push([previous, point])
    previous = point
  }
  // A ring that repeats its first vertex at the end — the GeoJSON habit, and what a draw tool tends to
  // emit — closes itself already, so the degenerate side is skipped rather than treated as a crossing.
  if (first !== undefined && previous !== undefined && previous !== first) sides.push([previous, first])
  return sides
}

/**
 * Any two non-adjacent sides crossing makes a bowtie. Written with `entries`/`slice` rather than index
 * reads so every corner stays a tuple: `noUncheckedIndexedAccess` would otherwise demand a fallback at
 * each one, and a fallback that cannot be reached is a branch nobody can test.
 */
function ringIsSimple(ring: readonly RingPoint[]): boolean {
  const sides = ringSides(ring)
  for (const [i, [a, b]] of sides.entries()) {
    for (const [offset, [c, d]] of sides.slice(i + 2).entries()) {
      // Adjacent sides meet by definition, and so do the first and the last of a closed ring.
      if (i === 0 && i + 2 + offset === sides.length - 1) continue
      if (segmentsCross(a, b, c, d)) return false
    }
  }
  return true
}

/** Draw-only geometry, and the entrances that connect it to the network. */
function walkGeometry(index: Index): void {
  const seenBuildings = new Set<string>()
  const seenSurfaces = new Set<string>()
  // `entrance-unreachable` is the one geometry rule that reads the *edge* set, so it is only a
  // statement about the file while nothing has had to be dropped. After a repair it would report my
  // own edit — "the library's entrance has no walkway" when the walkway is there and its `metres`
  // said 0 — which is precisely the noise the cascade policy exists to prevent.
  const repaired = index.issues.some((issue) => issue.severity === 'error')
  for (const building of index.buildings) {
    const id = building.id
    if (!isUsableId(id) || seenBuildings.has(id)) continue
    seenBuildings.add(id)
    const ring = checkRing(building.footprint)
    if (ring === null) {
      error(index, 'bad-ring', id, `building ${quote(id)} footprint must be at least three [x, y] points of finite numbers`)
    } else if (!ringIsSimple(ring)) {
      warn(index, 'non-simple-ring', id, `building ${quote(id)} footprint crosses itself, so it will render with a hole in it`)
    }
    checkZone(index, id, building.zone, 'building')
    const entries = building.entryNodeIds
    if (!Array.isArray(entries) || entries.length === 0) {
      error(index, 'no-entrance', id, `building ${quote(id)} has no entryNodeIds, so "route to ${text(building.label, id)}" has no last step`)
      continue
    }
    for (const entry of entries) {
      if (!isUsableId(entry)) {
        error(index, 'unknown-ref', id, `building ${quote(id)} lists entrance ${quote(entry)}, which is not a usable id`)
        continue
      }
      if (!index.good.has(entry)) {
        if (!index.broken.has(entry)) error(index, 'unknown-ref', id, `building ${quote(id)} lists entrance ${quote(entry)}, which is not in "nodes"`)
        continue
      }
      if (!repaired && (index.incidents.get(entry) ?? 0) === 0) {
        error(index, 'entrance-unreachable', id, `building ${quote(id)} can only be entered at ${quote(entry)}, which has no walkway attached`)
      }
    }
  }
  for (const surface of index.surfaces) {
    const id = surface.id
    if (!isUsableId(id) || seenSurfaces.has(id)) continue
    seenSurfaces.add(id)
    const ring = checkRing(surface.ring)
    if (ring === null) {
      error(index, 'bad-ring', id, `surface ${quote(id)} ring must be at least three [x, y] points of finite numbers`)
    } else if (!ringIsSimple(ring)) {
      warn(index, 'non-simple-ring', id, `surface ${quote(id)} ring crosses itself, so it will render with a hole in it`)
    }
    if (!GROUNDS.some((kind) => kind === surface.kind)) {
      error(index, 'bad-surface', id, `surface ${quote(id)} has kind ${quote(surface.kind)}; expected ${GROUNDS.map(quote).join(' | ')}`)
    }
  }
}

/** Errors first, then code, then subject: two runs on one file give the same report, so it diffs. */
function sortIssues(issues: readonly MapIssue[]): MapIssue[] {
  return [...issues].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1
    if (a.code !== b.code) return a.code < b.code ? -1 : 1
    if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1
    // Two complaints about one id (a bad flag and a bad slope on the same edge, say) still need an
    // order, or the report can shuffle between runs and make a diff out of nothing. The `0` is not
    // defensive: an edge whose `from` and `to` are both unusable earns two identical lines, and they
    // are reported twice because fixing one still leaves the other to fix.
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0
  })
}

/** The rules, over any value. Never throws, whatever the input is — including for Phase 7's editor. */
export function validateCampusFile(source: unknown): CampusReport {
  return tally(sortIssues(analyse(source).issues))
}

function tally(issues: readonly MapIssue[]): CampusReport {
  const errors = issues.filter((one) => one.severity === 'error').length
  return { issues, errors, warnings: issues.length - errors }
}

/**
 * The whole reading of a file, in the order the rules need it: shape, version, scale, names, nodes,
 * edges, geometry. Shared by both public entry points, so the report and the graph are the same pass.
 */
function analyse(source: unknown): Index {
  const index = inspect(source)
  // Deliberately after the fatal gate: a file that is not an object at all has already been told so,
  // and "schemaVersion is missing" on top of it is describing my own reading of the wreckage.
  if (index.fatal) return index
  checkVersion(index)
  readCanvas(index)
  claimIds(index)
  walkNodes(index)
  walkEdges(index)
  // Before the geometry pass, because `walkGeometry` reads the edge set: "there is no network at all"
  // is the more fundamental statement, and an entrance that is unreachable *because* of that must not
  // be reported as a second, separate defect.
  if (index.good.size === 0 || index.usable.size === 0) { // usable rows, not raw ones
    error(index, 'empty-graph', 'campus.json', `${String(index.good.size)} usable node(s) and ${String(index.usable.size)} usable edge(s); a campus needs both to route on`)
  }
  walkGeometry(index)
  return index
}

/**
 * Narrow, validate, build. `buildGraph` and `validateCampusFile` share {@link analyse}, so the graph
 * you draw and the report you read cannot disagree about which rows were usable.
 */
export function buildGraph(source: unknown): CampusModel {
  const index = analyse(source)
  const nodeInputs: NodeInput[] = []
  for (const node of index.good.values()) {
    const kind = asKind(node.raw.kind) ?? 'junction'
    const zone = node.raw.zone
    nodeInputs.push({
      id: node.id,
      x: node.x,
      y: node.y,
      label: text(node.raw.label, node.id),
      kind,
      ...(typeof zone === 'string' ? { zone } : {}),
    })
  }
  const edgeInputs: EdgeInput[] = []
  for (const edge of index.usable.values()) {
    edgeInputs.push({
      id: edge.id,
      from: edge.from.id,
      to: edge.to.id,
      metres: edge.metres,
      attributes: sanitiseAttributes(edge.attrs),
      ...(edge.oneWay === true ? { oneWay: true } : {}),
    })
  }

  const graph = createGraph(nodeInputs, edgeInputs, { bounds: index.bounds, seal: true })
  const snapshot = graph.graph
  const issues = sortIssues(index.issues)
  const errors = issues.filter((one) => one.severity === 'error').length
  const extra: MapIssue[] = []
  // `createGraph` has nothing to complain about here: every row was filtered through the predicates
  // that produced the errors above. What is left is completeness, and only worth measuring once
  // nothing had to be dropped.
  if (errors === 0) {
    const components = graph.components()
    for (const node of snapshot.nodes) {
      if (node.x < index.bounds.minX || node.x > index.bounds.maxX || node.y < index.bounds.minY || node.y > index.bounds.maxY) {
        extra.push({
          severity: 'warning',
          code: 'outside-canvas',
          subject: node.id,
          message: `outside-canvas: node ${quote(node.id)} at (${String(node.x)}, ${String(node.y)}) is outside the ${String(index.bounds.maxX)}×${String(index.bounds.maxY)} canvas, so the map will clip it`,
        })
      }
    }
    // Drawn from `components.isolated`, which is the honest definition — a node with only a self-loop
    // is stranded, since an edge that goes nowhere moves nobody.
    const stranded = new Set(components.isolated)
    for (const node of snapshot.nodes) {
      if (!stranded.has(node.id)) continue
      extra.push({
        severity: 'warning',
        code: 'isolated-node',
        subject: node.id,
        message: `isolated-node: node ${quote(node.id)} (${quote(node.label)}) has no walkway attached, so nothing can be routed to it`,
      })
    }
    if (components.count > 1) {
      const sizes = Array.from({ length: components.count }, (_, position) => components.members(position).length)
      const biggest = Math.max(...sizes)
      const stranded = sizes
        .map((size, position) => (size === biggest ? [] : components.members(position)))
        .flat()
        .slice(0, STRANDED_SHOWN)
      extra.push({
        severity: 'warning',
        code: 'disconnected-component',
        subject: 'graph',
        message: `disconnected-component: ${String(components.count)} separate networks of ${sizes.join(', ')} nodes; ${String(stranded.length)} of them unreachable from the largest, e.g. ${stranded.map(quote).join(', ')}`,
      })
    }
  }

  const all = sortIssues([...issues, ...extra])
  return {
    ok: all.every((one) => one.severity === 'warning'),
    // `tally` contributes `issues`, `errors` and `warnings` — the same three fields the CLI reads,
    // so a report built from a model and one built from the rules are the same object.
    ...tally(all),
    graph,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    summary: {
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      // Everything that is not a bare junction is a thing a person could type into the search box.
      placeCount: snapshot.nodes.filter((node) => node.kind !== 'junction').length,
      buildingCount: index.buildings.length,
      surfaceCount: index.surfaces.length,
      zoneCount: index.zones.length,
      componentCount: graph.components().count,
      totalMetres: Math.round(snapshot.edges.reduce((sum, edge) => sum + edge.metres, 0) * 10) / 10,
      longestEdgeMetres: snapshot.edges.reduce((longest, edge) => Math.max(longest, edge.metres), 0),
    },
  }
}

/**
 * The report the CLI prints and (Phase 5) the error panel renders — one function, so the terminal and
 * the UI cannot describe the same file in two different voices.
 */
export function formatCampusReport(
  report: CampusReport,
  options: { readonly source?: string; readonly severity?: MapIssueSeverity } = {},
): string {
  const selected = options.severity === undefined ? report.issues : report.issues.filter((one) => one.severity === options.severity)
  const tallyText = `${String(report.errors)} error${report.errors === 1 ? '' : 's'}, ${String(report.warnings)} warning${report.warnings === 1 ? '' : 's'}`
  const where = options.source === undefined ? '' : ` (${options.source})`
  if (selected.length === 0) return `no issues${where}`
  const lines = selected.map((one) => `${one.severity}: ${one.message} [${one.subject}]`)
  lines.push('', `${tallyText}${where}`)
  return lines.join('\n')
}
