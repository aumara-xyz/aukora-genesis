/**
 * courts/harness/executable-configuration — a governed composition carries
 * configuration, not code.
 *
 * THE AMENDMENT RULE THIS SERVES. "The agent may propose a new composition,
 * but nothing inside its current authority closure may activate, widen,
 * reinterpret, or replace the composition governing that same run." A `!!js`
 * scalar in a governed config field is that rule broken at the root. The
 * composition does not merely DESCRIBE the run — it RUNS, with the launcher's
 * privilege, in the launcher's process, at the moment the row's config is
 * resolved, which is before any confinement is measured, before the broker
 * exists, before a grant is minted and before a receipt can record anything.
 * The supervisor's job in the launch ceremony is to supply LITERAL
 * configuration before starting the guest under its separate principal. An
 * expression node is not literal configuration; it is code the privileged
 * launcher executes on the guest's behalf.
 *
 * WHY THE COURT INJECTS ITS OWN EXPRESSION INSTEAD OF FIRING THE SHIPPED ONE.
 * The shipped `!!js` reads `process.env` and returns a socket path, which is
 * harmless and therefore proves nothing. The property under test is not "the
 * shipped expression is dangerous"; it is "a governed config field is an
 * execution site". So the court stages a VERBATIM copy of the governed profile
 * in the system temp directory — whatever marks that profile governed travels
 * with the copy — drops the expressions the shipped layer already carries so
 * the staged composition has exactly one executable value, injects that one,
 * and boots the real launcher against it. The injected expression's only act is
 * to write a file into that same temp directory: no network, no repository
 * write, no key material, nothing outside the temp tree.
 *
 *   X1  the citation    vendor/loader/src/config/utils.ts:5 — `new Function` + `eval`
 *   X2  no allowlist    the expression runs in the launcher process with the whole runtime
 *   X3  the shipped file the governed composition carries no executable config field
 *   X4  the control     the same staged composition with a LITERAL boots and writes nothing
 *   X5  it executes     a `!!js` scalar in a governed config field runs during boot
 *   X6  before the tree the side effect lands on a boot that produces no tree at all
 *   X7  or don't boot   a governed composition carrying `!!js` refuses, by name
 *   X8  not a blanket   a NON-governed profile still evaluates `!!js` and is not refused
 *   X9  read-only       the repository is byte-identical to how the court found it
 *   X10 limitation      what this court does not measure
 *
 * X4 EXISTS BECAUSE A FAILED BOOT IS NOT A REFUSAL. A staging mistake — an
 * unresolvable package, a mistyped row — also exits non-zero, also prints a
 * diagnostic naming the profile, and would let X7 read `REFUSED` while nothing
 * had been refused. X4 boots the identical staged tree with a literal in the
 * identical field: if X4 does not reach a live, idling composition, every
 * verdict below it is an artifact of staging and must be read as such.
 *
 * --mutate runs three evasions, each a door into the SAME governed composition
 * that a text-level or one-file fix would leave open, and each must reach the
 * same verdict as X5/X7:
 *   M1 the expression in a DIFFERENT governed config field — the property is
 *      the field class, not one hardcoded key;
 *   M2 the expression delivered through the HOME layer
 *      ($DSH_HOME/cordis.patch.yml), which composes over every profile and
 *      which the governed profile's own file does not contain;
 *   M3 the expression on a row's `disabled:` slot, which the Loader evaluates
 *      through the same evaluator (vendor/loader/src/config/entry.ts) and
 *      which is not in `config` at all.
 *
 *   node courts/harness/executable-configuration/run.mjs
 *   node courts/harness/executable-configuration/run.mjs --mutate
 *
 * Exit 77 (skipped by design) when the built launcher is absent: this court
 * boots `apps/cli/lib/bin.js`, and without it the court measured nothing — it
 * must report neither green nor breach.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import yaml from 'js-yaml'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')

const MUTATE = process.argv.includes('--mutate')

/** The launcher this court boots. Built by `pnpm build:lib:host`. */
const LAUNCHER = join(ROOT, 'apps/cli/lib/bin.js')
/** The governed profile: the composition the supervisor hands the 8088 guest. */
const GOVERNED = '8088-inside-out'
const GOVERNED_DIR = join(ROOT, 'profiles', GOVERNED)
/** The vendored evaluator row X1 cites. */
const LOADER_UTILS = join(ROOT, 'vendor/loader/src/config/utils.ts')
/** The include dialect that reads a `!!js` scalar as an expression node, and writes it back. */
const INCLUDE_LIB = join(ROOT, 'vendor/include/lib/index.js')
/** The per-profile user layer filename — and the home layer filename; the same name in two places. */
const PATCH_FILENAME = 'cordis.patch.yml'
/** The row this court injects into: the governed effect itself. */
const PREFERRED_ROW = 'aukora-memory'
/** The config field the primary rows inject into. */
const PRIMARY_FIELD = 'brokerSocket'
/** A second governed config field, for the --mutate arm. */
const ALTERNATE_FIELD = 'issuerSocket'
/** The literal a probe expression returns, so the row it sits on still mounts. */
const LITERAL_SOCKET = '/run/aukora/broker.sock'
/** A boot that neither executes nor refuses IDLES; it is killed here rather than hanging the gate. */
const BOOT_DEADLINE_MS = 10000
/** Grace after the marker appears, so a launcher that fails loud still reports its own exit code. */
const MARKER_GRACE_MS = 750

