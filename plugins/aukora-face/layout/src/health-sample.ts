/**
 * TAKING ONE HEALTH SAMPLE — measured, bounded, and reading nothing private.
 *
 * **THE RING LIVES HERE, ON THE HOST SIDE, AND THAT IS NOT AN ARRANGEMENT OF CONVENIENCE.** It was in the client model
 * first, and the host half imported it from there — which meant the **only** host-to-client import in any face in this
 * repository, and it was broken: the host asked `health-sample.ts` for a name that lives in the client, so the face's
 * whole host half **failed to load** and every route on it went down. The routes court caught it. The ring is the
 * sampler's own buffer; it belongs beside the sampler, and the client model keeps the part that is a rendering concern
 * — turning samples into facts, trends and proximity.
 *
 * Peter lost disk to 45 GB of leaked test copies and lost the app to a heap leak he only saw when it broke. This module
 * takes one reading of the organism. **WHAT IT READS IS NAMES AND NUMBERS, AND NOTHING ELSE** — a directory listing, a
 * file's size, the free space on a volume, a kernel counter and a process's footprint. It never opens a file's
 * contents, never reads a message, a memory, a record or a key. That is not a promise in a comment; it is the set of
 * calls below, and a court asserts this module imports no reader that could look inside anything.
 *
 * **EVERY SOURCE IS ONE THAT WAS MEASURED TO EXIST:**
 *
 *  - **free disk** — `statfsSync` on the state volume, no shell-out (measured working: 47.4 GB free).
 *  - **AUKORA's scratch** — entries under the temp directory whose names begin `aukora-`, sizes only. The measured
 *    prefixes on this machine are `aukora`, `aukora-acl`, `aukora-ci-courts`, `aukora-ci-keyless-build`,
 *    `aukora-ci-keyless-courts`, `aukora-ci-owner-bundle-digest`, `aukora-ci-owner-cut-linux`, `aukora-kira` — and
 *    `aukora-private-mutants`, the one that reached 45 GB. One prefix covers them all.
 *  - **the backend footprint** — through an **injected reader**, because ALPHA's watchdog owns that number
 *    (`apps/aukora-desktop/footprint-watch.mjs`) and this lane will not keep a second implementation that could
 *    disagree with the one that decides restarts. The default shells out to the same `/usr/bin/footprint` their reader
 *    uses, and is named as a stand-in until they expose theirs where a face may import it.
 *  - **memory pressure** — `sysctl -n kern.memorystatus_level` (measured: 59).
 *  - **lanes** — **not read here.** The status route is fenced against callers it cannot verify, and a server-side
 *    fetch has no origin to check, so attempting it would either be refused or teach me to forge a header. The panel's
 *    client reads the status route itself, the way the shell's own strip already does.
 *  - **CI** — **not read here.** `gh run list` is refused by another lane's probe allowlist and no local artifact of
 *    the last run exists (measured), so the honest answer is unknown until something writes one.
 *
 * @module health-sample
 */

import { execFile } from 'node:child_process'
import { readdirSync, statSync, statfsSync } from 'node:fs'
import { join } from 'node:path'
import type { HealthSample } from './client/health-model.ts'


/** How many samples are kept. At one sample every 30 seconds this is an hour of history and no more. */
export const HEALTH_RING_SIZE = 120

/**
 * Add one sample to the ring, dropping the oldest.
 *
 * **THE ONLY WAY TO ADD A SAMPLE, AND IT CANNOT GROW.** There is no push-in-place here and no mutable list: the result
 * is a new array whose length is at most `HEALTH_RING_SIZE`, whatever the input was. A caller that keeps the old array
 * gets a shorter history, not a leak.
 */
export function pushSample(ring: readonly HealthSample[], sample: HealthSample): readonly HealthSample[] {
  const kept = ring.length >= HEALTH_RING_SIZE ? ring.slice(ring.length - HEALTH_RING_SIZE + 1) : ring.slice()
  kept.push(sample)
  return kept
}

/** How often the host samples. **The goal's thirty to sixty seconds**, and thirty keeps an hour in the ring. */
export const SAMPLER_INTERVAL_MS = 30_000

/** AUKORA's own prefix under the temp directory. Bounded on purpose: one prefix, and only entries that start with it. */
export const SCRATCH_PREFIX = 'aukora-'

/** How many scratch entries are walked in one sample. A directory with a hundred thousand entries must not stall a sample. */
export const SCRATCH_ENTRY_CAP = 2000

/** Reads the backend's footprint in bytes, or null when it cannot be read. ALPHA's watchdog owns the real one. */
export type FootprintReader = (pid: number) => Promise<number | null>

/**
 * The stand-in footprint reader: the same command ALPHA's watchdog reads through, called directly.
 *
 * **THIS EXISTS BECAUSE A FACE MAY NOT IMPORT ACROSS TREES** — measured: no face's `src` tree imports from `apps/`,
 * which is why the note asking ALPHA to expose theirs is on the board. When they do, this becomes their
 * function and this one is deleted — the panel's number will not change, because it was always their command.
 */
