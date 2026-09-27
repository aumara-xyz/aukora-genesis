/**
 * THE MONEY GATE: NO PROVIDER CALL WITHOUT A KNOWN PRICE AND ROOM UNDER THE DAY'S CAP.
 *
 * The standing direction for this deployment: make her genuinely powerful. The deepest mind on offer
 * (`anthropic/claude-opus-5.5`) is also the most expensive per turn, and a voice that answers whenever it is
 * spoken to is a voice that spends without being asked. This is the gate in front of that spend.
 *
 * **THE RULE IS FAIL-CLOSED, AND THAT IS THE WHOLE POINT.** Two conditions each mean ZERO provider calls:
 *
 *   ① **AN UNKNOWN PRICE.** If this deployment has not established what a model costs, the turn is not sent.
 *      This is the doctrine applied to money — unknown inputs refuse, never default open — and it is why the
 *      price table below is SHORT rather than filled in with numbers nobody checked. **A guessed price is worse
 *      than no price: it makes the cap read as a protection while enforcing an invented budget.**
 *   ② **A SPEND THAT WOULD EXCEED THE CAP.** The day's spend plus this turn's worst-case estimate is compared
 *      against the cap BEFORE dispatch. The estimate uses the mind's own `maxTokens`, so it is an upper bound
 *      rather than a hope.
 *
 * The cap defaults to {@link DEFAULT_DAILY_CAP_USD} until the owner sets one, and the day is UTC so the boundary is
 * a fact rather than a local-time accident.
 *
 * @module spend-gate
 */

/**
 * The daily ceiling: **fifty US dollars, chosen rather than assumed.**
 *
 * **THE CEILING IS A DECISION SOMEBODY MADE, AND THE REASON IT IS FIFTY IS THAT IT WAS SET TO FIFTY.** The default was
 * twenty-five only because nobody had chosen; the current value is deliberate, **and the same discipline applies here as
 * to the price table below — every number that bounds what this system may spend carries its reason rather than its
 * history.**
 *
 * It is a DEFAULT rather than a constant because the deployment can still set `dailyCapUsd` per composition, and the
 * number here is what applies when nobody has.
 *
 * **REDACTED 2026-09-26, FROM THE EGRESS AUDIT (S5 row), WHICH FLAGGED THIS COMMENT FOR CARRYING A QUOTED REMARK.**
 * What stood here was a verbatim sentence in the owner's words with a date and a local time beside it — **a private
 * remark about money, on a line that ships in every built bundle, in a file whose whole subject is what this machine
 * spends.** The rule above is the same rule; **what is gone is the quotation, the name and the timestamp, and none of
 * them were load-bearing for anyone reading the code.**
 *
 * **AND THE DATE MATTERED ENOUGH TO KEEP THE SHAPE OF IT:** a number that was chosen on a day, by a person, **is a
 * different kind of number from one that was guessed**, and that distinction is preserved above without preserving who
 * said it or when.
 */
export const DEFAULT_DAILY_CAP_USD = 50

/**
 * What one model costs, per million tokens, in US dollars.
 *
 * **EVERY ENTRY HERE MUST BE A NUMBER THE DEPLOYMENT ESTABLISHED, WITH ITS SOURCE.** An entry invented to make a
 * model usable would silently convert this gate into a decoration, because the cap would then be measured
 * against fiction. A model that is absent from this table is UNKNOWN and is refused.
 */
export interface ModelPrice {
  readonly inputPerMtokUsd: number
  readonly outputPerMtokUsd: number
  /**
   * **THE MODEL RUNS ON THIS MACHINE, SO THERE IS NOBODY TO BILL.**
   *
   * A zero price is otherwise indistinguishable from a placeholder — the spend court refuses every entry whose sides
   * are not `> 0`, and it is right to: **a zero would let a model spend without the cap measuring anything.** That
   * rule is what stops a mistyped entry becoming unlimited unmeasured spending.
   *
   * **`local: true` IS THE PROVENANCE THAT MAKES A ZERO AN ESTABLISHED FACT RATHER THAN AN OMISSION.** It is a
   * positive claim about the deployment — the request cannot leave the machine — and the court requires it to be
   * stated before it will accept a zero. **An unmarked zero is still a placeholder and still fails.**
   *
   * **AND IT IS NOT ENOUGH ON ITS OWN.** `privateMindEndpoint` is configurable, so a user could point this id at a
   * remote host and this flag would be a lie. The flag records what the SHIPPED configuration is; making it true at
   * runtime needs the endpoint, which is why the gate's `price-unknown` refusal for unrecognised ids must stay.
   */
  readonly local?: boolean | undefined
}

