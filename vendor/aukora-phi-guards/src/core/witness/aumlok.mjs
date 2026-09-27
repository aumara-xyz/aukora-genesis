// aukora · core/witness/aumlok.mjs — custody
//
// ══ WHAT A SIGNATURE HERE DOES AND DOES NOT MEAN ══
//
// A hash chain proves INTERNAL CONSISTENCY and nothing else. Anyone who can
// append to the file can also rewrite the whole file, recompute every hash, and
// hand you a perfectly intact chain that says whatever they want. Tamper-
// evidence from hashes alone only bites against a verifier who already holds an
// earlier head out of band — which, for a stranger reading your repo, is nobody.
//
// A key held OUTSIDE the repository is what turns "consistent" into
// "attributable". That is the whole job of this module.
//
// **It grants nothing.** Aumlok here is a verifiable echo of the owner's key,
// not an authorization system. No receipt is more permitted for being signed;
// a signature says *this record came from this custody and has not been edited
// since*, and it says nothing else. `aumlokGrantsAuthority` is `false`,
// declared in the law and printed by `verify`, so the claim cannot quietly
// inflate without someone editing a line that says it out loud.
//
// ══ TWO TIERS, BECAUSE THE GUARD CANNOT ASK FOR A PHRASE ══
//
// The guard runs on every tool call, unattended, in a subprocess with no
// terminal. It cannot prompt for seven words. So:
//
//   ROOT key    ed25519. Private half wrapped TWICE and never by the phrase alone: AES-256-GCM under
//               a key HKDF-SHA256 derives from scrypt(phrase) AND this machine's 32-byte device
//               secret, length-prefixed so the two factors cannot be slid past each other.
//               Lives in ~/.aukora/keys/. Signs THREE things: the certificate
//               naming a device key, the genesis anchor, and the law anchor.
//               Otherwise it stays asleep.
//
//               This said "exactly one thing" until the anchors landed, and
//               core/witness/authority.mjs carried a note flagging the sentence as stale
//               that outlived two reviews. A stale comment in the custody module
//               is not a cosmetic defect in a project whose product is accuracy
//               about its own limits.
//
//   DEVICE key  ed25519. Private half at rest on disk, mode 0600, in
//               ~/.aukora/keys/ — never in the repo. This is what signs
//               receipts, thousands of times, without ceremony.
//
// A stranger verifies: receipt ← device key ← certificate ← root key ← the
// `aukora.pub` committed in the repo. Compromising the device key lets someone
// forge receipts on that machine; it does not let them forge the certificate,
// so the root can name the device revoked and the fraud has a boundary.
//
// The phrase is never stored, and neither is a fingerprint of it — GATE 2 removed `phraseSeal` from
// the published `aukora.pub`, because a stored fingerprint over a 14.34-bit secret is an offline
// oracle for anyone holding the file. Recognition now happens against the wrap itself: the phrase is
// right exactly when the AEAD opens.

import {
  generateKeyPairSync, createPublicKey, createPrivateKey, sign as edSign,
  verify as edVerify, randomBytes, scryptSync, createCipheriv, createDecipheriv,
  createHash, timingSafeEqual, hkdfSync,
} from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// GATE 1. The root is minted HERE ONLY, by the module whose source proves it is random and never
// derived. `bind()` used to call `generateKeyPairSync` itself, which left that proof describing a
// helper nothing called.
import { mintRootKeyPair } from './rootMint.mjs';

import { normalizePhrase } from './phrase.mjs';
import { canonicalJSON } from './chain.mjs';

export const PUB_FILE = 'aukora.pub';
export const PUB_SCHEMA = 'aukora-pub-v0';
export const CERT_SCHEMA = 'aukora-device-cert-v0';

/** The donor's parameters, unchanged. ~100 ms, which is fine off the hot path. */
export const PHRASE_KDF = Object.freeze({ N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 128 * 1024 * 1024 });

/**
 * Where custody lives.
 *
 * `AUKORA_KEYS_DIR` overrides it, the same way `AUKORA_CHAIN_HOME` overrides the chain, and for a
 * measured reason rather than a tidy one: `~/.aukora/keys` on this machine already holds 37 root and
 * device pairs from sibling repositories, and any suite that mints key material without an override
 * adds to that pile on every run. A test must be able to point this somewhere disposable.
 */
