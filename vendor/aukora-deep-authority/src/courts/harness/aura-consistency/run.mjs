/**
 * courts/harness/aura-consistency — a cold observer checks retained Aura growth.
 *
 * The producer reads real verified Aura JSONL, exports RFC 6962 checkpoints,
 * and generates a consistency proof. A standard-library-only Python program
 * verifies those files without importing the JavaScript producer.
 *
 * APPEND_ONLY proves arithmetic consistency between two observations only.
 * It does not prove truth, latestness, signature validity, or independent
 * custody. Missing or structurally insufficient evidence is UNDETERMINED.
 *
 *   node courts/harness/aura-consistency/run.mjs
 *   node courts/harness/aura-consistency/run.mjs --mutate
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendEntry } from '../../../aukora/aura/record.mjs'
import {
  checkpointFromRecord,
  consistencyPresentationFromRecord,
} from '../../../aukora/aura/checkpoint.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const VERIFIER = join(ROOT, 'aukora/verifier/aura_consistency.py')
const ORIGINAL_MINIMAL = join(ROOT, 'minimal/verify.py')
const ORIGINAL_MINIMAL_SHA256 = '039aa8999f9a1e1a8b8e01eb51598bfc546e4e574b2c9333f13e8bb303958089'
const PYTHON_COMMAND = process.platform === 'win32' ? 'python.exe' : 'python3'
const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--mutate')) {
  console.error('usage: node courts/harness/aura-consistency/run.mjs [--mutate]')
  process.exit(2)
}
const MUTATE = args[0] === '--mutate'
const TMP = mkdtempSync(join(tmpdir(), 'aukora-aura-consistency-'))
const STREAM_NAMESPACE = createHash('sha256').update('aura-consistency-court-stream').digest('hex')
const EXPECTED_CEILING = Object.freeze({
  evidenceConsistencyOnly: true,
  latestnessProven: false,
  signatureProven: false,
  truthProven: false,
})
const EXPECTED_ROWS = [
  'C1.extension',
  'C2.power-prefix',
  'C3.same',
  'C4.proof-mutated',
  'C5.proof-truncated',
  'C6.proof-extra',
  'C7.namespace',
  'C8.commitment',
  'C9.same-size-conflict',
  'C10.regression',
  'C11.prefix-conflict',
  'C12.power-prefix-limit',
  'C13.duplicate-field',
  'C14.ceiling',
  'C15.original-minimal',
]

try {
  const main = buildRecord('main', 14)
  const alternate = buildRecord('alternate', 14)
  const main3 = main.checkpoints.get(3)
  const main4 = main.checkpoints.get(4)
  const main5 = main.checkpoints.get(5)
  const main14 = main.checkpoints.get(14)
  const present3to14 = consistencyPresentationFromRecord({
    file: main.file,
    retainedSize: 3,
    streamNamespace: STREAM_NAMESPACE,
  })
  const present4to14 = consistencyPresentationFromRecord({
    file: main.file,
    retainedSize: 4,
    streamNamespace: STREAM_NAMESPACE,
  })
  const present5to14 = consistencyPresentationFromRecord({
    file: main.file,
    retainedSize: 5,
    streamNamespace: STREAM_NAMESPACE,
  })
  const present14 = { ...main14, proofFromPrevious: [] }

  const rows = []
  row(rows, 'C1.extension', 'a five-entry retained log extends to fourteen',
    evaluate(main5, present5to14), 'APPEND_ONLY', 'consistent-extension')
  row(rows, 'C2.power-prefix', 'a power-of-two retained prefix extends',
    evaluate(main4, present4to14), 'APPEND_ONLY', 'consistent-extension')
  row(rows, 'C3.same', 'the same checkpoint with an empty proof agrees',
    evaluate(main14, present14), 'APPEND_ONLY', 'consistent-checkpoint')

  const mutatedProof = structuredClone(present3to14)
  mutatedProof.proofFromPrevious[0] = createHash('sha256').update('mutated proof').digest('hex')
  attackRow(rows, 'C4.proof-mutated', 'a changed proof is not promoted to a conflict',
    main3, present3to14, main3, mutatedProof, 'UNDETERMINED', 'consistency-proof-presented-root-mismatch')

  const truncatedProof = structuredClone(present3to14)
  truncatedProof.proofFromPrevious.pop()
  attackRow(rows, 'C5.proof-truncated', 'a truncated proof is undetermined',
    main3, present3to14, main3, truncatedProof, 'UNDETERMINED', 'consistency-proof-incomplete')

  const extraProof = structuredClone(present3to14)
  extraProof.proofFromPrevious.push(createHash('sha256').update('extra proof').digest('hex'))
  attackRow(rows, 'C6.proof-extra', 'an extra proof node is undetermined',
    main3, present3to14, main3, extraProof, 'UNDETERMINED', 'consistency-proof-extra')

  const changedNamespace = structuredClone(present5to14)
  changedNamespace.streamNamespace = createHash('sha256').update('other namespace').digest('hex')
  attackRow(rows, 'C7.namespace', 'a changed unverified stream namespace is undetermined',
    main5, present5to14, main5, changedNamespace, 'UNDETERMINED', 'stream-namespace-mismatch')

  const changedCommitment = structuredClone(present5to14)
  changedCommitment.commitment = '00'.repeat(32)
  attackRow(rows, 'C8.commitment', 'an internally inconsistent checkpoint is undetermined',
    main5, present5to14, main5, changedCommitment, 'UNDETERMINED', 'presented-commitment-mismatch')

  const alternate14 = { ...alternate.checkpoints.get(14), proofFromPrevious: [] }
  attackRow(rows, 'C9.same-size-conflict', 'two valid roots for the same size conflict',
    main5, present5to14, main14, alternate14, 'OBSERVATION_CONFLICT', 'same-size-root-conflict')

  const smallerPresentation = { ...main5, proofFromPrevious: [] }
  attackRow(rows, 'C10.regression', 'a smaller presented tree cannot establish chronology',
    main5, present5to14, main14, smallerPresentation, 'UNDETERMINED', 'presented-tree-smaller')

  attackRow(rows, 'C11.prefix-conflict', 'a non-power prefix conflict is independently derived',
    main3, present3to14, alternate.checkpoints.get(3), present3to14,
    'OBSERVATION_CONFLICT', 'retained-prefix-root-conflict')

  attackRow(rows, 'C12.power-prefix-limit', 'a power-of-two prefix cannot earn that accusation',
    main4, present4to14, alternate.checkpoints.get(4), present4to14,
    'UNDETERMINED', 'consistency-proof-presented-root-mismatch')

  const duplicateRetained = join(TMP, 'duplicate-retained.json')
  const serialized = JSON.stringify(main5)
  writeFileSync(duplicateRetained, serialized.replace('"treeSize":5', '"treeSize":5,"treeSize":5') + '\n')
  const duplicateResult = evaluatePaths(duplicateRetained, writeDocument('duplicate-control-presented', present5to14))
  const duplicateControl = evaluate(main5, present5to14)
  rows.push({
    n: 'C13.duplicate-field',
    label: 'duplicate JSON fields are undetermined',
    observed: {
      control: `${duplicateControl.verdict}:${duplicateControl.reason}`,
      attack: `${duplicateResult.verdict}:${duplicateResult.reason}`,
    },
    expected: {
      control: 'APPEND_ONLY:consistent-extension',
      attack: 'UNDETERMINED:retained-input-invalid',
    },
  })

  const ceilingSource = readFileSync(VERIFIER, 'utf8')
  const ceilingNeedle = '"truthProven": False'
  const ceilingOccurrences = ceilingSource.split(ceilingNeedle).length - 1
  const ceilingMutant = join(TMP, 'mutant-aura-ceiling.py')
  writeFileSync(ceilingMutant, ceilingSource.replace(ceilingNeedle, '"truthProven": True'), 'utf8')
  let ceilingRefusal = null
  try {
    evaluate(main5, present5to14, ceilingMutant)
  } catch (error) {
    ceilingRefusal = String(error?.message ?? error)
  }
  rows.push({
    n: 'C14.ceiling',
    label: 'a verifier that promotes evidence to truth is refused',
    observed: {
      sourceReplacement: ceilingOccurrences === 1,
      control: `${duplicateControl.verdict}:${duplicateControl.reason}`,
      attack: ceilingRefusal,
    },
    expected: {
      sourceReplacement: true,
      control: 'APPEND_ONLY:consistent-extension',
      attack: 'aura-consistency: verifier output envelope invalid',
    },
  })

  const originalControl = evaluateOriginal(main5, present5to14)
  const originalEnvelopeMutation = evaluateOriginal(main5, changedNamespace)
  const changedRoot = structuredClone(present5to14)
  changedRoot.root = '00'.repeat(32)
  const originalRootAttack = evaluateOriginal(main5, changedRoot)
  rows.push({
    n: 'C15.original-minimal',
    label: 'the pinned Original Minimal Verifier accepts Deep checkpoints within its ceiling',
    observed: {
      sha256: createHash('sha256').update(readFileSync(ORIGINAL_MINIMAL)).digest('hex'),
      control: `${originalControl.verdict}:${originalControl.reason}`,
      envelopeMutation: `${originalEnvelopeMutation.verdict}:${originalEnvelopeMutation.reason}`,
      rootAttack: `${originalRootAttack.verdict}:${originalRootAttack.reason}`,
    },
    expected: {
      sha256: ORIGINAL_MINIMAL_SHA256,
      control: 'APPEND_ONLY:valid_append_only_extension',
      envelopeMutation: 'APPEND_ONLY:valid_append_only_extension',
      rootAttack: 'UNDETERMINED:proof_did_not_connect_to_presented_head',
    },
  })

  printRows(rows)
  const rowsHeld = rowsAreExact(rows) && rows.every((result) => same(result.observed, result.expected))

  if (MUTATE) {
    const source = readFileSync(VERIFIER, 'utf8')
    const needle = 'return OBSERVATION_CONFLICT, "same-size-root-conflict"'
    const replacement = 'return APPEND_ONLY, "mutant-accepted-conflict"'
    const occurrences = source.split(needle).length - 1
    const mutantPath = join(TMP, 'mutant-aura-consistency.py')
    writeFileSync(mutantPath, source.replace(needle, replacement), 'utf8')
    const mutant = evaluate(main14, alternate14, mutantPath)
    const mutationConfirmed = occurrences === 1
      && rowsHeld
      && mutant.verdict === 'APPEND_ONLY'
      && mutant.reason === 'mutant-accepted-conflict'
    console.log(`\n  MUTATION sourceReplacement=${occurrences === 1}`
      + ` conflictAccepted=${mutant.verdict === 'APPEND_ONLY'}`
      + ` ordinaryRowsHeld=${rowsHeld}`
      + `  ${mutationConfirmed ? 'DETECTED' : 'NOT DETECTED'}\n`)
    process.exitCode = mutationConfirmed ? 0 : 1
  } else {
    console.log(`\n  rowsComplete=${rowsAreExact(rows)} expected=${EXPECTED_ROWS.length} observed=${rows.length}`)
    console.log('  observationClass: COLD-INDEPENDENT-PROGRAM / RETENTION-LOCATION-NOT-ESTABLISHED\n')
    process.exitCode = rowsHeld ? 0 : 1
  }
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

/** Build one real Aura chain and retain selected prefix checkpoints. */
function buildRecord(label, count) {
  const file = join(TMP, `${label}.jsonl`)
  const checkpoints = new Map()
  for (let index = 1; index <= count; index++) {
    appendEntry({ file, fields: { sequence: index, label, value: `${label}:${index}` } })
    if ([3, 4, 5, 14].includes(index)) {
      checkpoints.set(index, checkpointFromRecord({ file, streamNamespace: STREAM_NAMESPACE }))
    }
  }
  return { file, checkpoints }
}

