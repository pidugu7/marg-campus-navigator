/**
 * Three routes on one plate, in three patterns, in three lanes.
 *
 * The hard part is not the dashes, it is coincidence: on this campus Dijkstra and A* walk the *same* walkways for
 * most pairs, so three lines with three styles drawn on one corridor would resolve to whichever was painted last.
 * Each algorithm therefore gets a fixed lateral lane — Dijkstra on the walkway, A* to a walker's left, BFS to the
 * right — and the pattern does the naming. Both come from `compare-plan.ts`, so the legend beside the map can
 * describe exactly what the layer is doing, in words.
 *
 * Like the replay and the pins, the layer is `aria-hidden`: the table says all of this better, and it is the
 * thing a reader can actually consult.
 *
 * The dash pattern arrives as `strokeDasharray`, in world units scaled by `unitsPerPx`, so a lane's rhythm is
 * the same number of pixels whether the reader is looking at the whole campus or at one quad. `stroke-dasharray`
 * in JSX would be dropped by React with a warning, and a static render would not tell anyone.
 */
import { dashArrayString, dashStyleOf, laneNameOf, offsetPxOf, shiftedSegment } from '@/ui/compare/compare-plan'
import type { CompareLane } from '@/ui/compare/compare-plan'
import type { Px } from '../view'

export interface CompareLayerProps {
  /** The three routes, projected to what a line needs — see `lanesOf`. */
  readonly lanes: readonly CompareLane[]
  readonly positions: ReadonlyMap<string, Px>
  readonly unitsPerPx: number
}

interface Stroke {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

export function CompareLayer({ lanes, positions, unitsPerPx }: CompareLayerProps) {
  const drawn = lanes
    .map((lane) => {
      const offset = offsetPxOf(lane.algorithm) * unitsPerPx
      const dashes = dashArrayString(dashStyleOf(lane.algorithm), unitsPerPx)
      // Per segment, not one polyline: a lane is only constant-width if each piece is offset along its own
      // normal, and round caps hide the joins.
      const strokes: Stroke[] = []
      for (let index = 0; index + 1 < lane.nodeIds.length; index++) {
        const from = positions.get(String(lane.nodeIds[index]))
        const to = positions.get(String(lane.nodeIds[index + 1]))
        if (from === undefined || to === undefined) continue
        const [x1, y1, x2, y2] = shiftedSegment(from, to, offset)
        strokes.push({ x1, y1, x2, y2 })
      }
      return { algorithm: lane.algorithm, dashes, strokes }
    })
    .filter((line) => line.strokes.length > 0)

  if (drawn.length === 0) return null
  return (
    <g className="layer-compare" aria-hidden="true">
      {drawn.map(({ algorithm, dashes, strokes }) => (
        <g key={algorithm} className={`compare-line compare-line--${algorithm}`} data-lane={laneNameOf(algorithm)}>
          {strokes.map((stroke, index) => (
            <line
              key={`${String(stroke.x1)}:${String(stroke.y1)}:${String(index)}`}
              x1={stroke.x1}
              y1={stroke.y1}
              x2={stroke.x2}
              y2={stroke.y2}
              {...(dashes === null ? {} : { strokeDasharray: dashes })}
            />
          ))}
        </g>
      ))}
    </g>
  )
}
