import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { Script } from 'node:vm'
import { auditCommits } from '../scripts/aukora/witness.mjs'
import { chainAuraEntries } from '../plugins/aukora-kira/lib/memory-owner.mjs'

const source = dirname(dirname(fileURLToPath(import.meta.url)))
const scratch = mkdtempSync(join(tmpdir(), 'aukora-commit-audit-'))
const repo = join(scratch, 'repo'), support = join(scratch, 'support')
const auraDir = join(support, 'state/home/aura-code'), log = join(auraDir, 'aura.jsonl')
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', AUKORA_SUPPORT_ROOT: support }
mkdirSync(repo); mkdirSync(auraDir, { recursive: true })
const git = (args, input) => execFileSync('/usr/bin/git', ['-C', repo, ...args], { input, env, encoding: 'utf8' }).trim()
const save = records => {
  rmSync(log, { force: true })
  writeFileSync(log, chainAuraEntries(auraDir, records).map(e => JSON.stringify(e)).join('\n') + '\n')
}
try {
  // These two standalone readers must bind every wire field. Exercise Echo's actual checkedHead
  // in a VM before the courier boundary: no peers, keys, signing or witness service are invoked.
  const echo = readFileSync(join(source, 'scripts/aura/echo-head.mjs'), 'utf8')
  const start = echo.indexOf('const DOMAIN = '), end = echo.indexOf('\nasync function echoHead(')
  assert.ok(start >= 0 && end > start, 'the actual Echo reader must be isolated before its courier')
  const checkedHead = new Script(`${echo.slice(start, end)}\ncheckedHead`).runInNewContext({
    createHash, TextDecoder, readFileSync: (file) => {
      assert.ok(file.startsWith(`${scratch}/`), 'reader fixture must stay in scratch')
      return readFileSync(file)
    },
  })
  const entries = chainAuraEntries(auraDir, [
    { operation: 'fixture.v1', text: 'Invented public cedar observation', nested: { domain: 'ordinary bound data' } },
    { operation: 'fixture.v1', text: 'Invented public quartz observation' },
  ])
  assert.ok(entries.every(entry => !Object.hasOwn(entry, 'domain')), 'legitimate v1 writer emits no wire domain')
  const retained = join(scratch, 'diagnostic-head.json')
  writeFileSync(retained, JSON.stringify({ sequence: 1, hash: entries[0].hash }), { mode: 0o600 })
  const verifier = join(source, 'scripts/aura/verify-append-only.mjs')
  const misses = []
  const cases = [
    ['legitimate v1, nested domain remains bound', entries, undefined],
    ...['forged separator', 'aukora:aura-record:v1', null, { forged: true }].map(domain =>
      [`wire domain ${JSON.stringify(domain)}`, entries.map((entry, index) => index === 0 ? { ...entry, domain } : entry), 'CHAIN_RESERVED_FIELD']),
    ['wire domain after the retained prefix', entries.map((entry, index) => index === 1 ? { ...entry, domain: 'forged tail' } : entry), 'CHAIN_RESERVED_FIELD', 2],
    ['ordinary bound field edited, hashes unchanged', entries.map((entry, index) => index === 0 ? { ...entry, text: 'edited public fixture' } : entry), 'CHAIN_TAMPERED'],
  ]
  for (const [index, [label, rows, reason, at = 1]] of cases.entries()) {
    const file = join(scratch, `diagnostic-${index}.jsonl`)
    const bytes = `${rows.map(entry => JSON.stringify(entry)).join('\n')}\n`
    writeFileSync(file, bytes, { mode: 0o600 })
    if (index <= 1) console.log(`PUBLIC SYNTHETIC ${label}: ${JSON.stringify(bytes)}`)
    let head, failure
    try { head = checkedHead(file) } catch (error) { failure = error }
    const checked = spawnSync(process.execPath, [verifier, retained, file], { env, encoding: 'utf8', timeout: 10000 })
    assert.equal(checked.error, undefined)
    const output = `${checked.stdout}${checked.stderr}`
    const goodEcho = reason === undefined ? head?.hash === entries.at(-1).hash
      : failure?.assurance === 'CONTRADICTED' && failure.message === `${reason} at Aura entry ${at}`
    const goodVerifier = reason === undefined ? checked.status === 0 && output.includes('VERDICT: APPEND_ONLY')
      : checked.status === 2 && output.includes('VERDICT: REWRITTEN') && output.includes(`REASON : ${reason}`) && output.includes(`POSITION: ${at}`)
    console.log(`${goodEcho && goodVerifier ? 'PASS' : 'FAIL'} Aura readers ${label}: Echo=${failure?.message ?? `accepted ${head?.sequence}`} append-only exit=${checked.status} ${output.match(/^VERDICT:.+$/m)?.[0]} ${output.match(/^REASON .+$/m)?.[0]}`)
    if (!goodEcho) misses.push(`${label}: Echo accepted or gave the wrong reason`)
    if (!goodVerifier) misses.push(`${label}: append-only accepted or gave the wrong reason`)
    assert.equal(readFileSync(file, 'utf8'), bytes, 'diagnostics preserve their input bytes')
    if (reason === 'CHAIN_RESERVED_FIELD') {
      const retention = spawnSync(process.execPath, [verifier, 'retain', file], { env, encoding: 'utf8', timeout: 10000 })
      assert.equal(retention.error, undefined)
      if (retention.status !== 1 || !retention.stdout.includes(`CHAIN_RESERVED_FIELD at entry ${at}`)) misses.push(`${label}: retain accepted or gave the wrong reason`)
    }
  }
  assert.deepEqual(misses, [], 'reserved on-wire fields must be rejected before a diagnostic claims intact history')

  git(['init', '-q', '--initial-branch=main'])
  git(['remote', 'add', 'origin', 'https://example.invalid/fixture.git'])
  const tree = git(['mktree'], '')
  const blob = git(['hash-object', '-w', '--stdin'], 'fixture\n')
  const otherTree = git(['mktree'], `100644 blob ${blob}\tfixture\n`)
  const commit = (message, parent, t = tree) => git(['commit-tree', t, ...(parent ? ['-p', parent] : []), '-m', message])
  const root = commit('fresh root')
  const meta = { verdict: 'approved', approverDid: 'did:key:zFixture', approvalDigest: 'a'.repeat(64), operationDigest: 'b'.repeat(64) }
  const trailers = `Approved-by: ${meta.approverDid}\nApproval-digest: ${meta.approvalDigest}\nOperation-digest: ${meta.operationDigest}\nCandidate-digest: ${'c'.repeat(64)}`
  const approved = commit(`approved change\n\n${trailers}`, root)
  const advance = { ...meta, operation: 'main.advance', from: null, to: root, tree, remote: 'https://example.invalid/fixture.git' }
  const change = { ...meta, operation: 'code.change', base: root, commit: approved, tree, candidateDigest: 'c'.repeat(64) }
  const setMain = tip => git(['update-ref', 'refs/remotes/origin/main', tip])
  const audit = () => auditCommits({ repo, support })
  save([advance, change]); setMain(approved)
  const bytes = readFileSync(log)
  assert.equal(audit().unapproved, 0)
  assert.deepEqual(audit().roots, [root])
  assert.deepEqual(readFileSync(log), bytes, 'audit does not append/reconcile')
  console.log('PASS exact approved trees: root advance without trailers and code.change with all trailers')

  const direct = commit('simulated direct push', approved, otherTree)
  setMain(direct)
  assert.equal(audit().unapproved, 1)
  assert.deepEqual(audit().rows.at(-1), { commit: direct, tree: otherTree, verdict: 'UNAPPROVED', reason: 'no_exact_aura_record' })
  const copied = commit(`copied trailers\n\n${trailers}`, direct)
  setMain(copied); assert.equal(audit().unapproved, 2)
  // Approving a later tip does not individually approve the intermediate tree.
  save([advance, change, { ...advance, from: approved, to: copied }])
  assert.equal(audit().rows.find(row => row.commit === direct).verdict, 'UNAPPROVED')
  console.log('PASS named direct push, copied trailers and intermediate advance-range commit remain UNAPPROVED')

  setMain(approved)
  for (const [patch, reason] of [
    [{ tree: otherTree }, 'approved_tree_mismatch'], [{ base: direct }, 'approved_base_mismatch'],
    [{ approverDid: 'did:key:zDifferent' }, 'trailer_mismatch:approved-by'],
    [{ approvalDigest: 'd'.repeat(64) }, 'trailer_mismatch:approval-digest'],
    [{ operationDigest: 'd'.repeat(64) }, 'trailer_mismatch:operation-digest'],
    [{ candidateDigest: 'd'.repeat(64) }, 'trailer_mismatch:candidate-digest'],
  ]) {
    save([advance, { ...change, ...patch }]); assert.equal(audit().rows.at(-1).reason, reason)
  }
  for (const message of [`duplicate\n\n${trailers}\nApproved-by: ${meta.approverDid}`, `body decoy\n\n${trailers}\n\nordinary ending`]) {
    const bad = commit(message, root)
    setMain(bad); save([advance, { ...change, commit: bad }])
    assert.equal(audit().rows.at(-1).reason, 'trailer_mismatch:approved-by')
  }
  setMain(approved); save([{ ...advance, tree: otherTree }, change])
  assert.equal(audit().rows[0].reason, 'approved_tree_mismatch')
  save([change]); assert.equal(audit().rows[0].verdict, 'UNAPPROVED', 'root is never exempt')
  save([advance, change])
  const clean = readFileSync(log, 'utf8')
  writeFileSync(log, clean.replace('"verdict":"approved"', '"verdict":"refused"'))
  assert.throws(audit, /code_chain_invalid_at_1/)
  writeFileSync(log, clean.trimEnd()); assert.throws(audit, /code_chain_torn_tail/)
  writeFileSync(log, clean)
  console.log('PASS tree/base/key/digest/duplicate/body-trailer mismatches, missing root record and damaged Aura refuse')

  // Run the actual CLI and its actual UNAPPROVED branch; only this scratch copy is mutated.
  const scriptDir = join(repo, 'scripts/aukora'); mkdirSync(scriptDir, { recursive: true })
  symlinkSync(join(source, 'scripts/aukora/become.mjs'), join(scriptDir, 'become.mjs'))
  symlinkSync(join(source, 'scripts/lib'), join(repo, 'scripts/lib'))
  symlinkSync(join(source, 'plugins'), join(repo, 'plugins'))
  const script = join(scriptDir, 'witness.mjs')
  const production = readFileSync(join(source, 'scripts/aukora/witness.mjs'), 'utf8')
  writeFileSync(script, production)
  const run = () => spawnSync(process.execPath, [script, '--commits'], { env, encoding: 'utf8', timeout: 10000 })
  assert.equal(run().status, 0)
  setMain(direct)
  const rejectsDirect = result => {
    assert.equal(result.status, 1)
    assert.ok(result.stdout.includes(`UNAPPROVED ${direct} no_exact_aura_record`))
  }
  rejectsDirect(run())
  const branch = "verdict: matched >= 0 ? 'MATCH' : 'UNAPPROVED'"
  assert.ok(production.includes(branch))
  writeFileSync(script, production.replace(branch, "verdict: 'MATCH'"))
  const removed = run()
  assert.equal(removed.status, 0)
  assert.throws(() => rejectsDirect(removed), { code: 'ERR_ASSERTION' })
  writeFileSync(script, production)
  console.log('EXPECTED FAILURE with UNAPPROVED branch removed: simulated direct push exits 0; detection assertion fails')
  writeFileSync(join(repo, '.git/shallow'), `${direct}\n`)
  assert.equal(run().status, 2)
  assert.match(run().stderr, /incomplete_or_replaced_history/)
  rmSync(join(repo, '.git/shallow'))
  git(['replace', direct, approved])
  assert.throws(audit, /incomplete_or_replaced_history/)
  console.log('PASS CLI exits 1 for named UNAPPROVED, 2 for incomplete/replaced history; scratch only')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
