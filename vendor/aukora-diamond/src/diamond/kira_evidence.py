"""Offline consumer for Kira memory-v1 evidence: record, receipt, position, approval.

WHAT THIS IS. One module that answers five SEPARATE questions about a Kira memory-v1
record and the receipt that speaks about it, from public bytes alone, with no network,
no private state and no sibling checkout:

  1. SIGNATURE_AND_CANONICALIZATION — an Ed25519 signature over
     `kind + "\\n" + canonicalJSON(body)` under the key the verification was anchored to,
     plus the audit digest of that canonical body so the exact signed bytes are citable.
  2. ANCHOR — the verification ran under a NAMED anchor the consumer was GIVEN. A receipt
     carries `issuerPk`; that field is a claim, never permission to check itself. If no
     anchor was supplied, or the receipt names a key the anchor does not name, the verdict
     is a named refusal and NO signature work is done. There is no "some key found nearby"
     mode here, and no `--allow-unanchored` escape hatch.
  3. RECORD_IDENTITY_AND_CONTENT_DIGEST — `recordId` and the content digest recomputed from
     the record's own fields, under the producer's domain-separated rule. A record is
     verified only when its own `recordId` recomputes; a digest carried in a wrapper is
     reported as a CLAIM and cross-checked, never believed on its own.
  4. HISTORICAL_POSITION — the receipt speaks about ITS OWN entry, not the log's current
     tip: the Aura chain is recomputed from its bytes, the entry at the receipt's own `seq`
     must carry the receipt's `entryHash`, name the receipt's `recordId`, and link the prior
     head the receipt states. Entries AFTER that position are an extension, not a
     contradiction, so after a second write the FIRST receipt still verifies. A re-signed
     receipt claiming a LATER entry hash while naming the earlier `seq` is refused by
     position, because the position it names does not carry the entry it claims.
  5. OWNER_APPROVAL — an unsigned wrapper is never owner approval. A digest, a label, a
     `grants: false` or a `confirm: true` is data, and this consumer reports
     `OWNER_APPROVAL_UNCHECKED` unless an approval document verifies as a signature over
     the approval it claims, under a SEPARATELY NAMED approval anchor. Nothing in the
     evidence bundle this ships with is an approval, so 5 is `OWNER_APPROVAL_UNCHECKED`.

WHAT THIS MODULE CANNOT ESTABLISH, stated here because a consumer that overclaims is worse
than none: it cannot prevent a global replay (a recorded receipt can be presented again
forever, and nothing here is a nonce book); it cannot establish latestness (a verified
position says the log CONTAINS that entry, never that the log is the tip of the world); it
cannot show that a person was present, that anything happened off-machine, or that a grant
was authorized (the issuer key is read from public evidence, and reading it proves nothing
about who held it); it cannot show the absence of all forks (a fork is a second, internally
consistent log, and this consumer sees only the log it was given); and it cannot establish
that a record was ever written to anybody's durable memory — it verifies bytes.

Evidence never authorizes. Identity never crowns. A signature proves only the claim and the
key actually verified.
"""

from __future__ import annotations

import binascii
import hashlib
import json
import re
from pathlib import Path

# ── vocabulary ───────────────────────────────────────────────────────────────────────────────
#: The Kira record domain. Changing it changes every record identifier.
KIRA_RECORD_DOMAIN = "aukora:kira-memory-record:v0"
#: Grammar of a deterministic Kira record identifier.
KIRA_RECORD_ID = re.compile(r"^kira:[0-9a-f]{64}$")
#: Closed record kinds, restated from the producer's contract.
KIRA_RECORD_KINDS = (
    "observation", "summary", "claim", "preference", "plan", "training-slice", "erasure",
)
#: Closed privacy classes.
KIRA_PRIVACY_CLASSES = ("local", "exportable", "private")
#: The record fields a Kira record carries, at every level of being read.
RECORD_REQUIRED = ("domain", "grantsAuthority", "recordId", "subject", "kind", "source",
                   "content", "links", "privacy", "createdAt")
RECORD_OPTIONAL = ("transform",)
#: The receipt's domain separator; the kind string IS the algorithm binding.
KIRA_RECEIPT_KIND = "aukora-kira-memory-receipt/v1"
KIRA_RECEIPT_REQUIRED = ("kind", "operation", "recordId", "effectDigest", "nonce",
                         "issuedAt", "aura", "sig", "issuerPk")
KIRA_AURA_FIELDS = ("entryHash", "head", "seq", "priorHead")
#: The `approval` block the CURRENT producer writes into the receipt body: the approval that
#: authorized this write, inside the signed bytes. Nine fields, closed.
KIRA_RECEIPT_APPROVAL_FIELDS = ("approvalId", "artifactDomain", "challenge", "subject", "approverDid",
                                "operationDigest", "signature", "approvalClass", "keyClass")
# These are the classes the current producer can actually issue. A carried label is
# not a proof of presence; human-ceremony requires machinery this wire does not have.
KIRA_SUPPORTED_APPROVAL_CLASSES = ("delegated", "scripted", "unattributed")
#: The subject grammar the approval records require. Restated where a receipt's approval block is
#: parsed, so a block naming a subject no approval could carry is refused at the receipt.
_APPROVAL_SUBJECT = re.compile(r"^aukora:1:[0-9a-f]{64}$")
KIRA_OPERATIONS = ("memory.put",)
#: The Aura entry-preimage domain separator, as the producer writes it.
AURA_RECORD_DOMAIN = "aukora:aura-record:v1"
#: The producer's Aura entry preimage fields, MEASURED from the producer's own stored bytes
#: rather than read off a comment. The entry is `{...fields, sequence, prev, hash}` and the
#: hash covers `canonicalJSON({prev, ...fields, domain})` — so the preimage is the four body
#: fields BELOW plus the envelope's `sequence`, `prev` and the domain separator. `sequence` is
#: inside the preimage: an independent reconstruction that omits it reproduces nothing, which
#: is exactly how this list was established.
AURA_ENTRY_FIELDS = ("verdict", "key", "contentSha256", "operation")
ZERO_DIGEST = "0" * 64
#: Spelled once. Every human-facing path prints it.
ATTENDANCE = "reported-not-proven"
#: This cold consumer does not implement ECMAScript number serialization. A numeric
#: value outside its integer profile is unsupported evidence, never guessed bytes.
UNSUPPORTED_NUMBER = "UNSUPPORTED_NUMBER"
_NO_RETAINED_RECEIPT = object()
#: The five separate results, in the order a report must carry them.
FACETS = ("signature_and_canonicalization", "anchor", "record_identity", "historical_position",
          "owner_approval")

