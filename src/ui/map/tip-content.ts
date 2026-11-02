/**
 * What a tooltip says, as a function rather than as JSX.
 *
 * The wording is the map's only explanation of the per-edge attributes, and the rules are the same for a
 * walkway, a building and a place: metric to one decimal, flags as words a person would use out loud
 * ("step-free", not `stepFree: true`), and **nothing that is merely the default**. `DEFAULT_EDGE_ATTRIBUTES`
 * says a plain segment is step-free, lit, paved, flat and mildly busy, so a tooltip that recited those on
 * all 56 edges would hide the one fact that matters. Every line is therefore a *deviation* from the
 * baseline, in both directions: an unlit path is worth naming, and so is a staircase where you expected a
 * ramp.
 *
 * This is also what replaced the native `<title>` elements: a browser tooltip cannot be styled, cannot be
 * dismissed with Escape, and does not exist on a phone.
 */
import { DEFAULT_EDGE_ATTRIBUTES } from '@/data'
import type { BuildingSpec, EdgeAttributes, GraphEdge, GraphNode, SurfaceKind } from '@/data'

export interface TipContent {
  readonly title: string
  readonly lines: readonly string[]
}

const ZONE_LABELS_FALLBACK = 'unzoned'

export function placeTip(
  node: GraphNode,
  info: {
    // Optional *and* undefined-typed: a caller that resolved no zone label passes `undefined`, and under
    // `exactOptionalPropertyTypes` that has to be legal at the boundary or the view pre-varnishes every
    // lookup with a `?? ''` that the legend would then print.
    readonly zoneLabel?: string | undefined
    readonly categoryLabel?: string | undefined
    readonly degrees: number
  },
): TipContent {
  const lines: string[] = [
    // A kind is always known — it is the engine's enum, not a string — so there is no "no identity" case
    // to branch on; only the category label is optional.
    info.categoryLabel === undefined ? node.kind : `${node.kind} · ${info.categoryLabel}`,
    `${info.zoneLabel ?? ZONE_LABELS_FALLBACK} zone`,
  ]
  lines.push(
    info.degrees === 0
      ? 'no walkway reaches it'
      : `${info.degrees} walkway segment${info.degrees === 1 ? '' : 's'}`,
  )
  return { title: node.label, lines }
}

export function edgeTip(edge: GraphEdge, ends: { readonly from: string; readonly to: string }): TipContent {
  return {
    title: `${ends.from} → ${ends.to}`,
    lines: [`${roundOne(edge.metres)} m`, ...attributeLines(edge.attributes), ...(edge.oneWay ? ['one-way'] : [])],
  }
}

export function buildingTip(
  building: BuildingSpec,
  info: { readonly zoneLabel?: string | undefined; readonly labelFor: (nodeId: string) => string },
): TipContent {
  const lines: string[] = []
  lines.push(`${info.zoneLabel ?? ZONE_LABELS_FALLBACK} zone`)
  // `levels` is optional, and a single-storey block must not read as "0 levels".
  if (typeof building.levels === 'number' && building.levels > 1) {
    lines.push(`${building.levels} levels`)
  }
  const entries = building.entryNodeIds.map(info.labelFor)
  lines.push(entries.length === 0 ? 'no entrance recorded' : `entrance: ${entries.join(', ')}`)
  return { title: building.label, lines }
}

/**
 * What makes this segment unlike an ordinary one, in a fixed order: what makes you climb, whether you can
 * push a wheelchair down it, what you walk on, cover, then how much of it there is.
 *
 * The baseline is `DEFAULT_EDGE_ATTRIBUTES` and nothing else, so each clause is written in the direction
 * the data can actually deviate: `stairs` defaults to false, so the only news is stairs; `lit` defaults to
 * true, so the only news is darkness. (A `!attrs.lit ? 'lit' : ...` pair would spend an arm on a case no
 * file can produce.) The legend shares the function, so a flag cannot be called one thing there and
 * another thing here.
 */
export function attributeLines(attrs: EdgeAttributes): string[] {
  const lines: string[] = []
  if (attrs.stairs) lines.push('stairs')
  if (!attrs.stepFree) lines.push('not step-free')
  if (attrs.surface !== DEFAULT_EDGE_ATTRIBUTES.surface) lines.push(WORDING[attrs.surface])
  if (attrs.shaded) lines.push('shaded')
  if (!attrs.lit) lines.push('unlit at night')
  if (attrs.slope !== 0) lines.push(`${Math.round(Math.abs(attrs.slope) * 100)}% ${attrs.slope > 0 ? 'up' : 'down'}`)
  if (attrs.crowd !== DEFAULT_EDGE_ATTRIBUTES.crowd) {
    lines.push(attrs.crowd === 0 ? 'usually empty' : `crowd ${Math.round(attrs.crowd * 100)}%`)
  }
  return lines
}

/**
 * A total record over the engine's `SurfaceKind`, so `WORDING[attrs.surface]` needs no fallback: adding a
 * surface to the union without a word here is a compile error rather than a tooltip that says "tarmac".
 */
const WORDING: Readonly<Record<SurfaceKind, string>> = {
  paved: 'paved',
  covered: 'covered way',
  gravel: 'gravel',
  grass: 'grass',
  stairs: 'steps',
}

/**
 * The plain case, in words, for the legend: what a segment is *not* saying when its tooltip holds only a
 * length. Derived from the engine's defaults rather than retyped, so the legend cannot describe a baseline
 * the builder has since changed.
 *
 * Every clause is conditional because the argument is `DEFAULT_EDGE_ATTRIBUTES` *by reference*, not by
 * value: if a later phase decides a plain segment is unlit, this sentence and the tooltips change together.
 * The legend has one line to spend, so it gets the facts a reader can act on.
 */
export function baselineWords(attrs: EdgeAttributes): string[] {
  const words: string[] = []
  // 'no steps' and 'step-free' are one sentence to a reader, so only the stronger claim is printed.
  if (attrs.stepFree) words.push('step-free')
  else if (attrs.stairs) words.push('stairs')
  words.push(WORDING[attrs.surface])
  if (attrs.shaded) words.push('shaded')
  if (attrs.lit) words.push('lit')
  if (attrs.slope === 0) words.push('flat')
  else words.push(`${Math.round(Math.abs(attrs.slope) * 100)}% grade`)
  words.push(`crowd ${Math.round(attrs.crowd * 100)}%`)
  return words
}

const roundOne = (value: number): number => Math.round(value * 10) / 10