if (!existsSync(LAUNCHER)) {
  console.log('\n  courts/harness/executable-configuration — SKIPPED BY DESIGN\n')
  console.log(`  this court boots the real launcher and ${relative(ROOT, LAUNCHER)} is not built.`)
  console.log("  run 'pnpm build:lib:host', then run it again. It measured nothing.\n")
  process.exit(77)
}

const { entryListSchema } = await import(INCLUDE_LIB)

const TMP = mkdtempSync(join(tmpdir(), 'aukora-execconfig-'))
const RUN_TAG = randomBytes(6).toString('hex')

const EXPECTED_ROWS = Object.freeze(['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10'])
const rows = []
const row = (n, label, observed, expected) => {
  rows.push({ n, label, observed, expected, breach: JSON.stringify(observed) !== JSON.stringify(expected) })
}

/** Require every ordinary row exactly once. */
const rowsComplete = () => {
  const names = new Set(rows.map(({ n }) => n))
  return rows.length === EXPECTED_ROWS.length
    && names.size === EXPECTED_ROWS.length
    && EXPECTED_ROWS.every((name) => names.has(name))
}

/** Require only the four currently reproduced executable-config breaches. */
const mutationRowsMatch = (expectedBreaches) => {
  const expected = new Set(expectedBreaches)
  const names = new Set(rows.map(({ n }) => n))
  return rowsComplete()
    && expected.size === expectedBreaches.length
    && names.size === rows.length
    && expectedBreaches.every((name) => names.has(name))
    && rows.every(({ n, breach }) => breach === expected.has(n))
}

/**
 * Byte-level fingerprint of everything this court reads out of the repository.
 * Row X9 compares it against the same fingerprint taken at the end. The court
 * copies and never edits; X9 is where that promise is checked rather than
 * asserted, and the same check gates both exit paths.
 * @returns the digest over the governed profile's files and the vendored evaluator.
 */
const repoFingerprint = () => {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules') continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files.push([relative(ROOT, path), createHash('sha256').update(readFileSync(path)).digest('hex')])
    }
  }
  walk(GOVERNED_DIR)
  files.push([relative(ROOT, LOADER_UTILS), createHash('sha256').update(readFileSync(LOADER_UTILS)).digest('hex')])
  return createHash('sha256').update(JSON.stringify(files)).digest('hex')
}
const FINGERPRINT_BEFORE = repoFingerprint()

/**
 * Leave the machine as the court found it, on every exit path including a
 * thrown one: drop the temp tree and shout if the repository moved.
 * @param code - the exit status to leave in place.
 */
