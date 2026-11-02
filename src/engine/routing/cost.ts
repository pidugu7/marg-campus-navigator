/**
 * Cost profiles — the one place that decides what "best" means.
 *
 * The graph is built once and never re-weighted (that is the whole reason for the `EdgeCost` seam in
 * `types.ts`), so a profile is a *function over the attributes of one edge*: `costFor('step-free')` returns
 * something that prices a staircase at twelve times its length, and the search never learns that a staircase
 * is anything special. Five consequences of that design are worth stating before the numbers:
 *
 *   1. **A profile is a weighting, not a filter.** No profile returns `Infinity`, so no profile can
 *      disconnect the campus. `blockedEdges` is what removes an edge; a profile only makes a route prefer to
 *      go round. That is why a step-free request across the one staircase in `campus.json` answers with a
 *      route that climbs it at 12× rather than refusing — the refusal would be a lie about accessibility,
 *      while the cost is an honest "this is the only way, and it is not step-free".
 *   2. **Every factor is ≥ 0 and finite, and `shortest` is identically 1**, so its cost is exactly
 *      `edge.metres`. Every other profile is described as a deviation from that baseline and `cost.spec.ts`
 *      checks the claim for all 960 combinations of the attributes rather than the handful the campus
 *      happens to contain.
 *   3. **Two profiles are cheaper than a metre, on purpose.** `shaded` pays 0.85 for a shaded walkway and
 *      `lit` 0.9 for a lit one, so the *smallest* factor is below 1. A Euclidean heuristic is denominated in
 *      metres, so it would over-state those profiles' cost per unit of drawn length and A* would answer
 *      wrongly — this is why the estimate is multiplied by `minCostPerUnit`, measured over the edges a search
 *      may still walk. See §Admissibility in `docs/ALGORITHMS.md`.
 *   4. **A uniform profile cannot change the answer**, only its price: every factor here can be uniform over
 *      a graph (a campus with no shade at all is `shaded` × 1.25 everywhere), and a scale factor cancels in an
 *      argmin. That is a property, not a weakness — it is the cheapest available proof that a profile is not
 *      quietly re-ordering comparable routes.
 *   5. **A profile does not set the pace.** `WALKING_SPEED_MPS` does, and the two are paired by hand because a
 *      step-free route is quoted at a step-free pace. Cost never reads a pace, and `minutes` never reads a
 *      factor.
 *
 * The engine imports no DOM, no Node globals and nothing from `src/ui` — so the label and blurb here are
 * *data* (a name and a sentence), and it is the UI's job to decide what to do with them.
 */

import { DEFAULT_EDGE_ATTRIBUTES } from '../constants'
import type { EdgeAttributes, EdgeCost, GraphEdge, WeightProfile } from '../types'

/** A staircase, for someone who must avoid stairs: twelve times the length, so a detour up to twelve times as
 * long is preferred. Twelve is not a measurement — it is the point at which "avoid" stops meaning "prefer". */
export const STAIRS_PENALTY = 12
/** Kerbs, steps and a handrail that a wheelchair cannot cross: 2.2×. */
export const NOT_STEP_FREE_PENALTY = 2.2
/** Loose surface under a small wheel. */
export const ROUGH_SURFACE_PENALTY = 1.4
/** Cost added per unit of grade, on top of the edge's own length: a 5 % slope costs 20 % more. */
export const SLOPE_FACTOR_PER_GRADE = 4

/** Walking in shade is not slower, it is likelier: 0.85× is a *bonus*, and that is what drags the profile's
 * smallest factor below 1. */
export const SHADED_BONUS = 0.85
/** Sun for an hour is a reason to walk further: 1.25×. */
export const UNSHADED_PENALTY = 1.25

/** A lit path at night is preferred, and an unlit one is only avoided — 0.9× and 1.4×. */
export const LIT_BONUS = 0.9
export const UNLIT_PENALTY = 1.4

/** Congestion is charged once over the length of the walkway: an empty corridor at 1×, a jammed one at 2×. */
export const CROWD_PENALTY_AT_FULL_CONGESTION = 1

/**
 * One profile. `factor` is the whole algorithm — the search sees `edge.metres × factor(edge.attributes)`, and
 * `minCostPerUnit` sees the same factor divided by the crow-flight, which is what makes the heuristic honest
 * without this file knowing anything about heuristics.
 */
