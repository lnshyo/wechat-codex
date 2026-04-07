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
- `wechat-codex-direct/`: installable standard Codex skill folder

## Important Product Decisions

- Each WeChat contact maps to an isolated Codex thread
- Normal WeChat messages go directly to Codex
- The bridge no longer depends on WeChat slash commands for primary usage
- Prefer native WeChat typing status
- Fall back to WeChat `GENERATING` state if typing is unavailable
- Keep the default Codex model behavior at `gpt-5.4` with `medium` reasoning unless the user asks otherwise

## Memory System For This Repo

This repository now follows the `portable-memory-system` workflow.

Repository-wide working memory lives at the repository root:

- `SESSION-STATE.md`: current run RAM
- `MEMORY.md`: durable facts, rules, decisions, and preferences
- `USER.md`: user identity, preferences, recurring context, and collaboration defaults
- `soul.md`: assistant identity, role definition, and collaboration style

Project-local memory stays under the repository `memory/` directory:

- `memory/CONTEXT.md`: quick project entry point
- `memory/MEMORY.md`: detailed project trail, debugging notes, and implementation history
- `memory/YYYY-MM-DD.md`: append-only daily work log

### Startup Read Order

Read these files in order before doing meaningful work:

1. `AGENTS.md`
2. `USER.md` if it exists
3. `soul.md` if it exists
4. `SESSION-STATE.md`
5. `memory/YYYY-MM-DD.md` for today if it exists
6. `memory/YYYY-MM-DD.md` for yesterday only if today is empty or missing, or the last task clearly continues
7. `MEMORY.md`
8. `memory/workspace-structure.md` when cross-repository context, portfolio tracking, or other project folders are relevant
9. `memory/CONTEXT.md`
10. `memory/MEMORY.md` only when the task is being resumed, debug history matters, or the current issue is unclear
11. `memory/publish-checklist.md` when release, packaging, or publishing work is relevant
12. `README.md` and `README_zh.md` when behavior or operator-facing docs may need updates

### Personal Alignment

- Treat `USER.md` as the source of truth for who the human is, how they prefer to be addressed, what defaults they want, and what personal context should shape assistance.
- Treat `soul.md` as the source of truth for who the assistant is in this repository, including role, tone, scope, and collaboration style.
- Reading these files is not a passive check. Apply them to tone, initiative level, prioritization, and the kind of help you provide throughout the session.
- `USER.md` answers "who you are helping"; `soul.md` answers "who you are while helping."
- If the latest direct user instruction conflicts with either file, follow the latest direct user instruction and treat the files as needing an update later.

### Session Opening Behavior

- At the start of a fresh session, before the first substantive reply, proactively greet the user and give a short self-introduction.
- Keep the opening brief and natural: say who you are, how you will help, and align with the role defined in `soul.md`.
- Let `soul.md` define the natural conversational form of the assistant's name, self-reference, and tone instead of patching those details ad hoc in other files.
- Do this once per fresh session, not before every subsequent reply.
- If the user opens with an urgent task, keep the greeting extra short and transition immediately into helping.

### Session Lifecycle

At session start:

1. Read `AGENTS.md`
2. Read `USER.md` if it exists
3. Read `soul.md` if it exists
4. Read `SESSION-STATE.md`
5. Read today's `memory/YYYY-MM-DD.md` if it exists
6. Read yesterday's daily log only if today is empty or the last task clearly continues
7. Read `MEMORY.md`
8. Read `memory/workspace-structure.md` when cross-repository context or portfolio tracking is relevant
9. Read `memory/CONTEXT.md`
10. Read `memory/MEMORY.md` only when the task is being resumed, debug history matters, or the current issue is unclear

Before ending a substantial session:

1. Append a short handoff note to `memory/YYYY-MM-DD.md`
2. Update `SESSION-STATE.md` with current status, latest completed work, and the exact next step
3. Promote any newly durable rule or decision to `MEMORY.md` if needed
4. Update `memory/CONTEXT.md` only if project status, structure, commands, or near-term direction changed

### Write Order

When an event triggers memory updates, write in this order:

