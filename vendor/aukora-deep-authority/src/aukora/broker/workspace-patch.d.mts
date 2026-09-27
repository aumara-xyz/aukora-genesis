import type { WorkspacePatchArgs } from './workspace-patch-args.mjs'

export { isExactWorkspacePatchArgs, MAX_WORKSPACE_PATCH_BYTES, WORKSPACE_NAME_SHAPE, workspacePatchBody } from './workspace-patch-args.mjs'
export type { WorkspacePatchArgs } from './workspace-patch-args.mjs'

/** Expected or observed evidence for a bounded workspace file. */
export interface WorkspacePatchEvidence {
  path: string
  bytes: number
  contentSha256: string
}

/** Check configured roots, existing parents, and expected prior bytes without writing. */
export declare function preflightWorkspacePatch(
  roots: Readonly<Record<string, string>>,
  args: WorkspacePatchArgs,
): WorkspacePatchEvidence

/** Publish and re-open a 0600 file; a thrown post-publication error does not imply rollback. */
export declare function workspacePatch(
  roots: Readonly<Record<string, string>>,
  args: WorkspacePatchArgs,
): WorkspacePatchEvidence & { inode: number; mtimeNs: string }
