# WeChat Bridge Rules

Use when touching `src/wechat/**`, `src/main.ts`, `src/session.ts`, gateway rendering, message routing, media forwarding, queueing, or per-contact runtime state.

## Invariants

- Normal WeChat messages go directly to Codex unless they are supported local control commands.
- Unknown slash commands must still flow to Codex as normal user input.
- Keep each WeChat contact isolated into its own persisted Codex thread and local session state.
- Prefer native WeChat typing state, with `GENERATING` fallback when typing fails.
- Preserve FIFO queueing and avoid duplicate inbound processing across bridge daemon instances.
- Archive every supported inbound attachment before command or task routing. Use the root-level `资料库/` destinations from `rules/file-storage.md`, pass the saved path to Codex, and never create contact or message subdirectories.
- Preserve the exact final extension and its letter case when saving or collision-renaming a WeChat file. Insert any collision marker before the extension and never overwrite an existing file.
- Reject obvious credential containers instead of persisting them automatically.
- Treat local secrets and WeChat credentials as sensitive operator material; never print or persist raw values in docs, memory, or chat.

## Verification

- For command routing, gateway rendering, task queue, session, token, monitor, sender, or media changes, run the matching `dist/tests/*.test.js` file after `npm run build`.
- For inbound attachment routing, naming, collision handling, or extension preservation changes, run `dist/tests/library.test.js` after `npm run build`.
- Run `npm run build` and `npm test` before completion for meaningful bridge behavior changes.
- Update both README files, `rules/file-storage.md`, and `memory/CONTEXT.md` when user-facing commands, setup, runtime mode, attachment behavior, data paths, or operator recovery steps change.
