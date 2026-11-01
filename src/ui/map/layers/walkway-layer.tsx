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
import type { Px } from '../view'

export interface WalkwayLayerProps {
  readonly edges: readonly GraphEdge[]
  readonly positions: ReadonlyMap<string, Px>
}

function WalkwayLayerBase({ edges, positions }: WalkwayLayerProps) {
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
        {drawable.map(({ edge, from, to }) => (
          <line
            key={edge.id}
            className={`walk-fill ${styleFor(edge)}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
          >
            <title>{labelFor(edge)}</title>
          </line>
        ))}
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

/** The browser's own tooltip, for now: cheap, keyboard-reachable and it needs no tooltip layer. Phase 2's
 *  checkpoint 4 replaces it with the app's styled tooltip; the text is what both will show. */
function labelFor(edge: GraphEdge): string {
  const attrs = edge.attributes
  const notes = [`${Math.round(edge.metres * 10) / 10} m`]
  if (attrs.stairs) notes.push('stairs')
  if (attrs.stepFree) notes.push('step-free')
  if (attrs.shaded) notes.push('shaded')
  if (attrs.lit) notes.push('lit')
  if (attrs.surface !== 'paved') notes.push(attrs.surface)
  if (attrs.slope !== 0) notes.push(`${Math.round(attrs.slope * 100)}% grade`)
  return `${edge.from} → ${edge.to}: ${notes.join(', ')}`
}

export const WalkwayLayer = memo(WalkwayLayerBase)
