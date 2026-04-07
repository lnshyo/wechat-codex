# Repository Memory For Codex

Read this file at the start of every new session before making changes.

## Project Identity

- Project name: `wechat-codex`
- Purpose: bridge personal WeChat directly to the local logged-in `codex.exe`
- No OpenClaw dependency
- No `OPENAI_API_KEY` requirement when local Codex is already authenticated

## Current Architecture

- `src/main.ts`: main runtime flow
  - receive WeChat message
  - start typing or generating state
  - call local Codex
  - send final reply
- `src/codex/provider.ts`: event-style `codex.exe` runner
- `src/wechat/`: WeChat API, login, media, monitor, sending
- `src/session.ts`: minimal per-contact routing state

## Important Product Decisions

- Each WeChat contact maps to an isolated Codex thread
- Normal WeChat messages go directly to Codex
- The bridge no longer depends on WeChat slash commands for primary usage
- Prefer native WeChat typing status
- Fall back to WeChat `GENERATING` state if typing is unavailable
- Keep the default Codex model behavior at `gpt-5.4` with `medium` reasoning unless the user asks otherwise

## Startup Read Order

Read these files in order before doing meaningful work:

1. `AGENTS.md`
2. `USER.md` if it exists
3. `soul.md` if it exists
4. `SESSION-STATE.md`
5. `memory/YYYY-MM-DD.md` for today if it exists
6. `memory/YYYY-MM-DD.md` for yesterday only if today is empty or missing, or the last task clearly continues
7. `MEMORY.md`
8. `memory/CONTEXT.md`
9. `README.md` and `README_zh.md` when behavior or operator-facing docs may need updates

## Working Rules

- Keep README files aligned with the real runtime behavior
- Prefer minimal local state; Codex thread state should remain per contact
- Keep root and project memory files in sync with meaningful behavior changes rather than letting them drift
- Follow the session-opening behavior defined by `soul.md` so fresh sessions begin with a short greeting and self-introduction
- Do not reintroduce outdated WeChat command documentation unless that functionality is restored

## Validation

Run these before finishing meaningful changes:

```bash
npm run build
npm test
```
