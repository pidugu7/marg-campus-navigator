/**
 * `build-graph.ts` is the only place the app reads the data file's values, so this is the suite that
 * decides whether a typo in `campus.json` becomes a sentence or a stack trace. One case per issue code
 * in `docs/SCHEMA.md`, each asserting three things: the code, the severity, and that the message names
 * the id the editor has to go and find.
 *
 * Fixtures are built by patching one field of an otherwise clean file rather than by writing a whole
 * file per case, because "exactly this one issue and no others" is the interesting claim — a rule that
 * only fires once twelve other things are also broken proves nothing.
 */
import { describe, expect, it } from 'vitest'
import {
  MAP_SCHEMA_MAJOR,
  buildGraph,
  deriveMetres,
  formatCampusReport,
  isUsableId,
  validateCampusFile,
  campus,
  type CampusReport,
  type MapIssue,
  type MapIssueCode,
} from '@/data'

type Row = Record<string, unknown>
interface Fixture {
  schemaVersion: string
  metadata: Row
  canvas: Row
  zones: Row[]
  nodes: Row[]
  edges: Row[]
  buildings: Row[]
  surfaces: Row[]
}

/**
 * The smallest file that is legitimately a campus: two places, one junction between them, a block you
 * enter at one of them and a lawn under it. 190 m a hop, so lengths are derived rather than asserted.
 */
function base(): Fixture {
  return {
    schemaVersion: MAP_SCHEMA_MAJOR,
    metadata: {
      app: 'MARG',
      campus: 'Test Campus',
      campusShort: 'Test',
      location: { city: 'Nowhere', state: 'NA', country: 'IN' },
      scaleSource: 'none',
      dataStatus: 'synthetic-placeholder',
      authoredBy: 'spec',
      updatedAt: '2026-11-01',
      notes: '',
    },
    canvas: { width: 400, height: 300, pixelsPerMetre: 1 },
    zones: [{ id: 'core', label: 'Core', color: '#4f46e5' }],
    nodes: [
      { id: 'a', label: 'Place A', kind: 'place', x: 10, y: 150, zone: 'core' },
      { id: 'j', label: 'j', kind: 'junction', x: 200, y: 150, zone: 'core' },
      { id: 'b', label: 'Place B', kind: 'place', x: 390, y: 150, zone: 'core' },
    ],
    edges: [
      { id: 'e-a--j', from: 'a', to: 'j' },
      { id: 'e-j--b', from: 'j', to: 'b' },
    ],
    buildings: [{ id: 'b-a', label: 'Block A', zone: 'core', footprint: [[10, 90], [90, 90], [90, 150], [10, 150]], entryNodeIds: ['a'] }],
    surfaces: [{ id: 's-lawn', label: 'Lawn', kind: 'lawn', ring: [[300, 60], [380, 60], [380, 130], [300, 130]] }],
  }
}

const patchNode = (file: Fixture, id: string, patch: Row): Fixture => ({
  ...file,
  nodes: file.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
})
const patchEdge = (file: Fixture, id: string, patch: Row): Fixture => ({
  ...file,
  edges: file.edges.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge)),
})
const patchBuilding = (file: Fixture, id: string, patch: Row): Fixture => ({
  ...file,
  buildings: file.buildings.map((building) => (building.id === id ? { ...building, ...patch } : building)),
})
const patchSurface = (file: Fixture, id: string, patch: Row): Fixture => ({
  ...file,
  surfaces: file.surfaces.map((surface) => (surface.id === id ? { ...surface, ...patch } : surface)),
})
const addNode = (file: Fixture, node: Row): Fixture => ({ ...file, nodes: [...file.nodes, node] })
const addEdge = (file: Fixture, edge: Row): Fixture => ({ ...file, edges: [...file.edges, edge] })

/** The one issue with this code, with the whole report in the failure message for debugging. */
function issueFor(report: CampusReport, code: MapIssueCode): MapIssue {
  const found = report.issues.filter((issue) => issue.code === code)
  expect(found, `expected exactly one "${code}" issue; got ${report.issues.map((issue) => issue.code).join(', ') || 'nothing'}`).toHaveLength(1)
  const first = found[0]
  if (first === undefined) throw new Error('unreachable: the length assertion above already failed')
  return first
}

/**
 * Asserts the single issue a mutation must produce, and nothing else. Takes `unknown` rather than
 * `Fixture` because half the point of these cases is a file the *types* would not allow — a missing
 * block, a row that is null — and pretending the fixture type covers those would be testing my own
 * cast rather than the validator.
 */
