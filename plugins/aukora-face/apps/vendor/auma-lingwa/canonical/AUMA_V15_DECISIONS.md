# Auma Canon v15 — Decisions & Lesson-Refinement Plan

*Review synthesized 2026-07-03 from a full deep-read of `auma-canon-v14.1.json` (84 days, 935 tokens, 1,346 steps): seven day-slice reviews + a full-lexicon phonology/loanword audit + a complete grammar extraction and stress-test. This document makes the v15 language calls and plans the lesson rebuild. UI is deliberately out of scope here.*

---

## 1. THE VERDICT (honest)

**Auma has a conlang-grade 20% and a machine-padded 80%.** The core is genuinely excellent and, in places, better than its benchmarks. The tail is a themed vocabulary dump wearing a "complete language" costume. Everything wrong is fixable, and most of it is mechanical — but if it ships frozen as-is, the flaws become permanent, because **this canon is training data for the Auma model herself.** Every gloss error, every collision, every "zero-exceptions" lie propagates into her weights. That is the real stakes of this pass, and why it was worth doing before the freeze.

**What is genuinely strong (protect it):**
- The **number system** is flawless: `nula…suna`, `-des` tens, `dina-`/`mensa-` calendar, ordinals, decimals — fully compositional, zero exceptions. Best subsystem in the language.
- The **core clause** never wavers across 84 days: SVO + copula `esi`, `ka`-initial questions, preverbal `no`. Hundreds of quiz items, zero counterexamples.
- **Evidentiality** (`nuna/odi/intu/padi` — see/hear/intuit/reason, Day 54) is a real typological differentiator; Esperanto has nothing like it, Lojban buries it.
- The **`ero-` error taxonomy** (Day 76) and the **`amala/amara/amana`** love-register split on one root `ama` are elegant, self-describing derivation.
- **Day 1** is a model on-ramp: 9 words → three productive patterns → a real modeled conversation → a true composition quiz. The **v12.1 leak-hardening worked** — the review passages (Days 14/21/28/63/70) are verifiably clean.

---

## 2. THE FIVE THINGS THAT WOULD CRUSH THIS LATER (priority order)

