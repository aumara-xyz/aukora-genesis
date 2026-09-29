#!/usr/bin/env python3
"""Build the ceremony theme pools from the maximal lexicons already in this repo.

    python3 scripts/aumlok/build-maximal-themes.py

Reads theme-nature.json, theme-people.json and theme-spirit.json. Removes words
the safety lists name. Fruit spellings stay in NATURE and are taken out of PEOPLE.
Space, sky and technology spellings that already exist in the lexicons or the EFF
list are copied into SPIRIT. Writes aumlok-themes.json and aumlok-anchors.json.

The script does not invent words and does not fetch anything.
"""
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'plugins' / 'aukora-aumlok' / 'data'
SAFETY = DATA / 'safety'

FRUIT = {
    'apple', 'apples', 'apricot', 'apricots', 'avocado', 'avocados', 'banana', 'bananas',
    'berry', 'berries', 'blueberry', 'blueberries', 'cherry', 'cherries', 'coconut', 'coconuts',
    'cranberry', 'cranberries', 'currant', 'currants', 'fig', 'figs', 'fruit', 'fruits',
    'grape', 'grapes', 'grapefruit', 'guava', 'kiwi', 'kiwis', 'lemon', 'lemons', 'lime', 'limes',
    'mango', 'mangos', 'mangoes', 'melon', 'melons', 'nectarine', 'nectarines', 'olive', 'olives',
    'orange', 'oranges', 'papaya', 'papayas', 'peach', 'peaches', 'pear', 'pears', 'pineapple',
    'pineapples', 'plantain', 'plantains', 'plum', 'plums', 'pomegranate', 'pomegranates',
    'quince', 'quinces', 'raspberry', 'raspberries', 'strawberry', 'strawberries', 'tangerine',
    'tangerines', 'tomato', 'tomatoes', 'watermelon', 'watermelons',
}

# Spellings Peter's spirit breadth names. Copied into SPIRIT only when the word
# already exists in a lexicon or the EFF list and survives the safety filter.
SPIRIT_BREADTH = {
    'aerial', 'aircraft', 'airplane', 'algorithm', 'antenna', 'astronaut', 'aviation', 'battery',
    'circuit', 'cloud', 'comet', 'compiler', 'computer', 'cosmos', 'cosmic', 'database', 'digital',
    'diode', 'engine', 'firmware', 'galaxy', 'horizon', 'internet', 'keyboard', 'laser', 'lunar',
    'meteor', 'modem', 'monitor', 'moon', 'nebula', 'network', 'orbit', 'pixel', 'planet',
    'protocol', 'radio', 'robot', 'rocket', 'satellite', 'sensor', 'server', 'sky', 'software',
    'solar', 'spacecraft', 'spaceship', 'star', 'stellar', 'telescope', 'transistor',
}

VOWELS = set('aeiouy')


def load_block():
    """Profanity and proper names always remove. Category drops remove too, except fruit.

    `apple` sits in category-drop's slang list because of the brand. Peter's rule is that
    fruit stays Nature. Those spellings are not exempt from the profanity block or the name list.
    """
    profanity = set()
    prof = json.loads((SAFETY / 'profanity-block.json').read_text())
    for word in prof.get('words', []):
        if isinstance(word, str):
            profanity.add(word.strip().lower())
    category = set()
    cat = json.loads((SAFETY / 'category-drop.json').read_text())
    for words in cat.get('categories', {}).values():
        for word in words:
            if isinstance(word, str):
                category.add(word.strip().lower())
    names = set()
    named = json.loads((SAFETY / 'proper-names.json').read_text())
    for key in ('words', 'places', 'ambiguousNames'):
        for word in named.get(key, []):
            if isinstance(word, str):
                names.add(word.strip().lower())
    blocked = set()
    blocked |= profanity
    blocked |= names
    blocked |= {word for word in category if word not in FRUIT}
    return blocked


def pronounceable(word):
    if not any(ch in VOWELS for ch in word):
        return False
    run = 0
    for ch in word:
        if ch in VOWELS:
            run = 0
        else:
            run += 1
            if run >= 5:
                return False
    return True


