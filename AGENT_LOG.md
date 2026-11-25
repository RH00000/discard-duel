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

## 2026-11-23 — Deploy of the game
**Did**
- Pushed `a0c806f` and `e82295c` to GitHub, then ran `npx deepspace deploy` (GitHub source, clean working tree). That created release #2, `rel_01M861S05X58PF6CG7YD1VFQJR`; release #1 stays available for rollback.
- Live checks:
  - `/`, `/home`, `/play`, `/room/ABCDE` return 200
  - `POST /api/actions/lockIn` without a token returns 401
  - `deepspace logs` shows no exceptions or errors

**Not verified on production**
- The 2-player e2e ran against the local dev server only. Production needs a real sign-in, because the e2e fixture accounts are for local runs.

**Needs a human**
- Play one full round on https://discard-duel.app.space with two Google accounts. Check:
  - the lobby dots
  - that the lock badges appear without revealing picks
  - the reveal table and running scores

## 2026-11-24 — Independent privacy review (fresh subagent, read-only)
**Did**
- Started a general-purpose subagent with no session context. It was given only the goal ("find any way a player can read another's pick before reveal"), the attack areas (direct reads, sync subscriptions, API/actions, timer and race edge cases, roles), the file list, and read-only rules.
- It checked behaviour against the compiled SDK that is actually installed (`node_modules/deepspace/dist/worker.js`, 0.44.2). It changed no files and made no requests to the live site.
- No fixes applied yet; waiting for the user.

**Result: no CRITICAL or HIGH findings.** No path found for a player, non-player, anonymous visitor or admin to read another player's pick before the reveal.

**Findings**
1. **LOW, confirmed. `joinRoom` can silently drop a player** (`src/actions/index.ts:120-141`).
   - Two joins race into a 3-player room. X writes and re-reads before Y's stale write lands, so X gets "success" and is then overwritten out of the room.
   - The ">4 back-out" branch is dead code: a writer only adds one id to a list it just read as under 4.
   - **This corrects my earlier "Known limitations" entry**, which said a lost id is retried and an overshoot is backed out. The retry only catches losses that happen before your own re-read. I checked the code and agree.
   - No effect on picks.
   - Fix: one membership row per player, with `uniqueOn`.
2. **LOW, confirmed. The reveal is not atomic** (`tryReveal`, lines 91-103).
   - Two reveals running at once can both compute results, and the last write wins.
   - Picks still can't be changed after a reveal: `lockIn` re-checks `status === 'picking'` on the server.
   - Fix: re-check the status just before writing, or use a unique reveal row so only the first reveal takes effect.
3. **LOW/INFO, confirmed. Two simultaneous `lockIn` calls from the same user** can leave the stored pick as tile Y while the lock time came from tile X's request. Nothing about other players is learned.
   - Fix: create the lock row first and let its `uniqueOn` be the gate, then write the pick.
4. **INFO. The app owner can always see picks** if `ALLOW_DEBUG_ROUTES=true` is ever set in production, because the admin SQL debug route bypasses RBAC. It's off by default. The owner can also deploy any code. Keep `ALLOW_DEBUG_ROUTES` unset in production.
5. **INFO. Two oracles that never reveal a tile.**
   - Writing to a known pick recordId reveals whether a guessed `roundId`/`userId` matches, because the immutable-field check runs before RBAC.
   - `records.get` via the agent tools tells "exists" apart from "not found".
   - Both need a pick's recordId, which is random and never sent to other players. `tile` is never exposed.
6. **INFO. Actions check the JWT, not app role or room approval.**
   - A user demoted to viewer can still create and join rooms.
   - Room codes can be probed via error messages.
   - Anyone with a code can fill a room.
7. **INFO. Dead UI.** A mid-round joiner is not in `round.playerIds`, so they can't read the current round, and the "You joined mid-round" text never shows. They see the lobby until the next round.

**Checked and found safe** (summary)
- **`picks`:** `'own'` is applied as a server-side SQL owner filter before any client `where`, `orderBy` or `limit`. Live updates are only sent to sockets that pass `canRead`. Admin is `'own'` too.
- **Pick ownership:** `ownerField` + `userBound` + `immutable`, and the only writer is `lockIn`, using the verified caller id.
- **`rounds` / `locks` / `rooms`:** no pick data before reveal.
- **Forcing an early reveal:** the deadline lives on the server, "all locked" needs one lock row per snapshot player, and only the caller can create theirs.
- **`revealRound` / `lockIn` errors:** carry no pick data.
- **A client-sent `X-App-Action` header:** ignored on WebSocket paths.
- **Agent tools:** run as the caller with RBAC.
- **Other DO scopes, presence, Yjs, proxies:** carry no game data. The selected tile stays in React state until lock-in.

