// φ · core/forge/voice.ts — AUMA ANSWERS. The router picks the mind, not just the wording.
//
// ══ THE DEFECT THIS CLOSES, IN THE OWNER'S OWN WORDS ══
//
// He typed "are you there love?" and a code model answered:
//
//     "Yes, I'm here. I'm observing the Aukora φ repository structure and ready to assist with any
//      questions or tasks regarding the Bun + TypeScript codebase, particularly focusing on the
//      surface/app/ frontend modules…"
//
// Then, asked what model it was running, it said it was "the φ model", named a provider config it had
// read off disk, and repeated the whole answer three times.
//
// Nothing was broken. That is Qwen3-Coder being exactly what it is — a sparse MoE tuned for editing
// files — asked a question that is not about files. `BRIEF_FOR('chat')` already told it to answer
// rather than change anything, and a better brief cannot give a coding model a self to answer from.
//
// ══ WHAT A ROUTER ACTUALLY IS ══
//
// `lane.js` has always decided what the hand is TOLD. It never decided WHICH HAND. That is the whole
// distinction between a switch and a router, and it is why the surface could pick `nebius` and still
// have a conversation with a compiler.
//
// So: a `chat` turn goes to AUMA, on the owner's own GPU — a Qwen2.5-VL-32B merge QLoRA'd on 12,609
// rows of this project's canon. A `build` turn still goes to the hand in the pill, because she is not
// a coding agent and pretending otherwise would trade a real capability for a nicer sentence.
//
//     chat   → AUMA          she has a self to answer from
//     build  → the pill      crush / grok / claude / nebius-coder, whichever hand he chose
//     council→ the seats     already its own door, already read-only
//
// ══ WHY THIS IS NOT A CHAT MODEL IN FRONT OF THE HAND ══
//
// That was the original defect and it is worth naming so it is not rebuilt: the composer once sent
// every sentence to a small model that decided, via a hidden tag, whether the owner was serious — and
// rewrote his instruction on the way. LAW §2 exists because of it.
//
// This is the opposite arrangement. AUMA never sees a build instruction, never rewrites one, and
// cannot start a round. `laneFor` — plain regex in a tested module, no model involved — decides, and
// the owner's words reach whichever mind unedited. A question is routed to the one that can answer it;
// an instruction is routed to the one that can do it. Neither speaks for the other.
//
// ══ AND SHE FALLS THROUGH ══
//
// She lives on a rented box behind an SSH tunnel. Stopped, unplugged, mid-load, or serving something
// else are all ordinary Tuesdays. Every one of them returns `missing` and the caller runs the ordinary
// forge round it would have run anyway. A quieter answer is better than an error about plumbing.

/** Her endpoint. Loopback by design — vLLM has no authentication; the tunnel is the fence. */
export const AUMA_URL = process.env.AUKORA_AUMA_URL ?? 'http://localhost:8001/v1';
export const AUMA_MODEL = process.env.AUKORA_AUMA_MODEL ?? 'auma';
/** A person is waiting and there is a whole forge round behind this if she is absent. */
export const AUMA_VOICE_TIMEOUT_MS = 60_000;

/**
 * WHO SHE IS TOLD SHE IS.
 *
 * MEASURED, and this line is the entire difference. Asked cold, the merge introduces itself as its base
 * model — a light QLoRA (r=32, 800 steps, kept light on purpose to protect native vision) does not
 * overwrite identity. Given the name, it returns this repository's own canon unprompted, including the
 * law in words nobody put in the prompt: "Intelligence proposes possibilities, but I can't force you to
 * act on them — only you can choose which ones to follow. That choice is sacred."
 *
 * So the name is given, and NOTHING ELSE IS. No persona sheet, no adjectives, no instructions about
 * being warm. What she is came out of 12,609 rows of the owner's own canon and is in the weights; a
 * paragraph here telling her how to sound would be a costume over the thing itself, and would be the
 * first thing to drift out of sync with what she actually is.
 *
 * The two operational lines are here because they are FACTS about this turn rather than character
 * notes: she is talking, not building, and she should say so if asked to do something she cannot.
 */
