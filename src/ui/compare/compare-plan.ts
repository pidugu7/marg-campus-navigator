/**
 * Compare mode, as arithmetic.
 *
 * Three searches over one query, one row each, and then three decisions — none of which belongs in a component:
 * which value in a column is the best, how a route is drawn so that it does not hide a rival, and what the
 * numbers mean in a sentence. All three live here, so a spec can pin them without a browser and so the table,
 * the overlay and the insight cannot drift apart from one another.
 *
 * One decision is worth stating before the code: **`ms` is in the table and out of every comparison.** Timing a
 * search that takes under a millisecond measures the just-in-time compiler, not the algorithm, and
 * `RouteMetrics.ms` is whole milliseconds — at campus scale all three rows usually read `0`. The column is shown
 * because a learner should see that the cost of these searches is invisible at this size, and because it becomes
 * interesting on the 10 000-node graph in cp5. `decides: false` is what stops the UI crowning a winner in it.
 */
import type { RouteAlgorithmChoice } from '@/hooks/useRoute'
import type { Px } from '@/ui/map/view'

/** The three searches, in the order a reader should meet them: the two optimal ones, then the naive one. */
export const COMPARE_ORDER: readonly RouteAlgorithmChoice[] = ['dijkstra', 'a-star', 'bfs']

/**
 * One search's answer, in the five numbers the table prints.
 *
 * No `label` field, on purpose: what a row is *called* belongs to the picker's table (`route-options.ts`), and a
 * second copy of a name is a second thing to keep in step. `App` supplies labels through `algorithmChoice`, and
 * the plan module stays a hook-shaped data structure rather than a UI one.
 */
export interface CompareRow {
  readonly algorithm: RouteAlgorithmChoice
  readonly found: boolean
  /** Profile-weighted total: the number two algorithms may legitimately agree on under a preference. */
  readonly cost: number
  readonly metres: number
  readonly minutes: number
  /** Vertices settled: what the search cost, not what the walk costs. */
  readonly expanded: number
  readonly ms: number
  /** Walkway segments on the route — the one thing breadth-first optimises, by construction. */
  readonly segments: number
  readonly nodeIds: readonly string[]
}

export type ColumnKey = 'metres' | 'minutes' | 'expanded' | 'ms' | 'segments'

export interface CompareColumn {
  readonly key: ColumnKey
  readonly label: string
  /** What the number counts: the `<abbr>`'s expansion, and the first thing a reader needs to know. */
  readonly hint: string
  /** `false` for a column that is informative but not a competition. */
  readonly decides: boolean
}

/** The table's shape, in the order the columns are printed. */
export const COLUMNS: readonly CompareColumn[] = [
  { key: 'metres', label: 'Distance', hint: 'length of the walk, in metres', decides: true },
  { key: 'minutes', label: 'Walking time', hint: 'minutes at this preference’s pace', decides: true },
  { key: 'expanded', label: 'Vertices settled', hint: 'vertices the search drew off its frontier', decides: true },
  { key: 'ms', label: 'Search time', hint: 'whole milliseconds — indicative, and not a ranking', decides: false },
  { key: 'segments', label: 'Segments', hint: 'walkways on the route; breadth-first minimises this', decides: true },
]

/** Only a row with a route in it can win anything; a refusal has no distance to compare. */
function comparable(rows: readonly CompareRow[]): readonly CompareRow[] {
  return rows.filter((row) => row.found)
}

/**
 * Which algorithms are tied for best in `column`, as a set of names.
 *
 * Lower wins in every column this app has, and a tie marks *all* tied rows: when A* and Dijkstra both reach
 * 1 517.7 m, marking one would be a claim about tie-breaking the data does not support. A column that does not
 * decide returns the empty set, and so does a query where fewer than two searches found a walk — nothing is
 * "best" of one, and it would be a lie about two.
 */
export function bestIn(rows: readonly CompareRow[], column: CompareColumn): ReadonlySet<RouteAlgorithmChoice> {
  if (!column.decides) return new Set<RouteAlgorithmChoice>()
  const live = comparable(rows)
  if (live.length < 2) return new Set<RouteAlgorithmChoice>()
  const value = (row: CompareRow): number => row[column.key]
  const min = live.reduce((best, row) => (value(row) < best ? value(row) : best), Number.POSITIVE_INFINITY)
  return new Set(live.filter((row) => value(row) === min).map((row) => row.algorithm))
}

/**
 * The lateral shift, in screen pixels, that keeps three coincident routes visible.
 *
 * Dijkstra keeps the corridor in the middle and the other two are pushed one spacing either way. The offsets are
 * fixed per algorithm rather than derived from geometry, which is what *guarantees* no two lines can land on
 * each other — including when all three searches walk the same ten metres in the same direction.
 */
