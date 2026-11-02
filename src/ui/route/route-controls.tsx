/**
 * The route form: a start, a destination, a search, and a swap.
 *
 * Plain `<select>` elements, deliberately, in Phase 3. A typeahead would need the trie, and the trie is
 * Phase 5's lesson; a picker that works is worth more at the end of this phase than a fancy one, and every
 * decision the *fancy* one will make is already made in `route-options.ts` — so Phase 5 replaces this file's
 * markup and not the rules.
 *
 * What this file does not do: import `@/engine`. The algorithm names come from the hook's own union type, and
 * the route itself arrives as props from `useRoute`. That is the boundary the architecture test enforces, and
 * the reason the form would still compile if every search were replaced tomorrow.
 */
import { ArrowLeftRight } from 'lucide-react'
import { ALGORITHM_CHOICES, algorithmChoice, pickerRows } from './route-options'
import type { PlaceOption, ProfileChoice, ProfileName } from './route-options'
import type { RouteAlgorithmChoice } from '@/hooks/useRoute'

export interface RouteControlsProps {
  /** Every routable vertex, from `placeOptions` — the component does not know what a campus is. */
  readonly options: readonly PlaceOption[]
  readonly from: string
  readonly to: string
  readonly algorithm: RouteAlgorithmChoice
  /** The cost profile the route is priced under. */
  readonly profile: ProfileName
  /** The rows for the preference `<select>`, in the engine's order — built in `App` from the hook, because the
   *  wording of a preference is the engine's fact about it and not this component's. */
  readonly profiles: readonly ProfileChoice[]
  readonly onFrom: (id: string) => void
  readonly onTo: (id: string) => void
  readonly onAlgorithm: (algorithm: RouteAlgorithmChoice) => void
  readonly onProfile: (profile: ProfileName) => void
  readonly onSwap: () => void
}

interface PickerProps {
  readonly id: string
  readonly caption: string
  readonly value: string
  readonly options: readonly PlaceOption[]
  readonly onSelect: (id: string) => void
}

function PlacePicker({ id, caption, value, options, onSelect }: PickerProps) {
  const rows = pickerRows(options, value)
  return (
    <div className="field">
      {/* A `htmlFor` label rather than a wrapping one: a `<label>` that both contains and points at the select
          associates twice, which is the sort of thing a screen reader reads as "From From". */}
      <label className="field-caption" htmlFor={id}>
        {caption}
      </label>
      <select id={id} className="picker" value={value} onChange={(event) => onSelect(event.target.value)}>
        <option value="">{value === '' ? 'pick a place…' : 'no place'}</option>
        {rows.map((row) => (
          <option
            key={row.id}
            value={row.id}
            disabled={row.unavailable}
            title={row.unavailable ? 'no walkway reaches this place' : undefined}
          >
            {row.unavailable ? `${row.label} — unreachable` : row.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function RouteControls({
  options,
  from,
  to,
  algorithm,
  profile,
  profiles,
  onFrom,
  onTo,
  onAlgorithm,
  onProfile,
  onSwap,
}: RouteControlsProps) {
  const choice = algorithmChoice(algorithm)
  // A `find` left optional rather than a lookup promised total, and no helper for it: if a row is ever missing the
  // caption under the select is simply not drawn, the select still works, and nothing about the *answer* is wrong.
  // A `throw` here would turn a missing sentence into a blank page, and a fallback to the baseline row would
  // print an explanation of a preference the user did not pick.
  const trade = profiles.find((row) => row.value === profile)
  const bothChosen = from !== '' && to !== ''
  return (
    <div className="route-form">
      <div className="route-pickers">
        <PlacePicker id="route-from" caption="From" value={from} options={options} onSelect={onFrom} />
        <button
          type="button"
          className="route-swap"
          // Swapping two empty pickers is not a thing to do, and a button that answers "no" to every click is
          // worse than one that is greyed out: `disabled` says why before the first press.
          disabled={!bothChosen}
          onClick={onSwap}
          title="Swap start and destination"
          aria-label="Swap start and destination"
        >
          <ArrowLeftRight size={14} aria-hidden="true" />
        </button>
        <PlacePicker id="route-to" caption="To" value={to} options={options} onSelect={onTo} />
      </div>

      <div className="field">
        <label className="field-caption" htmlFor="route-algorithm">
          Algorithm
        </label>
        <select
          id="route-algorithm"
          className="picker"
          value={algorithm}
          onChange={(event) => onAlgorithm(event.target.value as RouteAlgorithmChoice)}
        >
          {ALGORITHM_CHOICES.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-caption" htmlFor="route-profile">
          Preference
        </label>
        <select
          id="route-profile"
          className="picker"
          value={profile}
          onChange={(event) => onProfile(event.target.value as ProfileName)}
        >
          {profiles.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </select>
      </div>
      {/* Two sentences, because two decisions: the preference says what the *route* is for, the algorithm says
          how it is found. Merging them into one paragraph would be the shorter markup and the worse lesson. */}
      {trade === undefined ? null : <p className="route-note">{trade.note}</p>}
      <p className="route-note">{choice.note}</p>
    </div>
  )
}
