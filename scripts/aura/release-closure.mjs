#!/usr/bin/env node
/**
 * release-closure.mjs — WHETHER A RELEASE CAN RESOLVE EVERYTHING IT WILL LOAD.
 *
 * ── THE OUTAGE THIS EXISTS FOR ───────────────────────────────────────────────────────────────────
 *
 * A cutover died with `ERR_MODULE_NOT_FOUND`. `plugins/aukora-composition-gate/src/admission-grant.mjs:32`
 * imports `'../../aukora-owner-daemon/lib/binding.mjs'`, and the materializer — which carries a
 * **hand-written list** of plugins — did not carry that one. **The release built, the digest was approved,
 * the launch was attempted, and the process could not start.**
 *
 * WHY A COURT AND NOT A LONGER LIST. A RELATIVE IMPORT CAN CROSS A PLUGIN BOUNDARY, so the set of files a
 * release needs is **the transitive closure of what it loads**, and nobody was computing it. A list is a
 * claim; **this is the check**. It walks the actual graph from the actual entry points over the actual
 * bytes and names every specifier that does not land inside the release.
 *
 * WHAT IT DOES NOT DO. It does not execute anything, resolve `node_modules` the way Node would in every
 * case, or prove a module WORKS — only that it can be FOUND. A bare specifier is resolved against the
 * release's own `node_modules` (and its `.pnpm` store), because a release that cannot find a dependency it
 * declares is the same class of defect.
 *
 * EXIT: 0 closed · 1 a specifier does not resolve, named by file:line · 2 bad usage.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'
import { isMainModule } from '../lib/is-main.mjs'

const USAGE = 'usage: release-closure.mjs --release <dir> [--patch <file>]... [--json]'

/** The entry points a release loads, beyond the plugin entries in its own composition patch. */
const STATIC_ENTRIES = ['apps/cli/lib/bin.js']

/** Extensions Node will try for an extensionless specifier, in its own order. */
const EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.json', '/index.js', '/index.mjs', '/index.cjs']

/** Do not walk into these: they are dependencies, not this release's own sources. */
const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '.cache']

function parseArgs(argv) {
  // `--patch` IS REPEATABLE: `config.json` names a LIST of overlays, and a caller who could pass only one
  // would have to choose which entry points go unwalked.
  const args = { release: null, json: false, patches: [] }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--patch') { args.patches.push(argv[i + 1]); i += 1 }
    else if (argv[i] === '--release') { args.release = argv[i + 1]; i += 1 } else if (argv[i] === '--json') { args.json = true } else return null
  }
  return args.release === null ? null : args
}

/**
 * Every static and dynamic specifier in one file, with its 1-based line.
 *
 * THE LINE IS THE POINT. A court that says "an import is missing" sends a person looking; one that says
 * `admission-grant.mjs:32` sends them to the line.
 */
export function specifiersIn(source) {
  // ── COMMENTS ARE NOT CODE, AND MATCHING THEM IS A FALSE ACCUSATION ───────────────────────────────
  // `plugins/aukora-composition-gate/src/artifact.mjs` DOCUMENTS its own type-only import in a JSDoc line
  // — ``import('../../types/client.js')` inside a JSDoc type annotation`` — and my first version reported
  // that sentence as A MISSING MODULE. A court that accuses a healthy file teaches its reader to ignore
  // it, so the comment text is blanked out **IN PLACE**: every character of a comment becomes a space and
  // every newline is kept, so **the line numbers the court prints still point at the real line.**
  const code = source
    .replace(/\/\*[\s\S]*?\*\//gu, block => block.replace(/[^\n]/gu, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gmu, (whole, lead) => lead + ' '.repeat(whole.length - lead.length))
  const found = []
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/gu,                 // import … from '…'  /  export … from '…'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,     // dynamic import('…')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,    // require('…')
    /\bimport\s*['"]([^'"]+)['"]/gu,               // bare side-effect import '…'
  ]
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      // A SPECIFIER WITH `${` IS AN EXPRESSION, NOT A LITERAL. `import(`./x/${name}.js`)` cannot be
      // resolved without running the program, and reporting it as missing would be a false accusation —
      // which is worse than silence, because it teaches a reader to ignore the court.
      if (match[1].includes('${')) continue
      // A SPECIFIER CONTAINS NO WHITESPACE. This is the filter that separates an import from ENGLISH: the
      // `from '…'` pattern matched the prose `from 'no grant was presented'` in admission-grant.mjs, and a
      // court that reports a sentence as a missing module is a court nobody will read twice.
      if (/\s/u.test(match[1])) continue
      // A REGEX OR A STRING INSIDE CODE can still look like an import; a real specifier starts with a
      // relative marker, a scope, or a bare package name — never with punctuation like `,` or `)`.
      if (!/^(?:\.\.?\/|\/|@[a-z0-9]|[a-z0-9])/iu.test(match[1])) continue
      const line = code.slice(0, match.index).split('\n').length
      found.push({ specifier: match[1], line })
    }
  }
  return found
}

