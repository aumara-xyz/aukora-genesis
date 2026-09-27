// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// Door-glue + truth-surface tests for the shadow-capture lane (hermetic — no backend, no network):
//   - the glue never throws, records refusals to the status file, and is inert when unarmed;
//   - lockdown refuses at the dispatch point;
//   - the DOOR-WIRING pin: chat-serve.ts actually calls the capture on the completed-voice-turn
//     path (without this, a forgotten hook ships green with a capture lane nothing calls);
//   - the WIRED-TRUTH contract: capture.wired is true ONLY when the env flag is set, and a
//     missing/unreadable status file degrades the note without throwing;
//   - the recall-source pin: /api/brain serves source 'convex' by default; the archived JSON
//     brain appears only as the labeled kira-json-legacy hatch (R5b step-4 cutover boundary).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  captureCompletedTurn,
  captureTruth,
  extractVoiceReplyText,
  readCaptureStatusSafe,
  shadowCaptureAvailable,
  shadowCaptureEnabledByEnv,
  _resetShadowCaptureForTests,
} from '../../spatial/shadowCapture';
import type { CaptureUseLease } from '../src/conversationShadowCapture';

const FLAG = 'AUKORA_MEMORY_SHADOW_CAPTURE';
let tmp: string;
let savedFlag: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aukora-shadowcap-'));
  savedFlag = process.env[FLAG];
  _resetShadowCaptureForTests();
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  fs.rmSync(tmp, { recursive: true, force: true });
  _resetShadowCaptureForTests();
});

const VOICED_ENTRIES = [
  { kind: 'info', text: 'Understood — we decided the send button stays teal for the demo.' },
  { kind: 'tool_result', tool: 'voice', text: 'voice: Fable · advisory' },
];

function lease(seq = 0): CaptureUseLease {
  return { manifestId: 'mft-t', subjectId: 'capture.door', useSeq: seq, signConsume: async () => 'sig' };
}

function overridesFor(opts: {
  invoke?: (name: string, payload: { req: Record<string, unknown>; subjectSig: string; value: string }) => Promise<unknown>;
  nextUse?: () => Promise<CaptureUseLease>;
  modeFile?: string;
}) {
  return {
    statusPath: path.join(tmp, 'capture-status.json'),
    modePath: opts.modeFile ?? path.join(tmp, 'capability-mode.json'),
    ownerRootId: 'aumara.root',
    deploymentUrl: 'http://127.0.0.1:3210',
    nextUse: opts.nextUse ?? (async () => lease()),
    invoke: opts.invoke ?? (async () => { throw new Error('test should not invoke'); }),
    recordEvent: () => { /* witnessed elsewhere */ },
    log: () => { /* keep test output clean */ },
  };
}

const TURN = {
  ownerText: 'Please remember we decided the send button stays teal for the demo.',
  entries: VOICED_ENTRIES,
  model: 'anthropic/claude-fable-5',
};

describe('shadowCapture gates — default OFF, lockdown disables', () => {
  it('the env gate is off by default and the availability check follows it', () => {
    delete process.env[FLAG];
    expect(shadowCaptureEnabledByEnv()).toBe(false);
    expect(shadowCaptureAvailable(path.join(tmp, 'capability-mode.json'))).toBe(false);
  });

  it('env flag unset → ZERO side effects (no status file, no invoke, no throw)', async () => {
    delete process.env[FLAG];
    let invoked = 0;
    const o = overridesFor({ invoke: async () => { invoked++; return {}; } });
    await captureCompletedTurn(TURN, o);
    expect(invoked).toBe(0);
    expect(fs.existsSync(o.statusPath)).toBe(false);
  });

  it('lockdown → refuses at the dispatch point (status refused, no invoke)', async () => {
    process.env[FLAG] = '1';
    const modeFile = path.join(tmp, 'capability-mode.json');
    fs.writeFileSync(modeFile, JSON.stringify({ mode: 'lockdown', since: '2026-07-07T00:00:00Z' }));
    let invoked = 0;
    const o = overridesFor({ modeFile, invoke: async () => { invoked++; return {}; } });
    await captureCompletedTurn(TURN, o);
    expect(invoked).toBe(0);
    const status = readCaptureStatusSafe(o.statusPath);
    expect(status?.lastOutcome).toBe('refused');
    expect(status?.lastRefused).toContain('capture_lockdown_refused');
  });
});

