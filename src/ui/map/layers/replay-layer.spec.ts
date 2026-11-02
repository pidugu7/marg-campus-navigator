/**
 * The overlay's markup, asserted statically.
 *
 * There is no DOM in the test runner and none will be added, so what a layer can be held to is *what it writes*:
 * one circle per settled vertex, one ring per rival, colours in visit order, and no path before the search has
 * earned one. What this cannot check — whether a pulse reads well at 360 px, whether the dots sit on the
 * walkways — is the live preview's job, and saying so is part of the test rather than a footnote to it.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReplayLayer } from './replay-layer'
import { frameOf } from '../replay-plan'
import type { ReplaySource } from '../replay-plan'
import type { Px } from '../view'

const PLACES = new Map<string, Px>([
  ['a', { x: 0, y: 0 }],
  ['b', { x: 100, y: 0 }],
  ['c', { x: 100, y: 100 }],
  ['d', { x: 0, y: 100 }],
])

function source(overrides: Partial<ReplaySource> = {}): ReplaySource {
  return {
    exploredOrder: ['a', 'b', 'd', 'c'],
    frontierSnapshots: [[], ['d', 'c'], ['c'], []],
    path: ['a', 'b', 'c'],
    seed: 'a',
    ...overrides,
  }
}

const draw = (step: number, positions: ReadonlyMap<string, Px> = PLACES, overrides: Partial<ReplaySource> = {}): string =>
  renderToStaticMarkup(
    createElement(ReplayLayer, {
      frame: frameOf(source(overrides), step),
      positions,
      unitsPerPx: 2,
    }),
  )

describe('the replay overlay', () => {
  it('draws nothing but the seed at step 0, and hides itself from a screen reader', () => {
    const html = draw(0)
    expect(html).toContain('<g class="layer-replay" aria-hidden="true">')
    // The panel says it in words; a group of circles announcing "settled 0 of 4" would be the same sentence
    // twice, and the map is not where the number belongs.
    expect(html).toContain('class="replay-frontier"')
    expect(html.match(/class="replay-node"/g)).toBeNull()
  })

  it('gives each settled vertex a circle, coloured in visit order', () => {
    const html = draw(4)
    expect(html.match(/class="replay-node"/g)).toHaveLength(4)
    expect(html).toContain('style="fill:hsl(187 92% 55%)"')
    expect(html).toContain('style="fill:hsl(268 85% 66%)"')
    // Screen units, scaled the way the pins are: the dot is 4.2 px whatever the zoom, so a countable thing stays
    // countable when the reader leans in.
    expect(html).toContain('transform="translate(0 0) scale(2)"')
    expect(html).toContain('r="4.2"')
  })

  it('marks the vertex just drawn, and only when one was just drawn', () => {
    expect(draw(2)).toContain('class="replay-node--current"')
    expect(draw(0)).not.toContain('replay-node--current')
  })

  it('holds the route back until the search is finished', () => {
    expect(draw(3)).not.toContain('replay-path')
    const html = draw(4)
    expect(html).toContain('class="replay-path"')
    // In walking order, from the frame's own `path` — not in visit order, which would draw the search's growth
    // and call it the answer.
    expect(html).toContain('points="0,0 100,0 100,100"')
  })

  it('draws no path when the search found no route', () => {
    const html = draw(4, PLACES, { path: [] })
    expect(html).toContain('class="replay-node"')
    expect(html).not.toContain('replay-path')
    // …and the frame still says so in its own words, because a refusal replayed is the region the search ran out
    // of, which is the part worth seeing.
    expect(html).toContain('layer-replay')
  })

  it('skips a vertex the map cannot place, rather than drawing it at the origin', () => {
    const partial = new Map<string, Px>([['a', { x: 10, y: 10 }], ['b', { x: 20, y: 20 }]])
    const html = draw(4, partial)
    expect(html.match(/class="replay-node"/g)).toHaveLength(2)
    expect(html).toContain('transform="translate(10 10) scale(2)"')
    // `c` is in the frontier of an earlier frame and in the path, and it is simply absent: a route polyline of
    // one point is not a line, so nothing is drawn rather than something wrong.
    expect(html).not.toContain('replay-path')
  })
})
