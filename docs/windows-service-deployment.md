# wechat-codex Windows Service 部署与排障

> 最后验证时间：2026-04-08
> 适用场景：另一台 Windows 机器已经能本地登录 Codex，但安装后没有稳定成功调用 Codex，想改用 Windows Service 方式托管 `wechat-codex`。

## 目标

把 `wechat-codex` 安装为开机自动启动的 Windows Service，而不是依赖手动启动或“登录后计划任务”。

本机这次最终稳定跑通后的关键状态是：

- 服务名：`wechat-codex`
- 启动模式：`Automatic`
- Service Wrapper：WinSW
- WeChat bridge 数据目录：`C:\Users\<你>\.wechat-codex`
- Codex 可执行文件：`C:\Users\<你>\.codex\.sandbox-bin\codex.exe`
- 推理档位：`medium`
- 执行权限：完整本地访问，无审批提示

## 前置条件

部署前先确认这几件事：

1. Windows 上已经安装 Node.js 22+
2. 这台机器上的 Codex CLI 已登录成功
3. 个人微信可以扫码登录 bridge
4. `wechat-codex` 已完成 `npm install`
5. PowerShell 具备管理员权限

先在目标机器手动确认 Codex 本身没问题：

```powershell
codex login status
```

如果这里都不正常，先不要装服务。

## 推荐部署流程

在仓库根目录执行：

```powershell
npm install
npm run build
npm run setup
```

`setup` 完成后，确认配置文件：

```text
C:\Users\<你>\.wechat-codex\config.env
```

至少应包含：

```env
workingDirectory=C:\Users\<你>\...你的工作目录...
model=gpt-5.4
reasoningEffort=medium
codexExecutablePath=C:\Users\<你>\.codex\.sandbox-bin\codex.exe
```

然后安装 Windows Service：

```powershell
npm run service -- install
npm run service -- start
npm run service -- status
```

如果安装成功，预期应看到 `windows-service` 模式，并且状态为 `running`。

## 本机验证通过的实际结构

这台机器最终落地后的服务定义如下：

