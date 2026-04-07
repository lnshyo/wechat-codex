# CLI WeChat Bridge

CLI WeChat Bridge bridges WeChat messages with local CLI agents such as Codex, Claude Code, OpenCode, and a persistent PowerShell session. The local CLI remains the primary workspace; WeChat acts as a remote entry point for sending requests, receiving final replies, and checking execution status.

This repository now focuses on a clean separation between:

- generic bridge source code under `src/`
- test coverage under `test/`
- user-facing docs under `docs/`
- local Windows deployment helpers under `scripts/windows/`
- temporary local scratch files, which are intentionally ignored

## Current Focus

The most actively maintained path in this repo is the Codex + WeChat workflow:

- WeChat messages can be forwarded into the bound Codex thread
- final Codex replies can flow back to WeChat
- bound vs. temporary thread routing is supported
- safe desktop thread sync avoids injecting text into GUI inputs
- the current visible Codex panel thread can be rebound directly with a dedicated command

Claude, OpenCode, and shell adapters remain in the repo and continue to share the same bridge foundations.

## Repository Layout

- `bin/`
  - global CLI entrypoints such as `wechat-bridge-codex`, `wechat-codex`, and `wechat-codex-bind`
- `src/bridge/`
  - bridge lifecycle, routing, adapter integration, state persistence, and Codex desktop sync
- `src/companion/`
  - local companion and panel-side entrypoints used by visible local sessions
- `src/wechat/`
  - WeChat login, channel setup, and iLink transport
- `src/commands/`
  - auxiliary CLI commands such as update checks
- `scripts/windows/`
  - local Windows helper scripts for silent startup, scheduled-task installation, and binding the current visible Codex thread
- `test/`
  - bridge, companion, and WeChat transport tests
- `docs/`
  - release notes, screenshots, and detailed documentation

## Quick Start

### Install dependencies

```bash
bun install
```

### Bind WeChat credentials

```bash
bun run setup
```

### Start the Codex bridge

```bash
bun run bridge:codex
```

### Open the visible Codex companion

```bash
bun run codex:panel
```

### Bind the current visible Codex thread as the WeChat main thread

```bash
bun run codex:bind-current
```

On Windows, you can also use:

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\windows\bind-current-codex-thread.ps1"
```

## Detailed Documentation

- [Detailed Chinese guide](docs/CODEX-WECHAT-BRIDGE_CN.md)
- [Windows local deployment notes](scripts/windows/README.md)
- [Test layout](test/README.md)
- [Release notes index](docs/releases/README.md)

## Runtime Data

By default, runtime state lives under:

```text
~/.claude/channels/wechat
```

Important files include:

- `account.json`
- `context_tokens.json`
- `bridge.log`
- `workspaces/<workspace-key>/bridge-state.json`
- `workspaces/<workspace-key>/codex-panel-endpoint.json`

The Windows helper scripts in `scripts/windows/` are local deployment wrappers for one workstation profile. They are intentionally documented separately because they may contain machine-specific aliases, scheduled-task names, and log directories.

## Development

Run the full suite:

```bash
bun test
```

Useful subsets:

```bash
bun test test/bridge
bun test test/companion
bun test test/wechat
```

## License

[MIT](LICENSE.txt)
