// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJson, decide, merkleRoot } from "../src/index.js";

const vectors = JSON.parse(readFileSync(new URL("../conformance/v1.json", import.meta.url), "utf8"));
const hybrid = JSON.parse(readFileSync(new URL("../conformance/hybrid-v1.json", import.meta.url), "utf8"));

describe("external conformance v1", () => {
  it("matches the frozen reducer result byte-for-byte", () => {
    const vector = vectors.reducerVectors[0];
    const actual = decide(
      vector.request,
      vector.trustedState,
      utf8ToBytes(vector.policyCanonicalJson),
      vector.nowMs,
    );
    expect(canonicalJson(actual)).toBe(canonicalJson(vector.expected));
  });

  it("matches every frozen RFC 6962 prefix root", () => {
    const leaves = vectors.merkle.leafInputsHex.map(hexToBytes);
    const actual = Array.from(
      { length: leaves.length + 1 },
      (_, size) => bytesToHex(merkleRoot(leaves.slice(0, size))),
    );
    expect(actual).toEqual(vectors.merkle.rootHashesBySize);
  });

  it("matches the frozen mandatory-hybrid authority result", () => {
    const actual = decide(
      hybrid.request,
      hybrid.trustedState,
      utf8ToBytes(hybrid.policyCanonicalJson),
      hybrid.nowMs,
    );
    expect(canonicalJson(actual)).toBe(canonicalJson(hybrid.expected));
    expect(actual.decision).toMatchObject({ status: "allowed", authorizedRootId: hybrid.request.authorization.authorization.rootId });
  });

  it("executes the frozen one-signature downgrade mutations", () => {
    for (const mutation of hybrid.negativeMutations) {
      const request = JSON.parse(JSON.stringify(hybrid.request));
      const original = request.authorization.signatures[mutation.signatureField];
      request.authorization.signatures[mutation.signatureField] = `${original.startsWith("0") ? "1" : "0"}${original.slice(1)}`;
      const actual = decide(
        request,
        hybrid.trustedState,
        utf8ToBytes(hybrid.policyCanonicalJson),
        hybrid.nowMs,
      );
      expect(actual.decision.code, mutation.name).toBe(mutation.expectedDecisionCode);
      expect(actual.nextState.consumedIds, mutation.name).toEqual([]);
    }
  });
});
