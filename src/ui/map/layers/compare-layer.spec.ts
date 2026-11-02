/**
 * Three lanes of line, asserted as markup.
 *
 * The property that matters here is separation, not beauty: when two searches walk the same corridor, the
 * second must not be drawn on top of the first. That is a statement about coordinates, so it can be tested
 * without a browser — the same trick the replay uses, and the one thing a "looks fine in the preview" review
 * would miss on a day when the two routes happen to differ.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CompareLayer } from './compare-layer'
import { lanesOf } from '@/ui/compare/compare-plan'
import type { CompareRow } from '@/ui/compare/compare-plan'
import type { Px } from '../view'
import type { RouteAlgorithmChoice } from '@/hooks/useRoute'

const PLACES = new Map<string, Px>([
  ['a', { x: 0, y: 0 }],
  ['b', { x: 100, y: 0 }],
  ['c', { x: 100, y: 100 }],
  ['d', { x: 0, y: 100 }],
])

function row(algorithm: RouteAlgorithmChoice, over: Partial<CompareRow> = {}): CompareRow {
  return {
    algorithm,
    found: true,
    cost: 1,
    metres: 1,
    minutes: 1,
    expanded: 1,
    ms: 0,
    segments: 1,
    nodeIds: ['a', 'b'],
    ...over,
  }
}

const draw = (rows: readonly CompareRow[], unitsPerPx = 1): string =>
  renderToStaticMarkup(createElement(CompareLayer, { lanes: lanesOf(rows), positions: PLACES, unitsPerPx }))

describe('the compare overlay', () => {
  it('draws nothing at all when there is nothing to draw', () => {
    expect(draw([])).toBe('')
    expect(draw([row('bfs', { found: false, nodeIds: [] })])).toBe('')
    // A one-vertex "route" has no segment: drawing a dot-sized stub would be a route that does not exist.
    expect(draw([row('dijkstra', { nodeIds: ['a'] })])).toBe('')
  })

  it('hides itself from a screen reader, because the table is the readable half', () => {
    const html = draw([row('dijkstra')])
    expect(html).toContain('<g class="layer-compare" aria-hidden="true">')
    expect(html).toContain('class="compare-line compare-line--dijkstra"')
  })

  it('puts each algorithm in its own lane, so a shared corridor is three lines and not one', () => {
    const html = draw([row('dijkstra'), row('a-star'), row('bfs')])
    const lanes = [...html.matchAll(/y1="(-?[\d.]+)"/g)].map((match) => String(match[1]))
    expect(new Set(lanes).size).toBe(3)
    // Dijkstra keeps the walkway to itself, and the other two sit one offset either side of it — which is what
    // makes three coincident routes three visible lines rather than whichever was painted last.
    expect(lanes).toEqual(['0', '-4', '4'])
  })

  it('gives each lane its own pattern, in world units that follow the zoom', () => {
    const html = draw([row('dijkstra'), row('a-star'), row('bfs')], 2)
    expect(html).not.toContain('dijkstra" stroke-dasharray')
    expect(html).toContain('stroke-dasharray="18 10"')
    expect(html).toContain('stroke-dasharray="5 7"')
    // The legend and the layer agree because they read the same table; the numbers here are the proof.
    expect(html.match(/stroke-dasharray/g)).toHaveLength(2)
  })

  it('names the lane in the markup, so the legend can be checked against it', () => {
    const html = draw([row('dijkstra'), row('a-star')])
    expect(html).toContain('data-lane="drawn on the walkway"')
    expect(html).toContain('data-lane="drawn to a walker’s left"')
  })

  it('keeps the segments it can place and drops only the ones it cannot', () => {
    const html = draw([row('dijkstra', { nodeIds: ['a', 'b', 'zz', 'c'] })])
    // a→b is placeable; b→zz and zz→c are not, and both are dropped rather than drawn to a guessed position —
    // an endpoint at the origin is how an overlay starts lying about a route.
    expect(html.match(/<line/g)).toHaveLength(1)
    expect(html).toContain('x2="100"')
    expect(html).not.toContain('y2="100"')
  })
})
