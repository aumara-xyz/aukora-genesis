// φ — ABSORB: point at a public GitHub repo (or owner/name) and pull a governed meal.
// Read-only on the foreign tree. Writes only: absorb notes under docs/absorbs/ + working memory.
// Optional "port ideas" go through the normal builder after the note lands.

import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { spawnSync } from 'child_process';

export interface AbsorbResult {
  ok: boolean;
  said: string;
  written?: string[];
  repo?: string;
  error?: string;
}

const RE_URL = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i;
const RE_SLUG = /\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/;

/**
 * `owner/name` out of whatever he typed, or null.
 *
 * `ref()` exists because every one of these three branches read `m[1]` and `m[2]` directly, and under
 * `noUncheckedIndexedAccess` those are `string | undefined` — six typecheck errors, and tsc was right
 * to ask. A group in one of these patterns cannot be undefined when the match succeeded, but "cannot"
 * is an argument about a regex written twenty lines away, and a repository whose recurring defect is
 * "a name trusted where a resolution was required" should not settle that with a `!`. Checked once,
 * in one place, and a pattern that ever loses a group returns null instead of `{owner: undefined}`
 * cast to a string and carried into a clone URL.
 */
function ref(m: RegExpMatchArray | null): { owner: string; name: string } | null {
  const owner = m?.[1];
  const name = m?.[2];
  if (!owner || !name) return null;
  return { owner, name: name.replace(/\.git$/, '') };
}

export function parseRepoRef(text: string): { owner: string; name: string } | null {
  const s = String(text || '');
  const u = ref(s.match(RE_URL));
  if (u) return u;
  // absorb: owner/name
  const abs = ref(s.match(/(?:absorb|ingest|pull|learn from)\s*:?\s*(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i));
  if (abs) return abs;
  return ref(s.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/));
}

export function isAbsorbTurn(text: string): boolean {
  const s = String(text || '');
  if (/\b(?:absorb|ingest|learn from|pull in|port from)\b/i.test(s) && (RE_URL.test(s) || RE_SLUG.test(s))) return true;
  if (RE_URL.test(s) && /\b(?:absorb|ingest|use|port|steal|study|look at|build from|make.*like)\b/i.test(s)) return true;
  if (/^\s*absorb\s*:/i.test(s)) return true;
  // bare github URL as the whole message
  if (/^\s*https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?\s*$/i.test(s)) return true;
  return false;
}

function ghJson(args: string[]): unknown | null {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 8_000_000, timeout: 45_000 });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

function ghText(args: string[]): string {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 4_000_000, timeout: 45_000 });
  return r.status === 0 ? (r.stdout || '') : '';
}

