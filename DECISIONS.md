# Integration decisions

- **Auth (Google sign-in)**: used. Platform auth via the scaffold's `AuthGate`/`AuthOverlay`. The email/password field the SDK always renders is used only by `@deepspace.test` fixture accounts.
- **Records + RBAC (RecordRoom)**: used. Collections `rooms`, `rounds`, `locks`, `picks`. `picks` is `read: 'own'` for every role, so the DO never sends a pick to another player.
- **Server actions**: used. All game writes (`createRoom`, `joinRoom`, `startRound`, `lockIn`, `revealRound`) are validated in the worker; no role may write game collections from the client.
- **Presence room (`usePresenceRoom`)**: used. Lobby online dots, keyed by the room's random record id.
- **AI (chat/agent)**: planned (next step). The scaffold's agent tools stay registered and run as the caller with RBAC, so they can't read others' picks.
- **Cron / scheduled jobs**: skipped. The 30s timer needs no scheduler: the last lock-in reveals inline, clients call `revealRound` at the deadline (the server checks the time), and `startRound` reveals any expired round left behind.
- **Background jobs**: skipped. Reveal takes ~10ms of compute; nothing outlives a request.
- **Payments (Stripe)**: skipped. Free game, nothing to sell.
- **Storage / R2 file uploads**: skipped. No user files; tiles are rendered as text.
- **LiveKit (audio/video)**: skipped. Not needed for a 30-second discard race.
- **Yjs / Canvas**: skipped. No collaborative text or drawing.
- **Messaging (chat channels)**: skipped. Out of scope for v1.