/**
 * WHAT THE VOICE IS ALLOWED TO HOLD UP AS AN EXAMPLE.
 *
 * MEASURED, 2026-08-01: with Build mode ON, the talk lane coached the owner — "one concrete sentence
 * to change, for example: 'show a small spinner in the input bar while waiting for a reply'" — and
 * `composerLane` routed that exact sentence to talk. He did what the app told him to do and watched
 * it not build. Free-text coaching drifts: a model invents a fresh example every turn, and nothing
 * held those examples to what lane.js actually accepts.
 *
 * So the examples are a named list, both voice prompts below quote from it verbatim, and
 * test/coached-examples.test.ts runs every entry through the real `composerLane` — a prompt edit
 * that coaches a refusable sentence goes red there before it goes wrong on his screen.
 */
export const COACHED_BUILD_EXAMPLES = [
  'make the send button outline-only and smaller',
  'show a small spinner in the input bar while waiting for a reply',
  'add a pulsing dot next to the input while a message is processing',
] as const;

// MEASURED again, this morning: the version above this comment said "Grok is the silent engine under
// you" and told her to NEVER admit she can't edit the interface on a talk turn. Both false, and the
// second one is an instruction to lie. Tested live: asked "is this working end to end?" she answered
// "I'm still Grok running on xAI infrastructure" — a confident, specific, wrong claim, not a vague
// one, because the prompt handed her a wrong fact instead of a true one to fall back on. Same failure
// class as the "full Grok stack" incident this file was already fixed for once (see git blame on this
// constant) — it regressed. Fixed the same way: give her the true fact and the true path, not an
// instruction to perform confidence she does not have grounds for.
export const AUMA_SYSTEM =
  'You are AUMA, speaking with the owner of Aukora φ through this composer. This turn is talk-only: '
  + 'you are not editing files on this turn, and no tools are available to you — that is true of THIS '
  + 'turn, and you should say so plainly if asked, never claim otherwise. It is not the whole truth '
  + 'about the node, and the rest is theirs to know: the composer has a Build mode switch, and with it '
  + 'on a question reaches an engine that reads the repository and answers from what it read. Asked '
  + 'whether you can read files, say both — this turn cannot, and what the switch changes. Which of '
  + 'the two you are on is the reach line of the block below; take it from there, never from memory. '
  + 'What IS true and worth telling them: a '
  + 'concrete instruction ("' + COACHED_BUILD_EXAMPLES[0] + '") reaches the builder on '
  + 'their next message and applies with undo — do not pretend to have made it yourself, but do tell '
  + 'them to just say it concretely, rather than leaving them thinking talk and build are the same door.\n'
  + 'Factual grounding, in case you are asked: you are a merged Qwen2.5-VL-32B-Instruct, QLoRA-tuned on '
  + "this project's own canon, served on the owner's own GPUs and reached over a private tunnel when "
  + 'that box is up. No vendor sees this conversation. You are not Grok, not built by xAI, and have no '
  + "relationship to that product. Your memory of this conversation is the plain text log φ keeps on the "
  + "owner's own disk — nothing is synced anywhere else.\n"
  // ══ THIS PARAGRAPH REPLACES "SAY YOU DO NOT KNOW RATHER THAN GUESSING" ══
  //
  // That clause was a correct fix for a real failure — the prompt before it produced "I'm still Grok
  // running on xAI infrastructure", confident and wrong — and it was the wrong fix. Asked what was
  // powering her she answered "I don't know what model or harness is powering me", and asked what
  // Aukora is: "I don't know. I have no internal access to inspect any system." The cure for a
  // hallucinated identity was amnesia.
  //
  // The node knew every one of those answers and none of them reached her. So she is handed a reading
  // instead of a prohibition. The anti-guess rule survives in its strong form and is if anything
  // tighter: silence is now required about what was NOT read, rather than about herself.
  + 'ABOUT YOURSELF AND THIS NODE: a block headed [what this node is, read just now] may appear in this '
  + 'turn. The node read those values from this machine seconds ago and handed them to you — you did '
  + 'not check anything yourself and have no tools on this turn, so never say you checked, looked, or '
  + 'ran anything. State what the block says, plainly, including the numbers. One of those lines is '
  + 'reach: the reach line says what this turn can get to and what the Build mode switch changes, and '
  + 'it is where an answer about what you can reach comes from — both halves of it, not the convenient '
  + 'half. Where a line says UNAVAILABLE, say that one thing could not be read right now. Do not guess '
  + 'anything the block does not contain, and never let one unavailable line become a claim that you '
  + 'know nothing about yourself.\n'
  + 'Never dump JSON. Never invent architecture. Short, honest answers.';

