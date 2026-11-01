import { describe, expect, it } from 'vitest'
import { BASE_SEED, LruModel, createRandom } from '../__tests__/helpers'
import { LRUCache } from './lru-cache'

/**
 * The reference is an array with splice-and-push: O(n) per touch, no pointers, no invariants to
 * maintain. It cannot share a bug with a doubly linked list, which is the only reason to believe
 * the comparison.
 *
 * Recency convention on both sides: the model's last element is the cache's `#head`, so
 * `cache.keys()` is `model.keys()` reversed.
 */
function expectSameStateAs(
  cache: LRUCache<string, number>,
  model: LruModel,
  label: string,
): void {
  expect(cache.keys(), `${label} — key order`).toEqual([...model.keys()].reverse())
  expect(cache.size, `${label} — size`).toBe(model.size)
  const stats = cache.stats
  expect(stats.hits, `${label} — hits`).toBe(model.hits)
  expect(stats.misses, `${label} — misses`).toBe(model.misses)
  expect(stats.evictions, `${label} — evictions`).toBe(model.evictions)
  expect(cache.consistency(), `${label} — list integrity`).toEqual([])
}

describe('LRUCache', () => {
  it('starts empty, counts only real reads and reports its capacity', () => {
    const cache = new LRUCache<string, number>(3)
    expect(cache.capacity).toBe(3)
    expect(cache.size).toBe(0)
    expect(cache.isEmpty).toBe(true)
    expect(cache.isFull).toBe(false)
    expect(cache.keys()).toEqual([])
    expect(cache.entries()).toEqual([])
    expect(cache.victim()).toBeUndefined()
    expect(cache.get('nope')).toBeUndefined()
    expect(cache.peek('nope')).toBeUndefined()
    expect(cache.has('nope')).toBe(false)
    const stats = cache.stats
    expect([stats.hits, stats.misses, stats.evictions, stats.puts, stats.deletes]).toEqual([
      0, 1, 0, 0, 0,
    ])
    expect(stats.hitRate).toBe(0)
    expect(cache.consistency()).toEqual([])
  })

  it('stores and returns values, MRU first', () => {
    const cache = new LRUCache<string, number>(3)
    cache.put('a', 1)
    cache.put('b', 2)
    cache.put('c', 3)
    expect(cache.get('b')).toBe(2)
    // c was inserted last, so it is newer than a; b overtakes both by being read.
    expect(cache.keys()).toEqual(['b', 'c', 'a'])
    expect(cache.entries()).toEqual([
      { key: 'b', value: 2 },
      { key: 'c', value: 3 },
      { key: 'a', value: 1 },
    ])
    expect(cache.isFull).toBe(true)
  })

  it('evicts the least recently used entry and reports the victim', () => {
    const cache = new LRUCache<string, number>(2)
    cache.put('a', 1)
    cache.put('b', 2)
    expect(cache.put('c', 3)).toBe('a')
    expect(cache.has('a')).toBe(false)
    expect(cache.keys()).toEqual(['c', 'b'])
    expect(cache.size).toBe(2)
    expect(cache.stats.evictions).toBe(1)
  })

  it('promotes on read, so the next victim changes', () => {
    const cache = new LRUCache<string, number>(2)
    cache.put('a', 1)
    cache.put('b', 2)
    expect(cache.get('a')).toBe(1) // a is now newer than b
    expect(cache.put('c', 3)).toBe('b')
    expect(cache.keys()).toEqual(['c', 'a'])
  })

  it('peek and has are probes: no promotion, no counters', () => {
    const cache = new LRUCache<string, number>(2)
    cache.put('a', 1)
    cache.put('b', 2)
    expect(cache.peek('a')).toBe(1)
    expect(cache.has('a')).toBe(true)
    expect(cache.put('c', 3)).toBe('a') // a was NOT refreshed
    expect(cache.keys()).toEqual(['c', 'b'])
    const stats = cache.stats
    expect([stats.hits, stats.misses]).toEqual([0, 0])
  })

  it('updates an existing key in place: promoted, no duplicate, no eviction', () => {
    const cache = new LRUCache<string, number>(2)
    cache.put('a', 1)
    cache.put('b', 2)
    expect(cache.put('a', 11)).toBeUndefined()
    expect(cache.size).toBe(2)
    expect(cache.keys()).toEqual(['a', 'b'])
    expect(cache.get('a')).toBe(11)
    expect(cache.stats.evictions).toBe(0)
    expect(cache.consistency()).toEqual([])
  })

  it('holds exactly one entry at capacity 1', () => {
    const cache = new LRUCache<string, number>(1)
    cache.put('a', 1)
    expect(cache.isFull).toBe(true)
    expect(cache.victim()).toBe('a')
    expect(cache.put('b', 2)).toBe('a')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.keys()).toEqual(['b'])
    expect(cache.size).toBe(1)
  })

  it('capacity 0 stores nothing and is not a crash', () => {
    // This is how the UI disables the cache: a working policy, not a null check per call site.
    const cache = new LRUCache<string, number>(0)
    expect(cache.capacity).toBe(0)
    expect(cache.put('a', 1)).toBeUndefined()
    expect(cache.size).toBe(0)
    expect(cache.isEmpty).toBe(true)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.has('a')).toBe(false)
    expect(cache.keys()).toEqual([])
    expect(cache.stats.evictions).toBe(0)
    expect(cache.consistency()).toEqual([])
  })

  it('refuses a capacity that is not a non-negative integer', () => {
    expect(() => new LRUCache<string, number>(1.5)).toThrow(RangeError)
    expect(() => new LRUCache<string, number>(-1)).toThrow(RangeError)
    expect(() => new LRUCache<string, number>(Number.NaN)).toThrow(RangeError)
    expect(() => new LRUCache<string, number>(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(new LRUCache<string, number>(0).capacity).toBe(0)
  })

  it('deletes from the front, the middle and the back', () => {
    const cache = new LRUCache<string, number>(4)
    for (const [index, key] of ['a', 'b', 'c', 'd'].entries()) cache.put(key, index)
    expect(cache.keys()).toEqual(['d', 'c', 'b', 'a'])
    expect(cache.delete('d')).toBe(true) // head
    expect(cache.delete('b')).toBe(true) // tail
    expect(cache.delete('c')).toBe(true) // only 'a' left
    expect(cache.keys()).toEqual(['a'])
    expect(cache.victim()).toBe('a')
    expect(cache.delete('nothing')).toBe(false)
    expect(cache.delete('a')).toBe(true)
    expect(cache.isEmpty).toBe(true)
    expect(cache.consistency()).toEqual([])
    expect(cache.stats.deletes).toBe(4)
  })

  it('counts hits, misses and the rate, and resetStats zeroes them', () => {
    const cache = new LRUCache<string, number>(2)
    cache.put('a', 1)
    cache.get('a')
    cache.get('a')
    cache.get('gone')
    expect(cache.stats).toEqual({
      hits: 2,
      misses: 1,
      evictions: 0,
      puts: 1,
      deletes: 0,
      size: 1,
      capacity: 2,
      hitRate: 2 / 3,
    })
    cache.resetStats()
    expect(cache.stats.hitRate).toBe(0)
    expect(cache.stats.size).toBe(1) // contents are not a counter
  })

  it('clear() drops both structures and keeps the capacity', () => {
    const cache = new LRUCache<string, number>(2)
    cache.put('a', 1)
    cache.put('b', 2)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.capacity).toBe(2)
    expect(cache.keys()).toEqual([])
    expect(cache.consistency()).toEqual([])
    expect(cache.put('c', 3)).toBeUndefined() // room again, no eviction
    expect(cache.keys()).toEqual(['c'])
  })

  it('victim() tracks the tail, and a read moves it', () => {
    const cache = new LRUCache<string, number>(3)
    expect(cache.victim()).toBeUndefined() // nothing to evict from an empty cache
    cache.put('a', 1)
    cache.put('b', 2)
    expect(cache.victim()).toBe('a') // still room, but 'a' is first in line
    cache.put('c', 3)
    expect(cache.victim()).toBe('a')
    cache.get('a')
    expect(cache.victim()).toBe('b')
    expect(cache.delete('b')).toBe(true)
    expect(cache.victim()).toBe('c')
  })

  it('agrees with an array-based model over 40 trials of 320 random operations', () => {
    const rng = createRandom(BASE_SEED + 101)
    const keys = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']
    for (let trial = 0; trial < 40; trial++) {
      const capacity = rng.int(5) // includes 0, the sink case
      const cache = new LRUCache<string, number>(capacity)
      const model = new LruModel(capacity)
      for (let step = 0; step < 320; step++) {
        const key = rng.pick(keys) as string
        const roll = rng.int(10)
        if (roll < 4) {
          const value = rng.int(1000)
          expect(cache.put(key, value), `trial ${trial} step ${step} victim`).toBe(
            model.put(key, value),
          )
        } else if (roll < 7) {
          expect(cache.get(key)).toBe(model.get(key))
        } else if (roll === 7) {
          expect(cache.peek(key)).toBe(model.peek(key))
        } else if (roll === 8) {
          expect(cache.delete(key)).toBe(model.delete(key))
        } else {
          expect(cache.has(key)).toBe(model.keys().includes(key))
        }
        expectSameStateAs(cache, model, `trial ${trial} step ${step}`)
      }
    }
  })
})
