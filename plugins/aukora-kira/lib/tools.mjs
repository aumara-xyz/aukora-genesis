/**
 * The two model-facing tool definitions.
 *
 * These are plain DSH `ToolDefinition` objects. They declare raw JSON Schema in
 * the harness's enforced subset and carry no imports from the harness, so the
 * package mounts from any DSH release without a build step or a resolved
 * dependency on `@deepseek-ai/dsh-tools`.
 *
 * Neither definition accepts a subject, a privacy class, a store path, a
 * limit, an authority token, or a grant. `kira_recall` accepts a question and
 * bounded navigation; `kira_stage` accepts one record candidate. Everything
 * that decides *whose* memory is read and *which* privacy classes are visible
 * comes from the injected read owner.
 *
 * @module @aukora/dsh-plugin-kira/tools
 */
import { assertParameters } from './parameters.mjs'
import {
  KIRA_PRIVACY_CLASSES,
  recordKind,
  KiraStageError,
  kiraRecordContentSha256,
  memoryEffectBody,
  stageKiraMemoryRecord,
  verifyKiraMemoryRecord,
} from './record.mjs'
// The queue's refusal class, so a `kira.queue:…` code reaching a model comes from the same vocabulary
// the queue contract throws. `queue.mjs` is pure and holds no filesystem route.
import { KiraQueueError, reviewTextOf } from './queue.mjs'
import {
  cellBudgetedBytes,
  describeProposalRefusal,
  proposeMemoryPutProven,
} from './wasm-proposal.mjs'
import { CONVERSATION_ACTIONS, KiraConversationError } from './conversation.mjs'
import { readOwnerPolicy } from './read-owner.mjs'
import { RETRIEVAL_LIMITS } from './retrieval.mjs'
// The phase 9 policy's OWN vocabularies, so the declared output schema cannot drift from the values
// `reconcileRecallAvailability` actually returns. A copy of the enum here would be one more thing to
// forget; importing it means a new action breaks the import rather than the live tool.
import { PARTIAL_FAILURE_ACTIONS, REMEMBERED_STATES, STORE_AVAILABILITY } from './partial-failure.mjs'

/**
 * Model-facing tool names. DeepSeek and OpenAI-compatible APIs require
 * `^[a-zA-Z0-9_-]+$`; a dotted name is rejected as `tools[i].name`.
 * Refusal *codes* (`kira.stage:…`, `kira.recall:…`, `kira.settle:…`) stay dotted.
 */
export const KIRA_STAGE_TOOL_NAME = 'kira_stage'
export const KIRA_RECALL_TOOL_NAME = 'kira_recall'
export const KIRA_SETTLE_TOOL_NAME = 'kira_settle'
export const KIRA_QUEUE_TOOL_NAME = 'kira_queue'

/** What an inert staged proposal does NOT establish. */
export const KIRA_STAGE_CEILING = Object.freeze([
  'this tool wrote nothing: the returned memoryPut arguments are an inert proposal for the admitted memory path',
  'no authorization is proven and none is carried: no grant, signature, nonce, issuer route, broker path, or receipt appears in this result',
  'the deterministic recordId names the record and proves nothing about whether it was approved, settled, or included in Aura',
  'the subject and privacy class are the host-supplied read-owner policy narrowed by this tool, not an authenticated identity claim',
  'a transform reference records the transform identity the caller declared; it does not verify that the transform produced this content',
  'a staged record is named and not stored: it becomes recallable only when a granted transition settles it. Whether a producer is configured is reported by `settlement`, and being available is not being authorized — the grant is what authorizes one write',
])

/**
 * What a stage result establishes when the composition ALSO configured a pending review queue.
 *
 * The first ceiling line of the un-queued list — "this tool wrote nothing" — would be FALSE here, and a
 * ceiling that is false is worse than no ceiling: it is the sentence a reader trusts instead of
 * checking. So the line is replaced rather than kept, and the two facts it must not blur are stated
 * together: a queue entry WAS written, and NO MEMORY was.
 */
export const KIRA_STAGE_QUEUE_CEILING = Object.freeze([
  'this tool wrote at most one PENDING QUEUE ENTRY and no memory: the queue is a review list, not the memory store, and a queued record is not recallable',
  'queueing is not approval: no authorization is proven and none is carried, and no grant, signature, nonce, issuer route or receipt appears in this result',
  ...KIRA_STAGE_CEILING.slice(2),
])

/** What a queue listing does NOT establish. */
export const KIRA_QUEUE_CEILING = Object.freeze([
  'this tool reads a list and writes nothing: it shows what was staged and not yet settled',
  'a queued entry is NOT a memory: it is not recallable, it grants nothing, and it carries no authority material',
  'being queued is not being authorized: an entry names bytes a person MAY choose to settle, and the grant plus the approval are what authorize one write',
  'this tool cannot approve, mint, settle or delete anything; approving a queued record is an operator act through the approval channel',
  'a queued record the store has already settled stops reading as pending — settled is DERIVED from the store, never recorded by deleting the entry, so there is one source of truth for it',
  'an entry whose bytes no longer verify is reported with its reason and never dropped, and a listing that stopped at its bound says so',
])

