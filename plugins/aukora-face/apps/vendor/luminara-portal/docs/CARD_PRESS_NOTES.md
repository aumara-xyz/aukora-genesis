# CARD PRESS NOTES

*What a printer needs to know to press the deck, and what the files already
carry. Written for the first physical run.*

---

## THE GEOMETRY

| | |
| --- | --- |
| Trim | 70 × 120 mm (2.75 × 4.75 in), standard tarot |
| Bleed | 3 mm on every edge |
| Full art size | 76 × 126 mm |
| Safe area | keep type 5 mm in from trim |
| Corner radius | 3.2 mm |
| Raster files | 898 × 1488 px at 300 dpi, bleed included |
| Deck PDF | 28 pages, one card per page, page box is the bleed box |

Regenerate everything with:

```bash
bun scripts/pressCards.mjs
```

Output lands in `dist/cards`: `luminara-deck.pdf` and twenty-eight PNGs named
by seat and card. The files are not committed; any checkout rebuilds them
identically, because the script drives the live page rather than a second
copy of its markup.

## THE THREE THINGS TO TELL THE PRINTER

**Rich black, not flat black.** The ground reads `#050505`. Converted naively
that becomes K-only, which prints as a washed grey that looks nothing like
the screen and shows its difference the moment two cards touch. Ask for a
rich black build, around C40 M30 Y30 K100, or supply their preferred recipe.
This is the single item most likely to spoil the run if it goes unsaid.

**Total ink limit.** With a rich black ground covering nearly the whole face,
confirm their maximum ink coverage, usually 280 to 300 percent, before the
files go on press. A ground that exceeds it will offset and set off.

**The stock is the metal.** The faces are drawn in three metals on black. A
matte or linen finish keeps them legible; a high gloss will mirror and drown
the fainter strands, which carry depth and are meant to be readable. If the
run can afford it, the deck is a natural candidate for a spot gloss on the
knot alone, though nothing in the files assumes it.

## WHAT THE FILES ALREADY HANDLE

**No glow.** The screen faces wear soft haloes around each knot. Those are a
display effect and print as muddy grey rings, so the press files drop them
entirely and lift brightness instead, which is a colour operation and
survives conversion. What is lost is nothing the ink can carry anyway.

**Stroke weights are press-safe.** At this trim the thinnest strand measures
0.51 mm and the thickest 1.77 mm. Both sit well above the hairline any press
can hold, so no artificial thickening was applied and the depth encoding,
which lives in stroke width, is intact.

**The bleed is real ink.** The ground runs to the full 76 × 126 mm rather
than stopping at the trim, so a cut anywhere inside the bleed lands in ink
and no white edge can appear.

## THE BACK

One design for all twenty-seven, identical and unmarked. This is doctrine
rather than economy: a back that differs card to card would make the cast
steerable, and the deck's own law forbids it. The back also carries no
edition line, so the two faces of the deck stay exactly as distinguishable
as they were meant to be, which is to say not at all from behind.

Print the back as a single plate, twenty-eight times or as many as the run
needs. It is page 28 of the PDF and `028-the-back.png`.

## THE EDITION LINE

Every face carries one identical line at the foot: `LUMINARA · FIRST
PRESSING · 2026`. Being identical on all twenty-seven, it tells a reader
nothing about which card they are holding, so the doctrine above is
untouched. Change it or remove it at press time without regenerating
anything by passing `&ed=`:

```
/app/luminara-cards.html?press&ed=SECOND%20PRESSING
/app/luminara-cards.html?press&ed=
```

## BEFORE THE FULL RUN

Press one card and hold it in real light before committing. Three things are
worth judging on paper rather than on a screen, because no amount of
previewing settles them:

Whether the corner numerals are large enough to read in a fan. They are
3.1 mm here, chosen by eye at trim, and a hand disagrees with an eye more
often than not.

Whether the trigram marks hold. They sit about 7 mm wide, and the wave in
particular is the mark most likely to fill in on absorbent stock.

Whether the black is the black that was wanted. This is what the rich-black
conversation above is for, and a proof answers it in a way no file can.

---

## PROVENANCE

*Written 26 July 2026 at the architect's word, alongside the press design
itself, for a limited first run. The geometry here is measured from the
rendered page rather than intended for it: trim, bleed and stroke figures
were read off the live document, not specified and hoped for.*
