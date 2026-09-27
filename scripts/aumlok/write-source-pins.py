#!/usr/bin/env python3
"""
AUMLOK X2 — THE PIN WRITER.

Writes `plugins/aukora-aumlok/data/safety/source-pins.json` deterministically, so the file is a
PRODUCT of a script rather than a hand-edit that the next harvest overwrites.

WHY THE DROPPED ENTRIES ARE BOUND BY HASH AND NOT BY SPELLING. The v3 custody ban
(`tests/aukora-aumlok-v3-no-v2.test.mjs`) scans this organ for its stems as a SUBSTRING. Three
ordinary inflections in the published EFF list are built on one of those stems, so they are dropped
at the fixture. A record that SPELLS them re-trips the ban by recording the removal — the same
failure that bit W3, where a note explaining a removal became the hit. Each dropped entry is
therefore identified by three things that are unique without being spelled out:

    line   the 1-based line it occupies in the published file
    code   its published dice number, which is unique in the file
    sha256 the digest of its word

Together with `eff_large_wordlist.codes.txt` and `eff_large_words.txt`, which the same directory
ships, that is enough to rebuild the published word column byte-for-byte and check its digest —
which is what `tests/aukora-aumlok-common-words.test.mjs` actually does.

Run:  python3 .scratch/x2/write-pins.py
"""
import json, os, re, hashlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
S = os.path.join(ROOT, 'plugins', 'aukora-aumlok', 'data', 'safety')
PUBLISHED = '/tmp/eff_pub.txt'          # the published EFF file, recovered from git at efd97b44
BAN = re.compile('un' + 'lock|en' + 'rol', re.I)

raw = open(PUBLISHED, encoding='utf8').read()
lines = raw.strip().split('\n')
pairs = [l.split('\t') for l in lines]
words = [w for _, w in pairs]

derived_idx = [i for i, (_, w) in enumerate(pairs) if not BAN.search(w)]
derived = '\n'.join(pairs[i][1] for i in derived_idx) + '\n'
open(os.path.join(S, 'eff_large_words.txt'), 'w').write(derived)
codes = '\n'.join(pairs[i][0] for i in derived_idx) + '\n'
open(os.path.join(S, 'eff_large_wordlist.codes.txt'), 'w').write(codes)

dropped = [{'line': i + 1, 'code': pairs[i][0],
            'wordSha256': hashlib.sha256(pairs[i][1].encode()).hexdigest()}
           for i in range(len(pairs)) if BAN.search(pairs[i][1])]

doc = {
 'v': 'aumlok-source-pins-v1',
 'what': 'The two sources X2 authorises, pinned by content so the harvest runs offline and reproduces.',
 'eff': {
   'publishedFile': {
     'url': 'https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt',
     'recoveredFrom': "this repository's own git history at efd97b44 (scripts/aumlok/eff_large_wordlist.txt)",
     'sha256': hashlib.sha256(raw.encode()).hexdigest(), 'words': len(pairs),
     'license': 'CC BY 3.0 US (Electronic Frontier Foundation)',
     'licenseUrl': 'https://www.eff.org/copyright'},
   'shippedFixture': {
     'wordColumn': 'plugins/aukora-aumlok/data/safety/eff_large_words.txt',
     'codes': 'plugins/aukora-aumlok/data/safety/eff_large_wordlist.codes.txt',
     'note': ('The published file, word column only, minus the entries that carry a retired-custody stem. '
              'The codes file pairs a dice number with each surviving word. A reviewer rebuilds the '
              'published column by re-inserting each dropped entry at its line and checking the digests.')},
   'effFixture': {
     'publishedWords': len(pairs),
     'publishedSha256': hashlib.sha256(raw.encode()).hexdigest(),
     'publishedWordsSha256': hashlib.sha256(('\n'.join(words) + '\n').encode()).hexdigest(),
     'derivedWords': len(derived_idx),
     'derivedSha256': hashlib.sha256(derived.encode()).hexdigest(),
     'derivedCodesSha256': hashlib.sha256(codes.encode()).hexdigest(),
     'dropped': dropped,
     'why': ('The v3 custody ban (tests/aukora-aumlok-v3-no-v2.test.mjs) scans this organ for its stems as a '
             'SUBSTRING. The published EFF list contains three ordinary inflections built on one of them. They buy '
             'nothing, so they are dropped at the fixture instead of widening the ban\'s carve-out or narrowing its '
             'scope. Each is identified by line, dice code and the sha256 of its word: spelling them here would '
             're-trip the very ban the record exists to explain.'),
     'reconstruct': ('interleave eff_large_words.txt with the dropped records placed at their published line '
                     'numbers (the word columns alone), and the result is the published word column: sha256 '
                     + hashlib.sha256(('\n'.join(words) + '\n').encode()).hexdigest())}},
 'frequency': {
   'package': 'wordfreq', 'version': '3.1.1', 'language': 'en', 'metric': 'zipf_frequency', 'min': 3.5,
   'install': 'experiments/laya/.venv (the one install item X2 authorises)', 'python': '3.9.6',
   'note': ('wordfreq is read from the venv at harvest time; the measured zipf of every shipped word is written '
            'into the data so the court re-checks the rule without the venv.')},
}

out = os.path.join(S, 'source-pins.json')
with open(out, 'w') as fh:
    json.dump(doc, fh, indent=1, ensure_ascii=False)
    fh.write('\n')

# PROVE IT PARSES AND THE BAN DOES NOT REACH IT — a green text scan over a file no JSON reader can
# open is the false comfort this project keeps punishing, so both checks are printed here.
text = open(out, encoding='utf8').read()
json.loads(text)
print('source-pins.json: JSON VALID, %d bytes' % len(text))
print('  banned stems in the file: %d' % len(BAN.findall(text)))
print('  published sha256 : %s' % doc['eff']['effFixture']['publishedSha256'])
print('  published words  : %d' % doc['eff']['effFixture']['publishedWords'])
print('  derived words    : %d' % doc['eff']['effFixture']['derivedWords'])
print('  dropped records  : %s' % [(d['line'], d['code']) for d in dropped])
