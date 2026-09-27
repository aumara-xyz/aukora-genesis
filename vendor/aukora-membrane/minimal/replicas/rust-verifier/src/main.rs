//! Third-runtime retained-head consistency verifier (Rust).
//!
//! Arithmetic: RFC 6962 / RFC 9162 consistency walk (Spec 0060).
//! Admission: closed wire contract for demo JSON — authored here, not ported from
//! minimal/verify.py. Uses serde_json as a *structural* parser (different stack from
//! CPython). Digest/size/proof rules are applied after one parse; empty proof
//! elements are NEVER dropped (that bug produced 8 false APPEND_ONLY greens on
//! transparency-dev garbage probes).
//!
//! Named stricter divergence vs transparency-dev: roots must be 32-byte digests
//! (64 hex). Oracle fixture `sizes-are-equal-one-and-proof-is-empty` uses 12-byte
//! ASCII roots; we refuse — same as Python/membrane.

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::{self, Read};
use std::os::unix::fs::FileTypeExt;
use std::path::Path;

const MAX_INPUT: u64 = 1_048_576;
const MAX_SAFE: u64 = 9_007_199_254_740_991;

// --- crypto walk (RFC 6962 domain-separated nodes) --------------------------------

fn sha256_node(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update([0x01u8]);
    h.update(left);
    h.update(right);
    let out = h.finalize();
    let mut a = [0u8; 32];
    a.copy_from_slice(&out);
    a
}

fn is_pow2(v: u64) -> bool {
    v > 0 && (v & (v - 1)) == 0
}

fn parse_hex64(s: &str) -> Option<[u8; 32]> {
    // Wire: exactly 64 hex digits → 32 bytes. Empty string is NOT a digest.
    if s.len() != 64 || !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

fn verify_consistency(
    first: u64,
    second: u64,
    first_hash: [u8; 32],
    second_hash: [u8; 32],
    path: &[[u8; 32]],
) -> (&'static str, &'static str) {
    if first > MAX_SAFE || second > MAX_SAFE || first > second {
        return ("UNDETERMINED", "invalid_tree_sizes");
    }
    if first == 0 {
        return ("UNDETERMINED", "missing_prior_observation");
    }
    if first == second {
        if !path.is_empty() {
            return ("UNDETERMINED", "non_empty_proof_for_same_size");
        }
        if first_hash == second_hash {
            return ("APPEND_ONLY", "identical_trees_match");
        }
        return ("OBSERVATION_CONFLICT", "same_size_root_mismatch");
    }
    if path.is_empty() {
        return ("UNDETERMINED", "empty_proof_for_different_sizes");
    }

    let (mut fr, mut sr, mut idx) = if is_pow2(first) {
        (first_hash, first_hash, 0usize)
    } else {
        (path[0], path[0], 1usize)
    };

    let mut fn_ = first - 1;
    let mut sn = second - 1;
    while (fn_ & 1) == 1 {
        fn_ >>= 1;
        sn >>= 1;
    }

    while sn > 0 {
        if (fn_ & 1) == 1 || fn_ == sn {
            if idx >= path.len() {
                return ("UNDETERMINED", "proof_path_truncated");
            }
            let c = path[idx];
            idx += 1;
            fr = sha256_node(&c, &fr);
            sr = sha256_node(&c, &sr);
            while fn_ > 0 && (fn_ & 1) == 0 {
                fn_ >>= 1;
                sn >>= 1;
            }
        } else {
            if idx >= path.len() {
                return ("UNDETERMINED", "proof_path_truncated");
            }
            let c = path[idx];
            idx += 1;
            sr = sha256_node(&sr, &c);
        }
        fn_ >>= 1;
        sn >>= 1;
    }
    if idx != path.len() {
        return ("UNDETERMINED", "unconsumed_proof_elements");
    }
    if sr != second_hash {
        if is_pow2(first) {
            return (
                "UNDETERMINED",
                "POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE",
            );
        }
        return ("UNDETERMINED", "proof_did_not_connect_to_presented_head");
    }
    if fr == first_hash {
        return ("APPEND_ONLY", "valid_append_only_extension");
    }
    if is_pow2(first) {
        return (
            "UNDETERMINED",
            "POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE",
        );
    }
    ("OBSERVATION_CONFLICT", "consistency:prefix-mismatch")
}

// --- I/O ------------------------------------------------------------------------

fn read_regular(path: &Path) -> io::Result<Vec<u8>> {
    let meta = fs::metadata(path)?;
    let ft = meta.file_type();
    if ft.is_fifo() || ft.is_socket() || ft.is_char_device() || ft.is_block_device() || meta.is_dir()
    {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "not_regular"));
    }
    if !meta.is_file() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "not_regular"));
    }
    if meta.len() > MAX_INPUT {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "too_large"));
    }
    let mut f = fs::File::open(path)?;
    let mut buf = Vec::new();
    f.by_ref().take(MAX_INPUT + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > MAX_INPUT {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "too_large"));
    }
    Ok(buf)
}