function onlyIssue(file: unknown, code: MapIssueCode): MapIssue {
  const report = validateCampusFile(file)
  expect(report.issues.map((issue) => issue.code), `expected only "${code}"`).toEqual([code])
  return issueFor(report, code)
}

describe('the clean file', () => {
  it('passes with no issues at all', () => {
    expect(validateCampusFile(base())).toEqual({ issues: [], errors: 0, warnings: 0 })
  })

  it('falls back to the id for a place with no label, so the map never draws an empty tooltip', () => {
    const model = buildGraph({ ...base(), nodes: [{ id: 'unlabelled', kind: 'place', x: 30, y: 30, zone: 'core' }, ...base().nodes] })
    expect(model.graph.node('unlabelled')?.label).toBe('unlabelled')
    expect(validateCampusFile({ ...base(), nodes: [{ id: 'unlabelled', kind: 'place', x: 30, y: 30, zone: 'core' }, ...base().nodes] }).issues).toEqual([])
  })

  it('keeps an absent zone absent in the engine node, rather than writing undefined into it', () => {
    // The engine's `addNode` documents that `'zone' in node` is the test the UI uses, and
    // `exactOptionalPropertyTypes` is what makes that true. This is the round trip.
    const model = buildGraph(patchNode(base(), 'j', { zone: undefined }))
    expect('zone' in (model.graph.node('j') ?? {})).toBe(false)
    expect(model.graph.node('a')).toMatchObject({ zone: 'core' })
  })

  it('degrades a node with an unknown kind to a junction in the graph, while still reporting it', () => {
    // The error is the headline; the *map* still needs the point. `junction` is what the engine itself
    // defaults to for a node with no kind, so the two halves agree on the fallback rather than inventing
    // a fifth kind called "unknown".
    const model = buildGraph(patchNode(base(), 'a', { kind: 'building' }))
    expect(issueFor(model, 'bad-kind').severity).toBe('error')
    expect(model.graph.node('a')?.kind).toBe('junction')
    expect(model.summary.placeCount).toBe(1)
  })

  it('builds a graph the engine can actually traverse', () => {
    const model = buildGraph(base())
    expect(model.ok).toBe(true)
    expect(model.summary).toMatchObject({ nodeCount: 3, edgeCount: 2, placeCount: 2, componentCount: 1, zoneCount: 1 })
    expect(model.edges.map((edge) => edge.metres)).toEqual([190, 190])
    expect(model.graph.neighboursOf('a').map((entry) => entry.to)).toEqual(['j'])
    expect(model.graph.neighboursOf('j').map((entry) => entry.to)).toEqual(['a', 'b'])
  })

  it('keeps every node field the renderer needs and nothing the engine has no type for', () => {
    const model = buildGraph(base())
    expect(model.nodes.map((node) => node.kind)).toEqual(['place', 'junction', 'place'])
    expect(model.nodes[0]?.zone).toBe('core')
    expect(model.nodes[0]?.label).toBe('Place A')
    // `minor`, `aliases` and `tags` are file-level concerns: search reads them from `campus.json`, and
    // the engine's GraphNode has no room for them by design.
    expect(Object.keys(model.nodes[0] ?? {}).sort()).toEqual(['id', 'kind', 'label', 'x', 'y', 'zone'])
  })

  it("applies the engine's own defaults to an edge with no attrs block", () => {
    const model = buildGraph(base())
    expect(model.edges[0]?.attributes).toEqual({
      stairs: false,
      stepFree: true,
      shaded: false,
      lit: true,
      crowd: 0.2,
      surface: 'paved',
      slope: 0,
    })
  })

  it('carries an explicit metres and a one-way flag through untouched', () => {
    const model = buildGraph(patchEdge(base(), 'e-a--j', { metres: 250, oneWay: true }))
    expect(model.edges.map((edge) => [edge.id, edge.metres, edge.oneWay])).toEqual([
      ['e-a--j', 250, true],
      ['e-j--b', 190, false],
    ])
    // A one-way exit still touches both ends, which is what the map's highlight relies on.
    expect(model.graph.edgesAt('j')).toContain('e-a--j')
  })
})

