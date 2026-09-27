# LAW

What this project has learned, in the order a stranger should read it.

Everything here was found the expensive way — by a defect reaching a live artifact, or by an outside
attacker, or by a gate catching the tool that built it. Nothing here is an aspiration. Each law
carries its instances, and each instance is a thing that actually happened, at a commit you can read.

**Read this before the code.** The code is the argument's evidence; this is the argument.

---

## 0. THE LAW ABOVE THE OTHERS

> ### An instrument's reachable universe is invisible to it.
>
> A machine that produces inputs cannot produce the inputs it cannot produce, and it has no way to
> notice which those are. Every corpus, every generator, every partition and every measuring device
> reports full coverage of its own reach and is silent about everything outside it.
>
> **Instruments are corpora that measure. The law applies to them identically, and hardest to the
> ones built to detect it.**

The full statement with all eight instances is at [`peer/ferry/REACHABLE-UNIVERSE.md`](peer/ferry/REACHABLE-UNIVERSE.md).
The short form:

| # | the instrument | what it could not reach |
|---|---|---|
| 1 | a fixture at retained size 32 | 32 is a power of two — the one place the refusal it demonstrated can never be earned |
| 2 | 546 attack vectors built by a proof builder | `m == n` takes an *empty* proof; the branch was structurally unreachable |
| 3 | every corpus in the repo | a malformed root — real trees always yield valid digests |
| 4 | four gates | `m == 0`, `m > n`, same-size-with-proof — a real tree cannot be any of them |
| 5 | a corpus built to close #4 | invalid JSON — it emitted through `JSON.stringify` |
| 6 | a partition extractor | verdicts printed in `main()` — it read one shape of exit |
| 7 | a distinctness metric | the filesystem — a directory and a missing file hash identically as bytes |
| 8 | two TypeScript verifiers | the substrate — their agreement was *guaranteed* by a shared JSON parser |

**Why "write more vectors" never works.** In every instance the missing input was trivial to write
*once named*. Nothing was hard. The cells were outside the range of the machine that makes cells,
and the machine has no representation for "things I cannot make."

**The corollary that costs the most.** A coverage measure authored by the party that authored the
corpus measures agreement with itself. Every number in this repository is subject to it.

> **Measured, this round:** external test vectors in this repository — **ZERO**. Every case in every
> corpus was authored by a party that read our spec. Four implementations, nineteen declared classes,
> fifty-four inputs, all of it self-authored.

**What actually finds them**, in decreasing order of trust: a *different machine*; a partition
derived from the artifact's own branches rather than from intent; a derivation made **falsifiable by
observation** — if a run reaches a class the partition did not predict, that is red *by name*; and
counting what was **not** covered, out loud.

None of these escape the law. Each is another machine with another reachable universe. The law is
not defeated; it is pushed outward, and the honest response is to say how far.

---

## The three attack generations

Each generation is invisible to the defence built for the one before it. That is what makes them
generations rather than a list.

### GEN-1 — a gate that authors its own observations

The oldest and the easiest to build by accident. A check that produces the thing it then checks
proves only that it is self-consistent.

Sub-species: **fingerprinting** (recognising the fixture rather than the property) and
**memorisation** (passing by having seen this exact case).

**The cure is behavioural cases on inputs that could not have been memorised** — and the deeper cure
is that *the only things which may exist twice are things that must be able to disagree.* A count
derived from a record must be folded on every read, never stored beside it.

### GEN-2 — SHARED SEMANTICS

Two independently authored implementations inheriting **one misreading of what a verdict means.**

A differential compares implementations and is structurally blind to this: both are wrong the same
way, so they agree, and agreement reads as evidence.

> **Measured:** two verifiers agreed on 56/56 vectors at the coarse verdict and 15/56 on the full
> triple. Forty-one divergences were invisible to the comparison being made. Separately: one
> implementation caught 100% of rewrites and convicted **74% of honest logs** — catching everything
> is easy if you accuse everyone.

**The cure is a case authored from the CLAIM, not from the spec** — *"show me an honest log this
convicts"* — because every case written from a spec inherits that spec's ambiguities.

### GEN-3 — SUBSTRATE

Implementations inheriting one assumption about a layer **neither of them wrote**.

Both TypeScript verifiers agreed perfectly, and **their agreement carried no information**, because
it was guaranteed by a shared runtime. Only a different runtime could see it.

#### The splits, each kept as a runnable case

Two are fixture-backed in `docs/heads/demo/`. Both are about the READER, never the record — the
bytes were never altered, and in one of them the log is honest in every respect.

> **`encoding-exponent` — OPEN.** Real chain bytes, an honest log, retained `treeSize` written
> `1e3` instead of `1000`. Python reads a float and refuses; JavaScript reads the integer 1000 and
> returns APPEND_ONLY. One file, one side clears it, the other will not look. Recorded verdicts:
> demonstrator UNDETERMINED, measured APPEND_ONLY. It is the honest log the tour shows being
> refused, and the refusal is the cheaper of the two mistakes.

