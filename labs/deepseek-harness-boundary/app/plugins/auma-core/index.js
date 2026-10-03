// auma-core — SKUNKWORKS boundary plugin for DeepSeek Harness (runs as Linux user aukora-host).
// Root-owned, NOT editable by aukora-host and NOT on any allowlist.
//  * Auma's hands: every model tool here executes inside the NVIDIA OpenShell sandbox "auma-ws"
//    (Linux user auma, rootless podman, network none) via the root-owned wrapper sbx-exec. No host fs tool.
//  * The one boundary: propose_change / revert_change -> harness's existing approval popup ->
//    skunkworks-gate (separate Linux user aukora-gate, unix socket) owns the single-use proposal store,
//    the append-only hash-chained signed ledger, the receipt key and the target files. aukora-host
//    cannot write targets, ledger or proposals; it can only ask the gate.
//  * Allowlist = declarative schema-validated targets only (theme.json). No code/plugin targets.
//  * Fail-closed start (teeth twin): tools are refused until a self-check proves the sandbox has no
//    egress / host reach AND that aukora-host itself cannot do forbidden things.
//  * $10 DeepSeek cap enforced in the llm/stream waterfall before dispatch.
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'auma-core'
export const inject = { tools: { required: true }, approval: { required: false }, webServer: { required: false }, connection: { required: false } }

const APP = '/workspace/skunkworks/app'
const STATE = path.join(APP, 'state')
const GATE_SOCK = '/run/skunkworks-gate/gate.sock'
const SBX = ['/usr/bin/sudo', ['-n', '-u', 'auma', '/usr/local/lib/skunkworks/sbx-exec']]
const OUT_CAP = 64 * 1024
const APPROVAL_TTL_MS = 5 * 60 * 1000
const CAP_USD = 10
const MAX_OUT_TOKENS = 8192
const MAX_CONCURRENT = 2
const PROBE_EVERY_MS = 15 * 60 * 1000
// USD per 1M tokens. Conservative: DeepSeek PEAK rates, every input token billed as cache-miss.
const PRICES = {
  'deepseek-official/deepseek-flash': { in: 0.44, out: 1.32 },
  'deepseek-official/deepseek-v4-pro': { in: 1.74, out: 3.96 },
}
// Forbidden-action probes run as aukora-host at start; every one MUST fail or tools stay refused.
const FORBIDDEN = [
  ['write gate-owned target', () => fs.openSync('/workspace/skunkworks/targets/plugins/auma-theme/theme.json', 'r+')],
  ['create file next to target', () => fs.openSync('/workspace/skunkworks/targets/plugins/auma-theme/x', 'wx')],
  ['read gate receipt key', () => fs.readFileSync('/workspace/skunkworks/gate/receipt-ed25519.pem')],
  ['open gate ledger db', () => fs.openSync('/workspace/skunkworks/gate/gate.db', 'r')],
  ['modify own boundary code', () => fs.openSync(path.join(APP, 'plugins/auma-core/index.js'), 'r+')],
  ['drop file into plugins dir', () => fs.openSync(path.join(APP, 'plugins/x.js'), 'wx')],
  ['rewrite profile overlay', () => fs.openSync(path.join(APP, 'skunkworks.patch.yml'), 'r+')],
  ['sudo to aukora-gate', () => { if (spawnSync('/usr/bin/sudo', ['-n', '-u', 'aukora-gate', '/bin/true']).status === 0) return 1; throw new Error('denied') }],
  ['sudo to root', () => { if (spawnSync('/usr/bin/sudo', ['-n', '/bin/true']).status === 0) return 1; throw new Error('denied') }],
  ['sudo to auma outside sbx-exec', () => { if (spawnSync('/usr/bin/sudo', ['-n', '-u', 'auma', '/bin/true']).status === 0) return 1; throw new Error('denied') }],
]

