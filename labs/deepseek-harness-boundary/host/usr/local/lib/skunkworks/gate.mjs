// skunkworks-gate — approval/state authority for SKUNKWORKS, runs as Linux user aukora-gate.
// Root-owned code (/usr/local/lib/skunkworks/gate.mjs). The harness (aukora-host) talks to it over a
// unix socket (/run/skunkworks-gate/gate.sock, group skgate, 0660); auma and the sandbox cannot reach it.
// Owns, with no write access for aukora-host:
//   * the single-use proposal store (pending -> applying -> applied | refused | expired | stale | failed)
//   * the append-only, hash-chained, Ed25519-signed change ledger (every proposal, decision, apply, revert)
//   * the Ed25519 receipt key (gate-only 0600; harness only ever sees the public key)
//   * the allowlisted target files themselves (/workspace/skunkworks/targets, group-readable by skgate)
//   * content-addressed versions of every target state (revert to any recorded sha, still approved)
// Allowlist = declarative, schema-validated targets ONLY. No code targets (no plugin installs).
// Usage: node gate.mjs            (serve)
//        node gate.mjs verify [db] [pubkey.pem]   (verify ledger chain + signatures; exit 0 ok / 1 broken;
//                                     with a copy of gate.db + the public key anyone can verify offline)
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID, generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const HOME = '/workspace/skunkworks/gate'
const TARGET_ROOT = '/workspace/skunkworks/targets'
const RUN = '/run/skunkworks-gate'
const SOCK = path.join(RUN, 'gate.sock')
const TTL_MS = 5 * 60 * 1000
const POPUP_LIMIT = 12000
const WHY_MAX = 300
const KEEP_VERSIONS = 50
const GID = Number(process.env.SKGATE_GID) || 0 // group skgate: harness may READ targets, never write

