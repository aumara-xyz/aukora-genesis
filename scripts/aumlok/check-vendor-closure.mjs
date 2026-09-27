#!/usr/bin/env node
/**
 * Check the vendored ML-DSA-65 closure against its own manifest — and, given Deep, against upstream.
 *
 *   node scripts/aumlok/check-vendor-closure.mjs
 *   node scripts/aumlok/check-vendor-closure.mjs --deep /path/to/aukora-deep
 *
 * WHAT EACH MODE PROVES.
 *
 *   default   Every byte of `plugins/aukora-aumlok/lib/vendor/noble-ml-dsa/` still hashes to the
 *             value the manifest records, the closure digest recomputes, every file the manifest
 *             lists is present, no file the manifest does NOT list is present, every licences file
 *             matches, and no vendored module carries a surviving bare `@noble/...` specifier. This
 *             is the check that runs in a clean clone with no sibling checkout, because the
 *             manifest and the bytes are both in the repository.
 *
 *   --deep    Additionally re-derives each vendored module from Deep's own upstream bytes by
 *             applying the rewrites the manifest records, and requires byte-for-byte equality. This
 *             is the check that proves the rewrite is the ONLY difference between what is vendored
 *             and what upstream published — a claim the digest check above cannot make on its own,
 *             because a manifest and a file can be edited together. It refuses on a dirty Deep
 *             worktree for the same reason `regenerate-deep-vectors.mjs` does: modified tracked
 *             bytes are not the pinned bytes.
 *
 * WHAT IT DOES NOT PROVE. That the vendored implementation IS FIPS 204 ML-DSA-65. Nothing in this
 * file measures conformance, and the closure manifest says so in its own `note`. See the ceiling
 * `ML_DSA_65_UNMEASURED`.
 *
 * READ-ONLY. Nothing is written anywhere, including under `--deep`.
 *
 * @module scripts/aumlok/check-vendor-closure
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const VENDOR = join(ROOT, 'plugins', 'aukora-aumlok', 'lib', 'vendor', 'noble-ml-dsa')
const MANIFEST = join(VENDOR, 'upstream-noble-ml-dsa.json')

/** Read one `--flag value` argument, or undefined. */
function option(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

const failures = []

/** Record one failed check. Every check runs; the exit code reports the total. */
function fail(what) {
  failures.push(what)
  process.stdout.write(`  FAIL  ${what}\n`)
}

/** Record one passed check. */
function pass(what) {
  process.stdout.write(`  ok    ${what}\n`)
}

/** Check one condition and report it under a label. */
function check(label, condition, detail = '') {
  if (condition) pass(label)
  else fail(`${label}${detail === '' ? '' : ` — ${detail}`}`)
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** Recursively list regular files under `directory`, as paths relative to it, sorted. */
function walk(directory) {
  const out = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) out.push(...walk(full).map(path => join(entry.name, path)))
    else if (entry.isFile()) out.push(entry.name)
  }
  return out.sort()
}

