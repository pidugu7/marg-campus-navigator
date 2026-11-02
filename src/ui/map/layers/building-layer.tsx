/**
 * Academic blocks, hostels and the rest, as zone-coloured footprints.
 *
 * Buildings are filled with their zone's colour at a low alpha and stroked with the same colour at full
 * strength, so the *shape* is legible before the label is: that is what makes the campus readable at fit
 * zoom, where no label fits. The colour comes from the data file rather than CSS, which is what lets
 * `campus.json` be recoloured — or replaced by a real campus — with no code change.
 */
import { memo } from 'react'
import type { BuildingSpec } from '@/data'
import { buildingTip } from '../tip-content'
import { tipHandlers, type TipAnchor, type Tooltip } from '../use-tooltip'

export interface BuildingLayerProps {
  readonly buildings: readonly BuildingSpec[]
  /** Zone id → colour. Absent means the building is unzoned, and `missing-zone` already said so. */
  readonly colourFor: (zone: string | undefined) => string
  readonly zoneLabelFor: (zone: string | undefined) => string | undefined
  readonly nodeLabel: (id: string) => string
  readonly toScreen: (x: number, y: number) => TipAnchor
  readonly tooltip: Tooltip
}

function BuildingLayerBase({
  buildings,
  colourFor,
  zoneLabelFor,
  nodeLabel,
  toScreen,
  tooltip,
}: BuildingLayerProps) {
  return (
    <g className="layer-buildings">
      {buildings.map((building) => {
        const colour = colourFor(building.zone)
        const centroid = ringCentroid(building.footprint)
        const handlers = tipHandlers({
          id: building.id,
          screen: () => toScreen(centroid.x, centroid.y),
          content: () => buildingTip(building, { zoneLabel: zoneLabelFor(building.zone), labelFor: nodeLabel }),
          show: tooltip.show,
          hide: tooltip.hide,
        })
        return (
          <polygon
            key={building.id}
            className={tooltip.tip?.id === building.id ? 'building building--active' : 'building'}
            points={building.footprint.map((pair) => `${pair[0] ?? 0},${pair[1] ?? 0}`).join(' ')}
            style={{ fill: colour, stroke: colour }}
            {...handlers}
          />
        )
      })}
    </g>
  )
}

/**
 * Average of the ring's vertices — where the tooltip points, and nothing more. A true area centroid is the
 * wrong tool here: it can land outside a concave L-shaped block, which is exactly where a reader would not
 * expect the label to hang.
 */
function ringCentroid(ring: readonly number[][]): TipAnchor {
  const points = ring.length === 0 ? [[0, 0]] : ring
  let x = 0
  let y = 0
  for (const pair of points) {
    x += pair[0] ?? 0
    y += pair[1] ?? 0
  }
  return { x: x / points.length, y: y / points.length }
}

export const BuildingLayer = memo(BuildingLayerBase)
