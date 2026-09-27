// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AGRE evidence adapter (R58) — the FIRST real producer of `SwarmRunEvidenceV1`. Converts a
 * content-free ARC/AGRE game-run receipt (source-code-first solver episodes on ARC-AGI-3-style
 * games, cf. docs/skunkworks/agre_v2/) into a sealed swarm evidence envelope. Pure: no filesystem,
 * environment, network, subprocess, model call, game runtime, or authority.
 *
 * Like every post-donor evidence contract this is an un-pinned companion module, imported directly
 * (`@aukora/evidence/agreEvidenceAdapterV1`); the donor barrel stays byte-identical.
 *
 * Adapter laws (each adversarially tested):
 *  - ONLY DERIVED LABELS. Callers supply a closed run ORIGIN (LOCAL_RUN | LOCAL_REPLAY |
 *    REMOTE_ONLY | SELF_REPORTED_DOC); the envelope's epistemic source is DERIVED from it by a fixed
 *    total mapping. There is no parameter through which a caller can assert an epistemic label, so
 *    source-label laundering has no input to attack. REMOTE_ONLY / SELF_REPORTED_DOC map to labels
 *    outside the acceptance-eligible set and therefore saturate at quarantined/rejected under the
 *    envelope's E_EPISTEMIC_OVERCLAIM law until a qualifying LOCAL_REPLAY (→ LOCAL_REPRODUCTION)
 *    run exists.
 *  - RECEIPT↔ENVELOPE BINDING. The envelope's inputDigest is the domain-separated digest of the
 *    exact canonical receipt, and `agreEnvelopeMatchesReceipt` re-derives taskId, epistemic label,
 *    and replay pairing from the receipt — so a post-hoc label or outcome edit breaks the pairing
 *    even if the edited envelope is internally well-formed after re-sealing.
 *  - REPLAY OR NO CLAIM. `levelBeaten: true` REQUIRES replay references (episode digest + action-log
 *    digest) and at least one action sent. A beaten-level claim with no replayable trail fails
 *    closed (E_AGRE_MISSING_REPLAY) — it can at best exist as levelBeaten:false observation.
 *  - BLIND MEANS BLIND. `method: 'source-analysis'` reads the game's source; such a run claiming
 *    `blind: true` is a mislabel and fails closed (E_AGRE_BLIND_MISLABEL). Discovery/probing runs
 *    may honestly be blind or not.
 *  - AXES STAY SEPARATE. The adapter can only emit `governance: ungoverned` (it seals through the
 *    R57 builder path); transport completion never implies acceptance. Receipt-level outcome
 *    contradictions (a levelBeaten claim on a refused/timed-out/transport-failed run; replay
 *    references on a transport-failed run) fail closed before sealing.
 *  - CONTENT-FREE. Receipts carry digests, closed labels, bounded counts, and identifiers only —
 *    no raw game frames, source code, model output, or private payloads. Every label passes the
 *    envelope's secret/provider-token screens at seal time.
 */

import { canonicalBytes, canonicalString } from './canonical';
import { uint64BE } from './digest';
import { createHash } from 'node:crypto';
import {
  EpistemicSourceV1, SwarmModelRefV1, SwarmExecutionV1, SwarmRunEvidenceV1,
  SwarmRunEvidenceEnvelopeV1, SWARM_RUN_EVIDENCE_SCHEMA,
  sealSwarmRunEvidence, verifySwarmRunEnvelope,
} from './swarmRunEvidenceV1';

// ---------------------------------------------------------------------------------------------------
// Schema + closed enumerations
// ---------------------------------------------------------------------------------------------------

export const AGRE_RUN_RECEIPT_SCHEMA = 'aukora-agre-run-receipt-v1';
export type AgreRunReceiptSchema = typeof AGRE_RUN_RECEIPT_SCHEMA;