/** Run one positive/attack pair so every non-green verdict retains a control. */
function attackRow(rows, n, label, controlRetained, controlPresented, attackRetained, attackPresented,
  expectedVerdict, expectedReason) {
  const control = evaluate(controlRetained, controlPresented)
  const attack = evaluate(attackRetained, attackPresented)
  rows.push({
    n,
    label,
    observed: {
      control: `${control.verdict}:${control.reason}`,
      attack: `${attack.verdict}:${attack.reason}`,
    },
    expected: {
      control: 'APPEND_ONLY:consistent-extension',
      attack: `${expectedVerdict}:${expectedReason}`,
    },
  })
}

/** Add one direct verdict row. */
function row(rows, n, label, observed, verdict, reason) {
  rows.push({ n, label, observed, expected: { verdict, reason } })
}

/** Write two checkpoint documents and invoke the cold verifier. */
function evaluate(retained, presented, verifier = VERIFIER) {
  return evaluatePaths(
    writeDocument(`retained-${cryptoId()}`, retained),
    writeDocument(`presented-${cryptoId()}`, presented),
    verifier,
  )
}

/** Invoke the verifier through isolated Python and validate its output envelope. */
function evaluatePaths(retainedPath, presentedPath, verifier = VERIFIER) {
  const result = spawnSync(PYTHON_COMMAND, ['-I', verifier, retainedPath, presentedPath], {
    cwd: TMP,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      PYTHONDONTWRITEBYTECODE: '1',
      TMPDIR: tmpdir(),
    },
    timeout: 5_000,
    maxBuffer: 64 * 1024,
  })
  if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
    throw new Error(`aura-consistency: cold verifier failed: ${String(result.error?.message ?? result.stderr)}`)
  }
  if (result.stderr !== '') throw new Error('aura-consistency: verifier output envelope invalid')
  const lines = result.stdout.split('\n').filter(Boolean)
  if (lines.length !== 1) throw new Error('aura-consistency: verifier output envelope invalid')
  let parsed
  try {
    parsed = JSON.parse(lines[0])
  } catch {
    throw new Error('aura-consistency: verifier output envelope invalid')
  }
  const verdicts = ['APPEND_ONLY', 'OBSERVATION_CONFLICT', 'UNDETERMINED']
  if (!verdicts.includes(parsed?.verdict) || typeof parsed?.reason !== 'string') {
    throw new Error('aura-consistency: verifier output envelope invalid')
  }
  const expectedLine = JSON.stringify({
    ceiling: EXPECTED_CEILING,
    reason: parsed.reason,
    verdict: parsed.verdict,
  })
  if (lines[0] !== expectedLine) throw new Error('aura-consistency: verifier output envelope invalid')
  return { verdict: parsed.verdict, reason: parsed.reason }
}

