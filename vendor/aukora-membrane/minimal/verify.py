#!/usr/bin/env python3
"""
Aukora Membrane — Standalone RFC 6962 Consistency Demonstrator
PERMITTED CLAIM: Retaining observation N enables checking presentation M.
FORBIDDEN CLAIMS: No occurrence, world truth, code execution, human identity.
NON-SUBJECT ASSUMPTION: Verification is executed cold on runner's own bytes.
VERDICTS:
- APPEND_ONLY        : Proof connects to head and matches retained root.
- OBSERVATION_CONFLICT: Proof connects to head but derives DIFFERENT root.
- UNDETERMINED       : Proof fails to connect, corrupted, or 2^k limit.
"""
import sys, json, hashlib, re

MAX_SAFE_INT = 9007199254740991

def sha256_node(l: str, r: str) -> str:
    return hashlib.sha256(bytes([0x01]) + bytes.fromhex(l) + bytes.fromhex(r)).hexdigest()

def is_power_of_two(v: int) -> bool: return v > 0 and (v & (v - 1)) == 0
def is_digest(v: object) -> bool:
    return isinstance(v, str) and len(v) == 64 and all(c in "0123456789abcdefABCDEF" for c in v)
def is_size(v: object) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= MAX_SAFE_INT

def verify_consistency(m: int, n: int, root1: str, root2: str, proof: list) -> tuple:
    if not is_size(m) or not is_size(n) or m > n: return ("UNDETERMINED", "invalid_tree_sizes")
    if not is_digest(root1) or not is_digest(root2): return ("UNDETERMINED", "root_is_not_a_digest")
    if not isinstance(proof, list) or not all(is_digest(p) for p in proof):
        return ("UNDETERMINED", "proof_element_is_not_a_digest")

    if m == 0: return ("UNDETERMINED", "missing_prior_observation")
    if m == n:
        if len(proof) != 0: return ("UNDETERMINED", "non_empty_proof_for_same_size")
        if root1.lower() == root2.lower(): return ("APPEND_ONLY", "identical_trees_match")
        return ("OBSERVATION_CONFLICT", "same_size_root_mismatch")

    if not proof or len(proof) == 0: return ("UNDETERMINED", "empty_proof_for_different_sizes")

    p_idx = 0
    if is_power_of_two(m): fr, sr = root1, root1
    else:
        fr, sr = proof[p_idx], proof[p_idx]
        p_idx += 1

    fn, sn = m - 1, n - 1
    while (fn & 1) == 1: fn, sn = fn >> 1, sn >> 1

    while sn > 0:
        if (fn & 1) == 1 or fn == sn:
            if p_idx >= len(proof): return ("UNDETERMINED", "proof_path_truncated")
            nxt = proof[p_idx]
            p_idx += 1
            fr, sr = sha256_node(nxt, fr), sha256_node(nxt, sr)
            while fn > 0 and (fn & 1) == 0: fn, sn = fn >> 1, sn >> 1
        else:
            if p_idx >= len(proof): return ("UNDETERMINED", "proof_path_truncated")
            nxt = proof[p_idx]
            p_idx += 1
            sr = sha256_node(sr, nxt)
        fn, sn = fn >> 1, sn >> 1

    if sr.lower() != root2.lower():
        if is_power_of_two(m): return ("UNDETERMINED", "POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE")
        return ("UNDETERMINED", "proof_did_not_connect_to_presented_head")
    if p_idx != len(proof): return ("UNDETERMINED", "unconsumed_proof_elements")

    if fr.lower() == root1.lower(): return ("APPEND_ONLY", "valid_append_only_extension")
    if is_power_of_two(m): return ("UNDETERMINED", "POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE")
    return ("OBSERVATION_CONFLICT", "consistency:prefix-mismatch")

USAGE = """aukora minimal verifier — did the log you were shown extend the log you kept?

  python3 verify.py <retained.json> <presented.json>
  python3 verify.py --selftest

Three verdicts, and no fourth:
  APPEND_ONLY           the proof folds to the presented head and reaches the root you retained
  OBSERVATION_CONFLICT  the proof folds to the presented head and reaches a DIFFERENT root
  UNDETERMINED          anything else — damaged, absent, or structurally underivable

UNDETERMINED IS NOT A SOFT NO AND APPEND_ONLY IS NOT TRUST. This checks arithmetic over two
observations. It says nothing about whether any leaf is true, whether the events occurred, or
whether the subject keeps only one log."""

# ONE TOKENIZER HOOKS — SINGLE PARSER ADMISSION LAYER
# Refuses duplicate keys, non-canonical integers, floats, constants in ONE json.loads pass.
def no_duplicate_keys(pairs):
    seen = set()
    for k, _ in pairs:
        if k in seen: raise ValueError("duplicate key")
        seen.add(k)
    return dict(pairs)

def check_canonical_int(s: str) -> int:
    if not re.match(r'^(0|[1-9][0-9]{0,15})$', s):
        raise ValueError(f"non-canonical int token: {s}")
    val = int(s)
    if val < 0 or val > MAX_SAFE_INT:
        raise ValueError(f"integer out of safe range: {s}")
    return val

def reject_float(s: str):
    raise ValueError(f"float token forbidden: {s}")

def reject_constant(s: str):
    raise ValueError(f"constant token forbidden: {s}")

