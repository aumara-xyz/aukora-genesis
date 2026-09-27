# -*- coding: utf-8 -*-
"""Typeset 'Topology of Healing, Book 1.1: The Mathematics of Healing'.

Companion technical volume to 'The Shape of Trauma'. Same 6x9 series design.
Knot illustrations are computed from real 3D parametrizations with
depth-correct crossing gaps. No em dashes anywhere in the text.
"""

import math
from pathlib import Path

from reportlab.lib.pagesizes import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    HRFlowable, Flowable,
)

# ---------------------------------------------------------------- fonts
FD = "C:/Windows/Fonts/"
pdfmetrics.registerFont(TTFont("Palatino", FD + "pala.ttf"))
pdfmetrics.registerFont(TTFont("Palatino-Italic", FD + "palai.ttf"))
pdfmetrics.registerFont(TTFont("Palatino-Bold", FD + "palab.ttf"))
pdfmetrics.registerFont(TTFont("Palatino-BoldItalic", FD + "palabi.ttf"))
registerFontFamily(
    "Palatino",
    normal="Palatino", bold="Palatino-Bold",
    italic="Palatino-Italic", boldItalic="Palatino-BoldItalic",
)

INK = HexColor("#1e1b18")
FADE = HexColor("#5a544c")
RULE = HexColor("#b8ac9c")

PAGE_W, PAGE_H = 6 * inch, 9 * inch
M_SIDE, M_TOP, M_BOT = 0.95 * inch, 0.9 * inch, 0.85 * inch

# ---------------------------------------------------------------- knot art
def _seg_intersect(a, b, c, d):
    rx, ry = b[0] - a[0], b[1] - a[1]
    sx, sy = d[0] - c[0], d[1] - c[1]
    den = rx * sy - ry * sx
    if abs(den) < 1e-12:
        return None, None
    qx, qy = c[0] - a[0], c[1] - a[1]
    t = (qx * sy - qy * sx) / den
    u = (qx * ry - qy * rx) / den
    if 0.0 <= t <= 1.0 and 0.0 <= u <= 1.0:
        return t, u
    return None, None


