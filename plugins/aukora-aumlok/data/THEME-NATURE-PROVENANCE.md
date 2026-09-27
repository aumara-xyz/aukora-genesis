# THEME — NATURE: definition, method, counts, judgement calls

**Deliverable:** `plugins/aukora-aumlok/data/theme-nature.json`
**Lane:** AUMLOK v3, NATURE bucket (branch `fable/spatial-shell`)
**Status:** data only. This document and the JSON beside it are the whole deliverable; nothing else in the
tree was written, and no live path was touched.

---

## 1. The theme, in the plan owner's words

> anything of the physical world — animals, plants, weather, land, materials, colours, textures.
> Be generous inside that definition; the point is a mnemonic FLAVOUR, not a taxonomy.
> A word belongs if a person would hear it as a thing of the world.

How this lane read that, as an admission rule:

**In:** animals, plants, fungi and microorganisms; their parts, products and names; land, water, weather,
sky and celestial bodies; minerals, rocks, soils, metals, gems, pigments and other substances and
materials (including worked ones — cloth, glass, resin, alloys); colours; textures and physical
properties; and physical objects that a person would hear as a thing of the world (an anvil, a boat,
a quern, a xylophone).

**Out, deliberately:**

| Refused class | Why |
| --- | --- |
| persons, roles, kinship, groups, trades | the PEOPLE lane owns them |
| religion, ritual, belief, mind, spirit | the SPIRIT lane owns them |
| abstract nouns (states, acts, qualities) | no physical referent |
| medical, pathological and surgical vocabulary | jargon of the body, not a thing of the world |
| grammar, mathematics, logic, units of measure | instruments of thought |

The precedent for admitting physical objects is the project's own: the NATURE bucket in
`data/aumlok-themes.json` as it stood before `4cdc32e7e` (3,899 words) carried `anvil`, `aquarium` and
`agateware`. *(Corrected 2026-09-26: the shipped file has since been rebuilt, and its NATURE bucket, 683
words since `80772f29e`, holds none of the three.)*

## 2. Method

The shipped list is the union of five sources, every member of which was then checked exactly against
the dictionary. Nothing was shipped that the dictionary does not contain.

1. **Carried forward — the existing NATURE bucket** (`data/aumlok-themes.json`, 3,899 words). The
   project's own previously curated precedent. It is carried unchanged so that no word already shipped
   is lost and so that cross-theme collision resolution can be redone against a superset. Some of its
   members (for example a few medical and abstract items) are looser than this lane's own rules; they
   were **kept on purpose** for continuity rather than quietly re-litigated. *(Corrected 2026-09-26:
   the shipped `aumlok-themes.json` has since been merged with this list (`5a1136b4c`) and rebuilt by
   X1/X2 (`1118a94c5`, `80772f29e`). Its NATURE bucket now holds 683 words and none of the looser
   examples; this list, `theme-nature.json`, is read by no code.)*
2. **Definition engine.** `DCSCopyTextDefinition` (Apple's Dictionary Services, New Oxford American
   Dictionary) was called once per word over all 103,788 lowercase 4–9 letter entries of
   `/usr/share/dict/words`. A word is admitted when its own gloss names a physical-world head noun
   (tree, bird, mineral, river, fabric, colour, …) inside the first 12 tokens and no person, social or
   abstract head noun appears before it. Definitions are **evidence only**; no definition text is
   shipped. Coverage was 35% of the pool, so this engine cannot be the only one.
3. **Definition recovery pass.** The same test with a 30-token window, applied **only** to the letters
   that could not otherwise approach the floor (d e i j k l n o q r u v w x y z). It is a weaker test
   and is named here so the weaker evidence is visible rather than implied.
4. **Compound engine.** A dictionary word is admitted when its 4–9 letter tail is itself an admitted
   physical-world noun and the remaining base is at least 4 letters — `adder` + `wort`, `quill` + `fish`,
   `thunder` + `stone`. Heads that are homographs of common non-nature morphemes (ant, ash, ore, ice,
   mist, mite, fly, sky, peak, wing, pod, tide, vine, hide, rain, field, aster, melon, corn, deer, pear,
   bean, rice, rose, sage, rue, bay, mere, sound, point, spring, well, bank, mount, cape, channel …) are
   excluded from this rule, which is what removed `abdicant`, `balladeer`, `bestowing` and `reappear`.
5. **Curated batches.** Words supplied by this lane's author, each verified against the dictionary. This
   is where the hard letters get their real content (x, q, y, z, j) and where the near-floor letters were
   topped up (d, e, f, h, l, r, w).

**Then the purge**, applied to every word that is not from source 1:

