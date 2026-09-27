#!/usr/bin/env node
/**
 * EVERY EMITTED FILE MUST PARSE, AND A FILE THAT DOES NOT IS NAMED.
 *
 * THE INCIDENT THIS EXISTS FOR. `plugins/aukora-face/apps/lib/index.js` was built from a `lib/types/*.js` that
 * `tsc` had emitted from a source file containing an unbalanced brace. The emit was not JavaScript —
 * `if(, isTrustedLocalRequest) { }` — and **`tsc -b` reported no error while producing it.** The only signal was
 * rolldown failing with `[PARSE_ERROR] Unexpected token`, pointing at a generated file, minutes into a build,
 * with nothing to say about which source line was wrong. The build was red and the reason was invisible.
 *
 * **A COMPILER THAT EMITS GARBAGE AND EXITS ZERO IS NOT A CHECK.** This script is the check: it parses every
 * emitted `.js` with the runtime that will load it, and it prints each failure BY NAME so the next person
 * reads the file rather than the bundler's obituary for it.
 *
 * THREE STATES, because "I did not look" is not "I looked and it was fine":
 *
 *   0  every file found parsed
 *   1  at least one file FAILED to parse (the failures are printed by name)
 *   2  NOT MEASURED — no `.js` file was found at all, so nothing was checked
 *
 * Usage: node scripts/face-parse-check.mjs <dir> [<dir>...]
 *
 * @module face-parse-check
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const roots = process.argv.slice(2).filter(argument => !argument.startsWith('-'))
if (roots.length === 0) {
  process.stderr.write('face-parse-check: give at least one directory to check\n')
  process.exit(2)
}

/** Every `.js` under a path, recursively, in a stable order. */
function jsFiles(root) {
  const found = []
  const walk = (path) => {
    let entries
    try {
      entries = readdirSync(path, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(path, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.js')) found.push(full)
    }
  }
  try {
    if (statSync(root).isDirectory()) walk(root)
  } catch {
    // A missing directory contributes no files; the caller's NOT-MEASURED state covers it.
  }
  return found
}

const files = roots.flatMap(jsFiles)
if (files.length === 0) {
  process.stdout.write(`face-parse-check: NOT MEASURED — no .js file under ${roots.join(', ')}\n`)
  process.exit(2)
}

const failures = []
for (const file of files) {
  // **THE RUNTIME'S OWN PARSER, INVOKED AS THE RUNTIME.** `node --check` is the same grammar the load will use,
  // and it needs no API that this Node may not export: `checkSyntax` from `node:vm` is internal and is NOT an
  // export on 22.23.0, which is how the first version of this script failed on its own import line.
  const run = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (run.status === 0) continue
  const detail = `${run.stderr ?? ''}`.split('\n').find(line => line.trim().length > 0) ?? 'did not parse'
  failures.push({ file, message: detail.trim() })
}

if (failures.length > 0) {
  process.stdout.write(`face-parse-check: ${String(failures.length)} of ${String(files.length)} emitted file(s) DO NOT PARSE\n`)
  for (const failure of failures) process.stdout.write(`  ${failure.file}\n    ${failure.message}\n`)
  process.exit(1)
}

process.stdout.write(`face-parse-check: ${String(files.length)} emitted file(s) parse\n`)
process.exit(0)
