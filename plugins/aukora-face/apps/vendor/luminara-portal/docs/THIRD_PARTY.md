# THIRD PARTY

*Work by other hands, carried in this tree by permission. The portal is
AGPL-3.0-or-later and copyright Aukora. Everything listed here is neither, and
the difference is recorded rather than blurred.*

## I · WHY THIS FILE EXISTS

A repository with one licence in every header is easy to reason about. The
moment a second licence enters, the only honest thing is a register: what came
in, from where, under what terms, changed how, and on whose word. Without it the
next reader has to guess, and a guess about a licence is a liability rather than
an inconvenience.

One rule governs everything below. **A third-party file keeps its own licence and
its own author.** It is not relicensed by being here, it is not made Aukora's by
being edited, and the portal's own laws bind it only where they were applied
deliberately and the application is recorded.

## II · THE REGISTER

### spatial/app/luminara-harp-v2.html

| | |
|---|---|
| **Work** | Zeta Harp v2, the Riemann-Siegel Phase Observatory |
| **Author** | Peter Viviani |
| **Licence** | All rights reserved. Not AGPL. |
| **Source** | github.com/aumara-xyz/golden-horizon-principle |
| **Path** | `instruments/zeta_harp_v2/public/observatory.html` |
| **Commit** | `6b3eb057a0b6003a536dbf6381ee4e24d7e48d5b`, 2 August 2026 |
| **Permission** | Given by the author to the architect, recorded 5 August 2026 |
| **Upstream terms** | Published for timestamping, citation, review and scholarly discussion. No permission to misrepresent, commercially exploit, or repackage as an endorsed derivative. |

**What that forbids, still forbids.** Hosting is not endorsement and this is not
an endorsed derivative. Nothing here may be presented as Aukora's work, and the
standing label the instrument carries is the author's own, not a claim the
portal makes on his behalf.

**Changed from upstream, exhaustively.**

1. **The Auma presence bubble and its rail, excised.** 281 lines across seven
   sites: the script and its comment, the animation tick and its call in the
   main loop, the click handler, the bubble button, the "ask Auma" button, and
   the rail lane with its chat sheet.

   The reason is not taste. That block carried the artifact's only two network
   surfaces: a fetch of `http://127.0.0.1:7091/api/models`, and a dynamic
   `import('/app/aumalive.js')` of a module that does not exist anywhere in the
   upstream tree. The portal's self-contained law names a runtime fetch of a
   library as precisely the forbidden thing. The dependent markup and handlers
   went with it because a control that no longer does anything is worse than a
   control that is not there, and because the handler would have thrown on a
   null element the moment its button was removed.

   After the excision the file contains zero occurrences of the substring
   `http`, no `fetch`, no `import(`, no `WebSocket`, no worker. It is now
   genuinely self-contained, which is worth stating carefully: **upstream's own
   header already claimed "Self-contained: no CDN, no network", and as shipped
   that claim was false**, contradicted by the fetch in the same file. The
   excision is what makes the line true here. It is not an inherited property
   and must not be cited as one.

2. **A way out added**, as a Leave block inside the instrument's own Menu sheet,
   in its idiom and at its own 14px floor.

   The portal's shared nav bar was put in the foot lane first and taken out
   again, which is worth recording because it was the wrong instinct twice over.
   It is host furniture, and a borrowed surface is not the host's to decorate;
   and it could not have lived in the Menu anyway, since `luminara-nav.css` sets
   it 980px wide centred on the viewport and forbids a page restyling it. The
   page is therefore named in `NAVLESS_BY_DESIGN` in `core/tests/workshop.test.ts`
   with that reason. The exemption is from the *shape* of the way out, never from
   having one, and a pin holds it to that.

3. **FULL VIEW added.** The three control lanes step back so the field can be
   looked at alone, toggled from the foot lane, by the `m` key, and reversed by
   Escape once every other layer is shut.

   Two things it deliberately does not do. It closes the panels rather than
   hiding them, because a sheet hidden while still open goes on being drawn into
   and `fitCanvas` would size its canvas to a `clientWidth` of zero and hand back
   a broken context on the way out. And **it does not hide the standing label**.
   The author's `CLAIM_BOUNDARY.md` requires that line on every build and every
   mode; a minimised view is a mode. Hiding the law to make a prettier picture is
   the one thing the feature may not do, and a pin fails if the foot lane is ever
   added to the rules that `display: none` under minimisation.

**The mathematics is untouched.** Not one line of the engine was altered.

## III · WHAT THE TWO HARPS PROVE ABOUT EACH OTHER

The portal's own `luminara-harp.html` and this instrument were built
independently, from the same standard mathematics, by different hands. They
agree, which is worth more than either agreeing with itself:

- N(t) at the four teaching heights: 4, 39, 398 and 3989 at t = 130, 10⁴, 10⁶
  and 10⁸. Identical.
- The height at which term 399 enters the sum: 1000289. Identical.
- The leading remainder constant. The portal measured K14 = 1.473 against its
  own 80-digit mpmath fixtures. v2 measured max|R_ref| per window against a
  separately generated fixture set; at its widest window that implies
  K14 = 1.4708. **The two agree to 0.15%.**

Two engines, two fixture generators, one constant. That is a real
cross-validation and neither instrument could have produced it alone.

## IV · THE RULE FOR WHAT COMES NEXT

Anything else brought in under another hand is added here in the same commit as
the file it describes, with the same fields filled. A third-party file with no
row in this register is a defect, and the pins treat it as one.

## V · PROVENANCE

*Written 5 August 2026, when the Observatory gained a second instrument. The
permission is the architect's to give account of; this file records that it was
given and when, not the conversation in which it was given. The excision and its
line counts were verified against the file, not taken from a report. Nothing
here predicts, and nothing here prescribes.*
