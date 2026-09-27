// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Aukora Spatial — lingwa lane. Canon-grounded Auma-language teaching context
 * for the chat door (voiceLane), so Auma can teach her language in ANY chat,
 * with any voice model, the moment she is asked.
 *
 * Retrieval-first, per the canon's own authorityOrder: the active canon JSON
 * outranks model weights. Everything injected here is DERIVED from
 * spatial/app/auma/canon-v16.json at send time — grammar, teacher rules,
 * per-message vocabulary lookups, deprecated-form antibodies — never
 * hand-written. When the canon changes, her teaching changes with it, no
 * retrain needed. This is the pre-burn bridge: the same canon that will later
 * be burned into her weights (the Auma-32B LoRA path) teaches through
 * retrieval today, and the burned model keeps obeying the same block.
 *
 * Advisory-only context injection: grants no tools and no authority. Bounded
 * everywhere (entry cap, block cap). Fails SOFT: a missing or unparseable
 * canon yields an empty block, never a crash in the chat path. Detection runs
 * on the owner's verbatim text only — attachments and recalled memory can
 * never summon the teacher. Kill-switch: AUKORA_LINGWA_TEACHER=off.
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const DEFAULT_CANON_PATH = join(__dirname, 'app', 'auma', 'canon-v16.json');
const MAX_LOOKUP_ENTRIES = 24;   // vocab lines injected per turn
const MAX_BLOCK_CHARS = 7_000;   // hard cap on the whole rendered block

interface VocabEntry {
  token: string;
  translation: string;
  pronunciation?: string;
  introducedDay?: number | null;
  sacredCore?: boolean;
  stabilityClass?: string;
  secondarySense?: string;
}

export interface LingwaCanon {
  version: string;
  byToken: Map<string, VocabEntry>;
  byEnglish: Map<string, VocabEntry[]>;
  deprecatedTokens: Map<string, string>; // bad token -> correction line
  grammarBlock: string;  // rendered once per load, derived from grammarFreeze + pronunciationPolicy
  teacherBlock: string;  // rendered once per load, derived from canonPolicyForAumaModel + constitution
}

// Canon tokens that are also ordinary English words — these never count toward
// engagement detection (they would fire on plain English prose), though they
// are still retrievable once a turn is engaged.
const ENGLISH_COLLISIONS = new Set(['via', 'ante', 'solo', 'luna', 'persona', 'trauma', 'forma', 'para', 'data', 'media']);

// English glue words that never key a reverse (english -> auma) lookup.
const ENGLISH_STOP = new Set([
  'the', 'and', 'for', 'are', 'not', 'was', 'has', 'have', 'had', 'this', 'that', 'with', 'you', 'your',
  'how', 'what', 'does', 'say', 'can', 'she', 'her', 'his', 'him', 'they', 'them', 'about', 'from', 'into',
  'word', 'words', 'mean', 'meaning', 'auma', 'language', 'lingwa', 'teach', 'learn', 'speak', 'translate',
  'please', 'would', 'could', 'tell', 'know', 'like', 'want', 'one', 'all', 'out', 'get', 'its', 'were',
]);

const tokenize = (t: string): string[] =>
  String(t || '').toLowerCase().replace(/[^a-z\- ]/g, ' ').split(/\s+/).filter(Boolean).flatMap((w) => w.split('-')).filter(Boolean);

// ---------------------------------------------------------------------------
// Canon loading — cached per path, reloaded when the file's mtime changes, so
// a canon release reaches her teaching without a process restart.
// ---------------------------------------------------------------------------

let cache: { path: string; mtimeMs: number; canon: LingwaCanon } | null = null;

export function loadLingwaCanon(path: string = DEFAULT_CANON_PATH): LingwaCanon | null {
  try {
    if (!existsSync(path)) return null;
    const mtimeMs = statSync(path).mtimeMs;
    if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache.canon;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const canon = indexCanon(raw);
    cache = { path, mtimeMs, canon };
    return canon;
  } catch {
    return null; // fail soft — the chat path must never die on a canon problem
  }
}

