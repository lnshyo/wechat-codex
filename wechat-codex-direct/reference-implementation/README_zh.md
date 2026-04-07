# wechat-codex

把个人微信接到这台机器上已经登录好的本地 Codex CLI。

这是一个直接把微信消息桥接到本地 `codex.exe` 的项目，不依赖 OpenClaw；只要本地 Codex 已经登录，就不需要 `OPENAI_API_KEY`。

## 功能

- 接收个人微信消息并发送给本地 `codex.exe`
- 为每个微信联系人维护独立的 Codex 线程
- 为每个联系人维护独立的 FIFO 任务队列
- 支持微信图片输入
- 在微信里直接提供轻量 gateway 风格控制命令
- 优先使用微信原生“输入中”
- typing 不可用时回退到微信 `GENERATING` 状态
- 支持前台运行和后台服务运行

## 微信命令

桥接层会在本地拦截这些精确命令：

- `/new`：重置当前联系人的线程、队列和 token 账本
- `/status`：查看当前联系人的会话状态
- `/token`：查看当前联系人的本地 token 估算
- `/task`：查看当前联系人的活动任务和排队任务
- `/stop`：停止当前联系人正在执行的任务并清空队列
- `/health`：查看桥接、服务和 Codex 可执行文件健康状态

未知的 `/xxx` 仍会按普通消息发给 Codex。

## 当前行为

- 普通文本消息会变成 Codex 任务
- 如果当前联系人正在忙，新的普通消息会自动排队
- 图片消息会先下载，再在执行时转发给 Codex
- 不同联系人之间上下文和队列完全隔离
- token 指标是本地保守估算，不代表底层模型真实剩余额度
- 本地会保存每个联系人的线程状态和 token 账本

## 前置条件

- Node.js 18+
- 可扫码绑定的个人微信账号
- 这台机器上可正常使用的 Codex CLI 登录

建议先检查：

```bash
codex login status
```

安装时默认优先使用：

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
3. 让你设置默认工作目录
4. 把本地状态保存到 `~/.wechat-codex/`

默认数据目录：

```text
~/.wechat-codex/
```

Windows 下通常是：

```text
C:\Users\<你>\.wechat-codex\
```

## 可选配置

`config.env` 还支持这些可选项：

```text
sessionTokenBudget=120000
sessionReplyReserveTokens=4096
maxQueuedTasksPerPeer=5
```

这些值会影响 token 估算和单联系人队列上限。

## 运行

前台运行：

```bash
npm start
```

后台服务：

```bash
npm run service -- start
```

查看状态：

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

查看日志：

```bash
npm run logs
```

## 验证

配置完成后，建议验证下面几项：

1. `npm run service -- status` 显示服务正在运行
2. 从微信发一条文本，很快能看到“输入中”或“生成中”
3. 最终能收到 Codex 回复
4. 两个不同联系人不会串上下文
5. 连续发多条消息后，`/task` 能看到排队状态
6. `/token` 能返回当前会话的 token 估算
7. 从微信发一张图片，Codex 能正常分析

## 项目结构

- `src/main.ts`：微信收消息、命令分流、任务排队、typing、Codex 执行
- `src/gateway/`：轻量 gateway runtime、命令、token 估算和状态渲染
- `src/codex/provider.ts`：本地 `codex.exe` 调用层
- `src/wechat/`：微信 API、登录、媒体、轮询、发送逻辑
- `src/session.ts`：按联系人保存会话状态和 token 账本
- `wechat-codex-direct/`：可复用的标准 Codex skill 文件夹

## 可复用 Skill

仓库里自带一个标准 skill 文件夹：

```text
wechat-codex-direct/
```

如果你想把这套能力给别的 Codex 用，直接把这个文件夹复制到对方的 `$CODEX_HOME/skills/` 或 `~/.codex/skills/` 即可。

## 排障

- 微信收不到回复时，先检查 `codex login status`、`npm run service -- status`、`npm run logs`
- 如果没有看到“输入中”，桥接会自动回退到 `GENERATING`；可在日志里看 `getconfig` 或 `sendtyping`
- 如果队列满了，先用 `/task` 查看，再用 `/stop` 清空
- 如果 Codex 线程恢复失败，桥接会只重置当前联系人的线程和 token 账本
- 如果想在当前微信会话里重新开始，直接发送 `/new`
