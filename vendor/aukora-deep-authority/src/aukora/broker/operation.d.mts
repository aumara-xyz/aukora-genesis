interface OperationEvidence {
  tool: string
  bytes: number
  contentSha256: string
  definitionId: string
  exp: number
  oneUse: boolean
}

export interface Operation extends OperationEvidence { key: string }
export interface WorkspacePatchOperation extends OperationEvidence {
  tool: 'workspace.patch'
  workspace: string
  path: string
  beforeSha256: string | null
}

export { KEY_SHAPE } from './memory-put-args.mjs'

export declare function effectBody(args: { key: string; value: unknown }): string

export declare function buildOperation(args: { key: string; value: unknown }, exp: number): Operation
export declare function buildOperation(args: import('./workspace-patch-args.mjs').WorkspacePatchArgs, exp: number, toolName: 'workspace.patch'): WorkspacePatchOperation
export declare function buildOperation(args: { key: string; value: unknown } | import('./workspace-patch-args.mjs').WorkspacePatchArgs, exp: number, toolName: string): Operation | WorkspacePatchOperation

export declare function operationDigest(op: Operation | WorkspacePatchOperation): string
