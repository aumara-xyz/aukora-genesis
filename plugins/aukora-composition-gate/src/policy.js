// aukora-composition-gate — the policy, and where it has to be installed to work.
//
// WHAT THIS ENFORCES. A declared plugin module cannot be imported unless a one-use grant
// signed by THIS installation's governor key authorizes exactly those bytes for exactly that
// operation. The import is refused, so the module's body never executes and none of its
// effects are registered.
//
// WHERE IT DECIDES, AND WHY — three earlier mechanisms were measured and rejected:
//
//   1. `internal/status` carries `fiber.name` and looks ideal. It does not work: a fiber's
//      PENDING -> LOADING transition fires before any profile plugin is registered, so an
//      observer installed from a plugin never sees the plugin under test. Throwing there is
//      also unsafe — `_setEpoch` starts `_reload()` BEFORE calling `_updateState`, and
//      `_updateState` does not catch, so the throw escapes into an orphaned promise and the
//      process dies. Measured: the body ran and the boot crashed.
//
//   2. `internal/plugin` carries `fiber.entry.options.id` and `.name`, and refusing there does
//      dispose the child. It still fails on ordering: the governed plugin's body ran 151 ms
//      BEFORE any profile plugin's `apply()` was called, so a hook installed from a plugin
//      always arrives second. The loader's own observer also calls `_refresh()` after ours,
//      recomputing the epoch and discarding any sentinel.
//
//   3. Replacing `runtime.callback`. `_runner.execute` does dereference it at call time, but
//      for the same ordering reason the body has already run by then.
//
// What works is a **module load hook**, installed before the application imports anything. It
// refuses the import itself. Measured: the refused module's body never executes, the import
// raises, and the process carries on and can report why.
//
// SO THE WIRING IS A LAUNCH CONFIGURATION, NOT A PLUGIN. Node must start with this module as a
// bootstrap:  node --import <path>/install.js <entry> …
//
// The plugin entry (`index.js`) still loads and still reports ceilings and state. It cannot
// enforce, and it says so rather than implying coverage it does not have.
//
// WHAT THE DIGEST COVERS. For a governed id: the entry file's bytes, its release-relative path and
// its relative import closure (each closure file is checked again when Node loads it). For the
// AUKORA plugin set (plugin-set.mjs): every file under each recorded plugin's directory plus its
// relative closure, checked at import and once at rest when this installs. NOT bare specifiers
// (node_modules), not what the bootstrap imported before the hook existed, not anything fetched at
// run time.
//
// WHAT THIS IS NOT. Not confinement and not isolation: an allowed module shares this process
// and this uid and can do anything the host can. The boundary is ADMISSION — which declared
// modules may load. Removing the hook removes enforcement entirely, which is why
// STOCK_PLUGINS_NOT_YET_UNDER_POLICY is printed rather than assumed away.

import { appendFileSync, closeSync, existsSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { constants } from 'node:fs';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { registerHooks } from 'node:module';

import { artifactClosure, artifactDigest, asBytes, resolveModuleIdentity, verifyLoadedBytes } from './artifact.mjs';
import { SET_REFUSE, checkPluginSetRecord, pluginDirOf, verifySetApproval } from './plugin-set.mjs';

/**
 * **THE CLOSURE A PILOT RECORD MUST CARRY, OR A NAMED REFUSAL (AUMLOK-112).**
 *
 * MEASURED: `aukora-owner-admission-chain` reported `TypeError: Cannot convert undefined or null to object` from
 * `artifact.mjs:179`, because a pilot record without `files` reached the recomputation below and `Object.keys`
 * was handed `undefined`. **A launch that dies of a `TypeError` has refused nothing** — the caller gets a stack
 * trace rather than a code, no ceiling is printed beside it, and a court matching a NAMED refusal in that output
 * goes red for a reason that says nothing about what it was testing.
 *
 * **AND THE ABSENCE IS REFUSED RATHER THAN DEFAULTED**, because `files` is exactly what the runtime enforces —
 * the per-file digests `verifyLoadedBytes` checks. Defaulting to `{}` would bind the EMPTY closure and admit an
 * artifact whose bytes are then checked against nothing: **a silent admission, which is worse than the crash.**
 */
function requirePilotFiles(pilotArtifact) {
  const files = pilotArtifact?.files;
  if (files === null || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length === 0) {
    throw new Refusal(GRANT_REFUSE.GRANT_INVALID,
      `the pilot record for ${String(pilotArtifact?.id)} carries no closure: \`files\` is `
      + `${files === undefined ? 'absent' : JSON.stringify(files)}. The approval must bind the per-file digests the `
      + 'runtime enforces, and an empty closure would be admitted against nothing');
  }
  return files;
}
import { GRANT_REFUSE, admissionCeilingLine, readPinnedDaemonKey, verifyAdmissionGrant } from './admission-grant.mjs';
import { fileURLToPath } from 'node:url';

export const CEILINGS = [
  'BOOTSTRAP_UNGATED',
  'SAME_UID',
  'STOCK_PLUGINS_NOT_YET_UNDER_POLICY',
];

// The kind the ACCEPTED Python gate mints, read from scripts/composition/grant.py rather than
// typed from memory. It was typed from memory once — `aukora-grant/v1-genesis` — and the
// signature verified while the kind check refused, which is exactly the failure mode a
// second divergent literal produces: the policy looks right and rejects every honest grant.
// `grantKind` is configurable so a future rename is one value, not a search.
const GRANT_KIND = 'aukora-composition-grant/v1-genesis';
const SIGNED_FIELDS = ['coeffectEnvelopeDigest', 'expiry', 'governorPk', 'issuedAt',
                       'kind', 'nonce', 'operation', 'pluginDigest'];
const CLOSED_FIELDS = [...SIGNED_FIELDS, 'sig'];

// **aura-75 (2): THE TWO FIELDS THE LEGACY PATH NEVER HAD, AND THE REASON THEY ARE OPTIONAL.**
// *A grant must be able to say "these bytes, AT THIS PLACE, WITH THIS IMPORT CLOSURE"* -- and until
// now it could only say the first (GUARDIAN D3, acknowledged at :624-628 by whoever wrote the hook:
// **"the grant contract binds id + bytes + this-process envelope and cannot tell two same-byte paths
// apart"**).
//
// **OPTIONAL RATHER THAN REQUIRED, FOR THE SAME REASON AS THE PYTHON GATE**: adding them to
// `SIGNED_FIELDS` would refuse every grant minted before this change -- *a security fix must not be a
// flag day.*
//
// **AND SIGNED WHEN PRESENT, WHICH IS THE PART THAT MATTERS**: the signed body below is built from
// `SIGNED_FIELDS`, so **a recognised-but-unsigned optional field could be changed after minting
// without breaking the signature** -- *the hole the closed set exists to prevent.* `:235` folds these
// in when the grant carries them, so a grant that has a path has SIGNED that path.
const OPTIONAL_SIGNED_FIELDS = ['pluginPath', 'pluginClosure'];
const CLOSED_FIELDS_OPTIONAL = [...CLOSED_FIELDS, ...OPTIONAL_SIGNED_FIELDS];
const OPERATIONS = ['load', 'unload'];
const FORBIDDEN_FIELDS = ['owner', 'identity', 'did', 'ownerPk', 'ownerPublicKey', 'alg'];

export class Refusal extends Error {
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.code = code;
    this.reason = reason;
    this.name = 'CompositionRefusal';
  }
}

