// AUKORA — AUMA · LIVE: HALF-DUPLEX GATING, BARGE-IN ENERGY, AND SELF-ECHO FILTERING.
//
// WHY THIS FILE EXISTS. Auma Live had a good voice conversation and then LOOPED: bursts of speech-to-text
// endpoints interleaved with the first audio of her own text-to-speech, which is the signature of the mic
// hearing her voice and answering it.
//
// WHAT THE FIRST INVESTIGATION FOUND, because the fix depends on it. The TTS audio IS played by this page: one
// AudioWorklet (`/app/aumalive-audio.js`) captures the microphone AND plays her voice into the same
// AudioContext, so the browser's echo canceller does have a reference — the loop is not a routing bug. It is
// two gaps around a hint:
//
//   1. `echoCancellation: { ideal: true }` is a HINT, not a condition. A browser may ignore it and nothing in
//      the page ever read back what was actually applied, so a session could run with no canceller at all and
//      nobody would know.
//   2. THE MIC STAYED OPEN WHILE SHE SPOKE. The page forwarded every captured frame to the recogniser whenever
//      duplex was on, whatever she was doing — so her voice, the room's echo of it, and the residue the
//      canceller leaves behind all arrived as speech from the person.
//
// SO THIS MODULE IS THE GATE, written as pure functions over frames and text so a court can drive it without a
// browser: no AudioContext, no window, no timers of its own. `aumalive.js` keeps the wiring.
//
// THE RULES, in the order they apply to one captured frame:
//   · while she is AUDIBLE (`herSpeaking`) a frame is dropped, and the reason is named;
//   · after she stops, a TAIL keeps dropping frames, because a room does not go quiet when the speaker does;
//   · a frame above the SPEECH-ENERGY threshold that is SUSTAINED for a few frames is a barge-in: it is
//     forwarded and reported, and it is the only way the mic reopens early;
//   · when the canceller is MISSING the gate is STRICT: no barge-in at any energy, a longer tail, and a frame
//     is never forwarded while she is audible. A person who wants to interrupt can still wait for her pause.
//
// AND A TRANSCRIPT THAT IS HER OWN SENTENCE IS DROPPED even if it reaches the turn path, because a gate is a
// filter on frames and this is a filter on meaning: `isSelfEcho` compares what was heard with the last thing she
// said, normalised, so punctuation, case and a word of drift do not make her reply her own prompt.

/** Default energy ceiling, in RMS of a −1..1 signal, above which a frame may be counted as speech. */
export const BARGE_IN_RMS = 0.045

/** How many consecutive above-threshold frames a barge-in needs. One spike is a door, not a sentence. */
export const BARGE_IN_FRAMES = 3

/** How long the mic stays shut after her last audible frame, so a room can stop ringing. */
export const TAIL_MS = 320

/** The tail when there is no echo canceller to help: longer, because more of her voice comes back. */
export const STRICT_TAIL_MS = 700

/** How alike a transcript must be to her last utterance to be treated as her own voice returning. */
export const SELF_ECHO_SIMILARITY = 0.8

/**
 * Root-mean-square of a packet of 16-bit samples, as a 0..1 fraction of full scale.
 *
 * ACCEPTS WHAT THE WORKLET ACTUALLY SENDS: an `ArrayBuffer`, an `Int16Array`, or any typed array of samples.
 * An empty or unreadable packet is silence, never a barge-in.
 * @param pcm - the packet.
 * @returns the RMS in 0..1.
 */
export function frameRms(pcm) {
  if (pcm === null || pcm === undefined) return 0
  const samples = pcm instanceof ArrayBuffer
    ? new Int16Array(pcm)
    : (ArrayBuffer.isView(pcm) ? pcm : null)
  if (samples === null || samples.length === 0) return 0
  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] / 32768
    sum += value * value
  }
  return Math.sqrt(sum / samples.length)
}

/**
 * The words of an utterance, for comparison: lower case, punctuation dropped, whitespace collapsed.
 * @param text - what was heard or said.
 * @returns the word list.
 */
export function normaliseUtterance(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/u)
    .filter(word => word !== '')
}

/**
 * How alike two utterances are, as the share of words they have in common (Jaccard over word sets).
 * @param a - one utterance.
 * @param b - the other.
 * @returns the similarity in 0..1; 1 for two empty strings, because neither carries a turn.
 */
export function utteranceSimilarity(a, b) {
  const left = new Set(normaliseUtterance(a))
  const right = new Set(normaliseUtterance(b))
  if (left.size === 0 && right.size === 0) return 1
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared += 1
  return shared / (left.size + right.size - shared)
}

/**
 * Whether a transcript is the page's own voice coming back.
 *
 * CONTAINMENT COUNTS AS WELL AS OVERLAP: a recogniser that hears the tail of her sentence often returns a
 * fragment of it, and a fragment of her own sentence is still her own sentence.
 * @param transcript - what the recogniser produced.
 * @param lastSpoken - the last thing she said, in full.
 * @param options - `similarity` overrides the threshold.
 * @returns true when the transcript should not become a user turn.
 */
