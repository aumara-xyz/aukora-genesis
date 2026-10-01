#!/usr/bin/env node
// verify-append-only: is today's Aura log an append-only extension of a head you kept earlier?
//
//   node scripts/aura/verify-append-only.mjs retain <aura.jsonl>                     > head.json
//   node scripts/aura/verify-append-only.mjs <head.json | receipt.json | prefix.jsonl> <aura.jsonl> [--out DIR]
//   node scripts/aura/verify-append-only.mjs --selftest
//
// The retained side is what you kept: a head written by `retain` (sequence, hash, treeSize, root),
// a head from scripts/kira/retain-head.mjs (treeSize, root), a Kira receipt (aura.seq and
// aura.entryHash), or a copy of the log's first N lines (a .jsonl file), which also lets it name
// the exact first changed entry.
//
// Exit 0 APPEND_ONLY, 2 REWRITTEN (with the first bad position), 1 UNDETERMINED, 64 usage.
//
// Node built-ins only. The chain rule is RESTATED from plugins/aukora-kira/lib/memory-owner.mjs
// (auraEntryHash, walkAura) rather than imported, because a checker that calls the writer's function
// agrees with it by construction. --selftest compares the restatement with the writer when the
// writer is present.
//
// Second arm: when the retained side carries (or yields) a Merkle root, the tool builds an RFC 6962
// tree over the re-derived entry hashes, writes the presented head with a consistency proof, and
// runs vendor/append-only/verify.py (the membrane minimal verifier, unedited) as a separate
// process on the two documents. That verdict is printed beside the chain verdict.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openScratch } from '../lib/run-root.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const COURT = join(ROOT, 'vendor', 'append-only', 'verify.py')
const WRITER = join(ROOT, 'plugins', 'aukora-kira', 'lib', 'memory-owner.mjs')
const DOMAIN = 'aukora:aura-record:v1'
// Leaf k is sha256(0x00 || entry hash k) and an internal node is sha256(0x01 || left || right), the
// convention scripts/kira/retain-head.mjs, scripts/aura/adapter.py and scripts/composition/aura.py
// already name for an entry-hash log. verify.py only folds nodes, so it never sees the leaf rule.
const LEAF_CONVENTION = 'rfc6962-leaf-sha256-0x00-prefixed-v1'
const HEX64 = /^[0-9a-f]{64}$/
// Temporary files go through the repo's disk guard (scripts/lib/run-root.mjs), never a bare temp dir.
const scratch = label => openScratch({ owner: 'verify-append-only', label, maxBytes: 1 << 20, reap: false, registerCleanup: false })

const sha256 = data => createHash('sha256').update(data).digest()
const hex = bytes => bytes.toString('hex')
const shown = path => (path.startsWith(ROOT) ? relative(process.cwd(), path) || '.' : path)

class Undetermined extends Error {}

// ── the chain rule, restated ──────────────────────────────────────────────────────────────────

// record.mjs canonicalJSON over what JSON.parse can produce: sorted keys, compact, undefined dropped.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

// memory-owner.mjs: sha256(canonicalJSON({ prev, ...fields, domain: AURA_RECORD_DOMAIN })).
function entryHash(prev, fields) {
  return hex(sha256(Buffer.from(canonical({ prev, ...fields, domain: DOMAIN }), 'utf8')))
}

function readLog(path) {
  if (!existsSync(path)) throw new Undetermined(`${path} does not exist`)
  const bytes = readFileSync(path)
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Undetermined(`${path} is not UTF-8`)
  }
  const log = { path, digest: hex(sha256(bytes)), complete: text.endsWith('\n') || text === '', rows: [] }
  if (text === '') return log
  for (const line of (log.complete ? text.slice(0, -1) : text).split('\n')) {
    let entry = null
    try { entry = JSON.parse(line) } catch { /* reported by walk */ }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      log.rows.push({ line, entry: null })
      continue
    }
    const { hash, prev, ...fields } = entry
    log.rows.push({ line, entry, hash, prev, fields, rederived: entryHash(prev, fields) })
  }
  return log
}

