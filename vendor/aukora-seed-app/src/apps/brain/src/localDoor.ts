// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The brain's LOCAL DOOR (R37) — the narrow loopback projection/control HTTP door the new shell consumes.
 *
 * Laws:
 *   - LOOPBACK ONLY: binds 127.0.0.1 (port from AUKORA_PORTS.brainDoor, default 7141) — never reachable
 *     off-machine.
 *   - LIVE ONLY: every response is served from the injected LIVE senses (the running local Convex backend) and
 *     carries `x-aukora-source: live`. NO generated projection file is ever served as live — a fixture consumer
 *     must use the visibly-labelled fixture contract instead (spatialContracts.ts); this door has no fixture
 *     path at all.
 *   - PROJECTION + narrow CONTROL: reads (health, snapshot, workflow state, receipt stream, provider truth) plus
 *     exactly two control reflexes (cancel rehearsal / cancel impulse). No ingest, no forget, no save — writes
 *     of substance stay with the machine and the AUMLOK-gated paths. The door grants no authority.
 *   - CONTROL CAPABILITY (R59): the two state-changing control reflexes REQUIRE the per-boot mind-door token
 *     (scripts/doorCustody.mjs: minted by the supervisor, held only in the child env + a 0600 file, never
 *     logged). Loopback binding alone did not authenticate the caller — any local process could POST a cancel.
 *     The token is presented per request (Authorization: Bearer or x-aukora-door-token), compared in constant
 *     time, and fail-closed: an unprovisioned control plane refuses (503) and a missing/forged token is
 *     rejected (401) with no token value ever echoed. Reads stay open loopback projections (read-only, no
 *     authority). The replay boundary is per-boot rotation + 0600 custody, not per-request nonces.
 *   - Kernel/AUMLOK stays outside: the door only relays projections and receipt REFERENCES.
 *
 * Senses/controls are injected (`DoorBackend`), so unit tests drive fakes and the live composition injects the
 * ConvexHttpClient-backed IO (composeLive.ts).
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { CANONICAL_SEATS } from '@aukora/council';
import { providerTruthTable } from './brainProvider.js';
import { AUKORA_PORTS } from './ports.js';

// The per-boot mind-door token env — MIRRORS scripts/doorCustody.mjs DOOR_TOKEN_ENV (a test asserts they stay
// equal). The value is minted by the supervisor and never appears in this module.
export const DOOR_CAPABILITY_ENV = 'AUKORA_DOOR_TOKEN';
/** Canonical control-capability header (Authorization: Bearer is also accepted). */
export const DOOR_CAPABILITY_HEADER = 'x-aukora-door-token';

/**
 * Constant-time control-token equality. TOTAL: false on an unprovisioned expected token, a non-string or
 * length-mismatched presented token, or any error — never throws, never leaks which check failed via timing.
 */
