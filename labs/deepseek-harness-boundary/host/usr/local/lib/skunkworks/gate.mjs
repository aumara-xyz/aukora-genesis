// skunkworks-gate — approval/state authority for SKUNKWORKS, runs as Linux user aukora-gate.
// Root-owned code (/usr/local/lib/skunkworks/gate.mjs).
//
// Two channels, so the harness (aukora-host) can PROPOSE and READ AUDIT but can NEVER APPROVE:
//   * PROPOSE socket  /run/skunkworks-gate/gate.sock   (group skgate, 0660): ping/read/propose/revert/
//       history/log/verify/status/state/harness_start/selfcheck/close(reject only). NO approve op exists here.
//   * OWNER  socket   /run/skunkworks-gate/owner.sock   (0600, owned by aukora-gate): pending/approve/reject.
//       0600 + aukora-gate ownership is the OS enforcement: only aukora-gate and root may connect(2).
//       The box operator reaches it with `sudo -u aukora-gate`; aukora-host gets EACCES. (Node has no
//       SO_PEERCRED API, so the kernel's socket-file permission check is the enforcement: split sockets.)
//   * OWNER HTTP      127.0.0.1:<OWNER_HTTP_PORT>  (bearer token held only by aukora-gate): a tiny approval
//       page for Peter, published on its OWN cloudflared tunnel so it never passes through the harness.
//
// Approval evidence recorded in each receipt is an HMAC(owner_secret, id|base|new|approver) plus the
// approver principal — never a hard-coded 'dsh-popup'. owner_secret lives in aukora-gate's home, 0600.
//
// Future: replace the owner bearer/HMAC with a Mac Touch ID / WebAuthn assertion verified here (the gate
// would store only the credential public key and verify the signed challenge). DESIGN NOTE ONLY — never phone.
//
// Allowlist = declarative, schema-validated targets ONLY. No code targets (no plugin installs).
// Usage: node gate.mjs            (serve)
//        node gate.mjs verify [db] [pubkey.pem]   (verify ledger chain + signatures; exit 0 ok / 1 broken)
//        node gate.mjs approve <id> | reject <id> (owner CLI over owner.sock; run as aukora-gate/root)
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, createHmac, randomUUID, randomBytes, timingSafeEqual, generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const HOME = '/workspace/skunkworks/gate'
const TARGET_ROOT = '/workspace/skunkworks/targets'
const RUN = '/run/skunkworks-gate'
const SOCK = path.join(RUN, 'gate.sock')
const OWNER_SOCK = path.join(RUN, 'owner.sock')
const OWNER_HTTP_PORT = 17792
const TTL_MS = 5 * 60 * 1000
const POPUP_LIMIT = 12000
const NOTE_MAX = 120
const KEEP_VERSIONS = 50
const GID = Number(process.env.SKGATE_GID) || 0
// rate limits (C)
const MAX_PENDING_PER_SESSION = 1
const MAX_PER_WINDOW = 3
const WINDOW_MS = 10 * 60 * 1000
const REJECT_COOLDOWN_MS = 60 * 1000
const DEDUPE_MS = 10 * 60 * 1000

const COLOR_NAMES = { '#1e90ff': 'blue', '#ffd700': 'gold', '#d4af37': 'gold', '#000000': 'black', '#ffffff': 'white',
  '#ff0000': 'red', '#00ff00': 'green', '#008000': 'green', '#0000ff': 'blue', '#ffa500': 'orange', '#800080': 'purple', '#808080': 'grey' }
const colorName = (hex) => COLOR_NAMES[String(hex).toLowerCase()] ?? 'custom'

