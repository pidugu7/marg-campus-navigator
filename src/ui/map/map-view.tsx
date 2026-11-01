/**
 * The campus: one SVG, one camera, four layers.
 *
 * The whole design rests on a single decision — **panning and zooming never touch the geometry.** The camera
 * lives in the `<svg>`'s `viewBox`, so dragging the campus mutates one attribute and React re-renders the
 * layers not at all (they are `memo`'d and their props are the dataset, which does not change). A
 * `transform` on a group would have worked too; a `viewBox` is better here because the *scale* is then
 * part of the SVG's own coordinate system, which is what `vector-effect: non-scaling-stroke` and font sizes
 * in world units both need.
 *
 * Layer order is the map's argument: ground, buildings, walkways, nodes. Anything drawn later can be
 * clicked earlier, and a route overlay (Phase 3) slots in between walkways and nodes — above the paths it
 * follows, below the dots a person aims for.
 */
import { useMemo, useRef } from 'react'
import { Maximize, Minus, Plus } from 'lucide-react'
import type { BuildingSpec, CampusModel, CanvasSpec, SurfaceSpec, ZoneSpec } from '@/data'
import { BaseLayer } from './layers/base-layer'
import { BuildingLayer } from './layers/building-layer'
import { NodeLayer } from './layers/node-layer'
import { WalkwayLayer } from './layers/walkway-layer'
import { useViewport } from './use-viewport'
import { extentOf } from './view'

export interface MapViewProps {
  readonly model: CampusModel
  readonly canvas: CanvasSpec
  readonly buildings: readonly BuildingSpec[]
  readonly surfaces: readonly SurfaceSpec[]
  readonly zones: readonly ZoneSpec[]
  /** Background grid spacing, in world units. Comes from the canvas' scale, not from this component. */
  readonly gridStep: number
}

const UNZONED = 'var(--walk-case)'

export function MapView({ model, canvas, buildings, surfaces, zones, gridStep }: MapViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const extent = useMemo(() => extentOf(canvas), [canvas])
  const viewport = useViewport(extent.width, extent.height, svgRef)

  const positions = useMemo(
    () => new Map(model.nodes.map((node) => [node.id, { x: node.x, y: node.y }])),
    [model],
  )
  const zoneColours = useMemo(() => new Map(zones.map((zone) => [zone.id, zone.color])), [zones])
  const colourFor = useMemo(
    () => (zone: string | undefined) => (zone === undefined ? UNZONED : zoneColours.get(zone) ?? UNZONED),
    [zoneColours],
  )

  // Zoom-staged detail: node dots grow a little when you are close enough to aim at them. The threshold is
  // a ratio of the fit view rather than a pixel size, so a 360 px phone and a 1440 px laptop stage at the
  // same *physical* scale, not the same screen size.
  const detailed = viewport.scale > 1.9
  const zoomPct = Math.round(viewport.scale * 100)

  return (
    <div className="map-frame">
      <svg
        ref={svgRef}
        className={viewport.dragging ? 'map map--dragging' : 'map'}
        viewBox={viewport.viewBox}
        role="application"
        aria-label={`Campus map: ${model.summary.nodeCount} nodes and ${model.summary.edgeCount} walkway segments. Drag to pan, scroll or pinch to zoom, arrow keys to move, plus and minus to zoom, 0 to reset.`}
        tabIndex={0}
        {...viewport.bindings}
      >
        <BaseLayer
          width={extent.width}
          height={extent.height}
          gridStep={gridStep}
          surfaces={surfaces}
          surfaceClass={(kind) => `surface--${kind}`}
        />
        <BuildingLayer buildings={buildings} colourFor={colourFor} />
        <WalkwayLayer edges={model.edges} positions={positions} />
        <NodeLayer nodes={model.nodes} colourFor={colourFor} detailed={detailed} />
      </svg>

      <div className="map-controls">
        <button
          type="button"
          className="map-btn"
          onClick={() => viewport.zoomBy(1.35)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="map-btn"
          onClick={() => viewport.zoomBy(1 / 1.35)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="map-btn"
          onClick={viewport.reset}
          disabled={viewport.fitted}
          title="Reset view"
          aria-label="Reset view to fit the campus"
        >
          <Maximize size={16} aria-hidden="true" />
        </button>
      </div>

      <p className="map-hud">
        <span>
          <b>{zoomPct}%</b> · 1 unit = 1 m
        </span>
        <span>
          {model.summary.edgeCount} segments · {model.summary.totalMetres} m
        </span>
        <span className="map-hint">drag to pan · wheel or pinch to zoom · 0 resets</span>
      </p>
    </div>
  )
}
