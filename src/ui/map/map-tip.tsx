/**
 * The tooltip itself: an HTML overlay, not SVG.
 *
 * Text in the plate would have to be sized, wrapped and haloed by hand and would scale with the camera; the
 * map's own geometry wants exactly that, and a caption does not. So the tip lives in the frame next to the
 * `<svg>`, positioned by projecting the item's world point (`toScreen`) and clamped so it cannot hang off
 * the plate — which is the same overflow rule the camera follows, applied to a box of text.
 *
 * `role="tooltip"` plus the `aria-describedby` the marker sets is what makes focus-and-read work; the tip is
 * not focusable itself, because it holds no actions, and stealing focus from the map would break the pan
 * keys the moment a tooltip appeared.
 */
import type { TipState } from './use-tooltip'
import { tipLeft } from './view'

export interface MapTipProps {
  readonly tip: TipState | null
  readonly plateWidth: number
}

/** Matches `max-width` in `map.css`, and the tip never needs to be wider than that. */
const TIP_BOX_PX = 224

export function MapTip({ tip, plateWidth }: MapTipProps) {
  if (tip === null) return null
  return (
    <div
      id="map-tip"
      role="tooltip"
      className={`map-tip map-tip--${tip.side}`}
      style={{ left: tipLeft(tip.x, plateWidth, TIP_BOX_PX), top: tip.y }}
    >
      <strong>{tip.content.title}</strong>
      {tip.content.lines.map((line, index) => (
        <span key={`${index}-${line}`}>{line}</span>
      ))}
    </div>
  )
}
