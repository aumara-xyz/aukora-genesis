#!/usr/bin/env node
// Read-only proof for the sealed Deep copy. No package installation or release mounting.
// Usage: node scripts/aukora/box-closure.mjs [--source /path/to/Deep/aukora]
// This lexer covers the pinned source's import syntax, including both branches of
// its three computed imports. Unknown computed imports fail; they are never ignored.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { builtinModules } from 'node:module'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BOX = join(ROOT, 'plugins/aukora-box/aukora')
const SOURCE = join(homedir(), 'aukora-private/vendor-staging/aukora-deep-c417f7c/aukora')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]))
const isModule = name => /\.(?:mjs|js|ts|mts)$/.test(name)
const isRuntime = name => /\.(?:mjs|js)$/.test(name)
const inside = path => path !== '..' && !path.startsWith(`..${sep}`)

export function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return walk(path).map(child => join(entry.name, child))
    if (!entry.isFile()) throw new Error(`non-regular file: ${path}`)
    return [entry.name]
  }).sort()
}

// Skip comments, string contents, regex contents and template text. Recurse into
// template expressions so an import there cannot disappear into a string mask.
function tokensFor(source, file) {
  const tokens = []
  let at = 0
  const fail = kind => { throw new Error(`${file}: unsupported or unterminated ${kind} at ${at}`) }
  function code(templateExpression = false) {
    let braces = 0
    while (at < source.length) {
      const start = at, char = source[at], next = source[at + 1]
      if (/\s/.test(char)) { at++; continue }
      if (at === 0 && source.startsWith('#!')) {
        at = source.indexOf('\n'); if (at < 0) at = source.length; continue
      }
      if (char === '/' && next === '/') {
        const end = source.indexOf('\n', at + 2)
        at = end < 0 ? source.length : end + 1; continue
      }
      if (char === '/' && next === '*') {
        const end = source.indexOf('*/', at + 2)
        if (end < 0) fail('comment')
        at = end + 2; continue
      }
      if (char === "'" || char === '"') {
        at++
        while (at < source.length && source[at] !== char) {
          if (source[at] === '\\') at++
          at++
        }
        if (at >= source.length) fail('string')
        tokens.push({ kind: 'string', value: source.slice(start + 1, at), start })
        at++; continue
      }
      if (char === '`') {
        at++
        while (at < source.length && source[at] !== '`') {
          if (source[at] === '\\') { at += 2; continue }
          if (source[at] === '$' && source[at + 1] === '{') { at += 2; code(true); continue }
          at++
        }
        if (at >= source.length) fail('template')
        tokens.push({ kind: 'template', value: source.slice(start, ++at), start })
        continue
      }
      const previous = tokens.at(-1)
      if (char === '/' && (!previous || ['=', '(', '[', '{', ',', ':', ';', '!', '?', '&', '|', 'return', 'throw', '=>'].includes(previous.value))) {
        let inClass = false
        at++
        while (at < source.length) {
          if (source[at] === '\\') { at += 2; continue }
          if (source[at] === '[') inClass = true
          if (source[at] === ']') inClass = false
          if (source[at] === '/' && !inClass) break
          if (source[at] === '\n') fail('regexp')
          at++
        }
        if (at >= source.length) fail('regexp')
        at++
        while (/[a-z]/i.test(source[at] ?? '') && at < source.length) at++
        tokens.push({ kind: 'regexp', value: source.slice(start, at), start }); continue
      }
      if (/[A-Za-z_$]/.test(char)) {
        at++
        while (at < source.length && /[\w$]/.test(source[at])) at++
        tokens.push({ kind: 'word', value: source.slice(start, at), start }); continue
      }
      if (char === '{') braces++
      if (char === '}') {
        if (templateExpression && braces === 0) { at++; return }
        braces--
      }
      if (char === '=' && next === '>') {
        tokens.push({ kind: 'punctuation', value: '=>', start }); at += 2; continue
      }
      tokens.push({ kind: 'punctuation', value: char, start }); at++
    }
    if (templateExpression) fail('template expression')
  }
  code()
  return tokens
}