export function isSelfEcho(transcript, lastSpoken, options = {}) {
  const heard = normaliseUtterance(transcript)
  if (heard.length === 0) return false
  const spoken = normaliseUtterance(lastSpoken)
  if (spoken.length === 0) return false
  const threshold = options.similarity ?? SELF_ECHO_SIMILARITY
  if (utteranceSimilarity(heard.join(' '), spoken.join(' ')) >= threshold) return true
  // A FRAGMENT: three or more words, every one of them hers. A recogniser that catches the tail of her sentence
  // returns a fragment, and a fragment of her own sentence is still her own sentence — the court caught a
  // three-word fragment of an eight-word line being answered as a person, because the first version of this rule
  // also demanded half the sentence and three of eight is not half.
  //
  // THE LINE IS DRAWN AT THREE WORDS AND IT IS DELIBERATELY NOT LOWER. One or two words ('Stop.', 'Did you?')
  // are how a person interrupts, and dropping those would make the app deaf to exactly the phrases a barge-in
  // exists for. Three words that all come from her own last sentence, in a room where she has just spoken, are
  // her voice coming back.
  const hers = new Set(spoken)
  const allHers = heard.every(word => hers.has(word))
  return allHers && heard.length >= 3
}

/** Why a frame was dropped, or that it was not. Named, so a log or a court can say which rule applied. */
export const MIC_REASON = Object.freeze({
  OPEN: 'open',
  HER_VOICE: 'her-voice',
  TAIL: 'tail',
  BELOW_THRESHOLD: 'below-threshold',
  STRICT: 'strict-no-canceller',
})

/**
 * The microphone gate for one duplex session.
 *
 * It owns no clock: every call takes the current time, so a court can drive minutes of conversation in
 * microseconds and assert exactly which frames were forwarded.
 */
export class DuplexGate {
  /**
   * @param options - thresholds and timings; each has a documented default.
   */
  constructor(options = {}) {
    this.threshold = options.threshold ?? BARGE_IN_RMS
    this.bargeInFrames = options.bargeInFrames ?? BARGE_IN_FRAMES
    this.tailMs = options.tailMs ?? TAIL_MS
    this.strictTailMs = options.strictTailMs ?? STRICT_TAIL_MS
    /** True while her voice is audible in the room. */
    this.speaking = false
    /** When she was last audible, for the tail. */
    this.lastAudibleAt = Number.NEGATIVE_INFINITY
    /** How many consecutive above-threshold frames have arrived. */
    this.aboveRun = 0
    /** Set when the browser refused to cancel echo; makes the gate refuse barge-in entirely. */
    this.strict = false
    /** Counters, so a session can be reported rather than guessed at. */
    this.dropped = 0
    this.forwarded = 0
    this.bargeIns = 0
  }

  /**
   * Tell the gate whether she is audible.
   *
   * AUDIBLE IS NOT THE SAME AS "A REQUEST IS PENDING": a synthesis request exists before any sound does, and
   * the room is only at risk once frames are actually being played.
   * @param speaking - true while her voice is audible.
   * @param now - the current time in milliseconds.
   */
  herSpeaking(speaking, now) {
    this.speaking = speaking === true
    if (this.speaking) this.lastAudibleAt = now
  }

  /**
   * Note that an audible frame was played, which is what the tail is measured from.
   * @param now - the current time in milliseconds.
   */
  noteAudible(now) {
    this.lastAudibleAt = now
  }

  /**
   * Turn strict mode on or off. Strict means the browser is not cancelling echo, so the only safe assumption is
   * that everything the microphone hears while she speaks is her.
   * @param on - whether the canceller is missing.
   */
  setStrict(on) {
    this.strict = on === true
  }

  /** The tail in force right now. */
  tailNow() {
    return this.strict ? this.strictTailMs : this.tailMs
  }

  /**
   * Decide one captured frame.
   * @param pcm - the packet, as the worklet sent it.
   * @param now - the current time in milliseconds.
   * @returns whether to forward it, why, the frame's energy, and whether this frame completed a barge-in.
   */
  decide(pcm, now) {
    const rms = frameRms(pcm)
    // A FRAME ARRIVING WHILE SHE SPEAKS IS PROOF SHE IS AUDIBLE NOW, so the tail is measured from her LAST frame
    // rather than from the moment the flag was raised. Without this the tail quietly expired during a long reply
    // and the microphone reopened on the last syllable — which the court caught by asserting the reason on every
    // dropped frame, not merely the count.
    if (this.speaking) this.lastAudibleAt = now
    const speaking = this.speaking || (now - this.lastAudibleAt) < this.tailNow()
    if (speaking) {
      // A BARGE-IN IS THE ONE THING THAT OPENS THE MIC EARLY, and only a sustained, loud frame qualifies. With
      // no canceller there is no barge-in at all: what sounds like a person is her own voice coming back.
      const loud = rms >= this.threshold
      this.aboveRun = loud ? this.aboveRun + 1 : 0
      if (!this.strict && this.aboveRun >= this.bargeInFrames) {
        this.bargeIns += 1
        this.aboveRun = 0
        this.lastAudibleAt = Number.NEGATIVE_INFINITY
        this.forwarded += 1
        return { forward: true, reason: MIC_REASON.OPEN, rms, bargeIn: true }
      }
      this.dropped += 1
      return {
        forward: false,
        reason: this.speaking ? (this.strict ? MIC_REASON.STRICT : MIC_REASON.HER_VOICE) : MIC_REASON.TAIL,
        rms,
        bargeIn: false,
      }
    }
    this.aboveRun = 0
    this.forwarded += 1
    return { forward: true, reason: MIC_REASON.OPEN, rms, bargeIn: false }
  }
}
