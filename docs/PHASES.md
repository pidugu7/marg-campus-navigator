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
| **3** | BFS, DFS, Dijkstra, A\*, path post-processing, turn-by-turn | A\* ≡ Dijkstra ≡ brute-force oracle on every fixture pair; A\* expands ≤ Dijkstra; DFS cut-vertices verified by deletion |
| **4** | `router.ts`, cost profiles, LRU wiring, `scripts/bench.mjs` | profile switch changes the chosen route for a defensible reason; cache hit rate visible in the UI; benchmark table (with machine info) generated into `docs/ALGORITHMS.md` |
| **5** | search UX: trie typeahead, pick origin/destination, swap, algorithm + explored-region overlay | 3-char typeahead with keyboard nav; the explored overlay makes A\* vs Dijkstra visible side by side |
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
   side-effect imports like `@/styles/app.css`. The barrel-only rule for the engine lives in
   the test, where it can be precise about *who* is importing.
7. **`server.allowedHosts`/`preview.allowedHosts: ['.e2b.app']`** in `vite.config.ts`: the
   sandboxed live preview reaches the dev server through a proxied hostname that Vite's host
   check would otherwise reject. Harmless locally, required to demo here.

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

### Phase 2 — campus model, validator, map · in progress

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
