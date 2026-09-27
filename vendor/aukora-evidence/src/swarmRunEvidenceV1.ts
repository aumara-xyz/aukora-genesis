// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * SwarmRunEvidenceV1 (R57) — the minimum typed, content-free evidence envelope for a bounded swarm
 * worker run (research task, adversarial test proposal, classifier pass). Pure: no filesystem,
 * environment, network, subprocess, model call, or authority. `advisoryOnly:true` /
 * `grantsAuthority:false` are load-bearing literals: a swarm run is evidence, never authority.
 *
 * PROVENANCE NOTE: `canonical.ts`/`digest.ts`/`catalogue.ts`/`types.ts`/`index.ts` are byte-identity
 * pinned to the kernel donor (`scripts/verify-provenance.mjs`), so this contract cannot live in the
 * barrel. Like `providerTokenShapes.ts` it is an un-pinned companion, imported directly
 * (`@aukora/evidence/swarmRunEvidenceV1`). It composes the pinned primitives (canonical bytes,
 * domain-separated length-framed digest, secret catalogue) without modifying any of them.
 *
 * Contract laws (each individually tested):
 *  - TWO OUTCOME AXES, NEVER COLLAPSED. `execution.outcome` records what the transport/harness saw
 *    (completed | refused | timed-out | transport-failed); `governance.outcome` records what the
 *    governance layer decided about the artifact (ungoverned | accepted | rejected | quarantined).
 *    A transport success NEVER implies acceptance: the builder can only emit `ungoverned`, and
 *    acceptance requires an explicit classifier decision.
 *  - EPISTEMIC PROMOTION BOUNDARY (KIRA). Every run carries a closed epistemic source label.
 *    EXTERNAL_RESEARCH / MODEL_GENERATED / SELF_REPORTED material can be quarantined or rejected but
 *    can NEVER validate as `accepted` — only locally measured or locally reproduced evidence may
 *    cross into acceptance. Overclaims fail closed (E_EPISTEMIC_OVERCLAIM).
 *  - CONTENT-FREE. Prompts, outputs, credentials, and payloads never enter the envelope: only strict
 *    64-lowercase-hex digests of them do. Every free-string field is short, charset-limited, and
 *    screened against the donor secret catalogue plus the provider-token companion shapes.
 *  - FAIL-CLOSED. Validation is a positive allowlist over ordinary data objects: unknown fields,
 *    unknown schema versions, unknown enum members, malformed hashes, missing provenance,
 *    inconsistent outcome combinations, and impossible timestamp orderings are each hard errors.
 */

import { canonicalBytes, canonicalString } from './canonical';
import { sha256Hex, uint64BE } from './digest';
import { textHasSecret } from './catalogue';
import { textHasProviderToken } from './providerTokenShapes';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------------------------------
// Schema + closed enumerations
// ---------------------------------------------------------------------------------------------------

export const SWARM_RUN_EVIDENCE_SCHEMA = 'aukora-swarm-run-evidence-v1';
export type SwarmRunEvidenceSchema = typeof SWARM_RUN_EVIDENCE_SCHEMA;

/** Domain separator for the envelope digest — distinct from the EvidencePack domain by construction. */
export const SWARM_RUN_DIGEST_DOMAIN = 'aukora-swarm-run-evidence-v1';

/**
 * Closed epistemic source labels. Acceptance is reserved to the LOCAL_* members (KIRA boundary).
 * R60 H1: every exported law table is Object.frozen — a caller cannot push a new source into
 * `ACCEPTANCE_ELIGIBLE_SOURCES` (or any enum) to widen acceptance at runtime.
 */
export const EPISTEMIC_SOURCES = Object.freeze([
  'LOCAL_MEASUREMENT',   // measured directly against the base commit on this machine
  'LOCAL_REPRODUCTION',  // an external claim independently re-executed locally
  'EXTERNAL_RESEARCH',   // gathered from outside sources; advisory until locally reproduced
  'MODEL_GENERATED',     // produced by a model without local verification
  'SELF_REPORTED',       // asserted by the worker about itself without independent measurement
  'REMOTE_ONLY',         // R58: executed on a remote service; receipts held, never re-run locally
] as const);
export type EpistemicSourceV1 = typeof EPISTEMIC_SOURCES[number];

