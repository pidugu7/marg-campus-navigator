/**
 * The replay's clock, and nothing else.
 *
 * `replay-plan.ts` holds every rule about what a step means; this file's job is to move that index on a timer
 * while the state says it should run. Two effects and a reducer, deliberately boring, and deliberately the
 * *only* place in the app that owns a `setInterval`.
 *
 * It reads no media query and touches no global: `window` and `document` are banned across `src/` by the
 * repository's lint configuration, so that everything short of the mount point stays renderable in a Node
 * harness. The reduced-motion promise is kept in `map.css` instead, where it cannot be bypassed, and by the
 * fact that this clock is never started by itself — a timer a reader starts is a timer they can stop.
 *
 * There is no spec beside this file, and that is a statement rather than an omission: the reducer it delegates
 * to is tested exhaustively in `src/ui/map/replay-plan.spec.ts`, and what is left here is one `setInterval` and
 * its cleanup — the one part of the replay a Node harness without a DOM cannot observe honestly. The live
 * preview is the judge of that, and it is on the checklist.
 */
import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { frameOf, initialReplayState, intervalMs, replayStep } from '@/ui/map/replay-plan'
import type { ReplayAction, ReplaySource, ReplayState } from '@/ui/map/replay-plan'


export interface ReplayHandle {
  readonly state: ReplayState
  readonly frame: ReturnType<typeof frameOf>
  readonly dispatch: (action: ReplayAction) => void
  /** `false` when there is nothing to replay: no search has run, or it settled nothing. */
  readonly available: boolean
}

/**
 * The replay for one search result.
 *
 * `signature` is the string identifying *which* query produced the arrays — the pair, the algorithm, the
 * profile, and the closure set once Phase 6 adds one. A new result the same length as the last would otherwise
 * keep a stale step, and a replay that begins mid-search is not a replay of anything.
 */
export function useReplay(source: ReplaySource, signature: string): ReplayHandle {
  const total = source.exploredOrder.length

  // The reducer closes over `total`, and `useReducer` calls the reducer it is handed at dispatch time, so the
  // clamp always knows the length of the search being replayed — without the state duplicating it, which is how
  // a `total` in two places would eventually disagree with the arrays it came from.
  const reduce = useCallback(
    (state: ReplayState, action: ReplayAction): ReplayState => replayStep(state, action, total),
    [total],
  )
  // `initialReplayState()` is paused and is the only way the state is ever built, so a result arriving while a
  // clock was running restarts the replay instead of continuing one that belonged to another query.
  const [state, dispatch] = useReducer(reduce, undefined, initialReplayState)

  useEffect(() => {
    dispatch({ type: 'restart' })
  }, [signature])

  useEffect(() => {
    if (!state.playing) return
    const id = setInterval(() => {
      dispatch({ type: 'forward' })
    }, intervalMs(state.speed))
    return () => clearInterval(id)
  }, [state.playing, state.speed])

  const frame = useMemo(() => frameOf(source, state.step), [source, state.step])
  return { state, frame, dispatch, available: total > 0 }
}
