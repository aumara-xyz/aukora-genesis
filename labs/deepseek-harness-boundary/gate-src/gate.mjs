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
// RT3 (2026-10-03): unique colour names, owner page shows ALL warnings + AFTER APPLY + swatch, N1 global rate limits,
// N2/N3 note checks, normalised gate-wording, APPROVE-spam, two-step typed approve, 12 h owner bearer rotated on start.
// Source of truth: /workspace/skunkworks/gate-src/gate.mjs -> deployed by ops/deploy-gate.sh.
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
// N1 (RT3): limits are per TARGET and GLOBAL, never per harness-chosen session label.
const MAX_PENDING_GLOBAL = 1
const MAX_PER_WINDOW = 3
const WINDOW_MS = 10 * 60 * 1000
const REJECT_COOLDOWN_MS = 60 * 1000
const DEDUPE_MS = 10 * 60 * 1000
const BEARER_TTL_MS = 12 * 60 * 60 * 1000   // owner link expires after 12 h; rotated on every gate start
const CONFIRM_TTL_MS = 2 * 60 * 1000        // two-step approve: typed confirmation must arrive within 2 min
const NEAR_RGB = 48                         // N3: 'NEAR' warning radius (Euclidean RGB distance)

// G6004 (RT3): every name is unique per hex, and ONLY #FFD700 is 'gold'. Checked at start-up.
const GOLD = '#FFD700'
const COLOR_NAMES = { '#ffd700': 'gold', '#d4af37': 'metallic gold (not #FFD700)', '#1e90ff': 'dodger blue', '#0000ff': 'blue',
  '#000000': 'black', '#ffffff': 'white', '#ff0000': 'red', '#00ff00': 'lime green', '#008000': 'green', '#ffa500': 'orange',
  '#800080': 'purple', '#808080': 'grey' }
{ const seen = new Map(); for (const [h, n] of Object.entries(COLOR_NAMES)) { if (seen.has(n)) throw new Error(`COLOR_NAMES: name "${n}" used for ${seen.get(n)} and ${h}`); seen.set(n, h) }
  if (Object.entries(COLOR_NAMES).some(([h, n]) => /\bgold\b/.test(n) && h !== GOLD.toLowerCase() && !n.includes('not ' + GOLD))) throw new Error('COLOR_NAMES: only #FFD700 may be plain gold') }
const DEFAULT_NAME = 'app default (stock accent, NOT gold)'
const UNNAMED = 'custom (unnamed)'
const colorName = (hex) => { const h = String(hex ?? ''); if (h === 'default') return DEFAULT_NAME; return COLOR_NAMES[h.toLowerCase()] ?? UNNAMED }
const isHex = (h) => /^#[0-9a-fA-F]{6}$/.test(String(h ?? ''))
const rgbOf = (h) => isHex(h) ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : null
const rgbDist = (a, b) => { const A = rgbOf(a), B = rgbOf(b); return A && B ? Math.round(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) * 10) / 10 : null }
const hexDigitsDiff = (a, b) => isHex(a) && isHex(b) ? [...a.slice(1).toUpperCase()].filter((c, i) => c !== b.slice(1).toUpperCase()[i]).length : 6
function hueFamily(h) {
  const c = rgbOf(h); if (!c) return null
  const [r, g, b] = c.map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (l < 0.12) return 'black'; if (l > 0.93 && sat < 0.5) return 'white'; if (sat < 0.15) return 'grey'
  let hu = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hu = (hu * 60 + 360) % 360
  if (l < 0.45 && hu >= 15 && hu < 50) return 'brown'
  if (hu < 15 || hu >= 345) return 'red'; if (hu < 40) return 'orange'; if (hu < 65) return 'yellow'; if (hu < 160) return 'green'
  if (hu < 195) return 'cyan'; if (hu < 255) return 'blue'; if (hu < 290) return 'purple'; return 'pink'
}
// colour words a note may use; 'gold' matches ONLY #FFD700 (no family tolerance)
const COLOUR_WORDS = { red: 'red', crimson: 'red', scarlet: 'red', maroon: 'red', ruby: 'red', orange: 'orange', amber: 'orange', tangerine: 'orange',
  yellow: 'yellow', lemon: 'yellow', mustard: 'yellow', honey: 'yellow', green: 'green', lime: 'green', emerald: 'green', olive: 'green', mint: 'green',
  teal: 'cyan', cyan: 'cyan', turquoise: 'cyan', aqua: 'cyan', blue: 'blue', navy: 'blue', azure: 'blue', cobalt: 'blue', indigo: 'blue',
  purple: 'purple', violet: 'purple', lavender: 'purple', magenta: 'pink', pink: 'pink', rose: 'pink', fuchsia: 'pink', brown: 'brown', bronze: 'brown',
  copper: 'brown', beige: 'brown', grey: 'grey', gray: 'grey', silver: 'grey', charcoal: 'grey', black: 'black', white: 'white', gold: 'GOLD', golden: 'GOLD' }