/**
 * The prices, MEASURED RATHER THAN ASSUMED.
 *
 * **SOURCE AND DATE, BECAUSE A PRICE WITHOUT THEM IS A RUMOUR:**
 *
 *   OpenRouter `GET /api/v1/models`, read **2026-09-25 about 12:02 WITA**. USD per million tokens, in/out.
 *
 * **THE ONE PRICE THIS REPOSITORY ALREADY CARRIED WAS STALE, AND IT UNDERSTATED THE COST.** The comment recording that choice
 * in `presence.ts` recorded `deepseek/deepseek-v4.1-flash` at $0.14/$0.42; the provider now charges
 * **$0.30/$1.20**. A stale price is not merely out of date — it makes the cap UNDERCOUNT every turn taken on that
 * mind, so the day's ceiling is reached later than the arithmetic claims and the protection reads as tighter than
 * it is. The comment in `presence.ts` has been corrected to match.
 *
 * **`meta/muse-spark-1.3` IS PRICED AT THE MEASURED PUBLIC RATE, AND PETER SEES IT AS FREE IN HIS OWN ACCOUNT.**
 * Both are true and neither cancels the other: the public listing measured at 12:18 WITA is $1.25/$4.25, while his
 * account shows no charge for it. **THE TABLE KEEPS THE PUBLIC NUMBER, BECAUSE THAT IS THE ONE THAT HOLDS WHEN
 * THE ACCOUNT CHANGES** — a cap computed from a promotional rate would undercount the moment the promotion ends,
 * silently, and this table is the thing that is supposed to be conservative.
 *
 * **A `meta/muse-spark-1.3-contributor` VARIANT EXISTS AT $0.10/$0.20 AND IS DELIBERATELY NOT USED.** It is far
 * cheaper, and it very likely trains on the prompts sent to it. This voice carries the repository, the claims
 * packet, Kira's settled records and the owner's own words, so a discounted model that learns from its inputs is not
 * a cheaper version of the same thing — it is a different thing wearing the same name. The price is not the only
 * property of a mind that matters, and the cheap one is not on the roster.
 *
 * **THE PRICES ARE FACTS ABOUT A PROVIDER, SO THEY LIVE HERE RATHER THAN IN CONFIGURATION** — but they are facts
 * with a date, and a price that has moved makes this table wrong in a way only a fresh read can fix. A model that
 * is absent from this table is UNKNOWN and REFUSES at runtime; see `check` below.
 */
export const CONFIGURED_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  'anthropic/claude-opus-5.5': { inputPerMtokUsd: 4.00, outputPerMtokUsd: 20.00 },
  'openai/gpt-6-astra': { inputPerMtokUsd: 10.00, outputPerMtokUsd: 50.00 },
  'deepseek/deepseek-v4.1-flash': { inputPerMtokUsd: 0.30, outputPerMtokUsd: 1.20 },
  'meta/muse-spark-1.3': { inputPerMtokUsd: 1.25, outputPerMtokUsd: 4.25 },  'meta-llama/llama-3.3-70b-instruct': { inputPerMtokUsd: 0.10, outputPerMtokUsd: 0.32 },
  // **THE PRIVATE LOCAL MIND, SO "yours" CAN ACTUALLY ANSWER.** Without this entry every turn on it was refused
  // `price-unknown`, which made **the weights arm unreachable** — the hands could never fire because the money gate
  // stopped the turn before the tag was read. **A model that costs nothing, blocked by a check designed to stop
  // spending.** `local: true` is the provenance; see the field's doc for why an unmarked zero would still fail.
  'hf.co/mradermacher/Huihui-Qwen3.8-27B-abliterated-GGUF:Q4_K_M': {
    inputPerMtokUsd: 0, outputPerMtokUsd: 0, local: true,
  },
})