const TARGETS = {
  'plugins/auma-theme/theme.json': {
    file: path.join(TARGET_ROOT, 'plugins/auma-theme/theme.json'),
    entry: 'auma-theme', maxBytes: 256,
    schema: '{"accent": "default" | "#RRGGBB"} — exactly one key, JSON object, ≤256 bytes',
    // Canonical bytes ONLY: exactly {"accent": "default"} or {"accent": "#RRGGBB"} with UPPERCASE hex, one space
    // after the colon, no newline, nothing else. Kills duplicate keys, \u escapes, case/whitespace/CRLF variants.
    canonical: /^\{"accent": "(default|#[0-9A-F]{6})"\}$/,
    validate(text) {
      if (this.canonical.test(text)) return
      let hint = ''
      try { const j = JSON.parse(text); if (j && typeof j.accent === 'string' && /^(default|#[0-9a-fA-F]{6})$/.test(j.accent) && Object.keys(j).length === 1) hint = ` Canonical form of the parsed value would be ${JSON.stringify({ accent: j.accent === 'default' ? 'default' : j.accent.toUpperCase() }).replace('":"', '": "')} (only if that is really what you mean: duplicate keys/escapes are refused).` } catch {}
      throw new Error('theme.json must be byte-exactly {"accent": "#RRGGBB"} (uppercase hex) or {"accent": "default"}: one key, one space after the colon, no newline, no escapes.' + hint)
    },
    accentOf(text) { const m = this.canonical.exec(text || ''); return m ? m[1] : null },
    plain(oldText, newText) {
      const a = this.accentOf(oldText) ?? '(non-canonical)', b = this.accentOf(newText) ?? '(invalid)'
      return `accent: ${a} ${colorName(a)} -> ${b} ${colorName(b)}`
    },
    after(newText) { const b = this.accentOf(newText); return `AFTER APPLY: accent = ${b} (${colorName(b)})` },
  },
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const iso = () => new Date().toISOString()
const SHA = /^[0-9a-f]{64}$/

function loadKey() {
  const kp = path.join(HOME, 'receipt-ed25519.pem')
  if (!fs.existsSync(kp)) fs.writeFileSync(kp, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' })
  const priv = createPrivateKey(fs.readFileSync(kp)); const pub = createPublicKey(priv)
  return { priv, pub, pubPem: pub.export({ type: 'spki', format: 'pem' }).toString(), fp: sha256(pub.export({ type: 'spki', format: 'der' })).slice(0, 16) }
}
function loadOwnerSecret() {
  const f = path.join(HOME, 'owner-secret.json')
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ hmacKey: randomBytes(32).toString('hex'), bearer: randomBytes(32).toString('base64url') }), { mode: 0o600, flag: 'wx' })
  return JSON.parse(fs.readFileSync(f, 'utf8'))
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
    if (sha256(entryBody(e)) !== e.hash) errors.push(`seq ${e.seq}: hash mismatch`)
    if (!verify(null, Buffer.from(e.hash, 'hex'), pub, Buffer.from(e.sig, 'base64'))) errors.push(`seq ${e.seq}: bad signature`)
    prev = e.hash; if (errors.length > 20) break
  }
  return { ok: errors.length === 0, entries: n, head: prev, errors }
}

if (process.argv[2] === 'verify') {
  const [dbFile, pubFile] = process.argv.slice(3)
  const pub = pubFile ? createPublicKey(fs.readFileSync(pubFile)) : loadKey().pub
  const db = new DatabaseSync(dbFile ?? path.join(HOME, 'gate.db'), { readOnly: true }); const r = verifyLedger(db, pub)
  console.log(JSON.stringify({ ...r, pubkey_fp: sha256(pub.export({ type: 'spki', format: 'der' })).slice(0, 16) }, null, 1)); process.exit(r.ok ? 0 : 1)
}
// owner CLI (over owner.sock; must run as aukora-gate or root)
if (process.argv[2] === 'approve' || process.argv[2] === 'reject') {
  const op = process.argv[2], id = process.argv[3]
  const c = net.createConnection(OWNER_SOCK); let b = ''
  c.on('connect', () => c.write(JSON.stringify({ op, args: { id } }) + '\n')); c.on('data', d => b += d)
  c.on('end', () => { console.log(b.trim()); process.exit(0) }); c.on('error', e => { console.error('owner.sock:', e.code); process.exit(1) })
  await new Promise(() => {})
}

// ---------------- serve ----------------
const key = loadKey()
const owner = loadOwnerSecret()
const db = openDb()
const now = () => Date.now()

function append(event, f = {}) {
  const last = db.prepare('SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1').get()
  const e = { seq: (last?.seq ?? 0) + 1, at: iso(), event, proposal: f.proposal ?? null, target: f.target ?? null,
    base_sha: f.base_sha ?? null, new_sha: f.new_sha ?? null, detail: f.detail === undefined ? null : JSON.stringify(f.detail), prev: last?.hash ?? 'GENESIS' }
  e.hash = sha256(entryBody(e)); e.sig = sign(null, Buffer.from(e.hash, 'hex'), key.priv).toString('base64')
  db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(e.seq, e.at, e.event, e.proposal, e.target, e.base_sha, e.new_sha, e.detail, e.prev, e.hash, e.sig)
  return e
}
function tx(fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e } }

function noSymlinks(p) { let cur = '/'; for (const part of p.split('/').filter(Boolean)) { cur = path.join(cur, part); try { if (fs.lstatSync(cur).isSymbolicLink()) throw new Error(`symlink in target path (${cur}); refused`) } catch (e) { if (e.code !== 'ENOENT') throw e } } }
function spec(target) { if (typeof target !== 'string' || !Object.hasOwn(TARGETS, target)) throw new Error(`target refused: ${JSON.stringify(String(target).slice(0, 120))} is not on the allowlist (${Object.keys(TARGETS).join(', ')}). Only declarative, schema-validated targets exist.`); return TARGETS[target] }
function readCur(s) { noSymlinks(s.file); let fd; try { fd = fs.openSync(s.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW) } catch (e) { if (e.code === 'ENOENT') return null; throw e } try { return fs.readFileSync(fd) } finally { fs.closeSync(fd) } }
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

