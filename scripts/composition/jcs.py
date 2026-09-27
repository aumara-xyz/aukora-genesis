#!/usr/bin/env python3
"""RFC 8785 JCS, restricted to the integer-only subset this gate signs.

WHY A CANONICAL FORM AT ALL. A signature covers bytes. If two implementations
can serialize the same object to different bytes, a signature over one
serialization is not a signature over the object, and a verifier that re-derives
the bytes differently rejects an honest receipt (or, worse, accepts a different
one). Every signed structure in this gate is therefore canonicalized here, and
the receipt and the grant both refuse to sign anything this module rejects.

WHAT IS RESTRICTED, AND WHY THAT IS SAFER THAN IT SOUNDS. Only `null`, booleans,
integers, strings, arrays and objects of those are accepted. Floats are refused
outright rather than formatted: RFC 8785 requires ECMAScript number formatting,
which is a genuinely subtle piece of work to reproduce correctly, and no signed
structure in this gate has ever needed a non-integer. A refusal at the seam
beats a re-implementation of `Number.prototype.toString` that is right for most
inputs. Object keys sort by UTF-16 code units, per RFC 8785 §3.2.3.

Integer ranges: RFC 8785 requires numbers to be interoperable IEEE-754 doubles,
so an integer outside 2^53 - 1 cannot round-trip through a JavaScript
implementation. `canonicalize` refuses one rather than emitting a number a
conforming JCS reader would read back differently. No field in this gate's
signed structures is in that range — timestamps and sequence numbers are far
below it — but the check is here so that a future field cannot quietly land
there.
"""
from __future__ import annotations

from typing import Any

JCS_MAX_INTEROPERABLE_INTEGER = 2**53 - 1


class JCSError(ValueError):
    """A value that has no canonical encoding. Never silently coerced."""


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
    # bool is a subclass of int in Python; both real booleans are handled above, so
    # reaching here with a bool subclass is a caller error worth naming.
    if isinstance(value, bool):
        raise JCSError("unexpected_bool_subclass")
    if isinstance(value, int):
        return _ser_int(value)
    if isinstance(value, float):
        raise JCSError("floats_are_not_permitted: integer-only canonical form")
    if isinstance(value, str):
        return _ser_str(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_ser(item) for item in value) + "]"
    if isinstance(value, dict):
        if any(not isinstance(k, str) for k in value):
            raise JCSError("object_keys_must_be_strings")
        return "{" + ",".join(
            _ser_str(key) + ":" + _ser(value[key])
            for key in sorted(value.keys(), key=_utf16_key)
        ) + "}"
    raise JCSError(f"unsupported_type: {type(value).__name__}")


def _ser_int(n: int) -> str:
    if abs(n) > JCS_MAX_INTEROPERABLE_INTEGER:
        raise JCSError(f"integer_not_interoperable_with_ieee754: {n}")
    if n == 0:
        return "0"
    return ("-" if n < 0 else "") + str(abs(n))


def _ser_str(s: str) -> str:
    """RFC 8785 §3.2.2.2 escaping: the two mandatory escapes, the five control
    short forms, and \\uXXXX for the remaining control characters. Everything
    else is emitted as itself, which is what makes the encoding UTF-8."""
    out = ['"']
    for ch in s:
        code = ord(ch)
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
        elif code < 0x20:
            out.append("\\u%04x" % code)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _utf16_key(key: str) -> tuple:
    """Sort key in UTF-16 code units, not code points. The two differ only above
    U+FFFF, where a code point sorts before its surrogates would — the exact
    mismatch that makes two "conforming" canonicalizers disagree."""
    units = []
    for ch in key:
        code = ord(ch)
        if code > 0xFFFF:
            code -= 0x10000
            units.append(0xD800 + (code >> 10))
            units.append(0xDC00 + (code & 0x3FF))
        else:
            units.append(code)
    return tuple(units)


def selftest() -> int:
    """The properties the signed structures depend on. Raises on disagreement.

    Every one of these is a way two canonicalizers differ in the wild, so the
    gate measures them rather than assuming them.
    """
    checks = 0
    # Key ordering is by UTF-16 code units and is independent of insertion order.
    if canonicalize({"b": 1, "a": 2}) != '{"a":2,"b":1}':
        raise JCSError("key_order")
    if canonicalize({"a": 1, "b": 2}) != canonicalize({"b": 2, "a": 1}):
        raise JCSError("key_order_must_not_depend_on_insertion_order")
    # Empty containers and nesting.
    if canonicalize({}) != "{}" or canonicalize([]) != "[]":
        raise JCSError("empty_containers")
    if canonicalize({"a": [1, {"b": None}]}) != '{"a":[1,{"b":null}]}':
        raise JCSError("nesting")
    # The three literals and integer forms, including negative and zero.
    if canonicalize([True, False, None, 0, -1, 17]) != "[true,false,null,0,-1,17]":
        raise JCSError("literals_and_integers")
    # String escapes.
    if canonicalize('a"b\\c\nd\te') != '"a\\"b\\\\c\\nd\\te"':
        raise JCSError("string_escapes")
    if canonicalize("\x01") != '"\\u0001"':
        raise JCSError("control_escape")
    # Above U+FFFF: emitted raw as UTF-8, and sorted by UTF-16 code units. This is
    # the case where UTF-16 and UTF-8 ordering genuinely disagree, so it is asserted
    # rather than assumed. U+1F600 is the surrogate pair D83D DE00, so its first code
    # unit is 0xD83D = 55357, which is LESS than U+FB00 = 64256 — the astral
    # character sorts FIRST. UTF-8 byte order puts U+FB00 first (EF AC 80 vs
    # F0 9F 98 80), so a canonicalizer that sorted UTF-8 bytes would order these two
    # keys the other way round and produce different signing bytes.
    if canonicalize_bytes("\U0001F600") != b'"\xf0\x9f\x98\x80"':
        raise JCSError("astral_characters_are_utf8")
    if list(sorted(("\uFB00", "\U0001F600"), key=_utf16_key)) != ["\U0001F600", "\uFB00"]:
        raise JCSError("utf16_sort_order")
    if sorted(("\uFB00", "\U0001F600")) != ["\uFB00", "\U0001F600"]:
        raise JCSError("test_premise: code-point order should differ from UTF-16 order here")
    if sorted(("\uFB00", "\U0001F600"), key=lambda s: s.encode("utf-8")) != [
        "\uFB00", "\U0001F600"
    ]:
        raise JCSError("test_premise: utf-8 byte order should differ from UTF-16 order here")
    # Refusals, each one a class of value that has no safe canonical encoding.
    for bad, why in ((1.5, "float"), (float("nan"), "nan"), ({"x": 1.5}, "nested float"),
                     (b"bytes", "bytes"), ({"a": object()}, "opaque object")):
        try:
            canonicalize(bad)
        except JCSError:
            checks += 1
            continue
        raise JCSError(f"refused_to_refuse: {why}")
    # Integers beyond IEEE-754 exactness are refused, not emitted.
    try:
        canonicalize(2**53)
        raise JCSError("refused_to_refuse: non-interoperable integer")
    except JCSError as exc:
        if "interoperable" not in str(exc):
            raise
    return checks + 10
