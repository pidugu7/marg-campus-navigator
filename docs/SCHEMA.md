# `campus.json` — schema reference (v1)

Normative description of the one file that describes the physical campus. This document and
`src/data/campus.types.ts` are the same statement in two media: the types are what the compiler
enforces, this file is what a person editing data at 11 p.m. reads. `docs/MAP-DATA.md` covers the
workflow (how the file gets made and replaced); this one covers what may legally be in it.

Everything here is enforced by `npm run map:validate` (`src/data/build-graph.ts`), which is the
only code that reads `campus.json`'s values. The React app imports it through `src/data/index.ts`.

## Shape at a glance

```jsonc
{
  "schemaVersion": "1",        // string, not a number — see "Version"
  "metadata": { … },           // identity + provenance
  "canvas":   { … },           // extent + scale, the only unit conversion in the app
  "zones":    [ … ],           // named areas, for colour and grouping
  "nodes":    [ … ],           // graph vertices; anything that is not a junction is also a place
  "edges":    [ … ],           // walkway segments between nodes
  "buildings":[ … ],           // draw-only footprints, each with its entrances
  "surfaces": [ … ]            // draw-only ground: lawn, water, plaza, parking, construction
}
```

`nodes`, `edges`, `metadata`, `canvas`, `schemaVersion` are required. `zones`, `buildings` and
`surfaces` may be empty arrays: routing works without a single building drawn, which is what makes
a first digitising pass ("just the paths") a legitimate intermediate state to commit.

## Coordinates and units

World space is the SVG user space: origin at the top-left, `+x` east, `+y` south. No latitude, no
longitude, no rotation. `canvas.pixelsPerMetre` is the only scale factor; with `1`, one user unit
is one metre and every number in the file reads as a distance.

Keeping the drawing space and the routing space identical is deliberate: the map never needs a
transform to place a node marker, and a walkway polyline on screen *is* the graph edge. The cost is
that a traced raster has to be resized before it is referenced — that is what
`referenceImage.scale` is for, and the Phase 7 calibration step exists to fill it in.

## `schemaVersion`

A string, compared by major: `"1"` is read, `"2.0"` is refused with `schema-version` naming both
the file's version and the builder's. Strings rather than numbers so a future `1.4` never meets
floating-point comparison.

## `metadata`

| Field | Type | Notes |
| --- | --- | --- |
| `app` | string | Product title. Kept in data so renaming the app is not a code change. |
| `campus` | string | Institution name as it should appear in the masthead. |
| `campusShort` | string | Narrow-width form for 360 px screens. |
| `location.city` / `.state` / `.country` | string | Provenance only. Never used by routing. |
| `location.latitude` / `.longitude` | number? | Optional, provenance only — a centre point, not a geocode. |
| `scaleSource` | string | Where `pixelsPerMetre` came from: `none`, `calibrated`, `survey-plan`, `gis-export`, or prose. Every distance in the app is only as honest as this field, so the UI repeats it instead of hiding it. |
| `dataStatus` | string | `synthetic-placeholder` \| `digitised` \| `surveyed`. Loose on purpose; `src/data/index.ts` exports `DATA_STATUSES` and the validator checks membership. |
| `authoredBy` | string | Who to ask when the geometry looks wrong. |
| `updatedAt` | string | ISO date. Displayed next to the status badge. |
| `notes` | string | Free text. Used for caveats a reader must not miss. |

`dataStatus` drives the banner in the UI: a placeholder campus must never be presented as fact.

## `canvas`

| Field | Type | Notes |
| --- | --- | --- |
| `width`, `height` | number | World-space extent. Becomes the SVG `viewBox`. Must be finite and positive. |
| `pixelsPerMetre` | number | Units per metre. `> 0`, finite. 1 means 1 unit = 1 m. |
| `referenceImage` | object? | `{ src, scale, offsetX, offsetY, opacity }` — the raster the geometry was traced over, rendered behind everything at `opacity`. `scale` is image pixels per world unit. |

A node outside `[0,width] × [0,height]` is warning `outside-canvas`: it will be invisible after the
view clamps to the canvas, so the map cannot show a route to it.

## `zones[]`

`{ id, label, color }`, all required. `color` is a CSS colour used by the legend, the zone tint
under buildings, and flood-fill highlighting on hover. Zones are a **name space**: nothing about
routing reads them. A `zone` value on a node or building that is not listed here is error
`unknown-zone`, because an unlisted zone cannot be coloured and the legend silently loses an entry.

## `nodes[]`