class KnotArt(Flowable):
    """Line-art knot diagram with depth-correct crossing gaps."""

    def __init__(self, curves, w, h, lw=1.3, gapmul=4.2, color=INK,
                 margin=6, dots=None):
        Flowable.__init__(self)
        self.width, self.height = w, h
        self.lw, self.color, self.margin = lw, color, margin
        self.gap = lw * gapmul
        self.curves = curves
        self.dots = dots or []
        self.hAlign = "CENTER"
        self._prep = None

    def wrap(self, availW, availH):
        return self.width, self.height

    def _prepare(self):
        m = self.margin
        xs, ys = [], []
        for pts, _ in self.curves:
            xs += [p[0] for p in pts]
            ys += [p[1] for p in pts]
        for x, y, r in self.dots:
            xs += [x - r, x + r]
            ys += [y - r, y + r]
        minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
        sx = (self.width - 2 * m) / (maxx - minx) if maxx > minx else 1.0
        sy = (self.height - 2 * m) / (maxy - miny) if maxy > miny else 1.0
        s = min(sx, sy)
        ox = (self.width - s * (maxx - minx)) / 2 - s * minx
        oy = (self.height - s * (maxy - miny)) / 2 - s * miny

        scaled = []
        for pts, closed in self.curves:
            sp = [(ox + s * p[0], oy + s * p[1], p[2]) for p in pts]
            scaled.append((sp, closed))
        sdots = [(ox + s * x, oy + s * y, s * r) for x, y, r in self.dots]

        cum = []
        for sp, closed in scaled:
            n = len(sp)
            c = [0.0]
            rng = range(n) if closed else range(n - 1)
            for i in rng:
                a, b = sp[i], sp[(i + 1) % n]
                c.append(c[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
            cum.append(c)

        segs = []
        for ci, (sp, closed) in enumerate(scaled):
            n = len(sp)
            rng = range(n) if closed else range(n - 1)
            for i in rng:
                a, b = sp[i], sp[(i + 1) % n]
                bb = (min(a[0], b[0]), min(a[1], b[1]),
                      max(a[0], b[0]), max(a[1], b[1]))
                segs.append((ci, i, a, b, bb))

        hides = [[] for _ in scaled]
        for u in range(len(segs)):
            c1, i1, a1, b1, bb1 = segs[u]
            for v in range(u + 1, len(segs)):
                c2, i2, a2, b2, bb2 = segs[v]
                if bb1[2] < bb2[0] or bb2[2] < bb1[0]:
                    continue
                if bb1[3] < bb2[1] or bb2[3] < bb1[1]:
                    continue
                if c1 == c2:
                    n = len(scaled[c1][0])
                    d = abs(i1 - i2)
                    if scaled[c1][1]:
                        d = min(d, n - d)
                    if d <= 3:
                        continue
                t, w = _seg_intersect(a1, b1, a2, b2)
                if t is None:
                    continue
                z1 = a1[2] + (b1[2] - a1[2]) * t
                z2 = a2[2] + (b2[2] - a2[2]) * w
                if z1 < z2:
                    slen = cum[c1][i1 + 1] - cum[c1][i1]
                    hides[c1].append(cum[c1][i1] + slen * t)
                else:
                    slen = cum[c2][i2 + 1] - cum[c2][i2]
                    hides[c2].append(cum[c2][i2] + slen * w)

        self._prep = (scaled, cum, hides, sdots)

    def draw(self):
        if self._prep is None:
            self._prepare()
        scaled, cum, hides, sdots = self._prep
        c = self.canv
        c.saveState()
        c.setStrokeColor(self.color)
        c.setFillColor(self.color)
        c.setLineWidth(self.lw)
        c.setLineCap(1)
        c.setLineJoin(1)
        g = self.gap / 2
        for ci, (sp, closed) in enumerate(scaled):
            n = len(sp)
            total = cum[ci][-1]
            rng = range(n) if closed else range(n - 1)
            hs = hides[ci]
            path = None
            for i in rng:
                a, b = sp[i], sp[(i + 1) % n]
                smid = (cum[ci][i] + cum[ci][i + 1]) / 2
                hidden = False
                for s0 in hs:
                    d = abs(smid - s0)
                    if closed:
                        d = min(d, total - d)
                    if d < g:
                        hidden = True
                        break
                if hidden:
                    if path is not None:
                        c.drawPath(path, stroke=1, fill=0)
                        path = None
                else:
                    if path is None:
                        path = c.beginPath()
                        path.moveTo(a[0], a[1])
                    path.lineTo(b[0], b[1])
            if path is not None:
                c.drawPath(path, stroke=1, fill=0)
        for x, y, r in sdots:
            c.circle(x, y, r, stroke=0, fill=1)
        c.restoreState()


def _curve_pts(fn, n, t0=0.0, t1=2 * math.pi):
    return [fn(t0 + (t1 - t0) * i / n) for i in range(n)]


def _xf(pts, s=1.0, dx=0.0, dy=0.0, mx=1.0, mz=1.0):
    return [(mx * p[0] * s + dx, p[1] * s + dy, mz * p[2]) for p in pts]


def _trefoil_pts():
    return _curve_pts(lambda t: (math.sin(t) + 2 * math.sin(2 * t),
                                 math.cos(t) - 2 * math.cos(2 * t),
                                 -math.sin(3 * t)), 420)


def _fig8_pts():
    return _curve_pts(lambda t: (math.cos(3 * t + 0.7),
                                 math.cos(2 * t + 0.2),
                                 math.cos(7 * t)), 800)


def art_cinquefoil(w=150, h=150, lw=1.6):
    cq = _curve_pts(lambda t: ((1 + 0.72 * math.cos(2.5 * t)) * math.cos(t),
                               (1 + 0.72 * math.cos(2.5 * t)) * math.sin(t),
                               math.sin(2.5 * t)), 900, 0, 4 * math.pi)
    return KnotArt([(cq, True)], w, h, lw=lw)


def art_nonslice_pair(w=216, h=92, lw=1.3):
    tref = _xf(_trefoil_pts(), s=1.0, dx=-3.6)
    f8 = _xf(_fig8_pts(), s=2.5, dx=3.6)
    return KnotArt([(tref, True), (f8, True)], w, h, lw=lw)


def art_mirror_pair(w=216, h=92, lw=1.3):
    left = _xf(_trefoil_pts(), s=1.0, dx=-3.6)
    right = _xf(_trefoil_pts(), s=1.0, dx=3.6, mx=-1.0, mz=-1.0)
    return KnotArt([(left, True), (right, True)], w, h, lw=lw)


def art_rift(w=150, h=66, lw=1.3):
    pts = []
    for i in range(420):
        t = 2 * math.pi * i / 420
        pinch = 0.5 * (1 + math.cos(t))
        pts.append((math.cos(t), math.sin(t) * (0.12 + 0.88 * pinch) * 0.62, 0.0))
    small = _curve_pts(lambda t: (-1.42 + 0.19 * math.cos(t),
                                  0.19 * math.sin(t), 0.0), 140)
    return KnotArt([(pts, True), (small, True)], w, h, lw=lw,
                   dots=[(-1.42, 0.0, 0.032)])


ART = {
    "cinquefoil": art_cinquefoil,
    "pair": art_nonslice_pair,
    "mirror": art_mirror_pair,
    "rift": art_rift,
}

# ---------------------------------------------------------------- styles
def S(name, **kw):
    base = dict(fontName="Palatino", fontSize=10.5, leading=16.5,
                textColor=INK, alignment=TA_JUSTIFY, spaceAfter=9)
    base.update(kw)
    return ParagraphStyle(name, **base)

styles = {
    "body":      S("body"),
    "heading":   S("heading", fontName="Palatino-Bold", fontSize=15, leading=19,
                   alignment=TA_LEFT, spaceBefore=26, spaceAfter=6,
                   keepWithNext=1),
    "eyebrow":   S("eyebrow", fontName="Palatino", fontSize=9, leading=12,
                   alignment=TA_LEFT, spaceBefore=30, spaceAfter=2,
                   textColor=FADE, keepWithNext=1),
    "quoteC":    S("quoteC", fontName="Palatino-Italic", fontSize=11.5,
                   leading=19, alignment=TA_CENTER, spaceBefore=12,
                   spaceAfter=12),
    "formula":   S("formula", fontName="Palatino-Italic", fontSize=11.5,
                   leading=17, alignment=TA_CENTER, spaceBefore=10,
                   spaceAfter=10),
    "smallnote": S("smallnote", fontName="Palatino-Italic", fontSize=9,
                   leading=13.5, textColor=FADE, alignment=TA_JUSTIFY,
                   spaceBefore=18),
    "pathitem":  S("pathitem", leftIndent=20, firstLineIndent=-20,
                   spaceAfter=8, alignment=TA_LEFT),
    # title page
    "tSeries":   S("tSeries", fontName="Palatino", fontSize=11, leading=15,
                   alignment=TA_CENTER, textColor=FADE, spaceAfter=0),
    "tBook":     S("tBook", fontName="Palatino-Italic", fontSize=10.5,
                   leading=14, alignment=TA_CENTER, textColor=FADE,
                   spaceAfter=0),
    "tTitle":    S("tTitle", fontName="Palatino-Bold", fontSize=28, leading=34,
                   alignment=TA_CENTER, spaceAfter=0),
    "tAuthor":   S("tAuthor", fontName="Palatino", fontSize=13, leading=18,
                   alignment=TA_CENTER, spaceAfter=0),
    "tInst":     S("tInst", fontName="Palatino-Italic", fontSize=11, leading=15,
                   alignment=TA_CENTER, textColor=FADE, spaceAfter=0),
    "cell":      S("cell", fontSize=9, leading=13, alignment=TA_LEFT,
                   spaceAfter=0),
    "cellB":     S("cellB", fontName="Palatino-Bold", fontSize=9, leading=13,
                   alignment=TA_LEFT, spaceAfter=0),
}

def divider():
    return HRFlowable(width="16%", thickness=0.7, color=RULE,
                      spaceBefore=16, spaceAfter=16, hAlign="CENTER")

# ---------------------------------------------------------------- content
C = []
def p(t):      C.append(("body", t))
def h(eb, t):  C.append(("eyebrow", eb)); C.append(("heading", t))
def quoteC(t): C.append(("quoteC", t))
def formula(t): C.append(("formula", t))
def art(key):  C.append(("art", key))
def sp(n):     C.append(("spacer", n))
def br():      C.append(("pagebreak", None))

# ---- title page
sp(64)
C.append(("tSeries", "TOPOLOGY OF HEALING"))
C.append(("tBook", "Book 1.1"))
sp(30)
C.append(("tTitle", "The Mathematics<br/>of Healing"))
sp(16)
C.append(("hr-title", None))
sp(26)
art("cinquefoil")
sp(30)
C.append(("tAuthor", "By Nila Padma"))
C.append(("tInst", "Aumara Institution of Research"))
br()

# ---- prologue
sp(30)
quoteC("What Book 1 says in plain speech,<br/>"
       "this book says in proofs and wagers.")
p("This is the technical edition promised at the close of <i>The Shape of "
  "Trauma</i>. Nothing essential lives only here; the building stands without "
  "this volume. But the load-bearing drawings deserve to be seen, and some "
  "readers will not trust a building until they have seen them.")
p("One discipline governs every page. "
  "Statements marked <b>Theorem</b> are established mathematics and can be "
  "leaned on with full weight. Statements marked <b>Hypothesis</b> or "
  "<b>Conjecture</b> belong to the model; they stand or fall with it. And the "
  "application of any theorem to the field of a living witness is itself "
  "always a hypothesis. It is easy to mistake a rhyme for a docking. We will "
  "know the difference.")
p("The notation is light. <i>M</i> names the field of the witness. <i>K</i> "
  "names a knot in that field. Δ is the Alexander polynomial (a computable "
  "fingerprint of a knot), Λ is the baseline curvature of the observer-slot, "
  "and κ is a damping coefficient whose value this book does not claim to "
  "know. Every symbol is introduced "
  "when it arrives. Nothing here requires more than patience.")

# ---- I
h("I", "The Latent Space")
p("Forget attention for a moment. Go to the substrate.")
p("<b>Hypothesis (topological coding).</b> Memory is not a knot in the brain. "
  "The brain is the projection of a more fundamental topological space, call "
  "it <i>M</i>: a three-dimensional manifold (or a slice of a "
  "four-dimensional one) that encodes all possible experience-structures. "
  "Memory-structures are not generated; they are accessed. A specific memory "
  "is an embedded loop in <i>M</i>, or, more generally, a tangle.")
p("Why does the embedding matter? Because the way the loop passes through the "
  "ambient space <i>is</i> its meaning. Two loops that are isotopic, meaning "
  "one can be deformed into the other without cutting, carry the same memory. "
  "Two loops that are not isotopic are different memories. Meaning is stored "
  "in knot type. The synaptic weights of the brain are the read-out metric, "
  "not the invariant.")
p("<i>Testable edge.</i> If the hypothesis holds, memory capacity is bounded "
  "by the number of distinct knot types embeddable in a finite volume under a "
  "complexity cutoff. That number grows exponentially with crossing number, "
  "not factorially: a prediction that differs from connectionist models.")

# ---- II
h("II", "The Wound as a Non-Slice Knot")
art("pair")
p("Take the four-dimensional cylinder <i>M</i> × [0, 1], the field extended "
  "one dimension upward. A knot <i>K</i> sitting in the bottom slice is "
  "called <b>smoothly slice</b> if there exists a smooth embedded disk "
  "<i>D</i> inside the cylinder whose boundary is exactly the knot: "
  "∂<i>D</i> = <i>K</i>. The disk is the DSK of the surgical primes, the "
  "constructed resolution artefact: the proof that <i>K</i> can be resolved "
  "one dimension higher without cutting. The <b>slice genus</b> "
  "<i>g<sub>s</sub></i>(<i>K</i>) measures the obstruction: it is the "
  "minimum genus of any smooth surface the knot bounds in the four-ball, and "
  "<i>K</i> is slice precisely when <i>g<sub>s</sub></i>(<i>K</i>) = 0.")
p("<b>Theorem (Fox-Milnor).</b> If <i>K</i> is slice, its Alexander "
  "polynomial factors as Δ<i><sub>K</sub></i>(<i>t</i>) = "
  "<i>f</i>(<i>t</i>) · <i>f</i>(<i>t</i><super>−1</super>) for some "
  "polynomial <i>f</i>. The condition is necessary but not sufficient. It can "
  "rule dissolution out; it can never rule it in.")
p("<b>Conjecture (the model's central definition).</b> A traumatic memory is "
  "a loop whose knot type is non-slice. A slice loop is the shadow of an "
  "unknotted sphere in the fourth dimension: liftable, resolvable without "
  "self-intersection. A non-slice loop carries a genuine obstruction. Healing "
  "as dissolution would be the construction of the disk: re-contextualising "
  "the memory in a higher-dimensional narrative space where it untangles.")
p("Two checked facts follow, and the first is the reason this volume exists. "
  "The trefoil and the figure-eight, the two archetypal wound-shapes of "
  "Book 1, are both provably non-slice. Each has slice genus one, and each "
  "already fails the Fox-Milnor test. Under this model, for exactly these "
  "shapes, dissolution is mathematically closed. Only re-embedding remains. "
  "The contemplative claim of Book 1 (the wound is not erased; the space "
  "around it grows) is not a consolation here. It is a corollary.")
p("Per the discipline: internal consistency is not evidence. But "
  "inconsistency would have been damning, and there is none.")
p("The second fact opens the door to the next chapter. There exist genuinely "
  "knotted loops that <i>are</i> slice. The simplest is the square knot, a "
  "trefoil joined to its own mirror image. Something about meeting a "
  "reflection changes what a wound can do. That is not a metaphor reaching "
  "for comfort. It is a theorem, and it deserves its own chapter.")

# ---- III
h("III", "The Mirror Theorem")
art("mirror")
p("<b>Theorem (knot concordance).</b> For any knot <i>K</i>, however locked, "
  "the connected sum of <i>K</i> with its reversed mirror image, written "
  "<i>K</i> # (−<i>K</i>*), is slice. More is true. Under the joining "
  "operation, concordance classes of knots form a group. The identity of "
  "that group is the class of slice knots, the resolvable wounds. And in "
  "that group every knot has an inverse: its own faithful reflection.")
p("Read it twice. What no knot can do alone (bound a disk, resolve) every "
  "knot can do when joined with its exact mirror.")
p("This is the strongest rhyme in the whole framework, because it docks onto "
  "the witness principle of Book 1 with unusual precision. The wound met by "
  "a faithful reflection of itself becomes resolvable in the higher "
  "dimension. And the theorem is exacting in the same way good witnessing is "
  "exacting: only the <i>reversed mirror</i> is the inverse. Join <i>K</i> "
  "to a sloppy, distorted, or merely similar reflection and the sum is, in "
  "general, still knotted. The witness must reflect truly, orientation and "
  "chirality and all, or the sum stays bound.")
p("Chapter II was careful to supply a test. Fox-Milnor cannot confirm that a "
  "knot dissolves, but it can rule dissolution out, and a model that claims "
  "an obstruction owes the reader a way to detect one. The claim just made is "
  "stronger, and has so far been offered without any such test. If only a "
  "faithful reflection serves, faithfulness must be checkable.")
p("It is. The instrument is the <b>signature</b>, written σ(<i>K</i>): an "
  "integer invariant computed from the knot's Seifert form, which carries "
  "handedness in its sign exactly as the genus carries depth in its "
  "magnitude. Three established facts are all that is needed.")
p("<b>Theorem.</b> The signature is additive under connected sum: "
  "σ(<i>K</i> # <i>J</i>) = σ(<i>K</i>) + σ(<i>J</i>).")
p("<b>Theorem.</b> Mirroring negates it: σ(−<i>K</i>*) = −σ(<i>K</i>).")
p("<b>Theorem.</b> A slice knot has signature zero. So a non-zero signature "
  "rules dissolution out.")
p("Together these give the test. For the witnessed sum to resolve, it is "
  "<b>necessary</b> that")
formula("σ(<i>K</i>′) = −σ(<i>K</i>)")
p("where <i>K</i>′ is whatever reflection is actually offered. Take the "
  "trefoil, whose signature is −2. Its true mirror has signature +2, the sum "
  "has signature 0, and the theorem above is consistent as it must be. Now "
  "offer instead a reflection that is merely similar, a knot of signature −4 "
  "mirrored to +4: the sum has signature +2, which is not zero, and the sum "
  "is therefore <b>not slice</b>. It stays bound, and no further examination "
  "is required to know it.")
p("The test has the same shape and the same limit as Fox-Milnor. It rules "
  "out; it never rules in. A reflection carrying the correct signature may "
  "still be the wrong reflection, and the sum may still fail to resolve for "
  "reasons the signature cannot see.")
p("<b>Conjecture (the model).</b> The theorem's failure mode is now not "
  "merely named but measurable, and what it measures is specific. It is not "
  "the warmth of the reflection, nor its detail, nor its duration. It is "
  "<b>handedness</b>: whether the reflection turns the same way the original "
  "turned, in reverse. A witness who returns the shape faithfully but the "
  "handedness wrongly has produced a sum the mathematics says is still "
  "knotted.")
p("Status: the mathematical side is theorem. The therapeutic reading is "
  "hypothesis. But this is the one place in the model where the rhyme scheme "
  "is forced rather than chosen, and that earns it a central place. It is "
  "the mathematical shape of the sentence that closes Book 1's first "
  "movement: <i>that is what a witness is for.</i>")

# ---- IV
h("IV", "The Relaxation Law, and Why It Breaks")
p("<b>Conjecture.</b> Attention is the act of pulling on the knot's loop. "
  "Pulling tightens: the memory sharpens, becomes present. When attention "
  "releases, tension relaxes asymptotically toward a baseline. Formally, "
  "relaxation is ambient isotopy under a curvature flow in <i>M</i> with a "
  "preferred framing, and the knot's polynomial invariants drive the speed "
  "of untangling. Each pull of attention applies one smoothing step, at a "
  "rate this book deliberately leaves unnamed. The note closing this "
  "chapter says why.")
p("For an ordinary memory, the step sequence converges toward the trivial "
  "loop or a low-tension embedding. For a traumatic memory, the flow halts "
  "at a fixed point: a locally minimal energy configuration that cannot be "
  "isotoped further without passing through a forbidden crossing. That is "
  "why trauma does not decay. <b>The difference is not one of rate. It is "
  "one of possibility</b>, and it is settled by whether <i>K</i> is slice, "
  "which the second chapter established and which no schedule of attention "
  "can alter.")
p("Under this model, a traumatic memory presents with three signatures. "
  "<b>Abnormally high baseline tension</b>: the knot is tight before anyone "
  "pulls. <b>Hyper-sensitivity to pull</b>: even a brush of attention yanks "
  "it fully tight, flooding the present. <b>Impaired release</b>: the "
  "decay fails, and the knot stays locked in the high-tension "
  "state.")
p("<i>Testable edge.</i> Measure memory persistence under a controlled "
  "attention schedule. The discriminating prediction is not the slope. It is "
  "the <b>presence or absence of a plateau</b>, and the claim is that which "
  "memories plateau is predicted by their structural classification rather "
  "than by their intensity, their age, or their content. The kill condition "
  "follows directly: if plateau presence fails to track that classification, "
  "the model is wrong and this chapter goes with it.")
p("<i>What would not count.</i> A decay rate falling near any particular "
  "constant. The rate is expected to be generic, and a search for a special "
  "number in it would be a test whose pass region already contains the "
  "ordinary answer. Such a test cannot lose, and a test that cannot lose "
  "cannot inform.")
p("<i>Note on an earlier version.</i> Until 2026 this chapter named the "
  "golden ratio as the time-step of the flow, and took its title from it. "
  "That attribution is withdrawn. A neighbouring research programme tested "
  "whether the golden ratio governs dynamics on five separate occasions and "
  "found it generic or beaten in every one, closing the question of "
  "dynamical selection in that year. The argument here never rested on the "
  "constant. What carries it is the difference between a flow that converges "
  "and a flow that halts, and that difference is topological. The removal is "
  "recorded rather than performed quietly, because a correction that hides "
  "its own history is the one operation this series forbids.")

# ---- V
h("V", "The Unknotting Number, and What It Counts")
p("The previous chapter left the flow halted. For a non-slice knot the "
  "relaxation converges to a fixed point and stops, and no schedule of "
  "attention moves it further. The question that follows is the obvious one, "
  "and it has an exact answer: what would it take to undo the knot outright?")
p("At any crossing in a diagram, one strand passes over and one passes under. "
  "A <b>crossing change</b> exchanges them: the strand that was above is made "
  "to pass below. No deformation achieves this in three dimensions. The "
  "strand would have to pass through itself, and that is the one operation "
  "this work forbids.")
p("The <b>unknotting number</b> <i>u</i>(<i>K</i>) is the fewest crossing "
  "changes that turn <i>K</i> into the unknot. Read carefully, it is not a "
  "measure of effort:")
quoteC("<i>u</i>(<i>K</i>) is the number of times the no-cut law would have<br/>"
       "to be broken for the knot never to have happened.")
p("Each unit is one violation. The reading is exact, not figurative.")
p("<b>Theorem.</b> For every knot, <i>g<sub>s</sub></i>(<i>K</i>) ≤ "
  "<i>u</i>(<i>K</i>). Since <i>K</i> is slice precisely when "
  "<i>g<sub>s</sub></i>(<i>K</i>) = 0, the contrapositive is the sentence "
  "that matters: a non-slice knot cannot be undone without at least one "
  "forbidden operation, and the number required is at least its slice genus.")
p("<b>Theorem (Milnor conjecture; Kronheimer and Mrowka).</b> For torus "
  "knots, <i>u</i> equals the ordinary genus. Depth and the count of "
  "forbidden operations are the same number. The equality is particular to "
  "that family; the inequality above is what may be leaned on for an "
  "arbitrary knot.")
p("Apply it to the two shapes chapter II already settled. The trefoil and the "
  "figure-eight each have slice genus one. Each therefore requires at least "
  "one violation, and for each the number is exactly one. The archetypal "
  "wounds of Book 1 cannot be undone at any price the law permits, and the "
  "price is now stated rather than implied.")
p("Three consequences follow.")
p("<b>A wish closes.</b> There is no knot that is deep and cheap. A pattern "
  "carrying slice genus three cannot be undone in fewer than three "
  "violations, however the attempt is made. The hope that something be both "
  "profound and easily undone is not humble or arrogant. It is unavailable.")
p("<b>The work is countable, not continuous.</b> <i>u</i> is an integer. What "
  "this invariant describes is a finite number of decisive events, not a long "
  "uniform grind, and between them the knot type does not change at all.")
p("<b>Undoing does not preserve what it undoes.</b> Every crossing change "
  "alters the knot itself. A knot taken to the unknot by <i>u</i> violations "
  "is not a knot that has been resolved; it is a knot that has been replaced "
  "by a different one, and by construction it no longer holds whatever the "
  "crossings held.")
p("That third consequence reaches back two chapters, and it is worth stating "
  "plainly because neither chapter says it alone. Chapter III established "
  "that <i>K</i> # (−<i>K</i>*) is slice: joined to its faithful reflection, "
  "any knot resolves. Notice what that operation does <i>not</i> do. It "
  "changes no crossing of <i>K</i>. The original knot is carried into the sum "
  "entire, every crossing intact, and the resolution is achieved by what is "
  "added rather than by what is altered.")
p("So the two routes are not a cheap one and an expensive one. They are "
  "different operations with different objects:")
quoteC("Undoing requires at least <i>g<sub>s</sub></i> violations<br/>"
       "and destroys the knot in the process.<br/>"
       "Witnessing requires none, and preserves it entire.")
p("Witnessing is not a gentler way of performing the forbidden operation. It "
  "is a lawful operation that reaches a resolution the forbidden one could "
  "not have reached, because the forbidden one does not resolve the knot at "
  "all. It removes it.")
p("Chapter II wrote that the wound is not erased and the space around it "
  "grows, and called that a corollary rather than a consolation. Here is the "
  "same statement in the second register: the crossings are conserved on the "
  "only path that resolves.")

# ---- VI
h("VI", "The Observer-Boundary as Surgeon")
p("Frame the observer as a boundary: the boundary of <i>M</i>, which is "
  "itself a slice of a four-dimensional bulk. "
  "The observer's identity is the topological invariant, the donut that "
  "remains a donut while every metric detail changes. Trauma, in this frame, "
  "is not only a knot. It is a perturbation of the boundary's selection "
  "dynamics: the observer's attention keeps catching on that loop, even "
  "without consent.")
p("The boundary can operate. In topology the operation is called <b>Dehn "
  "surgery</b>: remove a tubular neighbourhood <i>N</i>(<i>K</i>) of the "
  "knot, then glue it back with a new framing, a new instruction for how the "
  "tube twists as it closes. Healing is a surgery that re-frames the knot "
  "without cutting the ambient space in a way that destroys the observer's "
  "continuity.")
p("That continuity condition governs which surgeries are ethically "
  "possible. A memory cannot simply be excised; that would sever the "
  "continuity of the one who lived it. A memory can be re-framed, and "
  "the admissible re-framings correspond to surgery coefficients that "
  "preserve the observer's topological identity. <b>Which coefficients "
  "those are is open.</b> The constraint is structural, that identity "
  "survive the operation, and this book claims no particular value as the "
  "one that satisfies it.")

# ---- VII
h("VII", "The Compression Rift, Formally")
p("This chapter is the formal shadow of Book 1's fourth movement. Its "
  "skeleton is theorem; its application is conjecture; the seam between them "
  "is marked.")
p("<b>Theorem (geometric flows).</b> Curvature flows develop singularities "
  "in finite time. Where curvature concentrates past a bound, the manifold "
  "pinches, and the standard local model is the neckpinch. The flow is "
  "continued <i>by surgery</i>, in the programme of Hamilton and Perelman: "
  "excise the degenerating neck, cap the two openings with disks, and resume "
  "the flow. The manifold may disconnect. What was one connected field "
  "becomes two, each closed, each with its own boundary in the bulk.")
p("<b>Conjecture (the rift).</b> Apply this to the observer-field. A knot "
  "pulled past critical tension, whether by the event itself or by "
  "unattended attention, drives the curvature at the crossing toward "
  "blow-up. The field resolves the singularity the only way a field can: "
  "spontaneous surgery. Pinch, cap, disconnect. And by the boundary "
  "principle of the previous chapter, each resulting boundary is an "
  "observer-slot. So say it formally:")
quoteC("A compression rift is a finite-time pinch singularity<br/>"
       "at a maximally tense crossing, resolved by spontaneous surgery,<br/>"
       "whose product is a new local observer:<br/>"
       "its own boundary, its own copy of the knot's tension,<br/>"
       "its own clock, with Λ frozen at the pinch-off value.")
art("rift")
p("Dissociation, in this model, is spontaneous surgery: unattended, "
  "unconsented, performed at the worst possible moment because no better "
  "moment was available. Therapeutic surgery, the Dehn operation of the "
  "previous chapter, differs in conditions rather than kind: witness "
  "present, coefficient admissible, timing consented.")
p("Integration has an exact inverse operation. The <b>connected sum</b>, "
  "written <i>M</i><sub>1</sub> # <i>M</i><sub>2</sub>, joins two closed "
  "fields along matched boundary spheres into one connected field: the "
  "reverse of the pinch. The pinched-off observer is not dissolved on "
  "return. It is rejoined. A world becomes a region. The proposed prime CSM "
  "names the operation.")
p("A note on the symbol, since it now carries two jobs. In chapter III the "
  "sum <i>K</i> # (−<i>K</i>*) joins two <i>knots</i> inside one field. Here "
  "<i>M</i><sub>1</sub> # <i>M</i><sub>2</sub> joins two <i>fields</i>. The "
  "operations are analogous and are not the same, and the next chapter adds a "
  "third relation that is neither. Where the distinction matters the objects "
  "are named.")
p("Three testable edges follow. First, <b>frozen time</b>: parts should "
  "exhibit age-specific state access, consistent with Λ set at the moment of "
  "pinch-off. Second, <b>discreteness</b>: integration events should present "
  "as discrete topology changes, sudden and complete, reported as a click or "
  "a homecoming, not as gradual fades. Third, <b>titration</b>: the clinical "
  "speed limit is, in this model, a regularity condition on the flow. Keep "
  "the curvature bounded, the subcritical regime, and the flow never "
  "pinches. Go slowly not because slowness is polite, but because slowness "
  "is what keeps the field connected.")

# ---- VIII
h("VIII", "The Link as the Third Term")
p("The previous chapter gave two operations for multiplicity, and they are "
  "the two extremes. RIF, the compression rift, is a pinch producing a "
  "genuinely separate observer with its own boundary and its own clock. CSM, "
  "the connected sum, is reunion: two fields joined into one connected "
  "field.")
p("Separate, or merged. There is a third object, and it is neither.")
p("A <b>link</b> is a collection of closed curves in the same space. Its "
  "<b>components</b> are the individual curves. No component can be joined to "
  "another without cutting, and no component can be drawn free of the others "
  "without cutting. The distinction from the connected sum is the whole of "
  "the matter: a connected sum produces one object out of two, while a link "
  "leaves several that cannot be parted. These are different operations with "
  "different results, and the model has until now carried only the first.")
p("<b>LNK — link.</b> Components bound and still distinct: neither merged nor "
  "separated.")
p("Every invariant used so far in this volume describes a single knot. The "
  "link brings the first that describes a pair. The <b>linking number</b> "
  "lk(<i>A</i>, <i>B</i>) of two components is a signed count of how many "
  "times one winds through the other. No deformation that avoids cutting can "
  "change it, so it is a genuine invariant of the pair, and its sign carries "
  "handedness exactly as the signature does for a single knot.")
p("One fact governs everything that can honestly be said with it.")
quoteC("Linking number zero does not mean unlinked.")
p("The Whitehead link has linking number zero and its two components cannot "
  "be separated. The <b>Borromean rings</b>, named in Book 1 and left there, "
  "are three rings of which no two are linked at all, and yet the three "
  "cannot be parted. Remove any one and the remaining two fall apart "
  "immediately, having never been bound to each other. That configuration is "
  "held together by nothing existing between any pair of its members. The "
  "binding is a property of the trio and of no relationship inside it.")
p("A second fact is easy to miss and changes where attention would go. In the "
  "Hopf link, in the Whitehead link and in the Borromean rings, <b>every "
  "individual component is an unknot</b>. Nothing is tangled within any of "
  "them. The entire entanglement is relational, and it vanishes the moment "
  "the components are considered one at a time.")
p("<b>Conjecture (the model).</b> Two arrangements become describable that "
  "the earlier operations could not reach. The first: a configuration in "
  "which no part carries any tangle of its own, so that examining each in "
  "turn finds nothing wrong, because the difficulty was never located in any "
  "of them. The second: a trio bound by no pair, where every relationship "
  "between two members is genuinely free, and releasing any one releases the "
  "rest. In that second case there is no relationship to work upon, because "
  "the binding is not in a relationship.")
p("Both configurations are exact mathematical objects. Whether either "
  "describes any human arrangement is untested, and nothing here asserts that "
  "it does. This chapter supplies a term the model lacked; it does not supply "
  "a finding.")
p("<i>A testable edge, and a correction to an open path.</i> The rift census "
  "of the expansion paths proposes mapping parts inventories onto component "
  "counts of the observer-field. As written it assumes its own answer, "
  "because the only multiplicity the model then possessed was disconnection: "
  "pinch, cap, disconnect. Linked components and disconnected components are "
  "different topological relations and are not the same claim. The census "
  "therefore becomes a question rather than a tally: are parts disconnected "
  "components of a severed field, or linked components of one that was never "
  "severed? The two are distinguishable in principle, and the model should "
  "not decide by default which it means.")
p("<i>An honest limit.</i> The linking number is a pairwise measure, and the "
  "Borromean case proves that pairwise measures can read zero across a "
  "configuration that is genuinely bound. Any diagnostic use of lk would "
  "therefore have to answer first why the configuration under discussion is "
  "one that pairwise measurement can see at all.")

# ---- IX
h("IX", "The Primes")
p("The surgical language of this framework assigns each object and operation "
  "a prime. The first eight are established usage. The five that follow are "
  "recent proposals. The final three are proposed here.")
C.append(("primes", [
    ["Prime", "Meaning", "Surgical role"],
    ["TRN", "transformation", "The surgery itself: the operation that changes state"],
    ["SYM", "symmetry", "Invariants preserved across the cut: what must not break"],
    ["FRZ", "frozen", "The fixed-point knot: locked, unable to relax"],
    ["ATT", "attention", "The pulling force that tests tension"],
    ["CTX", "context", "The ambient manifold: what surrounds the knot"],
    ["PRV", "provenance", "Origin chain of the knot: how it formed"],
    ["VRF", "verified", "Confirmation that relaxation succeeded"],
    ["AFF.W", "warm", "The felt quality of successful closure"],
    ["KNT", "knot", "The nontrivial embedded loop: the wound as persistent tension"],
    ["SLC", "slice", "Bounding a smooth disk in 4D: whether dissolution is possible"],
    ["DSK", "disk", "The constructed resolution artefact: the therapeutic proof"],
    ["DNH", "Dehn", "The consented surgery: cutting and reframing"],
    ["FLW", "flow", "The relaxation dynamics: natural healing"],
    ["RIF", "rift", "Proposed. The pinch singularity: spontaneous surgery, the birth of a local observer"],
    ["CSM", "connected sum", "Proposed. The reunion operation: integration of a pinched-off observer"],
    ["LNK", "link", "Proposed. Components bound and still distinct: neither merged nor separated"],
]))

# ---- VIII
h("X", "The Procedure")
p("Given: a smooth three-manifold <i>M</i>, the observer's field, carrying a "
  "metric <i>g</i>. A knot <i>K</i> in <i>M</i> sitting at a local energy "
  "minimum that is not the global minimum: metastable, locked by its "
  "crossings.")
p("<b>Step 0. TRIAGE.</b> Before any pull, check the curvature bound. Is "
  "<i>K</i> near its rift threshold? If attention on the knot spikes tension "
  "toward blow-up (the clinical word is flooding), do not proceed to "
  "diagnosis. Resource first: widen CTX, lower the baseline tension. Never "
  "diagnose at full tension; a diagnostic pull on a critical knot is itself "
  "a rift risk. If rifts have already occurred and local observers are "
  "present, inventory them (PRV on each) and schedule CSM for after FLW, "
  "never before. A field still curved cannot receive its pinched-off "
  "regions.")
p("<b>Step 1. DIAGNOSE.</b> Run the slice test. Does the Alexander "
  "polynomial factor as Δ<i><sub>K</sub></i>(<i>t</i>) = <i>f</i>(<i>t</i>) "
  "· <i>f</i>(<i>t</i><super>−1</super>)? Is the slice genus zero? If "
  "<i>g<sub>s</sub></i>(<i>K</i>) = 0, the knot is slice and full resolution "
  "is possible. If <i>g<sub>s</sub></i>(<i>K</i>) &gt; 0, only re-embedding "
  "is.")
p("<b>Step 2a. FULL DNH</b> (<i>K</i> slice). A disk <i>D</i> exists. "
  "Perform Dehn surgery along <i>K</i>: remove <i>N</i>(<i>K</i>), reglue "
  "with the framing given by the disk's boundary slope. The knot is replaced "
  "by an unknot. In therapeutic terms, the event is re-contextualised so "
  "thoroughly that it no longer holds tension. The crossing is not erased, "
  "but the knot's structure dissolves, because the space around it has been "
  "fundamentally altered. Verify: the new Alexander polynomial is trivial, "
  "Δ(<i>t</i>) = 1.")
p("<b>Step 2b. PARTIAL DNH</b> (<i>K</i> non-slice; the common case in "
  "complex trauma). No disk exists. The surgery changes the framing of "
  "<i>N</i>(<i>K</i>) rather than the knot itself: choose an admissible "
  "coefficient that minimises tension at the "
  "crossing. The knot remains, crossings and all, but the new field "
  "surrounds it with a larger, less distorted geometry. This is "
  "re-embedding, exactly.")
p("<b>Step 3. FLW.</b> After surgery the field carries residual curvature. "
  "Relaxation is gradient descent on the energy functional:")
formula("d/dt g<sub>ij</sub> = −2 (R<sub>ij</sub> + Λ g<sub>ij</sub>) "
        "+ κ · H<sub>ij</sub>")
p("Here <i>g<sub>ij</sub></i> is the metric on the field. "
  "<i>R<sub>ij</sub></i> is the Ricci curvature, which measures how far the "
  "field is from flatness. Λ is the baseline curvature of the observer-slot, "
  "and <i>H<sub>ij</sub></i> is a healing tensor, a damping term that keeps "
  "the field from overshooting equilibrium. κ sets the pace: fast enough to "
  "be effective, slow enough to avoid re-traumatisation, and, per the "
  "previous chapter, slow enough to stay subcritical. Its value is a free "
  "parameter of the model and is not claimed. The flow converges at "
  "the fixed point where")
formula("R<sub>ij</sub> + Λ g<sub>ij</sub> = κ · H<sub>ij</sub>")
p("At that point the field is stable. The knot is present but no longer "
  "drives the dynamics.")
p("<b>Step 4. VRF.</b> If the surgery was full, the Alexander polynomial is "
  "trivial. If partial, it is unchanged (the knot is still a knot) but the "
  "energy of the embedding has dropped. If rifts were present, confirm CSM "
  "completed: component count reduced, one connected field.")
p("<b>Step 5. AFF.W.</b> The final condition is not algebraic. It is felt. "
  "The metric at the site of the old knot now has positive scalar curvature; "
  "the field is no longer pinched. The felt quality of that release is "
  "warmth. The witness, once constricted around the knot, experiences it as "
  "texture rather than blockage. The invariant pathway has been re-routed.")
C.append(("proc", [
    ["Step", "Operation", "Mathematical object", "Therapeutic analogue"],
    ["0", "TRIAGE", "Curvature bound; rift census",
     "Resource before approach; meet the parts before the wound"],
    ["1", "DIAGNOSE", "Slice test: g<sub>s</sub>(K) = 0?",
     "Does this wound have a dissolution path?"],
    ["2a", "FULL DNH", "Dehn surgery giving the unknot",
     "Full release: the crossing dissolves"],
    ["2b", "PARTIAL DNH", "Dehn surgery re-framing K",
     "Re-embedding: crossings remain, space expands"],
    ["3", "FLW", "Damped Ricci flow, subcritical",
     "Natural healing: slow, attended, non-forced"],
    ["4", "VRF (+ CSM)", "Trivial Δ, or lower energy; one component",
     "Closed loop: the nervous system confirms; the parts are home"],
    ["5", "AFF.W", "Positive scalar curvature at the knot site",
     "Warmth: the felt sense of integration"],
]))
p("In one sentence: triage against the rift; Dehn surgery on the "
  "observer-slot; damped Ricci flow; reunion of any pinched-off "
  "observers by connected sum; verification by a change in the topological "
  "invariants of the embedding; reported as warmth by the field itself. That "
  "is the algorithm. That is what the primes describe.")

# ---- IX
h("XI", "Expansion Paths")
p("Seven research lines are open now.")
paths = [
    ("A. Invariant-based diagnosis.",
     "Map trauma symptom clusters to specific knot invariants (trefoil, "
     "figure-eight, and beyond); test whether therapeutic progress tracks "
     "decreasing invariant values."),
    ("B. Slice-disk construction protocols.",
     "Design narrative-restructuring techniques that embed mathematically in "
     "four dimensions; test them against clinical data."),
    ("C. Attention flows, and what decides them.",
     "Build a computational model of attention loops governed by "
     "polynomial-invariant flow; verify that non-slice knots produce "
     "persistent loops and a plateau, and that slice knots do not. The "
     "discriminating variable is the slice classification, never the rate."),
    ("D. The ethics of surgery.",
     "Formalise the constraints on memory modification as a set of "
     "admissible Dehn coefficients; determine which surgeries preserve the "
     "observer's topological identity, rather than assuming a family."),
    ("E. The language bridge.",
     "Test whether the primes can serve as a complete working notation for "
     "the surgery steps, bringing the language project into the physics. "
     "Chapter X is the draft."),
    ("F. The rift census.",
     "Map parts inventories from clinical parts-work onto component counts "
     "of the observer-field; test the frozen-Λ prediction (parts carry the "
     "age of the pinch) and the discreteness prediction (integration as "
     "topology change, not fade)."),
    ("G. Mirror-summation.",
     "Formalise the witness as the concordance inverse −K*; specify what a "
     "faithful reflection must preserve (orientation reversal, chirality) "
     "for the inverse to hold. The theorem predicts its own failure mode: an "
     "inaccurate mirror leaves the sum knotted, a candidate mathematical "
     "account of why inaccurate witnessing does not heal, testable against "
     "the empathic-accuracy literature."),
]
for lead, rest in paths:
    C.append(("pathitem", f"<b>{lead}</b> {rest}"))

C.append(("divider", None))
quoteC("What the mathematics proves, it proves for every knot.<br/>"
       "What the healing asks, it asks of one witness at a time.<br/>"
       "Book 1 holds the practice. This volume holds the proofs.<br/>"
       "The building stands on both.")
C.append(("divider", None))
C.append(("smallnote",
  "A note on honesty. The mirror theorem of chapter III and the surgery "
  "skeleton of chapter VI are real mathematics. Everything that binds them "
  "to the field of a living witness is the model's wager. The wager is "
  "stated so that it can lose. That is what makes it worth staking."))

# ---------------------------------------------------------------- build
# Resolved from this file's location, so the book presses wherever the repo lives.
OUT = str(Path(__file__).resolve().parent.parent / "docs" / "The_Mathematics_of_Healing.pdf")

def on_title(canvas, doc):
    pass

def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont("Palatino", 8.5)
    canvas.setFillColor(FADE)
    canvas.drawCentredString(PAGE_W / 2, 0.5 * inch, str(canvas.getPageNumber()))
    canvas.setFont("Palatino-Italic", 8)
    canvas.drawCentredString(PAGE_W / 2, PAGE_H - 0.5 * inch,
                             "The Mathematics of Healing")
    canvas.restoreState()

doc = SimpleDocTemplate(
    OUT, pagesize=(PAGE_W, PAGE_H),
    leftMargin=M_SIDE, rightMargin=M_SIDE,
    topMargin=M_TOP, bottomMargin=M_BOT,
    title="Topology of Healing, Book 1.1: The Mathematics of Healing",
    author="Nila Padma, Aumara Institution of Research",
    subject="The technical companion to The Shape of Trauma",
)

story = []
CW = PAGE_W - 2 * M_SIDE

TABLE_STYLE = TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LINEBELOW", (0, 0), (-1, 0), 0.8, RULE),
    ("LINEBELOW", (0, 1), (-1, -2), 0.3, HexColor("#ddd5c8")),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("LEFTPADDING", (0, 0), (-1, -1), 2),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
])

