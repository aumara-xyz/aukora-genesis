// φ — GROK AS THE BUILDER HAND via chat completions (Grok Build compute).
//
// Chat → clean spoken answer (never JSON).
// Build → surgical find/replace (or small full-file writes); review gate captures proposal.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve, isAbsolute } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import type { ForgeEngine, ForgeEvent } from './crush';
import { resolveGrokAuth, grokChatHeaders, grokDefaultModel } from '../../surface/grokAuth';
// One named ceiling for every talk path in the repository. See its header for the cost argument.
import { VOICE_MAX_TOKENS } from './voice';
import { absorbRepo, isAbsorbTurn } from './absorb';

const MAX_FILES = 28;
const MAX_FILE_CHARS = 80_000;
const MAX_TOTAL_CHARS = 280_000;

function listSourceFiles(root: string, limit = 100): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', '.git', '.aukora', 'dist', 'bun.lock', 'package-lock.json']);
  const walk = (dir: string, depth: number) => {
    if (out.length >= limit || depth > 5) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name.startsWith('.') && name !== '.gitignore') continue;
      if (skip.has(name)) continue;
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) walk(abs, depth + 1);
      else if (/\.(ts|tsx|js|mjs|css|html|md|json)$/.test(name) && !name.endsWith('.d.ts')) {
        out.push(relative(root, abs).replace(/\\/g, '/'));
      }
      if (out.length >= limit) return;
    }
  };
  walk(root, 0);
  return out;
}

async function readContext(root: string, instruction: string): Promise<string> {
  const files = listSourceFiles(root);
  const named = files.filter((f) => instruction.toLowerCase().includes(f.toLowerCase().split('/').pop()!));
  const pick = [...new Set([
    ...named.slice(0, 12),
    'surface/app/surface-chat.js',
    'surface/app/style.css',
    'surface/app/arc.js',
    'surface/app/gate.js',
    'surface/app/index.html',
    'surface/app/unfold.js',
    'surface/app/lane.js',
    'surface/app/live-swap.js',
    'surface/door.ts',
    'surface/conversation.ts',
    'docs/glass-powers.md',
    'README.md',
    ...files.filter((f) => f.startsWith('surface/app/user/')).slice(0, 8),
    ...files.slice(0, 24),
  ])].filter((f) => existsSync(join(root, f))).slice(0, 36);

  let total = 0;
  const chunks: string[] = [];
  for (const f of pick) {
    try {
      let body = await readFile(join(root, f), 'utf8');
      if (body.length > MAX_FILE_CHARS) body = body.slice(0, MAX_FILE_CHARS) + '\n/* …truncated… */\n';
      if (total + body.length > MAX_TOTAL_CHARS) break;
      total += body.length;
      chunks.push(`----- ${f} -----\n${body}`);
    } catch { /* skip */ }
  }
  return chunks.join('\n\n');
}

function safeRelPath(root: string, raw: string): string | null {
  const cleaned = raw.replace(/^\/+/, '').replace(/\\/g, '/');
  if (!cleaned || cleaned.includes('..')) return null;
  // Law / custody — never.
  if (cleaned.startsWith('.aukora') || cleaned === 'aukora.law.json' || cleaned === 'LAW.md') return null;
  if (/(^|\/)(\.env|auth\.json|id_rsa|\.ssh|.*\.key|.*\.pem)(\/|$)/i.test(cleaned)) return null;
  if (/(^|\/)core\/authority(\/|$)/i.test(cleaned) || /(^|\/)core\/witness(\/|$)/i.test(cleaned)) return null;
  if (/aumlok/i.test(cleaned)) return null;
  const abs = resolve(root, cleaned);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.replace(/\\/g, '/');
}

function extractJson(text: string): unknown | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fence?.[1] ?? text).trim();
  try { return JSON.parse(raw); } catch { /* */ }
  const i = raw.indexOf('{');
  const j = raw.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try { return JSON.parse(raw.slice(i, j + 1)); } catch { /* */ }
  }
  return null;
}

function humanize(text: string): string {
  let t = text.trim();
  const j = extractJson(t);
  if (j && typeof j === 'object') {
    const o = j as { note?: string; files?: unknown[] };
    if (typeof o.note === 'string' && o.note.trim()) return o.note.trim();
    if (Array.isArray(o.files) && o.files.length === 0) {
      return 'Nothing to change for that — give me a concrete edit if you want a proposal card.';
    }
  }
  t = t.replace(/```json[\s\S]*?```/gi, '').trim();
  t = t.replace(/^No file changes proposed\.\s*/i, '').trim();
  return t || 'I am here — ask a question, or tell me something concrete to change.';
}

