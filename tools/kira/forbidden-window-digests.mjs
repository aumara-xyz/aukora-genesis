#!/usr/bin/env node
/**
 * GENERATE THE FORBIDDEN-PHRASE DIGESTS — run by the person who owns the phrases, and by nobody else.
 *
 *   node tools/kira/forbidden-window-digests.mjs [--state-dir <path>]
 *
 * WHY (Fable's boot-risk review of HEAD, 2026-09-25). An empty digest list makes the compaction export refuse
 * every candidate as `not-configured` — correct, because an empty list used to allow everything while reading as
 * enforced. But nobody had configured one, so the live app would have stopped staging Kira summaries the moment
 * the next release went live. This tool is how the prohibition becomes real without a phrase entering the
 * repository, a shell history, a clipboard, an environment variable or an argument vector.
 *
 * HOW IT READS. One phrase per line, FROM THE TTY, WITH ECHO OFF (`stty -echo`, restored on every exit path,
 * including Ctrl-C). Nothing is echoed by the terminal and nothing is echoed by this program: readline runs with
 * `terminal: false` precisely because its line editor would print the characters back and defeat the point. NOTHING
 * IS ECHOED, SO TYPE CAREFULLY — the only thing that comes back is a count.
 *
 * WHAT IT WRITES. `forbidden-window-digests.json` in the Kira state directory, mode 0600, durably: the sha256 of
 * every three-word window of every phrase, which is exactly what `carriesForbiddenPhrase` looks for. NO PHRASE AND
 * NO WORD OF A PHRASE IS EVER WRITTEN, anywhere. Each phrase is digested as it is read and then dropped — the tool
 * never accumulates plaintext, not even in memory.
 *
 * WHAT IT PRINTS. THE COUNT OF PHRASES RECORDED, and nothing else, on stdout. The prompts and the destination go to
 * stderr, so `stdout` is a number a script can use.
 *
 * ARGUMENTS ARE NOT A WAY IN, ON PURPOSE: the only accepted argument is `--state-dir <path>`, and anything else is
 * refused by name. A phrase can therefore never arrive through argv, and no environment variable is read for one.
 *
 * EXIT CODES. 0 wrote the digests; 2 the usage was wrong; 3 refused, with a NAME on stderr.
 *
 * @module tools/kira/forbidden-window-digests
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { writeForbiddenDigests, FORBIDDEN_DIGESTS_FILE } from '../../plugins/aukora-kira/lib/forbidden-digests.mjs'
import { windowDigests } from '../../plugins/aukora-kira/lib/compaction-export.mjs'
import { isMainModule } from '../../scripts/lib/is-main.mjs'

const EXIT_REFUSED = 3

/** A refusal with a NAME, so a caller — or a person — can tell which one happened. */
export class ForbiddenDigestsRefusal extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ForbiddenDigestsRefusal'
    this.code = code
  }
}
const refuse = (code, message) => { throw new ForbiddenDigestsRefusal(code, message) }

/**
 * THE TTY'S ECHO, AS A VALUE A COURT CAN REPLACE. `stty` acts on its own stdin, which is the terminal this process
 * was given; the phrase is not passed to it and never appears in its arguments.
 */
export const sttyEcho = (streams = process) => ({
  off: () => spawnSync('stty', ['-echo'], { stdio: [streams.stdin, 'ignore', 'ignore'] }),
  on: () => spawnSync('stty', ['echo'], { stdio: [streams.stdin, 'ignore', 'ignore'] }),
})

/**
 * READ ONE PHRASE PER LINE FROM THE TTY, ECHO OFF. Returns a function that resolves to the phrase, or to null when
 * the person is done (an empty line, EOF, or Ctrl-D).
 *
 * @param {{stdin?: NodeJS.ReadStream, err?: NodeJS.WriteStream, echo?: {off: Function, on: Function},
 *          prompt?: (n: number) => string}} [options]
 */
export function ttyPhraseReader(options = {}) {
  const stdin = options.stdin ?? process.stdin
  const err = options.err ?? process.stderr
  const echo = options.echo ?? sttyEcho({ stdin })
  const promptOf = options.prompt ?? (n => (n === 0
    ? 'Type each forbidden phrase, one per line. NOTHING IS ECHOED — type carefully. Empty line when done.\n'
    : ''))
  if (stdin.isTTY !== true) {
    // A PIPE IS NOT A TTY AND IS NOT ACCEPTED. A phrase arriving from a pipe came from something that already had
    // it — a shell history, a file, a clipboard — and this tool's whole point is that it never does.
    refuse('not-a-tty', 'this must be run at a terminal: a phrase piped in came from somewhere that already held it')
  }
  const rl = createInterface({ input: stdin, terminal: false })
  const lines = rl[Symbol.asyncIterator]()
  let asked = 0
  let restored = false
  const restore = () => { if (!restored) { restored = true; try { echo.on() } catch { /* the terminal is gone */ } } }
  // EVERY EXIT PATH RESTORES THE ECHO: the normal end, a thrown refusal, Ctrl-C, and a terminated process.
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { restore(); process.exit(EXIT_REFUSED) })
  return async () => {
    err.write(promptOf(asked))
    asked += 1
    echo.off()
    try {
      const next = await lines.next()
      if (next.done === true) { restore(); return null }
      const line = String(next.value ?? '')
      if (line.trim() === '') { restore(); return null }
      return line
    } finally {
      // ECHO COMES BACK BEFORE ANYTHING ELSE HAPPENS WITH THE PHRASE, so even the digesting below happens with a
      // usable terminal in front of the person.
      restore()
    }
  }
}

