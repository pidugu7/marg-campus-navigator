/**
 * The comparison, as a real table.
 *
 * Real `<table>` markup with a `<caption>`, `scope` on every header and the winner named in text, because this is
 * the one part of the app whose whole job is *cross-reading*: six numbers per row, three rows, and a reader has
 * to be able to ask "which of these settled fewest?" without a mouse. A grid of divs would look the same and
 * mean nothing to the software that reads it aloud — a caption is announced with the table, `scope="col"` is what
 * makes a cell's header travel with it, and `compare-cell--best` on its own is a colour, which is why the
 * sentence is in the cell too.
 *
 * The bolding rule comes from `bestIn`, and the timing column carries no rule at all: `decides: false` in the plan
 * module is what stops this file from ranking a measurement that is mostly scheduler noise.
 */
import { COLUMNS, bestIn } from './compare-plan'
import type { CompareColumn, CompareRow } from './compare-plan'
import { CompareSwatch } from './compare-swatch'
import type { RouteAlgorithmChoice } from '@/hooks/useRoute'

export interface CompareTableProps {
  readonly rows: readonly CompareRow[]
  readonly labelOf: (algorithm: RouteAlgorithmChoice) => string
  /** The preference the three searches shared, because "distance" means something else under `shaded`. */
  readonly profileLabel: string
  /** The generated sentence, from `compareInsight`. This file adds no numbers of its own. */
  readonly insight: string
}

function cellText(row: CompareRow, column: CompareColumn): string {
  if (!row.found) return 'no route'
  const value = row[column.key]
  if (column.key === 'metres') return `${value.toFixed(1)} m`
  if (column.key === 'minutes') return `${value.toFixed(1)} min`
  if (column.key === 'ms') return `${String(value)} ms`
  return String(value)
}

export function CompareTable({ rows, labelOf, profileLabel, insight }: CompareTableProps) {
  const marked = new Map(COLUMNS.map((column) => [column.key, bestIn(rows, column)]))
  return (
    <figure className="compare-figure">
      {/* A region, focusable, because at 360 px the five columns do not all fit and a keyboard reader must be
          able to scroll the table without scrolling the page under it. */}
      <div className="compare-body" role="region" aria-label="Comparison of three searches" tabIndex={0}>
        <table className="compare-table">
          <caption className="compare-caption">
            {`One query — ${labelOf('dijkstra')}, ${labelOf('a-star')} and ${labelOf('bfs')} — under the “${profileLabel}” preference. Bold marks the best value in a column, and a tie marks every row that tied. Search time is indicative: it is whole milliseconds, and it decides nothing.`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Search</th>
              {COLUMNS.map((column) => (
                <th key={column.key} scope="col">
                  <abbr title={column.hint}>{column.label}</abbr>
                  {column.decides ? null : <span className="compare-flag">indicative</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.algorithm}>
                <th scope="row" className="compare-rowhead">
                  <CompareSwatch algorithm={row.algorithm} />
                  {labelOf(row.algorithm)}
                </th>
                {COLUMNS.map((column) => {
                  const best = marked.get(column.key)?.has(row.algorithm) === true
                  return (
                    <td key={column.key} className={best ? 'compare-cell compare-cell--best' : 'compare-cell'}>
                      {cellText(row, column)}
                      {best ? <span className="sr-only">, best of the searches that found a route</span> : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* The generated sentence, next to the numbers it was generated from — and visible, because a learner who
          cannot see the table cannot use a sentence about it. */}
      <figcaption className="compare-insight">{insight}</figcaption>
    </figure>
  )
}
