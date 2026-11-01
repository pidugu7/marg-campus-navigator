# Algorithms &amp; data structures

One section per required item. Each is implemented in `src/engine/structures/`, specified in a
collocated `*.spec.ts`, and used by at least one feature — so that "we wrote it" and "we needed
it" are both true. Sections 1–5 are written; 6–11 are the plan from Phase 0, kept here so every
algorithm has its claim stated *before* it is implemented.

| # | Structure / algorithm | Module | Used for | Status |
| --- | --- | --- | --- | --- |
| 1 | binary min-heap | `structures/min-heap.ts` | frontier in Dijkstra and A\* | **done** (Phase 1) |
| 2 | trie | `structures/trie.ts` | place-name typeahead | **done** (Phase 1) |
| 3 | union-find | `structures/union-find.ts` | components at build time, closure resilience | **done** (Phase 1) |
| 4 | LRU cache | `structures/lru-cache.ts` | memoised route results | **done** (Phase 1) |
| 5 | adjacency graph | `structures/graph.ts` | the `GraphIndex` every algorithm reads | **done** (Phase 1) |
| 6 | BFS | `algorithms/bfs.ts` | hop-shortest path, k-hop reachability | pending (Phase 3) |
| 7 | DFS | `algorithms/dfs.ts` | cycle check, articulation points / bridges | pending (Phase 3) |
| 8 | Dijkstra | `algorithms/dijkstra.ts` | exact weighted shortest path | pending (Phase 3) |
| 9 | A\* | `algorithms/a-star.ts` | default router on the 2D plane | pending (Phase 3) |
| 10 | cost profiles | `routing/cost.ts` | fastest / shaded / step-free / quiet | pending (Phase 4) |
| 11 | turn-by-turn | `algorithms/path-utils.ts` | directions text from a path | pending (Phase 3) |

Every spec is seeded (`src/engine/__tests__/helpers.ts`, mulberry32, no `Math.random` anywhere in
`src/engine`), and each property test compares against a deliberately naive reference model rather
than against a second copy of the implementation. 95 tests, 98.9% line coverage over the engine.

---

## 1. Binary min-heap — `MinHeap<T>`

**Why it exists.** Dijkstra and A\* are, at heart, "take the smallest tentative distance,
forever". Re-sorting the frontier per extract is O(V log V) *each time*; a heap makes it O(log n)
once. Written by hand because writing it is the assignment.

**Interface.** `new MinHeap(compare, initial?)`, `push`, `pop`, `peek`, `size`, `isEmpty`,
`drain()`, `toArray()`, `clear()`, `operations`, `resetOperations()`, `static heapify`,
`static byPriority` / `byPriority()`, and `isHeapOrdered()` — the O(n) invariant checker, public
only so the spec can run it after every operation.

**Invariant.** For every index `i > 0` with parent `p = (i-1)>>1`: `compare(items[p], items[i]) <=
0`. One flat array, so children of `i` are `2i+1`/`2i+2`, no node objects are ever allocated, and
the heap never copies or owns the items it holds.

**Complexity.** build O(n) via Floyd (sift-down from the last internal node) · push O(log n) ·
pop O(log n) · peek O(1) · drain O(n log n) · memory O(n) for one array.

**Decrease-key: the decision, and the reason.**
An *indexed* heap keeps a `key → position` map and sifts an entry up when its priority drops: no
duplicate entries, O(log n) updates, but the structure has to know the caller's identity space and
every `push`/`pop`/`swap` pays for keeping that map in step. This engine uses **lazy deletion**
instead — push a fresh entry per successful relaxation, and on pop discard it when
`popped.distance > best[popped.id]`. The heap stays a pure comparator container that Dijkstra and
A\* share unchanged, at the cost of up to O(E) entries instead of O(V). For a campus graph of a
few thousand edges that ceiling is irrelevant, and the skip is two readable lines in
`dijkstra.ts`, whereas a position map is exactly where a bug hides. Phase 4's benchmark reports
pushes-per-query next to expanded nodes, so the duplication factor is a measured number rather
than a claim.

**What the specs pin.** Order audited after *every* operation across 60 interleaved sequences of
200 steps; `drain()` vs `Array.sort` on 500 random arrays; the multiset conserved over 5 000
operations (nothing lost, nothing invented) with each pop checked against the test's own minimum;
duplicates preserved (a heap is not a set); heapify and repeated push agreeing on 40 trials;
**zero swaps** when heapifying sorted input, which is the evidence that the build is O(n) and not
a disguised sort; a 2 000-element all-ties case showing membership survives while order does not.

