import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, generateKeyPairSync } from 'node:crypto';
import { exportPublicKeyPem, exportPublicKeyHex, importPrivateKey, importPublicKey } from './verify.mjs';

/**
 * Aumlok: Ephemeral root key ceremony and phrase-wrapped key custody.
 * No hardcoded keys, zero plaintext key leakage.
 */

export function genesisLabRoot(phrase = 'aukora lab genesis root authority phrase') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(phrase, salt, 10000, 32, 'sha256');

  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(privDer), cipher.final()]);
  const tag = cipher.getAuthTag();

  const rootFile = {
    domain: 'aukora:aumlok:v2',
    publicKeyPem: exportPublicKeyPem(publicKey),
    publicKeyHex: exportPublicKeyHex(publicKey),
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: encrypted.toString('hex')
  };

  return {
    rootFile,
    publicKey,
    publicKeyHex: rootFile.publicKeyHex,
    publicKeyPem: rootFile.publicKeyPem
  };
}

export function unwrapRoot(rootFile, phrase) {
  if (!rootFile || !rootFile.ciphertext || !rootFile.salt || !rootFile.iv || !rootFile.tag) {
    return { ok: false, reason: 'aumlok:malformed-root-file' };
  }

  try {
    const salt = Buffer.from(rootFile.salt, 'hex');
    const iv = Buffer.from(rootFile.iv, 'hex');
    const tag = Buffer.from(rootFile.tag, 'hex');
    const ciphertext = Buffer.from(rootFile.ciphertext, 'hex');

    const key = pbkdf2Sync(phrase, salt, 10000, 32, 'sha256');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const privKey = importPrivateKey(decrypted);

    return { ok: true, key: privKey, publicKeyHex: rootFile.publicKeyHex };
  } catch {
    return { ok: false, reason: 'aumlok:phrase-incorrect-or-corrupt' };
  }
}
