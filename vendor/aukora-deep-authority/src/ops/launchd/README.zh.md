# 本地 launchd custody pair

[English](README.md) | 中文

此目录包含用于配置 issuer/broker custody 前置条件的 macOS LaunchDaemon 模板与示例输入。[`scripts/install-launchd-custody-pair.mjs`](../../scripts/install-launchd-custody-pair.mjs) 创建或验证三个 service principal，安装两个 daemon，把 authority 实现部署到 checkout 之外，并执行主动跨 principal probe。成功报告的 status 为 `PROVISIONED_DAEMON_PAIR`；它不是完整产品或 custody 声明。

## 已安装拓扑

Installer 创建精确的隐藏且禁止登录的 broker、issuer 与 guest account，并为它们分配互不相同的数值 UID。它创建不同的 broker route group 与 issuer route group。在这两个受管理的 route group 中，guest 只属于 broker route group；broker 同时属于两者；issuer 只属于 issuer route group。

只有 broker 与 issuer 获得 LaunchDaemon job。它们的固定 route 分别为 `/private/var/db/aukora/run/broker/broker.sock` 和 `/private/var/db/aukora/run/issuer/issuer.sock`，broker 还在自己的 route 旁发布第三个节点，即 review route。该 route 以 `0600` 而非 `0660` 发布：其父目录的组包含 guest，因此该 mode 正是把 guest 挡在批准通道之外的东西。installer 不对它做 custody 观测，也不做探测。直接 socket parent 由对应 service account 和 primary group 所有，mode 为 `0710`；socket 按[已安装任务的组 socket 策略](../../.agents/notes/implemented/architecture/2026-08-30-installed-group-socket-policy.zh.md)以 `0660` 发布。模板刻意省略 `StandardOutPath` 和 `StandardErrorPath`；它们不会打开由 service 所有的 log leaf，process output 由 launchd 的默认处理方式接管。Guest identity 的存在是为了让 installer 在未来 guest 的数值 principal 下执行拒绝和允许 route；当前没有 guest job。

每个生成的 job 都使用显式的 `implementationRoot`。Installer 把冻结 verifier graph、其 selector、封闭 custody helper、允许的 Noble 依赖包和一份 canonical manifest 复制到 `/private/var/db/aukora/implementation/` 下的 content-addressed directory；该目录 basename 必须等于 manifest SHA-256。部署的 directory 必须由 root 所有且 mode 为 `0555`，file 必须由 root 所有且 mode 为 `0444`。Custody 检查拒绝所有 extended ACL，包括仅含 deny 的 ACL，也拒绝无法完成的观察；它不会移除 ACL。安装前后，运行时字节必须与 operator 指定的 `nodeSha256` 匹配。报告把观察到的运行时与实现标识一起计算摘要，但不 attest 已加载页面、动态库或已加载环境。Live argv 确认 executable 与 entry module。这些观察既不是 off-host custody，也不能抵御 root。

## 输入与操作

[`custody-pair.example.json`](custody-pair.example.json) 是封闭输入格式。先把它复制到未跟踪路径，确认或选择未使用的数值 ID，为这些精确的 staged file 保留 content-addressed `implementationRoot`，并在 apply 前检查每个 absolute path。Frozen graph、selector 或 custody helper 的任何变更都需要新的 manifest digest，从而需要新的 implementation leaf。只有当观测到的 identity 和内容精确一致时，installer 才接受既有 account、group、job、directory 或 implementation file；installer 不删除或修复冲突的 host state。

`v2` 输入要求提供 `nodeSha256`。示例中的全零值故意不能用于实际安装：apply 前，请用经独立检查后选定的运行时摘要替换它。旧版输入文档会被拒绝。给未知 executable 计算摘要并不使其可信。 示例中的 `reviewServerId` 同样是占位值：它是终端所固定的身份，请替换为本主机独有的值，而不要照抄示例。

`--apply` 还要求终端公钥在运行之前就已就位。installer 会创建归 root 所有的 `/private/var/db/aukora/review/` 目录，但从不写入该文件，也从不接触终端私钥：请自行放置公钥的那一半，归属 `root:wheel`，mode 为 `0644`，路径为 plan 中的 `reviewTerminalPublicKeyFile`。root 所有权正是阻止 broker 替换约束它的那把 key 的东西。缺失、归属错误或非 Ed25519 的 key 会在 provision identity 期间拒绝，早于任何一个 property list 被写入。

activation statement 以同样的方式放置在同一个叶子目录中。它记录 broker 将要运行的已部署 implementation 的各项 digest，以及由启动方声明的选择：composition、proposal cell、renderer、model-emission policy，以及 issuer 与 broker 身份。其中的 digest 是测量得来的；那些选择则是操作者自己负责的声明，因为已安装的 broker 所治理的 composition 本身并未被安装。

