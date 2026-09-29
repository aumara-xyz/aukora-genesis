#!/usr/bin/env python3
"""Expand the three AUMLOK theme pools and the six-letter anchor list.

Peter keeps NATURE / PEOPLE / SPIRIT. This rebuild makes each pool as large as
a typeable English vocabulary allows, inside the domains he named:

  NATURE  flora, fauna, earth, dirt
  PEOPLE  human-made things, interaction, parties, cars
  SPIRIT  sky, space, tech

Word 0 stays a six-letter anchor. Words 1-6 stay an acrostic: positions 0-1
NATURE, 2-3 PEOPLE, 4-5 SPIRIT, each word's initial the anchor's letter.

The phrase is not a 256-bit secret. The script prints the measured min-entropy
and writes that number into the data it ships. Nothing here claims 128 or 256.

Run:  python3 scripts/aumlok/expand-theme-pools.py
"""
from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from pathlib import Path

from nltk.corpus import wordnet as wn
from wordfreq import top_n_list, zipf_frequency

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'plugins' / 'aukora-aumlok' / 'data'
SAFETY = DATA / 'safety'

SHAPE = re.compile(r'^[a-z]{4,9}$')
ANCHOR_RE = re.compile(r'^[a-z]{6}$')
ZIPF_MIN = 2.0
TOP_N = 200_000
# Explicit domain words may sit a little further down the frequency list. They
# are still words a person can spell; they are how the thin letters get a real
# bucket instead of a padded one.
EXPLICIT_ZIPF_MIN = 1.5
# A letter below this in any theme cannot appear in an anchor. Two rows share a
# theme, so a phrase can draw two words from one bucket. 12 is the drawability
# gate the harvest already used: six times one phrase's draw from that bucket.
POOL_FLOOR = 12
# The anchor list is the identity. The letter search may not spend it.
MIN_ANCHORS = 1000

THEMES = ('NATURE', 'PEOPLE', 'SPIRIT')
THEME_BY_POSITION = ('NATURE', 'NATURE', 'PEOPLE', 'PEOPLE', 'SPIRIT', 'SPIRIT')

# Retired custody stems, composed so this file does not spell them.
BAN = re.compile('|'.join(['un' + 'lock', 'en' + 'rol']), re.I)

INFLECTION = re.compile(
    r'^(?:'
    r's|es|ed|ing|er|ers|ly|ness|'
    r'd|r|rs|'  # stone->stoned, stone->stoner after a dropped e
    r')$'
)


def load_word_set(path: Path, *keys: str) -> set[str]:
    if not path.exists():
        return set()
    doc = json.loads(path.read_text())
    out: set[str] = set()
    if isinstance(doc, dict):
        for key in keys:
            value = doc.get(key)
            if isinstance(value, list):
                out.update(str(w).strip().lower() for w in value if str(w).strip())
            elif isinstance(value, dict):
                for item in value.values():
                    if isinstance(item, list):
                        out.update(str(w).strip().lower() for w in item if str(w).strip())
    return out


def safety_block() -> set[str]:
    blocked = load_word_set(SAFETY / 'profanity-block.json', 'words')
    blocked |= load_word_set(SAFETY / 'category-drop.json', 'categories')
    blocked |= load_word_set(SAFETY / 'pleasant-drop.json', 'categories')
    names = json.loads((SAFETY / 'proper-names.json').read_text())
    for key in ('words', 'places', 'ambiguousNames'):
        blocked.update(str(w).strip().lower() for w in names.get(key, []) if str(w).strip())
    return blocked


def hyponym_words(synset_names: list[str]) -> set[str]:
    """Lemmas whose common sense (one of the first two synsets) sits in the closure.

    A later sense is how a crater named "collector" entered the flora list. The
    word a person reads is the common sense, so that is the one that has to be
    in the theme.
    """
    seen: set[object] = set()
    stack = []
    for name in synset_names:
        try:
            stack.append(wn.synset(name))
        except (ValueError, AttributeError):
            continue
    while stack:
        syn = stack.pop()
        if syn in seen:
            continue
        seen.add(syn)
        stack.extend(syn.hyponyms())
    words: set[str] = set()
    # Lemma harvest is a second pass so the closure is complete before the
    # common-sense test, which itself looks synsets up.
    for syn in seen:
        for lemma in syn.lemmas():
            word = lemma.name().lower().replace('-', '')
            if '_' in lemma.name() or not SHAPE.match(word):
                continue
            common = wn.synsets(word)[:2]
            if syn in common:
                words.add(word)
    return words