/** Epistemic sources allowed to validate as governance-accepted (the promotion boundary). FROZEN (R60 H1). */
export const ACCEPTANCE_ELIGIBLE_SOURCES: readonly EpistemicSourceV1[] =
  Object.freeze(['LOCAL_MEASUREMENT', 'LOCAL_REPRODUCTION'] as const);

/** What the harness observed. Transport truth only — says NOTHING about acceptability. */
export const EXECUTION_OUTCOMES = Object.freeze(['completed', 'refused', 'timed-out', 'transport-failed'] as const);
export type ExecutionOutcomeV1 = typeof EXECUTION_OUTCOMES[number];

/** What governance decided. `ungoverned` = no decision yet — the ONLY state a builder may emit. */
export const GOVERNANCE_OUTCOMES = Object.freeze(['ungoverned', 'accepted', 'rejected', 'quarantined'] as const);
export type GovernanceOutcomeV1 = typeof GOVERNANCE_OUTCOMES[number];

export const NETWORK_EGRESS = Object.freeze(['none', 'read-only', 'unrestricted'] as const);
export type NetworkEgressV1 = typeof NETWORK_EGRESS[number];

// ---------------------------------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------------------------------

export interface SwarmModelRefV1 {
  readonly id: string;        // e.g. "local/fable-worker" — label-shaped, never a payload
  readonly revision: string;  // model revision/build tag
}

export interface SwarmExecutionV1 {
  readonly outcome: ExecutionOutcomeV1;
  readonly startedAtMs: number;    // epoch ms, safe integer, >= EPOCH_MIN_MS
  readonly completedAtMs: number;  // epoch ms, >= startedAtMs (when the harness closed the run)
  readonly runner: string;         // execution provenance: which harness seat ran it
  readonly sandboxed: boolean;
  readonly networkEgress: NetworkEgressV1;
}

export interface SwarmGovernanceV1 {
  readonly outcome: GovernanceOutcomeV1;
  readonly classifierVersion: string | null; // REQUIRED for any governed outcome, null iff ungoverned
  readonly decidedAtMs: number | null;       // REQUIRED for any governed outcome, null iff ungoverned
}

export interface SwarmRunEvidenceV1 {
  readonly schema: SwarmRunEvidenceSchema;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
  readonly taskId: string;
  readonly epistemicSource: EpistemicSourceV1;
  readonly model: SwarmModelRefV1;
  readonly harnessVersion: string;
  readonly baseCommit: string;          // 40-lowercase-hex git commit the run was based on
  readonly inputDigest: string;         // 64-hex sha256 of the raw prompt/input — content never stored
  readonly outputDigest: string | null; // 64-hex sha256 of the raw output; null when none arrived
  readonly execution: SwarmExecutionV1;
  readonly governance: SwarmGovernanceV1;
}

/** The delivered artifact: body + its domain-separated content digest. */
export interface SwarmRunEvidenceEnvelopeV1 {
  readonly body: SwarmRunEvidenceV1;
  readonly runDigest: string;
}

// ---------------------------------------------------------------------------------------------------
// Error codes + result type (own closed list — the donor ERROR_CODES table is pinned)
// ---------------------------------------------------------------------------------------------------

export const SWARM_ERROR_CODES = [
  'E_SCHEMA', 'E_NOT_OBJECT', 'E_PROTO', 'E_MISSING_FIELD', 'E_UNKNOWN_FIELD', 'E_WRONG_TYPE',
  'E_ADVISORY_LITERAL', 'E_BAD_ENUM', 'E_BAD_SHA', 'E_BAD_GITSHA', 'E_BAD_LABEL', 'E_SECRET_CONTENT',
  'E_BAD_INTEGER', 'E_TIME_RANGE', 'E_TIME_ORDER', 'E_OUTCOME_CONTRADICTION', 'E_EPISTEMIC_OVERCLAIM',
  'E_GOVERNANCE_INCOMPLETE', 'E_DIGEST_MISMATCH', 'E_SEAL_NOT_UNGOVERNED',
] as const;
export type SwarmErrorCode = typeof SWARM_ERROR_CODES[number];

