/**
 * Depth-first search — reachability in one direction, and the weak structure underneath.
 *
 * Two questions are answered here and they must not be confused, so they are two functions with two names
 * rather than one function with a flag:
 *
 * - {@link dfs} walks the graph **as a walker can walk it**: out-arcs only, one-way respected, closures
 *   honoured. That is the right shape for "what is reachable from here" and for the directed cycle check.
 * - {@link articulationPoints} walks it **as a campus is built**: every incident edge, direction ignored —
 *   the weak structure `buildComponents` already partitions by. That is the right shape for "would removing
 *   this courtyard cut the campus in half", because a one-way walkway does not stop a place being part of the
 *   campus; it only stops you arriving that way.
 *
 * Conflating the two is the classic error this file exists to avoid: a one-way edge makes a vertex a cut
 * vertex in the directed sense while disconnecting nothing physically. Phase 6 reports both numbers, so both
 * are computed here, and each is checked against *deletion* — the one oracle that cannot share the bug.
 *
 * **Iterative, deliberately.** Every walk here runs on an explicit stack. The campus graph is small, but the
 * map editor (Phase 7) will ingest a traced plan of a few thousand vertices, and a recursive DFS costs one
 * call frame per vertex: a data-dependent graph becomes a `RangeError` in a browser. `dfs.spec.ts` walks a
 * 5 000-vertex line to hold the claim.
 */
import { SearchRun, type RouteSearchOptions } from './search-common'
import type { EdgeId, GraphIndex, NodeId, RouteResult } from '../types'

/** Options for the traversals. `blockedEdges` means what it means to every search: closed, by reference. */
export interface DfsOptions {
  readonly blockedEdges?: ReadonlySet<EdgeId>
}

/** One vertex as the walk saw it. */
export interface DfsVisit {
  readonly id: NodeId
  /** How many open ancestors it had when it was first reached; `0` for the root. */
  readonly depth: number
  /** The edge walked to arrive, or `null` for the root. */
  readonly viaEdgeId: EdgeId | null
}

/** The shape of one depth-first run from one root. */
export interface DfsTree {
  readonly root: NodeId
  /** Discovery order — the order vertices were first reached. Derived from {@link visits}, never separate. */
  readonly order: readonly NodeId[]
  /** Finish order — the order they left the stack. A vertex finishes before any vertex it reaches finishes. */
  readonly postOrder: readonly NodeId[]
  readonly visits: readonly DfsVisit[]
  /** The edges that first reached a vertex: a spanning tree of the reachable set. */
  readonly treeEdgeIds: readonly EdgeId[]
  /**
   * Edges pointing at a vertex still open on the stack: non-empty exactly when there is a directed cycle.
   * "Walking back along the walkway you came along" does not count — see {@link dfs}.
   */
  readonly backEdgeIds: readonly EdgeId[]
  readonly cycle: boolean
}

/** What {@link articulationPoints} answers, on the weak structure. */
export interface Resilience {
  /** Vertices whose removal increases the component count, sorted by id so a report diffs cleanly. */
  readonly cutVertices: readonly NodeId[]
  /** Edges whose removal does the same. */
  readonly bridges: readonly EdgeId[]
  /** Components in the graph as given, so the report can say "from 1 to 3" rather than "it broke". */
  readonly componentCount: number
}

interface DfsFrame {
  readonly id: NodeId
  readonly depth: number
  /** The edge this frame was entered along; it is never a back edge, because it is the tree edge. */
  readonly viaEdgeId: EdgeId | null
  /** Next neighbour index to examine — the thing a call frame's local loop variable becomes. */
  cursor: number
}

/**
 * One directed depth-first walk from `start`, and an empty tree if the graph does not know that id.
 *
 * A vertex the adjacency reports but the snapshot cannot place is skipped rather than invented: `neighboursOf`
 * is adjacency and `node` is the snapshot, and only a hand-built index can disagree about the two. Refusing to
 * draw a phantom vertex is the same decision `routeLegs` makes about a missing edge, and for the same reason —
 * the alternative is a `TypeError` in the middle of a report.
 */
