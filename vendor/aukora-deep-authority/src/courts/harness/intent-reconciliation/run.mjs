/**
 * courts/harness/intent-reconciliation — proves process-restart prepared-marker
 * reconciliation and the broker startup refusals that make it load-bearing.
 *
 * A marker is written before the effect starts and removed after Aura
 * settlement. A marker found by a later process proves only that cleanup was
 * incomplete. Whether the effect ran and whether Aura settlement completed
 * are each INDETERMINATE. This court makes no host-crash durability claim.
 *
 *   R1  only lstat ENOENT grades the marker directory absent
 *   R2  one valid marker is inventoried as unresolved
 *   R3  every valid marker is inventoried
 *   R4  malformed directory members never disappear from the inventory
 *   R5  a dangling symlink or non-directory marker path is malformed and blocks startup
 *   R6  valid-unresolved-only state refuses startup by a stable name
 *   R7  malformed-only state refuses startup by a different stable name
 *   R8  explicit cleanup leaves both result categories empty
 *
 * --mutate: a temporary broker copy removes the unresolved-marker startup
 * refusal. R6's independently planted valid marker must then reach a listening
 * broker, proving the court detects removal of the production refusal.
 *
 *   node courts/harness/intent-reconciliation/run.mjs
 *   node courts/harness/intent-reconciliation/run.mjs --mutate
 */
import {
  cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconcileIntents, serve } from '../../../aukora/broker/broker.mjs'

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--mutate')) {
  console.error(`intent-reconciliation: unknown argument ${args.find((arg) => arg !== '--mutate') ?? args[1]}`)
  process.exit(2)
}
const MUTATE = args[0] === '--mutate'
const HERE = dirname(fileURLToPath(import.meta.url))
const AUKORA = join(HERE, '../../../aukora')
const TMP = mkdtempSync(join(tmpdir(), 'aukora-intent-recon-'))
const rows = []
const EXPECTED_ROWS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']
const root = generateKeyPairSync('ed25519')
const rootPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()

const row = (n, label, observed, expected) => {
  const breach = JSON.stringify(observed) !== JSON.stringify(expected)
  rows.push({ n, label, observed, expected, breach })
}
const rowsAreExact = (ordinaryRows) => {
  const names = ordinaryRows.map((result) => result.n)
  return names.length === EXPECTED_ROWS.length
    && new Set(names).size === names.length
    && EXPECTED_ROWS.every((name) => names.includes(name))
}

const newState = (name) => {
  const stateDir = join(TMP, name)
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  return stateDir
}

const writeMarker = (stateDir, nonce, digestByte = 'aa') => {
  mkdirSync(join(stateDir, 'intents'), { recursive: true, mode: 0o700 })
  writeFileSync(
    join(stateDir, 'intents', `${nonce}.json`),
    `${JSON.stringify({ nonce, operationDigest: digestByte.repeat(32), startedAt: Date.now() })}\n`,
    { mode: 0o600 },
  )
}

const startupReason = async (serveFunction, stateDir, socketName) => {
  try {
    const running = await serveFunction({
      socketPath: join(TMP, socketName),
      stateDir,
      rootPublicKeyPem: rootPem,
    })
    await running.close()
    return null
  } catch (error) {
    return String(error?.message ?? error)
  }
}

// R1 — lstat ENOENT is the one clean absence result.
{
  const result = reconcileIntents(join(TMP, 'state-that-does-not-exist'))
  row('R1', 'an absent marker path has two explicit empty categories', result, {
    orphaned: [], malformed: [],
  })
}

// R2 — one exact marker is reported through the legacy `orphaned` result field.
const inventoryState = newState('inventory-state')
writeMarker(inventoryState, 'pending-a', 'aa')
{
  const result = reconcileIntents(inventoryState)
  row('R2', 'one valid marker is inventoried as unresolved', result, {
    orphaned: ['pending-a'], malformed: [],
  })
}

