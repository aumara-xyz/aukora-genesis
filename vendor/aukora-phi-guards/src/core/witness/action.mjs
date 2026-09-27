// aukora · core/witness/action.mjs — WHAT A RECEIPT IS EVIDENCE OF
//
// ══ THE TAXONOMY THIS REPLACES WAS WRONG IN BOTH DIRECTIONS ══
//
// The first version had three classes: ACTION (`allowed` / `refused`), ATTENTION (`unguarded`), and
// BOUNDARY (session lifecycle). Codex overturned both of the load-bearing ones, and the live chain
// settles it. Measured on the owner's node the day this was written — 8,793 receipts:
//
//     unguarded  8,178      allowed  565      refused  50
//     of the unguarded:  Bash 5,117 · run_terminal_command 158  →  5,275 SHELL CALLS
//
// **`unguarded` was called ATTENTION.** But `guard.mjs` says in its own words that a shell string
// cannot be inspected for what it will touch — `eval`, `$(…)` and base64 defeat it, and the problem is
// undecidable in general. So the largest single group inside "attention" is the group the fence
// explicitly cannot see. Those 5,275 receipts are the LEAST inspected things in the chain, and the old
// name made them read as the most contemplative. A shell command can rewrite the repository; calling
// it "attention" is the exact overclaim this record exists to refuse.
//
// The sharpest demonstration available: the edits that produced THIS FILE arrived through that path.
// The fence refused the file-tool write to `core/witness/**` and named the rule; the shell heredoc that
// followed was recorded as one more `unguarded:not-a-file-tool` receipt. Nothing was evaded — the law
// is the owner's to open — but the record cannot tell those two apart, and that is the whole point.
//
// **`allowed` / `refused` were called ACTION.** They are not. They are a VERDICT ON A DECLARED WRITE
// PATH — an intent that was judged. Three things follow, and each breaks the old reading:
//
//   · `allowed` does not mean a write happened. The call may have failed, been cancelled, or written
//     nothing. The receipt proves the fence said yes, not that bytes moved.
//   · one tool call can produce SEVERAL path receipts, so counting them counts judgements, not deeds.
//   · `refused` on a sibling path is an innocent bystander being told no — `law:sibling-refused`
//     appears 3 times in the live chain — and reads as a rebuke when counted as a refused action.
//
// ══ THE CLASSES, AND WHAT EACH IS ACTUALLY EVIDENCE OF ══
//
//   ATTENTION           an explicitly read-only tool. She looked. The one class that means what its
//                       name says, now that shell has been taken out of it.
//   UNJUDGED            recorded and UNINSPECTABLE — shell, and tools nobody classified. The chain
//                       shows its own edge here. This is the honest name for most of the record.
//   BOUNDARY            session lifecycle. Structure, not conduct. A long session is not a busy one.
//   JUDGED_WRITE_PATH   the law returned a verdict on a declared path. An INTENT, not an effect.
//   OWNER_OUTCOME       what the owner decided about work already done — apply, discard, roll back.
//                       Kept separate because who decided and what happened are the two facts a
//                       biography of an agent must never merge into "it did a thing".
//
// ══ ON THE WORD "BIOGRAPHY" ══
//
// The point of separating these is that NONE of them is a count of accomplishments, and the previous
// shape let one be read as such. `verifyChain` publishes ONE projection (`biographyOf`) so there is a
// single place this can be got wrong, and total receipts stay available as COVERAGE — how much of the
// session the chain saw — which is a different question from what she did.
//
// ══ FIELD NAMES ARE A COORDINATION POINT, NOT A LOCAL CHOICE ══
//
// `core/aura/**` renders the self-account and is another lane's file. Nothing there imports this module
// today — checked, not assumed — so no vocabulary has forked yet, and that is precisely why the names
// below need AURA's confirmation BEFORE either side writes them into a surface. They are proposed here
// and deliberately additive: no field any other lane already reads has been renamed or removed.

/** Named so a consumer can refuse a shape it does not understand rather than read fields off it. */
export const BIOGRAPHY_SCHEMA = 'aukora-biography-v1';

export const RECEIPT_CLASSES = Object.freeze({
  ATTENTION: 'witness:attention',
  UNJUDGED: 'witness:unjudged',
  BOUNDARY: 'witness:boundary',
  JUDGED_WRITE_PATH: 'witness:judged-write-path',
  OWNER_OUTCOME: 'witness:owner-outcome',
});