/** Declared parameter schema for the `kira_stage` tool. */
export const STAGE_PARAMETERS = {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        type: 'string',
        enum: [...recordKind],
        description: 'The closed record kind.',
      },
      content: {
        description: 'The record content as lossless JSON data; bounded by depth and node ceilings.',
      },
      createdAt: {
        type: 'string',
        description: 'Canonical seconds-precision UTC instant with a Z suffix, e.g. 2026-09-08T00:00:00Z. No local clock participates.',
      },
      subject: {
        type: 'string',
        description: 'Optional. Must equal the host read-owner subject when supplied; it cannot widen it.',
      },
      privacy: {
        type: 'string',
        enum: [...KIRA_PRIVACY_CLASSES],
        description: 'Optional. Must be a privacy class the host read-owner policy permits.',
      },
      source: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { recordId: { type: 'string' } },
          required: ['recordId'],
        },
        description: 'Records this record derives from. Required when transform is present.',
      },
      links: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            recordId: { type: 'string' },
            relation: { type: 'string', description: 'e.g. supersedes, contradicts, related.' },
          },
          required: ['recordId', 'relation'],
        },
        description: 'Explicit links this record asserts toward other records.',
      },
      transform: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          model: { type: 'string' },
          parametersDigest: { type: 'string' },
          outputDigest: { type: 'string' },
        },
        required: ['name', 'version', 'outputDigest'],
        description: 'Transform provenance for a derived view. Requires at least one source reference.',
      },
    },
  required: ['kind', 'content', 'createdAt'],
}

/** Declared parameter schema for the `kira_recall` tool. */
export const RECALL_PARAMETERS = {
    type: 'object',
    additionalProperties: false,
    properties: {
      lexical: { type: 'boolean', description: 'Search exact words in verified history, including records below the semantic quality floor.' },
      action: {
        type: 'string',
        enum: [...CONVERSATION_ACTIONS],
        description: 'Defaults to query. more pages on; select focuses one displayed reference; not-that rejects the first; clarify interprets or refines; new restarts; stop ends the session.',
      },
      text: {
        type: 'string',
        description: 'The question, or the refinement for clarify. At most 512 characters.',
      },
      choice: {
        oneOf: [{ type: 'integer' }, { type: 'string' }],
        description: 'For select: the 1-based position shown, or a displayed record identifier.',
      },
      kind: {
        type: 'string',
        enum: [...recordKind],
        description: 'Optional narrowing to one record kind.',
      },
    },
  required: [],
}

/**
 * Build the `kira_stage` definition.
 *
 * The third parameter exists so a court can substitute a DIFFERENT prover and
 * show that the byte ceiling depends on the pinned cell rather than on an
 * assertion that would hold either way. The default is the only prover a
 * composition ever gets: it is the cell. Nothing in this package passes the
 * argument, and the parameter is documented as a seam rather than advertised as
 * an option, because an easily-reachable "skip the cell" switch is the fallback
 * the mount exists to remove.
 *
 * @param {Readonly<{describe: () => Promise<unknown>, read: (request: unknown) => Promise<unknown>}>} owner - injected read owner.
 * @param {Readonly<Record<string, unknown>>} settlement - the settlement status this composition truthfully reports.
 * @param {(args: Readonly<{key: string, value: unknown}>, same: Readonly<{key: string, value: unknown}>, expectations: Readonly<{expectedBody: string, expectedKey: string, verify: (value: unknown) => unknown}>) => Readonly<{key: string, value: unknown}>} [prover] - the proposal route; defaults to the pinned cell.
 * @param {Readonly<{enqueuePending: (staged: unknown) => Readonly<Record<string, unknown>>}>} [queue] - the pending review queue, ONLY when the composition configured one. Absent means staging writes nothing at all, exactly as before.
 * @returns {Readonly<Record<string, unknown>>} the tool definition.
 */
