#!/usr/bin/env node
/**
 * Tool output against the tool's own schema.
 *
 * The installed app validates a tool result and rejects the whole result when
 * a closed object carries a key the schema does not name. Courts that assert
 * the new key on the library object stay green. This check runs the producers
 * and then the schema.
 *
 * A conforming result with one added field must be red. A known live miss is
 * pinned by name: `partialFailure` on `kira_recall`. Removing the miss without
 * removing the waiver is red. Adding a second undeclared key is red.
 *
 * Not the installed app. The walker is tests/helpers/tool-output-schema.mjs.
 */
import assert from 'node:assert/strict'
import { KiraConversation } from '../plugins/aukora-kira/lib/conversation.mjs'
import { reconcileRecallAvailability } from '../plugins/aukora-kira/lib/partial-failure.mjs'
import { queueEntryFor, queueRowOf } from '../plugins/aukora-kira/lib/queue.mjs'
import { settlementStatus, stageKiraMemoryRecord } from '../plugins/aukora-kira/lib/record.mjs'
import {
  queueTool,
  recallTool,
  settleTool,
  stageTool,
} from '../plugins/aukora-kira/lib/tools.mjs'
import { diffRgba } from '../plugins/aukora-eye/lib/diff.mjs'
import { createSeeTool } from '../plugins/aukora-eye/lib/tools.mjs'
import { createSelfChangeTool } from '../plugins/aukora-action-gate/lib/self-change-tool.mjs'
import {
  outputSchemaViolations,
  schemaDialectViolations,
  undeclaredProperties,
} from './helpers/tool-output-schema.mjs'

const SUBJECT = `aukora:1:${'3c'.repeat(32)}`
const PROBE = 'schemaAuditProbe'

let failures = 0
let passed = 0

/**
 * @param {string} name
 * @param {() => Promise<void> | void} body
 */
