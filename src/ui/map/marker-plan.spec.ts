/**
 * Decluttering is a *cartographic* decision, so it is specified as behaviour: who survives a crowded
 * plate, who survives a roomy one, and the promise that two 32 px tap targets never overlap.
 *
 * The most valuable pair of cases here is the same twelve places measured at 360 px and at 1440 px: the
 * world coordinates are identical, so if the plan came out the same at both widths the rules would be
 * written in the wrong space. That is the "test the layout at 360/768/1440" requirement, expressed once
 * as arithmetic instead of three times by squinting at a browser.
 */
import { describe, expect, it } from 'vitest'
import { markerPriority, planMarkers, type MarkerPlanOptions, type MarkerRequest } from './marker-plan'
import { viewBoxOf } from './view'

const CANVAS = { width: 1600, height: 1000 }

const options = (plateWidth: number, plateHeight: number, boxShift = 0): MarkerPlanOptions => {
  const aspect = plateWidth / plateHeight
  const view = { cx: CANVAS.width / 2 + boxShift, cy: CANVAS.height / 2, span: 1632 }
  return { plate: { width: plateWidth, height: plateHeight }, box: viewBoxOf(view, aspect).rect }
}

const place = (id: string, x: number, y: number, over: Partial<MarkerRequest> = {}): MarkerRequest => ({
  id,
  x,
  y,
  text: id,
  priority: 1,
  wantsBadge: true,
  ...over,
})

describe('an unmeasurable plate', () => {
  it('places nothing rather than guessing, which is the pre-layout and SSR case', () => {
    const requests = [place('a', 100, 100)]
    expect(planMarkers(requests, { ...options(360, 288), plate: { width: 0, height: 0 } })).toEqual({
      markers: [],
      hiddenMarkers: 0,
      hiddenLabels: 0,
    })
    expect(planMarkers(requests, { ...options(360, 288), box: { x: 0, y: 0, w: 0, h: 100 } }).markers).toEqual([])
    expect(planMarkers(requests, { ...options(360, 288), box: { x: 0, y: 0, w: 100, h: 0 } }).markers).toEqual([])
  })

  it('reports nothing hidden, so the legend does not tease a zoom that would change nothing', () => {
    const plan = planMarkers([place('a', 0, 0)], { ...options(360, 288), plate: { width: -1, height: 200 } })
    expect(plan.hiddenMarkers).toBe(0)
    expect(plan.hiddenLabels).toBe(0)
  })
})

describe('a single place on a roomy plate', () => {
  const plan = planMarkers([place('library', 800, 500)], options(1440, 900))

  it('gets a badge and a label, centred under the dot', () => {
    expect(plan.markers).toHaveLength(1)
    expect(plan.markers[0]).toMatchObject({ id: 'library', showBadge: true, showLabel: true, anchor: 'middle' })
    expect(plan.hiddenMarkers).toBe(0)
  })

  it('is the whole plan when nothing competes', () => {
    expect(JSON.stringify(plan)).toContain('"hiddenLabels":0')
  })
})

describe('priority', () => {
  it('lets an arrival point keep the space and drops the major place beside it', () => {
    const plan = planMarkers(
      [place('gate-north', 800, 500, { priority: 0 }), place('library', 802, 501)],
      options(360, 288),
    )
    expect(plan.markers).toHaveLength(1)
    expect(plan.markers[0]?.id).toBe('gate-north')
    expect(plan.hiddenMarkers).toBe(1)
  })

  it('lets a major place outrank a minor one', () => {
    const plan = planMarkers(
      [place('atm', 800, 500, { priority: 2 }), place('hostel-a', 804, 500, { priority: 1 })],
      options(360, 288),
    )
    expect(plan.markers.map((marker) => marker.id)).toEqual(['hostel-a'])
  })

  it('ranks by kind and flag exactly as the brief defines major-first', () => {
    expect(markerPriority('gate', undefined)).toBe(0)
    expect(markerPriority('entrance', undefined)).toBe(0)
    expect(markerPriority('place', true)).toBe(2)
    expect(markerPriority('place', false)).toBe(1)
    expect(markerPriority('place', undefined)).toBe(1)
    expect(markerPriority('junction', undefined)).toBe(1)
  })
})

