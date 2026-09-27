// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Provider transport runner (R37) — the ACTUAL live-provider transport for the Fu council, behind dependency
 * injection, with the credential retrieved from Keychain/env at call time and NEVER placed in repo, browser, or
 * receipts.
 *
 * Injection points (so deterministic CI stays offline and nothing embeds a key):
 *   - `CredentialSource.get(ref)` resolves an OPAQUE credential reference to a bearer token OUT-OF-BAND. The token
 *     is used only as an `Authorization` header value inside this module and is never returned, thrown, stored, or
 *     logged. `envCredentialSource` reads `process.env[ref]`; a Keychain source implements the same interface.
 *   - `httpPost` is injected (default: global `fetch`), so tests drive the transport with a fake HTTP layer and no
 *     network. There is NO embedded endpoint credential and NO default that would make a live call implicitly.
 *
 * Robustness = the engine's non-vote law: an HTTP error, a timeout/abort, malformed/empty output, or a missing
 * served-model identity all yield a benign `SeatResponse` the council classifies as a NON-VOTE — never a throw that
 * could crash a pass, never a vote. Per-pass/per-day spend ceilings live in the Fu adapter (unchanged); this module
 * only turns a seat + prompt into a bounded, redacted request/response.
 */
import type { CouncilSeat, SeatResponse, Transport } from '@aukora/council';

/** Out-of-band credential retrieval. The token never leaves this module except as an Authorization header value. */
export interface CredentialSource {
  /** Resolve an opaque reference (an env var name, a Keychain item id) to a bearer token, or null if absent. */
  get(ref: string): string | null;
}

/** Env-backed credential source. Reads `process.env[ref]`; returns null if unset. Never logs the value. */
export const envCredentialSource: CredentialSource = {
  get(ref: string): string | null {
    const v = typeof process !== 'undefined' && process.env ? process.env[ref] : undefined;
    return typeof v === 'string' && v.length > 0 ? v : null;
  },
};

/** Injected HTTP layer: POST JSON, return status + parsed JSON (or a parse flag). No network in tests. */
export interface HttpResponse {
  readonly status: number;
  readonly json: unknown;
  readonly ok: boolean;
}
export type HttpPost = (url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal) => Promise<HttpResponse>;

export interface ProviderTransportConfig {
  readonly endpoint: string;
  /** Env var name / Keychain id holding the bearer token — a REFERENCE, never the token. */
  readonly credentialRef: string;
  /** Council seat slug → provider model id. A seat with no mapping produces a non-vote (unconfigured). */
  readonly modelForSeat: Readonly<Record<string, string>>;
  readonly maxTokens?: number;
  /** Injected HTTP; defaults to global fetch wrapped as HttpPost. */
  readonly httpPost?: HttpPost;
}

const REDACTED = '[redacted]';

/** Wrap global fetch as an HttpPost. Only used when the caller does not inject one (never in deterministic tests). */
function fetchHttpPost(): HttpPost {
  return async (url, headers, body, signal) => {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    let json: unknown = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json, ok: res.ok };
  };
}

/** Extract the assistant text + served model + cost from an OpenAI-compatible response, defensively. */
function parseChatResponse(json: unknown): { text: string; served?: string; costUsd?: number } {
  if (json === null || typeof json !== 'object') return { text: '' };
  const o = json as Record<string, unknown>;
  const choices = Array.isArray(o.choices) ? o.choices : [];
  const first = choices[0];
  const message = first && typeof first === 'object' ? (first as Record<string, unknown>).message : undefined;
  const content = message && typeof message === 'object' ? (message as Record<string, unknown>).content : undefined;
  const served = typeof o.model === 'string' ? o.model : undefined;
  const usage = o.usage && typeof o.usage === 'object' ? (o.usage as Record<string, unknown>) : undefined;
  const cost = usage && typeof usage.cost === 'number' ? usage.cost : undefined;
  return { text: typeof content === 'string' ? content : '', served, costUsd: cost };
}

/**
 * Build a council `Transport` over an injected HTTP layer + out-of-band credential. Total: any failure is a benign
 * non-vote-shaped response, and the bearer token appears ONLY in the Authorization header (never returned/thrown).
 */
export function makeProviderTransport(config: ProviderTransportConfig, cred: CredentialSource): Transport {
  const httpPost = config.httpPost ?? fetchHttpPost();
  const outputCap = config.maxTokens ?? 700;

  return async (seat: CouncilSeat, prompt: string, phase, signal: AbortSignal): Promise<SeatResponse> => {
    const model = config.modelForSeat[seat.slug];
    if (!model) return { text: '', served: undefined }; // unconfigured seat → empty → non-vote

    const bearer = cred.get(config.credentialRef);
    if (!bearer) return { text: '', served: undefined }; // no credential → no call → non-vote (not an error)

    const headers = { 'content-type': 'application/json', authorization: `Bearer ${bearer}` };
    const body = {
      model,
      max_tokens: outputCap,
      messages: [
        { role: 'system', content: `You are ${seat.name} on the Aukora Fu council (${phase}). Reply with the tagged packet only.` },
        { role: 'user', content: prompt },
      ],
    };
    try {
      const res = await httpPost(config.endpoint, headers, body, signal);
      if (!res.ok) return { text: '', served: undefined, finishReason: `http_${res.status}` }; // provider error → non-vote
      const parsed = parseChatResponse(res.json);
      return { text: parsed.text, served: parsed.served, costUsd: parsed.costUsd, finishReason: 'stop' };
    } catch {
      return { text: '', served: undefined, finishReason: 'transport_error' }; // abort/timeout/parse → non-vote
    }
  };
}

/** A DIAGNOSTIC descriptor of a transport config that PROVES no secret is present — safe to print or receipt. */
export function redactedTransportInfo(config: ProviderTransportConfig): { endpoint: string; credentialRef: string; token: string; seats: number } {
  return { endpoint: config.endpoint, credentialRef: config.credentialRef, token: REDACTED, seats: Object.keys(config.modelForSeat).length };
}

/** HARD: the transport carries requests; it never mints authority. Constant, by construction. */
export function providerTransportGrantsAuthority(): false {
  return false;
}
