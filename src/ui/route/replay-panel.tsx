/**
 * The replay's controls: five buttons, a scrubber, a speed, one sentence.
 *
 * Every control moves the same index the search produced, so they cannot disagree with each other: the buttons,
 * the range input and the arrow keys are four front-ends for `replayStep`, and the reducer is where the clamping
 * lives. That is also why nothing here owns a timer — see `src/hooks/useReplay.ts`.
 *
 * The panel is `role="group"` and focusable, because `←` steps back and `→` steps forward only mean something
 * to *something*, and a keyboard user should not have to press a button fifty times to watch a search. Space
 * toggles play, `Home`/`End` jump to the ends. The handler ignores events that came from a child (a `<select>`
 * needs its own arrows), which is why the panel rather than the window listens.
 */
import { ChevronLeft, ChevronRight, FastForward, Pause, Play, Rewind } from 'lucide-react'
import { SPEEDS, frameCaption, frameControls, keyAction } from '@/ui/map/replay-plan'
import type { ReplayAction, ReplayFrame, ReplayState } from '@/ui/map/replay-plan'

export interface ReplayPanelProps {
  readonly frame: ReplayFrame
  readonly state: ReplayState
  readonly algorithmLabel: string
  readonly dispatch: (action: ReplayAction) => void
}

/** Which glyph each row wears. The rows themselves come from the plan module, where they are tested. */
const ICONS = { rewind: Rewind, back: ChevronLeft, play: Play, forward: ChevronRight, finish: FastForward } as const

export function ReplayPanel({ frame, state, algorithmLabel, dispatch }: ReplayPanelProps) {
  const caption = frameCaption(frame, algorithmLabel)
  const rows = frameControls(frame, state.playing)
  return (
    <div
      className="replay-panel"
      role="group"
      aria-label={`Replay of ${algorithmLabel}`}
      tabIndex={0}
      onKeyDown={(event) => {
        // Only keys pressed on the panel itself. A `<select>` or a range input that has focus knows what its own
        // arrows do, and taking the event here would move the search *and* the control.
        if (event.target !== event.currentTarget) return
        const action = keyAction(event.key, state.playing)
        if (action === null) return
        // Space would scroll the pane; the other four are inert here anyway.
        event.preventDefault()
        dispatch(action)
      }}
    >
      <div className="replay-buttons">
        {rows.map((row) => {
          const Icon = ICONS[row.icon]
          return (
            <button
              key={row.key}
              type="button"
              className={row.key === 'play' ? 'replay-button replay-button--play' : 'replay-button'}
              // `aria-pressed` only on the toggle: on the other four it would read as a switch that never
              // switches, because a step button is not a state.
              {...(row.key === 'play' ? { 'aria-pressed': state.playing } : {})}
              disabled={row.disabled}
              title={row.label}
              aria-label={row.label}
              onClick={() => {
                dispatch(row.action)
              }}
            >
              {state.playing && row.key === 'play' ? <Pause size={13} aria-hidden="true" /> : <Icon size={13} aria-hidden="true" />}
            </button>
          )
        })}
        <input
          className="replay-scrub"
          type="range"
          min={0}
          max={frame.total}
          step={1}
          value={frame.step}
          aria-label="Vertices settled"
          aria-valuetext={caption}
          onChange={(event) => {
            dispatch({ type: 'scrub', step: Number(event.target.value) })
          }}
        />
        <label className="replay-speed-label" htmlFor="replay-speed">
          Speed
        </label>
        <select
          id="replay-speed"
          className="replay-speed"
          value={String(state.speed)}
          onChange={(event) => {
            dispatch({ type: 'speed', speed: Number(event.target.value) })
          }}
        >
          {SPEEDS.map((speed) => (
            <option key={String(speed)} value={String(speed)}>
              {String(speed)}×
            </option>
          ))}
        </select>
      </div>
      {/* Visible, not `sr-only`, and not a live region: while the clock runs this sentence changes every frame, and
          fifty announcements of "settled 12 of 41" is worse than none. The scrubber carries it as
          `aria-valuetext`, which is announced when a reader moves it — the one moment the number is wanted. */}
      <p className="replay-caption">{caption}</p>
      {/* One line, always: this replay never starts by itself, which is also how the app keeps
          `prefers-reduced-motion` without reading it. The frontier's pulse is silenced by a media query in
          `map.css`; the clock here is silenced by not being started. */}
      <p className="replay-hint">Nothing autoplays — press → or Space, or drag the slider.</p>
    </div>
  )
}
