/**
 * "Why?" explanations for a revealed round, streamed from Claude through the
 * DeepSpace AI proxy (createDeepSpaceAI). No provider key exists in this app:
 * the proxy authenticates with the owner's platform JWT, server-side only.
 */
import type { Hono } from 'hono'
import { createUIMessageStreamResponse, streamText, toUIMessageStream } from 'ai'
import { createDeepSpaceAI, loggableError } from 'deepspace/worker'
import type { Explanation, Round } from '../schemas/game-schema'
import { buildExplainInput, EXPLAIN_SYSTEM_PROMPT } from './explain-input.js'
import { createActionTools } from '../server/action-routes.js'
import { resolveAuth } from '../server/http-routes.js'
import type { AppContext } from '../../worker.js'

const MODEL = 'claude-haiku-5-5'

export function registerExplainRoute(app: Hono<AppContext>): void {
  app.post('/api/explain', async (c) => {
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const body = await c.req.json<{ roundId?: unknown }>().catch(() => ({}) as { roundId?: unknown })
    if (typeof body.roundId !== 'string') return c.json({ error: 'roundId required' }, 400)
    const roundId = body.roundId
    // RBAC-off tools, so membership is checked here. callerJwt is unused (no user-billed calls).
    const tools = createActionTools(c.env, auth.userId, '')
    const got = await tools.get('rounds', roundId)
    const round = got.success ? (got.data.record.data as unknown as Round) : null
    if (!round || !round.playerIds.includes(auth.userId)) return c.json({ error: 'Round not found' }, 404)
    // Before the reveal this would hand out the answer mid-round.
    if (round.status !== 'revealed') return c.json({ error: 'Round not revealed yet' }, 409)

    // Owner-billed (no authToken): players needn't hold DeepSpace credits. Cost is bounded by
    // revealed-only, members-only, a short output cap, and one saved explanation per round.
    console.info(`[explain] start round=${roundId} caller=${auth.userId}`)
    const ai = createDeepSpaceAI(c.env, 'anthropic')
    const result = streamText({
      model: ai(MODEL),
      system: EXPLAIN_SYSTEM_PROMPT,
      prompt: JSON.stringify(buildExplainInput(round)),
      // Reasoning tokens share this cap; 600 left some answers truncated or empty (finish=length).
      maxOutputTokens: 2000,
      abortSignal: c.req.raw.signal,
      onEnd: async ({ text, finishReason }) => {
        console.info(`[explain] round=${roundId} finish=${finishReason} chars=${text.length}`)
        if (!text.trim()) return
        const saved: Explanation = { roundId, text, playerIds: round.playerIds }
        // uniqueOn roundId: a second concurrent stream's save is refused, which is fine.
        await tools.create('explanations', saved as unknown as Record<string, unknown>)
      },
    })
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        sendReasoning: false,
        onError: (error: unknown): string => {
          console.error(`[explain] ${loggableError(error)}`)
          return 'The explanation could not be generated. Try again.'
        },
      }),
    })
  })
}