export interface SwarmValidationOk { readonly ok: true; }
export interface SwarmValidationErr {
  readonly ok: false;
  readonly code: SwarmErrorCode;
  readonly path: string;
  readonly message: string;
}
export type SwarmValidationResult = SwarmValidationOk | SwarmValidationErr;

const OK: SwarmValidationResult = { ok: true };
function err(code: SwarmErrorCode, path: string, message: string): SwarmValidationResult {
  return { ok: false, code, path, message };
}

// ---------------------------------------------------------------------------------------------------
// Field disciplines
// ---------------------------------------------------------------------------------------------------

const SHA256_RE = /^[0-9a-f]{64}$/;
const GITSHA_RE = /^[0-9a-f]{40}$/;
// Short identifier-shaped labels only. The length caps are the anti-payload wall: a prompt, an
// output excerpt, or a credential cannot fit an identifier charset at these lengths.
const LABEL_RE = /^[A-Za-z0-9][\w.:+-]{0,63}$/;
const MODEL_ID_RE = /^[A-Za-z0-9][\w.:/-]{0,127}$/; // model ids may carry an org/name slash

/** Earliest plausible run timestamp (2020-01-01T00:00:00Z) — rejects zeroed/garbage clocks. */
export const EPOCH_MIN_MS = 1577836800000;

const BODY_KEYS = [
  'schema', 'advisoryOnly', 'grantsAuthority', 'taskId', 'epistemicSource', 'model', 'harnessVersion',
  'baseCommit', 'inputDigest', 'outputDigest', 'execution', 'governance',
];
const MODEL_KEYS = ['id', 'revision'];
const EXECUTION_KEYS = ['outcome', 'startedAtMs', 'completedAtMs', 'runner', 'sandboxed', 'networkEgress'];
const GOVERNANCE_KEYS = ['outcome', 'classifierVersion', 'decidedAtMs'];
const ENVELOPE_KEYS = ['body', 'runDigest'];

// Same red-team posture as the donor validator: only ordinary data objects, no foreign prototypes,
// no symbols, no non-enumerable own keys, no accessors — the validated surface must be exactly the
// canonicalized surface.
function ordinaryDataObject(v: unknown, p: string): SwarmValidationResult {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return err('E_NOT_OBJECT', p, 'expected object');
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return err('E_PROTO', p, 'non-ordinary prototype');
  if (Object.getOwnPropertySymbols(v).length > 0) return err('E_PROTO', p, 'symbol own property');
  const names = Object.getOwnPropertyNames(v);
  if (names.length !== Object.keys(v).length) return err('E_PROTO', p, 'non-enumerable own property');
  for (const k of names) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || d.get !== undefined || d.set !== undefined) return err('E_PROTO', `${p}.${k}`, 'accessor property');
  }
  return OK;
}

function exactKeys(v: Record<string, unknown>, keys: readonly string[], p: string): SwarmValidationResult {
  for (const k of keys) if (!(k in v)) return err('E_MISSING_FIELD', `${p}.${k}`, 'missing required field');
  for (const k of Object.keys(v)) if (!keys.includes(k)) return err('E_UNKNOWN_FIELD', `${p}.${k}`, 'unknown field');
  return OK;
}

/**
 * R60 H1: recursively REJECT (not merely neutralize) accessor/prototype tricks BEFORE any value read.
 * Walks own-property DESCRIPTORS only — it never invokes a getter — so a chameleon getter cannot return
 * one value to a gate and another to the digest: such an object is refused here with `E_PROTO`. Consistent
 * with the `ordinaryDataObject`/`E_PROTO` law already enforced inside `validateSwarmRunBody`. Total: a
 * primitive/null leaf is fine; only objects/arrays are structurally screened.
 */
