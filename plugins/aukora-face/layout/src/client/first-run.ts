/**
 * THE FIRST RUN — the decisions, kept out of the screen so a court can drive them.
 *
 * Peter wants people he gives repo access to to install AUKORA and **talk to their own Auma**. This module holds what
 * that first run decides, and the screen renders it. Nothing here reads the world: the host half hands in what it
 * found, and every function below is a pure answer about it.
 *
 * **THE THREE RULES THIS FILE EXISTS TO KEEP**
 *
 *  1. **A first run is a moment, not a mode.** It is shown when the state carries no owner profile, and the predicate
 *     below is the only place that decides — so "am I on a first run?" cannot drift between two screens.
 *  2. **Their key is a local secret and it never travels.** It is not logged, not put in a prompt, not rendered back
 *     to them in full, and it can be removed. `maskKey` is the only function that turns it into something printable,
 *     and it is written so that no input can make it return the key.
 *  3. **Unknown is an answer.** The status facts follow AUMA's own shape in
 *     `plugins/aukora-face/apps/src/status-facts.ts` — `{ known: true, … } | { known: false }` — because a status line
 *     that says "off" when it means "nobody told me" is the same lie as an empty memory list for a failed read.
 *
 * @module first-run
 */

/** One fact about the machine, in AUMA's shape: either known with its value, or honestly unknown. */
export type Fact<T> = { readonly known: true; readonly value: T } | { readonly known: false }

/** What a fact is about. These four are the ones a person needs on a first run. */
export const STATUS_TOPICS = ['voice', 'memory', 'approvals', 'messaging'] as const
export type StatusTopic = (typeof STATUS_TOPICS)[number]

/** The steps of the first run, in the order a person meets them. */
export const FIRST_RUN_STEPS = ['welcome', 'name', 'key', 'voice', 'done'] as const
export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number]

/**
 * Whether this state has no owner profile, and therefore gets a first run.
 *
 * **WHAT COUNTS AS A PROFILE** is a name the person gave — nothing else. A state directory exists as soon as the app
 * runs once, so its presence cannot mean "somebody has set this up"; and an empty name is not a name someone gave.
 */
export function isFirstRun(owner: { readonly name?: unknown } | null | undefined): boolean {
  if (owner === null || owner === undefined) return true
  return typeof owner.name !== 'string' || owner.name.trim() === ''
}

/** The step after this one, or null at the end — the screen never has to know the order itself. */
export function nextStep(step: FirstRunStep): FirstRunStep | null {
  const at = FIRST_RUN_STEPS.indexOf(step)
  return at < 0 || at === FIRST_RUN_STEPS.length - 1 ? null : FIRST_RUN_STEPS[at + 1] ?? null
}

/**
 * The only printable form of a model key: its last four characters, and nothing else.
 *
 * **A KEY THAT IS PRINTED IN FULL IS A KEY THAT IS IN A LOG, A SCREENSHOT AND A BUG REPORT.** A model key is short
 * and its tail is enough for a person to recognise which key they pasted, so the tail is all that is ever shown. The
 * result is built from a count, not from the key's own characters, so no input can make this return the key: a
 * four-character key is masked like any other.
 */
export function maskKey(key: string): string {
  const trimmed = key.trim()
  if (trimmed === '') return ''
  const tail = trimmed.length <= 4 ? '' : trimmed.slice(-4)
  return `••••${tail}`
}

/**
 * Whether the key the person typed is shaped like an OpenRouter key.
 *
 * **THIS IS A SHAPE CHECK AND IT SAYS SO.** It cannot tell whether a key works — only the provider can — so a screen
 * that refuses on this alone would be claiming an authority it does not have. It refuses empty input, and it names the
 * prefix the provider issues, which is what catches the commonest mistake: pasting something else entirely.
 */
export function keyLooksUsable(key: string): { readonly usable: boolean; readonly because: string | null } {
  const trimmed = key.trim()
  if (trimmed === '') return { usable: false, because: 'empty' }
  if (!trimmed.startsWith('sk-or-')) return { usable: false, because: 'prefix' }
  if (trimmed.length < 20) return { usable: false, because: 'too-short' }
  return { usable: true, because: null }
}

/**
 * Where the key is kept: a file inside the user's own state directory, never beside the checkout and never in a
 * settings document that gets exported. The path is built from the state root the caller passes in, so this function
 * never guesses where a person's home is.
 */
export function keyPathIn(stateRoot: string): string {
  return `${stateRoot.replace(/\/+$/u, '')}/secrets/openrouter-key`
}

/**
 * What the screen says about voice, before anything has been set up.
 *
 * **THE HONEST NOTE THE GOAL ASKS FOR**: voice on/off is a choice, and the choice that needs a one-time setup is the
 * one that keeps audio on this machine. Saying "voice on" and then failing to transcribe would be the worst version of
 * this screen, so the setup is named before the choice is offered.
 */
export function voiceSetupNote(choice: 'on' | 'off'): { readonly needsSetup: boolean; readonly key: string } {
  return choice === 'on' ? { needsSetup: true, key: 'firstRun.voice.onNote' } : { needsSetup: false, key: 'firstRun.voice.offNote' }
}

/** One row of the status line: which fact, and what is known about it. */
export interface StatusRow {
  readonly topic: StatusTopic
  /** The fact itself, in AUMA's shape. A screen renders `known: false` as "not known yet", never as off. */
  readonly fact: Fact<string>
}

/** The status line, in the order the topics are declared, with anything missing reported as unknown rather than off. */
export function statusRows(facts?: Partial<Record<StatusTopic, Fact<string>>> | null): readonly StatusRow[] {
  // **A FRESH MACHINE PASSES NOTHING AT ALL.** A first run happens before anything has reported, so `facts` is
  // routinely absent — and the first version of this function indexed it directly, which threw. The court caught it
  // by driving exactly that case, which is the case a real first run is.
  const known = facts ?? {}
  return STATUS_TOPICS.map(topic => ({ topic, fact: known[topic] ?? { known: false } }))
}
