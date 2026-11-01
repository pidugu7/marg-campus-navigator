/**
 * The data file's rules exist in three places at once — the code that reports them, the document that
 * explains them, and the suite that proves them — and two of those three are prose, which is exactly how
 * documentation goes stale. So the drift is checked rather than promised: `MAP_ISSUE_CODES` is a value,
 * and every entry has to appear in `docs/SCHEMA.md`'s matrix and in `build-graph.spec.ts`.
 *
 * This is the same shape as the Phase 0 guard that keeps the ESLint denylist and the architecture test's
 * denylist identical.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MAP_ISSUE_CODES } from '@/data'

const repo = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const schema = repo('../../docs/SCHEMA.md')
const spec = repo('../../src/data/build-graph.spec.ts')

describe('the schema documentation stays in step with the rules', () => {
  it('lists every issue code in the docs matrix, and no code the builder does not have', () => {
    const table = schema.slice(schema.indexOf('| Code | Severity | Trigger |'))
    const documented = [...table.matchAll(/^\| `([a-z-]+)` \| (error|warning) \|/gm)].map((match) => `${match[2]}/${match[1]}`)
    expect(documented.sort()).toEqual(
      MAP_ISSUE_CODES.map((code) => `${SEVERITIES[code]}/${code}`).sort(),
    )
  })

  it('has one spec per issue code', () => {
    const missing = MAP_ISSUE_CODES.filter((code) => !spec.includes(`'${code}'`))
    expect(missing, `issue codes with no case in build-graph.spec.ts: ${missing.join(', ')}`).toEqual([])
  })
})

/**
 * The severity of each code, as the docs claim it. Written out here rather than read from the builder
 * because *this* test's job is to catch the two of them disagreeing: a code silently downgraded from
 * error to warning is a broken campus that passes CI.
 */
const SEVERITIES: Record<(typeof MAP_ISSUE_CODES)[number], 'error' | 'warning'> = {
  'schema-version': 'error',
  'missing-block': 'error',
  'duplicate-id': 'error',
  'bad-id': 'error',
  'bad-number': 'error',
  'bad-canvas': 'error',
  'bad-kind': 'error',
  'bad-surface': 'error',
  'bad-attr': 'error',
  'crowd-range': 'error',
  'unknown-ref': 'error',
  'unknown-zone': 'error',
  'self-loop': 'error',
  'no-entrance': 'error',
  'entrance-unreachable': 'error',
  'bad-ring': 'error',
  'empty-graph': 'error',
  'missing-zone': 'warning',
  'place-to-place': 'warning',
  'length-mismatch': 'warning',
  'non-simple-ring': 'warning',
  'isolated-node': 'warning',
  'outside-canvas': 'warning',
  'disconnected-component': 'warning',
}