**Found while testing.** Two of my own expectations were wrong in ways worth writing down. A heap
is not a stable sort, so "drain() equals Array.sort" is false for equal keys — `0` vs `-0` is the
sharpest case, since `<`/`>` calls them equal; the spec now uses distinct values for sequence
equality and multiset equality everywhere else. And pop output is *not* globally monotone when
pushes interleave, so the monotonicity assertion belongs on the final drain only; asserting it
mid-stream failed against a correct heap.

## 2. Trie — `Trie<TPayload>`

**Why it exists.** The search box must answer "which of ~400 names start with what is typed" on
every keystroke. `labels.filter(startsWith)` is O(total characters) per keystroke and slows down as
the dataset grows; the trie is O(len(prefix) + matches) and indifferent to size. It is also where
aliases live, so "lib", "CL" and "Central Library" resolve to one place instead of three searches.

**Interface.** `insert(word, payload)`, `addAlias(alias, payload)`, `has`, `lookup`,
`startsWith`, `countUnder`, `complete(prefix, limit?)`, `records()`, `remove(word)`,
`removeKey(word, payload)`, `clear()`, `size` (records), `keyCount` (keys), `nodeAt(prefix)` (test
view), plus the two exported rules `normaliseWord` and `compareMatches`.

**Model.** A **key** is a normalised word; each key maps to a *list* of records, so two places
sharing a name stay two results instead of merging silently. A **record** is one payload:
`(label, primaryKey, keys, words)`. Registering an existing payload under a new word adds an alias
to that record; it never creates a second record. A repeated `(word, payload)` pair is a no-op,
and the first as-written spelling wins so the label never depends on the casing of whichever call
arrived second.

**Ranking.** Shortest label first, then normalised key, then insertion sequence. The last tier is
not decoration: two records with the same label length *and* the same key otherwise have no defined
order, and an undefined order in a dropdown is a UI that reorders itself between renders.
`<`/`>` is used instead of `localeCompare` so results do not depend on the host's ICU data.

**Complexity.** O(|key|) per insert, lookup and removal. Space O(total characters), shared prefixes
stored once — which is the whole reason not to reach for "sorted array + binary search" here.

**Invariants the specs pin.** `normaliseWord` applied on both sides (case, marks, whitespace runs)
while punctuation is kept, because "Lab-2" and "Lab 2" are different places in a campus dataset; a
word that is also a prefix of another stays findable at an internal node; `countUnder` and
`nodeAt(...).passes()` equal a from-scratch recount of the subtree after every random operation;
`complete` equals a brute-force filter over 30 trials × 120 operations × 11 probe prefixes × 3
limits; removal prunes dead branches (`nodeAt('a')` becomes `undefined`) and an alias removal
promotes the oldest surviving spelling *as written* (`CL`, not `cl`).

**Found while testing.** Two real bugs, both in the alias bookkeeping, both found by the
removal/pruning tests rather than by any happy path:
1. `addAlias` linked the new key into the trie and the key index but never recorded it on the
   record, and `remove` finds the keys to detach by walking the record's own spellings — so an
   alias could never be removed, and it outlived the record it pointed at.
2. `removeKey` deleted the last spelling *before* delegating to the full-record drop, which then
   no longer saw that key: the record vanished from the payload index while its key stayed in the
   trie, and `complete()` returned a ghost result.

## 3. Union–find — `UnionFind`, `buildComponents`

**Why it exists.** Two jobs, both about reachability rather than distance. At build time: separating
"no route exists" from "no route was found", in O(α(n)) instead of running a search to exhaustion.
In the resilience view: "which places are stranded if this walkway closes" is
`buildComponents(graph, { blockedEdges })` — a rebuild over the surviving edges, no second
algorithm and no copy of the graph.

**Interface.** `new UnionFind(elements?)`, `add`, `has`, `find`, `union`, `connected`,
`componentCount`, `elementCount`, `sizeOf`, `members`, `components()`, `elements()`, `stats`,
`resetStats()`, plus `depthOf`/`maxDepth` — non-compressing probes that exist so "union by rank
keeps trees shallow" is a measured claim. `buildComponents(graph, { blockedEdges?, skip? })`
returns `{ count, componentOf, members, isolated, ignoredEdges, unionFind }`.

**Guarantees.** Path compression via a second pass that re-parents the whole search path, counted
only when a pointer actually moves; union by rank with ties broken by element order, so two runs
over the same data build the same forest; `find`/`union`/`depthOf` on an unknown element **throw**
rather than inventing a singleton, while `connected`/`sizeOf`/`members` answer softly, because a
probe is not an error.

