// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  PURPOSE_DOMAINS,
  aumlokRootId,
  aumlokRootIntegrity,
  canonicalAumlokPromotion,
  canonicalBytes,
  canonicalHash,
  canonicalJson,
  decide,
  verifyAumlokPromotionV2,
  type AumlokAuthorityRootV2,
  type KernelRequestV1,
  type PolicyV1,
  type SignedPromotionV2,
  type TrustedStateV1,
} from "../src/index.js";

const nowMs = 1_735_689_600_000;
const payloadHash = canonicalHash("proposal-v1");

function fixture(): {
  root: AumlokAuthorityRootV2;
  receipt: SignedPromotionV2;
  state: TrustedStateV1;
  policy: PolicyV1;
  request: KernelRequestV1;
} {
  const edSeed = hexToBytes("11".repeat(32));
  const mlSeed = hexToBytes("22".repeat(32));
  const mlKeys = ml_dsa65.keygen(mlSeed);
  const publicKeys = { ed25519: bytesToHex(ed25519.getPublicKey(edSeed)), mlDsa65: bytesToHex(mlKeys.publicKey) };
  const rootId = aumlokRootId(publicKeys);
  const rootBase: Omit<AumlokAuthorityRootV2, "integrity"> = {
    schema: "aumlok-authority-root-v2",
    suite: "aumlok-ed25519-ml-dsa-65-v1",
    rootId,
    publicKeys,
    mode: "software_hybrid",
    createdAt: "2024-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    revoked: false,
  };
  const root: AumlokAuthorityRootV2 = { ...rootBase, integrity: aumlokRootIntegrity(rootBase) };
  const authorization = {
    rootId,
    proposalHash: payloadHash,
    draftHash: payloadHash,
    nonce: "promotion-1",
    issuedAt: "2024-12-31T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const message = canonicalAumlokPromotion(authorization);
  const receipt: SignedPromotionV2 = {
    schema: "aumlok-signed-promotion-v2",
    suite: "aumlok-ed25519-ml-dsa-65-v1",
    authorization,
    signatures: {
      ed25519: bytesToHex(ed25519.sign(message, edSeed)),
      mlDsa65: bytesToHex(ml_dsa65.sign(message, mlKeys.secretKey, {
        extraEntropy: false,
        context: utf8ToBytes(PURPOSE_DOMAINS.aumlokPromotion),
      })),
    },
    mode: "software_hybrid",
  };
  const state: TrustedStateV1 = {
    schema: "aukora-trusted-state-v1",
    salama: { active: false, reason: null },
    trustedRoots: [root],
    consumedIds: [],
    receiptHead: { count: 0, headHash: null },
  };
  const policy: PolicyV1 = {
    schema: "aukora-policy-v1",
    rules: [{
      action: { namespace: "symbiote", kind: "source", verb: "promote" },
      resourceNamespace: "repo",
      maxRing: "self-modify",
      requiresAuthorization: true,
    }],
    sacred: [{ actionNamespace: "kernel", actionKind: "authority", resourceNamespace: "kernel" }],
  };
  const request: KernelRequestV1 = {
    schema: "aukora-kernel-request-v1",
    requestId: "request-1",
    action: { namespace: "symbiote", kind: "source", verb: "promote" },
    resource: { namespace: "repo", id: "aukora-symbiote" },
    ring: "self-modify",
    payloadHash,
    consumptionId: "proposal-1",
    humanClearance: true,
    authorization: receipt,
    evidenceRefs: ["tests-green"],
  };
  return { root, receipt, state, policy, request };
}

describe("portable reducer", () => {
  it("is deterministic and consumes one hybrid-authorized promotion", () => {
    const { state, policy, request } = fixture();
    const policyBytes = canonicalBytes(policy as unknown as never);
    const first = decide(request, state, policyBytes, nowMs);
    const repeated = decide(request, state, policyBytes, nowMs);
    expect(canonicalJson(first as unknown as never)).toBe(canonicalJson(repeated as unknown as never));
    expect(first.decision).toMatchObject({ status: "allowed", code: "allowed" });
    expect(first.nextState.consumedIds).toEqual(["proposal-1"]);
    expect(first.nextState.receiptHead).toEqual({ count: 1, headHash: first.receiptDraft.draftHash });
  });

  it("refuses replay without consuming the id again", () => {
    const { state, policy, request } = fixture();
    const policyBytes = canonicalBytes(policy as unknown as never);
    const first = decide(request, state, policyBytes, nowMs);
    const replay = decide({ ...request, requestId: "request-2" }, first.nextState, policyBytes, nowMs + 1);
    expect(replay.decision).toMatchObject({ status: "refused", code: "replay" });
    expect(replay.nextState.consumedIds).toEqual(["proposal-1"]);
  });

  it("requires both signatures for the hybrid profile", () => {
    const { state, policy, request, receipt } = fixture();
    const mlReplacement = receipt.signatures.mlDsa65.startsWith("0") ? "1" : "0";
    const mlForged: SignedPromotionV2 = {
      ...receipt,
      signatures: { ...receipt.signatures, mlDsa65: `${mlReplacement}${receipt.signatures.mlDsa65.slice(1)}` },
    };
    const edReplacement = receipt.signatures.ed25519.startsWith("0") ? "1" : "0";
    const edForged: SignedPromotionV2 = {
      ...receipt,
      signatures: { ...receipt.signatures, ed25519: `${edReplacement}${receipt.signatures.ed25519.slice(1)}` },
    };
    for (const forged of [mlForged, edForged]) {
      const result = decide({ ...request, authorization: forged }, state, canonicalBytes(policy as unknown as never), nowMs);
      expect(result.decision).toMatchObject({ status: "refused", code: "authority_invalid" });
      expect(result.nextState.consumedIds).toEqual([]);
    }
  });

  it("refuses future-dated authority material", () => {
    const { root, receipt } = fixture();
    const futureRootBase = { ...root, createdAt: "2099-01-01T00:00:00.000Z" };
    const { integrity: _integrity, ...futureRootUnsigned } = futureRootBase;
    const futureRoot = { ...futureRootUnsigned, integrity: aumlokRootIntegrity(futureRootUnsigned) };
    expect(verifyAumlokPromotionV2(receipt, futureRoot, nowMs)).toMatchObject({ valid: false, reason: "root_not_yet_valid" });
    const futureReceipt = {
      ...receipt,
      authorization: { ...receipt.authorization, issuedAt: "2099-01-01T00:00:00.000Z" },
    };
    expect(verifyAumlokPromotionV2(futureReceipt, root, nowMs)).toMatchObject({ valid: false, reason: "authorization_not_yet_valid" });
  });

  it("refuses sacred targets before authority evaluation", () => {
    const { state, policy, request } = fixture();
    const sacred: KernelRequestV1 = {
      ...request,
      action: { namespace: "kernel", kind: "authority", verb: "rewrite" },
      resource: { namespace: "kernel", id: "policy" },
      authorization: null,
    };
    expect(decide(sacred, state, canonicalBytes(policy as unknown as never), nowMs).decision.code).toBe("sacred_target");
  });

  it("rejects non-canonical policy bytes", () => {
    const { state, request } = fixture();
    const nonCanonical = utf8ToBytes('{"rules":[],"schema":"aukora-policy-v1","sacred":[]}\n');
    expect(() => decide(request, state, nonCanonical, nowMs)).toThrow("canonical_bytes_noncanonical");
  });
});
