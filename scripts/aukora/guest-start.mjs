#!/usr/bin/env node
/**
 * The only sanctioned entry for future confined guests. Today --selftest runs only
 * Deep's keyless confinement fixture; no guest is wired to the live agent yet.
 * Without --selftest, refuse guest:not-wired. Never fall back to an unconfined start.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../lib/is-main.mjs'

const check = fileURLToPath(new URL('./box-confinement-check.mjs', import.meta.url))
const green = [
  'BOX CONFINEMENT: PASS (generated policy)',
  'BOX CONFINEMENT: REFUSE confined:enforcement-unavailable (unrestricted policy)',
  'BOX CONFINEMENT CHECK: GREEN',
].join('\n')
const notRun = new Set([
  'BOX CONFINEMENT CHECK: NOT RUN (nested sandbox)',
  'BOX CONFINEMENT CHECK: SKIPPED (not macOS)',
])

/** A fresh observation, never a cached grant. Exit zero alone also means NOT RUN. */
export function probeConfinement() {
  try {
    const out = spawnSync(process.execPath, [check], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { LANG: 'C', LC_ALL: 'C' }, // No inherited Node hooks or live channels.
      encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = (out.stdout ?? '').trim()
    const clean = !out.error && out.signal === null && out.status === 0 && out.stderr === ''
    const verdict = clean && stdout === green ? 'PASS' : clean && notRun.has(stdout) ? 'NOT_RUN' : 'RED'
    const detail = [out.error?.message, `exit=${out.status} signal=${out.signal}`, stdout, out.stderr]
      .filter(Boolean).join(' ').replace(/\s+/gu, ' ').slice(0, 1200)
    return { verdict, detail }
  } catch (error) {
    return { verdict: 'RED', detail: String(error?.message ?? error).replace(/\s+/gu, ' ').slice(0, 1200) }
  }
}

if (isMainModule(import.meta.url)) {
  // There is no command/argv passthrough, and no launch path until one is wired.
  if (process.argv.length !== 3 || process.argv[2] !== '--selftest') {
    console.error('REFUSE guest:not-wired: no guest is wired to the live agent yet')
    process.exitCode = 1
  } else {
    const confinement = probeConfinement()
    if (confinement.verdict !== 'PASS') {
      console.error(`REFUSE guest:confinement-unavailable: ${confinement.verdict}: ${confinement.detail}`)
      process.exitCode = 1
    } else {
      console.log(`GUEST SELFTEST: PASS: ${confinement.detail}`)
    }
  }
}
