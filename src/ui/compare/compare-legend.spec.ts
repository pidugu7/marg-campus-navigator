/**
 * The legend, in words — which is the whole point of it.
 *
 * The requirement is that a reader never needs colour to know which line is which. A test for that has to look
 * for *words*: the dash pattern's name and the lane's side, per algorithm, next to the swatch that shows it. If a
 * stylesheet later makes the swatch the only cue, this fails before a projector does.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CompareLegend } from './compare-legend'
import type { CompareRow } from './compare-plan'
import type { RouteAlgorithmChoice } from '@/hooks/useRoute'

function row(algorithm: RouteAlgorithmChoice, over: Partial<CompareRow> = {}): CompareRow {
  return {
    algorithm,
    found: true,
    cost: 100,
    metres: 100,
    minutes: 10,
    expanded: 39,
    ms: 1,
    segments: 5,
    nodeIds: ['a', 'b'],
    ...over,
  }
}

const label = (algorithm: RouteAlgorithmChoice): string =>
  algorithm === 'dijkstra' ? 'Dijkstra' : algorithm === 'a-star' ? 'A*' : 'BFS'

const draw = (rows: readonly CompareRow[]): string =>
  renderToStaticMarkup(createElement(CompareLegend, { rows, labelOf: label }))

describe('the compare legend', () => {
  it('names every lane by shape and side, not by hue', () => {
    const html = draw([row('dijkstra'), row('a-star'), row('bfs')])
    // `<li ` with the space, because `<li` alone matches `<line`, and the swatches are full of those.
    expect(html.match(/<li /g)).toHaveLength(3)
    expect(html).toContain('Dijkstra')
    expect(html).toContain('solid line, drawn on the walkway')
    expect(html).toContain('long dashes, drawn to a walker’s left')
    expect(html).toContain('short dashes, drawn to a walker’s right')
  })

  it('has a heading, so the list is not a mystery box under a table', () => {
    const html = draw([row('dijkstra')])
    expect(html).toContain('class="compare-legend-title"')
    expect(html).toContain('On the map')
    expect(html).toContain('<ul')
  })

  it('says what a search that found nothing does to the map', () => {
    const withRefusal = draw([row('dijkstra'), row('bfs', { found: false, nodeIds: [] })])
    expect(withRefusal).toContain('compare-legend-note')
    expect(withRefusal).toContain('draws nothing')
    expect(withRefusal).toContain('“no route”')
    expect(draw([row('dijkstra'), row('a-star'), row('bfs')])).not.toContain('compare-legend-note')
  })

  it('carries one swatch per row, each describing its own pattern', () => {
    const html = draw([row('dijkstra'), row('a-star'), row('bfs')])
    expect(html.match(/<svg/g)).toHaveLength(3)
    expect(html.match(/data-pattern="/g)).toHaveLength(3)
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(3)
  })
})