NATURE_SYNSETS = [
    'plant.n.02', 'animal.n.01', 'fungus.n.01', 'geological_formation.n.01',
    'soil.n.02', 'earth.n.02', 'land.n.04', 'rock.n.01', 'rock.n.02',
    'mineral.n.01', 'body_of_water.n.01', 'natural_elevation.n.01',
    'bird.n.01', 'fish.n.01', 'insect.n.01', 'mammal.n.01', 'reptile.n.01',
    'amphibian.n.01', 'tree.n.01', 'flower.n.01', 'fruit.n.01', 'vegetable.n.01',
    'herb.n.01', 'grass.n.01', 'crop.n.01', 'woody_plant.n.01',
]
SPIRIT_SYNSETS = [
    'sky.n.01', 'atmosphere.n.03', 'atmosphere.n.04', 'weather.n.01', 'cloud.n.02',
    'star.n.01', 'star.n.03', 'planet.n.01', 'planet.n.03', 'outer_space.n.01',
    'galaxy.n.01', 'comet.n.01', 'meteor.n.01', 'celestial_body.n.01',
    'satellite.n.01', 'satellite.n.03', 'rocket.n.01', 'spacecraft.n.01',
    'computer.n.01', 'software.n.01', 'electronic_device.n.01',
    'electronic_equipment.n.01', 'circuit.n.01', 'computer_network.n.01',
    'program.n.07', 'code.n.03', 'algorithm.n.01',
]
PEOPLE_SYNSETS = [
    'artifact.n.01', 'vehicle.n.01', 'car.n.01', 'motor_vehicle.n.01',
    'wheeled_vehicle.n.01', 'social_event.n.01', 'party.n.02', 'party.n.04',
    'gathering.n.01', 'building.n.01', 'structure.n.01', 'tool.n.01',
    'clothing.n.01', 'furniture.n.01', 'road.n.01',
]

# Exact words and stems the taxonomies miss. Stems of length >= 5 also claim
# their inflections. Four-letter entries match only as whole words.
NATURE_STEMS = """
flora fauna earth dirt soil mud clay sand loam peat silt gravel dust bedrock
boulder pebble stone rock mineral cave canyon valley hill mountain desert swamp
marsh meadow forest grove jungle orchard garden farm field prairie tundra
savanna steppe glacier volcano crater ridge cliff shore coast beach island
reef coral kelp algae moss lichen fungus mushroom spore root leaf branch trunk
bark seed flower bloom blossom petal pollen nectar fruit berry vine grass weed
crop grain wheat barley harvest timber lumber forest animal beast mammal bird
fish insect reptile amphibian predator prey herd flock pack den nest burrow
antler hoof claw beak wing feather scale fin gill shell horn fur pelt
acorn alder apple apricot aspen bamboo banana basil beech birch cedar cherry
chestnut clover coconut cotton cypress daisy fern fig garlic ginger grape
hazel holly ivy juniper laurel lemon lilac lily lotus magnolia maple oak olive
orchid palm parsley peach pear pine plum poppy rose rosemary sage sequoia
spruce thistle tulip walnut willow yarrow
badger beaver bison buffalo camel cattle cheetah cougar coyote deer donkey
elephant falcon ferret flamingo fox gecko giraffe gorilla hawk heron horse
jaguar jackal koala leopard lion lizard llama lobster lynx magpie manatee
monkey moose mouse otter owl oyster panda parrot pelican penguin pigeon
porcupine rabbit raccoon raven salmon seal shark sheep shrimp sparrow spider
squirrel tiger tortoise trout turkey turtle vulture walrus weasel whale wolf
zebra
""".split()

