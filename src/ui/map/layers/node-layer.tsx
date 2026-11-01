/**
 * The vertices of the graph, which is the one layer a navigator has to be honest about.
 *
 * A junction is a 2 px dot, a place is a filled circle in its zone's colour, and an entrance is a ring:
 * the distinction is the data model ("a place is a node that carries a category"), so it should be visible
 * even where the labels are suppressed. Icon badges land in checkpoint 4 on top of these dots.
 *
 * The dots are drawn from `model.nodes` — the *engine's* nodes — rather than from the file's rows, so a
 * row the validator dropped is absent from the map too. Drawing what the router cannot reach would be the
 * most convincing kind of lie this app could tell.
 */
import { memo } from 'react'
import type { GraphNode } from '@/data'

export interface NodeLayerProps {
  readonly nodes: readonly GraphNode[]
  readonly colourFor: (zone: string | undefined) => string
  /** True once you are close enough that a place's dot deserves a hit target bigger than itself. */
  readonly detailed: boolean
}

function NodeLayerBase({ nodes, colourFor, detailed }: NodeLayerProps) {
  return (
    <g className="layer-nodes">
      {nodes.map((node) => (
        <circle
          key={node.id}
          className={`node node--${node.kind}`}
          cx={node.x}
          cy={node.y}
          r={detailed ? radiusFor(node.kind) + 1 : radiusFor(node.kind)}
          style={node.kind === 'junction' ? undefined : { fill: colourFor(node.zone) }}
        >
          <title>{node.label}</title>
        </circle>
      ))}
    </g>
  )
}

function radiusFor(kind: GraphNode['kind']): number {
  switch (kind) {
    case 'gate':
      return 6
    case 'place':
      return 4.5
    case 'entrance':
      return 3.5
    default:
      return 2
  }
}

export const NodeLayer = memo(NodeLayerBase)
