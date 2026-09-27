/**
 * Guest-side client for the broker-owned proposal protocol.
 *
 * This module transports inert operation proposals and public status values.
 * It never receives a grant, signature, nonce, authorization digest, or issuer route.
 * On settlement, it carries the broker-produced signed receipt for independent verification.
 * The broker owns authorization, settlement, and evidence.
 *
 * @module @deepseek-ai/dsh-aukora-memory/proposal-client
 */
import { createConnection } from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import { MEMORY_PUT, WORKSPACE_PATCH } from '@aukora/core/broker/effect-definition.mjs'
import type { WorkspacePatchArgs } from '@aukora/core/broker/workspace-patch-args.mjs'
import {
  KIRA_RECALL_MAX_RECORDS,
  KIRA_RECALL_MAX_RESULT_BYTES,
  KIRA_RECALL_TOOL,
  kiraRecordContentSha256,
  type BrokerKiraRecallResult,
} from '@aukora/core/kira/recall.mjs'
import {
  KIRA_PRIVACY_CLASSES,
  KIRA_RECORD_KINDS,
  verifyKiraMemoryRecord,
} from '@aukora/core/kira/stage.mjs'

/**
 * One read-only receipt inspection result.
 *
 * SETTLEMENT, VERIFICATION AND ATTRIBUTION ARE SEPARATE FIELDS ON PURPOSE. A
 * settled operation can carry a NON-CONFORMING document when owner approval
 * evidence is absent, so a viewer that renders one value cannot report either
 * fact honestly.
 */
export type ReceiptInspection = {
  /** What the Aura chain recorded. Never inferred from the conversation renderer's state. */
  settlement: {
    state: string
    sequence: number | null
    operation: string | null
    /** The memory key or workspace path the settled entry names, when it names one. */
    subject: string | null
    chainHash: string | null
  }
  /** Which evidence exists, and why the export does or does not. */
  evidence: { v1Available: boolean; v3Available: boolean; v3ReadStatus: 'ok' | 'absent' | 'unreadable' }
  /** One row per trust role; `unavailable` is stated, never omitted. */
  trustInputs: { role: string; status: string; keyIds: string[] }[]
  verification?: {
    verdict: string
    reasons: string[]
    ceilings: string[]
    approvalClass: string | null
    /** Whether the graded document may be saved verbatim; a ceiling may forbid it. */
    canExportVerbatim: boolean
  }
  /** The original export bytes, present only when the caller asked for them. */
  artifact?: { mediaType: string; bytes: string; sha256: string; receiptSha256: string; publication: string | null }
  /** Named limits that travel with the result. */
  limitations: string[]
  /**
   * The named inspect refusal, present only when the read was refused.
   *
   * A refusal carries no settlement, evidence or trust inputs, because the read
   * did not reach them. The caller renders the reason instead of an empty result.
   */
  refusal?: string
  /**
   * Set when the settlement is recorded but the export file exists and could not
   * be read. Distinct from an absent export: nothing was ever written versus
   * something exists and is unavailable.
   */
  exportRefusal?: string
}

const REQUEST_TIMEOUT_MS = 10_000
const MAX_REPLY_BYTES = 64 * 1024
const DEFAULT_POLL_INTERVAL_MS = 50
const PROPOSAL_ID = /^[0-9a-f]{32}$/
const PROPOSAL_NAMESPACE = /^[0-9a-f]{32}$/
const PROPOSAL_NAMESPACE_INVALID = 'broker:proposal-namespace-invalid'

class BrokerTransportError extends Error {
  readonly requestWritten: boolean

  constructor(message: string, requestWritten: boolean) {
    super(message)
    this.name = 'BrokerTransportError'
    this.requestWritten = requestWritten
  }
}

/** Public terminal states returned by the proposal protocol. */
export type ProposalTerminalState = 'SETTLED' | 'REFUSED' | 'INDETERMINATE'

/** Public terminal result carrying broker-produced settlement evidence on success. */
export type ProposalTerminalResult =
  | { ok: true; proposalId: string; state: 'SETTLED'; receipt: Record<string, unknown> }
  | { ok: false; proposalId: string; state: 'REFUSED' | 'INDETERMINATE'; reason: string }

/** A named proposal failure, including whether an accepted effect may have run. */
export class ProposalOutcomeError extends Error {
  /** Public broker state associated with this failure. */
  readonly state: 'REFUSED' | 'INDETERMINATE'

