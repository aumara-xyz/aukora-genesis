"""Cold verifier for consistency between two Aura checkpoint observations.

The verifier uses only Python's standard library and does not import the
JavaScript producer. It checks strict JSON, each checkpoint's size-bound root
commitment, equality of an unverified stream label, and an RFC 6962 consistency
proof.

Its result is evidence consistency only. It does not prove that checkpoint
contents are true, that the presented checkpoint is latest, or that either
checkpoint carries a valid signature.
"""

import hashlib
import json
import os
import stat
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Sequence, Tuple


APPEND_ONLY = "APPEND_ONLY"
OBSERVATION_CONFLICT = "OBSERVATION_CONFLICT"
UNDETERMINED = "UNDETERMINED"

_CHECKPOINT_DOMAIN = "aukora:aura-checkpoint:v1"
_ROOT_DOMAIN = b"aukora:aura-merkle-root:v2\0"
_MAX_FILE_BYTES = 1024 * 1024
_MAX_SAFE_INTEGER = (1 << 53) - 1
_HEX_DIGEST_LENGTH = 64
_RETAINED_KEYS = frozenset(
    ("domain", "treeSize", "root", "commitment", "streamNamespace")
)
_PRESENTED_KEYS = _RETAINED_KEYS | frozenset(("proofFromPrevious",))
_EMPTY_STRUCTURAL_ROOT = hashlib.sha256(b"").digest()
_CEILING = {
    "evidenceConsistencyOnly": True,
    "latestnessProven": False,
    "signatureProven": False,
    "truthProven": False,
}


class _InputError(ValueError):
    """An input cannot be evaluated under the checkpoint protocol."""


class _DuplicateKeyError(_InputError):
    """A JSON object repeats a member name."""


@dataclass(frozen=True)
class _Checkpoint:
    """Validated checkpoint fields used by the consistency calculation."""

    tree_size: int
    root: bytes
    commitment: bytes
    stream_namespace: str
    proof_from_previous: Tuple[bytes, ...]


def _result(verdict: str, reason: str) -> Dict[str, Any]:
    if verdict not in (APPEND_ONLY, OBSERVATION_CONFLICT, UNDETERMINED):
        raise ValueError("unknown verifier verdict")
    return {"verdict": verdict, "reason": reason, "ceiling": dict(_CEILING)}


