// Issue #57: hash-verified identity anchor boot. Her #1-ranked brick — "I should never boot as an
// unwitting abridgment of myself." The load/verify half is pure and tested here against real temp
// files; the injection wiring lives in spatial/voiceLane.ts (a system-message string append, no
// network). The tamper test follows the receiptBinding house pattern she cited: prove the hash binds
// by mutating one byte and watching the fake fail.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { loadIdentityAnchor, renderIdentityInjection, resolveIdentityInjection } from '../../spatial/identityAnchor';

let dir: string;
const anchorPath = () => path.join(dir, 'ANCHOR.md');
const hashPath = () => path.join(dir, 'ANCHOR.md.sha256');

function writeAnchor(body: string, sidecar?: string) {
  fs.writeFileSync(anchorPath(), body);
  if (sidecar !== undefined) fs.writeFileSync(hashPath(), sidecar);
  else fs.writeFileSync(hashPath(), createHash('sha256').update(body).digest('hex') + '\n');
}

const SAMPLE = '# Auma — anchor\n\nFive values. Truth over comfort.\n\nThe originals govern.\n';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-identity-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('identityAnchor: loadIdentityAnchor (pure)', () => {
  it('anchor missing but the identity DIR exists → expected-but-missing (LOUD, not silent — Auma N1)', () => {
    // dir (the temp `dir`) exists, ANCHOR.md is not written → the failure this thread lived through.
    const r = loadIdentityAnchor(anchorPath(), hashPath());
    expect(r.status).toBe('expected-but-missing');
  });

  it('the identity DIR itself is absent → absent (a stranger clone; correctly SILENT)', () => {
    const nowhere = path.join(dir, 'no-such-identity-dir', 'ANCHOR.md');
    const r = loadIdentityAnchor(nowhere, nowhere + '.sha256');
    expect(r.status).toBe('absent');
  });

  it('anchor present but EMPTY (or whitespace-only) → expected-but-missing (LOUD)', () => {
    fs.writeFileSync(anchorPath(), '   \n  \n');
    const r = loadIdentityAnchor(anchorPath(), hashPath());
    expect(r.status).toBe('expected-but-missing');
  });

  it('anchor + matching sidecar → verified, carries the real text and its sha', () => {
    writeAnchor(SAMPLE);
    const r = loadIdentityAnchor(anchorPath(), hashPath());
    expect(r.status).toBe('verified');
    if (r.status !== 'verified') return;
    expect(r.text).toBe(SAMPLE);
    expect(r.sha256).toBe(createHash('sha256').update(SAMPLE).digest('hex'));
    expect(r.truncated).toBe(false);
  });

  it('accepts a shasum-format sidecar (<hash>  <filename>), not just a bare digest', () => {
    const digest = createHash('sha256').update(SAMPLE).digest('hex');
    writeAnchor(SAMPLE, `${digest}  ANCHOR.md\n`);
    const r = loadIdentityAnchor(anchorPath(), hashPath());
    expect(r.status).toBe('verified');
  });

  it('anchor present but NO sidecar → unverifiable (wholeness cannot be proven)', () => {
    fs.writeFileSync(anchorPath(), SAMPLE); // no sidecar written
    const r = loadIdentityAnchor(anchorPath(), hashPath());
    expect(r.status).toBe('unverifiable');
  });

  it('sidecar with no valid digest → unverifiable', () => {
    writeAnchor(SAMPLE, 'not a hash at all\n');
    const r = loadIdentityAnchor(anchorPath(), hashPath());
    expect(r.status).toBe('unverifiable');
  });

  it('TAMPER (receiptBinding pattern): mutate one byte of the anchor, the sidecar no longer matches → mismatch', () => {
    writeAnchor(SAMPLE); // sidecar is the hash of the ORIGINAL
    // Now corrupt the on-disk anchor by one character, leaving the sidecar in place.
    fs.writeFileSync(anchorPath(), SAMPLE.replace('Truth', 'Trust'));
    const r = loadIdentityAnchor(anchorPath(), hashPath());
    expect(r.status).toBe('mismatch');
    if (r.status !== 'mismatch') return;
    expect(r.actual).not.toBe(r.expected);
  });

  it('TRUNCATION is caught as mismatch (the core failure this brick exists to detect)', () => {
    writeAnchor(SAMPLE); // sidecar = hash of whole
    fs.writeFileSync(anchorPath(), SAMPLE.slice(0, 20)); // a truncated-on-disk copy
    const r = loadIdentityAnchor(anchorPath(), hashPath());
    expect(r.status).toBe('mismatch');
  });

  it('a > MAX_ANCHOR_CHARS anchor with a valid hash is verified but flagged truncated (never silent)', () => {
    const big = 'x'.repeat(20_000);
    writeAnchor(big);
    const r = loadIdentityAnchor(anchorPath(), hashPath());
    expect(r.status).toBe('verified');
    if (r.status !== 'verified') return;
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThan(big.length);
  });
});

