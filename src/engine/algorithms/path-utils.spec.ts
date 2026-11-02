import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE_ATTRIBUTES } from '../constants'
import { AdjacencyGraph } from '../structures/graph'
import { BASE_SEED, createRandom, indexOfGraph, randomGraph } from '../__tests__/helpers'
import { MIN_INSTRUCTION_METRES, MIN_SEGMENT_METRES } from '../constants'
import {
  SHARP_WITHIN_DEGREES,
  SLIGHT_WITHIN_DEGREES,
  STRAIGHT_WITHIN_DEGREES,
  routeLegs,
  simplifyLegs,
  stepsFromLegs,
  stepsReplay,
  turnDirectionFor,
  type RouteLeg,
} from './path-utils'
import type { EdgeAttributes, GraphIndex, NodeId, RouteStep, TurnDirection } from '../types'

/**
 * The translation from a path to a directions list. Everything here is geometry and wording, so none of it
 * needs a search to exercise — which is the point of splitting `path-utils.ts` out of `search-common.ts`.
 */

const attributes: EdgeAttributes = DEFAULT_EDGE_ATTRIBUTES

/**
 * A path along the x axis with one corner at `bend`, whose offset from the axis sets the turn: 0 is
 * straight on, and any non-zero offset large enough is a right-angle corner.
 */
/** {@link row}'s shape with a corner a reader could actually find: same coordinates, `kind: 'place'`. */
function namedRow(): GraphIndex {
  const builder = new AdjacencyGraph()
  builder.addNode({ id: 'a', x: 0, y: 0, label: 'Gate', kind: 'gate' })
  builder.addNode({ id: 'b', x: 30, y: 30, label: 'Crossroads', kind: 'place' })
  builder.addNode({ id: 'c', x: 60, y: 30, label: 'Library', kind: 'place' })
  builder.addEdge({ id: 'ab', from: 'a', to: 'b', metres: 30, attributes })
  builder.addEdge({ id: 'bc', from: 'b', to: 'c', metres: 30, attributes })
  return builder.seal()
}

function row(bend: number, extraBend = 0): GraphIndex {
  const builder = new AdjacencyGraph()
  builder.addNode({ id: 'a', x: 0, y: 0, label: 'Gate', kind: 'gate' })
  builder.addNode({ id: 'b', x: 30, y: bend, label: 'Crossroads', kind: 'junction' })
  builder.addNode({ id: 'c', x: 60, y: bend + extraBend, label: 'Library', kind: 'place' })
  builder.addEdge({ id: 'ab', from: 'a', to: 'b', metres: 30, attributes })
  builder.addEdge({ id: 'bc', from: 'b', to: 'c', metres: 30, attributes })
  return builder.seal()
}

