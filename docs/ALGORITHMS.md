# Algorithms &amp; data structures

One section per required item. Each is implemented in `src/engine/structures/` or
`src/engine/algorithms/`, specified in a collocated `*.spec.ts`, and used by at least one feature — so that
"we wrote it" and "we needed it" are both true. Sections 1–5 are Phase 1, and 8, 11 and 12 are Phase 3 so
far; 6, 7, 9 and 10 are the plan from Phase 0, kept here so every algorithm has its claim stated *before* it
is implemented (the claims are at the end, still in the words they were written in, with the checkpoint that
owes each test).

| # | Structure / algorithm | Module | Used for | Status |
| --- | --- | --- | --- | --- |
| 1 | binary min-heap | `structures/min-heap.ts` | frontier in Dijkstra and A\* | **done** (Phase 1) |
| 2 | trie | `structures/trie.ts` | place-name typeahead | **done** (Phase 1) |
| 3 | union-find | `structures/union-find.ts` | components at build time, closure resilience | **done** (Phase 1) |
| 4 | LRU cache | `structures/lru-cache.ts` | memoised route results | **done** (Phase 1) |
| 5 | adjacency graph | `structures/graph.ts` | the `GraphIndex` every algorithm reads | **done** (Phase 1) |
| 6 | BFS | `algorithms/bfs.ts` | hop-shortest path, k-hop reachability | **done** (Phase 3, cp2) |
| 7 | DFS | `algorithms/dfs.ts` | cycle check, articulation points / bridges | **done** (Phase 3, cp2) |
| 8 | Dijkstra | `algorithms/dijkstra.ts` | exact weighted shortest path | **done** (Phase 3, cp1) |
| 9 | A\* | `algorithms/a-star.ts` | default router on the 2D plane | **done** (Phase 3, cp2) |
| 10 | cost profiles | `routing/cost.ts` | shortest / shaded / lit / step-free / quiet | **done** (Phase 4, cp1) |
| 11 | turn-by-turn | `algorithms/path-utils.ts` | directions text from a path | **done** (Phase 3, cp1 and cp3) |
| 12 | geometric measure | `geo/measure.ts` | compass words, turn angles, and the A\* scale | **done** (Phase 3, cp1) |

Every spec is seeded (`src/engine/__tests__/helpers.ts`, mulberry32, no `Math.random` anywhere in
`src/engine`), and each property test compares against a deliberately naive reference model rather
than against a second copy of the implementation. Phase 3 grows the oracle set: `bellmanFord`,
`floydWarshall`, `minimumHopCounts` and `indexOfGraph` (one place where a generated graph becomes a
sealed `AdjacencyGraph`, so the reference and the implementation are provably arguing about the same
edges). Coverage is reported per module in `npm run test:coverage`; the two arms the report still shows
open in `search-common.ts` are listed as unreachable-by-construction in §8.

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
instead — push a fresh entry per successful relaxation, and on pop discard an entry whose vertex has
already been settled. The heap stays a pure comparator container that Dijkstra and
A\* share unchanged, at the cost of up to O(E) entries instead of O(V). For a campus graph of a
few thousand edges that ceiling is irrelevant, and the skip is one readable line, whereas a position
map is exactly where a bug hides. Phase 4's benchmark reports pushes-per-query next to expanded nodes,
so the duplication factor is a measured number rather than a claim.

**Correction, from mutation testing in Phase 3.** This section originally promised the other textbook
form of the skip — `popped.distance > best[popped.id]`. Both were implemented, then each was removed in
turn with the suite as judge: the `best` comparison left every engine test passing (nothing in the
project could observe it), because under non-negative costs the cheaper entry always pops first, so a
superseded entry can only surface *after* its vertex settled, which the membership test already
swallows. The load-bearing line is the settled-set check, and `search-common.ts` keeps that one alone.

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

## 6. Breadth-first search — `algorithms/bfs.ts`

