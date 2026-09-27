// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THIRD-PARTY PINS. The portal is AGPL and Aukora's, and every header in the
// tree says so. The moment a file arrives under another licence, the thing that
// keeps the repository honest is not goodwill but a register: docs/THIRD_PARTY.md
// names what came in, from where, under what terms, changed how, and on whose
// word. This file holds that shut.
//
// Two directions are pinned, because either alone can rot. A third-party file
// with no row in the register is a defect; a row in the register naming a file
// that no longer exists is also a defect.
//
// The specific case these were written for: spatial/app/luminara-harp-v2.html is
// Peter Viviani's Zeta Harp v2, hosted by permission. Its only two network
// surfaces were excised on the way in, because the portal's self-contained law
// names a runtime fetch of a library as precisely the forbidden thing. Nothing
// stops a later edit reintroducing one except a test that goes red.

import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const APP = path.join(ROOT, 'spatial/app');
const REGISTER = path.join(ROOT, 'docs/THIRD_PARTY.md');

// a file is third-party if it says so where a reader cannot miss it
const MARK = 'THIRD-PARTY INSTRUMENT, HOSTED BY PERMISSION';

const thirdPartyFiles = fs.readdirSync(APP)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => fs.readFileSync(path.join(APP, f), 'utf8').includes(MARK));