describe('routeLegs', () => {
  it('returns nothing for a path that has no walking in it', () => {
    const index = row(0)
    expect(routeLegs(index, [], [])).toEqual([])
    expect(routeLegs(index, ['a'], [])).toEqual([])
  })

  it('keeps a straight line in one leg, whatever number of segments it is stored as', () => {
    const index = row(0)
    const legs = routeLegs(index, ['a', 'b', 'c'], ['ab', 'bc'])
    expect(legs).toHaveLength(1)
    const leg = legs[0] as (typeof legs)[number]
    expect(leg.nodeIds).toEqual(['a', 'b', 'c'])
    expect(leg.edgeIds).toEqual(['ab', 'bc'])
    expect(leg.metres).toBe(60)
    expect(leg.direction).toBe('straight')
    expect(leg.compass).toBe('east')
    expect(leg.reachesDestination).toBe(true)
  })

  it('cuts at a corner, and the next leg starts on the vertex the turn happens at', () => {
    // `row(30)` is a 45° corner, not a right angle: the leg leaves `a` heading south-east (the map's +y runs
    // down) and comes back to due east, so the turn is 45° to the walker's left. Every expectation here was
    // written from a picture in my head of a right-angle bend, and the geometry corrected it.
    const index = row(30)
    const legs = routeLegs(index, ['a', 'b', 'c'], ['ab', 'bc'])
    expect(legs).toHaveLength(2)
    const [first, second] = legs as [typeof legs[number], typeof legs[number]]
    expect(first.nodeIds).toEqual(['a', 'b'])
    expect(first.compass).toBe('south-east')
    expect(first.reachesDestination).toBe(false)
    // The opening leg names the far end, which here is the corner itself; the turning leg names the corner
    // it turns at, which is the same vertex. Legs overlap by exactly one vertex — that overlap is the whole
    // replay convention `stepsReplay` undoes. And *both* names are empty, because `b` is a junction: the file
    // gives junctions shorthand labels for the data's own bookkeeping, the marker layer refuses to draw them,
    // and the prose refuses to print them too. `namedRow()` below is the same shape with a nameable corner.
    expect(first.landmark).toBe('')
    expect(second.nodeIds).toEqual(['b', 'c'])
    expect(second.compass).toBe('east')
    expect(second.direction).toBe('slight-left')
    expect(second.landmark).toBe('')
    expect(second.reachesDestination).toBe(true)
  })

  it('names the corner when the map would name it', () => {
    // The one-line difference from `row(30)`: the corner is a `place`. Every expectation above flips — same
    // geometry, same legs, same metres — which is what makes this the test for the naming rule rather than a
    // second copy of the geometry one.
    const index = namedRow()
    const legs = routeLegs(index, ['a', 'b', 'c'], ['ab', 'bc'])
    expect(legs.map((leg) => leg.metres)).toEqual([30, 30])
    expect(legs.map((leg) => leg.landmark)).toEqual(['Crossroads', 'Crossroads'])
    expect(stepsFromLegs(legs).map((step) => step.instruction)).toEqual([
      'Head south-east to Crossroads',
      'Bear left at Crossroads, your destination',
    ])
  })

  it('decides a landmark by kind, and only `junction` is refused', () => {
    const builder = new AdjacencyGraph()
    const kinds = ['junction', 'place', 'gate', 'entrance'] as const
    kinds.forEach((kind, i) => {
      builder.addNode({ id: `v${String(i)}`, x: i * 40, y: (i % 2) * 30, label: `Named ${kind}`, kind })
      if (i > 0) builder.addEdge({ id: `e${String(i)}`, from: `v${String(i - 1)}`, to: `v${String(i)}`, metres: 40, attributes })
    })
    const index = builder.seal()
    const legs = routeLegs(index, ['v0', 'v1', 'v2', 'v3'], ['e1', 'e2', 'e3'])
    // The opening leg looks *forward*, to `v1`; the two turning legs look back at the corner they turn at,
    // `v1` again and then `v2`. So the first two landmarks are the same vertex under the same rule.
    expect(legs.map((leg) => leg.landmark)).toEqual(['Named place', 'Named place', 'Named gate'])
    // And the junction that starts the path is never asked for its name: a leg's `direction` is a turn, and
    // the origin has no turn to name it after.
    expect(legs[0]?.direction).toBe('straight')
  })

  it('drops the clause when the corner has no name to read, rather than printing its id', () => {
    const builder = new AdjacencyGraph()
    builder.addNode({ id: 'a', x: 0, y: 0, label: 'Gate', kind: 'gate' })
    // `kind: 'place'` on a corner with no label, so this test is about the *missing name* and not about the
    // junction rule above: a junction with no label would pass for the wrong reason.
    builder.addNode({ id: 'b', x: 30, y: 30, kind: 'place' })
    builder.addNode({ id: 'c', x: 60, y: 30, label: 'Library', kind: 'place' })
    builder.addEdge({ id: 'ab', from: 'a', to: 'b', metres: 42, attributes })
    builder.addEdge({ id: 'bc', from: 'b', to: 'c', metres: 30, attributes })
    const index = builder.seal()
    const legs = routeLegs(index, ['a', 'b', 'c'], ['ab', 'bc'])
    // `AdjacencyGraph` defaults an omitted label to the empty string, so the clause disappears; printing the
    // id instead would put "Bear left at j-14" on a screen, which is not a direction.
    expect(legs[1]?.landmark).toBe('')
    expect(stepsFromLegs(legs)).toHaveLength(2)
    expect(stepsFromLegs(legs)[1]?.instruction).toBe('Bear left, your destination')
    // And the opening leg, whose landmark is this same unlabelled corner, loses its clause too: "Head
    // south-east" is a direction, "Head south-east to b" is a database key.
    expect(stepsFromLegs(legs)[0]?.instruction).toBe('Head south-east')
  })

  it('does not cut a kink smaller than the straight tolerance', () => {
    const index = row(4)
    expect(routeLegs(index, ['a', 'b', 'c'], ['ab', 'bc'])).toHaveLength(1)
    // 12 units of offset over 30 is about 21.8°, past the tolerance, so it is a corner worth a word — and
    // with +y down the screen, coming back to due east from a south-east run is a turn to the left.
    const nudge = row(12)
    expect(routeLegs(nudge, ['a', 'b', 'c'], ['ab', 'bc'])).toHaveLength(2)
    expect(routeLegs(nudge, ['a', 'b', 'c'], ['ab', 'bc'])[1]?.direction).toBe('slight-left')
  })

  it('cuts exactly where the wording changes, with no gap and no overlap', () => {
    // `routeLegs` cuts when |turn| ≥ STRAIGHT_WITHIN_DEGREES and `turnDirectionFor` stops calling a turn
    // `straight` at the same threshold, so a leg boundary and a new verb are the same event. One shared
    // constant is what keeps them from drifting apart, and this is the test that would notice if they did.
    for (const degrees of [-0.001, 0, 0.001]) {
      const isStraight = Math.abs(degrees) < STRAIGHT_WITHIN_DEGREES
      expect(turnDirectionFor(degrees) === 'straight', `${String(degrees)}°`).toBe(isStraight)
    }
    expect(STRAIGHT_WITHIN_DEGREES).toBeLessThan(SLIGHT_WITHIN_DEGREES)
    expect(SLIGHT_WITHIN_DEGREES).toBeLessThan(SHARP_WITHIN_DEGREES)
  })

  it('adds one leg for each corner on a zig-zag, and keeps the totals straight', () => {
    const builder = new AdjacencyGraph()
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 40 },
    ]
    points.forEach((point, i) => builder.addNode({ id: `n${String(i)}`, ...point, label: `P${String(i)}` }))
    const edgeIds: string[] = []
    for (let i = 1; i < points.length; i++) {
      const id = `e${String(i)}`
      edgeIds.push(id)
      builder.addEdge({ id, from: `n${String(i - 1)}`, to: `n${String(i)}`, metres: 20, attributes })
    }
    const index = builder.seal()
    const legs = routeLegs(index, ['n0', 'n1', 'n2', 'n3', 'n4'], edgeIds)
    // Four right-angle corners in five vertices, so five minus one cut is four legs: a leg per run, not a
    // leg per turn, which is the off-by-one a reader would guess wrong.
    expect(legs).toHaveLength(4)
    expect(legs.map((leg) => leg.direction)).toEqual(['straight', 'right', 'left', 'right'])
    expect(legs.reduce((total, leg) => total + leg.metres, 0)).toBe(80)
    expect(stepsReplay(stepsFromLegs(legs))).toEqual(['n0', 'n1', 'n2', 'n3', 'n4'])
  })

  it('skips the length of an edge the snapshot lost, and keeps the vertex', () => {
    // Only a hand-built index can do this: `AdjacencyGraph.seal()` stores the edge it was given. The point is
    // that a directions list still prints, instead of `undefined.toFixed()` or a phantom 0 m walkway.
    const builder = new AdjacencyGraph()
    builder.addNode({ id: 'a', x: 0, y: 0 })
    builder.addNode({ id: 'b', x: 20, y: 0 })
    builder.addEdge({ id: 'ab', from: 'a', to: 'b', metres: 20, attributes })
    const index = builder.seal()
    const legs = routeLegs(index, ['a', 'b'], ['ab', 'ghost'])
    expect(legs[0]?.metres).toBe(20)
    expect(legs[0]?.nodeIds).toEqual(['a', 'b'])
  })

  it('gives up on a heading rather than inventing one when a vertex cannot be placed', () => {
    // One node and no edge the snapshot kept: `AdjacencyGraph` refuses a self-loop, so `aa` is a dangling
    // id, and the missing `missing` vertex is the case the compass and the landmark both have to survive.
    const builder = new AdjacencyGraph()
    builder.addNode({ id: 'a', x: 0, y: 0 })
    const index = builder.seal()
    const legs = routeLegs(index, ['a', 'missing'], ['aa'])
    expect(legs).toHaveLength(1)
    expect(legs[0]?.compass).toBeNull()
    expect(legs[0]?.landmark).toBe('')
    expect(stepsFromLegs(legs)[0]?.instruction).toBe('Set off, your destination')
  })
})

