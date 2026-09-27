#!/usr/bin/env python3
"""experience-court — may this record's provenance be adopted as memory of an event?

    python3 scripts/kira/experience-court.py --candidate <record.json> --evidence <dir>

WHY THIS EXISTS. `plugins/aukora-kira/GRADUATION.md` gates adoption of a Kira record on the
verdicts of courts that *exist and can be run*. It names the Experience Court as the court the
assignment wanted, and then states plainly that no such court is defined in the tree: no
script, no verdict vocabulary, no exit convention. That note is honest, and it is also an
open door — the contract says that when such a court is defined, its verdicts become a row in
§2 and the placeholder row is REMOVED rather than kept alongside it. This file is that court.

It does not define a record kind. It does not extend the record schema. It decides one thing
about a candidate someone else already produced.

THE ONE QUESTION

    does every provenance claim in the candidate resolve to an artifact that is actually
    present, and whose bytes say what the candidate says they say?

A record is not memory of an event because a model wrote `source: []` under a heading called
"experience". It is memory of an event when the things it derives from exist, are named by
digest, and are still those bytes. Everything below is about that question and nothing else.

THE THREE VERDICTS

| verdict        | what it means |
| ---            | --- |
| `GROUNDED`     | Every claim resolved. The record's identifier is the one its own fields derive; every `source` entry names a KIRA RECORD present in the evidence set; every `links` target is present. Nothing here says the event was interesting, or that anyone attended it. |
| `UNGROUNDED`   | At least one claim did not resolve: a source that is absent, a source shaped as anything other than a Kira record identifier, an identifier that is not the one the fields derive, a link to a record that is not in evidence. This is the verdict that says a record is asserting provenance it cannot produce. |
| `UNDETERMINED` | The pair does not answer the question: malformed JSON, a missing file, an empty evidence set, a candidate that is not a records-shaped object. This is NOT "nothing is wrong". It is "this pair does not answer the question". |

WHAT A `GROUNDED` VERDICT DOES NOT ESTABLISH — and this section is not decoration

- **Not that anything happened.** That a receipt exists is evidence that a receipt exists. This
  court reads bytes; it did not observe the event, and it cannot.
- **Not that a record is true.** A record can be perfectly grounded in real artifacts and still
  misdescribe them. Grounding is provenance, not accuracy.
- **Not authorization.** A verdict is not a grant, a nonce, a key, a capability, or a
  permission. It authorizes no effect. No part of this system may treat it as one.
- **Not attendance, and not inner life.** `GROUNDED` says nothing about whether a model was
  present, remembered, or experienced anything. The word "experience" in the filename names the
  record kind this gates; it is not a claim about anyone's interior.
- **Not personhood, and not continuity.** Nothing here bears on identity across instances.

A `GROUNDED` verdict is a floor, not a ceiling: it is the minimum below which adoption would
mean storing a claim nobody can check. It is not permission to adopt, and adoption remains the
operator's act with the operator's grant.

THE EXIT CONVENTION, stated because a reader must not have to infer it

    exit 0   the court ran and reached one of the three verdicts above
    exit 2   the court could not run: bad argument, unreadable input, missing dependency

Per `scripts/aura/COURT-CONTRACT.md` §2, the verdict is in the TEXT and never in the status:
an `UNGROUNDED` verdict is a successful run and exits 0. A caller that wants a code must read
the `VERDICT:` line. `--require GROUNDED` is offered for exactly that caller and is the only
path that turns a verdict into a status code, so that the convenience can never be mistaken for
the convention.

Two cases look alike and are deliberately NOT the same:

    a candidate that is not JSON, or not records-shaped        -> refusal, exit 2
    a well-formed candidate whose evidence set is unusable      -> UNDETERMINED verdict, exit 0

The first never got to ask the question, so it has no answer to report and must not be dressed
as one. The second asked it and the pair did not resolve. Collapsing the two would hide a wrong
path behind the same word as an honest indeterminate result.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

# The composition layer's canonicalizer, imported rather than reimplemented: two canonical
# forms for one structure is how a signature comes to cover bytes a verifier did not
# re-derive. `jcs` sorts object keys by UTF-16 code units, which is what the JavaScript
# producer's default `.sort()` does, so the two agree on every key this schema admits.
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "composition"))

from jcs import JCSError, canonicalize_bytes  # noqa: E402

#: Kira's record domain, read from `plugins/aukora-kira/lib/record.mjs` (KIRA_RECORD_DOMAIN).
RECORD_DOMAIN = "aukora:kira-memory-record:v0"
RECORD_ID = re.compile(r"^kira:[0-9a-f]{64}$")
SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")
CREATED_AT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

#: The closed candidate field set, from `CANDIDATE_FIELDS` in record.mjs. `transform` is
#: admitted as an optional field by the producer's own docstring and participates in the
#: identifier, so a court that omitted it would accept an identifier no producer derives.
CANDIDATE_FIELDS = (
    "subject", "kind", "source", "content", "links", "privacy", "createdAt", "transform",
)

#: The record kinds Kira admits, from `recordKind`. The court does not add to this
#: list; a kind Kira would refuse is not a record this court has any business gating.
RECORD_KINDS = (
    "observation", "summary", "claim", "preference", "plan", "training-slice", "erasure",
)

PRIVACY_CLASSES = ("local", "exportable", "private")

GROUNDED, UNGROUNDED, UNDETERMINED = "GROUNDED", "UNGROUNDED", "UNDETERMINED"

#: Index key holding the set of identifiers claimed by more than one evidence document. It is not a
#: valid `recordId` (which is always `kira:<64 hex>`), so it can never collide with a real entry.
CONTESTED_KEY = "<contested>"


class CourtError(Exception):
    """The court could not run at all. Never a verdict."""


def fail(message: str) -> "NoReturn":  # type: ignore[valid-type]
    print(f"experience-court-refused: {message}", file=sys.stderr)
    raise SystemExit(2)


def record_id_of(identity: dict) -> str:
    """The identifier Kira's own producer derives, reproduced here.

    `recordIdOf` in `plugins/aukora-kira/lib/record.mjs` hashes, in order: the domain, a NUL
    byte, then the canonical JSON of every record field except `recordId`. Reproducing it is
    the difference between trusting an identifier and checking one — a record whose `recordId`
    is not the one its own fields derive can be renamed without any of its bytes changing, so
    a court that only pattern-matched `^kira:[0-9a-f]{64}$` would wave it through.

    AGREEMENT IS MEASURED, NOT ASSUMED: for the fixture record the producer emits
    `kira:cd3d7add173c3b95018410992ffd4f142ae90e3acbf79f5870a69707915a1722`, and this function
    returns that same string. `--selftest` re-checks it so a drift in either canonicalizer is a
    refusal rather than a quiet mismatch.
    """
    try:
        body = canonicalize_bytes(identity)
    except JCSError as exc:
        raise CourtError(f"identity is not canonicalizable: {exc}") from exc
    return "kira:" + hashlib.sha256(RECORD_DOMAIN.encode("utf-8") + b"\0" + body).hexdigest()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path) -> object:
    try:
        return json.loads(path.read_text())
    except OSError as exc:
        raise CourtError(f"cannot read {path}: {exc}") from exc
    except ValueError as exc:
        raise CourtError(f"{path} is not JSON: {exc}") from exc


def check_candidate_shape(candidate: object) -> dict:
    """The candidate must be one closed records-shaped object. Refuses, never guesses."""
    if not isinstance(candidate, dict):
        raise CourtError("candidate is not a JSON object")
    if candidate.get("domain") != RECORD_DOMAIN:
        raise CourtError(
            f"candidate domain is {candidate.get('domain')!r}, "
            f"and this court gates {RECORD_DOMAIN!r}")
    if candidate.get("grantsAuthority") is not False:
        raise CourtError(
            "candidate.grantsAuthority is not exactly false — a memory record that grants "
            "authority is not a record this court will gate")
    # Every field except `transform` is required; `transform` is optional but participates in
    # the identifier when present. Computed as one complement of one closed set, so an extra
    # field cannot slip through by being absent from a list built out of the record itself.
    missing = [f for f in CANDIDATE_FIELDS if f not in candidate and f != "transform"]
    if missing:
        raise CourtError(f"candidate is missing required field(s): {', '.join(missing)}")
    unknown = sorted(set(candidate) - {"domain", "grantsAuthority", "recordId", *CANDIDATE_FIELDS})
    if unknown:
        raise CourtError(f"candidate carries field(s) outside the closed set: {', '.join(unknown)}")
    if candidate.get("kind") not in RECORD_KINDS:
        raise CourtError(
            f"candidate.kind {candidate.get('kind')!r} is not one of {', '.join(RECORD_KINDS)}")
    if candidate.get("privacy") not in PRIVACY_CLASSES:
        raise CourtError(
            f"candidate.privacy {candidate.get('privacy')!r} is not one of "
            f"{', '.join(PRIVACY_CLASSES)}")
    if not isinstance(candidate.get("subject"), str) or not candidate["subject"]:
        raise CourtError("candidate.subject must be a non-empty string")
    if not isinstance(candidate.get("createdAt"), str) or not CREATED_AT.match(candidate["createdAt"]):
        raise CourtError(
            "candidate.createdAt must be canonical seconds-precision UTC, e.g. "
            "2026-09-17T12:00:00Z")
    for name in ("source", "links"):
        if not isinstance(candidate.get(name), list):
            raise CourtError(f"candidate.{name} must be a list")
    rid = candidate.get("recordId")
    if not isinstance(rid, str) or not RECORD_ID.match(rid):
        raise CourtError("candidate.recordId must match ^kira:[0-9a-f]{64}$")
    return candidate


def check_identifier(candidate: dict) -> list[str]:
    """The claimed identifier must be the one the candidate's own fields derive."""
    identity = {k: v for k, v in candidate.items() if k != "recordId"}
    try:
        derived = record_id_of(identity)
    except CourtError as exc:
        return [f"identifier could not be derived: {exc}"]
    if derived != candidate["recordId"]:
        return [
            f"recordId does not match the identifier its own fields derive: claimed "
            f"{candidate['recordId']}, derived {derived}. A record can be renamed without any "
            f"of its bytes changing, so the claim is the thing being checked."
        ]
    return []


