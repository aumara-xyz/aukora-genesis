# AUMLOK v3, item X8 — THE THREE THEMES, BROAD AND BIG.
#
# THIS FILE IS THE SHIPPING RULE. A themed word ships if and only if it appears in one of the three
# lists below. There is no fourth bucket and no fallback: a candidate word that no list names is
# not drawn, not shipped, and counted as nothing but a drop.
#
# EVERY ENTRY IS A WORD A PERSON READ AND PLACED. That is the whole design. Two cheaper designs
# were tried against the real candidate pool first, MEASURED, and thrown away:
#
#   1. A RULE OVER PREFIX FAMILIES. "A head claims every candidate it is a prefix of" placed 1,859
#      ROOT words from 95 heads, and it looked like it worked -- until the buckets were read.
#      `been` shipped in ROOT because `bee` was a head; `can`, `will`, `make`, `want` and `have`
#      shipped in UNITE because `can`, `wil`, `mak` and `wan` were. Over the same pool the design
#      put `channing`, `cubans`, `grover`, `jasper`, `perth`, `kennedy` and `miliband` into bands a
#      person reads as their own identity. The proper-name filter cannot catch those: it drops a
#      name only when it has no common lowercase dictionary sense, and `channing`, `perth` and
#      `davis` all do. A head is a guess about a word nobody looked at, and the guesses land on
#      function words and surnames first, because those are the commonest words in English.
#   2. A SUFFIX RULE. `-ing` is an activity, `-ness` is a quality. Over the 19,612-word pool it
#      placed 400 ROOT words and 553 UNITE words, and the per-letter buckets came out in single
#      digits. Wrong and far too small at the same time.
#
# So the lists are spelled out. The cost is that this file is long; the benefit is that every
# shipped word traces to a line a person can point at, and that no function word can enter a band
# by matching the first three letters of a plant.
#
# WHAT THIS FILE IS NOT. It is not a safety filter and it does not vouch for a word's tone. The
# harvest still runs every claimed word through the hard block, the category drops, the proper-name
# rule and the pleasantness pass (data/safety/*.json), and any one of those can still remove it. A
# list entry is a necessary condition for shipping, never a sufficient one.
#
# THE ONE-WORD-ONE-THEME RULE. Order decides -- NATURE, then UNITE, then RISE -- and the harvest
# ASSERTS that no word ends up in two bands. A word in two bands would be a fallback in everything
# but name, which is the thing this file exists to remove.

# ROOT — of the earth. Every animal, bird, fish, insect, tree, plant, flower, fruit, herb, weather,
# sky, water, land, stone and season word. The living world and the ground it stands on.
NATURE = """acacia acorn acre air alder algae alligator almond aloe alpaca amber anemone angelfish
ant antelope anther apple apricot arctic ash aspen asteroid atoll aurora autumn avocado azalea
badger bamboo banana banyan barley barnacle basil basin bass bat bay beach beak bean bear beaver
bedrock beech beetle bench berry birch bison bittern blackberry blackbird bladder blaze bloom
blossom blowfish blueberry bluebell bluebird bluejay boar bobcat bog boulder boulevard bracken
bramble branch breeze brook brooklet broom brush bubble buckeye buckwheat bud buffalo bulb bullrush
bumblebee bunting burrow bush buttercup butterfly buzzard
cactus caiman calf camellia campfire canal canary canyon cape capybara cardinal carnation carob
carp carrot cascade cashew cassava catbird catfish cattail cave cavern cedar celandine cereal
chamomile chameleon channel chestnut chickadee chickweed chicory chive cicada cinnamon cirrus
citron citrus clay cliff climate clime cloak cloud clove clover coast cobble cobra cocoa coconut
coltsfoot comet conifer cove copper coral cormorant corn cotton cougar country crab cranberry
crane crater crayfish creek cress crest cricket crimson crocus crop crow crown crystal cumulus
current cycad cypress
daffodil dahlia daisy dale dam dandelion dawn daybreak daylight daytime deer delta dew diamond
dingo dodo dogwood dolphin donkey dormouse dove downpour dragonfly drizzle dune dusk dust
eagle earth earthworm east ebb echinacea eclipse eel egret elder elm ember emerald estuary evening
evergreen
falcon fall farmland farrow fawn feather fennel fern ferret field fig finch fir flake flame
flamingo flint flock flood flora flounder flower fluff fog foal foliage forest fossil fountain
fox foam freeze frost fruit fungus furrow
galaxy gale garden garland garlic gator gazelle gecko geese geranium geyser ginger ginkgo giraffe
glacier glade glen globe glowworm goldfinch goldfish goose gopher gorge gorse granite grape
grapevine grass grasshopper gravel grotto grove gulf gull gully gust
hail halibut hamlet harbor hare harrier harvest hawk hawthorn haze hazel heath heather hedge
hedgehog hemlock heron hickory highland hill hillside hock holly honey honeybee honeysuckle
horizon hornet horse horsetail hotspring hummingbird humpback hurricane hush hyacinth hyena
ibex ice iceberg icicle iris ironwood island isle ivy
jackal jackdaw jade jaguar jasmine jay jellyfish jetty junco juniper jungle
karst kayak kelp kestrel kiwi knoll koala koi
lagoon lake lakebed lakefront larch lark larkspur laurel lava lavender lawn leaf ledge leek
lemming lemon lemongrass lemur lentil leopard lettuce lichen light lightning lilac lily lilypad
lime limestone linden lion lizard llama loam lobster lode locust lodgepole loon lotus lupine lynx
macaw mackerel magma magnolia magpie mahogany maize mallard mallow mammoth mane mangrove mango
maple marigold marina marlin marmot marsh marshland marram marten meadow meadowlark mesa mesquite
meteor midnight mildew milkweed millpond mink mint mist mistletoe mistral mole monarch monsoon
moon moonlight moonlit moonrise moose morning moraine moss moth mountain mulberry mushroom musk
mussel mustard myrtle
narcissus native nature nectarine nectar newt night nightfall nightingale nightjar north northeast
northwest nosegay nutmeg
oak oasis ocean ocelot oceanfront oleander olive onyx opossum orchard orchid ore oriole osprey
otter outcrop outback owl ox oxbow oyster
pacific paddle paddlefish palm palmetto pansy panther papaya papyrus park parsley partridge
passage pastel pasture path peak peacock pearl peat pebble pelican penguin peony pepper peppermint
periwinkle petal petrel petunia pheasant phlox phoenix pigeon pika pike pillar pine pinecone
pinnacle pinyon pistachio plain planet plateau platypus plum plumage plover pond pony poplar
poppy porcupine porpoise pothole prairie primrose puddle puffin puma pumpkin
quail quarry quartz quicksand quince quiver
rabbit raccoon radar raft ragweed rail rain rainbow rainforest rainstorm rapids ravine raven
redwood reef reed reindeer ridge rill ripple river rivulet roadrunner robin rock rocky rook
rosemary root rose rosebud rowan rush rust
sage sailfish salamander salmon sand sandalwood sandbar sandpiper sandstone sandy sap sapphire
sardine savanna savannah scallop scarlet sea seabird seacoast seafoam seagull seahorse seal
seashell seaside season seaweed sedge seed seedling sequoia shade shadow shale shallow shore
showers shrub sierra silence silt silver sky skyline sloe slope snow snowdrift snowfall snowflake
soil solar solstice south southeast southwest space sparkle sparrow spawn spice spider spike
spinel spring sprout spruce spur squirrel stadium stalk star starfish starlight starling steam
steel stem steppe stickleback stoat stone stork storm strait strawberry stream summit sun sunbeam
sundew sunfish sunflower sunlight sunrise sunset sunup surf swallow swamp swan sweetpea swift
talon tamarind tanager tangerine teak teal temperature tempest terrace terrain thicket thistle
thorn thunder thunderstorm thyme tide tiger timber timberline toad topaz tornado tortoise toucan
trail tree treetop tributary trout tulip tundra tunnel turkey turquoise twilight
umber underbrush undergrowth uphill upland
valley vanilla vernal violet vine vineyard vista volcano vole
wadi walnut walrus warbler wasp water waterfall waterfowl watershed wave weather weevil west
wetland wheat whirlpool whirlwind whitebeam wildflower wildlife willow wind windmill window
windswept wing winter wisteria wolf wolverine wombat wood woodbine woodland woodpecker worm wren
yarrow yew
zebra zephyr zoo""".split()

