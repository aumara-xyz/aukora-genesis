"""Synthetic cold Alpha history checks; never invoke a producer or live authority."""
from __future__ import annotations

import base64
import copy
from decimal import Decimal
from fractions import Fraction
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from diamond.ed25519 import public_from_seed, sign

spec = importlib.util.spec_from_file_location("legacy_witness", ROOT / "profiles/alpha/legacy/witness.py")
witness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(witness)

# Fixed fixture-only keys. These never authorize effects, create files or enter runtime state.
SEED = bytes(range(32))
SECOND_SEED = bytes(reversed(range(32)))
PUB = public_from_seed(SEED)
SECOND_PUB = public_from_seed(SECOND_SEED)


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()


def hierarchy():
    def record(kid, raw):
        return {"bytes": raw, "jwk": {"kty": "OKP", "crv": "Ed25519", "kid": kid,
                "x": base64.urlsafe_b64encode(raw).decode().rstrip("=")}}
    return {"pubs": {"ep1": record("ep1", PUB), "ep2": record("ep2", SECOND_PUB)},
            "active_kid": "ep2", "epoch": 1,
            "limits": ["synthetic key hierarchy, not production authority"]}


def signed(body=None, seed=SEED):
    body = {"type": "event", "kid": "ep1", "domain": witness.EVIDENCE_DOMAIN,
            "value": {"note": "synthetic café 😀\n", "count": 3}} if body is None else dict(body)
    return dict(body, sig=base64.b64encode(sign(seed, encoded(body))).decode())


def rows(*entries):
    previous, result = witness.GENESIS, []
    for sequence, entry in enumerate(entries, 1):
        value = hashlib.sha256(previous.encode() + b"\n" + str(sequence).encode()
                               + b"\n" + encoded(entry)).hexdigest()
        result.append({"seq": sequence, "prev": previous, "entry": entry, "hash": value})
        previous = value
    return result


def checkpoint(previous):
    return signed({"type": "checkpoint", "at": 1234, "prevHead": previous,
                   "kid": "ep1", "domain": witness.EVIDENCE_DOMAIN})


