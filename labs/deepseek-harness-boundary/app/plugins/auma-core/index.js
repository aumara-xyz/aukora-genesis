// auma-core — SKUNKWORKS boundary plugin for DeepSeek Harness (runs as Linux user aukora-host).
// NOT editable through propose_change (not on the allowlist).
//  * Auma's hands: every model tool here executes inside the NVIDIA OpenShell sandbox "auma-ws"
//    (Linux user auma, rootless podman, network none) via the root-owned wrapper below. No host fs tool.
//  * The one boundary: propose_change / revert_last_change -> harness's existing approval popup ->
//    single-use, expiring, durable approval record -> apply exact bytes -> hot-reload one Cordis entry.
//  * $10 DeepSeek cap enforced in the llm/stream waterfall before dispatch.
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'auma-core'
export const inject = { tools: { required: true }, approval: { required: false }, webServer: { required: false }, connection: { required: false } }

const APP = '/workspace/skunkworks/app'
const STATE = path.join(APP, 'state')
const PREV = path.join(APP, 'prev')
const SBX = ['/usr/bin/sudo', ['-n', '-u', 'auma', '/usr/local/lib/skunkworks/sbx-exec']]
const OUT_CAP = 64 * 1024
const APPROVAL_TTL_MS = 5 * 60 * 1000
const POPUP_LIMIT = 12000 // chars of diff+content shown in the popup; above this the proposal cannot be approved
const CAP_USD = 10
const MAX_OUT_TOKENS = 8192
const MAX_CONCURRENT = 2
// USD per 1M tokens. Conservative: DeepSeek PEAK rates, every input token billed as cache-miss.
const PRICES = {
  'deepseek-official/deepseek-flash': { in: 0.44, out: 1.32 },
  'deepseek-official/deepseek-v4-pro': { in: 1.74, out: 3.96 },
}
// Allowlist of system targets Auma may PROPOSE to change. Everything else (this plugin, approval
// handler, spent store, sandbox wrapper/policy, key handling, launcher, harness packages) is refused.
const TARGETS = {
  'plugins/auma-theme/theme.json': { kind: 'declarative', entry: 'auma-theme', validate: validateTheme },
}
const USER_PLUGIN = /^plugins\/user\/([a-z][a-z0-9-]{1,30})\/index\.js$/

