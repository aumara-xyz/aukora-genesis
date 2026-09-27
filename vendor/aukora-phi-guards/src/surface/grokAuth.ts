// φ — GROK AS A MIND ON THIS MACHINE, without pretending OpenRouter is Grok.
//
// ══ WHY THIS FILE EXISTS ══
//
// The surface's presence lane was wired only to OpenRouter. On a Grok Build / Grok CLI host the
// machine already holds a live OIDC token at `~/.grok/auth.json` and a chat proxy base URL in the
// environment — and φ still answered "there is no API key on this node". That is the same defect
// class as trusting a NAME where a RESOLUTION was required: the credential was present; the door
// did not look for it.
//
// What this file does:
//   · find a non-expired Grok token on disk
//   · name the chat proxy (env first, then the known CLI default)
//   · never log or return the token to a browser
//
// What it does NOT do: claim that hosted Grok equals local key custody, or that a chat completion
// is a governed forge hand. Those are different seams.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const GROK_CLI_DEFAULT_BASE = 'https://cli-chat-proxy.grok.com/v1';
/** The header the CLI proxy requires; without it the service answers 426 with version "none". */
export const GROK_CLI_VERSION_HEADER = 'X-Grok-Client-Version';
export const GROK_CLI_VERSION = process.env.AUKORA_GROK_CLI_VERSION ?? '0.1.202';

/** Read live so tests and owner overrides do not race a frozen module constant. */
export function grokDefaultModel(): string {
  return process.env.AUKORA_GROK_MODEL ?? 'grok-4';
}
/** @deprecated use grokDefaultModel() — kept for import sites that want a name. */
export const GROK_DEFAULT_MODEL = 'grok-4';

export interface GrokAuth {
  token: string;
  from: string;
  expiresAt?: string;
  baseUrl: string;
  model: string;
}

interface AuthEntry {
  key?: string;
  expires_at?: string;
  auth_mode?: string;
}

function authPath(): string {
  return process.env.AUKORA_GROK_AUTH ?? join(homedir(), '.grok', 'auth.json');
}

function notExpired(expiresAt: string | undefined, now = Date.now()): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return t - 30_000 > now;
}

/**
 * Read every live token the Grok CLI left on this machine.
 *
 * Shape is an object keyed by issuer::client_id (observed), each value carrying `key` + `expires_at`.
 * We never invent a shape: only entries with a non-empty `key` string count.
 */
export function grokAuthCandidates(now = Date.now()): GrokAuth[] {
  const path = authPath();
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  if (!raw || typeof raw !== 'object') return [];

  const baseUrl = (process.env.GROK_CLI_CHAT_PROXY_BASE_URL ?? GROK_CLI_DEFAULT_BASE).replace(/\/$/, '');
  const model = grokDefaultModel();
  const out: GrokAuth[] = [];
  const label = path.replace(homedir(), '~');

  for (const [name, entry] of Object.entries(raw as Record<string, AuthEntry>)) {
    if (!entry || typeof entry !== 'object') continue;
    const key = typeof entry.key === 'string' ? entry.key.trim() : '';
    if (!key) continue;
    if (!notExpired(entry.expires_at, now)) continue;
    out.push({
      token: key,
      from: `${label} (${name.split('::').pop() ?? 'session'})`,
      expiresAt: entry.expires_at,
      baseUrl,
      model,
    });
  }
  return out;
}

/** First live Grok session, or null. Synchronous — disk only, no network. */
export function resolveGrokAuth(now = Date.now()): GrokAuth | null {
  return grokAuthCandidates(now)[0] ?? null;
}

export function grokAuthStatus(): { present: boolean; from: string | null; expiresAt: string | null } {
  const a = resolveGrokAuth();
  return { present: !!a, from: a?.from ?? null, expiresAt: a?.expiresAt ?? null };
}

/** Headers the CLI chat proxy accepts for a completion. Token never leaves this process. */
export function grokChatHeaders(auth: GrokAuth): Record<string, string> {
  return {
    authorization: `Bearer ${auth.token}`,
    'content-type': 'application/json',
    [GROK_CLI_VERSION_HEADER]: GROK_CLI_VERSION,
    'user-agent': `Grok-Code/${GROK_CLI_VERSION}`,
  };
}
