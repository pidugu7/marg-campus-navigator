/**
 * The compare table's three decisions, as pure arithmetic.
 *
 * The claim that earns this file is the last one: the insight sentence is *generated*. An example-based test can
 * show a sentence is right about one fixture; only a property can show it is derived, so the seeded test below
 * invents thousands of triples and asserts that every figure the sentence prints is a figure the rows contain
 * (or a difference between two of them). A hard-coded number, or a `ms` value leaking into prose that calls it
 * indicative, fails there rather than in front of a class.
 */
import { describe, expect, it } from 'vitest'
import {
  COLUMNS,
  COMPARE_ORDER,
  bestIn,
  compareInsight,
  dashArrayString,
  LANE_OFFSET_PX,
  dashStyleOf,
  laneNameOf,
  offsetPxOf,
  shiftedSegment,
} from './compare-plan'
import type { CompareRow, InsightContext } from './compare-plan'
import type { RouteAlgorithmChoice } from '@/hooks/useRoute'

const LABELS: Record<RouteAlgorithmChoice, string> = {
  dijkstra: 'Dijkstra',
  'a-star': 'A*',
  bfs: 'BFS',
}

const context: InsightContext = { sameEndpoint: false, profile: 'shortest', labelOf: (a) => LABELS[a] }

/** The research lab → hostel result, in the shape the campus actually produces: A* ties, BFS takes more metres. */
function rows(overrides: Partial<Record<RouteAlgorithmChoice, Partial<CompareRow>>> = {}): CompareRow[] {
  const base = (algorithm: RouteAlgorithmChoice, over: Partial<CompareRow>): CompareRow => ({
    algorithm,
    found: true,
    cost: 1517.7,
    metres: 1517.7,
    minutes: 18.1,
    expanded: algorithm === 'dijkstra' ? 39 : algorithm === 'a-star' ? 14 : 21,
    ms: algorithm === 'dijkstra' ? 1 : 0,
    segments: 10,
    nodeIds: ['a', 'b', 'c'],
    ...over,
  })
  return COMPARE_ORDER.map((algorithm) => base(algorithm, overrides[algorithm] ?? {}))
}

describe('the columns', () => {
  it('asks the same five questions in the order the table prints them', () => {
    expect(COLUMNS.map((column) => column.key)).toEqual([
      'metres',
      'minutes',
      'expanded',
      'ms',
      'segments',
    ])
    // Every header explains itself, because "settled" is jargon until a reader has watched one search do it.
    for (const column of COLUMNS) {
      expect(column.hint.length).toBeGreaterThan(12)
      expect(column.label.length).toBeGreaterThan(2)
    }
  })

  it('declares the timing column non-deciding, and nothing else', () => {
    expect(COLUMNS.filter((column) => !column.decides).map((column) => column.key)).toEqual(['ms'])
  })
})

describe('bestIn', () => {
  it('marks every row tied at the minimum, all of them, never one', () => {
    // All three start on the same 1 517.7 m, so BFS has to be moved off it by hand: a tie that includes every
    // row would pass a test that only ever looked for two names.
    const tied = rows()
    expect([...bestIn(tied, COLUMNS[0] as (typeof COLUMNS)[number])].sort()).toEqual(['a-star', 'bfs', 'dijkstra'])
    const distance = bestIn(rows({ bfs: { metres: 1900 } }), COLUMNS[0] as (typeof COLUMNS)[number])
    expect([...distance].sort()).toEqual(['a-star', 'dijkstra'])
    expect(distance.has('bfs')).toBe(false)
  })

  it('marks a single row when it is alone at the bottom', () => {
    const settled = bestIn(rows(), COLUMNS[2] as (typeof COLUMNS)[number])
    expect([...settled]).toEqual(['a-star'])
  })

  it('never crowns anything in the timing column, not even a unique minimum', () => {
    const timing = COLUMNS[3] as (typeof COLUMNS)[number]
    expect(timing.key).toBe('ms')
    expect([...bestIn(rows(), timing)]).toEqual([])
    // A row that is unambiguously "fastest" is still not marked: `ms` is whole milliseconds on a 39-vertex
    // graph, so any winner it named would be a race-condition trophy.
    const clear = rows({ dijkstra: { ms: 400 }, 'a-star': { ms: 1 }, bfs: { ms: 900 } })
    expect([...bestIn(clear, timing)]).toEqual([])
  })

  it('refuses to pick a winner once fewer than two searches found a walk', () => {
    const one = rows({ 'a-star': { found: false, metres: 0, expanded: 0, segments: 0 }, bfs: { found: false, metres: 0, expanded: 0, segments: 0 } })
    for (const column of COLUMNS) {
      expect([...bestIn(one, column)], column.key).toEqual([])
    }
    // …including a distance column where the refusal's zeroes would otherwise "win" by being smallest.
    expect(bestIn(one, COLUMNS[0] as (typeof COLUMNS)[number]).size).toBe(0)
  })

  it('ignores a refusal even when two rows remain, and compares only what walked', () => {
    const partial = rows({ bfs: { found: false, metres: 0 } })
    const best = bestIn(partial, COLUMNS[0] as (typeof COLUMNS)[number])
    expect([...best].sort()).toEqual(['a-star', 'dijkstra'])
  })
})

