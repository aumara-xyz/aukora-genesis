/** Exact bytes and expected prior state of a single named workspace file. */
export interface WorkspacePatchArgs {
  workspace: string
  path: string
  beforeSha256: string | null
  content: string
}

/** Maximum UTF-8 bytes accepted in a proposed or existing file. */
export declare const MAX_WORKSPACE_PATCH_BYTES: number

/** Operator-defined workspace names do not contain filesystem syntax. */
export declare const WORKSPACE_NAME_SHAPE: RegExp

/** Capture validated data properties without invoking argument getters. */
export declare function captureWorkspacePatchArgs(input: unknown): WorkspacePatchArgs | null

/** Test the exact fields, portable path, expected digest, and UTF-8 byte limit. */
export declare function isExactWorkspacePatchArgs(input: unknown): input is WorkspacePatchArgs

/** Return the unchanged proposed file content; throws on invalid arguments. */
export declare function workspacePatchBody(args: WorkspacePatchArgs): string
