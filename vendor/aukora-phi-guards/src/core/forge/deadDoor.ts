// Aukora Spatial — DEAD DOOR RECOVERY: she cannot lock herself out of the house.
//
// ══ THE FAILURE THIS EXISTS FOR ══
//
// The owner's standing instruction is that he will never open a terminal again — everything happens
// through her. That makes exactly one failure unrecoverable: a change to a SERVER LANE that parses
// cleanly, passes the syntax gate, gets accepted, and then throws on boot. The door restarts into a
// corpse. There is no door, so there is no her, so there is no way to undo it. Every other capability
// in this app is a convenience; this is survival.
//
// ══ THE SHAPE ══
//
// Before a restart that carries an unshipped server change, the exact pre-change content of every file
// is written to a watch file. The supervisor brings the door back and then WAITS for it to answer. If
// it does not answer inside the window, the supervisor restores those files from the watch and brings
// it back again — and the second boot is the state that was known to work.
//
// The watch is written to .aukora/ (local, gitignored) and deleted the moment the door answers. It
// holds file contents, which is the one place in this system that does — a receipt must never carry
// content, but a crash-recovery buffer is not a receipt, and the alternative is losing the owner's
// uncommitted work to a boot loop he cannot interrupt.

import * as path from 'path';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * The repository root, read LIVE on every call.
 *
 * The donor captured this in a `const` at module load, which meant the value was frozen to whatever
 * the environment said the first time the file was imported — so a test could not point the module at
 * a fresh directory without tearing down the module cache, and that is exactly why its suite reached
 * for `vi.resetModules()`. Reading it per call follows the rule `standing.ts` already states: a seam
 * no test can exercise is a seam nobody can trust.
 */
function repoRoot(): string {
  const bunDir = (import.meta as unknown as { dir?: string }).dir;
  return process.env.AUKORA_FORGE_REPO
    ?? (bunDir ? path.resolve(bunDir, '..', '..')
               : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'));
}

const WATCH = () => path.join(repoRoot(), '.aukora', 'restart-watch.json');

export interface RestartWatch {
  at: string;
  why: string;
  /** Exactly what these files held before the change that is about to be booted. */
  files: { path: string; before: string | null }[];
}

/** Arm the net: remember how to get back to a door that worked. */
export async function armWatch(w: RestartWatch): Promise<void> {
  try {
    await mkdir(path.dirname(WATCH()), { recursive: true });
    await writeFile(WATCH(), JSON.stringify(w), 'utf8');
  } catch { /* an unarmed net is worse than none only if we claim it is armed — the caller is told */ }
}

/** The door answered. Nothing to recover from. */
export async function disarmWatch(): Promise<void> {
  try { if (existsSync(WATCH())) await unlink(WATCH()); } catch { /* stale watch is harmless; it is only read on a dead boot */ }
}

export async function readWatch(): Promise<RestartWatch | null> {
  try { return JSON.parse(await readFile(WATCH(), 'utf8')) as RestartWatch; } catch { return null; }
}

/**
 * Put the files back exactly as the watch remembers them.
 *
 * Content, not `git checkout`: the owner may have had uncommitted work in the same file, and restoring
 * to HEAD would throw that away while fixing the boot — trading one silent loss for another.
 */
export async function recoverFromWatch(): Promise<{ ok: boolean; restored: string[]; why: string } | null> {
  const w = await readWatch();
  if (!w) return null;
  return recoverFrom(w);
}

/**
 * Recover from a watch the caller is already holding.
 *
 * The supervisor reads the watch BEFORE it spawns the door and keeps it in memory, because the door
 * disarms the on-disk watch the moment its module finishes loading. A door that loads and then hangs
 * would therefore have deleted the net it still needs — a narrow race, but the whole point of this file
 * is the failure that leaves the owner with no way back in.
 */
export async function recoverFrom(w: RestartWatch): Promise<{ ok: boolean; restored: string[]; why: string }> {
  const restored: string[] = [];
  for (const f of w.files) {
    const abs = path.resolve(repoRoot(), f.path);
    if (!abs.startsWith(repoRoot() + path.sep)) continue;
    try {
      if (f.before === null) await unlink(abs);
      else await writeFile(abs, f.before, 'utf8');
      restored.push(f.path);
    } catch { /* a file that cannot be written is reported by its absence from the list */ }
  }
  await disarmWatch();
  return { ok: restored.length > 0, restored, why: w.why };
}

/**
 * A note the surface reads on its next load, so the owner learns what happened from HER rather than
 * from a terminal he is not looking at.
 */
const TOLD = () => path.join(repoRoot(), '.aukora', 'recovered.json');

export async function leaveNote(note: { restored: string[]; why: string }): Promise<void> {
  try {
    await mkdir(path.dirname(TOLD()), { recursive: true });
    await writeFile(TOLD(), JSON.stringify({ ...note, at: new Date().toISOString() }), 'utf8');
  } catch { /* best effort */ }
}

export async function takeNote(): Promise<{ restored: string[]; why: string; at: string } | null> {
  try {
    const n = JSON.parse(await readFile(TOLD(), 'utf8'));
    await unlink(TOLD());
    return n;
  } catch { return null; }
}