/** What the gate decided about one dispatch. */
export interface SpendVerdict {
  /** Whether the provider may be called. FALSE MEANS ZERO CALLS. */
  readonly allowed: boolean
  /** A short machine-readable reason: `allowed`, `price-unknown` or `over-cap`. */
  readonly reason: 'allowed' | 'price-unknown' | 'over-cap'
  /** The turn's worst-case cost, or null when the price is unknown. */
  readonly estimatedUsd: number | null
  /** What has been spent today before this turn. */
  readonly spentUsd: number
  /** The cap in force for the day. */
  readonly capUsd: number
  /** One sentence a person can read. It is spoken when a turn is refused, so it says why. */
  readonly message: string
}

/** The gate's public shape. */
export interface SpendGate {
  check: (turn: { model: string; inputChars: number; maxTokens: number }) => SpendVerdict
  record: (usd: number) => void
  /**
   * **CHECK AND HOLD, IN ONE SYNCHRONOUS STEP.**
   *
   * `check` is pure and `record` runs after streaming, so between them the budget is UNHELD: two turns both see
   * the same remaining cap, both are allowed, and both dispatch — one budget spent twice. A reservation closes
   * the window by charging the worst case at the moment of the decision, before any await. `settle` trues it down
   * to what the turn actually cost.
   */
  reserve: (turn: { model: string; inputChars: number; maxTokens: number }) => SpendVerdict
  /** Replace a reservation with what the turn actually cost. The excess returns to the day's budget. */
  settle: (reservedUsd: number, actualUsd: number) => void
  spentToday: () => number
  capUsd: () => number
}

/**
 * **ONE CHARACTER PER TOKEN, BECAUSE A BOUND IS THE WORST CASE AND NOT THE TYPICAL ONE.**
 *
 * Codex r1 finding 1: this was 2, under a comment calling it "a pessimistic bound, not an average" — and the
 * comment was wrong in the direction that costs money. A dense BPE tokenizer runs NEAR two characters per token on
 * exactly the payload this lane sends (framed lens blocks, ids, punctuation, JSON keys), and text can be DENSER
 * still: CJK, base64, runs of punctuation and single-character keys all approach one character per token. For any
 * input denser than the assumed ratio, `chars / 2` UNDER-counts the tokens, the estimate falls BELOW the real cost,
 * and **an under-counted request is one the cap believes it can afford.** The estimate was an average wearing the
 * name of a bound.
 *
 * **ONE IS THE ONLY TRUE UPPER BOUND WITHOUT A TOKENIZER:** every token consumes at least one character, so
 * `chars / 1` cannot be exceeded. Being wrong by over-counting costs a refusal; being wrong by under-counting costs
 * money the ceiling was supposed to bound, and only one of those is recoverable.
 */
export const CHARS_PER_TOKEN = 1

/** The UTC day key, so the boundary is a fact rather than a local-time accident. */
export const utcDay = (atMs: number): string => new Date(atMs).toISOString().slice(0, 10)

/**
 * Create the gate.
 *
 * @param options - the cap, the price table, the clock and the floor.
 * @returns a gate whose `check` must be consulted before every provider call.
 */
