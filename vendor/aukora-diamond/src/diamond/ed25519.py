"""RFC 8032 Ed25519, stdlib only (hashlib / secrets).

Used for composition grants and receipt v3-toy signatures. No `alg` field
is ever written; the kind string is the algorithm binding.
"""

from __future__ import annotations

from hashlib import sha512
from secrets import token_bytes

P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = (-121665 * pow(121666, P - 2, P)) % P
I = pow(2, (P - 1) // 4, P)
BY = (4 * pow(5, P - 2, P)) % P


def _inv(x: int) -> int:
    return pow(x, P - 2, P)


def _xrecover(y: int) -> int:
    yy = (y * y) % P
    u = (yy - 1) % P
    v = (D * yy + 1) % P
    x2 = (u * _inv(v)) % P
    x = pow(x2, (P + 3) // 8, P)
    if (x * x - x2) % P != 0:
        x = (x * I) % P
    if (x * x - x2) % P != 0:
        raise ValueError("not on curve")
    return x


BX = _xrecover(BY)
if BX & 1:
    BX = P - BX
B = (BX, BY)


def _add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    t = D * x1 * x2 * y1 * y2
    x3 = (x1 * y2 + x2 * y1) * _inv(1 + t)
    y3 = (y1 * y2 + x1 * x2) * _inv(1 - t)
    return (x3 % P, y3 % P)


def _mul(k: int, point):
    acc = None
    for bit in bin(k)[2:]:
        acc = _add(acc, acc)
        if bit == "1":
            acc = _add(acc, point)
    return acc


def _encode_point(point) -> bytes:
    x, y = point
    out = bytearray(y.to_bytes(32, "little"))
    out[31] |= (x & 1) << 7
    return bytes(out)


def _decode_point(raw: bytes):
    if len(raw) != 32:
        raise ValueError("point length")
    y = int.from_bytes(raw, "little")
    sign = (y >> 255) & 1
    y &= (1 << 255) - 1
    if y >= P:
        raise ValueError("y out of range")
    try:
        x = _xrecover(y)
    except ValueError as exc:
        raise ValueError("invalid point") from exc
    if x == 0 and sign:
        raise ValueError("noncanonical sign")
    if x & 1 != sign:
        x = P - x
    point = (x, y)
    if _encode_point(point) != raw:
        raise ValueError("noncanonical point")
    if _mul(8, point) == (0, 1):
        raise ValueError("small-order point")
    return point


def _expand_seed(seed: bytes) -> tuple[int, bytes, bytes]:
    if len(seed) != 32:
        raise ValueError("seed length")
    h = sha512(seed).digest()
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    prefix = h[32:]
    pub = _encode_point(_mul(a, B))
    return a, prefix, pub


def keygen() -> tuple[bytes, bytes]:
    seed = token_bytes(32)
    _, _, pub = _expand_seed(seed)
    return seed, pub


def public_from_seed(seed: bytes) -> bytes:
    _, _, pub = _expand_seed(seed)
    return pub


def sign(seed: bytes, message: bytes) -> bytes:
    a, prefix, pub = _expand_seed(seed)
    r = int.from_bytes(sha512(prefix + message).digest(), "little") % L
    r_point = _mul(r, B)
    if r_point is None:
        raise ValueError("unexpected identity")
    r_bytes = _encode_point(r_point)
    k = int.from_bytes(sha512(r_bytes + pub + message).digest(), "little") % L
    s = (r + k * a) % L
    return r_bytes + s.to_bytes(32, "little")


def verify(pub: bytes, message: bytes, signature: bytes) -> bool:
    if len(pub) != 32 or len(signature) != 64:
        return False
    try:
        r_point = _decode_point(signature[:32])
        a_point = _decode_point(pub)
    except ValueError:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= L:
        return False
    k = int.from_bytes(sha512(signature[:32] + pub + message).digest(), "little") % L
    left = _mul(s, B)
    right = _add(r_point, _mul(k, a_point))
    if left is None or right is None:
        return False
    return left == right


def rfc8032_selftest() -> None:
    # Official RFC 8032 §7.1 TEST 1 (empty message).
    sk = bytes.fromhex(
        "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
    )
    pk = bytes.fromhex(
        "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
    )
    rfc_sig = bytes.fromhex(
        "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
        "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
    )
    got_pk = public_from_seed(sk)
    if got_pk != pk:
        raise RuntimeError("ed25519 public key mismatch vs RFC 8032 TEST 1")
    got_sig = sign(sk, b"")
    if got_sig != rfc_sig:
        raise RuntimeError("ed25519 signature mismatch vs RFC 8032 TEST 1")
    if not verify(pk, b"", rfc_sig):
        raise RuntimeError("ed25519 verify failed on RFC 8032 TEST 1")
    if verify(pk, b"x", rfc_sig):
        raise RuntimeError("ed25519 verify accepted a mutated message")


if __name__ == "__main__":
    rfc8032_selftest()
    print("ed25519: RFC 8032 TEST 1 ok")
