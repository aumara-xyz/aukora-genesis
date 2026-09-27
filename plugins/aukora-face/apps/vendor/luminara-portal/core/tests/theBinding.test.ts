// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE BINDING'S PINS — the deck read as a graph, held to what the chart
// claims. Every figure in THE_BINDING.md is a consequence of counterOf and
// becomingOf and of nothing else, so each one is pinned here: if either
// relation is ever altered, the chart breaks loudly instead of quietly
// becoming false.

import { describe, expect, test } from 'vitest';
import { counterOf, becomingOf, codeOf, knotOf } from '../../spatial/app/luminara-canon.js';

const N = 27;
const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

const counterEdges = new Set<string>();
const becomingEdges = new Set<string>();
for (let n = 1; n <= N; n++) {
  const c = counterOf(n);
  if (c !== n) counterEdges.add(key(n, c));
  const b = becomingOf(n);
  if (b !== null && b !== n) becomingEdges.add(key(n, b));
}
const union = new Set([...counterEdges, ...becomingEdges]);

const adj: number[][] = Array.from({ length: N + 1 }, () => []);
for (const e of union) {
  const [a, b] = e.split('-').map(Number);
  adj[a].push(b); adj[b].push(a);
}
const bfs = (src: number) => {
  const d = new Array(N + 1).fill(-1);
  d[src] = 0;
  const q = [src];
  while (q.length) {
    const x = q.shift()!;
    for (const y of adj[x]) if (d[y] < 0) { d[y] = d[x] + 1; q.push(y); }
  }
  return d;
};

