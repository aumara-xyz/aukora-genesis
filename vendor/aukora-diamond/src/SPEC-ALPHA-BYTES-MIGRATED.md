# Spec Alpha bytes migrated into Diamond

This table describes this candidate. Presence here is not a merge or deployment claim.

The imported Receipt v3 closure stays under its original proprietary notices. Each row is byte-identical at both Alpha `8d68f03ca5c8d152f53b950a583770f1d9b30568` and `ddb6a9cc9860fce840283b0010e24e7d627fa9db`, measured against local Git objects. It is a separately named profile, never the Kira canonicalizer.

| Diamond path | SHA-256 | Source path at 8d68f03 |
|---|---|---|
| `profiles/alpha/LICENSE` | `40f45228b4d89729161e33f637af41bf6a40c3addbf0d40ce123150797711554` | `LICENSE` |
| `profiles/alpha/LICENSING.md` | `e35594b86c797cc371c8a8c0bc650fa513fd5990f404b954b47450e2a42b3032` | `LICENSING.md` |
| `profiles/alpha/src/receipt_v3/__init__.py` | `47f57e3f59e2d706e46149c1146a202e41239b663adb08ba282b1adadf44f4df` | `src/receipt_v3/__init__.py` |
| `profiles/alpha/src/receipt_v3/canonical.py` | `6a58afa91883353cb1d3388b728c5401aa42aad7895ffde4417094496405e573` | `src/receipt_v3/canonical.py` |
| `profiles/alpha/src/receipt_v3/cli.py` | `673d26244126ac663f6e17379f8838e5cc67688d20620587674ea9e2a7af4122` | `src/receipt_v3/cli.py` |
| `profiles/alpha/src/receipt_v3/verify.py` | `4e934e26461d23cc1165d598e7256dc647d91c8a39d635dcad47a189a2d8b5a4` | `src/receipt_v3/verify.py` |
| `profiles/alpha/src/receipt_v3/README.md` | `2146212df11f3e2f2458e02545c5e2c3dbfd92a9df2366731dd62e1d3f2baeda` | `src/receipt_v3/README.md` |
| `profiles/alpha/src/receipt_v3/DISCREPANCIES.md` | `5ad99ad29fa7e7c0d73102189c6e92b222be596750a408854e2ccfb26f141e44` | `src/receipt_v3/DISCREPANCIES.md` |
| `profiles/alpha/src/receipt_v3/tests/__init__.py` | `898c9f170b9ede84a84ca3f3a152cf54c55e79202b32c9a0a5742791726ceda2` | `src/receipt_v3/tests/__init__.py` |
| `profiles/alpha/src/receipt_v3/tests/fixture.py` | `c4d2226cf10a6a4b71095c2eb6ec242b4337ba1a9ad77e8ffe9914b7a65496c0` | `src/receipt_v3/tests/fixture.py` |
| `profiles/alpha/src/receipt_v3/tests/test_receipt_v3.py` | `375fcbe40dbbd130f02dab1619c2866348190ca3ff5c855ca1a303a44291f06b` | `src/receipt_v3/tests/test_receipt_v3.py` |
| `profiles/alpha/src/evidence/ed25519.py` | `6efa376791f5ec675b27d813cea70b84163c8a054318c6e03ba28320776d5a86` | `src/evidence/ed25519.py` |
| `profiles/alpha/src/evidence/test-vectors/receipt-v3/receipt.json` | `db9312b818f96f54482de9aa2484e9f8915069f8b4f9709ba30a3c5feae34860` | `src/evidence/test-vectors/receipt-v3/receipt.json` |
| `profiles/alpha/src/evidence/test-vectors/receipt-v3/executor-public.pem` | `401377bb531847cc77aa089ec232842ce902fd36bf5fbfccbcda426d301e52c0` | `src/evidence/test-vectors/receipt-v3/executor-public.pem` |
| `profiles/alpha/src/evidence/test-vectors/receipt-v3/issuer-public.pem` | `d6b8acde29d549ff3152caa20b66bec9e6435e985dc346c2dc5074c1c51ab5b1` | `src/evidence/test-vectors/receipt-v3/issuer-public.pem` |
| `profiles/alpha/src/evidence/test-vectors/receipt-v3/PROVENANCE.md` | `9b1c1deeec0ece5c75ebe358695d31737fe5318097de3aaba1096d04b2556f35` | `src/evidence/test-vectors/receipt-v3/PROVENANCE.md` |

The runner checks SHA-256, Git blob identity, length, exact inventory, and a separately pinned manifest before executing imported code. Its own source remains trusted; independent review still matters.

Cold adaptations implemented beside the verbatim closure:

- `scripts/check-cold-budget.py`: measured review budget for explicitly enumerated cold source, with missing-file and growth refusals. Alpha’s 1,300-line producer budget is not reused.
- `scripts/verify-cold-distillation.py`: finite executed claim ladder. Required checks must pass; zero/skipped suites cannot establish the fixture level. Human, model and product-bridge levels remain NOT_ESTABLISHED.
- `scripts/verify-alpha-freeze.py`: separate historical freeze-statement consumer with externally supplied public key and expected subject/tree. It checks a signed statement; it does not rerun its historical counts or sign a new freeze.
- `tests/continuity-spine/measure_pins.py`: six optional Alpha source measurements now compare against fixed blob pins instead of merely recording new hashes.
- `profiles/alpha/legacy/`: separately named, read-only Alpha v1/v2 receipt, key-rotation and witness-history adaptations. Historical v1 receipt/log/public key/effect bytes are preserved with provenance; v2 and rotation coverage is synthetic only. No receipt-selected path or key directory is opened.
- `profiles/alpha/contracts/`: exact Receipt v3 proposal and inert workspace-effect definition, with fixed source pins and original notices. These are contract bytes, never a loaded Node runtime.

Not absorbed: Node broker/issuer/guest launchers, process-local approval-mode registry, POTION, live custody and runtime state. PR #14 is a separate producer example and is not merged by this change. The preserved Alpha v3 human-ceremony challenge contradiction remains a named limitation, not a supported ceremony.

**No deletion clearance.** These selected imports do not prove every unique branch, runtime or experiment in Alpha has been preserved here. Keep Alpha and AUKORA-37 intact.
