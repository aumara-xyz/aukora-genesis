// φ · FORGETTING DID NOT REACH THE BLOCK SHE ACTUALLY READS.
//
// ══ CODEX'S MEASUREMENT, REPRODUCED ══
//
//     {"governedBeforeForget":1,"governedAfterForget":0,"mindBlockStillContainedForgottenText":true}
//
// The record was forgotten. Governed recall stopped returning it. And `mindBlock` still carried the
// text, because `mindBlock` never asked governed recall for it:
//
//     const profile = (await readSafe(PROFILE())).slice(0, 1200);   // raw file
//     const arc     = (await readSafe(ARC())).slice(0, 1500);       // raw file
//     const facts   = (await readSafe(FACTS())).slice(0, 2000);     // raw file
//     const retrieved = query ? await retrieve(query, 10) : [];     // the ONLY governed part
//
// So forgetting, consent and containment governed one subsection of four. Three quarters of what
// reaches the voice came straight off disk, and `forget()` was a promise about the smallest quarter.
//
// ══ AND THE ONE PATH THAT WAS GOVERNED FAILED OPEN ══
//
//     } catch {
//       return retrieveUngoverned(query, limit);
//     }
//
// Its own comment argues correctly that an EMPTY governed result must not fall through — and then a
// THROW falls through, into a scorer that reads the same raw files with no forgetting, no consent and
// no containment. A fail-open in the one path whose entire job is to fail closed. Any exception
// anywhere under `governedRecall` — a malformed receipt, a permissions error — silently restored the
// pre-#109 behaviour, and the only signal was that answers got better.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let repo = '';
let prior: string | undefined;

const MEMDIR = () => join(repo, '.aukora', 'memory');

const SECRET = 'the owner takes lithium for bipolar II';
const KEPT = 'the owner prefers tabs over spaces';

function seed() {
  repo = mkdtempSync(join(tmpdir(), 'phi-mind-'));
  mkdirSync(MEMDIR(), { recursive: true });
  // The secret goes in PROFILE — the section `mindBlock` reads raw and `retrieve` never touched.
  writeFileSync(join(MEMDIR(), 'profile.md'), `# profile\n${SECRET}\n${KEPT}\n`, 'utf8');
  writeFileSync(join(MEMDIR(), 'facts.md'), '# facts\nthe node is called phi\n', 'utf8');
  writeFileSync(join(MEMDIR(), 'session-arc.md'), '# arc\nthe owner asked for a teal theme\n', 'utf8');
  prior = process.env.AUKORA_FORGE_REPO;
  process.env.AUKORA_FORGE_REPO = repo;
}

beforeEach(() => { seed(); });
afterEach(() => {
  if (prior === undefined) delete process.env.AUKORA_FORGE_REPO; else process.env.AUKORA_FORGE_REPO = prior;
  try { rmSync(repo, { recursive: true, force: true }); } catch { /* gone */ }
});

/** Forget the record whose content is `text`, through the governed path, and return its id. */
async function forgetByContent(text: string): Promise<string> {
  const g = await import('../surface/mind/governedRecall');
  const records = await g.gatherRecords();
  const rec = records.find((r) => r.content.includes(text));
  if (!rec) throw new Error(`no governed record carries ${JSON.stringify(text)} — the fixture is wrong`);
  await g.forget(rec.recordId);
  return rec.recordId;
}

