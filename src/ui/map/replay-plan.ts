/**
 * The replay, as data: which vertex had been settled at step *k*, who was still competing, and what colour that
 * is.
 *
 * A replay is not an animation. It is an index into two arrays the search already returns — `exploredOrder`, the
 * vertices in the order they were settled, and `frontierSnapshots`, "what was still competing when each was
 * drawn" — and every control in the panel moves that index rather than starting a timer of its own. That is the
 * whole design, and it is why the file has no React in it: the reducer and the frame are what a teaching tool
 * needs to get right, and both are assertable in Node.
 *
 * The engine records one snapshot per *settled* vertex, so `frontierSnapshots[k - 1]` is what remained on the
 * frontier the instant vertex `k` was drawn off it. Step 0 has no settled vertex and therefore no snapshot: its
 * frontier is the seed alone, which is the truest first frame a search can have and the one a learner should see
 * first ("this is the whole map as far as the algorithm knows").
 */

/** The two arrays a search carries, the path it finished with, and where it started. */
export interface ReplaySource {
  readonly exploredOrder: readonly string[]
  readonly frontierSnapshots: readonly (readonly string[])[]
  /** The origin vertex. Its own frame is step 0, when the whole frontier is this one point. */
  readonly seed: string | null
  /** The winning route, in walking order. Empty for a search that found nothing, which is a case worth
   *  replaying more than most: the last frame is then the whole explored region and no path at all. */
  readonly path: readonly string[]
}

/** One moment of the search. */
export interface ReplayFrame {
  /** 0 … `total`, where `total` is "the search has finished". */
  readonly step: number
  readonly total: number
  /** `exploredOrder` up to and including the vertex just settled. */
  readonly visited: readonly string[]
  /** The vertices that were still competing when `justSettled` was drawn. */
  readonly frontier: readonly string[]
  /** The vertex drawn at this step, or `null` at step 0 and after the end. */
  readonly justSettled: string | null
  /** The seed, which is settled at step 0 and is never in `visited`. */
  readonly seed: string | null
  /** Only on the last frame: the route becomes the bold thing on the map. */
  readonly finished: boolean
  /** 0…1, for a progress marker and for the aria value text. */
  readonly progress: number
  /** The winning route, which the layer draws bold only on the last frame. */
  readonly path: readonly string[]
}

/** Cyan for the first vertex settled, violet for the last, in `hsl()` so the ramp is one interpolation. */
const HUE_FROM = 187
const HUE_TO = 268
const LIGHTNESS_FROM = 55
const LIGHTNESS_TO = 66
const SATURATION_FROM = 92
const SATURATION_TO = 85

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/**
 * The colour of the vertex settled at `rank` out of `total`.
 *
 * A gradient by *visit order*, not by distance or by cost: the point of the overlay is that the search grew in
 * a direction, so the only quantity that means anything here is "how late". The endpoints are pinned by
 * `replay-plan.spec.ts`, because a ramp that starts and ends on the same hue says nothing.
 */
export function visitColor(rank: number, total: number): string {
  // `total <= 1` means one vertex was settled and there is no ramp to draw; it gets the end of the scale, which
  // is the colour that says "this is as far as it got".
  const t = total <= 1 ? 1 : Math.min(1, Math.max(0, rank / (total - 1)))
  const hue = Math.round(mix(HUE_FROM, HUE_TO, t))
  const saturation = Math.round(mix(SATURATION_FROM, SATURATION_TO, t))
  const lightness = Math.round(mix(LIGHTNESS_FROM, LIGHTNESS_TO, t))
  return `hsl(${String(hue)} ${String(saturation)}% ${String(lightness)}%)`
}

/** The frame at `step`, clamped into `0 … total` so a scrub and a keyboard can never run off either end. */
export function frameOf(source: ReplaySource, requested: number): ReplayFrame {
  const total = source.exploredOrder.length
  // `NaN` means "no value yet" — an untouched `<input type=range>` reports `''`, which is `Number('') === 0`
  // after a `Number()` cast but `NaN` after a parse of a missing attribute — and the start is the honest frame
  // for it. ±Infinity is a different animal: it clamps to the end it overshoots, rather than being treated as
  // nothing-at-all.
  const step = Number.isNaN(requested) ? 0 : Math.min(total, Math.max(0, Math.trunc(requested)))
  const visited = source.exploredOrder.slice(0, step)
  const frontier = step === 0 ? (source.seed === null ? [] : [source.seed]) : snapshotAt(source, step)
  return {
    step,
    total,
    visited,
    frontier,
    justSettled: step > 0 ? (source.exploredOrder[step - 1] ?? null) : null,
    seed: source.seed,
    path: source.path,
    finished: total > 0 && step === total,
    progress: total === 0 ? 0 : step / total,
  }
}

/** `frontierSnapshots` is index-aligned with `exploredOrder`, and a shorter array is a data bug, not a crash. */
function snapshotAt(source: ReplaySource, step: number): readonly string[] {
  return source.frontierSnapshots[step - 1] ?? []
}

/** The panel's every control, as one action. Nothing here knows about timers or about React. */
export type ReplayAction =
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'back' }
  | { readonly type: 'forward' }
  | { readonly type: 'restart' }
  | { readonly type: 'finish' }
  | { readonly type: 'scrub'; readonly step: number }
  | { readonly type: 'speed'; readonly speed: number }

