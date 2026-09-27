#!/usr/bin/env node
/**
 * AN APPROVAL DOES NOT OUTLIVE THE CONTROL THAT ISSUED IT.
 *
 *   node tests/kira-control-admission.test.mjs
 *
 * NO `--mutate` FLAG. The convention in this repository is that `--mutate` ADDS arms which break an
 * invariant and assert the break is DETECTED. The first version of this file carried a flag of that
 * name which did something else — it relaxed the assertions — and a control that loosens a test
 * instead of exercising it is worse than no control, because it reads as coverage. Arm 1 below is the
 * regressing arm in the ordinary sense: it asserts a refusal that exists only because of the check,
 * so reverting the check makes it fail.
 *
 * THE DEFECT THIS FILE EXISTS FOR. `activeControlDigest` is a SIGNED field, so an approval cannot be
 * re-pointed at another head without breaking its signature — but nothing compared it to the head the
 * deployment CURRENTLY serves, and `settleAuthorized` had no controller input at all. MEASURED
 * 2026-09-21 on a disposable controller: the controller served
 * `811340dcb8abca1a2c408a81cb88627074e2cb5b89d5574208bbb66f6387e975`, the approval named
 * `a7811fe96fc0e0b4a82a5b6530c85eb114a37664a64896451c3ae4e4f460f16f`, and the settlement **WROTE** —
 * `sequence 1`, one receipt, one Aura entry. An approval is therefore admitted by a control that may
 * since have been rotated or revoked. Arm 1 below is that measurement, kept as a regression: revert
 * the check and arm 1 stops refusing.
 *
 * WHAT THIS FILE CANNOT DO, stated because the ceiling is part of the claim. **A real rotation is not
 * performable in this brick.** The aumlok store is read-only over the control record — there is no
 * rotate or amend writer — and the record's CANONICAL ENCODING is itself validated, so advancing
 * `epoch` by hand makes even a pristine controller refuse `aumlok-local:entry-malformed` (measured).
 * These arms therefore model the STATE a rotation leaves — a settlement whose current head differs
 * from the head the artifact names — and not a rotation EVENT. Nothing here proves a rotation was
 * performed, that revocation propagates, or that succession is measured.
 *
 * THE FIVE BEHAVIOURS, each through the real `settleAuthorized` over its own disposable store:
 *
 *   1. STALE HEAD    the deployment serves one head, the approval names another → refused by name,
 *                    and the store is walked before and after: identical.
 *   2. MATCHING HEAD the same bytes, the pin agreeing with the artifact → settles, exactly one write.
 *   3. UNPINNED      no pin supplied → settles, and the result SAYS it was unpinned (`controlPinned`
 *                    false) rather than letting an unenforced admission read as an enforced one.
 *   4. MALFORMED PIN a pin the caller supplied but that is unusable → refused as a usage fault. This
 *                    is the fail-open Codex found in the first version of this wiring: the guard
 *                    dropped it and settled UNPINNED, giving a caller who mistyped the pin the weaker
 *                    check instead of an error.
 *   5. APPROVER PIN  the sibling pin is carried out on the result too, for the same reason.
 *
 * DISPOSABLE STATE ONLY: one temporary directory per arm, removed afterwards. The live Kira store is
 * never read, written or initialized here, and no request leaves this machine.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createRunRoot, installCleanup } from '../scripts/lib/run-root.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MUTATE = process.argv.includes('--mutate')
const runRoot = createRunRoot({ owner: 'kira-control-admission', prefix: 'kira-control-admission', base: tmpdir() })
installCleanup(runRoot)
import { createApprover } from './kira-approval-standin.mjs'

/** THE MODULE UNDER TEST — or, under `--mutate`, a copy in which the stale-head comparison can never fire.
 *
 *  *** THIS COURT WAS ON BETA'S GREEN-ONLY LIST, AND THE ENTRY WAS ACCURATE: "ignores --mutate (measured: exit 0 in BOTH modes, no arm output in either)". *** The list's own rule says the
 *  fix is to GIVE THE COURT A MUTATION ARM, so this is that fix. The protection it loses is arm 1's: an approval signed under a control head this owner no longer serves must be
 *  refused BY NAME, because an approval does not outlive the control that issued it.
 *
 *  `if (false)` replaces the comparison rather than the `refuse` call, which spans three lines — deleting one line of a template literal is a syntax error, and a copy that does not
 *  parse reads as a verdict rather than a mistake. The whole plugin and its sibling are copied into a layout mirroring `plugins/`, because these modules import each other and reach
 *  into `aukora-aumlok` by relative path. */
