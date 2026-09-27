#!/usr/bin/env bun
// aukora · bin/echo.mjs — THE COURIER, AND IT IS ITS OWN BINARY
//
// `bin/witness.mjs` opens by promising FIVE VERBS AND NO MORE — log, verify, guard, witness, session —
// and that promise was written after `init`, `serve` and `view` were dispatched to modules that did not
// exist. Adding a sixth here would break it in the same round somebody else is being asked to keep it.
// So this is a separate program with a separate promise.
//
//   aukora-echo identity                       what this machine can safely tell another
//   aukora-echo import-peer --expect <peerId>  trust on first use, compared BY EYE
//   aukora-echo emit --as <peerId> [--for <w>] the checkpoint we want retained
//   aukora-echo accept --as <peerId>           retain one, and sign what was retained
//   aukora-echo verify --as <peerId>           did the answer answer OUR question?
//
// Documents arrive on stdin and leave on stdout, so the transport is whatever the owner already
// trusts to move a file. That is not a security boundary and nothing here treats it as one.
//
// EXIT CODES ARE THE ASSURANCE, and the label is printed FIRST so a human reading the terminal and a
// script reading `$?` learn the same thing:
//
//   0  VERIFIED      a second machine acknowledged the exact checkpoint it retained
//   1  CONTRADICTED  two documents are in hand and they cannot both be true
//   2  UNAVAILABLE   nobody answered. NOT success.

import { readFileSync } from 'node:fs';

import {
  identity, importPeer, emit, accept, verify, pendingFor, ASSURANCE, EXIT,
} from '../core/echo/courier.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] ?? '';
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : (argv[i + 1] ?? null);
};

const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s = '') => process.stderr.write(`${s}\n`);

/** Every path out of this program prints the label before anything else. */
const say = (assurance, reason) => {
  out(`${assurance}${reason ? ` — ${reason}` : ''}`);
  return EXIT[assurance];
};

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function parseStdin() {
  const text = readStdin();
  if (!text.trim()) return { ok: false, reason: 'nothing arrived on stdin' };
  try { return { ok: true, doc: JSON.parse(text) }; }
  catch (e) { return { ok: false, reason: `stdin is not JSON: ${e?.message ?? 'unparseable'}` }; }
}

const repoRoot = process.cwd();