export function keysDir() { return process.env.AUKORA_KEYS_DIR || join(homedir(), '.aukora', 'keys'); }

/** The wrap format this module writes. v0 was phrase-only and is refused by name — see `unwrapRoot`. */
export const ROOT_SCHEMA_V1 = 'aukora-root-v1';
export const DEVICE_SECRET_FILE = 'device.secret';
export const DEVICE_SECRET_BYTES = 32;
/** HKDF `info` labels. A key derived for one purpose can never collide with one derived for another. */
const WRAP_LABEL = 'aukora-root-wrap-v1';
const RECOVERY_LABEL = 'aukora-root-recovery-v1';
/** The single sentence every unwrap failure returns. See `openWrap`. */
const FACTOR_REFUSAL = 'the factors did not open this key';

// ── encoding ────────────────────────────────────────────────────────────────
// SPKI/PKCS8 DER in base64, so `openssl pkey` can read these files directly.
// A custody format only our own code can open is a custody format nobody audits.

export const pubToB64 = (key) => key.export({ type: 'spki', format: 'der' }).toString('base64');
export const privToB64 = (key) => key.export({ type: 'pkcs8', format: 'der' }).toString('base64');
export const pubFromB64 = (b64) => createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
export const privFromB64 = (b64) => createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });

/** A stable, content-free id for a public key. */
export function keyId(pubB64) {
  return createHash('sha256').update(`aukora-key-id:${pubB64}`).digest('hex').slice(0, 24);
}

// ── phrase sealing ──────────────────────────────────────────────────────────

export function scryptHex(phrase, saltHex) {
  return scryptSync(normalizePhrase(phrase), Buffer.from(saltHex, 'hex'),
    PHRASE_KDF.keyLen, { N: PHRASE_KDF.N, r: PHRASE_KDF.r, p: PHRASE_KDF.p, maxmem: PHRASE_KDF.maxmem })
    .toString('hex');
}

function scryptKey(phrase, saltHex) {
  return scryptSync(normalizePhrase(phrase), Buffer.from(saltHex, 'hex'),
    32, { N: PHRASE_KDF.N, r: PHRASE_KDF.r, p: PHRASE_KDF.p, maxmem: PHRASE_KDF.maxmem });
}

