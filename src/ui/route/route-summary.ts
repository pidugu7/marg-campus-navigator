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

/** The two numbers a preference is judged on. Narrower than `RoutableView` on purpose: a Δ is about length and
 *  pace, and a function that can see the step list is a function that will eventually be given an opinion. */
export interface RouteLength {
  readonly metres: number
  readonly minutes: number
}

/** What a preference cost, against the same question asked with none. */
export interface ProfileDelta {
  /** Metres further than the `shortest` walk. Never negative for a search that minimises metres — the claim
   *  `src/test/campus-routing.spec.ts` checks on all 380 place pairs. */
  readonly metres: number
  /** Minutes more than the `shortest` walk, at that profile's own pace. Can go either way: a shorter route
   *  walked at 1.05 m/s is not automatically slower than a longer one at 1.4. */
  readonly minutes: number
}

/** Both totals rounded *through* tenths, so `18.1 − 17.8` is `0.3` and not `0.30000000000000004`. */
function tenths(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * The cost of a preference, or `null` when the comparison is with itself.
 *
 * `baseline === null` is the `shortest` profile's own answer, and the card prints no Δ for it: "0 m against
 * itself" is noise, and the absence is the fact.
 */
export function profileDelta(route: RouteLength, baseline: RouteLength | null): ProfileDelta | null {
  if (baseline === null) return null
  return { metres: tenths(route.metres - baseline.metres), minutes: tenths(route.minutes - baseline.minutes) }
}

/** One signed part, or nothing when that part did not move. */
function signed(value: number, format: (magnitude: number) => string): string {
  if (value === 0) return ''
  return `${value > 0 ? '+' : '−'}${format(Math.abs(value))}`
}

/**
 * The Δ as a caption: `+46 m · +0.3 min`. Empty for a route with nothing to compare against, and a plain
 * `the same walk` when the preference changed the price of the route and not the route — which is what BFS
 * answers for every profile, because BFS counts hops.
 */
export function formatDelta(delta: ProfileDelta | null): string {
  if (delta === null) return ''
  const metres = signed(delta.metres, formatMetres)
  const minutes = signed(delta.minutes, formatMinutes)
  if (metres === '' && minutes === '') return 'the same walk'
  if (metres === '') return `same walk · ${minutes}`
  if (minutes === '') return metres
  return `${metres} · ${minutes}`
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
  /** Which preference produced this, as the engine words it. `''` when the caller had no preference to show. */
  readonly profile: string
  /** The Δ against the same query with no preference, `''` when there is none to quote. */
  readonly delta: string
  readonly rows: readonly SummaryRow[]
  /** What the cache says about this answer, or `null` when the caller has no cache to report. */
  readonly cache: CacheLine | null
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
/** The preference line, if there is one to write: `Shaded walk`, plus the price of it when one was paid. */
export interface ProfileLine {
  readonly label: string
  readonly delta: ProfileDelta | null
}

export function summarise(
  route: RoutableView,
  paceMps: number,
  profile?: ProfileLine,
  cache?: CacheFacts | null,
): RouteSummary {
  // A turn is a step that is not the opening heading and not a standstill. Counted from `direction`, not by
  // sniffing the sentence: `instruction` is the wording half, and a rule that reads prose to recover a fact the
  // leg already carries breaks the first time somebody improves a sentence.
  const turns = route.steps.filter((step) => step.direction !== 'straight' && step.direction !== 'stay')
  const distance = formatMetres(route.metres)
  const duration = formatMinutes(route.minutes)
  const change = formatDelta(profile?.delta ?? null)
  // The sentence a screen reader gets when the answer changes: the numbers, the method, and the preference
  // that priced them. Built from parts rather than one template with commas in it, because "by a-star, ." is
  // what a template produces when there is no preference to name, and a live region is not where that is fine.
  const announced = [
    `${distance}, ${duration}, ${String(route.steps.length)} steps, by ${route.algorithm}`,
    // The label quoted rather than lower-cased into the sentence: "on the stay in the shade" reads like a
    // description of the weather, and this string is the whole of what a screen reader learns about the knob
    // that produced the number.
    // Curly quotes rather than `"`: `renderToStaticMarkup` escapes the ASCII pair into `&quot;`, so a sentence
    // built from one is a sentence a test has to assert in entities. The label is quoted rather than folded into
    // the prose, because "on the stay in the shade" reads like a remark about the weather — and this string is
    // the whole of what a screen reader learns about the knob that produced the number.
    profile === undefined ? '' : `on the “${profile.label}” preference`,
    change === '' ? '' : `(${change})`,
  ]
    .filter((part) => part !== '')
    .join(' ')
    .concat('.')
  return {
    // No pair of place names in here: the card prints the two labels it is given, each in its own element, so
    // the summary would only be able to offer them joined — a string the component has to split again to style
    // is a string nobody should have built. The place names never enter this file at all.
    distance,
    duration,
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
    cache: cacheLine(cache),
    profile: profile?.label ?? '',
    delta: change,
    announced,
  }
}

/**
 * What the cache knows, in the shape a card can print.
 *
 * `src/ui` may not import `@/engine` — the architecture test's one hard boundary — so the numbers arrive as a
 * structural copy of the hook's view rather than as the engine's type. That is deliberate duplication: the card
 * is drawn from seven integers, and a UI that imports the engine's vocabulary would stop being replaceable by
 * anything that is not that engine.
 */
export interface CacheFacts {
  readonly cached: boolean
  readonly hits: number
  readonly misses: number
  readonly lookups: number
  readonly size: number
  readonly capacity: number
  readonly evictions: number
}

export interface CacheLine {
  /** `from the cache` or `searched just now` — the badge, and the only word that says whether this number was
   *  computed for this keystroke. */
  readonly badge: string
  readonly tone: 'hit' | 'fresh'
  /** `2 of 4 lookups hit (50 %)`. */
  readonly rate: string
  /** `2 answers kept of 192` plus an eviction clause when there is one to report. */
  readonly occupancy: string
}

/**
 * A percentage with at most one decimal.
 *
 * `Math.round(rate * 1000) / 10` rather than `toFixed(1)`, and no trailing-zero stripping on top of it:
 * rounding to tenths of a percent in the *number* already leaves `50` printing as `50`, and the first draft of
 * this function divided by ten a second time on the theory that `50.0` needed tidying. It printed 2 of 4 lookups
 * as "5 %", which is the kind of mistake a one-line table of examples catches — hence the test below it.
 */
export function formatPercent(rate: number): string {
  return `${String(Math.round(rate * 1000) / 10)} %`
}

/** One clause of the summary line, or `''` when there is nothing to say. */
function clause(count: number, singular: string, plural: string): string {
  return count === 0 ? '' : `${String(count)} ${count === 1 ? singular : plural}`
}

/**
 * The sentence under the numbers, built from the counters and nothing else.
 *
 * The hit rate is quoted over `lookups`, and `lookups` counts calls to the cache rather than searches: a hit
 * means "the answer to this exact question was already here", which is a claim about the question, not about the
 * route. An eviction is named only when one happened, because a line that reports `0 evicted` on every card
 * teaches a reader that the number is decoration.
 */
export function cacheLine(facts: CacheFacts | null | undefined): CacheLine | null {
  if (facts === null || facts === undefined) return null
  const rate =
    facts.lookups === 0
      ? 'no lookups yet'
      : `${String(facts.hits)} of ${String(facts.lookups)} lookups hit (${formatPercent(facts.hits / facts.lookups)})`
  const evicted = clause(facts.evictions, 'entry', 'entries')
  return {
    badge: facts.cached ? 'from the cache' : 'searched just now',
    tone: facts.cached ? 'hit' : 'fresh',
    rate,
    occupancy: evicted === ''
      ? `${String(facts.size)} of ${String(facts.capacity)} answers kept`
      : `${String(facts.size)} of ${String(facts.capacity)} answers kept, ${evicted} evicted`,
  }
}

/** The clear button's label. A control that says what it will cost to use is a control worth using. */
export function cacheClearLabel(facts: CacheFacts | null | undefined): string {
  if (facts === null || facts === undefined || facts.size === 0) return 'Clear the route cache'
  return `Clear the route cache (${String(facts.size)} ${facts.size === 1 ? 'answer' : 'answers'} kept)`
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