/**
 * Where the clock stands, and whether it is running.
 *
 * There is no `reduced` field, and that is the design rather than a gap: a replay that never starts by itself
 * already honours `prefers-reduced-motion`, and the one animation on the map (the frontier pulse) is silenced by
 * a CSS media query, where the preference is read by the engine that paints it and cannot be bypassed by a
 * branch that failed to run. The alternative was `matchMedia` in a hook, which the repository's lint
 * configuration bans for every module but the mount point; a rule that deliberate is worth obeying, not widening.
 */
export interface ReplayState {
  readonly step: number
  readonly playing: boolean
  /** Frames per tick is always one; `speed` is how often the tick arrives, so a scrub and a play never fight. */
  readonly speed: number
}

export const SPEEDS: readonly number[] = [0.5, 1, 2, 4]
const BASE_INTERVAL_MS = 420

/** The state a new search begins in: the first frame, and paused. Replaying is a choice, not a default. */
export function initialReplayState(): ReplayState {
  return { step: 0, playing: false, speed: 1 }
}

/**
 * One step of the reducer.
 *
 * Two rules do all the teaching: `play` at the end restarts (a control that does nothing is a control that is
 * broken), and stepping forward past the last vertex stops playing rather than parking a spinner on a finished
 * search. Nothing here consults a motion preference, because `play` is reachable only from a key press or a
 * button — reduced *motion* is not reduced *control*, and a reader who never wants an animation still wants the
 * frames.
 */
export function replayStep(state: ReplayState, action: ReplayAction, total: number): ReplayState {
  const clamp = (step: number): number => Math.min(total, Math.max(0, step))
  switch (action.type) {
    case 'play':
      return { ...state, playing: true, step: state.step >= total ? 0 : state.step }
    case 'pause':
      return { ...state, playing: false }
    case 'back':
      return { ...state, playing: false, step: clamp(state.step - 1) }
    case 'forward': {
      const step = clamp(state.step + 1)
      return { ...state, step, playing: step < total && state.playing }
    }
    case 'restart':
      return { ...state, step: 0, playing: false }
    case 'finish':
      return { ...state, step: total, playing: false }
    case 'scrub':
      return { ...state, playing: false, step: clamp(action.step) }
    case 'speed': {
      // Only the four offered speeds, so a stray value from a dev tools edit cannot make the timer say 0.
      const speed = SPEEDS.includes(action.speed) ? action.speed : 1
      return { ...state, speed }
    }
  }
}

/** Milliseconds between frames at `speed`. Exported so the hook's timer and the panel's caption quote one number. */
export function intervalMs(speed: number): number {
  return Math.round(BASE_INTERVAL_MS / (SPEEDS.includes(speed) ? speed : 1))
}

/** The sentence the panel writes into `aria-valuetext`, and the caption under the buttons. */
/**
 * The panel's five buttons, as data: order, name, what it does, when it cannot, which glyph it wears.
 *
 * It lives here rather than in the component for the reason every other decision in this app lives in a pure
 * module: the disabled rules are the interesting part, they are testable, and an `onClick` that only a dispatched
 * event runs is not. The component is then a `map` over rows and nothing else.
 */
export function frameControls(
  frame: ReplayFrame,
  playing: boolean,
): readonly {
  readonly key: string
  readonly label: string
  readonly action: ReplayAction
  readonly disabled: boolean
  readonly icon: 'rewind' | 'back' | 'play' | 'forward' | 'finish'
}[] {
  const atStart = frame.step === 0
  const atEnd = frame.step >= frame.total
  return [
    {
      key: 'restart',
      label: 'Back to the first vertex',
      action: { type: 'restart' },
      disabled: atStart,
      icon: 'rewind',
    },
    { key: 'back', label: 'One vertex earlier', action: { type: 'back' }, disabled: atStart, icon: 'back' },
    {
      key: 'play',
      label: playing ? 'Pause the replay' : 'Play the replay',
      // At the end, play means "from the beginning", because a control that answers nothing is a control that is
      // broken; with nothing settled at all it is greyed, since there is no search to start.
      action: { type: playing ? 'pause' : 'play' },
      disabled: frame.total === 0,
      icon: 'play',
    },
    { key: 'forward', label: 'One vertex later', action: { type: 'forward' }, disabled: atEnd, icon: 'forward' },
    { key: 'finish', label: 'Last frame', action: { type: 'finish' }, disabled: atEnd, icon: 'finish' },
  ]
}

/**
 * What a key on the panel means, or `null` for a key that means nothing here.
 *
 * `Space` is in the table because it is the habit a replay invites, and `Home`/`End` because a search with 300
 * settled vertices is not walked one at a time. `←` and `→` are the same two actions the buttons are.
 */
export function keyAction(key: string, playing: boolean): ReplayAction | null {
  switch (key) {
    case 'ArrowLeft':
      return { type: 'back' }
    case 'ArrowRight':
      return { type: 'forward' }
    case 'Home':
      return { type: 'restart' }
    case 'End':
      return { type: 'finish' }
    case ' ':
      return { type: playing ? 'pause' : 'play' }
    default:
      return null
  }
}

export function frameCaption(frame: ReplayFrame, algorithmLabel: string): string {
  if (frame.total === 0) return `${algorithmLabel} settled nothing before it stopped`
  const settled = `settled ${String(frame.step)} of ${String(frame.total)}`
  if (!frame.finished) return `${settled}, ${String(frame.frontier.length)} still competing`
  // The last frame is the one with a conclusion in it, and the conclusion differs when there is no route: the
  // honest sentence names the region it ran out of, because that is what the overlay is showing.
  return frame.path.length === 0
    ? `${settled} — the whole reachable region, and no route`
    : `${settled} — the route is drawn`
}
