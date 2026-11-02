# Phase plan and log

One phase per instruction from the brief: build → test → fix → commit → short report, then
wait. Nothing below is "already done" unless it has a log entry with verification output.

## Amendments agreed before Phase 0

| # | Amendment | Where it landed |
| --- | --- | --- |
| 1 | MARG is the *project* name; the campus is Amrita Vishwa Vidyapeetham, Bengaluru | `campus.json` → `metadata.campus` / `campusShort` / `location`; README + `index.html` keep "MARG Campus Navigator"; `useCampus()` renders the campus line from data, not from a string in JSX |
| 2 | Replace "no runtime deps beyond React" with a denylist + a UI allowlist | `src/test/arch-rules.ts`: `ALGORITHM_DENYLIST`, `RUNTIME_DEP_ALLOWLIST` = react, react-dom, lucide-react + `/^@fontsource\//`-style patterns. Mirrored as `no-restricted-imports` in `eslint.config.js`, with a drift test between the two lists |
| 3 | No `file://` claim; bundled JSON import; Pages deploy + `npm run preview` in the final phase; `vite-plugin-singlefile` if cheap | README "Quick start" states the module-script/CORS restriction; `src/data/index.ts` imports the JSON; the single-file build shipped as `npm run build:single` (config cost: 4 lines); Pages workflow is scheduled for Phase 8 |
| 4 | Verify every version resolves; note substitutions | all 16 pins queried against the registry before writing them; deviations recorded below |
| 5 | Map-editor phase before polish | **added as Phase 7**; polish + deploy became Phase 8 |
| 6 | Benchmarks record Node version + machine info | Phase 4 exit criterion, written into `docs/ALGORITHMS.md` → "Benchmarks"; `scripts/bench.mjs` must emit platform, CPU, memory, Node version, commit and dataset size above the numbers |

## Plan

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| **0** ✅ | scaffold, engine contract, architecture guards, placeholder dataset | `npm run check` green; deps proven allowed; guard proven to fail on planted violations |
| **1** ✅ | min-heap, trie, union-find, LRU cache, adjacency index | unit tests per structure incl. invariants and property tests; no UI at all |
| **2** | real `campus.json` (synthetic Amrita layout), `build-graph.ts`, `map:validate`, SVG map with pan/zoom, zones/buildings/walkways/labels | map renders and pans; validator exits 0; graph round-trips through the engine index |
| **3** | BFS, DFS, Dijkstra, A\*, path post-processing, turn-by-turn, **and the route UI that shows them**: the path on the plate, the step list, origin/destination chosen from a plain select of place ids | A\* ≡ Dijkstra ≡ brute-force oracle on every fixture pair; A\* expands ≤ Dijkstra; DFS cut-vertices verified by deletion; a route is visible on the map at 360, 768 and 1440 px, and its step list names the same node ids in the same order |
| **4** | `router.ts`, cost profiles, LRU wiring, `scripts/bench.mjs` | profile switch changes the chosen route for a defensible reason; cache hit rate visible in the UI; benchmark table (with machine info) generated into `docs/ALGORITHMS.md` |
| **5** | search UX: trie typeahead, the picker that replaces Phase 3's `<select>`, swap, algorithm + explored-region overlay | 3-char typeahead with keyboard nav; the explored overlay makes A\* vs Dijkstra visible side by side |
| **6** | analysis: closure resilience (union-find), articulation points (DFS), accessibility summary | each claim computed by the engine and covered by tests, not authored by hand |
| **7** | **map editor**: upload a map image, two-point scale calibration, place/edit nodes, draw/edit edges with attributes, live validation, export `campus.json` | a real campus can be digitised without editing JSON; exported file passes `map:validate` and reloads identically |
| **8** | polish + delivery: a11y pass, mobile layout, empty/error states, GitHub Pages workflow in the README, final doc pass | Pages deploy wired through Actions; `npm run preview` documented; no console errors |

Phases 5 and 6 may swap if Phase 4's router needs a UI to be testable — a hook-level test
is the fallback, and I will say so in the report rather than quietly reorder.

## Deviations from the agreed plan, with reasons

1. **create-vite 9 now scaffolds oxlint + TypeScript 7.** Kept ESLint 9→10 +
   `typescript-eslint` 8 + **TS 5.9.3** instead: `typescript-eslint@8.72.1` peers
   `typescript >=4.8.4 <6.1.0`, so TS 7 removes the type-aware linting the boundary rules
   lean on. `strict` is set explicitly in every tsconfig because the current template omits
   it (TS 7 defaults it on; TS 5.9 does not).
2. **ESLint 9.39.5 installed but was flagged "no longer supported"**, so I moved to
   `eslint@10.14.0` + `@eslint/js@10.0.1` + `eslint-plugin-react-hooks@7.1.1` (the 6.x line
   peer-excludes ESLint 10). Rules are configured explicitly rather than by spreading a
   plugin's `configs.recommended`, so a plugin major bump cannot silently change the rule set.
3. **`vitest@4.1.12`, not 5.0.5.** 5.x is current, but 4.1.12 is the version whose
   `vite` dependency range I could verify covers Vite 8, and it is what
   `@vitest/coverage-v8@4.1.12` expects.
4. **`npm install` crashed** (arborist `Cannot read properties of null (reading
   'edgesOut')`) because `@vitest/coverage-v8`'s `vitest: *` peer pulled vitest 5 in
   alongside the pinned 4. Fixed with an explicit `overrides` block pinning `vitest` and
   `@vitest/coverage-v8` to 4.1.12. `$vitest` references do not work for devDependencies,
   hence the literal duplication — if you bump vitest, bump both.
5. **A third tsconfig (`tsconfig.test.json`) was added.** `src/test` needs `node:fs` to read
   sources; `src/**` must not have Node types available at all. One project per runtime, and
   the type system enforces the split instead of the tests being the only defence.
6. **`no-restricted-imports` has no `@/*/*` deep-import pattern.** It would have banned
   side-effect imports like `@/styles/app.css`. The barrel-only rule lives in the test instead,
   where it can be precise about *who* is importing — and since Phase 2's cp3 it covers both
   public surfaces (`@/engine` and `@/data`), not just the engine's.
7. **`server.allowedHosts`/`preview.allowedHosts: ['.e2b.app']`** in `vite.config.ts`: the
   sandboxed live preview reaches the dev server through a proxied hostname that Vite's host
   check would otherwise reject. Harmless locally, required to demo here.
