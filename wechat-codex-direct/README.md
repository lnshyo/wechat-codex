# WeChat Codex Direct Share Bundle

This folder is a shareable Codex skill plus a local reference bundle for the `gateway` layer used by `wechat-codex`.

Use it when you want to give someone both:

- an install-and-run playbook for the direct WeChat-to-Codex bridge
- a readable snapshot of the gateway-layer implementation and its key integration points

## What Is Included

- `SKILL.md`
  - the reusable skill prompt for installing, running, validating, and troubleshooting the bridge
- `references/gateway-layer.md`
  - a focused explanation of what the gateway layer does, how it is wired, and which files matter
- `reference-implementation/`
  - copied source, docs, and tests related to the gateway layer so others can inspect the implementation without browsing the full repository

## Quick Share Instructions

1. Copy `wechat-codex-direct/` into the other machine's `$CODEX_HOME/skills/` or `~/.codex/skills/`.
2. Tell the recipient to use `$wechat-codex-direct` in Codex when they need setup or operational help.
3. Tell the recipient to open `references/gateway-layer.md` for the architecture overview.
4. Tell the recipient to inspect `reference-implementation/` for the copied code and tests.

## Bundled Reference Scope

The copied implementation focuses on the gateway layer and the files that directly construct or invoke it:

- `src/gateway/`
- `src/codex/provider.ts`
- `src/main.ts`
- `src/session.ts`
- gateway-related tests
- project usage docs and scripts metadata

This is a reference snapshot, not a second standalone app distribution.
