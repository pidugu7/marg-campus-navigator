/**
 * The route form: its controls, and the four arrows that move them.
 *
 * The markup half is what `renderToStaticMarkup` has always given this project. The handler half uses the trick
 * the replay panel's spec introduced — a stateless component is a function, its children are data, and a
 * `onChange` on that data is a function a test may simply call. That is what closes the gap `ARCHITECTURE.md`
 * carried since Phase 3 as "the honest shape of a Node-only harness": the shape was never the limit, only the
 * technique. Six arrows, six assertions, no new dependency.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlacePicker, RouteControls } from './route-controls'
import type { RouteControlsProps } from './route-controls'
import type { PlaceOption, ProfileChoice } from './route-options'

// `unavailable` is not an input, it is what `pickerRows` derives from `walkways === 0` — so the fixture sets the
// degree and lets the rule decide, which is also the only way to test that the rule is what greys a row.
const OPTIONS: readonly PlaceOption[] = [
  { id: 'a', label: 'Main gate', kind: 'gate', walkways: 2 },
  { id: 'b', label: 'Research Labs', kind: 'place', walkways: 3 },
  { id: 'c', label: 'North annexe', kind: 'place', walkways: 0 },
]

const PROFILES: readonly ProfileChoice[] = [
  { value: 'shortest', label: 'Shortest walk', note: 'metres, nothing else' },
  { value: 'shaded', label: 'Stay in the shade', note: 'shade is cheap, sun is not' },
] as const

interface Sent {
  readonly from: string[]
  readonly to: string[]
  readonly algorithm: string[]
  readonly profile: string[]
  readonly compare: boolean[]
  swaps: number
}

/** The props the form needs, all of them recording what they were called with. */
function props(over: Partial<RouteControlsProps> = {}): { props: RouteControlsProps; sent: Sent } {
  const sent: Sent = { from: [], to: [], algorithm: [], profile: [], compare: [], swaps: 0 }
  return {
    sent,
    props: {
      options: OPTIONS,
      from: 'a',
      to: 'b',
      algorithm: 'a-star',
      profile: 'shortest',
      profiles: PROFILES,
      compare: false,
      onFrom: (id) => sent.from.push(id),
      onTo: (id) => sent.to.push(id),
      onAlgorithm: (id) => sent.algorithm.push(id),
      onProfile: (id) => sent.profile.push(id),
      onCompare: (next) => sent.compare.push(next),
      onSwap: () => {
        sent.swaps += 1
      },
      ...over,
    },
  }
}

interface TreeChild {
  readonly props?: { readonly children?: TreeChild | readonly TreeChild[]; readonly [key: string]: unknown }
}

function find(node: unknown, key: string): readonly unknown[] {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, key))
  const at = (node as TreeChild | undefined)?.props
  if (at === undefined) return []
  // `unknown[]`, not the inferred type: `typeof at[key] === 'function'` narrows the element to `Function`,
  // and a `Function[]` refuses the recursion's `unknown[]`.
  const out: unknown[] = typeof at[key] === 'function' ? [at[key]] : []
  for (const child of Array.isArray(at.children) ? at.children : [at.children]) out.push(...find(child, key))
  return out
}

const call = (fn: unknown, arg: unknown): void => (fn as (event: unknown) => void)(arg)

/** The picker elements, by the id they were given — unrendered, so their props are the wiring itself. */
function pickers(node: unknown): readonly { id: string; onSelect: (id: string) => void }[] {
  const out: { id: string; onSelect: (id: string) => void }[] = []
  const at = (node as TreeChild | undefined)?.props
  if (at === undefined) return out
  if (typeof at.id === 'string' && typeof at.onSelect === 'function') {
    out.push({ id: at.id, onSelect: at.onSelect as (id: string) => void })
  }
  const children = at.children
  if (children === undefined) return out
  for (const child of Array.isArray(children) ? children : [children]) out.push(...pickers(child))
  return out
}

