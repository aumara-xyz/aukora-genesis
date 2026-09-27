#!/usr/bin/env node
/**
 * KIRA'S MEMORY PATH, END TO END ON THE MOUNTED PLUGIN — one check, one arm per fix.
 *
 *   node tests/kira-memory-live-path.test.mjs [--dsh <built harness>]        # the arms, green
 *   node tests/kira-memory-live-path.test.mjs --red [--dsh <built harness>]  # each fix reverted in turn: its arm must go red
 *
 *   1. release     a materialized release carries every file its scripts import; its public-evidence.mjs runs
 *   2. auma        the mounted plugin listens for `auma/turn-finished`, and a spoken turn becomes a remembered note
 *   3. everything  every finished owner turn (text chat and Auma Live) becomes a remembered note
 *   3k. keeps      off the record / lane door / secret scan / grantsAuthority:false / the separate remembered chain still hold
 *   4a. tier       a note file under remembered/ that says `signed` is listed as Remembered, never as Signed
 *   4b. chain      verify reads the chain: a deleted chain answers MISSING and a rewritten entry CHANGED, never VERIFIED
 *   5. forget      forget removes the auto-staged queue copy and names what it could not reach
 *
 * WHAT RUNS. Arms 2-5 mount `plugins/aukora-kira/lib/index.js` `apply()` on a stand-in context, fire the events the harness
 * and the apps face fire (`agent/turn-stopping`, `auma/turn-finished`), and call the routes the plugin mounted on the stand-in
 * web server. Arm 1 runs `scripts/materialize-aukora-release.py` into a scratch directory (it needs a clean commit and the
 * built harness: `--dsh`, else $AUKORA_DSH_SOURCE, else `vendor/dsh` of this checkout or of the main checkout it belongs to).
 *
 * CEILINGS. Disposable state under the OS temp directory only; the live support folder is never opened (the materializer runs
 * with AUKORA_STATE pointed at scratch). The apps face is not run: the `auma/turn-finished` payload is built here in the shape
 * `plugins/aukora-face/apps/src/index.ts` emits. Nothing here shows the installed app does any of this.
 * `--red` never writes a mutant to disk: each child applies ONE revert in memory (a module load hook for JavaScript, an
 * in-memory `exec` for the materializer), and the revert must match its text exactly once or the child refuses to run.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const HERE = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(HERE), '..')

// ── the fixes, and the one-line revert of each ───────────────────────────────────────────────────────────────────────
const ARMS = Object.freeze({
  release: '1. release: a materialized release carries its scripts\' imports and runs public-evidence.mjs',
  auma: '2. auma: the mounted plugin captures a spoken turn from auma/turn-finished',
  everything: '3. everything: every finished owner turn, text chat and Auma Live, becomes a remembered note',
  keeps: '3k. keeps: off the record, lane door, secret scan, no authority and the separate chain still hold',
  tier: '4a. tier: a note under remembered/ that says signed is listed as Remembered',
  chain: '4b. chain: verify reads the chain, so a deleted or rewritten chain is not VERIFIED',
  forget: '5. forget: the auto-staged queue copy goes and the answer names what forget did not reach',
})
const MUTANTS = Object.freeze({
  'release-closure': {
    file: 'scripts/materialize-aukora-release.py',
    from: "RELEASE_IMPORT_FILES = ('apps/aukora-desktop/card-chain.mjs', 'scripts/aukora/desktop-cutover.mjs')",
    to: "RELEASE_IMPORT_FILES = ('scripts/aukora/desktop-cutover.mjs',)",
    arm: ARMS.release,
  },
  'auma-unregistered': {
    file: 'plugins/aukora-kira/lib/index.js',
    from: '    registerAumaTurnCapture(ctx, {\n',
    to: '    ;(() => {})(ctx, {\n',
    arm: ARMS.auma,
  },
  'markers-only': {
    file: 'plugins/aukora-kira/lib/memory-capture.mjs',
    from: '  const whole = wholeTurnText(text)\n',
    to: "  const whole = ''\n",
    arm: ARMS.everything,
  },
  'owner-words-unread': {
    file: 'plugins/aukora-kira/lib/memory-capture-hook.mjs',
    from: "  const said = ownerControlIn(String(turn?.text ?? ''))\n",
    to: '  const said = null\n',
    arm: ARMS.keeps,
  },
  'tier-from-file': {
    file: 'plugins/aukora-kira/lib/memory-deps.mjs',
    from: "{ ...note, tier: 'remembered' } : note)",
    to: '{ ...note } : note)',
    arm: ARMS.tier,
  },
  'chain-self-compare': {
    file: 'plugins/aukora-kira/lib/memory-deps.mjs',
    from: '() => rememberedChainEntry(stateDir, String(found.id))',
    to: '() => found?.aura?.entryHash ?? null',
    arm: ARMS.chain,
  },
  'queue-untouched': {
    file: 'plugins/aukora-kira/lib/memory-deps.mjs',
    from: '    const matchesNote = queueEntryMatcher(found)\n',
    to: '    const matchesNote = () => false\n',
    arm: ARMS.forget,
  },
})

const argv = process.argv.slice(2)
const option = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined }
const dshArgs = option('--dsh') === undefined ? [] : ['--dsh', option('--dsh')]

// ── --red: plain must pass, then every revert must turn its own arm red ──────────────────────────────────────────────
if (argv[0] === '--red') {
  const run = extra => {
    const child = spawnSync(process.execPath, [HERE, ...extra, ...dshArgs], { encoding: 'utf8', timeout: 600_000 })
    return { status: child.status, out: `${child.stdout ?? ''}${child.stderr ?? ''}` }
  }
  const indent = text => text.trimEnd().split('\n').map(line => `    ${line}`).join('\n')
  const plain = run([])
  process.stdout.write(`plain (no revert): exit ${String(plain.status)}\n${indent(plain.out)}\n\n`)
  let caught = 0
  for (const [name, mutant] of Object.entries(MUTANTS)) {
    const child = run(['--mutant', name])
    const red = child.status !== 0 && child.out.includes(`FAIL  ${mutant.arm}`)
    if (red) caught += 1
    process.stdout.write(`revert ${name} (${mutant.file}): exit ${String(child.status)} — ${red ? 'CAUGHT' : 'NOT CAUGHT'}: "${mutant.arm}"\n${indent(child.out)}\n\n`)
  }
  const total = Object.keys(MUTANTS).length
  const ok = plain.status === 0 && caught === total
  process.stdout.write(`KIRA MEMORY LIVE PATH RED ARM: plain ${plain.status === 0 ? 'passed' : 'FAILED'}; ${String(caught)}/${String(total)} reverts turned their arm red — ${ok ? 'OK' : 'NOT OK'}\n`)
  process.exit(ok ? 0 : 1)
}

// ── --mutant <name>: revert ONE fix in memory, before any subject module loads ───────────────────────────────────────
let mutation = null
if (argv[0] === '--mutant') {
  const mutant = MUTANTS[argv[1]]
  if (mutant === undefined) { process.stderr.write(`unknown mutant ${String(argv[1])}\n`); process.exit(2) }
  mutation = { name: argv[1], ...mutant, applied: 0 }
  if (mutant.file.endsWith('.mjs') || mutant.file.endsWith('.js')) {
    const target = pathToFileURL(join(ROOT, mutant.file)).href
    registerHooks({
      load(url, context, nextLoad) {
        const result = nextLoad(url, context)
        if (url !== target) return result
        const source = Buffer.from(result.source).toString('utf8')
        const count = source.split(mutant.from).length - 1
        if (count !== 1) throw new Error(`mutant ${argv[1]}: the fix text occurs ${String(count)} times in ${mutant.file}, not once; nothing was reverted`)
        mutation.applied += 1
        return { ...result, source: source.replace(mutant.from, mutant.to) }
      },
    })
  }
}
// A revert of one fix runs only the arms it can reach: the release arm alone for the materializer, the plugin arms otherwise.
const runRelease = mutation === null || mutation.file.endsWith('.py')
const runPlugin = mutation === null || !mutation.file.endsWith('.py')

const load = path => import(pathToFileURL(join(ROOT, path)).href)

let failures = 0
let passed = 0
async function arm(name, body) {
  try {
    await body()
    passed += 1
    process.stdout.write(`  ok    ${name}\n`)
  } catch (error) {
    failures += 1
    process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n').slice(0, 3).join(' | ').slice(0, 400)}\n`)
  }
}

/** Every file's text under a directory (lock files skipped), with its path. */
function filesUnder(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path))
    else if (!name.endsWith('.lock')) out.push({ path, text: readFileSync(path, 'utf8') })
  }
  return out
}