export function scanImports(source, file) {
  const tokens = tokensFor(source, file), edges = []
  const lineAt = position => source.slice(0, position).split('\n').length
  function add(token, kind, start) {
    if (token.value.includes('\\')) throw new Error(`${file}:${lineAt(start)}: escaped import specifier needs review`)
    edges.push({ specifier: token.value, kind, line: lineAt(start) })
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], next = tokens[i + 1]
    if (token.kind !== 'word' || !['import', 'export', 'require'].includes(token.value)) continue
    if (tokens[i - 1]?.value === '.' || next?.value === '.' || next?.value === ':') continue
    if (next?.value === '(' && token.value !== 'export') {
      let depth = 1, end = i + 2
      for (; end < tokens.length; end++) {
        if (tokens[end].value === '(') depth++
        if (tokens[end].value === ')' && --depth === 0) break
      }
      if (end === tokens.length) throw new Error(`${file}:${lineAt(token.start)}: unclosed import`)
      const args = tokens.slice(i + 2, end)
      if (args.length === 1 && args[0].kind === 'string') add(args[0], token.value === 'require' ? 'require' : 'dynamic', token.start)
      else {
        // All computed imports in the pinned tree are these finite ternaries.
        const pattern = args.map(t => t.kind === 'string' ? JSON.stringify(t.value) : t.value).join(' ')
        const direct = /^prepared \? ("[^"\\]+") : ("[^"\\]+")$/.exec(pattern)
        const cli = /^prepared \? pathToFileURL \( requireFromCli \. resolve \( ("[^"\\]+") \) \) \. href : ("[^"\\]+")$/.exec(pattern)
        if ((!direct && !cli) || (cli && cli[1] !== cli[2])) {
          throw new Error(`${file}:${lineAt(token.start)}: computed import needs review: ${pattern}`)
        }
        const seen = new Set()
        for (const arg of args.filter(t => t.kind === 'string')) {
          if (seen.has(arg.value)) continue
          seen.add(arg.value); add(arg, 'dynamic', token.start)
        }
      }
      i = end; continue
    }
    if (token.value === 'require') continue
    if (token.value === 'import' && next?.kind === 'string') { add(next, 'static', token.start); continue }
    if (token.value === 'export' && !['*', '{', 'type'].includes(next?.value)) continue
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].value === ';' || ['import', 'export'].includes(tokens[j].value)) break
      if (tokens[j].value === 'from' && tokens[j + 1]?.kind === 'string') {
        add(tokens[j + 1], 'static', token.start); break
      }
    }
  }
  return edges
}

export function classifyEdge(file, edge) {
  if (builtins.has(edge.specifier)) return { ...edge, file, scope: 'builtin' }
  if (!edge.specifier.startsWith('./') && !edge.specifier.startsWith('../')) return { ...edge, file, scope: 'outside' }
  const url = new URL(edge.specifier, pathToFileURL(join(BOX, file)))
  const target = relative(BOX, fileURLToPath(url))
  return { ...edge, file, target, scope: inside(target) ? 'inside' : 'outside' }
}

// Reviewed against the exact source digests in PROVENANCE.md. These are entry
// programs, not passive modules; the proof must never start them by importing.
const SKIP = new Map([
  ['issuer/issuer.mjs', '86-98,210-236,924: reads keys, opens approval carrier and socket server, may exit'],
  ['supervisor/bin.mjs', '13: unconditional CLI main and exit-code mutation'],
  ['supervisor/developer-guest-turn.mjs', '25-50: IPC setup and unconditional profile launch'],
  ['supervisor/developer-guest.mjs', '19-58: harness imports, profile launch/prepare, IPC listeners and process.exit'],
  ['supervisor/developer-launch-bin.mjs', '17-27: unconditional CLI branch and assembly launch'],
  ['supervisor/developer-live-turn-bin.mjs', '30-36: unconditional main; creates keys/control files'],
  ['supervisor/developer-web-bin.mjs', '34-110: unconditional key writes and assembly launch'],
  ['supervisor/developer-web-guest.mjs', '62: unconditional main prepares/launches profile'],
])