  /**
   * @param state - whether the broker refused or the outcome is unknown.
   * @param reason - stable broker reason or client-side observation ceiling.
   */
  constructor(state: 'REFUSED' | 'INDETERMINATE', reason: string) {
    super(reason)
    this.name = 'ProposalOutcomeError'
    this.state = state
  }
}

interface ProposalClientOptions {
  /** Broker unix socket owned by the parent launch. */
  socketPath: string
  /** Poll cadence for accepted asynchronous proposals. */
  pollIntervalMs?: number
}

function isPlainDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Reflect.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
  })
}

function hasExactKeys(record: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(record)
  const allowed = new Set([...required, ...optional])
  return required.every(key => keys.includes(key)) && keys.every(key => allowed.has(key))
}

function isHexDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/** Validate and detach one successful broker-owned KIRA recall envelope. */
/**
 * Validate one inspection reply, or null when it is not the exact shape.
 *
 * A refusal is a VALID reply and is surfaced as a named reason rather than a
 * malformed-response error, because "not found" and "unreadable" are outcomes the
 * viewer must show distinctly.
 *
 * @param value - the parsed reply.
 * @returns the inspection result, or null when the reply is malformed.
 */
export function readReceiptInspectReply(value: unknown): ReceiptInspection | null {
  if (!isPlainDataObject(value)) return null
  if (value.ok === false) {
    if (!hasExactKeys(value, ['ok', 'refusal'], ['limitations'])) return null
    if (typeof value.refusal !== 'string' || !value.refusal.startsWith('inspect:')) return null
    // A refusal carries no settlement, evidence or trust inputs: the read did not
    // reach them. The caller renders the named reason instead of an empty result.
    // The named limits still travel, because a refused read has them too and a
    // viewer that dropped them would imply the limits were checked.
    const limitations = Array.isArray(value.limitations)
      ? (value.limitations as unknown[]).filter((entry): entry is string => typeof entry === 'string')
      : []
    return {
      settlement: { state: 'unknown', sequence: null, operation: null, subject: null, chainHash: null },
      evidence: { v1Available: false, v3Available: false, v3ReadStatus: 'absent' },
      trustInputs: [],
      limitations,
      refusal: value.refusal,
    }
  }
  if (!isPlainDataObject(value.settlement)
    || !hasExactKeys(value.settlement, ['state', 'sequence', 'operation', 'key', 'chainHash'])
    || typeof value.settlement.state !== 'string'
    || !isPlainDataObject(value.evidence)
    || !hasExactKeys(value.evidence, ['v1Available', 'v3Available', 'v3ReadStatus'])
    || typeof value.evidence.v1Available !== 'boolean'
    || typeof value.evidence.v3Available !== 'boolean'
    || !['ok', 'absent', 'unreadable'].includes(value.evidence.v3ReadStatus as string)
    || !Array.isArray(value.trustInputs)
    || !Array.isArray(value.limitations)
    || value.limitations.some(entry => typeof entry !== 'string')
    || (value.exportRefusal !== undefined && typeof value.exportRefusal !== 'string')) {
    return null
  }
  const trustInputs: { role: string; status: string; keyIds: string[] }[] = []
  for (const row of value.trustInputs) {
    if (!isPlainDataObject(row)
      || !hasExactKeys(row, ['role', 'status', 'keyIds'])
      || typeof row.role !== 'string'
      || !['supplied', 'unavailable'].includes(row.status as string)
      || !Array.isArray(row.keyIds)
      || row.keyIds.some(key => typeof key !== 'string')) return null
    trustInputs.push({ role: row.role, status: row.status as string, keyIds: row.keyIds as string[] })
  }
  const result = {
    settlement: {
      state: value.settlement.state,
      sequence: typeof value.settlement.sequence === 'number' ? value.settlement.sequence : null,
      operation: typeof value.settlement.operation === 'string' ? value.settlement.operation : null,
      subject: typeof value.settlement.key === 'string' ? value.settlement.key : null,
      chainHash: typeof value.settlement.chainHash === 'string' ? value.settlement.chainHash : null,
    },
    evidence: {
      v1Available: value.evidence.v1Available,
      v3Available: value.evidence.v3Available,
      v3ReadStatus: value.evidence.v3ReadStatus as 'ok' | 'absent' | 'unreadable',
    },
    trustInputs,
    limitations: value.limitations as string[],
  } as ReceiptInspection
  if (typeof value.exportRefusal === 'string') result.exportRefusal = value.exportRefusal
  if (value.verification !== undefined) {
    if (!isPlainDataObject(value.verification)
      || !hasExactKeys(value.verification, ['verdict', 'reasons', 'ceilings', 'approvalClass'], ['canExportVerbatim'])
      || typeof value.verification.verdict !== 'string'
      || !Array.isArray(value.verification.reasons)
      || !Array.isArray(value.verification.ceilings)
      || value.verification.reasons.some(reason => typeof reason !== 'string')
      || value.verification.reasons.some(reason => reason === '')) return null
    result.verification = {
      verdict: value.verification.verdict,
      reasons: value.verification.reasons as string[],
      ceilings: value.verification.ceilings as string[],
      approvalClass: typeof value.verification.approvalClass === 'string' ? value.verification.approvalClass : null,
      canExportVerbatim: value.verification.canExportVerbatim === true,
    }
  }
  if (value.artifact !== undefined) {
    // The artifact must be bound to a receipt digest and carry its own hash, so a
    // caller can prove a saved file is this artifact rather than a lookalike.
    if (!isPlainDataObject(value.artifact)
      || !hasExactKeys(value.artifact, ['mediaType', 'bytes', 'sha256', 'receiptSha256', 'publication'])
      || typeof value.artifact.bytes !== 'string'
      || !isHexDigest(value.artifact.sha256)
      || !isHexDigest(value.artifact.receiptSha256)) return null
    result.artifact = {
      mediaType: typeof value.artifact.mediaType === 'string' ? value.artifact.mediaType : 'application/json',
      bytes: value.artifact.bytes,
      sha256: value.artifact.sha256,
      receiptSha256: value.artifact.receiptSha256,
      publication: typeof value.artifact.publication === 'string' ? value.artifact.publication : null,
    }
  }
  return result
}

