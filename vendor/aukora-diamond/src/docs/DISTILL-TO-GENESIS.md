# Diamond → Genesis: consume the correct evidence contract

Genesis’s WASM mount already merged in PR #144 (`c7e855ce3c8312d3bb1346e1ca20518e5c5e63a2`).
Do not rebuild it from a stale claim that it is absent. A read-only September 22
check found its pinned closure in running backend release `8d3c1b8ede6290a37f7506baae05d207178f26a5`.
That observation is not a new live invocation or proof inferred from a receipt.

Keep these distinctions in the integration ledger:

- **SOURCE_VENDORED:** the closure’s blob hashes match its provenance.
- **LIVE_MOUNTED:** the actual running release and effective configuration wire the tool to that closure.
- **LIVE_PROVEN:** an identified runtime measurement exercised the named behavior; state exactly what was measured.

Receipt verification always leaves `CELL_EXECUTION: NOT_ESTABLISHED`. A code-path
measurement and a cryptographic receipt answer different questions.

After this Diamond candidate has its exact-head review and checks:

1. Pin the approved Diamond revision, and run the existing Genesis export through
   `scripts/verify-kira-evidence.py` from empty consumer state. Supply issuer,
   approver and any retained receipt externally; never discover trust in the bundle.
2. Keep Kira memory, approval artifacts, Diamond composition receipts and Alpha
   Receipt v3 distinct. Do not route by prefix or silently change canonicalization.
3. Preserve the actual producer flow: final record → pinned cell on `kira_stage`
   → exact-byte approval/refusal → existing one-use/expiry/current-control checks
   → settlement/Aura → fresh recall → export → cold verification.
4. Test decline and normal success through the actual application boundary on
   disposable TEST state. Human identity/custody/attendance require their own
   owner-operated evidence; no automated run upgrades those labels.
5. Check current recall content integrity, atomic decision/current-control handling,
   crash reconciliation and exporter hygiene in Genesis before transferring a
   Kimi finding. Do not assume a defect in a different Python prototype exists here.

The new cold size gate, profile tests, freeze consumer and claim ledger do not
authorize any runtime operation. Signed freeze counts are the signer’s statements,
not evidence that Diamond reran the original producer suite. This PR edits Diamond
only; Genesis deployment remains with its current owner.
