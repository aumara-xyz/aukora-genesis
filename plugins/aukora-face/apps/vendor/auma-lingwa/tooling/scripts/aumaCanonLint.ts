// Auma canon lint — machine checks for the Auma language canon JSON.
// Every canon release must pass this before shipping to the app or to training.
//
//   bun scripts/aumaCanonLint.ts [path-to-canon.json]
//
// Defaults to the app copy. Exit 1 on errors; warnings are informational.
// These checks exist because v15 shipped with hand-edit bugs this would have
// caught: renamed words carrying the old word's pronunciation/ttsKey, a
// duplicate token, deprecated tense words still taught as lesson cards, and
// words used in sentences before their introduction day.

import { readFileSync } from 'fs';

const path = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'spatial/app/auma/canon-v16.json';
const canon = JSON.parse(readFileSync(path, 'utf8'));
const V: any[] = canon.vocab;
const L: Record<string, any[]> = canon.lessons;

const errors: string[] = [];
const warnings: string[] = [];

// Tokens that are legitimate outside the lexicon: the language's own name in
// metatext, and paralinguistic sound tokens (see pronunciationPolicy).
const EXEMPT = new Set(['auma', 'hm', 'sh']);

// Deprecated forms must never appear in Auma production surfaces (cards,
// example text, correct answers). Distractor options and explains that
// *discuss* deprecated forms are allowed.
const DEPRECATED = ['deja', 'todi', 'pasuna', 'agon', 'skirvi', 'lingua', 'kanita', 'skrivita', 'kokata', 'lavita'];

