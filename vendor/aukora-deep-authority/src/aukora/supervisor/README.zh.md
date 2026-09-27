# 同 UID 源码启动

[English](README.md) | 中文

本参考文档说明 [`developer-launch.mjs`](developer-launch.mjs) 中仅供源码使用的 parent launcher。它会把规范 broker、issuer 与 `8088-inside-out` Cordis guest 作为三个直接子进程启动；用 governed Loader 语义运行 guest；不把 issuer route 或 signed grant artifact 注入 guest composition 或 protocol；并在 shutdown 或 child loss 时回收每个直接子进程。

每个进程都使用调用者的 UID。普通启动证明组装后的 process route 与由 parent 所有的 review callback，而不证明 key custody、OS confinement、peer authentication、immutable activation 或针对恶意同 UID guest 的保护；其 ready record 写明 `SAME_UID_PARENT_LAUNCH / NO_CUSTODY_CLAIM`。可选的[受限无密钥 guest](confined-guest.md) 对固定 8088 guest 施加 OS 限制并报告独立的 observation class，但不声明独立 custody。

## 配置

启动前先构建 host package：

```sh
pnpm run build:lib:host
```

Launcher 接受一个精确 JSON object。`runtimeDir` 必须是尚不存在的绝对规范化路径。对于 `aukora:source-launch`，private key 是由调用用户所有、mode 为 `0600` 的 Ed25519 PKCS8 PEM；public key 是其 SPKI PEM counterpart。`kiraSubject` 与 `kiraPrivacy` 对该命令是可选的一对字段。Privacy 是 `local`、`exportable` 与 `private` 的非空且不重复子集。

```json
{
  "schema": "aukora:developer-launch:v1",
  "runtimeDir": "/tmp/aukora-source-run",
  "rootPrivateKeyFile": "/tmp/aukora-source-keys/root-private.pem",
  "rootPublicKeyFile": "/tmp/aukora-source-keys/root-public.pem",
  "kiraSubject": "aukora:subject:owner",
  "kiraPrivacy": ["local", "private"]
}
```

Source-launch JSON 命令没有 subject-authority 字段，因此保持 v4 proposal route。Library parent 可通过 `launchDeveloperAssembly()` 的 `createSubjectAuthority(activationDigest)` factory 选择 v5。

可选的第二个文件是一项精确 operation。它在真实 guest 通过 `ToolRuntime`、固定 WASM proposal cell、broker-owned parent review、issuer confirmation、settlement 处理前只是惰性输入。

```json
{
  "key": "demo.source.launch",
  "value": {
    "guest": "cordis",
    "proposalCell": "wasm"
  }
}
```

运行一项 operation 后退出：

```sh
pnpm aukora:source-launch /tmp/aukora-launch.json /tmp/aukora-operation.json
```

一份由 parent 暂存的 overlay（[`live-turn.overlay.yml`](live-turn.overlay.yml) 第 6 行）会把 `aukora-kira`、`session`、`agent`、`agent-loop` 与一个 DeepSeek LLM（大语言模型）插入暂存 guest，而不编辑 `profiles/8088-inside-out/cordis.patch.yml`。配套命令会运行一轮 user turn，并且仍把 parent 的 `yes <challenge>` artifact 帧当作唯一写入门：

```sh
pnpm aukora:live-turn /tmp/aukora-launch.json /tmp/aukora-turn.json [--control-dir PATH]
```

```json
{
  "schema": "aukora:live-turn:v1",
  "prompt": "Store one object at live.turn"
}
```

该命令会创建或认证与 `aukora:web` 相同的持久 local AUMLOK controller，默认位置为 `~/.aukora/local-control-v1`。Controller key 选择 issuer，其 active control 选择 KIRA subject 与 proposal-specific v5 authority。为与共用 parser 兼容，v1 launch file 仍要求 key path，但它们不会选择 live-turn authority。可选的 `kiraSubject` 必须等于 controller subject；若提供 `kiraPrivacy` 则保留，否则默认为 `private`。

没有 `DEEPSEEK_API_KEY` 时，该轮次会以 `supervisor:model-credential-missing` 拒绝且不写入。fixture（测试前置数据）adapter 只用于测试 overlay（`AUKORA_LIVE_TURN_FIXTURE=1`）；它会接收 parent 选择的 subject 与 privacy policy，且仍不能跳过 parent yes。`8088-inside-out` 仍是空闲 inventory profile。