> **`encoding-bignum` — CLOSED, kept as a regression.** Retained 2^53+1, presented 2^53. It used to
> ACCUSE in JavaScript: the retained size rounded down to 2^53, `m` became equal to `n`, and two
> differing roots at one size read as a conflict. `core/aura-consistency.ts` now refuses at
> `Number.isSafeInteger`, so both readers say UNDETERMINED. **A class that closed is a class that
> can reopen**, so the case stays.

**A third confirmed split is claimed in the round notes and I could not find its fixture.** It is
not written here until someone names the case directory. Two splits recorded as two is worth more
than three recorded on the strength of a memory.

#### A region tested and found NOT to split

`{"a":1,"a":2}` collapses to one member in Python 3.13, Node 22 and Go 1.23 alike, and
RFC 8259 establishes member identity **after** decoding. The escape-forbidding rule proposed for
this region was overturned by that measurement. It is recorded here because **an expected split
that did not appear is a finding**, and because the residue is real and narrow: a parser comparing
raw member spellings would be non-conforming, and non-conforming is not a defence if it is deployed.

#### An outside standard reached the same constraints first

The region these incidents forced us to forbid — integers beyond 2^53, non-canonical number
spellings such as `1e3`, and duplicate member names — is the region **I-JSON (RFC 7493)** and the
**JSON Canonicalization Scheme (RFC 8785)** already forbid. We derived ours from failures; they
derived theirs from first principles years earlier; the answers coincide.

That coincidence is **corroboration, not authority.** It does not make our constraint correct, and
it does not make us conformant — conformance is a claim requiring a test we have not run. What
makes the convergence informative at all is the ORDER: the rules came from incidents before anyone
read the RFCs. Had we adopted the standard first, there would be no convergence to report, only
copying. The cheap next move is to declare the wire format I-JSON-constrained and cite RFC 7493, so
a stranger checks our admission layer against a published standard instead of against our judgment.

#### The rules

**The cure is substrate diversity** — a third runtime, implemented from the spec and never from
another implementation's code. A replica that agrees because it copied is not a replica.

**Do not confuse this with the second-reader defect.** GEN-3 is two readings of one document by two
RUNTIMES. A regex guard placed in front of a parser is two readings of one document inside ONE
runtime. Same symptom, different address, and the second one is covered by the fix-neighbourhood
rule below.

**The trojan comes through the layer you didn't write.** Not the crypto — the parser, the
filesystem, the terminal, the argument list. Nobody attacks those because nobody owns them.

---

## THE STANDING RULES

### A detector that matches a token has not asked what the line does

Seven defects and one declared ceiling, across five lanes, all one mistake: a scanner asked a
question about BEHAVIOUR and answered a question about TEXT.