/** Constant-time hex compare. Length mismatch short-circuits; contents do not. */
export function safeEqualHex(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Seal a phrase for recognition. A fresh salt per write, never reused. */
export function sealPhrase(phrase) {
  const saltHex = randomBytes(16).toString('hex');
  return { version: 'v2', saltHex, hashHex: scryptHex(phrase, saltHex), ...pick(PHRASE_KDF, ['N', 'r', 'p']) };
}

export function recognisePhrase(typed, sealed) {
  if (!sealed || sealed.version !== 'v2') return false;
  return safeEqualHex(scryptHex(typed, sealed.saltHex), sealed.hashHex);
}

function pick(obj, keys) { return Object.fromEntries(keys.map((k) => [k, obj[k]])); }

// ── the ceremony ────────────────────────────────────────────────────────────

/**
 * Bind a repository: mint a root key wrapped by the phrase, mint a device key,
 * and certify the device with the root.
 *
 * The phrase is an argument and is never written anywhere by this function.
 */

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SECOND FACTOR
//
// The root private half is minted at full CSPRNG strength and always was. What wrapped it was the
// ceremony phrase, ALONE, at 14.34 bits of min-entropy — so a wrapped root was worth 14.34 bits to
// anyone who obtained the file. `ceremony/recovery.ts` already refuses the tempting non-fix and says
// why: raising the scrypt cost is not a fix for the phrase and must never be presented as one.
// Fifteen bits stays fifteen bits. The only real fix is a second factor with real entropy.
//
// ══ WHY HKDF AND NOT CONCATENATION ══
//
// `scryptKey(phrase) || deviceSecret` is the obvious move and it is wrong — but be precise about
// WHY, because the usual reason does not apply here and claiming it would be an overclaim of exactly
// the kind this repository keeps catching.
//
// The usual reason is ambiguity: without length framing, `A||B` and `A'||B'` can be identical bytes
// for different factor pairs. TODAY THAT CANNOT HAPPEN — `scryptKey` returns exactly 32 bytes and
// the device secret is exactly 32, both fixed, so the split point is never in doubt. Measured, not
// assumed.
//
// The framing is here for the change that WOULD make it live: a third factor, a variable-length
// secret, a passphrase used raw. Length-prefixing costs eight bytes and removes the whole class
// before anyone has to notice it arrived. What is load-bearing TODAY is the other half — HKDF with
// a label naming this exact use, so the wrapping key and the recovery key cannot collide, and
// neither can collide with any future key derived from the same factors for another purpose.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** `uint32be(len) || bytes` — the framing that makes two factors unambiguous. */
function lengthPrefixed(...parts) {
  const out = [];
  for (const p of parts) {
    const b = Buffer.isBuffer(p) ? p : Buffer.from(String(p), 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length, 0);
    out.push(len, b);
  }
  return Buffer.concat(out);
}

/** The wrapping key for the everyday path: the phrase factor and the device factor, combined. */
function twoFactorKek(phrase, deviceSecret, wrap, label) {
  // THE DECLARED PARAMETERS ARE THE ONES USED. They were decorative: derivation read the module
  // constant while the file declared whatever it liked, so `N: 1024` in a header meant nothing. Now
  // the file's own numbers derive the key, which makes a lie produce a key that does not open — and
  // the AAD covers them too, so the lie is caught twice.
  const params = { N: wrap.N, r: wrap.r, p: wrap.p, maxmem: PHRASE_KDF.maxmem };
  const phraseFactor = scryptSync(normalizePhrase(phrase), Buffer.from(wrap.saltHex, 'hex'), 32, params);
  const ikm = lengthPrefixed(phraseFactor, deviceSecret);
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.from(wrap.saltHex, 'hex'), Buffer.from(label, 'utf8'), 32));
}

/** The wrapping key for the way back. One factor, because the recovery secret carries 257 bits alone. */
function recoveryKek(recoverySecret, saltHex, label) {
  const ikm = lengthPrefixed(Buffer.from(String(recoverySecret), 'utf8'));
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.from(saltHex, 'hex'), Buffer.from(label, 'utf8'), 32));
}

/**
 * THE ASSOCIATED DATA — what binds a wrap to the header that describes it.
 *
 * There was no `setAAD` call anywhere in this module, and downgrade was live: a blob could be
 * relabelled with a weaker schema and presented in a stronger world, or moved under another rootId,
 * and the tag would not notice. The header now travels inside the tag. Editing `schema` or `rootId`
 * by one character makes the wrap refuse to open, which is exactly what a version claim is for.
 */
function wrapAad(rootFile, wrap, purpose) {
  // EVERY SECURITY-RELEVANT FIELD, in a fixed order, canonically rendered.
  //
  // It used to be `schema|rootId|purpose`. The KDF suite, the scrypt parameters, the factor list,
  // the cipher and the creation time rode outside the tag — so a blob could open perfectly while
  // declaring it had been protected some other way. A provenance claim nothing stands behind is
  // worse than no claim, because a reader believes it.
  //
  // Fixed order and explicit `String()` rather than JSON: key order and number formatting must not
  // decide whether a key opens. Anything absent renders as the empty string, so adding a field to
  // the header later changes the AAD and is caught rather than silently unauthenticated.
  return Buffer.from([
    'aukora-root-aad-v1',
    purpose,
    String(rootFile?.schema ?? ''),
    String(rootFile?.rootId ?? ''),
    String(rootFile?.createdAt ?? ''),
    String(wrap?.kdf ?? ''),
    String(wrap?.N ?? ''), String(wrap?.r ?? ''), String(wrap?.p ?? ''),
    String(wrap?.saltHex ?? ''),
    String(wrap?.cipher ?? ''),
    (wrap?.factors ?? []).join(','),
  ].join('|'), 'utf8');
}

