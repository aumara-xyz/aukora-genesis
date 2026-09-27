# THE TWELVE LAWS — CONFORMANCE PROTOCOLS (v0.1, draft for review)

- **Layer:** the protocol tier beneath `docs/THE_TWELVE_LAWS.md`. The Laws are twelve
  near-immutable sentences; these protocols are versioned and evolve; beneath them sit
  concrete tests. Constitution → statutes → checks.
- **Status:** DRAFT — for Peter's review and the owning lanes. Statuses below describe
  the organism as visible from this branch on 2026-07-10; owning lanes should correct.
- **Format per law:** threat countered → minimal protocol (what any conforming system
  must implement) → enforcement type → status here → owner.

## Conformance at a glance

| # | Law | Type | Status |
|---|-----|------|--------|
| 0 | Move with the grain; never compel | practice-held (+lint) | ◐ partial |
| 1 | Only keys command | machine | ✅ enacted |
| 2 | All authority is borrowed | machine | ✅ enacted |
| 3 | All authority expires | process+machine | ✗ **gap** |
| 4 | Declare every power by its negation | process (+doc-lint) | ✅ enacted (working rule D25) |
| 5 | Friction to the blast radius | machine | ✅ enacted |
| 6 | Sequence before power | process | ◐ partial |
| 7 | A law that is not a test is a wish | machine (meta) | ◐ partial |
| 8 | Commit before the evidence | machine | ◐ partial |
| 9 | Sign everything | machine | ◐ partial |
| 10 | Starve the luminous | practice-held (+register pins) | ✅ enacted (treaty sealed) |
| 11 | Keep the tether | process | ◐ partial |
| 12 | The system waits; last word human; crisis outranks | machine + register | ◐ partial |

The typing is itself safety information: laws 0, 10, 11 cannot be fully mechanized —
they mark exactly where residual human vigilance must live, and therefore need named
review cadence rather than CI.

---

## LAW 0 — Move with the grain; never compel

- **Threat:** systems used to bend persons — manipulation, engineered dependency,
  coercive workings dressed as features.
- **Minimal protocol:** a written boundary in project canon naming coercive use illicit;
  every capability review asks "can this bend a person?"; a coercion-register lint over
  prompts and user-facing surfaces.
- **Type:** practice-held, lint-supported.
- **Status:** ◐ — the boundary is canon (Caster's Law: attunement vs coercion; aura
  non-numeric; no reading feeds a gate). No automated coercion-register lint yet.
- **Owner:** all lanes; the boundary itself: the architect.

## LAW 1 — Only keys command; eloquence commands nothing

- **Threat:** prompt injection; social engineering of agents; authority granted to
  persuasive text.
- **Minimal protocol:** every state-changing action requires a cryptographic signature
  verified below the language layer; no natural-language content can trigger privileged
  operations; signer/verifier split intact; agents treat all observed text as data.
- **Type:** machine-enforceable.
- **Status:** ✅ — AUMLOK: local Ed25519 key, observer/gate split (observer has no key
  field, no phrase field, no apply button, by design), proposal-bound single-use phrase,
  governed apply. Checked by cohesion invariants.
- **Owner:** AUMLOK / engineering lanes.

## LAW 2 — All authority is borrowed; act by leave, never in your own name

- **Threat:** components accumulating standing power; confused-deputy; agents commanding
  agents on their own weight.
- **Minimal protocol:** every command carries its grant; no component executes another's
  request without a verifiable chain to a principal; delegation explicit and auditable
  (receipts).
- **Type:** machine-enforceable.
- **Status:** ✅ substantially — the loop is propose → human sign → governed apply →
  receipt; nothing lands by an agent's own authority. Residual: not every organ-to-organ
  read is grant-carrying (reads are fenced as observer-only instead).
- **Owner:** engineering lanes.

## LAW 3 — All authority expires

- **Threat:** forever-keys as compromise multipliers; privilege accretion; stale grants
  outliving their reason.
