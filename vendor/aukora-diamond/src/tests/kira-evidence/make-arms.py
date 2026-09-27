#!/usr/bin/env python3
"""Build the negative-control arms for the Kira evidence consumer, from the committed bundle.

    python3 tests/kira-evidence/make-arms.py <out-dir>

Every arm is DERIVED from the committed evidence at run time rather than committed as a second
copy of the bytes: a fixture bundle plus a generator is one artifact to keep honest, and a
checked-in tampered copy is a second one to drift. The generator is offline and deterministic,
and it mints nothing: the arms that must carry a real signature re-sign with the published test
seed that derives the anchor committed in the bundle, which proves a signature was made and
never that a person was present.

Arms produced (name -> what the consumer must say):

    honest-record.json            the committed record, unchanged              -> verified
    tampered-record.json          one content byte changed, recordId kept      -> record-identity-mismatch
    tampered-receipt.json         one signed field moved after signing         -> signature-invalid
    unknown-kind.json             receipt kind the consumer does not know      -> receipt-kind
    unknown-record-domain.json    record domain the consumer does not know    -> record-domain-mismatch
    alg-field.json                a document advertising its own algorithm     -> receipt-forbidden-field
    head-claiming.json            re-signed, claims entry 2's hash at seq 1    -> position-mismatch
    prior-rewritten.json          re-signed, states the wrong prior head       -> position-prior-head-mismatch
    longer-log.jsonl              log extended with a third chained entry      -> (no refusal)
    truncated-log.jsonl           log cut mid-entry                            -> log-truncated
    log-entry-tampered.jsonl      one chained byte changed inside the log       -> chain-tampered
    log-respelled.jsonl           valid JSON that is not the hashed bytes       -> log-not-roundtrip
    object-store/                 a store whose object bytes were changed      -> object-tampered
"""
from __future__ import annotations

import binascii
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(REPO))

from diamond import ed25519, kira_evidence as ke  # noqa: E402

EVIDENCE = HERE / "evidence"


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def log_line(entry: dict) -> str:
    """Serialise one Aura entry exactly as the producer does, so the roundtrip check holds."""
    return json.dumps(entry, ensure_ascii=False, separators=(",", ":"))


