import { describe, expect, it } from 'vitest'
import { BASE_SEED, compareStrings, createRandom } from '../__tests__/helpers'
import { Trie, compareMatches, normaliseWord, type TrieRecord } from './trie'

/**
 * The model below is a flat array plus filter-and-sort. It is not a second trie — it has no nodes,
 * no pruning and no shared prefixes — which is the point: it cannot inherit a bug from the
 * structure it is checking.
 */
interface ModelRecord {
  payload: string
  label: string
  primaryKey: string
  keys: { key: string; word: string }[]
  sequence: number
}

class TrieModel {
  rows: ModelRecord[] = []
  #serial = 0

  insert(word: string, payload: string): void {
    const key = normaliseWord(word)
    const existing = this.rows.find((row) => row.payload === payload)
    if (existing !== undefined) {
      if (existing.keys.some((entry) => entry.key === key)) return
      existing.keys.push({ key, word })
      return
    }
    this.rows.push({
      payload,
      label: word,
      primaryKey: key,
      keys: [{ key, word }],
      sequence: this.#serial++,
    })
  }

  removeKey(word: string, payload: string): boolean {
    const key = normaliseWord(word)
    const row = this.rows.find((candidate) => candidate.payload === payload)
    if (row === undefined || !row.keys.some((entry) => entry.key === key)) return false
    row.keys = row.keys.filter((entry) => entry.key !== key)
    if (row.keys.length === 0) {
      this.rows = this.rows.filter((candidate) => candidate !== row)
      return true
    }
    if (row.primaryKey === key) {
      const promoted = row.keys[0]
      if (promoted !== undefined) {
        row.primaryKey = promoted.key
        row.label = promoted.word
      }
    }
    return true
  }

  remove(word: string): boolean {
    const key = normaliseWord(word)
    const victim = this.rows
      .filter((row) => row.keys.some((entry) => entry.key === key))
      .sort((a, b) => a.sequence - b.sequence)[0]
    if (victim === undefined) return false
    this.rows = this.rows.filter((row) => row !== victim)
    return true
  }

  get keyCount(): number {
    return new Set(this.rows.flatMap((row) => row.keys.map((entry) => entry.key))).size
  }

  rank(rows: readonly ModelRecord[]): ModelRecord[] {
    return [...rows].sort((a, b) => {
      const byLabel = a.label.length - b.label.length
      if (byLabel !== 0) return byLabel
      if (a.primaryKey !== b.primaryKey) return compareStrings(a.primaryKey, b.primaryKey)
      return a.sequence - b.sequence
    })
  }

  complete(prefix: string, limit: number): ModelRecord[] {
    const normalised = normaliseWord(prefix)
    const matched = this.rows.filter((row) =>
      row.keys.some((entry) => entry.key.startsWith(normalised)),
    )
    return this.rank(matched).slice(0, limit)
  }

  keysUnder(prefix: string): string[] {
    const normalised = normaliseWord(prefix)
    const keys = new Set<string>()
    for (const row of this.rows) {
      for (const entry of row.keys) if (entry.key.startsWith(normalised)) keys.add(entry.key)
    }
    return [...keys]
  }
}

const NAMES = [
  'Main Gate',
  'Admin Block',
  'Central Library',
  'Library Annex',
  'Lab 2',
  'Hostel Arch',
  'A',
  'Amphi',
  'Amit',
  'Abc',
]

function expectOrderedRows(trie: Trie<string>, model: TrieModel, label: string): void {
  for (const probe of ['', 'a', 'am', 'c', 'ce', 'l', 'lab', 'h', 'm', 'z', 'main g']) {
    const got = trie.complete(probe, 999).map((match) => match.payload)
    const want = model.complete(probe, 999).map((row) => row.payload)
    expect(got, `${label} — complete(${JSON.stringify(probe)})`).toEqual(want)
  }
}