```bash
sudo install -d -o root -g wheel -m 0755 /private/var/db/aukora/review
sudo install -o root -g wheel -m 0644 terminal.pub /private/var/db/aukora/review/terminal.pub
sudo install -o root -g wheel -m 0644 activation.json /private/var/db/aukora/review/activation.json
```

```bash
cp ops/launchd/custody-pair.example.json /tmp/aukora-custody-pair.json
```

请从一条其每一级祖先目录都归 root 所有、不可被组或其他用户写入的安装路径运行 `--apply`；否则该 mutating path 会拒绝 `launchd-install:invocation-tree-untrusted`。`--check` 从不走这道关卡。

请用 [`scripts/stage-launchd-operator-seat.mjs --prepare`](../../scripts/stage-launchd-operator-seat.mjs) 准备该路径，而不是复制一份 working checkout。准备过程无需特权，其 source 取自某一个已解析 commit，因此未提交的改动、未跟踪文件、`.env`、session 以及用户的 Git hook 与配置都无法进入结果。每一次 pinned Git 读取都运行在环境 allowlist 之下，因此 `GIT_DIR`、`GIT_OBJECT_DIRECTORY` 以及其余 repository、object、index 与 work-tree 指针都无法把 pinned 读取重定向到另一个仓库；每次读取还会确认自己解析到的 working tree 正是预期的那一个。它不运行任何包管理器，因此在任何权限级别下都不会执行 install hook。依赖会以字节形式写入准备好的路径内部；若某条路径向其他仓库借用 Git object、携带逃逸到自身之外的 symlink，或无法用自己的 stager 复现 seat manifest digest，该命令都会拒绝。

```bash
node scripts/stage-launchd-operator-seat.mjs --revision <commit> --prepare /tmp/aukora-prepared
```

随后 operator 把该准备好的路径置为归 root 所有，并从那里运行特权命令。只有以下步骤需要特权：

```bash
sudo install -d -o root -g wheel -m 0755 <repo-root>
sudo cp -R /tmp/aukora-prepared/. <repo-root>
sudo chown -R root:wheel <repo-root>; sudo chmod -R go-w <repo-root>
sudo node <repo-root>/scripts/install-launchd-custody-pair.mjs --inputs /tmp/aukora-custody-pair.json --apply
sudo node scripts/install-launchd-custody-pair.mjs --inputs /tmp/aukora-custody-pair.json --check
```

两种 mode 都要求 Darwin 且 effective UID 为 0。`--apply` 会创建缺失的 managed record 和 file，通过以最终 service principal 运行的 helper 配置 issuer 与 broker key，安装两份 property list，先 bootstrap issuer 再 bootstrap broker，并观察结果。成功的 `--check` 不留下 durable provisioning change：它会获取并移除 root-owned exclusive installer lock，并执行主动 key 与 socket observation。中断可能留下 fail-closed `/private/var/db/aukora/.install.lock`，operator 必须先检查并移除它，才能再次运行。失败的 apply 可能留下可供检查的 account、group、directory、key、implementation file 或 property list；如果后续观察失败，它只回滚本次调用加载的 job。

Installer 会验证每个 live job 的 PID、数值 UID、Node executable 和 authority entry module。随后它要求以下 positive control：guest-to-broker 可以连接、broker-to-issuer 可以连接、issuer 可以打开其 private key、broker 可以打开其 state key。它还分别要求 guest-to-issuer、issuer-to-broker、broker-to-issuer-key、guest-to-issuer-key、guest-to-broker-state 与 issuer-to-broker-receipt-key 返回 `EACCES` 或 `EPERM`。路径缺失不被接受为 deprivation evidence。

## 仅使用生成器

当 operator 只需要经过验证的 property list 时，仍可使用 [`scripts/generate-launchd-jobs.mjs`](../../scripts/generate-launchd-jobs.mjs)。其输入要求同样显式的 `implementationRoot`、不同的 principal 与 route-group 名称、不同的 route parent、规范的 Ed25519 public key，以及 checkout 外的 state 和 secret path。它转义 XML value，拒绝不安全 label 和未解析 placeholder，通过 `/usr/bin/plutil -lint` 验证两份 property list，并且排他创建 output leaf，不跟随 link，也不替换既有 entry。

生成只验证声明的输入；它不会解析数值 identity、创建 host state、加载 job 或运行主动 probe。Generator report 不是 `PROVISIONED_DAEMON_PAIR` evidence。

## 审核适配器