def main(argv) -> int:
    out = Path(argv[1] if len(argv) > 1 else HERE / "arms").resolve()
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    record = json.loads((EVIDENCE / "fixture" / "record.json").read_text(encoding="utf-8"))
    receipt1 = json.loads((EVIDENCE / "receipt-1.json").read_text(encoding="utf-8"))
    receipt2 = json.loads((EVIDENCE / "receipt-2.json").read_text(encoding="utf-8"))
    keyinfo = json.loads((EVIDENCE / "issuer-test-key.json").read_text(encoding="utf-8"))
    seed = bytes.fromhex(keyinfo["seedHex"])
    entries = ke.read_log(EVIDENCE / "aura.jsonl")

    # The published seed must derive the anchor this bundle names, or every re-signed arm below
    # would be signing with a key the consumer does not trust and would "pass" for the wrong
    # reason. Measured here rather than assumed.
    derived = ed25519.public_from_seed(seed).hex()
    if derived != keyinfo["publicKeyRawHex"]:
        raise SystemExit(f"FATAL: the published seed derives {derived}, and the bundle names "
                         f"{keyinfo['publicKeyRawHex']}")

    def sign(receipt: dict) -> dict:
        """Sign a receipt body under the published test seed, exactly as the producer does."""
        body = {name: receipt[name] for name in ke.KIRA_RECEIPT_REQUIRED
                if name not in ("sig", "issuerPk")}
        message = receipt["kind"].encode("utf-8") + b"\n" + ke.jcs_bytes(body)
        receipt["sig"] = ed25519.sign(seed, message).hex()
        receipt["issuerPk"] = keyinfo["publicKeyPem"]
        return receipt

    write_json(out / "honest-record.json", record)

    tampered = json.loads(json.dumps(record))
    tampered["content"]["note"] = tampered["content"]["note"].replace("0001", "0002")
    write_json(out / "tampered-record.json", tampered)

    bad_receipt = json.loads(json.dumps(receipt1))
    bad_receipt["issuedAt"] = bad_receipt["issuedAt"] + 1
    write_json(out / "tampered-receipt.json", bad_receipt)

    unknown_kind = json.loads(json.dumps(receipt1))
    unknown_kind["kind"] = "aukora-kira-memory-receipt/v2"
    write_json(out / "unknown-kind.json", unknown_kind)

    unknown_domain = json.loads(json.dumps(record))
    unknown_domain["domain"] = "aukora:kira-memory-record:v1"
    write_json(out / "unknown-record-domain.json", unknown_domain)

    alg_field = json.loads(json.dumps(receipt1))
    alg_field["alg"] = "Ed25519"
    write_json(out / "alg-field.json", alg_field)

    # POSITION ARM 1 — a REAL signature claiming a LATER entry's hash at the EARLIER position.
    # Nothing about this document is malformed and its signature is valid; it is refused
    # because the position it names does not carry the entry it claims.
    head_claiming = json.loads(json.dumps(receipt1))
    head_claiming["aura"]["entryHash"] = receipt2["aura"]["entryHash"]
    head_claiming["aura"]["head"] = receipt2["aura"]["entryHash"]
    write_json(out / "head-claiming.json", sign(head_claiming))

    # POSITION ARM 2 — a REAL signature over a rewritten predecessor link.
    prior_rewritten = json.loads(json.dumps(receipt1))
    prior_rewritten["aura"]["priorHead"] = "a" * 64
    write_json(out / "prior-rewritten.json", sign(prior_rewritten))

    # A LONGER LOG — a third validly chained entry, built with the consumer's own restated
    # rule. The point of this arm is that receipt #1 must STILL verify against it: a longer log
    # is an extension of an earlier claim, not a contradiction of it.
    third = {
        "verdict": "settled",
        "key": record["recordId"],
        "contentSha256": ke.record_content_digest(record),
        "operation": "memory.put",
        "sequence": 3,
        "prev": entries[-1]["hash"],
    }
    fields = {name: third[name] for name in ke.AURA_ENTRY_FIELDS}
    third["hash"] = ke.aura_entry_hash(third["prev"], fields, sequence=3)
    (out / "longer-log.jsonl").write_text(
        (EVIDENCE / "aura.jsonl").read_text(encoding="utf-8") + log_line(third) + "\n",
        encoding="utf-8")

    # A TRUNCATED LOG — cut mid-entry, which must refuse rather than read as a shorter history.
    text = (EVIDENCE / "aura.jsonl").read_text(encoding="utf-8")
    (out / "truncated-log.jsonl").write_text(text[: len(text) - 20], encoding="utf-8")

    # A ONE-ENTRY LOG — a genuine prefix, so a receipt naming position 2 has no entry to name.
    (out / "truncated-one-entry.jsonl").write_text(
        text.splitlines(keepends=True)[0], encoding="utf-8")

    # THE SAME ANCHOR IN ITS OTHER SPELLING — the SPKI PEM the producer itself writes.
    # Refusing to read one of the two spellings would make the verdict depend on a file format.
    (out / "declared-issuer.pem").write_text(keyinfo["publicKeyPem"], encoding="utf-8")

    # A LOG TAMPERED INSIDE THE CHAIN — entry 1's recorded digest rewritten and the line
    # RE-SERIALISED, so the file still round-trips and the refusal can only come from the hash
    # not matching the entry's own bytes.
    lines = text.splitlines()
    entry_one = json.loads(lines[0])
    entry_one["contentSha256"] = "b" * 64
    lines[0] = log_line(entry_one)
    (out / "log-entry-tampered.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # A LOG REWRITTEN IN A DIFFERENT SPELLING — valid JSON, not the bytes that were hashed.
    # This is the decoy-reader arm: an entry that parses to the right object while the line on
    # disk is not what the hash covers.
    respelled = json.dumps(json.loads(lines[0]), ensure_ascii=False)
    (out / "log-respelled.jsonl").write_text(
        "\n".join([respelled, *lines[1:]]) + "\n", encoding="utf-8")

    # A STORE WHOSE OBJECT BYTES CHANGED — existence is not evidence.
    store = out / "object-store"
    (store / "objects").mkdir(parents=True)
    object_name = next((EVIDENCE / "objects").iterdir()).name
    (store / "objects" / object_name).write_text('{"key":"x","value":{}}\n', encoding="utf-8")

    # A WRAPPER THAT FORGES APPROVAL IN UNSIGNED DATA — every field a wrapper could assert to
    # claim owner approval, with no signature anywhere. The consumer must still report
    # OWNER_APPROVAL_UNCHECKED: a label is not a ceremony, and neither is a boolean.
    forged = json.loads((EVIDENCE / "fixture" / "operation.json").read_text(encoding="utf-8"))
    forged["authority"] = {
        "grants": True,
        "fixtureOnly": False,
        "note": "FORGED: this envelope claims authority it cannot show.",
    }
    forged["fixtureOnly"] = False
    forged["confirm"] = True
    forged["approvedBy"] = "owner"
    forged["operation"]["subjectControlDigest"] = "f" * 64
    write_json(out / "forged-approval-wrapper.json", forged)

    # A SECOND ISSUER — a well-formed, DIFFERENT public key, used as the wrong anchor.
    write_json(out / "second-issuer.json", {
        "note": "a well-formed public key that is not the issuer of this evidence",
        "publicKeyRawHex": "7f" * 32,
    })

    print(f"arms written to {out}")
    for path in sorted(out.rglob("*")):
        if path.is_file():
            print(f"  {path.relative_to(out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
