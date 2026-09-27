// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Brick W3b — the admin-authenticated LOCAL transport behind memoryAppend's `invoke` dep.
 *
 * This is the "smallest missing bridge": the piece that turns the pinned write path into a
 * reachable one, and nothing else. It supersedes the failure modes the plan named in the OLD
 * adapter (core/src/kernelAdapter.ts): the donor cwd (kernelAdapter.ts:20), the retired
 * backend's key path (:21), silent-null on every failure (:62, :72), and a target function
 * that S1a never vendored (:77). None of those patterns are repeated here:
 *
 *   - Key custody is STRICT and LOUD. The admin key lives at
 *     ~/.aukora-symbiote/convex/admin-key.txt (AUMLOK-tier custody, NOT AUMLOK-colocated).
 *     Missing / empty / symlinked / non-regular / group-or-world-readable key files THROW
 *     typed errors — never a silent null, never a fallback. chmod 600 is enforced, not advised.
 *   - Loopback only. The transport refuses any non-loopback URL before doing anything
 *     (same guard as the read door: convexBrainReadonly.isLoopbackUrl). Zero cloud, by law.
 *   - One function. The transport hard-refuses any function path other than the registered
 *     governed mutation (defense in depth with memoryAppend's own pin).
 *   - No fallback writes, no retries. A failure THROWS; memoryAppend maps it to a refused,
 *     no-authority envelope. Nothing is ever written anywhere else "instead".
 *   - Key material never leaks into errors: messages are scrubbed against the loaded key.
 *
 * Invocation mechanism — TWO paths, same custody + guards:
 *   1. HTTP (PRIMARY, W3c): a single admin-authenticated `POST {url}/api/mutation` with header
 *      `Authorization: Convex <admin-key>` and body `{path, args, format:"json"}`. Empirically
 *      proven (2026-07-05, throwaway backend) to reach the INTERNAL governed mutation and execute
 *      it — unauthenticated callers still get `FunctionPathNotFound`, so the internal boundary holds.
 *      No process spawn, no app-root/node_modules dependency, no per-call `npx` — a far smaller
 *      trust + latency surface than the CLI. This is what the door uses.
 *   2. CLI (LEGACY, kept for the throwaway proof + as a documented fallback): the S1a path —
 *      `npx convex run` with CONVEX_SELF_HOSTED_URL/_ADMIN_KEY + CI=1. Needs a real app root.
 * Both executors are injectable so every guard is testable without a backend; the live proof
 * (scripts/prove_memory_bridge_live.sh) exercises the real HTTP path against a throwaway deploy.
 *
 * WHAT THIS IS NOT: no capture, no migration, no callers besides the door, tests, and the live
 * probe. The managed backend lifecycle lives in core/src/convexBackendManager.ts + scripts/brain.sh.
 */
import { execFileSync } from 'child_process';
import { lstatSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { isLoopbackUrl } from './convexBrainReadonly';
import { REGISTERED_GOVERNED_MUTATION } from './memoryAppend';
import { verifyWindowsKeyFileCustody, WindowsCustodyError, type WindowsCustodyOptions } from './windowsKeyCustody';

export const ADMIN_KEY_DIR = join(homedir(), '.aukora-symbiote', 'convex');
export const ADMIN_KEY_PATH = join(ADMIN_KEY_DIR, 'admin-key.txt');
export const DEFAULT_BRAIN_URL = 'http://127.0.0.1:3210';

/** Typed, loud transport failures. `code` is stable for tests/telemetry; messages carry the
 *  expected path / remedy but NEVER key material. */
export class MemoryKernelTransportError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'MemoryKernelTransportError';
  }
}

const fail = (code: string, message: string): never => {
  throw new MemoryKernelTransportError(code, message);
};

/** Test seam for the platform branch below: lets any host exercise the win32 lane hermetically. */
export type KeyCustodyDeps = { platform?: NodeJS.Platform; windows?: WindowsCustodyOptions };

