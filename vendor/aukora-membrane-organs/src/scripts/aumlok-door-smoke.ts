#!/usr/bin/env bun
// scripts/aumlok-door-smoke.ts — AUMLOK-DOOR-SMOKE-v0
//
// Disposable REHEARSAL only. Never sets AUKORA_CEREMONY=real. Never writes identityBound
// into forge proposals. Never claims ceremony complete.
//
//     bun run scripts/aumlok-door-smoke.ts
//
// What it does:
//   1. Reports standing + vowPresent on THIS node (read-only)
//   2. Builds createCeremonyDoor({ mode: 'rehearsal', scheduleExit: false }) with a throwaway dir
//   3. GET /api/bind/status on the in-process fetch handler
//   4. Optionally POST /api/bind/phrase then /api/bind/cancel (mint + discard — no complete)
//
// What it does NOT do:
//   - startCeremonyDoor with real mode
//   - POST /api/bind/complete
//   - touch forge accept / identityBound
//   - print success as "you are bound"
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vowPresent } from '../core/authority/vowRecord';
import { currentStanding, standingReport } from '../core/authority/standing';
import {
  createCeremonyDoor,
  ceremonyMode,
  ceremonyDoorGrantsAuthority,
  REAL_MODE_ENV,
  REAL_MODE_VALUE,
  CEREMONY_PORT,
} from '../organs/aumlok/door';
import { makeVowCommit } from '../organs/aumlok/vow';

const line = (s: string) => console.log(s);
const fail = (s: string) => { console.error(s); process.exit(1); };

line('══ AUMLOK door smoke · REHEARSAL ONLY · not a bind ══');
line('');

// ── refuse to run if someone armed real mode in the environment ──
if (process.env[REAL_MODE_ENV] === REAL_MODE_VALUE) {
  fail(
    `STOP: ${REAL_MODE_ENV}=${REAL_MODE_VALUE} is set.\n` +
    `  This smoke will not run while real mode is armed.\n` +
    `  Unset it for disposable rehearsal, or run the ceremony yourself deliberately:\n` +
    `    AUKORA_CEREMONY=real bun run organs/aumlok/door.ts\n` +
    `  (interactive type-back; not this script)`,
  );
}

const mode = ceremonyMode(); // should be rehearsal
if (mode !== 'rehearsal') {
  fail(`STOP: ceremonyMode() returned ${mode} — smoke only runs rehearsal`);
}

// ── read-only posture of THIS node (not the throwaway rehearsal home) ──
const liveStanding = currentStanding();
const liveVow = vowPresent();
const doorGrants = ceremonyDoorGrantsAuthority();
const report = standingReport();

line('LIVE NODE (read-only — this repository / .aukora standing)');
line(`  currentStanding:     ${liveStanding}`);
line(`  vowPresent:          ${liveVow}`);
line(`  ceremonyDoorGrantsAuthority: ${doorGrants}`);
line(`  standingReport.canCreate:    ${report.canCreate}`);
line(`  standingReport.vowTaken:     ${report.vowTaken}`);
line(`  standingReport.vowAvailable: ${report.vowAvailable}`);
if (report.vowRecordNote) line(`  vowRecordNote:       ${report.vowRecordNote}`);
line('');

if (doorGrants !== false) {
  fail('STOP: ceremonyDoorGrantsAuthority() is not false — smoke refuses to continue');
}

// ── disposable ceremony door (in-process; no listen required) ──
const throwaway = mkdtempSync(join(tmpdir(), 'aumlok-door-smoke-'));
const paths = { dir: throwaway };
const commit = makeVowCommit({ paths });

const door = createCeremonyDoor({
  mode: 'rehearsal',
  commit,
  scheduleExit: false, // MUST NOT exit the smoke process
  port: CEREMONY_PORT,
});

line('DISPOSABLE DOOR');
line(`  mode:           ${door.mode}`);
line(`  throwaway home: ${throwaway}`);
line(`  (standing of THIS node is not moved by rehearsal writes)`);
line('');

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await door.fetch(new Request(`http://127.0.0.1:${CEREMONY_PORT}${path}`, {
    headers: { host: `127.0.0.1:${CEREMONY_PORT}` },
  }));
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* plain */ }
  return { status: res.status, body };
}

async function post(path: string, jsonBody?: unknown, extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const res = await door.fetch(new Request(`http://127.0.0.1:${CEREMONY_PORT}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: `127.0.0.1:${CEREMONY_PORT}`,
      // origin null path is also local; set origin to same host for belt+braces
      origin: `http://127.0.0.1:${CEREMONY_PORT}`,
      ...extraHeaders,
    },
    body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
  }));
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* plain */ }
  return { status: res.status, body };
}