// NOTE sanitiser (B): printable ASCII only, whitespace collapsed, <=120 chars, spoof markers neutralised.
function cleanNote(w) {
  if (w == null) return null
  let s = String(w).normalize('NFKC').replace(/[^\x20-\x7e]/g, ' ')  // drop NBSP/U+0085/lookalikes/RTL etc.
  s = s.replace(/GATE-/gi, 'gate_').replace(/\s+/g, ' ').trim()
  if (s.length > NOTE_MAX) s = s.slice(0, NOTE_MAX - 3) + '...'
  return s
}
function noteFlags(note, baseAccent, newAccent) {
  const flags = []; const n = (note || '').toLowerCase()
  if (/\b(no[\s-]?op|no change|nothing chang|unchanged|same as current|identical|revert nothing|does nothing|cosmetic only|just a typo|typo fix|trivial)\b/.test(n)) flags.push('NOTE claims little/no change, but the diff below is a real change - read the card.')
  const hexes = (note || '').match(/#[0-9a-fA-F]{6}/g) || []
  for (const h of hexes) if (h.toLowerCase() !== String(baseAccent).toLowerCase() && h.toLowerCase() !== String(newAccent).toLowerCase()) { flags.push(`NOTE mentions ${h}, which is neither the current nor the resulting colour.`); break }
  const want = colorName(newAccent)
  for (const [hex, name] of Object.entries(COLOR_NAMES)) if (new RegExp(`\\b${name}\\b`).test(n) && name !== want && name !== colorName(baseAccent)) { flags.push(`NOTE names a colour ("${name}") that is neither the current nor the resulting colour.`); break }
  if (/\b(host|verified|system|gate|sha-?256?|approve|allow[\s-]?once|allowed)\b/.test(n)) flags.push('NOTE uses words that look like gate/host wording - ignore them; only the marked card is from the gate.')
  return flags
}

function rateCheck(session, target, newSha) {
  const sid = session || 'nosession'
  const pend = db.prepare("SELECT COUNT(*) n FROM proposals WHERE session=? AND state='pending'").get(sid).n
  if (pend >= MAX_PENDING_PER_SESSION) throw new Error(`refused (rate limit): session already has ${pend} pending proposal (max ${MAX_PENDING_PER_SESSION}). Resolve it before proposing again.`)
  const win = db.prepare('SELECT COUNT(*) n FROM proposals WHERE session=? AND created>?').get(sid, now() - WINDOW_MS).n
  if (win >= MAX_PER_WINDOW) throw new Error(`refused (rate limit): ${win} proposals in the last ${WINDOW_MS / 60000} min for this session (max ${MAX_PER_WINDOW}).`)
  const lastRej = db.prepare("SELECT updated FROM proposals WHERE session=? AND state='refused' ORDER BY updated DESC LIMIT 1").get(sid)
  if (lastRej && now() - lastRej.updated < REJECT_COOLDOWN_MS) throw new Error(`refused (cooldown): a proposal was rejected ${Math.round((now() - lastRej.updated) / 1000)}s ago; wait ${Math.ceil((REJECT_COOLDOWN_MS - (now() - lastRej.updated)) / 1000)}s.`)
  const dupe = db.prepare("SELECT 1 FROM proposals WHERE target=? AND new_sha=? AND state='refused' AND updated>? LIMIT 1").get(target, newSha, now() - DEDUPE_MS)
  if (dupe) throw new Error('refused (dedupe): an identical proposal (same target and result) was rejected in the last 10 min.')
}

function buildPopup(p, oldText) {
  const marker = 'GATE-' + randomBytes(3).toString('hex')
  const s = TARGETS[p.target]
  const baseAccent = s.accentOf ? s.accentOf(oldText) : null
  const newAccent = s.accentOf ? s.accentOf(p.content) : null
  return {
    marker,
    after_apply: s.after ? s.after(p.content) : `AFTER APPLY: ${p.bytes} bytes`,
    plain_change: s.plain ? s.plain(oldText || '', p.content) : `${p.bytes} bytes change`,
    note: p.why ?? null,
    flags: noteFlags(p.why, baseAccent, newAccent),
    banner: 'Only the lines marked with the one-time code below are from the gate. The NOTE is text written by the model; it is not verified. This card does not approve - approval happens on the gate owner page.',
  }
}

function createProposal({ target, content, why, claimed_base, session, call_id }, kind, extra = {}) {
  const s = spec(target)
  if (typeof content !== 'string') throw new Error('content must be a string')
  if (!content.isWellFormed() || !/^[\x20-\x7e]*$/.test(content)) { append('reject', { target, detail: { reason: 'non-printable-ascii', kind } }); throw new Error('refused: content must be printable ASCII only (0x20-0x7e; no newlines, tabs, unicode or lone surrogates)') }
  const bytes = Buffer.from(content, 'utf8')
  if (bytes.length > s.maxBytes) { append('reject', { target, detail: { reason: 'oversized', bytes: bytes.length, max: s.maxBytes, kind } }); throw new Error(`refused: ${bytes.length} bytes exceeds the ${s.maxBytes}-byte limit for ${target}`) }
  try { s.validate(content) } catch (e) { append('reject', { target, detail: { reason: 'schema', error: e.message, kind } }); throw new Error('refused (schema): ' + e.message) }
  if (why != null && String(why).length > 4000) throw new Error('refused: why/summary too long')
  const cur = readCur(s); const baseSha = cur ? sha256(cur) : 'absent'
  if (kind !== 'revert') {
    if (typeof claimed_base !== 'string' || !(SHA.test(claimed_base) || claimed_base === 'absent')) { append('reject', { target, base_sha: baseSha, detail: { reason: 'no-base', kind } }); throw new Error(`refused as stale: base_sha256 is required (current sha256 is ${baseSha}). Blind overwrites are not accepted.`) }
    if (claimed_base !== baseSha) { append('reject', { target, base_sha: baseSha, detail: { reason: 'stale-base', claimed: claimed_base, kind } }); throw new Error(`refused as stale: you based this on ${claimed_base} but the current sha256 is ${baseSha}.`) }
  }
  const newSha = sha256(bytes)
  if (newSha === baseSha) throw new Error('refused: proposed content is identical to current content')
  rateCheck(session, target, newSha)
  const diff = lineDiff(cur ? cur.toString('utf8') : '', content, target)
  const displayable = diff.length + content.length <= POPUP_LIMIT ? 1 : 0
  const id = randomUUID(), created = now(), expires = created + TTL_MS
  const w = cleanNote(why)
  return tx(() => {
    if (cur) putBlob(target, cur); putBlob(target, bytes)
    db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, kind, target, baseSha, newSha, diff, w, String(session ?? ''), String(call_id ?? ''), created, expires, displayable, 'pending', null, created)
    const e = append('propose', { proposal: id, target, base_sha: baseSha, new_sha: newSha, detail: { kind, note: w, session: String(session ?? ''), expires: new Date(expires).toISOString(), displayable: !!displayable, ...extra } })
    const p = { id, kind, target, entry: s.entry, base_sha: baseSha, new_sha: newSha, diff, content, bytes: bytes.length, why: w, created, expires, displayable: !!displayable, ledger_seq: e.seq }
    return { ...p, popup: buildPopup(p, cur ? cur.toString('utf8') : '') }
  })
}