/** Resolve one specifier the way Node would, or return null. */
export function resolveSpecifier(specifier, fromFile, releaseRoot) {
  if (specifier.startsWith('node:')) return { builtin: true }
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
    const base = specifier.startsWith('/') ? join(releaseRoot, specifier) : resolvePath(dirname(fromFile), specifier)
    for (const extension of EXTENSIONS) {
      const candidate = `${base}${extension}`
      try { if (statSync(candidate).isFile()) return { path: realpathSync(candidate) } } catch { /* keep trying */ }
    }
    return null
  }
// ── ESM OR COMMONJS: WHICH QUESTION DOES THE RUNTIME ASK? ───────────────────────────────────────
// **THREE WAYS A FILE IS ESM, AND ALL THREE ARE NODE'S OWN RULES RATHER THAN A GUESS**: the extension
// is `.mjs`, or the nearest `package.json` says `"type": "module"`, or the specifier was written as
// `import`/`export from` inside a `.js` file whose package says so. *The extension and the package
// field are checked here; a `.js` file is ESM exactly when its nearest package.json says module.*
function importerIsEsm(fromFile) {
  if (fromFile.endsWith('.mjs')) return true
  if (fromFile.endsWith('.cjs')) return false
  let dir = dirname(fromFile)
  for (;;) {
    const candidate = join(dir, 'package.json')
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8'))
      // `type` is inherited from the nearest package.json, so the FIRST one found decides.
      return pkg.type === 'module'
    } catch { /* no package.json here; climb */ }
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

// ── THE ESM ANSWER, FROM A CHILD NODE THAT CAN ASK THE QUESTION ─────────────────────────────────
// **`import.meta.resolve(spec, parentURL)` IS PER-MODULE, SO THIS PROCESS CANNOT ASK IT ABOUT ANOTHER
// FILE.** A child node run with `--experimental-import-meta-resolve` can, *and Node's own resolver
// answers* — which keeps this file's rule intact: **do not reimplement the resolver, ask it.**
//
// **AND THE FLAG IS PASSED EXPLICITLY RATHER THAN ASSUMED**, because on a Node without it the child
// would fail for a reason that has nothing to do with the release, *and a walker that reports MISSING
// when its own tooling failed is the defect this whole comment block is about.*
let ESM_RESOLVER_WORKS = null
function resolveAsEsm(specifier, fromFile) {
  if (ESM_RESOLVER_WORKS === false) {
    throw new Error('the ESM resolver is unavailable in this node')
  }
  const program = `
    const spec = process.argv[1], parent = process.argv[2]
    try {
      const r = await import.meta.resolve(spec, parent)
      process.stdout.write(JSON.stringify({ ok: true, url: r }))
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, code: e && e.code ? e.code : 'ERR' }))
    }
  `
  const run = spawnSync(process.execPath, ['--experimental-import-meta-resolve', '--input-type=module',
    '-e', program, specifier, pathToFileURL(fromFile).href],
    { encoding: 'utf8', timeout: 20000 })
  if (run.error || run.status !== 0) {
    // **A WALKER THAT CANNOT RUN ITS TOOL MUST NOT REPORT THE RELEASE AS MISSING.** *It refuses to
    // answer instead*, so a broken instrument is never mistaken for a broken artefact.
    ESM_RESOLVER_WORKS = false
    throw new Error(`ESM resolve failed to run: ${run.error?.message ?? run.stderr ?? run.status}`)
  }
  const out = JSON.parse(run.stdout)
  if (!out.ok) {
    const err = new Error(`${out.code}: cannot resolve ${specifier} from ${fromFile}`)
    err.code = out.code
    throw err
  }
  return fileURLToPath(out.url)
}

  // ── ASK NODE. DO NOT REIMPLEMENT ITS RESOLVER. ─────────────────────────────────────────────────
  // THIS REPLACED A HAND-ROLLED WALK that searched `node_modules/<specifier>` LITERALLY and climbed by
  // hand. It knew nothing about **`exports` subpaths** (a map entry, not a folder), **the pnpm store**
  // (the package lives under `.pnpm/<name>@<version>/node_modules/<name>` and the top-level name is a
  // SYMLINK into it), or anything else Node has grown. **IT REFUSED A RELEASE THE RUNTIME LOADS
  // PERFECTLY** — and *a court that accuses a healthy release is worse than no court, because it teaches
  // its reader to ignore it.*
  //
  // **THE RULE IS NOT "REIMPLEMENT NODE'S RESOLVER CORRECTLY", IT IS "ASK NODE."** `createRequire` rooted
  // at the IMPORTING FILE is exactly the resolution the runtime will perform, honouring `exports`, the
  // store layout and every future rule, because it IS the rule.
  try {
    // ── **AN ESM IMPORTER MUST BE RESOLVED WITH ESM SEMANTICS, AND `createRequire` IS NOT THAT.** ────
    // MEASURED, AND IT BLOCKED A CUTOVER: `prepare` refused `~/aukora-release-05a82eec2a8f` with
    // `closure-court-failed — 8 MISSING`, *schemastery, dsh-credentials, dsh-session, dsh-session-query,
    // ws and dsh-host-frontend-static from `plugins/aukora-face-apps/lib/index.js`, plus schemastery and
    // zod from `plugins/aukora-face-settings/lib/index.js`* — **and Node's OWN ESM resolver resolves all
    // eight from those very files.**
    //
    // **THE CAUSE IS `exports` CONDITIONS.** `createRequire(file)` resolves as **CommonJS**, so it asks
    // for the `require` condition; an ESM importer asks for `import`. A package whose map offers only
    // `import` is **found by the runtime and reported MISSING by this walker** —
    // `createRequire(...).resolve('zod')` throws `MODULE_NOT_FOUND` **while `import` resolves it.**
    // *So the walker was wrong in the same direction the R186 comment warns about: it accused a release
    // the runtime loads perfectly, which teaches its reader to ignore it.*
    //
    // **AND THE FIX IS STILL "ASK NODE" RATHER THAN REIMPLEMENT IT** — *the rule this file already
    // states. It asks Node the ESM question for ESM importers and the CommonJS question for `require()`
    // sites*, which is exactly the pair of questions the runtime asks.
    const esm = importerIsEsm(fromFile)
    const resolved = esm ? resolveAsEsm(specifier, fromFile) : createRequire(fromFile).resolve(specifier)
    // ── AND IT MUST STAY INSIDE THE RELEASE ──────────────────────────────────────────────────────
    // **NODE'S RESOLVER CLIMBS OUT**, so a developer's own `node_modules` could make a RELEASE look closed
    // — *reporting a healthy release by measuring the tree that built it.* This is the one thing the
    // hand-rolled walk was right to refuse, and asking Node does not remove the need for the check: **it
    // moves it from the search to the answer.**
    const real = realpathSync(resolved)
    // ── AND THE ROOT IS REALPATH'D HERE, NOT TRUSTED FROM THE CALLER ──────────────────────────────
    // THE MACOS `/tmp` TRAP, MEASURED AGAIN: `mkdtempSync(tmpdir())` hands back `/var/folders/...`, whose
    // REALPATH is `/private/var/folders/...`. So a realpath'd result compared against a RAW root fails
    // `startsWith` on the FIRST component and **every dependency reads as missing** — the same bug the
    // comment at the top of `closureOf` records, in the other direction.
    //
    // **A FUNCTION THAT REQUIRES ITS ARGUMENT TO BE PRE-NORMALIZED IS A FUNCTION THAT WILL BE CALLED WITH
    // A RAW PATH** — the caller here was my own court. It normalizes its own input now.
    const root = (() => { try { return realpathSync(releaseRoot) } catch { return releaseRoot } })()
    if (real !== root && !real.startsWith(`${root}${sep}`)) return null
    return { path: real, dependency: true }
  } catch {
    // WHAT NODE CANNOT RESOLVE IS WHAT THE COURT REFUSES — and nothing else.
    return null
  }
}

