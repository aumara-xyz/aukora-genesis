// φ — SIMPLE WORKING MEMORY: facts, last apply, rolling conversation summary.

import { existsSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

function root() {
  return process.env.AUKORA_FORGE_REPO
    ?? join(new URL('..', import.meta.url).pathname);
}

const PATH = () => join(root(), '.aukora', 'working-memory.json');

export interface WorkingMem {
  facts: string[];
  /** Short rolling summary of the session arc. */
  summary: string;
  lastApply?: { files: string[]; note: string; at: number };
  updatedAt: number;
}

const MAX_FACTS = 32;

async function load(): Promise<WorkingMem> {
  try {
    if (!existsSync(PATH())) return { facts: [], summary: '', updatedAt: 0 };
    const j = JSON.parse(await readFile(PATH(), 'utf8')) as WorkingMem;
    return {
      facts: Array.isArray(j.facts) ? j.facts.map(String).slice(-MAX_FACTS) : [],
      summary: typeof j.summary === 'string' ? j.summary.slice(0, 2000) : '',
      lastApply: j.lastApply,
      updatedAt: Number(j.updatedAt) || 0,
    };
  } catch {
    return { facts: [], summary: '', updatedAt: 0 };
  }
}

async function save(m: WorkingMem): Promise<void> {
  try {
    await mkdir(dirname(PATH()), { recursive: true });
    await writeFile(PATH(), JSON.stringify(m, null, 2), 'utf8');
  } catch { /* best effort */ }
}

export async function noteFact(fact: string): Promise<void> {
  const f = String(fact || '').trim().slice(0, 280);
  if (!f) return;
  const m = await load();
  m.facts = [...m.facts.filter((x) => x !== f), f].slice(-MAX_FACTS);
  m.updatedAt = Date.now();
  await save(m);
}

export async function noteApply(files: string[], note: string): Promise<void> {
  const m = await load();
  m.lastApply = {
    files: (files || []).map(String).slice(0, 20),
    note: String(note || '').slice(0, 280),
    at: Date.now(),
  };
  const line = `Applied: ${m.lastApply.note} (${m.lastApply.files.join(', ')})`;
  m.facts = [...m.facts.filter((x) => !x.startsWith('Applied: ') || x === line), line].slice(-MAX_FACTS);
  // Append to summary arc
  const bit = m.lastApply.note;
  m.summary = (m.summary ? m.summary + ' · ' : '') + bit;
  if (m.summary.length > 1800) m.summary = '…' + m.summary.slice(-1700);
  m.updatedAt = Date.now();
  await save(m);
}

export async function noteExchange(user: string, assistant: string): Promise<void> {
  const u = String(user || '').trim().slice(0, 160);
  const a = String(assistant || '').trim().slice(0, 160);
  if (!u) return;
  const m = await load();
  // Keep last few exchanges as facts for "what were we talking about"
  m.facts = [...m.facts, `Owner: ${u}`, a ? `Auma: ${a}` : ''].filter(Boolean).slice(-MAX_FACTS);
  m.updatedAt = Date.now();
  await save(m);
}

/** Injected into every voice/build turn. */
export async function memoryBlock(): Promise<string> {
  const m = await load();
  if (!m.facts.length && !m.lastApply && !m.summary) return '';
  const lines: string[] = [
    '[working memory — use this; do not pretend amnesia]',
  ];
  if (m.summary) lines.push(`Session arc: ${m.summary}`);
  if (m.lastApply) {
    lines.push(
      `Last applied change: ${m.lastApply.note} → ${m.lastApply.files.join(', ')}`,
    );
  }
  lines.push('Recent facts:');
  for (const f of m.facts.slice(-16)) lines.push(`- ${f}`);
  return lines.join('\n');
}