describe('CODEX\'S MEASUREMENT, as a test', () => {
  it('forgetting reaches the block she actually reads', async () => {
    const mind = await import('../surface/mind/memory');
    const g = await import('../surface/mind/governedRecall');

    const before = await g.governedRecall(SECRET, { limit: 16 });
    expect(before.hits.length, 'the fixture never got the secret into governed recall').toBe(1);
    expect(await mind.mindBlock(SECRET)).toContain(SECRET);

    await forgetByContent(SECRET);

    const after = await g.governedRecall(SECRET, { limit: 16 });
    expect(after.hits.length, 'governed recall still returns a forgotten record').toBe(0);

    // THE ASSERTION THAT WAS FALSE. Codex measured `mindBlockStillContainedForgottenText: true`.
    const block = await mind.mindBlock(SECRET);
    expect(block, 'a forgotten memory is still in the block handed to the voice').not.toContain(SECRET);
  });

  it('…and with NO query at all, which is the path that was never governed for one instant', async () => {
    // `retrieved` is `query ? await retrieve(...) : []`. With no query the governed part is empty and
    // the block is three raw files, so this is the case where forgetting did literally nothing.
    const mind = await import('../surface/mind/memory');
    await forgetByContent(SECRET);
    const block = await mind.mindBlock();
    expect(block).not.toContain(SECRET);
  });

  it('forgetting one line does not erase the rest of the shelf', async () => {
    const mind = await import('../surface/mind/memory');
    await forgetByContent(SECRET);
    const block = await mind.mindBlock();
    expect(block, 'forgetting took the whole profile with it').toContain(KEPT);
    expect(block).toContain('the node is called phi');
    expect(block).toContain('the owner asked for a teal theme');
  });

  it('the block is still a block — the sections survive the rewrite', async () => {
    const mind = await import('../surface/mind/memory');
    const block = await mind.mindBlock('teal');
    expect(block).toMatch(/\[MIND/);
    expect(block).toMatch(/## Profile/);
    expect(block).toMatch(/## Facts/);
    expect(block).toMatch(/Session arc/);
    expect(block.length).toBeLessThanOrEqual(7000);
  });
});

describe('the governed path fails CLOSED', () => {
  it('there is no ungoverned scorer left to fall back to', async () => {
    // Removing the fallback and leaving the function is how it comes back: the next exception handler
    // written in this file finds a ready-made "just read the files" helper sitting there.
    const { codeOnly } = await import('./code-only');
    const src = codeOnly(readFileSync(join(import.meta.dir, '..', 'surface', 'mind', 'memory.ts'), 'utf8'));
    expect(src, 'the ungoverned scorer is still callable').not.toMatch(/retrieveUngoverned/);
  });

  it('a throw under governed recall yields NOTHING, never raw files', async () => {
    // Forced by pointing the module at a memory root it cannot read. Whatever fails, the answer may
    // not be the contents of profile.md.
    const mind = await import('../surface/mind/memory');
    const saved = process.env.AUKORA_FORGE_REPO;
    try {
      // A path that exists as a FILE where a directory is expected — reads throw rather than 404.
      const wrong = join(repo, 'not-a-repo');
      writeFileSync(wrong, 'x', 'utf8');
      process.env.AUKORA_FORGE_REPO = wrong;
      const hits = await mind.retrieve(SECRET, 10);
      expect(hits.every((h) => !h.includes(SECRET))).toBe(true);
    } finally {
      process.env.AUKORA_FORGE_REPO = saved;
    }
  });

  it('an empty governed result is still an honest empty shelf', async () => {
    // The rule the old comment got right, kept: nothing found is an answer, not a reason to widen.
    const mind = await import('../surface/mind/memory');
    const hits = await mind.retrieve('a phrase that appears nowhere at all zzzq', 10);
    expect(hits).toEqual([]);
  });
});

describe('what the block may contain at all', () => {
  it('every line in it came through a governed record', async () => {
    // The structural claim, checked against the records themselves rather than against the prose: a
    // sentence in the block that no governed record carries has come from somewhere ungoverned.
    const mind = await import('../surface/mind/memory');
    const g = await import('../surface/mind/governedRecall');
    const forgotten = await g.forgottenIds();
    const allowed = (await g.gatherRecords())
      .filter((r) => !forgotten.has(r.recordId))
      .map((r) => r.content.trim());

    const block = await mind.mindBlock('teal');
    const lines = block.split('\n')
      .map((l) => l.replace(/^-\s*/, '').replace(/^\[[a-z-]+\]\s*/i, '').trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('[MIND') && !l.startsWith('[Do NOT'));

    const orphans = lines.filter((l) => !allowed.some((a) => a.includes(l) || l.includes(a)));
    expect(orphans, `lines in the block with no governed record behind them: ${orphans.join(' | ')}`)
      .toHaveLength(0);
  });

  it('the memory directory really was the source, so this is not passing on an empty tree', () => {
    expect(existsSync(join(MEMDIR(), 'profile.md'))).toBe(true);
  });
});
