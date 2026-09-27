// Aukora Spatial — lane bridge (the client half of "one mind, two mouths").
//
// Read-only peeks into the OTHER lane's on-device transcript stores plus a
// tiny same-page pulse, so the chats lane can show what was just said aloud
// and the voice surfaces (Auma Live, KNVS duplex) can show what is being
// typed. localStorage only — nothing in this module touches the network, and
// nothing here is a source of authority. The server-side twin (spatial/
// crossLane.ts) is what makes HER aware; this module is what lets the OWNER
// see the same weave in the UI.

const VOICE_LOG_KEYS = ['aukora-auma-live-log-v1', 'aukora-knvs-live-log-v1'];
const THREADS_KEY = 'aukora-threads-v1';
const EVENT = 'aukora:lane-turn';

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
  for (const key of VOICE_LOG_KEYS) {
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
