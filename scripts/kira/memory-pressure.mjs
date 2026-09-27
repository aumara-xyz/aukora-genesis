/**
 * THE MACHINE'S PRESSURE SIGNAL, READ FROM THE PLATFORM THAT PUBLISHES IT.
 *
 * Its own module because the command is a SCRIPT: importing it runs it, and a court that has to run the whole job to reach the parser
 * tests the wrong thing. This module does nothing on import.
 *
 *   darwin  `sysctl -n kern.memorystatus_level`            — the value macOS publishes, 0..100.
 *   linux   `/proc/meminfo` MemAvailable/MemTotal, as a percentage.
 *
 * *** IT READ A macOS-ONLY sysctl AND SO REFUSED EVERY RUN ON LINUX. *** Fable measured it on `bf564e7`: keyless-courts is Linux,
 * `kern.memorystatus_level` does not exist there, the gate refused by name, and four of the housekeeping court's arms failed for a
 * reason that had nothing to do with what they test. The rule it protects is right — REFUSE RATHER THAN ASSUME — and the signal had to
 * become the platform's own.
 *
 * INJECTABLE (`platform`, `runCommand`, `readFile`) so a court drives BOTH readers with their REAL formats on any host: the difference
 * between testing the parser and stubbing the gate.
 *
 * @module @aukora/dsh-plugin-kira/memory-pressure
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * THE MACHINE'S OWN PRESSURE SIGNAL, WHICHEVER MACHINE THIS IS.
 *
 * *** THIS READ A macOS-ONLY sysctl AND SO REFUSED EVERY RUN ON LINUX. *** Fable measured it on `bf564e7`: the keyless-courts job is
 * Linux, `kern.memorystatus_level` does not exist there, the gate refused by name, and four of this court's arms failed for a reason
 * that had nothing to do with what they test. The rule it was protecting is right — refuse rather than assume — and the SIGNAL had to
 * become the platform's own:
 *
 *   darwin  `sysctl -n kern.memorystatus_level`   — the value macOS publishes, 0..100.
 *   linux   `/proc/meminfo` `MemAvailable`/`MemTotal`, as a percentage.
 *
 * INJECTABLE (`platform`, `runCommand`, `readFile`) so a court can drive BOTH readers with their REAL formats on any host, which is the
 * difference between testing the parser and stubbing the gate. The refusal stays, and it now names both signals.
 *
 * @param {{platform?: string, runCommand?: Function, readFile?: Function}} [options]
 * @returns {{level: number|null, source: string|null}}
 */
export function readMemoryLevel(options = {}) {
  const platform = String(options.platform ?? process.platform)
  const runCommand = options.runCommand ?? ((file, args) => execFileSync(file, args, { encoding: 'utf8' }))
  const readFile = options.readFile ?? (file => readFileSync(file, 'utf8'))
  const darwin = () => {
    try {
      const value = Number(String(runCommand('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_level'])).trim())
      return Number.isFinite(value) ? value : null
    } catch { return null }
  }
  const linux = () => {
    try {
      const text = String(readFile('/proc/meminfo'))
      const pick = name => {
        const found = text.match(new RegExp(`^${name}:\\s+(\\d+)\\s*kB`, 'mu'))
        return found === null ? null : Number(found[1])
      }
      const available = pick('MemAvailable')
      const total = pick('MemTotal')
      if (available === null || total === null || total <= 0) return null
      return Math.round((available / total) * 100)
    } catch { return null }
  }
  // THIS PLATFORM'S READER FIRST, then the other one, so an unusual host still answers if either signal is there.
  const order = platform === 'linux' ? [['linux', linux], ['darwin', darwin]] : [['darwin', darwin], ['linux', linux]]
  for (const [name, read] of order) {
    const level = read()
    if (Number.isFinite(level)) return { level, source: name }
  }
  return { level: null, source: null }
}