export function stageTool(owner, settlement, prover = proposeMemoryPutProven, queue = undefined) {
  return Object.freeze({
    name: KIRA_STAGE_TOOL_NAME,
    description:
      'Stage one deterministic KIRA memory record without writing it. Returns an inert memory.put proposal, the '
      + 'complete canonical record, and its deterministic recordId. The subject and privacy class are supplied by the '
      + 'host read-owner policy; a candidate naming a different subject or an unpermitted privacy class is refused. '
      + 'This tool never writes memory, never carries authority material, and does not prove that any write will occur. '
      + 'When the composition configured a pending review queue, the staged record is ALSO left in that queue as one '
      + 'durable entry for a person to approve or ignore; queueing is not approval, and a queued record is not stored '
      + 'and not recallable.',
    parameters: STAGE_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string', const: 'proposed' },
          // NOT A CONST ANY MORE, and the reason is a measured one from this very file: the runtime
          // validates a tool's OUTPUT against this schema and rejects the whole result on a mismatch.
          // `const: false` would therefore turn a successful configured enqueue into an invalid-output
          // error instead of a result. The invariant is pinned where it can actually hold — a court
          // asserts `false` with no queue and `true` with one — rather than by a schema that would have
          // to be false in one of the two cases.
          wrote: { type: 'boolean' },
          queued: {
            type: 'object',
            additionalProperties: false,
            properties: {
              state: { type: 'string', enum: ['queued', 'already-queued'] },
              recordId: { type: 'string' },
            },
            required: ['state', 'recordId'],
          },
          recordId: { type: 'string' },
          subject: { type: 'string' },
          privacy: { type: 'string' },
          record: {},
          memoryPut: {
            type: 'object',
            additionalProperties: false,
            properties: { key: { type: 'string' }, value: {} },
            required: ['key', 'value'],
          },
          settlement: {
            type: 'object',
            additionalProperties: false,
            properties: {
              available: { type: 'boolean' },
              reason: { type: 'string' },
              detail: { type: 'string' },
            },
            required: ['available', 'reason', 'detail'],
          },
          ceiling: { type: 'array', items: { type: 'string' } },
        },
        required: ['state', 'wrote', 'recordId', 'subject', 'privacy', 'record', 'memoryPut', 'settlement', 'ceiling'],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      // The runtime validates a tool's output, not its parameters, so a declared
      // `additionalProperties: false` is only real if the tool enforces it.
      assertParameters(STAGE_PARAMETERS, args)
      const input = /** @type {Record<string, unknown>} */ (args)
      const policy = /** @type {{subject: string, policyRevision: string, permittedPrivacy: readonly string[]}} */ (
        await describePolicy(owner)
      )
      if (input.subject !== undefined && input.subject !== policy.subject) {
        throw new KiraStageError('subject-not-owner-supplied', 'candidate subject is not the host read-owner subject')
      }
      const privacy = input.privacy ?? (policy.permittedPrivacy.includes('local') ? 'local' : policy.permittedPrivacy[0])
      if (!policy.permittedPrivacy.includes(/** @type {string} */ (privacy))) {
        throw new KiraStageError('privacy-not-permitted', 'candidate privacy class is outside the host read-owner policy')
      }
      const staged = stageKiraMemoryRecord({
        kind: input.kind,
        content: input.content,
        createdAt: input.createdAt,
        subject: policy.subject,
        privacy,
        source: input.source ?? [],
        links: input.links ?? [],
        ...(input.transform === undefined ? {} : { transform: input.transform }),
      })

      // COMPUTE THE EXPECTED EFFECT BYTES BEFORE INSTANTIATING THE PINNED CELL.
      // Order is the whole point: if the cell is asked first, a cell that
      // proposed something else would be the thing that told us what to expect.
      // Here the record module decides what the bytes must be, the cell is
      // asked to reproduce them, and the two are compared. Because the cell
      // writes into a fixed linear memory, a proposal it cannot hold is refused
      // IN THE CELL rather than truncated, and the independent expectation
      // computed here stays the authority on the over-cap path too.
      const expectedBody = memoryEffectBody(staged.memoryPut)
      let memoryPut
      try {
        // Bound to the same object twice on purpose: the port's second binding
        // exists so a caller can retain an earlier snapshot of the arguments,
        // and staging has exactly one object. Staging still has its own
        // independently computed `expectedBody` above, so the binding check is
        // not what makes this safe.
        memoryPut = prover(staged.memoryPut, staged.memoryPut, {
          expectedBody,
          expectedKey: staged.recordId,
          verify: verifyKiraMemoryRecord,
        })
      } catch (error) {
        // A refusal must be a REFUSAL, not a value. The stage output schema is
        // closed and every declared field is a success field, so there is no
        // envelope here in which "this failed" could be told truthfully as
        // data; the harness would reject the result outright. Throwing is also
        // what makes the message reach a model at all: this error is not a
        // harness error, so only its TEXT survives into the tool result, which
        // is why the reason is named in the sentence and not left to a field.
        const named = describeProposalRefusal(error, cellBudgetedBytes(staged.memoryPut))
        if (named !== null) throw new KiraStageError(named.code, named.message)
        throw new KiraStageError(
          'proposal-cell-refused',
          `the pinned proposal cell refused this record: ${error instanceof Error ? error.message : String(error)}. Nothing was written.`,
        )
      }
      // ── THE PENDING REVIEW QUEUE ─────────────────────────────────────────────────────────────────
      // Only when the composition configured one. A record staged inside a turn used to evaporate when
      // the turn ended, so an owner could not review what nobody had written down. With a queue named,
      // the staged bytes become a durable entry a person can approve or ignore.
      //
      // ENQUEUED AFTER THE CELL HAS AGREED, deliberately: the cell proves the proposal is the bytes the
      // record module computed, and queueing before it would leave a REFUSED proposal sitting in a
      // review list where a person might approve it.
      const queued = queue === undefined ? undefined : queue.enqueuePending(staged)
      return {
        state: 'proposed',
        // TRUE ONLY WHEN THIS CALL ACTUALLY CREATED AN ENTRY. Re-staging identical bytes is idempotent,
        // and the second staging writes nothing — so reporting `wrote: true` there would overstate what
        // happened in exactly the way this field exists to prevent.
        wrote: queued?.state === 'queued',
        recordId: staged.recordId,
        subject: policy.subject,
        privacy: /** @type {string} */ (privacy),
        record: staged.record,
        memoryPut,
        // Named, not stored. A caller reading this result learns that no admitted
        // memory producer exists, so it cannot mistake a proposal for a settled
        // record that a later recall would find.
        settlement,
        // NO FILESYSTEM PATH REACHES A MODEL HERE: the entry is named by its record identifier, and
        // where the queue lives is the composition's business rather than the caller's.
        ...(queued === undefined ? {} : { queued: { state: queued.state, recordId: queued.recordId } }),
        ceiling: queued === undefined ? KIRA_STAGE_CEILING : KIRA_STAGE_QUEUE_CEILING,
      }
    },
    presentCall(args) {
      const input = /** @type {Record<string, unknown>} */ (args)
      const kind = typeof input.kind === 'string' ? input.kind : 'record'
      return { card: 'generic', title: `Stage ${kind} (no write)`, kind: 'other', rawInput: kind }
    },
  })
}