function readKiraRecallReply(value: Record<string, unknown>): BrokerKiraRecallResult | null {
  if (!hasExactKeys(value, ['ok', 'query', 'privacy', 'bounds', 'citations', 'result'])
    || value.ok !== true
    || !isPlainDataObject(value.query)
    || !hasExactKeys(value.query, ['subject'], ['kind'])
    || typeof value.query.subject !== 'string'
    || value.query.subject === ''
    || /[\u0000-\u001f\u007f-\u009f]/.test(value.query.subject)
    || ('kind' in value.query && !KIRA_RECORD_KINDS.includes(value.query.kind as never))
    || !Array.isArray(value.privacy)
    || value.privacy.length === 0
    || value.privacy.some(item => !KIRA_PRIVACY_CLASSES.includes(item as never))
    || new Set(value.privacy).size !== value.privacy.length
    || value.privacy.some((item, index, list) => index > 0 && String(list[index - 1]) >= String(item))
    || !isPlainDataObject(value.bounds)
    || !hasExactKeys(value.bounds, ['maxRecords', 'maxBytes'])
    || value.bounds.maxRecords !== KIRA_RECALL_MAX_RECORDS
    || value.bounds.maxBytes !== KIRA_RECALL_MAX_RESULT_BYTES
    || !Array.isArray(value.citations)
    || !isPlainDataObject(value.result)) {
    return null
  }
  const citations: unknown[] = value.citations
  let verifiedHead: string | undefined
  for (const citation of citations) {
    if (!isPlainDataObject(citation)
      || !hasExactKeys(citation, [
        'recordId', 'contentSha256', 'auraSequence', 'auraEntryHash', 'verifiedHead',
      ])
      || typeof citation.recordId !== 'string'
      || !isHexDigest(citation.contentSha256)
      || !Number.isSafeInteger(citation.auraSequence)
      || (citation.auraSequence as number) < 1
      || !isHexDigest(citation.auraEntryHash)
      || !isHexDigest(citation.verifiedHead)) {
      return null
    }
    if (verifiedHead === undefined) verifiedHead = citation.verifiedHead
    else if (citation.verifiedHead !== verifiedHead) return null
  }
  if (value.result.status === 'found') {
    if (!hasExactKeys(value.result, ['status', 'records']) || !Array.isArray(value.result.records)
      || value.result.records.length === 0
      || value.result.records.length !== citations.length
      || value.result.records.length > KIRA_RECALL_MAX_RECORDS) {
      return null
    }
    let priorRecordId: string | undefined
    for (let index = 0; index < value.result.records.length; index += 1) {
      const verdict = verifyKiraMemoryRecord(value.result.records[index])
      const citation = citations[index] as Record<string, unknown>
      if (!verdict.verified
        || verdict.record.recordId !== citation.recordId
        || kiraRecordContentSha256(verdict.record) !== citation.contentSha256
        || (priorRecordId !== undefined && priorRecordId >= verdict.record.recordId)
        || verdict.record.subject !== value.query.subject
        || ('kind' in value.query && verdict.record.kind !== value.query.kind)
        || !value.privacy.includes(verdict.record.privacy)) {
        return null
      }
      priorRecordId = verdict.record.recordId
    }
  } else if (value.result.status === 'empty') {
    if (!hasExactKeys(value.result, ['status']) || citations.length !== 0) return null
  } else if (value.result.status === 'undetermined') {
    if (!hasExactKeys(value.result, ['status', 'reason'])
      || !['memory-unavailable', 'memory-corrupt', 'memory-unverified'].includes(
        value.result.reason as string,
      )
      || citations.length !== 0) {
      return null
    }
  } else {
    return null
  }
  const detachedCitations: BrokerKiraRecallResult['citations'][number][] = citations.map((candidate) => {
    if (!isPlainDataObject(candidate)) throw new TypeError('validated citation became unreadable')
    return {
      recordId: candidate.recordId as string,
      contentSha256: candidate.contentSha256 as string,
      auraSequence: candidate.auraSequence as number,
      auraEntryHash: candidate.auraEntryHash as string,
      verifiedHead: candidate.verifiedHead as string,
    }
  })
  const detachedPrivacy = (value.privacy as unknown[])
    .map(item => item as BrokerKiraRecallResult['privacy'][number])
  return {
    query: { ...value.query } as unknown as BrokerKiraRecallResult['query'],
    privacy: detachedPrivacy,
    bounds: { maxRecords: KIRA_RECALL_MAX_RECORDS, maxBytes: KIRA_RECALL_MAX_RESULT_BYTES },
    citations: detachedCitations as unknown as BrokerKiraRecallResult['citations'],
    result: JSON.parse(JSON.stringify(value.result)) as BrokerKiraRecallResult['result'],
  }
}