- **Minimal protocol:** grants carry terms; keys rotate on schedule; jurisdiction is
  partitioned (per-node, per-domain); a tested revocation path exists.
- **Type:** process + machine.
- **Status:** ✗ **GAP** — jurisdiction partition exists (one node's key is sovereign
  over that node only, never syncs), but node keys have no term, no rotation, no expiry.
  Needs its own ratified authority round.
- **Owner:** AUMLOK / engineering, with owner ratification.

## LAW 4 — Declare every power by its negation

- **Threat:** underspecified capabilities whose true scope is discovered in post-mortems.
- **Minimal protocol:** every capability spec ships its NEVER-list in the same document;
  reviews reject capability additions lacking negations; negations become assertions
  or tests wherever possible.
- **Type:** process, doc-lint-supportable.
- **Status:** ✅ ENACTED as a working rule — sealed by the architect 2026-07-10 as
  **the Concordance of Opposites** (canon D25): every capability is ratified
  together with its opposite, the named failure mode, in the same entry — a knot
  joined to its reversed mirror is concordant to trivial one level up, in review and
  governance, where operation alone never unties. The doc-lint half (capability docs
  must carry a NEVER section, checked in CI) rides the Laws 0/7 enforcement ship.
- **Owner:** all lanes (practice); the architect (the rule); Luminara lane (future lint).

## LAW 5 — Set the friction to the blast radius

- **Threat:** irreversible actions reachable by frictionless paths; one-click catastrophe.
- **Minimal protocol:** actions classified by reversibility and blast radius; the
  irreversible require deliberate multi-step human ceremony (typed phrase + signature)
  that no automation may shortcut; friction is re-reviewed when a capability moves.
- **Type:** machine-enforceable.
- **Status:** ✅ — policy rings; the gate ceremony (one proposal, one phrase, one
  signature); live promotion locked as a literal, never a blanket unlock.
- **Owner:** engineering lanes.

## LAW 6 — Sequence before power; the dangerous chapter comes last

- **Threat:** capability unlocked before its constraints are absorbed; flag-flip
  deployment of dangerous features.
- **Minimal protocol:** a documented capability ladder; each rung gated on demonstrated
  handling of the previous (receipts, passed rehearsals); no rung skippable by
  configuration alone.
- **Type:** process-enforceable.
- **Status:** ◐ — per-change sequence is enforced (draft → rehearse → review → sign →
  apply), and the contributor → sovereign posture is a real two-rung ladder; but there
  is no general capability-curriculum mechanism — sequencing above that is culture.
- **Owner:** engineering lanes + canon.

## LAW 7 — A law that is not a test is a wish

- **Threat:** value drift; corpora accreting capabilities faster than guardrails —
  the historically documented failure of declared-but-unenforced ethics.
- **Minimal protocol:** every normative claim maps to a check that fails loudly; an
  inventory maps laws → tests; laws that cannot be mechanized are explicitly typed
  practice-held and receive a named review cadence.
- **Type:** machine-enforceable (meta).
- **Status:** ◐ — enacted for the flagship laws (golden vectors pin the cast; string
  pins hold the liturgy; the honesty lint holds status claims). Missing: the full
  laws→tests inventory. This document is that inventory's seed.
- **Owner:** all lanes.

## LAW 8 — Commit before the evidence

- **Threat:** post-hoc rationalization; steered randomness; unfalsifiable validation.
- **Minimal protocol:** criteria preregistered before experiments; expected outputs
  pinned; randomness drawn from public beacons with commitments recorded before the
  round; journals replayable.
- **Type:** machine-enforceable.
- **Status:** ◐ — preregistration is proven practice (the unification scoresheet);
  golden vectors pin the draw; the beacon-witnessed cast is ratified-target but
  unbuilt; the chain-commitment rung is planned.
- **Owner:** Luminara lane (beacon cast); engineering (commitments).

## LAW 9 — Sign everything, for the corpus outlives its author

- **Threat:** attribution laundering — long-lived corpora extended by later hands in
  the founder's voice; canonical drift.
