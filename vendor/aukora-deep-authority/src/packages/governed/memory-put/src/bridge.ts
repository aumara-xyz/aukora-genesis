/**
 * The trusted answerer bridge for the governed effect.
 *
 * This listener NEVER decides. It wraps the real approval answerer chain: it
 * delegates first (`next()`), and only when a real answerer returned
 * `allowed-once` does it exchange the approved operation for a signed,
 * single-use grant with the out-of-process issuer daemon and hand the result
 * to the tool as a one-use ticket. No root key, no signing primitive, and no
 * decision-making exists anywhere in this package.
 *
 * Fail-closed properties: a missing pending operation, an unreachable issuer,
 * or any issuer refusal becomes `'unavailable'` (contained by the approval
 * service), so the effect never runs.
 *
 * ## Why the issuer is contacted AFTER the chain, not before
 *
 * Two authorities can say no: a composed answerer, and the issuer daemon's own
 * human prompt (`aukora/issuer/issuer.mjs` renders the operation and requires
 * `yes <fresh-challenge>` on its own stdin, denying on anything else and after
 * 30s). Both must say yes. Delegating first is what makes them AND rather than OR:
 *
 * - Contacting the issuer first would mint a signed grant for an operation a
 *   composed answerer is about to reject, and would let an issuer approval
 *   stand in for a harness decision the composition asked for. The order is
 *   the reason "this bridge never decides" is a true sentence.
 * - `'unavailable'` is the approval seam's fail-closed outcome, and it is
 *   produced by three different causes: no answerer is composed, an answerer
 *   threw, or an answerer returned a value outside the vocabulary
 *   (`packages/interaction/user-approval/src/index.ts` `decide`). Re-reading
 *   it here as "defer to the issuer" would turn a contained answerer crash
 *   into a second chance to approve at another authority. A consumer does not
 *   get to reinterpret the Service Definition's containment vocabulary.
 *
 * ## What that order costs, stated because it is not obvious
 *
 * In a composition with NO answerer, `next()` resolves `'unavailable'` and
 * this listener returns on its first branch: the issuer daemon is never
 * contacted and its human prompt is unreachable. The shipped
 * `profiles/8088-inside-out` is exactly such a composition (it mounts the
 * `dsh-user-approval` Service Definition and no answerer for it), so that
 * profile can never mint a grant. That is the intended fail-closed posture and
 * not a defect, but it means the profile is a governed tool SURFACE, not a
 * working authorization path — measured end to end, `memory.put` there returns
 * `tool "memory.put" requires approval, but no approval channel is available`.
 *
 * The only `approval/request` answerers in this repository are
 * `packages/host/apiproxy` and `packages/acp`, both whole app surfaces. A
 * composition that mounts one gets TWO human prompts per effect: the harness
 * preview (rendered by the shared `renderOperation`) and the issuer's own
 * signing screen. That is the two-party review the design intends, not a bug.
 * Both operation bodies come from the shared renderer; the issuer adds the
 * fresh challenge that correlates its stdin answer with the visible operation.
 *
 * @module @deepseek-ai/dsh-aukora-issuer/bridge
 */
import { createConnection } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { MEMORY_PUT } from '@aukora/core/broker/effect-definition.mjs'
import { operationDigest, type Operation } from '@aukora/core/broker/operation.mjs'
import type { Grant } from './index.ts'

/** Loader/plugin configuration for {@link registerIssuerBridge}. */
export interface GovernedIssuerBridgeConfig {
  /** Path of the out-of-process issuer daemon's unix socket (mode 0600). */
  issuerSocket: string
}

/** Package-private authority operations required by the issuer bridge. */
interface IssuerAuthority {
  getPending(callId: string): { operation: Operation; args: { key: string; value: unknown } } | undefined
  agentKeyOf(agent: ApprovalRequest['agent']): string
  issueTicket(ticket: {
    callId: string
    agentKey: string
    operationDigest: string
    expiry: number
    grant: Grant
  }): void
}

