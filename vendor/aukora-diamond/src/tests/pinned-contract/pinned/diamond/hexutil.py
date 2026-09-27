"""Hex and digest helpers. Lowercase, no 0x prefix."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def sha256_hex(data: bytes) -> str:
    return sha256(data).hex()


def to_hex(raw: bytes) -> str:
    return raw.hex()


def from_hex(text: str) -> bytes:
    if not isinstance(text, str) or len(text) % 2 != 0:
        raise ValueError("hex")
    if text != text.lower() or any(ch not in "0123456789abcdef" for ch in text):
        raise ValueError("hex must be lowercase")
    return bytes.fromhex(text)


def require_hex(text: str, nbytes: int) -> bytes:
    raw = from_hex(text)
    if len(raw) != nbytes:
        raise ValueError(f"expected {nbytes} bytes")
    return raw


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def write_secret(path: Path, text: str, *, mode: int = 0o600) -> None:
    """Write a secret file with restrictive mode (default 0o600). Never commit *.sk."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic-ish: write then chmod; prefer O_CREAT|O_TRUNC with mode.
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    try:
        os.write(fd, text.encode("utf-8"))
        os.fchmod(fd, mode)
    finally:
        os.close(fd)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))
