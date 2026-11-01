/**
 * The faded base: the plate, the survey grid, and the ground surfaces.
 *
 * Nothing here is routable — `surfaces` exist in the data for exactly one purpose, which is to make the
 * walkways legible as lines on top of lawn, water, plaza and car park. That is also why this layer is the
 * only one drawn at reduced opacity: it is context, and context that competes with the route is a bug.
 *
 * `memo` matters more here than it looks: pan and zoom change only the `<svg>`'s `viewBox`, so as long as
 * this component's props do not change, React re-renders zero polygons per frame.
 */
import { memo } from 'react'
import type { SurfaceSpec } from '@/data'

export interface BaseLayerProps {
  readonly width: number
  readonly height: number
  readonly gridStep: number
  readonly surfaces: readonly SurfaceSpec[]
  readonly surfaceClass: (kind: string) => string
}

/** `number[][]` is the file's shape, and a ragged ring is a *report* problem, not a render problem — so a
 *  polygon here tolerates a short ring instead of assuming the validator already ran. */
function pointsOf(ring: readonly number[][]): string {
  return ring.map((pair) => `${pair[0] ?? 0},${pair[1] ?? 0}`).join(' ')
}

function BaseLayerBase({ width, height, gridStep, surfaces, surfaceClass }: BaseLayerProps) {
  const majorStep = gridStep * 10
  return (
    <g className="layer-base">
      <defs>
        <pattern id="map-grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
          <path
            d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`}
            style={{ fill: 'none', stroke: 'var(--map-grid)', strokeWidth: 0.5 }}
          />
        </pattern>
        <pattern id="map-grid-major" width={majorStep} height={majorStep} patternUnits="userSpaceOnUse">
          <path
            d={`M ${majorStep} 0 L 0 0 0 ${majorStep}`}
            style={{ fill: 'none', stroke: 'var(--map-grid-major)', strokeWidth: 1 }}
          />
        </pattern>
      </defs>

      <rect x={0} y={0} width={width} height={height} className="map-paper" />
      <rect x={0} y={0} width={width} height={height} fill="url(#map-grid)" />
      <rect x={0} y={0} width={width} height={height} fill="url(#map-grid-major)" />

      <g className="surfaces">
        {surfaces.map((surface) => (
          <polygon key={surface.id} className={`surface ${surfaceClass(surface.kind)}`} points={pointsOf(surface.ring)} />
        ))}
      </g>
    </g>
  )
}

export const BaseLayer = memo(BaseLayerBase)
