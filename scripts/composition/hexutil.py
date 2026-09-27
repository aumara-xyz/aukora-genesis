#!/usr/bin/env python3
"""Hex, digest and JSON-file helpers for the composition gate.

Lowercase hex, no `0x` prefix, exact byte lengths, and refusals that name the
field that was wrong. Every one of these helpers is on a path that decides
whether a governed effect happens, so none of them coerces: a 63-character
digest is a refusal, not a value to be padded, and a JSON file that is absent is
a refusal, not an empty object.

WHY REFUSALS NAME THE FIELD. The refusal codes in `refusals.py` are stable and
greppable; these reason strings are not stable and are for a human reader
looking at one failed transition. Keeping them separate means the code can be
matched by a test while the message stays free to improve.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from typing import Any

_HEX_DIGITS = frozenset("0123456789abcdef")


class HexError(ValueError):
    """A malformed hex value, or an absent/ill-formed JSON document."""


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def sha256_hex(data: bytes) -> str:
    return sha256(data).hex()


def to_hex(raw: bytes | bytearray | str) -> str:
    """Bytes to lowercase hex, and an already-hex string to itself.

    The idempotence is deliberate and it is a type boundary, not a convenience: the gate
    holds public keys as bytes in some places and as hex in others, and a call site that
    converts twice raises AttributeError while a call site that converts zero times compares
    a bytes object to a hex string and silently refuses every honest grant. Neither failure
    announces itself as a type error, so the conversion is made total here, once.
    """
    if isinstance(raw, str):
        return raw
    return bytes(raw).hex()


def from_hex(text: str) -> bytes:
    """Strictly lowercase, even length. Uppercase is refused rather than folded,
    because two spellings of the same digest would otherwise be two distinct
    strings in a signed message — the classic way a binding stops being a
    binding."""
    if not isinstance(text, str):
        raise HexError(f"hex_must_be_a_string: got {type(text).__name__}")
    if len(text) % 2 != 0:
        raise HexError(f"hex_odd_length: {len(text)} characters")
    if text != text.lower() or any(ch not in _HEX_DIGITS for ch in text):
        raise HexError("hex_must_be_lowercase_without_prefix")
    return bytes.fromhex(text)


def require_hex(text: Any, nbytes: int, field: str = "value") -> bytes:
    try:
        raw = from_hex(text)
    except HexError as exc:
        raise HexError(f"{field}: {exc}") from exc
    if len(raw) != nbytes:
        raise HexError(f"{field}: expected {nbytes} bytes ({nbytes * 2} hex chars), got {len(raw)}")
    return raw


def write_json(path: str, obj: Any) -> None:
    """Write a whole JSON document so a concurrent reader sees one version, never a prefix.

    WHY THIS IS A REPLACE AND NOT AN OPEN. `open(path, "w")` truncates and then writes, so
    between those two steps the file is an empty or partial document. A reader that lands in
    that window fails to parse a store that is valid on both sides of the write, and the
    consumer turns that into a refusal — for the spent-nonce store, a nonce that was recorded
    is reported as a store nobody can read. Measured before this change: 86 unparseable reads
    of 7464 by four spinning reader processes across 40 consumes; the JavaScript writer of the
    same file failed the required check the same way (GRANT_MALFORMED instead of GRANT_SPENT in
    5 of 150 raced rounds) until it was changed to a rename.

    The temporary file is created with `mkstemp` in the destination directory, which gives an
    unpredictable name and O_CREAT|O_EXCL rather than a predictable one written over whatever
    already sits there. `os.replace` is atomic within a filesystem, and the temporary file is
    always in the same directory as its destination, so there is no cross-device rename.

    THE DIRECTION OF FAILURE IS UNCHANGED. If the write fails, the destination keeps its
    previous contents and the exception propagates; a half-written file is never published
    under the real name. This does not make the store a lock and does not make read-then-write
    atomic — the exclusion for a one-use nonce is the claim file the gate creates before this
    is called, and that is untouched.
    """
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    try:
        blob = json.dumps(obj, indent=2, sort_keys=True) + "\n"
    except (TypeError, ValueError) as exc:
        raise HexError(f"not_serializable_json: {exc}") from exc

    # Carry the destination's existing mode across the replace: `mkstemp` creates 0600, and a
    # caller that tightened or widened the file deliberately should keep that choice.
    try:
        mode = os.stat(path).st_mode & 0o777
    except FileNotFoundError:
        mode = 0o600

    fd, temp_path = tempfile.mkstemp(prefix=f".{os.path.basename(path)}.", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(blob)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(temp_path, mode)
        os.replace(temp_path, path)
    except BaseException:
        # The destination is untouched, so the only cleanup needed is the temporary file.
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def read_json(path: str) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError as exc:
        raise HexError(f"document_absent: {path}") from exc
    except (UnicodeDecodeError, ValueError) as exc:
        raise HexError(f"document_is_not_admissible_json: {path}: {exc}") from exc


def write_bytes(path: str, blob: bytes) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(blob)


def read_bytes(path: str) -> bytes:
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except FileNotFoundError as exc:
        raise HexError(f"file_absent: {path}") from exc
