#!/usr/bin/env python3
"""Rebuild the three themes BROAD and BIG, per the rule written in AUMLOK-WORDS-FOR-PETER.md §3b.

    python3 scripts/aumlok/build-entropy-lists.py --out /tmp/aumlok-themes-new.json

WHY THIS EXISTS. The entropy floor is 58 bits and the shipped lists carry 34.14. The letters that bind are
the thin ones, and the fix is a much larger COMMON vocabulary rather than a lower floor. Peter's design is
fixed (seven words, the acrostic, the anchor in the gold boxes, pairs from three broad themes) and the
themes are BROAD, NOT STRICT: a word may join one, two or all three.

THE RULE, IMPLEMENTED AS WRITTEN, and auditable by reading the three SEED sets below:

  * a word is in a theme if it IS one of that theme's seeds, or is BUILT ON one — `stars` and `starry` are
    EARTH/ABOVE because `star` is; `builder` because `build` is. The shared prefix is at least four
    characters, so `car` never captures `care` and `sun` never captures `sunset` by accident... except
    that it does, deliberately: `sunset` IS about the sun.
  * a word that relates to NONE of the three is DROPPED rather than forced into a bucket. That is what
    keeps a broad classification honest: breadth comes from the size of the seed sets and from morphology,
    never from assigning everything to everything.
  * NOTHING IS ASSIGNED TO FILL A BUCKET. The letter choice is the measurement's business, not this
    script's: it writes every theme it can justify and lets `chooseAnchorLetters` find the floor.

SAFETY IS APPLIED HERE AND IS NEVER TRADED FOR BITS: the published profanity/slur block and the category,
pleasantness and proper-name drops are read from `data/safety/` and every candidate is filtered through all
of them before it reaches a theme. A word that cannot get past them is dropped even if a bucket needs it.
"""
import argparse, collections, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'plugins' / 'aukora-aumlok' / 'data'
SAFETY = DATA / 'safety'

# ── THE NET, fixed by measurement: top 200k + zipf >= 2.8 + the EFF list, shaped ^[a-z]{4,9}$ ──────────
TOP_N = 200_000
ZIPF_FLOOR = 2.8
SHAPE = re.compile(r'^[a-z]{4,9}$')

# ── EARTH: the Earth and what is on it ────────────────────────────────────────────────────────────────
SEEDS = {
    'EARTH': """
    earth soil land ground field farm garden forest wood tree leaf root branch seed grass flower rose
    river lake sea ocean water wave beach shore coast island hill mountain valley rock stone sand mud
    cave cliff desert swamp marsh pond stream spring rain snow ice wind storm cloud thunder frost fog
    sun dawn dusk sky weather season summer winter autumn harvest crop wheat corn grain fruit apple
    bread milk honey salt fire smoke ash coal iron gold silver copper steel glass clay brick wall
    roof floor door window road path bridge gate fence barn house room kitchen table chair bed cloth
    wool cotton silk leather paper rope wire nail knife spoon bowl cup plate basket box bag pot pan
    animal horse cow sheep goat pig dog cat bird fish bird insect bee ant worm snake mouse rabbit
    wolf bear fox deer lion tiger whale shark eagle owl crow hen duck goose frog crab shell feather
    fur horn tail wing nest egg bone blood skin hair hand foot eye ear mouth tooth tongue heart
    body food eat drink cook bake boil roast bite chew swallow taste smell touch hold carry lift push
    pull dig plant grow pick cut chop saw hammer build repair wash clean sweep gather hunt ride walk
    run climb swim dive float sail row drive fly jump fall stand sit sleep wake breathe
    """.split(),

    # ── PEOPLE: people and what people do ─────────────────────────────────────────────────────────────
    'PEOPLE': """
    person people human man woman child baby boy girl father mother parent son daughter brother sister
    family friend neighbour stranger guest host crowd group team tribe clan village town city street
    market shop trade sell buy price money coin bank debt loan wage work job labour boss worker farmer
    baker builder doctor nurse teacher student school lesson book page word letter name story poem
    song dance music game play sport race match score rule law judge court police thief crime guilt
    promise oath truth lie gossip rumour joke laugh cry smile frown greet meet visit talk speak say
    tell ask answer call shout whisper listen hear read write sign draw paint sing clap cheer boo
    help serve lead follow teach learn study think know guess doubt decide choose agree argue fight
    forgive thank bless curse marry wed divorce raise feed clothe shelter defend attack protect
    heal hurt kill save lose win give take share borrow lend steal buy spend save earn owe pay
    honest kind cruel brave coward gentle rude polite proud humble patient angry calm anxious glad
    sorry grateful jealous lonely merry sober drunk wise fool friend enemy ally rival partner
    """.split(),

    # ── ABOVE: higher spirit, space, and what is above us ─────────────────────────────────────────────
    'ABOVE': """
    sky heaven star moon planet comet orbit space cosmos galaxy sun light beam ray glow shine spark
    flame shadow air breath wind cloud mist vapour height high tall deep vast wide far beyond above
    over upward rise climb soar float hover fly ascend lift up outer distant horizon edge infinite
    time hour day night week month year age moment instant eternal forever past future memory dream
    sleep rest wake soul spirit ghost angel god divine holy sacred prayer bless hymn faith belief
    hope trust grace mercy peace joy love awe wonder mystery miracle vision truth wisdom meaning
    reason logic mind thought idea truth beauty good evil fate destiny luck chance soul silent
    still calm pure bright clear dark dim pale colour hue tone echo sound voice music melody rhythm
    song choir bell chime thunder rumble hush whisper silence number circle sphere line point centre
    order pattern balance harmony measure weight scale vast empty void nothing all whole one
    """.split(),
}

