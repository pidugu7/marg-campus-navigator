import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE_ATTRIBUTES } from '../constants'
import { AdjacencyGraph } from '../structures/graph'
import { BASE_SEED, createRandom, indexOfGraph, randomGraph } from '../__tests__/helpers'
import {
  SHARP_WITHIN_DEGREES,
  SLIGHT_WITHIN_DEGREES,
  STRAIGHT_WITHIN_DEGREES,
  routeLegs,
  stepsFromLegs,
  stepsReplay,
  turnDirectionFor,
} from './path-utils'
import type { EdgeAttributes, GraphIndex, RouteStep } from '../types'

/**
 * The translation from a path to a directions list. Everything here is geometry and wording, so none of it
 * needs a search to exercise — which is the point of splitting `path-utils.ts` out of `search-common.ts`.
 */

const attributes: EdgeAttributes = DEFAULT_EDGE_ATTRIBUTES

/**
 * A path along the x axis with one corner at `bend`, whose offset from the axis sets the turn: 0 is
 * straight on, and any non-zero offset large enough is a right-angle corner.
 */
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
    // replay convention `stepsReplay` undoes.
    expect(first.landmark).toBe('Crossroads')
    expect(second.nodeIds).toEqual(['b', 'c'])
    expect(second.compass).toBe('east')
    expect(second.direction).toBe('slight-left')
    expect(second.landmark).toBe('Crossroads')
    expect(second.reachesDestination).toBe(true)
  })

  it('drops the clause when the corner has no name to read, rather than printing its id', () => {
    const builder = new AdjacencyGraph()
    builder.addNode({ id: 'a', x: 0, y: 0, label: 'Gate', kind: 'gate' })
    builder.addNode({ id: 'b', x: 30, y: 30 })
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
    expect(steps.map((step) => step.instruction)).toEqual([
      'Head south-east to Crossroads',
      'Bear left at Crossroads, your destination',
    ])
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
