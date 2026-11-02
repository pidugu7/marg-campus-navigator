/**
 * The legend, and the plate's only other overlay besides the tooltip.
 *
 * Three things it has to do, in order of how often they get used: name the zone colours (they come from the
 * data file, so the legend is generated from `zones[]` and can never describe a palette the map is not
 * using), explain the badge glyphs (likewise generated from the categories the file contains — a campus
 * with no parking lot shows no parking row), and say what the *absence* of a tooltip line means. That last
 * one is the reason this is a component and not a static list: "step-free, lit, paved, flat" is the
 * engine's `DEFAULT_EDGE_ATTRIBUTES` re-worded by the same function the tooltips use, so the legend cannot
 * quietly describe a baseline the builder has changed.
 *
 * Collapsed by default on a narrow plate, via `useState(narrow)` rather than a CSS media query, so the
 * person's own choice survives a resize in either direction.
 */
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ZoneSpec } from '@/data'
import type { IconSpec } from './icons'

export interface LegendProps {
  readonly zones: readonly ZoneSpec[]
  readonly icons: readonly (IconSpec & { readonly key: string })[]
  readonly baseline: readonly string[]
  readonly counts: {
    readonly places: number
    readonly buildings: number
    readonly surfaces: number
    readonly segments: number
    readonly metres: number
    readonly components: number
  }
  /** Markers the plan could not fit at this zoom. The sentence is a promise, not a complaint. */
  readonly hiddenMarkers: number
  readonly hiddenLabels: number
  readonly scalePct: number
  readonly narrow: boolean
}

export function MapLegend({
  zones,
  icons,
  baseline,
  counts,
  hiddenMarkers,
  hiddenLabels,
  scalePct,
  narrow,
}: LegendProps) {
  const [open, setOpen] = useState(!narrow)
  const stow = () => setOpen((current) => !current)

  return (
    <div className="map-legend">
      <button type="button" className="map-legend-toggle" aria-expanded={open} aria-controls="map-legend-body" onClick={stow}>
        <span>Legend</span>
        <span className="map-legend-zoom">{scalePct}%</span>
        <ChevronDown size={14} aria-hidden="true" className={open ? 'map-legend-caret' : 'map-legend-caret map-legend-caret--stowed'} />
      </button>

      {open ? (
        <div className="map-legend-body" id="map-legend-body">
          <ul className="map-legend-list">
            {zones.map((zone) => (
              <li key={zone.id}>
                <span className="swatch" style={{ background: zone.color }} aria-hidden="true" />
                {zone.label}
              </li>
            ))}
          </ul>

          {icons.length === 0 ? null : (
            <ul className="map-legend-list map-legend-list--icons">
              {icons.map((row) => (
                <li key={row.key}>
                  <span className="legend-badge" style={{ color: 'var(--accent)' }}>
                    <row.icon size={13} strokeWidth={2} aria-hidden="true" />
                  </span>
                  {row.title}
                </li>
              ))}
            </ul>
          )}

          <ul className="map-legend-list map-legend-list--lines">
            <li>
              <svg viewBox="0 0 24 8" aria-hidden="true" className="legend-line">
                <line x1="1" y1="4" x2="23" y2="4" className="walk-case" />
                <line x1="1" y1="4" x2="23" y2="4" className="walk-fill" />
              </svg>
              walkway
            </li>
            <li>
              <svg viewBox="0 0 24 8" aria-hidden="true" className="legend-line">
                <line x1="1" y1="4" x2="23" y2="4" className="walk-case" />
                <line x1="1" y1="4" x2="23" y2="4" className="walk-fill walk--stairs" />
              </svg>
              steps
            </li>
            <li>
              <svg viewBox="0 0 24 8" aria-hidden="true" className="legend-line">
                <line x1="1" y1="4" x2="23" y2="4" className="walk-case" />
                <line x1="1" y1="4" x2="23" y2="4" className="walk-fill walk--grass" />
              </svg>
              grass
            </li>
          </ul>

          <p className="map-legend-note">
            A segment that says nothing is {baseline.join(' · ')}.
          </p>
          <p className="map-legend-note">
            {counts.places} places, {counts.segments} segments, {counts.metres} m, {counts.buildings} buildings,{' '}
            {counts.surfaces} surfaces, {counts.components} network
            {counts.components === 1 ? '' : 's'} ·{' '}
            {hiddenMarkers > 0
              ? `${hiddenMarkers} marker${hiddenMarkers === 1 ? '' : 's'} need${hiddenMarkers === 1 ? 's' : ''} more zoom`
              : hiddenLabels > 0
                ? `${hiddenLabels} label${hiddenLabels === 1 ? '' : 's'} hidden`
                : 'every marker labelled'}
          </p>
          {/* The one place the gestures are written down. Hidden under 640 px in CSS, where the fingers
              have already found them. */}
          <p className="map-legend-note map-legend-hint">drag to pan · wheel or pinch to zoom · 0 resets</p>
        </div>
      ) : null}
    </div>
  )
}
