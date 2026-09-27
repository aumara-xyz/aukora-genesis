"""Consume the REAL Aumlok approval artifact: the flat `aukora:approval-receipt:v1` record.

WHAT THIS CONSUMES, AND WHY THE FLAT ARTIFACT AND NOTHING ELSE. An owner approval on the reconciled
wire is ONE document — the record `scripts/aumlok/approve-operation --artifact-out` writes, parsed by
`plugins/aukora-aumlok/lib/approval-receipt.mjs::parseApprovalReceipt`. The request/response wrapper
this repository verified before is NOT that artifact: a wrapper proves the pair was signed, and says
nothing about the record a Kira settlement actually consumes. `aura_association`-style enthusiasm does
not apply here — either the flat record parses and its own fields re-derive its signing bytes, or the
document is refused by name.

THE RULES, EACH RESTATED HERE RATHER THAN IMPORTED FROM THE PRODUCER, BECAUSE AGREEMENT IS NOT
VERIFICATION. A verifier that calls the producer's own helpers agrees with the producer by
construction; the two lanes of this project were each green alone and disagreed where they met, which
is the defect this module exists on the far side of.

    request          = {domain, subject, activeControlDigest, operationDigest, challenge,
                        issuedAt, expiresAt}   — CLOSED, exactly these seven, in this order
    signing bytes    = utf8("aukora:owner-approval-signature:v1") ‖ 0x00 ‖ canonicalJSON(request)
    content          = canonicalJSON({key: <recordId>, value: <record>}) ‖ "\n"
    operationDigest  = sha256( utf8("aukora:operation-content:v1") ‖ 0x00 ‖ contentBytes )
    approvalId       = sha256( utf8("aukora:approval-receipt:v1") ‖ 0x00 ‖ challenge ‖ 0x00 ‖ signature )
    did:key          = "did:key:z" ‖ base58btc( 0xed 0x01 ‖ <32 raw Ed25519 public key bytes> )

THE OPERATION DIGEST IS DERIVED, NEVER READ. It is recomputed from the CONTENT BYTES the caller
supplies, and the artifact's `operationDigest` is compared against that derivation. A caller-supplied
digest is not accepted as the binding, there is no "also accept the other convention" branch, and the
content is digested as the bytes it is — a changed payload, and a missing or duplicated trailing
newline, each move the digest and are refused.

SIGNED FIELDS AND UNSIGNED METADATA, KEPT APART ON EVERY PATH. Only the seven request fields are inside
the preimage. `approvalClass`, `keyClass`, `keyClassMeaning`, `attendance`, `signerDeviceTrusted`,
`succession`, `identityBound`, `ceilings` and `verifiedAt` are NOT signed: anyone holding the file can
rewrite them without touching the signature. They are therefore reported as REPORTED — a claim the
record carries — and never as something this module established. The three claims this consumer cannot
stand behind are refused by name (mirroring the producer's own refusals): `human-ceremony` requires an
enrolment register that does not exist here, an `attendance` other than `reported-not-proven` asserts
something a signature cannot show, and `identityBound: true` claims a ceremony nobody performed.

WHAT A VERIFIED ARTIFACT DOES NOT SAY: that a person attended (nothing here can), that the approval is
still inside its window (that is checked only when the caller supplies the clock it means), that the
approver is a REGISTERED key (that is the composition's pin, supplied or absent and named either way),
or that anything is authorized. An approval is evidence; evidence never authorizes.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Optional

from diamond.kira_evidence import Refusal, jcs_bytes, raw_public_key_bytes, public_key_hex

# ── the artifact, field for field, from the producer's own parser ─────────────────────────────

APPROVAL_RECEIPT_DOMAIN = "aukora:approval-receipt:v1"
RETIRED_BUNDLE_DOMAIN = "aukora-kira-owner-approval-bundle/v1"
OWNER_KEY_SIGNED = "OWNER_KEY_SIGNED"

APPROVAL_RECEIPT_FIELDS = (
    "domain", "verdict", "keyClass", "keyClassMeaning", "approvalClass", "subject",
    "activeControlDigest", "approvalKeyDid", "operationDigest", "challenge", "issuedAt",
    "expiresAt", "signature", "signedBytesDigest", "verifiedAt", "attendance",
    "signerDeviceTrusted", "succession", "identityBound", "ceilings",
)
APPROVAL_CLASSES = ("human-ceremony", "delegated", "scripted", "unattributed")
KEY_CLASSES = {"A": "device-bound", "B": "software-held", "C": "operator-custodied"}
UNSUPPORTED_APPROVAL_CLASS = "human-ceremony"
REQUIRED_ATTENDANCE = "reported-not-proven"

APPROVAL_REQUEST_DOMAIN = "aukora:owner-approval-request:v1"
APPROVAL_SIGNATURE_DOMAIN = "aukora:owner-approval-signature:v1"
OPERATION_CONTENT_DOMAIN = "aukora:operation-content:v1"
DID_KEY_PREFIX = "did:key:"
ED25519_PUB_MULTICODEC = bytes((0xED, 0x01))
BASE58BTC_MULTIBASE = "z"

APPROVAL_REQUEST_FIELDS = ("domain", "subject", "activeControlDigest", "operationDigest",
                           "challenge", "issuedAt", "expiresAt")

# ── the receipt's approval block, and the two closed receipt profiles ─────────────────────────

RECEIPT_APPROVAL_FIELDS = ("approvalId", "artifactDomain", "challenge", "subject", "approverDid",
                           "operationDigest", "signature", "approvalClass", "keyClass")
#: Fields of the approval block that are DERIVED FROM THE SIGNED REQUEST. A disagreement here is a
#: linkage failure: these values cannot differ between one approval and its own record.
RECEIPT_APPROVAL_SIGNED_FIELDS = ("approvalId", "artifactDomain", "challenge", "subject",
                                  "approverDid", "operationDigest", "signature")
#: Fields of the approval block that are UNSIGNED LABELS copied out of the artifact. A disagreement
#: is still refused, but as a LABEL disagreement — never as a signature failure, which it is not.
RECEIPT_APPROVAL_LABEL_FIELDS = ("approvalClass", "keyClass")

# ── named outcomes (the producer's own strings where the same fact is named) ───────────────────

MALFORMED = "APPROVAL_MALFORMED"
INPUT_MALFORMED = "APPROVAL_INPUT_MALFORMED"
CONTENT_MISMATCH = "APPROVAL_CONTENT_MISMATCH"
SUBJECT_MISMATCH = "APPROVAL_SUBJECT_MISMATCH"
ARTIFACT_INCONSISTENT = "APPROVAL_ARTIFACT_INCONSISTENT"
KEY_MISMATCH = "APPROVAL_KEY_MISMATCH"
APPROVER_NOT_REGISTERED = "APPROVAL_APPROVER_NOT_REGISTERED"
SIGNATURE_INVALID = "APPROVAL_SIGNATURE_INVALID"
EXPIRED = "APPROVAL_EXPIRED"
CLASS_UNSUPPORTED = "APPROVAL_CLASS_UNSUPPORTED"
ATTENDANCE_UNSUPPORTED = "APPROVAL_ATTENDANCE_UNSUPPORTED"
IDENTITY_BOUND_UNSUPPORTED = "APPROVAL_IDENTITY_BOUND_UNSUPPORTED"
#: This consumer's own refusals — the producer has no code for these conditions.
RECORD_MISMATCH = "APPROVAL_RECORD_MISMATCH"
OBJECT_MISMATCH = "APPROVAL_OBJECT_DIGEST_MISMATCH"
RECEIPT_LINKAGE_MISMATCH = "APPROVAL_RECEIPT_LINKAGE_MISMATCH"
RECEIPT_APPROVAL_ABSENT = "APPROVAL_RECEIPT_APPROVAL_ABSENT"
CONTENT_NOT_CANONICAL = "APPROVAL_CONTENT_NOT_CANONICAL"

SIGNATURE_VALID = "APPROVAL_SIGNATURE_VALID"
BINDING_VERIFIED = "OPERATION_BINDING_VERIFIED"
LINKED = "RECEIPT_APPROVAL_LINKED"
AUTHORIZATION_UNCHECKED = "OWNER_APPROVAL_UNCHECKED"
ATTENDANCE = "reported-not-proven"

#: Statuses that must fail a normal verification.
FAILING_STATUSES = (MALFORMED, INPUT_MALFORMED, CONTENT_MISMATCH, SUBJECT_MISMATCH,
                    ARTIFACT_INCONSISTENT, KEY_MISMATCH, APPROVER_NOT_REGISTERED,
                    SIGNATURE_INVALID, EXPIRED, CLASS_UNSUPPORTED, ATTENDANCE_UNSUPPORTED,
                    IDENTITY_BOUND_UNSUPPORTED, RECORD_MISMATCH, OBJECT_MISMATCH,
                    RECEIPT_LINKAGE_MISMATCH, RECEIPT_APPROVAL_ABSENT, CONTENT_NOT_CANONICAL,
                    "UNSUPPORTED_NUMBER")

_LOWER_HEX_256 = re.compile(r"^[0-9a-f]{64}$")
_LOWER_HEX_512 = re.compile(r"^[0-9a-f]{128}$")
_AUKORA_ID = re.compile(r"^aukora:1:[0-9a-f]{64}$")
_EXACT_ATOM = re.compile(r"^[A-Za-z0-9._:/-]+$")
_DID_KEY_SHAPE = re.compile(r"^did:key:z[1-9A-HJ-NP-Za-km-z]+$")
_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

#: The ceilings every verdict carries: the limits of what this module establishes.
CEILINGS = (
    "HOST_CLOCK_TRUSTED_FOR_EXPIRY: expiry is compared only when the caller supplies at_time. "
    "That supplied time is trusted input, not an independently measured clock or freshness proof.",
    "SIGNATURE_IS_NOT_ATTENDANCE: a valid signature shows a key signed these bytes at some moment. "
    "Nothing here can show a person was present, that a decision was made, or that a key was held by "
    "the party it names.",
    "UNSIGNED_METADATA_IS_REPORTED: approvalClass, keyClass, keyClassMeaning, attendance, "
    "signerDeviceTrusted, succession, identityBound, ceilings and verifiedAt are OUTSIDE the signed "
    "preimage, so they are reported as the artifact's own claims and never as checked facts.",
    "BINDING_IS_NOT_AUTHORIZATION: the operation digest is derived here from the content bytes and "
    "compared, but authorization stays OWNER_APPROVAL_UNCHECKED — an approval entitles nobody to act.",
    "NO_REPLAY_PREVENTION: the same artifact can be presented again. Exactly-once consumption is the "
    "producer's own registry, not a property of these bytes.",
    "APPROVER_REGISTRATION_NOT_ESTABLISHED: this consumer checks the approval against the anchor the "
    "CALLER supplies. With no pin, the verdict says a key the artifact names signed these bytes, which "
    "a freshly generated key can also satisfy.",
    "NO_LATESTNESS: the receipt's approval block names an approval, not the state of any store. "
    "Nothing here shows a later write did not happen elsewhere.",
)


class ArtifactRefusal(Exception):
    """A named refusal. `code` is a stable string."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


