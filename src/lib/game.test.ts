import { describe, expect, it } from 'vitest'
import { isGameOver, lengthOfGame, roundsInGame, standings, totals } from './game'

const round = (number: number, players: [string, number | null, number][], extra: Record<string, unknown> = {}) => ({
  number,
  status: 'revealed' as const,
  results: { best: [{ discard: 5 }], players: players.map(([userId, tile, points]) => ({ userId, tile, points })) },
  ...extra,
})

describe('game helpers', () => {
  it('ranks by points, shares rank on ties (1, 1, 3) and makes every rank-1 player a winner', () => {
    const rs = [
      round(1, [['a', 5, 4], ['b', 5, 3], ['c', 2, 0]]),
      round(2, [['a', 2, 0], ['b', 5, 4], ['c', 2, 0]]),
      round(3, [['a', 5, 3], ['b', 9, 0], ['c', 5, 4]]),
    ]
    expect(standings(rs)).toEqual([
      { userId: 'a', points: 7, optimalPicks: 2, rank: 1, winner: true },
      { userId: 'b', points: 7, optimalPicks: 2, rank: 1, winner: true },
      { userId: 'c', points: 4, optimalPicks: 1, rank: 3, winner: false },
    ])
  })

  it('counts a missed pick as neither points nor an optimal pick', () => {
    expect(standings([round(1, [['a', null, 0], ['b', 5, 4]])])).toEqual([
      { userId: 'b', points: 4, optimalPicks: 1, rank: 1, winner: true },
      { userId: 'a', points: 0, optimalPicks: 0, rank: 2, winner: false },
    ])
  })

  it('reads rounds without game fields as game 1 and keeps games apart', () => {
    const rs = [
      round(3, [['a', 5, 4]], { game: 2, gameRound: 1, gameLength: 5 }),
      round(1, [['a', 5, 3]]),
      round(2, [['a', 5, 3]]),
    ]
    expect(roundsInGame(rs, 1).map((r) => r.number)).toEqual([1, 2])
    expect(totals(roundsInGame(rs, 2)).get('a')).toBe(4)
    expect(lengthOfGame(roundsInGame(rs, 1), {})).toBe(7) // legacy default
    expect(lengthOfGame([], { gameLength: 10 })).toBe(10) // not started: the room's choice
    expect(lengthOfGame(roundsInGame(rs, 2), { gameLength: 10 })).toBe(5) // started: fixed by its rounds
  })

  it('is over only when M rounds exist and the last is revealed', () => {
    const five = [1, 2, 3, 4, 5].map((n) => round(n, [['a', 5, 3]], { gameLength: 5 }))
    expect(isGameOver(five.slice(0, 4), {})).toBe(false)
    expect(isGameOver(five, {})).toBe(true)
    expect(isGameOver([...five.slice(0, 4), { ...five[4], status: 'picking' as const }], {})).toBe(false)
    expect(isGameOver([], {})).toBe(false)
  })
})