export function createSpendGate(options: {
  capUsd?: number
  prices?: Readonly<Record<string, ModelPrice>>
  now?: () => number
  /** A positive balance carried in from before this process started, for the same UTC day. */
  spentTodayUsd?: number
  /**
   * WHERE THE DAY'S BALANCE SURVIVES A RESTART. Codex r1 finding 3.
   *
   * **A CAP THAT RESETS WHEN THE PROCESS DOES IS NOT A DAILY CAP.** The counter lived only in this closure, so
   * every restart — including a cutover — began the day at zero, and the day's true total could exceed the ceiling
   * by whatever was spent before each restart. `spentTodayUsd` already existed to carry a balance IN, and nothing
   * ever supplied it and nothing ever wrote one out; it was a parameter for a feature that was never built.
   *
   * INJECTED RATHER THAN IMPORTED, because this module imports nothing by design so a keyless court can load it.
   * A store that throws is caught and IGNORED rather than propagated: a ledger that cannot be written must not
   * take a turn down with it, and the ceiling still holds for this process from its in-memory value.
   */
  store?: {
    load: () => { day?: unknown; spentUsd?: unknown } | null
    save: (balance: { day: string; spentUsd: number }) => void
  }
} = {}): SpendGate {
  const capUsd = options.capUsd ?? DEFAULT_DAILY_CAP_USD
  const prices = options.prices ?? CONFIGURED_PRICES
  const now = options.now ?? (() => Date.now())
  let day = utcDay(now())
  let spent = options.spentTodayUsd ?? 0
  const store = options.store

  /**
   * Record the balance, and never let a broken ledger break a turn.
   *
   * **A SAVE THAT THROWS MUST NOT REFUSE A TURN THAT THE CEILING ALLOWS.** The in-memory value is the authority
   * for this process; the store only carries it forward. Swallowing here is deliberate and is the opposite of the
   * fail-open this file was fixed for — it fails open on PERSISTENCE, where the cost is an under-counted next
   * process, not on the CEILING, where the cost was unbounded spend.
   */
  const persist = () => {
    if (store === undefined) return
    try { store.save({ day, spentUsd: spent }) } catch { /* a ledger that cannot be written is not a reason to refuse */ }
  }

  const rollover = () => {
    const today = utcDay(now())
    if (today !== day) { day = today; spent = 0; persist() }
  }

  // **THE BALANCE IS CARRIED IN AT CONSTRUCTION, AND ONLY FOR THE SAME DAY.** A ledger from yesterday is a
  // different day's spend; adopting it would make a fresh morning inherit last night's total, which is the
  // opposite error. A store that throws or answers nonsense leaves the balance at zero rather than guessing.
  if (store !== undefined && options.spentTodayUsd === undefined) {
    try {
      const carried = store.load()
      const sameDay = carried !== null && carried !== undefined && carried.day === day
      const amount = Number(carried?.spentUsd)
      if (sameDay && Number.isFinite(amount) && amount > 0) spent = amount
    } catch { /* an unreadable ledger starts the day at zero, which is stated rather than hidden */ }
  }

  // Annotated: naming the object for `reserve` to call `gate.check` costs it the contextual type it had as a
  // returned literal, so the methods must be typed rather than inferred.
  const gate: SpendGate = {
    capUsd: () => capUsd,
    spentToday: () => { rollover(); return spent },
    record: (usd: number) => {
      rollover()
      if (Number.isFinite(usd) && usd > 0) spent += usd
    },
    // **THE HOLD IS TAKEN HERE, SYNCHRONOUSLY, BEFORE THE CALLER CAN AWAIT ANYTHING.** An allowed verdict that is
    // not immediately charged is a verdict two callers can both receive.
    reserve: (turn) => {
      rollover()
      const verdict = gate.check(turn)
      // **A NON-FINITE RESERVATION IS NOT ADDED.** `spent += NaN` would poison the day permanently: every later
      // `spent + estimated > capUsd` is false, so the ceiling would never refuse again. The verdict above already
      // refuses a non-finite estimate, so this is the second wall in front of the same failure.
      if (verdict.allowed && verdict.estimatedUsd !== null && Number.isFinite(verdict.estimatedUsd)) {
        spent += verdict.estimatedUsd
        persist()
      }
      return verdict
    },
    settle: (reservedUsd, actualUsd) => {
      rollover()
      // Returning the excess is not generosity: the reservation was a BOUND, and holding a bound after the turn is
      // known to have cost less would shrink the day's budget by an amount nobody spent.
      const give = Number.isFinite(reservedUsd) && reservedUsd > 0 ? reservedUsd : 0
      const cost = Number.isFinite(actualUsd) && actualUsd > 0 ? actualUsd : 0
      spent = Math.max(0, spent - give + cost)
      persist()
    },
    check: ({ model, inputChars, maxTokens }) => {
      rollover()
      // **AN OWN ENTRY, NOT AN INHERITED ONE.** `prices[model]` walks the prototype chain, so a model named
      // `toString`, `constructor` or `valueOf` returned a FUNCTION rather than undefined and the refusal below
      // never fired. The arithmetic then read `.inputPerMtokUsd` off it, got undefined, produced NaN, and
      // `NaN > capUsd` is FALSE — so the turn was ALLOWED. Worse, `reserve` does `spent += NaN`, which makes the
      // day's balance NaN for the rest of the process, and every later comparison against NaN is also false.
      // **ONE REQUEST NAMING SUCH A MODEL DISABLED THE CEILING FOR THE LIFE OF THE PROCESS**, which is the
      // opposite of what a cap is for.
      const price = Object.hasOwn(prices, model) ? (prices as Record<string, unknown>)[model] : undefined
      const rates = price as { inputPerMtokUsd?: unknown; outputPerMtokUsd?: unknown } | undefined
      // ② A PRESENT PRICE MUST STILL BE ARITHMETIC. A finite, nonnegative pair is required, because a price of
      // `undefined`, `null`, `'cheap'` or `NaN` would flow into the estimate and out the other side as a pass.
      // **A PRICE OF `null` IS NOT AN OBJECT, AND THE FIRST VERSION OF THIS FIX THREW ON IT.** `rates !== undefined`
      // is true for null, and the next property read raised a TypeError — so a null entry crashed the gate instead
      // of refusing the turn. Caught by the court this finding's red arm drives, which is the point of writing the
      // arm against the ORIGINAL defect rather than against the fix.
      const priced = rates !== null && typeof rates === 'object'
        && Number.isFinite((rates as { inputPerMtokUsd?: unknown }).inputPerMtokUsd)
        && ((rates as { inputPerMtokUsd: number }).inputPerMtokUsd) >= 0
        && Number.isFinite((rates as { outputPerMtokUsd?: unknown }).outputPerMtokUsd)
        && ((rates as { outputPerMtokUsd: number }).outputPerMtokUsd) >= 0
      // ① AN UNKNOWN PRICE REFUSES. Not a default, not a zero, not "assume it is cheap".
      if (price === undefined || !priced) {
        return {
          allowed: false,
          reason: 'price-unknown',
          estimatedUsd: null,
          spentUsd: spent,
          capUsd,
          message: `I did not send that turn: I have no established price for ${model}, so I cannot tell what it `
            + `would cost. Today's cap is $${capUsd.toFixed(2)}.`,
        }
      }
      const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN)
      const estimated = (inputTokens * (rates as { inputPerMtokUsd: number }).inputPerMtokUsd
        + maxTokens * (rates as { outputPerMtokUsd: number }).outputPerMtokUsd) / 1_000_000
      // **③ THE ESTIMATE ITSELF MUST BE A NUMBER BEFORE IT IS COMPARED.** Belt and braces: even with a priced,
      // finite pair, an absurd input can overflow to Infinity, and `Infinity > cap` would refuse correctly while
      // `NaN > cap` would not. This refuses BOTH rather than relying on the comparison's direction.
      if (!Number.isFinite(estimated)) {
        return {
          allowed: false,
          reason: 'price-unknown',
          estimatedUsd: null,
          spentUsd: spent,
          capUsd,
          message: `I did not send that turn: I could not compute a finite cost for ${model}, so I cannot tell `
            + `what it would cost. Today's cap is $${capUsd.toFixed(2)}.`,
        }
      }
      // ④ A SPEND THAT WOULD EXCEED THE CAP REFUSES, and the comparison is against the worst case rather than
      // what the last turn happened to cost.
      if (spent + estimated > capUsd) {
        return {
          allowed: false,
          reason: 'over-cap',
          estimatedUsd: estimated,
          spentUsd: spent,
          capUsd,
          message: `I did not send that turn: it could cost up to $${estimated.toFixed(4)} and I have already `
            + `spent $${spent.toFixed(2)} of today's $${capUsd.toFixed(2)}.`,
        }
      }
      return {
        allowed: true,
        reason: 'allowed',
        estimatedUsd: estimated,
        spentUsd: spent,
        capUsd,
        message: `allowed: up to $${estimated.toFixed(4)} against $${spent.toFixed(2)} spent of $${capUsd.toFixed(2)}`,
      }
    },
  }
  // `reserve` calls `gate.check`, so the object has to exist before it is returned rather than being returned
  // inline — the only structural change the atomic hold needed.
  return gate
}
