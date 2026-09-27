#!/usr/bin/env python3
"""Ed25519 (RFC 8032) in stdlib only — hashlib for SHA-512, secrets for keys.

WHY THIS FILE EXISTS. Python's standard library has no Ed25519, and this
repository may not take a third-party dependency for the composition gate. The
gate therefore carries its own implementation of the primitives it signs with.
This is a deliberate cost, not a preferred design: a hand-written curve
implementation is exactly the kind of code that is wrong in a way that still
returns True, so it ships with the RFC's own test vectors wired into a
self-test that runs before any signature is trusted.

    python3 scripts/composition/ed25519.py     # runs the vectors, prints ok

Provenance, stated plainly so nobody has to guess: this is an independent
stdlib implementation written for this brick against RFC 8032, not bytes
copied from `vendor/receipt/` (which did not exist in this worktree when
this file was written) and not bytes copied from the toy control plane at
github.com/aumara-xyz/aukora-toy (MIT — the licence that repository actually
ships; AGPL-3.0-only is the *membrane's*, not the toy's). The RFC's published
vectors are the only borrowed material, and they are published constants.

WHAT IT DOES NOT PROVE. A valid signature proves that the holder of the secret
seed produced these bytes over exactly this message. It proves nothing about
who holds the seed, whether a human was involved, or whether the message is
true. Key custody is not a feature of this module; see the ceilings in
`receipt.py` and `README.md`.

Group arithmetic uses extended homogeneous coordinates (X : Y : Z : T) with
unified addition, so the same `_add` handles doubling and the identity has a
representation. `_encode`/`_decode` are RFC 8032 §5.1.2/§5.1.3: 32 little
endian bytes of y with the sign of x in the top bit.

Co-factor and torsion policy — read this before weakening the verifier. RFC
8032 permits cofactored verification (accept when [8]([s]B - [k]A - R) is the
identity), several widely deployed libraries do exactly that, and cofactorless
verification rejects some signatures those libraries accept. The difference is
a real interop question, not a bug, and it is decided here explicitly: this
verifier is *cofactorless*, because the only signatures it checks are ones this
repository's own issuer made, and a stricter check that occasionally disagrees
with a permissive third party is a better failure than accepting a malleable
signature. Nothing here accepts non-canonical S: `s < L` is enforced, which is
the malleability guard RFC 8032 and every serious deployment require.
"""
from __future__ import annotations

from hashlib import sha512
from secrets import token_bytes

# ── curve constants (RFC 8032 §5.1) ─────────────────────────────────────────────────────────

