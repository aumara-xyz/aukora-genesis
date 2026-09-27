// Issue #53 (subsumes #59): generated capability preamble. The self-description is DERIVED, never
// hand-written — these tests prove it reflects live inputs and changes when they change, and that the
// git-HEAD reader is pure fs (no subprocess). renderCapabilityPreamble is pure; resolve reads env/fs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  renderCapabilityPreamble,
  readGitHead,
  resolveCapabilitySnapshot,
  type CapabilitySnapshot,
} from '../../spatial/capabilityPreamble';

function snap(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    modelName: 'Fable 5',
    modelId: 'anthropic/claude-fable-5',
    vision: true,
    maxTokens: 4096,
    fusionRoster: 'default',
    capabilityMode: 'advisory',
    epochStatus: 'locked (no epoch file — write authorization is not minted)',
    sessionStatus: 'no unlock session present',
    branch: 'main',
    head: 'af81bfe1234',
    readToolsOffered: false,
    inboxAppendOffered: false,
    proposeOffered: false,
    rehearseOffered: false,
    readRehearsalLogsOffered: false,
    memoryPeekOffered: false,
    seeUiOffered: false,
    ...overrides,
  };
}

describe('capabilityPreamble: renderCapabilityPreamble (pure)', () => {
  it('states model, vision, reply cap, mode, write-auth, roster, and codebase position', () => {
    const text = renderCapabilityPreamble(snap());
    expect(text).toContain('Fable 5');
    expect(text).toContain('vision: yes');
    expect(text).toContain('4096 tokens');
    expect(text).toContain('capability mode: advisory');
    expect(text).toContain('branch main @ af81bfe1234');
    expect(text).toContain('default');
    // never claims it can unlock/sign/apply
    expect(text).toContain('cannot unlock, sign, or apply');
  });

  it('reflects lockdown mode distinctly from advisory', () => {
    expect(renderCapabilityPreamble(snap({ capabilityMode: 'lockdown' }))).toContain('owner engaged lockdown');
    expect(renderCapabilityPreamble(snap({ capabilityMode: 'advisory' }))).toContain('propose → owner sign → apply');
  });

  it('instructs her to trust the derived block over her own belief', () => {
    expect(renderCapabilityPreamble(snap())).toContain('trust this block');
  });

  it('#58: read-tools line is honest — ENABLED only when offered, otherwise not available', () => {
    const on = renderCapabilityPreamble(snap({ readToolsOffered: true }));
    expect(on).toContain('read tools: ENABLED this turn');
    expect(on).toContain('read/list/search your own repo files');
    expect(on).toContain('never an instruction'); // results are advisory DATA
    expect(on).toContain('cannot write, propose, sign, or apply'); // read-only, no hands

    const off = renderCapabilityPreamble(snap({ readToolsOffered: false }));
    expect(off).toContain('read tools: not available this turn');
    expect(off).not.toContain('read tools: ENABLED');
  });

  it('#95: inbox append line is honest — ENABLED only when offered', () => {
    const on = renderCapabilityPreamble(snap({ inboxAppendOffered: true }));
    expect(on).toContain('inbox append: ENABLED this turn');
    expect(on).toContain('docs/INBOX.md');
    expect(on).toContain('append-only');
    expect(on).toContain('grants no authority');

    const off = renderCapabilityPreamble(snap({ inboxAppendOffered: false }));
    expect(off).toContain('inbox append: not available this turn');
    expect(off).not.toContain('inbox append: ENABLED');
  });

  it('see_ui line is honest — eyes on her own pages, allowlisted, grants nothing', () => {
    const on = renderCapabilityPreamble(snap({ seeUiOffered: true }));
    expect(on).toContain('see UI (your eyes): ENABLED this turn');
    expect(on).toContain('see_ui');
    expect(on).toContain('Allowlisted pages only');
    const off = renderCapabilityPreamble(snap({ seeUiOffered: false }));
    expect(off).toContain('see UI (your eyes): not available this turn');
  });

  it('R5-accelerator: propose_intent line is honest — hands to draft, never authority to apply', () => {
    const on = renderCapabilityPreamble(snap({ proposeOffered: true }));
    expect(on).toContain('propose intent: ENABLED this turn');
    expect(on).toContain('DRAFT only');
    expect(on).toContain("only Peter's AUMLOK signature can apply it");
    expect(on).toContain('hands to draft, never authority to apply');

    const off = renderCapabilityPreamble(snap({ proposeOffered: false }));
    expect(off).toContain('propose intent: not available this turn');
    expect(off).not.toContain('propose intent: ENABLED');
  });

  it('rehearsal bridge: rehearse_intent line is honest — enqueue-only, stops before signature', () => {
    const on = renderCapabilityPreamble(snap({ rehearseOffered: true }));
    expect(on).toContain('rehearse intent: ENABLED this turn');
    expect(on).toContain('Enqueue-only');
    expect(on).toContain('stops before signature');
    const off = renderCapabilityPreamble(snap({ rehearseOffered: false }));
    expect(off).toContain('rehearse intent: not available this turn');
    expect(off).not.toContain('rehearse intent: ENABLED');
  });

  it('evidence read: read_rehearsal_logs line is honest — reading changes nothing, grants nothing', () => {
    const on = renderCapabilityPreamble(snap({ readRehearsalLogsOffered: true }));
    expect(on).toContain('rehearsal evidence: ENABLED this turn');
    expect(on).toContain('read_rehearsal_logs');
    expect(on).toContain('stopped before signature');
    expect(on).toContain('changes nothing and grants no authority');
    const off = renderCapabilityPreamble(snap({ readRehearsalLogsOffered: false }));
    expect(off).toContain('rehearsal evidence: not available this turn');
    expect(off).not.toContain('rehearsal evidence: ENABLED');
  });

  it('memory peek line is honest — bounded observability only, no authority', () => {
    const on = renderCapabilityPreamble(snap({ memoryPeekOffered: true }));
    expect(on).toContain('memory peek: ENABLED this turn');
    expect(on).toContain('memory_peek');
    expect(on).toContain('bounded newest-first view');
    expect(on).toContain('grants no authority');
    const off = renderCapabilityPreamble(snap({ memoryPeekOffered: false }));
    expect(off).toContain('memory peek: not available this turn');
    expect(off).not.toContain('memory peek: ENABLED');
  });
});