/**
 * THE GENERATION ITSELF, WITH THE READER AND THE STREAMS INJECTED so a court can drive every branch without a
 * terminal. Reads one phrase at a time, digests it, and DROPS IT: the only thing that accumulates is digests.
 *
 * @param {{stateDir: string, ask: () => Promise<string|null>, out?: {write: Function}, err?: {write: Function}}}
 * @returns {Promise<{phrases: number, digests: number, path: string}>}
 */
export async function generate({ stateDir, ask, out = process.stdout, err = process.stderr }) {
  if (typeof stateDir !== 'string' || stateDir.trim() === '') {
    refuse('no-state-dir', 'the Kira state directory must be named: pass --state-dir <path>')
  }
  const digests = new Set()
  let phrases = 0
  for (;;) {
    const phrase = await ask()
    if (phrase === null) break
    const trimmed = String(phrase).trim()
    if (trimmed === '') break
    const windows = windowDigests(trimmed)
    if (windows.length === 0) {
      // FEWER THAN THREE WORDS: there is no window to store, so the check could never catch this phrase and the
      // count would lie about what is protected.
      refuse('phrase-too-short', 'a phrase of fewer than three words has no window to store; make it longer')
    }
    for (const digest of windows) digests.add(digest)
    phrases += 1
  }
  if (phrases === 0) refuse('no-phrases', 'no phrase was recorded, so no file was written and nothing is configured')
  // `digests` ALREADY HOLDS WINDOW DIGESTS — each phrase was digested as it was read, and dropped. Passing them
  // back through `digestsOfPhrases` (which digests PHRASES) digested the digests: a 64-hex string is one word, so
  // it has no three-word window and the file came out EMPTY while the count said otherwise. MEASURED — the court
  // caught it at "one digest per three-word window of the phrase".
  const path = writeForbiddenDigests(stateDir, [...digests])
  err.write(`recorded ${String(phrases)} phrase(s) as ${String(digests.size)} window digest(s) in ${path}\n`)
  return { phrases, digests: digests.size, path }
}

/**
 * THE STORE, FOUND BY ITS OWN FILES rather than by a path this tool invents. A Kira state directory holds an
 * `objects` directory, or a `keys` directory, or an `aura.jsonl`; a directory that holds none of them is not one.
 * Ambiguity is REFUSED with the candidates named, because writing digests into a directory the app does not read
 * would configure nothing while looking like success.
 */
export function discoverStateDir({ home = homedir(), exists = existsSync, list = readdirSync } = {}) {
  const roots = [join(home, '.aukora'), join(home, '.local', 'state', 'aukora')]
  const looks = dir => ['objects', 'keys', 'aura.jsonl', FORBIDDEN_DIGESTS_FILE].some(one => exists(join(dir, one)))
  const candidates = []
  for (const root of roots) {
    if (!exists(root)) continue
    if (looks(root)) candidates.push(root)
    let entries = []
    try { entries = list(root) } catch { entries = [] }
    for (const entry of entries) {
      const child = join(root, String(entry))
      try { if (looks(child)) candidates.push(child) } catch { /* not a directory */ }
    }
  }
  const unique = [...new Set(candidates)].sort()
  if (unique.length === 1) return { stateDir: unique[0], candidates: unique }
  return { stateDir: null, candidates: unique }
}

/**
 * WHAT STDOUT CARRIES, IN ONE PLACE: the number of phrases recorded, and nothing else. The human-readable summary
 * goes to stderr, so a wrapper that captures stdout gets a number it can use and never a digest or a phrase.
 * @param {{phrases: number}} result @returns {string}
 */
export const countLine = result => `${String(result.phrases)}\n`

/** The argument vector, parsed so that ONLY a state directory can come through it. */
export function parseArgs(argv) {
  const out = { stateDir: null, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { out.help = true; continue }
    if (arg === '--state-dir') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value.trim() === '') refuse('usage', '--state-dir needs a path')
      out.stateDir = value
      i += 1
      continue
    }
    // ANYTHING ELSE IS REFUSED BY NAME. This is what makes argv a dead end for a phrase.
    refuse('unknown-argument', `unknown argument ${JSON.stringify(arg)}; the only argument is --state-dir <path>`)
  }
  return out
}

const USAGE = `usage: node tools/kira/forbidden-window-digests.mjs [--state-dir <path>]

  Reads each forbidden phrase from the terminal WITH ECHO OFF, one per line, an empty line to finish.
  Writes sha256 digests of every three-word window to ${FORBIDDEN_DIGESTS_FILE} (mode 0600) in the Kira
  state directory. Prints the number of phrases recorded, and nothing else.

  --state-dir <path>   the Kira state directory; discovered from this machine when omitted.
`

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv)
  if (parsed.help) { process.stdout.write(USAGE); return 0 }
  const stateDir = parsed.stateDir ?? discoverStateDir().stateDir
  if (stateDir === null) {
    const found = discoverStateDir().candidates
    refuse('no-state-dir', found.length === 0
      ? 'no Kira state directory was found on this machine; pass --state-dir <path>'
      : `more than one Kira state directory was found (${found.join(', ')}); pass --state-dir <path>`)
  }
  const result = await generate({ stateDir: resolve(String(stateDir)), ask: ttyPhraseReader() })
  // THE COUNT AND NOTHING ELSE, so a script can read this.
  process.stdout.write(countLine(result))
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = await main()
  } catch (error) {
    const code = error instanceof ForbiddenDigestsRefusal ? error.code : String(error?.code ?? 'unexpected')
    process.stderr.write(`forbidden-window-digests: ${code} — ${String(error?.message ?? error)}\n`)
    process.exitCode = error instanceof ForbiddenDigestsRefusal ? EXIT_REFUSED : 1
  }
}
