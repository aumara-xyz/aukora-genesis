# PEOPLE — the themed bucket, and how it was built

Companion to `theme-people.json`. This file records the definition, the method, the per-letter
counts, the dictionary check and every judgement call, so that a later lane can audit the bucket
without re-deriving it.

> **Status (added 2026-09-26): `theme-people.json` is read by no code.** The shipped PEOPLE band is
> `data/aumlok-themes.json` (1,198 words, the X2 EFF rebuild). This bucket is not adopted, but it is still
> copied into every release (the materializer copies the plugin's `data/` directory). A read-only count
> finds words from the vendored LDNOOBW list and from this repository's own `safety/profanity-block.json`
> in it; do not treat it as a current or vetted list. Corrections below are marked in place.

## 1. The definition

Given by the plan's owner, in his own words:

> **anything human — roles, relations, feelings, crafts, body, acts.**

And the test that follows from it: *a word belongs if a person would hear it as something human.*
The bucket is a mnemonic FLAVOUR, not a taxonomy, and the definition is deliberately generous —
it was applied generously, and the boundary is stated in §6 so that the generosity is visible
rather than hidden.

## 2. What was shipped

* **Total: 19,157 words** over the 26 letters, one word per entry, all lowercase, 4 to 9 letters.
* **22 of 26 letters reached the 400-word target**: a b c d e f g h i j k l m n o p r s t u v w.
* **4 letters did not**: q 253, x 46, y 155, z 124. §5 gives the arithmetic reason.
* Shape: top level is the per-letter mapping `a` … `z` (each a sorted array of words) plus one
  `_provenance` key. The `_provenance` key is the only non-letter key, so a merger can walk the
  letters and skip keys that start with an underscore.

| letter | words | >= 400 | | letter | words | >= 400 |
|--------|------:|:------:|-|--------|------:|:------:|
| a | 1257 | yes | | n | 400 | yes |
| b | 1200 | yes | | o | 564 | yes |
| c | 1790 | yes | | p | 1496 | yes |
| d | 1054 | yes | | q | **253** | **no** |
| e | 717 | yes | | r | 906 | yes |
| f | 799 | yes | | s | 2016 | yes |
| g | 655 | yes | | t | 841 | yes |
| h | 645 | yes | | u | 400 | yes |
| i | 490 | yes | | v | 400 | yes |
| j | 400 | yes | | w | 433 | yes |
| k | 409 | yes | | x | **46** | **no** |
| l | 608 | yes | | y | **155** | **no** |
| m | 1099 | yes | | z | **124** | **no** |

## 3. The method

Candidates were never typed by hand at scale and never invented. Every shipped word was produced
by a script run over two corpora, and then filtered four ways.

**Sources**

1. `/usr/share/dict/words` (Apple's web2 dictionary) — the reference dictionary. The candidate
   universe was built FROM it: every lowercase 4–9 letter line, 103,788 words.
2. **WordNet 3.0** (Princeton) — the primary classification signal. A word whose leading sense lies
   in `noun.person`, `noun.body`, `noun.act`, `noun.feeling`, `noun.cognition`,
   `noun.communication`, `noun.group`, `noun.relation`, `noun.motive`, or in `verb.social`,
   `verb.emotion`, `verb.cognition`, `verb.communication`, `verb.competition` was admitted.
   A leading sense in `noun.artifact`, `noun.event`, `noun.possession`, `noun.state`, `verb.creation`
   or `verb.possession` (crafts, social events, property, human states, making things, buying and
   selling) was admitted as a second, weaker class.
3. **Webster's Unabridged 1913 glosses** — used for the many web2 words WordNet does not cover.
   A word was admitted on its definition only when the definition opened with a definitional frame
   that names a person or an act ("one who …", "a person who …", "act of …", "the art of …").

**Filters, in order**

1. **Reference-dictionary gate.** Every candidate had to be a line of `/usr/share/dict/words`
   (see §4). Words known only to the definition corpus were dropped.
2. **Other-theme gate.** Every word already owned by NATURE or SPIRIT — the shipped buckets *and*
   the raw per-letter harvest files under `.scratch/aumlok-themes/raw/` — was excluded, so the
   three themes stay disjoint. This removed **2,092** words that the classifiers above would
   otherwise have admitted. *When written (commit `5c829dff4`, 2026-09-23 11:00) the bucket was disjoint
   from the then-shipped NATURE and SPIRIT buckets (measured: 0 and 0). The later `theme-nature.json` and
   `theme-spirit.json` overlap it by 1,404 and 4,016 words, and the X2 rebuild's bands by 144 and 79. The
   2,092 figure cannot be re-derived from tracked files (`.scratch/` is not tracked).*
3. **Vocabulary-ban gate.** Words carrying the v2 ban's substrings are excluded and are not spelled
   anywhere in this file or in the JSON.
4. **Shape and duplicate gate.** lowercase a–z, 4–9 letters, one word, no spaces or hyphens, no
   repeat inside the theme.

**Tiers inside the shipped bucket** (`_provenance.tiers` records the inherited tier as 0, which is wrong;
the 2,891 below is the measured overlap with the pre-X2 PEOPLE bucket at `5c829dff4`)

* 2,891 words inherited from the shipped PEOPLE bucket and its harvest files.
* 13,510 words classified by WordNet (leading or secondary sense, strong or medium class).
* 1,681 words admitted by a Webster definitional frame.
* 891 words added by a generous fill pass for letters still under 400: a definition carrying a
  human marker, or a person/act/feeling morphology, with nature-domain glosses excluded.
* 184 words selected by hand from their Webster glosses in a final curated tail (see §6, call 6),
  which is what carried j and k over the line.

The five tiers sum to the 19,157 shipped words. The four strict tiers alone (inherited bucket,
WordNet, Webster definitional frame) hold **18,082** words over **17 letters at or above 400**;
the fill pass and the curated tail are what lift j, k, n, u and v to the target.

## 4. The dictionary check

**Command** (one `grep -x` process per shipped word, parallel, against the real file — the same
shape the themed-lists court uses):

```
xargs -P 16 -I{} sh -c 'LC_ALL=C grep -qx -- "$1" /usr/share/dict/words || printf "%s\n" "$1"' _ {} < shipped-words.txt
```

**Result: 0 of 19,157 shipped words missing** (re-measured 2026-09-26). Every one of the 19,157 is a
byte-exact line of `/usr/share/dict/words`. No court checks this file today: the themed-lists court that
used this shape was rewritten by X2 and no longer asserts dictionary membership. An exact-match-set pass over the same file agrees: 0 missing, 0 shape
violations, 0 duplicates, 0 words shared with the NATURE/SPIRIT sets.

**How many candidates the dictionary check removed.** The pipeline drew candidates from the
dictionary itself, so nothing shipped was dropped at this gate — but the gate is real and it bit
the definition corpus: Webster's 1913 supplies 61,026 lowercase 4–9 letter headwords, and **14,556
of them are absent from `/usr/share/dict/words`** (proper nouns, foreign words, spellings web2 does
not carry). Every one of those 14,556 was dropped by this gate; none of them is in the bucket.

## 5. Letters that fell short of 400, and why

The shortfall is arithmetic, not effort. The reference dictionary contains only so many lowercase
4–9 letter words beginning with each letter, and the PEOPLE theme cannot claim the ones that are
plants, animals, minerals, weather or geography — those belong to NATURE, whose words are excluded
by the other-theme gate.

| letter | shipped | dictionary ceiling (lowercase 4–9) | what the remainder is |
|--------|--------:|-----------------------------------:|------------------------|
| q | 253 | 527 | quadrille/quadrant geometry, quartz and chemistry, quinine alkaloids, bird and plant names |
| x | **46** | **134** | xylan/xylene/xylol chemistry, xanthophyll pigments, xenolith/xenotime geology, xerophyte botany |
| y | 155 | 409 | yttrium and ytterbium chemistry, yarrow/yautia/yellowtop plants, yoldring/yelper/yite birds |
| z | 124 | 458 | zeolite/zircon/zarnich minerals, zymase/zymogen chemistry, zebra/zati/zenick animals |

**x cannot reach 400 at all.** There are only 134 lowercase 4–9 letter words beginning with x in the
entire reference dictionary. Even a bucket that took every single one of them would be 266 words
short, and the great majority of those 134 are chemistry and geology. 400 x-words is not a target
that can be met honestly from this dictionary; it can only be met by inventing words.

The same ceiling argument bounds q, y and z, though less absolutely: reaching 400 there would mean
claiming roughly half to nine tenths of every q, y and z word in the dictionary, including the
nature-domain words this theme must leave alone.

**What this means for anchors.** If the generator admits only letters with 400 words in all three
themes, then **q, x, y and z cannot be anchor letters** for PEOPLE. Any six-letter anchor using
q, x, y or z cannot be guaranteed from this bucket, and the anchor list should treat those four
letters as excluded. Every other letter clears the target.

## 6. Judgement calls

1. **WordNet's semantic fields, not intuition, decided the middle.** A leading sense of
   `noun.animal`, `noun.plant`, `noun.object`, `noun.substance`, `noun.phenomenon`, `noun.food`,
   `noun.location`, `noun.time`, `noun.quantity`, `noun.shape` and the `verb.motion` / `verb.contact`
   / `verb.weather` families was treated as NATURE's, even when the word can describe a person.
   This is why a few human-capable words whose only WordNet sense is a physical motion (a good
   example is the verb for crossing a street illegally) are absent.
2. **Craft artifacts count as PEOPLE.** The definition names *crafts*. Ships, tools, garments,
   coins, books, musical instruments, buildings and weapons made by people were therefore admitted
   through `noun.artifact` and through Webster glosses that name an instrument or a trade. Raw
   materials and natural objects were not.
3. **Food and drink were handled case by case.** Words whose gloss describes a preparation — a
   brewed liquor, a forcemeat dish, a bakehouse tub — were admitted as craft; words that are
   simply a plant or an animal were not. This is a judgement, not a rule, and it is the softest
   edge in the bucket.
4. **Words with no definition at all were not admitted on morphology alone.** A word that is
   neither in WordNet nor in the definition corpus cannot be checked for theme, so it stays out;
   suffix-shape by itself admits mineral names (the -ite family) and chemical adjectives.
5. **The generous fill pass exists because of j, k, n, u and v.** Those five letters sat at
   180–374 words after the strict passes. The fill pass admits a word when its definition anywhere
   carries a human marker (person, body, feeling, trade, speech, act) and its definition carries no
   nature marker, or when it is a person/act/feeling formation with a definition. It is recorded as
   its own tier so a stricter reviewer can drop it and still have 18,266 words (corrected 2026-09-26
   from the tier arithmetic; this line previously said 16,743). The "15 letters over 400" that went
   with it cannot be checked from the shipped JSON.
6. **The curated tail is hand-picked and named as such.** 184 words were read individually in their
   Webster glosses and kept for a human sense: for j, words like the coach-driver, the dunce, the
   gold coin, the obsolete word for giving, the feeling of anger, the act of pouring; for k, the
   joint of a finger, the chilblain, the bruise-free words for a tub, a peg, a gate, a pack sack,
   a pencil of lead. This tier is what carried **j to 400** and **k to 409**. It is the weakest tier
   in the file by construction and it is labelled in `_provenance.tiers.curated-human-tail`.
7. **Function words and closed-class words were kept out.** Adverbs, pronouns, prepositions and
   conjunctions that carried an incidental human noun in their gloss were rejected in the tightened
   pass; an early looser pass admitted a few of them and was discarded rather than shipped.
8. **Variant and inflected forms are allowed if the dictionary lists them.** The dictionary carries
   plural and variant spellings as their own lines, and they were treated as words in their own
   right. They are a small minority of the bucket.
9. **Cross-theme overlaps are already excluded, but the parent still owns the merge.** No word here
   is in the shipped NATURE or SPIRIT buckets or in their raw harvest files. If the NATURE or SPIRIT
   lanes widen their own lists past the harvest files, new collisions can appear; the rule this lane
   used is that a word two themes claim goes to the first of NATURE, PEOPLE, SPIRIT.
10. **Nothing was invented, and no bucket was padded.** Every word traces to a dictionary line and
    to a classifier decision; the four letters that fell short fell short and are reported as such
    rather than filled with coinages, proper nouns or chemistry.

## 7. What this file is not

It is not the merge. It does not touch `aumlok-themes.json`, the entropy module, the anchors, the
court or the ledger. It is one theme's bucket, with its counts, offered to the lane that owns the
merge.
