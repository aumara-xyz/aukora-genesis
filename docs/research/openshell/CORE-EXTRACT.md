# Core extract — AUKORA owns the contract, Docker is the first adapter

**Status: PROPOSED.** No adapter code is in this pull request. OpenShell is not on the live path. The Mac bring-up is operator-reported (`SPIKE-FINDINGS.md`). The proof harness is Docker only (`PROFILES.md`).

## Decision

Extract the containment behavior that is worth keeping. Own the contract in AUKORA. Implement it first as a replaceable adapter whose body is OpenShell 0.1.2 on Docker. Replacing that body later must not replace the person's authority, the effect definitions, or the evidence.

The adapter is a later host-side module. It is not a plugin in this change, not a fork of NVIDIA's tree, and not a resident of the crown.

## What AUKORA owns

| Contract | Obligation | First adapter mapping |
|---|---|---|
| Workload envelope | Allowlisted files, non-root identity, explicit network rules, no admin socket, no owner home. Missing enforcement refuses the start. | OpenShell policy file + Docker driver. `hard_requirement`. UID `1000` on the reported image. |
| Workload identity | Bind grants to sandbox id, run generation, and activation. A display name is not an identity. | OpenShell sandbox id and generation, recorded into the AUKORA activation. The adapter does not invent a second id. |
| Credential placement | Provider secrets stay at the supervisor. Possession of a hidden key is not permission to use the account. | OpenShell credential substitution. The AUKORA grant still names account, destination, and operation. |
| Control-plane change | Policy, provider, image, and exposure changes are their own admitted operations. The worker cannot apply them. | Gateway pre-handler, later. Docker socket and gateway admin stay outside the workload. |
| Effective policy | The active configuration is observed and matched before AUKORA marks an epoch current. A written file is not that observation. | Adapter reports driver, image digest, policy digest, and identity. The broker does not trust the YAML alone. |
| Outcome | Admission, transport success, and observed effect stay separate facts. Uncertainty stays uncertainty. | OpenShell logs are observations. The broker keeps the accounting. |

`workspace.patch`, the issuer, Approve, one-use accounting, the membrane, and Laya (STOP or ASK) stay AUKORA's. The adapter does not sign, does not emit ALLOW, and does not call `become.mjs`.

## The replaceable seam

```text
AUKORA envelope (owned)
  effect stays with the broker
  epoch, holder, generation, policy digest
        |
        v
adapter: start | refuse | report observed identity
        |
        v
OpenShell 0.1.2 + Docker   <-- first body, not the contract
```

A later body (another runtime, after its own prove profile) implements the same six rows. It does not get to shrink them. Kubernetes, Podman, and the VM driver are not quiet options on the Docker proof. Sentry is not part of the extract.

## What is left in OpenShell on purpose

Landlock inside the guest, the supervisor/workload split, the egress proxy, and credential injection stay upstream code behind the adapter. AUKORA does not re-implement that cage in-tree for the first proof. Apache-2.0 stays on that process (`LICENSE-NOTE.md`). Admit, spend, and keystone stay closed.
