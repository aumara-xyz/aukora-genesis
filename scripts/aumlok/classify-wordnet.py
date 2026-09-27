#!/usr/bin/env python3
"""Classify the net into EARTH / PEOPLE / ABOVE using WORDNET, by the rule in AUMLOK-WORDS-FOR-PETER.md §3b.

    python3 scripts/aumlok/classify-wordnet.py --themes /tmp/themes-new.json --out /tmp/themes-wn.json

WHY WORDNET AND NOT A WORD LIST. The first attempt matched a word to a theme only when it shared a
four-character prefix with a hand-written seed — `star` captured `stars` and `starry` and nothing else. It
assigned **592 of 27,058 words and dropped 98% of them**, which is not a broad classification, it is a
spelling test. Breadth has to come from MEANING, so this reads the WordNet database on this machine
(`/private/tmp/pp/wn/wordnet`, WordNet 3.0, plain text) and classifies a word by what its own definitions
and its ancestors' definitions SAY.

THE RULE, AND IT IS THE WRITTEN ONE. A word joins a theme when it plausibly relates to that theme in
Peter's three broad senses. The evidence for every assignment is a closed path in WordNet: the word's
synset, or one of its hypernyms up to a bounded depth, has a gloss containing one of the theme's seed
words. `ocean` is EARTH because its gloss is a body of water and its ancestor is a body of water;
`star` is ABOVE because its own gloss is a celestial body; `uncle` is PEOPLE because its gloss is a
kinsman. A word whose whole ancestry says nothing about any of the three is DROPPED rather than forced.

Two guards from Peter's answer hold here: a word MAY join more than one theme (the themes are broad, not
strict), and NO WORD IS ASSIGNED TO FILL A BUCKET — the letter choice belongs to the measurement, not here.

SAFETY IS APPLIED BEFORE CLASSIFICATION and is never traded for bits.
"""
import argparse, collections, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'plugins' / 'aukora-aumlok' / 'data'
SAFETY = DATA / 'safety'
WORDNET = Path('/private/tmp/pp/wn/wordnet')
ZIPF_FLOOR = 2.8
TOP_N = 200_000
SHAPE = re.compile(r'^[a-z]{4,9}$')
MAX_DEPTH = 1   # THE WORD'S OWN GLOSS, PLUS ITS DIRECT HYPERNYMS' GLOSSES AND NO FURTHER.

# WHY DEPTH 8 WAS WRONG, MEASURED RATHER THAN ARGUED. At depth 8 the walk reached ancestors so generic
# that their glosses mention words from every theme, so `ugandan` landed in ALL THREE themes, `wacky` landed
# in ABOVE, and the three buckets became nearly the same list. The figure that produced (57.399 bits) was
# green for the wrong reason, which is worse than the 34.14 it replaced. Depth 1 says what the rule says:
# a word belongs to a theme when ITS OWN definition, or the definition of what it directly IS, speaks of
# that theme.

# GENERIC WORDS ARE NOT EVIDENCE. `person` is a PEOPLE word and also the ancestor of every human noun, and
# `time`, `all`, `one`, `part`, `thing` sit in the ancestry of half the language. A definition that says
# only "a kind of thing" says nothing about EARTH, PEOPLE or ABOVE, so the generic vocabulary is removed
# from the EVIDENCE sets while staying available as shipped words.

from importlib.machinery import SourceFileLoader
_builder = SourceFileLoader('builder', str(Path(__file__).with_name('build-entropy-lists.py'))).load_module()
SEEDS = _builder.SEEDS


def read_index(kind):
    """lemma -> [synset offsets], from `index.<kind>` (the header is 29 comment lines)."""
    out = collections.defaultdict(list)
    for line in (WORDNET / f'index.{kind}').read_text(encoding='latin-1').splitlines():
        if not line or line.startswith(' '):
            continue
        parts = line.split()
        if len(parts) < 6:
            continue
        lemma = parts[0].lower()
        for offset in parts[6:]:
            if offset.isdigit():
                out[lemma].append(offset)
    return out


