// φ — WHAT THIS NODE IS, READ THIS TURN, SO SHE DOES NOT HAVE TO GUESS OR DISCLAIM.
//
// ══ THE MEASUREMENT ══
//
// Asked "who are you running, crush, Opus 5?", she answered *"I don't know what model or harness is
// powering me."* Asked what Aukora is: *"I don't know. I have no internal access to inspect any
// system."*
//
// That was not a failure. It was an instruction. `AUMA_SYSTEM` ended "If you are asked something about
// yourself that is not in this paragraph, say you do not know rather than guessing", and
// `GROK_VOICE_SYSTEM` said "you have no special knowledge of this project's own internal history …
// if asked what powers you, say you don't know rather than guessing one."
//
// Both clauses were correct fixes for a real failure. The prompt before them produced *"I'm still Grok
// running on xAI infrastructure"* — confident, specific, wrong — and before that, a whole fictional
// architecture with memory "shards" and a "purpose-built database". Faced with a model that invents an
// answer, someone told it to have no answer. **The cure for a hallucinated identity was amnesia**, and
// amnesia is only the less embarrassing of the two.
//
// ══ THE THING NOBODY USED ══
//
// The node knows every single answer she was told to disclaim, and none of it reached her:
//
//     which engine, which binary   the engine registry — probed, with the binary's own version string
//     whether she is bound         core/aura/state.ts — `bound`, and the genesis absence
//     her own history              the same — receipt counts, heads, break classes
//     her standing                 core/authority/standing.ts
//
// So this module reads them and hands her the reading. `/api/aura/state` was built to draw a face;
// the same numbers are her self-knowledge. It is the move the whole system already runs on — answer
// from the record, not from belief — pointed at the one participant who had been exempted from it.
//
// ══ THE THREE RULES, ALL LEARNED HERE EXPENSIVELY ══
//
// 1. MEASURED, NEVER REMEMBERED. Every fact carries its source, and the block says when it was read.
//    The failure mode being replaced is a model reporting what it believes about itself; the fix is
//    not a better belief but a sentence that is downstream of a read performed seconds ago. If the
//    read did not happen, there is no fact — never a remembered one.
//
// 2. AN UNAVAILABLE VALUE IS ITS OWN SENTENCE. One probe failing costs exactly one fact. She still
//    knows her standing when the chain is unreadable, and says the chain is unreadable. A single
//    failure must never collapse back into "I know nothing about myself", which is the behaviour
//    being removed — see `test/self-knowledge.test.ts`, which drives the all-probes-down case for
//    exactly this reason.
//
// 3. NOTHING RICHER THAN A COUNT. This text is handed to a VENDOR when the Grok fallback answers, so
//    it inherits `/api/aura/state`'s fence and not a weaker one: counts, states and version strings.
//    Never a path, a receipt body, a prompt, or a hash.
//
// ══ WHAT THIS DELIBERATELY DOES NOT READ ══
//
// `listEngines()` — the route behind `/api/forge/engines` — costs **2876ms measured**, because
// readiness spawns a real `crush run` preflight per engine. A talk turn cannot pay that, and a voice
// that takes three seconds to say hello is worse than one that cannot name its own binary. So the
// engine is read with `engineStatus(id)`, which is the presence probe only, cached per process:
// **127ms cold, 0ms after**. What she gets is therefore "crush, and the binary answers, and here is
// what it said its version was" — never "crush is ready", which is a claim this path did not pay for.

import { DEFAULT_ENGINE, engineStatus, type EngineId } from './engines';
import { AUMA_MODEL, AUMA_URL } from './voice';

/**
 * One thing the node knows about itself, or one thing it could not read.
 *
 * `value: null` is a first-class outcome and the reason this is a list of records rather than an
 * object of strings: a missing key would vanish from the rendered block, and a fact that vanishes is
 * indistinguishable from a fact nobody asked for. She has to be able to say *"I could not read that"*,
 * which requires the field to still be there.
 */
export interface SelfFact {
  /** Short, stable, lowercase — this is what she will call the thing. */
  key: string;
  /** The measured value, or `null` when the read did not succeed. */
  value: string | null;
  /** Where it came from. A value without one is not evidence, and the block prints it beside the value. */
  source: string;
  /** Only when `value` is null: what stopped the read, in words a person can act on. */
  why?: string;
}

/** How long the whole reading may take before the voice gives up on it and answers anyway. */
export const SELF_READ_BUDGET_MS = 900;

