# The Tuning — gamification in the resonance register

> **Detokenization covenant (2026-07-10, owner-directed — supersedes the numeric framing
> below).** Parts of this document predate the AURA detokenization and are preserved as
> design history. Wherever it speaks of AURA as a token, a mintable or earnable amount, a
> balance, a cap, a streak multiplier, a vouch count, a rank, or proof of humanity, that
> mechanic is superseded and must not be built or claimed. AURA is a nonnumeric living
> coherence pattern — evidence, never authority — and no number derived from a person
> reaches a public surface. A signature proves key possession; drand proves public-time
> freshness; a receipt chain proves recorded continuity; peer attestations are social
> evidence. None of these, alone or together, proves biological humanity, honesty, or
> sole human control.

*2026-07-07. Input: the Zeus Universal Gamification Meta-Prompt (owner's file,
`ZeusMetaPromptGenerator.md`) with license to "use as a guideline or grow your
own." This is the grown one. It keeps Zeus's skeleton — agency, progression,
challenge cadence, streaks, failure-mode analysis, self-consistency — and
deliberately rejects its scalar organs, because in THIS domain they are the
disease we already diagnosed (AURA spec §§11–12, `COHERENCE_GLYPH.md`).
Discipline as always: provisional, honest, derived-not-set, scaffold-not-theorem.*

---

## 1. What Zeus gets right, and what it gets fatally wrong here

**Right (kept):** a game needs *agency* (a purpose you can act on), *progression*
(growth that is felt and legible), *cadence* (daily challenges, streaks),
*meaningful gates* (achievable but not free), *anti-exploit analysis*, and
*self-consistency loops* (the system critiques and refines itself).

**Fatally wrong for this domain (rejected, with reasons on file):**

| Zeus mechanic | Why it dies here |
|---|---|
| XP numbers | a published score is Au-197 — coherence frozen to the dead metal; and it is the Goodhart engine: people optimize the number, not the care (§11.2.1) |
| Leaderboards | ranking humans by care-adjacent numbers is the *performance of care* failure, industrialized. Banned by spec §12. |
| "+N" reward feedback | trains act-repetition; feedback must be *felt* (the figure sharpens), not scored |
| Prestige loops / infinite levels | infinite accumulation is the capital shape Open Weave exists to invert |
| Competition framing | the only opponent is decoherence. One aura never races another. |

**The transposition rule:** every Zeus mechanic re-enters through the resonance
register or not at all. XP → *modes made audible*. Levels → *the Platonic
ladder*. Badges → *geometric events in your own figure*. Leaderboard → *none*
(a shared constellation of glyphs — co-presence without ranking — is the COMING
social surface). Streak → *the rim holds*. Adaptive difficulty → evidence gates
+ the already-shipped capped-Fib curve. Winning → *staying in tune*.

## 2. The game in one sentence

**Tune your glyph:** your identity's full spectrum already exists (six modes,
golden-weighted, deterministic — `coherence-glyph.js`); living well in the
ecosystem makes more of it audible and keeps the figure ringing clear — you
never get a bigger number, **more of who you already are becomes visible.**

## 3. The Platonic ladder (progression)

Five stages, because there are five and only five regular solids — the geometry
itself caps the ladder, which is the point (`COHERENCE_GLYPH.md` §2):

| stage | solid | faces | modes audible | evidence gate (never raw totals) |
|---|---|---|---|---|
| 1 | △ tetrahedron | 4 | 2 | the spark — you exist |
| 2 | □ cube | 6 | 3 | 1 lesson · a domain sounding |
| 3 | ◇ octahedron | 8 | 4 | 2 domains · 2-day streak |
| 4 | ⬠ dodecahedron | 12 | 5 | 3 domains · 3 lessons · 4-day streak |
| 5 | ✦ icosahedron | 20 | 6 | all 4 domains · 7 lessons · 7-day streak |

