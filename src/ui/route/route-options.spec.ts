/**
 * The picker's rules, without a DOM.
 *
 * None of this needs React, which is the point of `route-options.ts` existing: the component is a `map` over
 * these rows, and every rule worth arguing about — who is listed, in what order, what is greyed out — is here
 * and assertable. A component test would need a renderer, and the project has no jsdom and will not add one.
 */
import { describe, expect, it } from 'vitest'
import {
  ALGORITHM_CHOICES,
  DEFAULT_PROFILE,
  algorithmChoice,
  pickerRows,
  placeOptions,
  profileChoices,
  swapEndpoints,
} from './route-options'
import type { GraphEdge, GraphNode, NodeId, NodeKind } from '@/data'

function node(id: string, kind: NodeKind = 'place', label = id): GraphNode {
  return { id: id as NodeId, label, kind, x: 0, y: 0 }
}

function edge(from: string, to: string): GraphEdge {
  return { id: `${from}-${to}`, from, to, metres: 100, attributes: {} } as unknown as GraphEdge
}

describe('placeOptions', () => {
  it('lists named vertices and no junctions', () => {
    const options = placeOptions(
      [node('library', 'place', 'Library'), node('j-1', 'junction', 'j-1'), node('atm', 'entrance', 'ATM')],
      [],
    )
    // An entrance and a gate are places a person can be routed to; a junction has no label worth reading, which
    // is the same test the marker layer applies to labels, so the map and the picker cannot disagree about who
    // has a name.
    expect(options.map((option) => option.id)).toEqual(['atm', 'library'])
  })

  it('says which kind a non-place is, and leaves a plain place clean', () => {
    const options = placeOptions([node('gate-1', 'gate', 'Gate 1'), node('library', 'place', 'Library')], [])
    expect(options.map((option) => option.label)).toEqual(['Gate 1 (gate)', 'Library'])
    // The suffix exists because a building called "Gate 1" and the gate called "Gate 1" are two rows a reader
    // has to tell apart, and a picker is the one place they meet.
  })

  it('sorts by label and breaks a tie on id, so the order is the same in every browser', () => {
    const options = placeOptions(
      [
        node('zeta', 'place', 'Quad'),
        node('alpha', 'place', 'Quad'),
        node('beta', 'place', 'Admin Block'),
        node('gamma', 'place', 'atrium'),
      ],
      [],
    )
    // Code-point order, not `localeCompare`: every capital sorts before every lowercase letter, so "atrium"
    // lands last, and that is the order a screenshot can rely on across ICU versions. A file with two places
    // called "Quad" is also the only case where the id tiebreaker matters, and `alpha` wins it.
    expect(options.map((option) => option.id)).toEqual(['beta', 'alpha', 'zeta', 'gamma'])
    // Both input orders, in two-element lists, because a three-element sort's comparison *order* is V8's
    // business and a two-element one is not: this is the only way to know the tiebreaker is asserted from both
    // sides rather than from whichever side the engine happened to compare first.
    expect(placeOptions([node('alpha', 'place', 'Quad'), node('zeta', 'place', 'Quad')], []).map((o) => o.id)).toEqual([
      'alpha',
      'zeta',
    ])
    expect(placeOptions([node('zeta', 'place', 'Quad'), node('alpha', 'place', 'Quad')], []).map((o) => o.id)).toEqual([
      'alpha',
      'zeta',
    ])
    // No third arm is reachable at all: answering `0` needs two rows with the same label *and* the same id,
    // which is `duplicate-id` in the validator, and a row the validator drops never reaches this list.
  })

  it('counts a walkway at both of its ends', () => {
    const options = placeOptions([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('a', 'b')])
    // `a-b` twice is two parallel walkways, and each counts: the number answers "how many segments meet here",
    // which is what the tooltip says too.
    expect(options.map((option) => option.walkways)).toEqual([2, 3, 1])
  })

  it('keeps a place no walkway reaches, with a count of zero', () => {
    const options = placeOptions([node('atm', 'entrance', 'ATM'), node('library', 'place', 'Library')], [edge('x', 'library')])
    const atm = options.find((option) => option.id === 'atm')
    expect(atm?.walkways).toBe(0)
    // Hiding it would make the list shorter than the map, and the `isolated-place` line in the report would be
    // describing a row no picker shows.
    expect(options).toHaveLength(2)
  })
})

