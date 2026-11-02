/**
 * The replay's controls, as markup — which is how a component gets checked here.
 *
 * What is assertable without a DOM is the part that matters for a keyboard and a screen reader: the buttons exist
 * with names, the ones that cannot act at the ends of a search are `disabled` rather than silently inert, the
 * slider carries its meaning in `aria-valuetext`, and the reduced-motion notice appears for the reader who set
 * the preference. What is *not* assertable here is that pressing a button repaints the map — the reducer behind
 * all of it is tested in `replay-plan.spec.ts`, and the wiring is the live preview's to confirm.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReplayPanel } from './replay-panel'
import type { ReplayPanelProps } from './replay-panel'
import { frameOf, initialReplayState } from '@/ui/map/replay-plan'
import type { ReplayAction, ReplayFrame, ReplaySource, ReplayState } from '@/ui/map/replay-plan'

const SOURCE: ReplaySource = {
  exploredOrder: ['a', 'b', 'd', 'c'],
  frontierSnapshots: [[], ['d', 'c'], ['c'], []],
  path: ['a', 'b', 'c'],
  seed: 'a',
}

function frame(step: number): ReplayFrame {
  return frameOf(SOURCE, step)
}

const panel = (step: number, overrides: Partial<ReplayState> = {}): string =>
  renderToStaticMarkup(
    createElement(ReplayPanel, {
      frame: frame(step),
      state: { ...initialReplayState(), step, ...overrides },
      algorithmLabel: 'A*',
      dispatch: () => {},
    }),
  )

/**
 * The tree the component returned, walked as data.
 *
 * `ReplayPanel` is a function from props to elements and it holds no state, so calling it gives the real tree —
 * every `onKeyDown`, `onClick`, `onChange` inside it is a plain function on a plain object, and calling one of
 * those is *not* a simulated DOM event: it is the handler, with an argument written out. That is how a Node
 * harness tests wiring without acquiring jsdom, and wiring is the part a static markup test cannot see.
 */
interface TreeChild {
  readonly props?: { readonly children?: TreeChild | readonly TreeChild[]; readonly [key: string]: unknown }
}
function handlers(node: unknown, key: string): readonly ((arg: never) => unknown)[] {
  // A JSX child is often an array — `{rows.map(…)}` is one — so a walk that only knows elements stops one level
  // short of every button and reports a component with no handlers at all.
  if (Array.isArray(node)) return node.flatMap((child) => handlers(child, key))
  const props = (node as TreeChild | undefined)?.props
  if (props === undefined) return []
  const found = typeof props[key] === 'function' ? [props[key] as (arg: never) => unknown] : []
  for (const child of Array.isArray(props.children) ? props.children : [props.children]) {
    found.push(...handlers(child, key))
  }
  return found
}

/** The only event a handler can be handed: three fields, all of them lies a real event would tell. */
function fakeKey(key: string, taken: string[] = []): Parameters<ReturnType<typeof handlers>[0]>[0] & object {
  const node: TreeChild = {}
  return {
    key,
    target: node,
    currentTarget: node,
    preventDefault: () => {
      taken.push(key)
    },
  } as unknown as Parameters<ReturnType<typeof handlers>[0]>[0] & object
}

const render = (step: number, overrides: Partial<ReplayState> = {}, sent: ReplayAction[] = []): TreeChild => {
  const props: ReplayPanelProps = {
    frame: frame(step),
    state: { ...initialReplayState(), step, ...overrides },
    algorithmLabel: 'A*',
    dispatch: (action) => {
      sent.push(action)
    },
  }
  return ReplayPanel(props) as unknown as TreeChild
}