async function arm(name, body) {
  try {
    await body()
    passed += 1
    process.stdout.write(`  ok    ${name}\n`)
  } catch (error) {
    failures += 1
    process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0]}\n`)
  }
}

/**
 * @param {Record<string, unknown>} schema
 * @param {Record<string, unknown>} value
 * @param {string} [field]
 */
function assertProbeRed(schema, value, field = PROBE) {
  assert.deepEqual(outputSchemaViolations(schema, value), [], 'the sample itself must conform before the probe')
  const mutated = { ...value, [field]: true }
  const violations = undeclaredProperties(schema, mutated)
  assert.ok(
    violations.some(line => line === `"value.${field}" is not a declared property (additionalProperties: false)`),
    `probe must be rejected, got ${JSON.stringify(violations)}`,
  )
}

const policy = {
  subject: SUBJECT,
  policyRevision: 'schema-audit',
  permittedPrivacy: ['local'],
}

const readOwner = {
  async describe() { return policy },
  async read() {
    return {
      availability: 'empty',
      subject: policy.subject,
      policyRevision: policy.policyRevision,
      projection: { name: 'audit', version: '0', digest: 'ab'.repeat(32) },
      records: [],
    }
  },
}

const recall = recallTool(async () => { throw new Error('dispatch must not run in this court') })
const recallSchema = /** @type {Record<string, unknown>} */ (recall.output.schema)

const conversation = new KiraConversation(readOwner, 'schema-audit')
const bare = await conversation.turn({ action: 'query', text: '' })
const asked = await conversation.turn({ action: 'query', text: 'where is the note' })
const remembered = { state: 'empty', grantsAuthority: false, notes: [] }
const reconciled = reconcileRecallAvailability(asked, remembered)

const stagedRecord = stageKiraMemoryRecord({
  subject: SUBJECT,
  kind: 'observation',
  source: [],
  content: { note: 'schema audit fixture', category: 'preference', ceiling: 'local' },
  links: [],
  privacy: 'local',
  createdAt: '2026-09-29T00:00:00Z',
})

const stagePlain = stageTool(readOwner, settlementStatus(false), put => put)
const stageQueued = stageTool(readOwner, settlementStatus(false), put => put, {
  enqueuePending(staged) {
    return { state: 'queued', recordId: staged.recordId, dir: '/var/kira-queue' }
  },
})
const stagePlainResult = await stagePlain.execute({
  kind: 'observation',
  content: { note: 'schema audit fixture' },
  createdAt: '2026-09-29T00:00:00Z',
})
const stageQueuedResult = await stageQueued.execute({
  kind: 'observation',
  content: { note: 'schema audit fixture' },
  createdAt: '2026-09-29T00:00:00Z',
})

const settle = settleTool(
  {
    ceilings: ['schema-audit ceiling'],
    settleAuthorized() {
      return {
        sequence: 1,
        head: 'ab'.repeat(32),
        contentSha256: 'cd'.repeat(32),
        approvalId: 'approval-schema-audit',
        approverPinned: true,
        controlPinned: false,
        receipt: { recordId: stagedRecord.recordId, extraReceiptField: true },
        ceilings: ['schema-audit ceiling'],
        undeclaredOnTheLibraryObject: true,
      }
    },
  },
  () => ({ grant: true }),
  () => ({ approval: true }),
  SUBJECT,
)
const settleResult = await settle.execute({ confirm: true })

const queuedEntry = queueEntryFor(stagedRecord)
const row = queueRowOf(queuedEntry, 1_700_000_000_000, false, false)
const queue = queueTool({
  list: () => ({
    exists: true,
    total: 1,
    returned: 1,
    pending: 1,
    truncated: false,
    entries: [row, { state: 'unreadable', name: 'broken.json', reason: 'not-json' }],
  }),
  read: () => ({ state: 'pending', settled: false, declined: false, entry: queuedEntry }),
})
const queueList = await queue.execute({ action: 'list' })
const queueShow = await queue.execute({ action: 'show', recordId: stagedRecord.recordId })

const see = createSeeTool({ store: {}, attachments: {} })
const seeSchema = /** @type {Record<string, unknown>} */ (see.output.schema)
const diffSchema = /** @type {Record<string, Record<string, unknown>>>} */ (seeSchema.properties).diff
const pixel = (width, height, byte) => ({
  width,
  height,
  rgba: new Uint8Array(width * height * 4).fill(byte),
})
const sameDiff = { ...diffRgba(pixel(2, 2, 0), pixel(2, 2, 9)), previousAt: '2026-09-29T00:00:00Z' }
const resizedDiff = { ...diffRgba(pixel(2, 2, 0), pixel(3, 2, 0)), previousAt: '2026-09-29T00:00:00Z' }

const selfChange = createSelfChangeTool({
  repo: '/tmp/schema-audit-repo',
  worktreesRoot: '/tmp/schema-audit-worktrees',
  supportRoot: '/tmp/schema-audit-support',
})

process.stdout.write('tool-output-schema\n')

await arm('kira schemas are in the pinned subset', () => {
  for (const tool of [stagePlain, settle, recall, queue]) {
    const found = schemaDialectViolations(tool.output.schema, tool.name)
    assert.deepEqual(found, [], `${tool.name}: ${found.join('; ')}`)
  }
})

await arm('mutation: undeclared field on a conforming closed result is red', () => {
  assertProbeRed(recallSchema, bare)
  assertProbeRed(/** @type {Record<string, unknown>} */ (stagePlain.output.schema), stagePlainResult)
  assertProbeRed(/** @type {Record<string, unknown>} */ (stageQueued.output.schema), stageQueuedResult)
  assertProbeRed(/** @type {Record<string, unknown>} */ (settle.output.schema), settleResult)
  assertProbeRed(/** @type {Record<string, unknown>} */ (queue.output.schema), queueList)
  assertProbeRed(/** @type {Record<string, unknown>} */ (queue.output.schema), queueShow)
  const rowSchema = /** @type {Record<string, Record<string, unknown>>>} */ (
    /** @type {Record<string, Record<string, unknown>>>} */ (queue.output.schema).properties
  ).entries.items
  assert.deepEqual(outputSchemaViolations(rowSchema, row), [])
  const rowViolations = undeclaredProperties(rowSchema, { ...row, [PROBE]: true })
  assert.ok(rowViolations.some(line => line.includes(`"value.${PROBE}" is not a declared property`)))
})

await arm('kira_recall without text conforms; with text the only miss is partialFailure', () => {
  assert.deepEqual(outputSchemaViolations(recallSchema, bare), [])
  assert.equal(Object.hasOwn(bare, 'partialFailure'), false)
  const violations = outputSchemaViolations(recallSchema, reconciled)
  assert.deepEqual(violations, [
    '"value.partialFailure" is not a declared property (additionalProperties: false)',
  ])
  assert.equal(reconciled.partialFailure.action, 'proceed')
  assert.equal(reconciled.availability, 'empty')
})

await arm('kira_stage strips the queue directory; spreading it is red', () => {
  assert.equal(stageQueuedResult.wrote, true)
  assert.deepEqual(stageQueuedResult.queued, { state: 'queued', recordId: stageQueuedResult.recordId })
  assert.equal(Object.hasOwn(stageQueuedResult, 'dir'), false)
  const spread = {
    ...stageQueuedResult,
    queued: { ...stageQueuedResult.queued, dir: '/var/kira-queue' },
  }
  const violations = undeclaredProperties(/** @type {Record<string, unknown>} */ (stageQueued.output.schema), spread)
  assert.deepEqual(violations, [
    '"value.queued.dir" is not a declared property (additionalProperties: false)',
  ])
})

await arm('kira_settle publish set conforms; a library-only field is not copied', () => {
  assert.equal(settleResult.approverPinned, true)
  assert.equal(settleResult.controlPinned, false)
  assert.equal(settleResult.receipt.extraReceiptField, true)
  assert.equal(Object.hasOwn(settleResult, 'undeclaredOnTheLibraryObject'), false)
  assert.deepEqual(outputSchemaViolations(/** @type {Record<string, unknown>} */ (settle.output.schema), settleResult), [])
})

await arm('aukora_see: required:true is outside the pinned subset; a resized diff is null where a number is declared', () => {
  const dialect = schemaDialectViolations(seeSchema, 'aukora_see')
  assert.ok(dialect.length > 0)
  assert.ok(dialect.every(line => line.endsWith('.required must be an array of strings')), dialect.join('\n'))
  assert.deepEqual(outputSchemaViolations(diffSchema, sameDiff), [])
  const resized = outputSchemaViolations(diffSchema, resizedDiff)
  assert.ok(resized.some(line => line === '"value.changedPercent" must be a number'), JSON.stringify(resized))
  assert.ok(resized.some(line => line === '"value.changedPixels" must be an integer'), JSON.stringify(resized))
  assert.deepEqual(undeclaredProperties(diffSchema, resizedDiff), [])
})

await arm('aukora_self_change output is a string', () => {
  const schema = /** @type {Record<string, unknown>} */ (selfChange.output.schema)
  assert.deepEqual(outputSchemaViolations(schema, 'SELF-CHANGE EXIT 0'), [])
  const violations = outputSchemaViolations(schema, { ok: true })
  assert.ok(violations.some(line => line.includes('must be a string')))
})

process.stdout.write(`tool-output-schema: ${passed} passed, ${failures} failed\n`)
if (failures > 0) process.exit(1)