**Complexity.** O(α(n)) amortised per operation (α ≤ 4 for any n a campus reaches); O(n log n)
worst case before compression has run; O(n) space for three maps.

**Semantics worth stating plainly.** Components are **weak**: a one-way walkway still joins its
endpoints. That answers "could these two places ever be in the same region"; whether you can *get*
from A to B along a one-way path is reachability, which is BFS's job in Phase 3. A node whose only
edge is a self-loop counts as `isolated` — incident, but stranded, which is the answer a router
needs.

**What the specs pin.** Partitions equal a BFS component count over 200 random graphs, and again
over the same graphs with random closures, with `isolated` recomputed independently each step
(membership compared group-by-group in one canonical order on both sides); the rank bound
`maxDepth ≤ ⌈log₂ n⌉` verified at n = 5 000 with 10 000 random unions, with a companion
assertion that the depth is not trivially zero; `componentCount` after 10 000 *random* unions stays
strictly between 1 and n (random unions do not connect a graph, and a test that claimed 1 would
have ratified a bug); compression counted exactly once per path and not again on the second `find`;
`blockedEdges` read by reference, so one Set mutation plus a rebuild is the whole cost of a sweep —
the evidence behind "blocking never clones the graph".

**Found while testing.** `depthOf` must walk from the *element*, not from the root. A version that
started at the root returned 0 for every node and still passed the `maxDepth ≤ log₂ n` property
test, because 0 ≤ 13; the fix is the exact-depth case (`[0,1,1,2]` on a hand-built tree), and the
lesson is that an upper-bound property test needs a case *at* the bound, not merely under it.

## 4. LRU cache — `LRUCache<K, V>`

**Why it exists.** The router is asked the same question repeatedly — same origin, same
destination, same profile, every time a slider is nudged back — and an unbounded memo in a tab open
all day is a leak. So: bounded, with an eviction policy, which needs recency order, which needs the
list. That chain is why a "simple cache" in this project has two data structures in it.

**Interface.** `new LRUCache(capacity)`, `get`, `put` (**returns the evicted key**), `has`, `peek`,
`delete`, `clear`, `keys()` (MRU→LRU), `entries()`, `victim()`, `size`, `isEmpty`, `isFull`,
`capacity`, `stats`, `resetStats()`, `consistency()`.

**Why not `Map` insertion order.** `map.delete(k); map.set(k, v)` on every read *looks* like an LRU
and is O(1). It is rejected for one reason: it makes `get` a mutation whose effect is only visible
by iterating the whole map, so two callers can disagree about who is oldest depending on whether
someone peeked, and "who gets evicted" stops being a property of the data. Here `Map` owns
key→node lookup and the list owns order, so `get` re-links in O(1) and `keys()` never consults the
map.

**Guarantees.** O(1) `get`/`put`/`has`/`delete`, nothing ever scans, and a hit allocates nothing.
`get`/`put` refresh recency; `has`/`peek` change neither recency nor the counters, so a debug
overlay cannot skew the hit rate Phase 4 measures. Updating an existing key promotes in place — no
duplicate node, no eviction. Capacity 0 is legal and stores nothing, which is how the UI turns
caching off without a null check at every call site; a non-integer or negative capacity throws.

**Complexity.** O(1) time per operation, O(capacity) space.

**What the specs pin.** Full agreement with an array-based model (`splice` + `push`, O(n) per
touch) over 40 trials × 320 random operations — same keys in the same order, same size, same
hit/miss/eviction counts after *every* step — plus the classic a,b,c → `get(a)` → `put(d)` evicts-b
sequence, head/middle/tail deletion, `victim()` tracking the tail as reads move it, and
`consistency()` after every operation: forward walk, backward walk, agreement with the map, and
each list node being the object the map holds. A stale `prev` does not throw; it evicts the wrong
entry three operations later in a different test, which is why the checker runs constantly rather
than at the end.

## 5. Adjacency graph — `AdjacencyGraph`, `validateGraph`

**Why it exists.** `Graph` in `types.ts` is two arrays, which is the right shape for a file on disk
and the wrong shape for a search: "who is next to me?" against an edge list is O(E) per vertex,
turning Dijkstra into O(V·E). The adjacency list is built once at load, so every neighbour lookup
after that is O(deg).

**Interface.** `addNode`, `addEdge` (undirected ⇒ stored **both** directions, one-way ⇒ one),
`removeEdge`, `seal()`, then `graph`, `neighboursOf`, `edgesAt`, `degree`, `edgeBetween`, `node`,
`edge`, `hasNode`, `size`, `edgeCount`, `arcCount`, `componentOf`, `components({blockedEdges?,
skip?})`, `toGraph()`, `validate()`. Plus `createGraph(nodes, edges, { bounds?, seal? })` and
`validateGraph(graph, { bounds?, cost? })`.

