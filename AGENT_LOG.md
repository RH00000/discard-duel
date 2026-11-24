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