One array for both graph vertices and searchable places. There is no POI table: a place that is
not a vertex cannot be routed to, and modelling them separately is how the two drift apart.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique across the whole file. Non-empty, no spaces. Referenced by `edges` and `buildings`. |
| `label` | string | What the map and search results show. Junctions are usually left unlabelled by the renderer, not by the data. |
| `kind` | string | `junction` \| `place` \| `gate` \| `entrance`. Anything else is error `bad-kind`. |
| `x`, `y` | number | World units. Must be finite (error `bad-number`). |
| `zone` | string? | Must name a `zones[].id` if present. Absent → warning `missing-zone` (legend and hover grouping skip it). |
| `category` | string? | Only meaningful for non-junction kinds; feeds search ranking and the icon badge. Free-form; the renderer maps the ones it knows and falls back to a generic icon. |
| `aliases[]` | string? | Alternate spellings and abbreviations ("lib", "mess", "Amrita Viha"). Inserted into the trie alongside the label. |
| `minor` | boolean? | Zoom staging hint: no label until the viewer is close enough to want one. Draw-only — never affects search or routing. |
| `tags[]` | string? | Unstructured notes (`"door"`, `"24x7"`). Ignored by routing, shown in the tooltip. |

**`kind` semantics.** `junction` is a point on the path network and is deliberately *not*
searchable. `place` is anything a person types into search. `gate` is a place that is also a campus
boundary — the only kind the router treats as a possible start/end when someone says "from the
gate". `entrance` is a door: a vertex the path ends at, usually listed in a building's
`entryNodeIds`. All three non-junction kinds are searchable; only `junction` is invisible to
search.

## `edges[]`

A walkway segment. Undirected unless `oneWay` is set, in which case it is passable only
`from → to`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique. Convention in this repo: `e-<from>--<to>`; the validator does not require it. |
| `from`, `to` | string | Node ids. Unknown id → error `unknown-ref`; equal → error `self-loop`. |
| `metres` | number? | Stated length. Omit to derive. Finite and `> 0` when present (error `bad-number`). |
| `oneWay` | boolean? | Default `false`. |
| `attrs` | object? | The routing-relevant facts below. Absent means all defaults. |

### Lengths: derived, stated, and when they disagree

`metres` is derived from the endpoints as `hypot(dx, dy) / pixelsPerMetre`, rounded to one decimal,
when the file omits it. An explicit `metres` always wins: a path that switchbacks over a stream is
longer than the straight line between its endpoints, and the person who measured it is right. If a
stated length differs from the derived one by more than 15%, the validator warns `length-mismatch`
and quotes both numbers — that gap usually means a node was moved and its edges were not re-measured.

### `attrs`

Defaults are what an unremarkable paved footpath looks like; only deviations need to be written, so
the file stays readable by hand.

| Field | Type | Default | Meaning, and who reads it |
| --- | --- | --- | --- |
| `stairs` | boolean | `false` | Steps on this segment. `avoid-steps` removes it from the graph entirely (Phase 4). |
| `stepFree` | boolean | `true` | Whether a wheelchair and a rolling suitcase can take this segment. Independent of `stairs` in one direction only: `stairs: false, stepFree: false` is a legitimate judgement (cobbles, a kerb, a steep ramp), but `stairs: true, stepFree: true` claims steps and no steps at once → error `bad-attr`. |
| `shaded` | boolean | `false` | Cover from sun. Only a cost input, for the `midday` profile. |
| `lit` | boolean | `true` | Lit at night. Only a cost input, for the `night` profile. |
| `crowd` | number | `0.2` | Expected congestion, `0..1`. Outside that range → error `crowd-range` (never clamped: a clamp turns a typo into a plausible-looking route). |
| `surface` | string | `paved` | `paved` \| `covered` \| `gravel` \| `grass` \| `stairs`. Cost multiplier in Phase 3; the renderer also draws `grass`/`gravel` as dashed. |
| `slope` | number | `0` | Signed rise/run as a fraction (`0.05` ≈ 3°). Uphill in the direction of travel costs more; `slope: -0.05` on the reverse traversal of the same segment is the *same* physical hill, so Phase 3 reads it as an absolute value per direction. |

`stairs: true` should be paired with `surface: "stairs"` and `stepFree: false`. The validator does
not require the pairing — a single step at a doorway is `stairs` with a `paved` surface — but the
renderer draws `surface`, so an unpaired flag looks wrong rather than being wrong.

## `buildings[]`

