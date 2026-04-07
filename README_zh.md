# wechat-codex

把个人微信连接到同一台机器上已经登录的本地 Codex CLI。

这个项目是一个直接的 WeChat-to-Codex bridge，不依赖 OpenClaw；如果本地 Codex 已经完成登录，也不需要 `OPENAI_API_KEY`。

## 功能

- 接收个人微信消息并转发给本地 `codex.exe`
- 每个微信联系人独立保存一条 Codex 线程
- 每个联系人独立维护 FIFO 任务队列
- 支持微信图片输入
- 在微信里直接提供轻量 gateway 控制命令
- 优先使用微信原生 typing 状态，失败时回退到 `GENERATING`
- 支持前台运行和普通后台进程运行
- Windows 上默认推荐“登录自启 + 普通后台模式”，不再默认推荐真正的 Windows 服务托管

## 微信命令

- `/new`：重置当前联系人的线程、队列和 token 账本
- `/sync`：把当前联系人绑定到当前工作目录下最新的本地 Codex Desktop 会话；优先使用 Desktop `threads`，没有匹配时才回退到 transcript 扫描
- `/unsync`：断开当前联系人和本地 Codex 会话的同步，但保留已保存的线程 id
- `/status`：查看当前会话状态
- `/token`：查看当前会话的本地 token 估算
- `/task`：查看当前会话的运行中和排队任务
- `/stop`：停止当前任务并清空排队任务
- `/health`：查看 bridge、后台服务和 Codex 可执行文件状态

未知的 `/xxx` 不会被本地拦截，仍然会作为普通消息发给 Codex。

## 当前行为

- 普通文本消息会直接变成 Codex 任务
- 如果当前联系人正在忙，新消息会自动排队
- 图片消息会先下载，执行时再转发给 Codex
- 不同联系人之间上下文和队列完全隔离
- 当前聊天可以通过 `/sync` 绑定到同一工作目录下的本地交互式 Codex Desktop 会话
- 绑定后，bridge 只会把绑定之后产生的本地 assistant 新回复同步回微信
- `/sync` 会直接丢弃所有历史 transcript，不回放最近窗口记录，也不会回显本地用户输入
- 微信侧触发的 Codex 会话以完全本地访问模式运行，等价于 `--dangerously-bypass-approvals-and-sandbox`
- 新线程的第一条任务，包括 `/new` 之后的第一条消息，会先注入一条 bootstrap 提示，要求 Codex 先读取 `AGENTS.md` 再按本地启动顺序加载记忆
- token 指标是本地保守估算，不代表底层模型真实剩余额度

## 前置条件

- Node.js 18+
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

## 安装

```bash
npm install
npm run build
```

## 首次配置

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

## 可选配置

`config.env` 还支持：

```text
sessionTokenBudget=120000
sessionReplyReserveTokens=4096
maxQueuedTasksPerPeer=5
```

这些值会影响 token 估算和单联系人队列上限。

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

如需保留可选的 Windows 服务模式：

```bash
npm run service -- install
```

状态：

```bash
npm run service -- status
```

重启：

```bash
npm run service -- restart
```

停止：

```bash
npm run service -- stop
```

卸载 Windows 服务：

```bash
npm run service -- uninstall
```

日志：

```bash
npm run logs
```

## 验证

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

## 项目结构

- `src/main.ts`：微信收消息、命令分流、任务排队、typing、Codex 执行
- `src/gateway/`：轻量 gateway runtime、命令、token 估算和状态渲染
- `src/codex/provider.ts`：本地 `codex.exe` 调用层
- `src/codex/transcript.ts`：本地 Codex transcript 解析
- `src/codex/companion.ts`：本地 Codex Desktop 线程发现与回退逻辑
- `src/codex/local-sync.ts`：本地 transcript 跟踪与微信回流
- `src/wechat/`：微信 API、登录、媒体、轮询、发送逻辑
- `src/session.ts`：按联系人保存会话、token 账本和本地同步状态
- `wechat-codex-direct/`：可复用的标准 Codex skill 文件夹

## 可复用 Skill

仓库内自带一个标准 skill 文件夹：

```text
wechat-codex-direct/
```

如果你想把这套能力给别的 Codex 实例使用，直接复制到对方的 `$CODEX_HOME/skills/` 或 `~/.codex/skills/` 即可。

## 排障

- 如果微信收不到回复，先检查 `codex login status`、`npm run service -- status`、`npm run logs`
- 如果没有看到 typing，bridge 会自动回退到 `GENERATING`；可在日志里查看 `getconfig` 或 `sendtyping`
- 如果队列满了，先用 `/task` 查看，再用 `/stop` 清空
- 如果 Codex 线程恢复失败，bridge 会为当前联系人重新开线程并重置 token 账本
- 如果 `/sync` 提示没有找到本地 Codex 会话，先在同一工作目录中打开你想绑定的 Codex Desktop 窗口
- 如果 `/sync` 绑定到了错误线程，把目标 Codex Desktop 线程切到前台后重新发送 `/sync`
- `/sync` 设计上不会回放任何历史 transcript；历史内容只在 Codex Desktop 里看
- 在 Windows 上，默认推荐 `npm run switch-to-logon-autostart`；它会恢复旧后台模式并注册“用户登录后自动启动”
- 如果你是有意保留可选的 Windows 服务模式，后续大多数代码更新只需要 `npm run build` 然后 `npm run service -- restart`
- 如果你想在当前微信会话里重新开始，直接发送 `/new`