/** Read the admin key under strict custody rules. Fail-closed and LOUD on every violation —
 *  the old adapter's silent `return null` is exactly the failure mode this replaces.
 *  Custody law per platform: POSIX mode bits on Mac/Linux (unchanged); on Windows — where
 *  bun/node fabricate mode 0666 for every writable file, so mode bits certify nothing — the
 *  native ACL is verified instead (core/src/windowsKeyCustody.ts, allowlist, fail-closed). */
export function readAdminKeyStrict(keyPath: string = ADMIN_KEY_PATH, custody: KeyCustodyDeps = {}): string {
  let st;
  try {
    st = lstatSync(keyPath);
  } catch {
    return fail('admin_key_missing', `no admin key at ${keyPath} — the memory organ is not provisioned (see docs/MEMORY_APPEND_WIRING.md)`);
  }
  if (st.isSymbolicLink()) return fail('admin_key_symlink_refused', `${keyPath} is a symlink; the key must be a regular file`);
  if (!st.isFile()) return fail('admin_key_not_regular_file', `${keyPath} is not a regular file`);
  if ((custody.platform ?? process.platform) === 'win32') {
    // Windows custody: native ACL allowlist (fail-closed; typed reasons ride through).
    try {
      verifyWindowsKeyFileCustody(keyPath, custody.windows);
    } catch (e) {
      const code = e instanceof WindowsCustodyError ? e.code : 'windows_custody_failed';
      return fail(`admin_key_${code}`, e instanceof Error ? e.message : String(e));
    }
  } else if ((st.mode & 0o077) !== 0) {
    // POSIX custody: no group/other bits at all (0600 or 0400). "0644 would work" is the
    // demonstrated failure mode of the OLD backend's key — refused here, not warned about.
    return fail('admin_key_permissions_open', `${keyPath} is group/world accessible (mode ${(st.mode & 0o777).toString(8)}) — chmod 600 it`);
  }
  const raw = readFileSync(keyPath, 'utf-8').trim();
  if (!raw) return fail('admin_key_empty', `${keyPath} exists but is empty`);
  if (/\r|\n/.test(raw)) return fail('admin_key_malformed', `${keyPath} must hold exactly one key on one line`);
  return raw;
}

export type RunCli = (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number; env: Record<string, string | undefined> }) => string;

const realRunCli: RunCli = (cmd, args, opts) =>
  execFileSync(cmd, args, {
    cwd: opts.cwd,
    timeout: opts.timeoutMs,
    stdio: 'pipe',
    env: opts.env as NodeJS.ProcessEnv,
  }).toString();

export type MemoryKernelTransportConfig = {
  /** Loopback URL of the LOCAL self-hosted backend. Non-loopback refuses. */
  url?: string;
  /** Admin key file under strict custody (default ADMIN_KEY_PATH). */
  adminKeyPath?: string;
  /** Convex app root the CLI runs from — the directory whose convex/ IS the vendored kernel.
   *  REQUIRED explicitly: running from the wrong root silently targets zero functions
   *  (the S1a-verified footgun, convex/README.md). No guessing. */
  appRoot: string;
  timeoutMs?: number;
  /** Injectable executor for hermetic tests; the default spawns the pinned CLI (no shell). */
  runCli?: RunCli;
};

function scrub(message: string, secret: string): string {
  return secret ? message.split(secret).join('[admin-key redacted]') : message;
}

/**
 * Build the `invoke` dependency for memoryAppend. Every call re-reads the key (custody is
 * checked at use time, not cached past a rotation) and enforces: loopback URL, the ONE
 * registered function path, one attempt, typed loud failure.
 */