/** Validate one closed KIRA failure frame without changing its public state. */
function readKiraRecallFailure(
  reply: Record<string, unknown>,
): { state: 'REFUSED' | 'INDETERMINATE'; reason: string } | null {
  if (reply.ok !== false
    || (reply.state !== 'REFUSED' && reply.state !== 'INDETERMINATE')
    || typeof reply.reason !== 'string'
    || reply.reason === ''
    || Buffer.byteLength(reply.reason, 'utf8') > 256
    || /[\u0000-\u001f\u007f-\u009f]/.test(reply.reason)) {
    return null
  }
  if (reply.state === 'REFUSED') {
    return hasExactKeys(reply, ['ok', 'state', 'reason'])
      ? { state: 'REFUSED', reason: reply.reason }
      : null
  }
  if (!hasExactKeys(reply, ['ok', 'state', 'reason'], ['detail'])
    || ('detail' in reply && typeof reply.detail !== 'string')) {
    return null
  }
  return { state: 'INDETERMINATE', reason: reply.reason }
}

/**
 * Ask the broker for KIRA memory under its parent-owned subject/privacy policy.
 *
 * @param socketPath - broker unix socket owned by the parent launch.
 * @param kind - optional model-selected KIRA record kind.
 * @param signal - tool execution lifetime.
 * @returns the closed validated recall result, without the wire `ok` field.
 */
export async function requestBrokerKiraRecall(
  socketPath: string,
  kind: typeof KIRA_RECORD_KINDS[number] | undefined,
  signal: AbortSignal,
): Promise<BrokerKiraRecallResult> {
  const reply = await brokerRequest(socketPath, {
    op: KIRA_RECALL_TOOL,
    ...(kind === undefined ? {} : { kind }),
  }, signal)
  if (reply.ok === false) {
    const failure = readKiraRecallFailure(reply)
    if (failure === null) {
      throw new ProposalOutcomeError('INDETERMINATE', 'broker:kira-recall-response-malformed')
    }
    throw new ProposalOutcomeError(failure.state, failure.reason)
  }
  const recalled = readKiraRecallReply(reply)
  if (recalled === null) {
    throw new ProposalOutcomeError('INDETERMINATE', 'broker:kira-recall-response-malformed')
  }
  return recalled
}

