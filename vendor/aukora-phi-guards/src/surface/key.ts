// φ — where the key comes from, and nowhere else.
//
// One file, three sources, in order. The donor resolved keys through a 400-line config module that
// also handled fusion councils, seat rosters and provider routing; φ needs the first thirty lines of
// that and none of the rest.
//
// The key is never logged, never returned to the browser, never placed on a command line (`ps` reads
// those), and never written into a receipt. It rides in the environment of the child that needs it,
// and that is the only place it goes.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Key { key: string; from: string }

/**
 * ══ WHY THIS FILE GREW A VALIDATION PATH ══
 *
 * Measured on the owner's other machine: φ answered every message with `401 User not found` while a
 * perfectly good key sat one candidate further down the list. An old symbiote install had left a dead
 * key at `~/.aukora-symbiote/openrouter.key`, which is searched BEFORE `~/.aukora-openrouter.env`, and
 * the first non-empty string won.
 *
 * The comment already sitting above that loop names the exact failure: *"a working key the app refuses
 * to look at is indistinguishable from no key at all."* The resolution order caused the thing the
 * comment warned about, because a non-empty string was treated as a working key — a NAME, not a
 * RESOLUTION. That is the same defect this project has now hit four separate times in different
 * clothes, and it is why `resolveKey` is no longer the last word.
 *
 * ══ WHAT MAY DISQUALIFY A CANDIDATE ══
 *
 * Only an authoritative rejection. A 401 or 403 from OpenRouter means *this key is not a key*, and the
 * search moves on. A timeout, a DNS failure, an offline laptop or a 500 means we learned NOTHING, and a
 * candidate must never be discarded for that — otherwise the first flight without wifi silently
 * demotes the owner's real key and picks a worse one. Inconclusive is not negative.
 *
 * If nothing validates, the first candidate is still returned, with `checked` recording why. A node
 * that refuses to start because it could not reach the internet is worse than one that tries and says
 * plainly that it could not confirm.
 */
export interface KeyCheck { from: string; verdict: 'ok' | 'rejected' | 'unknown'; detail?: string }

/** `KEY=value` out of an env-shaped file, tolerating quotes and `export`. */
function fromEnvFile(path: string): string | undefined {
  try {
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*)$/.exec(raw);
      if (!m) continue;
      const v = (m[1] ?? '').trim().replace(/^["']|["']$/g, '');
      if (v) return v;
    }
  } catch { /* unreadable is the same as absent */ }
  return undefined;
}

/**
 * Every key this machine offers, in preference order.
 *
 * `from` names the ACTUAL FILE, not a category. Two different files used to both report "your
 * settings", so when the wrong one won there was no way to tell which — the owner's own node could not
 * say where the credential it was failing with had come from. A source you cannot name is a source you
 * cannot fix.
 */
export function keyCandidates(): Key[] {
  const out: Key[] = [];
  const seen = new Set<string>();
  const add = (key: string | undefined, from: string) => {
    const v = key?.trim();
    if (!v || seen.has(v)) return;      // the same key from two places is one candidate, not two
    seen.add(v);
    out.push({ key: v, from });
  };

  add(process.env.OPENROUTER_API_KEY, 'the environment');

  // Machine-local, outside the repo, so a key is never committed by accident. Several locations are
  // tried because a node may have been set up by the settings panel, by a sibling Aukora install, or
  // by hand — and a working key the app refuses to look at is indistinguishable from no key at all.
  for (const file of [
    join(homedir(), '.aukora', 'openrouter.key'),
    join(homedir(), '.aukora-symbiote', 'openrouter.key'),
  ]) {
    if (!existsSync(file)) continue;
    try { add(readFileSync(file, 'utf8'), file.replace(homedir(), '~')); }
    catch { /* unreadable is the same as absent */ }
  }

  for (const file of [join(homedir(), '.aukora-openrouter.env'), join(process.cwd(), '.env')]) {
    if (!existsSync(file)) continue;
    add(fromEnvFile(file), file.replace(homedir(), '~'));
  }
  return out;
}