// walkAura's rules, plus sequence == position (appendAura writes sequence = count + 1).
function walk(log) {
  let prev = DOMAIN
  for (let index = 0; index < log.rows.length; index += 1) {
    const at = index + 1
    const row = log.rows[index]
    const fail = (reason, detail) => ({ ok: false, at, reason, detail })
    if (at === log.rows.length && !log.complete) return fail('CHAIN_TRUNCATED', 'the last line has no newline: the last append was interrupted')
    if (row.entry === null) return fail('CHAIN_UNPARSEABLE', 'the line is not a JSON object')
    if (JSON.stringify(row.entry) !== row.line) return fail('CHAIN_NOT_CANONICAL', 'the line is not the bytes its own object serializes to')
    // v1's domain is preimage-only: entryHash overwrites it rather than binding a wire field.
    if (Object.hasOwn(row.fields, 'domain')) return fail('CHAIN_RESERVED_FIELD', 'the entry carries a reserved on-wire domain; the hash preimage owns it')
    if (typeof row.hash !== 'string' || !HEX64.test(row.hash)) return fail('CHAIN_NO_HASH', 'the entry carries no 64-hex hash')
    if (row.prev !== prev) return fail('CHAIN_BROKEN_LINK', at === 1 ? `prev is not the genesis domain ${DOMAIN}` : `prev does not name entry ${at - 1}'s hash`)
    if (row.rederived !== row.hash) return fail('CHAIN_TAMPERED', "the stored hash is not the hash of the entry's own fields")
    if (row.fields.sequence !== at) return fail('SEQUENCE_NOT_POSITION', `sequence is ${String(row.fields.sequence).slice(0, 20)}, position is ${at}`)
    prev = row.hash
  }
  return { ok: true }
}

// ── RFC 6962 tree over the entry hashes ───────────────────────────────────────────────────────

const node = (left, right) => sha256(Buffer.concat([Buffer.from([1]), left, right]))
const split = size => { let k = 1; while (k * 2 < size) k *= 2; return k }
function treeHead(leaves) {
  if (leaves.length === 1) return leaves[0]
  const k = split(leaves.length)
  return node(treeHead(leaves.slice(0, k)), treeHead(leaves.slice(k)))
}
// RFC 6962 §2.1.2 SUBPROOF, as scripts/phase0/phase0log.py ports it from the membrane's merkle.ts.
function subproof(m, leaves, complete) {
  if (m === leaves.length) return complete ? [] : [treeHead(leaves)]
  const k = split(leaves.length)
  if (m <= k) return [...subproof(m, leaves.slice(0, k), complete), treeHead(leaves.slice(k))]
  return [...subproof(m - k, leaves.slice(k), false), treeHead(leaves.slice(0, k))]
}
const consistencyProof = (m, leaves) => (m === leaves.length ? [] : subproof(m, leaves, true))
const leafOf = entryHashHex => sha256(Buffer.concat([Buffer.from([0]), Buffer.from(entryHashHex, 'hex')]))

function headOf(log, size) {
  const leaves = log.rows.slice(0, size).map(row => leafOf(row.hash))
  return {
    schema: 'aukora-aura-retained-head-v1',
    leafConvention: LEAF_CONVENTION,
    sequence: size,
    hash: log.rows[size - 1].hash,
    treeSize: size,
    root: hex(treeHead(leaves)),
  }
}

// ── the retained side ─────────────────────────────────────────────────────────────────────────

