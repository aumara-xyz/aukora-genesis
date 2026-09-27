# Auma · Lingwa — the language canon

A durable, tracked snapshot of the **Auma** constructed language: the full canon
(vocabulary + all 84 days of lessons in one document) plus the review that produced it.
This folder is the recoverable source of truth for the language itself.

## What's here

| File | What it is |
|------|-----------|
| `auma-canon-v16.json` | **Current canon (v16).** 948 vocab entries, all 84 lesson-days, graded-reader corpus alongside, one unified document. This is what the "Auma · Lingwa" app and the chat teacher (lingwa lane) run on. |
| `auma-canon-v15.json` | **Prior canon (v15)**, kept for lineage — the 2026-07-03 export as shipped, before the v15.1 repair series. |
| `AUMA_V15_DECISIONS.md` | The v15 review + decisions write-up — the deep-dive findings (5 crush-risks), the language changes made, and the lesson-refinement plan. |
| `auma-canon-v14.1.json` | **Prior canon (v14.1)**, kept for lineage. 935 vocab entries, 84 days. This is the version that was deep-read to produce v15. |

## Lineage

**v14.1 → v15** (2026-07-03). A deep parallel read of v14.1 surfaced five crush-risks —
lexicon phonological monoculture + cross-language landmines, uncomposed tense particles,
missing human-basics (no woman/man/person/teach/light), a fake "Mastery" tier, and a quiz
answer-position bias. v15 is the grammar-freeze + lexicon-repair + data-integrity pass:
passive `-ita`→`-iva`, `lumo`=light, ~11 landmine renames propagated across all 84 days,
~20 human-basics added, worst gloss/count errors fixed, quizzes de-biased. Full detail in
`AUMA_V15_DECISIONS.md`. The deep grammar-first pedagogical re-authoring of all 84 days is
the documented next iteration.

**v15 → v16** (2026-07-07). The v15.1 repair series, finalized as the stable launch canon.
Machine audit found and fixed: all 12 v15-renamed words still carrying the old word's
pronunciation + ttsKey on cards and in the lexicon; a duplicate `malu`; `skirvi`→`skrivi`
metathesis repair; the v15 tense freeze never applied to the curriculum (all 7 deprecated
tense words were still taught — removed, `suda`→day 9, `ankora`/`pasa`→day 54); 22 lexicon
words with no lesson card given cards; 16 future-word leaks closed; day 83 slimmed 52→36
cards; day 84 given a real 22-question graduation exam; `teachingMode` tagged on every
entry; lexical dedup (`parla`/`pali` split, `despues`→`pos`, `siti`→`tirsta`). Alongside:
the six graded readers (`spatial/app/auma/readers-v1.json`), day-gated and lint-enforced.
v16 = that state, consolidated. Every canon release must pass `scripts/aumaCanonLint.ts`
with 0 errors. Future evolution targets **v17** via the versioned release process
(community-garden promotions + the open seed-core council questions).

## Where the app loads it

The spatial "Auma · Lingwa" app loads a **byte-identical copy** at
`spatial/app/auma/canon-v16.json` (via `CANON_URL` in `spatial/app/auma/auma.js`); the
chat teacher reads the same copy (`spatial/lingwaLane.ts`). If the canon changes here,
update that copy too so the two stay in sync — and run `bun scripts/aumaCanonLint.ts`.

## What Auma is

A constructed "language of light" built to be completely clear: every letter said the same
way, one sentence shape (who · does · what), no irregulars, transparent numbers (`des` + ten
sounds) and days (`dina-` + a number), derivation families (`ama → amala · amara · amana`).
Inspired by Esperanto's dream and the idea that clearer language makes clearer thought.