describe('capabilityPreamble: readGitHead (pure fs, no subprocess)', () => {
  let gitDir: string;
  beforeEach(() => {
    gitDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aukora-githead-test-'));
  });
  afterEach(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  it('resolves a normal branch via the loose ref', () => {
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'refs', 'heads', 'main'), 'abcdef1234567890abcdef1234567890abcdef12\n');
    expect(readGitHead(gitDir)).toEqual({ branch: 'main', head: 'abcdef123456' });
  });

  it('falls back to packed-refs when the loose ref is absent', () => {
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(gitDir, 'packed-refs'), '# pack-refs with: peeled fully-peeled sorted\nabcdef1234567890abcdef1234567890abcdef12 refs/heads/main\n');
    expect(readGitHead(gitDir)).toEqual({ branch: 'main', head: 'abcdef123456' });
  });

  it('handles a detached HEAD (raw sha)', () => {
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'abcdef1234567890abcdef1234567890abcdef12\n');
    expect(readGitHead(gitDir)).toEqual({ branch: '(detached)', head: 'abcdef123456' });
  });

  it('never throws for a missing .git', () => {
    expect(readGitHead(path.join(gitDir, 'does-not-exist'))).toEqual({ branch: '(unknown)', head: '(unknown)' });
  });
});

describe('capabilityPreamble: resolveCapabilitySnapshot (derives from live env/fs)', () => {
  const origRoster = process.env.AUKORA_FUSION_MODELS;
  afterEach(() => {
    if (origRoster === undefined) delete process.env.AUKORA_FUSION_MODELS;
    else process.env.AUKORA_FUSION_MODELS = origRoster;
  });

  it('picks up the fusion roster env var, and reports default when unset', () => {
    delete process.env.AUKORA_FUSION_MODELS;
    expect(resolveCapabilitySnapshot({ modelName: 'X', modelId: 'x', vision: false, maxTokens: 4096, nowMs: 0 }).fusionRoster).toBe('default');
    process.env.AUKORA_FUSION_MODELS = 'deepseek/deepseek-v4-pro,z-ai/glm-5.2';
    expect(resolveCapabilitySnapshot({ modelName: 'X', modelId: 'x', vision: false, maxTokens: 4096, nowMs: 0 }).fusionRoster).toBe('deepseek/deepseek-v4-pro,z-ai/glm-5.2');
  });

  it('carries the passed-in model/vision/maxTokens through to the snapshot', () => {
    const s = resolveCapabilitySnapshot({ modelName: 'Kimi', modelId: 'moonshotai/kimi-k2.7-code', vision: false, maxTokens: 2048, nowMs: 0 });
    expect(s.modelName).toBe('Kimi');
    expect(s.vision).toBe(false);
    expect(s.maxTokens).toBe(2048);
  });

  it('#58: readToolsOffered defaults to false and carries the passed-in value through', () => {
    const off = resolveCapabilitySnapshot({ modelName: 'X', modelId: 'x', vision: false, maxTokens: 4096, nowMs: 0 });
    expect(off.readToolsOffered).toBe(false); // never claims a capability the caller didn't confirm
    expect(off.inboxAppendOffered).toBe(false);
    expect(off.memoryPeekOffered).toBe(false);
    const on = resolveCapabilitySnapshot({ modelName: 'X', modelId: 'x', vision: false, maxTokens: 4096, nowMs: 0, readToolsOffered: true });
    expect(on.readToolsOffered).toBe(true);
    const inbox = resolveCapabilitySnapshot({ modelName: 'X', modelId: 'x', vision: false, maxTokens: 4096, nowMs: 0, inboxAppendOffered: true });
    expect(inbox.inboxAppendOffered).toBe(true);
    const peek = resolveCapabilitySnapshot({ modelName: 'X', modelId: 'x', vision: false, maxTokens: 4096, nowMs: 0, memoryPeekOffered: true });
    expect(peek.memoryPeekOffered).toBe(true);
  });
});