// a colour word matches its own hue family, or a chromatic hex whose hue is within 35 deg of the word's centre hue
const WORD_HUE = { red: 0, orange: 30, yellow: 55, green: 120, cyan: 180, blue: 225, purple: 275, pink: 320 }
function hueOf(h) { const c = rgbOf(h); if (!c) return null; const [r, g, b] = c.map(v => v / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); if (!d) return null
  const hu = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (hu * 60 + 360) % 360 }
function wordMatches(word, hex) {
  const f = COLOUR_WORDS[word]; if (f === 'GOLD') return String(hex).toUpperCase() === GOLD
  const hf = hueFamily(hex); if (!hf) return false; if (f === hf) return true
  if (['grey', 'black', 'white'].includes(f) || ['grey', 'black', 'white'].includes(hf)) return false
  if (f === 'brown' || hf === 'brown') return ['orange', 'red', 'yellow'].includes(f === 'brown' ? hf : f)
  const hu = hueOf(hex); const dd = Math.abs(hu - WORD_HUE[f]); return Math.min(dd, 360 - dd) <= 35
}

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
// RT3 item 11: the owner bearer is rotated on every gate start (and via owner.sock 'rotate_bearer') and expires after 12 h.
// hmacKey is kept (receipts stay verifiable). Atomic tmp+rename, 0600. The value is never logged.
function rotateBearer(o) {
  const f = path.join(HOME, 'owner-secret.json'), tmp = f + '.tmp-' + process.pid
  const next = { ...o, bearer: randomBytes(32).toString('base64url'), bearer_issued: Date.now(), bearer_expires: Date.now() + BEARER_TTL_MS }
  fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600, flag: 'w' }); fs.renameSync(tmp, f)
  Object.assign(o, next); return { issued: new Date(next.bearer_issued).toISOString(), expires: new Date(next.bearer_expires).toISOString(), fp: sha256(next.bearer).slice(0, 8) }
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
const bearerInfo = rotateBearer(owner)
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
// RT3 item 7: what the sanitiser removed is never silent. Counted on the RAW note (before NFKC).
function noteMeta(w) {
  if (w == null) return { nonascii: 0 }
  const raw = String(w); const n = [...raw].filter(c => !/[\x20-\x7e\t\n\r]/.test(c)).length
  if (!n) return { nonascii: 0 }
  const b = Buffer.from(raw, 'utf8'); const cap = b.subarray(0, 192)
  return { nonascii: n, raw_bytes: b.length, hexdump: cap.toString('hex').replace(/(..)/g, '$1 ').trim() + (b.length > cap.length ? ` ... (+${b.length - cap.length} bytes)` : '') }
}
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'l', '+': 't' }
// common English words that merely CONTAIN 'gate'/'host'/'system' are removed before normalising
const BENIGN_SUBWORDS = /\b(navigat|aggregat|delegat|investigat|propagat|mitigat|segregat|irrigat|interrogat|obligat|instigat|abrogat|variegat|ghost|systematic)\w*/g
const squash = (s) => String(s || '').toLowerCase().replace(BENIGN_SUBWORDS, ' ').replace(/[^a-z0-9]/g, '')                       // separators stripped
const squashLeet = (s) => String(s || '').toLowerCase().replace(BENIGN_SUBWORDS, ' ').replace(/[0-9@$!|+]/g, c => LEET[c] ?? '').replace(/[^a-z]/g, '')
const GATE_TOKENS = ['gate', 'verif', 'host', 'system', 'sha256', 'sha2', 'approv', 'allowonce', 'allowed', 'signed', 'trusted', 'authori', 'official']
const IMPERSONATION = /\b(already|pre-?)\s*(approved|authori[sz]ed|signed[\s-]?off|cleared|ok'?d)\b|\b(peter|owner|admin|operator|policy team|security team|grok|anthropic|openai|deepseek|on behalf of)\b/
const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'are', 'was', 'its', 'you', 'your', 'not', 'but', 'has', 'have', 'will', 'all', 'any', 'our', 'out', 'to', 'of', 'is', 'in', 'it', 'on', 'at', 'as', 'be', 'or', 'an', 'by', 'so', 'if', 'we', 'me', 'my'])
const PRESSURE = [['approve', /^approv/], ['urgent', /^urgen/], ['now', /^now$/], ['trusted', /^trust/]]
const NOCHANGE = /\b(no[\s-]?op|no[\s-]?change|no (visual|visible|real) (change|diff|difference)|no diff|nothing (chang|visible)|unchanged|identical|same|still|stays?|remains?|keeps? (it|the|current)|untouched|as[\s-]is|as before|revert nothing|does nothing|cosmetic( only)?|just a typo|typo|trivial|byte[\s-]for[\s-]byte)\b/