/**
 * Ask the broker to inspect one settled receipt, read-only.
 *
 * THE SAME SOCKET, THE SAME AUTH, THE SAME LIFETIME. This is deliberately a
 * sibling of {@link requestBrokerKiraRecall} rather than a new endpoint: the
 * broker route is parent-supplied and already authenticated by possession of the
 * socket, and receipt inspection is a read exactly as recall is. A second
 * transport would need its own authentication and would give the application two
 * answers to "who may read broker state".
 *
 * The broker validates the identifier and refuses before touching the
 * filesystem, so a malformed value surfaces as a named refusal rather than a
 * transport error.
 *
 * @param socketPath - broker unix socket owned by the parent launch.
 * @param receiptSha256 - the receipt digest the Aura entry records.
 * @param signal - caller lifetime; an aborted signal must not surface a result.
 * @param includeArtifact - request the original export BYTES. Off by default:
 *   the bytes carry operation arguments and paths and are only sent when a caller
 *   states that purpose for a disclosure decision.
 * @returns the closed validated inspection result.
 */
export async function requestBrokerReceiptInspect(
  socketPath: string,
  receiptSha256: string,
  signal: AbortSignal,
  includeArtifact: boolean = false,
): Promise<ReceiptInspection> {
  const reply = await brokerRequest(socketPath, {
    op: 'receipt.inspect',
    receiptSha256,
    ...(includeArtifact ? { includeArtifact: true } : {}),
  }, signal)
  const inspected = readReceiptInspectReply(reply)
  if (inspected === null) {
    throw new ProposalOutcomeError('INDETERMINATE', 'broker:receipt-inspect-response-malformed')
  }
  return inspected
}

/** Describe a broker connection failure without changing whether request bytes may have reached it.
 * @param reason Socket error or other transport failure.
 * @param socketPath Configured broker route.
 * @param requestWritten Whether the request was submitted to the socket for writing.
 * @returns Transport error retaining write uncertainty; only missing/refused routes receive outage guidance.
 */
export function brokerConnectDiagnostic(
  reason: unknown,
  socketPath: string,
  requestWritten: boolean,
): BrokerTransportError {
  const code = typeof reason === 'object' && reason !== null && 'code' in reason ? reason.code : undefined
  if (code === 'ENOENT' || code === 'ECONNREFUSED') {
    if (!requestWritten) {
      return new BrokerTransportError(
        `broker route unreachable; broker may be stopped or restarting; retained memory has not been checked (${socketPath}: connect ${code})`,
        requestWritten,
      )
    }
    // A connection failure reported after the request bytes were written is a
    // lost outcome, not a route that was never checked; keep the exact cause.
    return new BrokerTransportError(
      `broker route unreachable; broker may be stopped or restarting; the request was written but no reply was observed (${socketPath}: connect ${code})`,
      requestWritten,
    )
  }
  const message = reason instanceof Error ? reason.message : 'broker transport failed'
  return new BrokerTransportError(message, requestWritten)
}

