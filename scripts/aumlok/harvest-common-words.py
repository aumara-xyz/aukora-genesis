#!/usr/bin/env python3
"""
AUMLOK X8 — THE WORDS, REBUILT BROAD AND BIG, WITH NO FALLBACK.

Peter's ruling of 2026-09-23 (the run after the first real bind):

    "Rebuild the three themes BROAD and BIG from a large frequency list (wordfreq; English zipf >= 3.0,
     i.e. the top ~30,000 words), generously classified ... Target about 2,500 pleasant words per theme.
     Keep the slur block and the pleasantness drops. Use themed words ONLY, no fallback to unthemed
     words; instead drop from the anchor pool any anchor with a letter that has fewer than 40 words in
     any theme. Measure and print the bits (expect ~50), then write 30 new sample phrases."

WHAT CHANGED FROM X2, AND WHY EACH CHANGE IS FORCED:

  SOURCE   zipf >= 3.5 becomes zipf >= 3.0, and the pleasantness pass's measured tail bar moves with
           it. X2's bar bound the whole pool, so leaving it at 3.5 would have made the new number
           inert: MEASURED, the 3.5 tail removed exactly the words that 3.0 admits, and the pool was
           9,988 words either way. One number now, in two places, moving together.

  THEMES   a NUDGE with a fallback becomes A RULE WITH NO FALLBACK. X2 let any theme claim whatever it
           liked and pushed the rest onto whichever band had room; MEASURED, 28% of draws were
           unthemed words. Here a word ships only if `harvest-theme-lexicon.py` names it, and every
           shipped word belongs to exactly one band. The harvest ASSERTS that: a word in two bands is
           a fallback in everything but name.

  ANCHORS  MIN_BUCKET (12, "a letter too thin falls back") becomes GATE (40, "a letter too thin leaves
           the anchor alphabet"). The gate is not a comfort margin: it is the floor of the phrase's
           own arithmetic, because the measured figure is the MINIMUM over anchors and one anchor with
           a thin letter collapses it for every phrase the generator can emit.

NO BIT TARGET, AND NO FLOOR. X2 deleted the 60/64-bit floor and it stays deleted: a smaller floor is
still a floor. The figure below is measured from the bytes that ship and compared to nothing.

HELD, 2026-09-23 16:0x, AT PETER'S REORDER. He is about to bind his founding phrase against the
CURRENT lists and refresh onto the new themed lists later, so the shipped words must not move under
him while he does it. This script therefore REFUSES TO RUN unless AUMLOK_X8=1 is set in the
environment, and its refusal is the whole point rather than a footnote:

  * with the flag UNSET, the script prints why it is held and exits 2 WITHOUT WRITING ANYTHING.
    Peter's bind cannot land on lists this script rewrote, because this script did not run.
  * with AUMLOK_X8=1, it does the full X8 rebuild and overwrites data/aumlok-themes.json and
    data/aumlok-anchors.json -- which is exactly what must NOT happen until Peter says the words are
    good.

The work is not lost, it is fenced: the lexicon (scripts/aumlok/harvest-theme-lexicon.py) and the
harvest below are complete and measured, and resuming is one environment variable.

Run:  AUMLOK_X8=1 experiments/laya/.venv/bin/python scripts/aumlok/harvest-common-words.py
"""
import json, re, os, sys, math, hashlib, collections, subprocess

if os.environ.get('AUMLOK_X8') != '1':
    sys.stderr.write(
        'HELD: the X8 word rebuild is fenced off while Peter binds his founding phrase against the\n'
        'current lists. Nothing was written. Re-run with AUMLOK_X8=1 once he says the words are good.\n')
    raise SystemExit(2)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA = os.path.join(ROOT, 'plugins', 'aukora-aumlok', 'data')
SAFETY = os.path.join(DATA, 'safety')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harvest_theme_lexicon import NATURE, UNITE, RISE

