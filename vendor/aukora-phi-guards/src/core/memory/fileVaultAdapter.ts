// φ — the file-backed vault: the first place real bytes live. Ported and reduced from
// `@aukora/kira`'s `adapters/fileVault.ts` (aukora-one, `organs/kira`). See `docs/MEMORY-PORT.md` and
// `PROVENANCE.md`.
//
// ══ WHY THIS IS NOT vault.ts ══
//
// `vault.ts` is pure — no filesystem, no randomness, no clock — so every branch is testable without a
// disk. Everything effectful lives here, and the arrow only points one way: this file imports `vault.ts`,
// never the reverse.
//
// ══ ON-DISK LAYOUT ══
//
//   <root>/objects/<digest>       ciphertext: nonce ‖ ciphertext ‖ tag
//   <root>/objects/<digest>.ref   the keyRef that opens it (so a store can answer `get` alone)
//   <root>/keys/<handle>          the 32-byte AES-256-GCM key for one object, and nothing else
//
// ══ WHAT WAS LEFT OUT ══
//
// The donor's `LAYOUT.json` version tag, its Spotlight-exclusion marker, its staging-file reaper, and —
// the largest omission — `adapters/vaultLock.ts`, the cross-process `LOCK` file with stale-holder
// detection. All of that is the "concurrent-write machinery" the task named explicitly to leave out.
// `core/memory/ledger.ts` documents the honest consequence: this vault defends against a SHORT WRITE
// (via `durableWrite.ts`, ported) but NOT against two operating-system processes writing to the same
// vault directory at once. If a second φ door process is ever pointed at the same `.aukora/memory/`, it
// can race this one. That is a known, named gap, not a silent one.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, closeSync } from 'fs';
import { join } from 'path';

import { publishFileDurably, shredAndUnlink, overwriteAllSync, DurableWriteError } from './durableWrite';
import { VaultRefusal, type KeyCustodian, type ObjectStore, type SealedObject } from './vault';
import type { ContentRef } from './eventLog';

const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;
/** Matches `eventLog.ts`'s `IDENT` rule, so the log will accept the handle. */
const HANDLE = /^vault:[0-9a-f]{32}$/;

export class VaultIOError extends Error {
  readonly reasonClass: string;
  constructor(reasonClass: string) {
    // Content-free, like every refusal in this lane: the constructor cannot receive a value.
    super(`memory vault io: ${reasonClass}`);
    this.name = 'VaultIOError';
    this.reasonClass = reasonClass;
  }
}

