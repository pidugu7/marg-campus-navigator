import { readFileSync, readdirSync } from 'node:fs'
import { join, posix, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ALGORITHM_DENYLIST,
  ENGINE_BANNED_IMPORT_PREFIXES,
  ENGINE_CONSUMERS_ALLOWED,
  ENGINE_TESTED_DIRS,
  PUBLIC_BARRELS,
  NETWORK_APIS,
  PLATFORM_GLOBALS_IN_ENGINE,
  RUNTIME_DEP_ALLOW_PATTERNS,
  RUNTIME_DEP_ALLOWLIST,
} from './arch-rules'

/**
 * Executable architecture rules.
 *
 * The coursework claim is "the engine knows nothing about React" and "every data
 * structure is hand-written". Those are the kind of claims that rot silently, so
 * they are checked here by scanning source text rather than asserted in a README.
 *
 * Scope note: `src/test/**` is exempt from the identifier scans (rules 2, 6).
 * The scanner has to spell out the words it forbids, so policing it would be
 * self-referential; the import and dependency rules apply to it normally.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

interface SourceFile {
  /** POSIX-style path relative to the repo root, e.g. `src/engine/index.ts`. */
  rel: string
  raw: string
  /** Comments removed, string literals kept — the text specifiers are read from. */
  prose: string
  /** Comments and string literals removed, so identifier scans hit code and not prose. */
  code: string
  isTest: boolean
}

const toRel = (abs: string): string =>
  abs.slice(ROOT.length).split(sep).join('/')

const walk = (dir: string, exts: readonly string[]): string[] => {
  const found = readdirSync(dir, { recursive: true, encoding: 'utf-8' }) as string[]
  return found.filter((name) => exts.some((ext) => name.endsWith(ext))).map((name) => join(dir, name))
}

const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ')

/** Comments *and* string literals removed: identifier scans must not see prose or literals. */
const stripNoise = (text: string): string =>
  stripComments(text)
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""')

/**
 * Which modules a file references, read from `prose` (comments gone, string literals kept).
 *
 * Three rounds of false alarms shaped this. A doc comment saying `indistinguishable from
 * "not added yet"` matched a bare `from "…"` scan, then a template literal in a test message did,
 * then a union-find header line wrapping across `"no route exists" from "no route was found"`.
 * Each one cost the same thing: the moment a guard cries wolf, the next engineer adds an
 * exception instead of fixing a bug. So every pattern is anchored to the start of an
 * `import`/`export` *statement*, and `[^'"]*?` forbids crossing a quote before `from` — a string
 * literal can no longer look like a specifier, while a multi-line `import type { … } from '…'`
 * still matches.
 *
 * Stated rather than hidden: `import("…")` and `require("…")` are matched by keyword, not by line
 * anchor, so a comment that spells one out verbatim still registers. That is the safe direction —
 * a false alarm costs a minute, a miss costs the separation claim the whole project rests on.
 */
const SPECIFIER_PATTERNS = [
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const importsOf = (raw: string): string[] => {
  const specifiers = new Set<string>()
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of raw.matchAll(pattern)) {
      const value = match[1]
      if (value !== undefined) specifiers.add(value)
    }
  }
  return [...specifiers]
}

const isRelative = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../')

const load = (): SourceFile[] =>
  walk(join(ROOT, 'src'), ['.ts', '.tsx'])
    .map((abs) => {
      const rel = toRel(abs)
      const raw = readFileSync(abs, 'utf8')
      return {
        rel,
        raw,
        prose: stripComments(raw),
        code: stripNoise(raw),
        isTest: /\.(test|spec)\.tsx?$/.test(rel),
      }
    })
    .sort((a, b) => (a.rel < b.rel ? -1 : 1))

/**
 * Whether a path is the engine's *test code*, for the one rule that needs the wider definition: the test
 * framework may be imported by a spec beside an engine module and by `src/engine/__tests__/helpers.ts`, because
 * both are harness and neither ships. Name-only detection once forced `helpers.ts` to be framework-free by
 * accident rather than by decision — so the directory is part of the rule here, and only here: the platform-
 * global and network scans below keep iterating `!isTest`, which means a support module that reaches for
 * `fetch` is still a violation. Widening an exemption is cheap; widening it quietly is not.
 */
const isEngineTestCode = (rel: string): boolean =>
  rel.startsWith('src/engine/__tests__/') || /\.(test|spec)\.tsx?$/.test(rel)

const files = load()
const engineFiles = files.filter((f) => f.rel.startsWith('src/engine/'))
const scannableFiles = files.filter((f) => !f.rel.startsWith('src/test/') && !f.isTest)
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const eslintConfig = readFileSync(join(ROOT, 'eslint.config.js'), 'utf8')