**Needs a human**
- Decide which of findings 1–3 (and optionally 6–7) to fix.
- Confirm `ALLOW_DEBUG_ROUTES` is never set in production.

## 2026-11-24 — Fixed review findings 1–3
**Did** (files: `src/schemas/game-schema.ts`, `src/actions/index.ts`, `tests/collab.spec.ts`)
1. **Joins can no longer silently drop a player.**
   - New server-only `members` collection: one row per (room, user), `uniqueOn`. The insert is the atomic join step.
   - Players are ranked by join order (`createdAt`, then recordId), and the first 4 are in. A rank-5+ joiner deletes its own row and gets "Room full".
   - `rooms.playerIds` is now a derived copy. `syncPlayerIds` rewrites it from the member rows and re-checks until they agree.
   - `startRound` snapshots the synced list.
   - Rooms created before this change get their members backfilled once from `playerIds`, so the host isn't dropped by the next join.
2. **Reveal is atomic.**
   - New server-only `reveals` collection, `uniqueOn: roundId`, holding the results. The first reveal to insert it fixes the results; any later or concurrent reveal copies those exact results instead of recomputing.
   - Early reveal now needs every player to have both a lock row and a pick row, not just a lock.
3. **Lock-in is gated by the lock row.**
   - `lockIn` creates the lock first; its `uniqueOn` refuses a second concurrent request before it can touch the pick.
   - If writing the pick fails, the lock is removed.
   - After writing, if a reveal that started earlier didn't count this pick, `lockIn` deletes its own lock and pick rows and returns "Time is up". A successful lock-in now always means the pick was scored.

**Decisions**
- Kept `rooms.playerIds` as the client-facing membership list (and RBAC `collaboratorsField`) instead of moving reads to `members`, because `'shared'` needs the ids on the record itself. Rejected making `members` client-readable: it would add a second source the UI would need to reconcile.
- Store the results in the claim row rather than claim-then-compute, so a reveal that dies halfway can be finished by any later call with identical results.

**Tests**
- Added to `tests/collab.spec.ts`:
  - concurrent joins (4 users)
  - racing for the last seat (5 users)
  - double lock-in
  - lock-in racing the deadline reveal

  They call actions as real concurrent requests from signed-in pages, using the SDK's `/api/auth/token`.
- Created 3 more fixture accounts (`duel-c/d/e@deepspace.test`), 5 of the 10 allowed.
- Results: `vitest` 15/15 and `deepspace test run e2e` 22/22.

**What the new tests do and don't prove** (each was also run against the pre-fix code)
- **Double lock-in:** fails on the old code (`Received: "Duplicate: … already exists in picks"`) and passes on the new code. This is a real regression test.
- **Both join races:** pass on the old code too, even after 8 repeats. The local dev server didn't open the race window. They check the new behaviour (exactly one winner, 4 players listed, the winner is listed) but **would not catch a regression**. The join fix is verified by code review, not by a reproduced failure.
- **Deadline race:** passes on both versions. In every run, B's lock-in landed after the deadline and got "Time is up", so only the refusal path was exercised. The "counted" branch of the late-lock undo has not been hit by a test.

**Known limits that remain**
- The late-lock undo relies on the reveal claim existing by the time `lockIn` checks it. A reveal triggered on a different worker isolate whose clock is ahead could, in principle, insert its claim after that check and leave a successful lock-in uncounted. This window is sub-millisecond clock skew.
- Findings 4–7 from the review (debug-route note, recordId oracles, no role check on actions, dead mid-round UI text) are unchanged.

**Needs a human**
- Ideally a short concurrent-join load test against production to reproduce the old race and confirm the fix there.
- Deployed as release #3 (`rel_01M86550H2GRGYHQ4P446J3TX4`). Live checks: `/` and `/play` return 200, `joinRoom` without a token returns 401, `deepspace logs` shows 0 errors or exceptions. Release #2 is available for rollback.

