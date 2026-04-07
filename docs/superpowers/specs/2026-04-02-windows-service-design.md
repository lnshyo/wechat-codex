# Windows Service Design

Date: 2026-04-02

## Goal

Run `wechat-codex` as a real Windows service that survives reboot, while keeping the current daemon logic unchanged.

## Recommended approach

Use WinSW as the service wrapper.

Why:

- it is designed to host long-running console applications as Windows services
- it avoids rewriting the daemon into a native service host
- routine code updates only require rebuild plus service restart, not reinstall

## Behavior

- keep `runDaemon()` as the actual bridge worker
- add service lifecycle commands under `node dist/main.js service ...`
- support:
  - `install`
  - `uninstall`
  - `start`
  - `stop`
  - `restart`
  - `status`
  - `logs`
- keep the existing detached-process background mode for compatibility, but make Windows service the preferred persistent mode

## Installation flow

1. Ensure the project is built and `dist/main.js` exists.
2. Prepare a service home under `~/.wechat-codex/windows-service/`.
3. Download a pinned WinSW executable into that directory if it is missing.
4. Generate the WinSW XML config beside the executable.
5. Register the service with a stable service name: `wechat-codex`.

## Runtime model

- WinSW launches `node dist/main.js start`
- working directory is the repository root
- service logs go into the existing data area
- bridge runtime and WeChat logic remain unchanged

## Updating after install

- normal code change flow stays the same:
  1. edit code
  2. `npm run build`
  3. `npm run service -- restart`
- reinstall is only needed if the wrapper config, service name, or runtime path contract changes

## Testing

- unit test XML/config rendering and helper path generation
- unit test service command routing where possible
- run:
  - `npm run build`
  - `npm test`
