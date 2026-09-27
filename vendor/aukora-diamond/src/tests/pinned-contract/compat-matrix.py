#!/usr/bin/env python3
"""Producer/consumer compatibility matrix: the pinned Genesis contract vs this revision.

    python3 tests/pinned-contract/compat-matrix.py

WHAT THIS MEASURES. Two revisions of the same receipt seam are compared, in two roles:

  * PRODUCER — can the revision's own `receipt.issue()` MINT a document, and does it DECLARE
    the composition base it composed under?
  * CONSUMER — does the revision's `receipt.verify_receipt()` ACCEPT or REFUSE the document
    that was minted, and WHICH BASE does it say it checked?

for every (kind x composition field set x declaration) combination that matters. Two things
are varied and nothing else: the composition field set (v1's five fields, or v2's seven) and
the `compositionBase` declaration (absent, or one of the closed names). The `aura` closed set
is a property of the kind and is identical in both revisions, so it is held at the kind's own
shape throughout.

THE ROW THAT NOW PASSES ON BOTH SIDES is the legacy one: a five-field block with no
declaration, which is what Genesis's gate emits and what the committed fixture is. The pinned
revision accepts it under its only field set; this revision accepts it as the NAMED base v1.
Before this revision named its bases, that same row read `REFUSE composition closed fields` on
this side — a refusal decided by counting fields.

Documents under test are minted, not hand-written, wherever a revision can mint them: the
five-field undeclared ones come from the pinned seam, and the declaring ones from this
revision. A shape neither revision will mint (a contradiction, or the undeclared seven-field
block this revision used to produce) is re-signed directly — the signature is computed over
the six required fields plus the declaration when present, which is what this revision covers.
Both committed historical vectors are run byte-identical, and there is a negative control.

Each backend runs in its own process with its own PYTHONPATH and a neutral cwd: both are a
package named `diamond`, and loading them in one interpreter would compare a revision against
itself.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
PINNED_PATH = HERE / "pinned"

#: Fixed, public, worthless. Same constant as test-pinned-contract.py: it exists so the
#: bytes carry a real Ed25519 signature and no secret is stored anywhere.
THROWAWAY_SEED = bytes.fromhex("5a" * 32)

PROBE_HOME = Path(tempfile.mkdtemp(prefix="compat-matrix-probe-"))
ISSUE_PROBE = PROBE_HOME / "issue_one.py"
VERIFY_PROBE = PROBE_HOME / "verify_one.py"
RESIGN_PROBE = PROBE_HOME / "resign_one.py"

ISSUE_PROBE.write_text(r"""
import json, sys
from diamond.ed25519 import public_from_seed
from diamond.receipt import ReceiptError, issue
body = json.loads(sys.stdin.read())
seed = bytes.fromhex("5a" * 32)
try:
    doc = issue(seed=seed, issuer_pk=public_from_seed(seed), kind=body["kind"],
                issued_at=body["issuedAt"], nonce=body["nonce"], aura=body["aura"],
                composition=body["composition"])
except ReceiptError as exc:
    print("REFUSE\t" + str(exc)); sys.exit(0)
except Exception as exc:
    print("ERROR\t" + type(exc).__name__ + ": " + str(exc)); sys.exit(0)
print("EMITS\t" + str(len(doc["composition"])) + "\t" + doc.get("compositionBase", "-"))
open(sys.argv[1], "w").write(json.dumps(doc, indent=2, sort_keys=True) + "\n")
""".lstrip())

#: `composition_base_for` is what lets a consumer SAY which base it checked. The pinned
#: revision has no such vocabulary, and that absence is itself a measured fact: it is why a
#: document that declares a base cannot be accepted there.
VERIFY_PROBE.write_text(r"""
import json, sys
from pathlib import Path
from diamond.receipt import ReceiptError, verify_receipt
try:
    from diamond.receipt import composition_base_for
except ImportError:
    composition_base_for = None
receipt = json.loads(Path(sys.argv[1]).read_text())
pub = Path(sys.argv[2]).read_text().strip()
try:
    approval, conformance = verify_receipt(receipt, expect_pk=pub)
except ReceiptError as exc:
    print("REFUSE\t" + str(exc)); sys.exit(0)
