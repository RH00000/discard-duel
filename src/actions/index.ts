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
  return r.data.records.map((rec) => ({ id: rec.recordId, createdAt: rec.createdAt, data: rec.data as unknown as T }))
}

const isDuplicate = (error: string) => /duplicate/i.test(error)

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

async function revealClaim(tools: ActionTools, roundId: string) {
  return (await queryData<{ results: RoundResults }>(tools, 'reveals', { roundId }))[0] ?? null
}

/**
 * Reveal if allowed: deadline passed, or every player has BOTH a lock and a pick.
 * The first caller to insert the `reveals` row (uniqueOn roundId) fixes the results;
 * every other caller copies those, so concurrent reveals can't write different results.
 */
async function tryReveal(tools: ActionTools, roundId: string): Promise<ActionResult<{ revealed: boolean }>> {
  const round = await getData<Round>(tools, 'rounds', roundId)
  if (!round) return fail('Round not found')
  if (round.status === 'revealed') return { success: true, data: { revealed: true } }
  let results = (await revealClaim(tools, roundId))?.data.results
  if (!results) {
    const locks = (await queryData<Lock>(tools, 'locks', { roundId })).map((l) => l.data)
    const picks = (await queryData<Pick>(tools, 'picks', { roundId })).map((p) => p.data)
    const allIn = round.playerIds.every((id) => locks.some((l) => l.userId === id) && picks.some((p) => p.userId === id))
    if (!allIn && Date.now() < round.deadline) return { success: true, data: { revealed: false } }
    const computed = scoreRound(round.hand, round.playerIds, picks, locks)
    const claim = await tools.create('reveals', { roundId, results: computed })
    if (claim.success) results = computed
    else {
      const winner = await revealClaim(tools, roundId)
      if (!winner) return claim
      results = winner.data.results
    }
  }
  const w = await tools.update('rounds', roundId, { status: 'revealed', results })
  if (!w.success) return w
  return { success: true, data: { revealed: true } }
}

type Member = { roomId: string; userId: string }

/** Members in join order (createdAt, then recordId). The first MAX_PLAYERS are in the room. */
async function rankedMembers(tools: ActionTools, roomId: string) {
  const rows = await queryData<Member>(tools, 'members', { roomId })
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

/** Rooms created before member rows existed: seed rows from playerIds once (duplicates are refused). */
async function backfillMembers(tools: ActionTools, room: { id: string; data: Room }) {
  if ((await rankedMembers(tools, room.id)).length) return
  for (const id of room.data.playerIds) await tools.create('members', { roomId: room.id, userId: id })
}

/**
 * Rewrite rooms.playerIds from the member rows until they agree. Member rows only change by
 * insert or by a rank-5+ row backing out, so a stale write is always followed by its writer's
 * own re-check, which repairs it.
 */
async function syncPlayerIds(tools: ActionTools, roomId: string): Promise<string[]> {
  for (let i = 0; i < 5; i++) {
    const want = (await rankedMembers(tools, roomId)).slice(0, MAX_PLAYERS).map((m) => m.data.userId)
    const room = await getData<Room>(tools, 'rooms', roomId)
    if (!room) throw new Error('Room vanished')
    if (room.playerIds.join() === want.join()) return want
    await tools.update('rooms', roomId, { playerIds: want })
  }
  throw new Error('Room is busy, try again')
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
      if (!r.success) continue
      const m = await tools.create('members', { roomId: r.data.recordId, userId })
      if (!m.success) return m
      return { success: true, data: { code } }
    }
    return fail('Could not allocate a room code, try again')
  },

  joinRoom: async ({ userId, params, tools }) => {
    const code = String(params.code ?? '').trim().toUpperCase()
    if (!/^[A-Z0-9]{5}$/.test(code)) return fail('Room codes are 5 letters/numbers')
    const room = await findRoomByCode(tools, code)
    if (!room) return fail('No room with that code')
    await backfillMembers(tools, room)
    const before = await rankedMembers(tools, room.id)
    if (!before.some((m) => m.data.userId === userId)) {
      if (before.length >= MAX_PLAYERS) return fail('Room full')
      // The insert is the atomic step (uniqueOn roomId+userId); a duplicate means we're already in.
      const m = await tools.create('members', { roomId: room.id, userId })
      if (!m.success && !isDuplicate(m.error)) return m
      // Racing joins may all insert; join order decides who's in. Rank 5+ backs out.
      const ranked = await rankedMembers(tools, room.id)
      const rank = ranked.findIndex((r) => r.data.userId === userId)
      if (rank >= MAX_PLAYERS) {
        await tools.remove('members', ranked[rank].id)
        await syncPlayerIds(tools, room.id)
        return fail('Room full')
      }
    }
    await syncPlayerIds(tools, room.id)
    return { success: true, data: { code } }
  },

  startRound: async ({ userId, params, tools }) => {
    const code = String(params.code ?? '')
    const room = await findRoomByCode(tools, code)
    if (!room) return fail('Room not found')
    if (room.data.hostId !== userId) return fail('Only the host can start a round')
    await backfillMembers(tools, room)
    const playerIds = await syncPlayerIds(tools, room.id)
    if (playerIds.length < 2) return fail('Need at least 2 players')
    const now = Date.now()
    const rounds = await queryData<Round>(tools, 'rounds', { roomId: room.id })
    // Unstick rounds abandoned before their timer ran out.
    for (const r of rounds.filter((r) => r.data.status === 'picking')) {
      const res = await tryReveal(tools, r.id)
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
      playerIds,
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
    // The lock row is the gate (uniqueOn roundId+userId): a second concurrent lockIn fails
    // here before it can touch the pick.
    const l = await tools.create('locks', { roundId, userId, lockedAt: now, playerIds: round.playerIds })
    if (!l.success) return fail(isDuplicate(l.error) ? 'Already locked in' : l.error)
    const undo = async () => {
      await tools.deleteWhere('picks', { roundId, userId })
      await tools.remove('locks', l.data.recordId)
    }
    const p = await tools.create('picks', { roundId, userId, tile })
    if (!p.success) {
      await undo()
      return p
    }
    await tryReveal(tools, roundId)
    // A reveal that started before our rows existed won't count this pick. Undo so that a
    // successful lockIn always means the pick was scored.
    const claim = await revealClaim(tools, roundId)
    const mine = claim?.data.results.players.find((r) => r.userId === userId)
    if (claim && (!mine || mine.tile === null)) {
      await undo()
      return fail('Time is up')
    }
    return { success: true, data: { locked: true } }
  },

  revealRound: async ({ userId, params, tools }) => {
    const roundId = String(params.roundId ?? '')
    const round = await getData<Round>(tools, 'rounds', roundId)
    if (!round || !round.playerIds.includes(userId)) return fail('Round not found')
    return tryReveal(tools, roundId)
  },
}