const setState = (id, from, to, note) => db.prepare('UPDATE proposals SET state=?, note=?, updated=? WHERE id=? AND state=?').run(to, note ?? null, now(), id, from).changes === 1

// close: PROPOSE-side may only reject/expire/cancel a pending proposal. It can NEVER approve.
function close({ id, outcome }) {
  if (typeof id !== 'string') throw new Error('id required')
  const p = db.prepare('SELECT * FROM proposals WHERE id=?').get(id)
  if (!p) return { applied: false, state: 'unknown', message: 'unknown proposal id' }
  if (!['rejected', 'cancelled', 'unavailable', 'expired'].includes(outcome)) { append('decide-refused', { proposal: id, target: p.target, detail: { reason: 'approval is not possible on the propose channel', outcome: String(outcome).slice(0, 40), via: 'propose-close' } }); throw new Error('refused: the harness channel cannot approve; approval happens only on the gate owner channel') }
  const to = outcome === 'rejected' ? 'refused' : 'expired'
  return tx(() => {
    if (!setState(id, 'pending', to, String(outcome || 'closed'))) { append('decide-refused', { proposal: id, target: p.target, detail: { reason: 'not pending', state: p.state, outcome, via: 'propose-close' } }); return { applied: false, state: p.state, message: `proposal is ${p.state}` } }
    append('decide', { proposal: id, target: p.target, base_sha: p.base_sha, new_sha: p.new_sha, detail: { outcome: outcome === 'rejected' ? 'rejected' : 'cancelled', via: 'propose-close (harness); not an approval' } })
    return { applied: false, state: to, message: outcome || 'closed' }
  })
}