function rejectAccessorsDeep(v: unknown, p: string): SwarmValidationResult {
  if (v === null || typeof v !== 'object') return OK; // primitive leaf — nothing to subvert
  if (Array.isArray(v)) {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Array.prototype) return err('E_PROTO', p, 'non-ordinary array prototype');
    if (Object.getOwnPropertySymbols(v).length > 0) return err('E_PROTO', p, 'symbol own property');
    const names = Object.getOwnPropertyNames(v).filter((k) => k !== 'length');
    for (const k of names) {
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!d || d.get !== undefined || d.set !== undefined || d.enumerable === false) return err('E_PROTO', `${p}.${k}`, 'accessor/non-enumerable array index');
      const r = rejectAccessorsDeep((v as unknown[])[Number(k)], `${p}[${k}]`);
      if (!r.ok) return r;
    }
    return OK;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return err('E_PROTO', p, 'non-ordinary prototype');
  if (Object.getOwnPropertySymbols(v).length > 0) return err('E_PROTO', p, 'symbol own property');
  for (const k of Object.getOwnPropertyNames(v)) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || d.get !== undefined || d.set !== undefined) return err('E_PROTO', `${p}.${k}`, 'accessor property');
    const r = rejectAccessorsDeep((v as Record<string, unknown>)[k], `${p}.${k}`);
    if (!r.ok) return r;
  }
  return OK;
}

/**
 * R60 H1 snapshot-first primitive: reject accessor/prototype tricks on the LIVE input, then take exactly
 * ONE canonical snapshot. After this returns, every downstream gate/validation/digest/freeze reads the
 * SAME inert plain object — there is no second read of the caller's live object, so no TOCTOU split.
 * Throws `<code>:<path>` (E_PROTO or a canonicalization error) on hostile input.
 */
function inertSnapshotOrThrow<T>(value: unknown, p: string): T {
  const g = rejectAccessorsDeep(value, p);
  if (!g.ok) throw new Error(`${g.code}:${g.path}`);
  return JSON.parse(canonicalString(value)) as T; // one read; getters already excluded, so faithful
}

function checkLabel(v: unknown, re: RegExp, p: string): SwarmValidationResult {
  if (typeof v !== 'string') return err('E_WRONG_TYPE', p, 'expected string');
  if (v !== v.normalize('NFC')) return err('E_BAD_LABEL', p, 'not NFC-normalized');
  if (!re.test(v)) return err('E_BAD_LABEL', p, 'not an identifier-shaped label (charset/length)');
  if (textHasSecret(v) || textHasProviderToken(v)) return err('E_SECRET_CONTENT', p, 'secret-shaped content refused');
  return OK;
}

function checkEpochMs(v: unknown, p: string): SwarmValidationResult {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || Object.is(v, -0)) return err('E_BAD_INTEGER', p, 'expected safe integer');
  if (v < EPOCH_MIN_MS) return err('E_TIME_RANGE', p, 'timestamp before plausibility floor (2020-01-01Z)');
  return OK;
}

// ---------------------------------------------------------------------------------------------------
// Fail-closed validation
// ---------------------------------------------------------------------------------------------------

