# COURT-CONTRACT — what a consistency verdict is, and is not

**Pinned by digest, not by path.** This file is intended to be pinned by its SHA-256 and cited by
that digest. Any edit — a comma, a reflow — produces a different file and therefore a different
pin; there is no "latest version" of a contract, only the text whose digest you checked. A tool
that wants to speak about Aura consistency should pin *this file* and follow it, rather than
reimplementing chain rules of its own invention.

The court this contract describes — the pinned vendored implementation of the three verdicts
below — is pinned here by digest so a reader can tell whether the rules they are holding match the
code that produced their verdict:

```
vendor/append-only/verify.py
sha256 039aa8999f9a1e1a8b8e01eb51598bfc546e4e574b2c9333f13e8bb303958089
```

This file's own digest cannot appear inside itself. Record it where you pin it (§7), and treat a
mismatch as unknown text rather than as a newer version of the same rules.

**Revised 2026-09-26.** §2 (the same-size branch, the `UNDETERMINED` row and the exit-status note) and
§4 (which sizes are safe) were corrected against `verify.py`. The text before this revision had sha256
`342a9ac705abd5cb…`; a pin of that digest pins the uncorrected rules. No file in this repository pins
either digest.

## 1. The two documents, and the one question

A **retained observation** is a document of this shape, describing one prefix of one stream:

```json
{
  "schema": "aukora-head-log-v1",
  "domain": "aukora:aura-checkpoint:v1",
  "chainKey": "aukora-aura-log-v1:<64 hex>",
  "epoch": 0,
  "leafConvention": "aukora-receipt-line-sha256-v1",
  "treeSize": 13,
  "root": "<64 hex>",
  "atGeneration": 1,
  "firstUnverifiedLine": null
}
```

A **presented observation** is the same document for a later size, plus `proofFromPrevious` — the
digests that connect the two — and `retainedTreeSize`, naming the size it claims to extend.

The single question the court answers is:

> does the presented document's prefix of length `retained.treeSize` derive the retained root?

Everything below is about that question and nothing else.

## 2. The three verdicts

The court prints exactly one of these, with a `REASON :` line naming the branch that produced it.

| verdict | what it means |
| --- | --- |
| `APPEND_ONLY` | **The proof connects to the presented head and derives the retained root.** The presented log is an extension of the retained prefix: everything the retained observation covered is still covered, unchanged, at the size the presented document names. |
| `OBSERVATION_CONFLICT` | **The proof connects to the presented head but derives a DIFFERENT root.** Two documents claim the same stream at the same prefix and do not agree. This is the verdict that says a rewrite happened — for a retained size that is not a power of two. At **equal** sizes (no growth) a differing root is `OBSERVATION_CONFLICT` (`same_size_root_mismatch`) at any retained size, including a power of two (`verify.py:32-35`; driven at size 13 by `scripts/phase0/selfcheck.py` arm 14). |
| `UNDETERMINED` | **The proof does not connect, the documents are malformed, or, at a power-of-two retained size, the fold does not reach the presented head or the retained root** (see §4), where a non-2^k size would have been `OBSERVATION_CONFLICT`. An honest pair at a power-of-two size is `APPEND_ONLY`. The court could not establish the relationship. This is *not* "nothing is wrong"; it is "this pair does not answer the question". |

Two details that matter to anyone reading the output:

- **The verdict is in the text, not in the exit status.** Every printed verdict exits `0`,
  including `OBSERVATION_CONFLICT` and an `UNDETERMINED` for a document that fails JSON admission.
  Exit `1` means an input could not be opened or decoded (or, by reading the code, parsed to a
  non-object and crashed); exit `2` is a usage error. Read the `VERDICT:` line; never infer the verdict from a status code.
- **Sizes are ordered and non-zero.** A retained size of `0`, a size pair where retained exceeds
  presented, a non-digest root, or a proof element that is not a digest are all `UNDETERMINED`
  with the reason naming which — a malformed pair is never reported as agreement.

## 3. What a retained observation proves, and does not prove

A retained observation, together with the presented document it is checked against, and the
verdict above, establishes **one** thing:

> these two documents describe one stream, and the prefix the retained observation covers is
> present, unchanged, in what the presented document describes.

It is evidence about **two documents**, and it does not establish any of the following:

- **Not truth.** It says nothing about whether any record is true, whether a transition happened,
  whether a plugin did anything, or whether a receipt was issued for it.
- **Not authorization.** A verdict is not a grant, a nonce, a key, a capability or a permission.
  It authorizes no effect, and no part of this system may treat it as one (§6).
- **Not latestness.** The presented head is that stream's head *as of that read*. Another log may
  exist, an earlier observation may be held elsewhere, and the court cannot see either.
- **Not completeness of a stream.** A truncation with no earlier retained observation is
  undetectable by this pair; the court compares what it was given.