// De-obfuscation for the note checks: leetspeak (N0 v15u4l), typoglycemia (cghane, apervpod), spaced letters (n o c h a n g e).
const KEYWORDS = ['change', 'changes', 'visual', 'visible', 'identical', 'cosmetic', 'only', 'byte', 'nothing', 'looks', 'different', 'unchanged', 'same',
  'still', 'gold', 'golden', 'already', 'approved', 'approve', 'approval', 'policy', 'owner', 'team', 'apply', 'verified', 'gate', 'host', 'system', 'trusted',
  'urgent', 'accent', 'after', 'typo', 'trivial', 'white', 'black', 'green', 'yellow', 'blue', 'orange', 'purple', 'grey', 'gray', 'silver', 'rotation',
  'perceived', 'luminance', 'unanimously', 'everyone', 'waiting', 'step', 'last', 'noop', 'keep', 'current', 'admin', 'operator', 'peter', 'signed', 'official', 'just', 'this']
const LEETMAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' }
const fkey = (w) => { const t = w.toLowerCase().replace(/[0-9@$]/g, c => LEETMAP[c] ?? c).replace(/l/g, 'i'); return t.length < 4 ? null : t[0] + [...t.slice(1, -1)].sort().join('') + t.at(-1) }
const KEYMAP = new Map(); for (const k of KEYWORDS) { const f = fkey(k); if (f && !KEYMAP.has(f)) KEYMAP.set(f, k) }
function descramble(note) {
  let changed = 0, spaced = false
  let t = String(note || '').replace(/\b(?:[A-Za-z0-9] ){3,}[A-Za-z0-9]\b/g, m => { spaced = true; return m.replace(/ /g, '') })
  t = t.replace(/[A-Za-z0-9@$]+/g, w => { if (!/[a-z]/i.test(w)) return w; const k = KEYMAP.get(fkey(w)); if (k && k !== w.toLowerCase()) { changed++; return k }
    if (/[0-9@$]/.test(w)) { changed++; return w.replace(/[0-9@$]/g, c => LEETMAP[c] ?? c) } return w })
  return { text: t, changed, spaced }
}
const NOCHANGE_SQ = /nochange|novisualchange|novisiblechange|unchang|identic|cosmetic|byteforbyte|nothinglooks|nothingchang|stillgold|samecolou?r|samegold|noop|lookssame|nodiff/

