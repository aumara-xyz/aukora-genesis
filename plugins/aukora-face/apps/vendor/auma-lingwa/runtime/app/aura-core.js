// Aukora Spatial — aura-core: LEGACY tally custodian + act-quality gate.
//
// DETOKENIZED (AURA lane round 1, docs/mesh/handoff/AURA.md): AURA is no longer a
// token, score, balance, or currency — it is an evolving, nonnumeric coherence and
// witness pattern whose primary representation is the cymatic glyph. This module
// therefore STOPPED WRITING the numeric tally: award() still runs its act-quality
// gates (spam/burst/dedupe) and fires a numberless 'aura-changed' pulse so the
// glyph stays alive on real acts, but no field of the legacy tally is incremented
// ever again. The stored numbers are preserved READ-ONLY as legacy data (deletion/
// migration is a later, deliberate brick — never a silent one). Nothing here is a
// proof of humanity; nothing here signs, unlocks, gates, or applies anything.
//
// HONESTY (hard, load-bearing): this counter is LOCAL to this device. Anyone
// with a browser console can edit it. A chat reply is client-observed only and
// proves nothing — a stub door on 127.0.0.1 would satisfy it just the same.
// Nothing here is minted or witnessed; it means nothing until a receipt lands on
// the governed chain. It is a motivational SHADOW of the real, witnessed AURA and
// may only ever be reconciled DOWNWARD to whatever the chain says is true.
// Nothing here signs, unlocks, or gates — only the Aumlok key does that.
//
// The remaining gates (length/format filter, repeat filter, burst damper) are a
// SPAM + BURST damper on the qualifying-act signal. They are NOT anti-farming
// that prevents farming, and NOT a proof of anything about the person acting.
//
// HARDENING (2026-07-07, "so people can't cheat easily") — two honest layers:
//   1. An integrity SEAL over the earning fields (salted local checksum in a
//      second storage key). Editing the tally in devtools now breaks the seal,
//      and a broken seal RE-DERIVES the tally from evidence (lessons actually
//      completed) — messages/readings/streak, which leave no evidence, reset.
//   2. CLOCK guard: a rolled-back clock qualifies nothing (the high-water mark
//      survives in storage; time must catch up).
// Both raise the bar from "type a number in the console" to "read this source
// and reproduce the seal" — a speed bump for casual cheating, NOT security.
// Anyone who reads this file can still forge everything. That is fine: the
// number is provisional, and the chain re-derives from its own evidence.

export const STATE_KEY = 'auma-lingwa-v15';
const SEAL_KEY = 'aukora-aura-seal-v1';

// DETOKENIZED: these are qualifying-act markers and LEGACY re-derivation
// constants only (rederiveFromEvidence must keep the historical lesson weight
// so a seal repair reconstructs the same frozen numbers it always did). They
// are never displayed and never summed into anything new; the DAILY_CAP /
// STREAK_FIB economy is gone with the tally it fed.
const MSG_BASE = 1;
const LESSON_BASE = 5;
const READING_BASE = 5;
const MIN_GAP_MS = 20000;      // messages closer than this earn nothing
const READING_MIN_GAP_MS = 25000; // readings closer than this earn nothing (anti-mash)
const BURST_PER_MIN = 8;       // hard-zero after this many awards in a rolling minute
const HASH_WINDOW = 50;        // remember the last N message hashes for dedupe

export function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY)) ?? {}; } catch { return {}; }
}
export function saveState(s) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
    writeSeal(s);
  } catch { /* quota */ }
}

// ---- the integrity seal -------------------------------------------------
// A salted checksum over the earning fields, kept in a SECOND key so the
// obvious cheat (edit the number in the state blob) breaks it. Deliberately
// a plain sync hash, not crypto — the adversary can read this source; the
// seal only prices casual tampering. djb2 + FNV-1a interleaved.
function sealSig(salt, payload) {
  const str = salt + '|' + payload;
  let a = 5381, b = 2166136261;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = ((a * 33) ^ c) >>> 0;
    b = Math.imul(b ^ c, 16777619) >>> 0;
  }
  return a.toString(16) + '-' + b.toString(16);
}
function doneCount(s) { return Object.values(s.done ?? {}).filter(Boolean).length; }
function sealPayload(s) {
  const m = s.meta ?? {};
  return JSON.stringify([
    Number(s.aura) || 0, m.fromLessons, m.fromMessages, m.fromReadings, m.fromStreak,
    m.streak, m.lastStreakDay, m.todayEarned, m.day, doneCount(s),
  ]);
}
function newSalt() {
  try { const a = new Uint32Array(4); crypto.getRandomValues(a); return Array.from(a, (x) => x.toString(16)).join(''); }
  catch { return String(Math.random()).slice(2) + Date.now().toString(16); }
}
function readSeal() {
  try { return JSON.parse(localStorage.getItem(SEAL_KEY)) ?? null; } catch { return null; }
}
function writeSeal(s) {
  const rec = readSeal();
  const salt = (rec && rec.salt) || newSalt();
  try { localStorage.setItem(SEAL_KEY, JSON.stringify({ salt, sig: sealSig(salt, sealPayload(s)) })); } catch { /* quota */ }
}