/**
 * How far a lane sits from the walkway, in screen pixels.
 *
 * The number has to be *bigger than the stroke*, or three lanes are one thick line and the separation is a
 * fiction the code believes and the screen does not show: 4 px of offset against the 3 px line in `map.css`,
 * which `src/test/route-styles.spec.ts` checks rather than trusts. Both numbers are in the same file's eye-catch
 * range for a reason — a reader who makes the lines thicker has to move the lanes, and the test says so.
 */
export const LANE_OFFSET_PX = 4

export function offsetPxOf(algorithm: RouteAlgorithmChoice): number {
  if (algorithm === 'dijkstra') return 0
  return algorithm === 'a-star' ? LANE_OFFSET_PX : -LANE_OFFSET_PX
}

/**
 * A segment moved sideways by `offsetUnits` world units, perpendicular to itself.
 *
 * Per *segment*, not per polyline: a route that turns 90° has no single normal, and mitering three of those
 * against each other is how a coincident overlay grows spikes. Each line keeps its own normal, and the round
 * caps the layer puts on them make the joints read continuous. Length is preserved because a translation is an
 * isometry, which the spec pins as a property rather than as a hope.
 */
export function shiftedSegment(a: Px, b: Px, offsetUnits: number): readonly [number, number, number, number] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return [a.x, a.y, b.x, b.y]
  // The normal of `a → b` is `(dy, -dx)`; both endpoints move by it, so the shift cannot change the length.
  const nx = (dy / length) * offsetUnits
  const ny = (-dx / length) * offsetUnits
  return [a.x + nx, a.y + ny, b.x + nx, b.y + ny]
}

export interface DashStyle {
  readonly name: string
  /** Screen pixels. The layer multiplies by `unitsPerPx`, so the pattern is the same size at every zoom. */
  readonly dash: number
  readonly gap: number
}

/**
 * How each search's route is drawn: three patterns distinguishable without colour, because the legend names the
 * shape in words and the table repeats the swatch. A black-and-white printout of this app still reads.
 */
export function dashStyleOf(algorithm: RouteAlgorithmChoice): DashStyle {
  if (algorithm === 'dijkstra') return { name: 'solid line', dash: 0, gap: 0 }
  if (algorithm === 'a-star') return { name: 'long dashes', dash: 9, gap: 5 }
  return { name: 'short dashes', dash: 2.5, gap: 3.5 }
}

/**
 * How the lane is described to a reader, in the walker's own frame rather than the map's: what "left" means to
 * a y-down SVG is a detail, and what it means to someone walking the corridor is not.
 */
export function laneNameOf(algorithm: RouteAlgorithmChoice): string {
  const offset = offsetPxOf(algorithm)
  if (offset === 0) return 'drawn on the walkway'
  return offset > 0 ? 'drawn to a walker’s left' : 'drawn to a walker’s right'
}

/** The same pattern as a `stroke-dasharray` string in world units at a given scale, or `null` for a solid line. */
export function dashArrayString(style: DashStyle, unitsPerPx: number): string | null {
  if (style.dash === 0) return null
  const at = (px: number): string => String(Math.round(px * unitsPerPx * 100) / 100)
  return `${at(style.dash)} ${at(style.gap)}`
}

/**
 * What a drawing needs from a row: which search, and which vertices. A projection with a rule attached — a route
 * of one vertex has no segment to draw, and a refusal has no route at all — so the layer cannot invent a line and
 * the table cannot lose a row. `App` calls this once, and the map never learns that a `ms` field exists.
 */
export interface CompareLane {
  readonly algorithm: RouteAlgorithmChoice
  readonly nodeIds: readonly string[]
}

export function lanesOf(rows: readonly CompareRow[]): readonly CompareLane[] {
  return rows
    .filter((row) => row.found && row.nodeIds.length > 1)
    .map((row) => ({ algorithm: row.algorithm, nodeIds: row.nodeIds }))
}

export interface InsightContext {
  /** So "you picked the same place twice" can be said out loud, before any number is quoted. */
  readonly sameEndpoint: boolean
  /** The preference name, because "the same walkway" means something different under `shaded` than under `shortest`. */
  readonly profile: string
  readonly labelOf: (algorithm: RouteAlgorithmChoice) => string
}

const tenth = (value: number): string => (Math.round(value * 10) / 10).toFixed(1)
const whole = (value: number): string => String(Math.round(value))

