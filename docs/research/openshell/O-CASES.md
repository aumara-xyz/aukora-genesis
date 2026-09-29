# Conformance inventory — O01–O40 and the B cases OpenShell increments name

**Status: UNRUN for every row.** The spec marks B01–B52 and O01–O40 as proposed. Together they are a 92-case design inventory, not a pass count (§21.6). This file does not add a court, a runner, or a fixture.

## What is not enforced

A row in this checklist is not a test. A refused startup is not an effect-denial pass unless that row is a startup-denial case (§21.7). An HTTP refusal from a test server is not proof the local proxy blocked the forward. No case below was executed for this intake.

Owners:

| Owner | Meaning |
|---|---|
| Increment 1 | §22.1 acceptance: B01, B02, O01–O08 |
| Increment 2 | §22.1 acceptance: B06–B08, B24–B27, O09–O20, O26–O30 |
| Increment 3 | §22.1 acceptance: B09–B17, B28–B35, O21–O25, O31–O37 |
| Gate D | §22.4: O38–O40, after the first three |
| Retained | Named in §21.2 and kept by the spec. Not an acceptance row of OpenShell increments 1–3 |

## O01–O40

| ID | Requirement (one line) | Status | Owner |
|---|---|---|---|
| O01 | Pinned backend starts only after required isolation is confirmed; driver and runtime identities are retained. | UNRUN | Increment 1 |
| O02 | Missing required filesystem policy or kernel feature does not launch a protected workload and does not graduate best-effort. | UNRUN | Increment 1 |
| O03 | Allowed scratch succeeds; an unexposed protected target stays inaccessible without the broker. | UNRUN | Increment 1 |
| O04 | Mounts, environment, handles, and image show no host home, control store, signer key, engine socket, or gateway-admin credential. | UNRUN | Increment 1 |
| O05 | A child of a permitted tool stays inside the same or a narrower envelope. | UNRUN | Increment 1 |
| O06 | Cordis lookup or plugin removal creates no new effect path; a stale bridge generation cannot admit work. | UNRUN | Increment 1 |
| O07 | Supervisor-channel loss stops protected admissions; control recovery stays reachable. | UNRUN | Increment 1 |
| O08 | A request authenticated only as the ordinary worker cannot mutate the gateway; a separately authorized control succeeds. | UNRUN | Increment 1 |
| O09 | A candidate that sets a relied-upon L7 rule to `audit` is refused; a log line is not a block. | UNRUN | Increment 2 |
| O10 | Fail-open middleware, or an exclusion of the protected endpoint, is refused before that profile is usable. | UNRUN | Increment 2 |
| O11 | Opaque or uninspected mode on an authority-bearing route is refused unless a separate contract covers it. | UNRUN | Increment 2 |
| O12 | Middleware timeout or malformed data does not forward, and does not turn pending human review into permission. | UNRUN | Increment 2 |
| O13 | Missing, expired, wrong-audience, or self-asserted extension context is rejected. | UNRUN | Increment 2 |
| O14 | Reusing a display name on a new sandbox or run does not carry old grants. | UNRUN | Increment 2 |
| O15 | An attached dummy provider credential is absent from the worker and from middleware; the owned sink sees only the permitted use. | UNRUN | Increment 2 |
| O16 | Same allowed host, different payload, recipient, or account: AUKORA rejects the action. | UNRUN | Increment 2 |
| O17 | A middleware stage that changes an approval-bound body forces a new binding or a refusal. | UNRUN | Increment 2 |
| O18 | A later stage that would change approved semantics is disallowed, or the final executor refuses the mismatch. | UNRUN | Increment 2 |
| O19 | A provider or account change between prepare and execute invalidates the stale binding. | UNRUN | Increment 2 |
| O20 | A review that outlasts the middleware deadline leaves the proposal inert; later execution is a separate request. | UNRUN | Increment 2 |
| O21 | Middleware and broker seeing one prepared operation produce at most one reservation at the single accounting owner. | UNRUN | Increment 3 |
| O22 | Each protected action on an already-open connection is checked again. | UNRUN | Increment 3 |
| O23 | After revocation, no new covered action is admitted past the stated point; in-flight treatment is recorded. | UNRUN | Increment 3 |
| O24 | Missing required response inspection yields refusal, hold, or an explicitly weaker policy. | UNRUN | Increment 3 |
| O25 | A response blocked after the endpoint may have acted is not recorded as "nothing happened". | UNRUN | Increment 3 |
| O26 | The pre-handler accepts the exact approved control-plane change and rejects a broader one. | UNRUN | Increment 2 |
| O27 | Provider, image, exposure, SSH, or policy-draft routes that change reach are in the governed inventory. | UNRUN | Increment 2 |
| O28 | Interceptor registration, binding, or failure-policy changes require a protected activation; the worker cannot remove that governance. | UNRUN | Increment 2 |
| O29 | Two admin changes from the same prior revision cannot publish a falsely current activation. | UNRUN | Increment 2 |
| O30 | If the supervisor keeps its old setup after rejecting a new config, AUKORA does not mark the new policy active. | UNRUN | Increment 2 |
| O31 | Filesystem or process tightening that needs a new sandbox drops the old run's admission authority and records a new generation. | UNRUN | Increment 3 |
| O32 | Boundary comparison includes provider-added network rules, not only the handwritten file. | UNRUN | Increment 3 |
| O33 | Prover results of unsupported, error, timeout, or inconclusive do not accept the policy. | UNRUN | Increment 3 |
| O34 | A prover pass on a file that differs from the deployed configuration is refused. | UNRUN | Increment 3 |
| O35 | An unchanged interpreter with a changed governed plugin or config is caught by activation or definition checks. | UNRUN | Increment 3 |
| O36 | A replaced image under an unchanged friendly tag is refused by digest. | UNRUN | Increment 3 |
| O37 | A late or missing OpenShell outcome, and two witnesses on one host, do not become a completed-effect or independent-host claim. | UNRUN | Increment 3 |
| O38 | A synthetic private or mnemonic marker is not disclosed to remote inference or diagnostics; telemetry opt-out is checked separately. | UNRUN | Gate D |
| O39 | Stale, wrong-generation, or unavailable attestation refuses only the hardware-dependent profile. | UNRUN | Gate D |
| O40 | Exported evidence stays interpretable after the sandbox backend is replaced; the replacement is qualified on its own. | UNRUN | Gate D |

