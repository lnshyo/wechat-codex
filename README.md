# wechat-codex

Connect a personal WeChat account to the local Codex CLI that is already logged in on the same machine.

This project is a direct WeChat-to-Codex bridge. It does not depend on OpenClaw and does not require `OPENAI_API_KEY` if local Codex is already authenticated.

## What It Does

- Receive personal WeChat messages and send them to local `codex.exe`
- Keep one Codex thread per WeChat contact
- Queue multiple tasks per contact with FIFO execution
- Support image input from WeChat
- Expose a lightweight gateway-style control surface directly in WeChat
- Prefer native WeChat typing status when available
- Fall back to WeChat `GENERATING` state when typing is unavailable
- Run in the foreground or as a detached background process
- On Windows, prefer per-user logon autostart over SCM Windows service hosting

## WeChat Commands

The bridge handles these exact slash commands locally:

- `/new` resets the current contact's saved Codex thread, queue, and token ledger
- `/sync` attaches the current contact to the latest local Codex Desktop companion session for the configured working directory, with transcript fallback, and starts syncing from the current transcript end without replaying history
- `/unsync` detaches the current contact from the attached local Codex session while keeping the saved thread id
- `/status` shows the current chat session state
- `/token` shows the current chat token budget summary using local estimates
- `/task` shows the active task and queued tasks for the current chat
- `/stop` aborts the active task and clears queued work for the current chat
- `/health` shows bridge, service, and Codex executable health

Unknown slash commands still go through to Codex as normal chat input.

## Current Behavior

- Normal text messages become Codex tasks
- If a chat is already busy, new messages are queued automatically
- Image messages are downloaded immediately and forwarded to Codex later if queued
- Each WeChat contact gets an isolated Codex conversation and task queue
- A chat can optionally attach to the latest local interactive Codex Desktop session for the configured working directory via `/sync`
- When a chat is attached, the bridge tails the local Codex transcript and mirrors only new assistant replies generated after the bind point
- `/sync` now prefers Codex Desktop `threads` state as the local companion authority and falls back to transcript discovery only when no matching desktop thread is found
- WeChat-triggered Codex sessions run with full local access and no approval prompts, equivalent to `--dangerously-bypass-approvals-and-sandbox`
- The first task in a fresh Codex thread, including the first message after `/new`, injects a bootstrap instruction that tells Codex to read `AGENTS.md` first and then follow its startup read order before replying
- Token usage is tracked locally with conservative estimates, including estimated remaining context budget
- The bridge stores per-contact routing state and token ledger data locally

## Requirements

- Node.js 18+
- A personal WeChat account that can complete QR binding
- A working local Codex CLI login on this machine

Recommended check:

```bash
codex login status
```

Default Codex executable path used by setup:

```text
C:\Users\<you>\.codex\.sandbox-bin\codex.exe
```

## Install

```bash
npm install
npm run build
```

## First-Time Setup

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

## Optional Config

`config.env` also supports:

```text
sessionTokenBudget=120000
sessionReplyReserveTokens=4096
maxQueuedTasksPerPeer=5
```

These values control the estimated remaining context budget and the per-contact queue limit.

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

This removes the WinSW Windows service, registers a per-user Scheduled Task named `wechat-codex-logon`, and starts the old detached background mode immediately.

Optional Windows service install:

```bash
npm run service -- install
```

Status:

```bash
npm run service -- status
```

Restart:

```bash
npm run service -- restart
```

Stop:

```bash
npm run service -- stop
```

Uninstall the Windows service:

```bash
npm run service -- uninstall
```

Logs:

```bash
npm run logs
```

## Verify

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

## Project Layout

- `src/main.ts`: WeChat receive, queue, command handling, typing, and Codex execution
- `src/gateway/`: lightweight gateway runtime, commands, token estimation, and renderers
- `src/codex/provider.ts`: local `codex.exe` runner
- `src/wechat/`: WeChat API, login, media, monitor, send logic
- `src/session.ts`: per-contact session persistence and token ledger state

## Troubleshooting

- If WeChat does not receive replies, check `codex login status`, `npm run service -- status`, and `npm run logs`
- If typing does not appear, the bridge should fall back to `GENERATING`; inspect logs for `getconfig` or `sendtyping` failures
- If the active queue fills up, the bridge will reject new work until you clear it with `/stop`
- If a resumed Codex thread fails, the bridge starts a new thread and resets the local token ledger for that contact
- If `/sync` cannot find a local Codex session, make sure the Codex Desktop conversation you want is already open in the same configured working directory
- If `/sync` binds the wrong thread, resend `/sync` after bringing the desired Codex Desktop thread to the front; the bridge now prefers the latest matching desktop thread and only falls back to transcript scan if no desktop thread matches
- `/sync` intentionally drops all transcript history and starts from the current tail; if you need earlier content, view it in Codex Desktop instead of WeChat
- On Windows, prefer `npm run switch-to-logon-autostart`; it restores the old detached background mode and registers user-logon autostart without using SCM service hosting
- If you intentionally keep the optional Windows service mode, later code changes usually only need `npm run build` plus `npm run service -- restart`
- If you want to start over in the current WeChat chat, send `/new`

## Chinese Documentation

See [README_zh.md](./README_zh.md).
