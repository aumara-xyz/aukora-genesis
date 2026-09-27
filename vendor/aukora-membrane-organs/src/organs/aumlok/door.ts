// φ · ceremony/door.ts — the AUMLOK vow, its own process
//
// ══ TRANSPLANTED FROM aukora-one/ui/ceremony/door.mjs ══
//
// This is where standing is born. It is a separate process on a separate port, started deliberately, and
// it exits after one ceremony.
//
// ══ WHY THIS IS NOT PART OF THE MAIN DOOR ══
//
// The donor's reasoning transfers without a word changed, because φ has the same two-door shape:
//
//     `ui/door.mjs` serves the shell and is read-only. Its import list is the proof. It does NOT import
//     `hybrid-keygen` or `secure-custody`, and it therefore **cannot** mint a key — not by policy, by
//     reachability.
//
// φ's `surface/door.ts` is the always-running, browser-facing surface. It imports
// `core/authority/standing.ts`, which imports `core/authority/vowRecord.ts` — a reader with no write and
// no randomness in it. This file is the only one that can MINT standing, it is off by default, and
// `test/vow-standing.test.ts` asserts the direction of those arrows. Putting the ceremony on the main
// door would have quietly given the browser-facing surface the power to raise its own standing.
//
// ══ REHEARSAL IS THE DEFAULT, AND THAT IS DELIBERATE ══
//
// The owner said, plainly: *"until then, I don't want to go through Aumlok. I want that next Aumlok
// onboarding to be potentially the official one that I finally do, instead of testing all the time."*
//
// So this door runs in REHEARSAL unless the owner explicitly says otherwise. A rehearsal mints a real
// phrase from the real CSPRNG, runs the real type-back, and writes a real record and a real receipt —
// into a THROWAWAY DIRECTORY that is not this repository's `.aukora`. Nothing this node reads changes,
// and its standing is untouched the moment the process exits.
//
// The whole path is therefore provable without spending the ceremony. Going real requires setting
// `AUKORA_CEREMONY=real` by hand. No agent sets it, no test sets it, and a rehearsal can never silently
// become the real thing — the mode is decided at construction and reported in every response.
//
// ══ WHAT THE VOW IS WORTH, SAID HERE BECAUSE THIS IS WHERE IT IS SPENT ══
//
// The phrase is 14.3 bits of min-entropy — about twice a 4-digit PIN, measured three ways in
// `recovery.ts`. It is NOT the credential and this door never treats it as one. What authorizes a real
// vow is that someone with the machine, the shell and the intent started this process in real mode; the
// phrase proves a person was present for it and typed back seven words they had been shown once. Those
// are two different claims and `/api/bind/status` ships both as data so no surface has to paraphrase
// either.
//
// ══ WHAT DID NOT COME ACROSS: THE PAGE ══
//
// The donor's 54KB `page.html` — his 652-line original, with the trefoil emblem, the AURA birth renderer
// and a vendored Three.js — is not here. It belongs to `surface/`, which is another lane, and it needs
// three assets this repository does not have. A page that renders a broken emblem and can never play the
// birth would be a claim, not a capability.
//
// So the vow is performed from a terminal today, and `GET /` says exactly that and prints the three calls
// rather than implying a screen. That is the honest state of it, and `PROVENANCE.md` records the page as
// NOT TAKEN with this reason rather than leaving a reader to discover it.

import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateAcrosticPhrase, type AcrosticPhrase } from './phrase';
import { BIND_PHRASE_WORDS, sealPhrase, verifyPhrase, type SealedPhrase } from './verify';
import { genesisResponse, deriveGenesisRef } from './genesis';
import { ceremonyClaim } from './recovery';
import { vowPresent } from '../../core/authority/vowRecord';
import { currentStanding } from '../../core/authority/standing';
import { makeVowCommit, type VowOutcome, type VowPayload, type VowReceipt } from './vow';

/**
 * Outside every port φ's tree already declares. Asserted against all of them, not assumed.
 *
 * This was 7401 for one afternoon, which is how long it took to collide with `conformance/proof-room.ts` in
 * another lane — discovered by starting the door and getting `EADDRINUSE` from Bun. The donor had a whole
 * module for this (`authority/ports.mjs`, `assertPortNotReserved`) and it did not come across, so the test
 * checked this port against `surface/door.ts` and nothing else. It now scans the tree, which is the part of
 * that registry φ can actually have today: a literal nobody maintains cannot go stale.
 */