## 2026-11-24 — Shanten verified against a reference implementation
**Did**
- `scripts/verify-shanten/`:
  - a Python venv (gitignored via `.venv/`) with `mahjong` 2.3.0, pinned in `requirements.txt`
  - `generate.py`: seed 20261124 draws 20,000 legal 13-tile hands and 5,000 legal 14-tile hands from a shuffled 136-tile wall (so at most 4 copies of any tile), and writes `mahjong.shanten.Shanten.calculate_shanten` results to `fixtures.json` (1.2 MB)
- `src/lib/shanten/reference.test.ts`: loads the fixtures and compares `shanten()` on every hand. On any mismatch it prints the first 10 (tiles, expected, got) and fails.
- `.gitignore`: added `.venv/` and `__pycache__/`.

**Result: 25,000 / 25,000 match. No implementation change was needed.**

**Checks on the check**
- Mutation test: disabling one rule (kanchan/gap shapes like 1-3) in `standardShanten` dropped the score to 16,649/25,000, and the test printed mismatches such as `2m 2m 3m 9m 1p 8p 9p 1s 2s 4s 6s 6z 7z expected 4, got 5`. Restored from git afterwards.
- The fixture's shanten distribution is `{0: 6, 1: 243, 2: 2872, 3: 9569, 4: 9165, 5: 2960, 6: 185}`. Random hands almost never hit complete hands (-1), tenpai (only 6), chiitoitsu-favoured or kokushi shapes, or the 4-copy edge case. Those are covered by the hand-written cases in `shanten.test.ts`, not by this fixture.

**Broke / fixed**
- The first version read the fixture with `node:fs`. Vitest passed, but `tsc` failed (`Cannot find module 'node:fs'`), because `src/` is typed as browser/Worker code. Switched to a Vite `?raw` import plus `JSON.parse`, which also avoids type inference over 1.2 MB of JSON. `vite build` output does not contain the fixture.

**Decisions**
- Kept the test next to the shanten code in `src/lib/shanten/` rather than moving it to the repo root with Node types, so `npx vitest run` still runs it with the rest of the shanten tests. Rejected adding `@types/node` to `src/`, because Node APIs would then type-check in Worker code.

**Needs a human**
- Nothing blocking. Optionally generate a second fixture weighted towards low-shanten hands (e.g. built from complete hands with tiles swapped out) to stress tenpai, chiitoitsu and kokushi paths against the reference.