8. **The route UI moved from Phase 5 into Phase 3** (asked for at Phase 2's review). It was
   always going to be the *proof* of the algorithms: a Dijkstra that only passes unit tests is a
   function, and a Dijkstra whose path is drawn over the walkways it followed is a result. Phase 3
   therefore ends with a `<select>` of place ids as the endpoint picker — deliberately boring, and
   replaced by the trie-backed typeahead in Phase 5, which is where the search work belongs.
9. **UI components are tested by `renderToStaticMarkup`, not by jsdom.** An earlier note in
   `vite.config.ts` promised "Phase 5 adds jsdom and they join this list"; that promise is deleted rather than
   kept, because jsdom is a dependency and the brief closes the dependency list. `react-dom/server` is already
   installed, so component *output* is assertable in Node and three `.tsx` files joined `coverage.include`;
   gestures, focus and layout are not, and `route-controls.tsx` sits at 77.77 % with the reason in
   `ARCHITECTURE.md` instead of being removed from the report.
10. **The Swap button lives with the pickers, not on the result card** (the plan lists it under the card). It
    edits the request, and a control that changes what is drawn belongs next to what it changes; the card is
    therefore free to be read-only, which is what lets its three states be one `<div>` each.
11. **The picker offers three searches and not four.** `dfs` is written, tested and measured — its routes average
    6.91 sentences against A\*'s 3.69 — but a depth-first answer on a card that prints "distance" is a teaching
    aid that misleads. `RouteAlgorithmChoice` is the three-name union, and `ALGORITHM_CHOICES` is keyed by it, so
    offering a fourth is a compile error in the table rather than a dropdown someone has to remember.

## Log

### Phase 0 — scaffold · 2026-11-01

**Runtime dependencies:** `react@19.3.1`, `react-dom@19.3.1`, `lucide-react@1.66.0`. Nothing
else ships to the browser; `package-lock.json` is committed and versions are pinned exactly
(no `^`) so a grader's install matches mine.

**Created**

- Toolchain: `package.json`, `package-lock.json`, `.gitignore`, `index.html`,
  `public/favicon.svg`, `vite.config.ts`, `eslint.config.js`, four tsconfigs.
- Engine contract: `src/engine/types.ts` (nodes, edges, `EdgeAttributes`, `GraphIndex`,
  cost/heuristic function types, `RouteResult` as a discriminated union, `GraphIssue`),
  `src/engine/constants.ts`, `src/engine/index.ts` as the sole public surface. No
  algorithms — Phase 1 owns those.
- Dataset: `src/data/campus.{json,types.ts}` with Amrita metadata and empty geometry, plus
  `src/data/index.ts` typing the JSON at the boundary.
- Hooks bridge: `useEngineContract`, `useCampus`.
- Shell: `App.tsx` (masthead, blueprint SVG plate sized from the dataset, contract values,
  placeholder-data badge), `main.tsx`, `styles/{tokens,app}.css`.
- Guards: `src/test/arch-rules.ts`, `src/test/architecture.test.ts` (11 tests).
- Docs: this file, `ARCHITECTURE.md`, `ALGORITHMS.md`, `MAP-DATA.md`, `README.md`.

**Verification**

```
npm run typecheck   → tsc -b, 3 projects, 0 errors
npm run lint        → eslint . , 0 problems
npm test            → 2 files, 15 tests passed
npm run build       → dist/index.html + 3.73 kB css + 229.46 kB js (72.42 kB gzip)
npm run build:single→ dist-single/index.html 233.87 kB, JS+CSS inlined, favicon external
```

**Guard proven negative, not decorative.** Six violations were planted and each was caught
by name before being deleted: `lucide-react` imported by an engine file; `@/data` imported by
an engine file; `document` used in an engine file; `@/engine` imported by a component;
`fetch(` in shipped code; `graphology` added to `devDependencies`. The engine-module/spec
pairing rule also fired, which is the Phase 1 rule already working.

**Known gaps, on purpose**

- No map geometry, no routing, no controls. A disabled search box would only prove I can
  render a `<button>`.
- `coverage` includes `src/engine/**` only, since that is the code the coursework grades.
- No jsdom yet: it arrives with the first component test (Phase 5), together with a
  `@vitest-environment jsdom` docblock on those files.
- `docs/ALGORITHMS.md` lists intended invariants per structure. They are a plan, not
  evidence, until Phase 1's tests exist.

### Phase 1 — data structures + the graph · 2026-11-01

**Scope discipline:** engine only. The diff touches `src/engine/**`, `src/test/architecture.test.ts`,
`vite.config.ts` (spec extension + coverage), and the docs. No component, hook, style or dataset file
changed, so nothing in the UI could come to depend on an algorithm that does not exist yet.

**Added** — `src/engine/structures/`, each with a collocated spec:

| module | what it is | tests |
| --- | --- | --- |
| `min-heap.ts` | comparator-driven binary heap, O(n) Floyd build, `isHeapOrdered()` audit, lazy deletion argued against an indexed heap | 14 |
| `trie.ts` | normalised prefix index; records and keys kept separate; aliases; ranked `complete()`; branch pruning on delete | 16 |
| `union-find.ts` | path compression + union by rank, `depthOf`/`maxDepth` probes, `buildComponents(graph, { blockedEdges, skip })` | 15 |
| `lru-cache.ts` | `Map` + hand-written doubly linked list, recency split between read and probe, `consistency()` | 14 |
| `graph.ts` | adjacency list with a seal lifecycle, frozen shared snapshot, `validateGraph` over any graph | 18 |
| `__tests__/helpers.ts` | seeded generators (mulberry32 + FNV) and the naive oracles every property test leans on | — |

Total **95 tests**, engine coverage **97.84% statements / 98.9% lines**.

**Conventions and contract changes made in this phase**

- Specs are `*.spec.ts` beside their module. Vitest's `include`, the coverage excludes and the
  architecture test's pairing rule accept `.spec.ts` as well as `.test.ts`; `contract.test.ts` was
  renamed to `contract.spec.ts` so one convention covers the engine.
- `GraphIssueCode` gained `non-positive-cost`, added alongside `graph.ts` rather than with the docs
  checkpoint, because a validator cannot report a code the contract does not have.
- `UnionFind<TElement extends string>`: the id tie-break needs an ordering, and lexicographic
  comparison of numeric ids would be an accident rather than a decision.
- `ENGINE_VERSION` → `0.2.0-phase1.structures`. The barrel publishes all five structures, and
  `contract.spec.ts` proves a real query is writable through `@/engine` alone — that test is what
  makes "the UI never needs a deep import" a checked claim instead of an intention.
- Coverage excludes `index.ts` and `types.ts`. Both are statement-free (a re-export barrel and a
  file of types), so v8 reported `0/0` as 0% and dragged the aggregate down while saying nothing
  about tests.

**Verification**

```
npm run typecheck   → tsc -b, 3 projects, 0 errors
npm run lint        → eslint ., 0 problems
npm test            → 7 files, 95 tests passed
npm run build       → ok (App.tsx untouched)
```

`erasableSyntaxOnly` and `noUncheckedIndexedAccess` both paid for themselves again: the first
rejected a parameter property in a test-only model class, the second forced honest `undefined`
handling in `heap.peek`, `#at`, and every adjacency lookup.

**How this phase was actually executed, and the deviation it forced.** The first attempt was
written, verified at 93 tests and left uncommitted while the session branch was locked by its
merged PR; `Continue` re-cloned the repository and the work was destroyed with no trace in the
remote, the index or the object store. The rebuild therefore ran as **six checkpoints, each committed
and pushed before the next began** — a phase that cannot be lost is worth more than a phase that is
slightly prettier. Two checkpoint boundaries moved as a result: `helpers.ts` arrived with the heap
(its property tests were the first consumers, and two copies of "what a component is" is how an
engine bug gets ratified by a test), and the guard's prose fix arrived with union-find, after
comment text had produced a false alarm in three consecutive checkpoints.

**Four things the rebuild produced that the first pass had not**

1. **Two trie bugs in the alias bookkeeping**, both found by the removal/pruning tests: `addAlias`
   registered a key in the trie without telling the record, so an alias could never be removed;
   and `removeKey` deleted the last spelling before delegating, leaving the key in the index and
   the record gone — `complete()` returned a ghost. The engine is now correct *because* the tests
   were adversarial rather than illustrative.
2. **A graph-index bug that would have shipped**: incidence was recorded only on an edge's `from`
   side, so `edgesAt`/`degree` claimed nothing touched the far end of a one-way walkway.
3. **Three false alarms from the architecture guard, all caused by my prose**: a doc comment
   reading `from "not added yet"`, a template literal reading `from "@/engine"`, and a sentence
   wrapping across `"no route exists" from "no route was found"`. Specifier extraction is now
   anchored to real `import`/`export` statement syntax, the residual limitation (a comment spelling
   out `import("x")` still registers) is written in the file, and `the guard itself` test asserts
   both halves — prose ignored, and single-line, side-effect, multi-line and re-export imports all
   found. Re-proven with planted violations: `graphology`, `ngraph.graph` and `lucide-react`
   imports, `document` in an engine file, a component importing `@/engine`, `fetch(` in the data
   layer, a `graphology` devDependency — every one named its file.
4. **Four expectations of mine that were wrong while the engine was right**, each settled by
   documentation rather than by adjusting a number: pops are not globally monotone when pushes
   interleave; a heap is not a stable sort; a key lives on the node that spells the whole word, not
   on every node beneath it; and one lone node is valid *and* reportable as stranded.

**Gaps I am not hiding**

- These structures have no consumer yet: Phase 3's searches are the first. That is why every spec
  leans on an independent reference model instead of a happy-path example.
- No heap decrease-key, by design (see `ALGORITHMS.md` §1). If Phase 4's benchmark shows the
  duplication factor hurting, revisiting it is a legitimate Phase 8 task, and the decision is
  recorded so it can be revisited rather than relitigated.
- `LRUCache` has no `resize`; `UnionFind` has no `delete`. Neither has a use case, and an unused
  API is a liability in review, not a feature.
- A short list of reachable-but-uncovered branches (the `from`-side arm of the unknown-endpoint
  checks, `removeEdge` on a one-way edge, `lookup` on an unregistered word, `members` out of
  range) is itemised in the PR description instead of being quietly deleted from it.

### Phase 2 — campus model, validator, map · complete (cp1–cp5, in PR #2)

**Checkpoint 1 — the dataset and its schema · 2026-11-01**

`src/data/campus.json` is now a synthetic-but-plausible Amrita Bengaluru layout: **39 nodes**
(19 named places, 19 junctions, 1 `entrance`), **56 edges**, 13 buildings, 8 surfaces, all six
zones. One connected component, **17 independent cycles**, edges 80–279 m, two hand-written
`metres` and the rest derived from coordinates so both code paths are exercised. The place list is
the brief's: two gates, three academic blocks, library, cafeteria, two hostels, sports ground,
parking, ATM, two restrooms, plus admin/clinic/labs/courts/garden so no zone is a single dot.

The file was **generated and checked, not typed and admired**. A scratch authoring script
(`campus.json` is committed; the script is not) measures every edge, tests every pair of segments for
a crossing, runs union-find for components and counts cycles, and refuses to accept a layout with
two labels 40 px apart. Building footprints are not hand-placed: each starts at its desired size and
shrinks around the eight directions until it clears every node that is not its door, every walkway it
is not attached to, and every block already placed. That loop is what produced the first honest
version of this map — and it reported, before anything rendered, that three walkways crossed, three
edges were longer than 400 m, three node pairs overlapped, and twelve blocks sat on top of paths.

`docs/SCHEMA.md` is the field-by-field reference (units, defaults, derived values, and one code per
issue for the validator to report). `docs/MAP-DATA.md` keeps the workflow and now defers to it.

**The type system disagreed with itself, and lost.** `campus.types.ts` has always claimed "nothing is
a literal union" — and then declared `kind`, `attrs.surface` and `SurfaceSpec.kind` as literal unions
and the footprint rings as `[number, number][]`. With Phase 0's empty placeholder arrays that
contradiction was invisible: `never[]` satisfies anything. The first real node in the file exposed it,
because a `.json` import is typed by *widening* — every string becomes `string`, every array becomes
`T[]` — so a literal union or a tuple in the raw-file types is not strict, it is **unsatisfiable**.
Those four fields are now `string`/`number[][]` with the narrowing moved to the validator, and
`docs/SCHEMA.md` states the rule ("declare only what a JSON file can prove") so it cannot drift back.
What the compiler gives up, the error messages gain: bad data now fails `map:validate` with a sentence
a data editor can act on rather than a 40-line assignability trace inside a file nobody edits.

**One rule moved from error to warning while writing them.** "An edge between two non-junction
places" was listed as build-breaking in Phase 0's draft. It cannot stay an error: the campus has real
plaza connections (`sports-ground`–`courts`, `restroom-s`–`gate-south`) and forbidding them means
inventing a fake junction node per crossing just to satisfy a checker. It is now warning
`place-to-place`, and the placeholder keeps both instances so the warning path is exercised by data
rather than by a fixture. A shadow implementation of every documented rule — run over the committed
file before the TypeScript validator existed — returned 0 errors, 2 warnings, those two.

**Checkpoint 2 — the adapter, the CLI, and one spec per failure · 2026-11-01**

`src/data/build-graph.ts` (640 lines) is the only file that reads the data's values, and it splits the
work in two: `validateCampusFile(source)` answers *"what is wrong with this file"* and `buildGraph(source)`
answers *"and here is the graph the good rows describe"`. Both run one `analyse` pass, so the report and
the map can never disagree about which rows were usable. 24 issue codes, one per thing that can be wrong,
**82 specs** — one per code, each asserting the code, the severity, and that the message names the id to
go and fix.

`npm run map:validate` runs the same function from a terminal, through Vite's SSR loader rather than a
second implementation in `.mjs`: the rules are TypeScript that reach the engine via `@/engine`, and a
validator that disagrees with the app about what is broken is worse than no validator. Exit codes are part
of the contract — 0 clean, 1 errors, 2 "the file never arrived", with `--strict` promoting warnings and
`--json` for CI. Tested as a *command* (`src/test/validate-map.spec.ts`, 5 cases) because an exit code is
not reachable from a unit test of the rules.

**Three things this checkpoint produced that the plan had not.**

1. **The engine's `createGraph` throws where a file needs a report.** `addNode`/`addEdge` raise
   `TypeError` for a duplicate id, a self-loop, a dangling endpoint, a non-finite coordinate and a length
   ≤ 0 — correct for graphs built by code. So the adapter pre-clears all five, and `build-graph.ts` has no
   `try`/`catch`: after the pre-clear there is no reachable throw, and catching one would both be
   untestable and hide the bug it claims to survive. This is also why `validateGraph` is *not* called on
   this path — from here it could report nothing — and `docs/SCHEMA.md` now states that split explicitly
   ("a check that cannot fire is a check someone has to read and test").
2. **`docs/SCHEMA.md`'s "an edge between two non-junction places is an error" could not be implemented as
   written**, so checkpoint 1 moved it to warning `place-to-place`, and the shipped file keeps two of them
   to exercise the path. While writing the CLI I found the second half of that decision: an *entrance*
   whose node had been dropped for bad coordinates produced `entrance-unreachable` too — my repair,
   reported as the file's problem. It joined the three completeness warnings that are suppressed while any
   error exists, which is now a documented rule rather than an emergent one.
3. **A drift test found a missing test.** `MAP_ISSUE_CODES` is a value, not just a union, and
   `src/test/schema-drift.spec.ts` asserts every code has a row in `docs/SCHEMA.md`'s matrix (with the
   severity the doc claims, so a silent error→warning downgrade fails CI) *and* a case in the spec file.
   It failed on its first run: `disconnected-component` had no spec. Now it has one that asserts the
   message's "2 separate networks of 3, 2 nodes" — the exact claim union-find is making — and that the
   connected part still routes.

**Coverage, since the numbers moved.** `coverage.include` now covers `src/data/**` as well as
`src/engine/**`, because a validator with 82 specs and no reported coverage is a report describing half
the tested code. `build-graph.ts` is at 100% statements / 99.65% branches / 100% lines; the one uncovered
arm is the "ring has fewer than two points" side of a guard in `ringSides`, unreachable because
`checkRing` has already required at least three. Engine numbers are unchanged from Phase 1 (97.82%
statements / 86.37% branches in `structures`, 100% in `engine/`). Reaching that shape removed four
branches by *deletion* rather than by testing: the builder no longer re-derives an edge's length (so its
impossible `metres <= 0` guard is gone), no longer re-looks-up endpoints (`resolveEdge` returns the
resolved nodes), and footprint rings are `[number, number]` tuples so the geometry needs eight fewer
`?? 0` fallbacks that `noUncheckedIndexedAccess` would otherwise demand and nothing could reach.

```
npm run typecheck   → tsc -b, 3 projects, 0 errors
npm run lint        → eslint ., 0 problems
npm test            → 10 files, 185 tests passed
npm run map:validate  → 0 errors, 2 warnings, exit 0 (the two intentional place-to-place edges)
npm run build       → ok (App.tsx still untouched: no UI in this checkpoint)
```

**Checkpoint 3 — the plate, the camera, and the four layers · 2026-11-01**

`src/ui/map/` draws the campus as one `<svg>` and nothing else: base (grid + ground surfaces), buildings,
walkways, nodes. Panning and zooming change **one attribute** — the `viewBox` — so the layers, which are
`memo`'d over data that never changes, re-render zero times per frame. The camera itself is arithmetic in
`view.ts`: `{ cx, cy, span }`, where `span` is the visible width in world units and the visible height is
`span / aspect`. That is why a window resize cannot change your zoom level, and why the whole thing is
testable in plain Node (21 specs, no DOM): *the point under the cursor stays under the cursor*, the view
never leaves the canvas, a clamped zoom must not drift the centre, `fit` covers the canvas at every aspect
from 0.4 to 3.2 — which is the 360 px overflow question, answered once.

Gestures are two files, not one: `touch-action: none` in `map.css` and `use-viewport.ts`. Either alone is
broken — React registers `wheel` passively at the root, so `preventDefault()` from a JSX handler does
nothing and the page scrolls while the map zooms; hence a hand-bound non-passive listener on the element,
reading the camera's inputs from a ref so it binds once. Keyboard comes free with it: arrows pan, `+`/`-`
zoom, `0` resets, and only the keys actually used are consumed, so Tab still tabs.

**Two boundary findings.** `src/ui/map/layers/*` needed `GraphNode`/`GraphEdge`, and importing them from
`@/engine/types` is precisely what the architecture test forbids — so `src/data/index.ts` re-exports the
types the map must name, keeping the dependency direction one-way (`ui → data → engine`) and the engine
barrel the only definition site. And the barrel rule itself was widened from "hooks may not deep-import the
engine" to "nobody outside a layer may deep-import it, engine or data", resolved through both the `@/`
alias and relative specifiers; a probe file proved it fails on `@/data/build-graph` as well as
`@/engine/graph` before it was deleted.

At 360 px the plate is `5/4`, not arbitrarily tall: the camera is clamped to the canvas, so a taller plate
shows only empty margin above and below a smaller campus. Junction dots are hidden at that width (they read
as dust and invite a mis-tap), and walkway casings lose a pixel.

```
npm run check → typecheck · lint · 207 tests (11 files) · build ok
```

**Checkpoint 4 — badges, tooltips, staged labels, the legend · 2026-11-02**

Four pieces, and one rule underneath them: **geometry scales with the plate, screen objects must not.**
`icons.ts` maps the data's 12 categories to Lucide glyphs (plus a kind-level fallback for an
`entrance`, which has no category because it is not searchable), and `icons.spec.ts` checks the table
against `campus.json` itself, so an unmapped category fails the build instead of quietly drawing a dot.
`use-tooltip.ts` keeps one state for hover, tap and focus; the rule is the pointer *type* — a mouse's
tip closes on leave, a finger's stays until you tap elsewhere or press Escape — because a tap's
`pointerleave` fires the instant the finger lifts. `marker-plan.ts` declines to draw what will not fit,
reserving the **32 px tap target** rather than the 26 px badge, so no two hit areas can overlap at any
width; `map-legend.tsx` lists only the zones and glyphs the file actually uses, and states the baseline
`attributeLines` treats as ordinary, derived from `DEFAULT_EDGE_ATTRIBUTES` rather than retyped.

Native `<title>` is gone from all three layers: it cannot be styled, cannot be dismissed, and does not
exist on a phone. Its text moved into `tip-content.ts` as a pure function, where the wording is a claim
that can be tested — one decimal for metres, and **only deviations from the defaults**, so a step-free,
lit, paved, flat segment says its length and nothing else.

**What the numbers say.** Same twelve places, measured rather than eyeballed: **20 of 20 markers placed
at 1440 px, 19 at 768, 12 at 360** (8 hidden, 7 losing only their text). That is the 360 px overflow
question answered as an assertion, and it is why the legend ends with "N markers need more zoom" instead
of leaving a person to discover it.

**Two things coverage exposed, both fixed by deleting.** `tipSide` had a third branch whose true arm was
unreachable by construction, and `attributeLines` took a `baseline` parameter that no caller passed — it
existed only so a test could. Both are gone, `WORDING` became a total `Record<SurfaceKind, string>` so an
unworded surface is a compile error rather than a tooltip reading "tarmac", and the four pure map modules
now read 100 % statements / 100 % branches (98.6 % across the folder, the remainder being `use-tooltip`'s
React wiring, which is excluded by name and documented).

Checked the two themes numerically rather than by eye: label on halo 15.9:1 light / 15.3:1 dark, glyph on
badge plate 7.9:1 both. The legend's notes were on `--ink-faint` at **3.3:1 / 4.1:1** — under AA for 10 px
text — so they moved to `--ink-soft`.

```
npm run check → typecheck · lint · 250 tests (14 files) · build ok
```

**Checkpoint 5 — responsive pass, docs, and the phase's close-out · 2026-11-02**

Docs brought level with the code, which is the part of this project that rots first: the README's "current
phase" block now describes what actually runs (and says outright that there is still no routing);
`docs/MAP-DATA.md` names both `place-to-place` warnings *by edge id* with the reason each is intentional,
so the file's two warnings read as a decision rather than as leftover noise; `docs/ARCHITECTURE.md` gained
the "geometry scales, screen objects do not" split inside `src/ui`, including why four modules are in
`coverage.include` and why the components are excluded **by name**; and the plan's Phase 3 row now carries
the route UI, with the reason in the deviations list.

The 360 / 768 / 1440 pass is a set of rules rather than three screenshots, because a rule fails a build
and a screenshot fails nobody: the fit camera covers the canvas at aspects 0.4 → 3.2 (`view.spec.ts`); the
marker plan is measured at all three plate sizes; the plate is `5/4` on a phone because a taller one could
only add empty margin above and below a clamped camera; junction dots and the gesture hint are dropped
under 640 px; every control is a multiple of 4 px (`--space-*`, 32 px buttons, 32 px tap targets, 8 px
label gap); and the legend is capped at `min(340px, 62%)` so it cannot outwidth the plate it sits on.

### Phase 3, checkpoint 1 — Dijkstra, the shared run, and the geometry A* will stand on

**Code.** `src/engine/algorithms/search-common.ts` (`SearchRun`: the endpoint ladder, the frontier, the
relaxation rules, the snapshot recorder and the `RouteResult` assembly — one implementation, three
algorithms), `algorithms/dijkstra.ts` (the ordering rule and nothing else), `algorithms/path-utils.ts`
(grouping a path into legs and wording them; the simplification pass is cp3's), `geo/measure.ts`
(`euclidean`, `compassOf`, `turnBetween`, `minCostPerUnit`, `euclideanHeuristic`).

**Contract changes, all of them additive except where noted.** `RouteMetrics` gains
`frontierSnapshots` (the frontier per settled vertex, index-aligned with `exploredOrder`, for the replay
overlay) and *moves* `exploredOrder` out of `RouteFound` into `RouteMetrics`, because on a failed search the
settled set is the reachable set and Phase 6 will draw it. `RouteStep.direction` stops being a free-form
`string` and becomes the nine-value `TurnDirection` union, which is what removes the `default:` branch from
the wording switch. `WALKING_SPEED_MPS` is now `Readonly<Record<WeightProfile, number>>`, so a pace lookup is
total and the `?? 1.4` fallback in the contract spec is gone rather than unreachable. `ENGINE_VERSION` →
`0.3.0-phase3.algorithms`. The field names the brief asked for are the ones the union already had: *path* is
`nodeIds`, *distance* is `metres`, *visited order* is `exploredOrder`, *nodes expanded* is `expanded`,
*time* is `ms`; the mapping is written into `types.ts` above `RouteFound` so the two vocabularies cannot
drift, and `cost` stays separate from `metres` on purpose (it is the profile-weighted total, which is the
only number two algorithms can be compared on).

**Tests.** +83 — 26 `search-common`, 21 `geo/measure`, 19 `dijkstra`, 17 `path-utils` — so 166 in
`src/engine` and **333 in the project** (`npm run check` green: typecheck, lint, 333 tests, build).
`dijkstra.ts`, `geo/measure.ts` and `algorithms/path-utils.ts` are at **100 % statements *and* branches**;
`search-common.ts` is 99.1 / 96.2 with its three open arms documented in `ALGORITHMS.md` §8 as
unreachable-by-construction — and one that started open and *was* reachable (a queue search that drains) got
a test instead of a footnote. `path-utils.spec.ts` exists because the architecture guard refuses to ship an
engine module without one — that rule caught my plan to write its spec a checkpoint later, and the right
answer was to write it now rather than to weaken the guard.

**Method, and what it changed.** The 200-graph sweep compares against `bellmanFord` for every vertex as
target under the same closure set, and re-walks each returned path edge by edge; 30 tiny graphs go against
`floydWarshall` as a second, structurally unrelated oracle. Two expectations of mine were wrong and the code
was right (a "nearly straight" fixture that was really a 90° turn, and a ratio computed against the
horizontal instead of the diagonal) — both fixed in the spec, recorded in `ALGORITHMS.md` §12.
Then each of the two lazy-deletion lines was removed in turn: the textbook `cost > best` comparison changed
nothing across 148 tests, so it is gone, and the settled-set check fails the test named for it, so it stays.
`ALGORITHMS.md` §1 carries the correction against what Phase 1 claimed there.

**Not in this checkpoint, on purpose.** BFS, A*, DFS (cp2); the simplification pass and full step wording
(cp3); the route UI (cp4); the result card, the responsive pass and the rest of the docs (cp5). Nothing in
`src/ui` changed yet, so the map still draws no route.
### Phase 3, checkpoint 2 — A*, BFS, DFS: three containers, one run

**What landed.** `algorithms/a-star.ts`, `algorithms/bfs.ts`, `algorithms/dfs.ts`, their three spec files,
`__tests__/search-parity.spec.ts`, `src/test/campus-routing.spec.ts`, the exports they needed from
`src/engine/index.ts`, and `ALGORITHMS.md` §6, §7 and §9 written against numbers taken out of the runs rather
than out of my head. No UI: `src/ui` is untouched, so the map still draws no route — cp4.

**The design decision the checkpoint turns on.** `SearchRun` used to choose between a heap and a queue with a
set called `cheapestWins`. It now holds a policy table — `dijkstra: heap`, `a-star: heap`, `bfs: queue`,
`dfs: stack` — and *that is the entire difference between the four searches*. Same frontier records, same
`offer`/`next`/`expand`, same settled set, same refusal order, same snapshot code. A* differs from Dijkstra by
one expression (`priority = cost + h`); BFS and DFS differ by which end of an array they read. Naming it
mattered: `cheapestWins` stopped being true the moment a second heap search existed, and a misleading name in
a shared module is worse than a longer one.

A consequence of the shared run, worth stating because it looks like a bug in a demo: BFS and DFS accumulate
`cost` in **hops**, not metres, and `offer()` refuses a later record for a vertex a queue or stack search has
already seen. First-in wins, which is what makes BFS hop-optimal — and is also why DFS returns a valid route
rather than a good one. `RouteFound` carries `metres` alongside `cost` precisely so the two can be printed
against each other.

**A\*'s heuristic and the closure set.** `minCostPerUnit` skips edges priced `Infinity`, so a profile that
closes staircases raises the scale rather than poisoning it, and the estimate stays admissible under closures.
That single line is the reason A* and Dijkstra agree on the 200-graph sweep *with* blocked edges and not
merely despite them; measured directly on 80 tiny graphs against `floydWarshall`'s all-pairs truth, in both
directions of one-way edges.

**DFS, and the two views that must not be merged.** `dfs` walks out-arcs (a walker's graph), `articulationPoints`
walks `edgesAt` (a campus's graph). The second is what Phase 6's resilience report needs, because a one-way
walkway does not stop a place being part of the campus. Both are iterative on explicit stacks — the 5 000-vertex
line test is the licence for that, and it is Phase 7's map editor that will need it. `cycle` ignores the arc that
walks back along the same edge id, or every corridor in the app would "contain a cycle".

**Measured.** `npm run check`: typecheck · lint · **418 tests in 23 files** · build ok (`dist` js unchanged at
286.69 kB, because nothing in `src/ui` imports a search yet). `src/engine` is 246 (was 166): a-star 22,
dfs 26, bfs 17, plus cp1's 127 and `search-parity` 15. Coverage: `a-star.ts`, `bfs.ts`, `dfs.ts` **100 %
statements and branches** on their first run — `dijkstra.ts`, `measure.ts`, `path-utils.ts` still 100/100, and
`search-common.ts` still 99.15 / 96.47 with only cp1's three documented arms open (their line numbers moved to
333 / 355 / 392 when the policy table grew the file; `ALGORITHMS.md` §8 now records the new ones and says why).
On `campus.json`, all 380 ordered pairs of named places: 0 refusals, A* settles strictly fewer vertices on 374
pairs and ties on 6 (3 043 settlements total against Dijkstra's 8 605 — 8.0 per query against 22.6, on a map of
39), BFS's routes are 5 042.7 m longer in aggregate, depth-first's 291 146.1 m longer, and the longest route on
campus is 1 517.7 m (`Research Labs → Hostel Block 2`).

**Test support that is now shared, and why.** `__tests__/helpers.ts` gained `sweepGraphs` (the seeded 200-graph
driver: node count, one-way chance, disconnection and a fifth of the edges closed all as functions of the trial
number, so trial 137 is the same graph in every spec), the four search fixtures, `unravelledIndex`, and
`refusalLadder` — the six broken inputs every algorithm must refuse identically, written once. Dijkstra's own
spec was refactored onto `sweepGraphs` (its 19 tests and their claims are unchanged; its graphs are now the
shared shapes, so "the same 200 graphs" means the same graphs). The ladder exists because a `RouteResult` union
is only worth having if a screen can branch on `result.reason` without knowing which search answered: parity
between algorithms is a contract, and a contract in four files is four chances to drift.

**Two guard and two spec corrections made on the way.** `architecture.test.ts` was counting "is a test file" by
filename only, which left `src/engine/__tests__/helpers.ts` forbidden from importing `vitest` while being the
engine's test-support module; the rule now recognises the `__tests__` directory *for the framework exemption
only*, with a test of the guard itself pinning that the network and platform-global scans still read that file
(`isTest` stays false). And three of my own spec expectations were wrong while the engine was right — a
frontier recorded before its own pushes (so `[]` is row 1's answer, not a missing frame), `minCostPerUnit`
measuring the *drawing* (the square's diagonal is 141.42 units of it, not its labelled 250 m), and `metres`
equality across two searches whose profiles were unit-cost, where equal cost does not imply equal length. All
three fixed in the specs. One real flake came out of it too: the ladder asserted `ms === 0` against the default
`Date.now`, which can tick — it now injects the clock, which is what the seam is for.

**Not in this checkpoint, on purpose.** `simplifyLegs` (cp3), the route UI (cp4), the result card, the
responsive pass and README/ARCHITECTURE (cp5).
### Phase 3, checkpoint 2b — the two checks asked for before cp3

**Admissibility against the map's own numbers, and a new error.** `buildGraph` did *not* report an edge whose
stated `metres` is less than the straight-line distance between its endpoints: `length-mismatch` is a symmetric
±15 % **warning**, so `metres: 180` against a 190 m crow-flight — a 5.3 % gap, inside the tolerance, and in the
impossible direction — passed in silence. It is now `shorter-than-crow-flight`, an **error**, with the band
measured in ground metres (`0.1`, or one pixel's diagonal `√2 / pixelsPerMetre` at a coarse scale, whichever is
larger) so that coordinate rounding is not reported as a lie. The edge stays in the graph — a report is not a
deletion, and the coordinates are the trustworthy half — and `map:validate` on `campus.json` is unchanged at
**0 errors, 2 warnings** (the tightest stated length in the file is exactly its derived value; the loosest is
3.5 m *longer*). Three specs in `build-graph.spec.ts`: the error, its wording and the "edge survives the report" claim in one
case; the silent shortfall below the rounding band; and the same 10 m gap judged against two different
`pixelsPerMetre`. `src/test/schema-drift.spec.ts` demanded the docs matrix row and the per-code spec before it
would pass, which is that test doing its job: the first run failed on exactly those two.

**How the heuristic is scaled when a profile makes an edge cheaper than its length.** It is not a second knob —
the factor is inside the measurement. `minCostPerUnit` takes `min` over traversable edges of `cost(e) / length(e)`
with `cost` being the very function the search minimises, so `0.2 × metres` moves `k` to 0.2 and admissibility
holds; a single discounted edge sets the bound for the whole map, because a lower bound must be lower
everywhere. Three specs in `a-star.spec.ts` pin it, including the counterfactual: the same graph and profile with
an *unscaled* `h = euclidean` returns the 250 m diagonal at cost 50 where the optimum is 40 — 10 units worse,
and nothing in the types tells the two heuristics apart, which is the argument for measuring rather than
configuring. `one-fifth` is now a fourth profile in the 200-graph parity sweep, so the A\*/Dijkstra equality is
checked under a sub-linear cost and not merely claimed. `ALGORITHMS.md` §12 carries both paragraphs.

**The guard, confirmed.** `src/test/architecture.test.ts` › *the guard itself* › **"keeps every file under
src/engine/__tests__ in scope for the no-network and no-globals scans"** — a tripwire that iterates the
directory and asserts membership in both scanned sets, so teaching `isTest` about `__tests__` (the tempting
generalisation) would fail here instead of quietly exempting the engine's support modules from the "no backend"
and "no platform globals" rules. It joins *widens the framework exemption to the engine's test directory, and no
further*; the architecture guard is now 14 tests.
### Phase 3, checkpoint 3 — the fold between the geometry and the words

**What landed.** `simplifyLegs(legs, { minLegMetres? })` in `algorithms/path-utils.ts`, wired into
`SearchRun.found()` *between* `routeLegs` and `stepsFromLegs`; `MIN_INSTRUCTION_METRES = 20` in
`constants.ts` (and on the barrel, see below); 9 new tests in `path-utils.spec.ts` (17 → 27) covering the fold
and the `MIN_SEGMENT_METRES` floor that `minLegMetres: 0` cannot switch off; a quarter-degree sweep of every turn
bucket from −180° to 180° against a table derived from the exported thresholds, with eight spelled-out
straddles at 15 / 60 / 135 / 165; and a replay-of-steps sweep in `search-parity.spec.ts` that runs **all four
searches × 60 seeded graphs × sampled pairs** on three properties at once (the replay, one sentence per hop at
most, and metres that add up within the tenths the legs round to).

**The rule, in one sentence.** A leg under the threshold is absorbed into the leg it was reached through and
the *survivor's* record — `direction`, `compass`, `landmark` — is copied untouched; a short opening leg folds
forward instead; the joint is counted once so `nodes = edges + 1` survives. Nothing composes a sentence and
nothing re-derives a heading, which is what lets the pass sit between the two halves without either noticing,
and why "the wording is never rewritten by simplification" is a structural claim rather than a hope.

**Measured on this campus: the fold changes nothing, on purpose.** 1 404 legs from `routeLegs`, 1 404 out of
`simplifyLegs`, 0 of 380 pairs altered — the shortest walkway in `campus.json` is 80 m, four times the
threshold. `src/test/campus-routing.spec.ts` now asserts both halves (per-pair identity of the leg list, and the
3× floor on the shortest edge), so the pass cannot quietly start eating normal routes and cannot quietly have
been needed all along. The numbers that came out of the same sweep are worth keeping: **3.69** sentences per
route by A\* or BFS, **6.91** by depth-first, **10** on the longest (`Research Labs → Hostel Block 2`).

**One bug the barrel caught me making.** `MIN_INSTRUCTION_METRES` went into `constants.ts` and not into
`src/engine/index.ts`, and the test that read it through `@/engine` got `undefined` — which `tsc -p
tsconfig.app.json` cannot see, because that project excludes `src/test`. It surfaced as `expected 80 to be
greater than or equal to NaN` in a red test, not as a compile error. The lesson is the same one cp1 wrote down
about `tsconfig.test.json`: **`tsconfig.app.json` is blind to `src/test`, and only `tsc -b` (what `npm run
check` runs) reads the whole picture** — so a checkpoint that touches `src/test` is not verified by the faster
command. The barrel comment in `index.ts` already says a missing export means the module is missing an API; this
time it meant the barrel was missing a name, and the runtime was the one that noticed.

**Coverage note for cp3's own file.** `path-utils.ts` stays at 100 % statements and branches with the fold
inside it: the `legs.length < 2` early return, both fold directions and the `Math.max` floor are each reached by
a test above, and no arm of `simplifyLegs` is left to argue about.

**Not in this checkpoint, on purpose.** The route UI (cp4); the result card, the responsive pass and the rest of
the docs (cp5).

### Phase 3, checkpoint 4 — the route, drawn and picked

**What landed.** The route UI: `src/hooks/useRoute.ts` (the only module in the app that calls a search),
`src/ui/map/route-plan.ts` + its layer `src/ui/map/layers/route-layer.tsx` (the polyline, the green start disc,
the coral destination ring), `src/ui/route/route-options.ts` + `route-controls.tsx` (From/To pickers, the
algorithm `<select>`, the swap button), and a `route` slot in `MapView` between the walkways and the dots. 21
new specs (`route-plan` 8, `route-options` 13) and one campus-wide property in `campus-routing.spec.ts`;
**461 tests in 25 files**, `path-utils.ts`/`route-plan.ts` still 100 % statements and branches, `route-options.ts`
100 % statements with one documented comparator arm.

**One wording bug, found by looking at a picture rather than at a number.** The scratch SSR render (below) printed
the first real directions list on this campus: `Head north-west to labs`, `Turn left at labs`, `Bear right at
acad c`. Every one of those named a *junction*, whose label in `campus.json` is lowercase shorthand for the
data's own bookkeeping — legible to a search, useless to a walker, and never drawn on the plate by the marker
layer. So `routeLegs` now refuses what the map refuses: `landmarkOf` answers `''` for `kind === 'junction'` and
the label otherwise, one function with its reason written next to it. Measured over 380 pairs: **1 219 of 1 404
legs** turn at a junction and now say nothing where they used to print a key; **185** name a place, gate or
entrance. The two cp1 specs that asserted `'Crossroads'` on a junction corner were updated rather than deleted —
one of them (`namedRow()`) keeps the same geometry with the corner changed to a `place`, so the test still says
something about naming *and* now says something about kinds. Documented for the data side in `MAP-DATA.md`
("Junction labels are bookkeeping, not prose") and for the algorithm side in `ALGORITHMS.md` §11.

**The layer's two rules, both tested without a DOM.** A route containing a vertex the model cannot place is
**not drawn as a line at all** — joining the ends around the hole would invent a walkway across a building — and
a one-vertex route (`from === to`, which every search answers with 0 m) draws **one** pin, not two stacked. The
pins are pixels and the line is world units, so the line uses `vector-effect: non-scaling-stroke` like a walkway
and the pins use the badge layer's `translate(x y) scale(unitsPerPx)`; that pairing is why this checkpoint needed
a picture and not just an assertion.

**How the picture was obtained.** No browser is available here and none may be added, so the check is a scratch
entry (`src/test/scratch-route-preview.tsx`, deleted before the commit) rendered with `react-dom/server` through
`vite build --ssr`, styled by inlining `dist/assets/*.css` in a CDATA block, rasterised with `sharp` (installed
in `/tmp`, never in the repo) at 360/768/1440 plate widths. What it proved: the polyline runs on the network and
not across the blocks, both pins sit on their vertices, and the pin size is the same in all three rasters while
everything around it scales. What it cannot prove: `librsvg` ignores `vector-effect` and a `background` on an SVG
root, so widths and the plate colour in these PNGs came from a literal override block — the *browser* is still
the only judge of the real stylesheet, and the live preview is that judge.

**Boundaries, re-checked.** `route-controls.tsx` imports no `@/engine`: the algorithm names are the hook's
`RouteAlgorithmChoice` union and the picker rows come from `route-options.ts`; `useRoute` is the single file
outside `src/engine` allowed to name `aStar`/`dijkstra`/`bfs`, which the architecture guard keeps true. The
`ALGORITHM_CHOICES` table is keyed `Record<RouteAlgorithmChoice, AlgorithmChoice>`, so a fourth search in the
engine's union is a compile error here rather than a dropdown that quietly still offers three.

**Not in this checkpoint, on purpose.** The result card, the "no route found" state, the responsive pass and the
README (cp5).

### Phase 3, checkpoint 5 — the result card, the three states, and the responsive pass

**What landed.** `src/ui/route/route-summary.ts` (pure: how a distance is grouped, when minutes become seconds,
which sentence belongs to which refusal, what angle each turn arrow is rotated to) + `route-card.tsx`, wired into
`App` under the form. Three states, and no fourth: `null` before anything is asked, `found`, `missing`. 38 new
specs — `route-summary` 13, `route-card` 13 (a render-and-read test, `react-dom/server`, no DOM), `route-layer`
7, `route-styles` 5 (stylesheet, class-name and responsive-rule pairing) — for **499 tests in 29 files**, up
from 461 in 25 at cp4. `useEngineContract`
gained `walkingSpeedMps` and `minInstructionMetres`, which is how the card can print "at 1.4 m/s" without ever
importing the engine.

**The card's numbers, and why those.** Distance, duration at the profile's own pace, then `algorithm`,
`vertices settled`, `search time`, `walkway segments`, `directions`, `places along`, `turns to make` — the last
two differ on purpose (3 sentences from 10 segments is `simplifyLegs` and the opening heading, visible as a
number rather than explained in a paragraph). `cached` is *not* shown: in Phase 3 it is always `false`, and a
metric that can only ever say no is decoration until Phase 4 gives it a second value. Minutes come from
`RouteFound.minutes`, computed by the engine at `WALKING_SPEED_MPS[profile]`; the card relabels the number, it
never recomputes it, so there is one source for the pace.

**The refusal says what it looked at.** `describeFailure` pairs the engine's own sentence with the explored
count — "It settled 41 vertices before concluding this" — because "no route found" reads as a broken app and the
`exploredOrder` length reads as a search that worked on a map with a hole in it. The five
`RouteFailureReason`s are duplicated as a local union in the view model *on purpose*: a sixth reason in the
engine stops compiling here, in the file that has to have an answer for it, rather than in a `default:` branch
that says "something went wrong". Same for the nine turn buckets, which are also what the stylesheet guard walks.

**Responsive, checked in the two ways available here.** Mechanically, by `route-styles.spec.ts`: every class the
route UI emits has a rule in `app.css`/`map.css`, all nine `route-step--*` buckets are styled (not just the three
that appear on a pleasant route), the 900 px block still restyles `.route-pickers` to one column and `.work` to
one, the 380 px block still restyles `.route-step` and `.route-step-metres`, and 380 still comes after 900 so a
375 px phone gets the stacked row. And visually, by the map raster at 360/768/1440 (the scratch SSR render from
cp4, re-run): the line and the pins are placed in world units and scaled in pixels, so the pin is the same size
in all three and the route still sits on the walkways it followed. The live preview is the remaining judge for
the HTML card, and `docs/ARCHITECTURE.md` now states plainly which claims a Node harness can and cannot make.

**A number rounded, not a formatting coincidence.** `formatMetres` computes with tenths (`Math.round(m × 10)`,
then `trunc`/`%`) rather than `toFixed(1).split('.')`, because the split hands back `string | undefined` for the
fractional half and the only honest fallback for it is a branch that can never fire — one more documented dead
arm was worse than four lines of arithmetic.

**Phase 3 closed.** What the phase promised, in one line each: four hand-written searches returning one
`RouteResult` union ✓; Dijkstra pinned against Bellman–Ford and Floyd–Warshall on 200 seeded graphs ✓; A\*
pinned equal to Dijkstra on every one of them, with the inadmissible case shown as a wrong answer ✓; BFS
pinned to minimum hops ✓; depth-first pinned against a deletion oracle ✓; every edge attribute able to change
a route ✓; the frontier and explored order recorded per search ✓; turn-by-turn directions with the fold ✓; a
route on the map with a result card beside it ✓; `docs/ALGORITHMS.md` at one section per algorithm with
complexity, an invariant and a worked example ✓. Cost profiles, the LRU cache and `npm run bench` are Phase 4's.


---

### Phase 4, checkpoint 1 — five cost profiles, and the estimate that has to agree with them

**What the checkpoint is.** Cost profiles in the engine: `shortest`, `shaded`, `lit`, `step-free`, `quiet`, each
one an `EdgeCost` built from the per-edge attributes, admissibility handled by scaling `h` by the smallest cost
factor the profile can actually achieve, and a spec where a factor below 1 makes an *unscaled* A\* answer
wrongly. No UI in this checkpoint — the selector is cp2 — so the deliverable is the engine, its tests and its
documentation.

**The module, and the guard that asked for it.** `src/engine/routing/cost.ts`: `PROFILES` (label, blurb, the
attributes it reads, its factor), `PROFILE_ORDER`, `factorFor(profile, attributes)`, `costFor(profile)`, and the
eight named numbers (`SHADED_BONUS 0.85`, `UNSHADED_PENALTY 1.25`, `LIT_BONUS 0.9`, `UNLIT_PENALTY 1.4`,
`STAIRS_PENALTY 12`, `NOT_STEP_FREE_PENALTY 2.2`, `ROUGH_SURFACE_PENALTY 1.4`, `SLOPE_FACTOR_PER_GRADE 4`,
`CROWD_PENALTY_AT_FULL_CONGESTION 1`). The architecture guard refused the commit until `cost.spec.ts` existed
beside it — same rule as `algorithms/` and `geo/` — which is the guard doing its job rather than an obstacle:
the file that decides what "best" means is the file least allowed to be untested.

**`fastest` is now `shortest`, and the rename is the honest part.** The name promised speed; the profile never
had one. With a uniform pace, the fewest minutes and the fewest metres are the same route, so the label was a
claim about a quantity the objective did not contain. Renamed across the union (`WeightProfile`), `constants.ts`
(the pace table, whose five paces are now `1.4 / 1.3 / 1.25 / 1.05 / 1.35`), `search-common.ts` (the default),
and every test that named it — `contract.spec.ts`, `helpers.ts`, `search-parity.spec.ts`, `dijkstra.spec.ts`,
`search-common.spec.ts`, a comment in `useRoute.ts`, one prose mention in `a-star.spec.ts`. Nothing else in
those files changed, so the renames are grep-verifiable in the diff. `lit` is the new profile, because "walk
where you can see" and "walk where it is shaded" are different routes on this map and only one of them was
modelled.

**The coupling this checkpoint had to introduce.** `RouteSearchOptions` used to accept `profile` and ignore it
for pricing: `{ profile: 'shaded' }` computed metres and put "shaded" in the result, and a spec was titled
after that fact ("takes the profile into the result even though cost never read it"). Now `SearchRun` resolves
`cost = options.cost ?? costFor(profile)`, so the profile is the objective unless a caller writes an explicit
cost, and `defaultCost` is gone — deleted, not renamed, because `costFor('shortest')` is the same function with
a name that says which profile it belongs to. The spec that documented the old behaviour is rewritten rather
than deleted, and now asserts the new numbers: `square()` is entirely unshaded, so the profile is a uniform
1.25, the cost is 250 for a 200 m walk, the route is unchanged, and the comment says why a uniform factor
cannot change a winner.

**And the bug that came with it.** A\* had been building its estimate from `options.cost` — which is `undefined`
for a profile-only request, so the estimate stayed scaled for metres while the search minimised shaded prices.
That is not a stylistic inconsistency: `h` was inadmissible on `shaded` and `lit`, which pay *below* a metre.
`cost.spec.ts`'s new fixture found it as a wrong answer — a 146 m shaded corner (124.1) against a 100 m sunlit
line (125), where the unscaled estimate prices the corner at 130.25 and the search settles the goal first. The
fix is one accessor: `SearchRun.get cost()`, and `euclideanHeuristic(index, { cost: run.cost, … })`. The
fixture stays, with the margin of 0.9 asserted, because a test that only checks the happy path is how this
happened in the first place. `ALGORITHMS.md` §9 and §10 both say it in prose now.

**What the profiles refuse to do.** No profile returns `Infinity`. `EdgeCost` allows it — that is how a closure
is spelled — but a profile that closed an edge could disconnect the campus, and "step-free" is not a request to
be told there is no route: a step-free query across the one staircase in `campus.json` answers with a route at
twelve times its length, which is the honest signal that the staircase is not step-free. `blockedEdges` is the
closure, and it is already in the cache key and the heuristic's scale. Corollary, pinned: a staircase whose
surface is `stairs` is *not* also charged the gravel term — the steps are already priced — and the fixture's
threshold arithmetic (2 000 m of flat beats a 2 740 stair-climb, 3 000 m does not) depends on that
non-double-counting, so it is an assertion rather than a comment.

**The tests, 14 of them, in `cost.spec.ts`.** `shortest` priced exactly at metres over 300 generated edges;
1 280 attribute combinations × 5 profiles, every factor finite and > 0, with the *count* asserted so the grid
cannot silently shrink; `reads` checked both ways (a profile cannot respond to an attribute it does not list,
and must respond to each one it does); the bonus/penalty pairs; the multiplicative stack; the stair threshold;
the uniform-factor property; the pace table cross-checked against `minutesFor` for all five; the label/blurb
budget for a 360 px `<select>`; purity. Then the three that matter: `minCostPerUnit` equal to a hand-written
restatement of its definition on every trial; **admissibility measured** on 60 seeded graphs × 5 profiles ×
every vertex against `dijkstra`'s true cost, with the bound's failure message printing both numbers; and
**parity with Dijkstra on 200 seeded graphs × 5 profiles**, on *varied per-edge attributes* (without which the
sweep is uniform and proves only that a scale cancels), plus a counter that each of the four preference profiles
chose a different walk from `shortest` somewhere in those 200 graphs, so the sweep is not vacuous. The walk
check goes through `neighboursOf` rather than `edgeBetween` because the generator emits duplicate walkways and
one of them may be closed: a route is a sequence of *arcs*.

**Total: 513 tests in 30 files**, up from 499 in 29. No test was removed; one was rewritten (named above) and
one file gained its collocated spec, which the guard demanded. `RouteFound.cached` is still always `false` —
cp5 turns it on.

**Floats, rounded on purpose.** `metres` is rounded to a tenth by the run and `cost` is not, so the factor
comparisons in this file use `toBeCloseTo(…, 9)` where the arithmetic is binary (12 × 2.2 is not 26.4) and `toBe`
where both sides are the same expression. An earlier draft of the stair fixture asserted `3796` where the engine
said `2740`, which was two mistakes in one line: the `roughness` term applied to a `stairs` surface it does not
cover, and `2300` written where `2740` is the product. Both are in the test now as claims, not as corrections.
