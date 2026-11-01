import { useMemo } from 'react'
import { campus, campusMeta } from '@/data'
import type { CanvasSpec, CampusMetadata, DataStatus } from '@/data'

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
}

/**
 * Read-only view of the campus dataset.
 *
 * The dataset is a static import, so there is nothing async here and no loading
 * state to manage — a deliberate consequence of "no backend". Phase 2 adds the
 * memoised `buildGraph(campus)` call to this hook, which is why map code will
 * ask this hook for the graph instead of importing it.
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
    }
  }, [])
}
