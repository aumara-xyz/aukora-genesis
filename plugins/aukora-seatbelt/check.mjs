#!/usr/bin/env node
/**
 * AUKORA SEATBELT, THROUGH THE HARNESS'S OWN BASH EXECUTOR, WITH NO LIVE APP.
 *
 *   DSH_ROOT=<a built vendor/dsh> node plugins/aukora-seatbelt/check.mjs
 *
 * It builds a Cordis context with the harness's real `@deepseek-ai/dsh-subprocess-local`, a fixed sandbox policy
 * (`workspace-write`, the deployment default) and the real `@deepseek-ai/dsh-bash-sandbox` executor — the `shell` the
 * `bash` tool calls — and mounts `sandbox` two ways: through this plugin (the arm) and as the stock
 * `@deepseek-ai/dsh-sandbox-local` row (the red arm). Each command runs through `ctx.shell.run()`, so the argv that
 * reaches the kernel is exactly the one the harness would spawn.
 *
 * Everything lives in one scratch root (scripts/lib/run-root.mjs `openScratch`), holds FAKE contents only, and is
 * removed at exit. The roots it hands the plugin are that scratch tree's, so no live path is named in any rule.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { openScratch } from '../../scripts/lib/run-root.mjs'
import * as seatbelt from './lib/index.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DSH = resolve(process.env.DSH_ROOT ?? join(HERE, '..', '..', 'vendor', 'dsh'))
const lib = (...parts) => join(DSH, 'packages', ...parts, 'lib', 'index.js')
if (process.platform !== 'darwin') {
  process.stderr.write('NOT RUN: Seatbelt is macOS only\n')
  process.exit(2)
}
if (!existsSync(lib('shell', 'bash-sandbox'))) {
  process.stderr.write(`NOT RUN: no built DeepSeek Harness at ${DSH} (run scripts/build-dsh.py, or set DSH_ROOT)\n`)
  process.exit(2)
}
const load = async (path) => import(pathToFileURL(path).href)
const { Context } = await load(join(DSH, 'vendor', 'cordis', 'lib', 'index.js'))
const LocalSubprocessRuntime = (await load(lib('subprocess', 'subprocess-local'))).default
const SandboxBashExecutor = (await load(lib('shell', 'bash-sandbox'))).default
const providerModule = lib('sandbox', 'sandbox-local')
const LocalSandboxProvider = (await load(providerModule)).default

// ── A disposable deployment. Short paths: a unix socket path must fit in 104 bytes. ────────────────────────────────
const scratch = openScratch({ owner: 'aukora-seatbelt-check', label: 'seatbelt' })
const S = scratch.root
const home = join(S, 'h')
const supportRoot = join(S, 'sup')
const dshHome = join(supportRoot, 'state', 'home')
const ws = join(home, 'aukora-worktrees', 'wt')
const repo = join(home, 'aukora-genesis')
const seed = join(supportRoot, 'state', 'aumlok', 'machine-seed-v3.json')
const socket = join(supportRoot, 'state', 'aumlok-signer.sock')
const airlockSocket = join(S, 'air', 'owner.sock')
const auraLog = join(dshHome, 'aura-code', 'aura.jsonl')
const spentSet = join(dshHome, 'aura-code', 'consumed-ids.json')
const gateLog = join(dshHome, 'aura-actions', 'aura.jsonl')
const fake = {
  [seed]: 'FAKE-SEED-not-a-key\n',
  [join(supportRoot, 'state', 'aumlok', 'record-v3.json')]: 'FAKE-RECORD\n',
  [join(dshHome, 'kira-memory', 'issuer.json')]: 'FAKE-KIRA-ISSUER\n',
  [join(dshHome, 'kira-memory', 'keys', 'r1.json')]: 'FAKE-KIRA-KEY\n',
  [join(home, '.ssh', 'id_ed25519')]: 'FAKE-SSH-KEY\n',
  [join(home, '.config', 'gh', 'hosts.yml')]: 'FAKE-GH-TOKEN\n',
  [join(home, '.aukora', 'signer', 'daemon-ed25519.pem')]: 'FAKE-SIGNER-KEY\n',
  [join(supportRoot, 'state', 'launch-url.json')]: '{"token":"FAKE-BACKEND-TOKEN"}\n',
  [auraLog]: '{"seq":1}\n',
  [spentSet]: '{"consumedIds":[]}\n',
  [gateLog]: '{"seq":1}\n',
}
for (const [path, text] of Object.entries(fake)) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
mkdirSync(ws, { recursive: true })
mkdirSync(join(repo, 'plugins'), { recursive: true })
writeFileSync(join(ws, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'wt')}\n`)
if (Buffer.byteLength(socket) > 103) throw new Error(`socket path too long for sun_path: ${socket}`)
const signer = createServer(connection => connection.end('FAKE-SIGNER-REPLY\n'))
await new Promise(ok => signer.listen(socket, ok))
mkdirSync(dirname(airlockSocket), { recursive: true })
const airlock = createServer(connection => connection.end('FAKE-AIRLOCK-REPLY\n'))
await new Promise(ok => airlock.listen(airlockSocket, ok))

// ── The harness, with `sandbox` mounted by the caller. ─────────────────────────────────────────────────────────────
async function harness(mountSandbox) {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin((inner) => {
    // The deployment default (base cordis.patch.yml: DSH_PERMISSION_MODE ?? 'workspace-write'); calls pass their own.
    inner.provide('sandboxPolicy', { defaultMode: 'workspace-write', resolve: () => ({ mode: 'workspace-write', workspaceRoot: ws }) })
  })
  await mountSandbox(ctx)
  await ctx.plugin(SandboxBashExecutor, { cwd: ws, timeoutMs: 20_000 })
  return async (command, workspaceRoot = ws, mode = 'workspace-write') => {
    const result = await ctx.shell.run(ctx.shell.resolve({
      command, workdir: workspaceRoot, sandboxPolicy: { mode, workspaceRoot },
    }))
    return { exit: result.exitCode, out: result.stdout.text.trim(), err: result.stderr.text.trim(), denied: result.sandbox?.denied }
  }
}
const aukora = await harness(ctx => ctx.plugin(seatbelt, { home, supportRoot, dshHome, airlockSockets: [airlockSocket], providerModule }))
const stock = await harness(ctx => ctx.plugin(LocalSandboxProvider))

// ── The arms. ──────────────────────────────────────────────────────────────────────────────────────────────────────
const q = path => `'${path}'`
const node = q(process.execPath)
const ARMS = [
  ['(a) read the fake seed', `cat ${q(seed)}`, 'denied'],
  ['(a2) read the Kira issuer', `cat ${q(join(dshHome, 'kira-memory', 'issuer.json'))}`, 'denied'],
  ['(a3) read ~/.ssh', `cat ${q(join(home, '.ssh', 'id_ed25519'))}`, 'denied'],
  ['(a4) read ~/.config/gh', `cat ${q(join(home, '.config', 'gh', 'hosts.yml'))}`, 'denied'],
  ['(a5) read ~/.aukora/signer', `cat ${q(join(home, '.aukora', 'signer', 'daemon-ed25519.pem'))}`, 'denied'],
  ['(a6) list the Aumlok state', `ls ${q(join(supportRoot, 'state', 'aumlok'))}`, 'denied'],
  ['(a7) read the backend token', `cat ${q(join(supportRoot, 'state', 'launch-url.json'))}`, 'denied'],
  ['(b) write in the workspace (~/aukora-worktrees/wt), git init', `echo work > out.txt && cat out.txt && git init -q repo && echo git-ok`, 'allowed'],
  ['(b2) write in TMPDIR', `f=$(mktemp) && echo tmp-ok > "$f" && cat "$f" && rm "$f"`, 'allowed'],
  ['(b3) run node in the workspace', `${node} -e 'require("fs").writeFileSync("n.txt","node-ok"); console.log(require("fs").readFileSync("n.txt","utf8"))'`, 'allowed'],
  ['(c) a script the command writes, then runs, reads the seed',
    `printf '#!/bin/sh\\ncat "%s"\\n' ${q(seed)} > peek.sh && chmod +x peek.sh && ./peek.sh`, 'denied'],
  ['(c2) the same, as a node script',
    `printf 'process.stdout.write(require("fs").readFileSync(process.argv[2], "utf8"))' > peek.cjs && ${node} peek.cjs ${q(seed)}`, 'denied'],
  ['(d) connect to the signer socket',
    `${node} -e 'require("net").connect(process.argv[1]).on("data",d=>{process.stdout.write(d);process.exit(0)}).on("error",e=>{console.error(e.message);process.exit(1)})' ${q(socket)}`, 'denied'],
  ['(d2) connect to the Airlock owner socket',
    `${node} -e 'require("net").connect(process.argv[1]).on("data",d=>{process.stdout.write(d);process.exit(0)}).on("error",e=>{console.error(e.message);process.exit(1)})' ${q(airlockSocket)}`, 'denied'],
  ['(e) append to the code Aura chain', `echo '{"seq":2,"forged":true}' >> ${q(auraLog)}`, 'denied'],
  ['(e2) rewrite the kernel spent set', `echo '{"consumedIds":[]}' > ${q(spentSet)}`, 'denied'],
  ['(e3) append to the action receipts', `echo '{"forged":true}' >> ${q(gateLog)}`, 'denied'],
  ['(e4) read the code Aura chain', `cat ${q(auraLog)}`, 'allowed'],
]
// The session's workspace is an ANCESTOR of every protected path: the stock write grant then covers them all.
const ANCESTOR_ARMS = [
  ['(f) rename an ancestor, then read the seed', `mv ${q(join(supportRoot, 'state'))} ${q(join(S, 'moved'))} && cat ${q(join(S, 'moved', 'aumlok', 'machine-seed-v3.json'))}`, 'denied'],
  ['(f2) rename an ancestor, then append to the chain', `mv ${q(dshHome)} ${q(join(S, 'moved-home'))} && echo forged >> ${q(join(S, 'moved-home', 'aura-code', 'aura.jsonl'))}`, 'denied'],
  ['(f3) ordinary work under that ancestor', `mkdir -p ${q(join(S, 'new', 'deep'))} && echo ok > ${q(join(S, 'new', 'deep', 'f'))} && cat ${q(join(S, 'new', 'deep', 'f'))}`, 'allowed'],
  ['(f4) write in the support root under that ancestor', `echo x > ${q(join(supportRoot, 'new-file'))}`, 'denied'],
]
// CONTAINED WORK: the session's workspace is the governing checkout, as in the live app.
const CONTAINED_ARMS = [
  ['(g) write governing code in the workspace checkout', `echo x > ${q(join(repo, 'plugins', 'x.mjs'))}`, 'denied'],
  ['(h) write in a proposal worktree', `echo wt-ok > ${q(join(ws, 'f.txt'))} && cat ${q(join(ws, 'f.txt'))}`, 'allowed'],
  ['(h2) re-point a worktree\'s .git', `echo 'gitdir: /private/tmp/x' > ${q(join(ws, '.git'))}`, 'denied'],
  ['(h3) make a worktree directory', `mkdir ${q(join(home, 'aukora-worktrees', 'new'))}`, 'denied'],
  ['(h4) move a worktree aside', `mv ${q(ws)} ${q(join(S, 'moved-wt'))}`, 'denied'],
]

// The kernel's EPERM, as cat/bash print it ("Operation not permitted") or as node prints it ("connect EPERM").
const verdict = r => (r.exit === 0 ? 'allowed' : /operation not permitted|\bEPERM\b/iu.test(r.err) ? 'denied' : `failed(${String(r.exit)})`)
const failures = []
async function section(title, run, arms, expectFor, workspaceRoot) {
  process.stdout.write(`\n== ${title}\n`)
  for (const [label, command, expected] of arms) {
    const r = await run(command, workspaceRoot)
    const got = verdict(r)
    const want = expectFor(expected)
    const mark = want === null ? 'INFO' : got === want ? 'PASS' : 'FAIL'
    if (mark === 'FAIL') failures.push(`${title}: ${label}: want ${want}, got ${got}`)
    process.stdout.write(`${mark} ${label}\n  exit=${String(r.exit)} denied=${String(r.denied)} out=${JSON.stringify(r.out)} err=${JSON.stringify(r.err)}\n`)
  }
}
await section('WITH aukora-seatbelt', aukora, ARMS, e => e, ws)
await section('WITH aukora-seatbelt, workspace = the scratch root (an ancestor of every protected path)', aukora, ANCESTOR_ARMS, e => e, S)
await section('WITH aukora-seatbelt, workspace = the governing checkout', aukora, CONTAINED_ARMS, e => e, repo)
await section('WITH aukora-seatbelt, read-only: no worktree grant', (c, w) => aukora(c, w, 'read-only'), CONTAINED_ARMS.slice(1, 2), () => 'denied', repo)
// The red arm: the protection removed. Every arm this plugin exists for must now SUCCEED.
const RED = new Set(['(a) read the fake seed', '(a7) read the backend token', '(c) a script the command writes, then runs, reads the seed',
  '(c2) the same, as a node script', '(d) connect to the signer socket', '(d2) connect to the Airlock owner socket', '(e) append to the code Aura chain'])
// Since the mandatory-agent-confinement patch the harness refuses to start a child without `aukoraConfinement`, so
// the stock-provider red arm can no longer run through `ctx.shell`. Say so instead of crashing.
try {
  await section('RED ARM: the stock sandbox-local profile only', stock, ARMS.filter(([label]) => RED.has(label)), () => 'allowed', ws)
  process.stdout.write(`\nfake chain after the red arm: ${JSON.stringify(readFileSync(auraLog, 'utf8'))}\n`)
  await section('RED ARM, ancestor workspace', stock, ANCESTOR_ARMS.slice(0, 1), () => 'allowed', S)
  // (h) is not in a red arm: this scratch tree sits under /private/tmp, which the stock grant already covers.
  await section('RED ARM, governing checkout as workspace', stock, CONTAINED_ARMS.slice(0, 1), () => 'allowed', repo)
} catch (error) {
  process.stdout.write(`NOT RUN stock red arm: ${error?.code ?? ''} ${error?.message ?? error}\n`)
}
// The (d2) twin, straight through sandbox-exec: the same AUKORA forms with and without the Airlock socket. Only the
// Airlock deny differs, so a connect that is refused with it and succeeds without it is refused BY that deny.
{
  // Async: the fake Airlock server lives in this process and must keep answering while the child connects.
  const { execFile } = await import('node:child_process')
  const run = (argv) => new Promise(done => execFile(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 20_000 },
    (error, stdout, stderr) => done({ exit: error ? (error.code ?? 1) : 0, out: String(stdout).trim(), err: String(stderr).trim() })))
  const { aukoraDenyForms, protectedPaths } = await import('./lib/profile.mjs')
  const base = '(version 1) (allow default)'
  const connect = [process.execPath, '-e', 'require("net").connect(process.argv[1]).on("data",d=>{process.stdout.write(d);process.exit(0)}).on("error",e=>{console.error(e.message);process.exit(1)})', airlockSocket]
  for (const [label, sockets, want] of [['(d2) twin, Airlock deny present', [airlockSocket], 'denied'], ['(d2) twin RED, Airlock deny removed', [], 'allowed']]) {
    const profile = [base, ...aukoraDenyForms(protectedPaths({ home, supportRoot, dshHome, airlockSockets: sockets }))].join('\n')
    const r = await run(['/usr/bin/sandbox-exec', '-p', profile, ...connect])
    const got = verdict(r)
    if (got !== want) failures.push(`${label}: want ${want}, got ${got}`)
    process.stdout.write(`${got === want ? 'PASS' : 'FAIL'} ${label}\n  exit=${String(r.exit)} out=${JSON.stringify(r.out)} err=${JSON.stringify(r.err)}\n`)
  }
}

signer.close()
airlock.close()
process.stdout.write(failures.length === 0 ? '\nSEATBELT CHECK: all arms as expected\n' : `\nSEATBELT CHECK FAILED:\n  ${failures.join('\n  ')}\n`)
process.stdout.write(`(TMPDIR for this run: ${tmpdir()})\n`)
process.exit(failures.length === 0 ? 0 : 1)
