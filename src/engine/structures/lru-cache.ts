/**
 * Least-recently-used cache: a `Map` for lookup, a hand-written doubly linked list for order.
 *
 * ### Why this exists here
 * The router gets asked the same question over and over — same origin, same destination, same
 * profile, every time the user nudges a slider back to where it was. An unbounded memo in a tab
 * that stays open all day is a leak, so the cache needs a bound, and a bound needs an eviction
 * policy, and an eviction policy needs recency order, and recency order needs the list. That is
 * why a "simple cache" in this project has two data structures in it.
 *
 * ### Why not just use `Map` insertion order
 * `map.delete(key); map.set(key, value)` on every read looks like an LRU and is O(1), and it was
 * the obvious shortcut here. It is rejected for one reason: it makes `get` a mutation whose effect
 * is only observable by iterating the whole map. Two callers can then disagree about who is oldest
 * depending on whether someone peeked, and "who gets evicted" stops being a property of the data.
 * Here the `Map` owns key→node lookup and the list owns order, so `get` re-links in O(1) and
 * {@link LRUCache.keys} reads straight off the list without touching the map at all.
 *
 * ### Invariants
 * - `#head` is the most recently used node, `#tail` the least; walking `next` from head yields
 *   exactly the keys in `#nodes`, in the same order as walking `prev` from tail reversed.
 * - A key is in `#nodes` iff a list node holds it, and never twice.
 * - `#nodes.size <= capacity`, with equality whenever the cache has been filled and not deleted
 *   from.
 * - `get`/`put` refresh recency; `has`/`peek` deliberately do not, so a probe can never change who
 *   survives. That split is the whole difference between this and the `Map` trick above.
 *
 * {@link consistency} audits the first two claims and runs after *every* operation in the spec:
 * a stale `prev` pointer does not throw, it evicts the wrong entry three operations later in a
 * different test.
 *
 * ### Complexity
 * O(1) `get`, `put`, `has`, `delete` — nothing here ever scans. O(capacity) space, and no
 * allocation on a hit: promotion relinks the existing node.
 */

/** One `entries()` row. */
export interface LRUCacheEntry<K, V> {
  readonly key: K
  readonly value: V
}

export interface LRUCacheStats {
  readonly hits: number
  readonly misses: number
  readonly evictions: number
  readonly puts: number
  readonly deletes: number
  readonly size: number
  readonly capacity: number
  /** 0 when nothing has been read yet, rather than NaN — a rate of "no data" is not a rate. */
  readonly hitRate: number
}

interface ListNode<K, V> {
  key: K
  value: V
  prev: ListNode<K, V> | null
  next: ListNode<K, V> | null
}

export class LRUCache<K, V> {
  readonly #nodes = new Map<K, ListNode<K, V>>()
  readonly #capacity: number
  #head: ListNode<K, V> | null = null
  #tail: ListNode<K, V> | null = null
  #hits = 0
  #misses = 0
  #evictions = 0
  #puts = 0
  #deletes = 0

