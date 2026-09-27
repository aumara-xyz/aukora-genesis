/**
 * The one governed effect, wired to the real DSH tool-dispatch seam.
 *
 * This package holds no signing primitive, root key, or issuer route. Its
 * default path validates and deposits an inert proposal with the broker, then
 * observes only public terminal state. Exact execution arguments first pass
 * through the pinned proposal-only WebAssembly cell; only its validated,
 * detached argument snapshot reaches the broker. The broker launch parent owns
 * the load-bearing human review; a guest approval event cannot authorize v4.
 * The broker owns grant issuance, settlement, and evidence. The retained v3
 * bridge is a regression oracle used only when `issuerSocket` is configured.
 *
 * @module @deepseek-ai/dsh-aukora-memory
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { createConnection } from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool, type PreToolDecision, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MEMORY_PUT } from '@aukora/core/broker/effect-definition.mjs'
import {
  AUKORA_MEMORY_INDETERMINATE,
  AUKORA_MEMORY_REFUSED,
} from '@aukora/core/broker/public-outcome.mjs'
import { registerIssuerBridge } from './bridge.ts'
import { BrokerProposalClient, ProposalOutcomeError, requestBrokerKiraRecall, requestBrokerReceiptInspect, type ReceiptInspection } from './proposal-client.ts'
import type { BrokerKiraRecallResult } from '@aukora/core/kira/recall.mjs'
import type { KiraRecordKind } from '@aukora/core/kira/stage.mjs'
import { buildOperation, operationDigest, type Operation } from '@aukora/core/broker/operation.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from '@aukora/core/broker/memory-put-args.mjs'
import { escapeForReview, renderOperation } from '@aukora/core/broker/review.mjs'
import { proposeMemoryPutThroughCell } from './wasm-proposal.ts'
export { buildOperation, operationDigest }
export type { Operation }
export { BrokerProposalClient } from './proposal-client.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    'aukora.memory': GovernedMemoryService
  }
}

const ARGUMENTS_NOT_EXACT = 'memory.put:arguments-not-exact'
const KEY_NOT_A_NAME = 'memory.put:key-not-a-name'
export { AUKORA_MEMORY_INDETERMINATE, AUKORA_MEMORY_REFUSED }

/** Legacy v3 signed grant retained only for regression-oracle coverage. */
export interface Grant {
  toolName: string
  digest: string
  nonce: string
  exp: number
  definitionId: string
  operationDigest: string
  receiptKeyId: string
  signature: string
}

/** Plugin configuration: socket paths and the human review budget. */
export interface GovernedMemoryConfig {
  /** Path of the broker process's unix socket. */
  brokerSocket: string
  /**
   * Legacy v3 regression route. Product profiles omit this field and send only
   * inert proposals to the broker; retained courts use it to keep the retired
   * bearer family falsifiable until its oracle is extracted.
   */
  issuerSocket?: string
  /** Poll cadence for public broker proposal status, in milliseconds. */
  proposalPollIntervalMs?: number
  /**
   * Operations larger than this many bytes are REFUSED before any approval is
   * requested — a human cannot review what is not shown, so oversize never
   * truncates; it refuses. Defaults to 8192.
   */
  reviewLimitBytes?: number
}

/** Legacy v3 one-use artifact produced by the approval answerer and issuer. */
export interface GovernedTicket {
  callId: string
  agentKey: string
  operationDigest: string
  expiry: number
  grant: Grant
}

interface PendingEntry {
  agentKey: string
  executionToken: PropertyKey | undefined
  operation: Operation
  args: { key: string; value: unknown }
}

/**
 * Composition-owned state for reviewed operations. The ticket map exists only
 * for the explicit legacy v3 route; the default proposal route never writes
 * it. Both maps expire lazily, every terminal outcome cleans up, and disposal
 * clears the store.
 */
class GovernedAuthority {
  private readonly pending = new Map<string, PendingEntry>()
  private readonly tickets = new Map<string, GovernedTicket>()
  private readonly agentKeys = new WeakMap<object, string>()
  private nextAgentKey = 1

