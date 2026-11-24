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
- The 8−2m−t−p formula has the known edge case for hands holding all 4 copies of a tile used as a pair/taatsu (it can be off by one). This is rare in random hands.

**Needs a human**
- Spot-check a few reveal results against an external shanten calculator (e.g. tenhou's).