P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = (-121665 * pow(121666, P - 2, P)) % P
SQRT_M1 = pow(2, (P - 1) // 4, P)


class Ed25519Error(Exception):
    """A refusal with a reason. Never a silent False for malformed input:
    callers distinguish 'bad bytes' from 'bad signature'."""


def _inv(x: int) -> int:
    return pow(x, P - 2, P)


def _xrecover(y: int) -> int:
    """Recover the even-or-odd x for a given y (RFC 8032 §5.1.3)."""
    yy = (y * y) % P
    u = (yy - 1) % P
    v = (D * yy + 1) % P
    x2 = (u * _inv(v)) % P
    x = pow(x2, (P + 3) // 8, P)
    if (x * x - x2) % P != 0:
        x = (x * SQRT_M1) % P
    if (x * x - x2) % P != 0:
        raise Ed25519Error("not_on_curve: y has no square root for x^2")
    return x


_BY = (4 * pow(5, P - 2, P)) % P
_BX = _xrecover(_BY)
if _BX & 1:
    _BX = P - _BX
# The base point B, in extended coordinates (X, Y, Z, T) with Z = 1.
_B = (_BX, _BY, 1, (_BX * _BY) % P)
# The neutral element, as an extended point.
_IDENTITY = (0, 1, 1, 0)


def _add(p1, p2):
    """Unified extended-coordinate addition (RFC 8032 §5.1.4). Doubling and the
    identity go through this same path, so no caller can forget a case."""
    x1, y1, z1, t1 = p1
    x2, y2, z2, t2 = p2
    a = ((y1 - x1) * (y2 - x2)) % P
    b = ((y1 + x1) * (y2 + x2)) % P
    c = (2 * t1 * t2 * D) % P
    dd = (2 * z1 * z2) % P
    e, f, g, h = (b - a) % P, (dd - c) % P, (dd + c) % P, (b + a) % P
    return ((e * f) % P, (g * h) % P, (f * g) % P, (e * h) % P)


def _mul(k: int, point):
    """Scalar multiplication, most-significant-bit first. The identity argument
    is handled by `_add`, so k = 0 returns the neutral element rather than None."""
    acc = _IDENTITY
    for bit in bin(k)[2:]:
        acc = _add(acc, acc)
        if bit == "1":
            acc = _add(acc, point)
    return acc


def _encode(point) -> bytes:
    """Canonical 32-byte encoding: affine y little-endian, with the parity of the
    affine x in the top bit.

    This function is also the equality test for the whole module, and that is a
    deliberate choice worth stating. Extended coordinates are projective: the
    same curve point has infinitely many (X : Y : Z : T) tuples, and the group
    law above returns whatever representative falls out of the arithmetic rather
    than normalizing to Z = 1. Comparing raw tuples therefore gives the wrong
    answer for points that are equal — `[1]B` does not come back as the literal
    base-point tuple, and an earlier revision of `verify` returned False for
    RFC 8032's own published signature because of exactly that. Encoding
    normalizes, so encoding is the comparison; `_same_point` names the intent at
    each call site instead of leaving a bare `==` to be misread.
    """
    x, y, z, _t = point
    zi = _inv(z)
    x, y = (x * zi) % P, (y * zi) % P
    out = bytearray(y.to_bytes(32, "little"))
    out[31] |= (x & 1) << 7
    return bytes(out)


def _same_point(p1, p2) -> bool:
    """Curve-point equality, canonical and projective-safe. See `_encode`."""
    return _encode(p1) == _encode(p2)


def _decode(raw: bytes):
    """
    A 32-byte public key or point, decoded ONLY if it is a canonical, non-small-order curve point.

    ── THE IDENTITY-KEY FORGERY, AND THE THREE CHECKS THAT CLOSE IT (aura-84, audit finding -003) ──────
    **AN INDEPENDENT AUDIT FOUND THAT THIS FUNCTION ACCEPTED THE IDENTITY-KEY FORGERY**: *the encoding
    `01 || 00*31` with a signature whose `R` is the same encoding and whose `S` is 1 verifies as True for
    TWO DIFFERENT MESSAGES*, *and 2 of the 8 small-order keys were accepted.* *The forgery works because the
    identity element makes the verification equation collapse*: *`[S]B = R + [k]A` becomes `[1]B = identity +
    [k]·identity`, and every term on the right vanishes.* **Fix `90b1dcad8`/`228999932` repaired only
    `vendor/receipt`'s toy implementation, not this one** -- *so the forgery has remained live here, in the
    file the composition gate actually uses.*
    *
    * THREE CHECKS, APPLIED IN THIS ORDER, AND EACH ONE IS LOAD-BEARING:
    *
    * **(a) `x == 0 and sign` REFUSES A NON-CANONICAL ENCODING *BEFORE* THE NEGATION.** *When `xrecover`
      returns 0 there is exactly one valid encoding of that point -- `sign` must be 0 -- and the line
      `x = P - x` below would turn it into `P`, producing a different point from the one encoded.* **So the
      check has to come first**; *placing it after the negation would compare against a value the input never
      named, which is why the audit specifies the position and not merely the condition.*
    * **(b) RE-ENCODING MUST ROUND-TRIP.** *`_encode(point) == raw` refuses every encoding that is not the
      canonical one for the point it decodes to* -- *a second, independent door onto the same class as (a),
      and the one that catches a non-canonical `y` that survives the `y >= P` test.*
    * **(c) THE POINT MUST NOT HAVE SMALL ORDER.** *`_same_point(_mul(8, point), _IDENTITY)` refuses every
      point of order dividing 8* -- **these are exactly the points that make the verification equation
      collapse**, *and there are eight of them.* *Multiplying by 8 is the cheap test: a point of small order
      becomes the identity, and a point of full order does not.*
    *
    * **AND (b) AND (c) ARE NOT REDUNDANT WITH (a).** *(a) refuses one non-canonical encoding of the identity;
      (b) refuses non-canonical encodings generally; (c) refuses the eight small-order points INCLUDING their
      canonical encodings* -- *so removing any one of the three leaves a way through, which is what the court
      beside this file exists to demonstrate.*
    """
    if len(raw) != 32:
        raise Ed25519Error(f"point_length: expected 32 bytes, got {len(raw)}")
    y = int.from_bytes(raw, "little")
    sign = (y >> 255) & 1
    y &= (1 << 255) - 1
    if y >= P:
        raise Ed25519Error("point_not_canonical: y >= p")
    x = _xrecover(y)
    # (a) BEFORE the negation: x == 0 admits only sign == 0, and `x = P - x` would silently alter the point.
    if x == 0 and sign:
        raise Ed25519Error("point_not_canonical: x == 0 with the sign bit set")
    if (x & 1) != sign:
        x = P - x
    point = (x, y, 1, (x * y) % P)
    # (b) the encoding must round-trip, so only the canonical form of a point is ever accepted.
    if _encode(point) != raw:
        raise Ed25519Error("point_not_canonical: the encoding does not round-trip")
    # (c) refuse the small-order points, which are what make the verification equation collapse.
    if _same_point(_mul(8, point), _IDENTITY):
        raise Ed25519Error("point_small_order: the point has order dividing 8")
    return point


# ── keys and signatures ────────────────────────────────────────────────────────────────────

def expand_seed(seed: bytes) -> tuple[int, bytes, bytes]:
    """(scalar, nonce prefix, public key) from a 32-byte seed (RFC 8032 §5.1.5)."""
    if not isinstance(seed, (bytes, bytearray)) or len(seed) != 32:
        raise Ed25519Error("seed_length: expected 32 bytes")
    h = sha512(bytes(seed)).digest()
    scalar = int.from_bytes(h[:32], "little")
    scalar &= (1 << 254) - 8          # clear the low 3 bits
    scalar |= 1 << 254                # set the second-highest bit
    return scalar, h[32:], _encode(_mul(scalar, _B))


def keygen() -> tuple[bytes, bytes]:
    """A fresh (seed, public key) pair from the OS CSPRNG."""
    seed = token_bytes(32)
    return seed, expand_seed(seed)[2]


def public_from_seed(seed: bytes) -> bytes:
    return expand_seed(seed)[2]


def sign(seed: bytes, message: bytes) -> bytes:
    """A 64-byte detached signature over `message`."""
    if not isinstance(message, (bytes, bytearray)):
        raise Ed25519Error("message_must_be_bytes")
    message = bytes(message)
    scalar, prefix, pub = expand_seed(seed)
    r = int.from_bytes(sha512(prefix + message).digest(), "little") % L
    r_bytes = _encode(_mul(r, _B))
    k = int.from_bytes(sha512(r_bytes + pub + message).digest(), "little") % L
    s = (r + k * scalar) % L
    return r_bytes + s.to_bytes(32, "little")


def verify(public: bytes, message: bytes, signature: bytes) -> bool:
    """True only for a well-formed, canonical, cofactorless-valid signature.

    Malformed inputs return False rather than raising, because a verifier's
    callers treat every one of them the same way: the receipt does not verify.
    The distinction that matters — tampered payload vs. tampered signature — is
    reported by the receipt layer, which re-checks what it can.
    """
    if not isinstance(public, (bytes, bytearray)) or len(public) != 32:
        return False
    if not isinstance(signature, (bytes, bytearray)) or len(signature) != 64:
        return False
    if not isinstance(message, (bytes, bytearray)):
        return False
    public, signature, message = bytes(public), bytes(signature), bytes(message)
    try:
        r_point = _decode(signature[:32])
        a_point = _decode(public)
    except Ed25519Error:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= L:
        return False  # non-canonical S: the malleability guard
    k = int.from_bytes(sha512(signature[:32] + public + message).digest(), "little") % L
    # Cofactorless: [s]B == R + [k]A, compared on canonical encodings.
    return _same_point(_mul(s, _B), _add(r_point, _mul(k, a_point)))


# ── the vectors that make the above trustworthy ────────────────────────────────────────────

# RFC 8032 §7.1 Ed25519 test vectors. Borrowed published constants, nothing else.
RFC8032_VECTORS = (
    # TEST 1: empty message.
    (
        "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
        "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        "",
        "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bac"
        "c61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    ),
    # TEST 2: one byte.
    (
        "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
        "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
        "72",
        "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e"
        "458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
    ),
    # TEST 3: two bytes.
    (
        "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
        "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
        "af82",
        "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290"
        "ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
    ),
)


def _assert_on_curve(point, label: str) -> None:
    """Group-law control: the point satisfies -x^2 + y^2 = 1 + d x^2 y^2.

    Checked here rather than trusted, because a scalar-multiplication bug that
    stays inside a subgroup can still produce self-consistent signatures that no
    other implementation accepts. An earlier revision of the *debug* helper used
    for this had the sign of the x^2 term wrong and declared the base point
    off-curve, which is how easy this check is to get backwards — so it lives in
    the shipped self-test with the correct sign.
    """
    x, y, z, t = point
    zi = _inv(z)
    x, y, t = (x * zi) % P, (y * zi) % P, (t * zi) % P
    if (t - x * y) % P != 0:
        raise Ed25519Error(f"{label}: T != X*Y, not a valid extended representation")
    if (-x * x + y * y - 1 - D * x * x * y * y) % P != 0:
        raise Ed25519Error(f"{label}: point is not on the curve")


def rfc8032_selftest(vectors: tuple = RFC8032_VECTORS) -> int:
    """Run every vector. Returns the count checked; raises on any disagreement.

    This is called by the self-check before any arm trusts a signature, so a
    curve mistake fails loudly at the gate instead of silently accepting
    receipts nobody can verify.
    """
    # Group-law controls first: everything below depends on these.
    _assert_on_curve(_B, "base point B")
    if not _same_point(_mul(1, _B), _B):
        raise Ed25519Error("group_law: [1]B is not B")
    if not _same_point(_mul(2, _B), _add(_B, _B)):
        raise Ed25519Error("group_law: [2]B is not B+B")
    if not _same_point(_mul(L, _B), _IDENTITY):
        raise Ed25519Error("group_law: [L]B is not the neutral element")
    if _same_point(_mul(L - 1, _B), _IDENTITY):
        raise Ed25519Error("group_law: [L-1]B is the neutral element, which cannot be")
    for _ in range(8):
        a, b = int.from_bytes(token_bytes(32), "little"), int.from_bytes(token_bytes(32), "little")
        if not _same_point(_add(_mul(a, _B), _mul(b, _B)), _mul((a + b) % L, _B)):
            raise Ed25519Error("group_law: [a]B + [b]B != [a+b]B")

    for index, (seed_hex, pub_hex, msg_hex, sig_hex) in enumerate(vectors, start=1):
        seed = bytes.fromhex(seed_hex)
        message = bytes.fromhex(msg_hex)
        derived = public_from_seed(seed)
        _assert_on_curve(_decode(derived), f"vector {index} public key")
        if derived != bytes.fromhex(pub_hex):
            raise Ed25519Error(
                f"rfc8032_vector_{index}_public_key: derived {derived.hex()} != published {pub_hex}"
            )
        produced = sign(seed, message)
        if produced != bytes.fromhex(sig_hex):
            raise Ed25519Error(
                f"rfc8032_vector_{index}_signature: produced {produced.hex()} != published {sig_hex}"
            )
        if not verify(bytes.fromhex(pub_hex), message, bytes.fromhex(sig_hex)):
            raise Ed25519Error(f"rfc8032_vector_{index}_verify: published signature rejected")
    # Negative controls. A verifier that returns True unconditionally passes every
    # vector above, so these are not optional.
    seed_hex, pub_hex, msg_hex, sig_hex = vectors[0]
    seed, message = bytes.fromhex(seed_hex), bytes.fromhex(msg_hex)
    signature = bytes.fromhex(sig_hex)
    if verify(bytes.fromhex(pub_hex), b"x" + message, signature):
        raise Ed25519Error("negative_control: accepted a mutated message")
    tampered = bytearray(signature)
    tampered[0] ^= 0x01
    if verify(bytes.fromhex(pub_hex), message, bytes(tampered)):
        raise Ed25519Error("negative_control: accepted a tampered signature")
    other_pub = public_from_seed(bytes.fromhex(vectors[1][0]))
    if verify(other_pub, message, signature):
        raise Ed25519Error("negative_control: accepted a signature under the wrong key")
    # Non-canonical S: the published S for vector 1 with L added must be refused.
    s_raw = int.from_bytes(signature[32:], "little")
    if s_raw + L < 1 << 256:
        malleable = signature[:32] + (s_raw + L).to_bytes(32, "little")
        if verify(bytes.fromhex(pub_hex), message, malleable):
            raise Ed25519Error("negative_control: accepted non-canonical S (s >= L)")
    return len(vectors)


if __name__ == "__main__":
    checked = rfc8032_selftest()
    print(f"ed25519: RFC 8032 {checked} vectors ok, plus negative controls")
