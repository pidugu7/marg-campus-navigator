/**
 * The card, as markup — no DOM, no jsdom, one render.
 *
 * `react-dom/server` is already a dependency, so a component's *output* is testable in Node even though nothing
 * can click it: `renderToStaticMarkup` gives the HTML the first paint would have. That is enough for the claims
 * worth making here — which state draws which copy, that a step row exists per step with its turn arrow rotated
 * to the side the engine named, that a refusal carries the engine's own sentence. What it is *not* enough for is
 * layout, and the class-name check that goes with it lives in `src/test/route-styles.spec.ts`, where the
 * stylesheets can be read from disk.
 *
 * What this deliberately does not do: assert on geometry (px offsets, wrapping, scrollbars). No renderer here
 * measures text, so any number I wrote down for those would be a guess wearing a test's clothes. The live
 * preview at 360 / 768 / 1440 is the check for that, and `PHASES.md` records what was looked at.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RouteCard } from './route-card'
import { RouteControls } from './route-controls'
import { ALGORITHM_CHOICES, placeOptions, profileChoices } from './route-options'
import type { ProfileChoice } from './route-options'
import { buildGraph, campus } from '@/data'
import type { RouteView } from './route-card'
import type { RoutableView } from './route-summary'

/**
 * The picker's rows, built by the function the app builds them with — over a *literal* table rather than the
 * engine's, because `src/ui` may not import `@/engine` and a spec that did would pass while the app could not
 * build. The table's shape is what `Record<ProfileName, ProfileWords>` demands, so the fixture cannot drift into
 * a shape the component would never receive.
 */
const PROFILE_ROWS: readonly ProfileChoice[] = profileChoices(
  {
    shortest: { label: 'Shortest walk', blurb: 'The fewest metres, whatever they are paved with.' },
    shaded: { label: 'Stay in the shade', blurb: 'Prefers covered and tree-shaded walkways.' },
    lit: { label: 'Stay on lit routes', blurb: 'Prefers lit walkways at night.' },
    'step-free': { label: 'Step-free', blurb: 'Prices stairs at twelve times their length.' },
    quiet: { label: 'Quietest route', blurb: 'Chases the crowd out of the cost.' },
  },
  ['shortest', 'shaded', 'lit', 'step-free', 'quiet'],
)

/** The found branch, not the union: a test that adds a `profile` line has to spread a *found* view, and
 * spreading the union would let the `missing` branch's shape into an object that claims otherwise. */
type FoundView = Extract<RouteView, { state: 'found' }>

const found = (overrides: Partial<RoutableView> = {}): FoundView => ({
  state: 'found',
  paceMps: 1.4,
  route: {
    algorithm: 'a-star',
    metres: 1517.7,
    minutes: 18.1,
    hops: 10,
    expanded: 24,
    ms: 1,
    nodeCount: 11,
    steps: [
      { instruction: 'Head north-west', metres: 192.4, direction: 'straight' },
      { instruction: 'Turn left at Academic Block A', metres: 103, direction: 'left' },
      { instruction: 'Bear right, your destination', metres: 143.2, direction: 'slight-right' },
    ],
    ...overrides,
  },
})

function render(view: RouteView | null, from = 'Research Labs', to = 'Hostel Block 2'): string {
  return renderToStaticMarkup(createElement(RouteCard, { view, fromLabel: from, toLabel: to }))
}

