// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// AURA DETOKENIZATION PINS (AURA lane round 1, docs/mesh/handoff/AURA.md).
// AURA is an evolving, nonnumeric coherence and witness pattern — never a token, score,
// balance, currency, or personhood number, and never proof of humanity or authority.
// These are SOURCE-TEXT pins (the recall-source-pin precedent): they fail the gate if any
// user-facing surface reintroduces a numeric AURA award/balance or a forbidden claim.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const APP = path.join(__dirname, '..', '..', 'spatial', 'app');
const read = (rel: string) => fs.readFileSync(path.join(APP, rel), 'utf-8');

const UI_FILES = ['aura.js', 'aura-core.js', 'forge.js', 'chat.js', 'luminara.js', 'shell.js', 'tuning.js', path.join('auma', 'auma.js')];

describe('no numeric AURA ever reaches user-facing text again', () => {
  it("no '+N aura' toast/pop pattern in any UI file", () => {
    // catches: `+${n} aura`, '+' + n + ' aura', "+5 aura", `+${earned} aura`, etc.
    const plusAura = /\+\s*(?:['"`]?\s*\+\s*)?(?:\$\{[^}]*\}|\d+|[a-zA-Z_$][\w$]*)?\s*(?:['"`]\s*\+\s*)?['"`\s]*aura/i;
    for (const f of UI_FILES) {
      const src = read(f);
      for (const line of src.split('\n')) {
        // only lines that construct visible text (string literals containing 'aura')
        if (/['"`][^'"`]*aura/i.test(line) && plusAura.test(line)) {
          throw new Error(`numeric aura award text reintroduced in ${f}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
  });

  it('no aura balance / daily cap / streak-bonus display strings', () => {
    for (const f of UI_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/earned today/i);
      expect(src, f).not.toMatch(/\bdaily cap\b(?![^\n]*damper)/i);
      expect(src, f).not.toMatch(/streak bonus|nextStreakBonus[^\n]*textContent|day \$\{?\w*\.?streak/i);
      expect(src, f).not.toMatch(/aura-axis-val|forge-score-val/); // the removed number widgets stay removed
    }
  });

  it('aura-core never mutates the legacy tally again (frozen-writer invariant)', () => {
    const src = read('aura-core.js');
    expect(src).not.toMatch(/s\.aura\s*=\s*\(?Number\(s\.aura\)/); // the increment line
    expect(src).not.toMatch(/fromMessages\s*\+=|fromReadings\s*\+=|fromLessons\s*\+=|fromStreak\s*\+=|todayEarned\s*\+=/);
    expect(src).toMatch(/earned:\s*0/); // award() returns earned: 0 forever
  });

  it("the aura-changed event carries no number", () => {
    const src = read('aura-core.js');
    const evt = src.slice(src.indexOf("new CustomEvent('aura-changed'"));
    expect(evt.slice(0, 200)).not.toMatch(/\bn:|aura:|streakBonus/);
  });
});

describe('forbidden claims never return', () => {
  it('no token / minted / un-fakeable / proof-of-humanity product claims in UI files', () => {
    for (const f of UI_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/proof[- ]of[- ]humanity token/i);
      expect(src, f).not.toMatch(/un-?fakeable/i);
      expect(src, f).not.toMatch(/aura is (the )?(ecosystem )?token/i);
      expect(src, f).not.toMatch(/real aura is (only )?minted/i);
      expect(src, f).not.toMatch(/proof that you were real/i);
    }
  });

  it('the glyph carries the honest witness label, verbatim', () => {
    expect(read('aura.js')).toContain('local · unwitnessed');
  });

  it('the boundary sentence holds: evidence, never authority', () => {
    const src = read('aura.js');
    expect(src).toMatch(/evidence, never/i);
    expect(src).toMatch(/cannot unlock, sign, approve, or apply/i);
  });
});

// ---------------------------------------------------------------------------
// ROUND 2 — owner-directed PUBLIC-SURFACE pins (2026-07-10, AURA.md top entry).
// Round 1 pinned the Spatial organs; these pin the lander, the alternate
// website, the README, and the design-history docs, so the banned language
// cannot return through a marketing page or a doc quote.
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..', '..');
const readRoot = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

// The ONLY constructions allowed to contain banned words: the exact sentences
// that FORBID the claims (the Ask-Auma prompt's instruction block). Editing
// them breaks these pins on purpose — that forces a human re-review.
const ALLOWED_NEGATIONS = [
  'never say AURA is a token, minted, un-fakeable, or proof that someone is human',
  'AURA is NOT a score, token, balance, currency, or "personhood number"',
];
const stripAllowed = (src: string) => ALLOWED_NEGATIONS.reduce((s, neg) => s.split(neg).join(''), src);

const PUBLIC_SURFACES = [
  'lander/index.html', 'lander/main.js', 'lander/trinity-walkthrough.js',
  'lander/api/chat.js', 'lander/technical-brief.html', 'lander/style.css',
  'website/index.html', 'README.md',
];

const BANNED_PUBLIC: Array<[RegExp, string]> = [
  [/\+\s*\d+\s*per\s+(real\s+)?(message|lesson)/i, 'numeric per-act award rate'],
  [/capped daily|daily cap|earned today/i, 'daily-cap language'],
  [/\bday streak\b|streak[- ]weighted|streak bonus/i, 'streak-counter language'],
  [/becomes the real token|aura (reputation )?tokens?\b/i, 'AURA-as-token claim'],
  [/un-?fakeable/i, 'unfakeable claim'],
  [/proof[- ]of[- ]humanity(?!\s+problem)/i, 'proof-of-humanity claim (naming the PROBLEM is allowed)'],
  [/reputation you earn/i, 'reputation-earning framing'],
  [/stake reputation|shared score/i, 'stake/score bond framing'],
  [/the only score in/i, 'AURA-as-score claim'],
  [/aura mints|mint(s|ing)? aura/i, 'AURA minting claim'],
];

describe('public surfaces stay detokenized (lander · website · README)', () => {
  it('no banned numeric-person or token language on any public surface', () => {
    for (const rel of PUBLIC_SURFACES) {
      const src = stripAllowed(readRoot(rel));
      for (const [re, label] of BANNED_PUBLIC) {
        const m = src.match(re);
        if (m) throw new Error(`${label} reintroduced in ${rel}: "…${m[0]}…"`);
      }
    }
  });

  it('the Ask-Auma prompt still carries the forbidden-claims instruction verbatim', () => {
    const src = readRoot('lander/api/chat.js');
    for (const neg of ALLOWED_NEGATIONS) expect(src).toContain(neg);
  });
});

describe('spatial organs stay detokenized (round 2)', () => {
  it('the AURA page never counts bonds or vouches', () => {
    const src = read('aura.js');
    expect(src).not.toMatch(/\$\{bondCount\}|\d+\s*forge draft/);
    expect(src).toContain('Drafts waiting in the Forge');
  });

  it('forge copy carries no score/standing economics', () => {
    const src = read('forge.js');
    expect(src).not.toMatch(/bond’s score|forged-score|cost base standing|hard-capped/);
  });

  it('tuning ladder hints are qualitative — no numeric threshold is rendered', () => {
    const src = read('tuning.js');
    for (const m of src.matchAll(/next:\s*'([^']*)'/g)) {
      expect(m[1], `tuning hint "${m[1]}"`).not.toMatch(/\d/);
    }
  });

  it('auma shows no streak counter', () => {
    const src = read(path.join('auma', 'auma.js'));
    expect(src).not.toMatch(/\bday streak\b/i);
    expect(src).not.toMatch(/stat\(\s*srs\.streak/);
  });

  it('no fictional market instrument is named after AURA', () => {
    const src = read(path.join('wolf', 'wolf-market.js'));
    expect(src).not.toMatch(/'AUR'|Aura Coherence/);
  });

  it('the dashboard map never calls AURA a token', () => {
    const src = readRoot('dashboard/serve.ts');
    expect(src).not.toMatch(/AUM tokens|AURA reputation \+/);
    expect(src).toMatch(/never a token/);
  });
});

describe('design-history docs carry the covenant', () => {
  const BANNERED = [
    'docs/AUKORA_SOVEREIGN_COMPUTE_MASTER_PLAN.md',
    'docs/AURA_ECONOMY_AND_KNVS.md',
    'docs/RESONANCE_SPEC.md',
    'docs/THE_TUNING.md',
  ];

  it('the supersession banner leads every token-era doc', () => {
    for (const rel of BANNERED) {
      const src = readRoot(rel);
      expect(src, rel).toContain('Detokenization covenant (2026-07-10');
      expect(src.indexOf('Detokenization covenant'), `${rel}: banner must lead the doc`).toBeLessThan(600);
    }
  });

  it('current-spec docs make no unfakeable / proof-of-humanity claims', () => {
    expect(readRoot('docs/COHERENCE_GLYPH.md')).not.toMatch(/un-?fakeable/i);
    expect(readRoot('docs/UNIFIED_IDENTITY_STACK.md')).not.toMatch(/un-?fakeable/i);
    expect(readRoot('docs/TEMPORAL_ALCHEMY.md')).not.toMatch(/leg of proof[- ]of[- ]humanity/i);
  });
});
