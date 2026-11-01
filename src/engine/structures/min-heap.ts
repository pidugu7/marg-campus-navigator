/**
 * A binary min-heap over a caller-supplied comparator.
 *
 * ### Why this exists here
 * Dijkstra and A* are, at heart, "take the smallest tentative distance, forever". Re-sorting the
 * frontier for every extract is O(V log V) *per extract*; a heap makes it O(log n) once. The
 * coursework is a data-structures course, so the heap is written rather than imported — and it is
 * kept a pure comparator container so both searches can share one implementation.
 *
 * ### Invariant
 * For every index `i > 0` with parent `p = (i - 1) >> 1`:
 *
 *     compare(items[p], items[i]) <= 0
 *
 * so the global minimum is always at index 0 and every root-to-leaf path is non-decreasing. No
 * ordering is claimed between siblings, and none is needed. `isHeapOrdered()` is the O(n) audit of
 * exactly this property; it is public only so `min-heap.spec.ts` can run it after *every*
 * operation, not just at the end of a sequence.
 *
 * ### Backing store
 * One flat array, no node objects. Children of `i` are `2i + 1` and `2i + 2`, so a swap is three
 * assignments and the cache stays friendly. It also means the heap never owns the items it holds:
 * `push` stores the reference it was given, and nothing is copied on the way out.
 *
 * ### decrease-key: the decision, and the reason
 * An **indexed** heap keeps a `key → position` map and sifts an entry up when its priority drops,
 * giving O(log n) decreases and no duplicate entries. It costs a second mutable data structure
 * that must be updated on every push, pop and swap — and a forgotten update there does not throw,
 * it just returns a slightly wrong route.
 *
 * This engine uses **lazy deletion** instead: when a relaxation improves a vertex, push a new
 * entry, and on pop discard any entry whose distance is now greater than `best[id]`. The heap
 * stays exactly the simple structure above and the policy lives in two readable lines in
 * `dijkstra.ts` (Phase 3). The price is up to O(E) entries in the frontier instead of O(V), which
 * at campus scale is a few thousand small objects. A position map is where this algorithm
 * historically goes wrong; a duplicate entry is where it goes right, slowly. Phase 4's benchmark
 * reports pushes per query next to expanded nodes, so if the duplication ever matters, it will
 * show up as a number and not as a rumour.
 */


/** Standard ordering callback: negative when `a` sorts before `b`. */
export type HeapComparator<T> = (a: T, b: T) => number

/** One broken parent/child pair, as reported by {@link MinHeap.isHeapOrdered}. */
export interface HeapViolation {
  readonly index: number
  readonly parent: number
  readonly message: string
}

/** Operation counts, for the benchmark and for tests that assert work was actually done. */
export interface HeapOperations {
  readonly pushes: number
  readonly pops: number
  readonly comparisons: number
  readonly swaps: number
}

const parentOf = (index: number): number => (index - 1) >> 1
const leftOf = (index: number): number => 2 * index + 1

export class MinHeap<T> {
  readonly #compare: HeapComparator<T>
  readonly #items: T[] = []
  #pushes = 0
  #pops = 0
  #comparisons = 0
  #swaps = 0

  /**
   * @param compare total ordering; ties may return 0, the heap does not break them and does not
   *   claim to be stable.
   * @param initial items to load, heapified in O(n) rather than pushed one at a time.
   */
  constructor(compare: HeapComparator<T>, initial: readonly T[] = []) {
    this.#compare = compare
    this.#items.push(...initial)
    this.#build()
  }

  /** Reads like the caller's intent, and is the same operation. */
  static heapify<T>(items: readonly T[], compare: HeapComparator<T>): MinHeap<T> {
    return new MinHeap(compare, items)
  }

  /**
   * The comparator Dijkstra and A* use: a queue entry carrying a `priority` sorts by that number
   * and by nothing else. Exported so the searches do not each invent their own, since a comparator
   * that quietly returns 0 for unequal priorities produces a frontier that works on small graphs
   * and misorders large ones.
   */
  static byPriority<U extends { readonly priority: number }>(): HeapComparator<U> {
    return byPriority<U>()
  }

  get size(): number {
    return this.#items.length
  }

  get isEmpty(): boolean {
    return this.#items.length === 0
  }

  get operations(): HeapOperations {
    return {
      pushes: this.#pushes,
      pops: this.#pops,
      comparisons: this.#comparisons,
      swaps: this.#swaps,
    }
  }

  /** O(log n) amortised. Returns the heap, so a caller can chain pushes in a test. */
  push(item: T): this {
    this.#pushes++
    this.#items.push(item)
    this.#siftUp(this.#items.length - 1)
    return this
  }

