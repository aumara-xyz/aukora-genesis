/**
 * Opt-in workspace replacement proposals over the parent-selected broker socket.
 * The broker owns approval and execution. This adapter returns its terminal
 * result and receipt without independently verifying settlement evidence.
 * @module @deepseek-ai/dsh-aukora-memory/workspace-patch
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { WORKSPACE_PATCH } from '@aukora/core/broker/effect-definition.mjs'
import { captureWorkspacePatchArgs, workspacePatchBody } from '@aukora/core/broker/workspace-patch-args.mjs'
import { BrokerProposalClient, ProposalOutcomeError, type ProposalTerminalResult } from './proposal-client.ts'

/** Cordis plugin identity for the opt-in workspace tool. */
export const name = 'aukora-workspace-patch'

/** The tool registers only when the host supplies a tool registry. */
export const inject = ['tools']

/** Parent-selected proposal route and local review bounds. */
export interface Config {
  /** Unix socket of the broker that owns workspace approval and execution. */
  brokerSocket: string
  /** Poll cadence for accepted proposals, in milliseconds. Defaults to 50. */
  proposalPollIntervalMs?: number
  /** Maximum replacement UTF-8 bytes submitted for review. Defaults to 8192. */
  reviewLimitBytes?: number
}

/** Loader validation and defaults; the broker enforces its own independent limits. */
export const Config: z<Config> = z.object({
  brokerSocket: z.string().min(1).required(),
  proposalPollIntervalMs: z.number().step(1).min(1).max(1000).default(50),
  reviewLimitBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8192),
})

/**
 * Register one workspace.patch tool and own its proposal observation lifetime.
 * Unloading removes the tool and stops observation; an accepted proposal remains
 * broker-owned, so cancellation does not imply that a replacement was rolled back.
 * @param ctx - plugin context carrying the tool registry.
 * @param config - parent-selected socket, poll cadence, and replacement byte limit.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = Config(config) as Required<Config>
  const client = new BrokerProposalClient({
    socketPath: resolved.brokerSocket,
    pollIntervalMs: resolved.proposalPollIntervalMs,
  })
  const pending = new Set<Promise<ProposalTerminalResult>>()
  ctx.effect(() => async () => {
    client.close()
    await Promise.allSettled(pending)
  }, 'aukora-workspace-patch: stop proposal observation')

  ctx.tools.register(defineTool({
    name: WORKSPACE_PATCH,
    description: 'Replace one UTF-8 file in a configured workspace after approval of the exact replacement. Supply the current SHA-256 digest, or null to create only.',
    parameters: {
      workspace: { type: 'string', required: true, description: 'Configured workspace name.' },
      path: { type: 'string', required: true, description: 'Relative file path within the configured workspace.' },
      beforeSha256: {
        required: true,
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: 'SHA-256 of the current file bytes, or null if the file must not exist.',
      },
      content: { type: 'string', required: true, description: 'Complete replacement UTF-8 text, including any desired final newline.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    presentCall: () => ({ card: 'generic', title: WORKSPACE_PATCH }),
    presentResult: (_args, result) => ({ card: 'generic', title: WORKSPACE_PATCH, content: result.content }),
    async execute(args, exec) {
      const captured = captureWorkspacePatchArgs(args)
      if (captured === null) {
        throw new HarnessError('workspace.patch refused: arguments-not-exact', 'AUKORA_WORKSPACE_REFUSED')
      }
      const bytes = Buffer.byteLength(workspacePatchBody(captured), 'utf8')
      if (bytes > resolved.reviewLimitBytes) {
        throw new HarnessError(
          `workspace.patch refused: replacement is ${String(bytes)} bytes and exceeds the ${String(resolved.reviewLimitBytes)}-byte review limit`,
          'AUKORA_WORKSPACE_REFUSED',
        )
      }
      const proposal = client.settleWorkspacePatch(String(exec.callId), captured, exec.signal)
      pending.add(proposal)
      try {
        return await proposal as JsonValue
      } catch (error: unknown) {
        if (error instanceof ProposalOutcomeError) {
          const uncertain = error.state === 'INDETERMINATE'
          throw new HarnessError(
            `workspace.patch ${uncertain ? 'indeterminate' : 'refused'}: ${error.message}`,
            uncertain ? 'AUKORA_WORKSPACE_INDETERMINATE' : 'AUKORA_WORKSPACE_REFUSED',
            { cause: error },
          )
        }
        throw error
      } finally {
        pending.delete(proposal)
      }
    },
  }))
}
