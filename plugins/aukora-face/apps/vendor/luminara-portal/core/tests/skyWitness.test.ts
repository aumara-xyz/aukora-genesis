// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE PLACEMENT AND THE WITNESS — the architect's gate before the calendar:
// "make sure the glyphs are definitely in the right place." Held here as
// pins rather than as a glance, because the witness writes cell numbers
// into permanent records, and a misplaced glyph would poison every entry
// after it. Then the witness itself is pinned to its laws: stamped once at
// commit, never on replay, never an input to the draw, and kept only in
// the vessel's own store.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { rosetteLayout } from '../../spatial/app/map-room-figures.js';
import { codeOf, counterOf, knotOf, standingCellOf } from '../../spatial/app/luminara-canon.js';
import { metalOf } from '../../spatial/app/luminara-knots.js';
import { skyCellOf } from '../../spatial/app/luminara-sky.js';

const ROOT = path.resolve(import.meta.dir, '..', '..');
const READ = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-read.html'), 'utf-8');
const ASTRO = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-astrolabe.html'), 'utf-8');

describe('THE PLACEMENT — every glyph where the mathematics says', () => {
  const cells = rosetteLayout(50);
  const byN = new Map(cells.map((c) => [c.n, c]));

  test('the plate is a bijection: twenty-seven cells, each card once', () => {
    expect(cells.length).toBe(27);
    expect(new Set(cells.map((c) => c.n)).size).toBe(27);
  });

  test('shells are restlessness, radii their square roots', () => {
    for (const c of cells) {
      const moving = codeOf(c.n).filter((x) => x !== 0).length;
      expect(c.shell, 'shell of ' + c.n).toBe(moving);
      expect(Math.hypot(c.x, c.y)).toBeCloseTo(50 * Math.sqrt(c.shell), 9);
    }
  });

  test('the involution is a point reflection: every counter at the exact antipode', () => {
    for (const c of cells) {
      if (c.n === 1) continue;
      const cc = byN.get(counterOf(c.n))!;
      expect(cc.x).toBeCloseTo(-c.x, 9);
      expect(cc.y).toBeCloseTo(-c.y, 9);
    }
  });

  // THE SHADOW SEATS (10 August 2026, at the architect's word). The radii were
  // always measurements; the angles joined them: each cell sits at the azimuth
  // of the cube's shadow down its long diagonal, the triple-eclipse view. The
  // laws below were measured off the projection first and pinned second, so a
  // seat that drifts moves a red test before it moves the astrolabe, the
  // plate, the cast dial and the charts, which all quote this one layout.
  const signsOf = (n: number) => codeOf(n).map((d) => (d === 2 ? -1 : d));
  const parentsOf = (n: number) => {
    const w = [9, 3, 1];
    return codeOf(n).map((d, i) => (d === 0 ? null : n - d * w[i]))
      .filter((p): p is number => p !== null);
  };

  test('every middle cell stands at the exact bisector of its two parents', () => {
    for (const c of cells) {
      if (c.shell !== 2) continue;
      const [p1, p2] = parentsOf(c.n).map((p) => byN.get(p)!);
      const bx = p1.x + p2.x, by = p1.y + p2.y;
      expect(c.x * by - c.y * bx, 'collinear at ' + c.n).toBeCloseTo(0, 6);
      expect(c.x * bx + c.y * by, 'same side at ' + c.n).toBeGreaterThan(0);
    }
  });

  test('every corner stands within fifteen degrees of its three faces, on the even eight', () => {
    // the outer ring keeps the rosette's original rhythm (the shape was
    // reinstated at the architect's word, 10 August 2026), so each corner
    // takes the nearest even seat: four stand exactly fifteen degrees from
    // the summed direction of their faces, two stand exact, and the exact
    // pose lives in the solid's own bloom, the cube in the hand
    for (const c of cells) {
      if (c.shell !== 3) continue;
      if (Math.abs(signsOf(c.n).reduce((a, b) => a + b, 0)) === 3) continue; // the exiles
      const faces = parentsOf(c.n).map((p) => byN.get(p)!);
      const bx = faces.reduce((s, f) => s + f.x, 0), by = faces.reduce((s, f) => s + f.y, 0);
      const cosang = (c.x * bx + c.y * by) / (Math.hypot(c.x, c.y) * Math.hypot(bx, by));
      expect(cosang, 'within fifteen degrees at ' + c.n).toBeGreaterThanOrEqual(Math.cos(15.01 * Math.PI / 180));
      // and the seat itself sits on the eightfold grid
      const az = Math.atan2(c.y, c.x) * 180 / Math.PI;
      expect(Math.abs(az / 45 - Math.round(az / 45)), 'on the even eight at ' + c.n).toBeLessThan(1e-6);
    }
  });

  test('the three rings keep the even rhythm: sixty, thirty, forty-five degrees', () => {
    for (const [k, step] of [[1, 60], [2, 30], [3, 45]] as const) {
      const ring = cells.filter((c) => c.shell === k)
        .map((c) => ((Math.atan2(c.y, c.x) * 180 / Math.PI) % 360 + 360) % 360)
        .sort((a, b) => a - b);
      for (let i = 0; i < ring.length; i++) {
        const gap = (ring[(i + 1) % ring.length] - ring[i] + 360) % 360 || 360;
        expect(gap, 'gap on shell ' + k).toBeCloseTo(step, 6);
      }
    }
  });

  test('the exiles hold the vertical: Scar above, Seed centre, Return below', () => {
    // the Scar and the Return ARE the view axis, invisible in their own
    // shadow; their seats are the one fiat, and the fiat is pinned
    const scar = byN.get(14)!, ret = byN.get(27)!;
    expect(scar.x).toBeCloseTo(0, 9);
    expect(scar.y).toBeCloseTo(-50 * Math.sqrt(3), 9);
    expect(ret.x).toBeCloseTo(0, 9);
    expect(ret.y).toBeCloseTo(50 * Math.sqrt(3), 9);
  });

  test('the four still-watch cells hold the four stations of the year ring', () => {
    // both slow clocks moving, the fast one still: those four stand on the
    // cardinals, where the ring already raises its four station marks
    for (const n of [13, 16, 22, 25]) {
      const c = byN.get(n)!;
      expect(signsOf(n)[2]).toBe(0);
      expect(Math.min(Math.abs(c.x), Math.abs(c.y)), 'off the cardinal at ' + n).toBeCloseTo(0, 6);
    }
  });

  test('the instrument stays calm: the construction ink was withdrawn to the solid', () => {
    // hexagons and stack-threads stood on the plate for part of one day and
    // were withdrawn at the architect's word: a clock face wants calm, and
    // the confession of the projection lives on as the bloom of the cube in
    // the hand. Pinned so the ink does not creep back by fondness.
    expect(ASTRO.includes('rosetteFrame')).toBe(false);
    expect(/<polygon/.test(ASTRO)).toBe(false);
  });

  test('every cell wears the canon metal and carries the knot map’s own q', () => {
    for (const c of cells) {
      expect(c.metal, 'metal of ' + c.n).toBe(metalOf(c.n));
      expect(c.q, 'q of ' + c.n).toBe(knotOf(c.n).q);
    }
  });

  test('both clocks seat their digits exactly as the canon bijection', () => {
    for (const iso of ['2026-07-21T09:00:00Z', '2026-01-05T23:00:00Z', '2027-11-30T04:00:00Z']) {
      const d = new Date(iso);
      const sc = skyCellOf(d);
      expect(codeOf(sc.n)).toEqual([sc.time, sc.depth, sc.state]);
      const st = standingCellOf(d);
      expect(codeOf(st.index + 1)).toEqual([st.time, st.depth, st.state]);
    }
  });
});