def keep(word, blocked):
    return (
        isinstance(word, str)
        and word.isascii()
        and word.isalpha()
        and word == word.lower()
        and 4 <= len(word) <= 9
        and pronounceable(word)
        and word not in blocked
    )


def letter_map(path):
    doc = json.loads(path.read_text())
    if isinstance(doc.get('letters'), dict):
        raw = doc['letters']
    else:
        raw = {key: value for key, value in doc.items() if isinstance(key, str) and len(key) == 1 and isinstance(value, list)}
    out = defaultdict(set)
    for letter, words in raw.items():
        if not (isinstance(letter, str) and len(letter) == 1 and letter.isalpha()):
            continue
        for word in words:
            if isinstance(word, str):
                out[letter.lower()].add(word.strip().lower())
    return out


def main():
    blocked = load_block()
    themes = {
        'NATURE': letter_map(DATA / 'theme-nature.json'),
        'PEOPLE': letter_map(DATA / 'theme-people.json'),
        'SPIRIT': letter_map(DATA / 'theme-spirit.json'),
    }
    eff = set()
    for line in (SAFETY / 'eff_large_words.txt').read_text().splitlines():
        word = line.strip().lower()
        if word:
            eff.add(word)
    known = set(eff)
    for buckets in themes.values():
        for words in buckets.values():
            known |= words

    for letter, words in list(themes['PEOPLE'].items()):
        for word in list(words):
            if word in FRUIT:
                words.discard(word)
                themes['NATURE'][word[0]].add(word)

    for word in SPIRIT_BREADTH:
        if word in known:
            themes['SPIRIT'][word[0]].add(word)

    shipped = {}
    dropped = 0
    for theme, buckets in themes.items():
        out = {}
        for letter in sorted(buckets):
            words = sorted(word for word in buckets[letter] if keep(word, blocked))
            dropped += len(buckets[letter]) - len(words)
            if words:
                out[letter] = words
        shipped[theme] = out

    fruit_in_people = sorted(
        word for words in shipped['PEOPLE'].values() for word in words if word in FRUIT
    )
    if fruit_in_people:
        raise SystemExit(f'fruit still in PEOPLE: {fruit_in_people}')

    anchors = sorted({
        word
        for buckets in shipped.values()
        for words in buckets.values()
        for word in words
        if len(word) == 6
    })
    counts = {theme: sum(len(words) for words in buckets.values()) for theme, buckets in shipped.items()}
    doc = {
        'v': 'aumlok-themes-v2',
        'selection': 'themed-maximal-pool',
        'provenance': {
            'source': 'theme-nature.json + theme-people.json + theme-spirit.json',
            'also': 'EFF large wordlist, only for spirit breadth spellings already in that list',
            'filters': 'length 4-9, a vowel, no five consonants in a row, profanity-block, category-drop, proper-names',
            'fruit': 'fruit spellings are removed from PEOPLE and kept in NATURE, including when category-drop listed the spelling as slang',
            'spiritBreadth': 'space, sky and technology spellings already in a lexicon or the EFF list are copied into SPIRIT',
            'counts': counts,
            'anchors': len(anchors),
            'note': 'Theme groups the words. The root is scrypt of the seven words and the public handle. The phrase is not 256 bits.',
        },
        'themes': shipped,
    }
    (DATA / 'aumlok-themes.json').write_text(json.dumps(doc, indent=1, ensure_ascii=True) + '\n')
    anchor_doc = {
        '_provenance': {
            'source': 'every six-letter word in the maximal theme pools',
            'rules': 'six lowercase letters; the word is in NATURE, PEOPLE or SPIRIT after the safety filter; the letter search in measure() may still drop a letter',
            'count': len(anchors),
        },
        'anchors': anchors,
    }
    (DATA / 'aumlok-anchors.json').write_text(json.dumps(anchor_doc, indent=1, ensure_ascii=True) + '\n')
    print('themes', counts, 'candidate anchors', len(anchors), 'filtered out', dropped)


if __name__ == '__main__':
    main()