function readRetained(path) {
  if (!existsSync(path)) throw new Undetermined(`${path} does not exist`)
  if (path.endsWith('.jsonl')) {
    const prefix = readLog(path)
    const chain = walk(prefix)
    if (!chain.ok) throw new Undetermined(`the retained copy ${path} is not an intact chain (${chain.reason} at ${chain.at})`)
    if (prefix.rows.length === 0) throw new Undetermined(`the retained copy ${path} is empty`)
    return { source: 'retained copy of the first lines', path, prefix, ...headOf(prefix, prefix.rows.length) }
  }
  let doc
  try { doc = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Undetermined(`${path} is not a JSON document`) }
  if (doc === null || typeof doc !== 'object') throw new Undetermined(`${path} is not a JSON object`)
  let head
  if (doc.aura !== null && typeof doc.aura === 'object') {
    // memory-owner.mjs writes a receipt's aura block as { entryHash, seq, priorHead, head }. The
    // receipt's signature is NOT checked here; only its sequence and entry hash are used.
    head = { source: 'Kira receipt (signature not checked)', path, sequence: doc.aura.seq, hash: doc.aura.entryHash }
  } else {
    // A head from scripts/kira/retain-head.mjs carries treeSize and root but no entry hash.
    head = { source: 'retained head', path, sequence: doc.sequence ?? doc.treeSize, hash: doc.hash, treeSize: doc.treeSize, root: doc.root, leafConvention: doc.leafConvention }
  }
  if (!Number.isSafeInteger(head.sequence) || head.sequence < 1) throw new Undetermined(`${path} names no positive sequence`)
  if (head.hash !== undefined && (typeof head.hash !== 'string' || !HEX64.test(head.hash))) throw new Undetermined(`${path} carries an entry hash that is not 64 hex`)
  if (head.root !== undefined && (typeof head.root !== 'string' || !HEX64.test(head.root) || head.treeSize !== head.sequence)) {
    throw new Undetermined(`${path} carries a root that is not a 64-hex digest over treeSize == sequence`)
  }
  if (head.hash === undefined && head.root === undefined) throw new Undetermined(`${path} carries neither an entry hash nor a Merkle root`)
  return head
}

// ── the check ─────────────────────────────────────────────────────────────────────────────────

function chainVerdict(retained, log) {
  const n = retained.sequence
  const m = log.rows.length
  const chain = walk(log)
  const rewritten = (at, reason, detail) => ({ verdict: 'REWRITTEN', at, reason, detail })
  let differsAt = null
  if (retained.prefix) {
    for (let i = 0; i < Math.min(n, m); i += 1) {
      if (retained.prefix.rows[i].line !== log.rows[i].line) { differsAt = i + 1; break }
    }
  }
  if (differsAt !== null && (chain.ok || differsAt < chain.at)) {
    return rewritten(differsAt, 'RETAINED_ENTRY_DIFFERS', `entry ${differsAt} is not the entry that was retained`)
  }
  if (!chain.ok && chain.at <= n) return rewritten(chain.at, chain.reason, `${chain.detail} (inside the retained prefix 1..${n})`)
  if (m < n) return rewritten(m + 1, 'SHORTER_THAN_RETAINED', `the log holds ${m} entries; the retained head is at ${n}, so entries ${m + 1}..${n} are gone`)
  if (retained.hash !== undefined && log.rows[n - 1].hash !== retained.hash) {
    return rewritten(n, 'RETAINED_HEAD_MISMATCH',
      `entry ${n} re-derives to ${log.rows[n - 1].hash}, the retained head is ${retained.hash}: an entry at or before ${n} changed and the chain after it was re-hashed (a head alone cannot say which entry; keep the first lines to find it)`)
  }
  if (!chain.ok) return rewritten(chain.at, chain.reason, `${chain.detail} (after the retained prefix; entries 1..${n} are intact)`)
  const grown = m === n ? 'nothing was appended since' : m === n + 1 ? `entry ${m} chains onto it` : `entries ${n + 1}..${m} chain onto it`
  return { verdict: 'APPEND_ONLY', reason: 'EXTENDS_RETAINED_HEAD', detail: `entries 1..${n} re-derive to the retained head and ${grown}` }
}

