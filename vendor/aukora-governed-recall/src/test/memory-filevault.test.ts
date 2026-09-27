// φ — the real file-backed vault: AES-256-GCM round trip, and key destruction actually making
// ciphertext unrecoverable through the vault's own path.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, realpathSync, chmodSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  openFileVaultDirs, sealBytes, openBytes, fileCustodian, fileStore, objectsOnDisk, keysOnDisk, VaultIOError,
} from '../core/memory/fileVaultAdapter';
import { VaultRefusal } from '../core/memory/vault';

let root = '';
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-filevault-'))); });
afterEach(() => {
  try { chmodSync(join(root, 'keys'), 0o700); } catch { /* not every test locks it */ }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* gone */ }
});

const notRoot = typeof process.getuid !== 'function' || process.getuid() !== 0;

describe('seal / open — the round trip', () => {
  it('what goes in comes back out, byte for byte', () => {
    const dirs = openFileVaultDirs(root);
    const plaintext = Buffer.from('are you there love?', 'utf8');
    const ref = sealBytes(dirs, plaintext);
    const key = fileCustodian(root).release(ref.keyRef)!;
    const back = openBytes(dirs, ref, key);
    expect(Buffer.from(back).toString('utf8')).toBe('are you there love?');
  });

  it('the ciphertext on disk is not the plaintext, anywhere in the bytes', () => {
    const dirs = openFileVaultDirs(root);
    const plaintext = Buffer.from('a secret nobody should read from the objects/ directory', 'utf8');
    const ref = sealBytes(dirs, plaintext);
    const blob = readFileSync(join(dirs.store.root, ref.ciphertextDigest));
    expect(blob.includes(plaintext)).toBe(false);
  });

  it('a tampered ciphertext blob is refused before decryption is even attempted', () => {
    const dirs = openFileVaultDirs(root);
    const ref = sealBytes(dirs, Buffer.from('hello', 'utf8'));
    const key = fileCustodian(root).release(ref.keyRef)!;
    const path = join(dirs.store.root, ref.ciphertextDigest);
    const blob = readFileSync(path);
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 0xff;
    writeFileSync(path, blob);
    expect(() => openBytes(dirs, ref, key)).toThrow(VaultIOError);
  });

  it('the wrong key fails AEAD authentication rather than returning garbage', () => {
    const dirs = openFileVaultDirs(root);
    const ref = sealBytes(dirs, Buffer.from('hello', 'utf8'));
    expect(() => openBytes(dirs, ref, randomBytes(32))).toThrow(VaultIOError);
  });
});

describe('destroy() makes ciphertext unrecoverable through the vault\'s own path', () => {
  it('after destroy, the legitimate retrieval path is gone: has() is false and release() is null', () => {
    const dirs = openFileVaultDirs(root);
    const plaintext = Buffer.from('forget me', 'utf8');
    const ref = sealBytes(dirs, plaintext);
    const custodian = fileCustodian(root);

    // Confirm decryption genuinely works before destruction — otherwise "unrecoverable after" proves
    // nothing, because it might never have been recoverable.
    const keyBeforeDestroy = custodian.release(ref.keyRef)!;
    expect(Buffer.from(openBytes(dirs, ref, keyBeforeDestroy)).toString('utf8')).toBe('forget me');

    expect(custodian.destroy(ref.keyRef)).toBe(true);
    expect(custodian.has(ref.keyRef)).toBe(false);
    expect(custodian.release(ref.keyRef)).toBeNull();
    expect(keysOnDisk(dirs)).not.toContain(ref.keyRef.slice('vault:'.length));
  });

  it('destroying an already-destroyed key is a clean false, not a crash', () => {
    const dirs = openFileVaultDirs(root);
    const ref = sealBytes(dirs, Buffer.from('x', 'utf8'));
    const custodian = fileCustodian(root);
    expect(custodian.destroy(ref.keyRef)).toBe(true);
    expect(custodian.destroy(ref.keyRef)).toBe(false);
  });
});

describe('the custody tri-state — absent is not the same as unreadable (#213-shaped)', () => {
  it.skipIf(!notRoot)('an unreadable keys/ directory REFUSES rather than answering "absent"', () => {
    const dirs = openFileVaultDirs(root);
    const ref = sealBytes(dirs, Buffer.from('x', 'utf8'));
    chmodSync(dirs.custodian.root, 0o000);
    try {
      expect(() => fileCustodian(root).has(ref.keyRef)).toThrow(VaultRefusal);
    } finally {
      chmodSync(dirs.custodian.root, 0o700);
    }
  });

  it('a genuinely never-created key answers false, not a refusal', () => {
    const custodian = fileCustodian(root);
    expect(custodian.has('vault:' + '0'.repeat(32))).toBe(false);
  });
});

describe('fileStore', () => {
  it('put/get/has/drop agree with each other', () => {
    const store = fileStore(root);
    const digest = 'a'.repeat(64);
    expect(store.has(digest)).toBe(false);
    // `put` records only the keyRef sidecar — the ciphertext bytes themselves are written separately
    // by `sealBytes`, mirroring the real call order. `has`/object existence follow the ciphertext file.
    writeFileSync(join(store.root, digest), Buffer.from('ciphertext'));
    store.put({ ciphertextDigest: digest, keyRef: `vault:${'b'.repeat(32)}`, byteLength: 3 });
    expect(store.has(digest)).toBe(true);
    expect(store.get(digest)?.keyRef).toBe(`vault:${'b'.repeat(32)}`);
    expect(store.drop(digest)).toBe(true);
    expect(store.has(digest)).toBe(false);
  });

  it('drop on something that was never there is an honest false', () => {
    expect(fileStore(root).drop('c'.repeat(64))).toBe(false);
  });
});

describe('objectsOnDisk / keysOnDisk', () => {
  it('reflect exactly what sealBytes wrote', () => {
    const dirs = openFileVaultDirs(root);
    const ref = sealBytes(dirs, Buffer.from('one memory', 'utf8'));
    expect(objectsOnDisk(dirs)).toContain(ref.ciphertextDigest);
    expect(keysOnDisk(dirs)).toContain(ref.keyRef.slice('vault:'.length));
  });
});
