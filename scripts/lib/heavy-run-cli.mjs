/**
 * Run one command under the heavy-run lock. Invoked by `scripts/heavy-run.sh -- <command>`.
 *
 * IT EXITS WITH THE COMMAND'S OWN CODE. A wrapper that swallowed the status would turn every red court green,
 * and a resource gate that hides failures is worse than no gate at all.
 */
import { spawn, spawnSync } from 'node:child_process'

import { withHeavyRun } from './heavy-run.mjs'

const [command, ...args] = process.argv.slice(2)

/** Say WHO holds the lock, not merely that it is held. A pid alone is not actionable. */
function describe(holder) {
  if (holder === null) {
    process.stderr.write('heavy-run: waiting — the lock exists and could not be read, so it is treated as '
      + 'held. A file nobody can parse is not evidence that its owner is gone.\n')
    return
  }
  process.stderr.write(`heavy-run: waiting for pid ${String(holder.pid)} since ${String(holder.startedAt)}\n`)
  process.stderr.write(`heavy-run:   ${String(holder.argv)}\n`)
}


/**
 * ══ THE MEMORY FLOOR, CHECKED AFTER THE LOCK AND IMMEDIATELY BEFORE `exec` ══════════════════════════════════
 *
 * Fable, 2026-09-26: a face build, a parity boot or a boot smoke dips memory hard (AK-UI measured 82 at launch and
 * 21 ninety seconds later; the machine touched 13 twice that morning), so those start only at
 * `kern.memorystatus_level` >= 50. Ordinary node courts keep the 35 gate.
 *
 * WHY HERE AND NOT IN THE CALLERS: the floor was LANE DISCIPLINE for a day — the face-build entry points have no
 * memory check of their own and this wrapper had none either, so nothing refused when the machine was at 13. A rule
 * that only discipline enforces is the shape this repository refuses.
 *
 * WHY AFTER THE LOCK: being queued at 71 is not evidence about the level when the slot is finally granted. The
 * reading is taken here, inside `withHeavyRun`, which means the lock is HELD at that moment — and the refusal
 * RETURNS rather than calling `process.exit`, because `process.exit` would skip the `finally` that releases the lock
 * and a refusal must never wedge the machine-wide queue behind it.
 */
const HEAVY_VERBS = [
  'build-face', 'build-dsh', 'materialize-aukora-release', 'desktop-parity-boot', 'release-boot-smoke',
  'cut-release', 'docker run', 'rehearse-all',
]
const HEAVY_FLOOR = 50
const ORDINARY_FLOOR = 35

/** Which floor this command needs. A command that merely NAMES a heavy verb gets the stricter floor: a false
 * positive costs a wait, a false negative costs the machine. */
function floorFor(command, args) {
  const line = [command, ...args].join(' ')
  const verb = HEAVY_VERBS.find(candidate => line.includes(candidate))
  return { floor: verb === undefined ? ORDINARY_FLOOR : HEAVY_FLOOR, why: verb ?? 'an ordinary command' }
}

/** The reading, or the stub a COURT sets so its arms do not depend on the host's memory. */
function readLevel() {
  const stub = process.env.AUKORA_HEAVY_LEVEL
  if (stub !== undefined && stub !== '') return { level: Number(stub.trim()), stubbed: true }
  const read = spawnSync('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_level'], { encoding: 'utf8' })
  return { level: Number((read.stdout ?? '').trim()), stubbed: false }
}

/** MACHINE SAFETY REFUSED, by name, with the reading that produced it. */
function refuseFloor(name, detail) {
  process.stderr.write(`MACHINE SAFETY REFUSED: ${name}: ${detail}\n`)
}

const tier = floorFor(command, args)
const override = process.env.AUKORA_HEAVY_FLOOR
const floor = override === undefined || override === '' ? tier.floor : Number(override.trim())

const code = await withHeavyRun(async () => {
  // ── THE FLOOR, READ HERE: THE LOCK IS HELD AND NOTHING HAS BEEN EXECUTED YET ──────────────────────────────
  const { level, stubbed } = readLevel()
  if (!Number.isFinite(level) || !Number.isFinite(floor)) {
    refuseFloor('memory-floor-unreadable',
      `kern.memorystatus_level could not be read (got ${JSON.stringify(process.env.AUKORA_HEAVY_LEVEL ?? 'no usable sysctl output')}) and this command needs ${String(floor)} at launch, so it is refused rather than started on a guess`)
    return 2
  }
  if (level < floor) {
    refuseFloor('memory-below-floor',
      `kern.memorystatus_level is ${String(level)} and ${tier.why} needs ${String(floor)} at launch — memory dips after the start, so the reading that matters is this one`)
    return 2
  }
  process.stderr.write(`heavy-run: memory floor: level ${String(level)} >= ${String(floor)} at launch (${tier.why})`
    + `${stubbed ? ' [AUKORA_HEAVY_LEVEL stub]' : ''}${override ? ' [AUKORA_HEAVY_FLOOR override]' : ''}\n`)
  // *** THE WRAPPER DECLARES ITSELF TO ITS CHILD, SO A HARNESS CAN PROVE IT IS UNDER THE LOCK. ***
  // `machine-guard.sh`'s `guard_under_heavy_run` requires this variable, AND UNTIL THIS LINE EXISTED IT COULD
  // NEVER BE SET -- the wrapper exported no `AUKORA_HEAVY_RUN_*` variable at all, so the guard refused EVERY
  // run, including the correct ones:
  //     MACHINE SAFETY REFUSED: THIS HARNESS ... IS NOT RUNNING INSIDE scripts/heavy-run.sh.
  //     RUN IT AS:  ./scripts/heavy-run.sh -- scripts/ci/rehearse-all.sh
  // -- PRINTED BY A PROCESS THAT WAS, AT THAT MOMENT, WAITING FOR THE WRAPPER'S OWN LOCK.
  // *** A GUARD THAT REFUSES EVERYTHING IS AS BROKEN AS ONE THAT REFUSES NOTHING, AND THIS ONE ALSO PRINTED
  // INSTRUCTIONS THE CALLER HAD ALREADY FOLLOWED. *** The variable's VALUE is the lock path, which is the fact
  // the guard actually wants: not "some ancestor was a script" but "the lock for this machine is held".
  const child = spawn(command, args, {
    stdio: 'inherit',
    // THE VALUE IS A MARKER AND NOT THE PATH, DELIBERATELY: THE GUARD'S QUESTION IS "IS THE MACHINE-WIDE LOCK
    // HELD", NOT "WHAT IS IT CALLED" -- and the path lives inside `heavy-run.mjs`, so exporting the name would
    // mean plumbing it out for no gain. This line runs INSIDE `withHeavyRun`, SO REACHING IT MEANS THE LOCK IS
    // ALREADY HELD. A MARKER SET AT THAT POINT IS THEREFORE THE FACT ITSELF AND NOT A CLAIM ABOUT IT.
    env: { ...process.env, AUKORA_HEAVY_RUN_LOCK: 'held', AUKORA_HEAVY_RUN_HOLDER: String(process.pid) },
  })
  return await new Promise(resolvePromise => {
    child.on('exit', (status, signal) => {
      // A COMMAND KILLED BY A SIGNAL IS NOT A SUCCESS. `status` is null then, and reporting 0 would hide it.
      resolvePromise(signal === null ? (status ?? 1) : 128)
    })
    child.on('error', error => {
      process.stderr.write(`heavy-run: could not run ${command}: ${String(error?.message ?? error)}\n`)
      resolvePromise(127)
    })
  })
}, { onWait: describe })

process.exit(code)
