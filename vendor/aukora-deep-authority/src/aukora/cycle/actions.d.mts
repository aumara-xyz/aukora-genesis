/** Closed action names for cycle proposal v1. */
export declare const CYCLE_ACTIONS: readonly ['workspace.read', 'workspace.write', 'cycle.delegate', 'cycle.finish', 'cycle.abstain']

/** Workspace alias under which the demo workspace is published to the broker. */
export declare const CYCLE_WORKSPACE_ALIAS: 'lab'

/** A named action-refusal; every refusal carries one stable code. */
export declare class CycleActionError extends Error {
  /** Stable machine-readable refusal code, e.g. `cycle.action:path-escape`. */
  readonly code: string
  constructor(code: string, message: string)
}

/** One validated proposal: exactly one allowlisted action and its args. */
export type CycleValidatedProposal = Readonly<{
  action: 'workspace.read' | 'workspace.write' | 'cycle.delegate' | 'cycle.finish' | 'cycle.abstain'
  args: Readonly<Record<string, unknown>>
}>

/** Exact workspace.patch arguments for one validated write proposal. */
export type CycleWorkspacePatch = Readonly<{
  args: Readonly<{
    workspace: string
    path: string
    beforeSha256: string | null
    content: string
  }>
}>

/**
 * Confine one workspace-relative path beneath a canonical root and return
 * the resolved absolute path. Refuses traversal, absolute input, and every
 * escape spelled by the path grammar.
 */
export declare function confineWorkspacePath(root: string, relative: string): string

/**
 * Read one workspace file without following symbolic links.
 * Missing files refuse by name; the returned content is the exact bytes read.
 */
export declare function readWorkspaceFile(root: string, relative: string): {
  path: string
  sha256: string
  bytes: number
  content: string
}

/**
 * Build the exact workspace.patch arguments for one proposed write. The
 * preimage digest comes from the current bytes; publication stays with the
 * broker's workspace.patch effect.
 */
export declare function buildWorkspacePatch(
  root: string,
  proposal: { action: string; args: Record<string, unknown> },
): CycleWorkspacePatch

/**
 * Validate one model-proposed action against the allowlist, the worker
 * registry, the task registry, the nesting depth, and the request budget.
 * Returns the detached validated proposal or one named refusal.
 */
export declare function validateProposal(input: unknown, context: {
  workers: Readonly<Record<string, { maxCycles: number }>>
  tasks: Readonly<Record<string, { role: string; worker: string | null }>>
  depth: number
  requestsRemaining: number
}): Readonly<{ ok: true; proposal: CycleValidatedProposal }> | Readonly<{ ok: false; reason: string }>
