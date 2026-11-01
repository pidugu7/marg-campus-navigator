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
| `src/data/` | `@/engine` | `src/ui` — data does not know a screen exists |
| `src/hooks/` | `@/engine` **barrel only**, `@/data`, react | deep engine paths (`@/engine/algorithms/…`) |
| `src/ui/`, `src/App.tsx` | `@/hooks`, `@/data`, react | `@/engine` (go through a hook) |

Direction is strictly downward. The engine is a leaf: it has no imports pointing back
out, which is what makes it testable and reusable without a DOM.

## What `npm test` proves

`src/test/architecture.test.ts` scans source text (comments and string literals stripped
first, so the scanner chokes on code rather than prose) and fails on:

1. **engine independence** — an engine file importing anything non-relative; any
   `document` / `window` / `HTMLElement` / `React` / `useState` identifier inside
   `src/engine`; a `.tsx` file there at all; runtime values in `types.ts`.
2. **boundary direction** — a component importing the engine instead of a hook; a hook
   reaching past the barrel.
3. **offline guarantee** — `fetch(`, `XMLHttpRequest`, `axios`, `WebSocket`,
   `EventSource`, `sendBeacon` anywhere in shipped code. The dataset must arrive by
   `import`, which is also asserted.
4. **dependency policy** — `dependencies` ⊆ {`react`, `react-dom`, `lucide-react`} plus
   self-hosted font packages; no package in either dependency block matching the
   algorithm denylist (`graphology`, `ngraph`, `fastpriorityqueue`, `js-priority-queue`,
   `heap-js`, `trie-search`, `dijkstra`, `pathfinding`, `union-find`, `lru-cache`,
   `mnemonist`, `geolib`, …); and a drift check that ESLint's ban list still mirrors the
   test's.
5. **from Phase 1 onward** — every module under `src/engine/{structures,algorithms,routing,geo}`
   must have a spec named after it. This rule is live today and passes vacuously.

`src/test/**` is exempt from the identifier scans in rule 1 and the network scan in rule
3: the scanner must name the things it forbids, so it would trip over its own vocabulary.
The import and dependency rules do apply to it.

The same bans exist in `eslint.config.js` so the editor complains immediately. The test is
the authoritative one: ESLint can stop an import, but only a test can read `package.json`
and refuse the dependency in the first place.

## Why the engine takes a cost function instead of a profile name

`routing/cost.ts` builds an `EdgeCost` from a `WeightProfile`, and algorithms accept
`(index, cost, heuristic?)`. That keeps "shortest", "shaded", "step-free" and "quiet"
four *weightings of one graph* rather than four separate searches — and it is why a new
profile needs a cost function plus a test, not a new algorithm.

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