export function validateSwarmRunBody(value: unknown): SwarmValidationResult {
  let r = ordinaryDataObject(value, 'body');
  if (!r.ok) return r;
  const b = value as Record<string, unknown>;
  r = exactKeys(b, BODY_KEYS, 'body');
  if (!r.ok) return r;

  if (b.schema !== SWARM_RUN_EVIDENCE_SCHEMA) return err('E_SCHEMA', 'body.schema', `unknown schema version (expected ${SWARM_RUN_EVIDENCE_SCHEMA})`);
  if (b.advisoryOnly !== true) return err('E_ADVISORY_LITERAL', 'body.advisoryOnly', 'advisoryOnly must be literally true');
  if (b.grantsAuthority !== false) return err('E_ADVISORY_LITERAL', 'body.grantsAuthority', 'grantsAuthority must be literally false');

  r = checkLabel(b.taskId, LABEL_RE, 'body.taskId');
  if (!r.ok) return r;

  if (typeof b.epistemicSource !== 'string' || !(EPISTEMIC_SOURCES as readonly string[]).includes(b.epistemicSource)) {
    return err('E_BAD_ENUM', 'body.epistemicSource', 'unknown epistemic source label');
  }

  r = ordinaryDataObject(b.model, 'body.model');
  if (!r.ok) return r;
  const model = b.model as Record<string, unknown>;
  r = exactKeys(model, MODEL_KEYS, 'body.model');
  if (!r.ok) return r;
  r = checkLabel(model.id, MODEL_ID_RE, 'body.model.id');
  if (!r.ok) return r;
  r = checkLabel(model.revision, LABEL_RE, 'body.model.revision');
  if (!r.ok) return r;

  r = checkLabel(b.harnessVersion, LABEL_RE, 'body.harnessVersion');
  if (!r.ok) return r;

  if (typeof b.baseCommit !== 'string' || !GITSHA_RE.test(b.baseCommit)) {
    return err('E_BAD_GITSHA', 'body.baseCommit', 'expected 40-lowercase-hex git commit (execution provenance)');
  }
  if (typeof b.inputDigest !== 'string' || !SHA256_RE.test(b.inputDigest)) {
    return err('E_BAD_SHA', 'body.inputDigest', 'expected strict 64-lowercase-hex sha256');
  }
  if (b.outputDigest !== null && (typeof b.outputDigest !== 'string' || !SHA256_RE.test(b.outputDigest))) {
    return err('E_BAD_SHA', 'body.outputDigest', 'expected strict 64-lowercase-hex sha256 or null');
  }

  r = ordinaryDataObject(b.execution, 'body.execution');
  if (!r.ok) return r;
  const ex = b.execution as Record<string, unknown>;
  r = exactKeys(ex, EXECUTION_KEYS, 'body.execution');
  if (!r.ok) return r;
  if (typeof ex.outcome !== 'string' || !(EXECUTION_OUTCOMES as readonly string[]).includes(ex.outcome)) {
    return err('E_BAD_ENUM', 'body.execution.outcome', 'unknown execution outcome');
  }
  r = checkEpochMs(ex.startedAtMs, 'body.execution.startedAtMs');
  if (!r.ok) return r;
  r = checkEpochMs(ex.completedAtMs, 'body.execution.completedAtMs');
  if (!r.ok) return r;
  if ((ex.completedAtMs as number) < (ex.startedAtMs as number)) {
    return err('E_TIME_ORDER', 'body.execution.completedAtMs', 'completedAtMs precedes startedAtMs');
  }
  r = checkLabel(ex.runner, LABEL_RE, 'body.execution.runner');
  if (!r.ok) return r;
  if (typeof ex.sandboxed !== 'boolean') return err('E_WRONG_TYPE', 'body.execution.sandboxed', 'expected boolean');
  if (typeof ex.networkEgress !== 'string' || !(NETWORK_EGRESS as readonly string[]).includes(ex.networkEgress)) {
    return err('E_BAD_ENUM', 'body.execution.networkEgress', 'unknown network egress mode');
  }

  r = ordinaryDataObject(b.governance, 'body.governance');
  if (!r.ok) return r;
  const gov = b.governance as Record<string, unknown>;
  r = exactKeys(gov, GOVERNANCE_KEYS, 'body.governance');
  if (!r.ok) return r;
  if (typeof gov.outcome !== 'string' || !(GOVERNANCE_OUTCOMES as readonly string[]).includes(gov.outcome)) {
    return err('E_BAD_ENUM', 'body.governance.outcome', 'unknown governance outcome');
  }

  // Governance completeness: ungoverned carries NO decision fields; any governed outcome carries BOTH.
  if (gov.outcome === 'ungoverned') {
    if (gov.classifierVersion !== null) return err('E_GOVERNANCE_INCOMPLETE', 'body.governance.classifierVersion', 'ungoverned run must not carry a classifier version');
    if (gov.decidedAtMs !== null) return err('E_GOVERNANCE_INCOMPLETE', 'body.governance.decidedAtMs', 'ungoverned run must not carry a decision time');
  } else {
    if (gov.classifierVersion === null) return err('E_GOVERNANCE_INCOMPLETE', 'body.governance.classifierVersion', `${gov.outcome} requires an explicit classifier version`);
    r = checkLabel(gov.classifierVersion, LABEL_RE, 'body.governance.classifierVersion');
    if (!r.ok) return r;
    if (gov.decidedAtMs === null) return err('E_GOVERNANCE_INCOMPLETE', 'body.governance.decidedAtMs', `${gov.outcome} requires an explicit decision time`);
    r = checkEpochMs(gov.decidedAtMs, 'body.governance.decidedAtMs');
    if (!r.ok) return r;
    if ((gov.decidedAtMs as number) < (ex.completedAtMs as number)) {
      return err('E_TIME_ORDER', 'body.governance.decidedAtMs', 'governance decided before execution completed');
    }
  }

  // Outcome-axis contradiction laws. Transport truth and governance truth must stay separately
  // representable AND jointly coherent:
  //  C1  acceptance requires a completed execution — a refused/timed-out/transport-failed run can
  //      never validate as accepted (transport success ≠ acceptance is the builder's law; transport
  //      NON-success ⇒ non-acceptance is this validator's law).
  //  C2  acceptance requires an artifact (outputDigest present) — accepting nothing is an overclaim.
  //  C3  transport-failed means nothing arrived — an outputDigest there is a fabrication.
  //  C4  (KIRA promotion boundary) only LOCAL_MEASUREMENT / LOCAL_REPRODUCTION may be accepted;
  //      EXTERNAL_RESEARCH / MODEL_GENERATED / SELF_REPORTED saturate at quarantined/rejected.
  if (gov.outcome === 'accepted') {
    if (ex.outcome !== 'completed') {
      return err('E_OUTCOME_CONTRADICTION', 'body.governance.outcome', `accepted contradicts execution outcome ${String(ex.outcome)}`);
    }
    if (b.outputDigest === null) {
      return err('E_OUTCOME_CONTRADICTION', 'body.outputDigest', 'accepted run must carry an output digest');
    }
    if (!ACCEPTANCE_ELIGIBLE_SOURCES.includes(b.epistemicSource as EpistemicSourceV1)) {
      return err('E_EPISTEMIC_OVERCLAIM', 'body.epistemicSource', `${String(b.epistemicSource)} evidence cannot be promoted to accepted (max: quarantined)`);
    }
  }
  if (ex.outcome === 'transport-failed' && b.outputDigest !== null) {
    return err('E_OUTCOME_CONTRADICTION', 'body.outputDigest', 'transport-failed run cannot carry an output digest');
  }

  return OK;
}

