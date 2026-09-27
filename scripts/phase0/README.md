# Phase 0 — retain a head, present a later one, earn a verdict

Three commands and the court already vendored in this repository. Nothing here needs a
model, a key or a sibling checkout. The network is needed only by the optional git-remote
retainer and by the first `cargo build` of the Rust replica.

```bash
STATE=$(mktemp -d)/state                      # any directory you like
mkdir -p "$STATE/aura"
printf '%s\n' '{"index":1,"payload":"record-1"}' '{"index":2,"payload":"record-2"}' > "$STATE/aura/records.jsonl"

python3 scripts/phase0/retain-head --state "$STATE" --out retained.json
printf '%s\n' '{"index":3,"payload":"record-3"}' >> "$STATE/aura/records.jsonl"
python3 scripts/phase0/present-head --state "$STATE" --retained retained.json --out presented.json
python3 scripts/phase0/verify retained.json presented.json
```

The verdict is printed by `vendor/append-only/verify.py`, running as a separate
process over the two files. `scripts/phase0/verify` computes nothing: it prints the
command it ran, so a reader who trusts this repository for nothing can run the second
line by hand and get the same answer.

| Command | What it does |
| --- | --- |
| `retain-head --state D --out F` | Writes the observation of the record stream in `D` at its current size, and a 0600 copy under `D/retained-heads/`. |
| `retain-head … --retainer R` | Also writes that observation into a retainer: a directory, a git working copy, or a git remote URL. |
| `present-head --state D [--retained F] --out F` | Writes the current head plus the RFC 6962 consistency proof from the retained size. |
| `verify --retainer R P` | Reads the retained observation **from the retainer and nowhere else**, then runs the court. Labels the verdict `RETAINER_SAME_OWNER`. |

## The second retainer

A retained head on the same disk as the log it checks proves arithmetic and says nothing
about custody: whoever can rewrite the log can rewrite the retained copy beside it. A
retainer is any store outside that boundary.

```bash
python3 scripts/phase0/retain-head --state "$STATE" --out retained.json --retainer ~/my-retainer
# …the log grows, or someone rewrites it…
python3 scripts/phase0/present-head --state "$STATE" --retained retained.json --out presented.json
python3 scripts/phase0/verify --retainer ~/my-retainer presented.json
```

`verify --retainer` reads the retained bytes from the retainer and **never falls back to a
local copy**. A silent fallback would make the custody claim false while still printing a
verdict, so a retainer that does not hold the size the presented head claims to extend
gets `CONSISTENCY_UNCHECKED`. The size it asks for is the one in the presented document's
`retainedTreeSize` — the observation the presented head says it extends, not the
presented head's own size.

Every verdict that used a retainer carries **`RETAINER_SAME_OWNER`**, and that label is
part of the answer rather than a footnote. A retainer under the same principal — a
private repository on the same account, a second directory on the same host — shows that
this host did not silently rewrite its own history. It does **not** show that an
independent party agrees. Independent custody needs a second principal holding a copy,
and until one does, the label stays.

The tooling refuses to retain a different root for a size the retainer already holds. The
same principal can still rewrite the retainer by hand, which is what `RETAINER_SAME_OWNER`
names.

## The Rust replica and the second verifier

`vendor/append-only/replicas/rust-verifier/` is a second implementation in Rust,
written within the same project from its spec rather than ported from `verify.py`. It
cross-checks runtime and number/JSON semantics, and is not verification by an independent
party: it shares the project's reading of the spec.

```bash
cargo build --release --manifest-path vendor/append-only/replicas/rust-verifier/Cargo.toml
./vendor/append-only/replicas/rust-verifier/target/release/aukora-verify-rs \
  vendor/append-only/vectors/retained.json vendor/append-only/vectors/append-only.json
```

CI builds it and requires both verifiers to agree on all three published vector pairs —
the honest extension, the earned accusation, and the power-of-two case. Its one known
limit: its JSON extraction is deliberately minimal, so on duplicate keys and exotic
encodings it may differ from the Python verifier's strict reader. That would be a finding
about the replica, not a vote on the record.

| `verify R P [--mutate]` | Runs the court over the pair. `--mutate` flips one retained root first. |
| `verify --retainer R P --publish D` | Copies the retained bytes the court used into `D`, so a reader can verify the exact bytes the verdict was computed from. |
| `selfcheck.py` | 36 arms, including memory-ledger truncation and prefix-rewrite detection, on disposable state. Same command CI runs (`b1.yml`). |

The record stream is `D/aura/records.jsonl`: one record per line, written append-only by
its producers. A rewrite is detectable against a retained head, not prevented. Leaf *k* is the sha256 chain hash of line *k*, which is the convention the
court's own vectors and demo heads use.

## The verdicts, and what each one does not say

| Verdict | Read as | Not read as |
| --- | --- | --- |
| `APPEND_ONLY` | The proof folds to the presented head and lands on the root you retained. | Not that any record is true, that anything happened, who anyone is, or that only one log exists. |
| `OBSERVATION_CONFLICT` | The presented observation cannot be an extension of the retained one. | Not an accusation of a person, and not a claim about intent. It accuses a *presentation*. |
| `UNDETERMINED` | Damaged, absent, underivable, or a declared limit — with the reason printed. | Not a soft no. It is a refusal to answer, and the reason is part of the answer. |
| `CONSISTENCY_UNCHECKED` | A head was named without a retained/presented pair. | Not a verdict. It means the question was never asked, so stranger-complete verification may not be claimed. |

`UNDETERMINED` is not a failure of the court. Two cases earn it by design: a proof
damaged in transit (which must never be reported as a conflict — a broken envelope is
not a crime), and a retained size that is a power of two, where the retained root is the
fold seed and a rewritten prefix is mathematically indistinguishable from a damaged
proof. The second one is printed with `LIMIT:` beside it.

## What Genesis adds to the vendored court

The court judges two documents a stranger holds. Somebody has to *make* them on a real
stream, and the making is where a seam defect hides:

- `phase0log.py` computes the tree head and the consistency proof. Both were ported from
  the reference generator rather than re-derived; the first attempt here omitted the
  RFC 6962 PATH special case for power-of-two retained sizes and produced an extra proof
  node, which passed everything except an honest power-of-two pair. `selfcheck.py` arm 5
  is what caught it.
- `present-head` refuses to present at all when the root over the first *retained* size
  records has moved, i.e. when an earlier record was rewritten. Presenting a proof there
  would ask the court a question about a log that no longer exists.
- `selfcheck.py` arm 7 asks the court anyway, with a proof computed over the rewritten
  leaves, and requires `OBSERVATION_CONFLICT`. The producer refusing is a producer
  property; only the court's answer is about the record.

## Keeping the retained observation

`retain-head` writes a mode-0600 copy inside the state directory for convenience, and
that copy is exactly as trustworthy as the machine it sits on. The act that matters is
the one this program cannot perform for you: keep the retained file somewhere the party
being checked cannot rewrite. Until a head is retained off-host, the court's own ceiling
applies: it judges two heads a stranger holds and is not a trust root. No freshness label
is printed yet (`FRESHNESS_LOCAL_ONLY` is a proposed name).
