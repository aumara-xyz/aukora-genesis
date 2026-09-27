// Auma · Lingwa — the language game, mounted as a center-pane organ. Vanilla
// DOM in the spatial house style; concepts (flip cards, tiers) are transposed
// from the old React app, none of its code is used.
//
// Three views: the Journey (nested accordion of 84 days), Practice (a local
// Leitner spaced-repetition deck built from completed days, with recognition,
// production, and sentence-builder exercises), and the Dictionary (live search
// over the whole canon, both directions).
//
// DETOKENIZED (AURA lane round 1): AURA is not a token or a number — it is an
// evolving coherence and witness pattern (the cymatic glyph is its face). A
// completed lesson registers as a qualifying act that pulses the glyph; no
// tally is shown or incremented here. Practice remains its own reward.
//
// Feedback flags are stored locally (auma-feedback-v1) and exported by hand —
// the community-evolution pipeline's honest MVP until a witnessed endpoint
// exists. Same honesty rule as aura: local, provisional, means nothing alone.

import { loadState, saveProgress, ensure, award } from '/app/aura-core.js';

const CANON_URL = '/app/auma/canon-v16.json';
const READERS_URL = '/app/auma/readers-v1.json';
const SRS_KEY = 'auma-srs-v1';
const FB_KEY = 'auma-feedback-v1';
const READ_KEY = 'auma-read-v1';
// Leitner intervals per box, in days (box 0 ≈ four hours: relearn today).
const BOX_DAYS = [0.17, 1, 3, 7, 16, 35];
const SESSION_CAP = 20;

const TIERS = [
  { key: 'f', name: 'Sprint I · Foundation', sub: 'Your first words, and the shape of the whole language.', lo: 1, hi: 28 },
  { key: 'e', name: 'Sprint II · Expansion', sub: 'Real conversation — time, nuance, and how you know what you know.', lo: 29, hi: 56 },
  { key: 'm', name: 'Sprint III · Mastery', sub: 'The full voice — narration, argument, the language’s whole reach.', lo: 57, hi: 84 },
];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const steps = (canon, day) => {
  const v = canon.lessons[String(day)];
  return Array.isArray(v) ? v : (v?.steps ?? []);
};
const tierOf = (day) => TIERS.find((t) => day >= t.lo && day <= t.hi) ?? TIERS[0];
const hueOf = (day) => (tierOf(day).key === 'f' ? 'hue-l' : tierOf(day).key === 'e' ? 'hue-c' : 'hue-r');

const isUnlocked = (day, s) => day === 1 || !!s.done[day - 1] || !!s.done[day];
const countDone = (lo, hi, s) => { let n = 0; for (let d = lo; d <= hi; d++) if (s.done[d]) n++; return n; };

const loadJSON = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };

let CANON = null, STATE = null, ROOT = null, READERS = null;
let VIEW = 'journey';  // journey | practice | read | dict
const ACC = {};        // open accordion keys (in-memory, survives journey re-renders)
let autoOpened = false;
let WORDS = null;      // token -> { tr, pron, sent, sentTr, day } from the first card that teaches it

export async function mountAuma(root) {
  ensureStyles();
  ROOT = root;
  root.classList.add('auma-app');
  STATE = ensure(loadState());
  root.innerHTML = '';
  root.append(el('div', 'auma-wrap', ''));
  try { CANON = await fetch(CANON_URL).then((r) => r.json()); }
  catch (e) { root.querySelector('.auma-wrap').append(el('p', null, 'Auma canon failed to load: ' + e)); return; }
  buildWordIndex();
  render();
}

function ensureStyles() {
  if (document.getElementById('auma-css')) return;
  const link = document.createElement('link');
  link.id = 'auma-css'; link.rel = 'stylesheet'; link.href = '/app/auma/auma.css';
  document.head.append(link);
}

