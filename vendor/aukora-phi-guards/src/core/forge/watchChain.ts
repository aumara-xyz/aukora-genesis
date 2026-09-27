// φ — WATCH THE LAW HOLD, WHILE IT IS HOLDING.
//
// ══ WHY THIS EXISTS ══
//
// A forge round used to be a spinner and then a diff. Everything interesting happened in between and
// the owner saw none of it. Worse, the composer NARRATED work it could not do — "let me have a look,
// opening the status of the branch" — which is the exact defect this repository documented about a
// donor tool, arriving in its own front door.
//
// The receipts are the honest version of that narration, and they already exist: every declared write
// by a governed agent is judged and appended before the tool runs. This tails that file during a round
// so each verdict reaches the screen as it is decided.
//
// ══ WHY TAIL A FILE RATHER THAN INSTRUMENT THE ENGINE ══
//
// Because the chain is the thing that is TRUE. An engine reporting its own actions is an engine's
// account of itself; the chain is what the guard recorded before letting the tool run, and it is
// written by a hook the engine does not control. Streaming the engine's own chatter as if it were
// evidence would repeat the narration bug one layer down.
//
// So the surface shows both, marked differently: the engine's log is chatter, and the chain is record.

import { existsSync, statSync, readFileSync } from 'fs';

export interface ChainVerdict {
  verdict: 'refused' | 'allowed' | 'unguarded';
  reasonClass: string;
  tool: string;
  path: string;
  agent: string | null;
  mode: string | null;
}

/**
 * Poll a chain file for entries appended after this call, until stopped.
 *
 * Polling rather than `fs.watch`: the chain is appended by SHORT-LIVED GUARD PROCESSES, one per tool
 * call, and watcher events for rapid appends by other processes are unreliable across platforms in
 * exactly that pattern. A 250ms poll of a file's size is cheap and cannot miss a line.
 */
export function watchChain(file: string, onVerdict: (v: ChainVerdict) => void, everyMs = 250): () => void {
  // Start from the CURRENT end, so a round shows its own work and not the history before it.
  let offset = existsSync(file) ? statSync(file).size : 0;
  let stopped = false;
  let carry = '';

  // `force` exists because the first version of `stop()` set `stopped = true` and THEN called `tick()`,
  // which returned immediately on that very flag — so the final read never ran and anything written in
  // the last poll interval was lost. Every test here that depends on the closing read failed at once,
  // which is what they are for.
  const tick = (force = false) => {
    if (stopped && !force) return;
    try {
      if (existsSync(file)) {
        const size = statSync(file).size;
        if (size > offset) {
          const text = carry + readFileSync(file, 'utf8').slice(offset);
          offset = size;
          // The tail after the last newline may be HALF A LINE. `append` writes one complete receipt per
          // call, but a poll can land between the two halves of that write — and the first version threw
          // the fragment away while its own comment claimed it did not, so the receipt vanished. The
          // fragment is carried to the next read instead.
          const parts = text.split('\n');
          carry = parts.pop() ?? '';
          for (const line of parts) {
            if (!line.trim()) continue;
            try {
              const e = JSON.parse(line) as ChainVerdict;
              if (e.verdict) onVerdict(e);
            } catch { /* a line that is not a receipt is not this watcher's business */ }
          }
        }
      }
    } catch { /* an unreadable chain is not a reason to kill the round */ }
  };

  const timer = setInterval(tick, everyMs);
  return () => {
    stopped = true;
    clearInterval(timer);
    tick(true);                                   // one last read, so nothing is lost
    // …and if the file ended without a trailing newline, the carried fragment IS a whole receipt.
    if (carry.trim()) {
      try {
        const e = JSON.parse(carry) as ChainVerdict;
        if (e.verdict) onVerdict(e);
      } catch { /* genuinely incomplete — nothing to report */ }
      carry = '';
    }
  };
}
