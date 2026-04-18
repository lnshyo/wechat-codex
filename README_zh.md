# wechat-codex

把个人微信直接连接到同一台机器上已经登录的本地 Codex CLI。

`wechat-codex` 是一个直接的 WeChat-to-Codex bridge，不依赖 OpenClaw；如果本地 Codex 已经完成登录，也不需要 `OPENAI_API_KEY`。

## 这个项目解决什么问题

- 直接在微信里和本机 Codex 对话，不需要额外云中转
- 每个联系人都有独立的 Codex 线程，不串上下文
- 普通消息直接交给 Codex，同时保留少量控制命令
- 在 Windows 上支持前台运行和可持续的后台托管

## 功能

- 个人微信文本消息直连本地 Codex
- 按联系人隔离线程并使用 FIFO 队列
- 支持微信图片输入
- 优先使用微信原生 typing 状态，失败时回退到 `GENERATING`
- 支持 `/sync`，可镜像本地 Codex Desktop 会话的新回复
- 提供本地 token 估算、状态和健康检查命令
- Windows 推荐使用登录自启的后台模式

## 微信命令

bridge 会在本地处理这些命令：

- `/new`：重置当前联系人的线程、队列和 token 账本
- `/sync`：把当前联系人绑定到当前工作目录下最新的本地 Codex Desktop 会话
- `/unsync`：断开当前联系人和本地 Codex 会话的同步，但保留已保存的线程 id
- `/status`：查看当前会话状态
- `/token`：查看当前会话的本地 token 估算
- `/task`：查看当前会话的运行中和排队任务
- `/stop`：停止当前任务并清空排队任务
- `/health`：查看 bridge、后台服务和 Codex 可执行文件状态

未知的 `/xxx` 不会被本地拦截，仍然会作为普通消息发给 Codex。

## 前置条件

- Node.js 22+
- 可扫码绑定的个人微信账号
- 当前机器上可正常使用的 Codex CLI 登录

建议先检查：

```bash
codex login status
```

默认优先使用：

```text
C:\Users\<你>\.codex\.sandbox-bin\codex.exe
```

## 快速开始

安装并构建：

```bash
npm install
npm run build
```

首次配置：

```bash
npm run setup
```

配置流程会：

1. 打开或输出微信绑定二维码
2. 等待扫码确认
3. 设置默认工作目录
4. 把本地状态保存到 `~/.wechat-codex/`

默认数据目录：

```text
~/.wechat-codex/
```

Windows 下一般是：

```text
C:\Users\<你>\.wechat-codex\
```

## 运行

前台：

```bash
npm start
```

后台服务：

```bash
npm run service -- start
```

切换到推荐的 Windows 登录自启模式：

```bash
npm run switch-to-logon-autostart
```

这条命令会删除 WinSW Windows 服务，注册当前用户登录自启任务 `wechat-codex-logon`，并立即启动旧的 detached 后台模式。

现在登录自启任务会通过隐藏的 PowerShell 启动器静默拉起 bridge，不再依赖可见的 `CMD` 窗口常驻。正常情况下登录后不需要保留一个黑色控制台窗口来维持微信桥接。

如需保留可选的 Windows 服务模式：

```bash
npm run service -- install
```

其他常用命令：

```bash
npm run service -- status
npm run service -- restart
npm run service -- stop
npm run service -- uninstall
npm run logs
```

静默模式排障时，优先使用 `npm run service -- status` 和 `npm run logs`，而不是观察桌面上是否出现控制台窗口。

## 可选配置

`config.env` 还支持：

```text
sessionTokenBudget=120000
sessionReplyReserveTokens=4096
maxQueuedTasksPerPeer=5
```

这些值会影响剩余上下文预算估算和单联系人队列上限。

## 工作方式

- 普通微信文本消息会直接变成 Codex 任务
- 聊天正在忙时，新任务会自动排队
- 图片消息会先下载，再在执行时转发给 Codex
- 每个微信联系人都有独立的 Codex 会话和本地状态
- `/sync` 可以把当前聊天绑定到同一工作目录下最新的本地 Codex Desktop 会话
- 绑定后，bridge 只会同步绑定点之后新产生的 assistant 回复
- 微信侧触发的 Codex 会话以完全本地访问模式运行，不需要审批
- 新线程第一条任务会注入 bootstrap 提示，要求 Codex 先读取 `AGENTS.md` 再继续处理

## 开发

构建：

```bash
npm run build
```

测试：

```bash
npm test
```

项目结构：

- `src/main.ts`：微信收消息、命令分流、任务排队、typing、Codex 执行
- `src/gateway/`：命令路由、token 估算和运行时状态
- `src/codex/`：本地 `codex.exe` 调用、transcript 同步和 companion 发现
- `src/wechat/`：微信 API、登录、媒体、轮询和发送逻辑
- `src/tests/`：桥接运行时的测试覆盖

## 安装后验证

建议验证：

1. `npm run service -- status` 显示 bridge 正在运行  
   Windows 上推荐看到的是 `background`，不是 `windows-service`
2. 从微信发送文本后，能很快看到 typing 或 `GENERATING`
3. 最终能收到 Codex 回复
4. 两个不同联系人不会共享上下文
5. `/task` 能看到排队状态
6. `/token` 能返回当前会话的 token 估算
7. 微信发图后，Codex 能正常分析
8. 发送 `/sync` 后，bridge 会返回绑定到的本地 Codex 会话来源和标题；之后只同步新的本地 assistant 回复

## 排障

- 如果微信收不到回复，先检查 `codex login status`、`npm run service -- status`、`npm run logs`
- 如果没有看到 typing，bridge 会自动回退到 `GENERATING`；可在日志里查看 `getconfig` 或 `sendtyping`
- 如果队列满了，用 `/stop` 清空
- 如果 Codex 线程恢复失败，bridge 会为当前联系人重新开线程并重置 token 账本
- 如果 `/sync` 提示没有找到本地 Codex 会话，先在同一工作目录中打开目标 Codex Desktop 窗口
- 如果 `/sync` 绑定到了错误线程，把目标 Codex Desktop 线程切到前台后重新发送 `/sync`
- `/sync` 不会回放历史 transcript；旧内容应在 Codex Desktop 里查看