  /**
   * Stable per-agent identity for exact binding (reference-based).
   * @param agent - the agent whose stable key to return.
   * @returns the per-agent key used inside tickets and pending entries.
   */
  agentKeyOf(agent: Agent): string {
    const existing = this.agentKeys.get(agent)
    if (existing !== undefined) return existing
    const key = `agent-${String(this.nextAgentKey++)}`
    this.agentKeys.set(agent, key)
    return key
  }

  /**
   * Record one pending approved-to-be operation keyed by call id.
   * @param callId - the tool call this operation belongs to.
   * @param entry - agent key, execution token, fixed operation and args.
   */
  recordPending(callId: string, entry: PendingEntry): void {
    this.sweep()
    this.pending.set(callId, entry)
  }

  /**
   * Read the pending entry for one call without consuming it.
   * @param callId - the tool call to look up.
   * @returns the pending entry, or undefined when absent/expired.
   */
  getPending(callId: string): PendingEntry | undefined {
    this.sweep()
    return this.pending.get(callId)
  }

  /**
   * Drop the pending entry for one call (terminal-outcome cleanup).
   * @param callId - the tool call whose pending entry to drop.
   */
  deletePending(callId: string): void {
    this.pending.delete(callId)
  }

  /**
   * Store one one-use authorization artifact for its call.
   * @param ticket - the issued artifact bound to call/agent/operation/expiry.
   */
  issueTicket(ticket: GovernedTicket): void {
    this.tickets.set(ticket.callId, ticket)
  }

  /**
   * Consume the artifact for one call exactly once; reading removes it.
   * @param callId - the tool call whose artifact to consume.
   * @returns the artifact, or undefined when absent or already consumed.
   */
  takeTicket(callId: string): GovernedTicket | undefined {
    const ticket = this.tickets.get(callId)
    this.tickets.delete(callId)
    return ticket
  }

  /**
   * Unconsumed counts; both must return to zero after every terminal outcome.
   * @returns pending and ticket map sizes after an expiry sweep.
   */
  sizes(): { pending: number; tickets: number } {
    this.sweep()
    return { pending: this.pending.size, tickets: this.tickets.size }
  }

  /** Drop all pending and ticket state (plugin disposal). */
  clear(): void {
    this.pending.clear()
    this.tickets.clear()
  }

  /** Drop everything past its expiry so state can never accumulate unbounded. */
  private sweep(): void {
    const cutoff = Math.floor(Date.now() / 1000)
    for (const [callId, entry] of this.pending) {
      if (entry.operation.exp <= cutoff) this.pending.delete(callId)
    }
    for (const [callId, ticket] of this.tickets) {
      if (ticket.expiry <= cutoff) this.tickets.delete(callId)
    }
  }
}

function fail(message: string): never {
  throw new Error(`memory.put: ${message}`)
}

function refuse(message: string): never {
  throw new HarnessError(`memory.put refused: ${message}`, AUKORA_MEMORY_REFUSED)
}

function indeterminate(message: string): never {
  throw new HarnessError(`memory.put: indeterminate — ${message}`, AUKORA_MEMORY_INDETERMINATE)
}

/** Render one untrusted broker reply field without object coercion. */
function replyText(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

/**
 * The review renderer lives in `@aukora/core/broker/review.mjs`, in plain
 * JavaScript, because the issuer daemon runs under bare `node` and cannot
 * import TypeScript. Re-exported here so this package's consumers keep one
 * import site, and so this untrusted preview can never drift from the trusted
 * screen that actually authorizes the signature.
 */
export { escapeForReview, renderOperation }

/** One request over the broker endpoint's newline-delimited JSON socket. */
function brokerRequest(socketPath: string, request: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const conn = createConnection(socketPath)
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    let settled = false
    const settle = (fn: () => void) => { if (!settled) { settled = true; conn.destroy(); fn() } }
    conn.setTimeout(10000, () => { settle(() => { reject(new Error('broker timed out')) }) })
    conn.once('error', (error: Error) => { settle(() => { reject(error) }) })
    conn.once('close', () => { settle(() => { reject(new Error('broker closed without a reply')) }) })
    conn.once('connect', () => { conn.write(`${JSON.stringify(request)}\n`) })
    conn.on('data', (chunk: Buffer) => {
      buffer += decoder.write(chunk)
      let cut
      while ((cut = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 1)
        if (line.trim() === '') continue
        settle(() => {
          try { resolve(JSON.parse(line) as Record<string, unknown>) }
          catch (e) { reject(e instanceof Error ? e : new Error(String(e))) }
        })
      }
    })
  })
}

