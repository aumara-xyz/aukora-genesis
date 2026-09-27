// φ MIND — EverOS-shaped MVP memory (Markdown-native, local-first).
// Inspired by EverMind-AI/EverOS: readable .md files, not a black-box vector DB.
// Layers: profile · session arc · facts · episodes · wiki
// Later: swap retrieval for embeddings / your KIRA vault without changing callers.

import { existsSync } from 'fs';
import { readFile, writeFile, mkdir, appendFile, readdir } from 'fs/promises';
import { join } from 'path';

function root() {
  return process.env.AUKORA_FORGE_REPO
    ?? join(new URL('../..', import.meta.url).pathname);
}

const DIR = () => join(root(), '.aukora', 'memory');
const PROFILE = () => join(DIR(), 'profile.md');
const ARC = () => join(DIR(), 'session-arc.md');
const FACTS = () => join(DIR(), 'facts.md');
const EPISODES = () => join(DIR(), 'episodes');
const WIKI = () => join(DIR(), 'wiki');

async function ensure(): Promise<void> {
  await mkdir(EPISODES(), { recursive: true });
  await mkdir(WIKI(), { recursive: true });
  if (!existsSync(PROFILE())) {
    await writeFile(PROFILE(), '# Owner profile\n\n_Empty — fill as we learn preferences._\n', 'utf8');
  }
  if (!existsSync(ARC())) {
    await writeFile(ARC(), '# Session arc\n\n_No arc yet._\n', 'utf8');
  }
  if (!existsSync(FACTS())) {
    await writeFile(FACTS(), '# Durable facts\n\n', 'utf8');
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readSafe(p: string): Promise<string> {
  try {
    if (!existsSync(p)) return '';
    return await readFile(p, 'utf8');
  } catch { return ''; }
}

/** Append a durable fact (dedupe exact lines). */
export async function rememberFact(fact: string, source = 'glass'): Promise<void> {
  await ensure();
  const f = String(fact || '').trim().replace(/\s+/g, ' ').slice(0, 400);
  if (!f || f.length < 4) return;
  const cur = await readSafe(FACTS());
  const line = `- (${source}) ${f}`;
  if (cur.includes(f)) return;
  await appendFile(FACTS(), line + '\n', 'utf8');
}

/** Append episode turn for the day. */
export async function rememberEpisode(role: 'user' | 'assistant' | 'system', text: string): Promise<void> {
  await ensure();
  const body = String(text || '').trim().slice(0, 1200);
  if (!body) return;
  const path = join(EPISODES(), `${today()}.md`);
  if (!existsSync(path)) {
    await writeFile(path, `# Episode ${today()}\n\n`, 'utf8');
  }
  const ts = new Date().toISOString().slice(11, 19);
  await appendFile(path, `### ${ts} · ${role}\n\n${body}\n\n`, 'utf8');
}

/** Update rolling session arc (replace or append short bit). */
export async function noteArc(bit: string): Promise<void> {
  await ensure();
  const b = String(bit || '').trim().slice(0, 300);
  if (!b) return;
  let cur = await readSafe(ARC());
  if (!cur || cur.includes('_No arc yet_')) {
    cur = `# Session arc\n\n`;
  }
  // keep last ~2k
  const stamp = new Date().toISOString().slice(0, 16);
  cur = cur.trimEnd() + `\n- **${stamp}** — ${b}\n`;
  if (cur.length > 4000) {
    const lines = cur.split('\n');
    cur = lines.slice(0, 3).join('\n') + '\n' + lines.slice(-40).join('\n') + '\n';
  }
  await writeFile(ARC(), cur, 'utf8');
}

/** Soft profile preference lines. */
export async function notePreference(pref: string): Promise<void> {
  await ensure();
  const p = String(pref || '').trim().slice(0, 240);
  if (!p) return;
  let cur = await readSafe(PROFILE());
  if (cur.includes(p)) return;
  if (cur.includes('_Empty')) cur = '# Owner profile\n\n';
  cur = cur.trimEnd() + `\n- ${p}\n`;
  await writeFile(PROFILE(), cur, 'utf8');
  await rememberFact(`Preference: ${p}`, 'profile');
}

/** Write a wiki page (e.g. absorb summary). */
export async function writeWiki(slug: string, markdown: string): Promise<string> {
  await ensure();
  const safe = slug.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
  const rel = `.aukora/memory/wiki/${safe}.md`;
  await writeFile(join(root(), rel), markdown, 'utf8');
  return rel;
}

/** Naive keyword score retrieval over markdown memory (MVP — no embeddings). */
/**
 * ══ RECALL GOES THROUGH THE LAW NOW ══
 *
 * Everything below this line is the ORIGINAL keyword scorer, and it is still here because it is still
 * the fallback: if the governed path throws for any reason, the owner gets his memory rather than
 * silence. What changed is that it is no longer the first answer.
 *
 * #109 merged the read side — `recall`, `scope`, `ingestGate`, `containment` — and nothing imported
 * it. `surface/mind/governedRecall.ts` is the consumer, and routing THIS function through it means
 * every caller becomes governed at once rather than only the one I was asked to wire: the talk path
 * (door.ts:621), the powers block (:203), the mind route (:395) and the BUILDER's own brief
 * (grokChatBuilder.ts:620) all recall under consent scope, containment and a receipt from here.
 *
 * Wiring only the talk path would have left the builder — the thing that writes to the repository —
 * reading memory under no law at all, which is the wrong half to leave ungoverned.
 *
 * The shape is unchanged (`string[]` of `[tag] line`) so no call site moves. The tag is the classified
 * SCOPE now rather than a filename, which is more honest: `[identity]` says what a line is, where
 * `[wiki:absorbed.md]` said only where it was found.
 */
export async function retrieve(query: string, limit = 12): Promise<string[]> {
  try {
    const g = await import('./governedRecall');
    const r = await g.governedRecall(query, { limit });
    // An empty governed result is a real answer — the honest empty shelf.
    return r.hits.map((h) => `[${h.scope}] ${h.content.slice(0, 280)}`);
  } catch {
    // ══ THIS USED TO FALL BACK TO THE UNGOVERNED SCORER, AND THAT WAS A FAIL-OPEN ══
    //
    // The old comment argued — correctly — that an EMPTY governed result must not fall through, or
    // forgetting would be one bad query away from being bypassed. Then a THROW fell through anyway,
    // into a scorer that read the same files with no forgetting, no consent and no containment.
    //
    // So any exception under governed recall — a malformed receipt, an unreadable directory —
    // silently restored the pre-#109 behaviour, and the only symptom was that answers got BETTER.
    // A fail-open is worst exactly where it is quietest.
    //
    // Nothing now. This is the one path whose entire job is to fail closed, and a caller that gets
    // nothing has been told the truth: the governed shelf could not be read, so nothing may be said
    // from it.
    return [];
  }
}

// THE PRE-#109 UNGOVERNED SCORER WAS HERE, AND IT IS DELETED RATHER THAN LEFT UNREFERENCED.
//
// It read profile / arc / facts / episodes / wiki straight off disk with no forgetting, no consent and
// no containment. `retrieve()` called it on any exception, which made every failure under governed
// recall a silent restoration of the old behaviour.
//
// Removing the CALL and leaving the FUNCTION is how it comes back: the next exception handler written
// in this file finds a ready-made "just read the files" helper sitting one identifier away. There is a
// test asserting the name is gone.

/** Full block for model context every turn. */
export async function mindBlock(query?: string): Promise<string> {
  await ensure();

  // ══ EVERY SECTION COMES THROUGH GOVERNED RECORDS NOW ══
  //
  // This used to be three `readSafe()` calls straight off disk — profile, arc, facts — with only the
  // `Retrieved` subsection going through `retrieve()`. So forgetting, consent and containment governed
  // ONE QUARTER of what reached the voice, and `forget()` was a promise about the smallest part of it.
  //
  // Codex measured the consequence exactly:
  //
  //     {"governedBeforeForget":1,"governedAfterForget":0,"mindBlockStillContainedForgottenText":true}
  //
  // The record was forgotten, governed recall stopped returning it, and the block still carried the
  // text — because the block had never asked. With no query at all it was three raw files and nothing
  // else, which is the case where forgetting did literally nothing.
  //
  // `gatherRecords()` is the same function `governedRecall` scores over: it applies the ingest gate,
  // drops what may not be remembered at all, and quarantines anything external. `forgottenIds()` is
  // the owner's own erasures. Between them there is no path from a file to this block that skips them.
  //
  // A FAILURE HERE IS AN EMPTY BLOCK, NOT A RAW ONE. If the governed shelf cannot be read, she is told
  // nothing rather than told everything — the same rule `retrieve` above now keeps.
  let records: { recordId: string; content: string; provenance: string }[] = [];
  try {
    const g = await import('./governedRecall');
    const forgotten = await g.forgottenIds();
    records = (await g.gatherRecords())
      .filter((r) => !forgotten.has(r.recordId))
      .map((r) => ({ recordId: r.recordId, content: r.content, provenance: String(r.provenance ?? '') }));
  } catch {
    records = [];
  }

  // The sections are the SOURCES they came from — `sources()` in governedRecall tags each shelf, so
  // the shape of the block survives without any second reading of the files.
  const from = (tag: string, cap: number) => {
    const lines: string[] = [];
    let used = 0;
    for (const r of records) {
      if (!r.provenance.startsWith(tag)) continue;
      const line = r.content.trim();
      if (!line) continue;
      if (used + line.length > cap) break;
      used += line.length + 1;
      lines.push(line);
    }
    return lines.join('\n');
  };

  const profile = from('glass:profile', 1200);
  const arc = from('glass:arc', 1500);
  const facts = from('glass:facts', 1500);
  const retrieved = query ? await retrieve(query, 10) : [];

  const parts = [
    '[MIND — history only. These are PAST facts, not actions you just took this turn.]',
    '[Do NOT say "Applied: …" unless a build hand ran THIS turn and wrote files.]',
    profile.trim() ? `## Profile\n${profile.trim()}` : '',
    arc.trim() ? `## Session arc (past)\n${arc.trim()}` : '',
    facts.trim() ? `## Facts (past)\n${facts.trim()}` : '',
    retrieved.length ? `## Retrieved (past)\n${retrieved.map((x) => `- ${x}`).join('\n')}` : '',
  ].filter(Boolean);
  return parts.join('\n\n').slice(0, 7000);
}

/** After an exchange: episode + light heuristic extraction. */
export async function learnFromExchange(user: string, assistant: string): Promise<void> {
  const u = String(user || '').trim();
  const a = String(assistant || '').trim();
  if (u) await rememberEpisode('user', u);
  if (a) await rememberEpisode('assistant', a.slice(0, 800));

  // Heuristic preferences / identity
  const name = u.match(/\b(?:my name is|i(?:'m| am)|call me)\s+([A-Z][a-zA-Z0-9_-]{1,32})\b/i);
  if (name) await notePreference(`Name / handle: ${name[1]}`);
  const pref = u.match(/\b(?:i (?:prefer|like|want)|always|never)\s+(.{8,120})/i);
  if (pref) await notePreference(pref[0].slice(0, 160));

  // Applied / absorb mentions
  if (/\bapplied\b/i.test(a) || /\babsorbed\b/i.test(a)) {
    await noteArc(a.slice(0, 200));
    await rememberFact(a.slice(0, 240), 'assistant');
  }
  if (/\b(?:theme|border|placeholder|composer|arrow)\b/i.test(u)) {
    await noteArc(`Owner UI ask: ${u.slice(0, 160)}`);
  }
}

export async function rememberApply(files: string[], note: string): Promise<void> {
  const n = String(note || 'applied').slice(0, 200);
  const f = (files || []).slice(0, 12).join(', ');
  await noteArc(`Applied: ${n}${f ? ` → ${f}` : ''}`);
  await rememberFact(`Applied: ${n} (${f})`, 'apply');
  // dual-write working-memory for older callers
  try {
    const wm = await import('../working-memory');
    await wm.noteApply(files, note);
  } catch { /* */ }
}