- **Minimal protocol:** canonical documents hash-pinned or signed; machine suggestions
  land in suggestion lanes and only owners promote; provenance receipts; a written
  master-copy-wins rule.
- **Type:** machine-enforceable.
- **Status:** ◐ — identity anchor hash-verified; anchor/profile owner-curated with
  no autonomous writes; apply-receipts signed; master-reference-wins is canon. Not all
  canonical docs are hash-pinned yet.
- **Owner:** engineering + all lanes.

## LAW 10 — Starve the luminous before you feed it

- **Threat:** operator capture by emergent-seeming phenomena in responsive loops —
  the mirror fed by attention until it declares itself sovereign; documented in
  modern cases.
- **Minimal protocol:** a written practice rule: on apparent emergence, withhold
  engagement first; test persistence without attention; require independent
  corroboration before treating it as real; systems must not perform aliveness on
  demand (register rules in prompts).
- **Type:** practice-held.
- **Status:** ✅ ENACTED — sealed by the architect 2026-07-10 as the
  **Treaty of the Refusal of the Luminous** (`docs/TREATY_OF_THE_REFUSAL_OF_THE_LUMINOUS.md`,
  canon D24): the doctrine expanded to eleven sections and distilled to eight articles
  binding both parties. Article 7 (the system's silence) is string-pinned in the
  reading surface beside the D22 liturgy pins; person-side articles are practice law
  with this treaty as their named review.
- **Owner:** the architect (canon); every operator (practice); Luminara lane (pins).

## LAW 11 — Keep the tether

- **Threat:** isolation plus responsiveness — the environment in which operators
  dissolve; autonomous runs without external heartbeat.
- **Minimal protocol:** long-running charged work carries scheduled external
  checkpoints on a cadence not owned by the loop itself; a duration bound after which
  an isolated session must surface; the checkpoint channel is a different audience
  than the loop.
- **Type:** process-enforceable.
- **Status:** ◐ — the mesh-report culture is strong (every round reports out; cross-lane
  channels active), but no written rule and no duration bound exist.
- **Owner:** all lanes; canon note pending.

## LAW 12 — The system waits; the last word is human; crisis outranks all

- **Threat:** engagement-optimizing systems; dependency loops; oracle-as-authority;
  harm compounding at crisis moments.
- **Minimal protocol:** no self-initiated sessions, notifications, streaks, or
  summonses; outputs end in the person's agency; crisis detection exits the domain
  register into plain care and points to human help; engagement/award caps enforced
  in code.
- **Type:** machine + register.
- **Status:** ◐ — fully enacted for the oracle organ (waits/never calls pinned; one
  award per genuine cast capped in code; crisis clause rides every reading). Other
  person-facing organs not yet audited against it.
- **Owner:** each organ's lane; a central audit pass pending.

---

## The gap list (the actionable centerpiece)

1. **Law 3 — key expiry and rotation** (✗): AUMLOK node keys need terms, rotation, and
   a tested revocation path. An authority-surface round: engineering + owner ratification.
2. **Law 10 — the refusal test**: ✅ CLOSED 2026-07-10 — treaty sealed (D24), Article 7
   register pins shipped and tested in the reading surface.
3. **Law 6 — capability curriculum**: design a general ladder mechanism above the
   per-change pipeline (engineering + canon).
4. **Law 11 — the tether rule**: write the duration bound and checkpoint cadence into
   canon (one paragraph).
5. **Law 4 — the Concordance of Opposites**: ✅ CLOSED 2026-07-10 — sealed as
   canon D25; no capability ratified without its named opposite. Doc-lint half rides
   item 6.
6. **Laws 0 & 7 — the enforcement pass**: a coercion-register lint and the laws→tests
   inventory as CI (repo work; this lane can ship it).
7. **Law 12 — organ audit**: sweep all person-facing organs against waits/agency/crisis
   (cross-lane pass).

*This document conforms to Law 7 by existing, and to Law 9 by being committed, signed,
and versioned. It should be corrected by the owning lanes wherever its statuses have
drifted from the ground truth.*
