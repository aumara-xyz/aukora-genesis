// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The governed Aukora chat/mind door (R38) — loopback 7097.
 *
 * It composes the durable machine, the KIRA memory store, the Fu live runner, the durable ceremony, and the local
 * candidate stage behind ONE governed HTTP surface, porting the donor door's LAW (not its secret/custody material):
 *   - SERIALIZED driver chain: every request runs through a single promise chain, so concurrent requests can never
 *     clobber shared session state mid-await (the donor's single-driver REPL invariant);
 *   - LAZY, HONEST boot: heavy work is loaded through an injected `driver` loader; a compile/import failure fails
 *     THIS request with an honest 500 and keeps the door up (never kills the server at boot);
 *   - strict ORIGIN allowlist + a per-boot local POST TOKEN ([[doorGuards]]) — blind cross-origin POSTs refuse visibly;
 *   - LOCKDOWN short-circuit: once engaged, every write-shaped route becomes advisory-only, decided with no model;
 *   - model-free MEMORY FALLBACK: chat answers from KIRA recall when no advisory voice/Fu is configured or it fails;
 *   - bounded RECEIPTS for refusals and door events.
 *
 * Governance invariants (enforced, tested): no request signs, merges, pushes, mutates main, treats Fu as authority,
 * or auto-resumes an effect. Proposal and materialization are EXPLICIT owner invocations; materialization requires a
 * FRESH in-process AUMLOK verification (never trusts persisted/UI state). A restart emits the PLAN only. The Fu
 * advisory sidecar binds to a proposal by its proposalHash. AURA stays display-only (not surfaced as an apply input).
 *
 * This module is transport-agnostic: `handle(request)` takes a normalized `DoorRequest` and returns a `DoorResponse`,
 * so it is unit-tested with no socket. `scripts/mind-door-7097.ts` adapts Node http to it (not part of CI).
 */
import type { ReactiveMemoryStore } from '@aukora/brain';
import type { AumlokAuthorityRootV2, SignedPromotionV2 } from '@aukora/kernel/schemas';
import type { CouncilOutcome } from '@aukora/council';
import { buildMemoryRecord } from '@aukora/memory';
import { checkDoorGuard, headerReader, loopbackOrigins, newDoorToken, doorTokenIsWellFormed, type DoorGuardReason } from './doorGuards.js';
import { validateProposalShape, deriveIntentId } from './proposal.js';
import { runLocalRecursionCeremony, ceremonyWorkflowId, type LocalCeremonyEnv, type CeremonyRunResult } from './localCeremonyRunner.js';
import { verdictFromCouncilOutcome } from './fuStructuredAdapter.js';

export const DOOR_PORT = 7097;
const MAX_RECEIPTS = 512;
const MAX_BODY_FIELD = 8192;
// R56 chat side-channel bounds (the donor envelope law: bounded counts, bounded bytes, disclosed handling).
const VOICE_MAX_ATTACHMENTS = 8;
const VOICE_MAX_IMAGES = 4;
const VOICE_MAX_ATTACHMENT_CHARS = 65536;

export interface DoorRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string | undefined>;
  readonly body?: unknown;
}

export interface DoorResponse {
  readonly status: number;
  readonly json: Record<string, unknown>;
}

export interface DoorEvent {
  readonly seq: number;
  readonly kind: string;
  readonly path: string;
  readonly reasonClass: string;
  readonly receiptHash: string | null;
}

/**
 * R50 durability hooks — present when the workflow store persists OUTSIDE this process (the local Convex
 * adapter's hydrate/settle contract). The door pulls the durable row into the cache BEFORE the ceremony and
 * pushes accepted saves through the authoritative OCC mutation AFTER it. Absent for a purely in-process store.
 *
 * `unavailable` is OPTIONAL by design: the durable-store contract now reports a settle-time backend OUTAGE as a
 * data field (`ConvexWorkflowStore.SettleResult.unavailable`) instead of a thrown error, so an outage stays
 * distinct from a genuine concurrent-writer `divergence`. Older stores that still throw on an outage remain
 * compatible (the door's try/catch maps a throw to the same `door:store-unavailable` class), and the field is
 * simply absent for them — so this one interface serves both the throwing and the reporting settle contracts.
 */
export interface DoorDurability {
  hydrate(workflowId: string): Promise<unknown>;
  settle(): Promise<{ readonly ok: boolean; readonly pushed: number; readonly divergence: readonly string[]; readonly unavailable?: readonly string[] }>;
}

