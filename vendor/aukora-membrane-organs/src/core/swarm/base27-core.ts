// core/swarm/base27-core.ts — Base-27 Ternary Coordinate Core & Pure JS Reference
//
// Hardware-independent 27-cell 3D ternary coordinate system (3^3 = 27 cells).
// Provides canonical trit encoding, decoding, Manhattan shell distance from center (1,1,1),
// and bit-corner mapping.
//
// Status: REAL MATH / STAGED RESEARCH / NO PRODUCTION CALLERS

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const BASE27_EXPECTED_WASM_DIGEST = '5b592c8e37fe259bb3630b8f8445430e51a75cecc44474270a5e58b1080ad9dd';
export const BASE27_EXPECTED_BYTE_SIZE = 13040;
export const BASE27_CENTER_ADDRESS = 13; // (1, 1, 1) = 1*9 + 1*3 + 1 = 13

export const STAGED_LOADER_PATH = 'organs/research/dist/core.wasm';
export const ACTUAL_ARTIFACT_PATH = 'organs/research/core.wasm';

export interface Trit3V1 {
  t2: number; // 0, 1, 2 (outer dimension)
  t1: number; // 0, 1, 2 (middle dimension)
  t0: number; // 0, 1, 2 (inner dimension)
}

/** Pure JS Canonical Reference Implementation */
export const Base27JsReference = {
  encode(t2: number, t1: number, t0: number): number {
    if (![0, 1, 2].includes(t2) || ![0, 1, 2].includes(t1) || ![0, 1, 2].includes(t0)) return -1;
    return t2 * 9 + t1 * 3 + t0;
  },

  trit(addr: number, idx: number): number {
    if (addr < 0 || addr > 26 || ![0, 1, 2].includes(idx)) return -1;
    if (idx === 0) return addr % 3;
    if (idx === 1) return Math.floor(addr / 3) % 3;
    if (idx === 2) return Math.floor(addr / 9);
    return -1;
  },

  decode(addr: number): Trit3V1 | null {
    if (addr < 0 || addr > 26) return null;
    return {
      t2: Math.floor(addr / 9),
      t1: Math.floor(addr / 3) % 3,
      t0: addr % 3,
    };
  },

  shell(addr: number): number {
    if (addr < 0 || addr > 26) return -1;
    const t = this.decode(addr);
    if (!t) return -1;
    return Math.abs(t.t2 - 1) + Math.abs(t.t1 - 1) + Math.abs(t.t0 - 1);
  },

  distance(a: number, b: number): number {
    if (a < 0 || a > 26 || b < 0 || b > 26) return -1;
    const tA = this.decode(a);
    const tB = this.decode(b);
    if (!tA || !tB) return -1;
    return Math.abs(tA.t2 - tB.t2) + Math.abs(tA.t1 - tB.t1) + Math.abs(tA.t0 - tB.t0);
  },

  centre(): number {
    return BASE27_CENTER_ADDRESS;
  },

  fromBits(bits: number): number {
    if (bits < 0 || bits > 7) return -1;
    const b2 = (bits & 4) ? 2 : 0;
    const b1 = (bits & 2) ? 2 : 0;
    const b0 = (bits & 1) ? 2 : 0;
    return this.encode(b2, b1, b0);
  },

  coreGrantsAuthority(): number {
    return 0; // Pure mathematics: ZERO authority granted
  },
};

/** Loads and verifies organs/research/core.wasm */
export function loadBase27WasmInstance(repoRoot: string = process.cwd()) {
  const artifactPath = join(repoRoot, ACTUAL_ARTIFACT_PATH);
  if (!existsSync(artifactPath)) {
    throw new Error(`MISSING_WASM_ARTIFACT: ${artifactPath} not found`);
  }

  const buf = readFileSync(artifactPath);
  const actualDigest = createHash('sha256').update(buf).digest('hex');

  if (actualDigest !== BASE27_EXPECTED_WASM_DIGEST) {
    throw new Error(`DIGEST_MISMATCH: expected ${BASE27_EXPECTED_WASM_DIGEST}, found ${actualDigest}`);
  }

  const mod = new WebAssembly.Module(buf);
  const instance = new WebAssembly.Instance(mod, { env: { abort() {} } });
  return { instance, exports: instance.exports as any, digest: actualDigest, byteSize: buf.length };
}