const status = await get('/api/bind/status');
line('GET /api/bind/status');
line(`  HTTP ${status.status}`);
const st = status.body as Record<string, unknown>;
if (status.status !== 200 || !st || st.ok !== true) {
  fail(`  unexpected status body: ${JSON.stringify(status.body)}`);
}
line(`  posture:         ${st.posture}`);
line(`  mode:            ${st.mode}`);
line(`  standing:        ${st.standing}`);
line(`  vowPresent:      ${st.vowPresent}`);
line(`  grantsAuthority: ${st.grantsAuthority}`);
line(`  identityBound:    ${st.identityBound}`);
line(`  candidateAlive:  ${st.candidateAlive}`);
line(`  advisory:        ${String(st.advisory).slice(0, 120)}…`);
if (st.grantsAuthority !== false) {
  fail('STOP: /api/bind/status grantsAuthority is not false');
}
if (st.identityBound !== false) {
  fail('STOP: /api/bind/status identityBound is not false — forge identity must stay unbound');
}
if (typeof st.standing !== 'string' || !st.standing) {
  fail('STOP: /api/bind/status missing standing');
}
if (typeof st.vowPresent !== 'boolean') {
  fail('STOP: /api/bind/status missing vowPresent boolean');
}
if (st.mode !== 'rehearsal') {
  fail(`STOP: door status mode is ${st.mode}, expected rehearsal`);
}
line('');

// Mint a phrase then cancel — proves the rehearsal path without completing a vow.
// The phrase appears once in the phrase response; we do not print the full phrase here
// (owner smoke should not leave ceremony words in logs). We print lengths only.
const phraseRes = await post('/api/bind/phrase');
line('POST /api/bind/phrase (rehearsal mint — then cancel; no complete)');
line(`  HTTP ${phraseRes.status}`);
const pr = phraseRes.body as Record<string, unknown>;
if (phraseRes.status !== 200 || pr.ok !== true) {
  line(`  body: ${JSON.stringify(phraseRes.body)}`);
  fail('  phrase mint failed in rehearsal — door may need interactive owner secrets or more deps');
}
const tokens = Array.isArray(pr.tokens) ? pr.tokens : [];
line(`  tokens: ${tokens.length} (phrase NOT printed — do not log ceremony words)`);
line(`  nonce present: ${typeof pr.nonce === 'string' && pr.nonce.length > 0}`);
line(`  expiresAt: ${pr.expiresAt ?? '—'}`);

const cancel = await post('/api/bind/cancel');
line(`POST /api/bind/cancel → HTTP ${cancel.status} revoked=${(cancel.body as { revoked?: boolean })?.revoked}`);
line('');

// Prove we never raised live standing
const afterStanding = currentStanding();
const afterVow = vowPresent();
line('LIVE NODE AFTER REHEARSAL (must be unchanged)');
line(`  currentStanding: ${afterStanding}  (was ${liveStanding})`);
line(`  vowPresent:      ${afterVow}  (was ${liveVow})`);
if (afterStanding !== liveStanding || afterVow !== liveVow) {
  fail('STOP: live node standing/vow changed during rehearsal smoke — that is a bind leak');
}
line('');

// cleanup throwaway
try { rmSync(throwaway, { recursive: true, force: true }); } catch { /* ok */ }

line('══ RESULT ══');
line('  smoke: REHEARSAL path exercised (status + phrase mint + cancel)');
line('  ceremony complete: NO (not claimed, not run)');
line('  identityBound / forge: NOT TOUCHED');
line('  grantsAuthority: false (door + status)');
line('');
line('══ NEXT HUMAN STEP (only if YOU want a real vow) ══');
line('  1. Stop any agent mid-turn. This is your machine, your intent.');
line(`  2. AUKORA_CEREMONY=real bun run organs/aumlok/door.ts`);
line('  3. Follow GET / and /api/bind/status on 127.0.0.1:7402');
line('  4. POST /api/bind/phrase — write the seven words down (shown once)');
line('  5. POST /api/bind/complete with { phrase, nonce } — type-back');
line('  6. Confirm standing moves via core/authority (vowPresent / currentStanding)');
line('  This script will not do steps 2–5 for you.');
line('');
line('aumlok-door-smoke: OK (rehearsal only)');