Draw-only: the engine never receives them. A footprint is how a person recognises where they are.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique. |
| `label` | string | Drawn inside the footprint. A building and its entrance node show **one** label, not two: the renderer suppresses a place's own label when it is the sole entrance of a building. |
| `zone` | string? | Tint source; falls back to the entrance node's zone. |
| `footprint` | `number[][]` | Closed ring of `[x, y]` pairs, first point not repeated at the end. Fewer than 3 points, a ragged point, or a non-finite number → error `bad-ring`. Self-intersecting → warning `non-simple-ring` (it renders as a hole, which is almost never intended). |
| `entryNodeIds[]` | string | Vertices that put you *inside* this building. Empty → error `no-entrance`. Unknown → `unknown-ref`. One that has no incident edge → error `entrance-unreachable`, because "route to the library" then has no last hop. |
| `levels` | number? | Informational only in this build: the app models one outdoor level, so `levels` is drawn in the tooltip and never used to filter. |

A building may list several entrances (`library` + `library-door` in the shipped file). Routing picks the closest one to the origin; the others stay in the file so the map shows every real door.

## `surfaces[]`

`{ id, label, kind, ring }`, `ring` in the same `[x, y]`-pair shape as a footprint, with `kind` one of `lawn | water | plaza | parking | construction`.
Draw-only ground that is not a building. `water` and `lawn` are areas paths should not cross —
visually only; a walkway that does is a data problem for the human reading the map, which is why
`crossings` are never validated across a surface. `plaza` and `parking` are hardstanding and are
expected to sit under the network. A surface may have no node attached at all (`North Lawn` in the
shipped file): the base layer is allowed to carry geography the router does not know.

## Invariants

1. Every id is unique across nodes, edges, buildings, surfaces and zones — one flat name space, so
   `unknown-ref` never has an ambiguous referent.