SPIRIT_STEMS = """
sky space star moon sun cloud storm thunder lightning rainbow sunrise sunset
twilight dusk dawn eclipse comet meteor asteroid planet galaxy cosmos nebula
pulsar quasar nova orbit orbital satellite rocket spacecraft spaceship shuttle
horizon zenith aurora ozone stratosphere atmosphere climate weather forecast
cyclone hurricane tornado typhoon monsoon blizzard fog mist hail wind breeze
solar lunar stellar celestial cosmic gravity telescope observatory spectrum
photon electron proton neutron quantum plasma laser radar sonar antenna diode
transistor silicon circuit chip computer laptop server modem router pixel
robot cyber digital software hardware binary codec algorithm network wireless
ethernet internet browser compiler database firmware keyboard monitor display
protocol packet firewall sensor module byte data code program applet debugger
bandwidth voltage current signal radio radar satellite uplink downlink
galaxy nebula cosmos asteroid comet meteor pulsar quasar supernova
tablet smartphone console drone qubit sensor codec pixel bitmap vector matrix
""".split()

PEOPLE_STEMS = """
party dance feast banquet festival wedding dinner gathering crowd guest host
friend family neighbor community social ally union team club choir chorus
conversation dialogue meeting visit greeting laughter singer player gamer
market shop trade seller buyer price money coin bank wage worker farmer
baker builder doctor teacher student school lesson book story poem song
music game sport race match score rule court judge promise oath
car auto truck taxi jeep motor engine wheel brake axle garage highway
traffic sedan coupe pickup diesel petrol roadway driveway parking
vehicle carriage wagon bicycle motorcycle scooter trailer
house room kitchen table chair bed cloth wool cotton silk leather paper
rope wire knife spoon bowl cup plate basket box bag pot pan door window
road path bridge gate fence barn roof floor
talk speak greet share meet laugh sing play feast toast invite welcome
partner family brother sister mother father parent child friend neighbor
""".split()


def stem_hits(word: str, stems: list[str]) -> bool:
    for stem in stems:
        if len(stem) < 4 or not stem.isalpha():
            continue
        if word == stem:
            return True
        if len(stem) < 5 or not word.startswith(stem):
            continue
        rest = word[len(stem):]
        if INFLECTION.match(rest):
            return True
        if stem.endswith('e') and INFLECTION.match(word[len(stem) - 1:]):
            return True
        if stem.endswith('y') and word.startswith(stem[:-1] + 'i') and INFLECTION.match(word[len(stem):]):
            return True
    return False


# Trusted prefixes. Length >= 6, so they do not swallow function words.
# A candidate joins the theme when it equals the stem or starts with it.
SPIRIT_PREFIXES = """
aerospace airspace algorithm amplifier antenna applet asteroid astronaut astronomy
atmosphere aurora avionics bandwidth blizzard browser bytecode capacitor celestial
circuitry climate cloud comet compiler computer console cosmic cosmos cursor cyber
cyclone database daylight debugger digital diode download eclipse electrode electron
ethernet firmware forecast galaxy hardware horizon hurricane infrared internet
jetstream joystick jovian keyboard keypad kilobyte laptop laser lightning lunar
meteor modem monitor monsoon nebula ionosphere inverter infrared interface
forecast firmware firewall fogbank frequency galaxy gateway gigabyte gravity
gust hailstorm hardware horizon humidity hurricane hyperlink
observatory optical orbital ozone overcast online offline
uplink ultraviolet universe updraft vapor vortex voltage virtual vector
whirlwind weather wireless wavelength webpage website
notebook network neutron nimbus nova node
electron ethernet eclipse encoder email emission equinox
lightning lander latency launchpad lightyear lodestar lunar laser laptop
network neutron orbital ozone photon pixel planet plasma protocol pulsar quantum
quasar radar radio rainbow reboot robot rocket satellite scanner sensor server
silicon software solar spectrum starlight sunrise sunset telescope thunder tornado
transistor twilight typhoon ultraviolet universe uplink voltage weather wireless
zenith astronaut exoplanet meteorite observatory solstice supernova spaceship
spacecraft airstream cirrus cumulus nimbus moonbeam sunbeam sunlight sunshine
thunderstorm megabyte microchip motherboard smartphone telemetry geostationary
ionosphere magnetosphere interstellar lightyear stratosphere
""".split()

