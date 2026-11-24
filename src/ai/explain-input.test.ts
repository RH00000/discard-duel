import { describe, expect, it } from 'vitest'
import { discardOptions, hand } from '../lib/shanten'
import { tileLabel } from '../lib/tile-label'
import { buildExplainInput, EXPLAIN_SYSTEM_PROMPT } from './explain-input'

const tiles = hand('234567m234p55669s').flatMap((n, t) => Array<number>(n).fill(t))

describe('buildExplainInput', () => {
  const input = buildExplainInput({
    hand: tiles,
    results: { best: [], players: [{ userId: 'secret-user-id', tile: 26, shanten: 0, ukeireTotal: 4, lockedAt: 1, points: 4, fastest: true }] },
  })

  it('carries every distinct discard with the engine-computed shanten and ukeire', () => {
    const engine = discardOptions(hand('234567m234p55669s'))
    expect(input.discards).toHaveLength(engine.length)
    for (const o of engine) {
      const d = input.discards.find((x) => x.discard === tileLabel(o.discard))!
      expect(d.shantenAfter).toBe(o.shanten)
      expect(d.ukeireTotal).toBe(o.ukeireTotal)
      expect(d.ukeire).toEqual(o.ukeire.map((u) => ({ tile: tileLabel(u.tile), unseen: u.unseen })))
    }
    expect(input.discards[0]).toMatchObject({ discard: '9 sou', shantenAfter: 0, ukeireTotal: 4, optimal: true })
    expect(input.discards.filter((d) => d.optimal).map((d) => d.discard)).toEqual(['9 sou'])
    expect(input.hand).toHaveLength(14)
  })

  it('sends picks without user ids', () => {
    expect(input.playerPicks).toEqual([{ pick: '9 sou', points: 4 }])
    expect(JSON.stringify(input)).not.toContain('secret-user-id')
  })

  it('system prompt restricts the model to the given numbers', () => {
    expect(EXPLAIN_SYSTEM_PROMPT).toMatch(/ONLY from the numbers/)
    expect(EXPLAIN_SYSTEM_PROMPT).toMatch(/never compute, estimate or correct them/)
    expect(EXPLAIN_SYSTEM_PROMPT).toMatch(/Do not state mahjong rules/)
  })
})
