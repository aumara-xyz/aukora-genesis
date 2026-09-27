# @deepseek-ai/dsh-aukora-memory

[English](README.md) | 中文

受治理的 `memory.put` 与可选的 `workspace.patch` 工具使用现有的 broker 所有的提议、审批、结算、receipt 和 Aura 路径。默认导出只挂载记忆工具；`./workspace-patch` 入口单独挂载文件替换工具。

本包**不包含签名 primitive，也不会接收 root key**。独立的 issuer daemon（`aukora/issuer`）会加载外部配置的 root-key 文件。密钥排除取决于实际部署的进程与文件系统 custody，而不是挂载本插件。

默认记忆集成使用 broker 所有的 proposal route；broker 的启动配置选择 grant v4 或绑定 subject 的 v5。ToolRuntime 把 executing argument 重新绑定到 pre-execute operation 后，本包会让这些 argument 通过 digest-pinned、proposal-only WebAssembly cell，验证 cell 的 closed output field、module digest、tool name、canonical encoding、key grammar，以及它与两份 argument snapshot 的精确一致性，然后只把重新解析得到的 `key` 与 `value` 交给 broker。本包接收 broker socket，打开由 broker 所有的重试 namespace，递交精确参数，并观察 `PENDING`、`SETTLED`、`REFUSED` 或 `INDETERMINATE`。已结算结果包含公开的已签名 receipt；grant 与 issuer route 仍归 broker 所有。Receipt 字段是证据，不是执行另一项效果的授权。Guest 的 Cordis approval chain 不会参与此 proposal route，也不能授权它。Broker 会在联系 issuer 前，把精确 operation 发送给其 launch parent 审阅。`bridge.ts` 与可选的 `issuerSocket` 配置暂时保留 grant-v3 bearer family，且仅作为迁移其 courts 期间的回归 oracle。已发布的 `profiles/8088-inside-out` 组合不会配置该旧 route。

`GovernedMemoryService.inspectReceipt()` 通过同一个 socket，为凭证查看器暴露一项内部读取调用。它接收 Aura 条目记录的 64 位十六进制 `receiptSha256`，返回一个 `ReceiptInspection`，把四件事实分开：链记录了什么已完成结算、哪些证据存在、验证器的结论及其具名 reason 与 ceiling，以及证据显示是谁批准的。它只读取 broker 本就持有的内容，不写入任何东西，也不结算任何东西。`NON-CONFORMING` 结论是结果而非失败：本仓库未注册所有者密钥，因此一次结算的审批类别是 `unattributed`。原始导出字节除非调用方索取，否则不予发送，因为它们携带操作参数与路径。

`./receipt-view` 入口在 Web 服务器上为所有者指定的端口挂载浏览器页面及其两个端点。页面把四件事实分在互相独立的分组中呈现，并把原始导出的保存操作放在一段披露之后，披露说明这些字节包含什么。端点只应答携带 `x-aukora-viewer: 1` 的同源 JSON POST，在任何查找之前校验标识符，并通过已配置的 socket 触达 broker，因此运行中的 guest 不需要第二套传输，也不需要额外的密钥。任何格式不正确的请求都会在触达 broker 之前被具名拒绝。

`GovernedMemoryService.recallKira()` 通过同一个已配置 broker socket，为 KIRA 包暴露一项内部读取调用。它只发送一个可选的、由模型选择的记录类型。Broker 会提供由 parent 配置的不透明 subject selector 与 privacy policy，验证本地 Aura chain、sequence witness、object inventory、projection、object digest 和 KIRA record，应用固定的全结果上限，并返回指向已验证本地 head 的 citation。该 selector 没有经过认证，也未绑定到 AUMLOK identity。Client 会先验证并分离封闭回复，KIRA 才能记录或展示它。该服务方法既不暴露 broker 配置或 state，也不携带 authorization artifact。

挂载任一入口都不会治理其他工具：同时组合已发布 `dsh-base` 组合包的宿主保留其其他能力及各自的策略。[8088 就绪性](../../../docs/8088-READINESS.zh.md)所述的失败闭合清单属于该受限组合，而不是本包。

`ENOENT` 和 `ECONNREFUSED` 会报告不可达的 broker 路由，以及请求是否已提交写入。在请求写入之前，诊断说明尚未检查保留的记忆；在写入之后，诊断说明未观察到回复，并保留结果的不确定性。socket 不可达不代表记忆缺失或损坏。其他传输失败和 broker 拒绝保留原有分类。恢复过程不会自动移除保留的写入者租约。