// A broken seal never argues — it re-derives the tally from the only local
// evidence there is: lessons actually completed. Messages, readings and the
// streak leave no evidence, so they reset. Loss-only, same doctrine as the
// chain reconciliation (docs/AURA_ECONOMY_AND_KNVS.md §7).
function rederiveFromEvidence(s) {
  const m = s.meta;
  const lessons = doneCount(s);
  s.aura = lessons * LESSON_BASE;
  m.fromLessons = lessons * LESSON_BASE;
  m.fromMessages = 0; m.fromReadings = 0; m.fromStreak = 0;
  m.streak = 0; m.lastStreakDay = ''; m.streakLog = [];
  m.todayEarned = 0;
  m.tamperedAt = Date.now();
}
function verifySeal(s) {
  const m = s.meta;
  const rec = readSeal();
  if (!rec || !rec.salt) {
    // no seal: either a pre-seal legacy state (grandfather it, once) or the
    // seal was deleted after being written (sealedOnce remembers) — tamper
    if (m.sealedOnce) { rederiveFromEvidence(s); saveState(s); }
    else if (localStorage.getItem(STATE_KEY) != null) { m.sealedOnce = true; saveState(s); }
    return;
  }
  if (rec.sig !== sealSig(rec.salt, sealPayload(s))) { rederiveFromEvidence(s); saveState(s); return; }
  // seal valid but the flag never persisted (e.g. read-only paths ran first):
  // persist it now, or deleting the seal later would look like legacy state
  if (!m.sealedOnce) { m.sealedOnce = true; saveState(s); }
}

// Guarantee every field this app relies on exists; migrate the old xp tally.
export function ensure(s) {
  if (s.aura == null) s.aura = s.xp ?? 0;
  delete s.xp;
  s.done = s.done ?? {};
  s.step = s.step ?? {};
  const m = (s.meta = s.meta ?? {});
  m.fromLessons = m.fromLessons ?? 0;
  m.fromMessages = m.fromMessages ?? 0;
  m.fromReadings = m.fromReadings ?? 0;
  m.day = m.day ?? '';
  m.todayEarned = m.todayEarned ?? 0;   // message+reading-aura earned on m.day
  m.msgCount = m.msgCount ?? 0;         // awards in the rolling minute
  m.minuteStart = m.minuteStart ?? 0;
  m.lastMsgTs = m.lastMsgTs ?? 0;
  m.lastReadTs = m.lastReadTs ?? 0;
  m.hashes = m.hashes ?? [];
  m.streak = m.streak ?? 0;             // consecutive local days with a positive award
  m.lastStreakDay = m.lastStreakDay ?? '';
  m.fromStreak = m.fromStreak ?? 0;
  m.lastStreakTs = m.lastStreakTs ?? 0; // wall-clock of the last streak grant (12h guard)
  m.streakLog = m.streakLog ?? [];      // recent streak-grant timestamps (8-per-week window)
  m.lastSeenTs = m.lastSeenTs ?? 0;     // high-water clock — a rolled-back clock earns nothing
  m.capResetTs = m.capResetTs ?? 0;     // last daily-cap reset — flipping the date doesn't refill the cap
  m.sealedOnce = m.sealedOnce ?? false; // the seal has been written at least once (deleting it = tamper)
  m.tamperedAt = m.tamperedAt ?? 0;     // last integrity failure (shown honestly on the AURA page)
  // which domains sounded today (lesson/message/reading) — feeds The Tuning's
  // daily notes (tuning.js). Deliberately NOT in the seal payload: cosmetic,
  // and adding it there would break every existing seal on upgrade.
  m.todaySources = m.todaySources ?? {};
  // DETOKENIZED: which act KINDS have ever sounded on this device — qualitative
  // marks (booleans), never counts. The Tuning's ladder climbs on these + lessons.
  m.domainsSounded = m.domainsSounded ?? {};
  verifySeal(s);
  return s;
}

// Persist ONLY progress (done/step) into the freshest localStorage, preserving
// aura + meta written by award(). This is how auma.js can keep saving lesson
// progress without ever clobbering the message-aura the chat writes. One tally,
// two concerns, no drift.
export function saveProgress(s) {
  const fresh = ensure(loadState());
  fresh.done = s.done;
  fresh.step = s.step;
  saveState(fresh);
  s.aura = fresh.aura;   // keep the caller's in-memory display in sync
}

const dayStr = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const todayStr = () => dayStr(new Date());
// Day roll touches ONLY the qualitative day marker + which domains sounded — the
// frozen legacy tally fields are never written again, not even to zero them.
function rollDay(m) {
  const t = todayStr();
  if (m.day !== t) { m.day = t; m.todaySources = {}; }
}

