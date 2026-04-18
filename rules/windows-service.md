# Windows Runtime Rules

Use when touching `src/service.ts`, `scripts/*.ps1`, daemon locks, pid files, background hosting, Windows service behavior, Scheduled Tasks, startup, logs, or recovery operations.

## Invariants

- The recommended persistent mode on Windows is the per-user logon Scheduled Task plus detached background daemon, not the SCM Windows service path.
- Optional WinSW service mode may remain available, but do not make it the default operator path without an explicit decision.
- Do not start the detached daemon directly from an elevated PowerShell session when switching to logon autostart; use the registered Scheduled Task path.
- Keep singleton behavior centered on the active runtime lock and pid metadata so duplicate bridge daemons are visible and recoverable.
- When changing service behavior, preserve clear `status`, `start`, `stop`, `restart`, and `logs` operator flows.

## Verification

- After service or PowerShell changes, run `npm run build` and the matching service/daemon tests.
- When operator commands or recovery steps change, update README files and `memory/CONTEXT.md` in the same task.
- Record known operational caveats in `memory/learning-inbox.md` first, then promote only durable recovery rules to `MEMORY.md`.