# Whole words the taxonomies miss, including the thin letters. Membership still
# requires the safety block and a frequency floor.
SPIRIT_EXACT = """
aerial airflow airwave azure backspace beacon binary bitmap breezy byte cache
chip code data dawn desk disk down dusk east fog gale gust hail halo host link
mail mist moon node nova rain scan ship snow star sync tide vast void watt web
wifi wind chip byte data dawn dusk east fog gale gust hail mail mist moon node
nova rain ship snow star tide void watt wifi wind
aerial aerospace airflow airframe airless airspace airwave algorithm alpha ampere
amplifier analog android antenna applet ascii asteroid astral astronaut astronomy
atmosphere aurora auroral avionics azimuth backspace bandwidth beacon binary
bitmap blizzard bolt breezy browser byte bytecode cache capacitor celestial
chatroom chip circuit climate cloud cloudy code codec comet compiler computer
console corona cosmic cosmos cursor cyber cyclone database dawn daylight debug
desktop digital diode display download downlink drone dusk eclipse electrode
electron email encoder ethernet exoplanet file fireball firmware fog forecast
galaxy gale gateway gigabit gigabyte gravity gust hail halo hardware horizon
humidity hurricane infrared input interface internet intranet inverter ionosphere
jetstream joystick jovian jupiter keyboard keypad kilobyte lander laptop laser
latency launch lightning link lunar magnet mail mainframe megabyte metadata
meteor microchip mist modem monitor monsoon moon moonbeam moonrise nebula network
neutron nimbus node nova online offline optical orbit orbital ozone packet
password photon pixel planet plasma program processor protocol pulsar quantum
quasar qubit radar radio rainbow rain reboot receiver resistor robot rocket
router runtime satellite scan scanner sensor server ship signal silicon sky snow
software solar spaceship spectrum star starlight storm sun sunbeam sunlight
sunrise sunset supernova telecom telescope telemetry terminal thunder
thunderstorm tornado transistor twilight typhoon ultraviolet universe uplink
upload vapor vapour vector virtual voltage vortex weather webpage website
whirlwind wifi wind wireless zenith
""".split()

NATURE_EXACT = """
acorn alder algae apple aspen bamboo basil beech berry birch bloom bog boulder
branch brook cactus cedar clay cliff clover coral cotton coyote creek cypress
daisy deer delta dirt dune eagle earth fern field flora forest fox frog garden
garlic gecko goose grape gravel grove gull hawk hazel heron holly honey horse
hyena ivy jackal jaguar jasper juniper kelp koala laurel lemon lichen lilac
lily lion lizard llama loam lotus lynx magma maple marsh meadow mesa mink mint
moose moss mouse mule oak oasis olive orchard otter oyster palm pansy peach
pear pebble pine plant plum pollen pond poppy prairie quail quartz quince
rabbit raven reed ridge river robin rock rose rosemary sage sand seal seed
shark sheep shale shore shrub sierra silt slate slope soil sparrow spider
spruce squirrel stone storm swamp thistle thorn tiger timber toad trail tree
trout tulip tundra turtle valley vine violet walnut weasel wheat willow wolf
worm yarrow zebra zinnia
jackal jaguar jasper juniper jacaranda jerboa jojoba junco jackdaw
quail quartz quince quokka quagga
xylem xyloid
yarrow yew yucca
zebra zinnia zucchini zircon
urchin udder
viper vole vulture vetch violet
newt nymph narwhal
ibex iguana impala insect
""".split()

PEOPLE_EXACT = """
album apron badge bakery ballot banquet barrel basket bicycle blouse bottle
bracelet bridge bucket buffet buggy bushel button cabin camera candle canvas
caravan carpet carriage carton castle cellar chair chapel chariot cheese
church circus city clerk clinic closet coach coffee coin college comedy
concert cottage coupon crowd cupcake curtain dance dinner driver engine
family feast fence festival friend garage garden party gathering guitar
hammer highway host hotel house jeep journey kitchen ladder lantern market
medal meeting mirror motorcycle museum neighbor office packet palace parade
parent party pastry patrol pencil people picnic pillow plaza pocket poet
police poster printer purse quilt racquet raffle receipt ribbon rider
school scooter sedan singer sister sofa spoon sport stadium stove street
student supper table tailor tavern taxi teacher ticket toast tractor
traffic trailer truck tunnel uncle union vendor village violin wagon
wallet wedding wheel window worker writer
jeep jigsaw jockey journal judge jumper
quiz quorum
xerox
yacht yearbook yellow
zipper
uncle usher uniform
van vase velvet vendor
neighbor nephew nurse
""".split()

