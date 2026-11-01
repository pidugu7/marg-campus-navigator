#!/usr/bin/env node
/**
 * `npm run map:validate` — the campus file's report card, from a terminal.
 *
 * Why this goes through Vite instead of importing the rules directly: the rules live in TypeScript
 * and reach the engine through the `@/` alias, and plain `node` resolves neither. Starting a
 * middleware-mode server and `ssrLoadModule`-ing the module costs a few hundred milliseconds and buys
 * the property that matters more — **the CLI and the app execute literally the same function.** The
 * alternative, a second implementation in `.mjs`, is exactly how a validator starts disagreeing with
 * the thing it validates, and a file that passes in `vitest` but fails in CI is worse than no check.
 *
 * Usage:
 *   node scripts/validate-map.mjs [path/to/campus.json] [--strict] [--json] [--quiet]
 *
 * Exit codes, so CI can use this without parsing prose:
 *   0  no errors (warnings allowed unless --strict)
 *   1  errors, or warnings under --strict
 *   2  the file could not be read or parsed at all
 */
import { readFile } from 'node:fs/promises'
import process from 'node:process'

// `map:validate | head -5` closes the pipe while this script is still writing. Node reports that
// asynchronously as an 'error' event on stdout, which would bury a passing report under a stack trace —
// and a validator that crashes when you skim it is a validator people stop running. Anything that is not
// a closed pipe is still worth a trace, so it is rethrown.
process.stdout.on('error', (cause) => {
  if (cause.code !== 'EPIPE') throw cause
})

const USAGE = `usage: node scripts/validate-map.mjs [file] [--strict] [--json] [--quiet]

  file      defaults to src/data/campus.json
  --strict  treat warnings as failures too
  --json    emit the issue list as JSON instead of prose
  --quiet   print only the summary line and the tally
`

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(USAGE)
  process.exitCode = 0
} else {
  const flags = new Set(args.filter((arg) => arg.startsWith('-')))
  const target = args.find((arg) => !arg.startsWith('-')) ?? 'src/data/campus.json'
  await run(target, flags)
}

/**
 * @param {string} target
 * @param {Set<string>} flags
 * @returns {Promise<void>}
 */
async function run(target, flags) {
  /** @type {any} */
  let file
  try {
    file = JSON.parse(await readFile(target, 'utf8'))
  } catch (cause) {
    const reason = /** @type {Error} */ (cause).code === 'ENOENT' ? 'no such file' : `not valid JSON (${/** @type {Error} */ (cause).message})`
    process.stdout.write(`error: cannot read ${target}: ${reason}\n`)
    // 2 rather than 1: nothing in the schema was violated, the file just never arrived. CI should
    // distinguish "the data is wrong" from "the checkout is wrong".
    process.exitCode = 2
    return
  }

  const { createServer } = await import('vite')
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
    // The validator is a headless run; nothing here should watch, transform eagerly or listen.
    watchFile: { ignored: ['**/*'] },
  })
  try {
    /** @type {typeof import('../src/data/build-graph.ts')} */
    const mod = await server.ssrLoadModule('/src/data/build-graph.ts')
    const report = mod.validateCampusFile(file)
    const model = mod.buildGraph(file)
    const failOnWarnings = flags.has('--strict')
    const failed = report.errors > 0 || (failOnWarnings && report.warnings > 0)

    if (flags.has('--json')) {
      process.stdout.write(`${JSON.stringify({ source: target, ok: !failed, ...report, summary: model.summary }, null, 2)}\n`)
    } else {
      const summary = model.summary
      const header = flags.has('--quiet')
        ? ''
        : `${target}: ${summary.nodeCount} nodes, ${summary.edgeCount} edges, ${summary.placeCount} places, ` +
            `${summary.buildingCount} buildings, ${summary.surfaceCount} surfaces, ${summary.zoneCount} zones\n` +
            `  ${summary.componentCount} component(s), ${summary.totalMetres} m of walkway, longest segment ${summary.longestEdgeMetres} m\n\n`
      const strictNote = failed && report.errors === 0 ? '\n--strict: warnings are failures here.\n' : ''
      process.stdout.write(header + `${mod.formatCampusReport(report, { source: target })}\n` + strictNote)
    }
    process.exitCode = failed ? 1 : 0
  } finally {
    await server.close()
  }
}