/**
 * Read this machine's device secret, or mint one.
 *
 * High-entropy and CSPRNG — 32 bytes, never a passphrase, never derived from anything a human can
 * remember. It lives OUTSIDE the repository at 0600, so it is not in a git tree, not in a backup of
 * the project, and not in a cloud sync of the working directory.
 *
 * Idempotent on purpose: a second call returns the SAME secret. A function that minted a fresh one
 * per process would lock the owner out of their own root the first time anything called it twice.
 */
/**
 * GATE 4a — THE PRODUCTION PATH OWNS FACTOR GENERATION.
 *
 * `bind()` accepted any 32 bytes and any long string, so a placeholder passed through a call chain
 * would be accepted as a "factor" at full length and near-zero entropy. Length is not entropy. These
 * two functions are the audited source, and `bind` refuses anything that fails the floor below.
 *
 * The floor is deliberately crude — it catches the mistake someone would actually make (a repeated
 * byte, a constant, a placeholder) and cannot detect a low-entropy secret that merely looks random.
 * Said plainly rather than dressed up: this refuses the obvious, not the adversarial.
 */
export function mintDeviceSecret() {
  return randomBytes(DEVICE_SECRET_BYTES);
}

/**
 * A recovery secret with the entropy its claim needs.
 *
 * Rejection-sampled rather than folded with `%`: 256 is not divisible by the alphabet size, so a
 * modulo gives the first few characters a higher chance. The bias is small and free to remove, and a
 * biased generator in a key path is not a thing to leave measured-but-present. The alphabet omits
 * 0/O/1/I/L because this is written down by hand. Same construction as `ceremony/recovery.ts`, which
 * owns the human-facing half; this is the one core/witness can reach without importing across lanes.
 */
export function mintRecoverySecret() {
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const LIMIT = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < 52) {
    for (const b of randomBytes(64)) {
      if (out.length >= 52) break;
      if (b >= LIMIT) continue;
      out += ALPHABET[b % ALPHABET.length];
    }
  }
  return (out.match(/.{1,5}/g) ?? []).join('-');
}

/**
 * Does this factor carry enough distinct values to be a secret at all?
 *
 * Not an entropy estimate and not presented as one. It refuses the shapes a mistake takes — one
 * repeated byte, a handful of distinct values across a long string — and nothing more.
 */
function looksDegenerate(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  if (bytes.length === 0) return true;
  const distinct = new Set(bytes).size;
  return distinct < Math.min(8, Math.ceil(bytes.length / 4));
}

export function ensureDeviceSecret() {
  const dir = keysDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, DEVICE_SECRET_FILE);
  const existing = readDeviceSecret();
  if (existing) return existing;
  const secret = mintDeviceSecret();
  writeFileSync(path, secret, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  return secret;
}

/** The device secret if this machine has one, else null. Never mints — see `ensureDeviceSecret`. */
export function readDeviceSecret() {
  try {
    const b = readFileSync(join(keysDir(), DEVICE_SECRET_FILE));
    return b.length === DEVICE_SECRET_BYTES ? b : null;
  } catch {
    return null;
  }
}

