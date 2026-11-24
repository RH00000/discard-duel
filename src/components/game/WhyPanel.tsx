import { useState } from 'react'
import { decodeAiStreamChunk, getAuthToken, parseSseLine, useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import type { Explanation } from '@/schemas/game-schema'

/** "Why?" for a revealed round: streams from /api/explain, then shows the saved copy both players share. */
export function WhyPanel({ roundId }: { roundId: string }) {
  const { records } = useQuery<Explanation>('explanations', { where: { roundId } })
  const saved = records[0]?.data.text
  const [streamed, setStreamed] = useState('')
  const [state, setState] = useState<'idle' | 'streaming' | 'error'>('idle')
  const [error, setError] = useState('')

  async function explain() {
    setState('streaming')
    setStreamed('')
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAuthToken()}` },
        body: JSON.stringify({ roundId }),
      })
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Request failed (${res.status})`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let got = 0
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const chunk = parseSseLine(line)
          const action = chunk && decodeAiStreamChunk(chunk)
          if (action?.type === 'append-text') {
            got += action.delta.length
            setStreamed((t) => t + action.delta)
          }
          if (action?.type === 'stream-error') throw new Error(action.errorText)
        }
      }
      if (!got) throw new Error('No explanation came back. Try again.')
      setState('idle')
    } catch (e) {
      setError((e as Error).message)
      setState('error')
    }
  }

  const text = saved ?? streamed
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4" data-testid="why-panel">
      {!saved && (
        <Button
          variant="outline"
          className="self-start"
          data-testid="why-button"
          onClick={explain}
          loading={state === 'streaming'}
          disabled={state === 'streaming'}
        >
          Why?
        </Button>
      )}
      {text && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="why-text" aria-live="polite">
          {text}
        </p>
      )}
      {state === 'error' && <p className="text-sm text-destructive">{error}</p>}
      {text && <p className="text-xs text-muted-foreground">Written by Claude from the computed shanten and ukeire numbers above.</p>}
    </div>
  )
}
