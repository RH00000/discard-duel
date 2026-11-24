import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Input, Label, useToast } from '@/components/ui'
import { callAction } from '@/lib/call-action'

export default function PlayPage() {
  const navigate = useNavigate()
  const { error } = useToast()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)

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
    </div>
  )
}