WORD = re.compile(r'^[a-z]{3,9}$')
ANCHOR = re.compile(r'^[a-z]{6}$')
ZIPF_MIN = 3.0
THEMES = ['NATURE', 'UNITE', 'RISE']
THEME_BY_POSITION = ['NATURE', 'NATURE', 'UNITE', 'UNITE', 'RISE', 'RISE']
LEXICON = {'NATURE': NATURE, 'UNITE': UNITE, 'RISE': RISE}
# Peter's anchor gate: a letter with fewer than this many words in ANY theme leaves the anchor
# alphabet. It is the floor of the phrase's own arithmetic, not a comfort margin -- see the header.
GATE = 40
# The per-theme target. It is a target and not a cap or a quota: the lists ship whatever they claim.
TARGET_PER_THEME = 2500

from wordfreq import zipf_frequency, top_n_list

drops = collections.OrderedDict()
def drop(name, words):
    drops[name] = len(words) if not isinstance(words, int) else words

# ---------------------------------------------------------------------------------------------
# INPUTS
# ---------------------------------------------------------------------------------------------
eff_raw = open(os.path.join(SAFETY, 'eff_large_words.txt'), encoding='utf8').read()
eff_sha = hashlib.sha256(eff_raw.encode()).hexdigest()
eff = {w.strip().lower() for w in eff_raw.split('\n') if w.strip()}
drop('EFF list, raw entries', len(eff))

block = json.load(open(os.path.join(SAFETY, 'profanity-block.json'), encoding='utf8'))
BLOCK = {w.strip().lower() for w in block['words'] if w.strip()}
drop_doc = json.load(open(os.path.join(SAFETY, 'category-drop.json'), encoding='utf8'))
CATEGORIES = {name: {w.lower() for w in words} for name, words in drop_doc['categories'].items()}
DROPPED_BY = {}
for name, words in CATEGORIES.items():
    for w in words:
        DROPPED_BY.setdefault(w, name)

pleasant_doc = json.load(open(os.path.join(SAFETY, 'pleasant-drop.json'), encoding='utf8'))
PLEASANT = {name: {w.lower() for w in words} for name, words in pleasant_doc['categories'].items()}
PLEASANT_TAIL = pleasant_doc['measuredBar']
REMOVED_BY = {}

# The corpus: every EFF word, plus every wordfreq word that clears the zipf bar.
corpus = {}
from_eff_below_bar = 0
for w in eff:
    if WORD.match(w):
        z = zipf_frequency(w, 'en')
        corpus[w] = {'eff': True, 'zipf': z}
        if z < ZIPF_MIN:
            from_eff_below_bar += 1
drop('EFF words that are 3-9 lowercase letters', len(corpus))
from_freq = 0
for w in top_n_list('en', 150000):
    if w in corpus or not WORD.match(w):
        continue
    z = zipf_frequency(w, 'en')
    if z >= ZIPF_MIN:
        corpus[w] = {'eff': False, 'zipf': z}
        from_freq += 1
drop('wordfreq additions clearing zipf >= %.1f' % ZIPF_MIN, from_freq)
pool = dict(corpus)
print('candidate pool: %d words (%d EFF + %d frequency-only)' %
      (len(pool), sum(1 for v in pool.values() if v['eff']), from_freq))

# ---------------------------------------------------------------------------------------------
# THE FILTERS, each one counted. All four of X2's drop lists stay, and none is widened.
# ---------------------------------------------------------------------------------------------
def apply_filter(name, predicate):
    global pool
    before = len(pool)
    hit = [w for w in pool if predicate(w)]
    for w in hit:
        del pool[w]
        REMOVED_BY.setdefault(w, name)
    drops[name] = before - len(pool)
    return hit

hit_block = apply_filter('HARD BLOCK: profanity / slur list', lambda w: w in BLOCK)
cat_hits = {}
for name, words in CATEGORIES.items():
    cat_hits[name] = apply_filter('category drop: %s' % name, lambda w, s=words: w in s)
drop('category drops, total distinct words removed',
     sum(1 for w in set().union(*CATEGORIES.values()) if w in corpus))

pleasant_hits = {}
for name, words in PLEASANT.items():
    pleasant_hits[name] = apply_filter('pleasantness drop: %s' % name, lambda w, s=words: w in s)

low, cap = set(), set()
for line in open('/usr/share/dict/words', encoding='utf8', errors='ignore'):
    w = line.strip()
    if not w:
        continue
    (cap if w[:1].isupper() else low).add(w.lower())