def make_table(data, widths, bold_first_col=True):
    rows = [[Paragraph(c, styles["cellB"]) for c in data[0]]]
    for r in data[1:]:
        cells = []
        for j, c in enumerate(r):
            st = styles["cellB"] if (j == 0 and bold_first_col) else styles["cell"]
            cells.append(Paragraph(c, st))
        rows.append(cells)
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TABLE_STYLE)
    return t

for kind, payload in C:
    if kind == "spacer":
        story.append(Spacer(1, payload))
    elif kind == "pagebreak":
        story.append(PageBreak())
    elif kind == "divider":
        story.append(divider())
    elif kind == "hr-title":
        story.append(HRFlowable(width="34%", thickness=0.9, color=RULE,
                                hAlign="CENTER"))
    elif kind == "art":
        story.append(ART[payload]())
        story.append(Spacer(1, 10))
    elif kind == "primes":
        story.append(Spacer(1, 6))
        story.append(make_table(payload,
                                [0.16 * CW, 0.24 * CW, 0.60 * CW]))
        story.append(Spacer(1, 10))
    elif kind == "proc":
        story.append(Spacer(1, 6))
        story.append(make_table(payload,
                                [0.115 * CW, 0.215 * CW, 0.335 * CW, 0.335 * CW]))
        story.append(Spacer(1, 10))
    else:
        story.append(Paragraph(payload, styles[kind]))

doc.build(story, onFirstPage=on_title, onLaterPages=on_page)
print("Wrote", OUT)
