#!/usr/bin/env python3
"""Rebuild the shipped Aumlok themes as maximal themed pools.

    python3 scripts/aumlok/build-maximal-themes.py

Three themes stay: NATURE, PEOPLE, SPIRIT. Heads live in maximal-theme-heads.py.
A word ships when it is a head, or a closed inflection of a head of at least five
letters that already appears in the EFF list. Quality filters remove it even then.

Entropy is not computed here. scripts/aumlok/seal-anchors.mjs measures the pools
and writes the anchor list the drawer actually uses.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

from maximal_theme_heads import EXTRA, NATURE, PEOPLE, SPIRIT

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'plugins' / 'aukora-aumlok' / 'data'
SAFETY = DATA / 'safety'
SHAPE = re.compile(r'^[a-z]{4,9}$')
ANCHOR = re.compile(r'^[a-z]{6}$')
MIN_STEM = 5
SUFFIXES = ('s', 'es', 'ed', 'ing', 'er', 'ers', 'ly')
THEMES = ('NATURE', 'PEOPLE', 'SPIRIT')
HEADS = {
    'NATURE': NATURE + EXTRA['NATURE'].split(),
    'PEOPLE': PEOPLE + EXTRA['PEOPLE'].split(),
    'SPIRIT': SPIRIT + EXTRA['SPIRIT'].split(),
}

# Closed class and filler. A theme head that is also one of these is a bug.
FUNCTION = set("""
about after again also although always among another anybody anyhow anyone
anything anyway anyways around because before being both could every
everyone everything from have having into just many more most much must
never nothing other over same shall should since some someone something
still such than that their them then there these they this those through
under until upon very were what when where which while will with within
without would your
""".split())


def load_words(path):
    doc = json.loads(path.read_text(encoding='utf8'))
    if isinstance(doc, dict) and 'words' in doc and isinstance(doc['words'], list):
        return {str(w).lower() for w in doc['words']}
    if isinstance(doc, dict) and 'categories' in doc:
        out = set()
        for words in doc['categories'].values():
            out.update(str(w).lower() for w in words)
        return out
    return set()


def load_forbidden():
    forbidden = set()
    forbidden |= load_words(SAFETY / 'profanity-block.json')
    drop = json.loads((SAFETY / 'category-drop.json').read_text(encoding='utf8'))
    # slang mixes function words with ordinary theme words (apple, laptop).
    # category dreary deletes the living ground and the sky (dune, dusk, snake, spider).
    # Harm categories stay. Pleasantness dreary stays; it is the tone list.
    for name, words in drop['categories'].items():
        if name in ('slang', 'dreary'):
            continue
        forbidden.update(str(w).lower() for w in words)
    pleasant = json.loads((SAFETY / 'pleasant-drop.json').read_text(encoding='utf8'))
    for words in pleasant['categories'].values():
        forbidden.update(str(w).lower() for w in words)
    names = json.loads((SAFETY / 'proper-names.json').read_text(encoding='utf8'))
    for key in ('words', 'places', 'ambiguousNames'):
        forbidden.update(str(w).lower() for w in names.get(key, []))
    forbidden |= FUNCTION
    return forbidden


def check_heads():
    seen = {}
    for theme, words in HEADS.items():
        for word in words:
            if not SHAPE.match(word):
                raise SystemExit(f'head {word!r} in {theme} is not 4-9 lowercase letters')
            if word in seen:
                raise SystemExit(f'head {word!r} is in {seen[word]} and {theme}')
            seen[word] = theme
    return seen


def inflection_theme(word, heads):
    best = None
    for head, theme in heads.items():
        if len(head) < MIN_STEM or not word.startswith(head) or word == head:
            continue
        if word[len(head):] not in SUFFIXES:
            continue
        if best is None or len(head) > best[0]:
            best = (len(head), theme, head)
    return None if best is None else best[1]


def main():
    heads = check_heads()
    forbidden = load_forbidden()
    eff = {line.strip().lower() for line in (SAFETY / 'eff_large_words.txt').read_text(encoding='utf8').splitlines() if line.strip()}
    candidates = set(heads) | {w for w in eff if SHAPE.match(w)}
    buckets = {theme: defaultdict(list) for theme in THEMES}
    dropped_filter = []
    dropped_unthemed = 0
    shipped_heads = 0
    shipped_inflections = 0
    for word in sorted(candidates):
        if not SHAPE.match(word):
            continue
        theme = heads.get(word)
        via = 'head'
        if theme is None:
            theme = inflection_theme(word, heads)
            via = 'inflection'
        if theme is None:
            dropped_unthemed += 1
            continue
        if word in forbidden:
            dropped_filter.append(word)
            continue
        buckets[theme][word[0]].append(word)
        if via == 'head':
            shipped_heads += 1
        else:
            shipped_inflections += 1

    themes = {theme: {letter: words for letter, words in sorted(buckets[theme].items())} for theme in THEMES}
    totals = {theme: sum(len(v) for v in themes[theme].values()) for theme in THEMES}
    # Anchor candidates are common six-letter words that pass the same filters.
    # seal-anchors.mjs keeps only the letters the pool math actually draws.
    anchors = sorted(w for w in candidates if ANCHOR.match(w) and w not in forbidden)
    doc = {
        'v': 'aumlok-themes-v2',
        'themes': themes,
        'provenance': {
            'item': 'maximal themed pools; themes kept; Peter broad reading',
            'themes': {
                'NATURE': 'flowers, animals, dirt, earth, fruit, and the living ground',
                'PEOPLE': 'human interaction, parties, cars, and other human-made things',
                'SPIRIT': 'sky, space, technology, and rising-above',
            },
            'acrostic': 'seven words; word 0 is a 6-letter anchor; words 1-2 NATURE, 3-4 PEOPLE, 5-6 SPIRIT; each themed word starts with the anchor letter at that position',
            'rule': 'a word ships only as a placed head, or as a closed inflection (s, es, ed, ing, er, ers, ly) of a head of at least 5 letters that is already in the EFF list',
            'quality': 'profanity block, harm categories, pleasantness drops, proper names, places, surnames, and a closed function-word list',
            'notApplied': 'category slang (mis-filed: apple, laptop) and category dreary (deletes dune, dusk, snake, spider). Pleasantness dreary still applies',
            'entropy': {
                'kind': 'pool-math',
                'not256': True,
                'role': 'local-story-memorability',
                'formula': 'log2(anchors) + min over anchors of sum log2(bucket size at each of the six positions)',
            },
            'counts': {theme: {letter: len(words) for letter, words in themes[theme].items()} for theme in THEMES},
            'totals': totals,
            'shippedHeads': shipped_heads,
            'shippedInflections': shipped_inflections,
            'droppedByQuality': sorted(dropped_filter),
            'unthemedNotShipped': dropped_unthemed,
        },
    }
    (DATA / 'aumlok-themes.json').write_text(json.dumps(doc, indent=1, ensure_ascii=False) + '\n', encoding='utf8')
    anchor_doc = {
        '_provenance': {
            'source': 'six-letter candidates that pass the same quality filters; seal-anchors.mjs keeps the drawable set',
            'role': 'local story memorability; entropy is pool math, not 256 bits',
        },
        'anchors': anchors,
    }
    (DATA / 'aumlok-anchors.json').write_text(json.dumps(anchor_doc, indent=1, ensure_ascii=False) + '\n', encoding='utf8')
    print('totals', totals, 'heads', shipped_heads, 'inflections', shipped_inflections)
    print('dropped by quality', len(dropped_filter))
    if dropped_filter:
        print(' '.join(dropped_filter))
    print('anchor candidates', len(anchors))
    print('letter mins (nature people spirit)')
    for letter in 'abcdefghijklmnopqrstuvwxyz':
        counts = [len(themes[theme].get(letter, [])) for theme in THEMES]
        print(f'  {letter}  {counts[0]:4d} {counts[1]:4d} {counts[2]:4d}  min {min(counts)}')


if __name__ == '__main__':
    main()
