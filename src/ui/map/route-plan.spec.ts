/**
 * The route's geometry, as a unit. Everything here is a function of "a list of ids" and "a lookup", so the
 * awkward cases — a hole in the middle of the path, start equal to destination, an empty route — are cheaper to
 * pin than to argue about, and the layer that consumes this has no logic left to test.
 */
import { describe, expect, it } from 'vitest'
import { planRoute } from './route-plan'
import type { Px } from './view'

const AT: Record<string, Px> = {
  a: { x: 0, y: 0 },
  b: { x: 100, y: 0 },
  c: { x: 100, y: 100 },
  d: { x: 0, y: 100 },
  dup: { x: 0, y: 0 },
}
const positions = new Map(Object.entries(AT))

describe('planRoute', () => {
  it('turns a path into the polyline a walker would recognise', () => {
    const plan = planRoute(['a', 'b', 'c', 'd'], positions)
    expect(plan.points).toEqual([AT.a, AT.b, AT.c, AT.d])
    // Walking order, not sorted geometry: the line has to follow the route, and a polyline that visits the
    // corners in coordinate order draws a bow tie.
    expect(plan.skipped).toBe(0)
    expect(plan.samePlace).toBe(false)
  })

  it('draws two pins at both ends of a real walk', () => {
    const plan = planRoute(['a', 'b'], positions)
    expect(plan.start).toEqual({ x: 0, y: 0 })
    expect(plan.end).toEqual({ x: 100, y: 0 })
  })

  it('refuses to draw a line across a hole in the middle of the path', () => {
    // `ghost` is a vertex the model has no coordinates for. The tempting implementation drops it and carries
    // on, which would draw `a → c` — a straight segment over whatever stands where `ghost` should be. The
    // route is then a fiction, and the fiction is the most confident-looking thing on screen.
    const plan = planRoute(['a', 'ghost', 'c'], positions)
    expect(plan.points).toEqual([])
    expect(plan.skipped).toBe(1)
    // The ends are still true, so they are still drawn: the map says where the walk starts and stops even when
    // it will not claim to know how it got between them.
    expect(plan.start).toEqual(AT.a)
    expect(plan.end).toEqual(AT.c)
  })

  it('keeps the pin it can place when an endpoint is missing', () => {
    const plan = planRoute(['ghost', 'b', 'c'], positions)
    expect(plan.start).toBeNull()
    expect(plan.end).toEqual(AT.c)
    expect(plan.points).toEqual([])
    expect(plan.skipped).toBe(1)
  })

  it('shows one pin, not a stack of two, when the walk is nowhere', () => {
    // `from === to` is a legal query and every search answers it with a 0 m route, one vertex.
    const plan = planRoute(['a'], positions)
    expect(plan.samePlace).toBe(true)
    expect(plan.start).toEqual(AT.a)
    expect(plan.end).toEqual(AT.a)
    // The line's own condition — more than one point — is what keeps it off the plate here, so `points` is
    // allowed to hold the single vertex rather than being emptied for it.
    expect(plan.points).toEqual([AT.a])
  })

  it('treats two different nodes at the same coordinate as one place', () => {
    // A hand-edited plan can put an entrance on top of its junction. That is a 0 m walk and the honest picture
    // is one pin; `dup` and `a` are different ids at the same point.
    const plan = planRoute(['a', 'dup'], positions)
    expect(plan.samePlace).toBe(true)
    expect(plan.skipped).toBe(0)
    expect(plan.points).toHaveLength(2)
  })

  it('draws nothing at all for an empty route', () => {
    const plan = planRoute([], positions)
    expect(plan).toEqual({ points: [], start: null, end: null, skipped: 0, samePlace: false })
  })

  it('copes with an empty lookup, because a dropped dataset is a real state', () => {
    // `useCampus` hands the map a model that can be entirely unusable — every row rejected by the validator.
    // Then there are no positions to look up, and the map must show an empty plate rather than crash.
    const plan = planRoute(['a', 'b'], new Map())
    expect(plan.start).toBeNull()
    expect(plan.end).toBeNull()
    expect(plan.skipped).toBe(2)
  })
})
