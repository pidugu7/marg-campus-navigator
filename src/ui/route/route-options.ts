/**
 * The picker's content, as pure functions.
 *
 * Two `<select>`s and a dropdown look like the least interesting code in the app, which is why they live in a
 * module of their own: every decision in them is a rule somebody will ask about ("why is the ATM greyed out?",
 * "why is BFS first?"), and a rule you can read in a test is a rule you do not have to re-derive by clicking.
 * The component below `route-controls.tsx` maps these rows to `<option>` elements and nothing else.
 */
import type { RouteAlgorithmChoice } from '@/hooks/useRoute'
import type { GraphEdge, GraphNode, NodeId, NodeKind } from '@/data'

export interface PlaceOption {
  readonly id: NodeId
  /** Ready to print: a gate or entrance says so, because "Gate 1" and a building called "Gate 1" are different
   *  things a reader needs to tell apart when both are in the same list. */
  readonly label: string
  readonly kind: NodeKind
  /** How many walkway segments touch this vertex. Zero means nothing can route to it. */
  readonly walkways: number
}

export interface PickerRow extends PlaceOption {
  /** Greyed out. A place no walkway reaches is a real entry in the file and a fake destination, so it is shown
   *  and disabled rather than hidden — hiding it would make the map and the list disagree about the campus. */
  readonly unavailable: boolean
}

/**
 * The named vertices a person might start or finish at, with how connected each one is.
 *
 * Junctions are excluded: they have no label worth reading, which is the same rule the marker layer applies to
 * labels. A place with no walkways is *kept*, because the validator's report already explains it and the picker
 * should agree with the map rather than tidy itself.
 */
export function placeOptions(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): PlaceOption[] {
  const walkways = new Map<NodeId, number>()
  for (const edge of edges) {
    walkways.set(edge.from, (walkways.get(edge.from) ?? 0) + 1)
    walkways.set(edge.to, (walkways.get(edge.to) ?? 0) + 1)
  }
  return nodes
    .filter((node) => node.kind !== 'junction')
    .map((node) => ({
      id: node.id,
      label: node.kind === 'place' ? node.label : `${node.label} (${node.kind})`,
      kind: node.kind,
      walkways: walkways.get(node.id) ?? 0,
    }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * The rows for one picker, given what that picker currently holds.
 *
 * `selected` is what the picker *already* says, which is the only thing that can make an unreachable place
 * selectable — and it has to be, because a swap can land on one. Disabling the current value would leave React
 * with a `value` no `<option>` matches, and a select that silently displays the first row is a control that
 * shows a start you did not choose.
 */
export function pickerRows(options: readonly PlaceOption[], selected: NodeId): readonly PickerRow[] {
  return options.map((option) => ({ ...option, unavailable: option.walkways === 0 && option.id !== selected }))
}

/** The swap button's whole job, spelled out so the state update below has nothing left to get wrong. */
export function swapEndpoints(from: NodeId, to: NodeId): readonly [NodeId, NodeId] {
  return [to, from]
}

export interface AlgorithmChoice {
  readonly value: RouteAlgorithmChoice
  /** The name in the `<option>`. The star is ASCII, as in the docs, because a `∗` in a `<select>` is a
   *  character the font has to have and the screenshot has to match. */
  readonly label: string
  /** One line under the picker: what this choice is doing to the number in the card. */
  readonly note: string
}

/**
 * The dropdown's content, in the order it is shown: A* first, because it is what this app should be using on a
 * campus, and Dijkstra next to it so the difference between them is one click away rather than a paragraph
 * away. BFS last and honestly labelled — it minimises the number of *walkway segments*, which on a campus
 * whose segments are 80 to 250 m long is not the shortest walk.
 *
 * The table is keyed `Record<RouteAlgorithmChoice, …>`, so adding a fourth search to the engine's union is a
 * compile error here rather than a dropdown that quietly keeps offering three. That is also why there is no
 * fallback for an unknown name: with the key type checked there is nothing to fall back from.
 */
const CHOICE_BY_VALUE: Record<RouteAlgorithmChoice, AlgorithmChoice> = {
  'a-star': {
    value: 'a-star',
    label: 'A*',
    note: 'Distance so far plus the straight-line distance left, so it stops exploring sideways.',
  },
  dijkstra: {
    value: 'dijkstra',
    label: 'Dijkstra',
    note: 'The same search with no guess — it settles every vertex by the distance walked so far, in all directions, until it reaches you.',
  },
  bfs: {
    value: 'bfs',
    label: 'BFS',
    note: 'Fewest walkway segments, whatever their length — the shortest hop count, not the shortest walk.',
  },
}

/** The three names, in picker order. */
export const ALGORITHM_CHOICES: readonly AlgorithmChoice[] = [
  CHOICE_BY_VALUE['a-star'],
  CHOICE_BY_VALUE.dijkstra,
  CHOICE_BY_VALUE.bfs,
]

/** The row for the name the state holds. */
export function algorithmChoice(value: RouteAlgorithmChoice): AlgorithmChoice {
  return CHOICE_BY_VALUE[value]
}
