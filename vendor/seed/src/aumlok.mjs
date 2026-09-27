// aukora · src/aumlok.mjs — custody
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
//   ROOT key    ed25519. Private half wrapped with scrypt(phrase) + AES-256-GCM.
//               Lives in ~/.aukora/keys/. Signs THREE things: the certificate
//               naming a device key, the genesis anchor, and the law anchor.
//               Otherwise it stays asleep.
//
//               This said "exactly one thing" until the anchors landed, and
//               src/authority.mjs carried a note flagging the sentence as stale
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
// The phrase is never stored. Only a fresh-salted scrypt fingerprint is, so the
// ceremony can RECOGNISE a phrase it cannot reproduce.

import {
  generateKeyPairSync, createPublicKey, createPrivateKey, sign as edSign,
  verify as edVerify, randomBytes, scryptSync, createCipheriv, createDecipheriv,
  createHash, timingSafeEqual,
} from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { normalizePhrase } from './phrase.mjs';
import { canonicalJSON } from './chain.mjs';

export const PUB_FILE = 'aukora.pub';
export const PUB_SCHEMA = 'aukora-pub-v0';
export const CERT_SCHEMA = 'aukora-device-cert-v0';

/** The donor's parameters, unchanged. ~100 ms, which is fine off the hot path. */
export const PHRASE_KDF = Object.freeze({ N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 128 * 1024 * 1024 });

export function keysDir() { return join(homedir(), '.aukora', 'keys'); }

// ── encoding ────────────────────────────────────────────────────────────────
// SPKI/PKCS8 DER in base64, so `openssl pkey` can read these files directly.
// A custody format only our own code can open is a custody format nobody audits.

const pubToB64 = (key) => key.export({ type: 'spki', format: 'der' }).toString('base64');
const privToB64 = (key) => key.export({ type: 'pkcs8', format: 'der' }).toString('base64');
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
export function bind({ phrase, boundAt }) {
  const root = generateKeyPairSync('ed25519');
  const device = generateKeyPairSync('ed25519');

  const rootPub = pubToB64(root.publicKey);
  const devicePub = pubToB64(device.publicKey);
  const rootId = keyId(rootPub);
  const deviceId = keyId(devicePub);

  // Wrap the root private half. scrypt for the key, AES-256-GCM for the seal.
  const saltHex = randomBytes(16).toString('hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scryptKey(phrase, saltHex), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(privToB64(root.privateKey), 'utf8')), cipher.final()]);

  const rootFile = {
    schema: 'aukora-root-v0',
    rootId,
    pub: rootPub,
    wrapped: {
      kdf: 'scrypt', ...pick(PHRASE_KDF, ['N', 'r', 'p']), saltHex,
      cipher: 'aes-256-gcm', ivB64: iv.toString('base64'),
      ctB64: ct.toString('base64'), tagB64: cipher.getAuthTag().toString('base64'),
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
    phraseSeal: sealPhrase(phrase),
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
export function unwrapRoot(rootFile, phrase) {
  try {
    const w = rootFile.wrapped;
    const d = createDecipheriv('aes-256-gcm', scryptKey(phrase, w.saltHex), Buffer.from(w.ivB64, 'base64'));
    d.setAuthTag(Buffer.from(w.tagB64, 'base64'));
    const out = Buffer.concat([d.update(Buffer.from(w.ctB64, 'base64')), d.final()]);
    return { ok: true, key: privFromB64(out.toString('utf8')) };
  } catch {
    // GCM tag failure is indistinguishable from a wrong phrase, which is the
    // property we want: one message, no oracle.
    return { ok: false, reason: 'the phrase did not open this key' };
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