export function bind({ phrase, deviceSecret, recoverySecret, boundAt }) {
  const root = mintRootKeyPair();
  const device = generateKeyPairSync('ed25519');

  const rootPub = pubToB64(root.publicKey);
  const devicePub = pubToB64(device.publicKey);
  const rootId = keyId(rootPub);
  const deviceId = keyId(devicePub);

  // BOTH FACTORS ARE REQUIRED, and neither is optional for a reason.
  //
  // Without a device secret this is the 14.34-bit wrap all over again. Without a recovery secret it
  // is a TRAP: the machine dies, the device secret dies with it, and the root is gone permanently —
  // there is no rotation, no un-vow, and no second chance. A two-factor wrap with no way back is not
  // security, it is a loaded gun pointed at the owner. So `bind` refuses to mint one.
  if (!Buffer.isBuffer(deviceSecret) || deviceSecret.length !== DEVICE_SECRET_BYTES) {
    throw new Error(`bind refused: a ${DEVICE_SECRET_BYTES}-byte device secret is required`);
  }
  if (typeof recoverySecret !== 'string' || recoverySecret.length < 32) {
    throw new Error('bind refused: a high-entropy recovery secret is required — a wrap with no way back is a trap');
  }
  // Length is not entropy. A repeated byte is 32 bytes long and worth nothing.
  if (looksDegenerate(deviceSecret)) throw new Error('bind refused: the device secret is degenerate — use mintDeviceSecret()');
  if (looksDegenerate(recoverySecret)) throw new Error('bind refused: the recovery secret is degenerate — use mintRecoverySecret()');

  const priv = Buffer.from(privToB64(root.privateKey), 'utf8');
  const seal = (key, purpose, wrap, header) => {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(wrapAad(header, wrap, purpose));
    const ct = Buffer.concat([c.update(priv), c.final()]);
    return { ivB64: iv.toString('base64'), ctB64: ct.toString('base64'), tagB64: c.getAuthTag().toString('base64') };
  };

  const saltHex = randomBytes(16).toString('hex');
  const recoverySaltHex = randomBytes(16).toString('hex');

  // The header is built BEFORE the seal, because the seal authenticates it. Anything added to these
  // objects later is covered automatically; anything added outside them is not, which is the whole
  // reason there is exactly one of them per wrap.
  const header = { schema: ROOT_SCHEMA_V1, rootId, createdAt: boundAt };
  const wrappedHeader = {
    kdf: 'scrypt+hkdf-sha256', ...pick(PHRASE_KDF, ['N', 'r', 'p']), saltHex,
    factors: ['phrase', 'device'], cipher: 'aes-256-gcm',
  };
  const recoveryHeader = {
    kdf: 'hkdf-sha256', saltHex: recoverySaltHex,
    factors: ['recovery'], cipher: 'aes-256-gcm',
  };

  const rootFile = {
    schema: ROOT_SCHEMA_V1,
    rootId,
    pub: rootPub,
    // The everyday path: the phrase the owner says, and the secret this machine holds.
    wrapped: {
      ...wrappedHeader,
      ...seal(twoFactorKek(phrase, deviceSecret, wrappedHeader, WRAP_LABEL), 'wrapped', wrappedHeader, header),
    },
    // The way back: one factor, because the recovery secret carries 257 bits by itself. Shown once,
    // written down by the owner, and kept off the machine it recovers.
    recovery: {
      ...recoveryHeader,
      ...seal(recoveryKek(recoverySecret, recoverySaltHex, RECOVERY_LABEL), 'recovery', recoveryHeader, header),
    },
    createdAt: boundAt,
  };

  const deviceFile = {
    schema: 'aukora-device-v0', rootId, deviceId,
    pub: devicePub, priv: privToB64(device.privateKey), createdAt: boundAt,
  };

  // The certificate. Signed over canonical JSON so the bytes are reproducible.
  const certBody = { schema: CERT_SCHEMA, rootId, deviceId, devicePub, issuedAt: boundAt };
  const cert = edSign(null, Buffer.from(canonicalJSON(certBody), 'utf8'), root.privateKey).toString('base64');

  const pubFile = {
    schema: PUB_SCHEMA,
    rootId,
    rootPub,
    boundAt,
    genesisRef: deriveGenesisRef({ rootId, boundAt }),
    // GATE 2. `phraseSeal` USED TO LIVE HERE, and it was a salted scrypt verifier over the ceremony
    // phrase in the file that goes into the repository — an offline oracle over a 14.34-bit secret
    // for anyone who cloned it. The second factor stops the phrase OPENING the root; it never
    // stopped the phrase being TESTED.
    //
    // Nothing read it. The ceremony verifies its type-back against its own in-memory seal from
    // `ceremony/verify.ts` and never opens this file. A published liability with no consumer.
    device: { deviceId, devicePub, issuedAt: boundAt, cert },
    // Declared here so it travels with the public half and cannot be lost in a
    // README rewrite.
    aumlokGrantsAuthority: false,
  };

  return { rootFile, deviceFile, pubFile, rootId, deviceId };
}