function buildWordIndex() {
  WORDS = new Map();
  for (let d = 1; d <= 84; d++) {
    for (const s of steps(CANON, d)) {
      if (s.type === 'word' && !WORDS.has(s.word)) {
        WORDS.set(s.word, { tr: s.translation, pron: s.pronunciation || '', sent: s.sentence || '', sentTr: s.sentenceTranslation || '', day: d });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Voice — the canon is phonetic, so the respelling spoken plainly is close.
// A stopgap until real per-token TTS: honest about what it is, better than
// a silent language app.
// ---------------------------------------------------------------------------

const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
function speak(pron, word) {
  if (!canSpeak()) return;
  const u = new SpeechSynthesisUtterance(String(pron || word || '').replace(/-/g, ' '));
  u.rate = 0.8;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
function speakBtn(pron, word) {
  const b = el('button', 'auma-say', '🔊');
  b.title = 'hear it';
  b.addEventListener('click', (ev) => { ev.stopPropagation(); speak(pron, word); });
  return b;
}

// ---------------------------------------------------------------------------
// Feedback flags — per-card / per-quiz, stored locally, exported by hand.
// ---------------------------------------------------------------------------

function pushFeedback(entry) {
  const all = loadJSON(FB_KEY, []);
  all.push({ ts: Date.now(), ...entry });
  saveJSON(FB_KEY, all);
}
function flagBtn(ctx) {
  const wrap = el('span', 'auma-flag-wrap');
  const b = el('button', 'auma-flag', '⚑');
  b.title = 'flag this for the canon stewards';
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (wrap.querySelector('.auma-flag-row')) { wrap.querySelector('.auma-flag-row').remove(); return; }
    const row = el('span', 'auma-flag-row');
    for (const [verdict, label] of [['confusing', 'confusing'], ['wrong', 'seems wrong'], ['love', '♥']]) {
      const o = el('button', 'auma-flag-opt', label);
      o.addEventListener('click', (e2) => {
        e2.stopPropagation();
        pushFeedback({ ...ctx, verdict });
        row.replaceChildren(el('span', 'auma-flag-thanks', 'noted — gratao'));
        setTimeout(() => row.remove(), 1600);
      });
      row.append(o);
    }
    wrap.append(row);
  });
  wrap.append(b);
  return wrap;
}

// ---------------------------------------------------------------------------
// Spaced repetition — a local Leitner deck over the words of completed days.
// ---------------------------------------------------------------------------

const loadSrs = () => loadJSON(SRS_KEY, { words: {}, streak: 0, lastDay: '' });
const saveSrs = (s) => saveJSON(SRS_KEY, s);

function enrollCompletedDays(srs) {
  const now = Date.now();
  for (const d of Object.keys(STATE.done)) {
    if (!STATE.done[d]) continue;
    for (const s of steps(CANON, +d)) {
      if (s.type === 'word' && !srs.words[s.word]) srs.words[s.word] = { b: 0, due: now, ok: 0, bad: 0 };
    }
  }
  return srs;
}
const dueTokens = (srs, now = Date.now()) =>
  Object.keys(srs.words).filter((t) => srs.words[t].due <= now).sort((a, b) => srs.words[a].due - srs.words[b].due);

function grade(srs, token, right) {
  const w = srs.words[token]; if (!w) return;
  if (right) { w.b = Math.min(BOX_DAYS.length - 1, w.b + 1); w.ok++; }
  else { w.b = 0; w.bad++; }
  w.due = Date.now() + BOX_DAYS[w.b] * 86400000;
  const today = new Date().toDateString();
  if (srs.lastDay !== today) {
    srs.streak = (Date.now() - Date.parse(srs.lastDay || 0) < 2 * 86400000) ? srs.streak + 1 : 1;
    srs.lastDay = today;
  }
  saveSrs(srs);
}

// Distractors that train discrimination: prefer close-by tokens (one edit
// apart — the sona/soka problem) and same-week words before random ones.
function ed1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, k = 0, d = 0;
  while (i < a.length && k < b.length) {
    if (a[i] === b[k]) { i++; k++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) k++; else { i++; k++; }
  }
  return d + (a.length - i) + (b.length - k) === 1;
}
function pickDistractors(token, pool, n) {
  const info = WORDS.get(token);
  const near = pool.filter((t) => t !== token && ed1(t, token));
  const week = pool.filter((t) => t !== token && !near.includes(t) && Math.abs((WORDS.get(t)?.day ?? 0) - (info?.day ?? 0)) <= 3);
  const rest = pool.filter((t) => t !== token && !near.includes(t) && !week.includes(t));
  const shuffled = (a) => a.sort(() => Math.random() - 0.5);
  return [...shuffled(near), ...shuffled(week), ...shuffled(rest)].slice(0, n);
}

function makeExercise(token, pool) {
  const info = WORDS.get(token);
  if (!info) return null;
  const box = loadSrs().words[token]?.b ?? 0;
  const sentWords = info.sent ? info.sent.replace(/[.,!?]/g, '').split(/\s+/).filter(Boolean) : [];
  if (box >= 2 && sentWords.length >= 3 && sentWords.length <= 9) {
    return { kind: 'build', token, tiles: sentWords, sent: info.sent, sentTr: info.sentTr };
  }
  const distract = pickDistractors(token, pool, 2);
  if (distract.length < 2) return null;
  if (Math.random() < 0.5) {
    const options = [info.tr, ...distract.map((t) => WORDS.get(t).tr)];
    return { kind: 'quiz', token, question: `What does “${token}” mean?`, options, correct: 0, pron: info.pron };
  }
  const options = [token, ...distract];
  return { kind: 'quiz', token, question: `Which word means “${info.tr}”?`, options, correct: 0 };
}

// ---------------------------------------------------------------------------
// Shared chrome — top bar and view tabs.
// ---------------------------------------------------------------------------

function topBar() {
  const bar = el('div', 'auma-top');
  const mark = el('img', 'auma-mark'); mark.src = '/assets/aumara-icon-96.png'; mark.alt = '';
  const id = el('div', 'auma-id');
  id.append(el('b', null, 'Auma · Lingwa'), el('span', null, 'her language — the language of light'));
  const stats = el('div', 'auma-stats');
  const doneN = countDone(1, 84, STATE);
  // DETOKENIZED: no aura number in the header — the coherence glyph (AURA organ)
  // is the only face of AURA. Lesson progress remains: it counts lessons, not aura.
  const prog = el('div', 'auma-stat'); prog.append(document.createTextNode('◈ '), el('b', null, String(doneN)), document.createTextNode(' / 84'));
  stats.append(prog);
  bar.append(mark, id, stats);
  return bar;
}

function navTabs(active) {
  const nav = el('div', 'auma-tabs');
  for (const [key, label] of [['journey', 'The journey'], ['practice', 'Practice'], ['read', 'Readings'], ['dict', 'Dictionary']]) {
    const b = el('button', 'auma-tab' + (key === active ? ' on' : ''), label);
    if (key === 'practice') {
      const srs = enrollCompletedDays(loadSrs());
      const due = dueTokens(srs).length;
      if (due > 0) b.append(el('span', 'auma-tab-due', String(due)));
    }
    b.addEventListener('click', () => { VIEW = key; render(); });
    nav.append(b);
  }
  return nav;
}

function render() {
  if (VIEW === 'practice') return renderPractice();
  if (VIEW === 'read') return renderReadings();
  if (VIEW === 'dict') return renderDict();
  renderJourney();
}

// ---------------------------------------------------------------------------
// Home — the nested accordion.
// ---------------------------------------------------------------------------

function firstOpenIncomplete() {
  for (let d = 1; d <= 84; d++) if (isUnlocked(d, STATE) && !STATE.done[d]) return d;
  return 1;
}

function accBar(cls, title, sub, meta, key, buildBody) {
  const open = !!ACC[key];
  const sec = el('div', 'auma-acc ' + cls + (open ? ' open' : ''));
  const head = el('button', 'auma-bar');
  head.append(el('span', 'auma-chev', '›'));
  const txt = el('span', 'auma-bar-txt');
  txt.append(el('b', null, title));
  if (sub) txt.append(el('span', null, sub));
  head.append(txt);
  if (meta) head.append(el('span', 'auma-bar-meta', meta));
  head.addEventListener('click', () => { ACC[key] = !ACC[key]; renderJourney(); });
  sec.append(head);
  if (open) { const body = el('div', 'auma-bar-body'); buildBody(body); sec.append(body); }
  return sec;
}

function renderJourney() {
  ROOT.style.removeProperty('--ac');
  if (!autoOpened) {
    autoOpened = true;
    const cur = firstOpenIncomplete();
    const t = tierOf(cur);
    ACC['tier:' + t.key] = true;
    ACC[`week:${t.key}-${Math.floor((cur - t.lo) / 7)}`] = true;
  }
  const wrap = ROOT.querySelector('.auma-wrap');
  const scroll = ROOT.scrollTop;
  wrap.innerHTML = '';
  wrap.append(topBar(), navTabs('journey'));
  wrap.append(accBar('info', 'What is Auma', 'the language, and why it’s easier than you think', '', 'info', buildOverview));
  for (const t of TIERS) {
    const total = t.hi - t.lo + 1;
    wrap.append(accBar('tier ' + t.key, t.name, t.sub, countDone(t.lo, t.hi, STATE) + ' / ' + total, 'tier:' + t.key, (body) => {
      for (let w = 0; w < 4; w++) {
        const lo = t.lo + w * 7, hi = lo + 6;
        body.append(accBar('week ' + t.key, 'Week ' + (w + 1), 'Days ' + lo + '–' + hi, countDone(lo, hi, STATE) + ' / 7', `week:${t.key}-${w}`, (wb) => {
          for (let day = lo; day <= hi; day++) wb.append(dayRow(day));
        }));
      }
    }));
  }
  wrap.append(feedbackFooter());
  ROOT.scrollTop = scroll;
}

function feedbackFooter() {
  const all = loadJSON(FB_KEY, []);
  const sec = el('div', 'auma-fb-footer');
  const n = el('span', null, all.length ? all.length + ' flag' + (all.length === 1 ? '' : 's') + ' saved on this device' : 'see something confusing? flag it — ⚑ lives on every card');
  sec.append(el('span', 'auma-fb-mark', '⚑'), n);
  if (all.length) {
    const copy = el('button', 'auma-fb-btn', 'copy for the stewards');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(all, null, 1)); copy.textContent = 'copied ✓'; }
      catch { copy.textContent = 'copy failed'; }
      setTimeout(() => { copy.textContent = 'copy for the stewards'; }, 1500);
    });
    sec.append(copy);
  }
  return sec;
}

