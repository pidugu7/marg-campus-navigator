/**
 * The replay's frames and reducer — the whole of what the overlay *means*, with no clock and no DOM.
 *
 * Two claims hold this file together.
 *
 * 1. **A frame is a slice of the search, not a picture.** `exploredOrder` and `frontierSnapshots` come from the
 *    engine, one entry per settled vertex, and the frame at step `k` must show exactly the first `k` settlements
 *    and the rivals that were left when the `k`-th was drawn. If the pairing is off by one, the overlay shows a
 *    frontier the search had already emptied, and a learner concludes Dijkstra looks ahead.
 * 2. **Every control moves the same index.** Play, step, scrub, `End`, the arrow keys: eight front-ends, one
 *    clamp, and no way to land outside `0 … total`. The tests below walk the ends and the middle.
 */
import { describe, expect, it } from 'vitest'
import {
  SPEEDS,
  frameCaption,
  frameControls,
  frameOf,
  initialReplayState,
  intervalMs,
  keyAction,
  replayStep,
  visitColor,
} from './replay-plan'
import type { ReplaySource } from './replay-plan'

/** A five-vertex search over the square, with a frontier that shrinks as it goes. */
function search(overrides: Partial<ReplaySource> = {}): ReplaySource {
  return {
    exploredOrder: ['a', 'b', 'd', 'c'],
    frontierSnapshots: [[], ['d', 'c'], ['c'], []],
    path: ['a', 'b', 'c'],
    seed: 'a',
    ...overrides,
  }
}

describe('frameOf', () => {
  it('starts on the seed alone, which is all a search knows at first', () => {
    const frame = frameOf(search(), 0)
    expect(frame.visited).toEqual([])
    expect(frame.frontier).toEqual(['a'])
    expect(frame.justSettled).toBe(null)
    expect(frame.finished).toBe(false)
    expect(frame.progress).toBe(0)
  })

  it('shows k settlements and the rivals left when the k-th was drawn', () => {
    const second = frameOf(search(), 2)
    expect(second.visited).toEqual(['a', 'b'])
    expect(second.justSettled).toBe('b')
    // The snapshot at index 1 is what was still competing when `b` came off the frontier — `d` and `c`, which is
    // exactly the pair a learner should see pulsing while `a → b` is the current best guess.
    expect(second.frontier).toEqual(['d', 'c'])
    expect(second.progress).toBeCloseTo(0.5, 12)
  })

  it('ends with every vertex, the whole route, and no frontier', () => {
    const last = frameOf(search(), 4)
    expect(last.total).toBe(4)
    expect(last.visited).toEqual(['a', 'b', 'd', 'c'])
    expect(last.frontier).toEqual([])
    expect(last.finished).toBe(true)
    expect(last.path).toEqual(['a', 'b', 'c'])
    expect(last.progress).toBe(1)
  })

  it('clamps at both ends, so no control can run off the search', () => {
    const source = search()
    expect(frameOf(source, -12).step).toBe(0)
    expect(frameOf(source, 99).step).toBe(4)
    // A scrubber that has never been touched, a `Number('')`, a divided-by-zero: none of them may produce a
    // `NaN` index, because the layer would then render no circles at all and the panel would say "settled NaN".
    expect(frameOf(source, Number.NaN).step).toBe(0)
    expect(frameOf(source, Number.POSITIVE_INFINITY).step).toBe(4)
    expect(frameOf(source, 2.7).step).toBe(2)
  })

  it('survives a search that settled nothing, and a snapshot list that is too short', () => {
    const empty = frameOf(search({ exploredOrder: [], frontierSnapshots: [], path: [], seed: null }), 3)
    expect(empty.total).toBe(0)
    expect(empty.finished, 'nothing to finish').toBe(false)
    expect(empty.frontier).toEqual([])
    expect(empty.progress).toBe(0)
    const short = frameOf(search({ frontierSnapshots: [[]] }), 3)
    expect(short.frontier).toEqual([])
  })
})