#: Names whose presence in a receipt or a wrapper means the document is claiming something
#: this consumer cannot check. Refused by name rather than ignored.
FORBIDDEN_CLAIM_FIELDS = ("alg", "algorithm", "hash", "curve", "owner", "identity", "did",
                          "ownerPk", "ownerPublicKey")


class Refusal(Exception):
    """A named refusal. Every refusal in this module carries one stable code."""

    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


# ── canonicalization (RFC 8785 JCS, this consumer's restricted subset) ──────────────────────

def jcs(value):
    """RFC 8785 JCS, restricted to this consumer's integer number profile.

    Within this subset, objects sort keys by UTF-16 code unit and
    drop nothing a JSON parse can produce; strings are escaped as JSON escapes them with
    raw UTF-8 for everything above the C0 range; and numbers are integers only. Floating
    point is REFUSED rather than re-serialised: an ECMAScript number spelling and a Python
    one are not the same function, and a consumer that guesses would silently disagree with
    the producer about which bytes were signed. Every digest in this module is taken over
    parsed JSON, whose numbers are integers or floats, so the refusal is a closed door and
    not a hole.
    """
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > (1 << 53) - 1:
            raise Refusal(UNSUPPORTED_NUMBER,
                          "integer is outside the exact ECMAScript safe range; "
                          "no numeric rounding or digest is guessed")
        return str(value)
    if isinstance(value, float):
        raise Refusal(UNSUPPORTED_NUMBER,
                      "floating-point is outside this consumer's integer number profile; "
                      "ECMAScript number serialization is unsupported, so no digest is computed")
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(jcs(item) for item in value) + "]"
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str):
                raise Refusal("canonicalization-key-not-string", "object keys must be strings")
        return "{" + ",".join(
            f"{json.dumps(key, ensure_ascii=False)}:{jcs(value[key])}"
            for key in sorted(value, key=_utf16_units)
        ) + "}"
    raise Refusal("canonicalization-unsupported-type",
                  f"unsupported type {type(value).__name__}")


def _utf16_units(text: str):
    """The key order RFC 8785 specifies: UTF-16 code units, not code points."""
    units = []
    for ch in text:
        code = ord(ch)
        if code > 0xFFFF:
            code -= 0x10000
            units.append(0xD800 + (code >> 10))
            units.append(0xDC00 + (code & 0x3FF))
        else:
            units.append(code)
    return tuple(units)


def jcs_bytes(value) -> bytes:
    return jcs(value).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ── the producer's two record digests, restated ──────────────────────────────────────────────

def record_identity(record: dict) -> dict:
    """The exact fields the identifier covers: every record field except `recordId`.

    Built explicitly rather than by filtering, so a field the producer does not hash cannot
    be smuggled into the identifier by arriving in the document. `transform` is included
    only when present, which is the producer's own rule.
    """
    identity = {
        "domain": record["domain"],
        "grantsAuthority": record["grantsAuthority"],
        "subject": record["subject"],
        "kind": record["kind"],
        "source": record["source"],
        "content": record["content"],
        "links": record["links"],
        "privacy": record["privacy"],
        "createdAt": record["createdAt"],
    }
    if "transform" in record:
        identity["transform"] = record["transform"]
    return identity


def compute_record_id(record: dict) -> str:
    """`kira:` + sha256(domain + NUL + canonicalJSON(identity))."""
    digest = hashlib.sha256()
    digest.update(KIRA_RECORD_DOMAIN.encode("utf-8"))
    digest.update(b"\0")
    digest.update(jcs_bytes(record_identity(record)))
    return "kira:" + digest.hexdigest()


def record_digest(record: dict) -> str:
    """sha256 over the canonical JSON of the whole record — the digest a wrapper cites."""
    return sha256_hex(jcs_bytes(record))


def effect_body(record: dict) -> str:
    """The exact memory-put object body: canonical JSON of `{key, value}` plus a newline."""
    return jcs({"key": record["recordId"], "value": record}) + "\n"


def record_content_digest(record: dict) -> str:
    """The content-addressed object digest: sha256 over `effect_body`."""
    return sha256_hex(effect_body(record).encode("utf-8"))


def aura_entry_preimage(prev: str, fields: dict, *, sequence: int) -> str:
    """The exact Aura entry hash preimage, restated from the producer's measured rule.

    The hashed object is `{prev, <body fields>, sequence, domain}`. `sequence` is part of the
    preimage, and this parameter is required rather than defaulted so a caller cannot build a
    preimage that silently omits it.
    """
    return jcs({"prev": prev, **fields, "sequence": sequence, "domain": AURA_RECORD_DOMAIN})


def aura_entry_hash(prev: str, fields: dict, *, sequence: int) -> str:
    return sha256_hex(aura_entry_preimage(prev, fields, sequence=sequence).encode("utf-8"))


# ── Ed25519 (RFC 8032), stdlib only ──────────────────────────────────────────────────────────

_P = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_D = (-121665 * pow(121666, _P - 2, _P)) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _recover_x(y: int) -> int:
    yy = (y * y) % _P
    u = (yy - 1) % _P
    v = (_D * yy + 1) % _P
    x2 = (u * pow(v, _P - 2, _P)) % _P
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0:
        x = (x * _I) % _P
    if (x * x - x2) % _P != 0:
        raise Refusal("ed25519-not-on-curve", "public key is not a curve point")
    return x


_BY = (4 * pow(5, _P - 2, _P)) % _P
_BX = _recover_x(_BY)
if _BX & 1:
    _BX = _P - _BX
_B = (_BX, _BY)