export const CEREMONY_PORT = 7402;

/** The ONE string that makes this real. Nothing else, nowhere else. */
export const REAL_MODE_ENV = 'AUKORA_CEREMONY';
export const REAL_MODE_VALUE = 'real';

/** Milliseconds the door lingers after a completed ceremony, then exits. */
export const LINGER_MS = 20_000;

/** A POST body larger than this is a mistake or an attack; neither needs to be buffered. */
export const MAX_BODY = 8192;

export const CEREMONY_REFUSALS = Object.freeze([
  'ceremony:already-vowed',
  'ceremony:no-candidate',
  'ceremony:phrase-mismatch',
  'ceremony:candidate-expired',
  'ceremony:stale-nonce',
  'ceremony:foreign-origin',
  'ceremony:no-lineage',
  'ceremony:body-too-large',
  'ceremony:no-custody-sink',
  'ceremony:commit-failed',
]);

export type CeremonyMode = 'rehearsal' | 'real';

/** Is this the real thing? Decided once, reported everywhere. */
export function ceremonyMode(env: Record<string, string | undefined> = process.env): CeremonyMode {
  return env[REAL_MODE_ENV] === REAL_MODE_VALUE ? 'real' : 'rehearsal';
}

export interface CeremonyDoorDeps {
  mode?: CeremonyMode;
  now?: () => number;
  /** Does this node already carry a vow? Defaults to the reader `standing.ts` uses. */
  isVowed?: () => boolean;
  commit?: (arg: { vow: VowPayload; receipt: VowReceipt }) => Promise<VowOutcome | undefined>;
  port?: number;
  scheduleExit?: false | undefined;
  exit?: () => void;
}

