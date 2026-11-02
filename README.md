# MARG Campus Navigator

**MARG Campus Navigator** is a 2D, offline-first campus navigation web app built as a
Data Structures &amp; Algorithms course project. The map is hand-drawn SVG; every
algorithm that makes it work is written by hand in this repo.

- **Campus modelled:** Amrita Vishwa Vidyapeetham, Bengaluru — Amrita Viha, Ede Village,
  Karnataka (the geometry is a hand-built synthetic layout, labelled as such in the UI;
  Phase 7's editor replaces it with a traced one and no code changes)
- **Stack:** React 19 + Vite 8 + TypeScript 5.9, Vitest 4
- **Backend:** none. The campus dataset is a bundled import, so the built app runs from
  any static host — and there is no network call to fail during a demo.
- **Algorithm libraries:** none. `package.json` is checked by a test, not by trust.

> **Current phase: 3 — routing.** The map routes. Pick a start and a destination and the walk is
> drawn over the walkways in indigo, with a green pin where you start and a coral ring where you stop,
> and the card beside it says how far, how long at 1.4 m/s, how many vertices the search settled, and
> every turn in order. Four searches are hand-written and interchangeable — Dijkstra, A\*, BFS and
> depth-first — with a `simplifyLegs` pass that keeps a 6 m stub from buying you a sentence. The data
> structures are written and tested, `npm run map:validate` checks `src/data/campus.json` against
> [docs/SCHEMA.md](docs/SCHEMA.md), and the SVG map pans, zooms (wheel and pinch), stages its labels
> by zoom level, shows an icon badge per place type and describes anything you hover, tap or tab to.
> **No cost profiles, cache or typeahead yet** — those are Phases 4 and 5. 498 tests; see
> [docs/PHASES.md](docs/PHASES.md) for what is real versus planned.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + lint + tests + build, in one command
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | run every unit + architecture test |
| `npm run map:validate` | checks `src/data/campus.json` against `docs/SCHEMA.md`; exit 0 clean, 1 errors, 2 unreadable file. `--strict` fails on warnings too, `--json` prints the issue list |
| `npm run test:coverage` | coverage report for the engine and the data layer (`coverage/`) |
| `npm run lint` | ESLint, including the "no graph libraries" ban |
| `npm run typecheck` | `tsc -b` over three projects (app, test, node) |
| `npm run build` | production build to `dist/` |
| `npm run build:single` | self-contained `dist-single/index.html` (JS+CSS inlined) |
| `npm run preview` | serve the built `dist/` locally |

`npm run preview` is how you look at a build. Opening `dist/index.html` directly with
`file://` does **not** work: the bundle uses `<script type="module">`, and browsers
block module/CORS loading from `file://`. This is a browser rule, not a config we can
turn off — so serve it, or hand in the `dist-single/index.html` artefact.

## The one rule that shapes everything

`src/engine/` contains all the coursework algorithms and knows **nothing** about React,
the DOM, or what a "building" is. It takes a plain graph object and returns plain objects.
`src/ui/` knows nothing about algorithms. The only door between them is `src/hooks/`.

`src/hooks/useRoute.ts` is the only module outside the engine allowed to name `dijkstra`, `aStar` or
`bfs`, and `src/ui/route/*` reaches it through props: a component can be rewritten, or the whole search
replaced by a cached router, without touching a line of algorithm.

This is not a convention; it is five executable tests in
[`src/test/architecture.test.ts`](src/test/architecture.test.ts) that fail the suite if
anyone (including future me) crosses the line. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Layout

```
src/engine/     hand-written structures + algorithms + router (pure TS, no React)
src/data/       campus.json + its schema + the adapter that turns it into a graph
src/ui/         SVG map layers, the route form and result card
src/hooks/      the only place the two halves meet
src/test/       architecture guards (the rules above)
docs/           architecture, algorithms, data schema, map-data workflow, phase log
```

## Documentation

| File | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | layers, data flow, import rules, why the split is enforced in code |
| [docs/ALGORITHMS.md](docs/ALGORITHMS.md) | per-structure notes: idea, invariants, complexity, measured results |
| [docs/SCHEMA.md](docs/SCHEMA.md) | `campus.json` field by field: units, defaults, derived values, the validation matrix |
| [docs/MAP-DATA.md](docs/MAP-DATA.md) | how `campus.json` gets made and replaced: digitising, calibration, editor export |
| [docs/PHASES.md](docs/PHASES.md) | phase plan, amendment ledger, per-phase log with verification output |

## Status

Phase 0 delivered the toolchain, the engine contract (`src/engine/types.ts`), the placeholder
dataset and the architecture guards. Phase 1 delivered the five hand-written structures in
`src/engine/structures/`, each with a spec that checks it against a naive reference model under a
fixed seed. Phase 2 delivered the synthetic campus file, the validator and the SVG map. Phase 3
delivered the four searches, the turn-by-turn directions pass and the route UI. Phases 4–8 — cost
profiles and the route cache with `npm run bench`, the trie typeahead and the explored-region overlay,
resilience analysis, the map editor, polish + Pages deploy — are tracked in
[docs/PHASES.md](docs/PHASES.md).

```ts
// The engine is usable as a package, and nothing in it knows React exists.
import { AdjacencyGraph, MinHeap, byPriority, createGraph } from '@/engine'
```
