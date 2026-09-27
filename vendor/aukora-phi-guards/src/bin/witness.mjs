#!/usr/bin/env node
// aukora · bin/witness.mjs — the whole surface
//
// Six verbs — log, verify, guard, witness, session, bind. This header said FIVE AND NO MORE, and
// that promise is being amended deliberately rather than quietly, by the lane that defended it last
// round against adding `echo` here.
//
// The promise's PURPOSE was never the number. It was written after `init` and `view` were removed for
// dispatching to modules that did not exist, and it means: every advertised verb works. `echo` got its
// own binary because it is a different program with a different job. `bind` is not — it is the act
// this binary's other five verbs are all about, and its absence is why `verify` has reported
// `bound: false` with 0 of 12,163 receipts signed since the day it was written. The ceremony existed,
// was tested, and had NO PRODUCTION CALLER; the missing verb was the whole reason.
//
// ══ TWO VERBS WERE REMOVED, AND WHY THAT IS THE FIX ══
//
// `init` and `view` dispatched to `core/witness/init.mjs`, `serve.mjs` and `view.mjs`. None of the
// three existed. Because the dispatch is a dynamic `import()` inside a `switch` case, it failed at
// call time rather than load time, so the binary looked healthy until someone typed the word — and
// `init` is the first word anyone types:
//
//     $ aukora init
//     node:internal/modules/esm/resolve:272   ← ERR_MODULE_NOT_FOUND
//
// An advertised verb that only fails is worse than an absent one: it spends the reader's trust before
// they have seen anything work. Installation is `scripts/install-witness.sh`, which exists and is
// tested. When a real `init` or `view` is written they can come back, with `test/witness-cli.test.mjs`
// standing guard over the promise.

import { runFence, runWitness, runSession, readPayload, REFUSE, ALLOW } from '../core/witness/guard.mjs';

const [, , verb, ...rest] = process.argv;

/** The hot path first, and with no imports the other verbs would drag in. */
if (verb === 'guard' || verb === 'witness' || verb === 'session') {
  const read = readPayload(0);

  if (verb === 'witness') {
    // Never blocks. Not even on a payload it could not read.
    if (read.ok) runWitness(read.payload);
    process.exit(ALLOW);
  }

  if (verb === 'session') {
    // A session boundary, not a tool call. Never blocks either.
    if (read.ok) runSession(read.payload);
    process.exit(ALLOW);
  }

  if (!read.ok) {
    process.stderr.write(`AUKORA REFUSED: the gate could not read the tool call (${read.reason})\n`);
    process.exit(REFUSE);
  }
  try {
    process.exit(runFence(read.payload));
  } catch (err) {
    // The catch REFUSES. A gate that opens when it breaks is not a gate.
    process.stderr.write(`AUKORA REFUSED: the gate itself failed (${err?.message ?? 'unknown'}) — refusing rather than allowing\n`);
    process.exit(REFUSE);
  }
}

// ── everything below is human-facing and may take its time ──────────────────

const HELP = `aukora — refuse an AI agent's writes to paths you declared off-limits,
         and keep a verifiable record of every attempt.

  Run it as: bun run bin/witness.mjs <verb>
  (with the package linked, the same verbs work as \`aukora <verb>\` — see package.json's bin field)

  aukora log             what the AI has actually done in this repository
  aukora verify          recompute the chain; exit 0 trustworthy, 1 if not
    --explain [line]     print the literal preimage bytes for one receipt,
                         and the shell one-liner that reproduces its hash
  aukora guard           the hook. reads a tool call on stdin, exits 2 to refuse
  aukora witness         the recorder. never blocks, never refuses
  aukora session         records that a session opened or closed, so a session
                         with no receipts can be told from one nobody watched
  aukora bind            PROPOSE the binding ceremony — mint a root, seal a
                         genesis, and start signing receipts. Shows the plan and
                         does nothing else.
    --accept --plan <d>  perform EXACTLY the plan you read. The phrase is read from
                         the terminal, never argv; the recovery secret must be typed
                         back BEFORE anything is minted, and a mismatch refuses

To install the hook into every AI runtime on this machine:

  bash scripts/install-witness.sh

It refuses declared file-tool calls. It does not sandbox a process and it does
not stop \`bash -c 'sed …'\` — those get an \`unguarded\` receipt instead, so the
record shows its own edges. See the README.
`;

const cwd = process.cwd();