export function createGovernedInvoke(cfg: MemoryKernelTransportConfig) {
  const url = cfg.url ?? DEFAULT_BRAIN_URL;
  const keyPath = cfg.adminKeyPath ?? ADMIN_KEY_PATH;
  const timeoutMs = cfg.timeoutMs ?? 30_000;
  const runCli = cfg.runCli ?? realRunCli;
  if (typeof cfg.appRoot !== 'string' || cfg.appRoot.length === 0) {
    fail('transport_app_root_required', 'the convex app root must be named explicitly (wrong-root runs silently target zero functions)');
  }

  return async (mutationName: string, payload: { req: Record<string, unknown>; subjectSig: string; value: string }): Promise<unknown> => {
    if (mutationName !== REGISTERED_GOVERNED_MUTATION) {
      fail('transport_function_not_registered', `refusing to invoke "${mutationName}" — only ${REGISTERED_GOVERNED_MUTATION} is registered`);
    }
    if (!isLoopbackUrl(url)) {
      fail('transport_nonloopback_refused', `refusing non-loopback backend URL — the memory organ is local-only by law (SAFETY_LAWS 2)`);
    }
    const adminKey = readAdminKeyStrict(keyPath); // throws loud on custody violations

    let stdout: string;
    try {
      // argv list + no shell: the JSON payload can contain anything without becoming shell.
      stdout = runCli('npx', ['convex', 'run', mutationName, JSON.stringify(payload)], {
        cwd: cfg.appRoot,
        timeoutMs,
        env: {
          ...process.env,
          CONVEX_SELF_HOSTED_URL: url,
          CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
          CI: '1', // suppress CLI telemetry/Sentry — zero egress posture
        },
      });
    } catch (e) {
      // ONE attempt, loud surface, no fallback write anywhere. The kernel's own refusal string
      // (e.g. aumlok_mem_no_authority) rides through so memoryAppend can report it — scrubbed.
      const msg = e instanceof Error ? e.message : String(e);
      const detail = (e as { stderr?: Buffer | string })?.stderr?.toString?.() ?? '';
      return fail('transport_kernel_call_failed', scrub(`${msg}${detail ? ` — ${detail.trim().slice(0, 400)}` : ''}`, adminKey));
    }

    const a = stdout.indexOf('{');
    const b = stdout.lastIndexOf('}');
    if (a < 0 || b <= a) return fail('transport_result_unparseable', scrub(`convex run returned no JSON object: ${stdout.trim().slice(0, 200)}`, adminKey));
    try {
      return JSON.parse(stdout.slice(a, b + 1));
    } catch {
      return fail('transport_result_unparseable', scrub(`convex run returned malformed JSON: ${stdout.trim().slice(0, 200)}`, adminKey));
    }
  };
}

// ── HTTP transport (W3c, PRIMARY) ────────────────────────────────────────────────────────────────
// Convex's self-hosted HTTP mutation endpoint. Same shape the CLI uses under the hood, but reachable
// with just the admin bearer — no spawn, no app root. Verified: `Authorization: Convex <key>` reaches
// INTERNAL functions; without it the endpoint returns FunctionPathNotFound.
export type HttpFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

// The kernel's response envelope is tiny ({status, value:{ok, receiptHash, memoryHash,…}} — a few
// hundred bytes). A hostile/buggy/squatting process on the loopback port could otherwise stream a
// multi-GB 200 body FAST (inside the wall-clock timeout) and OOM-crash the process — an uncatchable
// fatal allocation that would bypass every guard. So the default fetch reads the body with a HARD
// byte cap (the CLI path is already bounded by execFileSync's maxBuffer; this restores parity).
export const MAX_RESPONSE_BYTES = 1_048_576; // 1 MB — generous vs the real envelope, still bounded

const realHttpFetch: HttpFetch = async (url, init) => {
  const resp = await fetch(url, init);
  const reader = resp.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.length;
        if (received > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error(`response_too_large: backend body exceeded ${MAX_RESPONSE_BYTES} bytes`);
        }
        chunks.push(value);
      }
    }
  }
  const bodyText = Buffer.concat(chunks).toString('utf8');
  return { ok: resp.ok, status: resp.status, text: async () => bodyText };
};