/** A named `kira.settle` refusal; its own route name, never the conversation's. */
export class KiraSettleError extends Error {
  /**
   * The ceilings, carried on every refusal this tool raises.
   *
   * The tool REFUSES BY THROWING, so before this field existed a refused settle reached a caller with a
   * name and nothing about what the mechanism does not prove, while the accepted path returned eight
   * named limits. THE LIST IS READ OFF THE OWNER INSTANCE, not imported from its module: this tool is
   * the model-facing boundary and the recall court enforces that it does not import the settlement
   * owner at all. An earlier version of this fix did import it, and that court went red within the
   * minute — which is the boundary working, and the reason the owner exposes `ceilings` itself.
   */
  ceilings

  /** @param {string} code @param {string} message @param {readonly string[]} [ceilings] */
  constructor(code, message, ceilings = undefined) {
    super(`kira.settle: ${message}`)
    this.name = 'KiraSettleError'
    this.code = `kira.settle:${code}`
    if (ceilings !== undefined) this.ceilings = ceilings
  }
}

/**
 * The `kira.settle` code for one approval refusal, derived from the refusal's own name.
 *
 * `APPROVAL_CONTENT_MISMATCH` becomes `approval-content-mismatch`, `APPROVAL_REPLAY` becomes
 * `approval-replay`, and so on: a caller reading the tool result learns WHICH check refused without
 * parsing prose, and a new refusal in the approval module cannot arrive under a borrowed name.
 * @param {unknown} code - the refusal code from the approval module.
 * @returns {string} the settle-route code.
 */
function approvalCode(code) {
  return typeof code === 'string' && code.startsWith('APPROVAL_')
    ? code.slice('APPROVAL_'.length).toLowerCase().replaceAll('_', '-')
    : 'unavailable'
}

/**
 * Build the `kira_settle` definition.
 *
 * Registered ONLY when a memory owner is configured, so a build without one
 * cannot offer a write it has no path to perform.
 *
 * TWO OPERATOR DOCUMENTS, AND THE MODEL SUPPLIES NEITHER. The tool reads them from the files the
 * composition names, at call time:
 *
 *   the GRANT      this installation's one-use authorization for exactly these bytes;
 *   the APPROVAL   the owner's signed approval, whose operation digest must match the bytes being
 *                  settled.
 *
 * `confirm: true` is required and is still only a statement of intent. It is not a grant, it is not
 * an approval, and this tool refuses when either document is absent rather than minting one: a turn
 * cannot mint, cannot approve itself, and cannot substitute bytes. Presenting an approval for other
 * content is refused by name and consumes nothing.
 *
 * @param {Readonly<{settleAuthorized: (command: unknown) => unknown}>} owner - the admitted memory owner.
 * When `approverDid` is supplied, verification requires the approval to be signed by THAT key; a
 * bundle signed by any other key is refused by name. Without it, the verdict says only that a key the
 * bundle names signed the bytes, and `APPROVER_PINNED` carries that limit.
 * @param {() => unknown} readAuthorization - reads the operator-minted authorization.
 * @param {() => unknown} readApproval - reads the owner's approval bundle.
 * @param {string} subject - the subject this owner serves.
 * @param {string} [approverDid] - the registered approver `did:key`, when the composition pins one.
 * @returns {Readonly<Record<string, unknown>>} the tool definition.
 */