function writeFileDurably(path: string, bytes: Uint8Array): void {
  const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`;
  try {
    publishFileDurably(tmp, path, bytes, 0o600);
  } catch (err) {
    if (err instanceof DurableWriteError) throw new VaultIOError(err.reasonClass);
    throw err;
  }
}

const handleToFile = (keyRef: string): string => {
  if (!HANDLE.test(keyRef)) throw new VaultIOError('key-ref-unrecognised');
  return keyRef.slice('vault:'.length);
};

/**
 * Real key custody on the local filesystem. One file per key, mode 0600. `destroy` overwrites before
 * unlinking — the smallest thing that can honestly be called custody. NOT hardware-backed; a Keychain-
 * or Secure-Enclave-backed custodian is a strictly better implementation of the same interface and the
 * organ above (`vault.ts`) would not change by one line.
 */
export function fileCustodian(root: string): KeyCustodian & { readonly root: string } {
  const dir = join(root, 'keys');
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  return {
    kind: 'file-custodian-v1',
    root: dir,

    /**
     * Present, absent, or REFUSE — never "absent because I could not look". `existsSync` swallows
     * every error into `false` (EACCES, EIO, a revoked token included), which would let an unreadable
     * key directory answer "the key is gone" and mint a certificate that verifies while the key is
     * still on disk. `statSync` is used instead precisely because ENOENT is the only code that means
     * absent.
     */
    has(keyRef: string): boolean {
      let path: string;
      try { path = join(dir, handleToFile(keyRef)); } catch { throw new VaultRefusal('vault:custody-unreadable'); }
      try {
        statSync(path);
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw new VaultRefusal('vault:custody-unreadable');
        return false;
      }
    },

    release(keyRef: string): Uint8Array | null {
      try {
        const bytes = readFileSync(join(dir, handleToFile(keyRef)));
        return bytes.length === KEY_BYTES ? new Uint8Array(bytes) : null;
      } catch { return null; }
    },

    destroy(keyRef: string): boolean {
      let path: string;
      try { path = join(dir, handleToFile(keyRef)); } catch { return false; }
      if (!existsSync(path)) return false;
      try {
        // `overwriteAllSync`, not a bare `writeSync` — see `durableWrite.ts`'s header. A short write
        // here scribbles over one byte of a 32-byte key, unlinks the file, and would report success
        // while 31 of the key's bytes are still intact on the free list.
        const size = statSync(path).size;
        const fd = openSync(path, 'r+');
        try { overwriteAllSync(fd, randomBytes(Math.max(size, KEY_BYTES))); } finally { closeSync(fd); }
        unlinkSync(path);
        return !existsSync(path);
      } catch { return false; }
    },
  };
}

/** Ciphertext on disk, addressed by its own digest. Never plaintext. */
export function fileStore(root: string): ObjectStore & { readonly root: string; readonly kind: string } {
  const dir = join(root, 'objects');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const at = (digest: string): string => {
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new VaultIOError('digest-invalid');
    return join(dir, digest);
  };

  return {
    kind: 'file-store-v1',
    root: dir,

    has(ciphertextDigest: string): boolean {
      try { return existsSync(at(ciphertextDigest)); } catch { return false; }
    },

    get(ciphertextDigest: string): SealedObject | null {
      try {
        const path = at(ciphertextDigest);
        if (!existsSync(path)) return null;
        return {
          ciphertextDigest,
          keyRef: readFileSync(`${path}.ref`, 'utf8').trim(),
          byteLength: statSync(path).size,
        };
      } catch { return null; }
    },

    put(object: SealedObject): void {
      writeFileDurably(`${at(object.ciphertextDigest)}.ref`, Buffer.from(`${object.keyRef}\n`));
    },

    drop(ciphertextDigest: string): boolean {
      try {
        const path = at(ciphertextDigest);
        if (!existsSync(path)) return false;
        unlinkSync(path);
        if (existsSync(`${path}.ref`)) shredAndUnlink(`${path}.ref`);
        return !existsSync(path);
      } catch { return false; }
    },
  };
}

export interface FileVaultDirs {
  readonly root: string;
  readonly custodian: ReturnType<typeof fileCustodian>;
  readonly store: ReturnType<typeof fileStore>;
}

/** Open (or create) the vault directories at `root`. The caller decides `root`; there is no default. */
export function openFileVaultDirs(root: string): FileVaultDirs {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return { root, custodian: fileCustodian(root), store: fileStore(root) };
}

/**
 * Seal plaintext into the vault and return the ledger's view of it: a digest, a handle, a length — no
 * plaintext, and nothing from which plaintext can be recovered without the key this call just wrote.
 * The handle is RANDOM, never derived from the content — a derived handle would be a confirmation
 * oracle, testable forever by anyone holding the vault, including against memories already forgotten.
 */
export function sealBytes(dirs: FileVaultDirs, plaintext: Uint8Array): ContentRef {
  const key = randomBytes(KEY_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const blob = Buffer.concat([nonce, body, cipher.getAuthTag()]);

  const ciphertextDigest = createHash('sha256').update(blob).digest('hex');
  const keyRef = `vault:${randomBytes(16).toString('hex')}`;

  writeFileDurably(join(dirs.store.root, ciphertextDigest), blob);
  writeFileDurably(join(dirs.custodian.root, handleToFile(keyRef)), key);
  dirs.store.put({ ciphertextDigest, keyRef, byteLength: blob.length });

  return Object.freeze({ ciphertextDigest, keyRef, byteLength: blob.length });
}

/**
 * Open sealed bytes with a key the vault released. Takes the KEY, not the handle, so this cannot be
 * called without having gone through `vault.ts`'s `releaseKey` first.
 */
export function openBytes(dirs: FileVaultDirs, ref: ContentRef, key: Uint8Array): Uint8Array {
  const blob = readFileSync(join(dirs.store.root, ref.ciphertextDigest));

  // Content-addressed, so a tampered blob is detectable before the AEAD tag is even reached.
  if (createHash('sha256').update(blob).digest('hex') !== ref.ciphertextDigest) {
    throw new VaultIOError('ciphertext-digest-mismatch');
  }

  const nonce = blob.subarray(0, NONCE_BYTES);
  const tag = blob.subarray(blob.length - AUTH_TAG_BYTES);
  const body = blob.subarray(NONCE_BYTES, blob.length - AUTH_TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  try {
    return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
  } catch {
    throw new VaultIOError('authentication-failed');
  }
}

/** Every ciphertext blob currently on disk — for an "is it really gone" check in tests. */
export function objectsOnDisk(dirs: FileVaultDirs): readonly string[] {
  return readdirSync(dirs.store.root).filter((f) => /^[0-9a-f]{64}$/.test(f)).sort();
}

/** Every key handle currently on disk — the only thing that makes content readable. */
export function keysOnDisk(dirs: FileVaultDirs): readonly string[] {
  return readdirSync(dirs.custodian.root).filter((f) => /^[0-9a-f]{32}$/.test(f)).sort();
}
