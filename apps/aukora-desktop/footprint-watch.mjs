// footprint-watch.mjs — Fable's item (2): the supervisor watchdog that restarts the backend BEFORE the heap does it.
//
// THE FAILURE IT EXISTS FOR, MEASURED 2026-09-27 16:22: the live backend died with
//   Mark-Compact 4048.7 (4143.1) -> 4044.4 (4155.8) MB at 8,222,171 ms (2.28 h under seven-lane load)
//   FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
// 4048 MB is V8's DEFAULT old-space cap, so the process crashes the moment it reaches it — no warning, no drain, and
// every lane loses its turn. The watchdog is the difference between "the organism dies" and "the organism restarts".
//
// **UNARMED BY DEFAULT, AND THAT IS FABLE'S ORDER**: "no live-app changes without my word". This module decides and
// logs; it does not spawn, kill or re-launch anything unless a caller explicitly arms it. `--dry-run` prints the
// decisions it WOULD make against a pid you name.
//
// THE DECISION IS A PURE FUNCTION OF FOUR FACTS, so a court can prove every corner of it without a process:
//   footprintBytes · quiet · approvalOpen · limit
import { spawnSync } from 'node:child_process'

/** 3.4 GB — above the working set, below the 4048 MB wall, chosen so a restart happens with room to spare. */
export const FOOTPRINT_LIMIT_BYTES = Math.round(3.4 * 1024 ** 3)

/**
 * Should the backend be restarted, and why not if not.
 *
 * TWO RULES ARE ABSOLUTE. (a) Never mid-approval: a restart while a person is being asked to approve destroys the
 * very window the answer depends on — that is the desktopshell's purpose, and killing it to save memory trades a
 * recoverable problem for an unrecoverable one. (b) Never unquiet: "a GRACEFUL restart at a quiet moment" (Fable),
 * because a restart under load turns one lane's leak into every lane's lost turn.
 */
export function restartDecision({ footprintBytes, quiet, approvalOpen, limit = FOOTPRINT_LIMIT_BYTES }) {
  if (!Number.isFinite(footprintBytes) || footprintBytes <= 0) return { restart: false, reason: 'footprint-unknown' }
  if (footprintBytes < limit) return { restart: false, reason: 'below-threshold' }
  if (approvalOpen) return { restart: false, reason: 'approval-open' }
  if (!quiet) return { restart: false, reason: 'not-quiet' }
  return { restart: true, reason: 'footprint-over-limit' }
}

/** The backend's physical footprint, from footprint(1) — NOT ps, which misses what a JS heap actually holds. */
export function readFootprintBytes(pid) {
  const out = spawnSync(process.env.AUKORA_FOOTPRINT_BIN ?? '/usr/bin/footprint', [String(pid)], { encoding: 'utf8', timeout: 30_000 })
  if (out.status !== 0) return null
  const match = /phys_footprint:\s*([\d.]+)\s*([KMG])B/iu.exec(out.stdout ?? '')
  if (match === null) return null
  const scale = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[match[2].toUpperCase()]
  return Math.round(Number(match[1]) * scale)
}

/** One line per restart, with the footprint, because "a limit that does not print did not happen". */
export function restartLogLine({ pid, footprintBytes, reason, at = new Date().toISOString() }) {
  return `[footprint-watch] RESTART pid=${String(pid)} footprint=${(footprintBytes / 1024 ** 3).toFixed(2)}GB reason=${reason} at=${at}`
}

if (process.argv[1] && process.argv[1].endsWith('footprint-watch.mjs')) {
  const pid = Number(process.argv[2])
  if (!Number.isFinite(pid) || pid <= 0) {
    process.stderr.write('usage: footprint-watch.mjs <pid> [--approval-open] [--quiet]\n')
    process.exit(2)
  }
  const footprintBytes = readFootprintBytes(pid)
  const decision = restartDecision({
    footprintBytes: footprintBytes ?? Number.NaN,
    quiet: process.argv.includes('--quiet'),
    approvalOpen: process.argv.includes('--approval-open'),
  })
  process.stdout.write(`pid ${String(pid)} footprint ${footprintBytes === null ? 'unreadable' : `${(footprintBytes / 1024 ** 3).toFixed(2)}GB`}: ${decision.restart ? 'WOULD RESTART' : 'no restart'} (${decision.reason})\n`)
  if (decision.restart) process.stdout.write(restartLogLine({ pid, footprintBytes, reason: decision.reason }) + '\n')
  process.stdout.write('UNARMED: this module decides and logs; nothing was restarted.\n')
}