export type MemoryKernelHttpConfig = {
  /** Loopback URL of the LOCAL self-hosted backend. Non-loopback refuses. */
  url?: string;
  /** Admin key file under strict custody (default ADMIN_KEY_PATH). */
  adminKeyPath?: string;
  timeoutMs?: number;
  /** Injectable fetch for hermetic tests; the default uses global fetch. */
  httpFetch?: HttpFetch;
};

/**
 * Build the `invoke` dependency for memoryAppend over HTTP. Same discipline as the CLI path — key
 * re-read at use time under strict custody, loopback-only, ONE registered function path, one attempt,
 * no fallback, typed loud failure, key scrubbed from every message. The ONLY difference is the wire:
 * a single POST to the loopback backend instead of spawning `npx convex run`.
 */
export function createGovernedHttpInvoke(cfg: MemoryKernelHttpConfig = {}) {
  const url = cfg.url ?? DEFAULT_BRAIN_URL;
  const keyPath = cfg.adminKeyPath ?? ADMIN_KEY_PATH;
  const timeoutMs = cfg.timeoutMs ?? 30_000;
  const httpFetch = cfg.httpFetch ?? realHttpFetch;

  return async (mutationName: string, payload: { req: Record<string, unknown>; subjectSig: string; value: string }): Promise<unknown> => {
    if (mutationName !== REGISTERED_GOVERNED_MUTATION) {
      fail('transport_function_not_registered', `refusing to invoke "${mutationName}" — only ${REGISTERED_GOVERNED_MUTATION} is registered`);
    }
    if (!isLoopbackUrl(url)) {
      fail('transport_nonloopback_refused', 'refusing non-loopback backend URL — the memory organ is local-only by law (SAFETY_LAWS 2)');
    }
    const adminKey = readAdminKeyStrict(keyPath); // throws loud on custody violations
    const endpoint = url.replace(/\/+$/, '') + '/api/mutation';
    const body = JSON.stringify({ path: mutationName, args: payload, format: 'json' });

    let res: { ok: boolean; status: number; text: () => Promise<string> };
    try {
      res = await httpFetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The admin bearer is what lets this reach an INTERNAL function. It is sent ONLY as a
          // header to the loopback backend, never logged, never placed in argv/env for a child.
          authorization: `Convex ${adminKey}`,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // a bounded-read overflow (from realHttpFetch) is a distinct, loud signal — never a silent OOM
      const code = /response_too_large/.test(msg) ? 'transport_response_too_large' : 'transport_http_failed';
      return fail(code, scrub(`POST ${endpoint} failed: ${msg}`, adminKey));
    }

    let raw: string;
    try {
      raw = await res.text();
    } catch (e) {
      // a too-large body throws here in some runtimes (string-length limit) — surface it, don't swallow to ''
      const msg = e instanceof Error ? e.message : String(e);
      return fail('transport_response_too_large', scrub(`reading backend body failed: ${msg}`, adminKey));
    }
    if (!res.ok) {
      // FunctionPathNotFound here would mean the admin bearer didn't authenticate (internal invisible).
      return fail('transport_http_status', scrub(`backend returned HTTP ${res.status}: ${raw.slice(0, 300)}`, adminKey));
    }

    // Convex HTTP shape: {status:"success", value} | {status:"error", errorMessage, errorData?}.
    let parsed: { status?: unknown; value?: unknown; errorMessage?: unknown };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return fail('transport_result_unparseable', scrub(`backend returned malformed JSON: ${raw.slice(0, 200)}`, adminKey));
    }
    if (parsed.status === 'error') {
      // the kernel's own refusal (e.g. aumlok_mem_no_authority) rides through so memoryAppend reports it
      return fail('transport_kernel_call_failed', scrub(typeof parsed.errorMessage === 'string' ? parsed.errorMessage : 'kernel returned an error', adminKey));
    }
    if (parsed.status !== 'success') {
      return fail('transport_result_unparseable', scrub(`unexpected result envelope: ${raw.slice(0, 200)}`, adminKey));
    }
    return parsed.value; // the mutation's return object ({ ok, receiptHash, memoryHash, … })
  };
}