export function settleTool(owner, readAuthorization, readApproval, subject, approverDid, activeControlDigest) {
  return Object.freeze({
    name: KIRA_SETTLE_TOOL_NAME,
    description:
      'Settle the memory record an operator has authorized, by presenting the one-use grant and the owner '
      + 'approval that bind exactly those bytes. This performs a governed transition: the approval and the '
      + 'nonce are each consumed once, a signed receipt is written, and one Aura entry is appended. It does '
      + 'NOT mint a grant and does NOT approve anything — both documents come from operator commands, and '
      + 'without either this tool refuses and writes nothing. Settling bytes the approval does not bind is '
      + 'refused.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true. Settling is a durable write; the flag makes the intent explicit in the log.',
        },
      },
      required: ['confirm'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          settled: { type: 'boolean' },
          recordId: { type: 'string' },
          sequence: { type: 'integer' },
          head: { type: 'string' },
          contentSha256: { type: 'string' },
          approvalId: { type: 'string' },
          receipt: { type: 'object', additionalProperties: true, properties: {}, required: [] },
          ceilings: { type: 'array', items: { type: 'string' } },
          // WHICH PINS WERE ACTUALLY APPLIED. `additionalProperties: false` makes a field the tool
          // RETURNS but does not DECLARE more than a cosmetic omission: the runtime validates a tool's
          // output against this schema and REJECTS the whole result, so the settlement SUCCEEDS and the
          // caller is handed an invalid-output error instead of a receipt. MEASURED on CI run
          // 35562773363 — the aura-settlement-binding court failed with
          // `tool "kira_settle" returned invalid output: "value.approverPinned" is not a declared
          // property (additionalProperties: false)` on every arm that settles through the tool.
          //
          // NO FILE PATH IN THIS COMMENT, deliberately. The recall court enforces a write boundary
          // over this plugin's sources with a SUBSTRING rule that matches the test-adapter module name
          // and the test-directory prefix. A single mention of either is enough to trip it — measured:
          // writing one here turned that court RED in CI, and the failure read
          // `tools.mjs: uses the disposable test adapter` with no hint that prose was the cause. That
          // rule is judged on substrings rather than imports, so this comment names the court by its
          // subject and spells no path at all.
          //
          // The library computed both, and `execute` below carries both out on purpose — the defect
          // that motivated carrying them was DROPPING them at this boundary. This schema then dropped
          // the same value at the NEXT boundary, which is why the pair is declared here rather than
          // removed from the return.
          approverPinned: { type: 'boolean' },
          controlPinned: { type: 'boolean' },
        },
        required: ['settled', 'recordId', 'sequence', 'head', 'contentSha256', 'receipt', 'ceilings'],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      assertParameters(SETTLE_PARAMETERS, args)
      const input /** @type {Record<string, unknown>} */ = args
      // THE CEILINGS EVERY REFUSAL BELOW CARRIES, read off the owner instance rather than imported: this
      // boundary may not depend on the settlement module, and the owner already publishes the list.
      const ceilings = Array.isArray(owner?.ceilings) ? owner.ceilings : undefined
      if (input.confirm !== true) {
        throw new KiraSettleError('settle-not-confirmed', 'set confirm:true to perform a durable write', ceilings)
      }
      // THE OWNER APPROVAL FIRST. It is the act that decides whether a write may happen at all, so it
      // is read and reported before the grant: a turn with no approval learns that, not something
      // about a grant it also does not have.
      let approval
      try {
        approval = readApproval()
      } catch (error) {
        throw new KiraSettleError('approval-unreadable', `no owner approval could be read: ${error?.code ?? 'unreadable'}`, ceilings)
      }
      if (approval === undefined || approval === null) {
        throw new KiraSettleError(
          'approval-absent',
          'no owner approval is present; this tool refuses and writes nothing, because a grant and a `confirm:true` flag are not an approval',
          ceilings,
        )
      }
      let authorization
      try {
        authorization = readAuthorization()
      } catch (error) {
        throw new KiraSettleError('grant-unreadable', `no operator authorization could be read: ${error?.code ?? 'unreadable'}`, ceilings)
      }
      if (authorization === undefined || authorization === null) {
        throw new KiraSettleError(
          'grant-absent',
          'no operator-minted grant is present; this tool refuses and writes nothing rather than minting one itself',
          ceilings,
        )
      }
      let settled
      try {
        settled = /** @type {Record<string, unknown>} */ (owner.settleAuthorized({
          authorization, approval, subject,
          ...(approverDid === undefined ? {} : { approverDid }),
          // The control head this deployment CURRENTLY serves. Without it the tool settles unpinned
          // however good the library is — the reachability gap a contextless subagent measured on
          // 2026-09-21: the refusal existed in the running bytes and nothing could ever reach it.
          ...(activeControlDigest === undefined ? {} : { activeControlDigest }),
        }))
      } catch (error) {
        // A refusal on the write path keeps its own NAME. Collapsing it into one generic failure
        // would erase the difference between "this approval was already used" and "this approval
        // does not bind these bytes" — two facts that call for different actions.
        // BY NAME, NOT BY THE GENERIC RULE. `approvalCode` strips the `APPROVAL_` prefix, so it would
        // yield `kira.settle:declined`. The refusal a DECISION makes is an approval refusal and must say
        // so: a reader comparing this against the approving lane's vocabulary is looking for this exact
        // name, and `declined` alone reads like a property of the request rather than of an approval.
        if (error?.code === 'APPROVAL_DECLINED') {
          throw new KiraSettleError('approval-declined',
            String(error.message ?? 'the latest decision for this grant is a decline'), error?.ceilings ?? ceilings)
        }
        if (typeof error?.code === 'string' && error.code.startsWith('APPROVAL_')) {
          throw new KiraSettleError(approvalCode(error.code), String(error.message ?? 'approval refused'), error?.ceilings ?? ceilings)
        }
        throw error
      }
      return {
        settled: true,
        recordId: /** @type {Record<string, unknown>} */ (settled.receipt).recordId,
        sequence: settled.sequence,
        head: settled.head,
        contentSha256: settled.contentSha256,
        approvalId: settled.approvalId,
        // WHICH PINS WERE ACTUALLY APPLIED. MEASURED DEFECT, 2026-09-21, found by a contextless
        // subagent auditing this deployment: `settleAuthorized` was made to report
        // `approverPinned`/`controlPinned`, and THIS boundary rebuilt the object and dropped both —
        // so the diagnostic never reached a model and `controlPinned: false` was invisible exactly
        // where a reader needed it. Carrying a value out of the library and dropping it at the tool
        // boundary is the same defect as never computing it.
        approverPinned: settled.approverPinned,
        controlPinned: settled.controlPinned,
        receipt: settled.receipt,
        ceilings: settled.ceilings,
      }
    },
    presentCall() {
      return { card: 'generic', title: 'Settle the authorized memory record', kind: 'other', rawInput: KIRA_SETTLE_TOOL_NAME }
    },
  })
}