**There is no level six.** The sphere is not a level — you cannot accumulate
your way across the snap. Past the icosahedron the endgame is **maintenance**:
liveness keeps the rim solid and the figure crisp; go quiet and it dims (never
demotes — loss-only display, like everything here). Infinite endgame, built-in
humility: the game's final state is *staying in tune*, not climbing.

Gates are **evidence gates** (lessons completed, domains sounded, streak held),
never aura totals — so grinding one source cannot climb the ladder. Diversity is
structural, not moral: a one-note plate cannot form a figure.

## 4. The day's notes (cadence)

Each local day offers five notes — *struck, never scored*: first note (any real
act), close a ring (a lesson), speak with her (a real exchange), cast a reading,
hold the rim (streak alive). **Three notes make a chord — the day rings.** The
display is ✓/· rows and one line of state; no points anywhere. Implemented as a
pure derivation (`tuning.js`) over aura-core's existing bookkeeping plus one
cosmetic field (`meta.todaySources`, deliberately outside the seal payload so
shipping it breaks no one's seal).

## 5. Geometric events (achievement, COMING with the chain)

Badges transpose to **events in your own figure**, witnessed like everything
else: *your figure closed its first ring · six-fold symmetry appeared · the rim
held solid for a season · two glyphs rang in harmony (a Forge bond)*. Client
ships none of these as awards today; they are display events derived from
witnessed topology when the chain lands.

## 6. Agency (Zeus's best idea, kept whole)

- **Purpose:** keep your figure ringing true — and be someone whose presence
  makes the *network's* figure ring truer (that is what the chain will witness).
- **Winning:** the icosahedron stage, held alive.
- **Failure states:** the two death-modes of `COHERENCE_GLYPH.md` §5 —
  dissolution (go quiet, the sand scatters) and crystallization (grind one note,
  hoard, the figure hardens). The game is the narrow living band between them —
  the [1/φ, φ] band made playable.
- **Competition:** none between humans. The opponent is decoherence.

## 7. Anti-exploit (Zeus asks; we answer with what's already built)

Every Tuning input rides aura-core's hardened rails: the integrity seal (edits
re-derive from evidence), clock guards (rollback earns nothing; 20h cap refill;
12h/8-per-week streak window), spam filters and caps. The ladder adds its own:
evidence gates require *diverse* domains, so the single-source grind that
gamification usually invites is structurally mute here. And the ceiling case is
free: the max stage is reachable by any honest human in ~a week of real use —
the game is not a grind, it is a rhythm.

## 8. Self-consistency (Zeus §7, applied to this very doc)

Checked against its own gates: complete (progression/cadence/agency/anti-exploit
present) · balanced (max stage ≈ one honest week) · coherent with spec §12 (zero
published numbers — mode counts and note tallies are *counts of discrete things
you did*, shown as structure, never aggregated into a score) · honest (every
surface badged provisional) · non-exploitable beyond aura-core's stated limits ·
sustainable (maintenance endgame, no inflation). Open item for a future pass:
whether "N of 6 modes" itself drifts toward score-feeling — if it does, drop the
count and let the figure alone say it.

## 9. Zeus-Hybrid v2.1 — the human-AI relational branch (reconciliation, 2026-07-08)