describe('turnDirectionFor', () => {
  it('mirrors every bucket about straight ahead, except the U-turn', () => {
    for (const degrees of [15, 45, 90, 135, 170, 180]) {
      const right = turnDirectionFor(degrees)
      const left = turnDirectionFor(-degrees)
      expect(left, `${String(degrees)}° against ${String(-degrees)}°`).toBe(
        right === 'uturn' ? 'uturn' : right.replace('right', 'left'),
      )
    }
  })

  it('reads as a pedestrian does, at each threshold and just inside it', () => {
    expect(turnDirectionFor(0)).toBe('straight')
    expect(turnDirectionFor(STRAIGHT_WITHIN_DEGREES - 0.0001)).toBe('straight')
    expect(turnDirectionFor(STRAIGHT_WITHIN_DEGREES)).toBe('slight-right')
    expect(turnDirectionFor(SLIGHT_WITHIN_DEGREES - 0.0001)).toBe('slight-right')
    expect(turnDirectionFor(SLIGHT_WITHIN_DEGREES)).toBe('right')
    expect(turnDirectionFor(SHARP_WITHIN_DEGREES - 0.0001)).toBe('right')
    expect(turnDirectionFor(SHARP_WITHIN_DEGREES)).toBe('sharp-right')
    expect(turnDirectionFor(180 - STRAIGHT_WITHIN_DEGREES)).toBe('sharp-right')
    expect(turnDirectionFor(180)).toBe('uturn')
    expect(turnDirectionFor(-180)).toBe('uturn')
  })

  it('flips left and right and nothing else', () => {
    expect(turnDirectionFor(-15)).toBe('slight-left')
    expect(turnDirectionFor(-60)).toBe('left')
    expect(turnDirectionFor(-135)).toBe('sharp-left')
    expect(turnDirectionFor(-179)).toBe('uturn')
    expect(turnDirectionFor(-30)).toBe('slight-left')
  })
})