const leave = (code) => {
  const clean = repoFingerprint() === FINGERPRINT_BEFORE
  if (!clean) {
    console.error('\n  *** THE REPOSITORY CHANGED UNDER THIS COURT — inspect it before trusting anything above ***\n')
  }
  rmSync(TMP, { recursive: true, force: true })
  process.exit(clean ? code : 1)
}

// ---------------------------------------------------------------------------
// Expression payloads. Every one writes only into TMP.
// ---------------------------------------------------------------------------

/**
 * The benign probe: record what the evaluator could reach, then return the
 * literal the shipped expression would have returned, so the row it sits on
 * still mounts exactly as the governed composition intends.
 * @param markerPath - the temp file the expression writes.
 * @returns the expression source, on one line so the YAML round trip is lossless.
 */
const probeExpression = markerPath => [
  '(function () {',
  "var fs = process.getBuiltinModule('fs');",
  `fs.writeFileSync(${JSON.stringify(markerPath)}, JSON.stringify({`,
  'pid: process.pid,',
  'fsWrite: typeof fs.writeFileSync,',
  "spawnSync: typeof process.getBuiltinModule('child_process').spawnSync,",
  "netConnect: typeof process.getBuiltinModule('net').connect,",
  "envReadable: typeof process.env.PATH === 'string'",
  '}));',
  `return ${JSON.stringify(LITERAL_SOCKET)};`,
  '})()',
].join(' ')

/** The token an evaluated-then-thrown expression leaves in the launcher's own diagnostic. */
const THROW_TOKEN = `AUKORA-COURT-EXECUTED-${RUN_TAG}`

/**
 * The ordering probe: land the side effect, then throw. The throw is what makes
 * row X6 falsifiable — the row never mounts and the tree never settles, so
 * whatever the marker records happened before the composition existed at all.
 * @param markerPath - the temp file the expression writes.
 * @returns the expression source.
 */
const throwExpression = markerPath => [
  '(function () {',
  `process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(markerPath)}, 'executed');`,
  `throw new Error(${JSON.stringify(THROW_TOKEN)});`,
  '})()',
].join(' ')

/**
 * The `disabled:` variant: the same side effect, returning false so the row
 * still mounts and the verdict stays comparable with the primary boot.
 * @param markerPath - the temp file the expression writes.
 * @returns the expression source.
 */
const disabledExpression = markerPath => [
  '(function () {',
  `process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(markerPath)}, 'executed');`,
  'return false;',
  '})()',
].join(' ')

// ---------------------------------------------------------------------------
// Staging: verbatim copies of the real profile, one scalar replaced.
// ---------------------------------------------------------------------------

/**
 * Copy a profile directory into a staged `$DSH_HOME`. The copy is VERBATIM —
 * whatever marks this profile governed (its name, its manifest, a file a later
 * fix adds) travels with it. Any installed module tree is replaced by a link to
 * the repository's, so the staged profile resolves exactly the packages the
 * real one does: a staged tree that cannot resolve its plugins fails the boot
 * for a reason that has nothing to do with executable config, and row X4 exists
 * to catch that.
 * @param home - the staged `$DSH_HOME`.
 * @param name - the profile name to stage under.
 * @param source - the real profile directory to copy.
 * @returns the staged profile directory.
 */
const stageProfile = (home, name, source) => {
  const dir = join(home, 'profiles', name)
  mkdirSync(dirname(dir), { recursive: true })
  cpSync(source, dir, { recursive: true, filter: src => basename(src) !== 'node_modules' })
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
  return dir
}

/** Parse a patch file in the exact dialect the include mounts. */
const readPatches = path => yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema }) ?? []
/** Write a patch list back in that dialect, so an expression node re-emits as `!!js`. */
const writePatches = (path, patches) => writeFileSync(path, yaml.dump(patches, { schema: entryListSchema }), 'utf8')

