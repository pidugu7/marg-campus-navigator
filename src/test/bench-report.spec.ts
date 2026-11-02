/**
 * The generated half of `docs/ALGORITHMS.md`, checked as a contract rather than read as prose.
 *
 * "The table is written by script, not by hand" is only true if something fails when it is not. Three things can
 * go wrong, and this file has one test each: the markers get deleted (the script then refuses to run, and someone
 * types numbers into the hole); the table is edited by hand afterwards (the row count and the environment line are
 * the shape a hand-edit breaks first); or the script drifts away from what the brief asked for — a size missing,
 * the run count quietly lowered, the deterministic column dropped in favour of the flattering one.
 *
 * What is *not* asserted: any timing. That is the entire point of the table's own caption, and a test that pinned
 * `0.076 ms` would be a test that fails on a laptop.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const doc = readFileSync('docs/ALGORITHMS.md', 'utf8')
const BEGIN = '<!-- bench:begin -->'
const END = '<!-- bench:end -->'
const script = readFileSync('scripts/bench.mjs', 'utf8')

function section(): string {
  const start = doc.indexOf(BEGIN)
  const end = doc.indexOf(END)
  if (start === -1 || end === -1 || end < start) return ''
  return doc.slice(start + BEGIN.length, end).trim()
}

describe('the benchmark report', () => {
  it('sits between two markers the script can find', () => {
    expect(doc.split(BEGIN)).toHaveLength(2)
    expect(doc.split(END)).toHaveLength(2)
    expect(doc.indexOf(BEGIN)).toBeLessThan(doc.indexOf(END))
    expect(section(), 'the generated section is not empty').not.toBe('')
  })

  it('carries one row per search per size, and the environment the numbers were taken on', () => {
    const rows = section().split('\n').filter((line) => line.startsWith('| 1'))
    expect(rows).toHaveLength(9)
    for (const size of ['| 100 |', '| 1000 |', '| 10000 |']) {
      expect(rows.filter((row) => row.includes(size))).toHaveLength(3)
    }
    // The four environment facts the brief named, in the line above the table. A benchmark without them is a
    // rumour, and a rumour is what this file exists to prevent.
    const environment = section().split('\n')[0] ?? ''
    for (const fact of ['Node', 'linux', 'GB']) expect(environment, fact).toContain(fact)
    expect(section()).toMatch(/median of 15 runs/)
    // The commit and the run count travel with the numbers, which is the difference between a table and a claim.
    expect(section()).toMatch(/`npm run bench` on `[0-9a-f]{7}`/)
  })

  it('prints the deterministic column first and says the timings are indicative', () => {
    const header = section().split('\n').find((line) => line.startsWith('| vertices')) ?? ''
    expect(header).toContain('**settled per query**')
    expect(header.indexOf('settled')).toBeLessThan(header.indexOf('median ms'))
    expect(section()).toContain('Read the middle column, not the one next to it')
    expect(section()).toContain('they will not reproduce on yours')
  })

  it('is generated from the sizes, the seed and the run count the brief asked for', () => {
    expect(script).toContain('const SIZES = [100, 1_000, 10_000]')
    expect(script).toContain('const RUNS = 15')
    expect(script).toContain("const SEED_TAG = 'marg-campus-navigator/phase4/bench'")
    expect(script).toContain('trace: false')
    // Warm-up before measurement, median rather than mean, and the seed printed above the table: the three things
    // that turn "I timed it once" into a number someone else can check.
    expect(script).toContain('if (run < WARMUP) continue')
    expect(script).toContain('median(times)')
    // The script refuses to write at all if the markers have gone missing, which is the other half of the claim.
    expect(script).toContain('pair around the table')
    expect(script).toContain('const BEGIN = \'<!-- bench:begin -->\'')
  })

  it('checks correctness before it believes a timing', () => {
    // The three assertions that make the table mean what it says: same cost as Dijkstra for A*, no extra hops for
    // BFS, and a settled count that does not move between runs.
    expect(script).toContain('disagrees with Dijkstra on query')
    expect(script).toContain('more hops, so BFS is not minimising hops')
    expect(script).toContain('settled vertices moved between runs')
  })
})
