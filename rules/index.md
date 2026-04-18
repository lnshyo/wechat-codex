# Path Rules Index

Read this file after the startup memory files. Load only the rule files that match the current task.

## Rule Map

- `rules/codex-runtime.md`: local Codex execution, transcript sync, companion selection, workspace path handling, or Codex CLI behavior.
- `rules/wechat-bridge.md`: WeChat message routing, sending, login, media handling, queueing, per-contact sessions, typing/generating state, or gateway rendering.
- `rules/windows-service.md`: background daemon, Windows service, Scheduled Task, PowerShell scripts, lock files, pid files, startup, logs, or recovery operations.
- `rules/testing.md`: tests, build commands, verification scope, CI, coverage expectations, or test fixtures.
- `rules/docs-memory-sync.md`: README files, docs, commands, paths, env vars, ports, operator entrypoints, memory files, or project status.
- `rules/skill-evolution.md`: reusable skills, cross-repository workflow extraction, learning promotion, or standardization across repositories.

## Loading Rule

Prefer the narrowest matching rule file. If a task touches multiple systems, load each relevant rule file before edits.