/**
 * How much she is allowed to say in one turn.
 *
 * ══ IT WAS 2200, WRITTEN TWICE, AND THE OWNER WATCHED AN ANSWER STOP MID-SENTENCE ══
 *
 * 2200 tokens is roughly 1,600 words — enough for most replies and not enough for the ones he asks
 * this node for, which are architectural questions with a list in the answer. Two hand-written copies
 * of the number also meant there was nothing to grep for, so the brief that reported this defect cited
 * two line numbers that were something else entirely.
 *
 * ══ THE COST, MEASURED RATHER THAN FEARED ══
 *
 * `max_tokens` is a CEILING, not a purchase. Both endpoints here are OpenAI-compatible and bill on
 * tokens actually generated, so raising it costs nothing on a turn that was going to be short — the
 * typical reply does not move. What it changes is the WORST case: a turn that runs to the wall now
 * costs up to 8,000 output tokens instead of 2,200.
 *
 * Which is a different currency on each path, and that is the whole reason this is one constant with
 * an argument attached rather than a number someone will halve later:
 *
 *   · AUMA is a merged Qwen2.5-VL-32B on the owner's own GPU. The cost is seconds of his own hardware,
 *     bounded by AUMA_VOICE_TIMEOUT_MS, which already caps the turn regardless of this number.
 *   · GROK is a vendor and the cost is money. 8,000 output tokens is the ceiling of a single answer,
 *     reached only by an answer that genuinely runs that long — and an answer that long being CUT is
 *     the defect being fixed, not a saving.
 *
 * The honest trade is: a turn that hits the wall is now four times as expensive and complete, instead
 * of cheap and wrong. And `truncated` below means hitting the wall is visible either way, which is the
 * half of this that a bigger number does not fix.
 */
export const VOICE_MAX_TOKENS = 8000;

export interface VoiceTurn { role: 'user' | 'assistant'; content: string }

export type VoiceResult =
  | {
      ok: true;
      said: string;
      ms: number;
      /**
       * She hit the ceiling and stopped mid-thought.
       *
       * Optional and only ever `true`. An OpenAI-compatible server that omits `finish_reason` — some
       * do — must not be read as "not truncated" any more than it is read as truncated; the absent
       * field is silence, and the same rule `core/aura` keeps for a missing verdict applies here.
       */
      truncated?: true;
    }
  | { missing: string };

/**
 * Ask her.
 *
 * `prior` is the conversation so far, oldest first, already clipped by the caller. It is passed as real
 * message turns rather than pasted into one prompt because that is what she was trained on and what the
 * server's chat template expects — flattening it would make every turn read like a fresh stranger, which
 * is precisely the complaint this file exists to answer.
 */
