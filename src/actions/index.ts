/**
 * Game server actions. Actions run with RBAC OFF (see src/server/action-routes.ts),
 * so every handler checks membership/host/state itself against the verified `userId`.
 * No action returns pick data before a round is revealed.
 */
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { bestDiscards, discardOptions } from '../lib/shanten'
import type { Lock, Pick, PlayerResult, Room, Round, RoundResults } from '../schemas/game-schema'

export const MAX_PLAYERS = 4
export const ROUND_MS = 30_000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I

const fail = (error: string): ActionResult<never> => ({ success: false, error })

function randomInt(max: number): number {
  // Rejection sampling avoids modulo bias.
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf)
  while (buf[0] >= limit)
  return buf[0] % max
}

function makeCode(): string {
  return Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
}

/** 14 tiles from a shuffled 136-tile wall, sorted by index. */
export function dealHand(): number[] {
  const wall = Array.from({ length: 136 }, (_, i) => Math.floor(i / 4))
  for (let i = wall.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[wall[i], wall[j]] = [wall[j], wall[i]]
  }
  return wall.slice(0, 14).sort((a, b) => a - b)
}

export function toCounts(tiles: number[]): number[] {
  const c = new Array<number>(34).fill(0)
  for (const t of tiles) c[t]++
  return c
}

async function getData<T>(tools: ActionTools, coll: string, id: string): Promise<T | null> {
  const r = await tools.get(coll, id)
  return r.success ? (r.data.record.data as unknown as T) : null
}

async function queryData<T>(tools: ActionTools, coll: string, where: Record<string, unknown>) {
  const r = await tools.query(coll, { where, limit: 100 })
  if (!r.success) throw new Error(r.error)
  return r.data.records.map((rec) => ({ id: rec.recordId, data: rec.data as unknown as T }))
}

/** Score one round. Pure given its inputs; exported for unit tests. */
export function scoreRound(hand: number[], playerIds: string[], picks: Pick[], locks: Lock[]): RoundResults {
  const options = discardOptions(toCounts(hand))
  const best = bestDiscards(options)
  const bestS = best[0].shanten
  const bestU = best[0].ukeireTotal
  const players: PlayerResult[] = playerIds.map((userId) => {
    const pick = picks.find((p) => p.userId === userId)
    const lock = locks.find((l) => l.userId === userId)
    const opt = pick ? options.find((o) => o.discard === pick.tile) : undefined
    const points = !opt ? 0 : opt.shanten !== bestS ? 0 : opt.ukeireTotal === bestU ? 3 : 1
    return {
      userId,
      tile: opt ? opt.discard : null,
      shanten: opt ? opt.shanten : null,
      ukeireTotal: opt ? opt.ukeireTotal : null,
      lockedAt: lock?.lockedAt ?? null,
      points,
      fastest: false,
    }
  })
  const optimal = players.filter((p) => p.points === 3 && p.lockedAt !== null)
  if (optimal.length) {
    const first = Math.min(...optimal.map((p) => p.lockedAt!))
    // Ties on the exact same millisecond all get the bonus.
    for (const p of optimal) if (p.lockedAt === first) { p.fastest = true; p.points += 1 }
  }
  return {
    best: best.map((o) => ({ discard: o.discard, shanten: o.shanten, ukeireTotal: o.ukeireTotal })),
    players,
  }
}

/** Reveal if allowed (deadline passed or everyone locked). Idempotent. */
async function tryReveal(tools: ActionTools, roundId: string, now: number): Promise<ActionResult<{ revealed: boolean }>> {
  const round = await getData<Round>(tools, 'rounds', roundId)
  if (!round) return fail('Round not found')
  if (round.status === 'revealed') return { success: true, data: { revealed: true } }
  const locks = (await queryData<Lock>(tools, 'locks', { roundId })).map((l) => l.data)
  const allLocked = round.playerIds.every((id) => locks.some((l) => l.userId === id))
  if (!allLocked && now < round.deadline) return { success: true, data: { revealed: false } }
  const picks = (await queryData<Pick>(tools, 'picks', { roundId })).map((p) => p.data)
  const results = scoreRound(round.hand, round.playerIds, picks, locks)
  const w = await tools.update('rounds', roundId, { status: 'revealed', results })
  if (!w.success) return w
  return { success: true, data: { revealed: true } }
}

async function findRoomByCode(tools: ActionTools, code: string) {
  const rooms = await queryData<Room>(tools, 'rooms', { code })
  return rooms[0] ?? null
}