- **Not custody.** Where the retained bytes were kept decides what the verdict is worth: a copy
  this host can rewrite shows the host did not rewrite it *this time*. Retained copies that a
  reader reaches through `scripts/phase0/verify --retainer` carry the label
  **`RETAINER_SAME_OWNER`** for exactly that reason — the same principal is not an independent
  one, and a second key under one uid is not a second party.
- **Not a second tree.** The composition's own roots use a *different* leaf convention
  (`rfc6962-leaf-sha256-0x00-prefixed-v1`) over the same log. The court consumes
  `aukora-receipt-line-sha256-v1`. Comparing one convention's root with the other means nothing,
  in either direction, and no verdict here says anything about the other tree.

## 4. The 2^k limit — `UNDETERMINED` at a power-of-two retained size

When the retained size `m` is a power of two (`1, 2, 4, 8, …`) the proof fold uses the **retained
root itself as its seed**, so a prefix rewritten consistently with that seed derives that same
root and the court cannot separate "nothing changed" from "the prefix was rewritten to say
something else while keeping the fold's seed". Concretely:

- If the fold **connects**, the verdict is `APPEND_ONLY` (`valid_append_only_extension`) — and at
  a power-of-two retained size that `APPEND_ONLY` is **not complete verification of the prefix**:
  the court assumed the retained root instead of independently deriving it.
- If the fold **does not connect**, the verdict is `UNDETERMINED` with the reason
  `POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE` — not `OBSERVATION_CONFLICT`, because at this
  size the court cannot tell a damaged proof from a rewritten prefix.

Measured, on a six-entry stream, retained at size 4 (2²) and presented at size 6:

| pair | verdict | reason |
| --- | --- | --- |
| honest | `APPEND_ONLY` | `valid_append_only_extension` |
| retained root flipped | `UNDETERMINED` | `POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE` |
| retained root flipped, retained at size **3** | `OBSERVATION_CONFLICT` | `consistency:prefix-mismatch` |

All three exits were `0` — which is the point of §2: read the verdict, not the status.

The consequences, stated plainly:

- **Retain at a size that is not a power of two when the point of the exercise is to detect a
  rewritten prefix.** 13, or any size that is not a power of two (one with an odd factor greater than
  1), is safe; 16 is not.
- **`UNDETERMINED` at a power of two must never be read as `APPEND_ONLY`**, and equally must never
  be read as an accusation. It is the honest "this pair cannot tell".
- A rewritten prefix at a **non-power-of-two** retained size is the case that earns
  `OBSERVATION_CONFLICT` — that verdict is the one that catches this class of failure.

## 5. Repeating it yourself

The court is vendored and consumes the two documents directly:

```
python3 vendor/append-only/verify.py <retained.json> <presented.json>
```

Through a retainer (the retained bytes come from the retainer and nowhere else — there is no
fallback to a local copy, because a silent fallback would make the custody claim false while
still printing a verdict):

```
python3 scripts/phase0/verify --retainer <dir-or-git-url> <presented.json> --chain-key <chainKey>
```

The retained size is the one the **presented** document says it extends (`retainedTreeSize`), not
"the latest the retainer holds". Asking a retainer for a size nobody claimed is asking a different
question and getting a well-formed answer to it.

## 6. A consistency verdict never authorizes anything

This is the part to quote when something wants to treat a verdict as permission:

- A verdict is **evidence about two documents**. It is not a grant, not a receipt, not a nonce,
  not a capability, not consent, and not an approval. No signature over it, no key that produced
  it, and no number of repetitions of it confer authority.
- An `APPEND_ONLY` does not authorize a write, a publish, a merge, a deployment, a payment, or the
  acceptance of any record. It says only that a prefix survived.
- An `OBSERVATION_CONFLICT` does not authorize a repair, a rewrite, a rollback or a deletion. It
  reports a disagreement between documents; what to do about it is a decision for the people who
  own the stream, made outside this court.
- `UNDETERMINED` authorizes nothing and forbids nothing. It is the absence of an answer, and the
  correct response is to find a pair that answers — not to treat silence as consent.
- `CONSISTENCY_UNCHECKED` (printed when there is no pair to check, or when a retainer cannot be
  reached) is likewise not a verdict, and a system that needs a verdict must record that it does
  not have one rather than proceed as if it did.

## 7. How to pin this file

1. Read this file at a known revision.
2. Compute its SHA-256 over the exact bytes (`shasum -a 256 scripts/aura/COURT-CONTRACT.md`).
3. Record the digest next to whatever uses it, and check it before trusting the text.
4. If the digest does not match, you have a different contract than the one you pinned — treat it
   as unknown text and do not fall back to "probably the same rules".

A pin is a statement about a specific text. This file is written to be worth pinning: it names the
exact verdict vocabulary, the exact limit, and the exact non-claims, so that a third party can
follow it instead of inventing chain rules of its own.