`aukora-kira` 只为这一轮暂存 turn 挂载 `kira.stage` 与 `kira.recall`，因此空闲 profile 保持它一贯提供的工具集。暂存不授予任何权限：该工具返回一个确定性的 `recordId`，以及写入它所需的惰性 `memory.put` 参数。若暂存记录的 subject 与 privacy 不匹配 parent-owned policy，或 proposal-specific v5 delegation 未绑定该 subject、active control、activation、operation、resource、audience 与 budget，broker 就会拒绝 KIRA write。Recall 只允许模型选择可选的记录类型；broker 拥有 state access 与 Aura citation。

fixture 轮次按顺序执行暂存与写入两跳——先 `kira.stage`，再用回复携带的参数调用 `memory.put`——因此已结算对象是以 KIRA 推导出的 record identifier 存储，而不是调用方自选的 key。单独的无密钥 headless snapshot 会重启 broker 与 guest，再分派 `kira.recall` 并钉住返回的本地 Aura citation。移除该 overlay 条目会改变 overlay 字节，因此启动会在校验阶段、任何 broker 启动之前拒绝。

Recall 不会打开逐次调用的 approval，也不会产生 grant、nonce、receipt 或 Aura effect。官方 Cordis 路径会记录 `kira/recall`，但这条同 UID source launch 无法阻止能够到达 `broker.sock` 的其他 plugin 发送原始 recall frame 而不产生该 session event。Complete mediation 仍需要 OS 或 WASM confinement。

## Web 启动

在 5173 端口运行 loopback Web assembly，或选择另一个端口与 controller directory：

```sh
pnpm aukora:web [--port 1..65535] [--control-dir PATH] [--data-dir PATH] [--review-config PATH] [--operator-home CANONICAL_ABSOLUTE_HOME] [--workspace NAME=CANONICAL_ABSOLUTE_DIR ...]
```

该命令会在 `--control-dir` 创建或认证一个持久的 local AUMLOK controller，默认位置为 `~/.aukora/local-control-v1`，并把存活于单次启动之外的状态保存在 `--data-dir` 之下，默认位置为 `~/.aukora/web-data-v1`。两者不得重叠，任一都不得位于本检出之内，且每个都必须是调用方 uid 拥有、模式为 `0700` 的目录。该数据根保存承载会话与设置的 DSH home、guest home，以及承载 KIRA 对象、回执、Aura 与权限证据的 broker 状态，因此完整的 parent restart 会重新进入它们。其 activation epoch 在该状态旁记录一次，其 broker route 是由该根派生的固定平台位置而非取自 `TMPDIR`，因此同一部署保持同一 activation；声明的其余每个成员仍按次测量，变动的组合、模块、密钥或策略仍被拒绝。`dsh` 会把 home patch 层组合在 staged profile 之上，因此该 DSH home 中的 `cordis.patch.yml` 会在启动时以及每次 guest spawn 时被拒绝，而不会被挂载。它从该 controller 推导 issuer key、KIRA policy 与 proposal-specific grant-v5 authority。五个非 secret projection 字段会绑定到 activation，并通过同源 loopback endpoint 暴露给 AUMLOK browser surface；private key、controller path、broker route、state path 与 approval material 绝不进入 response。同 UID 下的 POSIX owner 与 mode 检查不建立独立的 human-key custody。

默认 preset 暴露 `auma_canvas_read`、`auma_canvas_render`、`kira.recall`、`kira.stage`、`memory.put` 与 `workspace.patch`。操作员配置的 Capsule 暂存会保留这些许可，并仅为 lead 添加 `capsule`，不会为 worker 添加。Launcher 会写出一条供 operator 使用的 `aukora:parent-web-ready:v3` record，其中包含 `READY`、URL、访问模式、observation class、broker/issuer/guest PID、broker/issuer route、state directory、public AUMLOK projection 与 activation artifact。其 `globalTools` 列表并不是会话作用域的工具目录。`SIGUSR1` 只替换 guest，并写出一条 `aukora:parent-web-restart:v2` record，其中包含 `RESTARTED` 与三个 lifecycle PID。URL 与五字段 AUMLOK projection 是 browser input；lifecycle PID、authority route、state directory 与 activation artifact 仍是 parent-side evidence，绝不会进入 Web response 或已执行的 browser content。