/**
 * Compose the governed memory.put path into a context.
 * @param ctx - Cordis context carrying the tool registry and approval service.
 * @param config - broker route, proposal cadence, optional legacy issuer route, and review limit.
 * @returns the composition-owned authorization store; it is not a Cordis service.
 */
export function GovernedMemory(ctx: Context, config: GovernedMemoryConfig): GovernedAuthority {
  const reviewLimitBytes = config.reviewLimitBytes ?? 8192
  const brokerSocket = config.brokerSocket
  const authority = new GovernedAuthority()
  const ownerLifetime = new AbortController()
  const proposalClient = config.issuerSocket === undefined
    ? new BrokerProposalClient({
      socketPath: brokerSocket,
      ...(config.proposalPollIntervalMs === undefined
        ? {}
        : { pollIntervalMs: config.proposalPollIntervalMs }),
    })
    : undefined
  ctx.effect(
    () => () => {
      ownerLifetime.abort('governed memory owner disposed')
      proposalClient?.close()
      authority.clear()
    },
    'aukora-memory: clear pending authority state',
  )

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== MEMORY_PUT) return next()
    if (!isExactMemoryPutArgs(exec.arguments)) {
      return { kind: 'deny', reason: ARGUMENTS_NOT_EXACT }
    }
    if (!KEY_SHAPE.test(exec.arguments.key)) {
      return { kind: 'deny', reason: KEY_NOT_A_NAME }
    }
    const exp = Math.floor(Date.now() / 1000) + 300
    const operation = buildOperation(exec.arguments, exp)
    if (operation.bytes > reviewLimitBytes) {
      // A human cannot review what is not shown: oversize refuses, never truncates.
      const reason = `memory.put refused: operation is ${String(operation.bytes)} bytes and exceeds the ${String(reviewLimitBytes)}-byte review limit; nothing was hidden or truncated`
      return { kind: 'deny', reason }
    }
    authority.recordPending(String(exec.callId), {
      agentKey: exec.agent === undefined ? '' : authority.agentKeyOf(exec.agent),
      executionToken: exec.token,
      operation,
      args: exec.arguments,
    })
    return proposalClient === undefined
      ? { kind: 'ask', reason: renderOperation(operation, exec.arguments) }
      : { kind: 'allow' }
  })

  // Every execution, including preparation and approval-audit failures that
  // bypass post-execute, emits one final tools/result observation.
  ctx.on('tools/result', (exec) => {
    const callId = String(exec.callId)
    authority.deletePending(callId)
    authority.takeTicket(callId)
  })

  // Retain the direct issuance seam only as a v3 regression oracle.
  if (config.issuerSocket !== undefined) {
    registerIssuerBridge(ctx, { issuerSocket: config.issuerSocket }, authority, ownerLifetime.signal)
  }

  ctx.tools.register(defineTool({
    name: MEMORY_PUT,
    description: 'Write one value under one name in the governed memory store. Requires parent review of the exact write before settlement.',
    parameters: {
      key: { type: 'string', required: true },
      value: { type: 'json', required: true },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const callId = String(exec.callId)
      try {
        if (!isExactMemoryPutArgs(args)) throw new Error(ARGUMENTS_NOT_EXACT)
        if (!KEY_SHAPE.test(args.key)) throw new Error(KEY_NOT_A_NAME)
        const pendingEntry = authority.getPending(callId)
        if (pendingEntry === undefined) fail('no pending approved operation for this call')
        if (pendingEntry.executionToken !== exec.token) fail('pending operation belongs to a different execution')
        if (exec.agent === undefined || pendingEntry.agentKey !== authority.agentKeyOf(exec.agent)) fail('authorization is bound to a different agent')
        if (proposalClient !== undefined) {
          const reviewed = operationDigest(pendingEntry.operation)
          const executing = operationDigest(buildOperation(args, pendingEntry.operation.exp))
          if (executing !== reviewed) fail('reviewed operation does not bind to these arguments')
          try {
            const detachedArgs = proposeMemoryPutThroughCell(args, pendingEntry.args)
            const result = await proposalClient.settle(callId, detachedArgs, exec.signal)
            return result as JsonValue
          } catch (error: unknown) {
            if (error instanceof ProposalOutcomeError) {
              if (error.state === 'INDETERMINATE') {
                indeterminate(error.message)
              }
              refuse(error.message)
            }
            throw error
          }
        }
        // Consume exactly once: reading removes the artifact.
        const ticket = authority.takeTicket(callId)
        if (ticket === undefined) fail('no authorization artifact — approval did not produce one for this call')
        if (ticket.agentKey !== pendingEntry.agentKey) fail('authorization artifact belongs to a different agent')
        if (ticket.expiry * 1000 <= Date.now()) fail('authorization artifact has expired')
        // Rebind to the exact bytes about to run: the artifact must authorize
        // THESE arguments under ITS expiry, recomputed independently here.
        const rebound = operationDigest(buildOperation(args, ticket.grant.exp))
        if (rebound !== ticket.operationDigest) fail('authorization does not bind to these arguments')
        const reply = await brokerRequest(brokerSocket, {
          op: MEMORY_PUT,
          toolName: MEMORY_PUT,
          arguments: args,
          grant: ticket.grant,
        })
        if (reply.ok !== true) {
          const state = replyText(reply.state, 'refused')
          // INDETERMINATE means the effect MAY have happened: never dress it up
          // as a refusal, and never as a success.
          if (state === 'INDETERMINATE') {
            indeterminate(`the broker reports the effect outcome is unknown (${replyText(reply.detail ?? reply.reason, 'unknown')})`)
          }
          refuse(replyText(reply.reason, 'unknown'))
        }
        return reply.receipt as JsonValue
      } finally {
        authority.deletePending(callId)
        authority.takeTicket(callId)
      }
    },
  }))
  return authority
}

