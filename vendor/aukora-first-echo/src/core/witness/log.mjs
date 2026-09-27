// aukora · core/witness/log.mjs — what the AI actually did, and whether you can believe it

import { readAll } from './chain.mjs';
import { verifyChain, verifyEverything, explain, PEER_STATES } from './verify.mjs';
import { REASON } from './guard.mjs';

const C = {
  dim: (s) => `[2m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  cyan: (s) => `[36m${s}[0m`,
};

const VERDICT = {
  refused: C.red('refused '),
  allowed: C.green('allowed '),
  unguarded: C.yellow('unguarded'),
};

const pad = (s, n) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const shortTs = (ts) => (typeof ts === 'string' ? ts.replace(/\.\d+Z$/, 'Z') : '');

export function renderLog(repoRoot, argv = []) {
  const out = (s = '') => process.stdout.write(`${s}\n`);
  const { records, unparsable } = readAll(repoRoot);
  const entries = records.map((r) => r.entry);
  const limit = numberFlag(argv, '-n') ?? 50;
  const showAll = argv.includes('--all');

  if (entries.length === 0) {
    out();
    out(`  ${C.dim('no receipts yet.')}`);
    out(`  ${C.dim('run')} bash scripts/install-witness.sh ${C.dim('then ask the agent to touch a protected path.')}`);
    out();
    return 0;
  }

  // The unguarded receipts are the honest gap, not noise — but they are also
  // most of the volume, so they collapse by default and `--all` opens them.
  const shown = showAll ? entries : entries.filter((e) => e.verdict !== 'unguarded');
  const hidden = entries.length - shown.length;
  const tail = shown.slice(-limit);

  out();
  for (const e of tail) {
    const alias = e.resolved && e.resolved !== e.path ? C.dim(` → ${e.resolved}`) : '';
    const rule = e.rule ? C.dim(`  ${e.rule}`) : '';
    out(`  ${VERDICT[e.verdict] ?? pad(String(e.verdict), 9)}  ${pad(String(e.tool), 13)}${e.path}${alias}  ${C.dim(shortTs(e.ts))}${rule}`);
    if (e.reasonClass === REASON.SIBLING) {
      out(`  ${' '.repeat(11)}${C.dim('↳ not the offending path; the call was refused as a whole')}`);
    }
    if (e.reasonClass === REASON.UNKNOWN_TOOL) {
      out(`  ${' '.repeat(11)}${C.yellow('↳ unrecognised tool — the fence does not route it. See README §Drift.')}`);
    }
  }

  if (hidden > 0) {
    out();
    out(`  ${C.dim(`${hidden} unguarded receipt${hidden === 1 ? '' : 's'} hidden — calls the fence could not inspect.`)}`);
    out(`  ${C.dim('--all to show them. They are the shape of what this tool does not cover.')}`);
  }
  if (unparsable.length > 0) {
    out(`  ${C.red(`${unparsable.length} unparsable line(s) in the chain — run aukora verify`)}`);
  }
  out();
  return 0;
}

export function renderVerify(repoRoot, argv = []) {
  const out = (s = '') => process.stdout.write(`${s}\n`);

  if (argv.includes('--explain')) {
    const line = numberFlag(argv, '--explain');
    const x = explain(repoRoot, line ?? undefined);
    if (!x.ok) { out(`  ${C.red(x.reason)}`); return 1; }
    out();
    out(`  ${C.bold(`receipt on line ${x.line}`)}`);
    out();
    out(`  ${C.dim('The hash is sha256 over the previous hash concatenated with the')}`);
    out(`  ${C.dim('canonical body — sorted keys, no whitespace, no separator between them.')}`);
    out();
    out(`  ${C.bold('prev')}       ${x.prev}`);
    out(`  ${C.bold('body')}       ${x.canonical}`);
    out();
    out(`  ${C.bold('claimed')}    ${x.claimed}`);
    out(`  ${C.bold('recomputed')} ${x.matches ? C.green(x.recomputed) : C.red(x.recomputed)}`);
    out();
    out(`  ${C.bold('Reproduce it yourself, two ways.')}`);
    out();
    out(`  ${C.dim('# with jq — readable, and agrees with us only if its serialiser does')}`);
    out(`  ${x.recipes.jq}`);
    out();
    out(`  ${C.dim('# with the preimage bytes — cannot disagree with anything')}`);
    out(`  ${x.recipes.hex}`);
    out();
    return x.matches ? 0 : 1;
  }

  // THE COMPOSED VERIFIER IS THE PRODUCTION VERIFIER NOW.
  //
  // `verifyEverything` had ZERO production callers: the CLI and the face both called `verifyChain`,
  // so even perfect transport would have changed no verdict anybody ever saw. A composed check that
  // nothing runs is the same shape as a guard attached to a function nobody calls.
  //
  // `verifyChain`'s own fields are still the bulk of what this renderer prints — the composition ADDS
  // the peer half rather than replacing anything — and that half is printed rather than folded into a
  // boolean, because "the witness said nothing" and "the witness agreed" are different sentences and
  // only one of them is evidence.
  //
  // It was NOT printed. `composed` was read exactly once, for `.chain`, so `verifyEverything` ran the
  // peer comparison and the prefix re-derivation and every result was discarded — while this comment
  // said the peer half was "reported below". A check whose output reaches no one is the same shape as
  // the check that had no caller. The exit code is deliberately left alone: wiring it to `composed.ok`
  // would make `aukora verify` exit non-zero on every node with no peer, which today is every node.
  const composed = verifyEverything(repoRoot, { nowMs: Date.now() });
  const v = composed.chain;
  out();

  // ══ EMPTY IS NOT CLEAN — SOL'S BYPASS, AND IT WAS THE WHOLE FRONT DOOR ══
  //
  // This block ended in `return 0`, placed BEFORE the assurance logic and after `composed` had already
  // been computed four lines up. It consulted none of it. Reproduced through the real CLI: a node with
  // 40 receipts pushes to a witness, the entire chain file is then deleted, and both
  //
  //     aukora verify              → EXIT 0   "no receipts yet — nothing to verify."
  //     aukora verify --witness    → EXIT 0   "no receipts yet — nothing to verify."
  //
  // The deletion attack that peer retention exists to catch walked straight through, and `--witness`
  // did not help, because nothing downstream of here ever ran.
  //
  // An empty chain cannot verify ITSELF. "Nothing happened yet" and "everything was deleted" are the
  // same bytes locally, and only an outside party can tell them apart — which is the entire argument
  // for a witness. So the empty case falls through to exactly the same verdict logic as any other, and
  // that logic gives it 0 only when a witness attests the emptiness.
  if (v.receipts === 0) {
    out(`  ${C.dim('no receipts in this chain.')}`);
    out(`  ${C.dim('An empty chain cannot verify itself: "nothing happened yet" and "it was all')}`);
    out(`  ${C.dim('deleted" are the same bytes. Only a witness can tell those apart.')}`);
    out();
    return assurance(v, composed, argv, out);
  }

  const head = v.heads.length === 1 ? v.heads[0].hash.slice(0, 12) : null;
  // `trustworthy`, not `intact` — a chain an attacker rebuilt after editing it is "intact" by
  // definition (they are the one who recomputed the hashes). `intact` still prints below when it
  // disagrees, because a trustworthy-but-not-intact chain cannot happen, but an intact-but-not-
  // trustworthy one is exactly the forged-and-resigned case this exists to catch.
  if (v.trustworthy) {
    out(`  ${C.green('chain intact')} · ${v.receipts} receipt${v.receipts === 1 ? '' : 's'}${head ? ` · head ${head}…` : ''}`);
  } else if (v.intact) {
    out(`  ${C.red('SIGNATURES BROKEN')} · ${v.receipts} receipt${v.receipts === 1 ? '' : 's'} · hashes recompute, signatures do not`);
  } else {
    out(`  ${C.red('CHAIN BROKEN')} · ${v.receipts} receipt${v.receipts === 1 ? '' : 's'}`);
  }

  out(`  ${C.dim(`${v.counts.refused} refused · ${v.counts.allowed} allowed · ${v.counts.unguarded} unguarded`)}`);

  // ── custody ───────────────────────────────────────────────────────────────
  //
  // "custody ok" used to print whenever the device CERTIFICATE verified, even
  // with zero receipts actually signed — the certificate being valid says
  // nothing about whether anything was signed with it. Kimi K3 caught that as
  // the place the output most plainly oversold the README's signature story.
  if (v.custody.ok && v.signed === v.receipts) {
    out(`  ${C.green('custody ok')}   · ${v.signed}/${v.receipts} signed by device ${v.custody.deviceId.slice(0, 12)}…`);
    out(`  ${C.dim(`               certified by root ${v.custody.rootId.slice(0, 12)}… (aukora.pub)`)}`);
  } else if (v.custody.ok) {
    out(`  ${C.yellow('custody partial')} · only ${v.signed}/${v.receipts} receipts are signed`);
    out(`  ${C.dim(`               the certificate verifies, but an unsigned receipt is`)}`);
    out(`  ${C.dim('               attributable to nobody. Was the device key present?')}`);
  } else {
    out(`  ${C.yellow('custody none')} · ${v.custody.reason}`);
    out(`  ${C.dim('               hashes prove consistency; only a key proves authorship.')}`);
  }

  // ── the witness, and what it can and cannot say ───────────────────────────
  //
  // Printed on every run, including — especially — when there is no witness. Silence rendered as
  // nothing is silence rendered as agreement.
  const peer = composed.peer;
  if (!composed.peerChecked) {
    out(`  ${C.yellow('witness not consulted')} · ${composed.reason}`);
  } else if (peer.ok) {
    out(`  ${C.green('witness agrees')} · ${peer.retained ? `last told at seq ${peer.retained.seq}` : 'no retained checkpoint'}`);
  } else {
    out(`  ${C.yellow(`witness ${String(peer.state).replace('peer:', '')}`)} · ${peer.reason}`);
    for (const d of peer.disagreeing ?? []) {
      out(`      ${C.red(`seq ${d.seq}: ${d.reason}`)}`);
    }
  }

  // The re-derivation, which is the only check here that can catch a chain rewritten UNDER a witnessed
  // prefix and then grown past it — a forgery that is `intact` by construction and whose count only
  // ever went up.
  for (const w of composed.rewritten ?? []) {
    out(`  ${C.red(`WITNESSED PREFIX REWRITTEN · seq ${w.seq}`)}`);
    out(`      ${C.dim(w.reason)}`);
  }

  // ── what the record is evidence OF ────────────────────────────────────────
  //
  // The projection existed and was published for two rounds while nothing read it. Printed here, which
  // makes this renderer its first reader and the proof that the door opens.
  //
  // Deliberately NOT one number. The single most important thing about this chain is that most of it
  // is shell nobody could inspect, and any presentation that collapses to a total hides exactly that.
  const bio = v.biography;
  if (bio) {
    out(`  ${C.dim('what this is evidence of:')}`);
    out(`  ${C.dim(`    ${bio.judgedWritePaths} judged write path${bio.judgedWritePaths === 1 ? '' : 's'} · ${bio.ownerOutcomes} owner outcome${bio.ownerOutcomes === 1 ? '' : 's'}`)}`);
    out(`  ${C.dim(`    ${bio.attention} attention · ${bio.boundary} boundary`)}`);
    out(`  ${C.dim(`    ${bio.unjudged} UNJUDGED, of which ${bio.uninspectableShellCalls} are shell the fence cannot inspect`)}`);
    out(`  ${C.dim(`    coverage ${v.receipts} — how much the chain saw, not what she did`)}`);
    // A judged write path is a VERDICT on a declared path. Said here because this is where somebody
    // reads the number and decides what it means.
    out(`  ${C.dim('    a judged write path is an intent the law ruled on, not proof bytes moved')}`);
  }

  // ── the honest declarations, printed rather than filed away ───────────────
  out(`  ${C.dim('aumlok grants authority: false · aura is trace only: true')}`);

  let problems = 0;
  for (const b of v.hashBreaks) {
    problems += 1;
    out(`  ${C.red(`line ${b.line}: hash mismatch`)}`);
    out(`      ${C.dim(`claims     ${b.claimed}`)}`);
    out(`      ${C.dim(`recomputes ${b.recomputed}`)}`);
  }
  // Duplicates are counted as problems and coloured YELLOW, matching forks: worth a
  // reader's attention, not a broken chain. They carry one hash because there is only
  // one — printing a `claims`/`recomputes` pair here is the defect this replaced.
  for (const d of v.duplicates ?? []) {
    problems += 1;
    out(`  ${C.yellow(`line ${d.line}: duplicate of line ${d.first} — identical body and predecessor`)}`);
    out(`      ${C.dim(`both hash to ${d.hash.slice(0, 12)}… and both verify; this is a fork whose`)}`);
    out(`      ${C.dim('two branches are the same bytes. The record is intact — but a repeated')}`);
    out(`      ${C.dim('receipt is counted twice in the verdict tallies above.')}`);
  }
  for (const o of v.orphans) {
    problems += 1;
    out(`  ${C.red(`line ${o.line}: names a predecessor that is not in this chain (${o.prev.slice(0, 12)}…)`)}`);
    out(`      ${C.dim('a receipt was removed, or this file is a fragment of a longer chain')}`);
  }
  for (const u of v.unparsable) {
    problems += 1;
    out(`  ${C.red(`line ${u.line}: not JSON — ${u.reason}`)}`);
  }
  for (const s of v.sigBreaks) {
    problems += 1;
    out(`  ${C.yellow(`line ${s.line}: ${s.reason}`)}`);
  }
  for (const g of v.sigGaps) {
    problems += 1;
    out(`  ${C.red(`line ${g.line}: ${g.reason}`)}`);
  }

  // ── forks are reported, not hidden ────────────────────────────────────────
  if (v.forks.length > 0) {
    out();
    out(`  ${C.yellow(`chain forked at ${v.forks.length} point${v.forks.length === 1 ? '' : 's'}`)}`);
    for (const f of v.forks) {
      out(`      ${C.dim(`after ${f.prev.slice(0, 12)}… → lines ${f.lines.join(', ')}`)}`);
    }
    out(`  ${C.dim('Two guard processes appended against the same predecessor — concurrent')}`);
    out(`  ${C.dim('subagent tool calls do that. Every signature still verifies across a')}`);
    out(`  ${C.dim('fork. What a fork costs you is one total order, not integrity.')}`);
  }
  if (v.heads.length > 1) {
    out(`  ${C.dim(`${v.heads.length} heads: ${v.heads.map((h) => h.hash.slice(0, 8)).join(' ')}`)}`);
  }

  out();

  return assurance(v, composed, argv, out);
}

function numberFlag(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * ══ WHAT AN EXIT CODE PROMISES ══
 *
 *   0  the assurance you asked for was ESTABLISHED
 *   1  evidence is BROKEN OR CONTRADICTORY — fatal in every mode
 *   2  the assurance you asked for is UNAVAILABLE
 *
 * This returned `v.trustworthy ? 0 : 1`, so a witness reporting BEHIND printed in red and exited 0.
 * Switching to `composed.ok` is the obvious fix and the wrong one: it flattens "the witness CONTRADICTS
 * us" into "no witness was available", and those call for opposite actions — stop and investigate,
 * versus go and pair a witness.
 *
 * ══ SOL'S TABLE, AND THEY REVERSED THEIR OWN PRIOR RULING TO REACH IT ══
 *
 *   empty local + peer retains nonempty       → 1   a contradiction, and the deletion attack
 *   empty local + witness attests empty       → 0   somebody outside says there was nothing
 *   empty local + no or silent witness        → 2   unknowable from here
 *   nonempty, witnessed before, no witness now→ 2   assurance HELD and then LOST
 *   nonempty, never witnessed, not asked      → 0   local assurance, and the output says so
 *   contradiction in hand                     → 1   in EITHER mode
 *
 * The last line is the load-bearing one: not having asked for peer assurance does not excuse ignoring
 * a contradiction already in hand. A retained checkpoint that disagrees is evidence about THIS chain.
 *
 * `witnessedBefore` earns its own row because losing an assurance you had is not the same as never
 * having sought one. A node that was witnessed and now cannot reach its witness has DEGRADED, and
 * reporting that as a clean 0 would make the witness optional in exactly the moment it matters.
 */
function assurance(v, composed, argv, out) {
  const wantsWitness = argv.includes('--witness') || argv.includes('--peer');
  const peer = composed.peer;
  const contradicted = (composed.rewritten ?? []).length > 0
    || (composed.peerChecked && peer?.state === PEER_STATES.BEHIND);

  // NOT `problems`. That counter includes duplicates and forks, which this renderer prints in yellow
  // and calls worth attention rather than a broken chain — the live node carries both. Folding it in
  // made `aukora verify` exit 1 on a healthy chain, which is the same overclaim reversed.
  let code;
  let line;
  if (contradicted) {
    code = 1;
    line = v.receipts === 0
      ? 'EXIT 1 — this chain is EMPTY and a witness retains receipts for it. Evidence was deleted.'
      : (v.trustworthy
        ? 'EXIT 1 — this chain verifies against itself, and a witness contradicts it'
        : 'EXIT 1 — the evidence is broken, and a witness contradicts it');
  } else if (!v.trustworthy) {
    code = 1;
    line = 'EXIT 1 — the evidence is broken';
  } else if (v.receipts === 0) {
    // Emptiness is only ever cleared by somebody else. `peer.ok` here means a retained checkpoint
    // agrees with the empty frontier we can produce — an outside party attesting that there was
    // nothing, which is the one thing this node cannot say about itself.
    code = peer?.ok ? 0 : 2;
    line = peer?.ok
      ? 'EXIT 0 — empty, and a witness attests it was always empty'
      : `EXIT 2 — empty, and no witness can say whether it always was (${String(peer?.state ?? 'unknown').replace('peer:', '')})`;
  } else if (!peer?.ok && (wantsWitness || composed.witnessedBefore)) {
    code = 2;
    line = composed.witnessedBefore && !wantsWitness
      ? `EXIT 2 — this node WAS witnessed and its witness is now unavailable (${String(peer?.state ?? 'unknown').replace('peer:', '')})`
      : `EXIT 2 — witness assurance was requested and is unavailable (${String(peer?.state ?? 'unknown').replace('peer:', '')})`;
  } else {
    code = 0;
    line = wantsWitness
      ? 'EXIT 0 — local integrity and witness agreement both established'
      : 'EXIT 0 — LOCAL assurance only; no witness was asked (use --witness to require one)';
  }

  out(`  ${code === 0 ? C.dim(line) : C.red(line)}`);
  if (code === 0 && !wantsWitness && v.receipts > 0) {
    out(`  ${C.dim('Do not take our word for it:')} aukora verify --explain`);
  }
  out();
  return code;
}
