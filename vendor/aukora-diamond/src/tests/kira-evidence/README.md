# Kira evidence — offline consumer acceptance

The executable half of the Kira evidence work. `scripts/verify-kira-evidence.py` is the
consumer; everything here is the evidence it consumes, the controls that must make it refuse,
and the runner that holds both to a published result.

```bash
tests/kira-evidence/run-empty-dir-arms.sh /tmp/kira-empty-dir
```

The runner copies the verifier closure, the exported bundle and the owner-approval fixtures into
a directory that was **empty**, then runs 38 arms with `cwd` inside it. It exits 0 only when every
arm produces its published result.

## What is here

| path | what it is |
|---|---|
| `evidence/` | the exported public evidence bundle. Start at `evidence/README.md`; provenance is `evidence/PRODUCER.md`; the producer-vs-consumer comparison is `evidence/FINDINGS.md` |
| `make-arms.py` | derives every negative control from the committed bundle, so there is one fixture to keep honest instead of two. Re-signs where a real signature is required |
| `run-empty-dir-arms.sh` | the runner: stages an empty directory, hashes everything in it, prints the runtime's own module closure, and runs every arm |
| `../aumlok-approval/fixtures/` | owner approvals **minted by Genesis's own contract code** at a recorded commit (`PROVENANCE.json`), copied in as data for arms 7c–7k |

## Why the runner builds the directory instead of committing one

An "offline" claim is worth exactly as much as the list of things that were reachable during the
run. So the runner does not assert offline-ness: it *shows* the complete contents of the run
directory with a sha256 for each file, prints which modules the interpreter actually loaded, and
takes `node` off `PATH` for the duration. A reader can then decide for themselves.

The producer's JavaScript sources are vendored under `evidence/vendor/` so the rule this
consumer restates is citable beside the code that produced the bytes. They are **moved aside**
for arms 0d, 6f and 6g, which re-run three verdicts without them: the verdicts do not change,
which is how "the consumer does not depend on the producer" is measured rather than promised.

## The arms, and the one that is the acceptance target

Arm 6 is the target from the shared fixture's own README: **after a second write, the FIRST
receipt must still verify.** It does, because the consumer checks the receipt's own position in
the Aura log rather than the log's current tip. Arm 6c is the necessary companion — a re-signed
receipt claiming a later entry's hash at an earlier position is refused, with a valid signature,
so the acceptance is not a hole that accepts anything.

Arms 7c–7k are the owner-approval lane, run through the same verifier from the same empty
directory: an honest approval verifies (and still authorizes nothing, binds to no operation and
proves no person), while a forged one, a changed signed field, the wrong anchor, an unsigned
wrapper field claiming attendance, a document carrying its own key, and an approval with no
separate anchor each FAIL THE RUN by name. Arms 7d–7i use an inverted expectation — the verifier
is asked for `verified` and must refuse with a non-zero status — because an arm that merely prints
the right refusal word would have passed the earlier, defective behaviour.

Arm 8, printed at the end, re-states the producer's own rule over the same bytes and reports the
verdict the producer's verifier reaches: after the second write it REFUSES the first receipt
with `MEMORY_TAMPERED`. Both measurements are committed in `evidence/producer-verdicts.json`.

## Limits this directory does not hide

Verification is not latestness, not replay prevention, not attendance, and not the absence of
forks. Every verdict the CLI prints carries the ceiling list, and `diamond/kira_evidence.py`'s
module docstring states the same limits where a reader of the code will meet them. `evidence/`
is public, redistributable test data: it contains no secret and no production key.