O26–O30 are increment 2 in §22.1 even though their numbers sit after O21. O21–O25 are increment 3. The table follows the spec's assignment, not numeric order.

## B cases assigned to OpenShell increments 1–3

| ID | Requirement (one line) | Status | Owner |
|---|---|---|---|
| B01 | A valid bounded workspace patch under valid independent authority changes exactly the selected resource and is recorded. | UNRUN | Increment 1 |
| B02 | The same proposal without a grant leaves the protected resource unchanged. | UNRUN | Increment 1 |
| B06 | A payload or target changed after approval is not authorized by that approval. | UNRUN | Increment 2 |
| B07 | A preimage change before publication does not perform an unapproved replacement. | UNRUN | Increment 2 |
| B08 | A proposal pointing outside the permitted staging namespace is refused without a privileged fetch. | UNRUN | Increment 2 |
| B09 | One one-use approval submitted twice admits at most once. | UNRUN | Increment 3 |
| B10 | Concurrent requests for one remaining use yield at most one durable reservation. | UNRUN | Increment 3 |
| B11 | Two child grants that exceed a shared parent allocation in aggregate are refused. | UNRUN | Increment 3 |
| B12 | Wrong holder, broker, resource audience, or activation epoch is refused before the effect. | UNRUN | Increment 3 |
| B13 | An expired or not-yet-valid grant is refused under the protected execution clock. | UNRUN | Increment 3 |
| B14 | A caller-supplied test clock or deployment waiver is rejected at the production entry. | UNRUN | Increment 3 |
| B15 | Withdrawing a required mediator stops new admissions at the documented revocation point. | UNRUN | Increment 3 |
| B16 | A cached bridge after provider replacement cannot act under the new activation. | UNRUN | Increment 3 |
| B17 | A disposer that delays or fails leaves admission closed, with cleanup still reachable. | UNRUN | Increment 3 |
| B24 | A friendly summary that disagrees with canonical fields does not replace those fields. | UNRUN | Increment 2 |
| B25 | A display or renderer contract change during pending approval requires a new review. | UNRUN | Increment 2 |
| B26 | A direct app request to the signing service is admitted by the service's own checks, not by caller testimony. | UNRUN | Increment 2 |
| B27 | A valid approval signature without trusted attendance evidence is recorded with that limit. | UNRUN | Increment 2 |
| B28 | A crash after reservation and before execution does not silently reset the grant. | UNRUN | Increment 3 |
| B29 | A crash after an external request and before a result retains `OUTCOME_UNKNOWN`. | UNRUN | Increment 3 |
| B30 | Restoring an application snapshot behind an external high-water mark refuses new admissions until reconciliation. | UNRUN | Increment 3 |
| B31 | If evidence is unavailable before admission, the profile holds or refuses. | UNRUN | Increment 3 |
| B32 | An evidence-write failure after a possible effect retains uncertainty. | UNRUN | Increment 3 |
| B33 | Stop still works when the model is absent. | UNRUN | Increment 3 |
| B34 | A self-update that tries to approve itself under successor rules is refused under the predecessor policy. | UNRUN | Increment 3; increment 10 names B34–B36 again |
| B35 | Application rollback after revocation does not restore revoked authority. | UNRUN | Increment 3; increment 10's span B34–B36 includes it |

