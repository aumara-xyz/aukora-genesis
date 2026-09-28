import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