describe('the route form', () => {
  it('gives every control a name, and the picker its engine rows', () => {
    const html = renderToStaticMarkup(createElement(RouteControls, props().props))
    expect(html).toContain('id="route-from"')
    expect(html).toContain('id="route-to"')
    expect(html).toContain('id="route-algorithm"')
    expect(html).toContain('id="route-profile"')
    expect(html).toContain('id="route-compare"')
    // Four `<select>`s on the screen, three in the source: the place picker is one component rendered twice,
    // which is why the stylesheet guard counts closing tags in the file and this counts opening tags in the
    // output. Both numbers are right, and saying which is which is the point.
    expect(html.match(/<select/g)).toHaveLength(4)
    expect(html).toContain('Stay in the shade')
    expect(html).toContain('no walkway reaches this place')
  })

  it('greys the swap until both ends exist, and lets it through when they do', () => {
    // About the button, not the document: the fixture's unreachable place puts its own `disabled` on an
    // `<option>` in both renders, and a count of the attribute would be a test of the option list.
    const empty = renderToStaticMarkup(createElement(RouteControls, props({ from: '' }).props))
    expect(empty).toContain('class="route-swap" disabled=""')
    const both = renderToStaticMarkup(createElement(RouteControls, props().props))
    expect(both).not.toContain('class="route-swap" disabled')
  })

  it('marks compare mode on the request, and reports a press as a boolean', () => {
    const { props: p, sent } = props()
    const html = renderToStaticMarkup(createElement(RouteControls, p))
    expect(html).toContain('type="checkbox"')
    // `checked` is absent rather than `checked="false"`: React drops a false boolean attribute, which is the
    // only reason `selected`/`disabled` and `aria-checked` ever disagree in a static render.
    expect(html).not.toContain('checked=')
    // The last `onChange` in the tree is the checkbox's: the pickers expose `onSelect`, and the two selects
    // ahead of it change before it in document order.
    const box = find(RouteControls(p), 'onChange')
    expect(box).toHaveLength(3)
    call(box[2], { target: { checked: true } })
    expect(sent.compare).toEqual([true])

    const on = renderToStaticMarkup(createElement(RouteControls, props({ compare: true }).props))
    expect(on).toContain('checked=""')
    expect(on).toContain('Compare all three searches')
  })

  it('routes each select to the setter it belongs to', () => {
    const { props: p, sent } = props()
    // Calling the component rather than creating an element: `createElement` hands back props for a render that
    // has not happened, and the handlers I want are the ones the render puts on the elements it builds.
    const tree = RouteControls(p)
    const changes = find(tree, 'onChange')
    expect(changes).toHaveLength(3)
    call(changes[0], { target: { value: 'bfs' } })
    call(changes[1], { target: { value: 'shaded' } })
    expect(sent.algorithm).toEqual(['bfs'])
    expect(sent.profile).toEqual(['shaded'])
  })

  it('attaches the from setter to the from picker and the to setter to the to picker', () => {
    const { props: p, sent } = props()
    const rows = pickers(RouteControls(p))
    expect(rows.map((row) => row.id)).toEqual(['route-from', 'route-to'])
    // The classic mis-wire is a form that fills both ends from one select, and a markup test cannot see it: the
    // two ids have to answer to two different setters.
    rows[0]?.onSelect('b')
    rows[1]?.onSelect('c')
    expect(sent.from).toEqual(['b'])
    expect(sent.to).toEqual(['c'])
  })

  it('wires the swap button to the swap, once per press', () => {
    const { props: p, sent } = props()
    const clicks = find(RouteControls(p), 'onClick')
    expect(clicks).toHaveLength(1)
    call(clicks[0], undefined)
    call(clicks[0], undefined)
    expect(sent.swaps).toBe(2)
  })

  it('keeps an unreachable place visible and disabled, and hands a chosen id straight out', () => {
    const picks: string[] = []
    const html = renderToStaticMarkup(
      createElement(PlacePicker, { id: 'x', caption: 'To', value: 'a', options: OPTIONS, onSelect: (id) => picks.push(id) }),
    )
    expect(html).toContain('North annexe — unreachable')
    expect(html.match(/<option value="c" disabled/g)).toHaveLength(1)
    expect(html).toContain('no walkway reaches this place')
    // …and the selected row is never greyed out of existence: `pickerRows` exempts the current value, so a place
    // that became unreachable while selected stays readable.
    expect(html).toContain('<option value="a" selected')
    const [onChange] = find(
      PlacePicker({ id: 'x', caption: 'To', value: '', options: OPTIONS, onSelect: (id) => picks.push(id) }),
      'onChange',
    )
    call(onChange, { target: { value: 'b' } })
    expect(picks).toEqual(['b'])
  })

  it('shows "no place" once a place exists, so an empty row is never a mystery', () => {
    const drawn = (value: string): string =>
      renderToStaticMarkup(createElement(PlacePicker, { id: 'x', caption: 'From', value, options: OPTIONS, onSelect: () => {} }))
    expect(drawn('')).toContain('pick a place…')
    expect(drawn('a')).toContain('no place')
    expect(drawn('a')).not.toContain('pick a place')
  })

  it('offers to clear the cache only while there is something to clear', () => {
    const clear = () => undefined
    const empty = renderToStaticMarkup(createElement(RouteControls, props({ cache: null, onClearCache: clear }).props))
    expect(empty).toContain('Clear the route cache')
    expect(empty).toContain('class="cache-clear" disabled=""')
    const full = renderToStaticMarkup(
      createElement(RouteControls, props({ cache: { cached: false, hits: 1, misses: 1, lookups: 2, size: 3, capacity: 192, evictions: 0 }, onClearCache: clear }).props),
    )
    expect(full).toContain('Clear the route cache (3 answers kept)')
    expect(full).not.toContain('class="cache-clear" disabled')
    // A card built without a clear handler — a test fixture, an embedded pane — draws no dead button.
    expect(renderToStaticMarkup(createElement(RouteControls, props().props))).not.toContain('cache-clear')
  })

  it('hands the press straight to the caller, with no argument to get wrong', () => {
    let clears = 0
    const controls = RouteControls(props({ onClearCache: () => { clears += 1 } }).props)
    // `onClick` is a property on a rendered element, so it can be called without a document — the technique the
    // replay panel's spec introduced. The clear button is the only `onClick` on this form that takes *no* event
    // (the swap button takes none either, so both are exercised by the same loop and the count below is what
    // distinguishes them: one press of each, and `swaps` would be 1 if the swap handler were reachable here).
    const handlers = find(controls, 'onClick')
    for (const each of handlers) {
      if (typeof each === 'function' && each.length === 0) (each as () => void)()
    }
    expect(clears).toBe(1)
  })
})
