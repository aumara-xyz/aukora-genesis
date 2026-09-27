import type { Operation, WorkspacePatchOperation } from './operation.mjs'
import type { WorkspacePatchArgs } from './workspace-patch-args.mjs'

/** Escape a review string unambiguously; controls become explicit escapes. */
export declare function escapeForReview(text: string): string

/** The deterministic review artifact as its individual printable-ASCII lines. */
export declare function reviewProjectionLines(operation: Operation | WorkspacePatchOperation, args: { key: string; value: unknown } | WorkspacePatchArgs): readonly string[]

/** Render the deterministic multi-line review artifact for one operation. */
export declare function renderOperation(operation: Operation | WorkspacePatchOperation, args: { key: string; value: unknown } | WorkspacePatchArgs): string