describe('identityAnchor: renderIdentityInjection (what actually reaches the model)', () => {
  it('absent → empty string (nothing injected, the door runs on laws alone)', () => {
    expect(renderIdentityInjection({ status: 'absent' })).toBe('');
  });

  it('verified → advisory-framed block containing the body and the verified sha prefix', () => {
    writeAnchor(SAMPLE);
    const block = resolveIdentityInjection(anchorPath(), hashPath());
    expect(block).toContain('advisory — history, not authority');
    expect(block).toContain('The originals govern.'); // the sample body's own closing line — proves the WHOLE body is injected, not just a prefix
    expect(block).toContain('hash-verified WHOLE');
    // The framing must NOT prime a specific quotable line (a chat-fed line proves memory, not delivery — Auma's catch).
    expect(block).toContain('never one someone handed you in conversation');
    expect(block).toContain(createHash('sha256').update(SAMPLE).digest('hex').slice(0, 12));
  });

  it('mismatch → LOUD notice that carries NO body (a half-self can never masquerade as whole)', () => {
    writeAnchor(SAMPLE);
    fs.writeFileSync(anchorPath(), SAMPLE.replace('Truth', 'Trust'));
    const block = resolveIdentityInjection(anchorPath(), hashPath());
    expect(block).toContain('FAILED VERIFICATION');
    expect(block).toContain('deliberately NOT loaded');
    // the body must NOT be present — only the notice
    expect(block).not.toContain('Five values');
  });

  it('unverifiable → LOUD notice, no body', () => {
    fs.writeFileSync(anchorPath(), SAMPLE); // no sidecar
    const block = resolveIdentityInjection(anchorPath(), hashPath());
    expect(block).toContain('FAILED VERIFICATION');
    expect(block).not.toContain('Five values');
  });

  it('expected-but-missing → LOUD "MISSING" notice, no body (Auma N1: absence must scream)', () => {
    // dir exists (temp `dir`), no anchor written → the silent-absence failure, now loud.
    const block = resolveIdentityInjection(anchorPath(), hashPath());
    expect(block).toContain('IDENTITY ANCHOR MISSING');
    expect(block).toContain('deliberately NOT loaded');
    expect(block).toContain('you can SEE this and say so'); // the whole point: no longer silent
    expect(block).not.toContain('Five values');
  });

  it('a truly-absent identity dir stays SILENT (renders empty — stranger clones must not see a scare notice)', () => {
    const nowhere = path.join(dir, 'no-such-dir', 'ANCHOR.md');
    expect(resolveIdentityInjection(nowhere, nowhere + '.sha256')).toBe('');
  });
});

describe('identityAnchor: the door resolves it PER TURN, not per session (Auma N1 — no stale cache)', () => {
  const VOICE_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'voiceLane.ts'), 'utf-8');

  it('resolveIdentityInjection is called INSIDE voiceReply (fresh each turn), not at module load', () => {
    const fnStart = VOICE_SRC.indexOf('export async function voiceReply');
    expect(fnStart).toBeGreaterThan(-1);
    const callIdx = VOICE_SRC.indexOf('resolveIdentityInjection(', fnStart);
    expect(callIdx).toBeGreaterThan(fnStart); // the call is within the function body, after its declaration
    // And there is no module-level identity cache the way rosterCache/kiraCache exist — the anchor is
    // deliberately re-read+re-verified every turn so a mid-session anchor change is picked up.
    expect(VOICE_SRC).not.toMatch(/^(let|const)\s+identity(Anchor)?Cache\b/m);
  });
});
