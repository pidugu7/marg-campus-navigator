/**
 * The `map:validate` CLI, tested as a command rather than as a module.
 *
 * What is under test here is not the rules — `src/data/build-graph.spec.ts` pins those case by case —
 * but the three things only the CLI owns: the **exit codes** CI branches on, the `--json` shape a
 * script consumes, and the fact that the file it reads is the same file the app bundles. A `package.json`
 * script that exits 0 on a broken campus is worse than no validator at all, and no amount of unit
 * testing catches that.
 *
 * These spawn `node`, so they are the slowest specs in the suite (~1 s each: the CLI boots a Vite SSR
 * server to reach the TypeScript rules). Two are enough to pin both directions of the exit code, plus
 * a third that fails before Vite starts and is nearly free.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const script = join(repo, 'scripts/validate-map.mjs')

interface Run {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

const run = (...args: string[]): Run => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** A campus with exactly one defect, so a non-zero exit cannot be blamed on anything else. */
function brokenCampus(): string {
  const dir = mkdtempSync(join(tmpdir(), 'marg-validate-'))
  const file = join(dir, 'broken.json')
  writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: '1',
      metadata: {
        app: 'MARG',
        campus: 'Test',
        campusShort: 'Test',
        location: { city: '-', state: '-', country: 'IN' },
        scaleSource: 'none',
        dataStatus: 'synthetic-placeholder',
        authoredBy: 'spec',
        updatedAt: '2026-11-01',
        notes: '',
      },
      canvas: { width: 400, height: 300, pixelsPerMetre: 1 },
      zones: [{ id: 'core', label: 'Core', color: '#4f46e5' }],
      nodes: [
        { id: 'a', label: 'A', kind: 'place', x: 10, y: 150, zone: 'core' },
        { id: 'j', label: 'j', kind: 'junction', x: 200, y: 150, zone: 'core' },
      ],
      edges: [{ id: 'e-a--j', from: 'a', to: 'j', attrs: { crowd: 2 } }],
      buildings: [],
      surfaces: [],
    }),
  )
  return file
}

let clean: Run | undefined
let broken: Run | undefined

describe('npm run map:validate', () => {
  beforeAll(() => {
    clean = run('src/data/campus.json')
    broken = run(brokenCampus(), '--json')
  }, 60_000)

  it('exits 0 on the shipped campus and prints the summary a human scans', () => {
    // The assertion is on the exit code, not on the prose; the summary line is here because a report
    // that silently stopped saying what it validated would otherwise pass unnoticed.
    expect(clean?.status, clean?.stderr ?? 'no run').toBe(0)
    expect(clean?.stderr).toBe('') // a run that complains on stderr is not a clean run
    expect(clean?.stdout).toMatch(/39 nodes, 56 edges/)
    expect(clean?.stdout).toContain('0 errors, 2 warnings')
  })

  it('exits 1 with a parseable --json report naming the one defect', () => {
    expect(broken?.status, broken?.stderr ?? 'no run').toBe(1)
    if (broken === undefined) throw new Error('the CLI never ran')
    // Parsed whole, not sliced from the first brace: `--json` promises stdout is machine-readable and
    // nothing else, so a stray log line from the SSR boot has to fail this rather than be forgiven.
    const parsed = JSON.parse(broken.stdout) as {
      ok: boolean
      errors: number
      issues: { code: string; severity: string; subject: string }[]
    }
    expect(parsed.ok).toBe(false)
    expect(parsed.errors).toBe(1)
    expect(parsed.issues).toEqual([{ code: 'crowd-range', severity: 'error', subject: 'e-a--j', message: expect.any(String) }])
  })

  it('exits 2, before booting Vite, when the file does not exist', () => {
    // Distinguished from 1 on purpose: "the checkout is wrong" must not look like "the data is wrong".
    const missing = run('src/data/not-a-campus.json')
    expect(missing.status).toBe(2)
    expect(missing.stdout).toContain('no such file')
  })

  it('survives being skimmed, because `| head` closes the pipe mid-report', () => {
    // The status code comes from `head` here, so it proves nothing; what matters is that node printed no
    // crash after the pipe closed. A validator that dumps a stack trace on a skimmed run gets skipped.
    const skimmed = spawnSync('sh', ['-c', `node ${JSON.stringify(script)} src/data/campus.json | head -1`], {
      cwd: repo,
      encoding: 'utf8',
    })
    expect(skimmed.stdout).toContain('39 nodes, 56 edges')
    expect(skimmed.stderr).toBe('')
  })

  it('treats warnings as failures under --strict', () => {
    const strict = run('src/data/campus.json', '--strict')
    expect(strict.status).toBe(1)
    expect(strict.stdout).toContain('warnings are failures')
  })

  it('documents itself rather than guessing at arguments', () => {
    const help = run('--help')
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('--strict')
    expect(help.stdout).toContain('src/data/campus.json')
  })
})
