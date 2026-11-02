/**
 * The camera's properties, not its implementation. Every case here is the reason a map feels correct or
 * wrong under a finger, and each is answerable with numbers: does the anchor hold, does the edge stop the
 * pan, does the zoom clamp, does "reset" return exactly the initial view.
 *
 * These run in plain Node. Component tests would need a DOM, and this project deliberately ships none
 * (see `docs/ARCHITECTURE.md`), which is affordable only because the interesting behaviour is arithmetic.
 */
import { describe, expect, it } from 'vitest'
import {
  MIN_SPAN_RATIO,
  distanceBetween,
  tipSide,
  clampView,
  extentOf,
  fitView,
  isFit,
  panView,
  pinchFactor,
  safeAspect,
  screenDelta,
  screenToWorld,
  tipLeft,
  spanLimits,
  viewBoxOf,
  wheelFactor,
  worldPerPixel,
  worldToScreen,
  zoomView,
  type View,
} from './view'

const CANVAS = { width: 1600, height: 1000 }
const ASPECT = 16 / 10
const view = (over: Partial<View> = {}): View => ({ ...fitView(CANVAS, ASPECT), ...over })

describe('fitting', () => {
  it('shows the whole canvas with room to spare, centred', () => {
    const fit = fitView(CANVAS, ASPECT)
    expect(fit.cx).toBe(800)
    expect(fit.cy).toBe(500)
    // 1600 wide at 16:10 needs exactly the width, so the padding is all that widens it.
    expect(fit.span).toBeCloseTo(1632, 6)
    const { rect } = viewBoxOf(fit, ASPECT)
    expect(rect.x).toBeLessThan(0)
    expect(rect.x + rect.w).toBeGreaterThan(CANVAS.width)
    expect(rect.y).toBeLessThan(0)
    expect(rect.y + rect.h).toBeGreaterThan(CANVAS.height)
  })

  it('covers the whole canvas at every window shape, which is the 360 px overflow question', () => {
    // The plate is `aspect-ratio: 16/10` on a wide screen and `4/5` on a phone, so "does the campus fit"
    // is a question about aspect, not about width. Answered once here rather than at three viewports.
    for (const aspect of [0.4, 0.5, 0.81, 1, 1.6, 2.4, 3.2]) {
      const fit = fitView(CANVAS, aspect)
      const { rect } = viewBoxOf(fit, aspect)
      expect(rect.x, `aspect ${aspect}`).toBeLessThanOrEqual(0)
      expect(rect.y, `aspect ${aspect}`).toBeLessThanOrEqual(0)
      expect(rect.x + rect.w, `aspect ${aspect}`).toBeGreaterThanOrEqual(CANVAS.width)
      expect(rect.y + rect.h, `aspect ${aspect}`).toBeGreaterThanOrEqual(CANVAS.height)
      // And the camera stays put: a fitted view is always centred, so nothing slides off in a narrow window.
      expect(fit.cx).toBe(800)
      expect(fit.cy).toBe(500)
    }
  })

  it('grows the span instead of cropping when the window is taller than the campus', () => {
    const tall = fitView(CANVAS, 0.5)
    expect(tall.span).toBeGreaterThan(CANVAS.width)
    const { rect } = viewBoxOf(tall, 0.5)
    // Height is span / aspect, so a narrow window sees *more* world vertically, not less.
    expect(rect.h).toBeGreaterThan(CANVAS.height)
  })

  it('reports a fitted view as fitted, and a moved one as not', () => {
    const fit = fitView(CANVAS, ASPECT)
    expect(isFit(fit, CANVAS, ASPECT)).toBe(true)
    expect(isFit({ ...fit, cx: fit.cx + 1 }, CANVAS, ASPECT)).toBe(false)
  })
})