/** Invoke the Original Minimal Verifier over one pair of Deep checkpoint documents. */
function evaluateOriginal(retained, presented) {
  const retainedPath = writeDocument(`original-retained-${cryptoId()}`, retained)
  const presentedPath = writeDocument(`original-presented-${cryptoId()}`, presented)
  const result = spawnSync(PYTHON_COMMAND, ['-I', ORIGINAL_MINIMAL, retainedPath, presentedPath], {
    cwd: TMP,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      PYTHONDONTWRITEBYTECODE: '1',
      TMPDIR: tmpdir(),
    },
    timeout: 5_000,
    maxBuffer: 64 * 1024,
  })
  if (result.error !== undefined || result.status !== 0 || result.signal !== null || result.stderr !== '') {
    throw new Error(`aura-consistency: Original Minimal Verifier failed: ${String(result.error?.message ?? result.stderr)}`)
  }
  const output = new Map()
  for (const line of result.stdout.split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    output.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  const verdict = output.get('VERDICT')
  const reason = output.get('REASON')
  if (typeof verdict !== 'string' || typeof reason !== 'string') {
    throw new Error('aura-consistency: Original Minimal Verifier output invalid')
  }
  return { verdict, reason }
}

/** Write one deterministic checkpoint document. */
function writeDocument(name, value) {
  const path = join(TMP, `${name}.json`)
  writeFileSync(path, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 })
  return path
}

/** Unique test-file suffix without introducing random semantics into evidence. */
function cryptoId() {
  cryptoId.value = (cryptoId.value ?? 0) + 1
  return String(cryptoId.value)
}

/** Print the exact row inventory. */
function printRows(rows) {
  console.log('\n  courts/harness/aura-consistency — cold append-only checkpoint verifier\n  ' + '-'.repeat(72))
  for (const result of rows) {
    const held = same(result.observed, result.expected)
    console.log(`  ${result.n}  ${result.label.padEnd(56)} ${held ? 'held' : '*** BREACH ***'}`
      + `  ${JSON.stringify(result.observed)}`)
  }
}

/** Require the exact expected row set. */
function rowsAreExact(rows) {
  const names = rows.map((result) => result.n)
  return names.length === EXPECTED_ROWS.length
    && new Set(names).size === names.length
    && EXPECTED_ROWS.every((name) => names.includes(name))
}

/** Compare deterministic row payloads. */
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}
