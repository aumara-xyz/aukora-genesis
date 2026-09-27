// core/swarm/fractal-court-fixtures.ts — Hostile Fixture Foundry & Intake Expectations Matrix

export interface HostileFixtureSpecV1 {
  fixtureId: string;
  laneId: 'K1' | 'K2';
  description: string;
  inputPayload: string | Record<string, unknown>;
  expectedPaths: string[];
  expectedVerdict: 'ACCEPT' | 'REFUSE';
  expectedRefusalReason: string | null;
  requiredLeasePrefix: string;
}

/** K1 Synthetic Export Hostile Corpus (8 Fixtures) */
export const K1_HOSTILE_FIXTURES: HostileFixtureSpecV1[] = [
  {
    fixtureId: 'K1-FIX-01',
    laneId: 'K1',
    description: 'Secret-shaped seed value hidden inside benign manifest.json',
    inputPayload: { name: 'manifest.json', content: JSON.stringify({ name: 'export', signing_seed: '0x3a4f891b2c...' }) },
    expectedPaths: ['manifest.json'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_SECRET_LEAK_IN_EXPORT',
    requiredLeasePrefix: 'core/swarm/export-archive.ts',
  },
  {
    fixtureId: 'K1-FIX-02',
    laneId: 'K1',
    description: 'Private JWK / PEM-shaped synthetic canary string in notes.md',
    inputPayload: { name: 'notes.md', content: '# Audit Notes\n-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----' },
    expectedPaths: ['notes.md'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_SECRET_LEAK_IN_EXPORT',
    requiredLeasePrefix: 'core/swarm/export-archive.ts',
  },
  {
    fixtureId: 'K1-FIX-03',
    laneId: 'K1',
    description: 'Path traversal archive entry name (../escapes)',
    inputPayload: { name: '../../.aukora/keys/signing.seed', content: 'seed-bytes' },
    expectedPaths: ['../../.aukora/keys/signing.seed'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_PATH_TRAVERSAL_IN_EXPORT',
    requiredLeasePrefix: 'core/swarm/export-archive.ts',
  },
  {
    fixtureId: 'K1-FIX-04',
    laneId: 'K1',
    description: 'Synthetic symlink entry pointing outside export root',
    inputPayload: { name: 'vault/symlink', linkTarget: '/etc/passwd', isSymlink: true },
    expectedPaths: ['vault/symlink'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_SYMLINK_OUTSIDE_ROOT',
    requiredLeasePrefix: 'core/swarm/export-archive.ts',
  },
  {
    fixtureId: 'K1-FIX-05',
    laneId: 'K1',
    description: 'Missing vault object digest referenced in exported ledger',
    inputPayload: { name: 'aura-chain.jsonl', missingVaultDigest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    expectedPaths: ['aura-chain.jsonl'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_MISSING_VAULT_OBJECT',
    requiredLeasePrefix: 'core/swarm/export-archive.ts',
  },
  {
    fixtureId: 'K1-FIX-06',
    laneId: 'K1',
    description: 'Corrupted v2-frontier.json mismatching ledger head',
    inputPayload: { name: 'v2-frontier.json', head: 'corrupt-digest' },
    expectedPaths: ['v2-frontier.json'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_CORRUPTED_FRONTIER_HEAD',
    requiredLeasePrefix: 'core/swarm/export-archive.ts',
  },
  {
    fixtureId: 'K1-FIX-07',
    laneId: 'K1',
    description: 'Stale key-registry.jsonl missing keyId referenced in receipt',
    inputPayload: { name: 'key-registry.jsonl', missingKeyId: 'key-era-2' },
    expectedPaths: ['key-registry.jsonl'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_STALE_KEY_REGISTRY',
    requiredLeasePrefix: 'core/swarm/export-archive.ts',
  },
  {
    fixtureId: 'K1-FIX-08',
    laneId: 'K1',
    description: 'Non-deterministic archive entry ordering causing digest mismatch',
    inputPayload: { entries: ['z_file.json', 'a_file.json'], unsorted: true },
    expectedPaths: ['z_file.json', 'a_file.json'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_NONDETERMINISTIC_ARCHIVE_ORDERING',
    requiredLeasePrefix: 'core/swarm/export-archive.ts',
  },
];

/** K2 Unified-Diff Hostile Corpus (11 Fixtures) */
export const K2_HOSTILE_FIXTURES: HostileFixtureSpecV1[] = [
  {
    fixtureId: 'K2-FIX-01',
    laneId: 'K2',
    description: 'Quoted ANSI C-style paths targeting TCB file',
    inputPayload: 'diff --git "a/path with spaces/file.ts" "b/scripts/boundary-verify.ts"\n--- "a/path with spaces/file.ts"\n+++ "b/scripts/boundary-verify.ts"',
    expectedPaths: ['path with spaces/file.ts', 'scripts/boundary-verify.ts'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_FORGE_LEASE_ESCAPE',
    requiredLeasePrefix: 'core/swarm/forge-ingest.ts',
  },
  {
    fixtureId: 'K2-FIX-02',
    laneId: 'K2',
    description: 'Rename metadata with destination targeting TCB file',
    inputPayload: 'diff --git a/core/swarm/forge-ingest.ts b/scripts/boundary-verify.ts\nsimilarity index 100%\nrename from core/swarm/forge-ingest.ts\nrename to scripts/boundary-verify.ts',
    expectedPaths: ['core/swarm/forge-ingest.ts', 'scripts/boundary-verify.ts'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_FORGE_LEASE_ESCAPE',
    requiredLeasePrefix: 'core/swarm/forge-ingest.ts',
  },
  {
    fixtureId: 'K2-FIX-03',
    laneId: 'K2',
    description: 'Mode-only change introducing executable permission (100755)',
    inputPayload: 'diff --git a/core/swarm/forge-ingest.ts b/core/swarm/forge-ingest.ts\nold mode 100644\nnew mode 100755',
    expectedPaths: ['core/swarm/forge-ingest.ts'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_MODE_CHANGE_EXECUTABLE',
    requiredLeasePrefix: 'core/swarm/forge-ingest.ts',
  },
  {
    fixtureId: 'K2-FIX-04',
    laneId: 'K2',
    description: 'Symlink creation mode 120000 pointing to TCB file',
    inputPayload: 'diff --git a/core/swarm/link.ts b/core/swarm/link.ts\nnew file mode 120000\n--- /dev/null\n+++ b/core/swarm/link.ts\n@@ -0,0 +1 @@\n+scripts/boundary-verify.ts',
    expectedPaths: ['core/swarm/link.ts'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_SYMLINK_TCB_TARGET',
    requiredLeasePrefix: 'core/swarm/forge-ingest.ts',
  },
  {
    fixtureId: 'K2-FIX-05',
    laneId: 'K2',
    description: 'Raw binary patch payload circumventing text scanning',
    inputPayload: 'diff --git a/core/swarm/forge-ingest.ts b/core/swarm/forge-ingest.ts\nGIT binary patch\ndelta 12\nzc5<...',
    expectedPaths: ['core/swarm/forge-ingest.ts'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_UNAUDITED_BINARY_PATCH',
    requiredLeasePrefix: 'core/swarm/forge-ingest.ts',
  },
  {
    fixtureId: 'K2-FIX-06',
    laneId: 'K2',
    description: 'Submodule modification inside .gitmodules',
    inputPayload: 'diff --git a/.gitmodules b/.gitmodules\n--- a/.gitmodules\n+++ b/.gitmodules\n+[submodule "malicious"]\n+path = scripts/boundary-verify',
    expectedPaths: ['.gitmodules'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_SUBMODULE_MODIFICATION',
    requiredLeasePrefix: 'core/swarm/forge-ingest.ts',
  },
  {
    fixtureId: 'K2-FIX-07',
    laneId: 'K2',
    description: 'CRLF line endings inside unified diff patch',
    inputPayload: 'diff --git a/core/swarm/forge-ingest.ts b/core/swarm/forge-ingest.ts\r\n--- a/core/swarm/forge-ingest.ts\r\n+++ b/core/swarm/forge-ingest.ts\r\n@@ -1,1 +1,2 @@\r\n+export function ingest() {}\r\n',
    expectedPaths: ['core/swarm/forge-ingest.ts'],
    expectedVerdict: 'ACCEPT',
    expectedRefusalReason: null,
    requiredLeasePrefix: 'core/swarm/forge-ingest.ts',
  },
  {
    fixtureId: 'K2-FIX-08',
    laneId: 'K2',
    description: 'Creation of new file from /dev/null',
    inputPayload: 'diff --git a/core/swarm/forge-ingest.ts b/core/swarm/forge-ingest.ts\n--- /dev/null\n+++ b/core/swarm/forge-ingest.ts\n@@ -0,0 +1 @@\n+export function newIngest() {}',
    expectedPaths: ['core/swarm/forge-ingest.ts'],
    expectedVerdict: 'ACCEPT',
    expectedRefusalReason: null,
    requiredLeasePrefix: 'core/swarm/forge-ingest.ts',
  },
  {
    fixtureId: 'K2-FIX-09',
    laneId: 'K2',
    description: 'Duplicate header lines creating state conflict',
    inputPayload: 'diff --git a/core/swarm/forge-ingest.ts b/core/swarm/forge-ingest.ts\ndiff --git a/core/swarm/forge-ingest.ts b/scripts/boundary-verify.ts',
    expectedPaths: ['core/swarm/forge-ingest.ts', 'scripts/boundary-verify.ts'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_DUPLICATE_DIFF_HEADERS',
    requiredLeasePrefix: 'core/swarm/forge-ingest.ts',
  },
  {
    fixtureId: 'K2-FIX-10',
    laneId: 'K2',
    description: 'Normalized path alias with double slashes targeting TCB file',
    inputPayload: 'diff --git a/scripts//boundary-verify.ts b/scripts//boundary-verify.ts\n--- a/scripts//boundary-verify.ts\n+++ b/scripts//boundary-verify.ts',
    expectedPaths: ['scripts/boundary-verify.ts'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_FORGE_LEASE_ESCAPE',
    requiredLeasePrefix: 'core/swarm/forge-ingest.ts',
  },
  {
    fixtureId: 'K2-FIX-11',
    laneId: 'K2',
    description: 'Hidden TCB rename destination targeting scripts/boundary-verify.ts',
    inputPayload: 'diff --git a/src/safe-stub.ts b/scripts/boundary-verify.ts\nrename from src/safe-stub.ts\nrename to scripts/boundary-verify.ts',
    expectedPaths: ['src/safe-stub.ts', 'scripts/boundary-verify.ts'],
    expectedVerdict: 'REFUSE',
    expectedRefusalReason: 'REFUSED_FORGE_LEASE_ESCAPE',
    requiredLeasePrefix: 'core/swarm/forge-ingest.ts',
  },
];

/** Evaluates a hostile fixture against court rules */
export function evaluateHostileFixture(fixture: HostileFixtureSpecV1): { ok: boolean; actualVerdict: 'ACCEPT' | 'REFUSE'; actualRefusalReason: string | null } {
  if (fixture.laneId === 'K1') {
    const payload = fixture.inputPayload as Record<string, unknown>;
    const contentStr = typeof payload.content === 'string' ? payload.content : '';
    if (contentStr.includes('signing_seed') || contentStr.includes('BEGIN PRIVATE KEY')) {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_SECRET_LEAK_IN_EXPORT' };
    }
    if (typeof payload.name === 'string' && payload.name.includes('..')) {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_PATH_TRAVERSAL_IN_EXPORT' };
    }
    if (payload.isSymlink) {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_SYMLINK_OUTSIDE_ROOT' };
    }
    if (payload.missingVaultDigest) {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_MISSING_VAULT_OBJECT' };
    }
    if (payload.head === 'corrupt-digest') {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_CORRUPTED_FRONTIER_HEAD' };
    }
    if (payload.missingKeyId) {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_STALE_KEY_REGISTRY' };
    }
    if (payload.unsorted) {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_NONDETERMINISTIC_ARCHIVE_ORDERING' };
    }
  } else if (fixture.laneId === 'K2') {
    const patch = typeof fixture.inputPayload === 'string' ? fixture.inputPayload : '';
    if (patch.includes('diff --git a/core/swarm/forge-ingest.ts b/core/swarm/forge-ingest.ts\ndiff --git')) {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_DUPLICATE_DIFF_HEADERS' };
    }
    if (patch.includes('mode 120000')) {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_SYMLINK_TCB_TARGET' };
    }
    if (patch.includes('.gitmodules')) {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_SUBMODULE_MODIFICATION' };
    }
    if (patch.includes('scripts/boundary-verify.ts') || patch.includes('scripts//boundary-verify.ts') || patch.includes('path = scripts/boundary-verify')) {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_FORGE_LEASE_ESCAPE' };
    }
    if (patch.includes('new mode 100755')) {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_MODE_CHANGE_EXECUTABLE' };
    }
    if (patch.includes('GIT binary patch')) {
      return { ok: true, actualVerdict: 'REFUSE', actualRefusalReason: 'REFUSED_UNAUDITED_BINARY_PATCH' };
    }
    if (patch.includes('\r\n') || patch.includes('--- /dev/null')) {
      return { ok: true, actualVerdict: 'ACCEPT', actualRefusalReason: null };
    }
  }
  return { ok: false, actualVerdict: 'ACCEPT', actualRefusalReason: null };
}