[`serveBrokerWithTerminalReview`](../../scripts/launchd-broker-review.mjs) 通过有界 Unix-socket 传输提供现有 broker 的 review callback。终端保留自己的 Ed25519 private key；server 只固定其 public key。签名回答绑定连接、role、route、review/proposal ID，以及 artifact/operation/authorization digest。终端缺失、断开连接、陈旧回答或超时都会拒绝。测试使用脚本化的终端与 issuer fixture。[`scripts/launchd-broker-entry.mjs`](../../scripts/launchd-broker-entry.mjs) 是 broker job 的程序，从 launchd 环境到达该适配器；launchd 无法提供独立 broker 所读取的 parent-IPC review callback。该入口要求 review route，缺失时以 `launchd-broker-entry:review-route-required` 拒绝，因此已安装的 broker 无法在未经审核的状态下启动。plan 携带 review route、操作者放置的终端公钥以及固定的 route 身份，installer 将它们渲染进 broker job。该公钥文件由 root 拥有，位于 `/private/var/db/aukora/review` 之下：broker 在启动时读取它一次，却无法替换它，因为能够替换它的 broker 就能为自己制造批准；因此轮换或吊销该 key 只有在 broker job 重启后才生效。installer 从不创建该文件，也从不接触终端私钥。生成的 job 携带 activation digest，而该 digest 是传输而非证据：入口从 implementation root 内的一个固定名称读取保留的 `ActivationStatement`，要求它命名 broker、入口、review 适配器、传输以及 activation 模块，对每个成员按已部署的字节重新测量，并且除非重新测量出的 statement 恰好摘要为该 job 所携带的值，否则拒绝。statement 的路径与它所测量的解释器都是推导出来的而非配置出来的，因此 property list 两者都无法选择。installer 在任何一个 property list 被写入之前执行同样的测量。没有任何被测量的 statement 能产生的 digest 永远不会到达 broker，而任何 authority 字节的改变都会改变该 digest。在该绑定之下，渲染出的程序会 settle 一次经过审核、由 issuer 授权的 memory effect；这是通过用渲染出的环境运行它、并在只包含已部署字节的 implementation root 上测得的。下述操作者终端把 issuer 载体接入这一已认证审核会话。guest 启动器以及有人参与的已安装运行仍未经测量。持有 key 认证的是终端会话，而不是个人。

## 暂存操作者 seat

[`scripts/stage-launchd-operator-seat.mjs`](../../scripts/stage-launchd-operator-seat.mjs) 会发布一棵归 root 所有的目录树，供 attach seat 使用。它只暂存既有的 entry，不做别的：不启动任何 service，不连接任何 route，也不批准任何东西。

Source 字节来自 `git cat-file` 在某一个已解析 commit 上的读取，绝不取自 working tree，因此未提交的改动无法进入该 artifact，报告中也会说明 tree 当时是否为 dirty。依赖字节不在 Git 中，因此取自本 checkout 已安装的 package，走的是 installer 使用的同一套 snapshot：它通过 pnpm 的 symlink 读到真实路径，并拒绝任何不是精确常规文件的条目；manifest 以 version 和逐文件 digest 对其进行 pin。Manifest 记录 source commit，其 digest 即 staged root 必须使用的 basename，因此 `--check` 会重新计算期望的 root 并进行比对。

```bash
node scripts/stage-launchd-operator-seat.mjs --revision <commit> --root /private/var/db/aukora/seat/<digest> --check
sudo node scripts/stage-launchd-operator-seat.mjs --revision <commit> --root /private/var/db/aukora/seat/<digest> --apply
```

先用任意占位 digest 运行 `--check`：拒绝信息会给出该 root 必须携带的 digest。seat stager 的 `--check` 不走 admission 关卡，因此它始终可在无特权、只读的前提下使用；也正因如此，`--check` 通过并不预示 `--apply` 会被准入。installer 的 `--check` 则是另一回事：它会执行主动的 key 与 socket observation，并且要求 root。

`--apply` 从上文所述的、准备好的安装路径运行，而不是从 working checkout 运行：

```bash
node scripts/stage-launchd-operator-seat.mjs --revision <commit> --prepare /tmp/aukora-prepared
```

准备报告会给出 commit、每个依赖及其 version，以及该准备路径复现出的 seat manifest digest。

`--apply` 采用与 installer 的 `--apply` 相同的 invocation-custody admission，并且在读取 revision 之前、在快照依赖之前、在产生任何文件系统副作用之前就先执行：其运行所在安装路径的每一级祖先都必须归 root 所有、不可被组或其他用户写入，否则会在什么都没做的情况下拒绝 `launchd-install:invocation-tree-untrusted`。满足它的 bootstrap 就是上文那一条——把安装路径置为归 root 所有，并从那里运行特权命令。它没有 override，manifest digest 也不是 override：命令针对自身输出计算出的 digest，只说明会暂存哪些字节，绝不表示暂存已获批准。通过准入后，`--apply` 会以 root 所有、`0755` 创建 `/private/var/db/aukora/seat`，并通过 installer 自身的发布路径，以 `root:wheel` 发布 `0444` 的文件与 `0555` 的目录。已存在的 root 绝不会被重写，只会被观测，因此已经不一致的 staged root 会被报告而不是被修复。

