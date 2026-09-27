# AUMLOK v3 — the themed buckets: provenance, counts, and what the entropy actually is

> **Superseded by item X2 (2026-09-23); historical below (banner added 2026-09-26).** Every number below
> was measured from the `aumlok-themes.json` of its day. The shipped file is now the X2 rebuild: every word
> drawn from the EFF large wordlist with `wordfreq` 3.1.1 zipf as a filter, totals NATURE 683, PEOPLE 1,198,
> SPIRIT 677, **18 usable letters** (`abcdefghlmoprstuvw`) at a minimum bucket of 12, **150** anchors, and a
> measured **34.14 bits** (weakest anchor 26.91 bits; ceiling 36.31) that gates nothing — the entropy floor
> was retired (`aumlok:entropy-below-floor-retired`). See the file's own `provenance` block and
> [COMMON-WORDS-PROVENANCE.md](COMMON-WORDS-PROVENANCE.md). The court this page cites was rewritten by X2.

Generated from the shipped arrays of its day by the same module the generator uses
(`plugins/aukora-aumlok/lib/themed-entropy.mjs`); every number below was measured from
`plugins/aukora-aumlok/data/aumlok-themes.json` as it then stood, not transcribed from a summary.

## 1. What this file is for

Plan §1: seven words, word 0 the six-letter ANCHOR, words 1-2 NATURE (band ROOT, of the earth),
words 3-4 PEOPLE (band UNITE, of each other), words 5-6 SPIRIT (band RISE, of what lifts), each
beginning with the anchor's next letter. This file records where those three buckets come from and
what they are worth.

## 2. Sources

