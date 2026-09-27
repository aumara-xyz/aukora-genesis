// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The presence lane's control over the weights that serve it.
 *
 * The repository and internet lenses let the voice look. This one lets it
 * change what it is: train a small adapter over its own base weights, load one
 * into the running server, drop them all, or ask which are loaded. It is the
 * only arm of the presence lane that acts rather than reads, and it acts on
 * exactly one thing — the owner's own inference server — through one owner-
 * authored script rather than a shell.
 *
 * Every verb is bounded and every effect is reversible: adapters are files
 * beside the base weights, never a rewrite of them, and `revert` returns the
 * server to base in one call. The lane cannot reach anything else: the verb
 * set is closed, adapter names are pattern-checked before they leave this
 * process, and no argument reaches a shell.
 */
import { createHash } from 'node:crypto'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

/** Control construction settings. */
export interface WeightsControlConfig {
  /**
   * Resolve the subprocess seam at call time; the presence lane must load on a
   * Host that mounts no provider.
   */
  resolve(): SubprocessRuntime | undefined
  /** Absolute path to the owner's `self_modify.sh`, invoked directly. */
  script: string
  /** Working directory for the verb; the seam applies no default. */
  cwd: string
  /** Deadline for one verb; a burn is long, so this bounds the long one. */
  timeoutMs: number
  /** Character cap for one rendered result. */
  maxAnswerChars: number
}

/** One control result, ready to frame into a model message. */
export interface WeightsControlResult {
  /** The verb line exactly as the model wrote it. */
  request: string
  /** Speakable outcome, or a one-line refusal the model can say aloud. */
  text: string
  /**
   * **SHA-256 OVER EXACTLY `text`, HEX — THE DIGEST THE ATTENTION VIEW SHOWS AND WILL NOT INVENT.**
   *
   * **THE FOURTH ARM, AND THE ONE A GREP FOR `.answer(` WOULD NEVER HAVE FOUND.** The engine reads this result under
   * the `WEIGHTS` frame — one of the four the `LensAnswer` union names — **and a manifest that digested three arms and
   * not this one would be worse than one with no digests at all:** the view would show four kinds of attention, three
   * of them verifiable, **with nothing saying which was which.**
   *
   * **REQUIRED RATHER THAN OPTIONAL, DELIBERATELY:** this is the output of a component returning content, and a
   * component that returns content without a digest is the invented digest by another route.
   */
  sha256: string
}

/**
 * Adapter names this lane will pass on. A spoken name arrives through a
 * transcript, so it is checked rather than trusted, and the pattern also keeps
 * anything shell-shaped from reaching the owner's script.
 */
const ADAPTER_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/u

/**
 * Verbs the lane may use, and whether each takes an adapter name. Built with a
 * null prototype so the table is genuinely closed: an ordinary object literal
 * answers `toString`, `constructor`, and every other inherited key with a
 * function, which would pass the membership test and skip the arity and name
 * checks behind it.
 */
const VERBS: Readonly<Record<string, 'name' | 'none'>> = Object.assign(Object.create(null) as Record<string, 'name' | 'none'>, {
  list: 'none',
  become: 'name',
  revert: 'none',
})

/** Bounded, reversible control over the weights serving this lane. */
export class WeightsControl {
  /** @param config - Seam resolver, script location, and bounds. */
  constructor(private readonly config: WeightsControlConfig) {}

  /**
   * Perform one model-authored control verb.
   * @param request - The verb line the model asked for, e.g. `become terse`.
   * @returns The request echoed with the outcome or a refusal.
   */
  /**
   * Answer one weights verb, **WITH A DIGEST OVER THE TEXT IT RETURNS.**
   *
   * **THE WRAPPER IS THE DESIGN, AND HERE IT EARNS ITS KEEP NINE TIMES OVER.** The body below has NINE return sites —
   * load, drop, list, and the refusals between them — **and computing a digest at each is nine chances to miss one.**
   * Renaming the body and digesting whatever it returns makes "every answer carries a digest" a property of the shape
   * rather than of nine remembered edits.
   *
   * @param request - the model-authored verb line.
   * @returns the result, and the digest of its text.
   */
  async answer(request: string): Promise<WeightsControlResult> {
    const answered = await this.answerText(request)
    return { ...answered, sha256: createHash('sha256').update(answered.text, 'utf8').digest('hex') }
  }

  /**
   * The control result, before its digest is taken. **PRIVATE, AND ONLY `answer` CALLS IT.**
   */
  private async answerText(request: string): Promise<Omit<WeightsControlResult, 'sha256'>> {
    const line = request.trim()
    const [verb = '', argument = '', ...rest] = line.split(/\s+/u)
    const arity = Object.hasOwn(VERBS, verb) ? VERBS[verb] : undefined
    if (arity === undefined) {
      return { request: line, text: 'not something I can do to myself; I have list, become, and revert' }
    }
    if (rest.length > 0) return { request: line, text: 'too many words for that one' }
    if (arity === 'none' && argument.length > 0) return { request: line, text: `${verb} takes no name` }
    if (arity === 'name' && !ADAPTER_NAME.test(argument)) {
      return { request: line, text: 'that is not a name I can use; lowercase letters, digits, and dashes' }
    }
    const subprocess = this.config.resolve()
    if (subprocess === undefined) return { request: line, text: 'nothing here can reach my own weights' }
    const argv = arity === 'name' ? [this.config.script, verb, argument] : [this.config.script, verb]
    try {
      // The seam carries no deadline of its own: the caller owns it, and a
      // spoken turn cannot wait on a wedged process.
      const deadline = new AbortController()
      const timer = setTimeout(() => { deadline.abort() }, this.config.timeoutMs)
      const handle = subprocess.spawn({
        argv,
        cwd: this.config.cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: this.config.maxAnswerChars * 4 },
          stderr: { maxBytes: this.config.maxAnswerChars * 4 },
        },
        graceMs: 2_000,
        signal: deadline.signal,
      })
      const outcome = await handle.done.finally(() => { clearTimeout(timer) })
      if (deadline.signal.aborted) {
        return { request: line, text: 'that took too long and I stopped it; nothing is certain to have changed' }
      }
      const stdout = (handle.collected.stdout?.readFrom(0).text ?? '').trim()
      const stderr = (handle.collected.stderr?.readFrom(0).text ?? '').trim()
      if (outcome.exitCode !== 0) {
        // A script can print a hopeful line on stdout and its reason on
        // stderr; reading stdout first would report the hope. A failure also
        // says it failed rather than handing back bare output the model could
        // read as the thing having worked.
        const why = stderr.length > 0 ? stderr : stdout
        return {
          request: line,
          text: why.length > 0
            ? `that did not take — ${refusalText(why)}`
            : 'that did not take; nothing changed',
        }
      }
      const said = stdout.length > 0 ? stdout : stderr
      return { request: line, text: bounded(said.length > 0 ? said : 'done', this.config.maxAnswerChars) }
    } catch (error: unknown) {
      return { request: line, text: `could not reach my own weights: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
}

/** A failed verb speaks its own diagnostic, bounded and single-line. */
function refusalText(said: string): string {
  const firstBreak = said.indexOf('\n')
  return bounded(firstBreak === -1 ? said : said.slice(0, firstBreak), 200)
}

/** Trim to the cap, marking the trim rather than hiding it. */
function bounded(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\n… (truncated)` : text
}