/**
 * Tools that are explicitly read-only. NOT the same list as `guard.mjs`'s `KNOWN_NON_WRITE_TOOLS`, and
 * the difference is the entire correction: that list exists to separate "not a file tool" from
 * "unknown tool" for the fence, and it contains `Bash`. A shell is not a read.
 *
 * Membership is POSITIVE. Anything not named here is UNJUDGED, so a tool arriving in a future harness
 * is recorded as uninspected rather than quietly counted as her having read something.
 */
export const READ_ONLY_TOOLS = Object.freeze([
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'NotebookRead',
  'ListMcpResources', 'ReadMcpResource', 'BashOutput',
  // Grok Build's spellings for the same capabilities.
  'read_file', 'list_dir', 'grep', 'web_search', 'web_fetch',
  'get_command_or_subagent_output',
]);

/** Shell, named rather than inferred. `guard.mjs` states it cannot inspect these; so does this. */
export const UNINSPECTABLE_TOOLS = Object.freeze(['Bash', 'run_terminal_command']);

const SESSION_PREFIX = 'session:';
const OUTCOME_CLASSES = Object.freeze(['owner:applied', 'owner:discarded', 'owner:rolled-back']);

/**
 * What is this one receipt evidence of?
 *
 * The order is the argument. Session boundaries first, because a `SessionStart` also carries
 * `unguarded` and would otherwise be swallowed by the tool test. Owner outcomes next, because they are
 * the only class about a decision rather than a call.
 */
export function classifyReceipt(receipt) {
  // An unreadable receipt is UNJUDGED, not ATTENTION. The old code returned ATTENTION here, so a torn
  // line read as "she looked at something" — inventing conduct out of damage.
  if (!receipt || typeof receipt !== 'object') return RECEIPT_CLASSES.UNJUDGED;

  const reasonClass = typeof receipt.reasonClass === 'string' ? receipt.reasonClass : '';
  if (reasonClass.startsWith(SESSION_PREFIX)) return RECEIPT_CLASSES.BOUNDARY;
  if (OUTCOME_CLASSES.includes(reasonClass)) return RECEIPT_CLASSES.OWNER_OUTCOME;

  if (receipt.verdict === 'allowed' || receipt.verdict === 'refused') {
    return RECEIPT_CLASSES.JUDGED_WRITE_PATH;
  }

  const tool = typeof receipt.tool === 'string' ? receipt.tool : '';
  if (READ_ONLY_TOOLS.includes(tool)) return RECEIPT_CLASSES.ATTENTION;
  return RECEIPT_CLASSES.UNJUDGED;
}

/**
 * THE ONE CANONICAL PROJECTION. `verifyChain` publishes this and nothing derives a rival.
 *
 * `judgedWritePaths` is deliberately NOT called "actions" and deliberately NOT summed with anything.
 *
 * COVERAGE IS NOT IN HERE. It used to be, and that was the same mistake in miniature: a total sitting
 * inside a biography is a total that gets read as part of one. "How much of the session did the chain
 * see" is a real and useful question, and it is not the question this object answers — so it travels
 * BESIDE these counts, as `verifyChain`'s own `receipts`, where nothing can spread it into a class.
 */
export function biographyOf(receipts) {
  const counts = { attention: 0, unjudged: 0, boundary: 0, judgedWritePaths: 0, ownerOutcomes: 0 };
  const bucket = {
    [RECEIPT_CLASSES.ATTENTION]: 'attention',
    [RECEIPT_CLASSES.UNJUDGED]: 'unjudged',
    [RECEIPT_CLASSES.BOUNDARY]: 'boundary',
    [RECEIPT_CLASSES.JUDGED_WRITE_PATH]: 'judgedWritePaths',
    [RECEIPT_CLASSES.OWNER_OUTCOME]: 'ownerOutcomes',
  };
  let uninspectable = 0;
  for (const r of receipts ?? []) {
    counts[bucket[classifyReceipt(r)]] += 1;
    if (UNINSPECTABLE_TOOLS.includes(r?.tool)) uninspectable += 1;
  }
  return {
    schema: BIOGRAPHY_SCHEMA,
    ...counts,
    // Its own number, because "most of this record is shell nobody could inspect" is the single most
    // important caveat on every other number here, and a caveat nobody can see is not one.
    uninspectableShellCalls: uninspectable,
  };
}

// `classifyAll` was exported here for "callers that need the detail rather than the totals". It had
// none, in any round. An export invented for a caller that never arrived is the same shape as a check
// with no caller — it is just quieter about it — so it is gone until something actually needs it.