// R3 — multiple valid markers are all reported.
writeMarker(inventoryState, 'pending-b', 'bb')
{
  const result = reconcileIntents(inventoryState)
  row('R3', 'multiple valid markers are all inventoried', result, {
    orphaned: ['pending-a', 'pending-b'], malformed: [],
  })
}

// R4 — every malformed member reaches the result, by name and reason.
writeFileSync(join(inventoryState, 'intents', 'residue.txt'), 'not json')
writeFileSync(join(inventoryState, 'intents', 'empty.json'), '')
mkdirSync(join(inventoryState, 'intents', 'unexpected-dir'))
writeFileSync(
  join(inventoryState, 'intents', 'wrong-name.json'),
  `${JSON.stringify({ nonce: 'different', operationDigest: 'cc'.repeat(32), startedAt: Date.now() })}\n`,
)
{
  const result = reconcileIntents(inventoryState)
  row('R4', 'every malformed directory member is inventoried', result, {
    orphaned: ['pending-a', 'pending-b'],
    malformed: [
      { entry: 'empty.json', reason: 'unparseable-json' },
      { entry: 'residue.txt', reason: 'unexpected-filename' },
      { entry: 'unexpected-dir', reason: 'not-a-regular-file' },
      { entry: 'wrong-name.json', reason: 'filename-nonce-mismatch' },
    ],
  })
}

// R5 — existsSync would call a dangling symlink absent. lstat must instead
// classify both that symlink and a regular file at the directory path, and the
// broker must refuse both before listening.
{
  const symlinkState = newState('symlink-state')
  symlinkSync('./missing-intents-target', join(symlinkState, 'intents'))
  const fileState = newState('file-state')
  writeFileSync(join(fileState, 'intents'), 'not a directory')
  const symlinkResult = reconcileIntents(symlinkState)
  const fileResult = reconcileIntents(fileState)
  const symlinkReason = await startupReason(serve, symlinkState, 'symlink-must-not-listen.sock')
  const fileReason = await startupReason(serve, fileState, 'file-must-not-listen.sock')
  row('R5', 'dangling symlink and non-directory marker paths block startup', {
    symlinkResult,
    symlinkStartupNamed: symlinkReason?.startsWith('broker:intent-state-malformed') ?? false,
    fileResult,
    fileStartupNamed: fileReason?.startsWith('broker:intent-state-malformed') ?? false,
  }, {
    symlinkResult: {
      orphaned: [],
      malformed: [{ entry: 'intents', reason: 'intent-path-is-symbolic-link' }],
    },
    symlinkStartupNamed: true,
    fileResult: {
      orphaned: [],
      malformed: [{ entry: 'intents', reason: 'intent-path-not-a-directory' }],
    },
    fileStartupNamed: true,
  })
}

// R6 — the fixture contains only one valid unresolved marker. Its exact
// classification is part of the row, so a failed plant cannot grade green.
const unresolvedState = newState('unresolved-startup-state')
writeMarker(unresolvedState, 'pending-startup', 'dd')
{
  const classified = reconcileIntents(unresolvedState)
  const reason = await startupReason(serve, unresolvedState, 'unresolved-must-not-listen.sock')
  row('R6', 'valid-unresolved-only state refuses by its stable name', {
    classified,
    startupNamed: reason?.startsWith('broker:intent-state-unresolved') ?? false,
  }, {
    classified: { orphaned: ['pending-startup'], malformed: [] },
    startupNamed: true,
  })
}