/** RFC 8785-style canonical JSON, integer-only, keys sorted. Matches the Python gate's JCS. */
export function canonicalize(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Refusal('GRANT_MALFORMED', `non-integer number in signed content: ${value}`);
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  throw new Refusal('GRANT_MALFORMED', `unserializable value in signed content: ${typeof value}`);
}

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// The coeffect this gate binds. Same record as scripts/composition/grant.py:
// {kind: "same-uid-envelope", uid}. Digest binding, not isolation — read SAME_UID.
export const COEFFECT_KIND = 'same-uid-envelope';

export function coeffectEnvelope(uid) {
  if (typeof uid === 'boolean' || typeof uid !== 'number' || !Number.isSafeInteger(uid)) {
    throw new Refusal('GRANT_MALFORMED', `coeffect uid must be an integer, got ${typeof uid}`);
  }
  return { kind: COEFFECT_KIND, uid };
}

export function coeffectDigest(uid) {
  return sha256Hex(Buffer.from(canonicalize(coeffectEnvelope(uid)), 'utf8'));
}

/** expiry and issuedAt share one rule: JSON integer, booleans excluded. */
function requireGrantInteger(grant, name) {
  const value = grant[name];
  if (typeof value === 'boolean' || typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Refusal('GRANT_MALFORMED',
      `${name} must be an integer, got ${value === null ? 'null' : typeof value}`);
  }
}

