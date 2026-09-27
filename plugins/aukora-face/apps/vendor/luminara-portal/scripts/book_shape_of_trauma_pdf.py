# -*- coding: utf-8 -*-
"""Typeset 'Topology of Healing, Book 1: The Shape of Trauma' as a 6x9 book PDF.

Knot illustrations are computed from real 3D knot parametrizations, projected
to the page; at each crossing the strand with lower depth is broken, so the
over/under structure of every diagram is genuine.
No em dashes anywhere in the text.
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
        self.curves = curves          # list of (pts3d, closed)
        self.dots = dots or []        # list of (x, y, r) in data coords
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


def _curve(fn, n, t0=0.0, t1=2 * math.pi, closed=True):
    pts = [fn(t0 + (t1 - t0) * i / n) for i in range(n)]
    return pts, closed


def art_trefoil(w=100, h=100, lw=1.3):
    tref = _curve(lambda t: (math.sin(t) + 2 * math.sin(2 * t),
                             math.cos(t) - 2 * math.cos(2 * t),
                             -math.sin(3 * t)), 420)
    return KnotArt([tref], w, h, lw=lw)


def art_fig8(w=118, h=100, lw=1.3):
    # Lissajous form of the figure-eight knot: (3, 2, 7), phases (0.7, 0.2)
    f8 = _curve(lambda t: (math.cos(3 * t + 0.7),
                           math.cos(2 * t + 0.2),
                           math.cos(7 * t)), 800)
    return KnotArt([f8], w, h, lw=lw)


def art_cinquefoil(w=150, h=150, lw=1.6):
    cq = _curve(lambda t: ((1 + 0.72 * math.cos(2.5 * t)) * math.cos(t),
                           (1 + 0.72 * math.cos(2.5 * t)) * math.sin(t),
                           math.sin(2.5 * t)), 900, 0, 4 * math.pi)
    return KnotArt([cq], w, h, lw=lw)


def art_unknot(w=72, h=72, lw=1.3):
    ci = _curve(lambda t: (math.cos(t), math.sin(t), 0.0), 200)
    return KnotArt([ci], w, h, lw=lw)


def art_hopf(w=120, h=82, lw=1.3):
    a = _curve(lambda t: (math.cos(t) - 0.62, math.sin(t), 0.0), 320)
    b = _curve(lambda t: (math.cos(t) + 0.62, math.sin(t),
                          0.5 * math.sin(t)), 320)
    return KnotArt([a, b], w, h, lw=lw)


def art_borromean(w=112, h=112, lw=1.3):
    PHI = (1 + math.sqrt(5)) / 2
    defs = [
        lambda t: (math.cos(t), PHI * math.sin(t), 0.0),
        lambda t: (0.0, math.cos(t), PHI * math.sin(t)),
        lambda t: (PHI * math.sin(t), 0.0, math.cos(t)),
    ]
    curves = []
    for f in defs:
        pts = []
        for i in range(420):
            t = 2 * math.pi * i / 420
            x, y, z = f(t)
            sx = (x - y) / math.sqrt(2)
            sy = (x + y - 2 * z) / math.sqrt(6)
            depth = (x + y + z) / math.sqrt(3)
            pts.append((sx, sy, depth))
        curves.append((pts, True))
    return KnotArt(curves, w, h, lw=lw)


def art_braid(w=236, h=72, lw=1.3):
    curves = []
    for k in range(3):
        ph = 2 * math.pi * k / 3
        pts = []
        for i in range(420):
            s = 4 * math.pi * i / 419
            pts.append((s, 0.8 * math.sin(s + ph), math.cos(s + ph)))
        curves.append((pts, False))
    return KnotArt(curves, w, h, lw=lw)


def art_rift(w=150, h=66, lw=1.3):
    pts = []
    for i in range(420):
        t = 2 * math.pi * i / 420
        pinch = 0.5 * (1 + math.cos(t))
        pts.append((math.cos(t), math.sin(t) * (0.12 + 0.88 * pinch) * 0.62, 0.0))
    loop = (pts, True)
    small = _curve(lambda t: (-1.42 + 0.19 * math.cos(t),
                              0.19 * math.sin(t), 0.0), 140)
    return KnotArt([loop, small], w, h, lw=lw, dots=[(-1.42, 0.0, 0.032)])


class TorusArt(Flowable):
    """Side view of the toroidal flow: lines rising through the central hole,
    fanning over the top, descending around the outside, re-entering below."""

    def __init__(self, w=176, h=128, lw=1.3, color=INK):
        Flowable.__init__(self)
        self.width, self.height = w, h
        self.lw, self.color = lw, color
        self.hAlign = "CENTER"

    def wrap(self, availW, availH):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setStrokeColor(self.color)
        c.setLineWidth(self.lw)
        c.setLineCap(1)
        c.setLineJoin(1)
        cx, cy = self.width / 2, self.height / 2
        s = min((self.width - 12) / 240.0, (self.height - 12) / 172.0)
        loops = [(34, 44, 0.86), (62, 62, 0.92), (92, 76, 0.96), (120, 86, 1.0)]

        for w0, a0, k in loops:
            w_, a_ = w0 * s, a0 * s
            for sgn in (1, -1):
                x = cx + sgn * w_
                pth = c.beginPath()
                pth.moveTo(cx, cy + a_)
                pth.curveTo(cx + sgn * w_ * k, cy + a_,
                            x, cy + a_ * 0.55, x, cy)
                pth.curveTo(x, cy - a_ * 0.55,
                            cx + sgn * w_ * k, cy - a_, cx, cy - a_)
                c.drawPath(pth, stroke=1, fill=0)

        def chev(x, y, up, sz):
            d = -sz if up else sz
            pth = c.beginPath()
            pth.moveTo(x - sz * 0.64, y + d)
            pth.lineTo(x, y)
            pth.lineTo(x + sz * 0.64, y + d)
            c.drawPath(pth, stroke=1, fill=0)

        sz = max(3.5, 7 * s)
        for idx in (1, 3):
            w_ = loops[idx][0] * s
            chev(cx + w_, cy - sz * 0.4, False, sz)
            chev(cx - w_, cy - sz * 0.4, False, sz)
        for off in (-28, 0, 28):
            y0 = cy + off * s
            c.line(cx, y0 - 10 * s, cx, y0 + 8 * s)
            chev(cx, y0 + 8 * s, True, sz * 0.8)
        c.restoreState()


def art_torus(w=176, h=128, lw=1.3):
    return TorusArt(w, h, lw=lw)


class TorusOutlineArt(Flowable):
    """A torus seen at a slight angle: outer silhouette plus the hole opening."""

    def __init__(self, w=124, h=80, lw=1.3, color=INK):
        Flowable.__init__(self)
        self.width, self.height = w, h
        self.lw, self.color = lw, color
        self.hAlign = "CENTER"

    def wrap(self, availW, availH):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setStrokeColor(self.color)
        c.setLineWidth(self.lw)
        c.setLineCap(1)
        c.setLineJoin(1)
        w, h = self.width, self.height
        cx, cy = w / 2, h / 2
        rx, ry = w * 0.44, h * 0.40
        c.ellipse(cx - rx, cy - ry, cx + rx, cy + ry)
        hy = cy + ry * 0.20
        hx, hh = rx * 0.50, ry * 0.34
        pth = c.beginPath()
        pth.moveTo(cx - hx, hy)
        pth.curveTo(cx - hx * 0.45, hy + hh, cx + hx * 0.45, hy + hh, cx + hx, hy)
        pth.curveTo(cx + hx * 0.45, hy - hh, cx - hx * 0.45, hy - hh, cx - hx, hy)
        c.drawPath(pth, stroke=1, fill=0)
        c.restoreState()


def art_torus_outline(w=124, h=80, lw=1.3):
    return TorusOutlineArt(w, h, lw=lw)


ART = {
    "trefoil": art_trefoil,
    "fig8": art_fig8,
    "cinquefoil": art_cinquefoil,
    "unknot": art_unknot,
    "hopf": art_hopf,
    "borromean": art_borromean,
    "braid": art_braid,
    "rift": art_rift,
    "torus": art_torus,
    "torus_outline": art_torus_outline,
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
    "sub":       S("sub", fontName="Palatino-BoldItalic", fontSize=12, leading=16,
                   alignment=TA_LEFT, spaceBefore=18, spaceAfter=5,
                   keepWithNext=1),
    "question":  S("question", fontName="Palatino-Italic", fontSize=10.5,
                   leading=16, leftIndent=22, rightIndent=22,
                   textColor=FADE, spaceBefore=8, spaceAfter=12,
                   alignment=TA_LEFT),
    "quoteC":    S("quoteC", fontName="Palatino-Italic", fontSize=11.5,
                   leading=19, alignment=TA_CENTER, spaceBefore=12,
                   spaceAfter=12),
    "smallnote": S("smallnote", fontName="Palatino-Italic", fontSize=9,
                   leading=13.5, textColor=FADE, alignment=TA_JUSTIFY,
                   spaceBefore=18),
    "invariant": S("invariant", leftIndent=20, firstLineIndent=-20,
                   spaceAfter=7, alignment=TA_LEFT),
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
def sub(t):    C.append(("sub", t))
def q(t):      C.append(("question", t))
def quoteC(t): C.append(("quoteC", t))
def art(key):  C.append(("art", key))
def sp(n):     C.append(("spacer", n))
def br():      C.append(("pagebreak", None))

# ---- title page
sp(64)
C.append(("tSeries", "TOPOLOGY OF HEALING"))
C.append(("tBook", "Book 1"))
sp(30)
C.append(("tTitle", "The Shape<br/>of Trauma"))
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
quoteC("The wound is not in the strand.<br/>It is in the embedding.")
p("Nothing that happened can be made to un-happen; the crossings are "
  "permanent. But every crossing is held in a space, and the space is not "
  "permanent. Space can grow.")
p("That is the whole of this small book. Everything after is the working-out.")

# ---- I
h("I", "What Survives Deformation")
p("Topology is an unusual way of looking at the world. Where geometry measures "
  "an edge or an angle with precision, topology asks something stranger: "
  "<i>what remains when measurement falls away?</i>")
p("Imagine clay on a wheel. You press it into a bowl. Then a vase. Then a wide, "
  "flat plate. Geometry says: three different objects, different curves, "
  "different volumes. Topology says: you have not cut the clay, you have not "
  "torn it. You have only stretched, pressed, smoothed. Under all that shaping, "
  "the clay is still one piece, still closed, still whole.")
p("Topology is the study of what survives deformation.")
p("A coffee cup and a doughnut are the same to a topologist, because each has "
  "exactly one hole; you could mold one into the other without tearing. A mug "
  "with two handles is a different creature entirely, for you cannot turn one "
  "hole into two without cutting. Topology sees the world not as a collection "
  "of fixed forms but as a field of <i>essential features</i>, the holes, "
  "loops, connections, and boundaries that persist through stretching, "
  "twisting, and bending. It is the science of the invariant: the thing that "
  "stays true when everything else changes.")
p("A river bends and floods and carves new banks, and still it flows from "
  "mountain to sea. That is its topology. A life changes cities, loses loves, "
  "gains wisdom, and something remains; call it the shape of the soul. That "
  "too is topology.")
p("Two questions, then, and they are the questions of this book:")
q("What stays the same when a life is deformed? What essential features does "
  "the deformation reveal?")

# ---- II
h("II", "The Knot")
p("A life is not a straight line. It is pressed, twisted, folded by story and "
  "experience. Some forces stretch it gently: a new love, a change of city, a "
  "quiet loss. Others fold it sharply. A sudden violence, a betrayal, a moment "
  "that feels as though it should not have happened. Sharp folds can lock. "
  "They become knots.")
p("A knot is a deformation that cannot be undone by force. A loop that has "
  "crossed itself in a way that holds. Pull on it, and it tightens. Leave it, "
  "and it sits as a permanent twist in the fabric of experience. Trauma is "
  "such a knot, held not in the body or the brain alone but in the structure "
  "of the witness itself, the part of you that experiences and remembers. The "
  "event folds you in a way that does not release. You carry the crossing not "
  "only as a memory but as a pattern: a loop that keeps firing, a response "
  "that keeps arriving, a part of you that remains stuck at the moment of "
  "folding.")
p("Trauma occurs when the finite, bounded witness within us is overwhelmed. "
  "What must be witnessed exceeds what the witness can hold, and the folds "
  "braid into a knot the witness cannot loosen from inside.")
p("Topology is honest about limits, and the honesty is the medicine. Some "
  "loops are truly knotted, and no amount of stretching, smoothing, or "
  "understanding will open them. This retires a false hope, the belief that "
  "<i>if I could just see it clearly enough, it would come undone</i>, and in "
  "the same motion it reveals the true one. A knot cannot be undone by "
  "cutting; cutting is violence, and the knot was born of violence already. "
  "It cannot be undone by pulling, for pulling only tightens it. But a knot "
  "is never a knot in itself. <b>A knot is a knot in a space</b>, and the same "
  "knot in a different space is not a blockage but a feature of the landscape.")
p("<i>Re-embedding</i> means changing the space around the knot. The crossings "
  "remain; the context shifts. What blocked the flow becomes part of the "
  "terrain, and the wound may become a door. This is not a metaphor. It is a "
  "structural account of healing, grounded in the same logic that sees a "
  "coffee cup and a doughnut as one shape.")
quoteC("Topology is the science of what cannot be erased.<br/>"
       "Trauma is the experience of what cannot be undone.<br/>"
       "Healing is the discovery that what cannot be undone<br/>"
       "can still be <b>re-placed</b>.")
p("The pages that follow read the shapes of knots. They are a guide to "
  "self-inquiry. A map, not a therapy.")

# ---- III
h("III", "Six Shapes")
p("Mathematical knots are closed loops that cannot be pulled back into a "
  "circle without cutting a strand. They are infinite in number. For this "
  "practice, six shapes are enough.")

sub("The Trefoil: one strand, three folds")
art("trefoil")
p("The first knot. Be precise about what it is, because the precision "
  "matters: the trefoil is <b>one continuous strand</b> that crosses itself "
  "three times. Not three ropes tangled together, but three folds of the same "
  "fabric. That is why you cannot work the strands separately. There is only "
  "one strand, and pulling anywhere tightens the whole loop.")
p("Three crossings, interlocked, that cannot easily be reconciled. The triad "
  "takes many contents but one shape:")
p("<b>The Event · The Frozen Response · The Isolation.</b> The moment that "
  "should not have happened. The body-mind that could not act, flee, or "
  "speak. The absence of witness afterwards: the silence, the belief that no "
  "one can hold this with you.")
p("<b>The Wound · The Story · The Identity.</b> The event, the narrative "
  "built around it, the self that formed in response. Change the story too "
  "quickly and the identity resists. Touch the wound directly and the story "
  "tightens.")
p("<b>What Happened · What Should Have Happened · What Almost Happened.</b> "
  "The actual, the imagined alternative, the near-miss. They coexist in the "
  "mind of the traumatised witness, and you cannot pull on one without the "
  "others tightening.")
p("The insight the shape gives: <b>the structure holds the trauma in place, "
  "not just the story</b>. Healing must address the crossings rather than the "
  "strands, because the strands are one strand, and it is you.")
q("What is your trifecta? Which three crossings hold your knot in place? "
  "Trace the single continuous strand that passes through all three. Which "
  "fold is tightest?")

sub("The Figure-Eight: the held paradox")
art("fig8")
p("The figure-eight appears when the wound is paradoxical: two opposing "
  "truths held in one loop, neither removable without tearing the whole. This "
  "knot asks: <i>how can both of these be true at once?</i>")
p("<b>Love and Harm.</b> The person who hurt you is the person who loved you. "
  "Pull on one truth and the other tightens.")
p("<b>Guilt and Innocence.</b> <i>I was responsible. I was not responsible.</i> "
  "The child who believes they caused it; the adult who knows they did not, "
  "and feels the guilt anyway. You cannot argue one away. The other rises to "
  "meet it.")
p("<b>I Want to Stay, I Need to Leave.</b> Both impulses genuine. Every step "
  "toward leaving tightens the pull to stay; every attempt to stay sharpens "
  "the need to leave. The knot <i>is</i> the paradox.")
p("<b>The Wound Is Me, The Wound Is Not Me.</b> The deepest figure-eight: the "
  "knot of identity. <i>I am the one who was broken</i> holds the memory. "
  "<i>I am not the break</i> holds the wholeness. Healing here is not "
  "choosing. It is learning to inhabit the crossing.")
p("Mathematics offers this knot a strange consolation. Of all simple knots, "
  "the figure-eight is the one whose surrounding space (everything the knot "
  "is not) carries, in a precise sense, the roomiest geometry there is. The "
  "wound that is a paradox is precisely the wound whose surrounding space can "
  "grow the largest. That is not a proof of anything. It is a rhyme worth "
  "sleeping on.")
p("A figure-eight cannot be resolved by picking a side. Healing is holding "
  "the paradox without collapse: naming both truths; letting both be real "
  "without forcing reconciliation; expanding the space around the knot "
  "through time, through witness, through new experience, until the two "
  "truths coexist without pulling against each other.")
q("Where are you holding two truths that seem to contradict? Can you name "
  "both without collapsing one into the other? What would it be to inhabit "
  "the crossing rather than resolve it?")

sub("The Hopf Link: bound circles")
art("hopf")
p("Two circles, each unknotted on its own, passed through each other so that "
  "they cannot be separated without opening one. Two rings, each whole, and "
  "bound. Their linking is a fact no deformation can remove.")
p("The Hopf link is relational: two people bound by a shared wound. Neither "
  "loop is knotted alone. The link is <i>between</i> them, not inside either "
  "one, which is why it cannot be resolved by one person's inner work alone.")
p("<b>The Caregiver and the Wounded.</b> The care and the wound become "
  "linked. The caregiver cannot leave without guilt; the wounded cannot heal "
  "without the caregiver. Neither moves without the other feeling the pull.")
p("<b>The Abuser and the Survivor.</b> Linked by the act itself. After "
  "separation the link remains. The survivor carries the abuser's presence "
  "internally, and the abuser carries the survivor's absence as a void.")
p("<b>The Parent and the Child.</b> An unhealed wound passes to the child not "
  "through blood but through the link, the child's loop entangled with the "
  "parent's before the child has words for it.")
p("<b>The Mirror Relationship.</b> Two people reflecting each other's wounds "
  "and gifts. Fated, magnetic, and a pattern: each triggering the other, each "
  "healing the other, neither able to leave or fully stay. The link is both "
  "the bond and the trap.")
p("Healing a Hopf link takes one of two forms. <b>Both loops together</b>: "
  "the link is recognised, named, and consciously re-embedded, until it is no "
  "longer a trap but a bond both choose. Or <b>one loop opens itself</b>: a "
  "clean separation.")
p("Here the earlier rule, that a knot cannot be undone by cutting, meets its "
  "one honest exception, and the shapes explain why it is not a "
  "contradiction. You can never cut your way out of a trefoil, because the "
  "knot is you; opening that strand destroys the loop itself. But in a Hopf "
  "link <b>each circle is unknotted</b>. Your loop was never knotted, only "
  "linked. To open your own circle, step free, and close it again elsewhere "
  "is a surgery you can survive, precisely because the tangle was between and "
  "not within. This is painful. It is sometimes necessary. And it is not "
  "failure. It is the recognition that some links cannot be re-embedded while "
  "both loops are still pulling.")
q("Is there a relationship where you feel bound by a shared wound, a loop not "
  "yours alone? If both loops could be free, what would that require from "
  "you? From them? And if only one loop can move first, can you name which "
  "one, without shame or blame?")

sub("The Borromean Rings: held by the third")
art("borromean")
p("Three rings, woven over and under so that the whole holds together. Yet no "
  "single ring is knotted, and, stranger still, <b>no two rings are "
  "linked</b>. Take any pair alone and they fall apart, innocent of each "
  "other. The binding exists only in the three together. Remove any one ring "
  "and the other two are free.")
p("This is the structure's teaching, and it is sharp: <i>when a pattern is "
  "three-ringed, working on any two of them will always fail.</i> Examine any "
  "pair together and you will find nothing holding; the lock lives only in "
  "the triple.")
p("<b>Body · Mind · Environment.</b> The body holds the somatic imprint; the "
  "mind holds memory and meaning; the environment holds the triggers. Years "
  "of talking therapy without the body, or somatic release without changing "
  "the environment: the structure holds, because the third ring is still "
  "there.")
p("<b>The Event · The Meaning · The Identity.</b> Change the meaning without "
  "touching the identity, and the identity pulls the old meaning back. Change "
  "the identity without processing the event, and the event reasserts itself.")
p("<b>Victim · Perpetrator · Bystander.</b> The wound, the act, the silence. "
  "This is why family secrets persist for generations. The bystander's "
  "silence is the third ring that keeps the other two locked, and no two of "
  "these roles are bound without the third.")
p("<b>Shame · Secrecy · Isolation.</b> <i>I am bad. No one can know. I am "
  "alone in this.</i> Remove any one and the other two lose their grip. As "
  "long as all three are present, they hold each other up.")
p("Do not confuse this shape with the trefoil, though both involve three. The "
  "trefoil is a single wound with three folds in one fabric. The Borromean "
  "rings are three separate circles, each complete, locked only in their "
  "interdependence. The trefoil asks you to work the crossings of one strand. "
  "The rings ask you to find the third element you have been leaving out of "
  "the room.")
q("Of the three rings of body, mind, and environment, the body must be "
  "addressed first. Not because it is more important: because it is the only "
  "one that is always present. The mind can dissociate. The environment can "
  "change. The body never leaves.")

sub("The Unknot: the difficulty of recognising it")
art("unknot")
p("A closed loop with no crossings. A simple circle. The default state, the "
  "shape every knot is measured against. The question asked of any tangle is: "
  "<i>can this be deformed into the unknot without cutting?</i> If yes, it "
  "was never truly knotted. If not, the knot is real.")
p("The unknot is experience before the wound: flow without obstruction, no "
  "locked crossing, no pattern repeating against your will. The open state of "
  "the witness.")
p("Two truths follow, one hard and one gentler than it looks.")
p("The hard truth: a trefoil cannot be unknotted. That is what makes it a "
  "trefoil. No stretching, twisting, or smoothing turns it into a circle. The "
  "crossings are locked. The wound is not erased, and the event is not "
  "undone. Only one thing can change, and it changes everything: the space "
  "around the knot.")
p("The gentler truth comes from real mathematics: <b>telling whether a "
  "tangled loop is secretly the unknot is genuinely difficult.</b> There are "
  "monstrous tangles, crossings piled on crossings, that fall open with the "
  "right sequence of moves, and no glance can tell you which you are holding. "
  "Even mathematics, with all its machinery, cannot decide at sight. So do "
  "not diagnose a life by looking. Some of what appears hopelessly knotted is "
  "a tangle awaiting one right move. The reverse humility also holds, for "
  "some of what looks simple is locked. The shape must be <i>worked with</i>, "
  "not judged.")
p("The practical movements of re-embedding, then. <b>Recontextualisation</b>: "
  "the knot is not removed; the frame is expanded, until what was the whole "
  "story becomes a chapter. <b>Re-weaving</b>: new threads of experience, "
  "meaning, and connection are woven around the knot until it is held in a "
  "larger weave and no longer pulls the cloth out of shape. <b>Spatial "
  "expansion</b>: the knot stays the same size; the field grows, and its "
  "weight diminishes not because it shrinks but because the container widens. "
  "<b>Integration</b>: the knot is no longer a foreign object in the psyche. "
  "Not erased; included. <b>Reduced tension</b>: the strands relax. Still a "
  "crossing, no longer a trap. Picture a kink in a garden hose. Release the "
  "tension on the crossing and the flow resumes.")

sub("Braids and Weaves: the pattern before it closes")
art("braid")
p("Not single knots but patterns of entanglement. These appear in complex "
  "trauma, where many events, losses, and betrayals weave into a fabric: not "
  "one knot but a network of crossings.")
p("A knot is a closed loop, locked. A braid is open-ended: strands crossing "
  "over and under in sequence, ends not yet joined. If a knot is a wound "
  "locked into shape, a braid is a pattern still being woven. Braids are the "
  "wounds that arrive as inheritance and repetition. Strands from parents, "
  "grandparents, culture, and history cross through you, and the same "
  "crossing-pattern appears with different partners, friends, authorities.")
p("Here mathematics hands us a theorem, and it should be said plainly because "
  "it is one of this book's load-bearing beams. A century-old result proves "
  "that <b>every knot, without exception, is a braid whose ends were "
  "joined.</b> Every locked wound was once an open, ongoing pattern that "
  "closed on itself. Which means every knot you now carry had a season when "
  "it was still a braid: still open-ended, still redirectable. And the "
  "patterns you are living <i>now</i> that have not yet closed are braids "
  "still. The difference between a pattern you are <b>repeating "
  "unconsciously</b> (a braid closing into the same knot again) and a pattern "
  "you are <b>weaving consciously</b> (a braid you are learning to redirect "
  "before it closes) is the difference on which a life turns.")
p("A weave is a braid grown dense: many strands in a regular, repeating "
  "pattern, a fabric that holds together on its own. The weave models "
  "complexity, the many wounds interwoven and shaping the whole person, and "
  "it also models resilience: a fabric of support, meaning, practice, and "
  "relationship that holds even when single strands are under tension. "
  "Healing, seen this way, is re-weaving. Not removing any strand, but "
  "introducing new strands and re-patterning the crossings until the fabric "
  "holds differently. If you can see the braid, you can begin to weave it.")
q("Which braid in your life is still open? What strand could you lay into it "
  "this month, before it closes?")

# ---- IV
h("IV", "The Compression Rift: Where a New Witness Is Born")
p("Begin with a fact from the physical world. A rope under load does not "
  "break at a random point. It breaks <b>at the knot</b>, because the knot "
  "concentrates curvature, and curvature concentrates stress. A knotted rope "
  "holds roughly half the weight of the same rope unknotted. Riggers and "
  "climbers know this in their hands. The knot is where the strand is closest "
  "to its limit.")
p("Now ask the question the shapes have not yet asked. What "
  "happens when a knot in the field of the witness is pulled past what the "
  "strand can bear? It does not untie; the crossings are permanent. And past "
  "a certain tension it does not merely hold, either.")
p("It rifts.")
p("Pulled tight enough, the crossing gathers the whole field's tension into a "
  "single region. The space around it pinches, the way a drop of water, drawn "
  "out, must finally narrow at the neck and let go. And the field does the "
  "only thing a living fabric can do with unbearable strain, short of "
  "tearing: it separates a small piece of itself to carry what the whole "
  "cannot. The neck closes. The piece seals over, complete, with a boundary "
  "of its own.")
p("In this way of seeing, a boundary is not a wall. A boundary is a witness. "
  "So say it exactly:")
quoteC("A knot, when pulled tight enough,<br/>"
       "forms a compression rift,<br/>"
       "and the rift generates a new local observer.")
art("rift")
p("A small witness, born at the crossing, whose entire world is the knot. It "
  "holds what the larger witness could not. It does not know the war is over, "
  "because its clock started at the moment of the rift, and its sky is the "
  "size of the wound.")
p("You have met these observers. The part of you that splits off and watches "
  "from the ceiling. The one who is forever the age the thing happened. The "
  "one who steps forward when the old pattern fires and speaks in your voice "
  "but not from your centre. The clinical language calls them dissociation, "
  "parts, protectors, the inner child. The shapes give them a birth "
  "certificate: <b>small witnesses born of compression</b>, each one the "
  "survival of an unsurvivable pulling.")
p("Hold the reframe carefully, because it changes the moral colour of "
  "everything. Dissociation is not malfunction. It is surgery, performed by "
  "the field on itself without consent, without anesthesia, in the only "
  "operating theatre available, at the worst possible moment. The rift is "
  "what the field does <i>instead of tearing</i>. Given the forces present, "
  "it was not the failure. Tearing was the failure. The rift was the success.")
p("Three consequences follow, and each one is practical.")
p("<b>Never pull a knot toward its rift threshold.</b> Attention is pulling; "
  "flooding is pulling hard. Every school of trauma work that actually works "
  "has independently discovered a speed limit: go slowly, resource first, "
  "approach and retreat. The shapes say why the limit exists. Past the "
  "threshold, pulling does not open the knot. It births another watcher.")
p("<b>The small observers are not obstacles to healing. They are colleagues "
  "in it.</b> Each holds a piece of the event at native resolution, closer to "
  "the crossing than the central witness can get. They are not debris to be "
  "cleared. They are the field's own archivists, and they answer to "
  "recognition, never to eviction.")
p("<b>Reintegration is not dissolution.</b> It is a joining: two closed "
  "fields rejoined along a shared boundary into one, the exact reverse of the "
  "pinch. The small observer does not die when it comes home. It stops being "
  "a <i>world</i> and becomes a <i>region</i>. What it held alone, the whole "
  "now holds.")
p("And one stretch outward, offered as speculation and nothing more. <i>As "
  "within, so without.</i> If every boundary is a witness, then perhaps every "
  "witness is the scar of some earlier rift, each of us pinched off, once, "
  "from some larger field under some primordial compression. We do not claim "
  "this. But it would explain a symmetry otherwise left dangling: why the "
  "beings capable of being wounded are exactly the beings capable of "
  "witnessing. Both capacities would be the same event, seen from its two "
  "sides.")
q("If you listened at your tightest crossing, is anyone there? How old are "
  "they? What is the size of their sky?")

# ---- V
h("V", "The Grammar of Healing")
p("The medicine, distilled. Six movements, in order of precedence though not "
  "always in order of time.")
p("<b>1. A witness who does not flinch.</b> Knots are formed in isolation, so "
  "the first medicine is presence without interference. Someone who does not "
  "say <i>let me fix this</i>, but <i>I see it. I am here. I am not afraid of "
  "it.</i> A knot held alone tightens, not because you are doing it wrong but "
  "because holding it alone re-enacts the aloneness it was born in. Most "
  "wounds were folded in an absence. No one saw, no one stayed. The knot "
  "formed in that absence, and it must be re-embedded in presence. The outer "
  "witness does not replace the witness within; they call it forward. Their "
  "staying makes it safe enough for you to turn toward the knot without being "
  "consumed. The release of a knot often passes through a temporary "
  "intensification; the crossing loosens and it feels raw. A witness who "
  "stays through the rawness is medicine. They see without solving. They hold "
  "without gripping. They reflect without interpreting: <i>“That part of "
  "you is still tight.” “Your breath changed when you said "
  "that.” “I see you.”</i>")
p("Mathematics, which has so far only described the wound, here offers its "
  "strangest gift. There is a theorem, real and proven, about knots and their "
  "reflections. No knot, alone, can be undone; we have said this from the "
  "start. But <b>any knot, however locked, joined to its exact mirror image, "
  "can be undone one dimension higher.</b> Alone, no wound resolves. "
  "Faithfully reflected, every wound can. And the theorem is exacting the way "
  "good witnessing is exacting: only the <i>faithful</i> reflection works. A "
  "distorted mirror leaves the whole still knotted. The witness must reflect "
  "truly, or the knot stays bound. That is what a witness is for.")
p("<b>2. Naming with precision.</b> A problem well stated is half solved, and "
  "trauma lives in the unspeakable, in <i>I don't know what happened but it "
  "still hurts</i>. The name that heals is not a story and not a diagnosis. "
  "It is a position: not <i>I was hurt</i>, but <b><i>I am the one who holds "
  "this loop. I am not the loop itself.</i></b> The name creates distance. "
  "Distance creates breath. Breath creates movement.")
p("<b>3. Gratitude before renegotiation.</b> A knot is not a mistake. It is a "
  "solution that has outlived its context. The trefoil kept you from falling "
  "apart. The figure-eight held two truths that could not both be carried. "
  "The Hopf link kept a bond intact at great cost. The Borromean rings built "
  "a cage that looked like protection, and was. The rift bore a watcher so "
  "the whole would not tear. To break any of these by force is to dishonour "
  "the protection they granted. So approach as if to say: <i>“You kept "
  "me alive. You held what I could not hold. Thank you for that "
  "service.”</i> The knot does not want to be broken. It wants to be "
  "recognised. It was never the enemy. It was the guardian, and guardians do "
  "not yield to attack. They yield to recognition, and to the quiet, "
  "evidenced promise that they are no longer required for survival.")
p("<b>4. The body leads.</b> Not because of topology but because of "
  "chronology. The body registered the wound before the mind understood it, "
  "and the environment will be perceived through the body's filters until the "
  "body settles. The flinch, the freeze, the shallow breath, the jaw: these "
  "are not responses to a thought. They are the knot expressing itself at the "
  "level of tissue. The story is a <i>description</i> of the knot; the knot "
  "itself is held in the nervous system, the fascia, the breath, the posture. "
  "Many approaches fail not because they are wrong but because they address "
  "the wrong ring first. Insight without the body yields understanding "
  "without change; the mind has new information while the body holds the old "
  "knot. A new environment without a settled body yields temporary relief; "
  "the dysregulated system recreates the same environment elsewhere. The "
  "sequence: <b>the body leads, the mind integrates, the environment is "
  "chosen from regulation rather than reaction.</b>")
C.append(("table", [
    ["Shape", "Why the body must lead"],
    ["Trefoil", "The three folds are locked in the nervous system; the freeze "
     "must complete somatically before the story can integrate."],
    ["Figure-eight", "The paradox splits the physiology; the body is in two "
     "states at once. The work is letting it hold both without collapsing "
     "into one."],
    ["Hopf link", "Two nervous systems are regulating off each other. Both "
     "bodies must be addressed, in sequence or sometimes together."],
    ["Borromean rings", "The body is the ring that, addressed first, loosens "
     "the other two. Mind and environment depend on its state."],
    ["Braids / weaves", "Ongoing patterns are woven into tissue through "
     "repeated posture, breath, chronic tension. Re-weaving begins "
     "somatically or it does not hold."],
    ["Compression rift", "The small observer lives in the body's holding "
     "pattern. It answers to felt safety, never to argument, and it rejoins "
     "only a body it can trust."],
]))
q("If you trusted that your body knew the way into the knot before your mind "
  "understood it, what would it ask you to do first?")
p("<b>5. Attended time.</b> The knot does not dissolve with waiting. It "
  "dissolves with <i>attended</i> time: time where the witness is present, "
  "where the knot is named again and again, each time with less charge, each "
  "time with more space. There is no shortcut through an invariant. But there "
  "is a direction, and the direction is up. Imagine lifting a tangled "
  "necklace off a table and watching the knot fall open. The lift, the extra "
  "dimension, did what no amount of tugging along the table's surface could. "
  "In four dimensions a knot can be lifted apart: not erased, but no longer "
  "binding; the crossings remain as memory but no longer hold the loop tight. "
  "Healing is finding that extra dimension inside yourself. Not a place you "
  "go, but a spaciousness you grow into. And no dimension opens on its own. "
  "It must be held open, attended, until the knot learns the new shape of "
  "space.")
p("<b>6. Renegotiation by lived evidence.</b> After recognition comes "
  "renegotiation. The knot asks: <i>if I loosen, what will happen?</i> The "
  "answer cannot be argued; it must be shown. Show it you are now larger than "
  "the event. Show it there is a witness who can hold what once could not be "
  "held. Show it the danger has passed, or that you can now meet it "
  "differently. This is not done in a healing session. It is done by living. "
  "Each time you choose a different response to the old pattern, you send the "
  "knot one message: <i>you can rest now.</i>")

# ---- VI
h("VI", "The Nodus and the Groove")
p("In a person who carries the complex, the knots do not sit in isolation. "
  "They converge. They share a region of the inner field where the fabric is "
  "most compressed, most folded, where all the strands pass through the same "
  "narrow passage. A clinician would call it the core complex: the earliest "
  "wound, the organising belief that all later strategies orbit and protect. "
  "The shapes call it something simpler. Not another knot, but <b>the knot of "
  "knots</b>, the place where the space itself is most distorted. Release "
  "that single region (not the knots, but the space they share) and the knots "
  "do not vanish, yet they lose their grip, because the field around them can "
  "finally breathe.")
p("The Latin gives it a name: <i>nodus</i>, knot, but also difficulty, "
  "complication, the point where the plot tightens. And it gives that knot a "
  "dark side, an <i>umbra</i>: the shadow where all shadows meet, where light "
  "cannot reach because too many crossings block it. That darkness is why the "
  "nodus is so seldom seen head on, and why it is usually found instead by "
  "what orbits it.")
p("The nodus is not a flaw. It is the crease pressed into the fabric by the "
  "earliest forces that shaped you, the original instruction that all later "
  "instructions orbit. Name it a contract: an agreement made before you had "
  "words, a promise the organism made to itself in order to survive, written "
  "since into every fascial line and breath pattern. A contract is not a "
  "punishment. It is a binding line of force, and a contract can be "
  "renegotiated. Never by breaking it, for a broken contract leaves a void "
  "that the old pattern refills, but by rewriting it from the inside: witness "
  "present, gratitude given, and the lived evidence that the being is now "
  "large enough to hold what the contract was protecting.")
q("If you felt for the place where your own knots converge, not the loudest "
  "knot but the one all the others seem to orbit, what would you find there?")
p("The nodus is not static. It was pressed into the field by a specific "
  "force, at a specific time, in a specific relational context, and the press "
  "left a path of least resistance, a groove that later experience tends to "
  "follow. That groove is the <b>invariant pathway</b>. Not a knot, but the "
  "route the energy takes <i>between</i> the knots. The channel worn by "
  "repetition. The trajectory of the inner field when no conscious attention "
  "is steering.")
p("A trigger arrives. The field follows the groove. The experience plays out "
  "along the pathway. The witness arrives at the familiar knot and calls it "
  "<i>this again</i>.")
p("Map only the knots and you will miss it. The knots are where the pathway "
  "loops back on itself, but the pathway is the deeper invariant, the habit "
  "of movement the field learned before it had words for what it was "
  "learning. This is why working the knots one by one, though necessary, is "
  "not sufficient. Leave the groove intact and the field will eventually "
  "carve a new knot along the old route. The content shifts; the shape "
  "returns.")
p("The pathway does not change by insight. It changes by <b>repetition of a "
  "different movement</b>: a different breath when the trigger arrives, a "
  "different word when the old story rises, a different posture when the body "
  "starts to fold. Each choice lays a single thread of a new weave. Over "
  "months and years, with witness, with the body leading, with gratitude for "
  "what the old pathway held, a new groove is worn alongside the old. The old "
  "one is not fought. It grows over from disuse, remaining as map and history "
  "while the flow takes the new route.")
q("If you could feel the groove in your own field, not the loudest knot but "
  "the channel the energy follows before it reaches the knot, where does it "
  "begin? And what single different movement, repeated, would begin wearing a "
  "new path beside it?")

# ---- VII
h("VII", "The Toroid and the Healed Shape")
art("torus_outline")
p("The knot of knots does not float in empty space. It is held in a field: a "
  "living toroid of experience, a doughnut-shaped surface that turns itself "
  "inside out, constantly. A torus has an inside and an outside that are "
  "continuous with each other. You can travel from one to the other without "
  "crossing a boundary. The surface loops around a central void: the empty "
  "hub, the still point of the witness itself.")
p("And here the figure stops being a figure. The body is not <i>like</i> a "
  "torus. The body <i>is</i> one. A single passage runs the whole length of "
  "you, beginning at the mouth, and it never breaks: one continuous channel. "
  "If topology counts holes, then by its count you carry exactly one. You are "
  "built around a throughway. The world enters, gives what it has to give, "
  "and moves on. What you call your interior is wrapped around a channel that "
  "was never, strictly, inside you at all.")
p("You were not always this shape. In the first weeks of a life the embryo is "
  "a nearly flat sheet, and then it folds. The edges curl and meet, and a "
  "tube forms down the centre: the primitive gut, the first hollow. That "
  "folding is the moment the organism becomes a torus, the moment a simple "
  "surface acquires its central void. Every human body is a fold that learned "
  "to stay folded. We are made, from the very beginning, by the same "
  "operation this book has spent its length describing. The difference is "
  "that this first fold is generative: it opens a space rather than locking "
  "one.")
art("torus")
p("And the torus turns. It does not sit still like a diagram. Breath draws "
  "the outside in and gives it back. The belly keeps its slow tide moving. "
  "The heart, as it fills, spins the incoming blood into a ring-shaped "
  "vortex, a small torus turning inside the larger one, before pressing it "
  "onward. The living body is a torus in perpetual circulation, turning its "
  "inside toward its outside and back again, exactly as the field of "
  "experience does.")
p("This is why the body must lead: a knot in the field is held in the same "
  "topology as the body that carries it, which is why the knot is never only "
  "an idea. It arrives as the held breath, the gripped gut, the fascia that "
  "will not release along its line. The <i>gut feeling</i> is not a phrase "
  "language borrowed for colour; it is the toroidal core reporting its own "
  "tension. The nerve that carries most of that report, the vagus, runs from "
  "the gut to the brainstem, and it sends far more news upward than it "
  "receives down. The body is not waiting for the mind's verdict. It is "
  "filing the first report.")
p("One further turn, offered. The heart's motion generates a measurable "
  "field, roughly toroidal, that reaches past the skin. That the field "
  "exists is instrument-fact. That it carries coherence, that one body's "
  "turning can be felt by another before a word is spoken, is not certainty. "
  "But it rhymes.")
p("The knots you carry are folds in this turning surface, places where it has "
  "been pinched into a pattern that repeats rather than flows. The nodus is "
  "the deepest fold, the point of maximum compression, and therefore the "
  "window. Release enough tension there and the entire field can reorganise. "
  "The toroid has been turning the same way for so long it has forgotten it "
  "could turn another way. That forgetting is the contract. The remembering "
  "is the work.")
p("Which leaves the last shape, the one this book has been walking toward. "
  "What does healed look like?")
p("Not the unknot again. There is no return to innocence, and topology, "
  "honest to the last, will not pretend otherwise. The healed shape is <b>a "
  "torus with a braided surface</b>: the central void still open, the flow "
  "continuous, and the surface carrying the trace of every crossing ever "
  "held. The crossings are not erased. They are integrated, woven into the "
  "texture of the field so that they no longer block the flow. Where there "
  "was a blockage there is now a place where the map is folded, a reminder of "
  "where you have been. Not a wound. A wisdom.")
p("The healed field is not innocence restored. It is <b>integrated complexity "
  "that does not collapse under its own weight</b>.")

# ---- VIII
h("VIII", "What Survives When This Book Is Deformed")
p("A book about invariants should be able to survive its own method. Stretch "
  "this book, compress it, translate it into another vocabulary entirely, "
  "whether clinical, mathematical, or devotional, and these are the features "
  "that persist. Everything else is embedding.")
inv = [
    ("The wound is in the embedding, not the strand.",
     "Space, not story, is the lever."),
    ("What cannot be undone can be re-placed.", ""),
    ("Force tightens.",
     "Cutting the self is never an option; opening a link sometimes is, "
     "because links are between, and knots are within."),
    ("The structure holds the trauma.", "Work the crossings, not the strands."),
    ("Some paradoxes are load-bearing.",
     "Healing is inhabiting the crossing, not resolving it."),
    ("What binds three may be innocent in every pair.",
     "When working two at a time fails, look for the third ring."),
    ("Every locked pattern was once an open one,",
     "and the still-open ones can still be redirected. (This one is a "
     "theorem.)"),
    ("Pulled past its threshold, a knot does not yield. It rifts,",
     "and someone small is born to hold it. Never pull toward the rift."),
    ("The knot is a guardian.",
     "Guardians yield to recognition and evidence, never to attack."),
    ("The body leads, because the body was there first.",
     "Chronology, not hierarchy."),
    ("The groove is deeper than the knots.",
     "New pathways are worn by repetition, not declared by insight."),
    ("The healed field is not innocence restored but complexity integrated.",
     ""),
    ("The space can always grow.",
     "This is the invariant of invariants: whatever else is locked, the "
     "field around it is not."),
]
for i, (lead, rest) in enumerate(inv, 1):
    text = f"{i}.&nbsp;&nbsp;<b>{lead}</b>"
    if rest:
        text += f" {rest}"
    C.append(("invariant", text))

# ---- IX
h("IX", "The Door")
p("These lines of questioning require no mathematical background. They "
  "require attention to form, and that is exactly what topology offers. The "
  "shapes give you eyes; the body gives you the door.")
p("Every shape mapped here (trefoil, figure-eight, Hopf link, Borromean "
  "rings, braid, rift) is a shape the witness took in order to survive. Each "
  "crossing was a strategy. Each fold was a guardian. They are not mistakes; "
  "they are solutions that have outlived their context. Healing is not "
  "removing them. It is re-embedding them into a larger field, grown through "
  "the body, through attended time, through the slow laying of new pathways "
  "until the old grooves quiet from disuse.")
p("And all of it, the shapes, the nodus, the groove, the toroid, has been "
  "pointing at a single door. At that door there is no technique, no "
  "topology, no witness but yourself. Just the quiet decision to no longer "
  "hold the crossing against yourself.")
p("Forgiveness is not untying the knot. It is releasing the tension at every "
  "crossing at once, not because the knot is gone but because you are no "
  "longer pulling against it.")
C.append(("divider", None))
quoteC("You are no longer the one who tightens it.<br/>"
       "You are the space that holds it.<br/>"
       "And that space can always grow.")
quoteC("And if, at the tightest crossing, you find a small watcher<br/>"
       "still at their post, relieve them gently.<br/>"
       "The war is over. Their sky can be your sky now.<br/>"
       "Bring them home.")
C.append(("divider", None))
C.append(("smallnote",
  "A note for the curious. Behind this edition stands a technical one: "
  "<i>Topology of Healing, Book 1.1, The Mathematics of Healing</i>, where "
  "the shapes are given their full mathematical names and the healing "
  "movements their formal steps. Nothing essential lives only there. The "
  "mathematics confirms what these pages say in plain speech. Most "
  "remarkably, it confirms that the two most common wound-shapes provably "
  "cannot be dissolved, only re-embedded, and that any knot joined to its "
  "faithful mirror image can be undone one dimension higher. The rest is "
  "scaffolding, and the building stands without it."))

# ---------------------------------------------------------------- build
# Resolved from this file's location, so the book presses wherever the repo lives.
OUT = str(Path(__file__).resolve().parent.parent / "docs" / "The_Shape_of_Trauma.pdf")

def on_title(canvas, doc):
    pass

def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont("Palatino", 8.5)
    canvas.setFillColor(FADE)
    canvas.drawCentredString(PAGE_W / 2, 0.5 * inch, str(canvas.getPageNumber()))
    canvas.setFont("Palatino-Italic", 8)
    canvas.drawCentredString(PAGE_W / 2, PAGE_H - 0.5 * inch,
                             "The Shape of Trauma")
    canvas.restoreState()

doc = SimpleDocTemplate(
    OUT, pagesize=(PAGE_W, PAGE_H),
    leftMargin=M_SIDE, rightMargin=M_SIDE,
    topMargin=M_TOP, bottomMargin=M_BOT,
    title="Topology of Healing, Book 1: The Shape of Trauma",
    author="Nila Padma, Aumara Institution of Research",
    subject="A contemplative topology of trauma and healing",
)

story = []
CW = PAGE_W - 2 * M_SIDE

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
    elif kind == "table":
        rows = []
        header = payload[0]
        rows.append([Paragraph(header[0], styles["cellB"]),
                     Paragraph(header[1], styles["cellB"])])
        for r in payload[1:]:
            rows.append([Paragraph(r[0], styles["cellB"]),
                         Paragraph(r[1], styles["cell"])])
        t = Table(rows, colWidths=[0.30 * CW, 0.70 * CW])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, RULE),
            ("LINEBELOW", (0, 1), (-1, -2), 0.3, HexColor("#ddd5c8")),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 2),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(Spacer(1, 6))
        story.append(t)
        story.append(Spacer(1, 10))
    else:
        story.append(Paragraph(payload, styles[kind]))

doc.build(story, onFirstPage=on_title, onLaterPages=on_page)
print("Wrote", OUT)