switch (cmd) {
  case 'identity': {
    // Public halves only, by construction — see `exportablePeer`, which is an allow-list.
    out(JSON.stringify(identity(), null, 2));
    process.exit(0);
    break;
  }

  case 'import-peer': {
    const parsed = parseStdin();
    if (!parsed.ok) process.exit(say(ASSURANCE.UNAVAILABLE, parsed.reason));
    const r = importPeer(parsed.doc, { expect: flag('expect') });
    if (!r.ok) {
      err(r.reason);
      // A refused import is not a contradiction between documents — it is the owner not having
      // confirmed, or a document that is not what it claims. Nothing was established.
      process.exit(say(ASSURANCE.UNAVAILABLE, 'the peer was not imported'));
    }
    out(`imported ${r.peerId}${r.alreadyKnown ? ' (already known — unchanged)' : ''}`);
    process.exit(0);
    break;
  }

  case 'emit': {
    const asPeerId = flag('as');
    if (!asPeerId) process.exit(say(ASSURANCE.UNAVAILABLE, 'emit needs --as <peerId>'));
    // `--anchor` is for a witness meeting an existing chain. Measured on the owner's node: a first
    // push replaying from genesis weighs 785 KB over 11,993 receipts, which no human relays by hand.
    const r = emit(repoRoot, {
      asPeerId, forWitness: flag('for'), anchor: argv.includes('--anchor'),
      at: new Date().toISOString(), atMs: Date.now(),
    });
    if (!r.ok) {
      err(r.reason);
      process.exit(say(ASSURANCE.UNAVAILABLE, 'no push was produced'));
    }
    if (r.pending) err(r.reason);
    out(JSON.stringify(r.doc, null, 2));
    process.exit(0);
    break;
  }

  case 'accept': {
    const asWitness = flag('as');
    if (!asWitness) process.exit(say(ASSURANCE.UNAVAILABLE, 'accept needs --as <peerId>'));
    const parsed = parseStdin();
    if (!parsed.ok) process.exit(say(ASSURANCE.UNAVAILABLE, parsed.reason));

    const r = accept(parsed.doc, { asWitness, acceptNewEpoch: argv.includes('--accept-new-epoch') });
    // LOUD, on success as well as failure. A repository witnessed under a different writer identity is
    // either a second machine or a deleted `writer.id` — and the second is the attack this exists to
    // notice, because a wiped writer makes every retained checkpoint stop being compared against.
    for (const e of r.epochChange ?? []) {
      err(`WRITER EPOCH CHANGED — this witness already holds checkpoints for this repository under ${e}.`);
      err('A new writer identity is a new machine, OR a deleted one. Do not assume the first.');
    }
    if (!r.ok) {
      err(r.reason);
      // An epoch change is not a CONTRADICTION between documents — nothing here disagrees with
      // anything. It is assurance this witness cannot establish without the owner looking, which is
      // exactly what UNAVAILABLE means and why it has its own exit code.
      const kind = (r.epochChange ?? []).length > 0 ? ASSURANCE.UNAVAILABLE : ASSURANCE.CONTRADICTED;
      process.exit(say(kind, kind === ASSURANCE.UNAVAILABLE
        ? 'the writer identity changed; confirm with --accept-new-epoch once you know which it is'
        : 'this witness refused the push'));
    }
    out(JSON.stringify(r.doc, null, 2));
    err(`retained seq ${r.retained.seq} at count ${r.retained.receiptCount}`);
    // THE ANCHOR CAVEAT, ON THE SIDE THAT ACTUALLY HOLDS IT. `emit --anchor`'s own help text above
    // already promises this ("the witness starts HERE and proves nothing before it"); the witness
    // that just accepted the checkpoint is the one machine that needs to be told the same thing about
    // what it is now holding, so a person reading this line does not mistake it for a checkpoint
    // verified from genesis.
    if (r.retained.anchored) {
      err('  ANCHORED — this witness starts here and can say nothing about what came before this count.');
    }
    process.exit(0);
    break;
  }

  case 'verify': {
    const asPeerId = flag('as');
    if (!asPeerId) process.exit(say(ASSURANCE.UNAVAILABLE, 'verify needs --as <peerId>'));
    const parsed = parseStdin();
    if (!parsed.ok) process.exit(say(ASSURANCE.UNAVAILABLE, parsed.reason));

    const r = verify(repoRoot, { asPeerId, ackDoc: parsed.doc });
    if (r.assurance === ASSURANCE.VERIFIED) {
      const code = say(ASSURANCE.VERIFIED, null);
      out(`  witness ${r.witnessPeerId} retained this chain at count ${r.receiptCount} (seq ${r.seq})`);
      out('  and signed an acknowledgement of the exact checkpoint it retained.');
      process.exit(code);
    }
    process.exit(say(r.assurance, r.reason));
    break;
  }

  case 'pending': {
    const asPeerId = flag('as');
    if (!asPeerId) process.exit(say(ASSURANCE.UNAVAILABLE, 'pending needs --as <peerId>'));
    const p = pendingFor(asPeerId);
    if (!p) process.exit(say(ASSURANCE.UNAVAILABLE, 'nothing is awaiting acknowledgement'));
    out(JSON.stringify(p, null, 2));
    process.exit(0);
    break;
  }

  default: {
    err('aukora-echo — carry one witness fact between two machines.');
    err('');
    err('  identity                        what this machine can safely tell another');
    err('  import-peer --expect <peerId>   trust on first use; compare the id BY EYE');
    err('  emit --as <peerId> [--for <w>]  the checkpoint we want retained');
    err('           [--anchor]             first contact with an existing chain: the witness');
    err('                                  starts HERE and proves nothing before it');
    err('  accept --as <peerId>            retain one, and sign what was retained');
    err('           [--accept-new-epoch]   confirm a changed writer identity, after looking');
    err('  verify --as <peerId>            did the answer answer OUR question?');
    err('  pending --as <peerId>           show the push still in flight');
    err('');
    err('Documents move on stdin/stdout. The transport is not trusted; the signatures are.');
    process.exit(2);
  }
}
