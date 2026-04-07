# Windows Local Deployment Notes

## Purpose

The files in this directory are local Windows deployment helpers for one managed workstation profile. They are intentionally separate from the generic bridge source code in `src/`.

These scripts may contain:

- local alias paths
- scheduled task names
- local log directory names
- workstation-specific Codex executable paths

That is expected. They should be treated as deployment wrappers, not as the source of truth for the bridge architecture.

## Files

- `codex-wechat-common.ps1`
  - shared local deployment config and helper functions
- `start-codex-wechat-silent.ps1`
  - start hidden bridge + hidden Codex companion
- `stop-codex-wechat-silent.ps1`
  - stop the managed background processes
- `install-codex-wechat-autostart.ps1`
  - install a Windows Scheduled Task for logon startup
- `bind-current-codex-thread.ps1`
  - bind the current visible Codex panel thread as the WeChat main thread

## About AGTK-Like Names

If you see names such as `AGTK` in these scripts, read them as local deployment labels for the current machine profile rather than core product names.

Examples include:

- local workspace alias names
- autostart log folder names
- scheduled task labels

The generic, reusable bridge logic lives under:

- `src/bridge`
- `src/companion`
- `src/wechat`

## Recommended Use

Use these scripts when you want a managed Windows workflow for the current workstation.

Typical flow:

1. `install-codex-wechat-autostart.ps1`
   - installs the logon task
2. `start-codex-wechat-silent.ps1`
   - starts the background services immediately
3. `bind-current-codex-thread.ps1`
   - binds the currently visible Codex thread to WeChat

## Customizing for Another Machine

If you copy this repo to a different workstation, review `codex-wechat-common.ps1` first and update the local deployment values before relying on the scheduled task or the background scripts.
