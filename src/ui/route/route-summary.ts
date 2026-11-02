/**
 * The numbers and sentences of a route, turned into text.
 *
 * The card that reads this is a `<ul>` and four labels, so everything with an opinion lives here: how a
 * distance is grouped, when minutes become seconds, and which sentence belongs to a walk that could not be
 * found. All of it is a function of plain values, which is why the file takes a **view model** rather than the
 * engine's `RouteResult`:
 *
 * `RoutableView` is narrower than `RouteFound` and structurally compatible with it, so `App` can hand over a
 * search result directly and the card never names a type from `@/engine`. `FailureView.reason` repeats the
 * engine's five `RouteFailureReason` strings as a local union rather than importing them — and that
 * *duplication is the test*: a sixth reason in the engine breaks the build here, in the file whose job is to
 * have an answer for each one, which is a better place to find out than in a `default:` branch that says
 * "something went wrong".
 */

/**
 * The nine turn buckets, spelled out here rather than imported from `@/engine`: the engine's `TurnDirection` is
 * the same union, so an assignment from a search result typechecks, and a tenth bucket added to the engine is a
 * compile error in `App` where the view model is built — which is the file that has to know what arrow to draw.
 * Same trick as {@link FailureView.reason}, and for the same reason.
 */
export type DirectionName =
  | 'straight'
  | 'slight-left'
  | 'left'
  | 'sharp-left'
  | 'uturn'
  | 'sharp-right'
  | 'right'
  | 'slight-right'
  | 'stay'

/** Every bucket, in the order the arrows go round: exported so the class names a card emits can be *listed*
 * rather than remembered — by the rotation test below, and by the stylesheet guard in `src/test`. */
export const TURN_DIRECTIONS: readonly DirectionName[] = [
  'straight',
  'slight-left',
  'left',
  'sharp-left',
  'uturn',
  'sharp-right',
  'right',
  'slight-right',
  'stay',
]

/** Clockwise degrees from "straight ahead" for each bucket. */
const ROTATION: Record<DirectionName, number> = {
  straight: 0,
  'slight-left': -45,
  left: -90,
  'sharp-left': -135,
  uturn: 180,
  'sharp-right': 135,
  right: 90,
  'slight-right': 45,
  stay: 0,
}

/**
 * Which way the row's arrow points. `stay` shares 0° with `straight` and is distinguished by the class, because
 * a rotation cannot express "there is nowhere to go" and pretending otherwise would draw an arrow on a route
 * of zero length.
 */
export function turnRotation(direction: DirectionName): number {
  return ROTATION[direction]
}

export interface StepView {
  readonly instruction: string
  readonly metres: number
  readonly direction: DirectionName
}

export interface RoutableView {
  readonly algorithm: string
  readonly metres: number
  readonly minutes: number
  readonly hops: number
  readonly expanded: number
  readonly ms: number
  readonly steps: readonly StepView[]
  readonly nodeCount: number
}

export interface FailureView {
  readonly reason: 'empty-graph' | 'unknown-origin' | 'unknown-destination' | 'disconnected' | 'invalid-graph'
  readonly message: string
  /** `exploredOrder.length` — how much of the map the search saw before it gave up. */
  readonly explored: number
}

export interface SummaryRow {
  readonly label: string
  readonly value: string
}

export interface RouteSummary {
  /** "1,517.7 m" and "18.1 min", or "12 s" for anything under a minute. */
  readonly distance: string
  readonly duration: string
  /** The pace the duration was computed at, as the engine declares it. */
  readonly pace: string
  readonly rows: readonly SummaryRow[]
  readonly steps: readonly StepView[]
  /** One clause for the pane's status line, so a screen reader gets the finding and not only the list. */
  readonly announced: string
}

/**
 * Group the integer part every three digits, by hand: `Intl` formats differ across ICU builds, and a number that
 * changes shape depending on the browser is not one to assert on. The arithmetic (`tenths`, not `toFixed().split`)
 * is deliberate too — a string round-trip hands back `string | undefined` for the fractional half, and the only
 * honest thing to do with that `undefined` is a fallback that can never fire.
 */
