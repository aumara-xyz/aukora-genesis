// Aukora Spatial — lane bridge (the client half of "one mind, two mouths").
//
// Read-only peeks into the selected Session's same-origin chat projection and
// local voice transcript cache, plus a tiny same-page refresh pulse. Nothing
// here is a source of authority; the Session log remains authoritative.

import { BoundChatLogKey } from '/app/chat-log-key.js';

// **THE KEY IS A PURE FUNCTION OF THE SESSION HER TURNS GO THROUGH.** It starts as the session the page was
// loaded for, and `bindLaneSession` — called by the page with the session a turn ACTUALLY went through, which is
// her home when nothing is selected or the selected thread was not open — moves it. Nothing else moves it: a
// sidebar click alone does not, which is the 10:02 property `chat-log-key.js` records (an address rewrite reopened
// the log under a new key with nothing in it). What changed is only WHICH session: the one a turn used, rather than
// the one the address happened to name, because her home turns were landing under `unselected`.
let SESSION_ID = new URLSearchParams(location.search).get('session') || '';
let CHAT_LOG_KEY = new BoundChatLogKey(SESSION_ID);
function voiceLogKeys() {
  return [
    CHAT_LOG_KEY.key,
    'aukora-knvs-live-log-v1',
  ];
}
const THREADS_KEY = 'aukora-threads-v1';
const EVENT = 'aukora:lane-turn';
const TARGET_CHAT_ENDPOINT = '/api/auma-live/chat/recent';
let targetChatTurns = [];

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? null; } catch { return null; }
}

/** Coarse relative time — matches the server bus's quantization so both halves speak alike. */
export function fmtAgo(ts, now = Date.now()) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/** Newest voice-channel turns across BOTH voice surfaces, oldest→newest. */
export function recentVoiceTurns(max = 4, maxAgeMs = 3 * 3_600_000) {
  const now = Date.now();
  const all = [];
  for (const key of voiceLogKeys()) {
    const turns = readJson(key);
    if (!Array.isArray(turns)) continue;
    for (const t of turns) {
      if (!t || typeof t.text !== 'string' || !t.text.trim()) continue;
      if (t.ts && now - t.ts > maxAgeMs) continue;
      all.push({ role: t.role === 'you' ? 'you' : 'auma', text: t.text, ts: t.ts || 0 });
    }
  }
  all.sort((a, b) => a.ts - b.ts);
  return all.slice(-max);
}

/** Newest REAL dialogue turns from the typed chats lane (notes/errors skipped), oldest→newest. */
export function recentChatTurns(max = 3, maxAgeMs = 6 * 3_600_000) {
  const now = Date.now();
  if (targetChatTurns.length) {
    return targetChatTurns
      .filter((turn) => !turn.ts || now - turn.ts <= maxAgeMs)
      .slice(-max);
  }
  const threads = readJson(THREADS_KEY) ?? [];
  const out = [];
  for (const t of threads) {
    if (!t || !t.live) continue;
    const msgs = readJson(`aukora-thread-${t.id}`);
    if (!Array.isArray(msgs)) continue;
    for (const m of msgs) {
      if (!m || typeof m.text !== 'string' || !m.text.trim()) continue;
      if (m.kind) continue; // msg-note/msg-info/msg-error are lane furniture, not dialogue
      if (m.ts && now - m.ts > maxAgeMs) continue;
      out.push({ role: m.role === 'you' ? 'you' : 'auma', text: m.text, ts: m.ts || 0, thread: t.name || t.id });
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out.slice(-max);
}

/**
 * Bind the bridge to the session a turn went through: the voice-log key and the typed-thread peek both follow it.
 * @param {string} sessionId
 * @returns {boolean} whether the session changed
 */
export function bindLaneSession(sessionId) {
  const next = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (next === SESSION_ID) return false;
  SESSION_ID = next;
  CHAT_LOG_KEY = new BoundChatLogKey(SESSION_ID);
  targetChatTurns = [];
  void refreshTargetChatTurns();
  return true;
}

/** The voice-log key the bridge reads now. */
export function laneLogKey() {
  return CHAT_LOG_KEY.key;
}

/** Same-page pulse: a lane announces "a turn just landed here" so open peeks refresh live. */
export function announceLaneTurn(lane) {
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { lane } })); } catch { /* inert */ }
}

/** Subscribe to lane pulses. Returns an unsubscribe function. */
export function onLaneTurn(fn) {
  const handler = (e) => { try { fn(e?.detail?.lane); } catch { /* listener's own problem */ } };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

async function refreshTargetChatTurns() {
  const asked = SESSION_ID;
  if (!asked) return;
  try {
    const endpoint = `${TARGET_CHAT_ENDPOINT}?session=${encodeURIComponent(asked)}`;
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) return;
    const body = await response.json();
    if (!Array.isArray(body?.turns)) return;
    // A peek that answers after the bridge has rebound is about a session it no longer reads; it is dropped, so a
    // slow answer for the thread she opened on cannot overwrite the peek of the one her turns now go through.
    if (asked !== SESSION_ID) return;
    targetChatTurns = body.turns.filter((turn) => turn && typeof turn.text === 'string');
    announceLaneTurn('chat');
  } catch {
    // The localStorage bridge remains available when the host route is absent.
  }
}

void refreshTargetChatTurns();
setInterval(() => { void refreshTargetChatTurns(); }, 2500);
