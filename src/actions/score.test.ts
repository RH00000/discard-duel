import { describe, expect, it } from 'vitest'
import { hand } from '../lib/shanten'
import { dealHand, scoreRound } from './index'

const tilesOf = (text: string) => hand(text).flatMap((n, t) => Array<number>(n).fill(t))
const NINE_S = 26
const SIX_S = 23
const TWO_M = 1

describe('scoreRound', () => {
  // Best discard is 9s (tenpai, ukeire 4); every other discard leaves 1-shanten.
  const h = tilesOf('234567m234p55669s')
  const base = { roundId: 'r', playerIds: ['a', 'b', 'c', 'd'] }

  it('3 for optimal, +1 to the fastest optimal, 0 for a worse shanten or no pick', () => {
    const res = scoreRound(
      h,
      base.playerIds,
      [
        { roundId: 'r', userId: 'a', tile: NINE_S },
        { roundId: 'r', userId: 'b', tile: NINE_S },
        { roundId: 'r', userId: 'c', tile: TWO_M },
      ],
      [
        { ...base, userId: 'a', lockedAt: 200 },
        { ...base, userId: 'b', lockedAt: 100 },
        { ...base, userId: 'c', lockedAt: 50 },
      ],
    )
    const by = Object.fromEntries(res.players.map((p) => [p.userId, p]))
    expect(res.best.map((b) => b.discard)).toEqual([NINE_S])
    expect(by.a.points).toBe(3)
    expect(by.b).toMatchObject({ points: 4, fastest: true })
    expect(by.c.points).toBe(0) // breaks a complete set: worse shanten, even though fastest overall
    expect(by.d).toMatchObject({ points: 0, tile: null })
  })

  it('1 when shanten matches the best but ukeire is lower', () => {
    // Complete hand: every discard is tenpai. Best is 2m/7m (ukeire 10); 6s gives only 7.
    const done = tilesOf('234567m234p55678s')
    const res = scoreRound(done, ['a'], [{ roundId: 'r', userId: 'a', tile: SIX_S }], [{ ...base, userId: 'a', lockedAt: 1 }])
    expect(res.best.map((b) => [b.discard, b.ukeireTotal])).toEqual([[TWO_M, 10], [6, 10]])
    expect(res.players[0]).toMatchObject({ shanten: 0, ukeireTotal: 7, points: 1, fastest: false })
  })
})

describe('dealHand', () => {
  it('deals 14 legal tiles with at most 4 copies each', () => {
    for (let i = 0; i < 50; i++) {
      const tiles = dealHand()
      expect(tiles).toHaveLength(14)
      const counts = hand('').map((_, t) => tiles.filter((x) => x === t).length)
      expect(Math.max(...counts)).toBeLessThanOrEqual(4)
      expect(tiles.every((t) => t >= 0 && t < 34)).toBe(true)
    }
  })
})