`--operator-home` 在同一个 `aukora` preset 中显式启用原生编程：现有文件、shell、后台任务、目标、skill、规划和压缩工具，以及 Council。该路径必须是调用用户拥有的既有规范目录，且组和其他用户不可写。它成为 guest 的 `HOME`，供已安装 CLI 解析认证；`DSH_HOME`、会话、模型、控制器和 broker 状态仍在原位置。该 home 与所选 preset 均进入 activation 测量。保留状态升级和替换启动必须使用相同选项。`OPERATOR_NATIVE_WITH_BROKERED_EFFECTS` 保留 workspace-write 与 ask 默认值；保留的会话策略优先，包括 Full access。原生工具和 worker 不经 broker，不保证每次操作都弹窗，也不产生 AUKORA 结算回执。只有两个 brokered effect 使用所有者弹窗。提供方可用性和计费需要独立证据；启用模式不授权付费调用。参见[操作员模式决策](../../.agents/notes/implemented/feature/2026-09-14-web-operator-coding.zh.md)。

Web parent 只从自身环境转发 `DEEPSEEK_API_KEY` 与可选的 `DEEPSEEK_BASE_URL`。另一个普通 5173 launch 中保存的 credential 不会复用，因为该命令在 `--data-dir` 之下拥有自己的 DSH home；该 home 中 browser 保存的设置现在既能在仅 guest 的 `SIGUSR1` restart 后继续存在，也能跨越指向同一数据根的完整 parent restart。该命令目前不转发 `OPENROUTER_API_KEY`。

无密钥 browser acceptance 会注册真实 workspace 与 session，通过 composer 提交内容，经由 `kira.stage` 和受治理 `memory.put` 驱动 model loop，并在 parent 与 issuer 的 terminal prompt 处提供由测试脚本控制的 decision。它会校验 Aura entry 与 stored object，只重启 guest 并要求 broker 与 issuer PID 保持稳定，再打开新的 browser session，要求 `kira.recall` 在 UI 中渲染精确的 retained Aura citation。其 refusal control 要求脚本化 parent denial 不得增加第二条 Aura entry，并要求损坏的 object 返回 `undetermined / memory-unverified`，绝不能返回 `empty`。这仍是使用脚本 decision 的同 UID v5 test，而不是 attended human approval、OS confinement 或 custody 的证明。

命令会先打印一条 `READY` record。它会重新派生 approval artifact、渲染它并要求 fresh parent challenge，然后转发 issuer 的独立 artifact 提示。只有精确的 `yes <challenge>` answer 才会批准各步骤。`aukora:source-launch-result:v1` record 会携带 `SETTLED`、`REFUSED` 或 `INDETERMINATE`；process 分别以 `0`、`2` 或 `3` 退出。Launch 与 lifecycle failure 以 `1` 退出，不会把可能已经执行的 effect 改称为 refusal。

运行 assembled source lane；该命令会先构建其消费的 Host 与 Client artifact：

```sh
pnpm run test:aukora-parent-launch
```

省略 operation file，可让已组装的进程保持运行，直到收到 `SIGINT` 或 `SIGTERM`：

```sh
pnpm aukora:source-launch /tmp/aukora-launch.json
```

## 可重连的所有者终端

`--review-config` 将两次审批提示移到独立连接的终端。组装进程可以在操作员选定的服务所有者下运行，并关闭 stdin。审批终端断开不会停止 broker、issuer 或 Web guest；recall 仍可用。没有经过认证的终端时，新写入会被拒绝。在 issuer 审批期间失去终端不会发送决定：issuer 会让无人回答的请求到期。新连接只能批准后续操作，不能继续此前连接的审批。

配置是一个精确的 JSON 对象，包含 `domain: "aukora:web-review-config:v1"`、`socketPath`（绝对 Unix 路由）、`subject`（现有 AUMLOK subject）和 `terminalPublicKeyPem`（规范 Ed25519 SPKI）。文件必须是调用 uid 所有、模式为 `0600` 且只有一个硬链接的普通文件；其目录和 socket 目录必须是该 uid 所有、模式为 `0700` 的规范目录。使用独立的终端认证密钥，而不是 controller 签名密钥。系统不会自动生成密钥或服务配置。

连接所有者终端：

```sh
node scripts/aukora-web-review.mjs --config /absolute/review.json --private-key /absolute/terminal.pem
```

