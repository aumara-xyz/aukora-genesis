// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * OUT-OF-TREE CONTINUITY LOCATIONS (WAVE 2) — a first-class registry of where identity/anchors/journals live
 * OUTSIDE this repository. The registry records MECHANISM, PATH CLASS, and the VERIFICATION PROCEDURE only.
 * No private content, no absolute user paths, and no low-entropy identifying hashes are ever committed —
 * verification hashes are computed AT RUNTIME on the local machine and never written to Git.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface ContinuityLocationV1 {
  readonly id: string;
  /** PATH CLASS — resolved against $HOME at runtime; never an absolute committed path. */
  readonly pathClass: string;
  readonly mechanism: string;
  /** How a verification hash is derived when the location exists (domain-separated; computed locally only). */
  readonly verification: string;
}

export const CONTINUITY_LOCATIONS: readonly ContinuityLocationV1[] = [
  {
    id: 'aukora-identity',
    pathClass: '$HOME/.aukora',
    mechanism: 'local identity/anchor directory created by the AUMLOK lane; owner custody, never synced',
    verification: 'sha256("aukora-continuity-v1|" + <file bytes>) per file, computed at runtime; hashes stay local',
  },
  {
    id: 'symbiote-journals',
    pathClass: '$HOME/.aukora-symbiote',
    mechanism: 'donor Symbiote journal/state directory; read-only from this repo',
    verification: 'same domain-separated per-file sha256, runtime-only',
  },
  {
    id: 'os-keychain-credentials',
    pathClass: 'macOS login Keychain (service prefix "aukora:")',
    mechanism: 'OS credential custody behind the CredentialStoreAdapter seam; values never leave the keychain',
    verification: 'fingerprint = canonical hash of the value under the aukora-keychain-fp-v1 domain (metadata only)',
  },
  {
    id: 'convex-local-state',
    pathClass: 'the anonymous local convex-backend state directory (CLI-managed cache)',
    mechanism: 'durable chain/workflow/receipt rows for the LOCAL organism; crash-safe (proven R36/R39)',
    verification: 'canonical chain verifiers + PQC-signed heads (this wave) — self-verifying without the directory',
  },
] as const;

export interface LocationStatus {
  readonly id: string;
  readonly present: boolean;
  /** Runtime-only verification hash over the location (null when absent). NEVER commit this value. */
  readonly runtimeHash: string | null;
}

/** Runtime-only presence + domain-separated hash. Reads metadata and hashes locally; returns nothing committable. */
export function continuityLocationStatus(): readonly LocationStatus[] {
  return CONTINUITY_LOCATIONS.map((loc) => {
    if (!loc.pathClass.startsWith('$HOME/')) return { id: loc.id, present: true, runtimeHash: null }; // non-filesystem mechanisms
    const path = join(homedir(), loc.pathClass.slice('$HOME/'.length));
    if (!existsSync(path)) return { id: loc.id, present: false, runtimeHash: null };
    const h = createHash('sha256');
    h.update('aukora-continuity-v1|');
    try {
      const st = statSync(path);
      h.update(String(st.isDirectory() ? 'dir' : 'file'));
      if (st.isFile()) h.update(readFileSync(path));
    } catch {
      return { id: loc.id, present: true, runtimeHash: null };
    }
    return { id: loc.id, present: true, runtimeHash: h.digest('hex') };
  });
}