describe('the replay panel', () => {
  it('is a labelled, focusable group, because the arrows are its controls', () => {
    const html = panel(2)
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Replay of A*"')
    // `tabindex=0` is the whole of what makes ← and → reachable: the handler is on the group, and a group you
    // cannot focus is a group whose keys belong to nobody.
    expect(html).toContain('tabindex="0"')
  })

  it('names five buttons, and greys the two that cannot act', () => {
    const atStart = panel(0)
    expect(atStart.match(/<button/g)).toHaveLength(5)
    expect(atStart).toContain('aria-label="Back to the first vertex"')
    expect(atStart).toContain('aria-label="One vertex earlier"')
    expect(atStart).toContain('aria-label="One vertex later"')
    expect(atStart).toContain('aria-label="Last frame"')
    // `disabled` rather than absent or inert: the swap button in the route form established the rule, and it is
    // the one that tells a reader why nothing will happen before they try.
    expect(atStart.match(/ disabled=""/g)).toHaveLength(2)
    const atEnd = panel(4)
    expect(atEnd.match(/ disabled=""/g)).toHaveLength(2)
    expect(atEnd).toContain('aria-label="One vertex earlier"')
    expect(atEnd).not.toContain('aria-label="Back to the first vertex" disabled')
  })

  it('marks play as a toggle, and swaps its glyph when it is on', () => {
    const paused = panel(1)
    // `aria-pressed="false"` and not `aria-pressed=""`: React writes the boolean attributes it knows about as
    // `disabled=""` / `selected=""`, but `aria-*` is passed through as the *value*, which is the difference
    // between a toggle a reader can hear and one they cannot.
    expect(paused).toContain('aria-pressed="false"')
    expect(paused).toContain('aria-label="Play the replay"')
    expect(paused).toContain('lucide-play"')
    // The icon class is the only honest way to see the swap in static markup, and it is worth the coupling: a
    // button labelled "Play" that still shows a play triangle while running is the bug this line catches.
    const running = panel(1, { playing: true })
    expect(running).toContain('aria-pressed="true"')
    expect(running).toContain('aria-label="Pause the replay"')
    expect(running).toContain('lucide-pause"')
    // Only the toggle is `aria-pressed`: a step button is not a state.
    expect(paused.match(/aria-pressed/g)).toHaveLength(1)
  })

  it('refuses to play a search that settled nothing', () => {
    const html = renderToStaticMarkup(
      createElement(ReplayPanel, {
        frame: frameOf({ ...SOURCE, exploredOrder: [], frontierSnapshots: [], path: [] }, 0),
        state: initialReplayState(),
        algorithmLabel: 'BFS',
        dispatch: () => {},
      }),
    )
    expect(html).toContain('aria-pressed="false"')
    // All five greyed, not three: with nothing settled the search is simultaneously at its start and at its end,
    // and a panel that offered "one vertex later" on an empty replay would be offering a step off a cliff.
    expect(html.match(/ disabled=""/g)).toHaveLength(5)
    expect(html).toContain('BFS settled nothing before it stopped')
  })

  it('carries the frame in the slider, as a value and as words', () => {
    const html = panel(2)
    expect(html).toContain('type="range"')
    expect(html).toContain('max="4"')
    expect(html).toContain('value="2"')
    // `aria-valuetext` is the difference between "2" and "the search has settled two of four vertices": a
    // scrubber on an algorithm is meaningless as a bare number, and this is announced exactly when a reader
    // moves it, which is when it is wanted.
    expect(html).toContain('aria-valuetext="settled 2 of 4, 2 still competing"')
    expect(html).toContain('class="replay-caption"')
  })

  it('offers the four speeds the reducer accepts, and marks the current one', () => {
    const html = panel(2)
    expect(html.match(/<option value="0\.5"/g)).toHaveLength(1)
    for (const speed of ['0.5', '1', '2', '4']) {
      // A prefix match, because the *selected* row renders as `<option value="1" selected="">` and an exact tag
      // would only be true of the rows nobody chose.
      expect(html, `${speed}× is offered`).toContain(`<option value="${speed}"`)
    }
    expect(html).toContain('<option value="1" selected')
    expect(html).toContain('for="replay-speed"')
  })

  it('says out loud that nothing moves by itself', () => {
    // The sentence *is* the reduced-motion promise in plain words, and it is unconditional because the promise is
    // unconditional: no media query is read, so there is no branch here to test. The CSS side of it is pinned by
    // `src/test/route-styles.spec.ts`, and `panel(2)` above is the proof that a frame never arrives on its own.
    const html = panel(2)
    expect(html).toContain('class="replay-hint"')
    expect(html).toContain('Nothing autoplays')
    expect(html).toContain('drag the slider')
  })

  it('forwards each key the group claims, and no others', () => {
    const sent: ReplayAction[] = []
    const taken: string[] = []
    const tree = render(2, {}, sent)
    const [onKeyDown] = handlers(tree, 'onKeyDown')
    if (onKeyDown === undefined) return expect.fail('the group has no key handler')
    for (const [key, action] of [
      ['ArrowLeft', { type: 'back' }],
      ['ArrowRight', { type: 'forward' }],
      ['Home', { type: 'restart' }],
      ['End', { type: 'finish' }],
      [' ', { type: 'play' }],
    ] as const) {
      onKeyDown(fakeKey(key, taken) as never)
      expect(sent.at(-1), key).toEqual(action)
    }
    expect(taken).toContain(' ')
    // Tab and Enter belong to the buttons inside the group, and a key the replay has no use for must not be
    // swallowed: `preventDefault` is the cost of taking a key, and it was paid once per claimed key.
    const before = sent.length
    onKeyDown(fakeKey('Tab', taken) as never)
    onKeyDown(fakeKey('Enter', taken) as never)
    expect(sent.length, 'unclaimed keys dispatch nothing').toBe(before)
    expect(taken).toHaveLength(5)
  })

  it('leaves a key pressed on a child to the child', () => {
    const sent: ReplayAction[] = []
    const tree = render(2, {}, sent)
    const [onKeyDown] = handlers(tree, 'onKeyDown')
    if (onKeyDown === undefined) return expect.fail('the group has no key handler')
    // The range input has focus and its user pressed →: the slider moves and the search does not, or one key
    // would do two things and a reader could not tell which one they had asked for.
    onKeyDown({ key: 'ArrowRight', target: {}, currentTarget: {}, preventDefault: () => {} } as never)
    expect(sent).toEqual([])
  })

  it('wires each button to the action its label promises', () => {
    const sent: ReplayAction[] = []
    const tree = render(2, {}, sent)
    const clicks = handlers(tree, 'onClick')
    expect(clicks).toHaveLength(5)
    for (const click of clicks) click(undefined as never)
    expect(sent).toEqual([
      { type: 'restart' },
      { type: 'back' },
      { type: 'play' },
      { type: 'forward' },
      { type: 'finish' },
    ])
  })

  it('turns the slider and the speed select into the reducer\'s two value actions', () => {
    const sent: ReplayAction[] = []
    const tree = render(2, {}, sent)
    const changes = handlers(tree, 'onChange')
    expect(changes).toHaveLength(2)
    const [scrub, speed] = changes as [ (a: never) => void, (a: never) => void ]
    scrub(({ target: { value: '4' } } as unknown) as never)
    speed(({ target: { value: '2' } } as unknown) as never)
    expect(sent).toEqual([
      { type: 'scrub', step: 4 },
      { type: 'speed', speed: 2 },
    ])
  })
})
