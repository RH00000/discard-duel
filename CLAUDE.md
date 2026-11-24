# Rules for this repo
- Use the deepspace skill. Check docs.deep.space before using any SDK feature; don't guess APIs.
- Use platform primitives (auth, permissions, sync, AI) instead of hand-rolling them.
- Never commit secrets. Keys go in .dev.vars / platform config only.
- Shanten logic lives in src/lib/shanten/, is pure TypeScript with no DeepSpace imports, and must keep its tests passing.

# Logging (required)
After every meaningful step, append to AGENT_LOG.md:
- what you did and which files changed
- any decision + the alternative you rejected and why
- anything that broke and how you fixed it
- what still needs a human to verify
Keep DECISIONS.md with one line per integration used or skipped (payments, storage, LiveKit, etc.) and the reason.
