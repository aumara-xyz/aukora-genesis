// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// VENDORED from aukora-os/node-template/convex@b399db1 on 2026-07-05 (Brick S1a, Option A — owner-ratified). Changes from donor are marked S1a:.
/**
 * Aukora core — pure helpers (no Convex ctx), ported from the Auma
 * Nebius forge (Wave 8.7/8.8). Testable in isolation.
 *
 * The Aukora spine's job: a durable/external action must prove that a
 * matching Aukora intent was logged + accepted moments ago, and that
 * its single-use decision token has not already been consumed. Wrapper
 * gates are necessary but not sufficient — the token binds the action
 * to the logged intent at the mutation layer.
 *
 * Wave 2 ships these helpers + a read-only data layer. Enforcement
 * (calling verify/consume from the chat path) is Wave 3/4.
 *
 * See docs/AUMA_ORGANISM_CONVERGENCE_PLAN.md §5.
 */

export type AukoraRing = "observe" | "local-write" | "external" | "self-modify";
export type AukoraGrantStatus = "active" | "revoked" | "expired" | "used";
export type AukoraIntentStatus = "accepted" | "downgraded" | "refused" | "halted";
export type AukoraVerdict = "kept" | "warning" | "failed" | "reverted";
export type AukoraRisk = "critical" | "high" | "medium" | "low";

/** Single-use decision token lifetime. Matches the Nebius forge. */
export const AUKORA_DECISION_TOKEN_TTL_MS = 5 * 60 * 1000;

/** Ring privilege ordering — higher index = more dangerous. */
const RING_ORDER: AukoraRing[] = ["observe", "local-write", "external", "self-modify"];

export function ringRank(ring: AukoraRing): number {
  const i = RING_ORDER.indexOf(ring);
  return i < 0 ? 0 : i;
}

/** Does `granted` cover `requested`? A grant covers its ring and below. */
export function ringCovers(granted: AukoraRing, requested: AukoraRing): boolean {
  return ringRank(granted) >= ringRank(requested);
}

// ── SACRED (Ring 0): the inviolable core ──────────────────────────
//
// The privilege rings (observe < local-write < external < self-modify) describe how
// DANGEROUS an action is. Sacred is orthogonal and absolute: a set of targets that are
// NEVER executable against — no ring, no claim, no grant, no founder authorization opens
// them. This is the capability tier the governance thesis requires ("the AI can change
// things in the system, but a user can't corrupt the AI's own power, regardless of
// jailbreaks"): even a fully-authorized self-modify intent is hard-blocked here. Matched on
// the action/resource the intent declares; enforced as the first stop in executeAukoraIntent.
// Targets are CANONICALIZED before matching (a Ring-0 gate must resist phrasing tricks), then matched on a
// single normal form. normalizeForSacred (below): length-cap → Unicode NFKC fold → strip control/zero-width
// chars → split camelCase → collapse EVERY non-alphanumeric run (space, . _ : - / punctuation) to a single
// "_" → lowercase → trim. So "aumlokSession", "kill switch", "aukora.config", "(founder)", "founder " and
// "AUKORACONFIG" all reduce to the same "_"-delimited token form. After canonicalization the only separator
// is "_", patterns anchor on (^|_)…(_|$), and the internal "_" between a sacred prefix and its control word
// is OPTIONAL ("_?") so the no-separator GLUE form ("aukoraconfig") is caught too.
//
// History: Codex MED-5 added hyphen/slash; Codex #5 + two adversarial swarm rounds closed camelCase, ALLCAPS,
// plurals, separator-glue ("aukoraconfig"/"aukoragrants"), space- and punctuation-separated forms,
// trailing-whitespace ("aumlok "), DIGIT-injection ("aukora2config"/"kill9switch" — digits collapse to "_"),
// the unanchored identity branch, AND an O(n²) ReDoS in a prior greedy acronym rule (now removed — lowercasing
// already handles ALLCAPS whole-terms; canonicalization is linear, and length-capped as a second ReDoS guard).
// DOCUMENTED RESIDUALS / STOPGAP LIMITS (none exploitable today: action/resource are server-side CONSTANTS in
// every live caller, never attacker-controlled - this matcher is defense-in-depth for when resources become
// dynamic). (1) Homoglyph CONFUSABLES (e.g. a Cyrillic look-alike letter) are NOT folded - NFKD folds
// compatibility chars + diacritics, not look-alike scripts; action/resource SHOULD be ASCII-validated upstream.
// (2) A lowercase- or ALLCAPS-GLUED standalone single token ("aumloksession" / "AUMLOKSession") and (3) prefix
// over-blocks ("token_secretary") are inherent to regex-on-free-form-strings (a fix in one direction reopens the
// other - whack-a-mole). THE DURABLE FIX, on which BOTH crew reviewers converged: a typed Aukora Action Registry
// enforcing Ring-0 on a typed {resourceNamespace, resourceKind}, NOT a regex over attacker-shaped strings.
// Tracked in docs/AUDIT_AUKORA_RUNTIME_TRIAGE.md + the Agentic OS Action Registry concept.
const SACRED_PATTERNS: RegExp[] = [
  /(^|_)aukora_?(config|secret|token|grant|kill|runtime|intent|salama)/, // spine tables + control surface (glue-safe)
  /(^|_)token_?secret/,                                                   // the signing secret
  /(^|_)(aumlok|auth|credential)(?:es|s)?(_|$)/,                          // identity / auth (+plural)
  /(^|_)founder(?:s)?(_|$)/,                                              // founder allowlist / operator authority (+plural)
  /(^|_)kill_?switch(?:es)?(_|$)/,                                        // the kill switch (+plural)
  /(^|_)(?:self_?)?doctrine(?:s)?(_|$)/,                                  // her doctrine spine (+plural)
  /(^|_)identity_?core/,                                                  // her identity core
  /(^|_)(other|cross)_?user(?:s)?(_|$)/,                                  // another user's data (+plural)
];