class WitnessTests(unittest.TestCase):
    def refused(self, code, entries, retained=(), keys=None):
        with self.assertRaises(ValueError) as caught:
            witness.verify_history(entries, hierarchy() if keys is None else keys, retained)
        self.assertEqual(str(caught.exception), code)

    def test_signed_history_and_honest_extension(self):
        first, second = signed(), signed({"type": "next", "kid": "ep2"}, SECOND_SEED)
        history = rows(first, second)
        keys = hierarchy()
        before = copy.deepcopy((history, keys))
        result = witness.verify_history(history, keys, (witness.GENESIS, history[0]["hash"]))
        self.assertEqual((result["head"], result["count"], result["retainedCount"]),
                         (history[-1]["hash"], 2, 2))
        self.assertIsNone(result["checkpointSeq"])
        self.assertEqual(result["unsignedCovered"], 0)
        self.assertEqual((history, keys), before)
        self.assertIn("LATESTNESS_AND_COMPLETENESS: NOT_ESTABLISHED", result["limits"])

    def test_empty_history_is_explicit_and_not_a_signed_history_claim(self):
        result = witness.verify_history([], hierarchy(), (witness.GENESIS,))
        self.assertEqual((result["head"], result["count"], result["unsignedCovered"]),
                         (witness.GENESIS, 0, 0))
        self.assertIsNone(result["checkpointSeq"])
        self.refused("WITNESS_RETAINED_PREFIX_MISMATCH", [], ("0" * 64,))

    def test_checkpoint_covers_only_unsigned_prior_entries(self):
        old = {"type": "legacy", "value": 1}
        prefix = rows(old)
        history = rows(old, checkpoint(prefix[-1]["hash"]), signed())
        result = witness.verify_history(history, hierarchy())
        self.assertEqual((result["checkpointSeq"], result["unsignedCovered"]), (2, 1))
        self.assertTrue(any("does not authenticate each prior entry" in line for line in result["limits"]))

    def test_no_checkpoint_does_not_cover_unsigned_entries(self):
        self.refused("WITNESS_ENTRY_UNSIGNED:1", rows({"type": "legacy"}))

    def test_checkpoint_does_not_cover_later_unsigned_entries(self):
        self.refused("WITNESS_ENTRY_UNSIGNED:2", rows(checkpoint(witness.GENESIS), {"type": "legacy"}))

    def test_checkpoint_requires_signature_and_its_exact_position(self):
        self.refused("WITNESS_CHECKPOINT_UNSIGNED:1", rows({"type": "checkpoint", "prevHead": witness.GENESIS}))
        self.refused("WITNESS_CHECKPOINT_POSITION_INVALID:2",
                     rows(signed(), checkpoint(witness.GENESIS)))

    def test_all_checkpoint_positions_are_verified(self):
        first = checkpoint(witness.GENESIS)
        self.refused("WITNESS_CHECKPOINT_POSITION_INVALID:2", rows(first, first))

    def test_all_signatures_are_rechecked_with_retained_tips(self):
        history = rows(signed(), signed())
        with patch.object(witness, "verify", wraps=witness.verify) as verify_call:
            witness.verify_history(history, hierarchy(), (history[-1]["hash"],))
        self.assertEqual(verify_call.call_count, 2)

    def test_bad_signature_before_checkpoint_is_not_covered(self):
        entry = signed()
        entry["sig"] = base64.b64encode(bytes(64)).decode()
        prefix = rows(entry)
        self.refused("WITNESS_SIGNATURE_INVALID:1", rows(entry, checkpoint(prefix[-1]["hash"])))

    def test_bad_signature_is_not_excused_by_retained_tip(self):
        entry = signed()
        entry["value"]["count"] = 4
        history = rows(entry)
        self.refused("WITNESS_SIGNATURE_INVALID:1", history, (history[-1]["hash"],))

    def test_entry_domain_and_key_are_bound(self):
        self.refused("WITNESS_DOMAIN_INVALID:1", rows(signed({"domain": "other", "kid": "ep1"})))
        self.refused("WITNESS_KID_UNKNOWN:1", rows(signed({"kid": "unknown"})))
        self.refused("WITNESS_KID_UNKNOWN:1", rows(signed({"kid": 1})))
        self.refused("WITNESS_SIGNATURE_INVALID:1", rows(signed({"kid": "ep2"})))

    def test_kidless_predomain_signature_remains_supported(self):
        result = witness.verify_history(rows(signed({"type": "legacy"}, SECOND_SEED)), hierarchy())
        self.assertEqual(result["count"], 1)

    def test_signature_encoding_is_closed(self):
        for value in (None, "", "not-base64", base64.b64encode(bytes(63)).decode()):
            with self.subTest(value=value):
                self.refused("WITNESS_SIGNATURE_ENCODING:1", rows(dict(signed(), sig=value)))

    def test_chain_hash_previous_and_sequence_are_checked(self):
        for field, value, code in (("hash", "0" * 64, "WITNESS_CHAIN_BROKEN:1"),
                                    ("prev", "0" * 64, "WITNESS_CHAIN_BROKEN:1"),
                                    ("seq", 2, "WITNESS_SEQUENCE_INVALID:1"),
                                    ("seq", True, "WITNESS_SEQUENCE_INVALID:1")):
            with self.subTest(field=field, value=value):
                history = rows(signed())
                history[0][field] = value
                self.refused(code, history)

    def test_each_retained_tip_must_match_and_be_in_order(self):
        history = rows(signed(), signed())
        first, last = (entry["hash"] for entry in history)
        self.refused("WITNESS_RETAINED_PREFIX_MISMATCH", history[:1], (first, last))
        self.refused("WITNESS_RETAINED_PREFIX_MISMATCH", history, ("0" * 64, last))
        for retained in ((last, first), (first, first)):
            self.refused("WITNESS_RETAINED_ORDER_INVALID", history, retained)

    def test_ordinary_malformed_inputs_have_named_refusals(self):
        self.refused("WITNESS_ENTRIES_MALFORMED", {})
        self.refused("WITNESS_RETAINED_MALFORMED", [], "not-a-list")
        self.refused("WITNESS_RETAINED_MALFORMED", [], ({},))
        self.refused("WITNESS_ROW_MALFORMED:1", [None])
        self.refused("WITNESS_ROW_MALFORMED:1", [dict(rows(signed())[0], extra=True)])
        self.refused("WITNESS_ENTRY_MALFORMED:1", rows([]))

    def test_malformed_hierarchies_and_mismatched_key_bytes_refuse(self):
        for keys in ({}, {"pubs": {}}, dict(hierarchy(), active_kid="unknown"),
                     dict(hierarchy(), epoch=True), dict(hierarchy(), epoch=-1)):
            self.refused("WITNESS_HIERARCHY_MALFORMED", [], keys=keys)
        keys = hierarchy()
        keys["pubs"]["ep1"]["bytes"] = SECOND_PUB
        self.refused("WITNESS_HIERARCHY_MALFORMED", [], keys=keys)

    def test_unsupported_numbers_refuse_before_any_signature_check(self):
        for value in (1.0, float("nan"), float("inf"), 2**53, -(2**53), Decimal("1"), Fraction(1, 2)):
            with self.subTest(value=value), patch.object(witness, "verify") as verify_call:
                history = rows({"type": "legacy", "value": 1})
                history[0]["entry"]["value"] = value
                self.refused("WITNESS_UNSUPPORTED_NUMBER", history)
                verify_call.assert_not_called()

    def test_canonical_subset_preserves_safe_integers_and_unicode_values(self):
        body = {"value": [-(2**53 - 1), 2**53 - 1, True, None, "café 😀\t"]}
        self.assertEqual(witness.canonical(body), encoded(body))
        result = witness.verify_history(rows(signed(body)), hierarchy())
        self.assertEqual(result["count"], 1)
        for value, code in (({"é": 1}, "WITNESS_JSON_KEY_UNSUPPORTED"),
                            ({"value": "\ud800"}, "WITNESS_JSON_STRING_UNSUPPORTED"),
                            ({"value": b"bytes"}, "WITNESS_JSON_TYPE_UNSUPPORTED")):
            with self.assertRaises(ValueError) as caught:
                witness.canonical(value)
            self.assertEqual(str(caught.exception), code)


if __name__ == "__main__":
    unittest.main()