/** Domain separator for the receipt digest — distinct from every other evidence domain. */
export const AGRE_RECEIPT_DIGEST_DOMAIN = 'aukora-agre-run-receipt-v1';

/** How the run was obtained. The ONLY epistemic input a caller has — labels are derived from it. */
export const AGRE_RUN_ORIGINS = [
  'LOCAL_RUN',          // executed by our harness on this machine → LOCAL_MEASUREMENT
  'LOCAL_REPLAY',       // an external claim re-executed locally from its replay → LOCAL_REPRODUCTION
  'REMOTE_ONLY',        // ran on a remote service; receipts held, never re-run locally → REMOTE_ONLY
  'SELF_REPORTED_DOC',  // transcribed from a research doc / worker self-report → SELF_REPORTED
] as const;
export type AgreRunOriginV1 = typeof AGRE_RUN_ORIGINS[number];

/** Solving method. source-analysis reads the game's packaged source; discovery probes blind-capable. */
export const AGRE_METHODS = ['source-analysis', 'discovery-probing'] as const;
export type AgreMethodV1 = typeof AGRE_METHODS[number];

/** Fixed total origin→epistemic mapping. Not overridable; the adapter's anti-laundering core. */
export function epistemicSourceForOrigin(origin: AgreRunOriginV1): EpistemicSourceV1 {
  switch (origin) {
    case 'LOCAL_RUN': return 'LOCAL_MEASUREMENT';
    case 'LOCAL_REPLAY': return 'LOCAL_REPRODUCTION';
    case 'REMOTE_ONLY': return 'REMOTE_ONLY';
    case 'SELF_REPORTED_DOC': return 'SELF_REPORTED';
  }
}

// ---------------------------------------------------------------------------------------------------
// Receipt types
// ---------------------------------------------------------------------------------------------------

/** Replay references — content-free digests that let a local reproduction re-execute the episode. */
export interface AgreReplayRefV1 {
  readonly episodeDigest: string;   // 64-hex sha256 of the canonical episode event log
  readonly actionLogDigest: string; // 64-hex sha256 of the raw action sequence
}

export interface AgreRunCountsV1 {
  readonly actionsSent: number;
  readonly expandedStates: number;
  readonly deaths: number;
}

/** Content-free ARC/AGRE run receipt: digests, closed labels, bounded counts, identifiers only. */
export interface AgreRunReceiptV1 {
  readonly schema: AgreRunReceiptSchema;
  readonly gameId: string;          // e.g. 'tu93', 'ls20'
  readonly level: number;
  readonly origin: AgreRunOriginV1;
  readonly method: AgreMethodV1;
  readonly blind: boolean;          // true = no access to game source or solutions during the run
  readonly levelBeaten: boolean;
  readonly counts: AgreRunCountsV1;
  readonly replay: AgreReplayRefV1 | null;
}

/** Run context the AGRE harness supplies alongside the receipt (same shapes as the R57 envelope). */
export interface AgreRunContextV1 {
  readonly model: SwarmModelRefV1;
  readonly harnessVersion: string;
  readonly baseCommit: string;
  readonly execution: SwarmExecutionV1;
}

// ---------------------------------------------------------------------------------------------------
// Error codes + result type
// ---------------------------------------------------------------------------------------------------

export const AGRE_ERROR_CODES = [
  'E_AGRE_SCHEMA', 'E_AGRE_NOT_OBJECT', 'E_AGRE_PROTO', 'E_AGRE_MISSING_FIELD', 'E_AGRE_UNKNOWN_FIELD',
  'E_AGRE_WRONG_TYPE', 'E_AGRE_LABEL', 'E_AGRE_ENUM', 'E_AGRE_INTEGER', 'E_AGRE_SHA',
  'E_AGRE_MISSING_REPLAY', 'E_AGRE_BLIND_MISLABEL', 'E_AGRE_OUTCOME_CONTRADICTION',
] as const;
export type AgreErrorCode = typeof AGRE_ERROR_CODES[number];