export function formatMetres(metres: number): string {
  const tenths = Math.round(metres * 10)
  const grouped = String(Math.trunc(tenths / 10)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${grouped}.${String(Math.abs(tenths % 10))} m`
}

/** Minutes are worth a decimal only while they are worth more than a minute. */
export function formatMinutes(minutes: number): string {
  // Rounding through *seconds* rather than comparing `minutes < 1`: `minutes` arrives already rounded to a
  // tenth, so 0.99 is a value a caller can hold, and a card that printed "60 s" for it would be one line away
  // from printing "1 min" for 1.0.
  const seconds = Math.round(minutes * 60)
  if (seconds < 60) return `${String(seconds)} s`
  return `${String(Math.round(minutes * 10) / 10)} min`
}

/**
 * The card's content, for a route that exists.
 *
 * `hops` and `steps.length` are both shown because they answer different questions — how many walkway segments
 * the path crosses, and how many sentences the directions come to after the fold — and a learner who sees 6
 * and 4 side by side has already asked the right question about `simplifyLegs`.
 */
export function summarise(route: RoutableView, paceMps: number): RouteSummary {
  // A turn is a step that is not the opening heading and not a standstill. Counted from `direction`, not by
  // sniffing the sentence: `instruction` is the wording half, and a rule that reads prose to recover a fact the
  // leg already carries breaks the first time somebody improves a sentence.
  const turns = route.steps.filter((step) => step.direction !== 'straight' && step.direction !== 'stay')
  return {
    // No pair of place names in here: the card prints the two labels it is given, each in its own element, so
    // the summary would only be able to offer them joined — a string the component has to split again to style
    // is a string nobody should have built. The place names never enter this file at all.
    distance: formatMetres(route.metres),
    duration: formatMinutes(route.minutes),
    pace: `${paceMps} m/s`,
    rows: [
      { label: 'algorithm', value: route.algorithm },
      { label: 'vertices settled', value: String(route.expanded) },
      { label: 'search time', value: `${String(route.ms)} ms` },
      { label: 'walkway segments', value: String(route.hops) },
      { label: 'directions', value: String(route.steps.length) },
      { label: 'places along', value: String(route.nodeCount) },
      { label: 'turns to make', value: String(turns.length) },
    ],
    steps: route.steps,
    announced: `${formatMetres(route.metres)}, ${formatMinutes(route.minutes)}, ${String(route.steps.length)} steps, by ${route.algorithm}.`,
  }
}

/** What each of the five refusals means to a person who just clicked something. */
const FAILURE_COPY: Record<FailureView['reason'], { headline: string; detail: string }> = {
  disconnected: {
    headline: 'No way there on foot',
    detail: 'The walkway network has no path between these two places.',
  },
  'unknown-origin': {
    headline: 'The start is not on the map',
    detail: 'That id is not a vertex of the graph the campus file produced — the report above says why.',
  },
  'unknown-destination': {
    headline: 'The destination is not on the map',
    detail: 'That id is not a vertex of the graph the campus file produced — the report above says why.',
  },
  'empty-graph': {
    headline: 'There is no map to search',
    detail: 'The data file produced no usable vertices at all, so no route can exist anywhere on it.',
  },
  'invalid-graph': {
    headline: 'A walkway is priced wrongly',
    detail: 'Every edge cost has to be a finite number greater than 0 (or Infinity, to close it). This is a data or profile bug, not a walk that is impossible.',
  },
}

/**
 * The card's content, for a route that does not exist.
 *
 * The explored count is the part worth the sentence: "no path" reads like a broken app, and "it settled 41
 * vertices and none of them reach the hostel block" reads like a search that did its job on a map with a hole
 * in it. The engine's own message is quoted rather than paraphrased, because it already names the offender
 * (`walkway "a-b"`, `"x" is not a node on this map`) and a card that rewrote it would be a second opinion.
 */
export function describeFailure(failure: FailureView): {
  headline: string
  detail: string
  looked: string
  announced: string
} {
  const copy = FAILURE_COPY[failure.reason]
  const looked =
    failure.explored === 0
      ? 'The search settled nothing: it stopped before it began.'
      : `It settled ${String(failure.explored)} ${failure.explored === 1 ? 'vertex' : 'vertices'} before concluding this.`
  return {
    headline: copy.headline,
    detail: `${copy.detail} ${failure.message}`,
    looked,
    announced: `${copy.headline}. ${failure.message}`,
  }
}

/** Before either picker has an answer in it. Says what to do, not that something failed. */
export const EMPTY_ROUTE_COPY: { headline: string; detail: string } = {
  headline: 'Pick a start and a destination',
  detail: 'Both lists hold every place a walkway reaches. The route is drawn on the map, and the turn-by-turn list appears here.',
}