describe('THIRD PARTY · the register is the law', () => {
  test('the register exists and is not a stub', () => {
    expect(fs.existsSync(REGISTER), 'docs/THIRD_PARTY.md must exist').toBe(true);
    expect(fs.readFileSync(REGISTER, 'utf8').length).toBeGreaterThan(1200);
  });

  test('every third-party file has a row in the register', () => {
    expect(thirdPartyFiles.length).toBeGreaterThan(0);
    const reg = fs.readFileSync(REGISTER, 'utf8');
    for (const f of thirdPartyFiles) {
      expect(reg, f + ' is third-party but unregistered in docs/THIRD_PARTY.md')
        .toContain('spatial/app/' + f);
    }
  });

  test('every file the register names still exists', () => {
    const reg = fs.readFileSync(REGISTER, 'utf8');
    for (const m of reg.matchAll(/spatial\/app\/([a-z0-9-]+\.html)/g)) {
      expect(fs.existsSync(path.join(APP, m[1])),
        'the register names a file that is gone: ' + m[1]).toBe(true);
    }
  });

  test('a third-party file states its own licence and disclaims the portal\'s', () => {
    for (const f of thirdPartyFiles) {
      const src = fs.readFileSync(path.join(APP, f), 'utf8');
      expect(src, f + ' must name its author').toMatch(/Copyright \(c\) 20\d\d [A-Z]/);
      expect(src, f + " must say it is not the portal's licence")
        .toMatch(/NOT under the portal's AGPL|not AGPL/i);
      expect(src, f + ' must record where it came from').toMatch(/github\.com\//);
      expect(src, f + ' must record the commit it was taken at').toMatch(/commit [0-9a-f]{7}/);
      // and it must not claim the house SPDX, which would relicense by accident
      expect(src.includes('SPDX-License-Identifier: AGPL-3.0-or-later'),
        f + ' must not carry the house SPDX line').toBe(false);
    }
  });
});

describe('THIRD PARTY · the harp v2, self-contained by excision', () => {
  const V2 = path.join(APP, 'luminara-harp-v2.html');
  const src = fs.existsSync(V2) ? fs.readFileSync(V2, 'utf8') : '';

  test('it is here at all', () => {
    expect(fs.existsSync(V2)).toBe(true);
  });

  test('no network surface survives, and none may return', () => {
    // the upstream artifact carried exactly two: a fetch of a localhost door
    // and a dynamic import of a module absent from its own tree. Both are gone.
    // This is deliberately blanket rather than the narrow src=/href= check the
    // v1 harp uses, because that check would not have caught either of them.
    //
    // Scanned over the EXECUTABLE text, with HTML comments removed first. The
    // provenance header names the excised URL verbatim so the record is exact,
    // and on the first run this pin went red against its own documentation. A
    // comment cannot open a socket; a script can, and stripping comments does
    // not hide one, since a reintroduced fetch would not be inside a comment.
    const live = src.replace(/<!--[\s\S]*?-->/g, '');
    for (const banned of ['http://', 'https://', 'fetch(', 'import(', 'XMLHttpRequest',
      'WebSocket', 'EventSource', 'new Worker', 'navigator.sendBeacon', '127.0.0.1']) {
      expect(live.includes(banned), 'a network surface returned to the harp v2: ' + banned)
        .toBe(false);
    }
    // the substring, not merely the scheme: a bare host in a string counts
    expect(live.includes('http'), 'the harp v2 must contain no http outside its comments')
      .toBe(false);
    // and the header really is the only place the excised door is named
    expect(src).toContain('127.0.0.1:7091');
  });

  test('the excision is recorded on the file, not only in the register', () => {
    expect(src).toContain('CHANGED FROM UPSTREAM');
    // the honest note: upstream's own header claimed self-containment while
    // shipping a fetch, so this property is made here and not inherited
    expect(src).toMatch(/HONEST NOTE/);
  });

  test('the way out is in its own Menu, not bolted to its surface', () => {
    // The portal does not crowd a borrowed instrument's chrome. The shared bar
    // was tried here and taken out again: it is 980px wide and centres on the
    // viewport, so it cannot live in a menu column, and luminara-nav.css
    // forbids restyling it. The exemption is recorded in workshop.test.ts's
    // NAVLESS_BY_DESIGN, and the law it is exempt from is the SHAPE, not the
    // duty. Nothing of the portal shows on the surface.
    expect(src.includes('<nav class="lnav">'),
      'the shared bar must not be bolted onto this instrument').toBe(false);
    expect(src.includes('luminara-nav.css'),
      'and it must not pull the shared sheet it no longer uses').toBe(false);

    const leave = src.slice(src.indexOf('<div class="leave">'));
    expect(leave.length, 'the Menu must carry a Leave block').toBeGreaterThan(0);
    const block = leave.slice(0, leave.indexOf('</div>'));
    const doors = [...block.matchAll(/href="\/app\/([a-z0-9-]+\.html)"/g)].map((m) => m[1]);
    expect(doors.length, 'the nine rooms and the sibling').toBe(10);
    for (const d of doors) {
      expect(fs.existsSync(path.join(APP, d)), 'the Menu names a missing page: ' + d).toBe(true);
    }
    expect(doors).toContain('luminara-workshop.html');

    // and the surface itself stays the author's: the standing label is his and
    // is required by his own CLAIM_BOUNDARY on every build and every mode, so
    // the foot lane keeps it and carries nothing the portal added
    const foot = src.slice(src.indexOf('<div id="footLane">'));
    const footBlock = foot.slice(0, foot.indexOf('</div>'));
    expect(footBlock).toContain('NOT EVIDENCE FOR RH OR GHP');
    expect(footBlock.includes('lnav'), 'no portal bar in the foot').toBe(false);
    expect(footBlock.includes('sibling'), 'no portal cross-link in the foot').toBe(false);
  });

  test('the two harps point at each other', () => {
    expect(src).toMatch(/class="sib"[\s\S]{0,200}luminara-harp\.html/);
    const v1 = fs.readFileSync(path.join(APP, 'luminara-harp.html'), 'utf8');
    expect(v1).toMatch(/class="sibling"[\s\S]{0,200}luminara-harp-v2\.html/);
    // v1 keeps the shared bar, and its sibling link stays out of it
    const v1nav = v1.slice(v1.indexOf('<nav class="lnav">'), v1.indexOf('</nav>'));
    expect(v1nav.includes('luminara-harp-v2'),
      'v1 must not seat its sibling in the shared bar').toBe(false);
  });

  test('it graduates no further than v1 did: still unlinked from the six', () => {
    for (const room of ['luminara-read', 'luminara-ring', 'luminara-map-room',
      'luminara-resonance', 'luminara-astrolabe', 'luminara-spectrum']) {
      const p = path.join(APP, room + '.html');
      if (!fs.existsSync(p)) continue;
      expect(fs.readFileSync(p, 'utf8').includes('luminara-harp-v2'),
        room + ' must not link the harp v2').toBe(false);
    }
    // but the workshop does, and says whose it is
    const shop = fs.readFileSync(path.join(APP, 'luminara-workshop.html'), 'utf8');
    expect(shop).toContain('/app/luminara-harp-v2.html');
    expect(shop).toMatch(/Peter Viviani/);
  });

  test('full view hides the controls and never the law', () => {
    // The portal added a minimised mode. The author's CLAIM_BOUNDARY.md requires
    // the standing label on every build and EVERY MODE, and a minimised view is
    // a mode, so the one thing this feature may not do is hide the foot lane to
    // make a prettier picture. That is what this pin exists to catch.
    expect(src).toContain('id="minBtn"');
    expect(src).toMatch(/function setMinimal/);

    // gather every selector that :root[data-min="1"] drives to display:none
    const hidden: string[] = [];
    for (const m of src.matchAll(/((?::root\[data-min="1"\][^{};]*,?\s*)+)\{([^}]*)\}/g)) {
      if (/display:\s*none/.test(m[2])) hidden.push(m[1].replace(/\s+/g, ' ').trim());
    }
    const allHidden = hidden.join(' ');
    expect(allHidden, 'full view must put the control lanes away').toContain('#topLane');
    expect(allHidden, 'full view must put the control lanes away').toContain('#dockLane');
    expect(allHidden.includes('#footLane'),
      'the standing label may never be hidden: CLAIM_BOUNDARY requires it in every mode')
      .toBe(false);

    // and it must CLOSE the panels rather than hide them open, or a sheet keeps
    // being drawn into while fitCanvas sizes its canvas to a clientWidth of zero
    const fn = src.slice(src.indexOf('function setMinimal'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body, 'minimising must close the panels, not hide them mid-draw')
      .toContain('closeAllPanels()');

    // there is always a way back out of it
    expect(src).toMatch(/k === 'm'/);
    expect(src).toMatch(/MINIMAL\) setMinimal\(false\)/);
  });

  test('the claim boundary came across intact', () => {
    const flat = src.replace(/\s+/g, ' ').toLowerCase();
    expect(flat).toContain('not evidence for rh');
    for (const banned of ['proves the riemann', 'supports the riemann', 'proof of rh',
      'first visualization', 'first sonification', 'breakthrough']) {
      expect(flat.includes(banned), 'harp v2 must not say: ' + banned).toBe(false);
    }
  });
});