describe('missing and malformed blocks', () => {
  it('reports a file that is not an object, once', () => {
    const report = validateCampusFile('not a campus')
    expect(report.issues.map((issue) => issue.code)).toEqual(['missing-block'])
    expect(issueFor(report, 'missing-block').message).toContain('single JSON object')
  })

  it('refuses to guess across a schema major it cannot read', () => {
    const issue = onlyIssue({ ...base(), schemaVersion: '2.0' }, 'schema-version')
    expect(issue.severity).toBe('error')
    expect(issue.message).toContain('"2.0"')
    expect(issue.message).toContain(`"${MAP_SCHEMA_MAJOR}"`)
  })

  it('accepts a point release of its own major', () => {
    expect(validateCampusFile({ ...base(), schemaVersion: `${MAP_SCHEMA_MAJOR}.3` }).issues).toEqual([])
  })

  it('refuses a file with no schemaVersion at all, rather than assuming the current one', () => {
    const noVersion: Partial<Fixture> = { ...base() }
    delete noVersion.schemaVersion
    expect(issueFor(validateCampusFile(noVersion), 'missing-block').subject).toBe('schemaVersion')
    // An empty string is the same failure: it is a field present in name only.
    expect(onlyIssue({ ...base(), schemaVersion: '' }, 'missing-block').subject).toBe('schemaVersion')
  })

  it('refuses a file with no canvas, since there is no extent to clip a route to', () => {
    const noCanvas: Partial<Fixture> = { ...base() }
    delete noCanvas.canvas
    expect(onlyIssue(noCanvas, 'missing-block').subject).toBe('canvas')
  })

  it('distinguishes a block that is absent from one that is the wrong shape', () => {
    // Two messages, because the fixes are different: "add the key" versus "it is not an array".
    // Both are deliberately untypeable as a `Fixture`: the shapes the compiler would reject are
    // exactly the ones the validator exists to catch.
    const optional = { ...base(), surfaces: 'none' }
    expect(onlyIssue(optional, 'missing-block').message).toContain('when present')
    const required = { ...base(), nodes: { a: 1 } }
    const report = validateCampusFile(required)
    expect(report.issues.map((issue) => [issue.code, issue.subject])).toEqual([['missing-block', 'nodes']])
    expect(report.issues[0]?.message).toContain('found object')
    // One issue and not five: a `nodes` block that is not an array stops the read, so no rule gets to
    // invent a complaint about the wreckage.
  })

  it('names a required block that is absent instead of reporting an empty campus', () => {
    // `delete` on a `Partial` rather than a rest-destructure, because removing a key by ignoring it in
    // a pattern is the idiom ESLint cannot tell apart from an unused variable.
    const withoutEdges: Partial<Fixture> = { ...base() }
    delete withoutEdges.edges
    const report = validateCampusFile(withoutEdges)
    // Everything after a missing block is skipped: 0 nodes and 0 edges would also be `empty-graph`,
    // and that would be describing my own reading of the wreckage rather than the file.
    expect(report.issues.map((issue) => [issue.code, issue.subject])).toEqual([['missing-block', 'edges']])
  })

  it('reports a row that is not an object at its index', () => {
    // Deliberately outside the fixture's type: a row that is not an object is a shape problem, and
    // `Fixture` is the shape the *validator* is promised, so the cast says "this one is on purpose".
    const issue = onlyIssue({ ...base(), nodes: [...base().nodes, null] }, 'missing-block')
    expect(issue.subject).toBe('nodes[3]')
    expect(issue.message).toContain('entry 3 is null')
  })

  it('requires the metadata that says which campus this even is', () => {
    const withoutMeta: Partial<Fixture> = { ...base() }
    delete withoutMeta.metadata
    expect(issueFor(validateCampusFile(withoutMeta), 'missing-block').subject).toBe('metadata')
  })

  it('requires dataStatus, since the banner is what tells a user to distrust the distances', () => {
    expect(onlyIssue({ ...base(), metadata: { ...base().metadata, dataStatus: 7 } }, 'missing-block').subject).toBe('metadata.dataStatus')
  })
})

describe('ids', () => {
  it('rejects an id with whitespace in it', () => {
    const issue = onlyIssue(addNode(base(), { id: 'space station', label: 'x', kind: 'place', x: 50, y: 50, zone: 'core' }), 'bad-id')
    expect(issue.subject).toBe('nodes[3]')
    expect(issue.message).toContain('"space station"')
  })

  it('rejects an empty id, which would otherwise match every missing reference', () => {
    expect(onlyIssue(addNode(base(), { id: '', label: 'x', kind: 'place', x: 50, y: 50, zone: 'core' }), 'bad-id').severity).toBe('error')
  })

  it("treats the whole file as one id space, so a building cannot borrow a node's id", () => {
    const issue = onlyIssue(patchBuilding(base(), 'b-a', { id: 'a' }), 'duplicate-id')
    expect(issue.subject).toBe('a')
    expect(issue.message).toContain('claimed 2 times')
  })

  it('reports a duplicated node once, and not again as a broken edge', () => {
    expect(onlyIssue(addNode(base(), { id: 'a', label: 'Twin', kind: 'place', x: 20, y: 20, zone: 'core' }), 'duplicate-id').subject).toBe('a')
  })
})

