#!/usr/bin/env python3
"""Phase 0 G1 self-check: both verdicts, from disposable state, in one command.

    python3 scripts/phase0/selfcheck.py

Builds a disposable Aura record stream under a temporary directory, retains a head,
presents a later head, and runs the real court over the pair. Every arm has a
published expected verdict, and an arm that stops producing its verdict fails this
command. Nothing here is a fixture standing in for the product path: the two
documents are written by `retain-head` and `present-head`, and the verdict is
printed by the vendored `verify.py` running as a separate process.

Arms:
  1  retained N, presented M, untouched            -> APPEND_ONLY
  2  retained N, presented M, retained root flipped -> OBSERVATION_CONFLICT
  3  a head named with no retained observation       -> CONSISTENCY_UNCHECKED
  4  presented proof damaged in transit              -> UNDETERMINED
  5  retained size is a power of two, root flipped   -> UNDETERMINED (declared limit)
  6  the same record broken, producer asked          -> CONSISTENCY_UNCHECKED
  7  the rewritten stream presented anyway, by hand   -> OBSERVATION_CONFLICT
  8  retainer holds the observation, honest growth    -> APPEND_ONLY (+ RETAINER_SAME_OWNER)
  9  whole log rewritten and re-signed vs retainer    -> OBSERVATION_CONFLICT
 10  retainer asked for a size it never retained     -> CONSISTENCY_UNCHECKED (no fallback)
 11  retaining a different root for a kept size      -> REFUSED
 12  the court's own control, run from the vectors   -> APPEND_ONLY
 13  same size, identical roots, empty proof         -> APPEND_ONLY
 14  same size, different roots, empty proof         -> OBSERVATION_CONFLICT
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

ARM_COUNT = 36
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import phase0log  # noqa: E402  (sibling module: the producer-side arithmetic)
import retainer as retainer_mod  # noqa: E402  (the second-custody store)

VECTORS = os.path.join("vendor", "append-only", "vectors")
VERIFY = os.path.join(HERE, "verify")
RETAIN = os.path.join(HERE, "retain-head")
PRESENT = os.path.join(HERE, "present-head")
#: The SECOND ledger. Kira's memory log is a different file from the composition stream
#: above, with a different chain key, and until these arms existed nothing checked it
#: against anything kept outside its own state directory.
MEMORY_HEAD = os.path.join(HERE, "memory-head")

# 21 records: the retained size used by the arms is 13, deliberately not a power of
# two, because at a power of two the court cannot separate a rewritten prefix from a
# damaged proof and correctly refuses to accuse. That limit is arm 5's subject.
RECORDS = 21
RETAIN_AT = 13


def run(argv: list[str], env: dict | None = None) -> subprocess.CompletedProcess:
    merged = None
    if env is not None:
        merged = {**os.environ, **env}
        for key, value in env.items():
            if value is None:
                merged.pop(key, None)
    return subprocess.run([sys.executable, *argv], capture_output=True, text=True, env=merged)


def run_court(argv: list[str], mirror: str) -> subprocess.CompletedProcess:
    """Kept for callers that want an EXPLICIT mirror; the court itself pins both destinations in
    `main()`'s environment instead, because a per-call helper cannot cover a call site nobody
    remembered to convert — which is exactly how the owner's real archive got written to."""
    return run(argv, env={**os.environ, "AUKORA_AURA_MEMORY_RETAINER_MIRROR": mirror})


def field_of(proc: subprocess.CompletedProcess, name: str) -> str:
    for line in proc.stdout.splitlines():
        if line.startswith(name):
            return line.split(":", 1)[1].strip()
    raise AssertionError(f"no {name} line in output:\n{proc.stdout}\n{proc.stderr}")


def verdict_of(proc: subprocess.CompletedProcess) -> str:
    for line in proc.stdout.splitlines():
        if line.startswith("VERDICT:"):
            return line.split(":", 1)[1].strip()
    raise AssertionError(f"no VERDICT line in output:\n{proc.stdout}\n{proc.stderr}")


def write_records(state: str, count: int, upto_line: int | None = None, relabel: bool = False) -> None:
    """Write an append-only record stream. `upto_line` rewrites one earlier record;
    `relabel` rewrites every record, which is the whole-log rewrite an adversary with
    control of the host would perform — including re-signing every head, since the heads
    are derived from these bytes."""
    path = os.path.join(state, "aura", "records.jsonl")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for i in range(1, count + 1):
            if relabel:
                fh.write(json.dumps({"index": i, "payload": f"different-record-{i}"}, sort_keys=True) + "\n")
            elif upto_line is not None and i == upto_line:
                # A rewritten earlier record, not a truncated one.
                fh.write(json.dumps({"index": i, "payload": f"rewritten-record-{i}"}, sort_keys=True) + "\n")
            else:
                fh.write(json.dumps({"index": i, "payload": f"record-{i}"}, sort_keys=True) + "\n")


def status_of(proc: subprocess.CompletedProcess) -> str:
    for line in proc.stdout.splitlines():
        if line.startswith("STATUS"):
            return line.split(":", 1)[1].strip()
    raise AssertionError(f"no STATUS line in output:\n{proc.stdout}\n{proc.stderr}")


