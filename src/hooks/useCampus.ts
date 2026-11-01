import { useMemo } from 'react'
import { buildGraph, campus, campusMeta } from '@/data'
import type {
  BuildingSpec,
  CampusModel,
  CanvasSpec,
  CampusMetadata,
  DataStatus,
  NodeSpec,
  SurfaceSpec,
  ZoneSpec,
} from '@/data'

export interface CampusSummary {
  readonly meta: CampusMetadata
  readonly canvas: CanvasSpec
  /** `Amrita Vishwa Vidyapeetham · Bengaluru`, for headers and exports. */
  readonly title: string
  /**
   * Placeholder data is labelled as such in the UI rather than hidden. When the
   * digitised campus replaces campus.json this flips to `false` on its own,
   * because it reads the file's `dataStatus` instead of a hardcoded string.
   */
  readonly isPlaceholder: boolean
  readonly status: DataStatus
  /** Grid spacing for the map background, in world units. */
  readonly gridStep: number
  readonly nodeCount: number
  readonly edgeCount: number
  /**
   * The validated model: the graph the engine can route on, plus the report that says how much of the file
   * survived. Built once per module load and shared, because `buildGraph` is pure over a static import and
   * the map re-renders often.
   */
  readonly model: CampusModel
  /** Draw-only blocks from the file, handed over as they are: the map needs a footprint, not an edge. */
  readonly nodes: readonly NodeSpec[]
  readonly buildings: readonly BuildingSpec[]
  readonly surfaces: readonly SurfaceSpec[]
  readonly zones: readonly ZoneSpec[]
}

/**
 * The campus dataset, and the only door the UI has to it.
 *
 * Three things live here that are not merely convenient:
 *
 * - `buildGraph(campus)` is memoised on an empty dependency list. The data is a static import, so it is
 *   fixed for the life of the module, and running the validator per render would be pure waste — this is
 *   the one call where "no backend" turns into a saving rather than a limitation.
 * - The report travels with the graph. A map that hides the fact that three edges were dropped is a map
 *   that will be debugged by eye; the counts and the issue list are exposed so the shell can say it out loud.
 * - Components receive the *file's* rows for the draw-only blocks (`buildings`, `surfaces`, `zones`) and
 *   the model's rows for geometry that the graph agrees to (`model.nodes`, `model.edges`). Which is to say:
 *   draw what was validated, style what was only drawn.
 */
export function useCampus(): CampusSummary {
  return useMemo(() => {
    const status: DataStatus =
      campusMeta.dataStatus === 'digitised' || campusMeta.dataStatus === 'surveyed'
        ? campusMeta.dataStatus
        : 'synthetic-placeholder'

    return {
      meta: campusMeta,
      canvas: campus.canvas,
      title: `${campusMeta.campus} · ${campusMeta.location.city}`,
      isPlaceholder: status === 'synthetic-placeholder',
      status,
      gridStep: Math.max(5, 10 / Math.max(campus.canvas.pixelsPerMetre, 0.001)),
      nodeCount: campus.nodes.length,
      edgeCount: campus.edges.length,
      model: buildGraph(campus),
      nodes: campus.nodes,
      buildings: campus.buildings,
      surfaces: campus.surfaces,
      zones: campus.zones,
    }
  }, [])
  // No deps on purpose: `campus` is a module-level import, so this memo is computed exactly once per load.
}