export type { ReceiptInspection } from './proposal-client.ts'

/** Cordis service wrapper so the plugin composes via ctx.plugin and cordis.yml. */
export class GovernedMemoryService extends Service {
  static inject = ['tools']
  private readonly brokerSocket: string
  constructor(ctx: Context, config: GovernedMemoryConfig) {
    super(ctx, 'aukora.memory')
    this.brokerSocket = config.brokerSocket
    GovernedMemory(ctx, config)
  }

  /**
   * Recall verified KIRA records through the same parent-supplied broker route.
   * @param kind - optional KIRA record-kind filter.
   * @param signal - caller lifetime.
   * @returns the broker-validated effective query, policy, citations, and tri-state result.
   */
  recallKira(kind: KiraRecordKind | undefined, signal: AbortSignal): Promise<BrokerKiraRecallResult> {
    return requestBrokerKiraRecall(this.brokerSocket, kind, signal)
  }

  /**
   * Inspect one settled operation's receipt and evidence over the broker route.
   *
   * Read-only: the broker records nothing, so inspection cannot mint authority or
   * produce a second settlement. The result keeps broker settlement, verification
   * verdict and approval attribution as separate values.
   *
   * @param receiptSha256 - the receipt digest the Aura entry records.
   * @param signal - caller lifetime; an aborted signal must not surface a result.
   * @param includeArtifact - request the original export bytes for a disclosure
   *   decision. Off by default.
   * @returns the closed validated inspection result, including a named refusal.
   */
  inspectReceipt(
    receiptSha256: string,
    signal: AbortSignal,
    includeArtifact: boolean = false,
  ): Promise<ReceiptInspection> {
    return requestBrokerReceiptInspect(this.brokerSocket, receiptSha256, signal, includeArtifact)
  }
}

export default GovernedMemoryService