export function verifyDoorControlToken(presented: unknown, expected: string | null | undefined): boolean {
  if (typeof expected !== 'string' || expected.length === 0) return false; // control plane not provisioned
  if (typeof presented !== 'string' || presented.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(presented, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

/** The control token presented on a request: x-aukora-door-token, else Authorization: Bearer. Null if absent. */
function presentedControlToken(req: IncomingMessage): string | null {
  const direct = req.headers[DOOR_CAPABILITY_HEADER];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m) return m[1];
  }
  return null;
}

export type WorkflowPhaseFilter = 'awaiting-owner' | 'applied' | 'refused' | 'cancelled';

export interface DoorBackend {
  health(): Promise<unknown>;
  snapshot(): Promise<unknown>;
  workflow(workflowId: string): Promise<unknown>;
  /** Current workflow projections, most recent first, optionally filtered by phase. */
  listWorkflows(phase?: WorkflowPhaseFilter): Promise<unknown>;
  /** Live memory recall projection (read-only). */
  recall(text: string): Promise<unknown>;
  receiptStream(rehearsalKey?: string): Promise<unknown>;
  cancelRehearsal(key: string): Promise<unknown>;
  cancelImpulse(impulseId: string): Promise<unknown>;
  /**
   * REACTIVE seam (optional): subscribe to snapshot changes; the callback fires on every change until the
   * returned unsubscribe runs. Injected by the live wiring (a Convex WebSocket client) or a test fake — the
   * door itself stays vendor-free. Absent ⇒ /events responds 501.
   */
  subscribeSnapshot?(onChange: (snapshot: unknown) => void): () => void;
}

// ORIGIN-CLOSED by construction: no Access-Control-Allow-* header is ever emitted, so a browser page on any
// origin cannot read this door. Consumers (Spatial shell, chat door) call it from their own LOCAL server-side
// processes over loopback — never from browser JS.
const JSON_HEADERS = { 'content-type': 'application/json', 'x-aukora-source': 'live', 'x-aukora-grants-authority': 'false' } as const;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleDoorRequest(backend: DoorBackend, req: IncomingMessage, res: ServerResponse, controlToken: string | null = null): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  try {
    if (req.method === 'GET') {
      if (path === '/health') return send(res, 200, { door: 'ok', backend: await backend.health() });
      if (path === '/snapshot') return send(res, 200, await backend.snapshot());
      if (path === '/truth') return send(res, 200, providerTruthTable());
      if (path.startsWith('/workflow/')) {
        const id = path.slice('/workflow/'.length);
        const state = await backend.workflow(id);
        return state === null ? send(res, 404, { error: 'unknown workflow' }) : send(res, 200, state);
      }
      if (path === '/receipts') return send(res, 200, await backend.receiptStream(url.searchParams.get('rehearsalKey') ?? undefined));
      if (path === '/workflows') {
        const phase = url.searchParams.get('phase');
        const valid = phase === null || ['awaiting-owner', 'applied', 'refused', 'cancelled'].includes(phase);
        if (!valid) return send(res, 400, { error: 'invalid phase' });
        return send(res, 200, await backend.listWorkflows((phase ?? undefined) as WorkflowPhaseFilter | undefined));
      }
      if (path === '/memory/recall') return send(res, 200, await backend.recall(url.searchParams.get('text') ?? ''));
      // Fu projection: the canonical council roster + the resolved provider truth (advisory display only).
      if (path === '/fu') return send(res, 200, { seats: CANONICAL_SEATS, providerTruth: providerTruthTable(), grantsAuthority: false });
      // AUMLOK projection: what is WAITING on the owner. Authority itself lives outside — this is a view.
      if (path === '/aumlok') return send(res, 200, { awaitingOwner: await backend.listWorkflows('awaiting-owner'), authorityLocation: 'kernel/AUMLOK (outside and above Convex)', grantsAuthority: false });
      // Candidate projection: applied governed-recursion workflows — the PR-candidate outputs.
      if (path === '/candidates') return send(res, 200, { applied: await backend.listWorkflows('applied'), egress: 'pr-candidate-only', grantsAuthority: false });
      // REACTIVE stream: Server-Sent Events over the injected subscription seam.
      if (path === '/events') {
        if (!backend.subscribeSnapshot) return send(res, 501, { error: 'reactive seam not wired (no subscribeSnapshot injected)' });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-aukora-source': 'live', 'x-aukora-grants-authority': 'false' });
        res.write(': connected\n\n'); // flush headers immediately so clients resolve before the first event
        const unsubscribe = backend.subscribeSnapshot((snapshot) => {
          res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
        });
        req.on('close', unsubscribe);
        return;
      }
    }
    if (req.method === 'POST') {
      if (path === '/control/cancel-rehearsal' || path === '/control/cancel-impulse') {
        // R59 control capability: state-changing reflexes require the per-boot token. Fail-closed — an
        // unprovisioned control plane refuses, and a missing/forged token is rejected without echoing it.
        if (typeof controlToken !== 'string' || controlToken.length === 0) {
          return send(res, 503, { error: 'control plane not provisioned' });
        }
        if (!verifyDoorControlToken(presentedControlToken(req), controlToken)) {
          return send(res, 401, { error: 'unauthorized' });
        }
      }
      if (path === '/control/cancel-rehearsal') {
        const body = await readBody(req);
        if (typeof body.key !== 'string' || body.key.length === 0) return send(res, 400, { error: 'key required' });
        return send(res, 200, await backend.cancelRehearsal(body.key));
      }
      if (path === '/control/cancel-impulse') {
        const body = await readBody(req);
        if (typeof body.impulseId !== 'string' || body.impulseId.length === 0) return send(res, 400, { error: 'impulseId required' });
        return send(res, 200, await backend.cancelImpulse(body.impulseId));
      }
    }
    return send(res, 404, { error: 'unknown door path' });
  } catch (err) {
    return send(res, 502, { error: 'backend unavailable', detail: String(err).slice(0, 200) });
  }
}

/**
 * Start the door. LOOPBACK ONLY — the host is not configurable. The control-plane capability token defaults to
 * the per-boot supervisor-provisioned `AUKORA_DOOR_TOKEN` env (null when unset ⇒ control reflexes fail closed);
 * pass it explicitly to override in tests. Returns the server (close() to stop).
 */
export function startLocalDoor(
  backend: DoorBackend,
  port: number = AUKORA_PORTS.brainDoor,
  controlToken: string | null = process.env[DOOR_CAPABILITY_ENV] ?? null,
): Promise<Server> {
  const server = createServer((req, res) => void handleDoorRequest(backend, req, res, controlToken));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/** The door grants no authority. Constant. */
export function localDoorGrantsAuthority(): false {
  return false;
}
