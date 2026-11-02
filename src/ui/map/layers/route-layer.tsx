/**
 * The route: one indigo line over the walkways, a green disc where the walk starts, a coral ring where it ends.
 *
 * Coordinates are world units, so the line follows the same camera as everything it lies on top of, and the
 * stroke is `vector-effect: non-scaling-stroke` (`map.css`) like a walkway's: 4 px at fit, 4 px zoomed in. The
 * pins cannot work that way — a pin is 13 *pixels* and a pixel is not a world unit — so they take the marker
 * layer's trick instead: `translate(x y) scale(unitsPerPx)` and children written in pixels.
 *
 * Start and destination differ by **shape** as well as colour. A solid disc and a ring survive a projector, a
 * printed handout and colour-blindness; two dots of the same size in two greens do not.
 *
 * The plan is not memoised. `planRoute` walks the route's vertices — single digits of them on this campus —
 * and this layer re-renders on every camera frame, where a `useMemo` would cost more bookkeeping than the loop
 * it skips. The geometry it does care about is all in `route-plan.ts`, which is tested without a DOM.
 */
import { memo } from 'react'
import { planRoute } from '../route-plan'
import type { Px } from '../view'

export interface RouteLayerProps {
  /** `RouteResult.nodeIds`, in walking order. */
  readonly nodeIds: readonly string[]
  /** id → world position: the same lookup the walkway layer draws from. */
  readonly positions: ReadonlyMap<string, Px>
  readonly unitsPerPx: number
  /** The three strings the line cannot know: how it was found, and what it connects. */
  readonly algorithmLabel: string
  readonly startLabel: string
  readonly destinationLabel: string
  readonly metres: number
}

/** Pin radius in CSS pixels, on the badge layer's scale rather than the walkway's stroke widths. */
const PIN_PX = 6.5
const EYE_PX = 2.4

function pointsAttr(points: readonly Px[]): string {
  return points.map((point) => `${String(point.x)},${String(point.y)}`).join(' ')
}

/**
 * Two circles and a variant class: the JSX is identical for start and destination, and every difference between
 * them — filled disc against open ring, which colour sits where — lives in `map.css`. A pin whose shape is a CSS
 * rule is a pin that can be retuned for a projector without touching the layer.
 */
function Pin({ at, unitsPerPx, variant, label }: { at: Px; unitsPerPx: number; variant: 'start' | 'end'; label: string }) {
  return (
    <g
      className={`route-pin route-pin--${variant}`}
      transform={`translate(${String(at.x)} ${String(at.y)}) scale(${String(unitsPerPx)})`}
      aria-label={label}
    >
      <circle className="route-pin-shape" r={PIN_PX} />
      <circle className="route-pin-eye" r={EYE_PX} />
    </g>
  )
}

function RouteLayerBase({
  nodeIds,
  positions,
  unitsPerPx,
  algorithmLabel,
  startLabel,
  destinationLabel,
  metres,
}: RouteLayerProps) {
  const plan = planRoute(nodeIds, positions)
  const line = plan.points.length > 1 ? pointsAttr(plan.points) : ''
  const samePlace = plan.samePlace

  return (
    <g
      className="layer-route"
      role="img"
      aria-label={`Route from ${startLabel} to ${destinationLabel}, ${String(Math.round(metres * 10) / 10)} metres, ${nodeIds.length} places along, by ${algorithmLabel}${
        line === '' ? ' (the line could not be drawn on this map)' : ''
      }`}
    >
      {line === '' ? null : (
        <>
          {/* Casing under fill, in the walkway layer's manner: where the route crosses a path it follows
              closely, the plate-coloured halo is what keeps the two from merging into one ribbon. */}
          <polyline className="route-halo" points={line} />
          <polyline className="route-line" points={line} />
        </>
      )}
      {plan.start === null ? null : (
        <Pin at={plan.start} unitsPerPx={unitsPerPx} variant="start" label={`Start: ${startLabel}`} />
      )}
      {/* One pin when the walk is nowhere: two stacked pins of different colours would read as a route
          between two places that are a metre apart. */}
      {plan.end === null || samePlace ? null : (
        <Pin at={plan.end} unitsPerPx={unitsPerPx} variant="end" label={`Destination: ${destinationLabel}`} />
      )}
    </g>
  )
}

export const RouteLayer = memo(RouteLayerBase)
