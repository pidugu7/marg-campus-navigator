import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE_ATTRIBUTES } from '@/data'
import { attributeLines, baselineWords, buildingTip, edgeTip, placeTip } from './tip-content'
import type { EdgeAttributes, GraphEdge, GraphNode } from '@/data'

// `Partial<GraphNode>` under `exactOptionalPropertyTypes` will not accept an explicit `zone: undefined`,
// which is the only way a spec can build the "node with no zone" shape the validator deliberately leaves in
// place (the `missing-zone` warning path). So the override type is a mapped one, with `| undefined` added
// per property rather than intersected on top — an intersection still has to satisfy `Partial`, and fails.
type NodeOverrides = { readonly [K in keyof GraphNode]?: GraphNode[K] | undefined }

const node = (over: NodeOverrides = {}): GraphNode => ({
  id: over.id ?? 'library',
  label: over.label ?? 'Library',
  kind: over.kind ?? 'place',
  x: over.x ?? 100,
  y: over.y ?? 200,
  // Conditional spread, not `zone: over.zone`: under `exactOptionalPropertyTypes` the property has to be
  // *absent*, not present-with-undefined, which is exactly the shape `buildGraph` leaves behind.
  ...(over.zone === undefined ? {} : { zone: over.zone }),
})

const edge = (attrs: Partial<EdgeAttributes> = {}, over: Partial<GraphEdge> = {}): GraphEdge => ({
  id: 'e-a--b',
  from: 'a',
  to: 'b',
  metres: 145.26,
  attributes: { ...DEFAULT_EDGE_ATTRIBUTES, ...attrs },
  oneWay: false,
  ...over,
})

describe('a place', () => {
  it('reads as a sentence, not as a field dump', () => {
    const tip = placeTip(node(), { zoneLabel: 'Learning', categoryLabel: 'Library', degrees: 4 })
    expect(tip.title).toBe('Library')
    expect(tip.lines).toEqual(['place · Library', 'Learning zone', '4 walkway segments'])
  })

  it('counts one segment out loud, and says so when a place is stranded', () => {
    expect(placeTip(node(), { degrees: 1 }).lines[2]).toBe('1 walkway segment')
    expect(placeTip(node(), { degrees: 0 }).lines[2]).toBe('no walkway reaches it')
  })

  it('names the absence of a zone instead of printing "undefined zone"', () => {
    const tip = placeTip(node({ zone: undefined }), { degrees: 2 })
    expect(tip.lines).toContain('unzoned zone')
    expect(tip.lines.join('')).not.toContain('undefined')
  })

  it('drops the identity line for a bare junction, which has neither kind label nor category', () => {
    const tip = placeTip(node({ kind: 'junction', label: 'j-3', zone: undefined }), { degrees: 2 })
    expect(tip.lines).toEqual(['junction', 'unzoned zone', '2 walkway segments'])
  })
})

describe('a walkway segment', () => {
  it('leads with its length, to one decimal', () => {
    expect(edgeTip(edge(), { from: 'Gate North', to: 'Plaza' }).lines[0]).toBe('145.3 m')
  })

  it('mentions only what deviates from a plain segment, which is most of the graph', () => {
    // `DEFAULT_EDGE_ATTRIBUTES` is step-free, lit, paved, flat, crowd 0.2 — so an edge with no attrs has
    // nothing worth saying about it, and the tooltip stays out of the way.
    expect(edgeTip(edge(), { from: 'a', to: 'b' }).lines).toEqual(['145.3 m'])
    expect(edgeTip(edge({ stairs: true }), { from: 'a', to: 'b' }).lines).toEqual(['145.3 m', 'stairs'])
    expect(edgeTip(edge({ stepFree: false, lit: false }), { from: 'a', to: 'b' }).lines).toEqual([
      '145.3 m',
      'not step-free',
      'unlit at night',
    ])
  })

  it('words the flags the way a person would, and signs the grade', () => {
    const lines = edgeTip(
      edge({ stairs: true, surface: 'covered', shaded: true, slope: -0.06, crowd: 0.7 }),
      { from: 'a', to: 'b' },
    ).lines
    expect(lines).toEqual(['145.3 m', 'stairs', 'covered way', 'shaded', '6% down', 'crowd 70%'])
  })

  it('says one-way last, since it changes how you route rather than how you walk', () => {
    const lines = edgeTip(edge({ stepFree: true }, { oneWay: true }), { from: 'a', to: 'b' }).lines
    expect(lines.slice(-1)).toEqual(['one-way'])
    // A baseline edge is already step-free, so saying it back would be the field dump this avoids.
    expect(lines).toEqual(['145.3 m', 'one-way'])
  })

  it('names the direction in the title, both ends labelled', () => {
    expect(edgeTip(edge(), { from: 'Hostel A', to: 'Cafeteria' }).title).toBe('Hostel A → Cafeteria')
  })
})

