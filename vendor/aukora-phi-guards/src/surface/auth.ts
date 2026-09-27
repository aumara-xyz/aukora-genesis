// φ — MAGIC LINK AUTH for the hosted node.
//
// Email → one-time token → session. No SMTP required on Grok Build: the surface
// consumes the token in-page (POST /api/auth/consume) so we never hand the browser
// a dead `http://127.0.0.1` link.
//
// Sessions ride an httpOnly cookie when the proxy allows it, and also an
// `X-Phi-Session` header / localStorage backup for preview iframes that drop cookies.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = () => process.env.AUKORA_FORGE_REPO
  ?? new URL('..', import.meta.url).pathname;
const AUTH_DIR = () => join(ROOT(), '.aukora', 'auth');
const TOKENS_DIR = () => join(AUTH_DIR(), 'tokens');
const SESSIONS_DIR = () => join(AUTH_DIR(), 'sessions');

export const SESSION_COOKIE = 'phi_session';
export const SESSION_HEADER = 'x-phi-session';
export const TOKEN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface Session {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

export interface MagicToken {
  token: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

function ensureDirs(): void {
  for (const d of [AUTH_DIR(), TOKENS_DIR(), SESSIONS_DIR()]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  if (e.length > 200) return null;
  return e;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Parse Cookie header into a map. */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * The shape of a session id. TWO CALLERS, TWO QUESTIONS, and conflating them was a compile error.
 *
 * `SESSION_ID_RE` is the shape alone, for a caller that already holds a `string` and only wants to
 * know whether it looks right. `isSessionId` adds the type predicate for `sessionFromRequest`, which
 * genuinely narrows `string | null | undefined` out of a header or a cookie.
 *
 * They were one function, and `consumeMagicToken` — where the value is already `string` — used it in
 * a NEGATIVE branch. `id is string` on something already known to be a string makes the else-branch
 * `never`, so every later `token.length` stopped compiling, and `bunx tsc` has been red on main for
 * it. A type guard claims what a value IS; "well-formed" is a different claim and now has its own
 * name. Neither caller's behaviour changes.
 */
const SESSION_ID_RE = /^[a-f0-9]{32,128}$/i;

function isSessionId(id: string | null | undefined): id is string {
  return !!id && SESSION_ID_RE.test(id);
}

export function sessionFromRequest(req: Request): Session | null {
  // Prefer header first — preview iframes often block third-party cookies.
  const fromHeader = req.headers.get(SESSION_HEADER) ?? req.headers.get('X-Phi-Session');
  const cookies = parseCookies(req.headers.get('cookie'));
  const fromCookie = cookies[SESSION_COOKIE];
  const id = isSessionId(fromHeader) ? fromHeader : (isSessionId(fromCookie) ? fromCookie : null);
  if (!id) return null;
  return readSession(id);
}

export function readSession(id: string): Session | null {
  ensureDirs();
  const path = join(SESSIONS_DIR(), `${hash(id)}.json`);
  const s = readJson<Session>(path);
  if (!s || s.id !== id) return null;
  if (s.expiresAt < Date.now()) {
    try { unlinkSync(path); } catch { /* */ }
    return null;
  }
  return s;
}

/** Cookie flags that survive HTTPS reverse proxies / preview iframes better than Lax-only. */
export function setSessionCookie(sessionId: string, opts: { secure?: boolean } = {}): string {
  const secure = opts.secure === true;
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    // None+Secure for cross-site preview shells; Lax when plain HTTP local.
    secure ? 'SameSite=None' : 'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(opts: { secure?: boolean } = {}): string {
  const secure = opts.secure === true;
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    secure ? 'SameSite=None' : 'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function requestIsSecure(req: Request): boolean {
  if (req.headers.get('x-forwarded-proto') === 'https') return true;
  try {
    return new URL(req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function createMagicLink(emailRaw: string): {
  ok: true; email: string; token: string; expiresAt: number;
} | { ok: false; error: string } {
  const email = normalizeEmail(emailRaw);
  if (!email) return { ok: false, error: 'enter a real email address' };
  ensureDirs();
  try {
    for (const f of readdirSync(TOKENS_DIR())) {
      const t = readJson<MagicToken>(join(TOKENS_DIR(), f));
      if (t && t.expiresAt < Date.now()) {
        try { unlinkSync(join(TOKENS_DIR(), f)); } catch { /* */ }
      }
    }
  } catch { /* */ }

  const token = randomBytes(24).toString('hex');
  const now = Date.now();
  const row: MagicToken = {
    token,
    email,
    createdAt: now,
    expiresAt: now + TOKEN_TTL_MS,
  };
  writeFileSync(join(TOKENS_DIR(), `${hash(token)}.json`), JSON.stringify(row));
  return { ok: true, email, token, expiresAt: row.expiresAt };
}

export function consumeMagicToken(token: string): {
  ok: true; session: Session;
} | { ok: false; error: string } {
  // `SESSION_ID_RE`, not `isSessionId` — see that declaration. Same test, same order, no predicate to
  // narrow an already-`string` value to `never` in the branch below.
  const t = String(token ?? '');
  if (!SESSION_ID_RE.test(t) && !/^[a-f0-9]{20,128}$/i.test(t)) {
    // tokens are 48 hex chars (24 bytes); allow wider for safety
    if (!t || !/^[a-f0-9]+$/i.test(t) || t.length < 20) {
      return { ok: false, error: 'this link is not valid' };
    }
  }
  ensureDirs();
  const path = join(TOKENS_DIR(), `${hash(token)}.json`);
  const row = readJson<MagicToken>(path);
  try { unlinkSync(path); } catch { /* one-time */ }
  if (!row || row.token !== token) return { ok: false, error: 'this link was already used or never existed' };
  if (row.expiresAt < Date.now()) return { ok: false, error: 'this link has expired — request a new one' };

  const id = randomBytes(24).toString('hex');
  const now = Date.now();
  const session: Session = {
    id,
    email: row.email,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  writeFileSync(join(SESSIONS_DIR(), `${hash(id)}.json`), JSON.stringify(session));
  return { ok: true, session };
}

export function destroySession(sessionId: string): void {
  ensureDirs();
  try { unlinkSync(join(SESSIONS_DIR(), `${hash(sessionId)}.json`)); } catch { /* */ }
}

/** When true, write routes require a session. Hosted defaults on. */
export function authRequired(): boolean {
  if (process.env.AUKORA_AUTH === '0') return false;
  if (process.env.AUKORA_AUTH === '1') return true;
  return process.env.AUKORA_HOSTED === '1';
}
