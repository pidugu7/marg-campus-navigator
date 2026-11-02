/**
 * What the three lines on the map mean, in words.
 *
 * Colour is not in this list, and that is the requirement rather than an omission: the pattern names the search
 * and the lane says where to look for it when all three walk the same corridor. A reader on a projector, a reader
 * with a colour vision deficiency and a reader printing the page in greyscale all get the same answer, and the
 * hues the stylesheet adds on top are decoration they can ignore.
 */
import { dashStyleOf, laneNameOf } from './compare-plan'
import type { CompareRow } from './compare-plan'
import { CompareSwatch } from './compare-swatch'
import type { RouteAlgorithmChoice } from '@/hooks/useRoute'

export interface CompareLegendProps {
  readonly rows: readonly CompareRow[]
  readonly labelOf: (algorithm: RouteAlgorithmChoice) => string
}

export function CompareLegend({ rows, labelOf }: CompareLegendProps) {
  return (
    <div className="compare-legend">
      <p className="compare-legend-title">On the map</p>
      <ul className="compare-legend-list">
        {rows.map((row) => (
          <li key={row.algorithm} className="compare-legend-item">
            <CompareSwatch algorithm={row.algorithm} />
            <span className="compare-legend-name">{labelOf(row.algorithm)}</span>
            <span className="compare-legend-lane">{`${dashStyleOf(row.algorithm).name}, ${laneNameOf(row.algorithm)}`}</span>
          </li>
        ))}
      </ul>
      {rows.some((row) => !row.found) ? (
        <p className="compare-legend-note">
          A search that found no route draws nothing: an absence on the map and a row that says “no route” are the
          same statement, and the map should not invent a line to make it.
        </p>
      ) : null}
    </div>
  )
}