async function main() {
  const args = process.argv.slice(2)
  if (args.length && !(args.length === 2 && args[0] === '--source')) throw new Error('usage: box-closure.mjs [--source /path/to/Deep/aukora]')
  const sourceRoot = resolve(args[1] ?? SOURCE)
  const files = walk(BOX), fileSet = new Set(files), edges = [], unresolved = []
  for (const file of files.filter(isModule)) {
    for (const edge of scanImports(readFileSync(join(BOX, file), 'utf8'), file)) {
      const resolved = classifyEdge(file, edge)
      edges.push(resolved)
      if (resolved.scope === 'inside' && !fileSet.has(resolved.target)) unresolved.push(resolved)
    }
  }
  const runtimeEdges = edges.filter(edge => isRuntime(edge.file))
  const relativeEdges = runtimeEdges.filter(edge => edge.target !== undefined)
  console.log('Scope: unresolved counts missing files inside aukora/; outside dependencies remain unresolved below.')
  console.log(`BOX CLOSURE: ${files.length} files, ${relativeEdges.length} relative imports, ${unresolved.length} unresolved`)
  console.log(`Runtime: ${files.filter(isRuntime).length} modules; ${relativeEdges.filter(e => e.scope === 'inside').length} inside / ${relativeEdges.filter(e => e.scope === 'outside').length} outside relative imports; declarations and TS also scanned.`)
  for (const edge of unresolved) console.log(`UNRESOLVED ${edge.file}:${edge.line} ${edge.specifier}`)
  console.log('unresolved outside aukora/')
  for (const edge of edges.filter(e => e.scope === 'outside')) {
    console.log(`  aukora/${edge.file}:${edge.line} ${edge.specifier} [${isRuntime(edge.file) ? edge.kind : 'type/TS ' + edge.kind}]`)
  }
  console.log('Node built-ins use the host Node runtime; no outside dependency is copied or installed.')

  const provenance = readFileSync(join(BOX, '../PROVENANCE.md'), 'utf8')
  const rows = provenance.split('\n').filter(line => line.startsWith('plugins/aukora-box/aukora/')).map(line => line.split('\t'))
  if (rows.length !== files.length || new Set(rows.map(row => row[0])).size !== files.length) throw new Error('provenance inventory does not match copied file count')
  let identical = 0, bytes = 0
  for (const file of files) {
    const path = `plugins/aukora-box/aukora/${file}`
    const row = rows.find(row => row[0] === path)
    const copied = readFileSync(join(BOX, file)), original = join(sourceRoot, file)
    bytes += copied.length
    if (!row || row.length !== 3 || !existsSync(original) || !lstatSync(original).isFile()
      || realpathSync(original) !== original || row[2] !== `aukora/${file}`
      || sha256(copied) !== row[1] || sha256(readFileSync(original)) !== row[1]) {
      console.log(`BYTE MISMATCH: ${file}`)
    } else identical++
  }
  console.log(`BOX BYTES: ${identical}/${files.length} identical`)
  console.log(`BOX COPIED BYTES: ${bytes}`)
  if (unresolved.length || identical !== files.length) { process.exitCode = 1; return }

  let passed = 0, blocked = 0, failed = 0, skipped = 0
  // Each passive module is actually attempted in a fresh Node process. An absent
  // outside dependency is reported as BLOCKED, never as a successful node-import.
  for (const file of files.filter(isRuntime)) {
    if (SKIP.has(file)) { skipped++; console.log(`SKIP ${file}: ${SKIP.get(file)}`); continue }
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      'try { await import(process.argv[1]); console.log("BOX_MODULE_IMPORTED") } catch (e) { console.error(e.code + ": " + e.message); process.exitCode = 1 }',
      pathToFileURL(join(BOX, file)).href], { cwd: ROOT, env: { LANG: 'C', LC_ALL: 'C' }, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
    if (child.status === 0 && child.stdout.trim() === 'BOX_MODULE_IMPORTED') {
      passed++; console.log(`IMPORT PASS ${file}`)
    } else {
      const detail = child.error?.message ?? child.stderr.trim() ?? `exit ${child.status}`
      if (/ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|ENOENT/.test(detail)) {
        blocked++; console.log(`IMPORT BLOCKED ${file}: ${detail}`)
      } else { failed++; console.log(`IMPORT FAIL ${file}: ${detail || `exit ${child.status}`}`) }
    }
  }
  console.log(`BOX IMPORTS: ${passed} passed, ${blocked} blocked by outside dependencies, ${skipped} skipped for top-level effects, ${failed} other failures`)
  if (blocked || failed) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`BOX CHECK FAILED: ${error.message}`); process.exitCode = 1 })
}