* `-ing` gerunds (570 removed), except a whitelist of real nature nouns (starling, seedling, offing,
  gloaming, lightning …);
* `-ed` past tenses (127 removed), except physical descriptors (winged, leaved, horned, scaled, frosted,
  foliated, forested …) and compounds whose head is weed, seed, reed, tweed or steed;
* `-ly` adverbs (91 removed), except holly, lily, woolly, curly, burly, gnarly, prickly, wrinkly;
* abstract and person morphology (271 removed): `-ness -tion -sion -ment -ism -ist -ity -ance -ence
  -ship -hood -less -able -ible -ward -wise -uous`, plus a named blocklist of the individual offenders
  the audit surfaced (everybody, extrovert, vainglory, traction, tuborrhea, quitclaim, quarrier,
  orchidist, opticist, kenspeck, improvise, jetsam, nosewheel, nursling, cityscape …).

**Purged total: 1,059.**

## 3. Candidate accounting (what was removed, and by what)

| Stage | Count |
| --- | --- |
| lowercase 4–9 letter entries read from `/usr/share/dict/words` | 103,788 (of 235,976 lines) |
| admitted by the definition / compound engines | 9,050 |
| words typed by this lane as curated batches | 3,645 |
| — removed by the **dictionary check** (not exactly in `/usr/share/dict/words`) | **258** |
| — removed by the 4–9 letter / single-word shape check | 580 |
| — removed by the v3 vocabulary ban | 1 |
| — removed because the word was filed under the wrong first letter | 2 |
| removed by the theme purge patterns above | 1,059 |
| **shipped (unique words)** | **8,656** |

The 258 dictionary-check removals are the honest cost of writing candidates from knowledge: they are
words this lane believed existed (or misremembered) that Webster's/web2 does not carry, and they were
dropped rather than argued about.

**One deliberate discard of a whole batch.** The first typed pass for `i` and `u` was thrown away in
full: it had been padded with generic `un-` and `in-` words (unabated, unbecoming, uncanny, incompliant
…), which carry no NATURE sense. The brief forbids padding; those two letters are short today partly
because of that refusal, and that is the right trade.

## 4. Counts per letter

| letter | words | vs floor 400 | dictionary ceiling for that letter |
| --- | ---: | ---: | ---: |
| a | 412 | **at floor** | 6,915 |
| b | 511 | **at floor** | 6,514 |
| c | 650 | **at floor** | 8,387 |
| d | 356 | −44 | 4,956 |
| e | 233 | −167 | 3,607 |
| f | 376 | −24 | 4,108 |
| g | 417 | **at floor** | 3,666 |
| h | 398 | −2 | 3,492 |
| i | 147 | −253 | 2,498 |
| j | 95 | −305 | 908 |
| k | 158 | −242 | 1,306 |
| l | 334 | −66 | 3,234 |
| m | 484 | **at floor** | 5,188 |
| n | 152 | −248 | 2,223 |
| o | 211 | −189 | 3,434 |
| p | 625 | **at floor** | 8,401 |
| q | 113 | −287 | 527 |
| r | 331 | −69 | 5,153 |
| s | 1,135 | **at floor** | 11,896 |
| t | 702 | **at floor** | 6,140 |
| u | 114 | −286 | 5,827 |
| v | 136 | −264 | 1,754 |
| w | 279 | −121 | 2,653 |
| x | 69 | −331 | **134 — 400 is impossible** |
| y | 58 | −342 | 409 |
| z | 160 | −240 | 458 |

**Total: 8,656 words.**
**Letters at the 400 floor: 8** — a, b, c, g, m, p, s, t.
**Letters below the floor: 18** — d, e, f, h, i, j, k, l, n, o, q, r, u, v, w, x, y, z.

### The ceiling, stated honestly

The right-hand column is the number of lowercase 4–9 letter words in `/usr/share/dict/words` that
begin with that letter. It is a hard cap on any bucket built from real dictionary words.

* **x cannot reach 400.** The dictionary holds **134** such words in total. This bucket carries **69**,
  which is 51% of everything the letter has, after reading the whole 134-word pool by eye. No honest
  list can do better by much.
* **y (ceiling 409) and z (ceiling 458)** would each need ~98% and ~87% of their entire letter to be
  NATURE words — they are effectively capped below 400 too.
* **q (ceiling 527)** would need 76% of its letter; **j (ceiling 908)**, 44%. Both would require
  admitting words no person hears as a thing of the world.
* Every other short letter sits far below its ceiling, which means the shortfall there is a **judgement
  limit, not a dictionary limit** — more words exist; they simply stop being NATURE under this
  definition. d (356 of 4,956), h (398 of 3,492) and f (376 of 4,108) are within a few dozen words of
  the floor and are the obvious place for a further pass.