except Exception as exc:
    print("ERROR\t" + type(exc).__name__ + ": " + str(exc)); sys.exit(0)
base = composition_base_for(receipt) if composition_base_for else "-"
print("ACCEPT\t" + approval + "\t" + conformance + "\t" + base)
""".lstrip())

#: Signs WITHOUT validating, over the six required fields plus the declaration when present.
#: The bytes are built here rather than with the module's `to_sign_bytes`, because the same
#: probe runs under both PYTHONPATHs and must sign the way THIS revision signs.
RESIGN_PROBE.write_text(r"""
import json, sys
from pathlib import Path
from diamond.ed25519 import public_from_seed, sign
from diamond.hexutil import to_hex
from diamond.jcs import canonicalize_bytes
doc = json.loads(Path(sys.argv[1]).read_text())
seed = bytes.fromhex("5a" * 32)
required = ("aura", "composition", "issuedAt", "issuerPk", "kind", "nonce")
signed = {k: doc[k] for k in required if k in doc}
signed["issuerPk"] = to_hex(public_from_seed(seed))
if "compositionBase" in doc:
    signed["compositionBase"] = doc["compositionBase"]
out = {**signed, **{k: v for k, v in doc.items() if k not in set(signed) | {"sig"}}}
out["sig"] = to_hex(sign(seed, (doc["kind"] + "\n").encode("ascii") + canonicalize_bytes(signed)))
Path(sys.argv[2]).write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
""".lstrip())

PK_PROBE = PROBE_HOME / "pk.py"
PK_PROBE.write_text(
    "from diamond.ed25519 import public_from_seed\n"
    "from diamond.hexutil import to_hex\n"
    'print(to_hex(public_from_seed(bytes.fromhex("5a" * 32))))\n'
)

KIND_LIVE = "aukora-receipt/v3-toy"
KIND_FIXTURE = "aukora-receipt/v3-toy-fixture"
KIND_GENESIS = "aukora-receipt/v3-genesis"
KIND_GENESIS_FIXTURE = "aukora-receipt/v3-genesis-fixture"
GENESIS_KINDS = (KIND_GENESIS, KIND_GENESIS_FIXTURE)
KINDS = (KIND_LIVE, KIND_FIXTURE, KIND_GENESIS, KIND_GENESIS_FIXTURE)

ZERO = "00" * 32
FIVE_FIELD = {
    "coeffectEnvelopeDigest": "44" * 32,
    "operation": "load",
    "pluginDigest": "55" * 32,
    "pluginId": "hello-plugin",
    "revertOf": "",
}
SEVEN_FIELD = dict(FIVE_FIELD, compositionDigest="66" * 32, subjectDigest="77" * 32)
#: Partial upgrades: one of the two added fields. Neither revision can mint these.
PARTIAL = (
    ("6-field (compositionDigest only)", dict(FIVE_FIELD, compositionDigest="66" * 32)),
    ("6-field (subjectDigest only)", dict(FIVE_FIELD, subjectDigest="77" * 32)),
)

PINNED_LABEL = "pinned `c512d0c`"

#: The kind the Experience Court sealed, and the two shapes its producer emits. These rows are
#: not about two revisions of one contract: they are what a verifier of AUTHORITY does when a
#: document of that kind — advisory, unsigned, `grantsAuthority: false` — is handed to it.
EXPERIENCE_KIND = "aukora-experience/v1"
EXPERIENCE_COURT = "`0e970d9c…`"
EXPERIENCE_DOCS = (
    ("record: advisory, unsigned, no receipt fields", "experience-record.json",
     f"Experience Court's own `ExperienceStore.put()` at {EXPERIENCE_COURT}; bytes vendored, "
     f"digest pinned"),
    ("recall reply: advisory, unsigned, cites records", "experience-recall.json",
     f"Experience Court's own `ExperienceStore.recall()` at {EXPERIENCE_COURT}; bytes vendored, "
     f"digest pinned"),
)

#: Courts that will get a row of the same shape here, and have not sealed a kind yet. This table
#: carries measured rows only. A row of guesses about a court whose rules are not fixed would be
#: indistinguishable from a measured one at a glance, so a waiting court is named in words
#: instead — and the Experience Court sat here until it sealed, at which point it became rows.
WAITING_COURTS: tuple = ()


def current_label() -> str:
    """The revision under test, READ rather than remembered. `--dirty` says a working tree
    that is not the clean commit, so a row can never borrow a name it did not run under."""
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO), "describe", "--always", "--dirty"],
            capture_output=True, text=True,
        )
        if out.returncode == 0 and out.stdout.strip():
            return f"current `{out.stdout.strip()}`"
    except OSError:
        pass
    return "current (unknown)"


CURRENT_LABEL = current_label()


def aura_for(kind: str) -> dict:
    """The kind's own closed aura set: six fields, plus priorHead for the genesis kinds."""
    entry = "11" * 32
    aura = {
        "entryHash": entry, "head": entry, "prevHash": ZERO,
        "root": "22" * 32, "seq": 1, "size": 1,
    }
    if kind in GENESIS_KINDS:
        aura["priorHead"] = ZERO
    return aura


