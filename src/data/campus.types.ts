/**
 * Schema of `campus.json` — the single file that describes the physical campus.
 *
 * This is the *raw file* shape, and it is deliberately permissive: identifiers
 * are plain strings, optional blocks are `Partial`s, and nothing is a literal
 * union. `src/data/build-graph.ts` (Phase 2) is the validator: it narrows these
 * strings into the engine's union types and rejects bad values with a message
 * that names the offending id. Keeping validation in the builder — rather than
 * in the type system — means a typo in hand-edited JSON produces
 * "edge e17 references unknown node j-13", not a compiler error 400 lines away.
 *
 * The loose unions are not only a philosophy, they are forced. Vite/TS reads a
 * `.json` import by widening every string to `string` — no literal types — so a
 * field declared as `'a' | 'b'` here can never be satisfied by the imported
 * file, and `export const campus: CampusFile = campusJson` would fail for the
 * one and only reason that the data is real. `kind`, `attrs.surface` and
 * `SurfaceSpec.kind` are `string` for that reason; each is checked against the
 * list above it in the validator, and each has a `docs/SCHEMA.md` issue code.
 *
 * Tuples are the same story: an imported JSON array is `number[]`, never
 * `[number, number]`, so footprint rings are `number[][]` and "every point is
 * an [x, y] pair" is issue `bad-ring` rather than a type. The rule this file
 * follows is therefore mechanical: **declare only what a JSON file can prove**,
 * and let the builder own everything else.
 *
 * Coordinate space: SVG user units, origin top-left, +y downwards, matching
 * `canvas` below. `canvas.pixelsPerMetre` is the only conversion factor between
 * drawing space and the real world; `metres` on an edge is derived from it when
 * the file omits an explicit length.
 *
 * See docs/MAP-DATA.md for a worked example and the digitising workflow.
 */

export type DataStatus = 'synthetic-placeholder' | 'digitised' | 'surveyed'

export interface CampusMetadata {
  /** Application title, kept separate so renaming the app never touches data. */
  app: string
  /** Institution the geometry belongs to. */
  campus: string
  campusShort: string
  location: {
    city: string
    state: string
    country: string
    /** Decimal degrees, for provenance only — routing never uses lat/lng. */
    latitude?: number
    longitude?: number
  }
  /**
   * Provenance of `pixelsPerMetre`: nothing yet, two-point calibration from the
   * map editor, a survey plan, or a GIS export. Every distance in the app is
   * only as honest as this field, so the UI repeats it rather than hiding it.
   */
  scaleSource: string
  /** One of `DataStatus`. Loose on purpose: a typo is a validation error, not a compiler error. */
  dataStatus: string
  authoredBy: string
  updatedAt: string
  notes: string
}

export interface CanvasSpec {
  /** World-space extent of the map, i.e. the SVG viewBox width. */
  width: number
  height: number
  /** World units per metre. 1 means one user unit is one metre. */
  pixelsPerMetre: number
  /** Raster the geometry was traced over, if any. Rendered behind the map. */
  referenceImage?: {
    src: string
    /** src pixels per world unit, so the image can be aligned to the graph. */
    scale: number
    offsetX: number
    offsetY: number
    opacity: number
  }
}

export interface ZoneSpec {
  id: string
  label: string
  /** Fill used by the legend and by zone flood-fill highlighting. */
  color: string
}

/**
 * A graph vertex AND, when `kind` is not `junction`, a searchable place.
 * There is no separate POI table: a place is a node that carries a category.
 */
export interface NodeSpec {
  id: string
  label: string
  /**
   * `junction` | `place` | `gate` | `entrance`, as a string: see the note on JSON
   * widening above. A value outside those four is issue `bad-kind`.
   */
  kind: string
  x: number
  y: number
  zone?: string
  /** Only for kind !== 'junction'. Feeds the trie's ranking. */
  category?: string
  /** Alternate spellings/abbreviations a person might type ("lib", "BCA"). */
  aliases?: string[]
  /**
   * Small enough that the map should not spend a label on it until you are close.
   * Draw-only: staging never affects search or routing, so an ATM is still a
   * perfectly good destination at zoom level 1.
   */
  minor?: boolean
  tags?: string[]
}

export interface EdgeAttrSpec {
  stairs?: boolean
  stepFree?: boolean
  shaded?: boolean
  lit?: boolean
  /** 0..1. Out-of-range values are a validation error, not a clamp. */
  crowd?: number
  /** `paved` | `covered` | `gravel` | `grass` | `stairs`. Unknown → `bad-surface`. */
  surface?: string
  /** rise/run as a signed fraction. */
  slope?: number
}

export interface EdgeSpec {
  id: string
  from: string
  to: string
  /** Omit to derive from node coordinates and `canvas.pixelsPerMetre`. */
  metres?: number
  oneWay?: boolean
  attrs?: EdgeAttrSpec
}

export interface BuildingSpec {
  id: string
  label: string
  zone?: string
  /**
   * Closed ring of world-space points, no repeated last vertex. Each entry is an
   * `[x, y]` pair — arity is checked, not typed, because JSON proves only
   * `number[]`. Fewer than three points, or a ragged point, is issue `bad-ring`.
   */
  footprint: number[][]
  /** Vertices that put you inside this building when routed to it. */
  entryNodeIds: string[]
  levels?: number
}

/** Non-building ground: lawn, water, plaza, car park. Render only, never routed. */
export interface SurfaceSpec {
  id: string
  label: string
  /** `lawn` | `water` | `plaza` | `parking` | `construction`. Unknown → `bad-surface`. */
  kind: string
  /** Same shape as `BuildingSpec.footprint`: `[x, y]` pairs, checked not typed. */
  ring: number[][]
}

export interface CampusFile {
  schemaVersion: string
  metadata: CampusMetadata
  canvas: CanvasSpec
  zones: ZoneSpec[]
  nodes: NodeSpec[]
  edges: EdgeSpec[]
  buildings: BuildingSpec[]
  surfaces: SurfaceSpec[]
}