// ---------------------------------------------------------------------------------------------------
// Digest + envelope
// ---------------------------------------------------------------------------------------------------

const encoder = new TextEncoder();

/** Domain-separated, length-framed digest — same construction as packDigest, distinct domain. */
export function swarmRunDigest(body: unknown): string {
  const canonical = canonicalBytes(body);
  const h = createHash('sha256');
  h.update(encoder.encode(SWARM_RUN_DIGEST_DOMAIN));
  h.update(new Uint8Array([0x00]));
  h.update(uint64BE(canonical.length));
  h.update(canonical);
  return h.digest('hex');
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object') {
    for (const k of Object.keys(o as Record<string, unknown>)) deepFreeze((o as Record<string, unknown>)[k]);
    Object.freeze(o);
  }
  return o;
}

/**
 * INTERNAL seal: validate a body then seal it. Snapshot-first like the donor sealEnvelope: ONE canonical
 * snapshot is taken up front, and that exact snapshot is validated, digested, and frozen — an accessor
 * cannot show clean bytes to validation and dirty bytes to the digest. Throws `<code>:<path>` on invalid
 * bodies. NOT exported: only the public ungoverned seal and the governance door reach it, so a governed
 * envelope can be minted ONLY through `governSwarmRunEvidence`.
 */
function sealSnapshot(snap: SwarmRunEvidenceV1): SwarmRunEvidenceEnvelopeV1 {
  const v = validateSwarmRunBody(snap);
  if (!v.ok) throw new Error(`${v.code}:${v.path}`);
  return deepFreeze({ body: snap, runDigest: swarmRunDigest(snap) });
}

/**
 * INTERNAL seal: take ONE inert snapshot of the body (rejecting accessor/prototype tricks up front), then
 * validate, digest, and freeze THAT SAME snapshot. NOT exported: only the public ungoverned seal and the
 * governance door reach it, so a governed envelope can be minted ONLY through `governSwarmRunEvidence`.
 * Throws `<code>:<path>` on invalid/hostile bodies.
 */
function sealBodyChecked(body: SwarmRunEvidenceV1): SwarmRunEvidenceEnvelopeV1 {
  return sealSnapshot(inertSnapshotOrThrow<SwarmRunEvidenceV1>(body, 'body'));
}