def write_memory_ledger(state: str, count: int, keep: int | None = None,
                        reset_seq: bool = False, rewrite_first: bool = False) -> None:
    """Write a KIRA-SHAPED memory ledger: `<state>/aura.jsonl` plus the `<state>/seq` marker
    beside it, in the field set `plugins/aukora-kira/lib/memory-owner.mjs` actually writes
    ({verdict,key,contentSha256,operation,sequence,prev,hash}).

    `keep` drops the tail. `reset_seq` is the CAREFUL truncation: the marker is rewritten so
    the store no longer disagrees with itself, which is the case that only a head retained
    outside the state directory can catch. `rewrite_first` alters an EARLIER entry instead,
    which is a different fault with a different name.
    """
    os.makedirs(state, exist_ok=True)
    domain = "aukora:aura-record:v1"
    prev = domain
    lines = []
    for i in range(1, count + 1):
        body = {
            "verdict": "settled",
            "key": f"kira:{hashlib.sha256(f'probe-{i}'.encode()).hexdigest()}",
            "contentSha256": hashlib.sha256(f"content-{i}".encode()).hexdigest(),
            "operation": "memory.put",
            "sequence": i,
            "prev": prev,
        }
        digest = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        prev = digest
        lines.append(json.dumps({**body, "hash": digest}, separators=(",", ":")))
    if keep is not None:
        lines = lines[:keep]
    if rewrite_first:
        first = json.loads(lines[0])
        first["verdict"] = "rewritten"
        lines[0] = json.dumps(first, separators=(",", ":"))
    with open(os.path.join(state, "aura.jsonl"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    with open(os.path.join(state, "seq"), "w", encoding="utf-8") as fh:
        fh.write(str(keep if (keep is not None and reset_seq) else count))


def main() -> int:
    tmp = tempfile.mkdtemp(prefix="phase0-g1-")
    failures: list[str] = []

    # THE COURT MUST NOT BE ABLE TO REACH THE OWNER'S WORLD. The mirror defaults to the owner's real
    # iCloud Drive folder, and iCloud Drive IS mounted on this machine — so a court that did not
    # pin the mirror wrote retained heads into his synced archive. MEASURED: it did, and a later
    # arm then READ one of those stray heads back and answered about a ledger it had never seen.
    #
    # Pinned in the ENVIRONMENT, not at each call site, and that distinction is the fix: a
    # per-call helper only covers the calls somebody remembered to convert, and the failure was
    # precisely a call site nobody did. Every child process inherits this.
    os.environ["AUKORA_AURA_MEMORY_RETAINER_MIRROR"] = os.path.join(tmp, "court-mirror")
    os.environ["AUKORA_AURA_MEMORY_RETAINER_TARGET"] = os.path.join(tmp, "court-local")

    def mirror(tag: str) -> str:
        """Point the mirror at a FRESH directory and return it.

        Called at the start of each arm group, because the check searches EVERY store and keeps
        the strongest head it finds. A shared mirror therefore leaks one arm's heads into the
        next: the "no head anywhere prints UNDETERMINED" arm found a size-4 head left by an
        earlier arm and correctly answered TRUNCATION — a true answer to a question that arm was
        not asking. Isolation here is not tidiness, it is what makes each arm's question its own.
        """
        path = os.path.join(tmp, "mirror", tag)
        os.environ["AUKORA_AURA_MEMORY_RETAINER_MIRROR"] = path
        return path

    def arm(name: str, expected: str, proc: subprocess.CompletedProcess) -> None:
        got = verdict_of(proc) if proc.returncode == 0 else "<non-zero exit>"
        mark = "ok  " if got == expected else "FAIL"
        if got != expected:
            failures.append(f"{name}: expected {expected}, got {got}")
        print(f"  {mark} {name} -> {got}")
        if got != expected:
            print("        stdout:", proc.stdout.strip().replace("\n", "\n        "))

    def mem_arm(name: str, expected: str, expected_exit: int,
                proc: subprocess.CompletedProcess) -> None:
        """The memory arms speak a STATUS and carry an exit code, because that vocabulary is
        the point: truncation is a NAMED status, and 'no head was ever kept' is neither a
        green nor a failure but the third answer — exit 3, UNDETERMINED."""
        got = status_of(proc)
        ok = got == expected and proc.returncode == expected_exit
        if not ok:
            failures.append(f"{name}: expected {expected}/exit {expected_exit}, "
                            f"got {got}/exit {proc.returncode}")
        print(f"  {'ok  ' if ok else 'FAIL'} {name} -> {got} (exit {proc.returncode})")
        if not ok:
            print("        stdout:", proc.stdout.strip().replace("\n", "\n        "))

    try:
        state = os.path.join(tmp, "home", "state")
        os.makedirs(state, exist_ok=True)
        write_records(state, RECORDS)
        retained = os.path.join(tmp, "keep", "retained.json")

        # Arm 1: retain at 13 of 21, then present the untouched 21.
        keep = os.path.join(tmp, "keep-13")
        keep_state = os.path.join(keep, "state")
        os.makedirs(keep_state, exist_ok=True)
        write_records(keep_state, RETAIN_AT)
        r = run([RETAIN, "--state", keep_state, "--out", retained, "--chain-key", "genesis-phase0:aura-chain"])
        assert r.returncode == 0, r.stderr

        # Grow the same stream to 21 records and present it against the retained 13.
        grow_state = os.path.join(tmp, "grown")
        os.makedirs(grow_state, exist_ok=True)
        write_records(grow_state, RECORDS)
        shutil.copy(retained, os.path.join(grow_state, "retained.json"))
        presented = os.path.join(tmp, "keep", "presented.json")
        r = run([PRESENT, "--state", grow_state, "--retained", retained, "--out", presented])
        assert r.returncode == 0, r.stderr + r.stdout
        r = run([VERIFY, retained, presented])
        assert r.returncode == 0, r.stderr
        arm("retained 13, presented 21, untouched", "APPEND_ONLY", r)

        # Arm 2: the same pair with one retained root flipped.
        mutated = os.path.join(tmp, "keep", "retained-mutated.json")
        r = run([VERIFY, retained, presented, "--mutate", "--out", mutated])
        assert r.returncode == 0, r.stderr
        arm("retained root flipped", "OBSERVATION_CONFLICT", r)

        # Arm 3: a head named with nothing retained.
        bare = os.path.join(tmp, "bare")
        os.makedirs(bare, exist_ok=True)
        write_records(bare, RECORDS)
        r = run([PRESENT, "--state", bare, "--out", os.path.join(tmp, "keep", "bare-presented.json")])
        unchecked = "CONSISTENCY_UNCHECKED" in r.stdout
        print(f"  {'ok  ' if unchecked else 'FAIL'} head named with no retained observation -> "
              f"{'CONSISTENCY_UNCHECKED' if unchecked else 'no marker'}")
        if not unchecked:
            failures.append("unpaired head did not print CONSISTENCY_UNCHECKED")

        # Arm 4: the proof damaged in transit — one proof node zeroed.
        damaged = os.path.join(tmp, "keep", "presented-damaged.json")
        doc = json.load(open(presented, encoding="utf-8"))
        assert doc["proofFromPrevious"], "expected a non-empty proof for 13 -> 21"
        doc["proofFromPrevious"][0] = "00" * 32
        with open(damaged, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, sort_keys=True)
        arm("proof damaged in transit", "UNDETERMINED", run([VERIFY, retained, damaged]))

        # Arm 5: a power-of-two retained size cannot carry an accusation when the tree
        # also GREW — the retained root is the fold seed, so a rewritten prefix and a
        # damaged proof are indistinguishable. This is the court's declared limit, and
        # the arm keeps the limit measured rather than remembered.
        pow_state = os.path.join(tmp, "pow")
        os.makedirs(pow_state, exist_ok=True)
        write_records(pow_state, 16)
        pow_retained = os.path.join(tmp, "keep", "pow-retained.json")
        pow_presented = os.path.join(tmp, "keep", "pow-presented.json")
        pow_mutated = os.path.join(tmp, "keep", "pow-retained-mutated.json")
        r = run([RETAIN, "--state", pow_state, "--out", pow_retained, "--chain-key", "genesis-phase0:aura-chain"])
        assert r.returncode == 0, r.stderr
        write_records(pow_state, RECORDS)  # 16 -> 21: power-of-two retained size AND growth
        r = run([PRESENT, "--state", pow_state, "--retained", pow_retained, "--out", pow_presented])
        assert r.returncode == 0, r.stderr + r.stdout
        arm("power-of-two retained, log grown, untouched", "APPEND_ONLY",
            run([VERIFY, pow_retained, pow_presented]))
        arm("power-of-two retained, root flipped", "UNDETERMINED",
            run([VERIFY, pow_retained, pow_presented, "--mutate", "--out", pow_mutated]))

        # Arm 6: an earlier record rewritten inside the retained range. The producer
        # must refuse to present a proof here, because presenting one would ask the
        # court a question about a log that no longer exists.
        broken = os.path.join(tmp, "broken")
        os.makedirs(broken, exist_ok=True)
        write_records(broken, RECORDS, upto_line=5)
        r = run([PRESENT, "--state", broken, "--retained", retained,
                 "--out", os.path.join(tmp, "keep", "broken-presented.json")])
        marker = "CONSISTENCY_UNCHECKED" in r.stdout and r.returncode == 3
        print(f"  {'ok  ' if marker else 'FAIL'} earlier record rewritten, producer asked to present -> "
              f"{'CONSISTENCY_UNCHECKED' if marker else (r.stdout.strip().splitlines()[0] if r.stdout.strip() else 'no output')}"
              f"{'' if marker else f' (exit {r.returncode})'}")
        if not marker:
            failures.append("a rewritten earlier record was not refused by the producer")

        # Arm 7: the same rewritten stream presented anyway, by hand, with a proof
        # computed over the rewritten leaves. The producer refusing is not evidence
        # that the court would catch it, so the court is asked directly.
        forged_state = os.path.join(tmp, "forged")
        os.makedirs(forged_state, exist_ok=True)
        write_records(forged_state, RECORDS, upto_line=5)
        forged_hashes, _ = phase0log.leaf_hashes(forged_state)
        kept = json.load(open(retained, encoding="utf-8"))
        forged = phase0log.observation(RECORDS, forged_hashes, 2, kept["chainKey"])
        forged["proofFromPrevious"] = [
            x.hex() for x in phase0log.proof_from(kept["treeSize"], forged_hashes)]
        forged_presented = os.path.join(tmp, "keep", "forged-presented.json")
        with open(forged_presented, "w", encoding="utf-8") as fh:
            json.dump(forged, fh, sort_keys=True)
        arm("rewritten stream presented by hand anyway", "OBSERVATION_CONFLICT",
            run([VERIFY, retained, forged_presented]))

        # Arms 8-10: the second retainer. A retainer on this host's own disk is still a
        # separate store, so a rewritten local log cannot carry it along. `verify
        # --retainer` reads the observation from the retainer and nowhere else.
        retainer = os.path.join(tmp, "retainer")
        keep2 = os.path.join(tmp, "keep2")
        keep2_state = os.path.join(keep2, "state")
        os.makedirs(keep2_state, exist_ok=True)
        write_records(keep2_state, RETAIN_AT)
        r = run([RETAIN, "--state", keep2_state, "--out", os.path.join(keep2, "retained.json"),
                 "--chain-key", "genesis-phase0:aura-chain", "--retainer", retainer])
        assert r.returncode == 0, r.stderr + r.stdout
        assert "RETAINER" in r.stdout, "retain-head did not report the retainer write"

        grown2 = os.path.join(tmp, "grown2")
        os.makedirs(grown2, exist_ok=True)
        write_records(grown2, RECORDS)
        presented2 = os.path.join(keep2, "presented.json")
        r = run([PRESENT, "--state", grown2, "--retained", os.path.join(keep2, "retained.json"),
                 "--out", presented2])
        assert r.returncode == 0, r.stderr + r.stdout
        r = run([VERIFY, "--retainer", retainer, presented2])
        assert r.returncode == 0, r.stderr
        arm("retainer holds the observation, log grown honestly", "APPEND_ONLY", r)
        custody_ok = "RETAINER_SAME_OWNER" in r.stdout
        print(f"  {'ok  ' if custody_ok else 'FAIL'} retainer verdict is labelled with its custody limit")
        if not custody_ok:
            failures.append("a retainer verdict was not labelled RETAINER_SAME_OWNER")

        # Arm 9: the whole local log is rewritten and every root re-signed, so a local
        # retained copy would have been rewritten with it. The retainer still holds the
        # earlier observation, and the conflicting pair is handed to the court by hand
        # so the court — not the producer — is what answers. Same size, different root,
        # empty proof: the tree cannot be an extension of itself.
        rewritten_root_state = os.path.join(tmp, "rewritten-root")
        os.makedirs(rewritten_root_state, exist_ok=True)
        write_records(rewritten_root_state, RETAIN_AT, relabel=True)
        rewritten_hashes, _ = phase0log.leaf_hashes(rewritten_root_state)
        kept_remote, _ = retainer_mod.read_observation(retainer, "genesis-phase0:aura-chain", RETAIN_AT)
        conflicting = phase0log.observation(RETAIN_AT, rewritten_hashes, 2, "genesis-phase0:aura-chain")
        conflicting["proofFromPrevious"] = []
        conflicting_path = os.path.join(keep2, "conflicting-presented.json")
        with open(conflicting_path, "w", encoding="utf-8") as fh:
            json.dump(conflicting, fh, sort_keys=True)
        print(f"  ..  rewritten root {conflicting['root'][:16]}… vs retained {kept_remote['root'][:16]}…")
        arm("whole local log rewritten and re-signed, checked against the retainer",
            "OBSERVATION_CONFLICT", run([VERIFY, "--retainer", retainer, conflicting_path]))

        # Arm 10: a size the retainer never retained. It must refuse rather than fall
        # back to any local copy, because a silent fallback would make the custody claim
        # false while still printing a verdict.
        nofallback = os.path.join(keep2, "presented-at-other-size.json")
        other = phase0log.observation(RECORDS, phase0log.leaf_hashes(grown2)[0], 2, "genesis-phase0:aura-chain")
        other["proofFromPrevious"] = []
        with open(nofallback, "w", encoding="utf-8") as fh:
            json.dump(other, fh, sort_keys=True)
        r = run([VERIFY, "--retainer", retainer, nofallback])
        refused = "CONSISTENCY_UNCHECKED" in r.stdout and r.returncode == 3
        print(f"  {'ok  ' if refused else 'FAIL'} retainer asked for a size it does not hold -> "
              f"{'CONSISTENCY_UNCHECKED' if refused else (r.stdout.strip().splitlines()[0] if r.stdout.strip() else 'no output')}"
              f"{'' if refused else f' (exit {r.returncode})'}")
        if not refused:
            failures.append("a retainer miss did not refuse; a local fallback would make custody claims false")

        # Arm 11: a retainer that already holds a different root for the same size must
        # never be overwritten. A retainer you can rewrite is not a retainer.
        overwrite = run([RETAIN, "--state", rewritten_root_state,
                         "--out", os.path.join(tmp, "keep2", "retained-again.json"),
                         "--chain-key", "genesis-phase0:aura-chain", "--retainer", retainer])
        blocked = "REFUSED" in (overwrite.stdout + overwrite.stderr) and overwrite.returncode == 1
        print(f"  {'ok  ' if blocked else 'FAIL'} retaining a different root for a retained size -> "
              f"{'refused' if blocked else 'ACCEPTED (defect)'}")
        if not blocked:
            failures.append("the retainer accepted a different root for an already-retained size")

        # Arm 12: the court's own published vector pair, unmutated. Cheap, and it means a
        # vendored-bytes problem fails here as well as in the pin check.
        arm("vendored vector pair, untouched", "APPEND_ONLY",
            run([VERIFY, os.path.join(ROOT, VECTORS, "retained.json"),
                 os.path.join(ROOT, VECTORS, "append-only.json")]))

        # Arms 13-14: no growth at all. Every other arm here grows the log, so the
        # same-size path — retained N, presented N, empty proof — was the one case this
        # self-check never exercised, and it is the case a fork-without-growth produces.
        # The toy's court carries both vectors; this one now covers both outcomes.
        same_state = os.path.join(tmp, "same-size")
        os.makedirs(same_state, exist_ok=True)
        write_records(same_state, RETAIN_AT)
        same_retained = os.path.join(tmp, "keep", "same-retained.json")
        same_presented = os.path.join(tmp, "keep", "same-presented.json")
        r = run([RETAIN, "--state", same_state, "--out", same_retained,
                 "--chain-key", "genesis-phase0:aura-chain"])
        assert r.returncode == 0, r.stderr
        r = run([PRESENT, "--state", same_state, "--retained", same_retained, "--out", same_presented])
        assert r.returncode == 0, r.stderr + r.stdout
        arm("same size, identical roots, empty proof", "APPEND_ONLY",
            run([VERIFY, same_retained, same_presented]))
        arm("same size, different roots, empty proof", "OBSERVATION_CONFLICT",
            run([VERIFY, same_retained, same_presented, "--mutate",
                 "--out", os.path.join(tmp, "keep", "same-mutated.json")]))

        # ── Arms 15-20: the MEMORY ledger, which is a different file ────────────────────
        # Every arm above is about `<state>/aura/records.jsonl`, the composition stream.
        # Kira's memory ledger is `<kira-state>/aura.jsonl`, and NOTHING retained a head of
        # it anywhere the ledger could not reach — so the newest memory could be dropped
        # and every verifier here still read green. These arms are that gap.
        mem = os.path.join(tmp, "memory")
        os.makedirs(mem, exist_ok=True)
        mirror("memory")

        # Arms 15-16: an honest ledger, and an honest GROWTH of one.
        mem_state = os.path.join(mem, "grow")
        write_memory_ledger(mem_state, 2)
        mem_keep = os.path.join(mem, "keep-small")
        mem_arm("memory: retained at 2", "MEMORY_HEAD_RETAINED", 0,
                run([MEMORY_HEAD, "retain", "--state", mem_state, "--target", mem_keep]))
        write_memory_ledger(mem_state, 4)
        mem_arm("memory: honest growth 2 -> 4 verifies", "APPEND_ONLY", 0,
                run([MEMORY_HEAD, "check", "--state", mem_state, "--target", mem_keep]))

        # Arms 17-18: TRUNCATION, the careful way first. The `seq` marker is rewritten so
        # the store no longer disagrees with itself — which is exactly why the marker is
        # not the detector, and a head kept OUTSIDE the state directory is.
        mem_full = os.path.join(mem, "full")
        write_memory_ledger(mem_full, 4)
        mem_ret = os.path.join(mem, "keep-four")
        mem_arm("memory: retained at 4", "MEMORY_HEAD_RETAINED", 0,
                run([MEMORY_HEAD, "retain", "--state", mem_full, "--target", mem_ret]))

        mem_reseq = os.path.join(mem, "trunc-reseq")
        write_memory_ledger(mem_reseq, 4, keep=3, reset_seq=True)
        mem_arm("memory: truncated to 3 WITH seq reset is caught", "TRUNCATION_BELOW_RETAINED_HEAD", 1,
                run([MEMORY_HEAD, "check", "--state", mem_reseq, "--target", mem_ret]))

        mem_loose = os.path.join(mem, "trunc-loose")
        write_memory_ledger(mem_loose, 4, keep=3, reset_seq=False)
        mem_arm("memory: truncated to 3, seq left behind, also caught",
                "TRUNCATION_BELOW_RETAINED_HEAD", 1,
                run([MEMORY_HEAD, "check", "--state", mem_loose, "--target", mem_ret]))

        # Arm 19: THE NEGATIVE CONTROL FOR EVERY ARM ABOVE. Same truncated ledger, no head
        # retained anywhere. Nothing local can tell it from a ledger that was never longer,
        # so the honest answer is UNDETERMINED — not a green, and not a failure.
        # `--no-mirror`: the caller DECLARES the scope. Without it the check consults every store
        # it is allowed to, and a head kept for another store turns this no-head question into
        # TRUNCATION_BELOW_RETAINED_HEAD — an accusation. The previous version isolated this by
        # pointing the mirror at a fresh directory, which is the same answer reached by
        # environment discipline rather than by asking the question the arm names.
        mem_arm("memory: no retained head prints UNDETERMINED, never green",
                "COMPLETENESS_UNDETERMINED", 3,
                run([MEMORY_HEAD, "check", "--state", mem_reseq,
                     "--target", os.path.join(mem, "never-retained"), "--no-mirror"]))

        # Arm 20: a rewritten EARLIER entry. A different fault from a dropped tail, and it
        # must not arrive under the truncation name.
        mem_rewritten = os.path.join(mem, "rewritten")
        write_memory_ledger(mem_rewritten, 4, rewrite_first=True)
        mem_arm("memory: a rewritten earlier entry is named as such", "MEMORY_PREFIX_REWRITTEN", 1,
                run([MEMORY_HEAD, "check", "--state", mem_rewritten, "--target", mem_ret]))

        # Arms 34-35: THE RECONCILIATION, MADE EXPLICIT — one question, two scopes, two answers,
        # and the answer follows the scope the CALLER DECLARED rather than the state of an
        # environment variable. The mirror keeps a size-3 head; the ledger is then cut to 2 and
        # its `seq` reset, so the mirrored head genuinely convicts it. Asking about a DIFFERENT
        # store with no head of its own is then:
        #   default      -> TRUNCATION_BELOW_RETAINED_HEAD, an ACCUSATION drawn from a head kept
        #                   for another store, which is the wrong answer to the question asked;
        #   --no-mirror  -> COMPLETENESS_UNDETERMINED, the honest one.
        # Neither is wrong about its own question, and that is why both are arms: a court that
        # only pinned the second would leave the first behaviour undocumented.
        mirror("scope")
        scope_state = os.path.join(mem, "scope-state")
        write_memory_ledger(scope_state, 3)
        run([MEMORY_HEAD, "retain", "--state", scope_state,
             "--target", os.path.join(mem, "scope-local")])
        write_memory_ledger(scope_state, 3, keep=2, reset_seq=True)
        scope_none = os.path.join(mem, "scope-none")
        mem_arm("scope: without --no-mirror a mirror head answers a no-head question with TRUNCATION",
                "TRUNCATION_BELOW_RETAINED_HEAD", 1,
                run([MEMORY_HEAD, "check", "--state", scope_state, "--target", scope_none]))
        mem_arm("scope: with --no-mirror the SAME question is honestly UNDETERMINED",
                "COMPLETENESS_UNDETERMINED", 3,
                run([MEMORY_HEAD, "check", "--state", scope_state, "--target", scope_none,
                     "--no-mirror"]))

        # Arm 21: THE WHOLE LEDGER GONE. This arm exists because the demo found the defect it
        # pins. `read_stream` refuses an empty stream — correctly, there is no tree over no
        # leaves — and the first version of `check` therefore asked the ledger to describe
        # itself BEFORE consulting the retained head, so the strongest possible truncation was
        # reported as MEMORY_HEAD_REFUSED, an unreadable file. An empty ledger under a retained
        # head is not a file fault; it is every entry missing.
        mem_emptied = os.path.join(mem, "emptied")
        write_memory_ledger(mem_emptied, 2, keep=0, reset_seq=True)
        mem_arm("memory: the WHOLE ledger gone under a retained head is truncation",
                "TRUNCATION_BELOW_RETAINED_HEAD", 1,
                run([MEMORY_HEAD, "check", "--state", mem_emptied, "--target", mem_keep]))

        # ── Arms 22-25: THE CONFIG KNOB ─────────────────────────────────────────────────
        # Where a retained head goes is the owner's decision, and the stated intent is that
        # `~/aukora-private/retained-heads/` can later be pointed at iCloud Drive. A knob is
        # only a knob if its precedence is measured and a `~` in it resolves — `abspath` alone
        # does NOT expand `~`, so a typo there creates a directory literally named `~` while
        # every later check looks in the intended place and answers UNDETERMINED.
        def arm_true(name: str, ok: bool, detail: str) -> None:
            if not ok:
                failures.append(f"{name}: {detail}")
            print(f"  {'ok  ' if ok else 'FAIL'} {name} -> {detail}")

        knob_state = os.path.join(mem, "knob")
        write_memory_ledger(knob_state, 2)
        unset = {"AUKORA_AURA_MEMORY_RETAINER_TARGET": None}

        bare = run([MEMORY_HEAD, "config", "--state", knob_state], env=unset)
        arm_true("config: nothing named prints NOT_CONFIGURED, not a silent default",
                 field_of(bare, "STATUS") == "MEMORY_HEAD_NOT_CONFIGURED" and bare.returncode == 0,
                 field_of(bare, "STATUS"))

        tilde = "~/phase0-court-retained-heads"
        from_env = run([MEMORY_HEAD, "config", "--state", knob_state],
                       env={"AUKORA_AURA_MEMORY_RETAINER_TARGET": tilde})
        expected_tilde = os.path.join(os.path.expanduser("~"), "phase0-court-retained-heads")
        arm_true("config: a `~` destination resolves instead of creating a literal `~`",
                 field_of(from_env, "TARGET") == expected_tilde and not os.path.exists("~"),
                 field_of(from_env, "TARGET"))

        # An argument outranks the environment: a knob whose precedence is untested is a knob
        # nobody can predict.
        both = run([MEMORY_HEAD, "config", "--state", knob_state, "--target", os.path.join(mem, "explicit")],
                   env={"AUKORA_AURA_MEMORY_RETAINER_TARGET": tilde})
        arm_true("config: --target outranks the environment",
                 field_of(both, "TARGET") == os.path.join(mem, "explicit"),
                 field_of(both, "TARGET"))

        broken_state = os.path.join(mem, "knob-broken")
        write_memory_ledger(broken_state, 2)
        with open(os.path.join(broken_state, "aura-memory-retainer.json"), "w", encoding="utf-8") as fh:
            fh.write("{ not json")
        broken = run([MEMORY_HEAD, "retain", "--state", broken_state], env=unset)
        mem_arm("config: a file that exists and is unreadable is a FAULT, not a no-op",
                "MEMORY_HEAD_REFUSED", 2, broken)

        # ── Arms 26-28: CROSS-REFERENCE, the two-trains result ──────────────────────────
        # `lab-heart/C-two-trains.mjs`: two readers shown two different histories of ONE log
        # BOTH get a green from the append-only court, because each is internally consistent.
        # A head that also remembers the other train's root AT A SIZE is the only thing here
        # that can separate them.
        train_a = os.path.join(mem, "train-a")
        train_b = os.path.join(mem, "train-b")
        mirror("trains")
        write_memory_ledger(train_a, 2)
        write_memory_ledger(train_b, 2)
        train_keep = os.path.join(mem, "train-keep")
        mem_arm("two trains: train A's head remembers train B's",
                "MEMORY_HEAD_RETAINED", 0,
                run([MEMORY_HEAD, "retain", "--state", train_a, "--target", train_keep,
                     "--cross-ref", train_b]))

        honest_pair = run([MEMORY_HEAD, "check", "--state", train_a, "--target", train_keep])
        arm_true("two trains: both honest, the cross-reference holds",
                 field_of(honest_pair, "CROSS-REF").startswith("CROSS_REFERENCE_HELD"),
                 field_of(honest_pair, "CROSS-REF"))

        # THE EQUIVOCATION. Auma shows a different history of the same claimed log, with its
        # own `seq` made consistent so nothing local disagrees — and train A's ledger is
        # untouched, so the court above would still say APPEND_ONLY.
        write_memory_ledger(train_b, 2, keep=1, reset_seq=True)
        forked = run([MEMORY_HEAD, "check", "--state", train_a, "--target", train_keep])
        mem_arm("two trains: equivocation is caught, and it OUTRANKS the green",
                "CROSS_REFERENCE_CONFLICT", 1, forked)

        # THE SAME-SIZE FORK, and this arm exists because a MUTATION FOUND IT MISSING. A
        # shorter train is caught by comparing LENGTHS, so the arm above never reached the
        # root comparison — disabling that comparison outright left the court green, which is
        # the definition of an arm passing for a reason other than the one it names. Here the
        # referenced ledger keeps its size and changes its content, so only the ROOT can catch
        # it: this is the fork two readers of one log actually see.
        write_memory_ledger(train_b, 2, rewrite_first=True)
        forked_same = run([MEMORY_HEAD, "check", "--state", train_a, "--target", train_keep])
        mem_arm("two trains: a SAME-SIZE fork is caught by the root comparison",
                "CROSS_REFERENCE_CONFLICT", 1, forked_same)

        # And the control that keeps the accusation honest: a train that is merely AWAY is
        # named, and does NOT get promoted over a green.
        os.remove(os.path.join(train_b, "aura.jsonl"))
        away = run([MEMORY_HEAD, "check", "--state", train_a, "--target", train_keep])
        arm_true("two trains: an AWAY train is named, never promoted over the green",
                 field_of(away, "STATUS") == "APPEND_ONLY" and away.returncode == 0
                 and field_of(away, "CROSS-REF").startswith("CROSS_REFERENCE_UNREACHABLE"),
                 f"{field_of(away, 'STATUS')} / {field_of(away, 'CROSS-REF')}")

        # ── Arms 30-33: THE MIRROR, off this disk ───────────────────────────────────────
        # A second directory on the same filesystem is a second copy in name only: one rm, one
        # failed disk, one stolen laptop takes both. The mirror defaults to the owner's iCloud Drive
        # folder, which IS mounted here — so every arm below passes `--mirror` explicitly, and
        # `mirror()` has already pinned the environment. Nothing in this court may write to a
        # destination a human did not choose for it.
        import memory_head  # noqa: PLC0415  (in-process, for the guard unit arm only)

        mir = os.path.join(mem, "mirror-arms")
        os.makedirs(mir, exist_ok=True)
        m_state = os.path.join(mem, "mirror-state")
        m_local = os.path.join(mem, "mirror-local")
        m_cloud = os.path.join(mem, "mirror-cloud")
        write_memory_ledger(m_state, 3)
        kept_both = run([MEMORY_HEAD, "retain", "--state", m_state,
                         "--target", m_local, "--mirror", m_cloud])
        arm_true("mirror: a retain writes BOTH copies",
                 kept_both.returncode == 0 and "MIRROR_WRITTEN" in kept_both.stdout
                 and os.path.exists(os.path.join(m_local, "heads")),
                 field_of(kept_both, "MIRROR"))

        # THE REQUIREMENT, and the reason a mirror is worth having at all: the local head is
        # GONE — deleted, or on a disk that did not come back — and the copy that is not on this
        # machine still answers the question. A check that read only the local directory would
        # report UNDETERMINED here, which is the failure the mirror exists to remove.
        shutil.rmtree(m_local, ignore_errors=True)
        write_memory_ledger(m_state, 3, keep=2, reset_seq=True)
        mirror_only = run([MEMORY_HEAD, "check", "--state", m_state,
                           "--target", m_local, "--mirror", m_cloud])
        mem_arm("mirror: a head present ONLY off-machine still catches truncation",
                "TRUNCATION_BELOW_RETAINED_HEAD", 1, mirror_only)
        arm_true("mirror: and the verdict names the store it read",
                 field_of(mirror_only, "RETAINED FROM") == m_cloud,
                 field_of(mirror_only, "RETAINED FROM"))

        # An unreachable mirror is a FLAG beside a real local head, never a failed retain: the
        # effect and the primary head are already durable when the mirror is attempted.
        #
        # THE PARENT IS A FILE, and that is the point. This arm used to point the mirror at a
        # path whose parent merely did not exist — and then `_mirror_ready` was tightened for the
        # wrong reason and started treating every uncreated parent as unreachable, which silently
        # skipped perfectly good local mirrors. The guard belongs to iCloud only; everything else
        # a caller names gets created. So the destination here is genuinely impossible to make,
        # not merely absent.
        blocker = os.path.join(mem, "mirror-blocker")
        with open(blocker, "w", encoding="utf-8") as handle:
            handle.write("a file where a directory would have to be\n")
        un_mirror = os.path.join(blocker, "retained")
        un_state = os.path.join(mem, "mirror-unreachable")
        write_memory_ledger(un_state, 2)
        unreachable = run([MEMORY_HEAD, "retain", "--state", un_state,
                           "--target", os.path.join(mem, "unreachable-local"),
                           "--mirror", un_mirror])
        arm_true("mirror: an unreachable mirror is named and does NOT fail the retain",
                 field_of(unreachable, "STATUS") == "MEMORY_HEAD_RETAINED"
                 and unreachable.returncode == 0
                 and "MIRROR_UNREACHED" in unreachable.stdout,
                 f"{field_of(unreachable, 'STATUS')} / {field_of(unreachable, 'MIRROR')}")

        # THE GUARD THAT KEEPS THE MIRROR HONEST, as a direct unit arm because it cannot be
        # provoked through the CLI on a machine where iCloud Drive IS mounted. `makedirs` would
        # happily build a fake `com~apple~CloudDocs` chain locally and the retain would then
        # report an off-machine copy that is on the same disk — the one outcome worse than no
        # mirror. The root is swapped in-process so the guard is exercised rather than assumed.
        original_root = memory_head.CLOUD_ROOT
        try:
            memory_head.CLOUD_ROOT = "/nonexistent-cloud-root"
            refuses = memory_head._mirror_ready("/nonexistent-cloud-root/aukora-backups/heads") is False
            memory_head.CLOUD_ROOT = mem
            allows = memory_head._mirror_ready(os.path.join(mem, "anything")) is True
        finally:
            memory_head.CLOUD_ROOT = original_root
        arm_true("mirror: an absent iCloud root is REFUSED, not fabricated on this disk",
                 refuses and allows, f"refuses={refuses} allows_inside_existing_root={allows}")

        # Arm 36: A FRESH LOCAL DESTINATION IS CREATED, NOT SKIPPED. This arm exists because an
        # earlier tightening of `_mirror_ready` refused ANY mirror whose parent did not exist —
        # so a destination an operator had just configured reported `MIRROR_UNREACHED` and no
        # second copy was written at all. The guard belongs to iCloud's root and nowhere else:
        # for any other path a caller names, creating it is exactly what they asked for.
        fresh_mirror = os.path.join(mem, "fresh", "nested", "mirror")
        fresh_state = os.path.join(mem, "fresh-state")
        write_memory_ledger(fresh_state, 2)
        fresh = run([MEMORY_HEAD, "retain", "--state", fresh_state,
                     "--target", os.path.join(mem, "fresh-local"),
                     "--mirror", fresh_mirror])
        arm_true("mirror: a fresh local destination is CREATED, not reported unreachable",
                 "MIRROR_WRITTEN" in fresh.stdout and os.path.isdir(fresh_mirror),
                 field_of(fresh, "MIRROR"))

    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if failures:
        print(f"G1 SELFCHECK: FAILED ({len(failures)} arm(s))")
        for f in failures:
            print(f"  {f}")
        return 1
    print(f"G1 SELFCHECK: {ARM_COUNT}/{ARM_COUNT} arms produced their published verdict")
    return 0


if __name__ == "__main__":
    sys.exit(main())