export function dfs(index: GraphIndex, start: NodeId, options: DfsOptions = {}): DfsTree {
  const { blockedEdges } = options
  const visits: DfsVisit[] = []
  const postOrder: NodeId[] = []
  const treeEdgeIds: EdgeId[] = []
  const backEdgeIds: EdgeId[] = []
  const seen = new Set<NodeId>()
  const open = new Set<NodeId>()

  if (index.hasNode(start)) {
    const stack: DfsFrame[] = [{ id: start, depth: 0, viaEdgeId: null, cursor: 0 }]
    seen.add(start)
    open.add(start)
    visits.push({ id: start, depth: 0, viaEdgeId: null })

    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as DfsFrame
      const neighbours = index.neighboursOf(frame.id)
      if (frame.cursor >= neighbours.length) {
        stack.pop()
        open.delete(frame.id)
        postOrder.push(frame.id)
        continue
      }
      const entry = neighbours[frame.cursor] as (typeof neighbours)[number]
      frame.cursor += 1
      if (blockedEdges?.has(entry.edgeId) === true) continue
      if (index.node(entry.to) === undefined) continue
      // Walking back along the same walkway is not a loop: a two-way path stores one id as two arcs, and
      // without this skip `cycle` would be `true` for any campus with any corridor in it, which is a fact
      // about the data model and not about the map.
      if (entry.edgeId === frame.viaEdgeId) continue
      if (open.has(entry.to)) {
        // An edge to something still on the stack closes a cycle. Recorded rather than short-circuited,
        // because the report wants to know how many and Phase 6 wants the list.
        backEdgeIds.push(entry.edgeId)
        continue
      }
      if (seen.has(entry.to)) continue
      seen.add(entry.to)
      open.add(entry.to)
      treeEdgeIds.push(entry.edgeId)
      visits.push({ id: entry.to, depth: frame.depth + 1, viaEdgeId: entry.edgeId })
      stack.push({ id: entry.to, depth: frame.depth + 1, viaEdgeId: entry.edgeId, cursor: 0 })
    }
  }

  return {
    root: start,
    order: visits.map((visit) => visit.id),
    postOrder,
    visits,
    treeEdgeIds,
    backEdgeIds,
    cycle: backEdgeIds.length > 0,
  }
}

/**
 * Everything reachable from `start`, in discovery order — `dfs`'s answer with the structure stripped off.
 *
 * Its own name because the app usually asks only this, and because "is `b` reachable from `a`" has to be
 * answered identically by the map, the validator and the resilience report, or one of them is lying.
 */
export function reachableFrom(index: GraphIndex, start: NodeId, options: DfsOptions = {}): readonly NodeId[] {
  return dfs(index, start, options).order
}

/** Discovery time and running low-water mark, one object shared by the map and the frame that owns it. */
interface VertexState {
  readonly disc: number
  low: number
  /** Children of a DFS root: the only articulation test that is not a low-link comparison. */
  children: number
}

interface WeakFrame {
  readonly state: VertexState
  readonly id: NodeId
  /** The *edge* entered along. A frame that skipped its parent vertex instead would call two parallel
   *  walkways a bridge, which is the bug this shape exists to make impossible. */
  readonly viaEdgeId: EdgeId | null
  cursor: number
}

/**
 * Cut vertices and bridges, by iterative low-link over the undirected view.
 *
 * **The rule.** For a non-root vertex `p`, `p` is a cut vertex when some child `c` has `low[c] ≥ disc[p]`: no
 * back edge out of `c`'s subtree reaches above `p`, so everything below `c` reaches the rest of the campus
 * *through `p`*. A root is a cut vertex when it has two or more DFS children. And `p`—`c` is a bridge when the
 * inequality is strict. Tarjan's argument, from 1973, unchanged — and `dfs.spec.ts` refuses to take it on
 * trust: it removes each reported vertex from a rebuilt graph and *counts components again*.
 *
 * **Why `low` is not updated from finished descendants.** The textbook update `low[v] = min(low[v], disc[w])`
 * for every already-seen `w ≠ parent` is correct for an undirected graph because there are no cross edges; the
 * case that looks like one — the tree edge seen from the parent's side after the child finished — has a
 * *larger* `disc`, so the minimum ignores it. No special-casing, and no silent wrong answer.
 *
 * Costs one pass: O(V + E) time, O(V) state. Both lists come out of the same walk, which is why they are one
 * return value: a second pass to find bridges would be a second chance to disagree about the DFS tree.
 */