# ── base58btc and did:key ─────────────────────────────────────────────────────────────────────

def base58btc_encode(raw: bytes) -> str:
    """Multibase `base58btc` encoding, leading zero bytes preserved as '1'."""
    number = int.from_bytes(raw, "big")
    out = ""
    while number > 0:
        number, remainder = divmod(number, 58)
        out = _BASE58_ALPHABET[remainder] + out
    padding = 0
    for byte in raw:
        if byte == 0:
            padding += 1
        else:
            break
    return "1" * padding + out


def base58btc_decode(text: str) -> bytes:
    """Strict `base58btc` decoding: a character outside the alphabet is refused, never skipped."""
    if not isinstance(text, str) or text == "":
        raise ArtifactRefusal(MALFORMED, "base58btc: the multibase payload is empty")
    number = 0
    for character in text:
        index = _BASE58_ALPHABET.find(character)
        if index == -1:
            raise ArtifactRefusal(MALFORMED,
                                  f"base58btc: {character!r} is not a base58btc character")
        number = number * 58 + index
    body = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    padding = 0
    for character in text:
        if character == "1":
            padding += 1
        else:
            break
    return b"\x00" * padding + body


def did_key_from_raw(raw_hex: str) -> str:
    """`did:key:z…` for one 32-byte Ed25519 public key in lowercase hex."""
    if not isinstance(raw_hex, str) or not _LOWER_HEX_256.match(raw_hex):
        raise ArtifactRefusal(MALFORMED, "did:key: Ed25519 public key must be 64 lowercase hex "
                                         "characters")
    return DID_KEY_PREFIX + BASE58BTC_MULTIBASE + base58btc_encode(
        ED25519_PUB_MULTICODEC + bytes.fromhex(raw_hex))