/** Validate the typed grant fields crossing the issuer socket. */
function isGrant(value: unknown): value is Grant {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Reflect.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const grant = value as Record<string, unknown>
  const ownKeys = Reflect.ownKeys(grant)
  if (ownKeys.some(key => typeof key !== 'string')) return false
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(grant, key)
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false
  }
  const keys = (ownKeys as string[]).sort()
  const expectedKeys = ['definitionId', 'digest', 'exp', 'nonce', 'operationDigest', 'receiptKeyId', 'signature', 'toolName']
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index])
    && typeof grant.toolName === 'string'
    && typeof grant.digest === 'string' && /^[0-9a-f]{64}$/.test(grant.digest)
    && typeof grant.nonce === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(grant.nonce)
    && typeof grant.exp === 'number'
    && Number.isSafeInteger(grant.exp)
    && typeof grant.definitionId === 'string' && /^[0-9a-f]{64}$/.test(grant.definitionId)
    && typeof grant.operationDigest === 'string' && /^[0-9a-f]{64}$/.test(grant.operationDigest)
    && typeof grant.receiptKeyId === 'string' && /^[0-9a-f]{64}$/.test(grant.receiptKeyId)
    && typeof grant.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(grant.signature)
}

/** One abortable raw issuance request to the issuer daemon. */
function issuerRequest(socketPath: string, request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('issuer request cancelled'))
      return
    }
    const conn = createConnection(socketPath)
    let buffer = ''
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      conn.destroy()
      fn()
    }
    const onAbort = (): void => { settle(() => { reject(new Error('issuer request cancelled')) }) }
    const closed = (): void => { settle(() => { reject(new Error('issuer closed without a reply')) }) }
    signal?.addEventListener('abort', onAbort, { once: true })
    conn.setTimeout(35000, () => { settle(() => { reject(new Error('issuer timed out')) }) })
    conn.once('error', (error: Error) => { settle(() => { reject(error) }) })
    conn.once('end', closed)
    conn.once('close', closed)
    conn.once('connect', () => { conn.write(`${JSON.stringify(request)}\n`) })
    conn.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let cut
      while ((cut = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 1)
        if (line.trim() === '') continue
        try {
          const reply = JSON.parse(line) as Record<string, unknown>
          settle(() => { resolve(reply) })
        } catch {
          settle(() => { reject(new Error('issuer sent malformed JSON')) })
        }
        return
      }
    })
  })
}

/**
 * Wrap the real answerer chain for the governed effect.
 * @param ctx - Cordis context carrying the approval event.
 * @param config - issuer socket path.
 * @param authority - composition-private pending-operation and ticket store.
 * @param ownerSignal - aborts in-flight issuance when the owning plugin unloads.
 * @returns nothing; registers the wrapping answerer listener.
 */
export function registerIssuerBridge(
  ctx: Context,
  config: GovernedIssuerBridgeConfig,
  authority: IssuerAuthority,
  ownerSignal: AbortSignal,
): void {
  ctx.on('approval/request', async (req: ApprovalRequest, next): Promise<ApprovalOutcome> => {
    // Delegate FIRST: the real human-answerer chain decides. This bridge never
    // approves, never denies, and never substitutes its own judgment.
    const outcome = await next()
    if (req.toolName !== MEMORY_PUT || outcome !== 'allowed-once') return outcome
    if (ownerSignal.aborted || req.signal?.aborted) return 'cancelled'
    if (req.callId === undefined) return 'unavailable'
    const callId = String(req.callId)
    const entry = authority.getPending(callId)
    // Fail closed: an ask with no recorded operation cannot be bound safely.
    if (entry === undefined) return 'unavailable'
    const requestSignal = req.signal === undefined
      ? ownerSignal
      : AbortSignal.any([req.signal, ownerSignal])
    const reply = await issuerRequest(config.issuerSocket, {
      op: 'issue',
      toolName: MEMORY_PUT,
      arguments: entry.args,
      expiry: entry.operation.exp,
    }, requestSignal)
    if (requestSignal.aborted) return 'cancelled'
    if (reply.ok !== true) {
      // Contained by the approval service as 'unavailable': the human's
      // approval cannot become an effect without the issuer's signature.
      const reason = typeof reply.reason === 'string' ? reply.reason : 'unknown'
      throw new Error(`memory.put issuance failed: ${reason}`)
    }
    if (!isGrant(reply.grant)) throw new Error('memory.put issuance failed: issuer returned an invalid grant')
    authority.issueTicket({
      callId,
      agentKey: authority.agentKeyOf(req.agent),
      operationDigest: operationDigest(entry.operation),
      expiry: entry.operation.exp,
      grant: reply.grant,
    })
    return outcome
  })
}
