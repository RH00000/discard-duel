import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth, usePresenceRoom, useQuery, useUserLookup, type RecordData } from 'deepspace'
import { Badge, Button, cn, useToast } from '@/components/ui'
import { RemoveRoomButton } from '@/components/game/RemoveRoomButton'
import { Tile } from '@/components/game/Tile'
import { WhyPanel } from '@/components/game/WhyPanel'
import { callAction } from '@/lib/call-action'
import { GAME_LENGTHS, gameLengthOf, gameOf, gameRoundOf, isGameOver, lengthOfGame, roomGame, standings, totals as gameTotals } from '@/lib/game'
import { tileName } from '@/lib/shanten'
import { tileLabel } from '@/lib/tile-label'
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
  const { error, success } = useToast()
  const navigate = useNavigate()
  const name = (id: string) => (id === userId ? 'You' : getName(id) ?? 'Player')
  // Keyed by the random record id, not the short code: presence sockets accept any scope string.
  const { peers } = usePresenceRoom(`room:${room.recordId}`)
  const online = new Set([userId, ...peers.map((p) => p.userId)])

  const { records: rounds } = useQuery<Round>('rounds', { where: { roomId: room.recordId } })
  // Only the current game counts: earlier games' rounds stay stored but don't add to these totals.
  const game = roomGame(room.data)
  const gameRounds = useMemo(
    () => rounds.filter((r) => gameOf(r.data) === game).sort((a, b) => a.data.number - b.data.number),
    [rounds, game],
  )
  const gameData = useMemo(() => gameRounds.map((r) => r.data), [gameRounds])
  const current = gameRounds[gameRounds.length - 1]
  const over = isGameOver(gameData, room.data)
  const isHost = room.data.hostId === userId
  const totals = useMemo(() => gameTotals(gameData), [gameData])

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

  async function copyInvite() {
    const link = `${window.location.origin}/room/${room.data.code}`
    try {
      await navigator.clipboard.writeText(link)
      success('Invite link copied', link)
    } catch {
      error('Could not copy', `Share this link: ${link}`)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Room code</p>
          <div className="flex items-center gap-3">
            <p className="font-mono text-3xl font-semibold tracking-widest" data-testid="room-code">{room.data.code}</p>
            <Button variant="secondary" size="sm" data-testid="copy-invite" onClick={() => void copyInvite()}>
              Copy invite link
            </Button>
            <RemoveRoomButton room={room} userId={userId} onDone={() => navigate('/play')} />
          </div>
        </div>
        {isHost && !over && current?.data.status !== 'picking' && (
          <Button data-testid="start-round" onClick={start} loading={starting} disabled={room.data.playerIds.length < 2}>
            {current ? 'Next round' : 'Start game'}
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

      {!current && <GameLengthPicker room={room} isHost={isHost} />}
      {over && <GameOverView room={room} gameData={gameData} isHost={isHost} name={name} />}
      {current &&
        (current.data.status === 'picking' ? (
          <PickingView key={current.recordId} round={current} userId={userId!} name={name} />
        ) : (
          <RevealView round={current} name={name} roomPlayerIds={room.data.playerIds} />
        ))}
      {current && <PickOwnersMarker roundId={current.recordId} />}
    </div>
  )
}

function RoundOf({ round }: { round: Round }) {
  return <span data-testid="round-of">Round {gameRoundOf(round)} of {gameLengthOf(round)}</span>
}

/** Before round 1: the host picks 5/7/10; everyone sees the choice live through the room record. */
function GameLengthPicker({ room, isHost }: { room: RecordData<Room>; isHost: boolean }) {
  const { error } = useToast()
  const length = lengthOfGame([], room.data)
  const [busy, setBusy] = useState<number | null>(null)
  async function choose(n: number) {
    setBusy(n)
    try {
      await callAction('setGameLength', { code: room.data.code, length: n })
    } catch (e) {
      error('Could not set game length', (e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <section aria-label="Game length" className="flex flex-wrap items-center gap-3">
      <p className="text-sm">
        Game length: <span className="font-semibold" data-testid="game-length">{length} rounds</span>
      </p>
      {isHost ? (
        <div className="flex gap-1" role="group" aria-label="Choose game length">
          {GAME_LENGTHS.map((n) => (
            <Button
              key={n}
              size="sm"
              variant={n === length ? 'default' : 'outline'}
              aria-pressed={n === length}
              data-testid={`game-length-${n}`}
              loading={busy === n}
              disabled={busy !== null}
              onClick={() => n !== length && void choose(n)}
            >
              {n}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">The host picks the length before the game starts.</p>
      )}
    </section>
  )
}

/** Final standings after the last round's reveal. Ties share a rank; every rank-1 player is a winner. */
function GameOverView({
  room,
  gameData,
  isHost,
  name,
}: {
  room: RecordData<Room>
  gameData: Round[]
  isHost: boolean
  name: (id: string) => string
}) {
  const { error } = useToast()
  const [busy, setBusy] = useState(false)
  const rows = standings(gameData)
  const winners = rows.filter((r) => r.winner)
  async function newGame() {
    setBusy(true)
    try {
      await callAction('newGame', { code: room.data.code })
    } catch (e) {
      error('Could not start a new game', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="flex flex-col gap-4 rounded-xl border-2 border-amber-400/70 p-4 sm:p-6" data-testid="game-over" aria-label="Game over">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Game over · {gameData.length} rounds</p>
        <h2 className="text-2xl font-semibold" data-testid="winner-title">
          {winners.length > 1 ? 'Co-winners: ' : 'Winner: '}
          {winners.map((w) => name(w.userId)).join(' & ')}
        </h2>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-muted-foreground">
          <tr><th className="py-1">#</th><th>Player</th><th className="text-right">Optimal picks</th><th className="text-right">Points</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} className={cn('border-t', r.winner && 'bg-amber-400/10')} data-testid={`standing-${r.userId}`}>
              <td className="py-2 pl-1 font-mono">{r.rank}</td>
              <td>
                {name(r.userId)}
                {!room.data.playerIds.includes(r.userId) && <span className="text-muted-foreground"> (left)</span>}
                {r.winner && (
                  <Badge className="ml-2 bg-amber-400 text-stone-900 hover:bg-amber-400" data-testid={`winner-${r.userId}`}>
                    Winner
                  </Badge>
                )}
              </td>
              <td className="text-right font-mono" data-testid={`optimal-${r.userId}`}>{r.optimalPicks}</td>
              <td className="pr-1 text-right font-mono font-semibold">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isHost ? (
        <Button className="self-start" data-testid="new-game" loading={busy} onClick={() => void newGame()}>
          New game
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="waiting-for-host">Waiting for host to start a new game</p>
      )}
    </section>
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
        <h2 className="text-lg font-semibold"><RoundOf round={round.data} />: pick a discard</h2>
        <span className={cn('font-mono text-2xl tabular-nums', remaining <= 5 && 'text-destructive')} data-testid="timer">
          {remaining}s
        </span>
      </div>
      <div className="rounded-xl bg-emerald-900 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.08),transparent_70%)] p-2 pt-3 shadow-inner sm:p-4">
        <div className="mx-auto grid max-w-xs grid-cols-7 gap-1 md:flex md:max-w-none" data-testid="hand">
        {round.data.hand.map((t, i) => (
          <Tile
            key={i}
            tile={t}
            selected={locked ? myPick.data.tile === t : selected === t}
            onClick={inRound && !locked ? () => setSelected(t) : undefined}
          />
        ))}
        </div>
      </div>
      <div className="flex items-center gap-4">
        {locked ? (
          <p data-testid="my-pick">
            Locked in: <span className="font-semibold">{tileLabel(myPick.data.tile)}</span>
          </p>
        ) : inRound ? (
          <Button data-testid="lock-in" onClick={lock} loading={locking} disabled={selected === null || remaining === 0}>
            {selected === null ? 'Select a tile' : `Lock in ${tileLabel(selected)}`}
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

function RevealView({
  round,
  name,
  roomPlayerIds,
}: {
  round: RecordData<Round>
  name: (id: string) => string
  roomPlayerIds: string[]
}) {
  const results = round.data.results
  if (!results) return null
  const bestTiles = new Set(results.best.map((b) => b.discard))
  const b = results.best[0]
  return (
    <section className="flex flex-col gap-6" aria-label={`Round ${round.data.number} results`} data-testid="reveal">
      <h2 className="text-lg font-semibold"><RoundOf round={round.data} />: results</h2>
      <div className="rounded-xl bg-emerald-900 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.08),transparent_70%)] p-2 pt-3 shadow-inner sm:p-4">
        <div className="mx-auto grid max-w-xs grid-cols-7 gap-1 md:flex md:max-w-none">
          {round.data.hand.map((t, i) => <Tile key={i} tile={t} best={bestTiles.has(t)} />)}
        </div>
      </div>
      <p className="text-sm" data-testid="best">
        Best discard{results.best.length > 1 ? 's' : ''}:{' '}
        <span className="font-semibold">{results.best.map((o) => tileLabel(o.discard)).join(', ')}</span>,
        reaching {b.shanten === 0 ? 'tenpai' : `${b.shanten}-shanten`} with {b.ukeireTotal} tiles that improve it.
      </p>
      <table className="w-full text-left text-sm">
        <thead className="text-muted-foreground">
          <tr><th className="py-1">Player</th><th>Pick</th><th>Shanten</th><th>Ukeire</th><th className="text-right">Points</th></tr>
        </thead>
        <tbody>
          {results.players.map((p) => (
            <tr key={p.userId} className="border-t" data-testid={`result-${p.userId}`} data-tile={p.tile === null ? '' : tileName(p.tile)}>
              <td className="py-2">
                {name(p.userId)}
                {!roomPlayerIds.includes(p.userId) && <span className="text-muted-foreground"> (left)</span>}
              </td>
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