# UNITE — of each other. Every family word, role, job, craft, home and town word, tool, game,
# sport, instrument, and everyday thing people do together. The world people made and the work
# they do in it.
UNITE = """abbey academy accord accountant ache acorn address adult advice adviser advocate affair
afternoon agency agenda agent agreement aid aide aim airline airport aisle alarm album alcove
alliance ally alphabet altar alto ambassador amenity amplifier anchor anecdote angel angle ankle
annex answer anthem anthology antique anvil apartment applause appliance apprentice apricot apron
aquarium arcade arch architect archive arena argument armchair armor army arrangement arrival
arrow art article artisan artist artwork ash aside ask aspect assembly asset assistant associate
athlete atlas attic attitude auction audience audio audit auditor aunt author auto autumn avenue
award awning axe
babble baby bachelor backpack bacon badge bag bagel baggage bakery balance balcony ball ballad
balloon ballot bamboo banjo bank banker banner banquet banter bar barbecue barber bard bargain
bark barley barn baron barrel barter base baseball basement basil basin basket bass bat batch bath
bathtub baton battalion battery battle bay beach bead beam bean beard beast beat beauty beaver bed
bedroom bee beech beef beekeeper beer beet beetle beggar beginner behavior belief bell belly belt
bench bend benefit beret berry berth best bet beverage bevel bias bib bicycle bid bill billet bin
binder binding biography biology bird birth biscuit bishop bistro bite bitter black blackberry
blacksmith blade blanket blast blazer bleach blender blessing blimp blind block blouse blunder
board boat bobbin body boil boiler bold bolt bomb bond bone bonfire bonnet bonus book bookcase
bookshop bookstore boom boost boot booth border boss bottle bottom bough boulevard bounce bound
bouquet boutique bow bowl bowler box boxer boy boycott bracelet bracket braid brain brake branch
brand brass brave bread break breakfast breath brewer briar brick bride bridegroom bridge
briefcase brigade bright bring brisk broadcast brochure broker bronze brooch broom broth brother
brown browse brunch brush bucket buckle bud budget buffet bugle build builder building bulb bull
bulletin bunch bundle bunk bunny bureau burglar burial burn burrow burst bus bush business bushel
butcher butler butter button buyer buzz
cab cabbage cabin cabinet cable cache cafe cafeteria cage cake calendar calf caliber call caller
calm camel camera camp campaign campus can canal candle candy cane cannon canoe canopy canteen
canvas cap cape capital captain car caravan carbon card cardboard care career cargo carpenter
carpet carriage carrier carrot cart cartoon carve case cash cashier casino cask cast castle cat
catalog catcher category caterer cathedral cattle cauliflower cause caution cave caviar ceiling
celebrate cellar cello cement cemetery census cent center cereal ceremony certain chain chair
chairman chalk challenge chamber champion chance chandelier change channel chant chapel chaplain
chapter charcoal charge charity charm chart charter chase chat chauffeur check checkers cheek
cheer cheese chef chemical cheque cherry chess chest chestnut chew chicken chief child childhood
chill chime chimney chin china chip chisel chocolate choice choir chorus chowder chrome chronicle
chuck chunk church churn cider cigar cinema circle circuit circus citizen city civil claim clam
clamp clan clap clarify clarinet clarity clash clasp class classic classroom clatter claw clay
cleaner clearance cleric clerk clever click client clinic clip cloak clock closet cloth clothes
cloud clover clown club clue clump cluster clutch coach coal coalition coast coat cocoa coconut
cod code coffee coin coke cold collar colleague collect college colonel colony color column comb
combat combine comedy comet comfort comic comma command comment commerce commission committee
commodity commons commune company compare compass compete competition complaint composer compost
comptroller computer comrade concert concession concrete condition conductor cone conference
confess confirm conflict congress connect conquer console consonant constant consul contact
contest context continent contract contrast control convent conversation convert convey convict
cook cookie cooler cooper coop copy coral cord cordial cork corn corner coroner corporal corps
correct corridor cost costume cottage cotton couch cough council counsel count counter country
county couple coupon course court cousin cove cover cow coward cowboy coworker coy crab crack
cracker cradle craft craftsman crate crater crawl crayon cream create creator creature credit
creek creep crew crib crime crimson cringe crisis critic crockery crook crop cross crouch crowd
crown crumb crush crust crutch cube cubby cuckoo cucumber cuff cuisine culture cup cupboard
curator curb cure curfew curio curl currency current curry curtain curve cushion custard
custodian custom customer cut cutlery cycle cyclist
dad daily dairy dais dam damage damask damp dance dancer dandy danger dare dark darn dart dash
data date daughter dawn day deal dealer dean dear debate debit debt debut decade decor decorate
decorum decoy deed deep deer defeat defend defense deficit degree delay delegate delicacy delight
deliver delivery dell delta demand demise demo denim dentist deny depart department departure
depot depth deputy derby descant descent desert design designer desk dessert destiny detective
detergent develop device devil diagram dial dialect dialogue diameter diamond diaper diary dice
dictation dictionary die diet differ digest digit dignity dike dill dime diner dinner dinosaur
diocese diploma diplomat direction director directory dirt disagreement disaster disc discharge
disciple discipline discount discovery discussion disease disguise dish dishwasher dispute ditch
diver divide dividend divine division divorce dock doctor doctrine document dodge dog dollar doll
dolphin domain dome domestic domino donate donor door doorway dorm dose dot dough dove dowel down
downstairs downtown dozen draft drag dragon drain drama draper drawer drawing dream dress dresser
drift drill drink drive driver drizzle drop drought drove drug drum drummer dry duck duct dud duel
duet duke dull duly dumb dump dunce dune dusk dust duty dwarf dwell dwelling dye dynamo dynasty
eager eagle ear earl early earn earner earnings earring earth ease easel east easy eat eatery
eaves echo eclipse economy edge edifice edit edition editor education eel effect effort egg ego
eight elbow elder election electric elegance element elephant elevator elite elm eloquence embassy
ember emblem embrace embroidery emerald emergency emigrant emotion emperor empire employee
employer employment empress empty enact enamel encore encourage encyclopedia end endeavor ending
endive enemy energy engine engineer engraver enigma enjoy enlarge enlist enmity ensemble enquiry
ensign enterprise entertain enthusiasm entire entrance entry envelope envoy envy epic
epidemic episode equal equator equestrian equity era errand error escalator escape escort essay
essayist estate esteem estimate ethics etiquette eucalyptus evacuate event evidence evolution exam
example exchange excise excite excuse executive exercise exhibit exhibition exile exit expand
expanse expect expedite expense experience expert explain explode exploit explore explorer export
expose express extent extract eyebrow eyewitness
fable fabric facade face facility facing factor factory faculty fade fagot fahrenheit fail
failure fain faint fair fairy faith falcon fall fame family famine fan fanfare fang fantasy far
fare farewell farm farmer farming fashion fast fasten fat fate father fathom fatigue fault favor
fawn fear feast feat feather feature federal fee feeble feed feedback feel feeling fellow felony
felt fence fencer ferment fern ferry fertile festival fetch fever fiance fiber fiction fiddle
fidelity field fiend fierce fig fight figure file filet fill fillet film filter fin finance
finch find finder fine finger finish fir fire firearm firefighter firefly fireplace firewood firm
first fish fisherman fishery fist fit fitter fix fixture flag flake flame flank flannel flap flash
flask flat flavor flax flea flee fleet flesh flex flick flight flint flip float flock flood floor
flop flour flourish flow flower flu flue fluid flute fly foam focus fog foil fold folder folk
follow font food fool foot football footprint forage force ford foreman forest forge fork form
format former formula fort fortune forum forward fossil foster foul found foundation founder
fountain fowl fox fraction fragrance frame franchise frank fraud freak free freedom freeze freight
french frenzy fresco fret friar friction fridge friend friendship fright fringe frock frog front
frost frown fruit fry fuel fugitive fun function fund funeral fungus fur furlong furnace furnish
furniture furrow further fuse fuss future
gable gadget gag gain gait gala galaxy gallery gallon gallop gamble gambler game gander gang gap
garage garbage garden gardener garland garlic garment garnish garrison garter gas gash gasp gate
gather gathering gauge gaunt gauze gaze gazebo gazette gear gecko gee geese gel gem general
genesis genius gentle gentleman gentry geography geology geometry geranium germ germany geyser
ghost giant gift gig giggle gild gill gin ginger giraffe girdle girl girth giver glacier glade
gland glare glass glaze gleam glee glide glider glimpse glint globe gloom glory gloss glove glow
glue goal goat goblet god gold golfer gong goose gorge gospel gossip gourmet gown grab grace
grade graduate graft grain gram grammar granary grand grandchild grandfather grandmother grandson
granite granny grant grape graph grapple grasp grass grate gratitude grave gravel gravity gravy
gray graze grease great greed green greet greeting grid grief grill grime grin grind grinder grip
gripe grocery groom groove grope gross ground group grove grow grower growth grub guard guardian
guess guest guidance guide guild guilt guitar guitarist gulf gum gun gunner gush gust gutter gym
gymnast
habit hack hammer hammock hamper hamster hand handbag handful handle handyman hang hanger harbor
hardware hare harm harmony harness harp harpist harpoon harvest hat hatch hatchet haul haunt
haven havoc hawk hay hazard haze hazel head headache header headlight heal health heap hear
hearing heart hearth heat heater heaven heavy hedge heel height heir helicopter helmet help
helper hem hemisphere hen herald herb herd herder heritage hermit hero heroine herring hew
hickory hide hieroglyph high highway hike hiker hill hilt hind hinge hint hip hire historian
history hit hitch hive hoard hobby hockey hoe hog hold holder hole holiday hollow holster holy
home homeland homer homestead homework honest honey honeybee honor hood hoof hook hoop hop hope
horizon horn hornet horror horse hose hospital host hostel hostess hotel hound hour house
household housewife housing hover hub huddle hue hug huge hull hum human humor hunch hundred
hunger hunt hunter hurdle hurl hurricane hurry hurt hush hut hyacinth hybrid hymn
ice cream icon idea ideal idiom idle idol igloo image imagine imitation imp impact import impost
impression imprint improve impulse inch income index industry infant inform ingredient inherit
initial ink inn inning innocent input inquiry insect inside insight inspection inspector instance
instant institute instruction instructor instrument insulation insult insurance integer intellect
interest interior intern internet interview intimacy invention inventor inventory investor
invitation invite iron island isle issue item ivory ivy
jacket jack jade jaguar jail jam janitor jar jasmine javelin jaw jazz jeans jell jelly jersey
jester jet jewel jeweler jigsaw job jockey jog join joiner joint joker journal journalist journey
joy judge jug juggler juice jukebox jumble jump jumper junction jungle junior junk jury justice
kaleidoscope kangaroo karate keel keen keep keeper keg kennel kernel kettle key keyboard keystone
khan kick kid kidney kiln kilt kind kindergarten kindle kindness king kingdom kiosk kiss kit
kitchen kite kitten kitty knapsack knee kneel knife knight knit knitter knob knock knot knowledge
knuckle
label labor laboratory lace ladder ladle lady lagoon lamp lantern lap lapel lapse laptop larder
lark lash lasso latch lathe lattice laugh laughter launch laundry laurel lavatory lavender law
lawyer lawn layer layout lazy leader leadership leaf league leak lean leap lease leash leather
lecture ledger leek left leg legacy legend legislator leisure lemon lemonade lend lender length
lens leopard lesson letter lettuce level lever liberty library license lick lid lieutenant life
lift light lighthouse lightning lilac lily limb lime limousine line linen liner lingerie link
lint lion lip liquid list listen listener listing literature litter liver living lizard load loaf
loan lobby lobster local lock locker locomotive lodge lodging loft log logic logo loincloth lotion
lot lottery lounge louse love lover low loyal luck luggage lumber lump lunch lung lurch lure lurk
macaroni machine machinist madam magazine magic magistrate magnet magnifier maid mail mailbox
main major make maker makeup mall mallet malt manager mandate mane manner manor mansion manual
manufacturer manuscript map maple marble march mare margin marina marine mariner marker market
marriage marrow marsh marshal mask mason masquerade mass massage mast master mat match mate
material math matron matter mattress mayor meadow meal meaning measure meat mechanic medal media
medicine medley meeting melody melon member memorial memory mend menu merchant mercy merge merit
mermaid merry mesh message messenger metal meter method metric microphone microscope midday
middle midnight midst might mildew mile mileage military milk mill miller million mind mine miner
mineral minister ministry minor mint minute miracle mirror misery miss missile mission mist
mitten mixer mixture moan mob mobile mock mode model modem modest module moist mold mole moment
monarch monastery money monk monkey monopoly month monument mood moon moor moose mop moral
morning mortgage mosaic mosque moss motel moth mother motion motive motor motto mould mound mount
mountain mouse moustache mouth move movement mover movie mower mud muffin mug mule multiply
muscle museum mushroom music musician musk must mustard mutton mystery myth
nail name napkin narrate narrator nation native nature navy near neat neck necklace nectar need
needle neighbor neighbourhood nephew nerve nest net network news newspaper newsstand nib niche
nickel niece night nightmare nimble nine noble nod node noise nomad nominee noodle noon norm
north nose note notebook nothing notice notion noun nourish novel novelist novelty number nurse
nursery nut nutmeg nylon
oar oasis oat oath obedience obelisk object oblige oboe observe observer obstacle occasion
occupant occupation ocean odd odor offer office officer official offset oil ointment olive omelet
omission onion online onyx opal opera operator opinion opossum opponent opportunity opposite
option orange orchard orchestra orchid order ordinary ore organ organic organism organization
organizer ornament orphan ostrich ounce outcome outfit outing outlaw outlet outline outlook
output outrigger outside oval oven overcoat overalls overlap overture owner ownership oxford
oyster ozone
pace pack package packet pad paddle padlock page pageant pail pain paint painter painting pair
palace palate pale palette palm pamphlet pan pancake pane panel panic pansy pant pantry pants
papa paper parachute parade parcel parchment pardon parent parish park parlor parrot parsley
parsnip part partner party pass passage passenger passer passion passport past pasta pastel
pastor pastry pasture patch patent path patience patient patio patrol patron pattern pause pave
pavement pavilion paw pawn pay payment pea peace peach peacock peak peanut pear pearl peasant
pebble pecan pedal peel peep peer peg pelican pen penalty pencil pendant penguin peninsula penny
pension people pepper peppermint perfume pergola period permit person pet petal petition
petticoat petunia pewter phantom pharmacy phase pheasant phobia phone photo phrase physician
piano piccolo pick pickle picnic picture pie piece pier pierce pig pigeon piglet pile pilgrim
pillar pillow pilot pin pinch pine pinecone pineapple pink pinnacle pint pioneer pipe pipeline
piper pistol piston pitcher pitch pity pixel pizza place placard plague plain plaid plane planet
plank plant plaster plastic plate plateau platform platinum platter play player playground
playhouse playmate playwright plaza plea plead pleasant please pleasure pledge plenty pliers plot
plow plug plum plumage plumber plume plump plunder plunge plus plywood
pocket poem poet poetry point pointer poison poker polar pole police polish polite polka poll
polo pomp pond poncho pony poodle pool poor pop popcorn pope poplar poppy popular porch porcupine
pork port porter portfolio portion portrait portray pose position positive possible post poster
postman pot potato pottery pouch poultry pounce pound pour pout powder power practice prairie
praise prank pray prayer preacher precious precise predicate predict prefer prefix premium
prepare present preserver president press pressure prestige pretty prevent preview prey price
pride priest primary prince princess principal principle print printer prior prism prison
private prize problem procedure proceed process proclaim produce product professor profile
profit program progress project promise promoter proof property prophet proposal propose prospect
protect protein protest proud prove provide province provision provoke prudent prune pry public
publish publisher pudding puddle puff pull pulley pulp pulse pump pumpkin punch pupil puppy
purchase pure purple purpose purse pursue push puzzle pyramid
quack quail quaint quake qualify quality quantity quarrel quarry quarter queen query quest
question queue quiche quick quiet quilt quill quince quiver quota quote
rabbit race racer rack racket radar radio radish raft rag rage raid rail railroad railway rain
rainbow raisin rake rally ram ramp ranch rancher range rank ransom rap rascal rasp rate rattle
raven raw ray razor reach react read reader reading ready real realm reaper rear reason rebel
receipt receive receiver recess recipe recital recite reckon record recorder recover recruit
rectangle rector recycle red reduce reed reef refer refine reflect reform refresh refuge refund
refuse regal regard regent regime region register registry regret regular rehearsal reindeer
reign reject rejoice relate relative relay release relief relish remain remark remedy reminder
remnant remote remove render rendezvous renew rent rep repair repeat reply report reporter
request rescue research resemble reserve reservoir reset reside resident resign resin resist
resolve resort resource respect respond rest restaurant restore result resume retail retire
retreat return reunion reveal revel revenge revenue reverse review revise revision revival
revolt revolution reward rhubarb rhyme rhythm ribbon rice riddle ride rider ridge rifle rig
right rigid rim ring rinse riot rip ripe ripple rise risk rite ritual rival river rivet road
roast rob robe robin robot rock rocket rod rogue role roll roller romance roof rook room rooster
root rope rose roster rotary rotate rotor rouge rough round route router routine rove row rower
royal rub rubber rubbish ruby rudder ruffle rug rugby ruin rule ruler rumble rumor rump run
runner rural ruse rush rust rut
sack saddle safe safety sage sail sailor saint salad salami salary sale salesman saline salon
saloon salt salute salvage sample sand sandal sandwich sanitary sink sapphire sardine sash
satchel satin satire satisfaction sauce saucer sausage savage save saver savings saw sawdust
sawmill scaffold scale scalp scan scandal scarf scarlet scatter scene scenery scent schedule
scheme scholar school science scientist scissors scold scoop scooter score scorer scout scramble
scrap scrape scratch scream screen screw scribe script scroll scrub sculpture scythe sea seafood
seal seam seamstress search season seat second secret secretary section sector secure sedan
sediment seed seek seem seep seize seizure select self seller semester seminar senate senator
sender senior sense sentence sentry separate sequel sequence serf sergeant serial series sermon
serpent servant serve server service session set settler settle setup seven sever sew sewer
sewing shabby shack shade shadow shaft shag shake shale shallot shallow shame shampoo shanty
shape share shark sharp shave shawl sheaf shear sheath shed sheep sheet shelf shell shelter
shepherd sheriff shield shift shilling shin shine ship shipment shipyard shire shirt shiver
shoal shock shoe shoemaker shoot shooter shop shopper shore short shot shoulder shout shovel
show shower shred shrimp shrine shrink shrub shrug shuffle shun shunt shut shutter shuttle shy
sibling sick side sideline siege sieve sift sigh sight sign signal signature signet silence
silk sill silo silt silver similar simmer simple sin since singer single sink siphon sir siren
sister sit site situation six size skate skater sketch ski skid skill skin skipper skirt skull
sky slab slack slam slang slant slap slate slave slay sledge sleep sleeve sleigh slice slide
sling slipper slit slogan slope slot sloth slum slump smack small smart smash smell smile smith
smock smoke smoker smooth snack snail snake snap snapshot sneak sneaker sneeze sniff snip snoop
snore snout snow snuff soap soar sob soccer social society sociable sock socket sofa soft soil
sold soldier sole solo solve sombrero song sonnet sonata soprano sort soul sound soup sour
source south souvenir sovereign sow spade spaghetti span spaniel spare spark sparrow spatula
speak speaker spear special species speck speech speed spell speller spend spender sphere sphinx
spice spider spike spill spin spinach spine spiral spirit spite splash split spoil spoke sponge
sponsor spoon sport spot spouse spout sprain spray spread spring sprinkle sprint sprout spur spy
squad square squash squeak squeeze squid squirrel stab stability stable stack stadium staff stag
stage stager stain stair stake stall stamp stance stand standard staple star starch stare
starfish start startle state station stationery statue stature status stay steak steal steam
steamer steel steeple steer stem stencil step stereo sterling steward stick sticker stiff stifle
still stilt stitch stock stocking stomach stone stool stoop stop store storeroom storm story
stove strap straw strawberry stream street strength stress stretch stile sting stow strait strand
stranger stray streak stride strife strike string strip stripe strive stroke stroll strong
structure struggle strut stub student studio study stuff stumble stump stun stunt style subject
submit subscribe subsidy substance suburb subway success successor suit suite suitor sulfur sum
summary summer summit summon sun sundae sunder sunflower sunny sunset supper supply support
suppose supreme surcharge surface surgeon surgery surname surplus surprise survey survive suspect
suspend swallow swan swap swarm sway swear sweat sweater sweep sweet swell swerve swift swim
swimmer swindle swine swing switch swivel sword syllable symbol sympathy symptom synagogue
syndicate synonym syrup system
tab table tableau tablet tabloid tack tackle tactic tag tail tailor tale talent talk talker tall
tally talon tambourine tan tandem tang tango tank tanker tannery tap tape taper tapestry tar
target tariff tarnish tarpaulin task tassel taste taster tavern tax taxi taxpayer tea teach
teacher teaching team teammate teapot tear tease teaspoon technician technique teddy teen teeth
telegram telegraph telephone telescope television tell teller temper temple tempo tenant tend
tender tendon tennis tenor tent tenure tequila term terminal terrace terrain terrier territory
terror test tester testimony text textile texture theater theatre theft theme theory therapy
thermal thesaurus thicket thief thigh thimble thing think thinker third thirst thistle thong
thorn thought thread threat three thresh threshold thrift thrill throat throne throng throttle
through throw thrush thumb thump thunder thyme ticket tickle tidal tide tidy tie tier tiger
tight tile till timber time timer timetable tin tinder tine tinge tinker tinsel tint tiny tip
tipper tirade tire tissue tithe title toad toast tobacco today toddler toe toffee together toil
token toll tomato tomb tome tomorrow ton tone tongue tonight tool toolbox tooth top topic topper
torch tornado torrent torso tortoise torture toss total totem touch tour tourist tournament tow
towel tower town township toy trace track tract tractor trade trader trading tradition traffic
tragedy trail trailer train trainer trait tram tramp trance transit translate translator
transport trap trash travel traveler tray tread treasure treaty trellis tremor trench trend
trespass tress trial triangle tribe tribunal tribute trick trickle tricycle trigger trim trimmer
trinket trip triple triumph trolley troop trophy tropic trot trouble trough troupe trousers
trout trowel truant truck trudge trumpet trunk truss trust trustee truth tub tuba tube tucker
tuesday tug tuition tulip tumble tummy tuna tundra tune tuner tunnel turban turf turkey turmoil
turn turner turnip turnout turnover turret turtle tusk tutor tweed tweezers twig twilight twin
twine twinge twist twitch type typewriter typhoon typist
ukulele ulcer umbrella umpire uncle under undergraduate underpants undershirt understand
undertaker underwear undress unicycle uniform union unit unite university unload unpack unrest
upbringing update upgrade upheaval upholster upkeep uplift upper upset urban usage use user
usher utensil utility
vacancy vacation vaccine vacuum valet valise valley value valve van vandal vane vanilla vanish
vanity vapor variety vase vat vault veal vegetable vehicle veil vein velvet vendor veneer
vengeance venom vent venture venue veranda verb verdict verse version vertex vessel vest vestry
veteran veto viaduct vibrate vicar vice vicinity victory video view viewer vigil vigor villa
village villager vine vinegar vineyard vintage violet violin violinist viper visa viscount
visible vision visit visitor visor vista vitamin vivid vocabulary vocal vogue voice void volcano
volley volume volunteer vote voter voucher vowel voyage
wad wadding wade wafer waffle wage wagon waist waiter waitress waltz wander want war ward warden
wardrobe warehouse warfare warmth warn warrant warrior wash washer washington wasp waste watch
watchman water waterfall wave wax way wayfarer weak wealth weapon wear wearer weasel weather
weave weaver web wedding wedge weed week weekend weekly weep weigh weight weir welcome weld
welder welfare well west wet whack whale wharf wheat wheel wheelchair whiff while whim whimsy
whine whip whir whirl whisk whisker whisper whistle white whole wholesale wick wicket wide widow
width wife wig wigwam wild wilderness will willow win winch wind window windscreen wine wing wink
winner winter wire wiretap wisdom wise wish wit witch witness wizard woe wolf woman wonder wood
woodcarver wooden woodwind wool word work worker workflow workshop world worm worry worship
worth wound wrap wrapper wreath wreck wrench wrestle wretch wring wrinkle wrist write writer
writing
xylophone yacht yard yarn year yearbook yeast yell yellow yelp yeoman yield yoga yogurt yolk
youth yuletide
zeal zebra zenith zephyr zero zest zigzag zinc zipper zither zodiac zone zoo zoology""".split()