issuer 提示的传输时限为 20 秒，低于组装回调的 25 秒时限。broker artifact 提示的时限改为 30 秒，比 broker 自身 35 秒的 IPC 等待早五秒落位，因此该截止时间不可能比等待它的 broker 活得更久：该阶段下游不持有任何签名截止时间，而阅读者必须先看到完整操作才能决定。transport 在启动时会拒绝任何超出该界限的 artifact 窗口，owner UI 也会拒绝任何超出会将其截断的那条 transport 腿的视图窗口。两个窗口都不是无界的，artifact 自身的签名到期时间仍然同时约束两者。客户端渲染精确操作并要求其新挑战值；issuer 审批独立渲染 issuer 的完整帧并要求独立挑战值。签名将两次决定绑定到同一连接、授权摘要、到期时间及精确提示。持有密钥只能认证终端，不能认证人；这条同 UID 路由不建立独立 custody。

### 聊天内审批弹窗

在所有者客户端命令中添加 `--browser`，即可将现有 AUKORA 聊天审批卡连接到所有者传输。命令打开 `http://127.0.0.1:5173`；`--app-url ORIGIN` 可指定另一个明确的回环应用 origin。服务不提供独立审批网站。Parent 与 issuer 分别显示为原生弹窗，每次都需要新的按钮点击。完整的终端格式记录保持可见。签名私钥保留在所有者进程，决定不经过 guest RPC。批准结果不等于结算或回执验证。

```sh
node scripts/aukora-web-review.mjs --config /absolute/review.json --private-key /absolute/terminal.pem --browser
```

API 仅绑定 `127.0.0.1`。应用在发起所有者请求前移除一次性配对 fragment；配对在五分钟后过期。浏览器将有效期八小时的令牌保存在标签页 session storage 中，仅通过显式授权请求头发送到所有者 API；cookie 会跨 localhost 端口泄漏令牌。精确的 Host/Origin 检查、明确的应用 origin CORS 许可列表，以及有大小限制的 JSON 请求约束 API。操作文本在现有审批卡内按字面渲染。它共享应用的浏览器执行环境：不能隔离被攻陷的应用脚本与凭据，不能防护同 OS 身份的其他进程，也不证明人工在场。

提出操作时请保持已配对聊天打开。过期、已取消、重复或陈旧的决定不能批准新请求；浏览器连续十秒未轮询时，待处理审批被拒绝。所有者 API 可为后续请求重连传输，无须重启 guest。传输意外断开后，该服务会以有界指数退避重新挂载同一份已配置传输——六次尝试、约十二秒内完成——随后停在 `disconnected`；显式的 `/api/reconnect` 会以一次立即尝试取代待执行的预算；当该次尝试失败时，退避会从零重新装载，因此其后恢复的传输无需第二次操作者动作。关闭所有者服务只停止审批。对于宿主管理的启动，`--port PORT` 指定所有者 API 监听端口；`--pairing-file PRIVATE_NEW_FILE --no-open` 将私有的一次性 URL 以独占创建方式写入规范的所有者专用目录，而不打开应用。不要将该文件或 URL 暴露给 agent 可见的聊天或共享日志。

Activation 包含审批配置摘要、适配器、客户端、传输实现及所有者浏览器资源。已绑定不同源码字节的非空部署会以 `broker:activation-state-conflict` 拒绝：添加 `--review-config` 并不授权迁移。应使用下述显式升级；不要删除绑定或选择空存储。安装后台所有者仍是独立的操作员在场步骤。

传输断开时，聊天显示 **重新连接审批**。重连清除陈旧显示，只接受后续请求，绝不重新提交决定。浏览器凭据过期或无效时，需要新的私有配对链接。使用 `--review-config` 时，launcher 不会同时从 stdin 读取审批；仅附着终端并不提供备用通道。若要使用终端审批，应停止浏览器审批进程，然后使用相同配置和密钥运行不带 `--browser` 的所有者客户端命令。

## 保留状态的 Web 升级

仅支持 POSIX 的[升级命令](../../scripts/aukora-web-upgrade.mjs) 授权将一个旧版 v1 activation 绑定升级到可重连的 Web 启动。先干净停止现有部署，保留原控制器和数据目录，并准备上述私有审批配置。构建已审阅的 checkout，然后在真实终端中运行：

```sh
node scripts/aukora-web-upgrade.mjs --data-dir /absolute/data --control-dir /absolute/control --review-config /absolute/review.json --port 5090 --workspace project=/absolute/workspace --rollback-bundle /absolute/private-recovery/rollback.json
```