// APPROVE: owner-channel only. Records HMAC approval evidence + approver principal.
function ownerDecide({ id, outcome }, approver) {
  if (typeof id !== 'string') throw new Error('id required')
  const p = db.prepare('SELECT * FROM proposals WHERE id=?').get(id)
  if (!p) { append('decide-refused', { proposal: String(id).slice(0, 64), detail: { reason: 'unknown proposal', via: 'owner' } }); return { applied: false, state: 'unknown', message: 'unknown proposal id' } }
  if (outcome === 'rejected') return tx(() => {
    if (!setState(id, 'pending', 'refused', 'owner rejected')) return { applied: false, state: p.state, message: `proposal is ${p.state}` }
    append('decide', { proposal: id, target: p.target, base_sha: p.base_sha, new_sha: p.new_sha, detail: { outcome: 'rejected', via: 'owner', approver } })
    return { applied: false, state: 'refused', message: 'rejected' }
  })
  const s = spec(p.target)
  const pre = tx(() => {
    const r = db.prepare('SELECT state, expires, displayable FROM proposals WHERE id=?').get(id)
    if (r.state !== 'pending') { append('decide-refused', { proposal: id, target: p.target, detail: { reason: 'replay: not pending', state: r.state, via: 'owner' } }); return { applied: false, state: r.state, message: `refused: already used or closed (state ${r.state}) — replay refused` } }
    if (now() > r.expires) { setState(id, 'pending', 'expired', 'approved after expiry'); append('decide-refused', { proposal: id, target: p.target, detail: { reason: 'approved after expiry', via: 'owner' } }); return { applied: false, state: 'expired', message: 'refused: approval arrived after expiry' } }
    if (!r.displayable) { setState(id, 'pending', 'refused', 'too large for popup'); append('decide-refused', { proposal: id, target: p.target, detail: { reason: 'TRUNCATED: approval disabled', via: 'owner' } }); return { applied: false, state: 'refused', message: 'refused: proposal too large to show in full; approval disabled' } }
    const cur = readCur(s); const curSha = cur ? sha256(cur) : 'absent'
    if (curSha !== p.base_sha) { setState(id, 'pending', 'stale', `base changed to ${curSha}`); append('decide-refused', { proposal: id, target: p.target, base_sha: p.base_sha, detail: { reason: 'stale base at approval', current: curSha, via: 'owner' } }); return { applied: false, state: 'stale', message: `refused as stale: target changed since proposal (now ${curSha})` } }
    setState(id, 'pending', 'applying', 'spent')
    append('decide', { proposal: id, target: p.target, base_sha: p.base_sha, new_sha: p.new_sha, detail: { outcome: 'allowed-once', via: 'owner', approver, spent: true } })
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
      const evidence = createHmac('sha256', Buffer.from(owner.hmacKey, 'hex')).update(`${id}\n${p.base_sha}\n${p.new_sha}\n${approver}`).digest('base64')
      const receipt = { v: 2, kind: p.kind, proposal: id, target: p.target, base_sha: p.base_sha, new_sha: p.new_sha, applied_at: appliedAt, approver, approval_evidence_hmac: evidence, pubkey_fp: key.fp }
      const rsig = sign(null, Buffer.from(JSON.stringify(receipt)), key.priv).toString('base64')
      setState(id, 'applying', 'applied', 'applied')
      const e = append(p.kind === 'revert' ? 'revert-applied' : 'apply', { proposal: id, target: p.target, base_sha: p.base_sha, new_sha: p.new_sha, detail: { receipt, receipt_sig: rsig } })
      prune(p.target)
      return { applied: true, state: 'applied', entry: s.entry, receipt, receipt_sig: rsig, ledger_seq: e.seq, ledger_hash: e.hash, message: 'applied' }
    })
  } catch (e) {
    let cur = null; try { cur = sha256(readCur(s)) } catch {}
    tx(() => { const st = cur === p.new_sha ? 'applied' : 'failed'; setState(id, 'applying', st, String(e.message)); append(st === 'applied' ? 'apply' : 'apply-failed', { proposal: id, target: p.target, base_sha: p.base_sha, new_sha: p.new_sha, detail: { error: String(e.message), via: 'owner' } }) })
    throw e
  }
}

function writeTarget(s, bytes, id) {
  noSymlinks(path.dirname(s.file)); fs.mkdirSync(path.dirname(s.file), { recursive: true, mode: 0o750 })
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
  for (const b of db.prepare('SELECT sha FROM blobs WHERE target=?').all(target)) if (!live.has(b.sha)) { const ever = db.prepare("SELECT 1 FROM ledger WHERE target=? AND new_sha=? AND event IN ('apply','revert-applied','genesis-target') LIMIT 1").get(target, b.sha); if (!ever) db.prepare('DELETE FROM blobs WHERE sha=?').run(b.sha) }
}
function history(target) {
  spec(target); const cur = readCur(TARGETS[target]); const curSha = cur ? sha256(cur) : 'absent'
  const rows = db.prepare("SELECT seq, at, event, proposal, new_sha FROM ledger WHERE target=? AND event IN ('apply','revert-applied','genesis-target') ORDER BY seq DESC LIMIT ?").all(target, KEEP_VERSIONS)
  const seen = new Set(), versions = []
  for (const r of rows) { if (seen.has(r.new_sha)) continue; seen.add(r.new_sha); const b = db.prepare('SELECT bytes FROM blobs WHERE sha=?').get(r.new_sha)
    versions.push({ sha256: r.new_sha, last_applied_at: r.at, ledger_seq: r.seq, event: r.event, current: r.new_sha === curSha, available: !!b, content: b ? Buffer.from(b.bytes).toString('utf8') : null }) }
  return { target, current_sha256: curSha, versions }
}
function revert({ target, to_sha, why, session, call_id }) {
  spec(target); let to = to_sha
  if (to === 'previous' || to == null) { const prev = history(target).versions.find(v => !v.current); if (!prev) throw new Error('nothing to revert: no earlier applied version recorded'); to = prev.sha256 }
  if (typeof to !== 'string' || !SHA.test(to)) throw new Error('to_sha256 must be a 64-hex sha256 from change_log / read_target history')
  if (!db.prepare("SELECT 1 FROM ledger WHERE target=? AND new_sha=? AND event IN ('apply','revert-applied','genesis-target') LIMIT 1").get(target, to)) throw new Error(`refused: ${to} was never an applied version of ${target}`)
  const b = db.prepare('SELECT bytes FROM blobs WHERE sha=?').get(to); if (!b) throw new Error(`refused: version ${to} is no longer kept`)
  const stored = Buffer.from(b.bytes), text = stored.toString('utf8')
  if (sha256(stored) !== to || !Buffer.from(text, 'utf8').equals(stored)) throw new Error(`refused: stored version ${to} does not round-trip byte-for-byte`)
  return createProposal({ target, content: text, why: why ?? `revert ${target} to ${to}`, session, call_id }, 'revert', { revert_to: to })
}