describe('shadowCapture glue — fire-and-forget, loud honesty', () => {
  it('an injected failing writer never throws and records a refused status', async () => {
    process.env[FLAG] = '1';
    const o = overridesFor({ invoke: async () => { throw new Error('aumlok_mem_no_authority'); } });
    await expect(captureCompletedTurn(TURN, o)).resolves.toBeUndefined();
    const status = readCaptureStatusSafe(o.statusPath);
    expect(status?.lastOutcome).toBe('refused');
    expect(status?.lastRefused).toContain('aumlok_mem_no_authority');
    expect(status?.refusedCount).toBe(1);
    expect(status?.advisoryOnly).toBe(true);
    expect(status?.grantsAuthority).toBe(false);
  });

  it('a kernel-accepted turn records ok and counts persist across attempts', async () => {
    process.env[FLAG] = '1';
    const { createHash } = await import('crypto');
    const invoke = async (_n: string, payload: { req: Record<string, unknown>; value: string }) => {
      const req = payload.req as { ownerRootId: string; key: string };
      const memoryHash = createHash('sha256').update(`${req.ownerRootId}:${req.key}:${payload.value}`, 'utf8').digest('hex');
      return { ok: true, receiptHash: 'r'.repeat(16), memoryHash };
    };
    const o = overridesFor({ invoke: invoke as never });
    await captureCompletedTurn(TURN, o);
    const s1 = readCaptureStatusSafe(o.statusPath);
    expect(s1?.lastOutcome).toBe('ok');
    expect(s1?.okCount).toBe(1);
    await captureCompletedTurn(TURN, o);
    const s2 = readCaptureStatusSafe(o.statusPath);
    expect(s2?.okCount).toBe(2);
  });

  it('a successful write records the row key + truncated receipt, and the key SURVIVES a later refusal (proof ceremony reads it here)', async () => {
    process.env[FLAG] = '1';
    const { createHash } = await import('crypto');
    const receipt64 = 'a1b2c3d4'.repeat(8); // 64 hex — must be stored TRUNCATED
    const invoke = async (_n: string, payload: { req: Record<string, unknown>; value: string }) => {
      const req = payload.req as { ownerRootId: string; key: string };
      const memoryHash = createHash('sha256').update(`${req.ownerRootId}:${req.key}:${payload.value}`, 'utf8').digest('hex');
      return { ok: true, receiptHash: receipt64, memoryHash };
    };
    const o = overridesFor({ invoke: invoke as never });
    await captureCompletedTurn(TURN, o);
    const s1 = readCaptureStatusSafe(o.statusPath);
    expect(s1?.lastKey).toMatch(/^turn\.[a-z0-9]+\.\d+$/);
    expect(s1?.lastReceipt).toBeDefined();
    expect(s1?.lastReceipt).not.toContain(receipt64); // hex-truncated, never the full hash
    // a later refusal must not erase the last written key — the proof ceremony depends on it.
    const o2 = { ...o, invoke: (async () => { throw new Error('backend down'); }) as never };
    await captureCompletedTurn(TURN, o2);
    const s2 = readCaptureStatusSafe(o.statusPath);
    expect(s2?.lastOutcome).toBe('refused');
    expect(s2?.lastKey).toBe(s1?.lastKey);
    // and the armed truth note names the row so Settings shows it.
    const t = captureTruth({ enabled: true, status: s2 });
    expect(t.note).toContain(String(s1?.lastKey));
  });

  it('a turn with no voiced reply refuses honestly and writes nothing', async () => {
    process.env[FLAG] = '1';
    let invoked = 0;
    const o = overridesFor({ invoke: async () => { invoked++; return {}; } });
    await captureCompletedTurn({ ...TURN, entries: [{ kind: 'error', text: 'nope' }] }, o);
    expect(invoked).toBe(0);
    expect(readCaptureStatusSafe(o.statusPath)?.lastRefused).toContain('capture_no_reply_text');
  });
});

describe('extractVoiceReplyText — the voiced info entry, provenance-anchored', () => {
  it('finds the reply on the plain voiced shape', () => {
    expect(extractVoiceReplyText(VOICED_ENTRIES)).toContain('send button stays teal');
  });
  it('finds the reply on the RECOVERED shape (prefix tool_result first)', () => {
    const recovered = [
      { kind: 'tool_result', tool: 'voice', text: 'voice recovered after resetting volatile history' },
      { kind: 'info', text: 'the actual reply' },
      { kind: 'tool_result', tool: 'voice', text: 'voice: Fable · advisory' },
    ];
    expect(extractVoiceReplyText(recovered)).toBe('the actual reply');
  });
  it('returns null when no voiced pair exists (grammar/error turns are never captured)', () => {
    expect(extractVoiceReplyText([{ kind: 'error', text: 'unrecognized command' }])).toBe(null);
    expect(extractVoiceReplyText([])).toBe(null);
  });
});

