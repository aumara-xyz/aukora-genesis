// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { describe, expect, it } from "vitest";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  PURPOSE_DOMAINS,
  artifactContentHash,
  buildArtifactReceipt,
  consistencyProof,
  inclusionProof,
  leafHash,
  merkleRoot,
  receiptHistoryRootHex,
  receiptChainHash,
  serializeReceiptHeadV4,
  verifyArtifactChain,
  verifyConsistency,
  verifyInclusion,
  verifyReceiptHeadV4,
  verifyReceiptChain,
} from "../src/index.js";

const leafInputsHex = ["", "00", "10", "2021", "3031", "40414243", "5051525354555657", "606162636465666768696a6b6c6d6e6f"];
const expectedRoots = [
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
  "fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125",
  "aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77",
  "d37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7",
  "4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4",
  "76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef",
  "ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c",
  "5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328",
];

describe("portable evidence verification", () => {
  it("matches RFC 6962 roots and verifies inclusion/consistency", () => {
    const leaves = leafInputsHex.map(hexToBytes);
    for (let size = 0; size <= leaves.length; size++) {
      expect(bytesToHex(merkleRoot(leaves.slice(0, size)))).toBe(expectedRoots[size]);
    }
    const hashes = leaves.map(leafHash);
    const root = merkleRoot(leaves);
    for (let index = 0; index < leaves.length; index++) {
      expect(verifyInclusion(index, leaves.length, hashes[index], inclusionProof(hashes, index), root)).toBe(true);
    }
    const earlier = merkleRoot(leaves.slice(0, 3));
    expect(verifyConsistency(3, leaves.length, consistencyProof(hashes, 3, leaves.length), earlier, root)).toBe(true);
  });

  it("verifies the ML-DSA-65-only receipt-head profile", () => {
    const seed = hexToBytes("33".repeat(32));
    const keys = ml_dsa65.keygen(seed);
    const chainHashes = ["44".repeat(32), "55".repeat(32)];
    const merkleRootHex = receiptHistoryRootHex(chainHashes);
    const head = { chainKey: "receipt:example", timestamp: 1_735_689_600_000, chainLength: 2, chainHeadHash: chainHashes[1] };
    const message = serializeReceiptHeadV4(head, merkleRootHex);
    const signature = bytesToHex(ml_dsa65.sign(message, keys.secretKey, {
      extraEntropy: false,
      context: utf8ToBytes(PURPOSE_DOMAINS.receiptHead),
    }));
    expect(verifyReceiptHeadV4(bytesToHex(keys.publicKey), head, merkleRootHex, signature)).toBe(true);
    expect(verifyReceiptHeadV4(bytesToHex(keys.publicKey), { ...head, chainLength: 1 }, merkleRootHex, signature)).toBe(false);
    const wrongDomainSignature = bytesToHex(ml_dsa65.sign(message, keys.secretKey, {
      extraEntropy: false,
      context: utf8ToBytes(PURPOSE_DOMAINS.aumlokPromotion),
    }));
    expect(verifyReceiptHeadV4(bytesToHex(keys.publicKey), head, merkleRootHex, wrongDomainSignature)).toBe(false);
  });

  it("binds generic receipt payloads inside a domain-separated chain envelope", () => {
    const firstPayload = { event: "observed", prevHash: "payload-data-not-chain-state" };
    const firstHash = receiptChainHash(firstPayload, null);
    const secondPayload = { event: "recorded" };
    const secondHash = receiptChainHash(secondPayload, firstHash);
    const chain = [
      { payload: firstPayload, prevHash: null, chainHash: firstHash },
      { payload: secondPayload, prevHash: firstHash, chainHash: secondHash },
    ];
    expect(verifyReceiptChain(chain)).toEqual({ valid: true, breakIndex: null, headHash: secondHash });
    expect(verifyReceiptChain([{ ...chain[0], chainHash: secondHash }, chain[1]]).valid).toBe(false);
  });

  it("fails artifact custody on one-byte tamper and reorder", () => {
    const firstContent = "artifact-one";
    const first = buildArtifactReceipt({
      artifactId: "artifact-1",
      kind: "document",
      mediaType: "text/plain",
      contentHash: artifactContentHash(firstContent),
      metadata: { purpose: "conformance" },
    }, 1, null);
    const secondContent = "artifact-two";
    const second = buildArtifactReceipt({
      artifactId: "artifact-2",
      kind: "code",
      mediaType: "text/plain",
      contentHash: artifactContentHash(secondContent),
      metadata: { purpose: "conformance" },
    }, 2, first.receiptHash);
    expect(verifyArtifactChain([{ receipt: first, content: firstContent }, { receipt: second, content: secondContent }]).valid).toBe(true);
    expect(verifyArtifactChain([{ receipt: first, content: `${firstContent}!` }, { receipt: second, content: secondContent }]).valid).toBe(false);
    expect(verifyArtifactChain([{ receipt: second, content: secondContent }, { receipt: first, content: firstContent }]).valid).toBe(false);
    expect(verifyArtifactChain([{
      receipt: { ...first, schema: "aukora-artifact-receipt-v2" as never },
      content: firstContent,
    }]).valid).toBe(false);
  });
});