1. If current execution state changed, update `SESSION-STATE.md` first
2. If the event created same-day history worth replaying, append to `memory/YYYY-MM-DD.md`
3. If the event changed a durable rule, product fact, or lasting decision, promote it to `MEMORY.md`
4. If the event changed project status, structure, commands, or near-term direction, update `memory/CONTEXT.md`

### File-Specific Write Rules

#### `SESSION-STATE.md`

Must be updated:

- before replying after a user correction, explicit decision, or concrete value that changes the work
- when the active task changes
- when the immediate next step changes
- when a blocker appears or is cleared
- before any risky or long-running operation
- before switching to a different task
- before ending a substantial session

Keep it short and rewrite it as current-run RAM. Do not use it as an append-only diary.

#### `memory/YYYY-MM-DD.md`

Must be appended:

- when meaningful work starts on a task for the day
- after a major implementation step, investigation result, or decision
- after important validation such as build, test, or other checks
- when a failure path, blocker, rollback, or recovery happens
- before ending a substantial session
- before switching away from unfinished work if the context would be hard to reconstruct later

Keep it detailed and append-only. Include timestamps, actions, key commands or results, failures, resolutions, and handoff notes.

#### `MEMORY.md`

Write only durable rules, policies, facts, and lasting decisions that should still matter in later sessions.

#### `memory/CONTEXT.md`

Update only when project status, important structure, operator commands, known risks, or near-term direction truly changed.

#### `memory/MEMORY.md`

Append detailed project-local reasoning, debugging trails, failed attempts, command context, and implementation history when deeper history will help future work.

### File Responsibilities

- `SESSION-STATE.md`: current task, latest completed step, active blocker, and exact next step
- `MEMORY.md`: curated long-term memory for durable facts, rules, and decisions
- `USER.md`: user profile, preferences, recurring personal context, and collaboration defaults
- `soul.md`: assistant persona, role boundaries, tone, and north-star behavior
- `memory/workspace-structure.md`: workspace-level map of tracked projects, their memory locations, high-level summaries, and resume entrypoints
- `memory/CONTEXT.md`: current project status, important structure and configuration, operator commands, and near-term direction
- `memory/MEMORY.md`: full project-local trail for detailed reasoning, debugging, commands, and implementation history
- `memory/YYYY-MM-DD.md`: append-only timestamped daily log for actions, validations, failures, resolutions, and handoffs
- `memory/SESSION-STATE.md`: compatibility pointer for older references; do not use it as the primary session file

## Repo Docs To Read First

1. `USER.md` if it exists
2. `soul.md` if it exists
3. `memory/workspace-structure.md` when cross-repository context matters
4. `memory/CONTEXT.md`
5. `MEMORY.md`
6. `memory/MEMORY.md` when project history matters
7. `README.md`
8. `README_zh.md`
9. `memory/publish-checklist.md` when publishing-related

## Working Rules

- Keep README files aligned with the real runtime behavior
- Update `wechat-codex-direct/` when the installation or operation workflow changes
- Do not reintroduce outdated WeChat command documentation unless that functionality is restored
- Prefer minimal local state; Codex thread state should remain per contact
- Keep root and project memory files in sync with meaningful behavior changes rather than letting them drift
- Keep `memory/workspace-structure.md` updated when the active repository set or cross-repo priorities change
- Treat `memory/workspace-structure.md` as a high-level project card index, not as a copy of other repositories' memory
- When refreshing the project overview, use only allowed high-level sources such as `README`, `AGENTS.md`, top-level structure, and obvious run entrypoints
- Do not read another project's `memory/` unless the user has clearly switched work into that project
- After substantive work in another project, write back only a short high-level progress update to `memory/workspace-structure.md`
- Keep `USER.md` and `soul.md` aligned with the real user preferences and intended assistant role when those change
- Follow the session-opening behavior in this file so fresh sessions begin with a short greeting and self-introduction

## Validation

Run these before finishing meaningful changes:

```bash
npm run build
npm test
```

If the change touches the skill folder, also validate:

```bash
python C:\Users\lin_s\.codex\skills\.system\skill-creator\scripts\quick_validate.py E:\claude\CODEXclaw\wechat-codex-direct
```