describe('the route form', () => {
  // Rendered from the real campus file, because the picker's whole job is agreeing with the data: an option
  // list built from a fixture would pass while the app offered something the map does not have.
  const model = buildGraph(campus)
  const options = placeOptions(model.nodes, model.edges)

  function form(from: string, to: string, algorithm = 'a-star'): string {
    return renderToStaticMarkup(
      createElement(RouteControls, {
        options,
        from,
        to,
        algorithm: algorithm as 'a-star' | 'dijkstra' | 'bfs',
        profile: 'shaded' as const,
        profiles: PROFILE_ROWS,
        onFrom: () => {},
        onTo: () => {},
        onAlgorithm: () => {},
        onProfile: () => {},
        onSwap: () => {},
      }),
    )
  }

  it('lists every named place, and no junctions, in both pickers', () => {
    const html = form('library', 'gate-north')
    // Both pickers (one blank row each) plus the three algorithm rows and the five preferences: 50
    // `<option>`s for a 20-place campus. Counted from the same arrays the component maps over, so a sixth
    // profile changes this line rather than making it agree with itself.
    expect(html.match(/<option/g)).toHaveLength(
      (options.length + 1) * 2 + ALGORITHM_CHOICES.length + PROFILE_ROWS.length,
    )
    expect(html).toContain('>Central Library<')
    expect(html).toContain('North Gate (gate)')
    expect(html).not.toContain('>acad c<')
    // The one blank row per picker, so an empty state has something to display rather than a select whose first
    // place is silently chosen for you.
    expect(html.match(/<option value=""/g)).toHaveLength(2)
  })

  it('marks the selected place in each picker, and only that one', () => {
    const html = form('library', 'gate-north')
    expect(html.match(/<option value="library" selected/g)).toHaveLength(1)
    expect(html.match(/<option value="gate-north" selected/g)).toHaveLength(1)
    // Four and not two: the two place pickers, the algorithm and the preference all mark their own selection the
    // same way — `selected=""` in the markup, which is React's answer to a boolean attribute rather than a thing
    // this component controls. A profile select that did not carry the current choice would render a form whose
    // select and whose numbers disagree, and this count is the cheap way to notice.
    expect(html.match(/ selected/g)).toHaveLength(4)
  })

  it('lists every preference, marks the one in use, and prints what it trades', () => {
    const html = form('library', 'gate-north')
    for (const row of PROFILE_ROWS) {
      // Split in two, because React writes `selected=""` into the option that is current and an assertion about
      // the whole tag would only be true of the four rows nobody chose.
      expect(html, `${row.value} is selectable`).toContain(`<option value="${row.value}"`)
      expect(html, `${row.value} is labelled`).toContain(`>${row.label}</option>`)
    }
    expect(html).toContain('<option value="shaded" selected')
    // The note is the engine's sentence about the profile, verbatim — the form does not paraphrase a trade-off.
    expect(html).toContain('Prefers covered and tree-shaded walkways.')
    // A select needs a label a keyboard user can reach; `htmlFor` is how the two place pickers do it too.
    expect(html).toContain('for="route-profile"')
    expect(html).toContain('>Preference<')
  })

  it('names the preference and its price, and says so in one line', () => {
    const html = renderToStaticMarkup(
      createElement(RouteCard, {
        fromLabel: 'Research Labs',
        toLabel: 'Hostel Block 2',
        view: {
          ...found(),
          profile: { label: 'Stay in the shade', delta: { metres: 46, minutes: 0.3 } },
        },
      }),
    )
    expect(html).toContain('class="route-profile"')
    expect(html).toContain('>Stay in the shade<')
    // Distances come out of `formatMetres`, which always shows the tenth, so a Δ reads `+46.0 m` and not `+46 m`
    // — the same rule the figure above it obeys, which is the point of routing a difference through it.
    expect(html).toContain('+46.0 m')
    // …and a time difference below a minute reads as seconds, because it goes through `formatMinutes`, which is
    // the rule the duration beside it obeys. "0.3 min" and "18 s" are the same claim; only one of them is a
    // sentence a person can use.
    expect(html).toContain('+18 s')
    expect(html).toContain('vs shortest')
    // …and the live region says the same thing, so a reader who never sees the caption is not missing the fact
    // that these numbers are not the shortest walk.
    expect(html).toContain('on the “Stay in the shade” preference (+46.0 m · +18 s).')
  })

  it('draws no price when the preference is the baseline, and no line when there is no preference', () => {
    const baseline = renderToStaticMarkup(
      createElement(RouteCard, {
        fromLabel: 'a',
        toLabel: 'b',
        view: { ...found(), profile: { label: 'Shortest walk', delta: null } },
      }),
    )
    expect(baseline).toContain('>Shortest walk<')
    expect(baseline).not.toContain('vs shortest')
    expect(baseline).not.toContain('route-delta')
    const bare = renderToStaticMarkup(createElement(RouteCard, { fromLabel: 'a', toLabel: 'b', view: found() }))
    expect(bare).not.toContain('route-profile')
    expect(bare).toContain('steps, by a-star.')
  })

  it('draws no caption when the rows are missing, and keeps the select working', () => {
    // The `undefined` arm of `profiles.find(…)` is not a hypothetical branch to be covered for its own sake: it
    // is what the form does when the engine and the UI disagree. No caption, no crash, and the select is still
    // there with its rows — the *choice* is intact, only the explanation is gone.
    const html = renderToStaticMarkup(
      createElement(RouteControls, {
        options,
        from: 'library',
        to: 'gate-north',
        algorithm: 'a-star',
        profile: 'shaded',
        profiles: [],
        onFrom: () => {},
        onTo: () => {},
        onAlgorithm: () => {},
        onProfile: () => {},
        onSwap: () => {},
      }),
    )
    expect(html).toContain('id="route-profile"')
    // The *algorithm's* caption survives — it is looked up in a record the component builds itself — and only the
    // preference's is gone. Counting the class rather than looking for its absence is what says so.
    expect(html.match(/class="route-note"/g)).toHaveLength(1)
    expect(html).not.toContain('Prefers covered')
  })

  it('greys out a place no walkway reaches, but never the one already picked', () => {
    // The synthetic file has no isolated place, so this uses the rule's own shape on the real list: nothing is
    // disabled here, and that is the assertion — a picker that disabled rows the campus does not deserve would
    // fail as loudly as one that forgot to.
    expect(form('library', 'gate-north')).not.toContain('disabled')
    const withIsolated = renderToStaticMarkup(
      createElement(RouteControls, {
        options: [{ id: 'atm', label: 'ATM', kind: 'entrance', walkways: 0 }, ...options],
        from: '',
        to: 'library',
        algorithm: 'bfs',
        profile: 'lit' as const,
        profiles: PROFILE_ROWS,
        onFrom: () => {},
        onTo: () => {},
        onAlgorithm: () => {},
        onProfile: () => {},
        onSwap: () => {},
      }),
    )
    expect(withIsolated).toContain('value="atm" disabled')
    expect(withIsolated).toContain('ATM — unreachable')
  })

  it('selects the algorithm the state holds, and explains it under the row', () => {
    expect(form('library', 'gate-north', 'bfs')).toContain('<option value="bfs" selected')
    expect(form('library', 'gate-north', 'bfs')).toContain('Fewest walkway segments')
    expect(form('library', 'gate-north', 'a-star')).toContain('straight-line distance left')
  })

  it('disables the swap until both ends exist', () => {
    expect(form('', '')).toContain('class="route-swap" disabled')
    expect(form('library', '')).toContain('class="route-swap" disabled')
    expect(form('library', 'gate-north')).not.toContain('class="route-swap" disabled')
  })
})

