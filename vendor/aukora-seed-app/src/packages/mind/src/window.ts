// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * TurnWindow — bounded sliding window of (user, assistant) PAIRS with perfect
 * parity. Too much history causes orientation blindness; broken parity throws
 * 400s on strict providers. Pairs only ever enter together.
 *
 * Re-authored from the ARC-AGI-3 reasoning engine, aukora-symbiote branch
 * fable/arc3-reasoning-engine-20260710 @ e5768a2f.
 */
import type { ChatMessage } from './ports.js';

interface TurnPair {
  readonly user: string;
  readonly assistant: string;
}

export class TurnWindow {
  readonly maxPairs: number;
  private readonly pairs: TurnPair[] = [];

  constructor(maxPairs = 5) {
    this.maxPairs = maxPairs;
  }

  push(userText: string, assistantText: string): void {
    this.pairs.push({ user: userText, assistant: assistantText });
    while (this.pairs.length > this.maxPairs) this.pairs.shift();
  }

  /** Messages for the NEXT call: prior pairs then the new user turn. */
  messages(newUserText: string): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const p of this.pairs) {
      out.push({ role: 'user', content: p.user });
      out.push({ role: 'assistant', content: p.assistant });
    }
    out.push({ role: 'user', content: newUserText });
    return out;
  }
}
