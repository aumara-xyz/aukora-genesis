import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJSON } from './canonical.mjs';

/**
 * TCB Manifest: Unsigned cryptographic digest manifest over all decision code.
 * NOTE: This is a drift detector, not an execution boundary.
 */

function scanDir(dir, fileList = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      scanDir(full, fileList);
    } else if (entry.endsWith('.mjs') || entry.endsWith('.js') || entry.endsWith('.json')) {
      fileList.push(full);
    }
  }
  return fileList;
}

export function generateTCBManifest(srcDir) {
  const base = resolve(srcDir);
  const files = scanDir(base).sort();
  const fileDigests = {};

  for (const file of files) {
    const rel = file.slice(base.length + 1).replace(/\\/g, '/');
    const content = readFileSync(file);
    fileDigests[rel] = createHash('sha256').update(content).digest('hex');
  }

  const manifestCanonical = canonicalJSON(fileDigests);
  const tcbDigest = createHash('sha256').update(manifestCanonical, 'utf8').digest('hex');

  return {
    domain: 'aukora:tcb-manifest:v2',
    label: 'drift-detector',
    tcbDigest,
    files: fileDigests
  };
}

export function verifyTCBManifest(srcDir, expectedTcbDigest) {
  const current = generateTCBManifest(srcDir);
  if (expectedTcbDigest && current.tcbDigest !== expectedTcbDigest) {
    return { ok: false, reason: 'tcb:drift-detected', currentDigest: current.tcbDigest, expectedDigest: expectedTcbDigest };
  }
  return { ok: true, tcbDigest: current.tcbDigest, fileCount: Object.keys(current.files).length };
}