describe('the coincident-route offsets', () => {
  it('gives every algorithm its own lane, with one search left on the corridor', () => {
    expect(COMPARE_ORDER.map(offsetPxOf)).toEqual([0, LANE_OFFSET_PX, -LANE_OFFSET_PX])
    // Not a taste number: it must clear the stroke width, and it is exported so the stylesheet can be measured
    // against it. Below 3 px the three lanes would touch and the overlay would be one line again.
    expect(LANE_OFFSET_PX).toBeGreaterThanOrEqual(4)
    // Zero on one row is the point: Dijkstra is the reference walkway, and the other two are measured against it.
    expect(new Set(COMPARE_ORDER.map(offsetPxOf)).size).toBe(3)
  })

  it('shifts a segment sideways without stretching it, over a hundred seeded shapes', () => {
    let seed = 0x5eed
    const next = (): number => {
      // mulberry32, ten lines of my own: a seeded stream, so a failure names the case that produced it.
      seed = (seed + 0x6d2b79f5) >>> 0
      let t = seed
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (let i = 0; i < 100; i++) {
      const a = { x: next() * 2000 - 1000, y: next() * 2000 - 1000 }
      const b = { x: next() * 2000 - 1000, y: next() * 2000 - 1000 }
      const offset = (next() - 0.5) * 40
      const [x1, y1, x2, y2] = shiftedSegment(a, b, offset)
      const before = Math.hypot(b.x - a.x, b.y - a.y)
      const after = Math.hypot(x2 - x1, y2 - y1)
      expect(after, `length at ${String(i)}`).toBeCloseTo(before, 9)
      // Perpendicular: the displacement is normal to the segment, which is what stops one lane sliding along
      // another and calling the overlap a separation.
      const dot = (x1 - a.x) * (b.x - a.x) + (y1 - a.y) * (b.y - a.y)
      expect(Math.abs(dot), `perpendicularity at ${String(i)}`).toBeLessThan(1e-6)
      // Both endpoints move by exactly the requested amount, so the lane is a constant width.
      expect(Math.hypot(x1 - a.x, y1 - a.y)).toBeCloseTo(Math.abs(offset), 9)
      expect(Math.hypot(x2 - b.x, y2 - b.y)).toBeCloseTo(Math.abs(offset), 9)
    }
  })

  it('leaves a zero-length segment alone instead of dividing by it', () => {
    const at = { x: 12, y: -8 }
    expect(shiftedSegment(at, at, 20)).toEqual([12, -8, 12, -8])
  })

  it('keeps three coincident routes visibly apart, by offsetting each one a different way', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 100, y: 0 }
    const lanes = COMPARE_ORDER.map((algorithm) => shiftedSegment(a, b, offsetPxOf(algorithm)))
    // Same y for a horizontal segment means the lanes are separated in y — and none of the three pairs shares it.
    expect(new Set(lanes.map((lane) => String(lane[1]))).size).toBe(3)
    // The normal of `a → b` is `(dy, -dx)`, so a positive offset moves a horizontal segment *up* in a
    // y-down world: Dijkstra stays on the corridor, A* is at -2.6, BFS at +2.6, and the three never coincide.
    expect(lanes.map((lane) => lane[1])).toEqual([0, -LANE_OFFSET_PX, LANE_OFFSET_PX])
  })
})