/**
 * One plain-English sentence about the three rows, built from the numbers and from nothing else.
 *
 * The spec for this function asserts a property no example-based test can: every figure in the output appears in
 * the input. That is what "generated, never hard-coded" means when someone checks it. Six cases, because these
 * are the ones a reader meets on a real campus, and a sentence that is wrong once is never trusted again:
 *
 * 1. nothing asked, or a refusal — say which, and never imply a search that did not happen;
 * 2. the same place twice, where the walk is zero and the agreement is for the least interesting reason;
 * 3. all three *identical*, work included, which is a finding about the query rather than about the algorithms;
 * 4. the same walk, different work — A* ties Dijkstra's answer and settles fewer vertices (the headline case);
 * 5. breadth-first costing the same under this preference while being longer in metres — fewest segments is not
 *    fewest metres, and a tie in `cost` is not a tie in the walk;
 * 6. anything else: rank the rows and report the gap, without claiming a lesson the numbers do not carry.
 */
export function compareInsight(rows: readonly CompareRow[], context: InsightContext): string {
  if (rows.length === 0) return 'Nothing asked yet, so there is nothing to compare.'
  if (context.sameEndpoint) {
    return 'That is the same place twice: every search answers with a walk of 0.0 m, so what is left to compare is work, not distance.'
  }
  const live = comparable(rows)
  if (live.length === 0) {
    return `None of the three found a walk under the “${context.profile}” preference, so there is no distance to compare. Replay one of them to see how much of the campus they did reach.`
  }
  if (live.length !== rows.length) {
    const yes = live.map((row) => context.labelOf(row.algorithm)).join(' and ')
    const no = rows
      .filter((row) => !row.found)
      .map((row) => context.labelOf(row.algorithm))
      .join(' and ')
    return `${yes} found a walk; ${no} did not. Three searches over one graph with one closure set cannot disagree about *whether* a route exists, so read that as a bug report rather than a result.`
  }
  const rowOf = new Map(live.map((row) => [row.algorithm, row]))
  const dijkstra = rowOf.get('dijkstra')
  const aStar = rowOf.get('a-star')
  const bfs = rowOf.get('bfs')
  if (dijkstra === undefined || aStar === undefined || bfs === undefined) {
    return 'Fewer than three searches answered, so no comparison is being claimed.'
  }
  const samePathAs = (other: CompareRow): boolean =>
    dijkstra.nodeIds.length === other.nodeIds.length &&
    dijkstra.nodeIds.every((id, index) => id === other.nodeIds[index])
  const allSamePath = samePathAs(aStar) && samePathAs(bfs)
  const gapDijkstra = dijkstra.expanded - aStar.expanded

  if (allSamePath && gapDijkstra === 0 && dijkstra.segments === bfs.segments) {
    return `All three return the same ${tenth(dijkstra.metres)} m walk over ${whole(dijkstra.segments)} segments and settle the same ${whole(dijkstra.expanded)} vertices, so this query has no lesson in it: on a map this small the searches are indistinguishable.`
  }
  if (allSamePath) {
    const saved = gapDijkstra > 0 ? `settles ${whole(aStar.expanded)} where Dijkstra needs ${whole(dijkstra.expanded)}` : `settles ${whole(aStar.expanded)}, no better than Dijkstra’s ${whole(dijkstra.expanded)} here`
    return `Same answer, different work: all three walk the identical ${tenth(dijkstra.metres)} m route, and A* ${saved} — the estimate changes how the search runs, not what it finds.`
  }
  if (dijkstra.metres === aStar.metres && bfs.cost === dijkstra.cost && bfs.metres > dijkstra.metres) {
    return `Breadth-first's walk costs exactly the same (${whole(bfs.cost)}) as Dijkstra’s under “${context.profile}”, yet it measures ${tenth(bfs.metres)} m against ${tenth(dijkstra.metres)} m — it takes ${whole(bfs.segments)} segments where the shortest route takes ${whole(dijkstra.segments)}, and fewest segments is a different question from fewest metres.`
  }
  if (dijkstra.metres === aStar.metres) {
    return `A* and Dijkstra agree on the walk — ${tenth(dijkstra.metres)} m — while breadth-first answers ${tenth(bfs.metres)} m, and the two optimal searches settle ${whole(aStar.expanded)} and ${whole(dijkstra.expanded)} vertices to prove it.`
  }
  const ranked = [...live].sort((left, right) => left.metres - right.metres)
  const best = ranked[0] as CompareRow
  const worst = ranked[ranked.length - 1] as CompareRow
  return `The shortest answer is ${context.labelOf(best.algorithm)} at ${tenth(best.metres)} m; the longest is ${context.labelOf(worst.algorithm)} at ${tenth(worst.metres)} m, ${tenth(worst.metres - best.metres)} m more, over ${whole(best.segments)} segments against ${whole(worst.segments)}.`
}
