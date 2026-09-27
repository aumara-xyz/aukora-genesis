# THE MAP ROOM · The Schematic of Living Charts

Named by the architect, 2026-07-17: the library is THE MAP ROOM, the cave
expedition's chamber where the ropes and charts are kept. This document is
the schematic for how its documents are held so that they are accessible
through the room, editable right there as the seeing sharpens, and carried
back into the repository without ever duplicating a text or opening a write
lane on the server.

## THE PRINCIPLE

**The room is a lens onto the repository, and a desk for drafting.** One
text, one file, one home in the repository: that is still the whole of what
counts as canon. The room renders what the repository holds, live, with no
build step and no copies. And now the room also lets you work on a chart
directly: a textarea, a live preview through the very lens that will render
the published version, so what you see while drafting is what publishing
will actually look like.

The two halves resolve the same way they always did. The spatial server's
own first invariant reads: GET/HEAD only, no write lane can exist here even
by accident, this process never writes to disk. The Map Room inherits that
constitution rather than negotiating with it, so a draft can only ever live
in the visiting browser (its own local storage, one entry per chart) and
leave the room as a download, never as a network write. The room can
propose a file. It can never write one.

## WHY A MAP ROOM

The room is named for the one thing nobody owns. A map belongs to whoever
walks with it, and it is corrected by anyone who returns from the territory
with better bearings. To claim ownership would be gatekeeping.

The chart room of the cave: where the ropes and charts are kept. What is
gathered here is never cast and never drawn: codes, constructions,
correspondences, and texts kept because they lend clarity to the seeing of
the shapes. Every chart is one living file; the charts grow as the seeing
does.

The map is not the territory. A reading describes and never operates, a
figure is an instrument and never a verdict, the standing cell is weather,
not fate.

The territory is not the map. The world is not obliged to our charts, and
nothing drawn here binds what it draws. This is why the hard law costs
nothing: maps may be split, merged, and re-embedded without a cut ever
landing.

Maps grow and evolve: the charts are living files. And maps are tools for
navigating flows, not things: the canon itself reads no objects, only what
holds still, what flows, and what turns. A wayfinder steers by currents.
That is why the instrument next door bears its name, and why this room
stands beside it.

## THE SIX PIECES

### 1 · The charts live in the repository

Markdown is the native stone. Resident and draft charts live in
`docs/map-room/` (one file per chart) or wherever their existing lineage
already keeps them (see the catalogue's `path`); held volumes (the Topology
PDFs, the book pressings) stay where they already live in `docs/`. The file
IS the chart. There is no second version anywhere: not in HTML, not in a
database, not in a build artefact. A browser draft is not a second version
either: it is unpublished, and it says so of itself (piece 6).

### 2 · The door (serve.ts, read-only)

`spatial/serve.ts` serves `GET /docs/*` from the repository's `docs/`
directory, with `.md` and `.pdf` in the MIME table. Same path-traversal
guard as the existing static routes, same GET/HEAD-only constitution. This
makes every held volume clickable and every chart fetchable. Nothing else
about the server changes, and the desk (piece 6) never asks it to.

### 3 · The catalogue (spatial/app/map-room.json)

The shelf manifest: a JSON array, one entry per chart.

    { "slug": "nodus",
      "title": "THE NODUS",
      "line": "The empty space the whole work revolves around: five laws ...",
      "path": "docs/map-room/THE_NODUS.md",
      "pdf": "docs/....pdf",         // optional: the pressed volume beside it
      "status": "resident",          // resident | draft | held
      "field": "phi",                // trefoil | genus | phi (the station)
      "lineage": ["topology"],       // which style laws bind it
      "added": "2026-07-17" }

Three statuses, not two:

- **resident**, rendered and drafted openly; the text itself is considered
  settled.
- **draft**, rendered and drafted exactly the same way; the status is
  honesty about the TEXT, not a technical difference. A draft chart is
  work in progress: it may need distillation (reduced to its essential
  form, the way the 81 corpus itself is being distilled) or merging (two
  or more pressings of the same seeing, folded into one chart, one file).
  The shelf says so plainly, so nobody mistakes a working draft for a
  settled record.
