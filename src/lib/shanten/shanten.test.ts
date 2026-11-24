import { describe, expect, it } from 'vitest'
import {
  bestDiscards,
  chiitoitsuShanten,
  discardOptions,
  hand,
  kokushiShanten,
  shanten,
  tileName,
} from './index'

describe('shanten', () => {
  it('complete hand = -1', () => {
    expect(shanten(hand('123456789m123p11s'))).toBe(-1)
  })

  it('complete chiitoitsu = -1', () => {
    expect(shanten(hand('1199m1199p1199s11z'))).toBe(-1)
  })

  it('tenpai = 0 (tanki wait)', () => {
    expect(shanten(hand('123456789m123p1s'))).toBe(0)
  })

  it('chiitoitsu 1-shanten', () => {
    // 5 pairs (11m 99m 55p 11z 44z) + 3 singles; standard and kokushi are both worse.
    const h = hand('1199m155p9s11447z')
    expect(h.reduce((a, b) => a + b, 0)).toBe(13)
    expect(chiitoitsuShanten(h)).toBe(1)
    expect(shanten(h)).toBe(1)
  })

  it('kokushi tenpai (13-sided)', () => {
    const h = hand('19m19p19s1234567z')
    expect(kokushiShanten(h)).toBe(0)
    expect(shanten(h)).toBe(0)
  })

  it('worst case: no connections at all = 6 (via chiitoitsu)', () => {
    const h = hand('147m258p369s1234z')
    expect(shanten(h)).toBe(6)
  })
})

describe('discardOptions', () => {
  it('finds the shanpon wait and its ukeire', () => {
    const best = bestDiscards(discardOptions(hand('234567m234p55669s')))
    expect(best.map((o) => tileName(o.discard))).toEqual(['9s'])
    expect(best[0].shanten).toBe(0)
    expect(best[0].ukeire.map((u) => tileName(u.tile))).toEqual(['5s', '6s'])
    expect(best[0].ukeireTotal).toBe(4) // two unseen 5s + two unseen 6s
  })

  it('kokushi: discarding the stray tile gives a 13-sided wait', () => {
    const best = bestDiscards(discardOptions(hand('5m19m19p19s1234567z')))
    expect(best.map((o) => tileName(o.discard))).toEqual(['5m'])
    expect(best[0].ukeire).toHaveLength(13)
    expect(best[0].ukeireTotal).toBe(39)
  })

  it('rejects hands that are not 14 tiles', () => {
    expect(() => discardOptions(hand('123m'))).toThrow()
  })
})