describe('visitColor', () => {
  it('runs cyan to violet, and only between those', () => {
    expect(visitColor(0, 5)).toBe('hsl(187 92% 55%)')
    expect(visitColor(4, 5)).toBe('hsl(268 85% 66%)')
  })

  it('advances monotonically, so later really does mean later', () => {
    const hues = [0, 1, 2, 3, 4].map((rank) => Number(/hsl\((\d+)/.exec(visitColor(rank, 5))?.[1]))
    for (let i = 1; i < hues.length; i++) {
      expect((hues[i] as number) > (hues[i - 1] as number), `rank ${String(i)}`).toBe(true)
    }
  })

  it('gives a lone vertex the end of the scale, and clamps a rank out of range', () => {
    // One settled vertex has no ramp to sit on. "as far as it got" is the violet end, which is what the
    // single-dot frame should look like.
    expect(visitColor(0, 1)).toBe('hsl(268 85% 66%)')
    expect(visitColor(0, 0)).toBe('hsl(268 85% 66%)')
    expect(visitColor(12, 5)).toBe(visitColor(4, 5))
    expect(visitColor(-3, 5)).toBe(visitColor(0, 5))
  })
})

describe('replayStep', () => {
  const start = initialReplayState()

  it('plays from the beginning when it is already at the end, and a new search always starts paused', () => {
    expect(start, 'nothing autoplays, so nothing has to be un-played').toEqual({ step: 0, playing: false, speed: 1 })
    const atEnd = { ...start, step: 4 }
    expect(replayStep(atEnd, { type: 'play' }, 4)).toEqual({ step: 0, playing: true, speed: 1 })
    expect(replayStep(start, { type: 'play' }, 4).playing).toBe(true)
    expect(replayStep({ ...start, playing: true }, { type: 'pause' }, 4)).toEqual({
      step: 0,
      playing: false,
      speed: 1,
    })
  })

  it('stops playing at the last frame instead of spinning there', () => {
    const near = { ...start, step: 3, playing: true }
    expect(replayStep(near, { type: 'forward' }, 4)).toEqual({ step: 4, playing: false, speed: 1 })
    expect(replayStep({ ...start, step: 4, playing: true }, { type: 'forward' }, 4)).toEqual({
      step: 4,
      playing: false,
      speed: 1,
    })
    expect(replayStep({ ...start, step: 0 }, { type: 'back' }, 4).step).toBe(0)
  })

  it('steps back off the play button, because a manual frame is a different activity', () => {
    const playing = { ...start, step: 2, playing: true }
    expect(replayStep(playing, { type: 'back' }, 4).playing).toBe(false)
    expect(replayStep(playing, { type: 'scrub', step: 40 }, 4)).toEqual({
      step: 4,
      playing: false,
      speed: 1,
    })
  })

  it('jumps to the ends, and forgets the clock', () => {
    expect(replayStep({ ...start, step: 2, playing: true }, { type: 'finish' }, 4).step).toBe(4)
    expect(replayStep({ ...start, step: 2, playing: true }, { type: 'restart' }, 4)).toEqual({
      step: 0,
      playing: false,
      speed: 1,
    })
  })

  it('only ever moves on request, which is how the replay keeps a reduced-motion promise', () => {
    // No media query is read anywhere in the replay: `playing` starts false, and the single animation (the
    // frontier pulse) is switched off by `@media (prefers-reduced-motion)` in `map.css`, which the stylesheet
    // guard asserts. So the frames stay available to a learner who never wants an animation, and nothing on
    // this map moves unless they move it.
    expect(initialReplayState().playing).toBe(false)
    expect(replayStep(start, { type: 'forward' }, 4).step).toBe(1)
    expect(replayStep(start, { type: 'finish' }, 4).step).toBe(4)
    expect(replayStep(start, { type: 'play' }, 4).playing).toBe(true)
  })

  it('takes only the four speeds it offers, and clamps them to 1×', () => {
    expect(SPEEDS).toEqual([0.5, 1, 2, 4])
    for (const speed of SPEEDS) {
      expect(replayStep(start, { type: 'speed', speed }, 4).speed).toBe(speed)
    }
    // 0 would make the timer say "every 0 ms", and a stray dev-tools edit gets the default rather than a hang.
    for (const junk of [0, -1, Number.NaN, 3.5]) {
      expect(replayStep({ ...start, speed: 2 }, { type: 'speed', speed: junk }, 4).speed).toBe(1)
    }
  })

  it('paces the clock by the speed, so the caption and the timer cannot disagree', () => {
    expect(intervalMs(1)).toBe(420)
    expect(intervalMs(2)).toBe(210)
    expect(intervalMs(4)).toBe(105)
    expect(intervalMs(0.5)).toBe(840)
    expect(intervalMs(99)).toBe(420)
  })
})

describe('the panel\'s controls', () => {
  it('offers five rows, in order, each wired to the action its name promises', () => {
    const rows = frameControls(frameOf(search(), 2), false)
    expect(rows.map((row) => row.key)).toEqual(['restart', 'back', 'play', 'forward', 'finish'])
    // The pair the reader sees and the pair the reducer gets have to agree, and nothing but a test like this
    // catches a row whose label says "one vertex earlier" while its action steps forward.
    for (const row of rows) {
      expect(row.action.type, row.key).toBe(row.key === 'finish' ? 'finish' : row.key === 'restart' ? 'restart' : row.key)
      expect(row.label).not.toBe('')
    }
  })

  it('greys what the ends of a search make impossible', () => {
    const disabled = (step: number, total = 4): readonly string[] =>
      frameControls(frameOf(search({ exploredOrder: search().exploredOrder.slice(0, total) }), step), false)
        .filter((row) => row.disabled)
        .map((row) => row.key)
    expect(disabled(0)).toEqual(['restart', 'back'])
    expect(disabled(4)).toEqual(['forward', 'finish'])
    // A search that settled nothing has an end and a start at once, so everything except… nothing: play is
    // greyed too, because there is no clock to start.
    expect(disabled(0, 0)).toEqual(['restart', 'back', 'play', 'forward', 'finish'])
  })

  it('labels play by whether it is running, and keeps the same key either way', () => {
    const paused = frameControls(frameOf(search(), 1), false).find((row) => row.key === 'play')
    const running = frameControls(frameOf(search(), 1), true).find((row) => row.key === 'play')
    expect(paused?.label).toBe('Play the replay')
    expect(paused?.action).toEqual({ type: 'play' })
    expect(running?.label).toBe('Pause the replay')
    expect(running?.action).toEqual({ type: 'pause' })
  })

  it('maps the five keys, including the one the DOM calls a single space', () => {
    expect(keyAction('ArrowLeft', false)).toEqual({ type: 'back' })
    expect(keyAction('ArrowRight', false)).toEqual({ type: 'forward' })
    expect(keyAction('Home', true)).toEqual({ type: 'restart' })
    expect(keyAction('End', true)).toEqual({ type: 'finish' })
    // `event.key` for the space bar is `' '` in every browser and `'Space'` in nobody's, and a handler written
    // from memory gets this wrong exactly once, quietly.
    expect(keyAction(' ', false)).toEqual({ type: 'play' })
    expect(keyAction(' ', true)).toEqual({ type: 'pause' })
    // Keys that belong to the page, not the replay: Tab and Enter must reach the buttons underneath.
    for (const other of ['Tab', 'Enter', 'ArrowUp', 'a', '']) {
      expect(keyAction(other, false), other).toBe(null)
    }
  })

})

describe('frameCaption', () => {
  it('says what is competing, then what it settled, then whether there was a route', () => {
    expect(frameCaption(frameOf(search(), 0), 'a-star')).toBe('settled 0 of 4, 1 still competing')
    expect(frameCaption(frameOf(search(), 2), 'dijkstra')).toBe('settled 2 of 4, 2 still competing')
    expect(frameCaption(frameOf(search(), 4), 'a-star')).toBe('settled 4 of 4 — the route is drawn')
    expect(frameCaption(frameOf(search({ path: [] }), 4), 'bfs')).toBe(
      'settled 4 of 4 — the whole reachable region, and no route',
    )
    expect(frameCaption(frameOf(search({ exploredOrder: [], frontierSnapshots: [] }), 0), 'bfs')).toBe(
      'bfs settled nothing before it stopped',
    )
  })
})