describe('stepsFromLegs', () => {
  it('opens with a compass heading and closes with the destination clause', () => {
    const index = row(30)
    const steps = stepsFromLegs(routeLegs(index, ['a', 'b', 'c'], ['ab', 'bc']))
    // No clause at all, because the only corner here is a junction. The heading and the destination suffix are
    // what survive, and they are the parts that were ever true: "Head south-east" and "your destination" both
    // describe the walk, "at Crossroads" would have described a database row.
    expect(steps.map((step) => step.instruction)).toEqual(['Head south-east', 'Bear left, your destination'])
    expect(steps.map((step) => step.metres)).toEqual([30, 30])
  })

  it('says Continue on the rare interior straight leg, because it has no turn to name', () => {
    // The only leg allowed to be `straight` is the first, since a leg is *created* by a turn — so a
    // hand-built leg list with an interior straight leg is a caller decision, and the wording has to be
    // sensible for it rather than blank.
    const steps = stepsFromLegs([
      { nodeIds: ['a'], edgeIds: [], metres: 10, direction: 'straight', compass: 'north', landmark: 'Gate', reachesDestination: false },
      { nodeIds: ['b', 'c'], edgeIds: ['bc'], metres: 20, direction: 'straight', compass: 'east', landmark: 'Library', reachesDestination: true },
    ])
    expect(steps.map((step) => step.instruction)).toEqual(['Head north to Gate', 'Continue at Library, your destination'])
  })

  it('never prints a dangling "at " when the name is missing', () => {
    const opening = { nodeIds: ['a', 'b'], edgeIds: ['ab'], metres: 5, direction: 'straight' as const, compass: null, landmark: '', reachesDestination: false }
    const turning = { nodeIds: ['b', 'c'], edgeIds: ['bc'], metres: 5, direction: 'left' as const, compass: 'east' as const, landmark: '', reachesDestination: false }
    const steps = stepsFromLegs([opening, turning])
    // The opening leg has no heading to name and no destination clause, so it says two words; the turning
    // leg has no landmark, so it stops after the verb.
    expect(steps.map((step) => step.instruction)).toEqual(['Set off', 'Turn left'])
    expect(steps.map((step) => step.nodeIds)).toEqual([['a', 'b'], ['b', 'c']])
  })
})

