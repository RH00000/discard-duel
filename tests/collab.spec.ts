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
  await expect(b.page.getByTestId('best')).toContainText('Best discard')
  // Scores are summed from results and shown to both players identically.
  const aScoreOnB = await b.page.getByTestId(`score-${a.userId}`).textContent()
  await expect(a.page.getByTestId(`score-${a.userId}`)).toHaveText(aScoreOnB!)
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