describe('coordinates, canvas and lengths', () => {
  it('rejects a non-finite coordinate by name', () => {
    const issue = onlyIssue(patchNode(base(), 'b', { y: null }), 'bad-number')
    expect(issue.subject).toBe('b')
    expect(issue.message).toContain('null')
  })

  it('does not additionally blame the edges of a node with broken coordinates', () => {
    const model = buildGraph(patchNode(base(), 'b', { x: Number.NaN }))
    expect(model.issues.map((issue) => issue.code)).toEqual(['bad-number'])
    // The dropped node took its one edge with it, so the graph is one place and one junction — and no
    // `isolated-node` warning is printed about the hole my own repair made.
    expect(model.summary).toMatchObject({ nodeCount: 2, edgeCount: 1 })
  })

  it('rejects a canvas that cannot be a scale, and says what it used instead', () => {
    expect(onlyIssue({ ...base(), canvas: { width: 400, height: 300, pixelsPerMetre: 0 } }, 'bad-canvas').message).toContain('used 1 meanwhile')
  })

  it('rejects a zero-extent canvas', () => {
    expect(onlyIssue({ ...base(), canvas: { width: 0, height: 0, pixelsPerMetre: 1 } }, 'bad-canvas').severity).toBe('error')
  })

  it('reports a stated length of zero instead of clamping it to something walkable', () => {
    expect(onlyIssue(patchEdge(base(), 'e-a--j', { metres: 0 }), 'bad-number').message).toContain('metres')
  })

  it('reports two nodes at the same point, where the derived length would be zero', () => {
    expect(onlyIssue(patchNode(base(), 'j', { x: 10, y: 150 }), 'bad-number').message).toContain('same point')
  })

  it('warns when a hand-written length disagrees with the coordinates', () => {
    const issue = onlyIssue(patchEdge(base(), 'e-a--j', { metres: 400 }), 'length-mismatch')
    expect(issue.severity).toBe('warning')
    expect(issue.message).toContain('400 m')
    expect(issue.message).toContain('190 m')
    expect(issue.message).toContain('111%')
  })

  it('leaves a plausible hand-measured length alone', () => {
    // 210 against 190 derived is 10.5%, inside the 15% tolerance: pinned from below the boundary
    // rather than on it, so a tolerance change has to be a decision.
    expect(validateCampusFile(patchEdge(base(), 'e-a--j', { metres: 210 })).issues).toEqual([])
  })

  it('derives metres through the canvas scale', () => {
    expect(deriveMetres(0, 0, 30, 40, 1)).toBe(50)
    expect(deriveMetres(0, 0, 30, 40, 2)).toBe(25)
    expect(deriveMetres(0, 0, 1, 0, 1)).toBe(1)
  })

  it('warns about a node the map will clip', () => {
    const model = buildGraph(patchNode(base(), 'b', { x: 900 }))
    expect(model.warnings).toBe(1)
    expect(issueFor(model, 'outside-canvas').message).toContain('400×300')
  })
})