**Two lifecycle states, enforced at runtime.** Before `seal()` the traversal reads throw: reading a
half-built graph returns an empty adjacency list, which is indistinguishable from an unreachable
place, and that is a bug that ships. After `seal()` the mutators throw and every node, edge,
attribute bag and adjacency array is frozen — so an algorithm may hold an adjacency array for its
whole run without copying, and **blocking an edge never clones the graph**: a closure is a
`ReadonlySet<EdgeId>` passed to the walk and to the cost function. `removeEdge` exists only on the
construction side, for a loader that decides an imported walkway does not exist.

**Complexity.** construction O(V + E) · neighbour iteration O(deg) · `componentOf` O(α) after one
O(V + E) precompute · `validate` O(V + E). Memory O(V + E), with one frozen object per node and
edge shared by every snapshot the UI draws.

**Validation.** `validateGraph(snapshot, { bounds?, cost? })` is a pure function over any snapshot —
including JSON the map editor produced, which never passed through the builder — returning
`GraphIssue[]` sorted by severity, then code, then id so two runs on the same file give a diffable
report. Errors: `duplicate-node-id`, `duplicate-edge-id`, `dangling-edge-endpoint`, `self-loop`,
`non-positive-length`, `non-positive-cost`, `non-finite-coordinate`. Warnings: `isolated-node`,
`node-outside-canvas`, `attribute-out-of-range`. `non-positive-cost` is deliberately separate from
`non-positive-length`: metres can be perfectly legal while the *weighted* cost is zero, and a zero
cost breaks Dijkstra's settle-once invariant — but only a supplied `EdgeCost` can see it, so the
check is opt-in.

**What the specs pin.** Every rejection path (duplicate/blank id, self-loop, unknown endpoint,
zero/negative/NaN length, NaN coordinate, out-of-range `crowd`, non-finite `slope`) leaves the
graph exactly as it was; `arcCount` arithmetic re-derived against an independent count on 100
random graphs, with every stored edge proven reachable from both endpoints (or exactly one, if it
is one-way); parallel edges allowed and `edgeBetween` answering with the first stored; `zone`
absent as a key rather than `zone: undefined`; frozen snapshot proven by attempting mutation;
`toGraph()` a copy that can be appended to and cannot reach back; the default partition untouched
by a blocked rebuild; and the two smallest cases — the empty graph, and the single node, which is
valid, is its own component, **and** is reported as stranded.

**Found while testing.** Incidence and adjacency are not the same thing. The first version
recorded an edge id only on the `from` side, so a one-way walkway left the node it *leaves*
claiming nothing touched it: `edgesAt` and `degree` were wrong for every one-way edge on the map,
and the highlight-on-select feature would have quietly missed half the incident edges. Storing the
edge in both endpoints' incident lists, while `#out` keeps direction, is the fix;
`stores an undirected edge twice and a one-way edge once` pins it.

## 6–11. Graph algorithms (pending)

Claims to be tested, stated now so they cannot be quietly softened later:

- **BFS** is hop-shortest, and equals Dijkstra when every weight is 1.
- **DFS** finds articulation points; every reported cut vertex must actually disconnect the graph
  when removed, verified by rebuilding without it.
- **Dijkstra** matches a brute-force oracle on small random graphs and settles each node once under
  non-negative costs.
- **A\*** returns the same *cost* as Dijkstra on every fixture pair while expanding **fewer or
  equal** vertices. If A\* is not cheaper on this map, the heuristic is wrong — and that test is
  what will say so.
- Turn-by-turn output must be replayable: following the emitted steps reproduces the node path.

## Benchmarks (Phase 4)

`npm run bench` writes a Markdown table into **Measured results** below. Timings vary by machine,
so the generated table must record **Node version, platform, CPU model and count, total memory**,
plus commit and dataset size, above the numbers. A benchmark without its environment is a rumour.

Planned: Dijkstra vs A\* expanded-node ratio per profile; lazy-deletion duplication factor (pushes ÷
expansions); trie vs `Array.filter` at 1 000 labels; LRU hit rate and mean lookup over a recorded
query trace; `buildComponents` rebuild cost per closure (the number that justifies not cloning).

## Measured results

*(populated in Phase 4. Nothing above is a measurement; the numbers cited so far — 95 tests, the
n = 5 000 rank-bound case, 500/5 000/120-step property trials — are all from `npm test`.)*