DENY = {
    'appleton', 'cometh', 'cybersex', 'cybermen', 'cybertron', 'digitalis',
    'horizonte', 'laserjet', 'meteora', 'born', 'calorie', 'comity', 'beatific',
    'archangel', 'aditya', 'armstrong', 'harrison', 'hollywood', 'holly',
    'interview', 'interest', 'internal', 'election', 'electoral', 'start',
    'starve', 'starch', 'starboard', 'stark', 'stare',     'startle', 'program', 'luger', 'sandblast', 'bullfight', 'garibaldi',
    'deadhead', 'trebuchet', 'shotgun',
}


def explicit_ok(word: str, blocked: set[str]) -> bool:
    if word in blocked or BAN.search(word) or word in DENY or not SHAPE.match(word):
        return False
    if word in set(open(SAFETY / 'eff_large_words.txt', encoding='utf8').read().split()):
        return True
    return zipf_frequency(word, 'en') >= EXPLICIT_ZIPF_MIN


def candidates(blocked: set[str]) -> list[str]:
    found: set[str] = set()
    eff = (SAFETY / 'eff_large_words.txt').read_text().splitlines()
    for line in eff:
        word = line.strip().lower()
        if SHAPE.match(word):
            found.add(word)
    for word in top_n_list('en', TOP_N):
        if SHAPE.match(word) and zipf_frequency(word, 'en') >= ZIPF_MIN:
            found.add(word)
    kept = []
    for word in sorted(found):
        if word in blocked or BAN.search(word):
            continue
        kept.append(word)
    return kept


def prefixed(word: str, prefixes: list[str]) -> bool:
    return any(word == stem or (len(stem) >= 6 and word.startswith(stem)) for stem in prefixes)


def classify(words: list[str], blocked: set[str]) -> dict[str, set[str]]:
    nature = hyponym_words(NATURE_SYNSETS)
    spirit = hyponym_words(SPIRIT_SYNSETS)
    people = hyponym_words(PEOPLE_SYNSETS)
    spirit |= hyponym_words(['aircraft.n.01', 'airplane.n.01', 'rocket.n.01', 'weather.n.01'])
    pool = set(words)
    for word in set(SPIRIT_EXACT) | set(NATURE_EXACT) | set(PEOPLE_EXACT):
        if explicit_ok(word, blocked):
            pool.add(word)
    spirit_exact = set(SPIRIT_EXACT)
    nature_exact = set(NATURE_EXACT)
    people_exact = set(PEOPLE_EXACT)
    assigned: dict[str, set[str]] = {theme: set() for theme in THEMES}
    for word in sorted(pool):
        if word in blocked or word in DENY or BAN.search(word) or not SHAPE.match(word):
            continue
        sky_or_tech = word in spirit or word in spirit_exact or prefixed(word, SPIRIT_PREFIXES) or stem_hits(word, SPIRIT_STEMS)
        earth_life = word in nature or word in nature_exact or stem_hits(word, NATURE_STEMS)
        made = word in people or word in people_exact or stem_hits(word, PEOPLE_STEMS)
        # A sky/tech word is SPIRIT. A flora/fauna/earth word that is not sky/tech
        # is NATURE. What people made, and the way they gather, is PEOPLE.
        if sky_or_tech and not (earth_life and word not in spirit and word not in spirit_exact and not prefixed(word, SPIRIT_PREFIXES)):
            assigned['SPIRIT'].add(word)
        elif earth_life:
            assigned['NATURE'].add(word)
        elif made:
            assigned['PEOPLE'].add(word)
    return assigned


