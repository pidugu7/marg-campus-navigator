# Algorithms &amp; data structures

One section per required item. Each is implemented in `src/engine/`, tested in
`src/engine/__tests__/`, and used by at least one feature — the point of this file is to
keep "we wrote it" and "we needed it" both true.

Status legend: **pending** = not written yet · **done** = implemented + tested.

| # | Structure / algorithm | Module | Used for | Status |
| --- | --- | --- | --- | --- |
| 1 | binary min-heap | `structures/min-heap.ts` | frontier in Dijkstra and A\* | pending (Phase 1) |
| 2 | trie | `structures/trie.ts` | place-name typeahead | pending (Phase 1) |
| 3 | union-find | `structures/union-find.ts` | connected components, closure resilience | pending (Phase 1) |
| 4 | LRU cache | `structures/lru-cache.ts` | memoised route results | pending (Phase 1) |
| 5 | adjacency list | `structures/graph.ts` | the `GraphIndex` every algorithm reads | pending (Phase 1) |
| 6 | BFS | `algorithms/bfs.ts` | hop-shortest path, k-hop reachability | pending (Phase 3) |
| 7 | DFS | `algorithms/dfs.ts` | cycle check, articulation points / bridges | pending (Phase 3) |
| 8 | Dijkstra | `algorithms/dijkstra.ts` | exact weighted shortest path | pending (Phase 3) |
| 9 | A\* | `algorithms/a-star.ts` | default router on the 2D plane | pending (Phase 3) |
| 10 | cost profiles | `routing/cost.ts` | fastest / shaded / step-free / quiet | pending (Phase 4) |
| 11 | turn-by-turn | `algorithms/path-utils.ts` | directions text from a path | pending (Phase 3) |

---

## 1. Binary min-heap

**Why here.** Dijkstra and A\* both need "give me the smallest tentative distance" over and
over. Re-sorting an array is O(V log V) per extract; a heap is O(log n). Written by hand
because the whole assignment is writing this by hand.

**Contract.** Comparator-driven, so it is a *min*-heap, a max-heap or a best-first heap
without changing code. `push`, `pop`, `peek`, `size`, `isHeap`, `heapify(array)` in O(n).

**Invariants the tests must pin** (Phase 1):

- heap order holds after every operation, checked exhaustively by `isHeap`;
- `pop` on an empty heap returns `undefined`, never throws;
- arbitrary `heapify` of 5 000 random entries produces a valid heap;
- sift-up and sift-down are exact mirrors (a property test over random insert/extract
  sequences vs. a sorted reference);
- duplicate keys and comparator ties must not lose elements (multiset equality);
- `decreaseKey` is *not* offered: both algorithms reinsert instead, which keeps the heap
  simple and the tests honest about the extra log n.

**Complexity.** build O(n) · push O(log n) · pop O(log n) · peek O(1). Backed by a flat
array, indices `2i+1` / `2i+2`, so no per-node allocation.

## 2. Trie

**Why here.** The search box autocompletes place names as you type over a few hundred
labels. A trie answers "which labels start with `am`" in O(len(prefix) + matches) — no
scanning, no regex, and it costs nothing to also return how many completions sit under a
node.

**Contract.** Insert/search/`startsWith`; `complete(prefix, limit)` returns ranked hits;
`count(prefix)` returns subtree size. Keys normalised (case-fold, trim, collapse spaces) at
insert *and* query time so the normalisation can't drift between the two.

**Invariants the tests must pin:** case/whitespace-insensitive lookup; insertion order
irrelevance; a label that is itself a prefix of another (`Amrita` / `Amrita Viha`) is still
a terminal node; removal of one key leaves shared branches intact; deletion of the last
key prunes its branch so `count` returns to 0; the node/edge counts stay bounded by
`total characters` (a memory claim we should be able to demonstrate).

**Complexity.** O(|key|) per insert/lookup. Space O(total characters), not O(labels × total
characters), which is the reason it beats a sorted array + binary search here.

## 3. Union-find

**Why here.** Two jobs. (a) At graph-build time: which places are in the same walkable
component — "no route exists" must be distinguished from "no route found". (b) In the
resilience view: remove one candidate edge and ask how many components the campus splits
into. Nearly-linear make/b/find is exactly the shape of that query.

**Contract.** `find` with path compression, `union` by size, `components()` returns the
partition, `connected(a,b)`. Element ids are `NodeId` strings, mapped through an index
table owned by the caller.

**Invariants:** after V-1 unions on a connected graph there is exactly 1 component;
`find` is idempotent; union of equal roots is a no-op that does not grow rank; and the
result matches a BFS-based ground truth on the fixtures.

**Complexity.** O(α(V)) amortised per operation (union by size + path compression).

## 4. LRU cache

**Why here.** Route queries repeat: the same origin/destination pair across profile
switches, and a re-selection of the same place. The router memoises by
`from|to|profile|algorithm`; unbounded memoisation in a long-running tab is a leak, so the
cache has a bound and an eviction policy.

**Contract.** `Map` for O(1) lookup + a doubly-linked list for recency. `get` refreshes
recency; `set` on capacity evicts the least-recently-used; re-inserting an existing key
refreshes rather than duplicates. Exposes `stats` (`hits`, `misses`, `evictions`,
`hitRate`) because the UI shows the number — a cache you cannot observe is a cache you
cannot defend.

**Invariants:** capacity 1 behaves; eviction order matches the textbook sequence; a `get`
promotes (so the *accessed* key survives, not the *inserted* one); zero-capacity cache
stores nothing and reports 0 hits.

**Complexity.** O(1) get and set.

## 5–9. Graph algorithms

Filled in as each lands. The claims I intend to test rather than assert:

- **BFS** is hop-shortest, and equals Dijkstra when every weight is 1.
- **DFS** finds articulation points; every reported cut vertex must actually disconnect
  the graph when removed (verified by rebuilding without it).
- **Dijkstra** matches a brute-force oracle on small random graphs, and settles a node
  exactly once with non-negative costs.
- **A\*** returns the *same cost* as Dijkstra on every fixture pair, while expanding
  **fewer or equal** vertices. If A\* is not cheaper on this map, the heuristic is wrong
  and the test is what tells us.
- Turn-by-turn output must be replayable: walking the emitted steps along the path
  reproduces the node sequence.

## Benchmarks (Phase 4)

`npm run bench` writes a Markdown table into this file's `## Measured results` section.
Timings are machine-dependent, so the generated table records **Node version, platform,
CPU model/count and total memory** above the numbers, and every run is labelled with the
commit and dataset size. A benchmark without its environment is a rumour.

Planned measurements: Dijkstra vs A\* expanded-node ratio per profile; trie vs
`Array.filter` on 1 000 labels; LRU hit rate and mean lookup over a recorded query trace;
union-find rebuild vs incremental.

## Measured results

*(populated in Phase 4 — nothing here yet is a measurement, and nothing above is either.)*