switch (verb) {
  case 'log': {
    const { renderLog } = await import('../core/witness/log.mjs');
    process.exit(renderLog(cwd, rest));
  }
  case 'verify': {
    const { renderVerify } = await import('../core/witness/log.mjs');
    process.exit(renderVerify(cwd, rest));
  }
  case 'bind': {
    // PROPOSE BY DEFAULT. Typing the most consequential verb in the system must not perform it — the
    // first thing it does is show what it would do, and `--accept` is a separate, deliberate act.
    const { proposeBindingWithDigest, acceptBinding, planDigest } = await import('../core/ceremony/bind.mjs');
    const { mintRecoverySecret } = await import('../core/witness/aumlok.mjs');
    const at = new Date().toISOString();
    const say = (t = '') => process.stdout.write(`${t}\n`);
    const warn = (t = '') => process.stderr.write(`${t}\n`);

    if (!rest.includes('--accept')) {
      const plan = proposeBindingWithDigest(cwd, { at });
      say(JSON.stringify(plan, null, 2));
      if (!plan.ready) { warn(plan.reason ?? 'not ready'); process.exit(2); }
      warn('');
      warn('This is a PROPOSAL. Nothing was written, minted, or signed.');
      warn('Read docs/BINDING-DECISION.md before accepting — it states a choice the code will not make.');
      warn('');
      warn(`To perform EXACTLY this plan:  aukora bind --accept --plan ${plan.planDigest}`);
      warn('The digest binds your approval to what you just read. If the world moves, it refuses.');
      process.exit(0);
    }

    // ══ THE APPROVAL MUST NAME WHAT WAS APPROVED ══
    //
    // `--accept` called `proposeBinding` again and used THAT, so the owner read one plan and accepted
    // a freshly computed one. Between the two, another node could have bound this repository. Nothing
    // carried his approval from the screen he read to the act he authorised.
    const planFlag = rest.indexOf('--plan');
    const approvedDigest = planFlag === -1 ? null : rest[planFlag + 1];
    if (!approvedDigest) {
      warn('bind --accept needs --plan <digest> from the proposal you read.');
      warn('Run `aukora bind` first; it prints the digest at the end.');
      process.exit(2);
    }

    // THE PHRASE DOES NOT TRAVEL IN ARGV. It was `--phrase "<your phrase>"`, which puts the one secret
    // that is not on the machine into the shell history file, into `ps` where any other user can read
    // it, and into whatever scrollback gets screenshotted — for a value that cannot be rotated. Read
    // from the terminal with echo off instead. `--phrase` still works for scripted use and says why it
    // is worse.
    const { readSecret } = await import('../core/ceremony/prompt.mjs');
    const flagged = rest.indexOf('--phrase');
    let phrase;
    if (flagged !== -1) {
      warn('WARNING: --phrase puts your phrase in shell history and in `ps`. Prefer the prompt.');
      phrase = rest[flagged + 1];
    } else {
      phrase = await readSecret('phrase: ');
    }
    if (!phrase) { warn('a binding needs the phrase'); process.exit(2); }

    // ══ THE TYPE-BACK HAPPENS BEFORE ANYTHING IS WRITTEN, AND IT BLOCKS ══
    //
    // It used to run AFTER the binding, warn on a mismatch, and exit 0 — with a prompt that said
    // "enter to skip". The entire purpose of the step is to convert a DISPLAYED secret into evidence
    // of a WRITTEN one, and a warning he can walk past is not evidence of anything. This is the single
    // unrecoverable failure in the system: no rotation, no un-vow, no second chance.
    //
    // So the secret is minted HERE, shown, and confirmed BEFORE `acceptBinding` runs. A failed
    // confirmation now means nothing was minted, nothing was written, and nothing needs undoing —
    // "the ceremony must not proceed" is literally true rather than a rollback afterwards.
    const recoverySecret = mintRecoverySecret();
    say('');
    say('RECOVERY SECRET — write this down NOW, on paper. It is stored nowhere and cannot be reissued:');
    say('');
    say(`    ${recoverySecret}`);
    say('');
    say('It opens the same root as your phrase and is independent of this machine.');
    say('Without it, a dead laptop means a permanently unreachable root.');
    say('');

    if (!process.stdin.isTTY) {
      // A script cannot write anything on paper. Rather than skip the one guard on the one
      // unrecoverable failure, this refuses — and nothing has been written, so refusing costs nothing.
      warn('REFUSED — binding needs a terminal, so the recovery secret can be confirmed.');
      warn('Nothing was minted or written. Run this by hand.');
      process.exit(2);
    }

    const back = await readSecret('type the recovery secret back, exactly: ');
    if (!back || back.trim() !== recoverySecret) {
      warn('');
      warn(`REFUSED — that does not match. ${back ? 'Check what you wrote.' : 'Nothing was typed.'}`);
      warn('NOTHING WAS MINTED OR WRITTEN. This repository is exactly as it was.');
      warn('Run `aukora bind --accept --plan <digest>` again when you have it on paper.');
      process.exit(1);
    }
    say('Confirmed.');
    say('');

    const plan = proposeBindingWithDigest(cwd, { at });
    const out = acceptBinding(cwd, plan, { phrase, at, recoverySecret, approvedDigest });

    if (!out.ok && !out.partial) {
      warn(`REFUSED — ${out.reason}`);
      if (out.rolledBack) warn('Nothing was left behind: every file this ceremony wrote has been removed.');
      process.exit(1);
    }

    // A PARTIAL BIND IS NOT A BIND and must not print under the word BOUND. This returned ok:true with
    // law:false, so the recovery secret appeared under BOUND over a repository whose law was never
    // sealed. The root is real and opens, so the secret is re-shown — a root that exists and cannot be
    // recovered is exactly the outcome this round exists to prevent.
    if (out.partial) {
      warn(`NOT BOUND — ${out.reason}`);
      say(`  root ${out.rootId} exists on disk and opens with your phrase.`);
      say('  The recovery secret you confirmed above still opens it. Keep the paper.');
    } else {
      say(`BOUND — root ${out.rootId}, device ${out.deviceId}`);
      say('  genesis anchor: sealed');
      say('  law anchor:     sealed');
      say('  both factors were re-read FROM DISK, and both open the same root.');
      say('  the recovery secret you wrote down is the one that opens it.');
    }
    process.exit(out.partial ? 1 : 0);
  }
  case 'help':
  case '--help':
  case '-h':
  case undefined: {
    process.stdout.write(HELP);
    process.exit(0);
    break;
  }
  default: {
    process.stderr.write(`aukora: unknown command "${verb}"\n\n${HELP}`);
    process.exit(1);
  }
}