def body_for(kind: str, composition: dict, declared: str | None = None) -> dict:
    doc = {
        "kind": kind, "issuedAt": 1_700_000_000, "nonce": "33" * 32,
        "aura": aura_for(kind), "composition": composition,
    }
    if declared is not None:
        doc["compositionBase"] = declared
    return doc


def run(probe: Path, backend: str, args: list[str], stdin: str = "") -> list[str]:
    env = dict(os.environ)
    env["PYTHONPATH"] = backend
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    proc = subprocess.run(
        [sys.executable, "-B", str(probe), *args],
        capture_output=True, text=True, cwd=str(PROBE_HOME), env=env, input=stdin,
    )
    if proc.returncode != 0:
        return ["ERROR", (proc.stderr or "").strip()[-200:]]
    lines = (proc.stdout or "").strip().splitlines()
    return lines[-1].split("\t") if lines else ["ERROR", "no output"]


def mint(backend: str, kind: str, composition: dict, out: Path) -> tuple[str, str, str]:
    """Returns (status, detail, declared)."""
    parts = run(ISSUE_PROBE, backend, [str(out)], json.dumps(body_for(kind, composition)))
    parts += [""] * (3 - len(parts))
    return parts[0], parts[1], parts[2]


def resign(backend: str, document: Path) -> None:
    run(RESIGN_PROBE, backend, [str(document), str(document)])


def consume(backend: str, receipt: Path, pub: Path) -> tuple[str, str, str]:
    parts = run(VERIFY_PROBE, backend, [str(receipt), str(pub)])
    parts += [""] * (4 - len(parts))
    if parts[0] == "ACCEPT":
        return "ACCEPT", f"{parts[1]}/{parts[2]}", parts[3]
    return parts[0], parts[1], parts[3]


def producer_cell(status: str, detail: str, declared: str) -> str:
    if status == "-":
        return "—"
    if status == "EMITS":
        says = f"declares {declared}" if declared and declared != "-" else "undeclared"
        return f"mints ({detail} fields, {says})"
    if status == "REFUSE":
        return f"**refuses** ({detail})"
    return f"ERROR {detail[:40]}"


def consumer_cell(status: str, detail: str, base: str) -> str:
    if status == "-":
        return "—"
    if status == "ACCEPT":
        if base and base != "-":
            return f"accepts as `{base}` — `{detail}`"
        # No base vocabulary at all, which is a fact about the frozen side, not a gap here.
        return f"accepts `{detail}` (no base vocabulary: v1 is all it has)"
    if status == "REFUSE":
        return f"**refuses** ({detail})"
    return f"ERROR {detail[:40]}"


#: For rows whose producers are not the thing under test (the committed vectors, and the
#: mutated control).
DASH = ("-", "", "")


