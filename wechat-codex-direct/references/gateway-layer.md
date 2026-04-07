# Gateway Layer Reference

In this project, the layer is named `gateway`.

## Responsibilities

The gateway layer sits between raw WeChat messages and the local Codex runner. It is responsible for:

- translating incoming chat messages into queued gateway tasks
- handling local slash commands such as `/new`, `/status`, `/token`, `/task`, `/stop`, and `/health`
- keeping one FIFO task queue per WeChat contact
- tracking conservative token estimates for each contact
- updating session state for queue status, last task result, and local token ledger
- exposing health and queue snapshots back to WeChat

## Main File Map

- `reference-implementation/src/gateway/runtime.ts`
  - creates the per-contact runtime, queues work, drains tasks, stops tasks, and updates session state
- `reference-implementation/src/gateway/commands.ts`
  - parses and serves the local WeChat slash commands
- `reference-implementation/src/gateway/tokens.ts`
  - creates and normalizes the token ledger and local token estimates
- `reference-implementation/src/gateway/render.ts`
  - renders `/status`, `/token`, `/task`, and `/health` replies
- `reference-implementation/src/gateway/task-utils.ts`
  - builds prompt previews and message chunking helpers
- `reference-implementation/src/gateway/types.ts`
  - defines queue, health, and gateway session types
- `reference-implementation/src/main.ts`
  - wires the gateway into the live WeChat monitor and routes normal messages into `enqueueMessage`
- `reference-implementation/src/codex/provider.ts`
  - runs local `codex.exe` and emits event-style session updates back to the gateway flow
- `reference-implementation/src/session.ts`
  - persists per-contact state, including the gateway session state and token ledger

## Runtime Flow

1. WeChat emits a message into `src/main.ts`.
2. `handleGatewayCommand` checks whether the message is a local control command.
3. If it is not a command, `buildPrompt` and `buildTaskPreview` prepare the gateway task input.
4. `createGatewayRuntime(...).enqueueMessage(...)` creates a queued task for that contact.
5. The runtime drains that contact's FIFO queue one task at a time.
6. `runGatewayTask` calls the local Codex runner in `src/codex/provider.ts`.
7. The runtime writes final status, last error, and token ledger updates into `src/session.ts`.
8. Render helpers return queue, token, status, or health output back to WeChat when requested.

## Local Commands Exposed In WeChat

- `/new`
  - resets the current contact's saved thread, queue, and token ledger
- `/status`
  - renders the current session summary
- `/token`
  - renders the local token estimate summary
- `/task`
  - renders the active task and queued tasks
- `/stop`
  - aborts the active task and clears queued work for the current contact
- `/health`
  - renders bridge, service, and Codex executable health

## Bundled Tests

The copied tests under `reference-implementation/src/tests/` show the expected behavior for:

- command parsing and command handling
- queue draining and task lifecycle updates
- session persistence behavior
- token normalization and ledger updates

## Operator Docs

The copied `README.md` and `README_zh.md` in `reference-implementation/` explain installation, setup, running, service management, verification, and troubleshooting for the full bridge.
