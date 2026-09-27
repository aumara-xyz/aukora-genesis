import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { canonicalJSON } from '../kernel/canonical.mjs';

export const CHAIN_FILE = 'chain.jsonl';
export const GENESIS_PREV = '0'.repeat(64);

export function hashOf(prev, body) {
  const preimage = Buffer.from(`${prev}${canonicalJSON(body)}`, 'utf8');
  return createHash('sha256').update(preimage).digest('hex');
}

/**
 * Hash-linked receipt chain (Aura as the Record).
 * The reader grants NO authority (`grantsAuthority(): false`). It is purely an immutable audit record.
 */
export class AuraChain {
  constructor({ rootDir = '.aukora' } = {}) {
    this.filePath = join(rootDir, CHAIN_FILE);
  }

  grantsAuthority() {
    return false;
  }

  append(body, signFn) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const head = this.readHead();
    const hash = hashOf(head.prev, body);
    let sig = null;
    if (typeof signFn === 'function') {
      try { sig = signFn(hash); } catch {}
    }

    const entry = { ...body, prev: head.prev, hash, sig };
    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  readHead() {
    if (!existsSync(this.filePath)) return { prev: GENESIS_PREV, count: 0 };
    const lines = readFileSync(this.filePath, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length === 0) return { prev: GENESIS_PREV, count: 0 };
    const last = JSON.parse(lines[lines.length - 1]);
    return { prev: last.hash, count: lines.length };
  }

  readAll() {
    if (!existsSync(this.filePath)) return [];
    return readFileSync(this.filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }

  getTail(n = 50) {
    const all = this.readAll();
    return all.slice(-n);
  }

  verifyIntegrity() {
    const entries = this.readAll();
    let prev = GENESIS_PREV;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.prev !== prev) {
        return { valid: false, reason: `Chain broken at index ${i}: prev ${e.prev} != ${prev}`, index: i };
      }
      const { prev: _p, hash: currentHash, sig: _s, ...body } = e;
      const expectedHash = hashOf(prev, body);
      if (currentHash !== expectedHash) {
        return { valid: false, reason: `Hash mismatch at index ${i}: ${currentHash} != ${expectedHash}`, index: i };
      }
      prev = currentHash;
    }
    return { valid: true, count: entries.length, head: prev };
  }
}