def _edwards_add(p, q):
    x1, y1 = p
    x2, y2 = q
    denom = _D * x1 * x2 * y1 * y2
    x3 = (x1 * y2 + x2 * y1) * pow(1 + denom, _P - 2, _P)
    y3 = (y1 * y2 + x1 * x2) * pow(1 - denom, _P - 2, _P)
    return (x3 % _P, y3 % _P)


def _scalar_mult(point, scalar: int):
    result = (0, 1)
    addend = point
    while scalar > 0:
        if scalar & 1:
            result = _edwards_add(result, addend)
        addend = _edwards_add(addend, addend)
        scalar >>= 1
    return result


def _compress(point) -> bytes:
    x, y = point
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def _decompress(data: bytes):
    if not isinstance(data, bytes) or len(data) != 32:
        raise Refusal("ed25519-point-encoding", "a point must use exactly 32 bytes")
    value = int.from_bytes(data, "little")
    y = value & ((1 << 255) - 1)
    if y >= _P:
        raise Refusal("ed25519-point-encoding", "point coordinate is not canonical")
    x = _recover_x(y)
    if x == 0 and value >> 255:
        raise Refusal("ed25519-point-encoding", "zero x must use the zero sign bit")
    if (x & 1) != (value >> 255):
        x = _P - x
    point = (x, y)
    if _compress(point) != data:
        raise Refusal("ed25519-point-encoding", "point sign is not canonical")
    if _scalar_mult(point, 8) == (0, 1):
        raise Refusal("ed25519-small-order", "small-order points are not accepted")
    return point


def ed25519_verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    """Strict Ed25519: canonical, non-small-order points; malformed data returns False."""
    if not all(isinstance(value, bytes) for value in (public_key, message, signature)):
        return False
    if len(public_key) != 32 or len(signature) != 64:
        return False
    try:
        a = _decompress(public_key)
        r = _decompress(signature[:32])
    except (Refusal, ValueError):
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= _L:
        return False
    digest = hashlib.sha512(signature[:32] + public_key + message).digest()
    challenge = int.from_bytes(digest, "little") % _L
    return _compress(_scalar_mult(_B, s)) == _compress(_edwards_add(r, _scalar_mult(a, challenge)))


def raw_public_key_bytes(text: str) -> bytes:
    """Read a public key from the two public spellings the producer and the toy use.

    A PEM SubjectPublicKeyInfo with an Ed25519 OID, or 64 lowercase hex characters. The
    trailing 32 bytes of the SPKI DER are the raw key, and the OID is checked so a 32-byte
    tail of some other key type cannot pass for an Ed25519 key.
    """
    if not isinstance(text, str) or text.strip() == "":
        raise Refusal("anchor-unreadable", "an anchor must name a public key")
    body = text.strip()
    if body.startswith("-----BEGIN PUBLIC KEY-----"):
        lines = [line for line in body.splitlines() if not line.startswith("-----")]
        try:
            der = binascii.a2b_base64("".join(lines))
        except (binascii.Error, ValueError) as exc:
            raise Refusal("anchor-unreadable", f"PEM body is not base64: {exc}") from exc
        # Ed25519 SubjectPublicKeyInfo: 30 2a 30 05 06 03 2b 65 70 03 21 00 || 32 bytes
        prefix = bytes.fromhex("302a300506032b6570032100")
        if not der.startswith(prefix) or len(der) != len(prefix) + 32:
            raise Refusal("anchor-not-ed25519",
                          "SPKI does not carry an Ed25519 public key")
        return der[len(prefix):]
    if re.fullmatch(r"[0-9a-f]{64}", body):
        return bytes.fromhex(body)
    if re.fullmatch(r"[0-9A-F]{64}", body):
        # Refused rather than lowered: two spellings of one key must not diverge.
        raise Refusal("anchor-unreadable", "hex anchor must be lowercase")
    raise Refusal("anchor-unreadable", "anchor is neither an Ed25519 SPKI PEM nor 32 hex bytes")


def public_key_hex(raw: bytes) -> str:
    return raw.hex()


# ── strict reading helpers ───────────────────────────────────────────────────────────────────

def read_json_strict(path: Path):
    """Parse one JSON document, refusing a duplicate key rather than keeping the last."""
    text = path.read_text(encoding="utf-8")
    return _loads_no_duplicates(text, path.name)


def _loads_no_duplicates(text: str, label: str):
    def hook(pairs):
        seen = set()
        for key, _ in pairs:
            if key in seen:
                raise Refusal("json-duplicate-key", f"{label} repeats the key {key!r}")
            seen.add(key)
        return dict(pairs)

    try:
        return json.loads(text, object_pairs_hook=hook)
    except Refusal:
        raise
    except ValueError as exc:
        raise Refusal("json-unparseable", f"{label} is not JSON: {exc}") from exc


def require_mapping(value, label: str) -> dict:
    if not isinstance(value, dict):
        raise Refusal("shape", f"{label} must be a JSON object")
    return value


def require_closed(obj: dict, required, optional, label: str) -> None:
    missing = [name for name in required if name not in obj]
    if missing:
        raise Refusal("shape", f"{label} is missing {missing}")
    unknown = [name for name in obj if name not in required and name not in optional]
    if unknown:
        raise Refusal("shape", f"{label} carries unknown field(s) {sorted(unknown)}")


def require_hex64(value, label: str) -> str:
    """One 32-byte hex digest, lowercase, exactly as the digests in these documents are."""
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise Refusal("shape", f"{label} must be 64 lowercase hex characters")
    return value


def require_hex_bytes(value, nbytes: int, label: str) -> str:
    """A lowercase hex string of exactly `nbytes` bytes."""
    expected = nbytes * 2
    if not isinstance(value, str) or len(value) != expected or any(
            ch not in "0123456789abcdef" for ch in value):
        raise Refusal("shape", f"{label} must be {expected} lowercase hex characters "
                               f"({nbytes} bytes)")
    return value


# ── the five facets ──────────────────────────────────────────────────────────────────────────