def verify_evidence_record(loaded: object) -> "str | None":
    """The identifier an evidence document ACTUALLY IS, or None if it is not one.

    A DECLARED IDENTITY IS NOT AN IDENTITY. MEASURED DEFECT, reproduced 2026-09-19: an 84-byte
    evidence file containing one key, `recordId`, satisfied a citation — the court returned GROUNDED
    for a source that does not exist, whose claimed identifier did not even derive from its own
    fields (`c020c123…` claimed against `6df9dcf9…` derived). Reading a document's `recordId` and
    trusting it means the citation is satisfied by the ASSERTION of identity, so a file that names a
    record is treated as that record. Kira's own verifier refused both bad sources
    (`identity-mismatch`, `malformed`) while this court accepted them, which is the court claiming a
    check it never performed.

    So the index admits a document only when it is a well-formed records-shaped object AND the
    identifier it claims is the one its own fields derive — the same rule the court already applies
    to the candidate, now applied to what the candidate cites. Anything else is not a record and
    cannot satisfy a source.
    """
    if not isinstance(loaded, dict):
        return None
    try:
        check_candidate_shape(loaded)
    except CourtError:
        return None
    identity = {k: v for k, v in loaded.items() if k != "recordId"}
    try:
        derived = record_id_of(identity)
    except CourtError:
        return None
    return derived if derived == loaded["recordId"] else None