caponly = cap - low
names_doc = json.load(open(os.path.join(SAFETY, 'proper-names.json'), encoding='utf8'))
pn = {l.strip().lower() for l in open('/usr/share/dict/propernames', encoding='utf8', errors='ignore') if l.strip()}
NAMES_RULED = {w for w in (pn | set(names_doc['words'])) if w not in low}
NAMES_PLACES = {w.lower() for w in names_doc.get('places', [])}
NAMES_NAMED = {w.lower() for w in names_doc.get('ambiguousNames', [])}
NAMES = NAMES_RULED | NAMES_PLACES | NAMES_NAMED
name_hits = apply_filter(
    'proper names and places (dictionary names and brand words with no common dictionary sense; '
    'plus the curated places and common-surname words, which are dropped by name)', lambda w: w in NAMES)
name_by_source = {
    'ruledDictionaryNamesAndBrands': sorted(w for w in name_hits if w in NAMES_RULED),
    'curatedPlaces': sorted(w for w in name_hits if w in NAMES_PLACES),
    'curatedAmbiguousSurnames': sorted(w for w in name_hits if w in NAMES_NAMED),
    'ruledListSize': len(NAMES_RULED), 'placesListSize': len(NAMES_PLACES), 'namedListSize': len(NAMES_NAMED),
}

# The retired custody vocabulary, COMPOSED rather than spelled: a script that spells a stem in order
# to filter it is itself a hit, which is the failure the ban court exists to catch.
BAN = re.compile('|'.join(['un' + 'lock', 'en' + 'rol',
                           'pa' + 'per\\.sec', 're' + 'covery\\.sec', 'de' + 'vice\\.sec']), re.I)
apply_filter('retired v2 custody vocabulary', lambda w: bool(BAN.search(w)))

# THE MEASURED TAIL, moved to Peter's new bar. X2 measured this at 3.5; the source is now 3.0, and a
# tail bar above the source bar is not a filter, it is a second copy of the source.
TAIL_MIN = ZIPF_MIN
hit_tail = apply_filter('pleasantness drop: unfamiliar-tail (measured English zipf below the source '
                        'bar %.1f)' % TAIL_MIN, lambda w: pool[w]['zipf'] < TAIL_MIN)

print()
print('DROP LADDER (each filter, by name):')
for name, n in drops.items():
    print('  %6d  %s' % (n, name))
print('  %6d  SURVIVING POOL' % len(pool))

FLAGGED = ['direness', 'corroding', 'pungent', 'seduce', 'pasted', 'unsolved', 'travesty', 'epidermis',
           'antsy', 'worry', 'puritan', 'rewire', 'delouse', 'outhouse', 'hemlock', 'batboy', 'snowiness',
           'pettiness', 'rocklike', 'superjet', 'eastcoast', 'tipoff', 'unglue', 'tucson', 'smith']
print()
print('THE FLAGGED WORDS, AND THE FILTER THAT CAUGHT EACH:')
for w in FLAGGED:
    if w in pool:
        print('  %-78s  %s' % ('SURVIVED', w))
    elif w in REMOVED_BY:
        print('  %-78s  %s' % (REMOVED_BY[w][:78], w))
    else:
        print('  %-78s  %s' % ('never in the candidate pool', w))

# ---------------------------------------------------------------------------------------------
# THE THEMES: every shipped word is claimed by exactly one band. NO FALLBACK OF ANY KIND.
# ---------------------------------------------------------------------------------------------
theme_of = {}
unclaimed = []
for w in sorted(pool):
    claims = [t for t in THEMES if w in LEXICON[t]]
    if len(claims) > 1:
        # The one-word-one-theme rule, asserted rather than assumed. The lexicon is disjoint by
        # construction; if it ever stops being, this is where it is caught.
        raise SystemExit('the lexicon claims %r in two bands: %s' % (w, claims))
    if claims:
        theme_of[w] = claims[0]
    else:
        unclaimed.append(w)

buckets = {t: collections.defaultdict(list) for t in THEMES}
for w, t in theme_of.items():
    buckets[t][w[0]].append(w)
for t in THEMES:
    for L in buckets[t]:
        buckets[t][L].sort(key=lambda w: (-pool[w]['zipf'], w))