const json = (code: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json; charset=utf-8' } });

/**
 * One ceremony's state. Lives in memory for the life of the process and is wiped the moment it is
 * consumed or abandoned.
 *
 * The donor's comment here is about the seeds: "That window is the only time key material exists outside
 * custody… nothing serializes it — `toSafe()` is what every response goes through, and it cannot reach
 * the seeds because it does not close over them."
 *
 * φ mints no seeds, so the sensitive thing in this object is the PHRASE and its sealed record. The same
 * discipline applies for a different reason: the phrase is shown exactly once, on the mint response, and
 * must never appear again — not in the receipt, not in the vow record, not in any later response. The
 * sealed record must never appear at all, because a sealed 14-bit phrase is recoverable by enumeration in
 * about 32 CPU-minutes and handing one out would be handing out the phrase.
 */
interface Candidate {
  mode: CeremonyMode;
  phrase: AcrosticPhrase;
  sealed: SealedPhrase;
  vowId: string;
  genesisRef: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
  toSafe(): {
    mode: CeremonyMode;
    genesisRef: string;
    anchor: string;
    words: string[];
    tokens: string[];
    rows: string[];
    expiresAt: string;
  };
}

function newCandidate({ now, mode }: { now: number; mode: CeremonyMode }): Candidate {
  const phrase = generateAcrosticPhrase();
  const nonce = randomBytes(16).toString('hex');
  const createdAt = now;
  const boundAt = new Date(createdAt).toISOString();
  // ── THE VOW ID IS RANDOM, NOT DERIVED FROM THE PHRASE ──
  //
  // Deriving it would have been tidy and would have been the defect: the phrase has 45,248 reachable
  // values, so a public id derived from it is an enumerable pointer back to it. In the donor this id is a
  // fingerprint of a real Ed25519 + ML-DSA-65 root and carries the entropy of a key; here there is no key,
  // so the id must carry its own.
  const vowId = randomBytes(16).toString('hex');
  const genesisRef = deriveGenesisRef({ rootId: vowId, boundAt });
  return {
    mode,
    phrase,
    // Sealed at mint with a FRESH salt, per the donor. The typed-back phrase is checked against this in
    // constant time; the words are never compared.
    sealed: sealPhrase(phrase.phrase),
    vowId,
    genesisRef,
    nonce,
    createdAt,
    expiresAt: createdAt + 15 * 60_000,
    /** Everything a response may contain. The sealed record is structurally absent. */
    toSafe() {
      return {
        mode,
        genesisRef,
        // SEVEN tokens. The anchor is word zero — shown, typed, fingerprinted. A page would render
        // tokens[0] as the vertical spine and the words beside it.
        anchor: phrase.anchor,
        words: phrase.words,
        tokens: phrase.tokens,
        rows: ['root', 'root', 'unite', 'unite', 'rise', 'rise'],
        expiresAt: new Date(this.expiresAt).toISOString(),
      };
    },
  };
}

/**
 * Is this request from the ceremony's own caller?
 *
 * Antigravity, round 11 on the donor: that door had NO Host or Origin check. While the ceremony ran, any
 * website the owner happened to visit could POST to `/api/bind/phrase` — a simple POST needs no preflight
 * — and drive the ceremony on his machine. The donor's author had added this fence to the harmless
 * read-only door days earlier and left it off the only one that can mint authority.
 *
 * Not owner authentication, and not described as such: another local process sets any header it likes. It
 * closes the browser vector, which is the one a stranger can reach.
 */
export function ceremonyCallerIsLocal(req: { headers: Headers }, port: number): boolean {
  const host = req.headers.get('host') ?? '';
  if (!new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(host)) return false;
  const origin = req.headers.get('origin');
  if (origin === null) return true;   // the ceremony's own fetch, and curl
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

const TERMINAL_NOTE = (port: number, mode: CeremonyMode) => `φ · THE AUMLOK VOW  (${mode})

There is no page here yet. The donor's ceremony page belongs to another lane and needs three assets
this repository does not have, so this door is honest about being a terminal ceremony today.

  1. see where this node stands
     curl -s http://127.0.0.1:${port}/api/bind/status

  2. be shown seven words — ONCE. Write them down.
     curl -s -X POST http://127.0.0.1:${port}/api/bind/phrase

  3. type them back, with the nonce from step 2
     curl -s -X POST http://127.0.0.1:${port}/api/bind/complete \\
       -d '{"phrase":"<the seven words>","nonce":"<nonce>"}'

The phrase is worth 14.3 bits of min-entropy — about twice a 4-digit PIN. It proves a person was here.
What authorizes a real vow is that you started this process yourself, in real mode, on your own machine.
`;

/**
 * Build the ceremony door.
 *
 * Returned as a `{ fetch }` handler rather than a listening server so a test can drive it with a real
 * `Request` and read a real `Response`. The donor's suite had to fake `req`/`res` objects and emit
 * `'request'` at a `node:http` server — its own comment calls this "Drive the door without opening a
 * socket" — and the fake was thin enough that the Host-header fence had to be worked around inside the
 * harness. Under Bun the honest object is available, so the fence is exercised as the browser would
 * present it.
 */
export function createCeremonyDoor(deps: CeremonyDoorDeps = {}) {
  const mode = deps.mode ?? ceremonyMode();

  // ══ THE VOW MUST NOT BE SPENT ON NOTHING ══
  //
  // In the donor, `deps.commit` had NO production caller. With AUKORA_CEREMONY=real the door would have
  // minted real seeds, run the real type-back, written a receipt reading `rehearsal: false` — and then
  // dropped the seeds on the floor at the line that clears the candidate. A receipt claiming a binding
  // that did not happen, and the owner's ONE ceremony gone.
  //
  // A rehearsal may discard its result; that is what a rehearsal is. A real ceremony that discards it is
  // the worst outcome this file can produce, so it refuses to exist rather than run.
  if (mode === 'real' && typeof deps.commit !== 'function') {
    const e = new Error('a REAL ceremony requires a commit path — refusing to run a vow with nowhere to put it');
    (e as Error & { reasonClass?: string }).reasonClass = 'ceremony:no-custody-sink';
    throw e;
  }

  const now = (): number => (deps.now ? deps.now() : Date.now());
  const isVowed = deps.isVowed ?? (() => vowPresent());
  const port = deps.port ?? CEREMONY_PORT;

  let candidate: Candidate | null = null;
  let completed: { vowId: string; genesisRef: string; boundAt: string; rehearsal: boolean } | null = null;

  async function handle(req: Request): Promise<Response> {
    const p = new URL(req.url).pathname;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return new Response(TERMINAL_NOTE(port, mode), {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    // ══ THE OWNER'S OWN PROTOCOL ══
    //
    // These route names and response shapes are HIS, from `spatial/aumlok-bind-serve.ts` by way of the
    // donor. The donor's author had invented `/api/ceremony/*` with their own shapes and then changed the
    // door to speak his protocol instead of editing his page. His protocol is the artifact worth keeping,
    // so φ speaks it too — even though φ has no page of his to satisfy.
    if (req.method === 'GET' && p === '/api/bind/status') {
      // AUMLOK-REHEARSAL-STATUS-v0: standing / vowPresent / identityBound ship as DATA so the
      // membrane Apps panel and this door never disagree on the five fields a surface must show.
      // identityBound is always false here — forge identity is a different lane (loopback until
      // a real ceremony binds a person). grantsAuthority is always false — this door mints
      // standing; it does not grant authority to the process that serves the status.
      const vowed = isVowed();
      const standing = currentStanding();
      return json(200, {
        ok: true,
        posture: vowed ? 'vowed' : 'courtyard',
        standing,
        vowPresent: vowed,
        enabled: true,
        // ══ WHAT THE PHRASE PROVES, AND WHAT IT DOES NOT — issue #133 ══
        //
        // The phrase keyspace was enumerated exhaustively: 45,248 phrases, 14.3 bits of min-entropy. It
        // is about twice a 4-digit PIN. A ceremony that states this is more credible than one that
        // implies otherwise, and the owner is entitled to read it BEFORE an irreversible act rather than
        // after. It ships as DATA from `recovery.ts` rather than as prose here, so the screen cannot
        // drift from the measurement — `test/ceremony-recovery.test.ts` pins the number.
        phraseClaim: ceremonyClaim(),
        // ══ REAL MODE MUST NOT EMIT A FALSY ADVISORY ══
        //
        // The donor emitted `null` here in real mode, and `page.html:509` reads ANY falsy advisory as
        // lockdown: `if(!st.advisory){ … "Capability mode is lockdown — the ceremony waits." }`. So the
        // owner's real binding dead-ended on a banner while the rehearsal worked — the rehearsal
        // rehearsed something that could not happen. Issue #78.
        //
        // φ has no page of his to break, and the contract is kept anyway: this is the last thing a person
        // reads before an irreversible act, so real mode should say what is about to happen rather than
        // say nothing.
        advisory: mode === 'real'
          ? 'REAL VOW — this records a vow on this node and moves its standing from courtyard to vowed, '
            + 'which is what lets a write verb resolve here. It happens ONCE. Write the seven words down '
            + 'before you type them back; nothing here can recover them for you.'
          : 'REHEARSAL — a real phrase, a real type-back, a real record and receipt, and NOTHING is kept. '
            + 'This node\'s standing does not move. Run with AUKORA_CEREMONY=real when you mean it.',
        candidateAlive: candidate !== null,
        phraseFormat: 'acrostic-v2',   // seven tokens: [anchor, ...six words]
        recoveryRequired: false,
        mode,
        grantsAuthority: false,
        // Forge Accept remains identityBound:false until a real ceremony binds a human.
        // This door never writes forge proposals; the field is reported so no surface invents it.
        identityBound: false,
      });
    }

    // GET /api/bind/genesis — the public genesis packet a shell would draw the AURA from. Nothing in this
    // repository draws it; `genesis.ts` says so at the top rather than implying a figure.
    if (req.method === 'GET' && p === '/api/bind/genesis') {
      if (!completed) return json(200, { ok: true, present: false });
      return json(200, genesisResponse({ rootId: completed.vowId, boundAt: completed.boundAt }));
    }

    // Every POST is fenced. A GET may be read cross-origin and reveals only posture; a POST mints a
    // candidate or spends one.
    if (req.method === 'POST' && !ceremonyCallerIsLocal(req, port)) {
      return json(403, {
        ok: false,
        reason: 'this ceremony answers its own caller only',
        reasonClass: 'ceremony:foreign-origin',
      });
    }

    if (req.method === 'POST' && p === '/api/bind/phrase') {
      if (isVowed() && mode === 'real') {
        return json(409, { ok: false, reason: 'node already vowed', reasonClass: 'ceremony:already-vowed' });
      }
      candidate = newCandidate({ now: now(), mode });
      const safe = candidate.toSafe();
      return json(200, {
        ok: true,
        mode: 'bind',
        anchor: safe.anchor,
        words: safe.words,
        tokens: safe.tokens,          // [anchor, ...six] — the spine plus its words
        // The one time the phrase appears in a response. After this it exists only as a salted scrypt
        // record the door holds in memory and never serializes.
        phrase: candidate.phrase.phrase,
        rows: safe.rows,
        nonce: candidate.nonce,
        expiresAt: candidate.expiresAt,
      });
    }

    // POST /api/bind/cancel — the pre-commitment dies; nothing else is touched.
    if (req.method === 'POST' && p === '/api/bind/cancel') {
      candidate = null;
      return json(200, { ok: true, revoked: true, candidateAlive: false });
    }

    // POST /api/bind/complete — the type-back, and the only path to standing.
    if (req.method === 'POST' && p === '/api/bind/complete') {
      const declared = Number(req.headers.get('content-length') ?? 0);
      if (declared > MAX_BODY) {
        return json(413, { ok: false, reason: 'body too large', reasonClass: 'ceremony:body-too-large' });
      }
      const body = (await req.text()).slice(0, MAX_BODY);

      if (!candidate) {
        return json(403, { ok: false, reason: 'no ceremony in progress', reasonClass: 'ceremony:no-candidate' });
      }

      // ══ THE CHECK MUST BE AT THE MOMENT OF EFFECT ══
      //
      // In the donor, `isBound()` guarded `/api/bind/phrase` and nothing else, so a candidate minted while
      // unbound could be COMPLETED after the node acquired a binding: 200, no refusal, `commit()` called.
      // Proved by running the door, not by reading it — Sakana, round 9.
      //
      // Between intent and effect lies everything that can change. A guard on the first of the two is a
      // guard on the wrong one.
      if (isVowed() && mode === 'real') {
        candidate = null;   // and the phrase goes with it
        return json(409, {
          ok: false,
          reason: 'this node has already vowed — a ceremony may not complete against a standing vow',
          reasonClass: 'ceremony:already-vowed',
        });
      }
      if (now() > candidate.expiresAt) {
        candidate = null;
        return json(403, { ok: false, reason: 'the phrase expired — shuffle a fresh one', reasonClass: 'ceremony:candidate-expired' });
      }

      let parsed: { phrase?: unknown; nonce?: unknown } = {};
      try { parsed = JSON.parse(body || '{}'); } catch { /* falls through to the nonce check */ }

      if (parsed.nonce !== candidate.nonce) {
        return json(403, { ok: false, reason: 'stale ceremony screen — shuffle a fresh phrase', reasonClass: 'ceremony:stale-nonce' });
      }
      if (!verifyPhrase(parsed.phrase ?? '', candidate.sealed)) {
        // NO ATTEMPT CAP, deliberately. The donor caps at three; the owner ruled on 27 July: "we don't
        // need the cap back right now, make everything very open" — framework first, hardening later.
        // Recorded here rather than silently omitted, because a reviewer found the omission on the donor
        // and it is now a decision instead of a gap. What makes it affordable is that this door is not
        // reachable from a browser and is not running by default.
        return json(403, { ok: false, reason: 'that is not the phrase', reasonClass: 'ceremony:phrase-mismatch' });
      }

      const boundAt = new Date(candidate.createdAt).toISOString();
      const receipt = {
        schema: 'aumlok-standing-vow-receipt-v1',
        mode,
        genesisRef: candidate.genesisRef,
        vowId: candidate.vowId,
        phraseSalt: candidate.sealed.saltHex,
        phraseWords: BIND_PHRASE_WORDS,
        boundAt,
        rehearsal: mode !== 'real',
      };
      const vow: VowPayload = {
        vowId: candidate.vowId,
        phraseSalt: candidate.sealed.saltHex,
        phraseWords: BIND_PHRASE_WORDS,
      };

      let outcome: VowOutcome | undefined;
      try {
        outcome = await (deps.commit ?? (async () => ({
          written: [], recordVerified: false, standing: 'courtyard' as const, standingRaised: false,
          verified: false, note: 'no standing sink', rehearsal: receipt.rehearsal,
        })))({ vow, receipt });
      } catch (err) {
        const e = err as Error & { reasonClass?: string };
        return json(500, { ok: false, reason: e?.message ?? 'commit failed', reasonClass: e?.reasonClass ?? 'ceremony:commit-failed' });
      }

      completed = { vowId: receipt.vowId, genesisRef: receipt.genesisRef, boundAt, rehearsal: receipt.rehearsal };
      candidate = null; // the phrase and its sealed record become unreachable here

      if (deps.scheduleExit !== false) {
        const t = setTimeout(() => (deps.exit ?? (() => process.exit(0)))(), LINGER_MS);
        if (typeof t.unref === 'function') t.unref();
      }
      return json(200, {
        ok: true,
        mode: 'bind',
        // `candidate` is null by now — deliberately, on the line above, so the phrase becomes
        // unreachable. The donor read `candidate?.root?.rootId` HERE, which made the operand dead and
        // `keyId` ALWAYS the genesisRef prefix: a hash DERIVED FROM the id, shown to the owner under the
        // label `keyId` at the single moment of binding. Read the receipt, which captured the real value
        // before the null.
        vowId: receipt.vowId,
        rehearsal: receipt.rehearsal,
        standing: outcome?.standing ?? 'courtyard',
        verified: outcome?.verified === true,
        note: outcome?.note ?? null,
      });
    }

    // Rotation and lineage recovery are for a node with a standing vow and a history. This node has
    // neither, and a menu item that cannot act is worse than an absent one.
    if (req.method === 'POST' && (p === '/api/bind/rotate' || p === '/api/bind/recover')) {
      return json(403, {
        ok: false,
        reason: 'this node has no standing lineage to rotate or recover',
        reasonClass: 'ceremony:no-lineage',
      });
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      return json(405, { error: 'ceremony-door', allowed: ['GET', 'POST'] });
    }
    return json(404, { error: 'no-such-endpoint' });
  }

  return { fetch: handle, mode, port };
}

/**
 * WHERE A RUN OF THIS DOOR IS ALLOWED TO WRITE — decided from the mode, once, here.
 *
 * The donor's comment: "In rehearsal it is the ephemeral in-memory backend; going real supplies the
 * Keychain one. The door does not choose — `startCeremonyDoor` does, from the mode, once."
 *
 * φ's rehearsal home is a fresh `mkdtemp`, and it is minted HERE rather than defaulted inside the commit
 * so that `makeVowCommit` can refuse a rehearsal that arrives without one. Two independent places have to
 * agree before a rehearsal can touch the real `.aukora`, and neither of them will.
 */
export function ceremonyHomeFor(mode: CeremonyMode): { dir?: string } {
  return mode === 'real' ? {} : { dir: mkdtempSync(join(tmpdir(), 'phi-ceremony-rehearsal-')) };
}

/**
 * Start it. 127.0.0.1 only — this door does not answer the network.
 *
 * The sink is built from the mode unless a caller supplies its own, which is what the tests do. A real run
 * writes into this repository's `.aukora`; a rehearsal writes into a throwaway directory and the node's
 * standing does not move.
 */
export function startCeremonyDoor(port: number = CEREMONY_PORT, deps: CeremonyDoorDeps = {}) {
  const mode = deps.mode ?? ceremonyMode();
  const paths = ceremonyHomeFor(mode);
  const commit = deps.commit ?? makeVowCommit({ paths });
  const door = createCeremonyDoor({ ...deps, mode, commit, port });
  let server: unknown;
  try {
    server = Bun.serve({ hostname: '127.0.0.1', port, fetch: door.fetch });
  } catch (err) {
    // ── THE CEREMONY DOOR DOES NOT MOVE ──
    //
    // The donor's words, and they are a decision rather than a limitation: something else is already
    // answering on this port, and a ceremony that wandered to 7403 would be a ceremony whose owner cannot
    // be sure which process they just spoke to. It refuses by name instead.
    if ((err as { code?: string })?.code === 'EADDRINUSE') {
      const e = new Error(`port ${port} is already in use — the ceremony door will not move`);
      (e as Error & { reasonClass?: string }).reasonClass = 'ceremony:port-occupied';
      throw e;
    }
    throw err;
  }
  return { server, mode, paths };
}

if (import.meta.main) {
  const { mode, paths } = startCeremonyDoor();
  console.log(`\n  φ · THE AUMLOK VOW   http://127.0.0.1:${CEREMONY_PORT}`);
  console.log(`     mode: ${mode}${mode === 'real' ? '  — this one counts' : `  — writes to ${paths.dir}, kept by nothing`}`);
  console.log('     open the address above for the three calls, or GET /api/bind/status\n');
}

/** The ceremony creates standing. It does not GRANT any to this process. */
export function ceremonyDoorGrantsAuthority(): boolean {
  return false;
}
