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

export interface BuildingLayerProps {
  readonly buildings: readonly BuildingSpec[]
  /** Zone id → colour. Absent means the building is unzoned, and `missing-zone` already said so. */
  readonly colourFor: (zone: string | undefined) => string
}

function BuildingLayerBase({ buildings, colourFor }: BuildingLayerProps) {
  return (
    <g className="layer-buildings">
      {buildings.map((building) => {
        const colour = colourFor(building.zone)
        return (
          <polygon
            key={building.id}
            className="building"
            points={building.footprint.map((pair) => `${pair[0] ?? 0},${pair[1] ?? 0}`).join(' ')}
            style={{ fill: colour, stroke: colour }}
          >
            <title>{`${building.label}${building.levels ? ` · ${building.levels} levels` : ''}`}</title>
          </polygon>
        )
      })}
    </g>
  )
}

export const BuildingLayer = memo(BuildingLayerBase)