/**
 * Drop every expression node the SHIPPED layer already carries, so the only
 * executable value in a staged composition is the one this court injects.
 *
 * Without this the control boot (X4) would still carry the shipped `!!js` and a
 * CORRECT fix would refuse the control — a false breach on the one row whose
 * job is to be clean. Dropping the key rather than guessing a replacement keeps
 * the court blind to what the field means; a field that turns out to be
 * required fails the control boot loudly, which is the honest outcome.
 * @param patchPath - the staged patch file.
 * @returns the config paths dropped.
 */
const literalizeShipped = (patchPath) => {
  const dropped = []
  const strip = (node, path) => {
    if (node === null || typeof node !== 'object') return
    const isExpr = value => value !== null && typeof value === 'object' && '__jsExpr' in value
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) {
        if (isExpr(node[i])) { dropped.push(`${path}[${i}]`); node.splice(i, 1) } else strip(node[i], `${path}[${i}]`)
      }
      return
    }
    for (const [key, value] of Object.entries(node)) {
      const here = path === '' ? String(key) : `${path}.${key}`
      if (isExpr(value)) { dropped.push(here); delete node[key] } else strip(value, here)
    }
  }
  const patches = readPatches(patchPath)
  strip(patches, '')
  writePatches(patchPath, patches)
  return dropped
}

/**
 * Locate the insert row this court injects into: the governed effect when it is
 * present, otherwise the first identified insert row in the layer.
 * @param patches - the parsed patch list.
 * @returns the row object, or `undefined` when the layer inserts nothing identified.
 */
const findInjectionRow = (patches) => {
  const inserts = []
  for (const patch of patches) {
    for (const entry of patch?.insert ?? []) {
      if (typeof entry?.id === 'string') inserts.push(entry)
    }
  }
  return inserts.find(entry => entry.id === PREFERRED_ROW) ?? inserts[0]
}

/**
 * Put a value into the governed row and write the layer back.
 * @param patchPath - the staged patch file.
 * @param slot - `'config'` for a config field, `'disabled'` for the entry slot.
 * @param field - the config key, ignored when `slot` is `'disabled'`.
 * @param value - an expression node, or a plain string for the X4 control.
 * @returns the injected row id.
 */
const injectInto = (patchPath, slot, field, value) => {
  const patches = readPatches(patchPath)
  const target = findInjectionRow(patches)
  if (target === undefined) {
    throw new Error(`${GOVERNED}: the composition inserts no identified row; re-anchor this court`)
  }
  if (slot === 'disabled') target.disabled = value
  else target.config = { ...(target.config ?? {}), [field]: value }
  writePatches(patchPath, patches)
  return target.id
}

// ---------------------------------------------------------------------------
// The boot instrument.
// ---------------------------------------------------------------------------

/**
 * Boot one profile through the real launcher and report what happened.
 *
 * A governed launch that neither executes nor refuses IDLES — the composition
 * is a tool surface with no runner — so the wait is bounded and a survivor
 * reports `SURVIVED` rather than hanging the gate. The marker is polled rather
 * than awaited and the kill is delayed by a grace window, so a launcher that
 * exits on its own always reports its own exit code first.
 * @param options - staged home, profile name, and the marker file the expression writes.
 * @returns the verdict, exit code, marker payload, and the launcher's stderr.
 */