describe('a building', () => {
  const building = {
    id: 'b-library',
    label: 'Library',
    zone: 'learning',
    footprint: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
    entryNodeIds: ['library', 'library-door'],
  }

  it('lists the entrances by their labels, which is what a route will aim for', () => {
    const tip = buildingTip(building, { zoneLabel: 'Learning', labelFor: (id) => `[${id}]` })
    expect(tip.lines).toEqual(['Learning zone', 'entrance: [library], [library-door]'])
  })

  it('reports a missing entrance as a fact about the data', () => {
    const tip = buildingTip({ ...building, entryNodeIds: [], levels: 1 }, { labelFor: () => '' })
    expect(tip.lines).toEqual(['unzoned zone', 'no entrance recorded'])
  })

  it('says how many levels only when there is more than one', () => {
    const tip = buildingTip({ ...building, levels: 4 }, { labelFor: () => 'x' })
    expect(tip.lines).toContain('4 levels')
  })
})

describe('attribute wording', () => {
  it("is the legend's own wording, taken from the same function", () => {
    expect(attributeLines({ ...DEFAULT_EDGE_ATTRIBUTES, crowd: 0 })).toEqual(['usually empty'])
    expect(attributeLines({ ...DEFAULT_EDGE_ATTRIBUTES, surface: 'grass' })).toEqual(['grass'])
    expect(attributeLines({ ...DEFAULT_EDGE_ATTRIBUTES })).toEqual([])
  })

  it('signs a climb either way, because the data allows a grade in both directions', () => {
    expect(attributeLines({ ...DEFAULT_EDGE_ATTRIBUTES, slope: 0.09 })).toEqual(['9% up'])
    expect(attributeLines({ ...DEFAULT_EDGE_ATTRIBUTES, slope: -0.09 })).toEqual(['9% down'])
  })

  it('names the shipped baseline in words, for the legend', () => {
    expect(baselineWords(DEFAULT_EDGE_ATTRIBUTES)).toEqual([
      'step-free',
      'paved',
      'lit',
      'flat',
      'crowd 20%',
    ])
  })

  it('describes any baseline it is handed, so the legend follows a change in the constant', () => {
    // This is the whole reason the function takes the attributes instead of reading the constant: a campus
    // that decided a plain segment is a shaded, sloped staircase must say so in both places at once.
    expect(
      baselineWords({
        stairs: true,
        stepFree: false,
        shaded: true,
        lit: false,
        crowd: 0.5,
        surface: 'grass',
        slope: 0.12,
      }),
    ).toEqual(['stairs', 'grass', 'shaded', '12% grade', 'crowd 50%'])
    // The synonym pair never both appear: 'step-free' wins over 'no steps' when both would be true.
    expect(baselineWords({ ...DEFAULT_EDGE_ATTRIBUTES, stepFree: true, stairs: true })).toContain('step-free')
    expect(baselineWords({ ...DEFAULT_EDGE_ATTRIBUTES, stepFree: true, stairs: true })).not.toContain('stairs')
    // A baseline with neither claim says nothing about steps at all, rather than inventing one.
    const silent = baselineWords({ ...DEFAULT_EDGE_ATTRIBUTES, stepFree: false, stairs: false })
    expect(silent).not.toContain('stairs')
    expect(silent).not.toContain('step-free')
  })
})
