# Residual risks — what a qualified OpenShell workload still leaves open

**Status: PROPOSED / UNRUN.** These are design findings from spec §7.6–§7.7, §11.5, and §20. They are not newly demonstrated vulnerabilities, and they are not closed by this pull request.

## What is not enforced

OpenShell is not installed here and not on the live path. The five items below are the ones that stay open even after a workload fence exists. Installing a gateway does not retire them (§7.7, §24.6).

## 1. Attendance

A valid signature proves a signature under a key, under the stated bindings. It does not prove a person was present (§7.4, B27).

OpenShell can make it harder for the worker to read an issuer key or to reach a privileged service. It does not require an Aumlok signature on every signer request, and it does not manufacture attendance evidence (§7.7). R1 remains a custody and caller-admission measurement. `EACCES` on a key file is evidence of a denied read. It is not evidence that every signing request is authorized.

The approval key on this Mac is a software key. A click in a popup is recorded. It is not bound to a person.

## 2. Trusted display

R3 is the correspondence between trusted rendering, signed semantics, and execution (§7.1, §7.7). OpenShell does not create that display.

Pending cards need immutable ids, bounded lifetimes, explicit destinations, and cancellation (§7.6). A material change to an approved field needs a new proposal. The native desktop renderer and its IPC/preload path must keep untrusted content from requesting privileged approval or rewriting the preview. A 500 ms middleware timeout is not a human-review window (§20.13). Review is prepare → review → execute, outside the worker.

A code diff, a digest, or a screenshot does not prove the person understood the operation (§7.1). Persuasion can still produce a cryptographically valid signature (§7.6).

## 3. Same-UID, if the worker is mis-placed

The property that matters is reachability, not a UID number (§20.7).

These placements leave the boundary open:

- The main loop is inside a workload, and a coding subprocess, plugin installer, native helper, or legacy tool still runs as the owner (T10, §3.4).
- The workload can see the owner home, the support directory, a key file, or the signer socket because a bind mount or `--forward` was added to make the agent useful.
- The issuer, the broker, and the high-water witness are writable by the same operating-system principal that the worker can influence (§2.3, Domain E).
- Two hostile plugins share one OpenShell workload identity and are expected to be isolated by fiber names (§20.7).
- The workload can call the gateway and change its own policy (T8). A data-plane filter does not survive that.

A different UID in the guest does not fix a socket, a group permission, or a management API shared with the host. Seatbelt on the Mac remains a separate cage, and it is unenforced for danger-full-access sessions until those sessions are actually inside a qualified workload.

## 4. Telemetry and disclosure

A route that keeps the provider key out of the worker can still send the worker's request content to that provider (§11.5). Filtering the response does not undo the disclosure.

OpenShell documents operational telemetry and an opt-out (`OPENSHELL_TELEMETRY_ENABLED=false`, or `server.telemetryEnabled=false` for Helm). The spec's reading of that page says the stated collection excludes prompts, credentials, and user content, and that third-party agents have their own practices (§11.5, N11). This intake did not capture packets and did not confirm the opt-out.

The trusted supervisor sees plaintext when it terminates TLS for inspection. A privately controlled gateway and an enterprise-operated gateway are different confidentiality assumptions. A proxy is not an end-to-end privacy guarantee against its operator.

Logs imported from OpenShell are attributed observations. A signature on an imported log does not prove the producer's claims (§20.19). Prompts, root phrases, mnemonic stories, credential headers, and hidden model reasoning do not belong in a universal trace. O38 (Gate D) is the case that measures unapproved disclosure. It is UNRUN.

## 5. Provider-use versus credential possession

Hiding the API key reduces extraction. It does not stop the worker from requesting an unwanted action through an allowed service that will use that key (§20.12, §24.6).

An endpoint allowlist is not an amount limit, a recipient restriction, a repository or branch approval, or permission to disclose a particular body. The approved object has to bind the account, the destination, and the operation. A provider reattached between review and execution must not retarget the action (O19).

Credential headers are added after middleware and are omitted from the middleware view. The spec therefore binds the approved operation and the authorized account, not a hash of every eventual wire byte. Secret bytes stay out of public receipts.

A dummy token is not Aumlok root entropy, phrase recovery, or human presence (§20.12).

## Further residuals the first profile must keep visible

| Topic | What remains open | Spec |
|---|---|---|
| Control plane | Gateway operator, provider editor, and policy updater can change reach. Ordinary worker credentials must not hold that power. Direct CLI or TUI use needs a declared policy. | §20.14, T8, OS-CP-01 |
| `post_commit` | Upstream requires fail-open because the operation has already committed. An observer failure does not mean the change was prevented. | §20.14, OS-CP-05 |
| Empty `current_state` | Method-specific current state is not populated in the inspected interceptor contract. Concurrent admin changes need some other measured check, or concurrent-control qualification stays blocked. | §20.15, O29 |
| L7 default | Documented default is `audit`, which records and does not block. Relied-upon rules have to be `enforce`. | §20.10, O09 |
| `best_effort` | Can leave a required extra filesystem restriction unapplied while other isolation remains. That is not a conformance pass. | §20.10, O02 |
| Prover | Modeled inclusion is not grant checking and not a measurement of the running process. Unsupported and inconclusive results do not pass. | §20.16, O33, O34 |
| Inspection gaps | WebSocket binary frames, some response bodies, and `tls: skip` are outside the inspected coverage. A claim that needs those bytes cannot use those modes. | §20.17 |
| Outcome versus admission | A forwarded request, a log line, and a reservation are different facts. Uncertainty stays uncertainty. | §20.13, §20.19, O25 |
| Compromised host | Outside the first software profile's guarantee. A VM or a DPU is a different profile with its own evidence. | §3.2 T5, §20.7, §20.20 |
| Sentry / BlueField | Not inspected for this spec. Not a prerequisite. Attestation is not the person's authorization. | §20.20, D-13 |
| License | Apache-2.0 beside AGPL is an allowed shape for an adjacent process in `LICENSE-NOTE.md`. That note is not a ruling. AGPL duties on AUKORA remain. | §20.21 |
| Crown | Admit, spend, and keystone stay closed. OpenShell does not take those decisions. | `LICENSE-NOTE.md` |

OS-01 through OS-20 in §20.23 are the acceptance requirements that sit on top of these residuals. None of them are checked in this pull request.
