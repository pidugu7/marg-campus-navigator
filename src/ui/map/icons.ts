/**
 * One Lucide icon per place type, and nothing else.
 *
 * Icons are keyed by the data's `category`, not by node id or label, because that is the field the schema
 * says a place carries for exactly this purpose (and for the trie's ranking). The fallback is *no* badge
 * rather than a generic pin: a map that draws a coffee cup outside the health centre is worse than one that
 * draws a dot, and `icons.spec.ts` fails if a category in `campus.json` has no entry here, so the table
 * cannot quietly fall behind the file.
 */
import {
  Banknote,
  BookOpen,
  Briefcase,
  Car,
  DoorOpen,
  School,
  Stethoscope,
  BedDouble,
  Toilet,
  Trees,
  Trophy,
  Utensils,
  type LucideIcon,
} from 'lucide-react'

export interface IconSpec {
  readonly icon: LucideIcon
  /** What the legend calls this kind of place — the data's `category` is a key, not a caption. */
  readonly title: string
}

const BY_CATEGORY: Readonly<Record<string, IconSpec>> = {
  academic: { icon: School, title: 'Academic block' },
  library: { icon: BookOpen, title: 'Library' },
  food: { icon: Utensils, title: 'Food' },
  residence: { icon: BedDouble, title: 'Residence' },
  sport: { icon: Trophy, title: 'Sport' },
  outdoor: { icon: Trees, title: 'Open ground' },
  parking: { icon: Car, title: 'Parking' },
  money: { icon: Banknote, title: 'Money' },
  restroom: { icon: Toilet, title: 'Restroom' },
  health: { icon: Stethoscope, title: 'Health' },
  office: { icon: Briefcase, title: 'Office' },
  entry: { icon: DoorOpen, title: 'Gate' },
}

/** Kinds that are not searchable places but still deserve a mark: the door of a building, say. */
const BY_KIND: Readonly<Record<string, IconSpec>> = {
  entrance: { icon: DoorOpen, title: 'Entrance' },
}

/**
 * @param category `NodeSpec.category`, absent on a junction.
 * @returns undefined for anything unlabelled — including every junction, which is most of the graph.
 */
export function iconFor(category: string | undefined, kind: string): IconSpec | undefined {
  if (category !== undefined && category !== '') {
    const byCategory = BY_CATEGORY[category]
    if (byCategory) return byCategory
  }
  return BY_KIND[kind]
}

/**
 * For the legend: every badge the map can actually draw, in table order.
 *
 * Two sources, because the icon table has two tiers. `usedCategories` covers places, which carry a
 * `category`. `usedKinds` covers the entries that do *not* — an `entrance` node exists to be walked into a
 * building and has no category to key on, and without this second argument the map would draw a glyph the
 * legend never explains. The caller passes a kind only when the node has no category, which is exactly the
 * condition `iconFor` falls back on, so the two cannot drift apart.
 */
export function legendIcons(
  usedCategories: ReadonlySet<string>,
  usedKinds: ReadonlySet<string> = new Set(),
): readonly (IconSpec & { readonly key: string })[] {
  const rows = Object.entries(BY_CATEGORY)
    .filter(([category]) => usedCategories.has(category))
    .map(([category, spec]) => ({ key: category, ...spec }))
  const kindRows = Object.entries(BY_KIND)
    .filter(([kind]) => usedKinds.has(kind))
    .map(([kind, spec]) => ({ key: `kind:${kind}`, ...spec }))
  return [...rows, ...kindRows]
}