export interface AgreValidationOk { readonly ok: true; }
export interface AgreValidationErr {
  readonly ok: false;
  readonly code: AgreErrorCode;
  readonly path: string;
  readonly message: string;
}
export type AgreValidationResult = AgreValidationOk | AgreValidationErr;

const OK: AgreValidationResult = { ok: true };
function err(code: AgreErrorCode, path: string, message: string): AgreValidationResult {
  return { ok: false, code, path, message };
}

// ---------------------------------------------------------------------------------------------------
// Receipt validation (fail-closed positive allowlist, same red-team posture as the envelope)
// ---------------------------------------------------------------------------------------------------

const SHA256_RE = /^[0-9a-f]{64}$/;
const GAME_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_LEVEL = 9999;
const MAX_COUNT = 1_000_000_000;

const RECEIPT_KEYS = ['schema', 'gameId', 'level', 'origin', 'method', 'blind', 'levelBeaten', 'counts', 'replay'];
const COUNT_KEYS = ['actionsSent', 'expandedStates', 'deaths'];
const REPLAY_KEYS = ['episodeDigest', 'actionLogDigest'];

function ordinaryDataObject(v: unknown, p: string): AgreValidationResult {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return err('E_AGRE_NOT_OBJECT', p, 'expected object');
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return err('E_AGRE_PROTO', p, 'non-ordinary prototype');
  if (Object.getOwnPropertySymbols(v).length > 0) return err('E_AGRE_PROTO', p, 'symbol own property');
  const names = Object.getOwnPropertyNames(v);
  if (names.length !== Object.keys(v).length) return err('E_AGRE_PROTO', p, 'non-enumerable own property');
  for (const k of names) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || d.get !== undefined || d.set !== undefined) return err('E_AGRE_PROTO', `${p}.${k}`, 'accessor property');
  }
  return OK;
}

function exactKeys(v: Record<string, unknown>, keys: readonly string[], p: string): AgreValidationResult {
  for (const k of keys) if (!(k in v)) return err('E_AGRE_MISSING_FIELD', `${p}.${k}`, 'missing required field');
  for (const k of Object.keys(v)) if (!keys.includes(k)) return err('E_AGRE_UNKNOWN_FIELD', `${p}.${k}`, 'unknown field');
  return OK;
}

function checkCount(v: unknown, p: string): AgreValidationResult {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || Object.is(v, -0)) return err('E_AGRE_INTEGER', p, 'expected safe integer');
  if (v < 0 || v > MAX_COUNT) return err('E_AGRE_INTEGER', p, 'count out of range');
  return OK;
}

