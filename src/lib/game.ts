/**
 * Game-length rules shared by the server actions and the room page. Pure: no DeepSpace imports.
 * Rooms and rounds created before games existed have no game fields; these defaults read them.
 */
export const GAME_LENGTHS = [5, 7, 10] as const
export const DEFAULT_GAME_LENGTH = 7

interface GameRound {
  number: number
  status: 'picking' | 'revealed'
  game?: number | null
  gameRound?: number | null
  gameLength?: number | null
  results?: {
    best: { discard: number }[]
    players: { userId: string; tile: number | null; points: number }[]
  }
}

export const roomGame = (room: { game?: number | null }) => room.game ?? 1
export const roomGameLength = (room: { gameLength?: number | null }) => room.gameLength ?? DEFAULT_GAME_LENGTH
export const gameOf = (r: GameRound) => r.game ?? 1
export const gameRoundOf = (r: GameRound) => r.gameRound ?? r.number
export const gameLengthOf = (r: GameRound) => r.gameLength ?? DEFAULT_GAME_LENGTH

/** The rounds of one game, oldest first. */
export function roundsInGame<T extends GameRound>(rounds: T[], game: number): T[] {
  return rounds.filter((r) => gameOf(r) === game).sort((a, b) => a.number - b.number)
}

/** M for a game: fixed by its first round once started, otherwise the room's current choice. */
export function lengthOfGame(gameRounds: GameRound[], room: { gameLength?: number | null }): number {
  return gameRounds.length ? gameLengthOf(gameRounds[0]) : roomGameLength(room)
}

/** Over once M rounds exist and the last one is revealed. */
export function isGameOver(gameRounds: GameRound[], room: { gameLength?: number | null }): boolean {
  const last = gameRounds[gameRounds.length - 1]
  return !!last && gameRounds.length >= lengthOfGame(gameRounds, room) && last.status === 'revealed'
}

export function totals(gameRounds: GameRound[]): Map<string, number> {
  const t = new Map<string, number>()
  for (const r of gameRounds) for (const p of r.results?.players ?? []) t.set(p.userId, (t.get(p.userId) ?? 0) + p.points)
  return t
}

export interface Standing {
  userId: string
  points: number
  optimalPicks: number
  rank: number
  winner: boolean
}

/** Ranked by points; equal points share a rank (1, 1, 3) and rank 1 is a (co-)winner. No tiebreak. */
export function standings(gameRounds: GameRound[]): Standing[] {
  const rows = new Map<string, { points: number; optimalPicks: number }>()
  for (const r of gameRounds) {
    if (!r.results) continue
    const best = new Set(r.results.best.map((b) => b.discard))
    for (const p of r.results.players) {
      const row = rows.get(p.userId) ?? { points: 0, optimalPicks: 0 }
      row.points += p.points
      if (p.tile !== null && best.has(p.tile)) row.optimalPicks++
      rows.set(p.userId, row)
    }
  }
  const sorted = [...rows].map(([userId, row]) => ({ userId, ...row })).sort((a, b) => b.points - a.points)
  return sorted.map((row) => {
    const rank = 1 + sorted.filter((o) => o.points > row.points).length
    return { ...row, rank, winner: rank === 1 }
  })
}