describe('THE BINDING — the deck as a graph', () => {
  test('two relations, thirty-two edges, and no edge is ever both', () => {
    expect(counterEdges.size).toBe(13);   // 26 cards pair off; the Seed answers itself
    expect(becomingEdges.size).toBe(19);  // 19 carry a turning mark
    expect([...counterEdges].filter((e) => becomingEdges.has(e))).toEqual([]);
    expect(union.size).toBe(32);
  });

  test('the figure is connected', () => {
    const d = bfs(1);
    for (let n = 1; n <= N; n++) expect(d[n]).toBeGreaterThanOrEqual(0);
  });

  test('the shells from the Seed are one, seven, seven, twelve', () => {
    const d = bfs(1);
    const shell: Record<number, number> = {};
    for (let n = 1; n <= N; n++) shell[d[n]] = (shell[d[n]] || 0) + 1;
    expect(shell).toEqual({ 0: 1, 1: 7, 2: 7, 3: 12 });

    // shell one is exactly the seven whose becoming is the Seed
    for (let n = 1; n <= N; n++) if (d[n] === 1) expect(becomingOf(n)).toBe(1);
    // shell two is exactly the settled cards other than the Seed, and each
    // reaches the Seed through its own counter
    for (let n = 1; n <= N; n++) if (d[n] === 2) {
      expect(becomingOf(n)).toBeNull();
      expect(becomingOf(counterOf(n))).toBe(1);
    }
  });

  test('diameter six, radius three, and the Seed is the only centre', () => {
    const ecc: number[] = [];
    for (let n = 1; n <= N; n++) ecc[n] = Math.max(...bfs(n).slice(1));
    expect(Math.max(...ecc.slice(1))).toBe(6);
    expect(Math.min(...ecc.slice(1))).toBe(3);
    const centres = [];
    for (let n = 1; n <= N; n++) if (ecc[n] === 3) centres.push(n);
    expect(centres).toEqual([1]);
  });

  test('the Seed is the hub at seven; the Scar stands alone at one', () => {
    const deg = new Array(N + 1).fill(0);
    for (const e of union) { const [a, b] = e.split('-').map(Number); deg[a]++; deg[b]++; }
    expect(deg[1]).toBe(7);    // the Seed
    expect(deg[14]).toBe(1);   // the Scar
    expect(counterOf(14)).toBe(27);  // its one edge runs to the Return
    const tally: Record<number, number> = {};
    for (let n = 1; n <= N; n++) tally[deg[n]] = (tally[deg[n]] || 0) + 1;
    expect(tally).toEqual({ 1: 1, 2: 22, 4: 3, 7: 1 });
  });

  test('the counter relation is accounted for by distance alone', () => {
    const d = bfs(1);
    let bridging = 0, rim = 0;
    for (let n = 1; n <= N; n++) {
      const c = counterOf(n);
      if (c === n) { expect(n).toBe(1); continue; }   // only the Seed answers itself
      const pair = [d[n], d[c]].sort().join(',');
      // every counter edge is either a shell-1/shell-2 bridge or a rim chord
      expect(['1,2', '3,3']).toContain(pair);
      if (pair === '1,2') bridging++; else rim++;
    }
    expect(bridging / 2).toBe(7);   // seven bridges, counted twice
    expect(rim / 2).toBe(6);        // six rim chords, counted twice
    // no card in shell 1 or 2 answers within its own shell
    for (let n = 1; n <= N; n++) if (d[n] === 1 || d[n] === 2) expect(d[counterOf(n)]).toBe(3 - d[n]);
    // every card on the rim answers within the rim
    for (let n = 1; n <= N; n++) if (d[n] === 3) expect(d[counterOf(n)]).toBe(3);
  });

  test('six independent cycles, every one of length seven', () => {
    const d = bfs(1);
    expect(union.size - N + 1).toBe(6);
    // the non-tree edges are exactly the rim's counter chords, and each closes
    // a loop of three out, one across, three back
    const rimChords = new Set<string>();
    for (let n = 1; n <= N; n++) if (d[n] === 3) rimChords.add(key(n, counterOf(n)));
    expect(rimChords.size).toBe(6);
    for (const e of rimChords) {
      const [a, b] = e.split('-').map(Number);
      expect(d[a] + 1 + d[b]).toBe(7);
    }
  });

  test('the alternation breaks only at the Seed', () => {
    // the Seed receives every one of its seven edges as a becoming and takes
    // no counter, so any path through it runs two becomings in succession;
    // every other card carries exactly one counter edge
    let toSeed = 0;
    for (let n = 1; n <= N; n++) if (becomingOf(n) === 1) toSeed++;
    expect(toSeed).toBe(7);
    expect(counterOf(1)).toBe(1);
    for (let n = 2; n <= N; n++) expect(counterOf(n)).not.toBe(n);
  });

  test('the girth is seven: nothing returns sooner', () => {
    // walk the whole cycle space, not just a basis, and confirm no element is
    // shorter than the fundamental loops
    const d = bfs(1);
    const edgeArr = [...union];
    const basis: Set<string>[] = [];
    const parent = new Array(N + 1).fill(0);
    const seenP = new Array(N + 1).fill(false);
    seenP[1] = true;
    const q = [1];
    const treeEdges = new Set<string>();
    while (q.length) {
      const x = q.shift()!;
      for (const y of adj[x]) if (!seenP[y]) { seenP[y] = true; parent[y] = x; treeEdges.add(key(x, y)); q.push(y); }
    }
    const pathUp = (n: number) => { const p: string[] = []; let x = n; while (x !== 1) { p.push(key(x, parent[x])); x = parent[x]; } return p; };
    for (const e of edgeArr) {
      if (treeEdges.has(e)) continue;
      const [a, b] = e.split('-').map(Number);
      const m = new Set<string>([e]);
      for (const s of [...pathUp(a), ...pathUp(b)]) m.has(s) ? m.delete(s) : m.add(s);
      basis.push(m);
    }
    expect(basis.length).toBe(6);
    let girth = Infinity;
    for (let mask = 1; mask < 64; mask++) {
      const acc = new Set<string>();
      for (let i = 0; i < 6; i++) if (mask & (1 << i)) for (const e of basis[i]) acc.has(e) ? acc.delete(e) : acc.add(e);
      // only count elements that are a single simple loop
      const deg: Record<number, number> = {};
      for (const e of acc) { const [x, y] = e.split('-').map(Number); deg[x] = (deg[x] || 0) + 1; deg[y] = (deg[y] || 0) + 1; }
      if (Object.values(deg).every((v) => v === 2)) girth = Math.min(girth, acc.size);
    }
    expect(girth).toBe(7);
    void d;
  });

  test('the three uniform codes hold every acyclic edge in the figure', () => {
    // bridges: edges lying on no cycle
    const tin = new Array(N + 1).fill(-1), low = new Array(N + 1).fill(-1);
    const bridges = new Set<string>();
    let timer = 0;
    const dfs = (v: number, p: number) => {
      tin[v] = low[v] = timer++;
      for (const to of adj[v]) {
        if (to === p) continue;
        if (tin[to] !== -1) low[v] = Math.min(low[v], tin[to]);
        else { dfs(to, v); low[v] = Math.min(low[v], low[to]); if (low[to] > tin[v]) bridges.add(key(v, to)); }
      }
    };
    dfs(1, 0);
    // exactly two, and they are the thread Seed - Return - Scar
    expect(bridges.size).toBe(2);
    expect(bridges.has(key(1, 27))).toBe(true);    // the Return's becoming, into the Seed
    expect(bridges.has(key(27, 14))).toBe(true);   // the Return's counter, to the Scar
    // so exactly two cards lie on no cycle at all
    const cyclic = new Set<number>();
    for (const e of union) if (!bridges.has(e)) { const [a, b] = e.split('-').map(Number); cyclic.add(a); cyclic.add(b); }
    expect(cyclic.size).toBe(25);
    expect(cyclic.has(14)).toBe(false);   // the Scar
    expect(cyclic.has(27)).toBe(false);   // the Return
  });

  test('the three uniform codes are the node and the antinodes', () => {
    const uniform: number[] = [];
    for (let n = 1; n <= N; n++) {
      const c = codeOf(n);
      if (c[0] === c[1] && c[1] === c[2]) uniform.push(n);
    }
    expect(uniform).toEqual([1, 14, 27]);            // the Seed, the Scar, the Return
    expect(uniform.map((n) => knotOf(n).q)).toEqual([0, 13, -13]);
    // maximal, and reachable no other way: all three weights pulling together
    for (let n = 1; n <= N; n++) {
      if (!uniform.includes(n)) expect(Math.abs(knotOf(n).q)).toBeLessThan(13);
    }
    // one per house
    expect(uniform.filter((n) => n <= 9).length).toBe(1);
    expect(uniform.filter((n) => n > 9 && n <= 18).length).toBe(1);
    expect(uniform.filter((n) => n > 18).length).toBe(1);
    // and they chain: Scar -> counter -> Return -> becoming -> Seed -> itself
    expect(counterOf(14)).toBe(27);
    expect(becomingOf(27)).toBe(1);
    expect(counterOf(1)).toBe(1);
  });

  test('the thirteen lines of the geometry are the thirteen counter-dyads', () => {
    const add = (a: number, b: number) => {
      const ca = codeOf(a), cb = codeOf(b);
      return 9 * ((ca[0] + cb[0]) % 3) + 3 * ((ca[1] + cb[1]) % 3) + ((ca[2] + cb[2]) % 3) + 1;
    };
    const lines = new Set<string>();
    for (let n = 2; n <= N; n++) lines.add([1, n, add(n, n)].sort((a, b) => a - b).join(','));
    expect(lines.size).toBe(13);            // (27 - 1) / (3 - 1)
    for (const L of lines) {
      const [a, b, c] = L.split(',').map(Number);
      expect(a).toBe(1);                    // every line is closed by the Seed
      expect(counterOf(b)).toBe(c);         // and its other two members are a dyad
      expect(knotOf(a).q + knotOf(b).q + knotOf(c).q).toBe(0);  // and it sums to zero
    }
  });

  test('the trinity is one of those lines: a subgroup, not a coincidence', () => {
    const add = (a: number, b: number) => {
      const ca = codeOf(a), cb = codeOf(b);
      return 9 * ((ca[0] + cb[0]) % 3) + 3 * ((ca[1] + cb[1]) % 3) + ((ca[2] + cb[2]) % 3) + 1;
    };
    // closed under the deck's own addition, which is what makes it a cause
    expect(add(14, 14)).toBe(27);   // the Scar doubled is the Return
    expect(add(14, 27)).toBe(1);    // and the two together return the Seed
    expect(add(27, 27)).toBe(14);
    for (const a of [1, 14, 27]) for (const b of [1, 14, 27]) expect([1, 14, 27]).toContain(add(a, b));
  });

  test('AUM is a subgroup; the houses are its cosets', () => {
    const add = (a: number, b: number) => {
      const ca = codeOf(a), cb = codeOf(b);
      return 9 * ((ca[0] + cb[0]) % 3) + 3 * ((ca[1] + cb[1]) % 3) + ((ca[2] + cb[2]) % 3) + 1;
    };
    const isSub = (m: number[]) => m.every((x) => m.every((y) => m.includes(add(x, y))));
    const house = (lo: number) => Array.from({ length: 9 }, (_, i) => lo + i);
    expect(isSub(house(1))).toBe(true);    // AUM
    expect(isSub(house(10))).toBe(false);  // MA is a coset, not a subgroup
    expect(isSub(house(19))).toBe(false);  // and so is RA
    // thirteen planes, all closed
    const planes = new Set<string>();
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let g = 0; g < 3; g++) {
      if (!a && !b && !g) continue;
      const mem: number[] = [];
      for (let n = 1; n <= N; n++) {
        const d = codeOf(n);
        if ((a * d[0] + b * d[1] + g * d[2]) % 3 === 0) mem.push(n);
      }
      expect(mem.length).toBe(9);
      expect(isSub(mem)).toBe(true);
      planes.add(mem.join(','));
    }
    expect(planes.size).toBe(13);
  });

  test('the planes name themselves: pole maps onto the dyads, one apiece', () => {
    const dot = (f: number[], d: number[]) => (f[0] * d[0] + f[1] * d[1] + f[2] * d[2]) % 3;
    const poles = new Set<string>();
    let isotropic = 0;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let g = 0; g < 3; g++) {
      const f = [a, b, g];
      if (!a && !b && !g) continue;
      if (f.find((x) => x !== 0) !== 1) continue;   // one representative per plane
      const pole = 9 * a + 3 * b + g + 1;
      poles.add([pole, counterOf(pole)].sort((x, y) => x - y).join(','));
      if (dot(f, f) === 0) {
        isotropic++;
        // self-perpendicular exactly when all three layers move: the restless eight
        expect(f.every((x) => x !== 0)).toBe(true);
        expect(knotOf(pole).p).toBe(7);
      }
    }
    expect(poles.size).toBe(13);     // a bijection onto the thirteen dyads
    expect(isotropic).toBe(4);       // the four body diagonals of the cube
  });

  test('the trinity is a body diagonal, and its plane is the plane of balance', () => {
    const sign = (s: number) => (s === 1 ? 1 : s === 2 ? -1 : 0);
    const pos = (n: number) => codeOf(n).map(sign);
    expect(pos(1)).toEqual([0, 0, 0]);       // the Seed at the core
    expect(pos(14)).toEqual([1, 1, 1]);      // the Scar at a corner
    expect(pos(27)).toEqual([-1, -1, -1]);   // the Return at the corner opposite
    // corners are the restless eight, giving four diagonals
    const corners: number[] = [];
    for (let n = 1; n <= N; n++) if (pos(n).filter((x) => x !== 0).length === 3) corners.push(n);
    expect(corners.length).toBe(8);
    expect(new Set(corners.map((n) => [n, counterOf(n)].sort((a, b) => a - b).join(','))).size).toBe(4);
    // and the plane poled on the trinity is where flowing and turning balance
    const plane: number[] = [];
    for (let n = 1; n <= N; n++) {
      const d = codeOf(n);
      if ((d[0] + d[1] + d[2]) % 3 === 0) plane.push(n);
    }
    expect(plane.length).toBe(9);
    expect(plane).toContain(1); expect(plane).toContain(14); expect(plane).toContain(27);
    for (const n of plane) {
      const d = codeOf(n);
      const flow = d.filter((x) => x === 1).length, turn = d.filter((x) => x === 2).length;
      expect(((flow - turn) % 3 + 3) % 3).toBe(0);   // normalised: JS gives -0 here
    }
  });

  test('the becoming forest: eight trees, each a power of two', () => {
    const roots: number[] = [];
    for (let n = 1; n <= N; n++) if (becomingOf(n) === null) roots.push(n);
    expect(roots.length).toBe(8);

    const size: Record<number, number> = {};
    for (let n = 1; n <= N; n++) {
      let x = n, guard = 0;
      while (becomingOf(x) !== null && guard++ < 10) x = becomingOf(x)!;
      size[x] = (size[x] || 0) + 1;
    }
    // a root with z still layers gathers exactly 2^z cards
    for (const r of roots) {
      const zeros = codeOf(r).filter((d: number) => d === 0).length;
      expect(size[r]).toBe(2 ** zeros);
    }
    expect(Object.values(size).reduce((a, b) => a + b, 0)).toBe(27);
    // one, three, three, one: the third row of the binomial triangle
    const byZeros: Record<number, number> = {};
    for (const r of roots) {
      const z = codeOf(r).filter((d: number) => d === 0).length;
      byZeros[z] = (byZeros[z] || 0) + 1;
    }
    expect(byZeros).toEqual({ 0: 1, 1: 3, 2: 3, 3: 1 });
  });
});