export interface ProfileDefinition {
  readonly profile: WeightProfile
  /** For the `<select>` and the result card. */
  readonly label: string
  /** One sentence for the UI, naming what the profile chases and what it accepts. */
  readonly blurb: string
  /** The attributes it reads, in the order the documentation tabulates them. Asserted against `factor`. */
  readonly reads: readonly (keyof EdgeAttributes)[]
  /** Multiplies an edge's metres. Always a finite number greater than 0, never `Infinity`. */
  readonly factor: (attributes: EdgeAttributes) => number
}

const roughness = (attributes: EdgeAttributes): number =>
  attributes.surface === 'gravel' || attributes.surface === 'grass' ? ROUGH_SURFACE_PENALTY : 1

/**
 * The five profiles, in one record so the compiler refuses a missing factor. `shortest` is the baseline and is
 * the only profile whose factor is constant: a profile with a constant factor cannot change which route wins,
 * which is the property `cost.spec.ts` pins for every profile by scaling a graph twice.
 */
export const PROFILES: Record<WeightProfile, ProfileDefinition> = {
  shortest: {
    profile: 'shortest',
    label: 'Shortest walk',
    blurb: 'The fewest metres, whatever they are paved with, shaded by or crowded with.',
    reads: [],
    factor: () => 1,
  },
  shaded: {
    profile: 'shaded',
    label: 'Stay in the shade',
    blurb: 'Prefers covered and tree-shaded walkways; a sunny detour costs a quarter more than it measures.',
    reads: ['shaded'],
    factor: (attributes) => (attributes.shaded ? SHADED_BONUS : UNSHADED_PENALTY),
  },
  lit: {
    profile: 'lit',
    label: 'Stay on lit routes',
    blurb: 'Prefers lit walkways at night. An unlit one is avoided, never forbidden.',
    reads: ['lit'],
    factor: (attributes) => (attributes.lit ? LIT_BONUS : UNLIT_PENALTY),
  },
  'step-free': {
    profile: 'step-free',
    label: 'Step-free',
    blurb: 'Prices stairs at twelve times their length, and kerbs, loose ground and slopes as well.',
    reads: ['stairs', 'stepFree', 'surface', 'slope'],
    factor: (attributes) =>
      (attributes.stairs ? STAIRS_PENALTY : 1) *
      (attributes.stepFree ? 1 : NOT_STEP_FREE_PENALTY) *
      roughness(attributes) *
      (1 + Math.abs(attributes.slope) * SLOPE_FACTOR_PER_GRADE),
  },
  quiet: {
    profile: 'quiet',
    label: 'Quietest route',
    blurb: 'Chases the crowd out of the cost: a jammed corridor counts double.',
    reads: ['crowd'],
    factor: (attributes) => 1 + attributes.crowd * CROWD_PENALTY_AT_FULL_CONGESTION,
  },
}

/** The order a picker lists the profiles in — baseline first, then the four preferences. */
export const PROFILE_ORDER: readonly WeightProfile[] = ['shortest', 'shaded', 'lit', 'step-free', 'quiet']

/**
 * The factor one profile applies to one edge's attributes. Separate from `costFor` because `minCostPerUnit`
 * wants the multiplier and the search wants the price, and because a factor is what the documentation tabulates
 * and a spec is what checks the table.
 */
export function factorFor(profile: WeightProfile, attributes: EdgeAttributes = DEFAULT_EDGE_ATTRIBUTES): number {
  return PROFILES[profile].factor(attributes)
}

/**
 * The `EdgeCost` a search runs on. Multiplying `edge.metres` rather than reading a pre-weighted field keeps the
 * graph immutable — a profile is a *view* of the data, which is why switching from `shaded` to `quiet` between
 * two searches costs nothing and cannot leave a stale weight behind.
 */
export function costFor(profile: WeightProfile): EdgeCost {
  const { factor } = PROFILES[profile]
  // Named so a heap dump says which profile produced a number, which is worth more than the one frame this
  // closure saves when the same cost is passed to a reference implementation.
  return (edge: GraphEdge) => edge.metres * factor(edge.attributes)
}
