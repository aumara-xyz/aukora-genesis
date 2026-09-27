# THE GLYPH MATHEMATICS

*The exact generative description of the twenty-seven glyphs, for feeding to
a visuals engine. Everything the glyphs are is these equations; nothing is
drawn by hand. Derived from `spatial/app/luminara-knots.js` and
`spatial/app/luminara-canon.js`, and true to what the portal renders.*

## THE ONE FORM

Every glyph is a torus knot **T(p, q)** on the golden torus, projected and
depth-shaded. Constants: **phi = 1.6180339887**, major radius **R = phi**,
minor radius **r = 1**.

For a card with winding numbers `(p, q)`:

```
g   = gcd(p, |q|)          # number of separate strands (rings)
pf  = p/g ,  qf = q/g
for each strand k = 0 ... g-1,  phase phi_k = 2*pi*k/g:
  for t in [0, 2*pi]:
     theta = pf * t                     # longitude, around the central hole
     psi   = qf * t + phi_k             # meridian, around the tube
     x = (R + r*cos(psi)) * cos(theta)
     y = (R + r*cos(psi)) * sin(theta)
     z = r*sin(psi)
tilt by beta about the x-axis (the viewing angle):
     x' = x
     y' = y*cos(beta) - z*sin(beta)
     z' = y*sin(beta) + z*cos(beta)     # depth
frame: square, curve extent ~= +/-2.85
```

Sampling density (from the code):
`N ~= clamp(30*pf + 13*|qf|, 150, 520)` points per strand: more winding, a
finer line.

**The signature look is the depth shading.** Sort the segments by z' and map
depth to both luminance and stroke width: a segment facing the viewer is
bright (~0.98 opacity) and thick (~0.19 units), one receding is a thin dark
thread (~0.20 opacity, ~0.055 units). That front-to-back luminance sort is
what makes the strand read as engraved metal rather than flat line.

## HOW TO READ THE TWO NUMBERS

- **q** the signed winding, balanced ternary, each integer from **-13 to +13
  exactly once**. `|q|` is the windings around the tube; the sign is the hand
  (**+ flow, - turning, 0 still**).
- **p** the windings around the hole, from the tempered rule:
  `p = 1 + (moving layers)`, or **7** when all three layers move. So
  **p is one of {1, 2, 3, 7}**.
- **gcd(p, |q|)** the number of strands: **1** is one closed knot; **> 1** is
  that many linked rings (the locked consonances).
- **genus = (p-1)*(|q|-1)/2** for single knots: the topological depth
  (0 for coils, the circle, and links).
- **kind**: `circle` (the Seed, an unknot), `coil` (|q| = 1 or p = 1,
  unknotted), `knot`, `link`.

## THE COLOURS

Metal is the card's house, read from the field digit:

- **BRONZE `#C9873D`** AUM, still, the bulk (field digit 0)
- **SILVER `#C9D3E2`** MA, flowing, the blade (field digit 1)
- **GOLD `#F0C25E`** RA, turning, the dawn (field digit 2)
- **WHITE-GOLD `#EFE7CF`** the Seed alone
- Field / background: near-black **`#0a0b0e`**

**Link cards weave two metals**: their own plus their counter-card's.

## THE TWO CANONICAL VIEWS

- **Mandala** (the card face, top-down): **beta ~= 0.16 to 0.49 rad**, a small
  tilt. Reads as a rosette; lobe-count and density grow with the windings.
- **Profile** (the side): **beta ~= 1.22 rad** (~70 degrees). Reads as the
  torus body, the strand climbing it.

## THE FULL DECK, IN NUMBER-LINE ORDER