/** Send one bounded request and consume exactly one newline-delimited reply. */
function brokerRequest(
  socketPath: string,
  request: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('proposal request cancelled'))
      return
    }
    const socket = createConnection(socketPath)
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    let receivedBytes = 0
    let requestWritten = false
    let settled = false
    const transportError = (reason: unknown, fallback: string): BrokerTransportError => {
      const message = reason instanceof Error ? reason.message : fallback
      return new BrokerTransportError(message, requestWritten)
    }
    const connectError = (reason: unknown): BrokerTransportError =>
      brokerConnectDiagnostic(reason, socketPath, requestWritten)
    const finish = (done: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      socket.destroy()
      done()
    }
    const onAbort = (): void => {
      finish(() => {
        reject(transportError(signal.reason, 'proposal request cancelled'))
      })
    }
    const timer = setTimeout(() => {
      finish(() => { reject(new BrokerTransportError('broker request timed out', requestWritten)) })
    }, REQUEST_TIMEOUT_MS)
    signal.addEventListener('abort', onAbort, { once: true })
    socket.once('connect', () => {
      requestWritten = true
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.once('error', (error) => {
      finish(() => { reject(connectError(error)) })
    })
    socket.once('close', () => {
      finish(() => { reject(new BrokerTransportError('broker closed without a reply', requestWritten)) })
    })
    socket.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length
      if (receivedBytes > MAX_REPLY_BYTES) {
        finish(() => {
          reject(new BrokerTransportError('broker reply exceeded the frame limit', requestWritten))
        })
        return
      }
      buffer += decoder.write(chunk)
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      const line = buffer.slice(0, cut)
      finish(() => {
        try {
          const parsed: unknown = JSON.parse(line)
          if (!isPlainDataObject(parsed)) throw new Error('broker reply was not a plain object')
          resolve(parsed)
        } catch (error: unknown) {
          reject(transportError(error, 'broker reply was not JSON'))
        }
      })
    })
  })
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('proposal observation cancelled'))
      return
    }
    const timer = setTimeout(done, milliseconds)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason instanceof Error ? signal.reason : new Error('proposal observation cancelled'))
    }
    function done(): void {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortableWait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('proposal observation cancelled'))
      return
    }
    let settled = false
    const finish = (done: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      done()
    }
    const onAbort = (): void => {
      finish(() => {
        reject(signal.reason instanceof Error ? signal.reason : new Error('proposal observation cancelled'))
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
      (value) => { finish(() => { resolve(value) }) },
      (error: unknown) => {
        finish(() => { reject(error instanceof Error ? error : new Error('proposal observation failed')) })
      },
    )
  })
}

function refusalReason(reply: Record<string, unknown>): string {
  return typeof reply.reason === 'string' ? reply.reason : 'broker:proposal-response-malformed'
}

function exactProposalRefusal(reply: Record<string, unknown>): string | null {
  return reply.ok === false
    && reply.state === 'REFUSED'
    && typeof reply.reason === 'string'
    && Object.keys(reply).length === 3
    ? reply.reason
    : null
}

function terminalResult(reply: Record<string, unknown>, proposalId: string): ProposalTerminalResult | null {
  if (reply.proposalId !== proposalId || typeof reply.state !== 'string') return null
  if (reply.state === 'SETTLED' && reply.ok === true
    && isPlainDataObject(reply.receipt)
    && Object.keys(reply).length === 4) {
    return { ok: true, proposalId, state: 'SETTLED', receipt: reply.receipt }
  }
  if ((reply.state === 'REFUSED' || reply.state === 'INDETERMINATE')
    && reply.ok === false
    && typeof reply.reason === 'string'
    && Object.keys(reply).length === 4) {
    return { ok: false, proposalId, state: reply.state, reason: reply.reason }
  }
  return null
}

/**
 * One composition-owned proposal client. A namespace scopes call-id retries;
 * broker restart invalidates it and causes one fresh namespace allocation.
 */
export class BrokerProposalClient {
  private readonly socketPath: string
  private readonly pollIntervalMs: number
  private readonly lifetime = new AbortController()
  private namespace: Promise<string> | undefined