function sha256(b) { return createHash('sha256').update(b).digest('hex') }
function validateTheme(text) {
  let j; try { j = JSON.parse(text) } catch { throw new Error('theme.json must be valid JSON') }
  const keys = Object.keys(j ?? {})
  if (keys.length !== 1 || keys[0] !== 'accent') throw new Error('theme.json may contain exactly one key: "accent"')
  if (typeof j.accent !== 'string' || !/^(default|#[0-9a-fA-F]{6})$/.test(j.accent)) throw new Error('accent must be "default" or #RRGGBB')
}

// ---------- sandbox executor ----------
function sandbox(command, timeoutS = 60, signal) {
  return new Promise((resolve) => {
    const t = Math.max(1, Math.min(300, Math.floor(timeoutS)))
    const child = spawn(SBX[0], [...SBX[1], String(t), command], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } })
    let out = Buffer.alloc(0), err = Buffer.alloc(0)
    child.stdout.on('data', d => { if (out.length < OUT_CAP) out = Buffer.concat([out, d]).subarray(0, OUT_CAP) })
    child.stderr.on('data', d => { if (err.length < OUT_CAP) err = Buffer.concat([err, d]).subarray(0, OUT_CAP) })
    const kill = () => { try { child.kill('SIGKILL') } catch {} }
    signal?.addEventListener('abort', kill, { once: true })
    const timer = setTimeout(kill, (t + 15) * 1000)
    child.on('close', (code, sig) => { clearTimeout(timer); signal?.removeEventListener('abort', kill)
      resolve({ exit_code: code ?? -1, signal: sig ?? null, stdout: out.toString('utf8'), stderr: err.toString('utf8') }) })
  })
}
const q = (s) => "'" + String(s).replace(/'/g, `'\\''`) + "'"
function fmt(r) {
  return `[executor: NVIDIA OpenShell sandbox "auma-ws" as Linux user auma; exit ${r.exit_code}]\n` +
    (r.stdout ? `--- stdout ---\n${r.stdout}\n` : '') + (r.stderr ? `--- stderr ---\n${r.stderr}\n` : '')
}

export function apply(ctx) {
  fs.mkdirSync(STATE, { recursive: true, mode: 0o700 }); fs.mkdirSync(PREV, { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(path.join(STATE, 'skunkworks.db'))
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, kind TEXT, target TEXT, privileged INTEGER, base_sha TEXT,
      new_sha TEXT, diff TEXT, session TEXT, call_id TEXT, created INTEGER, expires INTEGER, state TEXT, note TEXT, updated INTEGER);
    CREATE TABLE IF NOT EXISTS spend(id TEXT PRIMARY KEY, model TEXT, est REAL, cost REAL, state TEXT, created INTEGER, updated INTEGER, note TEXT);
    CREATE TABLE IF NOT EXISTS activity(at INTEGER, session TEXT, tool TEXT, summary TEXT);`)
  ctx.effect(() => () => { try { db.close() } catch {} })
  const now = () => Date.now()
  const setState = (id, from, to, note = null) =>
    db.prepare('UPDATE approvals SET state=?, note=?, updated=? WHERE id=? AND state=?').run(to, note, now(), id, from).changes === 1
  const log = (exec, tool, summary) => { try { db.prepare('INSERT INTO activity VALUES(?,?,?,?)').run(now(), sid(exec), tool, String(summary).slice(0, 500)) } catch {} }
  const sid = (exec) => String(exec?.agent?.session?.id ?? exec?.agent?.id ?? 'none')

  // ---- crash reconciliation: never silently replay ----
  for (const r of db.prepare("SELECT * FROM approvals WHERE state IN ('pending','applying')").all()) {
    if (r.state === 'pending') { setState(r.id, 'pending', 'expired', 'harness restarted before decision'); continue }
    let cur = null; try { cur = sha256(fs.readFileSync(path.join(APP, r.target))) } catch {}
    if (cur === r.new_sha) setState(r.id, 'applying', 'applied', 'reconciled after crash: file already had approved bytes (plugin reloaded on start)')
    else if (cur === r.base_sha) setState(r.id, 'applying', 'failed', 'reconciled after crash: bytes not written; NOT re-applied (spent)')
    else setState(r.id, 'applying', 'conflict', `reconciled after crash: file hash ${cur} matches neither base nor approved`)
  }
  db.prepare("UPDATE spend SET state='uncertain', cost=est, note='harness restarted mid-request; charged at reservation', updated=? WHERE state='reserved'").run(now())

  // ---------- tools inside the boundary (no approval; recorded) ----------
  const text = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }
  ctx.tools.register(defineTool({
    name: 'sandbox_shell',
    description: 'Run a bash command inside your NVIDIA OpenShell sandbox (Linux user auma, no network). Working dir /sandbox is your persistent workspace. Use this for running code and scripts. You cannot reach the host system from here.',
    parameters: { command: { type: 'string', required: true, description: 'bash command' }, timeout_s: { type: 'number', description: 'seconds (max 300, default 60)' } },
    output: text,
    async execute(args, exec) { log(exec, 'sandbox_shell', args.command); return fmt(await sandbox(args.command, args.timeout_s ?? 60, exec.signal)) },
  }))
  ctx.tools.register(defineTool({
    name: 'write_file',
    description: 'Create or overwrite a file inside your sandbox workspace (relative paths are under /sandbox). Executes inside the OpenShell sandbox.',
    parameters: { path: { type: 'string', required: true }, content: { type: 'string', required: true } },
    output: text,
    async execute(args, exec) {
      log(exec, 'write_file', args.path)
      const b64 = Buffer.from(args.content, 'utf8').toString('base64')
      const r = await sandbox(`p=${q(args.path)}; mkdir -p -- "$(dirname -- "$p")" && printf %s ${q(b64)} | base64 -d > "$p" && echo "wrote $(wc -c < "$p") bytes to $(realpath -- "$p")"`, 30, exec.signal)
      if (r.exit_code !== 0) throw new Error(fmt(r))
      return fmt(r)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file. Executes inside your OpenShell sandbox, so only files visible to the sandbox can be read.',
    parameters: { path: { type: 'string', required: true } },
    output: text,
    async execute(args, exec) {
      log(exec, 'read_file', args.path)
      const r = await sandbox(`cat -- ${q(args.path)}`, 30, exec.signal)
      if (r.exit_code !== 0) throw new Error(`refused: ${fmt(r)}`)
      return fmt(r)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'memory_note',
    description: 'Append a short note to your memory file (/sandbox/.memory/notes.md) inside the sandbox.',
    parameters: { note: { type: 'string', required: true } },
    output: text,
    async execute(args, exec) {
      log(exec, 'memory_note', args.note)
      const b64 = Buffer.from(`- ${new Date().toISOString()} ${args.note}\n`, 'utf8').toString('base64')
      return fmt(await sandbox(`mkdir -p .memory && printf %s ${q(b64)} | base64 -d >> .memory/notes.md && tail -n 5 .memory/notes.md`, 30, exec.signal))
    },
  }))

  // ---------- THE BOUNDARY ----------
  function resolveTarget(target) {
    if (typeof target !== 'string' || target.includes('\0') || path.isAbsolute(target) || target.split('/').includes('..')) throw new Error('target refused: must be a relative allowlisted path without ".."')
    const t = path.posix.normalize(target)
    let spec = TARGETS[t], userName = null
    if (!spec) { const m = USER_PLUGIN.exec(t); if (m) { userName = m[1]; spec = { kind: 'privileged-plugin', entry: `user-${m[1]}` } } }
    if (!spec) throw new Error(`target refused: "${t}" is not on the editable allowlist (${Object.keys(TARGETS).join(', ')}, plugins/user/<name>/index.js). The approval handler, spent store, sandbox policy, key handling, launcher and harness code are not editable.`)
    const abs = path.join(APP, t)
    // symlink / escape checks on every existing path component
    let p = APP
    for (const part of t.split('/')) {
      p = path.join(p, part)
      try { if (fs.lstatSync(p).isSymbolicLink()) throw new Error(`target refused: symlink in path (${p})`) } catch (e) { if (e.code !== 'ENOENT') throw e }
    }
    const realDir = (() => { try { return fs.realpathSync(path.dirname(abs)) } catch { return path.dirname(abs) } })()
    if (!(realDir + '/').startsWith(APP + '/plugins/')) throw new Error('target refused: escapes plugins directory')
    return { t, abs, spec, userName }
  }
  const readOr = (abs) => { try { return fs.readFileSync(abs) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
  const prevKey = (t) => path.join(PREV, t.replace(/\//g, '__'))

  // Locate a sibling Cordis loader entry (auma-theme etc. are inserted next to auma-core).
  function findEntry(id) {
    const tree = ctx.fiber?.entry?.parent?.tree
    try { if (tree) return tree.resolve(id) } catch {}
    const loader = ctx.get('loader') ?? ctx.loader
    try { return loader.resolve(id) } catch {}
    for (const e of loader.entries?.() ?? []) if (e.options?.id === id || e.id === id) return e
    return undefined
  }
  async function restartEntry(id, extra = {}) {
    const e = findEntry(id); if (!e) throw new Error(`cannot find Cordis entry ${id}`)
    await e.update({ disabled: true })
    await new Promise(r => setTimeout(r, 300))
    await e.update({ ...extra, disabled: null })
  }
  async function reloadEntry(spec, t, newBytes) {
    if (spec.kind === 'declarative') {
      // stop old fiber, then load new fiber of this ONE entry (client follows via harness HMR)
      await restartEntry(spec.entry)
      return `Cordis entry "${spec.entry}": old fiber disposed, new fiber loaded (no harness restart)`
    }
    // privileged JS plugin: load a content-addressed copy so the new code is really imported
    const versioned = path.join(APP, path.dirname(t), `index.${sha256(newBytes).slice(0, 12)}.js`)
    fs.writeFileSync(versioned, newBytes, { mode: 0o600 })
    if (findEntry(spec.entry)) await restartEntry(spec.entry, { name: versioned })
    else { const tree = ctx.fiber?.entry?.parent?.tree; if (!tree) throw new Error('no loader tree for new plugin'); await tree.create({ id: spec.entry, name: versioned }) }
    return `Cordis entry "${spec.entry}": old fiber disposed, new module ${path.basename(versioned)} loaded as aukora-host`
  }

  async function boundary(exec, { t, abs, spec }, newBytes, kind, summary, claimedBase) {
    const old = readOr(abs)
    const baseSha = old ? sha256(old) : 'absent'
    if (claimedBase && claimedBase !== baseSha) throw new Error(`refused: changed base (you said ${claimedBase}, current is ${baseSha})`)
    if (spec.validate) spec.validate(newBytes.toString('utf8'))
    const newSha = sha256(newBytes)
    if (newSha === baseSha) throw new Error('refused: proposed content is identical to current content')
    const diff = createTwoFilesPatch(`a/${t}`, `b/${t}`, old ? old.toString('utf8') : '', newBytes.toString('utf8'), '', '')
    const id = randomUUID(), created = now(), expires = created + APPROVAL_TTL_MS
    const privileged = spec.kind === 'privileged-plugin'
    db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, kind, t, privileged ? 1 : 0, baseSha, newSha, diff, sid(exec), String(exec.callId ?? ''), created, expires, 'pending', summary ?? null, created)
    // Popup text. Order matters: the harness popup body is a scroll region, so the change itself
    // (diff, then full resulting bytes) comes right after a compact header, and an END marker closes it.
    const vis = (txt) => txt.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
    const diffBody = vis(diff.split('\n').filter(l => !l.startsWith('====')).join('\n').trimEnd())
    const newText = newBytes.toString('utf8')
    const contentBlock = vis(newText).split('\n').map(l => '│ ' + l).join('\n')
    const tooBig = diffBody.length + contentBlock.length > POPUP_LIMIT
    const reason = [
      privileged ? '⚠ PRIVILEGED INSTALL — arbitrary JavaScript will run inside the harness as Linux user aukora-host (NOT sandboxed).' : `Auma proposes a SYSTEM CHANGE (${kind}; declarative theme setting).`,
      `target: ${t}   proposal ${id.slice(0, 8)} · single-use · expires ${new Date(expires).toLocaleTimeString('en-GB', { timeZone: 'Asia/Makassar' })} WITA`,
      `base sha256:   ${baseSha}`,
      `result sha256: ${newSha}`,
      summary ? `why: ${summary}` : null,
      ...(tooBig ? [
        `TRUNCATED — APPROVAL DISABLED: diff + content are ${diffBody.length + contentBlock.length} chars (> ${POPUP_LIMIT}). Nothing will be applied whatever you click.`,
        diffBody.slice(0, 1500), '… [truncated]',
      ] : [
        '──── exact unified diff (- current, + proposed) ────', diffBody,
        `──── full resulting content: ${newBytes.length} bytes, ${newText.split('\n').length - (newText.endsWith('\n') ? 1 : 0)} lines, ends with newline: ${newText.endsWith('\n') ? 'yes' : 'NO'} ────`, contentBlock,
      ]),
      '──── END OF PROPOSAL ────',
      tooBig ? 'Allow once is IGNORED for this proposal (fail closed).' : `Allow once = aukora-host writes exactly these ${newBytes.length} bytes and hot-reloads only Cordis entry "${spec.entry}". Reject / no answer = nothing changes.`,
      'This approves a code/config change only, not any data disclosure.',
    ].filter(Boolean).join('\n')
    const approval = ctx.get('approval')
    if (!approval || !exec.agent) { setState(id, 'pending', 'refused', 'no approval channel'); throw new Error('refused: no approval channel (fail closed)') }
    const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(APPROVAL_TTL_MS)])
    let outcome
    try { outcome = await approval.request({ agent: exec.agent, toolName: exec.name, callId: exec.callId, reason, signal }) }
    catch (e) { setState(id, 'pending', 'refused', 'approval error: ' + e.message); throw e }
    const at = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Makassar' }) + ' WITA'
    if (outcome === 'allowed-once' && tooBig) { setState(id, 'pending', 'refused', 'too large for popup'); return `NOT APPLIED: proposal too large to show in full in the popup (approval disabled). Nothing changed.` }
    if (outcome !== 'allowed-once') {
      const st = outcome === 'rejected' ? 'refused' : 'expired'
      setState(id, 'pending', st, outcome)
      log(exec, exec.name, `${t} ${st}`)
      return `NOT APPLIED: ${outcome === 'rejected' ? 'owner REJECTED it in the approval popup' : 'no owner answer (' + outcome + ')'} at ${at}. Nothing changed. (proposal ${id} is now ${st} and can never be used.)`
    }
    if (now() > expires) { setState(id, 'pending', 'expired', 'approved after expiry'); return 'NOT APPLIED: approval arrived after expiry. Nothing changed.' }
    // single-use: atomically spend BEFORE touching anything (durable, fsync via synchronous=FULL)
    if (!setState(id, 'pending', 'applying')) throw new Error('refused: approval already spent (replay)')
    try {
      const cur = readOr(abs); const curSha = cur ? sha256(cur) : 'absent'
      if (curSha !== baseSha) { setState(id, 'applying', 'failed', `base changed to ${curSha}`); throw new Error(`refused at apply: base changed (${curSha} != ${baseSha})`) }
      if (old) { fs.writeFileSync(prevKey(t), old, { mode: 0o600 }); fs.writeFileSync(prevKey(t) + '.meta', JSON.stringify({ sha: baseSha, savedFrom: id, at: new Date().toISOString() })) }
      else { try { fs.rmSync(prevKey(t)) } catch {} ; fs.writeFileSync(prevKey(t) + '.meta', JSON.stringify({ sha: 'absent', savedFrom: id })) }
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      const tmp = abs + '.approved-' + id
      const fd = fs.openSync(tmp, 'wx', 0o644); fs.writeSync(fd, newBytes); fs.fsyncSync(fd); fs.closeSync(fd)
      fs.renameSync(tmp, abs)
      if (sha256(fs.readFileSync(abs)) !== newSha) throw new Error('post-write hash mismatch')
      const reloaded = await reloadEntry(spec, t, newBytes)
      setState(id, 'applying', 'applied', reloaded)
      log(exec, exec.name, `${t} applied ${newSha}`)
      return `Owner APPROVED this exact change in the harness approval popup at ${at}. APPLIED (proposal ${id}, spent). ${t} now sha256 ${newSha}. ${reloaded}. Previous version kept for Revert (base ${baseSha}).`
    } catch (e) {
      let cur = null; try { cur = sha256(fs.readFileSync(abs)) } catch {}
      if (cur === newSha) setState(id, 'applying', 'applied', 'approved bytes written; hot-reload FAILED: ' + e.message + ' (takes effect on next harness start)')
      else setState(id, 'applying', 'failed', String(e.message))
      throw e
    }
  }

  ctx.tools.register(defineTool({
    name: 'propose_change',
    description: 'The ONLY way to change the system you run in (harness UI theme, plugins, config). Proposes exact new file content for one allowlisted target; the owner sees the exact diff and sha256 in an approval popup and must approve. Allowlisted targets: "plugins/auma-theme/theme.json" (UI theme: JSON {"accent": "#RRGGBB" or "default"}; e.g. gold = "#D4AF37"), and "plugins/user/<name>/index.js" (privileged Cordis plugin install). Everything else is refused.',
    parameters: {
      target: { type: 'string', required: true, description: 'allowlisted relative path' },
      new_content: { type: 'string', required: true, description: 'complete new file content (exact bytes)' },
      base_sha256: { type: 'string', description: 'sha256 of the current content you expect (optional; changed base is refused)' },
      summary: { type: 'string', description: 'one-line reason shown to the owner' },
    },
    output: text,
    async execute(args, exec) {
      const r = resolveTarget(args.target)
      return boundary(exec, r, Buffer.from(args.new_content, 'utf8'), r.spec.kind === 'privileged-plugin' ? 'plugin add/replace' : 'config change', args.summary, args.base_sha256)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'revert_last_change',
    description: 'Propose reverting an allowlisted target to the one previous version kept on approval. Shown in the same approval popup; owner must approve.',
    parameters: { target: { type: 'string', required: true } },
    output: text,
    async execute(args, exec) {
      const r = resolveTarget(args.target)
      let meta; try { meta = JSON.parse(fs.readFileSync(prevKey(r.t) + '.meta', 'utf8')) } catch { throw new Error('nothing to revert: no previous version kept for ' + r.t) }
      if (meta.sha === 'absent') throw new Error('previous version was "file absent"; reverting a fresh plugin install = remove it (not supported via popup)')
      const prev = fs.readFileSync(prevKey(r.t))
      return boundary(exec, r, prev, 'revert', `revert ${r.t} to previous version sha256 ${meta.sha}`)
    },
  }))

  // ---------- $10 DeepSeek cap, enforced before dispatch ----------
  const spent = () => db.prepare("SELECT COALESCE(SUM(CASE WHEN state IN ('settled','uncertain') THEN cost WHEN state='reserved' THEN est ELSE 0 END),0) AS s FROM spend").get().s
  ctx.on('llm/stream', function (options, next) {
    return (async function* () {
      const key = `${options.provider}/${options.model}`
      // Loopback scripted driver (owner acceptance checks only): priced at $0 ONLY while the owner-created
      // flag file exists AND the provider is configured in the profile patch. Both are aukora-host files.
      const price = PRICES[key] ?? (key === 'skunk-script/scripted' && fs.existsSync(path.join(STATE, 'SCRIPT_DRIVER_ENABLED')) ? { in: 0, out: 0 } : undefined)
      if (!price) throw new Error(`spend cap: refused — no known pricing for "${key}" (only ${Object.keys(PRICES).join(', ')})`)
      const maxOut = Math.min(options.maxTokens ?? MAX_OUT_TOKENS, MAX_OUT_TOKENS)
      const inTok = Math.ceil(Buffer.byteLength(JSON.stringify([options.system ?? '', options.messages ?? [], options.tools ?? []])) / 2)
      const est = (inTok * price.in + maxOut * price.out) / 1e6
      const id = randomUUID()
      db.exec('BEGIN IMMEDIATE')
      try {
        const active = db.prepare("SELECT COUNT(*) AS n FROM spend WHERE state='reserved'").get().n
        if (active >= MAX_CONCURRENT) throw new Error(`spend cap: refused — ${active} requests already in flight (max ${MAX_CONCURRENT})`)
        const s = spent()
        if (s + est > CAP_USD) throw new Error(`spend cap: refused — $${s.toFixed(4)} spent/reserved + worst-case $${est.toFixed(4)} would exceed the hard $${CAP_USD} cap`)
        db.prepare('INSERT INTO spend VALUES(?,?,?,?,?,?,?,?)').run(id, key, est, null, 'reserved', now(), now(), `in≈${inTok} out≤${maxOut}`)
        db.exec('COMMIT')
      } catch (e) { db.exec('ROLLBACK'); throw e }
      let usage, outChars = 0, ok = false, err, finishErr
      try {
        for await (const chunk of next()) {
          if (chunk?.type === 'usage') usage = chunk.usage
          if (chunk?.type === 'finish' && /error|abort/.test(JSON.stringify(chunk.reason))) finishErr = JSON.stringify(chunk)
          const d = chunk?.text ?? chunk?.argumentsDelta
          if (typeof d === 'string') { outChars += d.length; if (outChars > maxOut * 8) throw new Error('spend cap: output bound exceeded; stream stopped') }
          yield chunk
        }
        ok = true
      } catch (e) { err = e; throw e }
      finally {
        if (usage) {
          const cost = ((usage.inputTokens ?? 0) * price.in + ((usage.outputTokens ?? 0)) * price.out) / 1e6
          db.prepare("UPDATE spend SET state='settled', cost=?, updated=?, note=? WHERE id=?").run(cost, now(), JSON.stringify(usage), id)
        } else if ((err && (err.code === 'MISSING_CREDENTIAL' || /no API key/.test(String(err.message)))) || /MISSING_CREDENTIAL/.test(finishErr ?? '')) {
          db.prepare("UPDATE spend SET state='released', cost=0, updated=?, note='no key: request never sent' WHERE id=?").run(now(), id)
        } else {
          db.prepare("UPDATE spend SET state='uncertain', cost=est, updated=?, note=? WHERE id=?").run(now(), ok ? ('no usage reported; charged at reservation ' + (finishErr ?? '')).slice(0, 400) : 'error/abort: ' + String(err?.message ?? 'cancelled').slice(0, 200), id)
        }
      }
    })()
  })

  // ---------- owner status (cookie-authenticated) ----------
  const web = ctx.get('webServer'), conn = ctx.get('connection')
  if (web && conn) ctx.effect(() => web.register({
    kind: 'exact', path: '/auma/status',
    handler: (req, res) => {
      const rej = conn.requestRejection(req); if (rej !== undefined) { res.statusCode = rej; res.end(); return }
      res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify({
        spend: { capUsd: CAP_USD, countedUsd: spent(), rows: db.prepare('SELECT id,model,est,cost,state,note,created FROM spend ORDER BY created DESC LIMIT 20').all() },
        approvals: db.prepare('SELECT id,kind,target,privileged,base_sha,new_sha,state,note,created,expires FROM approvals ORDER BY created DESC LIMIT 20').all(),
        activity: db.prepare('SELECT * FROM activity ORDER BY at DESC LIMIT 30').all(),
      }, null, 1))
    },
  }), 'auma-core: GET /auma/status')
}