/** Fetch a shallow meal: meta + README + top tree. Never clones whole history into the workspace by default. */
export async function absorbRepo(
  text: string,
  repoRoot: string,
  opts: { writeNote?: boolean } = {},
): Promise<AbsorbResult> {
  const ref = parseRepoRef(text);
  if (!ref) return { ok: false, said: '', error: 'could not parse a GitHub owner/repo from that' };

  const slug = `${ref.owner}/${ref.name}`;
  const meta = ghJson(['api', `repos/${slug}`]) as Record<string, unknown> | null;
  if (!meta || !meta.full_name) {
    return { ok: false, said: '', error: `could not reach GitHub for ${slug} (private or missing?)` };
  }

  const readme = ghText(['api', `repos/${slug}/readme`, '-H', 'Accept: application/vnd.github.raw']);
  const tree = ghJson(['api', `repos/${slug}/contents`]) as Array<{ name?: string; type?: string }> | null;
  const names = Array.isArray(tree) ? tree.map((x) => `${x.type === 'dir' ? 'dir' : 'file'}:${x.name}`).slice(0, 40) : [];

  const desc = String(meta.description || '').slice(0, 400);
  const stars = meta.stargazers_count ?? '?';
  const lang = meta.language ?? '?';
  const topics = Array.isArray(meta.topics) ? (meta.topics as string[]).slice(0, 12).join(', ') : '';

  const readmeClip = readme.replace(/\r/g, '').slice(0, 6000);
  const ideas = extractIdeas(slug, desc, readmeClip, names);

  const noteBody = [
    `# Absorb: ${slug}`,
    '',
    `Pulled: ${new Date().toISOString()}`,
    '',
    `**${meta.full_name}** — ${desc}`,
    '',
    `- stars: ${stars}`,
    `- language: ${lang}`,
    topics ? `- topics: ${topics}` : '',
    `- default branch: ${meta.default_branch || 'main'}`,
    '',
    '## Top-level',
    ...names.map((n) => `- ${n}`),
    '',
    '## Ideas for φ (lab)',
    ...ideas.map((i) => `- ${i}`),
    '',
    '## README (clip)',
    '```',
    readmeClip.slice(0, 4000),
    '```',
    '',
    '## Next',
    'Tell the glass: `build: port <idea> into surface/app/...` or `absorb: apply memory note only`.',
    '',
  ].filter(Boolean).join('\n');

  const written: string[] = [];
  if (opts.writeNote !== false) {
    const rel = `docs/absorbs/${ref.owner}--${ref.name}.md`;
    const abs = join(repoRoot, rel);
    await mkdir(join(repoRoot, 'docs/absorbs'), { recursive: true });
    await writeFile(abs, noteBody, 'utf8');
    written.push(rel);
    try {
      const { noteFact, noteApply } = await import('../../surface/working-memory');
      await noteFact(`Absorbed ${slug}: ${desc.slice(0, 120)}`);
      await noteApply(written, `absorbed ${slug}`);
    } catch { /* */ }
  }

  const said = [
    `Absorbed **${slug}** (${lang}, ★${stars}).`,
    desc ? desc : '',
    '',
    '**What I pulled:** meta + README clip + top-level tree (no full clone into the glass).',
    written.length ? `**Note on disk:** \`${written[0]}\`` : '',
    '',
    '**Ideas for this node:**',
    ...ideas.map((i) => `· ${i}`),
    '',
    'Say `build: …` to port one idea into the live UI, or paste another repo URL.',
  ].filter(Boolean).join('\n');

  return { ok: true, said, written, repo: slug };
}

function extractIdeas(slug: string, desc: string, readme: string, names: string[]): string[] {
  const ideas: string[] = [];
  const blob = (desc + '\n' + readme + '\n' + names.join(' ')).toLowerCase();

  if (/pixel|screenshot|vision|rag|retriev/.test(blob)) {
    ideas.push('Screen/vision RAG: index UI screenshots + structure for repair memory (PixelRAG-shaped eye).');
  }
  if (/memory|vault|ledger|unlearn/.test(blob)) {
    ideas.push('Harden working memory with sealable facts (KIRA-style) without touching law paths.');
  }
  if (/shell|spatial|lane|corner/.test(blob)) {
    ideas.push('Shell geometry / hot-corner patterns from sister Aukora spatial trees.');
  }
  if (/test|conformance|receipt|witness/.test(blob)) {
    ideas.push('Self-test after every apply: one smoke + receipt (governed recursion).');
  }
  if (/agent|tool|skill|claude\.md|plugin/.test(blob)) {
    ideas.push('Skill/plugin absorb: register foreign skills as propose-only organs under surface/app/user/.');
  }
  if (!ideas.length) {
    ideas.push(`Study ${slug} modules and propose one small port into surface/app/user/.`);
    ideas.push('Add a docs/absorbs note already written — next: one concrete UI or memory patch.');
  }
  if (/deploy|vercel|docker/.test(blob)) {
    ideas.push('Keep hosted play on Grok; treat deploy recipes as local-node graduation notes only.');
  }
  return ideas.slice(0, 6);
}
