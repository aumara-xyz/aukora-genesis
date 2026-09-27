# AUMLOK v3 anchor list — history of the superseded 4045-anchor cut

> **This document describes a cut that no longer ships (corrected 2026-09-26).** The shipped
> `plugins/aukora-aumlok/data/aumlok-anchors.json` holds **150** anchors (`_provenance.count` 150, rebuilt
> 2026-09-23) over an 18-letter drawable set, `abcdefghlmoprstuvw`; `i j k n q x y z` are absent. It was
> written by `scripts/aumlok/harvest-common-words.py` (the X2 harvest, `80772f29e`) from an EFF +
> `wordfreq` pool, not from the dictionary-and-three-corpora pipeline below. Its rules, as its own
> `_provenance` records them: six lowercase letters; every letter in the drawable set; every letter has a
> bucket of at least 12 words (`MIN_WORDS_PER_BUCKET`) in all three bands, with `MIN_ANCHOR_POOL` 128; every
> anchor a real dictionary word. Curated judgement lists also removed words — `data/safety/pleasant-drop.json`
> and `data/safety/proper-names.json` (places and surnames dropped by name) — together with a zipf ≥ 3.5
> bar; those lists are judgement, not measurement. **No command at this commit regenerates the shipped
> file byte-for-byte**: the harvest script at HEAD is the held X8 rebuild (see
> [COMMON-WORDS-PROVENANCE.md](COMMON-WORDS-PROVENANCE.md)). The rule that uses the anchors lives in
> `plugins/aukora-aumlok/lib/themed-entropy.mjs`.
>
> Current first-letter distribution (measured 2026-09-26, 150 anchors): a 11, b 10, c 16, d 6, e 5, f 5,
> g 3, h 7, l 7, m 5, o 3, p 14, r 13, s 27, t 7, u 7, v 3, w 1.
>
> Everything below is the record of the earlier 4045-anchor cut, kept as history.

**File (as it was):** `plugins/aukora-aumlok/data/aumlok-anchors.json` · **count: 4045** · generated 2026-09-23T02:18:21Z

The anchor is word zero of the seven-word phrase. Its six letters are the first letters of words
1–6 (the acrostic), so this list is the anchor space, and the letters *inside* every anchor are
the letters the themed buckets must cover.

## Sources (exact, with digests)

