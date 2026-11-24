# Decisions

## Main tradeoff
**A discard-puzzle duel instead of a full 4-player mahjong game.** A finished core beats half a game engine in 5 days: one shared hand, one decision, server-scored, with hidden picks that are actually hidden. A real game needs draws, calls (chi/pon/kan), riichi, yaku and scoring, and furiten, and none of that would have been finished or verified in the time.

## Integrations used
- **Auth (Google sign-in):** platform auth via `AuthGate`/`AuthOverlay`, so there's no OAuth, session or JWT code of our own; server routes trust only the verified JWT.
- **Sync (RecordRoom records):** rooms, rounds, lock-ins and results update live for every player with no polling code.
- **Presence (`usePresenceRoom`):** the lobby's "who's here" dots, ephemeral and JWT-identified, keyed by the room's random id.
- **Permissions (collection RBAC):** the hidden-pick guarantee lives here: `picks` is `read: 'own'` for every role, so the server never sends a pick to another player. All game writes go through validated server actions.
- **AI (Claude via `createDeepSpaceAI`):** the post-reveal "Why?" explanation is streamed from Claude through the DeepSpace proxy, so no provider key exists in the app. It is owner-billed, members-only, revealed-rounds-only, and saved once per round.

## Integrations skipped
- **Payments (Stripe):** free game, nothing to sell.
- **Storage (R2 file uploads):** no user files; tiles are rendered as text.
- **LiveKit (audio/video):** a 30-second silent puzzle doesn't need voice; players can use any call app alongside.

## Smaller calls (details in AGENT_LOG.md)
- **Cron / scheduled jobs:** skipped. The 30s timer is enforced on the server at lock-in and reveal time, so no scheduler is needed.
- **Yjs / canvas / messaging:** skipped; there's no shared document, drawing or chat in scope.