describe('clamping', () => {
  it('never lets the camera leave the campus', () => {
    const zoomed = view({ span: 400 })
    const east = clampView({ ...zoomed, cx: 9_999 }, CANVAS, ASPECT)
    expect(east.cx).toBe(CANVAS.width - 200)
    const west = clampView({ ...zoomed, cx: -9_999 }, CANVAS, ASPECT)
    expect(west.cx).toBe(200)
    const north = clampView({ ...zoomed, cy: -9_999 }, CANVAS, ASPECT)
    expect(north.cy).toBeCloseTo(200 / ASPECT, 6)
  })

  it('centres an axis when the view is wider than the canvas on it', () => {
    // Clamping here would pin the map to one edge and leave a band of nothing beside it.
    const wide = clampView({ cx: 0, cy: 0, span: 2_000 }, CANVAS, ASPECT)
    expect(wide.cx).toBe(800)
  })

  it('clamps span to the limits at both ends', () => {
    const limits = spanLimits(CANVAS)
    expect(clampView(view({ span: 10 }), CANVAS, ASPECT).span).toBe(limits.min)
    expect(clampView(view({ span: 90_000 }), CANVAS, ASPECT).span).toBe(limits.max)
    expect(limits.min).toBeGreaterThan(0)
    expect(limits.min / limits.max).toBeCloseTo(MIN_SPAN_RATIO, 6)
  })

  it('survives a canvas that is a point, rather than producing NaN', () => {
    const degenerate = clampView(view(), { width: 0, height: 0 }, ASPECT)
    expect(Number.isFinite(degenerate.cx)).toBe(true)
    expect(Number.isFinite(degenerate.span)).toBe(true)
  })
})

describe('zooming', () => {
  it('holds the world point under the cursor in the same screen pixel', () => {
    // The property the whole interaction rests on, checked the way the browser checks it: take a world
    // point, project it to the viewport, zoom about it, project again.
    const before = view({ span: 1_200 })
    const anchor = screenToWorld({ x: 0, y: 0, width: 1_200, height: 750 }, before, 900, 600)
    const after = zoomView(before, 1.8, anchor, CANVAS, ASPECT)
    const projected = screenToWorld({ x: 0, y: 0, width: 1_200, height: 750 }, after, 900, 600)
    expect(projected.x).toBeCloseTo(anchor.x, 6)
    expect(projected.y).toBeCloseTo(anchor.y, 6)
  })

  it('multiplies span by the reciprocal of the factor until a limit bites', () => {
    const before = view({ span: 800 })
    const centre = { x: 800, y: 500 }
    const zoomed = zoomView(before, 2, centre, CANVAS, ASPECT)
    expect(zoomed.span).toBe(400)
    const out = zoomView(zoomed, 0.5, centre, CANVAS, ASPECT)
    expect(out.span).toBe(800)
  })

  it('moves the centre by the factor that actually applied, so a clamped zoom does not drift', () => {
    const limits = spanLimits(CANVAS)
    const nearlyMax = view({ span: limits.min * 1.05 })
    const anchor = { x: 1_000, y: 400 }
    const result = zoomView(nearlyMax, 50, anchor, CANVAS, ASPECT)
    expect(result.span).toBe(limits.min)
    // A naive implementation would still shift the centre by the requested factor and teleport the map.
    expect(Math.abs(result.cx - anchor.x)).toBeLessThan(anchor.x)
    expect(Number.isFinite(result.cx)).toBe(true)
  })

  it('keeps the view inside the canvas while zooming into a corner', () => {
    let current = view({ cx: 60, cy: 40, span: 900 })
    for (let i = 0; i < 12; i++) current = zoomView(current, 1.6, { x: 60, y: 40 }, CANVAS, ASPECT)
    const { rect } = viewBoxOf(current, ASPECT)
    expect(rect.x).toBeGreaterThanOrEqual(-0.001)
    expect(rect.y).toBeGreaterThanOrEqual(-0.001)
  })
})

describe('panning', () => {
  it('moves the camera by the dragged distance in world units', () => {
    const rect = { width: 800, height: 500 }
    const before = view({ span: 800, cx: 800, cy: 500 })
    // 100 px at 800 world units across an 800 px element is exactly 100 world units.
    const delta = screenDelta(rect, before, 100, -50)
    expect(delta).toEqual({ x: 100, y: -50 })
    const after = panView(before, delta.x, delta.y, CANVAS, ASPECT)
    expect(after.cx).toBe(700)
    expect(after.cy).toBe(550)
    expect(after.span).toBe(800)
  })

  it('stops at the edge and does not rubber-band past it', () => {
    const zoomed = view({ span: 400, cx: 800 })
    const far = panView(zoomed, -5_000, 0, CANVAS, ASPECT)
    expect(far.cx).toBe(CANVAS.width - 200)
    expect(panView(far, -100, 0, CANVAS, ASPECT).cx).toBe(far.cx)
  })

  it('converts screen pixels with the element size it was given, not an assumption', () => {
    const wide = screenDelta({ width: 1_600, height: 1_000 }, view({ span: 800 }), 100, 0)
    expect(wide.x).toBe(50)
    const narrow = screenDelta({ width: 320, height: 200 }, view({ span: 800 }), 100, 0)
    expect(narrow.x).toBe(250)
  })
})

