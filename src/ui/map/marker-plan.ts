/**
 * Who gets a badge, who gets a label, and who stays a dot.
 *
 * Twenty places on a 1440 px plate is a map; twenty places on a 360 px plate is a smear of overlapping
 * text. The fix used here is the one every real map uses — declutter by priority — expressed as pure
 * arithmetic over *screen* pixels, because "do these two labels collide" is a question about the plate,
 * not about the campus: the same two buildings overlap at 360 px and do not at 1440 px even though their
 * world coordinates are identical, and a rule written in world units would get that backwards.
 *
 * Priority is the brief's "major places first": gates and entrances, then every non-`minor` place, then
 * the `minor` ones. A lower-priority marker is never allowed to displace a higher-priority one, which is
 * why the greedy pass runs in priority order while the result comes back in *input* order — render order
 * has to be stable or React re-mounts the whole layer every time a marker is dropped.
 */

import type { Px } from './view'

/** 0 = you arrive through it, 1 = you would search for it, 2 = useful once you are nearby. */
export type MarkerPriority = 0 | 1 | 2

export interface MarkerRequest {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly text: string
  readonly priority: MarkerPriority
  /** False for a place whose type has no icon: it can still earn a label. */
  readonly wantsBadge: boolean
}

export interface PlacedMarker {
  readonly id: string
  readonly x: number
  readonly y: number
  /** The string the box was measured from — returned so the drawer cannot disagree with the planner. */
  readonly text: string
  readonly showBadge: boolean
  readonly showLabel: boolean
  /** Screen-space anchor for the label, so a name at the campus edge runs inward instead of off the plate. */
  readonly anchor: 'start' | 'middle' | 'end'
}

export interface MarkerPlan {
  readonly markers: readonly PlacedMarker[]
  /** Places that are on screen but earned nothing: still drawn as a dot, findable by zooming in. */
  readonly hiddenMarkers: number
  /** Markers that kept their badge but lost their text to a neighbour. */
  readonly hiddenLabels: number
}

export interface MarkerPlanOptions {
  readonly plate: { readonly width: number; readonly height: number }
  /** The visible world rectangle, i.e. the current `viewBox`, used only to project points onto the plate. */
  readonly box: Px & { readonly w: number; readonly h: number }
  readonly badgePx?: number
  /** The *tap* target, which must be at least 32 px even when the badge it wraps is smaller. */
  readonly hitPx?: number
  readonly fontPx?: number
  /** Breathing room between two labels, on the 4 px grid. */
  readonly gapPx?: number
}

interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * The screen-space sizes, exported because the layer that *draws* must agree with the plan that decides:
 * a badge measured at 26 px and drawn at 24 px is a label that overlaps a badge and no test would notice.
 * All four are multiples of 4px on the plate, and `HIT_PX` is the accessibility floor for a tap target.
 */
export const BADGE_PX = 26
export const HIT_PX = 32
export const LABEL_FONT_PX = 11
export const GAP_PX = 8

const DEFAULTS = { badgePx: BADGE_PX, hitPx: HIT_PX, fontPx: LABEL_FONT_PX, gapPx: GAP_PX }

/** Rough advance width for the system UI stack. Deliberately generous: a clipped label is worse than a dropped one. */
const AVERAGE_GLYPH = 0.68

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * @param requests in file order; the plan preserves that order in its output.
 */
