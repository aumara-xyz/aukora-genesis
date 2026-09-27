# 已到场的 Web 审批飞行，2026-09-14

[English](README.md) | 中文

本目录让经由在线 AUKORA Web 组装完成的第一个「所有者到场」的受 broker 治理效应仅凭文件即可复现，不需要在线 broker，也不需要私钥。

## 出处

- 部署的候选源码：`/Users/peterviviani/aukora-deep/.worktrees/owner-approval-panel`，提交 `5142bd9d74f1d74b887952cbf55d303b618953fe`，其 Git 树等于所记录的 main 提交。
- main：`58aca798af7b36abfb6dcf8578242b71086a7fb8`，即 PR #276 的合并。
- 飞行时的在线组装：parent 52959、broker 54039、issuer 54040、guest 54041，以及在发现其渲染端已脱离后替换的 owner-review 客户端。
- `broker-public.pem` 仅为公钥部分。它被强制加入，越过仓库的 `*.pem` 排除规则；该规则继续适用于其他所有 PEM，此处不跟踪任何私有材料。
- 被观测对象：`/Users/peterviviani/aukora-governed-workspace/popup-proof-20260914T050437Z.txt`。`content.txt` 是逐字节副本；原文件仍留在受治理工作区中。

## 这次飞行做了什么

一次 `workspace.patch` 提议，只提交一次、没有重试：以只创建方式写入文件 `popup-proof-20260914T050437Z.txt`，工作区别名 `project`（解析为 `/Users/peterviviani/aukora-governed-workspace`），`beforeSha256: null`，内容为 `AUKORA popup approval test.` 加一个结尾换行，共 28 字节，sha256 `c8313e770bcd37d9ffc69adbfd23606376bfde490f6934f8574598c9a9c770d0`。所有者在已配对的聊天标签页中先回答了父级审阅，随后回答了独立的 issuer 确认。broker 返回 `{"ok":true,"state":"SETTLED","proposalId":"aa0aaa32b0ca50da135e5c38c0c2fd8a"}`。

`receipt.json` 是 broker 持久化的回执，未经修改地复制；`MANIFEST.txt` 记录它的 sha256，便于把副本与存储对照。

## 三类主张，刻意分开

1. **签名与内容。** `verify-offline.mjs` 验证回执自身签名字段之上的 Ed25519 签名，并用签名的内容摘要与长度核对导出的字节。该运行包含拒绝对照：被篡改的签名必须以 `receipt:signature-invalid` 拒绝，被篡改的内容必须以 `receipt:content-mismatch` 拒绝。两者都被拒绝，因此通过的签名行不可能来自一个什么都接受的验证器。
2. **密钥信任。** 所提供公钥的 ID 等于 `pin.json` 中记录的激活回执密钥 ID。两者都在同一个包内传递，因此一致只表明内部自洽与本机同 UID 锚定：该密钥就是所记录激活所指名的密钥。它不是独立保管；`verifyReceipt` 本身就说明，类别闸门的分量只等于读者对该密钥的带外绑定。
3. **人类到场。** 本包不建立这一点，任何脚本化运行也无法建立。到场是所有者本人对它回答过的提示的观察。这些提示的截图是他的产物，尚未包含在内。

## 离线复现

本数据目录不是可独立执行的包。`verify-offline.mjs` 会导入仓库的验证器模块（`aukora/broker/receipt.mjs` 与 `aukora/host-dsh/src/grant.mjs`），因此需要从包含本目录的某个提交的检出或 `git archive` 导出中运行。只有五个数据文件取自本包。

```
git archive <commit> | tar -x -C <export>
mkdir -p <scratch>/bundle
cp <export>/courts/evidence/2026-09-14-owner-approval-flight/{receipt.json,content.txt,broker-public.pem,operation.json,pin.json} <scratch>/bundle/
cd <scratch>
env -i /Users/peterviviani/.hermes/node/bin/node <export>/courts/evidence/2026-09-14-owner-approval-flight/verify-offline.mjs <scratch>/bundle
```

预期结果：十一行 `PASS`，并以 `VERIFIED` 结束，退出状态为 0。`verify-output.txt` 记录了一次在清空环境下针对本包副本的此类运行，因此没有任何环境凭据、配置或状态可以参与。该脚本只读取传给它的包目录；它不会打开 broker 状态、私钥、配对令牌、会话日志或 broker 存储。

## 本包没有粉饰的限度

- `inode` 与 `mtimeNs` 是回执的主张。异机副本无法重新观测原对象，验证器会在输出中标明这一替代。实测的重新观测发生在结算时，此处不重复。
- 回执是 broker 对自身派发后观测的证明。它不证明是哪个调用创建了该文件，也不说明该观测之外的任何事。
- 依设计排除：私钥、凭据、配对令牌、会话日志、broker 存储，以及与这一次操作无关的一切。

## 拒绝对照抓到的导出缺陷

第一次导出写入的公钥 PEM 带了重复的结尾换行（114 字节）。严格的规范化 ed25519 检查以 `receipt:key-not-ed25519` 拒绝了它，而密钥 ID 计算仍然成功——这正是只打印顺利路径的包可能掩盖的失败。改用 `jq -j` 重新导出所存值，得到 113 字节的规范化 PEM，所有检查通过。

## 为可靠性工作保留的先前失败

这次飞行的第一次尝试被以 `broker:review-timed-out` 拒绝。当时 owner-review 客户端不持有任何传输套接字，而它的浏览器 API 仍然在线、浏览器仍保持连接，因此无法显示任何提示。

该观测发生在超时之后而非之前，所以它并不证明客户端在提交之前就已脱离：超时的请求会摧毁渲染端的传输对端，因此脱离也可能始于那次到期。`scripts/launchd-review-transport.mjs` 第 162 与 282 行的传输定时器同样不能解释它——那些定时器覆盖认证，并在握手后清除，并非持续的空闲超时。

一个一次性复现现在直接展示了该机制：在已配对会话与正在观测的浏览器下，一个无人回答的请求最终在 20 秒时传输超时，客户端随后读到 `disconnected`，并且在显式认证的重新连接之前不会重新挂载。修复属于审批连接可靠性任务。