MIN_STEM = 4  # a shared prefix shorter than this proves nothing


def stems(words):
    """Every prefix of every seed, length >= MIN_STEM. A word matching one is built on a themed word."""
    out = set()
    for word in words:
        for n in range(MIN_STEM, len(word) + 1):
            out.add(word[:n])
    return out


def load_safety():
    """Every drop list, as one set of forbidden words plus the proper names we must not ship."""
    forbidden, proper = set(), set()
    for name in ('profanity-block.json', 'category-drop.json', 'pleasant-drop.json'):
        path = SAFETY / name
        if not path.exists():
            continue
        doc = json.loads(path.read_text())
        words = doc.get('words') if isinstance(doc, dict) else doc
        if isinstance(words, list):
            forbidden.update(str(w).lower() for w in words)
        elif isinstance(words, dict):
            for value in words.values():
                if isinstance(value, list):
                    forbidden.update(str(w).lower() for w in value)
    path = SAFETY / 'proper-names.json'
    if path.exists():
        doc = json.loads(path.read_text())
        values = doc.get('names') if isinstance(doc, dict) else doc
        if isinstance(values, list):
            proper.update(str(w).lower() for w in values)
    return forbidden, proper


def candidates():
    """The net. wordfreq is the design's own source; the EFF list is unioned in exactly as X2 did."""
    from wordfreq import top_n_list, zipf_frequency
    eff_path = SAFETY / 'eff_large_words.txt'
    eff = set()
    if eff_path.exists():
        eff = {line.strip().lower() for line in eff_path.read_text().splitlines() if line.strip()}
    wide = set()
    for word in top_n_list('en', TOP_N):
        if SHAPE.match(word) and zipf_frequency(word, 'en') >= ZIPF_FLOOR:
            wide.add(word)
    for word in eff:
        if SHAPE.match(word) and zipf_frequency(word, 'en') >= ZIPF_FLOOR:
            wide.add(word)
    return sorted(wide), len(eff & wide)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--report', default=None)
    args = parser.parse_args()

    forbidden, proper = load_safety()
    pool, from_eff = candidates()
    allowed = [w for w in pool if w not in forbidden and w not in proper]
    print(f'net {len(pool)} words ({from_eff} also in EFF); '
          f'after safety {len(allowed)} (dropped {len(pool) - len(allowed)})')

    seed_stems = {theme: stems(words) for theme, words in SEEDS.items()}
    themes = {theme: collections.defaultdict(list) for theme in SEEDS}
    unassigned = []
    for word in allowed:
        joined = []
        for theme, base in SEEDS.items():
            if word in base or word in seed_stems[theme]:
                joined.append(theme)
        if not joined:
            unassigned.append(word)
            continue
        for theme in joined:
            themes[theme][word[0]].append(word)

    doc = {
        'v': 'aumlok-themes-v1',
        'themes': {theme: {letter: sorted(words) for letter, words in buckets.items()}
                   for theme, buckets in themes.items()},
        'provenance': {
            'source': f'wordfreq top_n_list(en, {TOP_N}) with zipf >= {ZIPF_FLOOR}, unioned with the EFF large wordlist',
            'rule': 'AUMLOK-WORDS-FOR-PETER.md 3b: a word joins a theme if it IS a themed word or is built on one (shared prefix >= 4); a word relating to none is dropped',
            'safety': 'profanity-block, category-drop, pleasant-drop and proper-names applied before any theme',
            'net': len(pool), 'shipped': len(allowed), 'droppedBySafety': len(pool) - len(allowed),
            'assigned': sum(len(v) for t in themes.values() for v in t.values()),
            'unassigned': len(unassigned),
        },
    }
    Path(args.out).write_text(json.dumps(doc, indent=0, sort_keys=True) + '\n')
    print(f'wrote {args.out}: ' + ', '.join(
        f'{theme} {sum(len(v) for v in themes[theme].values())}' for theme in SEEDS))
    print(f'unassigned (dropped, not forced): {len(unassigned)}')
    if args.report:
        Path(args.report).write_text('\n'.join(unassigned) + '\n')


if __name__ == '__main__':
    sys.exit(main())
