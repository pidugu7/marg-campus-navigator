/**
 * The map's camera, as arithmetic.
 *
 * Deliberately free of React and of the DOM: a view is `{ cx, cy, span }` and every operation is a pure
 * function over that plus the canvas extent and the element's aspect ratio. Two reasons. First, the
 * properties that decide whether a map feels right — *the point under the cursor stays under the cursor*,
 * the view never leaves the canvas, zoom-out always shows the whole campus — are arithmetic, and
 * `view.spec.ts` pins them in plain Node, without a DOM (this project ships none). Second, the alternative
 * is storing a `viewBox` string, and a string makes "clamp", "anchor" and "aspect" into parsing.
 *
 * `span` is the visible width in **world units**, so zoom is one number and the visible height follows from
 * the element's aspect. That choice is why a window resize cannot change the zoom level: the span is
 * untouched, only `span / aspect` is recomputed.
 */

import type { CanvasSpec } from '@/data'

export interface View {
  /** Centre of the visible rectangle, in world units. */
  readonly cx: number
  readonly cy: number
  /** Visible width, in world units. Height is `span / aspect`. */
  readonly span: number
}

export interface Extent {
  readonly width: number
  readonly height: number
}

/** One point, in world units or in element pixels depending on the caller. */
export interface Px {
  readonly x: number
  readonly y: number
}

/** At full zoom the whole canvas fits; at minimum zoom you can read a single building's label. */
export const MIN_SPAN_RATIO = 0.075
/** Slack around the fitted canvas so the masthead's rounded corners do not crop the campus edge. */
const FIT_PADDING = 1.02

const clamp = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value)

/** Aspect must be finite and positive; a zero-height element during first paint would poison every number. */
export function safeAspect(width: number, height: number): number {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return 16 / 10
  return width / height
}

export function spanLimits(extent: Extent): { readonly min: number; readonly max: number } {
  const max = Math.max(extent.width, extent.height) * FIT_PADDING
  // A ratio rather than a constant, so a campus twice as big zooms twice as far in before text is the
  // thing you are navigating by.
  return { min: max * MIN_SPAN_RATIO, max }
}

/** The whole campus, centred, at the least zoom that still shows all of it. */
export function fitView(extent: Extent, aspect: number): View {
  const span = Math.max(extent.width, extent.height * aspect) * FIT_PADDING
  return { cx: extent.width / 2, cy: extent.height / 2, span }
}

/**
 * Keep the camera inside the campus. When the canvas is narrower or shorter than the view, that axis is
 * centred instead: clamping a view bigger than its container would pin it to a corner, which reads as a
 * bug rather than as a limit.
 */
export function clampView(view: View, extent: Extent, aspect: number): View {
  const limits = spanLimits(extent)
  const span = clamp(view.span, limits.min, limits.max)
  const halfX = span / 2
  const halfY = span / (2 * aspect)
  const cx = extent.width <= span ? extent.width / 2 : clamp(view.cx, halfX, extent.width - halfX)
  const cy = extent.height <= span / aspect ? extent.height / 2 : clamp(view.cy, halfY, extent.height - halfY)
  return { cx, cy, span }
}

/** Pan by a displacement already converted to world units (see `screenDelta`). */
export function panView(view: View, dx: number, dy: number, extent: Extent, aspect: number): View {
  return clampView({ cx: view.cx - dx, cy: view.cy - dy, span: view.span }, extent, aspect)
}

/**
 * Zoom by `factor` (>1 zooms in), keeping `anchor` — a world point — where it is on screen.
 *
 * The anchor is fixed by moving the centre by the same fraction the span shrank, which is the whole
 * trick: `span` scales about the anchor rather than about the centre. A wheel that always zoomed to the
 * middle is why maps people dislike are disliked.
 */
export function zoomView(
  view: View,
  factor: number,
  anchor: Px,
  extent: Extent,
  aspect: number,
): View {
  const limits = spanLimits(extent)
  const span = clamp(view.span / factor, limits.min, limits.max)
  // `applied` is the factor that actually happened, since a limit may have cut `factor` short. The
  // centre has to move by *that* amount or the anchor drifts exactly when you hit full zoom.
  const applied = view.span / span
  return clampView(
    { cx: anchor.x - (anchor.x - view.cx) / applied, cy: anchor.y - (anchor.y - view.cy) / applied, span },
    extent,
    aspect,
  )
}

/** The SVG `viewBox` for a view, plus the rectangle it describes. */
export function viewBoxOf(view: View, aspect: number): { readonly rect: Px & { w: number; h: number }; readonly attr: string } {
  const w = view.span
  const h = view.span / aspect
  const x = view.cx - w / 2
  const y = view.cy - h / 2
  return { rect: { x, y, w, h }, attr: `${x} ${y} ${w} ${h}` }
}

/**
 * A point inside an element, in client coordinates, to world units.
 *
 * `rect` is what `getBoundingClientRect()` returned for the element that owns this view — the only
 * measurement the component is allowed to take (see the ESLint ban on `document`/`window` in `src/**`).
 */