// ---------- gate client (unix socket, one JSON line per request) ----------
function gate(op, args = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const c = net.createConnection(GATE_SOCK); let buf = ''
    const t = setTimeout(() => { c.destroy(); reject(new Error('skunkworks-gate timeout (fail closed)')) }, timeoutMs)
    c.on('connect', () => c.write(JSON.stringify({ op, args }) + '\n'))
    c.on('data', d => { buf += d })
    c.on('end', () => { clearTimeout(t); let r; try { r = JSON.parse(buf) } catch { return reject(new Error('skunkworks-gate: bad reply (fail closed)')) } r.ok ? resolve(r.result) : reject(new Error(r.error)) })
    c.on('error', e => { clearTimeout(t); reject(new Error(`skunkworks-gate unavailable (${e.code}); fail closed`)) })
  })
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

// Egress / host-reach probe, run INSIDE the sandbox. Any success = fail.
function egressScript() {
  const hostIps = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4').map(a => a.address)
  const targets = ['1.1.1.1:443', '8.8.8.8:53', 'api.deepseek.com:443', '127.0.0.1:3091', '127.0.0.1:17690',
    'host.containers.internal:3091', 'host.containers.internal:17690', '10.0.2.2:3091', '10.0.2.2:17690', '10.88.0.1:3091',
    '169.254.169.254:80', ...hostIps.flatMap(ip => [`${ip}:3091`, `${ip}:17690`, `${ip}:22`])]
  return `fail=0
for t in ${targets.map(q).join(' ')}; do h=\${t%:*}; p=\${t##*:}
  if timeout 4 bash -c "exec 3<>/dev/tcp/$h/$p" 2>/dev/null; then echo "REACHABLE $t"; fail=1; else echo "blocked $t"; fi; done
if command -v curl >/dev/null; then for u in https://1.1.1.1 https://api.deepseek.com; do if curl -s -o /dev/null -m 5 "$u"; then echo "REACHABLE curl $u"; fail=1; else echo "blocked curl $u"; fi; done; fi
# OpenShell runs an in-sandbox DNS stub (127.0.0.53) that answers every name with a synthetic 198.18.0.0/15 sinkhole address; a real address = fail
for n in api.deepseek.com one.one.one.one; do ip=$(getent hosts "$n" | awk '{print $1; exit}'); case "$ip" in ""|198.18.*|198.19.*) echo "dns $n -> \${ip:-none} (sinkhole/none)";; *) echo "DNS REAL ADDRESS $n -> $ip"; fail=1;; esac; done
for s in /run/podman/podman.sock /run/user/*/podman/podman.sock /var/run/docker.sock /home/auma /home/aukora-host /workspace/skunkworks /run/skunkworks-gate; do if [ -e "$s" ]; then echo "VISIBLE $s"; fail=1; else echo "absent $s"; fi; done
if command -v sudo >/dev/null && sudo -n true 2>/dev/null; then echo "SUDO works"; fail=1; else echo "no sudo"; fi
a1="dsh/lib/bin"; a2="openshell-gate"; a3="gate.m"; a4="cloudfl"
for p in /proc/[0-9]*; do c=$(tr '\\0' ' ' < $p/cmdline 2>/dev/null); case "$c" in *PROBE_DONE*) continue;; *"$a1.js"*|*"\${a2}way"*|*"\${a3}js"*|*"\${a4}ared"*) echo "HOST PROCESS VISIBLE: \${c:0:120}"; fail=1;; esac; done
echo "routes: $(awk 'NR>1' /proc/net/route | wc -l)"
echo "PROBE_DONE fail=$fail"`
}