export function validateAgreRunReceipt(value: unknown): AgreValidationResult {
  let r = ordinaryDataObject(value, 'receipt');
  if (!r.ok) return r;
  const x = value as Record<string, unknown>;
  r = exactKeys(x, RECEIPT_KEYS, 'receipt');
  if (!r.ok) return r;

  if (x.schema !== AGRE_RUN_RECEIPT_SCHEMA) return err('E_AGRE_SCHEMA', 'receipt.schema', `unknown schema version (expected ${AGRE_RUN_RECEIPT_SCHEMA})`);
  if (typeof x.gameId !== 'string' || !GAME_ID_RE.test(x.gameId)) return err('E_AGRE_LABEL', 'receipt.gameId', 'expected short lowercase game id');
  if (typeof x.level !== 'number' || !Number.isSafeInteger(x.level) || Object.is(x.level, -0) || x.level < 0 || x.level > MAX_LEVEL) {
    return err('E_AGRE_INTEGER', 'receipt.level', 'expected safe integer level in range');
  }
  if (typeof x.origin !== 'string' || !(AGRE_RUN_ORIGINS as readonly string[]).includes(x.origin)) {
    return err('E_AGRE_ENUM', 'receipt.origin', 'unknown run origin');
  }
  if (typeof x.method !== 'string' || !(AGRE_METHODS as readonly string[]).includes(x.method)) {
    return err('E_AGRE_ENUM', 'receipt.method', 'unknown solving method');
  }
  if (typeof x.blind !== 'boolean') return err('E_AGRE_WRONG_TYPE', 'receipt.blind', 'expected boolean');
  if (typeof x.levelBeaten !== 'boolean') return err('E_AGRE_WRONG_TYPE', 'receipt.levelBeaten', 'expected boolean');

  r = ordinaryDataObject(x.counts, 'receipt.counts');
  if (!r.ok) return r;
  const counts = x.counts as Record<string, unknown>;
  r = exactKeys(counts, COUNT_KEYS, 'receipt.counts');
  if (!r.ok) return r;
  for (const k of COUNT_KEYS) {
    r = checkCount(counts[k], `receipt.counts.${k}`);
    if (!r.ok) return r;
  }

  if (x.replay !== null) {
    r = ordinaryDataObject(x.replay, 'receipt.replay');
    if (!r.ok) return r;
    const replay = x.replay as Record<string, unknown>;
    r = exactKeys(replay, REPLAY_KEYS, 'receipt.replay');
    if (!r.ok) return r;
    for (const k of REPLAY_KEYS) {
      if (typeof replay[k] !== 'string' || !SHA256_RE.test(replay[k] as string)) {
        return err('E_AGRE_SHA', `receipt.replay.${k}`, 'expected strict 64-lowercase-hex sha256');
      }
    }
  }

  // Law: blind means blind — a source-reading run cannot claim blindness.
  if (x.method === 'source-analysis' && x.blind === true) {
    return err('E_AGRE_BLIND_MISLABEL', 'receipt.blind', 'source-analysis run cannot claim blind:true');
  }
  // Law: replay or no claim — a beaten level requires a replayable trail and at least one action.
  if (x.levelBeaten === true) {
    if (x.replay === null) return err('E_AGRE_MISSING_REPLAY', 'receipt.replay', 'levelBeaten:true requires replay references');
    if ((counts.actionsSent as number) < 1) return err('E_AGRE_OUTCOME_CONTRADICTION', 'receipt.counts.actionsSent', 'levelBeaten:true with zero actions sent');
  }
  return OK;
}

// ---------------------------------------------------------------------------------------------------
// Receipt digest + adapter
// ---------------------------------------------------------------------------------------------------

const encoder = new TextEncoder();

/** Domain-separated, length-framed digest of the exact canonical receipt. */
export function agreReceiptDigest(receipt: unknown): string {
  const canonical = canonicalBytes(receipt);
  const h = createHash('sha256');
  h.update(encoder.encode(AGRE_RECEIPT_DIGEST_DOMAIN));
  h.update(new Uint8Array([0x00]));
  h.update(uint64BE(canonical.length));
  h.update(canonical);
  return h.digest('hex');
}

/** Deterministic envelope taskId for a receipt, e.g. `agre.tu93.l4`. */
export function agreTaskId(receipt: Pick<AgreRunReceiptV1, 'gameId' | 'level'>): string {
  return `agre.${receipt.gameId}.l${receipt.level}`;
}

/**
 * The one producer path: validate the receipt, apply the receipt↔execution cross laws, and seal a
 * content-free `SwarmRunEvidenceV1` envelope. Governance is ALWAYS `ungoverned` (axis separation is
 * structural — sealing goes through the R57 path, which re-runs every envelope law including secret
 * screens and outcome contradictions). Throws `<code>:<path>` on any refusal.
 */
