# Agent log

## 2026-11-23 — Setup (steps 1–5)
**Did**
- Scaffolded with `npm create deepspace@latest .` (deepspace 0.44.2) inside the pre-made `discard-duel/` folder. The scaffolder ran `git init` itself; branch renamed `master` → `main`.
- Replaced the template `CLAUDE.md` (a one-line pointer to `AGENTS.md`) with the repo rules. `AGENTS.md` is kept.
- Created empty `AGENT_LOG.md` and `DECISIONS.md`.
- `.gitignore`: the scaffold already ignored `.dev.vars*` and `.deepspace`. Added `.env`, `.env.*`, `*.pem` and `*.key`.
- `npx deepspace dev start`: registered `app_01M860Y0DK36VQ5QJZ2CQG3KX5` on production. `/` and `/home` both return 200. Files changed: `wrangler.toml` (app id).
- Secret scan of untracked files: clean. The one hit was the false positive `task-list` in package-lock.json.

**Decisions**
- Order changed to: GitHub repo first, then deploy. DeepSpace permanently latches the source authority on the first deploy. Deploying without a GitHub remote would have made the app DeepSpace-sourced forever, leaving GitHub as a second copy. The user chose GitHub as the single source of truth. Rejected: the original deploy-then-GitHub order, because it makes two sources of truth.

**Broke / fixed**
- miniflare printed `Unable to fetch the Request.cf object` + TimeoutError on dev start. This is harmless: it falls back to a placeholder and the server came up fine.

**Needs a human**
- Open the live URL in a browser and confirm the default page renders.

## 2026-11-23 — GitHub repo + first deploy
**Did**
- Committed the scaffold (`db90583`) and ran `gh repo create discard-duel --public --source . --push`, which created https://github.com/RH00000/discard-duel.
- `deepspace status` reported `sourceInference: github`. `npx deepspace deploy` then published to https://discard-duel.app.space. `app source` now reports `github · rh00000/discard-duel`, revision 1 (permanent).
- `curl`: `/` and `/home` return 200 on the live URL.

**Needs a human**
- Open https://discard-duel.app.space in a browser.

## 2026-11-23 — Shanten library (milestone 1)
**Did**
- Added `src/lib/shanten/index.ts`: `shanten` = min(standard, chiitoitsu, kokushi), plus `discardOptions`, `bestDiscards`, `hand()` parser and `tileName`. Pure TS, no DeepSpace imports.
- Added `src/lib/shanten/shanten.test.ts`.
- Standard shanten uses a recursive decomposition (sets, pairs, taatsu, isolated) with `8 − 2m − min(t, 4−m) − p`.
- Ukeire counts only tiles whose draw lowers shanten. `unseen = 4 − copies in the 14-tile hand`; tiles with 0 unseen are omitted.

**Decisions**
- Brute-force recursion instead of lookup tables or per-suit memoization. It's simpler and easy to verify. Rejected precomputed suit tables because they're more code than one reveal per round needs.

**Test results** (`npx vitest run src/lib/shanten --reporter=verbose`)
```
 ✓ src/lib/shanten/shanten.test.ts > shanten > complete hand = -1 2ms
 ✓ src/lib/shanten/shanten.test.ts > shanten > complete chiitoitsu = -1 0ms
 ✓ src/lib/shanten/shanten.test.ts > shanten > tenpai = 0 (tanki wait) 1ms
 ✓ src/lib/shanten/shanten.test.ts > shanten > chiitoitsu 1-shanten 0ms
 ✓ src/lib/shanten/shanten.test.ts > shanten > kokushi tenpai (13-sided) 0ms
 ✓ src/lib/shanten/shanten.test.ts > shanten > worst case: no connections at all = 6 (via chiitoitsu) 0ms
 ✓ src/lib/shanten/shanten.test.ts > discardOptions > finds the shanpon wait and its ukeire 26ms
 ✓ src/lib/shanten/shanten.test.ts > discardOptions > kokushi: discarding the stray tile gives a 13-sided wait 2ms
 ✓ src/lib/shanten/shanten.test.ts > discardOptions > rejects hands that are not 14 tiles 1ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
```
- Timing: 200 random 14-tile hands through `discardOptions` took ~2.0s in total (~10ms average), worst 123ms (likely includes JIT warm-up).

**Known limits**
- shortcut: brute-force shanten (~10ms per reveal). Upgrade to suit lookup tables if Worker CPU limits are ever hit (check `deepspace logs` for CPU-exceeded on revealRound).
- Known edge case of the 8−2m−t−p formula: a hand whose only wait is a tile you already hold all 4 of reports tenpai/n-shanten but has 0 ukeire. Scoring still behaves (ukeire breaks ties), and it's rare in random hands.

