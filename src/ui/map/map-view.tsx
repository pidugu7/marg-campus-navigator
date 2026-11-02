/**
 * The campus: one SVG, one camera, six layers.
 *
 * The whole design rests on a single decision — **panning and zooming never touch the geometry.** The camera
 * lives in the `<svg>`'s `viewBox`, so dragging the campus mutates one attribute and the four data layers
 * (`memo`'d over a dataset that does not change) re-render zero times per frame. The one exception is the
 * marker layer, which must re-derive sizes because a badge is 26 *pixels*; that is the deliberate cost of a
 * readable map, and it is paid for ~20 places rather than for 56 walkways. The route layer joins that exception:
 * its pins are pixels too, so it re-derives on a camera frame — for a path of nine vertices, which is what a
 * route is, and not for the walkways underneath it.
 *
 * Layer order is the map's argument: ground, buildings, walkways, route, dots, markers. Anything drawn later
 * can be reached earlier, and the route sits between walkways and dots for both reasons at once — it must be
 * *above* the paths it follows, or it is invisible at every crossing, and *below* the places a person aims
 * for, because a pin you cannot see is a destination you cannot confirm.
 *
 * This file is also where the two coordinate systems meet. `viewBox` and the plan speak screen pixels; the
 * SVG speaks world units. `unitsPerPx` and `toScreen` are the only two conversions, and keeping them here
 * rather than inside each layer is what lets `marker-plan.ts` be tested without a DOM.
 */
import { useMemo, useRef } from 'react'
import { Maximize, Minus, Plus } from 'lucide-react'
import { DEFAULT_EDGE_ATTRIBUTES } from '@/data'
import type { BuildingSpec, CampusModel, CanvasSpec, NodeSpec, SurfaceSpec, ZoneSpec } from '@/data'
import { ReplayLayer } from './layers/replay-layer'
import { RouteLayer } from './layers/route-layer'
import { BaseLayer } from './layers/base-layer'
import { BuildingLayer } from './layers/building-layer'
import { MarkerLayer, type MarkerEntry } from './layers/marker-layer'
import type { ReplayFrame } from './replay-plan'
import { NodeLayer } from './layers/node-layer'
import { WalkwayLayer } from './layers/walkway-layer'
import { legendIcons, iconFor } from './icons'
import { baselineWords } from './tip-content'
import { placeTip } from './tip-content'
import { planMarkers, markerPriority, type MarkerRequest } from './marker-plan'
import { MapLegend } from './map-legend'
import { MapTip } from './map-tip'
import { useTooltip } from './use-tooltip'
import { useViewport } from './use-viewport'
import { extentOf, worldPerPixel, worldToScreen } from './view'

export interface MapViewProps {
  readonly model: CampusModel
  readonly canvas: CanvasSpec
  /** The file's node rows, for the two draw-only flags: `minor` and `category`. */
  readonly placeRows: readonly NodeSpec[]
  readonly buildings: readonly BuildingSpec[]
  readonly surfaces: readonly SurfaceSpec[]
  readonly zones: readonly ZoneSpec[]
  /** Background grid spacing, in world units. Comes from the canvas' scale, not from this component. */
  readonly gridStep: number
  /**
   * The route to draw over the walkways, or `null` for none. Shaped like this rather than like a `RouteResult`
   * because the map needs four numbers and a list of ids, and is not allowed to know that a search exists: the
   * caller (`App`) unpacks the hook's result here, which is the one place the two halves are allowed to meet.
   */
  readonly route?: MapViewRoute | null
  /**
   * One frame of a search replay, or nothing. It is a *frame* and not a state: the map has no clock, and the
   * panel that owns the clock is beside it. `null` means the map draws no overlay, which is the normal case.
   */
  readonly replay?: ReplayFrame | null
}

/** What the route layer needs, in the map's own vocabulary. */
export interface MapViewRoute {
  readonly nodeIds: readonly string[]
  readonly algorithmLabel: string
  readonly startLabel: string
  readonly destinationLabel: string
  readonly metres: number
}

const UNZONED = 'var(--walk-case)'

