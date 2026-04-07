# Test Layout

- `test/bridge`
  - bridge lifecycle, adapter behavior, routing, state persistence, desktop sync, and final reply handling
- `test/companion`
  - local companion launcher behavior and entrypoint coverage
- `test/wechat`
  - WeChat transport and workspace channel configuration

## Commands

Run the full suite:

```bash
bun test
```

Run focused suites:

```bash
bun test test/bridge
bun test test/companion
bun test test/wechat
```

Watch mode:

```bash
bun test --watch test
```