/** A raw 32-byte Ed25519 public key as a KeyObject, via the fixed SPKI prefix. */
function ed25519Key(hex) {
  return createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

const GOVERNOR_PK_HEX = /^[0-9a-f]{64}$/;

/**
 * THIS installation's configured governor root, validated on its own.
 *
 * A grant carries `governorPk` and can be internally consistent under that key.
 * That is not authority. Authority is the key configured here. The configured
 * value is therefore a prerequisite, not an optional comparison: missing, empty,
 * whitespace-only and malformed roots are refused by name before any grant is
 * consulted. A truthy guard (`if (configured && …)`) is the fail-open this
 * helper exists to close — `"".trim()` and `"   ".trim()` are both falsy, so
 * that form skips the authority check while the signature still verifies under
 * the grant-carried key, and every self-signed grant authorizes itself.
 */
export function requireConfiguredGovernorPk(raw) {
  if (raw === undefined || raw === null) {
    throw new Refusal('NO_GRANT',
      'configured governorPk is missing; this installation cannot decide whether a grant is authorized, and grants are authorized by the key configured here, never by the key they carry');
  }
  if (typeof raw !== 'string') {
    throw new Refusal('GRANT_MALFORMED',
      `configured governorPk is malformed; expected 64 lowercase hex characters, got ${typeof raw}`);
  }
  if (raw.length === 0) {
    throw new Refusal('NO_GRANT',
      'configured governorPk is empty; this installation cannot decide whether a grant is authorized, and grants are authorized by the key configured here, never by the key they carry');
  }
  if (raw.trim().length === 0) {
    throw new Refusal('NO_GRANT',
      'configured governorPk is whitespace; this installation cannot decide whether a grant is authorized, and grants are authorized by the key configured here, never by the key they carry');
  }
  const pk = raw.trim();
  if (!GOVERNOR_PK_HEX.test(pk)) {
    throw new Refusal('GRANT_MALFORMED',
      `configured governorPk is malformed; must be 64 lowercase hex characters (got ${pk.length} characters)`);
  }
  return pk;
}

/**
 * Verify a grant against THIS installation's governor key.
 *
 * Configured root first, independently of the grant: missing / empty / whitespace /
 * malformed refuse by name so an unusable installation key is never treated as "no
 * check". Then the grant. Signature first, authority second, and that order is
 * deliberate: the signature is checked against the key the grant itself carries, so
 * a self-inconsistent document is named as a signature failure; only then is that
 * key compared with the (already validated) configured authority. Collapsing the
 * two would make an edited grant and a forged one indistinguishable in the log.
 * The order was arrived at on the Python side by an arm that failed, and is reused
 * rather than re-derived — a second divergent policy implementation is exactly
 * what this must not become.
 */
export function verifyGrant(grant, expectations) {
  // `expectations.wantGrantKind` carries the configured kind; the module default is the
  // literal the accepted Python gate mints.
  //
  // Configured root is a prerequisite, not a field on the grant. Validating it
  // here — before structure, signature or comparison — is what keeps
  // `"".trim()` / `"   ".trim()` from skipping the authority check.
  const trusted = requireConfiguredGovernorPk(expectations?.governorPk);

  if (grant === null || typeof grant !== 'object' || Array.isArray(grant)) {
    throw new Refusal('GRANT_MALFORMED', 'grant must be a JSON object');
  }
  for (const forbidden of FORBIDDEN_FIELDS) {
    if (forbidden in grant) {
      throw new Refusal('GRANT_MALFORMED',
        `grant carries a forbidden \`${forbidden}\` field — identity never authorizes, and the kind is the algorithm binding`);
    }
  }
  const keys = Object.keys(grant).sort();
  // **THE CLOSED SET STILL REFUSES AN UNKNOWN FIELD BY NAME — the two D3 fields are RECOGNISED, not
  // tolerated.** *An unknown field remains a refusal, because field-ignoring is how a signed document
  // grows a meaning the signer never authorized.* This admits exactly two named fields, and the check
  // below requires them to be SIGNED, so recognition is not the same as tolerance.
  const required = [...CLOSED_FIELDS];
  const permitted = [...CLOSED_FIELDS_OPTIONAL];
  const optionalPresent = OPTIONAL_SIGNED_FIELDS.filter((f) => Object.hasOwn(grant, f));
  // **BOTH OR NEITHER.** A grant carrying a path but no closure reads as bound and is not; the Python
  // gate refuses that mint by name, and this side refuses the ADMISSION, so a hand-built half-bound
  // grant cannot slip through the verifier the mint refuses to produce.
  if (optionalPresent.length === 1) {
    throw new Refusal('GRANT_MALFORMED',
      `grant carries ${optionalPresent[0]} without the other of `
      + `[${OPTIONAL_SIGNED_FIELDS.join(', ')}] — a half-bound grant reads as bound and is not`);
  }
  const want = optionalPresent.length === 2 ? permitted : required;
  const wantSorted = [...want].sort();
  if (keys.length !== wantSorted.length || keys.some((k, i) => k !== wantSorted[i])) {
    throw new Refusal('GRANT_MALFORMED',
      `grant field set is closed: got [${keys.join(', ')}], expected [${wantSorted.join(', ')}]`);
  }
  const wantKind = expectations.wantGrantKind ?? GRANT_KIND;
  if (grant.kind !== wantKind) {
    throw new Refusal('GRANT_MALFORMED',
      `grant kind is ${grant.kind}, and this gate accepts ${wantKind}`);
  }
  if (!OPERATIONS.includes(grant.operation)) throw new Refusal('GRANT_MALFORMED', `operation ${grant.operation}`);
  for (const field of ['coeffectEnvelopeDigest', 'governorPk', 'nonce', 'pluginDigest']) {
    if (!/^[0-9a-f]{64}$/.test(String(grant[field]))) {
      throw new Refusal('GRANT_MALFORMED', `${field} must be 64 lowercase hex characters`);
    }
  }
  if (!/^[0-9a-f]{128}$/.test(String(grant.sig))) {
    throw new Refusal('GRANT_MALFORMED', 'sig must be 128 lowercase hex characters');
  }
  // ISSUEDAT_TYPE_PARITY: expiry and issuedAt share the integer rule (booleans excluded).
  for (const name of ['expiry', 'issuedAt']) {
    requireGrantInteger(grant, name);
  }

  const body = {};
  for (const field of SIGNED_FIELDS) body[field] = grant[field];
  // **D3: SIGNED WHEN PRESENT.** *An optional field left out of the signed body could be changed after
  // minting without breaking the signature* — so these are folded in here rather than merely permitted
  // by the closed check. **Admitted and unsigned would be worse than absent.**
  for (const field of OPTIONAL_SIGNED_FIELDS) {
    if (Object.hasOwn(grant, field)) body[field] = grant[field];
  }
  const message = Buffer.concat([
    Buffer.from(`${grant.kind}\n`, 'utf8'),
    Buffer.from(canonicalize(body), 'utf8'),
  ]);

  let signatureOk = false;
  try {
    signatureOk = cryptoVerify(null, message, ed25519Key(grant.governorPk), Buffer.from(grant.sig, 'hex'));
  } catch (err) {
    throw new Refusal('GRANT_MALFORMED', `grant signature could not be checked: ${err.message}`);
  }
  if (!signatureOk) {
    throw new Refusal('GRANT_MALFORMED',
      `signature does not verify under governorPk ${grant.governorPk.slice(0, 16)}… (the grant was edited, or signed by a different key)`);
  }
  if (grant.governorPk !== trusted) {
    throw new Refusal('GOVERNOR_UNTRUSTED',
      `grant is signed by governorPk ${grant.governorPk.slice(0, 16)}… but this installation's governor key is ${trusted.slice(0, 16)}… — a grant is authorized by the key configured here, never by the key it carries`);
  }
  // AN ABSENT EXPECTATION IS REFUSED, NOT SKIPPED. These two binds used to be guarded by
  // `if (expectations.operation && ...)` and `if (expectations.pluginDigest && ...)`, so a caller who
  // forgot one got a signed grant checked against NOTHING and returned as valid — the same fail-open
  // shape as the optional-root skip this file already carries a court for, one field over. A binding
  // that a missing value can switch off is not a binding, and the missing case here is provable: the
  // court's own arms called verifyGrant with no pluginDigest at all and relied on an earlier refusal
  // to hide it.
  if (expectations.operation === undefined || expectations.operation === null) {
    throw new Refusal('GRANT_EXPECTATION_MISSING',
      'verifyGrant was called without an operation expectation, so nothing binds this grant to the '
      + 'transition it is being used for — absence is refused rather than treated as "no expectation"');
  }
  if (grant.operation !== expectations.operation) {
    throw new Refusal('GRANT_OPERATION_MISMATCH',
      `grant is for operation '${grant.operation}', this transition is '${expectations.operation}'`);
  }
  if (expectations.pluginDigest === undefined || expectations.pluginDigest === null) {
    throw new Refusal('GRANT_EXPECTATION_MISSING',
      'verifyGrant was called without a pluginDigest expectation, so nothing binds this grant to the '
      + 'bytes presented — absence is refused rather than treated as "no expectation"');
  }
  if (grant.pluginDigest !== expectations.pluginDigest) {
    throw new Refusal('GRANT_BYTES_MISMATCH',
      `grant binds pluginDigest ${grant.pluginDigest.slice(0, 16)}… but the bytes presented hash to ${expectations.pluginDigest.slice(0, 16)}…`);
  }
  // **D3: THE PLACE AND THE IMPORTS, CHECKED AFTER THE BYTES.** The bytes are checked first, as they
  // always were, so a changed module is named as changed bytes; then the place, so a byte-identical copy
  // elsewhere is named as the wrong place; then the imports.
  //
  // **AN ABSENT BINDING IS REFUSED WHENEVER THE CALLER SUPPLIES ONE (D3 CLOSED, 2026-09-27).** These two
  // used to fire only when the GRANT carried the field, and the repository's own mint carried neither, so
  // the check never ran: a grant presented at another path with identical bytes was ADMITTED (measured,
  // declared-id arm 6). The load hook always supplies both now, so a grant that binds no place or no
  // closure is refused at load; `scripts/composition/__main__.py grant` mints both.
  if (expectations.pluginPath !== undefined && expectations.pluginPath !== null) {
    const grantedPath = grant.pluginPath;
    if (grantedPath === undefined) {
      throw new Refusal('GRANT_PATH_NOT_GRANTED',
        `grant binds no pluginPath, so it cannot say which file it admits; the module presented is at `
        + `${JSON.stringify(expectations.pluginPath)}. Mint it again with scripts/composition/__main__.py grant`);
    }
    if (grantedPath !== expectations.pluginPath) {
      throw new Refusal('GRANT_PATH_NOT_GRANTED',
        `grant binds pluginPath ${JSON.stringify(grantedPath)} but the module presented is at `
        + `${JSON.stringify(expectations.pluginPath)}`);
    }
  }
  if (expectations.pluginClosure !== undefined && expectations.pluginClosure !== null) {
    const grantedClosure = grant.pluginClosure;
    if (grantedClosure === undefined) {
      throw new Refusal('GRANT_CLOSURE_CHANGED',
        'grant binds no pluginClosure, so a changed import could not be seen; mint it again with '
        + 'scripts/composition/__main__.py grant');
    }
    if (grantedClosure !== expectations.pluginClosure) {
      throw new Refusal('GRANT_CLOSURE_CHANGED',
        `grant binds pluginClosure ${String(grantedClosure).slice(0, 16)}… but the imports presented `
        + `hash to ${String(expectations.pluginClosure).slice(0, 16)}…`);
    }
  }
  // COEFFECT_ENV_COMPARE: hex shape is not enough — the digest must match the
  // envelope derived for THIS process (or the fixture uid the caller supplied).
  const wantCoeffect = expectations.coeffectEnvelopeDigest;
  if (wantCoeffect !== undefined && wantCoeffect !== null) {
    if (grant.coeffectEnvelopeDigest !== wantCoeffect) {
      throw new Refusal('GRANT_MALFORMED',
        `grant binds coeffect envelope ${grant.coeffectEnvelopeDigest.slice(0, 16)}… but this `
        + `process's envelope hashes to ${String(wantCoeffect).slice(0, 16)}…`);
    }
  }
  if (grant.expiry < expectations.now) {
    throw new Refusal('GRANT_EXPIRED',
      `grant expired at ${grant.expiry} and the clock reads ${expectations.now}`);
  }
  return grant;
}

/**
 * Reserve a nonce in the store the Python issuer also uses, atomically.
 *
 * WHY THE GATE MUST WRITE THIS. It read `spent-nonces.json` and never wrote it; the nonce was
 * spent later, by the Python loader during the drain. So between two launches and the first
 * drain, ONE grant authorized TWO admissions — an unguarded window, and the replay arm passed
 * only because the drain happened to run first. One-use means one use, and the use is the
 * admission, not the later paperwork.
 *
 * The write is atomic and happens BEFORE the module is admitted: a temporary file is written and
 * then renamed over the store, which is the only way two concurrent admissions can be ordered
 * without both reading "not spent". The direction of failure is chosen: if the write fails, the
 * admission is refused rather than granted, so a crash between the two leaves a nonce consumed
 * and unused — never reused.
 */
function reserveNonce(path, nonce) {
  let spent = [];
  if (existsSync(path)) {
    try {
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      if (!doc || !Array.isArray(doc.spent)) {
        throw new Refusal('GRANT_MALFORMED', `nonce store ${path} has no \`spent\` list`);
      }
      spent = doc.spent;
    } catch (err) {
      if (err instanceof Refusal) throw err;
      throw new Refusal('GRANT_MALFORMED',
        `nonce store ${path} could not be read, so a replay cannot be ruled out: ${err.message}`);
    }
  }
  if (spent.includes(nonce)) {
    throw new Refusal('GRANT_SPENT',
      `nonce ${String(nonce).slice(0, 16)}… was already consumed — a grant is one use, and a replay is not a second authorization`);
  }
  // THE EXCLUSION MECHANISM, and it is NOT a read-then-write.
  //
  // An earlier version read the store, wrote a temp file and renamed it over the store. That is
  // atomic REPLACEMENT, which is not compare-and-set and not a lock: two processes can both read
  // "not spent", both write their own temp, both rename, and the later rename silently discards
  // the other's reservation. The store then contains one nonce while TWO admissions were
  // granted. Atomic replacement protects the reader from a torn file; it does not stop two
  // writers from both winning.
  //
  // The exclusion is a per-nonce claim file created with O_CREAT|O_EXCL, which the kernel
  // arbitrates: exactly one creator succeeds and every other attempt gets EEXIST. Claiming the
  // nonce IS creating that file, so the decision is the filesystem's, not ours.
  const claimPath = `${path}.claim.${nonce}`;
  let claimFd;
  try {
    claimFd = openSync(claimPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new Refusal('GRANT_SPENT',
        `nonce ${String(nonce).slice(0, 16)}… is already claimed by another admission (the claim `
        + `file ${claimPath} exists). A grant is one use, and a race is not a second authorization.`);
    }
    throw new Refusal('ADMISSION_UNRECORDED',
      `the nonce claim at ${claimPath} could not be created (${err.code ?? err.message}), so a `
      + 'replay could not be ruled out. The admission is REFUSED rather than granted: a '
      + 'transition whose once-only property cannot be established must not happen.');
  }
  try {
    writeFileSync(claimFd, `${JSON.stringify({ nonce, pid: process.pid, at: Date.now() })}\n`);
  } catch { /* the claim exists, which is what excludes; contents are for a human */ }
  closeSync(claimFd);

  // The human-readable store is written AFTER the claim, so it is a record of admitted
  // transitions and never the exclusion itself.
  const next = { spent: [...spent, nonce] };
  try {
    // The store is REPLACED, never truncated in place. `writeFileSync(path, …)` opens O_TRUNC
    // and then writes, so between those two steps the store is a truncated prefix of a valid
    // document — and a concurrent reader that lands in that window parses garbage, takes the
    // malformed branch above, and refuses a nonce that this call has already claimed. Measured:
    // GRANT_MALFORMED instead of GRANT_SPENT in 5 of 150 raced rounds, with the losing reader
    // observing an empty store (0 bytes) or a 92-byte prefix that parsed again a moment later.
    // A temp file plus rename is atomic for readers: they see the old document or the new one.
    const tempPath = `${path}.tmp.${process.pid}`;
    writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tempPath, path);
  } catch (err) {
    throw new Refusal('ADMISSION_UNRECORDED',
      `the nonce was claimed but the store at ${path} could not be updated (${err.message}). The `
      + 'claim stands, so the nonce stays consumed: the safe direction is a grant spent and '
      + 'unused, never a grant reused.');
  }
}