export const actions: Record<string, ActionHandler<Env>> = {
  createRoom: async ({ userId, tools }) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode()
      if (await findRoomByCode(tools, code)) continue
      const r = await tools.create('rooms', { code, hostId: userId, playerIds: [userId] })
      if (r.success) return { success: true, data: { code } }
    }
    return fail('Could not allocate a room code, try again')
  },

  joinRoom: async ({ userId, params, tools }) => {
    const code = String(params.code ?? '').trim().toUpperCase()
    if (!/^[A-Z0-9]{5}$/.test(code)) return fail('Room codes are 5 letters/numbers')
    for (let attempt = 0; attempt < 3; attempt++) {
      const room = await findRoomByCode(tools, code)
      if (!room) return fail('No room with that code')
      if (room.data.playerIds.includes(userId)) return { success: true, data: { code } }
      if (room.data.playerIds.length >= MAX_PLAYERS) return fail('Room full')
      const w = await tools.update('rooms', room.id, { playerIds: [...room.data.playerIds, userId] })
      if (!w.success) return w
      // shortcut: read-modify-write on playerIds, verified by re-reading. Concurrent joins can
      // drop one id (we retry) or overshoot 4 (we back out). Upgrade to one row per player if that bites.
      const after = await getData<Room>(tools, 'rooms', room.id)
      if (!after) return fail('Room vanished')
      if (!after.playerIds.includes(userId)) continue
      if (after.playerIds.length > MAX_PLAYERS) {
        await tools.update('rooms', room.id, { playerIds: after.playerIds.filter((id) => id !== userId) })
        return fail('Room full')
      }
      return { success: true, data: { code } }
    }
    return fail('Room is busy, try again')
  },

  startRound: async ({ userId, params, tools }) => {
    const code = String(params.code ?? '')
    const room = await findRoomByCode(tools, code)
    if (!room) return fail('Room not found')
    if (room.data.hostId !== userId) return fail('Only the host can start a round')
    if (room.data.playerIds.length < 2) return fail('Need at least 2 players')
    const now = Date.now()
    const rounds = await queryData<Round>(tools, 'rounds', { roomId: room.id })
    // Unstick rounds abandoned before their timer ran out.
    for (const r of rounds.filter((r) => r.data.status === 'picking')) {
      const res = await tryReveal(tools, r.id, now)
      if (!res.success) return res
      if (!res.data.revealed) return fail('A round is still in progress')
    }
    const number = rounds.reduce((n, r) => Math.max(n, r.data.number), 0) + 1
    const round: Round = {
      roomId: room.id,
      number,
      hand: dealHand(),
      startedAt: now,
      deadline: now + ROUND_MS,
      status: 'picking',
      playerIds: room.data.playerIds,
    }
    const w = await tools.create('rounds', round as unknown as Record<string, unknown>)
    if (!w.success) return w
    return { success: true, data: { roundId: w.data.recordId } }
  },

  lockIn: async ({ userId, params, tools }) => {
    const roundId = String(params.roundId ?? '')
    const tile = Number(params.tile)
    const round = await getData<Round>(tools, 'rounds', roundId)
    if (!round) return fail('Round not found')
    if (!round.playerIds.includes(userId)) return fail('You are not in this round')
    if (round.status !== 'picking') return fail('Round already revealed')
    const now = Date.now()
    if (now >= round.deadline) return fail('Time is up')
    if (!Number.isInteger(tile) || !round.hand.includes(tile)) return fail('That tile is not in the hand')
    const existing = await queryData<Lock>(tools, 'locks', { roundId, userId })
    if (existing.length) return fail('Already locked in')
    // Pick first: if the lock write then fails, a retry overwrites this pick.
    const prior = await queryData<Pick>(tools, 'picks', { roundId, userId })
    const p = prior.length
      ? await tools.update('picks', prior[0].id, { tile })
      : await tools.create('picks', { roundId, userId, tile })
    if (!p.success) return p
    const l = await tools.create('locks', { roundId, userId, lockedAt: now, playerIds: round.playerIds })
    if (!l.success) return l
    await tryReveal(tools, roundId, now)
    return { success: true, data: { locked: true } }
  },

  revealRound: async ({ userId, params, tools }) => {
    const roundId = String(params.roundId ?? '')
    const round = await getData<Round>(tools, 'rounds', roundId)
    if (!round || !round.playerIds.includes(userId)) return fail('Round not found')
    return tryReveal(tools, roundId, Date.now())
  },
}
