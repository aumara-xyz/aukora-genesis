# Specification 0060 §5 — Minimal Demonstrator Claim & Limit Declaration
========================================================================

This document declares the exact **Permitted Claim** and **Forbidden Claims** for the cold-process demonstrator (`minimal/verify.py`). Every assertion below corresponds to a runnable command or exercisable limit.

---

## 1. THE PERMITTED CLAIM

> **CLAIM:** Retaining an observation of tree size $N$ with Merkle Tree Head $R_1$ enables an observer to verify whether a presented tree of size $M \ge N$ with Merkle Tree Head $R_2$ is an append-only log extension of the retained observation.

### Runnable Verification Commands

#### A. Positive Control (Append-Only Extension)
Verifies that size 14 log is an append-only extension of retained size 5 log.
```bash
python3 minimal/verify.py minimal/vectors/retained.json minimal/vectors/append-only.json
```
**Expected Output:**
`VERDICT: APPEND_ONLY`

#### B. Power-of-Two Valid Extension Recognition
Verifies valid extension at retained size 4 ($m = 2^k$).
```bash
python3 minimal/verify.py minimal/vectors/power-of-two-retained.json minimal/vectors/power-of-two-presented.json
```
**Expected Output:**
`VERDICT: APPEND_ONLY`

#### C. Earned Accusation (Observation Conflict)
Verifies prefix mismatch between retained size 5 log and tampered size 14 presentation.
```bash
python3 minimal/verify.py minimal/vectors/retained.json minimal/vectors/rewritten.json
```
**Expected Output:**
`VERDICT: OBSERVATION_CONFLICT`

---

## 2. FORBIDDEN CLAIMS (REFUSALS BY DESIGN)

The verifier strictly refuses to assert any of the following five claims:

1. **NO OCCURRENCE CLAIM:** An `APPEND_ONLY` verdict does not prove that any recorded event occurred in physical reality.
2. **NO WORLD TRUTH:** An `APPEND_ONLY` verdict does not prove that leaf payloads represent true facts.
3. **NO CODE EXECUTION:** An `APPEND_ONLY` verdict does not prove that any software or script executed cleanly.
4. **NO HUMAN IDENTITY:** An `APPEND_ONLY` verdict does not bind to any physical human identity or authority.
5. **NO SINGLE-LOG ASSUMPTION:** An `APPEND_ONLY` verdict does not prove that the subject maintains only one log. A subject may maintain parallel trees.

---

## 3. STRUCTURAL LIMITS (EXERCISABLE BOUNDARIES)

### Power-of-Two Retained Size Conflict Limit
When retained size $m = 2^k$, the retained root is the fold seed. A corrupted proof or prefix mismatch cannot be mathematically separated.

**Exercisable Limit Command (Tampered Proof at Power-of-Two Size $m=4$):**
```bash
python3 -c '
import json
p = json.load(open("minimal/vectors/power-of-two-presented.json"))
p["proofFromPrevious"][0] = "00"*32
open("/tmp/tampered_p2.json", "w").write(json.dumps(p))
' && python3 minimal/verify.py minimal/vectors/power-of-two-retained.json /tmp/tampered_p2.json
```
**Expected Output:**
```text
VERDICT: UNDETERMINED
REASON : POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE
LIMIT  : Retained m is 2^k; root1 is fold seed.
```

---

## 4. STANDALONE SELF-TEST

Any cold observer holding only `minimal/verify.py` can exercise all three verdicts and structural limits in memory without external vector files:

```bash
python3 minimal/verify.py --selftest
```

---

## 5. ARCHITECTURAL LINEAGE & SPECIFICATION BOUNDARY

> **SPECIFICATION LINEAGE:** The demonstrator shares its schema lineage with Spec 0048 (`specs/0048-tesseract-aura-evidence-contract-v1.md`) via `core/aura-evidence-descriptor.ts` and `core/aura-capsule.ts`.
> 
> **HONEST SCOPE BOUNDARY:** The demonstrator (`minimal/verify.py`) verifies RFC 6962 arithmetic cold on raw bytes. It does not depend on the descriptor or capsule being correct.
