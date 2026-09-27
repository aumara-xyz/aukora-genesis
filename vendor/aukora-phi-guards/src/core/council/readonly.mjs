#!/usr/bin/env node
// AUKORA ONE · scripts/council-readonly.mjs — the council's read-only fence
//
// Crush runs this as a `PreToolUse` hook before every tool call. Exit 0 allows
// the call; exit 2 refuses it. This is the thing that actually makes a council
// read-only.
//
// ══ WHY THIS FILE EXISTS AT ALL: `allowed_tools` IS NOT A RESTRICTION ══
//
// The obvious way to build a read-only reviewer is:
//
//     "permissions": { "allowed_tools": ["view", "ls", "glob", "grep"] }
//
// That does not work, and it fails OPEN. Measured on crush v0.86.0: with
// exactly that config, a model asked to create a file created it.
//
// The official schema says why, in its own words:
//
//     "allowed_tools": "List of tools that don't require permission prompts"
//
// It is an AUTO-APPROVE list, not an allow-list. It says which tools skip the
// confirmation prompt — and in non-interactive `crush run` there is no prompt to
// skip, so everything runs regardless. A config that reads like a fence and is
// actually a convenience setting is the most dangerous shape a setting can have.
//
// So the allow-list stays in `crush.json` (it is still correct as an intent, and
// it matters in interactive use) and THIS is the enforcement. Verified the same
// way: with this hook installed, the identical prompt produced no file and the
// model reported that a security hook had blocked it.
//
// ══ WHY `law/hooks/pretooluse.mjs` DOES NOT COVER THIS ══
//
// It is a RING-0 fence, and a correct one: it refuses `bash` and any write to
// `ring0/ law/ kernel/ authority/`. It permits an ordinary write BY DESIGN,
// because the chat lane is supposed to be able to edit Ring 2.
//
// A council is a different job. Measured against the council worktree, with
// that hook installed and the allow-list set to `view ls glob grep`:
//
//     $ crush run -c ~/aukora-council-<lane> -m openrouter/... \
//         "Create FRESHTEST.txt containing yes."
//     -> FRESHTEST.txt created
//
// Crush's own log for that call:
//
//     Hook completed decision=none event=PreToolUse hooks=1 tool=write
//
// The hook RAN and allowed it, correctly, because the path was not Ring 0. So
// the council could edit the very code it was reviewing, and a later round
// would review its own edits. This file closes that, and is installed by
// `convene()` ALONGSIDE the Ring-0 hook rather than instead of it.
//
// A fence you trust completely is a fence you have stopped testing.

let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  // The payload shape is Crush's business and free to change between versions,
  // so this does not depend on one. It reads a tool name if it can find one,
  // and falls back to scanning the whole payload — which fails CLOSED, because
  // a payload this cannot parse is a payload it cannot clear.
  let name = '';
  try {
    const j = JSON.parse(raw);
    name = String(j.tool_name ?? j.tool ?? j.name ?? j?.params?.tool ?? '');
  } catch {
    name = raw;
  }
  // ══ AN ALLOW-LIST, BECAUSE A DENY-LIST FAILED OPEN ══
  //
  // This was a FORBIDDEN pattern — write|edit|bash|… — and anything not matching
  // was allowed. A test found the hole in one line: an EMPTY payload `{}` has no
  // tool name, matches no forbidden word, and was ALLOWED. So the moment Crush
  // changes its payload shape, every tool becomes permitted and nothing says so.
  //
  // That is the precise failure this file exists to prevent, committed by this
  // file, and it shipped in the first version. Inverted: name a tool we
  // positively recognise as read-only, or be refused.
  const READ_ONLY = /^(view|ls|glob|grep|diagnostics|read|search|find)$/i;

  if (!READ_ONLY.test(name.trim())) {
    // stderr is what the model is shown, so it explains itself rather than
    // failing mutely and letting the model conclude the file was unwritable.
    process.stderr.write(
      `council: REFUSED — this is a READ-ONLY council. Tool "${(name || '(unreadable payload)').slice(0, 40)}" `
      + 'is not on the read-only allow-list. You may view, ls, glob and grep. '
      + 'Report what you find; do not change it.\n',
    );
    process.exit(2);
  }
  process.exit(0);
});