export function readFootprintViaBinary(pid: number): Promise<number | null> {
  return new Promise(resolve => {
    execFile('/usr/bin/footprint', ['-f', 'bytes', String(pid)], { timeout: 5000 }, (error, stdout) => {
      if (error) { resolve(null); return }
      // `footprint -f bytes <pid>` prints several lines; the total is the one that names itself. An unreadable answer
      // is null rather than a guess, because a footprint of zero would read as an idle process.
      const match = /total\s+(\d+)/iu.exec(stdout) ?? /(\d{6,})/u.exec(stdout)
      const bytes = match === null ? Number.NaN : Number(match[1])
      resolve(Number.isFinite(bytes) && bytes > 0 ? bytes : null)
    })
  })
}

/** The machine's memory pressure level, or null. */
export function readPressureLevel(): Promise<number | null> {
  return new Promise(resolve => {
    execFile('sysctl', ['-n', 'kern.memorystatus_level'], { timeout: 5000 }, (error, stdout) => {
      if (error) { resolve(null); return }
      const level = Number(stdout.trim())
      resolve(Number.isFinite(level) ? level : null)
    })
  })
}

/** Free bytes on the volume a path lives on, or null. `bavail` is what a non-root process may actually use. */
export function freeBytesAt(path: string): number | null {
  try {
    const stats = statfsSync(path)
    const free = stats.bavail * stats.bsize
    return Number.isFinite(free) && free >= 0 ? free : null
  } catch {
    return null
  }
}

/**
 * The size of AUKORA's own scratch under the temp directory.
 *
 * **NAMES AND SIZES ONLY.** Every entry is listed and measured; nothing is opened. The walk is capped, and when the cap
 * is reached the answer says so by returning the bytes it saw together with the count it stopped at — a truncated sum
 * reported as a total would be the same lie as an empty log reported as an empty history.
 */
export function scratchBytesIn(
  tmpDir: string,
  // **THE CAP IS A PARAMETER SO A COURT CAN DRIVE IT.** Proving the cap by creating two thousand entries would make
  // the court slow and the proof indirect; a parameter lets the arm use three and check the same branch.
  cap: number = SCRATCH_ENTRY_CAP,
): { readonly bytes: number; readonly entries: number; readonly capped: boolean } {
  let bytes = 0
  let entries = 0
  let capped = false
  let names: string[]
  try {
    names = readdirSync(tmpDir)
  } catch {
    return { bytes: 0, entries: 0, capped: false }
  }
  for (const name of names) {
    if (!name.startsWith(SCRATCH_PREFIX)) continue
    if (entries >= cap) { capped = true; break }
    entries += 1
    try {
      // A DIRECTORY'S OWN SIZE IS NOT ITS CONTENTS, and walking into one would be unbounded work on every sample — so
      // a directory contributes what the filesystem says it occupies and nothing more. The panel's number is
      // AUKORA's scratch as the filesystem reports it, not an estimate built by descending.
      bytes += statSync(join(tmpDir, name)).size
    } catch {
      // An entry that vanished between the listing and the stat is not an error; it is a sample taken while the
      // machine was working.
    }
  }
  return { bytes, entries, capped }
}

/** Everything one sample needs, injected so a court can drive it without a real machine. */
export interface SampleSources {
  readonly stateRoot: string | null
  readonly tmpDir: string
  readonly pid: number
  readonly footprint: FootprintReader
  readonly pressure: () => Promise<number | null>
  readonly now: () => Date
  /** The lanes and CI facts come from elsewhere, and are passed in rather than read here. */
  readonly lanes?: { readonly running: number | null; readonly waiting: number | null }
  readonly ci?: string | null
}

/** The real sources, which is the only place the machine is touched. */
export function liveSources(stateRoot: string | null): SampleSources {
  return {
    stateRoot,
    tmpDir: process.env.TMPDIR ?? '/tmp',
    pid: process.pid,
    footprint: readFootprintViaBinary,
    pressure: readPressureLevel,
    now: () => new Date(),
  }
}

/** Take one sample. **Nothing here can throw**: a health panel that dies while measuring is worse than one number short. */
export async function sampleOnce(sources: SampleSources): Promise<HealthSample> {
  const footprint = await sources.footprint(sources.pid).catch(() => null)
  const pressure = await sources.pressure().catch(() => null)
  const scratch = scratchBytesIn(sources.tmpDir)
  return {
    at: sources.now().toISOString(),
    // **THE STATE VOLUME, NOT THE CHECKOUT**: the disk Peter loses is the one his state grows into, and that is the one
    // the panel is about. With no state root there is nothing to measure and the fact says so.
    freeDiskBytes: sources.stateRoot === null ? null : freeBytesAt(sources.stateRoot),
    scratchBytes: scratch.bytes,
    footprintBytes: footprint,
    pressureLevel: pressure,
    lanesRunning: sources.lanes?.running ?? null,
    lanesWaiting: sources.lanes?.waiting ?? null,
    ci: sources.ci ?? null,
  }
}