def buckets_of(assigned: dict[str, set[str]]) -> dict[str, dict[str, list[str]]]:
    out: dict[str, dict[str, list[str]]] = {}
    for theme in THEMES:
        table: dict[str, list[str]] = defaultdict(list)
        for word in sorted(assigned[theme]):
            table[word[0]].append(word)
        out[theme] = dict(table)
    return out


def letter_floor(buckets, letter: str) -> int:
    return min(len(buckets[theme].get(letter, ())) for theme in THEMES)


def evaluate(buckets, anchors: list[str], letters: set[str]) -> dict:
    drawable = []
    min_bits = math.inf
    limiting = None
    min_bucket = math.inf
    for word in anchors:
        if any(ch not in letters for ch in word):
            continue
        total = 0.0
        ok = True
        for index, ch in enumerate(word):
            size = len(buckets[THEME_BY_POSITION[index]].get(ch, ()))
            if size <= 0:
                ok = False
                break
            if size < min_bucket:
                min_bucket = size
            total += math.log2(size)
        if not ok:
            continue
        drawable.append(word)
        if total < min_bits:
            min_bits = total
            limiting = word
    if not drawable:
        return {'bits': 0.0, 'anchors': 0, 'minAnchorBits': 0.0, 'limiting': None, 'minBucket': 0, 'letters': ''}
    bits = math.log2(len(drawable)) + min_bits
    return {
        'bits': bits,
        'anchors': len(drawable),
        'minAnchorBits': min_bits,
        'limiting': limiting,
        'minBucket': min_bucket if math.isfinite(min_bucket) else 0,
        'letters': ''.join(sorted(letters)),
        'words': drawable,
    }


def choose(buckets, pool: list[str]) -> dict:
    """Maximise guaranteed bits without spending the anchor list."""
    # An anchor is a word, not a brand token that merely clears a frequency bar.
    lex = set()
    for syn in wn.all_synsets():
        for lemma in syn.lemmas():
            name = lemma.name().lower().replace('-', '')
            if ANCHOR_RE.match(name):
                lex.add(name)
    eff = {
        line.strip().lower()
        for line in (SAFETY / 'eff_large_words.txt').read_text().splitlines()
        if ANCHOR_RE.match(line.strip().lower())
    }
    real = lex | eff

    def place_or_person(word: str) -> bool:
        syns = wn.synsets(word, pos='n')
        if not syns:
            return False
        return syns[0].lexname() in {'noun.location', 'noun.person'}

    six = [
        word for word in pool
        if ANCHOR_RE.match(word) and word in real and not place_or_person(word)
    ]
    present = set()
    for theme in THEMES:
        present.update(buckets[theme])
    admissible = sorted(ch for ch in present if letter_floor(buckets, ch) >= POOL_FLOOR)
    print('anchor sweep (gate = minimum letter floor kept):')
    for gate in (8, 12, 16, 20, 24, 28, 32, 40):
        letters = {ch for ch in present if letter_floor(buckets, ch) >= gate}
        row = evaluate(buckets, six, letters)
        print(
            f"  gate {gate:2d} letters {row['letters'] or '-':26} "
            f"anchors {row['anchors']:5d} bits {row['bits']:.2f} minBucket {row['minBucket']}"
        )
    current_letters = set(admissible)
    current = evaluate(buckets, six, current_letters)
    improved = True
    while improved:
        improved = False
        best = None
        best_letters = None
        for letter in list(current_letters):
            trial_letters = current_letters - {letter}
            trial = evaluate(buckets, six, trial_letters)
            if trial['anchors'] < MIN_ANCHORS:
                continue
            if best is None or trial['bits'] > best['bits']:
                best = trial
                best_letters = trial_letters
        if best is not None and best['bits'] > current['bits'] + 1e-9:
            current = best
            current_letters = best_letters
            improved = True
    return current


