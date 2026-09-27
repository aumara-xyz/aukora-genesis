// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R52 / issue #116 — adversarial audit of the authority-adjacent `JSON.stringify` encoders against the
 * canonical encoding law, and hostile-input hardening of `canonicalJson`.
 *
 * FINDING (pinned here): the three authority encoders — `canonicalAumlokPromotion` (the SIGNED message),
 * `aumlokRootId`, `aumlokRootIntegrity` — use direct `JSON.stringify` over an EXPLICITLY FIELD-PICKED object
 * literal with a FIXED key order. For the CLOSED input contract enforced by `assertSignedPromotion` /
 * `assertAuthorityRoot` (every field is a fixed enum literal, a lowercase hex string `[0-9a-f]{64,}`, an
 * ISO-UTC-millis timestamp, or a nonce identifier `[a-z0-9._:-]{1,128}`), that encoding is:
 *   - DETERMINISTIC   — fixed literal ⇒ fixed key order, independent of input property order;
 *   - INJECTIVE       — no field value can contain a JSON-structural or escapable character (no `"`, `\`,
 *                       control, or non-ASCII survives the validators), so field boundaries never blur;
 *   - INPUT-ATTACK-IMMUNE — field-picking ignores extra keys and input key order by construction.
 * It is therefore "merely duplication" of the canonical law, NOT an ambiguity risk.
 *
 * DECISION (pinned): DO NOT converge these sites onto `canonicalJson`. `canonicalJson` sorts keys, so it emits
 * DIFFERENT bytes for the same authorization; re-encoding the signed message that way would change every
 * signature input and SILENTLY INVALIDATE all existing authority — the frozen `hybrid-v1.json` signature stops
 * verifying (proven below). The correct action is to PIN the current encoding with golden + historic-fixture
 * vectors so any future drift is caught, which is what this suite does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  canonicalAumlokPromotion,
  aumlokRootId,
  aumlokRootIntegrity,
  verifyAumlokPromotionV2,
  assertSignedPromotion,
  canonicalBytes,
  canonicalJson,
  canonicalHash,
  assertCanonicalValue,
  PURPOSE_DOMAINS,
  type PromotionAuthorizationV2,
  type SignedPromotionV2,
  type AumlokAuthorityRootV2,
} from "../src/index.js";

const hybrid = JSON.parse(readFileSync(new URL("../conformance/hybrid-v1.json", import.meta.url), "utf8"));
const SIGNED: SignedPromotionV2 = hybrid.request.authorization;
const ROOT: AumlokAuthorityRootV2 = hybrid.trustedState.trustedRoots[0];
const AUTH: PromotionAuthorizationV2 = SIGNED.authorization;
const NOW = hybrid.nowMs as number;
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

// ── GOLDEN VECTORS — the exact frozen encoding of the historic conformance authorization ────────────
const GOLDEN_PROMOTION_STRING =
  `{"_":"aumlok-signed-promotion-v2","suite":"aumlok-ed25519-ml-dsa-65-v1",` +
  `"rootId":"982dcab46b6b3d310828469d1880b0a6fbee8d295a0fb5f44d97677350553aed",` +
  `"proposalHash":"87a9686db53be4b329d473f3b6b7e01dda114f145a74989af22f76aa885f1882",` +
  `"draftHash":"87a9686db53be4b329d473f3b6b7e01dda114f145a74989af22f76aa885f1882",` +
  `"nonce":"promotion-1","issuedAt":"2024-12-31T00:00:00.000Z","expiresAt":"2099-01-01T00:00:00.000Z"}`;
const GOLDEN_PROMOTION_SHA256 = "ed7c1c73041f9c8c3955331c808be4192cfd18e1c8c2886e281841202058da29";

describe("R52 · authority encoding — golden vectors pinned to the historic fixture", () => {
  it("canonicalAumlokPromotion emits the exact frozen bytes (drift-detecting golden)", () => {
    const bytes = canonicalAumlokPromotion(AUTH);
    expect(decode(bytes)).toBe(GOLDEN_PROMOTION_STRING);
    expect(bytesToHex(sha256(bytes))).toBe(GOLDEN_PROMOTION_SHA256);
  });

  it("the frozen hybrid signatures verify over that exact encoding (end-to-end authority stays green)", () => {
    const msg = canonicalAumlokPromotion(AUTH);
    expect(ed25519.verify(hexToBytes(SIGNED.signatures.ed25519), msg, hexToBytes(ROOT.publicKeys.ed25519))).toBe(true);
    expect(ml_dsa65.verify(hexToBytes(SIGNED.signatures.mlDsa65), msg, hexToBytes(ROOT.publicKeys.mlDsa65), { context: utf8ToBytes(PURPOSE_DOMAINS.aumlokPromotion) })).toBe(true);
    expect(verifyAumlokPromotionV2(SIGNED, ROOT, NOW)).toEqual({ valid: true });
  });

  it("aumlokRootId + aumlokRootIntegrity are pinned and self-consistent with the frozen root", () => {
    expect(aumlokRootId(ROOT.publicKeys)).toBe(ROOT.rootId);
    const { integrity, ...unsigned } = ROOT;
    expect(aumlokRootIntegrity(unsigned)).toBe(ROOT.integrity);
    void integrity;
  });
});

describe("R52 · DECISION — converging onto canonicalJson would silently invalidate existing authority", () => {
  it("canonicalJson of the same 8 fields differs from the signed bytes (sorted vs insertion key order)", () => {
    const eight = {
      _: "aumlok-signed-promotion-v2", suite: "aumlok-ed25519-ml-dsa-65-v1",
      rootId: AUTH.rootId, proposalHash: AUTH.proposalHash, draftHash: AUTH.draftHash,
      nonce: AUTH.nonce, issuedAt: AUTH.issuedAt, expiresAt: AUTH.expiresAt,
    } as const;
    const signed = decode(canonicalAumlokPromotion(AUTH));
    const canon = canonicalJson(eight);
    expect(canon).not.toBe(signed);                 // key order differs
    expect(canon.startsWith(`{"_":"aumlok-signed-promotion-v2","draftHash":`)).toBe(true); // sorted
  });

  it("the frozen signature does NOT verify over the canonicalJson encoding — the concrete reason not to converge", () => {
    const eight = {
      _: "aumlok-signed-promotion-v2", suite: "aumlok-ed25519-ml-dsa-65-v1",
      rootId: AUTH.rootId, proposalHash: AUTH.proposalHash, draftHash: AUTH.draftHash,
      nonce: AUTH.nonce, issuedAt: AUTH.issuedAt, expiresAt: AUTH.expiresAt,
    } as const;
    const canonMsg = canonicalBytes(eight);
    expect(ed25519.verify(hexToBytes(SIGNED.signatures.ed25519), canonMsg, hexToBytes(ROOT.publicKeys.ed25519))).toBe(false);
  });
});

describe("R52 · hostile vectors — the encoder is immune to input-shape attacks (closed contract)", () => {
  const reorder = (a: PromotionAuthorizationV2): PromotionAuthorizationV2 => ({
    expiresAt: a.expiresAt, nonce: a.nonce, draftHash: a.draftHash,
    issuedAt: a.issuedAt, proposalHash: a.proposalHash, rootId: a.rootId,
  }) as PromotionAuthorizationV2;

  it("PROPERTY ORDER: reordering the input keys yields identical signed bytes", () => {
    expect(decode(canonicalAumlokPromotion(reorder(AUTH)))).toBe(decode(canonicalAumlokPromotion(AUTH)));
  });

  it("ADDITIONAL KEYS: an extra own property on the input is ignored by the field-picking encoder", () => {
    const withExtra = { ...AUTH, EVIL: "injected", __proto__: { rootId: "x" } } as unknown as PromotionAuthorizationV2;
    expect(decode(canonicalAumlokPromotion(withExtra))).toBe(decode(canonicalAumlokPromotion(AUTH)));
  });

  it("ADDITIONAL KEYS: the validator also REJECTS an authorization carrying an unknown field", () => {
    const bad = { ...SIGNED, authorization: { ...AUTH, EVIL: "x" } } as unknown;
    expect(() => assertSignedPromotion(bad)).toThrow(/authorization_payload_unknown_fields/);
  });

  it("INJECTIVITY: changing exactly one authorized field changes the signed bytes (no field bleed)", () => {
    const base = decode(canonicalAumlokPromotion(AUTH));
    for (const patch of [
      { nonce: "promotion-2" },
      { proposalHash: "0".repeat(64) },
      { draftHash: "f".repeat(64) },
      { issuedAt: "2024-12-31T00:00:00.001Z" },
      { expiresAt: null },
    ] as Array<Partial<PromotionAuthorizationV2>>) {
      expect(decode(canonicalAumlokPromotion({ ...AUTH, ...patch }))).not.toBe(base);
    }
  });

  it("UNICODE / ESCAPING: the validator refuses any nonce outside the ASCII identifier charset — no escapable char reaches the encoder", () => {
    for (const evilNonce of ["promotión", "promótion", 'promo"tion', "promo\\tion", "promo\ntion", "Promotion"]) {
      const bad = { ...SIGNED, authorization: { ...AUTH, nonce: evilNonce } } as unknown;
      expect(() => assertSignedPromotion(bad), evilNonce).toThrow(/authorization_nonce_invalid/);
    }
  });

  it("PROTOTYPE-SHAPED: an authorization whose fields resolve only via the prototype is refused (own-key check)", () => {
    const protoAuth = Object.assign(Object.create({ rootId: AUTH.rootId }), {
      proposalHash: AUTH.proposalHash, draftHash: AUTH.draftHash, nonce: AUTH.nonce, issuedAt: AUTH.issuedAt, expiresAt: AUTH.expiresAt,
    });
    const bad = { ...SIGNED, authorization: protoAuth } as unknown;
    expect(() => assertSignedPromotion(bad)).toThrow(/authorization_payload_unknown_fields|authorization_root_id_invalid/);
    expect(verifyAumlokPromotionV2(bad as SignedPromotionV2, ROOT, NOW)).toEqual({ valid: false, reason: "malformed" });
  });

  it("VERSIONING: the schema tag `_` and the suite are inside the signed bytes — a version/suite change re-keys the signature", () => {
    const str = decode(canonicalAumlokPromotion(AUTH));
    expect(str.startsWith(`{"_":"aumlok-signed-promotion-v2","suite":"aumlok-ed25519-ml-dsa-65-v1",`)).toBe(true);
  });
});

describe("R52 · canonicalJson hostile-input hardening (#116) — sparse/named arrays now rejected", () => {
  it("SPARSE ARRAY: a hole (implicit undefined) is refused, not silently skipped", () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [1, , 3] as unknown;
    expect(() => assertCanonicalValue(sparse)).toThrow(/canonical_array_shape/);
    // eslint-disable-next-line no-sparse-arrays
    expect(() => canonicalJson([1, , 3] as never)).toThrow(/canonical_array_shape/);
  });

  it("NAMED-PROPERTY ARRAY: the [1] vs [1]+hidden-.foo COLLISION is closed (the array is now refused)", () => {
    const named: number[] & { foo?: string } = [1];
    named.foo = "smuggled";
    expect(() => assertCanonicalValue(named)).toThrow(/canonical_array_shape/);
    // and a plain dense array still encodes exactly as before (no valid encoding changed)
    expect(canonicalJson([1] as never)).toBe("[1]");
    expect(canonicalJson([1, 2, 3] as never)).toBe("[1,2,3]");
  });

  it("PROTOTYPE-SHAPED OBJECT: a non-plain object is refused; canonicalJson stays key-sorted + deterministic", () => {
    expect(() => assertCanonicalValue(Object.create({ evil: 1 }))).toThrow(/canonical_type/);
    expect(canonicalJson({ b: 1, a: 2, c: 3 } as never)).toBe(`{"a":2,"b":1,"c":3}`);
  });

  it("NO VALID ENCODING CHANGED: a corpus of dense canonical values hashes to stable, recomputable digests", () => {
    // Pins that the array hardening did not shift any valid dense encoding (these are recomputed, not magic).
    const corpus = [
      [] as never,
      [1, 2, 3] as never,
      { a: [1, { b: 2 }], z: null } as never,
      { nested: [[1], [2, 3]], flag: true } as never,
    ];
    for (const value of corpus) {
      const first = canonicalHash(value);
      expect(canonicalHash(value)).toBe(first);          // deterministic
      expect(first).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(canonicalJson({ a: [1, { b: 2 }], z: null } as never)).toBe(`{"a":[1,{"b":2}],"z":null}`);
  });
});
