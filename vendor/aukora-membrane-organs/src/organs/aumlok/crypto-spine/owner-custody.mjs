// AUKORA ONE · authority/owner-custody.mjs — RING 1
//
// The owner-custody boundary: "does the owner hold custody on this device?"
//
// PROVENANCE: ADAPTED from AUKORA-EVOLUTION 🧬 @ 68210d479a35e325eda4e14ac8fba5dc87db979e,
// `apps/seed/src/ownerCustody.ts`, blob sha256
// 8a186010dd21fb9a6660818f05a6ee9a1df4892649fa419228b36021766fa19b.
// See PROVENANCE.md for the full row and the enumerated adaptations.
//
// ══ WHY THIS FILE IS RENAMESPACED, AND WHY THAT WAS THE FIRST THING DONE ══
//
// The donor resolves the owner key home to `~/.aukora-evolution` (donor line 44).
// A LIVE Evolution node uses that directory on this machine. Carried unchanged,
// Aukora One would probe the live node's custody and report itself
// `custodyComplete: true` — bound to the owner's root, with no ceremony ever
// having happened here. The organism would believe it had an owner it had never
// been given.
//
// That is not a subtle failure. It is the single most dangerous line in this
// transplant, so the namespace was changed BEFORE any ceremony file landed, and
// `test/authority-custody.test.mjs` greps this tree for the donor namespace and
// fails if it ever comes back. A default is not protected by a comment.
//
// Aukora One's own home is `~/.aukora-one`. On an unbound node that directory
// does not exist, `custodyStatus()` returns `custody:absent`, and that is the
// CORRECT answer for a node that has had no binding ceremony.
//
// ══ EXISTENCE ONLY — THE PROPERTY THAT MUST NOT ERODE ══
//
// This module never reads a key byte. Custody is decided by `statSync().isFile()`
// and nothing else. The probe INTERFACE returns a boolean, so an implementation
// that returned content would not typecheck in the donor and does not fit the
// contract here. There is no code path on which private material enters this
// module, and the structural test asserts the absence of every reading verb.
//
// ══ HONEST LIMIT ══
//
// Knowing that four files exist proves nothing about what is in them. This
// module answers "could an owner complete a signing gesture out-of-band on this
// device?" — never "is this the right owner?" and never "is this authorized?".
// Verification of an actual owner root is the kernel's job and the kernel is not
// in this repository yet (#27). Custody is a precondition, never a permission.

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

/**
 * The Aukora One owner-state home. DELIBERATELY NOT the donor's.
 *
 * Exported so the test suite can assert the value rather than trust the prose,
 * and so `secure-custody.mjs` can enforce the two-namespace law against the same
 * name without taking a module dependency on this file.
 */
export const AUKORA_ONE_HOME_ENV = 'AUKORA_ONE_HOME';

/** Directory name under `$HOME`. Its own, sharing state with no sibling node. */
export const AUKORA_ONE_HOME_DIRNAME = '.aukora-one';

/**
 * Existence-only probe. Returns whether a path is a regular file.
 * NEVER returns, reads, opens, or streams file CONTENT.
 */
export const nodeCustodyProbe = Object.freeze({
  isFile(path) {
    try {
      return nodeFs.statSync(path).isFile();
    } catch {
      return false;
    }
  },
});

/** Keys live under `<homeDir>/aumlok/`. */
function keyDir(homeDir) {
  return nodePath.join(homeDir, 'aumlok');
}

/**
 * Resolve the owner-state home.
 *
 * Order: explicit argument → `AUKORA_ONE_HOME` → `~/.aukora-one`. The donor's
 * `AUKORA_EVOLUTION_HOME` is deliberately NOT consulted: honouring it would let
 * an ambient variable set for the live node silently repoint this one, which is
 * the same class of mistake as the default that was just fixed.
 */
export function resolveOwnerHome(paths = {}, env = process.env) {
  if (typeof paths.homeDir === 'string' && paths.homeDir.length > 0) return paths.homeDir;
  const override = env[AUKORA_ONE_HOME_ENV];
  if (typeof override === 'string' && override.length > 0) return override;
  return nodePath.join(env.HOME || '', AUKORA_ONE_HOME_DIRNAME);
}

/**
 * The hybrid custody layout: two public halves (the organism may pin these) and
 * two private halves (owner-only, and never read here).
 *
 * Carried VERBATIM from the donor — the filenames are a wire format shared with
 * the owner's own tooling, and renaming them would strand an existing owner.
 */
