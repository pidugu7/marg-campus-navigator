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
| 6 | BFS | `algorithms/bfs.ts` | hop-shortest path, k-hop reachability | pending (Phase 3, cp2) |
| 7 | DFS | `algorithms/dfs.ts` | cycle check, articulation points / bridges | pending (Phase 3, cp2) |
| 8 | Dijkstra | `algorithms/dijkstra.ts` | exact weighted shortest path | **done** (Phase 3, cp1) |
| 9 | A\* | `algorithms/a-star.ts` | default router on the 2D plane | pending (Phase 3, cp2) |
| 10 | cost profiles | `routing/cost.ts` | fastest / shaded / step-free / quiet | pending (Phase 4) |
| 11 | turn-by-turn | `algorithms/path-utils.ts` | directions text from a path | legs and wording **done** (cp1); the simplification pass is cp3 |
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
interchangeable with this, and why the result carries both `cost` and `metres`.

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

**Unreachable by construction, so left open on purpose** (both arms, one line each):
`search-common.ts:316` `if (parent === undefined) break` inside the parent walk — `#parent` is written for
every settled vertex other than the origin, and the walk starts at a settled vertex, so a missing parent
would mean the run contradicted its own bookkeeping; and `search-common.ts:338` the `?? this.#from` label
fallback in the zero-length case, which `checkEndpoints()` has already proven exists; and
`search-common.ts:370` the `0` the offer comparator returns for two offers with the same priority *and* the
same id, which `offer()` makes impossible (a re-offer must be strictly cheaper to be kept at all). It stays
because a comparator that never answers `0` is not a total order, and `MinHeap.isHeapOrdered()` audits `<=`. Both are typed that way
because `GraphIndex.node()` and `Map.get()` answer `undefined` for *any* index, and the alternative was an
assertion or a cast that says the same thing less honestly.

---

## 11. Turn-by-turn — `algorithms/path-utils.ts` (checkpoint 1 half)

**Why it exists.** A path is a list of vertex ids. A walker experiences a list of *corners*. Between those two
representations sits everything that makes a directions pane worth reading, and it is pure geometry plus a
lookup: no algorithm, no policy, so it is testable without a graph search at all.

**Interface.** `routeLegs(index, nodeIds, edgeIds)` groups a path into `RouteLeg`s, cutting wherever
`turnBetween` exceeds ±15°; `stepsFromLegs(legs)` turns legs into `RouteStep`s; `stepsReplay(steps)` folds a
step list back into vertex ids; `turnDirectionFor(degrees)` maps a signed angle onto the nine-word
`TurnDirection` union. A search uses all three and returns a `RouteFound` whose `steps` a human can follow —
which is why the union has `steps` at all, and why this half exists before the searches do.

**Invariant.** `stepsReplay(result.steps)` equals `result.nodeIds`, on every pinned fixture and every random
graph in the sweep. If that ever fails, the directions pane is lying about the route the map is drawing.

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
bucket that does not mirror; and 120 random graphs where `stepsReplay(stepsFromLegs(routeLegs(...)))` returns
the path unchanged, with the sum of leg lengths equal to `|path| + |legs| − 1`.
`dijkstra.spec.ts` asserts the same replay property on routes, not on hand-built vertex lists. 100 %
statements and branches; the simplification pass that belongs *between* grouping and wording is cp3's.

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

**Admissibility, in three lines.** `k` is the minimum of `cost(e) / length(e)` over the edges this run may
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

## 6, 7, 9, 10 — still to come in this phase

Claims already made, still to be tested at the checkpoint named:

- **BFS** (cp2) is hop-shortest, and equals Dijkstra when every weight is 1.
- **DFS** (cp2) finds articulation points; every reported cut vertex must actually disconnect the graph when
  removed, verified by rebuilding without it.
- **A\*** (cp2) returns the same *cost* as Dijkstra on every fixture pair while expanding **fewer or equal**
  vertices. If A\* is not cheaper on this map, the heuristic is wrong — and that test is what will say so.
  The same checkpoint ships the case where an *inadmissible* heuristic returns a longer route, so the reason
  §12 exists is on the record rather than in a footnote.
- **Cost profiles** (Phase 4) are weight functions, not separate algorithms; `non-positive-cost` is what stops
  a profile from breaking the invariant in §8.

---

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
