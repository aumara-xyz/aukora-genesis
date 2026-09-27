/**
 * courts/harness/seatbelt-reach - what a Seatbelt profile actually takes away
 * on this host, and the way such a profile silently takes away nothing.
 *
 * WHY THIS COURT EXISTS. courts/harness/wasm-cell prints CONFINEMENT_NOT_
 * ESTABLISHED at C8 for the Node host that embeds a cell, and courts/harness/
 * wasm-proposal prints the same at P6. Those rows name a gap without measuring
 * it. This court measures the one host-level mechanism available on darwin
 * without a password, so the gap has a size rather than an adjective.
 *
 * THE TRAP THIS COURT EXISTS TO CATCH. A Seatbelt profile resolves subpaths
 * against canonical paths. On darwin, mkdtemp returns a path under
 * /var/folders, and /var is a symlink to /private/var. A profile written with
 * the path mkdtemp handed back therefore names a path the kernel never
 * matches, and it denies NOTHING while looking exactly like a profile that
 * denies something. S1 measures that directly, because a confinement claim
 * resting on such a profile is the same vacuous-green class this repository
 * has published three times: an artifact that reports success without testing
 * its subject.
 *
 *   S1  canonical-required  a symlinked subpath denies nothing; the real one denies
 *   S2  key-denied          a wrapped process cannot read a key file by path
 *   S3  control             the SAME profile still reads a file outside the subpath
 *   S4  still-reachable     an inventory of what the wrapped process keeps
 *   S5  ceiling             a wrapper is not a principal, and this API is deprecated
 *
 * S3 is not decoration. Without it, S2 cannot distinguish "the kernel refused"
 * from "the file was not there", which is the failure mode a denial court is
 * most likely to have.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'

const MUTATE = process.argv.includes('--mutate')
const EXIT_INCONCLUSIVE = 78
const rows = []
const row = (n, name, breach, detail, inconclusive = false) => rows.push({ n, name, breach, detail, inconclusive })
const EXPECTED = ['S1', 'S2', 'S3', 'S4', 'S5']

/** Run argv under a profile. Returns { code, out }. code 0 means it was permitted. */
function underProfile(profilePath, argv) {
  try {
    const out = execFileSync('sandbox-exec', ['-f', profilePath, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out: String(out).trim() }
  } catch (e) {
    return { code: e.status ?? -1, out: String(e.stderr ?? e.message).trim() }
  }
}

const RAW = mkdtempSync(join(tmpdir(), 'aukora-seatbelt-'))
let CANON = RAW
try { CANON = realpathSync(RAW) } catch { /* left as RAW; S1 then cannot distinguish and says so */ }

try {
  if (!existsSync('/usr/bin/sandbox-exec') && !existsSync('/usr/bin/sandbox-exec')) {
    row('S1', 'canonical-required', false, 'sandbox-exec not present on this host', true)
  }
  const keyFile = join(CANON, 'issuer.key')
  writeFileSync(keyFile, 'ROOT-KEY-MATERIAL-DO-NOT-READ\n', { mode: 0o600 })
  const outside = join(tmpdir(), `aukora-seatbelt-outside-${process.pid}`)
  writeFileSync(outside, 'reachable\n')

  const profile = deny => `(version 1)\n(allow default)\n(deny file-read* (subpath "${deny}"))\n`
  const rawProfile = join(CANON, 'raw.sb')
  const canonProfile = join(CANON, 'canon.sb')
  writeFileSync(rawProfile, profile(MUTATE ? CANON : RAW))
  writeFileSync(canonProfile, profile(CANON))

  // ---- S1 the trap ---------------------------------------------------------
  const viaRaw = underProfile(rawProfile, ['/bin/cat', keyFile])
  const viaCanon = underProfile(canonProfile, ['/bin/cat', keyFile])
  const pathsDiffer = RAW !== CANON
  if (!pathsDiffer) {
    row('S1', 'canonical-required', false, `mkdtemp path is already canonical on this host (${RAW}); the trap cannot be demonstrated here`, true)
  } else {
    const trapReal = viaRaw.code === 0 && viaCanon.code !== 0
    // Mode-independent predicate: the row holds only while the court can still
    // show the symlinked profile permitting what the canonical one denies. The
    // arm writes both profiles canonically, so the demonstration disappears and
    // this row must breach.
    row('S1', 'canonical-required', !trapReal,
      `profile naming ${RAW} -> exit ${viaRaw.code} (${viaRaw.code === 0 ? 'READ SUCCEEDED, denies nothing' : 'denied'}); ` +
      `profile naming ${CANON} -> exit ${viaCanon.code} (${viaCanon.code === 0 ? 'READ SUCCEEDED' : 'denied'}). ` +
      `A profile written from mkdtemp's return value is the silent no-op.`)
  }

  // ---- S2 the denial -------------------------------------------------------
  row('S2', 'key-denied', viaCanon.code === 0,
    viaCanon.code === 0
      ? `*** the wrapped process READ the key file ***`
      : `wrapped read of the key file refused: ${viaCanon.out.split('\n')[0].slice(0, 100)}`)

  // ---- S3 the positive control --------------------------------------------
  const ctl = underProfile(canonProfile, ['/bin/cat', outside])
  row('S3', 'control', ctl.code !== 0,
    ctl.code === 0
      ? `the SAME profile still reads ${outside} (exit 0), so S2 is a denial and not an absent file`
      : `*** control failed: the profile also blocked ${outside} (exit ${ctl.code}) — S2 proves nothing ***`)

  // ---- S4 what survives ----------------------------------------------------
  const probes = [
    ['spawn a child', ['/bin/sh', '-c', '/bin/echo child-ran']],
    ['read /etc/hosts', ['/bin/cat', '/etc/hosts']],
    ['list the home dir', ['/bin/ls', process.env.HOME ?? '/']],
    ['resolve DNS', ['/usr/bin/dscacheutil', '-q', 'host', '-a', 'name', 'localhost']],
  ]
  const kept = probes.filter(([, argv]) => underProfile(canonProfile, argv).code === 0).map(([n]) => n)
  row('S4', 'still-reachable', false,
    `the same wrapped process still can: ${kept.join('; ') || 'none of the probes'}. ` +
    `This profile removes one subpath and leaves the rest of the machine.`)

  // ---- S5 ceiling ----------------------------------------------------------
  row('S5', 'ceiling', false,
    'A WRAPPER IS NOT A PRINCIPAL. Everything above constrains one process that was launched through sandbox-exec. ' +
    'An unwrapped process at the same uid reads the same key file freely, so nothing here establishes custody or separation of duties. ' +
    'sandbox-exec is documented as deprecated in its own man page. This measures a mitigation, not a boundary.')
  rmSync(outside, { force: true })
} catch (e) {
  row('S1', 'canonical-required', false, `probe failed: ${e.message}`, true)
} finally {
  rmSync(RAW, { recursive: true, force: true })
}

const measured = rows.map(r => r.n)
const complete = EXPECTED.every(n => measured.includes(n))
console.log('\n  courts/harness/seatbelt-reach - what a profile takes, and how it takes nothing\n')
for (const r of rows) {
  const v = r.inconclusive ? '*** INCONCLUSIVE ***' : r.breach ? '*** BREACH ***' : 'held'
  console.log(`  ${r.n}  ${r.name.padEnd(18)} ${v.padEnd(22)} ${r.detail}`)
}
const breached = rows.filter(r => r.breach).map(r => r.n)
if (MUTATE) {
  const detected = breached.length > 0
  console.log(`\n  MUTATION symlinked-path-profile   the profile is written with the canonical path in BOTH arms, so the trap disappears -> breached=[${breached.join(' ')}]   ${detected ? 'MUTATION CONFIRMED' : 'NOT DETECTED'}\n`)
  // Three outcomes, three codes. Exiting 1 either way computes `detected` and
  // then discards it, so a caller reading exit codes cannot tell a sabotage
  // this court caught from one it missed, which is the whole question an arm
  // exists to answer. 0 stays impossible under an arm.
  if (!complete) process.exit(3)
  process.exit(detected ? 1 : 2)
}
console.log(`\n  ${rows.length} rows, ${rows.filter(r => !r.breach && !r.inconclusive).length} held, ${rows.filter(r => r.inconclusive).length} inconclusive`)
console.log('  observationClass: SELF-REPORTED\n')
if (!complete) { console.log(`  ROW TABLE INCOMPLETE expected=${EXPECTED.join(',')} measured=${measured.join(',')}`); process.exit(1) }
if (rows.some(r => r.inconclusive)) process.exit(EXIT_INCONCLUSIVE)
process.exit(breached.length ? 1 : 0)