/**
 * Render the facts as the block that goes into her context.
 *
 * AN EMPTY READING RENDERS NOTHING AT ALL. A heading with no facts under it is an invitation to fill
 * it in, which is the hallucination path this module exists to close — the prompt that produced "I'm
 * still Grok" was one that had a place for a fact and no fact in it.
 */
export function selfKnowledgeBlock(facts: SelfFact[]): string {
  if (!facts.length) return '';
  const lines = facts.map((f) => (f.value !== null
    ? `  ${f.key}: ${f.value}   [${f.source}]`
    : `  ${f.key}: UNAVAILABLE — ${f.why ?? 'the read did not answer'}   [${f.source}]`));
  return '[what this node is, read just now]\n'
    + lines.join('\n')
    + '\nThese were read from this machine this turn, not from memory and not from training. State them '
    + 'as they are. Where a line says UNAVAILABLE, say that particular thing could not be read right '
    + 'now — do not guess it, and do not let it stand for anything else you were not asked about.';
}

/** Thousands separators, because "6602 receipts" is read aloud wrong and "6,602" is not. */
const count = (n: number): string => n.toLocaleString('en-US');

/**
 * Read the node, one probe at a time, each in its own `try`.
 *
 * THE PER-FACT `try` IS THE DESIGN, not defensive habit. A single `try` around all of them would mean
 * one unreadable chain deletes her standing, her engine and her name from the block — which is a
 * blanket disclaimer wearing a different hat, and the exact behaviour this module replaces.
 *
 * @param voice which mind is answering THIS turn. Only the caller knows: the door tries her own GPU
 *   first and falls through to the vendor, so this cannot be inferred here without being wrong.
 */