const LIB_UNDER_TEST = (() => {
  if (!MUTATE) return join(ROOT, 'plugins', 'aukora-kira', 'lib')
  const dir = runRoot.path('mutated-plugins')
  mkdirSync(dir, { recursive: true })
  for (const plugin of ['aukora-kira', 'aukora-aumlok']) cpSync(join(ROOT, 'plugins', plugin), join(dir, plugin), { recursive: true })
  const target = join(dir, 'aukora-kira', 'lib', 'approval.mjs')
  const source = readFileSync(target, 'utf8')
  const without = source.replace('    if (receipt.activeControlDigest !== expectation.activeControlDigest) {', '    if (false) { // MUTATED: a stale control head is no longer refused')
  if (without === source) throw new Error('the mutation changed nothing: the stale-head comparison is not where this court says it is')
  writeFileSync(target, without)
  return join(dir, 'aukora-kira', 'lib')
})()

const { createMemoryOwner } = await import(pathToFileURL(join(LIB_UNDER_TEST, 'memory-owner.mjs')).href)
const { settleTool } = await import(pathToFileURL(join(LIB_UNDER_TEST, 'tools.mjs')).href)
const { stageKiraMemoryRecord } = await import(pathToFileURL(join(LIB_UNDER_TEST, 'record.mjs')).href)

const SUBJECT = `aukora:1:${'3c'.repeat(32)}`
/** The head the deployment serves. The approval will be minted under a DIFFERENT one. */
const CURRENT_HEAD = '811340dcb8abca1a2c408a81cb88627074e2cb5b89d5574208bbb66f6387e975'
const STALE_HEAD = 'a7811fe96fc0e0b4a82a5b6530c85eb114a37664a64896451c3ae4e4f460f16f'