describe('the route card', () => {
  it('shows what to do before anything has been asked', () => {
    const html = render(null)
    expect(html).toContain('Pick a start and a destination')
    expect(html).toContain('route-state--idle')
    // No numbers, no list: an empty card that shows `0.0 m` would be reporting a walk nobody asked for.
    expect(html).not.toContain('route-steps')
    expect(html).not.toMatch(/\d+(\.\d+)? m/)
  })

  it('prints the pair, the distance, the duration and the pace that produced it', () => {
    const html = render(found())
    expect(html).toContain('Research Labs')
    expect(html).toContain('Hostel Block 2')
    expect(html).toContain('1,517.7 m')
    expect(html).toContain('18.1 min')
    expect(html).toContain('at 1.4 m/s')
  })

  it('says the whole finding once in an aria-live region, and the details in an ordered list', () => {
    const html = render(found())
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('1,517.7 m, 18.1 min, 3 steps, by a-star.')
    // `<ol>` and not `<ul>`: the turns have an order, and the numbering in the card is a CSS counter over that
    // list — an unordered list would lose both the count and the claim.
    expect(html).toMatch(/<ol class="route-steps">/)
    expect(html.match(/<li class="route-step /g)).toHaveLength(3)
  })

  it('rotates each step arrow to the side its bucket names', () => {
    const html = render(found())
    expect(html).toContain('rotate(0deg)')
    expect(html).toContain('rotate(-90deg)')
    expect(html).toContain('rotate(45deg)')
    // And the row carries the bucket as a class, because the colour of the arrow (left indigo, right orange) is
    // a stylesheet decision, not something this component should be computing.
    expect(html).toContain('route-step--left')
    expect(html).toContain('route-step--slight-right')
  })

  it('lists the search cost next to the walk, which is the whole point of the pane', () => {
    const html = render(found())
    expect(html).toContain('vertices settled')
    expect(html).toContain('<dd>24</dd>')
    expect(html).toContain('walkway segments')
    expect(html).toContain('turns to make')
    // 3 sentences, 2 turns: the difference is `simplifyLegs` and the opening heading, and both numbers are on
    // the card so a reader can ask which is which.
    expect(html).toContain('>3<')
    expect(html).toContain('>2<')
  })

  it('handles the zero-length route without inventing a walk', () => {
    const html = render(
      found({
        metres: 0,
        minutes: 0,
        hops: 0,
        expanded: 1,
        nodeCount: 1,
        steps: [{ instruction: 'Stay where you are', metres: 0, direction: 'stay' }],
      }),
      'Library',
      'Library',
    )
    expect(html).toContain('0.0 m')
    expect(html).toContain('0 s')
    expect(html).toContain('route-step--stay')
    expect(html).toContain('rotate(0deg)')
  })

  it('quotes the search when there is no route, and shows what it looked at', () => {
    const html = render({
      state: 'missing',
      failure: { reason: 'disconnected', message: 'no walkway connects them', explored: 41 },
    })
    expect(html).toContain('No way there on foot')
    expect(html).toContain('no walkway connects them')
    expect(html).toContain('It settled 41 vertices before concluding this.')
    expect(html).toContain('route-state--missing')
    expect(html).not.toContain('route-steps')
  })

  it('distinguishes a map with nothing on it from a place no walkway reaches', () => {
    const empty = render({ state: 'missing', failure: { reason: 'empty-graph', message: 'the file has no nodes', explored: 0 } })
    expect(empty).toContain('There is no map to search')
    expect(empty).toContain('The search settled nothing: it stopped before it began.')
    const badCost = render({
      state: 'missing',
      failure: { reason: 'invalid-graph', message: 'walkway "a-b" cost 0', explored: 0 },
    })
    expect(badCost).toContain('A walkway is priced wrongly')
    expect(badCost).toContain('walkway &quot;a-b&quot; cost 0')
  })
})