## 2026-11-24 — "Why?" explanations, privacy e2e, docs
**Did**
- **"Why?" after reveal.** `POST /api/explain` (`src/ai/explain.ts`, registered in `worker.ts`) streams Claude (`claude-haiku-5-5`) through `createDeepSpaceAI`, in the AI SDK UI-message stream format.
  - Refuses with 401 (no JWT), 404 (not in the round, same error as a missing round) and 409 (not revealed yet, so it can't be used for hints mid-round).
  - The input is recomputed on the server from the stored hand (`src/ai/explain-input.ts`): the hand, every distinct discard with `shantenAfter`, ukeire tiles with unseen counts, `ukeireTotal`, `optimal`, picks without user ids, and a `definitions` block.
  - The system prompt restricts the model to those numbers: no rules, heuristics or efficiency claims, and say so if it can't answer.
  - The finished text is saved once per round in the new `explanations` collection (`read: 'shared'` by round players, server-written only), so both players see it.
  - The client (`src/components/game/WhyPanel.tsx`) decodes the stream with the SDK's `parseSseLine` + `decodeAiStreamChunk`.
- **Billing / keys.** The call is owner-billed: no `authToken` is passed, so the proxy uses `APP_OWNER_JWT`. There's no provider key anywhere in the repo. `createActionTools` is now exported from `src/server/action-routes.ts` for the route's server-side reads.
- **Privacy e2e** (`tests/collab.spec.ts`, full-round test). After A locks in, B reads directly through the app's agent-tools HTTP API (`/_deepspace/agent/browser/tools/records_*`, which runs as the caller with RBAC):
  - `picks` by `roundId` and by A's `userId` both return `[]`
  - `records_get` on A's exact pick record id is refused
  - the round record has no results
  - `/api/explain` returns 409

  Sanity check: the same read path as A returns A's own pick.
- **After reveal:** both players' data reads of `rounds.results` show the other's tile, and B still can't read A's raw pick row.
- **"Why?" e2e:** A streams a real explanation, then B sees the saved copy and no "Why?" button.
- `api.spec.ts`: `/api/explain` without a token returns 401.
- **Docs:** `DECISIONS.md` rewritten (used: auth, sync, presence, permissions, AI; skipped: payments, storage, LiveKit; main tradeoff). New `README.md`.

**Broke / fixed**
- **Agent-tools route path.** `/_deepspace/agent/tools/*` answered 401 for a normal user JWT, because it needs an origin-bound agent token. Signed-in web users go through `/_deepspace/agent/browser/tools/*`, whose tool names use underscores (`records_query`).
- **Intermittent empty "Why?".** One run showed no text and no error for 60s+. Server logging showed `finish=length` after only 406–620 characters with `maxOutputTokens: 600`: reasoning tokens share the cap, so answers were truncated or, at worst, empty. Two fixes:
  - raised the cap to 2000 (the prompt keeps answers under 150 words)
  - the client now shows "No explanation came back" instead of failing silently

  After that, 8/8 repeated runs ended with `finish=stop` (487–825 chars), first text in about 2.4–2.9s.
- **Explanation said "points" was undefined.** The model correctly said the JSON doesn't define "points". Added the game's scoring rule to `definitions`.
- **Deadline-race test.** It failed once with "Round already revealed" instead of "Time is up": the reveal landed before the lock-in started. Both are correct refusals, and the real check (lock refused ⇔ results show no pick) held. The test now accepts either message.

**Test results**
- `npx vitest run`: 6 files, 19 tests passed.
- `npx deepspace test run e2e`: 24 passed.

**Needs a human**
- Read several live "Why?" explanations and check that they only quote the given numbers.
- Decide whether owner-billed AI is acceptable at scale (cost per round is roughly one short Haiku call).
- Deployed as release #4 (`rel_01M8691T261B6ZW9X2VA9KFAR7`). Live checks:
  - `/`, `/home` and `/play` return 200
  - `/api/explain` and `/api/actions/lockIn` without a token return 401
  - `deepspace logs` shows 0 errors or exceptions
  - the repo scan found no provider keys

  Not checked live: an actual "Why?" call (needs two signed-in players and a revealed round).

## 2026-11-24: fixes from the hand-check on production
User verified checks 1–6 and 10 on the live site (two accounts; "Why?" shared copy; scores match; phone works).
- **Problem:** after clicking Home/Play there was no way back to a room except retyping its code.
  **Fix:** the Play page lists "Your rooms" (`useQuery('rooms')`, which RBAC already limits to rooms the caller is in; filtered client-side by `playerIds` too, because the app owner's admin role may see more). Newest first, each links to `/room/CODE`. Rejected: a stored "current room" per user; the room list needs no new data.
- **Problem:** on a phone the 14-tile hand wrapped to two rows.
  **Fix:** below the `sm` breakpoint the hand is a 14-column grid and tiles shrink to fit (`Tile` md size is `w-full h-12` on phones, unchanged from `sm` up). Rejected: 7+7 rows (easier to tap, but a mahjong hand reads as one row).
- Files: `src/pages/(app)/(protected)/play.tsx`, `src/pages/(app)/(protected)/room/[code].tsx`, `src/components/game/Tile.tsx`, `tests/collab.spec.ts`, README.md.
- **Test:** new e2e test. B leaves for /play, clicks the room under "Your rooms" and lands back in it; at a 375px viewport all 14 tiles share one top edge and fit inside the screen. `npx deepspace test run e2e`: 25 passed.
- **Checked from the CLI:** `npx deepspace secrets list` shows no secrets in prd, so `ALLOW_DEBUG_ROUTES` is unset. `npx deepspace app usage` shows anthropic 24 calls for $0.02 total (all test runs plus the hand check) and 498/500 free credits left.
- **Still for a human:** check 7 (third account / full room); tap accuracy on a small phone with the narrower tiles.

## 2026-11-24: delete/leave rooms, copy invite link
User hand-checked check 7: the join prompt works by link, and a fifth account is refused with "Room full". They asked for a way to delete rooms and an invite-link button.
- **Server actions** (`src/actions/index.ts`):
  - `leaveRoom(code)`: non-host only. It removes the caller's member row and re-syncs `playerIds`; the same re-check pattern as join, so a concurrent join and leave converge.
  - `deleteRoom(code)`: host only. It deletes the room record first, so nobody can join or start a round once it's gone. Then it deletes every round with its locks, picks, reveals and explanations, then the members. `deleteWhere` deletes one page per call, so a `drain` helper repeats it until a call deletes nothing.
  - **Rejected:** letting the host leave with host passed to the next player. The user asked for delete, and handing over host adds rules (who, and what if they're away) nobody asked for. The host's button is "Delete"; everyone else's is "Leave".
  - **Known limit:** if `deleteRoom` fails partway, some rows are left that no page can reach (marked `shortcut:` in the code).
  - **A player who leaves mid-round** stays in that round's snapshot: their lock still counts, or the round reveals at the deadline.
- **UI:**
  - Each row under "Your rooms" has a Delete or Leave button with a confirm dialog (the scaffold's `Dialog`).
  - The room header has "Copy invite link" (`navigator.clipboard`; if copying fails, the toast shows the link instead).
  - After a delete, other players' room pages fall back to the join prompt; joining then says "No room with that code".
- **Tests:**
  - New e2e test: A copies the invite and the clipboard holds the room URL; B leaves and A's player list drops to 1; B rejoins by link; A deletes; afterwards both users' direct reads of `rooms` and `rounds` for that room return nothing.
  - `api.spec.ts` checks that both new actions return 401 without a token.
  - `npx deepspace test run e2e`: 28 passed.
- **Still for a human:** delete a room that has a few rounds on production, and confirm the other player's page drops back to the join prompt.

## 2026-11-24: display name "Mahjong Discard Duel"
- `APP_NAME` in `src/constants.ts` drives the nav header, the `<title>` of app pages, the landing page, the 404 title and SEO/OG tags.
- Also changed:
  - the static `<title>` in `index.html`
  - the H1 on /home and /play
  - the sign-in screens: `AuthOverlay title` in Navigation and the protected layout, plus the signed-out panel heading
  - the README H1
- **Left unchanged on purpose:** the repo, package name, the wrangler `name`/app slug/URL, and the `APP_NAME` var in wrangler.toml. That var is deploy config and is only read by the scaffold's AI chat system prompt.
- **Tests:** vitest 19/19, e2e 28/28.

## 2026-11-24: polish pass (no game logic, data model or permission changes)
- **Bug 1: "(left)" label.** In FW3XS round 2, Ricky Vicks was in the results but not in the player pills. The user confirmed they left mid-round: a round keeps the players it started with, while the pills show the room's current players. No investigation, as requested.
  - **Fix:** the results table adds a muted "(left)" after any player who is no longer in the room (`RevealView` gets the room's `playerIds`).
- **Bug 2: tile names.** Users saw "1z"/"2p"-style names. Added `src/lib/tile-label.ts` with `tileLabel` ("2 pin", "East") plus a unit test, and used it everywhere players read a tile name:
  - Lock-in button and "Locked in:" text
  - the "Best discards" line
  - tile `aria-label`s
  - the "Why?" input, so new explanations name tiles the same way; the definitions and the test were updated, and explanations already saved keep their old wording
  - `data-tile` keeps the compact `tileName` form that tests rely on
- **Room page styling:**
  - tiles: off-white face, rounded, darker 5px bottom edge, soft shadow
  - the selected tile lifts 6px with the primary ring
  - the hand sits on a dark green felt panel (emerald-900 plus a faint radial highlight; no images)
  - on reveal, best discards get a gold (amber-400) ring and the others are no longer dimmed
  - everything else stays on the DeepSpace theme; no new fonts
- **Tests:**
  - New e2e test: three players; C locks in, then leaves; A and B lock in. C's row shows "(left)" and B's doesn't; the "Best discards" text has no `1z`-style codes. Set `REVEAL_SCREENSHOT=<path>` to save a screenshot.
  - The full-round test now expects the display name in "Locked in:".
  - Results: vitest 20/20, e2e 29/29.

## 2026-11-24: phone hand layout, two rows of 7
**Problem (from the user):** with all 14 tiles squeezed into one row, the tiles were cramped on a phone.
**Fix:**
- Below 768px (`md`) the hand is a 7-column grid, capped at `max-w-xs`, with tiles about 41×56px on a 375px screen. From `md` up it's one row of 44×64px tiles with a 4px gap.
- Tablet widths (640–767px) use two rows too. A row of 14 at 44px is ~670px and would overflow the felt panel there.
- **Rejected:** a free `flex-wrap`. At phone widths it wraps 6/6/2, which reads worse than 7/7.
**Tests:**
- The phone e2e test now checks, at 375px, two rows with 7 tiles in the first, nothing past the screen edge, and tiles at least 36px wide. At 1100px it checks one row inside the felt panel.
- `PHONE_SCREENSHOT=<path>` saves the phone view.
- Results: vitest 20/20, e2e 29/29.
