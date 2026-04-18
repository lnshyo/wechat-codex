# WeChat Bridge Rules

Use when touching `src/wechat/**`, `src/main.ts`, `src/session.ts`, gateway rendering, message routing, media forwarding, queueing, or per-contact runtime state.

## Invariants

- Normal WeChat messages go directly to Codex unless they are supported local control commands.
- Unknown slash commands must still flow to Codex as normal user input.
- Keep each WeChat contact isolated into its own persisted Codex thread and local session state.
- Prefer native WeChat typing state, with `GENERATING` fallback when typing fails.
- Preserve FIFO queueing and avoid duplicate inbound processing across bridge daemon instances.
- Treat local secrets and WeChat credentials as sensitive operator material; never print or persist raw values in docs, memory, or chat.

## Verification

- For command routing, gateway rendering, task queue, session, token, monitor, sender, or media changes, run the matching `dist/tests/*.test.js` file after `npm run build`.
- Run `npm run build` and `npm test` before completion for meaningful bridge behavior changes.
- Update both README files and `memory/CONTEXT.md` when user-facing commands, setup, runtime mode, data paths, or operator recovery steps change.
