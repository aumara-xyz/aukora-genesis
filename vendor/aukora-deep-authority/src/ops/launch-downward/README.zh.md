# Launch-downward 拓扑预检

[English](README.md) | 中文

本目录包含一个只读 observer（观察器），用于检查拟议的 launch-downward 主机拓扑。它将 [`topology.example.json`](topology.example.json) 中的名称与正在运行的操作系统进行核对。它不会创建账户或组、加载作业、更改权限、创建 socket（套接字）、启动 Aukora，也不会启动 guest（来宾）进程。

请在仓库根目录运行：

```sh
node aukora/supervisor/bin.mjs ops/launch-downward/topology.example.json
```

该示例有意使用普通开发主机通常无法产生完整观察的 principal（主体）和路径。此类主机会以 `1` 退出，并给出包括 `supervisor:principal-unobserved` 在内的具名拒绝。该原因同时覆盖账户缺失、命令失败、超时或解析不完整，而不会假装能够区分它们。文件系统对象缺失会产生 `supervisor:path-absent`；对象不存在绝不会被判定为 deprivation（权能剥夺）成功。没有观察到拒绝项的配置会以 `UNVERIFIED` 状态和 `2` 退出。这个非激活式命令没有退出 `0` 的结果。

## 观察内容

Manifest（清单）只提供账户名、作业标签、组名和 POSIX 绝对路径。由于支持的目标平台是 macOS 与 Linux，schema（模式）在每个测试主机上都固定使用 POSIX 解析。未知字段会被拒绝，其中包括 `uid`、`gid`、`pid`、mode（权限模式）和观察状态字段。输入与解析失败使用 `aukora:topology-input-refusal:v1`，并携带 `factsSource: "none"`；它们不会声称已经进行了主机观察。

预检从主机身份数据库获取账户与组事实；在 macOS 上通过 `launchctl`、在 Linux 上通过 `systemctl` 获取作业 PID；通过 `ps` 获取进程 UID；通过 `lstat` 获取文件系统的所有权、类型与 mode。子进程的执行时间上限为 5 秒。只有 `XDG_RUNTIME_DIR` 和 `DBUS_SESSION_BUS_ADDRESS` 会传入 Linux 的 `systemctl --user`；调用方环境中的其他变量不会进入 observer 子进程。路由组复用和 outsider（局外 principal）成员关系按实时数值 GID 比较，而不按 manifest 名称比较。

现阶段命名 4 个 principal：调用 observer 的 `node:os.userInfo()` 账户是 `human-session`，`issuer`、`broker` 与 `guest` 则命名 3 个服务账户。`invoking-process-user` 不会被描述为已登录用户或 console（控制台）用户，因为 `userInfo()` 不测量这两个事实。即使 manifest 提供了不同的账户名，只要实时 UID 重复，就会产生 `supervisor:principals-merged`。人类审批作业会在调用账户的 GUI 或用户服务域中查找。超时、manager（管理器）错误、解析失败、作业未运行或 PID 竞争都会产生 `supervisor:principal-job-unobserved`；observer 不会把该结果夸大为对象不存在的证明。

每条 socket 路由都有一个固定 owner（所有者）和 peer（对端）：human session 到 issuer、broker 到 issuer，以及 guest 到 broker。每个路由目录都必须是唯一必需 socket root（socket 根目录）的直接子目录。路由目录必须是由 owner 持有的 `0710` 目录，实时 socket 必须是该目录中由 owner 持有的 `0660` socket。对于每个已存在且不属于 guest 的受保护对象与路由对象，observer 会遍历每一层父路径，拒绝中间符号链接，并在实时 guest UID 或 GID 能够依据 POSIX 写入和遍历权限替换子路径名时报告拒绝。替换计算包含 sticky（粘滞）目录的所有权规则。

受保护路径清单是封闭且非空的：root key（根密钥）、receipt key（收据密钥）、nonce state（nonce 状态）、evidence（证据）、active profile（活动 profile）、active artifact（活动制品）、implementation closure（实现闭包）、guest scratch（guest 暂存区）和公共 socket root 都必须存在，并符合各自固定的叶对象 owner、类型与 mode。这是对根对象的观察，不是递归 closure 测量。

## 非声明

`status: "UNVERIFIED"` 与 `configurationMatched: true` 只表示具名配置观察没有产生拒绝。`UNVERIFIED` 以 `2` 退出；`REFUSED` 以 `1` 退出。每项观察都包含 `observationClass: "CONFIGURATION_ONLY"`、`activationPerformed: false`、`hostMutationPerformed: false` 与 `separationVerified: false`。此命令的任何输出都不授权 activation（激活）。

每项结果都会列出仍然缺少的 evidence：主动允许与拒绝探针、递归 closure 成员测量、把观察到的 PID 与其可执行文件及实际运行时路径进行绑定、完整的主机/NSS 路由组成员关系、socket peer 认证、扩展 ACL 观察，以及已解决的 observer privilege（观察器权限）模型。最后一项限制是结构性的：普通调用用户无法遍历服务账户持有的 `0700` 状态目录，而通过 `sudo` 运行同一命令会改变调用进程身份，因此不再测量 human principal。本命令不会掩盖这一矛盾。

静态身份、成员关系、叶对象 mode 和祖先 POSIX mode 观察无法证明跨 UID 拒绝，不能覆盖扩展 ACL，而且可能在观察后发生变化。一个 `0555` profile 或 implementation 目录仍然可以包含既有的 guest 可写子项；本 observer 不会对其进行递归枚举。如果观察到的作业没有绑定到这些精确路径，一棵安全的 manifest 树也可能只是 decoy（诱饵）。这些限制保留为永久 `verificationBlockers`，因此配置一致无法变成 green（通过）结果。

当前由 4 个 principal 构成的布局不声明存在独立于 broker 的 evidence。broker 仍然拥有 receipt signing（收据签名）、nonce state 与 evidence 文件。由其他 custody（保管域）持有的 witness（见证者）或 committer（提交者）需要另一个真实 principal 以及实际使用它的运行时行为；本 observer 不会虚构第 5 个占位身份。

此预检未加入任何 court（裁判），也不能把任何已知 breach（缺口）变为 green。有人在场的配置操作、运行时绑定、递归 closure 测量与主动探针仍属于独立的后续工作。
