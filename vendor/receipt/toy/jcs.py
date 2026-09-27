"""RFC 8785 JCS for the integer-only subset this toy signs.

Floats are refused. Booleans are not integers. Object keys sort as UTF-16
code units (ASCII keys are ordinary lexicographic order).
"""

from __future__ import annotations

from typing import Any


class JCSError(ValueError):
    pass


def canonicalize(value: Any) -> str:
    return _ser(value)


def canonicalize_bytes(value: Any) -> bytes:
    return canonicalize(value).encode("utf-8")


def _ser(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, bool):
        raise JCSError("unexpected bool subclass")
    if isinstance(value, int):
        return _ser_int(value)
    if isinstance(value, float):
        raise JCSError("floats are not permitted (integer-only JCS)")
    if isinstance(value, str):
        return _ser_str(value)
    if isinstance(value, list):
        return "[" + ",".join(_ser(item) for item in value) + "]"
    if isinstance(value, dict):
        if any(not isinstance(k, str) for k in value):
            raise JCSError("object keys must be strings")
        parts = []
        for key in sorted(value.keys(), key=_utf16_key):
            parts.append(_ser_str(key) + ":" + _ser(value[key]))
        return "{" + ",".join(parts) + "}"
    raise JCSError(f"unsupported JCS type: {type(value).__name__}")


def _ser_int(n: int) -> str:
    if n == 0:
        return "0"
    sign = "-" if n < 0 else ""
    return sign + str(abs(n))


def _ser_str(s: str) -> str:
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\t":
            out.append("\\t")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\r":
            out.append("\\r")
        elif o < 0x20:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _utf16_key(key: str) -> tuple:
    units = []
    for ch in key:
        o = ord(ch)
        if o > 0xFFFF:
            o -= 0x10000
            units.append(0xD800 + (o >> 10))
            units.append(0xDC00 + (o & 0x3FF))
        else:
            units.append(o)
    return tuple(units)