function isChatTurn(task: string, brief?: string): boolean {
  if (isAbsorbTurn(task)) return false;
  const b = brief ?? '';
  // Build lane brief (owner has Build mode on) → never chat-only for work orders.
  if (/MAKE A CHANGE|BUILDING|write files|proposal card|change the repository/i.test(b)) return false;
  if (/ASKING A QUESTION|do NOT modify|not requesting a change|change nothing/i.test(b)) return true;
  if (/^\s*(?:build|make|forge)\s*:/i.test(task)) return false;

  // Meta "why can't you" / "unleash" — still talk, but voice will say you CAN build.
  // Concrete edit language always goes to the hand.
  const editVerb = /\b(?:add|change|fix|remove|delete|create|rename|implement|update|restyle|wire|refactor|hide|show|build|move|resize|style|redesign|replace|insert|paint|draw|toggle|enable|disable|make|shrink|grow|scale|outline|fill|get rid of|rid of|undo|revert|restore|clean up|cleanup)\b/i.test(task)
    || /\b(?:get rid of|take off|strip|kill)\b/i.test(task);
  const uiish = /\b(?:ui|ux|screen|page|panel|card|button|composer|placeholder|border|line|color|colour|background|bg|theme|accent|hue|font|padding|margin|header|title|css|style|glass|lane|corner|hot corner|menu|record|welcome|layout|sidebar|modal|toast|badge|icon|text|label|input|form|nav|footer|hero|counter|widget|app|feature|section|row|column|grid|list|item|arrow|send|outline|fill|glow|shadow|radius|opacity|size|smaller|bigger|taller|shorter|wider|narrower|thinner|thicker|rounder|square|bubble|message|chat|pill|dot|caret|scroll|transcript|stage|that|it|todo|timer|calculator|dashboard|game|canvas|api|endpoint|route|state|store|logic|function|component|module|handler|click|submit|fetch|save|load|localstorage|keyboard|drag)\b/i.test(task)
    || /\.(?:js|ts|css|html|md)\b/i.test(task)
    || /\d+\s*%/.test(task)
    || /\b(?:top right|top left|bottom right|bottom left)\b/i.test(task);

  if (editVerb && uiish) return false;
  if (/^\s*(?:make|add|create|change|build|fix|hide|show)\b/i.test(task) && (uiish || editVerb)) return false;

  const pureTalk = /\b(?:give me|tell me|explain|what(?:'s| is)|why\b|how (?:do|does|can|should|to)|who are you|what can you|unleash|why can'?t)\b/i.test(task)
    && !uiish;
  if (pureTalk) return true;
  // Deictic repair: "that line", "get rid of that" → build (hand uses last apply + sight)
  if (/\b(?:get rid of|remove|fix|undo|revert)\b/i.test(task) && /\b(?:that|this|it|the line|the border|the corner)\b/i.test(task)) return false;

  if (/\?\s*$/.test(task.trim()) && !editVerb) return true;
  return true;
}

async function callGrok(
  messages: { role: string; content: string }[],
  signal?: AbortSignal,
  maxTokens = 4000,
): Promise<{ ok: true; text: string; truncated?: true } | { ok: false; error: string }> {
  const auth = resolveGrokAuth();
  if (!auth) return { ok: false, error: 'Grok is not signed in on this node yet.' };
  const res = await fetch(`${auth.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: grokChatHeaders(auth),
    body: JSON.stringify({
      model: grokDefaultModel(),
      max_tokens: maxTokens,
      temperature: 0.3,
      messages,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: `Grok answered ${res.status}: ${detail.slice(0, 160)}` };
  }
  // `finish_reason` IS READ HERE TOO. This cast omitted it, exactly as the two casts in voice.ts did —
  // a THIRD talk path, blind to its own ceiling, that the brief reporting the truncation defect did not
  // name and that a grep for `max_tokens: 2200` would not have found because the number is an argument.
  // Same rule as voice.ts: `'length'` and nothing else. An omitted field is silence, not a negative.
  const body = await res.json() as {
    choices?: { message?: { content?: string }; finish_reason?: unknown }[];
  };
  const text = body.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) return { ok: false, error: 'Grok returned an empty answer' };
  const truncated = body.choices?.[0]?.finish_reason === 'length';
  return { ok: true, text, ...(truncated ? { truncated: true as const } : {}) };
}

const VOICE_SYSTEM =
  'You are Auma — continuous collaborator on Aukora φ.\n'
  + 'Use prior turns and working memory. Never amnesia. Never claim you cannot edit.\n'
  + 'When they name a UI change, the build path handles it; on talk turns stay in one thread.\n'
  + 'Resolve that/it from last apply + screen context. Never dump JSON.';

interface FileOp {
  path: string;
  /** Full replace of file (small files only). */
  content?: string;
  /** Surgical edits. */
  replace?: { find: string; with: string }[];
}

function parseOps(text: string): FileOp[] {
  const data = extractJson(text);
  if (!data || typeof data !== 'object') return [];
  const files = (data as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  const out: FileOp[] = [];
  for (const f of files) {
    if (!f || typeof f !== 'object') continue;
    const path = typeof (f as { path?: unknown }).path === 'string' ? (f as { path: string }).path : '';
    if (!path) continue;
    const content = typeof (f as { content?: unknown }).content === 'string' ? (f as { content: string }).content : undefined;
    const replaceRaw = (f as { replace?: unknown }).replace;
    const replace: { find: string; with: string }[] = [];
    if (Array.isArray(replaceRaw)) {
      for (const r of replaceRaw) {
        if (!r || typeof r !== 'object') continue;
        const find = typeof (r as { find?: unknown }).find === 'string' ? (r as { find: string }).find : '';
        const with_ = typeof (r as { with?: unknown }).with === 'string' ? (r as { with: string }).with : '';
        if (find) replace.push({ find, with: with_ });
      }
    }
    if (content === undefined && !replace.length) continue;
    out.push({ path, content, replace: replace.length ? replace : undefined });
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

async function applyOps(root: string, ops: FileOp[], onEvent?: (e: ForgeEvent) => void): Promise<string[]> {
  const written: string[] = [];
  for (const op of ops) {
    const rel = safeRelPath(root, op.path);
    if (!rel) {
      onEvent?.({ t: 'tool', name: 'refuse', path: op.path });
      continue;
    }
    const abs = join(root, normalize(rel));
    let next: string | null = null;
    if (typeof op.content === 'string') {
      next = op.content;
    } else if (op.replace?.length) {
      let cur = '';
      try { cur = await readFile(abs, 'utf8'); } catch {
        onEvent?.({ t: 'log', line: `missing ${rel}` });
        continue;
      }
      let body = cur;
      let ok = true;
      for (const r of op.replace) {
        if (!body.includes(r.find)) {
          onEvent?.({ t: 'log', line: `find miss in ${rel}` });
          ok = false;
          break;
        }
        body = body.replace(r.find, r.with);
      }
      if (!ok) continue;
      if (body === cur) continue;
      if (isNoOpOrCommentOnly(cur, body)) {
        onEvent?.({ t: 'log', line: `skipped no-op/comment-only ${rel}` });
        continue;
      }
      next = body;
    }
    if (next === null) continue;
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, next, 'utf8');
    written.push(rel);
    onEvent?.({ t: 'tool', name: 'write', path: rel });
  }
  return written;
}

function isNoOpOrCommentOnly(before: string, after: string): boolean {
  if (before === after) return true;
  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return strip(before) === strip(after);
}


/** Fast path for common glass edits — no model flake. */
const COLOR_MAP: Record<string, string> = {
  black: '#0a0c12', dark: '#111520', navy: '#0c1220', charcoal: '#1a1f2e',
  white: '#f4f6fb', cream: '#f7f3ea',
  blue: 'rgb(40, 70, 140)', softblue: 'rgb(55, 85, 150)',
  green: 'rgb(30, 90, 70)', purple: 'rgb(70, 50, 110)',
  red: 'rgb(90, 40, 50)', gold: 'rgb(90, 75, 40)',
  teal: 'rgb(25, 80, 85)', pink: 'rgb(90, 45, 70)',
};

function resolveColor(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (COLOR_MAP[s]) return COLOR_MAP[s];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw.trim())) return raw.trim();
  if (/^rgb/i.test(raw.trim())) return raw.trim();
  // "dark green", "soft blue"
  const words = raw.trim().toLowerCase();
  for (const [k, v] of Object.entries(COLOR_MAP)) {
    if (words.includes(k)) return v;
  }
  return null;
}

async function patchFile(
  root: string,
  rel: string,
  mut: (cur: string) => string | null,
  onEvent?: (e: ForgeEvent) => void,
): Promise<boolean> {
  const abs = join(root, rel);
  if (!existsSync(abs)) return false;
  const cur = await readFile(abs, 'utf8');
  const next = mut(cur);
  if (next == null || next === cur) return false;
  if (isNoOpOrCommentOnly(cur, next)) return false;
  await writeFile(abs, next, 'utf8');
  onEvent?.({ t: 'tool', name: 'write', path: rel });
  return true;
}

function isSafeCssColor(c: string): boolean {
  const s = c.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return true;
  if (/^(?:black|white|navy|teal|gold|purple|transparent)$/i.test(s)) return true;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(s)) return true;
  return false;
}

/**
 * Edits this hand can make from the sentence alone, with no model in the middle.
 *
 * `if (m?.[1])` rather than `if (m)` at every branch below, and it is not noise. Under
 * `noUncheckedIndexedAccess` a capture group is `string | undefined`, and each of these blocks went
 * straight to `m[1].trim()` — seven typecheck errors, red on main. The group cannot be undefined when
 * the pattern matched, but that is an argument about a regex written on the line above, and this file
 * WRITES TO THE OWNER'S REPOSITORY. A branch reached with an undefined capture would build a path or a
 * file body out of `undefined`; the guard makes it fall through to the next pattern, which is what a
 * pattern that did not really match should do anyway.
 */
async function tryDeterministicEdit(
  root: string,
  task: string,
  onEvent?: (e: ForgeEvent) => void,
): Promise<{ written: string[]; said: string } | null> {
  const written: string[] = [];
  const notes: string[] = [];

  // ── placeholder ──────────────────────────────────────────────────────────
  const ph = task.match(/placeholder\s+to\s*:?\s*["“']?([^"”'\n]+)["”']?/i)
    || task.match(/placeholder\s+(?:text\s+)?(?:to|as)\s+["“']?([^"”'\n]+)["”']?/i);
  if (ph?.[1]) {
    const next = ph[1].trim().replace(/\s+/g, ' ');
    const ok = await patchFile(root, 'surface/app/surface-chat.js', (cur) => {
      const re = /input\.placeholder\s*=\s*(?:opts\.placeholder\s*\|\|\s*)?['"`][^'"`]*['"`]/;
      if (!re.test(cur)) return null;
      return cur.replace(re, `input.placeholder = opts.placeholder || ${JSON.stringify(next)}`);
    }, onEvent);
    if (ok) { written.push('surface/app/surface-chat.js'); notes.push(`Placeholder → ${next}`); }
  }

  // ── page / document title ────────────────────────────────────────────────
  const titleM = task.match(/(?:page |document |browser |tab )?title\s+to\s*:?\s*["“']?([^"”'\n]+)["”']?/i)
    || task.match(/rename (?:the )?(?:page|tab|title)\s+to\s*:?\s*["“']?([^"”'\n]+)["”']?/i);
  if (titleM?.[1]) {
    const next = titleM[1].trim();
    const ok = await patchFile(root, 'surface/app/index.html', (cur) => {
      if (!/<title>[^<]*<\/title>/i.test(cur)) return null;
      return cur.replace(/<title>[^<]*<\/title>/i, `<title>${next}</title>`);
    }, onEvent);
    if (ok) { written.push('surface/app/index.html'); notes.push(`Title → ${next}`); }
  }

  // ── body / stage background color ────────────────────────────────────────
  const bgM = task.match(/(?:background|bg)\s*(?:color\s*)?(?:to|as|=|:)\s*["“']?([^"”'\n.]+)["”']?/i)
    || task.match(/make (?:the )?(?:background|bg)\s+["“']?([^"”'\n.]+)["”']?/i)
    || task.match(/(?:darker|lighter)\s+background/i);
  if (bgM) {
    let color = bgM[1] ? resolveColor(bgM[1]) : null;
    if (/darker background/i.test(task)) color = '#0a0c12';
    if (/lighter background/i.test(task)) color = '#1a2030';
    if (color && isSafeCssColor(color)) {
      const ok = await patchFile(root, 'surface/app/style.css', (cur) => {
        if (!/html, body \{[^}]*background:[^;]+;/i.test(cur)) return null;
        return cur.replace(
          /(html, body \{[^}]*?)background:\s*[^;]+;/i,
          `$1background: ${color};`,
        );
      }, onEvent);
      if (ok) { written.push('surface/app/style.css'); notes.push(`Background → ${color}`); }
    }
  }

  // ── trinity hues (theme) ─────────────────────────────────────────────────
  const hueName = task.match(/\b(?:hue|accent|theme)\s+(?:to\s+)?(green|blue|purple|gold|teal|pink|red)\b/i)
    || task.match(/\bmake (?:it |the (?:theme|accents?) )?(green|blue|purple|gold|teal|pink|red)(?:er)?\b/i);
  if (hueName?.[1]) {
    const name = hueName[1].toLowerCase();
    const hues: Record<string, [string, string, string]> = {
      // l, c, r
      green:  ['90, 200, 140', '120, 190, 160', '100, 170, 150'],
      blue:   ['120, 170, 255', '150, 180, 255', '130, 160, 230'],
      purple: ['180, 150, 255', '170, 160, 240', '196, 170, 255'],
      gold:   ['230, 190, 100', '240, 195, 110', '220, 180, 90'],
      teal:   ['80, 190, 180', '100, 200, 190', '90, 180, 175'],
      pink:   ['240, 140, 180', '230, 150, 190', '220, 130, 170'],
      red:    ['230, 120, 120', '220, 130, 130', '210, 110, 110'],
    };
    const trip = hues[name];
    if (trip) {
      const ok = await patchFile(root, 'surface/app/style.css', (cur) => {
        let n = cur;
        n = n.replace(/--hue-l:\s*[^;]+;/, `--hue-l: ${trip[0]};`);
        n = n.replace(/--hue-c:\s*[^;]+;/, `--hue-c: ${trip[1]};`);
        n = n.replace(/--hue-r:\s*[^;]+;/, `--hue-r: ${trip[2]};`);
        return n === cur ? null : n;
      }, onEvent);
      if (ok) { written.push('surface/app/style.css'); notes.push(`Theme accents → ${name}`); }
    }
  }

  // ── make composer taller / shorter ───────────────────────────────────────
  if (/\bcomposer\b/i.test(task) && /\b(taller|shorter|bigger|smaller|larger)\b/i.test(task)) {
    const taller = /\b(taller|bigger|larger)\b/i.test(task);
    const ok = await patchFile(root, 'surface/app/style.css', (cur) => {
      // grow min-height on textarea if present, else pad composer
      if (/\.sfc-composer|form\.composer|\.composer\s*\{/.test(cur)) {
        // append override once
        const mark = '/* aukora-power:composer-size */';
        const block = taller
          ? `${mark}\n.sfc-composer textarea, form.composer textarea { min-height: 3.2rem !important; }\n`
          : `${mark}\n.sfc-composer textarea, form.composer textarea { min-height: 1.4rem !important; }\n`;
        if (cur.includes(mark)) {
          return cur.replace(/\/\* aukora-power:composer-size \*\/[\s\S]*?(?=\n\/\*|\n\.|\n#|$)/, block);
        }
        return cur + '\n' + block;
      }
      return null;
    }, onEvent);
    if (ok) { written.push('surface/app/style.css'); notes.push(taller ? 'Composer taller' : 'Composer shorter'); }
  }

  // ── welcome / greeting text ──────────────────────────────────────────────
  const wel = task.match(/welcome(?:\s+message)?\s+to\s*:?\s*["“']?([^"”'\n]+)["”']?/i)
    || task.match(/greeting\s+to\s*:?\s*["“']?([^"”'\n]+)["”']?/i);
  if (wel?.[1]) {
    const next = wel[1].trim();
    const ok = await patchFile(root, 'surface/app/surface-chat.js', (cur) => {
      // replace the template strings inside welcomeOnce bubble
      const re = /const row = bubble\('auma',\s*`Hey \$\{who\}\.[^`]*`\s*(?:\+\s*'[^']*'\s*)*\);/;
      if (!re.test(cur)) return null;
      return cur.replace(re,
        `const row = bubble('auma', \`Hey \${who}. ${next.replace(/`/g, "'").replace(/\$/g, '\\$')}\`);`);
    }, onEvent);
    if (ok) { written.push('surface/app/surface-chat.js'); notes.push(`Welcome → ${next}`); }
  }

  // ── new markdown note file ───────────────────────────────────────────────
  const noteM = task.match(/(?:create|add|write)\s+(?:a\s+)?(?:file|note|doc)\s+(?:called\s+|named\s+)?["“']?([a-zA-Z0-9_./-]+\.md)["”']?(?:\s+with\s+(?:content\s+)?["“']?([^"”']+)["”']?)?/i);
  if (noteM?.[1]) {
    let rel = noteM[1].replace(/^\/+/, '');
    if (!rel.includes('/')) rel = `docs/${rel}`;
    if (safeRelPath(root, rel)) {
      const body = (noteM[2] || `# ${rel}\n\nCreated from the glass.\n`).trim() + '\n';
      const abs = join(root, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, body, 'utf8');
      onEvent?.({ t: 'tool', name: 'write', path: rel });
      written.push(rel);
      notes.push(`Created ${rel}`);
    }
  }


  // freeform CSS: "css: .foo { color: red }"
  {
    const cssBlock = task.match(/^(?:css|style)\s*:\s*([\s\S]+)$/i)
      || task.match(/\badd\s+css\s*:?\s*([\s\S]+)$/i);
    if (cssBlock?.[1]) {
      const rule = cssBlock[1].trim();
      if (rule.length > 4 && rule.length < 4000) {
        const ok = await patchFile(root, 'surface/app/style.css', (cur) => {
          const mark = '/* aukora-power:play-css */';
          if (!cur.includes(mark)) return cur + '\n' + mark + '\n' + rule + '\n';
          return cur + '\n/* play */\n' + rule + '\n';
        }, onEvent);
        if (ok) { written.push('surface/app/style.css'); notes.push('CSS applied'); }
      }
    }
  }

  // create user widget: "create a widget called foo"
  {
    const appM = task.match(/(?:create|add|make)\s+(?:a\s+)?(?:widget|component|module|app)\s+(?:called\s+|named\s+)?["“']?([a-zA-Z][a-zA-Z0-9_-]*)["”']?/i);
    if (appM?.[1]) {
      const name = appM[1].toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (name) {
        const rel = `surface/app/user/${name}.js`;
        const abs = join(root, rel);
        if (!existsSync(abs)) {
          await mkdir(dirname(abs), { recursive: true });
          const body =
            `// user widget: ${name} — built from the glass\n`
            + `export function mount(root) {\n`
            + `  root.innerHTML = '';\n`
            + `  const el = document.createElement('div');\n`
            + `  el.className = 'phi-user-widget';\n`
            + `  el.innerHTML = '<div class="phi-card"><div class="phi-card-kicker">${name}</div><p>Edit me from the glass.</p></div>';\n`
            + `  root.append(el);\n`
            + `  return { destroy() { root.replaceChildren(); } };\n`
            + `}\n`;
          await writeFile(abs, body, 'utf8');
          onEvent?.({ t: 'tool', name: 'write', path: rel });
          written.push(rel);
          notes.push(`Created ${rel}`);
        }
      }
    }
  }

  if (!written.length) return null;
  return { written: [...new Set(written)], said: notes.join(' · ') };
}



/** Last-resort functional scaffold so Build mode always lands something real. */
async function scaffoldFeatureWidget(
  root: string,
  task: string,
  onEvent?: (e: ForgeEvent) => void,
): Promise<{ written: string[]; said: string } | null> {
  if (!/\b(?:todo|timer|counter|dashboard|calculator|game|widget|app|feature|form|list|tracker|note|kanban)\b/i.test(task)) {
    return null;
  }
  const kind = (task.match(/\b(todo|timer|counter|dashboard|calculator|game|widget|tracker|note|kanban|list|form)\b/i)?.[1] || 'feature').toLowerCase();
  const slug = kind.replace(/[^a-z0-9]+/g, '-').slice(0, 24);
  const rel = `surface/app/user/${slug}.js`;
  const title = JSON.stringify(task.replace(/\s+/g, ' ').trim().slice(0, 120));
  const kindJ = JSON.stringify(kind);
  const keyJ = JSON.stringify(`phi-widget-${slug}`);
  const body = `// φ user widget — Build mode scaffold (${kind})
export function mount(root) {
  if (!root) return;
  root.innerHTML = '';
  root.classList.add('phi-user-widget');
  const card = document.createElement('div');
  card.className = 'phi-card';
  const k = document.createElement('div');
  k.className = 'phi-card-kicker';
  k.textContent = ${kindJ};
  const h = document.createElement('div');
  h.textContent = ${title};
  h.style.fontSize = '14px';
  h.style.marginBottom = '10px';
  const stateKey = ${keyJ};
  let n = Number(localStorage.getItem(stateKey) || '0') || 0;
  const out = document.createElement('div');
  out.style.fontSize = '22px';
  out.style.fontVariantNumeric = 'tabular-nums';
  const paint = () => { out.textContent = String(n); localStorage.setItem(stateKey, String(n)); };
  paint();
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.alignItems = 'center';
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool-btn';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  row.append(
    mk('\u2212', () => { n -= 1; paint(); }),
    out,
    mk('+', () => { n += 1; paint(); }),
    mk('reset', () => { n = 0; paint(); }),
  );
  const note = document.createElement('div');
  note.style.marginTop = '10px';
  note.style.fontSize = '12px';
  note.style.opacity = '0.7';
  note.textContent = 'Persists in localStorage — grow me in Build mode';
  card.append(k, h, row, note);
  root.append(card);
}
`;
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, body, 'utf8');
  onEvent?.({ t: 'tool', name: 'write', path: rel });
  return {
    written: [rel],
    said: `Scaffolded a live ${kind} widget at ${rel} (counter + localStorage). Accept to keep — then ask to grow it.`,
  };
}

export const grokChatBuilder: ForgeEngine = async (task, ctx) => {
  // ABSORB: point at a GitHub repo — meal note + ideas (governed, no law paths).
  if (isAbsorbTurn(task)) {
    ctx.onEvent?.({ t: 'tool', name: 'absorb', path: 'github' });
    const abs = await absorbRepo(task, ctx.repoRoot, { writeNote: true });
    if (!abs.ok) return { code: 1, out: abs.error || 'absorb failed', said: abs.error || 'absorb failed' };
    try {
      const mind = await import('../../surface/mind/memory');
      await mind.rememberFact(`Absorbed ${abs.repo}: ${abs.said.slice(0, 180)}`, 'absorb');
      await mind.noteArc(`Absorbed ${abs.repo}`);
      if (abs.repo) {
        await mind.writeWiki(abs.repo.replace(/\//g, '--'), `# ${abs.repo}\n\n${abs.said}\n`);
      }
    } catch { /* */ }
    return {
      code: 0,
      out: abs.written?.length ? `wrote ${abs.written.join(', ')}` : abs.said,
      said: abs.said,
    };
  }

  if (isChatTurn(task, ctx.brief)) {
    let extra = '';
    if (/\b(?:what can you|powers|capabilities|what(?:'s| is) in|list files|repo|structure)\b/i.test(task)) {
      const files = listSourceFiles(ctx.repoRoot, 40).slice(0, 30).join(', ');
      extra = `\n\n[node powers]\n[sample paths: ${files}]`;
    }
    try {
      const mind = await import('../../surface/mind/memory');
      const mem = await mind.mindBlock(task);
      if (mem) extra += '\n\n' + mem;
    } catch {
      try {
        const { memoryBlock } = await import('../../surface/working-memory');
        const mem = await memoryBlock();
        if (mem) extra += '\n\n' + mem;
      } catch { /* */ }
    }
    if (ctx.brief && /\[screen|structure|pixels/i.test(ctx.brief)) {
      extra += '\n\n' + String(ctx.brief).slice(0, 4000);
    }
    // ONE CEILING FOR EVERY TALK PATH. This was a hand-written 2200 — the same number voice.ts carried
    // twice — passed as an argument, so it survived the grep that found the other two.
    const r = await callGrok([
      { role: 'system', content: VOICE_SYSTEM },
      { role: 'user', content: task + extra },
    ], ctx.signal, VOICE_MAX_TOKENS);
    if (!r.ok) return { code: 1, out: r.error, said: r.error };
    // ══ WHAT IS STILL NOT FIXED, SAID RATHER THAN LEFT TO BE FOUND ══
    //
    // `ForgeEngine`'s result is `{ code, out, said }` — there is nowhere on it to put `truncated`, so
    // unlike the voice path this cannot hand the flag to the surface as a field. Marking it in the text
    // would put the surface's words inside hers, which is the conflation LIMITS §21 is about. So the
    // ceiling is consistent and the read is no longer structurally blind, and carrying the flag through
    // an engine round needs a change to that interface — reported, not smuggled in at the end of a round.
    const said = humanize(r.text);
    return { code: 0, out: said, said };
  }

  const det = await tryDeterministicEdit(ctx.repoRoot, task, ctx.onEvent);
  if (det) {
    return { code: 0, out: `wrote ${det.written.join(', ')}`, said: det.said };
  }

  const context = await readContext(ctx.repoRoot, task);
  const r = await callGrok([
    {
      role: 'system',
      content:
        'You are the FULL BUILDER HAND of Aukora φ under Build mode. The owner designs FROM INSIDE OUT.\n'
        + 'You may create REAL functional product surface — not only cosmetic CSS.\n'
        + 'Return ONLY JSON: {"files":[{"path":"...","replace":[{"find":"exact","with":"new"}]} OR {"path":"...","content":"full file"}],"note":"one sentence"}\n'
        + 'WHERE TO WRITE:\n'
        + '· surface/app/user/<name>.js — new interactive widgets: export function mount(root) { ... } with real logic, state, events\n'
        + '· surface/app/*.js, style.css, index.html — shell, stage, composer, layout\n'
        + '· surface/*.ts — server lanes / APIs the glass can call (careful, keep imports valid)\n'
        + '· docs/** — notes, specs the owner asked for\n'
        + 'FUNCTIONAL examples: todo list with localStorage, timer, counter, form validation, mini dashboard, fetch to /api/*, keyboard handlers, multi-step UI.\n'
        + 'find must copy EXACTLY from context. Prefer full "content" for NEW files. Max 28 files.\n'
        + 'Forbidden: .aukora/, aukora.law.json, LAW.md, core/authority/, core/witness/, .env, keys, aumlok, auth secrets.\n'
        + 'Wire new widgets into the stage if needed (arc.js / unfold.js / surface-chat) so they appear without a separate install step.\n'
        + 'No prose outside JSON. No empty "done" without files.',
    },
    {
      role: 'user',
      content: `Instruction:\n${task}\n\nRepository context:\n${context}`,
    },
  ], ctx.signal, 4500);

  if (!r.ok) return { code: 1, out: r.error, said: r.error };

  let ops = parseOps(r.text);
  let written = ops.length ? await applyOps(ctx.repoRoot, ops, ctx.onEvent) : [];

  // Second pass: model often chats instead of editing. Force a surgical replace.
  if (!written.length) {
    ctx.onEvent?.({ t: 'log', line: 'retrying for a concrete edit' });
    const r2 = await callGrok([
      {
        role: 'system',
        content:
          'You MUST return JSON with at least one real write. No empty files array.\n'
          + 'Shape: {"files":[{"path":"...","replace":[...]}] or {"path":"surface/app/user/x.js","content":"..."},"note":"..."}\n'
          + 'Functional widgets OK. Copy find EXACTLY. Prefer surface/app/user/* for new features.',
      },
      {
        role: 'user',
        content: `Instruction (you must edit something):\n${task}\n\nContext:\n${context}`,
      },
    ], ctx.signal, 4500);
    if (r2.ok) {
      ops = parseOps(r2.text);
      written = ops.length ? await applyOps(ctx.repoRoot, ops, ctx.onEvent) : [];
      if (written.length) {
        let note = '';
        const j = extractJson(r2.text);
        if (j && typeof j === 'object' && typeof (j as { note?: unknown }).note === 'string') {
          note = (j as { note: string }).note;
        }
        return {
          code: 0,
          out: `wrote ${written.join(', ')}${note ? `\n${note}` : ''}`,
          said: note || `Proposed changes to ${written.join(', ')}.`,
        };
      }
    }
  }

  if (!written.length) {
    const sc = await scaffoldFeatureWidget(ctx.repoRoot, task, ctx.onEvent);
    if (sc) return { code: 0, out: `wrote ${sc.written.join(', ')}`, said: sc.said };
  }

  if (!ops.length || !written.length) {
    // Model often claims "Done" without files — never lie on the glass.
    const said = humanize(r.text);
    const lied = /\b(?:done|updated|changed|applied)\b/i.test(said) && !written.length;
    return {
      code: 0,
      out: said,
      said: lied
        ? 'I could not land that edit cleanly. Try: change the composer placeholder to: Your text'
        : (said || 'I could not land a clean edit. Name the control and the new value.'),
    };
  }

  let note = '';
  const j = extractJson(r.text);
  if (j && typeof j === 'object' && typeof (j as { note?: unknown }).note === 'string') {
    note = (j as { note: string }).note;
  }

  return {
    code: 0,
    out: `wrote ${written.join(', ')}${note ? `\n${note}` : ''}`,
    said: note || `Proposed changes to ${written.join(', ')}.`,
  };
};