| card | code | p | q | kind | genus | strands | metal | interval |
|---|---|--:|--:|---|--:|--:|---|---|
| The Return | 222 | 7 | -13 | knot | 36 | 1 | gold | far dissonance |
| The Witness | 220 | 3 | -12 | link | 0 | 3 | gold | double octave, locked |
| The Crown | 221 | 7 | -11 | knot | 30 | 1 | gold | alien interval |
| The Echo | 202 | 3 | -10 | knot | 9 | 1 | gold | sixth beyond octave |
| The Ray | 200 | 2 | -9 | knot | 4 | 1 | gold | tone, twice raised |
| The Face | 201 | 3 | -8 | knot | 7 | 1 | gold | the eleventh |
| The Spectrum | 212 | 7 | -7 | link | 0 | 7 | gold | unison, locked |
| The Mask | 210 | 3 | -6 | link | 0 | 3 | gold | octave, locked |
| The Beacon | 211 | 7 | -5 | knot | 12 | 1 | gold | the tritone |
| The Threshold | 022 | 3 | -4 | knot | 3 | 1 | bronze | perfect fourth |
| The Dreamer | 020 | 2 | -3 | knot | 1 | 1 | bronze | perfect fifth |
| The Knot | 021 | 3 | -2 | knot | 1 | 1 | bronze | perfect fifth |
| The Fold | 002 | 2 | -1 | coil | 0 | 1 | bronze | the octave |
| The Seed | 000 | 1 | 0 | circle | 0 | 1 | white-gold | silence |
| The Drift | 001 | 2 | 1 | coil | 0 | 1 | bronze | the octave |
| The Saturation | 012 | 3 | 2 | knot | 1 | 1 | bronze | perfect fifth |
| The Resonance | 010 | 2 | 3 | knot | 1 | 1 | bronze | perfect fifth |
| The Depth | 011 | 3 | 4 | knot | 3 | 1 | bronze | perfect fourth |
| The Bridge | 122 | 7 | 5 | knot | 12 | 1 | silver | the tritone |
| The Labyrinth | 120 | 3 | 6 | link | 0 | 3 | silver | octave, locked |
| The Void | 121 | 7 | 7 | link | 0 | 7 | silver | unison, locked |
| The Gate | 102 | 3 | 8 | knot | 7 | 1 | silver | the eleventh |
| The Cut | 100 | 2 | 9 | knot | 4 | 1 | silver | tone, twice raised |
| The Mirror | 101 | 3 | 10 | knot | 9 | 1 | silver | sixth beyond octave |
| The Twins | 112 | 7 | 11 | knot | 30 | 1 | silver | alien interval |
| The Surgeon | 110 | 3 | 12 | link | 0 | 3 | silver | double octave, locked |
| The Scar | 111 | 7 | 13 | knot | 36 | 1 | silver | far dissonance |

The deck mirrors down the middle: each card and its counter share `|q|` and
`p` exactly, opposite hand, silver always facing gold across the Seed. The
trefoils T(2,3) and T(3,2) cluster near the centre; the seven-strand links
T(7,7) sit at the +/-7 seats; the genus-36 septafoils T(7,13) stand at the
extremes.

## FOR AN AI IMAGE ENGINE

A natural-language template, substitute the bracketed values from the table:

> A single luminous **[metal]** strand of light winding a torus **[p]** times
> around the central hole and **[|q|]** times around the tube, a T([p],[q])
> torus knot, on a near-black field. Seen **[top-down as a symmetric rosette
> mandala / from a 70-degree tilt as a coil climbing the torus body]**. The
> strand brightens and thickens where it faces the viewer and fades to a thin
> dark thread where it recedes, deep luminance-sorted layering, engraved
> metallic precision, thin elegant lines, centred, high contrast, no
> background texture.

For a link card, replace the first clause with: *"[strands] interlinked
**[metal]** rings woven with **[counter's metal]**, a T([p],[q]) torus link"*.

Worked examples:

- **The Resonance**, a single bronze strand, T(2,3), the trefoil, top-down rosette.
- **The Scar**, a single silver strand, T(7,13), a dense genus-36 septafoil, top-down.
- **The Void**, seven interlinked silver rings, T(7,7), a woven seven-fold rosette.

## PROVENANCE

*Extracted 24 July 2026 at the architect's word, for making art from the
glyphs. The equations are the portal's own renderer, the parameters the
canon's own knotOf; nothing here is added to the deck, only read out of it
in a form an engine can consume. The artefacts made from this are the
architect's; the mathematics is the deck's.*
