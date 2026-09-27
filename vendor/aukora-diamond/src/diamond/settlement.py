"""Settlement journal — a consumed grant must not vanish from accounting.

The residue hole: `activate` reserves the nonce (atomic, durable, O_EXCL)
and only then performs the effect, the loader-state write, the Aura append
and the receipt write. A crash between those boundaries leaves a grant that
is provably spent and an effect that is not provably anything. Reporting
either "success" or a clean "refusal" after such a crash is a lie.

So the settlement is journaled at a durable boundary *before* the effect:

    reserve nonce  →  JOURNAL PENDING  →  effect  →  state  →  aura  →  receipt
                                           →  JOURNAL COMMIT

On cold reopen, `reopen()` scans the journal:

  pending, no aura entry for the nonce   →  AUTHORITY_CONSUMED_EFFECT_UNKNOWN
  pending, aura entry exists for nonce   →  INDETERMINATE (effect present,
                                            settlement never marked committed)
  committed                              →  settled, nothing to report

Neither outcome is success and neither is a clean refusal. The consumed
authority stays visible in accounting forever, which is the whole point.

This is not a database and has no recovery semantics beyond honest reporting.
Missing journal entries are the loudest state, not the quietest.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from diamond.hexutil import read_json, require_hex
from diamond.refuse_codes import (
    AUTHORITY_CONSUMED_EFFECT_UNKNOWN,
    INDETERMINATE,
    SETTLEMENT_JOURNAL_UNREADABLE,
    SETTLEMENT_PENDING,
)


class SettlementError(ValueError):
    pass


def _atomic_write_json(path: Path, obj: dict) -> None:
    """tmp + fsync + rename: a reader never sees a half-written entry."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    data = json.dumps(obj, sort_keys=True, separators=(",", ":"))
    fd = os.open(str(tmp), os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    try:
        os.write(fd, data.encode("utf-8"))
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(str(tmp), str(path))


class SettlementJournal:
    """File-per-settlement journal under <root>/settlement/."""

    def __init__(self, root: Path, *, hooks: object | None = None):
        root = Path(root)
        self.dir = root / "settlement"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.hooks = hooks

    def _hook(self, name: str) -> None:
        fn = getattr(self.hooks, name, None)
        if callable(fn):
            fn()

    def _path(self, nonce: str) -> Path:
        if any(ch not in "0123456789abcdef" for ch in nonce) or len(nonce) != 64:
            raise SettlementError("nonce")
        return self.dir / f"{nonce}.settlement.json"

    def begin(self, *, nonce: str, operation: str, intent: dict) -> dict:
        """Durable PENDING record, written before the effect boundary."""
        rec = {
            "kind": "aukora-settlement/v1-toy",
            "nonce": nonce,
            "operation": operation,
            "state": "pending",
            "intent": intent,
        }
        _atomic_write_json(self._path(nonce), rec)
        self._hook("after_journal_pending")
        return rec

    def commit(self, nonce: str) -> dict:
        rec = self.read(nonce)
        if rec is None:
            raise SettlementError(SETTLEMENT_PENDING)
        rec["state"] = "committed"
        _atomic_write_json(self._path(nonce), rec)
        return rec

    def read(self, nonce: str) -> dict | None:
        path = self._path(nonce)
        if not path.exists():
            return None
        try:
            return read_json(path)
        except Exception as exc:  # unreadable journal is loud, never "clean"
            raise SettlementError(
                f"{SETTLEMENT_JOURNAL_UNREADABLE}: {path.name}"
            ) from exc

    def pending(self) -> list[dict]:
        """All settlements that never reached a committed boundary."""
        out: list[dict] = []
        for path in sorted(self.dir.glob("*.settlement.json")):
            try:
                rec = read_json(path)
            except Exception as exc:
                raise SettlementError(
                    f"{SETTLEMENT_JOURNAL_UNREADABLE}: {path.name}"
                ) from exc
            if rec.get("state") != "committed":
                out.append(rec)
        return out


def classify(pending: list[dict], aura_nonces: set[str]) -> list[dict]:
    """Turn pending settlements into named, non-success outcomes.

    `aura_nonces` are the settlement nonces that DID reach the Aura append.
    """
    findings: list[dict] = []
    for rec in pending:
        nonce = str(rec.get("nonce", ""))
        require_hex(nonce, 32)
        if nonce in aura_nonces:
            # Effect is present but the settlement was never marked committed.
            finding = INDETERMINATE
        else:
            # Authority provably consumed; whether the effect happened is
            # unknown. Never report this as a clean refusal.
            finding = AUTHORITY_CONSUMED_EFFECT_UNKNOWN
        findings.append(
            {
                "finding": finding,
                "nonce": nonce,
                "operation": rec.get("operation"),
                "intent": rec.get("intent") or {},
            }
        )
    return findings