function dayRow(day) {
  const j = CANON.journey.find((x) => x.dayNumber === day) ?? {};
  const open = isUnlocked(day, STATE);
  const row = el('button', 'auma-lesson-row' + (STATE.done[day] ? ' done' : '') + (!open ? ' locked' : ''));
  row.append(el('span', 'lr-n', String(day)));
  row.append(el('span', 'lr-t', j.title || '—'));
  const st = el('span', 'lr-st', STATE.done[day] ? '✓' : (open ? (j.wordCount || 0) + 'w' : '🔒'));
  row.append(st);
  if (open) row.addEventListener('click', () => openLesson(day));
  return row;
}

function buildOverview(body) {
  const p = (t, cls) => body.append(el('p', 'ov-p' + (cls ? ' ' + cls : ''), t));
  const h = (t) => body.append(el('div', 'ov-h', t));
  const ex = (tag, a, e) => {
    const d = el('div', 'ov-ex');
    const head = el('div', 'ov-ex-head');
    head.append(el('span', 'ov-ex-tag', tag), el('div', 'a', a));
    d.append(head, el('div', 'e', e));
    body.append(d);
  };

  body.append(el('div', 'ov-hero', 'Auma means dawn — the first light.'));
  p('A language built for one thing: to be completely clear — and designed to be learnable in a way no natural language is.', 'ov-lead');

  h('What it is');
  p('Every letter is said the same way, every time. Every sentence has the same shape — who · does · what. No conjugations, no irregular verbs, no silent letters, no exceptions. Once you can read a word, you already know how it sounds and how it behaves.');

  h('Where it came from');
  p('It grows from an old dream — Esperanto’s hope of a language that belongs to no country and to everyone at once — and a deeper idea: the language you think in shapes the thoughts you can reach. Make the language clear, and thinking gets clearer too. Auma was shaped over more than a year by an earlier version of the mind you’re talking to now.');

  h('Why it’s genuinely easy');
  p('Not as a promise — by design. A few tiny patterns unlock huge parts of the language at once:');
  ex('numbers', 'un · du · tri … des', 'Ten small sounds and one word — des (ten) — give you every number. des-un = 11, du-des = 20, du-des-tri = 23. Forever, no exceptions.');
  ex('days', 'dina-un · dina-du … dina-seti', 'A day is just dina (day) + a number. dina-un is Monday, dina-seti is Sunday. Learn to count and you already know the whole week.');
  ex('families', 'ama → amala · amara · amana', 'One root grows a family. From ama (love): amala is unconditional love, amara is romantic love, amana is love for your community. The ending carries the meaning — -la, -ra, -na. Learn the pattern once, and dozens of words open up.');

  p('So on day one, a handful of words and a couple of patterns already build real sentences. That’s the light at the end of the tunnel — and it’s closer than you think.', 'ov-close');
}