export function articulationPoints(index: GraphIndex, options: DfsOptions = {}): Resilience {
  const { blockedEdges } = options
  const state = new Map<NodeId, VertexState>()
  const cut = new Set<NodeId>()
  const bridges = new Set<EdgeId>()
  let time = 0
  let componentCount = 0

  for (const root of index.graph.nodes) {
    if (state.has(root.id)) continue
    componentCount += 1
    const rootState: VertexState = { disc: ++time, low: time, children: 0 }
    state.set(root.id, rootState)
    const stack: WeakFrame[] = [{ state: rootState, id: root.id, viaEdgeId: null, cursor: 0 }]

    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as WeakFrame
      const incident = index.edgesAt(frame.id)
      let descended = false
      while (frame.cursor < incident.length) {
        const edgeId = incident[frame.cursor] as EdgeId
        frame.cursor += 1
        if (blockedEdges?.has(edgeId) === true) continue
        const edge = index.edge(edgeId)
        // An incident id the snapshot lost is the hand-built-index case again: no endpoint to walk to.
        if (edge === undefined) continue
        if (edgeId === frame.viaEdgeId) continue
        const other = edge.from === frame.id ? edge.to : edge.from
        if (!index.hasNode(other)) continue
        const seenState = state.get(other)
        if (seenState !== undefined) {
          frame.state.low = Math.min(frame.state.low, seenState.disc)
          continue
        }
        state.set(other, { disc: ++time, low: time, children: 0 })
        frame.state.children += 1
        stack.push({
          state: state.get(other) as VertexState,
          id: other,
          viaEdgeId: edgeId,
          cursor: 0,
        })
        descended = true
        break
      }
      if (descended) continue

      stack.pop()
      const parentFrame = stack[stack.length - 1]
      if (parentFrame === undefined) {
        if (frame.state.children > 1) cut.add(frame.id)
        continue
      }
      const childLow = frame.state.low
      parentFrame.state.low = Math.min(parentFrame.state.low, childLow)
      if (frame.viaEdgeId !== null && childLow > parentFrame.state.disc) bridges.add(frame.viaEdgeId)
      if (parentFrame.viaEdgeId !== null && childLow >= parentFrame.state.disc) cut.add(parentFrame.id)
    }
  }

  return { cutVertices: [...cut].sort(), bridges: [...bridges].sort(), componentCount }
}

/**
 * A route found by depth-first search: the same `RouteResult`, and no optimality claim.
 *
 * This is in the exercise list because it is the counterexample every other algorithm is judged against: with
 * a LIFO frontier the search commits to whichever branch it opened last, so the path it returns is *a* path —
 * walkable, one-way-correct, free of repeats — that can be twice as long as the cheapest one. `RouteFound`
 * carries `cost` and `metres` anyway, so the number is there to be compared:
 * "dfs is 214 m, a-star is 96 m" is the sentence that makes the phase's point, and
 * `src/test/campus-routing.spec.ts` prints that comparison rather than describing it.
 *
 * It is not in the UI's algorithm picker. A route a person might actually walk has to be a shortest one under
 * some profile; DFS is offered as the search that shows what happens when you skip the ordering rule.
 */
export function depthFirstRoute(
  index: GraphIndex,
  from: NodeId,
  to: NodeId,
  options: RouteSearchOptions = {},
): RouteResult {
  const run = new SearchRun(index, from, to, 'dfs', options)
  const refusal = run.checkEndpoints()
  if (refusal !== null) return refusal

  // Twelve lines, identical to `bfs.ts` except for the name of the search — which is the whole design of
  // `search-common.ts`: the container is the algorithm.
  run.offer({ id: from, via: null, edgeId: null, priority: 0, cost: 0, metres: 0 })
  for (;;) {
    const settled = run.next()
    if (settled === null) return run.exhausted()
    if (settled.id === to) return run.found(settled)
    const expansion = run.expand(settled)
    if (expansion.badCost !== undefined) return run.refusedCost(expansion.badCost)
    for (const offer of expansion.offers) run.offer({ ...offer, priority: offer.cost })
  }
}