def index_evidence(evidence: Path) -> dict:
    """recordId -> path for every VERIFIED record in the evidence set, plus each file's own name.

    EVIDENCE FOR A RECORD IS OTHER RECORDS, so the index is keyed by the identifier each file
    ACTUALLY IS, not by its filename and not by what it claims. A settled record is
    content-addressed and its object body carries its own `recordId`; a source entry names that
    identifier, so the index has to read the files to learn which identifier each one answers to.
    `verify_evidence_record` is what decides that, and it refuses a document whose declared identity
    does not derive from its own fields.

    A CONTESTED IDENTIFIER RESOLVES TO NOTHING, NOT TO A WINNER. Two documents declaring one
    `recordId` cannot both be it, and one of them may be a re-labelled copy of the other. Choosing
    the valid one and discarding the tampered one would still let a caller decide the outcome by
    which bytes they put in the directory, and it would silently drop the fact that a second
    document claims an identity it does not have. So a claimed identifier that appears in more than
    one document is recorded as CONTESTED and satisfies no `source` at all, however the directory
    happens to enumerate. An invalid declaration can then never be hidden behind a valid sibling,
    and the verdict says which identifier was contested rather than leaving the caller to guess.

    A file that is not a verified record is still indexed by its NAME and PATH, because a caller may
    reasonably lay out supporting material beside the records. It simply cannot be named by a
    `source`, which takes an identifier.
    """
    if not evidence.is_dir():
        raise CourtError(f"evidence is not a directory: {evidence}")
    index: dict[str, Path] = {}
    files = sorted(p for p in evidence.rglob("*") if p.is_file())
    if not files:
        raise CourtError(
            f"the evidence set at {evidence} is EMPTY. An empty set cannot ground anything, and "
            f"reporting UNGROUNDED for one would blame the candidate for the caller's omission. "
            f"Refusing instead.")
    claimants: dict[str, list[tuple[Path, bool]]] = {}
    for path in files:
        index[path.name] = path
        index[str(path)] = path
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(loaded, dict) or not isinstance(loaded.get("recordId"), str):
            continue
        # Every document that NAMES an identifier is a claimant, whether or not it is valid. A
        # tampered copy is exactly the case this has to catch, and it would not be seen at all if
        # only valid documents were counted.
        claimants.setdefault(loaded["recordId"], []).append(
            (path, verify_evidence_record(loaded) is not None))
    contested = {name for name, who in claimants.items() if len(who) > 1}
    for name, who in claimants.items():
        if name in contested:
            continue
        path, valid = who[0]
        if valid:
            index[name] = path
    index[CONTESTED_KEY] = contested
    return index


