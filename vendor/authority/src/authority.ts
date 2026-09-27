// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { PURPOSE_DOMAINS } from "./registry.js";
import {
  assertAuthorityRoot,
  assertSignedPromotion,
  type AumlokAuthorityRootV2,
  type PromotionAuthorizationV2,
  type SignedPromotionV2,
} from "./schema.js";

const ML_DSA_65_PUBLIC_KEY_HEX = 1952 * 2;
const ML_DSA_65_SIGNATURE_HEX = 3309 * 2;
const HEX_LOWER = /^[0-9a-f]+$/;
const AUMLOK_SUITE = "aumlok-ed25519-ml-dsa-65-v1" as const;

export type VerificationVerdict = { valid: true } | { valid: false; reason: string };

function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** Strict UTC millisecond parser with no ambient clock or platform date parser. */
export function parseCanonicalIsoUtcMs(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(value);
  if (!match) return null;
  const [, ys, mos, ds, hs, mis, ss, mss] = match;
  const year = Number(ys), month = Number(mos), day = Number(ds);
  const hour = Number(hs), minute = Number(mis), second = Number(ss), millis = Number(mss);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const result = (((daysFromCivil(year, month, day) * 24 + hour) * 60 + minute) * 60 + second) * 1000 + millis;
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

export function aumlokRootId(publicKeys: AumlokAuthorityRootV2["publicKeys"]): string {
  return sha256Hex(JSON.stringify({ suite: AUMLOK_SUITE, ed25519: publicKeys.ed25519, mlDsa65: publicKeys.mlDsa65 }));
}

export function aumlokRootIntegrity(root: Omit<AumlokAuthorityRootV2, "integrity">): string {
  return sha256Hex(JSON.stringify({
    schema: root.schema,
    suite: root.suite,
    rootId: root.rootId,
    publicKeys: { ed25519: root.publicKeys.ed25519, mlDsa65: root.publicKeys.mlDsa65 },
    mode: root.mode,
    createdAt: root.createdAt,
    expiresAt: root.expiresAt,
    revoked: root.revoked,
  }));
}

export function canonicalAumlokPromotion(authorization: PromotionAuthorizationV2): Uint8Array {
  return utf8ToBytes(JSON.stringify({
    _: "aumlok-signed-promotion-v2",
    suite: AUMLOK_SUITE,
    rootId: authorization.rootId,
    proposalHash: authorization.proposalHash,
    draftHash: authorization.draftHash,
    nonce: authorization.nonce,
    issuedAt: authorization.issuedAt,
    expiresAt: authorization.expiresAt,
  }));
}

function verifyMlDsa65(publicKeyHex: string, message: Uint8Array, signatureHex: string, contextLabel: string): boolean {
  try {
    if (publicKeyHex.length !== ML_DSA_65_PUBLIC_KEY_HEX || !HEX_LOWER.test(publicKeyHex)) return false;
    if (signatureHex.length !== ML_DSA_65_SIGNATURE_HEX || !HEX_LOWER.test(signatureHex)) return false;
    return ml_dsa65.verify(hexToBytes(signatureHex), message, hexToBytes(publicKeyHex), { context: utf8ToBytes(contextLabel) });
  } catch {
    return false;
  }
}

export function verifyAumlokPromotionV2(receipt: SignedPromotionV2, root: AumlokAuthorityRootV2, nowMs: number): VerificationVerdict {
  try {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return { valid: false, reason: "now_invalid" };
    assertAuthorityRoot(root);
    assertSignedPromotion(receipt);
    if (root.rootId !== aumlokRootId(root.publicKeys)) return { valid: false, reason: "root_id_mismatch" };
    const { integrity: _integrity, ...unsignedRoot } = root;
    if (root.integrity !== aumlokRootIntegrity(unsignedRoot)) return { valid: false, reason: "root_integrity_invalid" };
    if (root.revoked) return { valid: false, reason: "root_revoked" };
    if (receipt.authorization.rootId !== root.rootId) return { valid: false, reason: "root_id_mismatch" };
    const rootExpiry = root.expiresAt === null ? null : parseCanonicalIsoUtcMs(root.expiresAt);
    const authorizationExpiry = receipt.authorization.expiresAt === null ? null : parseCanonicalIsoUtcMs(receipt.authorization.expiresAt);
    if (root.expiresAt !== null && rootExpiry === null) return { valid: false, reason: "root_expiry_invalid" };
    if (receipt.authorization.expiresAt !== null && authorizationExpiry === null) return { valid: false, reason: "authorization_expiry_invalid" };
    const rootCreated = parseCanonicalIsoUtcMs(root.createdAt);
    const authorizationIssued = parseCanonicalIsoUtcMs(receipt.authorization.issuedAt);
    if (rootCreated === null || authorizationIssued === null) return { valid: false, reason: "time_invalid" };
    if (rootCreated > nowMs) return { valid: false, reason: "root_not_yet_valid" };
    if (authorizationIssued < rootCreated) return { valid: false, reason: "authorization_predates_root" };
    if (authorizationIssued > nowMs) return { valid: false, reason: "authorization_not_yet_valid" };
    if (rootExpiry !== null && rootExpiry < rootCreated) return { valid: false, reason: "root_time_range_invalid" };
    if (authorizationExpiry !== null && authorizationExpiry < authorizationIssued) return { valid: false, reason: "authorization_time_range_invalid" };
    if (rootExpiry !== null && nowMs > rootExpiry) return { valid: false, reason: "root_expired" };
    if (authorizationExpiry !== null && nowMs > authorizationExpiry) return { valid: false, reason: "authorization_expired" };
    const message = canonicalAumlokPromotion(receipt.authorization);
    let edValid = false;
    try {
      edValid = ed25519.verify(hexToBytes(receipt.signatures.ed25519), message, hexToBytes(root.publicKeys.ed25519));
    } catch {
      edValid = false;
    }
    if (!edValid) return { valid: false, reason: "ed25519_signature_invalid" };
    if (!verifyMlDsa65(root.publicKeys.mlDsa65, message, receipt.signatures.mlDsa65, PURPOSE_DOMAINS.aumlokPromotion)) {
      return { valid: false, reason: "ml_dsa_65_signature_invalid" };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: "malformed" };
  }
}

export interface ChainHeadFieldsV4 {
  chainKey: string;
  timestamp: number;
  chainLength: number;
  chainHeadHash: string;
}

function writeU64BE(buffer: Uint8Array, offset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("signed_head_u64_invalid");
  const high = Math.floor(value / 0x100000000);
  const low = value >>> 0;
  buffer[offset] = (high >>> 24) & 0xff;
  buffer[offset + 1] = (high >>> 16) & 0xff;
  buffer[offset + 2] = (high >>> 8) & 0xff;
  buffer[offset + 3] = high & 0xff;
  buffer[offset + 4] = (low >>> 24) & 0xff;
  buffer[offset + 5] = (low >>> 16) & 0xff;
  buffer[offset + 6] = (low >>> 8) & 0xff;
  buffer[offset + 7] = low & 0xff;
}

export function deriveChainId(chainKey: string): Uint8Array {
  return sha256(concatBytes(utf8ToBytes("aukora-chain"), utf8ToBytes(chainKey))).slice(0, 16);
}

export function serializeReceiptHeadV4(head: ChainHeadFieldsV4, merkleRootHex: string): Uint8Array {
  if (typeof head.chainKey !== "string" || head.chainKey.length === 0) throw new Error("signed_head_chain_key_invalid");
  if (!/^[0-9a-f]{64}$/.test(head.chainHeadHash) || !/^[0-9a-f]{64}$/.test(merkleRootHex)) throw new Error("signed_head_hash_invalid");
  const bytes = new Uint8Array(98);
  bytes[0] = 0x04;
  bytes[1] = 0x04;
  bytes.set(deriveChainId(head.chainKey), 2);
  writeU64BE(bytes, 18, head.timestamp);
  writeU64BE(bytes, 26, head.chainLength);
  bytes.set(hexToBytes(head.chainHeadHash), 34);
  bytes.set(hexToBytes(merkleRootHex), 66);
  return bytes;
}

export function verifyReceiptHeadV4(
  publicKeyHex: string,
  head: ChainHeadFieldsV4,
  merkleRootHex: string,
  signatureHex: string,
): boolean {
  try {
    return verifyMlDsa65(publicKeyHex, serializeReceiptHeadV4(head, merkleRootHex), signatureHex, PURPOSE_DOMAINS.receiptHead);
  } catch {
    return false;
  }
}
