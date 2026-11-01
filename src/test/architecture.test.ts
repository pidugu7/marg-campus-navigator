import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ALGORITHM_DENYLIST,
  ENGINE_BANNED_IMPORT_PREFIXES,
  ENGINE_CONSUMERS_ALLOWED,
  ENGINE_TESTED_DIRS,
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
  /** Comments and string literals removed, so scans hit code and not prose. */
  code: string
  isTest: boolean
}

const toRel = (abs: string): string =>
  abs.slice(ROOT.length).split(sep).join('/')

const walk = (dir: string, exts: readonly string[]): string[] => {
  const found = readdirSync(dir, { recursive: true, encoding: 'utf-8' }) as string[]
  return found.filter((name) => exts.some((ext) => name.endsWith(ext))).map((name) => join(dir, name))
}

const stripNoise = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""')

const SPECIFIER_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bexport\s*\*\s*from\s*['"]([^'"]+)['"]/g,
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
        code: stripNoise(raw),
        isTest: /\.test\.tsx?$/.test(rel),
      }
    })
    .sort((a, b) => (a.rel < b.rel ? -1 : 1))

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
      for (const spec of importsOf(file.raw)) {
        if (isRelative(spec)) continue
        if (file.isTest && spec === 'vitest') continue
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
      for (const spec of importsOf(file.raw)) {
        if (/(^|\/)engine(\/|$)/.test(spec)) violations.push(`${file.rel} -> ${spec}`)
      }
    }
    expect(violations, `components must go through a hook, not the engine:\n${violations.join('\n')}`).toEqual([])
  })

  it('lets hooks use the engine only through its barrel', () => {
    const violations: string[] = []
    for (const file of files.filter((f) => f.rel.startsWith('src/hooks/'))) {
      for (const spec of importsOf(file.raw)) {
        if (/(^|\/)engine(\/|$)/.test(spec) && spec !== '@/engine') violations.push(`${file.rel} -> ${spec}`)
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
        const collocated = `${dir}/${base}.test.ts`
        const inTests = `src/engine/__tests__/${base}.test.ts`
        if (!present.has(collocated) && !present.has(inTests)) missing.push(`${file.rel} (expected ${inTests})`)
      }
    }
    expect(missing, `untested engine modules:\n${missing.join('\n')}`).toEqual([])
  })
})
