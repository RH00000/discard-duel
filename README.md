# Mahjong Discard Duel

A 2–4 player mahjong discard race. Everyone in a room sees the same 14-tile riichi hand and has 30 seconds to lock in the single best discard. Players see **who** has locked in, never **what**, until everyone has locked or time runs out. Then the reveal shows each pick's shanten and ukeire next to the optimal discard(s), awards points, and offers a Claude-written "Why?" explanation built only from the computed numbers.

**Live:** https://discard-duel.app.space

Built on [DeepSpace](https://docs.deep.space) (Cloudflare Workers + Durable Objects): Google sign-in, live sync, presence, server-enforced permissions and the AI proxy.

## How it plays
1. Sign in with Google, go to **Play**, and create a room. Share the 5-letter code, or click **Copy invite link** in the room.
2. With 2–4 players in, the host starts a round. The server deals one hand for everyone.
3. Click a tile, then **Lock in**. Other players see a "locked in" badge for you, never your tile.
4. Reveal happens when everyone has locked or after 30s. Scoring:
   - **3** for an optimal pick (lowest shanten, then most ukeire)
   - **1** if the shanten matches the best but the ukeire is lower
   - **0** otherwise
   - **+1** to the fastest optimal pick
5. **Why?** streams an explanation; both players then see the saved copy. The host deals the **Next round**, and scores keep adding up. There's no fixed game length yet. Rooms you're in are listed under **Your rooms** on the Play page, so you can leave the page and come back. From there the host can **Delete** a room (for everyone, with its rounds and scores), and other players can **Leave** it.

## How picks stay hidden
- Picks are stored in their own `picks` collection, readable only by the player who made it (`read: 'own'` for every role, including the app owner). The Durable Object filters rows **before** anything goes over the WebSocket.
- Lock-ins (who and when) are a separate collection the room can read.
- At reveal, the server copies picks into the round's results, which is the only way another player ever sees your tile.
- Every write is a server action that checks membership, deadline and round state on the server. Details in `src/schemas/game-schema.ts` and `src/actions/index.ts`.

## Project layout
| Path | What |
|---|---|
| `src/lib/shanten/` | Pure TypeScript shanten + ukeire (standard, chiitoitsu, kokushi). No DeepSpace imports. |
| `src/schemas/game-schema.ts` | Collections and their permissions |
| `src/actions/index.ts` | Server actions: create/join/leave/delete room, start round, lock in, reveal, scoring |
| `src/ai/explain.ts`, `src/ai/explain-input.ts` | `/api/explain` streaming route; system prompt and structured input |
| `src/pages/(app)/(protected)/` | `play.tsx` (create/join), `room/[code].tsx` (lobby, round, reveal) |
| `scripts/verify-shanten/` | Python generator for reference fixtures (uses the `mahjong` package) |
| `AGENT_LOG.md`, `DECISIONS.md` | Build log and integration decisions |

## Run locally
Requirements: Node 22.15+/24/26, npm 11.6+, a DeepSpace account.

```bash
npm install
npx deepspace auth login      # browser sign-in, once
npx deepspace dev start       # http://localhost:5173
```

## Test
```bash
npx vitest run                # unit: shanten, 25,000-hand reference check, scoring, AI input
npx deepspace test run e2e    # Playwright: smoke, API, multi-user rounds, privacy, races, "Why?"
```

- **Multi-user tests** need DeepSpace test accounts (up to 10 per machine). The race tests need 5.
  ```bash
  npx deepspace test accounts create --email duel-a@deepspace.test --name duel-a --password-stdin
  ```
- **The "Why?" e2e test** makes a real, owner-billed Claude call.
- **Regenerating the shanten reference fixtures:**
  ```bash
  cd scripts/verify-shanten
  python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt   # .venv/bin/python on macOS/Linux
  .venv/Scripts/python generate.py
  ```

## Deploy
```bash
npx deepspace deploy
```
The app's source is GitHub (permanently): a deploy ships the local working tree, so commit and push first.

## What's unfinished
- **No game end.** Rounds go on until people leave. There's no round limit, winner screen or reset.
- **Default look.** It still uses the scaffold theme and text-rendered tiles; no custom design pass yet.
- **Join race not reproduced.** The concurrent-join fix is verified by code review, but the local dev server never reproduced the original race, so that test can't catch a regression.
- **Thin reference coverage of rare hands.** The 25,000-hand reference check is mostly 2–5 shanten hands; tenpai, chiitoitsu and kokushi rely on the hand-written tests.
- **Some edge cases are rough:**
  - a lock-in at the exact deadline can be refused after the player clicked in time (by design, so a success always counts)
  - a player who joins mid-round waits on the lobby without explanation
  - room codes can be probed and rooms filled by anyone with the code
- **Not checked in production yet:** a two-account round on the live site, and the AI explanation's faithfulness beyond spot checks.

## What I'd do next
1. **Game length + final standings:** host picks N rounds, a winner screen, a "New game" reset.
2. **A design pass:** its own theme and proper tile art.
3. **Harder hands:** deal from a pool weighted toward 1–3 shanten so the decision is interesting, and add a second reference fixture of near-tenpai, chiitoitsu and kokushi hands.
4. **Membership hardening:** room approval or kick, plus a role check on actions.
5. **A production load test** of concurrent joins and lock-ins.
6. **Grow toward real mahjong one rule at a time:** draws and discards over several turns before calls or yaku.