def read_data(kind):
    """offset -> (gloss, [hypernym offsets]), plus the lemmas WordNet writes with a CAPITAL.

    THE CAPITAL IS THE RESOURCE'S OWN ANSWER TO "IS THIS A NAME", AND IT IS THE ONE THIS SCRIPT WAS NOT
    READING. `index.*` lowercases every lemma, so `ugandan` is indexed as a plain word and matched its way
    into all three themes; `data.*` keeps the original spelling in its word list, so the same entry reads
    `Ugandan`. A lemma that WordNet ever writes capitalised is a proper noun and is dropped. It is a
    stronger test than a name list because it comes from the database itself rather than from a list
    somebody maintained by hand.
    """
    out, capitalised = {}, set()
    for line in (WORDNET / f'data.{kind}').read_text(encoding='latin-1').splitlines():
        if not line or line.startswith(' ') or line.startswith('  '):
            continue
        head, _, gloss = line.partition('|')
        parts = head.split()
        if len(parts) < 6 or not parts[0].isdigit():
            continue
        offset, wcount = parts[0], int(parts[3], 16) * 2
        words = parts[4:4 + wcount:2]
        for word in words:
            lemma = word.split('(')[0]
            if lemma[:1].isupper():
                capitalised.add(lemma.lower())
        rest = parts[4 + wcount:]
        hypernyms = [rest[i + 1] for i, token in enumerate(rest[:-1]) if token == '@' and rest[i + 1].isdigit()]
        out[offset] = (gloss.strip(), hypernyms)
    return out, capitalised


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--themes', required=True, help='the earlier output, for the net and the safety pass')
    parser.add_argument('--out', required=True)
    parser.add_argument('--evidence', default=None)
    args = parser.parse_args()

    prior = json.loads(Path(args.themes).read_text())
    allowed = sorted({w for buckets in prior['themes'].values() for words in buckets.values() for w in words}
                     | {w for w in []})
    # The earlier run only wrote ASSIGNED words, so rebuild the allowed net the same way it did.
    forbidden, proper = _builder.load_safety()
    pool, _ = _builder.candidates()
    allowed = [w for w in pool if w not in forbidden and w not in proper]
    print(f'net {len(pool)}, after safety {len(allowed)}')

    indexes = {kind: read_index(kind) for kind in ('noun', 'verb', 'adj', 'adv')}
    parsed = {kind: read_data(kind) for kind in ('noun', 'verb', 'adj', 'adv')}
    datas = {kind: value[0] for kind, value in parsed.items()}
    names = set().union(*(value[1] for value in parsed.values()))
    print('wordnet: ' + ', '.join(f'{k} {len(datas[k])}' for k in datas)
          + f' | lemmas WordNet writes capitalised (names): {len(names)}')
    # THE PROPERTY, APPLIED TO THE NET BEFORE ANY THEME SEES IT.
    before = len(allowed)
    allowed = [w for w in allowed if w not in names]
    print(f'proper nouns dropped from the net: {before - len(allowed)}')

    # Theme words as whole tokens, so `sea` does not fire on `season` and `art` does not fire on `earth`,
    # and with the generic vocabulary removed so a definition mentioning only `thing` proves nothing.
    GENERIC = {
        'all', 'one', 'any', 'thing', 'things', 'someone', 'something', 'person', 'people', 'human',
        'act', 'action', 'activity', 'state', 'event', 'group', 'part', 'kind', 'sort', 'way', 'ways',
        'make', 'made', 'have', 'has', 'use', 'used', 'using', 'being', 'form', 'type', 'class',
        'time', 'times', 'day', 'days', 'year', 'years', 'place', 'places', 'area', 'areas', 'unit',
        'good', 'bad', 'large', 'small', 'great', 'little', 'more', 'most', 'less', 'least', 'very',
        'number', 'amount', 'level', 'degree', 'point', 'line', 'order', 'measure', 'weight', 'scale',
    }
    theme_words = {theme: {w for w in words if len(w) >= 4 and w not in GENERIC}
                   for theme, words in SEEDS.items()}
    token = re.compile(r"[a-z']+")

    hits_cache = {}

    def synset_themes(kind, offset, depth=0):
        """Which themes this synset's own gloss, or an ancestor's, speaks of."""
        key = (kind, offset)
        if key in hits_cache:
            return hits_cache[key]
        hits_cache[key] = set()  # cycle guard: a synset being visited contributes nothing until it is done
        gloss, hypernyms = datas[kind].get(offset, ('', []))
        tokens = set(token.findall(gloss.lower()))
        found = {theme for theme, words in theme_words.items() if tokens & words}
        if depth < MAX_DEPTH:
            for parent in hypernyms:
                found |= synset_themes(kind, parent, depth + 1)
        hits_cache[key] = found
        return found

    themes = {theme: collections.defaultdict(list) for theme in SEEDS}
    evidence = {theme: {} for theme in SEEDS}
    unassigned = 0
    for word in allowed:
        joined = set()
        why = {}
        for kind, index in indexes.items():
            for offset in index.get(word, []):
                gloss, _ = datas[kind].get(offset, ('', []))
                for theme in synset_themes(kind, offset):
                    joined.add(theme)
                    why.setdefault(theme, f'{kind}: {gloss[:90]}')
        if not joined:
            unassigned += 1
            continue
        for theme in joined:
            themes[theme][word[0]].append(word)
            evidence[theme][word] = why.get(theme, '')

    doc = {
        'v': 'aumlok-themes-v1',
        'themes': {theme: {letter: sorted(words) for letter, words in buckets.items()}
                   for theme, buckets in themes.items()},
        'provenance': {
            'source': f'wordfreq top_n_list(en, {TOP_N}) with zipf >= {ZIPF_FLOOR}, unioned with the EFF large wordlist',
            'classification': 'WordNet 3.0 hypernym chains and glosses (/private/tmp/pp/wn/wordnet), depth 8',
            'rule': 'AUMLOK-WORDS-FOR-PETER.md 3b: a word joins a theme when its own definition or an ancestor definition speaks of that theme; a word relating to none is dropped',
            'safety': 'profanity-block, category-drop, pleasant-drop and proper-names applied before any theme',
            'net': len(pool), 'shipped': len(allowed), 'droppedBySafety': len(pool) - len(allowed),
            'assigned': sum(len(v) for t in themes.values() for v in t.values()),
            'unassigned': unassigned,
        },
    }
    Path(args.out).write_text(json.dumps(doc, indent=0, sort_keys=True) + '\n')
    for theme in SEEDS:
        sizes = sorted(len(v) for v in themes[theme].values())
        print(f'{theme}: {sum(sizes)} words over {len(sizes)} letters, min bucket {sizes[0]}, median {sizes[len(sizes)//2]}')
    print(f'unassigned (dropped, not forced): {unassigned}')
    if args.evidence:
        Path(args.evidence).write_text(json.dumps(evidence, indent=1, sort_keys=True) + '\n')


if __name__ == '__main__':
    sys.exit(main())