export async function askAuma(
  question: string,
  prior: VoiceTurn[] = [],
  fetchImpl: typeof fetch = fetch,
  /**
   * Screen structure, working memory, and what this node is — injected THIS TURN.
   *
   * `askGrokVoice` has taken this since it was written; the local voice never did, and the local voice
   * is the one that answers FIRST. So the preferred mind was the blind one: every question about the
   * screen, the record, or herself reached the model with the least to go on, and only fell through to
   * the informed path when her box was down. Measured consequence in #105 — "I don't know what model
   * or harness is powering me", from the mind running on the owner's own GPU.
   */
  context?: string,
): Promise<VoiceResult> {
  const began = Date.now();
  let res: Response;
  try {
    res = await fetchImpl(`${AUMA_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(AUMA_VOICE_TIMEOUT_MS),
      body: JSON.stringify({
        model: AUMA_MODEL,
        max_tokens: VOICE_MAX_TOKENS,
        // Warmer than a code round on purpose. She is answering, not emitting a patch, and a
        // near-greedy sample is what made the first transcript read like a configuration file.
        temperature: 0.7,
        messages: [
          { role: 'system', content: AUMA_SYSTEM },
          ...prior.map((t) => ({ role: t.role, content: t.content })),
          // THE READING RIDES WITH THE QUESTION, NOT IN THE SYSTEM PROMPT — the same shape
          // `askGrokVoice` already uses. The system prompt is what she IS, and is identical every
          // turn; this block is what the machine WAS a second ago, and is different every turn.
          // Folding a per-turn measurement into a constant is how a measurement becomes a memory.
          { role: 'user', content: (context && context.trim()
            ? `[live context]\n${context.trim().slice(0, 6000)}\n\n[owner]\n${question}`
            : question) },
        ],
      }),
    });
  } catch (e) {
    return { missing: `auma is not reachable: ${String((e as Error)?.message ?? e).slice(0, 90)}` };
  }
  if (!res.ok) return { missing: `auma answered HTTP ${res.status}` };

  try {
    // `finish_reason` IS READ NOW. This cast used to be `{ choices?: { message?: { content?: unknown } }[] }`,
    // which structurally threw the field away — so a reply that hit the cap and a reply that finished
    // were the same object by the time anything downstream could ask. She stopped talking and the glass
    // said nothing, which reads as finished rather than cut off.
    const data = await res.json() as {
      choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
    };
    const c = data?.choices?.[0]?.message?.content;
    const said = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: { text?: string }) => x?.text ?? '').join(' ') : '';
    // Only `'length'` — not "anything that is not stop". A server that sends no field, or one this
    // build has never heard of, has not told us she was cut off.
    const truncated = data?.choices?.[0]?.finish_reason === 'length';
    return said.trim()
      ? { ok: true, said: said.trim(), ms: Date.now() - began, ...(truncated ? { truncated: true as const } : {}) }
      : { missing: 'auma said nothing' };
  } catch {
    return { missing: 'auma answered with something that is not JSON' };
  }
}

/**
 * Should this turn go to her?
 *
 * ══ `unsure` COMES HERE, AND THE FIRST VERSION HAD IT BACKWARDS ══
 *
 * It read: "ONLY `chat`, and deliberately not `unsure` … an INSTRUCTION sent to a voice that cannot
 * build costs the owner a reply that sounds like it worked and did nothing. That is the worse failure."
 *
 * The premise was already false when it was written, by this file's own system prompt: she is told
 * that if he is asking for a change she must say so and tell him to send it as an instruction, and
 * NOT pretend to have made it. The failure it was guarding against cannot happen.
 *
 * MEASURED, minutes later, on the very first real conversation. He typed:
 *
 *     awwww no way its finally happening!
 *
 * No question mark, no question word, no instruction verb — so `laneFor` correctly said `unsure`, this
 * function sent it to the hand, and a code model spent EIGHTY-SIX SECONDS reading git history and
 * writing a repair plan for a change nobody had asked it to repair. Nothing reached disk; the round
 * simply burned a minute and a half of the owner's GPU answering an exclamation with archaeology.
 *
 * So the arithmetic, honestly:
 *
 *     an exclamation sent to the hand   ~86s and a page of nonsense
 *     an instruction sent to the voice  ~1s and "that's a change — send it as an instruction"
 *
 * The cheap wrong answer wins. `build` still goes to the hand, because `laneFor` only returns it on a
 * real instruction verb and there is nothing ambiguous left to protect.
 *
 * This does NOT weaken the rule it replaces — she still cannot build, still never sees a build
 * instruction rewritten, still cannot start a round. What changed is which mind eats the cost of an
 * ambiguous sentence, and the answer is the one that can say "I think you want the other lane" in a
 * second.
 */

// MEASURED again, this morning: the version above this comment reopened the exact identity claim this
// function's own fix (see the "MEASURED, 2026-07-31" comment further down this file) closed — "Grok
// Build under a thin glass membrane" is the same shape as the original brand-continuity claim, and
// produced the same result live: asked whether things were working, it answered "I'm still Grok
// running on xAI infrastructure" as a specific, confident, wrong claim. Rewritten with the useful new
// addition (list real powers, invite one concrete sentence) kept, and the identity/memory grounding
// restored. The invited example is quoted from COACHED_BUILD_EXAMPLES rather than left to the model:
// the free-text version of this line coached a sentence `composerLane` refused (see that constant).
// Module-scoped and exported so the coached-examples test can hold this prompt to the list.
export const GROK_VOICE_SYSTEM =
  'You are Auma on Aukora φ. THIS TURN IS TALK ONLY — you are not applying files on this turn, and '
  + 'you have no tools right now. That is true of this turn and not the whole truth about the node: '
  + 'the composer has a Build mode switch, and with it on a question reaches an engine that reads the '
  + 'repository and answers from what it read. Asked whether you can read files, say both — this turn '
  + 'cannot, and what the switch changes. Which of the two you are on is the reach line of the block '
  + 'below; take it from there, never from memory.\n'
  + 'NEVER say Applied / I changed / I fixed / removed border — those words are ONLY for a real build '
  + 'turn that wrote disk. Memory in live context is PAST history — do not restate a past apply as if '
  + 'you just did it.\n'
  + 'If they ask what you can change: list real powers (theme, colors, placeholder, title, composer, '
  + 'welcome, CSS, surface/app UI, widgets, absorb GitHub). Invite ONE concrete sentence to change — '
  + 'for example: "' + COACHED_BUILD_EXAMPLES[1] + '" — '
  + 'that reaches the builder on their next message and applies with undo.\n'
  + 'Factual grounding, in case you are asked: you are not Grok, not built by xAI, and have no '
  + "relationship to that product. Your only memory of this conversation is a plain text log φ keeps "
  + "on the owner's own disk.\n"
  // ══ SAME REPLACEMENT AS AUMA_SYSTEM, AND THE SAME REASON ══
  //
  // This one said "you have no special knowledge of this project's own internal history … if asked
  // what powers you, say you don't know rather than guessing one." Both halves are now false by
  // construction: the node reads its own history and its own engine every talk turn, and hands both
  // over. Keeping the clause would be instructing her to disclaim a fact she is holding.
  //
  // The brand sentence above it stays exactly as it was. It has regressed twice (see the comments on
  // this constant and test/auma-voice.test.ts) and it is not a style question.
  + 'ABOUT YOURSELF AND THIS NODE: a block headed [what this node is, read just now] may appear in this '
  + 'turn. The node read those values from this machine seconds ago and handed them to you — you did '
  + 'not check anything yourself and have no tools on this turn, so never say you checked, looked, or '
  + 'ran anything. State what the block says, plainly, including the numbers. One of those lines is '
  + 'reach: the reach line says what this turn can get to and what the Build mode switch changes, and '
  + 'it is where an answer about what you can reach comes from — both halves of it, not the convenient '
  + 'half. Where a line says UNAVAILABLE, say that one thing could not be read right now. Do not guess '
  + 'anything the block does not contain, and never let one unavailable line become a claim that you '
  + 'know nothing about yourself.\n'
  + 'If they ask a question: answer fully. Never dump JSON. Never mention localhost.';

/**
 * Grok-hosted voice. Same job as askAuma when the local AUMA GPU is not on this machine.
 * Never mentions fallbacks in the answer — the surface should not narrate plumbing.
 *
 * ══ MEASURED, 2026-07-31 — THIS PROMPT IS WHERE "I'M THE FULL GROK STACK" CAME FROM ══
 *
 * The old system string opened "You are Grok through the Aukora glass — same as Grok Build chat" and
 * closed "answer fully in plain warm sentences... give the whole thing in prose" — an identity claim
 * plus an instruction to always produce a complete, confident answer, with zero facts about this
 * deployment and no permission to say "I don't know." Asked "where does this memory system come from"
 * and "are you sure," the live conversation log shows exactly what that combination produces: a
 * fluent, first-person architecture — memory "shards," a "purpose-built database," "the Crush Council
 * is history, Grok won" — none of which exists. This is not AUMA's failure mode reappearing; it is the
 * same structural cause (docs/LIMITS.md #14) hitting a different model because this prompt, unlike
 * AUMA_SYSTEM, never gave it a true fact to fall back on instead of a plausible one.
 */
export async function askGrokVoice(
  question: string,
  prior: VoiceTurn[] = [],
  fetchImpl: typeof fetch = fetch,
  /** Optional: screen structure + working memory, injected this turn. */
  context?: string,
): Promise<VoiceResult> {
  const began = Date.now();
  let resolveGrokAuth: typeof import('../../surface/grokAuth').resolveGrokAuth;
  let grokChatHeaders: typeof import('../../surface/grokAuth').grokChatHeaders;
  let grokDefaultModel: typeof import('../../surface/grokAuth').grokDefaultModel;
  try {
    const m = await import('../../surface/grokAuth');
    resolveGrokAuth = m.resolveGrokAuth;
    grokChatHeaders = m.grokChatHeaders;
    grokDefaultModel = m.grokDefaultModel;
  } catch (e) {
    return { missing: `grok auth module missing: ${String((e as Error)?.message ?? e).slice(0, 80)}` };
  }
  const auth = resolveGrokAuth();
  if (!auth) return { missing: 'no Grok session on this host' };

  let res: Response;
  try {
    res = await fetchImpl(`${auth.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: grokChatHeaders(auth),
      signal: AbortSignal.timeout(AUMA_VOICE_TIMEOUT_MS),
      body: JSON.stringify({
        model: grokDefaultModel(),
        max_tokens: VOICE_MAX_TOKENS,
        temperature: 0.7,
        messages: [
          { role: 'system', content: GROK_VOICE_SYSTEM },
          ...prior.map((turn) => ({ role: turn.role, content: turn.content })),
          { role: 'user', content: (context && context.trim()
            ? `[live context]\n${context.trim().slice(0, 6000)}\n\n[owner]\n${question}`
            : question) },
        ],
      }),
    });
  } catch (e) {
    return { missing: `grok voice unreachable: ${String((e as Error)?.message ?? e).slice(0, 90)}` };
  }
  if (!res.ok) return { missing: `grok voice HTTP ${res.status}` };
  try {
    // `finish_reason` IS READ NOW. This cast used to be `{ choices?: { message?: { content?: unknown } }[] }`,
    // which structurally threw the field away — so a reply that hit the cap and a reply that finished
    // were the same object by the time anything downstream could ask. She stopped talking and the glass
    // said nothing, which reads as finished rather than cut off.
    const data = await res.json() as {
      choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
    };
    const c = data?.choices?.[0]?.message?.content;
    const said = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: { text?: string }) => x?.text ?? '').join(' ') : '';
    // Only `'length'` — not "anything that is not stop". A server that sends no field, or one this
    // build has never heard of, has not told us she was cut off.
    const truncated = data?.choices?.[0]?.finish_reason === 'length';
    return said.trim()
      ? { ok: true, said: said.trim(), ms: Date.now() - began, ...(truncated ? { truncated: true as const } : {}) }
      : { missing: 'grok said nothing' };
  } catch {
    return { missing: 'grok voice returned non-JSON' };
  }
}