## 5. The dictionary check, run and reported

Every shipped word was checked by matching the **whole line** with `grep -x` — the dictionary is the
reference, not the author's word. The shipped set was written one word per line and checked in parallel:

```
python3 -c "import json; d=json.load(open('plugins/aukora-aumlok/data/theme-nature.json')); \
  print('\n'.join(sorted({w for ch in d['letters'] for w in d['letters'][ch]})))" > shipped.txt

xargs -P 16 -I{} sh -c \
  'LC_ALL=C grep -qx -- "$1" /usr/share/dict/words || printf "%s\n" "$1"' _ {} < shipped.txt > misses.txt

wc -l < shipped.txt   # 8656
wc -l < misses.txt    # 0
```

**Result: 8,656 unique words checked, 0 misses.** Every word in `theme-nature.json` is present exactly
in `/usr/share/dict/words`.

Shape and internal consistency, checked on the same file:

* every word matches `^[a-z]{4,9}$` — 0 violations;
* 8,656 entries, 8,656 unique strings, 0 duplicates inside a bucket and 0 across buckets;
* every word sits under its own first letter — 0 misplaced;
* `_provenance.counts` equals the length of every shipped array — checked, true.

## 6. Judgement calls, all of them

1. **The 400 floor is a target, not a licence to invent.** No coinage, no proper noun and no
   capitalised entry ships. `x` is reported at 69 with the arithmetic of why 400 cannot exist there.
2. **Physical objects are in.** A quern, a xebec, a xylophone are things of the world; the owner said
   generous and the existing bucket already carries an anvil. If the owner wants a stricter, more
   pastoral line, this is the one rule to tighten — it mostly affects q, x and k.
3. **The v1 NATURE bucket is carried forward whole.** It is the project's own precedent and the base of
   the three-theme collision map; silently dropping 3,899 curated words would be a regression dressed
   as a cleanup.
4. **The v3 vocabulary ban was applied as a rule, not an argument.** One typed candidate carried the
   banned stem and was dropped. Neither the word nor the stem is spelled anywhere in these two files,
   because the ban is a grep over this directory: a file that spells it to explain its absence is
   itself a hit.
5. **No frequency filter.** Obscure web2 tail words (adderwort, gairfish, queencup) are kept. The theme
   is a mnemonic flavour for a word list a person reads once; a rare but real word is not a defect.
6. **Plurals and inflected forms already in the dictionary are kept** when the head is a thing (the
   existing bucket carries `aphides`). The rule is about the string: one word, 4–9 letters, lowercase.
7. **Anatomy is in, pathology is out.** Bone, horn, claw, uvula, otolith stay; fevers, tumours and
   surgical procedures were removed. This is a line drawn for flavour, not a claim about biology.
8. **Cross-theme overlap is expected but small.** Person-words and religious words were refused, so the
   overlap with the PEOPLE and SPIRIT lanes should be modest, but it is the parent's to resolve — this
   lane did not read or copy either sibling's list.
9. **The definition corpus was read-only evidence and is not a dependency.** If the JSON is rebuilt on a
   machine without the Apple dictionary, engines 2 and 3 produce nothing and the list falls back to the
   compound engine plus the carried-forward bucket. The shipped words do **not** depend on it — they
   depend only on `/usr/share/dict/words`, which is the check in §5.
10. **The counts in this document were printed by the build script, not typed by hand**, and they were
    re-read from the shipped JSON afterwards. Where this document and the JSON could ever disagree, the
    JSON is the data and this document is the claim about it.

## 7. Shape of the file (for the parent's merge)

```json
{
  "v": "aumlok-theme-nature-v1",
  "theme": "NATURE",
  "definition": "…the owner's definition, restated as an admission rule…",
  "letters": { "a": ["abaca", "…"], "…": [], "z": [] },
  "_provenance": { "theme": "NATURE", "counts": { "a": 412, "…": 160 }, "total": 8656, "…": {} }
}
```

`letters` is the per-letter mapping; `_provenance` carries the theme definition, the source dictionary,
the admission and refusal rules, the per-letter counts, the dictionary ceiling per letter, the
below-floor letters and the full candidate accounting. A merge into `data/aumlok-themes.json` is
`themes.NATURE = doc.letters`; nothing else in the file is needed for the data itself. *(Corrected
2026-09-26: the three themed buckets were merged into the shipped file in V2, `5a1136b4c`, and then
replaced by the X1/X2 rebuilds from the EFF list, `1118a94c5` and `80772f29e`. Today `theme-nature.json` is
a candidate list that no code reads.)*
