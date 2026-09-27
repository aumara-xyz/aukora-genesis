/**
 * SHE FEELS INSTANT EVEN ON A DEEP MIND.
 *
 * Opus takes 1.5–4 s to its first token, and a voice that goes silent that long reads as broken even when it is
 * working perfectly. So when the chosen mind is slow, a tiny reflex request goes out **in parallel** on
 * `deepseek-v4.1-flash` and speaks one short acknowledgement.
 *
 * **THE REFLEX SAYS NOTHING.** It is not a partial answer, not a summary, not a hedge — it is the sound of someone
 * about to speak. So it carries no claims, no facts, no tags, no `[core]`, no citations and no numbers, and
 * {@link reflexViolation} refuses any of those and substitutes a fixed phrase. **A reflex that says something is
 * worse than silence**, because it will be believed: it arrives first, in her voice, and the deep answer that
 * corrects it arrives seconds later to an owner who has already been told something.
 *
 * **IF THE DEEP ANSWER IS READY FIRST, THE REFLEX IS NEVER SPOKEN.** Cancelled, not raced — an acknowledgement
 * that lands after the answer is an interruption.
 *
 * **AND IT IS NOT A TURN.** The reflex is never written to her store and never replayed as anything; only the deep
 * answer is the turn. A reflex in the ring would come back later as something she said, which is the same failure
 * in a slower form.
 *
 * @module reflex
 */

/** The minds slow enough to need an acknowledgement. `deep` is Astra; both are seconds to first token. */
export const SLOW_MINDS: readonly string[] = Object.freeze(['opus', 'deep'])

/** What the reflex runs on. Cheap and fast, and the same id the balanced mind uses. */
export const REFLEX_MODEL = 'deepseek/deepseek-v4.1-flash'

/** At most this many words. Short enough to be an acknowledgement rather than a remark. */
export const REFLEX_MAX_WORDS = 12

/** Tokens allowed for the reflex. Small on purpose: the cap prices this, and a long reflex is a second answer. */
export const REFLEX_MAX_TOKENS = 24

/** What is said when the reflex model produces something it may not say. */
export const FIXED_PHRASE = 'One moment — let me think about that.'

/** Whether this mind is slow enough that silence would read as broken. */
export function mindIsSlow(mindId: string): boolean {
  return SLOW_MINDS.includes(String(mindId))
}

/**
 * The instruction the reflex model is given.
 *
 * It is told, in as few words as possible, what it is for and what it must not do — because a model asked for "a
 * short acknowledgement" will otherwise answer the question.
 *
 * @returns the prompt.
 */
export function reflexPrompt(): string {
  return `You are the reflex of a voice assistant whose real answer is still being composed. Reply with ONE short `
    + `acknowledgement of at most ${String(REFLEX_MAX_WORDS)} words that says NOTHING about the question: no facts, `
    + `no claims, no numbers, no names, no tags, no citations, no advice, no partial answer. It is the sound of `
    + `someone about to speak. Output the words only.`
}

/**
 * Why a reflex may not be spoken, or null when it may.
 *
 * **EVERY RULE HERE IS SOMETHING THAT WOULD BE BELIEVED.** A number or a name would be taken as a fact; a tag
 * would be taken as an instruction; a citation would be taken as a claim about the chain. The reflex arrives
 * first and in her voice, so anything it asserts is asserted with her authority and corrected only seconds later.
 *
 * @param text - what the reflex model produced.
 * @returns the reason, or null.
 */