def check_record(document) -> dict:
    """Facet 3: the record's own identity. The record is verified from its own fields."""
    record = require_mapping(document, "record")
    for name in FORBIDDEN_CLAIM_FIELDS:
        if name in record:
            raise Refusal("shape", f"record carries a forbidden field `{name}`")
    require_closed(record, RECORD_REQUIRED, RECORD_OPTIONAL, "record")
    if record.get("domain") != KIRA_RECORD_DOMAIN:
        raise Refusal("record-domain-mismatch",
                      f"domain is {record.get('domain')!r}, not {KIRA_RECORD_DOMAIN!r}")
    if record.get("grantsAuthority") is not False:
        # A record that claims authority is not a record this consumer will verify.
        raise Refusal("shape", "record must carry grantsAuthority:false — records never authorize")
    if not isinstance(record.get("recordId"), str) or not KIRA_RECORD_ID.match(record["recordId"]):
        raise Refusal("shape", "record.recordId must be `kira:` + 64 lowercase hex characters")
    if record.get("kind") not in KIRA_RECORD_KINDS:
        raise Refusal("shape", f"record.kind must be one of {list(KIRA_RECORD_KINDS)}")
    if record.get("privacy") not in KIRA_PRIVACY_CLASSES:
        raise Refusal("shape", f"record.privacy must be one of {list(KIRA_PRIVACY_CLASSES)}")
    if not isinstance(record.get("subject"), str) or record["subject"] == "":
        raise Refusal("shape", "record.subject must be a non-empty string")
    if not isinstance(record.get("createdAt"), str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", record["createdAt"]):
        raise Refusal("shape", "record.createdAt must be a canonical seconds-precision UTC instant")

    recomputed = compute_record_id(record)
    digest = record_digest(record)
    content = record_content_digest(record)
    verified = recomputed == record["recordId"]
    return {
        "verified": verified,
        "claimedRecordId": record["recordId"],
        "recomputedRecordId": recomputed,
        "recordDigest": digest,
        "contentDigest": content,
        "identityRule": "sha256(domain || NUL || canonicalJSON(identity)) with identity = every "
                        "record field except recordId",
        "reason": None if verified else "record.recordId does not recompute from the record's "
                                        "own fields",
    }


def check_receipt(document, *, anchor_raw: bytes | None) -> dict:
    """Facets 1 and 2: structure, named anchor, then signature over the canonical body.

    Structure is checked before any signature work, and the anchor is checked before the
    signature: an unanchored document is refused by name rather than verified against the
    key it carries.

    TWO CLOSED PROFILES, ONE KIND. The producer added the `approval` block to the SAME
    `aukora-kira-memory-receipt/v1` body without relabelling the kind, so this consumer accepts
    exactly two shapes and names which one it saw:

        legacy-no-approval      every store that predates owner approval, and every receipt in the
                                committed legacy bundle
        current-with-approval   the current producer's receipt, whose `approval` block is INSIDE the
                                signed body and therefore covered by the signature

    The sets are CLOSED individually — `{...legacy, approval}` is not "legacy plus anything". A
    consumer that widened the old set by one optional field would accept a receipt with a field
    nobody agreed to, and the difference between "the producer added a signed block" and "someone
    appended a claim" would be invisible.
    """
    receipt = require_mapping(document, "receipt")
    for name in FORBIDDEN_CLAIM_FIELDS:
        if name in receipt:
            raise Refusal("receipt-forbidden-field",
                          f"receipt carries a forbidden `{name}` field — the kind string is the "
                          "algorithm binding, and identity never crowns")
    if "approval" in receipt:
        profile, required = "current-with-approval", KIRA_RECEIPT_REQUIRED + ("approval",)
    else:
        profile, required = "legacy-no-approval", KIRA_RECEIPT_REQUIRED
    require_closed(receipt, required, (), "receipt")
    if receipt["kind"] != KIRA_RECEIPT_KIND:
        raise Refusal("receipt-kind", f"kind is {receipt['kind']!r}, not {KIRA_RECEIPT_KIND!r}")
    if receipt["operation"] not in KIRA_OPERATIONS:
        raise Refusal("shape", f"operation must be one of {list(KIRA_OPERATIONS)}")
    require_hex64(receipt["effectDigest"], "receipt.effectDigest")
    require_hex_bytes(receipt["sig"], 64, "receipt.sig")
    if isinstance(receipt["issuedAt"], bool) or not isinstance(receipt["issuedAt"], int):
        raise Refusal("shape", "receipt.issuedAt must be an integer")
    if not isinstance(receipt["nonce"], str) or receipt["nonce"] == "":
        raise Refusal("shape", "receipt.nonce must be a non-empty string")
    if not KIRA_RECORD_ID.match(str(receipt["recordId"])):
        raise Refusal("shape", "receipt.recordId must be `kira:` + 64 lowercase hex characters")

    aura = require_mapping(receipt["aura"], "receipt.aura")
    require_closed(aura, KIRA_AURA_FIELDS, (), "receipt.aura")
    require_hex64(aura["entryHash"], "receipt.aura.entryHash")
    require_hex64(aura["head"], "receipt.aura.head")
    if isinstance(aura["seq"], bool) or not isinstance(aura["seq"], int) or aura["seq"] < 1:
        raise Refusal("shape", "receipt.aura.seq must be a positive integer")
    if aura["head"] != aura["entryHash"]:
        raise Refusal("shape", "receipt.aura.head must equal receipt.aura.entryHash at issue")
    if aura["priorHead"] is not None:
        require_hex64(aura["priorHead"], "receipt.aura.priorHead")

    if profile == "current-with-approval":
        # The block's own shape is checked HERE. Whether it names the artifact the caller holds is a
        # DIFFERENT question, asked by the approval-artifact lane: a receipt can be internally
        # well-formed and still name an approval that is not the one presented.
        block = require_mapping(receipt["approval"], "receipt.approval")
        require_closed(block, KIRA_RECEIPT_APPROVAL_FIELDS, (), "receipt.approval")
        for name in ("approvalId", "challenge", "operationDigest"):
            require_hex64(block[name], f"receipt.approval.{name}")
        require_hex_bytes(block["signature"], 64, "receipt.approval.signature")
        if block["artifactDomain"] != "aukora:approval-receipt:v1":
            raise Refusal("receipt-approval-malformed",
                          f"receipt.approval.artifactDomain is {block['artifactDomain']!r}, not the "
                          "flat approval artifact this producer writes")
        if not isinstance(block["subject"], str) or block["subject"] != receipt_subject_shape(block["subject"]):
            raise Refusal("receipt-approval-malformed",
                          "receipt.approval.subject must use the aukora:1:<sha256> form")
        if not isinstance(block["approverDid"], str) or not block["approverDid"].startswith("did:key:"):
            raise Refusal("receipt-approval-malformed",
                          "receipt.approval.approverDid must be a did:key identifier")
        for name in ("approvalClass", "keyClass"):
            if not isinstance(block[name], str) or block[name] == "":
                raise Refusal("receipt-approval-malformed",
                              f"receipt.approval.{name} must be a non-empty string")
        _check_receipt_approval_class(block["approvalClass"])

    # ── the anchor, BEFORE any signature work ───────────────────────────────────────────────
    if anchor_raw is None:
        raise Refusal("anchor-absent",
                      "no issuer anchor was supplied; a receipt's own issuerPk is a claim, and "
                      "this consumer has no unanchored mode")
    try:
        named_raw = raw_public_key_bytes(receipt["issuerPk"])
    except Refusal as exc:
        raise Refusal("receipt-issuerPk-unreadable",
                      f"receipt.issuerPk could not be read: {exc.detail}") from exc
    if named_raw != anchor_raw:
        raise Refusal("anchor-mismatch",
                      f"receipt names issuer {public_key_hex(named_raw)[:16]}… but the anchor is "
                      f"{public_key_hex(anchor_raw)[:16]}… — verification is refused rather than "
                      "attempted against a key found nearby")

    # The signed body is every required field except `sig` and `issuerPk` — WHICH IS WHY THE PROFILE
    # MATTERS: on a current receipt the approval block is inside these bytes, so editing it breaks
    # the signature, and on a legacy receipt those bytes are exactly what they always were.
    body = {name: receipt[name] for name in required if name not in ("sig", "issuerPk")}
    signed_bytes = f"{receipt['kind']}\n".encode("utf-8") + jcs_bytes(body)
    valid = ed25519_verify(anchor_raw, signed_bytes, bytes.fromhex(receipt["sig"]))
    return {
        "verified": bool(valid),
        "anchor": public_key_hex(anchor_raw),
        "anchorSource": "supplied by the consumer (public key file), never read from the receipt",
        "receiptProfile": profile,
        "signedBodyFields": list(body),
        "carriesApprovalBlock": profile == "current-with-approval",
        "signedBodyDigest": sha256_hex(signed_bytes),
        "signedBodyCanonical": jcs(body),
        "reason": None if valid else "the signature does not verify under the named anchor",
    }


def receipt_subject_shape(value: str) -> str:
    """The subject the approval artifact's grammar requires, or a named refusal."""
    if not isinstance(value, str) or not _APPROVAL_SUBJECT.match(value):
        raise Refusal("receipt-approval-malformed",
                      "receipt.approval.subject must use the aukora:1:<sha256> form")
    return value


def _check_receipt_approval_class(value: str) -> None:
    """The receipt-only path cannot admit a class its producer/artifact path refuses."""
    if value == "human-ceremony":
        raise Refusal("APPROVAL_CLASS_UNSUPPORTED",
                      "receipt.approval.approvalClass=human-ceremony requires an enrolment "
                      "ceremony this producer does not support; a signed label is not attendance")
    if value not in KIRA_SUPPORTED_APPROVAL_CLASSES:
        raise Refusal("receipt-approval-malformed",
                      "receipt.approval.approvalClass is not a supported producer class: "
                      f"{value!r}")


def read_log(path: Path) -> list:
    """Read one Aura JSONL log. Refuses truncation, unparseable lines and duplicate keys."""
    if not path.exists():
        raise Refusal("log-missing", f"no Aura log at {path}")
    text = path.read_text(encoding="utf-8")
    if text == "":
        return []
    if not text.endswith("\n"):
        raise Refusal("log-truncated", "the Aura log does not end in a newline")
    entries = []
    for number, line in enumerate(text[:-1].split("\n"), start=1):
        entry = _loads_no_duplicates(line, f"aura entry {number}")
        if not isinstance(entry, dict):
            raise Refusal("log-unparseable", f"aura entry {number} is not an object")
        # A line whose re-serialisation differs is not the bytes that were stored: it is a
        # decoy spelling (escapes, duplicate keys, a normalised form) that a reader could
        # take for the entry while the hash covers something else.
        if json.dumps(entry, ensure_ascii=False, separators=(",", ":")) != line:
            raise Refusal("log-not-roundtrip",
                          f"aura entry {number} does not re-serialise to the bytes on disk")
        entries.append(entry)
    return entries


def verify_chain(entries: list, upto: int) -> dict:
    """Recompute the Aura chain from its own bytes, over the prefix ending at `upto`.

    The check does not call the writer's arithmetic and agree with itself: it rebuilds the
    preimage text from the named rule, hashes THAT, and compares. A drift between the rule
    and the bytes on disk is a refusal here, not a silent agreement.
    """
    prev = AURA_RECORD_DOMAIN
    for index, entry in enumerate(entries[:upto], start=1):
        if type(entry.get("sequence")) is not int or entry["sequence"] != index:
            raise Refusal("chain-sequence",
                          f"aura entry {index} carries sequence {entry.get('sequence')!r}")
        if entry.get("prev") != prev:
            raise Refusal("chain-broken-link", f"aura entry {index} does not link its predecessor")
        missing = [name for name in AURA_ENTRY_FIELDS if name not in entry]
        if missing:
            raise Refusal("chain-entry-shape", f"aura entry {index} is missing {missing}")
        fields = {name: entry[name] for name in AURA_ENTRY_FIELDS}
        if entry.get("hash") != aura_entry_hash(prev, fields, sequence=index):
            raise Refusal("chain-tampered", f"aura entry {index} does not hash to its own bytes")
        prev = entry["hash"]
    return {"ok": True, "head": prev, "verifiedEntries": min(upto, len(entries))}


def check_position(receipt: dict, entries: list, *, store=None, record: dict | None = None) -> dict:
    """Facet 4: the receipt's claim about its OWN historical position in the log.

    The prefix ending at the receipt's own `seq` must recompute, and the entry at that
    position must carry the receipt's `entryHash`, name the receipt's `recordId`, and link
    the prior head the receipt states. Entries after the position are reported as an
    extension: a longer log is not a contradiction of an earlier claim, which is exactly
    why the first receipt must keep verifying after a second write.
    """
    aura = receipt["aura"]
    seq = aura["seq"]
    if seq > len(entries):
        # Checked BEFORE the chain walk: a position the log does not hold is the fact worth
        # naming, and reporting a chain result computed over a prefix that cannot contain the
        # claimed entry would be a verdict about a different question.
        raise Refusal("position-absent",
                      f"the log holds {len(entries)} entries and the receipt names position {seq}")
    chain = verify_chain(entries, seq)
    entry = entries[seq - 1]
    if entry["hash"] != aura["entryHash"]:
        raise Refusal("position-mismatch",
                      f"position {seq} carries entry {entry['hash'][:16]}…, and the receipt claims "
                      f"{aura['entryHash'][:16]}…")
    if entry["key"] != receipt["recordId"]:
        raise Refusal("position-record-mismatch",
                      f"position {seq} names record {entry['key']}, and the receipt names "
                      f"{receipt['recordId']}")

    # The no-predecessor spellings are closed and NAMED: `null` (Kira's own spelling in the
    # log link field and in the receipt), the Aura preimage domain separator, and the zero
    # digest (the sibling kind's spelling). Anything else must match the log exactly.
    def no_predecessor(value):
        return value in (None, ZERO_DIGEST, AURA_RECORD_DOMAIN)

    log_prior = entry.get("prev")
    expected_prior = None if no_predecessor(log_prior) else log_prior
    stated_prior = aura["priorHead"]
    if no_predecessor(stated_prior):
        stated_prior = None
    if stated_prior != expected_prior:
        raise Refusal("position-prior-head-mismatch",
                      f"position {seq} links prior head {log_prior!r}, and the receipt states "
                      f"{aura['priorHead']!r}")

    # Bind all three views before the optional store check. Naming a store must
    # add object-byte evidence, never remove receipt/log/record consistency.
    content_sha = require_hex64(entry["contentSha256"], "aura.contentSha256")
    if receipt["effectDigest"] != content_sha:
        raise Refusal("effect-digest-mismatch",
                      "the receipt and its Aura entry name different content digests")
    if record is not None and record_content_digest(record) != content_sha:
        raise Refusal("effect-digest-mismatch",
                      "the receipt and Aura entry name content the record does not reproduce")

    result = {
        "verified": True,
        "position": seq,
        "positionEntryHash": entry["hash"],
        "positionPriorHead": log_prior,
        "logLength": len(entries),
        "logHead": chain["head"],
        "isLogTip": True,
        "entriesAfterPosition": len(entries) - seq,
        "reason": None,
    }
    # The object bytes, when a store was supplied: existence is not evidence, the bytes
    # must hash to the digest the receipt names and the record inside must re-stage.
    if store is not None:
        object_path = Path(store) / "objects" / f"{content_sha}.json"
        if not object_path.exists():
            raise Refusal("object-missing",
                          f"the object the receipt names is not in the store: {object_path.name}")
        raw = object_path.read_bytes()
        if sha256_hex(raw) != content_sha:
            raise Refusal("object-tampered", "the object bytes do not hash to the named digest")
        if record is not None:
            if raw.decode("utf-8") != effect_body(record):
                raise Refusal("object-record-mismatch",
                              "the stored object is not the canonical body of this record")
        result["objectBytes"] = len(raw)
        result["objectDigest"] = content_sha
    # `isLogTip` is a fact about the log IN HAND, and it is named as such: the consumer may
    # report that this entry is the tip of the log it was given, and may never report that it
    # is the tip of every log.
    result["isLogTip"] = len(entries) == seq
    return result


def check_approval(wrapper, *, approval=None, approval_anchor_raw: bytes | None = None) -> dict:
    """Facet 5: owner approval, refused by default and never upgraded by data.

    An unsigned wrapper is NOT approval. `authority.grants`, `fixtureOnly`, `confirm: true`,
    a digest, an identity label and a `subjectControlDigest` are all data that a wrapper can
    assert about itself; none of them is a signature, and none of them is read as approval
    here. The only path to anything other than `OWNER_APPROVAL_UNCHECKED` is an approval
    document that verifies as a signature over the approval it claims, under a SEPARATELY
    NAMED approval anchor — and this consumer does not ship one.
    """
    observed = []
    if wrapper is not None:
        wrapped = require_mapping(wrapper, "wrapper")
        authority = wrapped.get("authority")
        if isinstance(authority, dict):
            observed.append({"field": "authority.grants", "value": authority.get("grants")})
            for name in ("note", "fixtureOnly"):
                if name in authority:
                    observed.append({"field": f"authority.{name}", "value": authority[name]})
        for name in ("fixtureOnly", "confirm", "approval"):
            if name in wrapped:
                observed.append({"field": name, "value": wrapped[name]})
        operation = wrapped.get("operation")
        if isinstance(operation, dict) and "subjectControlDigest" in operation:
            observed.append({"field": "operation.subjectControlDigest",
                             "value": operation["subjectControlDigest"]})
    if approval is not None:
        # A named approval document was supplied. It is only approval if it verifies as a
        # signature over the approval it claims under the anchor this consumer was given.
        if approval_anchor_raw is None:
            raise Refusal("approval-anchor-absent",
                          "an approval document was supplied without a separately named approval "
                          "anchor; it is not read as approval")
        # No approval format is shipped in this bundle, and inventing one here would be the
        # overclaim this facet exists to prevent. A supplied document is therefore refused.
        raise Refusal("approval-format-unknown",
                      "no approval document format is defined for this consumer, so a supplied "
                      "document is refused rather than interpreted")
    return {
        "status": "OWNER_APPROVAL_UNCHECKED",
        "checked": False,
        "reason": "no owner approval document was present and verifiable: the evidence bundle "
                  "carries an unsigned wrapper, and an unsigned wrapper never upgrades legacy "
                  "evidence into owner approval",
        "observedClaimsNotApproval": observed,
        "canBeUpgradedBy": "only a signature over the claimed approval, verified under a "
                           "separately named approval anchor",
    }


def retention_scope(*, supplied=False) -> dict:
    """A known prefix can detect rollback relative to that observation, not latestness.

    The optional anchor is a caller-retained Kira receipt, not the distinct Aura
    Merkle checkpoint or Diamond toy checkpoint profile. Never discover it in a
    producer wrapper or trust a checkpoint supplied by the same untrusted bundle.
    """
    return {"status": "NOT_CHECKED" if supplied else "NOT_SUPPLIED",
            "anchorSource": "SUPPLIED" if supplied else "NONE",
            "checkpointProfile": "aukora-kira-memory-receipt/v1" if supplied else None,
            "verifiedPrefixThrough": None, "entryHash": None,
            "completeness": "UNDETERMINED", "latestness": "NO_LATESTNESS"}


def check_retained_receipt(document, entries, *, anchor_raw) -> dict:
    """Check a separately retained, signed historical position against this log.

    Reuses the Kira receipt wire and the caller's expected issuer key. Matching
    it proves this log includes that supplied prefix, not the history after it,
    independent custody, or completeness. No receipt is minted or authorized.
    """
    try:
        signed = check_receipt(document, anchor_raw=anchor_raw)
    except Refusal as exc:
        raise Refusal("RETAINED_CHECKPOINT_INVALID", f"{exc.code}: {exc.detail}") from exc
    if not signed["verified"]:
        raise Refusal("RETAINED_CHECKPOINT_SIGNATURE_INVALID", signed["reason"])
    seq = document["aura"]["seq"]
    if seq > len(entries):
        raise Refusal("RETAINED_CHECKPOINT_TRUNCATED",
                      f"supplied checkpoint retains position {seq}; this log has {len(entries)}")
    try:
        position = check_position(document, entries)
    except Refusal as exc:
        raise Refusal("RETAINED_CHECKPOINT_CONFLICT", f"{exc.code}: {exc.detail}") from exc
    result = retention_scope(supplied=True)
    result.update(status="SUPPLIED_PREFIX_MATCH", verifiedPrefixThrough=seq,
                  entryHash=position["positionEntryHash"])
    return result


# ── the published ceilings ───────────────────────────────────────────────────────────────────

CEILINGS = (
    "NO_CELL_EXECUTION_PROOF: receipt verification checks signed bytes, not which program "
    "produced them. A module digest or identical proposal bytes cannot establish cell execution.",
    "NO_GLOBAL_REPLAY_PREVENTION: a recorded receipt can be presented again forever. Nothing "
    "here is a nonce book, and no check in this module can show a document is being presented "
    "for the first time.",
    "NO_LATESTNESS: a verified position shows the log CONTAINS that entry. It never shows the "
    "log is the tip of the world, or that no later entry exists elsewhere. A supplied retained "
    "receipt can detect truncation relative to its prefix, never establish completeness.",
    "NO_HUMAN_ATTENDANCE: nothing here can show a person was present, that a grant was "
    "authorized, or that any effect happened off-machine. The issuer key is read from public "
    "evidence; reading it proves nothing about who held it.",
    "NO_ABSENCE_OF_FORKS: a fork is a second, internally consistent log. This consumer sees "
    "only the log it was given, so it cannot show that no other log exists, and anyone who can "
    "rewrite a log can recompute every hash in it.",
    "NO_WRITE_CLAIM: verifying these bytes does not show the record is in anybody's durable "
    "memory, and does not show it was ever recalled.",
    "REPORTED_NOT_PROVEN_ATTENDANCE: " + ATTENDANCE,
    "SAME_UID_ISSUER: the issuer key is a locally generated test key published WITH the "
    "evidence, so the anchor proves the pointer to that key and nothing about who held it.",
    "EVIDENCE_NEVER_AUTHORIZES: a verified record and a verified receipt authorize nothing. "
    "Owner approval is a separate facet and it is UNCHECKED here.",
)


def execution_scope() -> dict:
    """Check-18: neither successful verification nor a carried claim proves execution.

    Not derived from evidence-controlled fields. None means unestablished, not that a cell
    did not run. Current receipt profiles still refuse unknown moduleSha256 fields; accepting
    a future signed field requires an explicit contract change, not an optional-field escape.
    """
    return {"status": "NOT_ESTABLISHED", "cellRan": None,
            "reason": "cold verification checks bytes, not their execution provenance"}


def authority_scope(receipt_document=None) -> dict:
    """Report only an existing receipt label, never a proof mode or human presence.

    The source wire has approvalClass, not an exportable approval-mode proof. This
    report is deliberately valid even on a refused signature: '-reported' means
    carried by the input, not verified. Wrapper prose and Alpha's incompatible
    approval.mode/authority/operatorPresence fields cannot upgrade it.
    """
    block = receipt_document.get("approval") if isinstance(receipt_document, dict) else None
    value = block.get("approvalClass") if isinstance(block, dict) else None
    reported = value if isinstance(value, str) else None
    mode = f"{reported}-reported" if reported in KIRA_SUPPORTED_APPROVAL_CLASSES else "mode-unbound"
    return {"mode": mode, "reportedApprovalClass": reported,
            "operatorPresence": "NOT_ESTABLISHED", "attendance": ATTENDANCE,
            "reason": "approval class is reported from receipt bytes; proof mode and human "
                      "presence are not established by cold verification"}


def verify_evidence(
    *,
    record_document,
    receipt_document,
    log_path,
    anchor_raw: bytes | None,
    wrapper=None,
    store=None,
    approval=None,
    approval_anchor_raw: bytes | None = None,
    anchor_detail: str | None = None,
    retained_receipt_document=_NO_RETAINED_RECEIPT,
) -> dict:
    """Verify one record and one receipt against the log and the named anchor.

    Returns a report with the five facets kept separate, a named refusal on failure, and the
    ceilings attached on every path — accepted and refused alike. It never raises for bad
    evidence; a named refusal comes back as `verified: False` with `refusal.code`.
    """
    report = {
        "record": None, "receipt": None, "position": None, "approval": None,
        "receiptProfile": None, "receiptApprovalBlock": None,
        "execution": execution_scope(),
        "authorityScope": authority_scope(receipt_document),
        "retention": retention_scope(supplied=retained_receipt_document is not _NO_RETAINED_RECEIPT),
        "verified": False, "status": "REFUSED", "refusal": None,
        "attendance": ATTENDANCE, "ceilings": list(CEILINGS),
    }
    try:
        report["record"] = check_record(record_document)
        if not report["record"]["verified"]:
            raise Refusal("record-identity-mismatch", report["record"]["reason"])
        if anchor_raw is None and anchor_detail is not None:
            # The caller HAD an anchor and it could not be read. Reporting that as "no anchor
            # was supplied" would erase the difference between being given nothing and being
            # given something unusable, so the reading failure is reported verbatim.
            raise Refusal("anchor-unreadable", anchor_detail)
        report["receipt"] = check_receipt(receipt_document, anchor_raw=anchor_raw)
        # The profile is a FACT ABOUT THE RECEIPT (which closed shape it is), reported beside the
        # verdict so a reader can tell a legacy receipt from a current one without guessing.
        report["receiptProfile"] = report["receipt"]["receiptProfile"]
        if isinstance(receipt_document, dict) and "approval" in receipt_document:
            report["receiptApprovalBlock"] = receipt_document["approval"]
        if not report["receipt"]["verified"]:
            raise Refusal("signature-invalid", report["receipt"]["reason"])
        if receipt_document["recordId"] != record_document["recordId"]:
            raise Refusal("receipt-record-mismatch",
                          "the receipt speaks about a different record than the one supplied")
        entries = read_log(Path(log_path))
        report["position"] = check_position(receipt_document, entries, store=store,
                                            record=record_document)
        if retained_receipt_document is not _NO_RETAINED_RECEIPT:
            report["retention"] = check_retained_receipt(retained_receipt_document, entries,
                                                         anchor_raw=anchor_raw)
        report["approval"] = check_approval(wrapper, approval=approval,
                                            approval_anchor_raw=approval_anchor_raw)
        if record_document["recordId"] != receipt_document["recordId"]:
            raise Refusal("receipt-record-mismatch", "record and receipt disagree on the record")
        report["verified"] = True
        report["status"] = "VERIFIED"
    except Refusal as refusal:
        if refusal.code.startswith("RETAINED_CHECKPOINT_"):
            report["retention"]["status"] = refusal.code
        if refusal.code == UNSUPPORTED_NUMBER:
            report["status"] = "UNSUPPORTED"
        report["refusal"] = {"code": refusal.code, "detail": refusal.detail}
        if report["approval"] is None:
            # Facet 5 is a FACT ABOUT THE EVIDENCE, not a step that can be skipped because an
            # earlier facet failed. A refusal never implies approval.
            try:
                report["approval"] = check_approval(wrapper)
            except Refusal as nested:
                report["approval"] = {"status": "OWNER_APPROVAL_UNCHECKED", "checked": False,
                                      "reason": nested.detail, "observedClaimsNotApproval": []}
    return report


def cross_check_wrapper(wrapper, record_document, receipt_document) -> dict:
    """Cross-check the digests a wrapper CLAIMS against the record's own bytes.

    A wrapper's `record.digest` and `record.recordId` are claims; they are believed only
    where they agree with what the record recomputes. A disagreement is reported, and a
    wrapper that carries no record block is reported as carrying none — never as agreeing.
    """
    if wrapper is None:
        return {"present": False, "agrees": None,
                "reason": "no wrapper was supplied; nothing is claimed on its behalf"}
    wrapped = require_mapping(wrapper, "wrapper")
    claimed = wrapped.get("record")
    if not isinstance(claimed, dict):
        return {"present": True, "agrees": None,
                "reason": "the wrapper carries no record block"}
    try:
        digest = record_digest(record_document)
    except Refusal as refusal:
        # Reporting a wrapper must not repeat a failed canonicalization outside the
        # verifier's refusal boundary. No computable digest means no agreement result;
        # the caller retains the primary evidence verdict and its ceilings.
        return {"present": True, "agrees": None,
                "status": "UNSUPPORTED" if refusal.code == UNSUPPORTED_NUMBER else "REFUSED",
                "claimedRecordId": claimed.get("recordId"), "claimedDigest": claimed.get("digest"),
                "recomputedRecordId": None, "recomputedDigest": None,
                "refusal": {"code": refusal.code, "detail": refusal.detail},
                "reason": "wrapper claims could not be compared: " + refusal.detail}
    out = {"present": True, "agrees": True, "claimedRecordId": claimed.get("recordId"),
           "claimedDigest": claimed.get("digest"),
           "recomputedRecordId": record_document["recordId"],
           "recomputedDigest": digest}
    problems = []
    if claimed.get("recordId") != record_document["recordId"]:
        problems.append("wrapper.record.recordId disagrees with the record")
    if claimed.get("digest") != out["recomputedDigest"]:
        problems.append("wrapper.record.digest disagrees with the canonical record bytes")
    if claimed.get("domain") not in (None, record_document["domain"]):
        problems.append("wrapper.record.domain disagrees with the record")
    if receipt_document is not None and claimed.get("digest") != receipt_document["effectDigest"]:
        # Not a refusal by itself: the two digests are different functions of the same bytes.
        problems.append("wrapper.record.digest is not the receipt's effectDigest (different "
                        "functions of the same bytes — reported, not treated as a failure)")
    out["agrees"] = not any("disagrees" in problem for problem in problems)
    out["problems"] = problems
    return out