def run_selftest() -> bool:
    print("aukora minimal verifier — standalone in-memory self-test\n")
    r5 = "6f7f213a4c7fe7c7b034c3879840a49918481b4796c7f8583d3604e09158fa4b"
    r14 = "9fde8beaf87fd07070b5bc2068ef543e830653ab0245412e8a6d25a829db78de"
    p5_14 = [
        "2117942a52d6136b5020766f489c4c95063c3dd7d050743685f1e58af4189c56",
        "9fd396c9621758169909f320cd76d6d13c47e1df1f2a52615e9c6968fed6eb43",
        "f54a41ca7a75620fad5c51ab8310dbf6ca91e9c56ed2e48be64297b9ca8b6b99",
        "90283eea2a3492d5a7219a00a16389e132f01600e947b06392b47dd95f7f1567",
        "e72cc2893ebac0de5b880d9ebe2dbb26f1fba9f5d8d4196295dd3e8f4c580e23"
    ]
    v1, r1 = verify_consistency(5, 14, r5, r14, p5_14)
    ok1 = (v1 == "APPEND_ONLY")
    print(f"  {'ok' if ok1 else 'FAIL'}  positive control (m=5, n=14) -> {v1}")

    r4 = "90283eea2a3492d5a7219a00a16389e132f01600e947b06392b47dd95f7f1567"
    p4_14 = [
        "1ecf2a95d2edb667f8009d3d80730298b5375a959e62152e666ddc04aa9a181d",
        "e72cc2893ebac0de5b880d9ebe2dbb26f1fba9f5d8d4196295dd3e8f4c580e23"
    ]
    v2, r2 = verify_consistency(4, 14, r4, r14, p4_14)
    ok2 = (v2 == "APPEND_ONLY")
    print(f"  {'ok' if ok2 else 'FAIL'}  power-of-two valid extension (m=4, n=14) -> {v2}")

    r5_bad = "00" * 32
    v3, r3 = verify_consistency(5, 14, r5_bad, r14, p5_14)
    ok3 = (v3 == "OBSERVATION_CONFLICT")
    print(f"  {'ok' if ok3 else 'FAIL'}  earned accusation (m=5, n=14, modified root) -> {v3}")

    p4_bad = ["00"*32] + p4_14[1:]
    v4, r4_reason = verify_consistency(4, 14, r4, r14, p4_bad)
    ok4 = (v4 == "UNDETERMINED" and r4_reason == "POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE")
    print(f"  {'ok' if ok4 else 'FAIL'}  power-of-two blind spot limit (m=4, n=14, corrupted proof) -> {v4} ({r4_reason})")

    all_ok = ok1 and ok2 and ok3 and ok4
    print(f"\nSELFTEST: {'4/4 checks passed — all green' if all_ok else 'FAILURES DETECTED'}")
    return all_ok

MAX_INPUT_BYTES = 1_048_576

class InputNotRegular(Exception): pass
class InputTooLarge(Exception): pass

def read_input_path(path: str) -> bytes:
    import os, stat, fcntl
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    except OSError as e:
        raise OSError(e.errno, f"open failed: {path}") from e
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise InputNotRegular(path)
        if st.st_size > MAX_INPUT_BYTES:
            raise InputTooLarge(path)
        fl = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, fl & ~os.O_NONBLOCK)
        data = os.read(fd, MAX_INPUT_BYTES + 1)
        if len(data) > MAX_INPUT_BYTES:
            raise InputTooLarge(path)
        return data
    finally:
        os.close(fd)

def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--selftest":
        ok = run_selftest()
        sys.exit(0 if ok else 1)
    if len(sys.argv) < 3:
        print(USAGE)
        sys.exit(2)
    try:
        ret_raw = read_input_path(sys.argv[1])
        pres_raw = read_input_path(sys.argv[2])
        print(f"RETAINED_SHA256 : {hashlib.sha256(ret_raw).hexdigest()}")
        print(f"PRESENTED_SHA256: {hashlib.sha256(pres_raw).hexdigest()}")
        try:
            ret_str = ret_raw.decode("utf-8")
            pres_str = pres_raw.decode("utf-8")
        except UnicodeDecodeError:
            print("VERDICT: UNDETERMINED\nREASON : parse_or_io_error"); sys.exit(1)

        try:
            ret = json.loads(
                ret_str, object_pairs_hook=no_duplicate_keys,
                parse_int=check_canonical_int, parse_float=reject_float, parse_constant=reject_constant
            )
            pres = json.loads(
                pres_str, object_pairs_hook=no_duplicate_keys,
                parse_int=check_canonical_int, parse_float=reject_float, parse_constant=reject_constant
            )
        except ValueError:
            print("VERDICT: UNDETERMINED\nREASON : document_is_not_admissible"); sys.exit(0)

        if "proofFromPrevious" not in pres:
            print("VERDICT: UNDETERMINED\nREASON : proof_field_absent"); sys.exit(0)

        verdict, reason = verify_consistency(
            ret.get("treeSize"), pres.get("treeSize"), ret.get("root"), pres.get("root"), pres["proofFromPrevious"])
        print(f"VERDICT: {verdict}\nREASON : {reason}")
        if verdict == "UNDETERMINED" and reason == "POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE":
            print("LIMIT: Retained m is 2^k; root1 is fold seed.")
        elif verdict == "OBSERVATION_CONFLICT":
            print(f"CLEAR: python3 verify.py {sys.argv[1]}")
    except InputNotRegular:
        print("VERDICT: UNDETERMINED\nREASON : input_is_not_a_regular_file"); sys.exit(0)
    except InputTooLarge:
        print("VERDICT: UNDETERMINED\nREASON : input_exceeds_size_limit"); sys.exit(0)
    except (OSError, json.JSONDecodeError):
        print("VERDICT: UNDETERMINED\nREASON : parse_or_io_error"); sys.exit(1)

if __name__ == "__main__": main()