def raw_from_did_key(did: Any) -> str:
    """The raw key a `did:key` names, or a named refusal."""
    if not isinstance(did, str) or not did.startswith(DID_KEY_PREFIX):
        raise ArtifactRefusal(KEY_MISMATCH, f"did:key: must start with {DID_KEY_PREFIX}")
    multibase = did[len(DID_KEY_PREFIX):]
    if not multibase.startswith(BASE58BTC_MULTIBASE):
        raise ArtifactRefusal(KEY_MISMATCH,
                              f"did:key: only the {BASE58BTC_MULTIBASE} (base58btc) multibase "
                              f"prefix is supported")
    try:
        decoded = base58btc_decode(multibase[1:])
    except ArtifactRefusal as exc:
        raise ArtifactRefusal(KEY_MISMATCH, exc.detail) from exc
    expected = len(ED25519_PUB_MULTICODEC) + 32
    if len(decoded) != expected:
        raise ArtifactRefusal(KEY_MISMATCH,
                              f"did:key: expected {expected} bytes for an Ed25519 key, decoded "
                              f"{len(decoded)}")
    if decoded[:len(ED25519_PUB_MULTICODEC)] != ED25519_PUB_MULTICODEC:
        raise ArtifactRefusal(KEY_MISMATCH,
                              "did:key: multicodec header is not ed25519-pub (0xed01)")
    return decoded[len(ED25519_PUB_MULTICODEC):].hex()


# ── shape ─────────────────────────────────────────────────────────────────────────────────────