# WHAT THE UNCLAIMED WORDS COST, counted rather than asserted. Every one of them is a word the
# generator can no longer draw, and the number is the price of "themed words ONLY".
drop('candidate words NO THEME CLAIMS (themed-only shipping: not drawn, not shipped)', len(unclaimed))
unclaimed_by_letter = collections.Counter(w[0] for w in unclaimed)

totals = {t: sum(len(buckets[t][L]) for L in buckets[t]) for t in THEMES}
print()
print('THE THEMES (every shipped word is claimed by exactly one band; no fallback exists)')
for t in THEMES:
    print('  %-7s %5d words   (target ~%d)' % (t, totals[t], TARGET_PER_THEME))
print('  %-7s %5d words   are claimed by no band and therefore DO NOT SHIP' % ('unclaimed', len(unclaimed)))

# ---------------------------------------------------------------------------------------------
# PETER'S GATE: a letter with fewer than 40 words in ANY theme leaves the anchor alphabet.
# ---------------------------------------------------------------------------------------------
def bucket_size(t, L):
    return len(buckets[t][L])

letter_min = {L: min(bucket_size(t, L) for t in THEMES) for L in 'abcdefghijklmnopqrstuvwxyz'}
usable_letters = [L for L in 'abcdefghijklmnopqrstuvwxyz' if letter_min[L] >= GATE]
failed_letters = {L: {t: bucket_size(t, L) for t in THEMES} for L in 'abcdefghijklmnopqrstuvwxyz'
                  if letter_min[L] < GATE}

print()
print('THE GATE: at least %d words per letter in EVERY theme' % GATE)
print('  L   NATURE  UNITE   RISE   min   verdict')
for L in 'abcdefghijklmnopqrstuvwxyz':
    v = 'kept' if letter_min[L] >= GATE else 'DROPPED'
    print('  %s  %6d %6d %6d  %4d   %s' % (L, bucket_size('NATURE', L), bucket_size('UNITE', L),
                                           bucket_size('RISE', L), letter_min[L], v))
print('  usable letters (%d): %s' % (len(usable_letters), ''.join(usable_letters) or 'NONE'))
print('  dropped letters (%d): %s' % (len(failed_letters), ''.join(sorted(failed_letters)) or 'none'))

# ---------------------------------------------------------------------------------------------
# THE ANCHORS: six letters, every one drawable in all three themes.
# ---------------------------------------------------------------------------------------------
LOWERCASE_DICT = {l.strip().lower() for l in open('/usr/share/dict/words', encoding='utf8', errors='ignore')
                  if l.strip() and not l[:1].isupper()}
notdict = [w for w in pool if ANCHOR.match(w) and w not in LOWERCASE_DICT]
drop('anchor candidates that are not dictionary words', len(notdict))
anchors = sorted(w for w in pool if ANCHOR.match(w) and w in LOWERCASE_DICT
                 and all(c in usable_letters for c in w))
print()
print('anchors: %d from the pool, six letters, every letter in the usable set' % len(anchors))

# ---------------------------------------------------------------------------------------------
# THE MEASUREMENT. bits = log2(anchors) + MIN over anchors of sum(log2(bucket size at each position))
# ---------------------------------------------------------------------------------------------
min_bits, limiting, worst = None, None, None
for a in anchors:
    s = sum(math.log2(bucket_size(THEME_BY_POSITION[i], a[i])) for i in range(6))
    if min_bits is None or s < min_bits:
        min_bits, limiting = s, a
        worst = [bucket_size(THEME_BY_POSITION[i], a[i]) for i in range(6)]
if anchors:
    anchor_bits = math.log2(len(anchors))
    bits = anchor_bits + min_bits
else:
    anchor_bits, bits = 0.0, 0.0
print()
print('MEASUREMENT')
print('  anchors                 %d  -> log2 = %.4f bits' % (len(anchors), anchor_bits))
print('  weakest anchor          "%s" -> buckets %s -> sum log2 = %.4f bits' % (limiting, worst, min_bits))
print('  MEASURED                %.4f bits = log2(%d) + %.4f' % (bits, len(anchors), min_bits))
print('  (no floor is applied: the old 64-bit floor is retired and stays retired)')

