// AUKORA ONE · authority/secure-custody.mjs — RING 1
//
// Where the owner's private halves live: the macOS Keychain, never a file in
// this tree, and never this repository's business to read.
//
// PROVENANCE: ADAPTED from AUKORA-EVOLUTION 🧬 @ 68210d479a35e325eda4e14ac8fba5dc87db979e,
// `apps/seed/src/secureCustody.ts`, blob sha256
// b7223d7bfe8e7a23af18a665f2cfea804798324022bd96aab30ced30f7e951f6.
// See PROVENANCE.md for the full row and the enumerated adaptations.
//
// ══ THE ADAPTATION THAT MATTERS: A POSITIVE ALLOWLIST, NOT A BLOCKLIST ══
//
// The donor pins its service namespace to `aukora-evolution:aumlok-owner-v1` and
// fences ONE neighbouring namespace by prefix (`aukora:`, the legacy AK3 lane).
// Carried unchanged into Aukora One, the default would address the LIVE Evolution
// node's owner item — the same hazard as the state directory, one layer down, and
// `security(1)` operates per exact service+account pair, so a matching service
// name is all it takes.
//
// Rather than extend the donor's blocklist with `aukora-evolution:` (and then
// `aukora-symbiote:`, and then whatever is built next — a list that is wrong the
// moment someone adds a node), this module inverts the check:
//
//     A custody service MUST begin with `aukora-one:`. Everything else refuses.
//
// That is a positive allowlist and it fails closed. It subsumes every neighbouring
// namespace that exists today and every one that does not exist yet, which a
// blocklist cannot do. THREAT_MODEL.md and `law/ring0-fence.mjs` both record why
// this repository distrusts blocklists as boundaries; this is that principle
// applied where it belongs.
//
// `KNOWN_NEIGHBOUR_NAMESPACES` below is documentation for the test suite, NOT an
// input to the fence. The fence never consults it. The test uses it to prove the
// allowlist actually refuses each real neighbour, so the property is demonstrated
// against named cases rather than asserted in prose.
//
// ══ WHAT THIS MODULE DOES NOT DO ══
//
// It never generates a key, never signs, and is never invoked by anything in this
// repository today — nothing here has a reason to read a private half, because
// there is no signer (#27). It is transplanted now so that the custody NAMESPACE
// is fixed before any ceremony code arrives to use it. Establishing the fence
// ahead of the hazard is the whole point of the ordering.

import { execFileSync } from 'node:child_process';

/**
 * THE fence: every Aukora One custody service begins with this.
 *
 * Positive allowlist. A disposable test service (`aukora-one:test-…`) passes; a
 * sibling node's namespace cannot be spelled at all.
 */
export const CUSTODY_NAMESPACE_PREFIX = 'aukora-one:';

/** The default owner service for this node. */
export const AUMLOK_KEYCHAIN_SERVICE = `${CUSTODY_NAMESPACE_PREFIX}aumlok-owner-v1`;

/**
 * Real custody namespaces belonging to OTHER nodes on this machine.
 *
 * DOCUMENTATION AND TEST FIXTURE ONLY — `assertOwnCustodyNamespace` does not read
 * this array. It is here so `test/authority-custody.test.mjs` can prove the
 * allowlist refuses each one by name, and so the next reader knows what was at
 * stake. Adding an entry does not strengthen the fence; the fence is already
 * total.
 */
export const KNOWN_NEIGHBOUR_NAMESPACES = Object.freeze([
  'aukora:',                  // legacy AK3 / Aukora credential lane
  'aukora-evolution:',        // the LIVE Evolution node — the P0 this fence exists for
  'aukora-symbiote:',         // the Symbiote node
]);

/** Refusal reason classes. Namespaced — disjoint from the gate's closed `refused-*` set. */
export const CUSTODY_REASON_CLASSES = Object.freeze([
  'custody:ok',
  'custody:backend-unavailable',
  'custody:not-found',
  'custody:store-failed',
  'custody:read-failed',
  'custody:already-present',
  'custody:account-invalid',
  'custody:secret-invalid',
  'custody:isolation-half-set',
]);

/**
 * Refuse any service outside this node's own namespace.
 *
 * Throws rather than returning a verdict: this is a configuration point, and a
 * caller that ignored a returned `false` would proceed to address another node's
 * custody. The offending value is never echoed — a refusal message is not a place
 * to print a namespace someone was probing for.
 */