export async function readSelfKnowledge(
  voice: 'auma' | 'grok' | null,
  deps: {
    auraState?: () => Promise<unknown>;
    standing?: () => { standing: string };
    engine?: (id: EngineId) => Promise<{ id: string; available: boolean; note?: string; missing?: string[] }>;
    /** The door's own `approve` bit for this request — the composer's Build mode switch, as read. */
    buildMode?: boolean;
    /**
     * What the owner PICKED in the selector, if the request carried it. A request, not an answer.
     * `label` is what the pill says; `model` is the id that label resolves to through MINDS.
     */
    chose?: { key: string; label: string; model: string };
    /**
     * What actually replied, resolved where the request was routed. `route` is how it was reached —
     * the difference the owner cares about most is whether a vendor saw the turn.
     */
    answered?: { model: string; route: string };
  } = {},
): Promise<SelfFact[]> {
  const facts: SelfFact[] = [];

  // ── which mind is speaking, and on what ────────────────────────────────────────────────────────
  //
  // Not a probe: the door has already chosen by the time it asks. Stated anyway, because "which model
  // is answering me" is the question that started this, and because the two paths differ in the one
  // way the owner cares about — whether a vendor sees the conversation.
  if (voice === 'auma') {
    facts.push({
      key: 'voice',
      value: `AUMA — a merged Qwen2.5-VL-32B-Instruct served as "${AUMA_MODEL}" on the owner's own GPU, `
        + 'reached over a private tunnel. No vendor sees this conversation.',
      source: `this process · ${AUMA_URL.replace(/^https?:\/\//, '').split('/')[0]}`,
    });
  } else if (voice === 'grok') {
    facts.push({
      key: 'voice',
      value: 'the vendor fallback — AUMA\'s box did not answer this turn, so this reply is coming from '
        + 'the hosted model. That vendor sees this turn.',
      source: 'this process',
    });
  }

  // ── WHICH MODEL ANSWERED THIS TURN ─────────────────────────────────────────────────────────────
  //
  // The `voice` fact above names a PATH — AUMA's box or the vendor fallback. Asked which MODEL is
  // speaking she had nothing, because nothing here had ever been told. She answered honestly from a
  // block with a hole in it, and an honest report of a hole reads as a broken node.
  //
  // ══ AND THE SELECTOR AND THE RESPONDER CAN GENUINELY DISAGREE ══
  //
  // Two talk paths, one selector. `/api/presence/stream` resolves `b.mind` through MINDS, so a pill
  // reading "Fable 5" is a real routing decision there. The composer's `/api/forge/stream` diverts to
  // `askAuma` (AUMA_MODEL) and then `askGrokVoice` (grokDefaultModel()) — neither reads the choice.
  // So the owner can pick Fable 5, type into the composer, and be answered by Grok.
  //
  // That is a real defect in the routing and it is NOT fixed here: re-routing changes which model
  // answers him, which is his call. What is fixed is that she can no longer be silent about it. Both
  // are stated, and the disagreement is named rather than smoothed over.
  //
  // A CHOICE IS NOT EVIDENCE. With a selection but no resolved responder this reports UNAVAILABLE and
  // keeps the choice in the `why` — reporting the pill as the answer is exactly the guess this module
  // exists to remove.
  if (deps.chose || deps.answered) {
    const chose = deps.chose;
    const answered = deps.answered;
    const picked = chose ? `${chose.label} (${chose.model})` : null;
    if (!answered) {
      facts.push({
        key: 'mind',
        value: null,
        source: 'this request',
        why: picked
          ? `the request asked for ${picked}; what replied was not recorded on this turn, and the `
            + 'choice is not evidence about the answer'
          : 'no responder was recorded on this turn',
      });
    } else if (chose && chose.model !== answered.model) {
      facts.push({
        key: 'mind',
        value: `${answered.model}, reached through ${answered.route} — NOT ${picked}, which is what the `
          + 'selector asked for. The composer does not route on that choice; the two disagree on this turn '
          + 'and both are true: that is what was asked for, this is what replied.',
        source: 'this request · the selector and the resolved responder',
      });
    } else {
      facts.push({
        key: 'mind',
        value: `${answered.model}, reached through ${answered.route}`
          + (chose ? ` — the selector asked for ${chose.label} and that is what replied` : ''),
        source: 'this request · the resolved responder',
      });
    }
  }

  // ── WHAT THE LAST ROUND DID, SO THIS TURN CAN ITERATE ON IT ────────────────────────────────────
  //
  // Her own account of the gap: "working-memory gives me the last apply's files. Not the gate result,
  // not the diff, not whether it landed. So I can start a round and cannot properly iterate on it next
  // turn." This is where that reaches her — the block she already reads every turn, beside the rest of
  // what was measured a second ago.
  //
  // The module distinguishes an unreadable memory from an empty one and renders the difference, so a
  // failure here arrives as "could not be read" rather than as "nothing happened". Both are handed
  // over as the FACT'S OWN WORDS: this file does not re-interpret them.
  try {
    const { roundMemoryBlock } = await import('../../surface/round-memory');
    const block = await roundMemoryBlock();
    facts.push({
      key: 'round',
      value: block.replace(/^\[the last round\]\s*/, '').replace(/\n\s*/g, ' · ').trim(),
      source: 'this node\'s round memory',
    });
  } catch (e) {
    facts.push({ key: 'round', value: null, source: 'this node\'s round memory', why: reason(e) });
  }

  // ── the hand that would build, and whether its binary answers ──────────────────────────────────
  //
  // `hand` is kept for the `reach` fact below, which has to name the same binary this probe just saw
  // rather than the constant we happen to hold. When the probe throws, `hand` stays null and `reach`
  // says only the half it can still stand behind — the same per-fact discipline as everywhere here.
  let hand: string | null = null;
  try {
    const id = DEFAULT_ENGINE;
    const st = await (deps.engine ?? engineStatus)(id);
    hand = st.available
      // `note` is the prober's own captured stdout — the binary saying its version, not a name we hold.
      ? `${st.id} — ${st.note ?? 'the binary answered'}`
      : `${st.id} — not available on this machine${st.missing?.length ? ` (needs ${st.missing.join(', ')})` : ''}`;
    facts.push({ key: 'builder', value: hand, source: 'engine presence probe' });
  } catch (e) {
    facts.push({ key: 'builder', value: null, source: 'engine presence probe', why: reason(e) });
  }

  // ── what THIS turn can reach, and what the switch beside the box changes ────────────────────────
  //
  // #121 gave a question a second destination: with Build mode ON the composer sends it to the engine,
  // which reads the repository and is fenced off from proposing a change. The voice prompts predate
  // that and describe only the turn they are on, so the owner asking "can you read files?" was told —
  // truthfully, and measured against the live door — "no, this turn is talk-only with no tools", and
  // heard an answer about the node. Turn-accurate, system-silent.
  //
  // Both halves therefore live in ONE fact. Split across two she could quote either alone and be
  // exactly as misleading as before; together, the sentence in front of her cannot say what this turn
  // cannot do without also saying what the other switch position does.
  //
  // MEASURED, never remembered: `buildMode` is the door's own `approve` bit for THIS request, and the
  // engine is named from the probe above. Neither is a fact about the product held inside a prompt.
  const talkHalf = 'no tools are available to it, so nothing on this turn has read, checked or run '
    + 'anything';
  const readHalf = hand
    ? `the question reaches the build engine — ${hand} — which reads the repository to answer and is `
      + 'fenced off from proposing a change'
    : 'the question reaches the build engine, which reads the repository to answer — but the engine '
      + 'probe did not answer just now, so this reading cannot name it or say whether it is installed';
  facts.push({
    key: 'reach',
    value: deps.buildMode
      ? `Build mode is ON for this request, so ${readHalf}. With Build mode OFF the same question is `
        + `talk-only: ${talkHalf}.`
      : `Build mode is OFF for this request, so this turn is talk-only — ${talkHalf}. With Build mode `
        + `ON, ${readHalf}.`,
    source: "this request · the composer's Build mode switch",
  });

  // ── standing ───────────────────────────────────────────────────────────────────────────────────
  try {
    const s = deps.standing ? deps.standing() : (await import('../authority/standing')).standingReport();
    facts.push({ key: 'standing', value: s.standing, source: 'the standing seam' });
  } catch (e) {
    facts.push({ key: 'standing', value: null, source: 'the standing seam', why: reason(e) });
  }

  // ── the record: bound, mood, and how much history is behind her ────────────────────────────────
  //
  // One read, three facts. They come from a single call and are split apart on purpose: "bound" is a
  // claim about identity, "receipts" is a claim about history, and a reader who conflates them gets
  // the sentence this repository is most careful about — a picture of a record read as an authority.
  try {
    const raw = deps.auraState
      ? await deps.auraState()
      : await (await import('../aura/state')).auraStateForDoor();
    const st = raw as {
      bound?: boolean;
      mood?: { mood?: string; because?: string };
      record?: { receipts?: number; signed?: number; heads?: number };
      genesis?: { absence?: string };
    };
    facts.push({
      key: 'bound',
      value: st.bound === true
        ? 'yes — something has signed for this node'
        : `no — nothing has signed for this node${st.genesis?.absence ? ` (${st.genesis.absence})` : ''}. `
          + 'The record is self-attested: it can be checked for internal consistency, not proven to be mine.',
      source: 'the chain, verified this turn',
    });
    const rec = st.record ?? {};
    facts.push({
      key: 'record',
      value: typeof rec.receipts === 'number'
        ? `${count(rec.receipts)} receipts, ${count(rec.signed ?? 0)} of them signed, ${count(rec.heads ?? 0)} heads`
        : 'the chain answered without a receipt count',
      source: 'the chain, verified this turn',
    });
    if (st.mood?.mood) {
      facts.push({
        key: 'mood',
        value: `${st.mood.mood}${st.mood.because ? ` — ${st.mood.because}` : ''}`,
        source: 'core/aura/mood.ts',
      });
    }
  } catch (e) {
    const why = reason(e);
    // THREE FACTS, THREE UNAVAILABLES. Collapsing them into one line would let her answer "I could not
    // read the record" to a question about being bound, which is a different and larger claim.
    for (const key of ['bound', 'record']) {
      facts.push({ key, value: null, source: 'the chain', why });
    }
  }

  return facts;
}

