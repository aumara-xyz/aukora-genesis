#!/usr/bin/env node
// owner-closure.mjs — the import closure of the owner daemon, computed from its ENTRY POINTS and copied
// into the install at the SAME relative layout, so relative imports resolve unchanged.
//
// WHY THE CLOSURE AND NOT A REWRITE (Fable's decision, 2026-09-25): changing the imports to fit an
// install layout would fork the installed code from the code the courts test.
// plugins/aukora-owner-daemon/lib/settle-adapter.mjs legitimately reaches
// ../../aukora-kira/lib/memory-owner.mjs, which reaches further into the aumlok lib and the vendored
// noble-curves Beta's phone verifier uses. So the install carries what the code reaches, at the paths it
// expects: $LIBEXEC/plugins/aukora-kira/lib/memory-owner.mjs beside
// $LIBEXEC/plugins/aukora-owner-daemon/bin/owner-daemon.mjs.
//
// THE RESOLVER IS THE ONE THE MODULE COURT USES: the same three line-anchored import forms (a looser
// pattern matched prose inside error strings and a DER prefix hex), relative specifiers resolved against
// the importing file, bare specifiers resolved node-style by walking node_modules UP from the importer.
// Anything that resolves outside the tree refuses BY NAME.
//
//   node scripts/owner/owner-closure.mjs --repo . --entry plugins/aukora-owner-daemon/bin/owner-daemon.mjs ...
//   node scripts/owner/owner-closure.mjs --install /tmp/proof/libexec --repo . --entry ...
//   node scripts/owner/owner-closure.mjs --check /tmp/proof/libexec     # the INSTALLED tree resolves inside
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const PATTERNS = [
  /^\s*import\s+[^;\n]*?from\s*['"]([^'"]+)['"]/gm,
  /^\s*import\s*['"]([^'"]+)['"]/gm,
  /^\s*export\s+[^;\n]*?from\s*['"]([^'"]+)['"]/gm,
  /import\(\s*['"]([^'"]+)['"]/g,
]
const CODE = /\.(?:mjs|cjs|js)$/u
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/** Every specifier in one file, in source order, deduplicated. */
export function specifiersOf(file) {
  const text = readFileSync(file, 'utf8')
  const out = []
  // COMMENT LINES ARE SKIPPED, AND THAT IS NOT COSMETIC. The dynamic-import pattern has no `^` anchor (a
  // real `import(` can appear mid-line), so prose inside a JSDoc block matched it: MEASURED 2026-09-25,
  // composition-gate/src/artifact.mjs documents `import('../../types/client.js')` as a TYPE-ONLY reference
  // in a comment, and the closure refused a file whose real graph is fine — `node -e "await
  // import(...admission-grant.mjs)"` LOADS OK. A parser that fails on sentences is a parser nobody keeps,
  // so lines whose first non-space characters are `//`, `*` or `/*` are not code.
  const code = text.split('\n').filter((line) => {
    const t = line.trim()
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
  }).join('\n')
  for (const pat of PATTERNS) for (const m of code.matchAll(pat)) out.push(m[1])
  return [...new Set(out)]
}

/** Node-style bare resolution, but it may never leave `root`: that is the whole point. */
function resolveBare(spec, fromDir, root) {
  const parts = spec.split('/')
  const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  const rest = spec.slice(pkg.length + 1)
  let dir = fromDir
  while (true) {
    const base = join(dir, 'node_modules', pkg)
    if (existsSync(base)) {
      const pj = join(base, 'package.json')
      let target = join(base, rest || 'index.js')
      if (!rest && existsSync(pj)) {
        const j = JSON.parse(readFileSync(pj, 'utf8'))
        const main = j.exports?.['.']?.import ?? j.exports?.['.'] ?? j.module ?? j.main
        if (typeof main === 'string') target = join(base, main)
      }
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.js')
      return existsSync(target) ? target : null
    }
    if (dir === root || dir === dirname(dir)) return null
    dir = dirname(dir)
  }
}

/**
 * LOADING THIS TOOL CANNOT FOLLOW (Codex, 2026-09-25). A regex import parser sees static `import … from`
 * and literal `import(…)`; it does NOT see `require(`, `createRequire`, or a computed dynamic import. The
 * install would then carry a module whose real dependency it never checked — the file would verify by
 * digest while the module it loads at runtime is one nothing measured. Each pattern is matched only on
 * CODE lines (a line whose first non-space characters are not a comment), because this repository's error
 * strings are full of prose like "cannot import 'your approval was already spent'".
 */
const UNSUPPORTED_LOADING = [
  { what: 'require(', re: /(^|[^.\w])require\s*\(/u },
  { what: 'createRequire', re: /createRequire\s*\(/u },
  // `import(pathToFileURL(join(…)))` IS followed by this tool (see computedTargets) and is therefore not
  // "unsupported" any more; everything else with a non-literal argument still is.
  { what: 'a computed dynamic import this tool cannot resolve', re: /import\s*\(\s*(?!['"])(?!pathToFileURL\s*\()/u },
]
export function unsupportedLoading(file) {
  const out = []
  const known = staticUrlConsts(file)
  const lines = readFileSync(file, 'utf8').split('\n')
  for (const [i, line] of lines.entries()) {
    const code = line.trim()
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) continue
    for (const { what, re } of UNSUPPORTED_LOADING) {
      if (!re.test(line)) continue
      // `import(VENDORED_ENTRY.href)` is followed when the constant is statically knowable in this file
      const named = line.match(/import\(\s*([A-Za-z_$][\w$]*)(?:\.href)?\s*\)/u)
      if (named && known.has(named[1])) continue
      out.push(`${i + 1}: ${what} — ${code.slice(0, 100)}`)
    }
  }
  return out
}

/**
 * THE COMPUTED IMPORTS THIS TOOL *CAN* FOLLOW, and why refusing them was not enough.
 *
 * MEASURED 2026-09-25, and it invalidated the first closure: `owner-daemon.mjs` loads three of its
 * dependencies through `await import(pathToFileURL(join(HERE, '..', 'lib', 'binding.mjs')).href)`.
 * A regex parser sees none of them, so the "closure" was missing `lib/binding.mjs`,
 * `aukora-nostr/lib/phone-approval.mjs` and `aukora-composition-gate/src/admission-grant.mjs` — and
 * `checkInstalled` passed the tree anyway, because it uses the same blind parser. The daemon would have
 * died with MODULE_NOT_FOUND on the installed tree while every check said green.
 *
 * So the form is FOLLOWED: `join`/`resolve` whose first argument is the file's own directory (the
 * `HERE = fileURLToPath(new URL('.', import.meta.url))` idiom) or a literal, and whose remaining
 * arguments are string literals. A base this tool cannot name, or a non-literal segment, is refused BY
 * NAME rather than guessed — the fail-closed half is kept.
 */
/**
 * THE SECOND IDIOM, measured the moment the first one was followed: `pq-generator.mjs` writes
 *   const VENDORED_ENTRY = new URL('./vendor/noble-ml-dsa/index.mjs', import.meta.url)
 *   … await import(VENDORED_ENTRY.href)
 * which is a LITERAL path relative to the file, so it is as followable as the `join(HERE, …)` form. A
 * constant this function cannot reduce is left out of the map, and the import that uses it is refused by
 * name — the tool never guesses a path.
 */
const URL_CONST = /const\s+([A-Za-z_$][\w$]*)\s*=\s*new URL\(\s*(['"][^'"]+['"])\s*,\s*import\.meta\.url\s*\)/gu
const PTF_CONST = /const\s+([A-Za-z_$][\w$]*)\s*=\s*pathToFileURL\(\s*(?:join|resolve)\(([^)]*)\)\s*\)/gu
export function staticUrlConsts(file) {
  const text = readFileSync(file, 'utf8')
  const map = new Map()
  for (const m of text.matchAll(URL_CONST)) map.set(m[1], resolve(dirname(file), m[2].slice(1, -1)))
  for (const m of text.matchAll(PTF_CONST)) {
    const args = m[2].split(',').map((a) => a.trim()).filter(Boolean)
    const base = args.shift()
    let dir = null
    if (base === 'HERE' || base === '__dirname') dir = dirname(file)
    else if (LITERAL.test(base)) dir = resolve(dirname(file), base.match(LITERAL)[1])
    if (dir === null) continue
    const segs = []
    let ok = true
    for (const a of args) {
      const lit = a.match(LITERAL)
      if (!lit) { ok = false; break }
      segs.push(lit[1])
    }
    if (ok && segs.length) map.set(m[1], resolve(dir, ...segs))
  }
  return map
}

const COMPUTED = /import\s*\(\s*pathToFileURL\s*\(\s*(?:join|resolve)\s*\(([^)]*)\)\s*\)\s*\.href\s*\)/gu
const LITERAL = /^['"](.*)['"]$/u
export function computedTargets(file, label) {
  const text = readFileSync(file, 'utf8')
  const out = []
  for (const m of text.matchAll(COMPUTED)) {
    const args = m[1].split(',').map((a) => a.trim()).filter(Boolean)
    const base = args.shift()
    let dir
    if (base === 'HERE' || base === '__dirname') dir = dirname(file)
    else if (LITERAL.test(base)) dir = resolve(dirname(file), base.match(LITERAL)[1])
    else throw new Error(`${label}: a computed import is built from '${base}', which this tool cannot resolve. Rewrite it as a static import, or as import(pathToFileURL(join(HERE, '…')).href) so the closure can follow it.`)
    const segs = args.map((a) => {
      const lit = a.match(LITERAL)
      if (!lit) throw new Error(`${label}: a computed import has the non-literal path segment ${a}; the closure cannot follow it and will not guess`)
      return lit[1]
    })
    if (segs.length === 0) throw new Error(`${label}: a computed import names no path`)
    out.push(resolve(dir, ...segs))
  }
  const known = staticUrlConsts(file)
  for (const m of text.matchAll(/import\(\s*([A-Za-z_$][\w$]*)(?:\.href)?\s*\)/gu)) {
    const target = known.get(m[1])
    if (target === undefined) {
      throw new Error(`${label}: a computed import uses '${m[1]}', which this tool cannot reduce to a path (it is not a literal or a statically knowable URL constant). Rewrite it, or load it through a literal import the closure can follow.`)
    }
    out.push(target)
  }
  return out
}

/** The transitive closure of `entries` inside `repo`, as repo-relative paths. Throws a named refusal. */
export function closure({ repo, entries }) {
  const root = resolve(repo)
  const found = new Map() // absolute -> repo-relative
  // RUNTIME LOADING THE PARSER CANNOT FOLLOW IS A CEILING, NOT A CRASH (Codex r2 item 5). A file in the
  // closure may resolve specifiers at CALL time — `createRequire(pathToFileURL(x).href).resolve(spec)` in
  // composition-gate/src/artifact.mjs:157 is the measured instance — and no static parser can name those
  // targets. Refusing forever blocks the install on a property of someone else's module; passing silently
  // would let the bundle claim a completeness it does not have. So each instance is recorded BY NAME, the
  // caller writes those lines into the payload (so the bundle digest Peter confirms covers them), and the
  // honest claim becomes: every STATIC import in this graph was followed, and runtime loading inside these
  // files is NOT proven here — it is what the post-install resolution check and the courts exercise. An
  // empty ceiling list means the parser followed the whole graph.
  const ceilings = []
  const queue = entries.map((e) => resolve(root, e))
  for (const e of queue) if (!existsSync(e)) throw new Error(`entry point is missing: ${relative(root, e)}`)
  while (queue.length) {
    const file = queue.pop()
    const rel = relative(root, file)
    if (found.has(file)) continue
    if (rel.startsWith('..')) throw new Error(`an import resolved OUTSIDE the tree: ${file}`)
    // A SYMLINK IS NOT A FILE THIS TOOL CAN VOUCH FOR: the manifest would record the link's bytes (none)
    // while the runtime follows whatever the link points at. `relative()` containment cannot see that,
    // which is exactly the escape Codex named. Refuse by name instead.
    if (lstatSync(file).isSymbolicLink()) {
      throw new Error(`${rel} IS A SYMLINK (-> ${readlinkSync(file)}): the bundle would carry a link whose target no digest covers`)
    }
    found.set(file, rel)
    if (!CODE.test(file)) continue
    const unsupported = unsupportedLoading(file)
    for (const u of unsupported) ceilings.push(`${rel} — ${u}`)
    for (const computed of computedTargets(file, rel)) {
      if (!existsSync(computed)) throw new Error(`${rel} computes an import of ${computed}, which does not exist — the install would carry a module the daemon cannot load`)
      if (relative(root, computed).startsWith('..')) throw new Error(`${rel} computes an import OUTSIDE the tree: ${computed}`)
      queue.push(computed)
    }
    for (const spec of specifiersOf(file)) {
      if (spec.startsWith('node:') || spec.startsWith('data:')) continue
      let target
      if (spec.startsWith('.')) {
        target = resolve(dirname(file), spec)
        if (!existsSync(target) && existsSync(`${target}.js`)) target = `${target}.js`
        if (!existsSync(target) && existsSync(join(target, 'index.js'))) target = join(target, 'index.js')
        if (!existsSync(target)) throw new Error(`${rel} imports ${spec}, which does not exist (${target})`)
      } else {
        target = resolveBare(spec, dirname(file), root)
        if (target === null) throw new Error(`${rel} imports '${spec}', and it does not resolve inside ${root} — the install would carry a module the daemon cannot load`)
      }
      if (relative(root, target).startsWith('..')) throw new Error(`${rel} imports ${spec}, which resolves OUTSIDE ${root} (${target})`)
      queue.push(target)
    }
  }
  const files = [...found.values()].sort()
  files.ceilings = ceilings
  return files
}

/** The installed tree must resolve every import INSIDE itself — the court, on the real bytes. */
export function checkInstalled(root) {
  const bad = []
  let scanned = 0
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!CODE.test(e.name)) continue
      scanned += 1
      for (const computed of computedTargets(full, relative(root, full))) {
        if (!existsSync(computed)) { bad.push(`${relative(root, full)}: a computed import targets ${computed}, which is NOT in the install`); continue }
        if (relative(root, computed).startsWith('..')) bad.push(`${relative(root, full)}: a computed import resolves OUTSIDE the install (${computed})`)
      }
      for (const spec of specifiersOf(full)) {
        if (spec.startsWith('node:') || spec.startsWith('data:')) continue
        let target = null
        if (spec.startsWith('.')) {
          target = resolve(dirname(full), spec)
          if (!existsSync(target)) { bad.push(`${relative(root, full)}: ${spec} does not exist in the install`); continue }
        } else {
          target = resolveBare(spec, dirname(full), root)
          if (target === null) { bad.push(`${relative(root, full)}: bare import ${spec} does not resolve inside the install`); continue }
        }
        const rel = relative(root, target)
        if (rel.startsWith('..')) bad.push(`${relative(root, full)}: ${spec} resolves OUTSIDE the install (${target})`)
      }
    }
  }
  walk(root)
  // A COUNT FLOOR, because "no findings" over nothing is the same fail-open one level down: a tree with no
  // modules scans clean, and the caller reads a green verdict about an install that is not there. Zero
  // files scanned is UNMEASURABLE and is reported as a finding, never as a pass.
  if (scanned === 0) bad.push(`${root}: no module file was scanned — an empty tree is not a passing tree`)
  return bad
}

// ── THE DIRECT-INVOCATION GUARD, AND WHY IT IS NOT A STRING COMPARISON ───────────────────────────────
// MEASURED 2026-09-25, and it silently emptied an install: this guard read
//   `import.meta.url === `file://${process.argv[1]}``
// Run as /tmp/pf-src/scripts/owner/owner-closure.mjs, import.meta.url is
// file:///private/tmp/pf-src/... (/tmp is a symlink to /private/tmp on macOS) while the built string is
// file:///tmp/pf-src/... — the two never match under a symlinked path, so the block below never ran, the
// process exited 0 having done NOTHING, the caller read success, and the "install" was three files. Worse,
// the resolution check then PASSED on that tree, because a tree with no modules has no imports to escape.
// THE GUARD IS NOW RESOLVED ON BOTH SIDES — realpath for symlinks, pathToFileURL for the file:// encoding
// (a space in the path would otherwise arrive as %20). That house form is already used by
// scripts/ci/select-jobs.mjs and plugins/aukora-owner-daemon/bin/owner-daemon.mjs.
// AND THE FAILURE IS NO LONGER SILENT: an empty closure refuses below, and checkInstalled() refuses an
// empty tree, so a guard that does not fire can never be mistaken for a check that passed.
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
if (invokedDirectly) {
  const argv = process.argv.slice(2)
  const arg = (name, dflt = null) => { const i = argv.indexOf(name); return i === -1 ? dflt : argv[i + 1] }
  const repo = arg('--repo', '.')
  const entries = argv.flatMap((a, i) => (a === '--entry' ? [argv[i + 1]] : [])).filter(Boolean)
  const installTo = arg('--install')
  const check = arg('--check')
  try {
    if (check) {
      const bad = checkInstalled(check)
      for (const b of bad) console.log(`  FINDING ${b}`)
      console.log(bad.length === 0 ? `THE INSTALLED TREE RESOLVES INSIDE ITSELF (${check})` : `${bad.length} finding(s)`)
      process.exit(bad.length === 0 ? 0 : 1)
    }
    if (entries.length === 0) throw new Error('give at least one --entry')
    const files = closure({ repo, entries })
    console.log(`closure of ${entries.length} entry point(s): ${files.length} file(s)`)
    for (const f of files) console.log(`  ${f}`)
    // One `CEILING ` line per instance so the CALLER can carry them into the payload, where the bundle
    // digest covers them. Absence of these lines is the claim that the parser followed the whole graph.
    for (const c of files.ceilings ?? []) console.log(`CEILING ${c}`)
    if (installTo && files.length === 0) {
      throw new Error(`the closure of ${entries.length} entry point(s) is EMPTY — there is nothing to install, and an empty install must never read as a successful one`)
    }
    if (installTo) {
      const manifest = []
      for (const rel of files) {
        const src = join(resolve(repo), rel), dst = join(installTo, rel)
        mkdirSync(dirname(dst), { recursive: true })
        cpSync(src, dst)
        const want = sha(src), got = sha(dst)
        if (want !== got) throw new Error(`digest mismatch after copy: ${rel}`)
        manifest.push(`${got}  ${rel}`)
      }
      writeFileSync(join(installTo, 'MANIFEST.sha256'), `${manifest.join('\n')}\n`)
      const bad = checkInstalled(installTo)
      console.log(`installed to ${installTo}: ${manifest.length} file(s), manifest written`)
      for (const b of bad) console.log(`  FINDING ${b}`)
      if (bad.length) throw new Error('the installed tree does not resolve inside itself')
      console.log('INSTALLED TREE RESOLVES INSIDE ITSELF — every import lands in the closure')
    }
    process.exit(0)
  } catch (e) {
    console.error(`REFUSED: ${e.message}`)
    process.exit(1)
  }
}