/**
 * Public seal — NARROWED (R59 M2) + SNAPSHOT-FIRST (R60 H1): admits ONLY ungoverned evidence. Acceptance /
 * rejection / quarantine exist solely through `governSwarmRunEvidence` (the governance door), so the
 * exported seal API cannot self-certify a hand-built `accepted` body nor re-seal an axis-edited
 * (ungoverned→governed) envelope. The `ungoverned` gate reads the SAME inert snapshot that is validated,
 * digested, and frozen — closing the R59 TOCTOU where the gate read a live getter and the digest read a
 * different value. `validateSwarmRunBody`'s LOCAL_*-only law remains the value-level backstop. Throws.
 */
export function sealSwarmRunEvidence(body: SwarmRunEvidenceV1): SwarmRunEvidenceEnvelopeV1 {
  const snap = inertSnapshotOrThrow<SwarmRunEvidenceV1>(body, 'body');
  if (snap?.governance?.outcome !== 'ungoverned') {
    throw new Error('E_SEAL_NOT_UNGOVERNED:body.governance.outcome');
  }
  return sealSnapshot(snap);
}

export function validateSwarmRunEnvelope(value: unknown): SwarmValidationResult {
  const r = ordinaryDataObject(value, 'envelope');
  if (!r.ok) return r;
  const env = value as Record<string, unknown>;
  const k = exactKeys(env, ENVELOPE_KEYS, 'envelope');
  if (!k.ok) return k;
  const bv = validateSwarmRunBody(env.body);
  if (!bv.ok) return bv;
  if (typeof env.runDigest !== 'string' || !SHA256_RE.test(env.runDigest)) {
    return err('E_BAD_SHA', 'envelope.runDigest', 'expected strict 64-lowercase-hex sha256');
  }
  if (env.runDigest !== swarmRunDigest(env.body)) {
    return err('E_DIGEST_MISMATCH', 'envelope.runDigest', 'digest does not match body');
  }
  return OK;
}

/**
 * INTEGRITY ONLY (R60 H1 — do not confuse with authority). TOTAL boolean predicate on hostile input:
 * true iff the envelope is structurally valid AND its runDigest matches its body. This proves the bytes
 * are internally consistent and untampered since sealing — it does NOT prove that a governed
 * `outcome: 'accepted'` was minted by the governance door: anyone can hand-build a valid `accepted` body
 * for a LOCAL_* source and compute its digest. A consumer that treats `verify == true` as authorization
 * is unsafe; read a governed decision only through `readGovernanceDecision` (which never yields authority).
 */
export function verifySwarmRunEnvelopeIntegrity(env: unknown): boolean {
  try {
    const snap = JSON.parse(canonicalString(env)) as unknown;
    return validateSwarmRunEnvelope(snap).ok;
  } catch {
    return false;
  }
}

/** @deprecated Ambiguous name; use `verifySwarmRunEnvelopeIntegrity`. Integrity, NOT authenticity. */
export const verifySwarmRunEnvelope = verifySwarmRunEnvelopeIntegrity;

/**
 * An ADVISORY governance reading. There is no `authorized: boolean` by construction — the envelope carries
 * `grantsAuthority: false`, and integrity is not authenticity. Consumers get the decision plus the standing
 * advisory literal; authenticity of the decision must come from the classifier's own signed attestation
 * (out of scope here), never from this envelope.
 */