2. Every edge endpoint names a node.
3. The node graph is connected, or the validator says which component you have stranded and its
   size (warning `disconnected-component`, computed with the engine's union-find).
4. Anything that is not a junction has at least one edge, unless it is deliberately isolated and
   the warning is accepted (warning `isolated-node`).
5. `nodes.length > 0` and `edges.length > 0`, else error `empty-graph`: a campus with no walkways
   is a placeholder for a placeholder.

## Validation

`npm run map:validate` builds the graph and prints a report; any error exits `1`, warnings exit `0`
and are printed. The same rules run at build time through `src/data/build-graph.ts` — the CLI and
the app cannot disagree, because they are the same function.

| Code | Severity | Trigger |
| --- | --- | --- |
| `schema-version` | error | Major version the builder cannot read. |
| `missing-block` | error | A required top-level block absent or of the wrong kind. |
| `duplicate-id` | error | Any id repeated anywhere in the file. |
| `unknown-ref` | error | Edge `from`/`to` or `entryNodeIds` naming a node that does not exist. |
| `unknown-zone` | error | A `zone` value with no `zones[]` entry. |
| `bad-id` | error | An id that is empty, not a string, or contains whitespace. |
| `bad-number` | error | A non-finite or missing coordinate, or `metres` that is not a finite number > 0, or two nodes at one point where the derived length would be 0. |
| `bad-canvas` | error | `width`/`height`/`pixelsPerMetre` not finite and > 0. The canvas is the divisor of every derived length, so it is repaired to 1 unit = 1 m for the rest of the report rather than poisoning every edge with a second complaint. |
| `bad-kind` | error | `node.kind` outside the four values. |
| `bad-surface` | error | `surfaces[].kind` outside the five ground types, or `attrs.surface` outside the five walkway types. |
| `bad-attr` | error | An `attrs` flag that is not a boolean, `attrs` itself not an object, `slope` not finite or outside -1..1, or `stairs: true` together with `stepFree: true`. |
| `crowd-range` | error | `attrs.crowd` that is not a finite number in `0..1`. Reported here rather than left to the engine, which spreads attributes without checking them: a clamp or a pass-through would turn a typo into a plausible route, and the difference is what the `quiet` profile is graded on. |
| `self-loop` | error | `from === to`. |
| `no-entrance` | error | Building with an empty `entryNodeIds`. |
| `entrance-unreachable` | error | Entrance node with no incident edge. |
| `empty-graph` | error | No nodes or no edges. |
| `bad-ring` | error | Footprint/ring with fewer than 3 points or a non-finite number. |
| `disconnected-component` | warning | More than one component; message names the size and the first few stranded ids. |
| `isolated-node` | warning | Non-junction node with no edges. |
| `outside-canvas` | warning | Node outside `[0,width] × [0,height]`. |
| `missing-zone` | warning | Node or building with no `zone`. |
| `place-to-place` | warning | Both endpoints are non-junctions. Legal — a plaza between two buildings is real — but a route through it gets a vague turn instruction, and a *chain* of them usually means a junction is missing. |
| `length-mismatch` | warning | Stated `metres` more than 15% from the derived length. |
| `non-simple-ring` | warning | Footprint or surface ring that crosses itself. |

Every message reads `` <severity>: <code>: <what is wrong> [<id to fix>] `` — one line per issue, the
offending id quoted exactly as written so search-and-replace finds it, and a final
`N errors, M warnings (file)`. Issues are sorted errors first, then by code, then by id, then by text,
so two runs on one file produce a report that diffs cleanly.

### What is *not* reported

`validateGraph` from the engine is deliberately not called on this path. Its checks are either ones the
builder has already settled (ids, self-loops, lengths, coordinates) or ones it needs the file's canvas
and raw `attrs` for, so from here it could only ever print `duplicate-node-id` for a name the
`duplicate-id` line already named. It stays in the API for Phase 7's map editor, which holds a graph in
memory and never has a file: that is where a graph-level validator has work to do. The split is by
reachability, not by taste — a check that cannot fire is a check someone has to read and test.

### Cascade policy

A file is read once, and the read that matters is the *first* defect. So:

- a node with unusable coordinates is dropped, and every edge touching it is dropped **silently**:
  `edge "e-7" refers to node "fountain", which is not in "nodes"` would be describing the repair, not
  the file;
- a row that is not an object is reported at its index (`nodes[3]`) and skipped, rather than yielding
  one complaint per field about `undefined`;
- `isolated-node`, `outside-canvas`, `disconnected-component` and `entrance-unreachable` measure
  *completeness*. None is produced while any error exists, because dropping entries makes all four
  trivially true. Fix the errors and they are reported again, and then they mean something.

### Exit codes

`npm run map:validate` is a CI gate, so its numbers are part of the contract:

| Exit | Meaning |
| --- | --- |
| 0 | no errors (warnings pass, unless `--strict`) |
| 1 | at least one error; or warnings, under `--strict` |
| 2 | the file could not be read or parsed at all — "the checkout is wrong", which must not look like "the data is wrong" |

`--json` replaces the prose with `{ source, ok, issues, errors, warnings, summary }` on stdout alone,
and `--quiet` drops the summary header. `--help` prints the usage and exits 0.

## Why the TypeScript types are looser than this document

`campus.types.ts` describes the same object, but it cannot describe it exactly, and the gap is worth
stating rather than leaving for someone to rediscover: `resolveJsonModule` reads a `.json` file by
widening every string to `string` and every array to `T[]`. So a field declared `'place' | 'gate'`
in the types could never be satisfied by the imported file, and a `[number, number]` tuple is
unreachable for the same reason — the compiler is not looking at your JSON, it is looking at a
`string` and a `number[]`.

That is why the file's rule is mechanical: **the types declare only what a JSON file can prove.**
`kind`, `attrs.surface`, `surfaces[].kind` and `metadata.dataStatus` are `string`; `footprint` and
`ring` are `number[][]`. Every one of those is narrowed in `build-graph.ts` against the lists in this
document, which is where a violation becomes an issue with a code and an id in it. The consequence is
deliberate: bad data fails `npm run map:validate` with a sentence a data editor can act on, instead
of failing `tsc` with a 40-line assignability trace inside a file nobody edits.

## Minimal valid file

The smallest input the validator accepts, useful as a fixture when the rules are changed:

```json
{
  "schemaVersion": "1",
  "metadata": {
    "app": "MARG", "campus": "Test", "campusShort": "Test",
    "location": { "city": "-", "state": "-", "country": "IN" },
    "scaleSource": "none", "dataStatus": "synthetic-placeholder",
    "authoredBy": "test", "updatedAt": "2026-11-01", "notes": ""
  },
  "canvas": { "width": 200, "height": 100, "pixelsPerMetre": 1 },
  "zones": [],
  "nodes": [
    { "id": "a", "label": "A", "kind": "place", "x": 10, "y": 50 },
    { "id": "j", "label": "j", "kind": "junction", "x": 100, "y": 50 },
    { "id": "b", "label": "B", "kind": "place", "x": 190, "y": 50 }
  ],
  "edges": [
    { "id": "e-a--j", "from": "a", "to": "j" },
    { "id": "e-j--b", "from": "j", "to": "b" }
  ],
  "buildings": [],
  "surfaces": []
}
```

Three nodes and two edges is enough to prove a graph built, which is why no lower bound is enforced
beyond `empty-graph`. `zones: []` is legal, and yields one `missing-zone` warning per node rather than
an error: a routing graph does not need zones, only a coloured map does.