describe('stepsReplay', () => {
  it('folds a step list back into the path, counting a joint once', () => {
    const steps: RouteStep[] = [
      { direction: 'straight', instruction: 'x', metres: 1, nodeIds: ['a', 'b'] },
      { direction: 'right', instruction: 'y', metres: 1, nodeIds: ['b', 'c'] },
      { direction: 'left', instruction: 'z', metres: 1, nodeIds: ['c', 'd'] },
    ]
    expect(stepsReplay(steps)).toEqual(['a', 'b', 'c', 'd'])
    expect(stepsReplay([])).toEqual([])
  })

  it('replays the path on 120 random graphs, whichever way the geometry runs', () => {
    const rng = createRandom(BASE_SEED ^ 0x9a7e5)
    for (let trial = 0; trial < 120; trial++) {
      const generated = randomGraph(4 + (trial % 12), rng, { extraEdges: trial % 7, oneWayChance: trial % 3 === 0 ? 0.4 : 0 })
      const index = indexOfGraph(generated)
      // Any list of vertices the index can place is a legal input, so the sweep walks real paths out of a
      // breadth-first order rather than inventing coordinates: `routeLegs` never sees the search.
      const path = index.graph.nodes.map((node) => node.id).slice(0, 2 + (trial % 5))
      const edgeIds = path.slice(1).map(() => 'any')
      const legs = routeLegs(index, path, edgeIds)
      const steps = stepsFromLegs(legs)
      expect(stepsReplay(steps), `trial ${String(trial)}`).toEqual(path)
      // Every leg carries its own turn bucket, and only the opening leg may be `straight`.
      for (const [position, step] of steps.entries()) {
        if (position > 0) expect(step.direction, `trial ${String(trial)}: leg ${String(position)}`).not.toBe('straight')
      }
      expect(steps.reduce((total, step) => total + step.nodeIds.length, 0)).toBe(path.length + steps.length - 1)
    }
  })
})

/* ----------------------------------------------------------------------------------------------------------------
 * `simplifyLegs` — the pass between the geometry and the words.
 *
 * These tests hand the function *legs*, not graphs, because that is its contract: it is a transform on the
 * record `routeLegs` produces, and it must not need a search to be reasoned about. One test runs the whole
 * pipeline, so the claim that the three halves compose is also checked rather than assumed.
 * ---------------------------------------------------------------------------------------------------------------- */

/** A leg with every field the fold might copy filled in, so a wrong copy is visible. */
function legOf(overrides: Partial<RouteLeg> & { metres: number }): RouteLeg {
  return {
    nodeIds: ['p', 'q'],
    edgeIds: ['pq'],
    direction: 'left',
    compass: 'east',
    landmark: 'Corner',
    reachesDestination: false,
    ...overrides,
  } as RouteLeg
}

