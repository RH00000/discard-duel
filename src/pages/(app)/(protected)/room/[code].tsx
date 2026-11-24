import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, usePresenceRoom, useQuery, useUserLookup, type RecordData } from 'deepspace'
import { Badge, Button, cn, useToast } from '@/components/ui'
import { Tile } from '@/components/game/Tile'
import { WhyPanel } from '@/components/game/WhyPanel'
import { callAction } from '@/lib/call-action'
import { tileName } from '@/lib/shanten'
import type { Lock, Pick, Room, Round } from '@/schemas/game-schema'

export default function RoomPage() {
  const code = (useParams().code ?? '').toUpperCase()
  const { records, status } = useQuery<Room>('rooms', { where: { code } })
  const room = records[0]

  if (status !== 'ready') return <Centered>Loading room…</Centered>
  // Non-members can't read the room record at all (read: 'shared'), so offer to join.
  if (!room) return <JoinPrompt code={code} />
  return <RoomView room={room} />
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">{children}</div>
}

function JoinPrompt({ code }: { code: string }) {
  const { error } = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <Centered>
      <p className="text-muted-foreground">
        You're not in room <span className="font-mono font-semibold text-foreground">{code}</span> yet.
      </p>
      <Button
        data-testid="join-room"
        loading={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await callAction('joinRoom', { code })
          } catch (e) {
            error('Could not join', (e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        Join room
      </Button>
      <Link to="/play" className="text-sm text-muted-foreground underline">Back</Link>
    </Centered>
  )
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [active])
  return now
}

function RoomView({ room }: { room: RecordData<Room> }) {
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const { error } = useToast()
  const name = (id: string) => (id === userId ? 'You' : getName(id) ?? 'Player')
  // Keyed by the random record id, not the short code: presence sockets accept any scope string.
  const { peers } = usePresenceRoom(`room:${room.recordId}`)
  const online = new Set([userId, ...peers.map((p) => p.userId)])

  const { records: rounds } = useQuery<Round>('rounds', { where: { roomId: room.recordId } })
  const current = useMemo(
    () => rounds.reduce<RecordData<Round> | undefined>((a, r) => (!a || r.data.number > a.data.number ? r : a), undefined),
    [rounds],
  )
  const isHost = room.data.hostId === userId
  const totals = useMemo(() => {
    const t = new Map<string, number>()
    for (const r of rounds) for (const p of r.data.results?.players ?? []) t.set(p.userId, (t.get(p.userId) ?? 0) + p.points)
    return t
  }, [rounds])

  const [starting, setStarting] = useState(false)
  async function start() {
    setStarting(true)
    try {
      await callAction('startRound', { code: room.data.code })
    } catch (e) {
      error('Could not start', (e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Room code</p>
          <p className="font-mono text-3xl font-semibold tracking-widest" data-testid="room-code">{room.data.code}</p>
        </div>
        {isHost && current?.data.status !== 'picking' && (
          <Button data-testid="start-round" onClick={start} loading={starting} disabled={room.data.playerIds.length < 2}>
            {current ? 'Next round' : 'Start round'}
          </Button>
        )}
      </header>

      <section aria-label="Players">
        <ul className="flex flex-wrap gap-2" data-testid="players">
          {room.data.playerIds.map((id) => (
            <li key={id} className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
              <span
                className={cn('size-2 rounded-full', online.has(id) ? 'bg-emerald-500' : 'bg-stone-300')}
                aria-label={online.has(id) ? 'online' : 'away'}
              />
              {name(id)}
              {id === room.data.hostId && <Badge variant="secondary">host</Badge>}
              <span className="font-mono text-muted-foreground" data-testid={`score-${id}`}>{totals.get(id) ?? 0}</span>
            </li>
          ))}
        </ul>
        {room.data.playerIds.length < 2 && (
          <p className="mt-3 text-sm text-muted-foreground">Share the code. You need at least 2 players.</p>
        )}
      </section>

      {current &&
        (current.data.status === 'picking' ? (
          <PickingView key={current.recordId} round={current} userId={userId!} name={name} />
        ) : (
          <RevealView round={current} name={name} />
        ))}
      {current && <PickOwnersMarker roundId={current.recordId} />}
    </div>
  )
}

/**
 * Exposes exactly which users' pick rows reached this browser for the round.
 * Lives above Picking/Reveal so it survives reveal; e2e asserts it only ever holds our own id.
 */
function PickOwnersMarker({ roundId }: { roundId: string }) {
  const { records } = useQuery<Pick>('picks', { where: { roundId } })
  return <span hidden data-testid="visible-pick-owners" data-owners={records.map((p) => p.data.userId).sort().join(',')} />
}

function PickingView({ round, userId, name }: { round: RecordData<Round>; userId: string; name: (id: string) => string }) {
  const { error } = useToast()
  const now = useNow(true)
  const remaining = Math.max(0, Math.ceil((round.data.deadline - now) / 1000))
  const { records: locks } = useQuery<Lock>('locks', { where: { roundId: round.recordId } })
  // The DO only ever sends this socket the caller's own pick rows (read: 'own').
  const { records: picks } = useQuery<Pick>('picks', { where: { roundId: round.recordId } })
  const myPick = picks.find((p) => p.data.userId === userId)
  const inRound = round.data.playerIds.includes(userId)
  const [selected, setSelected] = useState<number | null>(null)
  const [locking, setLocking] = useState(false)

  // At the deadline any client may ask; the server decides. Retry covers clock skew.
  const asked = useRef(0)
  useEffect(() => {
    if (round.data.deadline > now || now - asked.current < 1500) return
    asked.current = now
    callAction('revealRound', { roundId: round.recordId }).catch(() => {})
  }, [now, round.data.deadline, round.recordId])

  async function lock() {
    if (selected === null) return
    setLocking(true)
    try {
      await callAction('lockIn', { roundId: round.recordId, tile: selected })
    } catch (e) {
      error('Could not lock in', (e as Error).message)
    } finally {
      setLocking(false)
    }
  }

  const locked = !!myPick
  return (
    <section className="flex flex-col gap-6" aria-label={`Round ${round.data.number}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Round {round.data.number}: pick a discard</h2>
        <span className={cn('font-mono text-2xl tabular-nums', remaining <= 5 && 'text-destructive')} data-testid="timer">
          {remaining}s
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" data-testid="hand">
        {round.data.hand.map((t, i) => (
          <Tile
            key={i}
            tile={t}
            selected={locked ? myPick.data.tile === t : selected === t}
            onClick={inRound && !locked ? () => setSelected(t) : undefined}
          />
        ))}
      </div>
      <div className="flex items-center gap-4">
        {locked ? (
          <p data-testid="my-pick">
            Locked in: <span className="font-semibold">{tileName(myPick.data.tile)}</span>
          </p>
        ) : inRound ? (
          <Button data-testid="lock-in" onClick={lock} loading={locking} disabled={selected === null || remaining === 0}>
            {selected === null ? 'Select a tile' : `Lock in ${tileName(selected)}`}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">You joined mid-round. You'll play from the next one.</p>
        )}
      </div>
      <ul className="flex flex-wrap gap-2" data-testid="lock-status">
        {round.data.playerIds.map((id) => {
          const isLocked = locks.some((l) => l.data.userId === id)
          return (
            <li key={id} data-testid={`lock-${id}`} data-locked={isLocked} className="rounded border px-2 py-1 text-sm">
              {name(id)}: {isLocked ? 'locked in' : 'thinking…'}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function RevealView({ round, name }: { round: RecordData<Round>; name: (id: string) => string }) {
  const results = round.data.results
  if (!results) return null
  const bestTiles = new Set(results.best.map((b) => b.discard))
  const b = results.best[0]
  return (
    <section className="flex flex-col gap-6" aria-label={`Round ${round.data.number} results`} data-testid="reveal">
      <h2 className="text-lg font-semibold">Round {round.data.number}: results</h2>
      <div className="flex flex-wrap gap-1.5">
        {round.data.hand.map((t, i) => <Tile key={i} tile={t} dim={!bestTiles.has(t)} />)}
      </div>
      <p className="text-sm" data-testid="best">
        Best discard{results.best.length > 1 ? 's' : ''}:{' '}
        <span className="font-semibold">{results.best.map((o) => tileName(o.discard)).join(', ')}</span>,
        reaching {b.shanten === 0 ? 'tenpai' : `${b.shanten}-shanten`} with {b.ukeireTotal} tiles that improve it.
      </p>
      <table className="w-full text-left text-sm">
        <thead className="text-muted-foreground">
          <tr><th className="py-1">Player</th><th>Pick</th><th>Shanten</th><th>Ukeire</th><th className="text-right">Points</th></tr>
        </thead>
        <tbody>
          {results.players.map((p) => (
            <tr key={p.userId} className="border-t" data-testid={`result-${p.userId}`} data-tile={p.tile === null ? '' : tileName(p.tile)}>
              <td className="py-2">{name(p.userId)}</td>
              <td>{p.tile === null ? <span className="text-muted-foreground">no pick</span> : <Tile tile={p.tile} size="sm" />}</td>
              <td>{p.shanten ?? '–'}</td>
              <td>{p.ukeireTotal ?? '–'}</td>
              <td className="text-right font-semibold">
                +{p.points}
                {p.fastest && <Badge className="ml-2">fastest</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <WhyPanel roundId={round.recordId} />
    </section>
  )
}