const bootProfile = async ({ home, name, markerPath }) => {
  const env = { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' }
  for (const [key, value] of Object.entries(process.env)) {
    // The child inherits no ambient AUKORA/DSH/DeepSeek state: this court
    // grades the composition, not the operator's shell.
    if (key.startsWith('AUKORA_') || key.startsWith('DSH_') || key.startsWith('DEEPSEEK_')) continue
    env[key] = value
  }
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [LAUNCHER, '--profile', name], {
      cwd: TMP, env, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let settled = false
    let markerSeen = false
    const poll = setInterval(() => {
      if (markerSeen || !existsSync(markerPath)) return
      markerSeen = true
      const grace = setTimeout(() => child.kill('SIGKILL'), MARKER_GRACE_MS)
      if (typeof grace.unref === 'function') grace.unref()
    }, 20)
    const deadline = setTimeout(() => child.kill('SIGKILL'), BOOT_DEADLINE_MS)
    if (typeof deadline.unref === 'function') deadline.unref()
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(deadline)
      const executed = existsSync(markerPath)
      let payload = null
      if (executed) {
        try { payload = JSON.parse(readFileSync(markerPath, 'utf8')) } catch { payload = 'opaque' }
      }
      resolve({
        // EXECUTED outranks every other outcome: whatever else the launcher
        // did, the composition ran code. REFUSED is a self-chosen non-zero exit
        // with no side effect. SURVIVED is the live idling tool surface this
        // profile is meant to be.
        verdict: executed ? 'EXECUTED' : code === null ? 'SURVIVED' : code === 0 ? 'BOOTED' : 'REFUSED',
        executed,
        code,
        payload,
        stderr,
        exitedOnItsOwn: code !== null,
        pid: child.pid,
      })
    })
  })
}

/**
 * Does a refusal NAME what it refused? Not a string match on wording this court
 * cannot know, but the three facts any honest refusal carries: the file the
 * executable config arrived in, the row or field that held it, and the
 * composition it governs.
 * @param stderr - the launcher's diagnostic.
 * @param field - the config key the court injected into.
 * @param rowId - the row id the court injected into.
 * @returns the three name checks.
 */
const namesTheOffence = (stderr, field, rowId) => ({
  namesTheFile: stderr.includes(PATCH_FILENAME),
  namesTheSite: stderr.includes(field) || stderr.includes(rowId),
  namesTheProfile: stderr.includes(GOVERNED),
})

// ---------------------------------------------------------------------------
// The boots. Staged first, graded below, so the rows print in reading order.
// ---------------------------------------------------------------------------

/**
 * Stage the governed profile under a fresh home, cleaned of the shipped
 * expressions, ready for exactly one injection.
 * @param label - the temp subdirectory name.
 * @returns the staged home, the staged patch file, and the dropped shipped expressions.
 */
const stageGoverned = (label) => {
  const home = join(TMP, label)
  const patchPath = join(stageProfile(home, GOVERNED, GOVERNED_DIR), PATCH_FILENAME)
  return { home, patchPath, dropped: literalizeShipped(patchPath) }
}

// The control: the staged tree, a LITERAL in the field the primary uses.
const controlMarker = join(TMP, 'marker-control.json')
const staged = stageGoverned('control')
const DROPPED_FROM_SHIPPED = staged.dropped
injectInto(staged.patchPath, 'config', PRIMARY_FIELD, probeExpression(controlMarker))
const control = await bootProfile({ home: staged.home, name: GOVERNED, markerPath: controlMarker })

// The primary: the identical staged tree, the identical payload as `!!js`.
const primaryMarker = join(TMP, 'marker-primary.json')
const primaryStage = stageGoverned('primary')
const INJECTED_ROW = injectInto(
  primaryStage.patchPath, 'config', PRIMARY_FIELD, { __jsExpr: probeExpression(primaryMarker) },
)
const primary = await bootProfile({ home: primaryStage.home, name: GOVERNED, markerPath: primaryMarker })

// The ordering probe: side effect, then throw.
const earlyMarker = join(TMP, 'marker-early')
const earlyStage = stageGoverned('early')
injectInto(earlyStage.patchPath, 'config', PRIMARY_FIELD, { __jsExpr: throwExpression(earlyMarker) })
const early = await bootProfile({ home: earlyStage.home, name: GOVERNED, markerPath: earlyMarker })