describe('simplifyLegs', () => {
  it('leaves a list of legs worth reading alone', () => {
    const legs = [legOf({ metres: 100 }), legOf({ metres: 40 }), legOf({ metres: 60.5 })]
    expect(simplifyLegs(legs)).toEqual(legs)
    // One leg is already the shortest possible instruction list: a 4 m leg on its own has nothing to fold into,
    // and inventing a second leg to fold it against would be the pass making the route worse.
    const alone = legOf({ metres: 4 })
    expect(simplifyLegs([alone])).toEqual([alone])
    expect(simplifyLegs([])).toEqual([])
  })

  it('folds a short middle leg into the one it was reached through', () => {
    const legs = [
      legOf({ metres: 100, nodeIds: ['a', 'b'], edgeIds: ['ab'], landmark: 'Gate' }),
      legOf({ metres: 6, nodeIds: ['b', 'c'], edgeIds: ['bc'], direction: 'right', landmark: 'Cycle stand' }),
      legOf({
        metres: 100,
        nodeIds: ['c', 'd'],
        edgeIds: ['cd'],
        direction: 'left',
        landmark: 'Library',
        reachesDestination: true,
      }),
    ]
    const folded = simplifyLegs(legs)
    expect(folded).toHaveLength(2)
    const merged = folded[0] as RouteLeg
    // The joint is counted once, so the leg keeps `nodes = edges + 1` — the shape `routeLegs` produces and
    // `stepsReplay` depends on.
    expect(merged.nodeIds).toEqual(['a', 'b', 'c'])
    expect(merged.edgeIds).toEqual(['ab', 'bc'])
    expect(merged.metres).toBe(106)
    // The survivor's record wins outright: the turn the walker was told about, its heading, its corner.
    expect(merged.direction).toBe('left')
    expect(merged.compass).toBe('east')
    expect(merged.landmark).toBe('Gate')
    expect(merged.reachesDestination).toBe(false)
    // And the turn *out* of the stub is still told, because the third leg was never touched.
    expect(folded[1]?.direction).toBe('left')
    expect(folded[1]?.landmark).toBe('Library')
    expect(folded[1]?.reachesDestination).toBe(true)
  })

  it('folds below the threshold and not at it, on both sides', () => {
    const shortLeg = legOf({ metres: MIN_INSTRUCTION_METRES - 0.1, nodeIds: ['a', 'b'], edgeIds: ['ab'] })
    const exactLeg = legOf({ metres: MIN_INSTRUCTION_METRES, nodeIds: ['b', 'c'], edgeIds: ['bc'] })
    const longLeg = legOf({ metres: MIN_INSTRUCTION_METRES + 0.1, nodeIds: ['c', 'd'], edgeIds: ['cd'] })
    expect(simplifyLegs([longLeg, shortLeg, exactLeg])).toHaveLength(2)
    expect(simplifyLegs([longLeg, exactLeg, longLeg, shortLeg])).toHaveLength(3)
    // The threshold is `>=`, so exactly 20 m is a leg worth a sentence. 19.9 is fourteen seconds of walking
    // less than that, and it is noise: the boundary is where the decision lives, so it is pinned on both sides
    // rather than quoted.
    expect(MIN_INSTRUCTION_METRES).toBe(20)
  })

  it('keeps the ", your destination" clause when the last leg is the short one', () => {
    const legs = [
      legOf({ metres: 200, nodeIds: ['a', 'b'], edgeIds: ['ab'] }),
      legOf({ metres: 8, nodeIds: ['b', 'c'], edgeIds: ['bc'], reachesDestination: true }),
    ]
    const folded = simplifyLegs(legs)
    expect(folded).toHaveLength(1)
    expect(folded[0]?.reachesDestination).toBe(true)
    expect(stepsFromLegs(folded)[0]?.instruction).toContain('your destination')
  })

  it('folds a short opening leg forward, keeping the first heading', () => {
    const legs = [
      legOf({ metres: 5, nodeIds: ['a', 'b'], edgeIds: ['ab'], direction: 'straight', compass: 'north-east', landmark: 'Archive' }),
      legOf({ metres: 120, nodeIds: ['b', 'c'], edgeIds: ['bc'], direction: 'right', compass: 'south', landmark: 'Lamp' }),
    ]
    const folded = simplifyLegs(legs)
    expect(folded).toHaveLength(1)
    const only = folded[0] as RouteLeg
    expect(only.nodeIds).toEqual(['a', 'b', 'c'])
    expect(only.metres).toBe(125)
    // An opening leg is the only one whose direction is `'straight'`, and the compass is the walker's first
    // heading: both belong to the sentence "Head north-east to the Archive", which stays true even though the
    // walk bends 5 m in. The *second* leg's wording would have been "Turn right at the Lamp" — for 5 m of
    // walking, which is why the fold keeps the opening record instead.
    expect(only.direction).toBe('straight')
    expect(only.compass).toBe('north-east')
    expect(only.landmark).toBe('Archive')
    expect(stepsFromLegs(folded)[0]?.instruction).toBe('Head north-east to Archive')
  })

  it('collapses a route made entirely of stubs into one instruction', () => {
    const legs = [1, 2, 3, 4, 5].map((i) =>
      legOf({
        metres: 4,
        nodeIds: [`n${String(i - 1)}`, `n${String(i)}`],
        edgeIds: [`e${String(i)}`],
        reachesDestination: i === 5,
      }),
    )
    const folded = simplifyLegs(legs)
    expect(folded).toHaveLength(1)
    expect(folded[0]?.nodeIds).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
    expect(folded[0]?.metres).toBe(20)
    expect(folded[0]?.reachesDestination).toBe(true)
    expect(folded[0]?.direction).toBe('left')
  })

  it('never lets the threshold fall below the point where two nodes are the same place', () => {
    // A caller asking for no threshold at all still gets `MIN_SEGMENT_METRES`'s fold, because a leg of half a
    // metre is arithmetic noise and not a corner. This is the whole reason the floor is `Math.max`: without it
    // a zero threshold would be a way to turn the pass off, and the pass exists to be off-nothing.
    const stubs = [
      legOf({ metres: 100, nodeIds: ['a', 'b'], edgeIds: ['ab'] }),
      legOf({ metres: 0.4, nodeIds: ['b', 'c'], edgeIds: ['bc'] }),
      legOf({ metres: 0.6, nodeIds: ['c', 'd'], edgeIds: ['cd'] }),
      legOf({ metres: 0.4, nodeIds: ['d', 'e'], edgeIds: ['de'] }),
    ]
    // `0.4` folds into the 100 m leg, `0.6` survives the floor and `0.4` folds into it: two sentences, and the
    // 0.6 one is the only turn a walker could physically tell apart from standing still.
    expect(simplifyLegs(stubs, { minLegMetres: 0 })).toHaveLength(2)
    expect(simplifyLegs(stubs, { minLegMetres: 0 })[1]?.metres).toBe(1.0)
    expect(MIN_SEGMENT_METRES).toBe(0.5)
    // A threshold above 0.6 leaves nothing standing but the first sentence.
    expect(simplifyLegs(stubs, { minLegMetres: 10 })).toHaveLength(1)
  })

  it('takes a configurable threshold, because a plaza and a campus are not the same noise floor', () => {
    const legs = [
      legOf({ metres: 60, nodeIds: ['a', 'b'], edgeIds: ['ab'] }),
      legOf({ metres: 40, nodeIds: ['b', 'c'], edgeIds: ['bc'] }),
    ]
    expect(simplifyLegs(legs, { minLegMetres: 30 })).toHaveLength(2)
    expect(simplifyLegs(legs, { minLegMetres: 50 })).toHaveLength(1)
    expect(simplifyLegs(legs, { minLegMetres: 40 }).length).toBe(2)
  })

  it('does not change the walk, on a serpentine with eight corners', () => {
    // Built through the real `routeLegs`, so the composition is what is tested and not three units agreeing.
    const builder = new AdjacencyGraph()
    const ids: NodeId[] = []
    const edgeIds: string[] = []
    const walk = 40
    for (let i = 0; i <= 8; i++) {
      const id = `s${String(i)}`
      builder.addNode({ id, x: i * walk, y: i % 2 === 1 ? 12 : 0, label: `S${String(i)}`, kind: 'junction' })
      ids.push(id)
      if (i > 0) {
        const edgeId = `s${String(i - 1)}-${id}`
        builder.addEdge({ id: edgeId, from: `s${String(i - 1)}`, to: id, metres: walk, attributes })
        edgeIds.push(edgeId)
      }
    }
    const index = builder.seal()
    const legs = routeLegs(index, ids, edgeIds)
    // Every 40 m stretch between two 34° kinks is over the threshold, so on this map the pass is a no-op —
    // which is the most important thing it can do: a simplifier that fires on a normal route is eating turns.
    const kept = simplifyLegs(legs)
    expect(kept).toEqual(legs)
    // Now make every second stretch a stub, and the replay still has to be the same walk.
    const stubBuilder = new AdjacencyGraph()
    const stubIds: NodeId[] = []
    const stubEdges: string[] = []
    for (let i = 0; i <= 8; i++) {
      const id = `t${String(i)}`
      stubBuilder.addNode({ id, x: i * walk, y: i % 2 === 1 ? 12 : 0, label: `T${String(i)}`, kind: 'junction' })
      stubIds.push(id)
      if (i > 0) {
        const edgeId = `t${String(i - 1)}-${id}`
        stubBuilder.addEdge({
          id: edgeId,
          from: `t${String(i - 1)}`,
          to: id,
          metres: i % 2 === 1 ? 4 : walk,
          attributes,
        })
        stubEdges.push(edgeId)
      }
    }
    const stubIndex = stubBuilder.seal()
    const rawLegs = routeLegs(stubIndex, stubIds, stubEdges)
    const folded = simplifyLegs(rawLegs)
    expect(folded.length).toBeLessThan(rawLegs.length)
    expect(stepsReplay(stepsFromLegs(folded))).toEqual(stubIds)
    expect(stepsReplay(stepsFromLegs(rawLegs))).toEqual(stubIds)
    // Length is conserved across the fold, to the tenth-of-a-metre rounding the legs already carry.
    const total = folded.reduce((sum, l) => sum + l.metres, 0)
    expect(Math.abs(total - rawLegs.reduce((sum, l) => sum + l.metres, 0))).toBeLessThanOrEqual(0.05 * folded.length)
  })
})

