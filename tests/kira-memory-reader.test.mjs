#!/usr/bin/env node
/**
 * One scratch-store check of the settled-memory reader and its recall callers.
 * Run normally for green; --mutate restores the factory-only mismatch in a
 * disposable copy of memory-recall-owner.mjs and must fail with zero reads.
 * The approver is the existing test double; this never opens the installed app.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { backfillTrackedMemory } from '../plugins/aukora-kira/lib/tracked-backfill.mjs'
import { createMemoryOwner } from '../plugins/aukora-kira/lib/memory-owner.mjs'
import { stageKiraMemoryRecord } from '../plugins/aukora-kira/lib/record.mjs'
import { createKiraRecallService, readOnlySurface } from '../plugins/aukora-kira/lib/recall-service.mjs'
import { makeRecordRanker } from '../plugins/aukora-kira/lib/memory-frame-adapter.mjs'
import { KiraConversation } from '../plugins/aukora-kira/lib/conversation.mjs'
import { recallTool } from '../plugins/aukora-kira/lib/tools.mjs'
import { registerRecallInjection } from '../plugins/aukora-kira/lib/injection.mjs'
import { buildRouteDeps } from '../plugins/aukora-kira/lib/memory-deps.mjs'
import { KIRA_ROUTES, routeRequest } from '../plugins/aukora-kira/lib/memory-routes.mjs'
import { createApprover } from './kira-approval-standin.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MUTATE = process.argv.includes('--mutate')
const SUBJECT = `aukora:1:${'3c'.repeat(32)}`
const WORDS = 'Cobalt orchard memory reader fixture'
const scratch = mkdtempSync(join(tmpdir(), 'kira-memory-reader-'))
assert.ok(!scratch.includes('Application Support'), 'the check requires disposable state')

try {
  const originalModule = join(ROOT, 'plugins/aukora-kira/lib/memory-recall-owner.mjs')
  let recallModule = originalModule
  if (MUTATE) {
    const source = readFileSync(originalModule, 'utf8')
    const fixed = 'second = recordsOf(await readOnlySurface(owner, policy).read())'
    assert.equal(source.split(fixed).length - 1, 1, 'the mutation must replace the fixed call exactly once')
    const oldCall = `if (typeof owner?.createReadOwner === 'function') {
              const narrowed = owner.createReadOwner(policy ?? {})
              if (narrowed !== null && typeof narrowed === 'object' && typeof narrowed.read === 'function') second = await narrowed.read()
            }`
    const mutated = source.replace(fixed, oldCall).replace(
      /from (['"])(\.[^'"]+)\1/gu,
      (_whole, quote, relative) => `from ${quote}${pathToFileURL(resolve(dirname(originalModule), relative)).href}${quote}`,
    )
    recallModule = join(scratch, 'memory-recall-owner-mutant.mjs')
    writeFileSync(recallModule, mutated, { mode: 0o600 })
    process.stdout.write('MUTANT: factory-only reader restored in a disposable module copy\n')
  }
  const { mergedReadOwner } = await import(pathToFileURL(recallModule).href)
  const stateDir = join(scratch, 'kira-memory')
  const owner = createMemoryOwner({ stateDir, subject: SUBJECT })
  const staged = stageKiraMemoryRecord({
    subject: SUBJECT, kind: 'observation', source: [], content: { note: WORDS },
    links: [], privacy: 'local', createdAt: '2026-09-27T00:00:00Z',
  })
  const approver = createApprover({ subject: SUBJECT })
  const settled = owner.settleAuthorized({
    authorization: { grant: owner.grantFor(staged.memoryPut), record: staged.record, subject: SUBJECT },
    approval: approver.approve(staged.memoryPut), subject: SUBJECT,
  })
  assert.equal(owner.verifyReceipt(settled.receipt).verdict, 'verified')
  const policy = { subject: SUBJECT, permittedPrivacy: ['local'] }
  const verified = owner.createReadOwner(policy)
  let verifiedCalls = 0
  const countedOwner = Object.freeze({
    describe: () => verified.describe(),
    read: request => { verifiedCalls += 1; return verified.read(request) },
  })
  const deps = buildRouteDeps({ stateDir, sessionsRoot: scratch, readOwner: countedOwner })
  const service = createKiraRecallService(
    readOnlySurface(mergedReadOwner({ storeDeps: deps, owner: countedOwner }), policy),
    { rank: makeRecordRanker() },
  )
  const conversation = new KiraConversation(countedOwner, 'reader-check-tool')
  const tool = recallTool((_exec, request) => conversation.turn(request))
  const injectionConversation = new KiraConversation(countedOwner, 'reader-check-injection')
  let preStep
  const injectionFailures = []
  registerRecallInjection({ on: (name, listener) => {
    if (name === 'agent/pre-step') preStep = listener
    return () => {}
  } }, {
    conversation: injectionConversation, queries: [WORDS], newId: () => 'reader-check-injection',
    onFailure: error => injectionFailures.push(error),
  })
  assert.equal(typeof preStep, 'function')

  const backfill = await backfillTrackedMemory({ stateDir, subject: SUBJECT })
  assert.equal(backfill.imported, 1)
  const callers = [
    ['kira.recall', () => service.recall(WORDS)],
    ['kira_recall', () => tool.execute({ action: 'query', text: WORDS }, {})],
    ['injection/snapshot', () => preStep({ agent: { session: {} } }, async () => ({ kind: 'continue', messages: [] }))],
    ['Memory list', () => routeRequest({ method: 'GET', path: KIRA_ROUTES.list, query: { tier: 'remembered' } }, deps)],
    ['Memory verify', () => routeRequest({ method: 'POST', path: KIRA_ROUTES.verify, body: { id: staged.recordId } }, deps)],
  ]
  for (const [name, call] of callers) {
    const before = verifiedCalls
    const answer = await call()
    const calls = verifiedCalls - before
    const recalled = JSON.stringify(answer).includes(WORDS)
    const verifies = name === 'Memory verify'
    process.stdout.write(`settled ${name}: verifiedCalls=${calls} ${verifies ? `source=${answer.body?.source}` : `recalled=${recalled}`}\n`)
    if (name === 'Memory list') assert.equal(calls, 0, 'ordinary memory reads the remembered chain, not approval evidence')
    else assert.ok(calls > 0, `${name} must call the verified reader (got ${calls})`)
    if (verifies) {
      assert.equal(answer.status, 200)
      assert.equal(answer.body.source, 'VERIFIED')
      assert.deepEqual(answer.body.citation, {
        recordId: staged.recordId, contentSha256: settled.contentSha256,
        auraSequence: settled.sequence, auraEntryHash: settled.head, verifiedHead: settled.head,
      })
    } else assert.ok(recalled, `${name} must recall the settled record`)
  }
  assert.deepEqual(injectionFailures, [], 'injection must not conceal a read failure')

  for (const [restriction, narrowedPolicy] of [
    ['subject', { subject: `aukora:1:${'5a'.repeat(32)}`, permittedPrivacy: ['local'] }],
    ['privacy', { subject: SUBJECT, permittedPrivacy: ['exportable'] }],
  ]) {
    const narrowed = owner.createReadOwner(narrowedPolicy)
    const scopedOwner = {
      describe: () => narrowed.describe(),
      read: request => { verifiedCalls += 1; return narrowed.read(request) },
    }
    const scopedDeps = buildRouteDeps({ stateDir, sessionsRoot: scratch, readOwner: scopedOwner })
    const scopedService = createKiraRecallService(readOnlySurface(
      mergedReadOwner({ storeDeps: scopedDeps, owner: scopedOwner }), narrowedPolicy,
    ), { rank: makeRecordRanker() })
    for (const [name, call] of [
      ['kira.recall', () => scopedService.recall(WORDS)],
      ['Memory list', () => routeRequest({ method: 'GET', path: KIRA_ROUTES.list, query: { tier: 'remembered' } }, scopedDeps)],
      ['Memory verify', () => routeRequest({ method: 'POST', path: KIRA_ROUTES.verify, body: { id: staged.recordId } }, scopedDeps)],
    ]) {
      const before = verifiedCalls
      const answer = await call()
      const calls = verifiedCalls - before
      const recalled = JSON.stringify(answer).includes(WORDS)
      process.stdout.write(`filtered ${restriction} ${name}: verifiedCalls=${calls} recalled=${recalled}\n`)
      if (name !== 'Memory list') assert.ok(calls > 0, `${name} must enforce ${restriction} through the verified reader`)
      assert.equal(recalled, false, `${name} must withhold a record outside the ${restriction} policy`)
      assert.notEqual(answer.body?.source, 'VERIFIED', 'an excluded record must not produce a verification claim')
      if (name === 'kira.recall') assert.equal(answer.status, 'empty')
      if (name === 'Memory list') assert.deepEqual(answer.body.items, [])
      if (name === 'Memory verify') assert.equal(answer.body.source, 'MISSING')
    }
  }

  const objectPath = join(stateDir, 'objects', `${settled.contentSha256}.json`)
  const receiptPath = join(stateDir, `receipt-memory.put-${String(settled.sequence).padStart(3, '0')}.json`)
  const chainPath = join(stateDir, 'aura.jsonl')
  const alterations = [
    ['object', objectPath, bytes => `${bytes}\n`],
    ['receipt', receiptPath, bytes => {
      const receipt = JSON.parse(bytes)
      receipt.sig = (receipt.sig[0] === '0' ? '1' : '0') + receipt.sig.slice(1)
      return `${JSON.stringify(receipt)}\n`
    }],
    ['Aura chain', chainPath, bytes => {
      const lines = bytes.trimEnd().split('\n')
      const entry = JSON.parse(lines[lines.length - 1])
      entry.hash = '0'.repeat(64)
      lines[lines.length - 1] = JSON.stringify(entry)
      return `${lines.join('\n')}\n`
    }],
  ]
  for (const [damage, path, alter] of alterations) {
    const intact = readFileSync(path, 'utf8')
    writeFileSync(path, alter(intact))
    try {
      for (const [name, call] of callers) {
        const before = verifiedCalls
        let answer
        try {
          answer = await call()
        } catch (error) {
          assert.match(String(error?.code ?? ''), /^kira\.deps:/u, `${name} must refuse by name`)
          answer = { refused: error.code }
        }
        const calls = verifiedCalls - before
        const recalled = JSON.stringify(answer).includes(WORDS)
        process.stdout.write(`tampered ${damage} ${name}: verifiedCalls=${calls} recalled=${recalled}\n`)
        if (name === 'Memory list') {
          assert.equal(calls, 0); assert.equal(recalled, true, 'migrated memory is independent of old approval evidence'); continue
        }
        assert.ok(calls > 0, `${name} must verify the damaged ${damage}`)
        assert.equal(recalled, false, `${name} must withhold the damaged ${damage}`)
        if (name === 'kira.recall') assert.equal(answer.status, 'undetermined')
        if (name === 'kira_recall') assert.equal(answer.availability, 'undetermined')
        if (name === 'Memory verify') assert.notEqual(answer.body?.source, 'VERIFIED')
      }
    } finally {
      writeFileSync(path, intact)
    }
  }
  assert.deepEqual(injectionFailures, [], 'damaged evidence must yield an availability answer, not a swallowed injection error')
  conversation.close()
  injectionConversation.close()
  process.stdout.write('KIRA MEMORY READER: PASS (scratch store; installed app not verified)\n')
} catch (error) {
  process.stderr.write(`KIRA MEMORY READER: FAIL ${String(error?.message ?? error)}\n`)
  process.exitCode = 1
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