## 模型体验

### 可选的工作区替换

#### 模型所见内容

使用 parent 提供的 `brokerSocket` 挂载 `@deepseek-ai/dsh-aukora-memory/workspace-patch`。可选的 `proposalPollIntervalMs` 控制观察间隔；`reviewLimitBytes` 默认为 8192。此选择不改变其他已交付 preset；受治理的 Web profile 挂载此入口，`aukora` lead preset 通过 `additionalInheritedTools` 接纳它，同时仍剪除其他所有环境工具。模型看到 `workspace.patch`，其必填字段为 `workspace`、`path`、`beforeSha256` 和 `content`：operator 配置的工作区别名、相对文件路径、精确的先前摘要或表示创建的 `null`，以及替换用的 UTF-8 文本。适配器验证精确字段与字节上限，然后调用 Capsule 使用的同一 `BrokerProposalClient.settleWorkspacePatch` 路径。它不执行文件系统写入，也不提供 grant 或审批。Broker 要求 v5 subject authority、operator 根目录映射、精确操作审批，以及匹配的先前字节。已结算回复携带 broker 的 receipt。适配器只传输它，不在此独立验证签名。拒绝与 indeterminate 结果保持区别，取消观察不会撤销已提交的效果。缺少 broker 或审批基础设施会拒绝；挂载此入口绝不会以 guest 审批弹窗替代 broker 的授权路径。通用工具卡显示提交的参数与结果，不声称经过人类现场审批。

#### Token 影响

可选 schema 带来固定请求成本。提交的替换文本与返回的 receipt 字节进入普通工具 transcript。

#### KV Cache 影响

组合不变时，定义的前缀保持稳定；调用参数与结果追加到历史中。

### 工具定义

#### 模型所见内容

模型会看到一个名为 `memory.put` 的工具，其描述为 `Write one value under one name in the governed memory store. Requires parent review of the exact write before settlement.`，并包含两个必需参数：`key`（string）和 `value`（json）。准入只接受一个恰好具有自有、可枚举数据属性 `key` 与 `value` 的普通对象；缺失或为 `undefined` 的 value、数组、访问器、自定义 prototype，以及任何字符串、symbol 或不可枚举 rider，都会在提示、签名、nonce claim 或 effect 之前以 `arguments-not-exact` 拒绝。该定义不在[生成的工具目录](../../../docs/tool-catalog.zh.md)中：该目录的完整性 guard 使用 glob `packages/*/tool-*`，其声明范围是已发布的产品工具，而本包两者均不属于。因此，上述字面量直接引用自 `src/index.ts`，并且必须随之更新。

#### Token 影响

工具可见的每次请求都会承担固定 schema 成本。该 schema 包含两个参数和一个句子，因此成本很小，且不会随存储内容变化。

#### KV Cache 影响

只要定义和可见性不变，前缀就保持稳定。存储内容永远不会进入 schema，因此写入 memory 不会使前缀失效。

### 工具调用历史与结果

#### 模型所见内容

成功的 proposal 调用会以 JSON 返回 broker 的公开 `{ ok: true, proposalId, state: "SETTLED", receipt }` 投影。Broker 保留 grant，持久化已签名 receipt，并把其摘要与 effect observation 记录到 Aura。Client 传输 receipt，不独立验证其签名。拒绝会以 `Error: memory.put refused: <reason>` 到达模型。如果 broker 已接受 proposal 但 guest 未能观察其终态，系统会报告 `Error: memory.put: indeterminate — <detail>`，绝不会将其伪装成拒绝或成功。不确定的 nonce claim 会通过该 indeterminate 格式报告 `grant:nonce-claim-uncertain`，即使 effect 尚未开始；授权可能已经消费，系统绝不会自动重试。联系 broker 之前抛出的本地授权失败使用相同的 `Error: memory.put: <message>` 格式。

#### Token 影响

调用参数会保留模型提交的完整 `value`，并在压缩（compaction）发生前一直留在历史中，因此 token 增长量随写入内容而变化。公开终态投影包含 receipt，因此输出成本随这些字段变化。

#### KV Cache 影响

仅追加；receipt 和任何错误都位于可复用请求前缀之后，不会使已有 KV-cache 条目失效。

## 已知限制与延期工作