命令通过现有 Web profile 写入器及 ActivationStatement 构建器在临时暂存目录中测量目标；不发布 profile，也不启动服务。它锁定非空 broker 状态，验证目录 seal、Aura/对象/投影证据及已结算 nonce 的消费记录，并通过新的 `upgrade <challenge>` 提示展示完整转换。审批在 120 秒后到期。两个现有控制器密钥共同签署旧绑定 hash、下一份 statement、保留状态摘要、控制器身份、回执密钥身份及新 nonce。原子替换只修改 `activation.json`；普通启动绝不重新绑定存储。

收到 `ACTIVATION_UPGRADED` 后，使用同一 checkout、Node 可执行文件以及相同端口、控制器、数据和审批配置启动 `pnpm aukora:web`。测得的摘要必须匹配批准的 statement。回忆保留的记忆无需审批者；写入需要已连接的所有者及两次全新审批。升级既不启动后台服务，也不修改普通 5173 工作台 profile。

租约占用、证据变化、未解决的 intent、格式错误的 nonce 记录、缺失的已结算消费记录、错误签名者或过期审批都会被拒绝。超过 8,192 个条目或 128 MiB 的存储不在该有界操作范围内。尝试发布后，若结果不确定，会保留租约及完整的旧或新绑定供显式检查：不要移除锁、自动重试或用旧绑定覆盖它。正向命令接受任一种持久化绑定格式——一次性的旧版 v1 记录，或此前一次升级写入的记录——因此存储可以重新绑定到更晚的已测量目标，而无需将其丢弃。已升级的前驱在被接受之前会针对保留的 controller 重新验证，而回滚所恢复的正是其保留的精确字节，绝非重建结果。重新提出存储当前已绑定的 activation 会被拒绝；指向当前 activation 之外任何 activation 的 pin 同样会被拒绝。

记忆对象和键投影检查只适用于已验证的记忆条目；未知效果定义会被拒绝。每个工作区条目都必须有持久化回执，针对保留的 broker 密钥认证，并与 Aura 字段及保留的工作区映射匹配。每个目标仅要求最新结算与当前文件匹配，包括签名观察结果和请求摘要；被替换的历史内容无需留在磁盘上。准备和提交时均拒绝变化、缺失或链接形式的目标。仅含工作区的历史无需伪造记忆对象或键。

同 UID 和 `NO_CUSTODY_CLAIM` 仍然适用。回执认证不证明真人在场或独立托管。旧版记忆历史保留现有证据检查；不会重建缺失的历史签名。控制器签名只授权此次转换。[决策记录](../../.agents/notes/implemented/architecture/2026-09-07-retained-web-activation-upgrade.zh.md) 说明这些限制及失败语义。

在升级与替代启动命令中，为每个别名重复传入 `--workspace NAME=CANONICAL_ABSOLUTE_DIR`。映射进入 activation 测量；遗漏或改变映射会产生不同的 statement。格式错误、重复、非规范路径或指向受保护根目录的映射，在审批或修改保留状态之前即被拒绝。

若要包含编程工作者，两条命令必须传入相同的 `--capsule-config /absolute/capsule.json`。另行准备 `dataDir/capsules`，它必须是现有规范路径、归所有者所有且权限为 `0700` 的私有目录。目标测量要求该目录及非空工作区映射存在，读取保留的 broker 回执公钥，并暂存与启动时一致的工作者、检查、别名及主会话 preset。准备过程不创建该目录，也不调用工作者。仅启用弹窗的升级不授权之后再加入 Capsule。

对于已经建立但从未结算写入的控制器，显式传入 `--expected-previous-activation SHA256`，值为观察到的旧绑定。固定值必须匹配；现有控制器、broker 密钥和目录 seal 仍然必须存在。只有对象、投影、nonce 及回执均无残留时才接受零历史，不会创建历史。

### 预授权的启动失败回滚

可选 `--rollback-bundle` 指定一个尚不存在的文件，其父目录必须是现有规范私有 `0700` 目录，位于控制器和数据目录之外。终端展示两项精确操作；一次回答授权升级及其严格限定的逆向操作。升级前，命令将两份控制器签名授权和原 activation 字节持久保存到该 `0600` 文件。省略此选项会明确警告未预授权回滚。

若替代进程未达到就绪条件，先干净停止它，再从候选 checkout 运行：

```sh
node scripts/aukora-web-rollback.mjs --data-dir /absolute/data --bundle /absolute/private-recovery/rollback.json
```

