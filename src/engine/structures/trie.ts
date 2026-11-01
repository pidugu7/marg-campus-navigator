/**
 * A prefix trie over normalised place names, with aliases.
 *
 * ### Why this exists here
 * The search box has to answer "which of the campus's names start with what the user has typed so
 * far" on every keystroke. `labels.filter((label) => label.startsWith(query))` is
 * O(total characters in the dataset) per keystroke, so it gets slower exactly when the campus gets
 * bigger; a trie is O(len(prefix) + matches) and does not care how many names it holds. It is also
 * where aliases live, which is the difference between search that knows "CL" and search that does
 * not.
 *
 * ### Invariant
 * For a node reached by string `p`: the set of registered keys under it is exactly
 * `{ k | normalise(k) starts with p }`, and a key is registered iff its terminal node lists it.
 * Consequences the specs pin: a word that is itself a prefix of another stays findable at an
 * internal node; no node is ever left holding neither keys nor children (deletion prunes); and
 * `countUnder(p)` equals a recount of the subtree.
 *
 * ### Model: keys, records, and why they are separate
 * A **key** is a normalised word. A **record** is one place: `(label, primaryKey, aliases,
 * payload)`. Each key maps to a *list* of records, because two buildings genuinely called "Gate"
 * are two results, not one merged entry. That separation is also what makes `addAlias` cheap: an
 * alias is one more key pointing at the same record, never a copy of it.
 *
 * ### Ranking
 * Shortest label first, then normalised key lexicographically, then insertion order. The last tier
 * is not decoration: two records with equal label length *and* equal key (the same word used by two
 * places) otherwise have no defined order, and an undefined order in a dropdown is a UI that
 * reorders itself. Comparisons use `<`/`>` rather than `localeCompare` so the order never depends on
 * the host's ICU data — the same reason `compareNumbers` exists in the test helpers.
 *
 * ### Complexity
 * O(|key|) per insert, lookup and removal. Space is O(total characters) with shared prefixes stored
 * once, which is the whole reason not to reach for a sorted array plus binary search: that wins on
 * memory only when names do not share prefixes, and campus names share nothing but 'A'.
 */

/** Default cap on `complete()`, so a one-character query cannot return the whole campus. */
const DEFAULT_LIMIT = 8

/** One place (or one searchable name for a payload) as search sees it. */
export interface TrieRecord<TPayload> {
  /** The as-written spelling of `key` — what the UI displays. */
  readonly label: string
  /** The normalised key the label was registered under. */
  readonly key: string
  /** Every normalised key that resolves to this record, primary key first. */
  readonly keys: readonly string[]
  /** As-written spellings, in registration order, including the label. */
  readonly words: readonly string[]
  readonly payload: TPayload
}

/** One row of a `complete()` result: a record reached through one particular key. */
export interface TrieMatch<TPayload> {
  readonly label: string
  /** The key that actually matched the typed prefix — not always the record's primary key. */
  readonly matchedKey: string
  readonly payload: TPayload
  readonly record: TrieRecord<TPayload>
}

/** A node of the trie, exposed for tests that need to look at shape. */
export interface TrieNode<TPayload> {
  readonly char: string
  readonly children: ReadonlyMap<string, TrieNode<TPayload>>
  /** Keys that terminate exactly here. */
  readonly keys: ReadonlySet<string>
  /** Records reachable from this node, including through descendants. */
  passes(): number
}

/** Anything rankable; both `TrieRecord` and the internal match shape satisfy it. */
interface Rankable {
  readonly label: string
  readonly key: string
}

interface RecordState<TPayload> {
  label: string
  primaryKey: string
  /** normalised key -> as-written spelling, for every key pointing at this record. */
  readonly spellings: Map<string, string>
  readonly payload: TPayload
  readonly sequence: number
}

/**
 * Fold a name down to what it is indexed by: Unicode-normalise, drop diacritics, lowercase,
 * collapse runs of whitespace, trim. Punctuation is *kept* on purpose: "Lab-2" and "Lab 2" are
 * different places in a campus dataset, and silently merging them is worse than a missed match.
 */