/** Declared parameter schema for the `kira_settle` tool. */
export const SETTLE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    confirm: { type: 'boolean', description: 'Must be true.' },
  },
  required: ['confirm'],
}

/**
 * Build the `kira_recall` definition.
 * @param {(exec: Readonly<Record<string, unknown>>, request: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>} dispatch - session dispatcher.
 * @returns {Readonly<Record<string, unknown>>} the tool definition.
 */
export function recallTool(dispatch) {
  return Object.freeze({
    name: KIRA_RECALL_TOOL_NAME,
    description:
      'Retrieve cited records from the subject memory the host read owner makes visible. Returns verified record '
      + 'excerpts with Aura citations, never a generated answer. Store availability (found, empty, undetermined) is '
      + `reported separately from retrieval status (match, ambiguous, insufficient, exhausted). Ask a question, then `
      + `use more, select, not-that, clarify: original|current, new, or stop within at most ${RETRIEVAL_LIMITS.references} references. `
      + 'The subject and permitted privacy classes come from the host and cannot be chosen or widened here. '
      + 'remembered holds the automatic notes: matched by meaning (method openviking-semantic) when the owner installed OpenViking, '
      + 'only notes the chained store holds, each with its bodyAtCapture; unavailable indexing is reported explicitly.',
    parameters: RECALL_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          availability: { type: 'string', enum: ['found', 'empty', 'undetermined'] },
          status: { type: 'string', enum: ['match', 'ambiguous', 'insufficient', 'exhausted'] },
          grantsAuthority: { type: 'boolean' },
          reason: { type: 'string' },
          subject: { type: 'string' },
          policyRevision: { type: 'string' },
          permittedPrivacy: { type: 'array', items: { type: 'string' } },
          snippets: { type: 'array', items: {} },
          relations: { type: 'array', items: {} },
          interpretation: { type: 'object', additionalProperties: true, properties: { kind: { type: 'string' } }, required: ['kind'] },
          unmatchedTerms: { type: 'array', items: { type: 'string' } },
          retrieval: { type: 'object', additionalProperties: true, properties: {}, required: [] },
          bounds: { type: 'object', additionalProperties: true, properties: {}, required: [] },
          ceiling: { type: 'array', items: { type: 'string' } },
          state: { type: 'object', additionalProperties: true, properties: {}, required: [] },
          counters: { type: 'object', additionalProperties: true, properties: {}, required: [] },
          remembered: { type: 'object', additionalProperties: true, properties: {}, required: [] },
          memory: { type: 'object', additionalProperties: false, properties: {
            dropped: { type: 'integer' }, reasons: { type: 'object', additionalProperties: true },
            hashMismatches: { type: 'integer' },
          }, required: ['dropped', 'reasons'] },
          // *** DECLARED, NOT STRIPPED, AND THIS FIELD IS WHY. *** `reconcileRecallAvailability`
          // returns `partialFailure` on every reconciled answer, and this schema's
          // `additionalProperties: false` REJECTED THE WHOLE TOOL RESULT while the field was
          // undeclared — so `kira_recall` failed live in the installed app for every non-empty
          // query (2026-09-29, release 7933048d7: `"value.partialFailure" is not a declared
          // property`). Every court was green. The enums are the policy's own arrays, so a new
          // action or availability value breaks the import instead of the running tool.
          partialFailure: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: { type: 'string', enum: [...PARTIAL_FAILURE_ACTIONS] },
              reason: { type: 'string' },
              outer: { type: 'string', enum: [...STORE_AVAILABILITY] },
              remembered: { type: 'string', enum: [...REMEMBERED_STATES] },
              reconciledAvailability: { type: 'string', enum: [...STORE_AVAILABILITY] },
            },
            required: ['action', 'reason', 'outer', 'remembered', 'reconciledAvailability'],
          },
        },
        required: ['availability', 'status', 'snippets', 'relations', 'interpretation', 'retrieval', 'ceiling', 'state'],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      assertParameters(RECALL_PARAMETERS, args)
      const answer = await dispatch(exec, /** @type {Record<string, unknown>} */ (args))
      // The harness schema subset cannot express nonnegative counts or typed dictionary values.
      const memory = answer?.memory, count = value => Number.isInteger(value) && value >= 0
      if (memory !== undefined && (!memory || !count(memory.dropped) || !memory.reasons
        || typeof memory.reasons !== 'object' || Array.isArray(memory.reasons) || !Object.values(memory.reasons).every(count)
        || (memory.hashMismatches !== undefined && !count(memory.hashMismatches)))) {
        throw new TypeError('kira_recall: memory counts must be non-negative integers')
      }
      return answer
    },
    presentCall(args) {
      const input = /** @type {Record<string, unknown>} */ (args)
      const title = typeof input.text === 'string' && input.text !== ''
        ? `Recall: ${input.text.slice(0, 80)}`
        : `Recall: ${typeof input.action === 'string' ? input.action : 'query'}`
      return { card: 'generic', title, kind: 'read', rawInput: title }
    },
  })
}