  /** The minimum without removing it, or `undefined` for an empty heap. O(1). */
  peek(): T | undefined {
    return this.#items[0]
  }

  /** Remove and return the minimum, or `undefined` for an empty heap. O(log n). */
  pop(): T | undefined {
    this.#pops++
    const items = this.#items
    if (items.length === 0) return undefined
    const minimum = items[0] as T
    const last = items.pop() as T
    if (items.length > 0) {
      items[0] = last
      this.#siftDown(0)
    }
    return minimum
  }

  /**
   * Everything, in pop order. O(n log n), and the shape every property test in this project uses
   * because it turns "is the heap right" into "is this array sorted" — a question with a
   * one-line answer.
   */
  drain(): T[] {
    const out: T[] = []
    // `pop()` shrinks the heap, so this loop has no terminating condition to read off the index.
    for (;;) {
      if (this.#items.length === 0) return out
      const next = this.pop()
      if (next !== undefined) out.push(next)
    }
  }

  /**
   * The raw backing order — a valid heap, emphatically *not* a sorted array. Exposed for the map
   * overlay's "what is in the frontier right now" view and for tests that want to look at shape.
   */
  toArray(): readonly T[] {
    return [...this.#items]
  }

  /** Forget every item. Counters are kept: they describe the heap's lifetime, not its contents. */
  clear(): void {
    this.#items.length = 0
  }

  /**
   * Audit the invariant without changing anything: O(n), one comparison per non-root node.
   * Empty array means ordered. Deliberately not counted in {@link operations} — a check is not an
   * operation, and a test that runs it after every step would otherwise measure its own overhead.
   */
  isHeapOrdered(): HeapViolation[] {
    const violations: HeapViolation[] = []
    const items = this.#items
    for (let index = 1; index < items.length; index++) {
      const parent = parentOf(index)
      if (this.#compare(items[parent] as T, items[index] as T) > 0) {
        violations.push({
          index,
          parent,
          message: `items[${parent}] sorts after items[${index}], so ${index} should have bubbled up`,
        })
      }
    }
    return violations
  }

  /**
   * Reset the counters. Benchmarks only: a phase-4 run measures pushes per query, and it needs the
   * number for one query rather than for the page's lifetime.
   */
  resetOperations(): void {
    this.#pushes = 0
    this.#pops = 0
    this.#comparisons = 0
    this.#swaps = 0
  }

  /**
   * Floyd's linear build: sift down from the last internal node upwards. Most nodes are leaves and
   * every early node has a short path to the bottom, so the total work is O(n), not the O(n log n)
   * you get by pushing in turn. The spec proves it by asserting `swaps === 0` on sorted input.
   */
  #build(): void {
    const items = this.#items
    for (let index = parentOf(items.length - 1); index >= 0; index--) this.#siftDown(index)
  }

  #less(a: T, b: T): boolean {
    this.#comparisons++
    return this.#compare(a, b) < 0
  }

  #swap(left: number, right: number): void {
    const items = this.#items
    const held = items[left] as T
    items[left] = items[right] as T
    items[right] = held
    this.#swaps++
  }

  #siftUp(start: number): void {
    const items = this.#items
    let index = start
    while (index > 0) {
      const parent = parentOf(index)
      if (!this.#less(items[index] as T, items[parent] as T)) return
      this.#swap(index, parent)
      index = parent
    }
  }

  #siftDown(start: number): void {
    const items = this.#items
    const length = items.length
    let index = start
    for (;;) {
      const left = leftOf(index)
      if (left >= length) return
      const right = left + 1
      const smaller =
        right < length && this.#less(items[right] as T, items[left] as T) ? right : left
      if (!this.#less(items[smaller] as T, items[index] as T)) return
      this.#swap(smaller, index)
      index = smaller
    }
  }
}

/**
 * The frontier entry every search in this engine pushes. It lives here because both searches need
 * it, and because `priority` is the only field the comparator is allowed to look at — the payload
 * stays opaque, which is what lets BFS, Dijkstra and A* share one heap class.
 */
export interface HeapEntry<TId> {
  readonly priority: number
  readonly id: TId
}

/**
 * The comparator Dijkstra and A* use: a queue entry sorts by `priority` and by nothing else.
 * Standalone rather than only a static, because `contract.spec.ts` asserts the barrel publishes it
 * — the searches are meant to take this exact function, not each write their own.
 */
export function byPriority<T extends { readonly priority: number }>(): HeapComparator<T> {
  return (a, b) => (a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : 0)
}
