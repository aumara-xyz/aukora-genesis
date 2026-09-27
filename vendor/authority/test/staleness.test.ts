// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
import { describe, it, expect } from "vitest";
import {
  stalenessVerdict, challengeStalenessGate, stampExpiresBy, stalenessGrantsAuthority,
  DEFAULT_DRAFT_HORIZON_MS,
} from "../src/staleness.js";

const now = Date.parse("2026-07-16T12:00:00.000Z");

describe("canonical staleness law", () => {
  it("flags UNKNOWN age as stale (fail-closed) — no createdAt, no expiresBy", () => {
    expect(stalenessVerdict(null, now).state).toBe("stale");
    expect(stalenessVerdict({}, now).horizon).toBe("unknown-age");
    expect(stalenessVerdict({ createdAt: "not-a-canonical-date" }, now).state).toBe("stale");
    // a non-canonical (loosely-parseable) timestamp is UNKNOWN age under the strict parser
    expect(stalenessVerdict({ createdAt: "2026-07-16" }, now).horizon).toBe("unknown-age");
  });

  it("is fresh within the default 72h horizon and stale past it", () => {
    expect(stalenessVerdict({ createdAt: "2026-07-16T11:00:00.000Z" }, now).state).toBe("fresh");
    expect(stalenessVerdict({ createdAt: "2026-07-10T00:00:00.000Z" }, now).state).toBe("stale"); // ~6d old
    expect(stalenessVerdict({ createdAt: "2026-07-16T11:00:00.000Z" }, now).horizon).toBe("default-draft-72h");
  });

  it("honors a stamped expiry over the default horizon", () => {
    const created = "2026-07-16T00:00:00.000Z";
    const expiresBy = stampExpiresBy(created); // +72h → 2026-07-19T00:00:00Z
    expect(stalenessVerdict({ createdAt: created, expiresBy }, now).horizon).toBe("stamped");
    expect(stalenessVerdict({ createdAt: created, expiresBy }, now).state).toBe("fresh");
    // an already-passed stamp is stale regardless of createdAt
    expect(stalenessVerdict({ createdAt: created, expiresBy: "2026-07-16T06:00:00.000Z" }, now).state).toBe("stale");
  });

  it("stale/unknown cannot mint without an explicit revive in the same gesture", () => {
    const stale = stalenessVerdict({ createdAt: "2026-07-01T00:00:00.000Z" }, now);
    expect(challengeStalenessGate(stale, false).allow).toBe(false);
    expect(challengeStalenessGate(stale, true).allow).toBe(true);
    const fresh = stalenessVerdict({ createdAt: "2026-07-16T11:00:00.000Z" }, now);
    expect(challengeStalenessGate(fresh, false).allow).toBe(true);
  });

  it("stampExpiresBy rejects non-canonical input and non-positive horizons; grants no authority", () => {
    expect(() => stampExpiresBy("nope")).toThrow();
    expect(() => stampExpiresBy("2026-07-16T00:00:00.000Z", 0)).toThrow();
    expect(stampExpiresBy("2026-07-16T00:00:00.000Z")).toBe(new Date(Date.parse("2026-07-16T00:00:00.000Z") + DEFAULT_DRAFT_HORIZON_MS).toISOString());
    expect(stalenessGrantsAuthority()).toBe(false);
  });
});