def _require_digest(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _LOWER_HEX_256.match(value):
        raise ArtifactRefusal(MALFORMED, f"{label}: must be 64 lowercase hexadecimal characters")
    return value


def _require_non_negative_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 2 ** 53 - 1:
        raise ArtifactRefusal(MALFORMED, f"{label}: must be a non-negative safe integer")
    return value


def _require_exact_atom(value: Any, label: str, maximum_bytes: int = 256) -> str:
    if not isinstance(value, str) or not _EXACT_ATOM.match(value):
        raise ArtifactRefusal(MALFORMED, f"{label}: must be an exact atom")
    if len(value.encode("utf-8")) > maximum_bytes:
        raise ArtifactRefusal(MALFORMED, f"{label}: exceeds {maximum_bytes} bytes")
    return value


def parse_artifact(document: Any) -> dict:
    """Parse one artifact as a CLOSED `aukora:approval-receipt:v1` record.

    Shape only. Whether the signature is real, and whether the approver is the key the caller pinned,
    are separate questions with separate refusals — a parser that also answered them would collapse
    "this is not an artifact" into "this artifact is wrong".
    """
    if not isinstance(document, dict):
        raise ArtifactRefusal(MALFORMED, "the artifact must be one plain data record")
    if document.get("domain") == RETIRED_BUNDLE_DOMAIN or "request" in document:
        # The retired wrapper is refused BY NAME rather than merely failing a field-set check: the
        # reconciliation deleted that shape, and a consumer that cannot say WHICH shape it saw leaves
        # its reader to guess whether the wire moved back.
        raise ArtifactRefusal(
            MALFORMED,
            f"the artifact is a RETIRED `{RETIRED_BUNDLE_DOMAIN}` request/response wrapper, not a "
            f"`{APPROVAL_RECEIPT_DOMAIN}` record; that shape is no longer produced and is not "
            f"accepted here")
    extra = sorted(set(document) - set(APPROVAL_RECEIPT_FIELDS))
    missing = sorted(set(APPROVAL_RECEIPT_FIELDS) - set(document))
    if extra or missing:
        raise ArtifactRefusal(
            MALFORMED,
            f"the artifact is not the closed field set: missing={missing} extra={extra} "
            f"(a verifier that tolerates an extra field will print a verdict over bytes nobody agreed to)")
    if document["domain"] != APPROVAL_RECEIPT_DOMAIN:
        raise ArtifactRefusal(MALFORMED, f"artifact.domain must equal {APPROVAL_RECEIPT_DOMAIN}")
    if document["verdict"] != OWNER_KEY_SIGNED:
        raise ArtifactRefusal(MALFORMED, f"artifact.verdict must equal {OWNER_KEY_SIGNED}")
    key_class = document["keyClass"]
    if key_class not in KEY_CLASSES:
        raise ArtifactRefusal(MALFORMED,
                              f"artifact.keyClass must be one of {sorted(KEY_CLASSES)}")
    if document["keyClassMeaning"] != KEY_CLASSES[key_class]:
        raise ArtifactRefusal(MALFORMED,
                              "artifact.keyClassMeaning does not match the key class it names")
    if document["approvalClass"] not in APPROVAL_CLASSES:
        raise ArtifactRefusal(MALFORMED,
                              f"artifact.approvalClass must be one of {list(APPROVAL_CLASSES)}")
    if not isinstance(document["identityBound"], bool):
        raise ArtifactRefusal(MALFORMED, "artifact.identityBound must be a boolean")
    ceilings = document["ceilings"]
    if not isinstance(ceilings, list) or any(not isinstance(line, str) for line in ceilings):
        raise ArtifactRefusal(MALFORMED, "artifact.ceilings must be an array of strings")
    subject = document["subject"]
    if not isinstance(subject, str) or not _AUKORA_ID.match(subject):
        raise ArtifactRefusal(MALFORMED, "artifact.subject: must use the aukora:1:<sha256> form")
    if not isinstance(document["signature"], str) or not _LOWER_HEX_512.match(document["signature"]):
        raise ArtifactRefusal(MALFORMED,
                              "artifact.signature: must be 128 lowercase hexadecimal characters")
    return {
        "domain": APPROVAL_RECEIPT_DOMAIN,
        "verdict": OWNER_KEY_SIGNED,
        "keyClass": key_class,
        "keyClassMeaning": KEY_CLASSES[key_class],
        "approvalClass": document["approvalClass"],
        "subject": subject,
        "activeControlDigest": _require_digest(document["activeControlDigest"],
                                               "artifact.activeControlDigest"),
        "approvalKeyDid": _require_exact_atom(document["approvalKeyDid"],
                                              "artifact.approvalKeyDid", 256),
        "operationDigest": _require_digest(document["operationDigest"],
                                           "artifact.operationDigest"),
        "challenge": _require_digest(document["challenge"], "artifact.challenge"),
        "issuedAt": _require_non_negative_int(document["issuedAt"], "artifact.issuedAt"),
        "expiresAt": _require_non_negative_int(document["expiresAt"], "artifact.expiresAt"),
        "signature": document["signature"],
        "signedBytesDigest": _require_digest(document["signedBytesDigest"],
                                             "artifact.signedBytesDigest"),
        "verifiedAt": _require_non_negative_int(document["verifiedAt"], "artifact.verifiedAt"),
        "attendance": _require_exact_atom(document["attendance"], "artifact.attendance", 64),
        "signerDeviceTrusted": _require_exact_atom(document["signerDeviceTrusted"],
                                                   "artifact.signerDeviceTrusted", 64),
        "succession": _require_exact_atom(document["succession"], "artifact.succession", 64),
        "identityBound": document["identityBound"],
        "ceilings": list(ceilings),
    }


# ── the rules ─────────────────────────────────────────────────────────────────────────────────

def request_from_artifact(artifact: dict) -> dict:
    """The seven-field request the artifact's OWN fields derive. Nothing is taken on trust."""
    request = {
        "domain": APPROVAL_REQUEST_DOMAIN,
        "subject": artifact["subject"],
        "activeControlDigest": artifact["activeControlDigest"],
        "operationDigest": artifact["operationDigest"],
        "challenge": artifact["challenge"],
        "issuedAt": artifact["issuedAt"],
        "expiresAt": artifact["expiresAt"],
    }
    if artifact["expiresAt"] <= artifact["issuedAt"]:
        raise ArtifactRefusal(MALFORMED,
                              "artifact: expiresAt must be greater than issuedAt")
    return request


def signing_bytes(artifact: dict) -> bytes:
    """The exact bytes the owner key signed, rebuilt from the artifact's own fields."""
    return (APPROVAL_SIGNATURE_DOMAIN.encode("ascii") + b"\0"
            + jcs_bytes(request_from_artifact(artifact)))


def operation_digest_of(content_bytes: bytes) -> str:
    """sha256(utf8(domain) ‖ 0x00 ‖ contentBytes) — the ONE digest rule, restated here."""
    digest = hashlib.sha256()
    digest.update(OPERATION_CONTENT_DOMAIN.encode("utf-8"))
    digest.update(b"\0")
    digest.update(content_bytes)
    return digest.hexdigest()


def approval_id_of(artifact: dict) -> str:
    """sha256(domain ‖ 0x00 ‖ challenge ‖ 0x00 ‖ signature) — the SIGNED pair, and nothing else.

    An unsigned field cannot move it, which is why one approval cannot be turned into two writes by
    editing a label.
    """
    digest = hashlib.sha256()
    digest.update(APPROVAL_RECEIPT_DOMAIN.encode("utf-8"))
    digest.update(b"\0")
    digest.update(artifact["challenge"].encode("utf-8"))
    digest.update(b"\0")
    digest.update(artifact["signature"].encode("utf-8"))
    return digest.hexdigest()


def read_content(content_bytes: bytes) -> dict:
    """Read the content bytes as `{key, value}` AND check they are the canonical bytes.

    The rule is the producer's own object body: `canonicalJSON({key, value}) ‖ "\\n"`. Bytes that
    parse to the same value but were serialized differently are refused, because they are different
    bytes: the digest binds bytes, the store holds bytes, and a consumer that re-serialized what it
    read would verify a document nobody wrote.
    """
    try:
        value = json.loads(content_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ArtifactRefusal(CONTENT_NOT_CANONICAL,
                              f"the content is not JSON text: {exc}") from exc
    if not isinstance(value, dict) or set(value) != {"key", "value"}:
        raise ArtifactRefusal(CONTENT_NOT_CANONICAL,
                              "the content must be exactly {key, value}")
    try:
        canonical = jcs_bytes(value) + b"\n"
    except Refusal as exc:
        # The artifact uses the same cold numeric profile as Kira evidence. Keep
        # its named refusal within this lane's reporting boundary; never guess
        # floating-point bytes to make the content appear canonical.
        raise ArtifactRefusal(exc.code, exc.detail) from exc
    if canonical != content_bytes:
        raise ArtifactRefusal(
            CONTENT_NOT_CANONICAL,
            f"the content is not canonicalJSON({{key, value}}) plus one newline: it is "
            f"{len(content_bytes)} bytes and its canonical form is {len(canonical)} — a changed "
            f"payload, a missing or doubled terminator, or reformatted JSON all land here")
    return value


def check_receipt_approval_block(receipt_approval: Any, artifact: dict) -> dict:
    """Link one receipt's `approval` block to the artifact, with signed and label fields apart."""
    if not isinstance(receipt_approval, dict):
        raise ArtifactRefusal(RECEIPT_APPROVAL_ABSENT,
                              "the receipt carries no approval block to link")
    extra = sorted(set(receipt_approval) - set(RECEIPT_APPROVAL_FIELDS))
    missing = sorted(set(RECEIPT_APPROVAL_FIELDS) - set(receipt_approval))
    if extra or missing:
        raise ArtifactRefusal(
            RECEIPT_LINKAGE_MISMATCH,
            f"the receipt's approval block is not the closed field set: missing={missing} extra={extra}")

    expected_signed = {
        "approvalId": approval_id_of(artifact),
        "artifactDomain": artifact["domain"],
        "challenge": artifact["challenge"],
        "subject": artifact["subject"],
        "approverDid": artifact["approvalKeyDid"],
        "operationDigest": artifact["operationDigest"],
        "signature": artifact["signature"],
    }
    expected_labels = {
        "approvalClass": artifact["approvalClass"],
        "keyClass": artifact["keyClass"],
    }
    signed_differences = {name: {"receipt": receipt_approval.get(name), "artifact": value}
                          for name, value in expected_signed.items()
                          if receipt_approval.get(name) != value}
    label_differences = {name: {"receipt": receipt_approval.get(name), "artifact": value}
                         for name, value in expected_labels.items()
                         if receipt_approval.get(name) != value}

    if signed_differences:
        raise ArtifactRefusal(
            RECEIPT_LINKAGE_MISMATCH,
            "the receipt's approval block does not name THIS approval: "
            + "; ".join(f"{name} receipt={value['receipt']!r} artifact={value['artifact']!r}"
                        for name, value in sorted(signed_differences.items())))
    if label_differences:
        # Refused, but as a LABEL disagreement: these fields are outside the signed preimage, so this
        # is not a signature failure and must not be reported as one.
        raise ArtifactRefusal(
            RECEIPT_LINKAGE_MISMATCH,
            "the receipt's approval block carries DIFFERENT UNSIGNED LABELS than the artifact "
            "(labels are not signed, so this is a disagreement about labels, not a signature): "
            + "; ".join(f"{name} receipt={value['receipt']!r} artifact={value['artifact']!r}"
                        for name, value in sorted(label_differences.items())))
    return {
        "status": LINKED,
        "checked": True,
        "approvalId": expected_signed["approvalId"],
        "signedFields": list(RECEIPT_APPROVAL_SIGNED_FIELDS),
        "labelFields": list(RECEIPT_APPROVAL_LABEL_FIELDS),
        "labelsAgree": True,
    }


# ── verification ──────────────────────────────────────────────────────────────────────────────

def _anchor_raw(anchor: Any) -> tuple[Optional[bytes], str]:
    """Read the INDEPENDENTLY supplied anchor: raw hex, a `did:key`, or an SPKI PEM."""
    if anchor is None or (isinstance(anchor, str) and anchor.strip() == ""):
        return None, "absent"
    if not isinstance(anchor, str):
        raise ArtifactRefusal(INPUT_MALFORMED, "the anchor must be text")
    text = anchor.strip()
    if text.startswith(DID_KEY_PREFIX):
        return bytes.fromhex(raw_from_did_key(text)), "did:key"
    if text.startswith("-----BEGIN"):
        try:
            return raw_public_key_bytes(text), "pem"
        except Refusal as exc:
            raise ArtifactRefusal(INPUT_MALFORMED, f"the anchor PEM could not be read: {exc.detail}") from exc
    if _LOWER_HEX_256.match(text):
        return bytes.fromhex(text), "hex"
    raise ArtifactRefusal(INPUT_MALFORMED,
                          "the anchor must be 64 lowercase hex characters, a did:key, or an SPKI PEM")


def verify_artifact(artifact_document: Any, *, anchor: Any, content_bytes: Optional[bytes] = None,
                    expected_subject: Optional[str] = None, approver_pin: Optional[str] = None,
                    record: Optional[dict] = None, object_bytes: Optional[bytes] = None,
                    receipt: Optional[dict] = None, now: Optional[int] = None) -> dict:
    """Verify one flat approval artifact against the content it must bind, offline.

    @param artifact_document: the parsed `aukora:approval-receipt:v1` record.
    @param anchor: the approver public key, supplied SEPARATELY: hex, `did:key`, or SPKI PEM. Never
        read from the artifact, and its absence is a named refusal rather than a silent skip.
    @param content_bytes: the EXACT `canonicalJSON({key, value})` + "\\n" bytes being settled. The
        operation digest is derived from THESE bytes; a caller-supplied digest is not accepted.
    @param expected_subject: the subject this owner serves, when the caller knows it.
    @param approver_pin: the REGISTERED approver `did:key` the composition accepts, when it has one.
    @param record: the record itself, when the caller holds it separately: its recomputed identity
        must equal the content's `key`.
    @param object_bytes: the stored object's bytes, when the caller has them: they must hash to
        `sha256(content)` and so to the receipt's effect digest.
    @param receipt: the producer's memory receipt, when the caller holds it: its `approval` block
        must name THIS approval.
    @param now: unix seconds, when the caller means to ask whether the window is open. Without it the
        window is NOT checked — a genuine approval consumed long ago is not false because time passed.
    @returns: the separated findings plus `fails_verification`, which is what a caller must act on.
    """
    findings: dict[str, Any] = {
        "artifact": {"status": "PARSED", "domain": APPROVAL_RECEIPT_DOMAIN},
        "signature": {"status": None, "checked": False},
        "anchor": {"status": None, "source": None, "anchorKeyHex": None,
                   "artifactApprovalKeyDid": None, "derivedDidFromAnchor": None},
        "signed_bytes_digest": {"status": None, "checked": False},
        "operation_binding": {"status": None, "checked": False,
                              "rule": "sha256(utf8(\"aukora:operation-content:v1\") || 0x00 || "
                                      "contentBytes) over the bytes supplied to THIS verifier"},
        "content_canonicalization": {"status": "NOT_CHECKED", "checked": False},
        "subject": {"status": "NOT_SUPPLIED", "checked": False},
        "record_identity": {"status": "NOT_SUPPLIED", "checked": False},
        "object_digest": {"status": "NOT_SUPPLIED", "checked": False},
        "receipt_approval_linkage": {"status": "NOT_SUPPLIED", "checked": False},
        "window": {"status": "NOT_CHECKED", "checked": False,
                   "why": "no clock was supplied; asking whether a window is still open later would "
                          "accuse a genuine, already-consumed approval of being false"},
        "classification": {"status": "REPORTED", "signed": False, "fields": {}},
        "authorization": {"status": AUTHORIZATION_UNCHECKED, "checked": False,
                          "why": "an approval is evidence; evidence never authorizes"},
        "attendance": {"status": ATTENDANCE, "proven": False},
        "retiredDomainRecognised": None,
        "fails_verification": False,
        "ceilings": list(CEILINGS),
    }
    refusals: list[dict] = []

    def refuse(code: str, detail: str) -> None:
        refusals.append({"code": code, "detail": detail})

    try:
        artifact = parse_artifact(artifact_document)
    except ArtifactRefusal as exc:
        findings["artifact"] = {"status": exc.code, "detail": exc.detail}
        if isinstance(artifact_document, dict) and (
                artifact_document.get("domain") == RETIRED_BUNDLE_DOMAIN
                or "request" in artifact_document):
            findings["retiredDomainRecognised"] = RETIRED_BUNDLE_DOMAIN
        refuse(exc.code, exc.detail)
        findings["fails_verification"] = True
        findings["refusal"] = refusals[0]
        return findings

    findings["classification"]["fields"] = {
        "approvalClass": artifact["approvalClass"],
        "keyClass": artifact["keyClass"],
        "keyClassMeaning": artifact["keyClassMeaning"],
        "attendance": artifact["attendance"],
        "signerDeviceTrusted": artifact["signerDeviceTrusted"],
        "succession": artifact["succession"],
        "identityBound": artifact["identityBound"],
        "verifiedAt": artifact["verifiedAt"],
        "ceilings": artifact["ceilings"],
    }
    findings["approvalId"] = approval_id_of(artifact)

    # 1. the claims this consumer cannot stand behind — refused BEFORE any signature work, because a
    #    label nobody can earn must not be printed beside a green.
    if artifact["approvalClass"] == UNSUPPORTED_APPROVAL_CLASS:
        refuse(CLASS_UNSUPPORTED,
               f"the artifact claims approvalClass={UNSUPPORTED_APPROVAL_CLASS}; that class requires "
               f"a key enrolled by a recorded human ceremony, no such enrolment register exists here, "
               f"and the field is NOT signed — so this consumer refuses the claim instead of "
               f"repeating it")
    if artifact["attendance"] != REQUIRED_ATTENDANCE:
        refuse(ATTENDANCE_UNSUPPORTED,
               f"the artifact records attendance={artifact['attendance']!r}; the only value this "
               f"consumer will consume is {REQUIRED_ATTENDANCE!r}, because a signature cannot show "
               f"anyone was present and the field is NOT signed")
    if artifact["identityBound"] is not False:
        refuse(IDENTITY_BOUND_UNSUPPORTED,
               "the artifact claims identityBound:true; no ceremony in this project binds an approval "
               "to an identity, the field is NOT signed, and this consumer performs no such binding")

    # 2. the binding: the digest is DERIVED from the bytes, and the artifact must name it.
    if content_bytes is None:
        refuse(INPUT_MALFORMED,
               "the content bytes being settled are required: an approval over a digest nobody can "
               "re-derive binds nothing")
    else:
        try:
            content = read_content(content_bytes)
        except ArtifactRefusal as exc:
            findings["content_canonicalization"] = {
                "status": exc.code, "checked": True, "detail": exc.detail,
            }
            refuse(exc.code, exc.detail)
            content = None
            if record is not None:
                findings["record_identity"] = {
                    "status": "NOT_CHECKED", "checked": False,
                    "why": "the supplied content could not be canonicalized",
                }
        else:
            findings["content_canonicalization"] = {"status": "CONTENT_CANONICAL", "checked": True}
        derived = operation_digest_of(content_bytes)
        findings["operation_binding"].update({
            "checked": True, "derivedOperationDigest": derived,
            "artifactOperationDigest": artifact["operationDigest"],
            "contentSha256": hashlib.sha256(content_bytes).hexdigest(),
            "contentBytes": len(content_bytes),
        })
        if artifact["operationDigest"] != derived:
            findings["operation_binding"]["status"] = CONTENT_MISMATCH
            refuse(CONTENT_MISMATCH,
                   f"the approval binds operation digest {artifact['operationDigest']} but the "
                   f"content being settled digests to {derived}; an approval binds the bytes it was "
                   f"issued for")
        else:
            findings["operation_binding"]["status"] = BINDING_VERIFIED

        # 3. the record's own identity, when the caller holds the record separately.
        if content is not None:
            if record is not None:
                entry = content["value"]
                if isinstance(entry, dict) and entry.get("recordId") != content["key"]:
                    findings["record_identity"] = {
                        "status": RECORD_MISMATCH, "checked": True,
                        "contentKey": content["key"], "recordRecordId": entry.get("recordId"),
                        "why": "the content addresses a different record than it carries",
                    }
                    refuse(RECORD_MISMATCH, findings["record_identity"]["why"])
                else:
                    from diamond.kira_evidence import compute_record_id
                    try:
                        recomputed = compute_record_id(record)
                        same_key = recomputed == content["key"]
                        same_record = jcs_bytes(record) == jcs_bytes(entry) if isinstance(entry, dict) else False
                    except Refusal as exc:
                        findings["record_identity"] = {
                            "status": exc.code, "checked": False,
                            "contentKey": content["key"], "recomputedRecordId": None,
                            "recordMatchesContent": None, "why": exc.detail,
                        }
                        refuse(exc.code, exc.detail)
                    else:
                        findings["record_identity"] = {
                            "status": "RECORD_IDENTITY_MATCH" if (same_key and same_record)
                                      else RECORD_MISMATCH,
                            "checked": True, "contentKey": content["key"],
                            "recomputedRecordId": recomputed, "recordMatchesContent": same_record,
                            "why": "the record's recomputed identifier and its canonical bytes must be "
                                   "the ones the content addresses",
                        }
                        if not (same_key and same_record):
                            refuse(RECORD_MISMATCH,
                                   f"the record does not recompute to the content's key: recomputed "
                                   f"{recomputed}, content names {content['key']}, canonical bytes match: "
                                   f"{same_record}")
            # 4. the stored object's bytes, when the caller holds them.
            if object_bytes is not None:
                object_sha = hashlib.sha256(object_bytes).hexdigest()
                matches = object_sha == hashlib.sha256(content_bytes).hexdigest()
                findings["object_digest"] = {
                    "status": "OBJECT_DIGEST_MATCH" if matches else OBJECT_MISMATCH,
                    "checked": True, "objectSha256": object_sha,
                    "contentSha256": hashlib.sha256(content_bytes).hexdigest(),
                    "why": "the stored object must BE the content the approval binds, not merely "
                           "parse to the same value",
                }
                if not matches:
                    refuse(OBJECT_MISMATCH, findings["object_digest"]["why"])

    # 4b. the SUBJECT. When the caller names the subject this owner serves, that is the expectation.
    # When it does not, the record's OWN subject is the expectation — an approval for another owner's
    # memory cannot authorize a write into this one, and the record the content carries says which
    # memory it is. One of the two is always available, so this is never silently skipped.
    if expected_subject is not None:
        if not isinstance(expected_subject, str) or not _AUKORA_ID.match(expected_subject):
            refuse(INPUT_MALFORMED,
                   "the expected subject must use the aukora:1:<sha256> form")
        elif artifact["subject"] != expected_subject:
            refuse(SUBJECT_MISMATCH,
                   f"the approval names subject {artifact['subject']!r} and this owner serves "
                   f"{expected_subject!r}")
        findings["subject"] = {"status": "SUBJECT_MATCHES_EXPECTATION", "checked": True,
                               "expected": expected_subject, "source": "supplied by the caller"}
    elif content_bytes is not None:
        try:
            carried = json.loads(content_bytes.decode("utf-8")).get("value")
        except (UnicodeDecodeError, ValueError, AttributeError):
            carried = None
        record_subject = carried.get("subject") if isinstance(carried, dict) else None
        if isinstance(record_subject, str) and _AUKORA_ID.match(record_subject):
            matches = artifact["subject"] == record_subject
            findings["subject"] = {
                "status": "SUBJECT_MATCHES_RECORD" if matches else SUBJECT_MISMATCH,
                "checked": True, "expected": record_subject, "source": "the record's own subject",
            }
            if not matches:
                refuse(SUBJECT_MISMATCH,
                       f"the approval names subject {artifact['subject']!r} and the record it binds "
                       f"carries subject {record_subject!r}; an approval for one memory cannot "
                       f"authorize a write into another")
        else:
            findings["subject"] = {"status": "SUBJECT_UNCHECKED", "checked": False,
                                   "why": "no subject was supplied and the content carries none"}

    # 5. the artifact must agree with itself about the bytes it was signed over.
    try:
        preimage = signing_bytes(artifact)
    except ArtifactRefusal as exc:
        refuse(exc.code, exc.detail)
        preimage = None
    if preimage is not None:
        derived_signed = hashlib.sha256(preimage).hexdigest()
        findings["signed_bytes_digest"] = {
            "status": "SIGNED_BYTES_DIGEST_MATCH" if derived_signed == artifact["signedBytesDigest"]
                      else ARTIFACT_INCONSISTENT,
            "checked": True, "derivedSignedBytesDigest": derived_signed,
            "artifactSignedBytesDigest": artifact["signedBytesDigest"],
        }
        if derived_signed != artifact["signedBytesDigest"]:
            refuse(ARTIFACT_INCONSISTENT,
                   f"the artifact prints signedBytesDigest {artifact['signedBytesDigest']} but its "
                   f"own fields derive {derived_signed}; the artifact does not describe the bytes it "
                   f"was signed over")
        findings["signature"]["preimageSha256"] = derived_signed

    # 6. the anchor, and the DID's bijection with it.
    try:
        anchor_raw, anchor_source = _anchor_raw(anchor)
    except ArtifactRefusal as exc:
        anchor_raw, anchor_source = None, "refused"
        refuse(exc.code, exc.detail)
    findings["anchor"]["source"] = anchor_source
    if anchor_raw is None:
        if anchor_source != "refused":
            refuse(KEY_MISMATCH,
                   "no approver anchor was supplied; an artifact's own approvalKeyDid is a claim, "
                   "and this consumer has no unanchored mode")
    else:
        anchor_hex = public_key_hex(anchor_raw)
        findings["anchor"]["anchorKeyHex"] = anchor_hex
        findings["anchor"]["artifactApprovalKeyDid"] = artifact["approvalKeyDid"]
        try:
            named_raw = raw_from_did_key(artifact["approvalKeyDid"])
        except ArtifactRefusal as exc:
            refuse(KEY_MISMATCH, f"the approval key does not decode out of the artifact's did:key: "
                                 f"{exc.detail}")
            named_raw = None
        if named_raw is not None:
            findings["anchor"]["derivedDidFromAnchor"] = did_key_from_raw(anchor_hex)
            if named_raw != anchor_hex:
                findings["anchor"]["status"] = KEY_MISMATCH
                refuse(KEY_MISMATCH,
                       f"the artifact names approver {artifact['approvalKeyDid']} "
                       f"({named_raw[:16]}…) and the supplied anchor is {anchor_hex[:16]}…; "
                       f"verification is refused rather than attempted against a key found nearby")
            elif did_key_from_raw(anchor_hex) != artifact["approvalKeyDid"]:
                findings["anchor"]["status"] = KEY_MISMATCH
                refuse(KEY_MISMATCH,
                       "the artifact's approvalKeyDid is not the canonical did:key of the key it "
                       "decodes to")
            else:
                findings["anchor"]["status"] = "ANCHOR_MATCHES_ARTIFACT_KEY"
            if approver_pin is not None:
                if not isinstance(approver_pin, str) or not _DID_KEY_SHAPE.match(approver_pin):
                    refuse(INPUT_MALFORMED, "the pinned approver must be a did:key identifier")
                elif artifact["approvalKeyDid"] != approver_pin:
                    refuse(APPROVER_NOT_REGISTERED,
                           f"the approval was signed by {artifact['approvalKeyDid']} and this owner "
                           f"accepts only {approver_pin}")

    # 7. the signature, under the anchor supplied — never under a key the document chose.
    findings["signature"]["anchorSource"] = anchor_source
    if anchor_raw is not None and preimage is not None:
        from diamond.ed25519 import verify as ed25519_verify
        valid = ed25519_verify(anchor_raw, preimage, bytes.fromhex(artifact["signature"]))
        findings["signature"]["status"] = SIGNATURE_VALID if valid else SIGNATURE_INVALID
        findings["signature"]["checked"] = True
        if not valid:
            # No reassuring prose: an invalid signature says exactly that.
            findings["signature"]["detail"] = \
                "the signature does not verify under the supplied anchor"
            refuse(SIGNATURE_INVALID, findings["signature"]["detail"])
    elif findings["signature"]["status"] is None:
        findings["signature"]["status"] = KEY_MISMATCH
        findings["signature"]["detail"] = "no anchor was supplied, so no signature was checked"

    # 8. the producer's receipt, when the caller holds it: its approval block must name THIS approval.
    if receipt is not None:
        block = receipt.get("approval") if isinstance(receipt, dict) else None
        try:
            findings["receipt_approval_linkage"] = check_receipt_approval_block(block, artifact)
        except ArtifactRefusal as exc:
            findings["receipt_approval_linkage"] = {"status": exc.code, "checked": True,
                                                    "detail": exc.detail}
            refuse(exc.code, exc.detail)

    # 9. the window, ONLY when the caller supplied the clock they mean.
    if now is not None:
        if isinstance(now, bool) or not isinstance(now, int) or now < 0:
            refuse(INPUT_MALFORMED, "the clock must be a non-negative integer of unix seconds")
        else:
            findings["window"] = {
                "status": "EXPIRED" if artifact["expiresAt"] <= now else "OPEN",
                "checked": True, "now": now, "expiresAt": artifact["expiresAt"],
                "issuedAt": artifact["issuedAt"],
            }
            if artifact["expiresAt"] <= now:
                refuse(EXPIRED,
                       f"the approval window closed at {artifact['expiresAt']} (now {now})")

    findings["refusals"] = refusals
    findings["fails_verification"] = bool(refusals)
    findings["refusal"] = refusals[0] if refusals else None
    return findings


def artifact_summary(findings: dict) -> dict:
    """One summary a caller acts on, derived from the findings — never from optimism.

    The status word, the reason and the refusal come from HERE, so a text rendering, a JSON rendering
    and an exit status are three spellings of one decision. The word for a fully verified artifact says
    what was verified: a signature under the supplied anchor, over the derived operation digest — and
    never that anyone attended, that the approver is registered, or that anything is authorized.
    """
    refusal = findings.get("refusal")
    if refusal:
        status = refusal["code"]
        category = "UNSUPPORTED" if status == "UNSUPPORTED_NUMBER" else "REFUSED"
        reason = f"{category}: {refusal['code']} — {refusal['detail']}"
    else:
        status = "APPROVAL_ARTIFACT_VERIFIED"
        reason = (
            "signature valid under the supplied anchor over signing bytes rebuilt from the "
            "artifact's own seven request fields; operation digest DERIVED from the supplied content "
            "bytes and equal to the one the artifact names; classification labels REPORTED and not "
            "signed; attendance NOT proven; authorization OWNER_APPROVAL_UNCHECKED"
        )
    return {
        "facet": "owner_approval_artifact",
        "status": status,
        "reason": reason,
        "refusal": refusal,
        "approvalId": findings.get("approvalId"),
        "signature": findings.get("signature"),
        "anchor": findings.get("anchor"),
        "operation_binding": findings.get("operation_binding"),
        "content_canonicalization": findings.get("content_canonicalization"),
        "subject": findings.get("subject"),
        "record_identity": findings.get("record_identity"),
        "object_digest": findings.get("object_digest"),
        "receipt_approval_linkage": findings.get("receipt_approval_linkage"),
        "classification": findings.get("classification"),
        "window": findings.get("window"),
        "authorization": findings.get("authorization"),
        "attendance": findings.get("attendance"),
        "ceilings": findings.get("ceilings"),
        "fails_verification": bool(refusal),
    }


def main(argv: list[str] | None = None) -> int:
    """Verify one flat approval artifact offline; exit 0 only when nothing failed.

        python3 -m diamond.approval_artifact --artifact A --content C --anchor <hex|did:key|pem|file>
                                             [--subject S] [--approver-pin did:key] [--record R]
                                             [--object O] [--receipt R] [--now N] [--json]
    """
    import argparse
    import sys
    from pathlib import Path

    parser = argparse.ArgumentParser(description="offline verification of one aukora:approval-receipt:v1")
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--content", required=True, help="the EXACT content bytes being settled")
    parser.add_argument("--anchor", required=True,
                        help="the approver public key, supplied SEPARATELY: hex, did:key, or SPKI PEM")
    parser.add_argument("--subject", default=None, help="the subject this owner serves")
    parser.add_argument("--approver-pin", default=None, help="the registered approver did:key")
    parser.add_argument("--record", default=None, help="the record itself, when held separately")
    parser.add_argument("--object", default=None, help="the stored object bytes, when held")
    parser.add_argument("--receipt", default=None, help="the producer's memory receipt")
    parser.add_argument("--now", type=int, default=None, help="unix seconds, to check the window")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    def read_text_or_file(text: str) -> str:
        candidate = Path(text)
        return candidate.read_text().strip() if candidate.is_file() else text.strip()

    artifact = json.loads(Path(args.artifact).read_text())
    content_bytes = Path(args.content).read_bytes()
    record = json.loads(Path(args.record).read_text()) if args.record else None
    object_bytes = Path(args.object).read_bytes() if args.object else None
    receipt = json.loads(Path(args.receipt).read_text()) if args.receipt else None

    findings = verify_artifact(
        artifact, anchor=read_text_or_file(args.anchor), content_bytes=content_bytes,
        expected_subject=args.subject, approver_pin=args.approver_pin, record=record,
        object_bytes=object_bytes, receipt=receipt, now=args.now,
    )
    summary = artifact_summary(findings)

    if args.json:
        print(json.dumps({"findings": findings, "summary": summary}, indent=2, sort_keys=True,
                         default=str))
    else:
        print("APPROVAL ARTIFACT — aukora:approval-receipt:v1")
        print(f"  approvalId          : {findings.get('approvalId')}")
        print(f"  signature           : {findings['signature']['status']} "
              f"(anchor: {findings['anchor']['source']})")
        print(f"  operation binding   : {findings['operation_binding']['status']} "
              f"(derived from the supplied content bytes)")
        print(f"  content canonical   : {findings['content_canonicalization']['status']}")
        print(f"  signed bytes digest : {findings['signed_bytes_digest']['status']}")
        print(f"  record identity     : {findings['record_identity']['status']}")
        print(f"  object digest       : {findings['object_digest']['status']}")
        print(f"  receipt linkage     : {findings['receipt_approval_linkage']['status']}")
        print(f"  window              : {findings['window']['status']}")
        print(f"  classification      : {findings['classification']['status']} (NOT signed)")
        print(f"  authorization       : {findings['authorization']['status']}")
        print(f"  attendance          : {findings['attendance']['status']}")
        print(f"  STATUS: {summary['status']}")
        print(f"  {summary['reason']}")
        for ceiling in findings["ceilings"]:
            print(f"  ceiling: {ceiling.split(':')[0]}")
    # The exit status is the summary's own field: the printed word, the JSON and this status are
    # three renderings of one decision.
    return 1 if summary["fails_verification"] else 0


__all__ = [
    "APPROVAL_RECEIPT_DOMAIN", "RETIRED_BUNDLE_DOMAIN", "OWNER_KEY_SIGNED",
    "APPROVAL_RECEIPT_FIELDS", "APPROVAL_CLASSES", "KEY_CLASSES", "UNSUPPORTED_APPROVAL_CLASS",
    "REQUIRED_ATTENDANCE", "APPROVAL_REQUEST_DOMAIN", "APPROVAL_SIGNATURE_DOMAIN",
    "OPERATION_CONTENT_DOMAIN", "RECEIPT_APPROVAL_FIELDS", "FAILING_STATUSES",
    "MALFORMED", "INPUT_MALFORMED", "CONTENT_MISMATCH", "SUBJECT_MISMATCH",
    "ARTIFACT_INCONSISTENT", "KEY_MISMATCH", "APPROVER_NOT_REGISTERED", "SIGNATURE_INVALID",
    "EXPIRED", "CLASS_UNSUPPORTED", "ATTENDANCE_UNSUPPORTED", "IDENTITY_BOUND_UNSUPPORTED",
    "RECORD_MISMATCH", "OBJECT_MISMATCH", "RECEIPT_LINKAGE_MISMATCH", "RECEIPT_APPROVAL_ABSENT",
    "CONTENT_NOT_CANONICAL", "SIGNATURE_VALID", "BINDING_VERIFIED", "LINKED",
    "AUTHORIZATION_UNCHECKED", "ATTENDANCE", "CEILINGS", "ArtifactRefusal", "base58btc_encode",
    "base58btc_decode", "did_key_from_raw", "raw_from_did_key", "parse_artifact",
    "request_from_artifact", "signing_bytes", "operation_digest_of", "approval_id_of",
    "read_content", "check_receipt_approval_block", "verify_artifact", "artifact_summary", "main",
]


if __name__ == "__main__":
    import sys as _sys

    _sys.exit(main())