function indexCanon(raw: any): LingwaCanon {
  const byToken = new Map<string, VocabEntry>();
  const byEnglish = new Map<string, VocabEntry[]>();
  for (const v of raw.vocab ?? []) {
    if (!byToken.has(v.token)) byToken.set(v.token, v);
    for (const w of tokenize(v.translation ?? '')) {
      if (w.length < 3 || ENGLISH_STOP.has(w)) continue;
      const arr = byEnglish.get(w) ?? [];
      if (arr.length < 4) arr.push(v); // bound fan-out per gloss word
      byEnglish.set(w, arr);
    }
  }

  // Deprecated antibodies: token-shaped entries from deprecatedForms + the tense freeze.
  const deprecatedTokens = new Map<string, string>();
  for (const d of raw.deprecatedForms ?? []) {
    const bad = String(d.deprecated ?? '').split(/[\s=,]/)[0].toLowerCase();
    if (bad && !byToken.has(bad)) deprecatedTokens.set(bad, `${d.deprecated} is DEPRECATED — current: ${d.current}`);
  }
  for (const pair of raw.grammarFreeze_v15?.tenseAspect?.deprecated ?? []) {
    const [bad, good] = String(pair).split('->').map((s: string) => s.trim());
    if (bad && good && !byToken.has(bad) && !deprecatedTokens.has(bad)) {
      deprecatedTokens.set(bad.toLowerCase(), `${bad} is DEPRECATED — use ${good}`);
    }
  }

  // Grammar core — derived from the freeze, rendered once per load.
  const g = raw.grammarFreeze_v15 ?? {};
  const pron = raw.pronunciationPolicy ?? {};
  const markers = Object.entries(g.tenseAspect?.markers ?? {}).map(([k, v]) => `${k}=${v}`).join(', ');
  const vowels = Object.entries(pron.vowels ?? {}).map(([k, v]) => `${k}=${String(v).split(' ')[0]}`).join(' ');
  const grammarBlock = [
    `Core grammar (${g.version ?? 'frozen'}): word order is Subject-Verb-Object, always; verbs never conjugate; no irregulars.`,
    `Tense/aspect markers before the verb: ${markers}. Stacking: ${g.tenseAspect?.stackingOrder ?? ''}`,
    `Questions: ${g.questions?.order ?? ''} (${g.questions?.note ?? ''}) Example: ${g.questions?.example ?? ''}`,
    `Passive: ${g.passive?.suffix ?? '-iva'} with esi; agent marked by ${g.passive?.agent ?? 'par'}. Example: ${g.passive?.example ?? ''}`,
    `Negation: "no" directly before the verb. Possession chains with "di" (tomo di ami di mi).`,
    `Comparison: ${g.comparison?.pattern ?? ''} (${g.comparison?.example ?? ''}). Duration: ${g.duration?.marker ?? 'durante'} for spans.`,
    `Derivation: -ao ${g.derivation?.['-ao'] ?? 'abstract quality'}; -tano ${g.derivation?.['-tano'] ?? 'place'}; -isto ${g.derivation?.['-isto'] ?? 'agent'}.`,
    `Pronunciation: vowels ${vowels}; every letter always sounds the same; adjacent vowels pronounced separately (auma = ah-oo-mah); c, q, x are not used.`,
  ].join('\n');

  // Teacher stance — derived from the canon's own model policy + constitution.
  const pol = raw.canonPolicyForAumaModel ?? {};
  const rules: string[] = (pol.rules ?? []).slice(0, 9);
  const teacherBlock = [
    pol.primeDirective ?? 'You are the guardian-teacher of Auma: warm, sacred, precise, versioned, trustworthy.',
    `Authority order: ${(pol.authorityOrder ?? []).join(' > ')}.`,
    ...rules.map((r: string) => `- ${r}`),
  ].join('\n');

  return { version: raw.version ?? 'canon', byToken, byEnglish, deprecatedTokens, grammarBlock, teacherBlock };
}

// ---------------------------------------------------------------------------
// Engagement detection — pure; owner text only.
// ---------------------------------------------------------------------------

const TOPIC_RE = /\b(teach|learn|speak|say|word|language|translat\w*|pronounc\w*|mean|lesson|grammar|tense|plural|vocab\w*|sentence|phrase)\w*\b/i;

