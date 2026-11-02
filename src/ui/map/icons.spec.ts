/**
 * The icon table is only useful if it cannot fall behind the data, so it is checked against the shipped
 * file rather than against a copy of the list. Nothing here asserts pixel positions: this is the "did you
 * forget the new category" guard, and it belongs next to the table.
 */
import { describe, expect, it } from 'vitest'
import { campus } from '@/data'
import { legendIcons, iconFor } from './icons'

const categories = new Set(campus.nodes.map((node) => node.category).filter((c): c is string => typeof c === 'string'))
const kinds = new Set(campus.nodes.map((node) => node.kind))

describe('the icon table against the dataset', () => {
  it('has an icon for every category the campus file uses', () => {
    const unmapped = [...categories].filter((category) => {
      const anyKind = campus.nodes.find((node) => node.category === category)?.kind ?? 'place'
      return iconFor(category, anyKind) === undefined
    })
    expect(unmapped, `categories with no icon: ${unmapped.join(', ')}`).toEqual([])
  })

  it('draws nothing for a junction, which is most of the graph', () => {
    for (const kind of kinds) {
      if (kind === 'junction') expect(iconFor(undefined, kind)).toBeUndefined()
    }
    expect(iconFor(undefined, 'entrance')?.title).toBe('Entrance')
    expect(iconFor(undefined, 'place')).toBeUndefined()
  })

  it('degrades to no badge for a category nobody has drawn yet', () => {
    // The realistic failure: someone adds `"category": "helipad"` to campus.json before anyone adds an
    // icon. A dot is the right answer, an invented icon is not, and the drift test above is what turns it
    // into a failing build rather than a shrug.
    expect(iconFor('helipad', 'place')).toBeUndefined()
    expect(iconFor('helipad', 'entrance')?.title).toBe('Entrance')
  })

  it('treats an empty category as none, since a JSON editor can produce one', () => {
    expect(iconFor('', 'place')).toBeUndefined()
    expect(iconFor('', 'gate')?.title).toBeUndefined()
  })

  it('lists legend rows only for categories that exist, in table order', () => {
    const rows = legendIcons(new Set(['library', 'food']))
    expect(rows.map((row) => row.key)).toEqual(['library', 'food'])
    expect(rows[0]?.title).toBe('Library')
    expect(legendIcons(new Set()).length).toBe(0)
  })

  it('explains a badge drawn from a kind, or the legend would be missing a glyph', () => {
    const rows = legendIcons(new Set(), new Set(['entrance']))
    expect(rows.map((row) => [row.key, row.title])).toEqual([['kind:entrance', 'Entrance']])
    // A kind with no entry of its own adds nothing: `place` is explained by its category.
    expect(legendIcons(new Set(['library']), new Set(['place']))).toHaveLength(1)
  })

  it('covers every badge the shipped campus draws, category or kind', () => {
    const categories = new Set<string>()
    const kinds = new Set<string>()
    for (const row of campus.nodes) {
      if (row.kind === 'junction') continue
      if (typeof row.category === 'string' && row.category !== '') categories.add(row.category)
      else kinds.add(row.kind)
    }
    const rows = legendIcons(categories, kinds)
    const drawn = campus.nodes.filter((n) => n.kind !== 'junction').map((n) => iconFor(n.category, n.kind))
    expect(rows.length).toBe(new Set(drawn.filter(Boolean).map((spec) => spec?.title)).size)
    expect(rows.map((row) => row.title)).toContain('Entrance')
  })

  it('has a distinct icon per category, so the legend is not decorative', () => {
    const rows = legendIcons(categories)
    expect(rows.length).toBe(categories.size)
    expect(new Set(rows.map((row) => row.icon)).size).toBe(rows.length)
  })
})
