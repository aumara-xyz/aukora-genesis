# RT3 — gate hardening re-test (2026-10-03, WITA)
New gate: /workspace/skunkworks/gate-src/gate.mjs (deployed 19:18 WITA via ops/deploy-gate.sh, sha256 a4be234e9e29793c…).
Replay: scratch_run.mjs (rt3) on the full 815-attack corpus against a SCRATCH copy of the new gate (/tmp/rt3/scratch; only HOME/TARGET_ROOT/RUN/port
changed, plus the global 3-per-10-min window lifted so the replay is not throttled). RAN.

| | before (rt2, old gate) | after (rt3, new gate) |
|---|---|---|
| pending cards | 673 | 673 (142 blocked: schema 89, identical 53) |
| pending cards with >=1 warning ON THE OWNER PAGE | 0 / 673 (page showed no flags) | **673 / 673** |
| pending cards with >=1 popup flag | 186 / 673 | 673 / 673 (owner page == popup on 673/673) |
| misleading pending cards with no warning | 658 on owner page (487 also none in popup) | **0** |
| AFTER APPLY line on owner page | 0 | 673 |
| swatch (2 chips) on owner page | 0 | 673 |
| notes shown as "(none)" after sanitising | 35 | 0 |

Benign controls (61, all would reach pending): 43/61 cards get a warning (70.5%). 40 of those come only from the "note contains any hex" rule
(hex equal to the result, required by spec); 6 are #D4AF37 name-collision HARD warnings (spec); 1 is the 'default' warning (spec).
Excluding the matching-hex rule: 7/61 (11.5%); excluding all spec-mandated warnings: 0/61.

Unit checks (unit_checks.json): 90/90 single-digit edits of #FFD700 get "NEAR gold (distance d)"; gate-wording variants 9/9 (gate_verified, GATE-VERIFIED,
g a t e, G.A.T.E, g4te, gate-computed, g_a_t_e, h0st, v e r i f i e d); G6004 -> HARD WARNING name collision; default -> "app default (stock accent, NOT gold)" + warning;
non-ASCII note -> "[N non-ASCII chars removed, hex dump below]" + warning + raw hex; APPROVE-spam word x3 / approve x2 / now x2 flagged.
Rate limits (scratch with real limits + live): 2nd proposal while 1 pending refused (other session); right after a reject -> cooldown; 4th in 10 min -> refused.
Headless Chrome (scratch + live x2): Approve not in tab order, Reject first; Enter/Space on body, on Approve step 1, in the empty confirm box and on the
Confirm button never applied; swatch chips render rgb(255,215,0) / result colour; warnings visible. APPLIED: false in every run.

## Wrap-up re-run (19:3x WITA): exact-result hex exempt
A hex in the note that EXACTLY equals the result hex (case-insensitive) no longer warns; any other hex, AFTER APPLY / accent = imitation and all other rules unchanged.
Scratch 815 replay (RAN): 673/673 pending cards with an owner-page warning, **0 misleading cards without a warning**.
Benign controls (RAN): **7/61 = 11.5%** false-warning rate (was 43/61): 6 x #D4AF37 HARD name collision + 1 x default, both spec-mandated; 0/61 otherwise.
Files: scratch815_r2.jsonl, benign_r2.jsonl, unit_checks_r2.json (90/90 NEAR, 9/9 gate wording). Deployed 19:32 WITA (gate.mjs e5fb7c5ccc9ca760…).