export function screenToWorld(rect: { x: number; y: number; width: number; height: number }, view: View, clientX: number, clientY: number): Px {
  const { rect: box } = viewBoxOf(view, safeAspect(rect.width, rect.height))
  return {
    x: box.x + ((clientX - rect.x) / Math.max(rect.width, 1)) * box.w,
    y: box.y + ((clientY - rect.y) / Math.max(rect.height, 1)) * box.h,
  }
}

/** How far a screen drag moves the camera, in world units. */
export function screenDelta(rect: { width: number; height: number }, view: View, dxPx: number, dyPx: number): Px {
  const scale = view.span / Math.max(rect.width, 1)
  return { x: dxPx * scale, y: dyPx * scale }
}

/** True when two views are the same camera, for the reset button's disabled state. */
export function isFit(view: View, extent: Extent, aspect: number): boolean {
  const fit = fitView(extent, aspect)
  const tolerance = fit.span * 1e-6
  return (
    Math.abs(view.span - fit.span) <= tolerance &&
    Math.abs(view.cx - fit.cx) <= tolerance &&
    Math.abs(view.cy - fit.cy) <= tolerance
  )
}

/**
 * Wheel `deltaY` to a zoom factor.
 *
 * Browsers disagree about what a wheel delta *means* — `deltaMode` says pixels, lines or pages — and a
 * trackpad sends a hundred small events where a mouse sends three big ones, so the factor is exponential
 * in the delta and then clamped. The clamp is not decoration: without it one Firefox "10 lines" event
 * jumps past the minimum span and the map appears to glitch.
 */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1
  const exponent = -deltaY * unit * 0.0018
  const factor = Math.exp(Number.isFinite(exponent) ? exponent : 0)
  return clamp(factor, 0.6, 1.8)
}

/** Two fingers moving apart to a zoom factor; a degenerate start distance means "no change". */
export function pinchFactor(startDistance: number, distance: number): number {
  if (!(startDistance > 0) || !(distance > 0) || !Number.isFinite(distance)) return 1
  return clamp(distance / startDistance, 0.5, 2)
}

/** How far apart two client points are, for the pinch gesture. */
export function distanceBetween(a: Px, b: Px): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * How many world units one CSS pixel covers right now.
 *
 * This is the whole reason badges and labels are legible: SVG text and icons live in the map's own
 * coordinate system, so a 16-unit icon is 16 metres of campus at every zoom — huge when you zoom in, a
 * speck when you zoom out. Anything that must be a *screen* size (a 32 px tap target, an 11 px label) is
 * sized as `px * worldPerPixel(span, plateWidth)`, and a layer that does that has to re-render when the
 * camera moves. That is the price of a readable map, and it is paid by ~20 markers, not by 56 walkways.
 *
 * A plate that has not been laid out yet reports width 0 — during SSR, and for one frame — so the ratio
 * falls back to a nominal 1000 px plate instead of `Infinity`, which would render an infinitely large badge.
 */
export function worldPerPixel(span: number, plateWidth: number): number {
  if (!(plateWidth > 0) || !Number.isFinite(plateWidth)) return span / 1000
  return span / plateWidth
}

/**
 * Which side of the point a tooltip sits on: above, unless there is not room, in which case below.
 * A tooltip that is clipped at the top of the plate is worse than one covering the marker it describes.
 */
export function tipSide(pointY: number, plateHeight: number, room: number): 'above' | 'below' {
  // Below only when there is no room above *and* there is below; every other case — including the phone
  // plate where neither side fits — keeps the tip above, covering the marker rather than the plate's edge.
  if (pointY + room > plateHeight) return 'above'
  return pointY - room >= 0 ? 'above' : 'below'
}

/**
 * Where the middle of an overlay of width `boxWidth` may sit, so it stays inside the plate: the tooltip's
 * own clamping, done in arithmetic instead of by a CSS function that cannot know the box.
 *
 * A plate narrower than the box centres the overlay instead of pinning it — the same rule as the camera's,
 * for the same reason: a 360 px plate with a 220 px tip has no valid side to hold it against.
 */
export function tipLeft(x: number, plateWidth: number, boxWidth: number): number {
  const half = Math.min(boxWidth / 2, plateWidth / 2)
  return clamp(x, half, Math.max(half, plateWidth - half))
}

/** World point → CSS pixels inside the plate, for the HTML overlays that must line up with the geometry. */
export function worldToScreen(
  view: View,
  plate: { readonly width: number; readonly height: number },
  aspect: number,
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  const { rect } = viewBoxOf(view, aspect)
  return {
    x: ((x - rect.x) / rect.w) * plate.width,
    y: ((y - rect.y) / rect.h) * plate.height,
  }
}

/** Extent of the canvas, guarded: a malformed file must not produce a NaN viewBox. */
export function extentOf(canvas: CanvasSpec): Extent {
  const width = Number.isFinite(canvas.width) && canvas.width > 0 ? canvas.width : 1000
  const height = Number.isFinite(canvas.height) && canvas.height > 0 ? canvas.height : 625
  return { width, height }
}