// Exported so the typed Action Registry can assert it represents EVERY sacred category (no silent drift): if a
// 9th pattern is added without a 9th typed class, aukoraActionRegistry.test.ts fails. (F-T3 / PAL-5 keystone.)
export const SACRED_PATTERN_COUNT = SACRED_PATTERNS.length;

const MAX_SACRED_RAW = 8192;  // generous raw memory ceiling before normalization (ids are short; ops below linear)
const MAX_SACRED_INPUT = 256; // cap the CANONICAL form AFTER collapse+trim, so leading-pad cannot truncate-smuggle

// Canonicalize a target field for sacred matching (see block comment). Bounded + linear (no backtracking regex).
function normalizeForSacred(s: string): string {
  let t = (s ?? "").slice(0, MAX_SACRED_RAW);
  // NFKD (not NFKC): fold fullwidth->ascii AND decompose accents into base + combining mark, so the combining-
  // mark strip below folds an accented sacred word back to its ascii form (crew Codex #2: NFKC kept the accent
  // attached and the ascii-only collapse then split the sacred word into a bypass, e.g. accented aumlok -> a_mlok).
  try { t = t.normalize("NFKD"); } catch { /* malformed surrogate -> leave as-is */ }
  return t
    .replace(/[\u0300-\u036F]/g, "")                            // strip combining diacritic marks (from NFKD)
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, "") // strip control + zero-width chars
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")                   // camelCase boundary -> "_": aumlokSession -> aumlok_Session
    .replace(/[^a-zA-Z]+/g, "_")                              // separator / DIGIT / punct run -> single "_" (no sacred
                                                              // word has a digit, so "aukora2config" -> "aukora_config")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")                                  // trim boundary "_" (leading-pad cannot survive to matter)
    .slice(0, MAX_SACRED_INPUT);                              // cap the canonical form (crew Gemini: defeats the
                                                              // "256 spaces + sacred word" truncation smuggler)
}

/** Is this intent aimed at a SACRED (Ring 0) target — never executable, for any ring/grant? */
export function isSacredTarget(action?: string, resource?: string): boolean {
  // Canonicalize + test action and resource SEPARATELY (never the space-joined string), each anchored at its
  // own ^/$ — so a sacred term in EITHER field is caught, and a cross-field coincidence ("aukora" in the
  // action, "config" in the resource) does NOT falsely trigger. (Patterns carry no /g flag → re.test is stateless.)
  const a = normalizeForSacred(action ?? "");
  const r = normalizeForSacred(resource ?? "");
  return SACRED_PATTERNS.some((re) => re.test(a) || re.test(r));
}

