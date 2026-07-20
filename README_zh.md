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
- 使用微信已经提供的转写文本处理语音消息
- 按联系人隔离线程并使用 FIFO 队列
- 支持微信图片输入，并把可下载的图片、视频、语音媒体和文件附件自动归档到本地资料库
- 优先使用微信原生 typing 状态，失败时回退到 `GENERATING`
- 支持 `/sync`，可镜像本地 Codex Desktop 会话的新回复
- 提供本地 token 估算、状态和健康检查命令
- Windows 推荐使用登录自启的后台模式
- bridge 自己发起的 Codex 调用固定使用已登录身份的 HTTPS/SSE 通道，并禁用 WebSocket

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

## 文件存储规则

- Windows `Downloads` 只作为临时收件箱，不作为项目资料的长期存储位置。
- 需要纳入版本管理的项目文档放在 `docs/<主题>/`。
- 本工作区以后产生的个人资料统一进入项目根目录下、已被 Git 忽略的 `资料库/`，再按待打印、知识文档、视频资料、整理总结、工具和历史归档分类。
- 资料库最多只允许“一级分类/二级分类/文件”两层目录；来源、日期和主题写进文件名，不再创建第三级目录。
- 可下载的微信入站附件会直接归档到根目录 `资料库/` 的对应分类：视频进入 `30-视频资料/01-原视频/`，文档进入 `20-知识文档/其他/`，压缩包和安装包进入 `50-工具与安装包/`，图片、音频和无法安全判断用途的文件进入 `00-待分类/`。
- 移动、压平或重名处理都必须原样保留文件后缀；重名标识只能加在后缀前，格式转换必须另建派生文件，不能冒充原文件改名。
- `.env`、`.pem`、`.key`、`.p12`、`.pfx` 等明显凭证文件不会自动落库。
- 这是一条面向未来的存放规则，不会自动迁移历史文件；整理旧文件必须单独提出。

分类、命名、保留周期和安全迁移要求见 [`rules/file-storage.md`](./rules/file-storage.md)。

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
codexProvider=app-server
appServerFallbackToCli=true
```

`codexProvider` 默认是 `cli`，继续保持每轮启动一次进程的旧行为。设置为 `app-server`
后，bridge 会在启动时预热并持续复用一个独立的 `codex.exe app-server`。如果初始化失败且
`appServerFallbackToCli=true`，该次请求会自动回退到原有 CLI provider。修改后需要重启 bridge。

这些值会影响剩余上下文预算估算和单联系人队列上限。

## 工作方式

- 普通微信文本消息会直接变成 Codex 任务
- 语音消息优先读取 `voice_item.text`，并兼容旧字段 `voice_text`；存在可下载的语音媒体时会自动归档，但 bridge 仍不运行本地语音识别
- 聊天正在忙时，新任务会自动排队
- 可支持的图片、视频和文件附件只下载一次，直接写入配置工作目录下的根级 `资料库/`，再以图片数据或本地文件路径交给 Codex
- 每个微信联系人都有独立的 Codex 会话和本地状态
- `/sync` 可以把当前聊天绑定到同一工作目录下最新的本地 Codex Desktop 会话
- 绑定后，bridge 只会同步绑定点之后新产生的 assistant 回复
- 微信侧触发的 Codex 会话以完全本地访问模式运行，不需要审批
- bridge 自己发起的 Codex 会话固定使用已登录身份的 Responses HTTPS provider，并禁用 WebSocket
- bridge 启动的 Codex 子进程会通过仅对本进程生效的覆盖项禁用无关全局 MCP，以降低启动延迟；Codex Desktop 和全局 MCP 配置不受影响
- App Server 模式会持续复用 bridge 自己的 Codex 进程，并随 bridge 一起关闭；它不会连接或依赖 Codex Desktop 私有的 App Server
- 新线程会按仓库顺序一次性预载带大小上限的启动记忆快照；恢复旧线程时不会重复注入

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
7. 微信发送图片、视频或文档后，文件会出现在对应的 `资料库/` 分类中，并能交给 Codex 分析
8. 微信语音已有平台转写时，能作为文本正常交给 Codex
9. 发送 `/sync` 后，bridge 会返回绑定到的本地 Codex 会话来源和标题；之后只同步新的本地 assistant 回复

## 排障

- 如果微信收不到回复，先检查 `codex login status`、`npm run service -- status`、`npm run logs`
- 如果没有看到 typing，bridge 会自动回退到 `GENERATING`；可在日志里查看 `getconfig` 或 `sendtyping`
- 如果队列满了，用 `/stop` 清空
- 如果 Codex 线程恢复失败，bridge 会为当前联系人重新开线程并重置 token 账本
- 如果 `/sync` 提示没有找到本地 Codex 会话，先在同一工作目录中打开目标 Codex Desktop 窗口
- 如果 `/sync` 绑定到了错误线程，把目标 Codex Desktop 线程切到前台后重新发送 `/sync`
- `/sync` 不会回放历史 transcript；旧内容应在 Codex Desktop 里查看
