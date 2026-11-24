import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  useToast,
} from '@/components/ui'
import { callAction } from '@/lib/call-action'
import type { RecordData } from 'deepspace'
import type { Room } from '@/schemas/game-schema'

export default function PlayPage() {
  const navigate = useNavigate()
  const { error, success } = useToast()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
  const { userId } = useAuth()
  // Room reads are already limited to members; the filter also hides other rooms from the app owner (admin).
  const { records: rooms } = useQuery<Room>('rooms')
  const myRooms = rooms
    .filter((r) => userId && r.data.playerIds.includes(userId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const [removing, setRemoving] = useState<RecordData<Room> | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const removingIsHost = removing?.data.hostId === userId

  async function confirmRemove() {
    if (!removing) return
    setRemoveBusy(true)
    try {
      await callAction(removingIsHost ? 'deleteRoom' : 'leaveRoom', { code: removing.data.code })
      success(removingIsHost ? `Deleted room ${removing.data.code}` : `Left room ${removing.data.code}`)
      setRemoving(null)
    } catch (e) {
      error(removingIsHost ? 'Could not delete room' : 'Could not leave room', (e as Error).message)
    } finally {
      setRemoveBusy(false)
    }
  }

  async function run(kind: 'create' | 'join', fn: () => Promise<{ code: string }>) {
    setBusy(kind)
    try {
      const { code } = await fn()
      navigate(`/room/${code}`)
    } catch (e) {
      error(kind === 'create' ? 'Could not create room' : 'Could not join', (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const join = (e: FormEvent) => {
    e.preventDefault()
    void run('join', () => callAction('joinRoom', { code }))
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-8 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Discard Duel</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Everyone gets the same 14 tiles. Pick the best discard before the 30-second timer runs out.
        </p>
      </div>
      <Button
        data-testid="create-room"
        loading={busy === 'create'}
        disabled={busy !== null}
        onClick={() => void run('create', () => callAction('createRoom'))}
      >
        Create a room
      </Button>
      <form onSubmit={join} className="flex flex-col gap-2">
        <Label htmlFor="code">Join with a code</Label>
        <div className="flex gap-2">
          <Input
            id="code"
            data-testid="join-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={5}
            placeholder="ABCDE"
            autoComplete="off"
            className="font-mono tracking-widest uppercase"
          />
          <Button type="submit" variant="secondary" loading={busy === 'join'} disabled={busy !== null || code.length !== 5}>
            Join
          </Button>
        </div>
      </form>
      {myRooms.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="my-rooms">
          <h2 className="text-sm font-medium">Your rooms</h2>
          <ul className="flex flex-col gap-2">
            {myRooms.map((r) => (
              <li key={r.recordId} className="flex items-center gap-2">
                <Link
                  to={`/room/${r.data.code}`}
                  className="flex flex-1 items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted"
                >
                  <span className="font-mono tracking-widest">{r.data.code}</span>
                  <span className="text-muted-foreground">
                    {r.data.playerIds.length} player{r.data.playerIds.length === 1 ? '' : 's'}
                    {r.data.hostId === userId && ' · host'}
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`remove-room-${r.data.code}`}
                  onClick={() => setRemoving(r)}
                >
                  {r.data.hostId === userId ? 'Delete' : 'Leave'}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Dialog open={removing !== null} onOpenChange={(open) => !open && !removeBusy && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {removingIsHost ? 'Delete' : 'Leave'} room {removing?.data.code}?
            </DialogTitle>
            <DialogDescription>
              {removingIsHost
                ? 'This removes the room, its rounds and scores for every player. It cannot be undone.'
                : 'You will drop out of the room and its scoreboard. You can rejoin with the code while there is a free seat.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoving(null)} disabled={removeBusy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="confirm-remove-room"
              loading={removeBusy}
              onClick={() => void confirmRemove()}
            >
              {removingIsHost ? 'Delete room' : 'Leave room'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
