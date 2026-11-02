/**
 * The route layer, rendered to markup — no DOM, no browser, one `renderToStaticMarkup`.
 *
 * This is the end-to-end half of the geometry claim. `route-plan.spec.ts` proves `planRoute` refuses to draw
 * across a hole in the path; `route-plan.ts`'s rules are only worth anything if the `<polyline>` that reaches
 * the screen came through that function, so this file renders the component and reads what it produced: the
 * number of vertices in `points`, the two pins and where they sit, and — the case that matters — *no line at
 * all* when a vertex cannot be placed.
 *
 * Sizes are checked as *ratios*, not pixels: the pins are `scale(unitsPerPx)`'d, so doubling the camera must
 * halve nothing about a pin's on-screen size, and that invariance is the whole reason the layer is written this
 * way instead of multiplying every radius by hand.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RouteLayer } from './route-layer'
import type { Px } from '../view'

const AT: Record<string, Px> = {
  a: { x: 0, y: 0 },
  b: { x: 100, y: 0 },
  c: { x: 100, y: 100 },
  d: { x: 0, y: 100 },
}
const positions = new Map(Object.entries(AT))

interface LayerProps {
  readonly nodeIds: readonly string[]
  readonly unitsPerPx?: number
}

function render({ nodeIds, unitsPerPx = 1 }: LayerProps): string {
  return renderToStaticMarkup(
    createElement(RouteLayer, {
      nodeIds,
      positions,
      unitsPerPx,
      algorithmLabel: 'A*',
      startLabel: 'North Gate',
      destinationLabel: 'Library',
      metres: 412.6,
    }),
  )
}

describe('the route layer', () => {
  it('draws one polyline with a vertex per place on the path', () => {
    const html = render({ nodeIds: ['a', 'b', 'c', 'd'] })
    const match = /class="route-line" points="([^"]*)"/.exec(html)
    expect(match?.[1]).toBe('0,0 100,0 100,100 0,100')
    // The casing is emitted too, and before the line: a halo painted later would hide the route it is meant to
    // separate from the walkway underneath.
    expect(html.indexOf('route-halo')).toBeLessThan(html.indexOf('route-line'))
  })

  it('puts a green pin on the start and a coral ring on the destination, at their own vertices', () => {
    const html = render({ nodeIds: ['a', 'b', 'c', 'd'] })
    expect(html).toContain('route-pin--start" transform="translate(0 0) scale(1)')
    expect(html).toContain('route-pin--end" transform="translate(0 100) scale(1)')
    expect(html).toContain('aria-label="Start: North Gate"')
    expect(html).toContain('aria-label="Destination: Library"')
  })

  it('keeps a pin the same size on screen by scaling it with the camera', () => {
    // The radius in the markup is a constant; the group's scale is what changes. So at 4 units per pixel the
    // transform says 4 and the `r` does not move — which is the whole `non-scaling` trick, asserted rather than
    // trusted to a comment.
    const html = render({ nodeIds: ['a', 'b'], unitsPerPx: 4 })
    expect(html).toContain('scale(4)')
    expect(html).toContain('r="6.5"')
    expect(html).toContain('r="2.4"')
  })

  it('draws no line at all when the path has a hole in it, and keeps both pins', () => {
    const html = render({ nodeIds: ['a', 'missing', 'c'] })
    expect(html).not.toContain('<polyline')
    expect(html).toContain('route-pin--start')
    expect(html).toContain('route-pin--end')
    // …and says so in the accessible name, because a route the card reports and the map does not draw is
    // exactly the disagreement a reader cannot debug.
    expect(html).toContain('the line could not be drawn on this map')
  })

  it('draws nothing at all when the map cannot place the walk', () => {
    // Every vertex of the route is missing from `positions`. There is no honest picture to make, so the layer
    // emits the group and its label and no shapes — the card above it can still report the walk, and the map
    // refuses to invent one. `buildGraph` makes this unreachable for a campus model (a dropped node takes its
    // edges with it), which is why the case is worth a render rather than a comment: the layer's props are any
    // two lookups, and the failure mode is a plausible-looking empty map.
    const html = render({ nodeIds: ['gone', 'also-gone'] })
    expect(html).toContain('layer-route')
    expect(html).not.toContain('<polyline')
    expect(html).not.toContain('route-pin')
    expect(html).toContain('Route from North Gate to Library')
  })

  it('shows a single pin for a walk that goes nowhere', () => {
    const html = render({ nodeIds: ['a'] })
    expect(html).toContain('route-pin--start')
    expect(html).not.toContain('route-pin--end')
    expect(html).not.toContain('<polyline')
  })

  it('names the walk, the pair and the method in one aria-label', () => {
    const html = render({ nodeIds: ['a', 'b', 'c'] })
    expect(html).toContain(
      'Route from North Gate to Library, 412.6 metres, 3 places along, by A*',
    )
    // The label rounds to the tenth the legs are quoted at — 412.64 would be a different claim about precision.
    expect(render({ nodeIds: ['a', 'b'] })).toContain('412.6 metres')
  })
})
