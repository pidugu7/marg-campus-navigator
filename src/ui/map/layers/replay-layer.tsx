/**
 * The explored region, one settled vertex at a time.
 *
 * This layer owns nothing: it is drawn from a `ReplayFrame`, which `replay-plan.ts` builds from the two arrays a
 * search already returns. That is the whole point of putting the overlay beside the route layer rather than in
 * it — the answer and the search are two different claims, and a map that shaded them with the same code would
 * eventually shade them with the same meaning.
 *
 * Sizes follow the marker layer's trick, not the walkway stroke: a dot is *pixels*, so each circle is a `<g>`
 * translated to the world position and scaled by `unitsPerPx`, with the radius written in screen units. Zooming
 * moves the campus; the dots stay the size that makes them legible.
 *
 * Colour is visit order (cyan first, violet last), so the eye reads growth rather than height. The frontier
 * pulses, because "still competing" is a temporary state and a static ring would read as "visited and done".
 * The route is drawn bold only on the last frame, which is the moment the search has actually earned it.
 */
import { visitColor } from '../replay-plan'
import type { ReplayFrame } from '../replay-plan'
import type { Px } from '../view'

/** Screen-unit radii: 4.2 px is a settled vertex, and the frontier ring sits just outside it. */
const NODE_R_PX = 4.2
const CURRENT_R_PX = 6.4
const FRONTIER_R_PX = 5.6

export interface ReplayLayerProps {
  readonly frame: ReplayFrame
  /** id → world position: the same lookup the walkway and route layers draw from. */
  readonly positions: ReadonlyMap<string, Px>
  readonly unitsPerPx: number
}

function Dot({
  at,
  unitsPerPx,
  radius,
  className,
  fill,
}: {
  at: Px
  unitsPerPx: number
  radius: number
  className: string
  fill?: string
}) {
  return (
    <g className={className} transform={`translate(${String(at.x)} ${String(at.y)}) scale(${String(unitsPerPx)})`}>
      <circle r={radius} {...(fill === undefined ? {} : { style: { fill } })} />
    </g>
  )
}

/**
 * The layer is `aria-hidden`: the panel beside the map says the same thing in words, on a live region, and an
 * SVG that announced "41 circles" on every frame would be worse than no announcement at all.
 */
export function ReplayLayer({ frame, positions, unitsPerPx }: ReplayLayerProps) {
  const seen = frame.visited
    .map((id, rank) => ({ id, at: positions.get(id), rank }))
    .filter((dot): dot is { id: string; at: Px; rank: number } => dot.at !== undefined)
  const frontier = frame.frontier
    .map((id) => ({ id, at: positions.get(id) }))
    .filter((dot): dot is { id: string; at: Px } => dot.at !== undefined)
  const current = frame.justSettled === null ? undefined : positions.get(frame.justSettled)
  // A path with a vertex the map cannot place draws *nothing*, in one piece, by the same rule `planRoute`
  // follows for the answer line: three points of a five-point route is not a route with a gap in it, it is a
  // different route. A missing *dot* is only a missing dot, so those are skipped one at a time above.
  const complete = frame.path.length > 1 && frame.path.every((id) => positions.has(id))
  const points = frame.finished && complete
    ? frame.path
        .map((id) => positions.get(id) as Px)
        .map((at) => `${String(at.x)},${String(at.y)}`)
        .join(' ')
    : ''

  return (
    <g className="layer-replay" aria-hidden="true">
      {points === '' ? null : <polyline className="replay-path" points={points} />}
      {seen.map((dot) => (
        <Dot
          key={dot.id}
          at={dot.at}
          unitsPerPx={unitsPerPx}
          radius={NODE_R_PX}
          className="replay-node"
          fill={visitColor(dot.rank, frame.total)}
        />
      ))}
      {frontier.map((dot) => (
        <Dot key={dot.id} at={dot.at} unitsPerPx={unitsPerPx} radius={FRONTIER_R_PX} className="replay-frontier" />
      ))}
      {current === undefined ? null : (
        <Dot at={current} unitsPerPx={unitsPerPx} radius={CURRENT_R_PX} className="replay-node--current" />
      )}
    </g>
  )
}
