// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Deterministic canonical serialization (JCS-aligned). Object keys sorted ascending by UTF-16 code
 * unit; arrays preserved as given; numbers must be finite safe integers with a single spelling; -0 is
 * REJECTED at the canonicalizer itself (contract decision 14); strings via JSON escaping; UTF-8 output.
 * Also exposes strict canonical-wire verification (decision 15). Pure — no I/O.
 */

const encoder = new TextEncoder();

function encodeNumber(n: number): string {
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) throw new Error('E_BAD_INTEGER');
  if (Object.is(n, -0)) throw new Error('E_BAD_INTEGER'); // -0 has no canonical spelling
  return String(n);
}

// D2 (amendments 9-10): a lone surrogate has no valid UTF-8 encoding — reject it in the canonicalizer so
// neither the digest preimage nor verifyCanonicalWire can ever accept one, at any depth (keys or values).
function encodeString(s: string): string {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = s.charCodeAt(i + 1); if (!(n >= 0xdc00 && n <= 0xdfff)) throw new Error('E_INVALID_UTF8'); i++; }
    else if (c >= 0xdc00 && c <= 0xdfff) throw new Error('E_INVALID_UTF8');
  }
  return JSON.stringify(s);
}

export function canonicalString(value: unknown): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  const t = typeof value;
  if (t === 'number') return encodeNumber(value as number);
  if (t === 'string') return encodeString(value as string);
  if (Array.isArray(value)) {
    let out = '[';
    for (let i = 0; i < value.length; i++) { if (i > 0) out += ','; out += canonicalString(value[i]); }
    return out + ']';
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    let out = '{';
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) out += ',';
      out += encodeString(keys[i]) + ':' + canonicalString(obj[keys[i]]);
    }
    return out + '}';
  }
  throw new Error('E_WRONG_TYPE');
}

export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalString(value));
}

/**
 * Strict canonical-wire verification (contract decision 15): returns true only if `text` is EXACTLY
 * the canonical serialization of some accepted value. Rejects BOM, leading/trailing/alternate
 * whitespace, noncanonical escaping, alternate numeric encodings, malformed Unicode, and duplicate
 * keys (a duplicate collapses on parse, so re-canonicalization can never equal the input).
 */
export function verifyCanonicalWire(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (text.charCodeAt(0) === 0xFEFF) return false;            // BOM
  if (/^\s/.test(text) || /\s$/.test(text)) return false;      // leading/trailing whitespace
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return false; }
  try { return canonicalString(parsed) === text; } catch { return false; }
}
