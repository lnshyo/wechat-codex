# Testing Rules

Use when touching tests, build scripts, verification commands, CI behavior, or production code that needs verification.

## Default Commands

- Build: `npm run build`
- Full test suite: `npm test`

## Scope Rules

- After a code change, run the narrowest relevant verification command first.
- Before completing meaningful code or runtime behavior changes, run `npm run build` and `npm test`.
- If tests cannot run, record the exact command, failure, and blocker in `SESSION-STATE.md` and `memory/YYYY-MM-DD.md`.
- Do not claim a task is complete until the relevant verification output has been read and the result is known.

## Test Changes

- Add or update tests when changing user-facing behavior, routing, runtime state, transcript parsing, lock handling, or error paths.
- Prefer source-level tests that exercise real behavior; avoid testing mocks unless external dependencies make isolation unavoidable.
- Keep failure output actionable and tied to the behavior under change.