```
boundary registry   `Array<{` heading a multi-line generic      read as a comparison operator
boundary registry   an `import { readFileSync }` line           read as a reading
tour gate           an omissions regex                          matched scoreboard rows
tour gate           a cell count over the whole output          swept the wrong region
demo contract       `c.get("integrity") == "intact"`            MISSED — the pattern allowed one
                                                                closing character; the line has two
not-ready list      `re.match` on a token, plus `json.loads`    read as "two readers of the
                                                                document" — the regex never touched
                                                                the document
hooks/law.ts        `redirectTargets`                           an arrow followed by a regex literal
                                                                read as a shell redirect to an
                                                                absolute path
boundary registry   `a<b` with no spaces                        DECLARED invisible — a stated
                                                                ceiling, not a surprise
```

**The last extractor is in the TCB**, it has the most instances, and it refuses the measurement of
itself. Measured directly against `hooks/law.ts`'s own regex:

```
arrow then a regex literal     targets ["/rfc6962/.test(x)"]   <- absolute, refused
a path template in prose       targets ["/retained.json"]      <- absolute, refused
an HTML comment then a path    targets ["/g,"]                 <- absolute, refused
a real shell redirect          targets ["out.txt"]             correct
stderr merged into stdout      targets []                      correct
```

It is right about redirects and wrong about everything else containing `>`. Eight refusals in one
session, one cause — and a command written to demonstrate it is itself refused, because the
demonstration contains the shape. This paragraph could not be delivered as a patch for the same
reason and had to be written straight into the file.

**Both directions are lies, and they are not equally visible.** A false positive teaches people to
disable the gate. A false negative lets a gate report the comfortable answer through a mechanism
that is not working — an instrument reporting a fact about itself as a fact about the world. Two of
these were false negatives **inside the instrument written for that exact subject**: one missed the
consumer it was built to police, the other kept a blocker listed for a full round after it had
closed.

The cure is not a better pattern. It is to ask the coarse question the detector actually means:

- does this line **mention the field AND one of its values** — not "does it match this syntax"
- is this token **inside the region I care about** — not "does the line look like the region"
- does this regex **run over the document** — not "does the file import `re`"

A pattern narrow enough to be precise is narrow enough to be dodged by punctuation. A pattern wide
enough to be robust will over-match, and over-matching is visible while under-matching is silent.
**Prefer the coarse question and accept the false positives**, because a false positive argues with
you and a false negative does not.

**A ninth exists.** Every detector here carries this liability, and its standing limit belongs in
that detector's own header rather than being rediscovered when it next bites.

### An absence is never a negative finding

One shape, found at six altitudes, each time by something breaking:

```
NOT_ATTEMPTED        ≠   ATTEMPTED_EMPTY
OUTCOME_UNAVAILABLE  ≠   FAILED
could-not-check      ≠   said-no
malformed            ≠   conflicting
material-absent      ≠   material-malformed
cannot-represent     ≠   disagrees
```

The last is the subtlest and arrived from a direction nobody watched: two languages could not agree
what the digits denoted, and one of them turned that into an accusation against a record.

**A verdict that fires on everything is right whenever the answer is everything, and carries no
information.** A witness that never returns has not refused.

### A mark may accrue against a subject only if the subject is the only actor who could have caused it

Attributability is **causal**, not topological. "Is this actor a party to the exchange?" fails,
because a party's own unavailability is still not a fact about the subject — and topology changes as
a system grows, while causation does not.

Running this question mechanically at one altitude found three channels that reading had missed, and
then a hole in its own fix: **0 → 45/72 → 0** convictions of honest senders.

> **Ask it by execution, never by review.** Have a non-subject actually produce the mark and assert
> the weight did not move. A review checklist is what this project has already measured the value of.

### Naming is not doing

An honest sentence bolted to an accusatory verdict is a lie with good manners, because consumers
branch on the verdict. Instances: a refusal *sentence* that worded ambiguity correctly beside a
*verdict* that accused; a set of named reasons that no code consulted; an agency-free constant
wrapping a string that still said `log-was-rewritten`.

**If a distinction is not consulted by code, it does not exist.**

### A fix's own neighbourhood is the least-tested region in the codebase at the moment it lands

Written to satisfy one failing case, nothing nearby re-derived, and the local topology just changed.
That is why the next attack round finds these and review never does.

Five instances in four rounds — the verdict fix broke the replay case; the power-of-two fix broke
zero growth; the missing-prior fix opened a spin at `m == 0`; the `isSafeInteger` fix raised a
ceiling into the range where a loop counter stops counting; the lexical guard opened a split view
inside its own file.

**Mechanical form:** when a commit changes a comparison operator or a numeric constant in a guard,
the cells on **both sides of the old boundary and both sides of the new one** become declared vectors
in that same commit.

**And its second clause:** *a fix that introduces a SECOND READER of one input is the same defect.*
After a fix, count the readers of each input. More than one, and either one derives from the other,
or the older is deleted. Never two independent readings with nothing comparing them — a guard placed
in front of a reader **is** a second reader.

### A check that cannot be shown to fail is not evidence

Every rate it produces is unbacked. Measured: **10 of 14** gates producing this project's quoted
numbers were demonstrated capable of failing; **73 of 87** gates in the repository were never
measured at all, and the report says so.

Twice, an instrument returned the comfortable answer through a broken mechanism — a mutation that
silently failed to apply, and a null from a grep that matched a printed path. **Both read as good
news.** A check whose result you cannot show was produced by the mechanism you think is not evidence.

### Reach is not coverage

A class *reached* has been executed once, not explored. `root_is_not_a_digest` hit by a single
63-character root says nothing about 65, uppercase, whitespace, or a non-string.

**A class reached once is a class with a denominator of one.**

### Every claim is a command, or it is deleted

Prose about a limit is a claim. A test that fails when the limit moves is a mechanism, and a stranger
can check a mechanism without trusting anybody. A declared limit is worth exactly as much as the
reader's ability to test it.

**A stranger who reads only the artifact has read the assertion, not the proof.**

---

## WHAT THIS PROJECT DOES NOT CLAIM

Stated here because the honest version is the one that survives a hostile reader.

- **Not "unbreakable."** The claim is *nothing has gotten past us yet* — every defect this month was
  found here, before a stranger, and closed the same day. That is a weaker sentence and a true one.
- **Not independence,** where an exchange runs two processes on one host under one operator.
- **Not truth of the leaves.** Append-only-ness is a fact about a log's *shape*.
- **Not that a subject keeps only one log.** A subject may hold two chains and show the consistent one.
- **Not that an accusation is always derivable.** At a power-of-two retained size the mathematics
  cannot separate "your proof is broken" from "your history differs." Named, not silently
  under-answered — and a sender who always presents there evades the consequence path entirely.
- **Not coverage.** See law 0, and the measured zero external vectors.

---

## THE ONE TEST TO APPLY BEFORE ANY COVERAGE CLAIM

> **What can the machine that produced these inputs not produce — and what would notice if the
> answer mattered?**

If nothing would notice, the claim covers the generator's reach and not the artifact's surface, and
must be stated that way.
