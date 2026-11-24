/**
 * Multi-user collaboration spec — verifies two users sign in into
 * separate browser contexts and the app distinguishes them.
 *
 * `users(2)` takes any two accounts from your pool, so this spec passes on a
 * fresh app with no setup beyond having two test accounts:
 *   npx deepspace test accounts list
 *   npx deepspace test accounts create --email a@deepspace.test --name "A" --password-stdin
 *
 * Ask for accounts *by name* (`users(['Alice', 'Bob'])`) only when the
 * behaviour under test depends on which identity acts — otherwise naming them
 * couples the spec to one machine's pool.
 *
 * The `users` fixture handles sign-in caching (per-account storageState
 * persisted to `~/.deepspace/playwright-states/`), context creation, and
 * cleanup. No need to manage browser contexts manually.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

// A machine that has never created test accounts is the normal state of a
// fresh checkout, and there `users()` throws — turning "you have no pool yet"
// into three red tests about the app, which it is not. Skip the file instead
// and say what creates the pool. The count is of accounts usable HERE: the
// pool is global per developer, but passwords live only on the machine that
// created the account.
const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)

  // /home is dynamic (under src/pages/(app)/), so it mounts the nav shell;
  // '/' is the static landing and has no navigation.
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

  // Email, not name. The page renders the *session's* `name || email`, while
  // `user.name` here comes from the LOCAL account registry — and the two are
  // not the same fact: a display name is optional, and an account recovered on
  // another machine has none stored locally at all. The email is the credential
  // the context signed in with, so it is the one identity both sides agree on,
  // and asserting it proves the page is showing THIS browser's account.
  // The two accounts are distinct, so two exact matches is also the proof that
  // the contexts are not sharing one session.
  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

    // The identity chip shows `name || email`. Its text is not predictable, but
    // its presence is: something must be there once the profile has loaded.
    // (It is `hidden sm:inline` in some templates, so assert text, not
    // visibility.)
    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })

    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, {
      timeout: 15_000,
    })
  }
})

test('API status page renders loading success and error states', async ({ users }) => {
  const [user] = await users(1)
  let shouldFail = false
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    if (shouldFail) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
      })
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { integrations: { openai: {}, wikipedia: {} } } }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()
  await expect(user.page.getByText('2 integrations available.')).toBeVisible()

  shouldFail = true
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect(user.page.getByText('Catalog unavailable')).toBeVisible()
  await expect(user.page.getByText('Showing the last loaded catalog')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

test('API status page shows local retry after first-load API failure', async ({ users }) => {
  const [user] = await users(1)
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Could not load API data')).toBeVisible()
  await expect(user.page.getByText('Retried 1 time automatically.')).toBeVisible()

  const retryButton = user.page.getByRole('button', { name: 'Retry' })
  await expect(retryButton).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await retryButton.click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

// ── Discard Duel ────────────────────────────────────────────────────────────


/** Which users' pick rows reached this browser (the DO filters before sending). */
const visiblePickOwners = (page: Page) =>
  page.getByTestId('visible-pick-owners').getAttribute('data-owners')

/**
 * Read data directly as this page's user, bypassing the UI: the app's agent-tools HTTP API
 * (registered by the scaffold) runs records.* tools as the caller with normal RBAC.
 */