export function assertOwnCustodyNamespace(service) {
  if (typeof service !== 'string' || service.length === 0) {
    throw new Error('aumlok_custody_service_invalid');
  }
  if (!service.startsWith(CUSTODY_NAMESPACE_PREFIX)) {
    throw new Error('aumlok_custody_service_foreign_refused');
  }
}

/** `security(1)` at its trusted absolute path — never resolved through an attacker-influenced PATH. */
const SECURITY_BIN = '/usr/bin/security';

/** Account names are our own identifiers, so they can afford to be strict. */
const ACCOUNT_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function accountValid(account) {
  return typeof account === 'string' && ACCOUNT_RE.test(account);
}

/**
 * A secret must be a non-empty single-line string.
 *
 * The single-line rule is load-bearing, not cosmetic: `security` reads the value
 * from stdin up to a newline, so a secret containing a newline would be silently
 * TRUNCATED on write and read back short. Refusing turns a silent corruption into
 * a refusal.
 */
function secretValid(secret) {
  return typeof secret === 'string' && secret.length > 0 && secret.length <= 8192 && !/[\r\n\0]/.test(secret);
}

/**
 * Custody in the login Keychain. Every invocation pins the absolute tool path and
 * passes arguments as an ARRAY (never a shell string), so no account name can
 * inject a flag or a command.
 */
export function macosKeychainCustody(service = AUMLOK_KEYCHAIN_SERVICE) {
  // The fence, before any `security` invocation exists to run.
  assertOwnCustodyNamespace(service);

  const run = (args, input) => {
    try {
      const stdout = execFileSync(SECURITY_BIN, [...args], {
        encoding: 'utf8',
        input,
        // stderr is DISCARDED, never captured: `security` echoes prompt text and
        // item descriptions there, and capturing it would create a surface where
        // a value could reach a log.
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 10_000,
      });
      return { code: 0, stdout };
    } catch {
      // Total: non-zero exit, missing binary, and timeout are all one thing here —
      // "did not succeed". The thrown object carries stdout/stderr, so it is never
      // inspected, never re-thrown, never logged.
      return { code: 1, stdout: '' };
    }
  };

  return {
    kind: 'macos-keychain',
    service,

    available() {
      if (process.platform !== 'darwin') return false;
      return run(['list-keychains', '-d', 'user']).code === 0;
    },

    has(account) {
      if (!accountValid(account)) return false;
      // `find-generic-password` WITHOUT `-w` reports presence without emitting the secret.
      return run(['find-generic-password', '-s', service, '-a', account]).code === 0;
    },

    write(account, secret, replace) {
      if (!accountValid(account)) return { ok: false, reasonClass: 'custody:account-invalid' };
      if (!secretValid(secret)) return { ok: false, reasonClass: 'custody:secret-invalid' };
      if (!this.available()) return { ok: false, reasonClass: 'custody:backend-unavailable' };
      if (!replace && this.has(account)) return { ok: false, reasonClass: 'custody:already-present' };
      // THE HARDENED PATH: `-w` with no value makes `security` prompt for the
      // password and then a confirmation, both read from stdin. Feeding the value
      // twice satisfies both prompts and keeps every owner byte out of argv.
      const res = run(['add-generic-password', '-U', '-s', service, '-a', account, '-w'], `${secret}\n${secret}\n`);
      return res.code === 0 ? { ok: true, value: null } : { ok: false, reasonClass: 'custody:store-failed' };
    },

    read(account) {
      if (!accountValid(account)) return { ok: false, reasonClass: 'custody:account-invalid' };
      if (!this.available()) return { ok: false, reasonClass: 'custody:backend-unavailable' };
      const res = run(['find-generic-password', '-s', service, '-a', account, '-w']);
      if (res.code !== 0) return { ok: false, reasonClass: 'custody:not-found' };
      const value = res.stdout.replace(/\n$/, '');
      return value.length > 0 ? { ok: true, value } : { ok: false, reasonClass: 'custody:read-failed' };
    },

    remove(account) {
      if (!accountValid(account)) return { ok: false, reasonClass: 'custody:account-invalid' };
      const res = run(['delete-generic-password', '-s', service, '-a', account]);
      return res.code === 0 ? { ok: true, value: null } : { ok: false, reasonClass: 'custody:not-found' };
    },
  };
}

/**
 * Isolated temporary custody for tests. Touches no disk, no Keychain, and no
 * environment: the bytes live in one closure and vanish with the process.
 *
 * NEVER selected implicitly — `resolveSecureCustody` requires an explicit opt-in
 * literal.
 */