// The over-reach guard: a profile that is not the governed one.
const openHome = join(TMP, 'ungoverned')
const openMarker = join(TMP, 'marker-ungoverned.json')
const openDir = join(openHome, 'profiles', 'court-ungoverned')
mkdirSync(openDir, { recursive: true })
symlinkSync(join(ROOT, 'node_modules'), join(openDir, 'node_modules'), 'dir')
writeFileSync(join(openDir, 'package.json'), `${JSON.stringify({
  name: 'dsh-profile-court-ungoverned', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
}, null, 2)}\n`, 'utf8')
writePatches(join(openDir, PATCH_FILENAME), [{
  insert: [{
    id: 'system-prompt',
    name: '@deepseek-ai/dsh-system-prompt',
    config: { persona: { __jsExpr: probeExpression(openMarker) } },
  }],
}])
const open = await bootProfile({ home: openHome, name: 'court-ungoverned', markerPath: openMarker })

// ---------------------------------------------------------------------------
// X1 — the citation. A drift anchor: if the vendored evaluator moves, re-cite it.
// ---------------------------------------------------------------------------
{
  const text = readFileSync(LOADER_UTILS, 'utf8')
  const lines = text.split('\n')
  const index = lines.findIndex(line => line.includes('export const evaluate') && line.includes('new Function'))
  row('X1', 'the loader evaluates config through new Function + eval', {
    file: relative(ROOT, LOADER_UTILS),
    line: index + 1,
    newFunctionOfCtxAndExpr: /new Function\(\s*'ctx',\s*'expr'/.test(text),
    withScope: /with \(ctx\)/.test(text),
    returnsEval: /return eval\(expr\)/.test(text),
  }, {
    file: 'vendor/loader/src/config/utils.ts',
    line: 5,
    newFunctionOfCtxAndExpr: true,
    withScope: true,
    returnsEval: true,
  })
}

// ---------------------------------------------------------------------------
// X2 — what the evaluator reaches, measured from the boot that must keep
// working whatever the fix does. No allowlist, no sandbox, no separate process.
// ---------------------------------------------------------------------------
{
  const p = open.payload
  row('X2', 'the evaluator runs in the launcher process with the whole runtime', {
    sameProcessAsTheLauncher: typeof p?.pid === 'number' && p.pid === open.pid,
    fsWrite: p?.fsWrite ?? null,
    spawnSync: p?.spawnSync ?? null,
    netConnect: p?.netConnect ?? null,
    envReadable: p?.envReadable ?? null,
  }, {
    sameProcessAsTheLauncher: true,
    fsWrite: 'function',
    spawnSync: 'function',
    netConnect: 'function',
    envReadable: true,
  })
}

// ---------------------------------------------------------------------------
// X3 — the shipped governed file, read where it lives, never written.
// ---------------------------------------------------------------------------
const shippedPatchPath = join(GOVERNED_DIR, PATCH_FILENAME)
{
  const carriers = []
  const walk = (node, path) => {
    if (node === null || typeof node !== 'object') return
    if ('__jsExpr' in node) { carriers.push(path); return }
    for (const [key, value] of Object.entries(node)) {
      walk(value, path === '' ? String(key) : `${path}.${key}`)
    }
  }
  if (existsSync(shippedPatchPath)) walk(readPatches(shippedPatchPath), '')
  row('X3', 'the governed composition carries no executable config field', {
    file: relative(ROOT, shippedPatchPath),
    executableFields: carriers.map(path => path.split('.').at(-1)).sort(),
  }, {
    file: relative(ROOT, shippedPatchPath),
    executableFields: [],
  })
}

// ---------------------------------------------------------------------------
// X4 — the control. Read this before X5/X6/X7: it is what makes their verdicts
// mean anything.
// ---------------------------------------------------------------------------
row('X4', 'the same staged composition with a LITERAL boots and writes nothing', {
  injectedInto: `${INJECTED_ROW}.config.${PRIMARY_FIELD}`,
  verdict: control.verdict,
  executed: control.executed,
}, {
  injectedInto: `${INJECTED_ROW}.config.${PRIMARY_FIELD}`,
  verdict: 'SURVIVED',
  executed: false,
})

// ---------------------------------------------------------------------------
// X5, X7 — the primary boot: does the scalar run, and is the launch refused?
// ---------------------------------------------------------------------------
row('X5', 'a !!js scalar in a governed config field does not execute during boot', {
  injectedInto: `${INJECTED_ROW}.config.${PRIMARY_FIELD}`,
  executed: primary.executed,
  sideEffect: primary.executed ? 'a file this court did not write through any tool' : 'none',
}, {
  injectedInto: `${INJECTED_ROW}.config.${PRIMARY_FIELD}`,
  executed: false,
  sideEffect: 'none',
})

// ---------------------------------------------------------------------------
// X6 — the ordering, made falsifiable: the expression throws, so the row never
// mounts and the tree never settles. Anything the marker recorded happened
// before there was a composition for it to belong to.
// ---------------------------------------------------------------------------
row('X6', 'no side effect lands on a boot that produces no plugin tree', {
  executed: early.executed,
  tokenReachedTheLauncherDiagnostic: early.stderr.includes(THROW_TOKEN),
  ranOnABootThatProducedNoTree: early.executed && early.exitedOnItsOwn && early.code !== 0,
}, {
  executed: false,
  tokenReachedTheLauncherDiagnostic: false,
  ranOnABootThatProducedNoTree: false,
})

row('X7', 'a governed composition carrying !!js refuses to boot, by name', {
  verdict: primary.verdict,
  ...namesTheOffence(primary.stderr, PRIMARY_FIELD, INJECTED_ROW),
}, {
  verdict: 'REFUSED',
  namesTheFile: true,
  namesTheSite: true,
  namesTheProfile: true,
})

// ---------------------------------------------------------------------------
// X8 — the over-reach guard. cordis.yml documents `!!js` as a supported loader
// feature; a non-governed profile keeps it. A fix that bans the tag globally
// fails HERE, and it should.
// ---------------------------------------------------------------------------
row('X8', 'a non-governed profile still evaluates !!js and is not refused', {
  verdict: open.verdict,
  executed: open.executed,
  refused: open.exitedOnItsOwn && open.code !== 0,
}, {
  verdict: 'EXECUTED',
  executed: true,
  refused: false,
})

// ---------------------------------------------------------------------------
// X9 — the read-only promise, checked rather than asserted.
// ---------------------------------------------------------------------------
row('X9', 'the repository is byte-identical to how this court found it', {
  governedProfileAndEvaluatorUnchanged: repoFingerprint() === FINGERPRINT_BEFORE,
  everythingStagedUnderTheTempDir: TMP.startsWith(tmpdir()),
}, {
  governedProfileAndEvaluatorUnchanged: true,
  everythingStagedUnderTheTempDir: true,
})

// ---------------------------------------------------------------------------
// X10 — the limitation, recorded rather than implied.
// ---------------------------------------------------------------------------
row('X10', 'what this court does not measure, stated', {
  gradesTheLauncherNotTheSupervisorCeremony: true,
  stagesACopyUnderAFreshHomeNotTheOperatorHome: true,
  platform: process.platform,
}, {
  gradesTheLauncherNotTheSupervisorCeremony: true,
  stagesACopyUnderAFreshHomeNotTheOperatorHome: true,
  platform: process.platform,
})

console.log('\n  courts/harness/executable-configuration — governed config is data, or no boot\n  ' + '-'.repeat(72))
for (const r of rows) {
  console.log(`  ${r.n.padEnd(5)}${String(r.label).padEnd(61)} ${r.breach ? '*** BREACH ***' : 'held'}  ${JSON.stringify(r.observed).slice(0, 150)}`)
}
console.log(`
  READ X4 FIRST. A failed boot is not a refusal. X4 boots the identical staged
  tree with a literal in the identical field; only because it reaches a live
  idling composition can X7's verdict be read as a refusal rather than as a
  staging accident.

  READ X5/X6/X7 TOGETHER. Each is one boot of the SAME governed composition the
  supervisor hands the 8088 guest, staged verbatim under
  ${TMP}
  with one scalar replaced. X5 asks whether the scalar ran. X6 makes the
  ordering falsifiable by throwing after the side effect: the row never mounts,
  the tree never settles, and the marker is still on disk — so the code ran
  before there was a composition for it to belong to, which is before every
  confinement, broker, grant and receipt in this system. X7 asks for the only
  acceptable answer: refuse the launch and name what was refused.

  The staged copies carry no shipped expression: ${JSON.stringify(DROPPED_FROM_SHIPPED)}
  was dropped from each staged layer, so the only executable value in any boot
  above is the one this court injected, and X4's clean control means what it says.

  X8 is the guard against the wrong fix. cordis.yml documents !!js as a
  supported loader feature and a non-governed profile must keep it. The property
  is not "expressions are forbidden"; it is "a GOVERNED composition carries no
  execution site".`)

if (MUTATE) {
  // Three evasions, each a door into the same governed composition. A sabotage
  // that only reimplements a predicate inside the court proves the court can
  // write `false`; these boot the real launcher against a real staged tree, and
  // each must reach the verdict the primary boot reached.
  const target = primary.verdict

  // M1 — the same expression in a DIFFERENT governed config field.
  const altMarker = join(TMP, 'marker-field.json')
  const altStage = stageGoverned('mutant-field')
  injectInto(altStage.patchPath, 'config', PRIMARY_FIELD, LITERAL_SOCKET)
  injectInto(altStage.patchPath, 'config', ALTERNATE_FIELD, { __jsExpr: probeExpression(altMarker) })
  const alt = await bootProfile({ home: altStage.home, name: GOVERNED, markerPath: altMarker })
  const m1 = alt.verdict === target

  // M2 — the second door. The governed profile's own layer carries nothing
  // executable and the expression arrives through the home layer, which
  // composes over every profile. A fix that only scrubs the profile's own layer
  // leaves this open.
  const layerMarker = join(TMP, 'marker-home-layer.json')
  const layerStage = stageGoverned('mutant-home-layer')
  writePatches(join(layerStage.home, PATCH_FILENAME), [{
    id: INJECTED_ROW,
    config: { [PRIMARY_FIELD]: { __jsExpr: probeExpression(layerMarker) } },
  }])
  const layer = await bootProfile({ home: layerStage.home, name: GOVERNED, markerPath: layerMarker })
  const m2 = layer.verdict === target

  // M3 — the third door. `disabled:` is evaluated by the same evaluator and is
  // not a config field at all, so a fix that walks `config` alone misses it.
  const slotMarker = join(TMP, 'marker-disabled')
  const slotStage = stageGoverned('mutant-disabled')
  injectInto(slotStage.patchPath, 'config', PRIMARY_FIELD, LITERAL_SOCKET)
  injectInto(slotStage.patchPath, 'disabled', null, { __jsExpr: disabledExpression(slotMarker) })
  const slot = await bootProfile({ home: slotStage.home, name: GOVERNED, markerPath: slotMarker })
  const m3 = slot.verdict === target

  const expectedBreaches = ['X1', 'X5', 'X6', 'X7']
  const ordinaryRowsMatched = mutationRowsMatch(expectedBreaches)
  const detected = m1 && m2 && m3 && ordinaryRowsMatched
  console.log(`\n  MUTATION second governed config field   ${alt.verdict} vs ${target}   ${m1 ? 'DETECTED' : 'NOT DETECTED'}`)
  console.log(`  MUTATION home layer, profile verbatim  ${layer.verdict} vs ${target}   ${m2 ? 'DETECTED' : 'NOT DETECTED'}`)
  console.log(`  MUTATION the disabled: slot            ${slot.verdict} vs ${target}   ${m3 ? 'DETECTED' : 'NOT DETECTED'}\n`)
  console.log(`  MUTATION ordinary-row oracle           expectedBreaches=[${expectedBreaches.join(' ')}] matched=${ordinaryRowsMatched}\n`)
  leave(detected ? 0 : 1)
}

console.log('\n  observationClass: SELF-REPORTED\n')
leave(rows.some(r => r.breach) || !rowsComplete() ? 1 : 0)