**Needs a human**
- Spot-check a few reveal results against an external shanten calculator (e.g. tenhou's).

## 2026-11-23 — Game: rooms, rounds, hidden picks (milestones 2 + 3)
**Did**
- `src/schemas/game-schema.ts` (+ registered in `src/schemas.ts`):
  - `rooms`, `rounds`, `locks`: `read: 'shared'` via `playerIds`
  - `picks`: `read: 'own'` for every role, admin included, with `ownerField: userId` + `userBound`
  - No client writes on any game collection.
- `src/actions/index.ts`: `createRoom`, `joinRoom`, `startRound`, `lockIn`, `revealRound`. Scoring lives in `scoreRound` and is unit-tested in `src/actions/score.test.ts`.
- UI:
  - `src/pages/(app)/(protected)/play.tsx` (create/join)
  - `src/pages/(app)/(protected)/room/[code].tsx` (lobby with presence, hand, 30s timer, lock badges, reveal table, running scores)
  - `src/components/game/Tile.tsx`, `src/lib/call-action.ts`
  - Nav entry and a new `/home`.
- Tests:
  - `tests/collab.spec.ts`: full 2-player round + timer-expiry round
  - `tests/api.spec.ts`: every game action returns 401 without a token
- Created 2 fixture accounts, `duel-a@` and `duel-b@deepspace.test`. Their passwords exist only in `~/.deepspace/test-accounts.json`.

**How picks stay hidden (verified)**
- Before reveal, B sees A's lock badge, but B's `picks` subscription holds no row of A's.
- After reveal, B's `picks` still holds only B's own row, and A's pick reaches B only through `rounds.results`. A's own query does return A's row, so the empty result is filtering, not a broken query.
- Mutation check: temporarily set `picks` to `member: { read: true }` and the full-round test failed with `Expected: "" / Received: "<A's userId>"`. Reverted to `'own'`, and it passes.

**Decisions**
- `locks` and `picks` are separate collections. Row-level RBAC can't hide one field, so "who locked" and "what they picked" need different read rules. Rejected one row with a hidden field, because the DO would send the whole row.
- Admin is also `read: 'own'` on picks. The app owner is pinned to admin, and `read: true` would stream every pick to the owner's browser while they play.
- Running scores are summed client-side from each round's `results`, not stored as counters. That avoids a read-modify-write race across concurrent reveals.
- Reveal is idempotent and triggered three ways: by the last lock-in, by any client at the deadline (retrying every 1.5s to cover clock skew), and by `startRound` sweeping expired rounds (the requested change). Rejected a cron job, because the extra Durable Object wiring isn't needed for a 30s timer.
- Lobby presence uses scope `room:<recordId>`, not the short code. Presence sockets accept any scope string, including anonymous ones; the record id isn't guessable from the code.

**Broke / fixed**
- My first fixture for the "1 point" scoring test was wrong: discarding 5s from `234567m234p55669s` leaves 1-shanten, not tenpai. I found this by printing every discard option, then switched to `234567m234p55678s` (6s → tenpai, 7 ukeire vs a best of 10).
- `deepspace test run` refused with `port_in_use` because my own dev server held 5173. Fixed with `deepspace dev kill --port 5173`.
- The first version of the "B only sees B's pick" assertion raced the instant reveal (the picking view unmounts). Moved the hidden `visible-pick-owners` marker to room level so it survives reveal.

**Test results**
- `npx vitest run`: 4 files, 15 tests passed (9 shanten + 3 scoring/deal + 3 scaffold prerender).
- `npx deepspace test run e2e`: 18 passed (smoke 6, api 7, collab 5).

**Known limitations**
- `joinRoom` does read-modify-write on `rooms.playerIds`. After writing it re-reads: if the caller's id was lost to a concurrent join it retries (max 3), and if the list is over 4 it removes the caller and returns "Room full". Two simultaneous joins into a 3-player room can therefore both be backed out, leaving 3 players; both see "Room full" and can retry. Upgrade to one row per player if this matters.
- `lockIn` checks "already locked" by querying first; two truly simultaneous lock requests from the same user could both pass (the later pick wins, and `uniqueOn` refuses the second lock row). The UI disables the button while locking.
- Lock-in time and the fastest bonus use the worker's `Date.now()` at action time, so network latency counts against a player.
- The client countdown uses the local clock against the server deadline, so a skewed clock shows a slightly wrong number. The server enforces the real deadline.
- Players who join mid-round sit out until the next round.
- Test rooms accumulate in the local dev DB (rooms have no human-visible name to prefix).
- The theme is still the scaffold default.

**Needs a human**
- Sign in with a real Google account on the live site, and play one round from two browsers or devices.