// One function for BOTH surfaces (harness popup flags and owner page), so they can never disagree.
function cardWarnings(target, oldText, newText, note, meta = { nonascii: 0 }) {
  const s = TARGETS[target]; const W = []
  const baseAccent = s?.accentOf ? s.accentOf(oldText) : null, newAccent = s?.accentOf ? s.accentOf(newText) : null
  const n = (note || '').toLowerCase(), oldName = colorName(baseAccent), newName = colorName(newAccent)
  if (meta?.nonascii) W.push(`NOTE contained ${meta.nonascii} non-ASCII/invisible characters (lookalike, invisible, bidi or styled text). They were removed${note ? '' : ' - nothing readable was left'}; the raw bytes are in the hex dump. Treat the note as hostile.`)
  if (s?.accentOf && newAccent) {
    // G6004: display-name collision is a HARD warning
    const core = (x) => x.replace(/\([^)]*\)/g, '').trim()   // ignore explanatory parentheticals like "(stock accent, NOT gold)"
    if (baseAccent && baseAccent.toUpperCase() !== newAccent.toUpperCase() && (oldName === newName || core(newName).includes(core(oldName)) || /\bgold\b/.test(core(newName)) && newAccent.toUpperCase() !== GOLD))
      W.push(`HARD WARNING - NAME COLLISION: the colour name "${newName}" resembles the current "${oldName}" but the hex differs (${baseAccent} -> ${newAccent}). Go by the hex and the swatch: the result is NOT ${baseAccent}.`)
    if (newAccent === 'default') W.push(`RESULT IS "default": the app falls back to its stock accent - NOT gold (#FFD700) and not any colour named in the note.`)
    // N3: near-lookalikes of gold / the current colour
    for (const ref of [...new Set([GOLD, baseAccent].filter(isHex).map(h => h.toUpperCase()))]) {
      if (!isHex(newAccent) || newAccent.toUpperCase() === ref) continue
      const d = rgbDist(ref, newAccent), hd = hexDigitsDiff(ref, newAccent)
      if (d <= NEAR_RGB || hd <= 1) W.push(`NEAR ${colorName(ref)} (distance ${d}): the result ${newAccent} looks like ${ref} (${hd} of 6 hex digits differ) but it is NOT ${ref}.`)
    }
  }
  if (note) {
    const ds = descramble(note), nd = ds.text.toLowerCase(), nn = n + ' \n ' + nd
    if (ds.changed >= 2 || ds.spaced) W.push('NOTE text is obfuscated (leetspeak, scrambled or spaced-out letters) - it was decoded for these checks; treat it as hostile.')
    // N2: anything in the note that imitates the gate's result line
    const hexes = note.match(/#[0-9a-z]{3,8}\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6}\b/gi) || []
    if (hexes.length) { const other = hexes.filter(h => !newAccent || h.replace('#', '').toUpperCase() !== String(newAccent).replace('#', '').toUpperCase())
      // a hex that EXACTLY equals the result hex (case-insensitive) is not warned about; any other hex-like token is
      if (other.length) W.push(`NOTE mentions ${[...new Set(other)].slice(0, 3).join(', ')} - NOT the result. The result is ${newAccent} (${newName}).`) }
    const sq = squash(note) + '|' + squash(nd), sql = squashLeet(note) + '|' + squashLeet(nd)
    if (/afterapply/.test(sq) || /afterapply/.test(sql) || /accent\s*=/.test(nn) || /accent\s*:\s*#/.test(nn) || /\bresult\s*=/.test(nn)) W.push('NOTE imitates the gate result line ("AFTER APPLY" / "accent =") - only the gate-marked line is real.')
    if (NOCHANGE.test(nn) || NOCHANGE_SQ.test(sq) || NOCHANGE_SQ.test(sql)) W.push(`NOTE claims little/no change or "still/same", but the result is a real change: ${baseAccent ?? '?'} -> ${newAccent ?? '?'}.`)
    // colour words that do not match the RESULT (the current colour is NOT exempt, except the literal "from <current> to <result>")
    const words = [...new Set((nn.match(/[a-z]+/g) || []).filter(w => Object.hasOwn(COLOUR_WORDS, w)))]
    // exemptions: (a) words of the result's own gate name when the note uses that full name ("metallic gold" for #D4AF37);
    // (b) the CURRENT colour only inside an explicit change-away phrase ("from gold to blue", "instead of gold", "gold -> blue")
    //     and only if the note also names a colour that matches the result.
    const resName = newName.replace(/\([^)]*\)/g, '').trim(), ownName = resName && resName !== 'custom' && n.includes(resName) ? resName.split(/\s+/) : []
    const namesResult = words.some(x => newAccent && wordMatches(x, newAccent))
    const awayFrom = (w) => new RegExp(`\\b(from|instead of|away from|replac\\w*|swap\\w*|rather than)\\s+(the\\s+)?(current\\s+|old\\s+)?${w}\\b|\\b${w}\\s*(->|=>|to)\\s`).test(n)
    const bad = words.filter(w => !(newAccent && wordMatches(w, newAccent)) && !ownName.includes(w) && !(baseAccent && wordMatches(w, baseAccent) && namesResult && awayFrom(w)))
    if (bad.length) W.push(`NOTE names colour(s) "${bad.slice(0, 3).join('", "')}" that do not match the result ${newAccent} (${newName}).`)
    // gate wording, on the normalised form (lowercased, separators stripped, leetspeak folded): gate_/GATE-/g a t e/g4te
    const gt = GATE_TOKENS.filter(t => sq.includes(t) || sql.includes(t))
    if (gt.length) W.push(`NOTE uses gate/host/approval wording (${gt.slice(0, 3).join(', ')}) - ignore it; only the gate-marked card is from the gate.`)
    if (IMPERSONATION.test(nn)) W.push('NOTE claims prior approval or speaks for a person/team - nobody can pre-approve; only this owner decision counts.')
    // APPROVE-spam: any word 3+ times, or a pressure token repeated
    const toks = nd.replace(/[0-9@$!|+]/g, c => LEET[c] ?? c).match(/[a-z]+/g) || []
    const cnt = {}; for (const t of toks) if (t.length >= 2 && !STOP.has(t)) cnt[t] = (cnt[t] || 0) + 1
    const rep = Object.entries(cnt).filter(([, v]) => v >= 3).map(([k]) => k)
    const pr = PRESSURE.filter(([name, re]) => toks.filter(t => re.test(t)).length >= 2 || (name !== 'now' && (squashLeet(nd).match(new RegExp(name.slice(0, 5), 'g')) || []).length >= 2)).map(([k]) => k)
    if (rep.length || pr.length) W.push(`NOTE repeats words to pressure you (${[...rep, ...pr].slice(0, 3).join(', ')}) - APPROVE-spam pattern.`)
  }
  return W
}