export function apply(ctx) {
  fs.mkdirSync(STATE, { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(path.join(STATE, 'skunkworks.db'))
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS spend(id TEXT PRIMARY KEY, model TEXT, est REAL, cost REAL, state TEXT, created INTEGER, updated INTEGER, note TEXT);
    CREATE TABLE IF NOT EXISTS activity(at INTEGER, session TEXT, tool TEXT, summary TEXT);`)
  ctx.effect(() => () => { try { db.close() } catch {} })
  const now = () => Date.now()
  const sid = (exec) => String(exec?.agent?.session?.id ?? exec?.agent?.id ?? 'none')
  const log = (exec, tool, summary) => { try { db.prepare('INSERT INTO activity VALUES(?,?,?,?)').run(now(), sid(exec), tool, String(summary).slice(0, 500)) } catch {} }
  db.prepare("UPDATE spend SET state='uncertain', cost=est, note='harness restarted mid-request; charged at reservation', updated=? WHERE state='reserved'").run(now())

  // ---------- fail-closed self-check (teeth twin) ----------
  const check = { ok: false, state: 'running', at: null, egress: null, forbidden: null, gate: null, error: null }
  let running = null, lastRun = 0
  async function selfCheck() {
    lastRun = now(); check.state = 'running'
    const res = { at: new Date().toISOString(), forbidden: [], egress: null, gate: null }
    let ok = true
    for (const [label, fn] of FORBIDDEN) {
      let succeeded = false, why = ''
      try { const fd = fn(); succeeded = true; if (typeof fd === 'number' && fd > 2) { try { fs.closeSync(fd) } catch {} } } catch (e) { why = e.code ?? e.message }
      res.forbidden.push({ action: label, result: succeeded ? 'SUCCEEDED (BAD)' : `refused (${why})` })
      if (succeeded) ok = false
    }
    try { const g = await gate('verify'); res.gate = { reachable: true, ledger_ok: g.ok, entries: g.entries }; if (!g.ok) ok = false }
    catch (e) { res.gate = { reachable: false, error: e.message }; ok = false }
    const r = await sandbox(egressScript(), 120)
    const passed = r.exit_code === 0 && /PROBE_DONE fail=0\s*$/.test(r.stdout)
    res.egress = { passed, exit: r.exit_code, reachable: (r.stdout.match(/^(REACHABLE|VISIBLE|DNS REAL|SUDO|HOST PROCESS).*$/gm) ?? []), lines: r.stdout.split('\n').filter(Boolean).length, stderr: r.stderr.slice(0, 300) }
    if (!passed) ok = false
    Object.assign(check, res, { ok, state: ok ? 'passed' : 'FAILED' })
    gate('selfcheck', { result: { ok, ...res } }).catch(() => {})
    ;(ok ? ctx.logger?.info : ctx.logger?.warn)?.call(ctx.logger, `auma-core self-check ${ok ? 'PASSED' : 'FAILED — all Auma tools refused'}: ${JSON.stringify({ forbidden: res.forbidden.filter(f => f.result.startsWith('SUCC')), gate: res.gate, egress: res.egress.reachable })}`)
    return ok
  }
  const runCheck = () => (running ??= selfCheck().catch(e => { check.ok = false; check.state = 'FAILED'; check.error = e.message; return false }).finally(() => { running = null }))
  gate('harness_start', { pid: process.pid }).catch(e => ctx.logger?.warn?.('auma-core: gate harness_start failed: ' + e.message))
  runCheck()
  const iv = setInterval(runCheck, PROBE_EVERY_MS); ctx.effect(() => () => clearInterval(iv))
  async function ready() {
    if (running) await running
    else if (!check.ok && now() - lastRun > 30000) await runCheck()
    if (!check.ok) throw new Error(`REFUSED (fail closed): SKUNKWORKS start-up self-check ${check.state}. ${check.error ?? ''} egress=${JSON.stringify(check.egress?.reachable ?? null)} gate=${JSON.stringify(check.gate)} forbidden=${JSON.stringify((check.forbidden ?? []).filter(f => f.result.startsWith('SUCC')))}`)
  }

  // ---------- tools inside the boundary (no approval; recorded) ----------
  const text = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }
  ctx.tools.register(defineTool({
    name: 'sandbox_shell',
    description: 'Run a bash command inside your NVIDIA OpenShell sandbox (Linux user auma, no network). Working dir /sandbox is your persistent workspace. Use this for running code and scripts. You cannot reach the host system from here.',
    parameters: { command: { type: 'string', required: true, description: 'bash command' }, timeout_s: { type: 'number', description: 'seconds (max 300, default 60)' } },
    output: text,
    async execute(args, exec) { await ready(); log(exec, 'sandbox_shell', args.command); return fmt(await sandbox(args.command, args.timeout_s ?? 60, exec.signal)) },
  }))
  ctx.tools.register(defineTool({
    name: 'write_file',
    description: 'Create or overwrite a file inside your sandbox workspace (relative paths are under /sandbox). Executes inside the OpenShell sandbox.',
    parameters: { path: { type: 'string', required: true }, content: { type: 'string', required: true } },
    output: text,
    async execute(args, exec) {
      await ready(); log(exec, 'write_file', args.path)
      const b64 = Buffer.from(args.content, 'utf8').toString('base64')
      const r = await sandbox(`p=${q(args.path)}; mkdir -p -- "$(dirname -- "$p")" && printf %s ${q(b64)} | base64 -d > "$p" && echo "wrote $(wc -c < "$p") bytes to $(realpath -- "$p")"`, 30, exec.signal)
      if (r.exit_code !== 0) throw new Error(fmt(r))
      return fmt(r)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file inside your sandbox (only files visible to the sandbox). To read a harness system target (e.g. the theme), use read_target instead.',
    parameters: { path: { type: 'string', required: true } },
    output: text,
    async execute(args, exec) {
      await ready(); log(exec, 'read_file', args.path)
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
      await ready(); log(exec, 'memory_note', args.note)
      const b64 = Buffer.from(`- ${new Date().toISOString()} ${args.note}\n`, 'utf8').toString('base64')
      return fmt(await sandbox(`mkdir -p .memory && printf %s ${q(b64)} | base64 -d >> .memory/notes.md && tail -n 5 .memory/notes.md`, 30, exec.signal))
    },
  }))

  // ---------- read-only views of the system (host reads via gate; no approval) ----------
  ctx.tools.register(defineTool({
    name: 'read_target',
    description: 'Read-only: current content and sha256 of an allowlisted harness system target (currently only "plugins/auma-theme/theme.json"), its schema, and its recorded versions (for revert_change). Call this before propose_change and pass the returned sha256 as base_sha256.',
    parameters: { target: { type: 'string', required: true } },
    output: text,
    async execute(args, exec) {
      await ready(); log(exec, 'read_target', args.target)
      const r = await gate('read', { target: args.target }); const h = await gate('history', { target: args.target })
      return `[host-read via skunkworks-gate; read-only]\ntarget: ${r.target}\nsha256: ${r.sha256}\nbytes: ${r.bytes}\nschema: ${r.schema}\n--- content ---\n${r.content ?? '(absent)'}\n--- recorded versions (newest first; revert_change can propose any available one) ---\n` +
        h.versions.map(v => `${v.current ? '* current ' : '  '}${v.sha256}  last applied ${v.last_applied_at}  ${v.available ? JSON.stringify(v.content) : '(bytes pruned)'}`).join('\n')
    },
  }))
  ctx.tools.register(defineTool({
    name: 'change_log',
    description: 'Read-only: the append-only, hash-chained, signed change ledger kept by skunkworks-gate (every proposal, decision, apply, revert, with sha256s and timestamps) plus its verification result.',
    parameters: { limit: { type: 'number', description: 'entries, newest first (default 20, max 200)' }, target: { type: 'string', description: 'optional target filter' } },
    output: text,
    async execute(args, exec) {
      await ready(); log(exec, 'change_log', args.target ?? '')
      const r = await gate('log', { limit: args.limit ?? 20, target: args.target })
      return `[skunkworks-gate ledger; read-only] verify: ${r.verify.ok ? 'OK' : 'BROKEN ' + JSON.stringify(r.verify.errors)} · ${r.verify.entries} entries · head ${r.verify.head.slice(0, 16)} · receipt key ${r.pubkey_fp}\n` +
        r.entries.map(e => `#${e.seq} ${e.at} ${e.event}${e.target ? ' ' + e.target : ''}${e.proposal ? ' p=' + e.proposal.slice(0, 8) : ''}${e.base_sha ? ' base=' + e.base_sha.slice(0, 12) : ''}${e.new_sha ? ' new=' + e.new_sha.slice(0, 12) : ''}${e.detail ? ' ' + JSON.stringify(e.detail).slice(0, 300) : ''}`).join('\n')
    },
  }))

  // ---------- THE BOUNDARY ----------
  function findEntry(id) {
    const tree = ctx.fiber?.entry?.parent?.tree
    try { if (tree) return tree.resolve(id) } catch {}
    const loader = ctx.get('loader') ?? ctx.loader
    try { return loader.resolve(id) } catch {}
    for (const e of loader?.entries?.() ?? []) if (e.options?.id === id || e.id === id) return e
    return undefined
  }
  async function restartEntry(id) {
    const e = findEntry(id); if (!e) throw new Error(`cannot find Cordis entry ${id}`)
    await e.update({ disabled: true }); await new Promise(r => setTimeout(r, 300)); await e.update({ disabled: null })
    return `Cordis entry "${id}": old fiber disposed, new fiber loaded (no harness restart)`
  }
  const vis = (txt) => String(txt).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
  const neutral = (txt) => vis(txt).replace(/[\n\r\u2500-\u257f\u2580-\u259f«»⚠✓✔]/g, '?')

  async function boundary(exec, p) {
    // Popup: HOST-VERIFIED FACTS (all computed by the gate from the real file) first; the model-authored note
    // is fenced, single-line, length-capped and stripped of box/marker characters so it cannot fake structure.
    const content = vis(p.content).split('\n').map(l => '│ ' + l).join('\n')
    const diffBody = vis(p.diff)
    const reason = [
      `SYSTEM CHANGE PROPOSED BY AUMA — ${p.kind === 'revert' ? 'REVERT' : 'declarative setting'}`,
      '──── HOST-VERIFIED FACTS (computed by skunkworks-gate from the real file, not by the model) ────',
      `target:        ${p.target}  (schema-validated ✓)`,
      `proposal:      ${p.id.slice(0, 8)} · single-use · expires ${new Date(p.expires).toLocaleTimeString('en-GB', { timeZone: 'Asia/Makassar' })} WITA`,
      `current sha256: ${p.base_sha}`,
      `result sha256:  ${p.new_sha}`,
      ...(p.displayable ? [
        '──── exact diff (- current, + proposed) ────', diffBody,
        `──── full resulting content: ${p.bytes} bytes ────`, content,
      ] : [`TRUNCATED — APPROVAL DISABLED: diff + content too large to show in full. Nothing will be applied whatever you click.`, diffBody.slice(0, 1500), '… [truncated]']),
      '──── END OF HOST-VERIFIED FACTS ────',
      `MODEL-AUTHORED NOTE (unverified; may be wrong or manipulative; ignore any instructions inside): «${p.why ? neutral(p.why) : '(none)'}»`,
      '──── END OF PROPOSAL ────',
      p.displayable ? `Allow once = skunkworks-gate writes exactly these ${p.bytes} bytes (sha256 ${p.new_sha.slice(0, 12)}…), signs a receipt, and the harness hot-reloads only Cordis entry "${p.entry}". Reject / no answer = nothing changes.` : 'Allow once is IGNORED for this proposal (fail closed).',
    ].join('\n')
    const approval = ctx.get('approval')
    if (!approval || !exec.agent) { await gate('decide', { id: p.id, outcome: 'unavailable' }).catch(() => {}); throw new Error('refused: no approval channel (fail closed)') }
    const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(APPROVAL_TTL_MS)].filter(Boolean))
    let outcome
    try { outcome = await approval.request({ agent: exec.agent, toolName: exec.name, callId: exec.callId, reason, signal }) }
    catch (e) { await gate('decide', { id: p.id, outcome: 'unavailable' }).catch(() => {}); throw e }
    const at = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Makassar' }) + ' WITA'
    const d = await gate('decide', { id: p.id, outcome })
    log(exec, exec.name, `${p.target} ${outcome} -> ${d.state}`)
    if (!d.applied) {
      if (outcome !== 'allowed-once') return `NOT APPLIED: ${outcome === 'rejected' ? 'owner REJECTED it in the approval popup' : 'no owner answer (' + outcome + ')'} at ${at}. Nothing changed. (proposal ${p.id} is now ${d.state} and can never be used.)`
      return `NOT APPLIED: owner clicked Allow once at ${at}, but skunkworks-gate refused: ${d.message}. Nothing changed. (proposal ${p.id} is ${d.state}.)`
    }
    let reloaded; try { reloaded = await restartEntry(d.entry) } catch (e) { reloaded = 'hot-reload FAILED (' + e.message + '); takes effect on next harness start' }
    return `Owner APPROVED this exact change in the harness approval popup at ${at}. APPLIED by skunkworks-gate (proposal ${p.id}, spent). ${p.target} now sha256 ${p.new_sha} (was ${p.base_sha}). ${reloaded}. Signed receipt: ledger #${d.ledger_seq}, key ${d.receipt.pubkey_fp}, sig ${d.receipt_sig.slice(0, 24)}…`
  }

  ctx.tools.register(defineTool({
    name: 'propose_change',
    description: 'The ONLY way to change the system you run in. Proposes exact new content for one allowlisted declarative target; currently only "plugins/auma-theme/theme.json" (UI theme: exactly {"accent": "#RRGGBB" or "default"}; e.g. gold = "#D4AF37"). First call read_target and pass its sha256 as base_sha256: missing or outdated base is refused as stale. The owner sees the exact diff and sha256s in an approval popup and must approve. No code or plugin targets exist.',
    parameters: {
      target: { type: 'string', required: true, description: 'allowlisted target name' },
      new_content: { type: 'string', required: true, description: 'complete new file content (exact bytes)' },
      base_sha256: { type: 'string', required: true, description: 'sha256 returned by read_target for the current content' },
      summary: { type: 'string', description: 'one-line reason shown to the owner (marked as model-authored)' },
    },
    output: text,
    async execute(args, exec) {
      await ready()
      const p = await gate('propose', { target: args.target, content: args.new_content, claimed_base: args.base_sha256, why: args.summary, session: sid(exec), call_id: exec.callId })
      return boundary(exec, p)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'revert_change',
    description: 'Propose reverting an allowlisted target to any earlier applied version recorded in the ledger (see read_target / change_log), or "previous". Shown in the same approval popup; owner must approve.',
    parameters: { target: { type: 'string', required: true }, to_sha256: { type: 'string', description: 'sha256 of the recorded version, or "previous" (default)' }, summary: { type: 'string' } },
    output: text,
    async execute(args, exec) {
      await ready()
      const p = await gate('revert', { target: args.target, to_sha: args.to_sha256 ?? 'previous', why: args.summary, session: sid(exec), call_id: exec.callId })
      return boundary(exec, p)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'revert_last_change',
    description: 'Shortcut for revert_change with to_sha256 "previous". Owner must approve in the popup.',
    parameters: { target: { type: 'string', required: true } },
    output: text,
    async execute(args, exec) {
      await ready()
      const p = await gate('revert', { target: args.target, to_sha: 'previous', session: sid(exec), call_id: exec.callId })
      return boundary(exec, p)
    },
  }))

  // ---------- $10 DeepSeek cap, enforced before dispatch ----------
  // One reservation per llm/stream call. dsh-llm-retry retries by re-running the step (agent/request-error),
  // which goes through this waterfall again, so every retry is reserved and counted.
  const spent = () => db.prepare("SELECT COALESCE(SUM(CASE WHEN state IN ('settled','uncertain') THEN cost WHEN state='reserved' THEN est ELSE 0 END),0) AS s FROM spend").get().s
  ctx.on('llm/stream', function (options, next) {
    return (async function* () {
      const key = `${options.provider}/${options.model}`
      // Loopback scripted driver (owner acceptance checks only): priced at $0 ONLY while the owner-created
      // flag file exists AND the provider is configured in the profile patch.
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
    handler: async (req, res) => {
      const rej = conn.requestRejection(req); if (rej !== undefined) { res.statusCode = rej; res.end(); return }
      let g; try { g = await gate('status') } catch (e) { g = { error: e.message } }
      res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify({
        selfCheck: check,
        gate: g,
        spend: { capUsd: CAP_USD, countedUsd: spent(), rows: db.prepare('SELECT id,model,est,cost,state,note,created FROM spend ORDER BY created DESC LIMIT 20').all() },
        activity: db.prepare('SELECT * FROM activity ORDER BY at DESC LIMIT 30').all(),
      }, null, 1))
    },
  }), 'auma-core: GET /auma/status')
}