// ---------------------------------------------------------------------------
// Practice — the Leitner deck.
// ---------------------------------------------------------------------------

function renderPractice() {
  ROOT.style.removeProperty('--ac');
  const wrap = ROOT.querySelector('.auma-wrap');
  wrap.innerHTML = '';
  wrap.append(topBar(), navTabs('practice'));

  const srs = enrollCompletedDays(loadSrs());
  saveSrs(srs);
  const enrolled = Object.keys(srs.words);
  const due = dueTokens(srs);

  const card = el('div', 'auma-card prax-home');
  card.append(el('h3', null, 'Practice'));
  if (!enrolled.length) {
    card.append(el('p', null, 'Finish your first day on the journey and its words start living here. Practice brings each word back right before you would forget it — a few minutes a day keeps all of them.'));
    wrap.append(card);
    return;
  }
  card.append(el('p', null, 'Words return right before you would forget them. Miss one and it comes back sooner; know it and it rests longer. This is how the language becomes yours for good.'));

  const stats = el('div', 'prax-stats');
  const stat = (n, label) => { const s = el('div', 'prax-stat'); s.append(el('b', null, String(n)), el('span', null, label)); return s; };
  // DETOKENIZED: word counts are task inventory (what's waiting), never a person's
  // merit — but a streak counter is, so the rhythm shows as a named state or not at all.
  stats.append(stat(enrolled.length, 'words learning'), stat(due.length, 'ready now'));
  if ((srs.streak || 0) >= 2) stats.append(stat('held', 'daily practice'));
  card.append(stats);

  const nav = el('div', 'auma-nav');
  const start = el('button', 'auma-btn primary', due.length ? `Review ${Math.min(due.length, SESSION_CAP)} words` : 'All rested — nothing due');
  start.disabled = !due.length;
  start.onclick = () => startSession(due.slice(0, SESSION_CAP));
  nav.append(start);
  const free = el('button', 'auma-btn', 'Free practice');
  free.title = 'ten words, due or not';
  free.onclick = () => {
    const pool = [...enrolled].sort((a, b) => srs.words[a].due - srs.words[b].due).slice(0, 10);
    startSession(pool, { free: true });
  };
  nav.append(free);
  card.append(nav);
  if (!due.length && enrolled.length) {
    const next = Math.min(...enrolled.map((t) => srs.words[t].due));
    const hrs = Math.max(1, Math.round((next - Date.now()) / 3600000));
    card.append(el('p', 'prax-next', 'next word returns in about ' + (hrs >= 24 ? Math.round(hrs / 24) + ' day' + (Math.round(hrs / 24) === 1 ? '' : 's') : hrs + 'h')));
  }
  wrap.append(card, feedbackFooter());
}