| source | what it is | sha256 |
|---|---|---|
| `/usr/share/dict/words` | macOS reference dictionary — a symlink to `web2` (Webster's Second International, 1934), 235976 lines, 15073 of them exactly six lowercase letters | `be41ad97963bf8dabedd5871d5d691596175269d540956b0f9965a885c2bbab9` |
| EFF large wordlist, recovered from **this repo's git history** | blob `43f88a929ca6835602d6d090bbb8828ceddffe90`; identical at `scripts/aumlok/eff_large_wordlist.txt` (@ `efd97b44`) and `plugins/aukora-aumlok/lib/eff_large_wordlist.txt` (@ `c462ee55`); deleted from HEAD at `3a557434`. 7776 curated common words | `addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e` |
| `https://www.norvig.com/ngrams/count_1w.txt` | Google Web Trillion Word Corpus, rank-ordered, 333333 entries | `51df159fd3de12b20e403c108f526e96dbd723d9cabdd5f17955cdc16059e690` |
| `https://raw.githubusercontent.com/IlyaSemenov/wikipedia-word-frequency/master/results/enwiki-2023-04-13.txt` | English Wikipedia word frequency, rank-ordered, 2765377 entries | `e2071140a49a6c40c732bd68c36836ef13c0978233fb3d5e1b2a3c2d34faef59` |
| `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt` | OpenSubtitles 2018 word frequency, rank-ordered, 50000 entries | `5351ff405b1126ef555791dd4d9798a48e3e9a501a9fc481a9da957752cfb458` |

The EFF list is **not** in the working tree — it was removed at `3a557434`. It was recovered with
`git cat-file -p 43f88a929ca6835602d6d090bbb8828ceddffe90`, and its sha256 is byte-for-byte the digest
the repository itself used to pin (`addd3553…b903e`), which is what makes it a verified source
rather than a plausible one.

## Rules, as applied

1. **Wordhood gate.** Keep only lines of `/usr/share/dict/words` matching `^[a-z]{6}$` **exactly** —
   six letters, lowercase, nothing else. 15073 words pass.
   - Rejected here: 2396 six-letter words the dictionary holds **only** capitalised
     (proper nouns and capitalised-only spellings; 244 further capitalised entries also have a
     genuine lowercase entry and are unaffected), and 0 six-letter entries that are not
     purely alphabetic (hyphens, apostrophes, accents).
   - This gate is the whole of the proper-noun rule: the dictionary capitalises proper nouns, so a
     case-sensitive lowercase match cannot return one. No curated stop-list was needed.
2. **Commonness.** Keep a word if it is in the EFF large wordlist **or** in the top 50000 by rank of
   at least one of the three frequency corpora. 4116 words pass.
   - The corpora disagree by design (web crawl vs encyclopaedia vs subtitles), so the rule is
     *attested by at least one*: the instruction was to cross-check with a frequency signal, and a
     word that is frequent in any one large corpus is a common English word. Frequency at the
     rank-50000 boundary: googleWeb=333226, wikipedia=1462, openSubtitles=159 occurrences.
   - 2840 of the words are not in EFF at all: they enter on corpus frequency alone.
3. **Thin-letter exclusion.** The acrostic needs, for **every** letter of a usable anchor, at least 100
   words in **each** of the three themes, unique across themes — 300 distinct dictionary
   words starting with that letter. Measured capacity (distinct 4–9 letter lowercase dictionary words):
   **x = 134** — below the floor, so x
   is excluded and **71 anchors containing x were removed**. Every remaining anchor is
   spelled only in letters the buckets can cover. *(The shipped set now uses an 18-letter drawable set;
   see the banner.)*

## Counts

- Six-letter lowercase dictionary words (base): **15073**
- Attested by at least one commonness signal: **4116**
- Removed by the thin-letter filter: **71**
- **Shipped anchors: 4045**
- Anchors found in `/usr/share/dict/words` by exact line: **4045 of 4045** (must be all)
- Distinct letters appearing anywhere across all anchors: **25** — `abcdefghijklmnopqrstuvwyz`
- Distinct first letters: **25** (all of `abcdefghijklmnopqrstuvwyz`; `x` is excluded by measurement)

### First-letter distribution (the superseded 4045 cut; the current one is in the banner)

| letter | anchors |
|---|---|
| a | 207 |
| b | 312 |
| c | 355 |
| d | 216 |
| e | 99 |
| f | 186 |
| g | 161 |
| h | 159 |
| i | 81 |
| j | 39 |
| k | 45 |
| l | 159 |
| m | 246 |
| n | 73 |
| o | 64 |
| p | 292 |
| q | 17 |
| r | 284 |
| s | 512 |
| t | 231 |
| u | 99 |
| v | 63 |
| w | 128 |
| y | 7 |
| z | 10 |

### Per-letter capacity in the reference dictionary (4–9 letter words)

| letter | capacity | verdict |
|---|---|---|
| a | 6915 | usable |
| b | 6514 | usable |
| c | 8387 | usable |
| d | 4956 | usable |
| e | 3607 | usable |
| f | 4108 | usable |
| g | 3666 | usable |
| h | 3492 | usable |
| i | 2498 | usable |
| j | 908 | usable |
| k | 1306 | usable |
| l | 3234 | usable |
| m | 5188 | usable |
| n | 2223 | usable |
| o | 3434 | usable |
| p | 8401 | usable |
| q | 527 | usable |
| r | 5153 | usable |
| s | 11896 | usable |
| t | 6140 | usable |
| u | 5827 | usable |
| v | 1754 | usable |
| w | 2653 | usable |
| x | 134 | EXCLUDED |
| y | 409 | usable |
| z | 458 | usable |

Letters under 1000 (the tight ones for the themed buckets): `j`=908, `q`=527, `x`=134, `y`=409, `z`=458.
A letter is only *excluded* when it cannot reach 300; anything at or above that is left in and the
themed court decides whether its buckets actually reach 100 per theme. **If that court excludes further
letters, this list must be re-filtered with them** — the generator takes its floor as the minimum over all
anchors, so a single anchor containing a letter with no pools collapses `generatorMinEntropy()` for every
phrase. *That re-filter was applied (from `96ec17759` on); the live rule is in
`plugins/aukora-aumlok/lib/themed-entropy.mjs`, and the file is written by
`scripts/aumlok/harvest-common-words.py`. The count in `themed-entropy.mjs`'s own comment (4,043 → 906) is
itself stale.*

### What a further letter exclusion would cost

Anchors lost if that letter is excluded too (measured on this list):

| letter | dictionary capacity | anchors containing it | anchors starting with it |
|---|---|---|---|
| a | 6915 | 1758 | 207 |
| b | 6514 | 528 | 312 |
| c | 8387 | 858 | 355 |
| d | 4956 | 923 | 216 |
| e | 3607 | 2539 | 99 |
| f | 4108 | 326 | 186 |
| g | 3666 | 625 | 161 |
| h | 3492 | 617 | 159 |
| i | 2498 | 1438 | 81 |
| j | 908 | 53 | 39 |
| k | 1306 | 320 | 45 |
| l | 3234 | 1300 | 159 |
| m | 5188 | 679 | 246 |
| n | 2223 | 1356 | 73 |
| o | 3434 | 1212 | 64 |
| p | 8401 | 641 | 292 |
| q | 527 | 52 | 17 |
| r | 5153 | 1893 | 284 |
| s | 11896 | 1181 | 512 |
| t | 6140 | 1316 | 231 |
| u | 5827 | 883 | 99 |
| v | 1754 | 244 | 63 |
| w | 2653 | 290 | 128 |
| x | 134 | 0 | 0 |
| y | 409 | 617 | 7 |
| z | 458 | 68 | 10 |

The decision that actually matters is `y` (capacity 409, 7 anchors start with it) and `z` (458, 10) and
`q` (527, 17): each needs 100 NATURE + 100 PEOPLE + 100 SPIRIT words starting with it, from a total
dictionary supply of a few hundred 4–9 letter words. `x` is already gone. If the themed court drops any
of them, re-run the same build with the extra letter added to the exclusion and the list stays coherent.

### Robust core, for a reviewer who wants a tighter list

3191 of the 4116 attested words are attested by **two or more**
independent signals (the union rule needs only one). That is the tighter cut if the union is judged too
wide; it is not the shipped rule, and the shipped rule is the one recorded above.

## Commands used

```sh
# the digest-verified EFF recovery (it is not in the tree)
git cat-file -p 43f88a929ca6835602d6d090bbb8828ceddffe90 > eff_large_wordlist.txt
shasum -a 256 eff_large_wordlist.txt   # addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e

# base set
LC_ALL=C grep -xE '[a-z]{6}' /usr/share/dict/words | sort -u | wc -l          # 15073

# per-letter capacity
for L in a b c d e f g h i j k l m n o p q r s t u v w x y z; do
  printf '%s ' "$L"; LC_ALL=C grep -xE "[$L][a-z]{3,8}" /usr/share/dict/words | sort -u | wc -l
done

# the shipped file's own numbers (at this commit these print 150 and the banner's distribution, not the 4045 cut)
node -e 'const j=require("./plugins/aukora-aumlok/data/aumlok-anchors.json");console.log(j.anchors.length)'
node -e 'const j=require("./plugins/aukora-aumlok/data/aumlok-anchors.json");console.log(j.anchors.join("\n"))' > /tmp/a.txt
LC_ALL=C sort -u /tmp/a.txt > /tmp/a.s
LC_ALL=C grep -xE '[a-z]{6}' /usr/share/dict/words | LC_ALL=C sort -u > /tmp/d.s
comm -23 /tmp/a.s /tmp/d.s | wc -l        # 0 — every shipped anchor is an exact dictionary line
node -e 'const j=require("./plugins/aukora-aumlok/data/aumlok-anchors.json");const c={};for(const w of j.anchors)c[w[0]]=(c[w[0]]||0)+1;console.log(JSON.stringify(c))'
```

## Judgement calls

- **A previous cut of this file was wrong and this one replaces it.** Commit `332493b1` shipped 17469
  anchors built by lower-casing capitalised dictionary entries; 2396 of them
  (`abaris`, `zyrian`, `ababua`, `abanic`, …) are proper nouns or words that are only meaningful
  capitalised. They are all gone. This list is a strict subset of the dictionary's lowercase six-letter
  words and is **4045**, not 15073.
- **Over-inclusive by choice, with the reason recorded (the 4045 cut only; reversed since).** None of the
  words named below is in the shipped list: proper names and places are now dropped by curated lists
  (`data/safety/proper-names.json`). A word whose lowercase dictionary entry is real
  but whose *frequent* sense is a proper noun is kept, because the dictionary — not the frequency list —
  decides wordhood: `turkey`, `jordan`, `boston`, `canada`, `russia`, `apache`, `german`, `easter`,
  `manila`, `jersey`, `scotch`, `polish`, `mosaic`, `sierra`, `utopia`, `spring`, `school`, `modern`.
  Each has a genuine lowercase sense in web2 (the bird, the vessel, the waltz, the leather, the fabric,
  the verb, the substance). Dropping them would need a curated stop-list of "words that feel like names",
  which is exactly the kind of unmeasured filter this file is supposed to avoid. If the reviewer wants
  them out, the rule is: drop words that also occur capitalised in the dictionary (150 of the 4116 attested words), at the cost of the ordinary words in that set.
- **The frequency threshold is a rank, not a rate.** Rank 50000 was applied identically to all three
  corpora. A rate threshold would be more principled per corpus but needs each corpus's token total, and
  two of the three files publish only rank-ordered counts, not totals. The boundary counts are recorded
  above so the cut can be moved and the list rebuilt deterministically.
- **No compose path, no hand edits (the 4045 cut).** Nothing in that cut was typed by hand. This is not
  true of the shipped 150: they came through the EFF + `wordfreq` pool, the curated pleasant-drop and
  proper-name lists (judgement, not measurement), the zipf bar, and the drawable-letter and bucket rules
  described in the banner.
