/**
 * Every class the route UI emits has a rule behind it.
 *
 * A component and a stylesheet agree by convention alone: rename a class on one side and the build still
 * succeeds, the tests still pass, and the card loses its colours — the kind of bug a screenshot catches in a
 * week. So this reads the two stylesheets and the route components' own source, and compares the class names.
 *
 * The scan is over *source* rather than over rendered markup, and that is not laziness: `src/test` is compiled by
 * `tsconfig.test.json`, which sets no `jsx`, so importing a `.tsx` module from here would not typecheck (the
 * render-based version of this check lives beside the component, in `src/ui/route/route-card.spec.ts`, where the
 * app config does compile JSX). A literal scan also reads better as a guard: what it fails on is "a component
 * mentions a class the stylesheets never mention", which is exactly the rename this test exists to catch.
 *
 * Only the route UI and the replay overlay are in scope, deliberately: `src/ui/map` has three phases of class
 * names of its own, and the same guard for them belongs to whichever checkpoint next touches the layers — which
 * was Phase 4 cp3, so `layers/replay-layer.tsx` joined the walk and the older layers are still its debt.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TURN_DIRECTIONS } from '@/ui/route/route-summary'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const sheets = {
  app: read('../styles/app.css'),
  map: read('../styles/map.css'),
}

const sources = {
  card: read('../ui/route/route-card.tsx'),
  controls: read('../ui/route/route-controls.tsx'),
  layer: read('../ui/map/layers/route-layer.tsx'),
  replayPanel: read('../ui/route/replay-panel.tsx'),
  replayLayer: read('../ui/map/layers/replay-layer.tsx'),
}

/** Class names a stylesheet can reach — any selector mentioning `.name`, including in a descendant pair. */
function selectors(css: string): Set<string> {
  return new Set([...css.matchAll(/\.([a-zA-Z][-\w]*)/g)].map((match) => (match[1] as string)))
}

/**
 * The literal class tokens a component writes. `className={`a ${b}`}` contributes `a`; the template hole `b` is
 * skipped rather than guessed at, which is why the one interpolated family this UI has — the per-turn classes —
 * is checked by name below, from the table that drives it.
 */