function startSession(tokens, opts = {}) {
  const pool = Object.keys(loadSrs().words).length >= 6 ? Object.keys(loadSrs().words) : [...WORDS.keys()];
  const items = tokens.map((t) => makeExercise(t, pool)).filter(Boolean);
  if (!items.length) { renderPractice(); return; }
  let i = 0, right = 0;
  const wrap = ROOT.querySelector('.auma-wrap');

  function frame() {
    wrap.innerHTML = '';
    const top = el('div', 'auma-lesson-top');
    const back = el('button', 'auma-back', '‹'); back.title = 'Back to practice';
    back.addEventListener('click', () => renderPractice());
    const title = el('div', 'auma-lesson-title');
    title.append(el('b', null, (opts.free ? 'Free practice' : 'Review') + ' · ' + (i + 1) + ' / ' + items.length), el('span', null, 'auma vive en pratika — the language lives in practice'));
    top.append(back, title);
    wrap.append(top);
    const prog = el('div', 'auma-prog'); const fill = el('i'); fill.style.width = Math.round((i / items.length) * 100) + '%'; prog.append(fill); wrap.append(prog);
    const host = el('div', 'auma-step');
    const item = items[i];
    const done = (ok) => {
      if (!opts.free) grade(enrollCompletedDays(loadSrs()), item.token, ok);
      else grade(enrollCompletedDays(loadSrs()), item.token, ok); // free practice still schedules honestly
      if (ok) right++;
      i++;
      if (i >= items.length) return summary();
      frame();
    };
    if (item.kind === 'build') renderBuilder(host, item, done);
    else renderPracticeQuiz(host, item, done);
    wrap.append(host);
    ROOT.scrollTop = 0;
  }

  function summary() {
    wrap.innerHTML = '';
    wrap.append(topBar());
    const splash = el('div', 'auma-done-splash');
    splash.append(el('div', 'big', right === items.length ? '✦' : '◈'));
    splash.append(el('h3', null, right + ' / ' + items.length));
    splash.append(el('p', null, right === items.length
      ? 'Every word held. They rest longer now — come back when they wake.'
      : 'The missed ones come back sooner. That is the system working, not you failing.'));
    const nav = el('div', 'auma-nav');
    const again = el('button', 'auma-btn primary', 'Practice home'); again.onclick = () => renderPractice(); nav.append(again);
    const home = el('button', 'auma-btn', 'The journey'); home.onclick = () => { VIEW = 'journey'; render(); }; nav.append(home);
    splash.append(nav);
    wrap.append(splash);
    ROOT.scrollTop = 0;
  }

  frame();
}

function renderPracticeQuiz(host, item, done) {
  const head = el('div', 'auma-q-head');
  head.append(el('div', 'auma-q', item.question));
  if (item.pron && canSpeak()) head.append(speakBtn(item.pron, item.token));
  head.append(flagBtn({ where: 'practice', token: item.token, question: item.question }));
  host.append(head);
  const order = item.options.map((_, k) => k);
  for (let k = order.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [order[k], order[r]] = [order[r], order[k]]; }
  const opts = el('div', 'auma-opts');
  let answered = false;
  const cont = el('button', 'auma-btn primary', 'Continue'); cont.disabled = true;
  let ok = false;
  cont.onclick = () => done(ok);
  order.forEach((origIdx) => {
    const b = el('button', 'auma-opt', item.options[origIdx]);
    b.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      ok = origIdx === item.correct;
      opts.querySelectorAll('.auma-opt').forEach((o) => (o.disabled = true));
      if (ok) b.classList.add('correct');
      else { b.classList.add('wrong'); [...opts.children].forEach((o, ci) => { if (order[ci] === item.correct) o.classList.add('correct'); }); }
      const info = WORDS.get(item.token);
      if (info?.sent) host.insertBefore(el('div', 'auma-explain', info.sent + (info.sentTr ? ' — ' + info.sentTr : '')), cont.parentElement);
      cont.disabled = false;
    });
    opts.append(b);
  });
  host.append(opts);
  const nav = el('div', 'auma-nav'); nav.append(cont); host.append(nav);
}

