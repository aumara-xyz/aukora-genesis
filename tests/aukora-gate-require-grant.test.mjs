/**
 * **UNSIGNED EVIDENCE AND THE PILOT: A NAMED CEILING, NOT A SILENT FALLBACK — CODEX D1-r1, FINDING 3.**
 *
 * **THE FINDING:** *"unsigned evidence authorizes the pilot unless `requireGrant === true`, which fails open."*
 *
 * **IT IS THE WRONG DESCRIPTION OF THE RIGHT CODE, AND THE DIFFERENCE IS THE WHOLE POINT.**
 * `aukora-fail-open-pin` names the pattern a fail-open actually has: *a caller who supplies an unusable value
 * does not get an error — the field is **dropped**, the call proceeds **unpinned**, and the caller who tried to
 * tighten the check receives the weaker one. **The failure is silent.***
 *
 * **NONE OF THAT HAPPENS HERE:**
 *
 *     policy.js:758   log('PILOT: … admitted by artifact digest; approval slot unimplemented (U1)')
 *     install.js:87   if (typeof value !== 'boolean') throw refuseField(field, …)
 *
 * **ABSENT IS A CEILING THAT IS NAMED ON THE VERDICT; PRESENT-AND-UNUSABLE IS A FAULT THAT REFUSES.** That is
 * the skill's prescription implemented rather than violated — and the gate's own comment says why printing the
 * stronger line would be worse: *"A gate that always printed the stronger line would be reporting an approval it
 * never checked."*
 *
 * ── SO THIS COURT MEASURES THE THREE STATES, BECAUSE "NOT A DEFECT" IS A CLAIM TOO ──────────────────────────
 *
 *   1. **NO GRANT, `requireGrant` ABSENT** → the module loads, **AND the ceiling NAMES the unimplemented slot.**
 *      A gate that refused here would be refusing the honest weaker state the comment describes.
 *   2. **NO GRANT, `requireGrant: true`** → **REFUSED BY NAME.** Once an owner daemon exists, a digest is not an
 *      approval, and this is the fail-CLOSED half.
 *   3. **A MALFORMED `requireGrant`** → **REFUSED, not dropped.** *This is the arm the fail-open pattern would
 *      fail*, and the one that makes "not a defect" a measurement rather than a reading.
 *
 * **AND ARM 1 ASSERTS THE CEILING IS ACTUALLY PRINTED.** *"A ceiling that prints and exits 0"* is only a ceiling
 * if the words reach the operator — so the court requires the LINE, not merely the absence of a refusal.
 *
 * Run: node tests/aukora-gate-require-grant.test.mjs
 */
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mutationArm } from './helpers/mutation-arm.mjs'
import { childEnv } from './helpers/child-env.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const HOOK = join(ROOT, 'plugins', 'aukora-composition-gate', 'src', 'install.js')
const PILOT_ARTIFACT_PATH = join(ROOT, 'plugins', 'aukora-composition-gate', 'pilot-artifact.json')
const PILOT_ID = 'aukora-aumlok-subject'
const PILOT_SCOPE = 'plugins/aukora-aumlok'
const shipped = JSON.parse(readFileSync(PILOT_ARTIFACT_PATH, 'utf8'))
const PILOT = join(ROOT, shipped.artifacts[PILOT_ID].entry)

let arms = 0
let failures = 0
const check = (what, condition, detail = '') => {
  arms += 1
  if (condition) console.log(`  ok    ${what}`)
  else { failures += 1; console.log(`  FAIL  ${what}${detail === '' ? '' : ` — ${detail}`}`) }
}

const scratch = mkdtempSync(join(tmpdir(), 'aukora-require-grant-'))
process.on('exit', () => { try { rmSync(scratch, { recursive: true, force: true }) } catch { /* best effort */ } })

const pair = generateKeyPairSync('ed25519')
const governorPkFile = join(scratch, 'governor.pk')
writeFileSync(governorPkFile, pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'), 'utf8')
const daemonKey = join(scratch, 'daemon.pem')
writeFileSync(daemonKey, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), 'utf8')

/** Run one child with a given `requireGrant` setting — including a MALFORMED one, which is the point. */
const runWith = (requireGrant) => {
  const configPath = join(scratch, `c-${String(Math.abs(JSON.stringify(requireGrant ?? 'absent').length))}-${String(process.hrtime.bigint())}.json`)
  const config = {
    governed: [], stateDir: scratch, governorPkFile, pilotDaemonKeyPath: daemonKey,
    pilotRoot: ROOT, pilotScope: [PILOT_SCOPE], pilotArtifact: shipped.artifacts[PILOT_ID],
    // **NO GRANT AT ALL** — that is the state under test.
  }
  if (requireGrant !== undefined) config.requireGrant = requireGrant
  writeFileSync(configPath, JSON.stringify(config), 'utf8')
  const run = spawnSync(process.execPath, ['--import', HOOK, '-e',
    `import(${JSON.stringify(PILOT)}).then(() => console.log('IMPORTED'), () => {})`], {
    cwd: ROOT, encoding: 'utf8', env: childEnv({ AUKORA_GATE_CONFIG: configPath }),
  })
  const stdout = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  return {
    imported: stdout.includes('IMPORTED'),
    // **THE NAME APPEARS IN TWO SHAPES, AND I ONLY MATCHED ONE.** MEASURED: with `requireGrant: true` the
    // refusal is thrown from `installPolicy` DURING `--import`, so it arrives as a STACK TRACE naming the
    // code — not as the `REFUSE: CODE` line the import-time path prints. The arm said `refused=null` while
    // the module was correctly refused, which reads as 'refused for no stated reason' and is not what
    // happened. **Both shapes are the gate naming itself; the court must accept either.**
    refused: (/REFUSE: ([A-Za-z_-]+)/u.exec(stdout)?.[1])
      ?? (/(GRANT_REQUIRED|GRANT_MALFORMED|GRANT_EXPIRED|GRANT_SPENT|NO_GRANT|GRANT_BYTES_MISMATCH)/u.exec(stdout)?.[1])
      ?? (/(?:Error|Refusal): ([a-z-]+)/u.exec(stdout)?.[1])
      ?? null,
    namesUnimplemented: /approval slot unimplemented/iu.test(stdout),
    ceilingLine: /PILOT:.*admitted by artifact digest/iu.exec(stdout)?.[0] ?? null,
    fatal: /^Error:|\bthrow\b.*requireGrant|requireGrant must be/imu.test(stdout) ? stdout.slice(-200) : null,
    raw: stdout,
  }
}