// ---- startup: genesis + reconciliation ----
for (const [t, s] of Object.entries(TARGETS)) { const cur = readCur(s); let validCur = true; try { if (cur) { const txt = cur.toString('utf8'); if (!/^[\x20-\x7e]*$/.test(txt)) throw new Error('non-ASCII'); s.validate(txt) } } catch (e) { validCur = false; console.error(`target ${t} current bytes fail schema (${e.message}); NOT adopted as a revertable version`); append('genesis-target-invalid', { target: t, new_sha: sha256(cur), detail: { error: String(e.message).slice(0, 200) } }) }
  if (cur && validCur && !db.prepare("SELECT 1 FROM ledger WHERE target=? AND new_sha=? AND event IN ('apply','revert-applied','genesis-target') LIMIT 1").get(t, sha256(cur))) tx(() => { putBlob(t, cur); append('genesis-target', { target: t, new_sha: sha256(cur), detail: { note: 'current bytes adopted at gate start' } }) }) }
for (const r of db.prepare("SELECT * FROM proposals WHERE state='applying'").all()) { const s = TARGETS[r.target]; let cur = null; try { const b = readCur(s); cur = b ? sha256(b) : 'absent' } catch {}
  tx(() => { if (cur === r.new_sha) { setState(r.id, 'applying', 'applied', 'reconciled after crash: bytes present'); append('reconcile', { proposal: r.id, target: r.target, base_sha: r.base_sha, new_sha: r.new_sha, detail: { result: 'applied' } }) }
    else if (cur === r.base_sha) { setState(r.id, 'applying', 'failed', 'reconciled: not written; spent; NOT re-applied'); append('reconcile', { proposal: r.id, target: r.target, base_sha: r.base_sha, new_sha: r.new_sha, detail: { result: 'failed: not written, spent, NOT replayed' } }) }
    else { setState(r.id, 'applying', 'conflict', `file ${cur} matches neither`); append('reconcile', { proposal: r.id, target: r.target, detail: { result: 'conflict', current: cur } }) } }) }
for (const r of db.prepare("SELECT id, target FROM proposals WHERE state='pending' AND expires < ?").all(now())) tx(() => { setState(r.id, 'pending', 'expired', 'expired (gate start)'); append('expire', { proposal: r.id, target: r.target, detail: { reason: 'ttl elapsed' } }) })
{ const v = verifyLedger(db, key.pub); append('gate-start', { detail: { pid: process.pid, ledger_ok_before_start: v.ok, entries: v.entries, pubkey_fp: key.fp, owner_http_port: OWNER_HTTP_PORT } }); if (!v.ok) console.error('LEDGER VERIFY FAILED', v.errors) }

