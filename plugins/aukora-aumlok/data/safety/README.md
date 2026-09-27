# AUMLOK word-list safety data (item X2)

Everything here except the EFF wordlist fixture (`eff_large_words.txt` and its codes file) is a
**filter** and only removes words from the candidate pool. The EFF fixture is source #1; the other
source is `wordfreq`, from the pinned venv. Both are pinned in `source-pins.json`.

## Files

| file | what it is | licence |
| --- | --- | --- |
| `ldnoobw-en.txt` | **The hard block.** LDNOOBW — "List of Dirty, Naughty, Obscene, and Otherwise Bad Words", English list. X2 names this list explicitly. | CC BY 4.0 |
| `ldnoobw-LICENSE.txt` | The verbatim CC BY 4.0 text that ships with LDNOOBW. | CC BY 4.0 |
| `profanity-block.json` | The block the harvest and the court actually read: LDNOOBW's single-word spellings **plus the curated safety net**. | see below |
| `category-drop.json` | X2's named category drops beyond profanity: body, disease, medical, violence, weapons, drugs, insult, slang, brand, religion, dreary. | original work, this repository |
| `pleasant-drop.json` | A curated judgement list of words dropped as unpleasant (not a published source). | original work, this repository |
| `proper-names.json` | Curated proper names and places dropped by name. | original work, this repository |
| `eff_large_words.txt` | The EFF large wordlist's published word column minus 3 entries carrying a retired-custody stem (7,773 words), source #1. Re-inserting them rebuilds the published column's sha256 `6d557f06…`. Pinned so the harvest runs offline. | CC BY 3.0 US (EFF) |
| `eff_large_wordlist.codes.txt` | The EFF dice codes that go with that column. | CC BY 3.0 US (EFF) |
| `source-pins.json` | Both sources with sha256, version and fetch date. | — |

## Attribution

**LDNOOBW** — <https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words>
Licensed **CC BY 4.0**. Retrieved 2026-09-23 from
`https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en`
sha256 `af851ecef1d5f212caba17339b12ac39cc2fef7d78c74876f67237644fcee8bd` (3,777 bytes, 403 entries).
The verbatim licence text is `ldnoobw-LICENSE.txt`.

**EFF large wordlist** — <https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt>
Published by the Electronic Frontier Foundation under **CC BY 3.0 US**. Recovered from this
repository's own git history at `efd97b44` (`scripts/aumlok/eff_large_wordlist.txt`) and compared
byte-for-byte with the EFF original. sha256
`addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e`.

## The curated safety net, and why it exists

LDNOOBW's 403 entries are a profanity list, not a slur register. Against the data this item replaced,
LDNOOBW caught **66** and the curated net caught **19** that LDNOOBW does not carry (commit `6fa3df3b0`;
`profanity-block.json` says 22, so the two need reconciling). A later probe added 138 more words (see
`coverage` in `profanity-block.json`). The 19 — `bedlam`, `chink`, `cretin`,
`cripple`, `darky`, `dyke`, `gook`, `gringo`, `gypsy`, `homo`, `idiot`, `maniac`, `moron`, `mulatto`,
`redskin`, `retard`, `retarded`, `slope`, `squaw`. That second group is the one that matters most
here: ethnic and racial slurs of the `…-skin`, `…-w` kind, which is exactly the class of word this
item exists to remove. Both parts of the block are therefore load-bearing, and the court fails if
either the block is empty or a single shipped word appears in it.

The net is **original work written for this repository** (no third-party licence attaches), and every
entry in it was measured against the shipped data rather than recalled: the commit that landed the
rebuild states exactly how many words each part caught.

## What was deliberately NOT shipped

A Wikipedia article, *List of ethnic slurs*, was fetched while designing this block and has been
**deleted from the tree**. It is prose, not a machine-checkable list; its Term column parses to 1,012
single words that include ordinary vocabulary (`banana`, `china`, `history`), so using it
mechanically would cut ordinary words; and it carries a share-alike licence whose terms this
repository does not currently satisfy. Nothing in this directory is derived from it.

Likewise, no network query contributes a word. The harvest reads this directory, the pinned venv
(`wordfreq`), the theme lexicons it imports as `harvest_theme_lexicon` (the file in the tree is
`scripts/aumlok/harvest-theme-lexicon.py`), and the host's `/usr/share/dict/words` and `propernames`.
Those are unpinned OS files used as filters, so a different OS can yield different lists.