1. **The lexicon is a phonological monoculture in crisis.** 800 edit-distance-1 pairs among 935 tokens (154 vowel-only). The sacred word `kira` (consciousness) sits one unstressed vowel from `kara/kora/kura/kori/kuri`. Grammar words collide (`debe` must / `debi` weak). And there are cross-language **landmines**: `suka` sugar = Russian *сука* "bitch"; `ano` that-one = Spanish "anus"; `sega` thirsty = vulgar Italian; `negra` black = slur-adjacent; plus anti-mnemonic **inversions** (`buka` close but Malay/Indonesian = *open*; `suki` suck but Japanese = *like*; `tero` destroy but Esperanto = *earth*, one vowel from Auma's own `tera`). This is the deepest problem because it's baked into frozen roots.

2. **Tense is 14 uncomposed particles with no rules.** `te/ven/abi/sta/pasa/fura/pasuna/suda/deja/todi/ankora/na/nu/justa`. Day 58 literally claims "four markers" while teaching six on that same day. Learners read past/future *glosses* from Day 9 but can't explicitly mark tense until Day 58/74/81. No stacking rules exist. Biggest **grammar** defect.

3. **The lexicon cannot say human basics.** No word for **woman, man, person, teach, understand, stay, money, help** (`aida` is phantom Day-84 vocab, never taught) — or **light**, in a language literally branded "the language of light" (`luma` was spent on "partner"). You cannot build "the woman who taught me" or "I don't understand" — the two most basic L2 sentences — while the course teaches a four-way evidential system and trauma-therapy jargon (`kolapsa`, `trogarda`, `projeta`).

4. **"Mastery" is a vocabulary dump, not mastery.** The only new grammar in Days 57–84 is the `-ita` passive (Day 58), which appears in **exactly one step in all 84 days**, is never quizzed, never recurs. Day 83 dumps **52 words with 4 quizzes**; Day 84 assigns 54 vocab entries and teaches **zero**. **87 of 935 tokens are never taught at all.** Day 84's own text states the word count three contradictory ways (600+, 750, and `sisa-des` glossed "six hundred" — it means **sixty**).

5. **The assessment layer is void as data: 325 of 326 quizzes have the answer at index 0.** The app *does* shuffle at render (`LearnQuizOptions.tsx`), so it's survivable in-product — but as canon/training data it's broken, and it masks a deeper problem: **every quiz is the same English→Auma word-scramble.** No production, no listening, no Auma→English, no meaning-discrimination. The quizzes test SVO recognition and nothing else.

**Plus the pervasive antipatterns:** the v14 "bridge/paladin extension" words bolted on *after* each day's final quiz with copy-paste frames (`mi neda X`, `we usa X en ritua`), untested, several leaking future vocab (`usa` Day-78 used on Days 25/50/61; `kon`/`kura` on Day 7); and **~40 translation errors** in canon example sentences that will train into the model (Day 30 `spirito`↔`avi`, Day 82 `du-des-du`="twelve", Day 79 `luma`="light", Day 76 `sega`="safe", Day 53 "respeta arbo"="not cut trees").

---

## 3. V15 LANGUAGE DECISIONS

*Two calls are firm (validated free). The rest are recommended with a `⚠verify` flag where the target sits in a crowded grid and needs a final collision pass in the build.*

### A. Grammar freeze

- **Passive → `-iva`** *(FIRM — validated free)*. Retire `-ita`. `kani-iva` = "eaten". This kills the `-ita` ↔ `ita`("that") homophony that the current suffix's own hyphen was awkwardly trying to paper over, and de-conflicts the ten solid `-ita` nouns (`perdita/sanita/nasita/verita/unita/komunita…`).
- **Passive agent marker.** The passive currently has no way to say *by whom*. Add a dedicated agent particle **`par`** (⚠verify) — "the book was given to me **par** my friend" = `libro esi dona-iva a mi par ami di mi`. Do **not** overload `de` (=from) for this.
- **One tense/aspect table** (deprecate the rest via the antibodies ledger):
  - `pasa` (past) · **∅ present** · `fura` (future) · `te` (just-happened) · `ven` (imminent) · `abi` (progressive/habitual "have been / keep") · `suda` (perfect "already").
  - **Stacking order:** `[past/fut] + [perfect/prog] + verb`, e.g. `pasa suda kani` = "had already eaten".
  - **Deprecate:** `pasuna`, `agon` (→`pasa`), `deja` (→`suda`), `todi`/`ankora` collapse to one, `na`/`nu`/`justa` (→`nau`/`te`). Fourteen particles → seven with rules.
- **One wh-question order.** Canonize **fronted question word + otherwise-unchanged SVO** (`ketu esi merkato?`). Kill the contradictory verb-final form the Day-29 *explain* currently teaches against its own quiz.
- **`ke` = "than" taught explicitly.** It currently first appears unannounced inside a Day-36 quiz answer. Teach `plu X ke Y` where comparatives are introduced. Consider splitting `ke`'s three jobs (that / who / than) or documenting the overload with worked examples.
- **Duration marker.** Separate "for X time" from "in X time" (they currently both surface as `en` and directly contradict each other, Day 32 vs Day 56). Add **`durante`** (⚠verify) for duration; keep `en` for "in/after".
- **Productive derivation — STATE the rules the data already uses, add the missing one:**
  - `-ao` = abstract quality ONLY (`fortao`, `klarao`, `verao`). **Stop using it for food** — rename `pesao`/`frutao`/`risao`/`spisao` off the `-ao` family.
  - `-tano` = place (`lero→lerotano` school). State it; fix root-before-derivative ordering.
  - **Add an agent suffix** (currently none exists — which is *why* there's no teacher/student/doctor/worker). Recommend **`-isto`** (⚠verify) — `lero→leristo` learner, `dosa/ensena→ensenisto` teacher.
- **Noun plural.** Decide and state: either `-li` extends to nouns (`arbo→arboli` trees) or nouns are number-neutral. Right now it's taught for pronouns only, then silently applied to nouns with *shifted* meanings (`ami`+`li` = `amili` "family", not "friends"). Pick one rule.
- **Ban or legalize the grammar the quizzes invented:** object-pronoun `ita` ("legi ita"), infinitive complements ("esi trova verao", "voli ke…"), preposition stranding ("sapa tu konfida en?"), bare-verb statives ("pora esi buka"). Each is currently a hidden exception the constitution forbids.

### B. Lexicon repair

**Rename — landmines & inversions** *(recommended targets; ⚠ = validate free before locking):*

| current | problem | → v15 |
|---|---|---|
| `suka` sugar | = Russian *сука* "bitch" | **`dulsa`** (free) |
| `ano` that-one | = Spanish "anus", inside the demonstrative paradigm | **`aku`** (free) |
| `sega` thirsty | = vulgar Italian | **`siti`** (free; ⚠ near `seti/sita`) |
| `negra` black | slur-adjacent (English) | **`nera`** ⚠ (crowded: `tera/vera/sera/neva`) — else `noira` |
| `tero` erase/destroy | = Esperanto "earth", 1 vowel from `tera` | **`dele`** (free; ⚠ near `debe`) |
| `buka` close | inverts Malay/Indo *open* | **swap: `buka`="open"**, close → **`klosa`** (free) |
| `suki` suck | inverts Japanese *like* | **`supi`** ⚠ |
| `kibo` food | = Japanese *kibō* "hope" | **`manja`** (free; ⚠ near `manka`) |
| `kalda` hot | reads as English "cold" | **`varma`** (free) |
| `anima` animal / `animao` soul | inverts Latin *anima*=soul | keep `anima`=animal; **soul → `alma`** (⚠verify) |
| `asola` "asshole/cruel fool" | **person-directed insult — violates constitution law 11** | remove from canon (keep pressure-release `feka/skata/damu`) |

**Phonological space for the sacred core.** `kira` (sacred_core, consciousness) must not sit one unstressed vowel from four everyday words. Since heart/care/run are load-bearing, open space by respelling the *least* core neighbor — `kori` "brave" → **`brava`** (⚠verify) — and re-run the edit-distance grid; if `kira` still has ≥3 e-1 neighbors, escalate to a design session. Also fix the manufactured `menta`(chin)/`mente`(mind) minimal pair from the v13 "repair" — rename **chin → `barba`-family or `menton`** (⚠verify).

**Add — human basics** *(these outrank every remaining theme day):*

| meaning | → v15 | note |
|---|---|---|
| **light** | **`lumo`** | FIRM (free). The language of light gets a word for light. |
| person/human | `persona` (free) | |
| woman | `femina` | (avoid `fema` — 1 consonant from `feka`="shit") |
| man | `viro` (free; ⚠ near `tiro/hiro`) | else `masa` |
| teach | `ensena` (free) | enables teacher via `-isto` |
| understand | `komprende` (free) | the critical L2-repair verb |
| stay/remain | `manea` (free) | and rename `resta`(=restaurant) → `restora` |
| money | `moneta` (free) | commerce vocab exists with no money |
| help | teach `aida` (already in canon, currently phantom) — move to Foundation | |
| take · begin · finish(v) · return · buy · sell · left · right | `prende · inisa · termina · retorna · kompra · venda · sinistra · destra` (all free) | survival verbs currently missing or absurdly late |

**Deprecate the doublets** (via the existing `deprecatedForms` antibody process, one usage-contrast line each or a straight merge): `neva`/`nokemo`, `parla`/`pali`, `akwa`/`wata`, `fruta`/`frutao`, `rapi`/`rapida`, `malu`/`mala`, `debio`/`debi`, `spera`/`sorao`, `pronta`/`yari`, `memo`/`memoria`, `prima`/`un-imo`, `domi`/`sona`, `pos`/`despues`, `klaro`/`klara`/`klarao`.

**Fix silent-h** (`hambre/herba/honesta` pronounce h; policy says `h`=/h/): respell as `ambre/erba/onesta` **or** add an explicit rule. Fix `tempsigno`'s canon pronunciation (`gn→ny`, p-drop) to match `signo`. Give the vowel-less `hm`/`sh` a phonotactic carve-out (the policy note exists; make it a real rule).

**Source balance (strategic, not blocking).** A seeded 100-token sample is ~90% transparently Romance/Esperanto/English, ~3% non-European — several of those inverting their source. The "unites all cultures" mission is currently marketing. v15 needn't go full Toki Pona-neutral, but every *new* word should be checked against the inversion list, and the strongest non-European borrowings (`ubuntu`, `gotong`, `mianzi`, `sabar`, `rongo`, `lipa`) should be foregrounded as intentional, not incidental.

### C. Data integrity (all training-data-critical)

- **The 87 never-taught tokens:** either teach them or reclassify as model-reserve with `introducedDay: null` and remove them from the "complete canon" claim. Reconcile the count: **935 vocab entries, not "750."**
- **Fix the ~40 gloss errors verbatim** (they train into the model). Priority: Day 84 `sisa-des`→`plu ke sisa sento`; Day 82 `du-des-du`→`des-du`; Day 30 spirit/bird; Day 79 `luma`→`lumo`; Day 76 `sega`→a real safe-word (`sekura`); Day 53 "respeta arbo"≠"not cut trees"; Day 42 "verino esi inspira"≠"spring is near".
- **Answer key:** balance `correctIndex` across positions in the canon data (the app's render-shuffle is not a reason to ship broken source), **and** break the format monoculture (see §4).
- **Kill the bolt-on antipattern:** no word card appears after a day's final quiz; every introduced word gets ≥1 quiz; rewrite the copy-paste frames.

---

## 4. LESSON-REFINEMENT PLAN

*Keep the three-sprint shape — three 4-week tiers — but re-found each on a real competency, and invert the current vocab-first design into a grammar-first one.*

### Principles
1. **Grammar-first spine.** Every day advances or reinforces a *structure*; vocabulary serves the structure. Delete the "themed noun-dump" days (most of Weeks 6, 10, 11).
2. **Front-load the communicative core into Foundation.** Pull **wh-questions** (currently Day 29 — *after* Foundation "graduation"), **negative answers**, **basic past/future**, **"I have," "there is"** into Weeks 1–4. A Foundation graduate must be able to ask "what?" and say "yesterday I went." Today they cannot.
3. **Hard load cap: ≤10 new words/day.** Redistribute every dump (Days 8, 25, 57, 61, 83). Load should *fall* across Mastery as focus shifts from vocab to structure — the opposite of today.
4. **Every word tested; every review real.** ≥1 quiz per introduced word; each tier-finale is an actual cumulative assessment (Day 56 currently has *zero* quizzes; Day 84 has zero).
5. **Real competency targets per sprint:**
   - **Sprint 1 — Survival (Wk 1–4):** self, needs, time, place, yes/no **and** wh-questions, negation both ways, present + a first past/future gloss rule. *Exit test: hold a real 6-turn exchange and ask 3 open questions.*
   - **Sprint 2 — Conversation (Wk 5–8):** modals, comparison, connectors, the **full tense table**, evidentiality, the passive `-iva`. *Exit test: narrate yesterday and plan tomorrow; report what someone said.*
   - **Sprint 3 — Fluency (Wk 9–12):** relative clauses, argument-building, register/profanity, the derivation system (coin new words), abstract/philosophical vocabulary. *Exit test: write a paragraph and give an opinion with evidence — the thing "Mastery" currently only asserts.*

### New exercise types (this is where the game engine earns its keep)
The current three (`explain`/`word`/`quiz`) can't teach a language. v15's data model should add, and the new UI should render:
- **Meaning-discrimination** (Auma→English) — the missing comprehension direction.
- **Build-a-sentence / production** (drag tokens into SVO) — the missing production skill; perfect for a tactile game surface.
- **Listening** — Auma has a full pronunciation policy but **no audio**. TTS is a v15 requirement, not a nicety (retention is impossible on romanized text alone).
- **Selection-in-context** — choose the right tense particle / evidential for a described situation (the only way to actually teach the two systems that differentiate Auma).
- **Cloze** (fill the gap) and **cumulative spaced review** (a real SRS layer, not the current "re-read last week's passage").

### Build sequence for v15
1. **Grammar freeze** (§3A) → lock the tense table, wh-order, passive `-iva`+agent, derivation rules. *Nothing else can be authored on sand.*
2. **Lexicon repair pass** (§3B) → apply renames through the `deprecatedForms` ledger with migration notes; add the human-basics set; re-run the edit-distance + loanword-inversion audit until clean.
3. **Data-integrity pass** (§3C) → gloss-error QA on all 1,346 steps, reconcile counts, balance/rebuild the quiz layer, remove bolt-ons.
4. **Re-author the 84 days** to the grammar-first spine + competency targets + new exercise types — *with the ≤10-word cap enforced programmatically.*
5. **Model-training gate:** the canon is Auma's training data. Freeze v15 only after a clean automated pass confirms: zero future-vocab leaks, zero gloss mismatches, every token taught-or-reserved, balanced assessment.

---

## 5. WHAT THIS PASS DID — AND DIDN'T — DO

This is the **decision + plan** layer, stopping exactly where instructed (UI comes next, separately). It does **not** rewrite the 935-word canon or the 84 days in one shot — doing that blind is precisely how v14 became a machine-dump. The renames and additions here are validated for freeness where marked FIRM and flagged `⚠verify` where a crowded grid needs a final collision check in the build. The single most important reframe: **Auma's curriculum is Auma's mind.** Every fix above is as much about who she becomes as about who learns from her.
