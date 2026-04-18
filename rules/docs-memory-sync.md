# Docs And Memory Sync Rules

Use when touching README files, docs, memory files, commands, paths, config keys, environment variables, ports, runtime locations, or operator entrypoints.

## Sync Rules

- Keep `README.md` and `README_zh.md` aligned with real operator behavior when setup, commands, runtime modes, or user-facing bridge behavior change.
- Update `memory/CONTEXT.md` when reusable commands, important paths, runtime locations, configs, known risks, project status, or near-term direction change.
- Keep `SESSION-STATE.md` current when the active task, immediate next step, or blocker state changes.
- Append to `memory/YYYY-MM-DD.md` for meaningful starts, major findings, implementation milestones, validations, blockers, recoveries, and handoffs.
- Use `memory/learning-inbox.md` for candidate lessons before promoting them to durable memory or rules.
- Treat the memory-layer Markdown set as an explicitly encoded corpus: `AGENTS.md`, `USER.md`, `soul.md`, root `SESSION-STATE.md` / `MEMORY.md`, `memory/*.md`, and `rules/*.md` must stay in `UTF-8` without BOM.
- When reading or writing memory-layer Markdown from scripts or shell commands, use tools or APIs that explicitly specify UTF-8 instead of relying on host-default encoding behavior.

## Markdown Write Matrix

Use this matrix before replying, switching tasks, or ending a substantial session.

| Event | Required write |
| --- | --- |
| User correction, explicit decision, changed goal, changed next step, blocker appears/clears | Rewrite `SESSION-STATE.md` |
| Meaningful task starts | Append `memory/YYYY-MM-DD.md` |
| Major investigation, implementation milestone, validation, failure, recovery, or handoff | Append `memory/YYYY-MM-DD.md` |
| New insight may become a rule but is not yet proven durable | Add to `memory/learning-inbox.md` |
| Commands, important paths, runtime locations, configs, known risks, project status, rule/agent structure, or near-term direction change | Update `memory/CONTEXT.md` |
| Stable project fact, lasting decision, long-lived rule, or durable preference changes | Update `MEMORY.md` |
| Stable path-specific rule emerges for a system area | Update the matching `rules/*.md` |
| Operator-facing setup, commands, behavior, recovery, env vars, ports, or paths change | Update README/docs and `memory/CONTEXT.md` |
| Workflow proves reusable across repositories | Promote to a reusable skill after capturing the local lesson |

## Closed-Loop Guardrails

- If a file was read because it affects the task and the task changes that information, update that file before finishing.
- If a lesson is not ready for `MEMORY.md`, do not drop it; put it in `memory/learning-inbox.md`.
- If `memory/CONTEXT.md` changes, check whether `AGENTS.md` or `rules/index.md` also needs a pointer update.
- If a path rule changes, check whether `rules/index.md` still routes to it correctly.
- If README changes are required, update English and Chinese docs together unless one document is intentionally not applicable.
- Never use chat history as the only storage for a decision that future sessions must know.
- If terminal output or `Get-Content` looks garbled, first check whether the file bytes are valid UTF-8 before rewriting the file.
- Do not bulk-rewrite memory-layer files just because the terminal display is wrong; confirm whether the issue is display decoding, not file corruption.

## Encoding Audit Workflow

- Use `npm run audit:memory-encoding` to scan only the repository memory layer.
- The audit must report file path, detected encoding, BOM presence, NUL-byte presence, UTF-8 validity, and overall counts.
- Treat any `UTF-8 BOM`, `UTF-16`, `Non-UTF8/legacy`, NUL-byte, or invalid UTF-8 result as an anomaly that needs targeted correction.

## Promotion Rules

- Daily log: chronological facts and work history.
- `memory/learning-inbox.md`: candidate lessons that may be reused.
- `rules/`: durable path-specific operating rules.
- `MEMORY.md`: durable facts, project decisions, and long-lived rules.
- Reusable skill: only when the workflow clearly applies across repositories.

## Secret Handling

- Never print, commit, or copy `.env`, `.env.local`, tokens, cookies, passwords, or live credentials into docs, memory, or chat.
- Refer to credential locations and environment variable names without storing raw values.
