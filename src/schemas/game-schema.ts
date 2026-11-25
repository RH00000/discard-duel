/**
 * Game collections. Every write goes through a server action (src/actions),
 * so no role may create/update/delete from the client.
 *
 * Privacy: `picks` is read: 'own' for EVERY role, admin included (the app
 * owner is pinned to admin, so `read: true` there would stream every pick to
 * the owner's browser). The RecordRoom DO filters rows before they reach a
 * socket, so other players never receive a pick. Picks become visible only
 * when revealRound copies them into `rounds.results`.
 */
import type { CollectionSchema, RolePermissions } from 'deepspace/schema'

const NO_WRITES = { create: false, update: false, delete: false } as const
const roomShared: RolePermissions = { read: 'shared', ...NO_WRITES }
const ownOnly: RolePermissions = { read: 'own', ...NO_WRITES }
const none: RolePermissions = { read: false, ...NO_WRITES }

const json = { kind: 'json' } as const

export const roomsSchema: CollectionSchema = {
  name: 'rooms',
  columns: [
    { name: 'code', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'hostId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'playerIds', storage: 'text', interpretation: json, required: true },
    // Added later, so older rooms have neither: read through src/lib/game.ts defaults.
    { name: 'gameLength', storage: 'number', interpretation: 'plain' },
    { name: 'game', storage: 'number', interpretation: 'plain' },
  ],
  uniqueOn: ['code'],
  collaboratorsField: 'playerIds',
  permissions: { '*': none, viewer: none, member: roomShared, admin: roomShared },
}

export const roundsSchema: CollectionSchema = {
  name: 'rounds',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'number', storage: 'number', interpretation: 'plain', required: true },
    { name: 'hand', storage: 'text', interpretation: json, required: true },
    { name: 'startedAt', storage: 'number', interpretation: 'plain', required: true },
    { name: 'deadline', storage: 'number', interpretation: 'plain', required: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['picking', 'revealed'] }, required: true },
    { name: 'playerIds', storage: 'text', interpretation: json, required: true },
    { name: 'results', storage: 'text', interpretation: json },
    // `number` stays the room-wide counter; these place the round in a game (empty on older rounds).
    { name: 'game', storage: 'number', interpretation: 'plain' },
    { name: 'gameRound', storage: 'number', interpretation: 'plain' },
    { name: 'gameLength', storage: 'number', interpretation: 'plain' },
  ],
  uniqueOn: ['roomId', 'number'],
  collaboratorsField: 'playerIds',
  permissions: { '*': none, viewer: none, member: roomShared, admin: roomShared },
}

/** WHO locked in and WHEN — never what. Readable by everyone in the round. */
export const locksSchema: CollectionSchema = {
  name: 'locks',
  columns: [
    { name: 'roundId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'lockedAt', storage: 'number', interpretation: 'plain', required: true },
    { name: 'playerIds', storage: 'text', interpretation: json, required: true },
  ],
  uniqueOn: ['roundId', 'userId'],
  collaboratorsField: 'playerIds',
  permissions: { '*': none, viewer: none, member: roomShared, admin: roomShared },
}

/** WHAT each player discarded. Owner-only until reveal copies it into rounds.results. */
export const picksSchema: CollectionSchema = {
  name: 'picks',
  columns: [
    { name: 'roundId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true, userBound: true },
    { name: 'tile', storage: 'number', interpretation: 'plain', required: true },
  ],
  uniqueOn: ['roundId', 'userId'],
  ownerField: 'userId',
  permissions: { '*': none, viewer: none, member: ownOnly, admin: ownOnly },
}

/**
 * One row per room member; uniqueOn makes each join an atomic insert. Server-only:
 * clients read membership from rooms.playerIds, which joinRoom rebuilds from these rows.
 */
export const membersSchema: CollectionSchema = {
  name: 'members',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
  ],
  uniqueOn: ['roomId', 'userId'],
  permissions: { '*': none, viewer: none, member: none, admin: none },
}

/**
 * The reveal claim: uniqueOn roundId means only the first reveal's results are ever stored;
 * later reveals copy these instead of recomputing. Server-only.
 */
export const revealsSchema: CollectionSchema = {
  name: 'reveals',
  columns: [
    { name: 'roundId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'results', storage: 'text', interpretation: json, required: true, immutable: true },
  ],
  uniqueOn: ['roundId'],
  permissions: { '*': none, viewer: none, member: none, admin: none },
}

/** One saved AI explanation per revealed round, shared with that round's players. Written only by /api/explain. */
export const explanationsSchema: CollectionSchema = {
  name: 'explanations',
  columns: [
    { name: 'roundId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'text', storage: 'text', interpretation: 'plain', required: true },
    { name: 'playerIds', storage: 'text', interpretation: json, required: true },
  ],
  uniqueOn: ['roundId'],
  collaboratorsField: 'playerIds',
  permissions: { '*': none, viewer: none, member: roomShared, admin: roomShared },
}

export const gameSchemas = [
  roomsSchema, roundsSchema, locksSchema, picksSchema, membersSchema, revealsSchema, explanationsSchema,
]

export interface Room {
  code: string
  hostId: string
  playerIds: string[]
  /** Rounds per game the lobby shows; missing on older rooms (default 7). */
  gameLength?: number | null
  /** The room's current game; missing on older rooms (game 1). */
  game?: number | null
}
export interface PlayerResult {
  userId: string
  tile: number | null
  shanten: number | null
  ukeireTotal: number | null
  lockedAt: number | null
  points: number
  fastest: boolean
}
export interface RoundResults {
  best: { discard: number; shanten: number; ukeireTotal: number }[]
  players: PlayerResult[]
}
export interface Round {
  roomId: string
  number: number
  hand: number[]
  startedAt: number
  deadline: number
  status: 'picking' | 'revealed'
  playerIds: string[]
  results?: RoundResults
  /** Which game of the room this round belongs to (missing = 1). */
  game?: number | null
  /** N in "Round N of M" (missing = number). */
  gameRound?: number | null
  /** M, fixed when the round started (missing = 7). */
  gameLength?: number | null
}
export interface Lock { roundId: string; userId: string; lockedAt: number; playerIds: string[] }
export interface Pick { roundId: string; userId: string; tile: number }
export interface Explanation { roundId: string; text: string; playerIds: string[] }