console.log('\n── 1. NO GRANT AND NO `requireGrant`: THE MODULE LOADS, AND THE CEILING IS NAMED ──')
{
  const result = runWith(undefined)
  check('the pilot is ADMITTED on its recorded digest — the honest weaker state',
    result.imported,
    `refused=${String(result.refused)} — a gate that refused here would not be failing closed, it would be `
    + 'refusing a state the design deliberately allows')
  check('AND THE CEILING IS PRINTED, naming the unimplemented approval slot',
    result.ceilingLine !== null && result.namesUnimplemented,
    `ceiling=${String(result.ceilingLine)} — "a ceiling that prints" is only a ceiling if the words reach the `
    + 'operator; an unenforced admission that reads as an enforced one is the whole hazard')
}

console.log('\n── 2. AND WITH `requireGrant: true` IT FAILS CLOSED, BY NAME ──')
{
  const result = runWith(true)
  check('the pilot is REFUSED rather than admitted on a digest',
    !result.imported, 'it was admitted, so a daemon existing did not change the answer')
  check('and the refusal is NAMED', result.refused !== null, `refused=${String(result.refused)}`)
}

console.log('\n── 3. AND A MALFORMED `requireGrant` IS REFUSED, NOT DROPPED — THE FAIL-OPEN ARM ──')
{
  // **THIS IS THE ARM THE FAIL-OPEN PATTERN WOULD FAIL.** The pattern the skill describes is
  // `...(typeof pin === 'boolean' ? { pin } : {})`: an unusable value is DROPPED, the call proceeds UNPINNED, and
  // **the caller who tried to tighten the check receives the weaker one, silently.** Here the value is a string,
  // and the gate must refuse it rather than treat it as absent.
  for (const [label, value] of [
    ['a string', 'yes'],
    ['a number', 1],
    ['null', null],
  ]) {
    const result = runWith(value)
    check(`${label} is REFUSED rather than dropped`,
      !result.imported,
      `imported=${String(result.imported)} — the unusable pin was DROPPED and the gate proceeded UNPINNED, `
      + 'which is the fail-open pattern exactly: the caller who tried to tighten the check got the weaker one')
    check('  … and it did NOT quietly take the ceiling path either',
      !result.namesUnimplemented || !result.imported,
      'the malformed value was treated as absent, so the stricter setting silently became the looser one')
  }
}

console.log('')
if (failures > 0) {
  console.log(`  ${String(failures)} of ${String(arms)} arms FAILED — an unusable pin does not fail closed.`)
  console.log('  AUMLOK GATE REQUIRE GRANT: RED\n')
  process.exit(1)
}
console.log(`  ${String(arms)}/${String(arms)} arms green: absent is a NAMED CEILING, unusable is a REFUSAL, and `
  + '`requireGrant: true` fails closed.')
console.log('  AUMLOK GATE REQUIRE GRANT: GREEN\n')

// ── `--mutate`: THE PROTECTION REMOVED, AND THIS COURT REQUIRED TO GO RED (AUMLOK, 2026-09-26) ──────
//
// **THE LIST IN `tests/GREEN-ONLY.txt` IS SHRINK-ONLY**, so the fix for an entry is an arm rather than a
// line. This court loads its subject through `install.js`/`policy.js` at the top, so a mutation applied
// mid-file would arrive too late — `--mutate` therefore RE-RUNS THE COURT AS A CHILD with the subject
// mutated and requires it to fail. **That is the shape `aukora-court-seam-building` calls strongest**: it
// gives the property the gate asks for — the court fails on broken wiring — rather than a parallel check
// written by whoever built the arm.
//
// an unusable `requireGrant` is DROPPED and the call proceeds unpinned — the fail-open pattern exactly, where the caller who tried to tighten the check silently receives the weaker one
//
// **AND THE MUTATION GOES THROUGH `guardInPlace`**, which journals the original bytes outside the repository
// before writing and restores on every catchable signal, so a killed `--mutate` cannot leave the tree
// mutated — the failure measured in aumlok-106.
if (process.argv.includes('--mutate')) {
  console.log('\n── mutation ──')
  const caught = mutationArm({
    court: fileURLToPath(import.meta.url),
    subject: join(ROOT, 'plugins', 'aukora-composition-gate', 'src', 'install.js'),
    label: 'the malformed-pin refusal',
    from: "  if (typeof value !== 'boolean') throw refuseField(field, `must be a boolean, got ${typeof value}`);",
    to: '  if (false) throw refuseField(field, `must be a boolean, got ${typeof value}`);',
    say: (line) => { console.log(`        ${line}`) },
  })
  process.exit(caught ? 0 : 1)
}

process.exit(0)