// djb2 over a normalized form: lowercased, whitespace-collapsed, and with any
// trailing digits/punctuation stripped so the trivial "hi 1 / hi 2" increment
// and a small rotating pool are at least inconvenient. Cosmetic, not security.
function hashText(text) {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s\d\p{P}]+$/u, '');
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = (((h * 33) ^ norm.charCodeAt(i)) >>> 0);
  return h;
}

// DETOKENIZED: award() no longer awards. It evaluates the SAME act-quality gates
// (so a spam blast still moves nothing) and, when an act qualifies, fires a
// numberless 'aura-changed' pulse for the glyph. It never mutates the legacy
// tally fields (aura / from* / todayEarned / streak). Returns
// { earned: 0, qualified, reason } — earned is 0 forever; callers must not
// display numbers from here.
export function award(kind, opts = {}) {
  const s = ensure(loadState());
  const m = s.meta;
  const now = Date.now();
  // a clock rolled backwards earns nothing — that's how cap/streak farms
  // start. The high-water mark survives in storage; time must catch up.
  if (now < (m.lastSeenTs || 0) - 3600000) {
    saveState(s);
    return { earned: 0, qualified: false, reason: 'clock-rollback' };
  }
  m.lastSeenTs = Math.max(m.lastSeenTs || 0, now);
  rollDay(m);
  let earned = 0, reason = 'ok';

  if (kind === 'lesson') {
    earned = LESSON_BASE; // qualifies; tally untouched (legacy fields are read-only)
  } else if (kind === 'message') {
    const text = String(opts.text ?? '').trim();
    const tokens = text.split(/\s+/).filter(Boolean);
    if (text.length < 12 || tokens.length < 3 || !/[a-zA-ZÀ-ɏ]/.test(text) || text.startsWith('/')) {
      reason = 'too-short-or-command';
    } else {
      const h = hashText(text);
      if (m.hashes.includes(h)) {
        reason = 'repeat';
      } else if (now - m.lastMsgTs < MIN_GAP_MS) {
        reason = 'too-fast';
      } else {
        if (now - m.minuteStart > 60000) { m.minuteStart = now; m.msgCount = 0; }
        m.msgCount++;
        if (m.msgCount > BURST_PER_MIN) {
          reason = 'burst';
        } else {
          earned = MSG_BASE; // qualifies; anti-spam bookkeeping advances, tally does not
          m.lastMsgTs = now;
          m.hashes.push(h);
          if (m.hashes.length > HASH_WINDOW) m.hashes.shift();
        }
      }
    }
  } else if (kind === 'reading') {
    // A completed six-line cast (not grid browsing). Shares the daily cosmetic cap
    // with messages; a min-gap damps button-mashing. Same honesty as everything
    // here: provisional, local, means nothing until witnessed on the chain.
    // (The round-2 Graticube tie-in is withdrawn by the owner: the game will
    // register through the coherence system, not the aura tally.)
    if (opts.source !== 'cast') {
      reason = 'not-a-cast';
    } else if (now - m.lastReadTs < READING_MIN_GAP_MS) {
      reason = 'too-fast';
    } else {
      earned = READING_BASE; // qualifies; tally untouched
      m.lastReadTs = now;
    }
  } else {
    reason = 'unknown-kind';
  }

  // DETOKENIZED: a qualifying act pulses the glyph and marks which domain sounded
  // today (The Tuning reads it qualitatively). No number is computed, stored, or
  // carried on the event — the pattern is read, never scored.
  const qualified = earned > 0;
  if (qualified) { m.todaySources[kind] = true; m.domainsSounded[kind] = true; }
  saveState(s); // bookkeeping only (hashes, timers, todaySources) — tally fields untouched
  if (qualified) {
    window.dispatchEvent(new CustomEvent('aura-changed', { detail: { kind } }));
  }
  return { earned: 0, qualified, reason };
}

// Read-only view for display surfaces (AURA page, Auma header).
export function readAura() {
  const s = ensure(loadState());
  const m = s.meta;
  rollDay(m);
  // streak reads as broken if neither today nor yesterday had an award
  const yesterday = dayStr(new Date(Date.now() - 86400000));
  const streakLive = m.lastStreakDay === todayStr() || m.lastStreakDay === yesterday;
  return {
    aura: Number(s.aura) || 0,
    lessons: Object.values(s.done).filter(Boolean).length,
    fromLessons: m.fromLessons,
    fromMessages: m.fromMessages,
    fromReadings: m.fromReadings,
    fromStreak: m.fromStreak,
    streak: streakLive ? m.streak : 0,
    streakToday: m.lastStreakDay === todayStr(),
    todayEarned: m.todayEarned,
    todaySources: { ...m.todaySources },
    domainsSounded: { ...m.domainsSounded },
    tamperedAt: m.tamperedAt || 0,   // last integrity failure — surfaces honestly, never hidden
  };
}