async function callTool(page: Page, tool: string, input: Record<string, unknown>) {
  return page.evaluate(
    async ({ tool, input }) => {
      const { token } = await (await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })).json()
      const res = await fetch(`/_deepspace/agent/browser/tools/${tool}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ input }),
      })
      return { status: res.status, body: await res.json().catch(() => null) }
    },
    { tool, input },
  )
}

async function readRecords(page: Page, input: Record<string, unknown>) {
  const r = await callTool(page, 'records_query', input)
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return r.body.result.data.records as Array<{ recordId: string; data: Record<string, unknown> }>
}

async function explainStatus(page: Page, roundId: string) {
  return page.evaluate(async (roundId) => {
    const { token } = await (await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })).json()
    const res = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roundId }),
    })
    return res.status
  }, roundId)
}

async function createAndJoin(users: (n: number) => Promise<Array<{ page: Page; userId?: string }>>) {
  const [a, b] = await users(2)
  if (!a.userId || !b.userId) throw new Error('test accounts need saved userIds')
  await a.page.goto('/play')
  await a.page.getByTestId('create-room').click()
  await expect(a.page).toHaveURL(/\/room\/[A-Z0-9]{5}$/, { timeout: 15_000 })
  const code = a.page.url().split('/').pop()!

  await b.page.goto(`/room/${code}`)
  await b.page.getByTestId('join-room').click()
  await expect(b.page.getByTestId('room-code')).toHaveText(code, { timeout: 15_000 })
  await expect(a.page.getByTestId('players').locator('li')).toHaveCount(2, { timeout: 15_000 })

  await a.page.getByTestId('start-round').click()
  for (const u of [a, b]) await expect(u.page.getByTestId('hand').locator('button')).toHaveCount(14, { timeout: 15_000 })
  return { a: a as { page: Page; userId: string }, b: b as { page: Page; userId: string } }
}

test('full 2-player round: picks hidden until reveal, then visible and scored', async ({ users }) => {
  test.setTimeout(90_000)
  const { a, b } = await createAndJoin(users)

  // A locks in the first tile.
  const aTileBtn = a.page.getByTestId('hand').locator('button').first()
  const aTile = (await aTileBtn.getAttribute('data-tile'))!
  await aTileBtn.click()
  await a.page.getByTestId('lock-in').click()
  await expect(a.page.getByTestId('my-pick')).toContainText(aTile)

  // B sees THAT A locked in, but not WHAT: no pick row of A's ever reached B's socket.
  await expect(b.page.getByTestId(`lock-${a.userId}`)).toHaveAttribute('data-locked', 'true')
  await expect(b.page.getByTestId('timer')).toBeVisible()
  expect(await visiblePickOwners(b.page)).toBe('')
  // Sanity: the same query on A's side does return A's own pick, so the empty result above is filtering, not a broken query.
  expect(await visiblePickOwners(a.page)).toBe(a.userId)
  // Nothing in B's UI names A's tile: A's badge only says "locked in", and there's no results table yet.
  await expect(b.page.getByTestId(`lock-${a.userId}`)).toHaveText(/locked in$/)
  await expect(b.page.getByTestId('reveal')).toHaveCount(0)

  // Direct data reads as each player, bypassing the UI.
  const aOwn = (await readRecords(a.page, { collection: 'picks' })).find((r) => r.data.userId === a.userId)
  expect(aOwn?.data.tile).toBe(tileIndex(aTile)) // the read path works: A gets A's own pick
  const roundId = aOwn!.data.roundId as string
  expect(await readRecords(b.page, { collection: 'picks', where: { roundId } })).toEqual([])
  expect(await readRecords(b.page, { collection: 'picks', where: { userId: a.userId } })).toEqual([])
  // Even knowing the exact record id, B is refused.
  const byId = await callTool(b.page, 'records_get', { collection: 'picks', recordId: aOwn!.recordId })
  expect(JSON.stringify(byId.body)).not.toContain(`"tile":${tileIndex(aTile)}`)
  expect(byId.body?.result?.success ?? false).toBe(false)
  // The round record B can read carries no pick data yet, and no explanation is available yet.
  const roundBefore = await callTool(b.page, 'records_get', { collection: 'rounds', recordId: roundId })
  expect(roundBefore.body.result.data.record.data.status).toBe('picking')
  expect(roundBefore.body.result.data.record.data.results ?? null).toBeNull()
  expect(await explainStatus(b.page, roundId)).toBe(409)

  // B locks in the last tile. B's socket now carries B's pick only — still never A's.
  const bTileBtn = b.page.getByTestId('hand').locator('button').last()
  const bTile = (await bTileBtn.getAttribute('data-tile'))!
  await bTileBtn.click()
  await b.page.getByTestId('lock-in').click()

  // Everyone locked -> server reveals without waiting for the timer.
  for (const u of [a, b]) await expect(u.page.getByTestId('reveal')).toBeVisible({ timeout: 15_000 })

  // B's live picks subscription holds exactly B's own row (so it IS loading), and A's raw
  // pick row never reaches B — not even after reveal. A's pick reaches B only via rounds.results.
  await expect.poll(() => visiblePickOwners(b.page)).toBe(b.userId)
  await expect.poll(() => visiblePickOwners(a.page)).toBe(a.userId)

  // After reveal B CAN see A's pick (via rounds.results), proving the earlier check wasn't vacuous.
  await expect(b.page.getByTestId(`result-${a.userId}`)).toHaveAttribute('data-tile', aTile)
  await expect(a.page.getByTestId(`result-${b.userId}`)).toHaveAttribute('data-tile', bTile)
  // ...and in the data itself, for both players.
  for (const [viewer, owner, tile] of [[b, a, aTile], [a, b, bTile]] as const) {
    const r = await callTool(viewer.page, 'records_get', { collection: 'rounds', recordId: roundId })
    const players = r.body.result.data.record.data.results.players as Array<{ userId: string; tile: number }>
    expect(players.find((p) => p.userId === owner.userId)?.tile).toBe(tileIndex(tile))
  }
  // Raw pick rows stay owner-only even after reveal; results are the only path.
  expect(await readRecords(b.page, { collection: 'picks', where: { userId: a.userId } })).toEqual([])
  await expect(b.page.getByTestId('best')).toContainText('Best discard')
  // Scores are summed from results and shown to both players identically.
  const aScoreOnB = await b.page.getByTestId(`score-${a.userId}`).textContent()
  await expect(a.page.getByTestId(`score-${a.userId}`)).toHaveText(aScoreOnB!)
})

test('"Why?" streams a Claude explanation after the reveal and both players get the saved copy', async ({ users }) => {
  // Real AI call through the DeepSpace proxy (owner-billed, 2000 output tokens max).
  test.setTimeout(180_000)
  const { a, b } = await createAndJoin(users)
  for (const u of [a, b]) {
    await u.page.getByTestId('hand').locator('button').first().click()
    await u.page.getByTestId('lock-in').click()
  }
  for (const u of [a, b]) await expect(u.page.getByTestId('reveal')).toBeVisible({ timeout: 15_000 })

  const t0 = Date.now()
  await a.page.getByTestId('why-button').click()
  // First text usually arrives in a few seconds; one cold run took >60s, so allow 90s.
  await expect(a.page.getByTestId('why-text')).toHaveText(/\S+\s+\S+\s+\S+/, { timeout: 90_000 })
  console.log(`why first text after ${Date.now() - t0}ms`)
  // Once the stream ends the server saves it; B sees the same text without calling the model.
  await expect(b.page.getByTestId('why-button')).toHaveCount(0, { timeout: 60_000 })
  const text = (await b.page.getByTestId('why-text').textContent())!
  expect(text.length).toBeGreaterThan(40)
  console.log(`why-text sample: ${text.slice(0, 160).replace(/\s+/g, ' ')}…`)
})

test('timer expiry reveals the round with "no pick" for a player who never locked', async ({ users }) => {
  test.setTimeout(120_000)
  const { a, b } = await createAndJoin(users)
  await a.page.getByTestId('hand').locator('button').first().click()
  await a.page.getByTestId('lock-in').click()
  await expect(a.page.getByTestId('my-pick')).toBeVisible()

  // B never locks; the 30s deadline passes and a client-triggered reveal is accepted by the server.
  await expect(b.page.getByTestId('reveal')).toBeVisible({ timeout: 45_000 })
  await expect(b.page.getByTestId(`result-${b.userId}`)).toHaveAttribute('data-tile', '')
  await expect(b.page.getByTestId(`result-${b.userId}`)).toContainText('no pick')
})

// ── Race conditions (fired as real concurrent requests at the worker) ──────

type Result = { success: boolean; data?: Record<string, unknown>; error?: string }

/** Call a server action from a signed-in page, using the SDK's own token route. */
async function act(page: Page, name: string, params: Record<string, unknown> = {}): Promise<Result> {
  return page.evaluate(
    async ({ name, params }) => {
      const { token } = await (await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })).json()
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return res.json()
    },
    { name, params },
  )
}

const ROUNDS_OF_RACING = 3

const tileIndex = (name: string) => 'mpsz'.indexOf(name[1]) * 9 + Number(name[0]) - 1

async function openAll(us: Array<{ page: Page }>) {
  await Promise.all(us.map((u) => u.page.goto('/home')))
}

test('concurrent joins: nobody is silently dropped', async ({ users }) => {
  test.skip(loadAllTestAccounts().length < 4, 'needs 4 test accounts')
  test.setTimeout(120_000)
  const us = await users(4)
  await openAll(us)
  // shortcut: the local dev server did not reproduce the old join race even over 8 repeats, so these
  // check the new behaviour rather than catch the old bug. A load test on production would.
  for (let i = 0; i < ROUNDS_OF_RACING; i++) {
    const code = (await act(us[0].page, 'createRoom')).data!.code as string
    const joins = await Promise.all(us.slice(1).map((u) => act(u.page, 'joinRoom', { code })))
    expect(joins.map((j) => j.success)).toEqual([true, true, true])
    await us[0].page.goto(`/room/${code}`)
    await expect(us[0].page.getByTestId('players').locator('li'), `attempt ${i}`).toHaveCount(4, { timeout: 15_000 })
  }
})

test('two players racing for the last seat: exactly one gets it', async ({ users }) => {
  test.skip(loadAllTestAccounts().length < 5, 'needs 5 test accounts')
  test.setTimeout(120_000)
  const us = await users(5)
  await openAll(us)
  for (let i = 0; i < ROUNDS_OF_RACING; i++) {
    const code = (await act(us[0].page, 'createRoom')).data!.code as string
    expect((await act(us[1].page, 'joinRoom', { code })).success).toBe(true)
    expect((await act(us[2].page, 'joinRoom', { code })).success).toBe(true)
    const [d, e] = await Promise.all([act(us[3].page, 'joinRoom', { code }), act(us[4].page, 'joinRoom', { code })])
    expect([d.success, e.success].filter(Boolean), `attempt ${i}`).toHaveLength(1)
    expect([d, e].find((r) => !r.success)?.error).toBe('Room full')
    await us[0].page.goto(`/room/${code}`)
    await expect(us[0].page.getByTestId('players').locator('li'), `attempt ${i}`).toHaveCount(4, { timeout: 15_000 })
    // Whoever won the seat must actually be listed.
    const winner = d.success ? us[3] : us[4]
    await expect(us[0].page.getByTestId(`score-${winner.userId}`), `attempt ${i}`).toBeVisible()
  }
})

test('double lock-in: one request wins and its tile is the one scored', async ({ users }) => {
  const [a, b] = await users(2)
  await openAll([a, b])
  const code = (await act(a.page, 'createRoom')).data!.code as string
  expect((await act(b.page, 'joinRoom', { code })).success).toBe(true)
  const roundId = (await act(a.page, 'startRound', { code })).data!.roundId as string
  await a.page.goto(`/room/${code}`)
  await expect(a.page.getByTestId('hand').locator('button')).toHaveCount(14, { timeout: 15_000 })
  const names = await a.page.getByTestId('hand').locator('button').evaluateAll((els) => els.map((e) => e.getAttribute('data-tile')!))
  const [x, y] = [...new Set(names)]

  const [rx, ry] = await Promise.all([
    act(a.page, 'lockIn', { roundId, tile: tileIndex(x) }),
    act(a.page, 'lockIn', { roundId, tile: tileIndex(y) }),
  ])
  expect([rx.success, ry.success].filter(Boolean)).toHaveLength(1)
  expect([rx, ry].find((r) => !r.success)?.error).toBe('Already locked in')
  const winner = rx.success ? x : y

  expect((await act(b.page, 'lockIn', { roundId, tile: tileIndex(names[0]) })).success).toBe(true)
  await expect(a.page.getByTestId('reveal')).toBeVisible({ timeout: 15_000 })
  await expect(a.page.getByTestId(`result-${a.userId}`)).toHaveAttribute('data-tile', winner)
})

test('lock-in racing the deadline reveal: success always means the pick was scored', async ({ users }) => {
  test.setTimeout(90_000)
  const [a, b] = await users(2)
  await openAll([a, b])
  const code = (await act(a.page, 'createRoom')).data!.code as string
  expect((await act(b.page, 'joinRoom', { code })).success).toBe(true)
  const startedAt = Date.now()
  const roundId = (await act(a.page, 'startRound', { code })).data!.roundId as string
  await b.page.goto(`/room/${code}`)
  const bTile = (await b.page.getByTestId('hand').locator('button').first().getAttribute('data-tile'))!

  // Fire B's lock-in and a burst of reveals right at the deadline.
  await b.page.waitForTimeout(Math.max(0, startedAt + 30_000 - Date.now() - 40))
  const [lock] = await Promise.all([
    act(b.page, 'lockIn', { roundId, tile: tileIndex(bTile) }),
    ...Array.from({ length: 3 }, () => act(a.page, 'revealRound', { roundId })),
  ])
  await expect(b.page.getByTestId('reveal')).toBeVisible({ timeout: 15_000 })
  const shown = await b.page.getByTestId(`result-${b.userId}`).getAttribute('data-tile')
  // Either outcome is fine; disagreement is the bug.
  expect(shown).toBe(lock.success ? bTile : '')
  // Refused either mid-write ("Time is up") or before it started, if a reveal landed first.
  if (!lock.success) expect(['Time is up', 'Round already revealed']).toContain(lock.error)
  console.log(`deadline race outcome: lockIn ${lock.success ? 'counted' : `refused (${lock.error})`}`)
})
