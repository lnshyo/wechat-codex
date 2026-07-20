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
9. `rules/index.md`, then only the rule files relevant to the files or systems you will touch
10. `README.md` and `README_zh.md` when behavior or operator-facing docs may need updates

`memory/MEMORY.md` (the detailed project-local trail) is not part of the startup read order; read it on demand when a task needs implementation or debugging history.

## Git Worktree Sessions

The memory-layer files (`USER.md`, `soul.md`, `SESSION-STATE.md`, `MEMORY.md`, `memory/`) are untracked and exist only in the main checkout. Linked git worktrees (for example under `.claude/worktrees/`) do not contain them.

When the working directory is a linked worktree:

1. Resolve the main checkout root: it is the parent directory of `git rev-parse --path-format=absolute --git-common-dir`. Bridge preload code must use the shared `resolveMemoryRoot` helper rather than reimplementing this rule.
2. Read and write all memory-layer files at the main checkout root, not inside the worktree.
3. Tracked files (source, `rules/`, `AGENTS.md`, docs) are still edited inside the worktree as usual.

Never skip the startup read order or the write matrix just because the worktree lacks the memory files.

## Session Lifecycle

- Session open: follow the Startup Read Order above, then greet briefly per `soul.md` before the first substantive reply.
- During work: apply the Markdown write matrix below whenever a trigger fires, not only at session end.
- Session close or task switch: rewrite `SESSION-STATE.md` with current status, latest completed work, and the exact next step, and append a handoff entry to `memory/YYYY-MM-DD.md` for substantial sessions.

## Self-Evolving Repository Layers

This repository uses the standard self-evolving repository pattern:

- Cognitive core: `AGENTS.md`, `USER.md`, and `soul.md`
- Path rules: `rules/`
- Role boundaries: `.codex/agents/`
- Memory loop: `SESSION-STATE.md`, `memory/YYYY-MM-DD.md`, `memory/MEMORY.md`, `memory/learning-inbox.md`, `memory/CONTEXT.md`, and `MEMORY.md`
- Auxiliary memory docs: `memory/workspace-structure.md` (cross-repo portfolio map) and `memory/publish-checklist.md` (publishing flow)

Use `memory/learning-inbox.md` for candidate lessons before promoting them. Do not put every correction directly into `MEMORY.md`.

## Markdown Write Rules

The memory loop is only valid when the Markdown files are actively maintained. Reading memory without writing back creates drift.

Memory-layer Markdown files are strong-constraint text assets. Keep `AGENTS.md`, `USER.md`, `soul.md`, root `SESSION-STATE.md` / `MEMORY.md`, `memory/*.md`, and `rules/*.md` in `UTF-8` without BOM. Do not mix `UTF-8 BOM`, `UTF-16`, or system-default ANSI/GBK encodings into that layer.

Write in this order when multiple files are affected:

1. `SESSION-STATE.md`
2. `memory/YYYY-MM-DD.md`
3. `memory/MEMORY.md`
4. `memory/learning-inbox.md`
5. `memory/CONTEXT.md`
6. `MEMORY.md`
7. `rules/*.md`
8. README or other operator docs
9. reusable skills

File-specific triggers:

- `SESSION-STATE.md`: rewrite when the active task, goal, latest completed step, blocker, or exact next step changes; update it before replying after a user correction or decision that changes the work.
- `memory/YYYY-MM-DD.md`: append when meaningful work starts, an investigation or implementation milestone completes, validation runs, a blocker appears or clears, a recovery happens, or a substantial session is ending.
- `memory/MEMORY.md`: append detailed implementation notes, debugging trails, and why-a-change-was-made narratives that are too long for the daily log headline but too project-specific for root `MEMORY.md`.
- `memory/learning-inbox.md`: add candidate lessons when a correction, repeated mistake, workflow insight, or repo-upgrade experience may become a rule, doc update, or reusable skill but is not yet proven durable. Whenever this file is opened, adjudicate every candidate older than 30 days: promote it, archive it with a reason, or reject it — do not leave it pending.
- `memory/CONTEXT.md`: update when project status, reusable commands, important paths, runtime locations, configs, known risks, role/rule structure, or near-term direction changes.
- `memory/workspace-structure.md`: update when repositories or project folders are added, removed, or change status enough that the high-level project cards are stale.
- `memory/publish-checklist.md`: update when the publishing or release flow for this repository changes.
- `MEMORY.md`: update only for durable facts, project decisions, long-lived rules, or stable user/project preferences that should survive future sessions.
- `rules/*.md`: update when a lesson becomes a stable path-specific operating rule for a code area, runtime area, verification flow, or documentation/memory flow.
- `README.md` and `README_zh.md`: update when setup, commands, runtime behavior, user-facing bridge behavior, operator recovery, paths, ports, or environment expectations change.
- reusable skills: update only after the workflow has proven useful beyond this repository.

Do not put the same content everywhere. Use the narrowest durable home and link the layers through short references.

If terminal output looks garbled, do not assume the file is corrupted. Verify the raw file bytes or re-read the file with an explicit UTF-8 tool before rewriting it.

## Path Rule Loading

Read `rules/index.md` first, then load only the rule files that match the touched scope:

- `src/codex/**`: `rules/codex-runtime.md`
- `src/wechat/**`, `src/main.ts`, `src/session.ts`: `rules/wechat-bridge.md`
- `src/service.ts`, `scripts/*.ps1`, Windows startup/runtime changes: `rules/windows-service.md`
- tests, build, or verification changes: `rules/testing.md`
- README, docs, memory, config, commands, paths, ports, or operator entrypoints: `rules/docs-memory-sync.md`
- downloaded, received, generated, archived, or WeChat-transferred files: `rules/file-storage.md`
- reusable workflow, skill extraction, or cross-repository standardization: `rules/skill-evolution.md`

## Working Rules

- Keep README files aligned with the real runtime behavior
- Treat the system Downloads folder as temporary intake; classify repository work and WeChat-transferred files according to `rules/file-storage.md` before choosing a durable location
- Prefer minimal local state; Codex thread state should remain per contact
- Keep root and project memory files in sync with meaningful behavior changes rather than letting them drift
- Follow the session-opening behavior defined by `soul.md` so fresh sessions begin with a short greeting and self-introduction
- Do not reintroduce outdated WeChat command documentation unless that functionality is restored
- Promote lessons in this order: daily log -> `memory/learning-inbox.md` -> `rules/` or `MEMORY.md` -> reusable skill only when the pattern clearly generalizes across repositories

## Validation

Run these before finishing meaningful changes:

```bash
npm run build
npm test
```

When the change touched any memory-layer Markdown file, also run:

```bash
npm run audit:memory-encoding
```

The audit checks encoding hygiene, warns when startup-preload usage reaches 80%, and fails when a file or the total exceeds the fresh-session snapshot budget.