function courtArm(retained, log, outDir) {
  const skip = why => ({ ran: false, why })
  if (retained.root === undefined) return skip(`the ${retained.source} carries no Merkle root`)
  if (retained.leafConvention !== LEAF_CONVENTION) return skip(`leafConvention ${JSON.stringify(retained.leafConvention)} is not ${LEAF_CONVENTION}; roots under different conventions are not compared`)
  if (!log.complete || log.rows.some(row => row.entry === null)) return skip('the log has an unreadable line, so there are no leaves to build a tree from')
  if (log.rows.length < retained.sequence) return skip(`the log is smaller than the retained tree; no consistency proof runs from ${retained.sequence} down to ${log.rows.length}`)
  if (!existsSync(COURT)) return skip(`${COURT} is absent`)
  const leaves = log.rows.map(row => leafOf(row.rederived))
  const presented = {
    schema: 'aukora-aura-presented-head-v1',
    leafConvention: LEAF_CONVENTION,
    treeSize: leaves.length,
    root: hex(treeHead(leaves)),
    retainedTreeSize: retained.sequence,
    proofFromPrevious: consistencyProof(retained.sequence, leaves).map(hex),
  }
  const temp = outDir === undefined ? scratch('aura-append-only') : null
  const dir = outDir ?? temp.root
  try {
    mkdirSync(dir, { recursive: true })
    let retainedPath = retained.path
    if (retained.prefix) {
      retainedPath = join(dir, 'retained.json')
      const { prefix, path, source, ...doc } = retained
      writeFileSync(retainedPath, `${JSON.stringify(doc, null, 2)}\n`)
    }
    const presentedPath = join(dir, 'presented.json')
    writeFileSync(presentedPath, `${JSON.stringify(presented, null, 2)}\n`)
    const run = spawnSync('python3', [COURT, retainedPath, presentedPath], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`.trimEnd()
    const field = name => (out.match(new RegExp(`^${name}\\s*:\\s*(.+)$`, 'm')) ?? [])[1]?.trim()
    return {
      ran: true,
      kept: outDir !== undefined,
      command: `python3 ${shown(COURT)} ${shown(retainedPath)} ${shown(presentedPath)}`,
      retainedRoot: retained.root,
      presented,
      out,
      verdict: field('VERDICT') ?? 'UNDETERMINED',
      reason: field('REASON') ?? 'court_produced_no_verdict',
    }
  } finally {
    temp?.dispose()
  }
}

function check(retainedPath, logPath, outDir) {
  const retained = readRetained(retainedPath)
  const log = readLog(logPath)
  const result = chainVerdict(retained, log)
  const court = courtArm(retained, log, outDir)
  const n = retained.sequence
  const base = { retained, log, court }
  if (retained.hash === undefined && !(result.verdict === 'REWRITTEN' && result.at <= n)) {
    // A root-only head: only verify.py can say whether the first n entries are the retained ones.
    if (court.ran && court.verdict === 'OBSERVATION_CONFLICT') {
      return { ...base, verdict: 'REWRITTEN', at: n, reason: 'RETAINED_ROOT_MISMATCH', detail: `verify.py: the first ${n} entries do not fold to the retained root, so an entry at or before ${n} changed` }
    }
    if (!court.ran || court.verdict !== 'APPEND_ONLY') {
      return { ...base, verdict: 'UNDETERMINED', reason: 'PREFIX_NOT_JUDGED', detail: `the retained head carries only a Merkle root and verify.py ${court.ran ? `answered ${court.verdict} (${court.reason})` : `did not run: ${court.why}`}` }
    }
    if (result.verdict === 'APPEND_ONLY') return { ...base, ...result, detail: result.detail.replace('re-derive to the retained head', 'fold to the retained root (verify.py)') }
  }
  if (result.verdict === 'APPEND_ONLY' && court.ran && court.verdict !== 'APPEND_ONLY') {
    return { ...base, verdict: 'UNDETERMINED', reason: 'ARMS_DISAGREE', detail: `the chain says APPEND_ONLY and verify.py says ${court.verdict}: the retained root does not match the retained hash` }
  }
  return { ...base, ...result }
}

function print(result) {
  const { retained, log, court } = result
  const lines = [
    'aura append-only check',
    `  retained : ${retained.source} ${shown(retained.path)}`,
    `             sequence ${retained.sequence}  hash ${retained.hash ?? '(none: a root-only head)'}`,
    `  log      : ${shown(log.path)}  ${log.rows.length} entries  sha256 ${log.digest}`,
    `VERDICT: ${result.verdict}`,
  ]
  if (result.at !== undefined) lines.push(`POSITION: ${result.at}`)
  lines.push(`REASON : ${result.reason}`, `DETAIL : ${result.detail}`, '')
  lines.push('court: vendor/append-only/verify.py (membrane minimal verifier), run as a separate process')
  if (!court.ran) {
    lines.push(`  not run: ${court.why}`)
  } else {
    lines.push(
      `  retained  treeSize ${retained.sequence}  root ${court.retainedRoot}`,
      `  presented treeSize ${court.presented.treeSize}  root ${court.presented.root}  proof ${court.presented.proofFromPrevious.length} node(s)`,
      `  $ ${court.command}${court.kept ? '' : '   (temporary files, removed; pass --out DIR to keep them)'}`,
      ...court.out.split('\n').map(line => `    ${line}`),
    )
  }
  lines.push('',
    'CHECKED    : every entry re-derives under the Aura rule; entries 1..N are the ones retained (by entry hash, or by',
    '             root through verify.py); later entries chain onto them.',
    'NOT CHECKED: that any entry is true, who wrote it, any signature, that this is the only log, or that the',
    '             retained side was kept somewhere the log\'s writer cannot reach.')
  process.stdout.write(`${lines.join('\n')}\n`)
}

function retain(logPath) {
  const log = readLog(logPath)
  const chain = walk(log)
  if (!chain.ok) throw new Undetermined(`refusing to retain a head of a broken log: ${chain.reason} at entry ${chain.at}: ${chain.detail}`)
  if (log.rows.length === 0) throw new Undetermined(`refusing to retain a head of an empty log: ${logPath}`)
  process.stdout.write(`${JSON.stringify(headOf(log, log.rows.length), null, 2)}\n`)
  return 0
}

// ── self-test: every verdict on disposable logs, and the restated rule against the writer ─────

async function selftest() {
  const temp = scratch('aura-append-only-selftest')
  const dir = temp.root
  let failures = 0
  const expect = (label, ok, got) => {
    if (!ok) failures += 1
    process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'}  ${label} -> ${got}\n`)
  }
  try {
    process.stdout.write('aura append-only check: self-test on disposable logs\n\n')
    const chainOf = bodies => {
      let prev = DOMAIN
      return bodies.map((body, i) => {
        const fields = { ...body, sequence: i + 1 }
        const hash = entryHash(prev, fields)
        const entry = { ...fields, prev, hash }
        prev = hash
        return entry
      })
    }
    const bodies = Array.from({ length: 7 }, (_, i) => ({ verdict: 'settled', operation: 'memory.put', key: `selftest-${i + 1}` }))
    const honest = chainOf(bodies)
    let serial = 0
    const put = (name, text) => { const path = join(dir, `${serial++}-${name}`); writeFileSync(path, text); return path }
    const logFile = entries => put('aura.jsonl', entries.map(entry => `${JSON.stringify(entry)}\n`).join(''))
    const headFile = (entries, n) => put('head.json', JSON.stringify(headOf(readLog(logFile(entries)), n)))
    const rootOnly = (entries, n) => {
      const { sequence, hash, ...head } = headOf(readLog(logFile(entries)), n)
      return put('root-only.json', JSON.stringify(head))
    }
    const rechained = chainOf(bodies.map((b, i) => (i === 1 ? { ...b, key: 'rewritten' } : b)))
    const cases = [
      ['honest growth 5 -> 7', headFile(honest, 5), logFile(honest), 'APPEND_ONLY', undefined, 'APPEND_ONLY'],
      ['honest growth 4 -> 7 (power of two)', headFile(honest, 4), logFile(honest), 'APPEND_ONLY', undefined, 'APPEND_ONLY'],
      ['entry 2 edited, hash left alone', headFile(honest, 5), logFile(honest.map((e, i) => (i === 1 ? { ...e, key: 'edited' } : e))), 'REWRITTEN', 2, 'OBSERVATION_CONFLICT'],
      ['entry 2 rewritten, chain re-hashed, head at 5', headFile(honest, 5), logFile(rechained), 'REWRITTEN', 5, 'OBSERVATION_CONFLICT'],
      ['same rewrite, first 5 lines kept', put('prefix.jsonl', honest.slice(0, 5).map(e => `${JSON.stringify(e)}\n`).join('')), logFile(rechained), 'REWRITTEN', 2, 'OBSERVATION_CONFLICT'],
      ['same rewrite, head at 4 (power of two)', headFile(honest, 4), logFile(rechained), 'REWRITTEN', 4, 'UNDETERMINED'],
      ['truncated to 3, head at 5', headFile(honest, 5), logFile(honest.slice(0, 3)), 'REWRITTEN', 4, null],
      ['entry 3 deleted', headFile(honest, 5), logFile(honest.filter((_, i) => i !== 2)), 'REWRITTEN', 3, 'OBSERVATION_CONFLICT'],
      ['receipt as the retained head (seq 5)', put('receipt.json', JSON.stringify({ aura: { seq: 5, entryHash: honest[4].hash } })), logFile(honest), 'APPEND_ONLY', undefined, null],
      ['root-only head, honest growth 5 -> 7', rootOnly(honest, 5), logFile(honest), 'APPEND_ONLY', undefined, 'APPEND_ONLY'],
      ['root-only head, same rewrite', rootOnly(honest, 5), logFile(rechained), 'REWRITTEN', 5, 'OBSERVATION_CONFLICT'],
      ['root-only head at 4 (power of two), same rewrite', rootOnly(honest, 4), logFile(rechained), 'UNDETERMINED', undefined, 'UNDETERMINED'],
    ]
    for (const [label, retainedPath, logPath, verdict, at, courtVerdict] of cases) {
      const result = check(retainedPath, logPath, undefined)
      const courtGot = result.court.ran ? result.court.verdict : null
      const ok = result.verdict === verdict && result.at === at && courtGot === courtVerdict
      expect(label, ok, `${result.verdict}${at !== undefined || result.at !== undefined ? ` at ${result.at}` : ''} (${result.reason}); court ${courtGot ?? 'not run'}${result.court.ran ? ` (${result.court.reason})` : ''}`)
    }
    if (existsSync(WRITER)) {
      const writer = await import(pathToFileURL(WRITER).href)
      const agree = writer.AURA_RECORD_DOMAIN === DOMAIN
        && honest.every(({ hash, prev, ...fields }) => writer.auraEntryHash(prev, fields) === hash)
      expect('restated rule vs memory-owner.mjs auraEntryHash', agree, agree ? `agrees on ${honest.length} entries` : 'DISAGREES')
    } else {
      process.stdout.write('  skip  restated rule vs memory-owner.mjs: the writer is not beside this file\n')
    }
  } finally {
    temp.dispose()
  }
  process.stdout.write(`\nSELFTEST: ${failures === 0 ? 'all green' : `${failures} FAILED`}\n`)
  return failures === 0 ? 0 : 1
}

async function main(argv) {
  const usage = () => { process.stderr.write(`${readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 13).map(l => l.replace(/^\/\/ ?/, '')).join('\n')}\n`); return 64 }
  try {
    if (argv[0] === '--selftest' && argv.length === 1) return await selftest()
    if (argv[0] === 'retain' && argv.length === 2) return retain(argv[1])
    const outAt = argv.indexOf('--out')
    const outDir = outAt === -1 ? undefined : argv[outAt + 1]
    const positional = outAt === -1 ? argv : argv.filter((_, i) => i !== outAt && i !== outAt + 1)
    if (positional.length !== 2 || (outAt !== -1 && !outDir)) return usage()
    const result = check(positional[0], positional[1], outDir === undefined ? undefined : resolve(outDir))
    print(result)
    return result.verdict === 'APPEND_ONLY' ? 0 : result.verdict === 'REWRITTEN' ? 2 : 1
  } catch (error) {
    if (!(error instanceof Undetermined) && error?.code !== 'ENOENT') throw error
    process.stdout.write(`VERDICT: UNDETERMINED\nREASON : ${error.message}\n`)
    return 1
  }
}

process.exitCode = await main(process.argv.slice(2))
