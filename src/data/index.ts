/**
 * The data layer's public surface.
 *
 * `campus.json` is loaded with a static import — never `fetch()`. Vite inlines
 * it into the bundle at build time, which is what makes the app work with no
 * backend, on a file server, and offline (the architecture test bans network
 * APIs in src/** to keep that true).
 */
import campusJson from './campus.json'
import type { CampusFile, DataStatus } from './campus.types'

export {
  MAP_ISSUE_CODES,
  MAP_SCHEMA_MAJOR,
  buildGraph,
  deriveMetres,
  formatCampusReport,
  isUsableId,
  validateCampusFile,
  type CampusModel,
  type CampusReport,
  type CampusSummary,
  type MapIssue,
  type MapIssueCode,
  type MapIssueSeverity,
} from './build-graph'

/** Typed at the boundary: the JSON has to satisfy the schema or the build fails. */
export const campus: CampusFile = campusJson

export const campusMeta = campusJson.metadata
export const canvasSpec = campusJson.canvas

/**
 * The only `metadata.dataStatus` values the app knows how to label. The raw
 * field stays a `string` (see campus.types.ts), so this list — not the compiler
 * — is what catches a hand-edited typo, and Phase 2's validator reports it.
 */
export const DATA_STATUSES: readonly DataStatus[] = ['synthetic-placeholder', 'digitised', 'surveyed']

/* The map draws graph values, and `GraphNode`/`GraphEdge` are the engine's types. They are re-exported
   here rather than imported by `src/ui/**` from `@/engine`, because the boundary this project is graded on
   is that a component's *every* cross-layer import names a barrel the architecture test has agreed to.
   The engine's barrel is where these types live (`export type * from './types'`), so this adds no new
   surface — it only keeps the direction of dependency one-way: ui -> data -> engine. */
export type { EdgeAttributes, GraphEdge, GraphNode, NodeId, NodeKind, ZoneId } from '@/engine'

/* The data layer's own contract, re-exported so a component can type a report without reaching
   past the barrel — `src/ui/**` is not allowed to import `./build-graph` directly any more than it
   may import `@/engine`. */
export type {
  BuildingSpec,
  CampusFile,
  CampusMetadata,
  CanvasSpec,
  DataStatus,
  EdgeAttrSpec,
  EdgeSpec,
  NodeSpec,
  SurfaceSpec,
  ZoneSpec,
} from './campus.types'