def _read_regular_file(path: str) -> bytes:
    """Read one non-symlink regular file through a size-bounded descriptor."""

    try:
        path_stat = os.lstat(path)
    except (OSError, TypeError, ValueError) as error:
        raise _InputError("file-unavailable") from error
    if not stat.S_ISREG(path_stat.st_mode):
        raise _InputError("file-not-regular")
    if path_stat.st_size < 0 or path_stat.st_size > _MAX_FILE_BYTES:
        raise _InputError("file-size-invalid")

    flags = os.O_RDONLY
    flags |= getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    flags |= getattr(os, "O_NONBLOCK", 0)
    flags |= getattr(os, "O_BINARY", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise _InputError("file-unavailable") from error

    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise _InputError("file-not-regular")
        if before.st_size < 0 or before.st_size > _MAX_FILE_BYTES:
            raise _InputError("file-size-invalid")
        if (before.st_dev, before.st_ino) != (path_stat.st_dev, path_stat.st_ino):
            raise _InputError("file-changed")

        chunks: List[bytes] = []
        total = 0
        while total <= _MAX_FILE_BYTES:
            chunk = os.read(descriptor, min(65536, _MAX_FILE_BYTES + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        if total > _MAX_FILE_BYTES:
            raise _InputError("file-size-invalid")

        after = os.fstat(descriptor)
        before_identity = (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        )
        after_identity = (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        )
        if before_identity != after_identity or total != after.st_size:
            raise _InputError("file-changed")
        return b"".join(chunks)
    except OSError as error:
        raise _InputError("file-read-failed") from error
    finally:
        os.close(descriptor)


def _object_without_duplicates(pairs: Sequence[Tuple[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateKeyError("duplicate-json-key")
        result[key] = value
    return result


def _canonical_integer(raw: str) -> int:
    if raw == "0":
        return 0
    if not raw or raw[0] < "1" or raw[0] > "9" or not raw.isascii() or not raw.isdigit():
        raise _InputError("integer-not-canonical")
    if len(raw) > len(str(_MAX_SAFE_INTEGER)):
        raise _InputError("integer-not-safe")
    value = int(raw, 10)
    if value > _MAX_SAFE_INTEGER:
        raise _InputError("integer-not-safe")
    return value


def _reject_float(_raw: str) -> Any:
    raise _InputError("non-integer-number")


def _reject_constant(_raw: str) -> Any:
    raise _InputError("non-json-number")


def _load_json(path: str) -> Any:
    raw = _read_regular_file(path)
    try:
        text = raw.decode("utf-8", errors="strict")
        return json.loads(
            text,
            object_pairs_hook=_object_without_duplicates,
            parse_int=_canonical_integer,
            parse_float=_reject_float,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, _InputError, RecursionError) as error:
        raise _InputError("json-invalid") from error


def _digest(value: Any) -> bytes:
    if type(value) is not str or len(value) != _HEX_DIGEST_LENGTH:
        raise _InputError("digest-invalid")
    if any(character not in "0123456789abcdef" for character in value):
        raise _InputError("digest-invalid")
    return bytes.fromhex(value)


def _checkpoint(value: Any, presented: bool) -> _Checkpoint:
    expected_keys = _PRESENTED_KEYS if presented else _RETAINED_KEYS
    if type(value) is not dict or frozenset(value.keys()) != expected_keys:
        raise _InputError("checkpoint-fields-invalid")
    if value["domain"] != _CHECKPOINT_DOMAIN:
        raise _InputError("checkpoint-domain-invalid")

    tree_size = value["treeSize"]
    if type(tree_size) is not int or tree_size < 0 or tree_size > _MAX_SAFE_INTEGER:
        raise _InputError("tree-size-invalid")

    stream_namespace = value["streamNamespace"]
    _digest(stream_namespace)

    proof: Tuple[bytes, ...] = ()
    if presented:
        proof_value = value["proofFromPrevious"]
        if type(proof_value) is not list:
            raise _InputError("consistency-proof-invalid")
        proof = tuple(_digest(step) for step in proof_value)

    return _Checkpoint(
        tree_size=tree_size,
        root=_digest(value["root"]),
        commitment=_digest(value["commitment"]),
        stream_namespace=stream_namespace,
        proof_from_previous=proof,
    )


def _root_commitment(tree_size: int, structural_root: bytes) -> bytes:
    encoded_size = tree_size.to_bytes(8, byteorder="big", signed=False)
    return hashlib.sha256(_ROOT_DOMAIN + encoded_size + structural_root).digest()


def _node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(b"\x01" + left + right).digest()


def _verify_consistency(
    previous_size: int,
    presented_size: int,
    previous_root: bytes,
    presented_root: bytes,
    proof: Sequence[bytes],
) -> Tuple[str, str]:
    """Classify one RFC 6962 consistency proof over structural tree roots."""

    if previous_size == 0:
        return UNDETERMINED, "empty-retained-checkpoint"
    if previous_size > presented_size:
        return UNDETERMINED, "presented-tree-smaller"
    if previous_size == presented_size:
        if previous_root != presented_root:
            return OBSERVATION_CONFLICT, "same-size-root-conflict"
        if proof:
            return UNDETERMINED, "consistency-proof-extra"
        return APPEND_ONLY, "consistent-checkpoint"

    first_node = previous_size - 1
    second_node = presented_size - 1
    while first_node & 1:
        first_node >>= 1
        second_node >>= 1

    proof_index = 0
    if first_node == 0:
        first_hash = previous_root
        second_hash = previous_root
        independently_reconstructs_previous = False
    else:
        if not proof:
            return UNDETERMINED, "consistency-proof-missing"
        first_hash = proof[0]
        second_hash = proof[0]
        proof_index = 1
        independently_reconstructs_previous = True

    while proof_index < len(proof):
        if second_node == 0:
            return UNDETERMINED, "consistency-proof-extra"
        proof_hash = proof[proof_index]
        if (first_node & 1) or first_node == second_node:
            first_hash = _node_hash(proof_hash, first_hash)
            second_hash = _node_hash(proof_hash, second_hash)
            while first_node != 0 and not (first_node & 1):
                first_node >>= 1
                second_node >>= 1
        else:
            second_hash = _node_hash(second_hash, proof_hash)
        first_node >>= 1
        second_node >>= 1
        proof_index += 1

    if second_node != 0:
        return UNDETERMINED, "consistency-proof-incomplete"
    if second_hash != presented_root:
        return UNDETERMINED, "consistency-proof-presented-root-mismatch"
    if first_hash != previous_root:
        if independently_reconstructs_previous:
            return OBSERVATION_CONFLICT, "retained-prefix-root-conflict"
        return UNDETERMINED, "consistency-proof-retained-root-mismatch"
    return APPEND_ONLY, "consistent-extension"


def evaluate_paths(retained_path: str, presented_path: str) -> Dict[str, Any]:
    """Evaluate one retained checkpoint against one presented checkpoint."""

    try:
        retained = _checkpoint(_load_json(retained_path), presented=False)
    except _InputError:
        return _result(UNDETERMINED, "retained-input-invalid")
    try:
        presented = _checkpoint(_load_json(presented_path), presented=True)
    except _InputError:
        return _result(UNDETERMINED, "presented-input-invalid")

    if retained.commitment != _root_commitment(retained.tree_size, retained.root):
        return _result(UNDETERMINED, "retained-commitment-mismatch")
    if retained.tree_size == 0 and retained.root != _EMPTY_STRUCTURAL_ROOT:
        return _result(UNDETERMINED, "retained-empty-root-mismatch")
    if presented.commitment != _root_commitment(presented.tree_size, presented.root):
        return _result(UNDETERMINED, "presented-commitment-mismatch")
    if presented.tree_size == 0 and presented.root != _EMPTY_STRUCTURAL_ROOT:
        return _result(UNDETERMINED, "presented-empty-root-mismatch")
    if retained.stream_namespace != presented.stream_namespace:
        return _result(UNDETERMINED, "stream-namespace-mismatch")
    verdict, reason = _verify_consistency(
        retained.tree_size,
        presented.tree_size,
        retained.root,
        presented.root,
        presented.proof_from_previous,
    )
    return _result(verdict, reason)


def _render(result: Dict[str, Any]) -> str:
    return json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _write_stdout_record(result: Dict[str, Any]) -> None:
    """Write one ASCII JSON record with an LF terminator on every platform."""

    payload = (_render(result) + "\n").encode("ascii")
    binary_stream = getattr(sys.stdout, "buffer", None)
    if binary_stream is None:
        sys.stdout.write(payload.decode("ascii"))
        return
    binary_stream.write(payload)
    binary_stream.flush()


def main(arguments: Sequence[str] = ()) -> int:
    """Run the two-path command-line verifier and print one deterministic record."""

    if len(arguments) != 2:
        result = _result(UNDETERMINED, "usage")
        exit_code = 2
    else:
        result = evaluate_paths(arguments[0], arguments[1])
        exit_code = 0
    _write_stdout_record(result)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
