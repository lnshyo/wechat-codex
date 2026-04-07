---
name: wechat-codex-direct
description: Install, configure, validate, and troubleshoot a WeChat bridge that sends personal WeChat messages directly to the local logged-in Codex CLI, with per-contact thread isolation, FIFO task queues, token estimation, local gateway-style control commands, image forwarding, and background service management. Use when Codex needs to connect WeChat to local Codex on a machine without OpenClaw.
---

# WeChat Codex Direct

Install and operate the WeChat-to-Codex bridge in this repository so a personal WeChat account can talk directly to the local `codex.exe`.

Use this skill when the user wants WeChat connected to Codex on the same machine and does not want OpenClaw.

This skill bundle also includes a local reference snapshot:

- `README.md` explains what is bundled for sharing
- `references/gateway-layer.md` explains the `gateway` layer and its integration points
- `reference-implementation/` contains copied source, docs, and tests for the gateway layer

## Workflow

1. Verify local prerequisites.
2. Install dependencies and build the bridge.
3. Run WeChat QR binding.
4. Start or restart the background service.
5. Verify text, queueing, token summaries, and image handling from WeChat.

## Prerequisites

- Confirm `codex login status` succeeds on the target machine.
- Confirm `node -v` is at least Node.js 18.
- Confirm the user can scan a WeChat QR code from that machine.
- Prefer the sandbox copy of Codex at `C:\Users\<user>\.codex\.sandbox-bin\codex.exe` when present.

## Install The Bridge

Run these commands in the bridge repository root:

```bash
npm install
npm run build
npm run setup
```

`npm run setup` should:

- open or print a WeChat QR code
- wait for confirmation
- ask for the default working directory
- save local state under `~/.wechat-codex/`

## Start And Operate

Foreground:

```bash
npm start
```

Background service:

```bash
npm run service -- start
```

Status:

```bash
npm run service -- status
```

Restart:

```bash
npm run service -- restart
```

Logs:

```bash
npm run logs
```

## WeChat Control Commands

The bridge handles these commands locally:

- `/new`
- `/status`
- `/token`
- `/task`
- `/stop`
- `/health`

Unknown slash commands continue through to Codex as normal chat input.

## Expected Behavior

- normal WeChat text becomes Codex work
- if a chat is already busy, new work is queued in FIFO order
- image messages are downloaded immediately and later passed to Codex
- each WeChat contact gets an isolated Codex thread and queue
- `/status` and `/task` expose current queue state for the active chat
- `/token` reports a conservative local token estimate for the active chat
- `/stop` aborts current work and clears that chat's queue
- `/new` resets only the current chat's saved Codex thread, queue, and token ledger
- the bridge tries native WeChat typing first
- if typing is unavailable, the bridge falls back to WeChat generating state
- the bridge talks to local `codex.exe`, not OpenClaw and not `OPENAI_API_KEY`

## Verification Checklist

After installation or repair, verify:

1. `npm run service -- status` reports the service is running.
2. A real WeChat message shows typing or generating state quickly.
3. A final Codex reply arrives.
4. Two different WeChat contacts do not share context.
5. `/task` shows queued work after multiple rapid messages in one chat.
6. `/token` returns a token estimate for the current chat.
7. An image sent from WeChat can be analyzed by Codex.

## Troubleshooting

- If no reply arrives, check `codex login status`, `npm run service -- status`, and `npm run logs`.
- If typing does not appear, inspect logs for `getconfig` or `sendtyping` failures; generating fallback is expected in that case.
- If the queue is full, inspect it with `/task` and clear it with `/stop`.
- If a resumed Codex thread fails for one contact, the bridge should reset only that contact's thread and token ledger before continuing.
- If the user wants a fresh conversation in the current WeChat chat, send `/new`.
- If the service is stuck, restart it with `npm run service -- restart`.

## Scope

This skill teaches Codex how to deploy and operate the WeChat bridge from this repository. It does not recreate the bridge from scratch unless the user explicitly asks for a reimplementation.

For implementation review or sharing, prefer reading the bundled reference files before searching the wider repository.