def check_sources(candidate: dict, index: dict) -> list[str]:
    """Every `source` entry must name another KIRA RECORD that is present in evidence.

    THE SHAPE IS THE PRODUCER'S, NOT ONE I INVENTED. Kira's own `readSourceRef` accepts exactly one
    key, `recordId`, and refuses anything else with `kira.stage:source-field-unknown`. An earlier
    version of this court accepted `{path, sha256}` — a file-shaped provenance — and MEASURED, when
    a record was actually built that way, the producer REFUSED it. A court whose vocabulary includes
    a shape no producer can emit accepts records nobody can settle, which is worse than refusing
    them: it reports GREEN for a candidate that cannot exist. The court is now strictly narrower
    than the producer, which is the only safe direction.
    """
    problems: list[str] = []
    source = candidate["source"]
    if not source:
        problems.append(
            "source is empty: the record cites no other KIRA record. The producer permits an empty "
            "source — it is how a line begins — but the court does not, deliberately. 'I am the "
            "first record' and 'I have provenance' are different claims, and only the second is "
            "checkable; a genesis claim is true by fiat and would make every later record able to "
            "escape its own provenance with the same words. A first record is admitted by the "
            "operator's grant naming it, not by a court that cannot tell it apart from an orphan.")
        return problems
    for i, entry in enumerate(source, start=1):
        if not isinstance(entry, dict):
            problems.append(f"source[{i}] is not an object")
            continue
        # The closed key set is the producer's. A `path`/`sha256` pair is not a source reference
        # Kira can stage, so accepting it would green-light an unstageable record.
        extra = sorted(set(entry) - {"recordId"})
        if extra:
            problems.append(
                f"source[{i}] carries field(s) outside the producer's closed set "
                f"({', '.join(extra)}); Kira's readSourceRef accepts only `recordId` and refuses "
                f"anything else with kira.stage:source-field-unknown")
            continue
        named = entry.get("recordId")
        if not isinstance(named, str) or not RECORD_ID.match(named):
            problems.append(f"source[{i}].recordId is not a kira record identifier")
            continue
        if named in index.get(CONTESTED_KEY, ()):
            problems.append(
                f"source[{i}] names {named!r}, which is claimed by MORE THAN ONE document in the "
                f"evidence set. At most one of them can be that record, and a contested identity is "
                f"not evidence of anything — choosing a winner among them would let whoever "
                f"assembled the directory decide which bytes count. Resolve the conflict (remove or "
                f"re-identify the extra document) and present it again.")
            continue
        if named not in index:
            problems.append(
                f"source[{i}] names {named!r}, which is not present in the evidence set as a record "
                f"whose own fields derive that identifier. Provenance that cannot be produced is the "
                f"thing this verdict is about.")
    return problems


