/**
 * Pointer, wheel and keyboard control of the map camera.
 *
 * Two constraints shape this file, and both are React's rather than the map's:
 *
 * - **`wheel` cannot be `preventDefault`ed from a React handler.** React attaches its listeners at the root
 *   as passive, so the page would scroll while the map zoomed. The listener is therefore added by hand on
 *   the `<svg>` element with `{ passive: false }`, inside an effect that cleans up — and it reads the camera
 *   from refs so the effect can bind once instead of on every state change.
 * - **`touch-action: none` in CSS is not enough on its own, and neither are handlers on their own.** The
 *   property stops the browser panning the page under a finger; the handlers do the panning. Both live
 *   together in `map.css` and here, and the pairing is the reason there is no `onTouchStart` anywhere.
 *
 * Measurements are taken from `event.currentTarget` and `ResizeObserver`, never from `document` or `window`
 * — the ESLint rule that bans those globals in `src/**` is what keeps the component tree portable to the
 * single-file build, where there is no host page to reach into.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import {
  clampView,
  distanceBetween,
  fitView,
  isFit,
  panView,
  pinchFactor,
  safeAspect,
  screenDelta,
  screenToWorld,
  viewBoxOf,
  wheelFactor,
  zoomView,
  type Extent,
  type View,
} from './view'

interface Tracked {
  readonly x: number
  readonly y: number
}

/**
 * The camera and the gesture bindings. The element's own ref is deliberately *not* in here: the component
 * owns its DOM node and hands the ref to this hook, which keeps the returned value free of refs and lets
 * every consumer read it during render without tripping React's refs-are-not-render-values rule.
 */
export interface Viewport {
  readonly view: View
  readonly viewBox: string
  /** Only used for the cursor. A drag that ends outside the element must not strand `grabbing`. */
  readonly dragging: boolean
  /** 1 at fit, > 1 when zoomed in. Drives label staging and the HUD readout. */
  readonly scale: number
  readonly fitted: boolean
  readonly zoomBy: (factor: number) => void
  readonly reset: () => void
  readonly bindings: {
    readonly onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void
    readonly onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void
    readonly onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => void
    readonly onPointerCancel: (event: ReactPointerEvent<SVGSVGElement>) => void
    readonly onLostPointerCapture: (event: ReactPointerEvent<SVGSVGElement>) => void
    readonly onKeyDown: (event: ReactKeyboardEvent<SVGSVGElement>) => void
  }
}

interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * @param width  canvas width in world units, as primitives so the effects below depend on values and not
 *               on an object literal that would be new on every render.
 */