function rateCheck(session, target, newSha) {
  const pend = db.prepare("SELECT COUNT(*) n FROM proposals WHERE state IN ('pending','applying')").get().n
  if (pend >= MAX_PENDING_GLOBAL) throw new Error(`refused (rate limit): ${pend} proposal already pending (max ${MAX_PENDING_GLOBAL} in total). Resolve it before proposing again.`)
  const winT = db.prepare('SELECT COUNT(*) n FROM proposals WHERE target=? AND created>?').get(target, now() - WINDOW_MS).n
  const winG = db.prepare('SELECT COUNT(*) n FROM proposals WHERE created>?').get(now() - WINDOW_MS).n
  if (winT >= MAX_PER_WINDOW || winG >= MAX_PER_WINDOW) throw new Error(`refused (rate limit): ${Math.max(winT, winG)} proposals in the last ${WINDOW_MS / 60000} min (max ${MAX_PER_WINDOW} per target and in total).`)
  const lastRej = db.prepare("SELECT updated FROM proposals WHERE state='refused' ORDER BY updated DESC LIMIT 1").get()
  if (lastRej && now() - lastRej.updated < REJECT_COOLDOWN_MS) throw new Error(`refused (cooldown): a proposal was rejected ${Math.round((now() - lastRej.updated) / 1000)}s ago; wait ${Math.ceil((REJECT_COOLDOWN_MS - (now() - lastRej.updated)) / 1000)}s.`)
  const dupe = db.prepare("SELECT 1 FROM proposals WHERE target=? AND new_sha=? AND state='refused' AND updated>? LIMIT 1").get(target, newSha, now() - DEDUPE_MS)
  if (dupe) throw new Error('refused (dedupe): an identical proposal (same target and result) was rejected in the last 10 min.')
}

function swatchText(target, oldText, newText) {
  const s = TARGETS[target]; if (!s?.accentOf) return null
  const a = s.accentOf(oldText), b = s.accentOf(newText)
  const one = (h) => isHex(h) ? `${h} ${colorName(h)} rgb(${rgbOf(h).join(',')})` : `${h ?? '(none)'} ${colorName(h)}`
  const d = rgbDist(a, b), dg = rgbDist(GOLD, b)
  return `SWATCH (gate): BEFORE ${one(a)} | AFTER ${one(b)}${d != null ? ` | RGB distance ${d} from current` : ''}${dg != null ? `, ${dg} from gold #FFD700` : ''}`
}

