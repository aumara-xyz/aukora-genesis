// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// The Auma Live memory law, pinned (2026-07-08 fix: "she recalls but never remembers"):
//   1. presenceTurnHeard — ONE discard rule shared by the ephemeral ring and the governed capture
//      hook. A sub-2.5s abort was never heard by the owner, so NOTHING may record it.
//   2. The door's synthesized voice-shaped entry pair for a spoken turn must parse through
//      extractVoiceReplyText — the exact contract captureCompletedTurn validates — so the presence
//      lane reuses every capture gate + content law verbatim, zero new capture surface.
import { describe, it, expect } from 'vitest';
import { presenceTurnHeard } from '../../spatial/presenceLane';
import { extractVoiceReplyText } from '../../spatial/shadowCapture';

describe('presenceTurnHeard — the one discard law for live-voice memory', () => {
  it('a sub-2.5s abort was never heard: not the ring, not the capture — even with text', () => {
    expect(presenceTurnHeard('aborted', 100, 'a full reply the owner never heard')).toBe(false);
    expect(presenceTurnHeard('aborted', 2499, 'x')).toBe(false);
  });
  it('an abort after 2.5s WAS heard (barge-in mid-reply) — the heard part records', () => {
    expect(presenceTurnHeard('aborted', 2500, 'the part she got out')).toBe(true);
    expect(presenceTurnHeard('aborted', 60_000, 'long turn, cut late')).toBe(true);
  });
  it('a completed turn records; an empty one never does (nothing to remember)', () => {
    expect(presenceTurnHeard('eos', 900, 'a quick full answer')).toBe(true);
    expect(presenceTurnHeard('eos', 900, '')).toBe(false);
    expect(presenceTurnHeard('eos', 900, '   \n ')).toBe(false);
  });
});

describe('the presence door ↔ capture contract — synthesized entries parse as a voiced reply', () => {
  it('the exact pair chat-serve synthesizes for a heard spoken turn yields the reply text', () => {
    const replyText = 'I remember the send button demo — teal, one declaration.';
    const entries = [
      { kind: 'info', text: replyText },
      { kind: 'tool_result', tool: 'voice', text: 'presence lane · mind=balanced' },
    ];
    expect(extractVoiceReplyText(entries)).toBe(replyText);
  });
  it('order matters exactly as in the typed-chat shape — a lone info entry is not a voiced reply', () => {
    expect(extractVoiceReplyText([{ kind: 'info', text: 'no voice provenance' }])).toBe(null);
    expect(extractVoiceReplyText([
      { kind: 'tool_result', tool: 'voice', text: 'provenance first' },
      { kind: 'info', text: 'reply after — wrong order' },
    ])).toBe(null);
  });
});
