# The campus dataset

`src/data/campus.json` is the only place that says where anything is. Everything else in
the app — the map, the graph, the router, the search index — is derived from it.

It is loaded as a **bundled import** (`src/data/index.ts` → `import campusJson from
'./campus.json'`). Not fetched: there is no server, and a bundled dataset means the app
still works with the Wi-Fi off. The architecture test fails any `fetch(` in shipped code
to keep that true.

## Coordinate system

| Thing | Space |
| --- | --- |
| node `x`,`y`, building `footprint`, surface `ring` | world units = SVG user units, origin top-left, +y down |
| `canvas.width/height` | the viewBox, i.e. the drawing extent |
| `canvas.pixelsPerMetre` | the one bridge to reality: `metres = worldUnits / pixelsPerMetre` |
| edge `metres` | distance along the walkway; omitted ⇒ derived from the two nodes and the scale |

`metadata.scaleSource` records *how* the scale was obtained (`none`, `two-point-calibration`
from the map editor, `survey-plan`, `gis`). Distances are only as trustworthy as that field,
which is why the UI shows it.

## Two graphs' worth of information in one file

Only `nodes` + `edges` become the routing graph. `buildings` and `surfaces` are **draw-only**:
polygons a person uses to recognise where they are. The engine never sees them, which is how
the file can hold a rich picture without the algorithms carrying dead weight.

A building is connected to the network through `entryNodeIds`. "Route to the library" means
"route to its entrance node", so a destination that is not on the walkway graph is a
data error, not a routing failure — that is a validation rule.

## Fields

| Block | Required | Notes |
| --- | --- | --- |
| `schemaVersion` | ✓ | string; the builder refuses a major it cannot read |
| `metadata` | ✓ | app + campus identity, provenance, `dataStatus` |
| `canvas` | ✓ | extent + scale, plus optional `referenceImage` for the traced-over raster |
| `zones[]` | | id/label/colour; used for grouping and flood-fill, not for routing |
| `nodes[]` | ✓ | vertex; `kind: junction \| place \| gate \| entrance` |
| `edges[]` | ✓ | walkway segment; `attrs` hold the only routing-relevant facts |
| `buildings[]` | | footprint ring + entrances |
| `surfaces[]` | | lawn / water / plaza / parking / construction |

`node.kind !== 'junction'` is what makes a node searchable — there is no separate POI
table, so a place cannot exist in search but be unreachable on the map. `aliases[]` is
where "BCA", "lib" or "Amrita Viha" live so the trie can find them.

`edge.attrs`: `stairs`, `stepFree`, `shaded`, `lit`, `crowd` (0–1), `surface`, `slope`.
Those flags are the entire mechanism behind the profiles; a new profile is a new cost
function over them, not a new algorithm.

## Validation (Phase 2, `npm run map:validate`)

Errors, i.e. build-breaking: unknown node/edge ids, self-loops, duplicate ids,
`metres <= 0` or non-finite coordinates, `crowd` outside 0–1, an edge whose endpoints are
both non-junction places, a building with no reachable entrance.

Warnings: isolated nodes, a node outside the canvas, a disconnected component (reported
with its size — union-find answers that in near-linear time), a building whose footprint is
not a simple ring.

## Replacing the placeholder with the real campus

The swap is one file and no code changes, which is the whole reason the schema exists:

1. Phase 2 ships a synthetic-but-plausible Amrita Bengaluru layout so routing can be
   developed and tested before anyone traces anything.
2. Phase 7's map editor is the real authoring tool: load a campus image, set the scale
   against a known distance, click nodes onto paths, drag edges between them, validate,
   then export a `campus.json` that replaces this one.
3. Hand-editing JSON stays possible — the file is small, flat and commented in this doc —
   but nobody should have to do it to place a building.

Until step 2 runs, `metadata.dataStatus` is `synthetic-placeholder` and the header says so.
The badge reads the field, so it disappears on its own once real data lands; the app cannot
silently pretend to be showing a surveyed campus.
