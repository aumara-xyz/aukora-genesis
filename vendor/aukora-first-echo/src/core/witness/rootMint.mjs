// aukora · core/witness/rootMint.mjs — THE ROOT IS RANDOM, AND THIS FILE PROVES IT ABOUT ITSELF
//
// ══ PROVENANCE ══
//
// ADAPTED from `aukora-one/ui/ceremony/root.mjs` @ 35e98e3 (file blob
// 7f43089f9dbedc17c2d3b29589fe3fd338b79b4f0cc67729f507628896029d28). `DERIVATION_PRIMITIVES`, the
// self-reading guard and its refusal shape are the donor's; the minting is φ's own (the donor mints
// through a hybrid PQ keygen φ does not carry). The donor's honest limits are carried across
// verbatim in meaning and are restated below rather than dropped.
//
// ══ WHY THIS IS A SEPARATE FILE ══
//
// Because the guard is file-scoped, and it has to be. `aumlok.mjs` legitimately contains `scryptSync`
// (the phrase factor), `hkdfSync` (combining two factors) and `createCipheriv` (the seal) — every one
// of them a derivation primitive, every one of them correct THERE. The rule is not "this codebase
// contains no KDF"; it is "the ROOT is not derived from anything a human can remember". So the mint
// lives alone, in a file that can be checked to contain no such primitive at all, and the wrapping
// lives next door where deriving is the job.
//
// A guard that had to reason about WHICH call site a primitive belonged to would be a guard nobody
// could believe. This one answers a question with a yes-or-no: does this file contain any way to turn
// a remembered thing into key bytes?
//
// ══ WHAT THIS GUARD DOES NOT PROVE, STATED PLAINLY ══
//
// It reads THIS FILE FROM DISK. That proves the source carries no derivation primitive. It does NOT
// prove the bytes that execute are those bytes: a caller that monkey-patches `randomBytes`, or a
// loader that serves different source, defeats it entirely. It is a guard against the change someone
// would actually make — reaching for the phrase because the root has to come from somewhere the
// owner can remember — and not against an attacker who already runs code in this process.
//
// It should not be quoted as though it were more than that.

import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** 32 bytes. The root is wrapped, never memorised, so there is no reason to be shy. */
export const ROOT_BYTES = 32;

/**
 * Every primitive that turns a remembered thing into key bytes.
 *
 * `createHash` is on the list deliberately even though it is not a KDF: a `sha256(phrase)` root is
 * the single most likely wrong implementation, and it would sail past a list naming only scrypt and
 * pbkdf2. `hkdfSync` is on it for the same reason in the other direction — combining two factors is
 * exactly what `aumlok.mjs` should do and exactly what this file must not.
 */
export const DERIVATION_PRIMITIVES = Object.freeze([
  'scrypt', 'scryptSync', 'pbkdf2', 'pbkdf2Sync', 'hkdf', 'hkdfSync',
  'createHash', 'createHmac', 'deriveBits', 'deriveKey', 'importKey',
  'createCipheriv', 'createDecipheriv',
]);

export class RootError extends Error {
  constructor(reasonClass) {
    // Content-free, like every refusal in this organ: the constructor never receives the offending
    // value, so a refusal can never echo key material into a log.
    super(`root refused: ${reasonClass}`);
    this.name = 'RootError';
    this.reasonClass = reasonClass;
  }
}

/**
 * THE ROOT KEY PAIR. CSPRNG and nothing else.
 *
 * ══ WHY THIS FUNCTION EXISTS AND `mintRoot` NO LONGER STANDS ALONE ══
 *
 * The first version of this module exported `mintRoot()`, which returned 32 random bytes — and
 * `bind()` never called it. It called `generateKeyPairSync` directly, and this module was imported by
 * nothing but its own test. So the source-scanning proof that "the root is random, never derived"
 * described a helper the production path did not use.
 *
 * The key generation was cryptographically fine the whole time. The PROOF was decorative, and a
 * decorative proof is worse than none: it reads as protection. It was also never wireable as
 * written — an ed25519 root is a key pair, not 32 loose bytes — so the helper could not have been
 * routed through even by someone who noticed.
 *
 * `generateKeyPairSync` is NOT a derivation primitive and is deliberately absent from
 * `DERIVATION_PRIMITIVES` above:
 * it turns entropy into a key, not a memorable thing into one. Moving it here keeps the file's claim
 * exactly as strong and makes it a claim about the path that actually runs.
 */