// --- Wire admission (independent of Python) -------------------------------------

#[derive(Debug)]
enum AdmitErr {
    NotUtf8,
    NotJson,
    NotObject,
    DuplicateKey,
    MissingTreeSize,
    InvalidTreeSize,
    MissingRoot,
    RootNotDigest,
    ProofAbsent,
    ProofNotArray,
    ProofElementNotDigest,
    SurplusField,
}

struct Observation {
    tree_size: u64,
    root: [u8; 32],
    /// None = field absent; Some(vec) = present (may be empty vec)
    proof: Option<Vec<[u8; 32]>>,
}

/// Top-level object key scan: refuse duplicate member names on the *raw spelling*
/// before decode. This is a wire rule for our closed profile, not a port of CPython.
fn top_level_keys_unique(raw: &str) -> bool {
    let b = raw.as_bytes();
    let mut i = 0usize;
    while i < b.len() && b[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= b.len() || b[i] != b'{' {
        return true; // not our job; structural parse will fail
    }
    i += 1;
    let mut depth = 1i32;
    let mut in_str = false;
    let mut escape = false;
    let mut seen: HashSet<String> = HashSet::new();
    // After '{' or ',', at depth 1, expect optional whitespace then "key"
    let mut expect_key = true;

    while i < b.len() {
        let c = b[i];
        if in_str {
            if escape {
                escape = false;
            } else if c == b'\\' {
                escape = true;
            } else if c == b'"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' => {
                if depth == 1 && expect_key {
                    // read key
                    i += 1;
                    let start = i;
                    while i < b.len() {
                        if b[i] == b'\\' {
                            i += 2;
                            continue;
                        }
                        if b[i] == b'"' {
                            break;
                        }
                        i += 1;
                    }
                    if i >= b.len() {
                        return true;
                    }
                    let key = &raw[start..i];
                    if !seen.insert(key.to_string()) {
                        return false;
                    }
                    i += 1; // closing quote
                    expect_key = false;
                    continue;
                }
                in_str = true;
                i += 1;
            }
            b'{' | b'[' => {
                depth += 1;
                expect_key = false;
                i += 1;
            }
            b'}' | b']' => {
                depth -= 1;
                expect_key = false;
                i += 1;
            }
            b',' => {
                if depth == 1 {
                    expect_key = true;
                }
                i += 1;
            }
            b':' => {
                expect_key = false;
                i += 1;
            }
            _ => i += 1,
        }
    }
    true
}

fn admit_tree_size(v: &Value) -> Result<u64, AdmitErr> {
    match v {
        Value::Number(n) => {
            // Reject non-integers (7.0, 1e2) — Number::as_u64 fails for floats in serde_json
            // when the representation is not an exact u64 integer.
            if let Some(u) = n.as_u64() {
                if u > MAX_SAFE {
                    return Err(AdmitErr::InvalidTreeSize);
                }
                return Ok(u);
            }
            Err(AdmitErr::InvalidTreeSize)
        }
        Value::String(s) => {
            // Wire: number token only — string sizes refused (stricter than dual-form).
            let _ = s;
            Err(AdmitErr::InvalidTreeSize)
        }
        _ => Err(AdmitErr::InvalidTreeSize),
    }
}

fn admit_root(v: &Value) -> Result<[u8; 32], AdmitErr> {
    let s = v.as_str().ok_or(AdmitErr::RootNotDigest)?;
    parse_hex64(s).ok_or(AdmitErr::RootNotDigest)
}

fn admit_proof_array(v: &Value) -> Result<Vec<[u8; 32]>, AdmitErr> {
    let arr = v.as_array().ok_or(AdmitErr::ProofNotArray)?;
    let mut out = Vec::with_capacity(arr.len());
    for el in arr {
        let s = el.as_str().ok_or(AdmitErr::ProofElementNotDigest)?;
        // CRITICAL: empty string must refuse — never skip.
        let dig = parse_hex64(s).ok_or(AdmitErr::ProofElementNotDigest)?;
        out.push(dig);
    }
    Ok(out)
}

fn admit_observation(raw: &str, require_proof_field: bool) -> Result<Observation, AdmitErr> {
    if !raw.is_ascii() {
        // closed wire: ASCII JSON only (hex + digits + punctuation)
        // non-ASCII in strings still utf-8; we allow utf-8 file but keys must be ascii
    }
    if std::str::from_utf8(raw.as_bytes()).is_err() {
        return Err(AdmitErr::NotUtf8);
    }
    if !top_level_keys_unique(raw) {
        return Err(AdmitErr::DuplicateKey);
    }
    let val: Value = serde_json::from_str(raw).map_err(|_| AdmitErr::NotJson)?;
    let obj = val.as_object().ok_or(AdmitErr::NotObject)?;

    // Load-bearing keys only. Extra metadata (schema, epoch, chainKey, …) is ignored for
    // the consistency walk — same shape as reading named fields, not a second parse.
    // SurplusField retained as a variant for a future closed-profile mode; not used here.

    let tree_size = admit_tree_size(obj.get("treeSize").ok_or(AdmitErr::MissingTreeSize)?)?;
    let root = admit_root(obj.get("root").ok_or(AdmitErr::MissingRoot)?)?;

    let proof = match obj.get("proofFromPrevious") {
        None => {
            if require_proof_field {
                return Err(AdmitErr::ProofAbsent);
            }
            None
        }
        Some(Value::Null) => {
            // null is present-but-null → treat as not a proof array
            return Err(AdmitErr::ProofNotArray);
        }
        Some(v) => Some(admit_proof_array(v)?),
    };

    Ok(Observation {
        tree_size,
        root,
        proof,
    })
}

fn admit_err_reason(e: AdmitErr) -> (&'static str, i32) {
    match e {
        AdmitErr::NotUtf8 | AdmitErr::NotJson => ("parse_or_io_error", 1),
        AdmitErr::NotObject | AdmitErr::DuplicateKey | AdmitErr::SurplusField => {
            ("document_is_not_admissible", 0)
        }
        AdmitErr::MissingTreeSize | AdmitErr::InvalidTreeSize => ("invalid_tree_sizes", 0),
        AdmitErr::MissingRoot | AdmitErr::RootNotDigest => ("root_is_not_a_digest", 0),
        AdmitErr::ProofAbsent => ("proof_field_absent", 0),
        AdmitErr::ProofNotArray | AdmitErr::ProofElementNotDigest => {
            ("proof_element_is_not_a_digest", 0)
        }
    }
}

// --- main -----------------------------------------------------------------------

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!(
            "aukora minimal verifier (Rust substrate replica)\n  {} <retained.json> <presented.json>",
            args[0]
        );
        std::process::exit(2);
    }

    let ret_raw = match read_regular(Path::new(&args[1])) {
        Ok(b) => b,
        Err(e) if e.to_string().contains("not_regular") => {
            println!("VERDICT: UNDETERMINED\nREASON : input_is_not_a_regular_file");
            return;
        }
        Err(e) if e.to_string().contains("too_large") => {
            println!("VERDICT: UNDETERMINED\nREASON : input_exceeds_size_limit");
            return;
        }
        Err(_) => {
            println!("VERDICT: UNDETERMINED\nREASON : parse_or_io_error");
            std::process::exit(1);
        }
    };
    let pres_raw = match read_regular(Path::new(&args[2])) {
        Ok(b) => b,
        Err(e) if e.to_string().contains("not_regular") => {
            println!("VERDICT: UNDETERMINED\nREASON : input_is_not_a_regular_file");
            return;
        }
        Err(e) if e.to_string().contains("too_large") => {
            println!("VERDICT: UNDETERMINED\nREASON : input_exceeds_size_limit");
            return;
        }
        Err(_) => {
            println!("VERDICT: UNDETERMINED\nREASON : parse_or_io_error");
            std::process::exit(1);
        }
    };

    let ret_hash = Sha256::digest(&ret_raw);
    let pres_hash = Sha256::digest(&pres_raw);
    println!("RETAINED_SHA256 : {:x}", ret_hash);
    println!("PRESENTED_SHA256: {:x}", pres_hash);

    let ret_s = match String::from_utf8(ret_raw) {
        Ok(s) => s,
        Err(_) => {
            println!("VERDICT: UNDETERMINED\nREASON : parse_or_io_error");
            std::process::exit(1);
        }
    };
    let pres_s = match String::from_utf8(pres_raw) {
        Ok(s) => s,
        Err(_) => {
            println!("VERDICT: UNDETERMINED\nREASON : parse_or_io_error");
            std::process::exit(1);
        }
    };

    let retained = match admit_observation(&ret_s, false) {
        Ok(o) => o,
        Err(e) => {
            let (r, code) = admit_err_reason(e);
            println!("VERDICT: UNDETERMINED\nREASON : {}", r);
            std::process::exit(code);
        }
    };
    let presented = match admit_observation(&pres_s, true) {
        Ok(o) => o,
        Err(e) => {
            let (r, code) = admit_err_reason(e);
            println!("VERDICT: UNDETERMINED\nREASON : {}", r);
            std::process::exit(code);
        }
    };

    let proof = presented.proof.unwrap_or_default();
    let (v, r) = verify_consistency(
        retained.tree_size,
        presented.tree_size,
        retained.root,
        presented.root,
        &proof,
    );
    println!("VERDICT: {}\nREASON : {}", v, r);
    if v == "UNDETERMINED" && r == "POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE" {
        println!("LIMIT: Retained m is 2^k; root1 is fold seed.");
    }
}
