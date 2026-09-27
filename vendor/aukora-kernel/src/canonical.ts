// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { KernelInputError } from "./errors.js";

export type CanonicalPrimitive = null | boolean | number | string;
export type CanonicalValue = CanonicalPrimitive | readonly CanonicalValue[] | { readonly [key: string]: CanonicalValue };

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function assertCanonicalValue(value: unknown, path = "$"): asserts value is CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new KernelInputError(`canonical_unsafe_number:${path}`);
    return;
  }
  if (Array.isArray(value)) {
    // Hostile-input hardening (R52/#116): reject a SPARSE array (a hole is `undefined`, not a canonical
    // value, yet `forEach`/`map` skip holes) and an array carrying any non-index own property (a named
    // property is silently dropped by `canonicalJson`, so `[1]` and `[1]` + a hidden `.foo` would collide to
    // the same bytes — an injectivity break). A dense, index-only array's own keys are exactly the indices
    // 0..length-1 plus `length`; any other own key (a hole's absence, a named string key, a symbol key)
    // changes this count. Valid dense arrays are unaffected, so no existing canonical encoding changes.
    if (Reflect.ownKeys(value).length !== value.length + 1) throw new KernelInputError(`canonical_array_shape:${path}`);
    value.forEach((entry, index) => assertCanonicalValue(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || !isPlainObject(value)) throw new KernelInputError(`canonical_type:${path}`);
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) throw new KernelInputError(`canonical_undefined:${path}.${key}`);
    assertCanonicalValue(entry, `${path}.${key}`);
  }
}

export function canonicalJson(value: CanonicalValue): string {
  assertCanonicalValue(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const objectValue = value as { readonly [key: string]: CanonicalValue };
  const entries = Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`);
  return `{${entries.join(",")}}`;
}

export function canonicalBytes(value: CanonicalValue): Uint8Array {
  return utf8ToBytes(canonicalJson(value));
}

export function canonicalHash(value: CanonicalValue): string {
  return bytesToHex(sha256(canonicalBytes(value)));
}

function decodeUtf8(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    if (first <= 0x7f) { output += String.fromCodePoint(first); continue; }
    let needed: number, point: number, minimum: number;
    if (first >= 0xc2 && first <= 0xdf) { needed = 1; point = first & 0x1f; minimum = 0x80; }
    else if (first >= 0xe0 && first <= 0xef) { needed = 2; point = first & 0x0f; minimum = 0x800; }
    else if (first >= 0xf0 && first <= 0xf4) { needed = 3; point = first & 0x07; minimum = 0x10000; }
    else throw new KernelInputError("canonical_utf8_invalid");
    if (index + needed > bytes.length) throw new KernelInputError("canonical_utf8_invalid");
    for (let offset = 0; offset < needed; offset++) {
      const next = bytes[index++];
      if ((next & 0xc0) !== 0x80) throw new KernelInputError("canonical_utf8_invalid");
      point = (point << 6) | (next & 0x3f);
    }
    if (point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new KernelInputError("canonical_utf8_invalid");
    output += String.fromCodePoint(point);
  }
  return output;
}

export function parseCanonicalBytes(bytes: Uint8Array): CanonicalValue {
  if (!(bytes instanceof Uint8Array)) throw new KernelInputError("canonical_bytes_required");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(bytes));
  } catch {
    throw new KernelInputError("canonical_json_invalid");
  }
  assertCanonicalValue(parsed);
  const encoded = canonicalBytes(parsed);
  if (encoded.length !== bytes.length || encoded.some((byte, index) => byte !== bytes[index])) {
    throw new KernelInputError("canonical_bytes_noncanonical");
  }
  return parsed;
}