export function mintRootKeyPair() {
  return generateKeyPairSync('ed25519');
}

/** Raw root bytes, for a caller that needs a secret rather than a signing pair. */
export function mintRoot() {
  const seed = randomBytes(ROOT_BYTES);
  return seed;
}

/**
 * Read this module's own source and refuse if a derivation primitive appears in it.
 *
 * ══ WHY THE SCAN IS SHAPED THIS WAY ══
 *
 * A naive `src.includes('scryptSync')` is defeated by `crypto['scrypt' + 'Sync']`, and a naive
 * import scan is defeated by `import { scryptSync as mix }`. So the check strips string literals and
 * comments first — the names below are DISCUSSED at length in this file's own header, and a scan
 * that counted those would refuse itself — and then looks for each primitive as a bare identifier,
 * as a bracket-notation member, and as an aliased import.
 *
 * `file` is a parameter so the guard can be watched failing against a deliberately poisoned copy.
 * That is the only reason it exists; production callers pass nothing.
 */
export function assertRootSourceIsRandomOnly(file = new URL(import.meta.url).pathname) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    // A guard that cannot read its own subject must refuse, not shrug.
    throw new RootError('source-unreadable');
  }

  // Strip block comments, line comments and string/template literals. What is left is code.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  for (const name of DERIVATION_PRIMITIVES) {
    // A bare identifier or a member access: `scryptSync(...)`, `crypto.scryptSync`.
    if (new RegExp(`\\b${name}\\b`).test(code)) throw new RootError(`derivation-primitive:${name}`);
  }

  // Bracket notation, including a concatenated name — `crypto['scrypt' + 'Sync']` must not sail past
  // a scan that only knows identifiers.
  //
  // MEMBER ACCESS, NOT ARRAY LITERALS, and the distinction was found by the guard refusing ITSELF:
  // the first draft matched any `[` followed by a quote, which is exactly what `Object.freeze([` plus
  // the primitive list above looks like once string literals have been blanked. A check that cannot
  // pass its own file is not stricter, it is broken — so the `[` must be preceded by something a
  // member access is preceded by (an identifier, a closing paren, a closing bracket) rather than by
  // the `(`, `=` or `,` that opens an array.
  // AND A SUBSCRIPT THIS SCAN CANNOT READ IS "UNINSPECTED", NOT "CLEAN". The pattern above required
  // the `[` to be followed by a blanked string or a concatenation, so it caught
  // `crypto['scrypt' + 'Sync']` and missed the simpler:
  //
  //     const p = 'scryptSync';
  //     crypto[p](...)
  //
  // The literal is blanked to `''` before the name scan runs, so the primitive never appears as an
  // identifier, and `crypto[p]` carries no `+`. Both halves of the guard looked past it.
  //
  // A member access whose subscript is a VARIABLE cannot be resolved by reading the file — its value
  // is decided at run time. There is no version of this scan that answers "clean" honestly about it,
  // so it refuses. Numeric subscripts are exempt because `xs[0]` names nothing that could be a
  // primitive; an identifier subscript is not, even a benign one, because the guard cannot tell.
  if (/[A-Za-z_$\])]\s*\[\s*(?:''|""|``|[A-Za-z_$][\w$]*\s*(?:\+|\]))/.test(code)) {
    throw new RootError('computed-member-access');
  }

  // ENTROPY CALLS ARE COUNTED AND SANCTIONED BY NAME.
  //
  // Two are expected and no more: the key-pair mint and the raw-byte mint. Counting them keeps the
  // original property — a second, unexplained source of "randomness" in this file is the shape of
  // someone quietly folding something else in — while allowing the real keygen to live here, which
  // is the whole point of the move.
  const pairs = code.match(/\bgenerateKeyPairSync\s*\(/g) ?? [];
  const bytes = code.match(/\brandomBytes\s*\(/g) ?? [];
  if (pairs.length !== 1) throw new RootError(`keypair-call-count:${pairs.length}`);
  if (bytes.length !== 1) throw new RootError(`entropy-call-count:${bytes.length}`);

  return true;
}
