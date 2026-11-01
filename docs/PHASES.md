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
| **0** | scaffold, engine contract, architecture guards, placeholder dataset | `npm run check` green; deps proven allowed; guard proven to fail on planted violations |
| **1** | min-heap, trie, union-find, LRU cache, adjacency index | unit tests per structure incl. invariants and property tests; no UI at all |
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