describe('node kinds and zones', () => {
  it('rejects a kind the engine has no name for', () => {
    expect(onlyIssue(patchNode(base(), 'a', { kind: 'building' }), 'bad-kind').message).toContain('"junction" | "place" | "gate" | "entrance"')
  })

  it('accepts each of the four kinds and keeps its meaning', () => {
    const file = base()
    const model = buildGraph({
      ...file,
      nodes: [
        ...file.nodes,
        { id: 'g', label: 'Gate', kind: 'gate', x: 100, y: 100, zone: 'core' },
        { id: 'd', label: 'Door', kind: 'entrance', x: 120, y: 120, zone: 'core' },
      ],
      edges: [...file.edges, { id: 'e-g--j', from: 'g', to: 'j' }, { id: 'e-d--j', from: 'd', to: 'j' }],
    })
    expect(model.ok).toBe(true)
    expect(model.graph.node('g')?.kind).toBe('gate')
    expect(model.graph.node('d')?.kind).toBe('entrance')
    // Gates and entrances are places you can be routed to, so they count as searchable.
    expect(model.summary.placeCount).toBe(4)
  })

  it('rejects a zone a node claims but the file never declares', () => {
    const issue = onlyIssue(patchNode(base(), 'a', { zone: 'quad' }), 'unknown-zone')
    expect(issue.message).toContain('"a"')
    expect(issue.message).toContain('"quad"')
  })

  it('warns, rather than errors, when a node has no zone at all', () => {
    expect(onlyIssue(patchNode(base(), 'a', { zone: undefined }), 'missing-zone').severity).toBe('warning')
  })

  it('reports a duplicate id once for geometry rows too, and checks only the first', () => {
    const twin = base().buildings[0] ?? {}
    const file: Fixture = { ...base(), buildings: [twin, { ...twin, entryNodeIds: ['ghost'] }] }
    // The second `b-a` is not checked, so its bogus entrance is not a second error about a different
    // problem: the file's actual defect is that the id is used twice.
    expect(onlyIssue(file, 'duplicate-id').subject).toBe('b-a')
    const twinSurface = base().surfaces[0] ?? {}
    expect(onlyIssue({ ...base(), surfaces: [twinSurface, { ...twinSurface, kind: 'swimming pool' }] }, 'duplicate-id').subject).toBe('s-lawn')
  })

  it('does not blame a building for an entrance whose node was already dropped', () => {
    const file = patchBuilding(patchNode(base(), 'a', { x: Number.NaN }), 'b-a', { entryNodeIds: ['a'] })
    expect(validateCampusFile(file).issues.map((issue) => issue.code)).toEqual(['bad-number'])
  })

  it('holds a building to the same zone rule', () => {
    expect(issueFor(validateCampusFile(patchBuilding(base(), 'b-a', { zone: 'nowhere' })), 'unknown-zone').subject).toBe('b-a')
  })
})

describe('edges', () => {
  it('reports an endpoint that names no node', () => {
    const issue = onlyIssue(patchEdge(base(), 'e-a--j', { to: 'j-99' }), 'unknown-ref')
    expect(issue.subject).toBe('e-a--j')
    expect(issue.message).toContain('"j-99"')
  })

  it('reports an endpoint that is not a usable id, separately from one that names no node', () => {
    // Worth its own case: `from: 42` is a type error in the row, while `to: 'j-99'` is a typo, and a
    // person fixing them reads two different things out of the file.
    expect(onlyIssue(patchEdge(base(), 'e-a--j', { to: 42 }), 'unknown-ref').message).toContain('not a usable id')
    expect(onlyIssue(patchEdge(base(), 'e-a--j', { to: ' ' }), 'unknown-ref').message).toContain('not a usable id')
  })

  it('rejects a self-loop with the reason, not just the rule', () => {
    expect(onlyIssue(patchEdge(base(), 'e-a--j', { to: 'a' }), 'self-loop').message).toContain('goes nowhere')
  })

  it('warns when two places are joined without a junction between them', () => {
    const issue = onlyIssue(addEdge(base(), { id: 'e-a--b', from: 'a', to: 'b' }), 'place-to-place')
    expect(issue.severity).toBe('warning')
    expect(issue.message).toContain('junction')
  })

  it('reports a duplicate edge id once and leaves it out of the graph', () => {
    const file = addEdge(base(), { id: 'e-a--j', from: 'b', to: 'a' })
    expect(onlyIssue(file, 'duplicate-id').subject).toBe('e-a--j')
    const model = buildGraph(file)
    expect(model.summary.edgeCount).toBe(2)
    expect(model.edges.filter((edge) => edge.id === 'e-a--j')).toHaveLength(1)
  })

  it('reports a campus with places but no walkways as empty, because that is what it is', () => {
    const issue = onlyIssue({ ...base(), edges: [] }, 'empty-graph')
    expect(issue.message).toContain('3 usable node(s) and 0 usable edge(s)')
    // The count is of *usable* rows, which is the number that explains why nothing routes.
    expect(buildGraph({ ...base(), edges: [] }).summary.nodeCount).toBe(3)
  })

  it('names a stranded network with its size, which is the claim union-find is actually making', () => {
    // A second, self-contained pair of junctions: connected internally, unreachable from the campus.
    let file = addNode(base(), { id: 'p', label: 'p', kind: 'junction', x: 30, y: 30, zone: 'core' })
    file = addNode(file, { id: 'q', label: 'q', kind: 'junction', x: 70, y: 30, zone: 'core' })
    file = addEdge(file, { id: 'e-p--q', from: 'p', to: 'q' })
    const model = buildGraph(file)
    expect(model.ok).toBe(true)
    expect(model.summary.componentCount).toBe(2)
    const issue = issueFor(model, 'disconnected-component')
    expect(issue.severity).toBe('warning')
    expect(issue.message).toContain('2 separate networks of 3, 2 nodes')
    expect(issue.message).toContain('"p"')
    expect(issue.message).toContain('"q"')
    // The main network still routes, which is the whole reason this is a warning and not an error.
    expect(model.graph.neighboursOf('a').map((entry) => entry.to)).toEqual(['j'])
  })

  it('reports an isolated place as a warning and still routes the rest', () => {
    const model = buildGraph(addNode(base(), { id: 'lonely', label: 'Far Hostel', kind: 'place', x: 300, y: 30, zone: 'core' }))
    expect(model.ok).toBe(true)
    expect(issueFor(model, 'isolated-node').message).toContain('Far Hostel')
    expect(model.summary.edgeCount).toBe(2)
  })
})