/**
 * THE REMEMBERED TIER IN `kira_recall` (2026-09-27; it read signed records only). The question's words (3+ letters) go through the
 * Memory app's own `listNotes`, ranked by how many match; each hit keeps its `bodyAtCapture` (`null` = UNKNOWN). Never authority.
 */
export async function recallRemembered(listNotes, text, limit = 5, govern = notes => notes) {
  const terms = [...new Set(String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length >= 3))]
  if (typeof listNotes !== 'function' || terms.length === 0) return { state: 'not-asked', notes: [] }
  let notes
  // EVERY MATCH, THEN RARER WORDS WEIGH MORE (2026-09-27 review): capped at 500 in file order and scored by a plain count, a
  // 701-note store answered "where is the quokka figurine" with five notes that only shared "where" and "the".
  try { notes = await listNotes({ tiers: ['remembered'], q: terms.join(' '), limit: Number.MAX_SAFE_INTEGER }) } catch (error) { return { state: 'undetermined', reason: String(error?.code ?? error?.message).slice(0, 200), notes: [] } }
  notes = govern(notes).map(note => ({ ...note, text: note.statement ?? note.text }))
    .filter(note => terms.some(term => String(note.text).toLowerCase().includes(term)))
  const has = notes.map(note => new Set(terms.filter(term => String(note.text).toLowerCase().includes(term))))
  const weight = new Map(terms.map(term => [term, 1 / Math.max(1, has.filter(set => set.has(term)).length)]))
  const score = new Map(notes.map((note, at) => [note, [...has[at]].reduce((sum, term) => sum + weight.get(term), 0)]))
  return {
    state: notes.length === 0 ? 'empty' : 'found', grantsAuthority: false,
    notes: notes.sort((a, b) => score.get(b) - score.get(a)).slice(0, limit).map(note => ({
      id: note.id, text: String(note.text).slice(0, 600), observedAt: note.observedAt ?? null,
      contentHash: note.contentHash, contentHashScope: 'full-statement', tier: note.tier,
      source: { sessionId: note.source?.sessionId ?? null, seq: note.source?.seq ?? null }, bodyAtCapture: note.bodyAtCapture ?? null,
      ...(note.containment ? { advisoryOnly: true, grantsAuthority: false, containment: note.containment, staleness: note.staleness } : {}),
    })),
  }
}

/** Declared parameter schema for the `kira_queue` tool. */
export const QUEUE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'show'],
      description: 'Defaults to list. show returns one queued record by its recordId, as a listing reports it.',
    },
    recordId: {
      type: 'string',
      description: 'For show: the deterministic record identifier of one queued entry.',
    },
  },
  required: [],
}

/**
 * Build the `kira_queue` definition.
 *
 * REGISTERED ONLY WHEN A QUEUE IS CONFIGURED, the same way `kira_settle` is registered only when a
 * memory owner is: a build with no queue has nothing to list, and a listing tool that could only ever
 * answer "nothing here" would make an unconfigured build look like a reviewed-clean one.
 *
 * READ-ONLY, AND THERE IS NO WRITE ACTION TO ADD. Approving a queued record is the owner's act through
 * the approval channel — a one-use grant and a signed approval over the exact bytes — so this tool
 * cannot approve, mint, settle or delete. Removing an entry is likewise an operator act. A model able
 * to clear its own review queue would be a model able to hide what it staged.
 *
 * @param {Readonly<{list: () => Readonly<Record<string, unknown>>, read: (recordId: string) => Readonly<Record<string, unknown>>}>} queue - the owner's queue route.
 * @returns {Readonly<Record<string, unknown>>} the tool definition.
 */