/** Read the spent set. A missing file is an empty set; an unreadable one is a refusal. */
function readSpent(path) {
  if (!existsSync(path)) return new Set();
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    if (!doc || !Array.isArray(doc.spent)) {
      throw new Refusal('GRANT_MALFORMED', `nonce store ${path} has no \`spent\` list`);
    }
    return new Set(doc.spent);
  } catch (err) {
    if (err instanceof Refusal) throw err;
    throw new Refusal('GRANT_MALFORMED', `nonce store ${path} could not be read: ${err.message}`);
  }
}

/**
 * Exposed for the concurrency test only.
 *
 * The race this guards against cannot be observed from outside the module — it is two processes
 * calling the same function at the same moment — so the test drives this exact function rather
 * than a copy of it. If the exclusion is removed, the test fails; that is the point.
 */
export function reserveForTest(storePath, nonce) {
  return reserveNonce(storePath, nonce);
}

/** The id a governed file is governed under: its basename without the extension. */
export function governedIdFor(filePath) {
  return basename(filePath).replace(/\.(mjs|js|cjs|ts)$/, '');
}

/**
 * THE AUKORA PLUGIN SET, INSTALLED BESIDE THE GOVERNED IDS (plugin-set.mjs).
 *
 * `pluginSetMode` is the launcher's verdict: `enforce` unless the launch was given `--allow-unapproved`,
 * which makes it `waived`. ENFORCE: the record must verify, and the owner's approval of exactly this
 * record must verify under the pinned approver, or this function THROWS and the process does not start;
 * then every file Node loads from a recorded plugin is checked against its recorded sha256, and a
 * mismatch or an unrecorded file is refused at import, naming the plugin. WAIVED: the same checks run,
 * each finding is printed as WAIVED, and the file loads. That is the escape hatch, and it says so.
 *
 * Returns null when no record is configured (a release materialized before the record existed).
 */
