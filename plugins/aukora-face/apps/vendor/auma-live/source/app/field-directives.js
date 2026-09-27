// Aukora Spatial — the [field …] body-language grammar, ONE source of truth.
//
// Her mind is taught the grammar in spatial/presenceLane.ts (which imports the
// vocabulary below, so prompt and parser can never drift). The SERVER splits
// tags out of the token stream at the SSE pump and re-emits them as typed
// {"t":"field","v":"[field …]"} events — so no client can ever speak one.
// Browser organs (aumalive.js, knvs-duplex.js) also run this same filter over
// the text they receive as defense in depth (an older door, a replayed log).
//
//   const dirs = makeDirectiveFilter((tag) => field.alien(tag));
//   …on each text chunk:  clean += dirs.push(chunk)
//   …at end of turn:      clean += dirs.flush()
//
// Guarantees:
//   - a complete `[field …]` tag is applied exactly once and emits nothing
//   - a tag split across chunk boundaries (even "[ fi" + "eld …]") is held,
//     then applied when it closes
//   - an unclosed `[field …` at end-of-turn is dropped, never read aloud
//   - bracketed text that merely STARTS like a tag ("[fields of gold]") passes
//     through as ordinary text once its `]` proves it isn't one

// The vocabulary. presenceLane.ts composes the prompt from these keys and the
// client parser resolves them — add a hue or form HERE and both sides learn it.
export const FIELD_HUES = { blood: 0, ember: 18, amber: 32, gold: 45, green: 129, jade: 140, teal: 178, cyan: 190, sky: 205, azure: 215, indigo: 240, purple: 270, violet: 280, magenta: 320, rose: 345 };
export const FIELD_FORMS = { aurora: 0, flow: 0, vortex: 1, spiral: 1, pulse: 2, rings: 2, swarm: 3, stars: 3 };

export function makeDirectiveFilter(apply) {
  let pend = '';
  const TAG_RE = /^\[\s*field\b[^\]]*\]/i;
  function scan(atEnd) {
    let out = '';
    for (;;) {
      const i = pend.indexOf('[');
      if (i < 0) { out += pend; pend = ''; break; }
      out += pend.slice(0, i);
      pend = pend.slice(i);
      const m = pend.match(TAG_RE);
      if (m) { try { apply(m[0]); } catch { /* junk tag — ignore */ } pend = pend.slice(m[0].length); continue; }
      // could this still become a [field tag as more tokens arrive? Normalize
      // "[  fi" → "[fi" so a whitespace-padded tag split across chunks holds too.
      const growing = pend.indexOf(']') < 0
        && '[field'.startsWith(('[' + pend.slice(1).trimStart()).slice(0, 6).toLowerCase());
      if (growing) {
        if (!atEnd && pend.length < 80) break;                             // tag still streaming in — hold (real tags are short)
        if (atEnd && pend.length <= 80) { pend = ''; break; }              // truncated tag at end-of-turn — drop it silently
        // an unclosed "[field …" that blew the cap is NOT a tag — a malformed
        // one must never swallow her words, so it falls through as plain text
      }
      // the leading '[' is proven ordinary — emit through to the next '[' in one move
      const nb = pend.indexOf('[', 1);
      if (nb < 0) { out += pend; pend = ''; break; }
      out += pend.slice(0, nb); pend = pend.slice(nb);
    }
    return out;
  }
  return {
    push(chunk) { pend += String(chunk); return scan(false); },
    flush() { return scan(true); },
  };
}
