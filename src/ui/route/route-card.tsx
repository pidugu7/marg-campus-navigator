/**
 * The result of a search, as a card: how far, how long, what it cost to find out, and which way to turn.
 *
 * There is no arithmetic in this file. Every string comes from `route-summary.ts`, which is pure and tested, and
 * the only judgement left here is which of three states to draw. That split is what makes the card safe to write
 * without a DOM in the test runner: the parts that can be wrong about *content* are assertable in Node, and the
 * parts that can only be wrong about *layout* are the ones the live preview is for.
 *
 * The swap button sits with the pickers rather than down here, because it edits the request and not the answer —
 * and because a control that changes what is drawn belongs next to what it changes.
 */
import { ArrowUp, Footprints, TriangleAlert } from 'lucide-react'
import { EMPTY_ROUTE_COPY, describeFailure, formatMetres, summarise, turnRotation } from './route-summary'
import type { FailureView, ProfileLine, RoutableView } from './route-summary'

/**
 * What the card draws: nothing yet, a walk, or a refusal. `null` is the first and not an error.
 *
 * The pace travels *inside* the found branch rather than as a prop of its own, because it is a fact about the
 * duration and nothing else: a card in the idle or missing state has no number to attach units to, and a prop
 * that only means something in one of three branches is a prop that has to be lied about in the other two.
 */
export type RouteView =
  | {
      readonly state: 'found'
      readonly route: RoutableView
      readonly paceMps: number
      /**
       * Which preference priced this, and what it cost against the same query with none. Absent when the UI has
       * no preference to report — the baseline profile, or a card built by a test — and the line is then not
       * drawn at all rather than drawn with a zero in it.
       */
      readonly profile?: ProfileLine
    }
  | { readonly state: 'missing'; readonly failure: FailureView }

export interface RouteCardProps {
  readonly fromLabel: string
  readonly toLabel: string
  readonly view: RouteView | null
}

export function RouteCard({ fromLabel, toLabel, view }: RouteCardProps) {
  if (view === null) {
    return (
      <div className="route-state route-state--idle">
        <Footprints size={15} aria-hidden="true" />
        <p className="route-headline">{EMPTY_ROUTE_COPY.headline}</p>
        <p className="route-detail">{EMPTY_ROUTE_COPY.detail}</p>
      </div>
    )
  }

  if (view.state === 'missing') {
    const failure = describeFailure(view.failure)
    return (
      <div className="route-state route-state--missing">
        <TriangleAlert size={15} aria-hidden="true" />
        <p className="route-headline">{failure.headline}</p>
        <p className="route-detail">{failure.detail}</p>
        <p className="route-looked">{failure.looked}</p>
      </div>
    )
  }

  // The preference travels into `summarise` rather than being printed straight from the view: the label and the
  // Δ need the same rounding rules as the distance and the duration, and they belong in the file that owns them.
  const summary = summarise(view.route, view.paceMps, view.profile)
  return (
    <div className="route-card">
      <p className="route-pair">
        <span className="route-pair-start">{fromLabel}</span>
        <span className="route-pair-arrow" aria-hidden="true">
          →
        </span>
        <span className="route-pair-end">{toLabel}</span>
      </p>

      <p className="route-figure">
        <strong>{summary.distance}</strong>
        <span className="route-figure-sep" aria-hidden="true">
          ·
        </span>
        <strong>{summary.duration}</strong>
        <span className="route-pace">at {summary.pace}</span>
      </p>

      {/* The preference and its price, in the card rather than only in the `<select>` above: a route is a
          function of both knobs, and a reader who scrolls back up to check which one they chose has been asked
          to do the app's work. `aria-hidden` on the separator, and the Δ folded into the live region's sentence
          below, so nothing is announced twice. */}
      {summary.profile === '' ? null : (
        <p className="route-profile">
          <span className="route-profile-name">{summary.profile}</span>
          {summary.delta === '' ? null : (
            <>
              <span className="route-figure-sep" aria-hidden="true">
                ·
              </span>
              <span className="route-delta">{`${summary.delta} vs shortest`}</span>
            </>
          )}
        </p>
      )}

      {/* Visible, not `sr-only`: in a course project the sentence is the lesson — the number of steps is the
          output of the directions pass, and hiding it would make the pane's most interesting count invisible. */}
      {/* The card's own arithmetic lives in `route-summary.ts`; the only thing this file decides about the
          preference line is whether there is one to show. */}
      <p className="route-status" aria-live="polite">
        {summary.announced}
      </p>

      <dl className="route-metrics">
        {summary.rows.map((row) => (
          <div className="route-metric" key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      <ol className="route-steps">
        {summary.steps.map((step, position) => (
          <li className={`route-step route-step--${step.direction}`} key={`${String(position)}-${step.instruction}`}>
            <span className="route-step-arrow" aria-hidden="true">
              <ArrowUp size={13} style={{ transform: `rotate(${String(turnRotation(step.direction))}deg)` }} />
            </span>
            <span className="route-step-text">{step.instruction}</span>
            <span className="route-step-metres">{formatMetres(step.metres)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