export function queueTool(queue) {
  return Object.freeze({
    name: KIRA_QUEUE_TOOL_NAME,
    description:
      'List the KIRA records that were staged for review and not yet settled, so a person can decide what to '
      + 'approve. Read-only: this tool cannot approve, mint, settle or delete anything, and a queued record is not '
      + 'stored memory — it is not recallable and it grants nothing. Each entry carries its record identifier, kind, '
      + "the record's own createdAt and its text; an entry whose bytes no longer verify is reported with the reason "
      + 'rather than dropped, and a listing that stopped at its bound says so.',
    parameters: QUEUE_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string', enum: ['never-queued', 'empty', 'pending', 'settled', 'declined', 'absent', 'unreadable'] },
          settled: { type: 'boolean' },
          // DECLARED, NOT MERELY RETURNED. `additionalProperties: false` makes this schema a gate on the
          // whole result: the runtime validates a tool's output and REJECTS it outright, so a field the
          // tool returns but does not declare turns a correct answer into an invalid-output error. Not
          // hypothetical here — it is the defect this file already records from CI run 35562773363, and
          // it was reintroduced for exactly one run when `declined` was added to the row and not here.
          declined: { type: 'boolean' },
          recordId: { type: 'string' },
          kind: { type: 'string' },
          createdAt: { type: 'string' },
          record: {},
          reason: { type: 'string' },
          total: { type: 'integer' },
          returned: { type: 'integer' },
          pending: { type: 'integer' },
          truncated: { type: 'boolean' },
          entries: {
            type: 'array',
            // THE ROW SCHEMA IS CLOSED AND ENUMERATED, because `additionalProperties: false` makes this
            // schema a gate on the WHOLE result: a field the tool returns and does not declare turns a
            // correct answer into an invalid-output error. MEASURED on this very surface when `declined`
            // reached the row and not the schema.
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                state: { type: 'string' },
                settled: { type: 'boolean' },
                declined: { type: 'boolean' },
                recordId: { type: 'string' },
                kind: { type: 'string' },
                createdAt: { type: 'string' },
                privacy: { type: 'string' },
                text: { type: 'string' },
                truncated: { type: 'boolean' },
                omittedChars: { type: 'integer' },
                classification: { type: 'string' },
                classificationCeiling: { type: 'string' },
                proposalDigest: { type: 'string' },
                queueMtimeMs: { type: 'number' },
                // `show`-only fields an unreadable row carries instead of a record.
                name: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['state'],
            },
          },
          proposalDigest: { type: 'string' },
          omittedChars: { type: 'integer' },
          classification: { type: 'string' },
          classificationCeiling: { type: 'string' },
          ceiling: { type: 'array', items: { type: 'string' } },
        },
        required: ['state', 'ceiling'],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      assertParameters(QUEUE_PARAMETERS, args)
      const input = /** @type {Record<string, unknown>} */ (args)
      if ((input.action ?? 'list') === 'show') {
        if (typeof input.recordId !== 'string' || input.recordId === '') {
          throw new KiraQueueError('record-id-missing', 'show needs the recordId of one queued entry, exactly as a listing reports it')
        }
        const found = /** @type {Record<string, unknown>} */ (queue.read(input.recordId))
        if (found.state === 'pending') {
          const entry = /** @type {Record<string, unknown>} */ (found.entry)
          return {
            // A RECORD THE STORE HOLDS IS NOT AWAITING A DECISION. Reporting it as pending would invite a
            // second approval for bytes that were already written, and a second approval is a second
            // authorization rather than a correction.
            state: found.settled === true ? 'settled' : (found.declined === true ? 'declined' : 'pending'),
            settled: found.settled === true,
            declined: found.declined === true,
            recordId: entry.recordId,
            kind: entry.kind,
            createdAt: entry.createdAt,
            record: entry.record,
            // THE SAME TWO NUMBERS THE LISTING ROW CARRIES, so `show` answers "which bytes?" and "how much
            // was cut?" for the one record a reader has focused — the question they ask second.
            proposalDigest: kiraRecordContentSha256(/** @type {Record<string, unknown>} */ (entry.record)),
            omittedChars: reviewTextOf(entry).omittedChars,
            ceiling: KIRA_QUEUE_CEILING,
          }
        }
        // `absent` and `unreadable` are DIFFERENT ANSWERS and both are answers: one says this name was
        // never queued, the other says it was and can no longer be established. Neither is silence.
        return {
          state: String(found.state),
          recordId: input.recordId,
          ...(typeof found.reason === 'string' ? { reason: found.reason } : {}),
          ceiling: KIRA_QUEUE_CEILING,
        }
      }
      const listing = /** @type {Record<string, unknown>} */ (queue.list())
      return {
        // A QUEUE THAT WAS NEVER CREATED IS NOT AN EMPTY QUEUE. The directory is made on first enqueue,
        // so its absence is the observation that nothing was ever staged here — and reporting that as
        // `empty` would let "nobody wrote anything down" read as "everything was reviewed".
        //
        // AND A QUEUE WITH NOTHING LEFT TO DECIDE IS NOT A BACKLOG: when every entry has been settled the
        // state is `settled`, which is a different fact from `empty` (nothing was ever queued) and from
        // `pending` (a person still has something to look at).
        state: listing.exists !== true
          ? 'never-queued'
          : (listing.total === 0
            ? 'empty'
            : (listing.pending > 0
              ? 'pending'
              : (listing.entries.some(row => row.state === 'declined') ? 'declined' : 'settled'))),
        total: listing.total,
        returned: listing.returned,
        pending: listing.pending,
        truncated: listing.truncated,
        entries: listing.entries,
        ceiling: KIRA_QUEUE_CEILING,
      }
    },
    presentCall(args) {
      const input = /** @type {Record<string, unknown>} */ (args)
      const action = typeof input.action === 'string' ? input.action : 'list'
      return { card: 'generic', title: `Review queue: ${action}`, kind: 'read', rawInput: action }
    },
  })
}

/**
 * Read the owner's declared policy through the shared validator.
 * @param {Readonly<{describe: () => Promise<unknown>}>} owner - injected read owner.
 * @returns {Promise<unknown>} the validated policy.
 */
async function describePolicy(owner) {
  return readOwnerPolicy(await owner.describe())
}

/** Re-exported so `index.js` and tests share one refusal class. */
export { KiraStageError, KiraConversationError }