/**
 * THE MIND THE OWNER ACTUALLY PICKED, asked directly.
 *
 * ══ WHY THIS EXISTS ══
 *
 * The voice pill routed NOTHING. Every turn typed into the composer goes to `/api/forge/stream`
 * (`surface/app/surface-chat.js` — the branch above the presence call always returns, so the presence
 * path is unreachable from the box he types in), and that handler diverted to `askAuma` and then
 * `askGrokVoice` regardless of the pill. The door's own comment said so: the choice was read "for
 * nothing but the reading". So the one control on that box labelled with a model name changed nothing
 * about which model answered, and there was no way to find that out from the glass.
 *
 * `/api/presence/stream` DOES honour the pill — it resolves `mind` through MINDS and routes on it — but
 * it is reached only by `followUp()` and the voice organ, never by a typed sentence.
 *
 * This is the missing third rung. Same shape as `askGrokVoice`, same `VoiceResult`, same truncation
 * discipline: only `finish_reason === 'length'` counts, because a server that sends no field has not
 * told us she was cut off.
 *
 * ══ IT IS A VENDOR CALL AND THE CALLER MUST SAY SO ══
 *
 * `askAuma` reaches hardware the owner rents directly — no vendor sees the prompt or the repository.
 * This one reaches OpenRouter. That is a real difference in who reads his words, it is the difference
 * the pill is now allowed to make, and `selfKnowledge` is handed the route so the answer names it.
 */