export interface AdvisoryGovernanceReadingV1 {
  readonly outcome: GovernanceOutcomeV1;
  readonly classifierVersion: string | null;
  readonly decidedAtMs: number | null;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

/**
 * The fail-closed consumer guard: the ONE sanctioned way to read a governed outcome. Returns null unless
 * the envelope passes integrity AND carries the advisory literals; otherwise returns the decision wrapped
 * so it can never be mistaken for authority (no boolean authorization is exposed anywhere). This is the
 * governed-decision verification boundary: a bare digest verifier must never be consumed as authority.
 */
export function readGovernanceDecision(env: unknown): AdvisoryGovernanceReadingV1 | null {
  try {
    const snap = JSON.parse(canonicalString(env)) as SwarmRunEvidenceEnvelopeV1;
    if (!validateSwarmRunEnvelope(snap).ok) return null;               // integrity gate
    if (snap.body.advisoryOnly !== true || snap.body.grantsAuthority !== false) return null; // literals gate
    const g = snap.body.governance;
    return { outcome: g.outcome, classifierVersion: g.classifierVersion, decidedAtMs: g.decidedAtMs, advisoryOnly: true, grantsAuthority: false };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------
// Sanitizing builder + governance transition
// ---------------------------------------------------------------------------------------------------

/** sha256 of the UTF-8 bytes of raw text — the ONLY form in which run content may be referenced. */
export function sha256OfUtf8(text: string): string {
  return sha256Hex(encoder.encode(text));
}

/** Raw materials of a run. `rawInput`/`rawOutput` are digested and DISCARDED — never published. */
export interface SwarmRunSourceV1 {
  readonly taskId: string;
  readonly epistemicSource: EpistemicSourceV1;
  readonly model: SwarmModelRefV1;
  readonly harnessVersion: string;
  readonly baseCommit: string;
  readonly rawInput: string;
  readonly rawOutput: string | null;
  readonly execution: SwarmExecutionV1;
}

/**
 * Sanitizing constructor: digests the raw prompt/output locally, drops them, and seals a content-free
 * envelope. Governance is ALWAYS `ungoverned` here — a builder observing a transport success has no
 * standing to accept; acceptance exists only via `governSwarmRunEvidence` with an explicit classifier
 * decision. Fail-closed: label-shaped fields that carry secrets or payloads make the seal throw.
 */
export function buildSwarmRunEvidenceV1(source: SwarmRunSourceV1): SwarmRunEvidenceEnvelopeV1 {
  const body: SwarmRunEvidenceV1 = {
    schema: SWARM_RUN_EVIDENCE_SCHEMA,
    advisoryOnly: true,
    grantsAuthority: false,
    taskId: source.taskId,
    epistemicSource: source.epistemicSource,
    model: { id: source.model.id, revision: source.model.revision },
    harnessVersion: source.harnessVersion,
    baseCommit: source.baseCommit,
    inputDigest: sha256OfUtf8(source.rawInput),
    outputDigest: source.rawOutput === null ? null : sha256OfUtf8(source.rawOutput),
    execution: {
      outcome: source.execution.outcome,
      startedAtMs: source.execution.startedAtMs,
      completedAtMs: source.execution.completedAtMs,
      runner: source.execution.runner,
      sandboxed: source.execution.sandboxed,
      networkEgress: source.execution.networkEgress,
    },
    governance: { outcome: 'ungoverned', classifierVersion: null, decidedAtMs: null },
  };
  return sealSwarmRunEvidence(body);
}

export interface SwarmGovernanceDecisionV1 {
  readonly outcome: Exclude<GovernanceOutcomeV1, 'ungoverned'>;
  readonly classifierVersion: string;
  readonly decidedAtMs: number;
}

/**
 * The one typed door from `ungoverned` to a governed outcome. Re-validates the input envelope
 * (refusing tampered or already-governed evidence), then seals a new envelope carrying the decision —
 * so every contradiction law (accepted-but-refused, accepted-external-research, decision-before-
 * completion) is re-checked at the door and an illegal decision throws instead of sealing.
 */
export function governSwarmRunEvidence(
  env: SwarmRunEvidenceEnvelopeV1,
  decision: SwarmGovernanceDecisionV1,
): SwarmRunEvidenceEnvelopeV1 {
  // R60 H1 snapshot-first: take ONE inert snapshot of the input envelope and read EVERY decision from it —
  // validation, the ungoverned precondition, and the spread that builds the governed body all read the same
  // frozen bytes. The prior code validated a snapshot but then re-read `env.body` live, so a getter chameleon
  // could pass validation clean yet spread a governed/edited body into the door.
  const snap = inertSnapshotOrThrow<SwarmRunEvidenceEnvelopeV1>(env, 'envelope');
  const v = validateSwarmRunEnvelope(snap);
  if (!v.ok) throw new Error(`${v.code}:${v.path}`);
  if (snap.body.governance.outcome !== 'ungoverned') {
    throw new Error('E_OUTCOME_CONTRADICTION:body.governance.outcome');
  }
  const body: SwarmRunEvidenceV1 = {
    ...snap.body,
    governance: {
      outcome: decision.outcome,
      classifierVersion: decision.classifierVersion,
      decidedAtMs: decision.decidedAtMs,
    },
  };
  // Seal the SNAPSHOT-derived body (already inert) — the door is the sole minter of governed envelopes.
  return sealSnapshot(inertSnapshotOrThrow<SwarmRunEvidenceV1>(body, 'body'));
}
