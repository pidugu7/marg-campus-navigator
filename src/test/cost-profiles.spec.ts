/**
 * The preference selector, wired: five checks that read files rather than render them.
 *
 * `tsc` already proves the *types* line up — `profileChoices` takes `Record<ProfileName, ProfileWords>` and is
 * handed `PROFILES`, so a sixth profile in `routing/cost.ts` stops compiling in `App.tsx`. What the compiler
 * cannot see is the shape of the *screen*: that the select is labelled, that its rows come from the engine
 * rather than from a second list of strings somebody typed, that the Δ is subtracted once in `route-summary.ts`
 * instead of inline in a `<span>`, and that the pace in the card is the engine's and not a number in a
 * component. Those are the four ways a UI quietly becomes a second source of truth, and each is one string to
 * look for in a source file.
 *
 * This is also the honest substitute for a click. There is no jsdom in the project and none will be added, so
 * interaction is covered by the live preview and by these structural facts — a spec that greps `App.tsx` for
 * `onProfile={setProfile}` cannot prove the select repaints, and says so rather than pretending.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PROFILES, PROFILE_ORDER, WALKING_SPEED_MPS } from '@/engine'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

const options = source('src/ui/route/route-options.ts')
const controls = source('src/ui/route/route-controls.tsx')
const app = source('src/App.tsx')
const summary = source('src/ui/route/route-summary.ts')

/** The union `route-options.ts` declares, pulled out of the source so the two lists are compared as data. */
/**
 * The literal members of `export type ProfileName = …`, and only those.
 *
 * A regex *literal* rather than `new RegExp`, because a string literal eats the backslashes this pattern needs
 * (`\s` in a template is plain `s`), and anchored on the members rather than on "everything to the end of the
 * statement", because this codebase writes no semicolons: a greedy scan walks off the declaration into the
 * paragraph below it, and a test that harvests prose reads like a check while counting words.
 */
function declaredUnion(text: string): string[] {
  const members = /export type ProfileName =\s*((?:\|?\s*'[^']+'\s*)+)/.exec(text)?.[1]
  if (members === undefined) throw new RangeError('no `export type ProfileName` in route-options.ts')
  return [...members.matchAll(/'([^']+)'/g)].map((match) => String(match[1]))
}

describe('the preference selector', () => {
  it('names the same five profiles the engine prices, in the same order', () => {
    expect(declaredUnion(options)).toEqual([...PROFILE_ORDER])
    // And the default the app holds is the first row of the picker, so the copy beside the numbers and the
    // objective behind them are the same choice rather than two defaults that happen to agree today.
    expect(/export const DEFAULT_PROFILE: ProfileName = '(\w+)'/.exec(options)?.[1]).toBe(PROFILE_ORDER[0])
  })

  it('builds its rows from the engine, and types no profile name of its own', () => {
    expect(app).toContain('profileChoices(engine.profiles, engine.profileOrder)')
    for (const profile of PROFILE_ORDER) {
      // A label written in a component is a label that can disagree with the profile it names — and "Shaded
      // walk" next to a route that is 46 m longer is exactly the disagreement worth preventing.
      const { label } = PROFILES[profile]
      expect(controls, `the control does not hard-code "${label}"`).not.toContain(label)
      expect(summary, `the summary does not hard-code "${label}"`).not.toContain(label)
    }
  })

  it('labels the select, and gives it the engine order', () => {
    expect(controls).toContain('htmlFor="route-profile"')
    expect(controls).toContain('id="route-profile"')
    expect(controls).toContain('value={profile}')
    expect(controls).toContain('profiles.map((row) => (')
    // Three in the source, four on screen: `PlacePicker` holds one and is rendered twice, then the algorithm,
    // then the preference. A fifth `<select>` here would mean a knob that nothing reads, which is how a form ends
    // up with a control that changes no answer.
    // Closing tags, because a prose mention of `<select>` in this file's own header would otherwise be counted as
    // markup — and there are exactly three rendered selects in the source (the place picker is one element that
    // renders twice).
    expect(controls.match(/<\/select>/g)).toHaveLength(3)
  })

  it('subtracts the baseline once, in the pure module, and quotes the engine pace', () => {
    expect(summary).toContain('export function profileDelta(')
    expect(app).toContain('profileDelta(')
    // The pace is looked up from the contract, per result — which is the same table the engine used for `minutes`,
    // so the card's "at 1.3 m/s" cannot be a number the UI chose.
    expect(app).toContain('engine.walkingSpeedMps[result.profile]')
    expect(Object.keys(WALKING_SPEED_MPS).sort()).toEqual([...PROFILE_ORDER].sort())
    // …and the hook is where the second search happens, so a component never asks for two routes itself. In cp4
    // the same seam gained a name — `runSearch`, exported — because compare mode asks *three* searches the same
    // question and a second copy of the switch would be a second thing to keep honest. So: the baseline is still
    // taken inside the hook, and the only other caller goes through the same one function.
    const useRoute = source('src/hooks/useRoute.ts')
    expect(useRoute).toContain("runSearch(index, from, to, algorithm, 'shortest')")
    expect(useRoute).toContain('export function runSearch(')
    const useCompare = source('src/hooks/useCompare.ts')
    expect(useCompare).toContain('runSearch(index, from, to, algorithm, profile)')
    for (const name of ['dijkstra(', 'aStar(', 'bfs(']) {
      expect(useCompare, `a search named directly in the compare hook`).not.toContain(`= ${name}`)
    }
  })

  it('leaves the note optional rather than promising a row that may not exist', () => {
    // `profiles.find(…)` may answer `undefined`, and the control's choice is to draw no caption. The alternative
    // — a `throw` in a lookup, or a `?? ` back to the baseline's sentence — is defensive code that either blanks
    // the page or prints an explanation of a preference the user did not pick.
    expect(controls).toContain('const trade = profiles.find((row) => row.value === profile)')
    expect(controls).toContain('{trade === undefined ? null : <p className="route-note">{trade.note}</p>}')
  })
})
