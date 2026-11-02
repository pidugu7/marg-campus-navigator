/**
 * The comparison table, as markup — including the parts a screen reader is the only intended audience for.
 *
 * A `<table>` is the accessible way to cross-read six numbers by three rows, and `role="region"` with a caption
 * is what makes the 360 px horizontal scroll keyboard-operable instead of a trap. Both are assertions about the
 * emitted string rather than about a rendered page, and the caption is checked as *content*: a heading is read
 * with the table, so the explanation of the bold marks has to be in there and not in a tooltip nobody can open.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CompareTable } from './compare-table'
import type { CompareRow } from './compare-plan'
import type { RouteAlgorithmChoice } from '@/hooks/useRoute'

const label = (algorithm: RouteAlgorithmChoice): string =>
  algorithm === 'dijkstra' ? 'Dijkstra' : algorithm === 'a-star' ? 'A*' : 'BFS'

function row(algorithm: RouteAlgorithmChoice, over: Partial<CompareRow>): CompareRow {
  return {
    algorithm,
    found: true,
    cost: 100,
    metres: 100,
    minutes: 10,
    expanded: 39,
    ms: 7,
    segments: 5,
    nodeIds: ['a', 'b', 'c', 'd', 'e', 'f'],
    ...over,
  }
}

const three = (): CompareRow[] => [
  row('dijkstra', { ms: 7 }),
  row('a-star', { expanded: 14, ms: 9 }),
  row('bfs', { metres: 150, cost: 150, minutes: 15, expanded: 21, segments: 3, ms: 11 }),
]

const draw = (rows: readonly CompareRow[], insight = 'An insight.'): string =>
  renderToStaticMarkup(
    createElement(CompareTable, { rows, labelOf: label, profileLabel: 'Shortest walk', insight }),
  )

describe('the compare table', () => {
  it('is a real table, with the explanation in the caption', () => {
    const html = draw(three())
    expect(html).toContain('<table class="compare-table">')
    expect(html).toContain('<caption class="compare-caption">')
    expect(html).toContain('Shortest walk')
    expect(html).toContain('a tie marks every row that tied')
    expect(html).toContain('it decides nothing')
    // Six column headers (the row-head column plus five numbers), three row headers, and every one scoped: a
    // cell that does not know its header is a cell a reader cannot name.
    expect(html.match(/scope="col"/g)).toHaveLength(6)
    expect(html.match(/scope="row"/g)).toHaveLength(3)
  })

  it('marks the best value in each deciding column, and every row tied for it', () => {
    const html = draw(three())
    // metres {D,A}, minutes {D,A}, settled {A}, segments {BFS} — six cells, counted rather than eyeballed.
    expect(html.match(/compare-cell--best/g)).toHaveLength(6)
    expect(html).toContain('>100.0 m<')
    expect(html).toContain('>14<')
    expect(html).toContain('>3<')
    // The mark is not only a colour: each best cell says so in text a reader hears.
    expect(html.match(/class="sr-only"/g)).toHaveLength(6)
    expect(html).toContain(', best of the searches that found a route')
  })

  it('leaves the timing column unmarked, and labels it indicative', () => {
    const html = draw(three())
    // The tag is the visible half of the label; the caption is the announced half. Counting the *tag*, not the
    // word, because the word appears in both by design.
    expect(html.match(/<span class="compare-flag">indicative<\/span>/g)).toHaveLength(1)
    // Every `ms` value is distinct in this fixture, so any of them appearing next to `--best` would be the bug.
    for (const ms of ['>7 ms<', '>9 ms<', '>11 ms<']) {
      expect(html).toContain(ms)
    }
    expect(html).not.toContain('compare-cell--best">7 ms')
    expect(html).not.toContain('compare-cell--best">9 ms')
    expect(html).not.toContain('compare-cell--best">11 ms')
  })

  it('writes “no route” where a number would have been, and gives a refusal no marks', () => {
    const rows = [
      row('dijkstra', {}),
      row('a-star', { expanded: 14, segments: 4 }),
      row('bfs', { found: false, metres: 0, minutes: 0, segments: 0, expanded: 4 }),
    ]
    const html = draw(rows)
    expect(html.match(/>no route</g)).toHaveLength(5)
    // Six marks: both rows tie on distance and time, A* wins settled vertices and segments. The refusal's zeroes
    // win nothing, which is the whole reason `bestIn` filters on `found` before it looks for a minimum.
    expect(html.match(/compare-cell--best/g)).toHaveLength(6)
    expect(html).toContain('>100.0 m<')
    expect(html).not.toContain('compare-cell--best">0.0 m')
  })

  it('refuses to compare one answer against itself', () => {
    const html = draw([row('dijkstra', {}), row('a-star', { found: false, metres: 0, minutes: 0, segments: 0 }), row('bfs', { found: false, metres: 0, minutes: 0, segments: 0 })])
    expect(html.match(/compare-cell--best/g)).toBeNull()
    expect(html).toContain('scope="row"')
  })

  it('puts a scrollable region under the table at small widths, and names it', () => {
    const html = draw(three())
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Comparison of three searches"')
    // `tabindex=0` is what lets a keyboard reader scroll the overflow rather than lose the last two columns.
    expect(html).toContain('tabindex="0"')
  })

  it('repeats the lane pattern in the row head, so the map and the table can be matched without colour', () => {
    const html = draw(three())
    for (const pattern of ['solid line', 'long dashes', 'short dashes']) {
      expect(html, pattern).toContain(`data-pattern="${pattern}"`)
    }
    expect(html.match(/data-pattern="/g)).toHaveLength(3)
    // One class, three patterns: the swatch cannot vary by hue, because beside the map it has to be readable
    // with the colours taken away.
    expect(html.match(/class="compare-swatch-line"/g)).toHaveLength(3)
    expect(html).not.toContain('compare-swatch-line--')
  })

  it('prints the insight it was given, unchanged, next to the numbers', () => {
    const sentence = 'Same answer, different work: 100.0 m from all three.'
    const html = draw(three(), sentence)
    expect(html).toContain(`<figcaption class="compare-insight">${sentence}</figcaption>`)
    // The table adds no numbers of its own to that sentence — the figures come from the rows, and the component
    // that formats them is `compareInsight`, which has its own spec.
    expect(html).toContain('</figure>')
  })
})