export function reflexViolation(text: string): string | null {
  const body = String(text ?? '').trim()
  if (body === '') return 'the reflex was empty'
  if (body.split(/\s+/u).length > REFLEX_MAX_WORDS) {
    return `the reflex ran to ${String(body.split(/\s+/u).length)} words, past the ${String(REFLEX_MAX_WORDS)}-word `
      + 'limit, which makes it a remark rather than an acknowledgement'
  }
  if (/\[/u.test(body)) return 'the reflex carried a tag, and a tag is an instruction'
  if (/<<<|>>>/u.test(body)) return 'the reflex carried a machine frame'
  // A bare digit is a fact in waiting: costs, counts, dates, positions, versions.
  if (/\d/u.test(body)) return 'the reflex carried a number, and a number is a claim'
  if (/aura|sequence|verified|record|kira/iu.test(body)) {
    return 'the reflex carried a citation or a memory reference'
  }
  return null
}

/**
 * What may actually be spoken: the reflex, or the fixed phrase when it broke a rule.
 *
 * @param text - what the reflex model produced.
 * @returns the words to speak, and why they were replaced.
 */
export function safeReflex(text: string): { spoken: string; replaced: string | null } {
  const violation = reflexViolation(text)
  return violation === null
    ? { spoken: String(text).trim(), replaced: null }
    : { spoken: FIXED_PHRASE, replaced: violation }
}

/** Why no acknowledgement was spoken. */
export type ReflexCancelReason =
  | 'mind-not-slow'
  | 'reflex-price-unknown'
  | 'reflex-over-cap'
  | 'deep-was-ready'
  | 'reflex-failed'

/** What one turn's reflex amounted to. */
export interface ReflexOutcome {
  /** The words spoken, or null when nothing was. */
  readonly spoken: string | null
  /** Why nothing was spoken, or null when something was. */
  readonly cancelled: ReflexCancelReason | null
  /** Why the reflex was replaced with the fixed phrase, or null when it was not. */
  readonly replaced: string | null
  /** Whether the reflex dispatch was priced against the cap. */
  readonly priced: boolean
  /** The reflex's cost in USD, when it was priced and allowed. */
  readonly usd: number
}

/** The spend gate, as far as this module reads it. */
export interface ReflexGate {
  readonly check: (turn: { model: string; inputChars: number; maxTokens: number }) => {
    readonly allowed: boolean
    readonly reason: string
    /** **`estimatedUsd`, WHICH IS THE SPEND GATE'S REAL FIELD NAME.** An invented `usd` made this gate
     * structurally incompatible with the deployment's own `SpendVerdict`, which the compiler caught and the
     * courts could not — they used the stub. */
    readonly estimatedUsd: number | null
  }
  readonly record: (usd: number) => void
  /**
   * Check and hold in one synchronous step, when the gate offers it.
   *
   * **THE REFLEX IS A DISPATCH AND HAS TO HOLD ITS OWN BUDGET.** With only `check`, the reflex's cost was computed
   * and never charged — so a slow turn spent money the cap never saw, and two slow turns in one turn could both
   * price themselves against the same remaining budget.
   */
  readonly reserve?: ((turn: { model: string; inputChars: number; maxTokens: number }) => {
    readonly allowed: boolean
    readonly reason: string
    readonly estimatedUsd: number | null
  }) | undefined
}

/**
 * Run one reflex against one deep request.
 *
 * **THE TWO GO OUT TOGETHER.** `reflex` and `deepReady` are started before either is awaited, so the
 * acknowledgement is not waiting behind the answer it exists to cover.
 *
 * @param options - the mind, the two promises, the gate and where to speak.
 * @returns what happened.
 */
export async function raceReflex(options: {
  mind: string
  reflex: Promise<string>
  deepReady: Promise<unknown>
  speak: (text: string) => void
  gate?: ReflexGate | undefined
  inputChars?: number
  onRefused?: (reason: ReflexCancelReason, detail: string) => void
  /**
   * **A HOLD `reflexTurn` ALREADY TOOK, BECAUSE IT STARTED THE FETCH ITSELF.**
   *
   * `reflexTurn` now asks the gate before it calls `requestReflex` — the request must not reach the wire before the cap
   * has been consulted. **This function is therefore entered with the money already committed, and reserving again
   * would hold one reflex's worst case twice.** That failure costs the owner a working turn rather than a dollar, which
   * is why the hold is passed down instead of taken twice.
   */
  alreadyPriced?: { usd: number } | undefined
}): Promise<ReflexOutcome> {
  const nothing = (cancelled: ReflexCancelReason, detail: string): ReflexOutcome => {
    options.onRefused?.(cancelled, detail)
    return { spoken: null, cancelled, replaced: null, priced: false, usd: 0 }
  }

  if (!mindIsSlow(options.mind)) return nothing('mind-not-slow', `${options.mind} answers fast enough`)

  // **PRICED BEFORE IT IS SENT, LIKE ANY OTHER DISPATCH.** An unknown price REFUSES — the doctrine is that an
  // unknown input never defaults open, and a "free" reflex that is not in the price table is exactly the unknown
  // the rule exists for.
  //
  // **AND THE HOLD IS NOT TAKEN TWICE.** `reflexTurn` reserves before it starts the fetch, so when it calls this
  // function the money is already committed — see `alreadyPriced`. Reserving here as well would count one reflex
  // twice.
  let usd = options.alreadyPriced?.usd ?? 0
  if (options.gate !== undefined && options.alreadyPriced === undefined) {
    // **`reserve` WHEN THE GATE HAS IT, `check` WHEN IT DOES NOT.** Reserving holds the reflex's worst case from
    // the moment of the decision; the older `check` still prices it, it just does not hold the budget.
    const priced = { model: REFLEX_MODEL, inputChars: options.inputChars ?? reflexPrompt().length,
      maxTokens: REFLEX_MAX_TOKENS }
    const verdict = options.gate.reserve === undefined
      ? options.gate.check(priced)
      : options.gate.reserve(priced)
    if (!verdict.allowed) {
      return nothing(verdict.reason === 'price-unknown' ? 'reflex-price-unknown' : 'reflex-over-cap',
        `the reflex was not sent: ${verdict.reason}`)
    }
    usd = verdict.estimatedUsd ?? 0
  }

  // The reflex promise is already in flight; a rejection must not become an unhandled rejection when the deep
  // answer wins the race, so it is caught here and turned into a sentinel.
  const reflex = options.reflex.then(text => ({ kind: 'reflex' as const, text }), () => ({ kind: 'failed' as const }))
  const winner = await Promise.race([reflex, options.deepReady.then(() => ({ kind: 'deep' as const }))])

  if (winner.kind === 'deep') return nothing('deep-was-ready', 'the deep answer was ready first')
  if (winner.kind === 'failed') return nothing('reflex-failed', 'the reflex request failed')

  const { spoken, replaced } = safeReflex(winner.text)
  options.speak(spoken)
  // **RECORDED ONLY WHEN IT WAS ACTUALLY SPOKEN.** A cancelled reflex cost a request but produced nothing the
  // owner heard; charging the cap for it is the caller's decision and is made where the request was made.
  return { spoken, cancelled: null, replaced, priced: options.gate !== undefined, usd }
}

/**
 * One reflex request, in flight.
 *
 * **THE SMALLEST POSSIBLE REQUEST.** It reuses the deep mind's endpoint and credential, overrides the model to
 * {@link REFLEX_MODEL}, and asks for a handful of tokens — because the whole point is that it can answer while the
 * deep mind is still thinking, and a reflex that queues behind a large request is not a reflex.
 *
 * It resolves to the text, or rejects; {@link raceReflex} catches a rejection rather than letting it become an
 * unhandled rejection when the deep answer wins the race.
 *
 * @param options - the endpoint, the credential, the fetch implementation and the abort signal.
 * @returns the reflex text.
 */
export async function requestReflex(options: {
  endpoint: string
  key: string | undefined
  fetchImpl: typeof fetch
  signal: AbortSignal
}): Promise<string> {
  const response = await options.fetchImpl(options.endpoint, {
    method: 'POST',
    signal: options.signal,
    headers: {
      ...(options.key === undefined ? {} : { authorization: `Bearer ${options.key}` }),
      'content-type': 'application/json',
      'x-title': 'Aukora Presence Reflex',
    },
    body: JSON.stringify({
      model: REFLEX_MODEL,
      stream: true,
      max_tokens: REFLEX_MAX_TOKENS,
      messages: [{ role: 'system', content: reflexPrompt() }, { role: 'user', content: 'Now.' }],
    }),
  })
  if (!response.ok || response.body === null) throw new Error(`reflex upstream-${String(response.status)}`)
  // The stream is read whole rather than token by token: an acknowledgement is a handful of tokens, and the
  // caller speaks it in one piece.
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done === true) break
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') continue
      try {
        const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: unknown } }[] }
        const piece = parsed.choices?.[0]?.delta?.content
        if (typeof piece === 'string') text += piece
      } catch { /* a partial frame; the next read completes it */ }
    }
  }
  return text
}