if (!existsSync(MANIFEST)) {
  process.stderr.write(`check-vendor-closure: ${MANIFEST} is missing\n`)
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

process.stdout.write(`vendor closure: ${relative(ROOT, VENDOR)}${sep}\n`)
process.stdout.write(`manifest: domain=${String(manifest.domain)} formatVersion=${String(manifest.formatVersion)}\n\n`)

// ── 1. the entry exists and re-exports what the manifest says it does ──────────────────────────
const entry = join(VENDOR, manifest.entry)
check(`entry ${String(manifest.entry)} exists`, existsSync(entry))
if (existsSync(entry)) {
  const entryText = readFileSync(entry, 'utf8')
  check('the entry re-exports ml_dsa65 from the vendored ml-dsa module',
    /export\s*\{\s*ml_dsa65\s*\}\s*from\s*'\.\/post-quantum\/ml-dsa\.js'/u.test(entryText))
}

// ── 2. every listed module is present, has the right size, and hashes to the recorded value ────
let measuredBytes = 0
const measured = []
for (const file of manifest.files) {
  const path = join(VENDOR, file.path)
  if (!existsSync(path)) {
    fail(`listed module ${file.path} is missing`)
    continue
  }
  const bytes = readFileSync(path)
  measuredBytes += bytes.length
  const digest = sha256(bytes)
  measured.push({ path: file.path, sha256: digest })
  check(`${file.path} sha256 matches the manifest`, digest === file.sha256, `on disk ${digest}, manifest ${String(file.sha256)}`)
  check(`${file.path} byte count matches the manifest`, bytes.length === file.bytes, `on disk ${String(bytes.length)}, manifest ${String(file.bytes)}`)
  check(`${file.path} carries no surviving bare @noble specifier`,
    !/^\s*(?:import|export)[^\n]*?from\s*['"]@noble\//mu.test(bytes.toString('utf8')))
}

// ── 3. the tree contains nothing the manifest does not account for ─────────────────────────────
const listed = new Set([
  ...manifest.files.map(file => file.path),
  ...manifest.licenses.map(licence => licence.path),
  manifest.entry,
  'upstream-noble-ml-dsa.json',
  'PROVENANCE.md',
])
const present = walk(VENDOR)
check('no unaccounted file exists in the vendored tree',
  present.every(path => listed.has(path)),
  `unlisted: ${present.filter(path => !listed.has(path)).join(', ')}`)
check('every file the manifest lists exists in the tree',
  [...listed].every(path => present.includes(path)),
  `absent: ${[...listed].filter(path => !present.includes(path)).join(', ')}`)

// ── 4. the closure digest, and the size the manifest claims ────────────────────────────────────
const recomputed = sha256(measured.map(file => `${file.path}\0${file.sha256}`).join('\n'))
check('the closure digest recomputes', recomputed === manifest.closure.digest, `recomputed ${recomputed}, manifest ${String(manifest.closure.digest)}`)
check('the measured module count matches the manifest', measured.length === manifest.closure.modules, `measured ${String(measured.length)}, manifest ${String(manifest.closure.modules)}`)
check('the measured byte total matches the manifest', measuredBytes === manifest.closure.bytes, `measured ${String(measuredBytes)}, manifest ${String(manifest.closure.bytes)}`)

// ── 5. licences ────────────────────────────────────────────────────────────────────────────────
for (const licence of manifest.licenses) {
  const path = join(VENDOR, licence.path)
  if (!existsSync(path)) {
    fail(`licence ${licence.path} is missing`)
    continue
  }
  const bytes = readFileSync(path)
  check(`${licence.path} sha256 matches the manifest`, sha256(bytes) === licence.sha256)
  check(`${licence.path} is an MIT licence text`, /MIT License/u.test(bytes.toString('utf8').slice(0, 200)))
}

// ── 6. --deep: the rewrite is the ONLY difference from upstream ────────────────────────────────
const deep = option('--deep')
if (deep === undefined) {
  process.stdout.write('\n--deep not given: upstream byte equality and the rewrite check were NOT run.\n')
} else {
  process.stdout.write(`\n--deep ${deep}: re-deriving every module from upstream\n`)
  const git = (...args) => execFileSync('git', ['-C', deep, ...args], { encoding: 'utf8' }).trim()
  const pin = manifest.source.commit
  if (git('cat-file', '-t', pin) !== 'commit') {
    fail(`--deep ${deep} does not contain the pinned commit ${pin}`)
  } else {
    const modified = git('status', '--porcelain', '--untracked-files=no')
    check('the Deep worktree has no modified tracked files', modified === '', modified)
    for (const file of manifest.files) {
      const upstreamPath = join(deep, file.upstreamPath)
      if (!existsSync(upstreamPath)) {
        fail(`upstream ${file.upstreamPath} is absent from Deep`)
        continue
      }
      const upstreamBytes = readFileSync(upstreamPath)
      check(`${file.upstreamPath} upstream sha256 matches the manifest`,
        sha256(upstreamBytes) === file.upstreamSha256,
        `on disk ${sha256(upstreamBytes)}, manifest ${String(file.upstreamSha256)}`)
      let text = upstreamBytes.toString('utf8')
      let rewritesApplied = 0
      for (const rewrite of file.specifierRewrites) {
        const occurrences = text.split(rewrite.from).length - 1
        if (occurrences !== 1) {
          fail(`${file.path}: expected exactly one ${rewrite.from} in upstream, found ${String(occurrences)}`)
          continue
        }
        text = text.replace(rewrite.from, rewrite.to)
        rewritesApplied += 1
      }
      check(`${file.path} equals upstream with exactly its recorded rewrites applied`,
        rewritesApplied === file.specifierRewrites.length
        && sha256(Buffer.from(text, 'utf8')) === file.sha256)
    }
  }
}

process.stdout.write(`\n${failures.length === 0 ? 'VENDOR CLOSURE: GREEN' : `VENDOR CLOSURE: RED (${String(failures.length)} failed)`}\n`)
if (failures.length === 0) {
  process.stdout.write(`modules=${String(measured.length)} bytes=${String(measuredBytes)} digest=${recomputed}\n`)
  process.stdout.write('NOT PROVEN HERE: that this implementation IS FIPS 204 ML-DSA-65. No known-answer\n')
  process.stdout.write('vector and no second implementation were used. ML_DSA_65_UNMEASURED is not retired.\n')
}
process.exit(failures.length === 0 ? 0 : 1)
