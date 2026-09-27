// Types for identity.mjs.
//
// The witness modules are `.mjs` on purpose — they arrived from aukora-seed as plain ESM with zero
// dependencies and no build step, and they run under bare `node` in a hook, where a TypeScript
// toolchain may not exist. That property is worth keeping, so the types live beside the module rather
// than the module being rewritten to satisfy the tests that read it.

export interface RepoIdentity {
  /** 32 hex chars of sha256(origin + ' ' + root-commit), or null when there is no git identity. */
  id: string | null;
  source: 'origin+root-commit' | 'root-commit' | 'none';
  origin: string;
  first: string;
}

export interface ChainHome {
  file: string;
  /** Why the chain is where it is — shown to the owner rather than silently surprising them. */
  why: string;
  /** False only for directories with no identity that survives a rename. */
  outside: boolean;
}

export function repoIdentity(repoRoot: string): RepoIdentity;
export function chainsDir(home?: string): string;
export function chainHome(repoRoot: string, opts?: { home?: string; env?: Record<string, string | undefined> }): ChainHome;
export function migrateIfNeeded(
  repoRoot: string,
  home?: string,
  env?: Record<string, string | undefined>,
): { migrated: boolean; why?: string; from?: string; to?: string };
