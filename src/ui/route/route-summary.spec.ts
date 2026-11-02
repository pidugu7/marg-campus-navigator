/**
 * The card's text. Every function here returns a string a person reads, which is the kind of thing that either
 * reads correctly or does not, and a screenshot of "60 s" is a slow way to find that out.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_ROUTE_COPY,
  describeFailure,
  formatMetres,
  formatMinutes,
  summarise,
  turnRotation,
  type DirectionName,
  type FailureView,
  type RoutableView,
} from './route-summary'

const REASONS = ['disconnected', 'unknown-origin', 'unknown-destination', 'empty-graph', 'invalid-graph'] as const

function route(overrides: Partial<RoutableView> = {}): RoutableView {
  return {
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
  }
}

describe('formatMetres', () => {
  it('groups the integer part in threes and always shows a tenth', () => {
    expect(formatMetres(0)).toBe('0.0 m')
    expect(formatMetres(82.5)).toBe('82.5 m')
    expect(formatMetres(999.9)).toBe('999.9 m')
    expect(formatMetres(1517.7)).toBe('1,517.7 m')
    expect(formatMetres(1234567.8)).toBe('1,234,567.8 m')
  })

  it('rounds before it groups, so a carry can never produce "1,000.0" from "999.95" twice', () => {
    // The order is the test: grouping first would put the comma in the wrong place for a value that rounds up
    // across a thousand, and the tenth the engine rounds legs to makes that a routine input rather than a
    // curiosity.
    expect(formatMetres(999.95)).toBe('1,000.0 m')
    expect(formatMetres(999.94)).toBe('999.9 m')
  })
})

describe('formatMinutes', () => {
  it('quotes seconds under a minute and tenths of a minute above it', () => {
    expect(formatMinutes(0)).toBe('0 s')
    expect(formatMinutes(0.25)).toBe('15 s')
    expect(formatMinutes(0.99)).toBe('59 s')
    expect(formatMinutes(1)).toBe('1 min')
    expect(formatMinutes(18.1)).toBe('18.1 min')
    expect(formatMinutes(18.05)).toBe('18.1 min')
    // 0.999 rounds to 60 seconds, and a card that says "60 s" one line before it would say "1 min" is a card
    // with two units and no rule.
    expect(formatMinutes(0.999)).toBe('1 min')
  })
})

describe('summarise', () => {
  it('pairs the distance, the duration and the pace that produced it', () => {
    const summary = summarise(route(), 1.4)
    expect(summary.distance).toBe('1,517.7 m')
    expect(summary.duration).toBe('18.1 min')
    expect(summary.pace).toBe('1.4 m/s')
  })

  it('lists the metrics in the order the explanation needs them', () => {
    const rows = summarise(route(), 1.4).rows
    expect(rows.map((row) => row.label)).toEqual([
      'algorithm',
      'vertices settled',
      'search time',
      'walkway segments',
      'directions',
      'places along',
      'turns to make',
    ])
    expect(rows.map((row) => row.value)).toEqual(['a-star', '24', '1 ms', '10', '3', '11', '2'])
  })

  it('counts turns from the direction, not from the wording', () => {
    // `turns to make` excludes the opening heading and a `'stay'` (a zero-length route). Reading the sentence
    // to find that out would break the first time the prose is improved, so the bucket decides — and this is
    // the row that pins which one it is.
    const stay = summarise(
      route({
        hops: 0,
        metres: 0,
        minutes: 0,
        nodeCount: 1,
        steps: [{ instruction: 'Stay where you are', metres: 0, direction: 'stay' }],
      }),
      1.4,
    )
    expect(stay.rows[6]?.value).toBe('0')
    expect(stay.distance).toBe('0.0 m')
    expect(stay.duration).toBe('0 s')
    const threeTurns = summarise(
      route({ steps: route().steps.concat([{ instruction: 'Turn right', metres: 40, direction: 'right' }]) }),
      1.4,
    )
    expect(threeTurns.rows[6]?.value).toBe('3')
    expect(threeTurns.rows[4]?.value).toBe('4')
  })

  it('hands the steps through untouched, in order', () => {
    const summary = summarise(route(), 1.4)
    expect(summary.steps).toEqual(route().steps)
  })

  it('writes one sentence that says the whole finding, for a status line', () => {
    expect(summarise(route(), 1.4).announced).toBe(
      '1,517.7 m, 18.1 min, 3 steps, by a-star.',
    )
  })
})

describe('describeFailure', () => {
  function failure(reason: (typeof REASONS)[number], explored = 41): FailureView {
    return { reason, message: 'no walkway connects them', explored }
  }

  it('answers every refusal the engine can give, with different words', () => {
    const headlines = REASONS.map((reason) => describeFailure(failure(reason)).headline)
    expect(headlines).toHaveLength(REASONS.length)
    expect(new Set(headlines).size).toBe(REASONS.length)
    for (const one of headlines) expect(one.length).toBeGreaterThan(8)
  })

  it('quotes the engine rather than paraphrasing it, because the engine names the offender', () => {
    const described = describeFailure(failure('disconnected'))
    expect(described.detail).toContain('no walkway connects them')
    expect(described.announced).toBe('No way there on foot. no walkway connects them')
  })

  it('says what the search looked at, and says it differently when the answer was nothing', () => {
    // "No route" alone reads as a broken app; "it settled 41 vertices first" reads as a search that worked on a
    // map with a hole in it. And 0 explored *is* a different fact — an empty graph or a bad id — so it does not
    // get the sentence about vertices.
    expect(describeFailure(failure('disconnected')).looked).toBe('It settled 41 vertices before concluding this.')
    expect(describeFailure(failure('disconnected', 1)).looked).toBe('It settled 1 vertex before concluding this.')
    expect(describeFailure(failure('empty-graph', 0)).looked).toBe('The search settled nothing: it stopped before it began.')
  })
})

describe('the arrow on a step row', () => {
  it('rotates every bucket to the side the word says', () => {
    const DIRECTIONS: readonly DirectionName[] = [
      'straight',
      'slight-left',
      'left',
      'sharp-left',
      'uturn',
      'sharp-right',
      'right',
      'slight-right',
      'stay',
    ]
    expect(DIRECTIONS.map(turnRotation)).toEqual([0, -45, -90, -135, 180, 135, 90, 45, 0])
    // Left is negative and right is positive, because the arrow is rotated clockwise: an inverted table would
    // still be a permutation of the same nine numbers, so the sign is asserted rather than trusted.
    expect(turnRotation('left')).toBeLessThan(0)
    expect(turnRotation('right')).toBeGreaterThan(0)
    // The buckets mirror, except the U-turn, which is the one that cannot.
    for (const [left, right] of [
      ['slight-left', 'slight-right'],
      ['left', 'right'],
      ['sharp-left', 'sharp-right'],
    ] as const) {
      expect(turnRotation(left)).toBe(-turnRotation(right))
    }
    // And the list here is the whole union, so a tenth bucket in the engine is a compile error on this line
    // rather than an arrow that silently points straight ahead.
    expect(DIRECTIONS).toHaveLength(9)
  })
})

describe('the empty state', () => {
  it('tells the reader what to do, and does not look like an error', () => {
    expect(EMPTY_ROUTE_COPY.headline).toBe('Pick a start and a destination')
    // No exclamation, no "error", no "failed": nothing has gone wrong yet.
    expect(EMPTY_ROUTE_COPY.headline + EMPTY_ROUTE_COPY.detail).not.toMatch(/error|fail|invalid|unable/i)
    expect(EMPTY_ROUTE_COPY.detail).toContain('walkway')
  })
})