const tokenize = (t: unknown): string[] =>
  String(t ?? '')
    .replace(/\b[A-Z][a-z]+\b/g, ' ') // proper names (Nami) are not lexicon entries
    .toLowerCase()
    .replace(/[^a-z\- ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => w.split('-'))
    .filter((w) => w.length >= 2);

const forEachStep = (fn: (s: any, day: number) => void) => {
  for (const d of Object.keys(L)) for (const s of L[d]) fn(s, +d);
};

// ---- vocab integrity -------------------------------------------------------
const seen = new Map<string, number>();
for (const v of V) {
  seen.set(v.token, (seen.get(v.token) ?? 0) + 1);
  if (v.ttsKey && v.ttsKey !== v.token) errors.push(`ttsKey mismatch: token "${v.token}" has ttsKey "${v.ttsKey}"`);
  if (!v.pronunciation) warnings.push(`no pronunciation: ${v.token}`);
  if (v.introducedDay != null && (v.introducedDay < 1 || v.introducedDay > 84)) errors.push(`introducedDay out of range: ${v.token} (${v.introducedDay})`);
  // respelling sanity: syllable chunks should match vowel count (heuristic)
  if (v.pronunciation && !v.token.includes(' ') && !v.token.includes('-')) {
    const vowels = (v.token.match(/[aeiou]/g) ?? []).length;
    const chunks = v.pronunciation.split('-').length;
    if (vowels > 0 && vowels !== chunks) warnings.push(`pronunciation/syllable mismatch: ${v.token} [${v.pronunciation}]`);
  }
}
for (const [t, n] of seen) if (n > 1) errors.push(`duplicate token: ${t} (${n} entries)`);

// ---- lesson integrity ------------------------------------------------------
const vocabTokens = new Set(V.map((v) => v.token));
// affix entries like -iva / -li / -imo legitimize their hyphen-split pieces
const affixPieces = new Set(V.filter((v) => v.token.startsWith('-')).map((v) => v.token.slice(1)));

const introDay: Record<string, number> = {};
for (const v of V) if (v.introducedDay != null) introDay[v.token] = Math.min(introDay[v.token] ?? 999, v.introducedDay);
forEachStep((s, d) => { if (s.type === 'word') introDay[s.word] = Math.min(introDay[s.word] ?? 999, d); });

const knownToken = (w: string) => vocabTokens.has(w) || affixPieces.has(w) || EXEMPT.has(w);

forEachStep((s, d) => {
  if (s.type === 'quiz') {
    if (!Array.isArray(s.options) || s.options.length !== 3) errors.push(`day ${d}: quiz needs exactly 3 options: "${s.question}"`);
    else if (!(s.correctIndex >= 0 && s.correctIndex < s.options.length)) errors.push(`day ${d}: bad correctIndex: "${s.question}"`);
  }
  if (s.type === 'word') {
    if (!s.word || !s.translation) errors.push(`day ${d}: word step missing word/translation`);
    if (!s.pronunciation) warnings.push(`day ${d}: card "${s.word}" has no pronunciation`);
    const e = V.find((v) => v.token === s.word);
    if (!e) errors.push(`day ${d}: card "${s.word}" has no vocab entry`);
    else if (e.introducedDay != null && d < e.introducedDay) errors.push(`day ${d}: card "${s.word}" appears before its introducedDay (${e.introducedDay})`);
  }
  // future-word leaks + deprecated forms + ghost tokens in Auma surfaces
  const surfaces: Array<[string, string | undefined, boolean]> = [
    ['sentence', s.sentence, true],
    ['aumaText', s.aumaText, false],
    ['correct answer', s.type === 'quiz' ? s.options?.[s.correctIndex] : undefined, true],
  ];
  for (const [label, text, hard] of surfaces) {
    if (!text) continue;
    for (const w of tokenize(text)) {
      if (EXEMPT.has(w)) continue;
      if (DEPRECATED.includes(w)) errors.push(`day ${d}: deprecated form "${w}" in ${label}: "${String(text).slice(0, 70)}"`);
      const intro = introDay[w];
      if (intro != null && intro > d) (hard ? errors : warnings).push(`day ${d}: "${w}" used in ${label} before its introduction day ${intro}`);
      if (label !== 'correct answer' && !knownToken(w) && intro == null) warnings.push(`day ${d}: ghost token "${w}" in ${label} (not in vocab): "${String(text).slice(0, 60)}"`);
    }
  }
});

// ---- journey / stats drift -------------------------------------------------
for (const day of canon.journey ?? []) {
  const actual = (L[String(day.dayNumber)] ?? []).filter((s: any) => s.type === 'word').length;
  if (day.wordCount !== actual) errors.push(`journey day ${day.dayNumber}: wordCount ${day.wordCount} but ${actual} cards`);
  if (actual > 20) warnings.push(`day ${day.dayNumber}: heavy load (${actual} new cards)`);
}
{
  let steps = 0;
  forEachStep(() => steps++);
  if (canon.stats?.totalSteps !== steps) errors.push(`stats.totalSteps ${canon.stats?.totalSteps} != actual ${steps}`);
  if (canon.stats?.totalVocabEntries !== V.length) errors.push(`stats.totalVocabEntries ${canon.stats?.totalVocabEntries} != actual ${V.length}`);
}

// ---- graded readers (corpus) --------------------------------------------------
// If a readers file sits next to the canon, every Auma line must respect its
// reader's declared maxDay: known tokens only, introduced on or before maxDay,
// and no deprecated forms. The corpus must never outrun the curriculum.
{
  const readersPath = path.replace(/[^/\\]+$/, 'readers-v1.json');
  let readers: any = null;
  try { readers = JSON.parse(readFileSync(readersPath, 'utf8')); } catch { /* optional */ }
  if (readers?.readers) {
    for (const r of readers.readers) {
      if (!(r.maxDay >= 1 && r.maxDay <= 84)) errors.push(`reader ${r.id}: bad maxDay ${r.maxDay}`);
      for (let li = 0; li < (r.lines ?? []).length; li++) {
        const line = r.lines[li];
        if (!line.a || !line.e) { errors.push(`reader ${r.id} line ${li + 1}: missing a/e text`); continue; }
        for (const w of tokenize(line.a)) {
          if (EXEMPT.has(w)) continue;
          if (DEPRECATED.includes(w)) errors.push(`reader ${r.id} line ${li + 1}: deprecated form "${w}"`);
          else if (!knownToken(w)) errors.push(`reader ${r.id} line ${li + 1}: ghost token "${w}"`);
          else if (introDay[w] != null && introDay[w] > r.maxDay) errors.push(`reader ${r.id} line ${li + 1}: "${w}" (day ${introDay[w]}) exceeds maxDay ${r.maxDay}`);
        }
      }
    }
    warnings.push(`readers: validated ${readers.readers.length} graded readers against their day gates`);
  }
}

// ---- confusability report (informational) -----------------------------------
{
  const ed1 = (a: string, b: string): boolean => {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, k = 0, d = 0;
    while (i < a.length && k < b.length) {
      if (a[i] === b[k]) { i++; k++; continue; }
      if (++d > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) k++; else { i++; k++; }
    }
    return d + (a.length - i) + (b.length - k) === 1;
  };
  const dated = V.filter((v) => v.introducedDay != null && v.token.length >= 3 && !v.token.includes('-'));
  let close = 0;
  for (let i = 0; i < dated.length; i++)
    for (let k = i + 1; k < dated.length; k++)
      if (Math.abs(dated[i].introducedDay - dated[k].introducedDay) <= 2 && ed1(dated[i].token, dated[k].token)) close++;
  warnings.push(`confusability: ${close} near-homophone pairs introduced within 2 days of each other (design metric, not a failure)`);
}

// ---- report ------------------------------------------------------------------
console.log(`auma canon lint — ${path} (${canon.version})`);
console.log(`vocab ${V.length} · days ${Object.keys(L).length} · errors ${errors.length} · warnings ${warnings.length}`);
for (const e of errors) console.log('  ERROR', e);
const show = process.argv.includes('--verbose') ? warnings : warnings.slice(0, 15);
for (const w of show) console.log('  warn ', w);
if (!process.argv.includes('--verbose') && warnings.length > show.length) console.log(`  … ${warnings.length - show.length} more warnings (--verbose to see all)`);
process.exit(errors.length ? 1 : 0);