export function planMarkers(requests: readonly MarkerRequest[], options: MarkerPlanOptions): MarkerPlan {
  const { badgePx = DEFAULTS.badgePx, hitPx = DEFAULTS.hitPx, fontPx = DEFAULTS.fontPx, gapPx = DEFAULTS.gapPx } =
    options
  const { plate, box } = options

  // Nothing is measurable before the first layout pass (and never, during SSR), which is why this is a
  // case the component relies on rather than a defensive gesture: no plate means no screen-space rules.
  if (!(plate.width > 0) || !(plate.height > 0) || !(box.w > 0) || !(box.h > 0)) {
    return { markers: [], hiddenMarkers: 0, hiddenLabels: 0 }
  }

  const toScreen = (x: number, y: number): Px => ({
    x: ((x - box.x) / box.w) * plate.width,
    y: ((y - box.y) / box.h) * plate.height,
  })

  // Partly visible counts as visible: a marker clipped at the edge still needs its badge, or the person
  // panning has to guess where the campus ends and the labels begin.
  const onScreen = (point: Px): boolean =>
    point.x >= -badgePx &&
    point.y >= -badgePx &&
    point.x <= plate.width + badgePx &&
    point.y <= plate.height + badgePx

  const projected = requests.map((request) => ({ request, screen: toScreen(request.x, request.y) }))
  const visible = projected
    .filter((item) => onScreen(item.screen))
    // `priority` first, then id: two gates at the same moment must not trade places between renders.
    .sort((a, b) => a.request.priority - b.request.priority || (a.request.id < b.request.id ? -1 : 1))

  const taken: Box[] = []
  const placed = new Map<string, PlacedMarker>()
  let hiddenMarkers = 0
  let hiddenLabels = 0

  for (const { request, screen } of visible) {
    // The tap target claims space even though the picture is smaller, so two badges can never sit close
    // enough that a finger has to guess. That is what "32 px minimum" means in practice.
    const hitBox: Box = { x: screen.x - hitPx / 2, y: screen.y - hitPx / 2, w: hitPx, h: hitPx }
    let showBadge = false
    if (request.wantsBadge) {
      showBadge = !taken.some((other) => overlaps(other, hitBox))
      if (showBadge) taken.push(hitBox)
    }

    const labelWidth = request.text.length * fontPx * AVERAGE_GLYPH + 2 * gapPx
    const labelHeight = fontPx * 1.5
    // Under the badge if there is one, on the point if there is not.
    const labelY = screen.y + (showBadge ? badgePx / 2 + gapPx : 0)
    let anchor: PlacedMarker['anchor'] = 'middle'
    let labelX = screen.x - labelWidth / 2
    if (labelX < 0) {
      anchor = 'start'
      labelX = screen.x - badgePx / 2
    } else if (labelX + labelWidth > plate.width) {
      anchor = 'end'
      labelX = screen.x + badgePx / 2
    }
    // The reserved box is the text plus `gapPx` of padding on every side. A plan that reserved the glyph
    // box exactly would accept two labels 1 px apart, which is technically non-overlapping and visually one
    // run-on line — and it is worse on a phone, where the font is wider than any estimate.
    const labelBox: Box = {
      x: labelX - gapPx,
      y: labelY - gapPx / 2,
      w: labelWidth + 2 * gapPx,
      h: labelHeight + gapPx,
    }
    let showLabel = false
    if (!taken.some((other) => overlaps(other, labelBox))) {
      showLabel = true
      taken.push(labelBox)
    }

    // A marker that earned neither badge nor text is *omitted*, not flagged-and-returned: the dots are
    // already drawn by the node layer, and an entry here would be a component duty with nothing to do.
    // It still counts as hidden, which is what the legend reports and what zooming in will recover.
    if (!showBadge && !showLabel) {
      hiddenMarkers += 1
      continue
    }
    if (!showLabel) hiddenLabels += 1

    placed.set(request.id, {
      id: request.id,
      text: request.text,
      x: request.x,
      y: request.y,
      showBadge,
      showLabel,
      anchor,
    })
  }

  // Input order, not priority order: the layer maps over this and React keys it by id.
  const markers = projected
    .filter((item) => placed.has(item.request.id))
    .map((item) => placed.get(item.request.id) as PlacedMarker)

  return { markers, hiddenMarkers, hiddenLabels }
}

/**
 * Priority for one node, as the brief defines it: arrival points first, then major places, then the ones
 * the data marked `minor`. `kind` rather than `category` decides the top tier, because a gate is a gate
 * whatever it is called.
 */
export function markerPriority(kind: string, minor: boolean | undefined): MarkerPriority {
  if (kind === 'gate' || kind === 'entrance') return 0
  return minor ? 2 : 1
}