**What it is for.** The fewest *walkways*, not the fewest metres. That makes BFS the wrong answer to "how do I
get to my class" and the right answer to three questions the app actually asks elsewhere: what is reachable in
`k` steps (Phase 5's explored-region overlay), what a closure strands (Phase 6), and whether a place is
connected to anything at all.

**Complexity.** `O(V + E)` time, `O(V)` frontier. No heap, so no `log V`, and — the property no other search
here has — the running time does not depend on the cost function's *values* at all. `minCostPerUnit` is not
consulted, `metres` are summed but never compared.

**Invariant.** When a vertex leaves the queue, `cost[vertex]` is the minimum number of edges from the origin to
it, and every vertex still in the queue has cost ≥ that. Both halves come from one fact: the queue is FIFO and
every offer from a settled vertex carries cost+1, so costs are non-decreasing along the queue. A shorter route
to `v` would have been discovered from a cheaper-or-equal frontier position and would already have been
popped. `bfs.spec.ts` does not argue this — it computes the same numbers with `minimumHopCounts`, a
level-by-level scan written with `Array.prototype.filter` and no shared code, on **200 seeded graphs × four
sources × every vertex**.

**The `cost` field means something different here, on purpose.** A queue search minimises edges, so `cost` is
the hop count and `metres` is the length of the route it chose. That is why `RouteFound` carries both, and why
the first pinned test in `bfs.spec.ts` is the unflattering one: on the square with a 250 m diagonal,

```
bfs   a → c   path a,c      cost 1     metres 250   expanded 4   explored a,b,d,c
dijkstra a → c   path a,b,c  cost 200   metres 200   expanded 4   explored a,b,d,c
```

Same graph, same closure set, both correct, 50 m apart. `cost` is "what this search was minimising" and never
"metres"; the card shows `metres`.

**Worked example, to the array.** `ladderCrossing()` in `src/engine/__tests__/helpers.ts` is the square `a(0,0)
b(100,0) c(100,-100) d(0,-100)` with 100 m walkways on the sides, the same 250 m diagonal `a—c`, and one edge
id per walkway (a two-way path stores *two arcs under one id*, which is what makes `blockedEdges` mean what
Phase 6 needs it to mean). From `a`:

| pop | settled | why now | pushed by it | queue after the pop | frontier snapshot |
| --- | --- | --- | --- | --- | --- |
| 1 | `a@0` | the seed | `b@1`, `d@1`, `c@1` — all one hop | `b, d, c` | `[]` |
| 2 | `b@1` | first in, first out | `c` is already seen, so refused at the door | `d, c` | `["c","d"]` |
| 3 | `d@1` | next in line | `c` already seen | `c` | `["c"]` |
| 4 | `c@1` | the destination — return | — | empty | `[]` |

Every snapshot is `[cost, id]`-sorted by the same `compareOffers` the heap uses, so a queue search prints
`["c","d"]` where the queue's own order was `d, c`: a replay overlay wants "what would this search consider
next", not "how the arrays happened to be filled".

And the last column is deliberately one step behind the fourth: a snapshot is recorded at the moment `next()`
returns, *before* the caller has expanded what it took — so what a replay draws is the frontier the search was
holding while it chose, not the one it left behind. Row 1's `[]` is that offset, not a missing frame.

**A closure changes which routes exist, not what is optimised.** With `a-c` shut, BFS returns `a,b,c` at 2 hops
and 200 m — the same route Dijkstra returns, for the different reason that there is now nothing shorter in
hops either. And a profile that closes the *edges* of a one-way ring can strand a vertex without touching the
hop count; `bfs.spec.ts` pins the case where an exhausted search's `exploredOrder`, sorted, is exactly
`reachableFrom`'s answer from `dfs.ts` — two containers agreeing on one set.

**Tests.** 17 in `bfs.spec.ts`, of which 7 are the shared refusal ladder (`refusalLadder` in
`src/engine/__tests__/helpers.ts`) — unknown origin, unknown destination, both unknown, empty map, two
components, a destination stranded by closures, a cost function returning `0`/`-1`/`NaN`/`-Infinity`/
`undefined`/`'100'`, all refused with the same `{ reason, message }` dijkstra uses. Then: the diagonal
pin above, non-decreasing settlement on a line (`exploredOrder a,b,c,d` and four empty snapshots — a line's
frontier is never wider than one vertex), the one-way detour, minutes derived from metres and not from hops,
determinism across two runs, the 200-graph hop parity, the unit-profile equality with Dijkstra, and the
mirror test that asserts BFS's route is *never shorter* in metres than Dijkstra's on 120 seeded graphs —
the one cross-algorithm inequality a hop count always satisfies.

---

## 7. Depth-first search — `algorithms/dfs.ts`

**Two questions, two functions, one file.** `dfs` walks **out-arcs only** — the way a walker must actually go —
and answers "what is reachable" and "is there a directed cycle". `articulationPoints` walks the **weak
structure** — every incident edge, direction ignored — and answers "would removing this place cut the campus
in half". They are separate because the answers are genuinely different: a one-way walkway makes a vertex a
cut in the directed sense while severing nothing physically. Phase 6's report prints both numbers, and this
file is where the distinction is enforced rather than remembered.

**Complexity.** Both are `O(V + E)` time and `O(V)` state, in one pass. The articulation pass produces cut
vertices *and* bridges from the same traversal, which is the point of Tarjan's `low` link: a second pass to
find bridges would be a second chance to disagree about the DFS tree.

**Iterative, deliberately.** Every walk here runs on an explicit stack of frames carrying a mutable `cursor`.
The campus is 39 nodes, so recursion would work today; the map editor (Phase 7) will ingest a traced plan of a
few thousand vertices, and a recursive DFS costs one call frame per vertex — a data-dependent graph becomes a
`RangeError` in a browser, in the one place in the app where the data comes from outside. `dfs.spec.ts` walks a
**5 000-vertex line** and asserts the last visit's depth is 4 999, so "it was written iteratively" is a
measured claim and not a style preference.

**Invariant (`dfs`).** A vertex is on the stack exactly while its subtree is open, so: (i) discovery order
`visits` is a pre-order and `postOrder` is the matching post-order; (ii) an edge into a vertex *still open on
the stack* is a back edge, and one exists **iff** the directed graph has a cycle; (iii) `treeEdgeIds` has
exactly `|reachable| − 1` entries, because each records a first discovery.
The cycle test has one deliberate subtlety, and it is the difference between a useful flag and a joke:
walking **back along the walkway you came along does not count**, because a two-way corridor is one edge id
with two arcs. Without that skip, any campus with any corridor in it "has a cycle" — a fact about the data
model, reported as a fact about the map. `dfs.spec.ts` pins both halves: the line reports `cycle: false`, the
square reports `cycle: true` with *two* back edges (the ring, and the diagonal closing a second one).

**Invariant (`articulationPoints`).** With `disc[v]` the discovery index and `low[v]` the smallest `disc`
reachable from `v`'s subtree by at most one non-tree edge: for a non-root `p`, `p` is a cut vertex iff some
child `c` has `low[c] ≥ disc[p]`, and the edge `p—c` is a bridge iff the inequality is strict. A root is a cut
vertex iff it has two or more DFS children — the one test that is not a low-link comparison, and the one most
often omitted. The parent is skipped by **edge id**, never by vertex: skip the vertex and two parallel
walkways between the same pair (a ramp and a stair, legal in this data model by design) are reported as
bridges, which is the classic bug in this algorithm and is pinned as a named test.

**Worked example.** `ladderBarbell()`: `a—b—c—d` with `c—e` and `e—a` closing a loop, so `d` hangs off `c`.
The incident lists are read in edge-insertion order, and that is all the traversal needs.

| vertex | `disc` | `low` | children | conclusion |
| --- | --- | --- | --- | --- |
| `d` | 4 | 4 | 0 | its parent `c` is not a root and `4 > 3`, so `c—d` **is a bridge**; `4 ≥ 3`, so `c` **is a cut vertex** |
| `e` | 5 | 1 | 0 | `e—a` is a back edge to the root, so `low[e] = 1`; `1 < 3` — neither a bridge nor a cut through `c` |
| `c` | 3 | 1 | 2 | inherits `1` from `e`; `1 < disc[b] = 2` → `b—c` is not a bridge |
| `b` | 2 | 1 | 1 | `1 < 1`? no — and not `>`, so `a—b` is not a bridge either |
| `a` | 1 | 1 | 1 | the root, with one child → **not** a cut vertex, though removing it would still cost `b` its far side |

Reported: `{ cutVertices: ["c"], bridges: ["c-d"], componentCount: 1 }` — which is what
`articulationPoints(ladderBarbell())` returns, and what the spec then checks by *deletion*: the rebuilt graph
without `c` has **2** components, and without `b` it has 1.

**Deletion is the oracle, on 40 seeded graphs.** A low-link with an off-by-one in the `low` update still prints
a plausible set of names, so no reported name is believed. For **every** vertex of every trial graph the spec
rebuilds the graph without it and counts components with `weakComponentsReference` (union-find over the undirected
view, no DFS in sight); for **every** edge it rebuilds without that walkway and counts again. `severed` must equal
`reported`, in both directions, which is what catches the missed cut vertex that a "did we report only real
ones?" test cannot. `dfs.ts` sits at 100 % statements and 100 % branches with no unreachable-arm note, because
there are none.

**`depthFirstRoute`, and why it is in the app but not in the picker.** It returns a `RouteResult` — same union,
same refusals (7 ladder cases pass verbatim), same walkable path — and it is *not* a shortest-path claim: with a
LIFO frontier the search commits to whichever branch it opened last. On the square, `a`'s adjacency is
`[b, d, c]`, so `c` is pushed last and popped first: the route is the 250 m diagonal, `expanded` is 2 where
Dijkstra needs 4, and `cost` is 1 because a stack search counts hops and calls nothing else `cost`. Across the
**380 ordered pairs of named places on `campus.json`**, the depth-first route is longer than the cheapest one
on **286 of them**, by 291 146 m in total — an average of 766 m of unnecessary walking per pair. That number is
the phase's argument in one line, so it is asserted in a test rather than written into a paragraph.

**Tests.** 26 in `dfs.spec.ts`: five on the walk (order and depths, "the way back is not a loop" / the square
is, the one-way circuit, a closure, an unknown start), one on `reachableFrom`, the 5 000-vertex line, five on
the weak structure (barbell, every middle of a line, parallel walkways are not bridges, component counting, the
physical-vs-traffic distinction), the 40-graph deletion sweep, one `closedEdges` parity case with a loop cut,
one on the hand-built index that lost a vertex, and the 7-ladder refusals.

---

---

## 8. Dijkstra — `algorithms/dijkstra.ts`, on `algorithms/search-common.ts`

**Why it exists.** Every "shortest route" claim in the app reduces to this: with a cost function that is
finite and positive, the settled set is exactly the set of vertices whose distance is final, and the first
time the destination enters it, the route is optimal. `src/engine/routing` (Phase 4) will call this
function; nothing else in the app computes a route.

**Interface.** `dijkstra(index, from, to, options?)` where `index` is the read-only `GraphIndex`, and
`options` is `{ cost?, blockedEdges?, profile?, trace?, now? }`. Returns `RouteResult` — `RouteFound` or
`RouteNotFound` — and never throws for any input that satisfies `GraphIndex`, including a hand-built index
whose adjacency names edges the snapshot has lost. `blockedEdges` is a `ReadonlySet<EdgeId>` read on every
relaxation; **the graph is never cloned to apply a closure**, which is the same decision `buildComponents`
made in Phase 1 for the same reason.

**Invariant.** `expanded` grows only by vertices whose cost will never improve, and `costSoFar` is
monotone decreasing per vertex. Two consequences the specs use: `exploredOrder` contains every vertex at
most once, and `expanded ≤ |V|`.

**Complexity.** O((V + E) log V) time with this heap and lazy deletion (≤ E pushes, ≤ E pops, each
O(log E)), O(V) for the records plus the heap's own O(E) entries.

**Worked example**, on the fixture `crossing()`: a square of four 100 m walkways `a-b-c-d-a` with a 250 m
diagonal `a-c`, routed `a` → `c`. The frontier is written as `vertex@cost`, and each row is one pop.

| pop | drawn | why | offers accepted | frontier after | explored |
| --- | --- | --- | --- | --- | --- |
| 1 | `a@0` | the seed, and the only vertex final without a comparison | `b@100`, `d@100`, `c@250` | `b@100 d@100 c@250` | `a` |
| 2 | `b@100` | ties with `d` at 100; the comparator breaks the tie on id, `b < d` | `c@200` beats `c@250`, so `c` is re-offered and the 250 entry is left in the heap as a receipt | `d@100 c@200` | `a b` |
| 3 | `d@100` | cheapest remaining | `c@200` via `cd` is *not* cheaper than the record, so it is refused at the door | `c@200` | `a b d` |
| 4 | `c@200` | the destination — return immediately | — | empty | `a b d c` |

`frontierSnapshots` is that fourth column, row by row: `[[], ["d","c"], ["c"], []]`. The answer is 200 m
over two edges, while the *fewest walkways* answer is the 250 m diagonal — which is why BFS (below) is not
interchangeable with this, and why the result carries both `cost` and `metres`. The same two columns, read
across three searches at once instead of one, are §13.

**The table is the replay.** Those last two columns are the only input the UI needs to animate the search:
step *k* shows the first *k* entries of `exploredOrder` shaded and `frontierSnapshots[k-1]` pulsing, with the
path drawn at the final row and nowhere earlier. Nothing is recomputed and nothing is re-run, so the overlay
cannot tell a story the table does not tell — `src/ui/map/replay-plan.spec.ts` pins the pairing, including the
off-by-one that would otherwise show a frontier the search had already emptied.

**What the specs pin.** The pinned cases: a line, the square where the direct edge loses, a genuine 200-vs-200
tie (same answer every run, because the tie-break is the comparator and not the insertion order), a one-way
walkway that can be followed in one direction only, a closure that forces a detour, a closure that strands
the destination (`disconnected`, and it names how many walkways were closed), two components with nothing
blocked (refused *before* searching, naming both component indices), origin equal to destination (a route of
zero, and one expansion), and the five refusal codes in the order the ladder asks them. The property cases:
**200 seeded random graphs**, four sampled sources each, every vertex as target, compared to `bellmanFord`
under the *same* closure set, with every returned path re-walked edge by edge against the index — adjacency
must agree, no closed edge may appear, direction must be respected, `metres` must equal the sum of the edges
walked, the step list must replay onto the same vertices, and no vertex may be settled twice. Then 30 tiny
graphs against `floydWarshall` all-pairs (a matrix algorithm shares no code with either search), and 25
graphs checked for the symmetry an undirected campus must have.

**Unreachable by construction, so left open on purpose** (three arms, one line each; the line numbers are
today's, and the sentence after them says how to re-derive them):
`search-common.ts:333` `if (parent === undefined) break` inside the parent walk — `#parent` is written for
every settled vertex other than the origin, and the walk starts at a settled vertex, so a missing parent
would mean the run contradicted its own bookkeeping; and `search-common.ts:358` the `?? this.#from` label
fallback in the zero-length case, which `checkEndpoints()` has already proven exists; and
`search-common.ts:395` the `0` the offer comparator returns for two offers with the same priority *and* the
same id, which `offer()` makes impossible (a re-offer must be strictly cheaper to be kept at all). It stays
because a comparator that never answers `0` is not a total order, and `MinHeap.isHeapOrdered()` audits `<=`. All three are typed that way
because `GraphIndex.node()` and `Map.get()` answer `undefined` for *any* index, and the alternative was an
assertion or a cast that says the same thing less honestly. (The three line numbers moved from 316/338/370
when cp2 gave the shared run a third container, and to 333 / 358 / 395 again when cp3 put the fold into
`found()`; the arms themselves have not changed, and `npx vitest run --coverage src/engine` still reports exactly
these three and nothing else — re-derive them there rather than trusting this sentence.)

---

## 9. A\* — `algorithms/a-star.ts`

**What it is for.** The default router. A\* is Dijkstra with one line changed — the number it puts in the
heap's priority slot is `cost + h` instead of `cost` — and on a map where distance means something, that one
line is most of the running time.

**Complexity.** `O((V + E) log V)` worst case, identical to §8: a bad heuristic cannot make A\*
asymptotically *slower*, only wasteful. What an admissible, consistent `h` buys is the constant — the settled
set shrinks from "every vertex closer than the destination" to "every vertex whose *estimate of the total* is
below it", which on a campus is a corridor instead of a circle.

**Invariant.** A vertex is settled only when its `f = g + h` is the smallest on the frontier. Optimality
follows from that **if and only if** `h` never overestimates the true remaining cost (admissible) — which
makes admissibility a correctness property here, not a performance one. Consistency (`h(u) ≤ w(u,v) + h(v)`,
the triangle inequality for the estimate) is what additionally lets the search return the moment the
destination is settled instead of draining the heap, and it is why the `if (settled.id === to) return` line in
`a-star.ts` is legal rather than lucky.

**Where the estimate comes from, and why not from a constant.** The engine cannot see `canvas.pixelsPerMetre`
(that is `src/data`'s fact, and §5's rule is that the engine does not import it), so the scale is *measured
from the graph*: `minCostPerUnit` in `geo/measure.ts` takes the cheapest cost per drawn unit among the edges
this run may traverse, and `h = that × euclidean`. Two consequences worth having on the record — the estimate
follows the closure set, so blocking walkways cannot leave `h` overreaching; and a profile that charges per
edge rather than per metre lowers the bound by the longest *drawing* on the map, not the longest walk.

**Admissibility is measured, not asserted.** `a-star.spec.ts` builds 80 tiny seeded graphs, computes the true
remaining cost for every ordered pair with `floydWarshall` — a matrix algorithm that shares no code with a
search — and checks `h(v, t) ≤ d(v, t)` for every vertex and every target, in both directions of every one-way
edge, with walkways closed and open. That is the test that would fail if `minCostPerUnit` were replaced by a
metres-per-unit constant, which is the tempting shortcut §12 exists to prevent. And the `cost` it measures with
is the one the *run* resolved, not the one the caller wrote: since Phase 4 a request can carry only
`{ profile: 'shaded' }` and still minimise a weighted cost, so an estimate built from `options.cost` would be
scaled for the wrong quantity — §10 has the fixture, the numbers and the failure.

**Worked example, against §8's table.** The same square: `a(0,0) b(100,0) c(100,-100) d(0,-100)`, 100 m sides,
a 250 m `a—c` diagonal, one edge id per walkway, cost = metres. `minCostPerUnit` is 1, so `h` is the drawn
distance to `c`: `h(a) = 141.42`, `h(b) = 100`, `h(d) = 100`, `h(c) = 0`.

| pop | settled | why now | what it changes | heap once its pushes are in |
| --- | --- | --- | --- | --- |
| 1 | `a@f=141.42` | the seed, `g=0 + h=141.42` | `b@f=200`, `d@f=200`, `c@f=250` | `b@200, d@200, c@250` |
| 2 | `b@f=200` | ties with `d` at 200; the comparator breaks it on id, `b < d` | `c@200` beats `c@250`, so `c` is re-offered and the 250 entry stays in the heap as a receipt | `c@200, d@200` |
| 3 | `c@f=200` | ties with `d` again, and `c < d` — the **destination** is settled, return | — | `d@200` (never drawn) |

Same route as §8 (`a,b,c`, `cost 200`, `metres 200`, `minutes 2.4`), one fewer settlement, and `d` never
settled at all: `d@f=200` can only lead to `c@≥200`, which the search has already achieved. `expanded` 3
against 4, `frontierSnapshots` `[[], ["d","c"], ["d"]]` against `[[], ["d","c"], ["c"], []]` — three frames to
four, because the third pop ended the run, and each frame is the frontier *before* that pop's own pushes (§6).

**On the real campus, the same claim at scale.** All 380 ordered pairs of named places in `campus.json`,
default profile, no closures: A\* settles strictly fewer vertices on **374** of them, ties on 6, and loses on
none — 3 043 settlements in total against Dijkstra's 8 605, a mean of 8.0 vertices per query where the
uninformed search needs 22.6 of the 39 the map has. `src/test/campus-routing.spec.ts` asserts the
per-pair `expanded` inequality, the `cost` equality to 1e-6, and the two aggregates, so a heuristic that
quietly stopped helping fails a test instead of quietly costing the app 15 vertices a click.

**Why A\* is faster than Dijkstra, in plain words.** Dijkstra grows its search in every direction, like
water from a burst pipe; it will settle the library behind you before it settles the gate ahead of you,
because "ahead" and "behind" are the same distance from the start. A\* keeps the same queue but changes the
number in it: not "how far have I come" but "how far have I come, *plus* how far this vertex still looks".
Straight-line distance to the goal is a lower bound on the walk, so a vertex that is far along the way can
never outrank a vertex that is near the end. It stops exploring sideways the moment sideways looks pointless,
which is most of the time on a corridor-shaped campus, and it still cannot be fooled into a longer route —
because the bound is a *lower* bound, an underestimate. The instant it is an overestimate, all that pruning
turns into guessing, and the answer is wrong: `× 10` on the square returns the 250 m diagonal.

**The inadmissible case ships as a test, not as a warning.** `heuristic: (a, b) => euclidean(a, b) * 10` on
the square settles `a`, then `c` through the diagonal, and hands back 250 m. The route is legal, one-way-safe
and repeatable; it is 50 m worse. This is the whole reason admissibility is stated as an invariant above: there
is no runtime check that can catch it, because nothing about one call tells you whether a function is a lower
bound.

**Refusals, and what `Infinity` means.** A\* shares `checkEndpoints` and `refusedCost` with §8 — same order of
questions, same messages (the 7 ladder cases), and the same rule that `Infinity` from a cost function closes a
walkway rather than breaking the graph. A\* has one more way to fail quietly, which is why `h` falls back to
`0` for any endpoint the index cannot place: a `NaN` priority would park a vertex at the bottom of the heap
forever, and the search would report "no route" about a 100 m walkway.

**Tests.** 22 in `a-star.spec.ts` (7 of them the ladder): zero-scale equivalence to Dijkstra *path-for-path*
and expansion-for-expansion on 60 graphs, the 200-graph × three-profile cost parity with `expanded` ≤, the 80
graphs of measured admissibility, the `minCostPerUnit` pins above, the `×10` wrong answer and its admissible
counterpart, one-way handling, a forced detour, unit-profile minutes, snapshot determinism and `trace: false`,
the unplaceable-vertex fallback, and the metric labels. Plus 15 in
`src/engine/__tests__/search-parity.spec.ts`, which is where "the same broken input refuses identically on all
four searches" and "all four agree on whether a pair is routable at all" (60 seeded graphs) live: claims about
the searches *resembling each other*, which no single algorithm's own file can make.

---

## 10. Cost profiles — `routing/cost.ts`

**The idea.** One graph, five opinions about what "best" means. A profile is not a search and not a filter: it
is a function `EdgeAttributes → number` that multiplies an edge's metres, and the searches never learn why a
walkway costs what it costs. `costFor('shaded')` returns `(edge) => edge.metres * 0.85 or 1.25`; `dijkstra`
and A\* then minimise that number and never see a shade flag. This is what made the selector a set of
`<option>` elements rather than a rewrite: the graph is built once (Phase 2), sealed, frozen, and shared, and
switching profiles between two searches costs nothing because no weight is ever stored on an edge. What the
screen does with it is `ui/route/`'s half — a `<select>` whose rows are the labels and sentences below, and a
result card that names the profile and prints the price of it, `+46.0 m · +18 s vs shortest`, measured against
the same query run with `shortest` on the same algorithm. That second search is run by `useRoute`, not by the
component, and Phase 4's cache is what makes it close to free: the pair differs in one key, so flipping from
shade to lamps re-runs one search and reads the other.

| profile | reads | factor | min | max | what it is chasing |
| --- | --- | --- | --- | --- | --- |
| `shortest` | — | `1` | 1 | 1 | the fewest metres; the baseline every other row is quoted against |
| `shaded` | `shaded` | 0.85 shaded, 1.25 sun | **0.85** | 1.25 | a route you can walk without the sun on it, even though it measures longer |
| `lit` | `lit` | 0.9 lit, 1.4 unlit | **0.9** | 1.4 | lamps at night; an unlit walkway is avoided, never forbidden |
| `step-free` | `stairs`, `stepFree`, `surface`, `slope` | 12 × 2.2 × 1.4 × (1 + 4·\|grade\|) | 1 | 73.92 | no steps, then no kerbs, then no loose ground, then no grade |
| `quiet` | `crowd` | 1 + crowd | 1 | 2 | the emptiest corridor, at up to double its length |

Three things in that table are load-bearing and each has a test: **no profile ever returns `Infinity`** (a
profile weights, `blockedEdges` closes — the distinction is why a step-free request across the one staircase in
`campus.json` answers with a route priced at 12× rather than with a refusal, which would be a lie about the
campus); **every factor is finite and greater than 0** for all 1 280 combinations of the attributes
`buildGraph` can emit, checked exhaustively rather than sampled; and **`shortest` is identically 1**, so its
cost is exactly `edge.metres`, which is the sense in which the other four are deviations and the sense in which
the result card's "Δ against shortest" compares the same quantity the user could have asked for.

**Complexity.** `O(1)` per relaxation — one multiply — and `O(E)` once per A\* run to measure the heuristic's
scale (§12). No profile changes any algorithm's asymptotics; a step-free search is the same `O((V+E) log V)`
with a longer constant. `bfs` ignores cost entirely, which is what makes it the control in the compare table:
its route is the same for every profile, because it counts hops.

**The invariant, and the one that is easy to get wrong.** For every profile `p`, every graph, every query:

1. `cost_p(e) ≥ 0`, finite; `0` on an unreachable pair only.
2. If `f` is a constant, `argmin` of any two routes is unchanged by `f`. So a profile that finds nothing to
   vary is a *scale*, and a scale must not re-order comparable routes — `cost.spec.ts` checks this on a fixture
   where the whole campus is unshaded, and a failure there would mean a profile had stopped being a weighting.
3. `minCostPerUnit(index, { cost: costFor(p), blockedEdges }) × ‖u − t‖ ≤ cost_p(u ⇝ t)` for every `u`. This is
   admissibility, and it is the reason the estimate is *measured* instead of assumed.

**Why the estimate has to be scaled.** `h(u) = ‖u − t‖` is a lower bound on *metres*, and A\* is entitled to
assume it is a lower bound on *the quantity being minimised*. That holds while the quantity is metres — the
`shortest` profile, and every profile whose factor is ≥ 1 everywhere (`lit`'s 0.9 excepted). It breaks the
moment a profile pays a **bonus**: on a shaded graph, 100 m of shaded walkway costs 85, so a crow-flight of
100 m *over-states* the remaining cost, and an over-estimating `h` makes A\* settle the goal before it has
looked at the corner that beats it. The fix is one number: divide the cheapest cost per unit of drawn length
off the graph and multiply `h` by it —

```ts
const scale = minCostPerUnit(index, { cost: run.cost, blockedEdges })   // 0.85 on the shaded campus
h(u) = scale * euclidean(u, target)
```

The **minimum**, not the mean: `h` must be a bound at *every* vertex, including the one about to step onto the
cheapest-per-metre walkway on the map. **Measured, not configured:** `WALKING_SPEED_MPS` and the factor table
are hand-written numbers, and a hand-written scale drifts the moment someone edits `SHADED_BONUS`. And when the
measurement finds nothing — an empty graph, or every walkway blocked — it returns `0`, `h ≡ 0`, and A\* is
Dijkstra with an extra function call, which is the correct degenerate answer rather than a failure.

`a-star.ts` reads the scale from `run.cost`, the cost function the run actually resolves (the caller's, else
the profile's), and not from `options.cost`. That distinction is a bug this checkpoint found: wiring the profile
into `cost` while the heuristic kept reading `options.cost === undefined → metres` left the search minimising
`shaded` prices with an estimate scaled for metres, and `cost.spec.ts`'s new fixture caught it as a wrong
answer, not as a warning. If a future checkpoint "simplifies" `get cost()` away, the fixture fails: A\*
returns a 100 m sunlit line where a 146 m shaded corner is 0.9 units cheaper, and the route it prints is one a
person could walk.

**Worked example — the shade that beats the straight line.** `a = (0, 0)`, `c = (100, 0)`, `b = (96.72,
40.87)`, so `ab` is 105 m and `bc` is 41 m, both shaded (0.85), and `ac` is a 100 m sunlit line (1.25). The
true cheapest shaded walk is the corner: `0.85 × 146 = 124.1`, against `1.25 × 100 = 125` for the diagonal.

| step | `g` so far | `h` scaled (× 0.85) | `f` | `h` unscaled | `f` unscaled |
| --- | --- | --- | --- | --- | --- |
| settle `a` | 0 | 0.85 × 100 = 85 | 85 | 100 | 100 |
| offer `b` | 89.25 | 0.85 × 41 = 34.85 | **124.10** | 41 | 130.25 |
| offer `c` | 125 | 0 | 125 | 0 | 125 |
| draw off the frontier | — | — | `b` ✓ | — | `c` ✗ — the goal is settled at 125 and the search stops |

Scaled, `b`'s `f` is already the optimal cost, so settling it re-prices `c` at 124.1 and A\* arrives with the
route Dijkstra found. Unscaled, `c` looks 5.25 units cheaper than the corner and A\* stops on the first
settlement of the goal — 0.9 units short of optimal, having done *less work*. That last clause is the whole
lesson: an inadmissible heuristic is not slow, it is fast and wrong. And note how narrow the margin is, because
the 1.25 penalty caps how far a 0.85 bonus can mislead — which is why the claim is pinned as a test on a
purpose-built fixture rather than argued from the formula.

**What the profiles do to `minutes`.** Nothing directly. `WALKING_SPEED_MPS` is a second table, keyed by the
same union so a new profile is a compile error until it has a pace, and it says how the *route that profile
chose* gets walked: 1.4 m/s for a walk that is simply short, 1.05 for one negotiated over ramps and kerbs. Two
tables because two facts: the cost decides which walkway wins, the pace decides what a minute of it means. The
result card shows the profile's name and its pace's consequences, and Δ distances are always quoted in metres
against `shortest` — a comparison of two routes' lengths, not of two arbitrary units.

---

## 11. Turn-by-turn — `algorithms/path-utils.ts`

**Why it exists.** A path is a list of vertex ids. A walker experiences a list of *corners*. Between those two
representations sits everything that makes a directions pane worth reading, and it is pure geometry plus a
lookup: no algorithm, no policy, so it is testable without a graph search at all.

**Interface.** `routeLegs(index, nodeIds, edgeIds)` groups a path into `RouteLeg`s, cutting wherever
`turnBetween` exceeds ±15°; `stepsFromLegs(legs)` turns legs into `RouteStep`s; `stepsReplay(steps)` folds a
step list back into vertex ids; `turnDirectionFor(degrees)` maps a signed angle onto the nine-word
`TurnDirection` union. A search uses all three and returns a `RouteFound` whose `steps` a human can follow —
which is why the union has `steps` at all, and why this half exists before the searches do.

**Invariant.** `stepsReplay(result.steps)` equals `result.nodeIds`, on every pinned fixture and every random
graph in the sweep — and on **all four searches**, which is where cp3's pass could have broken it:
`search-parity.spec.ts` runs `sweepGraphs(60, 'parity/step-replay')` over every search × every sampled pair and
checks three things at once: the replay, that one sentence never exceeds one per hop, and that the metres the
sentences add up to match the route's length within the tenths the legs are rounded to. If that ever fails, the
directions pane is lying about the route the map is drawing.

**The fold between the halves (`simplifyLegs`, cp3).** `routeLegs` cuts at every corner of 15° or more, which is
right for geometry and wrong for reading: a 6 m stub between two long stretches buys "Turn right at the cycle
stand" and then "Turn left at the lamp post", fourteen seconds of walking interrupted by itself. So the cut
stays where the geometry put it and the *instruction* is folded — a leg under `MIN_INSTRUCTION_METRES` (20 m) is
absorbed into the leg it was reached through, keeping that survivor's `direction`, `compass` and `landmark`
untouched. A short **opening** leg has no previous, so it folds forward and the merged step keeps the first
stretch's heading. `MIN_SEGMENT_METRES` (0.5 m) folds whatever the caller's threshold is, because a half-metre
leg is two nodes at the same place; `minLegMetres: 0` therefore does not switch the pass off, which is pinned
rather than left to reading. The joint is counted once, so a folded leg still satisfies `nodes = edges + 1` —
the shape the replay convention depends on.

**What the fold did to this campus: nothing, and that is the measured claim.** Across all 380 ordered place pairs,
`routeLegs` produced 1 404 legs and `simplifyLegs` returned the same 1 404, with **0** pairs changed — because the
shortest walkway in `campus.json` is 80 m, four times the threshold. `src/test/campus-routing.spec.ts` asserts
exactly that (both the count equality per pair and the 3× floor on the shortest edge), so the pass cannot
quietly start eating normal routes, and cannot quietly have been needed. The mean route carries **3.69**
sentences by A* or BFS and **6.91** by depth-first — the long DFS wanderings cost a walker nearly twice as many
turns to read — with a maximum of 10 on one route (`Research Labs → Hostel Block 2`).

**Found while testing.** The first version named a leg's landmark by the rule "far end, unless this is a
turning leg that does not reach the destination", which quietly dropped the corner from the *final* turn — the
sentence printed "Bear left, your destination" and never said where to turn. The rule is now one clause:
the opening leg is named for where it goes, every other leg for the corner it turns at, and the destination
is carried by its own suffix. `RouteLeg.reachesDestination` no longer touches naming at all. That fix came
out of a spec written from a picture in my head of a right-angle bend, which the geometry corrected: `row(30)`
is a 45° corner.

**Naming decisions worth stating.** `RouteStep.metres` carries the distance and the prose never repeats it
(one number, one source: the UI appends it). A turning leg is named after the corner it turns at, or after
nothing if that vertex has no label — "Turn left" is a direction, "Turn left at j-7" is not. The opening leg
is named after where it takes you and prefixed with a compass heading, and says "Set off" instead of inventing
a heading when the index cannot place a vertex.

**What the specs pin.** `path-utils.spec.ts`: a straight line stored as several segments stays one leg; a
corner cuts a new leg that *starts* on the vertex you turn at (so legs overlap by one vertex, which is the
replay convention); a 12-unit offset over 30 is 21.8° and cuts while a 4-unit one does not; four right-angle
corners in five vertices make four legs, not three; the opening leg is named for its far end and every other
leg for its corner, and a corner with no label drops the clause instead of printing a vertex id;
`turnDirectionFor` at each threshold and one hair inside it, mirrored left/right with the U-turn as the one
bucket that does not mirror; **cp3's sweep of the whole circle** — every quarter-degree from −180 to 180 checked
against a table written from the exported thresholds rather than from literals, plus eight explicit straddles at
15/60/135/165 because a sweep whose expectation is derived from the same constants can move with a wrong
constant, and only the spelled-out boundaries can catch a `>` that should have been a `>=`; and 120 random
graphs where `stepsReplay(stepsFromLegs(routeLegs(...)))` returns the path unchanged, with the sum of leg lengths
equal to `|path| + |legs| − 1`. Then 9 tests for `simplifyLegs` — identity when nothing is short, the fold into
the previous leg with the survivor's record winning outright, the boundary from both sides at 19.9/20,
the destination clause surviving a folded final stub, the forward fold of a short opener, an all-stub route
collapsing to one sentence, the 0.5 m floor surviving `minLegMetres: 0`, a configurable threshold, and the
serpentine that runs through the real `routeLegs` so the composition is tested and not three units agreeing.
`dijkstra.spec.ts` asserts the same replay property on routes, not on hand-built vertex lists. Then 9 tests for
`simplifyLegs` (above). **29 tests**, and `path-utils.ts` is still at 100 % statements and branches with the
fold and the naming rule inside it — the latter worth noting, because a rule with one `||` in it is covered by
two fixtures and nothing else was needed to say it.

**Where the wording stops and the UI starts.** Nothing in this file knows about a screen, and the two
directions the map takes from here — `src/ui/map/route-plan.ts` (which vertices can be plotted) and
`src/ui/route/route-options.ts` (which places may be picked, and what each algorithm's name means) — are pure
modules for the same reason, so the whole of Phase 3's teaching value is testable in Node. What a leg's
`compass` and `landmark` are *for* is the route card's business, and that is cp5.

---

## 12. Geometric measure — `geo/measure.ts`

**Why it exists.** A* needs a number that estimates cost, and the only geometry available to it is a set of
coordinates whose unit is *not* metres. `canvas.pixelsPerMetre` lives in `src/data`, which the engine may not
import. So a heuristic written as `Math.hypot(dx, dy)` is a lie about units, and a heuristic that overestimates
is not a slower Dijkstra — it is a *wrong* one.

**Interface.** `euclidean`, `compassOf` (eight points, +y is south because the map draws downward),
`turnBetween` (signed degrees, positive to the walker's right, `(-180, 180]`, computed from cross and dot so
the 360° seam needs no branch), `minCostPerUnit(index, { cost?, blockedEdges? })` and
`euclideanHeuristic(index, { cost?, blockedEdges?, scale? })`.

**A profile cheaper than a metre is a factor inside the measurement, not a second knob.** `cost` is the same
function the search minimises, so a profile that prices ground at `0.2 × metres` — a pace multiplier, a
discounted covered walkway, anything that makes an edge *cheaper than it is long* — moves `k` down by that
factor on its own, because `k` is the minimum ratio and the ratio is taken after the profile has spoken. No
caller passes a "cost factor" to the heuristic, and none is needed: `minCostPerUnit` **is** the smallest cost
factor, measured per run and per closure set rather than declared. One discounted edge sets the bound for the
whole map (a lower bound everywhere has to be), so a fast lane costs A* expansions and never correctness.
`a-star.spec.ts` pins all three halves — the uniform `× 0.2` profile, the same graph with an unscaled
`h = euclidean` returning a route 10 units worse, and a single discounted edge — and `one-fifth` is one of the
four profiles in the 200-graph parity sweep for the same reason.

**What the data layer refuses so that this stays true.** A stated `metres` *below* the crow-flight between its
endpoints is `shorter-than-crow-flight`, an error in `buildGraph` (see `docs/SCHEMA.md`), with the tolerance
measured in ground metres — a tenth, or one pixel's diagonal at a coarse `pixelsPerMetre`, whichever is
larger. It does not make A* inadmissible: the estimate is priced off the drawing, so an understated label can
only weaken it. What it breaks is the *card* — 180 m printed for a 190 m straight line is a walkway that does
not exist — and the equality between `metres` and the picture the plan claims, so it is refused at the
boundary where the scale is known rather than patched over in the engine, which cannot tell what a unit means.

`k` is the minimum of `cost(e) / length(e)` over the edges this run may
traverse. Any route is a chain of those edges, so it costs at least `k ×` the chain's length. A chain's length
is at least the straight-line length by the triangle inequality. Hence `k × euclidean` never exceeds the true
cost, and because `k` is a constant the same argument gives *consistency*, which is what lets the search return
the moment it settles the destination.

**Complexity.** `minCostPerUnit` is one pass over the edge list, O(E), computed once per query and captured in
a closure; every `h(a, b)` after that is `k × hypot`, O(1).

**What the specs pin.** The eight compass points at their exact bearings, and 359° wrapping to `north` rather
than running off the end of the list; the sign of `turnBetween` on a y-down plane, `0` for straight on, `180`
not `-180` for a reversal; that `minCostPerUnit` is a genuine lower bound on cost-per-unit for *every* edge of
60 random graphs; that a profile pricing an edge at `Infinity` (or `0`, or `NaN`) cannot drag `k` with it; that
blocking the cheapest edge *sharpens* the heuristic instead of breaking it; zero-length and dangling edges
skipped rather than thrown on; and the triangle inequality — consistency — checked through every edge of 40
graphs with every vertex as target.

**Found while testing (§12).** Two of my own expectations were wrong and the code was right. A "nearly straight"
case was built by moving the far point 0.001 *sideways* from the corner, which is a 90° turn and the
implementation said so; and a blocked-edge ratio was expected as `300 / 100` when the drawn length is
`hypot(100, 10)`, because the point is offset diagonally. Both were fixed in the spec, not in the code, which
is the outcome a reference model is supposed to have.

---

## 13. Compare mode — three searches, one query (`ui/compare/`, `hooks/useCompare.ts`)

Nothing new runs here: `useCompare` asks the same `runSearch` seam the card uses, three times, with the pair, the
preference and the graph held identical — so the only thing that can differ in the table is the algorithm, which
is the point of asking. The row is five numbers, four of which are the engine's own metrics: `metres`,
`minutes`, `expanded` (vertices drawn off the frontier), `ms`, and `hops` printed as *segments*.

**The timing column does not compete.** `RouteMetrics.ms` is whole milliseconds, so on 39 vertices all three
rows usually read `0` and the difference between two `0`s is not a finding; what a sub-millisecond measurement
actually reports is the JIT and the scheduler. The column is there to be looked at and *not* ranked —
`COLUMNS` marks it `decides: false`, and `bestIn` returns the empty set for a column that does not decide, which
`compare-table.spec.ts` pins by asserting that a fixture with an unambiguous 1 ms / 9 ms / 11 ms spread still
carries no mark in that column. Distance, time, settled vertices and segments are deterministic; a winner is
never chosen from noise.

**What a sweep of the real campus shows.** `src/test/compare-campus.spec.ts` runs the comparison over all
1 482 ordered pairs, against a Bellman-Ford written into the spec rather than imported:

| claim | measured |
| --- | --- |
| the table's best distance equals the hand-written optimum | all 1 482 pairs, within the engine's own 0.1 m rounding |
| Dijkstra and A\* tie on distance, so both are marked | 1 482 / 1 482 |
| A\* never settles more vertices than Dijkstra | 1 482 / 1 482 (the admissibility claim, checked not asserted) |
| A\* settles strictly fewer | 1 431 pairs; 51 ties, all short hops across one corridor |
| BFS is among the best on segments | 1 482 / 1 482, and strictly best on 100 |
| BFS's extra distance against Dijkstra, `shortest` | all 1 482 node pairs: max 257.7 m, total 20 201.2 m, mean 13.6 m, non-zero on 297. The 380 named-place pairs: same max, total 5 042.7 m, mean 13.3 m, non-zero on 71 |

The row above it is the reason the pair set travels with the number. "BFS is 5 042.7 m longer" is a *total* over
380 place pairs, and on its own it reads like a single route that overshoots by five kilometres; the largest
single overshoot anywhere on the plate — place pairs or node pairs — is 257.7 m, and the mean is thirteen metres on
a fifteen-hundred-metre walk. Both scopes, in all three shapes, are asserted together in one test, so the mistake
cannot be made twice.

That "among the best on segments" row is the lesson the header hint carries: breadth-first *minimises* segments, so it can never lose
that column, and it is strictly better on only 100 pairs because on a walkway graph the shortest walk is usually
also the one with fewest crossings. A column a search optimises by construction is worth marking and worth
saying so under.

**Three lanes, not three colours.** Coincidence is the failure mode of an overlay: on this campus A\* walks
Dijkstra's exact route for most pairs, and three identical polylines resolve to whichever was painted last. Each
algorithm therefore owns a lane — Dijkstra on the walkway, A\* 4 px to a walker's left, BFS 4 px to the right —
and the dash pattern carries the identity, so the legend can name both in words (`solid line, drawn on the
walkway`). The offset is `LANE_OFFSET_PX`, and `route-styles.spec.ts` reads the stylesheet's `stroke-width` back
and requires the offset to *exceed* it: at 3 px of paint, 2.6 px of separation was three lanes in the code and
one thick line on the screen, which is exactly the class of fact a markup test cannot see.

**The sentence is derived.** `compareInsight` writes one line from the rows, and its spec asserts a property
rather than an example: over 200 seeded triples and all 1 482 real pairs × 2 preferences, every number that
appears in the output appears in the input (or is the difference of two inputs). Six arms — nothing asked, a
refusal, the same place twice, all three identical, same walk with different work, breadth-first tying the cost
while being longer in metres — and one that refuses to compare fewer than three answers, because a two-way tie is
not a result.

---

## 14. The route cache (`algorithms/cache.ts`, `hooks/useRoute*`, `ui/route/route-summary.ts`)

The app asks the same question over and over: a preference moved back to where it was, a swap pressed twice,
compare toggled on for the third time. `LRUCache` arrived in Phase 1 with no caller at all — a structure taught
before the thing that would use it, which is the order a course wants and the order that tempts a project into
building a second, simpler cache later. cp5 put the one structure in front of the searches, and this section is
what the intervening phases had to get right for that to be a one-line change in the hook.

**What the key is.** `from`, `to`, the algorithm's name, and *every field of `RouteSearchOptions`*, walked in
sorted order rather than listed. The walk is the design: an option added to that type next month is in the key
the day it is added, because nothing had to be remembered about it. One normalisation was found by the key's own
equality test and is worth the anecdote — `{}` and `{ blockedEdges: new Set() }` hashed apart, so a hook that
defaults to an empty closure set would have missed on every query while one that omits the field hit. "Nothing is
closed" now has one spelling in the key and three in the callers.

**What a key cannot be.** `cost` and `now` are functions, and two closures with identical source text can
compute different weights. `routeCacheKey` answers `null` for any function-valued option, and a `null` key means
*do not cache this*, not *cache it under a coarser key* — a cache that cannot tell two questions apart is worse
than no cache, because it is confident. `searchUncached` is exported so the cache's own test can compare a
remembered answer against the search it claims to remember, and `scripts/bench.mjs` uses it so the benchmark does
not time a `Map` lookup.

**What is refused.** A different profile, a different closure set, the reverse direction, another graph. The
closure set gets a second lock beyond its hash: an entry stores the sorted ids beside the result, and a lookup
that does not match them is a miss — so a 64-bit collision *and* a matching count is the worst case, and the
worst case is a recomputation. The reverse direction is not treated as the reverse of the route because
`oneWay` walkways are ordinary on this campus (`docs/MAP-DATA.md`), and a pair of entries costs nothing.

**What a hit reports.** `cached: true`, and nothing else. `expanded` and `ms` belong to the search that produced
the entry: the settled count is what §13 ranks, and re-stamping `ms` to `0` would replace a measurement with a
statement about the call that skipped the work. The card's badge is what tells a reader the search did not run
again; the numbers under it stay the search's own.

**When it is invalidated.** Never, and that is the answer. One cache per `GraphIndex` in a `WeakMap`, so a new
graph *is* a new cache and an entry cannot outlive the graph it describes; no `useEffect` watches for map
changes, and none can be forgotten. `clearRouteCache` exists because Phase 7's editor will mutate a graph in
place and because a button that says "the cache is empty now" has to mean it — which is what the app's Clear
control does today, resetting the counters with the entries: a hit rate quoted against lookups that are no
longer possible is a number about a cache nobody has.

**192 entries, by arithmetic rather than tuning.** A session toggles between the pairs a person actually uses —
the 20 named places × 19 partners for one algorithm and profile, a few dozen entries — while a sweep of all
1 482 ordered pairs at five profiles asks 22 230 questions no fixed capacity fits. So the sweep *thrashes* the
cache and keeps answering correctly, which is the only property a bound owes, and it is measured: over all
1 482 pairs and three algorithms the cached answer is identical to a cold search on every field but the two above.

**One figure this file had to correct.** The counters belong to `RouteCache`, not to `LRUCache`, and that was a
bug before it was a paragraph. The list counts *map reads*, and a lookup refused for a mismatched closure set
never reaches its `get`, so `misses` stayed `0`: two hits and two misses printed a 100 % hit rate. `lookups ===
hits + misses` is now true by construction, because `lookups` counts calls to `lookup` and `misses` is the
difference — which is the same lesson the repository keeps re-learning, in a new costume: a derived number read
from someone else's ledger is only as honest as the events that ledger records.

The data structure's own answer to "why is an LRU a hash map *and* a doubly linked list, not just a `Map`?" is
the header of `src/engine/structures/lru-cache.ts`, which is where it belongs: the file that cannot work any other
way is the file that explains why.

---

## Benchmarks (Phase 4)

`npm run bench` (`scripts/bench.mjs`) writes a Markdown table into **Timings** below and nothing else in this
file: the numbers are never typed, and `src/test/bench-report.spec.ts` fails if the markers around the generated
block go missing, which is the difference between "generated by script" as a property of the repository and as a
claim in a commit message. The script loads `src/engine` through Vite's SSR module runner, for the same reason
`scripts/validate-map.mjs` does — a second implementation in `.mjs` would measure that instead of the app — and
it draws its graphs from `src/engine/testing/random-graph.ts`, the generator the property tests already share, so
the table and the sweeps describe one family of graphs. Timings vary by machine, so the generated block records
**Node version, platform, CPU model and count, total memory**, plus commit, seed and graph sizes, above the
numbers. A benchmark without its environment is a rumour.

The cache is deliberately **not** benchmarked here: a timing loop that reads it would measure a `Map`, and the
question "how much does a hit cost" has the answer "one shallow copy", which does not need a harness. What the
cache is measured on is its *behaviour* — §14, and `src/test/route-cache.spec.ts` over all 1 482 campus pairs.

Still planned, in the phase that needs them: lazy-deletion duplication factor (pushes ÷ expansions, cp5 of
Phase 5's data-structure chapter if it survives the cut); trie vs `Array.filter` at 1 000 labels (Phase 5);
`buildComponents` rebuild cost per closure (the number that justifies not cloning, Phase 6).

## Measured results

Two tables live in this section. The first is what the test suite proves, and is kept up to date by hand with every
checkpoint. The second is machine-generated: `npm run bench` rewrites everything between the two comment markers, so
its numbers are never typed, and a hand-edit between them is a hand-edit that gets overwritten the next time
anybody measures anything. That is the arrangement the brief asked for — "write the table into the docs by script"
— and the markers are what make it enforceable rather than aspirational: `bench-report.spec.ts` fails if they go
missing, which is also the failure mode where someone deletes them and starts typing timings in.

*Re-measured at Phase 3 checkpoint 5, `npm run check` on this branch (Vitest, Node in the project's own
sandbox). These are test-suite facts, not benchmark timings — `npm run bench` is Phase 4 and nothing in this
table is a measurement of speed.*

| what | measured |
| --- | --- |
| `npm run check` | typecheck · lint · **678 tests in 44 files** · build ok (Phase 4 cp5; the checkpoint logs carry the earlier counts) |
| `src/engine` | **262 tests** — structures 77, `algorithms/` 142 (search-common 26, a-star 25, dfs 26, dijkstra 19, bfs 17, path-utils 29), geo 21, `__tests__/` 22 (contract 6, search-parity 16) |
| `src/data` | 86 (`build-graph.spec.ts`) |
| `src/ui` | **118** — `map` 79 (view 25, marker-plan 15, tip-content 16, icons 8, route-plan 8, route-layer 7), `route` 39 (route-options 13, route-summary 13, route-card 13) |
| `src/test` | 33 — architecture guard 14, `map:validate` 6, campus routing 6, route styles 5, schema drift 2 |
| coverage of the cache and its neighbours | `algorithms/cache.ts` and `testing/random-graph.ts` **100 % on all four metrics**; `structures/lru-cache.ts` unchanged from Phase 1 at 93.54 / 80.95 (its open arms are the ones listed in the Phase 1 PR description); `ui/route/route-summary.ts`, `route-card.tsx`, `route-controls.tsx` and the four `ui/compare/*.tsx` all 100 / 100, so the badge, its sentence and the clear button are measured even with no DOM |
| coverage of the four searches | `dijkstra.ts`, `a-star.ts`, `bfs.ts`, `dfs.ts`, `measure.ts`, `path-utils.ts` all **100 %** statements and branches; `search-common.ts` 99.15 / 96.47, with the three arms listed under §8 and nothing else open |
| coverage of the route UI | `route-plan.ts`, `route-summary.ts`, `route-card.tsx`, `route-layer.tsx` all **100 %** statements and branches — the last two are components, measured because `renderToStaticMarkup` needs no DOM; `route-options.ts` 100 / 94.44, its one open arm the sort comparator's `0`, which needs two rows with the same label *and* the same id, so it is documented in `route-options.spec.ts` instead of faked. `route-controls.tsx` was 77.77 on that reading from Phase 3 to Phase 4 and is **100 %** now, because the `onChange` arrows turned out to be reachable by *calling the handler as a property* rather than by dispatching an event at a DOM that does not exist here — a limitation of imagination, presented for two checkpoints as a limitation of the harness |
| sweeps behind the algorithm claims | Dijkstra vs Bellman–Ford **200** graphs × 4 sources × every vertex, plus 30 vs Floyd–Warshall and 25 symmetry; A\* vs Dijkstra **200** graphs × 4 weighting profiles (metres, unit, jittered, `× 0.2`) and again × the 5 shipped cost profiles on per-edge varied attributes, zero-scale equivalence on **60**, measured admissibility on **80**, and profile admissibility on **60** graphs × 5 profiles × every vertex; BFS vs hop count **200**; DFS deletion oracle **40** graphs, every vertex and every edge; depth-first route validity on **120** |
| the directions pass, on 380 pairs | `routeLegs` → 1 404 legs, `simplifyLegs` → the same 1 404 (0 pairs changed: the shortest walkway is 80 m, four times the 20 m threshold); `landmarkOf` → 185 legs name something, 1 219 name a junction and therefore say nothing; **3.69** sentences per route by A\* or BFS, **6.91** by depth-first, **10** on the longest |
| the campus, 380 ordered place pairs | 0 refusals (one component, as `map:validate` says); A\* settles fewer vertices on **374** pairs and ties on 6, **3 043** settlements against Dijkstra's **8 605**; breadth-first's routes are 5 042.7 m longer **in total** and depth-first's 291 146.1 m longer **in total** — both are sums over the 380 pairs, not single-route figures: over these pairs breadth-first's maximum is 257.7 m (`cafeteria → sports-ground`) and its mean 13.3 m, positive on 71 of the 380; longest pair measured 1 517.7 m (`Research Labs → Hostel Block 2`) |
| the same, on all 1 482 ordered node pairs | breadth-first's extra distance against Dijkstra: maximum 257.7 m (the same pair), total 20 201.2 m, mean 13.6 m, positive on 297 of the 1 482 — pinned in `src/test/compare-campus.spec.ts` by *states the breadth-first overshoot in all three shapes, per scope*, which asserts all ten figures above and below together. A figure without its pair set is not a measurement: 5 042.7 m is a total over 380 pairs, and it was once reused as a maximum |
| `npm run map:validate` | 39 nodes, 56 edges, 20 places, 13 buildings, 8 surfaces, 6 zones · 1 component · 9 415.3 m of walkway · 0 errors, 2 warnings, exit 0 |
| bundle | `dist/assets/index-*.js` 286.69 kB (gzip 90.32 kB) — unchanged from cp1, because no UI module imports the searches yet; Phase 3 cp4 is where they reach a screen |
| the 5 000-vertex line | `dfs.spec.ts`: 5 000 visits, last depth 4 999, no `RangeError` |

The n = 5 000 rank-bound case and the 500/5 000/120-step property trials cited in §1–§5 are Phase 1's and
still stand; they are inside the 513.

### Timings — `npm run bench`

<!-- bench:begin -->

Seeded synthetic graphs, `npm run bench` on `c1fe552`. Node `v22.22.3` · linux x64, kernel 6.1.158+ · 2 × Intel(R) Xeon(R) Processor @ 2.60GHz · 3.8 GB total.
Graphs drawn from `marg-campus-navigator/phase4/bench/<n>` with `extraEdges = V`; 8 corner-to-corner queries per graph;
a 3-run warm-up then the **median of 15 runs**; `trace: false` on every search.

| vertices | edges | search | **settled per query** | median ms per query | work against Dijkstra |
| --- | --- | --- | --- | --- | --- |
| 100 | 198 | Dijkstra | 54.0 | 0.065 | 1.00× (the baseline) |
| 100 | 198 | A* | 53.4 | 0.151 | 0.99× |
| 100 | 198 | BFS | 66.0 | 0.095 | 1.22× |
| 1000 | 1999 | Dijkstra | 547.1 | 0.794 | 1.00× (the baseline) |
| 1000 | 1999 | A* | 543.0 | 1.092 | 0.99× |
| 1000 | 1999 | BFS | 521.6 | 0.579 | 0.95× |
| 10000 | 19998 | Dijkstra | 6,011.9 | 17.290 | 1.00× (the baseline) |
| 10000 | 19998 | A* | 5,974.8 | 24.062 | 0.99× |
| 10000 | 19998 | BFS | 3,818.6 | 8.714 | 0.64× |

**Read the middle column, not the one next to it.** Settled vertices are the same number on every run on every
machine, which is what makes them the comparison. The milliseconds are a median over 15 runs on one box,
with that box’s caches, thermal state and neighbours in the pipeline; they will not reproduce on yours. Use them
for the shape — the growth from 100 to 10 000 vertices is the heap’s `log V` arriving — and never to name a
winner. The same reasoning is why `ms` carries `decides: false` in the compare table (§13), and why no row of
this table is sorted by its own timings.

### Why A* settles the same number of vertices here

It should not, and the difference between this table and the campus figures is the lesson rather than a defect.
The heuristic is `minCostPerUnit(index) × euclidean(a, b)` — the cheapest cost per unit of *drawn distance*,
measured from the graph so it can never overestimate. `randomGraph` places vertices at (i × 37) % 1000 and
(i × 91) % 1000: a linear congruence over the vertex index, admissible in the sense the proof needs and
useless in the sense that helps the search. An admissible-but-uninformative estimate turns A* into
Dijkstra with a tax, and the 0.99× above is that tax: the estimate is checked on every pop and buys
nothing, because the drawing carries no information about the walk.

On `campus.json`, where the coordinates are a plan, the same three lines of code settle 3 043 times against
Dijkstra’s 8 605 over the 380 ordered place pairs (§13): 0.35×, not 0.99×. A heuristic is only as good as the
geometry it is drawn from, and a benchmark that reported the win without the condition for it would be the
kind of table a student believes and an examiner marks down.

BFS is the third row and the least comparable one: it settles fewer vertices than both at 10 000 because it
stops when the goal appears in its next layer, and the layer is measured in hops. The walks it returns are
longer in metres by a maximum of 257.7 m on this campus, and the table in §13 is where that is stated with its
denominator attached. A benchmark row for BFS is a row about a queue, not about a shortest path.

<!-- bench:end -->