def check_links(candidate: dict, index: dict) -> list[str]:
    """Every `links` target must be present. A link to nothing is not a relationship."""
    problems: list[str] = []
    for i, link in enumerate(candidate["links"], start=1):
        if not isinstance(link, dict):
            problems.append(f"links[{i}] is not an object")
            continue
        target = link.get("recordId")
        if not isinstance(target, str) or not target:
            problems.append(f"links[{i}] carries no `recordId`")
            continue
        if target not in index:
            problems.append(
                f"links[{i}] asserts relation {link.get('relation')!r} toward {target}, which is "
                f"not present in the evidence set. An unresolved link is an assertion about a "
                f"record the court cannot see.")
    return problems


def check_kind_grounding(candidate: dict, index: dict) -> list[str]:
    """Type-specific floors. A claim kind carries more than a label.

    These are deliberately the *minimum* a kind must do to be worth adopting, not a judgment
    about quality: `training-slice` and `erasure` are held to naming their targets, because an
    erasure aimed at nothing and a slice drawn from nothing are both unactionable.
    """
    kind = candidate["kind"]
    content = candidate.get("content")
    problems: list[str] = []
    if kind in ("observation", "claim", "training-slice") and not isinstance(content, dict):
        problems.append(f"kind {kind!r} requires `content` to be an object")
    if kind == "erasure":
        targets = content.get("targets") if isinstance(content, dict) else None
        if not isinstance(targets, list) or not targets:
            problems.append(
                "kind 'erasure' requires content.targets naming at least one recordId: an "
                "erasure that targets nothing erases nothing.")
        else:
            for j, t in enumerate(targets, start=1):
                if not isinstance(t, str) or not RECORD_ID.match(t):
                    problems.append(f"content.targets[{j}] is not a kira recordId")
                elif t not in index:
                    problems.append(
                        f"content.targets[{j}] names {t}, which is not present in the evidence "
                        f"set. An erasure of a record the court cannot see cannot be checked to "
                        f"erase the right thing.")
    if kind == "training-slice":
        if isinstance(content, dict):
            digest = content.get("outputDigest")
            if not isinstance(digest, str) or not SHA256_HEX.match(digest):
                problems.append(
                    "kind 'training-slice' requires content.outputDigest as 64 lowercase hex "
                    "characters: a slice without a digest of what it produced is a label.")
    return problems


def render(verdict: str, reason: str, candidate: dict | None, problems: list[str]) -> None:
    if candidate is not None:
        print(f"  record   : {candidate.get('recordId', '<none>')}")
        print(f"  kind     : {candidate.get('kind', '<none>')}")
        print(f"  subject  : {candidate.get('subject', '<none>')}")
    if problems:
        print("  findings :")
        for p in problems:
            print(f"    - {p}")
    print("")
    print(f"REASON : {reason}")
    print(f"VERDICT: {verdict}")
    if verdict == GROUNDED:
        print("  (a floor, not permission: nothing here says the event happened, that the record "
              "is true, or that anyone attended it. Adoption remains the operator's act.)")


def decide(candidate: dict, evidence: Path) -> tuple[str, list[str], str]:
    """Reach one verdict. Returns `(verdict, problems, reason)`.

    Kept separate from `main` so the self-test can exercise the SAME path a caller takes rather
    than a parallel one. A self-test that re-implemented the decision would pass while the real
    path was broken, which is the failure this court exists to refuse.
    """
    try:
        index = index_evidence(evidence)
    except CourtError as exc:
        return UNDETERMINED, [], str(exc)
    problems = (
        check_identifier(candidate)
        + check_sources(candidate, index)
        + check_links(candidate, index)
        + check_kind_grounding(candidate, index)
    )
    if problems:
        return UNGROUNDED, problems, f"{len(problems)} provenance claim(s) did not resolve"
    return GROUNDED, [], (
        f"every claim resolved: the identifier is the one the fields derive, all "
        f"{len(candidate['source'])} source record(s) are present, and all "
        f"{len(candidate['links'])} link(s) resolve")