恢复包在正向操作准备后十五分钟到期。回滚需要空闲的 broker 租约、精确的已签名升级绑定、相同的控制器及 broker 密钥，以及未变化的 broker 所有状态。后续效果、nonce、未解决残留或证据变化均导致拒绝；不会倒退任何数据。精确旧绑定恢复之前，先刷新私有授权审计记录。审计或绑定发布结果不确定时，保留租约及证据供检查，而非自动重试。审计记录本身不证明回滚已完成。

只有收到 `ACTIVATION_ROLLED_BACK` 后，才使用原 Node 可执行文件、参数、工作区映射和保留的 home 启动保存的旧源码。回滚命令不会恢复源码、构建或 profile，不会重启服务、批准写入或丢弃会话与模型。[回滚决策](../../.agents/notes/implemented/architecture/2026-09-14-retained-web-activation-rollback.zh.md) 记录验证及限制。

## 进程与数据所有权

工作区别名是操作者的显式输入。其规范目录不得与控制器、数据、运行时或签名方密钥路径重叠。别名含义进入激活摘要和 broker 的保留映射；映射改变会被拒绝，而不会将先前授权改向新目标。提供别名不会挂载工作区工具或授权写入。

Parent 会创建私有 runtime directory，校验并用本次运行特定的 broker socket 暂存 zero-bundle four-row profile，使用最小环境、issuer route 与可选的 detached KIRA policy 启动 broker，只使用 socket、private-key path 与 expected receipt-key identity 启动 issuer，并使用精确的 process-only environment 启动 Cordis guest。Guest 不加载 project 或 user `.env` layer，只接受直接 parent 发来的精确 `aukora:guest-memory-put:v1` IPC record。Library 只允许一项 active operation，并在 IPC 前截取 lossless JSON snapshot。Parent issuer-approval callback 如果在 25 秒内未完成，assembly 会以 lifecycle failure 终止，且绝不会被报告为 human denial。如果在 launcher 的 80 秒 operation budget 内仍未收到 terminal guest result，launcher 会终止 guest 并返回 `INDETERMINATE`。

Library parent 可以提供 `createSubjectAuthority(activationDigest)` 作为静态 context，或提供成对的 `selectSubjectAuthority(request, signal)` 与 `subjectAuthorityExpectation` 作为 proposal-specific context。Web assembly 要求 proposal-specific 形式，并验证它命名 projected active AUMLOK control 与 KIRA policy。Detached context 只到达 broker；guest、issuer 与返回的 assembly handle 都不会收到它们。非 Web launch 在两种形式都省略时选择 v4。

任何 child 启动前，parent 会测量并校验一份 closed [`ActivationStatement`](../activation/statement.mjs)，并只把该 statement 作为其 digest 传给 broker。Broker 把该 digest 绑定在自己的 state 中，在 grant verification 能够保留 nonce 之前比较，并在 effect 之前再次比较。第一次比较不一致时会 `REFUSED` 且不消费 authorization；reservation 后 binding 发生变化时会返回 `INDETERMINATE`，且 effect 尚未开始。该 statement 包含精确 static issuer/broker graph 中的每个 module、graph selector、assembled composition、显式 executable 与 source-resolver anchor、proposal cell、所选 parent renderer 的 SHA-256 identity、model-emission policy、两个 key identity，以及启用 recall 时的 KIRA recall-policy digest。该 policy digest 会提交所选 subject 与 privacy class，但 activation v1 不会独立提交完整 delegation context。每个成功的 v5 action 及其保留的 authority-evidence record 都会把该 context 绑定到 activation digest。每次启动 guest 前（包括替换 Web guest），parent 都会重新测量完整 statement，并要求它仍生成原 activation digest。Web restart 会在停止当前提供服务的 guest 前先检查一次，并在 replacement 执行前立即重复检查。该 statement 不会递归证明 Node built-in、dynamic import、已安装 package artifact、operating-system behavior，或最后一次测量与 process execution 之间发生的 source change。Ready artifact 中的其他 hash 仍然只是描述性的。这个结果是 `SOURCE-INSPECTED`，而不是 installed-custody attestation：每个 child 仍以 parent 的 UID 运行，因此暂存 profile 与受保护 state 仍可被共享 UID 改写，任何 activation check 都无法据此建立 custody。[Launch-downward observer](../../ops/launch-downward/README.zh.md) 仍是 distinct-principal custody 的 non-activating specification。