describe('edge attributes', () => {
  it('rejects a crowd above 1 rather than clamping it', () => {
    expect(onlyIssue(patchEdge(base(), 'e-a--j', { attrs: { crowd: 1.4 } }), 'crowd-range').message).toContain('1.4')
  })

  it('rejects a negative crowd too', () => {
    expect(onlyIssue(patchEdge(base(), 'e-a--j', { attrs: { crowd: -0.1 } }), 'crowd-range').severity).toBe('error')
  })

  it('rejects a crowd of a type that is not a number', () => {
    expect(onlyIssue(patchEdge(base(), 'e-a--j', { attrs: { crowd: '0.5' } }), 'crowd-range').message).toContain('"0.5"')
  })

  it('keeps a bad crowd out of the graph rather than trusting the report', () => {
    // The error is the point, but the graph must not carry `crowd: "0.5"` into a cost function that
    // multiplies by it in Phase 3 — what reaches the engine is the default.
    expect(buildGraph(patchEdge(base(), 'e-a--j', { attrs: { crowd: '0.5' } })).edges[0]?.attributes.crowd).toBe(0.2)
  })

  it('rejects a slope steeper than the campus can have', () => {
    expect(onlyIssue(patchEdge(base(), 'e-a--j', { attrs: { slope: 1.5 } }), 'bad-attr').message).toContain('-1..1')
  })

  it('rejects a stairs flag that claims to be step-free', () => {
    expect(onlyIssue(patchEdge(base(), 'e-a--j', { attrs: { stairs: true, stepFree: true } }), 'bad-attr').message).toContain('stairs and no steps')
  })

  it('allows a segment that is neither stairs nor step-free, because cobbles exist', () => {
    expect(validateCampusFile(patchEdge(base(), 'e-a--j', { attrs: { stairs: false, stepFree: false } })).issues).toEqual([])
  })

  it('rejects a flag that is not a boolean', () => {
    expect(onlyIssue(patchEdge(base(), 'e-a--j', { attrs: { shaded: 'yes' } }), 'bad-attr').message).toContain('attrs.shaded')
  })

  it('rejects a surface the renderer has no style for', () => {
    expect(onlyIssue(patchEdge(base(), 'e-a--j', { attrs: { surface: 'mud' } }), 'bad-surface').message).toContain('"paved"')
  })

  it('rejects an attrs block that is not an object', () => {
    expect(onlyIssue(patchEdge(base(), 'e-a--j', { attrs: [] }), 'bad-attr').message).toContain('object or nothing')
  })
})