- **Reference dictionary** — `/usr/share/dict/words` (Apple's `web2`, 2493885 bytes, symlink to
  `web2`, 235,976 lines, 210,773 lowercase alphabetic entries, 25,203 of them capitalised and
  therefore unusable: `Christ` is a capitalised-only entry and cannot be shipped. *(Corrected: `sabbath`,
  `sutra` and `torah` also exist in lowercase in web2, so they were wrong examples.)*
  Every shipped word is in it, checked with `grep -x` over the shipped set by the court (one `grep -x`
  per word — BSD grep's `-F -f` is superlinear in the pattern count and did not finish 7,801 patterns
  in 120 s) and by an exact lowercase lookup at assembly time. *(Superseded: X2 draws every word from the
  EFF large wordlist, filters by zipf, and no court checks web2 membership.)*
- **No frequency list was used.** The plan allows one; none was needed and none is claimed. The
  frequency cross-check belongs to the anchor list, which another lane owns.
- **Candidate harvest** — 18 harvest groups (3 themes × 6 letter groups), each producing words whose
  primary or well-established sense belongs to its theme, then filtered mechanically. The harvest
  files are scratch (`.scratch/aumlok-themes/raw/*.json`) and are **not** shipped; the shipped file is
  the filtered, deduplicated union.

## 3. Method

1. Harvest candidate words per theme per letter, base forms preferred (web2 carries almost no
   regular plurals), no proper nouns, 4-9 letters.
2. Filter each word: `/^[a-z]{4,9}$/` **and** present in `/usr/share/dict/words` as an exact
   lowercase entry. Words that failed were dropped, never edited into something that passes:
   0 failed the shape, 0 were absent from the dictionary, 0 needed normalising.
3. Deduplicate inside a theme, then make each word **unique across the three themes**.
   282 words were claimed by two or three themes (23 settled by the donor row, 40 by a reviewed
   primary sense, 219 by the fixed order). A word claimed by one theme keeps that claim. A collision is settled by, in
   order: the **donor row** that names the word (phi's ported tables in `lib/ceremony-phrase.mjs` are
   this project's own precedent for which band a word belongs to), then a **reviewed primary sense**
   for the words the donor does not name, then NATURE > PEOPLE > SPIRIT. *(Historical, pre-X2: X2
   allocates fallbacks across bands, so a borrowed word can appear in two; see the file's
   `provenance.fallbacks`.)* No word was invented and no
   bucket was padded: harvest workers were told that a short honest bucket is the correct answer, and
   they dropped in-dictionary words that did not belong (see §6).

## 4. Counts per theme per letter (historical, pre-X2)

| letter | NATURE | PEOPLE | SPIRIT | min | anchor letter? |
|---|---:|---:|---:|---:|---|
| a |  197 |  179 |   42 |   42 | EXCLUDED |
| b |  150 |  148 |   52 |   52 | EXCLUDED |
| c |  210 |  255 |   45 |   45 | EXCLUDED |
| d |  176 |  164 |   20 |   20 | EXCLUDED |
| e |   97 |   82 |   24 |   24 | EXCLUDED |
| f |  172 |   64 |   12 |   12 | EXCLUDED |
| g |  229 |   71 |   15 |   15 | EXCLUDED |
| h |  150 |   84 |   22 |   22 | EXCLUDED |
| i |   74 |  131 |   47 |   47 | EXCLUDED |
| j |   42 |   64 |   20 |   20 | EXCLUDED |
| k |   68 |   52 |   16 |   16 | EXCLUDED |
| l |  137 |  122 |   63 |   63 | EXCLUDED |
| m |  232 |  303 |   20 |   20 | EXCLUDED |
| n |   83 |   92 |   10 |   10 | EXCLUDED |
| o |   86 |  203 |    9 |    9 | EXCLUDED |
| p |  332 |  304 |   29 |   29 | EXCLUDED |
| q |   15 |   27 |   15 |   15 | EXCLUDED |
| r |  158 |  169 |   70 |   70 | EXCLUDED |
| s |  543 |  245 |   98 |   98 | EXCLUDED |
| t |  498 |  161 |   68 |   68 | EXCLUDED |
| u |   19 |   51 |   34 |   19 | EXCLUDED |
| v |   64 |   45 |   14 |   14 | EXCLUDED |
| w |  125 |   76 |   20 |   20 | EXCLUDED |
| x |    4 |    6 |    0 |    0 | EXCLUDED |
| y |   16 |   21 |    4 |    4 | EXCLUDED |
| z |   22 |    9 |    3 |    3 | EXCLUDED |
| **total** | **3899** | **3128** | **772** | | |

## 5. The usable-letter set under the plan's rule: **NONE** (historical: under the retired ≥100 rule no letter qualified; X2 uses a 12-word minimum and 18 usable letters)

The rule (plan §1, rounds V2): a letter is usable as an anchor letter only if it has at least
100 words in **each** of the three themes; letters that cannot reach 100 are excluded from anchors.
Measured: **no letter reaches 100 in all three themes.** The closest are:

- `s` — smallest bucket 98 (NATURE 543, PEOPLE 245, SPIRIT 98)
- `r` — smallest bucket 70 (NATURE 158, PEOPLE 169, SPIRIT 70)
- `t` — smallest bucket 68 (NATURE 498, PEOPLE 161, SPIRIT 68)
- `l` — smallest bucket 63 (NATURE 137, PEOPLE 122, SPIRIT 63)
- `b` — smallest bucket 52 (NATURE 150, PEOPLE 148, SPIRIT 52)
- `i` — smallest bucket 47 (NATURE 74, PEOPLE 131, SPIRIT 47)
- `c` — smallest bucket 45 (NATURE 210, PEOPLE 255, SPIRIT 45)
- `a` — smallest bucket 42 (NATURE 197, PEOPLE 179, SPIRIT 42)

SPIRIT is the limiting theme: 772 words in total against 3899 NATURE and 3128 PEOPLE, and its single
best letter (`s`, 98) still misses the threshold. **All 26 letters are therefore EXCLUDED from
anchors**, which the court asserts rather than tolerates. Consequence: there is no usable anchor, so
the generator cannot draw a phrase at all under the plan's rule.

## 6. The entropy arithmetic, and the measured figure

```
bits = log2(A) + MIN over anchors w in A of  SUM  log2( s(theme(i), w[i]) )
                                          i=0..5
```

`A` is the usable anchor pool (six-letter words all of whose letters are anchor letters, each of which
has a non-empty bucket at every position); `s(t, l)` is the shipped bucket size; the MIN is the
**guaranteed** figure for the weakest anchor the generator can emit — Symbiote's estimator
(`~/aukora-symbiote/authority/aumlok/ceremony.ts:72-77`), not an average.

- **Before this work**: the donor tables in `lib/ceremony-phrase.mjs` measured by this same formula —
  **14.34 bits** = log2(18 anchors) 4.170 + 10.170 from the weakest anchor `frosty`, smallest bucket
  used 2. That is the "~14.3" the old file states.
- **Under the plan's rule (>= 100)**: **0.00 bits** — no letter is usable, no anchor exists, so nothing
  can be drawn. The module refused by name: `aumlok:entropy-below-floor`. *(The floor is now retired: the
  refusal constant is `aumlok:entropy-below-floor-retired`, and the module measures 34.14 bits — weakest
  anchor 26.91, ceiling 36.31 — and gates nothing.)*
- **The honest ceiling** (historical, pre-X2 buckets): **45.90 bits**, measured at a per-letter gate of 24 words over letters
  `abceilprst` (244 drawable anchors, smallest bucket used 24, weakest anchor
  `billet`). This is the best these buckets carry at **any** gate. It is 14.10 bits below the 60-bit floor.
- **The shipped anchor list** then held 4043 words (11.98 bits) using letters `abcdefghijklmnopqrstuvwyz`.
  *(It now holds 150 six-letter words over the 18 usable letters.)*
  For the floor to hold with that list, the smallest bucket used must be **257 words** in every theme for
  every anchor letter; at the honest ceiling's anchor count it is **410 words**, and with web2's whole
  six-letter list (15,073 words) it is still **207 words**.

## 7. The finding, plainly (historical: X2 retired the floor rather than meeting it; the measured figure, 34.14 bits, is printed and compared to nothing)

**The plan's 60-bit floor is not reachable with three disjoint themed buckets of real English words
at 4-9 letters, and the plan's own "hundreds per letter per theme" is off by an order of magnitude
for SPIRIT.** The floor requires a *minimum* bucket of roughly 250 words in **every** theme for
**every** anchor letter (257 with the shipped anchor list, 410 at the anchor count these letters actually
support) — of the order of 15,000-20,000 themed words if the letters were kept. The honest harvest
produced 772 SPIRIT words in total, with a best letter of 98.

The gap is not diligence. Every harvest group read its whole dictionary slice; the binding
constraints are the language itself (SPIRIT/`x` has no words at all at 4-9 letters; SPIRIT/`q` has
15), web2's absence of regular plurals and of many headwords, the capitalised-only rule
(`Christ` is in web2 only capitalised and so is excluded), and the 4-9 letter cap
that removes `contemplation`, `inspiration`, `benediction`, `forgiveness`. The three options belong
to the plan's owner, not to this court: accept a lower floor (the honest ceiling is 45.90 bits), or
change the phrase's shape so the six themed words are not letter-constrained by the anchor (the
anchor's letters are what force a small usable set), or add words per position. **This court does not
lower the floor and does not pad the buckets to reach it.**

## 8. What was not verified

- Semantic membership is a judgement, not a proof: a word is in a bucket because a harvest worker
  judged its primary sense to belong to that theme, and a reviewer kept it. The dictionary check, the
  shape check, the uniqueness check and the counts are mechanical; `mercy` being SPIRIT rather than
  PEOPLE is not.
- The anchor list (`data/aumlok-anchors.json`, then 4043 words, now 150) is another lane's. Every letter it
then used was excluded by the rule above, so the court of that day asserted that all 4043 anchors were
unusable; when its letter set changes,
the anchor term here changes with it and the figure must be re-measured.
- The entropy figure is a **min-entropy against a generator that draws uniformly**. It says nothing
  about a person who composes a phrase by hand; plan §1 forbids composed phrases, and the module's
  refusal is about the generator.
