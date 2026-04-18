# wechat-codex

[![CI](https://github.com/lnshyo/wechat-codex/actions/workflows/ci.yml/badge.svg)](https://github.com/lnshyo/wechat-codex/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Bridge a personal WeChat account directly to the local Codex CLI already logged in on the same machine.

`wechat-codex` is a direct WeChat-to-Codex bridge. It does not depend on OpenClaw and does not require `OPENAI_API_KEY` when local Codex is already authenticated.

## Why This Exists

- Chat with local Codex from WeChat without adding a separate cloud relay
- Keep one isolated Codex thread per WeChat contact
- Let Codex answer normal text messages directly, while still exposing lightweight slash commands for control
- Support both foreground running and persistent background hosting on Windows

## Features

- Direct text-to-Codex routing from personal WeChat
- Per-contact thread isolation and FIFO task queueing
- WeChat image input forwarding
- Native WeChat typing state with `GENERATING` fallback
- Local `/sync` mode that mirrors replies from the latest matching Codex Desktop session
- Local token usage estimation and chat health/status commands
- Windows-friendly background hosting with recommended logon autostart

## WeChat Commands

The bridge handles these commands locally:

- `/new` resets the current contact's saved Codex thread, queue, and token ledger
- `/sync` attaches the current contact to the latest local Codex Desktop session for the configured working directory
- `/unsync` detaches the current contact from local Codex sync while keeping the saved thread id
- `/status` shows the current chat session state
- `/token` shows the current chat token budget summary using local estimates
- `/task` shows the active task and queued tasks for the current chat
- `/stop` aborts the active task and clears queued work for the current chat
- `/health` shows bridge, service, and Codex executable health

Unknown slash commands still go through to Codex as normal chat input.

## Requirements

- Node.js 22+
- A personal WeChat account that can complete QR binding
- A working local Codex CLI login on the same machine

Recommended check:

```bash
codex login status
```

Default Codex executable path used by setup:

```text
C:\Users\<you>\.codex\.sandbox-bin\codex.exe
```

## Quick Start

Install and build:

```bash
npm install
npm run build
```

Run first-time setup:

```bash
npm run setup
```

Setup will:

1. Open or print a WeChat QR code
2. Wait for QR confirmation
3. Ask for the default working directory
4. Save local state under `~/.wechat-codex/`

Default data directory:

```text
~/.wechat-codex/
```

On Windows this is usually:

```text
C:\Users\<you>\.wechat-codex\
```

## Run

Foreground:

```bash
npm start
```

Background service:

```bash
npm run service -- start
```

Switch Windows to the recommended logon-autostart mode:

```bash
npm run switch-to-logon-autostart
```

This removes the WinSW Windows service, registers a per-user Scheduled Task named `wechat-codex-logon`, and starts that Scheduled Task immediately so the bridge comes up through the normal user-task path.

The scheduled task now starts the bridge silently through a hidden PowerShell launcher. You should no longer need to keep a visible `CMD` window open after login, and closing a console window is no longer part of the normal runtime path.

Optional Windows service install:

```bash
npm run service -- install
```

Other useful service commands:

```bash
npm run service -- status
npm run service -- restart
npm run service -- stop
npm run service -- uninstall
npm run logs
```

For silent-mode troubleshooting, use `npm run service -- status` and `npm run logs` instead of relying on a visible console window.

## Optional Config

`config.env` also supports:

```text
sessionTokenBudget=120000
sessionReplyReserveTokens=4096
maxQueuedTasksPerPeer=5
```

These values control estimated remaining context budget and the per-contact queue limit.

## How It Works

- Normal WeChat text messages become Codex tasks
- Busy chats queue new work automatically
- Image messages are downloaded immediately and forwarded when their turn runs
- Each WeChat contact gets an isolated Codex conversation and local session state
- `/sync` can bind a chat to the latest local interactive Codex Desktop session for the configured working directory
- When a chat is attached, the bridge mirrors only fresh assistant replies created after the bind point
- WeChat-triggered Codex sessions run with full local access and no approval prompts
- Fresh Codex threads inject a bootstrap instruction that tells Codex to read `AGENTS.md` first and then follow its startup read order before replying

## Development

Build:

```bash
npm run build
```

Test:

```bash
npm test
```

Project layout:

- `src/main.ts`: WeChat receive loop, command handling, queueing, typing, and Codex execution
- `src/gateway/`: command routing, token estimation, and runtime state
- `src/codex/`: local `codex.exe` execution, transcript sync, and companion discovery
- `src/wechat/`: WeChat API, login, media, polling, and sending
- `src/tests/`: source-level test coverage for the bridge runtime

## Verify After Setup

After setup, verify all of the following:

1. `npm run service -- status` reports the bridge is running
   On Windows, the recommended steady state is `background`, not `windows-service`
2. A WeChat text message quickly shows typing or generating state
3. A final reply arrives from Codex
4. Two different WeChat contacts do not share context
5. A queued task can be inspected with `/task`
6. `/token` returns an estimated token summary for the current chat
7. An image sent from WeChat can be analyzed by Codex
8. After sending `/sync` from WeChat, the bridge reports the attached local Codex session source and title, then mirrors only subsequent local assistant replies back to that chat

## Troubleshooting

- If WeChat does not receive replies, check `codex login status`, `npm run service -- status`, and `npm run logs`
- If typing does not appear, the bridge should fall back to `GENERATING`; inspect logs for `getconfig` or `sendtyping` failures
- If the active queue fills up, clear it with `/stop`
- If a resumed Codex thread fails, the bridge starts a new thread and resets the local token ledger for that contact
- If `/sync` cannot find a local Codex session, open the target Codex Desktop conversation in the same configured working directory first
- If `/sync` binds the wrong thread, resend `/sync` after bringing the desired Codex Desktop thread to the front
- `/sync` intentionally drops historical transcript content; older content should be viewed in Codex Desktop instead of WeChat

## Chinese Documentation

See [README_zh.md](./README_zh.md).