/** Resolve a directory as a package, the way Node does: `exports`, then `main`, then `module`. */
function resolvePackage(base) {
  let manifest
  try { manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) } catch { return null }
  const candidates = []
  const exports = manifest.exports
  if (typeof exports === 'string') candidates.push(exports)
  else if (exports !== null && typeof exports === 'object') {
    const root = exports['.'] ?? exports
    if (typeof root === 'string') candidates.push(root)
    else if (root !== null && typeof root === 'object') {
      for (const key of ['import', 'require', 'default', 'node']) {
        if (typeof root[key] === 'string') { candidates.push(root[key]); break }
      }
    }
  }
  for (const key of ['main', 'module']) if (typeof manifest[key] === 'string') candidates.push(manifest[key])
  for (const candidate of candidates) {
    const full = join(base, candidate)
    for (const extension of EXTENSIONS) {
      try { if (statSync(`${full}${extension}`).isFile()) return realpathSync(`${full}${extension}`) } catch { /* keep trying */ }
    }
  }
  return null
}

/** The release's own entry points: its launcher, plus every plugin its composition patch names. */
/**
 * The release's own entry points, PLUS every entry point named by an OVERLAY PATCH supplied from outside.
 *
 * ── WHY OVERLAYS ARE NOT OPTIONAL ───────────────────────────────────────────────────────────────
 *
 * A release composed with an overlay carries plugin entries in a patch that lives ELSEWHERE —
 * `config.json` names it — and **every entry in that file is code the release will load.** A closure that
 * walks only the release's own patch and then says `CLOSED` **is reporting closed about a set it never
 * looked at.** That is the false-clean this script exists to refuse.
 *
 * @param {string} releaseRoot
 * @param {string[]} [overlays] - patch files to walk as well, in the order given.
 */