/** Write custody to ~/.aukora/keys. The repo never receives a private half. */
export function writeCustody({ rootFile, deviceFile }) {
  const dir = keysDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* pre-existing dir with other modes */ }

  const rootPath = join(dir, `${rootFile.rootId}.root.json`);
  const devicePath = join(dir, `${rootFile.rootId}.device.json`);
  writeFileSync(rootPath, `${JSON.stringify(rootFile, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(devicePath, `${JSON.stringify(deviceFile, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(rootPath, 0o600); chmodSync(devicePath, 0o600); } catch { /* best effort */ }
  return { rootPath, devicePath };
}

/**
 * Load the device signer for a repo. Returns `null` rather than throwing —
 * an unsigned receipt is worth strictly more than a refused tool call the owner
 * did not ask for, so a missing key degrades the record, never the gate.
 */
export function loadSigner(repoRoot) {
  try {
    const pub = readPub(repoRoot);
    if (!pub.ok) return null;
    const path = join(keysDir(), `${pub.pubFile.rootId}.device.json`);
    if (!existsSync(path)) return null;
    const device = JSON.parse(readFileSync(path, 'utf8'));
    if (device?.schema !== 'aukora-device-v0' || typeof device.priv !== 'string') return null;
    const key = privFromB64(device.priv);
    return {
      deviceId: device.deviceId,
      sign: (hashHex) => edSign(null, Buffer.from(hashHex, 'utf8'), key).toString('base64'),
    };
  } catch {
    return null;
  }
}

export function readPub(repoRoot) {
  try {
    const pubFile = JSON.parse(readFileSync(join(repoRoot, PUB_FILE), 'utf8'));
    if (pubFile?.schema !== PUB_SCHEMA) return { ok: false, reason: `pub schema is ${String(pubFile?.schema)}` };
    return { ok: true, pubFile };
  } catch (err) {
    return { ok: false, reason: err?.code === 'ENOENT' ? 'no aukora.pub' : (err?.message ?? 'unreadable') };
  }
}

/** Is the device certificate genuinely signed by the root named beside it? */
export function verifyDeviceCert(pubFile) {
  try {
    const body = {
      schema: CERT_SCHEMA, rootId: pubFile.rootId,
      deviceId: pubFile.device.deviceId, devicePub: pubFile.device.devicePub,
      issuedAt: pubFile.device.issuedAt,
    };
    const ok = edVerify(null, Buffer.from(canonicalJSON(body), 'utf8'),
      pubFromB64(pubFile.rootPub), Buffer.from(pubFile.device.cert, 'base64'));
    return { ok, reason: ok ? null : 'certificate does not verify against the root key' };
  } catch (err) {
    return { ok: false, reason: err?.message ?? 'certificate malformed' };
  }
}

/** Does this signature over this hash come from this device key? */
export function verifyReceiptSig(devicePubB64, hashHex, sigB64) {
  try {
    if (typeof sigB64 !== 'string' || sigB64.length === 0) return false;
    return edVerify(null, Buffer.from(hashHex, 'utf8'), pubFromB64(devicePubB64), Buffer.from(sigB64, 'base64'));
  } catch {
    return false;
  }
}

/** Unwrap the root private key with the phrase. For rotation and revocation. */
export function unwrapRoot(rootFile, { phrase, deviceSecret } = {}) {
  // A v0 blob is REFUSED BY NAME rather than opened weakly. 37 of them exist on this machine already,
  // from sibling repositories, every one wrapped at 14.34 bits. Quietly accepting one here would make
  // the second factor optional in practice, which is the same as not having it — and it would read to
  // the caller as success. If one of those roots is ever needed, it is a migration with the owner
  // present, not a silent fallback inside a fence.
  if (rootFile?.schema !== ROOT_SCHEMA_V1) {
    return { ok: false, reason: `this root is ${String(rootFile?.schema)} — a single-factor wrap, refused; it must be re-wrapped with a device factor` };
  }
  const secret = Buffer.isBuffer(deviceSecret) ? deviceSecret : readDeviceSecret();
  if (!secret) return { ok: false, reason: FACTOR_REFUSAL };
  return openWrap(rootFile, rootFile.wrapped, 'wrapped',
    (w) => twoFactorKek(phrase, secret, w, WRAP_LABEL));
}

/**
 * The way back. One high-entropy secret, independent of the phrase and of this machine.
 *
 * This exists so that losing the laptop is survivable. It opens the SAME root as the everyday path —
 * asserted in the suite, because two wraps that opened different keys would be a far worse bug than
 * having no recovery at all.
 */
export function unwrapRootByRecovery(rootFile, recoverySecret) {
  if (rootFile?.schema !== ROOT_SCHEMA_V1) {
    return { ok: false, reason: `this root is ${String(rootFile?.schema)} — a single-factor wrap, refused` };
  }
  if (!rootFile.recovery) return { ok: false, reason: 'this root carries no recovery wrap' };
  return openWrap(rootFile, rootFile.recovery, 'recovery',
    (w) => recoveryKek(recoverySecret, w.saltHex ?? '', RECOVERY_LABEL));
}

/**
 * ONE MESSAGE, NO ORACLE.
 *
 * Every failure below — wrong phrase, wrong device secret, absent device secret, tampered header —
 * returns the SAME sentence. A refusal that distinguished them would let someone holding the file
 * confirm a phrase guess without the device secret, which is precisely the 14.34-bit search the
 * second factor exists to make worthless.
 */
function openWrap(rootFile, w, purpose, deriveKek) {
  try {
    // THE KEY DERIVATION IS INSIDE THE REFUSAL BOUNDARY, and that is not tidiness.
    //
    // It used to happen at the call site, so a header carrying malformed KDF parameters made
    // `scryptSync` THROW straight out of `unwrapRoot` — a function documented never to throw, called
    // from a door route that would surface it as a crash rather than a refusal. My own guard module
    // says it in one line: a fence that throws is a fence that fails open.
    //
    // FOUND BY LINUX AND NOT BY MACOS. Every mutation in the header test refused cleanly here and one
    // of them threw on the runner, because scrypt's parameter and memory validation is not identical
    // across platforms. The platform difference was the messenger; the defect was that a crafted
    // root file could choose between "refused" and "crashed".
    //
    // Now every malformed header takes the same road as a wrong factor: one sentence, no oracle.
    const kek = deriveKek(w ?? {});
    const d = createDecipheriv('aes-256-gcm', kek, Buffer.from(w.ivB64, 'base64'));
    d.setAAD(wrapAad(rootFile, w, purpose));
    d.setAuthTag(Buffer.from(w.tagB64, 'base64'));
    const out = Buffer.concat([d.update(Buffer.from(w.ctB64, 'base64')), d.final()]);
    const key = privFromB64(out.toString('utf8'));

    // GATE 4b. DOES THE KEY THAT CAME OUT MATCH THE IDENTITY THIS FILE CLAIMS?
    //
    // The tag proves the ciphertext and header were not edited. It says nothing about `pub`, which
    // is not key material — so a file pairing one root's ciphertext with another root's public half
    // opened perfectly and produced a key that signs as nobody. Both wrap paths agreeing with EACH
    // OTHER was never the same as either agreeing with the published identity.
    const derived = pubToB64(createPublicKey(key));
    if (derived !== rootFile.pub || keyId(derived) !== rootFile.rootId) {
      return { ok: false, reason: FACTOR_REFUSAL };
    }

    // GATE 4c. A KeyObject and nothing else. The private half used to leave here as base64 as well,
    // which puts key material one `console.log(opened)` from a log file forever.
    return { ok: true, key };
  } catch {
    return { ok: false, reason: FACTOR_REFUSAL };
  }
}

/**
 * The genesis reference — 24 hex characters derived from two rotation-stable
 * public facts and nothing else, so the Aura draws the identical figure for a
 * given binding forever.
 *
 * Content-free on purpose: no parseable date, no counter, no person-derived
 * number. The binding fact lives in the receipt; this is the visible echo, and
 * an echo that leaked the thing it echoes would be a worse object.
 */
export function deriveGenesisRef({ rootId, boundAt }) {
  return createHash('sha256').update(`aumlok-genesis-aura-ref:${rootId}|${boundAt}`).digest('hex').slice(0, 24);
}
