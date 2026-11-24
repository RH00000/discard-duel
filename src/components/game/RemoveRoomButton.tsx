import { useState } from 'react'
import type { RecordData } from 'deepspace'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from '@/components/ui'
import { callAction } from '@/lib/call-action'
import type { Room } from '@/schemas/game-schema'

/** "Delete" for the host (removes the room for everyone), "Leave" for anyone else; confirms first. */
export function RemoveRoomButton({
  room,
  userId,
  onDone,
}: {
  room: RecordData<Room>
  userId: string | null | undefined
  onDone?: () => void
}) {
  const { error, success } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const isHost = room.data.hostId === userId
  const { code } = room.data

  async function confirm() {
    setBusy(true)
    try {
      await callAction(isHost ? 'deleteRoom' : 'leaveRoom', { code })
      success(isHost ? `Deleted room ${code}` : `Left room ${code}`)
      setOpen(false)
      onDone?.()
    } catch (e) {
      error(isHost ? 'Could not delete room' : 'Could not leave room', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" data-testid={`remove-room-${code}`} onClick={() => setOpen(true)}>
        {isHost ? 'Delete room' : 'Leave room'}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isHost ? 'Delete' : 'Leave'} room {code}?
            </DialogTitle>
            <DialogDescription>
              {isHost
                ? 'This removes the room, its rounds and scores for every player. It cannot be undone.'
                : 'You will drop out of the room and its scoreboard. You can rejoin with the code while there is a free seat.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" data-testid="confirm-remove-room" loading={busy} onClick={() => void confirm()}>
              {isHost ? 'Delete room' : 'Leave room'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
