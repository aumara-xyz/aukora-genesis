"""Acceptance tooling: change a payload without breaking its canonical JSON envelope.

This helper travels under tooling/, outside the consumer import closure. It uses
the shipped cold reader and canonicalizer, and never signs or updates identity.
"""
from __future__ import annotations

from diamond.approval_artifact import read_content
from diamond.kira_evidence import jcs_bytes


def tamper_content(content_bytes: bytes) -> bytes:
    """Change only value.content, preserving key, recordId and all other fields.

    A null/non-null toggle differs for every supported JSON payload, including
    empty containers, scalars and nested Unicode, without assuming fixture text.
    Re-encoding plus one newline preserves the exact content wire format.
    """
    document = read_content(content_bytes)
    record = document["value"]
    if not isinstance(record, dict) or "content" not in record:
        raise ValueError("the exported record must carry content")
    record["content"] = False if record["content"] is None else None
    return jcs_bytes(document) + b"\n"