// ── Input-1 (audit): bounded, fail-closed engine-input validation ──
// Length caps bound log/receipt growth; the printable-ASCII guard on stable-key/id/token fields rejects control,
// bidi, zero-width, and non-ASCII confusables in inputs the runtime treats as stable keys. Authority-bearing
// strings pass EXACTLY or FAIL — they are NEVER silently trimmed or mutated (a mutated authority string is a
// different authority). Pure + side-effect-free; called at the submit edge BEFORE any grant lookup / write / mint.
export const AUKORA_INPUT_CAPS = { intentId: 128, stateKey: 256, claim: 64, action: 256, resource: 256 } as const;
const AUKORA_ASCII_PRINTABLE = /^[\x20-\x7E]*$/; // space..~ — rejects control (incl. \t \n), zero-width, bidi, non-ASCII

export function assertBoundedEngineInputs(args: {
  intentId?: string; stateKey?: string; claim?: string; action?: string; resource?: string;
}): void {
  const cap = (field: keyof typeof AUKORA_INPUT_CAPS, val?: string) => {
    if (val != null && val.length > AUKORA_INPUT_CAPS[field]) throw new Error(`aukora_input_too_long:${field}`);
  };
  cap("intentId", args.intentId);
  cap("stateKey", args.stateKey);
  cap("claim", args.claim);
  cap("action", args.action);
  cap("resource", args.resource);
  // Stable-key / id / token fields must be printable ASCII. action/resource get their non-ASCII guard from
  // assertAsciiTarget; free-text `statement` is intentionally NOT charset-restricted (it is display text, and is
  // already length-bounded where it is used).
  for (const [field, val] of [["stateKey", args.stateKey], ["intentId", args.intentId], ["claim", args.claim]] as const) {
    if (val != null && val !== "" && !AUKORA_ASCII_PRINTABLE.test(val)) throw new Error(`aukora_input_non_ascii:${field}`);
  }
}

// ── Decision token (mint / parse) ────────────────────────────────

/**
 * @deprecated UNSIGNED token builder — raw `pdt:<logId>:<hash>`. NOT for
 * enforcement (a leaked hash would forge it). Enforcement uses
 * buildSignedDecisionToken (HMAC). Kept only as the low-level string
 * builder + for shape tests. verifyAndConsumeDecisionToken recomputes an
 * HMAC sig, so a token from this function fails verification → safe.
 */
export function mintAukoraDecisionToken(
  logId: string,
  hash: string,
): string | null {
  if (!logId || !hash) return null;
  return `pdt:${logId}:${hash}`;
}

export type ParsedDecisionToken = { logId: string; sig: string };

/** Parse + validate token shape. Throws on malformed input. The third
 *  segment is the HMAC signature (see buildSignedDecisionToken). */
export function parseAukoraDecisionToken(token: string): ParsedDecisionToken {
  const parts = String(token ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== "pdt" || !parts[1] || !parts[2]) {
    throw new Error("aukora_decision_token_malformed");
  }
  return { logId: parts[1], sig: parts[2] };
}

// ── Grant usability ──────────────────────────────────────────────

export type GrantUsabilityInput = {
  status: AukoraGrantStatus;
  expiresAt: number;
  maxUses?: number;
  usedCount?: number;
};

export type GrantUsability =
  | { usable: true; usesRemaining: number | null }
  | { usable: false; reason: "not_active" | "expired" | "exhausted" };

/**
 * Is a grant usable right now? Checks active status, expiry, and the
 * one-shot/N-shot cap (maxUses vs usedCount). `usesRemaining` is null
 * when the grant is uncapped.
 */
export function grantUsability(
  grant: GrantUsabilityInput,
  now: number,
): GrantUsability {
  if (grant.status !== "active") return { usable: false, reason: "not_active" };
  if (now > grant.expiresAt) return { usable: false, reason: "expired" };
  if (typeof grant.maxUses === "number") {
    const used = grant.usedCount ?? 0;
    if (used >= grant.maxUses) return { usable: false, reason: "exhausted" };
    return { usable: true, usesRemaining: grant.maxUses - used };
  }
  return { usable: true, usesRemaining: null };
}

// ── Intent hash chain ────────────────────────────────────────────

/**
 * NON-CANONICAL link hash (Codex LOW). FNV-1a over a reduced payload —
 * fast, dependency-free, used only for Wave 2 link-continuity tests and
 * the read-only "links intact" check. The CANONICAL intent/receipt hash
 * is `sha256Hex(stableStringify(payload))` below, ported faithfully from
 * the Nebius forge. Wave 3 enforcement MUST use the canonical SHA path,
 * not this.
 */