describe('draw-only geometry', () => {
  it('rejects a footprint with too few points to enclose anything', () => {
    expect(onlyIssue(patchBuilding(base(), 'b-a', { footprint: [[0, 0], [10, 10]] }), 'bad-ring').subject).toBe('b-a')
  })

  it('rejects a surface ring with a ragged point', () => {
    expect(onlyIssue(patchSurface(base(), 's-lawn', { ring: [[0, 0], [10, 10], [10, 'x']] }), 'bad-ring').subject).toBe('s-lawn')
  })

  it('warns when a bowtie will render with a hole in it', () => {
    expect(onlyIssue(patchBuilding(base(), 'b-a', { footprint: [[0, 0], [100, 0], [0, 100], [100, 100]] }), 'non-simple-ring').severity).toBe('warning')
  })

  it('accepts a concave courtyard, which is simple and worth drawing', () => {
    const courtyard = [[0, 0], [100, 0], [100, 100], [50, 100], [50, 50], [0, 50]]
    expect(validateCampusFile(patchBuilding(base(), 'b-a', { footprint: courtyard })).issues).toEqual([])
  })

  it('rejects a building nobody can enter', () => {
    expect(onlyIssue(patchBuilding(base(), 'b-a', { entryNodeIds: [] }), 'no-entrance').message).toContain('Block A')
  })

  it('rejects a building whose only entrance has no walkway', () => {
    const file = addNode(
      patchBuilding(base(), 'b-a', { entryNodeIds: ['lonely'] }),
      { id: 'lonely', label: 'Far Hostel', kind: 'place', x: 300, y: 30, zone: 'core' },
    )
    expect(onlyIssue(file, 'entrance-unreachable').message).toContain('"lonely"')
  })

  it('accepts two entrances and requires only that both are reachable', () => {
    const file = addEdge(patchBuilding(base(), 'b-a', { entryNodeIds: ['a', 'j'] }), { id: 'e-b--j', from: 'b', to: 'j' })
    expect(validateCampusFile(file).issues).toEqual([])
  })

  it('blames a building, not a node, when its entrance names nothing', () => {
    const issue = onlyIssue(patchBuilding(base(), 'b-a', { entryNodeIds: ['ghost'] }), 'unknown-ref')
    expect(issue.subject).toBe('b-a')
    expect(issue.message).toContain('which is not in "nodes"')
  })

  it('reports an entrance id that is not usable at all', () => {
    expect(onlyIssue(patchBuilding(base(), 'b-a', { entryNodeIds: ['a b'] }), 'unknown-ref').message).toContain('not a usable id')
  })

  it('warns about a self-crossing surface ring as well as a building footprint', () => {
    const bowtie = [[0, 0], [100, 0], [0, 100], [100, 100]]
    const issue = onlyIssue(patchSurface(base(), 's-lawn', { ring: bowtie }), 'non-simple-ring')
    expect(issue.severity).toBe('warning')
    expect(issue.message).toContain('s-lawn')
  })

  it('rejects a ground kind the renderer has no fill for', () => {
    expect(onlyIssue(patchSurface(base(), 's-lawn', { kind: 'swimming pool' }), 'bad-surface').message).toContain('"lawn"')
  })
})

describe('the report itself', () => {
  it('puts errors before warnings, and sorts by code then subject within each', () => {
    let file = patchNode(base(), 'b', { kind: 'nope' })
    file = patchNode(file, 'a', { kind: 'building' })
    file = patchEdge(file, 'e-a--j', { attrs: { crowd: 3 } })
    file = patchNode(file, 'j', { zone: undefined })
    // One assertion pins all three rules at once: severity, then code, then subject. Both `bad-kind`
    // rows are written in the file's order (b before a) so a sort that skipped the subject tie-break
    // would fail here rather than pass by luck.
    expect(validateCampusFile(file).issues.map((issue) => `${issue.severity}/${issue.code}/${issue.subject}`)).toEqual([
      'error/bad-kind/a',
      'error/bad-kind/b',
      'error/crowd-range/e-a--j',
      'warning/missing-zone/j',
    ])
  })

  it('orders two complaints about the same id by their text, not by the order they were found', () => {
    // `attrs` is checked flag by flag, so the file's key order leaks into the issue list unless the
    // comparator finishes the job. Reversed here: stairs, lit, slope in the file; lit, slope, stairs out.
    const file = patchEdge(base(), 'e-a--j', { attrs: { stairs: 'x', lit: 'y', slope: 5 } })
    const messages = validateCampusFile(file).issues.map((issue) => issue.message)
    expect(messages).toEqual([...messages].sort())
    expect(messages.map((message) => message.match(/attrs\.(\w+)/)?.[1])).toEqual(['lit', 'slope', 'stairs'])
  })

  it('sorts by subject even when the file listed the ids in the other order', () => {
    // Inserted z, k, m so the sort cannot pass by leaving them where they are.
    let file = addNode(base(), { id: 'z', label: 'Z', kind: 'nope', x: 40, y: 40, zone: 'core' })
    file = addNode(file, { id: 'k', label: 'K', kind: 'nope', x: 60, y: 60, zone: 'core' })
    file = addNode(file, { id: 'm', label: 'M', kind: 'nope', x: 80, y: 80, zone: 'core' })
    expect(validateCampusFile(file).issues.map((issue) => issue.subject)).toEqual(['k', 'm', 'z'])
  })

  it('reports an edge with two unusable endpoints twice, because each still has to be fixed', () => {
    const file = patchEdge(base(), 'e-a--j', { from: 42, to: 42 })
    const report = validateCampusFile(file)
    const lines = report.issues.map((issue) => issue.message)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(lines[1])
    expect(report.issues.every((issue) => issue.code === 'unknown-ref')).toBe(true)
  })

  it('accepts a ring that repeats its first vertex at the end, the GeoJSON habit', () => {
    const closed = [[10, 90], [90, 90], [90, 150], [10, 150], [10, 90]]
    expect(validateCampusFile(patchBuilding(base(), 'b-a', { footprint: closed })).issues).toEqual([])
  })

  it('formats one line per issue, with the subject last so it can be grepped', () => {
    const report = validateCampusFile(patchEdge(base(), 'e-a--j', { attrs: { crowd: 2 } }))
    expect(formatCampusReport(report, { source: 'src/data/campus.json' }).split('\n')).toEqual([
      'error: crowd-range: edge "e-a--j" attrs.crowd is 2; expected a finite number 0..1 [e-a--j]',
      '',
      '1 error, 0 warnings (src/data/campus.json)',
    ])
  })

  it('says so when nothing is wrong, rather than printing a blank line and a zero', () => {
    expect(formatCampusReport(validateCampusFile(base()), { source: 'x.json' })).toBe('no issues (x.json)')
  })

  it('can be filtered to one severity, for --strict runs and the error panel', () => {
    const report = validateCampusFile(addEdge(base(), { id: 'e-a--b', from: 'a', to: 'b' }))
    expect(formatCampusReport(report, { severity: 'error' })).toContain('no issues')
    expect(formatCampusReport(report, { severity: 'warning' })).toContain('place-to-place')
  })

  it('knows what an id is, because both halves of the module ask it independently', () => {
    expect(isUsableId('gate-north')).toBe(true)
    expect(isUsableId(' gate')).toBe(false)
    expect(isUsableId('')).toBe(false)
    expect(isUsableId(42)).toBe(false)
  })
})

