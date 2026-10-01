#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { membraneObservation, membraneConflicts, membraneRefusal } from './become.mjs'
import { isMainModule } from '../lib/is-main.mjs'
import { AURA_RECORD_DOMAIN, auraEntryPreimage } from '../../plugins/aukora-kira/lib/memory-owner.mjs'
import { readTextStrict } from '../../plugins/aukora-kira/lib/strict-read.mjs'

// Detection only: no fetch, reconciliation, approval consumption or retained-head write.
// A same-UID rewrite of both histories is outside this audit; hashes do not attest signatures.
export function auditCommits({ repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), support, commit: only }) {
  const git = (args, input) => execFileSync('/usr/bin/git', ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false', ...args], { cwd: repo, input, encoding: 'utf8', timeout: 10000,
    maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    } }).trimEnd()
  if (git(['rev-parse', '--is-shallow-repository']) !== 'false'
      || existsSync(resolve(repo, git(['rev-parse', '--git-path', 'info/grafts'])))
      || git(['for-each-ref', '--format=%(refname)', 'refs/replace/'])) throw new Error('incomplete_or_replaced_history')
  const main = git(['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'])
  const remote = git(['config', '--get', 'remote.origin.url'])
  const text = readTextStrict(join(support, 'state/home/aura-code/aura.jsonl'))
  if (text && !text.endsWith('\n')) throw new Error('code_chain_torn_tail')
  let previous = AURA_RECORD_DOMAIN
  const entries = (text ? text.slice(0, -1).split('\n') : []).map((line, index) => {
    const entry = JSON.parse(line)
    if (!entry || Array.isArray(entry) || typeof entry !== 'object') throw new Error(`code_chain_shape_at_${index + 1}`)
    const { hash, prev, ...fields } = entry
    if (JSON.stringify(entry) !== line || fields.sequence !== index + 1 || prev !== previous
        || createHash('sha256').update(auraEntryPreimage(prev, fields)).digest('hex') !== hash) {
      throw new Error(`code_chain_invalid_at_${index + 1}`)
    }
    previous = hash
    return entry
  })
  const records = entries.filter(e => e.operation === 'code.change' || e.operation === 'main.advance')
  const hex = /^[0-9a-f]{64}$/u
  const roots = []
  // One commit (become): it must still be on main; the chain above is verified in full either way.
  const onMain = git(['rev-list', '--reverse', '--topo-order', main]).split('\n')
  if (only !== undefined && !onMain.includes(only)) throw new Error('commit_not_on_main')
  const rows = (only !== undefined ? [only] : onMain).map(commit => {
    const [tree, parents, message] = git(['show', '-s', '--format=%T%x00%P%x00%B', commit]).split('\0')
    if (!parents) roots.push(commit)
    const trailers = git(['interpret-trailers', '--parse'], message).split('\n').filter(Boolean)
      .map(line => { const colon = line.indexOf(':'); return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()] })
    const candidates = records.filter(e => (e.operation === 'code.change' ? e.commit : e.to) === commit)
    const reasons = candidates.map(e => {
      if (e.verdict !== 'approved' && !(e.verdict === 'reconciled' && e.recoveryState === 'COMMITTED_NO_AURA'
          && e.consumedBy === 'aukora-kernel')) return 'record_not_approved'
      if (!/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/u.test(e.approverDid ?? '')
          || !hex.test(e.approvalDigest ?? '') || !hex.test(e.operationDigest ?? '')) return 'approval_fields_missing'
      if (e.tree !== tree) return 'approved_tree_mismatch'
      if (e.operation === 'code.change' && parents !== e.base) return 'approved_base_mismatch'
      if (e.operation === 'main.advance' && e.remote !== remote) return 'advance_remote_mismatch'
      const fields = { 'approved-by': e.approverDid, 'approval-digest': e.approvalDigest,
        'operation-digest': e.operationDigest, 'candidate-digest': e.candidateDigest }
      for (const [name, value] of Object.entries(fields)) {
        const values = trailers.filter(([key]) => key === name).map(([, v]) => v)
        const required = e.operation === 'code.change' && (name !== 'candidate-digest' || value !== undefined)
        // Advance binds a pre-existing commit: it normally has no approval trailers.
        if ((required || values.length) && (values.length !== 1 || values[0] !== value)) return `trailer_mismatch:${name}`
      }
      return null
    })
    const matched = reasons.indexOf(null)
    return { commit, tree, verdict: matched >= 0 ? 'MATCH' : 'UNAPPROVED',
      reason: matched >= 0 ? `${candidates[matched].operation}:Aura-${candidates[matched].sequence}`
        : reasons.join(',') || 'no_exact_aura_record' }
  })
  return { main, roots, rows, unapproved: rows.filter(row => row.verdict === 'UNAPPROVED').length,
    codeHead: previous, codeSize: entries.length }
}

if (isMainModule(import.meta.url)) {
  const commits = process.argv.slice(2).includes('--commits')
  const args = process.argv.slice(2).filter(arg => arg !== '--commits')
  if (args.length && (args.length !== 2 || args[0] !== '--support' || !args[1])) {
    process.stderr.write('usage: witness.mjs [--commits] [--support <dir>]\n'); process.exit(2)
  }
  const support = args[1] ?? process.env.AUKORA_SUPPORT_ROOT ?? join(homedir(), 'Library', 'Application Support', 'AUKORA')
  if (commits) {
    process.stdout.write('Detect only: same-UID rewrites, software approval key and direct pushes to main remain unenforced.\n')
    try {
      const audit = auditCommits({ support })
      process.stdout.write(`origin/main ${audit.main} (local snapshot; sync before audit) roots=${audit.roots.join(',')}\n`)
      for (const row of audit.rows) process.stdout.write(`${row.verdict} ${row.commit} ${row.reason}\n`)
      process.stdout.write(`COMMITS ${audit.rows.length} | UNAPPROVED ${audit.unapproved} | Aura ${audit.codeSize}:${audit.codeHead}\n`)
      process.exitCode = audit.unapproved ? 1 : 0
    } catch (error) {
      process.stderr.write(`UNDETERMINED: ${error.message}\n`); process.exitCode = 2
    }
  } else {
  const observed = membraneObservation(support)
  for (const [name, row] of Object.entries(observed.chains)) {
    process.stdout.write(`${name} size=${row.presentedSize ?? '?'} ${row.verdict} ${row.reason}${row.unterminatedTailBytes ? ` unterminated_tail_bytes=${row.unterminatedTailBytes}` : ''}\n`)
    if (row.rotation) process.stdout.write(`${name} rotation=${row.rotation.reason} previous=${row.rotation.previousFile} previous_unterminated_tail_bytes=${row.rotation.previousUnterminatedTailBytes ?? '?'}\n`)
  }
  const refusal = membraneRefusal(observed)
  if (refusal) process.stdout.write(`REFUSED: ${refusal}\n`)
  process.stdout.write('Exit 0 means become permits this observation; first observations remain unverified.\n')
  process.exitCode = refusal ? (membraneConflicts(observed).length ? 1 : 2) : 0
  }
}