# RISE — of what lifts. Every virtue, feeling of joy or love, and every word of light, colour,
# music, art, dream, hope, faith, beauty and uplift. What a person reaches for.
RISE = """abide ability able abound abundance acclaim accolade accord accredit ace acknowledge
acumen adept adhere admire adorable adore adorn adulthood advance adventure adventurous advocate
affable affection affinity affirm aflutter agape agility agile aglow agree agreeable alacrity
alight alive allay allegiance allure aloft altruism amaze amazement ambition amble amen amiable
amicable amity ample amplify amuse amusement angelic angel answer anthem anticipate aplomb appeal
applaud applause appreciate appreciation approachable approve aptitude ardor ardent arise
armistice arouse array artistry ascend ascent aspiration aspire assuage assurance assure astonish
astound astral astute attentive attune aubade audible august aura auspicious authentic autonomy
avail avow awake awaken award awe awesome
balance balm balmy bard bashful bask beacon beam beaming bearable beatific beatify beautiful
beautify beauty beckon bedeck bedazzle befit befriend beguile behalf behold beloved benediction
beneficence beneficial benefit benevolence benevolent benign bequeath beseech bestow bewitch
bighearted bless blessed blessing bliss blissful blithe bloom blossom bold boldness bonhomie
bonny bonus boon boundless bountiful bounty bouquet bower brainwave brave bravery bravo breadth
breathe breeze bright brighten brilliance brilliant brisk brotherhood buoyant burnish
cadence cajole calm candle candor canon canvas caper captivate care career carefree careful
caress caring carol cascade celebrate celebrated celebration celestial ceremony champion
chanticleer chapel charity charm charmed charmer charming chaste cheer cheerful cheerfulness
cherish chime chirp chivalry choice chortle chorus chrism chronicle chuckle chum circulate
civility clarity classic clean cleanse clear clearance clearheaded clemency clever climb clinch
cloak clover coax cogent cognizant coherence comfort comfy comic commemorate commend compassion
compatible compel composure comprehend comprehensive compromise concede conceive concentrate
concern conciliate concord concourse condone conducive confidant confide confidence confident
congenial congratulate connect conscience conscious consecrate consent consider considerable
console constancy constant contemplate content contentment continual contribute contrive
conversant conviction convince cordial cordiality coruscate courage courageous courtesy cozy
craft creative creature credit creed crescent crisp croon crown crucial crucible crusade cuddle
cultivate cultured cunning cupid curious curiosity
dainty dance dandy daring darling dazzle deacon dear dearness debut decency decent declare
decorous dedication deed deem deep deepen defer deferential defiant deft delectable delegate
delicate delight delightful deliverance demeanor dependable devotion devoted dexterity dignify
dignity diligence diligent dimple diplomacy diplomatic discover discovery discretion discreet
discuss divine divinity docile dogma donate doodle double doughty downy doyen draft drama dream
dreamer dreamy dress drift drive dulcet dutiful dwell dynamic
earnest ease easy ebullient ecstasy ecstatic edify edifying effectual effervesce efficacious
effortless effulgent elan elate elated elation elegance elegant elicit elixir eloquence eloquent
elucidation emanate emblazon embrace eminence eminent empathy emphasize empower enamor enchant
enchanting encompass encourage encouragement endear endeavor endless endure energetic energy
enfold engage engaging enhance enjoin enliven ennoble enormous enrapture enrich enshrine ensign
entertain enthrall enthusiasm enthusiast entice entire entreat envelop envisage envision envoy
epaulet ephemeral epiphany epitome equal equanimity equip equity erudite escape esoteric essence
esteem eternal eternity ethical eulogy euphoria euphoric evangelize even evenness eventful
everlasting evident exact exalted exaltation excellence excellent excite exclaim exculpate
exemplary exempt exert exhale exhilarate exhilaration exhort exodus exonerate expand expanse
expect expedition expertise explain explore exquisite extol exuberance exuberant exude exult
fabulous facet facilitate facility fact fair fairytale faithful faithfulness fame familiar
family famous fanciful fancy fantasia fantastic fantasy fascinate fascinating fashion fasten
fate fathom favor favorable favorite fawn fearless feast feat feather feature feeling felicitous
felicity fellow ferment fertile fervent fervid fervor festival fetch fete fiance fiat fiber
fiction fidelity fidget fierce fiesta figure filigree fine finesse finish firm first flatter
flavor flawless fledgling fleet flexible flicker fling flint flourish fluency fluent flurry
flush flute flutter foam focus fond fondle fondness forbear forgive forgiveness forlorn
forthright fortitude fortress foster fountain frank frankness fraternal free freedom fresh
freshen friendly friendship frighten frisky frolic frugal fruitful fruition fulfill fulfillment
fun function fundamental furnish further
gaiety gaily gain gala gallant galvanize gamble gem generous generosity genial geniality genius
genteel genuine geranium gift giddy giggle gild gird girder give giver glad gladden gladness
gleam glean glee gleeful glide glimmer glisten glitter glorify glorious glory gloss glow good
goodness goodwill gorgeous grace graceful gracious graduate grand grandeur grant graphic grateful
gratitude great green greet greeting grief grin grip grit groovy groom grow growth guard
guidance guide guild guile gusto
habit hail halo handcraft handsome handy happily happiness happy harbor harden hardy harm
harmless harmony harvest hasten hatch heal healing health healthy heart hearten heartfelt hearth
hearty heaven heavenly heed heirloom heighten hello help helpful herald heraldic heritage hero
heroic heroine hew hilarity hint holy homage home honest honesty honor honorable hope hopeful
horizon hospitable hospitality host hug humane humble humility humor hurrah hush hymn
ideal idealism idyllic ignite ignition illume illuminate illumination illumine illustrate
illustrious imagine imaginative imbue imitate immaculate immaterial immense immerse immortal
immunity impassion impart impartial impassioned impeccable impel imperative imperial
imperturbable impetus implore importance important impress impression improve improvise impulse
inaugurate incentive incense inception incite incline include incorruptible increase incredible
indelible indemnity indomitable indulge industrious ineffable infallible infatuation infinite
inflame influence inform infuse ingenious ingenuity inherit initiate initiative inject injunction
innate inner innocence innocent innovate inquire inquisitive insight insightful inspire inspired
inspiration instant instinct instruct instrument integrity intellect intelligent intend intense
intention interest intimate intone intrepid intrigue introduce intuition invent invention invest
invisible invitation invite invoke involve iridescent iris iron irony irradiate irresistible
jubilant jubilee judicious juggle jolly joust joy joyful joyous jubilation just justice justify
keel keen keenness keep keeper keepsake kind kindle kindness king kinship kiss knight kudos
laden ladylike lambent lark lasso last lasting laud laudable laugh laughter launch laurel lavish
law lawful lead leader league lean leap learn learned learning lecture leeway legend legendary
legible leisure lend lenient leonine lesson letter level liberty lifetime lift light lighten
lighthouse lighthearted like likable liking limber limitless linger link linnet lion list listen
lithe lithesome live lively livery lofty logic longevity lookout loom love lovable loved lovely
lover loving loyal loyalty lucent lucid luck lucky lucrative lull lullaby luminous lure lush
luster luxuriant luxuriate luxury lyric lyrical
magic magical magnanimous magnify magnitude maiden majestic majesty make maker manifest manifold
many marvel marvelous mask mason master mastery mature maverick mead meadow mellow melody meld
mellifluous memorable memory mend merciful mercy merge merit meritorious merriment merry mesh
mettle meteor method meticulous midnight might migrate mild milestone mindful mind miracle mirth
mirror mission mister mistress mistletoe mitigate mitten mix modesty modest moment momentum
monarch monogram moral morale morality morning morsel motion motivate motivation motto mount
mourn move movement mull multiply muse music musical musician muster mutual mystery mystic
naive naked name narrate nascent natal nation native natural nativity nature navigable navigate
near neat necessary nectar need needle negate negotiate neighbor neighborhood nerve nestle never
new news next nice niche nigh nimble noble nobility nocturne nod nomad nonchalant normal north
notable note notice nourish novel novelty nuance nucleus nudge numinous nurse nurture nutriment
oasis oath obedience obeisance oblige obliging observance observe obsess obtain obvious occasion
occupy occur ocean ode odor offer offering office officiate offspring ointment old olympian
omega omen onward open opener opening opera operate opinion opulent oracle oral orange oration
orator orbit orchard ordain order orderly ordinary organ organic orient originate ornament
ornate orphan oscillate outlast outlive outlook outpace outshine outstrip outward oval ovation
overcome overflow overhaul overhead overjoy overlap overlook oversee overture owe owl own owner
pacify pact page pageant painstaking palatable palate pale palette palmy palpable panorama
pantomime papyrus parable parade paradigm paradise paragon parallel paramount parasol parch
pardon parent parish park parley parody parrot parry partake partial participate particle
partisan partner party pass passage passion passionate passive pastel pastoral patch patent path
pathfinder patience patient patriot patrol patron pattern pause pave peace peaceful peach peak
pearl peculiar pedal pedigree peer peerless pen penchant pendant penetrating peninsula pensive
perceive perceptive perfect perfection perform perfume perhaps period permanence permit perpetual
perpetuate persevere persistence personable perspective persuade pet petal petition phantom phase
phenomenon philosopher philosophy phoenix phrase physical piano pick picturesque piece pierce
piety pigment pilgrim pillar pilot pinch pine pinnacle pioneer pious pipeline pique pithy pity
pivot placid plain plaintive plan plane planet plant plaque plateau platform play playful
playmate plaza plea pleasant please pleased pleasing pleasure pledge plentiful plenty pliant
pluck plum plumage plumb plummet plump plush poetic poetry poignancy poignant point poise poised
polish polite political poll pollen ponder popular populous porcelain portend porter portion
portrait portray pose position positive possess possible post poster posterity potent potential
pounce pound pour pout power practice prairie praise praiseworthy prance prank praxis pray
prayer preach preamble precede precedent precept precious precipice precise predilection
preeminent preface prefer preferential prelude premier premise premium prepare preponderance
preposterous prerogative presage prescient prescribe presence present preserve preside press
prestige presumptuous pretend pretty prevail prevalence prevent priceless pride priest primal
primary prime primer primeval primrose prince principle print prism pristine privacy privilege
prize probe proceed proclaim proclivity procure prodigal prodigious produce product profess
proficiency profile profit profound profuse progeny prognosis program progress prohibit project
prolific prologue prolong promenade prominent promise promontory promote prompt promptitude
prone pronounce proof propel propensity proper property prophecy prophet propitious proportion
propose prosaic prosper prosperity prosperous protect protege protest proud prove providence
provide province provoke prowess proximity prudent prune psalm psyche public publish pucker puff
pull pulpit pulse pump punctual pungent purchase pure purge purify purity purpose pursue pursuit
puzzle
quaint quaff quail quake qualify quality qualm quantity quarrel quarter queen quell quench query
quest question quick quiet quill quilt quip quirk quite quiver quota quote quotidian
radiant radiance radiate radical radio raft rage raid rail raiment rain raise rally ramble
rampant ranch random range rank ransom rapid rapport rapt rapture rare rascal rate rather ratio
rational rave reach read readiness ready real realm reap rear reason reassure rebel rebuff
rebuild rebuke recall recede receive recent reception receptive recess recipe recipient recital
recite reckoning reclaim recline recognize recollect recommend recompense reconcile record
recount recover recreation recruit rectify recur redeem redemption redress reduce refer refine
refinement reflect reform refrain refresh refuge refund refuse regal regard regenerate regent
regime region register regress regret regular regulate rehearse reign reinforce reinstate rejoice
rejoin rejuvenate relate relax release relegate relent relevant reliable reliance relief relieve
religion relinquish relish relive remain remedy remember remembrance remind reminisce remiss
remnant remonstrate remorse remote remove render renew renounce renown repair reparation repay
repeal repeat repel repent replete replica reply report repose represent reprieve reproach
reproduce reprove republic repute request require rescue research resemble resent reserve reside
residue resign resilient resist resolve resonance resonant resource respect respite respond rest
restore restraint result resume resurgence retain retire retort retreat retrieve return reunion
reunite reveal revel revelation revenge revere reverence reverse revert review revise revive
revoke revolt revolution revue reward rhapsody rhetoric rhyme rhythm ribbon rich riches riddle
ride rife right righteous rigid rigor rill rim ring rinse riot ripe ripen ripple rise risk rite
ritual rival river rivet road roam roar roast rob robe robin robust rock rocket rod rogue role
roll romance romantic roof rook room root rope rosary rose rosemary roster rosy rough round
rouse route routine rove row royal rub rubber ruddy ruffle rugged ruin rule ruminate run rung
rural ruse rush rust rustle
sabbath sable saber sabre sachet sacred sacrifice saddle safe safeguard sagacious sage saint
sainted salient sally salutation salute salvation salve sanctify sanctity sanctuary sane sanity
sap sapling sapphire sarcasm sash satchel sate satiate satin satire satisfaction satisfactory
satisfy saturate sauce saunter save savor savory savvy say scaffold scald scale scallop scalp
scamper scandal scarce scare scarf scarlet scatter scenario scene scenery scent scepter schedule
scheme scholar scholarship science scintillate scissors scone scoop scope scorch score scorn
scour scout scowl scramble scrap scrape scratch scream screen scribble scribe script scroll
scruple scrutiny sculpt sculpture scurry sea seal seam search season seat seclude second secret
sect secure sedate sedative seduce see seed seek seem seep seethe segment seize select selfless
seminar senate send senior sensation sense sensibility sensible sensitive sentient sentiment
sentinel separate sepia seraph serenade serene serenity sermon serendipity sergeant serial series
serious servant serve session settle several severe sew shabby shack shade shadow shaft shake
shanty shape share sharp shatter shawl sheaf shear sheen sheep sheer sheet shelf shell shelter
shepherd sheriff shield shift shine shiny ship shire shiver shock shone shore short shoulder
shout show shower shred shrewd shriek shrill shrine shrink shroud shrub shrug shuffle shun shy
sibilant sigh sight sign signal significance silence silent silk silken sill silver similar
simmer simple simplicity simplify sincere sincerity sinew sinewy sing singer single singular
sink sip siphon sire siren sister sit site situation six size sizzle skate sketch skew sky slack
sleek sleep sleight slender slice slide slight slim slip slither slogan slope slow slug slumber
slump sly small smart smash smear smell smile smirk smooth smother snug soar sober sociable
social society soft soften solace solar sole solemn solid solidarity solitary solitude solstice
solve somber song sonnet soothe sophisticated soprano sorcery sorority sorrow soul sound
soundness soup source sovereign sow space spacious spare spark sparkle sparrow sparse spatial
speak special specimen spectacle spectacular spectrum speculate speech speed spell spend sphere
sphinx spice spike spill spin spindle spine spiral spirit spirited spiritual spite splendid
splendor splinter split spoil spoke sponsor spontaneous spool spoon sport spot spouse spout
sprawl spray spread spree spring sprint sprout spruce spur spurn spy squabble squad squall
square squash squeak squeal squeeze squirrel stab stability stable stack stadium staff stag
stage stagger stagnant stain stair stake stale stalk stall stalwart stamina stamp stance stand
standard star starch stare stark starling start startle starve state stately statement station
statue stature status stay steadfast steady steal steam steel steep steer stellar stem stencil
step stern steward stick stiff stifle still stilt stimulant stimulate sting stir stitch stock
stocking stoic stoke stomach stone stoop stop store stork storm story stout stove straddle
straggle straight strain strait strand strange stranger strap strategy straw stray streak stream
street strength strengthen strenuous stress stretch strew stricken strict stride strife strike
string stringent strip stripe strive stroke stroll strong structure struggle strut stubborn
student studio study stuff stumble stump stun stunning stunt sturdy style suave subject sublime
submit subordinate subscribe subsequent subside subsist substance substantial subtle subvert
succeed success succulent succumb sudden sue suffice sufficient suffuse sugar suggest suit
suitable suite suitor sullen sultan sultry sum summary summer summit summon sun sunder sunny
superb superior superlative supervise supper supple supplement supply support suppose supreme
sure surface surge surgeon surmise surmount surname surpass surplus surprise surrender surround
survey survive susceptible suspect suspend sustain swagger swallow swan swap swarm sway swear
sweat sweep sweet swell swelter swerve swift swim swindle swine swing swirl switch swoon swoop
sword syllable symbol symmetry sympathetic sympathy symphony symptom synergy synopsis syntax
system
table tableau tacit taciturn tack tackle tact tactic tag tail tailor taint take tale talent
talisman talk tall tally talon tame tamper tangible tangle tank tantalize tantamount tap tape
taper tapestry tardy target tariff tarnish tarry tart task tassel taste tasteful tasty tatter
taunt taut tavern teach teacher team tear tease teaspoon technical technique tedium teem teeth
telling temerity temper temperament temperance temperate temple tempo temporal tempt tenable
tenacious tend tendency tender tenderness tenet tenor tension tentative tenuous tepid term
terminal terminate terrain terrier terrific terrify territory terror terse test testament tether
text texture thank thankful thaw theater theatre theme theory therapy thereby thermal thesaurus
thick thief thieve thin think thirst thistle thorn thorough thought thrall thrash thread threat
three thresh threshold thrift thrill thrive throat throb throne throng throttle through throw
thrust thumb thump thunder thwart tick ticket tickle tide tidy tie tier tiger tight tile till
timber timbre time timid timorous tin tincture tinge tingle tinker tint tiny tip tirade tire
tissue titan tithe title titter toast today toe toil token tolerate toll tomato tomb tome
tomorrow ton tone tongs tongue tonic tonight tool tooth top topic topple torch tornado torpid
torrent tortoise torture toss total totem touch tough tour tourist tournament tow towel tower
town toy trace track tract trade tradition traffic tragedy trail train trait traitor tram
trample trance tranquil tranquility tranquilize transact transcend transcribe transfer transform
transient transit translate transmit transparent transport transpose trap travel travail traverse
tray tread treasure treat treaty treble tree trek trellis tremble tremendous tremor trench trend
trepidation trespass tress trial triangle tribe tribute trick trickle trifle trigger trim trinket
trio trip triple triumph trivial trod troll troop trophy tropic trot trouble trough troupe
trousers trout trowel truce truck trudge true truism trumpet truncate trunk trust truth try tuba
tube tuck tuft tug tuition tumble tumult tune tuneful tunic turbine turf turmoil turn turnip
turret turtle tusk tutor twain tweak tweed tweet twelve twiddle twig twilight twine twinge
twinkle twirl twist twitch two tycoon type typical
ultimate umbra unanimous unbend unbounded unbroken uncanny uncertain uncle uncommon unconditional
uncover undaunted undeniable undergird underlie undermine understand undertake underwrite undo
undulate unearth uneasy unequivocal unfailing unfair unfold unfurl ungainly unguarded unhappy
unharmed unify union unique unite unity universal universe university unjust unkempt unknown
unlawful unless unlike unload unmatched unnerve unobtrusive unpretentious unravel unrest
unruly unsafe unseemly unsettle unsightly unsung untamed untold untoward unusual unveil unwell
unwieldy unwitting upbeat upcoming update upgrade upheaval uphold upkeep uplift uplifted upper
upright uproar uproot upset upshot upstairs upstart upstream upsurge upturn upward urban urge
urgent usage use useful usher usual utensil utility utmost utter
vacant vacation vacillate vacuum vagabond vagary vagrant vague vain valediction valiant valley
valor valuable value valve vanguard vanish vanity vanquish vapid vapor variable variance
variation varied variegated variety various varnish vary vase vast vat vault vaunt veer
vegetate vehement veil vein velocity velvety venerable venerate vengeance venial venture
veracious veracity veranda verbal verbatim verdant verdict verge verify verily veritable verity
vernacular vernal versatile verse version vertex vertical vertigo verve vessel vest vestige
veteran veto vex viable vibrant vibrate vibration vicarious vicinity victory victor vie view
vigilance vigilant vigor vigorous vile village villager vindicate vintage violate violence
violent violet violin virtual virtue virtuoso visage visible vision visit visor vista visual
vital vitality vivacious vivid vocal vocation vogue voice void volatile volition volley voltage
voluble volume voluminous voluntary volunteer voracious vortex vouch voucher vow vowel voyage
vulgar vulnerable vying
wade waft wage wager wail wait wake waken walk wall wallow wander wane want wanton war ward
warden wardrobe ware warfare warm warmth warn warp warrant warrior wary wash wasp waste watch
water wave waver wax way weak weaken wealth wean weapon wear weary weather weave web wed wedge
wee weed week weep weigh weight weird welcome weld welfare well west wet wharf wheat wheel
wherewith whet whim whimper whimsy whine whip whirl whisk whisper whistle white whole wholesome
wicked wide widow width wield wiggle wild wilderness wile will willing willow wilt wily win
wince winch wind window wine wing wink winner winsome winter wipe wire wisdom wise wish wisp
wistful wit witch withdraw wither withhold withstand witness wits wizard woe wolf woman wonder
wondrous wont woo wood wool word work world worm worry worship worth worthy wound woven wrangle
wrap wrath wreathe wreck wrench wrest wrestle wretch wriggle wring wrinkle wrist writhe writing
wrong wry
yacht yard yarn yawn year yearn yearning yeast yell yellow yelp yield yodel yoga yoke yolk
young youth yowl
zeal zealous zenith zephyr zest zigzag zip zippy zither zodiac zone zoom""".split()
