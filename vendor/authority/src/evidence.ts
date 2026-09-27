// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalHash, canonicalJson, type CanonicalValue } from "./canonical.js";

export interface ReceiptChainEntryV1 {
  payload: { readonly [key: string]: CanonicalValue };
  prevHash: string | null;
  chainHash: string;
}

export interface ReceiptChainVerdict {
  valid: boolean;
  breakIndex: number | null;
  headHash: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function receiptChainHash(payload: { readonly [key: string]: CanonicalValue }, prevHash: string | null): string {
  if (!record(payload)) throw new Error("receipt_chain_payload_invalid");
  if (prevHash !== null && !/^[0-9a-f]{64}$/.test(prevHash)) throw new Error("receipt_chain_previous_hash_invalid");
  return canonicalHash({ domain: "AUKORA-RECEIPT-CHAIN/1", payload, prevHash });
}

export function verifyReceiptChain(entries: readonly ReceiptChainEntryV1[], startPrevHash: string | null = null): ReceiptChainVerdict {
  let previous = startPrevHash;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!record(entry) || !exactKeys(entry, ["payload", "prevHash", "chainHash"])
      || !record(entry.payload) || entry.prevHash !== previous || !/^[0-9a-f]{64}$/.test(entry.chainHash)) {
      return { valid: false, breakIndex: index, headHash: previous };
    }
    let expected: string;
    try {
      expected = receiptChainHash(entry.payload as { readonly [key: string]: CanonicalValue }, previous);
    } catch {
      return { valid: false, breakIndex: index, headHash: previous };
    }
    if (entry.chainHash !== expected) return { valid: false, breakIndex: index, headHash: previous };
    previous = expected;
  }
  return { valid: true, breakIndex: null, headHash: previous };
}

export type ArtifactKindV1 = "document" | "media" | "code" | "database_export" | "model_output" | "other";
const ARTIFACT_KINDS: readonly ArtifactKindV1[] = ["document", "media", "code", "database_export", "model_output", "other"];

export interface ArtifactDescriptorV1 {
  artifactId: string;
  kind: ArtifactKindV1;
  mediaType: string;
  contentHash: string;
  metadata: { readonly [key: string]: CanonicalValue };
}

export interface ArtifactReceiptV1 {
  schema: "aukora-artifact-receipt-v1";
  descriptor: ArtifactDescriptorV1;
  timestamp: number;
  previousReceiptHash: string | null;
  receiptHash: string;
}

export function artifactContentHash(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? utf8ToBytes(content) : content;
  if (!(bytes instanceof Uint8Array)) throw new Error("artifact_content_invalid");
  return bytesToHex(sha256(bytes));
}

function artifactPayload(receipt: Omit<ArtifactReceiptV1, "receiptHash">): CanonicalValue {
  return {
    domain: "AUKORA-ARTIFACT/1",
    schema: receipt.schema,
    descriptor: {
      artifactId: receipt.descriptor.artifactId,
      kind: receipt.descriptor.kind,
      mediaType: receipt.descriptor.mediaType,
      contentHash: receipt.descriptor.contentHash,
      metadata: receipt.descriptor.metadata,
    },
    timestamp: receipt.timestamp,
    previousReceiptHash: receipt.previousReceiptHash,
  };
}

function assertArtifactDescriptor(value: unknown): asserts value is ArtifactDescriptorV1 {
  if (!record(value) || !exactKeys(value, ["artifactId", "kind", "mediaType", "contentHash", "metadata"])) {
    throw new Error("artifact_descriptor_invalid");
  }
  if (typeof value.artifactId !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(value.artifactId)) throw new Error("artifact_id_invalid");
  if (typeof value.kind !== "string" || !ARTIFACT_KINDS.includes(value.kind as ArtifactKindV1)) throw new Error("artifact_kind_invalid");
  if (typeof value.mediaType !== "string" || value.mediaType.length === 0 || value.mediaType.length > 255 || /[\u0000-\u001f\u007f]/.test(value.mediaType)) {
    throw new Error("artifact_media_type_invalid");
  }
  if (typeof value.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(value.contentHash)) throw new Error("artifact_hash_invalid");
  if (!record(value.metadata)) throw new Error("artifact_metadata_invalid");
  canonicalJson(value.metadata as { readonly [key: string]: CanonicalValue });
}

function assertArtifactReceipt(value: unknown): asserts value is ArtifactReceiptV1 {
  if (!record(value) || !exactKeys(value, ["schema", "descriptor", "timestamp", "previousReceiptHash", "receiptHash"])) {
    throw new Error("artifact_receipt_invalid");
  }
  if (value.schema !== "aukora-artifact-receipt-v1") throw new Error("artifact_schema_invalid");
  assertArtifactDescriptor(value.descriptor);
  if (!Number.isSafeInteger(value.timestamp) || (value.timestamp as number) < 0) throw new Error("artifact_timestamp_invalid");
  if (value.previousReceiptHash !== null && (typeof value.previousReceiptHash !== "string" || !/^[0-9a-f]{64}$/.test(value.previousReceiptHash))) {
    throw new Error("artifact_previous_hash_invalid");
  }
  if (typeof value.receiptHash !== "string" || !/^[0-9a-f]{64}$/.test(value.receiptHash)) throw new Error("artifact_receipt_hash_invalid");
}

export function buildArtifactReceipt(
  descriptor: ArtifactDescriptorV1,
  timestamp: number,
  previousReceiptHash: string | null,
): ArtifactReceiptV1 {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("artifact_timestamp_invalid");
  assertArtifactDescriptor(descriptor);
  if (previousReceiptHash !== null && !/^[0-9a-f]{64}$/.test(previousReceiptHash)) throw new Error("artifact_previous_hash_invalid");
  const base: Omit<ArtifactReceiptV1, "receiptHash"> = {
    schema: "aukora-artifact-receipt-v1",
    descriptor,
    timestamp,
    previousReceiptHash,
  };
  return { ...base, receiptHash: canonicalHash(artifactPayload(base)) };
}

export type ArtifactChainVerdict =
  | { valid: true; headHash: string | null }
  | { valid: false; reason: string; index: number };

export function verifyArtifactChain(
  entries: readonly { receipt: ArtifactReceiptV1; content: string | Uint8Array }[],
): ArtifactChainVerdict {
  let previous: string | null = null;
  for (let index = 0; index < entries.length; index++) {
    try {
      const entry = entries[index] as unknown;
      if (!record(entry) || !exactKeys(entry, ["receipt", "content"])) return { valid: false, reason: "entry_malformed", index };
      const receipt = entry.receipt;
      const content = entry.content;
      assertArtifactReceipt(receipt);
      if (receipt.previousReceiptHash !== previous) return { valid: false, reason: "chain_link_invalid", index };
      if (typeof content !== "string" && !(content instanceof Uint8Array)) return { valid: false, reason: "content_invalid", index };
      if (artifactContentHash(content) !== receipt.descriptor.contentHash) return { valid: false, reason: "content_hash_invalid", index };
      const { receiptHash: _hash, ...base } = receipt;
      const expected = canonicalHash(artifactPayload(base));
      if (receipt.receiptHash !== expected) return { valid: false, reason: "receipt_hash_invalid", index };
      previous = expected;
    } catch {
      return { valid: false, reason: "receipt_malformed", index };
    }
  }
  return { valid: true, headHash: previous };
}