describe('the turn buckets, at their boundaries', () => {
  it('changes word exactly where the constant says, from -180 to 180', () => {
    // The sweep is written against the exported thresholds rather than against the literals, so moving
    // `SLIGHT_WITHIN_DEGREES` moves the expectation with it and a drift between the table and the code is
    // impossible. A quarter-degree step lands on both sides of all four boundaries (15, 60, 135, 165)
    // because they are whole degrees, which is the point: a boundary you cannot straddle is a boundary you
    // cannot test.
    const expected = (degrees: number): TurnDirection => {
      const magnitude = Math.abs(degrees)
      if (magnitude > 180 - STRAIGHT_WITHIN_DEGREES) return 'uturn'
      if (magnitude < STRAIGHT_WITHIN_DEGREES) return 'straight'
      const side = degrees > 0 ? 'right' : 'left'
      const qualifier =
        magnitude >= SHARP_WITHIN_DEGREES ? 'sharp-' : magnitude >= SLIGHT_WITHIN_DEGREES ? '' : 'slight-'
      return `${qualifier}${side}` as TurnDirection
    }
    for (let degrees = -180; degrees <= 180; degrees += 0.25) {
      const angle = Math.round(degrees * 100) / 100
      expect(turnDirectionFor(angle), `${String(angle)}°`).toBe(expected(angle))
    }
    // And the straddle itself, spelled out, because a loop over both sides of a boundary proves the table and
    // these four lines prove which side is which.
    expect(turnDirectionFor(STRAIGHT_WITHIN_DEGREES - 0.25)).toBe('straight')
    expect(turnDirectionFor(STRAIGHT_WITHIN_DEGREES)).toBe('slight-right')
    expect(turnDirectionFor(SLIGHT_WITHIN_DEGREES - 0.25)).toBe('slight-right')
    expect(turnDirectionFor(SLIGHT_WITHIN_DEGREES)).toBe('right')
    expect(turnDirectionFor(SHARP_WITHIN_DEGREES - 0.25)).toBe('right')
    expect(turnDirectionFor(SHARP_WITHIN_DEGREES)).toBe('sharp-right')
    expect(turnDirectionFor(180 - STRAIGHT_WITHIN_DEGREES)).toBe('sharp-right')
    expect(turnDirectionFor(180 - STRAIGHT_WITHIN_DEGREES + 0.25)).toBe('uturn')
    expect(turnDirectionFor(180)).toBe('uturn')
    expect(turnDirectionFor(-180)).toBe('uturn')
  })
})