/** Walk a store: every file's path and size. A refusal must not move this. */
function census(root) {
  const out = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`)
      else out.push(`${prefix}${entry.name}:${statSync(full).size}`)
    }
  }
  walk(root, '')
  return out.sort().join('\n')
}

/** One arm's own disposable store, its operator documents, and an owner over them. */
function fixture({ artifactHead, note }) {
  const stateDir = mkdtempSync(join(tmpdir(), 'kira-control-admission-'))
  const staged = stageKiraMemoryRecord({
    subject: SUBJECT, kind: 'observation', source: [], content: { note }, links: [],
    privacy: 'local', createdAt: '2026-09-21T00:00:00Z',
  })
  const owner = createMemoryOwner({
    stateDir, subject: SUBJECT, permittedPrivacy: ['local'],
    grantFile: join(stateDir, 'grant.json'), approvalFile: join(stateDir, 'grant.json'),
  })
  const approver = createApprover({ subject: SUBJECT, controlDigest: artifactHead })
  const bundlePath = join(stateDir, 'grant.json')
  const bundle = {
    authorization: { grant: owner.grantFor(staged.memoryPut), record: staged.record, subject: SUBJECT },
    approval: approver.approve(staged.memoryPut),
  }
  // The TOOL reads both documents from the files the composition names, so an arm that drives the
  // tool needs them on disk. Arms 1–5 drive the library and never touch this.
  writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 })
  return {
    stateDir,
    owner,
    staged,
    bundle,
    bundlePath,
    cleanup: () => rmSync(stateDir, { recursive: true, force: true }),
  }
}

test('1. an approval under a head the deployment no longer serves is REFUSED, and nothing moves', () => {
  const f = fixture({ artifactHead: STALE_HEAD, note: 'stale control head' })
  try {
    const before = census(f.stateDir)
    assert.throws(
      () => f.owner.settleAuthorized({
        ...f.bundle,
        subject: SUBJECT,
        activeControlDigest: CURRENT_HEAD,
      }),
      error => {
        assert.equal(error.code, 'APPROVAL_CONTROL_NOT_CURRENT', `refused by NAME, got ${error.code}`)
        return true
      },
    )
    assert.equal(census(f.stateDir), before, 'the store is byte-identical after the refusal')
  } finally { f.cleanup() }
})

test('2. the same bytes, with the pin agreeing with the artifact, settle exactly once', () => {
  const f = fixture({ artifactHead: STALE_HEAD, note: 'matching control head' })
  try {
    const settled = f.owner.settleAuthorized({ ...f.bundle, subject: SUBJECT, activeControlDigest: STALE_HEAD })
    assert.equal(settled.sequence, 1)
    assert.match(String(settled.head), /^[0-9a-f]{64}$/)
    assert.equal(settled.controlPinned, true, 'the result says the control WAS pinned')
  } finally { f.cleanup() }
})

test('3. an unpinned settlement is allowed, and SAYS it was unpinned', () => {
  const f = fixture({ artifactHead: STALE_HEAD, note: 'unpinned' })
  try {
    const settled = f.owner.settleAuthorized({ ...f.bundle, subject: SUBJECT })
    assert.equal(settled.sequence, 1)
    assert.equal(settled.controlPinned, false,
      'an unenforced admission must not read as an enforced one')
  } finally { f.cleanup() }
})

test('4. a pin the caller supplied but that is UNUSABLE refuses, instead of settling unpinned', () => {
  for (const malformed of ['', 42, null, {}]) {
    const f = fixture({ artifactHead: STALE_HEAD, note: `malformed pin ${String(malformed)}` })
    try {
      const before = census(f.stateDir)
      assert.throws(
        () => f.owner.settleAuthorized({ ...f.bundle, subject: SUBJECT, activeControlDigest: malformed }),
        error => {
          assert.equal(error.code, 'APPROVAL_INPUT_MALFORMED',
            `a supplied pin of ${JSON.stringify(malformed)} must be a usage fault, got ${error.code}`)
          return true
        },
      )
      assert.equal(census(f.stateDir), before, 'nothing was written')
    } finally { f.cleanup() }
  }
})

test('5. the approver pin is carried out on the result as well', () => {
  const f = fixture({ artifactHead: STALE_HEAD, note: 'approver pin surfaced' })
  try {
    const settled = f.owner.settleAuthorized({ ...f.bundle, subject: SUBJECT })
    assert.equal(settled.approverPinned, false,
      'approverPinned reaches the caller rather than being dropped at the boundary')
  } finally { f.cleanup() }
})

/**
 * ARM 6 EXISTS BECAUSE ARMS 1-5 HAD A BLIND SPOT, and it is the one worth keeping.
 *
 * Every arm above drives `settleAuthorized` - the LIBRARY. The thing a model actually calls is the
 * TOOL, and the tool rebuilds its own return object. MEASURED 2026-09-21 by a contextless subagent
 * auditing this deployment: `controlPinned` was computed, returned by the library, and then dropped
 * at `tools.mjs`, so no model could ever see `controlPinned: false`. A court that tests the library
 * and calls it a court is the promise-instead-of-proof shape this file exists to refuse, and it
 * would have been copied into three lanes.
 */
async function viaTool(f, controlPin, approverPin) {
  const tool = settleTool(
    f.owner,
    () => f.owner.readAuthorization(f.bundlePath),
    () => f.owner.readApproval(f.bundlePath),
    SUBJECT,
    approverPin,
    controlPin,
  )
  try {
    return { refused: false, value: await tool.execute({ confirm: true }, {}) }
  } catch (error) {
    return { refused: true, code: error?.code ?? error?.name ?? 'refused-unnamed', message: String(error?.message ?? error) }
  }
}

test('6. THE TOOL BOUNDARY: the pins reach a caller and the tool can enforce the head', async () => {
  const f = fixture({ artifactHead: STALE_HEAD, note: 'tool boundary' })
  try {
    const stale = await viaTool(f, CURRENT_HEAD)
    assert.equal(stale.refused, true, 'a stale head must refuse THROUGH THE TOOL, not only in the library')
    assert.match(String(stale.code), /control/i, `named refusal, got ${stale.code}`)

    const unpinned = await viaTool(f, undefined)
    assert.equal(unpinned.refused, false, 'an unpinned settlement still settles')
    assert.equal(unpinned.value.controlPinned, false,
      'THE REGRESSION THIS ARM EXISTS FOR: the tool must report that no control pin was applied. '
      + 'Before the fix it dropped the field entirely and this line failed.')
    assert.equal(unpinned.value.approverPinned, false, 'and the sibling pin too')
  } finally { f.cleanup() }
})

/**
 * WHY THERE IS AN ARM 7 WHEN ARM 6 ALREADY DRIVES THE TOOL.
 *
 * Arm 6 closed the tool-boundary blind spot for the STALE head and the UNPINNED case. It left the same
 * blind spot open for one more input: arm 4, the malformed pin. A court that exercises the fail-closed
 * path through the library only is the exact shape this file was written to refuse, and it is worth
 * restating in the place it was still true - arm 6 exists because arms 1-5 tested the layer BENEATH the
 * one in use, and arms 1-5 plus arm 6 still tested the malformed-pin guard beneath the tool.
 *
 * The library guard refuses a supplied-but-unusable pin before anything is read or spent, so the
 * dangerous outcome is not a crash - it is a REACHABILITY failure. If the tool drops the malformed pin
 * on the way in (the `...(activeControlDigest === undefined ? {} : ...)` spread skips only `undefined`,
 * but a future refactor could widen that) the guard is never entered and the settlement proceeds
 * UNPINNED: a caller who mistyped a pin silently receives the weaker check. Through the TOOL that is the
 * difference between a model learning "your pin was malformed" and a model believing it enforced a
 * control head it never enforced. Either way this arm asserts on the bytes the caller actually sees.
 *
 * BOTH PINS, IN ONE ARM, ON PURPOSE. The source comment beside the guard says `approverDid` carried the
 * identical hole and is fixed with it, "because fixing one of two identical holes leaves the other open
 * and the asymmetry would be invisible". An arm that drove only the pin this file has been arguing about
 * all along would reproduce that asymmetry one level up, so arm 7 fails if EITHER guard is reverted
 * while the other still refuses - which is precisely the regression that reads as coverage.
 *
 * WHAT ACTUALLY REACHES THE CALLER, MEASURED - and the first draft of this arm got it wrong, which is
 * the point of measuring. The library refuses `APPROVAL_INPUT_MALFORMED`. `tools.mjs` then re-wraps every
 * `APPROVAL_*` code through `approvalCode(...)`, which lowercases the suffix and turns `_` into `-`, and
 * `KiraSettleError` prefixes the route, so the value on `error.code` at the tool boundary is
 * **`kira.settle:input-malformed`** - three transforms, and the library's spelling survives in none of
 * it. Asserting `APPROVAL_INPUT_MALFORMED` here, or the prefix-less `input-malformed`, would be a green
 * arm measuring a string no caller can ever receive. The assertion is an exact equality deliberately: it
 * fails if the code stops arriving, and it equally fails if the tool ever starts passing the raw
 * `APPROVAL_INPUT_MALFORMED` through, because that is a change in the contract a caller reads and it
 * should surface as a red arm, not as prose.
 *
 * NOTHING MOVES. The store is walked before and after every refused call. "It refused" is weaker than
 * "it refused and wrote nothing", and a refusal raised while a receipt was already half-written would
 * pass the first and fail the second.
 */
test('7. THROUGH THE TOOL: a malformed pin refuses by name and writes nothing, for BOTH pins', async () => {
  // Both shapes the guard covers: the empty string (a string, but unusable) and a non-string.
  for (const malformed of ['', 42]) {
    for (const pin of ['control', 'approver']) {
      const f = fixture({
        artifactHead: STALE_HEAD,
        note: `malformed ${pin} pin through the tool ${JSON.stringify(malformed)}`,
      })
      try {
        const before = census(f.stateDir)
        const out = pin === 'control'
          ? await viaTool(f, malformed, undefined)
          : await viaTool(f, undefined, malformed)
        assert.equal(out.refused, true,
          `a malformed ${pin} pin of ${JSON.stringify(malformed)} must refuse THROUGH THE TOOL; it settled instead: `
          + JSON.stringify(out.value))
        assert.equal(out.code, 'kira.settle:input-malformed',
          `the ${pin} pin reaches the caller as the name the library's APPROVAL_INPUT_MALFORMED becomes at the `
          + `tool boundary; got ${out.code} (${out.message})`)
        assert.equal(census(f.stateDir), before,
          `the store did not move for a malformed ${pin} pin`)
      } finally { f.cleanup() }
    }
  }
})