describe('crowding', () => {
  // A 6 × 7 grid of places spaced 240 world units apart: 133 px apart on a 360 px plate (each 32 px tap
  // target plus its label does not fit), and 598 px apart on a 1440 px plate (everything fits).
  const grid: MarkerRequest[] = []
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 6; col++) grid.push(place(`p${row}-${col}`, 120 + col * 240, 90 + row * 120))
  }

  it('drops markers on a phone plate and keeps them all on a desktop one', () => {
    const phone = planMarkers(grid, options(360, 288))
    const desktop = planMarkers(grid, options(1440, 900))
    expect(phone.markers.length).toBeLessThan(grid.length)
    expect(phone.hiddenMarkers).toBeGreaterThan(0)
    expect(desktop.markers).toHaveLength(grid.length)
    expect(desktop.hiddenMarkers).toBe(0)
    expect(desktop.hiddenLabels).toBe(0)
  })

  it('never lets two tap targets overlap, at either width', () => {
    for (const width of [360, 768, 1440]) {
      const plan = planMarkers(grid, options(width, width === 360 ? 288 : 900))
      const opts = options(width, width === 360 ? 288 : 900)
      const hit = opts.hitPx ?? 32
      const boxes = plan.markers
        .filter((marker) => marker.showBadge)
        .map((marker) => {
          const point = { x: ((marker.x - opts.box.x) / opts.box.w) * opts.plate.width, y: ((marker.y - opts.box.y) / opts.box.h) * opts.plate.height }
          return { ...point, id: marker.id }
        })
      for (const a of boxes) {
        for (const b of boxes) {
          if (a.id >= b.id) continue
          // Axis-aligned squares do not overlap when their Chebyshev separation is at least one box
          // width — the exact condition `planMarkers` enforces, checked rather than trusted.
          const gap = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
          expect(gap, `${a.id} vs ${b.id} at ${width}px`).toBeGreaterThanOrEqual(hit)
        }
      }
    }
  })

  it('is stable: the same file plans the same way twice', () => {
    expect(planMarkers(grid, options(360, 288))).toEqual(planMarkers(grid, options(360, 288)))
  })

  it('returns the plan in file order, not priority order, so React does not remount the layer', () => {
    const requests = [
      place('z-last', 200, 200, { priority: 2 }),
      place('m-middle', 700, 500),
      place('a-first', 1300, 800, { priority: 0 }),
    ]
    const plan = planMarkers(requests, options(1440, 900))
    expect(plan.markers.map((marker) => marker.id)).toEqual(['z-last', 'm-middle', 'a-first'])
  })
})

describe('the plate edges', () => {
  it('flips a label inward instead of running it off the canvas', () => {
    const plan = planMarkers([place('west-gate', 16, 500), place('east-gate', 1584, 500)], options(1440, 900))
    const ids = new Map(plan.markers.map((marker) => [marker.id, marker.anchor]))
    expect(ids.get('west-gate')).toBe('start')
    expect(ids.get('east-gate')).toBe('end')
  })

  it('plans a marker that has just left the plate, and drops one that has left it properly', () => {
    const shifted = options(1440, 900, 700) // camera moved east; the west end of the campus is out of view
    // At -12 px the badge is still partly on screen; at -74 px nothing of it is.
    const plan = planMarkers([place('edge', 680, 500), place('far', 600, 500)], shifted)
    expect(plan.markers.map((marker) => marker.id)).toEqual(['edge'])
  })
})

describe('badges and labels decide independently', () => {
  it('keeps the badge of a place whose long name cannot fit', () => {
    const wide = 'x'.repeat(100)
    const requests = [place('block-a', 400, 500, { text: wide }), place('block-b', 900, 500, { text: wide })]
    // A roomy plate: the two dots are 440 px apart, so both badges fit — but each label is ~680 px wide,
    // so the second one is rejected. Losing the text must not lose the icon.
    const plan = planMarkers(requests, options(1440, 900))
    const a = plan.markers.find((marker) => marker.id === 'block-a')
    const b = plan.markers.find((marker) => marker.id === 'block-b')
    expect(a).toMatchObject({ showBadge: true, showLabel: true })
    expect(b).toMatchObject({ showBadge: true, showLabel: false })
    expect(plan.hiddenLabels).toBe(1)
    expect(plan.hiddenMarkers).toBe(0)
  })

  it('gives a label to something with no icon at all', () => {
    const plan = planMarkers([place('plaza', 800, 500, { wantsBadge: false })], options(360, 288))
    expect(plan.markers[0]).toMatchObject({ showBadge: false, showLabel: true })
  })
})