describe('THE WITNESS — stamped once, checkable forever, never an input', () => {
  test('the stamp exists and is taken exactly once, at commit', () => {
    // one definition, one call: complete() and nowhere else. A replay must
    // read the journal, or the witness would be worthless.
    const hits = READ.split('skyStampOf(').length - 1;
    expect(hits).toBe(2);
    const replayBody = READ.slice(READ.indexOf('function replayCast'), READ.indexOf('$(\'replay\')'));
    expect(replayBody.includes('skyStampOf'), 'replay must never stamp anew').toBe(false);
    expect(replayBody).toContain('loadJournal');
  });

  test('the firewall: the sky never enters the draw', () => {
    expect(/drawOne\([^)]*(sky|stamp|witness)/i.test(READ)).toBe(false);
    expect(/drawThree\([^)]*(sky|stamp|witness)/i.test(READ)).toBe(false);
    // the stamp is computed from the wall clock after the rite, never from
    // anything the entropy path produced
    expect(READ).toContain('skyStampOf(new Date())');
  });

  test('the journal is the vessel’s own: local, capped, and never blocking', () => {
    expect(READ).toContain("'luminara-portal-journal-v1'");
    expect(READ).toContain('.slice(0, 200)');
    // both journal touches are guarded: a refused store never breaks a cast
    const journalBlock = READ.slice(READ.indexOf('function loadJournal'), READ.indexOf('function skyStampOf'));
    expect((journalBlock.match(/catch/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('the shelf keeps the record and renames only the label', () => {
    // the question is committed with the cast; the name is a later label
    expect(READ).toContain("question: $('questionIn').value.trim()");
    expect(READ).toContain('journalUpdate(castSeed, { name:');
    // renaming patches the entry, never rewrites seed, stamp or drawn
    const upd = READ.slice(READ.indexOf('function journalUpdate'), READ.indexOf('function journalForget'));
    expect(upd).toContain('...all[i], ...patch');
    for (const sealed of ['seed:', 'stamp:', 'drawn:']) {
      expect(upd.includes(sealed), 'rename must not write ' + sealed).toBe(false);
    }
    // the label falls back to the sky's own witness when nothing was asked
    expect(READ).toContain('const labelOf =');
    // and the shelf is the vessel's own, forgettable, never sent
    expect(READ).toContain('function journalForget');
    expect(READ).toContain('THE VESSEL&rsquo;S OWN');
    expect(/fetch\(|XMLHttpRequest|navigator\.send/.test(READ)).toBe(false);
  });

  test('the witness speaks the event register', () => {
    expect(READ).toContain('witnessed at commit');
    expect(READ).toContain('witnessed at the original cast');
    expect(READ).toContain('witness unknown');
  });
});

describe('THE LOG — read from the journal, never restamped, never sent', () => {
  test('the log reads the vessel’s own journal and nothing else', () => {
    expect(ASTRO).toContain("'luminara-portal-journal-v1'");
    // the astrolabe never stamps: the bench alone holds skyStampOf, so a
    // fix on the torus is always the record as written at commit
    expect(ASTRO.includes('skyStampOf')).toBe(false);
    expect(/fetch\(|XMLHttpRequest|navigator\.send/.test(ASTRO)).toBe(false);
  });

  test('the surface says its own laws aloud', () => {
    expect(ASTRO).toContain('READ, NEVER RESTAMPED');
    expect(ASTRO).toContain('THE VESSEL&rsquo;S OWN · THIS BROWSER ONLY · NEVER SENT');
    expect(ASTRO).toContain('never a profile');
  });

  test('the two pins rule the frame, and emptiness is honest', () => {
    expect(ASTRO).toContain('THE PIN OF THE SEED');
    expect(ASTRO).toContain('THE PIN OF THE SEAM');
    expect(ASTRO).toContain('NO CASTS WITNESSED IN THIS VESSEL YET');
    // the pathway graduated: the log is built, not waiting
    const pathways = ASTRO.slice(ASTRO.indexOf('PATHWAYS · NOT YET BUILT'));
    expect(pathways.includes('<b>THE LOG.</b>')).toBe(false);
  });
});

describe('THE DEPTHS ON THE BENCH — derived, refining, always clearing', () => {
  test('the depth read follows every change of level', () => {
    // one renderer, called wherever the level is set: the buttons and the
    // touch path alike, or the panel would speak a stale depth
    expect(READ).toContain('function renderDepthRead');
    const calls = READ.split('renderWheel(); setDial(); renderDepthRead();').length - 1;
    expect(calls).toBe(5);
  });

  test('the refinement law and the weather law are said aloud', () => {
    expect(READ).toContain('THE OUTER THREE STAND · THE NINE REFINE, NEVER REPLACE');
    expect(READ).toContain('THE FIELD IS THE PERMUTATION · WEATHER, NEVER VERDICT');
  });

  test('each depth describes itself, and quotes the sealed law rather than restating it', () => {
    // a reader arriving at 9 or 27 is told what the depth IS before being
    // told what it found. The law line beneath is the canon's own string
    // from luminara-81.js, so the page can never drift from the ruling.
    const nine = READ.slice(READ.indexOf('THE NINE · THE WEAVE'), READ.indexOf('THE WHOLE FIELD'));
    expect(nine).toContain('class="ddesc"');
    expect(nine).toContain('wideR.law');
    const field = READ.slice(READ.indexOf('THE WHOLE FIELD · HOW IT FELL'));
    expect(field).toContain('class="ddesc"');
    expect(field).toContain('unfolded.law');
    // the descriptions are prose about the depth, not authored meanings
    expect(field).toContain('not a list of twenty-seven meanings');
  });

  test('the depths sit under the wheel, not below the standing three', () => {
    // the panel once rendered after a reading fifteen hundred pixels tall, so
    // a change of depth altered nothing the reader could see. Order is
    // placement, never precedence: the three still stand, further down.
    const pane = READ.slice(READ.indexOf('<div id="castPane">'), READ.indexOf('id="seedrow"'));
    expect(pane.indexOf('id="depthRead"')).toBeLessThan(pane.indexOf('id="reading"'));
    // and the page never moves itself: placement is the whole answer. An
    // auto-scroll stood here briefly and was refused at the bench, so the
    // refusal is pinned rather than left to be rediscovered.
    expect(READ.includes('scrollIntoView'), 'the bench must not scroll the reader').toBe(false);
    expect(READ.includes('window.scrollTo'), 'the bench must not scroll the reader').toBe(false);
  });

  test('the overlay draws only at the whole field, and the panel clears', () => {
    expect(READ).toContain('if (level === 27 && unfolded)');
    // reset, a fresh commit and a replay each empty the panel by hand
    const clears = READ.split("$('depthRead').innerHTML = '';").length - 1;
    expect(clears).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// THE CAST DIAL (10 August 2026). The witness had been one line of text since
// July; the architect asked for the sky of each cast to be drawn. Nothing about
// how a cast is made changed, and that is the point of these pins: the dial is
// a renderer over a record that already existed, and it must stay one.
// ---------------------------------------------------------------------------
const DIAL = fs.readFileSync(path.join(ROOT, 'spatial', 'app', 'luminara-cast-dial.js'), 'utf-8');
// Scanned over the CODE, with comments stripped first. Every one of these pins
// went red on its first run against the module's own documentation: the file
// explains that it draws no text, no crescent and no terminator, and says
// "the dragon's window" throughout. A comment cannot draw a crescent or read a
// clock, and a pin that cannot tell an explanation from an act is testing prose.
const DIAL_CODE = DIAL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('THE CAST DIAL — a closed record, drawn and not consulted', () => {
  test('the module cannot read a clock even if asked', () => {
    // it is never given a date, and it may not reach for one. This is the
    // firewall held by construction rather than by care: a module with no
    // access to the time cannot leak the time into what it draws.
    for (const banned of ['Date', 'now(', 'Math.random', 'performance', 'localStorage']) {
      expect(DIAL_CODE.includes(banned), 'the dial must not reach for: ' + banned).toBe(false);
    }
    // and it is pure: no DOM, no state to drift. Matched as GLOBAL references,
    // since stamp.window is a field of the record and is not the browser's.
    for (const g of ['document', 'window', 'globalThis', 'self']) {
      expect(new RegExp('(^|[^.\\w])' + g + '\\s*\\.').test(DIAL_CODE),
        'the dial must stay pure: ' + g).toBe(false);
    }
    for (const banned of ['addEventListener', 'innerHTML', 'querySelector']) {
      expect(DIAL_CODE.includes(banned), 'the dial must stay pure: ' + banned).toBe(false);
    }
  });

  test('it speaks the astrolabe polar convention, sign for sign', () => {
    // zero east, increasing longitude anticlockwise, because SVG y runs down.
    // A dial that drew the sun clockwise from the top would be a different
    // instrument wearing the same clothes.
    expect(DIAL).toMatch(/Math\.cos\(-lon \* Math\.PI \/ 180\)/);
    expect(DIAL).toMatch(/Math\.sin\(-lon \* Math\.PI \/ 180\)/);
    expect(ASTRO).toMatch(/Math\.cos\(-lon \* Math\.PI \/ 180\)/);
  });

  test('the figure never speaks, never breathes, and cannot be touched', () => {
    // three separate statements in this portal's language, all made by absence
    expect(DIAL_CODE.includes('<text'), 'round faces carry no text').toBe(false);
    expect(/<animate|@keyframes|animation:/.test(DIAL_CODE),
      'a committed stamp that breathed would claim to be present tense').toBe(false);
    expect(/ringhit|cursor:\s*pointer|pointer-events/.test(DIAL),
      'no hit layer: the record it draws is closed').toBe(false);
  });

  test('only the three walkers are placed; the rest are properties of them', () => {
    // elong, lit and window are all derivable from sun, moon and node. Drawing
    // a derived value as its own mark would say there is more in the sky than
    // there is. The phase is the moon's luminance; the window is a ring.
    expect(DIAL).toMatch(/pol\(R_LIMB, stamp\.sun\)/);
    expect(DIAL).toMatch(/pol\(R_MOON, stamp\.moon\)/);   // her own lane, inside his
    expect(DIAL).toMatch(/pol\(R_LIMB, stamp\.node\)/);
    expect(DIAL).toMatch(/stamp\.node \+ 180/);          // the tail, opposite the head
    expect(DIAL).not.toMatch(/pol\(R_LIMB, stamp\.elong\)/);
    expect(DIAL).not.toMatch(/pol\(R_LIMB, stamp\.lit\)/);
  });

  test('the phase is luminance with its two pins, never a crescent', () => {
    expect(/clip|terminator|crescent/i.test(DIAL_CODE),
      'this portal draws phase as opacity, never as geometry').toBe(false);
    expect(DIAL).toMatch(/0\.15 \+ 0\.75 \* lit/);       // the astrolabe's own ramp
    expect(DIAL).toMatch(/DARK_PIN/);
    expect(DIAL).toMatch(/FULL_PIN/);
  });

  test('the bench draws the stamp it was given, at commit and on replay', () => {
    // at commit: the stamp just taken. On replay: the ORIGINAL stamp read from
    // the journal. Never a fresh one, or a cast from last winter would show
    // tonight's sky and the witness would be worthless.
    // the committed pair travels together: the stamp and the drawn three, at
    // commit from the rite's own variables, on replay from the journal alone
    expect(READ).toContain("castDialSvg(stamp, drawn)");
    expect(READ).toContain("castDialSvg(kept.stamp, kept.drawn)");
    expect(/castDialSvg\(\s*skyStampOf/.test(READ),
      'the dial must never be handed a freshly computed sky').toBe(false);
    expect(/castDialSvg\(\s*new Date/.test(READ),
      'the dial must never be handed a date').toBe(false);
    // and it clears with everything else, so a new question starts empty
    expect(READ).toMatch(/'seedOut', 'castDial'/);
  });

  test('the older firewall wording is corrected, not merely softened', () => {
    // "the clock never touches the draw" was false and had to be: the clock is
    // exactly what seeds it. What never touches the draw is the sky.
    expect(READ.includes('the clock never touches the draw')).toBe(false);
    const flat = READ.replace(/\s+/g, ' ');
    expect(flat).toContain('What never touches the draw is THE SKY');
  });
});

// ---------------------------------------------------------------------------
// THE DIAL, EXECUTED. Every pin above is a scan of source text, and for a while
// that was all this file could do: the module imported '/app/luminara-knots.js',
// a specifier the browser resolves and a test runner cannot, so the module could
// not be run at all. A drawing module that no test can execute is a drawing
// module whose geometry is unpinned. It imports relatively now, so the figure is
// held to what the function RETURNS.
// ---------------------------------------------------------------------------
import { castDialSvg, DIAL_BOX } from '../../spatial/app/luminara-cast-dial.js';
import { GOLD, WHITEGOLD } from '../../spatial/app/luminara-knots.js';

const stampOf = (o = {}) => ({
  iso: '2026-08-10T12:00:00.000Z', cell: 14, civil: 9,
  sun: 0, moon: 0, node: 0, elong: 0, lit: 50, window: false, ...o,
});
// Read the attributes once and index them by name, rather than building one
// pattern per attribute. The first attempt did the latter and matched NONE of
// them, so every coordinate came back zero and the geometry pins were asserting
// against nothing while looking exactly as though they worked. A literal
// regex here, never one assembled from a string, so there is no escaping to lose.
const attrsOf = (s: string) => {
  const o: Record<string, string> = {};
  for (const m of s.matchAll(/([\w-]+)="([^"]*)"/g)) o[m[1]] = m[2];
  return o;
};
const circles = (svg: string) => [...svg.matchAll(/<circle([^>]*)\/>/g)].map((m) => {
  const a = attrsOf(m[1]);
  return { cx: +(a.cx ?? 0), cy: +(a.cy ?? 0), r: +(a.r ?? 0),
           sw: +(a['stroke-width'] ?? 0), raw: m[1] };
});

describe('THE CAST DIAL, DRAWN — the figure the function actually returns', () => {
  test('zero degrees is due east and longitude runs anticlockwise', () => {
    // the sun is the one gold-FILLED circle: the plate's glyphs are paths, and
    // a gold cell ring is stroked, so the fill is the unambiguous signature.
    // 96 is the year ring, the astrolabe's own lane, since this is now that
    // face and not a smaller dialect of it.
    const sunAt = (lon: number) =>
      circles(castDialSvg(stampOf({ sun: lon }))).find((c) => c.raw.includes('fill="' + GOLD))!;
    expect(sunAt(0).cx).toBeCloseTo(96, 2);   expect(sunAt(0).cy).toBeCloseTo(0, 2);
    expect(sunAt(90).cx).toBeCloseTo(0, 2);   expect(sunAt(90).cy).toBeCloseTo(-96, 2);
    expect(sunAt(180).cx).toBeCloseTo(-96, 2);
    expect(sunAt(270).cy).toBeCloseTo(96, 2);
  });

  test('the two lights walk separate lanes, so the dark moon survives', () => {
    // struck on one ring they are concentric at conjunction and the sun, being
    // filled and larger, paints her out. That would delete the commonest and
    // most legible syzygy there is from the record of the cast it fell in.
    const svg = castDialSvg(stampOf({ sun: 0, moon: 0, lit: 0 }));
    const sun = circles(svg).find((c) => c.raw.includes('fill="' + GOLD))!;
    const moon = circles(svg).find((c) => c.r === 2.6 && c.raw.includes(WHITEGOLD) && c.cx !== 0)!;
    expect(Math.hypot(sun.cx - moon.cx, sun.cy - moon.cy)).toBeCloseTo(4.4, 2);
    // and 4.4 is not invented here: it is the astrolabe's own lane
    expect(ASTRO).toContain('pol(96, sky.sun)');
    expect(ASTRO).toContain('pol(91.6, sky.moon)');
  });

  test('a crossing is an emptiness and is drawn over the lights, never under', () => {
    // a light stands within ten degrees of a crossing in about one cast in
    // nine. The crossings are the only r=2.7 circles on the face, and both
    // must be emitted after the sun's gold fill: a filled disc drawn over an
    // open ring erases it, an emptiness over a body still reads.
    const svg = castDialSvg(stampOf({ cell: 14, sun: 0, node: 0, moon: 180 }));
    expect((svg.match(/r="2\.7"/g) || []).length).toBe(2);
    expect(svg.indexOf('r="2.7"')).toBeGreaterThan(svg.lastIndexOf('fill="' + GOLD));
  });

  test('every mark lies inside the declared box, in both states of the window', () => {
    for (const window of [false, true]) {
      for (const [sun, moon, node] of [[0, 0, 0], [123.4, 301.1, 88.8], [359.9, 180, 270], [45, 45, 45]]) {
        for (const c of circles(castDialSvg(stampOf({ window, sun, moon, node })))) {
          expect(Math.hypot(c.cx, c.cy) + c.r + c.sw / 2,
            'a mark left the box at sun ' + sun).toBeLessThanOrEqual(DIAL_BOX / 2);
        }
      }
    }
  });

  test('an incomplete record draws nothing at all, never a NaN', () => {
    for (const bad of [undefined, null, {}, { sun: 10 }, { sun: 10, moon: 20 },
      { sun: 10, moon: 20, node: 'x' }, { sun: NaN, moon: 1, node: 1 }]) {
      expect(castDialSvg(bad as never)).toBe('');
    }
    expect(/NaN/.test(castDialSvg(stampOf({})))).toBe(false);
    expect(READ).toContain('#castDial:empty { display:none; }');
  });

  test('the seed wears the sky cell metal, and gold is not the sun alone', () => {
    for (const n of [1, 5, 14, 22]) expect(castDialSvg(stampOf({ cell: n }))).toContain(metalOf(n));
    expect(ASTRO).toContain('metalOf(st.cell)');    // the log inks a cast the same way
    // gold is ALSO the seed's metal on the nine cells 19..27, so the older
    // claim in the module was false and must not creep back
    expect(metalOf(22)).toBe(GOLD);
    expect(DIAL.includes('gold is the sun and nothing else')).toBe(false);
  });

  test('ten circles either way; the window is an arc, never an eleventh mark', () => {
    // three compass circles, the plate seed, the year ring, the cell ring, the
    // moon, the sun and two crossings. The window adds a PATH on the year ring,
    // the arc it actually subtends, so the circle count does not move with it:
    // a condition is drawn as a condition, never as another body.
    expect(circles(castDialSvg(stampOf({ window: true }))).length).toBe(10);
    expect(circles(castDialSvg(stampOf({ window: false }))).length).toBe(10);
    expect(castDialSvg(stampOf({ window: true }))).toContain('stroke-width="2.2"');
    expect(castDialSvg(stampOf({ window: false })).includes('stroke-width="2.2"')).toBe(false);
    // the shelf draws chips, never faces: one dial on the page, at the architect's word
    expect(READ.split('castDialSvg(').length - 1).toBe(2);   // commit and replay, nowhere else
  });

  test('it recomputes no sky fact: the committed record is the only source', () => {
    expect(DIAL_CODE.includes('luminara-sky')).toBe(false);
    for (const banned of ['skyOf', 'skyCellOf', 'elongationOf', 'litFraction',
      'nodeDistance', 'DRAGON_WINDOW_DEG', 'norm360']) {
      expect(DIAL_CODE.includes(banned), 'the dial must not recompute: ' + banned).toBe(false);
    }
    // the window is the committed boolean: it was thresholded at commit against
    // the unrounded distance, while sun and node are each rounded to a tenth,
    // so a recomputation here could honestly disagree with the record
    expect(DIAL).toMatch(/if \(stamp\.window\)/);
    expect(DIAL_CODE.includes('stamp.elong')).toBe(false);
  });

  test('the module is importable, which is what makes this whole block possible', () => {
    expect(DIAL).toContain("from './luminara-knots.js'");
    // over the CODE: the header explains the old specifier by quoting it
    expect(DIAL_CODE.includes("'/app/")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE CONSTELLATION (11 August 2026): the committed three, on the plate. The
// architect asked for each cast's face to be distinct, and the answer was
// already lying on the plate: the diameters ARE the correspondences, so the
// cast raises its own three and joins its three cells. 2925 triangles before
// the sky moves at all.
// ---------------------------------------------------------------------------
describe('THE CAST DIAL — the constellation of the committed three', () => {
  const linesOf = (svg: string) => [...svg.matchAll(/<line([^>]*)\/>/g)].map((m) => attrsOf(m[1]));

  test('three drawn cards: three rings in their metals, three sides, raised diameters', () => {
    const svg = castDialSvg(stampOf({}), [2, 14, 22]);
    const rings = circles(svg).filter((c) => c.r === 9);
    expect(rings.length).toBe(3);
    for (const n of [2, 14, 22]) {
      expect(rings.some((c) => c.raw.includes(metalOf(n))), 'ring for ' + n).toBe(true);
    }
    // the raised diameters wear the cards' own metals at 0.45, above the
    // plate's 0.13 murmur; the triangle is whitegold at 0.3
    const raised = linesOf(svg).filter((l) => l['stroke-opacity'] === '0.45');
    expect(raised.length).toBe(3);
    // width 0.5 AND opacity 0.3: the four station folds share the opacity but
    // stand at 0.8, which this selector learnt by counting seven
    const sides = linesOf(svg).filter((l) => l['stroke-opacity'] === '0.3' && l['stroke-width'] === '0.5');
    expect(sides.length).toBe(3);
  });

  test('the Seed keeps her ring and has no diameter to raise', () => {
    const svg = castDialSvg(stampOf({}), [1, 5, 9]);
    expect(circles(svg).filter((c) => c.r === 9).length).toBe(3);
    // only two diameters lift: the Seed is her own counter
    expect(linesOf(svg).filter((l) => l['stroke-opacity'] === '0.45').length).toBe(2);
  });

  test('no drawn three, no constellation: the sky alone is still a lawful face', () => {
    // a cast witnessed elsewhere carries a stamp and no record of its three
    const svg = castDialSvg(stampOf({}));
    expect(circles(svg).filter((c) => c.r === 9).length).toBe(0);
    expect(svg.length).toBeGreaterThan(0);
    // and garbage in the drawn list draws nothing rather than guessing
    expect(circles(castDialSvg(stampOf({}), [0, 28, 3.5, 'x'] as never)).filter((c) => c.r === 9).length).toBe(0);
  });

  test('two casts with the same sky and different threes wear different faces', () => {
    const a = castDialSvg(stampOf({}), [2, 14, 22]);
    const b = castDialSvg(stampOf({}), [3, 15, 23]);
    expect(a).not.toBe(b);
    // and the same committed pair is the same face forever
    expect(castDialSvg(stampOf({}), [2, 14, 22])).toBe(a);
  });
});

// ---------------------------------------------------------------------------
// THE WITNESS STEPS OFF THE SURFACE (11 August 2026). The dial now shows what
// the line said, so the architect struck the text from the eye. It did NOT
// leave the page: the dial is aria-hidden like every generated figure here,
// and the line beneath it is what a reader who is read to receives. Deleting
// it outright would have made the stamp invisible to exactly the reader who
// cannot see the figure.
// ---------------------------------------------------------------------------
describe('THE WITNESS LINE — silent to the eye, spoken to the ear', () => {
  test('the line sits under the dial, hidden without being removed', () => {
    const dialAt = READ.indexOf('<div id="castDial">');
    const lineAt = READ.indexOf('id="witnessOut"');
    expect(dialAt).toBeGreaterThan(-1);
    expect(lineAt, 'the witness line lives under the figure it voices').toBeGreaterThan(dialAt);
    // hidden by clipping, never by display:none, which silences it everywhere
    expect(READ).toMatch(/\.sr \{[^}]*clip-path/);
    expect(/\.sr \{[^}]*display:\s*none/.test(READ)).toBe(false);
  });

  test('both fills keep it silent; the unknown witness alone speaks aloud', () => {
    // at commit and on a witnessed replay the class carries sr; when the
    // journal has no record there is no dial, and the absence explains itself
    expect(READ.split("className = 'seed sr'").length - 1).toBe(1);
    expect(READ).toContain("className = kept ? 'seed sr' : 'seed'");
  });

  test('the clock\'s own sentence is gone from the bench', () => {
    expect(READ.includes('this hour stands in'), 'the present hour is the astrolabe\'s room').toBe(false);
    expect(READ.includes('derived from the clock, never drawn')).toBe(false);
    // but the standing cell still breathes on the wheel: only the sentence left
    expect(READ).toContain('const stand = standingCellOf()');
  });
});