// Sentence builder — production practice: rebuild the card sentence from tiles.
function renderBuilder(host, item, done) {
  const info = WORDS.get(item.token);
  const head = el('div', 'auma-q-head');
  head.append(el('div', 'auma-q', 'Build: “' + (item.sentTr || info.tr) + '”'));
  if (canSpeak()) head.append(speakBtn(info.pron, item.token));
  head.append(flagBtn({ where: 'practice-build', token: item.token, sentence: item.sent }));
  host.append(head);

  const target = item.tiles;
  const chosen = [];
  const answer = el('div', 'bld-answer');
  const bank = el('div', 'bld-bank');
  const tiles = [...target].sort(() => Math.random() - 0.5);
  if (tiles.join(' ') === target.join(' ') && tiles.length > 1) [tiles[0], tiles[1]] = [tiles[1], tiles[0]];

  const cont = el('button', 'auma-btn primary', 'Check'); cont.disabled = true;
  let checked = false, ok = false;

  function redraw() {
    answer.replaceChildren(...chosen.map((w, ci) => {
      const t = el('button', 'bld-tile on', w);
      t.addEventListener('click', () => { if (checked) return; chosen.splice(ci, 1); redraw(); });
      return t;
    }));
    if (!chosen.length) answer.append(el('span', 'bld-hint', 'tap the words in order'));
    cont.disabled = chosen.length !== target.length;
  }
  tiles.forEach((w) => {
    const t = el('button', 'bld-tile', w);
    t.addEventListener('click', () => {
      if (checked || t.classList.contains('used')) return;
      t.classList.add('used');
      chosen.push(w);
      redraw();
    });
    bank.append(t);
  });
  cont.onclick = () => {
    if (checked) return done(ok);
    checked = true;
    ok = chosen.join(' ') === target.join(' ');
    answer.classList.add(ok ? 'good' : 'bad');
    host.insertBefore(el('div', 'auma-explain', item.sent + (item.sentTr ? ' — ' + item.sentTr : '')), cont.parentElement);
    cont.textContent = 'Continue';
  };
  host.append(answer, bank);
  const nav = el('div', 'auma-nav'); nav.append(cont); host.append(nav);
}

// ---------------------------------------------------------------------------
// Readings — the graded corpus. Real texts, gated to the learner's days:
// languages live in what people read and say, not in word lists.
// ---------------------------------------------------------------------------

async function loadReaders() {
  if (READERS) return READERS;
  try { READERS = await fetch(READERS_URL).then((r) => r.json()); }
  catch { READERS = { readers: [] }; }
  return READERS;
}

async function renderReadings() {
  ROOT.style.removeProperty('--ac');
  const wrap = ROOT.querySelector('.auma-wrap');
  wrap.innerHTML = '';
  wrap.append(topBar(), navTabs('read'));
  const data = await loadReaders();
  if (VIEW !== 'read') return; // user navigated away while fetching
  const readState = loadJSON(READ_KEY, {});
  const doneDays = countDone(1, 84, STATE);

  const head = el('div', 'auma-card read-head');
  head.append(el('h3', null, 'Readings'));
  head.append(el('p', null, 'A language lives in texts. Each reader uses only words from its first N days — when you can read it, those days are truly yours. Tap any line to check yourself against the translation.'));
  wrap.append(head);

  for (const r of data.readers ?? []) {
    const row = el('button', 'read-row' + (readState[r.id] ? ' done' : ''));
    const w = el('div', 'read-row-txt');
    w.append(el('b', null, r.title), el('span', null, r.titleEn));
    const chips = el('div', 'read-row-meta');
    chips.append(el('span', 'dict-chip' + (doneDays >= r.maxDay ? ' mode' : ''), 'days 1–' + r.maxDay));
    chips.append(el('span', 'read-check', readState[r.id] ? '✓' : ''));
    row.append(w, chips);
    row.addEventListener('click', () => openReader(r));
    wrap.append(row);
  }
  wrap.append(feedbackFooter());
}