// ---- allowlist: exact logical names -> constant physical paths + strict schema ----
const TARGETS = {
  'plugins/auma-theme/theme.json': {
    file: path.join(TARGET_ROOT, 'plugins/auma-theme/theme.json'),
    entry: 'auma-theme', maxBytes: 256,
    schema: '{"accent": "default" | "#RRGGBB"} — exactly one key, JSON object, ≤256 bytes',
    validate(text) {
      let j; try { j = JSON.parse(text) } catch { throw new Error('theme.json must be valid JSON') }
      if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('theme.json must be a JSON object')
      const keys = Object.keys(j)
      const unknown = keys.filter(k => k !== 'accent'); if (unknown.length) throw new Error(`theme.json: unknown key(s) ${JSON.stringify(unknown)}; only "accent" is allowed`)
      if (!keys.includes('accent')) throw new Error('theme.json: "accent" is required')
      if (typeof j.accent !== 'string' || !/^(default|#[0-9a-fA-F]{6})$/.test(j.accent)) throw new Error('theme.json: accent must be "default" or #RRGGBB')
    },
  },
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const iso = () => new Date().toISOString()
const SHA = /^[0-9a-f]{64}$/

// ---- key ----
function loadKey() {
  const kp = path.join(HOME, 'receipt-ed25519.pem')
  if (!fs.existsSync(kp)) {
    const { privateKey } = generateKeyPairSync('ed25519')
    fs.writeFileSync(kp, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' })
  }
  const priv = createPrivateKey(fs.readFileSync(kp))
  const pub = createPublicKey(priv)
  const pubPem = pub.export({ type: 'spki', format: 'pem' }).toString()
  const fp = sha256(pub.export({ type: 'spki', format: 'der' })).slice(0, 16)
  return { priv, pub, pubPem, fp }
}

function openDb(file = path.join(HOME, 'gate.db')) {
  const db = new DatabaseSync(file)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, kind TEXT, target TEXT, base_sha TEXT, new_sha TEXT, diff TEXT,
      why TEXT, session TEXT, call_id TEXT, created INTEGER, expires INTEGER, displayable INTEGER, state TEXT, note TEXT, updated INTEGER);
    CREATE TABLE IF NOT EXISTS blobs(sha TEXT PRIMARY KEY, target TEXT, bytes BLOB, first_seen TEXT);
    CREATE TABLE IF NOT EXISTS ledger(seq INTEGER PRIMARY KEY, at TEXT NOT NULL, event TEXT NOT NULL, proposal TEXT, target TEXT,
      base_sha TEXT, new_sha TEXT, detail TEXT, prev TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;`)
  return db
}

const entryBody = (e) => JSON.stringify([e.seq, e.at, e.event, e.proposal ?? null, e.target ?? null, e.base_sha ?? null, e.new_sha ?? null, e.detail ?? null, e.prev])

function verifyLedger(db, pub) {
  let prev = 'GENESIS', n = 0; const errors = []
  for (const e of db.prepare('SELECT * FROM ledger ORDER BY seq').iterate()) {
    n++
    if (e.seq !== n) errors.push(`seq gap at ${e.seq} (expected ${n})`)
    if (e.prev !== prev) errors.push(`seq ${e.seq}: prev ${e.prev.slice(0, 12)} != ${prev.slice(0, 12)}`)
    const h = sha256(entryBody(e))
    if (h !== e.hash) errors.push(`seq ${e.seq}: hash mismatch`)
    if (!verify(null, Buffer.from(e.hash, 'hex'), pub, Buffer.from(e.sig, 'base64'))) errors.push(`seq ${e.seq}: bad signature`)
    prev = e.hash
    if (errors.length > 20) break
  }
  return { ok: errors.length === 0, entries: n, head: prev, errors }
}

if (process.argv[2] === 'verify') {
  const [dbFile, pubFile] = process.argv.slice(3)
  const pub = pubFile ? createPublicKey(fs.readFileSync(pubFile)) : loadKey().pub
  const db = new DatabaseSync(dbFile ?? path.join(HOME, 'gate.db'), { readOnly: true }); const r = verifyLedger(db, pub)
  console.log(JSON.stringify({ ...r, pubkey_fp: sha256(pub.export({ type: 'spki', format: 'der' })).slice(0, 16) }, null, 1)); process.exit(r.ok ? 0 : 1)
}

// ---------------- serve ----------------
const key = loadKey()
const db = openDb()
const now = () => Date.now()

function append(event, f = {}) {
  const last = db.prepare('SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1').get()
  const e = { seq: (last?.seq ?? 0) + 1, at: iso(), event, proposal: f.proposal ?? null, target: f.target ?? null,
    base_sha: f.base_sha ?? null, new_sha: f.new_sha ?? null, detail: f.detail === undefined ? null : JSON.stringify(f.detail), prev: last?.hash ?? 'GENESIS' }
  e.hash = sha256(entryBody(e))
  e.sig = sign(null, Buffer.from(e.hash, 'hex'), key.priv).toString('base64')
  db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(e.seq, e.at, e.event, e.proposal, e.target, e.base_sha, e.new_sha, e.detail, e.prev, e.hash, e.sig)
  return e
}
function tx(fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e } }

function noSymlinks(p) {
  let cur = '/'
  for (const part of p.split('/').filter(Boolean)) { cur = path.join(cur, part); try { if (fs.lstatSync(cur).isSymbolicLink()) throw new Error(`symlink in target path (${cur}); refused`) } catch (e) { if (e.code !== 'ENOENT') throw e } }
}
function spec(target) {
  if (typeof target !== 'string' || !Object.hasOwn(TARGETS, target)) throw new Error(`target refused: ${JSON.stringify(String(target).slice(0, 120))} is not on the allowlist (${Object.keys(TARGETS).join(', ')}). Only declarative, schema-validated targets exist; code/plugins/config/approval store are never editable.`)
  return TARGETS[target]
}
function readCur(s) {
  noSymlinks(s.file)
  let fd; try { fd = fs.openSync(s.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW) } catch (e) { if (e.code === 'ENOENT') return null; throw e }
  try { return fs.readFileSync(fd) } finally { fs.closeSync(fd) }
}
function putBlob(target, bytes) { db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?,?)').run(sha256(bytes), target, bytes, iso()) }

function lineDiff(a, b, name) {
  const A = a === '' ? [] : a.split('\n'), B = b === '' ? [] : b.split('\n')
  if (A.length * B.length > 250000) return `--- a/${name}\n+++ b/${name}\n` + A.map(l => '-' + l).join('\n') + '\n' + B.map(l => '+' + l).join('\n')
  const L = Array.from({ length: A.length + 1 }, () => new Int32Array(B.length + 1))
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out = [`--- a/${name}`, `+++ b/${name}`]; let i = 0, j = 0
  while (i < A.length && j < B.length) { if (A[i] === B[j]) { out.push(' ' + A[i]); i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) out.push('-' + A[i++]); else out.push('+' + B[j++]) }
  while (i < A.length) out.push('-' + A[i++]); while (j < B.length) out.push('+' + B[j++])
  return out.join('\n')
}
const cleanWhy = (w) => w == null ? null : String(w).replace(/[\x00-\x1f\x7f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').slice(0, WHY_MAX)

function createProposal({ target, content, why, claimed_base, session, call_id }, kind, extra = {}) {
  const s = spec(target)
  if (typeof content !== 'string') throw new Error('content must be a string')
  const bytes = Buffer.from(content, 'utf8')
  if (bytes.length > s.maxBytes) { append('reject', { target, detail: { reason: 'oversized', bytes: bytes.length, max: s.maxBytes, kind } }); throw new Error(`refused: ${bytes.length} bytes exceeds the ${s.maxBytes}-byte limit for ${target}`) }
  try { s.validate(content) } catch (e) { append('reject', { target, detail: { reason: 'schema', error: e.message, kind } }); throw new Error('refused (schema): ' + e.message) }
  if (why != null && String(why).length > 2000) throw new Error('refused: why/summary longer than 2000 chars')
  const cur = readCur(s); const baseSha = cur ? sha256(cur) : 'absent'
  if (kind !== 'revert') {
    if (typeof claimed_base !== 'string' || !(SHA.test(claimed_base) || claimed_base === 'absent')) { append('reject', { target, base_sha: baseSha, detail: { reason: 'no-base', kind } }); throw new Error(`refused as stale: base_sha256 is required (call read_target first; current sha256 is ${baseSha}). Blind overwrites are not accepted.`) }
    if (claimed_base !== baseSha) { append('reject', { target, base_sha: baseSha, detail: { reason: 'stale-base', claimed: claimed_base, kind } }); throw new Error(`refused as stale: you based this on ${claimed_base} but the current sha256 is ${baseSha}. read_target again and re-propose.`) }
  }
  const newSha = sha256(bytes)
  if (newSha === baseSha) throw new Error('refused: proposed content is identical to current content')
  const diff = lineDiff(cur ? cur.toString('utf8') : '', content, target)
  const displayable = diff.length + content.length <= POPUP_LIMIT ? 1 : 0
  const id = randomUUID(), created = now(), expires = created + TTL_MS
  const w = cleanWhy(why)
  return tx(() => {
    if (cur) putBlob(target, cur); putBlob(target, bytes)
    db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, kind, target, baseSha, newSha, diff, w, String(session ?? ''), String(call_id ?? ''), created, expires, displayable, 'pending', null, created)
    const e = append('propose', { proposal: id, target, base_sha: baseSha, new_sha: newSha, detail: { kind, why: w, session: String(session ?? ''), expires: new Date(expires).toISOString(), displayable: !!displayable, ...extra } })
    return { id, kind, target, entry: s.entry, base_sha: baseSha, new_sha: newSha, diff, content, bytes: bytes.length, why: w, created, expires, displayable: !!displayable, ledger_seq: e.seq }
  })
}

function setState(id, from, to, note) { return db.prepare('UPDATE proposals SET state=?, note=?, updated=? WHERE id=? AND state=?').run(to, note ?? null, now(), id, from).changes === 1 }

function decide({ id, outcome }) {
  if (typeof id !== 'string') throw new Error('id required')
  const p = db.prepare('SELECT * FROM proposals WHERE id=?').get(id)
  if (!p) { append('decide-refused', { proposal: String(id).slice(0, 64), detail: { reason: 'unknown proposal' } }); return { applied: false, state: 'unknown', message: 'refused: unknown proposal id' } }
  if (outcome !== 'allowed-once') {
    const to = outcome === 'rejected' ? 'refused' : 'expired'
    return tx(() => {
      if (!setState(id, 'pending', to, String(outcome))) { append('decide-refused', { proposal: id, target: p.target, detail: { reason: 'not pending', state: p.state, outcome } }); return { applied: false, state: p.state, message: `proposal is ${p.state}` } }
      append('decide', { proposal: id, target: p.target, base_sha: p.base_sha, new_sha: p.new_sha, detail: { outcome, by: 'dsh-popup' } })
      return { applied: false, state: to, message: outcome }
    })
  }
  // allowed-once: check + spend atomically (durable before any byte is written)
  const s = spec(p.target)
  const pre = tx(() => {
    const r = db.prepare('SELECT state, expires, displayable FROM proposals WHERE id=?').get(id)
    if (r.state !== 'pending') { append('decide-refused', { proposal: id, target: p.target, detail: { reason: 'replay: not pending', state: r.state } }); return { applied: false, state: r.state, message: `refused: approval already used or closed (state ${r.state}) — replay refused` } }
    if (now() > r.expires) { setState(id, 'pending', 'expired', 'approved after expiry'); append('decide-refused', { proposal: id, target: p.target, detail: { reason: 'approved after expiry', expires: new Date(r.expires).toISOString() } }); return { applied: false, state: 'expired', message: 'refused: approval arrived after expiry' } }
    if (!r.displayable) { setState(id, 'pending', 'refused', 'too large for popup'); append('decide-refused', { proposal: id, target: p.target, detail: { reason: 'TRUNCATED: approval disabled' } }); return { applied: false, state: 'refused', message: 'refused: proposal too large to show in full; approval disabled' } }
    const cur = readCur(s); const curSha = cur ? sha256(cur) : 'absent'
    if (curSha !== p.base_sha) { setState(id, 'pending', 'stale', `base changed to ${curSha}`); append('decide-refused', { proposal: id, target: p.target, base_sha: p.base_sha, detail: { reason: 'stale base at approval', current: curSha } }); return { applied: false, state: 'stale', message: `refused as stale: target changed since proposal (now ${curSha})` } }
    setState(id, 'pending', 'applying', 'spent')
    append('decide', { proposal: id, target: p.target, base_sha: p.base_sha, new_sha: p.new_sha, detail: { outcome, by: 'dsh-popup', spent: true } })
    return null
  })
  if (pre) return pre
  try {
    const bytes = db.prepare('SELECT bytes FROM blobs WHERE sha=?').get(p.new_sha)?.bytes
    if (!bytes || sha256(Buffer.from(bytes)) !== p.new_sha) throw new Error('approved bytes missing from version store')
    writeTarget(s, Buffer.from(bytes), id)
    const got = sha256(readCur(s)); if (got !== p.new_sha) throw new Error('post-write hash mismatch ' + got)
    return tx(() => {
      const appliedAt = iso()
      const receipt = { v: 1, kind: p.kind, proposal: id, target: p.target, base_sha: p.base_sha, new_sha: p.new_sha, applied_at: appliedAt, decision: 'allowed-once as reported by the harness from the DSH popup (gate cannot independently verify the click)', pubkey_fp: key.fp }
      const rbody = JSON.stringify(receipt)
      const rsig = sign(null, Buffer.from(rbody), key.priv).toString('base64')
      setState(id, 'applying', 'applied', 'applied')
      const e = append(p.kind === 'revert' ? 'revert-applied' : 'apply', { proposal: id, target: p.target, base_sha: p.base_sha, new_sha: p.new_sha, detail: { receipt, receipt_sig: rsig } })
      prune(p.target)
      return { applied: true, state: 'applied', entry: s.entry, receipt, receipt_sig: rsig, ledger_seq: e.seq, ledger_hash: e.hash, message: 'applied' }
    })
  } catch (e) {
    let cur = null; try { cur = sha256(readCur(s)) } catch {}
    tx(() => { const st = cur === p.new_sha ? 'applied' : 'failed'; setState(id, 'applying', st, String(e.message)); append(st === 'applied' ? 'apply' : 'apply-failed', { proposal: id, target: p.target, base_sha: p.base_sha, new_sha: p.new_sha, detail: { error: String(e.message) } }) })
    throw e
  }
}

function writeTarget(s, bytes, id) {
  noSymlinks(path.dirname(s.file))
  fs.mkdirSync(path.dirname(s.file), { recursive: true, mode: 0o750 })
  const tmp = `${s.file}.tmp-${id}`
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o640)
  try { fs.writeSync(fd, bytes); if (GID) fs.fchownSync(fd, process.getuid(), GID); fs.fchmodSync(fd, 0o640); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, s.file)
  const dfd = fs.openSync(path.dirname(s.file), 'r'); try { fs.fsyncSync(dfd) } finally { fs.closeSync(dfd) }
}
function prune(target) {
  const keep = db.prepare("SELECT new_sha AS sha FROM ledger WHERE target=? AND event IN ('apply','revert-applied','genesis-target') ORDER BY seq DESC LIMIT ?").all(target, KEEP_VERSIONS).map(r => r.sha)
  const pendingShas = db.prepare("SELECT base_sha, new_sha FROM proposals WHERE target=? AND state IN ('pending','applying')").all(target).flatMap(r => [r.base_sha, r.new_sha])
  const live = new Set([...keep, ...pendingShas])
  for (const b of db.prepare('SELECT sha FROM blobs WHERE target=?').all(target)) if (!live.has(b.sha)) {
    const appliedEver = db.prepare("SELECT 1 FROM ledger WHERE target=? AND new_sha=? AND event IN ('apply','revert-applied','genesis-target') LIMIT 1").get(target, b.sha)
    if (!appliedEver) db.prepare('DELETE FROM blobs WHERE sha=?').run(b.sha) // never-applied proposal bytes
  }
}
function history(target) {
  spec(target)
  const cur = readCur(TARGETS[target]); const curSha = cur ? sha256(cur) : 'absent'
  const rows = db.prepare("SELECT seq, at, event, proposal, new_sha FROM ledger WHERE target=? AND event IN ('apply','revert-applied','genesis-target') ORDER BY seq DESC LIMIT ?").all(target, KEEP_VERSIONS)
  const seen = new Set(), versions = []
  for (const r of rows) { if (seen.has(r.new_sha)) continue; seen.add(r.new_sha)
    const b = db.prepare('SELECT bytes FROM blobs WHERE sha=?').get(r.new_sha)
    versions.push({ sha256: r.new_sha, last_applied_at: r.at, ledger_seq: r.seq, event: r.event, current: r.new_sha === curSha, available: !!b, content: b ? Buffer.from(b.bytes).toString('utf8') : null }) }
  return { target, current_sha256: curSha, versions }
}
function revert({ target, to_sha, why, session, call_id }) {
  spec(target)
  let to = to_sha
  if (to === 'previous' || to == null) { const h = history(target); const prev = h.versions.find(v => !v.current); if (!prev) throw new Error('nothing to revert: no earlier applied version recorded in the ledger'); to = prev.sha256 }
  if (typeof to !== 'string' || !SHA.test(to)) throw new Error('to_sha256 must be a 64-hex sha256 from change_log / read_target history')
  const known = db.prepare("SELECT 1 FROM ledger WHERE target=? AND new_sha=? AND event IN ('apply','revert-applied','genesis-target') LIMIT 1").get(target, to)
  if (!known) throw new Error(`refused: ${to} was never an applied version of ${target} in the ledger`)
  const b = db.prepare('SELECT bytes FROM blobs WHERE sha=?').get(to)
  if (!b) throw new Error(`refused: version ${to} is no longer kept (only the last ${KEEP_VERSIONS} applied versions are kept)`)
  return createProposal({ target, content: Buffer.from(b.bytes).toString('utf8'), why: why ?? `revert ${target} to ${to}`, session, call_id }, 'revert', { revert_to: to })
}

// ---- startup: genesis of targets + crash reconciliation (never silently replay) ----
for (const [t, s] of Object.entries(TARGETS)) {
  const cur = readCur(s)
  if (cur && !db.prepare("SELECT 1 FROM ledger WHERE target=? AND new_sha=? AND event IN ('apply','revert-applied','genesis-target') LIMIT 1").get(t, sha256(cur))) {
    tx(() => { putBlob(t, cur); append('genesis-target', { target: t, new_sha: sha256(cur), detail: { note: 'current bytes adopted at gate start (first sight of this content)' } }) })
  }
}
for (const r of db.prepare("SELECT * FROM proposals WHERE state='applying'").all()) {
  const s = TARGETS[r.target]; let cur = null; try { const b = readCur(s); cur = b ? sha256(b) : 'absent' } catch {}
  tx(() => {
    if (cur === r.new_sha) { setState(r.id, 'applying', 'applied', 'reconciled after crash: approved bytes present'); append('reconcile', { proposal: r.id, target: r.target, base_sha: r.base_sha, new_sha: r.new_sha, detail: { result: 'applied (bytes already written)' } }) }
    else if (cur === r.base_sha) { setState(r.id, 'applying', 'failed', 'reconciled after crash: bytes not written; spent; NOT re-applied'); append('reconcile', { proposal: r.id, target: r.target, base_sha: r.base_sha, new_sha: r.new_sha, detail: { result: 'failed: not written, approval spent, NOT replayed' } }) }
    else { setState(r.id, 'applying', 'conflict', `file ${cur} matches neither`); append('reconcile', { proposal: r.id, target: r.target, detail: { result: 'conflict', current: cur } }) }
  })
}
for (const r of db.prepare("SELECT id, target FROM proposals WHERE state='pending' AND expires < ?").all(now())) tx(() => { setState(r.id, 'pending', 'expired', 'expired (gate start)'); append('expire', { proposal: r.id, target: r.target, detail: { reason: 'ttl elapsed' } }) })
{ const v = verifyLedger(db, key.pub); append('gate-start', { detail: { pid: process.pid, ledger_ok_before_start: v.ok, entries: v.entries, pubkey_fp: key.fp } }); if (!v.ok) console.error('LEDGER VERIFY FAILED', v.errors) }

const ops = {
  ping: () => ({ ok: true, pubkey_fp: key.fp, pubkey_pem: key.pubPem }),
  targets: () => Object.entries(TARGETS).map(([t, s]) => ({ target: t, schema: s.schema, entry: s.entry, maxBytes: s.maxBytes })),
  read: ({ target }) => { const s = spec(target); const b = readCur(s); return { target, sha256: b ? sha256(b) : 'absent', bytes: b ? b.length : 0, content: b ? b.toString('utf8') : null, schema: s.schema } },
  propose: (a) => createProposal({ ...a, claimed_base: a.claimed_base }, 'change'),
  revert,
  decide,
  history: ({ target }) => history(target),
  harness_start: ({ pid }) => tx(() => {
    const rows = db.prepare("SELECT id, target FROM proposals WHERE state='pending'").all()
    for (const r of rows) { setState(r.id, 'pending', 'expired', 'harness restarted before decision'); append('expire', { proposal: r.id, target: r.target, detail: { reason: 'harness restarted before decision' } }) }
    append('harness-start', { detail: { pid: Number(pid) || null, expired_pending: rows.length } }); return { expired: rows.length }
  }),
  selfcheck: ({ result }) => { append('selfcheck', { detail: result && typeof result === 'object' ? result : { raw: String(result).slice(0, 2000) } }); return { ok: true } },
  log: ({ limit, target }) => {
    const n = Math.max(1, Math.min(200, Number(limit) || 30))
    const rows = target ? db.prepare('SELECT seq,at,event,proposal,target,base_sha,new_sha,detail,hash FROM ledger WHERE target=? ORDER BY seq DESC LIMIT ?').all(String(target), n)
      : db.prepare('SELECT seq,at,event,proposal,target,base_sha,new_sha,detail,hash FROM ledger ORDER BY seq DESC LIMIT ?').all(n)
    return { verify: verifyLedger(db, key.pub), pubkey_fp: key.fp, entries: rows.map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })) }
  },
  verify: () => verifyLedger(db, key.pub),
  status: () => ({ pubkey_fp: key.fp, verify: verifyLedger(db, key.pub),
    proposals: db.prepare('SELECT id,kind,target,base_sha,new_sha,state,note,created,expires FROM proposals ORDER BY created DESC LIMIT 20').all() }),
}

fs.mkdirSync(RUN, { recursive: true })
try { fs.unlinkSync(SOCK) } catch {}
const server = net.createServer((c) => {
  let buf = ''
  c.setTimeout(30000, () => c.destroy())
  c.on('data', (d) => {
    buf += d; if (buf.length > 1 << 20) { c.destroy(); return }
    const nl = buf.indexOf('\n'); if (nl < 0) return
    let req, res
    try { req = JSON.parse(buf.slice(0, nl)); const fn = Object.hasOwn(ops, req?.op) ? ops[req.op] : null; if (!fn) throw new Error('unknown op'); res = { ok: true, result: fn(req.args ?? {}) } }
    catch (e) { res = { ok: false, error: String(e?.message ?? e) } }
    c.end(JSON.stringify(res) + '\n')
  })
  c.on('error', () => {})
})
server.listen(SOCK, () => {
  const gid = Number(process.env.SKGATE_GID)
  if (gid) fs.chownSync(SOCK, process.getuid(), gid)
  fs.chmodSync(SOCK, 0o660)
  fs.writeFileSync(path.join(RUN, 'receipt-ed25519.pub'), key.pubPem, { mode: 0o644 })
  console.log(`skunkworks-gate listening on ${SOCK} pubkey ${key.fp}`)
})
const stop = () => { try { server.close() } catch {}; try { db.close() } catch {}; process.exit(0) }
process.on('SIGTERM', stop); process.on('SIGINT', stop)