  /**
   * @param capacity Entries kept. `0` is legal and means "store nothing", which is how the UI
   *   turns the cache off without a null check in front of every call.
   * @throws RangeError for a non-integer or negative capacity — a typo there silently changes
   *   measured hit rates, so it is refused rather than clamped.
   */
  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new RangeError(`LRUCache capacity must be a non-negative integer, got ${String(capacity)}`)
    }
    this.#capacity = capacity
  }

  get capacity(): number {
    return this.#capacity
  }

  get size(): number {
    return this.#nodes.size
  }

  get isEmpty(): boolean {
    return this.#nodes.size === 0
  }

  get isFull(): boolean {
    return this.#nodes.size === this.#capacity
  }

  /** Read a value and mark it most recently used. Counts a hit or a miss. */
  get(key: K): V | undefined {
    const node = this.#nodes.get(key)
    if (node === undefined) {
      this.#misses++
      return undefined
    }
    this.#hits++
    this.#promote(node)
    return node.value
  }

  /**
   * Read a value without touching recency, and without counting: a probe is not traffic. If
   * `peek` reported a miss, an overlay that polled the cache would lower the hit rate Phase 4
   * measures, and the number would describe the observer rather than the workload.
   */
  peek(key: K): V | undefined {
    return this.#nodes.get(key)?.value
  }

  /** Membership only — no recency change and no counters, because asking is free. */
  has(key: K): boolean {
    return this.#nodes.has(key)
  }

  /**
   * Insert or update, and return the key that was evicted to make room, if any. Returning the
   * victim (rather than `this` or a boolean) is what lets a caller drop a derived index entry —
   * the route cache will invalidate its reverse lookup, and `void put(...)` is how that bug is
   * born.
   */
  put(key: K, value: V): K | undefined {
    this.#puts++
    const existing = this.#nodes.get(key)
    if (existing !== undefined) {
      existing.value = value
      this.#promote(existing)
      return undefined
    }
    if (this.#capacity === 0) return undefined

    let evicted: K | undefined
    while (this.#nodes.size >= this.#capacity) {
      const victim = this.#unlinkLast()
      if (victim === undefined) break
      this.#nodes.delete(victim.key)
      this.#evictions++
      evicted = victim.key
    }

    const node: ListNode<K, V> = { key, value, prev: null, next: null }
    this.#nodes.set(key, node)
    this.#linkFirst(node)
    return evicted
  }

  delete(key: K): boolean {
    const node = this.#nodes.get(key)
    if (node === undefined) return false
    this.#unlink(node)
    this.#nodes.delete(key)
    this.#deletes++
    return true
  }

  /** Drop everything. Counters are kept: they describe the cache's life, not its contents. */
  clear(): void {
    this.#nodes.clear()
    this.#head = null
    this.#tail = null
  }

  /** Keys, most recently used first — i.e. exactly the eviction order to come. */
  keys(): K[] {
    const out: K[] = []
    for (let cursor = this.#head; cursor !== null; cursor = cursor.next) out.push(cursor.key)
    return out
  }

  entries(): LRUCacheEntry<K, V>[] {
    const out: LRUCacheEntry<K, V>[] = []
    for (let cursor = this.#head; cursor !== null; cursor = cursor.next) {
      out.push({ key: cursor.key, value: cursor.value })
    }
    return out
  }

  /**
   * The least recently used key — what an insert would evict first once the cache is full. It is
   * reported whether or not there is room, because the useful question is "who is next", and
   * "is there room" is already answered by {@link isFull}. `undefined` only when empty.
   */
  victim(): K | undefined {
    return this.#tail?.key
  }

  get stats(): LRUCacheStats {
    const reads = this.#hits + this.#misses
    return {
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      puts: this.#puts,
      deletes: this.#deletes,
      size: this.#nodes.size,
      capacity: this.#capacity,
      hitRate: reads === 0 ? 0 : this.#hits / reads,
    }
  }

  resetStats(): void {
    this.#hits = 0
    this.#misses = 0
    this.#evictions = 0
    this.#puts = 0
    this.#deletes = 0
  }

  /**
   * Walk the list twice and compare it with the map. Empty array means consistent. Every string
   * here names the key involved, because a linked-list bug otherwise shows up as "the wrong route
   * was cached" several operations later.
   */
  consistency(): string[] {
    const errors: string[] = []
    const forward: K[] = []
    let cursor: ListNode<K, V> | null = this.#head
    let previous: ListNode<K, V> | null = null
    while (cursor !== null) {
      if (cursor.prev !== previous) {
        errors.push(`broken back link after ${String(cursor.key)}`)
      }
      if (this.#nodes.get(cursor.key) !== cursor) {
        errors.push(`list node for ${String(cursor.key)} is not the one the map holds`)
      }
      forward.push(cursor.key)
      previous = cursor
      cursor = cursor.next
    }
    let backwardCount = 0
    cursor = this.#tail
    previous = null
    while (cursor !== null) {
      if (cursor.next !== previous) {
        errors.push(`broken forward link before ${String(cursor.key)}`)
      }
      backwardCount++
      previous = cursor
      cursor = cursor.prev
    }
    if (forward.length !== this.#nodes.size) {
      errors.push(`list length ${String(forward.length)} != map size ${String(this.#nodes.size)}`)
    }
    if (forward.length !== backwardCount) {
      errors.push(
        `forward walk ${String(forward.length)} != backward walk ${String(backwardCount)}`,
      )
    }
    if (this.#head === null !== (this.#tail === null)) {
      errors.push('head and tail disagree about emptiness')
    }
    return errors
  }

  // --- list surgery ----------------------------------------------------------------------------

  /** Move `node` to the front. Called on every read, so it must not allocate. */
  #promote(node: ListNode<K, V>): void {
    if (this.#head === node) return
    this.#unlink(node)
    this.#linkFirst(node)
  }

  #linkFirst(node: ListNode<K, V>): void {
    node.prev = null
    node.next = this.#head
    if (this.#head !== null) this.#head.prev = node
    this.#head = node
    if (this.#tail === null) this.#tail = node
  }

  #unlink(node: ListNode<K, V>): void {
    const { prev, next } = node
    if (prev !== null) prev.next = next
    else this.#head = next
    if (next !== null) next.prev = prev
    else this.#tail = prev
    node.prev = null
    node.next = null
  }

  #unlinkLast(): ListNode<K, V> | undefined {
    const victim = this.#tail
    if (victim === undefined || victim === null) return undefined
    this.#unlink(victim)
    return victim
  }
}
