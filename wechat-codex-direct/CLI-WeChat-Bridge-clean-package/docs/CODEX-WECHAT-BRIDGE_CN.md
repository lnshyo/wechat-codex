# CLI-WeChat-Bridge 详细说明

## 1. 项目定位

这个仓库的目标不是把微信做成新的主工作界面，而是把微信接成一个远程入口：

- 本地 CLI 仍然是主工作流
- 微信负责远程发消息、收最终回复、查看状态
- 会话状态、线程绑定、可见窗口跟随，仍以本地工作区为中心

当前维护最完整的路径是 `Codex + WeChat`。本仓库也保留了 Claude、OpenCode 和 shell 适配器，但最近的增强主要集中在 Codex 路线。

## 2. 目录结构

### 顶层目录

- `bin/`
  - 全局命令入口
  - 包括 `wechat-bridge-codex`、`wechat-codex`、`wechat-codex-bind` 等
- `src/`
  - 业务源码
- `test/`
  - 回归测试
- `docs/`
  - 文档、截图、版本说明
- `scripts/windows/`
  - Windows 本地部署脚本
- `.tmp-run/`、`.tmp-wechat-bind/`
  - 本地调试临时产物
  - 现在已经加入 `.gitignore`

### `src/` 细分

- `src/bridge/`
  - bridge 主循环
  - 路由状态
  - 线程绑定
  - 桌面同步
  - 各适配器接入
- `src/companion/`
  - 本地 companion / panel 进程
  - 负责 visible Codex 面板接入
- `src/wechat/`
  - 微信登录
  - iLink 收发
  - channel 数据目录配置
- `src/commands/`
  - 单独命令，例如版本检查
- `src/utils/`
  - 通用辅助逻辑

## 3. 当前 Codex + 微信 主链路

### 3.1 微信到 Codex

当前绑定线程模式下，微信消息会：

1. 进入当前工作区对应的 bridge
2. 路由到绑定主线程或临时线程
3. 被包装成 prompt 后送进当前 Codex 会话
4. 最终回复回传到微信

当前已经补了针对“语义同步”的测试，不再只靠人工体感判断。测试会验证微信原文 token 确实进入了发给 Codex 的 prompt。

### 3.2 Codex 到微信

绑定后的线程内，本地 Codex 的关键信息现在会重新同步回微信：

- 本地输入镜像
- 线程切换提示
- 最终回复

但普通 `stdout` / `stderr` 仍默认不回微信，避免把大量终端噪声刷进聊天窗口。

### 3.3 主线程和临时线程

当前仓库已支持：

- `/1`
  - 回到绑定主线程
- `/2`
  - 切到独立临时线程
- 临时线程持续保留
  - 直到用户手动 `/1` 切回主线程

## 4. 可见 Codex 窗口同步

当前策略强调安全，不允许向任何桌面输入框注入正文或搜索词。

### 已允许的做法

- touch session index / sqlite
- 维护 pinned thread 全局状态
- 使用 `codex://threads/<threadId>` 做安全路由跳转
- 触发安全刷新式路由同步

### 明确禁止的做法

- 搜索框输入线程标题
- 向任意窗口粘贴正文
- 自动回车发送内容
- 命令面板搜索兜底

也就是说，仓库里对桌面同步的设计边界是：

- 允许安全路由切换
- 不允许 GUI 文本注入

## 5. 快速绑定当前可见 Codex 线程

为了避免在新线程里输入“绑定微信”时先被当普通自然语言执行，现在仓库提供了一个直接命令：

```bash
bun run codex:bind-current
```

它做的事情是：

1. 读取当前工作区的 `codex-panel-endpoint.json`
2. 取出当前可见 Codex panel 的线程 id
3. 更新该工作区的 `bridge-state.json`
4. 把当前线程写成微信主线程
5. 默认重启后台 bridge 让绑定立即生效

对应入口文件：

- `src/bridge/codex-current-bind.ts`
- `bin/wechat-codex-bind.mjs`
- `scripts/windows/bind-current-codex-thread.ps1`

如果你在 Windows 上想一键操作，优先用脚本或桌面快捷方式，而不是把“绑定微信”当作自然语言消息发给一个全新的普通线程。

## 6. Windows 本地部署脚本说明

`scripts/windows/` 里的脚本是本地托管部署辅助层，不是跨机器零配置模板。

这里要明确两件事：

- 仓库核心逻辑是通用的，主要在 `src/`
- `scripts/windows/` 里可以出现当前机器的别名路径、计划任务名、日志目录名

这也是为什么你会看到一些带 `AGTK` 的命名。它们更接近“当前机器部署实例标识”，不是 bridge 核心逻辑的一部分。

建议把这些脚本理解为：

- 本地运维脚本
- 当前机器的部署包装层
- 可以按自己的工作区和路径继续调整

更详细说明见：

- [scripts/windows/README.md](../scripts/windows/README.md)

## 7. 重要命令

### 仓库内开发命令

```bash
bun run setup
bun run bridge:codex
bun run codex:panel
bun run codex:start
bun run codex:bind-current
bun run bridge:claude
bun run claude:companion
bun run bridge:shell
bun test
```

### 全局命令入口

如果已经 `npm install -g .` 或 `npm link`，可以直接使用：

```bash
wechat-bridge-codex
wechat-codex
wechat-codex-bind
wechat-codex-start
wechat-bridge-claude
wechat-claude
wechat-bridge-shell
wechat-check-update
```

## 8. 运行时数据与日志

默认数据目录：

```text
~/.claude/channels/wechat
```

常见文件：

- `account.json`
  - 微信凭据
- `context_tokens.json`
  - 微信上下文 token 缓存
- `bridge.log`
  - bridge 主日志
- `bridge.lock.json`
  - 运行锁
- `workspaces/<workspace-key>/bridge-state.json`
  - 当前工作区路由状态
- `workspaces/<workspace-key>/codex-panel-endpoint.json`
  - 当前工作区 panel endpoint

如果用了静默后台脚本，还会有：

- `autostart/<instance>/manager.log`
- `autostart/<instance>/bridge-stderr.log`
- `autostart/<instance>/companion-stderr.log`

## 9. 测试结构

测试目录分成三块：

- `test/bridge`
  - bridge 生命周期、状态、线程路由、桌面同步、适配器逻辑
- `test/companion`
  - companion 启动和入口行为
- `test/wechat`
  - 微信 transport 和 channel 配置

运行方式见：

- [test/README.md](../test/README.md)

## 10. 目前推荐的使用方式

如果你当前重点是 Codex + 微信：

1. 在工作区启动 bridge
2. 打开可见 Codex companion
3. 用 `bun run codex:bind-current` 或 Windows 一键脚本把当前线程绑定成微信主线程
4. 后续主要通过 `/1`、`/2` 和普通消息在微信与 Codex 之间切换

这样最稳定，也能避开“普通新线程把绑定微信当自然语言分析”的问题。