describe('engine independence', () => {
  it('is implemented in TypeScript with no JSX (there is no React in here)', () => {
    expect(engineFiles.length).toBeGreaterThan(0)
    const tsx = engineFiles.filter((f) => f.rel.endsWith('.tsx')).map((f) => f.rel)
    expect(tsx, `JSX files inside the engine:\n${tsx.join('\n')}`).toEqual([])
  })

  it('imports nothing but its own modules (vitest allowed in its specs)', () => {
    const violations: string[] = []
    for (const file of engineFiles) {
      for (const spec of importsOf(file.prose)) {
        if (isRelative(spec)) continue
        if (isEngineTestCode(file.rel) && spec === 'vitest') continue
        if (ENGINE_BANNED_IMPORT_PREFIXES.some((banned) => spec === banned || spec.startsWith(`${banned}/`))) {
          violations.push(`${file.rel} -> ${spec} (banned)`)
        } else {
          violations.push(`${file.rel} -> ${spec} (engine may only use relative imports)`)
        }
      }
    }
    expect(violations, `engine imported outside itself:\n${violations.join('\n')}`).toEqual([])
  })

  it('references no platform globals, DOM types or React identifiers', () => {
    const banned = [...PLATFORM_GLOBALS_IN_ENGINE, 'React', 'useEffect', 'useState']
    const violations: string[] = []
    for (const file of engineFiles) {
      for (const name of banned) {
        if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(file.code)) {
          violations.push(`${file.rel} references ${name}`)
        }
      }
    }
    expect(violations, `platform coupling in the engine:\n${violations.join('\n')}`).toEqual([])
  })

  it('keeps types.ts erasable: types only, no runtime values to bundle', () => {
    const types = engineFiles.find((f) => f.rel === 'src/engine/types.ts')
    expect(types, 'src/engine/types.ts must exist — it is the shared contract').toBeDefined()
    const runtime = /\b(class|enum|namespace|function|const)\b/.exec(types?.code ?? '')
    expect(
      runtime,
      `types.ts should hold no runtime code (found "${runtime?.[0] ?? ''}"); put values in constants.ts`,
    ).toBeNull()
  })
})

