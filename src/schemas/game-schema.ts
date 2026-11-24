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

export const gameSchemas = [roomsSchema, roundsSchema, locksSchema, picksSchema]

export interface Room { code: string; hostId: string; playerIds: string[] }
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
}
export interface Lock { roundId: string; userId: string; lockedAt: number; playerIds: string[] }
export interface Pick { roundId: string; userId: string; tile: number }