- 工作区入口只暴露现有的单文件替换操作，不支持任意命令、删除、目录创建、凭据或网络效果。其准入独立于其他已挂载工具，不构成进程约束。Broker 自身的效果内容与传输上限仍具有权威性。
- WebAssembly cell 只有一个 host callback，不接收 WASI 或 ambient import。它会分离 proposal data；它不会持有 key、签发 grant、执行 `memory.put`，也不会约束 native Node guest、embedder、broker、issuer 与其他 tool。除非单独的 OS 或 runtime mechanism 移除这种 reach，否则恶意 Node plugin 仍可导入 ambient host API，并绕过 cell 直接连接 broker socket。对于任何被接受的 proposal，parent review 仍是 load-bearing authorization backstop。
- 进程身份由启动配置决定；同 UID 执行只是进程隔离，绝不是 OS 约束。Broker 会为每项 settlement 重新测量 state leaf 与配置的 peer-token denial，并在连接证明 separation 时再次测量该 denial。Broker 可读的 token 会把连接降为 `state-owned`；已经 seal 为 `peer-separated` 的 state 会在 nonce claim 或 effect 前拒绝较弱请求。更高 seal 会通过已 flush 的暂存文件和原子同目录 rename 发布，并且发生在 prepared marker 或 effect 开始之前。这些检查不会识别 peer UID、阻止 relay，也不会检查 ACL 与上级目录。[Launchd custody 安装器](../../../ops/launchd/README.zh.md)会配置不同的 broker、issuer 和 guest principal；挂载本包不能证明运行中的应用使用了它们。
- Grant v4 会把已签名 grant 保留在 broker 内，并把它绑定到 `receiptKeyId`，即 broker receipt 公钥 SPKI DER 字节的 SHA-256 标识。持有不同 key 的 broker 会在消费 nonce 之前拒绝。该机制命名一项 key identity，而不是某个进程或 state directory；复制同一份 key material 并配合独立 nonce book，仍可让同一 grant 结算两次，因此本文不声称全局 at-most-once execution。Grant v3 的回归专用 route 保留同一限制。
- 本次 Darwin 修订没有当前 Linux 测量。在 macOS 上，不同 UID court 会打印 `observationClass: SKIP` 并以 77 退出；本文不继承此前的 Linux 结果。
- Issuer 拒绝以 root 身份运行，拒绝不属于其 effective UID 的 root-key descriptor，也拒绝不属于该 UID 的直接 socket 父目录。其 developer listener 要求仅 owner 可访问的 `0700` 或更严格 parent 与 `0600` socket。其已安装的组访问模式则要求 owner 持有的 `0710` parent，并发布 `0660` socket。[Launchd 拓扑](../../../ops/launchd/README.zh.md)负责组配置与 route 观察；包测试不能证明已安装的隔离。
- 超过 UTF-8 字节上限的 broker frame 会以 `broker:frame-oversize` 拒绝并终止该连接。Caller 必须建立新连接；被拒绝的连接不能承载后续请求。
- effect 后失败会如实报告为 indeterminate。面向进程重启的 prepared-marker reconcile **已经**实现：`aukora/broker/broker.mjs` 在 effect 之前写入一项精确的 `<stateDir>/intents/<nonce>.json` 记录，并在结算后清除。启动时，`reconcileIntents()` 会分类目录中的每一个条目；有效 unresolved marker 或任何 malformed residue 都会阻止 serving，同时保留原始字节。marker 只能证明清理未完成；effect 与 Aura 的结果各自都是 `INDETERMINATE`。清理只忽略 `ENOENT`，因此其他 unlink 错误会成为 effect 后 `INDETERMINATE`。`courts/harness/intent-reconciliation/run.mjs` 通过 R1–R8 行检验这些行为，并带有真实的 source mutation arm。结算请求会串行化，但 marker、effect、Aura、sequence 和清理并不是一项共同 fsync 的主机崩溃事务。针对实时 broker 各个故障点的完整 fault court battery 仍未完成。
- 追加 Aura 后，broker 会使用重新读取的对象调用现有 receipt verifier，并在返回 `SETTLED` 前检查当前 key projection、精确 Aura entry、sequence witness 以及必需的 v5 authority record。该检查始终在串行结算操作内执行，后续同 key 写入只能在检查完成后替换 projection。检查失败会保留已消费的 nonce 与 prepared marker，并报告 `INDETERMINATE`。这是 broker 本地的一致性观察，不是独立 custody，也不能证明本次调用创建了原先不存在的字节。
- Broker 启动时，v4 proposal route 要求存在 parent review callback。如果缺少该 callback，`proposal.open` 会以 `broker:review-channel-unavailable` 拒绝。授权还要求已绑定的 activation digest 与 renderer identity；否则会在联系 issuer 前以 `broker:activation-unbound` 或 `broker:renderer-unbound` 拒绝。Broker 会冻结一条封闭的 `aukora:review-request:v2`，其中包含 approval artifact、`artifactDigest`、review identifier、proposal identifier、operation digest、authorization digest 与 expiry。Launcher 只返回 `approved` 或 `denied`，并通过 child-process IPC 回显 identifier、artifact digest 与 grant digest；缺失、拒绝、malformed、超时、不匹配或中断的 decision，都会在 issuer contact、nonce claim、effect 或 Aura append 前被 broker 拒绝。Broker 停止等待时，cancellation frame 会在下一项 review 打开前中止 parent callback。该 callback 是 process-owned interface，不是已部署的 trusted renderer、human-authentication mechanism、durable approval record 或 OS custody boundary。
- 除非 launch parent 在启动 broker 时提供一项封闭的 subject/privacy policy，否则 KIRA recall 保持禁用。Subject 是不透明 selector，而不是经过认证的 AUMLOK identity；它也独立于 `kira.stage` 接受的模型所提供 subject/privacy 字段。缺失 policy 会以 `broker:kira-recall-unconfigured` 拒绝；malformed policy 会让 broker launch 失败。模型只能按记录类型收窄，不能扩大 subject、privacy、bounds 或 state scope。Recall 的 `verifiedHead` 是本地 broker 证据，不是外部 witness 或 off-host latestness claim。结果最多包含 4096 个 index entry、16 MiB Aura ledger、16 条返回记录与 48 KiB 完整记录字节；超限结果是 undetermined，而非被截断。
- KIRA recall 没有逐次调用的 grant、nonce、parent 或 issuer approval、receipt 或 Aura effect。官方 Cordis 工具会追加必需的 `kira/recall` session event，但 broker socket 不会认证该 caller。在 OS 或 WASM confinement 移除 ambient socket reach 之前，恶意同 UID plugin 可以发送原始 recall frame，并在不产生 session event 的情况下获得结果。
- pending operation 保存在 composition-owned store 中，而不是可注入的 Cordis service。已挂载的 `aukora.memory` service 不暴露该 store 或其 config object；broker、可选 legacy issuer、review-limit、proposal-poll 与 KIRA subject/privacy 输入都在组合时固定。caller cancellation 或 plugin disposal 会结束 guest observation，但 broker 已接受的 proposal 仍归 broker 所有；除非观察到终态，否则必须报告为 indeterminate。
- Client 会在递交 proposal 前，根据 execution argument 与 pre-execution expiry 重新计算其 guest-local operation digest。该检查用于发现 ToolRuntime 内的 argument 变化，不是 human review。Broker 会独立构造由 parent 审阅的精确 operation，包括 broker 自己的 expiry。Broker 的精确拒绝属于 `REFUSED`；deposit frame 一旦写出，任何丢失、超限、malformed 或中断的 reply 都属于 `INDETERMINATE`，因为 broker 可能已经接受它。
- Proposal retry state 刻意只存在于进程中，并且容量固定。一个 broker 最多接收 16 个 namespace 与 16 个 proposal occurrence，绝不 evict terminal occurrence，并在 restart 前拒绝继续分配。这是 prototype availability ceiling，不是 production throughput design。
- 在 v4 route 中，parent review callback 与 issuer prompt 是两个独立的 approval interface。Parent 会接收 approval artifact，并返回 load-bearing exact-operation decision。Grant v4 随后把该 artifact 与 authorization digest 发送给 issuer；issuer 会重新派生并渲染该 artifact，然后只签名已经 admit 的 digest。Issuer 仍然无法证明所签名的 digest 覆盖该 artifact，因此这不是 display 到 grant 的密码学绑定。两字段 digest-only authorize 路由仍供 court 使用，并会明确说明未显示 operation。Issuer 通过其 approval carrier 只接受一行以换行符终止且内容精确等于 `yes <fresh-challenge>` 的输入。一项请求拥有可见的 issuer 提示；并发连接会以 `issuer:approval-busy` 拒绝，连接断开会取消活动提示，陈旧输入会被丢弃，carrier 丢失会拒绝活动请求和后续请求。Generic parent callback 不会认证 person，精确 challenge text 本身也不能证明人类在场。[Operator seat](../../../ops/launchd/README.zh.md)连接已安装的 review 与 issuer carrier；源码中存在它不能证明 seat 已连接或操作经过人类现场审批。