describe('layer boundaries', () => {
  it('is reached from the app only through src/hooks and src/data', () => {
    const violations: string[] = []
    for (const file of files) {
      if (ENGINE_CONSUMERS_ALLOWED.some((allowed) => file.rel.startsWith(allowed))) continue
      for (const spec of importsOf(file.prose)) {
        if (/(^|\/)engine(\/|$)/.test(spec)) violations.push(`${file.rel} -> ${spec}`)
      }
    }
    expect(violations, `components must go through a hook, not the engine:\n${violations.join('\n')}`).toEqual([])
  })

  it('reaches a public surface only through its barrel', () => {
    // A deep import is not merely untidy: `@/data/build-graph` and `@/engine/graph` skip the surface whose
    // shape the next phase is allowed to change, and they are invisible to a reader who only sees the barrel.
    // So every consumer resolves its specifier and gets checked, alias form and relative form alike.
    const violations: string[] = []
    for (const file of files) {
      for (const spec of importsOf(file.prose)) {
        const resolved = spec.startsWith('@/')
          ? `src/${spec.slice(2)}`
          : posix.normalize(posix.join(posix.dirname(file.rel), spec))
        for (const { home } of PUBLIC_BARRELS) {
          if (file.rel.startsWith(home)) continue
          if (resolved.startsWith(home) && resolved !== `${home}index.ts`) {
            violations.push(`${file.rel} -> ${spec}`)
          }
        }
      }
    }
    expect(violations, `deep imports bypass the public surface:\n${violations.join('\n')}`).toEqual([])
  })

  it('never reaches out to a network: the campus data is a bundled import', () => {
    const violations: string[] = []
    for (const file of scannableFiles) {
      for (const api of NETWORK_APIS) {
        if (file.code.includes(api)) violations.push(`${file.rel} uses ${api}`)
      }
    }
    expect(violations, `there is no backend, so nothing may talk to one:\n${violations.join('\n')}`).toEqual([])

    const dataBarrel = files.find((f) => f.rel === 'src/data/index.ts')
    expect(dataBarrel?.raw ?? '').toMatch(/from\s*['"]\.\/campus\.json['"]/)
  })
})

describe('dependency policy', () => {
  const runtimeDeps = Object.keys(packageJson.dependencies ?? {})
  const allDeps = [...runtimeDeps, ...Object.keys(packageJson.devDependencies ?? {})]

  it('ships only UI runtime dependencies', () => {
    const extra = runtimeDeps.filter(
      (name) =>
        !RUNTIME_DEP_ALLOWLIST.includes(name) && !RUNTIME_DEP_ALLOW_PATTERNS.some((pattern) => pattern.test(name)),
    )
    expect(extra, `runtime dependencies outside the allowlist:\n${extra.join('\n')}`).toEqual([])
    expect(runtimeDeps).toContain('react')
  })

  it('declares no off-the-shelf graph, heap, trie, path, union-find or LRU library', () => {
    const banned = allDeps.filter((name) =>
      ALGORITHM_DENYLIST.some((entry) => name.toLowerCase().includes(entry.toLowerCase())),
    )
    expect(banned, `these would implement the coursework for us:\n${banned.join('\n')}`).toEqual([])
  })

  it('keeps the ESLint ban list from drifting away from this one', () => {
    const mirrored = [
      'graphology',
      'ngraph',
      'fastpriorityqueue',
      'js-priority-queue',
      'heap-js',
      'trie-search',
      'dijkstra',
      'pathfinding',
      'union-find',
      'lru-cache',
      'mnemonist',
      'lodash',
    ]
    const missing = mirrored.filter((name) => !eslintConfig.includes(`'${name}'`))
    expect(missing, `banned in tests but not in eslint.config.js:\n${missing.join('\n')}`).toEqual([])
  })
})

describe('test coverage contract (live from Phase 1)', () => {
  it('gives every engine module a spec named after it', () => {
    const present = new Set(files.map((f) => f.rel))
    const missing: string[] = []
    for (const dir of ENGINE_TESTED_DIRS) {
      for (const file of files.filter((f) => f.rel.startsWith(`${dir}/`) && !f.isTest)) {
        const base = file.rel.slice(dir.length + 1).replace(/\.tsx?$/, '')
        const candidates = [
          `${dir}/${base}.spec.ts`,
          `${dir}/${base}.test.ts`,
          `src/engine/__tests__/${base}.spec.ts`,
          `src/engine/__tests__/${base}.test.ts`,
        ]
        if (!candidates.some((candidate) => present.has(candidate))) {
          missing.push(`${file.rel} (expected one of: ${candidates.join(', ')})`)
        }
      }
    }
    expect(missing, `untested engine modules:\n${missing.join('\n')}`).toEqual([])
  })
})

describe('the guard itself', () => {
  it('widens the framework exemption to the engine\'s test directory, and no further', () => {
    const helpers = files.find((f) => f.rel === 'src/engine/__tests__/helpers.ts')
    if (helpers === undefined) return expect.fail('src/engine/__tests__/helpers.ts went missing from the scan')
    expect(isEngineTestCode(helpers.rel), 'the test-support module may import vitest').toBe(true)
    expect(helpers.isTest, '…but it is not a spec, so it is still scanned as shipped code').toBe(false)
    // A shipped module must not inherit the exemption by being near a test.
    expect(isEngineTestCode('src/engine/algorithms/dijkstra.ts'), 'implementation code').toBe(false)
  })

  it('keeps every file under src/engine/__tests__ in scope for the no-network and no-globals scans', () => {
    // Tripwires, not restatements: the two rules above read `engineFiles` (everything under `src/engine`,
    // spec or not) and `scannableFiles` (everything outside `src/test` whose name says it is *not* a test),
    // so a change to either predicate — most likely someone teaching `isTest` about the `__tests__`
    // directory, which is the tempting generalisation — would drop the engine's support modules out of the
    // scan silently. This fails instead. Widening an exemption to the test framework is one thing; widening
    // it to `fetch` would end the "no backend" claim, and `PLATFORM_GLOBALS_IN_ENGINE` is what the
    // `engineFiles` set is there to enforce on files like this one.
    const support = files.filter((f) => f.rel.startsWith('src/engine/__tests__/'))
    expect(support.length, 'the engine has a test-support directory to scan').toBeGreaterThan(0)
    for (const file of support) {
      expect(engineFiles.some((f) => f.rel === file.rel), `${file.rel} in the platform-global scan`).toBe(true)
      expect(scannableFiles.some((f) => f.rel === file.rel), `${file.rel} in the no-network scan`).toBe(!file.isTest)
    }
  })

  it('reads specifiers from import/export statements, not from prose', () => {
    // Three separate false alarms produced this test: a doc comment saying `indistinguishable from
    // "not added yet"`, a template literal in a test message mentioning the engine alias, and a
    // sentence that wrapped across two lines between two quoted phrases. Each one reported an
    // import that did not exist, and a guard that cries wolf gets an exception added to it.
    const prose = [
      'const message = `exported from "@third-party" is the rule`',
      "expect(value, 'see from \"phantom-pkg\"').toBe(true)",
      'export const ok = 1',
    ].join('\n')
    expect(importsOf(prose)).toEqual([])

    const code = [
      "import { x } from 'real-package'",
      'import type { Y } from',
      "  '../deep/path'",
      "import 'side-effect'",
      "export { z } from 're-exported'",
    ].join('\n')
    // Both sides sorted by code point, because `-` sorts before `a` and an expectation written in
    // reading order is not an expectation written in sort order.
    const found = importsOf(code).sort()
    const wanted = ['../deep/path', 'real-package', 're-exported', 'side-effect'].sort()
    expect(found).toEqual(wanted)
  })
})
