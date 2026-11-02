/**
 * The pattern, drawn small, so a table row and a map lane can be matched without colour.
 *
 * An inline `<svg>` rather than a text description because the legend's job is *comparison*: a reader scanning
 * six lines of prose and a map does not hold three dash patterns in mind. The geometry comes from the same
 * `dashStyleOf` the layer uses, so what is shown here is what is painted there — which is the sentence that
 * makes this component worth having at all.
 *
 * Note the prop name below, because it is the one thing in this file that cannot be typed into a visible
 * failure: React rejects the hyphenated SVG attribute with a console warning and drops the attribute in a
 * browser, while `renderToStaticMarkup` still writes it out. A markup test therefore passes on a screen where
 * the dashes never appear. `strokeDasharray` in, `stroke-dasharray` on the DOM — and `route-styles.spec.ts`
 * asserts the source uses the camelCase form, since nothing else can.
 */
import { dashStyleOf } from './compare-plan'
import type { RouteAlgorithmChoice } from '@/hooks/useRoute'

const WIDTH = 30
const MID = 4

export interface CompareSwatchProps {
  readonly algorithm: RouteAlgorithmChoice
  /** Screen pixels per unit; the legend uses 1, and only the map's own scale changes it. */
  readonly unitsPerPx?: number
}

export function CompareSwatch({ algorithm, unitsPerPx = 1 }: CompareSwatchProps) {
  const style = dashStyleOf(algorithm)
  const dash = Math.round(style.dash * unitsPerPx * 100) / 100
  const gap = Math.round(style.gap * unitsPerPx * 100) / 100
  return (
    <svg
      className="compare-swatch"
      width={WIDTH}
      height={8}
      viewBox={`0 0 ${String(WIDTH)} 8`}
      aria-hidden="true"
      data-pattern={style.name}
    >
      {/* `currentColor`, deliberately: the swatch's whole job is shape, so it wears whatever colour the text
          beside it wears and never a hue of its own. The map's lanes add colour on top of the pattern; a legend
          that needed colour to be readable would be a legend that had failed its requirement. */}
      <line
        x1={0}
        y1={MID}
        x2={WIDTH}
        y2={MID}
        className="compare-swatch-line"
        {...(style.dash === 0 ? {} : { strokeDasharray: `${String(dash)} ${String(gap)}` })}
      />
    </svg>
  )
}