  /**
   * @param options - broker route and observation cadence.
   */
  constructor(options: ProposalClientOptions) {
    if (typeof options.socketPath !== 'string' || options.socketPath === '') {
      throw new TypeError('proposal client requires a broker socket')
    }
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 1_000) {
      throw new TypeError('proposal poll interval must be an integer from 1 to 1000 milliseconds')
    }
    this.socketPath = options.socketPath
    this.pollIntervalMs = pollIntervalMs
  }

  /** Stop in-flight observation; already accepted work remains broker-owned. */
  close(): void {
    this.lifetime.abort(new Error('governed memory proposal client disposed'))
  }

  private signalFor(signal: AbortSignal): AbortSignal {
    return AbortSignal.any([signal, this.lifetime.signal])
  }

  private async open(signal: AbortSignal): Promise<string> {
    const reply = await brokerRequest(this.socketPath, { op: 'proposal.open' }, signal)
    if (reply.ok !== true
      || typeof reply.proposalNamespace !== 'string'
      || !PROPOSAL_NAMESPACE.test(reply.proposalNamespace)
      || Object.keys(reply).length !== 2) {
      throw new ProposalOutcomeError('REFUSED', refusalReason(reply))
    }
    return reply.proposalNamespace
  }

  private namespaceFor(): Promise<string> {
    this.namespace ??= this.open(this.lifetime.signal).catch((error: unknown) => {
      this.namespace = undefined
      throw error
    })
    return this.namespace
  }

  /**
   * Deposit one inert proposal and wait for its public terminal state.
   *
   * @param callId - stable ToolRuntime occurrence identity.
   * @param args - exact memory.put arguments.
   * @param signal - tool execution lifetime.
   * @returns a public settled result with no grant or receipt bytes.
   */
  async settle(
    callId: string,
    args: { key: string; value: unknown },
    signal: AbortSignal,
  ): Promise<ProposalTerminalResult> {
    return this.settleEffect(callId, MEMORY_PUT, args, signal)
  }

  /**
   * Propose one replacement through the broker-owned approval path.
   * @param callId Stable occurrence identity for retries.
   * @param args Exact bytes, prior digest, and operator-defined workspace alias.
   * @param signal Observation lifetime; cancellation is not rollback.
   * @returns Authority-free terminal status; the client supplies no approval.
   */
  async settleWorkspacePatch(callId: string, args: WorkspacePatchArgs, signal: AbortSignal): Promise<ProposalTerminalResult> {
    return this.settleEffect(callId, WORKSPACE_PATCH, args, signal)
  }

  private async settleEffect(
    callId: string,
    toolName: string,
    args: { key: string; value: unknown } | WorkspacePatchArgs,
    signal: AbortSignal,
  ): Promise<ProposalTerminalResult> {
    const combined = this.signalFor(signal)
    let accepted = false
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const proposalNamespace = await abortableWait(this.namespaceFor(), combined)
        let deposited: Record<string, unknown>
        try {
          deposited = await brokerRequest(this.socketPath, {
            op: 'proposal.deposit',
            proposalNamespace,
            callId,
            toolName,
            arguments: args,
          }, combined)
        } catch (error: unknown) {
          if (error instanceof BrokerTransportError && error.requestWritten) {
            throw new ProposalOutcomeError(
              'INDETERMINATE',
              'proposal was sent but its terminal outcome was not observed',
            )
          }
          throw error
        }
        const refusal = exactProposalRefusal(deposited)
        if (refusal === PROPOSAL_NAMESPACE_INVALID && attempt === 0) {
          this.namespace = undefined
          continue
        }
        if (refusal !== null) {
          throw new ProposalOutcomeError('REFUSED', refusal)
        }
        if (deposited.ok !== true
          || typeof deposited.proposalId !== 'string'
          || !PROPOSAL_ID.test(deposited.proposalId)
          || (deposited.state !== 'PENDING' && deposited.state !== 'SETTLED')
          || (deposited.state === 'PENDING' && Object.keys(deposited).length !== 3)
          || (deposited.state === 'SETTLED' && (!isPlainDataObject(deposited.receipt) || Object.keys(deposited).length !== 4))) {
          throw new ProposalOutcomeError('INDETERMINATE', 'broker:proposal-response-malformed')
        }
        accepted = true
        const proposalId = deposited.proposalId
        if (deposited.state === 'SETTLED') {
          return { ok: true, proposalId, state: 'SETTLED', receipt: deposited.receipt as Record<string, unknown> }
        }
        for (;;) {
          await abortableDelay(this.pollIntervalMs, combined)
          const status = await brokerRequest(this.socketPath, {
            op: 'proposal.status',
            proposalNamespace,
            proposalId,
          }, combined)
          if (status.ok === true && status.proposalId === proposalId && status.state === 'PENDING'
            && Object.keys(status).length === 3) continue
          const terminal = terminalResult(status, proposalId)
          if (terminal === null) {
            throw new ProposalOutcomeError('INDETERMINATE', 'broker:proposal-response-malformed')
          }
          if (!terminal.ok) {
            throw new ProposalOutcomeError(terminal.state, terminal.reason)
          }
          return terminal
        }
      }
      throw new ProposalOutcomeError('REFUSED', PROPOSAL_NAMESPACE_INVALID)
    } catch (error: unknown) {
      if (error instanceof ProposalOutcomeError) throw error
      if (accepted) {
        throw new ProposalOutcomeError(
          'INDETERMINATE',
          'proposal was accepted but its terminal outcome was not observed',
        )
      }
      throw new ProposalOutcomeError(
        'REFUSED',
        error instanceof Error ? error.message : 'proposal transport failed',
      )
    }
  }
}
