/**
 * Badges and labels — the layer that *does* re-render when the camera moves, and the only one allowed to.
 *
 * A dot can scale with the map; a 16 px icon and an 11 px word cannot, or they are a speck when zoomed out
 * and a billboard when zoomed in. So every size here is a CSS-pixel constant multiplied by `unitsPerPx`,
 * which changes with the camera, and that is the whole reason this file exists next to `marker-plan.ts`
 * rather than inside it: the plan decides *who* is drawn, in screen space; this converts that decision back
 * into world coordinates for the SVG.
 *
 * The badge is centred on the node with `transform="translate(x y) scale(unitsPerPx)"`, so its children are
 * written in pixels (`r={13}`, `size={16}`) and need no multiplying at all. That is also why the Lucide icon
 * is a nested `<svg>`: it brings its own 24-unit viewBox, so the glyph stays crisp whatever the map's scale.
 *
 * Keyboard: each marker is focusable, and focus shows the same tooltip hover does. No `role="button"`,
 * because clicking one does nothing yet — a control that lies about what it does is worse than a group that
 * can be read. Phase 5's search will make markers clickable, and the role will arrive with the action.
 */
import { memo } from 'react'
import { BADGE_PX, GAP_PX, HIT_PX, LABEL_FONT_PX, type PlacedMarker } from '../marker-plan'
import { tipHandlers, type TipAnchor, type Tooltip } from '../use-tooltip'
import type { TipContent } from '../tip-content'
import type { IconSpec } from '../icons'

export interface MarkerEntry {
  readonly marker: PlacedMarker
  readonly spec: IconSpec | undefined
  /** The zone whose colour the badge is drawn in, resolved by the caller: this layer never looks up ids. */
  readonly colour: string
  /** What a screen reader says. The tooltip is the visual half of the same sentence. */
  readonly name: string
  readonly content: TipContent
}

export interface MarkerLayerProps {
  readonly entries: readonly MarkerEntry[]
  readonly unitsPerPx: number
  readonly toScreen: (x: number, y: number) => TipAnchor
  readonly tooltip: Tooltip
}

/** Below the badge box's top edge by the cap height plus a hair, so the halo hugs the glyphs. */
const LABEL_BASELINE = LABEL_FONT_PX * 0.82
const ICON_PX = 16

function labelX(marker: PlacedMarker, unitsPerPx: number): number {
  if (marker.anchor === 'start') return marker.x - (BADGE_PX / 2) * unitsPerPx
  if (marker.anchor === 'end') return marker.x + (BADGE_PX / 2) * unitsPerPx
  return marker.x
}

function MarkerLayerBase({ entries, unitsPerPx, toScreen, tooltip }: MarkerLayerProps) {
  return (
    <g className="layer-markers">
      {entries.map((entry) => {
        const { marker, spec } = entry
        const handlers = tipHandlers({
          id: marker.id,
          screen: () => toScreen(marker.x, marker.y),
          content: () => entry.content,
          show: tooltip.show,
          hide: tooltip.hide,
        })
        const active = tooltip.tip?.id === marker.id
        const badgeOffset = (BADGE_PX / 2 + GAP_PX) * unitsPerPx
        return (
          <g
            key={marker.id}
            className={active ? 'marker marker--active' : 'marker'}
            tabIndex={0}
            aria-label={entry.name}
            aria-describedby={active ? 'map-tip' : undefined}
            {...handlers}
          >
            {/* The tap target is bigger than the picture and invisible: 32 px of finger room around a
                26 px badge, both multiples of the 4 px grid. */}
            <circle className="marker-hit" cx={marker.x} cy={marker.y} r={(HIT_PX / 2) * unitsPerPx} />
            {spec === undefined || !marker.showBadge ? null : (
              <g
                className="badge"
                transform={`translate(${marker.x} ${marker.y}) scale(${unitsPerPx})`}
                style={{ color: entry.colour }}
              >
                <circle className="badge-plate" r={BADGE_PX / 2} />
                <spec.icon size={ICON_PX} strokeWidth={1.9} x={-ICON_PX / 2} y={-ICON_PX / 2} aria-hidden="true" />
              </g>
            )}
            {marker.showLabel ? (
              <text
                className="marker-label"
                x={labelX(marker, unitsPerPx)}
                y={marker.y + (marker.showBadge ? badgeOffset : 0) + LABEL_BASELINE * unitsPerPx}
                textAnchor={marker.anchor}
                fontSize={LABEL_FONT_PX * unitsPerPx}
              >
                {marker.text}
              </text>
            ) : null}
          </g>
        )
      })}
    </g>
  )
}

export const MarkerLayer = memo(MarkerLayerBase)
