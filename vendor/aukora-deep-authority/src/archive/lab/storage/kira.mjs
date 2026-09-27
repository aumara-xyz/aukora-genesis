import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { canonicalJSON } from '../kernel/canonical.mjs';

/**
 * Kira: Ephemeral cryptographic key destruction vault.
 * Guarantees key destruction within this vault's in-process threat model.
 */
export class KiraVault {
  constructor() {
    this._entries = new Map();
    this._certificates = new Map();
  }

  put(keyId, secret) {
    if (!keyId || secret === undefined) throw new TypeError('keyId and secret required');
    const masterKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
    const raw = Buffer.from(typeof secret === 'string' ? secret : JSON.stringify(secret), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
    const tag = cipher.getAuthTag();

    this._entries.set(keyId, {
      masterKey,
      iv,
      tag,
      ciphertext,
      storedAt: Date.now()
    });

    return { keyId, storedAt: Date.now() };
  }

  recall(keyId) {
    const entry = this._entries.get(keyId);
    if (!entry) {
      if (this._certificates.has(keyId)) {
        return { ok: false, reason: 'kira:key-destroyed', certificate: this._certificates.get(keyId) };
      }
      return { ok: false, reason: 'kira:key-not-found' };
    }

    try {
      const decipher = createDecipheriv('aes-256-gcm', entry.masterKey, entry.iv);
      decipher.setAuthTag(entry.tag);
      const plaintext = Buffer.concat([decipher.update(entry.ciphertext), decipher.final()]).toString('utf8');
      return { ok: true, secret: plaintext };
    } catch {
      return { ok: false, reason: 'kira:corrupt-payload' };
    }
  }

  forget(keyId) {
    const entry = this._entries.get(keyId);
    if (!entry) {
      if (this._certificates.has(keyId)) return { ok: true, certificate: this._certificates.get(keyId) };
      return { ok: false, reason: 'kira:key-not-found' };
    }

    // Cryptographic zeroing / shredding of master key
    entry.masterKey.fill(0);
    randomBytes(32).copy(entry.masterKey); // Overwrite with entropy
    entry.masterKey.fill(0);

    const erasedAt = Date.now();
    const certPayload = {
      domain: 'aukora:kira:erasure:v1',
      erasedAt,
      keyId,
      threatModel: "key destruction within this vault's memory boundary"
    };

    const erasureDigest = createHash('sha256').update(canonicalJSON(certPayload), 'utf8').digest('hex');
    const certificate = { ...certPayload, erasureDigest };

    this._entries.delete(keyId);
    this._certificates.set(keyId, certificate);

    return { ok: true, certificate };
  }
}