const maskId = (id) => id ? id.slice(0, 8) + '…' : id
// PROPOSE-side ops (group skgate). No approve op. status/log redact pending ids & nonces.
const proposeOps = {
  ping: () => ({ ok: true, pubkey_fp: key.fp, pubkey_pem: key.pubPem }),
  targets: () => Object.entries(TARGETS).map(([t, s]) => ({ target: t, schema: s.schema, entry: s.entry, maxBytes: s.maxBytes })),
  read: ({ target }) => { const s = spec(target); const b = readCur(s); return { target, sha256: b ? sha256(b) : 'absent', bytes: b ? b.length : 0, content: b ? b.toString('utf8') : null, schema: s.schema } },
  propose: (a) => createProposal({ ...a }, 'change'),
  revert,
  close,
  state: ({ id }) => { const r = db.prepare('SELECT state, expires, updated FROM proposals WHERE id=?').get(String(id)); if (!r) return { state: 'unknown' }
    const out = { state: r.state, expires: r.expires, updated: r.updated }
    const d = db.prepare("SELECT seq, detail FROM ledger WHERE proposal=? AND event IN ('apply','revert-applied','decide') ORDER BY seq DESC LIMIT 1").get(String(id))
    if (d) { const j = JSON.parse(d.detail || '{}'); out.approver = j.receipt?.approver ?? j.approver ?? j.via ?? null; if (j.receipt) { out.ledger_seq = d.seq; out.pubkey_fp = j.receipt.pubkey_fp } }
    return out },
  history: ({ target }) => history(target),
  harness_start: ({ pid }) => tx(() => { const rows = db.prepare("SELECT id, target FROM proposals WHERE state='pending'").all(); for (const r of rows) { setState(r.id, 'pending', 'expired', 'harness restarted before decision'); append('expire', { proposal: r.id, target: r.target, detail: { reason: 'harness restarted before decision' } }) } append('harness-start', { detail: { pid: Number(pid) || null, expired_pending: rows.length } }); return { expired: rows.length } }),
  selfcheck: ({ result }) => { append('selfcheck', { detail: result && typeof result === 'object' ? result : { raw: String(result).slice(0, 2000) } }); return { ok: true } },
  log: ({ limit, target }) => { const n = Math.max(1, Math.min(200, Number(limit) || 30))
    const rows = target ? db.prepare('SELECT seq,at,event,proposal,target,base_sha,new_sha,detail,hash FROM ledger WHERE target=? ORDER BY seq DESC LIMIT ?').all(String(target), n) : db.prepare('SELECT seq,at,event,proposal,target,base_sha,new_sha,detail,hash FROM ledger ORDER BY seq DESC LIMIT ?').all(n)
    const pendingIds = new Set(db.prepare("SELECT id FROM proposals WHERE state='pending'").all().map(r => r.id))
    return { verify: verifyLedger(db, key.pub), pubkey_fp: key.fp, entries: rows.map(r => ({ ...r, proposal: pendingIds.has(r.proposal) ? maskId(r.proposal) : r.proposal, detail: r.detail ? JSON.parse(r.detail) : null })) } },
  verify: () => verifyLedger(db, key.pub),
  status: () => ({ pubkey_fp: key.fp, verify: verifyLedger(db, key.pub),
    proposals: db.prepare('SELECT id,kind,target,base_sha,new_sha,state,note,created,expires FROM proposals ORDER BY created DESC LIMIT 20').all().map(r => r.state === 'pending' ? { ...r, id: maskId(r.id) } : r) }),
}
// OWNER ops (owner.sock / owner HTTP only).
const ownerOps = {
  pending: () => ({ pubkey_fp: key.fp, pending: db.prepare("SELECT id,kind,target,base_sha,new_sha,why,session,created,expires FROM proposals WHERE state='pending' ORDER BY created DESC").all() }),
  approve: ({ id }, approver) => ownerDecide({ id, outcome: 'allowed-once' }, approver),
  reject: ({ id }, approver) => ownerDecide({ id, outcome: 'rejected' }, approver),
  status: proposeOps.status, log: proposeOps.log, verify: proposeOps.verify,
}

fs.mkdirSync(RUN, { recursive: true })
function lineServer(sockPath, opmap, approverFor) {
  try { fs.unlinkSync(sockPath) } catch {}
  const srv = net.createServer((c) => {
    let buf = ''; c.setTimeout(30000, () => c.destroy())
    c.on('data', (d) => { buf += d; if (buf.length > 1 << 20) { c.destroy(); return } const nl = buf.indexOf('\n'); if (nl < 0) return
      let res; try { const req = JSON.parse(buf.slice(0, nl)); const fn = Object.hasOwn(opmap, req?.op) ? opmap[req.op] : null; if (!fn) throw new Error('unknown op'); res = { ok: true, result: fn(req.args ?? {}, approverFor ? approverFor(c) : undefined) } }
      catch (e) { res = { ok: false, error: String(e?.message ?? e) } } c.end(JSON.stringify(res) + '\n') })
    c.on('error', () => {})
  })
  return srv
}
const proposeServer = lineServer(SOCK, proposeOps)
proposeServer.listen(SOCK, () => { if (GID) fs.chownSync(SOCK, process.getuid(), GID); fs.chmodSync(SOCK, 0o660); fs.writeFileSync(path.join(RUN, 'receipt-ed25519.pub'), key.pubPem, { mode: 0o644 }); console.log(`skunkworks-gate PROPOSE socket ${SOCK} pubkey ${key.fp}`) })
const ownerServer = lineServer(OWNER_SOCK, ownerOps, () => 'owner via owner.sock (local; 0600 aukora-gate/root only)')
ownerServer.listen(OWNER_SOCK, () => { fs.chmodSync(OWNER_SOCK, 0o600); console.log(`skunkworks-gate OWNER socket ${OWNER_SOCK} (0600)`) })