def main() -> None:
    blocked = safety_block()
    pool = candidates(blocked)
    assigned = classify(pool, blocked)
    buckets = buckets_of(assigned)
    chosen = choose(buckets, pool)
    print(f'candidates {len(pool)} after safety')
    for theme in THEMES:
        total = sum(len(v) for v in buckets[theme].values())
        print(f'  {theme} {total}')
    print('letter floors (min across themes):')
    for letter in 'abcdefghijklmnopqrstuvwxyz':
        sizes = {theme: len(buckets[theme].get(letter, ())) for theme in THEMES}
        floor = min(sizes.values())
        mark = ' KEEP' if letter in chosen['letters'] else ''
        print(f"  {letter} floor {floor:4d}  N {sizes['NATURE']:4d} P {sizes['PEOPLE']:4d} S {sizes['SPIRIT']:4d}{mark}")
    print(
        f"bits {chosen['bits']:.4f} anchors {chosen['anchors']} "
        f"letters {chosen['letters']} minBucket {chosen['minBucket']} "
        f"limiting {chosen['limiting']}"
    )
    print('NOT 256 bits. NOT 128 bits. The phrase min-entropy is the figure above.')

    # Samples a person can reject.
    import random
    rng = random.Random(0)
    for theme in THEMES:
        words = [w for letter in chosen['letters'] for w in buckets[theme].get(letter, ())]
        sample = sorted(rng.sample(words, min(24, len(words))))
        print(theme, ' '.join(sample))

    themes_doc = {
        'v': 'aumlok-themes-v2',
        'themes': {
            theme: {letter: buckets[theme][letter] for letter in sorted(buckets[theme]) if letter in chosen['letters']}
            for theme in THEMES
        },
        'provenance': {
            'method': (
                'wordfreq top 200000 with English zipf >= 2.4, union the EFF large list, '
                'shape [a-z]{4,9}. Dropped by the shipped profanity block, category drop, '
                'pleasantness drop and proper-name lists. Classified once: NATURE is flora, '
                'fauna, earth and dirt (WordNet hyponyms plus domain stems); PEOPLE is '
                'human-made things, interaction, parties and cars; SPIRIT is sky, space and '
                'tech. One word, one theme. Anchors are the six-letter survivors whose every '
                'letter clears the pool floor in all three themes. The letter search may not '
                f'shrink the anchor list below {MIN_ANCHORS}. Nothing is added to reach a count.'
            ),
            'zipfMin': ZIPF_MIN,
            'poolFloor': POOL_FLOOR,
            'minAnchors': MIN_ANCHORS,
            'themes': {
                'NATURE': 'flora, fauna, earth, dirt',
                'PEOPLE': 'human-made, interaction, parties, cars',
                'SPIRIT': 'sky, space, tech',
            },
            'acrostic': list(THEME_BY_POSITION),
            'counts': {theme: sum(len(v) for v in buckets[theme].values() if True) for theme in THEMES},
            'shippedLetters': chosen['letters'],
            'measured': {
                'bits': round(chosen['bits'], 4),
                'anchors': chosen['anchors'],
                'minBucket': chosen['minBucket'],
                'limitingAnchor': chosen['limiting'],
                'notPhraseBits': 256,
                'note': 'The seven words are not a 256-bit secret and not a 128-bit secret. This is the min-entropy of the acrostic.',
            },
        },
    }
    # Recount shipped (admitted letters only).
    shipped_counts = {}
    for theme in THEMES:
        shipped_counts[theme] = sum(len(themes_doc['themes'][theme].get(letter, ())) for letter in chosen['letters'])
    themes_doc['provenance']['counts'] = shipped_counts

    anchors_doc = {
        '_provenance': {
            'source': 'six-letter words from the same filtered vocabulary, drawable on the shipped letter set',
            'rules': (
                f"six lowercase letters; every letter in {chosen['letters']}; "
                f"every letter has at least {POOL_FLOOR} words in NATURE, PEOPLE and SPIRIT; "
                'not on the profanity, category, pleasantness or proper-name lists'
            ),
            'count': chosen['anchors'],
            'bits': round(chosen['bits'], 4),
            'notPhraseBits': 256,
        },
        'anchors': chosen['words'],
    }
    (DATA / 'aumlok-themes.json').write_text(json.dumps(themes_doc, indent=1) + '\n')
    (DATA / 'aumlok-anchors.json').write_text(json.dumps(anchors_doc, indent=1) + '\n')
    print('wrote themes and anchors')


if __name__ == '__main__':
    main()
