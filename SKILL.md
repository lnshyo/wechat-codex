---
name: wechat-codex-repo
description: Repository-level pointer for the WeChat-to-Codex bridge. Use when Codex needs to understand that the installable reusable skill lives under `wechat-codex-direct/` in this repository.
---

# WeChat Codex Repository

This repository contains a direct WeChat-to-Codex bridge.

The reusable installable skill is not this root file. It lives here:

```text
wechat-codex-direct/
```

Use that folder when another Codex instance needs the standard skill package.

Use the root README files for human-facing setup and publishing documentation:

- `README.md`
- `README_zh.md`
