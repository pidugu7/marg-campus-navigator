import { describe, expect, it } from 'vitest'
import { BASE_SEED, compareNumbers, createRandom, sameMultiset, sortedByReference } from '../__tests__/helpers'
import { MinHeap, byPriority, type HeapComparator, type HeapViolation } from './min-heap'

/**
 * Every loop here is driven by a fixed seed, so a failure is reproducible by reading the number
 * out of the test name. `Math.random` is not used anywhere in `src/engine`.
 */

interface Weighted {
  readonly priority: number
  readonly id: number
}

const byLengthThenText: HeapComparator<string> = (a, b) =>
  a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)

/**
 * The audit runs after *every* operation, not at the end of a sequence: a heap that is briefly
 * wrong and then repaired by the next sift looks identical in a final-output test, and "briefly
 * wrong" is exactly what a frontier mid-search is allowed to be.
 */
function expectOrdered<T>(heap: MinHeap<T>, label: string): void {
  const violations: HeapViolation[] = heap.isHeapOrdered()
  expect(violations, label).toEqual([])
}

describe('MinHeap', () => {
  it('answers emptily without throwing', () => {
    const heap = new MinHeap<number>(compareNumbers)
    expect(heap.size).toBe(0)
    expect(heap.isEmpty).toBe(true)
    expect(heap.peek()).toBeUndefined()
    expect(heap.pop()).toBeUndefined()
    expect(heap.drain()).toEqual([])
    expect(heap.toArray()).toEqual([])
    expect(heap.isHeapOrdered()).toEqual([])
  })

  it('pops numbers in ascending order', () => {
    const heap = new MinHeap<number>(compareNumbers, [9, 3, 7, 1, 5])
    expect(heap.size).toBe(5)
    expect(heap.drain()).toEqual([1, 3, 5, 7, 9])
    expect(heap.isEmpty).toBe(true)
  })

  it('is ordered by the comparator and nothing else', () => {
    const heap = new MinHeap<string>(byLengthThenText, ['bbb', 'a', 'cc', 'dd', ''])
    expect(heap.drain()).toEqual(['', 'a', 'cc', 'dd', 'bbb'])
  })

  it('holds parent ≤ child after every operation across 60 interleaved sequences', () => {
    const rng = createRandom(BASE_SEED + 11)
    for (let sequence = 0; sequence < 60; sequence++) {
      const heap = new MinHeap<number>(compareNumbers)
      const held: number[] = []
      for (let step = 0; step < 200; step++) {
        if (held.length === 0 || rng.bool(0.6)) {
          const value = rng.int(1000)
          heap.push(value)
          held.push(value)
        } else {
          const expected = Math.min(...held)
          held.splice(held.indexOf(expected), 1)
          expect(heap.pop(), `sequence ${sequence} step ${step}`).toBe(expected)
        }
        expectOrdered(heap, `sequence ${sequence} step ${step}`)
      }
      expect(heap.drain()).toEqual(sortedByReference(held, compareNumbers))
    }
  })

  it('drains exactly like Array.sort on 500 random arrays', () => {
    // Values are distinct by construction (a shuffled range plus an index offset). With ties,
    // drain() and sort() legitimately disagree: a heap is not a stable sort.
    const rng = createRandom(BASE_SEED + 23)
    for (let trial = 0; trial < 500; trial++) {
      const length = rng.int(80)
      const offset = rng.int(500) - 250
      const values = rng.shuffle(Array.from({ length }, (_, i) => i * 3 + offset))
      const heap = new MinHeap<number>(compareNumbers, values)
      expect(heap.drain(), `trial ${trial}`).toEqual(sortedByReference(values, compareNumbers))
    }
  })

  it('conserves the multiset over 5000 interleaved pushes and pops', () => {
    // Nothing may be lost, duplicated or invented. Ordering alone would pass with a heap that
    // silently drops an entry now and then, so every pop is also checked against the minimum of
    // what the test is independently holding.
    const rng = createRandom(BASE_SEED + 37)
    const heap = new MinHeap<number>(compareNumbers)
    const inserted: number[] = []
    const removed: number[] = []
    const held: number[] = []
    for (let step = 0; step < 5000; step++) {
      if (held.length === 0 || rng.bool(0.55)) {
        const value = rng.int(50)
        heap.push(value)
        held.push(value)
        inserted.push(value)
      } else {
        const expected = Math.min(...held)
        const value = heap.pop() as number
        // No monotonicity assertion here on purpose: pops are only non-decreasing between pushes,
        // and pushes interleave. `toBe(expected)` against the test's own minimum is the stronger
        // claim; monotone extraction is checked on the final drain below.
        expect(value, `step ${step}`).toBe(expected)
        held.splice(held.indexOf(expected), 1)
        removed.push(value)
      }
    }
    const remaining = heap.drain()
    expect(heap.size).toBe(0)
    expect(remaining).toEqual(sortedByReference(held, compareNumbers))
    expect(sameMultiset([...removed, ...remaining], inserted)).toBe(true)
  })

  it('keeps duplicates: a heap is not a set', () => {
    const heap = new MinHeap<number>(compareNumbers, [7, 7, 7, 7, 7])
    expect(heap.size).toBe(5)
    expect(heap.drain()).toEqual([7, 7, 7, 7, 7])
  })

  it('builds by heapify and by repeated push to the same result', () => {
    const rng = createRandom(BASE_SEED + 41)
    for (let trial = 0; trial < 40; trial++) {
      const values = Array.from({ length: rng.int(60) }, () => rng.int(1000))
      const built = MinHeap.heapify(values, compareNumbers)
      const pushed = new MinHeap<number>(compareNumbers)
      for (const value of values) pushed.push(value)
      expect(built.drain()).toEqual(pushed.drain())
    }
  })

  it('performs zero swaps when heapifying already-sorted input', () => {
    // The claim is that `heapify` is an O(n) build, not a disguised sort. On ascending input every
    // sift-down is a no-op, so a linear-time build swaps nothing at all.
    const sorted = Array.from({ length: 4000 }, (_, i) => i)
    const heap = MinHeap.heapify(sorted, compareNumbers)
    expect(heap.operations.swaps).toBe(0)
    expect(heap.drain()).toEqual(sorted)
  })

  it('survives 2000 identical priorities: membership is kept, order is not promised', () => {
    const items: Weighted[] = Array.from({ length: 2000 }, (_, id) => ({ priority: 0, id }))
    const heap = new MinHeap<Weighted>(byPriority<Weighted>(), items)
    const drained = heap.drain()
    expect(drained).toHaveLength(2000)
    expect(drained.every((entry) => entry.priority === 0)).toBe(true)
    expect(sameMultiset(drained.map((entry) => entry.id), items.map((entry) => entry.id))).toBe(true)
  })

  it('peek reports the minimum without removing it', () => {
    const heap = new MinHeap<number>(compareNumbers, [4, 2, 8])
    expect(heap.peek()).toBe(2)
    expect(heap.peek()).toBe(2)
    expect(heap.size).toBe(3)
    expect(heap.operations.pops).toBe(0)
  })

  it('clear() drops contents and keeps the counters', () => {
    const heap = new MinHeap<number>(compareNumbers, [3, 1, 2])
    heap.pop()
    heap.push(9)
    heap.clear()
    expect(heap.size).toBe(0)
    expect(heap.peek()).toBeUndefined()
    expect(heap.operations.pushes).toBe(1)
    expect(heap.operations.pops).toBe(1)
    heap.resetOperations()
    expect(heap.operations).toEqual({ pushes: 0, pops: 0, comparisons: 0, swaps: 0 })
  })

  it('toArray is the heap, not a sorted array', () => {
    const heap = new MinHeap<number>(compareNumbers, [5, 4, 3, 2, 1])
    const raw = [...heap.toArray()]
    expect(raw[0]).toBe(1)
    // At least one descent proves the shape is heap order; if this ever passes vacuously because
    // the array happens to be sorted, pick a different fixture rather than delete the assertion.
    expect(
      raw.some((value, index) => index > 0 && value < (raw[index - 1] ?? Number.NEGATIVE_INFINITY)),
    ).toBe(true)
    expect(heap.drain()).toEqual([1, 2, 3, 4, 5])
  })

  it('byPriority reads the priority field and ignores everything else', () => {
    const compare = byPriority<Weighted>()
    expect(compare({ priority: 1, id: 99 }, { priority: 2, id: 0 })).toBe(-1)
    expect(compare({ priority: 2, id: 0 }, { priority: 1, id: 99 })).toBe(1)
    expect(compare({ priority: 5, id: 0 }, { priority: 5, id: 42 })).toBe(0)
    // The static is the same comparator, not a second implementation that could drift.
    expect(MinHeap.byPriority<Weighted>()({ priority: 3, id: 1 }, { priority: 3, id: 0 })).toBe(0)
  })
})
