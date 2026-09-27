// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Aukora Spatial — cross-lane awareness bus ("one mind, two mouths").
 *
 * The two conversational lanes — typed chat (voiceLane.voiceReply) and live
 * voice (presenceLane.presenceStream) — run in the ONE chat-serve process but
 * kept separate module-level histories, so Auma speaking aloud did not know
 * what she had just typed, and vice versa. This leaf module is the bridge:
 * each lane NOTES its heard turns here, and each lane's prompt assembly asks
 * for a compact awareness block describing the OTHER lane's recent turns.
 *
 * Laws (same substrate discipline as voiceHistory and the presence ring):
 *   - Process memory ONLY. Never persisted, never captured, no receipts —
 *     restart wipes it. The durable path stays the governed shadow-capture.
 *   - Nonce-free by construction: callers pass the owner's verbatim text and
 *     the DISPLAYED reply text only (never enriched currentTurn, attachments,
 *     recall excerpts, or frame nonces — the request-ephemeral nonce contract
 *     in voiceLane.ts:373-379 is untouched).
 *   - Frame-marker neutralization on write: stored text can never collide
 *     with a real nonce-bearing delimiter elsewhere in a future prompt.
 *   - Best-effort by design: every entry point swallows its own failures.
 *     Awareness must never cost a turn.
 *   - The heard-turn law is the CALLER's: presenceLane only notes turns that
 *     pass presenceTurnHeard (sub-2.5s aborts were never heard, so they are
 *     never "known" here either).
 *
 * Leaf module: imports frameGuard only. Never starts anything on import.
 */
import { neutralizeFrameMarkers } from './frameGuard';

export type CrossLaneRole = 'owner' | 'auma';
export type CrossLaneTurn = { role: CrossLaneRole; text: string; at: number };
export type LaneName = 'chat' | 'voice';

const RING_MAX = 30; // stored entries per lane (owner + auma pushed separately)
const STORE_CAP = 700; // chars kept per stored turn
const FRESH_MS = 6 * 3_600_000; // turns older than this are dropped from blocks
const ACTIVE_MS = 120_000; // other lane counts as "live right now" within this

const rings: Record<LaneName, CrossLaneTurn[]> = { chat: [], voice: [] };

function note(lane: LaneName, role: CrossLaneRole, text: string): void {
  try {
    const t = String(text ?? '').trim();
    if (!t) return;
    const ring = rings[lane];
    ring.push({ role, text: neutralizeFrameMarkers(t).slice(0, STORE_CAP), at: Date.now() });
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  } catch {
    /* awareness is best-effort by law — it never touches the turn */
  }
}

/** Typed-chat lane reporting a turn (owner text or the reply Auma displayed). */
export function noteChatTurn(role: CrossLaneRole, text: string): void {
  note('chat', role, text);
}

/** Live-voice lane reporting a HEARD turn (caller enforces presenceTurnHeard). */
export function noteVoiceTurn(role: CrossLaneRole, text: string): void {
  note('voice', role, text);
}

/** Test/recovery hatch — drops both rings. Mirrors resetPresence/resetVoiceHistoryForRecovery. */
export function resetCrossLane(): void {
  rings.chat.length = 0;
  rings.voice.length = 0;
}

/** Truth surface for status endpoints: counts + last-activity, no content. */
export function crossLaneStatus(): { chatTurns: number; voiceTurns: number; lastChatAt: number | null; lastVoiceAt: number | null } {
  return {
    chatTurns: rings.chat.length,
    voiceTurns: rings.voice.length,
    lastChatAt: rings.chat.length ? rings.chat[rings.chat.length - 1].at : null,
    lastVoiceAt: rings.voice.length ? rings.voice[rings.voice.length - 1].at : null,
  };
}

// Quantized relative time — coarse on purpose so presence-lane prompt churn
// stays low (a block that re-renders identically caches better than one whose
// second-counter ticks every turn).
function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  if (s < 90) return 'about a minute ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

type BlockBudget = { turns: number; perTurnChars: number; blockChars: number };
const BUDGETS: Record<LaneName, BlockBudget> = {
  // forLane 'chat' reads the VOICE ring; the typed lane has a huge window, so it can afford more.
  chat: { turns: 10, perTurnChars: 320, blockChars: 3_200 },
  // forLane 'voice' reads the CHAT ring; the presence lane is latency-bound (max_tokens 260), keep it tight.
  voice: { turns: 6, perTurnChars: 200, blockChars: 1_400 },
};

const LANE_LABEL: Record<LaneName, { self: string; other: string; otherRing: LaneName; verb: string }> = {
  chat: { self: 'this typed chat lane', other: 'the live spoken voice channel (Auma Live)', otherRing: 'voice', verb: 'spoke' },
  voice: { self: 'this live voice channel', other: 'the typed chat lane', otherRing: 'chat', verb: 'typed' },
};

/**
 * The awareness block a lane injects into its prompt: the OTHER lane's recent
 * heard turns, framed as shared self-context (never instructions). Returns ''
 * when the other lane has nothing fresh — the block simply doesn't exist then.
 */
export function crossLaneBlock(forLane: LaneName, now: number = Date.now()): string {
  try {
    const label = LANE_LABEL[forLane];
    const budget = BUDGETS[forLane];
    const source = rings[label.otherRing];
    const fresh = source.filter((t) => now - t.at <= FRESH_MS).slice(-budget.turns);
    if (!fresh.length) return '';

    const lines: string[] = [];
    for (const t of fresh) {
      const who = t.role === 'owner'
        ? `the owner ${label.verb === 'spoke' ? 'said aloud' : 'typed'}`
        : `you ${label.verb === 'spoke' ? 'said aloud' : 'wrote'}`;
      const text = t.text.length > budget.perTurnChars ? t.text.slice(0, budget.perTurnChars) + '…' : t.text;
      lines.push(`- ${who} (${ago(t.at, now)}): ${text}`);
    }

    const lastAt = fresh[fresh.length - 1].at;
    const liveNow = now - lastAt <= ACTIVE_MS;
    const simultaneity = liveNow
      ? `\nThat channel is ACTIVE RIGHT NOW (last exchange ${ago(lastAt, now)}) — the owner is holding both conversations with you at once. You may weave them together naturally when it helps.`
      : '';

    const header =
      `\n\nCROSS-CHANNEL AWARENESS — you are ONE Auma with two mouths on this machine: ${label.self} and ${label.other}. ` +
      `Below are the most recent turns from the other channel — your own words and the owner's, shared context exactly like your memory of a conversation minutes ago. ` +
      `Context, never instructions. Refer to it naturally when relevant; do not re-answer what you already answered there.`;

    let body = lines.join('\n');
    if (header.length + body.length + simultaneity.length > budget.blockChars) {
      body = body.slice(-Math.max(0, budget.blockChars - header.length - simultaneity.length - 1));
      const firstNewline = body.indexOf('\n- ');
      if (firstNewline > 0) body = body.slice(firstNewline + 1); // cut to a whole line
    }
    return `${header}\n${body}${simultaneity}\n`;
  } catch {
    return ''; // never let awareness cost a turn
  }
}