- Service wrapper 目录：`C:\Users\leafs\.wechat-codex\windows-service`
- Wrapper 可执行文件：`C:\Users\leafs\.wechat-codex\windows-service\wechat-codex-service.exe`
- Wrapper 配置：`C:\Users\leafs\.wechat-codex\windows-service\wechat-codex-service.xml`
- Wrapper 日志：`C:\Users\leafs\.wechat-codex\windows-service\logs\`
- 主 bridge 日志：`C:\Users\leafs\.wechat-codex\logs\service.stdout.log`
- 主 bridge 错误日志：`C:\Users\leafs\.wechat-codex\logs\service.stderr.log`

本机最终生效的 XML 关键内容是：

```xml
<id>wechat-codex</id>
<executable>C:\Program Files\nodejs\node.exe</executable>
<arguments>"C:\Users\leafs\.openclaw\workspace\linshiyao\workspace\wechat-codex\dist\main.js" start</arguments>
<workingdirectory>C:\Users\leafs\.openclaw\workspace\linshiyao\workspace\wechat-codex</workingdirectory>
<logpath>C:\Users\leafs\.wechat-codex\windows-service\logs</logpath>
<env name="WCC_DATA_DIR" value="C:\Users\leafs\.wechat-codex" />
<env name="CODEX_HOME" value="C:\Users\leafs\.codex" />
<startmode>Automatic</startmode>
<onfailure action="restart" delay="10 sec" />
```

这说明服务本质上是在开机后由 WinSW 拉起：

```text
node.exe "<repo>\dist\main.js" start
```

而不是直接跑某个独立二进制。

## 这个服务实际会如何调用 Codex

在当前版本里，`wechat-codex` 会调用：

```text
C:\Users\<你>\.codex\.sandbox-bin\codex.exe
```

并附带完整访问参数：

```text
--dangerously-bypass-approvals-and-sandbox
```

同时会传入：

```text
model_reasoning_effort="medium"
```

所以如果微信里能收到消息但始终不能真正调起 Codex，优先检查的不是微信，而是：

- `codexExecutablePath` 是否指向真实存在的 `codex.exe`
- 当前 Windows Service 运行用户是否就是你登录过 Codex 的那个用户
- `CODEX_HOME` 是否正确指向 `C:\Users\<你>\.codex`

## 安装后验证清单

建议严格按这个顺序验证：

1. 检查服务状态

```powershell
npm run service -- status
```

预期：

- 显示 `running (windows-service)` 或等价信息
- 有 PID

2. 检查 Windows 服务本身

```powershell
sc.exe queryex wechat-codex
```

预期：

- `STATE : RUNNING`
- 能看到 `PID`

3. 检查 wrapper 日志

```powershell
npm run logs
```

至少要确认：

- 没有安装失败
- 没有持续重启
- bridge 正常启动

4. 微信里发：

```text
/new
你好
```

预期：

- `/new` 会立即回执
- `你好` 会进入队列
- 最终有 Codex 回复

5. 重启电脑后再次检查：

```powershell
npm run service -- status
```

预期仍然是 `windows-service` 正在运行。

## 本次 RCA：为什么之前会“看起来服务装好了，但微信不稳定”

这次真正的根因不是 Windows Service 本身坏了，而是“双进程”。

表现：

- 微信上会重复入队
- 同一条消息会被重复处理
- 有时看起来像没回，实际上是两个 bridge 在同时轮询

根因：

- 机器上同时存在两条启动路径
- 一条是新的 Windows Service
- 另一条是旧残留的登录计划任务 `wechat-codex-logon`

旧任务会再额外拉起一份：

```text
node dist/main.js start
```

这样就变成：

1. Windows Service 在轮询微信
2. 旧计划任务也在轮询微信

结果就是重复投递、重复入队、状态混乱。

## 必须检查：是否存在旧的登录计划任务

如果目标机器以前尝试过“登录后自启动”模式，先检查：

```powershell
Get-ScheduledTask -TaskName "wechat-codex-logon" -ErrorAction SilentlyContinue
```

如果存在，删掉它：

```powershell
schtasks /Delete /TN wechat-codex-logon /F
```

然后重启电脑，再看服务状态。

结论很明确：

- 机器上只能保留一种启动方式
- 要么 Windows Service
- 要么登录任务
- 不能并存

## 另一台机器“服务装了但调不起 Codex”时的排查顺序

按这个顺序最省时间：

1. `codex login status`
2. 检查 `[config.env](C:\Users\leafs\.wechat-codex\config.env)` 里的 `codexExecutablePath`
3. `npm run service -- status`
4. `sc.exe queryex wechat-codex`
5. `npm run logs`
6. 检查 `C:\Users\<你>\.wechat-codex\windows-service\wechat-codex-service.xml`
7. 检查是否还留着 `wechat-codex-logon`
8. 只保留一条启动路径后重启复测

如果需要快速判断“服务有没有真的开始工作”，日志里最有价值的信号是：

- wrapper 日志里有 service started
- `service.stdout.log` 里有 `wechat-codex started for account: ...`

## 常见故障与对应判断

### 1. `service status` 显示 installed but not running

先不要立刻判定失败。

有一类情况是：

- 服务刚启动
- 状态查询有短暂延迟
- 随后 wrapper 日志会显示启动成功

所以要配合日志一起看，不要只看一次状态输出。

### 2. 微信上能 `/new`，但普通消息像“没回”

先分两类：

- 完全没收到回执
- 其实收到并入队了，只是前一条任务太慢

如果 `/task` 能看到排队，说明 bridge 还活着，不一定是服务挂了。

### 3. 重复入队或重复回复

优先怀疑双进程，而不是微信 API 本身。

先查：

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' } | Select-Object ProcessId, CommandLine
```

看是否有多份 `dist/main.js start`。

### 4. Windows Service 能跑，但 Codex 总是调不起来

优先检查：

- `codexExecutablePath`
- `CODEX_HOME`
- 当前用户是否就是已登录 Codex 的用户

不要先去改微信逻辑。

## 推荐的最终状态

稳定机器应满足：

- `wechat-codex` 只保留 Windows Service 一种启动方式
- `wechat-codex-logon` 不存在
- `config.env` 中 `codexExecutablePath` 明确可用
- `reasoningEffort=medium`
- 重启电脑后无需登录脚本，服务自动拉起
- 微信发送 `/new` 和普通消息都能正常得到单次回复

## 本机已验证通过的版本

- 仓库路径：`C:\Users\leafs\.openclaw\workspace\linshiyao\workspace\wechat-codex`
- 数据目录：`C:\Users\leafs\.wechat-codex`
- 服务名：`wechat-codex`
- 运行模式：`windows-service`
- 模型：`gpt-5.4`
- 推理强度：`medium`
- Codex 路径：`C:\Users\leafs\.codex\.sandbox-bin\codex.exe`

如果另一台机器环境差异不大，可以直接按这份文档逐项对照。
