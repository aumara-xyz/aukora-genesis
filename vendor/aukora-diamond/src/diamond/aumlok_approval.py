"""Offline verification of one Aumlok owner-approval, beside the Kira evidence consumer.

The signed bytes are `aukora:owner-approval-signature:v1` + NUL + canonicalJSON(request), where the
request is the closed record Genesis's `owner-approval.mjs` freezes. Structural validation MIRRORS
the producer, on both sides of the exchange: 64-lowercase-hex digests, an `aukora:1:<sha256>`
subject, non-negative safe integers, `expiresAt > issuedAt`, a 128-hex signature, a refusal atom of
at most 128 BYTES, `challenge: null` permitted in a refusal, the response domain checked in both
shapes, and every record closed.

WHICH REFUSAL NAMES ARE WHOSE. Two of them are the producer's own strings, kept byte-for-byte so a
caller can match one vocabulary across both codebases: `aumlok:approval-malformed` and
`aumlok:approval-challenge-mismatch`. The rest are this verifier's, because the producer has no
code for the condition: `aumlok:anchor-from-document` (a document carrying its own key — the
producer's key is registered, not carried) and `aumlok:unsigned-wrapper-claims-attendance` (no
signature could have made an unsigned wrapper field true).

ONE ASYMMETRY THAT CANNOT BE CLOSED FROM PARSED JSON, written down rather than hidden: the
producer's `readNonNegativeInteger` refuses `-0` via `Object.is`, and JSON.parse preserves that
sign, while Python's `json` reads `-0` as `0`. A document this verifier sees therefore cannot be
distinguished on that one point — and a request the producer minted cannot contain it.

FIVE FINDINGS, KEPT SEPARATE — this is the point of the module:

  A. SIGNATURE VALIDITY         the signature verifies over the reconstructed preimage under the
                                anchor the CALLER supplied, never a key from the document.
  B. CALLER DIGEST EQUALITY     whether the signed `operationDigest` equals a digest the caller
                                passed in. Equality is all it is: the caller supplied both sides of
                                the comparison, so it is NOT evidence about any operation.
  C. MEMORY-OPERATION BINDING   always `OPERATION_BINDING_UNVERIFIED` today. Binding needs Diamond
                                to DERIVE the digest from the agreed producer operation bytes, and
                                no such derivation exists. It is not inferred, and B is never
                                reported as if it were C.
  D. AUTHORIZATION              `OWNER_APPROVAL_UNCHECKED`. Approval is evidence; evidence never
                                authorizes.
  E. ATTENDANCE                 `reported-not-proven`, always. An unsigned wrapper field claiming
                                attendance is REFUSED by name and fails the exit status: a
                                signature proves a key signed, not that a person was present.

ONE SUMMARY DECIDES, so nothing can drift. `approval_summary` derives a single status word, reason
and refusal from those five findings, and the printed text, the JSON report and the process exit
status are its three renderings. A VALID SIGNATURE IS NOT SUFFICIENT FOR PASSING: a signature over
a digest other than the one the caller supplied, and an unsigned attendance claim, are each
failures with their own names. No path prints reassuring prose about a signature that did not
verify.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Optional

from diamond.jcs import canonicalize_bytes

APPROVAL_REQUEST_DOMAIN = "aukora:owner-approval-request:v1"
APPROVAL_RESPONSE_DOMAIN = "aukora:owner-approval-response:v1"
APPROVAL_SIGNATURE_DOMAIN = "aukora:owner-approval-signature:v1"

APPROVAL_REQUEST_FIELDS = (
    "domain", "subject", "activeControlDigest", "operationDigest", "challenge", "issuedAt", "expiresAt",
)
APPROVAL_RESPONSE_FIELDS = ("domain", "challenge", "signature")
APPROVAL_REFUSAL_FIELDS = ("domain", "challenge", "refusal")

SIGNATURE_VALID = "APPROVAL_SIGNATURE_VALID"
SIGNATURE_INVALID = "APPROVAL_SIGNATURE_INVALID"
ANCHOR_ABSENT = "APPROVAL_ANCHOR_ABSENT"
ANCHOR_FROM_DOCUMENT = "aumlok:anchor-from-document"
MALFORMED = "aumlok:approval-malformed"
REFUSED_BY_SIGNER = "aumlok:approval-refused-by-signer"
CHALLENGE_MISMATCH = "aumlok:approval-challenge-mismatch"
WRAPPER_CLAIMS_ATTENDANCE = "aumlok:unsigned-wrapper-claims-attendance"

DIGEST_EQ_MATCH = "CALLER_DIGEST_MATCH"
DIGEST_EQ_MISMATCH = "CALLER_DIGEST_MISMATCH"
DIGEST_EQ_NOT_SUPPLIED = "CALLER_DIGEST_NOT_SUPPLIED"
BINDING_UNVERIFIED = "OPERATION_BINDING_UNVERIFIED"
AUTHORIZATION_UNCHECKED = "OWNER_APPROVAL_UNCHECKED"
ATTENDANCE = "reported-not-proven"

#: The facet-5 status word for a signature that verified with nothing else failing. It says what
#: was VERIFIED and never that the approval authorizes anything or that a person was present.
FACET_VALID = "OWNER_APPROVAL_SIGNATURE_VALID"

#: Statuses that must fail a normal verification when approval checking was explicitly requested.
FAILING_SIGNATURE_STATUSES = (SIGNATURE_INVALID, ANCHOR_ABSENT, ANCHOR_FROM_DOCUMENT, MALFORMED,
                              REFUSED_BY_SIGNER, CHALLENGE_MISMATCH)

_LOWER_HEX_256 = re.compile(r"^[0-9a-f]{64}$")
_LOWER_HEX_512 = re.compile(r"^[0-9a-f]{128}$")
_AUKORA_ID = re.compile(r"^aukora:1:[0-9a-f]{64}$")
_EXACT_ATOM = re.compile(r"^[A-Za-z0-9._:/-]+$")
_KEY_BEARING_FIELDS = ("issuerPk", "publicKey", "ownerPk", "keyId", "anchor")
#: The producer's `readExactAtom(..., 128)` bound, mirrored: the limit is in BYTES, not characters.
_EXACT_ATOM_MAX_BYTES = 128
_ATTENDANCE_CLAIM_FIELDS = ("attendance", "humanApproved", "humanApproval", "approvedBy",
                            "humanPresent", "attended")


class ApprovalError(ValueError):
    """A named refusal. `code` is a stable string."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