/**
 * The turn's reflex step: what `presence.ts` calls, once, on the slow path.
 *
 * **THIS EXISTS BECAUSE `presence.ts` CANNOT BE IMPORTED BY A COURT.** It uses TypeScript parameter properties and
 * node's strip-only mode refuses them, so any logic living there is logic no court can reach — which is exactly
 * how the reflex came to be written and never used. Everything a court needs to measure lives here instead.
 *
 * @param options - the mind, the target, and the two promises the turn can offer.
 * @returns what happened, for the caller to log or ignore.
 */
export async function reflexTurn(options: {
  mind: string
  deepReady: Promise<unknown>
  speak: (text: string) => void
  /**
   * An already-in-flight reflex, when the caller has one.
   *
   * **THE SEAM TAKES THE REQUEST OR THE PROMISE.** The committed court hands in a promise so latency is a fact
   * about the test; the real turn hands in a target and lets this build the request. Refusing the promise would
   * have made the seam measurable only by making a network call, which is exactly the coupling this tree's courts
   * exist to avoid.
   */
  reflex?: Promise<string> | undefined
  endpoint?: string | undefined
  key?: string | undefined
  fetchImpl?: typeof fetch | undefined
  signal?: AbortSignal | undefined
  gate?: ReflexGate | undefined
  inputChars?: number
  onRefused?: (reason: ReflexCancelReason, detail: string) => void
}): Promise<ReflexOutcome> {
  const nothing = (cancelled: ReflexCancelReason, detail: string): ReflexOutcome => {
    options.onRefused?.(cancelled, detail)
    return { spoken: null, cancelled, replaced: null, priced: false, usd: 0 }
  }
  // A FAST MIND NEVER EVEN ASKS: no request is made, so there is nothing to cancel and nothing to price.
  if (!mindIsSlow(options.mind)) return nothing('mind-not-slow', `${options.mind} answers fast enough`)

  // **PRICED BEFORE THE REQUEST REACHES THE WIRE, WHICH IS WHERE IT WAS NOT.**
  //
  // The reserve lived inside `raceReflex`, seven lines below the fetch. **So the gate was asked AFTER the provider was
  // called**: a reflex the cap would have refused had already been sent, and the refusal arrived to a request that had
  // cost money. **`raceReflex`'s comment claimed "priced before it is sent" and was true about the wrong pair of
  // events** — and that function's own closing line already says the charge *"is made where the request was made."*
  // **This is where the request is made**, so this is where the gate is asked.
  //
  // **AND IT IS KEYED BY THE MIND, NOT BY A CONSTANT.** `raceReflex` priced every reflex against `REFLEX_MODEL`
  // whatever mind answered, so the gate could not tell a reflex on a cheap mind from one on `opus` — **while
  // `options.mind` sat in the call two lines below.** `mindIsSlow` directly above was already fixed to use the key;
  // this is the fourth place in this goal where a string meaning one thing was passed where another was meant.
  //
  // **THIS PATH IS THE ONE THAT MATTERS, BECAUSE IT IS THE ONE THAT FETCHES.** `options.reflex` exists so the court can
  // hand in a promise and measure latency without a network call — **a request this function did not start cannot be
  // un-started, so that case is left to `raceReflex` to price, exactly as before.**
  let held: { usd: number } | undefined
  if (options.reflex === undefined && options.gate !== undefined) {
    const verdict = (options.gate.reserve ?? options.gate.check)({
      model: options.mind,
      inputChars: options.inputChars ?? reflexPrompt().length,
      maxTokens: REFLEX_MAX_TOKENS,
    })
    // **NOTHING IS FETCHED WHEN THE GATE REFUSES**, because the fetch is below this line.
    if (!verdict.allowed) {
      return nothing(verdict.reason === 'price-unknown' ? 'reflex-price-unknown' : 'reflex-over-cap',
        `the reflex was not sent: ${verdict.reason}`)
    }
    held = { usd: verdict.estimatedUsd ?? 0 }
  }

  // **STARTED HERE, BEFORE ANYTHING IS AWAITED**, so the reflex and the deep answer are genuinely in flight
  // together. Awaiting the deep answer first would make the acknowledgement arrive after the thing it covers.
  const reflex = options.reflex ?? requestReflex({
    endpoint: options.endpoint ?? '',
    key: options.key,
    fetchImpl: options.fetchImpl ?? fetch,
    signal: options.signal ?? new AbortController().signal,
  })

  return await raceReflex({
    mind: options.mind,
    reflex,
    // **A HOLD ALREADY TAKEN IS NOT TAKEN AGAIN.** One reflex costs one reservation; without this the gate would be
    // asked twice for one call and hold the worst case twice.
    ...held === undefined ? {} : { alreadyPriced: held },
    deepReady: options.deepReady,
    speak: options.speak,
    ...options.gate === undefined ? {} : { gate: options.gate },
    ...options.inputChars === undefined ? {} : { inputChars: options.inputChars },
    ...options.onRefused === undefined ? {} : { onRefused: options.onRefused },
  })
}