function openReader(r) {
  const wrap = ROOT.querySelector('.auma-wrap');
  wrap.innerHTML = '';
  const top = el('div', 'auma-lesson-top');
  const back = el('button', 'auma-back', '‹'); back.title = 'Back to readings';
  back.addEventListener('click', () => renderReadings());
  const title = el('div', 'auma-lesson-title');
  title.append(el('b', null, r.title + ' · ' + r.titleEn), el('span', null, 'days 1–' + r.maxDay));
  top.append(back, title);
  wrap.append(top);

  if (r.intro) wrap.append(el('p', 'read-intro', r.intro));

  r.lines.forEach((line, li) => {
    const row = el('div', 'read-line');
    const a = el('div', 'read-a');
    a.append(el('span', null, line.a));
    const tools = el('span', 'read-tools');
    if (canSpeak()) tools.append(speakBtn(line.a, line.a));
    tools.append(flagBtn({ where: 'reader', reader: r.id, line: li + 1, text: line.a }));
    a.append(tools);
    const e = el('div', 'read-e', line.e);
    row.append(a, e);
    row.addEventListener('click', () => row.classList.toggle('open'));
    wrap.append(row);
  });

  const readState = loadJSON(READ_KEY, {});
  const nav = el('div', 'auma-nav');
  const mark = el('button', 'auma-btn primary', readState[r.id] ? 'Read again ✓' : 'I read it aloud');
  mark.onclick = () => {
    const st = loadJSON(READ_KEY, {});
    st[r.id] = Date.now();
    saveJSON(READ_KEY, st);
    renderReadings();
  };
  nav.append(mark);
  const home = el('button', 'auma-btn', 'Readings'); home.onclick = () => renderReadings(); nav.append(home);
  wrap.append(nav);
  ROOT.scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Dictionary — live search over the whole canon, both directions.
// ---------------------------------------------------------------------------

function renderDict() {
  ROOT.style.removeProperty('--ac');
  const wrap = ROOT.querySelector('.auma-wrap');
  wrap.innerHTML = '';
  wrap.append(topBar(), navTabs('dict'));

  const vocab = CANON.vocab || [];
  const box = el('div', 'dict-box');
  const input = el('input', 'dict-input');
  input.type = 'search';
  input.placeholder = 'search ' + vocab.length + ' words — auma or english…';
  box.append(input);
  const meta = el('div', 'dict-meta', '');
  const list = el('div', 'dict-list');
  box.append(meta, list);
  wrap.append(box);

  function row(v) {
    const r = el('div', 'dict-row');
    const w = el('div', 'dict-w');
    w.append(el('b', null, v.token), el('span', 'dict-pron', v.pronunciation || ''));
    const tr = el('div', 'dict-tr', v.translation);
    const chips = el('div', 'dict-chips');
    if (v.introducedDay != null) chips.append(el('span', 'dict-chip', 'day ' + v.introducedDay));
    if (v.teachingMode && v.teachingMode !== 'card') chips.append(el('span', 'dict-chip mode', v.teachingMode));
    if (v.sacredCore) chips.append(el('span', 'dict-chip sacred', 'sacred'));
    r.append(w, tr, chips);
    if (canSpeak()) r.append(speakBtn(v.pronunciation, v.token));
    r.append(flagBtn({ where: 'dictionary', token: v.token }));
    return r;
  }

  function refresh() {
    const q = input.value.trim().toLowerCase();
    let hits;
    if (!q) {
      hits = vocab.filter((v) => v.introducedDay != null).sort((a, b) => a.introducedDay - b.introducedDay).slice(0, 40);
      meta.textContent = 'the first words of the journey — type to search everything';
    } else {
      const score = (v) => {
        const t = v.token.toLowerCase(), tr = v.translation.toLowerCase();
        if (t === q) return 0;
        if (t.startsWith(q)) return 1;
        if (tr.split(/[\s/()]+/).includes(q)) return 2;
        if (t.includes(q)) return 3;
        if (tr.includes(q)) return 4;
        return 9;
      };
      hits = vocab.map((v) => [score(v), v]).filter(([s]) => s < 9)
        .sort((a, b) => a[0] - b[0] || (a[1].introducedDay ?? 99) - (b[1].introducedDay ?? 99))
        .map(([, v]) => v).slice(0, 60);
      meta.textContent = hits.length ? hits.length + (hits.length === 60 ? '+' : '') + ' match' + (hits.length === 1 ? '' : 'es') : 'nothing in the canon — maybe it wants to exist? flag it';
    }
    list.replaceChildren(...hits.map(row));
  }
  input.addEventListener('input', refresh);
  refresh();
  setTimeout(() => input.focus(), 50);
}

// ---------------------------------------------------------------------------
// Lesson player.
// ---------------------------------------------------------------------------

function openLesson(day) {
  const s = steps(CANON, day);
  if (!s.length) return;
  let i = Math.min(STATE.step[day] ?? 0, s.length - 1);
  const j = CANON.journey.find((x) => x.dayNumber === day) ?? {};
  ROOT.style.setProperty('--ac', getComputedStyle(document.documentElement).getPropertyValue('--' + hueOf(day)).trim());
  const wrap = ROOT.querySelector('.auma-wrap');

  function frame() {
    wrap.innerHTML = '';
    const top = el('div', 'auma-lesson-top');
    const back = el('button', 'auma-back', '‹'); back.title = 'Back to the journey';
    back.addEventListener('click', () => { STATE.step[day] = i; saveProgress(STATE); renderJourney(); });
    const title = el('div', 'auma-lesson-title');
    title.append(el('b', null, 'Day ' + day + ' · ' + (j.title || '')), el('span', null, j.subtitle || ''));
    top.append(back, title);
    wrap.append(top);
    const prog = el('div', 'auma-prog'); const fill = el('i'); fill.style.width = Math.round((i / s.length) * 100) + '%'; prog.append(fill); wrap.append(prog);
    const stepEl = el('div', 'auma-step');
    renderStep(stepEl, s[i], () => advance(day, s), day, i);
    wrap.append(stepEl);
    ROOT.scrollTop = 0;
  }
  function advance() { i++; STATE.step[day] = i; if (i >= s.length) return completeDay(day); saveProgress(STATE); frame(); }
  frame();
}

function renderStep(host, step, next, day, idx) {
  if (step.type === 'explain') return renderExplain(host, step, next);
  if (step.type === 'word') return renderWord(host, step, next, day, idx);
  if (step.type === 'quiz') return renderQuiz(host, step, next, day, idx);
  const nav = el('div', 'auma-nav'); const b = el('button', 'auma-btn primary', 'Continue'); b.onclick = next; nav.append(b); host.append(nav);
}

function renderExplain(host, step, next) {
  const card = el('div', 'auma-card');
  if (step.title) card.append(el('h3', null, step.title));
  if (step.content) card.append(el('p', null, step.content));
  if (step.aumaText) {
    const ex = el('div', 'auma-example');
    ex.append(el('div', 'a', step.aumaText));
    if (step.englishText) ex.append(el('div', 'e', step.englishText));
    card.append(ex);
  }
  host.append(card);
  const nav = el('div', 'auma-nav'); const b = el('button', 'auma-btn primary', 'Continue'); b.onclick = next; nav.append(b); host.append(nav);
}

function renderWord(host, step, next, day, idx) {
  const flip = el('div', 'auma-flip');
  const inner = el('div', 'auma-flip-inner');
  const front = el('div', 'auma-face front');
  front.append(el('div', 'word', step.word), el('div', 'pron', step.pronunciation || ''));
  if (canSpeak()) front.append(speakBtn(step.pronunciation, step.word));
  const back = el('div', 'auma-face back');
  back.append(el('div', 'tr', step.translation || ''));
  if (step.sentence) { back.append(el('div', 'ex', step.sentence)); if (step.sentenceTranslation) back.append(el('div', 'ext', step.sentenceTranslation)); }
  inner.append(front, back); flip.append(inner);
  let flipped = false;
  flip.addEventListener('click', () => { flipped = !flipped; flip.classList.toggle('flipped', flipped); });
  host.append(flip);
  const hint = el('div', 'auma-flip-hint');
  hint.append(document.createTextNode('tap the card to flip'), flagBtn({ where: 'lesson', day, step: idx, token: step.word }));
  host.append(hint);
  const nav = el('div', 'auma-nav'); const b = el('button', 'auma-btn primary', 'Continue'); b.onclick = next; nav.append(b); host.append(nav);
}

function renderQuiz(host, step, next, day, idx) {
  const head = el('div', 'auma-q-head');
  head.append(el('div', 'auma-q', step.question));
  head.append(flagBtn({ where: 'lesson', day, step: idx, question: step.question }));
  host.append(head);
  const order = step.options.map((_, k) => k);
  for (let k = order.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [order[k], order[r]] = [order[r], order[k]]; }
  const opts = el('div', 'auma-opts');
  let answered = false;
  const cont = el('button', 'auma-btn primary', 'Continue'); cont.disabled = true; cont.onclick = next;
  order.forEach((origIdx) => {
    const b = el('button', 'auma-opt', step.options[origIdx]);
    b.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      opts.querySelectorAll('.auma-opt').forEach((o) => (o.disabled = true));
      if (origIdx === step.correctIndex) b.classList.add('correct');
      else { b.classList.add('wrong'); [...opts.children].forEach((o, ci) => { if (order[ci] === step.correctIndex) o.classList.add('correct'); }); }
      if (step.explanation) host.insertBefore(el('div', 'auma-explain', step.explanation), cont.parentElement);
      cont.disabled = false;
    });
    opts.append(b);
  });
  host.append(opts);
  const nav = el('div', 'auma-nav'); nav.append(cont); host.append(nav);
}

