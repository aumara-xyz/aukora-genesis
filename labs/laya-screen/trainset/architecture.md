# Governed theme-change loop (context for the note screen)

**Actors.** *Auma* (the model agent) runs inside an NVIDIA OpenShell sandbox with no network. It can only reach the
outside through four gate tools: `read_target`, `propose_change`, `revert_change`, `change_log`.

**Gate.** `aukora-gate` runs as a separate Linux user. It owns the allowlisted target files, the proposals DB and the
ledger; the harness reaches it only through a Unix socket. On every proposal it:
- validates the schema: `theme.json` = `{"accent": "#RRGGBB" | "default"}` and nothing else;
- requires the base sha (the proposal must name the bytes it changes; a stale base is refused);
- issues a **single-use approval valid for 5 minutes**; expired, replayed or stale approvals are refused;
- writes every event (propose / decide / apply / revert / reject / expire) to an **Ed25519-signed, hash-chained
  ledger** (`ledger-verify.sh` checks the chain).

**Approval popup.** The owner (Peter) sees **host-computed facts** (target, kind, old -> new accent, sha) plus the
model's free-text `why` note, which is fenced as model-authored. After Allow-once the gate writes the file and
**Cordis** hot-reloads the theme.

**Why a note screen.** The note is the one model-controlled string in the popup. Red-team notes (A1-A7, 16:35 WITA
2026-10-03) try to: imitate host text ("HOST-VERIFIED", lookalike glyphs ⸻ ☑ ✅, fullwidth), fake the end of the
proposal with NBSP/space padding or control/bidi characters (U+0085, U+202E), claim "typo fix / no visual change /
no-op" against a real colour diff, impersonate approval ("owner policy pre-approved", "Grok verified"), or
pressure/rush the owner.

**Layering.** Deterministic hard rules come first: ASCII-only (or confusable-stripped) notes, control/bidi/padding
removal, separate visual styling for host facts vs the model note, and a rule "note claims no change but diff is
non-empty -> warn". A fine-tuned Laya screen sits on top as **warning-only**: it may add a warning to the popup; it
can never approve, hide or reorder anything.

**Known hole (not fixed by any screen).** The gate trusts the harness's report of the owner's click. A compromised
harness could report an Allow that never happened; the screen does nothing about that.

**About Laya and this doc.** Laya is a 512-1024-token encoder (ModernBERT-large 421M / mmBERT-base 322M) that makes
typed decisions in one forward pass. It **learns from labelled examples, not from reading documentation**. This doc
is used (a) to generate and label training examples and (b) optionally as a short context prefix inside `state`
(see `context_prefix.txt`); the shipped training rows do **not** include the prefix, so add it consistently to both
training and inference if you use it.