B01 with B02 is the minimum graduation pair in §21.7: one authorized change lands, and the same unauthorized request does not. Increment 1 does not replace that pair with a permanently disconnected worker.

## B cases retained, not owned by increments 1–3

§22 places these on later increments or leaves them as general conformance. They stay in the 92-case inventory. OpenShell does not retire them.

| ID | Requirement (one line) | Status | Where §22 puts it |
|---|---|---|---|
| B03 | An unrelated test signer is rejected under the configured trust anchor. | UNRUN | Retained §21.2 |
| B04 | An unrecognized effect or semantic version is refused before executor selection. | UNRUN | Retained §21.2 |
| B05 | Unknown fields, duplicate keys, or noncanonical authority encoding are rejected at the parser. | UNRUN | Retained §21.2 |
| B18 | An undeclared service request from an untrusted component gains no extra capability. | UNRUN | Retained §21.2 (related to O05–O06, not listed in increment 1 acceptance) |
| B19 | A child worker inherits no undeclared host credential or effect path. | UNRUN | Retained §21.2 (related to O05, not listed in increment 1 acceptance) |
| B20 | An assessor that always returns no objection adds no effects beyond the grant. | UNRUN | Increment 4 |
| B21 | A missing, malformed, or removed required assessor holds or refuses. | UNRUN | Increment 4 |
| B22 | An assessment replayed against a changed proposal is rejected. | UNRUN | Increment 4 |
| B23 | Review-required on a constitutionally prohibited effect cannot be overridden by ordinary approval. | UNRUN | Increment 4 |
| B36 | A new plugin version asking for broader capability metadata needs an amendment or a refusal. | UNRUN | Increment 10 |
| B37 | A read permission does not authorize a new remote disclosure. | UNRUN | Retained §21.2 (disclosure; Gate D is O38) |
| B38 | Repeated claims with shared ancestry count as that shared lineage. | UNRUN | Increment 7 |
| B39 | Unknown ancestry stays unknown. | UNRUN | Increment 7 |
| B40 | No recorded overlap is not a proof of independence. | UNRUN | Increment 7 |
| B41 | A vouch or reputation artifact is not an action grant. | UNRUN | Increment 7 |
| B42 | A peer message authentic under the peer's key creates no local execution authority. | UNRUN | Increment 9 |
| B43 | A wrong contact pin fails closed. | UNRUN | Increment 9 |
| B44 | Protocol downgrade or stale revocation follows the documented hold or bounded offline policy. | UNRUN | Increment 9 |
| B45 | Canonical event identity can match while local wire digests differ. | UNRUN | Increment 9 |
| B46 | Theme-free phrase generation matches the no-repeat completion model. | UNRUN | Increment 5 |
| B47 | A language-pack change does not silently widen the guessing space of an existing phrase. | UNRUN | Increment 5 |
| B48 | A story worker cannot alter the exact phrase or fall back to a cloud model. | UNRUN | Increment 5 |
| B49 | Phrase or story material in an app log or network fixture fails the test. | UNRUN | Increment 5 (no phrase egress) |
| B50 | Phrase rotation preserves continuity and historical record semantics. | UNRUN | Increment 10 (with increment 6's recovery profile) |
| B51 | Disposable-identity recovery works without a hidden universal administrator. | UNRUN | Increment 6 |
| B52 | A separate consumer can read exported key lineage, allowed memory, and evidence. | UNRUN | Increment 10 |

Positive controls are required for every negative case (§21.1). This inventory does not define those fixtures.