def _require_digest(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _LOWER_HEX_256.match(value):
        raise ApprovalError(MALFORMED, f"{label}: must be 64 lowercase hexadecimal characters")
    return value


def _require_non_negative_int(value: Any, label: str) -> int:
    if type(value) is bool or not isinstance(value, int) or value < 0 or value > 2**53 - 1:
        raise ApprovalError(MALFORMED, f"{label}: must be a non-negative safe integer")
    return value


def canonical_request(request: Any) -> bytes:
    """Canonical JSON of the request, after the producer's own structural validation."""
    if not isinstance(request, dict):
        raise ApprovalError(MALFORMED, "approval request must be an object")
    if set(request) != set(APPROVAL_REQUEST_FIELDS):
        missing = sorted(set(APPROVAL_REQUEST_FIELDS) - set(request))
        extra = sorted(set(request) - set(APPROVAL_REQUEST_FIELDS))
        raise ApprovalError(MALFORMED, f"request is not the closed field set: missing={missing} extra={extra}")
    if request["domain"] != APPROVAL_REQUEST_DOMAIN:
        raise ApprovalError(MALFORMED, f"request.domain must be {APPROVAL_REQUEST_DOMAIN}")
    subject = request["subject"]
    if not isinstance(subject, str) or not _AUKORA_ID.match(subject):
        raise ApprovalError(MALFORMED, "request.subject: must use the aukora:1:<sha256> form")
    _require_digest(request["activeControlDigest"], "request.activeControlDigest")
    _require_digest(request["operationDigest"], "request.operationDigest")
    _require_digest(request["challenge"], "request.challenge")
    issued = _require_non_negative_int(request["issuedAt"], "request.issuedAt")
    expires = _require_non_negative_int(request["expiresAt"], "request.expiresAt")
    if expires <= issued:
        raise ApprovalError(MALFORMED, "request: expiresAt must be greater than issuedAt")
    return canonicalize_bytes({name: request[name] for name in APPROVAL_REQUEST_FIELDS})


def signing_bytes(request: Any) -> bytes:
    """The exact bytes the owner key signed."""
    return APPROVAL_SIGNATURE_DOMAIN.encode("ascii") + b"\0" + canonical_request(request)


def wrapper_attendance_claim(document: Any) -> Optional[str]:
    """The refusal code when an UNSIGNED wrapper field claims attendance, else None.

    The signed record has no attendance field at all, so such a claim can only live in the wrapper —
    which the owner key did not sign. It is a refusal, not an annotation.
    """
    if not isinstance(document, dict):
        return None
    for name in _ATTENDANCE_CLAIM_FIELDS:
        if name in document:
            return WRAPPER_CLAIMS_ATTENDANCE
    return None


def _document_parts(document: Any) -> dict:
    if not isinstance(document, dict):
        raise ApprovalError(MALFORMED, "approval document must be an object")
    for name in _KEY_BEARING_FIELDS:
        if name in document:
            raise ApprovalError(
                ANCHOR_FROM_DOCUMENT,
                f"the document carries `{name}`; an approval is checked against a SEPARATELY "
                f"supplied anchor, never a key the document chose",
            )
    request, response = document.get("request"), document.get("response")
    if not isinstance(request, dict) or not isinstance(response, dict):
        raise ApprovalError(MALFORMED, "approval document needs `request` and `response` objects")
    return {"request": request, "response": response}


def verify_approval(document: Any, *, anchor_pk_hex: Optional[str],
                    caller_operation_digest: Optional[str] = None) -> dict:
    """Verify one approval offline, returning the five findings separately.

    @param document: `{request, response, ...}` as the Aumlok lane serializes them.
    @param anchor_pk_hex: the owner public key, supplied SEPARATELY.
    @param caller_operation_digest: a digest to COMPARE with the signed one. Equality is reported as
        caller-supplied equality only; the memory-operation binding stays unverified.
    @returns: findings plus `fails_verification`, which is what a caller must act on.
    """
    report: dict[str, Any] = {
        "signature": {"status": ANCHOR_ABSENT if not anchor_pk_hex else SIGNATURE_INVALID, "checked": False},
        "caller_digest_equality": {"status": DIGEST_EQ_NOT_SUPPLIED, "checked": False},
        "memory_operation_binding": {
            "status": BINDING_UNVERIFIED, "checked": False,
            "why": "binding requires Diamond to DERIVE the operation digest from the agreed producer "
                   "operation bytes; that derivation does not exist, so this is never inferred and "
                   "caller-supplied equality is not a substitute for it",
        },
        "authorization": {"status": AUTHORIZATION_UNCHECKED, "checked": False,
                          "why": "approval is evidence; evidence never authorizes"},
        "attendance": {"status": ATTENDANCE, "proven": False},
        "attendance_claim_in_wrapper": None,
        "refusalCode": None,
        "fails_verification": False,
    }

    claim = wrapper_attendance_claim(document)
    if claim:
        # A refusal in its own right: it fails verification whether or not any signature checks.
        report["attendance_claim_in_wrapper"] = {
            "status": claim, "signed": False,
            "fields": sorted(name for name in _ATTENDANCE_CLAIM_FIELDS
                             if isinstance(document, dict) and name in document),
        }
        report["refusalCode"] = claim

    if not anchor_pk_hex:
        report["fails_verification"] = bool(claim)
        return report

    try:
        parts = _document_parts(document)
        request, response = parts["request"], parts["response"]
        preimage = signing_bytes(request)
    except ApprovalError as exc:
        report["signature"] = {"status": exc.code, "checked": False, "detail": exc.detail}
        report["refusalCode"] = exc.code
        report["fails_verification"] = True
        return report

    if set(response) == set(APPROVAL_REFUSAL_FIELDS):
        refusal = response.get("refusal")
        challenge = response.get("challenge")
        # The producer's refusal record allows `challenge: null` when the signer could not read
        # one, and otherwise a digest. Both spellings are mirrored here, domain included: the
        # refusal shape is closed too, so a record carrying a signature AND a refusal parses as
        # neither and falls into the branch below.
        if response.get("domain") != APPROVAL_RESPONSE_DOMAIN:
            report["signature"] = {"status": MALFORMED, "checked": False,
                                   "detail": "refusal response.domain must equal "
                                             f"{APPROVAL_RESPONSE_DOMAIN}"}
        elif challenge is not None and not (isinstance(challenge, str) and _LOWER_HEX_256.match(challenge)):
            report["signature"] = {"status": MALFORMED, "checked": False,
                                   "detail": "refusal response.challenge must be null or "
                                             "64 lowercase hexadecimal characters"}
        elif (not isinstance(refusal, str) or not _EXACT_ATOM.match(refusal)
              or len(refusal.encode("utf-8")) > _EXACT_ATOM_MAX_BYTES):
            report["signature"] = {"status": MALFORMED, "checked": True,
                                   "detail": "response.refusal is not an exact atom of at most "
                                             f"{_EXACT_ATOM_MAX_BYTES} bytes"}
        else:
            report["signature"] = {"status": REFUSED_BY_SIGNER, "checked": True, "detail": refusal}
        report["refusalCode"] = report["signature"]["status"]
        report["fails_verification"] = True
        return report
    if set(response) != set(APPROVAL_RESPONSE_FIELDS) or response.get("domain") != APPROVAL_RESPONSE_DOMAIN:
        report["signature"] = {"status": MALFORMED, "checked": False,
                               "detail": "response is not the closed signed-response field set"}
        report["refusalCode"] = MALFORMED
        report["fails_verification"] = True
        return report
    if not (isinstance(response.get("challenge"), str)
            and _LOWER_HEX_256.match(response["challenge"])):
        # The producer reads the response challenge with `readDigest` BEFORE comparing it, so a
        # non-digest challenge is a MALFORMED record and not a mismatch. Same order here: the
        # two facts stay distinguishable, as the producer's own vocabulary keeps them.
        report["signature"] = {"status": MALFORMED, "checked": False,
                               "detail": "response.challenge must be 64 lowercase hexadecimal "
                                         "characters"}
        report["refusalCode"] = MALFORMED
        report["fails_verification"] = True
        return report
    if response["challenge"] != request["challenge"]:
        report["signature"] = {"status": CHALLENGE_MISMATCH, "checked": True,
                               "detail": "the response challenge is not the request challenge"}
        report["refusalCode"] = CHALLENGE_MISMATCH
        report["fails_verification"] = True
        return report

    # A. signature validity, against the SUPPLIED anchor only.
    from diamond.ed25519 import verify as ed25519_verify
    from diamond.hexutil import from_hex

    if not isinstance(anchor_pk_hex, str) or not _LOWER_HEX_256.match(anchor_pk_hex):
        report["signature"] = {"status": MALFORMED, "checked": True,
                               "detail": "anchor must be 64 lowercase hexadecimal characters"}
        report["fails_verification"] = True
        return report
    if not isinstance(response.get("signature"), str) or not _LOWER_HEX_512.match(response["signature"]):
        report["signature"] = {"status": MALFORMED, "checked": True,
                               "detail": "response.signature must be 128 lowercase hexadecimal characters"}
        report["fails_verification"] = True
        return report

    preimage_sha256 = hashlib.sha256(preimage).hexdigest()
    if ed25519_verify(from_hex(anchor_pk_hex), preimage, from_hex(response["signature"])):
        report["signature"] = {"status": SIGNATURE_VALID, "checked": True,
                               "preimage_sha256": preimage_sha256}
    else:
        # No fallback prose: an invalid signature says exactly that and nothing reassuring.
        report["signature"] = {"status": SIGNATURE_INVALID, "checked": True,
                               "preimage_sha256": preimage_sha256,
                               "detail": "the signature does not verify under the supplied anchor"}

    # B. caller-supplied digest equality — equality only, about nobody's operation.
    signed_digest = request["operationDigest"]
    if caller_operation_digest is None:
        report["caller_digest_equality"] = {"status": DIGEST_EQ_NOT_SUPPLIED, "checked": False,
                                            "signed_operation_digest": signed_digest}
    elif not isinstance(caller_operation_digest, str) or not _LOWER_HEX_256.match(caller_operation_digest):
        report["caller_digest_equality"] = {"status": DIGEST_EQ_NOT_SUPPLIED, "checked": False,
                                            "detail": "the supplied digest is not 64 lowercase hex",
                                            "signed_operation_digest": signed_digest}
        report["fails_verification"] = True
    elif caller_operation_digest == signed_digest:
        report["caller_digest_equality"] = {
            "status": DIGEST_EQ_MATCH, "checked": True, "signed_operation_digest": signed_digest,
            "why": "caller-supplied equality: the caller provided this digest, so it is not evidence "
                   "about any operation and not a memory binding",
        }
    else:
        report["caller_digest_equality"] = {
            "status": DIGEST_EQ_MISMATCH, "checked": True, "signed_operation_digest": signed_digest,
            "caller_operation_digest": caller_operation_digest,
            "why": "the approval is about a different digest than the caller supplied",
        }

    report["fails_verification"] = (
        report["signature"]["status"] in FAILING_SIGNATURE_STATUSES
        or report["caller_digest_equality"]["status"] == DIGEST_EQ_MISMATCH
        or bool(claim)
    )
    return report


def approval_summary(report: dict) -> dict:
    """The single summary a caller acts on, derived from the findings — never from optimism.

    ONE PLACE COMPUTES THE VERDICT WORD, THE REASON AND THE REFUSAL, so a text rendering, a JSON
    rendering and an exit status cannot disagree: they are three spellings of this dict.

    `refusal` is the named reason a caller's verification must fail, or None. A valid signature
    is NOT sufficient for None: a signature over a different digest than the caller supplied, and
    an unsigned wrapper field claiming attendance, are both failures with their own names.
    """
    signature = report["signature"]
    equality = report["caller_digest_equality"]
    claim = report["attendance_claim_in_wrapper"]

    if claim:
        # First, because a claim about a PERSON outranks a claim about bytes: no signature could
        # have made it true, so it is refused by name rather than annotated.
        code = claim["status"]
        reason = (f"REFUSED: {code} — an UNSIGNED wrapper field claims attendance "
                  f"({', '.join(claim['fields']) or 'attendance'}), the owner key did not sign it, "
                  f"and a valid signature would not have shown a person was present")
    elif signature["status"] in FAILING_SIGNATURE_STATUSES:
        code = signature["status"]
        detail = signature.get("detail") or "no valid signature over the reconstructed preimage"
        reason = f"REFUSED: {code} — {detail}"
    elif equality["status"] == DIGEST_EQ_MISMATCH:
        code = equality["status"]
        reason = ("REFUSED: CALLER_DIGEST_MISMATCH — the signed operationDigest is not the digest "
                  "the caller supplied; the signature is over a different operation")
    elif equality["status"] == DIGEST_EQ_NOT_SUPPLIED and equality.get("detail"):
        code = MALFORMED
        reason = f"REFUSED: {MALFORMED} — the caller-supplied digest: {equality['detail']}"
    else:
        code = None
        reason = ("signature valid over the reconstructed preimage under the supplied anchor; "
                  "memory-operation binding UNVERIFIED and authorization UNCHECKED, and no "
                  "signature shows a person was present")

    if code is not None:
        status = code
    elif signature["status"] == SIGNATURE_VALID:
        status = FACET_VALID
    else:
        status = AUTHORIZATION_UNCHECKED

    return {
        "facet": "owner_approval",
        "status": status,
        "reason": reason,
        "refusal": {"code": code, "detail": reason} if code else None,
        "signature_validity": signature,
        "caller_digest_equality": equality,
        "memory_operation_binding": report["memory_operation_binding"],
        "authorization": report["authorization"],
        "attendance": report["attendance"],
        "attendance_claim_in_wrapper": claim,
        "fails_verification": bool(code),
    }


def main(argv: list[str] | None = None) -> int:
    """Verify one approval document offline; exit 0 only when nothing failed.

        python3 -m diamond.aumlok_approval --document <f> --anchor <hex-or-file>
                                           [--caller-operation-digest <hex>] [--json]
    """
    import argparse
    import sys
    from pathlib import Path

    parser = argparse.ArgumentParser(description="offline Aumlok owner-approval verification")
    parser.add_argument("--document", required=True)
    parser.add_argument("--anchor", required=True, help="owner public key hex or a file holding it")
    parser.add_argument("--caller-operation-digest", default=None,
                        help="compare the signed operationDigest with this digest (equality only; "
                             "the memory-operation binding stays unverified)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    candidate = Path(args.anchor)
    anchor = candidate.read_text().strip() if candidate.is_file() else args.anchor.strip()
    document = json.loads(Path(args.document).read_text())
    report = verify_approval(document, anchor_pk_hex=anchor,
                             caller_operation_digest=args.caller_operation_digest)
    summary = approval_summary(report)

    if args.json:
        print(json.dumps({"findings": report, "summary": summary}, indent=2, sort_keys=True))
    else:
        print("APPROVAL — five separate findings")
        print(f"  A signature validity      : {report['signature']['status']}")
        print(f"  B caller digest equality  : {report['caller_digest_equality']['status']}")
        print(f"  C memory-operation binding: {report['memory_operation_binding']['status']}")
        print(f"  D authorization           : {report['authorization']['status']}")
        print(f"  E attendance              : {report['attendance']['status']} "
              f"(proven: {report['attendance']['proven']})")
        print(f"  STATUS: {summary['status']}")
        print(f"  {summary['reason']}")
    # The exit status is the summary's own field: the printed word, the JSON and this status are
    # three renderings of one decision, so they cannot drift apart.
    return 1 if summary["fails_verification"] else 0


__all__ = [
    "APPROVAL_REQUEST_DOMAIN", "APPROVAL_RESPONSE_DOMAIN", "APPROVAL_SIGNATURE_DOMAIN",
    "APPROVAL_REQUEST_FIELDS", "APPROVAL_RESPONSE_FIELDS", "APPROVAL_REFUSAL_FIELDS",
    "SIGNATURE_VALID", "SIGNATURE_INVALID", "ANCHOR_ABSENT", "ANCHOR_FROM_DOCUMENT", "MALFORMED",
    "REFUSED_BY_SIGNER", "CHALLENGE_MISMATCH", "WRAPPER_CLAIMS_ATTENDANCE", "DIGEST_EQ_MATCH",
    "DIGEST_EQ_MISMATCH", "DIGEST_EQ_NOT_SUPPLIED", "BINDING_UNVERIFIED", "AUTHORIZATION_UNCHECKED",
    "ATTENDANCE", "FACET_VALID", "FAILING_SIGNATURE_STATUSES", "ApprovalError",
    "canonical_request", "signing_bytes", "verify_approval", "approval_summary",
    "wrapper_attendance_claim", "main",
]


if __name__ == "__main__":
    import sys as _sys

    _sys.exit(main())