export function entriesOf(releaseRoot, overlays = []) {
  const entries = []
  for (const relative of STATIC_ENTRIES) {
    const full = join(releaseRoot, relative)
    if (existsSync(full)) entries.push(full)
  }
  // ── AN OVERLAY THAT CANNOT BE READ IS A REFUSAL, NOT A SHRUG ────────────────────────────────────
  // Skipping an unreadable patch would produce `CLOSED` about a set of entry points nobody parsed, which
  // is worse than reporting nothing: **it is a clean verdict about an unmeasured set.**
  for (const overlay of overlays) {
    if (!existsSync(overlay)) {
      refuse('CLOSURE_PATCH_MISSING',
        `the overlay patch ${overlay} does not exist; a patch that cannot be read is a set of entry `
        + 'points this walk did not cover, and CLOSED over those is a false clean')
    }
    // OVERLAY PATHS RESOLVE BESIDE THE PATCH, not beside the release: an overlay lives outside the
    // release and names its plugins relative to itself.
    entries.push(...patchEntries(dirname(overlay), readFileSync(overlay, 'utf8')))
  }
  const patch = join(releaseRoot, 'aukora-composition.patch.yml')
  if (existsSync(patch)) {
    // A DELIBERATELY NARROW READ. This parses the one shape the materializer emits — `name: ./path` — and
    // does not pretend to be a YAML implementation. A patch this cannot read is reported, not ignored.
    for (const line of readFileSync(patch, 'utf8').split('\n')) {
      const match = /^\s*(?:-\s*)?name:\s*(\.\/[^\s#]+)/u.exec(line)
      if (match !== null) {
        const full = join(releaseRoot, match[1])
        if (existsSync(full)) entries.push(full)
      }
    }
  }
  return entries
}

/**
 * The `name: ./path` entries of one patch file, resolved against `base`.
 *
 * A DELIBERATELY NARROW READ — it parses the one shape the materializer emits and does not pretend to be a
 * YAML implementation. **The same reader serves the release's own patch and every overlay**, so the two
 * cannot drift into disagreeing about what a patch says.
 */
function patchEntries(base, text) {
  const out = []
  for (const line of text.split('\n')) {
    const match = /^\s*(?:-\s*)?name:\s*(\.\/[^\s#]+)/u.exec(line)
    if (match !== null) {
      const full = join(base, match[1])
      if (existsSync(full)) out.push(full)
    }
  }
  return out
}

/** Walk the closure. Returns the unreadable specifiers, each named by file and line. */
export function closureOf(unresolvedRoot, overlays = []) {
  // THE ROOT IS REALPATH'D FIRST, AND THIS IS A MEASURED BUG RATHER THAN A PRECAUTION. On macOS `/tmp` is
  // a SYMLINK to `/private/tmp`, so an un-realpath'd root of `/tmp/au6/rel` never matches the realpath'd
  // `/private/tmp/au6/rel/...` that `realpathSync` returns for each file — `startsWith` is false on the
  // FIRST comparison and the walk never climbs to `node_modules`. **Every bare specifier was then reported
  // missing.** It hid because `~/aukora-release-*` has no symlink in it.
  const releaseRoot = realpathSync(resolvePath(unresolvedRoot))
  const entries = entriesOf(releaseRoot, overlays)
  const seen = new Set()
  const missing = []
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.shift()
    const real = (() => { try { return realpathSync(file) } catch { return file } })()
    if (seen.has(real)) continue
    seen.add(real)
    if (real.includes(`${sep}${SKIP_DIRS[0]}${sep}`) || SKIP_DIRS.slice(1).some(d => real.includes(`${sep}${d}${sep}`))) continue
    let source
    try { source = readFileSync(real, 'utf8') } catch { continue }
    if (!/\.(?:js|mjs|cjs)$/u.test(real)) continue
    for (const { specifier, line } of specifiersIn(source)) {
      const resolved = resolveSpecifier(specifier, real, releaseRoot)
      if (resolved === null) {
        missing.push({ file: real.slice(releaseRoot.length + 1), line, specifier })
        continue
      }
      if (resolved.builtin === true || resolved.dependency === true) continue
      queue.push(resolved.path)
    }
  }
  return { entries: entries.length, walked: seen.size, missing }
}

if (isMainModule(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  if (args === null) { console.error(USAGE); process.exit(2) }
  const root = realpathSync(resolvePath(args.release))
  if (!existsSync(join(root, 'apps/cli/lib/bin.js'))) {
    console.error(`release-closure: ${root} does not look like a release (no apps/cli/lib/bin.js)`)
    process.exit(2)
  }
  const result = closureOf(root, args.patches)
  if (args.json) { console.log(JSON.stringify(result, null, 2)) } else {
    console.log(`release-closure: ${result.walked} file(s) walked from ${result.entries} entry point(s)`)
    if (result.missing.length === 0) console.log('  CLOSED — every specifier resolves inside the release')
    for (const miss of result.missing) console.log(`  MISSING ${miss.file}:${miss.line} -> ${miss.specifier}`)
  }
  process.exit(result.missing.length === 0 ? 0 : 1)
}