def verify_pins() -> tuple[str, dict[str, str]]:
    """The pinned bytes must be the pinned bytes before anything is compared.

    Every section of `pins.json` that names files is verified, the external court's included:
    those rows compare committed bytes, so a moved byte has to refuse here rather than quietly
    change what a row is about.
    """
    pins = json.loads((HERE / "pins.json").read_text())
    digests: dict[str, str] = {}
    for section in ("pinnedContract", "fixture", "experienceFixture"):
        for entry in pins.get(section, {}).get("files", []):
            path = HERE / entry["path"]
            got = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else "missing"
            if got != entry["sha256"]:
                raise SystemExit(f"PIN DRIFT: {entry['path']} {got} != {entry['sha256']}")
            digests[entry["path"]] = got
    return digests["pinned/diamond/receipt.py"], digests


def main() -> int:
    pinned_receipt_sha, pin_digests = verify_pins()
    out_dir = Path(tempfile.mkdtemp(prefix="compat-matrix-docs-"))
    throwaway_pk = out_dir / "throwaway.pk"
    throwaway_pk.write_text(run(PK_PROBE, str(PINNED_PATH), [])[0] + "\n")

    rows: list[dict] = []
    table_digest = hashlib.sha256()

    def add(kind: str, shape: str, provenance: str, doc: Path,
            pin_p: tuple, cur_p: tuple) -> None:
        pin_c = consume(str(PINNED_PATH), doc, throwaway_pk)
        cur_c = consume(str(REPO), doc, throwaway_pk)
        rows.append({
            "kind": kind, "shape": shape, "provenance": provenance,
            "pin_producer": producer_cell(*pin_p),
            "cur_producer": producer_cell(*cur_p),
            "pin_consumer": consumer_cell(*pin_c),
            "cur_consumer": consumer_cell(*cur_c),
        })
        table_digest.update(
            f"{kind}|{shape}|{pin_p[0]}:{pin_p[1]}:{pin_p[2]}|{cur_p[0]}:{cur_p[1]}:{cur_p[2]}"
            f"|{pin_c[0]}:{pin_c[1]}:{pin_c[2]}|{cur_c[0]}:{cur_c[1]}:{cur_c[2]}\n".encode()
        )

    def producers(kind: str, composition: dict) -> tuple[tuple, tuple]:
        """What each revision can MINT for this (kind, composition), and what it declares."""
        return (
            mint(str(PINNED_PATH), kind, composition, out_dir / "discard.json"),
            mint(str(REPO), kind, composition, out_dir / "discard.json"),
        )

    # --- per kind: the legacy five-field block, and the declaring seven-field one -------
    for kind in KINDS:
        legacy = out_dir / f"{kind.replace('/', '_')}-5field-undeclared.json"
        pin_p = mint(str(PINNED_PATH), kind, FIVE_FIELD, legacy)
        cur_p = mint(str(REPO), kind, FIVE_FIELD, out_dir / f"{kind.replace('/', '_')}-5decl.json")
        provenance = (f"minted by {PINNED_LABEL}: no declaration, the shape Genesis emits "
                      f"and the committed fixture is")
        add(kind, "5-field, undeclared", provenance, legacy, pin_p, cur_p)

        seven = out_dir / f"{kind.replace('/', '_')}-7field-v2.json"
        pin_p7 = mint(str(PINNED_PATH), kind, SEVEN_FIELD, seven)
        cur_p7 = mint(str(REPO), kind, SEVEN_FIELD, seven)
        add(kind, "7-field, declares v2",
            f"minted by {CURRENT_LABEL}: `issue()` stamps the base it composed under",
            seven, pin_p7, cur_p7)

    # --- declaration-specific rows, measured on one kind (a base is kind-independent) ---
    g = KIND_GENESIS

    declared_v1 = out_dir / "genesis-5field-declares-v1.json"
    pin_p5, cur_p5 = producers(g, FIVE_FIELD)
    mint(str(REPO), g, FIVE_FIELD, declared_v1)
    add(g, "5-field, declares v1",
        f"minted by {CURRENT_LABEL}: the same block as the legacy row, with the base stated",
        declared_v1, pin_p5, cur_p5)

    pin_p7, cur_p7 = producers(g, SEVEN_FIELD)
    legacy_seven = out_dir / "genesis-7field-undeclared.json"
    legacy_seven.write_text(json.dumps(body_for(g, SEVEN_FIELD), indent=2, sort_keys=True) + "\n")
    resign(str(PINNED_PATH), legacy_seven)
    add(g, "7-field, undeclared (legacy)",
        "re-signed: the shape this revision minted before it declared bases — nothing this "
        "revision accepted before became refused",
        legacy_seven, pin_p7, cur_p7)

    unknown = out_dir / "genesis-5field-declares-v9.json"
    unknown.write_text(json.dumps(body_for(g, FIVE_FIELD, "v9"), indent=2, sort_keys=True) + "\n")
    resign(str(PINNED_PATH), unknown)
    add(g, "5-field, declares v9 (unknown)",
        "re-signed: a name outside the closed vocabulary, on an otherwise valid document",
        unknown, pin_p5, cur_p5)

    for shape, composition, declared, gloss in (
        ("7-field, declares v1 (contradiction)", SEVEN_FIELD, "v1",
         "the block is v2's set under a v1 declaration"),
        ("5-field, declares v2 (contradiction)", FIVE_FIELD, "v2",
         "the block is v1's set under a v2 declaration"),
    ):
        doc = out_dir / f"contradiction-{len(composition)}-{declared}.json"
        doc.write_text(json.dumps(body_for(g, composition, declared), indent=2,
                                  sort_keys=True) + "\n")
        resign(str(PINNED_PATH), doc)
        p_pin, p_cur = producers(g, composition)
        add(g, shape, f"re-signed: {gloss}; neither revision will mint it", doc, p_pin, p_cur)

    # --- precision: a seven-field block that is v1 plus the optional patent pair --------
    patent_pair = dict(FIVE_FIELD, patentDocketId="AUKORA-PROVISIONAL-B",
                       patentLicenseNonce="88" * 32)
    doc = out_dir / "genesis-patent-pair.json"
    pin_pp = mint(str(PINNED_PATH), g, patent_pair, doc)
    cur_pp = mint(str(REPO), g, patent_pair, out_dir / "discard.json")
    add(g, "7-field (5 base + patent pair), undeclared",
        f"minted by {PINNED_LABEL}: seven fields, and still base v1 — the patent pair is "
        f"optional in BOTH bases, so the count was never the rule",
        doc, pin_pp, cur_pp)

    # --- the committed historical vectors, byte-identical, real signatures -------------
    for kind, shape, receipt, pub, provenance in (
        (KIND_GENESIS, "5-field, undeclared",
         HERE / "fixtures" / "genesis-receipt.json",
         HERE / "fixtures" / "genesis-issuer.pk",
         "Genesis gate, committed (not regenerable here: no issuer secret exists)"),
        (KIND_GENESIS_FIXTURE, "7-field, declares v2",
         HERE / "fixtures" / "diamond-genesis-fixture.json",
         HERE / "fixtures" / "diamond-fixture-issuer.pk",
         "this repository's issuer, committed (regenerate: make-fixture.py)"),
    ):
        pin_c = consume(str(PINNED_PATH), receipt, pub)
        cur_c = consume(str(REPO), receipt, pub)
        rows.append({
            "kind": kind, "shape": shape, "provenance": provenance,
            "pin_producer": "—", "cur_producer": "—",
            "pin_consumer": consumer_cell(*pin_c),
            "cur_consumer": consumer_cell(*cur_c),
        })
        table_digest.update(
            f"{kind}|{shape}|vector|{pin_c[0]}:{pin_c[1]}:{pin_c[2]}"
            f"|{cur_c[0]}:{cur_c[1]}:{cur_c[2]}\n".encode()
        )

    # --- the kind an external court sealed, in the shapes ITS producer emits ------------
    for label, filename, provenance in EXPERIENCE_DOCS:
        receipt = HERE / "fixtures" / filename
        pin_c = consume(str(PINNED_PATH), receipt, throwaway_pk)
        cur_c = consume(str(REPO), receipt, throwaway_pk)
        rows.append({
            "kind": EXPERIENCE_KIND, "shape": label, "provenance": provenance,
            "pin_producer": "—", "cur_producer": "—",
            "pin_consumer": consumer_cell(*pin_c), "cur_consumer": consumer_cell(*cur_c),
        })
        table_digest.update(
            f"{EXPERIENCE_KIND}|{label}|external|{pin_c[0]}:{pin_c[1]}:{pin_c[2]}"
            f"|{cur_c[0]}:{cur_c[1]}:{cur_c[2]}\n".encode()
        )

    # --- negative control: signed, then mutated after signing --------------------------
    control = out_dir / "control.json"
    base = json.loads((HERE / "fixtures" / "genesis-receipt.json").read_text())
    control.write_text(json.dumps(
        {**base, "composition": dict(SEVEN_FIELD, pluginId=base["composition"]["pluginId"])},
        indent=2, sort_keys=True) + "\n")
    resign(str(REPO), control)
    mutated = json.loads(control.read_text())
    mutated["composition"]["pluginDigest"] = "ab" * 32
    control.write_text(json.dumps(mutated, indent=2, sort_keys=True) + "\n")
    pin_c = consume(str(PINNED_PATH), control, throwaway_pk)
    cur_c = consume(str(REPO), control, throwaway_pk)
    add(g, "7-field, undeclared (tampered)",
        "negative control: mutated after signing", control, DASH, DASH)

    print(f"| kind | composition, declaration | document provenance | producer: {PINNED_LABEL} "
          f"| producer: {CURRENT_LABEL} | consumer: {PINNED_LABEL} "
          f"| consumer: {CURRENT_LABEL} |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    for row in rows:
        print(f"| `{row['kind']}` | {row['shape']} | {row['provenance']} "
              f"| {row['pin_producer']} | {row['cur_producer']} "
              f"| {row['pin_consumer']} | {row['cur_consumer']} |")

    # --- boundary: partial upgrades, no revision can mint them -------------------------
    counts = {"pin_p": 0, "cur_p": 0, "pin_c": 0, "cur_c": 0}
    total = 0
    for kind in KINDS:
        for label, composition in PARTIAL:
            total += 1
            doc = out_dir / f"{kind.replace('/', '_')}-{label.split()[0]}-{len(composition)}.json"
            doc.write_text(json.dumps(body_for(kind, composition), indent=2, sort_keys=True) + "\n")
            resign(str(PINNED_PATH), doc)
            if mint(str(PINNED_PATH), kind, composition, out_dir / "discard.json")[0] == "REFUSE":
                counts["pin_p"] += 1
            if mint(str(REPO), kind, composition, out_dir / "discard.json")[0] == "REFUSE":
                counts["cur_p"] += 1
            if consume(str(PINNED_PATH), doc, throwaway_pk)[0] == "REFUSE":
                counts["pin_c"] += 1
            if consume(str(REPO), doc, throwaway_pk)[0] == "REFUSE":
                counts["cur_c"] += 1

    print("\n— boundary: adopting only one of the two added fields —")
    print(f"  {total} re-signed documents over {len(KINDS)} kinds x {len(PARTIAL)} partial shapes")
    print(f"    producer {PINNED_LABEL:<18}: refuses {counts['pin_p']}/{total}")
    print(f"    producer {CURRENT_LABEL:<18}: refuses {counts['cur_p']}/{total}")
    print(f"    consumer {PINNED_LABEL:<18}: refuses {counts['pin_c']}/{total}")
    print(f"    consumer {CURRENT_LABEL:<18}: refuses {counts['cur_c']}/{total}")

    print("\n— courts with no row here yet —")
    if not WAITING_COURTS:
        print("  (none: the Experience Court sealed a kind and is measured above)")
    for entry in WAITING_COURTS:
        print(f"  {entry['court']} ({entry['repo']})")
        print(f"    state : {entry['state']}")
        print(f"    row   : {entry['row']}")
    print(
        "\n  A row appears above only when it has been MEASURED. A guessed row would be\n"
        "  indistinguishable from a measured one at a glance, which is the one thing this\n"
        "  artifact cannot afford, so a court waiting on a seal is named here instead."
    )
    print()
    print(f"TABLE_SHA256: {table_digest.hexdigest()}")
    print(f"pinned receipt.py exercised: {pinned_receipt_sha}")
    for name in ("fixtures/experience-record.json", "fixtures/experience-recall.json"):
        print(f"external fixture {name}: {pin_digests[name][:16]}…")
    print(f"throwaway issuer (public): {run(PK_PROBE, str(PINNED_PATH), [])[0][:16]}…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