const work = mkdtempSync(join(tmpdir(), 'kira-memory-live-path-'))
assert.ok(!work.includes('Application Support'), `refusing: ${work} is not a scratch directory`)
try {
  // ── ARM 1: THE RELEASE ─────────────────────────────────────────────────────────────────────────────────────────────
  if (runRelease) {
    await arm(ARMS.release, async () => {
      const common = spawnSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).stdout?.trim() ?? ''
      const candidates = [option('--dsh'), process.env.AUKORA_DSH_SOURCE, join(ROOT, 'vendor/dsh'), common === '' ? undefined : join(dirname(common), 'vendor/dsh')]
      const dsh = candidates.find(one => typeof one === 'string' && one !== '' && existsSync(join(one, 'apps/cli/lib/bin.js')))
      assert.ok(dsh !== undefined, `no built harness found (tried ${candidates.filter(Boolean).join(', ')}); pass --dsh <built vendor/dsh>`)
      const release = join(work, 'releases', 'r')
      mkdirSync(dirname(release), { recursive: true })
      const materializer = join(ROOT, 'scripts/materialize-aukora-release.py')
      const env = { ...process.env, AUKORA_STATE: join(work, 'aukora-state'), PYTHONDONTWRITEBYTECODE: '1' }
      let made
      if (mutation?.file.endsWith('.py')) {
        const py = [
          'import sys',
          `src = open(${JSON.stringify(materializer)}, encoding='utf-8').read()`,
          `frm, to = ${JSON.stringify(mutation.from)}, ${JSON.stringify(mutation.to)}`,
          "assert src.count(frm) == 1, 'the fix text occurs %d times, not once; nothing was reverted' % src.count(frm)",
          `sys.argv = [${JSON.stringify(materializer)}] + sys.argv[1:]`,
          `exec(compile(src.replace(frm, to), ${JSON.stringify(materializer)}, 'exec'), {'__name__': '__main__', '__file__': ${JSON.stringify(materializer)}})`,
        ].join('\n')
        mutation.applied += 1
        process.stdout.write(`MUTANT ${mutation.name}: reverted the fix in ${mutation.file} (in memory only)\n`)
        made = spawnSync('python3', ['-c', py, '--from', dsh, '--to', release], { encoding: 'utf8', env, timeout: 300_000 })
      } else {
        made = spawnSync('python3', [materializer, '--from', dsh, '--to', release], { encoding: 'utf8', env, timeout: 300_000 })
      }
      const said = `${made.stdout ?? ''}${made.stderr ?? ''}`
      const refusal = said.split('\n').filter(line => /refused|release-import-closure-open|FAIL|ERROR|imported by/iu.test(line)).slice(0, 6).join(' | ')
      assert.equal(made.status, 0, `the materializer refused (exit ${String(made.status)}): ${refusal || said.slice(-400)}`)
      process.stdout.write(`        materialized ${release}\n`)
      assert.ok(existsSync(join(release, 'apps/aukora-desktop/card-chain.mjs')), 'the release does not carry apps/aukora-desktop/card-chain.mjs')
      // --help LOADS THE MODULE AND ITS WHOLE IMPORT GRAPH, then prints its usage and exits 2 — exactly as the checkout's copy does.
      // Before the fix it died loading, with ERR_MODULE_NOT_FOUND for apps/aukora-desktop/card-chain.mjs.
      const helpOf = file => {
        const run = spawnSync(process.execPath, [file, '--help'], { encoding: 'utf8', cwd: work })
        return { status: run.status, out: `${run.stdout ?? ''}${run.stderr ?? ''}` }
      }
      const help = helpOf(join(release, 'scripts/kira/public-evidence.mjs'))
      const reference = helpOf(join(ROOT, 'scripts/kira/public-evidence.mjs'))
      assert.ok(!help.out.includes('ERR_MODULE_NOT_FOUND'), `the release's public-evidence.mjs cannot load: ${help.out.split('\n').find(line => /Cannot find module/u.test(line)) ?? help.out.slice(0, 300)}`)
      assert.match(help.out, /usage: public-evidence\.mjs/u, `the release's public-evidence.mjs --help printed no usage: ${help.out.slice(0, 200)}`)
      assert.equal(help.status, reference.status, `the release's public-evidence.mjs --help exited ${String(help.status)}, the checkout's ${String(reference.status)}`)
      process.stdout.write(`        node ${release}/scripts/kira/public-evidence.mjs --help -> exit ${String(help.status)} (checkout copy: ${String(reference.status)}): ${help.out.trim().split('\n')[0]}\n`)
      // AND THE LEG remember.mjs RUNS AFTER THE SETTLE — `export` from the release — against one approved record written by shape
      // (the fixture tests/kira-memory-law.test.mjs uses; no signature is checked here).
      const { createMemoryOwner, AURA_RECORD_DOMAIN, auraEntryHash } = await load('plugins/aukora-kira/lib/memory-owner.mjs')
      const { stageKiraMemoryRecord, memoryEffectBody } = await load('plugins/aukora-kira/lib/record.mjs')
      const store = join(work, 'export-store', 'kira-memory')
      mkdirSync(store, { recursive: true, mode: 0o700 })
      createMemoryOwner({ stateDir: store })
      const staged = stageKiraMemoryRecord({ subject: `aukora:1:${'3c'.repeat(32)}`, kind: 'observation', source: [], content: { note: 'Cedar endpoint listens on port 8098' }, links: [], privacy: 'local', createdAt: '2026-09-08T00:00:00Z' })
      const body = memoryEffectBody(staged.memoryPut)
      const contentSha256 = createHash('sha256').update(body, 'utf8').digest('hex')
      writeFileSync(join(store, 'objects', `${contentSha256}.json`), body, { mode: 0o600 })
      const fields = { verdict: 'settled', key: staged.recordId, contentSha256, operation: 'memory.put', sequence: 1 }
      const hash = auraEntryHash(AURA_RECORD_DOMAIN, fields)
      writeFileSync(join(store, 'aura.jsonl'), `${JSON.stringify({ ...fields, prev: AURA_RECORD_DOMAIN, hash })}\n`, { mode: 0o600 })
      const issuerPk = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAA\n-----END PUBLIC KEY-----\n'
      writeFileSync(join(store, 'receipt-memory.put-001.json'), `${JSON.stringify({
        kind: 'aukora-kira-memory-receipt/v1', operation: 'memory.put', recordId: staged.recordId, effectDigest: contentSha256,
        nonce: '00000000-0000-4000-8000-000000000001', issuedAt: 1790000000,
        aura: { entryHash: hash, seq: 1, priorHead: null, head: hash }, sig: 'a'.repeat(128), issuerPk,
      }, null, 2)}\n`, { mode: 0o600 })
      writeFileSync(join(store, 'keys', `${staged.recordId}.json`), `${JSON.stringify({ key: staged.recordId, contentSha256 })}\n`, { mode: 0o600 })
      const anchor = join(work, 'export-store', 'issuer.pem')
      writeFileSync(anchor, issuerPk)
      const producerCommit = JSON.parse(readFileSync(join(release, '.dsh-build', 'genesis-artifacts.json'), 'utf8')).producer.genesisCommit
      const exported = spawnSync(process.execPath, [join(release, 'scripts/kira/public-evidence.mjs'), 'export', '--store', store, '--out', join(work, 'export-store', 'out'),
        '--producer-commit', producerCommit, '--release', release, '--anchor', `issuer=${anchor}`], { encoding: 'utf8', cwd: work })
      assert.equal(exported.status, 0, `the release's public-evidence.mjs export exited ${String(exported.status)}: ${`${exported.stdout}${exported.stderr}`.trim().split('\n').slice(-2).join(' | ').slice(0, 300)}`)
      const exportedText = filesUnder(join(work, 'export-store', 'out')).map(one => one.text).join('\n')
      assert.ok(exportedText.includes(staged.recordId), 'the export does not carry the approved record')
      process.stdout.write(`        node ${release}/scripts/kira/public-evidence.mjs export ... -> exit 0: ${exported.stdout.trim().split('\n')[0]}\n`)
      // EVERY RELATIVE IMPORT OF EVERY scripts/kira MODULE, followed to the end, resolves inside the release.
      const SPEC = /(?:^|[\s;}])(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gmu
      const queue = readdirSync(join(release, 'scripts/kira')).filter(name => name.endsWith('.mjs')).map(name => join(release, 'scripts/kira', name))
      const seen = new Set()
      const missing = []
      while (queue.length > 0) {
        const file = queue.pop()
        if (seen.has(file)) continue
        seen.add(file)
        const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '')
        for (const match of code.matchAll(SPEC)) {
          const target = resolve(dirname(file), match[1] ?? match[2])
          if (!existsSync(target)) missing.push(`${relative(release, target)} (from ${relative(release, file)})`)
          else queue.push(target)
        }
      }
      assert.deepEqual(missing, [], `scripts/kira imports files the release does not carry: ${missing.join(', ')}`)
      process.stdout.write(`        scripts/kira closure: ${String(seen.size)} module(s), every relative import inside the release\n`)
    })
  }

  if (runPlugin) {
    const { apply } = await load('plugins/aukora-kira/lib/index.js')
    const { KIRA_ROUTES } = await load('plugins/aukora-kira/lib/memory-routes.mjs')
    if (mutation !== null) {
      assert.equal(mutation.applied, 1, `mutant ${mutation.name} did not load its subject, so it reverted nothing`)
      process.stdout.write(`MUTANT ${mutation.name}: reverted the fix in ${mutation.file} (in memory only)\n`)
    }

    // A scratch home laid out like the deployment's: <home>/kira-memory is the store, <home>/sessions holds the events.
    const home = join(work, 'home')
    const stateDir = join(home, 'kira-memory')
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    const SUBJECT = `aukora:1:${'3c'.repeat(32)}`
    const TEXT_SESSION = 'session-live-path-text'
    const VOICE_SESSION = 'session-live-path-voice'

    // THE APPROVED CHAIN, as it stands before any capture (absent in a new store). A capture must never write into it.
    const approvedChainNow = () => (existsSync(join(stateDir, 'aura.jsonl')) ? readFileSync(join(stateDir, 'aura.jsonl'), 'utf8') : null)

    // THE TEXT SESSION, as the harness stores it: a zstd file of event lines, grown one owner turn at a time.
    const events = []
    const sessionFile = join(home, 'sessions', 'project', TEXT_SESSION, 'session.jsonl.zstd')
    mkdirSync(dirname(sessionFile), { recursive: true })
    let seq = 1
    let turn = 0
    const handlers = new Map()
    const routes = new Map()
    const warnings = []
    const on = name => handlers.get(name) ?? []
    /** One owner message in the text chat, then the agent's turn ends: the two hooks the harness fires. */
    const say = async content => {
      seq += 2
      turn += 1
      events.push({ type: 'user/message', seq, time: Date.parse('2026-09-27T10:00:00Z') + seq * 1000, data: { id: `msg-${String(seq)}`, content, source: { kind: 'user' } } })
      writeFileSync(sessionFile, zstdCompressSync(Buffer.from(events.map(one => `${JSON.stringify(one)}\n`).join(''))))
      for (const handler of on('agent/turn-stopping')) await handler({ agent: { session: { id: TEXT_SESSION } }, turn })
    }
    let voiceTurn = 0
    /** One heard Auma Live turn, in the shape the apps face emits (`plugins/aukora-face/apps/src/index.ts`). */
    const speak = async (ownerText, control = null) => {
      voiceTurn += 1
      const line = JSON.stringify({ spokenAt: '2026-09-27T11:00:00.000Z', ownerText, turn: voiceTurn })
      const payload = { sessionId: VOICE_SESSION, ownerText, text: 'Okay.', seq: voiceTurn, turn: voiceTurn, at: `2026-09-27T11:00:${String(voiceTurn).padStart(2, '0')}Z`, line, control, memoryInjected: [], spokenMemory: [] }
      for (const handler of on('auma/turn-finished')) await handler(payload)
    }
    /** Call a route the plugin mounted on the stand-in web server, as the Memory app does. */
    const call = async (method, path, body) => {
      const handler = routes.get(path.split('?')[0])
      assert.equal(typeof handler, 'function', `the plugin mounted no route at ${path}`)
      const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
      Object.assign(req, { method, url: path, headers: {} })
      let status = 0
      let text = ''
      const res = { set statusCode(value) { status = value }, get statusCode() { return status }, setHeader: () => {}, end: chunk => { text = String(chunk ?? '') } }
      await handler(req, res)
      return { status, body: text === '' ? null : JSON.parse(text) }
    }
    const listed = async tier => (await call('GET', `${KIRA_ROUTES.list}?tier=${tier}&limit=200`)).body.items

    // THE PLUGIN, MOUNTED as a composition mounts it, on a stand-in context that records what it subscribes and mounts.
    const reader = {
      listSessions: async () => [{ header: { id: TEXT_SESSION } }],
      readSurface: async () => ({ events: [...events] }),
    }
    const web = {
      get: name => (name === 'webServer' ? { register: ({ path, handler }) => { routes.set(path, handler); return () => {} } }
        : name === 'connection' ? { requestRejection: () => undefined } : undefined),
      effect: fn => fn(),
    }
    const ctx = {
      tools: { register: () => {} },
      on: (name, handler) => { handlers.set(name, [...on(name), handler]); return () => {} },
      emit: () => {},
      effect: fn => fn(),
      inject: (_names, callback) => callback(web),
      get: () => undefined,
      provide: () => {},
      reflect: { get: name => (name === 'sessionQuery' ? reader : undefined) },
      logger: { warn: line => warnings.push(String(line)), info: () => {}, debug: () => {} },
    }
    await apply(ctx, {
      memoryOwner: {
        stateDir, subject: SUBJECT, permittedPrivacy: ['local'],
        approvalFile: join(home, 'approval.json'), grantFile: join(home, 'grant.json'), queueDir: join(stateDir, 'queue'),
      },
    })
    const approvedChain = approvedChainNow()
    const rememberedWith = async words => (await listed('remembered')).filter(one => String(one.text).includes(words))

    // ── ARM 2: AUMA LIVE REACHES MEMORY ──────────────────────────────────────────────────────────────────────────────
    await arm(ARMS.auma, async () => {
      assert.ok(on('auma/turn-finished').length > 0, 'the mounted plugin does not listen for auma/turn-finished')
      await speak('I prefer my coffee black in the mornings.')
      const notes = await rememberedWith('coffee black')
      assert.ok(notes.length >= 1, `the spoken turn was not remembered (warnings: ${warnings.slice(-3).join(' | ')})`)
      assert.equal(notes[0].source?.sessionId, VOICE_SESSION, 'the note does not cite the Auma Live session')
    })

    // ── ARM 3: EVERY OWNER TURN ──────────────────────────────────────────────────────────────────────────────────────
    const PLAIN_TEXT = 'My sister Ana lands in Denpasar on Friday at noon.'
    const PLAIN_VOICE = 'The gate code for the villa is the year we met.'
    await arm(ARMS.everything, async () => {
      await say(PLAIN_TEXT)
      await say('continue')
      await say('continue')
      await speak(PLAIN_VOICE)
      const text = await rememberedWith(PLAIN_TEXT)
      assert.equal(text.length, 1, `an unmarked text-chat turn gave ${String(text.length)} note(s), not 1 (warnings: ${warnings.slice(-3).join(' | ')})`)
      assert.equal(text[0].text, PLAIN_TEXT, 'the note is not the owner\'s own words')
      assert.equal(text[0].tier, 'remembered')
      const again = (await listed('remembered')).filter(one => one.text === 'continue')
      assert.equal(again.length, 2, `two asks with the same words gave ${String(again.length)} note(s), not 2`)
      const voice = await rememberedWith(PLAIN_VOICE)
      assert.equal(voice.length, 1, `an unmarked Auma Live turn gave ${String(voice.length)} note(s), not 1`)
    })

    // ── ARM 3k: WHAT REMEMBERING EVERYTHING MUST STILL LEAVE OUT ─────────────────────────────────────────────────────
    await arm(ARMS.keeps, async () => {
      const secret = `sk-${'a1B2'.repeat(6)}`
      await say('Off the record, I prefer to keep my salary review with Maya out of this.')
      await say('[fable via lane door] run the courts again and report the survivors')
      await say(`Use the token ${secret} for the staging box.`)
      await speak('Stop remembering, the doctor said my knee needs surgery.', { intent: 'stop-remembering', matched: 'stop remembering' })
      const all = await listed('remembered')
      const joined = all.map(one => String(one.text)).join('\n')
      assert.ok(!/salary review/u.test(joined), 'an off-the-record text turn was remembered')
      assert.ok(!filesUnder(join(stateDir, 'queue')).some(one => one.text.includes('salary review')), 'an off-the-record text turn was queued for approval')
      assert.ok(!/survivors/u.test(joined), 'a lane-door message was remembered as the owner\'s turn')
      assert.ok(!joined.includes(secret), 'a turn carrying a secret-shaped token was remembered')
      assert.ok(!/knee needs surgery/u.test(joined), 'a stop-remembering voice turn was remembered')
      assert.ok(all.length >= 4, `vacuity: expected the earlier notes to be listed, got ${String(all.length)}`)
      for (const file of filesUnder(join(stateDir, 'remembered')).filter(one => one.path.endsWith('.json'))) {
        assert.equal(JSON.parse(file.text).grantsAuthority, false, `${basename(file.path)} does not say grantsAuthority: false`)
      }
      assert.equal(approvedChainNow(), approvedChain, 'a capture wrote into the approved chain aura.jsonl')
      const unsigned = readFileSync(join(stateDir, 'remembered', 'aura.jsonl'), 'utf8')
      assert.ok(all.every(one => unsigned.includes(String(one.id))), 'a remembered note has no entry in remembered/aura.jsonl')
    })

    // ── ARM 4a: THE DIRECTORY DECIDES THE TIER ───────────────────────────────────────────────────────────────────────
    await arm(ARMS.tier, async () => {
      const [target] = await rememberedWith(PLAIN_VOICE)
      assert.ok(target !== undefined, 'vacuity: the voice note to forge is not listed')
      const file = join(stateDir, 'remembered', `${String(target.id).slice(4)}.json`)
      const original = readFileSync(file, 'utf8')
      writeFileSync(file, `${JSON.stringify({ ...JSON.parse(original), tier: 'signed', label: 'signed' })}\n`)
      try {
        const signed = await listed('signed')
        assert.ok(!signed.some(one => one.id === target.id), 'a note file under remembered/ that says signed is listed as Signed')
        const remembered = (await listed('remembered')).filter(one => one.id === target.id)
        assert.equal(remembered.length, 1, 'a note file under remembered/ that says signed is not listed as Remembered')
        assert.equal(remembered[0].tier, 'remembered')
      } finally {
        writeFileSync(file, original)
      }
    })

    // ── ARM 4b: VERIFY READS THE CHAIN ───────────────────────────────────────────────────────────────────────────────
    await arm(ARMS.chain, async () => {
      const [note] = await rememberedWith(PLAIN_TEXT)
      assert.ok(note !== undefined, 'vacuity: the text note is not listed')
      const verify = async () => (await call('POST', KIRA_ROUTES.verify, { id: note.id })).body
      assert.equal((await verify()).source, 'VERIFIED', 'vacuity: the intact note does not verify')
      const chain = join(stateDir, 'remembered', 'aura.jsonl')
      const kept = `${chain}.kept`
      renameSync(chain, kept)
      let deleted
      try { deleted = await verify() } finally { renameSync(kept, chain) }
      assert.equal(deleted.source, 'MISSING', `with its chain deleted the note answered ${String(deleted.source)}`)
      const original = readFileSync(chain, 'utf8')
      const lines = original.trimEnd().split('\n')
      const at = lines.findIndex(line => line.includes(String(note.id)))
      assert.ok(at >= 0, 'vacuity: the note has no chain line')
      lines[at] = lines[at].replace(/"at":"[^"]+"/u, '"at":"2020-01-01T00:00:00Z"')
      writeFileSync(chain, `${lines.join('\n')}\n`)
      let rewritten
      try { rewritten = await verify() } finally { writeFileSync(chain, original) }
      assert.equal(rewritten.source, 'CHANGED', `with its chain entry rewritten the note answered ${String(rewritten.source)}`)
      assert.equal((await verify()).source, 'VERIFIED', 'the restored chain does not verify again')
    })

    // ── ARM 5: FORGET REACHES THE QUEUE COPY, AND SAYS WHAT IT DID NOT REACH ──────────────────────────────────────────
    await arm(ARMS.forget, async () => {
      const ASK = 'I prefer the quokka figurine hidden beneath the turquoise teapot'
      const WORDS = ['quokka', 'turquoise']
      await say(ASK)
      const queueDir = join(stateDir, 'queue')
      const queued = filesUnder(queueDir).filter(one => one.path.endsWith('.json') && WORDS.every(word => one.text.includes(word)))
      assert.equal(queued.length, 1, `vacuity: the auto-stage did not queue the ask (${String(queued.length)} copies)`)
      // A SET-ASIDE COPY, where `scripts/kira/migrate-queue.mjs --apply` puts one.
      const aside = join(stateDir, 'queue-backup-2026-09-27T00-00-00Z')
      mkdirSync(aside, { recursive: true })
      cpSync(queued[0].path, join(aside, basename(queued[0].path)))
      const notes = await rememberedWith('quokka')
      assert.ok(notes.length >= 1, 'vacuity: the ask was not remembered')
      const answers = []
      for (const note of notes) answers.push((await call('POST', KIRA_ROUTES.forget, { id: note.id })).body)
      assert.ok(answers.every(one => one?.forgotten === true), `a forget did not complete: ${JSON.stringify(answers).slice(0, 200)}`)
      assert.ok(!existsSync(queued[0].path), 'the auto-staged queue copy of the forgotten words is still in queue/')
      const left = filesUnder(stateDir).filter(one => WORDS.some(word => one.text.includes(word))).map(one => relative(stateDir, one.path))
      assert.deepEqual(left, [relative(stateDir, join(aside, basename(queued[0].path)))], `the words are still in the store outside the set-aside copy: ${left.join(', ')}`)
      const notReached = answers.flatMap(one => one.notReached ?? [])
      assert.ok(notReached.some(one => one.what === 'set-aside-copy' && String(one.ref).startsWith('queue-backup-')), 'the answer does not name the set-aside copy')
      assert.ok(notReached.some(one => one.what === 'session-log' && String(one.ref).includes(TEXT_SESSION)), 'the answer does not name the session log')
    })
  }
} finally {
  // ONLY THE DIRECTORY THIS RUN CREATED: a mkdtemp child of the temp directory with this check's own prefix.
  if (dirname(work) === resolve(tmpdir()) && basename(work).startsWith('kira-memory-live-path-')) rmSync(work, { recursive: true, force: true })
}

const total = passed + failures
const expected = (runRelease ? 1 : 0) + (runPlugin ? 6 : 0)
process.stdout.write(`KIRA MEMORY LIVE PATH: ${failures === 0 && total === expected ? 'GREEN' : 'RED'} — ${String(passed)}/${String(total)} arms\n`)
process.exit(failures === 0 && total === expected ? 0 : 1)