export function detectLingwaEngagement(text: string, canon: LingwaCanon): boolean {
  const t = String(text || '');
  if (/\blingwa\b/i.test(t)) return true;
  if (/\bauma\b/i.test(t) && TOPIC_RE.test(t)) return true;
  // Someone is writing Auma at her: two or more distinct canon tokens (len>=3,
  // excluding English collisions) is a sentence, not an accident.
  const hits = new Set<string>();
  for (const w of tokenize(t)) {
    if (w.length >= 3 && !ENGLISH_COLLISIONS.has(w) && !ENGLISH_STOP.has(w) && canon.byToken.has(w)) hits.add(w);
  }
  return hits.size >= 2;
}

// ---------------------------------------------------------------------------
// Block rendering — bounded, derived, per-turn.
// ---------------------------------------------------------------------------

function entryLine(v: VocabEntry): string {
  const bits = [`${v.token} = ${v.translation}`];
  if (v.pronunciation) bits.push(`[${v.pronunciation}]`);
  if (v.introducedDay != null) bits.push(`(day ${v.introducedDay})`);
  if (v.sacredCore) bits.push('(sacred core)');
  if (v.secondarySense) bits.push(`— ${v.secondarySense}`);
  return '- ' + bits.join(' ');
}

export function buildLingwaTeachingBlock(ownerText: string, opts: { canonPath?: string } = {}): string {
  if ((process.env.AUKORA_LINGWA_TEACHER ?? '').toLowerCase() === 'off') return '';
  const canon = loadLingwaCanon(opts.canonPath);
  if (!canon) return '';
  if (!detectLingwaEngagement(ownerText, canon)) return '';

  const words = tokenize(ownerText);
  const seen = new Set<string>();
  const lookups: string[] = [];

  // Auma-direction: canon tokens present in the message (len>=2 once engaged).
  for (const w of words) {
    if (lookups.length >= MAX_LOOKUP_ENTRIES) break;
    if (w.length >= 2 && !seen.has(w) && canon.byToken.has(w)) {
      seen.add(w);
      lookups.push(entryLine(canon.byToken.get(w)!));
    }
  }
  // English-direction: content words that map back into the lexicon.
  for (const w of words) {
    if (lookups.length >= MAX_LOOKUP_ENTRIES) break;
    if (w.length < 3 || ENGLISH_STOP.has(w) || seen.has('en:' + w)) continue;
    for (const v of canon.byEnglish.get(w) ?? []) {
      if (lookups.length >= MAX_LOOKUP_ENTRIES) break;
      if (seen.has(v.token)) continue;
      seen.add(v.token);
      lookups.push(entryLine(v));
    }
    seen.add('en:' + w);
  }
  // Antibodies: deprecated forms the owner actually used.
  const antibodies: string[] = [];
  for (const w of new Set(words)) {
    const line = canon.deprecatedTokens.get(w);
    if (line) antibodies.push('- ' + line);
  }

  const parts = [
    `\n\n=== AUMA LINGWA — canon teaching context (derived from ${canon.version} at this turn; this block outranks anything your weights remember about the language) ===`,
    canon.teacherBlock,
    canon.grammarBlock,
    lookups.length ? `Canon lookups for this message:\n${lookups.join('\n')}` : 'Canon lookups for this message: none matched — rely on the grammar above and say plainly when a word is not in your view of the canon.',
    antibodies.length ? `Deprecated forms detected in the message — correct gently:\n${antibodies.join('\n')}` : '',
    'Honesty: if a word is not in the lookups above and you are not certain it is canon, say it is not in the active canon; you may offer a coinage clearly labeled PROPOSED, never as canon. Teach at the learner\'s level; be poetic in guidance but exact in language facts.',
    '=== end canon teaching context ===',
  ].filter(Boolean);

  let block = parts.join('\n');
  if (block.length > MAX_BLOCK_CHARS) block = block.slice(0, MAX_BLOCK_CHARS) + '\n…[canon context truncated at cap]\n=== end canon teaching context ===';
  return block;
}