def selftest() -> int:
    """Prove the replica matches the producer, and drive every verdict end to end.

    Two kinds of arm, and the second is the one that matters. The identifier arms guard the
    cross-language replica: if this file's canonicalizer and the JavaScript producer's ever
    disagree, every verdict is worthless and a check living only in a report cannot catch it.
    The verdict arms build real candidate and evidence trees in a temporary directory — the
    convention `subject-digest-court.py` already uses — and drive the SAME `decide` path a
    caller drives. A fixture that never touches the shipped path proves nothing about it.

    Every arm asserts; a failure is a red court, never a warning.
    """
    import tempfile

    arms = 0

    def arm(name: str, condition: bool) -> None:
        nonlocal arms
        if not condition:
            raise CourtError(f"selftest arm failed: {name}")
        print(f"  ok    {name}")
        arms += 1

    # ---- the pin: the digest this court is cited by must be its own -------------------------
    #
    # WHY THIS ARM EXISTS. `GRADUATION.md` cites this court BY DIGEST, and NOTHING checked that the
    # digest still matched the file. MEASURED 2026-09-19: it had gone stale — the contract declared
    # `6cc7fc8c…` while the bytes hashed to `3e7c8a64…`, and a later audit quoted a third value. A
    # pin nothing verifies is a comment, and a reader who trusts it is trusting a claim about bytes
    # nobody re-read. Computing it here turns drift into a red court on the next run instead of a
    # discovery months later. The path is derived from THIS file so the arm works from a release
    # tree too, and a contract that cannot be read is a FAILURE rather than a skip: a pin that
    # cannot be checked is not a pin.
    try:
        contract = _HERE.parents[1] / "plugins" / "aukora-kira" / "GRADUATION.md"
        declared = re.search(r"sha256 ([0-9a-f]{64})", contract.read_text(encoding="utf-8"))
        own = hashlib.sha256(Path(__file__).resolve().read_bytes()).hexdigest()
        arm("the digest GRADUATION.md pins is this file's own",
            declared is not None and declared.group(1) == own)
    except OSError as exc:
        raise CourtError(
            f"selftest arm failed: the pin cannot be checked because {exc}; a court cited by digest "
            f"must be able to read the document that cites it") from exc

    # ---- the identifier replica: this file vs the JavaScript producer ----------------------
    fixture = {
        "domain": RECORD_DOMAIN,
        "grantsAuthority": False,
        "subject": "urn:aukora:subject:test-owner",
        "kind": "observation",
        "source": [],
        "content": {"note": "fixture"},
        "links": [],
        "privacy": "local",
        "createdAt": "2026-09-17T12:00:00Z",
    }
    want = "kira:cd3d7add173c3b95018410992ffd4f142ae90e3acbf79f5870a69707915a1722"
    arm("identifier reproduces the JavaScript producer byte for byte",
        record_id_of(fixture) == want)
    arm("a single changed content byte changes the identifier",
        record_id_of({**fixture, "content": {"note": "fixture!"}}) != want)
    arm("key insertion order does not change the identifier",
        record_id_of(dict(reversed(list(fixture.items())))) == want)
    # A renamed field must NOT collide with the real one. This catches a canonicalizer that
    # silently drops keys it does not recognize: dropping `kind` and adding `kindx` would then
    # hash to the same bytes, and two different records would share one identifier.
    drifted = {k: v for k, v in fixture.items() if k != "kind"}
    drifted["kindx"] = "observation"
    arm("renaming a field changes the identifier (a dropper would collide here)",
        record_id_of(drifted) != want)

    # ---- refusals: inputs that never get to ask the question -------------------------------
    for name, bad in (
        ("a record that grants authority is refused", {**fixture, "grantsAuthority": True}),
        ("a foreign domain is refused", {**fixture, "domain": "aukora:something-else:v0"}),
        ("an unknown kind is refused", {**fixture, "kind": "vibes"}),
        ("an unknown privacy class is refused", {**fixture, "privacy": "public"}),
        # A third spelling of the subject field is exactly the drift that shipped a sealed
        # release once. An extra key must be refused, not ignored.
        ("a field outside the closed set is refused", {**fixture, "principal": "someone"}),
        ("a mood-shaped extra field is refused", {**fixture, "mood": "happy"}),
    ):
        try:
            check_candidate_shape(bad)
        except CourtError:
            arm(name, True)
            continue
        raise CourtError(f"refused_to_refuse: {name}")
    renamed = {**fixture, "recordId": "kira:" + "ab" * 32}
    check_candidate_shape(renamed)
    arm("a well-formed identifier its fields do not derive is a finding",
        bool(check_identifier(renamed)))

    # ---- the verdicts, driven through `decide` over real built trees ------------------------
    work = Path(tempfile.mkdtemp(prefix="experience-court-selftest-"))
    try:
        ev = work / "evidence"
        ev.mkdir()
        empty_ev = work / "empty-evidence"
        empty_ev.mkdir()

        def candidate(**overrides) -> dict:
            record = {**fixture, "content": {"note": "an event"}, **overrides}
            record["recordId"] = record_id_of({k: v for k, v in record.items() if k != "recordId"})
            check_candidate_shape(record)
            return record

        # A REAL upstream record, staged and laid down the way a settled record appears: named by
        # its own identifier. An earlier version of this selftest used a `{path, sha256}` entry,
        # which the producer cannot stage at all — so the arm was proving a case that could not
        # exist. Evidence for a Kira record is another Kira record, by identifier.
        upstream = candidate(content={"note": "an upstream observation"})
        (ev / f"{upstream['recordId']}.json").write_text(
            json.dumps(upstream, indent=2) + "\n", encoding="utf-8")
        link_to_upstream = [{"recordId": upstream["recordId"]}]

        arm("GROUNDED: a source naming a record that is present",
            decide(candidate(source=link_to_upstream), ev)[0] == GROUNDED)
        arm("UNGROUNDED: source empty",
            decide(candidate(source=[]), ev)[0] == UNGROUNDED)
        arm("UNGROUNDED: source names a record that is absent",
            decide(candidate(source=[{"recordId": "kira:" + "ab" * 32}]), ev)[0] == UNGROUNDED)
        # THE SHAPE THE PRODUCER REFUSES. If the court accepted it, it would report GREEN for a
        # record Kira cannot stage — worse than refusing, because it looks like a pass.
        arm("UNGROUNDED: a file-shaped source the producer cannot stage",
            decide(candidate(source=[{"path": "receipt.json", "sha256": "cd" * 32}]), ev)[0]
            == UNGROUNDED)
        bad_id = candidate(source=link_to_upstream)
        bad_id["recordId"] = "kira:" + "ef" * 32
        arm("UNGROUNDED: an identifier its fields do not derive",
            decide(bad_id, ev)[0] == UNGROUNDED)
        arm("UNGROUNDED: a link toward a record the court cannot see",
            decide(candidate(source=link_to_upstream,
                            links=[{"recordId": "kira:" + "99" * 32, "relation": "related"}]), ev)[0]
            == UNGROUNDED)

        # ---- THE SOURCE-SIDE IDENTITY ARMS -------------------------------------------------
        #
        # REPRODUCED DEFECT, 2026-09-19: an 84-byte evidence file containing ONE KEY, `recordId`,
        # satisfied a citation and the court returned GROUNDED — for a source that does not exist,
        # whose claimed identifier did not even derive from its own fields. Kira's own verifier
        # refused both bad inputs (`identity-mismatch`, `malformed`) while this court accepted them.
        # These arms exist so that gap cannot reopen silently.
        import shutil as _shutil
        tampered_ev = work / "tampered-evidence"
        tampered_ev.mkdir()
        tampered = dict(upstream)
        tampered["content"] = {"note": "the content was changed, the identifier kept"}
        (tampered_ev / "upstream.json").write_text(json.dumps(tampered, indent=2) + "\n",
                                                   encoding="utf-8")
        arm("UNGROUNDED: a source whose content changed but kept its identifier",
            decide(candidate(source=link_to_upstream), tampered_ev)[0] == UNGROUNDED)

        # IDENTIFIER ONLY — the exact fixture that produced a false GROUNDED.
        idonly_ev = work / "identifier-only-evidence"
        idonly_ev.mkdir()
        (idonly_ev / "claim.json").write_text(
            json.dumps({"recordId": upstream["recordId"]}, indent=2) + "\n", encoding="utf-8")
        arm("UNGROUNDED: a source document that is only a claimed identifier",
            decide(candidate(source=link_to_upstream), idonly_ev)[0] == UNGROUNDED)

        # CONTESTED. A valid record and a re-identified copy of it both claim one identifier. The
        # first version of this fix let the sorted-first win, which still meant the caller decided
        # the outcome by which bytes they laid down — so a contested identity now satisfies nothing.
        #
        # THE TAMPERED COPY IS NAMED TO SORT FIRST. An earlier version of this arm put the VALID
        # file first and passed whether or not the contested-set was honoured, because "first
        # claimant" and "no claimant" both resolved to the valid record. An arm that cannot fail
        # proves nothing, and MEASURED: neutralizing the contested-set left that version GREEN. This
        # ordering makes the two behaviours differ — sorted-first would hand the citation to the
        # tampered bytes, the contested-set refuses it — so the arm now discriminates.
        contested_ev = work / "contested-evidence"
        contested_ev.mkdir()
        (contested_ev / "aaa-tampered.json").write_text(json.dumps(tampered, indent=2) + "\n",
                                                        encoding="utf-8")
        (contested_ev / "zzz-valid.json").write_text(json.dumps(upstream, indent=2) + "\n",
                                                     encoding="utf-8")
        arm("UNGROUNDED: an identity claimed by more than one document",
            decide(candidate(source=link_to_upstream), contested_ev)[0] == UNGROUNDED)
        # ...and the SAME conflict must not be resolvable by reordering the directory: with the
        # valid file sorted first, a contested identity must STILL satisfy nothing.
        reordered = work / "contested-reordered"
        _shutil.copytree(contested_ev, reordered)
        _shutil.move(str(reordered / "aaa-tampered.json"), str(reordered / "zzz-tampered.json"))
        _shutil.move(str(reordered / "zzz-valid.json"), str(reordered / "aaa-valid.json"))
        arm("UNGROUNDED: the contested verdict does not depend on directory order",
            decide(candidate(source=link_to_upstream), reordered)[0] == UNGROUNDED)

        arm("UNDETERMINED: an evidence set that cannot ground anything",
            decide(candidate(source=link_to_upstream), empty_ev)[0]
            == UNDETERMINED)
        arm("an erasure that targets nothing is UNGROUNDED",
            decide(candidate(kind="erasure", content={"targets": []}), ev)[0] == UNGROUNDED)
        arm("a training-slice with no outputDigest is UNGROUNDED",
            decide(candidate(kind="training-slice", content={}), ev)[0] == UNGROUNDED)
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)

    return arms


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Decide whether a Kira record's provenance resolves. One question, three "
                    "verdicts, verdict in the text and never in the status.")
    parser.add_argument("--candidate", type=Path, help="the record presented for adoption")
    parser.add_argument("--evidence", type=Path,
                        help="directory of artifacts the candidate's sources may resolve to")
    parser.add_argument("--selftest", action="store_true",
                        help="prove the identifier replica matches the producer, and the refusals")
    parser.add_argument("--require", choices=[GROUNDED, UNGROUNDED, UNDETERMINED],
                        help="OPTIONAL convenience: exit 1 unless this exact verdict was reached. "
                             "Without it every verdict exits 0, per the court contract.")
    args = parser.parse_args()

    if args.selftest:
        print("experience-court — selftest")
        try:
            arms = selftest()
        except CourtError as exc:
            print(f"  EXPERIENCE COURT SELFTEST: RED\n  {exc}", file=sys.stderr)
            return 2
        print("")
        print(f"  {arms}/{arms} arms: the identifier replica matches the producer, and the "
              f"refusals refuse")
        print("")
        print("  EXPERIENCE COURT SELFTEST: GREEN")
        return 0

    if not args.candidate or not args.evidence:
        parser.error("--candidate and --evidence are both required (or pass --selftest)")

    candidate = None
    try:
        raw = load_json(args.candidate)
        candidate = check_candidate_shape(raw)
    except CourtError as exc:
        # An input the court cannot read or parse is a REFUSAL, not a verdict. The court did
        # not reach an answer; it never got to ask the question. Reporting UNDETERMINED here
        # would hide a typo, a wrong path or a truncated file behind the same word as an
        # honest "this pair does not answer the question".
        fail(str(exc))

    if not args.evidence.is_dir():
        # An evidence path that is not a directory is likewise a refusal: the caller named
        # something the court cannot read, which is a caller error, not a finding about the
        # candidate.
        fail(f"evidence is not a directory: {args.evidence}")

    verdict, problems, reason = decide(candidate, args.evidence)
    if verdict == UNDETERMINED:
        print("")
        print(f"REASON : {reason}")
        print(f"VERDICT: {UNDETERMINED}")
        return _finish(UNDETERMINED, args.require)
    render(verdict, reason, candidate, problems)
    return _finish(verdict, args.require)


def _finish(verdict: str, required: "str | None") -> int:
    """The convention is that the verdict is in the text; this is the opt-in exception."""
    if required is not None and verdict != required:
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CourtError as exc:
        fail(str(exc))
