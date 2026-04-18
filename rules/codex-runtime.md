# Codex Runtime Rules

Use when touching `src/codex/**`, Codex CLI invocation, transcript parsing, local sync, companion selection, or workspace path normalization.

## Invariants

- Preserve one isolated Codex thread per WeChat contact unless the user explicitly requests a routing change.
- Do not reintroduce an `OPENAI_API_KEY` requirement for normal local operation when `codex.exe` is already logged in.
- Keep default model behavior aligned with repository memory: `gpt-5.4` and medium reasoning unless the user asks otherwise.
- WeChat-triggered Codex runs should retain full local access and no approval prompts in the bridge execution path.
- Local companion sync must mirror only fresh final assistant replies after bind time, not historical transcript content or intermediate events.

## Verification

- For provider, transcript, workspace path, companion, or local sync changes, run the narrowest matching tests first, then `npm run build` and `npm test` before completion.
- Update `memory/CONTEXT.md` when Codex executable paths, state database lookup, transcript paths, model defaults, or execution flags change.