export function hashIntentLink(input: {
  prevHash: string | null;
  logId: string;
  action: string;
  resource: string;
  claim: string;
  ts: number;
}): string {
  const material = [
    input.prevHash ?? "genesis",
    input.logId,
    input.action,
    input.resource,
    input.claim,
    String(input.ts),
  ].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Verify a hash chain's LINKS only: each row's prevHash equals the
 * previous row's hash, walking oldest→newest. Returns the first break
 * (index) or null if links are intact. NOTE: this does NOT recompute
 * the content hash — a row whose stored hash was tampered alongside a
 * payload edit would still pass. For full payload-integrity use the
 * canonical SHA recompute (`verifyReceiptChainRows`).
 */
export function findChainBreak(
  rows: Array<{ prevHash?: string | null; hash: string }>,
): number | null {
  for (let i = 1; i < rows.length; i += 1) {
    if ((rows[i].prevHash ?? null) !== rows[i - 1].hash) return i;
  }
  return null;
}

// ── Canonical SHA-256 chain (ported from Nebius aukoraIntentCore.mjs) ──

/** Deterministic JSON: object keys sorted recursively, so the same
 *  logical payload always stringifies identically. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeStableJson(value));
}

function normalizeStableJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeStableJson);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = normalizeStableJson(obj[key]);
  }
  return out;
}

/** SHA-256 hex via Web Crypto (available in Convex V8 + Node 20+). */
export async function sha256Hex(input: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("crypto_subtle_unavailable");
  const data = new TextEncoder().encode(String(input));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Canonical receipt chain-hash: SHA-256 over {prevHash, ...payload}. */
export async function buildReceiptChainHash(
  payload: Record<string, unknown>,
  prevHash: string | null,
): Promise<string> {
  return sha256Hex(stableStringify({ prevHash, ...payload }));
}

/** Canonical intent logId derived from the intent hash (Nebius: pil_<12>). */
export function intentLogIdFromHash(hash: string): string {
  return `pil_${hash.slice(0, 12)}`;
}

// ── Intent evaluation + execution (pure, ported from Nebius) ──────
//
// Scoped to the paths Wave 3 enforcement needs: salama hold/clear/
// trigger, the authorization gate, and the moga (action) claim, plus a
// minimal di/padi/intu proof path. The full Nebius claim taxonomy
// (nevidi/nontenta/inference chains) is a later port — documented, not
// silently dropped.

export type AukoraIntentInput = {
  ring: AukoraRing;
  claim: string;
  action?: string;
  resource?: string;
  statement?: string;
  requiresAuthorization?: boolean;
  authorizationGranted?: boolean;
  authorizationRef?: string;
  triggerSalama?: boolean;
  clearSalama?: boolean;
  proofRef?: string;
  intentId?: string;
  // Explicit human/Ring-0 clearance. self-modify (the highest ring) is NEVER auto-granted: it requires this flag set,
  // so a directly-inserted self-modify grant cannot authorize on its own. Defaults false everywhere.
  humanClearance?: boolean;
};

export type AukoraRuntimeStateInput = {
  salamaActive: boolean;
  salamaReason: string | null;
  lastHash?: string | null;
};

export type AukoraDecision = {
  status: AukoraIntentStatus;
  acceptedClaim: string;
  errorCode?: string;
  proofRefs: string[];
};

export type AukoraExecution = {
  status: "allowed" | "blocked";
  ring: AukoraRing;
  message: string;
  acceptedClaim: string;
  salamaActive: boolean;
};

export type AukoraEvaluation = {
  decision: AukoraDecision;
  nextState: AukoraRuntimeStateInput;
};

export function evaluateAukoraIntent(
  intent: AukoraIntentInput,
  proofRefs: Set<string>,
  state: AukoraRuntimeStateInput,
): AukoraEvaluation {
  const current: AukoraRuntimeStateInput = {
    salamaActive: Boolean(state.salamaActive),
    salamaReason: state.salamaReason ?? null,
    lastHash: state.lastHash ?? null,
  };

  // SALAMA STATE CHANGES ARE AUTHORIZED OPERATOR ACTIONS (REDTEAM Gemini #4 + Codex). The engine must NEVER
  // clear or trigger salama from an intent FLAG unless that intent carries a granted authorization — otherwise
  // an unauthorized/automated intent that merely sets clearSalama:true would lift the founder's hold, because
  // submitIntentCore persists nextState UNCONDITIONALLY (even on a blocked intent). This gate breaks NO
  // legitimate path: the live operator clear/trigger (clearSalama/triggerSalama mutations) writes runtime state
  // DIRECTLY behind requireFounderUserId and never uses these flags (grep: no caller passes them true). An
  // unauthorized salama-flag intent is REFUSED and returns the state UNCHANGED (nextState: current).
  if (intent.clearSalama) {
    if (!intent.authorizationGranted) {
      return { decision: { status: "refused", acceptedClaim: "salama", errorCode: "norauth", proofRefs: [] }, nextState: current };
    }
    return {
      decision: { status: "accepted", acceptedClaim: "salama", proofRefs: [] },
      nextState: { ...current, salamaActive: false, salamaReason: null },
    };
  }
  // While salama is active, nothing else passes.
  if (current.salamaActive) {
    return {
      decision: { status: "halted", acceptedClaim: "salama", proofRefs: [] },
      nextState: current,
    };
  }
  // Triggering salama halts the lane — also authorized-operator only.
  if (intent.triggerSalama) {
    if (!intent.authorizationGranted) {
      return { decision: { status: "refused", acceptedClaim: "salama", errorCode: "norauth", proofRefs: [] }, nextState: current };
    }
    return {
      decision: { status: "accepted", acceptedClaim: "salama", proofRefs: [] },
      nextState: {
        ...current,
        salamaActive: true,
        salamaReason: String(intent.statement ?? "salama triggered").slice(0, 1000),
      },
    };
  }
  // SACRED (Ring 0) — refuse at DECISION time too (F1, defense in depth). A sacred target never produces an
  // "accepted" decision, so no signed token is ever minted for it (submitIntentCore mints only on execution
  // "allowed") and the intent log records an honest "refused (sacred)" instead of an accepted decision the
  // executor then blocks. Placed AFTER the salama-operator gates (clear/trigger are meta-operations on engine
  // state, not effects on a sacred resource) and BEFORE the authorization gate + claim classification.
  if (isSacredTarget(intent.action, intent.resource)) {
    return {
      decision: { status: "refused", acceptedClaim: intent.claim, errorCode: "sacred", proofRefs: [] },
      nextState: current,
    };
  }
  // SELF-MODIFY CEILING (kernel invariant, ULTRON_PASS Brick 4): the highest ring is NEVER auto-granted. Even with a
  // matching grant (incl. a directly-inserted one), a self-modify intent is refused unless it carries explicit
  // human/Ring-0 clearance. This moves the "no auto self-modify" ceiling-wall from an issuance-layer policy into a
  // consume-time kernel invariant — closing the direct-grant-insert bypass. Placed after SACRED, before the auth gate.
  if (intent.ring === "self-modify" && !intent.humanClearance) {
    return {
      decision: { status: "refused", acceptedClaim: intent.claim, errorCode: "self_modify_requires_clearance", proofRefs: [] },
      nextState: current,
    };
  }
  // Authorization gate: an action that requires authorization but lacks a
  // granted authorization is refused (the negative control).
  if (intent.requiresAuthorization && !intent.authorizationGranted) {
    return {
      decision: { status: "refused", acceptedClaim: "moga", errorCode: "norauth", proofRefs: [] },
      nextState: current,
    };
  }

  switch (intent.claim) {
    case "moga":
      return {
        decision: { status: "accepted", acceptedClaim: "moga", proofRefs: [] },
        nextState: current,
      };
    case "di":
      if (intent.proofRef && proofRefs.has(String(intent.proofRef))) {
        return {
          decision: { status: "accepted", acceptedClaim: "di", proofRefs: [String(intent.proofRef)] },
          nextState: current,
        };
      }
      // No proof → downgrade to intu (an honest, unproven claim).
      return {
        decision: { status: "downgraded", acceptedClaim: "intu", proofRefs: [] },
        nextState: current,
      };
    case "padi":
    case "intu":
      return {
        decision: { status: "accepted", acceptedClaim: intent.claim, proofRefs: [] },
        nextState: current,
      };
    default:
      return {
        decision: { status: "refused", acceptedClaim: "intu", errorCode: "eroporta", proofRefs: [] },
        nextState: current,
      };
  }
}

export function executeAukoraIntent(
  intent: AukoraIntentInput,
  decision: AukoraDecision,
  state: AukoraRuntimeStateInput,
): AukoraExecution {
  const ring = intent.ring;
  const salamaActive = Boolean(state.salamaActive);
  const base = { ring, acceptedClaim: decision.acceptedClaim, salamaActive };

  // SACRED (Ring 0) — STRUCTURALLY FIRST (F1). Inviolable targets — the Aukora spine itself, identity/
  // doctrine, auth/AUMLOK, the founder allowlist, the kill switch, other users' data — are NEVER executed
  // against, for ANY ring/claim/grant/authorization/state (not even observe, not even a non-accepted or
  // salama path). Checked BEFORE the salama + decision-status gates so no reordering or future early-return
  // above can ever let a sacred effect slip. (The live effect path executeAukoraAction already refuses
  // sacred before touching a token; this mirrors that guarantee in the pure decision helper.) No key opens it.
  if (isSacredTarget(intent.action, intent.resource)) {
    return { ...base, status: "blocked", message: "Sacred target (Ring 0) — never executable." };
  }

  if (salamaActive) return { ...base, status: "blocked", message: "Salama active. Execution halted." };
  if (decision.status !== "accepted") {
    return { ...base, status: "blocked", message: "Aukora does not execute non-accepted intents." };
  }

  // observe = read-only, no durable effect → no grant required.
  if (ring === "observe") return { ...base, status: "allowed", message: "Observe lane approved." };

  // Codex HIGH + Gemini generalization fix: ALL durable rings
  // (local-write / external / self-modify) require an authorized grant
  // AND the moga claim. This is STRICTER than the Nebius per-claim rules
  // (which allow di/padi on local-write without authorization) — a
  // deliberate AUMA clamp until the full Nebius claim taxonomy
  // (proof-checked di/padi, inference chains) is ported. It closes the
  // grantless-durable-write footgun for every claim, not just moga.
  const authorized = Boolean(intent.requiresAuthorization) && Boolean(intent.authorizationGranted);
  if (!authorized) {
    return { ...base, status: "blocked", message: "Durable writes require an authorized grant." };
  }
  if (decision.acceptedClaim !== "moga") {
    return { ...base, status: "blocked", message: "Durable writes require the moga claim (interim clamp)." };
  }
  return { ...base, status: "allowed", message: `${ring} approved (authorized moga).` };
}

// ── HMAC-signed decision token (Gemini HIGH: a leaked intent hash must
//    NOT be enough to forge a token). The token sig is HMAC-SHA256 over
//    `${logId}:${intentHash}` keyed by a server-only secret, so forgery
//    requires the secret, not just read access to the intent row. ──

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("crypto_subtle_unavailable");
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Build the signed token: pdt:<logId>:<hmac(secret, logId:intentHash)>. */
export async function buildSignedDecisionToken(
  logId: string,
  intentHash: string,
  secret: string,
): Promise<string | null> {
  if (!logId || !intentHash || !secret) return null;
  const sig = await hmacSha256Hex(secret, `${logId}:${intentHash}`);
  return `pdt:${logId}:${sig}`;
}

/**
 * Constant-time string equality (self-red-team Wave 3.6): comparing the
 * token signature with `!==` leaks timing. Use this for any secret/HMAC
 * comparison so an attacker can't binary-search the signature byte by byte.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  // Always walk the full max length so the loop time doesn't reveal the
  // mismatch position; fold the length difference into the result.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Full payload-integrity chain verifier (canonical). Each row carries a
 * `payload` object and a stored `chainHash`; we recompute chainHash from
 * {prevHash, ...payload} and confirm it matches AND links to the prior.
 * Returns the first break index or null if fully intact.
 */
export async function verifyReceiptChainRows(
  rows: Array<{ payload: Record<string, unknown>; chainHash: string }>,
  startPrevHash: string | null = null,
): Promise<number | null> {
  let prevHash: string | null = startPrevHash;
  for (let i = 0; i < rows.length; i += 1) {
    const expected = await buildReceiptChainHash(rows[i].payload, prevHash);
    if (rows[i].chainHash !== expected) return i;
    prevHash = expected;
  }
  return null;
}