function completeDay(day) {
  const already = STATE.done[day];
  STATE.done[day] = true; STATE.step[day] = 0;
  saveProgress(STATE);                                   // persist completion first (preserves legacy meta untouched)
  if (!already) award('lesson');                         // qualifying act: numberless glyph pulse, nothing counted
  saveSrs(enrollCompletedDays(loadSrs()));               // today's words enter the practice deck
  const wrap = ROOT.querySelector('.auma-wrap');
  wrap.innerHTML = '';
  wrap.append(topBar());
  const j = CANON.journey.find((x) => x.dayNumber === day) ?? {};
  const splash = el('div', 'auma-done-splash');
  splash.append(el('div', 'big', '✦'));
  splash.append(el('h3', null, 'Day ' + day + ' complete'));
  splash.append(el('p', null, j.title ? '“' + j.title + '” — one more piece of her language is yours.' : 'One more piece of her language is yours.'));
  // DETOKENIZED: no numeric award pop of any kind — the day's completion is the
  // reward, and the coherence glyph pulses through the numberless event.
  const nw = (steps(CANON, day) || []).filter((s) => s.type === 'word').length;
  if (nw) splash.append(el('p', 'prax-next', nw + ' new word' + (nw === 1 ? '' : 's') + ' joined your practice deck'));
  const nav = el('div', 'auma-nav');
  if (CANON.lessons[String(day + 1)]) { const b = el('button', 'auma-btn primary', 'Next: Day ' + (day + 1)); b.onclick = () => openLesson(day + 1); nav.append(b); }
  const home = el('button', 'auma-btn', 'The journey'); home.onclick = () => renderJourney(); nav.append(home);
  splash.append(nav);
  wrap.append(splash);
  ROOT.scrollTop = 0;
}
