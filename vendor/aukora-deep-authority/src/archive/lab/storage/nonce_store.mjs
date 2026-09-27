import { closeSync, existsSync, mkdirSync, openSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const NONCE_DIR = 'nonces';

/**
 * NonceStore: Atomic durable single-use nonce burning via O_EXCL ('wx').
 */
export class NonceStore {
  constructor({ baseDir, rootDir = '.aukora' } = {}) {
    this.rootDir = resolve(baseDir || rootDir);
    this.dir = join(this.rootDir, NONCE_DIR);
    this.inMemorySet = new Set();
  }

  init() {
    mkdirSync(this.dir, { recursive: true });
    this.inMemorySet.clear();
    for (const name of readdirSync(this.dir)) {
      const dashIdx = name.indexOf('-');
      if (dashIdx === -1) {
        if (name.endsWith('.claim')) this.inMemorySet.add(name.slice(0, -6));
        continue;
      }
      const nonce = name.slice(dashIdx + 1);
      if (nonce) this.inMemorySet.add(nonce);
    }
    return this;
  }

  has(nonce) {
    if (this.inMemorySet.has(nonce)) return true;
    try {
      if (!existsSync(this.dir)) return false;
      return readdirSync(this.dir).some(e => e.endsWith(`-${nonce}`) || e === `${nonce}.claim`);
    } catch {
      return false;
    }
  }

  claim(nonce, exp) {
    if (!nonce || typeof nonce !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(nonce)) return false;
    this.inMemorySet.add(nonce);
    mkdirSync(this.dir, { recursive: true });

    let fd;
    try {
      fd = openSync(join(this.dir, `${exp}-${nonce}`), 'wx', 0o600);
    } catch {
      return false; // EEXIST -> lost race / already claimed
    }
    try {
      writeFileSync(fd, `${JSON.stringify({ nonce, exp, pid: process.pid, ts: Date.now() })}\n`, 'utf8');
    } finally {
      closeSync(fd);
    }
    return true;
  }

  sweepExpired(nowMs = Date.now()) {
    if (!existsSync(this.dir)) return 0;
    let swept = 0;
    for (const name of readdirSync(this.dir)) {
      const dashIdx = name.indexOf('-');
      if (dashIdx === -1) continue;
      const expVal = Number(name.slice(0, dashIdx));
      if (!Number.isFinite(expVal)) continue;
      const expMs = expVal > 1e11 ? expVal : expVal * 1000;
      if (expMs <= nowMs) {
        try {
          unlinkSync(join(this.dir, name));
          swept++;
          const nonce = name.slice(dashIdx + 1);
          if (nonce) this.inMemorySet.delete(nonce);
        } catch {}
      }
    }
    return swept;
  }
}

export function openNonceBook(stateDir, { now = () => Date.now() } = {}) {
  const store = new NonceStore({ baseDir: stateDir });
  store.init();
  return {
    set: store.inMemorySet,
    claim: (nonce, exp) => store.claim(nonce, exp),
    has: (nonce) => store.has(nonce),
    sweep: (nowMs) => store.sweepExpired(nowMs)
  };
}