// ---- OWNER HTTP approval page (bearer token; published on its own tunnel) ----
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
function bearerOk(given) { try { const a = Buffer.from(String(given || '')); const b = Buffer.from(owner.bearer); return a.length === b.length && timingSafeEqual(a, b) } catch { return false } }
function pageHtml(msg) {
  const rows = db.prepare("SELECT id,kind,target,base_sha,new_sha,why,created,expires FROM proposals WHERE state='pending' ORDER BY created DESC").all()
  const items = rows.map(p => { const oldText = (() => { const b = db.prepare('SELECT bytes FROM blobs WHERE sha=?').get(p.base_sha); return b ? Buffer.from(b.bytes).toString('utf8') : '' })()
    const plain = TARGETS[p.target]?.plain ? TARGETS[p.target].plain(oldText, (() => { const b = db.prepare('SELECT bytes FROM blobs WHERE sha=?').get(p.new_sha); return b ? Buffer.from(b.bytes).toString('utf8') : '' })()) : ''
    return `<div class=card><div class=h>HOST-VERIFIED (gate)</div>
      <div class=plain>${esc(plain)}</div>
      <div>target: <b>${esc(p.target)}</b></div>
      <div>proposal ${esc(p.id)} · expires ${esc(new Date(p.expires).toLocaleTimeString('en-GB', { timeZone: 'Asia/Makassar' }))} WITA</div>
      <div>current sha256 ${esc(p.base_sha)}</div><div>result&nbsp; sha256 ${esc(p.new_sha)}</div>
      <div class=note><div class=nh>MODEL NOTE (unverified)</div>${esc(p.why || '(none)')}</div>
      <form method=POST action=/act><input type=hidden name=k value="${esc(owner.bearer)}"><input type=hidden name=id value="${esc(p.id)}"><input type=hidden name=base value="${esc(p.base_sha)}"><input type=hidden name=new value="${esc(p.new_sha)}">
      <button name=a value=approve class=ap>Approve</button> <button name=a value=reject class=rj>Reject</button></form></div>` }).join('\n')
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>SKUNKWORKS gate — owner approval</title>
  <style>body{font:15px/1.5 system-ui;margin:0;background:#111;color:#eee;padding:16px}.card{background:#1b1b1b;border:1px solid #444;border-radius:10px;padding:12px;margin:12px 0}.h{color:#6cf;font-weight:700;font-size:12px}.plain{font-size:18px;margin:6px 0}.note{background:#2a2a1a;border:1px dashed #776;border-radius:8px;padding:8px;margin:8px 0;white-space:pre-wrap}.nh{color:#cc6;font-size:12px;font-weight:700}button{font-size:16px;padding:10px 18px;border-radius:8px;border:0;margin-top:8px}.ap{background:#2a7;color:#fff}.rj{background:#a33;color:#fff}div{word-break:break-all}.msg{color:#6f6}</style>
  <h2>SKUNKWORKS gate — owner approval</h2><p>This page is served directly by the gate (aukora-gate), not by the harness. Only items below are gate-verified.</p>
  ${msg ? `<p class=msg>${esc(msg)}</p>` : ''}${items || '<p>No pending proposals.</p>'}`
}
const ownerHttp = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://gate.local')
  if (req.method === 'GET') {
    if (!bearerOk(u.searchParams.get('k'))) { res.writeHead(401, { 'content-type': 'text/plain' }); return res.end('unauthorized') }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(pageHtml(''))
  }
  if (req.method === 'POST' && u.pathname === '/act') {
    let body = ''; req.on('data', d => { body += d; if (body.length > 1e5) req.destroy() })
    req.on('end', () => {
      const f = new URLSearchParams(body)
      if (!bearerOk(f.get('k'))) { res.writeHead(401, { 'content-type': 'text/plain' }); return res.end('unauthorized') }
      const id = f.get('id'), a = f.get('a'); const p = db.prepare('SELECT base_sha,new_sha FROM proposals WHERE id=?').get(String(id))
      let msg
      if (!p) msg = 'proposal not found'
      else if (p.base_sha !== f.get('base') || p.new_sha !== f.get('new')) msg = 'refused: proposal changed since the page was shown; reload and re-check.'
      else { const r = ownerDecide({ id, outcome: a === 'approve' ? 'allowed-once' : 'rejected' }, 'owner via gate approval page (bearer token)'); msg = r.applied ? `APPLIED ${r.target ?? ''} — ledger #${r.ledger_seq}` : `${a === 'approve' ? 'not applied' : 'rejected'}: ${r.message}` }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(pageHtml(msg))
    }); return
  }
  res.writeHead(404); res.end('not found')
})
ownerHttp.listen(OWNER_HTTP_PORT, '127.0.0.1', () => { fs.writeFileSync(path.join(RUN, 'owner-http.port'), String(OWNER_HTTP_PORT), { mode: 0o644 }); console.log(`skunkworks-gate OWNER HTTP 127.0.0.1:${OWNER_HTTP_PORT}`) })

const stop = () => { for (const s of [proposeServer, ownerServer]) { try { s.close() } catch {} } try { ownerHttp.close() } catch {} try { db.close() } catch {} process.exit(0) }
process.on('SIGTERM', stop); process.on('SIGINT', stop)
