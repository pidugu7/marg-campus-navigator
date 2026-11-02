/**
 * Walkways, drawn as two passes: every casing under every fill.
 *
 * Drawing each segment as a paired (casing, fill) would let the next segment's casing paint over the
 * previous segment's fill, so junctions would show grey slivers. Two groups means the casings merge into
 * one continuous outline, which is what a map reader expects at a crossing.
 *
 * Stroke widths use `vector-effect: non-scaling-stroke` (see `map.css`), so a walkway is 3 px on screen
 * whether you are looking at the whole campus or at one building. The alternative — a width in world
 * units — looks right at fit and turns every path into a motorway when you zoom in.
 */
import { memo } from 'react'
import type { GraphEdge } from '@/data'
import { edgeTip } from '../tip-content'
import { tipHandlers, type TipAnchor, type Tooltip } from '../use-tooltip'
import type { Px } from '../view'

export interface WalkwayLayerProps {
  readonly edges: readonly GraphEdge[]
  readonly positions: ReadonlyMap<string, Px>
  /** Node id → the label to show. The layer must not look inside the node list for one string. */
  readonly labels: ReadonlyMap<string, string>
  readonly toScreen: (x: number, y: number) => TipAnchor
  readonly tooltip: Tooltip
}

/** A segment is described at its midpoint: that is where a finger or a cursor is most likely to be, and
 *  unlike the ends it is inside the thing being named. */
function WalkwayLayerBase({ edges, positions, labels, toScreen, tooltip }: WalkwayLayerProps) {
  const drawable = edges.flatMap((edge) => {
    const from = positions.get(edge.from)
    const to = positions.get(edge.to)
    // A missing endpoint means the row was dropped by the validator, and its `unknown-ref` line already
    // named it. Drawing a segment to (0,0) would put a phantom path across the campus entrance.
    if (!from || !to) return []
    return [{ edge, from, to }]
  })

  return (
    <g className="layer-walkways">
      <g className="walk-casings">
        {drawable.map(({ edge, from, to }) => (
          <line
            key={edge.id}
            className={`walk-case ${styleFor(edge)}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
          />
        ))}
      </g>
      <g className="walk-fills">
        {drawable.map(({ edge, from, to }) => {
          const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
          const content = () =>
            edgeTip(edge, {
              from: labels.get(edge.from) ?? edge.from,
              to: labels.get(edge.to) ?? edge.to,
            })
          const handlers = tipHandlers({
            id: edge.id,
            screen: () => toScreen(middle.x, middle.y),
            content,
            show: tooltip.show,
            hide: tooltip.hide,
          })
          return (
            <g key={edge.id} className={tooltip.tip?.id === edge.id ? 'walk marker--active' : 'walk'} {...handlers}>
              <line className={`walk-fill ${styleFor(edge)}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
              {/* The casing is the hit area — 6 px of visible stroke, no invisible twin per segment. On a
                  phone a walkway is not a tap target you aim at, which is why the places get 32 px and the
                  segments do not: this describes, it does not navigate. */}
              <line className="walk-hit" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
            </g>
          )
        })}
      </g>
    </g>
  )
}

function styleFor(edge: GraphEdge): string {
  const classes: string[] = []
  if (edge.attributes.stairs) classes.push('walk--stairs')
  if (edge.attributes.surface === 'grass') classes.push('walk--grass')
  if (edge.attributes.surface === 'gravel') classes.push('walk--gravel')
  if (edge.attributes.shaded) classes.push('walk--shaded')
  if (edge.oneWay) classes.push('walk--oneway')
  return classes.join(' ')
}

export const WalkwayLayer = memo(WalkwayLayerBase)