/** The first candidate, whether or not it works. Kept synchronous for callers that cannot await. */
export function resolveKey(): Key | null {
  return keyCandidates()[0] ?? null;
}

/**
 * Ask OpenRouter whether this key is a key.
 *
 * `/api/v1/key` is the cheapest authoritative answer available — it costs no tokens and returns the
 * key's own metadata. The verdict vocabulary is deliberately three-valued, because two would be wrong:
 * an offline laptop must not be able to disqualify the owner's real credential.
 */
export async function validateKey(
  key: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<{ verdict: 'ok' | 'rejected' | 'unknown'; detail?: string }> {
  try {
    const res = await fetchImpl('https://openrouter.ai/api/v1/key', {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { verdict: 'ok' };
    if (res.status === 401 || res.status === 403) return { verdict: 'rejected', detail: `HTTP ${res.status}` };
    // 429, 5xx, anything else: the key may be perfectly good and the service having a bad minute.
    return { verdict: 'unknown', detail: `HTTP ${res.status}` };
  } catch (e) {
    return { verdict: 'unknown', detail: (e as Error)?.message ?? 'unreachable' };
  }
}

let resolved: { key: Key | null; checked: KeyCheck[] } | null = null;

/**
 * The first candidate that OpenRouter does not reject, and the reasoning behind it.
 *
 * Cached for the life of the process: this sits in front of every message, and a network round-trip per
 * turn would be a real cost for a question whose answer almost never changes. `forgetKeyCheck()` exists
 * so the owner can change a key without restarting the node.
 */
export async function resolveWorkingKey(fetchImpl: typeof fetch = fetch): Promise<{ key: Key | null; checked: KeyCheck[] }> {
  if (resolved) return resolved;
  const checked: KeyCheck[] = [];
  const all = keyCandidates();

  for (const cand of all) {
    const { verdict, detail } = await validateKey(cand.key, fetchImpl);
    checked.push({ from: cand.from, verdict, detail });
    if (verdict === 'ok') { resolved = { key: cand, checked }; return resolved; }
    // 'rejected' → keep looking. 'unknown' → also keep looking, but this candidate stays eligible
    // below, because "we could not ask" is not "it does not work".
  }

  const firstUnknown = all.find((c) => checked.find((k) => k.from === c.from)?.verdict === 'unknown');
  resolved = { key: firstUnknown ?? all[0] ?? null, checked };
  return resolved;
}

export function forgetKeyCheck(): void { resolved = null; }

/**
 * What the surface may be told about the key: whether there is one and where it came from.
 *
 * Never the value, and never a prefix of it — a "safe" first eight characters is still eight
 * characters of a credential in a log somebody pastes into an issue.
 */
export function keyStatus(): { present: boolean; from: string | null } {
  const k = resolveKey();
  return { present: !!k, from: k?.from ?? null };
}

/**
 * The same, but having actually asked — and carrying every candidate's verdict.
 *
 * The verdicts are the point. When φ answered `401 User not found` on the owner's other machine, the
 * node could say only "a key is present"; it could not say WHICH file it had come from or that the
 * service had rejected it. Diagnosing that took a screenshot and a second person. This makes the node
 * able to describe its own failure.
 */
export async function keyReport(fetchImpl: typeof fetch = fetch): Promise<{
  present: boolean; from: string | null; verdict: 'ok' | 'rejected' | 'unknown' | 'none'; checked: KeyCheck[];
}> {
  const { key, checked } = await resolveWorkingKey(fetchImpl);
  if (!key) return { present: false, from: null, verdict: 'none', checked };
  const mine = checked.find((c) => c.from === key.from);
  return { present: true, from: key.from, verdict: mine?.verdict ?? 'unknown', checked };
}