function installPluginSet(config, log, refusals) {
  if (config.pluginSetPath === undefined || config.pluginSetPath === null) return null;
  const mode = config.pluginSetMode;
  if (mode !== 'enforce' && mode !== 'waived') {
    throw new Refusal(SET_REFUSE.RECORD_MALFORMED, `pluginSetMode is ${JSON.stringify(mode)}; it must be enforce or waived`);
  }
  const readJson = (path, code, what) => {
    if (path === undefined || path === null || !existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch (err) {
      throw new Refusal(code, `${what} at ${path} is not JSON: ${err.message}`);
    }
  };
  const asRefusal = (err) => (err instanceof Refusal ? err
    : new Refusal(err.code ?? SET_REFUSE.RECORD_MALFORMED, err.reason ?? err.message));
  const record = readJson(config.pluginSetPath, SET_REFUSE.RECORD_MALFORMED, 'the plugin set record');
  if (record === null) {
    throw new Refusal(SET_REFUSE.RECORD_MALFORMED, `no plugin set record at ${config.pluginSetPath}`);
  }
  let checked;
  try { checked = checkPluginSetRecord(record); } catch (err) { throw asRefusal(err); }
  // THE BOUND POLICY NAMES THE SET (policy.json `pluginSet`, attested by the approved release record and
  // passed by the launcher). A record that governs a different set of plugins than the policy lists is
  // refused, so the boundary is the reviewed list and not whatever the record happens to hold.
  if (Array.isArray(config.pluginSetPolicy)) {
    const listed = [...config.pluginSetPolicy].sort().join(',');
    const recorded = Object.keys(checked.artifacts).sort().join(',');
    if (listed !== recorded) {
      const refusal = new Refusal(SET_REFUSE.RECORD_MALFORMED, `the record governs [${recorded}] and policy.json lists [${listed}]`);
      if (mode === 'enforce') { log(`REFUSE: ${refusal.code}: ${refusal.reason}`); throw refusal; }
      log(`WAIVED: ${refusal.code}: ${refusal.reason}`);
    }
  }
  const realRoot = realpathSync(resolve(config.pluginSetRoot ?? process.cwd()));
  const rootPrefix = `${realRoot}/`;
  const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32';

  let approval = null;
  if (mode === 'enforce') {
    try {
      approval = verifySetApproval({
        record,
        receipt: readJson(config.pluginSetApprovalPath, SET_REFUSE.APPROVAL_MALFORMED, 'the plugin set approval'),
        pin: readJson(config.pluginSetPinPath, SET_REFUSE.PIN_ABSENT, 'the pinned approver'),
      });
    } catch (err) {
      const refusal = asRefusal(err);
      log(`REFUSE: ${refusal.code}: ${refusal.reason}`);
      log('  NO AUKORA plugin can be admitted, so this process does not start.');
      throw refusal;
    }
  }

  // key -> { digest, owners }. A key two records disagree about is refused whenever it loads.
  const files = new Map();
  for (const artifact of Object.values(checked.artifacts)) {
    for (const [key, digest] of Object.entries(artifact.files)) {
      const seen = files.get(key);
      if (seen === undefined) files.set(key, { digest, owners: [artifact.id] });
      else {
        seen.owners.push(artifact.id);
        if (seen.digest !== digest) seen.digest = null;
      }
    }
  }
  const scopeDirs = new Map();
  for (const artifact of Object.values(checked.artifacts)) {
    for (const key of Object.keys(artifact.files)) {
      const dir = pluginDirOf(key);
      if (dir !== null && !scopeDirs.has(dir)) scopeDirs.set(dir, artifact.id);
    }
  }
  const outsidePlugins = new Set([...files.keys()].filter((key) => pluginDirOf(key) === null));
  // A plugin counts as ADMITTED when its own entry loads through the record; other files are checked loads.
  const entryOwners = new Map();
  const entryDirOwners = new Map();
  for (const artifact of Object.values(checked.artifacts)) {
    entryOwners.set(artifact.entry, [...(entryOwners.get(artifact.entry) ?? []), artifact.id]);
    const dir = pluginDirOf(artifact.entry);
    if (dir !== null) entryDirOwners.set(dir, [...(entryDirOwners.get(dir) ?? []), artifact.id]);
  }
  // WHOSE FILE IT IS: the plugin whose entry lives in the file's directory, else every plugin whose closure
  // reached it. MEASURED on the first tamper boot: taint by closure membership refused kira's unchanged files
  // because board's closure includes them, so one changed board byte kept kira out.
  const responsibleFor = (key) => {
    const dir = pluginDirOf(key);
    const byDir = dir === null ? undefined : entryDirOwners.get(dir);
    return byDir !== undefined && byDir.length > 0 ? byDir : (files.get(key)?.owners ?? []);
  };

  const finding = (code, reason, ids, file, atRest = false) => {
    const refusal = new Refusal(code, reason);
    if (mode === 'enforce') {
      refusals.push({ id: ids.join(','), file, code, reason });
      log(`REFUSE: ${code}: ${reason}`);
      log(atRest ? `  every file of '${ids.join(', ')}' will be refused at import.`
        : `  '${file}' was NOT loaded and its module body did not run.`);
      return refusal;
    }
    log(`WAIVED: ${code}: ${reason}`);
    log('  loaded anyway: this launch passed --allow-unapproved, so the plugin set is not enforced.');
    return null;
  };

  // ── AT REST, ONCE: every recorded file, including the ones Node never imports (client bundles, data).
  // A plugin with a changed or missing file is TAINTED, and every later load from it is refused.
  const started = Date.now();
  const tainted = new Map();
  for (const [key, { digest }] of files) {
    let got = null;
    try { got = sha256Hex(readFileSync(join(realRoot, key))); } catch { got = null; }
    if (got !== digest) {
      for (const id of responsibleFor(key)) if (!tainted.has(id)) tainted.set(id, { key, got });
    }
  }
  for (const [id, { key, got }] of tainted) {
    finding(SET_REFUSE.BYTES_CHANGED, `${id}: ${key} is ${got === null ? 'missing' : `${got.slice(0, 16)}…`} at rest `
      + `and the approved record carries ${String(files.get(key).digest).slice(0, 16)}…`, [id], key, true);
  }
  const admittedPlugins = new Set();
  let checkedLoads = 0;
  if (mode === 'enforce') {
    log(`PLUGIN SET: ${String(checked.count)} AUKORA plugins, ${String(files.size)} files, set `
      + `${checked.setDigest.slice(0, 16)}… admitted by approval ${approval.operationDigest.slice(0, 16)}… signed by `
      + `pinned ${approval.approverDid} (approval class ${approval.approvalClass}, key class ${approval.keyClass}: `
      + 'REPORTED, not signed)');
  } else {
    log(`PLUGIN SET WAIVED: ${String(checked.count)} AUKORA plugins, ${String(files.size)} files, set `
      + `${checked.setDigest.slice(0, 16)}… are checked and NOT enforced: this launch passed --allow-unapproved`);
  }
  log(`PLUGIN SET: at-rest sweep of ${String(files.size)} file(s) in ${String(Date.now() - started)} ms, `
    + `${String(tainted.size)} plugin(s) with changed bytes`);

  return {
    scopeLine: 'digest scope (AUKORA plugin set): every file under each recorded plugin directory and its relative '
      + 'closure, checked at import and once at rest; NOT node_modules, NOT files the bootstrap imported before the '
      + 'hook, NOT workers or child processes, NOT fs reads after boot',
    status: () => ({
      mode, setDigest: checked.setDigest, count: checked.count, files: files.size, ids: Object.keys(checked.artifacts).sort(),
      admitted: [...admittedPlugins].sort(), checkedLoads, tainted: [...tainted.keys()].sort(),
    }),
    /** The record key for a file Node is loading, or null when the set does not govern it. */
    keyFor(filePath) {
      if (!filePath.startsWith(rootPrefix)) return null;
      const rel = filePath.slice(rootPrefix.length);
      const relKey = caseInsensitive ? rel.toLowerCase() : rel;
      if (!relKey.startsWith('plugins/') && !outsidePlugins.has(relKey)) return null;
      let key;
      try { key = resolveModuleIdentity(filePath, realRoot).key; } catch { return null; }
      if (files.has(key)) return key;
      const dir = pluginDirOf(key);
      return dir !== null && scopeDirs.has(dir) ? key : null;
    },
    /** Null to admit, or the Refusal to throw. `next` is what `nextLoad` returned: the bytes that run. */
    admit(key, next) {
      checkedLoads += 1;
      const entry = files.get(key);
      const ids = entry === undefined ? (entryDirOwners.get(pluginDirOf(key)) ?? [scopeDirs.get(pluginDirOf(key))])
        : responsibleFor(key);
      if (entry === undefined) {
        return finding(SET_REFUSE.UNLISTED, `${ids.join(', ')}: ${key} is inside ${String(pluginDirOf(key))} and the `
          + 'approved record lists no such file', ids, key);
      }
      const bytes = asBytes(next.source, next.format);
      if (bytes === undefined) {
        return finding(SET_REFUSE.BYTES_CHANGED, `${ids.join(', ')}: ${key} is format ${String(next.format)} and its `
          + 'bytes cannot be inspected, so they cannot be checked', ids, key);
      }
      const got = sha256Hex(bytes);
      if (got !== entry.digest) {
        return finding(SET_REFUSE.BYTES_CHANGED, `${ids.join(', ')}: ${key} presented ${got.slice(0, 16)}… and the `
          + `approved record carries ${String(entry.digest).slice(0, 16)}…`, ids, key);
      }
      // THE BYTES OF THIS FILE ARE RIGHT, AND ITS PLUGIN IS STILL REFUSED WHEN ANOTHER OF ITS FILES CHANGED AT
      // REST: a plugin is admitted whole or not at all.
      const taint = ids.find((id) => tainted.has(id));
      if (taint !== undefined) {
        const at = tainted.get(taint);
        return finding(SET_REFUSE.BYTES_CHANGED, `${taint}: ${key} belongs to a plugin whose ${at.key} changed at rest`,
          ids, key);
      }
      for (const id of entryOwners.get(key) ?? []) {
        if (!admittedPlugins.has(id)) {
          admittedPlugins.add(id);
          log(`ADMIT: ${id} — ${key} matches its approved record (${String(admittedPlugins.size)}/${String(checked.count)})`);
        }
      }
      return null;
    },
  };
}

let installed = null;

/**
 * Install the admission hook and return a handle for inspection.
 *
 * Called once per process, from a node `--import` bootstrap. Installing it twice is refused
 * rather than allowed: two hooks would stack two admission decisions on one import, and a
 * layered policy is one nobody can reason about.
 */
export function installPolicy(config = {}) {
  // THE CEILINGS PRINT BEFORE ANYTHING CAN REFUSE. They used to be printed at the END, after the loader
  // hook was built, so the exit an operator is most likely to be staring at — a refused install — named no
  // limits at all. Measured before this change: a successful install printed 3 ceilings, a refused second
  // install printed 0 while throwing GRANT_MALFORMED. Class 4 of the AUKORA-37 review, in this organ.
  const log = config.log ?? ((line) => console.log(`[composition-gate] ${line}`));
  for (const ceiling of CEILINGS) log(`CEILING: ${ceiling}`);
  log('ATTENDANCE: reported-not-proven');
  if (installed) {
    throw new Refusal('GRANT_MALFORMED',
      'the composition gate policy is already installed in this process; installing it twice would stack two admission decisions on one import');
  }
  // ── THE PILOT ARTIFACT: ONE OPT-IN ARTIFACT, AND OFF UNLESS CONFIGURED ────────────────────────────
  // `pilotArtifact` is a RECORDED artifact (see artifact.mjs). When it is absent the load hook below
  // skips its block entirely, so a deployment that does not opt in behaves EXACTLY as it did before this
  // existed — which is what keeps the pre-existing gate arms honest rather than merely passing.
  //
  // `pilotScope` is a list of path fragments. It is the pilot's own boundary and it is deliberately
  // narrow: the recorded artifact's own files. A file inside the scope that the artifact does not claim
  // is refused as UNLISTED_FILE rather than falling through to the ungoverned path, because "in scope and
  // unrecorded" must not be quieter than "out of scope".
  const pilotArtifact = config.pilotArtifact ?? null;
  const pilotGrant = config.pilotGrant ?? null;
  // THE GRANT IS VERIFIED HERE, AT INSTALL, AND THE PIN COMES FROM THE INSTALL'S OWN PATH. A failure
  // raises before the hook exists, so a deployment whose grant does not verify has NO gate installed
  // rather than a gate admitting on an unverified claim. `readPinnedDaemonKey` refuses a missing pin by
  // its own name; it is never read from agent-writable state.
  // ── AND ONCE AN OWNER DAEMON IS INSTALLED, A GRANT IS REQUIRED ───────────────────────────────────
  // `requireGrant` IS THE CALLER'S VERDICT, NOT THIS MODULE'S GUESS: `ownerDaemonStatus()` is ASYNC and
  // `installPolicy` is synchronous, so whoever installs asks Aumlok's detector — the same source of
  // truth the bridge uses — and passes the answer in. A gate that probed for the daemon itself would be
  // a second detector, and two detectors disagree.
  //
  // WITHOUT IT THE PILOT IS ADMITTED ON ITS RECORDED DIGEST, which is the honest weaker state while no
  // daemon exists and is printed as such. WITH IT, a missing grant is a REFUSAL: an artifact digest says
  // what the bytes are and never who approved them, and once something exists that could have said so,
  // admitting anyway is the gate trusting itself in the daemon's absence of use.
  if (pilotArtifact !== null && pilotGrant === null && config.requireGrant === true) {
    throw new Refusal(GRANT_REFUSE.GRANT_REQUIRED,
      `an owner daemon is installed and no admission grant was presented for ${String(pilotArtifact.id)}. `
      + 'A recorded digest establishes what the bytes ARE, not who approved them, and with a daemon present '
      + 'the digest alone is the fallback this cut exists to remove');
  }
  const pilotAdmission = pilotGrant === null || pilotArtifact === null
    ? null
    : verifyAdmissionGrant({
      grant: pilotGrant,
      pinnedPubkeyPem: readPinnedDaemonKey(config.pilotDaemonKeyPath),
      // ── **RECOMPUTED FROM THE CLOSURE, NOT READ FROM THE RECORD (CODEX D1-r1)** ────────────────────
      //
      // MEASURED: this was `artifactDigest: pilotArtifact.digest` — **a field STORED in the record** — while
      // the runtime enforces `pilotArtifact.files`, the per-file digests, through `verifyLoadedBytes`.
      // **`digest` IS DERIVED FROM `files` (`artifact.mjs:196`) AND `artifact.mjs:172` SAYS SO IN CAPITALS:
      // "DERIVED, NEVER STORED. A digest stored beside the thing it covers is a digest that can be edited."**
      // It is stored anyway, and this check trusted the copy.
      //
      // **SO AN EDIT TO `digest` ALONE WOULD BE APPROVED HERE AND ENFORCED DIFFERENTLY AT RUNTIME** — the grant
      // would bind a summary that no longer describes the closure the gate actually checks. **RECOMPUTING IT
      // FROM `files` MAKES THE TWO THE SAME VALUE BY CONSTRUCTION**, which is the only version of this that
      // cannot drift.
      // **A MALFORMED RECORD MUST BE REFUSED BY NAME, NOT CRASHED INTO (AUMLOK-112).** MEASURED:
      // `aukora-owner-admission-chain` failed with `TypeError: Cannot convert undefined or null to object` at
      // `artifact.mjs:179` — `Object.keys(files)` — because a pilot record without `files` reached this line.
      // **A `TypeError` out of a launch is not a refusal:** the caller gets a stack trace instead of a code, no
      // ceiling is printed beside it, and every negative arm matching a NAMED refusal in that output goes red for
      // a reason that says nothing about the grant it was testing.
      //
      // **AND `files` IS THE RIGHT THING TO DEMAND**, because it is what the runtime enforces — the per-file
      // digests `verifyLoadedBytes` checks. A record carrying only `digest` is a record whose approval binds a
      // summary, which is the defect this recomputation exists to remove. **So the absence is REFUSED rather than
      // defaulted: a default would silently bind the EMPTY closure, which is worse than the crash** — it would
      // admit an artifact whose closure the gate then checks against nothing.
      artifactDigest: artifactDigest(requirePilotFiles(pilotArtifact)),
      release: config.pilotRelease ?? '',
    });
  const pilotRoot = pilotArtifact === null ? null : resolve(config.pilotRoot ?? process.cwd());
  const pilotScope = pilotArtifact === null ? [] : (config.pilotScope ?? []);
  const governed = new Set(config.governed ?? []);
  const governedFiles = (config.governedFiles ?? []).map((p) => resolve(p));
  const grantDir = config.grantDir ? resolve(config.grantDir) : null;
  const stateDir = config.stateDir ? resolve(config.stateDir) : null;
  const governorPkFile = config.governorPkFile ? resolve(config.governorPkFile)
    : join(stateDir ?? '.', 'governor.pk');

  const accepted = [];
  const refusals = [];

  // ── D3: THE ROOT A GRANT'S pluginPath IS RELATIVE TO ────────────────────────────────────────────
  // The launcher writes the release directory here. A grant names its module by `resolveModuleIdentity`
  // relative to this root (realpath, case-normalised, forward slashes), so the mint and this hook name a
  // file with one string, and a byte-identical copy anywhere else has a different name.
  const grantRoot = resolve(config.grantRoot ?? process.env.AUKORA_GATE_ROOT ?? process.cwd());
  // The files an admitted governed module's closure named, with the digests the grant approved. Each is
  // checked again when Node loads it, so an import swapped between admission and its own load is refused.
  const pinnedClosure = new Map();

  const pluginSet = installPluginSet(config, log, refusals);

  /** The whole policy for one candidate file: null to allow, or a Refusal. */
  /**
   * Decide the admission for one governed file.
   *
   * **`loadedBytes` IS THE SOURCE THE RUNTIME IS ABOUT TO EXECUTE, AND IT IS REQUIRED (CODEX D1-r1, THE TOCTOU).**
   *
   * MEASURED, DETERMINISTICALLY, WITH A PASSING CONTROL (`aukora-gate-bytes-bound`): this function used to read
   * the file itself and hash what it read, and the LOAD HOOK then called `nextLoad` — **a SECOND read** — and
   * executed that. **The two were forced to disagree by a hook that lets the gate run and then returns bytes of
   * its own: the module was ADMITTED, the swapped bytes RAN, and nothing refused.**
   *
   * **AN APPROVAL THAT BINDS BYTES OTHER THAN THE ONES EXECUTED IS ABOUT A DIFFERENT SUBJECT**, which is the same
   * shape as a grant verified under the key it carries. The pilot branch above already closed this —
   * *"THE HASH IS OF WHAT `nextLoad` RETURNS … the bytes checked and the bytes run are the same read"* — and this
   * brings the governed path to the same rule.
   *
   * **IT IS REQUIRED RATHER THAN OPTIONAL ON PURPOSE.** A default of "read it yourself if not given" would leave
   * the defect reachable by any caller that forgot, and the fail-open shape this file already refuses elsewhere.
   */
  function decide(filePath, loadedBytes) {
    const id = governedIdFor(filePath);
    try {
      if (process.env.AUKORA_MEDIATOR && ['0', 'off', 'false', 'no', 'disabled']
          .includes(String(process.env.AUKORA_MEDIATOR).toLowerCase())) {
        throw new Refusal('MEDIATOR_OFF',
          'mediator is off — no new governed effects (set AUKORA_MEDIATOR to something other than 0/off/false/no/disabled to turn it on)');
      }
      // **THE BYTES THE RUNTIME WILL RUN, NOT A SECOND READ OF THE FILE.** `loadedBytes` comes from the one
      // `nextLoad` call whose result is returned from the hook, so there is exactly one read in this path.
      let bytes;
      if (loadedBytes !== undefined && loadedBytes !== null) {
        bytes = typeof loadedBytes === 'string' ? Buffer.from(loadedBytes, 'utf8') : Buffer.from(loadedBytes);
      } else {
        // **NO FALLBACK.** Reaching here means a caller that did not say what it is about to execute, and reading
        // the file instead would silently reinstate the defect for that caller. It refuses by name.
        throw new Refusal('NO_GRANT',
          `governed file ${filePath} was admitted without the bytes that will be executed; the approval must bind `
          + 'the source the runtime runs, and a checker that reads the file again can approve one set of bytes '
          + 'while another is executed (CODEX D1-r1, the TOCTOU)');
      }
      const digest = sha256Hex(bytes);

      // Configured root independently, BEFORE any grant is read. A missing file
      // was already refused; an empty or whitespace file used to trim to '' and
      // skip the authority comparison inside verifyGrant (fail-open).
      if (!existsSync(governorPkFile)) {
        throw new Refusal('NO_GRANT',
          `no configured governor key at ${governorPkFile}; this installation cannot decide whether a grant is authorized, and grants are authorized by the configured key rather than by the key they carry`);
      }
      let configuredPk;
      try {
        configuredPk = requireConfiguredGovernorPk(readFileSync(governorPkFile, 'utf8'));
      } catch (err) {
        if (err instanceof Refusal) throw err;
        throw new Refusal('NO_GRANT',
          `configured governor key at ${governorPkFile} could not be read: ${err.message}`);
      }

      const grantPath = join(grantDir ?? join(stateDir ?? '.', 'grants'), `${id}.json`);
      if (!existsSync(grantPath)) {
        throw new Refusal('NO_GRANT',
          `no grant presented for load of '${id}'; a composition transition requires a one-use grant naming the operation and the exact bytes (looked in ${grantPath})`);
      }
      let grant;
      try {
        grant = JSON.parse(readFileSync(grantPath, 'utf8'));
      } catch (err) {
        throw new Refusal('GRANT_MALFORMED', `grant at ${grantPath} is not admissible JSON: ${err.message}`);
      }
      // **D3: THE PLACE AND THE CLOSURE, COMPUTED HERE FROM THE BYTES THAT WILL RUN.** A module with no
      // canonical place under the grant root, or whose imports cannot be resolved, is refused by name: a
      // grant cannot be checked against a place or a closure nobody can state.
      let pluginPath;
      let closure;
      try {
        pluginPath = resolveModuleIdentity(filePath, grantRoot).key;
        closure = artifactClosure(filePath, grantRoot, { entrySource: bytes });
      } catch (err) {
        throw new Refusal('GRANT_PATH_NOT_GRANTED',
          `${filePath} has no checkable place and closure under the grant root ${grantRoot}: ${err.message}`);
      }
      const pluginClosure = artifactDigest(closure);
      verifyGrant(grant, {
        governorPk: configuredPk,
        operation: 'load',
        pluginDigest: digest,
        // **D3: THE PATH AND THE CLOSURE, AT THE LIVE LOAD HOOK.**
        //
        // *Without these two the entry digest was the whole binding*, so **a grant minted for one plugin's bytes would
        // admit a DIFFERENT PATH carrying those same bytes** — *the same file copied, renamed, or dropped into another
        // plugin's directory, and the gate would compare an identical digest and admit it.*
        //
        // **THE PATH IS SUPPLIED HERE BECAUSE THIS HOOK KNOWS IT** — `filePath` is the module the runtime is about to
        // execute, so the comparison is against the file actually presented rather than one named in the grant.
        pluginPath,
        // **THE CLOSURE IS SUPPLIED BY THE CALLER, WHICH IS THE ONLY THING THAT CAN WALK IMPORTS.** *The gate stays a
        // comparator* — and an absent closure is NOT defaulted here: `verifyGrant` fires these two only when the
        // expectation is present, so passing nothing would silently restore the entry-digest-only binding this item
        // exists to close.
        pluginClosure,
        wantGrantKind: config.wantGrantKind,
        now: Math.floor(Date.now() / 1000),
        // LIVE_COEFFECT_ENV: compare the grant to the envelope derived here, not only its hex shape.
        coeffectEnvelopeDigest: coeffectDigest(process.getuid()),
      });

      const admission = {
        id, file: filePath, digest, nonce: grant.nonce, pluginPath, pluginClosure,
        admittedAt: Math.floor(Date.now() / 1000),
        operation: 'load',
        receipt: 'PENDING_SERIALIZATION',
      };

      // ORDER: reserve the nonce, then record the admission, then accept. Both steps are
      // durable and both REFUSE on failure, because a governed transition whose once-only
      // property or whose record cannot be written must not happen. Previously a ledger write
      // failure was warned about and ACCEPT still printed, which reported a transition that
      // the system had no durable evidence for.
      if (!stateDir) {
        throw new Refusal('ADMISSION_UNRECORDED',
          'no state directory is configured, so this admission has nowhere durable to be '
          + 'recorded and no nonce store to reserve against. Refusing rather than admitting a '
          + 'transition that cannot be recorded.');
      }
      reserveNonce(join(stateDir, 'spent-nonces.json'), grant.nonce);
      try {
        appendFileSync(join(stateDir, 'admissions.jsonl'), `${JSON.stringify(admission)}\n`);
      } catch (err) {
        throw new Refusal('ADMISSION_UNRECORDED',
          `the nonce was reserved but the admission could not be recorded in `
          + `${join(stateDir, 'admissions.jsonl')} (${err.message}). The nonce stays consumed: `
          + 'the safe direction is a grant spent and unused, never a grant reused.');
      }
      accepted.push(admission);
      for (const [key, fileDigest] of Object.entries(closure)) {
        if (key !== pluginPath) pinnedClosure.set(key, { digest: fileDigest, by: id });
      }
      log(`ACCEPT: '${id}' authorized for load at ${pluginPath}, entry digest ${digest.slice(0, 16)}…, `
        + `closure ${pluginClosure.slice(0, 16)}… (${String(Object.keys(closure).length)} file(s))`);
      log('  receipt: PENDING_SERIALIZATION — the admission is recorded in the ledger; the');
      log('  receipt is issued by scripts/composition/serialize-admissions.py, keeping one');
      log('  issuer and one wire format rather than a second one invented to integrate.');
      return null;
    } catch (err) {
      if (err instanceof Refusal) {
        refusals.push({ id, file: filePath, code: err.code, reason: err.reason });
        log(`REFUSE: ${err.code}: ${err.reason}`);
        log(`  '${id}' was NOT loaded and its module body did not run.`);
        return err;
      }
      throw err;
    }
  }

  registerHooks({
    load(url, context, nextLoad) {
      // ── THE PILOT, AND IT IS OPT-IN FOR ONE ARTIFACT ────────────────────────────────────────────
      // THIS RUNS BEFORE ANYTHING ELSE AND RETURNS OR FALLS THROUGH. A file inside the pilot's scope is
      // verified against the recorded artifact and never reaches the governed-id path below; a file
      // outside it skips this block entirely, so nothing about the existing admission changes for the
      // stock set. That is why the arms that were green before are still green: this cannot run for them.
      //
      // THE HASH IS OF WHAT `nextLoad` RETURNS, which is why the call is here rather than in a helper
      // that reads the file again. The bytes checked and the bytes run are the same read.
      if (pilotArtifact !== null && url.startsWith('file://')) {
        let pilotPath;
        try { pilotPath = fileURLToPath(url); } catch { pilotPath = null; }
        if (pilotPath !== null && pilotScope.some(prefix => pilotPath.includes(prefix))) {
          const next = nextLoad(url, context);
          verifyLoadedBytes({
            source: next.source, format: next.format, url, artifact: pilotArtifact, root: pilotRoot,
          });
          return next;
        }
      }
      if (!url.startsWith('file://')) return nextLoad(url, context);
      let filePath;
      try { filePath = fileURLToPath(url); } catch { return nextLoad(url, context); }
      // A file is governed if EITHER binding names it. This was a ternary that consulted the id
      // set only when NO path was mapped, and launch-dsh.py maps at least one path in every
      // materialized release, so the ternary always took the path branch and a declared id with
      // no mapped path fell through UNGOVERNED: imported, body run, no admission, no refusal, no
      // receipt. Measured at 762d36b with two declared ids and one mapped path.
      //
      // A union, not a choice between the two clauses. The path clause keeps exact-path byte
      // binding for mapped entries, so a substitute file cannot inherit their standing by name.
      // The id clause means a declaration is always honoured, so an unmapped declared id is
      // EVALUATED AND REFUSED rather than silently admitted.
      //
      // Matching by id alone still requires a grant binding the bytes actually presented, so a
      // same-named file with DIFFERENT bytes is refused (GRANT_BYTES_MISMATCH), and — since D3 was
      // closed — the grant must also name this file's release-relative path and its import closure,
      // so a byte-IDENTICAL copy under the same id at another path is refused
      // (GRANT_PATH_NOT_GRANTED). Until 2026-09-27 that copy was ADMITTED: the grant check was never
      // given a path the grant had to carry.
      const governedByPath = governedFiles.includes(filePath);
      const governedById = governed.has(governedIdFor(filePath));
      const setKey = pluginSet === null ? null : pluginSet.keyFor(filePath);
      let pinnedKey = null;
      if (pinnedClosure.size > 0) {
        try { pinnedKey = resolveModuleIdentity(filePath, grantRoot).key; } catch { pinnedKey = null; }
        if (pinnedKey !== null && !pinnedClosure.has(pinnedKey)) pinnedKey = null;
      }
      if (!governedByPath && !governedById && setKey === null && pinnedKey === null) return nextLoad(url, context);
      // ── ONE READ, AND IT IS THE ONE THAT RUNS (CODEX D1-r1) ─────────────────────────────────────────
      //
      // `nextLoad` IS CALLED FIRST, exactly as the pilot branch above does, and its result is BOTH what is
      // hashed and what is returned. **THE BYTES CHECKED AND THE BYTES RUN ARE THE SAME READ.** Calling
      // `decide` first and `nextLoad` after — which this did — is two reads with a gap between them, and a file
      // replaced in that gap was approved at its old content and executed at its new one.
      const next = nextLoad(url, context);
      // THE PLUGIN SET FIRST: a file inside a recorded AUKORA plugin is checked against the approved record.
      if (setKey !== null) {
        const refusal = pluginSet.admit(setKey, next);
        if (refusal) throw refusal;
      }
      // AN IMPORT AN ADMITTED GOVERNED MODULE'S GRANT NAMED: the bytes must still be the approved ones.
      if (pinnedKey !== null) {
        const pinned = pinnedClosure.get(pinnedKey);
        const bytes = asBytes(next.source, next.format);
        const got = bytes === undefined ? null : sha256Hex(bytes);
        if (got !== pinned.digest) {
          const refusal = new Refusal('GRANT_CLOSURE_CHANGED',
            `${pinnedKey} is in the closure the grant for '${pinned.by}' approved, and it presented `
            + `${got === null ? 'no inspectable source' : `${got.slice(0, 16)}…`} instead of ${pinned.digest.slice(0, 16)}…`);
          refusals.push({ id: pinned.by, file: filePath, code: refusal.code, reason: refusal.reason });
          log(`REFUSE: ${refusal.code}: ${refusal.reason}`);
          throw refusal;
        }
      }
      if (governedByPath || governedById) {
        const refusal = decide(filePath, next.source);
        // A synchronous throw from `load` refuses the import: the body never runs, and the error
        // surfaces to whoever imported the file, so a refusal is loud rather than silent.
        if (refusal) throw refusal;
      }
      return next;
    },
  });

  if (!governed.size && !governedFiles.length && pluginSet === null) {
    log('NOTE: nothing is declared governed, so this gate refuses nothing. An enforcement test');
    log('      that passes against this configuration is measuring nothing.');
  } else {
    log(`governed: ${[...governed, ...governedFiles].join(', ')}`);
  }
  if (pilotArtifact !== null) {
    // THE PILOT NAMES ITSELF AND ITS OWN CEILING, beside the stock ceiling rather than instead of it.
    //
    // AND THE CEILING IS CHOSEN BY WHAT ACTUALLY HAPPENED. With a verified grant it says so and names
    // the authority; with none it says the slot is unimplemented rather than printing a weaker version
    // of a claim nobody made. A gate that always printed the stronger line would be reporting an
    // approval it never checked.
    if (pilotGrant === null) {
      log(`PILOT: ${String(pilotArtifact.id)} admitted by artifact digest; `
        + 'approval slot unimplemented (U1)');
    } else {
      log(admissionCeilingLine(pilotArtifact, pilotAdmission.authority));
    }
  }
  log('module load hook installed — governed files are refused at import, before their body runs');
  log('digest scope (governed ids): the entry bytes, its release-relative path and its relative import closure; '
    + 'NOT bare specifiers (node_modules)');
  if (pluginSet !== null) log(pluginSet.scopeLine);

  installed = {
    ceilings: [...CEILINGS],
    governed: [...governed, ...governedFiles],
    accepted,
    refusals,
    digestCovers: pluginSet === null
      ? 'governed ids: entry bytes, release-relative path and relative import closure; not node_modules'
      : pluginSet.scopeLine,
    pluginSet: pluginSet === null ? null : pluginSet.status,
    status: () => ({ accepted, refusals, governed: [...governed, ...governedFiles],
      pluginSet: pluginSet === null ? null : pluginSet.status() }),
  };
  return installed;
}

/** The installed handle, or null. For inspection surfaces that must not install anything. */
export function policyHandle() {
  return installed;
}