export function buildAgreSwarmEvidence(receipt: AgreRunReceiptV1, context: AgreRunContextV1): SwarmRunEvidenceEnvelopeV1 {
  const snap = JSON.parse(canonicalString(receipt)) as AgreRunReceiptV1;
  const v = validateAgreRunReceipt(snap);
  if (!v.ok) throw new Error(`${v.code}:${v.path}`);

  // Receipt↔execution contradiction laws (the envelope re-checks its own axis laws at seal).
  const outcome = context.execution.outcome;
  if (snap.levelBeaten && outcome !== 'completed') {
    throw new Error('E_AGRE_OUTCOME_CONTRADICTION:receipt.levelBeaten');
  }
  if (outcome === 'transport-failed' && snap.replay !== null) {
    throw new Error('E_AGRE_OUTCOME_CONTRADICTION:receipt.replay');
  }

  const body: SwarmRunEvidenceV1 = {
    schema: SWARM_RUN_EVIDENCE_SCHEMA,
    advisoryOnly: true,
    grantsAuthority: false,
    taskId: agreTaskId(snap),
    epistemicSource: epistemicSourceForOrigin(snap.origin),
    model: { id: context.model.id, revision: context.model.revision },
    harnessVersion: context.harnessVersion,
    baseCommit: context.baseCommit,
    inputDigest: agreReceiptDigest(snap),
    outputDigest: snap.replay === null ? null : snap.replay.episodeDigest,
    execution: {
      outcome: context.execution.outcome,
      startedAtMs: context.execution.startedAtMs,
      completedAtMs: context.execution.completedAtMs,
      runner: context.execution.runner,
      sandboxed: context.execution.sandboxed,
      networkEgress: context.execution.networkEgress,
    },
    governance: { outcome: 'ungoverned', classifierVersion: null, decidedAtMs: null },
  };
  return sealSwarmRunEvidence(body);
}

/**
 * TOTAL pairing predicate: true only if `env` is the UNGOVERNED run-evidence produced from this exact
 * receipt. It re-derives every field that is a function of the receipt — taskId, epistemic label
 * (from the closed origin), inputDigest, and outputDigest/replay — and requires the envelope to verify.
 *
 * R59 M2 correction (the prior docstring was FALSIFIED): the receipt describes a RUN; it says nothing
 * about a governance DECISION, which is not derivable from it. So this predicate deliberately pairs only
 * the ungoverned run stage — it asserts `governance.outcome === 'ungoverned'` and returns false for ANY
 * governed envelope (accepted / rejected / quarantined), closing the earlier gap where a re-sealed
 * axis edit (ungoverned→governed) still paired. Forged acceptance is barred at two other layers: the
 * narrowed public seal cannot mint a governed envelope (only `governSwarmRunEvidence` can), and
 * `validateSwarmRunBody` permits `accepted` only for LOCAL_* sources. A legitimately governed envelope
 * is still bound to its run by `inputDigest`; callers needing that binding compare digests directly.
 */
export function agreEnvelopeMatchesReceipt(env: SwarmRunEvidenceEnvelopeV1, receipt: AgreRunReceiptV1): boolean {
  try {
    // R60 H1 snapshot-first: verify AND read from the SAME inert envelope snapshot, so a getter chameleon
    // cannot pass integrity on one copy and present different taskId/label/digests to the pairing reads.
    const envSnap = JSON.parse(canonicalString(env)) as SwarmRunEvidenceEnvelopeV1;
    if (!verifySwarmRunEnvelope(envSnap)) return false;
    const snap = JSON.parse(canonicalString(receipt)) as AgreRunReceiptV1;
    if (!validateAgreRunReceipt(snap).ok) return false;
    const b = envSnap.body;
    if (b.governance.outcome !== 'ungoverned') return false; // pairs the raw run stage only, never a decision
    if (b.taskId !== agreTaskId(snap)) return false;
    if (b.epistemicSource !== epistemicSourceForOrigin(snap.origin)) return false;
    if (b.inputDigest !== agreReceiptDigest(snap)) return false;
    const expectedOutput = snap.replay === null ? null : snap.replay.episodeDigest;
    if (b.outputDigest !== expectedOutput) return false;
    return true;
  } catch {
    return false;
  }
}