每份报告各自保留其残余限制。`--apply` 带有 `installation-path-bytes-unattested`：admission 确立的是对执行路径的 custody（由 owner 放置），而不是对其内容来源的证明。`--check` 带有 `check-mode-admission-not-taken`。两者都带有 `attended-seat-attachment-not-performed`：暂存只让 seat 变得可运行，仅此而已。

## 操作者终端

在仓库根目录运行 `node scripts/launchd-operator-review.mjs --help` 查看精确命令。已安装模式要求 Darwin 和 root；attach 还额外要求其运行所在目录树的每一级祖先都归 root 所有、不可被组或其他用户写入，否则拒绝 `aukora:operator-review:invocation-tree-untrusted`。位于用户主目录下的 checkout 会在主目录这一级失败，`/private/tmp` 会因 mode `1777` 失败。`--check` 不走这道关卡，因此在不受信任的目录树下 preflight 通过，并不表示 attach 也会通过。请先按上一节暂存 seat，并从那棵目录树 attach。需提供现有的 root 所有 custody plan、与 plan 中公钥匹配且归 root 所有并设为 `0600` 的终端私钥，以及已经配置的 issuer 专用组。issuer route group 不适用，因为 broker 也属于该组。命令拒绝其他成员、嵌套组、extended ACL、可写祖先目录以及已被占用的批准 route；它不配置身份、不替换 key、不移除既有 route，也不重启服务。

```bash
sudo node scripts/launchd-operator-review.mjs --inputs ABSOLUTE_JSON --private-key ABSOLUTE_TERMINAL_PEM --approval-group ISSUER_ONLY_GROUP --check
sudo node scripts/launchd-operator-review.mjs --inputs ABSOLUTE_JSON --private-key ABSOLUTE_TERMINAL_PEM --approval-group ISSUER_ONLY_GROUP
```

大写参数是操作者需提供的值，并非示例文件。plan 必须指定固定的 issuer 批准 route，并设置 `issuerApprovalSocketUid: "0"`。broker 必须已在 plan 的审核 route 上提供服务。`--check` 只检查前置条件，既不连接也不批准。终端报告就绪后，任何必要的 issuer 部署或重启都是另行进行的有人参与操作，并须使用相同 route。Ctrl-C 关闭终端及其自己的 socket，不停止任一 daemon。

一次 broker 产物批准只允许在截止时间前发起一个匹配的 issuer challenge。终端单独渲染该 challenge，不会自动批准。断开连接会丢弃尚未使用的批准。`scripts/launchd-issuer-review.spec.ts` 在一次性状态上运行生产 broker、issuer 进程、签名与操作者传输，包括 KIRA settlement 和 broker 重启后的 recall。只有终端决策是脚本化的。这不证明已安装 UID 隔离、人工参与或 operational AUMLOK 身份绑定。

## 声明上限

已安装 pair 是 OS-confined product path 的一个前置条件。它不完成 [Wayfinder issue #3](https://github.com/aumara-xyz/aukora-deep/issues/3)，也不构成 full custody。以下产品要求仍然缺失或未经测量：

- 没有 guest LaunchDaemon 或 parent activator；
- human login session 中没有 trusted renderer；
- 尚无通过此已安装 pair 完成的有人参与产品轮次测量；自动化 fixture 中的终端决策是脚本化的，activation 声明的 composition 也不是经过测量的已安装 guest；
- 没有 guest network deprivation，也没有 complete recursive runtime closure measurement；
- 尚无已安装 guest 的 extended-ACL 攻击与 control measurement；单独的 installer ACL 检查不证明该结果；
- service principal 继承的 ambient supplementary group 尚未被 confinement；
- operational issuer key 尚未绑定到 verified AUMLOK control history；
- loaded launchd job 持有的 environment value 尚未经过 attestation；
- 尚无保留的运行时 manifest 或已加载页面 attestation；字节 pin 与组合报告摘要只覆盖观察到的 file。

因此，该 pair 只证明其报告记录到的 installed identity、staged authority byte 的 root ownership 与 read-only POSIX mode、两个运行中的 daemon principal、route reachability 和具名 secret denial。在提出更广泛的声明之前，仍需要 independent topology court、extended-ACL write-exclusion measurement 和 settled end-to-end product turn。