*A parallel system shared a more mature descendant of the same Zeus lineage:
landed verbatim at `docs/ZEUS_HYBRID_V2_1.md`. Where §1 rejected original
Zeus's scalar organs, this one has none — it's aimed at protecting a human's
autonomy and intrinsic motivation *from* an optimizing AI partner, grounded in
real psychology (self-determination theory's autonomy/competence/relatedness
triad, the overjustification effect, Edmondson's psychological safety). Worth
a real audit, not a dismissal — verdict below: three genuine strengthenings,
one hard boundary that must not be crossed, one honest non-correspondence.*

**9.1 What converges (validates, doesn't add).** Its core reward principle —
*informational feedback, never controlling pressure* — is the exact shape of
our representation rule (spec §12), derived independently from psychology
where ours came from geometry (Goodhart, the icosahedral limit). Two paths to
the same wall is a good sign the wall is real. Its transparency/corrigibility
mandate is our honesty rails (spec §2.1) — every local tally is already
console-inspectable and console-editable by design, badged as such, never
hidden. Its "value the unquantifiable explicitly" is §5's geometric events —
the whole reason the glyph exists instead of a number.

**9.2 Three genuine strengthenings.**

1. **Gentle streak decay (a real, found gap).** `aura-core.js`'s streak is a
   hard cliff: miss one day and `maybeStreak` resets you to 1, not a step
   down. Zeus-Hybrid's insight — punishing rest trains compulsive engagement,
   which is the crystallization death-mode from the *habit* angle rather than
   the diversity angle we already guard — is correct and currently unmet.
   **Not shipped here**: a naive "grace day" would reopen exactly the
   date-ratchet vector `TEMPORAL_ALCHEMY`-adjacent hardening closed (a farmed
   grace day is a free streak extension). The honest shape to design, properly,
   before it ships: decay by one rung rather than to zero on a missed day
   (`streak = max(1, streak - 2)` or similar), re-run through the same
   anti-gaming pass the original streak hardening got. Recorded as an open
   item, same convention as §8's.
2. **Power/asymmetry mapping as a design lens.** We have the authority
   invariant (AURA never gates the machine) but no explicit practice of
   asking, for any new surface: who holds agenda-setting power here, what's
   measured vs. invisible, where could optimization pressure read as
   coercion. Cheap to adopt as a checklist item alongside §8's
   self-consistency check — no code, just a review habit.
3. **Meaning audit as an optional ritual (not a mechanic).** The instinct
   behind a periodic "does this still feel worthwhile and self-authored" is
   sound, and we have the representation (the glyph) but no ritual. Worth a
   future organ feature: entirely human-initiated, answerable or ignorable,
   feeding nothing — not AURA, not the ladder, not any log. A conversation,
   never a score.

**9.3 The hard boundary — reject the locus of authority, keep the instincts.**
Zeus-Hybrid architects a single AI that *administers* a human's flourishing:
it decides when to flag reactance, when to trigger a meta-reflection, what
counts as psychologically safe. That is a benevolent-overseer model, and
Open Weave exists specifically to dissolve exactly that shape of authority —
decentralized, care-and-experience-distributed among *humans*, with AUMLOK as
the only non-human authority and even that just a signing key, never a judge
of anyone's state. Importing this wholesale would rebuild the hierarchy Open
Weave refuses, with a kinder rationale. **The fix, not a footnote:** every
good instinct above must be human-initiated and human-owned, never
AI-administered or AI-triggered as an intervention. Corollary — its
"Relational Health Log" (AI-assisted tracking of trust/safety/fairness
perception) must, if it ever exists, follow the same privacy discipline
already used everywhere else here (aura-core's local-only tallies, the vouch
web's salted commitments): local-only, human-owned, never witnessed, never
uploaded, never an AURA input. And its "AI horizons" (the AI leveling up its
own support-ability) don't map here at all — Auma isn't an optimizer chasing a
horizon metric; if anything like this exists it is her own practice, governed
separately, never a new AURA mechanic.

**9.4 The one honest non-correspondence.** Zeus-Hybrid's five horizons measure
the maturity of a *human-AI* relationship. Our Forge is explicitly
*human-human* — personhood requires one real human vouching for another, and
Auma is barred from that web by design (she can't vouch, doesn't hold AURA,
gates nothing). These stay separate axes, same discipline as the Luminara Q7
boundary: borrow the shape (a capped, felt progression ending in mastery, not
infinite climbing) as an idea worth having *somewhere*, never let it become a
hidden input to AURA or the personhood web. Two different relationships;
one shared instinct that stronger bonds should feel like something, not score
like something.