describe('the shipped file', () => {
  it('passes with only the warnings the schema says are intentional', () => {
    const model = buildGraph(campus)
    expect(model.errors).toBe(0)
    expect(model.ok).toBe(true)
    expect(model.issues.map((issue) => issue.code)).toEqual(['place-to-place', 'place-to-place'])
    expect(model.summary).toMatchObject({
      nodeCount: 39,
      edgeCount: 56,
      componentCount: 1,
      zoneCount: 6,
      buildingCount: 13,
      surfaceCount: 8,
    })
  })

  it('gives the map every node to draw and search every place to index', () => {
    const model = buildGraph(campus)
    expect(model.graph.size).toBe(campus.nodes.length)
    for (const node of campus.nodes) {
      expect(model.graph.hasNode(node.id), `${node.id} missing from the graph`).toBe(true)
    }
    // Every non-junction is searchable, which is what makes the trie's job well-defined.
    expect(model.summary.placeCount).toBe(campus.nodes.filter((node) => node.kind !== 'junction').length)
  })

  it('has a loop, so at least one destination has an alternative route rather than one path', () => {
    const model = buildGraph(campus)
    // Independent cycles = E - V + components. Undirected edges counted once, one component here.
    expect(model.summary.edgeCount - model.summary.nodeCount + model.summary.componentCount).toBeGreaterThanOrEqual(1)
  })

  it('reaches every building through a node that is on the walkway network', () => {
    for (const building of campus.buildings) {
      for (const entry of building.entryNodeIds) {
        expect(campus.edges.some((edge) => edge.from === entry || edge.to === entry), `${building.id} via ${entry}`).toBe(true)
      }
    }
  })

  it('has no node whose only role would be to be unreachable', () => {
    const degrees = new Map<string, number>()
    for (const edge of campus.edges) {
      degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1)
      degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1)
    }
    // A junction with one edge is a dead end drawn as a corner, which the renderer would show as a
    // path with nowhere to go.
    for (const node of campus.nodes) {
      if (node.kind === 'junction') expect(degrees.get(node.id) ?? 0, `${node.id} is a stub junction`).toBeGreaterThanOrEqual(2)
    }
  })

  it('uses all six zones, and every node names exactly one that the file declares', () => {
    const declared = new Set(campus.zones.map((zone) => zone.id))
    expect(declared.size).toBe(6)
    const used = new Set<string>()
    for (const node of campus.nodes) {
      const zone = node.zone
      if (typeof zone !== 'string') throw new Error(`node ${node.id} has no zone, so the legend has nothing to colour it with`)
      used.add(zone)
      expect(declared.has(zone), `node ${node.id} claims ${zone}, which the file does not declare`).toBe(true)
    }
    // No zone declared and never used: a legend entry with nothing under it is a data bug too.
    expect([...declared].sort()).toEqual([...used].sort())
  })
})