describe('the dash styles', () => {
  it('describes the lanes from the walker’s side, not the map’s', () => {
    expect(COMPARE_ORDER.map(laneNameOf)).toEqual([
      'drawn on the walkway',
      'drawn to a walker’s left',
      'drawn to a walker’s right',
    ])
  })

  it('names three patterns that no two share, so colour is never the only channel', () => {
    const styles = COMPARE_ORDER.map(dashStyleOf)
    expect(new Set(styles.map((style) => style.name)).size).toBe(3)
    expect(styles.map((style) => style.name)).toEqual(['solid line', 'long dashes', 'short dashes'])
  })

  it('scales a pattern into world units, and leaves a solid line unstyled', () => {
    expect(dashArrayString(dashStyleOf('dijkstra'), 4)).toBe(null)
    expect(dashArrayString(dashStyleOf('a-star'), 2)).toBe('18 10')
    expect(dashArrayString(dashStyleOf('bfs'), 1.5)).toBe('3.75 5.25')
    // Zooming out must not turn "long dashes" into a hairline: the ratio is what the eye reads, and it is fixed.
    const wide = String(dashArrayString(dashStyleOf('a-star'), 100)?.split(' ')[0])
    expect(Number(wide) / 100).toBeCloseTo(9, 9)
  })
})