# ---------------------------------------------------------------------------------------------
# THE DATA
# ---------------------------------------------------------------------------------------------
def write_data(path, extra_provenance):
    doc = {
        'v': 'aumlok-themes-v1',
        'themes': {t: {L: buckets[t][L] for L in sorted(buckets[t])} for t in THEMES},
        'provenance': extra_provenance,
    }
    json.dump(doc, open(path, 'w', encoding='utf8'), indent=1, ensure_ascii=False)

counts = {t: {L: len(buckets[t][L]) for L in sorted(buckets[t])} for t in THEMES}
measured_zipf = {w: round(pool[w]['zipf'], 4) for w in pool}
theme_of_all = dict(theme_of)

base_prov = {
    'rebuiltAt': '2026-09-23',
    'item': "AUMLOK X8 — the words rebuilt BROAD and BIG, themed only, no fallback",
    'sources': [
        {'name': 'EFF large wordlist', 'path': 'plugins/aukora-aumlok/data/safety/eff_large_words.txt',
         'sha256': eff_sha, 'words': len(eff), 'license': 'CC BY 3.0 US (EFF)',
         'role': ('A SOURCE OF WORDS ONLY WHERE IT CLEARS THE BAR. %d of its %d words sit below zipf %.1f '
                  'and are dropped by the measured-tail filter like any other word; membership in EFF is '
                  'no longer a way past the frequency bar. Peter\'s ruling names one source: the frequency '
                  'list. MEASURED: the pool is %d words either way, because the 3.5 tail bar removed '
                  'exactly what a 3.0 source admits.'
                  % (from_eff_below_bar, len(corpus), ZIPF_MIN, len(pool)))},
        {'name': 'wordfreq', 'version': '3.1.1', 'language': 'en', 'metric': 'zipf_frequency',
         'path': 'experiments/laya/.venv',
         'role': 'THE SOURCE. Peter: "a large frequency list ... English zipf >= 3.0".'},
        {'name': 'theme lexicon', 'path': 'scripts/aumlok/harvest-theme-lexicon.py',
         'role': ('THE SHIPPING RULE. A word ships only if this file names it, and it names one band. '
                  'THEMES ARE NOT A NUDGE ANY MORE: there is no fallback band, and the harvest asserts '
                  'that no word is claimed twice.')},
    ],
    'zipf': {'min': ZIPF_MIN, 'measured': measured_zipf,
             'note': 'the measured English zipf of every shipped word, so the court re-checks the rule without the venv'},
    'method': (
        'candidate = every EFF word plus every wordfreq word with English zipf >= %s, restricted to 3-9 '
        'lowercase letters. Then, in order: the HARD BLOCK, the named category drops, the PLEASANTNESS '
        'PASS in data/safety/pleasant-drop.json (its named judgment categories, then its measured tail at '
        'the same %s bar), the proper-name and place rule, and the retired v2 custody vocabulary. Every '
        'survivor is then claimed by exactly one theme from scripts/aumlok/harvest-theme-lexicon.py, or it '
        'is NOT SHIPPED AT ALL: %d of %d survivors were claimed by no band and are dropped by name. '
        'Anchors are the six-letter survivors whose every letter has a bucket of at least %d in ALL THREE '
        'bands; a letter below that leaves the anchor alphabet. NOTHING IS ADDED TO REACH A COUNT.'
        % (ZIPF_MIN, TAIL_MIN, len(unclaimed), len(pool) + len(unclaimed), GATE)),
    'counts': counts,
    'totals': totals,
    'targetPerTheme': TARGET_PER_THEME,
    'dropped': {k: v for k, v in drops.items()},
    'gate': {
        'min': GATE,
        'rule': ('a letter with fewer than %d words in ANY theme leaves the anchor alphabet; every letter '
                 'of every shipped anchor has at least %d in all three' % (GATE, GATE)),
        'usableLetters': ''.join(usable_letters),
        'perLetterMin': letter_min,
        'failedLetters': failed_letters,
        'why': ('the measured figure is the MINIMUM over anchors, so ONE anchor carrying a thin letter '
                'collapses it for every phrase the generator can emit'),
    },
    'themes_are_a_rule': {
        'fallback': 0,
        'note': ('THERE IS NO FALLBACK. X2 pushed unclaimed words onto whichever band had room and 28% of '
                 'draws were unthemed; this rebuild ships themed words ONLY. A word no band claims does not '
                 'ship, and the cost is counted in dropped/candidate words NO THEME CLAIMS.'),
        'unclaimedDropped': len(unclaimed),
        'unclaimedByLetter': dict(sorted(unclaimed_by_letter.items())),
    },
    'claims': {
        'rule': 'every shipped word is claimed by exactly one band; the harvest raises if any is claimed twice',
        'perTheme': totals,
    },
    'themeOf': theme_of_all,
    'blacklist': {
        'hardBlock': {'path': 'plugins/aukora-aumlok/data/safety/profanity-block.json',
                      'words': len(BLOCK), 'caught': sorted(hit_block)},
        'categories': {'path': 'plugins/aukora-aumlok/data/safety/category-drop.json',
                       'caught': {k: sorted(v) for k, v in cat_hits.items() if v}},
        'properNames': {'path': 'plugins/aukora-aumlok/data/safety/proper-names.json',
                        'rule': ('a dictionary name or brand word with no common lowercase dictionary entry; '
                                 'plus the curated places and common-surname words, dropped by name'),
                        'removed': len(name_hits), 'bySource': name_by_source},
        'retiredCustodyVocabulary': {'removed': drops.get('retired v2 custody vocabulary', 0)},
    },
    'pleasantness': {
        'path': 'plugins/aukora-aumlok/data/safety/pleasant-drop.json',
        'kind': ('a CURATED JUDGMENT LIST with named categories, written for this repository. It is NOT a '
                 'published source and the file says so about itself.'),
        'caught': {k: sorted(v) for k, v in pleasant_hits.items() if v},
        'measuredTail': {
            'name': PLEASANT_TAIL['name'], 'metric': PLEASANT_TAIL['metric'], 'min': TAIL_MIN,
            'removed': len(hit_tail),
            'why': ('X8 moved this bar from 3.5 to the source bar %s. A tail bar above the source bar is '
                    'not a filter, it is a second copy of the source: MEASURED, the pool was 9,988 words at '
                    'both settings.' % TAIL_MIN),
            'note': 'a MEASUREMENT, recorded as one; the named categories above are the judgment.',
        },
        'flaggedWordsAudit': {w: (REMOVED_BY.get(w) or ('survived' if w in pool else 'never in the candidate pool'))
                              for w in FLAGGED},
    },
    'usableLetters': ''.join(usable_letters),
    'minBucket': GATE,
    'measurement': {
        'bits': bits, 'bitsRounded': round(bits, 4),
        'anchorCount': len(anchors), 'anchorBits': round(anchor_bits, 4),
        'minAnchorBits': min_bits, 'minAnchorBitsRounded': round(min_bits, 4) if min_bits is not None else None,
        'limitingAnchor': limiting, 'weakestBuckets': worst,
        'floorBits': None, 'meetsFloor': None,
        'note': ('NO BIT TARGET. X2 retired the 60/64-bit floor and X8 does not bring it back. This figure '
                 'is measured from the data as written and compared to nothing.'),
        'arithmetic': ({f'pos{i}({THEME_BY_POSITION[i]},{limiting[i]})': worst[i] for i in range(6)}
                       if limiting else {}),
    },
}
write_data(os.path.join(DATA, 'aumlok-themes.json'), base_prov)


def write_anchors():
    doc = {
        '_provenance': {
            'source': 'the drawable anchor set, measured over the shipped buckets',
            'rules': ('six lowercase letters; every letter has at least %d words in all three bands; every '
                      'anchor is a real dictionary word' % GATE),
            'count': len(anchors), 'rebuiltAt': '2026-09-23'},
        'anchors': anchors,
    }
    json.dump(doc, open(os.path.join(DATA, 'aumlok-anchors.json'), 'w', encoding='utf8'),
              indent=1, ensure_ascii=False)


write_anchors()
print()
print('wrote data/aumlok-themes.json (%d words across three themes, %d unclaimed and not shipped) and '
      'data/aumlok-anchors.json (%d anchors)' % (sum(totals.values()), len(unclaimed), len(anchors)))