describe('pickerRows', () => {
  const options = placeOptions([node('atm', 'place', 'ATM'), node('library', 'place', 'Library')], [edge('y', 'library')])

  it('disables what nothing can route to', () => {
    const rows = pickerRows(options, '')
    expect(rows.map((row) => [row.id, row.unavailable])).toEqual([
      ['atm', true],
      ['library', false],
    ])
  })

  it('never disables the value the picker already holds', () => {
    // A swap can land on an unreachable place, and a `<select>` whose `value` matches no enabled option is a
    // control displaying something the state does not say. The row stays selectable so the current answer is
    // visible, and the card is the place that explains why it routes nowhere.
    const rows = pickerRows(options, 'atm')
    expect(rows.find((row) => row.id === 'atm')?.unavailable).toBe(false)
  })

  it('leaves a reachable place alone whatever is selected', () => {
    const rows = pickerRows(options, 'library')
    expect(rows.every((row) => row.id === 'atm' ? row.unavailable : !row.unavailable)).toBe(true)
  })

  it('copies the option fields it was given', () => {
    const rows = pickerRows(options, '')
    expect(rows[0]).toEqual({ id: 'atm', label: 'ATM', kind: 'place', walkways: 0, unavailable: true })
  })
})

describe('swapEndpoints', () => {
  it('is its own inverse', () => {
    expect(swapEndpoints('a', 'b')).toEqual(['b', 'a'])
    const [from, to] = swapEndpoints(...swapEndpoints('library', 'atm'))
    expect([from, to]).toEqual(['library', 'atm'])
    // Including the case where both are the same place, because the button is enabled there and swapping must
    // not lose the choice.
    expect(swapEndpoints('a', 'a')).toEqual(['a', 'a'])
    // And an empty picker: the button is disabled at 0 or 1 choices, so this is the state behind that guard.
    expect(swapEndpoints('', 'b')).toEqual(['b', ''])
  })
})

describe('the algorithm dropdown', () => {
  it('offers exactly the three shortest-path names, in the order the hint explains them', () => {
    expect(ALGORITHM_CHOICES.map((choice) => choice.value)).toEqual(['a-star', 'dijkstra', 'bfs'])
    expect(ALGORITHM_CHOICES.map((choice) => choice.label)).toEqual(['A*', 'Dijkstra', 'BFS'])
  })

  it('has one non-empty note per choice, and no repeated label', () => {
    const labels = new Set(ALGORITHM_CHOICES.map((choice) => choice.label))
    expect(labels.size).toBe(ALGORITHM_CHOICES.length)
    for (const choice of ALGORITHM_CHOICES) {
      expect(choice.note.trim().length).toBeGreaterThan(20)
      // Every note names what the search optimises, because that is the only difference a reader can act on.
      expect(choice.note).toMatch(/distance|segments|hop/)
    }
  })

  it('looks the same value up as it hands out', () => {
    for (const choice of ALGORITHM_CHOICES) {
      // Identity, not a copy: the hint under the select and the `<option>` must be the same row, or one can be
      // edited without the other.
      expect(algorithmChoice(choice.value)).toBe(choice)
    }
  })
})

describe('profileChoices', () => {
  const table = {
    shortest: { label: 'Shortest walk', blurb: 'The fewest metres.' },
    shaded: { label: 'Stay in the shade', blurb: 'Prefers shade.' },
    lit: { label: 'Stay on lit routes', blurb: 'Prefers lamps.' },
    'step-free': { label: 'Step-free', blurb: 'Prices stairs at twelve times.' },
    quiet: { label: 'Quietest route', blurb: 'Charges the crowd.' },
  } as const

  it('keeps the order it is given, and starts where the app starts', () => {
    const order = ['shortest', 'shaded', 'lit', 'step-free', 'quiet'] as const
    const rows = profileChoices(table, order)
    expect(rows.map((row) => row.value)).toEqual([...order])
    // The baseline first, because a reader who wants the plain answer should not have to hunt for the option
    // that produces it — and because `DEFAULT_PROFILE` is what the app holds before any choice is made.
    expect(rows[0]?.value).toBe(DEFAULT_PROFILE)
    expect(DEFAULT_PROFILE).toBe('shortest')
  })

  it('copies the label and the sentence without editing either', () => {
    const rows = profileChoices(table, ['shortest', 'shaded', 'lit', 'step-free', 'quiet'])
    for (const row of rows) {
      expect(row.label).toBe(table[row.value].label)
      // The blurb is the engine's own sentence about the trade. A picker that shortened it for space would be
      // free to change its meaning, and the sentence is the part that tells a user what they are accepting.
      expect(row.note).toBe(table[row.value].blurb)
    }
  })

  it('narrows a longer order to the rows the UI has names for, and no further', () => {
    // `readonly ProfileName[]` is the whole of the safety here: the caller in `App.tsx` hands over the engine's
    // `PROFILE_ORDER`, and `tsc` is what proves the two unions still mean the same five things.
    expect(profileChoices(table, ['quiet'])).toEqual([{ value: 'quiet', label: 'Quietest route', note: 'Charges the crowd.' }])
  })
})