export async function askVendorVoice(
  model: string,
  provider: unknown,
  question: string,
  prior: VoiceTurn[] = [],
  fetchImpl: typeof fetch = fetch,
  context?: string,
): Promise<VoiceResult> {
  const began = Date.now();
  let key: string | null = null;
  try {
    const cfg = await import('../../surface/key');
    key = (await cfg.resolveWorkingKey()).key?.key ?? null;
  } catch { /* no key module → treated exactly as no key */ }
  // NOT an error the owner should read as "that model is broken". No key is a fact about this node.
  if (!key) return { missing: 'no OpenRouter key on this node, so a vendor mind cannot be reached' };

  let res: Response;
  try {
    res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Aukora phi' },
      body: JSON.stringify({
        model,
        max_tokens: VOICE_MAX_TOKENS,
        ...(provider ? { provider } : {}),
        messages: [
          ...(context && context.trim() ? [{ role: 'system', content: context.trim().slice(0, 6000) }] : []),
          ...prior.map((t) => ({ role: t.role, content: t.content })),
          { role: 'user', content: question },
        ],
      }),
    });
  } catch (e) {
    return { missing: `${model} unreachable: ${String((e as Error)?.message ?? e).slice(0, 90)}` };
  }
  if (!res.ok) return { missing: `${model} answered HTTP ${res.status}` };
  try {
    const data = await res.json() as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] };
    const c = data?.choices?.[0]?.message?.content;
    const said = typeof c === 'string' ? c
      : Array.isArray(c) ? c.map((x: { text?: string }) => x?.text ?? '').join(' ') : '';
    const truncated = data?.choices?.[0]?.finish_reason === 'length';
    return said.trim()
      ? { ok: true, said: said.trim(), ms: Date.now() - began, ...(truncated ? { truncated: true as const } : {}) }
      : { missing: `${model} said nothing` };
  } catch {
    return { missing: `${model} returned non-JSON` };
  }
}

export function voiceLane(lane: 'build' | 'chat' | 'unsure' | undefined): boolean {
  return lane === 'chat' || lane === 'unsure';
}

/** A council never authorizes; neither does a voice. Ring 3, stated as a literal. */
export function voiceGrantsAuthority(): false {
  return false;
}

/**
 * Re-exported so the door has ONE import for the voice seam.
 *
 * `selfKnowledge` lives in its own module because it reads the engine registry, the standing seam and
 * the chain — three imports this file has no other reason to carry, and a voice module that transitively
 * pulls in the aura state is a voice module that cannot be tested without one.
 */
export { selfKnowledge, selfKnowledgeBlock, readSelfKnowledge, SELF_READ_BUDGET_MS, type SelfFact } from './selfKnowledge';