describe('gesture input, converted once instead of in two handlers', () => {
  it('reads a wheel delta in the unit the browser meant', () => {
    const pixels = wheelFactor(100, 0)
    const lines = wheelFactor(100 / 16, 1) // same physical scroll, reported in lines
    expect(lines).toBeCloseTo(pixels, 6)
    expect(pixels).toBeLessThan(1) // scrolling down zooms out
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1)
    expect(wheelFactor(0, 0)).toBe(1)
  })

  it('tames one wild delta into a single bounded jump', () => {
    // Firefox can report 10 *lines* per notch; a page-scroll delta arrives on some touchpads.
    expect(wheelFactor(10_000, 0)).toBeCloseTo(0.6, 6)
    expect(wheelFactor(-10_000, 0)).toBeCloseTo(1.8, 6)
    expect(wheelFactor(Number.NaN, 0)).toBe(1)
    expect(wheelFactor(3, 99)).toBeLessThan(1.01)
    expect(wheelFactor(1, 2)).toBeCloseTo(wheelFactor(400, 0), 9) // a "page" delta is 400 px of intent
  })

  it('turns a pinch into a ratio, and a collapsed pinch into no change', () => {
    expect(pinchFactor(100, 200)).toBe(2)
    expect(pinchFactor(100, 50)).toBe(0.5)
    expect(pinchFactor(0, 40)).toBe(1)
    expect(pinchFactor(100, 0)).toBe(1)
    expect(pinchFactor(100, Number.NaN)).toBe(1)
    expect(pinchFactor(100, 9_000)).toBe(2) // clamped, so a lost pointer does not fling the map
  })

  it('measures two client points', () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
})

describe('screen-space sizes', () => {
  it('converts a span to world units per pixel, and falls back before the first layout', () => {
    expect(worldPerPixel(1600, 800)).toBe(2)
    expect(worldPerPixel(1600, 0)).toBeCloseTo(1.6, 6) // a nominal 1000 px plate, not Infinity
    expect(worldPerPixel(1600, Number.NaN)).toBeCloseTo(1.6, 6)
    expect(worldPerPixel(1600, -300)).toBeCloseTo(1.6, 6)
  })

  it('picks the side that has room, and the least bad side when neither does', () => {
    expect(tipSide(500, 900, 80)).toBe('above')
    expect(tipSide(40, 900, 80)).toBe('below')
    expect(tipSide(860, 900, 80)).toBe('above')
    // A phone plate 288 tall and a 90 px tip: below would spill, so it covers the marker instead.
    expect(tipSide(270, 288, 90)).toBe('above')
  })

  it('keeps a tip box inside the plate, and centres it when the plate is too narrow', () => {
    expect(tipLeft(700, 1440, 224)).toBe(700)
    expect(tipLeft(40, 1440, 224)).toBe(112) // half the box, so nothing hangs off the left edge
    expect(tipLeft(1430, 1440, 224)).toBe(1328)
    // A 224 px box on a 180 px plate has no valid side: centre it rather than pin it to a wall.
    expect(tipLeft(10, 180, 224)).toBe(90)
    expect(tipLeft(170, 180, 224)).toBe(90)
  })

  it('projects a world point onto the plate, which is the inverse of screenToWorld', () => {
    const view = { cx: 800, cy: 500, span: 1600 }
    const plate = { width: 1000, height: 625 }
    const screen = worldToScreen(view, plate, 16 / 10, 1_200, 300)
    const back = screenToWorld({ x: 0, y: 0, width: 1_000, height: 625 }, view, screen.x, screen.y)
    expect(back.x).toBeCloseTo(1_200, 6)
    expect(back.y).toBeCloseTo(300, 6)
  })
})

describe('the aspect ratio and the canvas', () => {
  it('falls back to the plate ratio for an element that has not been laid out yet', () => {
    expect(safeAspect(0, 0)).toBeCloseTo(1.6, 6)
    expect(safeAspect(Number.NaN, 300)).toBeCloseTo(1.6, 6)
    expect(safeAspect(1_000, 500)).toBe(2)
  })

  it('guards a malformed canvas rather than poisoning every number with NaN', () => {
    expect(extentOf({ width: 0, height: -5, pixelsPerMetre: 1 })).toEqual({ width: 1000, height: 625 })
    expect(extentOf({ width: Number.NaN, height: 300, pixelsPerMetre: 1 })).toEqual({ width: 1000, height: 300 })
    expect(extentOf(CANVAS as never)).toEqual(CANVAS)
  })
})