/** Injected lazy driver: the heavy composition modules. A throwing loader models a compile/import break. */
export interface DoorDriver {
  readonly ceremonyEnv: LocalCeremonyEnv;
  readonly durability?: DoorDurability;
}
export type DoorDriverLoader = () => Promise<DoorDriver>;

export interface MindDoorConfig {
  readonly store: ReactiveMemoryStore;
  readonly ownerRoot: AumlokAuthorityRootV2;
  /** Loads the composed ceremony env lazily; may throw — a break fails the request, not the door. */
  readonly loadDriver: DoorDriverLoader;
  readonly port?: number;
  /** Per-boot local POST token; default a fresh CSPRNG token. */
  readonly postToken?: string;
  /** Extra allowed origins (the shell's origin), in addition to the door's own loopback origins. */
  readonly extraOrigins?: readonly string[];
  readonly nowIso?: string;
}

interface ProposeBody {
  readonly proposalInput?: unknown;
  readonly nonce?: string;
  readonly auth?: SignedPromotionV2;
  /** Advisory Fu sidecar, bound to the proposal by proposalHash. */
  readonly fuSidecar?: { readonly proposalHash?: string; readonly outcome?: CouncilOutcome };
  readonly materialize?: boolean;
  /** Owner's authorization over the candidate PAYLOAD hash (required to materialize; verified by the kernel monitor). */
  readonly candidateAuth?: SignedPromotionV2;
  /** Owner explicitly ARMED materialization (kernel humanClearance). */
  readonly ownerArmed?: boolean;
  /** R50: the exact repo HEAD (40-hex) this materialization was approved against — REQUIRED to materialize. */
  readonly headBefore?: string;
  readonly explanation?: string;
}

export class MindDoor {
  private readonly port: number;
  private readonly postGuard: string;
  private readonly allowedOrigins: string[];
  private readonly receipts: DoorEvent[] = [];
  private driver: DoorDriver | null = null;
  private lockedDown = false;
  private queue: Promise<void> = Promise.resolve();
  private seq = 0;

  constructor(private readonly config: MindDoorConfig) {
    this.port = config.port ?? DOOR_PORT;
    // R60 P1: an empty/whitespace/malformed provisioned postToken must NOT become the guard's requiredToken
    // (that was the fail-open — an empty token disabled the check). Treat malformed as ABSENT and self-mint a
    // strong per-boot token, so a mis-set AUKORA_DOOR_TOKEN="" yields a door that still REQUIRES a real token.
    this.postGuard = doorTokenIsWellFormed(config.postToken) ? config.postToken : newDoorToken();
    this.allowedOrigins = [...loopbackOrigins(this.port), ...(config.extraOrigins ?? [])];
  }

  /** The per-boot token a local tool must present (never printed to a browser; surfaced only to the operator). */
  get localPostToken(): string {
    return this.postGuard;
  }

  events(): readonly DoorEvent[] {
    return this.receipts.slice();
  }

  isLockedDown(): boolean {
    return this.lockedDown;
  }

  private receipt(kind: string, path: string, reasonClass: string): DoorEvent {
    this.seq += 1;
    const nowIso = this.config.nowIso ?? new Date(0).toISOString();
    const ing = this.config.store.ingest(buildMemoryRecord({
      content: `door-event · seq=${this.seq} · kind=${kind} · path=${path} · reason=${reasonClass}`,
      createdAt: nowIso, kind: 'receipt', consent: 'owner-only', provenance: 'mind-door',
    }));
    const ev: DoorEvent = { seq: this.seq, kind, path, reasonClass, receiptHash: ing.ok ? ing.chainHash : null };
    this.receipts.push(ev);
    if (this.receipts.length > MAX_RECEIPTS) this.receipts.shift();
    return ev;
  }