describe('DOOR-WIRING pin — the capture call sits on the completed-voice-turn path', () => {
  const DOOR_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'chat-serve.ts'), 'utf-8');

  it('chat-serve.ts fires the capture AFTER the voiced turn completes (fire-and-forget)', () => {
    // The typed-chat wiring: search FORWARD from the voiceReply call — the presence handler now
    // also captures, EARLIER in the file (Auma Live memory fix, 2026-07-08), so first-occurrence
    // is no longer the right pin for the typed lane.
    const voiceIdx = DOOR_SRC.indexOf('voiceReply(ownerText, reqModel, images, attachments'); // prefix-matched (trailing opts like { context } may follow)
    const chatCallIdx = DOOR_SRC.indexOf('void captureCompletedTurn(', voiceIdx);
    expect(voiceIdx).toBeGreaterThan(-1);
    expect(chatCallIdx).toBeGreaterThan(voiceIdx);
  });

  it('the presence door captures too — a HEARD spoken turn routes into the SAME governed capture (Auma Live memory fix, 2026-07-08)', () => {
    const presIdx = DOOR_SRC.indexOf("'/api/presence/stream'");
    expect(presIdx).toBeGreaterThan(-1);
    // the hook lives inside the presence handler and rides into presenceStream, so a spoken turn
    // the owner actually HEARD becomes a governed row through the exact gates typed chat uses.
    const hookIdx = DOOR_SRC.indexOf('void captureCompletedTurn(', presIdx);
    expect(hookIdx).toBeGreaterThan(presIdx);
    const streamCallIdx = DOOR_SRC.indexOf('presenceStream(text, reqModel, req.signal', presIdx);
    expect(streamCallIdx).toBeGreaterThan(-1);
    expect(DOOR_SRC.slice(streamCallIdx, streamCallIdx + 160)).toContain('captureHeardTurn');
  });

  it('the capture is never awaited on the response path (void — chat cannot block on capture)', () => {
    expect(DOOR_SRC).not.toContain('await captureCompletedTurn');
  });

  it('capture is gated on a completed voice turn only (voicedTurn), not on every request', () => {
    expect(DOOR_SRC).toContain('if (voicedTurn) void captureCompletedTurn(');
  });
});

describe('WIRED-TRUTH — capture.wired follows the env flag; the note degrades, never throws', () => {
  it('wired is true ONLY with the flag armed', () => {
    expect(captureTruth({ enabled: true, status: null }).wired).toBe(true);
    expect(captureTruth({ enabled: false, status: null }).wired).toBe(false);
  });

  it('an armed lane with a refusing writer says so in the note (the card must never lie)', () => {
    const t = captureTruth({
      enabled: true,
      status: {
        schema: 'capture-status-v1', lastAttemptAt: '2026-07-07T12:00:00Z', lastOutcome: 'refused',
        lastRefused: 'admin_key_permissions_open', okCount: 0, refusedCount: 3,
        advisoryOnly: true, grantsAuthority: false,
      },
    });
    expect(t.wired).toBe(true);
    expect(t.note).toContain('refused');
    expect(t.note).toContain('admin_key_permissions_open');
  });

  it('a missing/unreadable status file degrades the note without throwing', () => {
    expect(readCaptureStatusSafe(path.join(tmp, 'absent.json'))).toBe(null);
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, 'not json at all {{{');
    expect(readCaptureStatusSafe(bad)).toBe(null);
    const t = captureTruth({ enabled: true, status: null });
    expect(t.wired).toBe(true);
    expect(t.note).toContain('no capture attempt recorded yet');
  });

  it('every truth wording holds the post-cutover R5b line: Convex default, JSON archived behind the labeled hatch', () => {
    for (const t of [captureTruth({ enabled: true, status: null }), captureTruth({ enabled: false, status: null })]) {
      expect(t.note).toContain('Convex brain by default');
      expect(t.note).toContain('R5b');
      expect(t.note).toContain('kira-json-legacy'); // the archived brain is named ONLY as the explicit hatch
    }
  });
});

describe('recall-source pin — the R5b step-4 cutover boundary', () => {
  it('/api/brain serves recall source convex by default; the JSON brain appears only as the labeled legacy hatch', () => {
    const SERVE_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'serve.ts'), 'utf-8');
    expect(SERVE_SRC).toContain("source: 'convex'");
    expect(SERVE_SRC).toContain("source: 'kira-json-legacy'");
    // the unlabeled kira-json default is GONE — only the -legacy literal may remain
    expect(SERVE_SRC.replace(/kira-json-legacy/g, '')).not.toContain("source: 'kira-json'");
  });
});