export function ephemeralMemoryCustody() {
  const items = new Map();
  return {
    kind: 'memory-ephemeral',
    service: null,
    available() { return true; },
    has(account) { return accountValid(account) && items.has(account); },
    write(account, secret, replace) {
      if (!accountValid(account)) return { ok: false, reasonClass: 'custody:account-invalid' };
      if (!secretValid(secret)) return { ok: false, reasonClass: 'custody:secret-invalid' };
      if (!replace && items.has(account)) return { ok: false, reasonClass: 'custody:already-present' };
      items.set(account, secret);
      return { ok: true, value: null };
    },
    read(account) {
      if (!accountValid(account)) return { ok: false, reasonClass: 'custody:account-invalid' };
      const v = items.get(account);
      return v === undefined ? { ok: false, reasonClass: 'custody:not-found' } : { ok: true, value: v };
    },
    remove(account) {
      if (!accountValid(account)) return { ok: false, reasonClass: 'custody:account-invalid' };
      return items.delete(account) ? { ok: true, value: null } : { ok: false, reasonClass: 'custody:not-found' };
    },
  };
}

/** The env var a test (or a deliberate local experiment) sets to choose ephemeral custody. */
export const CUSTODY_BACKEND_ENV = 'AUKORA_AUMLOK_CUSTODY_BACKEND';
/** The ONE literal that selects ephemeral custody. Anything else — including empty — resolves secure. */
export const EPHEMERAL_OPT_IN = 'memory-ephemeral';
/** An optional disposable service name, so a gated smoke test never occupies the owner's account. */
export const CUSTODY_SERVICE_ENV = 'AUKORA_AUMLOK_CUSTODY_SERVICE';

/**
 * The state-home variable this module must stay paired with.
 *
 * Duplicated as a literal on purpose: custody resolution takes no module
 * dependency on the state store, and `owner-custody.mjs` stays the single public
 * owner of the name. Carried from the donor's R12 repair, retargeted to this
 * node's variable.
 */
const AUKORA_ONE_HOME_ENV = 'AUKORA_ONE_HOME';

/**
 * Resolve the custody backend from the environment. Pure over its `env` argument
 * (the probe is the only I/O), so every branch is testable without a process boot.
 *
 * Order matters and is the whole point:
 *   1. the EXPLICIT literal opt-in selects ephemeral custody — a deliberate act;
 *   2. otherwise the secure store is probed;
 *   3. an unreachable secure store REFUSES. There is no third branch, so there is
 *      no path on which a private key silently lands in a plaintext file.
 *
 * ── THE TWO-NAMESPACE LAW (carried from the donor's R12 repair) ──
 *
 * `AUKORA_ONE_HOME` isolates only the STATE DIRECTORY. A reviewer who set just
 * that variable would believe they were sandboxed while the Keychain service
 * stayed at the real owner item — so an "isolated" ceremony would write a REAL
 * owner record. Isolation must be all-or-nothing:
 *
 *   both set  -> isolated run, permitted
 *   neither   -> the normal owner run, permitted
 *   ONE set   -> REFUSE. A half-isolated run is dangerous precisely because it
 *                looks safe.
 */
export function resolveSecureCustody(
  env = process.env,
  makeSecure = macosKeychainCustody,
  makeEphemeral = ephemeralMemoryCustody,
) {
  if (env[CUSTODY_BACKEND_ENV] === EPHEMERAL_OPT_IN) {
    return { mode: 'ephemeral', backend: makeEphemeral() };
  }

  const homeOverridden = typeof env[AUKORA_ONE_HOME_ENV] === 'string' && env[AUKORA_ONE_HOME_ENV] !== '';
  const serviceOverridden = typeof env[CUSTODY_SERVICE_ENV] === 'string' && env[CUSTODY_SERVICE_ENV] !== '';
  if (homeOverridden !== serviceOverridden) {
    return { mode: 'refused', reasonClass: 'custody:isolation-half-set' };
  }

  const service = env[CUSTODY_SERVICE_ENV] ?? AUMLOK_KEYCHAIN_SERVICE;
  const backend = makeSecure(service);
  if (!backend.available()) return { mode: 'refused', reasonClass: 'custody:backend-unavailable' };
  return { mode: 'secure', backend };
}

/** HARD: holding custody is not permission. Constant, by construction. */
export function secureCustodyGrantsAuthority() {
  return false;
}