describe('compareInsight', () => {
  const metres = (sentence: string): readonly string[] => sentence.match(/\d+(?:\.\d+)?/g) ?? []

  /** Everything a sentence may legitimately contain: each row's own figures, and their differences. */
  function allowed(list: readonly CompareRow[]): Set<string> {
    const out = new Set<string>(['0.0', '0'])
    const tenth = (value: number): string => (Math.round(value * 10) / 10).toFixed(1)
    const whole = (value: number): string => String(Math.round(value))
    for (const row of list) {
      out.add(tenth(row.metres))
      out.add(whole(row.metres))
      out.add(tenth(row.minutes))
      out.add(whole(row.minutes))
      out.add(whole(row.expanded))
      out.add(whole(row.segments))
      out.add(whole(row.cost))
      out.add(tenth(row.cost))
    }
    for (const left of list) {
      for (const right of list) {
        out.add(tenth(Math.abs(left.metres - right.metres)))
        out.add(whole(Math.abs(left.expanded - right.expanded)))
      }
    }
    return out
  }

  it('leads with the finding the campus actually shows: the same walk, less work', () => {
    const sentence = compareInsight(rows(), context)
    expect(sentence).toContain('Same answer, different work')
    expect(sentence).toContain('1517.7 m')
    expect(sentence).toContain('settles 14 where Dijkstra needs 39')
    expect(sentence).toContain('the estimate changes how the search runs, not what it finds')
  })

  it('says so plainly when there is nothing to learn', () => {
    const equal = rows({ 'a-star': { expanded: 39 }, bfs: { expanded: 39, segments: 10, nodeIds: ['a', 'b', 'c'] } })
    const sentence = compareInsight(equal, context)
    expect(sentence).toContain('indistinguishable')
    expect(sentence).toContain('39 vertices')
    // The claim has to be *earned*: this arm only opens when the paths, the segments and the work all match.
    expect(sentence).not.toContain('where Dijkstra needs')
  })

  it('does not credit A* with work it did not save', () => {
    // An admissible-but-inconsistent estimate can settle *more* vertices than Dijkstra, and a sentence written
    // for the happy case would then read "settles 41 where Dijkstra needs 14" — a boast in the wrong direction.
    // The other arm exists for that, and it is the reason the sentence reads the difference rather than assuming
    // its sign.
    const slower = rows({ 'a-star': { expanded: 41 }, bfs: { expanded: 41 } })
    const sentence = compareInsight(slower, context)
    expect(sentence).toContain('no better than Dijkstra’s 39 here')
    expect(sentence).not.toContain('where Dijkstra needs')
    expect(sentence).toContain('identical 1517.7 m route')
  })

  it('handles breadth-first tying the cost while being longer in metres', () => {
    const longer = rows({ bfs: { metres: 1840.4, segments: 6, nodeIds: ['a', 'd', 'c'] } })
    const sentence = compareInsight(longer, context)
    expect(sentence).toContain('costs exactly the same')
    expect(sentence).toContain('1840.4 m against 1517.7 m')
    expect(sentence).toContain('fewest segments is a different question from fewest metres')
  })

  it('still speaks when A* and Dijkstra match on length by different roads', () => {
    // BFS's *cost* has to move too, or this is the "costs the same, longer in metres" case below, and the
    // sentence that comes back is the right one for the wrong test.
    const detour = rows({
      'a-star': { nodeIds: ['a', 'x', 'c'] },
      bfs: { metres: 1600, cost: 1600, nodeIds: ['a', 'd', 'c'] },
    })
    const sentence = compareInsight(detour, context)
    expect(sentence).toContain('A* and Dijkstra agree on the walk')
    expect(sentence).toContain('1600.0 m')
  })

  it('refuses to compare what was never found', () => {
    const refused = rows({
      dijkstra: { found: false, metres: 0, minutes: 0, expanded: 5, segments: 0, nodeIds: [] },
      'a-star': { found: false, metres: 0, minutes: 0, expanded: 5, segments: 0, nodeIds: [] },
      bfs: { found: false, metres: 0, minutes: 0, expanded: 5, segments: 0, nodeIds: [] },
    })
    const sentence = compareInsight(refused, context)
    expect(sentence).toContain('None of the three found a walk')
    expect(sentence).toContain('“shortest”')
    expect(sentence).toContain('how much of the campus they did reach')
  })

  it('notices the same place twice, before quoting any number at all', () => {
    const zero = rows({
      dijkstra: { metres: 0, minutes: 0, cost: 0, segments: 0, nodeIds: ['a'] },
      'a-star': { metres: 0, minutes: 0, cost: 0, segments: 0, nodeIds: ['a'], expanded: 1 },
      bfs: { metres: 0, minutes: 0, cost: 0, segments: 0, nodeIds: ['a'], expanded: 1 },
    })
    const sentence = compareInsight(zero, { ...context, sameEndpoint: true })
    expect(sentence).toContain('the same place twice')
    expect(sentence).toContain('0.0 m')
  })

  it('calls a disagreement about existence a bug rather than a result', () => {
    const odd = rows({ bfs: { found: false, metres: 0 } })
    const sentence = compareInsight(odd, context)
    expect(sentence).toContain('cannot disagree about *whether* a route exists')
    expect(sentence).toContain('BFS did not')
  })

  it('says nothing when nothing was asked', () => {
    expect(compareInsight([], context)).toBe('Nothing asked yet, so there is nothing to compare.')
  })

  it('declines to compare when fewer than three searches are on the table', () => {
    // Reachable in code, if not yet in the UI: `useCompare` always runs three, and a fourth picker row or a
    // partially-built table would land here. The sentence refuses to rank what it cannot complete, rather than
    // inventing a two-way tie.
    const alone = (algorithm: RouteAlgorithmChoice): CompareRow => ({
      algorithm,
      found: true,
      cost: 10,
      metres: 10,
      minutes: 1,
      expanded: 4,
      ms: 0,
      segments: 2,
      nodeIds: ['a', 'b'],
    })
    expect(compareInsight([alone('bfs')], context)).toBe(
      'Fewer than three searches answered, so no comparison is being claimed.',
    )
    expect(compareInsight([alone('dijkstra'), alone('a-star')], context)).toBe(
      'Fewer than three searches answered, so no comparison is being claimed.',
    )
  })

  it('quotes only figures the rows contain, over two hundred seeded triples', () => {
    let seed = 0xc0ffee
    const next = (): number => {
      seed = (seed + 0x6d2b79f5) >>> 0
      let t = seed
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = (values: readonly string[]): string => String(values[Math.floor(next() * values.length)])
    for (let i = 0; i < 200; i++) {
      const list: CompareRow[] = COMPARE_ORDER.map((algorithm) => {
        const metres = Math.round(next() * 4000) / 10
        return {
          algorithm,
          found: next() > 0.15,
          cost: Math.round(next() * 4000) / 10,
          metres,
          minutes: Math.round(metres / 1.35 / 6) / 10,
          expanded: Math.floor(next() * 60),
          // Distinct and impossible to confuse with any other figure in the row: if a sentence ever repeats
          // one of these, the property check below fails on it.
          ms: 900 + i,
          segments: Math.floor(next() * 20),
          nodeIds: [pick(['a', 'b']), pick(['a', 'b', 'c']), pick(['c', 'd'])],
        }
      })
      const sentence = compareInsight(list, context)
      expect(allowed(list), `allowed set at ${String(i)}`).toContain('0.0')
      for (const figure of metres(sentence)) {
        expect(allowed(list), `${figure} in "${sentence}" (case ${String(i)})`).toContain(figure)
      }
      // `ms` is labelled indicative in the same breath as it is printed, so a sentence must never rank by it.
      expect(sentence).not.toContain(String(900 + i))
      expect(sentence.toLowerCase()).not.toContain('fastest')
    }
  })
})
