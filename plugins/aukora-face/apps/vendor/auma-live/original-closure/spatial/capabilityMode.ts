// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Owner lockdown / capability mode (issue #55). Auma requested this before any read-only tool lands:
 * an immediate, owner-controlled downgrade path back to advisory-only, without a server restart.
 *
 * Two properties are load-bearing (Fable Stage-0 scope):
 *   1. The mode is a FILE, not memory. Door restarts are routine; an in-memory lockdown would
 *      silently re-arm (clear) on restart. Persistence is what makes "demotion instant, promotion
 *      deliberate" true — absent file = advisory (safe default), present-and-lockdown = lockdown.
 *   2. The command is parsed by the DOOR, before any model call — never interpreted by the voice.
 *      This module only provides the pure predicate + persistence + honest confirmation; chat-serve.ts
 *      calls isLockdownCommand() after body-parse and BEFORE ensureLoop(), so `voice: lockdown` can
 *      never fall through to a billed model call that "interprets" the kill switch.
 *
 * Stage-0 honesty: nothing is promoted yet, so lockdown REVOKES NOTHING. It persists the mode that
 * future capabilities (from #44 onward) will check at their dispatch point. The confirmation says so.
 *
 * Pure: no network, no throwing for ordinary filesystem states. Clearing lockdown is deliberately NOT
 * a chat command (a kill switch the disabled channel can undo isn't a kill switch) — it is cleared by
 * the owner removing the file in their own terminal.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export type CapabilityMode = 'advisory' | 'lockdown';

export interface CapabilityModeRecord {
  mode: CapabilityMode;
  since?: string;
  reason?: string;
}

/** The exact owner command. Trimmed + lowercased so trailing whitespace / casing don't defeat the
 *  kill switch, but otherwise an exact match — it must never be triggered incidentally by prose. */
export function isLockdownCommand(input: string): boolean {
  return input.trim().toLowerCase() === 'voice: lockdown';
}

/** Reads the current mode. Absent file, unreadable file, or malformed JSON all resolve to 'advisory'
 *  — the SAFE default is never a silent lockdown, and a corrupt mode file must not brick ordinary
 *  chat. (A corrupt file cannot fake a lockdown either: only an explicit {mode:'lockdown'} locks.) */
export function readCapabilityMode(modePath: string): CapabilityMode {
  if (!existsSync(modePath)) return 'advisory';
  try {
    const parsed = JSON.parse(readFileSync(modePath, 'utf8')) as Partial<CapabilityModeRecord>;
    return parsed.mode === 'lockdown' ? 'lockdown' : 'advisory';
  } catch {
    return 'advisory';
  }
}

/** Persists lockdown. Idempotent; creates the parent dir if needed. Returns the record written. */
export function engageLockdown(modePath: string, now: string): CapabilityModeRecord {
  const record: CapabilityModeRecord = { mode: 'lockdown', since: now, reason: 'owner voice: lockdown command' };
  mkdirSync(dirname(modePath), { recursive: true });
  writeFileSync(modePath, JSON.stringify(record, null, 2) + '\n');
  return record;
}

/** The honest confirmation shown in chat. Stage-0 truth: nothing was revoked (nothing is promoted
 *  yet); the mode is persisted and future capabilities will check it. Clearing is an owner-terminal
 *  action, not a chat command — stated so the owner knows the switch isn't trivially reversible by
 *  the same channel it disables. */
export function lockdownConfirmationEntries(now: string): Array<{ kind: string; text: string; tool?: string }> {
  return [
    {
      kind: 'info',
      text:
        '🔒 Lockdown engaged — capability mode is now advisory-only, persisted so it survives a door restart. ' +
        'Ordinary advisory chat stays available; any promoted capability (from #44 onward) will refuse at its dispatch point while this holds. ' +
        'Honest note: nothing is promoted yet, so this revokes nothing today — it sets the mode future capabilities must check. ' +
        'To lift it, remove the capability-mode file in your own terminal (deliberately, not by chat — the switch can\'t be undone through the channel it disables).',
    },
    {
      kind: 'tool_result',
      tool: 'lockdown',
      text: `capability_mode=lockdown since=${now} — parsed by the door, no model call`,
    },
  ];
}