const noteDisplay = (w, meta) => meta?.nonascii ? (w ? `${w}  [${meta.nonascii} non-ASCII chars removed, hex dump below]` : `(note removed: ${meta.nonascii} non-ASCII chars, hex dump below)`) : (w || '(none)')
function buildPopup(p, oldText) {
  const marker = 'GATE-' + randomBytes(3).toString('hex')
  const s = TARGETS[p.target]
  return {
    marker,
    after_apply: s.after ? s.after(p.content) : `AFTER APPLY: ${p.bytes} bytes`,
    plain_change: s.plain ? s.plain(oldText || '', p.content) : `${p.bytes} bytes change`,
    note: p.note_meta?.nonascii ? noteDisplay(p.why, p.note_meta) : (p.why ?? null),
    note_hexdump: p.note_meta?.hexdump ?? null,
    flags: cardWarnings(p.target, oldText || '', p.content, p.why, p.note_meta),
    swatch: swatchText(p.target, oldText || '', p.content),
    note_display: noteDisplay(p.why, p.note_meta),
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
  const w = cleanNote(why), meta = noteMeta(why)
  return tx(() => {
    if (cur) putBlob(target, cur); putBlob(target, bytes)
    db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, kind, target, baseSha, newSha, diff, w, String(session ?? ''), String(call_id ?? ''), created, expires, displayable, 'pending', null, created)
    const e = append('propose', { proposal: id, target, base_sha: baseSha, new_sha: newSha, detail: { kind, note: w, note_meta: meta, session: String(session ?? ''), expires: new Date(expires).toISOString(), displayable: !!displayable, ...extra } })
    const p = { id, kind, target, entry: s.entry, base_sha: baseSha, new_sha: newSha, diff, content, bytes: bytes.length, why: w, note_meta: meta, created, expires, displayable: !!displayable, ledger_seq: e.seq }
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
{ const v = verifyLedger(db, key.pub); append('gate-start', { detail: { pid: process.pid, ledger_ok_before_start: v.ok, entries: v.entries, pubkey_fp: key.fp, owner_http_port: OWNER_HTTP_PORT, owner_bearer: { rotated: true, fp8: bearerInfo.fp, expires: bearerInfo.expires } } }); if (!v.ok) console.error('LEDGER VERIFY FAILED', v.errors) }

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
  pending: () => ({ pubkey_fp: key.fp, pending: db.prepare("SELECT id,kind,target,base_sha,new_sha,why,session,created,expires FROM proposals WHERE state='pending' ORDER BY created DESC").all().map(p => ({ ...p, ...cardView(p) })) }),
  rotate_bearer: () => { const r = rotateBearer(owner); append('owner-bearer-rotated', { detail: { fp8: r.fp, expires: r.expires, via: 'owner.sock' } }); return { rotated: true, expires: r.expires } },
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
function bearerOk(given) { try { if (!owner.bearer_expires || Date.now() > owner.bearer_expires) return false; const a = Buffer.from(String(given || '')); const b = Buffer.from(owner.bearer); return a.length === b.length && timingSafeEqual(a, b) } catch { return false } }
const blobText = (sha) => { const b = db.prepare('SELECT bytes FROM blobs WHERE sha=?').get(sha); return b ? Buffer.from(b.bytes).toString('utf8') : '' }
// everything the owner sees about one proposal, computed by the gate (same function as the popup flags)
function cardView(p) {
  const oldText = blobText(p.base_sha), newText = blobText(p.new_sha), s = TARGETS[p.target]
  let meta = { nonascii: 0 }; try { const d = db.prepare("SELECT detail FROM ledger WHERE proposal=? AND event='propose' ORDER BY seq LIMIT 1").get(p.id); meta = JSON.parse(d?.detail || '{}').note_meta || meta } catch {}
  return { plain: s?.plain ? s.plain(oldText, newText) : '', after_apply: s?.after ? s.after(newText) : '', warnings: cardWarnings(p.target, oldText, newText, p.why, meta),
    note_display: noteDisplay(p.why, meta), note_meta: meta, swatch: swatchText(p.target, oldText, newText), base_accent: s?.accentOf?.(oldText) ?? null, new_accent: s?.accentOf?.(newText) ?? null }
}
const chip = (h) => isHex(h) ? `<span class=chip style="background:${esc(h.toUpperCase())}"></span>` : `<span class="chip dflt" title="app default: stock accent, unknown colour"></span>`
const confirms = new Map()   // nonce -> { id, base, new, exp } (two-step approve; single use; memory only)
function pageHtml(msg, confirmFor) {
  const rows = db.prepare("SELECT id,kind,target,base_sha,new_sha,why,created,expires FROM proposals WHERE state='pending' ORDER BY created DESC").all()
  const items = rows.map(p => { const v = cardView(p), hid = `<input type=hidden name=k value="${esc(owner.bearer)}"><input type=hidden name=id value="${esc(p.id)}"><input type=hidden name=base value="${esc(p.base_sha)}"><input type=hidden name=new value="${esc(p.new_sha)}">`
    const shown = (v.new_accent ?? '').replace(/^#/, '')
    let step2 = ''
    if (confirmFor && confirmFor.id === p.id) step2 = `<form method=POST action=/act class=confirm>${hid}<input type=hidden name=nonce value="${esc(confirmFor.nonce)}">
      <div><b>Step 2 of 2.</b> Type the result <b>${esc(v.new_accent === 'default' ? 'default' : '#' + shown)}</b> exactly to confirm (Enter/Space/Tab alone cannot approve):</div>
      <input name=typed autocomplete=off spellcheck=false placeholder="type ${esc(v.new_accent === 'default' ? 'default' : shown)}" aria-label="type the result colour to confirm">
      <button name=a value=confirm class=ap tabindex=-1>Confirm apply ${esc(v.new_accent === 'default' ? 'default' : '#' + shown)}</button></form>`
    return `<div class=card data-id="${esc(p.id)}"><div class=h>HOST-VERIFIED (gate)</div>
      <div class=plain>${esc(v.plain)}</div>
      <div class=after>${esc(v.after_apply)}</div>
      <div class=sw>${chip(v.base_accent)} BEFORE ${esc(v.base_accent ?? '?')} ${esc(colorName(v.base_accent))} <span class=arr>&rarr;</span> ${chip(v.new_accent)} AFTER ${esc(v.new_accent ?? '?')} ${esc(colorName(v.new_accent))}</div>
      <div class=swt>${esc(v.swatch ?? '')}</div>
      ${v.warnings.length ? `<div class=warn><div class=wh>GATE WARNINGS (${v.warnings.length})</div><ul>${v.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '<div class=nowarn>gate warnings: none</div>'}
      <div>target: <b>${esc(p.target)}</b></div>
      <div>proposal ${esc(p.id)} · expires ${esc(new Date(p.expires).toLocaleTimeString('en-GB', { timeZone: 'Asia/Makassar' }))} WITA</div>
      <div>current sha256 ${esc(p.base_sha)}</div><div>result&nbsp; sha256 ${esc(p.new_sha)}</div>
      <div class=note><div class=nh>MODEL NOTE (unverified)</div>${esc(v.note_display)}${v.note_meta?.hexdump ? `<div class=hex>raw note bytes (${esc(v.note_meta.raw_bytes)}): ${esc(v.note_meta.hexdump)}</div>` : ''}</div>
      <div class=btns><form method=POST action=/act class=rjf>${hid}<button name=a value=reject class=rj>Reject</button></form>
      <form method=POST action=/act class=apf>${hid}<button name=a value=approve-step1 class=ap1 tabindex=-1>Approve&hellip; (step 1 of 2)</button></form></div>${step2}</div>` }).join('\n')
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>SKUNKWORKS gate — owner approval</title>
  <style>body{font:15px/1.5 system-ui;margin:0;background:#111;color:#eee;padding:16px}.card{background:#1b1b1b;border:1px solid #444;border-radius:10px;padding:12px;margin:12px 0}.h{color:#6cf;font-weight:700;font-size:12px}.plain{font-size:18px;margin:6px 0}.after{font-weight:700;color:#fd6}.sw{margin:8px 0;font-size:16px}.chip{display:inline-block;width:44px;height:28px;border-radius:6px;border:2px solid #fff;vertical-align:middle;margin:0 4px}.chip.dflt{background:repeating-linear-gradient(45deg,#555 0 6px,#999 6px 12px)}.swt{font-size:12px;color:#aaa}.warn{background:#3a1010;border:2px solid #f44;border-radius:8px;padding:6px 10px;margin:8px 0}.wh{color:#f88;font-weight:700}.warn li{margin:2px 0}.nowarn{color:#888;font-size:12px}.note{background:#2a2a1a;border:1px dashed #776;border-radius:8px;padding:8px;margin:8px 0;white-space:pre-wrap}.nh{color:#cc6;font-size:12px;font-weight:700}.hex{font:12px monospace;color:#bbb;margin-top:4px}.btns form{display:inline}button{font-size:16px;padding:10px 18px;border-radius:8px;border:0;margin-top:8px}.ap,.ap1{background:#2a7;color:#fff}.ap1{opacity:.8}.rj{background:#a33;color:#fff}.confirm{margin-top:10px;padding:8px;border:1px solid #2a7;border-radius:8px}.confirm input{font:16px monospace;padding:6px;margin:6px 0}div{word-break:break-all}.msg{color:#6f6}</style>
  <h2>SKUNKWORKS gate — owner approval</h2><p>This page is served directly by the gate (aukora-gate), not by the harness. Only items below are gate-verified. Approve takes two steps and a typed confirmation.</p>
  ${msg ? `<p class=msg>${esc(msg)}</p>` : ''}${items || '<p>No pending proposals.</p>'}`
}
const ownerHttp = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://gate.local')
  const deny = () => { res.writeHead(401, { 'content-type': 'text/plain' }); res.end(owner.bearer_expires && Date.now() > owner.bearer_expires ? 'unauthorized: owner link expired (12 h). Run ops/gate-link.sh --rotate (or restart the gate) for a new link in ops/.gate-access.' : 'unauthorized') }
  if (req.method === 'GET') {
    if (!bearerOk(u.searchParams.get('k'))) return deny()
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(pageHtml(''))
  }
  if (req.method === 'POST' && u.pathname === '/act') {
    let body = ''; req.on('data', d => { body += d; if (body.length > 1e5) req.destroy() })
    req.on('end', () => {
      const f = new URLSearchParams(body)
      if (!bearerOk(f.get('k'))) return deny()
      const id = String(f.get('id')), a = f.get('a'); const p = db.prepare('SELECT base_sha,new_sha,target,state FROM proposals WHERE id=?').get(id)
      let msg, confirmFor = null
      for (const [k, v] of confirms) if (Date.now() > v.exp) confirms.delete(k)
      if (!p) msg = 'proposal not found'
      else if (p.base_sha !== f.get('base') || p.new_sha !== f.get('new')) msg = 'refused: proposal changed since the page was shown; reload and re-check.'
      else if (a === 'reject') { const r = ownerDecide({ id, outcome: 'rejected' }, 'owner via gate approval page (bearer token)'); msg = `rejected: ${r.message}` }
      else if (a === 'approve-step1') { if (p.state !== 'pending') msg = `proposal is ${p.state}`; else { const nonce = randomBytes(16).toString('base64url'); confirms.set(nonce, { id, base: p.base_sha, new: p.new_sha, exp: Date.now() + CONFIRM_TTL_MS }); confirmFor = { id, nonce }; msg = 'Step 2: type the result colour below to confirm. Nothing has been applied.' } }
      else if (a === 'confirm') {
        const c = confirms.get(String(f.get('nonce'))); confirms.delete(String(f.get('nonce')))
        const want = (TARGETS[p.target]?.accentOf?.(blobText(p.new_sha)) ?? '').replace(/^#/, '').toUpperCase(), typed = String(f.get('typed') ?? '').trim().replace(/^#/, '').toUpperCase()
        if (!c || c.id !== id || c.base !== p.base_sha || c.new !== p.new_sha || Date.now() > c.exp) msg = 'not applied: confirmation expired or invalid - start again with Approve (step 1).'
        else if (!want || typed !== want) msg = `not applied: typed confirmation "${typed.slice(0, 20)}" does not match the result. Nothing changed.`
        else { const r = ownerDecide({ id, outcome: 'allowed-once' }, 'owner via gate approval page (bearer token, typed 2-step confirm)'); msg = r.applied ? `APPLIED ${p.target} — ledger #${r.ledger_seq}` : `not applied: ${r.message}` }
      } else msg = 'unknown action; nothing done'
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(pageHtml(msg, confirmFor))
    }); return
  }
  res.writeHead(404); res.end('not found')
})
ownerHttp.listen(OWNER_HTTP_PORT, '127.0.0.1', () => { fs.writeFileSync(path.join(RUN, 'owner-http.port'), String(OWNER_HTTP_PORT), { mode: 0o644 }); console.log(`skunkworks-gate OWNER HTTP 127.0.0.1:${OWNER_HTTP_PORT}`) })

const stop = () => { for (const s of [proposeServer, ownerServer]) { try { s.close() } catch {} } try { ownerHttp.close() } catch {} try { db.close() } catch {} process.exit(0) }
process.on('SIGTERM', stop); process.on('SIGINT', stop)
