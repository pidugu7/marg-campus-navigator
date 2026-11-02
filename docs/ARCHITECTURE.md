# Architecture

Two halves with a one-way door between them.

```
  campus.json  ──►  build-graph.ts  ──►  engine Graph (plain data)
  (data)             (data)                    │
                                               ▼
                                          routing + algorithms
                                               │
  React components  ◄──  src/hooks  ◄──  RouteResult / index overlay
  (SVG, panels)            (the door)
```

## Layers

| Layer | May import | May never import |
| --- | --- | --- |
| `src/engine/` | itself (relative paths), `vitest` in its own specs | React, DOM/`document`, `node:*`, `src/data`, `src/ui` |
| `src/data/` | `@/engine` **barrel only** | `src/ui` — data does not know a screen exists |
| `src/hooks/` | `@/engine` **barrel only**, `@/data` **barrel only**, react | deep paths into either |
| `src/ui/`, `src/App.tsx` | `@/hooks`, `@/data` **barrel only**, react | `@/engine` (go through a hook) |

Direction is strictly downward. The engine is a leaf: it has no imports pointing back
out, which is what makes it testable and reusable without a DOM.

### Inside `src/ui`: pure modules, components that only draw, and one that renders in Node

The map is split a second time, on a different axis: **geometry scales with the plate, screen objects
do not.** `view.ts` (the camera), `marker-plan.ts` (who gets a label), `tip-content.ts` (what a tooltip
says), `icons.ts` (which glyph means what), `route-plan.ts` (which vertices of a route can be plotted)
and `route/route-options.ts` + `route/route-summary.ts` (what the pickers offer, and how a number is
written) are plain functions over numbers and strings, and they are in `coverage.include` beside the
engine, because a decision that can be reasoned about can be tested.

Since Phase 3 cp5 the list also holds three `.tsx` components — `route/route-card.tsx`,
`route/route-controls.tsx` and `map/layers/route-layer.tsx` — because `react-dom/server` is already a
dependency and `renderToStaticMarkup` needs no DOM: a component whose *output* is assertable is a
component whose statements are measurable. Two of them are at 100 %; `route-controls.tsx` is at 77.77 %
and stays in the list at that number, because its two uncovered lines are `onChange` arrows that only a
*dispatched* event runs — the gap is the honest shape of what a Node-only harness can reach, and taking
the file out of the report would hide that rather than say it. `src/test/route-styles.spec.ts` adds the
check the markup cannot make: every class name the route UI emits has a rule in a stylesheet.

What stays excluded by name is the gesture and effect code — `use-viewport.ts`, `use-tooltip.ts` and the
map layers whose behaviour is `getBoundingClientRect`, `ResizeObserver` and focus — with the reason in
`vite.config.ts` rather than quietly omitted from the number. Adding jsdom would buy the rest; it would
also be a new dependency in a project whose dependency list is itself under test, so it is out of scope
and said so.

## What `npm test` proves

`src/test/architecture.test.ts` scans source text (comments and string literals stripped
first, so the scanner chokes on code rather than prose) and fails on:

1. **engine independence** — an engine file importing anything non-relative; any
   `document` / `window` / `HTMLElement` / `React` / `useState` identifier inside
   `src/engine`; a `.tsx` file there at all; runtime values in `types.ts`.
2. **boundary direction** — a component importing the engine instead of a hook; anyone
   reaching past a barrel. Both public surfaces are policed the same way (`@/engine` and
   `@/data`), for any file outside the layer that owns them, with the specifier resolved
   through the alias *and* relative forms — so `@/data/build-graph` and `../engine/graph`
   fail as loudly as `@/engine/algorithms`. That widened rule exists because the map's
   layers needed to name `GraphNode`: the answer was for `src/data` to re-export the type,
   not for the UI to reach sideways. Direction stays one-way, `ui → data → engine`, and a
   type is a smaller thing to hand over than a function would be.
3. **offline guarantee** — `fetch(`, `XMLHttpRequest`, `axios`, `WebSocket`,
   `EventSource`, `sendBeacon` anywhere in shipped code. The dataset must arrive by
   `import`, which is also asserted.
4. **dependency policy** — `dependencies` ⊆ {`react`, `react-dom`, `lucide-react`} plus
   self-hosted font packages; no package in either dependency block matching the
   algorithm denylist (`graphology`, `ngraph`, `fastpriorityqueue`, `js-priority-queue`,
   `heap-js`, `trie-search`, `dijkstra`, `pathfinding`, `union-find`, `lru-cache`,
   `mnemonist`, `geolib`, …); and a drift check that ESLint's ban list still mirrors the
   test's.
5. **live since Phase 1** — every module under `src/engine/{structures,algorithms,routing,geo}`
   must have a spec named after it, beside it (`structures/trie.ts` → `structures/trie.spec.ts`) or
   in `src/engine/__tests__/`. `.spec.ts` is the convention for new engine files; `.test.ts` still
   counts, so nothing can silently stop being covered by changing extension.

`src/test/**` is exempt from the identifier scans in rule 1 and the network scan in rule
3: the scanner must name the things it forbids, so it would trip over its own vocabulary.
The import and dependency rules do apply to it.

The same bans exist in `eslint.config.js` so the editor complains immediately. The test is
the authoritative one: ESLint can stop an import, but only a test can read `package.json`
and refuse the dependency in the first place.

## Why the engine takes a cost function instead of a profile name

`routing/cost.ts` maps each `WeightProfile` to a *factor* over one edge's attributes, and the searches accept
`(index, from, to, { cost?, blockedEdges?, profile? })`. `shortest`, `shaded`, `lit`, `step-free` and `quiet`
are therefore five weightings of one graph rather than five searches, and a new profile is a factor function
plus a test — never a new algorithm, and never a re-weighted copy of the graph (the graph is built once, sealed,
frozen and shared; a profile is a *view* of it, so switching preferences between two searches costs nothing and
cannot leave a stale weight behind).

The layering has one subtlety worth naming, because Phase 4 found it as a bug rather than as a design note.
`profile` and `cost` are two spellings of one decision, so exactly one place resolves them: `SearchRun` picks
`options.cost ?? costFor(options.profile ?? 'shortest')`, and A\* multiplies its Euclidean estimate by
`minCostPerUnit` measured under `run.cost` — the same resolved function. If the heuristic were instead built
from `options.cost`, a request with only a profile would minimise shaded prices while estimating metres, and
`h` would over-reach on any profile that pays a bonus. `src/engine/routing/cost.spec.ts` pins the failure with a
146 m shaded corner against a 100 m sunlit line, so the coupling survives a refactor that looks like a
simplification. The rule for anyone extending this: **a cost function reaches a search through `profile` or
through `cost`, and everything downstream — relaxation, estimate, cache key — reads whichever the run settled
on.**

`structures/graph.ts` exposes `GraphIndex` (adjacency + precomputed components) as an
interface, so algorithms never depend on the concrete layout. A CSR array layout can be
swapped in later without touching Dijkstra.

## Deliberate omissions

- **No floor axis.** The campus is modelled single-level, so `GraphNode` has no `z` and
  every signature stays 2D. Vertical movement, if it ever returns, would be edges with
  `attrs.stairs`/`lift` between nodes of different zones, not a third coordinate.
- **No state library.** `useReducer` + context is enough for one screen of selection
  state; a store would be a dependency to explain, not to use.
- **No `fetch`, no service worker, no tiles.** Everything the app knows is in the bundle.
  A demo that depends on the network is a demo that fails in a lecture hall.