export const CUSTODY_FILES = Object.freeze({
  edPub: 'authority-ed25519.pub',
  edKey: 'authority-ed25519.key',
  mlPub: 'authority-mldsa65.pub',
  mlKey: 'authority-mldsa65.key',
});

/** Stable reason classes. Namespaced `custody:` — disjoint from the gate's closed `refused-*` set. */
export const CUSTODY_REASON_CLASSES = Object.freeze([
  'custody:ok',
  'custody:public-absent',
  'custody:private-absent',
  'custody:absent',
]);

/**
 * Existence-only custody status over the hybrid key layout.
 *
 * Total: a missing home degrades to `custody:absent` rather than throwing. A
 * boundary that throws on the ordinary unbound case invites a caller to wrap it
 * in a try/catch and treat the catch as "fine".
 */
export function custodyStatus(paths = {}, probe = nodeCustodyProbe, env = process.env) {
  const dir = keyDir(resolveOwnerHome(paths, env));
  const edPub = probe.isFile(nodePath.join(dir, CUSTODY_FILES.edPub));
  const mlPub = probe.isFile(nodePath.join(dir, CUSTODY_FILES.mlPub));
  const edKey = probe.isFile(nodePath.join(dir, CUSTODY_FILES.edKey));
  const mlKey = probe.isFile(nodePath.join(dir, CUSTODY_FILES.mlKey));

  const publicPresent = edPub && mlPub;
  const privatePresent = edKey && mlKey;
  const custodyComplete = publicPresent && privatePresent;

  let reasonClass = 'custody:ok';
  if (!publicPresent && !privatePresent) reasonClass = 'custody:absent';
  else if (!publicPresent) reasonClass = 'custody:public-absent';
  else if (!privatePresent) reasonClass = 'custody:private-absent';

  return Object.freeze({
    schema: 'aumlok-owner-custody-v2',
    publicPresent,
    privatePresent,
    custodyComplete,
    reasonClass,
    grantsAuthority: false,
  });
}

/** POSIX-shell single-quote escaping (donor `shellQuote`). */
export function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const WARNINGS = Object.freeze([
  'Signing happens ONLY in your own terminal. This app never signs and cannot sign.',
  'Never paste your private key or passphrase into the browser. The app never reads your key — it only checks that the key files exist.',
  'A hybrid signature needs BOTH your Ed25519 and your ML-DSA-65 key. A downgraded (single-algorithm) signature fails closed.',
  'AUMLOK owner decides. Advice only advises — a GREEN verdict is NOT permission to apply.',
]);

/**
 * ADAPTATION — THE GUIDANCE EMITS NO COMMAND IN THIS REPOSITORY.
 *
 * The donor returns concrete terminal commands
 * (`bash scripts/aumlok-authority.sh sign-hybrid …`) because Evolution ships that
 * script and a signer to back it. Aukora One ships NEITHER: `hybridSigner.ts` is
 * BLOCKED on the kernel transplant (#27), and no `scripts/aumlok-authority.sh`
 * exists here.
 *
 * Carrying the donor's strings would have printed a runnable-looking ceremony for
 * a ceremony that does not exist — an overclaim rendered in the owner's own
 * terminal, which is the worst possible place for one. So both commands are
 * `null` while the signer is absent, and the reason is stated in a stable class.
 *
 * When a signer lands, this is the place that changes, and
 * `test/authority-containment.test.mjs` fails the moment a command string appears
 * while the signer does not.
 */
export const NO_SIGNER_REASON = 'authority:no-signer-in-repo';

export function ownerSigningGuidance(payloadHash, paths = {}, probe = nodeCustodyProbe, env = process.env) {
  const custody = custodyStatus(paths, probe, env);
  return Object.freeze({
    schema: 'aumlok-owner-signing-guidance-v2',
    custody,
    // Custody is necessary but NOT sufficient: with no signer in this repository
    // there is nothing to offer, whatever the key files say.
    canOffer: false,
    offerBlockedReason: NO_SIGNER_REASON,
    keygenCommand: null,
    signCommand: null,
    payloadHashPrefix: typeof payloadHash === 'string' ? payloadHash.slice(0, 12) : 'unknown',
    warnings: [...WARNINGS],
    grantsAuthority: false,
  });
}

/** HARD: holding custody is not permission. Constant, by construction. */
export function ownerCustodyGrantsAuthority() {
  return false;
}