export function MapView({ model, canvas, placeRows, buildings, surfaces, zones, gridStep, route, replay }: MapViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const extent = useMemo(() => extentOf(canvas), [canvas])
  const viewport = useViewport(extent.width, extent.height, svgRef)
  const { plate, box, view, aspect } = viewport
  const tooltip = useTooltip(plate.height)

  const positions = useMemo(() => new Map(model.nodes.map((node) => [node.id, { x: node.x, y: node.y }])), [model])
  const labels = useMemo(() => new Map(model.nodes.map((node) => [node.id, node.label])), [model])
  const nodeById = useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model])
  const zoneColours = useMemo(() => new Map(zones.map((zone) => [zone.id, zone.color])), [zones])
  const zoneLabels = useMemo(() => new Map(zones.map((zone) => [zone.id, zone.label])), [zones])
  const colourFor = useMemo(
    () => (zone: string | undefined) => (zone === undefined ? UNZONED : zoneColours.get(zone) ?? UNZONED),
    [zoneColours],
  )
  const zoneLabelFor = useMemo(
    () => (zone: string | undefined) => (zone === undefined ? undefined : zoneLabels.get(zone)),
    [zoneLabels],
  )

  // Segments per node, counted from the edge list rather than asked of the graph: the map is allowed to
  // know how many walkways meet at a place, and is not allowed to reach into `@/engine` to find out.
  const degrees = useMemo(() => {
    const counts = new Map<string, number>()
    for (const edge of model.edges) {
      counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1)
      counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1)
    }
    return counts
  }, [model])

  const minorIds = useMemo(
    () => new Set(placeRows.filter((row) => row.minor === true).map((row) => row.id)),
    [placeRows],
  )
  const categoryOf = useMemo(() => {
    const map = new Map<string, string | undefined>()
    for (const row of placeRows) map.set(row.id, row.category)
    return map
  }, [placeRows])

  const unitsPerPx = worldPerPixel(view.span, plate.width)
  const toScreen = useMemo(
    () => (x: number, y: number) => worldToScreen(view, plate, aspect, x, y),
    [view, plate, aspect],
  )

  // Only places, gates and entrances compete for labels: a junction has no name worth reading, and giving
  // it one would take the space a building needs.
  const requests = useMemo<readonly MarkerRequest[]>(
    () =>
      model.nodes
        .filter((node) => node.kind !== 'junction')
        .map((node) => ({
          id: node.id,
          x: node.x,
          y: node.y,
          text: node.label,
          priority: markerPriority(node.kind, minorIds.has(node.id)),
          wantsBadge: iconFor(categoryOf.get(node.id), node.kind) !== undefined,
        })),
    [model, minorIds, categoryOf],
  )
  const plan = useMemo(() => planMarkers(requests, { plate, box }), [requests, plate, box])

  const entries = useMemo<readonly MarkerEntry[]>(
    () =>
      plan.markers.flatMap((marker) => {
        // Every marker id came out of `model.nodes` a few lines above, so a missing node here would mean the
        // plan invented one; `flatMap` drops it rather than substituting a plausible-looking fallback.
        const node = nodeById.get(marker.id)
        if (node === undefined) return []
        const spec = iconFor(categoryOf.get(node.id), node.kind)
        const degree = degrees.get(node.id) ?? 0
        const zoneLabel = zoneLabelFor(node.zone)
        const content = placeTip(node, { zoneLabel, categoryLabel: spec?.title, degrees: degree })
        const name = `${node.label}, ${node.kind}${zoneLabel === undefined ? '' : `, ${zoneLabel} zone`}, ${degree} walkway segment${degree === 1 ? '' : 's'}`
        return [
          {
            marker,
            spec,
            colour: colourFor(node.zone),
            name,
            content,
          },
        ]
      }),
    [plan, nodeById, categoryOf, degrees, zoneLabelFor, colourFor],
  )

  const iconRows = useMemo(() => {
    const categories = new Set<string>()
    // A node with a category is explained by that category's row; one without is explained by its kind.
    // Same rule as `iconFor`'s lookup, applied to the legend so it lists exactly the glyphs on the plate.
    const kinds = new Set<string>()
    for (const row of placeRows) {
      if (typeof row.category === 'string' && row.category !== '') categories.add(row.category)
      else kinds.add(row.kind)
    }
    return legendIcons(categories, kinds)
  }, [placeRows])
  const baseline = useMemo(() => baselineWords(DEFAULT_EDGE_ATTRIBUTES), [])

  return (
    // Tapping anything that is not a marker — the legend, the zoom buttons, the plate's own ground — closes
    // the open tooltip. The items stop propagation on their own `pointerdown`, which is what separates
    // "tap a place" from "tap near a place" without any hit-testing here.
    <div className="map-frame" onPointerDown={() => tooltip.hide()}>
      <svg
        ref={svgRef}
        className={viewport.dragging ? 'map map--dragging' : 'map'}
        viewBox={viewport.viewBox}
        role="application"
        aria-label={`Campus map: ${model.summary.placeCount} places over ${model.summary.edgeCount} walkway segments. Drag to pan, scroll or pinch to zoom, arrow keys to move, plus and minus to zoom, 0 to reset. Each place can be tabbed to for its details.${
          route ? ` A route from ${route.startLabel} to ${route.destinationLabel} is drawn on top of the walkways.` : ''
        }`}
        tabIndex={0}
        {...viewport.bindings}
        onPointerDown={(event) => {
          // Tapping the ground closes whatever is open, then hands the gesture to the camera: one press,
          // two meanings, and the marker's own handler stops the first from cancelling the second's target.
          tooltip.hide()
          viewport.bindings.onPointerDown(event)
        }}
        onKeyDown={(event) => {
          tooltip.onEscape(event)
          viewport.bindings.onKeyDown(event)
        }}
      >
        <BaseLayer
          width={extent.width}
          height={extent.height}
          gridStep={gridStep}
          surfaces={surfaces}
          surfaceClass={(kind) => `surface--${kind}`}
        />
        <BuildingLayer
          buildings={buildings}
          colourFor={colourFor}
          zoneLabelFor={zoneLabelFor}
          nodeLabel={(id) => labels.get(id) ?? id}
          toScreen={toScreen}
          tooltip={tooltip}
        />
        <WalkwayLayer
          edges={model.edges}
          positions={positions}
          labels={labels}
          toScreen={toScreen}
          tooltip={tooltip}
        />
        {/* Below the answer, above the walkways: the explored region is the search's own footprint, and the
            route is what the footprint produced. Drawing it over the line would let the lesson hide the
            conclusion. */}
        {replay ? <ReplayLayer frame={replay} positions={positions} unitsPerPx={unitsPerPx} /> : null}
        {route ? (
          <RouteLayer
            nodeIds={route.nodeIds}
            positions={positions}
            unitsPerPx={unitsPerPx}
            algorithmLabel={route.algorithmLabel}
            startLabel={route.startLabel}
            destinationLabel={route.destinationLabel}
            metres={route.metres}
          />
        ) : null}
        <NodeLayer nodes={model.nodes} colourFor={colourFor} detailed={viewport.scale > 1.9} />
        <MarkerLayer
          entries={entries}
          unitsPerPx={unitsPerPx}
          toScreen={toScreen}
          tooltip={tooltip}
        />
      </svg>

      <MapTip tip={tooltip.tip} plateWidth={plate.width} />

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

      <MapLegend
        zones={zones}
        icons={iconRows}
        baseline={baseline}
        counts={{
          places: model.summary.placeCount,
          buildings: model.summary.buildingCount,
          surfaces: model.summary.surfaceCount,
          segments: model.summary.edgeCount,
          metres: model.summary.totalMetres,
          components: model.summary.componentCount,
        }}
        hiddenMarkers={plan.hiddenMarkers}
        hiddenLabels={plan.hiddenLabels}
        scalePct={Math.round(viewport.scale * 100)}
        narrow={plate.width > 0 && plate.width < 700}
      />
    </div>
  )
}