export function useViewport(
  width: number,
  height: number,
  svgRef: RefObject<SVGSVGElement | null>,
): Viewport {
  const extent: Extent = useMemo(() => ({ width, height }), [width, height])
  const [aspect, setAspect] = useState(16 / 10)
  const [view, setView] = useState<View>(() => fitView({ width, height }, 16 / 10))
  const [dragging, setDragging] = useState(false)

  // The wheel and pinch handlers are bound once, so they read the camera's inputs from a ref rather than
  // closing over values that go stale the first time the window is resized. The camera *itself* is not in
  // here: every gesture updates through `setView(current => …)`, which is React's own way of saying "the
  // latest value, please", and is why a fast drag never lags a frame behind the cursor.
  const geometry = useRef({ aspect, extent })
  useEffect(() => {
    geometry.current = { aspect, extent }
  })

  const pointers = useRef(new Map<number, Tracked>())
  // A pinch is two numbers, both remembered from the previous move: how far apart the fingers were, and
  // where between them they were. Ratio *and* midpoint, because a two-finger drag should pan as well.
  const pinchDistance = useRef(0)
  const pinchMiddle = useRef<Tracked | null>(null)

  const measure = (svg: SVGSVGElement): Rect => {
    const box = svg.getBoundingClientRect()
    return { x: box.left, y: box.top, width: box.width, height: box.height }
  }

  const zoomAboutClient = useCallback((rect: Rect, clientX: number, clientY: number, factor: number) => {
    setView((current) => {
      const anchor = screenToWorld(rect, current, clientX, clientY)
      return zoomView(current, factor, anchor, geometry.current.extent, geometry.current.aspect)
    })
  }, [])

  const zoomBy = useCallback((factor: number) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = measure(svg)
    zoomAboutClient(rect, rect.x + rect.width / 2, rect.y + rect.height / 2, factor)
  }, [zoomAboutClient, svgRef])

  const reset = useCallback(() => {
    setView(fitView(geometry.current.extent, geometry.current.aspect))
  }, [])

  const endPointer = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) {
      pinchDistance.current = 0
      pinchMiddle.current = null
    }
    if (pointers.current.size === 0) setDragging(false)
  }, [])

  const bindings: Viewport['bindings'] = useMemo(
    () => ({
      onPointerDown: (event) => {
        // Capture, so a fast flick that leaves the element still ends this gesture instead of leaving the
        // map glued to the cursor.
        event.currentTarget.setPointerCapture(event.pointerId)
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()]
          pinchDistance.current = a && b ? distanceBetween(a, b) : 0
          pinchMiddle.current = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null
        }
        if (pointers.current.size === 1) setDragging(true)
      },
      onPointerMove: (event) => {
        const previous = pointers.current.get(event.pointerId)
        if (!previous) return
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        const svg = event.currentTarget
        const rect = measure(svg)

        if (pointers.current.size >= 2) {
          const [a, b] = [...pointers.current.values()]
          if (!a || !b) return
          const distance = distanceBetween(a, b)
          const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          const startDistance = pinchDistance.current
          const startMiddle = pinchMiddle.current ?? middle
          pinchDistance.current = distance
          pinchMiddle.current = middle
          const factor = pinchFactor(startDistance, distance)
          setView((current) => {
            // Pan by the midpoint's travel first, then zoom about it: the gesture that does the reverse
            // makes the map swim sideways whenever you squeeze.
            const travel = screenDelta(rect, current, middle.x - startMiddle.x, middle.y - startMiddle.y)
            const panned = panView(current, travel.x, travel.y, geometry.current.extent, geometry.current.aspect)
            return zoomView(panned, factor, screenToWorld(rect, panned, middle.x, middle.y), geometry.current.extent, geometry.current.aspect)
          })
          return
        }

        const dx = event.clientX - previous.x
        const dy = event.clientY - previous.y
        if (dx === 0 && dy === 0) return
        setView((current) => {
          const delta = screenDelta(rect, current, dx, dy)
          return panView(current, delta.x, delta.y, geometry.current.extent, geometry.current.aspect)
        })
      },
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onLostPointerCapture: endPointer,
      onKeyDown: (event) => {
        // Keyboard pan and zoom, because a map you can only drag is a map you can only use with a mouse.
        // The step is a fraction of the *current* span, so arrow keys move the same visible distance at
        // every zoom level.
        const nudge = (fraction: number, axis: 'x' | 'y') =>
          setView((current) => {
            const step = current.span * fraction
            const next = axis === 'x' ? { cx: current.cx + step } : { cy: current.cy + step }
            return clampView({ ...current, ...next }, geometry.current.extent, geometry.current.aspect)
          })
        switch (event.key) {
          case 'ArrowLeft':
            nudge(-0.12, 'x')
            break
          case 'ArrowRight':
            nudge(0.12, 'x')
            break
          case 'ArrowUp':
            nudge(-0.12, 'y')
            break
          case 'ArrowDown':
            nudge(0.12, 'y')
            break
          case '+':
          case '=':
            zoomBy(1.35)
            break
          case '-':
          case '_':
            zoomBy(1 / 1.35)
            break
          case '0':
          case 'Home':
            reset()
            break
          default:
            return
        }
        // Only consume keys we acted on, so Tab and any future shortcut still work.
        event.preventDefault()
      },
    }),
    [endPointer, reset, zoomBy],
  )

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = measure(svg)
      zoomAboutClient(rect, event.clientX, event.clientY, wheelFactor(event.deltaY, event.deltaMode))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // `svgRef` is listed because the effect reads `.current`; a ref object is stable across renders, so
    // this never re-binds, and "the ref never changes" is exactly what the rule is not allowed to assume.
  }, [zoomAboutClient, svgRef])

  // The visible height is `span / aspect`, so a resize changes what is on screen without changing the zoom
  // level. Re-clamping after the new aspect keeps the campus inside the plate.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setAspect(safeAspect(entry.contentRect.width, entry.contentRect.height))
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [svgRef])

  // Clamped on the way *out* rather than written back on the way in: every gesture already clamps, so the
  // only way the stored camera can be out of range is the canvas or the plate shrinking under it — and
  // re-clamping in a derived value fixes that in the same render, with no effect, no extra state, and no
  // chance of the map visibly sticking to an edge after a resize.
  const camera = useMemo(() => clampView(view, extent, aspect), [view, extent, aspect])
  const { attr } = useMemo(() => viewBoxOf(camera, aspect), [camera, aspect])
  const fitted = isFit(camera, extent, aspect)

  return {
    view: camera,
    viewBox: attr,
    dragging,
    scale: fitView(extent, aspect).span / camera.span,
    fitted,
    zoomBy,
    reset,
    bindings,
  }
}