function emitted(source: string): string[] {
  return [...source.matchAll(/(?:className|class)=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
    .flatMap((match) => (match[1] ?? match[2] ?? '').split(/\s+/))
    .filter((token) => token !== '' && !token.includes('${'))
}

const defined = selectors(`${sheets.app}\n${sheets.map}`)
const allEmitted = new Set(Object.values(sources).flatMap(emitted))

describe('the route UI and the stylesheets', () => {
  it('finds something to check, so a broken scan cannot pass by looking empty', () => {
    // The guard's own tripwire: if the regexes above ever stop matching — a rename to `class={cn(...)}`, a moved
    // directory — the test below would compare an empty set and succeed.
    expect(allEmitted.size).toBeGreaterThan(14)
    expect(defined.size).toBeGreaterThan(60)
  })

  it('gives every emitted class a rule, in one file or the other', () => {
    // The icon library puts its own class on its `<svg>`; that name is the library's to define.
    const ours = [...allEmitted].filter((name) => !name.startsWith('lucide'))
    expect(ours.filter((name) => !defined.has(name))).toEqual([])
  })

  it('styles all nine turn buckets, not just the three that appear on a nice day', () => {
    // `TURN_DIRECTIONS` is the engine's union as the card sees it, and the row class is built from it, so a
    // tenth bucket has to arrive in the table, the arrow rotation and a stylesheet rule before the card builds.
    expect(TURN_DIRECTIONS).toHaveLength(9)
    for (const direction of TURN_DIRECTIONS) {
      expect(defined.has(`route-step--${direction}`), `route-step--${direction}`).toBe(true)
    }
    // …and the card really does interpolate the bucket into the class name, which is the only reason the nine
    // rules above are reachable at all.
    expect(emitted(sources.card)).toContain('route-step')
    expect(sources.card).toContain('route-step--${step.direction}')
  })

  it('keeps the responsive rules attached to the selectors they restyle', () => {
    // A media query that names a class the components stopped emitting is dead weight, and — worse — a rule
    // that was dropped during a refactor leaves the narrow layout silently unstyled. Neither shows up in a
    // markup test, because markup tests do not have a viewport. So the pairing is checked here: the block
    // exists, and its body still contains the selector.
    // Every block with that query, not the first: `app.css` is organised by feature, so the map section and the
    // route section each carry their own 900px block, and that is the shape a stylesheet should keep.
    const blocks = (css: string, query: string): string[] => {
      const found: string[] = []
      const needle = `@media ${query} {`
      for (let at = css.indexOf(needle); at >= 0; at = css.indexOf(needle, at + 1)) {
        let depth = 0
        for (let i = css.indexOf('{', at); i < css.length; i++) {
          if (css[i] === '{') depth += 1
          if (css[i] === '}') {
            depth -= 1
            if (depth === 0) {
              found.push(css.slice(at, i + 1))
              break
            }
          }
        }
      }
      return found
    }
    const stacked = blocks(sheets.app, '(max-width: 900px)')
    expect(stacked.length).toBeGreaterThan(1)
    expect(stacked.join('\n')).toContain('.route-pickers')
    expect(stacked.join('\n')).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(stacked.join('\n')).toContain('.work')
    const narrow = blocks(sheets.app, '(max-width: 380px)').join('\n')
    expect(narrow).toContain('.route-step')
    expect(narrow).toContain('.route-step-metres')
    // And the numbers themselves, because 900 is the column-break the map already used in Phase 2 and 380 is
    // one step under the smallest viewport the brief names — the pair has to stay in that order or a 375px
    // phone gets the four-column row it cannot fit.
    expect(sheets.app.indexOf('@media (max-width: 380px)')).toBeGreaterThan(sheets.app.indexOf('@media (max-width: 900px)'))
  })

  it('answers prefers-reduced-motion in CSS, not in a branch', () => {
    // The panel does have a `reduced` flag, but it only refuses to *autoplay*. The pulse itself is silenced by a
    // media query, so a reader who set the preference gets the reduced result even when the flag could not be
    // read — a `matchMedia` call that throws in some harness must not leave an animation running.
    // Every block, not the first: `map.css` is organised by feature, so the walkway dashes and the replay each
    // carry their own reduced-motion rule, and a scan of one of them would be a scan of the wrong one.
    const bodies = [...sheets.map.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([^}]*)\}/g)].map(
      (match) => String(match[1]),
    )
    expect(bodies.length, 'map.css answers reduced motion somewhere').toBeGreaterThan(1)
    const frontier = bodies.find((body) => body.includes('.replay-frontier'))
    if (frontier === undefined) return expect.fail('no reduced-motion rule for .replay-frontier')
    expect(frontier).toContain('animation: none')
    // And the frame never becomes a class: 41 visited vertices are 41 `<circle>`s with an inline fill, not 41
    // rules somebody has to keep in step with a ramp.
    expect(sources.replayLayer).toContain('visitColor(')
    expect(sources.replayLayer).not.toMatch(/replay-node--\d/)
  })

  it('keeps the plate in `map.css` and the page in `app.css`', () => {
    // Both files are imported by `App`, so a class in the "wrong" one still paints: this asserts the project's
    // own organisation, which is the kind of thing a large phase quietly loses.
    const inMap = selectors(sheets.map)
    const inApp = selectors(sheets.app)
    const plateClasses = ['layer-route', 'route-halo', 'route-line', 'route-pin--start', 'route-pin--end', 'route-pin-shape', 'route-pin-eye']
    // The replay's overlay classes go in `map.css` because they are plate geometry: they scale with the world
    // and they are drawn by a layer, not by a card.
    plateClasses.push('layer-replay', 'replay-node', 'replay-node--current', 'replay-frontier', 'replay-path')
    for (const name of plateClasses) {
      expect(inMap.has(name), name).toBe(true)
    }
    const pageClasses = ['route-card', 'route-form', 'route-pickers', 'route-swap', 'picker', 'route-step', 'route-state', 'route-metrics', 'route-note']
    // …and the panel's controls go in `app.css`, because a button is page furniture at any zoom level.
    pageClasses.push(
      'replay-panel',
      'replay-buttons',
      'replay-button',
      'replay-button--play',
      'replay-scrub',
      'replay-speed',
      'replay-speed-label',
      'replay-caption',
      'replay-hint',
    )
    for (const name of pageClasses) {
      expect(inApp.has(name), name).toBe(true)
    }
  })
})