// R7 — this separate fixture contains malformed state and no valid markers.
// It must reach the malformed refusal rather than borrowing R6's evidence.
{
  const malformedState = newState('malformed-startup-state')
  mkdirSync(join(malformedState, 'intents'), { mode: 0o700 })
  writeFileSync(join(malformedState, 'intents', 'residue.txt'), 'not a marker')
  const classified = reconcileIntents(malformedState)
  const reason = await startupReason(serve, malformedState, 'malformed-must-not-listen.sock')
  row('R7', 'malformed-only state refuses by its stable name', {
    classified,
    startupNamed: reason?.startsWith('broker:intent-state-malformed') ?? false,
  }, {
    classified: {
      orphaned: [],
      malformed: [{ entry: 'residue.txt', reason: 'unexpected-filename' }],
    },
    startupNamed: true,
  })
}

// R8 — cleanup is explicit, and both categories must then be empty.
rmSync(join(inventoryState, 'intents'), { recursive: true, force: true })
{
  const result = reconcileIntents(inventoryState)
  row('R8', 'explicit cleanup leaves every reconciliation category empty', result, {
    orphaned: [], malformed: [],
  })
}

console.log('\n  courts/harness/intent-reconciliation — process-restart marker reconciliation\n  ' + '-'.repeat(72))
for (const result of rows) {
  const held = JSON.stringify(result.observed) === JSON.stringify(result.expected)
  console.log(`  ${result.n}  ${String(result.label).padEnd(58)} ${held ? 'held' : '*** BREACH ***'}  ${JSON.stringify(result.observed).slice(0, 120)}`)
}

if (MUTATE) {
  const mutantAukora = join(TMP, 'mutant-aukora')
  cpSync(AUKORA, mutantAukora, { recursive: true })
  const mutantBrokerPath = join(mutantAukora, 'broker', 'broker.mjs')
  const source = readFileSync(mutantBrokerPath, 'utf8')
  const anchor = /^(\s*)throw new Error\(`broker:intent-state-unresolved[^\n]+$/gm
  const matches = source.match(anchor) ?? []
  const mutationApplied = matches.length === 1
  if (mutationApplied) {
    writeFileSync(mutantBrokerPath, source.replace(anchor, '$1void reconciliation.orphaned'), 'utf8')
  }

  const mutationFixture = newState('mutation-unresolved-state')
  writeMarker(mutationFixture, 'pending-mutation', 'ee')
  const fixture = reconcileIntents(mutationFixture)
  let mutationServed = false
  let mutationReason = 'mutation-anchor-not-applied'
  if (mutationApplied) {
    const { serve: mutantServe } = await import(mutantBrokerPath)
    mutationReason = await startupReason(mutantServe, mutationFixture, 'mutation-broker.sock')
    mutationServed = mutationReason === null
  }
  const unrelatedBreaches = rows.filter((result) => result.breach).map((result) => result.n)
  const rowsComplete = rowsAreExact(rows)
  const detected = mutationApplied
    && rowsComplete
    && JSON.stringify(fixture) === JSON.stringify({ orphaned: ['pending-mutation'], malformed: [] })
    && mutationServed
    && unrelatedBreaches.length === 0
  console.log(`\n  MUTATION unresolved startup refusal removed  anchorApplied=${mutationApplied} rowsComplete=${rowsComplete} expected=${EXPECTED_ROWS.length} observed=${rows.length} fixture=${JSON.stringify(fixture)} served=${mutationServed} reason=${JSON.stringify(mutationReason)} unrelatedBreaches=[${unrelatedBreaches.join(' ')}]  ${detected ? 'DETECTED' : 'NOT DETECTED'}\n`)
  rmSync(TMP, { recursive: true, force: true })
  process.exit(detected ? 0 : 1)
}

const anyBreach = !rowsAreExact(rows) || rows.some((result) => result.breach)
console.log(`  rowsComplete=${rowsAreExact(rows)} expected=${EXPECTED_ROWS.length} observed=${rows.length}`)
console.log(anyBreach ? '\n  INTENT RECONCILIATION HAS DEFECTS.\n' : '\n  INTENT RECONCILIATION HOLDS.\n')
rmSync(TMP, { recursive: true, force: true })
process.exit(anyBreach ? 1 : 0)