export function normaliseWord(word: string): string {
  return word
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The order `complete()` and `records()` use. Exported because the spec ranks with the same
 * function it is testing, and a ranking rule that lives in two places is a rule that drifts: the
 * test compares *membership* against a brute-force filter and only reuses this comparator where
 * the ordering itself is the subject.
 */
export function compareMatches(a: Rankable, b: Rankable): number {
  if (a.label.length !== b.label.length) return a.label.length - b.label.length
  if (a.key < b.key) return -1
  if (a.key > b.key) return 1
  return 0
}

class Node<TPayload> implements TrieNode<TPayload> {
  readonly children = new Map<string, Node<TPayload>>()
  readonly keys = new Set<string>()

  readonly char: string

  constructor(char: string) {
    this.char = char
  }

  passes(): number {
    let total = this.keys.size
    for (const child of this.children.values()) total += child.passes()
    return total
  }
}

export class Trie<TPayload> {
  static readonly DEFAULT_LIMIT = DEFAULT_LIMIT

  readonly #root = new Node<TPayload>('')
  readonly #byKey = new Map<string, RecordState<TPayload>[]>()
  readonly #byPayload = new Map<TPayload, RecordState<TPayload>>()
  #serial = 0

  /** Number of records (places), which is not the number of searchable words. */
  get size(): number {
    return this.#byPayload.size
  }

  /** Number of distinct normalised keys, i.e. words plus aliases. */
  get keyCount(): number {
    return this.#byKey.size
  }

  /**
   * Register `word` for `payload`. Re-registering the same pair changes nothing; registering an
   * existing payload under a *different* word adds an alias, and registering a new payload under an
   * existing word creates a second record there.
   */
  insert(word: string, payload: TPayload): this {
    const key = normaliseWord(word)
    if (key.length === 0) throw new TypeError('Trie.insert requires a non-empty word')
    const existing = this.#byPayload.get(payload)
    if (existing !== undefined) {
      // A payload already in the index never becomes a second record: a new word for it is an
      // alias. A repeated word is a no-op — the first as-written spelling wins, so the label does
      // not depend on the casing of whichever call happened to arrive second.
      if (existing.spellings.has(key)) return this
      existing.spellings.set(key, word)
      this.#link(existing, key)
      return this
    }
    const state: RecordState<TPayload> = {
      label: word,
      primaryKey: key,
      spellings: new Map([[key, word]]),
      payload,
      sequence: this.#serial++,
    }
    this.#link(state, key)
    this.#byPayload.set(payload, state)
    return this
  }

  /**
   * Point another word at the same record. An alias never changes the label — "CL" resolves to
   * "Central Library", not the other way round — because the label is what the dropdown shows.
   *
   * The record has to learn about the alias as well as the trie: {@link remove} unregisters a
   * record by walking its own spelling map, so a key that exists only in the trie would outlive
   * the record it pointed at. That is not a hypothetical — it is what the first version of this
   * method did, and `remove() deletes the record and every alias` is the test that found it.
   */
  addAlias(alias: string, payload: TPayload): this {
    const key = normaliseWord(alias)
    if (key.length === 0) throw new TypeError('Trie.addAlias requires a non-empty alias')
    const state = this.#byPayload.get(payload)
    if (state === undefined) {
      throw new RangeError(
        `Trie.addAlias: payload has no record to attach to — insert "${alias}" first`,
      )
    }
    if (state.spellings.has(key)) return this
    state.spellings.set(key, alias)
    this.#link(state, key)
    return this
  }

  has(word: string): boolean {
    return this.#byKey.has(normaliseWord(word))
  }

  /** Records registered under exactly this word, in rank order. */
  lookup(word: string): TrieRecord<TPayload>[] {
    const states = this.#byKey.get(normaliseWord(word))
    if (states === undefined) return []
    return states.map((state) => this.#view(state)).sort((a, b) => compareMatches(a, b))
  }

  /** Does any key start with this prefix? `''` is true for a non-empty trie. */
  startsWith(prefix: string): boolean {
    const normalised = normaliseWord(prefix)
    if (normalised.length === 0) return this.keyCount > 0
    return this.#node(normalised) !== undefined
  }

  /** How many distinct keys live under `prefix`; 0 when the path does not exist. */
  countUnder(prefix: string): number {
    const normalised = normaliseWord(prefix)
    const node = normalised.length === 0 ? this.#root : this.#node(normalised)
    return node === undefined ? 0 : node.passes()
  }

  /**
   * Prefix search, ranked and truncated. `''` returns the beginning of the whole index, which is
   * what the search overlay shows before the user types.
   */
  complete(prefix: string, limit: number = DEFAULT_LIMIT): TrieMatch<TPayload>[] {
    const normalised = normaliseWord(prefix)
    const node = normalised.length === 0 ? this.#root : this.#node(normalised)
    if (node === undefined || limit <= 0) return []

    const found: { match: TrieMatch<TPayload>; sequence: number }[] = []
    const seen = new Set<TPayload>
    this.#collect(node, normalised, (key, state) => {
      // One row per payload: a place reachable through two matching aliases is one result.
      if (seen.has(state.payload)) return
      seen.add(state.payload)
      found.push({
        match: {
          label: state.label,
          matchedKey: key,
          payload: state.payload,
          record: this.#view(state),
        },
        sequence: state.sequence,
      })
    })
    return found
      .sort((a, b) => compareMatches(a.match.record, b.match.record) || a.sequence - b.sequence)
      .slice(0, limit)
      .map((entry) => entry.match)
  }

  /** Every record, in the order `complete` would rank them. */
  records(): TrieRecord<TPayload>[] {
    const rows = [...this.#byPayload.values()].map((state) => ({
      record: this.#view(state),
      sequence: state.sequence,
    }))
    return rows
      .sort((a, b) => compareMatches(a.record, b.record) || a.sequence - b.sequence)
      .map((row) => row.record)
  }

  /**
   * Delete the record addressed by `word` — as a primary key or as an alias — including every
   * alias it registered. When
   * several records share that word, the earliest-inserted one goes — the same one `lookup()[0]`
   * shows. Use {@link removeKey} to unregister a single spelling instead.
   */
  remove(word: string): boolean {
    const key = normaliseWord(word)
    const states = this.#byKey.get(key)
    if (states === undefined) return false
    const victim = [...states].sort((a, b) => a.sequence - b.sequence)[0]
    if (victim === undefined) return false
    this.#dropState(victim)
    return true
  }

  /**
   * Unregister one spelling of one record. If that spelling was the record's primary key, the
   * oldest surviving alias takes over the label *with its own as-written spelling* — a place known
   * as "CL" should display "CL", not "cl", and certainly not the normalised form.
   */
  removeKey(word: string, payload: TPayload): boolean {
    const key = normaliseWord(word)
    const state = this.#byPayload.get(payload)
    if (state === undefined || !state.spellings.has(key)) return false
    // Last spelling: hand the whole record to #dropState, which detaches keys by walking the
    // record's own spellings. Deleting the key first would leave it behind in the trie and in
    // #byKey, and complete() would keep returning a record that no longer exists.
    if (state.spellings.size === 1) {
      this.#dropState(state)
      return true
    }
    state.spellings.delete(key)
    const keys = this.#byKey.get(key)
    if (keys !== undefined) {
      const index = keys.indexOf(state)
      if (index >= 0) keys.splice(index, 1)
      if (keys.length === 0) {
        this.#byKey.delete(key)
        this.#detachKey(key)
      }
    }
    if (state.primaryKey === key) {
      const promoted = [...state.spellings.entries()][0]
      if (promoted !== undefined) {
        state.primaryKey = promoted[0]
        state.label = promoted[1]
      }
    }
    return true
  }

  clear(): void {
    this.#root.children.clear()
    this.#root.keys.clear()
    this.#byKey.clear()
    this.#byPayload.clear()
  }

  /** The node for a prefix, or undefined if the path does not exist. */
  nodeAt(prefix: string): TrieNode<TPayload> | undefined {
    return this.#node(normaliseWord(prefix))
  }

  // --- internals -----------------------------------------------------------------------------

  #view(state: RecordState<TPayload>): TrieRecord<TPayload> {
    return {
      label: state.label,
      key: state.primaryKey,
      keys: [...state.spellings.keys()],
      words: [...state.spellings.values()],
      payload: state.payload,
    }
  }

  #node(prefix: string): Node<TPayload> | undefined {
    let current: Node<TPayload> = this.#root
    for (const char of prefix) {
      const next = current.children.get(char)
      if (next === undefined) return undefined
      current = next
    }
    return current
  }

  #link(state: RecordState<TPayload>, key: string): void {
    const existing = this.#byKey.get(key)
    if (existing === undefined) this.#byKey.set(key, [state])
    else existing.push(state)
    let current = this.#root
    for (const char of key) {
      let next = current.children.get(char)
      if (next === undefined) {
        next = new Node<TPayload>(char)
        current.children.set(char, next)
      }
      current = next
    }
    current.keys.add(key)
  }

  /** Delete a record entirely: every key it owned, then the trie nodes those keys kept alive. */
  #dropState(state: RecordState<TPayload>): void {
    for (const key of [...state.spellings.keys()]) {
      const keys = this.#byKey.get(key)
      if (keys !== undefined) {
        const index = keys.indexOf(state)
        if (index >= 0) keys.splice(index, 1)
        if (keys.length === 0) {
          this.#byKey.delete(key)
          this.#detachKey(key)
        }
      }
    }
    state.spellings.clear()
    if (this.#byPayload.get(state.payload) === state) this.#byPayload.delete(state.payload)
  }

  /**
   * Remove a key from its terminal node and prune ancestors that no longer lead anywhere. Without
   * this, deleting every word starting with 'a' leaves an 'a' node with no keys and no children,
   * and `startsWith('a')` answers true forever.
   */
  #detachKey(key: string): void {
    const path: Node<TPayload>[] = [this.#root]
    let current: Node<TPayload> | undefined = this.#root
    for (const char of key) {
      current = current?.children.get(char)
      if (current === undefined) return
      path.push(current)
    }
    current.keys.delete(key)
    for (let index = path.length - 1; index > 0; index--) {
      const node = path[index] as Node<TPayload>
      if (node.keys.size > 0 || node.children.size > 0) return
      const parent = path[index - 1] as Node<TPayload>
      parent.children.delete(node.char)
    }
  }

  /** Depth-first over the subtree, reporting every (key, record) pair below `node`. */
  #collect(
    node: Node<TPayload>,
    prefix: string,
    visit: (key: string, state: RecordState<TPayload>) => void,
  ): void {
    for (const key of node.keys) {
      const states = this.#byKey.get(key)
      if (prefix.length > 0 && !key.startsWith(prefix)) continue
      for (const state of states ?? []) visit(key, state)
    }
    for (const child of node.children.values()) this.#collect(child, prefix, visit)
  }
}