describe('Trie', () => {
  it('is empty and answers nothing', () => {
    const trie = new Trie<string>()
    expect(trie.size).toBe(0)
    expect(trie.keyCount).toBe(0)
    expect(trie.complete('')).toEqual([])
    expect(trie.complete('a')).toEqual([])
    expect(trie.records()).toEqual([])
    expect(trie.has('anything')).toBe(false)
    expect(trie.startsWith('a')).toBe(false)
    expect(trie.countUnder('a')).toBe(0)
    expect(trie.nodeAt('a')).toBeUndefined()
    expect(trie.remove('a')).toBe(false)
    expect(trie.removeKey('a', 'x')).toBe(false)
  })

  it('matches case-insensitively on both sides', () => {
    const trie = new Trie<string>().insert('Central Library', 'lib')
    expect(trie.has('CENTRAL LIBRARY')).toBe(true)
    expect(trie.lookup('central library')[0]?.payload).toBe('lib')
    expect(trie.complete('CeNtRaL').map((match) => match.payload)).toEqual(['lib'])
    expect(trie.complete('  central   libr  ').map((match) => match.payload)).toEqual(['lib'])
  })

  it('normalises accents and whitespace but keeps punctuation', () => {
    expect(normaliseWord('  Café   Quad ')).toBe('cafe quad')
    expect(normaliseWord('ÌE')).toBe('ie')
    expect(normaliseWord('Lab-2')).toBe('lab-2')
    expect(normaliseWord('a\t\n  b')).toBe('a b')
    const trie = new Trie<string>().insert('Café Quad', 'cafe')
    expect(trie.has('cafe quad')).toBe(true)
    expect(trie.complete('caf').map((match) => match.matchedKey)).toEqual(['cafe quad'])
    // 'Lab-2' and 'Lab 2' are different places in a campus dataset; merging them would be a lie.
    trie.insert('Lab 2', 'lab2-space')
    trie.insert('Lab-2', 'lab2-dash')
    expect(trie.has('lab-2')).toBe(true)
    expect(trie.has('lab 2')).toBe(true)
    expect(trie.keyCount).toBe(3)
    expect(trie.complete('lab').map((match) => match.matchedKey).sort()).toEqual([
      'lab 2',
      'lab-2',
    ])
  })

  it('is idempotent for a repeated pair and turns a new word into an alias', () => {
    const trie = new Trie<string>().insert('Main Quad', 'quad')
    trie.insert('main quad', 'quad')
    expect([trie.size, trie.keyCount]).toEqual([1, 1])
    trie.insert('The Quad', 'quad')
    expect([trie.size, trie.keyCount]).toEqual([1, 2])
    expect(trie.complete('the').map((match) => match.payload)).toEqual(['quad'])
    expect(trie.records()[0]?.label).toBe('Main Quad')
    expect(trie.records()[0]?.words).toEqual(['Main Quad', 'The Quad'])
  })

  it('ranks lookup by shortest label, then by key', () => {
    const trie = new Trie<string>()
      .insert('Annex', 'a')
      .insert('Big Annex Hall', 'b')
      .insert('East Annex', 'e')
    // Each of the three is reachable only through its own key, so the shared-key case below is
    // the one that exercises ranking.
    trie.insert('Annex', 'second')
    const underAnnex = trie.lookup('Annex')
    expect(underAnnex.map((record) => record.payload)).toEqual(['a', 'second'])
    expect(trie.complete('', 99).map((match) => match.label)).toEqual([
      'Annex',
      'Annex',
      'East Annex',
      'Big Annex Hall',
    ])
    expect(compareMatches({ label: 'abc', key: 'z' }, { label: 'ab', key: 'a' })).toBe(1)
  })

  it('truncates to the limit and to the default limit', () => {
    const trie = new Trie<string>()
    for (let i = 0; i < 12; i++) trie.insert(`zz${String.fromCharCode(97 + i)}`, `p${i}`)
    expect(trie.complete('zz', 3)).toHaveLength(3)
    expect(trie.complete('zz', 0)).toEqual([])
    expect(trie.complete('zz')).toHaveLength(Trie.DEFAULT_LIMIT)
    expect(trie.complete('zz', 999)).toHaveLength(12)
  })

  it('resolves aliases without changing the displayed label', () => {
    const trie = new Trie<string>().insert('Central Library', 'lib')
    trie.addAlias('CL', 'lib')
    trie.addAlias('Central Library', 'lib') // already a key: no duplicate
    expect(trie.keyCount).toBe(2)
    expect(trie.complete('cl').map((match) => match.label)).toEqual(['Central Library'])
    expect(trie.complete('cl').map((match) => match.matchedKey)).toEqual(['cl'])
    expect(trie.records()).toHaveLength(1)
  })

  it('rejects an alias with nothing to attach to and an empty word', () => {
    const trie = new Trie<string>()
    expect(() => trie.addAlias('CL', 'missing')).toThrow(RangeError)
    expect(() => trie.insert('   ', 'x')).toThrow(TypeError)
    expect(() => trie.insert('x', 'y').addAlias('  ', 'y')).toThrow(TypeError)
    expect(() => trie.insert('x', 'y').addAlias('anything', 'absent')).toThrow(RangeError)
  })

  it('keeps two places that share a name as two records', () => {
    const trie = new Trie<string>().insert('Gate', 'north').insert('Gate', 'south')
    expect(trie.size).toBe(2)
    expect(trie.keyCount).toBe(1)
    expect(trie.lookup('Gate').map((record) => record.payload)).toEqual(['north', 'south'])
    expect(trie.complete('gat').map((match) => match.payload)).toEqual(['north', 'south'])
  })

  it('remove() deletes the record and every alias it registered', () => {
    const trie = new Trie<string>().insert('Hostel Arch', 'h1').addAlias('HA', 'h1')
    trie.insert('Hostel Arch', 'h2') // two places, one name
    expect(trie.remove('ha')).toBe(true)
    expect(trie.has('HA')).toBe(false)
    expect(trie.has('hostel arch')).toBe(true) // the *name* stays, h2 owns it
    expect(trie.size).toBe(1)
    expect(trie.records()[0]?.payload).toBe('h2')
  })

  it('removeKey() unregisters one spelling, promoting an alias with its own spelling', () => {
    const trie = new Trie<string>().insert('Auditorium', 'aud').addAlias('AU', 'aud')
    expect(trie.removeKey('Auditorium', 'aud')).toBe(true)
    expect(trie.records()[0]?.label).toBe('AU')
    expect(trie.complete('aud')).toEqual([])
    expect(trie.complete('au').map((match) => match.payload)).toEqual(['aud'])

    expect(trie.removeKey('au', 'aud')).toBe(true)
    expect(trie.size).toBe(0)
    expect(trie.nodeAt('a')).toBeUndefined()
    expect(trie.startsWith('a')).toBe(false)
  })

  it('prunes dead branches so a removed prefix stops matching', () => {
    const trie = new Trie<string>().insert('Apex', 'x').insert('Appendix', 'y')
    expect(trie.nodeAt('ap')?.keys.size).toBe(0) // nothing *ends* at 'ap'
    expect(trie.countUnder('ap')).toBe(2) // but two keys live below it
    trie.remove('Apex')
    expect(trie.nodeAt('apex')).toBeUndefined()
    expect(trie.countUnder('ap')).toBe(1)
    trie.remove('Appendix')
    expect(trie.nodeAt('a')).toBeUndefined()
    expect(trie.nodeAt('ap')).toBeUndefined()
    expect(trie.startsWith('a')).toBe(false)
    expect(trie.countUnder('')).toBe(0)
  })

  it('records() runs the same ranking, with the sequence tiebreak deciding a true tie', () => {
    const trie = new Trie<string>()
    // (1) Two labels of *equal length* but different keys: the key decides, so insertion order must
    // not. 'Zed' is inserted first and still ranks second.
    trie.insert('Zed Court', 'z').insert('Ard Court', 'a')
    expect(trie.records().map((record) => record.label)).toEqual(['Ard Court', 'Zed Court'])

    // (2) Two records with the same label length *and* the same key: compareMatches returns 0, so
    // only the insertion sequence can order them. Without that tier the order here is whatever the
    // Map hands back, and the dropdown would reorder itself between renders.
    const second = new Trie<string>().insert('Gate', 'south').insert('Gate', 'north')
    expect(second.records().map((record) => record.payload)).toEqual(['south', 'north'])
    second.remove('Gate') // removes the earliest, leaving 'north'
    expect(second.records().map((record) => record.payload)).toEqual(['north'])
    expect(second.records()[0]).toEqual<TrieRecord<string>>({
      label: 'Gate',
      key: 'gate',
      keys: ['gate'],
      words: ['Gate'],
      payload: 'north',
    })
  })

  it('countUnder equals a recount of the subtree', () => {
    const trie = new Trie<string>()
    const model = new TrieModel()
    for (const [index, name] of NAMES.entries()) {
      trie.insert(name, `p${index}`)
      model.insert(name, `p${index}`)
    }
    trie.addAlias('CL', 'p2')
    model.insert('CL', 'p2')
    for (const prefix of ['', 'a', 'am', 'c', 'ce', 'l', 'lab', 'z']) {
      expect(trie.countUnder(prefix), `countUnder(${JSON.stringify(prefix)})`).toBe(
        model.keysUnder(prefix).length,
      )
      const node = trie.nodeAt(prefix)
      expect(node?.passes() ?? 0).toBe(model.keysUnder(prefix).length)
    }
  })

  it('clear() empties every structure it owns', () => {
    const trie = new Trie<string>().insert('Annex', 'a').addAlias('AX', 'a').insert('Depot', 'd')
    expect([trie.size, trie.keyCount]).toEqual([2, 3])
    trie.clear()
    expect([trie.size, trie.keyCount]).toEqual([0, 0])
    expect(trie.complete('', 99)).toEqual([])
    expect(trie.records()).toEqual([])
    expect(trie.nodeAt('a')).toBeUndefined()
    expect(trie.startsWith('a')).toBe(false)
    // Reusable afterwards: the serial counter keeps rising, so ties stay insertion-ordered across
    // a clear rather than resetting to a value that collides with the previous batch.
    trie.insert('Bay', 'b')
    expect(trie.complete('ba').map((match) => match.payload)).toEqual(['b'])
  })

  it('prefix search matches a brute-force filter over 30 random trials', () => {
    const rng = createRandom(BASE_SEED ^ 0x51ed)
    for (let trial = 0; trial < 30; trial++) {
      const trie = new Trie<string>()
      const model = new TrieModel()
      const payloads = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']
      for (let step = 0; step < 120; step++) {
        const word = rng.pick(NAMES) as string
        const payload = rng.pick(payloads) as string
        const roll = rng.int(5)
        if (roll < 2) {
          trie.insert(word, payload)
          model.insert(word, payload)
        } else if (roll === 2) {
          // A new word for a payload already in the index is an alias; for an unknown payload it
          // creates the record. The engine and the model must take the same branch here, or the
          // comparison is measuring two different operations.
          const alias = `${word} X`
          if (model.rows.some((row) => row.payload === payload)) trie.addAlias(alias, payload)
          else trie.insert(alias, payload)
          model.insert(alias, payload)
        } else if (roll === 3) {
          expect(trie.removeKey(word, payload)).toBe(model.removeKey(word, payload))
        } else {
          expect(trie.remove(word)).toBe(model.remove(word))
        }
        expectOrderedRows(trie, model, `trial ${trial} step ${step}`)
        expect(trie.keyCount, `trial ${trial} step ${step} keyCount`).toBe(model.keyCount)
      }

      for (const probe of ['a', 'am', 'c', 'ce', 'l', 'lab', 'h', 'm', 'z', 'zz', 'main g']) {
        for (const limit of [1, 3, 8]) {
          const got = trie.complete(probe, limit)
          const want = model.complete(probe, limit)
          expect(got.map((match) => match.payload), `probe ${probe} limit ${limit}`).toEqual(
            want.map((row) => row.payload),
          )
          for (const match of got) {
            expect(match.matchedKey.startsWith(normaliseWord(probe))).toBe(true)
            expect(match.record.payload).toBe(match.payload)
          }
        }
      }
    }
  })
})