  /** Handle one request. Serialized: it runs after all prior requests complete (single-driver invariant). */
  handle(request: DoorRequest): Promise<DoorResponse> {
    const run = this.queue.then(() => this.process(request));
    // keep the chain alive regardless of this request's fate; never reject the chain.
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async process(request: DoorRequest): Promise<DoorResponse> {
    const h = headerReader(request.headers);
    const path = request.path;

    // Read-only status is always available (even under lockdown) — GET, no token needed.
    if (request.method === 'GET' && path === '/api/door') {
      return this.respond(200, { schema: 'aukora-door-status-v1', enabled: true, lockedDown: this.lockedDown, booted: this.driver !== null, events: this.receipts.length, grantsAuthority: false });
    }

    if (request.method !== 'POST') return this.respond(405, { error: 'method not allowed' });

    // Origin allowlist + local POST token — blind cross-origin POSTs refuse visibly.
    const guard = checkDoorGuard(h, { allowedOrigins: this.allowedOrigins, requiredToken: this.postGuard, allowNoBrowserOrigin: true });
    if (!guard.ok) {
      const ev = this.receipt('refused', path, guard.reason);
      return this.respond(guard.status, { error: guard.text, reasonClass: guard.reason, eventReceipt: ev.receiptHash });
    }

    // LOCKDOWN short-circuit — engage is allowed; every other write becomes advisory-only, decided with no model.
    if (path === '/api/lockdown') {
      this.lockedDown = true;
      const ev = this.receipt('lockdown', path, 'door:lockdown-engaged');
      return this.respond(200, { lockedDown: true, text: 'Lockdown engaged. Proposals and materialization are paused — advisory-only until you lift it in your terminal.', eventReceipt: ev.receiptHash, grantsAuthority: false });
    }
    if (this.lockedDown && (path === '/api/propose' || path === '/api/materialize')) {
      const ev = this.receipt('refused', path, 'door:locked-down');
      return this.respond(423, { error: 'locked down — advisory-only; proposals/materialization are paused', reasonClass: 'door:locked-down', eventReceipt: ev.receiptHash });
    }

    // LAZY, HONEST boot — a compile/import break fails THIS request, not the door.
    let driver: DoorDriver;
    try {
      driver = await this.ensureDriver();
    } catch (e) {
      const ev = this.receipt('boot-error', path, 'door:driver-load-failed');
      return this.respond(500, { error: `driver load failed (server stays up): ${e instanceof Error ? e.message.slice(0, 160) : 'unknown'}`, reasonClass: 'door:driver-load-failed', eventReceipt: ev.receiptHash });
    }

    if (path === '/api/chat') return this.chat(request.body, driver);
    if (path === '/api/propose') return this.proposeOrMaterialize(request.body as ProposeBody, driver, false);
    if (path === '/api/materialize') return this.proposeOrMaterialize(request.body as ProposeBody, driver, true);
    return this.respond(404, { error: 'unknown door route' });
  }

  private async ensureDriver(): Promise<DoorDriver> {
    if (this.driver === null) this.driver = await this.config.loadDriver();
    return this.driver;
  }

  /**
   * ADVISORY voice: never applies. Uses Fu evidence if supplied, else the model-free KIRA memory fallback.
   *
   * R56 CHAT ENVELOPE — the Spatial UI/voice client posts `{ owner_text, attachments, images, model }`
   * (`owner_text` is the CANONICAL text channel; `text` remains deliberate legacy compatibility). The old
   * handler read only `text`, so every real UI/voice turn silently fell into the empty-query fallback and the
   * attachment/image channels were dead-lettered. Laws now:
   *   - `owner_text` preferred; `text` accepted; BOTH present with different content → explicit refusal
   *     (`door:chat-channel-ambiguous`), never a silent pick;
   *   - truncation to MAX_BODY_FIELD is DISCLOSED (`truncated: true`), never silent;
   *   - attachments/images are bounded, shape-checked channels: malformed → `door:chat-attachments-malformed`,
   *     over the caps → `door:chat-attachments-oversized`; valid ones are ACKNOWLEDGED with an explicit
   *     disposition — this model-free advisory door does not consume them, and SAYS so (no dead-letter);
   *   - an AUTHORITY-SHAPED chat body (auth/candidateAuth/ownerArmed/nonce riding on the advisory channel) is
   *     refused (`door:chat-authority-shaped`) — chat can never carry or launder authorization;
   *   - `model` is disclosed as ignored (`modelDisposition`) — this door is model-free by construction.
   */
  private chat(body: unknown, _driver: DoorDriver): DoorResponse {
    const b = (body ?? {}) as Record<string, unknown>;
    // Authority-shaped fields on the advisory channel are hostile, not ignorable.
    for (const k of ['auth', 'candidateAuth', 'ownerArmed', 'nonce', 'headBefore', 'proposalInput'] as const) {
      if (k in b) {
        const ev = this.receipt('refused', '/api/chat', 'door:chat-authority-shaped');
        return this.respond(400, { error: 'refused: chat is advisory and can never carry authorization-shaped fields', reasonClass: 'door:chat-authority-shaped', eventReceipt: ev.receiptHash });
      }
    }
    const ownerText = typeof b.owner_text === 'string' ? b.owner_text : null;
    const legacyText = typeof b.text === 'string' ? b.text : null;
    if (ownerText !== null && legacyText !== null && ownerText !== legacyText) {
      const ev = this.receipt('refused', '/api/chat', 'door:chat-channel-ambiguous');
      return this.respond(400, { error: 'refused: both owner_text and text present with different content — send ONE text channel', reasonClass: 'door:chat-channel-ambiguous', eventReceipt: ev.receiptHash });
    }
    const raw = ownerText ?? legacyText ?? '';
    const textChannel = ownerText !== null ? 'owner_text' : legacyText !== null ? 'text' : 'none';
    const truncated = raw.length > MAX_BODY_FIELD;
    const query = raw.slice(0, MAX_BODY_FIELD).trim();

    // Bounded, shape-checked side channels (never silently dropped): arrays of bounded string-ish entries.
    const sideChannel = (name: 'attachments' | 'images', cap: number): { ok: true; count: number } | { ok: false; reason: 'door:chat-attachments-malformed' | 'door:chat-attachments-oversized' } => {
      const v = b[name];
      if (v === undefined || v === null) return { ok: true, count: 0 };
      if (!Array.isArray(v)) return { ok: false, reason: 'door:chat-attachments-malformed' };
      if (v.length > cap) return { ok: false, reason: 'door:chat-attachments-oversized' };
      for (const entry of v) {
        const s = typeof entry === 'string' ? entry : typeof (entry as { content?: unknown })?.content === 'string' ? (entry as { content: string }).content : typeof (entry as { name?: unknown })?.name === 'string' ? '' : null;
        if (s === null) return { ok: false, reason: 'door:chat-attachments-malformed' };
        if (s.length > VOICE_MAX_ATTACHMENT_CHARS) return { ok: false, reason: 'door:chat-attachments-oversized' };
      }
      return { ok: true, count: v.length };
    };
    const attachments = sideChannel('attachments', VOICE_MAX_ATTACHMENTS);
    if (!attachments.ok) {
      const ev = this.receipt('refused', '/api/chat', attachments.reason);
      return this.respond(400, { error: 'refused: chat side channel is malformed or over its bound', reasonClass: attachments.reason, eventReceipt: ev.receiptHash });
    }
    const images = sideChannel('images', VOICE_MAX_IMAGES);
    if (!images.ok) {
      const ev = this.receipt('refused', '/api/chat', images.reason);
      return this.respond(400, { error: 'refused: chat side channel is malformed or over its bound', reasonClass: images.reason, eventReceipt: ev.receiptHash });
    }

    const hits = query.length > 0 ? this.config.store.recall({ text: query }).slice(0, 5) : [];
    const ev = this.receipt('chat', '/api/chat', 'door:advisory');
    // MODEL-FREE FALLBACK: recall-backed answer; the voice has no tools and no authority.
    const answer = hits.length > 0
      ? `From memory (advisory, no model): ${hits.map((hHit) => hHit.content).join(' · ').slice(0, 1200)}`
      : 'I have no memory matching that yet. (Advisory voice; I cannot read files or apply anything.)';
    return this.respond(200, {
      schema: 'aukora-door-chat-v1', mode: 'model-free-memory-fallback', answer,
      citations: hits.map((hHit) => hHit.recordId),
      textChannel, truncated,
      attachmentsReceived: attachments.count, imagesReceived: images.count,
      attachmentDisposition: attachments.count + images.count > 0
        ? 'acknowledged-not-consumed (model-free advisory door; attachments/images do not reach recall)'
        : null,
      modelDisposition: typeof b.model === 'string' ? 'ignored (model-free advisory door)' : null,
      advisoryOnly: true, grantsAuthority: false, eventReceipt: ev.receiptHash,
    });
  }

  /**
   * PROPOSE (materialize=false) or MATERIALIZE (materialize=true): an EXPLICIT owner invocation. The composed
   * ceremony re-verifies AUMLOK in process; a restart re-reads durable state and emits the PLAN only (never
   * auto-resumes an effect). The Fu sidecar must bind to THIS proposal by proposalHash.
   */
  private async proposeOrMaterialize(body: ProposeBody | undefined, driver: DoorDriver, materialize: boolean): Promise<DoorResponse> {
    const route = materialize ? '/api/materialize' : '/api/propose';
    if (body === undefined || body === null) return this.respond(400, { error: 'missing body' });

    const shape = validateProposalShape(body.proposalInput);
    if (!shape.ok) {
      const ev = this.receipt('refused', route, 'door:proposal-shape');
      return this.respond(400, { error: shape.reason, reasonClass: 'door:proposal-shape', eventReceipt: ev.receiptHash });
    }
    const intentId = deriveIntentId(shape.proposal);

    // Fu sidecar binds by proposalHash — a sidecar for a different proposal is refused.
    let fuOutcome: CouncilOutcome | undefined;
    if (body.fuSidecar) {
      if (body.fuSidecar.proposalHash !== intentId) {
        const ev = this.receipt('refused', route, 'door:fu-sidecar-mismatch');
        return this.respond(400, { error: 'Fu advisory sidecar does not bind to this proposal (proposalHash mismatch)', reasonClass: 'door:fu-sidecar-mismatch', eventReceipt: ev.receiptHash });
      }
      fuOutcome = body.fuSidecar.outcome;
      // Fu is advisory, never authority: we consume the outcome only as evidence; the owner gate still decides.
      // R50 F1: a MALFORMED matched-hash outcome must be a stable receipted refusal, never a throw out of handle().
      if (fuOutcome !== undefined) {
        let fuClaimsAuthority: boolean;
        try {
          fuClaimsAuthority = verdictFromCouncilOutcome(fuOutcome).grantsAuthority !== false;
        } catch {
          const ev = this.receipt('refused', route, 'door:fu-sidecar-malformed');
          return this.respond(400, { error: 'refused: Fu advisory sidecar outcome is malformed (advisory evidence must be a well-formed council outcome)', reasonClass: 'door:fu-sidecar-malformed', eventReceipt: ev.receiptHash });
        }
        if (fuClaimsAuthority) {
          const ev = this.receipt('refused', route, 'door:fu-authority-claim');
          return this.respond(400, { error: 'Fu can never be authority', reasonClass: 'door:fu-authority-claim', eventReceipt: ev.receiptHash });
        }
      }
    }

    // #87 exact-field fix: a missing/empty nonce used to be coerced to '' here, fail the workflow-state validator
    // downstream, and surface as a misleading `workflow:store-conflict`. Refuse it AT THE DOOR with its own name.
    const nonce = typeof body.nonce === 'string' ? body.nonce : '';
    if (nonce.length === 0) {
      const ev = this.receipt('refused', route, 'door:nonce-missing');
      return this.respond(400, { error: 'refused: body.nonce (1..128 chars) is required for replay protection', reasonClass: 'door:nonce-missing', eventReceipt: ev.receiptHash });
    }
    if (nonce.length > 128) {
      const ev = this.receipt('refused', route, 'door:nonce-too-long');
      return this.respond(400, { error: 'refused: body.nonce exceeds 128 chars', reasonClass: 'door:nonce-too-long', eventReceipt: ev.receiptHash });
    }

    // R50 head binding: materialization must name the exact HEAD it was approved against; the candidate stage
    // re-verifies it in-process (candidate:stale-head) so a moved head can never receive a pre-approved effect.
    const headBefore = typeof body.headBefore === 'string' ? body.headBefore : '';
    if (materialize && !/^[0-9a-f]{40}$/.test(headBefore)) {
      const ev = this.receipt('refused', route, 'door:head-missing');
      return this.respond(400, { error: 'refused: body.headBefore (40-hex repo HEAD the approval binds to) is required to materialize', reasonClass: 'door:head-missing', eventReceipt: ev.receiptHash });
    }

    // R50 durability: pull the durable projection into the cache BEFORE the ceremony (distinct, content-free
    // failure classes: a bad durable row vs an unreachable store are different facts).
    const workflowId = ceremonyWorkflowId(shape.proposal, nonce);
    if (driver.durability) {
      try {
        await driver.durability.hydrate(workflowId);
      } catch (e) {
        const failedValidation = e instanceof Error && e.message.includes('failed validation');
        const cls = failedValidation ? 'door:hydration-failed' : 'door:store-unavailable';
        const ev = this.receipt('refused', route, cls);
        return this.respond(failedValidation ? 409 : 503, { error: failedValidation ? 'refused: durable workflow row failed exact-shape validation (fail-closed; no effects run)' : 'refused: durable store unreachable (fail-closed; retry when the backend is up)', reasonClass: cls, eventReceipt: ev.receiptHash });
      }
    }

    // R50 F1 belt: NOTHING escapes handle() as a throw — an uncaught ceremony error fails THIS request,
    // receipted, and the door stays up (the same law as the lazy-boot driver failure).
    let result: CeremonyRunResult;
    try {
      result = runLocalRecursionCeremony(driver.ceremonyEnv, {
        proposalInput: body.proposalInput,
        nonce,
        auth: body.auth as SignedPromotionV2,
        fuOutcome,
        materialize, // materialization only on the explicit /api/materialize route
        candidateAuth: body.candidateAuth,
        ownerArmed: body.ownerArmed === true,
        expectedHeadBefore: materialize ? headBefore : undefined,
        explanation: typeof body.explanation === 'string' ? body.explanation.slice(0, MAX_BODY_FIELD) : undefined,
      });
    } catch (e) {
      const ev = this.receipt('refused', route, 'door:ceremony-uncaught');
      return this.respond(500, { error: `refused: ceremony error (door stays up): ${e instanceof Error ? e.message.slice(0, 160) : 'unknown'}`, reasonClass: 'door:ceremony-uncaught', eventReceipt: ev.receiptHash });
    }

    // R50 durability: push accepted saves through the authoritative OCC mutation AFTER the ceremony. A lost
    // race (divergence) or an unreachable durability point FAILS CLOSED — the durable truth wins, and the
    // machine's restart reconciliation handles any unsettled projection honestly.
    if (driver.durability) {
      let settled: { readonly ok: boolean; readonly pushed: number; readonly divergence: readonly string[]; readonly unavailable?: readonly string[] };
      try {
        settled = await driver.durability.settle();
      } catch {
        // A store that still THROWS on an outage (older settle contract) — same fact, same class.
        const ev = this.receipt('refused', route, 'door:store-unavailable');
        return this.respond(503, { error: 'refused: durable store unreachable at the durability point (fail-closed; the projection is unsettled and reconciles on restart)', reasonClass: 'door:store-unavailable', eventReceipt: ev.receiptHash });
      }
      // A backend OUTAGE reported as data (current settle contract) must NOT masquerade as a concurrent-writer
      // conflict: an unavailable item is unsettled-and-retryable, not a lost OCC race. Check it BEFORE divergence
      // so the same fact carries the same 503 class whether the store throws or reports it — the exact
      // refusal-class separation #87 established, held at this seam.
      const unavailable = settled.unavailable ?? [];
      if (unavailable.length > 0) {
        const ev = this.receipt('refused', route, 'door:store-unavailable');
        return this.respond(503, { error: 'refused: durable store unreachable at the durability point (fail-closed; the projection is unsettled and reconciles on restart)', reasonClass: 'door:store-unavailable', unavailableWorkflowPrefixes: unavailable.map((u) => u.slice(0, 12)), eventReceipt: ev.receiptHash });
      }
      if (!settled.ok) {
        const ev = this.receipt('refused', route, 'door:settle-divergence');
        return this.respond(409, { error: 'refused: a concurrent writer won the durable OCC race — deferred to the durable truth (re-read and retry)', reasonClass: 'door:settle-divergence', divergentWorkflowPrefixes: settled.divergence.map((d) => d.slice(0, 12)), eventReceipt: ev.receiptHash });
      }
    }

    const ev = this.receipt(result.ok ? (materialize ? 'materialized' : 'proposed') : 'refused', route, result.reasonClass);
    return this.respond(result.ok ? 200 : 409, {
      schema: 'aukora-door-plan-v1',
      ok: result.ok,
      phase: result.phase,
      reasonClass: result.reasonClass,
      text: result.text,
      proposalHash: intentId,
      // PLAN fields — never a signature, key, or content dump.
      workflowId: result.workflowId,
      rehearsalReceiptPrefix: result.rehearsalReceiptHash ? result.rehearsalReceiptHash.slice(0, 12) : null,
      candidateBranch: result.materialization?.branch ?? null,
      candidateCommitPrefix: result.materialization?.commitSha ? result.materialization.commitSha.slice(0, 12) : null,
      signed: false, pushed: false, touchedMain: false, grantsAuthority: false,
      eventReceipt: ev.receiptHash,
    });
  }

  private respond(status: number, json: Record<string, unknown>): DoorResponse {
    return { status, json };
  }
}

/** HARD: the door composes governed surfaces; no request through it mints authority. Constant, by construction. */
export function mindDoorGrantsAuthority(): false {
  return false;
}