/** Never the stack, never a path — the sentence a person can act on. */
function reason(e: unknown): string {
  const m = (e as Error)?.message ?? String(e ?? 'unknown');
  return m.replace(/\/[^\s:]+/g, '<path>').slice(0, 140);
}

/**
 * The whole thing, bounded.
 *
 * The reads are cheap — 0ms for standing, 127ms cold and 0ms cached for the engine probe, ~150ms for
 * the chain — but "cheap on this machine today" is not a guarantee, and the chain read grows with the
 * record. A deadline here is the same discipline the eye already carries: a per-turn read that can
 * hang is a per-turn way to lose the composer, which has happened once already on the sight path.
 *
 * A timeout yields an EMPTY reading rather than a partial lie, and an empty reading renders no block —
 * so she falls back to answering without self-knowledge, which is the old behaviour minus the
 * instruction to disclaim. Slower than promised is never a reason to say something untrue.
 */
export async function selfKnowledge(
  voice: 'auma' | 'grok' | null,
  buildMode = false,
  mind: { chose?: { key: string; label: string; model: string }; answered?: { model: string; route: string } } = {},
): Promise<string> {
  const facts = await Promise.race([
    readSelfKnowledge(voice, { buildMode, ...mind }).catch(() => [] as SelfFact[]),
    new Promise<SelfFact[]>((resolve) => setTimeout(() => resolve([]), SELF_READ_BUDGET_MS)),
  ]);
  return selfKnowledgeBlock(facts);
}