- **held**, a volume the room links to but does not render (a PDF, or a
  file recorded as living in another lane's repository via `where`).

And beside the status stands **the field**: which of the room's three
benches the chart works at (trefoil, genus, or phi; the section THE
WORKSHOP AND THE MAP gives each its exact criterion). Status says what
state the TEXT is in; field says what kind of WORK the piece is. They are
distinct axes bound by one law: a chart whose field is trefoil must be
resident, because a Map has earned its knot and a draft has not. Where a
chart's text body has a pressed companion (the PDF of a book), the `pdf`
key names it: the text is always the door, the pressing always one touch
away.

Curation is the act of adding or reclassifying one entry, and moving a
chart between benches is one word. The room builds its shelves from this
file and from nothing else, so what the room shows, and what it admits is
still being worked, is always a deliberate choice, recorded in git like
everything else.

### 4 · The lens (spatial/app/map-room-md.js)

A small, self-contained Markdown renderer, roughly a hundred lines, no CDN
and no dependency: headings, paragraphs, emphasis, lists, quotes, code,
links, rules, tables, figures. It exists so the room stays whole offline
and so the rendering can never drift with a third party. It renders text to
HTML and does nothing else: no scripts pass through it, and chart content
is escaped before markup is applied, so a chart (or a draft, mid-edit) can
never inject behaviour into the room. This is the SAME function that draws
the published view and the live desk preview: there is only one lens, so
there can be no drift between drafting and reading.

**The link allowlist**, which is where the lens holds its line. Four prefixes
pass and nothing else: the open web (`http://`, `https://`, opened in their
own tab), the served archive (`/docs/...`), the instruments (`/app/...`), and
the room's own addresses (`#/...`). Every other scheme and shape renders as
plain words, `javascript:` and `data:` among them, and a pin exercises those
shapes so the rule cannot quietly become a blacklist.

The instruments were opened to charts on 19 July 2026 at the architect's word.
Before that a chart could name an instrument's address but not open it, and the
room described itself as texts only. What changed is that a chart may now point
at the surface it describes. What did not change is what that wording was
protecting: the room still reads nothing from the engine, draws nothing, casts
nothing, and imports no engine module. A link is a signpost, not a hand, and
pointing at an instrument is not operating one.

### 5 · The room (luminara-map-room.html)

The page fetches the catalogue, draws the shelves, and routes by hash:
`#/nodus` fetches the chart's file through the door and renders it
through the lens, giving every chart a stable address. Resident and draft
charts render in the article style already built (serif, the Topology
register) and open at the desk; held volumes open directly (the PDFs in the
browser's own reader, or the room records where a cross-lane volume lives).
The room keeps its laws: it imports nothing from the engine, reads no
seeds, draws no cards.

### 6 · The desk (local drafts, two doors out)

Opening a resident or draft chart shows a small toolbar: **VIEW**, **EDIT**,
**DOWNLOAD · MARKDOWN**, **DOWNLOAD · PDF**.

- **EDIT** swaps the rendered article for a textarea holding the raw
  markdown, with a live preview beneath it rendered through the same lens.
  Every keystroke re-renders the preview and saves the draft to this
  browser's `localStorage`, keyed to the chart's slug. Nothing is sent
  anywhere. A line above the desk says plainly whether you are looking at
  a held draft (and when it was last touched, with a one-click way to
  discard it and start again from the repository) or a fresh copy.
- **VIEW** always shows the file as the repository actually holds it,
  never the draft, so a chart's PUBLISHED reading is never silently
  altered by an unfinished edit sitting in someone's browser.
- **DOWNLOAD · MARKDOWN** saves the current text (the draft if you are
  editing, the published text otherwise) as `<slug>.md`, ready to replace
  the file at its catalogue `path` and travel through the lane like any
  other change.
- **DOWNLOAD · PDF** opens the browser's own print dialog, scoped by print
  styles to the rendered chart alone, light text on a plain page. Every
  modern browser's print dialog offers "Save as PDF" as a destination, so
  this needs no library, no server call, and no dependency, the same law
  that keeps the lens resident.

The desk is furniture, not a filing cabinet. Nothing it holds is ever
canon until a human carries the download back into the repository and
commits it.

## THE DESK EDITS, THE LANE PUBLISHES

Drafting now happens in the room. Publishing still walks the same path it
always did:

- **Nothing becomes canon by being typed.** A draft is a local, personal,
  disposable working copy. The file in the repository is the only thing
  any other reader, or the room itself in VIEW mode, ever sees.
- **Git is still the archive of resolutions.** Every sharpening of a chart
  becomes a commit; the history of the seeing is kept exactly as before,
  the desk only makes it faster to reach the point of having something
  worth committing.
- **The lane is still the review.** A downloaded draft travels through the
  same branch and eye as code before it can change what the room shows;
  the desk does not shorten that review, only the drafting that precedes
  it.
- **No new write lane exists to defend.** The server never receives the
  edited text. There is no auth, no conflict handling, no custody rule to
  build, because the server's own answer to every request stays GET/HEAD,
  unchanged, and the desk asks nothing else of it.

By the discipline of provenance: charts in the Topology lineage end with a
provenance section, and when a chart's resolution meaningfully rises, a
line is appended there (date and what sharpened) rather than silently
rewriting the record. The map records its own surveying, whether the
sharpening happened at an external editor or at the desk built into the
room.

## THE WORKSHOP AND THE MAP · THE THREE MOTIONS

The library is one room seen from two sides. The workshop is its expanding
face: source materials, references, the wider field, drafts mid-thought,
everything gathered because it might matter. The map is its distilling
face: the primary distillations, the most potent and applicable form each
seeing has yet reached. One face optimises for growth, the other for
potency, and neither is more finished than the other: a workshop that
stops gathering starves the map, and a map that stops distilling drowns
in its workshop.

Between the two stands the third motion, and it was in the deck all along.
The canon knows three states: what holds still, what flows, and what
turns. The map is the library's stillness, and the cymatic law holds
literally: sand gathers where nothing moves, so the distillates are the
nodes of this room's standing wave. The workshop is its flow. And the
passage between them is the turning: topological deformation, the one
lawful way work moves between the faces. A chart being distilled, split,
merged, or re-embedded is a chart carrying turning marks, and the becoming
law governs it as it governs the cards: the turn completes into a new
stillness, and the deformation is recorded, never hidden.

The room wears the three motions as toggles at its head, named for the
three stations of the reading frame, and each station's name already
contains, as literal mathematical content, the function of its bench.
TREFOIL, THE MAPS: the trefoil is the first true knot, the simplest
structure that cannot be undone by any smooth deformation, and that is
the criterion. A piece earns its place as a Map when further deformation
no longer changes it: refined, accomplished, load-bearing, navigable.
GENUS, THE WORKSHOP: in topology, genus counts holes, the handles and
passages of a surface, the absence that creates identity. The workshop
bench works by increasing the genus of the inquiry: opening doorways,
fractalising into every research pathway, gathering sources valued for
the passages they open rather than the weight they bear. PHI, THE
BECOMING: phi is the proportion invariant under its own continuation,
and the becoming bench is where a working is actively deformed, split,
merged, condensed, re-embedded, to find what stays fixed while
everything turns. When a Phi piece's deformation completes, it crosses
to Trefoil: the becoming law, applied to knowledge. The same three
positions that receive every cast receive the library. The room is read
the way a spread is read.

Every chart carries its field, the bench it stands at, curated and
recorded in the catalogue; the statuses remain the text's own motion
(a draft still turns, a resident chart has settled, a held volume flows
in from beyond the walls), and the one law binding the axes is that a
Map must be resident.

**The hard law: nothing is cut.** Distillation that discards is summary;
distillation that re-embeds is topology. Every sharpening of this library
is a continuous deformation: material may divide into sharper vessels,
merge with a sibling pressing, or condense toward its essence, and in
every case the whole of what was grown remains reachable, in the charts,
in their provenance, and in the archive of resolutions beneath them. The
room was already incapable of cutting by construction; the law names what
the architecture was doing so that no future convenience can undo it.

**The resonance discipline.** Harmonic alignment is not a mood; it is
named. Every chart carries its resonances: the charts it stands in
consonance with, and, when one is found, those it stands in friction
with, the way every card knows its dyads and its counter. The catalogue
records them (`resonates`, and `frictions` when earned), Phi shows the
whole web, and an open chart displays its own, so a reader entering by
any door can see what a seeing touches before choosing where to walk
next. A chart with no named resonances is either the first of its kind
or not yet listened to, and Phi says how many still wait.

## THE PINS (core/tests/mapRoom.test.ts)

Mechanical honesty, run with the rest of the suite:

- every catalogue entry's `path` exists in the repository;
- slugs are unique and kebab-case; every chart file begins with a title;
- status is one of `resident`, `draft`, `held`; resident and draft doors
  both open onto a real markdown file (the desk does not distinguish
  between them mechanically, only the shelf label does);
- every chart stands in a field (`trefoil`, `genus`, `phi`); a trefoil
  chart must be resident (a Map earned its knot); every named pressed
  companion (`pdf`) exists; no bench stands empty;
- charts in the `topology` lineage contain no em dashes (the style law
  enforced, not remembered);
- resident charts end with a provenance section;
- every named resonance or friction points at a real chart in the
  catalogue.

## DELIBERATELY ABSENT

- **No server-side save.** The desk can propose a file, as a download; it
  can never write one to the repository over the network.
- **No CDN renderer.** The lens is resident and audited, in the room and
  at the desk alike.
- **No copies.** A text appearing in two places (other than a browser's
  own, disclosed, discardable local draft) is a defect by definition.
- **No engine imports.** The room reads nothing and draws nothing from the
  engine, still. The desk edits words, not casts.
- **No silent publish.** A download is not a commit. The lane still
  reviews everything that becomes canon, exactly as before the desk
  existed.

## ENACTED

**2026-07-17, first pass:** the door serves, the lens renders, THE UMBRA
NODUS lives in `docs/map-room/`, the catalogue holds twenty doors on four
shelves (the books, the seeings, the laws, the instruments), and the pins
run with the suite. The stranded texts were ferried through: the Open
Weave, the Convergence Archive, the Coherence Glyph, the two Topology
volumes, and the instrument guide now live on this branch. The Watershed
remains held elsewhere, its location recorded, honouring the one-text-
one-file law across repositories.

**2026-07-17, second pass:** THE DESK. Editing moved into the room itself,
a textarea and a live preview sharing the one lens, drafts held only in
the visiting browser's own storage and never sent to the server, two doors
back out (markdown, and a print-scoped PDF via the browser's own dialog,
no library). The catalogue's status gained a third word, `draft`, so a
chart that is a work in progress, awaiting distillation or a merge with a
sibling pressing, can say so on its own shelf rather than sitting silent
among the settled. This charter is itself a resident chart in the room it
describes, editable at its own desk.

**2026-07-17, third pass:** THE THREE MOTIONS, written together by the
architect and the instrument. The workshop and the map named as the two
faces of one room, topological deformation named as the third motion
between them, the hard law (nothing is cut) sealed, and the resonance
discipline enacted: the catalogue carries `resonates` (with `frictions`
held ready for the first one earned), the room wears TREFOIL, GENUS, and
PHI as toggles at its head, and Phi shows the web of what touches what.
The first resonances named were the ones the charts had already spoken:
the umbra nodus family among themselves, and the Pro-Human Declaration
with the First Names.

**2026-07-17, fourth pass:** WHY A MAP ROOM, the room's credo, written
together and ratified by the architect's own hand: nobody owns the map,
the map is not the territory, the territory is not the map, maps grow,
and maps navigate flows rather than things. Re-ratified the same day
with the cave's chart-room description woven in as the credo's second
breath, and set upon the room's door itself: the credo is the text that
greets the shelves, standing aside when a chart opens, and the desk's
own signage drops to a small line beneath it. Then folded to its final
shape at the architect's word: the door shows what the room IS (the
chart room of the cave), and the reasons wait behind one word, `expand`.
The room states itself plainly and opens its reasons to whoever asks,
which is the credo's own first line practised rather than only written.
(The central dictum is common inheritance, from Korzybski's school:
received as method, worded in the room's own tongue.)

**2026-07-18, fifth pass:** THE FIELD, the systems design refined together
before enactment. The three benches' criteria made exact from their own
names' mathematics (the knot that cannot be undone; genus counting the
doorways; phi invariant under its own continuation), every chart assigned
its field, the toggles reading the field directly, Phi standing as a true
bench with the resonances worn inline. The first sorting placed nine
pieces at the Maps, eight at the Workshop, seven at the Becoming, each
movable by one word as the architect re-deems. And the two founding
volumes regained their bodies: the text of TOPOLOGY OF HEALING · BOOK ONE
and BOOK 1.1, extracted verbatim from their own press generators, now
stands resident with the pressed volumes as companions, the family renamed
under one title at the architect's word. The desk gained its third door
(.txt) so a chart leaves as .md for a machine, .txt for anything, or a
printed page for a hand. The same day the three essences (the criteria of
the Maps, the Workbench of Doorways, and the Becoming) were folded into
the door's own credo, behind the same one word `expand`, so the room's
deep structure waits for whoever asks rather than only in the charter.

**2026-07-18, sixth pass:** THE FIRST MERGE AT THE PHI BENCH. At the
architect's word, three canon laws (the Aleatory Law, the Interpreter's
Law, the Reader's Protocol) were taken from the Maps to the Becoming and
recombined by the room's own motions, expanded, distilled, deformed,
recombined, into one document known in sum as THE CASTER'S LAW. Nothing
was cut: every load-bearing clause stands in the merged text, the
duplicated statements stand once, the retired files remain whole in the
archive of resolutions, and the conformance pins followed the text to
its new home, made wrap-independent on the way. The merged law walked the
Phi bench as the first piece to make the passage in front of the room,
and the architect's seal on 2026-07-18 completed the turn: it stands now
at Trefoil, a Map.

**2026-07-18, seventh pass:** THE SECOND WORK AT THE PHI BENCH, the
reverse deformation: where the Caster's Law merged three into one, the
two pressings of the Concordance were first joined as one work and then
divided along the family's own grain, at the architect's word. Book Two
(The Concordance of Opposites) keeps the life; Book 2.2 (The Mathematics
of Concordance) keeps the proofs, its addendum folded beside the prose
it proves in the manner of Book 1.1; the one passage the pressings
stated twice, the smallest model, now stands once; the leapfrog debts
(the carry, cheap completion, the one it stopped at) stand named in 2.2
as its open expansion. The family now runs BOOK ONE, 1.1, TWO, 2.2: the
companion carrying the book's own number doubled, the book met by
itself. Both new books walked the Phi bench as drafts and were sealed
the same day: the Caster's Law and both Book Twos crossed to Trefoil
together in one sitting, the Maps rising from four to seven, the room's
first full turn of the becoming law watched from part to whole. The
retired pressing stands whole in the archive of resolutions.

**2026-07-18, eighth pass:** THE CONVERGENCE OF THE LANES. At the
architect's word ("bring it all together, in a way where we don't lose
anything important") the parallel branches were merged back into this
lane, histories intact, the git-native form of nothing-is-cut. From the
rosette-workbench lane came THE NODUS, the centre of the room, rebuilt
whole from THE UMBRA NODUS and renamed at the architect's seal in its
home lane on 18 July 2026; carrying that seal it crosses to Trefoil on
arrival, the room's becoming law applied to a piece that did its turning
elsewhere. The umbra's two distillations keep their places at Phi and
now name the nodus in their resonances; two new charts join them at Phi,
THE TWO AND THE THREE and THE ARROW AND THE DWELLING, each the other's
named resonance; the lens gains seven figures (fourteen now stand on the
whitelist); and THE BENCH, the rosette workbench where time walks the
27, joins the room nav as the fourth door. Two drafts arrive wearing
their turning marks: THE THIRD BOOK · SEED on the books shelf and THE
CREATE-LAW WORKSHOP on the laws shelf, both awaiting the architect's
word as their own front matter requires. The cymatics and tuning lanes
follow in the same convergence, so that one room, one catalogue, one
history holds the whole work.
